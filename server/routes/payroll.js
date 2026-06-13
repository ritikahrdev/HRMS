const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, requireSuperAdmin } = require('../middleware/auth');
const { can } = require('../services/permissions');
const { computePayroll, generatePayslip } = require('../services/payroll');
const { buildPayslipPdf } = require('../services/pdf');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');
const { escapeHtml } = require('../services/escape');

const router = express.Router();

async function withName(slip) {
  const e = await db.prepare('SELECT name, emp_code FROM employees WHERE id = ?').get(slip.employee_id);
  return { ...slip, employee_name: e ? e.name : '', emp_code: e ? e.emp_code : '' };
}

// Preview a calculation without saving.
router.get('/preview', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const { employee_id, month } = req.query;
    if (!employee_id || !month) return res.status(400).json({ error: 'employee_id and month required' });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    res.json({ payroll: await computePayroll(Number(employee_id), month) });
  } catch (e) {
    console.error('Error previewing payroll:', e);
    res.status(400).json({ error: e.message || 'Failed to preview payroll' });
  }
});

async function getRun(month) {
  return (await db.prepare('SELECT * FROM payroll_runs WHERE month = ?').get(month)) || { month, status: 'draft' };
}

// Generate payslips for all active employees for a month.
router.post('/generate', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const { month, employee_id } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) required' });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const run = await getRun(month);
    if (run.status === 'approved') {
      return res.status(400).json({ error: 'This month\'s payroll is approved and locked. Unlock it before regenerating.' });
    }

    let employees;
    if (employee_id) employees = [await db.prepare('SELECT id FROM employees WHERE id = ?').get(employee_id)].filter(Boolean);
    else employees = await db.prepare("SELECT id FROM employees WHERE status='active'").all();

    // Run inside a transaction (node:sqlite has no db.transaction(); use BEGIN/COMMIT).
    let slips;
    await db.withTransaction(async (tx) => {
      slips = [];
      for (const e of employees) slips.push(await withName(await generatePayslip(e.id, month)));
      await tx.prepare(
        `INSERT INTO payroll_runs (month, status, updated_at) VALUES (?, 'draft', datetime('now'))
         ON CONFLICT(month) DO UPDATE SET status='draft', updated_at=datetime('now')`
      ).run(month);
    });

    res.json({ month, count: slips.length, payslips: slips, run: await getRun(month) });
  } catch (err) {
    console.error('Error generating payroll:', err);
    res.status(500).json({ error: 'Failed to generate payroll: ' + (err && err.message ? err.message : 'unknown error') });
  }
});

// Payroll run status for a month.
router.get('/run', requirePerm('payroll:view'), async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    res.json({ run: await getRun(month) });
  } catch (err) {
    console.error('Error fetching payroll run:', err);
    res.status(500).json({ error: 'Failed to fetch payroll run' });
  }
});

// Approve (lock) a month's payroll.
router.post('/approve', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const { month } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month required' });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const count = (await db.prepare('SELECT COUNT(*) c FROM payslips WHERE month = ?').get(month)).c;
    if (!count) return res.status(400).json({ error: 'Generate payslips before approving.' });
    await db.prepare(
      `INSERT INTO payroll_runs (month, status, approved_by, approved_at, updated_at)
       VALUES (?, 'approved', ?, datetime('now'), datetime('now'))
       ON CONFLICT(month) DO UPDATE SET status='approved', approved_by=excluded.approved_by, approved_at=datetime('now'), updated_at=datetime('now')`
    ).run(month, req.session.user.id);
    res.json({ ok: true, run: await getRun(month) });
  } catch (err) {
    console.error('Error approving payroll:', err);
    res.status(500).json({ error: 'Failed to approve payroll' });
  }
});

// Unlock an approved run (Super Admin only) so it can be regenerated. This is
// deliberately stricter than payroll:manage — a Finance Admin can run/approve
// payroll, but only a Super Admin may break the lock on an approved month.
router.post('/unlock', requireSuperAdmin, async (req, res) => {
  try {
    const { month } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month required' });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    await db.prepare("UPDATE payroll_runs SET status='draft', updated_at=datetime('now') WHERE month = ?").run(month);
    res.json({ ok: true, run: await getRun(month) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List payslips for a month (Finance/HR/Super can view).
router.get('/', requirePerm('payroll:view'), async (req, res) => {
  try {
    const month = req.query.month;
    const rows = month
      ? await db.prepare('SELECT * FROM payslips WHERE month = ? ORDER BY id').all(month)
      : await db.prepare('SELECT * FROM payslips ORDER BY month DESC, id LIMIT 200').all();
    res.json({ payslips: await Promise.all(rows.map(withName)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Logged-in employee's payslips.
router.get('/my', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.json({ payslips: [] });
    const rows = await db.prepare('SELECT * FROM payslips WHERE employee_id = ? ORDER BY month DESC').all(empId);
    res.json({ payslips: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function canAccessSlip(req, slip) {
  return can(req.session.user.role, 'payroll:view') || req.session.user.employeeId === slip.employee_id;
}

// Download payslip PDF (admin or owner).
router.get('/:id/pdf', requireLogin, async (req, res) => {
  const slip = await db.prepare('SELECT * FROM payslips WHERE id = ?').get(req.params.id);
  if (!slip) return res.status(404).send('Not found');
  if (!canAccessSlip(req, slip)) return res.status(403).send('Forbidden');
  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(slip.employee_id);
  try {
    const filePath = await buildPayslipPdf(emp, slip);
    res.download(filePath, `payslip-${emp.emp_code || emp.id}-${slip.month}.pdf`);
  } catch (e) {
    res.status(500).send('Could not generate PDF: ' + e.message);
  }
});

// Email payslip to the employee.
router.post('/:id/email', requirePerm('payroll:manage'), async (req, res) => {
  const slip = await db.prepare('SELECT * FROM payslips WHERE id = ?').get(req.params.id);
  if (!slip) return res.status(404).json({ error: 'Not found' });
  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(slip.employee_id);
  if (!emp.email) return res.status(400).json({ error: 'Employee has no email.' });

  const filePath = await buildPayslipPdf(emp, slip);
  const s = getSettings();
  const result = await sendMail({
    to: emp.email,
    subject: `Payslip for ${slip.month}`,
    html: `<p>Hi ${escapeHtml(emp.name)},</p><p>Please find attached your payslip for ${escapeHtml(slip.month)}.</p><p>${escapeHtml(s.companyName || '')}</p>`,
    attachments: [{ filename: `payslip-${slip.month}.pdf`, path: filePath }],
  });
  res.json({ ok: result.ok, reason: result.reason });
});

module.exports = router;
