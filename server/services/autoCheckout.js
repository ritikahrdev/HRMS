// Auto check-out: people who mark Present/WFH/Half via Slack only ever check
// IN — they never clock out — so check_out stays NULL and work hours never get
// recorded (the Team Attendance "Hours" column shows blank). This stamps a
// default clock-out time (Settings → autoCheckoutTime, default "19:30" = 7:30
// PM company-time) for any such row and computes the hours.
//
// Safe by design: only rows with a check-in AND no check-out are touched, so a
// real clock-out is never overwritten; the marked status is left as-is (we only
// fill the missing time + hours, never re-judge Present→Half). Idempotent — once
// a row has a check-out it's skipped, so this can run as often as we like.
const db = require('../db');
const { getSettings } = require('./settings');

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

// Today's date (YYYY-MM-DD) in the company timezone.
function companyToday(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Kolkata' }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

// "<date> HH:MM in tz" -> the matching UTC instant (ms). Mirrors the webhook's
// wall-clock→UTC conversion so 19:30 IST is stored as 14:00Z and displays as
// 7:30 PM in an IST browser, exactly like a real check-in.
function wallToUtcMs(date, h, m, tz) {
  const [Y, Mo, D] = String(date).split('-').map(Number);
  const guess = Date.UTC(Y, Mo - 1, D, h, m, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(guess))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asTz = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return guess - (asTz - guess);
}

// Fill a default check-out + work hours for PAST days only (today stays live).
// Pass a date string to limit to one day (used when a Team Attendance day is
// opened, for instant results — a no-op if that day is today); omit it to
// process every pending past day (used by the daily automation, which also
// backfills history on its first run). Returns a small summary.
async function autoCloseAttendance(onlyDate) {
  const s = getSettings();
  const raw = s.autoCheckoutTime == null ? '19:30' : String(s.autoCheckoutTime).trim();
  if (!raw || /^(off|none|disabled|0)$/i.test(raw)) return { skipped: 'disabled' };
  const hm = parseHM(raw);
  if (!hm) return { skipped: 'bad_time', value: raw };
  const tz = s.timezone || 'Asia/Kolkata';
  // Only CLOSED (past) days get a default check-out. TODAY is left open so its
  // hours tick LIVE (check-in → now) in the UI; it earns the 7:30 stamp only
  // once it rolls over into a past day.
  const today = companyToday(tz);

  let sql =
    "SELECT id, date, check_in FROM attendance WHERE check_out IS NULL AND check_in IS NOT NULL AND status IN ('present','half') AND date < ?";
  const params = [today];
  if (onlyDate) { sql += ' AND date = ?'; params.push(onlyDate); }
  const rows = await db.prepare(sql).all(...params);

  let filled = 0;
  for (const r of rows) {
    const inMs = new Date(r.check_in).getTime();
    if (!Number.isFinite(inMs)) continue;
    const outMs = wallToUtcMs(r.date, hm.h, hm.m, tz);
    if (!Number.isFinite(outMs) || outMs <= inMs) continue; // never zero/negative hours
    const hours = +(((outMs - inMs) / 36e5).toFixed(2));
    await db.prepare('UPDATE attendance SET check_out = ?, work_hours = ? WHERE id = ?')
      .run(new Date(outMs).toISOString(), hours, r.id);
    filled++;
  }
  return { filled, checkout: raw, scope: onlyDate || 'all' };
}

module.exports = { autoCloseAttendance, wallToUtcMs };
