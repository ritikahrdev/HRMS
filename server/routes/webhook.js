const express = require('express');
const db = require('../db');
const { getSettings } = require('../services/settings');

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

// POST /api/webhook/attendance
// Trusted systems push attendance here with the X-Webhook-Secret header.
router.post('/attendance', async (req, res) => {
  // 1) Validate the webhook secret.
  const secret = configuredSecret();
  const provided = req.get('X-Webhook-Secret');
  if (!secret || !provided || !safeEqual(provided, secret)) {
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
  if (!name) return res.status(400).json({ success: false, error: 'Missing required field: name.' });
  if (!statusRaw) return res.status(400).json({ success: false, error: 'Missing required field: status.' });
  if (!time) return res.status(400).json({ success: false, error: 'Missing required field: time.' });

  const mapped = STATUS_MAP[statusRaw.toLowerCase()];
  if (!mapped) {
    return res.status(400).json({ success: false, error: `Unsupported status "${statusRaw}". Supported values: Present, Absent, WFH, Holiday.` });
  }

  // 3) Resolve the attendance date from the provided time.
  const parsed = new Date(time);
  if (isNaN(parsed.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid time format. Use ISO 8601, e.g. "2026-06-09T09:15:00Z".' });
  }
  const dateMatch = time.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : parsed.toISOString().slice(0, 10);

  // 4) Find the employee by name (prefer an active match).
  const emp = await db.prepare(
    "SELECT id, name FROM employees WHERE lower(trim(name)) = lower(trim(?)) " +
    "ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END LIMIT 1"
  ).get(name);
  if (!emp) {
    return res.status(404).json({ success: false, error: `Employee not found: "${name}". No attendance was recorded.` });
  }

  // 5) Upsert attendance (idempotent — never creates duplicates for the same day).
  const check_in = mapped.status === 'present' ? parsed.toISOString() : null;
  try {
    await upsert.run({ employee_id: emp.id, date, check_in, status: mapped.status, wfh: mapped.wfh, reason });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to update attendance: ' + e.message });
  }

  // 6) Success response.
  return res.json({
    success: true,
    message: 'Attendance updated successfully',
    employee: emp.name,
    status: statusRaw,
    time,
    date,
    reason: reason || null,
    processedAt: new Date().toISOString(),
  });
});

module.exports = router;
