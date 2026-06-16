// Public careers endpoints — NO login. This powers the shareable "Apply" link
// you put on a LinkedIn (or anywhere) job post: candidates land on /careers,
// apply with their resume, and the HRMS automatically keyword-scores them,
// AI-screens them (when AI is configured), and shortlists strong matches.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { getSettings } = require('../services/settings');
const { saveFile } = require('../services/filestore');
const { documentUpload } = require('../services/upload');
const { notifyUsers } = require('../services/notify');
const ai = require('../services/ai');
const screening = require('../services/screening');

const router = express.Router();

// Modest rate limit: a candidate fills one form; bots get cut off.
const applyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many applications from this connection. Please try again later.' } });

// Same keyword scorer recruitment uses (70% skills overlap + 30% experience).
function scoreApplicant(app, job) {
  const jobSkills = String(job.skills || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const appSkills = String(app.skills || '').toLowerCase();
  let skillScore = 0;
  if (jobSkills.length) {
    const hits = jobSkills.filter((s) => appSkills.includes(s)).length;
    skillScore = (hits / jobSkills.length) * 70;
  } else skillScore = 35;
  const minExp = Number(job.min_experience || 0);
  const exp = Number(app.experience_years || 0);
  const expScore = minExp <= 0 ? 30 : Math.min(1, exp / minExp) * 30;
  return Math.round(skillScore + expScore);
}

async function hrUserIds() {
  return (await db.prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN','HR_ADMIN')").all()).map((r) => r.id);
}

// ---- Open roles (public-safe fields only) ----------------------------------
router.get('/jobs', async (req, res) => {
  try {
    const s = getSettings();
    const jobs = await db.prepare(
      "SELECT id, title, department, location, type, description, skills, min_experience, created_at FROM jobs WHERE status='open' ORDER BY created_at DESC"
    ).all();
    res.json({ company: s.companyName || '', logoFile: s.logoFile || '', jobs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Apply (public, multipart resume) ---------------------------------------
router.post('/apply/:jobId', applyLimiter, documentUpload.single('resume'), async (req, res) => {
  try {
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ? AND status='open'").get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'This role is no longer open.' });

    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80);
    const email = String(b.email || '').trim().slice(0, 120);
    const phone = String(b.phone || '').trim().slice(0, 20);
    const skills = String(b.skills || '').trim().slice(0, 500);
    const note = String(b.note || '').trim().slice(0, 1000);
    const experience_years = Math.max(0, Math.min(50, Number(b.experience_years) || 0));
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

    // One application per email per job.
    const dup = await db.prepare('SELECT id FROM applicants WHERE job_id = ? AND lower(email) = lower(?)').get(job.id, email);
    if (dup) return res.status(400).json({ error: "You've already applied for this role — we have your application! 🤝" });

    if (!req.file) return res.status(400).json({ error: 'Please attach your resume to apply.' });
    const resumeKey = await saveFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    const app = { name, email, phone, skills, experience_years };
    const score = scoreApplicant(app, job);
    const r = await db.prepare(
      `INSERT INTO applicants (job_id, name, email, phone, experience_years, skills, resume_file, source, score, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'careers', ?, ?)`
    ).run(job.id, name, email, phone, experience_years, skills, resumeKey, score, note ? 'Candidate note: ' + note : '');
    const applicantId = r.lastInsertRowid;

    // Respond to the candidate immediately; screen + notify in the background.
    res.json({ ok: true, message: 'Application received! Our team will be in touch.' });

    setImmediate(async () => {
      try {
        // AI screening (when configured) — judged against the job requirement.
        const aiRes = await screening.aiScreen(job, { experience_years, skills, note });
        if (aiRes) {
          await db.prepare('UPDATE applicants SET ai_score = ?, ai_recommendation = ?, ai_summary = ? WHERE id = ?')
            .run(aiRes.score, aiRes.recommendation, aiRes.summary, applicantId);
        }
        // Auto-route: strong -> shortlisted, weak -> rejected, borderline -> maybe.
        // No applicant is left sitting in "applied" — that's the no-manual-effort goal.
        const stage = screening.decideStage({ keywordScore: score, ai: aiRes, aiConfigured: ai.isConfigured() });
        if (stage !== 'applied') await db.prepare("UPDATE applicants SET stage = ? WHERE id = ? AND stage = 'applied'").run(stage, applicantId);

        await notifyUsers(await hrUserIds(), {
          type: 'recruitment',
          title: `${screening.STAGE_LABEL[stage] || 'New'} applicant: ${name}`,
          body: `Applied for ${job.title} via the careers link. Match ${score}%${aiRes ? ` · AI: ${aiRes.recommendation} (${aiRes.score}/100)` : ''} → ${stage}.`,
          link: '#/recruitment',
        });
      } catch (e) { console.error('careers post-processing failed:', e.message); }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
