const express = require('express');
const db = require('../db');
const { requireLogin, canActOnEmployee } = require('../middleware/auth');

const router = express.Router();

// My goals.
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.json({ goals: [] });
    const goals = await db.prepare('SELECT * FROM goals WHERE employee_id = ? ORDER BY created_at DESC').all(empId);
    res.json({ goals });
  } catch (err) {
    console.error('Get my goals error:', err);
    res.status(500).json({ error: 'Failed to fetch goals.' });
  }
});

// Goals for a specific employee (self or someone you manage).
router.get('/:employeeId', requireLogin, async (req, res) => {
  try {
    if (!(await canActOnEmployee(req, req.params.employeeId))) return res.status(403).json({ error: 'No access.' });
    const goals = await db.prepare('SELECT * FROM goals WHERE employee_id = ? ORDER BY created_at DESC').all(req.params.employeeId);
    res.json({ goals });
  } catch (err) {
    console.error('Get employee goals error:', err);
    res.status(500).json({ error: 'Failed to fetch goals.' });
  }
});

// Create a goal (self, or for someone you manage).
router.post('/', requireLogin, async (req, res) => {
  try {
    const { employee_id, title, description, target_date } = req.body || {};
    const empId = employee_id || req.session.user.employeeId;
    if (!empId || !title) return res.status(400).json({ error: 'Title is required.' });
    if (!(await canActOnEmployee(req, empId))) return res.status(403).json({ error: 'No access.' });
    const r = await db.prepare('INSERT INTO goals (employee_id, title, description, target_date, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(empId, title, description || '', target_date || null, req.session.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    console.error('Create goal error:', err);
    res.status(500).json({ error: 'Failed to create goal.' });
  }
});

// Update progress / status / details.
router.put('/:id', requireLogin, async (req, res) => {
  try {
    const g = await db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
    if (!g) return res.status(404).json({ error: 'Not found' });
    if (!(await canActOnEmployee(req, g.employee_id))) return res.status(403).json({ error: 'No access.' });
    const b = req.body || {};
    await db.prepare('UPDATE goals SET title=?, description=?, target_date=?, progress=?, status=? WHERE id=?').run(
      b.title ?? g.title,
      b.description ?? g.description,
      b.target_date ?? g.target_date,
      b.progress != null ? Math.max(0, Math.min(100, Number(b.progress))) : g.progress,
      b.status || g.status,
      g.id
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Update goal error:', err);
    res.status(500).json({ error: 'Failed to update goal.' });
  }
});

router.delete('/:id', requireLogin, async (req, res) => {
  try {
    const g = await db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
    if (!g) return res.status(404).json({ error: 'Not found' });
    if (!(await canActOnEmployee(req, g.employee_id))) return res.status(403).json({ error: 'No access.' });
    await db.prepare('DELETE FROM goals WHERE id = ?').run(g.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete goal error:', err);
    res.status(500).json({ error: 'Failed to delete goal.' });
  }
});

module.exports = router;
