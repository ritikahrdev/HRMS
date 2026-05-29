const express = require('express');
const db = require('../db');
const { requireLogin, canActOnEmployee } = require('../middleware/auth');

const router = express.Router();

// My goals.
router.get('/mine', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.json({ goals: [] });
  res.json({ goals: db.prepare('SELECT * FROM goals WHERE employee_id = ? ORDER BY created_at DESC').all(empId) });
});

// Goals for a specific employee (self or someone you manage).
router.get('/:employeeId', requireLogin, (req, res) => {
  if (!canActOnEmployee(req, req.params.employeeId)) return res.status(403).json({ error: 'No access.' });
  res.json({ goals: db.prepare('SELECT * FROM goals WHERE employee_id = ? ORDER BY created_at DESC').all(req.params.employeeId) });
});

// Create a goal (self, or for someone you manage).
router.post('/', requireLogin, (req, res) => {
  const { employee_id, title, description, target_date } = req.body || {};
  const empId = employee_id || req.session.user.employeeId;
  if (!empId || !title) return res.status(400).json({ error: 'Title is required.' });
  if (!canActOnEmployee(req, empId)) return res.status(403).json({ error: 'No access.' });
  const r = db.prepare('INSERT INTO goals (employee_id, title, description, target_date, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(empId, title, description || '', target_date || null, req.session.user.id);
  res.json({ id: r.lastInsertRowid });
});

// Update progress / status / details.
router.put('/:id', requireLogin, (req, res) => {
  const g = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (!canActOnEmployee(req, g.employee_id)) return res.status(403).json({ error: 'No access.' });
  const b = req.body || {};
  db.prepare('UPDATE goals SET title=?, description=?, target_date=?, progress=?, status=? WHERE id=?').run(
    b.title ?? g.title, b.description ?? g.description, b.target_date ?? g.target_date,
    b.progress != null ? Math.max(0, Math.min(100, Number(b.progress))) : g.progress,
    b.status || g.status, g.id
  );
  res.json({ ok: true });
});

router.delete('/:id', requireLogin, (req, res) => {
  const g = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (!canActOnEmployee(req, g.employee_id)) return res.status(403).json({ error: 'No access.' });
  db.prepare('DELETE FROM goals WHERE id = ?').run(g.id);
  res.json({ ok: true });
});

module.exports = router;
