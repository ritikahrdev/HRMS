const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const { requirePerm } = require('../middleware/auth');
const { upload } = require('../services/upload');
const { saveFile, getFile, deleteFile, sendFile } = require('../services/filestore');
const { createEmployee } = require('../services/employees');
const { provisionAccountsForOnboarding } = require('../services/accountSetup');
const { buildJourney, syncAutomatedTasks } = require('../services/onboardingJourney');
const crypto = require('crypto');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');
const { escapeHtml } = require('../services/escape');
const ai = require('../services/ai');
const screening = require('../services/screening');

const router = express.Router();
const P = requirePerm('recruitment:manage');

// ---- Hiring requisition: email a form to the manager; their answers land here ----
router.post('/requisitions', P, async (req, res) => {
  try {
    const b = req.body || {};
    const managerEmail = String(b.manager_email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(managerEmail)) return res.status(400).json({ error: 'A valid hiring-manager email is required.' });
    const token = crypto.randomBytes(24).toString('hex');
    const title = String(b.title || '').trim() || '(Pending — hiring manager to fill)';
    const r = await db.prepare(
      "INSERT INTO jobs (title, department, status, req_token, req_status, manager_email, manager_name, created_by) VALUES (?, ?, 'draft', ?, 'requested', ?, ?, ?)"
    ).run(title, String(b.department || '').trim(), token, managerEmail, String(b.manager_name || '').trim(), req.session.user.id);
    const s = getSettings();
    const link = `${config.publicUrl}/requisition/${token}`;
    await sendMail({
      to: managerEmail,
      subject: `Action needed: hiring requirement${b.title ? ' — ' + b.title : ''} (${s.companyName || 'HR'})`,
      html: `<p>Hi ${escapeHtml(b.manager_name || 'there')},</p>
        <p><b>${escapeHtml(req.session.user.name || 'HR')}</b> has asked you to share the requirements for a new hire${b.title ? ` (<b>${escapeHtml(b.title)}</b>)` : ''}. It's a short form, and your answers go straight to the HR recruitment pipeline.</p>
        <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">Fill the hiring requirement →</a></p>
        <p style="color:#888;font-size:12px">Or paste this link into your browser: ${link}</p>`,
    }).catch(() => {});
    res.json({ id: r.lastInsertRowid, token, link });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- AI: draft a polished job post from the requisition data ----
router.post('/jobs/:id/generate-post', P, async (req, res) => {
  try {
    if (!ai.isConfigured()) return res.status(400).json({ error: 'AI is not set up yet. Add an API key in Settings → AI Assistant.' });
    const j = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!j) return res.status(404).json({ error: 'Not found' });
    const s = getSettings();
    const system = `You are an expert recruiter writing a compelling, inclusive job post for ${s.companyName || 'a company'}. Use clean text with short markdown headings and bullet lists. Include: a 2–3 line role summary, "Key Responsibilities" (bullets), "Requirements" (must-haves, bullets), "Nice to have" (only if provided), and a short "Why join us" line. Be concise and appealing. Do NOT invent salary, benefits specifics, or legal claims. Output ONLY the job description text.`;
    const brief = `Title: ${j.title}\nDepartment: ${j.department || '—'}\nLocation: ${j.location || '—'}\nType: ${j.type || 'Full-time'}\nOpenings: ${j.headcount || 1}\nMin experience: ${j.min_experience || 0} yrs\nRequired skills: ${j.skills || '—'}\nKey responsibilities: ${j.responsibilities || '—'}\nMust-haves: ${j.must_haves || '—'}\nNice-to-haves: ${j.nice_to_haves || '—'}`;
    const text = await ai.complete(system, brief, 1200);
    await db.prepare('UPDATE jobs SET description = ? WHERE id = ?').run(text, j.id);
    res.json({ ok: true, description: text });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Publish a draft/requisition job → live on the public careers page ----
router.post('/jobs/:id/publish', P, async (req, res) => {
  try {
    const j = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!j) return res.status(404).json({ error: 'Not found' });
    if (!j.title || j.title.startsWith('(Pending')) return res.status(400).json({ error: 'Add a job title before publishing.' });
    await db.prepare("UPDATE jobs SET status='open', req_status = CASE WHEN req_token IS NOT NULL THEN 'published' ELSE req_status END WHERE id = ?").run(j.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Criteria match score (0-100): 70% skills overlap + 30% experience ----
function scoreApplicant(app, job) {
  const norm = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const req = norm(job.skills);
  const have = norm(app.skills);
  const skillScore = req.length
    ? req.filter((s) => have.some((h) => h.includes(s) || s.includes(h))).length / req.length
    : 1;
  const minExp = job.min_experience || 0;
  const expScore = minExp ? Math.min(1, (app.experience_years || 0) / minExp) : 1;
  return Math.round((skillScore * 0.7 + expScore * 0.3) * 100);
}

// ---- Jobs ----
router.get('/jobs', P, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT j.*, (SELECT COUNT(*) FROM applicants a WHERE a.job_id = j.id) AS applicants,
              (SELECT COUNT(*) FROM applicants a WHERE a.job_id = j.id AND a.stage='hired') AS hired
       FROM jobs j ORDER BY j.status, j.created_at DESC`
    ).all();
    res.json({ jobs: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/jobs/:id', P, async (req, res) => {
  try {
    const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const applicants = await db.prepare('SELECT * FROM applicants WHERE job_id = ? ORDER BY score DESC, created_at DESC').all(job.id);
    const interviews = await db.prepare(
      `SELECT iv.*, a.name AS applicant_name FROM interviews iv
       JOIN applicants a ON a.id = iv.applicant_id WHERE a.job_id = ? ORDER BY iv.scheduled_at`
    ).all(job.id);
    res.json({ job, applicants, interviews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/jobs', P, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'Job title is required.' });
    const r = await db.prepare(
      'INSERT INTO jobs (title, department, location, type, description, skills, min_experience, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(b.title, b.department || '', b.location || '', b.type || 'Full-time', b.description || '', b.skills || '', Number(b.min_experience) || 0, req.session.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/jobs/:id', P, async (req, res) => {
  try {
    const j = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!j) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    await db.prepare('UPDATE jobs SET title=?, department=?, location=?, type=?, description=?, skills=?, min_experience=?, status=? WHERE id=?')
      .run(b.title ?? j.title, b.department ?? j.department, b.location ?? j.location, b.type ?? j.type,
        b.description ?? j.description, b.skills ?? j.skills,
        b.min_experience != null ? Number(b.min_experience) : j.min_experience, b.status || j.status, j.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/jobs/:id', P, async (req, res) => {
  try {
    await db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Applicants ----
router.post('/jobs/:id/applicants', P, upload.single('resume'), async (req, res) => {
  try {
    const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Candidate name is required.' });
    const app = {
      name: b.name, email: b.email || '', phone: b.phone || '',
      experience_years: Number(b.experience_years) || 0, skills: b.skills || '', source: b.source || 'Manual',
    };
    const score = scoreApplicant(app, job);
    const r = await db.prepare(
      'INSERT INTO applicants (job_id, name, email, phone, experience_years, skills, resume_file, source, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(job.id, app.name, app.email, app.phone, app.experience_years, app.skills, req.file ? await saveFile(req.file.buffer, req.file.mimetype, req.file.originalname) : null, app.source, score);
    res.json({ id: r.lastInsertRowid, score });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/applicants/:id', P, async (req, res) => {
  try {
    const a = await db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    await db.prepare('UPDATE applicants SET stage=?, notes=? WHERE id=?')
      .run(b.stage || a.stage, b.notes != null ? b.notes : a.notes, a.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/applicants/:id', P, async (req, res) => {
  try {
    await db.prepare('DELETE FROM applicants WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/applicants/:id/resume', P, async (req, res) => {
  try {
    const a = await db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
    if (!a || !a.resume_file) return res.status(404).send('No resume');
    return await sendFile(res, a.resume_file, { download: true });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Auto-screen every un-decided applicant against the job requirement and route
// each one automatically: strong fit -> shortlisted, weak -> rejected, borderline
// -> maybe. Uses the AI verdict (falls back to the keyword score when AI is off).
// Only touches 'applied' and 'maybe' — never overrides a human decision
// (shortlisted/interview/offer/hired/rejected stay put).
async function autoScreenJob(req, res) {
  try {
    const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const applicants = await db.prepare("SELECT * FROM applicants WHERE job_id = ? AND stage IN ('applied','maybe')").all(job.id);
    const aiConfigured = ai.isConfigured();
    const counts = { shortlisted: 0, maybe: 0, rejected: 0 };
    const upd = db.prepare('UPDATE applicants SET score = ?, ai_score = ?, ai_recommendation = ?, ai_summary = ?, stage = ? WHERE id = ?');
    for (const a of applicants) {
      const score = scoreApplicant(a, job);
      const aiRes = await screening.aiScreen(job, { experience_years: a.experience_years, skills: a.skills, note: '' });
      const stage = screening.decideStage({ keywordScore: score, ai: aiRes, aiConfigured });
      await upd.run(
        score,
        aiRes ? aiRes.score : a.ai_score,
        aiRes ? aiRes.recommendation : a.ai_recommendation,
        aiRes ? aiRes.summary : a.ai_summary,
        stage, a.id
      );
      if (counts[stage] != null) counts[stage]++;
    }
    res.json({ ok: true, evaluated: applicants.length, ...counts, aiUsed: aiConfigured });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
router.post('/jobs/:id/auto-screen', P, autoScreenJob);
router.post('/jobs/:id/auto-shortlist', P, autoScreenJob); // back-compat alias

// ---- Interviews ----
router.post('/applicants/:id/interviews', P, async (req, res) => {
  try {
    const a = await db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (!b.scheduled_at) return res.status(400).json({ error: 'Interview date/time is required.' });
    const r = await db.prepare(
      'INSERT INTO interviews (applicant_id, round, scheduled_at, interviewer, interviewer_email, mode) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(a.id, b.round || 'Interview', b.scheduled_at, b.interviewer || '', b.interviewer_email || '', b.mode || 'Online');
    // Move applicant into the interview stage.
    if (['applied', 'shortlisted'].includes(a.stage)) await db.prepare("UPDATE applicants SET stage='interview' WHERE id=?").run(a.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Hire -> create employee + automated onboarding journey ----
router.post('/applicants/:id/hire', P, async (req, res) => {
  const a = await db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(a.job_id);
  try {
    const { employee, tempPassword } = await createEmployee({
      name: a.name, email: a.email, phone: a.phone,
      designation: job ? job.title : '', department: job ? job.department : '',
      date_of_joining: new Date().toISOString().slice(0, 10),
    });
    // New hires start NOT onboarded and flow through the automated journey.
    await db.prepare('UPDATE employees SET onboarded = 0, onboarded_at = NULL, onboarding_submitted = 0, onboarding_submitted_at = NULL WHERE id = ?').run(employee.id);
    await buildJourney(employee.id);
    await db.prepare("UPDATE applicants SET stage='hired' WHERE id=?").run(a.id);
    // Notify managers/IT to create the department's required accounts.
    const accountSetup = await provisionAccountsForOnboarding(employee.id, req.session.user.id);
    await syncAutomatedTasks(employee.id);
    res.json({ ok: true, employeeId: employee.id, tempPassword, accountSetup });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
