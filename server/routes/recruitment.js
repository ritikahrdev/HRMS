const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const { requirePerm } = require('../middleware/auth');
const { upload } = require('../services/upload');
const { createEmployee } = require('../services/employees');

const router = express.Router();
const P = requirePerm('recruitment:manage');

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
router.get('/jobs', P, (req, res) => {
  const rows = db.prepare(
    `SELECT j.*, (SELECT COUNT(*) FROM applicants a WHERE a.job_id = j.id) AS applicants,
            (SELECT COUNT(*) FROM applicants a WHERE a.job_id = j.id AND a.stage='hired') AS hired
     FROM jobs j ORDER BY j.status, j.created_at DESC`
  ).all();
  res.json({ jobs: rows });
});

router.get('/jobs/:id', P, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const applicants = db.prepare('SELECT * FROM applicants WHERE job_id = ? ORDER BY score DESC, created_at DESC').all(job.id);
  const interviews = db.prepare(
    `SELECT iv.*, a.name AS applicant_name FROM interviews iv
     JOIN applicants a ON a.id = iv.applicant_id WHERE a.job_id = ? ORDER BY iv.scheduled_at`
  ).all(job.id);
  res.json({ job, applicants, interviews });
});

router.post('/jobs', P, (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Job title is required.' });
  const r = db.prepare(
    'INSERT INTO jobs (title, department, location, type, description, skills, min_experience, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(b.title, b.department || '', b.location || '', b.type || 'Full-time', b.description || '', b.skills || '', Number(b.min_experience) || 0, req.session.user.id);
  res.json({ id: r.lastInsertRowid });
});

router.put('/jobs/:id', P, (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare('UPDATE jobs SET title=?, department=?, location=?, type=?, description=?, skills=?, min_experience=?, status=? WHERE id=?')
    .run(b.title ?? j.title, b.department ?? j.department, b.location ?? j.location, b.type ?? j.type,
      b.description ?? j.description, b.skills ?? j.skills,
      b.min_experience != null ? Number(b.min_experience) : j.min_experience, b.status || j.status, j.id);
  res.json({ ok: true });
});

router.delete('/jobs/:id', P, (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Applicants ----
router.post('/jobs/:id/applicants', P, upload.single('resume'), (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Candidate name is required.' });
  const app = {
    name: b.name, email: b.email || '', phone: b.phone || '',
    experience_years: Number(b.experience_years) || 0, skills: b.skills || '', source: b.source || 'Manual',
  };
  const score = scoreApplicant(app, job);
  const r = db.prepare(
    'INSERT INTO applicants (job_id, name, email, phone, experience_years, skills, resume_file, source, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(job.id, app.name, app.email, app.phone, app.experience_years, app.skills, req.file ? req.file.filename : null, app.source, score);
  res.json({ id: r.lastInsertRowid, score });
});

router.put('/applicants/:id', P, (req, res) => {
  const a = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare('UPDATE applicants SET stage=?, notes=? WHERE id=?')
    .run(b.stage || a.stage, b.notes != null ? b.notes : a.notes, a.id);
  res.json({ ok: true });
});

router.delete('/applicants/:id', P, (req, res) => {
  db.prepare('DELETE FROM applicants WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/applicants/:id/resume', P, (req, res) => {
  const a = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!a || !a.resume_file) return res.status(404).send('No resume');
  const fp = path.join(config.paths.uploads, a.resume_file);
  if (!fs.existsSync(fp)) return res.status(404).send('File missing');
  res.sendFile(fp);
});

// Auto-shortlist applicants meeting the criteria threshold (default 60%).
router.post('/jobs/:id/auto-shortlist', P, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const threshold = Number(req.body && req.body.threshold) || 60;
  const applicants = db.prepare("SELECT * FROM applicants WHERE job_id = ? AND stage IN ('applied','shortlisted')").all(job.id);
  let shortlisted = 0;
  const upd = db.prepare('UPDATE applicants SET score = ?, stage = ? WHERE id = ?');
  for (const a of applicants) {
    const score = scoreApplicant(a, job);
    const stage = score >= threshold ? 'shortlisted' : a.stage;
    upd.run(score, stage, a.id);
    if (score >= threshold) shortlisted++;
  }
  res.json({ ok: true, evaluated: applicants.length, shortlisted, threshold });
});

// ---- Interviews ----
router.post('/applicants/:id/interviews', P, (req, res) => {
  const a = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (!b.scheduled_at) return res.status(400).json({ error: 'Interview date/time is required.' });
  const r = db.prepare(
    'INSERT INTO interviews (applicant_id, round, scheduled_at, interviewer, interviewer_email, mode) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(a.id, b.round || 'Interview', b.scheduled_at, b.interviewer || '', b.interviewer_email || '', b.mode || 'Online');
  // Move applicant into the interview stage.
  if (['applied', 'shortlisted'].includes(a.stage)) db.prepare("UPDATE applicants SET stage='interview' WHERE id=?").run(a.id);
  res.json({ id: r.lastInsertRowid });
});

// ---- Hire -> create employee + onboarding checklist ----
const ONBOARDING = [
  'Sign offer letter & policies', 'Submit ID & address proof', 'Submit bank & PAN details',
  'Set up work email & accounts', 'Assign workstation / laptop', 'Introduction to the team', 'Read employee handbook',
];
router.post('/applicants/:id/hire', P, (req, res) => {
  const a = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(a.job_id);
  try {
    const { employee, tempPassword } = createEmployee({
      name: a.name, email: a.email, phone: a.phone,
      designation: job ? job.title : '', department: job ? job.department : '',
      date_of_joining: new Date().toISOString().slice(0, 10),
    });
    // Apply onboarding checklist.
    const ins = db.prepare('INSERT INTO onboarding_tasks (employee_id, title, position) VALUES (?, ?, ?)');
    ONBOARDING.forEach((t, i) => ins.run(employee.id, t, i + 1));
    db.prepare("UPDATE applicants SET stage='hired' WHERE id=?").run(a.id);
    res.json({ ok: true, employeeId: employee.id, tempPassword });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
