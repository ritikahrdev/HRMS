const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

// Everyone can see the holiday calendar.
router.get('/', requireLogin, async (req, res) => {
  try {
    const year = req.query.year;
    const rows = year
      ? await db.prepare('SELECT * FROM holidays WHERE date LIKE ? ORDER BY date').all(`${year}-%`)
      : await db.prepare('SELECT * FROM holidays ORDER BY date').all();
    res.json({ holidays: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// HR / Super admin manage holidays.
router.post('/', requirePerm('settings:manage'), async (req, res) => {
  const { date, name, type } = req.body || {};
  if (!date || !name) return res.status(400).json({ error: 'Date and name are required.' });
  try {
    const r = await db.prepare('INSERT INTO holidays (date, name, type) VALUES (?, ?, ?)').run(date, name, type || 'public');
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'A holiday already exists on that date.' });
  }
});

router.put('/:id', requirePerm('settings:manage'), async (req, res) => {
  try {
    const { date, name, type } = req.body || {};
    await db.prepare('UPDATE holidays SET date = ?, name = ?, type = ? WHERE id = ?')
      .run(date, name, type || 'public', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', requirePerm('settings:manage'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM holidays WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
