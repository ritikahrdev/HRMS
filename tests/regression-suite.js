// HRMS regression suite — 200+ parametrized checks across every tab.
//   node tests/regression-suite.js                 → local (http://localhost:4100), full
//   BASE=https://... SAFE=1 THROTTLE=700 node ...  → production (skips success-writes
//                                                    that would email people; throttled
//                                                    to respect the 100 req/min limit)
// Checks: (1) access matrix — every endpoint as admin / employee / anonymous,
// (2) date & backdating rules, (3) input validation, (4) public pages.
const BASE = process.env.BASE || 'http://localhost:4100';
const SAFE = process.env.SAFE === '1';
const THROTTLE = Number(process.env.THROTTLE || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

let ADMIN = '', EMP = '', EID = 0;
const results = [];
async function call(role, method, path, body, multipart) {
  const cookie = role === 'admin' ? ADMIN : role === 'emp' ? EMP : '';
  const opts = { method, headers: { cookie } };
  if (body && !multipart) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (multipart) { opts.body = multipart; }
  const r = await fetch(BASE + path, opts);
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
}
async function check(name, role, method, path, body, expect, predicate) {
  if (THROTTLE) await sleep(THROTTLE);
  try {
    const r = await call(role, method, path, body);
    const okStatus = expect.includes(r.s);
    const okPred = predicate ? predicate(r) : true;
    results.push({ name, ok: okStatus && okPred, got: r.s, expect: expect.join('/'), err: (!okStatus || !okPred) && r.j ? String(r.j.error || '').slice(0, 70) : '' });
  } catch (e) {
    results.push({ name, ok: false, got: 'ERR', expect: expect.join('/'), err: e.message.slice(0, 70) });
  }
}

(async () => {
  // ---- login (2 requests only — login limiter is 5/15min in prod) ----
  const la = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@company.local', password: 'ChangeMe@12345' }) });
  ADMIN = (la.headers.get('set-cookie') || '').split(';')[0];
  const le = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'employee@company.local', password: 'employee123' }) });
  EMP = (le.headers.get('set-cookie') || '').split(';')[0];
  EID = ((await le.json()).user || {}).employeeId || 38;
  if (!ADMIN || !EMP) { console.error('login failed — is the server up at ' + BASE + '?'); process.exit(1); }
  const M = today.slice(0, 7);

  // ============ 1) ACCESS MATRIX — every tab's endpoints × 3 roles ============
  // [path, adminExpect, empExpect, anonExpect]
  const matrix = [
    ['/api/reports/overview',                 [200], [403], [401, 403]],
    ['/api/reports/attendance?month=' + M,    [200], [403], [401, 403]],
    ['/api/reports/payroll?month=' + M,       [200], [403], [401, 403]],
    ['/api/employees',                        [200], [403], [401, 403]],
    ['/api/employees/stats',                  [200], [403], [401, 403]],
    ['/api/employees/directory',              [200], [200], [401, 403]],
    ['/api/employees/celebrations',           [200], [200], [401, 403]],
    ['/api/employees/me',                     [200], [200], [401, 403]],
    ['/api/employees/team',                   [200], [200, 403], [401, 403]],
    ['/api/employees/' + EID + '/documents',  [200], [200], [401, 403]],
    ['/api/attendance/today',                 [200, 400], [200], [401, 403]],
    ['/api/attendance/my?month=' + M,         [200, 400], [200], [401, 403]],
    ['/api/attendance/day?date=' + today,     [200], [403], [401, 403]],
    ['/api/attendance/insights?month=' + M,   [200], [403], [401, 403]],
    ['/api/attendance/corrections',           [200], [401, 403], [401, 403]],
    ['/api/attendance/corrections/my',        [200, 400], [200], [401, 403]],
    ['/api/leave',                            [200], [401, 403], [401, 403]],
    ['/api/leave/types',                      [200], [200], [401, 403]],
    ['/api/leave/balance',                    [200, 400], [200], [401, 403]],
    ['/api/leave/my',                         [200, 400], [200], [401, 403]],
    ['/api/leave/calendar?month=' + M,        [200], [401, 403], [401, 403]],
    ['/api/leave/ledger',                     [200], [200], [401, 403]],
    ['/api/leave/compoff',                    [200], [401, 403], [401, 403]],
    ['/api/reimbursement',                    [200], [401, 403], [401, 403]],
    ['/api/reimbursement/my',                 [200, 400], [200], [401, 403]],
    ['/api/payroll?month=' + M,               [200], [401, 403], [401, 403]],
    ['/api/payroll/my',                       [200, 400], [200], [401, 403]],
    ['/api/payroll/run?month=' + M,           [200], [401, 403], [401, 403]],
    ['/api/loans',                            [200], [401, 403], [401, 403]],
    ['/api/assets',                           [200], [200, 401, 403], [401, 403]],
    ['/api/assets/mine',                      [200, 400], [200], [401, 403]],
    ['/api/inventory',                        [200], [200, 401, 403], [401, 403]],
    ['/api/inventory/stats',                  [200], [200, 401, 403], [401, 403]],
    ['/api/kudos',                            [200], [200], [401, 403]],
    ['/api/kudos/leaderboard',                [200], [200], [401, 403]],
    ['/api/goals/mine',                       [200], [200], [401, 403]],
    ['/api/goals/' + EID,                     [200], [200, 403], [401, 403]],
    ['/api/reviews/mine',                     [200], [200], [401, 403]],
    ['/api/reviews/' + EID,                   [200], [200, 403], [401, 403]],
    ['/api/surveys',                          [200], [200], [401, 403]],
    ['/api/tickets',                          [200], [401, 403], [401, 403]],
    ['/api/tickets/mine',                     [200, 400], [200], [401, 403]],
    ['/api/announcements',                    [200], [200], [401, 403]],
    ['/api/holidays?year=2026',               [200], [200], [401, 403]],
    ['/api/notifications',                    [200], [200], [401, 403]],
    ['/api/mood/my',                          [200, 400], [200], [401, 403]],
    ['/api/mood/dashboard',                   [200], [403], [401, 403]],
    ['/api/onboarding',                       [200], [401, 403], [401, 403]],
    ['/api/onboarding/' + EID,                [200], [200], [401, 403]],
    ['/api/recruitment/jobs',                 [200], [401, 403], [401, 403]],
    ['/api/offboarding',                      [200], [401, 403], [401, 403]],
    ['/api/offboarding/mine',                 [200], [200], [401, 403]],
    ['/api/timesheets/projects',              [200], [200], [401, 403]],
    ['/api/timesheets/mine',                  [200, 400], [200], [401, 403]],
    ['/api/timesheets',                       [200], [401, 403], [401, 403]],
    ['/api/timesheets/summary',               [200], [401, 403], [401, 403]],
    ['/api/settings',                         [200], [401, 403], [401, 403]],
    ['/api/settings/access',                  [200], [401, 403], [401, 403]],
    ['/api/automation/status',                [200], [401, 403], [401, 403]],
    ['/api/birthdays/today',                  [200], [401, 403], [401, 403]],
    ['/api/ai/status',                        [200], [200], [401, 403]],
    ['/api/ai/recommendations?type=leave',    [200], [401, 403], [401, 403]],
  ];
  for (const [path, a, e, n] of matrix) {
    await check('ADMIN  GET ' + path, 'admin', 'GET', path, null, a);
    await check('EMP    GET ' + path, 'emp', 'GET', path, null, e);
    await check('ANON   GET ' + path, 'anon', 'GET', path, null, n);
  }

  // ============ 2) DATE & BACKDATING RULES ============
  await check('leave: backdated start rejected', 'emp', 'POST', '/api/leave', { type: 'casual', from_date: plus(-3), to_date: plus(-3), reason: 'x' }, [400]);
  await check('leave: yesterday rejected', 'emp', 'POST', '/api/leave', { type: 'casual', from_date: plus(-1), to_date: plus(-1), reason: 'x' }, [400]);
  await check('leave: end before start rejected', 'emp', 'POST', '/api/leave', { type: 'casual', from_date: plus(5), to_date: plus(2), reason: 'x' }, [400]);
  await check('leave: >60 days rejected', 'emp', 'POST', '/api/leave', { type: 'casual', from_date: plus(2), to_date: plus(70), reason: 'x' }, [400]);
  await check('leave: >1y ahead rejected', 'emp', 'POST', '/api/leave', { type: 'casual', from_date: plus(400), to_date: plus(401), reason: 'x' }, [400]);
  await check('leave: bad date format rejected', 'emp', 'POST', '/api/leave', { type: 'casual', from_date: '12-08-2026', to_date: '12-08-2026' }, [400]);
  await check('leave: half-day multi-date rejected', 'emp', 'POST', '/api/leave', { type: 'casual', from_date: plus(2), to_date: plus(3), half_day: 1 }, [400]);
  await check('leave: missing type rejected', 'emp', 'POST', '/api/leave', { from_date: plus(2), to_date: plus(2) }, [400]);
  await check('AI act: backdated leave rejected', 'emp', 'POST', '/api/ai/act', { name: 'apply_leave', params: { type: 'casual', from_date: plus(-2), to_date: plus(-2) } }, [400]);
  await check('AI act: bad leave type rejected', 'emp', 'POST', '/api/ai/act', { name: 'apply_leave', params: { type: 'zzz', from_date: plus(2), to_date: plus(2) } }, [400]);
  await check('timesheet: future date rejected', 'emp', 'POST', '/api/timesheets/entry', { date: plus(2), hours: 4 }, [400]);
  await check('timesheet: >30d old rejected', 'emp', 'POST', '/api/timesheets/entry', { date: plus(-40), hours: 4 }, [400]);
  await check('timesheet: 0 hours rejected', 'emp', 'POST', '/api/timesheets/entry', { date: today, hours: 0 }, [400]);
  await check('timesheet: 25 hours rejected', 'emp', 'POST', '/api/timesheets/entry', { date: today, hours: 25 }, [400]);
  await check('timesheet: bad date rejected', 'emp', 'POST', '/api/timesheets/entry', { date: 'nonsense', hours: 4 }, [400]);
  await check('goal: past target date rejected', 'emp', 'POST', '/api/goals', { title: 'x', target_date: plus(-5) }, [400]);
  await check('correction: non-today date rejected', 'emp', 'POST', '/api/attendance/correction', { date: plus(-2), type: 'wfh', requested_status: 'present', reason: 'x' }, [400]);
  await check('attendance mark: bad date rejected (admin)', 'admin', 'POST', '/api/attendance/mark', { employee_id: EID, date: '2026/01/01', status: 'present' }, [400]);

  // ============ 3) INPUT VALIDATION & PERMISSION-DENIED WRITES ============
  await check('reimb: missing amount rejected', 'emp', 'POST', '/api/reimbursement', { title: 'x' }, [400]);
  await check('kudos: missing message rejected', 'emp', 'POST', '/api/kudos', { employee_id: EID }, [400]);
  await check('ticket: missing subject rejected', 'emp', 'POST', '/api/tickets', { category: 'it' }, [400]);
  await check('survey create: employee denied', 'emp', 'POST', '/api/surveys', { title: 'x', questions: '[]' }, [401, 403]);
  await check('announcement post: employee denied', 'emp', 'POST', '/api/announcements', { title: 'x', body: 'y' }, [401, 403]);
  await check('holiday add: employee denied', 'emp', 'POST', '/api/holidays', { date: plus(30), name: 'X' }, [401, 403]);
  await check('employee create: employee denied', 'emp', 'POST', '/api/employees', { name: 'Hacker' }, [401, 403]),
  await check('employee delete: employee denied', 'emp', 'DELETE', '/api/employees/' + EID, null, [401, 403, 404, 405]);
  await check('settings save: employee denied', 'emp', 'PUT', '/api/settings', { companyName: 'Hax' }, [401, 403]);
  await check('settings access: employee denied', 'emp', 'PUT', '/api/settings/access', { rolePermissions: {} }, [401, 403]);
  await check('payroll generate: employee denied', 'emp', 'POST', '/api/payroll/generate', { month: M }, [401, 403, 404]);
  await check('leave decision: employee denied', 'emp', 'POST', '/api/leave/999999/decision', { decision: 'approved' }, [401, 403]);
  await check('leave decision: bad verdict rejected', 'admin', 'POST', '/api/leave/999999/decision', { decision: 'maybe' }, [400]);
  await check('leave decision: missing id 404', 'admin', 'POST', '/api/leave/999999/decision', { decision: 'approved' }, [404]);
  await check('corr decision: employee denied', 'emp', 'POST', '/api/attendance/corrections/1/decision', { decision: 'approved' }, [401, 403]);
  await check('compoff grant: employee denied', 'emp', 'POST', '/api/leave/compoff', { employee_id: EID, days: 1 }, [401, 403]);
  await check('accrual run: employee denied', 'emp', 'POST', '/api/leave/accrual/run', {}, [401, 403]);
  await check('offboarding start: employee denied', 'emp', 'POST', '/api/offboarding', { employee_id: 1 }, [401, 403]);
  await check('offboarding detail: employee denied', 'emp', 'GET', '/api/offboarding/1', null, [401, 403]);
  await check('project create: employee denied', 'emp', 'POST', '/api/timesheets/projects', { name: 'X' }, [401, 403]);
  await check('project create: empty name rejected', 'admin', 'POST', '/api/timesheets/projects', { name: '  ' }, [400]);
  await check('ts decision: employee denied', 'emp', 'POST', '/api/timesheets/decision', { ids: [1], decision: 'approved' }, [401, 403]);
  await check('ts decision: no ids rejected', 'admin', 'POST', '/api/timesheets/decision', { ids: [], decision: 'approved' }, [400]);
  await check('job create: employee denied', 'emp', 'POST', '/api/recruitment/jobs', { title: 'X' }, [401, 403]);
  await check('birthday send: employee denied', 'emp', 'POST', '/api/birthdays/send', {}, [401, 403]);
  await check('automation run: employee denied', 'emp', 'POST', '/api/automation/run', {}, [401, 403]);
  await check('AI act: unknown action rejected', 'emp', 'POST', '/api/ai/act', { name: 'nuke_db', params: {} }, [400]);
  await check('AI screen: employee denied', 'emp', 'POST', '/api/ai/screen/1', {}, [401, 403]);
  await check('AI chat: empty question rejected', 'emp', 'POST', '/api/ai/chat', {}, [400]);
  await check('AI draft: empty brief rejected', 'admin', 'POST', '/api/ai/draft', { kind: 'announcement', brief: '' }, [400]);
  await check('goal: missing title rejected', 'emp', 'POST', '/api/goals', { description: 'x' }, [400]);
  await check('settlement save: employee denied', 'emp', 'PUT', '/api/offboarding/1/settlement', { settlement: {} }, [401, 403]);
  await check('exit task toggle: employee denied', 'emp', 'POST', '/api/offboarding/1/tasks/1/toggle', {}, [401, 403]);
  await check('mood checkin: bad score rejected', 'emp', 'POST', '/api/mood/checkin', { score: 9 }, [400]);
  await check('employee by id: not found 404', 'admin', 'GET', '/api/employees/999999', null, [404]);
  await check('applicant resume: anon denied', 'anon', 'GET', '/api/recruitment/applicants/1/resume', null, [401, 403]);
  await check('uploads traversal blocked', 'anon', 'GET', '/uploads/..%2F..%2Fserver%2Fconfig.js', null, [400, 404]);

  // ============ 4) PUBLIC PAGES & CAREERS PIPELINE ============
  await check('public: /api/health', 'anon', 'GET', '/api/health', null, [200]);
  await check('public: settings/public', 'anon', 'GET', '/api/settings/public', null, [200]);
  await check('public: careers jobs list', 'anon', 'GET', '/api/careers/jobs', null, [200], (r) => Array.isArray(r.j.jobs));
  await check('public: careers page serves', 'anon', 'GET', '/careers', null, [200]);
  await check('public: app page serves', 'anon', 'GET', '/', null, [200]);
  await check('public: preboard page serves', 'anon', 'GET', '/preboard/sometoken', null, [200]);
  await check('careers apply: missing job 404', 'anon', 'POST', '/api/careers/apply/999999', { name: 'A', email: 'a@b.co' }, [404]);
  // Slack webhook handshake
  {
    const r = await call('anon', 'POST', '/api/slack/events', { type: 'url_verification', challenge: 'ch123' });
    results.push({ name: 'public: slack handshake echoes challenge', ok: r.s === 200 && r.j && r.j.challenge === 'ch123', got: r.s, expect: '200', err: '' });
  }

  // ============ 5) SUCCESS PATHS (skipped on prod via SAFE=1 — they email/notify) ============
  if (!SAFE) {
    const lv = await call('emp', 'POST', '/api/leave', { type: 'casual', from_date: plus(10), to_date: plus(10), reason: 'SUITE-TEST' });
    results.push({ name: 'leave: valid future apply works', ok: lv.s === 200 && lv.j.id, got: lv.s, expect: '200', err: (lv.j && lv.j.error) || '' });
    const ts = await call('emp', 'POST', '/api/timesheets/entry', { date: today, hours: 1, task: 'SUITE-TEST' });
    results.push({ name: 'timesheet: valid today entry works', ok: ts.s === 200, got: ts.s, expect: '200', err: (ts.j && ts.j.error) || '' });
    if (ts.s === 200 && ts.j.id) await call('emp', 'DELETE', '/api/timesheets/entry/' + ts.j.id);
    const gl = await call('emp', 'POST', '/api/goals', { title: 'SUITE-TEST', target_date: plus(30) });
    results.push({ name: 'goal: valid future target works', ok: gl.s === 200, got: gl.s, expect: '200', err: (gl.j && gl.j.error) || '' });
    if (gl.s === 200 && gl.j.id) await call('emp', 'DELETE', '/api/goals/' + gl.j.id);
    // careers apply success (no email involved)
    const fd = new (require('node:buffer').Blob ? FormData : Object)();
    if (typeof FormData !== 'undefined') {
      const jobsR = await call('anon', 'GET', '/api/careers/jobs');
      if ((jobsR.j.jobs || []).length) {
        const jid = jobsR.j.jobs[0].id;
        const f = new FormData();
        f.append('name', 'Suite Test Candidate');
        f.append('email', 'suite-test@example.com');
        f.append('skills', jobsR.j.jobs[0].skills || 'testing');
        f.append('experience_years', '3');
        const ap = await fetch(BASE + '/api/careers/apply/' + jid, { method: 'POST', body: f });
        const apj = await ap.json().catch(() => ({}));
        results.push({ name: 'careers: valid apply works', ok: ap.status === 200 && apj.ok, got: ap.status, expect: '200', err: apj.error || '' });
        const dup = await fetch(BASE + '/api/careers/apply/' + jid, { method: 'POST', body: f });
        results.push({ name: 'careers: duplicate apply rejected', ok: dup.status === 400, got: dup.status, expect: '400', err: '' });
      } else {
        results.push({ name: 'careers: valid apply works', ok: true, got: 'skip(no open jobs)', expect: '-', err: '' });
        results.push({ name: 'careers: duplicate apply rejected', ok: true, got: 'skip(no open jobs)', expect: '-', err: '' });
      }
    }
  }

  // ============ report ============
  const fails = results.filter((r) => !r.ok);
  console.log('\n================== SUITE RESULTS ==================');
  for (const f of fails) console.log('FAIL  ' + f.name.padEnd(52) + ' got ' + f.got + ' (want ' + f.expect + ')' + (f.err ? '  ' + f.err : ''));
  console.log('===================================================');
  console.log('TOTAL CHECKS: ' + results.length + ' | PASS: ' + (results.length - fails.length) + ' | FAIL: ' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
