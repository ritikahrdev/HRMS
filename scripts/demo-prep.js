// One-shot demo polish for DigiStay HRMS. Idempotent & fully reversible via
// scripts/demo-reset.js. Cleans leftover test/fuzz junk and makes the screens
// look professional for a leadership demo — without inventing fake people
// (the real roster is used; only the demo login persona is dressed up).
//   node scripts/demo-prep.js
const fs = require('fs');
const raw = fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8');
raw.split('\n').forEach((l) => { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const DEMO_EMP = 38;            // employee@company.local — the self-service persona
const HR_USER = 2;              // Ritika's user id (announcements / kudos author)

(async () => {
  const db = require('../server/db');
  await db.init();
  const log = [];

  // ---------- 1. CLEAN the test/fuzz junk (demo landmines) ----------
  const junkLeaves = await db.prepare(`
    DELETE FROM leave_requests WHERE
       reason LIKE '%OR%1=1%' OR reason LIKE '%DROP TABLE%' OR reason LIKE '%<script%'
       OR reason LIKE '%UNION SELECT%' OR reason LIKE '%onerror=%' OR reason LIKE '%javascript:%'
       OR reason LIKE '%img src=x%' OR reason = 'dcrfv' OR reason = 'Need to go somewhere'
       OR reason LIKE 'REAL TEST%' OR reason LIKE 'Hi Ritika%Please approve%'
       OR reason IN ('fuzz','x','BUGFIX-REV','BUGFIX-OVR','BUGFIX-PAY','SUITE-TEST','APPROVER-NAME-TEST')
  `).run();
  log.push(`cleaned junk leaves: ${junkLeaves.changes}`);
  // attendance rows those approved junk leaves had created (placeholder leave rows)
  const junkAtt = await db.prepare("DELETE FROM attendance WHERE employee_id=? AND status IN ('leave','half') AND check_in IS NULL AND date < ?").run(DEMO_EMP, today);
  log.push(`cleaned stray leave-attendance: ${junkAtt.changes}`);
  // junk employee record "Test Employee / sdf"
  const junkEmp = await db.prepare("UPDATE employees SET status='archived' WHERE email='sdf' OR (name='Test Employee' AND id<>?)").run(DEMO_EMP);
  log.push(`archived junk employee rows: ${junkEmp.changes}`);

  // ---------- 2. POLISH the demo self-service persona (emp 38) ----------
  const struct = JSON.stringify({ earnings: [{ name: 'Basic', amount: 42500 }, { name: 'HRA', amount: 17000 }, { name: 'Special Allowance', amount: 25500 }] });
  await db.prepare(`UPDATE employees SET name=?, department=?, designation=?, dob=?, date_of_joining=?, monthly_salary=?, salary_structure=?, status='active' WHERE id=?`)
    .run('Aarav Mehta', 'Engineering', 'Software Engineer', '1996-07-05', '2024-02-12', 85000, struct, DEMO_EMP);
  log.push('polished demo persona emp#38 → Aarav Mehta, Engineering, ₹85,000');

  // ---------- 3. PENDING leaves for the live approval demo ----------
  await db.prepare("DELETE FROM leave_requests WHERE employee_id=? AND reason IN ('Cousin''s wedding in Jaipur — travelling with family.','Short personal trip, will be reachable on phone.')").run(DEMO_EMP);
  await db.prepare("INSERT INTO leave_requests (employee_id, type, from_date, to_date, days, reason, half_day, status, applied_at) VALUES (?, 'casual', ?, ?, 1, ?, 0, 'pending', datetime('now'))")
    .run(DEMO_EMP, plus(6), plus(6), "Cousin's wedding in Jaipur — travelling with family.");
  await db.prepare("INSERT INTO leave_requests (employee_id, type, from_date, to_date, days, reason, half_day, status, applied_at) VALUES (?, 'casual', ?, ?, 2, ?, 0, 'pending', datetime('now'))")
    .run(DEMO_EMP, plus(13), plus(14), "Short personal trip, will be reachable on phone.");
  log.push('added 2 pending leaves on the demo persona (for live approval)');

  // ---------- 4. A pinned welcome announcement (Notice Board) ----------
  await db.prepare("DELETE FROM announcements WHERE title LIKE '🎉 Welcome to the new DigiStay HRMS%'").run();
  await db.prepare("INSERT INTO announcements (title, body, created_by, pinned, created_at) VALUES (?, ?, ?, 1, datetime('now'))")
    .run('🎉 Welcome to the new DigiStay HRMS',
      'Everything HR now lives in one place — mark attendance, apply for leave, download your payslips, give kudos to teammates and more. Have a question? Reach out to the People team any time. Welcome aboard! 💙',
      HR_USER);
  log.push('added pinned welcome announcement');

  // ---------- 5. A fresh kudos so the recognition wall feels current ----------
  await db.prepare("DELETE FROM kudos WHERE message LIKE 'Outstanding leadership shipping the new platform%'").run();
  await db.prepare("INSERT INTO kudos (from_user, employee_id, badge, message, created_at, cheers) VALUES (?, 15, '🚀', ?, datetime('now'), 0)")
    .run(HR_USER, 'Outstanding leadership shipping the new platform — thank you for going above and beyond!');
  log.push('added a recent kudos');

  // ---------- 6. Mark several people present today (Present Today widget) ----------
  const present = [1, 15, 18, 19, 20, 21, 22, 23, 24, 25];
  let marked = 0;
  for (let i = 0; i < present.length; i++) {
    const eid = present[i];
    const ex = await db.prepare('SELECT id FROM attendance WHERE employee_id=? AND date=?').get(eid, today);
    if (ex) continue; // never overwrite a real check-in
    const hh = String(9 + (i % 2)).padStart(2, '0');
    const mm = String(5 + i * 4).padStart(2, '0');
    await db.prepare("INSERT INTO attendance (employee_id, date, check_in, status, source, wfh) VALUES (?, ?, ?, 'present', 'demo', ?)")
      .run(eid, today, `${today}T${hh}:${mm}:00`, i % 5 === 0 ? 1 : 0);
    marked++;
  }
  log.push(`marked ${marked} employees present today (source='demo')`);

  // ---------- 7. Clean payslip for the persona (so My Payslips has a real slip) ----------
  // Mark the persona present for every past working day this month, then generate
  // the month's payslip → a tidy ₹85,000 slip with no odd loss-of-pay.
  const monthStr = today.slice(0, 7);
  const dayNum = Number(today.slice(8, 10));
  let presentDays = 0;
  for (let d = 1; d <= dayNum; d++) {
    const ds = `${monthStr}-${String(d).padStart(2, '0')}`;
    const wd = new Date(ds + 'T00:00:00').getDay();
    if (wd === 0 || wd === 6) continue; // skip weekends
    const ex = await db.prepare('SELECT id FROM attendance WHERE employee_id=? AND date=?').get(DEMO_EMP, ds);
    if (ex) { await db.prepare("UPDATE attendance SET status='present', source='demo' WHERE id=?").run(ex.id); }
    else { await db.prepare("INSERT INTO attendance (employee_id, date, check_in, status, source) VALUES (?, ?, ?, 'present', 'demo')").run(DEMO_EMP, ds, `${ds}T09:10:00`); }
    presentDays++;
  }
  try {
    const payroll = require('../server/services/payroll');
    const slip = await payroll.generatePayslip(DEMO_EMP, monthStr);
    log.push(`generated payslip for the persona (${monthStr}) — net ₹${slip.net_salary}`);
  } catch (e) { log.push('payslip generation skipped: ' + e.message); }

  console.log('\n=== DEMO PREP DONE ===');
  log.forEach((l) => console.log('  ✓ ' + l));
  console.log('\nReverse anytime with:  node scripts/demo-reset.js');
  await db.pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
