const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { effectivePermissions, ROLE_LABELS } = require('../services/permissions');

const router = express.Router();

async function buildSessionUser(user) {
  const emp = await db.prepare('SELECT * FROM employees WHERE user_id = ?').get(user.id);
  // Is this person a manager of anyone?
  const isManager = emp
    ? !!(await db.prepare('SELECT 1 FROM employees WHERE manager_id = ? LIMIT 1').get(emp.id))
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

async function loginHandler(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const user = await db
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(String(email).trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Block login for archived employees (their data is preserved, login disabled).
    const linkedEmp = await db.prepare('SELECT status FROM employees WHERE user_id = ?').get(user.id);
    if (linkedEmp && linkedEmp.status === 'archived') {
      return res.status(403).json({ error: 'This account has been archived. Please contact HR.' });
    }

    req.session.user = await buildSessionUser(user);
    // Explicitly persist the session BEFORE responding. The Postgres session
    // store is async — without this, a request fired immediately after login
    // can arrive before the session row exists and get a 401.
    await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
    res.json({ user: req.session.user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: req.session.user });
});

router.post('/change-password', requireLogin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    if (!bcrypt.compareSync(currentPassword || '', user.password_hash))
      return res.status(400).json({ error: 'Current password is incorrect.' });

    const hash = bcrypt.hashSync(newPassword, 10);
    await db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(
      hash,
      user.id
    );
    req.session.user.must_change = false;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
