const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, teamEmployeeIds, canActOnEmployee } = require('../middleware/auth');
const { notifyUsers } = require('../services/notify');

const router = express.Router();

function myEmpId(req, res) {
  const id = req.session.user.employeeId;
  if (!id) { res.status(400).json({ error: 'Your login is not linked to an employee profile.' }); return null; }
  return id;
}
// Monday of the week containing `iso`.
function weekStart(iso) {
  const d = new Date((iso || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---- Projects -------------------------------------------------------------
router.get('/projects', requireLogin, async (req, res) => {
  try {
    const all = req.query.all === '1';
    const rows = await db.prepare(
      `SELECT * FROM projects ${all ? '' : "WHERE status='active'"} ORDER BY status, name`
    ).all();
    res.json({ projects: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/projects', requirePerm('timesheets:approve'), async (req, res) => {
  try {
    const { name, code, client, billable } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required.' });
    const r = await db.prepare('INSERT INTO projects (name, code, client, billable, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), code || null, client || null, billable === false ? 0 : 1, req.session.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/projects/:id', requirePerm('timesheets:approve'), async (req, res) => {
  try {
    const p = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found.' });
    const b = req.body || {};
    await db.prepare('UPDATE projects SET name=?, code=?, client=?, billable=?, status=? WHERE id=?').run(
      b.name != null ? b.name : p.name, b.code != null ? b.code : p.code, b.client != null ? b.client : p.client,
      b.billable != null ? (b.billable ? 1 : 0) : p.billable, b.status || p.status, p.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/projects/:id', requirePerm('timesheets:approve'), async (req, res) => {
  try {
    const used = await db.prepare('SELECT COUNT(*) AS c FROM timesheet_entries WHERE project_id = ?').get(req.params.id);
    if (Number(used.c) > 0) {
      await db.prepare("UPDATE projects SET status='archived' WHERE id=?").run(req.params.id);
      return res.json({ ok: true, archived: true });
    }
    await db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- My timesheet ---------------------------------------------------------
// GET /mine?week=YYYY-MM-DD  (any day in the week) -> that week's entries + totals
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const start = weekStart(req.query.week);
    const end = addDays(start, 6);
    const rows = await db.prepare(
      `SELECT t.*, p.name AS project_name, p.code AS project_code
       FROM timesheet_entries t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.employee_id = ? AND t.date >= ? AND t.date <= ? ORDER BY t.date, t.id`
    ).all(empId, start, end);
    const total = rows.reduce((a, r) => a + Number(r.hours || 0), 0);
    const billable = rows.filter((r) => r.billable).reduce((a, r) => a + Number(r.hours || 0), 0);
    res.json({ weekStart: start, weekEnd: end, entries: rows, totalHours: +total.toFixed(2), billableHours: +billable.toFixed(2) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/entry', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const { project_id, date, hours, task, billable, notes } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'A valid date is required.' });
    // Time entries are a record of work done: no future dates, and nothing older than 30 days.
    const todayISO = new Date().toISOString().slice(0, 10);
    if (date > todayISO) return res.status(400).json({ error: "You can't log time for a future date." });
    const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    if (date < monthAgo) return res.status(400).json({ error: 'Time entries older than 30 days are locked. Ask HR if you need a correction.' });
    if (typeof hours === 'string' && !/^\d+(\.\d+)?$/.test(hours.trim())) return res.status(400).json({ error: 'Hours must be a number between 0 and 24.' });
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0 || h > 24) return res.status(400).json({ error: 'Hours must be between 0 and 24.' });
    const r = await db.prepare(
      'INSERT INTO timesheet_entries (employee_id, project_id, date, hours, task, billable, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(empId, project_id || null, date, h, task || null, billable === false ? 0 : 1, notes || null, 'draft');
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/entry/:id', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const t = await db.prepare('SELECT * FROM timesheet_entries WHERE id = ?').get(req.params.id);
    if (!t || t.employee_id !== empId) return res.status(404).json({ error: 'Not found.' });
    if (t.status === 'submitted' || t.status === 'approved') return res.status(400).json({ error: 'This entry is locked (already submitted).' });
    const b = req.body || {};
    const h = b.hours != null ? Number(b.hours) : t.hours;
    if (!(h > 0) || h > 24) return res.status(400).json({ error: 'Hours must be between 0 and 24.' });
    await db.prepare('UPDATE timesheet_entries SET project_id=?, hours=?, task=?, billable=?, notes=?, status=? WHERE id=?').run(
      b.project_id !== undefined ? (b.project_id || null) : t.project_id, h,
      b.task != null ? b.task : t.task, b.billable != null ? (b.billable ? 1 : 0) : t.billable,
      b.notes != null ? b.notes : t.notes, 'draft', t.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/entry/:id', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const t = await db.prepare('SELECT * FROM timesheet_entries WHERE id = ?').get(req.params.id);
    if (!t || t.employee_id !== empId) return res.status(404).json({ error: 'Not found.' });
    if (t.status === 'submitted' || t.status === 'approved') return res.status(400).json({ error: 'This entry is locked (already submitted).' });
    await db.prepare('DELETE FROM timesheet_entries WHERE id = ?').run(t.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Submit a week for approval (all draft/rejected entries in the week).
router.post('/submit', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const start = weekStart(req.body && req.body.week);
    const end = addDays(start, 6);
    const n = await db.prepare(
      "UPDATE timesheet_entries SET status='submitted' WHERE employee_id=? AND date>=? AND date<=? AND status IN ('draft','rejected')"
    ).run(empId, start, end);
    // Notify approver(s): manager + HR.
    const emp = await db.prepare('SELECT name, manager_id FROM employees WHERE id = ?').get(empId);
    const ids = [];
    if (emp && emp.manager_id) {
      const mgr = await db.prepare('SELECT user_id FROM employees WHERE id = ?').get(emp.manager_id);
      if (mgr && mgr.user_id) ids.push(mgr.user_id);
    }
    const hr = await db.prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN','HR_ADMIN')").all();
    for (const h of hr) ids.push(h.id);
    await notifyUsers([...new Set(ids)], {
      type: 'timesheet',
      title: `Timesheet submitted: ${emp ? emp.name : 'Employee'}`,
      body: `Week of ${start} is awaiting your approval.`,
      link: '#/timesheet-approvals',
    });
    res.json({ ok: true, submitted: n.changes != null ? n.changes : undefined, weekStart: start });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Approvals (manager/HR) ----------------------------------------------
// Submitted entries grouped by employee+week.
router.get('/', requirePerm('timesheets:approve'), async (req, res) => {
  try {
    const role = req.session.user.role;
    const status = req.query.status || 'submitted';
    let where = 't.status = ?'; const params = [status];
    if (role === 'MANAGER') {
      const ids = await teamEmployeeIds(req);
      if (!ids.length) return res.json({ groups: [] });
      where += ` AND t.employee_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
    const rows = await db.prepare(
      `SELECT t.*, e.name AS employee_name, e.emp_code, p.name AS project_name
       FROM timesheet_entries t JOIN employees e ON e.id = t.employee_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE ${where} ORDER BY t.employee_id, t.date`
    ).all(...params);
    // group by employee + week.
    const groups = {};
    for (const r of rows) {
      const wk = weekStart(r.date);
      const key = r.employee_id + '|' + wk;
      if (!groups[key]) groups[key] = { employee_id: r.employee_id, employee_name: r.employee_name, emp_code: r.emp_code, weekStart: wk, entries: [], totalHours: 0, billableHours: 0, ids: [] };
      groups[key].entries.push(r);
      groups[key].ids.push(r.id);
      groups[key].totalHours += Number(r.hours || 0);
      if (r.billable) groups[key].billableHours += Number(r.hours || 0);
    }
    const list = Object.values(groups).map((g) => ({ ...g, totalHours: +g.totalHours.toFixed(2), billableHours: +g.billableHours.toFixed(2) }));
    res.json({ groups: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Approve / reject a set of entries (bulk).
router.post('/decision', requirePerm('timesheets:approve'), async (req, res) => {
  try {
    const { ids, decision, comment } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No entries selected.' });
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved or rejected' });
    // Verify the approver can act on each entry's employee.
    const rows = await db.prepare(`SELECT DISTINCT employee_id FROM timesheet_entries WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    for (const r of rows) {
      if (!(await canActOnEmployee(req, r.employee_id))) return res.status(403).json({ error: 'Some entries are outside your team.' });
    }
    await db.prepare(
      `UPDATE timesheet_entries SET status=?, approver_id=?, comment=?, decided_at=datetime('now') WHERE id IN (${ids.map(() => '?').join(',')}) AND status='submitted'`
    ).run(decision, req.session.user.id, comment || null, ...ids);
    // Notify each affected employee.
    for (const r of rows) {
      const emp = await db.prepare('SELECT user_id, name FROM employees WHERE id = ?').get(r.employee_id);
      if (emp && emp.user_id) {
        await notifyUsers([emp.user_id], {
          type: 'timesheet',
          title: `Timesheet ${decision} ${decision === 'approved' ? '✅' : '❌'}`,
          body: `Your submitted timesheet was ${decision}.${comment ? ' Comment: ' + comment : ''}`,
          link: '#/my-timesheet',
        });
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Summary report -------------------------------------------------------
router.get('/summary', requirePerm('timesheets:approve'), async (req, res) => {
  try {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : weekStart();
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : addDays(weekStart(), 6);
    const role = req.session.user.role;
    let teamFilter = ''; const params = [from, to];
    if (role === 'MANAGER') {
      const ids = await teamEmployeeIds(req);
      if (!ids.length) return res.json({ from, to, byProject: [], byEmployee: [], totals: { hours: 0, billable: 0 } });
      teamFilter = ` AND t.employee_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
    const rows = await db.prepare(
      `SELECT t.hours, t.billable, t.employee_id, t.project_id, e.name AS employee_name, p.name AS project_name
       FROM timesheet_entries t JOIN employees e ON e.id = t.employee_id LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.date >= ? AND t.date <= ? AND t.status='approved'${teamFilter}`
    ).all(...params);
    const byProject = {}, byEmployee = {};
    let totalHours = 0, totalBillable = 0;
    for (const r of rows) {
      const h = Number(r.hours || 0); totalHours += h; if (r.billable) totalBillable += h;
      const pk = r.project_name || 'No project';
      byProject[pk] = byProject[pk] || { project: pk, hours: 0, billable: 0 };
      byProject[pk].hours += h; if (r.billable) byProject[pk].billable += h;
      const ek = r.employee_name;
      byEmployee[ek] = byEmployee[ek] || { employee: ek, hours: 0, billable: 0 };
      byEmployee[ek].hours += h; if (r.billable) byEmployee[ek].billable += h;
    }
    const fix = (o) => Object.values(o).map((x) => ({ ...x, hours: +x.hours.toFixed(2), billable: +x.billable.toFixed(2) })).sort((a, b) => b.hours - a.hours);
    res.json({ from, to, byProject: fix(byProject), byEmployee: fix(byEmployee), totals: { hours: +totalHours.toFixed(2), billable: +totalBillable.toFixed(2) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
