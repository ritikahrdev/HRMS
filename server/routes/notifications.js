const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// My recent notifications + unread count.
router.get('/', requireLogin, (req, res) => {
  const uid = req.session.user.id;
  const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(uid);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(uid).c;
  res.json({ notifications: items, unread });
});

router.post('/read-all', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.session.user.id);
  res.json({ ok: true });
});

router.post('/:id/read', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.user.id);
  res.json({ ok: true });
});

module.exports = router;
