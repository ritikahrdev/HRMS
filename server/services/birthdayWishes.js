// Automatic birthday wishes. Once a day, any active employee whose date of
// birth falls on "today" gets a warm wishing email — sent ONLY to them (no CC),
// from the company's configured HR sender — plus an in-app bell notification.
//
// Scheduling without a cron: dailyTick() is called on server boot and on API
// activity, but an in-memory date-guard means the real work runs at most once
// per calendar day. Re-sends are additionally blocked per employee per year via
// the email_log, so even across restarts nobody is wished twice.
const db = require('./../db');
const { sendMail } = require('./email');
const { notifyUsers } = require('./notify');
const { getSettings } = require('./settings');

// Today's date in the company timezone (defaults to IST), as 'YYYY-MM-DD'.
function companyToday() {
  const tz = (getSettings().timezone) || 'Asia/Kolkata';
  try {
    // en-CA gives ISO-style YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  } catch (e) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function wishHtml(emp, companyName) {
  const co = companyName || 'the team';
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px;border-radius:14px 14px 0 0;text-align:center;color:#fff">
        <div style="font-size:46px;line-height:1">🎂🎉</div>
        <h1 style="margin:10px 0 0;font-size:26px">Happy Birthday, ${firstName(emp.name)}!</h1>
      </div>
      <div style="background:#fff;border:1px solid #eef1f6;border-top:none;border-radius:0 0 14px 14px;padding:24px;color:#374151;font-size:15px;line-height:1.6">
        <p>Wishing you a wonderful day filled with happiness and good health. 🥳</p>
        <p>Thank you for everything you do — we're glad to have you with us. Have a fantastic year ahead!</p>
        <p style="margin-top:18px">Warm wishes,<br/><b>The ${co} Team</b></p>
      </div>
    </div>`;
}

// Has this employee already received a birthday email this year?
async function alreadyWishedThisYear(email, year) {
  const row = await db.prepare(
    "SELECT 1 FROM email_log WHERE to_addr = ? AND subject LIKE 'Happy Birthday%' AND substr(created_at,1,4) = ? LIMIT 1"
  ).get(email, String(year));
  return !!row;
}

// Send today's birthday wishes. Returns { date, found, sent, skipped }.
async function sendTodaysBirthdayWishes() {
  const s = getSettings();
  if (s.birthdayEmails === false) return { disabled: true, sent: 0 };

  const today = companyToday();          // YYYY-MM-DD
  const mmdd = today.slice(5);           // MM-DD
  const year = Number(today.slice(0, 4));

  // Active employees whose dob month-day matches today.
  const employees = await db.prepare(
    "SELECT id, name, email, user_id, dob FROM employees WHERE status='active' AND dob IS NOT NULL AND dob <> ''"
  ).all();
  const birthdayFolks = employees.filter((e) => String(e.dob).slice(5, 10) === mmdd);

  let sent = 0, skipped = 0;
  const companyName = s.companyName || '';
  for (const emp of birthdayFolks) {
    // Always drop an in-app bell wish to the employee (cheap, idempotent-ish).
    if (emp.user_id) {
      await notifyUsers([emp.user_id], {
        type: 'birthday',
        title: '🎂 Happy Birthday!',
        body: `Wishing you a wonderful day from the ${companyName || 'whole'} team! 🎉`,
        link: '#/',
      }).catch(() => {});
    }
    if (!emp.email) { skipped++; continue; }
    if (await alreadyWishedThisYear(emp.email, year)) { skipped++; continue; }
    // Send ONLY to the employee — no CC to admins.
    await sendMail({
      to: emp.email,
      subject: `Happy Birthday, ${firstName(emp.name)}! 🎂`,
      html: wishHtml(emp, companyName),
    }).catch((e) => console.error('Birthday email failed for', emp.email, e.message));
    sent++;
  }
  if (birthdayFolks.length) console.log(`🎂 Birthday wishes: ${sent} sent, ${skipped} skipped (${today})`);
  return { date: today, found: birthdayFolks.length, sent, skipped };
}

// In-memory guard so activity-driven calls only do real work once per day.
let _lastRun = null;
async function dailyTick() {
  try {
    const today = companyToday();
    if (_lastRun === today) return;        // already handled today
    _lastRun = today;
    await sendTodaysBirthdayWishes();
  } catch (e) {
    console.error('Birthday dailyTick failed:', e.message);
  }
}

module.exports = { sendTodaysBirthdayWishes, dailyTick, companyToday };
