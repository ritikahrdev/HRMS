const db = require('./../db');
const { notifyUsers } = require('./notify');
const { getSettings } = require('./settings');
const { can } = require('./permissions');

// ---------------------------------------------------------------------------
// The onboarding "journey": stage-based tasks modelled on what leading HRMS
// platforms run. Each task has an owner role, a due date (offset in days from
// the joining date), and an optional auto-key. Auto-keyed tasks tick themselves
// off when the matching real event happens in the system — no manual action.
// ---------------------------------------------------------------------------
const OWNERS = {
  employee: { label: 'New hire', icon: '👤' },
  hr:       { label: 'HR',       icon: '🧑‍💼' },
  it:       { label: 'IT',       icon: '💻' },
  manager:  { label: 'Manager',  icon: '👔' },
};

const STAGES = ['Pre-boarding', 'Day 1', 'Week 1', 'First 30 Days'];

// auto keys: account_created | form_submitted | docs_uploaded | docs_verified
//            | password_set | first_attendance   (null = manual tick)
const JOURNEY = [
  { stage: 'Pre-boarding', tasks: [
    { title: 'Welcome email & login credentials sent', owner: 'hr',       offset: -3, auto: 'account_created' },
    { title: 'Fill joining form & personal details',   owner: 'employee', offset: -2, auto: 'form_submitted' },
    { title: 'Upload required documents',              owner: 'employee', offset: -2, auto: 'docs_uploaded' },
    { title: 'Create department system accounts',      owner: 'it',       offset: -1, auto: null },
    { title: 'Assign reporting manager & buddy',       owner: 'hr',       offset: -1, auto: null },
    { title: 'Share offer letter, policies & welcome kit', owner: 'hr',   offset: -1, auto: null },
  ] },
  { stage: 'Day 1', tasks: [
    { title: 'Set a personal password (first login)',  owner: 'employee', offset: 0, auto: 'password_set' },
    { title: 'Mark first attendance',                  owner: 'employee', offset: 0, auto: 'first_attendance' },
    { title: 'Verify submitted IDs & documents',       owner: 'hr',       offset: 0, auto: 'docs_verified' },
    { title: 'Team introduction & workplace tour',     owner: 'manager',  offset: 0, auto: null },
    { title: 'Hand over laptop / workstation',         owner: 'it',       offset: 0, auto: null },
  ] },
  { stage: 'Week 1', tasks: [
    { title: 'Read employee handbook',                 owner: 'employee', offset: 5, auto: null },
    { title: 'Acknowledge code of conduct & policies', owner: 'employee', offset: 7, auto: null },
    { title: 'Add to payroll',                         owner: 'hr',       offset: 7, auto: null },
    { title: 'Set 30-60-90 day goals',                 owner: 'manager',  offset: 7, auto: null },
  ] },
  { stage: 'First 30 Days', tasks: [
    { title: '30-day manager check-in',                owner: 'manager',  offset: 30, auto: null },
    { title: 'Confirm probation & confirmation plan',  owner: 'hr',       offset: 30, auto: null },
    { title: 'Complete onboarding feedback survey',    owner: 'employee', offset: 30, auto: null },
  ] },
];

function addDays(isoDate, days) {
  if (!isoDate) return null;
  const d = new Date(String(isoDate).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Instantiate the full journey for an employee. Skips if a checklist already
// exists (use rebuildJourney to force). Returns the number of tasks added.
async function buildJourney(employeeId) {
  const existing = (await db.prepare('SELECT COUNT(*) c FROM onboarding_tasks WHERE employee_id = ?').get(employeeId)).c;
  if (existing) return 0;
  const emp = await db.prepare('SELECT date_of_joining FROM employees WHERE id = ?').get(employeeId);
  const doj = emp ? emp.date_of_joining : null;
  const ins = db.prepare(`INSERT INTO onboarding_tasks
    (employee_id, title, position, stage, owner, due_date, auto_key) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let pos = 0;
  for (const s of JOURNEY) {
    for (const t of s.tasks) {
      await ins.run(employeeId, t.title, ++pos, s.stage, t.owner, addDays(doj, t.offset), t.auto || null);
    }
  }
  return pos;
}

async function rebuildJourney(employeeId) {
  await db.prepare('DELETE FROM onboarding_tasks WHERE employee_id = ?').run(employeeId);
  return buildJourney(employeeId);
}

// Evaluate the live system state for an employee's auto-keys.
async function autoState(employeeId) {
  const emp = await db.prepare('SELECT id, user_id, onboarding_submitted FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return {};
  const user = emp.user_id ? await db.prepare('SELECT must_change FROM users WHERE id = ?').get(emp.user_id) : null;
  const required = getSettings().requiredDocs || [];
  const docs = await db.prepare('SELECT doc_type, status FROM employee_documents WHERE employee_id = ?').all(employeeId);
  const haveType = new Set(docs.filter((d) => d.doc_type).map((d) => d.doc_type));
  const verifiedType = new Set(docs.filter((d) => d.doc_type && d.status === 'verified').map((d) => d.doc_type));
  const docsUploaded = required.length > 0 && required.every((t) => haveType.has(t));
  const docsVerified = required.length > 0 && required.every((t) => verifiedType.has(t));
  const firstAttendance = await db.prepare('SELECT 1 FROM attendance WHERE employee_id = ? LIMIT 1').get(employeeId);
  return {
    account_created: !!emp.user_id,
    form_submitted: !!emp.onboarding_submitted,
    docs_uploaded: docsUploaded,
    docs_verified: docsVerified,
    password_set: !!(user && user.must_change === 0),
    first_attendance: !!firstAttendance,
  };
}

// Auto-complete any auto-keyed tasks whose condition is now satisfied. When the
// whole journey is complete, mark the employee onboarded automatically.
// Returns { autoCompleted, justOnboarded }.
async function syncAutomatedTasks(employeeId) {
  const tasks = await db.prepare('SELECT id, auto_key, done FROM onboarding_tasks WHERE employee_id = ? AND auto_key IS NOT NULL AND done = 0').all(employeeId);
  let autoCompleted = 0;
  if (tasks.length) {
    const state = await autoState(employeeId);
    const mark = db.prepare("UPDATE onboarding_tasks SET done = 1, done_at = datetime('now'), done_by = 'system' WHERE id = ?");
    for (const t of tasks) {
      if (state[t.auto_key]) { await mark.run(t.id); autoCompleted++; }
    }
  }

  // Auto-finish onboarding once every task is done.
  let justOnboarded = false;
  const counts = await db.prepare('SELECT COUNT(*) total, SUM(done) done FROM onboarding_tasks WHERE employee_id = ?').get(employeeId);
  if (counts.total > 0 && counts.done === counts.total) {
    const emp = await db.prepare('SELECT name, onboarded FROM employees WHERE id = ?').get(employeeId);
    if (emp && !emp.onboarded) {
      await db.prepare("UPDATE employees SET onboarded = 1, onboarded_at = datetime('now') WHERE id = ?").run(employeeId);
      justOnboarded = true;
      await notifyUsers(await staffAndManager(employeeId, null), {
        type: 'onboarding',
        title: `Onboarding complete: ${emp.name}`,
        body: `${emp.name} has finished every onboarding step. They're fully onboarded. 🎉`,
        link: '#/onboarding',
      });
    }
  }
  return { autoCompleted, justOnboarded };
}

// Resolve the user ids for a task owner role.
async function ownerUserIds(employeeId, owner) {
  if (owner === 'employee') {
    const e = await db.prepare('SELECT user_id FROM employees WHERE id = ?').get(employeeId);
    return e && e.user_id ? [e.user_id] : [];
  }
  if (owner === 'manager') {
    const e = await db.prepare('SELECT manager_id FROM employees WHERE id = ?').get(employeeId);
    if (!e || !e.manager_id) return [];
    const m = await db.prepare('SELECT user_id FROM employees WHERE id = ?').get(e.manager_id);
    return m && m.user_id ? [m.user_id] : [];
  }
  // hr / it -> everyone who can manage employees.
  return (await db.prepare('SELECT id, role FROM users').all()).filter((u) => can(u.role, 'employees:write')).map((u) => u.id);
}

async function staffAndManager(employeeId, exceptUserId) {
  const ids = new Set(await ownerUserIds(employeeId, 'hr'));
  for (const id of await ownerUserIds(employeeId, 'manager')) ids.add(id);
  if (exceptUserId) ids.delete(exceptUserId);
  return [...ids];
}

// Send each owner a reminder of their still-pending onboarding tasks.
async function sendReminders(employeeId, actorUserId) {
  const emp = await db.prepare('SELECT name FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return { notified: 0, pending: 0 };
  const pending = await db.prepare('SELECT title, owner, due_date FROM onboarding_tasks WHERE employee_id = ? AND done = 0 ORDER BY position').all(employeeId);
  if (!pending.length) return { notified: 0, pending: 0 };
  const byOwner = {};
  for (const t of pending) (byOwner[t.owner || 'hr'] = byOwner[t.owner || 'hr'] || []).push(t);
  const notified = new Set();
  for (const owner of Object.keys(byOwner)) {
    const list = byOwner[owner].map((t) => '• ' + t.title).join('\n');
    const recipients = (await ownerUserIds(employeeId, owner)).filter((id) => id !== actorUserId);
    await notifyUsers(recipients, {
      type: 'onboarding',
      title: `Onboarding pending for ${emp.name}`,
      body: `You have ${byOwner[owner].length} pending onboarding task(s) for ${emp.name}:\n${list}`,
      link: '#/onboarding',
    });
    recipients.forEach((id) => notified.add(id));
  }
  return { notified: notified.size, pending: pending.length };
}

module.exports = {
  OWNERS, STAGES, JOURNEY,
  buildJourney, rebuildJourney, syncAutomatedTasks, sendReminders, ownerUserIds,
};
