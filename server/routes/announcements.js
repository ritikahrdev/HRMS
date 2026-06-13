const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');
const { postToSlack } = require('../services/slackSync');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');
const { escapeHtml } = require('../services/escape');

const router = express.Router();

// Everyone sees announcements (pinned first, then newest).
router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT a.*, COALESCE(e.name, u.email) AS author
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN employees e ON e.user_id = a.created_by
       ORDER BY a.pinned DESC, a.created_at DESC`
    ).all();
    res.json({ announcements: rows });
  } catch (err) {
    console.error('Error fetching announcements:', err);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// HR / Super admin post and remove.
router.post('/', requirePerm('settings:manage'), async (req, res) => {
  try {
    const { title, body, pinned } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Title is required.' });

    const r = await db.prepare('INSERT INTO announcements (title, body, pinned, created_by) VALUES (?, ?, ?, ?)')
      .run(title, body || '', pinned ? 1 : 0, req.session.user.id);

    const id = r.lastInsertRowid;

    // Post to Slack if enabled
    const slackMessage = `📢 *${title}*\n${body || ''}`;
    await postToSlack(slackMessage, { purpose: 'notice' });

    // Send email notification to all active employees
    const settings = getSettings();
    if (settings.email && settings.email.enabled) {
      const employees = await db.prepare("SELECT email FROM employees WHERE status='active' AND email IS NOT NULL").all();
      const emails = employees.map((e) => e.email).filter(Boolean);

      if (emails.length > 0) {
        const authorName = req.session.user.name || req.session.user.email;
        await sendMail({
          to: emails.join(','),
          subject: `📢 Announcement: ${title}`,
          html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2 style="color: #333;">${escapeHtml(title)}</h2>
            <p style="color: #666; white-space: pre-wrap;">${escapeHtml(body || '(No details)')}</p>
            <p style="color: #999; font-size: 12px; margin-top: 20px;">
              Posted by: ${escapeHtml(authorName)}<br/>
              Check the HR portal for more announcements.
            </p>
          </div>`,
        }).catch((e) => console.error('Error sending announcement email:', e));
      }
    }

    res.json({ id });
  } catch (err) {
    console.error('Error posting announcement:', err);
    res.status(500).json({ error: 'Failed to post announcement' });
  }
});

router.delete('/:id', requirePerm('settings:manage'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting announcement:', err);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

module.exports = router;
