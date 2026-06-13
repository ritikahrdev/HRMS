// Stores uploaded files (documents, resumes, bills, logos) as bytes inside
// Postgres, so they persist on disk-less / ephemeral free hosts (Render free,
// Vercel, Netlify) with no extra storage service or credentials. The generated
// key is stored in the existing columns (employee_documents.file, etc.) exactly
// where the on-disk filename used to go, so the rest of the app is unchanged.
const crypto = require('crypto');
const path = require('path');
const db = require('../db');

// Save a buffer, return its storage key (used as the "filename").
async function saveFile(buffer, mime, originalName) {
  const ext = originalName ? path.extname(originalName) : '';
  const key = crypto.randomBytes(16).toString('hex') + ext;
  await db.prepare('INSERT INTO file_store (id, mime, filename, data) VALUES (?, ?, ?, ?)')
    .run(key, mime || 'application/octet-stream', originalName || key, buffer);
  return key;
}

// Fetch a file by key -> { mime, filename, data(Buffer) } or undefined.
async function getFile(key) {
  if (!key) return undefined;
  return db.prepare('SELECT mime, filename, data FROM file_store WHERE id = ?').get(key);
}

async function deleteFile(key) {
  if (key) { try { await db.prepare('DELETE FROM file_store WHERE id = ?').run(key); } catch (e) { /* ignore */ } }
}

// Express helper: stream a stored file to the response, or 404.
// Only these MIME types are safe to display inline in the browser. Everything
// else (HTML, SVG, text/plain, etc.) is forced to download as an attachment so a
// stored file can never execute script in the app's origin.
const INLINE_SAFE = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i;

async function sendFile(res, key, { download } = {}) {
  const f = await getFile(key);
  if (!f || !f.data) { res.status(404).send('File not found'); return false; }
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  // Never let the browser MIME-sniff a stored file into something executable.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const forceAttachment = download || !INLINE_SAFE.test(f.mime || '');
  if (forceAttachment) {
    const safeName = String(f.filename || 'file').replace(/[\r\n"\\]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  }
  res.send(f.data);
  return true;
}

module.exports = { saveFile, getFile, deleteFile, sendFile };
