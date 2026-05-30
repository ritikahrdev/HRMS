const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');
const { can } = require('../services/permissions');
const { computePayroll, generatePayslip } = require('../services/payroll');
const { buildPayslipPdf } = require('../services/pdf');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');

const router = express.Router();

async function withName(slip) {
  const e = await db.prepare('SELECT name, emp_code FROM employees WHERE id = ?').get(slip.employee_id);
  return { ...slip, employee_name: e ? e.name : '', emp_code: e ? e.emp_code : '' };
}

router.get('/preview', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const { employee_id, month } = req.query;
    if (!employee_id || !month) return res.status(400).json({ error: 'employee_id and month required' });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    res.json({ payroll: await computePayroll(Number(employee_id), month) });
  } catch (e) { res.status(400).json({ error: e.message || 'Failed to preview payroll' }); }
});

async function getRun(month) {
  return await db.prepare('SELECT * FROM payroll_runs WHERE month = ?').get(month) || { month, status: 'draft' };
}

router.post('/generate', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const { month, employee_id } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) required' });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    const run = await getRun(month);
    if (run.status === 'approved') return res.status(400).json({ error: 'This month\'s payroll is approved and locked.' });
    let employees;
    if (employee_id) {
      const e = await db.prepare('SELECT id FROM employees WHERE id = ?').get(employee_id);
      employees = e ? [e] : [];
    } else {
      employees = await db.prepare("SELECT id FROM employees WHERE status='active'").all();
    }
    const slips = [];
    for (const e of employees) slips.push(await withName(await generatePayslip(e.id, month)));
    await db.prepare(
      `INSERT INTO payroll_runs (month, status, updated_at) VALUES (?, 'draft', datetime('now'))
       ON CONFLICT(month) DO UPDATE SET status='draft', updated_at=to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
    ).run(month);
    res.json({ month, count: slips.length, payslips: slips, run: await getRun(month) });
  } catch (e) { res.status(500).json({ error: e.message || 'Failed to generate payroll' }); }
});

router.get('/run', requirePerm('payroll:view'), async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month required' });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format.' });
    res.json({ run: await getRun(month) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/approve', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const { month } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month required' });
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format.' });
    const row = await db.prepare('SELECT COUNT(*) AS c FROM payslips WHERE month = ?').get(month);
    if (!row || !row.c) return res.status(400).json({ error: 'Generate payslips before approving.' });
    await db.prepare(
      `INSERT INTO payroll_runs (month, status, approved_by, approved_at, updated_at)
       VALUES (?, 'approved', ?, datetime('now'), datetime('now'))
       ON CONFLICT(month) DO UPDATE SET status='approved', approved_by=EXCLUDED.approved_by, approved_at=to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), updated_at=to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
    ).run(month, req.session.user.id);
    res.json({ ok: true, run: await getRun(month) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/unlock', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const { month } = req.body || {};
    if (!month) return res.status(400).json({ error: 'month required' });
    await db.prepare("UPDATE payroll_runs SET status='draft', updated_at=datetime('now') WHERE month = ?").run(month);
    res.json({ ok: true, run: await getRun(month) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/', requirePerm('payroll:view'), async (req, res) => {
  try {
    const month = req.query.month;
    const rows = month
      ? await db.prepare('SELECT * FROM payslips WHERE month = ? ORDER BY id').all(month)
      : await db.prepare('SELECT * FROM payslips ORDER BY month DESC, id LIMIT 200').all();
    const result = [];
    for (const r of rows) result.push(await withName(r));
    res.json({ payslips: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/my', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.json({ payslips: [] });
    const rows = await db.prepare('SELECT * FROM payslips WHERE employee_id = ? ORDER BY month DESC').all(empId);
    res.json({ payslips: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function canAccessSlip(req, slip) {
  return can(req.session.user.role, 'payroll:view') || req.session.user.employeeId === slip.employee_id;
}

router.get('/:id/pdf', requireLogin, async (req, res) => {
  try {
    const slip = await db.prepare('SELECT * FROM payslips WHERE id = ?').get(req.params.id);
    if (!slip) return res.status(404).send('Not found');
    if (!canAccessSlip(req, slip)) return res.status(403).send('Forbidden');
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(slip.employee_id);
    const filePath = await buildPayslipPdf(emp, slip);
    res.download(filePath, `payslip-${emp.emp_code || emp.id}-${slip.month}.pdf`);
  } catch (e) { res.status(500).send('Could not generate PDF: ' + e.message); }
});

router.post('/:id/email', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const slip = await db.prepare('SELECT * FROM payslips WHERE id = ?').get(req.params.id);
    if (!slip) return res.status(404).json({ error: 'Not found' });
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(slip.employee_id);
    if (!emp.email) return res.status(400).json({ error: 'Employee has no email.' });
    const filePath = await buildPayslipPdf(emp, slip);
    const s = await getSettings();
    const result = await sendMail({
      to: emp.email,
      subject: `Payslip for ${slip.month}`,
      html: `<p>Hi ${emp.name},</p><p>Please find attached your payslip for ${slip.month}.</p><p>${s.companyName || ''}</p>`,
      attachments: [{ filename: `payslip-${slip.month}.pdf`, path: filePath }],
    });
    res.json({ ok: result.ok, reason: result.reason });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
