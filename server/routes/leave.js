const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, teamEmployeeIds, canActOnEmployee } = require('../middleware/auth');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');
const { applyLeaveDecision, approverEmailsFor } = require('../services/decisions');
const { actionUrl } = require('../services/tokens');
const accrual = require('../services/leaveAccrual');

const router = express.Router();

function daysBetween(from, to) {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.floor((b - a) / 864e5) + 1;
}

function myEmpId(req, res) {
  const id = req.session.user.employeeId;
  if (!id) { res.status(400).json({ error: 'Your login is not linked to an employee profile.' }); return null; }
  return id;
}

// Configured leave types (with safe fallback).
function leaveTypes() {
  const s = getSettings();
  if (Array.isArray(s.leaveTypes) && s.leaveTypes.length) return s.leaveTypes;
  return [{ code: 'unpaid', name: 'Unpaid Leave', quota: 0, paid: false }];
}

// Apply for leave (employee).
router.post('/', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const { type, from_date, to_date, reason } = req.body || {};
    const halfDay = req.body && (req.body.half_day === true || req.body.half_day === 1 || req.body.half_day === '1');
    if (!type || !from_date || !to_date) return res.status(400).json({ error: 'Type, from and to dates are required.' });
    if (to_date < from_date) return res.status(400).json({ error: 'End date cannot be before start date.' });
    if (halfDay && from_date !== to_date) return res.status(400).json({ error: 'A half-day leave must be for a single date.' });

    const days = halfDay ? 0.5 : daysBetween(from_date, to_date);
    const r = await db.prepare(
      'INSERT INTO leave_requests (employee_id, type, from_date, to_date, days, reason, half_day) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(empId, type, from_date, to_date, days, reason || '', halfDay ? 1 : 0);

    // Email the approver(s) with one-click approve / reject links.
    const emp = await db.prepare('SELECT name FROM employees WHERE id = ?').get(empId);
    const id = r.lastInsertRowid;
    const approveLink = actionUrl('leave', id, 'approved');
    const rejectLink = actionUrl('leave', id, 'rejected');
    const to = await approverEmailsFor(empId, 'leave');
    if (to.length) {
      await sendMail({
        to: to.join(','),
        subject: `Leave request from ${emp ? emp.name : 'an employee'}`,
        html: `<p><b>${emp ? emp.name : 'An employee'}</b> applied for <b>${type}</b> leave from <b>${from_date}</b> to <b>${to_date}</b> (${days} day(s)).</p>
          <p>Reason: ${reason || '-'}</p>
          <p>
            <a href="${approveLink}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-right:8px">Approve</a>
            <a href="${rejectLink}" style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reject</a>
          </p>
          <p style="color:#888;font-size:12px">Or open the HR portal to review it.</p>`,
      });
    }
    res.json({ id, days });
  } catch (err) {
    console.error('Error applying for leave:', err);
    res.status(500).json({ error: 'Failed to apply for leave' });
  }
});

// Configured leave types (for the apply form).
router.get('/types', requireLogin, (req, res) => {
  res.json({ types: leaveTypes() });
});

// Leave balance for the logged-in employee (per configured type, this year).
async function balanceFor(empId) {
  const types = leaveTypes();
  const year = new Date().getFullYear();
  const used = await db.prepare(
    `SELECT type, COALESCE(SUM(days),0) AS d FROM leave_requests
     WHERE employee_id = ? AND status='approved' AND substr(from_date,1,4) = ? GROUP BY type`
  ).all(empId, String(year));
  const usedMap = {}; for (const u of used) usedMap[u.type] = u.d;

  // Comp-off allowance = granted credits this year.
  const compCredits = (await db.prepare(
    "SELECT COALESCE(SUM(days),0) AS d FROM comp_off_credits WHERE employee_id = ? AND substr(created_at,1,4) = ?"
  ).get(empId, String(year))).d;

  const accrualRules = accrual.accrualRules();
  const accrualOn = accrual.isEnabled();

  const balance = {};
  for (const t of types) {
    if (t.code === 'unpaid') continue; // unlimited
    let allowed;
    let source = 'quota';
    if (t.code === 'comp_off') { allowed = compCredits; source = 'comp_off'; }
    else if (accrualOn && accrualRules[t.code]) { allowed = await accrual.ledgerAllowed(empId, t.code, year); source = 'accrual'; }
    else { allowed = t.quota || 0; }
    const u = usedMap[t.code] || 0;
    balance[t.code] = { name: t.name, allowed, used: u, remaining: +(allowed - u).toFixed(1), paid: t.paid !== false, source };
  }
  return { year, balance, accrualEnabled: accrualOn };
}

router.get('/balance', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    res.json(await balanceFor(empId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// My leave requests.
router.get('/my', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const rows = await db.prepare('SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY applied_at DESC').all(empId);
    res.json({ leaves: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Team/company leave calendar — approved leaves overlapping a month.
router.get('/calendar', requirePerm('leave:approve'), async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const base = `SELECT lr.*, e.name AS employee_name, e.emp_code FROM leave_requests lr
                JOIN employees e ON e.id = lr.employee_id
                WHERE lr.status='approved' AND NOT (lr.to_date < ? OR lr.from_date > ?)`;
    const lo = `${month}-01`, hi = `${month}-31`;
    let rows;
    if (req.session.user.role === 'MANAGER') {
      const ids = await teamEmployeeIds(req);
      if (ids.length === 0) return res.json({ month, leaves: [] });
      rows = await db.prepare(base + ` AND lr.employee_id IN (${ids.map(() => '?').join(',')}) ORDER BY lr.from_date`).all(lo, hi, ...ids);
    } else {
      rows = await db.prepare(base + ' ORDER BY lr.from_date').all(lo, hi);
    }
    res.json({ month, leaves: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Comp-off credits (HR/Super grant; e.g. for working a holiday/weekend) ----
router.get('/compoff', requirePerm('leave:approve'), async (req, res) => {
  try {
    const empId = req.query.employee_id;
    const base = `SELECT cc.*, e.name AS employee_name FROM comp_off_credits cc JOIN employees e ON e.id = cc.employee_id`;
    const rows = empId
      ? await db.prepare(base + ' WHERE cc.employee_id = ? ORDER BY cc.created_at DESC').all(empId)
      : await db.prepare(base + ' ORDER BY cc.created_at DESC').all();
    res.json({ credits: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/compoff', requirePerm('leave:approve'), async (req, res) => {
  try {
    const { employee_id, days, reason } = req.body || {};
    if (!employee_id || !days) return res.status(400).json({ error: 'Employee and days are required.' });
    if (!(await canActOnEmployee(req, employee_id))) return res.status(403).json({ error: 'Not in your team.' });
    const r = await db.prepare('INSERT INTO comp_off_credits (employee_id, days, reason, granted_by) VALUES (?, ?, ?, ?)')
      .run(employee_id, Number(days) || 0, reason || '', req.session.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/compoff/:id', requirePerm('leave:approve'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM comp_off_credits WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// All leave requests for approvers (HR/Super = all; Manager = team), optional status filter.
router.get('/', requirePerm('leave:approve'), async (req, res) => {
  try {
    const status = req.query.status;
    const base = `SELECT lr.*, e.name AS employee_name, e.emp_code
               FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id`;
    let where = '';
    let params = [];
    if (req.session.user.role === 'MANAGER') {
      const ids = await teamEmployeeIds(req);
      if (ids.length === 0) return res.json({ leaves: [] });
      where = ` WHERE lr.employee_id IN (${ids.map(() => '?').join(',')})`;
      params = ids;
    }
    if (status) { where += (where ? ' AND' : ' WHERE') + ' lr.status = ?'; params.push(status); }
    const rows = await db.prepare(base + where + ' ORDER BY lr.applied_at DESC').all(...params);
    res.json({ leaves: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Approve or reject.
router.post('/:id/decision', requirePerm('leave:approve'), async (req, res) => {
  const { decision, comment } = req.body || {};
  if (!['approved', 'rejected'].includes(decision))
    return res.status(400).json({ error: 'decision must be approved or rejected' });

  const lr = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!lr) return res.status(404).json({ error: 'Not found' });
  if (!(await canActOnEmployee(req, lr.employee_id))) return res.status(403).json({ error: 'Not in your team.' });

  await applyLeaveDecision(lr.id, decision, comment, req.session.user.id);
  res.json({ ok: true });
});

// ---- Leave accrual & carry-forward (HR/Super) -----------------------------

// View an employee's accrual ledger (HR sees anyone; an employee sees their own).
router.get('/ledger', requireLogin, async (req, res) => {
  try {
    const role = req.session.user.role;
    let empId = req.query.employee_id;
    const canManage = require('../services/permissions').can(role, 'leave:approve') || require('../services/permissions').can(role, 'settings:manage');
    if (!empId) empId = req.session.user.employeeId;
    if (!empId) return res.json({ ledger: [] });
    if (String(empId) !== String(req.session.user.employeeId) && !canManage) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    const rows = await db.prepare(
      'SELECT * FROM leave_ledger WHERE employee_id = ? ORDER BY period DESC, id DESC LIMIT 200'
    ).all(empId);
    res.json({ ledger: rows, enabled: accrual.isEnabled(), rules: accrual.accrualRules() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run monthly accrual (defaults to catching up the whole current year).
router.post('/accrual/run', requirePerm('settings:manage'), async (req, res) => {
  try {
    if (!accrual.isEnabled()) return res.status(400).json({ error: 'Leave accrual is turned off. Enable it in Settings → Leave Accrual first.' });
    const month = req.body && req.body.month;
    let result;
    if (month && /^\d{4}-\d{2}$/.test(month)) result = await accrual.runMonthlyAccrual(month, req.session.user.id);
    else result = await accrual.catchUpYear(new Date().getFullYear(), req.session.user.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Carry forward a year's remaining balance into the next year.
router.post('/accrual/carry-forward', requirePerm('settings:manage'), async (req, res) => {
  try {
    if (!accrual.isEnabled()) return res.status(400).json({ error: 'Leave accrual is turned off.' });
    const year = (req.body && req.body.year) || new Date().getFullYear();
    const result = await accrual.runCarryForward(Number(year), req.session.user.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Manual ledger adjustment (e.g. opening balance or a correction).
router.post('/ledger/adjust', requirePerm('settings:manage'), async (req, res) => {
  try {
    const { employee_id, type, amount, note } = req.body || {};
    if (!employee_id || !type || amount == null) return res.status(400).json({ error: 'employee_id, type and amount are required.' });
    const period = String(new Date().getFullYear());
    // adjustments stack, so make each unique by appending a counter to the period key.
    const n = (await db.prepare("SELECT COUNT(*) AS c FROM leave_ledger WHERE employee_id=? AND type=? AND kind='adjustment' AND substr(period,1,4)=?").get(employee_id, type, period)).c;
    await accrual.addEntry(employee_id, type, Number(amount), 'adjustment', `${period}#${Number(n) + 1}`, note || 'Manual adjustment', req.session.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
