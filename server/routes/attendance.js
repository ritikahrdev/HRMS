const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, teamEmployeeIds, canActOnEmployee } = require('../middleware/auth');
const { can } = require('../services/permissions');
const { getSettings, saveSettings } = require('../services/settings');
const { sendMail } = require('../services/email');
const { syncFromUrl, syncFromBuffer } = require('../services/attendanceSync');
const { syncFromSlack, classifyMessage } = require('../services/slackSync');
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

// The latest time an employee may mark attendance today.
// Flexible hours by default: if no explicit "attendanceCloseTime" (HH:MM) is
// set, the window stays open all day. Set a close time to enforce a cut-off.
function clockInCutoff() {
  const s = getSettings();
  const grace = Number(s.graceMinutes != null ? s.graceMinutes : 30);
  const cutoff = new Date();
  const close = String(s.attendanceCloseTime || '').trim();
  let allDay = false;
  if (/^\d{1,2}:\d{2}$/.test(close)) {
    const [ch, cm] = close.split(':').map(Number);
    cutoff.setHours(ch || 0, cm || 0, 0, 0);
  } else {
    // No close time configured -> open all day (flexible hours).
    cutoff.setHours(23, 59, 59, 999);
    allDay = true;
  }
  const label = `${pad(cutoff.getHours())}:${pad(cutoff.getMinutes())}`;
  return { cutoff, label, grace, allDay };
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
  const { cutoff, label, allDay } = clockInCutoff();
  res.json({
    date: todayStr(),
    attendance: row || null,
    window: { open: new Date() <= cutoff, cutoff: label, allDay },
  });
});

router.post('/check-in', requireLogin, (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const date = todayStr();
    const existing = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(empId, date);
    if (existing && existing.check_in) return res.status(400).json({ error: 'You have already clocked in today.' });

    const { cutoff, label, allDay } = clockInCutoff();
    if (new Date() > cutoff) {
      return res.status(400).json({
        error: `The attendance window closed at ${label}. Please raise an attendance request for the admin to approve.`,
        windowClosed: true,
      });
    }

    const now = new Date().toISOString();
    // Marking is allowed all day, but anyone who marks after shift start + grace
    // (e.g. 10:00 + 30 = 10:30) is flagged late. late_minutes = minutes past the
    // shift start time; 0 if marked within the grace window.
    const s = getSettings();
    const [ih, im] = String(s.workStart || '10:00').split(':').map(Number);
    const grace = Number(s.graceMinutes != null ? s.graceMinutes : 30);
    const shiftStart = new Date(); shiftStart.setHours(ih || 0, im || 0, 0, 0);
    const graceCutoff = new Date(shiftStart.getTime() + grace * 60000);
    let lateMin = 0;
    if (new Date(now) > graceCutoff) {
      lateMin = Math.max(0, Math.round((new Date(now) - shiftStart) / 60000));
    }

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
    return { id: e.id, name: e.name, emp_code: e.emp_code, department: e.department, status, wfh: a ? (a.wfh || 0) : 0, source: a ? a.source : null, check_in: a ? a.check_in : null, check_out: a ? a.check_out : null, work_hours: a ? a.work_hours : null, late_minutes: a ? (a.late_minutes || 0) : 0, marked: !!(a && a.check_in) };
  });
  const summary = { present: 0, half: 0, leave: 0, absent: 0, holiday: 0 };
  for (const l of list) summary[l.status] = (summary[l.status] || 0) + 1;
  res.json({ date, summary, list, holiday: holiday ? holiday.name : null });
});

// Analyse one month for a fixed set of employees. Returns rich aggregates.
function analyseMonth(month, employees) {
  const [y, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const todayISO = todayStr();
  const activeIds = new Set(employees.map((e) => e.id));
  const activeCount = employees.length;
  const byId = {}; for (const e of employees) byId[e.id] = e;

  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${pad(daysInMonth)}`;
  const att = db.prepare('SELECT employee_id, date, status, check_in, work_hours, late_minutes FROM attendance WHERE date >= ? AND date <= ?').all(monthStart, monthEnd);
  const leaves = db.prepare("SELECT employee_id, from_date, to_date FROM leave_requests WHERE status='approved' AND from_date <= ? AND to_date >= ?").all(monthEnd, monthStart);
  const holidays = db.prepare('SELECT date, name FROM holidays WHERE date >= ? AND date <= ?').all(monthStart, monthEnd);
  const holidayByDate = {}; for (const h of holidays) holidayByDate[h.date] = h.name;

  const attByDate = {};
  for (const a of att) {
    if (!activeIds.has(a.employee_id)) continue;
    (attByDate[a.date] = attByDate[a.date] || []).push(a);
  }

  // Punctuality cutoff = shift start + grace.
  const s = getSettings();
  const [sh, sm] = String(s.workStart || '10:00').split(':').map(Number);
  const grace = Number(s.graceMinutes != null ? s.graceMinutes : 30);
  const cutoffMin = (sh || 0) * 60 + (sm || 0) + grace;

  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [];
  // Per-employee tallies.
  const per = {};
  for (const e of employees) per[e.id] = { id: e.id, name: e.name, department: e.department || '', present: 0, half: 0, leave: 0, absent: 0, late: 0 };

  let totalPresent = 0, totalHalf = 0, totalLeave = 0, totalAbsent = 0, workingDays = 0, rateSum = 0;
  const dowRate = {}; const dowCount = {};
  let lateCount = 0, onTimeCount = 0, lateMinSum = 0, workHoursSum = 0, workHoursCount = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${pad(d)}`;
    const dow = new Date(y, mo - 1, d).getDay();
    const isFuture = date > todayISO;
    const holidayName = holidayByDate[date] || null;

    const rows = attByDate[date] || [];
    const markedPresent = new Set(), markedHalf = new Set(), markedLeave = new Set();
    for (const a of rows) {
      if (a.status === 'half') markedHalf.add(a.employee_id);
      else if (a.status === 'leave') markedLeave.add(a.employee_id);
      else if (a.status === 'present' || a.check_in) markedPresent.add(a.employee_id);
    }
    for (const l of leaves) {
      if (date >= l.from_date && date <= l.to_date && activeIds.has(l.employee_id)) markedLeave.add(l.employee_id);
    }
    const present = markedPresent.size, half = markedHalf.size, leave = markedLeave.size;
    const marked = present + half + leave;

    let type, absent = 0, rate = null;
    if (isFuture) { type = 'future'; }
    else if (holidayName) { type = 'holiday'; }
    else if (marked === 0) { type = 'off'; }
    else {
      type = 'working';
      absent = Math.max(0, activeCount - marked);
      rate = activeCount ? +(((present + 0.5 * half) / activeCount) * 100).toFixed(1) : null;
      workingDays++;
      totalPresent += present; totalHalf += half; totalLeave += leave; totalAbsent += absent;
      if (rate != null) { rateSum += rate; dowRate[dow] = (dowRate[dow] || 0) + rate; dowCount[dow] = (dowCount[dow] || 0) + 1; }

      // Per-employee + punctuality + work hours.
      for (const e of employees) {
        const p = per[e.id];
        if (markedHalf.has(e.id)) p.half++;
        else if (markedLeave.has(e.id)) p.leave++;
        else if (markedPresent.has(e.id)) p.present++;
        else p.absent++;
      }
      for (const a of rows) {
        if (!activeIds.has(a.employee_id)) continue;
        if (a.late_minutes != null && (a.status === 'present' || a.check_in)) {
          if (a.late_minutes > grace) { lateCount++; lateMinSum += a.late_minutes; per[a.employee_id] && per[a.employee_id].late++; }
          else onTimeCount++;
        }
        if (a.work_hours && a.work_hours > 0) { workHoursSum += a.work_hours; workHoursCount++; }
      }
    }
    days.push({ date, day: d, dow, dowName: dows[dow], type, present, half, leave, absent, rate, holiday: holidayName, isFuture });
  }

  const avgRate = workingDays ? +(rateSum / workingDays).toFixed(1) : null;
  const perList = Object.values(per).map((p) => {
    const denom = workingDays || 1;
    p.rate = workingDays ? +(((p.present + 0.5 * p.half) / denom) * 100).toFixed(1) : null;
    return p;
  });

  return {
    month, daysInMonth, firstDow: new Date(y, mo - 1, 1).getDay(), activeCount, days, perList,
    avgRate, totalPresent, totalHalf, totalLeave, totalAbsent, workingDays,
    dowRate, dowCount, dows,
    punctuality: {
      late: lateCount, onTime: onTimeCount,
      onTimeRate: (lateCount + onTimeCount) ? +((onTimeCount / (lateCount + onTimeCount)) * 100).toFixed(1) : null,
      avgLateMin: lateCount ? Math.round(lateMinSum / lateCount) : 0,
    },
    avgWorkHours: workHoursCount ? +(workHoursSum / workHoursCount).toFixed(1) : null,
  };
}

// Monthly attendance insights: calendar + rich analytics.
// ?month=YYYY-MM  (HR/Super = all; Manager = own team)
router.get('/insights', requireLogin, (req, res) => {
  const role = req.session.user.role;
  const viewAll = can(role, 'attendance:viewAll');
  const viewTeam = can(role, 'attendance:viewTeam');
  if (!viewAll && !viewTeam) return res.status(403).json({ error: 'No access.' });

  const month = req.query.month && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : todayStr().slice(0, 7);

  let employees;
  if (viewAll) employees = db.prepare("SELECT id, name, emp_code, department FROM employees WHERE status='active'").all();
  else {
    const ids = teamEmployeeIds(req);
    employees = ids.length ? db.prepare(`SELECT id, name, emp_code, department FROM employees WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  }

  const cur = analyseMonth(month, employees);

  // Previous month (for trend comparison).
  const [py, pmo] = month.split('-').map(Number);
  const prevD = new Date(py, pmo - 2, 1);
  const prevMonth = `${prevD.getFullYear()}-${pad(prevD.getMonth() + 1)}`;
  const prev = analyseMonth(prevMonth, employees);

  // Best/worst day.
  const wd = cur.days.filter((x) => x.type === 'working' && x.rate != null);
  const best = wd.slice().sort((a, b) => b.rate - a.rate)[0] || null;
  const worst = wd.slice().sort((a, b) => a.rate - b.rate)[0] || null;

  // Attendance by weekday.
  const byWeekday = [];
  for (let i = 0; i < 7; i++) if (cur.dowCount[i]) byWeekday.push({ dow: i, name: cur.dows[i], avgRate: +(cur.dowRate[i] / cur.dowCount[i]).toFixed(1) });

  // Department breakdown (avg per-employee rate, grouped by dept).
  const deptMap = {};
  for (const p of cur.perList) {
    if (p.rate == null) continue;
    const key = p.department || 'No Department';
    (deptMap[key] = deptMap[key] || []).push(p.rate);
  }
  const byDepartment = Object.entries(deptMap)
    .map(([dept, rates]) => ({ department: dept, avgRate: +(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1), employees: rates.length }))
    .sort((a, b) => b.avgRate - a.avgRate);

  // Leaderboards.
  const ranked = cur.perList.filter((p) => p.rate != null);
  const topAttendees = ranked.slice().sort((a, b) => b.rate - a.rate || a.absent - b.absent).slice(0, 8);
  const topAbsentees = ranked.filter((p) => p.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 8);
  const perfectCount = ranked.filter((p) => p.rate >= 100).length;

  // Status distribution (for a donut/share view).
  const totalMarks = cur.totalPresent + cur.totalHalf + cur.totalLeave + cur.totalAbsent;
  const distribution = {
    present: cur.totalPresent, half: cur.totalHalf, leave: cur.totalLeave, absent: cur.totalAbsent,
    presentPct: totalMarks ? Math.round((cur.totalPresent / totalMarks) * 100) : 0,
    halfPct: totalMarks ? Math.round((cur.totalHalf / totalMarks) * 100) : 0,
    leavePct: totalMarks ? Math.round((cur.totalLeave / totalMarks) * 100) : 0,
    absentPct: totalMarks ? Math.round((cur.totalAbsent / totalMarks) * 100) : 0,
  };

  res.json({
    month, daysInMonth: cur.daysInMonth, firstDow: cur.firstDow, activeCount: cur.activeCount,
    days: cur.days,
    stats: {
      avgRate: cur.avgRate, totalPresent: cur.totalPresent, totalHalf: cur.totalHalf,
      totalLeave: cur.totalLeave, totalAbsent: cur.totalAbsent, workingDays: cur.workingDays,
      best, worst,
      prevAvgRate: prev.avgRate,
      rateDelta: (cur.avgRate != null && prev.avgRate != null) ? +(cur.avgRate - prev.avgRate).toFixed(1) : null,
      avgWorkHours: cur.avgWorkHours,
      perfectCount,
    },
    punctuality: cur.punctuality,
    distribution,
    byWeekday,
    byDepartment,
    topAttendees,
    topAbsentees,
  });
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

// Preview how a Slack message would be classified (for testing keywords).
router.get('/slack-preview', requirePerm('attendance:viewAll'), (req, res) => {
  const text = String(req.query.text || '');
  const slack = getSettings().slack || {};
  const cls = classifyMessage(text, slack);
  res.json({ text, ...cls });
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
  const { type, requested_status, requested_in, requested_out, reason } = req.body || {};
  // Attendance requests can only be raised for the present day.
  const date = todayStr();
  if (req.body && req.body.date && req.body.date !== date) {
    return res.status(400).json({ error: 'Attendance requests can only be raised for the present day.' });
  }
  if (!requested_status) return res.status(400).json({ error: 'Please select what status to mark.' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason is required.' });

  // Don't allow duplicate pending requests for today
  const existing = db.prepare("SELECT id FROM attendance_corrections WHERE employee_id = ? AND date = ? AND status = 'pending'").get(empId, date);
  if (existing) return res.status(400).json({ error: 'You already have a pending request for today.' });

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

  // Approvals are same-day only: a request can only be approved on its own day.
  if (decision === 'approved' && c.date !== todayStr()) {
    return res.status(400).json({ error: `This request was for ${c.date} and can only be approved on the same day. It has expired — please reject it.` });
  }

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
