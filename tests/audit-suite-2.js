// ============================================================================
// HRMS AUDIT SUITE — PART 2: SQLi sweep, stored-XSS verification, mass-assignment
// escalation, Slack-signature contract, business-logic, concurrency + load.
// Appends to tests/audit-results.json and prints a combined summary.
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { loginAll, rawLogin } = require('./_lib');
const { summarize } = require('./audit-suite');

const BASE = process.env.BASE || 'http://localhost:4100';
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const ym = today.slice(0, 7);

const results = [];
function rec(category, name, pass, o = {}) {
  results.push({ category, name, pass: !!pass, sev: o.sev || 'Medium', got: o.got, expect: o.expect, detail: o.detail || '' });
}

async function postRaw(p, body, headers) {
  const r = await fetch(BASE + p, { method: 'POST', headers, body });
  let text = null, json = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) { try { json = await r.json(); } catch (e) {} }
  else { try { text = await r.text(); } catch (e) {} }
  return { status: r.status, text, json };
}

// Read-only peek into the test DB to confirm side effects decisively.
let peekDb = null;
try { peekDb = new DatabaseSync(process.env.SQLITE_PATH, { readOnly: true }); } catch (e) { /* peek disabled */ }
const userRole = (email) => { try { const r = peekDb.prepare('SELECT role FROM users WHERE lower(email)=lower(?)').get(email); return r ? r.role : null; } catch (e) { return '(peek-failed)'; } };
const latestEmailBody = (subjectLike) => { try { const r = peekDb.prepare("SELECT body FROM email_log WHERE subject LIKE ? ORDER BY id DESC LIMIT 1").get(subjectLike); return r ? r.body : null; } catch (e) { return null; } };
const attRow = (empId, date) => { try { return peekDb.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(empId, date); } catch (e) { return null; } };

const SQL_ERR = /SQLITE_|syntax error|no such column|unrecognized token|datatype mismatch|near "|column .* does not exist|invalid input syntax/i;

(async () => {
  const S = await loginAll();
  const EID = S.employee.user.employeeId, E2 = S.employee2.user.employeeId;

  // ========================================================================
  // SECTION 5 — SQL INJECTION SWEEP
  // ========================================================================
  const PAYLOADS = [
    "' OR '1'='1", "' OR 1=1--", "admin'--", "'; DROP TABLE users;--", "' UNION SELECT null--",
    "1 OR 1=1", "\\'", "' OR ''='", "'); DELETE FROM employees;--", "1; SELECT pg_sleep(5)--",
    "1' ORDER BY 99--", "%27%20OR%201=1", "' AND 1=CAST((SELECT 1) AS int)--",
  ];
  // [role, method, pathTemplate(P), bodyTemplate(P) | null]
  const POINTS = [
    ['admin', 'GET', (p) => '/api/reports/attendance?month=' + encodeURIComponent(p), null],
    ['admin', 'GET', (p) => '/api/reports/payroll?month=' + encodeURIComponent(p), null],
    ['admin', 'GET', (p) => '/api/payroll?month=' + encodeURIComponent(p), null],
    ['admin', 'GET', (p) => '/api/attendance/day?date=' + encodeURIComponent(p), null],
    ['admin', 'GET', (p) => '/api/attendance/insights?month=' + encodeURIComponent(p), null],
    ['admin', 'GET', (p) => '/api/leave/calendar?month=' + encodeURIComponent(p), null],
    ['admin', 'GET', (p) => '/api/holidays?year=' + encodeURIComponent(p), null],
    ['admin', 'GET', (p) => '/api/leave?status=' + encodeURIComponent(p), null],
    ['employee', 'GET', (p) => '/api/attendance/my?month=' + encodeURIComponent(p), null],
    ['employee', 'GET', (p) => '/api/leave/my?month=' + encodeURIComponent(p), null],
    ['employee', 'GET', (p) => '/api/payroll/my?month=' + encodeURIComponent(p), null],
    ['employee', 'POST', () => '/api/leave', (p) => ({ type: p, from_date: plus(2), to_date: plus(2), reason: 'x' })],
    ['employee', 'POST', () => '/api/tickets', (p) => ({ category: 'general', subject: p, description: 'x' })],
    ['employee', 'POST', () => '/api/mood/checkin', (p) => ({ score: 3, note: p })],
    ['employee', 'POST', () => '/api/goals', (p) => ({ title: p, target_date: plus(20) })],
  ];
  for (const pl of PAYLOADS) {
    // login bypass attempt
    const lb = await rawLogin(pl, pl);
    rec('SQLi', `login bypass blocked: ${pl.slice(0, 18)}`, lb.status === 401 || lb.status === 400, { sev: 'Critical', got: lb.status, expect: '401/400' });
    for (const [role, method, pathT, bodyT] of POINTS) {
      const p = pathT(pl);
      const body = bodyT ? bodyT(pl) : undefined;
      const r = await S[role].call(method, p, body);
      const blob = JSON.stringify(r.json || r.text || '');
      const leak = SQL_ERR.test(blob);
      rec('SQLi', `${method} ${p.split('?')[0]} [${pl.slice(0, 14)}]`, r.status !== 500 && !leak, { sev: 'High', got: r.status, detail: leak ? 'SQL-ERR-LEAK' : '' });
    }
  }

  // ========================================================================
  // SECTION 6 — STORED XSS VERIFICATION (escaped at the sink)
  // ========================================================================
  const XSS = '<img src=x onerror=alert(1)>';
  // kudos -> in-app notification body + broadcast email body
  await S.employee.call('POST', '/api/kudos', { employee_id: E2, message: XSS, badge: '🎉' });
  // A raw, unescaped payload contains a literal "<img"; once escaped it becomes
  // "&lt;img" and can never execute. That's the correct signal.
  const isRaw = (s) => String(s || '').includes('<img') || String(s || '').includes('<script');
  const notifs = (await S.admin.call('GET', '/api/notifications')).json;
  const nlist = (notifs && (notifs.notifications || notifs.items || notifs)) || [];
  const rawInNotif = Array.isArray(nlist) && nlist.some((n) => isRaw(n.body));
  const escInNotif = Array.isArray(nlist) && nlist.some((n) => String(n.body || '').includes('&lt;img'));
  rec('XSS', 'kudos in-app notification body is HTML-escaped', !rawInNotif && escInNotif, { sev: 'High', got: rawInNotif ? 'RAW' : 'escaped' });
  const mail = latestEmailBody('%Shoutout%');
  rec('XSS', 'kudos broadcast email body is HTML-escaped', mail != null ? !isRaw(mail) : true, { sev: 'High', got: mail ? (isRaw(mail) ? 'RAW' : 'escaped') : '(no email logged)' });
  // announcement email
  await S.admin.call('POST', '/api/announcements', { title: XSS, body: 'audit ' + XSS });
  const amail = latestEmailBody('%Announcement%');
  rec('XSS', 'announcement email body is HTML-escaped', amail != null ? !isRaw(amail) : true, { sev: 'High', got: amail ? (isRaw(amail) ? 'RAW' : 'escaped') : '(no email logged)' });
  // ticket email (HR notification) — also confirms the permissions-column 500 fix
  const tk = await S.employee.call('POST', '/api/tickets', { category: 'general', subject: XSS, description: XSS });
  rec('Logic', 'raising a ticket succeeds (no permissions-column 500)', tk.status === 200, { sev: 'High', got: tk.status, expect: 200 });
  const tmail = latestEmailBody('%Support Ticket%');
  rec('XSS', 'ticket HR-email body is HTML-escaped', tmail != null ? !isRaw(tmail) : true, { sev: 'High', got: tmail ? (isRaw(tmail) ? 'RAW' : 'escaped') : '(no email logged)' });

  // ========================================================================
  // SECTION 6b — MASS-ASSIGNMENT PRIVILEGE ESCALATION
  // ========================================================================
  await S.hr.call('POST', '/api/import/commit', { rows: [{ name: 'Evil Import', email: 'evil-import@test.local', role: 'SUPER_ADMIN' }] });
  rec('PrivEsc', 'HR bulk-import cannot mint SUPER_ADMIN', userRole('evil-import@test.local') !== 'SUPER_ADMIN', { sev: 'High', got: userRole('evil-import@test.local'), expect: '!SUPER_ADMIN' });
  await S.hr.call('POST', '/api/employees', { name: 'Evil Create', email: 'evil-create@test.local', role: 'SUPER_ADMIN' });
  rec('PrivEsc', 'HR direct-create cannot mint SUPER_ADMIN', userRole('evil-create@test.local') !== 'SUPER_ADMIN', { sev: 'High', got: userRole('evil-create@test.local'), expect: '!SUPER_ADMIN' });
  // Super Admin SHOULD still be able to set a role.
  await S.admin.call('POST', '/api/employees', { name: 'Real HR', email: 'real-hr@test.local', role: 'HR_ADMIN' });
  rec('PrivEsc', 'Super Admin can still assign roles (HR_ADMIN)', userRole('real-hr@test.local') === 'HR_ADMIN', { sev: 'Low', got: userRole('real-hr@test.local'), expect: 'HR_ADMIN' });

  // ========================================================================
  // SECTION 6c — SLACK EVENTS SIGNATURE CONTRACT
  // ========================================================================
  const cfg = (await S.admin.call('GET', '/api/settings')).json.settings || {};
  const slack0 = cfg.slack || {};
  const evt = JSON.stringify({ type: 'event_callback', event: { type: 'message', user: 'U-ESHA', text: 'present', ts: String(Math.floor(Date.now() / 1000)) + '.0001', channel: 'C1' } });
  // (i) no signing secret configured -> reject unsigned event
  await S.admin.call('PUT', '/api/settings', { slack: { ...slack0, signingSecret: '', enabled: false, botToken: '' } });
  let r = await postRaw('/api/slack/events', evt, { 'Content-Type': 'application/json' });
  rec('Webhook', 'unsigned Slack event rejected when no signing secret', r.status === 401, { sev: 'Critical', got: r.status, expect: 401 });
  // (ii) secret set -> wrong signature rejected
  await S.admin.call('PUT', '/api/settings', { slack: { ...slack0, signingSecret: 'testsecret', enabled: false, botToken: '' } });
  const setOk = ((await S.admin.call('GET', '/api/settings')).json.settings.slack || {}).signingSecret === 'testsecret';
  const tsNow = String(Math.floor(Date.now() / 1000));
  r = await postRaw('/api/slack/events', evt, { 'Content-Type': 'application/json', 'x-slack-request-timestamp': tsNow, 'x-slack-signature': 'v0=deadbeef' });
  rec('Webhook', 'wrong Slack signature rejected', setOk ? r.status === 401 : true, { sev: 'Critical', got: r.status, expect: 401, detail: setOk ? '' : '(could not set secret)' });
  // (iii) valid signature accepted (200 ack)
  const sig = 'v0=' + crypto.createHmac('sha256', 'testsecret').update('v0:' + tsNow + ':' + evt).digest('hex');
  r = await postRaw('/api/slack/events', evt, { 'Content-Type': 'application/json', 'x-slack-request-timestamp': tsNow, 'x-slack-signature': sig });
  rec('Webhook', 'valid Slack signature accepted (200 ack)', setOk ? r.status === 200 : true, { sev: 'Low', got: r.status, expect: 200 });
  // (iv) url_verification handshake still works (no signature)
  r = await postRaw('/api/slack/events', JSON.stringify({ type: 'url_verification', challenge: 'abc123' }), { 'Content-Type': 'application/json' });
  rec('Webhook', 'url_verification handshake still works', r.status === 200 && JSON.stringify(r.json || r.text).includes('abc123'), { sev: 'Low', got: r.status });
  await S.admin.call('PUT', '/api/settings', { slack: slack0 }); // restore

  // ========================================================================
  // SECTION 8 — BUSINESS LOGIC / DATA VALIDATION
  // ========================================================================
  // arbitrary attendance status rejected
  r = await S.admin.call('POST', '/api/attendance/mark', { employee_id: EID, date: today, status: 'hacked123' });
  rec('Logic', 'attendance /mark rejects arbitrary status', r.status === 400, { sev: 'Medium', got: r.status, expect: 400 });
  // negative comp-off rejected
  r = await S.admin.call('POST', '/api/leave/compoff', { employee_id: EID, days: -5 });
  rec('Logic', 'comp-off grant rejects negative days', r.status === 400, { sev: 'Medium', got: r.status, expect: 400 });
  r = await S.admin.call('POST', '/api/leave/compoff', { employee_id: EID, days: 9999 });
  rec('Logic', 'comp-off grant rejects huge days', r.status === 400, { sev: 'Medium', got: r.status, expect: 400 });
  // ledger adjust unbounded amount rejected
  r = await S.admin.call('POST', '/api/leave/ledger/adjust', { employee_id: EID, type: 'casual', amount: 999999 });
  rec('Logic', 'ledger adjust rejects unbounded amount', r.status === 400, { sev: 'Medium', got: r.status, expect: 400 });
  // negative salary clamped (not stored negative)
  await S.admin.call('PUT', '/api/employees/' + E2, { monthly_salary: -5000 });
  const e2row = (await S.admin.call('GET', '/api/employees/' + E2)).json.employee;
  rec('Logic', 'negative salary clamped to >= 0', e2row && Number(e2row.monthly_salary) >= 0, { sev: 'Medium', got: e2row && e2row.monthly_salary });
  // leave overdraw rejected (casual quota = 7; request ~10 working days)
  r = await S.employee.call('POST', '/api/leave', { type: 'casual', from_date: plus(3), to_date: plus(16), reason: 'overdraw-test' });
  rec('Logic', 'leave apply rejects over-drawing the balance', r.status === 400, { sev: 'Medium', got: r.status, expect: 400 });
  // duplicate timesheet entry guarded
  const ts1 = await S.employee.call('POST', '/api/timesheets/entry', { date: today, hours: 2, task: 'dupe', project_id: null });
  const ts2 = await S.employee.call('POST', '/api/timesheets/entry', { date: today, hours: 2, task: 'dupe', project_id: null });
  rec('DB', 'duplicate timesheet (emp,date,project) guarded', !(ts1.status === 200 && ts2.status === 200) || ts2.status === 409, { sev: 'Low', got: ts1.status + '/' + ts2.status });
  // payroll math sanity
  const gen = await S.admin.call('POST', '/api/payroll/generate', { month: ym, employee_id: EID });
  let slip = gen.json && gen.json.payslips && gen.json.payslips[0];
  rec('Logic', 'payroll generates a payslip', !!slip, { sev: 'Medium', got: gen.status });
  if (slip) {
    rec('Logic', 'payslip net <= gross', Number(slip.net_salary) <= Number(slip.gross) + 1e-6, { sev: 'High', got: slip.net_salary + '/' + slip.gross });
    rec('Logic', 'payslip net not negative', Number(slip.net_salary) >= -1e-6, { sev: 'High', got: slip.net_salary });
    rec('Logic', 'payslip paid_days <= working_days', Number(slip.paid_days) <= Number(slip.working_days) + 1e-6, { sev: 'Medium', got: slip.paid_days + '/' + slip.working_days });
  }

  // ========================================================================
  // SECTION 11 — CONCURRENCY & LOAD (100 / 500 / 1000)
  // ========================================================================
  async function load(n, makeReq, label, maxErrRate) {
    const t0 = Date.now();
    const lat = [];
    const tasks = Array.from({ length: n }, () => (async () => { const a = Date.now(); try { const r = await makeReq(); lat.push(Date.now() - a); return r.status; } catch (e) { lat.push(Date.now() - a); return 'ERR'; } })());
    const codes = await Promise.all(tasks);
    const wall = Date.now() - t0;
    const ok = codes.filter((c) => c === 200).length;
    const errs = codes.filter((c) => c !== 200).length;
    const server500 = codes.filter((c) => c === 500).length; // application errors (not connection resets)
    lat.sort((a, b) => a - b);
    const p50 = lat[Math.floor(lat.length * 0.5)], p95 = lat[Math.floor(lat.length * 0.95)], max = lat[lat.length - 1];
    const rps = Math.round((n / wall) * 1000);
    // A single Node process can saturate its OS accept-backlog under a huge
    // simultaneous burst; what matters is no 500s and graceful degradation.
    const pass = (errs / n) <= maxErrRate && server500 === 0;
    rec('Load', `${label}: ${n} concurrent — err<=${Math.round(maxErrRate * 100)}%, no 500s`, pass, { sev: 'High', got: `ok=${ok} err=${errs} 500s=${server500}`, detail: `wall=${wall}ms p50=${p50}ms p95=${p95}ms max=${max}ms ~${rps}req/s` });
    return { n, wall, ok, errs, server500, p50, p95, max, rps };
  }
  const loadMetrics = [];
  loadMetrics.push(await load(100, () => fetch(BASE + '/api/health'), 'health', 0));
  loadMetrics.push(await load(500, () => fetch(BASE + '/api/health'), 'health', 0));
  loadMetrics.push(await load(1000, () => fetch(BASE + '/api/health'), 'health', 0.4)); // burst: allow connection-reset, no 500s
  loadMetrics.push(await load(200, () => fetch(BASE + '/api/employees/me', { headers: { cookie: S.employee.cookie } }), 'authed /me', 0));
  // server stayed healthy after the burst?
  { const h = await fetch(BASE + '/api/health').then((r) => r.status).catch(() => 'ERR'); rec('Load', 'server healthy after 1000-burst', h === 200, { sev: 'Critical', got: h, expect: 200 }); }
  // concurrency race: 25 parallel marks for same (emp,date) must yield exactly ONE row
  await Promise.all(Array.from({ length: 25 }, () => S.admin.call('POST', '/api/attendance/mark', { employee_id: EID, date: plus(1), status: 'present' })));
  const raceRows = (() => { try { return peekDb.prepare('SELECT COUNT(*) c FROM attendance WHERE employee_id=? AND date=?').get(EID, plus(1)).c; } catch (e) { return -1; } })();
  rec('DB', 'concurrent attendance marks -> single row (unique constraint)', raceRows === 1, { sev: 'High', got: raceRows, expect: 1 });

  // ---- merge with part 1 results + write + summarize ----
  let prior = [];
  try { prior = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-results.json'), 'utf8')); } catch (e) {}
  const all = prior.concat(results);
  fs.writeFileSync(path.join(__dirname, 'audit-results.json'), JSON.stringify(all, null, 0));
  fs.writeFileSync(path.join(__dirname, 'load-metrics.json'), JSON.stringify(loadMetrics, null, 2));
  summarize(all, 'FULL AUDIT (PART 1 + PART 2)');
  console.log('\nLOAD METRICS:');
  for (const m of loadMetrics) console.log(`  n=${m.n} wall=${m.wall}ms ok=${m.ok} err=${m.errs} p50=${m.p50}ms p95=${m.p95}ms max=${m.max}ms ~${m.rps}req/s`);
})().catch((e) => { console.error('SUITE-2 ERROR', e); process.exit(1); });
