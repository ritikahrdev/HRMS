const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// My recent notifications + unread count.
router.get('/', requireLogin, async (req, res) => {
  try {
    const uid = req.session.user.id;
    const items = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(uid);
    const row = await db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(uid);
    const unread = row ? row.c : 0;
    res.json({ notifications: items, unread });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

router.post('/read-all', requireLogin, async (req, res) => {
  try {
    await db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Read all notifications error:', err);
    res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
});

router.post('/:id/read', requireLogin, async (req, res) => {
  try {
    await db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Read notification error:', err);
    res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
});

module.exports = router;
