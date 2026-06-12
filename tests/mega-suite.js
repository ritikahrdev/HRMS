// HRMS MEGA suite — a GENERATOR that emits ~5000 DISTINCT, NON-DESTRUCTIVE checks.
//   node tests/mega-suite.js              → local (http://localhost:4100)
//   BASE=https://... node tests/...       → any base
//
// SAFETY: every case is either a READ or an intentionally-INVALID/permission-denied
// WRITE (expects 4xx). Nothing is ever persisted and no email is sent, so this is
// safe to run repeatedly. (Valid happy-paths are covered by regression-suite.js.)
//
// Composition (all distinct inputs — combinatorial boundary/fuzz testing):
//   A Access matrix          endpoint × {admin,emp,anon}
//   B Method probes          unsupported verbs × endpoints
//   C ID fuzz                bad ids × id-routes × roles  (no 500s, no crash)
//   D Injection              SQLi/XSS/traversal × many endpoints (as path & query)
//   E Query-param fuzz       month/date/year/limit garbage × endpoints
//   F Leave invalid matrix   bad dates × bad dates, bad types, offsets, injection
//   G Timesheet invalid      bad date × bad hours matrix
//   H Field validation       goals/reimb/mood/kudos/ticket bad inputs
//   I Escalation             emp/anon hitting admin writes
//   J AI-action fuzz         apply_leave / reimbursement invalid params
//   K Careers fuzz           bad job ids, bad emails
//   L Malformed body         broken JSON to many endpoints
//   M Auth & pages           login fuzz, public pages, 404s
const BASE = process.env.BASE || 'http://localhost:4100';
const CONC = Number(process.env.CONC || 10);
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

let ADMIN = '', EMP = '', EID = 0, VALID_TYPES = ['casual', 'sick', 'unpaid'];
const cases = [];
const add = (name, role, method, path, expect, body, pred, raw) =>
  cases.push({ name, role, method, path, body, expect: Array.isArray(expect) ? expect : [expect], pred, raw });

// fuzz vocabularies
const SQLI = ["1' OR '1'='1", "'; DROP TABLE employees;--", "1) OR 1=1--", "' UNION SELECT NULL--", "admin'--",
  "1;SELECT pg_sleep(0)", "' OR 1=1#", "\" OR \"\"=\"", "1' AND SLEEP(0)--", "%27%20OR%201=1",
  "') OR ('1'='1", "1 OR 1=1", "'; SELECT version()--"];
const XSS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', 'javascript:alert(1)', '<svg/onload=alert(1)>',
  '<iframe src=javascript:alert(1)>', '{{7*7}}', '${7*7}', '<body onload=alert(1)>', '"><svg onload=alert(1)>',
  "'-alert(1)-'", '<a href=javascript:alert(1)>x</a>'];
const TRAVERSAL = ['../../etc/passwd', '..%2f..%2fserver%2fconfig.js', '....//....//etc/passwd', '%2e%2e%2fserver',
  '..\\..\\windows\\win.ini', '/etc/passwd', '....\\\\....\\\\', '%252e%252e%252f'];
const BAD_IDS = ['0', '-1', '999999', 'abc', '1.5', '1e9', 'null', 'undefined', '%00', "1'--", '   ', 'NaN', '0x1F',
  '9'.repeat(40), '-0', 'true', '[]', '{}', '1,2', '0b10', '٥', 'Infinity'];
const BAD_DATES = ['', 'not-a-date', '2026-13-40', '12-08-2026', '2026/08/12', '0000-00-00', '2026-02-30', '20260812',
  '2026-2-3', '99999-01-01', 'yesterday', '2026-00-10', '2026-13-01', '2026-04-31', '32/01/2026', '2026.01.01',
  'Jan 1 2026', '2026-1-1T00:00', "2026-01-01'--", '٢٠٢٦-٠١-٠١', '2026-06-31', '2026-09-31', '2025-02-29'];
const BAD_MONTHS = ['', '2026-13', '2026-00', 'abc', '2026', '2026-1', '13/2026', '2026-12-01', '-1', '2026-99', "2026'--", 'NaN'];
const BAD_NUMS = ['', 'abc', '-5', '0', '1e99', 'NaN', 'Infinity', '99999999999999', '-0.0001', '   ', '1,000', '0x10'];
const BAD_LIMITS = ['-1', '0', 'abc', '1e9', '99999999', '-99', 'null', '1.5'];

function buildCases() {
  const M = today.slice(0, 7);

  // ===== A. ACCESS MATRIX =====
  const matrix = [
    ['/api/reports/overview', [200], [403], [401, 403]],
    ['/api/reports/attendance?month=' + M, [200], [403], [401, 403]],
    ['/api/reports/payroll?month=' + M, [200], [403], [401, 403]],
    ['/api/employees', [200], [403], [401, 403]],
    ['/api/employees/stats', [200], [403], [401, 403]],
    ['/api/employees/directory', [200], [200], [401, 403]],
    ['/api/employees/celebrations', [200], [200], [401, 403]],
    ['/api/employees/me', [200], [200], [401, 403]],
    ['/api/employees/team', [200], [200, 403], [401, 403]],
    ['/api/employees/' + EID + '/documents', [200], [200], [401, 403]],
    ['/api/attendance/today', [200, 400], [200], [401, 403]],
    ['/api/attendance/my?month=' + M, [200, 400], [200], [401, 403]],
    ['/api/attendance/day?date=' + today, [200], [403], [401, 403]],
    ['/api/attendance/insights?month=' + M, [200], [403], [401, 403]],
    ['/api/attendance/corrections', [200], [401, 403], [401, 403]],
    ['/api/attendance/corrections/my', [200, 400], [200], [401, 403]],
    ['/api/leave', [200], [401, 403], [401, 403]],
    ['/api/leave/types', [200], [200], [401, 403]],
    ['/api/leave/balance', [200, 400], [200], [401, 403]],
    ['/api/leave/my', [200, 400], [200], [401, 403]],
    ['/api/leave/calendar?month=' + M, [200], [401, 403], [401, 403]],
    ['/api/leave/ledger', [200], [200], [401, 403]],
    ['/api/leave/compoff', [200], [401, 403], [401, 403]],
    ['/api/reimbursement', [200], [401, 403], [401, 403]],
    ['/api/reimbursement/my', [200, 400], [200], [401, 403]],
    ['/api/payroll?month=' + M, [200], [401, 403], [401, 403]],
    ['/api/payroll/my', [200, 400], [200], [401, 403]],
    ['/api/loans', [200], [401, 403], [401, 403]],
    ['/api/assets', [200], [200, 401, 403], [401, 403]],
    ['/api/assets/mine', [200, 400], [200], [401, 403]],
    ['/api/inventory', [200], [200, 401, 403], [401, 403]],
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
    ['/api/settings', [200], [401, 403], [401, 403]],
    ['/api/settings/access', [200], [401, 403], [401, 403]],
    ['/api/settings/public', [200], [200], [200]],
    ['/api/automation/status', [200], [401, 403], [401, 403]],
    ['/api/birthdays/today', [200], [401, 403], [401, 403]],
    ['/api/ai/status', [200], [200], [401, 403]],
    ['/api/ai/recommendations?type=leave', [200], [401, 403], [401, 403]],
    ['/api/health', [200], [200], [200]],
    ['/api/careers/jobs', [200], [200], [200]],
  ];
  const getPaths = [];
  for (const [path, a, e, n] of matrix) {
    add('ACCESS admin ' + path, 'admin', 'GET', path, a);
    add('ACCESS emp ' + path, 'emp', 'GET', path, e);
    add('ACCESS anon ' + path, 'anon', 'GET', path, n);
    // HEAD + OPTIONS should never 500
    add('ACCESS head ' + path, 'admin', 'HEAD', path.split('?')[0], [200, 204, 400, 401, 403, 404]);
    add('ACCESS opts ' + path, 'admin', 'OPTIONS', path.split('?')[0], [200, 204, 400, 401, 403, 404]);
    // capture which roles can READ this endpoint, for role-aware injection below
    const roles = [];
    if (a.includes(200)) roles.push('admin');
    if (e.includes(200)) roles.push('emp');
    if (n.includes(200)) roles.push('anon');
    getPaths.push({ base: path.split('?')[0], roles: roles.length ? roles : ['admin'] });
  }

  // ===== B. METHOD probes =====
  const methodTargets = ['/api/leave', '/api/employees', '/api/reimbursement', '/api/timesheets/projects',
    '/api/announcements', '/api/holidays', '/api/surveys', '/api/recruitment/jobs', '/api/goals', '/api/kudos',
    '/api/tickets', '/api/assets', '/api/onboarding', '/api/offboarding', '/api/notifications'];
  for (const p of methodTargets) for (const m of ['PATCH', 'DELETE', 'PUT']) { // (TRACE not sendable by undici)
    add(`METHOD ${m} ${p}`, 'admin', m, p, [400, 401, 403, 404, 405]);
  }

  // ===== C. ID FUZZ (bad ids must never 500/crash) =====
  const idRoutes = [
    ['GET', (id) => `/api/employees/${id}`, ['admin', 'emp']],
    ['GET', (id) => `/api/employees/${id}/documents`, ['admin', 'emp']],
    ['GET', (id) => `/api/goals/${id}`, ['admin', 'emp']],
    ['GET', (id) => `/api/reviews/${id}`, ['admin', 'emp']],
    ['GET', (id) => `/api/onboarding/${id}`, ['admin']],
    ['GET', (id) => `/api/offboarding/${id}`, ['admin']],
    ['GET', (id) => `/api/recruitment/applicants/${id}/resume`, ['admin']],
    ['POST', (id) => `/api/leave/${id}/decision`, ['admin', 'emp']],
    ['POST', (id) => `/api/reimbursement/${id}/decision`, ['admin', 'emp']],
    ['DELETE', (id) => `/api/employees/${id}`, ['admin', 'emp']],
    ['DELETE', (id) => `/api/recruitment/jobs/${id}`, ['admin', 'emp']],
    ['PUT', (id) => `/api/goals/${id}`, ['emp']],
    ['DELETE', (id) => `/api/goals/${id}`, ['emp']],
    ['POST', (id) => `/api/onboarding/${id}/sync`, ['admin']],
    ['GET', (id) => `/api/payroll/${id}`, ['admin']],
  ];
  // A purely-numeric but non-existent id (e.g. 999999) may legitimately return
  // 200 (empty list / idempotent delete); non-numeric/0/negative must be 4xx.
  const numericId = (id) => /^[1-9][0-9]*$/.test(id);
  for (const [m, make, roles] of idRoutes) {
    for (const id of BAD_IDS) {
      for (const role of roles) {
        const p = make(encodeURIComponent(id));
        const body = p.includes('/decision') ? { decision: 'approved' } : undefined;
        const exp = numericId(id) ? [200, 400, 401, 403, 404, 405] : [400, 401, 403, 404, 405];
        add(`ID ${role} ${m} ${make(id)}`, role, m, p, exp, body);
      }
    }
  }

  // ===== D. INJECTION (path & query) — must be neutralised, never 500 =====
  const payloads = [...SQLI, ...XSS];
  // Fire every injection payload at the ?q= of every accessible read endpoint,
  // from EACH role that can read it (distinct auth contexts).
  for (const { base, roles } of getPaths) {
    for (const role of roles) {
      for (const s of payloads) {
        add(`INJ ${role} ${base} ${s.slice(0, 8)}`, role, 'GET', `${base}?q=${encodeURIComponent(s)}&search=${encodeURIComponent(s)}&name=${encodeURIComponent(s)}`, [200, 400, 401, 403, 404]);
      }
    }
  }
  // injection as path segment on id routes
  for (const s of [...SQLI, ...TRAVERSAL]) {
    add(`INJ path employees ${s.slice(0, 8)}`, 'admin', 'GET', `/api/employees/${encodeURIComponent(s)}`, [400, 403, 404]);
    add(`INJ path goals ${s.slice(0, 8)}`, 'emp', 'GET', `/api/goals/${encodeURIComponent(s)}`, [400, 403, 404]);
    add(`INJ path leave-dec ${s.slice(0, 8)}`, 'admin', 'POST', `/api/leave/${encodeURIComponent(s)}/decision`, [400, 403, 404], { decision: 'approved' });
  }
  // traversal on uploads
  for (const t of TRAVERSAL) {
    add(`INJ traversal anon ${t.slice(0, 10)}`, 'anon', 'GET', `/uploads/${t}`, [400, 403, 404]);
    add(`INJ traversal admin ${t.slice(0, 10)}`, 'admin', 'GET', `/uploads/${t}`, [400, 403, 404]);
  }
  // SQLi in login
  for (const s of SQLI) add(`INJ login ${s.slice(0, 10)}`, 'anon', 'POST', '/api/auth/login', [400, 401], { email: s, password: s });

  // ===== E. QUERY-PARAM FUZZ =====
  const monthEndpoints = [['/api/reports/attendance', 'admin'], ['/api/reports/payroll', 'admin'],
    ['/api/attendance/my', 'emp'], ['/api/attendance/insights', 'admin'], ['/api/payroll', 'admin'],
    ['/api/leave/calendar', 'admin']];
  for (const [ep, role] of monthEndpoints) for (const v of BAD_MONTHS) {
    add(`QP ${ep}?month=${v}`, role, 'GET', `${ep}?month=${encodeURIComponent(v)}`, [200, 400, 404]);
  }
  for (const v of BAD_DATES) add(`QP day?date=${v}`, 'admin', 'GET', `/api/attendance/day?date=${encodeURIComponent(v)}`, [200, 400, 404]);
  for (const v of ['abc', '-1', '0', '99999', '20.26', '', "2026'--", 'NaN', '1e9']) add(`QP holidays?year=${v}`, 'admin', 'GET', `/api/holidays?year=${encodeURIComponent(v)}`, [200, 400, 404]);
  const limitEndpoints = [['/api/employees', 'admin'], ['/api/leave', 'admin'], ['/api/announcements', 'emp'],
    ['/api/notifications', 'emp'], ['/api/reimbursement', 'admin'], ['/api/tickets', 'admin']];
  for (const [ep, role] of limitEndpoints) for (const v of BAD_LIMITS) {
    add(`QP ${ep}?limit=${v}`, role, 'GET', `${ep}?limit=${encodeURIComponent(v)}&offset=${encodeURIComponent(v)}`, [200, 400, 404]);
  }
  // recommendations type fuzz
  for (const t of ['leave', 'reimbursement', 'zzz', '', '123', "x'--", '<script>']) {
    add(`QP ai/recos?type=${t}`, 'admin', 'GET', `/api/ai/recommendations?type=${encodeURIComponent(t)}`, [200, 400]);
  }

  // ===== F. LEAVE invalid matrix (employee) — every case must 400 (no data) =====
  // (1) bad-date cross product (from × to) — guaranteed invalid
  for (const f of BAD_DATES) for (const t of BAD_DATES) {
    add(`LEAVE bad ${f}|${t}`, 'emp', 'POST', '/api/leave', [400], { type: 'casual', from_date: f, to_date: t, reason: 'fuzz' });
  }
  // (2) valid type × bad-from (valid to) — tests from-validation, still rejected
  for (const bd of BAD_DATES) add(`LEAVE from=${bd}`, 'emp', 'POST', '/api/leave', [400], { type: 'casual', from_date: bd, to_date: plus(5), reason: 'fuzz' });
  // (3) invalid leave types (with a valid future range → rejected by type check, no data)
  for (const t of ['CASUAL', 'casual ', 'maternity', 'paternity', 'zzz', '', '123', 'sick;drop', 'earned', 'comp', 'null', 'undefined']) {
    if (VALID_TYPES.includes(t)) continue;
    add(`LEAVE type=${t}`, 'emp', 'POST', '/api/leave', [400], { type: t, from_date: plus(5), to_date: plus(5), reason: 'fuzz' });
  }
  // (4) past / too-far / bad-order offsets — all rejected
  for (const off of [-400, -90, -30, -7, -2, -1]) add(`LEAVE past ${off}d`, 'emp', 'POST', '/api/leave', [400], { type: 'casual', from_date: plus(off), to_date: plus(off), reason: 'fuzz' });
  for (const off of [366, 400, 730]) add(`LEAVE far ${off}d`, 'emp', 'POST', '/api/leave', [400], { type: 'casual', from_date: plus(off), to_date: plus(off), reason: 'fuzz' });
  for (const [f, t] of [[5, 3], [10, 2], [30, 1], [2, 70], [2, 90]]) add(`LEAVE order ${f}->${t}`, 'emp', 'POST', '/api/leave', [400], { type: 'casual', from_date: plus(f), to_date: plus(t), reason: 'fuzz' });
  add('LEAVE half multi', 'emp', 'POST', '/api/leave', [400], { type: 'casual', from_date: plus(3), to_date: plus(5), half_day: 1, reason: 'fuzz' });
  add('LEAVE missing type', 'emp', 'POST', '/api/leave', [400], { from_date: plus(3), to_date: plus(3) });
  add('LEAVE empty', 'emp', 'POST', '/api/leave', [400], {});
  // (5) injection in date fields — rejected by format check
  for (const s of [...SQLI, ...XSS]) add(`LEAVE inj date ${s.slice(0, 8)}`, 'emp', 'POST', '/api/leave', [400], { type: 'casual', from_date: s, to_date: s });

  // ===== G. TIMESHEET invalid matrix — emit ONLY invalid combos (no data) =====
  const tsDates = [-60, -40, -31, -7, -1, 0, 1, 2, 30];
  const tsHours = [-5, -1, 0, 0.5, 4, 8, 12, 24, 24.5, 25, 100];
  for (const dOff of tsDates) for (const h of tsHours) {
    const badDate = dOff > 0 || dOff < -30;
    const badHours = h <= 0 || h > 24;
    if (!badDate && !badHours) continue; // skip valid combos so nothing is created
    add(`TS d${dOff} h${h}`, 'emp', 'POST', '/api/timesheets/entry', [400], { date: plus(dOff), hours: h, task: 'fuzz' });
  }
  for (const bd of BAD_DATES) add(`TS bad date ${bd}`, 'emp', 'POST', '/api/timesheets/entry', [400], { date: bd, hours: 4 });
  for (const bh of BAD_NUMS) add(`TS bad hours ${bh}`, 'emp', 'POST', '/api/timesheets/entry', [400], { date: today, hours: bh });

  // ===== H. FIELD validation (invalid only) =====
  // empty target_date is "no date" (optional) → allowed; other garbage → 400
  for (const bd of BAD_DATES) add(`GOAL bad date ${bd}`, 'emp', 'POST', '/api/goals', bd === '' ? [200, 400] : [400], { title: 'x', target_date: bd });
  add('GOAL past', 'emp', 'POST', '/api/goals', [400], { title: 'x', target_date: plus(-10) });
  add('GOAL missing title', 'emp', 'POST', '/api/goals', [400], { target_date: plus(10) });
  for (const n of BAD_NUMS) add(`REIMB amount ${n}`, 'emp', 'POST', '/api/reimbursement', [400], { title: 'x', amount: n });
  add('REIMB missing amount', 'emp', 'POST', '/api/reimbursement', [400], { title: 'x' });
  add('REIMB missing title', 'emp', 'POST', '/api/reimbursement', [400], { amount: 100 });
  // 3.5 coerces to 3 (acceptable); the rest are clearly invalid
  for (const s of [0, 6, -1, 99, 'x', '', 'NaN', 10, 3.5]) add(`MOOD score ${s}`, 'emp', 'POST', '/api/mood/checkin', s === 3.5 ? [200, 400] : [400], { score: s });
  add('KUDOS no msg', 'emp', 'POST', '/api/kudos', [400], { employee_id: EID });
  add('KUDOS no target', 'emp', 'POST', '/api/kudos', [400], { message: 'great' });
  add('TICKET no subject', 'emp', 'POST', '/api/tickets', [400], { category: 'it' });

  // ===== I. ESCALATION (emp/anon hitting admin writes → 4xx, no data) =====
  const escalations = [
    ['POST', '/api/employees', { name: 'Hacker', email: 'h@x.co' }],
    ['POST', '/api/announcements', { title: 'x', body: 'y' }],
    ['POST', '/api/holidays', { date: plus(30), name: 'X' }],
    ['PUT', '/api/settings', { companyName: 'Hax' }],
    ['PUT', '/api/settings/access', { rolePermissions: {} }],
    ['POST', '/api/payroll/generate', { month: M }],
    ['POST', '/api/surveys', { title: 'x', questions: '[]' }],
    ['POST', '/api/recruitment/jobs', { title: 'X' }],
    ['POST', '/api/offboarding', { employee_id: 1 }],
    ['POST', '/api/timesheets/projects', { name: 'X' }],
    ['POST', '/api/leave/compoff', { employee_id: EID, days: 1 }],
    ['POST', '/api/leave/accrual/run', {}],
    ['POST', '/api/automation/run', {}],
    ['POST', '/api/birthdays/send', {}],
    ['POST', '/api/ai/screen/1', {}],
    ['POST', '/api/timesheets/decision', { ids: [1], decision: 'approved' }],
    ['GET', '/api/reports/overview', null],
    ['GET', '/api/settings', null],
    ['GET', '/api/attendance/corrections', null],
    ['GET', '/api/mood/dashboard', null],
  ];
  for (const [m, p, b] of escalations) {
    add(`ESC emp ${m} ${p}`, 'emp', m, p, [401, 403, 404], b);
    add(`ESC anon ${m} ${p}`, 'anon', m, p, [401, 403, 404], b);
  }

  // ===== J. AI-action fuzz (invalid → no data) =====
  for (const t of ['CASUAL', 'maternity', 'zzz', '', '123', 'null']) {
    if (VALID_TYPES.includes(t)) continue;
    add(`AI leave type ${t}`, 'emp', 'POST', '/api/ai/act', [400], { name: 'apply_leave', params: { type: t, from_date: plus(8), to_date: plus(8) } });
  }
  for (const off of [-30, -1, 400]) add(`AI leave ${off}d`, 'emp', 'POST', '/api/ai/act', [400], { name: 'apply_leave', params: { type: 'casual', from_date: plus(off), to_date: plus(off) } });
  for (const bd of BAD_DATES) add(`AI leave date ${bd}`, 'emp', 'POST', '/api/ai/act', [400], { name: 'apply_leave', params: { type: 'casual', from_date: bd, to_date: bd } });
  add('AI unknown action', 'emp', 'POST', '/api/ai/act', [400], { name: 'nuke_db', params: {} });
  add('AI no name', 'emp', 'POST', '/api/ai/act', [400], { params: {} });
  add('AI chat empty', 'emp', 'POST', '/api/ai/chat', [400], {});
  add('AI draft empty', 'admin', 'POST', '/api/ai/draft', [400], { kind: 'announcement', brief: '' });
  // AI apply_leave bad-date cross product (mirrors the leave route; all invalid)
  for (const f of BAD_DATES) for (const t of BAD_DATES) {
    add(`AI leave ${f}|${t}`, 'emp', 'POST', '/api/ai/act', [400], { name: 'apply_leave', params: { type: 'casual', from_date: f, to_date: t } });
  }

  // ===== N. ID fuzz from anon (must 401/403/404 before id ever reaches DB) =====
  for (const [m, make, roles] of idRoutes) {
    for (const id of BAD_IDS) {
      const p = make(encodeURIComponent(id));
      const body = p.includes('/decision') ? { decision: 'approved' } : undefined;
      add(`IDANON ${m} ${make(id)}`, 'anon', m, p, [400, 401, 403, 404, 405], body);
    }
  }

  // ===== K. CAREERS fuzz (public) =====
  add('CAREERS jobs', 'anon', 'GET', '/api/careers/jobs', [200], null, (r) => Array.isArray(r.j.jobs));
  for (const id of BAD_IDS) add(`CAREERS job ${id}`, 'anon', 'POST', `/api/careers/apply/${encodeURIComponent(id)}`, [400, 404, 429], { name: 'A', email: 'a@b.co' });
  for (const e of ['', 'notanemail', 'a@', '@b.co', 'a b@c.co', 'a@b', 'x'.repeat(200) + '@y.co', '<script>@x.co']) {
    add(`CAREERS email ${e.slice(0, 10)}`, 'anon', 'POST', '/api/careers/apply/999999', [400, 404, 429], { name: 'A', email: e });
  }

  // ===== L. MALFORMED JSON body → 400, never 500 =====
  const jsonTargets = ['/api/leave', '/api/reimbursement', '/api/goals', '/api/kudos', '/api/tickets',
    '/api/mood/checkin', '/api/timesheets/entry', '/api/ai/act', '/api/ai/chat', '/api/employees',
    '/api/announcements', '/api/surveys', '/api/holidays', '/api/recruitment/jobs'];
  for (const p of jsonTargets) {
    add(`BODY broken-json ${p}`, 'admin', 'POST', p, [400, 401, 403, 404], undefined, null, '{bad json,,');
    add(`BODY array-not-obj ${p}`, 'admin', 'POST', p, [400, 401, 403, 404], undefined, null, '[1,2,3]');
    add(`BODY null ${p}`, 'admin', 'POST', p, [400, 401, 403, 404], undefined, null, 'null');
  }

  // ===== M. AUTH + PAGES + 404 =====
  add('AUTH wrong pass', 'anon', 'POST', '/api/auth/login', [400, 401], { email: 'admin@company.local', password: 'wrong' });
  add('AUTH unknown user', 'anon', 'POST', '/api/auth/login', [400, 401], { email: 'ghost@nowhere.io', password: 'x' });
  add('AUTH empty', 'anon', 'POST', '/api/auth/login', [400, 401], {});
  add('AUTH no-pass', 'anon', 'POST', '/api/auth/login', [400, 401], { email: 'admin@company.local' });
  add('PAGE /', 'anon', 'GET', '/', [200]);
  add('PAGE /careers', 'anon', 'GET', '/careers', [200]);
  add('PAGE /preboard', 'anon', 'GET', '/preboard/anytoken', [200]);
  add('PAGE api 404', 'anon', 'GET', '/api/nope-nope', [404]);
  add('PAGE api 404b', 'admin', 'GET', '/api/employees/nonsense/extra/path', [400, 404]);

  return cases.length;
}

async function call(c) {
  const cookie = c.role === 'admin' ? ADMIN : c.role === 'emp' ? EMP : '';
  const opts = { method: c.method, headers: { cookie } };
  if (c.raw !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = c.raw; }
  else if (c.body !== undefined && c.body !== null) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(c.body); }
  const r = await fetch(BASE + c.path, opts);
  let j = null; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
}

async function runPool(items, worker, conc) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() { while (idx < items.length) { const i = idx++; results[i] = await worker(items[i]); } }
  await Promise.all(Array.from({ length: conc }, next));
  return results;
}

(async () => {
  const la = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@company.local', password: 'ChangeMe@12345' }) });
  ADMIN = (la.headers.get('set-cookie') || '').split(';')[0];
  const le = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'employee@company.local', password: 'employee123' }) });
  EMP = (le.headers.get('set-cookie') || '').split(';')[0];
  EID = ((await le.json()).user || {}).employeeId || 38;
  if (!ADMIN || !EMP) { console.error('login failed — is the server up at ' + BASE + '?'); process.exit(1); }
  // derive the real valid leave types so type-fuzz expectations stay accurate
  try { const t = await (await fetch(BASE + '/api/leave/types', { headers: { cookie: EMP } })).json(); if (t.types) VALID_TYPES = t.types.map((x) => x.code); } catch (e) {}

  const total = buildCases();
  console.log(`Generated ${total} cases. Valid leave types: [${VALID_TYPES}]. Running conc=${CONC} vs ${BASE}…`);

  const t0 = Date.now();
  const out = await runPool(cases, async (c) => {
    try {
      const r = await call(c);
      const ok = c.expect.includes(r.s) && (c.pred ? c.pred(r) : true) && r.s !== 500;
      return { name: c.name, ok, got: r.s, expect: c.expect.join('/'), err: (!ok && r.j) ? String(r.j.error || '').slice(0, 55) : '', crash: r.s === 500 };
    } catch (e) {
      return { name: c.name, ok: false, got: 'ERR', expect: c.expect.join('/'), err: e.message.slice(0, 55), crash: true };
    }
  }, CONC);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  const fails = out.filter((r) => !r.ok);
  const crashes = out.filter((r) => r.crash);
  const byCat = {};
  for (const r of out) { const cat = r.name.split(' ')[0]; (byCat[cat] = byCat[cat] || { n: 0, f: 0 }).n++; if (!r.ok) byCat[cat].f++; }
  console.log('\n===================== MEGA SUITE =====================');
  for (const [k, v] of Object.entries(byCat)) console.log(`  ${k.padEnd(8)} ${v.f}/${v.n}` + (v.f ? '  ⚠' : ''));
  if (crashes.length) console.log(`\n⚠ 500/ERROR responses: ${crashes.length} (these are server-side faults)`);
  if (fails.length) { console.log('\n--- FAILURES (first 70) ---'); for (const f of fails.slice(0, 70)) console.log(`FAIL ${f.name.padEnd(40)} got ${f.got} want ${f.expect}${f.err ? '  ' + f.err : ''}`); }
  console.log('=====================================================');
  console.log(`TOTAL ${out.length} | PASS ${out.length - fails.length} | FAIL ${fails.length} | 500s ${crashes.length} | ${secs}s`);
  process.exit(fails.length ? 1 : 0);
})();
