const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

const LIST = `SELECT l.*, e.name AS employee_name, e.emp_code
              FROM loans l JOIN employees e ON e.id = l.employee_id`;

// Finance / Super Admin: all loans (optionally by employee).
router.get('/', requirePerm('payroll:manage'), (req, res) => {
  const empId = req.query.employee_id;
  const rows = empId
    ? db.prepare(LIST + ' WHERE l.employee_id = ? ORDER BY l.created_at DESC').all(empId)
    : db.prepare(LIST + ' ORDER BY l.status, l.created_at DESC').all();
  res.json({ loans: rows });
});

// Employee: my loans/advances.
router.get('/mine', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.json({ loans: [] });
  res.json({ loans: db.prepare('SELECT * FROM loans WHERE employee_id = ? ORDER BY created_at DESC').all(empId) });
});

router.post('/', requirePerm('payroll:manage'), (req, res) => {
  const { employee_id, type, title, amount, emi, notes } = req.body || {};
  if (!employee_id || !amount) return res.status(400).json({ error: 'Employee and amount are required.' });
  const amt = Number(amount) || 0;
  const r = db.prepare(
    `INSERT INTO loans (employee_id, type, title, amount, emi, balance, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(employee_id, type === 'advance' ? 'advance' : 'loan', title || '', amt, Number(emi) || 0, amt, notes || '');
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', requirePerm('payroll:manage'), (req, res) => {
  const cur = db.prepare('SELECT * FROM loans WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const { type, title, amount, emi, balance, status, notes } = req.body || {};
  db.prepare(
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
});

router.delete('/:id', requirePerm('payroll:manage'), (req, res) => {
  db.prepare('DELETE FROM loans WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
