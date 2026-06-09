const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, canActOnEmployee } = require('../middleware/auth');
const { provisionAccountsForOnboarding, accountsForDepartment } = require('../services/accountSetup');

const router = express.Router();

const DEFAULT_TASKS = [
  'Sign offer letter & policies',
  'Submit ID & address proof',
  'Submit bank & PAN details',
  'Set up work email & accounts',
  'Assign workstation / laptop',
  'Introduction to the team',
  'Read employee handbook',
];

// View an employee's onboarding checklist (self or manager/HR).
router.get('/:employeeId', requireLogin, (req, res) => {
  if (!canActOnEmployee(req, req.params.employeeId)) return res.status(403).json({ error: 'No access.' });
  res.json({ tasks: db.prepare('SELECT * FROM onboarding_tasks WHERE employee_id = ? ORDER BY position, id').all(req.params.employeeId) });
});

// Add a task (HR/employee-write).
router.post('/:employeeId', requirePerm('employees:write'), (req, res) => {
  const title = (req.body && req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Task title required.' });
  const max = db.prepare('SELECT COALESCE(MAX(position),0) m FROM onboarding_tasks WHERE employee_id = ?').get(req.params.employeeId).m;
  const r = db.prepare('INSERT INTO onboarding_tasks (employee_id, title, position) VALUES (?, ?, ?)').run(req.params.employeeId, title, max + 1);
  res.json({ id: r.lastInsertRowid });
});

// Apply the default onboarding template (HR). This is the onboarding kickoff,
// so it also notifies managers/IT to create the department's required accounts.
router.post('/:employeeId/template', requirePerm('employees:write'), (req, res) => {
  const existing = db.prepare('SELECT COUNT(*) c FROM onboarding_tasks WHERE employee_id = ?').get(req.params.employeeId).c;
  if (existing) return res.status(400).json({ error: 'Checklist already exists for this employee.' });
  const ins = db.prepare('INSERT INTO onboarding_tasks (employee_id, title, position) VALUES (?, ?, ?)');
  DEFAULT_TASKS.forEach((t, i) => ins.run(req.params.employeeId, t, i + 1));
  const setup = provisionAccountsForOnboarding(req.params.employeeId, req.session.user.id);
  res.json({ ok: true, added: DEFAULT_TASKS.length, accountSetup: setup });
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
