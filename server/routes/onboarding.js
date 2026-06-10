const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { requireLogin, requirePerm, canActOnEmployee } = require('../middleware/auth');
const { provisionAccountsForOnboarding, accountsForDepartment } = require('../services/accountSetup');
const { createEmployee } = require('../services/employees');
const {
  OWNERS, STAGES, buildJourney, rebuildJourney, syncAutomatedTasks, sendReminders,
} = require('../services/onboardingJourney');

const router = express.Router();

// Build the public pre-boarding URL for a token.
function preboardUrl(req, token) {
  const base = (config.publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/preboard/${token}`;
}

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

// Create a pre-hire (a candidate, with NO company login yet), build their
// onboarding journey, and hand back a private pre-boarding link to share.
// Defined before '/:employeeId' so "preboard" isn't read as an id.
router.post('/preboard', requirePerm('employees:write'), (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Candidate name is required.' });
  try {
    const { employee } = createEmployee({
      name,
      department: b.department || '',
      designation: b.designation || '',
      date_of_joining: b.date_of_joining || '',
    }, { createLogin: false });
    const extra = {};
    if (b.personal_email) extra.personal_email = String(b.personal_email).trim();
    if (b.phone) extra.phone = String(b.phone).trim();
    if (Object.keys(extra).length) {
      const setClause = Object.keys(extra).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE employees SET ${setClause} WHERE id = @id`).run({ ...extra, id: employee.id });
    }
    db.prepare('UPDATE employees SET onboarded = 0, onboarded_at = NULL, onboarding_submitted = 0, onboarding_submitted_at = NULL WHERE id = ?').run(employee.id);
    buildJourney(employee.id);
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE employees SET preboard_token = ? WHERE id = ?').run(token, employee.id);
    res.json({ ok: true, employeeId: employee.id, url: preboardUrl(req, token) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Generate (or return) a pre-boarding link for an existing employee record.
router.post('/:employeeId/preboard-link', requirePerm('employees:write'), (req, res) => {
  const emp = db.prepare('SELECT id, preboard_token FROM employees WHERE id = ?').get(req.params.employeeId);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });
  let token = emp.preboard_token;
  if (!token || (req.body && req.body.regenerate)) {
    token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE employees SET preboard_token = ? WHERE id = ?').run(token, emp.id);
  }
  res.json({ ok: true, token, url: preboardUrl(req, token) });
});

// Revoke the pre-boarding link (the URL stops working immediately).
router.post('/:employeeId/preboard-revoke', requirePerm('employees:write'), (req, res) => {
  db.prepare('UPDATE employees SET preboard_token = NULL WHERE id = ?').run(req.params.employeeId);
  res.json({ ok: true });
});

// View an employee's onboarding journey (self or manager/HR). Runs the
// automation first so self-completing tasks reflect the latest state.
router.get('/:employeeId', requireLogin, (req, res) => {
  if (!canActOnEmployee(req, req.params.employeeId)) return res.status(403).json({ error: 'No access.' });
  try { syncAutomatedTasks(req.params.employeeId); } catch (e) { /* non-fatal */ }
  const tasks = db.prepare('SELECT * FROM onboarding_tasks WHERE employee_id = ? ORDER BY position, id').all(req.params.employeeId);
  const emp = db.prepare('SELECT preboard_token, onboarding_submitted FROM employees WHERE id = ?').get(req.params.employeeId);
  // Only HR/managers (write access) get the actual link back, not the employee.
  const canManage = req.session.user.role !== 'EMPLOYEE';
  const preboard = {
    hasLink: !!(emp && emp.preboard_token),
    url: (canManage && emp && emp.preboard_token) ? preboardUrl(req, emp.preboard_token) : null,
    submitted: !!(emp && emp.onboarding_submitted),
  };
  res.json({ tasks, owners: OWNERS, stages: STAGES, preboard });
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
