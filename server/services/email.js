const nodemailer = require('nodemailer');
const config = require('../config');
const db = require('../db');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const e = config.email || {};
  if (!e.enabled) return null;
  transporter = nodemailer.createTransport({
    host: e.host,
    port: e.port,
    secure: !!e.secure,
    auth: { user: e.user, pass: e.pass },
  });
  return transporter;
}

/**
 * Sends an email. If email is disabled or not configured, it is logged only,
 * so the rest of the app keeps working without any SMTP setup.
 * Attachments: [{ filename, path }] (optional)
 */
async function sendMail({ to, subject, html, text, attachments }) {
  const e = config.email || {};
  const logStmt = db.prepare(
    'INSERT INTO email_log (to_addr, subject, status, error, body) VALUES (?, ?, ?, ?, ?)'
  );

  if (!to) {
    await logStmt.run('', subject || '', 'error', 'No recipient', '');
    return { ok: false, reason: 'no-recipient' };
  }

  const t = getTransporter();
  if (!t) {
    await logStmt.run(to, subject || '', 'disabled', null, text || html || '');
    console.log(`[email disabled] would send "${subject}" to ${to}`);
    return { ok: false, reason: 'disabled' };
  }

  try {
    await t.sendMail({
      from: e.from || e.user,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
      attachments: attachments || undefined,
    });
    await logStmt.run(to, subject || '', 'sent', null, text || html || '');
    return { ok: true };
  } catch (err) {
    await logStmt.run(to, subject || '', 'error', String(err.message || err), '');
    console.error('Email send failed:', err.message);
    return { ok: false, reason: 'error', error: err.message };
  }
}

module.exports = { sendMail };
