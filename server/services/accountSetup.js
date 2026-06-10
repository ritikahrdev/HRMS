const db = require('./../db');
const { notifyUsers } = require('./notify');
const { getSettings } = require('./settings');
const { can } = require('./permissions');

// Case-insensitive lookup of the account list configured for a department,
// falling back to the "default" list for any unlisted department.
function accountsForDepartment(department) {
  const map = getSettings().departmentAccounts || {};
  const dept = (department || '').trim();
  if (dept) {
    const key = Object.keys(map).find(
      (k) => k.toLowerCase() !== 'default' && k.toLowerCase() === dept.toLowerCase()
    );
    if (key && Array.isArray(map[key]) && map[key].length) return map[key];
  }
  return Array.isArray(map.default) ? map.default : [];
}

// Users who are allowed to create employee accounts (HR / IT / admins).
// Resolved by permission so it respects any custom role overrides.
function accountCreatorUserIds() {
  return db
    .prepare('SELECT id, role FROM users')
    .all()
    .filter((u) => can(u.role, 'employees:write'))
    .map((u) => u.id);
}

// The login (user id) of an employee's manager, via manager_id → user_id.
function managerUserId(employee) {
  if (!employee || !employee.manager_id) return null;
  const mgr = db.prepare('SELECT user_id FROM employees WHERE id = ?').get(employee.manager_id);
  return mgr && mgr.user_id ? mgr.user_id : null;
}

// Notify the managers / account creators to set up the accounts a new hire's
// department requires, and add matching "Create account: X" onboarding tasks.
// Idempotent: re-running won't duplicate tasks, and it always re-sends the
// notification (so HR can nudge again). Returns a summary.
function provisionAccountsForOnboarding(employeeId, actorUserId) {
  const emp = db
    .prepare('SELECT id, name, department, manager_id, user_id FROM employees WHERE id = ?')
    .get(employeeId);
  if (!emp) return { ok: false, error: 'Employee not found' };

  const accounts = accountsForDepartment(emp.department);
  const dept = (emp.department || '').trim() || 'General';

  // 1) Add an onboarding task per required account (skip ones already present).
  const existing = new Set(
    db.prepare('SELECT lower(title) t FROM onboarding_tasks WHERE employee_id = ?')
      .all(emp.id)
      .map((r) => r.t)
  );
  let pos = db.prepare('SELECT COALESCE(MAX(position),0) m FROM onboarding_tasks WHERE employee_id = ?').get(emp.id).m;
  const ins = db.prepare("INSERT INTO onboarding_tasks (employee_id, title, position, stage, owner) VALUES (?, ?, ?, 'Pre-boarding', 'it')");
  let tasksAdded = 0;
  for (const acc of accounts) {
    const title = `Create account: ${acc}`;
    if (existing.has(title.toLowerCase())) continue;
    ins.run(emp.id, title, ++pos);
    tasksAdded++;
  }

  // 2) Notify the manager + account creators (deduped; never the new hire,
  //    and not the person who triggered it).
  const recipients = new Set();
  const mu = managerUserId(emp);
  if (mu) recipients.add(mu);
  for (const id of accountCreatorUserIds()) recipients.add(id);
  if (emp.user_id) recipients.delete(emp.user_id);
  if (actorUserId) recipients.delete(actorUserId);

  const list = accounts.length ? accounts.join(', ') : 'No accounts are configured for this department yet';
  notifyUsers([...recipients], {
    type: 'onboarding',
    title: `Set up accounts for new hire: ${emp.name}`,
    body: `${emp.name} has joined ${dept}. Please create the required accounts: ${list}.`,
    link: '#/employees',
  });

  return { ok: true, employee: emp.name, department: dept, accounts, tasksAdded, notified: recipients.size };
}

module.exports = { provisionAccountsForOnboarding, accountsForDepartment };
