const express = require('express');
const db = require('../db');
const { getSettings } = require('../services/settings');
const { classifyMessage } = require('../services/slackSync');

const router = express.Router();

// Maps an incoming status label -> how we store it in the attendance table.
const STATUS_MAP = {
  present: { status: 'present', wfh: 0 },
  absent:  { status: 'absent',  wfh: 0 },
  wfh:     { status: 'present', wfh: 1 },   // WFH = present, flagged work-from-home
  holiday: { status: 'holiday', wfh: 0 },
};

// Idempotent upsert: one row per (employee, date). Re-sending updates in place.
const upsert = db.prepare(`
  INSERT INTO attendance (employee_id, date, check_in, status, wfh, reason, source)
  VALUES (@employee_id, @date, @check_in, @status, @wfh, @reason, 'webhook')
  ON CONFLICT(employee_id, date) DO UPDATE SET
    status   = @status,
    wfh      = @wfh,
    reason   = COALESCE(@reason, attendance.reason),
    source   = 'webhook',
    check_in = COALESCE(@check_in, attendance.check_in)`);

// The configured secret comes from an env var (preferred for production) or
// from Settings -> Attendance Webhook.
function configuredSecret() {
  return process.env.ATTENDANCE_WEBHOOK_SECRET || (getSettings().webhookSecret || '');
}

// Constant-time-ish comparison to avoid leaking timing info on the secret.
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const lc = (x) => String(x == null ? '' : x).toLowerCase().trim();
// Normalise a person's name: lowercase, treat . and _ as spaces (so a Slack
// handle like "suraj.shukla" matches "Suraj Shukla"), and collapse whitespace.
const norm = (x) => lc(x).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

// Forgiving employee lookup. Tries the strongest identifiers first
// (slack_id → email → emp_code → exact name), then UNIQUE fuzzy name matches
// among ACTIVE employees only — so "Suraj", "suraj shukla", "Shukla Suraj", a
// Slack handle, or a different spelling still resolve instead of a 404 (which is
// what makes the Slack side post a warning). Fuzzy matches resolve only when
// exactly one active employee fits, so it never picks the wrong person.
async function resolveEmployee(body) {
  const all = await db.prepare('SELECT id, name, email, emp_code, slack_id, status FROM employees').all();
  const activeFirst = (rows) => rows.slice().sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));
  const pick = (rows, by) => (rows.length ? { emp: activeFirst(rows)[0], by } : null);

  const slackId = body.slack_id || body.slackId || body.user_id;
  if (slackId) { const m = pick(all.filter((e) => e.slack_id && lc(e.slack_id) === lc(slackId)), 'slack_id'); if (m) return m; }
  if (body.email) { const m = pick(all.filter((e) => e.email && lc(e.email) === lc(body.email)), 'email'); if (m) return m; }
  if (body.emp_code) { const m = pick(all.filter((e) => e.emp_code && lc(e.emp_code) === lc(body.emp_code)), 'emp_code'); if (m) return m; }

  const n = norm(body.name);
  if (!n) return null;
  let m = pick(all.filter((e) => norm(e.name) === n), 'name'); if (m) return m;

  // Fuzzy — unique active match only.
  const act = all.filter((e) => e.status === 'active');
  const toks = n.split(' ').filter(Boolean);
  let c = act.filter((e) => { const w = norm(e.name).split(' '); return toks.every((t) => w.includes(t)); }); // all tokens present, any order
  if (c.length === 1) return { emp: c[0], by: 'name~tokens' };
  c = act.filter((e) => norm(e.name) === n || norm(e.name).startsWith(n + ' ')); // input is a name prefix
  if (c.length === 1) return { emp: c[0], by: 'name~prefix' };
  if (toks.length === 1) { c = act.filter((e) => norm(e.name).split(' ')[0] === toks[0]); if (c.length === 1) return { emp: c[0], by: 'firstname' }; } // unique first name
  return null;
}

// POST /api/webhook/attendance
// Trusted systems push attendance here with the X-Webhook-Secret header.
router.post('/attendance', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const ts = new Date().toISOString();
  console.log(`\n[webhook] ⇢ ${ts}  POST /api/webhook/attendance  from ${ip}`);
  console.log('[webhook]   body:', JSON.stringify(req.body || {}));

  // 1) Validate the webhook secret.
  const secret = configuredSecret();
  const provided = req.get('X-Webhook-Secret');
  if (!secret || !provided || !safeEqual(provided, secret)) {
    console.warn('[webhook]   ✗ 401 rejected — invalid or missing X-Webhook-Secret');
    return res.status(401).json({ success: false, error: 'Unauthorized: invalid or missing webhook secret.' });
  }

  // 2) Validate the payload.
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const statusRaw = typeof body.status === 'string' ? body.status.trim() : '';
  const time = typeof body.time === 'string' ? body.time.trim() : '';
  // Optional note explaining the entry (e.g. "Sick leave", "Client visit"). Kept
  // to a sane length; omitted/blank is fine for backward compatibility.
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) || null : null;
  const hasIdentity = name || body.email || body.slack_id || body.slackId || body.user_id || body.emp_code;
  if (!hasIdentity) { console.warn('[webhook]   ✗ 400 missing identity'); return res.status(400).json({ success: false, error: 'Provide a name, email, or Slack ID to identify the employee.' }); }
  if (!statusRaw) { console.warn('[webhook]   ✗ 400 missing field: status'); return res.status(400).json({ success: false, error: 'Missing required field: status.' }); }
  if (!time) { console.warn('[webhook]   ✗ 400 missing field: time'); return res.status(400).json({ success: false, error: 'Missing required field: time.' }); }

  // Accept a clean label (present/absent/wfh/holiday) OR a natural Slack message
  // ("Present ✅", "in", "wfh today", "on leave", "half day") read with the same
  // classifier the Slack integration uses — so decorated messages don't 400.
  let mapped = STATUS_MAP[statusRaw.toLowerCase()];
  if (!mapped) {
    const cls = classifyMessage(statusRaw, getSettings().slack || {});
    if (cls.valid) mapped = { status: cls.status, wfh: cls.wfh ? 1 : 0 };
  }
  if (!mapped) {
    console.warn(`[webhook]   ✗ 400 unreadable status: "${statusRaw}"`);
    return res.status(400).json({ success: false, error: `Couldn't read a status from "${statusRaw}". Use Present, Absent, WFH, Half day, Leave, or Holiday.` });
  }

  // 3) Resolve the attendance date from the provided time.
  const parsed = new Date(time);
  if (isNaN(parsed.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid time format. Use ISO 8601, e.g. "2026-06-09T09:15:00Z".' });
  }
  const dateMatch = time.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : parsed.toISOString().slice(0, 10);

  // 4) Find the employee (forgiving match: slack_id / email / code / name).
  const match = await resolveEmployee(body);
  if (!match) {
    const who = name || body.email || body.slack_id || body.slackId || body.user_id || '';
    console.warn(`[webhook]   ✗ 404 employee not found: "${who}"`);
    return res.status(404).json({ success: false, error: `Employee not found: "${who}". No attendance was recorded.` });
  }
  const emp = match.emp;
  // Remember the Slack ID the first time we see it, so future lookups are instant
  // and the directory shows the person as Slack-mapped.
  const incomingSlackId = body.slack_id || body.slackId || body.user_id;
  if (incomingSlackId && !emp.slack_id) {
    try { await db.prepare('UPDATE employees SET slack_id = ? WHERE id = ?').run(String(incomingSlackId), emp.id); } catch (e) { /* non-fatal */ }
  }

  // 5) Upsert attendance (idempotent — never creates duplicates for the same day).
  const check_in = (mapped.status === 'present' || mapped.status === 'half') ? parsed.toISOString() : null;
  try {
    await upsert.run({ employee_id: emp.id, date, check_in, status: mapped.status, wfh: mapped.wfh, reason });
  } catch (e) {
    console.error('[webhook]   ✗ 500 DB error:', e.message);
    return res.status(500).json({ success: false, error: 'Failed to update attendance: ' + e.message });
  }
  console.log(`[webhook]   ✓ 200 recorded: ${emp.name} (matched by ${match.by}) | ${date} | ${mapped.status}${mapped.wfh ? ' (WFH)' : ''}${reason ? ` | reason: "${reason}"` : ''}`);

  // 6) Success response.
  return res.json({
    success: true,
    message: 'Attendance updated successfully',
    employee: emp.name,
    matchedBy: match.by,
    status: statusRaw,
    time,
    date,
    reason: reason || null,
    processedAt: new Date().toISOString(),
  });
});

module.exports = router;
