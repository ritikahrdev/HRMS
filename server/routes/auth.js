const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { effectivePermissions, ROLE_LABELS } = require('../services/permissions');

const router = express.Router();

function buildSessionUser(user) {
  const emp = db.prepare('SELECT * FROM employees WHERE user_id = ?').get(user.id);
  // Is this person a manager of anyone?
  const isManager = emp
    ? !!db.prepare('SELECT 1 FROM employees WHERE manager_id = ? LIMIT 1').get(emp.id)
    : false;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    permissions: effectivePermissions(user.role),
    isManager,
    must_change: !!user.must_change,
    employeeId: emp ? emp.id : null,
    name: emp ? emp.name : 'Administrator',
  };
}

router.post('/login', (req, res) => {
  // Apply rate limiting if provided by parent middleware
  if (req.loginLimiter) {
    return req.loginLimiter(req, res, () => loginHandler(req, res));
  }
  loginHandler(req, res);
});

function loginHandler(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const user = db
    .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
    .get(String(email).trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  req.session.user = buildSessionUser(user);
  res.json({ user: req.session.user });
}

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: req.session.user });
});

router.post('/change-password', requireLogin, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash))
    return res.status(400).json({ error: 'Current password is incorrect.' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(
    hash,
    user.id
  );
  req.session.user.must_change = false;
  res.json({ ok: true });
});

module.exports = router;
