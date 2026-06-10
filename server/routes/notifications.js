const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// My recent notifications + unread count.
router.get('/', requireLogin, async (req, res) => {
  try {
    const uid = req.session.user.id;
    const items = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(uid);
    const unread = (await db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(uid)).c;
    res.json({ notifications: items, unread });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/read-all', requireLogin, async (req, res) => {
  try {
    await db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.session.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/read', requireLogin, async (req, res) => {
  try {
    await db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
