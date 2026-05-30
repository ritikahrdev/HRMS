const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, teamEmployeeIds, canActOnEmployee } = require('../middleware/auth');
const { can } = require('../services/permissions');
const { getSettings, saveSettings } = require('../services/settings');
const { sendMail } = require('../services/email');
const { syncFromUrl, syncFromBuffer } = require('../services/attendanceSync');
const { syncFromSlack } = require('../services/slackSync');
const { memoryUpload } = require('../services/upload');

const router = express.Router();

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function myEmpId(req, res) {
  const id = req.session.user.employeeId;
  if (!id) { res.status(400).json({ error: 'Your login is not linked to an employee profile.' }); return null; }
  return id;
}

async function clockInCutoff() {
  const s = await getSettings();
  const [ih, im] = String(s.workStart || '10:00').split(':').map(Number);
  const grace = Number(s.graceMinutes != null ? s.graceMinutes : 30);
  const cutoff = new Date();
  cutoff.setHours(ih || 0, im || 0, 0, 0);
  cutoff.setMinutes(cutoff.getMinutes() + grace);
  const label = `${pad(cutoff.getHours())}:${pad(cutoff.getMinutes())}`;
  return { cutoff, label, grace };
}

async function statusForHours(hours) {
  const s = await getSettings();
  const full = Number(s.fullDayHours || 9);
  const half = Number(s.halfDayHours || 4.5);
  if (hours >= full) return 'present';
  if (hours >= half) return 'half';
  return 'absent';
}

router.get('/today', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const row = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, todayStr());
    const { cutoff, label } = await clockInCutoff();
    res.json({ date: todayStr(), attendance: row || null, window: { open: new Date() <= cutoff, cutoff: label } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/check-in', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const date = todayStr();
    const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, date);
    if (existing && existing.check_in) return res.status(400).json({ error: 'You have already clocked in today.' });
    const { cutoff, label } = await clockInCutoff();
    if (new Date() > cutoff) {
      return res.status(400).json({ error: `The attendance window closed at ${label}. Please raise an attendance request.`, windowClosed: true });
    }
    const now = new Date().toISOString();
    const s = await getSettings();
    const [ih, im] = String(s.workStart || '10:00').split(':').map(Number);
    const startToday = new Date(); startToday.setHours(ih || 0, im || 0, 0, 0);
    const lateMin = Math.max(0, Math.round((new Date(now) - startToday) / 60000));
    if (existing) await db.prepare('UPDATE attendance SET check_in = ?, status = ?, late_minutes = ? WHERE id = ?').run(now, 'present', lateMin, existing.id);
    else await db.prepare('INSERT INTO attendance (employee_id, date, check_in, status, late_minutes) VALUES (?, ?, ?, ?, ?)').run(empId, date, now, 'present', lateMin);
    res.json({ ok: true, checkIn: now, lateMinutes: lateMin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/check-out', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const date = todayStr();
    const row = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, date);
    if (!row || !row.check_in) return res.status(400).json({ error: 'Please clock in first.' });
    if (row.check_out) return res.status(400).json({ error: 'You have already clocked out today.' });
    const now = new Date().toISOString();
    const hours = (new Date(now) - new Date(row.check_in)) / 36e5;
    const status = await statusForHours(hours);
    const s = await getSettings();
    const full = Number(s.fullDayHours || 9);
    const ot = +Math.max(0, hours - full).toFixed(2);
    await db.prepare('UPDATE attendance SET check_out = ?, work_hours = ?, status = ?, ot_hours = ? WHERE id = ?').run(now, +hours.toFixed(2), status, ot, row.id);
    res.json({ ok: true, checkOut: now, workHours: +hours.toFixed(2), status, otHours: ot });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/my', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const month = req.query.month;
    if (month && !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    const rows = month
      ? await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? ORDER BY date DESC').all(empId, `${month}-%`)
      : await db.prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date DESC LIMIT 60').all(empId);
    res.json({ attendance: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/day', requireLogin, async (req, res) => {
  try {
    const role = req.session.user.role;
    const viewAll = can(role, 'attendance:viewAll');
    const viewTeam = can(role, 'attendance:viewTeam');
    if (!viewAll && !viewTeam) return res.status(403).json({ error: 'No access.' });
    const date = req.query.date || todayStr();
    let employees;
    if (viewAll) {
      employees = await db.prepare("SELECT * FROM employees WHERE status='active' ORDER BY name").all();
    } else {
      const ids = await teamEmployeeIds(req);
      if (!ids.length) return res.json({ date, summary: {}, list: [], holiday: null });
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      employees = await db.prepare(`SELECT * FROM employees WHERE id IN (${placeholders}) ORDER BY name`).all(ids);
    }
    const att = await db.prepare('SELECT * FROM attendance WHERE date = ?').all(date);
    const attMap = {}; for (const a of att) attMap[a.employee_id] = a;
    const leaves = await db.prepare("SELECT employee_id FROM leave_requests WHERE status='approved' AND from_date <= ? AND to_date >= ?").all(date, date);
    const onLeave = new Set(leaves.map((l) => l.employee_id));
    const holiday = await db.prepare('SELECT name FROM holidays WHERE date = ?').get(date);
    const list = employees.map((e) => {
      const a = attMap[e.id];
      let status = 'absent';
      if (a && a.status) status = a.status;
      else if (a && a.check_in) status = 'present';
      else if (onLeave.has(e.id)) status = 'leave';
      else if (holiday) status = 'holiday';
      return { id: e.id, name: e.name, emp_code: e.emp_code, department: e.department, status, check_in: a ? a.check_in : null, check_out: a ? a.check_out : null, work_hours: a ? a.work_hours : null };
    });
    const summary = { present: 0, half: 0, leave: 0, absent: 0, holiday: 0 };
    for (const l of list) summary[l.status] = (summary[l.status] || 0) + 1;
    res.json({ date, summary, list, holiday: holiday ? holiday.name : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/mark', requirePerm('attendance:correct'), async (req, res) => {
  try {
    const { employee_id, date, status } = req.body || {};
    if (!employee_id || !date || !status) return res.status(400).json({ error: 'employee_id, date, status required' });
    if (!await canActOnEmployee(req, employee_id)) return res.status(403).json({ error: 'Not in your team.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    const ci = req.body.check_in ? `${date}T${req.body.check_in}:00` : null;
    const co = req.body.check_out ? `${date}T${req.body.check_out}:00` : null;
    let hours = 0;
    if (ci && co) hours = +(((new Date(co) - new Date(ci)) / 36e5) || 0).toFixed(2);
    const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employee_id, date);
    if (existing) {
      await db.prepare('UPDATE attendance SET status = ?, check_in = ?, check_out = ?, work_hours = ? WHERE id = ?').run(status, ci, co, hours, existing.id);
    } else {
      await db.prepare('INSERT INTO attendance (employee_id, date, status, check_in, check_out, work_hours) VALUES (?, ?, ?, ?, ?, ?)').run(employee_id, date, status, ci, co, hours);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/delete', requirePerm('attendance:correct'), async (req, res) => {
  try {
    const { employee_id, date } = req.body || {};
    if (!employee_id || !date) return res.status(400).json({ error: 'employee_id and date required' });
    if (!await canActOnEmployee(req, employee_id)) return res.status(403).json({ error: 'Not in your team.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    await db.prepare('DELETE FROM attendance WHERE employee_id = ? AND date = ?').run(employee_id, date);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sync', requirePerm('attendance:viewAll'), async (req, res) => {
  try {
    if (req.body && req.body.url) await saveSettings({ attendanceSheetUrl: String(req.body.url).trim() });
    const result = await syncFromUrl(req.body && req.body.url);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/slack-sync', requirePerm('attendance:viewAll'), async (req, res) => {
  const date = (req.body && req.body.date) || todayStr();
  try {
    const result = await syncFromSlack(date);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/sync-file', requirePerm('attendance:viewAll'), memoryUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = await syncFromBuffer(req.file.buffer);
    res.json(result);
  } catch (e) { res.status(400).json({ error: 'Could not read the file. (' + e.message + ')' }); }
});

router.post('/correction', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const { date, requested_status, requested_in, requested_out, reason } = req.body || {};
    if (!date || !requested_status) return res.status(400).json({ error: 'Date and requested status are required.' });
    const r = await db.prepare('INSERT INTO attendance_corrections (employee_id, date, requested_status, requested_in, requested_out, reason) VALUES (?, ?, ?, ?, ?, ?)').run(empId, date, requested_status, requested_in || null, requested_out || null, reason || '');
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/corrections/my', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    res.json({ corrections: await db.prepare('SELECT * FROM attendance_corrections WHERE employee_id = ? ORDER BY applied_at DESC').all(empId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/corrections', requirePerm('attendance:correct'), async (req, res) => {
  try {
    const role = req.session.user.role;
    const base = `SELECT c.*, e.name AS employee_name, e.emp_code FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id`;
    let rows;
    if (role === 'MANAGER') {
      const ids = await teamEmployeeIds(req);
      if (!ids.length) return res.json({ corrections: [] });
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      rows = await db.prepare(base + ` WHERE c.employee_id IN (${placeholders}) ORDER BY c.applied_at DESC`).all(ids);
    } else {
      rows = await db.prepare(base + ' ORDER BY c.applied_at DESC').all();
    }
    res.json({ corrections: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/corrections/:id/decision', requirePerm('attendance:correct'), async (req, res) => {
  try {
    const { decision, comment } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });
    const c = await db.prepare('SELECT * FROM attendance_corrections WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!await canActOnEmployee(req, c.employee_id)) return res.status(403).json({ error: 'Not in your team.' });
    await db.prepare("UPDATE attendance_corrections SET status = ?, comment = ?, approver_id = ?, decided_at = datetime('now') WHERE id = ?").run(decision, comment || '', req.session.user.id, c.id);
    if (decision === 'approved') {
      const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(c.employee_id, c.date);
      const ci = c.requested_in ? `${c.date}T${c.requested_in}:00` : (existing ? existing.check_in : null);
      const co = c.requested_out ? `${c.date}T${c.requested_out}:00` : (existing ? existing.check_out : null);
      if (existing) await db.prepare('UPDATE attendance SET status = ?, check_in = ?, check_out = ? WHERE id = ?').run(c.requested_status, ci, co, existing.id);
      else await db.prepare('INSERT INTO attendance (employee_id, date, status, check_in, check_out) VALUES (?, ?, ?, ?, ?)').run(c.employee_id, c.date, c.requested_status, ci, co);
    }
    const emp = await db.prepare('SELECT name, email FROM employees WHERE id = ?').get(c.employee_id);
    if (emp && emp.email) {
      await sendMail({
        to: emp.email,
        subject: `Attendance correction ${decision}`,
        html: `<p>Hi ${emp.name},</p><p>Your attendance correction for <b>${c.date}</b> was <b>${decision}</b>.</p>${comment ? `<p>Comment: ${comment}</p>` : ''}`,
      });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.statusForHours = statusForHours;
module.exports.clockInCutoff = clockInCutoff;
