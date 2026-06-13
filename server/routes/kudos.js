const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { notifyEveryone } = require('../services/notify');
const { sendMail } = require('../services/email');
const { postToSlack } = require('../services/slackSync');
const { escapeHtml } = require('../services/escape');

const router = express.Router();

// Aggregated reactions for a set of kudos ids, with a "mine" flag for the user.
async function reactionsFor(ids, userId) {
  if (!ids.length) return {};
  const rows = await db.prepare(
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
router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT k.*, e.name AS to_name,
              COALESCE(fe.name, fu.email) AS from_name
       FROM kudos k
       JOIN employees e ON e.id = k.employee_id
       LEFT JOIN users fu ON fu.id = k.from_user
       LEFT JOIN employees fe ON fe.user_id = k.from_user
       ORDER BY k.created_at DESC LIMIT 100`
    ).all();
    const reacts = await reactionsFor(rows.map((r) => r.id), req.session.user.id);
    for (const r of rows) r.reactions = reacts[r.id] || [];
    res.json({ kudos: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Give kudos to someone — notifies the whole organisation.
router.post('/', requireLogin, async (req, res) => {
  try {
    const { employee_id, message, badge } = req.body || {};
    if (!employee_id || !message) return res.status(400).json({ error: 'Recipient and message are required.' });
    // The recipient must be a real employee (no kudos to a non-existent id).
    const recipient = await db.prepare('SELECT name FROM employees WHERE id = ?').get(employee_id);
    if (!recipient) return res.status(400).json({ error: 'Recipient not found.' });
    const r = await db.prepare('INSERT INTO kudos (from_user, employee_id, badge, message) VALUES (?, ?, ?, ?)')
      .run(req.session.user.id, employee_id, badge || '👏', message);

    const giver = req.session.user.name || 'Someone';
    const recName = recipient.name;
    // Escape user-controlled text before it lands in notification bodies (rendered
    // via innerHTML), email HTML, and Slack messages.
    const safeMsg = escapeHtml(message);
    const safeGiver = escapeHtml(giver);
    const safeRec = escapeHtml(recName);

    // In-app notification to everyone (except the giver).
    await notifyEveryone(req.session.user.id, {
      type: 'kudos',
      title: `${badge || '👏'} Shoutout for ${safeRec}`,
      body: `${safeGiver}: ${safeMsg}`,
      link: '#/recognition',
    });

    // Post the shoutout to Slack (its own channel, if configured).
    await postToSlack(`${badge || '👏'} *Shoutout for ${recName}*\n${giver}: ${message}`, { purpose: 'shoutout' }).catch(() => {});

    // Optional email broadcast (only sends if email is enabled in config).
    const emails = (await db.prepare("SELECT email FROM employees WHERE status='active' AND email IS NOT NULL AND email != ''").all()).map((e) => e.email);
    if (emails.length) {
      sendMail({
        to: emails.join(','),
        subject: `${badge || '👏'} Shoutout for ${recName}`,
        html: `<p><b>${safeGiver}</b> gave a shoutout to <b>${safeRec}</b>:</p><blockquote>${safeMsg}</blockquote><p>Open the HR portal → Recognition to cheer it!</p>`,
      }).catch(() => {});
    }

    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle an emoji reaction on a kudos (Slack-style). Body: { emoji }.
router.post('/:id/react', requireLogin, async (req, res) => {
  try {
    const emoji = (req.body && req.body.emoji || '').trim();
    if (!emoji) return res.status(400).json({ error: 'emoji required' });
    const k = await db.prepare('SELECT id FROM kudos WHERE id = ?').get(req.params.id);
    if (!k) return res.status(404).json({ error: 'Not found' });
    const uid = req.session.user.id;
    const existing = await db.prepare('SELECT id FROM kudos_reactions WHERE kudos_id = ? AND user_id = ? AND emoji = ?').get(k.id, uid, emoji);
    let added = false;
    if (existing) await db.prepare('DELETE FROM kudos_reactions WHERE id = ?').run(existing.id);
    else { await db.prepare('INSERT INTO kudos_reactions (kudos_id, user_id, emoji) VALUES (?, ?, ?)').run(k.id, uid, emoji); added = true; }
    const reactions = (await reactionsFor([k.id], uid))[k.id] || [];
    res.json({ added, reactions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Backward-compatible "cheer" = toggle the 👏 reaction.
router.post('/:id/cheer', requireLogin, async (req, res) => {
  try {
    const k = await db.prepare('SELECT id FROM kudos WHERE id = ?').get(req.params.id);
    if (!k) return res.status(404).json({ error: 'Not found' });
    const uid = req.session.user.id;
    const ex = await db.prepare("SELECT id FROM kudos_reactions WHERE kudos_id = ? AND user_id = ? AND emoji = '👏'").get(k.id, uid);
    if (ex) await db.prepare('DELETE FROM kudos_reactions WHERE id = ?').run(ex.id);
    else await db.prepare("INSERT INTO kudos_reactions (kudos_id, user_id, emoji) VALUES (?, ?, '👏')").run(k.id, uid);
    res.json({ reactions: (await reactionsFor([k.id], uid))[k.id] || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Monthly leaderboard — most-recognised people (kudos received + total reactions).
router.get('/leaderboard', requireLogin, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const rows = await db.prepare(
      `SELECT e.id, e.name, e.department,
              COUNT(DISTINCT k.id) AS kudos_count,
              (SELECT COUNT(*) FROM kudos_reactions kr JOIN kudos k2 ON k2.id = kr.kudos_id
               WHERE k2.employee_id = e.id AND substr(k2.created_at,1,7) = ?) AS cheers
       FROM kudos k JOIN employees e ON e.id = k.employee_id
       WHERE substr(k.created_at,1,7) = ?
       GROUP BY e.id ORDER BY kudos_count DESC, cheers DESC LIMIT 10`
    ).all(month, month);
    res.json({ month, leaders: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
