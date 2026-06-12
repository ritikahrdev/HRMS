// Verifies the round-2 bug fixes (logic/authz/XSS). Local only.
const fs = require('fs'); const raw = fs.readFileSync('.env', 'utf8');
raw.split('\n').forEach((l) => { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
const B = 'http://localhost:4100';
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); cond ? pass++ : fail++; };
async function login(e, p) { const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) }); return { c: (r.headers.get('set-cookie') || '').split(';')[0], u: (await r.json()).user }; }
async function call(c, m, p, b) { const o = { method: m, headers: { cookie: c } }; if (b) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(b); } const r = await fetch(B + p, o); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }

(async () => {
  const db = require('../server/db'); await db.init();
  const E = await login('employee@company.local', 'employee123'); const emp = E.c; const EID = E.u.employeeId;
  const A = await login('admin@company.local', 'ChangeMe@12345'); const adm = A.c;

  // ---- 1. Leave reversal: approve creates attendance + uses balance; reject removes both ----
  const fd = plus(12), td = plus(12);
  const ap = await call(emp, 'POST', '/api/leave', { type: 'casual', from_date: fd, to_date: td, reason: 'BUGFIX-REV' });
  const lid = ap.j.id;
  const balBefore = (await call(emp, 'GET', '/api/leave/balance')).j.balance;
  await call(adm, 'POST', `/api/leave/${lid}/decision`, { decision: 'approved' });
  const attAfterApprove = await db.prepare("SELECT status,check_in FROM attendance WHERE employee_id=? AND date=?").get(EID, fd);
  const balAfterApprove = (await call(emp, 'GET', '/api/leave/balance')).j.balance;
  ok('reversal: approve writes leave attendance', attAfterApprove && attAfterApprove.status === 'leave');
  ok('reversal: approve consumes balance', balAfterApprove.casual.remaining === balBefore.casual.remaining - 1, `(${balBefore.casual.remaining}→${balAfterApprove.casual.remaining})`);
  // now reject the approved leave
  const rev = await call(adm, 'POST', `/api/leave/${lid}/decision`, { decision: 'rejected', comment: 'reversed' });
  const attAfterReject = await db.prepare("SELECT id FROM attendance WHERE employee_id=? AND date=?").get(EID, fd);
  const balAfterReject = (await call(emp, 'GET', '/api/leave/balance')).j.balance;
  ok('reversal: reject re-decides (not "already")', rev.s === 200);
  ok('reversal: reject removes the placeholder attendance', !attAfterReject);
  ok('reversal: reject restores balance', balAfterReject.casual.remaining === balBefore.casual.remaining, `(→${balAfterReject.casual.remaining})`);
  // re-clicking same decision is a no-op (idempotent)
  const again = await call(adm, 'POST', `/api/leave/${lid}/decision`, { decision: 'rejected' });
  ok('reversal: same decision twice is fine', again.s === 200);

  // ---- 2. Attendance overwrite guard: a synced "present" must NOT be flipped to leave ----
  const sd = plus(13);
  await db.prepare("DELETE FROM attendance WHERE employee_id=? AND date=?").run(EID, sd);
  await db.prepare("INSERT INTO attendance (employee_id, date, status) VALUES (?, ?, 'present')").run(EID, sd); // simulate Slack/Sheet sync (no check_in)
  const ap2 = await call(emp, 'POST', '/api/leave', { type: 'casual', from_date: sd, to_date: sd, reason: 'BUGFIX-OVR' });
  await call(adm, 'POST', `/api/leave/${ap2.j.id}/decision`, { decision: 'approved' });
  const synced = await db.prepare("SELECT status FROM attendance WHERE employee_id=? AND date=?").get(EID, sd);
  ok('overwrite guard: synced present NOT flipped to leave', synced && synced.status === 'present', `(status=${synced && synced.status})`);

  // ---- 3. compoff DELETE: non-existent id now 404 (was silent 200) ----
  const delMissing = await call(adm, 'DELETE', '/api/leave/compoff/999999');
  ok('compoff: delete non-existent → 404', delMissing.s === 404, `(got ${delMissing.s})`);

  // ---- 4. surveys responses query runs (was broken by double-quoted "active") ----
  const sv = await call(adm, 'POST', '/api/surveys', { title: 'BUGFIX-SVY', questions: [{ text: 'ok?', type: 'text' }], target_department: "Eng' OR '1'='1" });
  if (sv.j && sv.j.id) {
    const resp = await call(adm, 'GET', `/api/surveys/${sv.j.id}/responses`);
    const eligible = resp.j && resp.j.survey && resp.j.survey.totalEligible;
    ok('surveys: responses query runs (no double-quote / SQLi break)', resp.s === 200 && typeof eligible === 'number', `(got ${resp.s}, eligible=${eligible})`);
    await db.prepare("DELETE FROM surveys WHERE id=?").run(sv.j.id);
  } else { ok('surveys: responses query runs', false, 'could not create survey'); }

  // ---- 5. timesheet duplicate guard ----
  await db.prepare("DELETE FROM timesheet_entries WHERE employee_id=? AND date=? AND project_id IS NULL").run(EID, today);
  const ts1 = await call(emp, 'POST', '/api/timesheets/entry', { date: today, hours: 4, task: 'BUGFIX-TS' });
  const ts2 = await call(emp, 'POST', '/api/timesheets/entry', { date: today, hours: 4, task: 'BUGFIX-TS' });
  ok('timesheet: first entry ok', ts1.s === 200, `(got ${ts1.s})`);
  ok('timesheet: duplicate same day+project → 409', ts2.s === 409, `(got ${ts2.s})`);

  // ---- 6. attendance correction rejects non-time payload (stored-XSS defense) ----
  const xss = await call(emp, 'POST', '/api/attendance/correction', { requested_status: 'present', requested_in: '<script>alert(1)</script>', reason: 'x' });
  ok('correction: XSS in requested_in rejected', xss.s === 400, `(got ${xss.s})`);
  const goodTime = await call(emp, 'POST', '/api/attendance/correction', { requested_status: 'present', requested_in: '25:99', reason: 'x' });
  ok('correction: invalid time 25:99 rejected', goodTime.s === 400, `(got ${goodTime.s})`);

  // ---- 7. payroll LOP split: each policy docks only its own bucket ----
  // Discriminator: seed one approved UNPAID-LEAVE day, then compute with
  // (absent-only) vs (unpaid-only). With the OLD merged-bucket bug both nets
  // would be IDENTICAL; with the fix they must differ (absent-only must NOT
  // dock the unpaid-leave day).
  const { getSettings, saveSettings } = require('../server/services/settings');
  const svc = require('../server/services/payroll');
  const month = today.slice(0, 7);
  const origPayroll = JSON.parse(JSON.stringify(getSettings().payroll || {}));
  // find a past weekday in this month for the seeded unpaid leave
  let L = null;
  for (let day = 1; day <= Number(today.slice(8, 10)); day++) {
    const ds = `${month}-${String(day).padStart(2, '0')}`;
    const wd = new Date(ds + 'T00:00:00').getDay();
    if (wd !== 0 && wd !== 6) { L = ds; break; }
  }
  await db.prepare("DELETE FROM leave_requests WHERE employee_id=? AND reason='BUGFIX-PAY'").run(EID);
  await db.prepare("INSERT INTO leave_requests (employee_id, type, from_date, to_date, days, reason, half_day, status) VALUES (?, 'unpaid', ?, ?, 1, 'BUGFIX-PAY', 0, 'approved')").run(EID, L, L);
  // The test employee has ₹0 salary → give it one temporarily so per-day pay > 0.
  const origSalary = (await db.prepare('SELECT monthly_salary FROM employees WHERE id=?').get(EID)).monthly_salary;
  await db.prepare('UPDATE employees SET monthly_salary=30000 WHERE id=?').run(EID);
  try {
    await saveSettings({ payroll: { ...getSettings().payroll, deductAbsent: true, deductUnpaidLeave: false } });
    const slipAbsentOnly = await svc.computePayroll(EID, month).catch((e) => ({ error: e.message }));
    await saveSettings({ payroll: { ...getSettings().payroll, deductAbsent: false, deductUnpaidLeave: true } });
    const slipUnpaidOnly = await svc.computePayroll(EID, month).catch((e) => ({ error: e.message }));
    ok('payroll: computes without error after LOP refactor', slipAbsentOnly && !slipAbsentOnly.error, slipAbsentOnly && slipAbsentOnly.error ? slipAbsentOnly.error : '');
    ok('payroll: absent-only vs unpaid-only LOP DIFFER (buckets separated)',
      slipAbsentOnly && slipUnpaidOnly && slipAbsentOnly.net_salary !== slipUnpaidOnly.net_salary,
      `(absentOnly net=${slipAbsentOnly && slipAbsentOnly.net_salary}, unpaidOnly net=${slipUnpaidOnly && slipUnpaidOnly.net_salary})`);
  } finally {
    await saveSettings({ payroll: origPayroll });
    await db.prepare('UPDATE employees SET monthly_salary=? WHERE id=?').run(origSalary, EID);
    await db.prepare("DELETE FROM leave_requests WHERE employee_id=? AND reason='BUGFIX-PAY'").run(EID);
  }

  // ---- cleanup ----
  await db.prepare("DELETE FROM leave_requests WHERE reason IN ('BUGFIX-REV','BUGFIX-OVR')").run();
  await db.prepare("DELETE FROM attendance WHERE employee_id=? AND date IN (?,?)").run(EID, plus(12), plus(13));
  await db.prepare("DELETE FROM timesheet_entries WHERE task='BUGFIX-TS'").run();
  await db.prepare("DELETE FROM attendance_corrections WHERE reason='x' AND employee_id=?").run(EID);
  await db.prepare("DELETE FROM email_log WHERE status='skipped'").run();

  console.log(`\nBUGFIX VERIFY: ${pass} pass / ${fail} fail`);
  await db.pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
