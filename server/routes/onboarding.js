const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, canActOnEmployee } = require('../middleware/auth');
const { provisionAccountsForOnboarding, accountsForDepartment } = require('../services/accountSetup');
const {
  OWNERS, STAGES, buildJourney, rebuildJourney, syncAutomatedTasks, sendReminders,
} = require('../services/onboardingJourney');

const router = express.Router();

// Onboarding overview: every active employee with their checklist progress,
// newest joiners first. Powers the dedicated Onboarding section. Auto-keyed
// tasks are synced for in-flight hires so the numbers are always live.
router.get('/', requirePerm('employees:write'), (req, res) => {
  for (const e of db.prepare("SELECT id FROM employees WHERE status='active' AND COALESCE(onboarded,0)=0").all()) {
    try { syncAutomatedTasks(e.id); } catch (err) { /* keep overview resilient */ }
  }
  const rows = db.prepare(`
    SELECT e.id, e.name, e.department, e.designation, e.date_of_joining, e.status,
      e.onboarded, e.onboarded_at, e.onboarding_submitted, e.onboarding_submitted_at,
      (SELECT COUNT(*) FROM onboarding_tasks t WHERE t.employee_id = e.id) AS total,
      (SELECT COUNT(*) FROM onboarding_tasks t WHERE t.employee_id = e.id AND t.done = 1) AS done,
      (SELECT stage FROM onboarding_tasks t WHERE t.employee_id = e.id AND t.done = 0 ORDER BY t.position LIMIT 1) AS current_stage
    FROM employees e
    WHERE e.status = 'active'
    ORDER BY (e.date_of_joining IS NULL), e.date_of_joining DESC, e.id DESC
  `).all();
  res.json({ employees: rows });
});

// Mark several employees as already onboarded in one go. Body: { all: true }
// marks every active employee not yet onboarded; or { ids: [..] } for a subset.
// Defined before '/:employeeId' so "bulk-complete" isn't read as an id.
router.post('/bulk-complete', requirePerm('employees:write'), (req, res) => {
  const body = req.body || {};
  let ids;
  if (Array.isArray(body.ids) && body.ids.length) {
    ids = body.ids.map(Number).filter((n) => Number.isInteger(n));
  } else if (body.all) {
    ids = db.prepare("SELECT id FROM employees WHERE status = 'active' AND COALESCE(onboarded,0) = 0").all().map((r) => r.id);
  } else {
    return res.status(400).json({ error: 'Provide { all: true } or { ids: [...] }.' });
  }
  const upd = db.prepare("UPDATE employees SET onboarded = 1, onboarded_at = datetime('now') WHERE id = ?");
  let count = 0;
  for (const id of ids) count += upd.run(id).changes;
  res.json({ ok: true, count });
});

// View an employee's onboarding journey (self or manager/HR). Runs the
// automation first so self-completing tasks reflect the latest state.
router.get('/:employeeId', requireLogin, (req, res) => {
  if (!canActOnEmployee(req, req.params.employeeId)) return res.status(403).json({ error: 'No access.' });
  try { syncAutomatedTasks(req.params.employeeId); } catch (e) { /* non-fatal */ }
  const tasks = db.prepare('SELECT * FROM onboarding_tasks WHERE employee_id = ? ORDER BY position, id').all(req.params.employeeId);
  res.json({ tasks, owners: OWNERS, stages: STAGES });
});

// Run the automation on demand and report what it ticked off.
router.post('/:employeeId/sync', requirePerm('employees:write'), (req, res) => {
  res.json(syncAutomatedTasks(req.params.employeeId));
});

// Nudge each task owner about their pending onboarding tasks.
router.post('/:employeeId/remind', requirePerm('employees:write'), (req, res) => {
  res.json(sendReminders(req.params.employeeId, req.session.user.id));
});

// Rebuild the journey from scratch (wipes existing tasks).
router.post('/:employeeId/rebuild', requirePerm('employees:write'), (req, res) => {
  const added = rebuildJourney(req.params.employeeId);
  provisionAccountsForOnboarding(req.params.employeeId, req.session.user.id);
  syncAutomatedTasks(req.params.employeeId);
  res.json({ ok: true, added });
});

// Add a task (HR/employee-write).
router.post('/:employeeId', requirePerm('employees:write'), (req, res) => {
  const title = (req.body && req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Task title required.' });
  const max = db.prepare('SELECT COALESCE(MAX(position),0) m FROM onboarding_tasks WHERE employee_id = ?').get(req.params.employeeId).m;
  const r = db.prepare('INSERT INTO onboarding_tasks (employee_id, title, position) VALUES (?, ?, ?)').run(req.params.employeeId, title, max + 1);
  res.json({ id: r.lastInsertRowid });
});

// Start onboarding (HR): build the full automated journey, provision the
// department's accounts, and run the automation once.
router.post('/:employeeId/template', requirePerm('employees:write'), (req, res) => {
  const existing = db.prepare('SELECT COUNT(*) c FROM onboarding_tasks WHERE employee_id = ?').get(req.params.employeeId).c;
  if (existing) return res.status(400).json({ error: 'An onboarding journey already exists for this employee.' });
  const added = buildJourney(req.params.employeeId);
  const setup = provisionAccountsForOnboarding(req.params.employeeId, req.session.user.id);
  syncAutomatedTasks(req.params.employeeId);
  res.json({ ok: true, added, accountSetup: setup });
});

// What accounts does this employee's department require? (for the UI preview)
router.get('/:employeeId/account-setup', requireLogin, (req, res) => {
  if (!canActOnEmployee(req, req.params.employeeId)) return res.status(403).json({ error: 'No access.' });
  const emp = db.prepare('SELECT department FROM employees WHERE id = ?').get(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });
  res.json({ department: (emp.department || '').trim() || 'General', accounts: accountsForDepartment(emp.department) });
});

// Notify managers/IT to create the department's required accounts (HR action).
// Also drops "Create account: X" tasks onto the checklist. Idempotent + re-sendable.
router.post('/:employeeId/account-setup', requirePerm('employees:write'), (req, res) => {
  const result = provisionAccountsForOnboarding(req.params.employeeId, req.session.user.id);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// Mark a single employee as onboarded (complete) or reopen onboarding.
router.post('/:employeeId/complete', requirePerm('employees:write'), (req, res) => {
  const r = db.prepare("UPDATE employees SET onboarded = 1, onboarded_at = datetime('now') WHERE id = ?").run(req.params.employeeId);
  if (!r.changes) return res.status(404).json({ error: 'Employee not found.' });
  res.json({ ok: true });
});

router.post('/:employeeId/reopen', requirePerm('employees:write'), (req, res) => {
  const r = db.prepare('UPDATE employees SET onboarded = 0, onboarded_at = NULL WHERE id = ?').run(req.params.employeeId);
  if (!r.changes) return res.status(404).json({ error: 'Employee not found.' });
  res.json({ ok: true });
});

// Toggle a task done (self or HR).
router.put('/task/:id', requireLogin, (req, res) => {
  const t = db.prepare('SELECT * FROM onboarding_tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!canActOnEmployee(req, t.employee_id)) return res.status(403).json({ error: 'No access.' });
  db.prepare('UPDATE onboarding_tasks SET done = ? WHERE id = ?').run(req.body && req.body.done ? 1 : 0, t.id);
  res.json({ ok: true });
});

router.delete('/task/:id', requirePerm('employees:write'), (req, res) => {
  db.prepare('DELETE FROM onboarding_tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
