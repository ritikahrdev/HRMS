const nodemailer = require('nodemailer');
const config = require('../config');
const db = require('../db');

// Brevo HTTPS API key (preferred transport). Free hosts (Render free tier)
// block outbound SMTP ports, but HTTPS (443) is always open — so when
// BREVO_API_KEY is set, mail goes via Brevo's REST API instead of SMTP.
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';

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

// "HR Team <hr@x.com>" -> { name: 'HR Team', email: 'hr@x.com' }
function parseFrom(from) {
  const m = String(from || '').match(/^(.*)<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || undefined, email: m[2].trim() };
  return { email: String(from || '').trim() };
}

async function sendViaBrevoApi({ from, to, subject, html, text, attachments, cc }) {
  const toList = (addr) => String(addr || '').split(',').map((s) => ({ email: s.trim() })).filter((x) => x.email);
  const payload = {
    sender: parseFrom(from),
    to: toList(to),
    subject: subject || '(no subject)',
  };
  const ccList = toList(cc);
  if (ccList.length) payload.cc = ccList;
  if (html) payload.htmlContent = html;
  if (text || !html) payload.textContent = text || ' ';
  if (attachments && attachments.length) {
    const fs = require('fs');
    payload.attachment = attachments.map((a) => ({
      name: a.filename || 'attachment',
      content: a.content
        ? Buffer.from(a.content).toString('base64')
        : fs.readFileSync(a.path).toString('base64'),
    }));
  }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Brevo API ${r.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Sends an email. If email is disabled or not configured, it is logged only,
 * so the rest of the app keeps working without any SMTP setup.
 * Attachments: [{ filename, path }] (optional)
 */
async function sendMail({ to, subject, html, text, attachments, cc }) {
  const e = config.email || {};
  const logStmt = db.prepare(
    'INSERT INTO email_log (to_addr, subject, status, error, body) VALUES (?, ?, ?, ?, ?)'
  );

  // Test kill-switch: when MAIL_DISABLED=1 (used by the test suites), skip the
  // real send entirely so automated runs never email real people. Still logged
  // so flows that read email_log keep working.
  if (process.env.MAIL_DISABLED === '1') {
    await logStmt.run(to || '', subject || '', 'skipped', 'MAIL_DISABLED', text || html || '');
    return { ok: true, skipped: true };
  }

  if (!to) {
    await logStmt.run('', subject || '', 'error', 'No recipient', '');
    return { ok: false, reason: 'no-recipient' };
  }

  // Preferred: Brevo HTTPS API (works on hosts that block SMTP ports).
  if (BREVO_API_KEY) {
    try {
      await sendViaBrevoApi({ from: e.from || e.user, to, subject, html, text, attachments, cc });
      await logStmt.run(to, subject || '', 'sent', null, text || html || '');
      return { ok: true };
    } catch (err) {
      await logStmt.run(to, subject || '', 'error', String(err.message || err), '');
      console.error('Email send failed (Brevo API):', err.message);
      return { ok: false, reason: 'error', error: err.message };
    }
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
      cc: cc || undefined,
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
