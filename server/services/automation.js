// Daily automation engine. Runs the recurring HR chores on its own so the
// system keeps working when HR is away — birthdays, work anniversaries, holiday
// reminders, monthly leave accrual, year-end carry-forward, and (optionally) a
// Slack attendance backup sync. Every chore is idempotent, so the tick can fire
// many times a day and still do each thing exactly once.
const db = require('./../db');
const { getSettings, saveSettings } = require('./settings');
const { sendMail } = require('./email');
const { notifyUsers } = require('./notify');
const birthday = require('./birthdayWishes');
const accrual = require('./leaveAccrual');
const { sendHolidayNotifications } = require('./holidayNotifications');

const companyToday = () => birthday.companyToday();
function nowStamp() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: getSettings().timezone || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return new Date().toISOString(); }
}
function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }

// ---- Work anniversary poster (email-safe HTML) ----
function anniversaryHtml(emp, years, companyName) {
  const co = companyName || 'the team';
  return `
  <div style="background:#f3f4f8;padding:26px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto"><tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:20px;overflow:hidden;box-shadow:0 10px 34px rgba(13,148,136,0.20)">
        <tr><td bgcolor="#0d9488" style="background:linear-gradient(135deg,#0d9488 0%,#0891b2 55%,#4f46e5 100%);padding:40px 24px 34px;text-align:center">
          <div style="font-size:30px;line-height:1.2">🎊&nbsp;&nbsp;🏅&nbsp;&nbsp;🎉&nbsp;&nbsp;🌟&nbsp;&nbsp;🎊</div>
          <div style="color:#fff;font-size:13px;letter-spacing:6px;font-weight:700;margin-top:18px;text-transform:uppercase;opacity:.92">Work Anniversary</div>
          <div style="color:#fff;font-size:40px;font-weight:800;margin-top:8px;line-height:1.1">${years} Year${years > 1 ? 's' : ''}!</div>
          <div style="color:#e0f2fe;font-size:18px;margin-top:8px">Congratulations, ${firstName(emp.name)} 🎉</div>
        </td></tr>
        <tr><td bgcolor="#ffffff" style="background:#fff;padding:32px 34px 8px;text-align:center">
          <p style="color:#1f2937;font-size:17px;line-height:1.7;margin:0 0 14px;font-weight:600">Thank you for ${years} wonderful year${years > 1 ? 's' : ''} with ${co}! 🙌</p>
          <p style="color:#4b5563;font-size:15px;line-height:1.75;margin:0">Your dedication and hard work mean the world to us.<br/>Here's to many more milestones together!</p>
          <div style="font-size:34px;margin:18px 0 4px">🏆&nbsp;&nbsp;🎂&nbsp;&nbsp;🎈</div>
        </td></tr>
        <tr><td bgcolor="#f0fdfa" style="background:#f0fdfa;padding:20px 30px 28px;text-align:center;border-top:1px solid #d9f2ee">
          <div style="color:#0d9488;font-weight:600;font-size:14px">With appreciation,</div>
          <div style="color:#1f2937;font-weight:800;font-size:17px;margin-top:2px">The ${co} Team 💙</div>
        </td></tr>
      </table>
    </td></tr></table>
  </div>`;
}

// ---- Work anniversary wishes (today, ≥1 year) ----
async function sendTodaysAnniversaries() {
  const s = getSettings();
  const today = companyToday();
  const mmdd = today.slice(5), year = Number(today.slice(0, 4));
  const emps = await db.prepare(
    "SELECT id, name, email, user_id, date_of_joining FROM employees WHERE status='active' AND date_of_joining IS NOT NULL AND date_of_joining <> ''"
  ).all();
  let sent = 0, skipped = 0;
  for (const e of emps) {
    if (String(e.date_of_joining).slice(5, 10) !== mmdd) continue;
    const years = year - Number(String(e.date_of_joining).slice(0, 4));
    if (years < 1) continue;
    if (e.user_id) {
      await notifyUsers([e.user_id], {
        type: 'anniversary',
        title: `🎊 ${years}-Year Work Anniversary!`,
        body: `Congratulations on ${years} year${years > 1 ? 's' : ''} with ${s.companyName || 'us'}! 🎉`,
        link: '#/',
      }).catch(() => {});
    }
    if (!e.email) { skipped++; continue; }
    const exists = await db.prepare(
      "SELECT 1 FROM email_log WHERE to_addr=? AND subject LIKE 'Happy Work Anniversary%' AND substr(created_at,1,4)=? LIMIT 1"
    ).get(e.email, String(year));
    if (exists) { skipped++; continue; }
    await sendMail({
      to: e.email,
      subject: `Happy Work Anniversary, ${firstName(e.name)}! 🎊`,
      html: anniversaryHtml(e, years, s.companyName),
    }).catch((err) => console.error('Anniversary email failed for', e.email, err.message));
    sent++;
  }
  return { sent, skipped };
}

// ---- The orchestrator ----
async function runDailyAutomations(opts = {}) {
  const s = getSettings();
  const auto = s.automation || {};
  if (auto.enabled === false && !opts.force) return { skipped: 'disabled' };
  const today = companyToday();
  const results = {};

  if (auto.birthdays !== false) {
    try { results.birthdays = await birthday.sendTodaysBirthdayWishes(); } catch (e) { results.birthdays = { error: e.message }; }
  }
  if (auto.anniversaries !== false) {
    try { results.anniversaries = await sendTodaysAnniversaries(); } catch (e) { results.anniversaries = { error: e.message }; }
  }
  if (auto.holidayReminders !== false) {
    try { results.holidays = await sendHolidayNotifications({ onlyNew: true }); } catch (e) { results.holidays = { error: e.message }; }
  }
  if (auto.leaveAccrual !== false && accrual.isEnabled()) {
    try { results.accrual = await accrual.catchUpYear(Number(today.slice(0, 4)), null); } catch (e) { results.accrual = { error: e.message }; }
    // Year-end carry-forward: in January, carry the previous year (once).
    if (today.slice(5, 7) === '01') {
      try {
        const { claimOnce } = require('./markers');
        if (await claimOnce(`carryforward:${today.slice(0, 4)}`)) {
          results.carryForward = await accrual.runCarryForward(Number(today.slice(0, 4)) - 1, null);
        }
      } catch (e) { results.carryForward = { error: e.message }; }
    }
  }
  if (auto.slackBackupSync && (s.slack || {}).enabled) {
    try {
      const { syncFromSlack } = require('./slackSync');
      results.slack = await syncFromSlack(today);
    } catch (e) { results.slack = { error: e.message }; }
  }

  await saveSettings({ automationState: { lastRunDate: today, lastRunAt: nowStamp(), results } }).catch(() => {});
  if (Object.keys(results).length) console.log(`⚙️  Automations ran (${today}):`, JSON.stringify(results));
  return { date: today, results };
}

// In-memory date guard so activity-driven calls do real work at most once a day.
let _lastRun = null;
async function dailyTick() {
  try {
    const today = companyToday();
    if (_lastRun === today) return;
    _lastRun = today;
    await runDailyAutomations();
  } catch (e) {
    console.error('Automation dailyTick failed:', e.message);
  }
}

module.exports = { runDailyAutomations, dailyTick, sendTodaysAnniversaries, companyToday };
