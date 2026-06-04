const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { notifyEveryone } = require('../services/notify');
const { sendMail } = require('../services/email');

const router = express.Router();

// Aggregated reactions for a set of kudos ids, with a "mine" flag for the user.
function reactionsFor(ids, userId) {
  if (!ids.length) return {};
  const rows = db.prepare(
    `SELECT kudos_id, emoji, COUNT(*) AS count,
            SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine
     FROM kudos_reactions WHERE kudos_id IN (${ids.map(() => '?').join(',')})
     GROUP BY kudos_id, emoji ORDER BY count DESC`
  ).all(userId, ...ids);
  const byKudos = {};
  for (const r of rows) {
    (byKudos[r.kudos_id] = byKudos[r.kudos_id] || []).push({ emoji: r.emoji, count: r.count, mine: !!r.mine });
  }
  return byKudos;
}

// Praise wall — everyone sees recent kudos with their reactions.
router.get('/', requireLogin, (req, res) => {
  const rows = db.prepare(
    `SELECT k.*, e.name AS to_name,
            COALESCE(fe.name, fu.email) AS from_name
     FROM kudos k
     JOIN employees e ON e.id = k.employee_id
     LEFT JOIN users fu ON fu.id = k.from_user
     LEFT JOIN employees fe ON fe.user_id = k.from_user
     ORDER BY k.created_at DESC LIMIT 100`
  ).all();
  const reacts = reactionsFor(rows.map((r) => r.id), req.session.user.id);
  for (const r of rows) r.reactions = reacts[r.id] || [];
  res.json({ kudos: rows });
});

// Give kudos to someone — notifies the whole organisation.
router.post('/', requireLogin, async (req, res) => {
  const { employee_id, message, badge } = req.body || {};
  if (!employee_id || !message) return res.status(400).json({ error: 'Recipient and message are required.' });
  const r = db.prepare('INSERT INTO kudos (from_user, employee_id, badge, message) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, employee_id, badge || '👏', message);

  const recipient = db.prepare('SELECT name FROM employees WHERE id = ?').get(employee_id);
  const giver = req.session.user.name || 'Someone';
  const recName = recipient ? recipient.name : 'a teammate';

  // In-app notification to everyone (except the giver).
  notifyEveryone(req.session.user.id, {
    type: 'kudos',
    title: `${badge || '👏'} Shoutout for ${recName}`,
    body: `${giver}: ${message}`,
    link: '#/recognition',
  });

  // Optional email broadcast (only sends if email is enabled in config).
  const emails = db.prepare("SELECT email FROM employees WHERE status='active' AND email IS NOT NULL AND email != ''").all().map((e) => e.email);
  if (emails.length) {
    sendMail({
      to: emails.join(','),
      subject: `${badge || '👏'} Shoutout for ${recName}`,
      html: `<p><b>${giver}</b> gave a shoutout to <b>${recName}</b>:</p><blockquote>${message}</blockquote><p>Open the HR portal → Recognition to cheer it!</p>`,
    }).catch(() => {});
  }

  res.json({ id: r.lastInsertRowid });
});

// Toggle an emoji reaction on a kudos (Slack-style). Body: { emoji }.
router.post('/:id/react', requireLogin, (req, res) => {
  const emoji = (req.body && req.body.emoji || '').trim();
  if (!emoji) return res.status(400).json({ error: 'emoji required' });
  const k = db.prepare('SELECT id FROM kudos WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Not found' });
  const uid = req.session.user.id;
  const existing = db.prepare('SELECT id FROM kudos_reactions WHERE kudos_id = ? AND user_id = ? AND emoji = ?').get(k.id, uid, emoji);
  let added = false;
  if (existing) db.prepare('DELETE FROM kudos_reactions WHERE id = ?').run(existing.id);
  else { db.prepare('INSERT INTO kudos_reactions (kudos_id, user_id, emoji) VALUES (?, ?, ?)').run(k.id, uid, emoji); added = true; }
  const reactions = (reactionsFor([k.id], uid))[k.id] || [];
  res.json({ added, reactions });
});

// Backward-compatible "cheer" = toggle the 👏 reaction.
router.post('/:id/cheer', requireLogin, (req, res) => {
  const k = db.prepare('SELECT id FROM kudos WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Not found' });
  const uid = req.session.user.id;
  const ex = db.prepare("SELECT id FROM kudos_reactions WHERE kudos_id = ? AND user_id = ? AND emoji = '👏'").get(k.id, uid);
  if (ex) db.prepare('DELETE FROM kudos_reactions WHERE id = ?').run(ex.id);
  else db.prepare("INSERT INTO kudos_reactions (kudos_id, user_id, emoji) VALUES (?, ?, '👏')").run(k.id, uid);
  res.json({ reactions: (reactionsFor([k.id], uid))[k.id] || [] });
});

// Monthly leaderboard — most-recognised people (kudos received + total reactions).
router.get('/leaderboard', requireLogin, (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(
    `SELECT e.id, e.name, e.department,
            COUNT(DISTINCT k.id) AS kudos_count,
            (SELECT COUNT(*) FROM kudos_reactions kr JOIN kudos k2 ON k2.id = kr.kudos_id
             WHERE k2.employee_id = e.id AND substr(k2.created_at,1,7) = ?) AS cheers
     FROM kudos k JOIN employees e ON e.id = k.employee_id
     WHERE substr(k.created_at,1,7) = ?
     GROUP BY e.id ORDER BY kudos_count DESC, cheers DESC LIMIT 10`
  ).all(month, month);
  res.json({ month, leaders: rows });
});

module.exports = router;
