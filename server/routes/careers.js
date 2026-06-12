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

    const resumeKey = req.file ? await saveFile(req.file.buffer, req.file.mimetype, req.file.originalname) : null;
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
        // AI screening (when configured) — judged against the job.
        let aiRes = null;
        if (ai.isConfigured()) {
          try {
            const system = 'You are a fair, unbiased recruiter screening a candidate against a job. Score fit 0–100. Be objective; ignore name, gender, age, or anything unrelated to ability to do the job.';
            const prompt = `JOB:\nTitle: ${job.title}\nRequired skills: ${job.skills || '—'}\nMin experience: ${job.min_experience || 0} yrs\nDescription: ${(job.description || '').slice(0, 800)}\n\nCANDIDATE:\nExperience: ${experience_years} yrs\nSkills: ${skills || '—'}\nNote: ${note || '—'}\n\nReturn JSON: {"score":0-100,"recommendation":"strong"|"maybe"|"weak","summary":"2-sentence summary"}`;
            aiRes = await ai.completeJSON(system, prompt, 400);
            await db.prepare('UPDATE applicants SET ai_score = ?, ai_recommendation = ?, ai_summary = ? WHERE id = ?')
              .run(Math.max(0, Math.min(100, Number(aiRes.score) || 0)), String(aiRes.recommendation || '').slice(0, 12), String(aiRes.summary || '').slice(0, 400), applicantId);
          } catch (e) { /* AI optional — keyword score still stands */ }
        }
        // Auto-shortlist: keyword score >= 60, or the AI says strong.
        const shortlist = score >= 60 || (aiRes && aiRes.recommendation === 'strong');
        if (shortlist) await db.prepare("UPDATE applicants SET stage='shortlisted' WHERE id = ? AND stage='applied'").run(applicantId);

        await notifyUsers(await hrUserIds(), {
          type: 'recruitment',
          title: `${shortlist ? '⭐ Shortlisted' : 'New'} applicant: ${name}`,
          body: `Applied for ${job.title} via the careers link. Match ${score}%${aiRes ? ` · AI: ${aiRes.recommendation} (${aiRes.score}/100)` : ''}.`,
          link: '#/recruitment',
        });
      } catch (e) { console.error('careers post-processing failed:', e.message); }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
