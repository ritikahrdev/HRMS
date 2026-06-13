// Seeds the isolated SQLite test DB with all 5 roles + realistic data.
// Run with: DB_DRIVER=sqlite SQLITE_PATH=... node tests/seed-test-db.js
process.env.DB_DRIVER = 'sqlite';
process.env.MAIL_DISABLED = '1';
const bcrypt = require('bcryptjs');
const db = require('../server/db');

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const ym = iso(today).slice(0, 7);

async function mkUser(email, password, role) {
  const hash = bcrypt.hashSync(password, 8);
  const existing = await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(email);
  if (existing) return existing.id;
  const r = await db.prepare('INSERT INTO users (email, password_hash, role, must_change) VALUES (?,?,?,0)').run(email, hash, role);
  return r.lastInsertRowid;
}

async function mkEmp(o) {
  const r = await db.prepare(
    `INSERT INTO employees (user_id, emp_code, name, email, department, designation, date_of_joining,
       monthly_salary, manager_id, status, dob, slack_id, gender, work_mode, employee_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(o.user_id || null, o.emp_code, o.name, o.email, o.department, o.designation, o.doj,
        o.salary, o.manager_id || null, o.status || 'active', o.dob || null, o.slack_id || null,
        o.gender || null, o.work_mode || 'office', o.employee_type || 'full-time');
  return r.lastInsertRowid;
}

(async () => {
  await db.init(); // creates schema + seeds SUPER_ADMIN (admin@company.local / ChangeMe@12345)

  // ---- Role logins ----
  const hrU = await mkUser('hr@company.local', 'hr12345', 'HR_ADMIN');
  const finU = await mkUser('finance@company.local', 'fin12345', 'FINANCE_ADMIN');
  const mgrU = await mkUser('manager@company.local', 'mgr12345', 'MANAGER');
  const empU = await mkUser('employee@company.local', 'employee123', 'EMPLOYEE');
  const emp2U = await mkUser('employee2@company.local', 'employee123', 'EMPLOYEE');

  // ---- Employees for those logins ----
  const hrE = await mkEmp({ user_id: hrU, emp_code: 'E001', name: 'Hema Sharma', email: 'hr@company.local', department: 'Human Resources', designation: 'HR Manager', doj: '2022-03-01', salary: 90000, dob: '1990-06-13', gender: 'female' });
  const finE = await mkEmp({ user_id: finU, emp_code: 'E002', name: 'Farah Khan', email: 'finance@company.local', department: 'Finance', designation: 'Finance Lead', doj: '2021-07-15', salary: 110000, dob: '1988-11-02', gender: 'female' });
  const mgrE = await mkEmp({ user_id: mgrU, emp_code: 'E003', name: 'Manish Gupta', email: 'manager@company.local', department: 'Engineering', designation: 'Engineering Manager', doj: '2020-01-10', salary: 150000, dob: '1985-09-20', gender: 'male' });
  const empE = await mkEmp({ user_id: empU, emp_code: 'E004', name: 'Esha Patel', email: 'employee@company.local', department: 'Engineering', designation: 'Software Engineer', doj: '2023-04-01', salary: 60000, manager_id: mgrE, dob: '1996-06-13', gender: 'female', slack_id: 'U-ESHA' });
  const emp2E = await mkEmp({ user_id: emp2U, emp_code: 'E005', name: 'Rahul Verma', email: 'employee2@company.local', department: 'Engineering', designation: 'QA Engineer', doj: '2023-08-20', salary: 55000, manager_id: mgrE, dob: '1997-02-14', gender: 'male', slack_id: 'U-RAHUL' });

  // ---- Bulk plain employees (no login) across departments ----
  const depts = ['Engineering', 'Sales', 'Marketing', 'Operations', 'Support', 'Product', 'Design', 'Finance'];
  for (let i = 6; i <= 22; i++) {
    const d = depts[i % depts.length];
    await mkEmp({
      emp_code: 'E' + String(i).padStart(3, '0'),
      name: `Employee ${i}`,
      email: `emp${i}@company.local`,
      department: d,
      designation: 'Associate',
      doj: `202${(i % 4) + 1}-0${(i % 9) + 1}-1${i % 9}`,
      salary: 40000 + (i % 6) * 8000,
      manager_id: (d === 'Engineering') ? mgrE : null,
      dob: `199${i % 9}-0${(i % 9) + 1}-1${i % 9}`,
      gender: i % 2 ? 'male' : 'female',
    });
  }

  // ---- Attendance for current month (a few days) ----
  for (const eid of [empE, emp2E, mgrE]) {
    for (let day = 1; day <= 5; day++) {
      const date = `${ym}-0${day}`;
      await db.prepare('INSERT INTO attendance (employee_id, date, check_in, status, work_hours, source) VALUES (?,?,?,?,?,?) ON CONFLICT(employee_id,date) DO NOTHING')
        .run(eid, date, '09:30', 'present', 9, 'seed');
    }
  }

  // ---- A pending leave request (future) ----
  const future = iso(new Date(Date.now() + 7 * 864e5));
  await db.prepare('INSERT INTO leave_requests (employee_id, type, from_date, to_date, days, reason, status) VALUES (?,?,?,?,?,?,?)')
    .run(empE, 'casual', future, future, 1, 'Personal work', 'pending');

  // ---- Holidays ----
  await db.prepare('INSERT INTO holidays (date, name, type) VALUES (?,?,?) ON CONFLICT(date) DO NOTHING').run('2026-08-15', 'Independence Day', 'public');
  await db.prepare('INSERT INTO holidays (date, name, type) VALUES (?,?,?) ON CONFLICT(date) DO NOTHING').run('2026-10-02', 'Gandhi Jayanti', 'public');

  // ---- A project (timesheets) ----
  await db.prepare('INSERT INTO projects (name, code, client, status, billable) VALUES (?,?,?,?,?)').run('Internal HRMS', 'PRJ-1', 'Internal', 'active', 0);

  // ---- An open job (careers/recruitment) ----
  await db.prepare('INSERT INTO jobs (title, department, location, type, description, skills, min_experience, status) VALUES (?,?,?,?,?,?,?,?)')
    .run('Backend Engineer', 'Engineering', 'Remote', 'full-time', 'Build APIs', 'node,sql,api', 2, 'open');

  const counts = {
    users: (await db.prepare('SELECT COUNT(*) n FROM users').get()).n,
    employees: (await db.prepare('SELECT COUNT(*) n FROM employees').get()).n,
    attendance: (await db.prepare('SELECT COUNT(*) n FROM attendance').get()).n,
  };
  console.log('SEED OK', JSON.stringify(counts), 'empId=' + empE, 'mgrId=' + mgrE);
  process.exit(0);
})().catch((e) => { console.error('SEED FAILED:', e); process.exit(1); });
