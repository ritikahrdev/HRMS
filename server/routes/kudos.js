const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { notifyEveryone, notifyUsers } = require('../services/notify');
const { sendMail } = require('../services/email');
const { postToSlack } = require('../services/slackSync');
const { escapeHtml } = require('../services/escape');
const { getSettings } = require('../services/settings');
const config = require('../config');

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

// Comments for a set of kudos ids, oldest first, with the commenter's name.
async function commentsFor(ids) {
  if (!ids.length) return {};
  const rows = await db.prepare(
    `SELECT kc.kudos_id, kc.comment, kc.created_at,
            COALESCE(fe.name, fu.email) AS author
     FROM kudos_comments kc
     LEFT JOIN users fu ON fu.id = kc.user_id
     LEFT JOIN employees fe ON fe.user_id = kc.user_id
     WHERE kc.kudos_id IN (${ids.map(() => '?').join(',')})
     ORDER BY kc.created_at ASC, kc.id ASC`
  ).all(...ids);
  const by = {};
  for (const r of rows) (by[r.kudos_id] = by[r.kudos_id] || []).push({ author: r.author, comment: r.comment, created_at: r.created_at });
  return by;
}

// Praise wall — everyone sees recent kudos with their reactions + comments.
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
    const ids = rows.map((r) => r.id);
    const reacts = await reactionsFor(ids, req.session.user.id);
    const cmts = await commentsFor(ids);
    for (const r of rows) { r.reactions = reacts[r.id] || []; r.comments = cmts[r.id] || []; }
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

    // Optional email broadcast — OFF by default. Only emails everyone when the
    // "Email all employees on a shoutout" setting is explicitly turned on
    // (Settings → Recognition). Keeps the inbox quiet during testing.
    const emails = (await db.prepare("SELECT email FROM employees WHERE status='active' AND email IS NOT NULL AND email != ''").all()).map((e) => e.email);
    if (emails.length && getSettings().shoutoutEmailBroadcast === true) {
      const co = getSettings().companyName || 'our team';
      const link = `${(config.publicUrl || '').replace(/\/$/, '')}/#/recognition`;
      const badgeEmoji = badge || '👏';
      sendMail({
        to: emails.join(','),
        subject: `${badgeEmoji} ${recName} just got a shoutout!`,
        text: `${giver} gave a shoutout to ${recName}: "${message}". Cheer it on the Recognition wall — ${link}`,
        html: `
<div style="background:#f4f5fb;padding:28px 14px;font-family:'Inter',Segoe UI,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 34px rgba(16,24,40,.10)">
    <div style="background:linear-gradient(135deg,#6366f1,#7c3aed);padding:30px 28px;text-align:center;color:#ffffff">
      <div style="font-size:46px;line-height:1">${badgeEmoji}</div>
      <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;opacity:.92;margin-top:10px;font-weight:700">Shoutout</div>
      <div style="font-size:23px;font-weight:800;margin-top:4px">${safeRec} 🎉</div>
    </div>
    <div style="padding:26px 28px">
      <p style="margin:0 0 16px;color:#475467;font-size:14.5px"><b style="color:#1e293b">${safeGiver}</b> just recognised <b style="color:#1e293b">${safeRec}</b> for their great work:</p>
      <div style="background:#f7f7fb;border-left:4px solid #7c3aed;border-radius:10px;padding:16px 18px;margin:0 0 22px;color:#1e293b;font-size:15.5px;font-weight:500;font-style:italic">&ldquo;${safeMsg}&rdquo;</div>
      <div style="text-align:center;margin:6px 0 2px">
        <a href="${link}" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:#ffffff;text-decoration:none;font-weight:700;font-size:14.5px;padding:12px 26px;border-radius:10px;display:inline-block">👏 Cheer it on the wall →</a>
      </div>
    </div>
    <div style="padding:14px 28px;border-top:1px solid #eef0f5;text-align:center;color:#98a2b3;font-size:11.5px">Recognition wall · ${escapeHtml(co)}</div>
  </div>
</div>`,
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

// Add a comment to a shoutout. Body: { comment }.
router.post('/:id/comment', requireLogin, async (req, res) => {
  try {
    const text = (req.body && req.body.comment || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'Write a comment.' });
    if (text.length > 500) return res.status(400).json({ error: 'Comment is too long (max 500 characters).' });
    const k = await db.prepare('SELECT id, employee_id FROM kudos WHERE id = ?').get(req.params.id);
    if (!k) return res.status(404).json({ error: 'Not found' });
    await db.prepare('INSERT INTO kudos_comments (kudos_id, user_id, comment) VALUES (?, ?, ?)').run(k.id, req.session.user.id, text);
    const author = req.session.user.name || 'Someone';
    // Tell the recipient (in-app bell) that someone commented on their shoutout.
    const rec = await db.prepare('SELECT user_id FROM employees WHERE id = ?').get(k.employee_id);
    if (rec && rec.user_id && rec.user_id !== req.session.user.id) {
      await notifyUsers([rec.user_id], { type: 'kudos', title: '💬 New comment on your shoutout', body: `${escapeHtml(author)}: ${escapeHtml(text)}`, link: '#/recognition' }).catch(() => {});
    }
    res.json({ comment: { author, comment: text, created_at: new Date().toISOString() } });
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

// Slack shoutout POINTS leaderboard — top givers (most generous) & top receivers
// (most recognised), summed from the bot-fed slack_shoutouts table. ?from=&to= (YYYY-MM-DD).
router.get('/points-leaderboard', requireLogin, async (req, res) => {
  try {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    const cond = [], args = [];
    if (from) { cond.push('created_at >= ?'); args.push(from); }
    if (to) { cond.push('created_at <= ?'); args.push(to + 'T23:59:59'); }
    const w = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const givW = 'WHERE ' + [...cond, "COALESCE(giver_email, giver_name, '') <> ''"].join(' AND ');

    const topReceivers = await db.prepare(
      `SELECT MAX(receiver_name) AS name, receiver_email AS email, SUM(points) AS points, COUNT(*) AS count
       FROM slack_shoutouts ${w} GROUP BY COALESCE(receiver_email, receiver_name)
       ORDER BY points DESC, count DESC LIMIT 20`
    ).all(...args);
    const topGivers = await db.prepare(
      `SELECT MAX(giver_name) AS name, giver_email AS email, SUM(points) AS points, COUNT(*) AS count
       FROM slack_shoutouts ${givW} GROUP BY COALESCE(giver_email, giver_name)
       ORDER BY points DESC, count DESC LIMIT 20`
    ).all(...args);
    const totals = await db.prepare(`SELECT COUNT(*) AS shoutouts, COALESCE(SUM(points),0) AS points FROM slack_shoutouts ${w}`).get(...args);
    const recent = await db.prepare(
      `SELECT giver_name, receiver_name, points, reason, created_at FROM slack_shoutouts ${w} ORDER BY id DESC LIMIT 15`
    ).all(...args);
    res.json({ topReceivers, topGivers, totals, recent, from, to });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
