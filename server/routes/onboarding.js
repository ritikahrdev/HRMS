const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, canActOnEmployee } = require('../middleware/auth');

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
router.get('/:employeeId', requireLogin, async (req, res) => {
  if (!await canActOnEmployee(req, req.params.employeeId)) return res.status(403).json({ error: 'No access.' });
  const tasks = await db.prepare('SELECT * FROM onboarding_tasks WHERE employee_id = $1 ORDER BY position, id').all(req.params.employeeId);
  res.json({ tasks });
});

// Add a task (HR/employee-write).
router.post('/:employeeId', requirePerm('employees:write'), async (req, res) => {
  const title = (req.body && req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Task title required.' });
  const maxRow = await db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM onboarding_tasks WHERE employee_id = $1').get(req.params.employeeId);
  const max = maxRow ? Number(maxRow.m) || 0 : 0;
  const r = await db.prepare('INSERT INTO onboarding_tasks (employee_id, title, position) VALUES ($1, $2, $3)').run(req.params.employeeId, title, max + 1);
  res.json({ id: r.lastInsertRowid });
});

// Apply the default onboarding template (HR).
router.post('/:employeeId/template', requirePerm('employees:write'), async (req, res) => {
  const existingRow = await db.prepare('SELECT COUNT(*) AS c FROM onboarding_tasks WHERE employee_id = $1').get(req.params.employeeId);
  const existing = existingRow ? Number(existingRow.c) || 0 : 0;
  if (existing) return res.status(400).json({ error: 'Checklist already exists for this employee.' });
  for (let i = 0; i < DEFAULT_TASKS.length; i++) {
    await db.prepare('INSERT INTO onboarding_tasks (employee_id, title, position) VALUES ($1, $2, $3)').run(req.params.employeeId, DEFAULT_TASKS[i], i + 1);
  }
  res.json({ ok: true, added: DEFAULT_TASKS.length });
});

// Toggle a task done (self or HR).
router.put('/task/:id', requireLogin, async (req, res) => {
  const t = await db.prepare('SELECT * FROM onboarding_tasks WHERE id = $1').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!await canActOnEmployee(req, t.employee_id)) return res.status(403).json({ error: 'No access.' });
  await db.prepare('UPDATE onboarding_tasks SET done = $1 WHERE id = $2').run(req.body && req.body.done ? 1 : 0, t.id);
  res.json({ ok: true });
});

router.delete('/task/:id', requirePerm('employees:write'), async (req, res) => {
  await db.prepare('DELETE FROM onboarding_tasks WHERE id = $1').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
