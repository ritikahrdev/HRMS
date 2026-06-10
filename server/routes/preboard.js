const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const { documentUpload } = require('../services/upload');
const { getSettings } = require('../services/settings');
const { SELF_ONBOARDING_FIELDS } = require('../services/employees');
const { notifyUsers } = require('../services/notify');
const { can } = require('../services/permissions');
const { syncAutomatedTasks } = require('../services/onboardingJourney');

const router = express.Router();

// ---------------------------------------------------------------------------
// PUBLIC pre-boarding portal. A candidate accesses this with a private token
// (no company login). Everything is strictly scoped to the one employee that
// token maps to — there is no way to reach any other record.
// ---------------------------------------------------------------------------
function byToken(token) {
  if (!token || typeof token !== 'string' || token.length < 24) return null;
  // A link is only valid while it has not passed its expiry time.
  return db.prepare(
    "SELECT * FROM employees WHERE preboard_token = ? AND (preboard_expires IS NULL OR preboard_expires > datetime('now'))"
  ).get(token) || null;
}

const INVALID = { error: 'This link is invalid or has expired. Please contact HR for a new link.' };

// What the candidate sees: their name, company branding, required documents,
// their own previously-entered details, and what they have uploaded so far.
router.get('/:token', (req, res) => {
  const emp = byToken(req.params.token);
  if (!emp) return res.status(404).json(INVALID);
  const s = getSettings();
  const details = {};
  for (const f of SELF_ONBOARDING_FIELDS) details[f] = emp[f] || '';
  const documents = db.prepare('SELECT id, doc_type, title, status FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at').all(emp.id);
  res.json({
    name: emp.name,
    companyName: s.companyName || '',
    logoFile: s.logoFile || '',
    requiredDocs: s.requiredDocs || [],
    joiningDate: emp.date_of_joining || '',
    submitted: !!emp.onboarding_submitted,
    expiresAt: emp.preboard_expires ? emp.preboard_expires.replace(' ', 'T') + 'Z' : null,
    details,
    documents,
  });
});

// Save the candidate's own details (whitelisted fields only).
router.put('/:token', (req, res) => {
  const emp = byToken(req.params.token);
  if (!emp) return res.status(404).json(INVALID);
  const updates = {};
  for (const f of SELF_ONBOARDING_FIELDS) if (f in req.body) updates[f] = req.body[f] == null ? null : String(req.body[f]).trim();
  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  if (setClause) db.prepare(`UPDATE employees SET ${setClause} WHERE id = @id`).run({ ...updates, id: emp.id });
  res.json({ ok: true });
});

// Upload a document (categorised by doc_type). Stored against the candidate.
router.post('/:token/documents', documentUpload.single('file'), (req, res) => {
  const emp = byToken(req.params.token);
  if (!emp) return res.status(404).json(INVALID);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const docType = (req.body && req.body.doc_type) || '';
  const title = (req.body && req.body.title) || docType || req.file.originalname;
  const r = db.prepare('INSERT INTO employee_documents (employee_id, title, doc_type, file, uploaded_by) VALUES (?, ?, ?, ?, NULL)')
    .run(emp.id, title, docType, req.file.filename);
  res.json({ id: r.lastInsertRowid });
});

// View a file the candidate uploaded (scoped to their own token).
router.get('/:token/documents/:docId/file', (req, res) => {
  const emp = byToken(req.params.token);
  if (!emp) return res.status(404).send('Invalid link');
  const doc = db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?').get(req.params.docId, emp.id);
  if (!doc) return res.status(404).send('Not found');
  const fp = path.resolve(path.join(config.paths.uploads, doc.file));
  const uploadsDir = path.resolve(config.paths.uploads);
  if (!fp.startsWith(uploadsDir + path.sep) && fp !== uploadsDir) return res.status(403).send('Denied');
  if (!fs.existsSync(fp)) return res.status(404).send('Missing');
  res.sendFile(fp);
});

// Remove a document the candidate uploaded (unless HR already verified it).
router.delete('/:token/documents/:docId', (req, res) => {
  const emp = byToken(req.params.token);
  if (!emp) return res.status(404).json(INVALID);
  const doc = db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?').get(req.params.docId, emp.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (doc.status === 'verified') return res.status(400).json({ error: 'This document is already verified and cannot be removed.' });
  db.prepare('DELETE FROM employee_documents WHERE id = ?').run(doc.id);
  res.json({ ok: true });
});

// Candidate submits — mark the form submitted, run automation, notify HR.
router.post('/:token/submit', (req, res) => {
  const emp = byToken(req.params.token);
  if (!emp) return res.status(404).json(INVALID);
  db.prepare("UPDATE employees SET onboarding_submitted = 1, onboarding_submitted_at = datetime('now') WHERE id = ?").run(emp.id);
  try { syncAutomatedTasks(emp.id); } catch (e) { /* non-fatal */ }
  const recipients = new Set();
  if (emp.manager_id) {
    const mu = db.prepare('SELECT user_id FROM employees WHERE id = ?').get(emp.manager_id);
    if (mu && mu.user_id) recipients.add(mu.user_id);
  }
  for (const u of db.prepare('SELECT id, role FROM users').all()) if (can(u.role, 'employees:write')) recipients.add(u.id);
  notifyUsers([...recipients], {
    type: 'onboarding',
    title: `Pre-boarding submitted: ${emp.name}`,
    body: `${emp.name} has filled their joining form and uploaded documents via the pre-boarding link. Please review and verify.`,
    link: '#/onboarding',
  });
  res.json({ ok: true });
});

module.exports = router;
