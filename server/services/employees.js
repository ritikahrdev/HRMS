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
];

function normaliseRole(role) {
  const r = String(role || '').toUpperCase().replace(/[\s-]+/g, '_');
  return ROLES.includes(r) ? r : 'EMPLOYEE';
}

function nextEmpCode() {
  const row = db.prepare('SELECT emp_code FROM employees WHERE emp_code LIKE ? ORDER BY id DESC').get('EMP%');
  let n = 1;
  if (row && row.emp_code) {
    const m = row.emp_code.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'EMP' + String(n).padStart(4, '0');
}

/**
 * Creates an employee and (optionally) a matching login account.
 * Returns { employee, tempPassword }.
 */
function createEmployee(data, { createLogin = true, defaultPassword } = {}) {
  const emp = {};
  for (const f of FIELDS) emp[f] = data[f] != null ? data[f] : null;
  emp.name = (emp.name || '').trim();
  if (!emp.name) throw new Error('Name is required');
  emp.monthly_salary = Number(emp.monthly_salary) || 0;
  emp.status = emp.status || 'active';
  emp.manager_id = emp.manager_id ? Number(emp.manager_id) : null;
  if (!emp.emp_code) emp.emp_code = nextEmpCode();

  const role = normaliseRole(data.role);
  let userId = null;
  let tempPassword = null;

  if (createLogin && emp.email) {
    const existing = db
      .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
      .get(emp.email);
    if (existing) {
      userId = existing.id;
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    } else {
      tempPassword = defaultPassword || makeTempPassword();
      const hash = bcrypt.hashSync(tempPassword, 10);
      const r = db
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
  const r = db
    .prepare(`INSERT INTO employees (${cols.join(', ')}) VALUES (${placeholders})`)
    .run(row);

  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(r.lastInsertRowid);
  return { employee, tempPassword };
}

function makeTempPassword() {
  return 'Welcome@' + Math.floor(1000 + Math.random() * 9000);
}

module.exports = { createEmployee, FIELDS, nextEmpCode, makeTempPassword, normaliseRole };
