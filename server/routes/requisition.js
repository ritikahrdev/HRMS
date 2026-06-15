// PUBLIC hiring-requisition portal. A hiring manager opens this with a private
// token (no company login) and submits the requirements for a role. Everything
// is scoped to the one job row that token maps to.
const express = require('express');
const db = require('../db');
const { getSettings } = require('../services/settings');
const { notifyUsers } = require('../services/notify');
const { can } = require('../services/permissions');

const router = express.Router();

async function byToken(token) {
  if (!token || typeof token !== 'string' || token.length < 24) return null;
  return (await db.prepare('SELECT * FROM jobs WHERE req_token = ?').get(token)) || null;
}
const INVALID = { error: 'This link is invalid. Please contact HR for a new one.' };

// What the hiring manager sees (company branding + any saved answers).
router.get('/:token', async (req, res) => {
  try {
    const job = await byToken(req.params.token);
    if (!job) return res.status(404).json(INVALID);
    const s = getSettings();
    res.json({
      companyName: s.companyName || '',
      logoFile: s.logoFile || '',
      submitted: job.req_status === 'submitted' || job.req_status === 'published',
      job: {
        title: job.title && !job.title.startsWith('(Pending') ? job.title : '',
        department: job.department || '', location: job.location || '', type: job.type || 'Full-time',
        min_experience: job.min_experience || 0, headcount: job.headcount || 1, skills: job.skills || '',
        responsibilities: job.responsibilities || '', must_haves: job.must_haves || '', nice_to_haves: job.nice_to_haves || '',
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The hiring manager submits the requirement → lands on the job + notifies HR.
router.post('/:token', async (req, res) => {
  try {
    const job = await byToken(req.params.token);
    if (!job) return res.status(404).json(INVALID);
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Please give the role a title.' });
    const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
    await db.prepare(
      `UPDATE jobs SET title=?, department=?, location=?, type=?, min_experience=?, headcount=?,
        skills=?, responsibilities=?, must_haves=?, nice_to_haves=?, req_status='submitted' WHERE id=?`
    ).run(
      title, String(b.department || '').trim(), String(b.location || '').trim(), String(b.type || 'Full-time').trim(),
      num(b.min_experience, 0), Math.max(1, num(b.headcount, 1)), String(b.skills || '').trim(),
      String(b.responsibilities || '').trim(), String(b.must_haves || '').trim(), String(b.nice_to_haves || '').trim(), job.id
    );
    const recips = (await db.prepare('SELECT id, role FROM users').all()).filter((u) => can(u.role, 'recruitment:manage')).map((u) => u.id);
    await notifyUsers(recips, {
      type: 'recruitment',
      title: `📋 Hiring requirement submitted: ${title}`,
      body: `${job.manager_name || job.manager_email || 'A hiring manager'} filled the requirement for ${title}. Generate the job post with AI and publish it.`,
      link: '#/recruitment',
    }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
