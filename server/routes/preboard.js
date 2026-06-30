const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const { documentUpload } = require('../services/upload');
const { saveFile, getFile, deleteFile, sendFile } = require('../services/filestore');
const { getSettings } = require('../services/settings');
const { SELF_ONBOARDING_FIELDS, ONBOARDING_REQUIRED_FIELDS } = require('../services/employees');
const { notifyUsers } = require('../services/notify');
const { can } = require('../services/permissions');
const { syncAutomatedTasks } = require('../services/onboardingJourney');

const router = express.Router();

// ---------------------------------------------------------------------------
// PUBLIC pre-boarding portal. A candidate accesses this with a private token
// (no company login). Everything is strictly scoped to the one employee that
// token maps to — there is no way to reach any other record.
// ---------------------------------------------------------------------------
async function byToken(token) {
  if (!token || typeof token !== 'string' || token.length < 24) return null;
  // A link is only valid while it has not passed its expiry time.
  return await db.prepare(
    "SELECT * FROM employees WHERE preboard_token = ? AND (preboard_expires IS NULL OR preboard_expires > datetime('now'))"
  ).get(token) || null;
}

const INVALID = { error: 'This link is invalid or has expired. Please contact HR for a new link.' };

// Every field shown on the candidate form is mandatory before they can submit.
const REQUIRED_FIELDS = ONBOARDING_REQUIRED_FIELDS;

// What the candidate sees: their name, company branding, required documents,
// their own previously-entered details, and what they have uploaded so far.
router.get('/:token', async (req, res) => {
  try {
    const emp = await byToken(req.params.token);
    if (!emp) return res.status(404).json(INVALID);
    const s = getSettings();
    const details = {};
    for (const f of SELF_ONBOARDING_FIELDS) details[f] = emp[f] || '';
    const documents = await db.prepare('SELECT id, doc_type, title, status FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at').all(emp.id);
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save the candidate's own details (whitelisted fields only).
router.put('/:token', async (req, res) => {
  try {
    const emp = await byToken(req.params.token);
    if (!emp) return res.status(404).json(INVALID);
    const updates = {};
    for (const f of SELF_ONBOARDING_FIELDS) if (f in req.body) updates[f] = req.body[f] == null ? null : String(req.body[f]).trim();
    const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    if (setClause) await db.prepare(`UPDATE employees SET ${setClause} WHERE id = @id`).run({ ...updates, id: emp.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run the single-file upload but turn any rejection (unsupported type / too
// large) into a clean 400 the candidate can read, instead of a generic error.
function uploadOne(req, res, next) {
  documentUpload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'That file is too large — please keep each file under 15 MB.'
        : (err.message || 'Upload failed.');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

// Upload a document (categorised by doc_type). Stored against the candidate.
router.post('/:token/documents', uploadOne, async (req, res) => {
  try {
    const emp = await byToken(req.params.token);
    if (!emp) return res.status(404).json(INVALID);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const docType = (req.body && req.body.doc_type) || '';
    const title = (req.body && req.body.title) || docType || req.file.originalname;
    const r = await db.prepare('INSERT INTO employee_documents (employee_id, title, doc_type, file, uploaded_by) VALUES (?, ?, ?, ?, NULL)')
      .run(emp.id, title, docType, await saveFile(req.file.buffer, req.file.mimetype, req.file.originalname));
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// View a file the candidate uploaded (scoped to their own token).
router.get('/:token/documents/:docId/file', async (req, res) => {
  try {
    const emp = await byToken(req.params.token);
    if (!emp) return res.status(404).send('Invalid link');
    const doc = await db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?').get(req.params.docId, emp.id);
    if (!doc) return res.status(404).send('Not found');
    return await sendFile(res, doc.file);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// Remove a document the candidate uploaded (unless HR already verified it).
router.delete('/:token/documents/:docId', async (req, res) => {
  try {
    const emp = await byToken(req.params.token);
    if (!emp) return res.status(404).json(INVALID);
    const doc = await db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?').get(req.params.docId, emp.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.status === 'verified') return res.status(400).json({ error: 'This document is already verified and cannot be removed.' });
    await db.prepare('DELETE FROM employee_documents WHERE id = ?').run(doc.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Candidate submits — mark the form submitted, run automation, notify HR.
router.post('/:token/submit', async (req, res) => {
  try {
    const emp = await byToken(req.params.token);
    if (!emp) return res.status(404).json(INVALID);

    // Enforce: every field filled + every required document uploaded.
    const missingFields = REQUIRED_FIELDS.filter((f) => !String(emp[f] == null ? '' : emp[f]).trim());
    const requiredDocs = getSettings().requiredDocs || [];
    const haveTypes = new Set(
      (await db.prepare('SELECT doc_type FROM employee_documents WHERE employee_id = ?').all(emp.id))
        .filter((d) => d.doc_type).map((d) => d.doc_type)
    );
    const missingDocs = requiredDocs.filter((t) => !haveTypes.has(t));
    if (missingFields.length || missingDocs.length) {
      return res.status(400).json({
        error: 'Please complete all fields and upload all required documents before submitting.',
        missingFields,
        missingDocs,
      });
    }

    await db.prepare("UPDATE employees SET onboarding_submitted = 1, onboarding_submitted_at = datetime('now') WHERE id = ?").run(emp.id);
    try { await syncAutomatedTasks(emp.id); } catch (e) { /* non-fatal */ }
    const recipients = new Set();
    if (emp.manager_id) {
      const mu = await db.prepare('SELECT user_id FROM employees WHERE id = ?').get(emp.manager_id);
      if (mu && mu.user_id) recipients.add(mu.user_id);
    }
    for (const u of await db.prepare('SELECT id, role FROM users').all()) if (can(u.role, 'employees:write')) recipients.add(u.id);
    await notifyUsers([...recipients], {
      type: 'onboarding',
      title: `Pre-boarding submitted: ${emp.name}`,
      body: `${emp.name} has filled their joining form and uploaded documents via the pre-boarding link. Please review and verify.`,
      link: '#/onboarding',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
