const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');
const { can } = require('../services/permissions');
const { computePayroll, generatePayslip } = require('../services/payroll');
const { buildPayslipPdf } = require('../services/pdf');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');

const router = express.Router();

function withName(slip) {
  const e = db.prepare('SELECT name, emp_code FROM employees WHERE id = ?').get(slip.employee_id);
  return { ...slip, employee_name: e ? e.name : '', emp_code: e ? e.emp_code : '' };
}

// Preview a calculation without saving.
router.get('/preview', requirePerm('payroll:manage'), (req, res) => {
  try {
    const { employee_id, month } = req.query;
    if (!employee_id || !month) return res.status(400).json({ error: 'employee_id and month required' });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    res.json({ payroll: computePayroll(Number(employee_id), month) });
  } catch (e) {
    console.error('Error previewing payroll:', e);
    res.status(400).json({ error: e.message || 'Failed to preview payroll' });
  }
});

function getRun(month) {
  return db.prepare('SELECT * FROM payroll_runs WHERE month = ?').get(month) || { month, status: 'draft' };
}

// Generate payslips for all active employees for a month.
router.post('/generate', requirePerm('payroll:manage'), (req, res) => {
  try {
    const { month, employee_id } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) required' });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const run = getRun(month);
    if (run.status === 'approved') {
      return res.status(400).json({ error: 'This month\'s payroll is approved and locked. Unlock it before regenerating.' });
    }

    let employees;
    if (employee_id) employees = [db.prepare('SELECT id FROM employees WHERE id = ?').get(employee_id)].filter(Boolean);
    else employees = db.prepare("SELECT id FROM employees WHERE status='active'").all();

    // Run inside a transaction (node:sqlite has no db.transaction(); use BEGIN/COMMIT).
    db.exec('BEGIN');
    let slips;
    try {
      slips = [];
      for (const e of employees) slips.push(withName(generatePayslip(e.id, month)));
      db.prepare(
        `INSERT INTO payroll_runs (month, status, updated_at) VALUES (?, 'draft', datetime('now'))
         ON CONFLICT(month) DO UPDATE SET status='draft', updated_at=datetime('now')`
      ).run(month);
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    res.json({ month, count: slips.length, payslips: slips, run: getRun(month) });
  } catch (err) {
    console.error('Error generating payroll:', err);
    res.status(500).json({ error: 'Failed to generate payroll: ' + (err && err.message ? err.message : 'unknown error') });
  }
});

// Payroll run status for a month.
router.get('/run', requirePerm('payroll:view'), (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    res.json({ run: getRun(month) });
  } catch (err) {
    console.error('Error fetching payroll run:', err);
    res.status(500).json({ error: 'Failed to fetch payroll run' });
  }
});

// Approve (lock) a month's payroll.
router.post('/approve', requirePerm('payroll:manage'), (req, res) => {
  try {
    const { month } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month required' });

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const count = db.prepare('SELECT COUNT(*) c FROM payslips WHERE month = ?').get(month).c;
    if (!count) return res.status(400).json({ error: 'Generate payslips before approving.' });
    db.prepare(
      `INSERT INTO payroll_runs (month, status, approved_by, approved_at, updated_at)
       VALUES (?, 'approved', ?, datetime('now'), datetime('now'))
       ON CONFLICT(month) DO UPDATE SET status='approved', approved_by=excluded.approved_by, approved_at=datetime('now'), updated_at=datetime('now')`
    ).run(month, req.session.user.id);
    res.json({ ok: true, run: getRun(month) });
  } catch (err) {
    console.error('Error approving payroll:', err);
    res.status(500).json({ error: 'Failed to approve payroll' });
  }
});

// Unlock an approved run (Super Admin only) so it can be regenerated.
router.post('/unlock', requirePerm('payroll:manage'), (req, res) => {
  const { month } = req.body || {};
  if (!month) return res.status(400).json({ error: 'month required' });
  db.prepare("UPDATE payroll_runs SET status='draft', updated_at=datetime('now') WHERE month = ?").run(month);
  res.json({ ok: true, run: getRun(month) });
});

// List payslips for a month (Finance/HR/Super can view).
router.get('/', requirePerm('payroll:view'), (req, res) => {
  const month = req.query.month;
  const rows = month
    ? db.prepare('SELECT * FROM payslips WHERE month = ? ORDER BY id').all(month)
    : db.prepare('SELECT * FROM payslips ORDER BY month DESC, id LIMIT 200').all();
  res.json({ payslips: rows.map(withName) });
});

// Logged-in employee's payslips.
router.get('/my', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.json({ payslips: [] });
  const rows = db.prepare('SELECT * FROM payslips WHERE employee_id = ? ORDER BY month DESC').all(empId);
  res.json({ payslips: rows });
});

function canAccessSlip(req, slip) {
  return can(req.session.user.role, 'payroll:view') || req.session.user.employeeId === slip.employee_id;
}

// Download payslip PDF (admin or owner).
router.get('/:id/pdf', requireLogin, async (req, res) => {
  const slip = db.prepare('SELECT * FROM payslips WHERE id = ?').get(req.params.id);
  if (!slip) return res.status(404).send('Not found');
  if (!canAccessSlip(req, slip)) return res.status(403).send('Forbidden');
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(slip.employee_id);
  try {
    const filePath = await buildPayslipPdf(emp, slip);
    res.download(filePath, `payslip-${emp.emp_code || emp.id}-${slip.month}.pdf`);
  } catch (e) {
    res.status(500).send('Could not generate PDF: ' + e.message);
  }
});

// Email payslip to the employee.
router.post('/:id/email', requirePerm('payroll:manage'), async (req, res) => {
  const slip = db.prepare('SELECT * FROM payslips WHERE id = ?').get(req.params.id);
  if (!slip) return res.status(404).json({ error: 'Not found' });
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(slip.employee_id);
  if (!emp.email) return res.status(400).json({ error: 'Employee has no email.' });

  const filePath = await buildPayslipPdf(emp, slip);
  const s = getSettings();
  const result = await sendMail({
    to: emp.email,
    subject: `Payslip for ${slip.month}`,
    html: `<p>Hi ${emp.name},</p><p>Please find attached your payslip for ${slip.month}.</p><p>${s.companyName || ''}</p>`,
    attachments: [{ filename: `payslip-${slip.month}.pdf`, path: filePath }],
  });
  res.json({ ok: result.ok, reason: result.reason });
});

module.exports = router;
