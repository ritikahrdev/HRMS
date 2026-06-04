const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

const LIST = `SELECT a.*, e.name AS employee_name, e.emp_code
              FROM assets a LEFT JOIN employees e ON e.id = a.employee_id`;

// Admins (employees:write) manage all assets.
router.get('/', requirePerm('employees:write'), (req, res) => {
  res.json({ assets: db.prepare(LIST + ' ORDER BY a.name').all() });
});

// An employee can see assets assigned to them.
router.get('/mine', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.json({ assets: [] });
  res.json({ assets: db.prepare(LIST + ' WHERE a.employee_id = ? ORDER BY a.name').all(empId) });
});

router.post('/', requirePerm('employees:write'), (req, res) => {
  const { name, tag, category, employee_id, status, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Asset name is required.' });
  const empId = employee_id ? Number(employee_id) : null;
  const st = empId ? 'assigned' : (status || 'available');
  const r = db.prepare(
    `INSERT INTO assets (name, tag, category, employee_id, status, notes, assigned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(name, tag || '', category || '', empId, st, notes || '', empId ? new Date().toISOString() : null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', requirePerm('employees:write'), (req, res) => {
  const cur = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const { name, tag, category, employee_id, status, notes } = req.body || {};
  const empId = employee_id ? Number(employee_id) : null;
  const st = empId ? 'assigned' : (status || 'available');
  const assignedAt = empId && empId !== cur.employee_id ? new Date().toISOString() : cur.assigned_at;
  db.prepare(
    `UPDATE assets SET name=?, tag=?, category=?, employee_id=?, status=?, notes=?, assigned_at=? WHERE id=?`
  ).run(name ?? cur.name, tag ?? cur.tag, category ?? cur.category, empId, st, notes ?? cur.notes, empId ? assignedAt : null, cur.id);
  res.json({ ok: true });
});

router.delete('/:id', requirePerm('employees:write'), (req, res) => {
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
