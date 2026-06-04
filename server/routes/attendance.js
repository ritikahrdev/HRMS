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

// The latest time an employee may clock in today = in-time + grace minutes.
function clockInCutoff() {
  const s = getSettings();
  const [ih, im] = String(s.workStart || '10:00').split(':').map(Number);
  const grace = Number(s.graceMinutes != null ? s.graceMinutes : 30);
  const cutoff = new Date();
  cutoff.setHours(ih || 0, im || 0, 0, 0);
  cutoff.setMinutes(cutoff.getMinutes() + grace);
  const label = `${pad(cutoff.getHours())}:${pad(cutoff.getMinutes())}`;
  return { cutoff, label, grace };
}

// Decides Present / Half / Absent from hours worked against the shift.
function statusForHours(hours) {
  const s = getSettings();
  const full = Number(s.fullDayHours || 9);
  const half = Number(s.halfDayHours || 4.5);
  if (hours >= full) return 'present';
  if (hours >= half) return 'half';
  return 'absent';
}

// Today's status for the logged-in employee (incl. the clock-in window state).
router.get('/today', requireLogin, (req, res) => {
  const empId = myEmpId(req, res); if (!empId) return;
  const row = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, todayStr());
  const { cutoff, label } = clockInCutoff();
  res.json({
    date: todayStr(),
    attendance: row || null,
    window: { open: new Date() <= cutoff, cutoff: label },
  });
});

router.post('/check-in', requireLogin, (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const date = todayStr();
    const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, date);
    if (existing && existing.check_in) return res.status(400).json({ error: 'You have already clocked in today.' });

    const { cutoff, label } = clockInCutoff();
    if (new Date() > cutoff) {
      return res.status(400).json({
        error: `The attendance window closed at ${label}. Please raise an attendance request for the admin to approve.`,
        windowClosed: true,
      });
    }

    const now = new Date().toISOString();
    // Late minutes = clock-in after shift start time.
    const s = getSettings();
    const [ih, im] = String(s.workStart || '10:00').split(':').map(Number);
    const startToday = new Date(); startToday.setHours(ih || 0, im || 0, 0, 0);
    const lateMin = Math.max(0, Math.round((new Date(now) - startToday) / 60000));

    if (existing) db.prepare('UPDATE attendance SET check_in = ?, status = ?, late_minutes = ? WHERE id = ?').run(now, 'present', lateMin, existing.id);
    else db.prepare('INSERT INTO attendance (employee_id, date, check_in, status, late_minutes) VALUES (?, ?, ?, ?, ?)').run(empId, date, now, 'present', lateMin);
    res.json({ ok: true, checkIn: now, lateMinutes: lateMin });
  } catch (err) {
    console.error('Error checking in:', err);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

router.post('/check-out', requireLogin, (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const date = todayStr();
    const row = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, date);
    if (!row || !row.check_in) return res.status(400).json({ error: 'Please clock in first.' });
    if (row.check_out) return res.status(400).json({ error: 'You have already clocked out today.' });
    const now = new Date().toISOString();
    const hours = (new Date(now) - new Date(row.check_in)) / 36e5;
    const status = statusForHours(hours);
    const full = Number(getSettings().fullDayHours || 9);
    const ot = +Math.max(0, hours - full).toFixed(2);
    db.prepare('UPDATE attendance SET check_out = ?, work_hours = ?, status = ?, ot_hours = ? WHERE id = ?').run(now, +hours.toFixed(2), status, ot, row.id);
    res.json({ ok: true, checkOut: now, workHours: +hours.toFixed(2), status, otHours: ot });
  } catch (err) {
    console.error('Error checking out:', err);
    res.status(500).json({ error: 'Failed to check out' });
  }
});

// Logged-in employee's history.
router.get('/my', requireLogin, (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const month = req.query.month;

    // Validate month format if provided (YYYY-MM)
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }

    const rows = month
      ? db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? ORDER BY date DESC').all(empId, `${month}-%`)
      : db.prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date DESC LIMIT 60').all(empId);
    res.json({ attendance: rows });
  } catch (err) {
    console.error('Error fetching attendance:', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Who is present / absent / on leave for a date (HR/Finance/Super = all; Manager = team).
router.get('/day', requireLogin, (req, res) => {
  const role = req.session.user.role;
  const viewAll = can(role, 'attendance:viewAll');
  const viewTeam = can(role, 'attendance:viewTeam');
  if (!viewAll && !viewTeam) return res.status(403).json({ error: 'No access.' });

  const date = req.query.date || todayStr();
  let employees;
  if (viewAll) employees = db.prepare("SELECT * FROM employees WHERE status='active' ORDER BY name").all();
  else {
    const ids = teamEmployeeIds(req);
    employees = ids.length ? db.prepare(`SELECT * FROM employees WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`).all(...ids) : [];
  }

  const att = db.prepare('SELECT * FROM attendance WHERE date = ?').all(date);
  const attMap = {}; for (const a of att) attMap[a.employee_id] = a;
  const leaves = db.prepare("SELECT employee_id FROM leave_requests WHERE status='approved' AND from_date <= ? AND to_date >= ?").all(date, date);
  const onLeave = new Set(leaves.map((l) => l.employee_id));
  const holiday = db.prepare('SELECT name FROM holidays WHERE date = ?').get(date);

  const list = employees.map((e) => {
    const a = attMap[e.id];
    let status = 'absent';
    if (a && a.status) status = a.status;          // stored status (incl. imported)
    else if (a && a.check_in) status = 'present';
    else if (onLeave.has(e.id)) status = 'leave';
    else if (holiday) status = 'holiday';
    return { id: e.id, name: e.name, emp_code: e.emp_code, department: e.department, status, check_in: a ? a.check_in : null, check_out: a ? a.check_out : null, work_hours: a ? a.work_hours : null };
  });
  const summary = { present: 0, half: 0, leave: 0, absent: 0, holiday: 0 };
  for (const l of list) summary[l.status] = (summary[l.status] || 0) + 1;
  res.json({ date, summary, list, holiday: holiday ? holiday.name : null });
});

// Create or edit an attendance record (HR/Super; Manager for own team).
// Accepts optional check_in / check_out as "HH:MM".
router.post('/mark', requirePerm('attendance:correct'), (req, res) => {
  try {
    const { employee_id, date, status } = req.body || {};
    if (!employee_id || !date || !status) return res.status(400).json({ error: 'employee_id, date, status required' });
    if (!canActOnEmployee(req, employee_id)) return res.status(403).json({ error: 'Not in your team.' });

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const ci = req.body.check_in ? `${date}T${req.body.check_in}:00` : null;
    const co = req.body.check_out ? `${date}T${req.body.check_out}:00` : null;
    let hours = 0;
    if (ci && co) hours = +(((new Date(co) - new Date(ci)) / 36e5) || 0).toFixed(2);

    // Use transaction for atomic read-modify-write
    const transaction = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employee_id, date);
      if (existing) {
        db.prepare('UPDATE attendance SET status = ?, check_in = ?, check_out = ?, work_hours = ? WHERE id = ?')
          .run(status, ci, co, hours, existing.id);
      } else {
        db.prepare('INSERT INTO attendance (employee_id, date, status, check_in, check_out, work_hours) VALUES (?, ?, ?, ?, ?, ?)')
          .run(employee_id, date, status, ci, co, hours);
      }
    });

    transaction();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error marking attendance:', err);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// Delete an attendance record.
router.post('/delete', requirePerm('attendance:correct'), (req, res) => {
  try {
    const { employee_id, date } = req.body || {};
    if (!employee_id || !date) return res.status(400).json({ error: 'employee_id and date required' });
    if (!canActOnEmployee(req, employee_id)) return res.status(403).json({ error: 'Not in your team.' });

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    db.prepare('DELETE FROM attendance WHERE employee_id = ? AND date = ?').run(employee_id, date);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting attendance:', err);
    res.status(500).json({ error: 'Failed to delete attendance' });
  }
});

// Sync attendance from a Google Sheet / CSV link.
router.post('/sync', requirePerm('attendance:viewAll'), async (req, res) => {
  try {
    if (req.body && req.body.url) saveSettings({ attendanceSheetUrl: String(req.body.url).trim() });
    const result = await syncFromUrl(req.body && req.body.url);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Sync attendance from the configured Slack channel for a date.
router.post('/slack-sync', requirePerm('attendance:viewAll'), async (req, res) => {
  const date = (req.body && req.body.date) || todayStr();
  try {
    const result = await syncFromSlack(date);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Sync attendance from an uploaded Excel/CSV file.
router.post('/sync-file', requirePerm('attendance:viewAll'), memoryUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = syncFromBuffer(req.file.buffer);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: 'Could not read the file. Please upload an .xlsx, .xls or .csv file. (' + e.message + ')' });
  }
});

// ---- Attendance correction requests ---------------------------------------

const CORRECTION_TYPES = {
  missed_punch:   { label: 'Missed Punch',       icon: '👊', desc: 'Forgot to clock in or clock out' },
  regularization: { label: 'Regularization',     icon: '📋', desc: 'Working hours need to be updated' },
  wfh:            { label: 'Work From Home',      icon: '🏠', desc: 'Was working from home that day' },
  late_arrival:   { label: 'Late Arrival',        icon: '⏰', desc: 'Arrived late due to valid reason' },
  early_departure:{ label: 'Early Departure',     icon: '🚪', desc: 'Left early due to valid reason' },
  on_duty:        { label: 'On Duty / Travel',    icon: '✈️', desc: 'Was on official duty or travel' },
  half_day:       { label: 'Half Day',            icon: '🌓', desc: 'Only worked half a day' },
};

// Employee submits a correction request.
router.post('/correction', requireLogin, async (req, res) => {
  const empId = myEmpId(req, res); if (!empId) return;
  const { date, type, requested_status, requested_in, requested_out, reason } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Date is required.' });
  if (!requested_status) return res.status(400).json({ error: 'Please select what status to mark.' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason is required.' });

  // Don't allow duplicate pending requests for same date
  const existing = db.prepare("SELECT id FROM attendance_corrections WHERE employee_id = ? AND date = ? AND status = 'pending'").get(empId, date);
  if (existing) return res.status(400).json({ error: 'You already have a pending request for this date.' });

  const corrType = CORRECTION_TYPES[type] ? type : 'regularization';
  const r = db.prepare(
    'INSERT INTO attendance_corrections (employee_id, date, type, requested_status, requested_in, requested_out, reason) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(empId, date, corrType, requested_status, requested_in || null, requested_out || null, reason.trim());

  // Notify approver
  const emp = db.prepare('SELECT name, email, manager_id FROM employees WHERE id = ?').get(empId);
  const typeInfo = CORRECTION_TYPES[corrType];
  let approverEmails = [];
  if (emp && emp.manager_id) {
    const mgr = db.prepare('SELECT email FROM employees WHERE id = ?').get(emp.manager_id);
    if (mgr && mgr.email) approverEmails.push(mgr.email);
  }
  const hrAdmins = db.prepare("SELECT u.email FROM users u WHERE u.role IN ('SUPER_ADMIN','HR_ADMIN') AND u.email IS NOT NULL").all();
  for (const a of hrAdmins) if (a.email && !approverEmails.includes(a.email)) approverEmails.push(a.email);

  if (approverEmails.length) {
    await sendMail({
      to: approverEmails.join(','),
      subject: `${typeInfo.icon} Attendance Request: ${emp ? emp.name : ''} — ${date}`,
      html: `
        <p><strong>${emp ? emp.name : 'An employee'}</strong> has raised an attendance request.</p>
        <div style="background:#f0f9ff;padding:14px;border-radius:8px;border-left:4px solid #0ea5e9;margin:12px 0">
          <p style="margin:0 0 6px"><strong>Type:</strong> ${typeInfo.icon} ${typeInfo.label}</p>
          <p style="margin:0 0 6px"><strong>Date:</strong> ${date}</p>
          <p style="margin:0 0 6px"><strong>Requested Status:</strong> ${requested_status}</p>
          ${requested_in ? `<p style="margin:0 0 6px"><strong>Clock In:</strong> ${requested_in}</p>` : ''}
          ${requested_out ? `<p style="margin:0 0 6px"><strong>Clock Out:</strong> ${requested_out}</p>` : ''}
          <p style="margin:0"><strong>Reason:</strong> ${reason}</p>
        </div>
        <p>Please review and approve or reject this request in the HR portal.</p>
      `
    }).catch(e => console.error('Notification email failed:', e));
  }

  res.json({ id: r.lastInsertRowid });
});

// Employee cancels their own PENDING request.
router.delete('/corrections/:id', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.status(403).json({ error: 'No employee profile.' });
  const c = db.prepare('SELECT * FROM attendance_corrections WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found.' });
  if (c.employee_id !== empId) return res.status(403).json({ error: 'Not your request.' });
  if (c.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be cancelled.' });
  db.prepare('DELETE FROM attendance_corrections WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Employee's own correction requests.
router.get('/corrections/my', requireLogin, (req, res) => {
  const empId = myEmpId(req, res); if (!empId) return;
  res.json({ corrections: db.prepare('SELECT * FROM attendance_corrections WHERE employee_id = ? ORDER BY applied_at DESC LIMIT 30').all(empId) });
});

// Pending/all corrections for approvers (HR/Super = all; Manager = team).
router.get('/corrections', requirePerm('attendance:correct'), (req, res) => {
  const role = req.session.user.role;
  const base = `SELECT c.*, e.name AS employee_name, e.emp_code, e.department FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id`;
  let rows;
  if (role === 'MANAGER') {
    const ids = teamEmployeeIds(req);
    rows = ids.length ? db.prepare(base + ` WHERE c.employee_id IN (${ids.map(() => '?').join(',')}) ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.applied_at DESC`).all(...ids) : [];
  } else {
    rows = db.prepare(base + " ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.applied_at DESC").all();
  }
  res.json({ corrections: rows });
});

// Approve / reject a correction.
router.post('/corrections/:id/decision', requirePerm('attendance:correct'), async (req, res) => {
  const { decision, comment } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });
  const c = db.prepare('SELECT * FROM attendance_corrections WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!canActOnEmployee(req, c.employee_id)) return res.status(403).json({ error: 'Not in your team.' });

  db.prepare("UPDATE attendance_corrections SET status = ?, comment = ?, approver_id = ?, decided_at = datetime('now') WHERE id = ?")
    .run(decision, comment || '', req.session.user.id, c.id);

  if (decision === 'approved') {
    const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(c.employee_id, c.date);
    const ci = c.requested_in ? `${c.date}T${c.requested_in}:00` : (existing ? existing.check_in : null);
    const co = c.requested_out ? `${c.date}T${c.requested_out}:00` : (existing ? existing.check_out : null);
    if (existing) db.prepare('UPDATE attendance SET status = ?, check_in = ?, check_out = ? WHERE id = ?').run(c.requested_status, ci, co, existing.id);
    else db.prepare('INSERT INTO attendance (employee_id, date, status, check_in, check_out) VALUES (?, ?, ?, ?, ?)').run(c.employee_id, c.date, c.requested_status, ci, co);
  }

  const emp = db.prepare('SELECT name, email FROM employees WHERE id = ?').get(c.employee_id);
  const typeInfo = CORRECTION_TYPES[c.type] || CORRECTION_TYPES.regularization;
  if (emp && emp.email) {
    const isApproved = decision === 'approved';
    await sendMail({
      to: emp.email,
      subject: `${isApproved ? '✅' : '❌'} Attendance Request ${isApproved ? 'Approved' : 'Rejected'} — ${c.date}`,
      html: `
        <p>Hi <strong>${emp.name}</strong>,</p>
        <p>Your attendance request has been <strong>${decision}</strong>.</p>
        <div style="background:${isApproved ? '#f0fdf4' : '#fef2f2'};padding:14px;border-radius:8px;border-left:4px solid ${isApproved ? '#22c55e' : '#ef4444'};margin:12px 0">
          <p style="margin:0 0 6px"><strong>Type:</strong> ${typeInfo.icon} ${typeInfo.label}</p>
          <p style="margin:0 0 6px"><strong>Date:</strong> ${c.date}</p>
          <p style="margin:0 0 6px"><strong>Status:</strong> ${isApproved ? '✅ Approved — attendance updated' : '❌ Rejected'}</p>
          ${comment ? `<p style="margin:0"><strong>Comment:</strong> ${comment}</p>` : ''}
        </div>
        ${isApproved ? '<p>Your attendance record for this date has been updated accordingly.</p>' : '<p>If you have questions, please speak to your manager or HR.</p>'}
      `,
    });
  }
  res.json({ ok: true });
});

module.exports = router;
// Exposed for tests.
module.exports.statusForHours = statusForHours;
module.exports.clockInCutoff = clockInCutoff;
