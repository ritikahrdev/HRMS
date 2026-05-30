const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

const LIST = `SELECT l.*, e.name AS employee_name, e.emp_code
              FROM loans l JOIN employees e ON e.id = l.employee_id`;

// Finance / Super Admin: all loans (optionally by employee).
router.get('/', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const empId = req.query.employee_id;
    const rows = empId
      ? await db.prepare(LIST + ' WHERE l.employee_id = ? ORDER BY l.created_at DESC').all(empId)
      : await db.prepare(LIST + ' ORDER BY l.status, l.created_at DESC').all();
    res.json({ loans: rows });
  } catch (err) {
    console.error('Get loans error:', err);
    res.status(500).json({ error: 'Failed to fetch loans.' });
  }
});

// Employee: my loans/advances.
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.json({ loans: [] });
    const loans = await db.prepare('SELECT * FROM loans WHERE employee_id = ? ORDER BY created_at DESC').all(empId);
    res.json({ loans });
  } catch (err) {
    console.error('Get my loans error:', err);
    res.status(500).json({ error: 'Failed to fetch loans.' });
  }
});

router.post('/', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const { employee_id, type, title, amount, emi, notes } = req.body || {};
    if (!employee_id || !amount) return res.status(400).json({ error: 'Employee and amount are required.' });
    const amt = Number(amount) || 0;
    const r = await db.prepare(
      `INSERT INTO loans (employee_id, type, title, amount, emi, balance, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(employee_id, type === 'advance' ? 'advance' : 'loan', title || '', amt, Number(emi) || 0, amt, notes || '');
    res.json({ id: r.lastInsertRowid });
  } catch (err) {
    console.error('Create loan error:', err);
    res.status(500).json({ error: 'Failed to create loan.' });
  }
});

router.put('/:id', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const cur = await db.prepare('SELECT * FROM loans WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const { type, title, amount, emi, balance, status, notes } = req.body || {};
    await db.prepare(
      `UPDATE loans SET type=?, title=?, amount=?, emi=?, balance=?, status=?, notes=? WHERE id=?`
    ).run(
      type === 'advance' ? 'advance' : 'loan',
      title ?? cur.title,
      amount != null ? Number(amount) : cur.amount,
      emi != null ? Number(emi) : cur.emi,
      balance != null ? Number(balance) : cur.balance,
      status === 'closed' ? 'closed' : 'active',
      notes ?? cur.notes,
      cur.id
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Update loan error:', err);
    res.status(500).json({ error: 'Failed to update loan.' });
  }
});

router.delete('/:id', requirePerm('payroll:manage'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM loans WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete loan error:', err);
    res.status(500).json({ error: 'Failed to delete loan.' });
  }
});

module.exports = router;
