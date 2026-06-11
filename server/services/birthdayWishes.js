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

// An email-client-safe "poster": table layout + inline styles + emoji art, so
// it renders fully in every inbox without any blockable external images.
function wishHtml(emp, companyName) {
  const co = companyName || 'the team';
  const name = firstName(emp.name);
  return `
  <div style="background:#f3f4f8;padding:26px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:20px;overflow:hidden;box-shadow:0 10px 34px rgba(91,33,182,0.20)">
          <!-- festive header band -->
          <tr><td bgcolor="#7c3aed" style="background:linear-gradient(135deg,#7c3aed 0%,#c026d3 55%,#db2777 100%);padding:40px 24px 34px;text-align:center">
            <div style="font-size:30px;line-height:1.2">🎈&nbsp;&nbsp;🎉&nbsp;&nbsp;🎂&nbsp;&nbsp;🎊&nbsp;&nbsp;🎈</div>
            <div style="color:#ffffff;font-size:13px;letter-spacing:7px;font-weight:700;margin-top:18px;text-transform:uppercase;opacity:.92">Happy Birthday</div>
            <div style="color:#ffffff;font-size:42px;font-weight:800;margin-top:8px;line-height:1.1">${name}!</div>
            <div style="font-size:50px;margin-top:12px">🥳</div>
          </td></tr>
          <!-- message -->
          <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:32px 34px 6px;text-align:center">
            <p style="color:#1f2937;font-size:17px;line-height:1.7;margin:0 0 16px;font-weight:600">
              Wishing you a day as bright and wonderful as you are! 🌟
            </p>
            <p style="color:#4b5563;font-size:15px;line-height:1.75;margin:0">
              May this year ahead be filled with happiness, good health,<br/>
              success, and plenty of reasons to celebrate.
            </p>
            <div style="font-size:38px;margin:20px 0 6px;line-height:1">🎁&nbsp;&nbsp;🎂&nbsp;&nbsp;🎈</div>
            <p style="color:#4b5563;font-size:15px;line-height:1.75;margin:6px 0 0">
              Thank you for everything you bring to ${co} —<br/>we're so glad to celebrate <b>you</b> today!
            </p>
          </td></tr>
          <!-- sign-off band -->
          <tr><td bgcolor="#faf5ff" style="background:#faf5ff;padding:22px 30px 30px;text-align:center;border-top:1px solid #f0e7fb">
            <div style="font-size:20px;letter-spacing:3px;margin-bottom:12px">✨ 🎊 ✨ 🎊 ✨</div>
            <div style="color:#7c3aed;font-weight:600;font-size:14px">With warm wishes,</div>
            <div style="color:#1f2937;font-weight:800;font-size:17px;margin-top:2px">The ${co} Team 💜</div>
          </td></tr>
        </table>
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin:16px 0 0">Sent with love from ${co} HR 🎂</p>
      </td></tr>
    </table>
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
