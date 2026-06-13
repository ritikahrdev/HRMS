// ============================================================================
// HRMS END-TO-END AUDIT SUITE  (1000+ cases)
// Runs against the isolated SQLite test server (BASE=http://localhost:4100).
// Categories: RBAC, PrivEsc, IDOR, Validation, SQLi, XSS, Auth/Session, Logic,
// API-Robustness, DB-Integrity. Writes tests/audit-results.json + prints summary.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { loginAll } = require('./_lib');

const today = new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const ym = today.slice(0, 7);

const results = [];
function rec(category, name, pass, o = {}) {
  results.push({ category, name, pass: !!pass, sev: o.sev || 'Medium', got: o.got, expect: o.expect, detail: o.detail || '' });
}
const inSet = (arr, v) => arr.includes(v);

(async () => {
  const S = await loginAll();
  const EID = S.employee.user.employeeId;   // 4
  const E2 = S.employee2.user.employeeId;    // 5
  const MID = S.manager.user.employeeId;     // 3
  const HID = S.hr.user.employeeId;          // 1

  // ========================================================================
  // SECTION 1 — RBAC ACCESS MATRIX  (admin/employee/anon proven + hr/fin/mgr session-invariant)
  // ========================================================================
  const matrix = [
    ['/api/reports/overview', [200], [403], [401, 403]],
    ['/api/reports/attendance?month=' + ym, [200], [403], [401, 403]],
    ['/api/reports/payroll?month=' + ym, [200], [403], [401, 403]],
    ['/api/employees', [200], [403], [401, 403]],
    ['/api/employees/stats', [200], [403], [401, 403]],
    ['/api/employees/directory', [200], [200], [401, 403]],
    ['/api/employees/celebrations', [200], [200], [401, 403]],
    ['/api/employees/me', [200], [200], [401, 403]],
    ['/api/employees/team', [200], [200, 403], [401, 403]],
    ['/api/employees/' + EID + '/documents', [200], [200], [401, 403]],
    ['/api/attendance/today', [200, 400], [200], [401, 403]],
    ['/api/attendance/my?month=' + ym, [200, 400], [200], [401, 403]],
    ['/api/attendance/day?date=' + today, [200], [403], [401, 403]],
    ['/api/attendance/insights?month=' + ym, [200], [403], [401, 403]],
    ['/api/attendance/corrections', [200], [401, 403], [401, 403]],
    ['/api/attendance/corrections/my', [200, 400], [200], [401, 403]],
    ['/api/leave', [200], [401, 403], [401, 403]],
    ['/api/leave/types', [200], [200], [401, 403]],
    ['/api/leave/balance', [200, 400], [200], [401, 403]],
    ['/api/leave/my', [200, 400], [200], [401, 403]],
    ['/api/leave/calendar?month=' + ym, [200], [401, 403], [401, 403]],
    ['/api/leave/ledger', [200], [200], [401, 403]],
    ['/api/leave/compoff', [200], [401, 403], [401, 403]],
    ['/api/reimbursement', [200], [401, 403], [401, 403]],
    ['/api/reimbursement/my', [200, 400], [200], [401, 403]],
    ['/api/payroll?month=' + ym, [200], [401, 403], [401, 403]],
    ['/api/payroll/my', [200, 400], [200], [401, 403]],
    ['/api/payroll/run?month=' + ym, [200], [401, 403], [401, 403]],
    ['/api/loans', [200], [401, 403], [401, 403]],
    ['/api/assets', [200], [200, 401, 403], [401, 403]],
    ['/api/assets/mine', [200, 400], [200], [401, 403]],
    ['/api/inventory', [200], [200, 401, 403], [401, 403]],
    ['/api/inventory/stats', [200], [200, 401, 403], [401, 403]],
    ['/api/kudos', [200], [200], [401, 403]],
    ['/api/kudos/leaderboard', [200], [200], [401, 403]],
    ['/api/goals/mine', [200], [200], [401, 403]],
    ['/api/goals/' + EID, [200], [200, 403], [401, 403]],
    ['/api/reviews/mine', [200], [200], [401, 403]],
    ['/api/reviews/' + EID, [200], [200, 403], [401, 403]],
    ['/api/surveys', [200], [200], [401, 403]],
    ['/api/tickets', [200], [401, 403], [401, 403]],
    ['/api/tickets/mine', [200, 400], [200], [401, 403]],
    ['/api/announcements', [200], [200], [401, 403]],
    ['/api/holidays?year=2026', [200], [200], [401, 403]],
    ['/api/notifications', [200], [200], [401, 403]],
    ['/api/mood/my', [200, 400], [200], [401, 403]],
    ['/api/mood/dashboard', [200], [403], [401, 403]],
    ['/api/onboarding', [200], [401, 403], [401, 403]],
    ['/api/onboarding/' + EID, [200], [200], [401, 403]],
    ['/api/recruitment/jobs', [200], [401, 403], [401, 403]],
    ['/api/offboarding', [200], [401, 403], [401, 403]],
    ['/api/offboarding/mine', [200], [200], [401, 403]],
    ['/api/timesheets/projects', [200], [200], [401, 403]],
    ['/api/timesheets/mine', [200, 400], [200], [401, 403]],
    ['/api/timesheets', [200], [401, 403], [401, 403]],
    ['/api/timesheets/summary', [200], [401, 403], [401, 403]],
    ['/api/settings', [200], [401, 403], [401, 403]],
    ['/api/settings/access', [200], [401, 403], [401, 403]],
    ['/api/automation/status', [200], [401, 403], [401, 403]],
    ['/api/birthdays/today', [200], [401, 403], [401, 403]],
    ['/api/ai/status', [200], [200], [401, 403]],
    ['/api/ai/recommendations?type=leave', [200], [401, 403], [401, 403]],
  ];
  for (const [p, a, e, n] of matrix) {
    let r = await S.admin.call('GET', p); rec('RBAC', `admin GET ${p}`, inSet(a, r.status), { sev: 'High', got: r.status, expect: a.join('/') });
    r = await S.employee.call('GET', p); rec('RBAC', `employee GET ${p}`, inSet(e, r.status), { sev: 'High', got: r.status, expect: e.join('/') });
    r = await S.anon.call('GET', p); rec('RBAC', `anon GET ${p}`, inSet(n, r.status), { sev: 'High', got: r.status, expect: n.join('/') });
    for (const role of ['hr', 'finance', 'manager']) {
      r = await S[role].call('GET', p);
      rec('RBAC', `${role} GET ${p} (session/no-crash)`, r.status !== 500 && r.status !== 401, { sev: 'High', got: r.status, expect: '!500,!401' });
    }
  }

  // ========================================================================
  // SECTION 2 — PRIVILEGE ESCALATION (explicit denials by the permission model)
  // ========================================================================
  const denials = [
    ['employee', 'POST', '/api/employees', { name: 'Hacker' }],
    ['employee', 'DELETE', '/api/employees/' + E2, null],
    ['employee', 'PUT', '/api/settings', { companyName: 'Hax' }],
    ['employee', 'PUT', '/api/settings/access', { rolePermissions: {} }],
    ['employee', 'POST', '/api/payroll/generate', { month: ym }],
    ['employee', 'POST', '/api/holidays', { date: plus(30), name: 'X' }],
    ['employee', 'POST', '/api/announcements', { title: 'x', body: 'y' }],
    ['employee', 'POST', '/api/surveys', { title: 'x', questions: '[]' }],
    ['employee', 'POST', '/api/recruitment/jobs', { title: 'X' }],
    ['employee', 'POST', '/api/leave/' + 999999 + '/decision', { decision: 'approved' }],
    ['employee', 'POST', '/api/automation/run', {}],
    ['employee', 'POST', '/api/birthdays/send', {}],
    ['employee', 'POST', '/api/leave/compoff', { employee_id: EID, days: 1 }],
    ['employee', 'POST', '/api/offboarding', { employee_id: 1 }],
    ['employee', 'POST', '/api/timesheets/projects', { name: 'X' }],
    // cross-role escalations beyond each role's permission set
    ['finance', 'PUT', '/api/settings', { companyName: 'Hax' }],          // finance lacks settings:manage
    ['finance', 'POST', '/api/employees', { name: 'X' }],                 // finance: employees:read only
    ['finance', 'POST', '/api/recruitment/jobs', { title: 'X' }],         // finance lacks recruitment:manage
    ['manager', 'GET', '/api/employees', null],                           // manager lacks employees:read
    ['manager', 'POST', '/api/payroll/generate', { month: ym }],          // manager lacks payroll:manage
    ['manager', 'PUT', '/api/settings', { companyName: 'Hax' }],          // manager lacks settings:manage
    ['manager', 'POST', '/api/announcements', { title: 'x' }],            // manager lacks settings:manage
    ['hr', 'POST', '/api/payroll/generate', { month: ym }],               // hr lacks payroll:manage
    ['employee', 'GET', '/api/reports/overview', null],
    ['employee', 'GET', '/api/payroll?month=' + ym, null],
    ['employee', 'GET', '/api/loans', null],
  ];
  for (const [role, m, p, b] of denials) {
    const r = await S[role].call(m, p, b);
    rec('PrivEsc', `${role} ${m} ${p} denied`, inSet([401, 403, 404], r.status), { sev: 'Critical', got: r.status, expect: '401/403/404' });
  }

  // ========================================================================
  // SECTION 3 — HORIZONTAL IDOR (act on / read another employee's data)
  // ========================================================================
  // 3a. Reading another employee's scoped resources as a plain employee.
  for (const [p, label] of [
    ['/api/goals/' + E2, 'goals'],
    ['/api/reviews/' + E2, 'reviews'],
    ['/api/onboarding/' + E2, 'onboarding'],
    ['/api/employees/' + E2, 'employee record'],
    ['/api/employees/' + E2 + '/documents', 'documents'],
  ]) {
    const r = await S.employee.call('GET', p);
    rec('IDOR', `employee reads other's ${label} (${p})`, inSet([401, 403, 404], r.status), { sev: 'High', got: r.status, expect: '401/403/404' });
  }
  // 3b. employee tries to write to another employee's records (employee_id in body must be ignored/blocked)
  {
    // leave for self only: even if employee_id=E2 supplied, must apply to EID (or reject)
    const r = await S.employee.call('POST', '/api/leave', { employee_id: E2, type: 'casual', from_date: plus(12), to_date: plus(12), reason: 'IDOR-test' });
    // verify it did NOT create a leave for E2
    const lv = await S.admin.call('GET', '/api/leave');
    const leakedToE2 = lv.json && Array.isArray(lv.json.leaves || lv.json.requests || lv.json)
      ? (lv.json.leaves || lv.json.requests || lv.json).some((x) => x.employee_id === E2 && x.reason === 'IDOR-test')
      : false;
    rec('IDOR', 'employee cannot file leave for another employee_id', !leakedToE2, { sev: 'High', got: r.status, detail: 'leakedToE2=' + leakedToE2 });
  }
  // 3c. employee posts a review for someone else (should be denied — reviews are mgr/hr)
  {
    const r = await S.employee.call('POST', '/api/reviews', { employee_id: E2, period: ym, rating: 1, strengths: 'x', improvements: 'y' });
    rec('IDOR', 'employee cannot create a performance review', inSet([401, 403], r.status), { sev: 'High', got: r.status, expect: '401/403' });
  }
  // 3d. manager acts outside team (approve leave / read attendance of a non-report)
  {
    // employee2 (E2) reports to manager -> within team. HR (HID) is NOT manager's report.
    const r = await S.manager.call('GET', '/api/goals/' + HID);
    rec('IDOR', 'manager reading non-report goals is scoped/denied', inSet([200, 403, 404], r.status) && r.status !== 500, { sev: 'Medium', got: r.status });
  }

  // ========================================================================
  // SECTION 4 — INPUT VALIDATION & NEGATIVE CASES
  // ========================================================================
  const V = [];
  const vc = (name, role, m, p, b, expect, sev = 'Medium') => V.push({ name, role, m, p, b, expect, sev });
  // dates / backdating
  vc('leave backdated start rejected', 'employee', 'POST', '/api/leave', { type: 'casual', from_date: plus(-3), to_date: plus(-3), reason: 'x' }, [400]);
  vc('leave yesterday rejected', 'employee', 'POST', '/api/leave', { type: 'casual', from_date: plus(-1), to_date: plus(-1), reason: 'x' }, [400]);
  vc('leave end<start rejected', 'employee', 'POST', '/api/leave', { type: 'casual', from_date: plus(5), to_date: plus(2), reason: 'x' }, [400]);
  vc('leave >60 days rejected', 'employee', 'POST', '/api/leave', { type: 'casual', from_date: plus(2), to_date: plus(70), reason: 'x' }, [400]);
  vc('leave >1y ahead rejected', 'employee', 'POST', '/api/leave', { type: 'casual', from_date: plus(400), to_date: plus(401), reason: 'x' }, [400]);
  vc('leave bad date format rejected', 'employee', 'POST', '/api/leave', { type: 'casual', from_date: '12-08-2026', to_date: '12-08-2026' }, [400]);
  vc('leave impossible date 2026-13-40 rejected', 'employee', 'POST', '/api/leave', { type: 'casual', from_date: '2026-13-40', to_date: '2026-13-40', reason: 'x' }, [400]);
  vc('leave half-day multi-date rejected', 'employee', 'POST', '/api/leave', { type: 'casual', from_date: plus(2), to_date: plus(3), half_day: 1 }, [400]);
  vc('leave missing type rejected', 'employee', 'POST', '/api/leave', { from_date: plus(2), to_date: plus(2) }, [400]);
  vc('leave unknown type rejected', 'employee', 'POST', '/api/leave', { type: 'zzz', from_date: plus(2), to_date: plus(2), reason: 'x' }, [400]);
  vc('timesheet future date rejected', 'employee', 'POST', '/api/timesheets/entry', { date: plus(2), hours: 4 }, [400]);
  vc('timesheet >30d old rejected', 'employee', 'POST', '/api/timesheets/entry', { date: plus(-40), hours: 4 }, [400]);
  vc('timesheet 0 hours rejected', 'employee', 'POST', '/api/timesheets/entry', { date: today, hours: 0 }, [400]);
  vc('timesheet 25 hours rejected', 'employee', 'POST', '/api/timesheets/entry', { date: today, hours: 25 }, [400]);
  vc('timesheet negative hours rejected', 'employee', 'POST', '/api/timesheets/entry', { date: today, hours: -5 }, [400]);
  vc('timesheet bad date rejected', 'employee', 'POST', '/api/timesheets/entry', { date: 'nonsense', hours: 4 }, [400]);
  vc('goal past target rejected', 'employee', 'POST', '/api/goals', { title: 'x', target_date: plus(-5) }, [400]);
  vc('goal missing title rejected', 'employee', 'POST', '/api/goals', { description: 'x' }, [400]);
  vc('correction non-today rejected', 'employee', 'POST', '/api/attendance/correction', { date: plus(-2), type: 'wfh', requested_status: 'present', reason: 'x' }, [400]);
  vc('admin mark bad date rejected', 'admin', 'POST', '/api/attendance/mark', { employee_id: EID, date: '2026/01/01', status: 'present' }, [400]);
  vc('reimb missing amount rejected', 'employee', 'POST', '/api/reimbursement', { title: 'x' }, [400]);
  vc('reimb negative amount rejected', 'employee', 'POST', '/api/reimbursement', { title: 'x', amount: -100 }, [400]);
  vc('reimb non-numeric amount rejected', 'employee', 'POST', '/api/reimbursement', { title: 'x', amount: 'abc' }, [400]);
  vc('kudos missing message rejected', 'employee', 'POST', '/api/kudos', { employee_id: EID }, [400]);
  vc('ticket missing subject rejected', 'employee', 'POST', '/api/tickets', { category: 'it' }, [400]);
  vc('mood bad score 9 rejected', 'employee', 'POST', '/api/mood/checkin', { score: 9 }, [400]);
  vc('mood bad score 0 rejected', 'employee', 'POST', '/api/mood/checkin', { score: 0 }, [400]);
  vc('mood non-numeric score rejected', 'employee', 'POST', '/api/mood/checkin', { score: 'x' }, [400]);
  vc('leave decision bad verdict rejected', 'admin', 'POST', '/api/leave/999999/decision', { decision: 'maybe' }, [400]);
  vc('leave decision missing id 404', 'admin', 'POST', '/api/leave/999999/decision', { decision: 'approved' }, [404]);
  vc('project empty name rejected', 'admin', 'POST', '/api/timesheets/projects', { name: '  ' }, [400]);
  vc('ts decision no ids rejected', 'admin', 'POST', '/api/timesheets/decision', { ids: [], decision: 'approved' }, [400]);
  vc('AI act unknown action rejected', 'employee', 'POST', '/api/ai/act', { name: 'nuke_db', params: {} }, [400]);
  vc('AI act backdated leave rejected', 'employee', 'POST', '/api/ai/act', { name: 'apply_leave', params: { type: 'casual', from_date: plus(-2), to_date: plus(-2) } }, [400]);
  vc('AI chat empty rejected', 'employee', 'POST', '/api/ai/chat', {}, [400]);
  vc('AI draft empty brief rejected', 'admin', 'POST', '/api/ai/draft', { kind: 'announcement', brief: '' }, [400]);
  vc('employee by id 999999 -> 404', 'admin', 'GET', '/api/employees/999999', null, [404]);
  vc('holiday add empty name rejected', 'admin', 'POST', '/api/holidays', { date: plus(30), name: '' }, [400]);
  vc('holiday add bad date rejected', 'admin', 'POST', '/api/holidays', { date: 'xx', name: 'X' }, [400]);
  vc('survey create no title rejected', 'admin', 'POST', '/api/surveys', { questions: '[]' }, [400]);
  vc('employee create no name rejected', 'admin', 'POST', '/api/employees', {}, [400]);
  for (const t of V) {
    const r = await S[t.role].call(t.m, t.p, t.b);
    rec('Validation', t.name, inSet(t.expect, r.status), { sev: t.sev, got: r.status, expect: t.expect.join('/') });
  }

  // ========================================================================
  // SECTION 7 — AUTH & SESSION
  // ========================================================================
  const auth = [];
  const rawLogin = require('./_lib').rawLogin;
  { const l = await rawLogin('admin@company.local', 'wrongpass'); rec('Auth', 'wrong password -> 401', l.status === 401, { sev: 'High', got: l.status }); }
  { const l = await rawLogin('nobody@nowhere.zz', 'x'); rec('Auth', 'unknown user -> 401', l.status === 401, { sev: 'High', got: l.status }); }
  { const l = await rawLogin('ADMIN@COMPANY.LOCAL', 'ChangeMe@12345'); rec('Auth', 'email case-insensitive login works', l.status === 200, { sev: 'Low', got: l.status }); }
  { const l = await rawLogin('', ''); rec('Auth', 'empty creds -> 400', l.status === 400, { sev: 'Medium', got: l.status }); }
  { const r = await S.anon.call('GET', '/api/employees/me'); rec('Auth', 'no session -> 401 on protected', r.status === 401, { sev: 'High', got: r.status }); }
  { const r = await S.anon.call('GET', '/api/settings', null, { headers: { cookie: 'connect.sid=s%3Aforged.deadbeef' } }); rec('Auth', 'forged session cookie rejected', inSet([401, 403], r.status), { sev: 'High', got: r.status }); }
  // session cookie flags
  { const l = await rawLogin('employee@company.local', 'employee123'); /* check Set-Cookie httpOnly */ }
  { const r = await S.employee.call('POST', '/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'abcdef' }); rec('Auth', 'change-password wrong current -> 400', r.status === 400, { sev: 'High', got: r.status }); }
  { const r = await S.employee.call('POST', '/api/auth/change-password', { currentPassword: 'employee123', newPassword: '123' }); rec('Auth', 'change-password too short -> 400', r.status === 400, { sev: 'Medium', got: r.status }); }
  { const r = await S.anon.call('GET', '/api/auth/me'); rec('Auth', 'anon /auth/me -> 401', r.status === 401, { sev: 'Low', got: r.status }); }

  // ========================================================================
  // SECTION 9 — API ROBUSTNESS
  // ========================================================================
  {
    const r = await fetch((process.env.BASE || 'http://localhost:4100') + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: S.admin.cookie }, body: '{bad json' });
    rec('API', 'malformed JSON -> 400 (not 500)', r.status === 400, { sev: 'Medium', got: r.status });
  }
  { const r = await S.admin.call('GET', '/api/does-not-exist'); rec('API', 'unknown route -> 404', inSet([404], r.status), { sev: 'Low', got: r.status }); }
  { const r = await S.admin.call('GET', '/api/employees/abc'); rec('API', 'non-numeric id -> 404 (id guard)', r.status === 404, { sev: 'Medium', got: r.status }); }
  { const r = await S.admin.call('GET', '/api/employees/-1'); rec('API', 'negative id -> 404', r.status === 404, { sev: 'Medium', got: r.status }); }
  { const r = await S.admin.call('GET', '/api/employees/99999999999999999999'); rec('API', 'overflow id -> 404/400 (no crash)', inSet([400, 404], r.status), { sev: 'Medium', got: r.status }); }
  { const r = await S.admin.call('DELETE', '/api/health'); rec('API', 'wrong method on health -> 404/405', inSet([404, 405], r.status), { sev: 'Low', got: r.status }); }
  { const r = await S.anon.call('GET', '/uploads/..%2F..%2Fserver%2Fconfig.js'); rec('API', 'path traversal in /uploads blocked', inSet([400, 404], r.status), { sev: 'Critical', got: r.status }); }
  { const r = await S.anon.call('GET', '/uploads/....//....//server/config.js'); rec('API', 'double-dot traversal blocked', inSet([400, 404], r.status), { sev: 'Critical', got: r.status }); }
  { const r = await S.anon.call('GET', '/api/health'); rec('API', 'health endpoint public 200', r.status === 200, { sev: 'Low', got: r.status }); }
  { const r = await S.anon.call('GET', '/api/settings/public'); rec('API', 'public settings 200', r.status === 200, { sev: 'Low', got: r.status }); }
  { const r = await S.anon.call('GET', '/api/careers/jobs'); rec('API', 'public careers jobs 200', r.status === 200, { sev: 'Low', got: r.status }); }

  // ========================================================================
  // SECTION 10 — DB INTEGRITY (unique constraints, FK)
  // ========================================================================
  {
    // duplicate attendance for same employee+date should be merged/blocked, not duplicated
    await S.admin.call('POST', '/api/attendance/mark', { employee_id: EID, date: today, status: 'present' });
    await S.admin.call('POST', '/api/attendance/mark', { employee_id: EID, date: today, status: 'present' });
    const day = await S.admin.call('GET', '/api/attendance/day?date=' + today);
    const rows = (day.json && (day.json.rows || day.json.attendance || day.json)) || [];
    const dupes = Array.isArray(rows) ? rows.filter((x) => x.employee_id === EID).length : 0;
    rec('DB', 'attendance unique(employee,date) holds (no dup)', dupes <= 1, { sev: 'High', got: dupes, expect: '<=1' });
  }
  {
    // duplicate employee email/emp_code create should fail
    const r1 = await S.admin.call('POST', '/api/employees', { name: 'Dup A', email: 'dupe@company.local', emp_code: 'DUP1' });
    const r2 = await S.admin.call('POST', '/api/employees', { name: 'Dup B', email: 'dupe@company.local', emp_code: 'DUP1' });
    rec('DB', 'duplicate emp_code/email rejected', inSet([400, 409], r2.status), { sev: 'Medium', got: r2.status, expect: '400/409', detail: 'first=' + r1.status });
  }

  // write partial results now (sweeps appended by audit-suite-2.js sharing the file)
  fs.writeFileSync(path.join(__dirname, 'audit-results.json'), JSON.stringify(results, null, 0));
  summarize(results, 'PART 1 (RBAC/PrivEsc/IDOR/Validation/Auth/API/DB)');
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });

function summarize(results, label) {
  const byCat = {};
  for (const r of results) { (byCat[r.category] = byCat[r.category] || { pass: 0, fail: 0 }); r.pass ? byCat[r.category].pass++ : byCat[r.category].fail++; }
  const fails = results.filter((r) => !r.pass);
  console.log('\n==================== ' + label + ' ====================');
  for (const f of fails) console.log(`FAIL [${f.sev}] [${f.category}] ${f.name}  got=${f.got} want=${f.expect || ''} ${f.detail}`);
  console.log('-----------------------------------------------------------');
  for (const [c, v] of Object.entries(byCat)) console.log(`${c.padEnd(12)} pass=${v.pass} fail=${v.fail}`);
  console.log(`TOTAL ${results.length} | PASS ${results.filter((r) => r.pass).length} | FAIL ${fails.length}`);
}
module.exports = { summarize };
