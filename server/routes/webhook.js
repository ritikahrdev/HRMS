const express = require('express');
const crypto = require('crypto');
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
// COALESCE preserves the "other half" — a check-out won't wipe the check-in, and
// vice versa — so the morning check-in and evening check-out merge into one row.
const upsert = db.prepare(`
  INSERT INTO attendance (employee_id, date, check_in, check_out, work_hours, status, wfh, reason, source)
  VALUES (@employee_id, @date, @check_in, @check_out, @work_hours, @status, @wfh, @reason, 'webhook')
  ON CONFLICT(employee_id, date) DO UPDATE SET
    status     = @status,
    wfh        = @wfh,
    reason     = COALESCE(@reason, attendance.reason),
    source     = 'webhook',
    check_in   = COALESCE(@check_in, attendance.check_in),
    check_out  = COALESCE(@check_out, attendance.check_out),
    work_hours = COALESCE(@work_hours, attendance.work_hours)`);

// The configured secret comes from an env var (preferred for production) or
// from Settings -> Attendance Webhook.
function configuredSecret() {
  return process.env.ATTENDANCE_WEBHOOK_SECRET || (getSettings().webhookSecret || '');
}

// Constant-time comparison that doesn't even leak the secret's length: both
// sides are SHA-256 hashed to a fixed 32 bytes, then compared in constant time.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Interpret an incoming time. If it carries an explicit timezone (a trailing Z
// or ±HH:MM) we trust it. A NAIVE wall-clock (e.g. "2026-06-13T09:23:40" or
// "2026-06-13 09:23") is interpreted in the COMPANY timezone (Settings →
// timezone, default Asia/Kolkata) — NOT UTC. Otherwise a 9:23am IST check-in
// gets stored as 09:23 UTC and shows up 5h30 late (2:53pm) on an IST screen.
function hasExplicitTZ(s) { return /(?:[zZ]|[+\-]\d{2}:?\d{2})\s*$/.test(String(s).trim()); }
function wallToUtcMs(naive, tz) {
  const m = String(naive).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(naive).getTime();
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {}; for (const part of dtf.formatToParts(new Date(guess))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const asTz = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return guess - (asTz - guess); // shift by the tz offset so the wall-clock is preserved
}
function parseTime(s) {
  if (s == null || s === '') return new Date(NaN);
  const str = String(s).trim();
  if (hasExplicitTZ(str)) return new Date(str);
  return new Date(wallToUtcMs(str, (getSettings().timezone) || 'Asia/Kolkata'));
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
  let c = act.filter((e) => { const w = norm(e.name).split(' '); return toks.every((t) => w.includes(t)); }); // all incoming tokens present in the stored name
  if (c.length === 1) return { emp: c[0], by: 'name~tokens' };
  c = act.filter((e) => norm(e.name) === n || norm(e.name).startsWith(n + ' ')); // input is a name prefix
  if (c.length === 1) return { emp: c[0], by: 'name~prefix' };
  // Reverse containment: the STORED name's tokens all appear in the INCOMING name
  // (HRMS has a short "Abhinav", the bot sent the fuller "Abhinav Sharma"). Unique
  // active match only, so it never grabs the wrong person.
  c = act.filter((e) => { const w = norm(e.name).split(' ').filter(Boolean); return w.length && w.every((t) => toks.includes(t)); });
  if (c.length === 1) return { emp: c[0], by: 'name~contained' };
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
  // Optional check-out time + explicit hours (so total work hours can be recorded).
  const checkOutRaw = typeof body.check_out === 'string' ? body.check_out.trim() : (typeof body.checkout === 'string' ? body.checkout.trim() : '');
  const explicitHours = (body.hours != null && body.hours !== '' && Number.isFinite(Number(body.hours))) ? Number(body.hours) : null;
  if (!statusRaw && !checkOutRaw && explicitHours == null) { console.warn('[webhook]   ✗ 400 missing status'); return res.status(400).json({ success: false, error: 'Provide a status (e.g. Present) or a check-out.' }); }
  if (!time) { console.warn('[webhook]   ✗ 400 missing field: time'); return res.status(400).json({ success: false, error: 'Missing required field: time.' }); }

  // 3) Resolve the attendance date from the provided time. A naive wall-clock is
  // read in the company timezone (see parseTime) so stored instants are correct.
  const parsed = parseTime(time);
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
  // Remember the Slack ID the first time we see it, so future lookups are instant.
  const incomingSlackId = body.slack_id || body.slackId || body.user_id;
  if (incomingSlackId && !emp.slack_id) {
    try { await db.prepare('UPDATE employees SET slack_id = ? WHERE id = ?').run(String(incomingSlackId), emp.id); } catch (e) { /* non-fatal */ }
  }

  // 5) Decide whether this is a CHECK-OUT (records check-out time + total hours)
  // or a status / CHECK-IN, then compute the values.
  // Classify the text first (rich result: status, wfh, reason, half). An exact
  // canonical label (STATUS_MAP) wins over the keyword classifier.
  const stMap = STATUS_MAP[statusRaw.toLowerCase()];
  const cls = classifyMessage(statusRaw, getSettings().slack || {});
  const explicit = stMap ? { status: stMap.status, wfh: stMap.wfh, reason: null, half: null }
    : (cls.valid ? { status: cls.status, wfh: cls.wfh ? 1 : 0, reason: cls.reason, half: cls.half } : null);

  const CHECKOUT_RE = /\b(check[\s-]?out|checking out|checked out|clock[\s-]?out|clocking out|logging off|logged off|log off|signing off|signed off|sign off|leaving|out for the day|done for the day|end of day|eod|heading home|going home|wrapping up|wrapped up)\b/i;
  // A bare "out" (with optional emoji/punctuation) means clock-out — but NOT
  // "out of office"/"out of town", which are leave.
  const strippedStatus = statusRaw.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const bareOut = /^out\b/.test(strippedStatus) && !/\bof\s+(?:office|town|the office)\b/.test(strippedStatus);
  // An explicit half-day / leave / absent overrides check-out phrasing (e.g.
  // "leaving early" is a half-day, not a clock-out). A present/WFH that also
  // reads like "heading home"/"leaving" is treated as the clock-out it looks like.
  const statusOverridesCheckout = !!explicit && ['half', 'leave', 'absent'].includes(explicit.status);
  const isCheckout = !statusOverridesCheckout && (!!checkOutRaw || (!!statusRaw && (CHECKOUT_RE.test(statusRaw) || bareOut)));
  const round2 = (h) => Math.round(h * 100) / 100;
  let check_in = null, check_out = null, work_hours = null, status = null, wfh = 0, action = 'check-in';
  let classifiedReason = explicit ? explicit.reason : null;

  if (isCheckout) {
    action = 'check-out';
    let coTime = parsed;
    if (checkOutRaw) { const c = parseTime(checkOutRaw); if (!isNaN(c.getTime())) coTime = c; }
    check_out = coTime.toISOString();
    const ex = await db.prepare('SELECT check_in, status, wfh FROM attendance WHERE employee_id = ? AND date = ?').get(emp.id, date);
    status = (ex && ex.status) ? ex.status : 'present';
    wfh = (ex && ex.wfh) ? ex.wfh : 0;
    if (explicitHours != null) work_hours = round2(explicitHours);
    else if (ex && ex.check_in) { const h = (coTime - new Date(ex.check_in)) / 36e5; work_hours = h > 0 ? round2(h) : 0; }
  } else {
    if (!explicit) {
      console.warn(`[webhook]   ✗ 400 unreadable status: "${statusRaw}"`);
      return res.status(400).json({ success: false, error: `Couldn't read a status from "${statusRaw}". Use Present, WFH, Half day, Leave, Sick, Absent, Holiday — or "out"/"checkout" to clock out.` });
    }
    status = explicit.status; wfh = explicit.wfh;
    check_in = (status === 'present' || status === 'half') ? parsed.toISOString() : null;
    if (checkOutRaw) { const c = parseTime(checkOutRaw); if (!isNaN(c.getTime())) check_out = c.toISOString(); }
    if (explicitHours != null) work_hours = round2(explicitHours);
    else if (check_in && check_out) { const h = (new Date(check_out) - new Date(check_in)) / 36e5; work_hours = h > 0 ? round2(h) : 0; }
  }

  // 6) Upsert (idempotent — one row per employee+date; the COALESCEs above merge
  // a separate check-in and check-out into the same row).
  const finalReason = reason || classifiedReason || null;
  try {
    await upsert.run({ employee_id: emp.id, date, check_in, check_out, work_hours, status, wfh, reason: finalReason });
  } catch (e) {
    console.error('[webhook]   ✗ 500 DB error:', e.message);
    return res.status(500).json({ success: false, error: 'Failed to update attendance: ' + e.message });
  }
  console.log(`[webhook]   ✓ 200 ${action}: ${emp.name} (by ${match.by}) | ${date} | ${status}${wfh ? ' (WFH)' : ''}${check_out ? ' | out ' + check_out.slice(11, 16) : ''}${work_hours != null ? ' | ' + work_hours + 'h' : ''}`);

  // 7) Success response.
  return res.json({
    success: true,
    message: action === 'check-out' ? 'Check-out recorded' : 'Attendance updated successfully',
    employee: emp.name,
    matchedBy: match.by,
    action,
    status,
    check_out: check_out || null,
    hours: work_hours,
    time,
    date,
    reason: finalReason,
    wfh: wfh ? 1 : 0,
    half: classifiedReason && status === 'half' ? (cls.half || null) : null,
    processedAt: new Date().toISOString(),
  });
});

module.exports = router;
