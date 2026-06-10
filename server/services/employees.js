const bcrypt = require('bcryptjs');
const db = require('../db');
const { ROLES } = require('./permissions');

const FIELDS = [
  'emp_code', 'name', 'email', 'phone', 'department', 'designation',
  'date_of_joining', 'monthly_salary', 'manager', 'manager_id', 'bank_account',
  'ifsc', 'pan', 'address', 'status',
  // Core HR extended profile
  'dob', 'gender', 'emergency_name', 'emergency_phone', 'aadhaar',
  'education', 'experience', 'blood_group', 'slack_id',
  // Extra joining details (also collected via the pre-boarding / self-service form)
  'personal_email', 'marital_status', 'nationality', 'languages_known',
  'current_address', 'permanent_address', 'bank_holder_name', 'bank_name',
];

// Fields a new hire / candidate may fill in themselves (self-service form and
// the pre-boarding link). Excludes salary, role, department, manager, status.
const SELF_ONBOARDING_FIELDS = [
  'phone', 'personal_email', 'dob', 'gender', 'blood_group', 'marital_status',
  'nationality', 'languages_known', 'emergency_name', 'emergency_phone',
  'address', 'current_address', 'permanent_address',
  'bank_holder_name', 'bank_name', 'bank_account', 'ifsc', 'pan', 'aadhaar',
  'education', 'experience',
];

// Every field shown on the onboarding / pre-boarding forms — all mandatory
// before the new hire can submit. (Matches the fields rendered on both forms.)
const ONBOARDING_REQUIRED_FIELDS = [
  'phone', 'personal_email', 'dob', 'gender', 'blood_group', 'marital_status',
  'nationality', 'languages_known', 'current_address', 'permanent_address',
  'emergency_name', 'emergency_phone', 'bank_holder_name', 'bank_name',
  'bank_account', 'ifsc', 'pan', 'aadhaar', 'education', 'experience',
];

function normaliseRole(role) {
  const r = String(role || '').toUpperCase().replace(/[\s-]+/g, '_');
  return ROLES.includes(r) ? r : 'EMPLOYEE';
}

async function nextEmpCode() {
  // Use the true maximum numeric suffix across all EMP codes (not the
  // last-inserted row, whose code may be lower after imports), then guarantee
  // uniqueness in case of gaps or non-standard codes.
  const rows = await db.prepare("SELECT emp_code FROM employees WHERE emp_code LIKE 'EMP%'").all();
  let max = 0;
  for (const r of rows) {
    const m = (r.emp_code || '').match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let n = max + 1;
  const exists = db.prepare('SELECT 1 FROM employees WHERE emp_code = ?');
  while (await exists.get('EMP' + String(n).padStart(4, '0'))) n++;
  return 'EMP' + String(n).padStart(4, '0');
}

/**
 * Creates an employee and (optionally) a matching login account.
 * Returns { employee, tempPassword }.
 */
async function createEmployee(data, { createLogin = true, defaultPassword } = {}) {
  const emp = {};
  for (const f of FIELDS) emp[f] = data[f] != null ? data[f] : null;
  emp.name = (emp.name || '').trim();
  if (!emp.name) throw new Error('Name is required');
  emp.monthly_salary = Number(emp.monthly_salary) || 0;
  emp.status = emp.status || 'active';
  emp.manager_id = emp.manager_id ? Number(emp.manager_id) : null;
  if (!emp.emp_code) emp.emp_code = await nextEmpCode();

  const role = normaliseRole(data.role);
  let userId = null;
  let tempPassword = null;

  if (createLogin && emp.email) {
    const existing = await db
      .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
      .get(emp.email);
    if (existing) {
      userId = existing.id;
      await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    } else {
      tempPassword = defaultPassword || makeTempPassword();
      const hash = bcrypt.hashSync(tempPassword, 10);
      const r = await db
        .prepare(
          'INSERT INTO users (email, password_hash, role, must_change) VALUES (?, ?, ?, 1)'
        )
        .run(emp.email, hash, role);
      userId = r.lastInsertRowid;
    }
  }

  const cols = [...FIELDS, 'user_id'];
  const placeholders = cols.map((c) => '@' + c).join(', ');
  const row = { ...emp, user_id: userId };
  const r = await db
    .prepare(`INSERT INTO employees (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(row);

  const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(r.lastInsertRowid);
  return { employee, tempPassword };
}

function makeTempPassword() {
  return 'Welcome@' + Math.floor(1000 + Math.random() * 9000);
}

module.exports = { createEmployee, FIELDS, SELF_ONBOARDING_FIELDS, ONBOARDING_REQUIRED_FIELDS, nextEmpCode, makeTempPassword, normaliseRole };
