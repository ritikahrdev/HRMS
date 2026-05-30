const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm, canActOnEmployee } = require('../middleware/auth');

const router = express.Router();

const LIST = `SELECT r.*, e.name AS employee_name,
              COALESCE(re.name, ru.email) AS reviewer_name
              FROM reviews r JOIN employees e ON e.id = r.employee_id
              LEFT JOIN users ru ON ru.id = r.reviewer_id
              LEFT JOIN employees re ON re.user_id = r.reviewer_id`;

// My reviews (as the employee).
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.json({ reviews: [] });
    const reviews = await db.prepare(LIST + ' WHERE r.employee_id = ? ORDER BY r.created_at DESC').all(empId);
    res.json({ reviews });
  } catch (err) {
    console.error('Get my reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews.' });
  }
});

// Reviews for an employee (reviewers: managers/HR).
router.get('/:employeeId', requirePerm('leave:approve'), async (req, res) => {
  try {
    if (!(await canActOnEmployee(req, req.params.employeeId))) return res.status(403).json({ error: 'No access.' });
    const reviews = await db.prepare(LIST + ' WHERE r.employee_id = ? ORDER BY r.created_at DESC').all(req.params.employeeId);
    res.json({ reviews });
  } catch (err) {
    console.error('Get employee reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews.' });
  }
});

// Create a review (managers/HR for their team).
router.post('/', requirePerm('leave:approve'), async (req, res) => {
  try {
    const { employee_id, period, rating, strengths, improvements } = req.body || {};
    if (!employee_id || !period) return res.status(400).json({ error: 'Employee and period are required.' });
    if (!(await canActOnEmployee(req, employee_id))) return res.status(403).json({ error: 'Not in your team.' });
    const r = await db.prepare(
      'INSERT INTO reviews (employee_id, period, reviewer_id, rating, strengths, improvements) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(employee_id, period, req.session.user.id, Number(rating) || null, strengths || '', improvements || '');
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'Failed to create review.' });
  }
});

router.delete('/:id', requirePerm('leave:approve'), async (req, res) => {
  try {
    const rv = await db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    if (!rv) return res.status(404).json({ error: 'Not found' });
    if (!(await canActOnEmployee(req, rv.employee_id))) return res.status(403).json({ error: 'No access.' });
    await db.prepare('DELETE FROM reviews WHERE id = ?').run(rv.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete review error:', err);
    res.status(500).json({ error: 'Failed to delete review.' });
  }
});

module.exports = router;
