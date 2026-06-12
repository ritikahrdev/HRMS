// Postgres (Supabase) data layer. Exposes the same prepare/exec/withTransaction
// surface the app uses (via ./pg), plus an async init() that creates the schema
// and seeds defaults. index.js awaits init() before the server starts.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('./config');
const { prepare, exec, withTransaction, pool } = require('./pg');

// Timestamp/date defaults that match SQLite's old text format exactly.
const TS = "to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')";
const DT = "to_char((now() at time zone 'utc'),'YYYY-MM-DD')";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  emp_code TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  department TEXT,
  designation TEXT,
  date_of_joining TEXT,
  monthly_salary REAL NOT NULL DEFAULT 0,
  manager TEXT,
  bank_account TEXT,
  ifsc TEXT,
  pan TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT ${TS},
  dob TEXT, gender TEXT, emergency_name TEXT, emergency_phone TEXT, aadhaar TEXT,
  education TEXT, experience TEXT, blood_group TEXT, salary_structure TEXT, slack_id TEXT,
  manager_id INTEGER,
  personal_email TEXT, permanent_address TEXT, current_address TEXT, date_of_confirmation TEXT,
  permission_role TEXT, work_mode TEXT, employee_type TEXT, office_address TEXT, latitude TEXT, longitude TEXT,
  shift_timing TEXT, break_type TEXT, allowances TEXT, overtime_allowed TEXT, overtime_hours TEXT,
  bank_holder_name TEXT, bank_name TEXT, marital_status TEXT, nationality TEXT, languages_known TEXT,
  leave_earned REAL, leave_casual REAL, leave_comp_off REAL,
  onboarded INTEGER NOT NULL DEFAULT 0, onboarded_at TEXT,
  onboarding_submitted INTEGER NOT NULL DEFAULT 0, onboarding_submitted_at TEXT,
  preboard_token TEXT, preboard_expires TEXT
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  work_hours REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'present',
  late_minutes REAL DEFAULT 0,
  ot_hours REAL DEFAULT 0,
  wfh INTEGER DEFAULT 0,
  source TEXT,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  days REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER REFERENCES users(id),
  comment TEXT,
  applied_at TEXT NOT NULL DEFAULT ${TS},
  decided_at TEXT,
  half_day INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reimbursements (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,
  amount REAL NOT NULL,
  bill_file TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER REFERENCES users(id),
  comment TEXT,
  applied_at TEXT NOT NULL DEFAULT ${TS},
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS payslips (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  base_salary REAL NOT NULL,
  working_days REAL NOT NULL,
  present_days REAL NOT NULL,
  paid_leave REAL NOT NULL,
  unpaid_days REAL NOT NULL,
  paid_days REAL NOT NULL,
  per_day REAL NOT NULL,
  gross REAL NOT NULL,
  deductions REAL NOT NULL,
  reimbursements REAL NOT NULL DEFAULT 0,
  net_salary REAL NOT NULL,
  generated_at TEXT NOT NULL DEFAULT ${TS},
  breakup TEXT,
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  to_addr TEXT, subject TEXT, status TEXT, error TEXT, body TEXT,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  requested_status TEXT,
  requested_in TEXT,
  requested_out TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER REFERENCES users(id),
  comment TEXT,
  applied_at TEXT NOT NULL DEFAULT ${TS},
  decided_at TEXT,
  type TEXT DEFAULT 'regularization'
);

CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'public'
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  created_by INTEGER REFERENCES users(id),
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT,
  category TEXT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'available',
  notes TEXT,
  assigned_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT ${TS},
  doc_type TEXT, status TEXT, verify_note TEXT, verified_at TEXT, verified_by INTEGER
);

CREATE TABLE IF NOT EXISTS loans (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'loan',
  title TEXT,
  amount REAL NOT NULL,
  emi REAL NOT NULL DEFAULT 0,
  balance REAL,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  month TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  updated_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS comp_off_credits (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  days REAL NOT NULL DEFAULT 1,
  reason TEXT,
  granted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS kudos (
  id SERIAL PRIMARY KEY,
  from_user INTEGER REFERENCES users(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  badge TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${TS},
  cheers INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  target_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  reviewer_id INTEGER REFERENCES users(id),
  rating INTEGER,
  strengths TEXT,
  improvements TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS surveys (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  questions TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  anonymous INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${TS},
  category TEXT DEFAULT 'engagement',
  deadline TEXT,
  target_department TEXT,
  target_manager_id INTEGER,
  response_required INTEGER DEFAULT 0,
  show_results INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id SERIAL PRIMARY KEY,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  answers TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${TS},
  UNIQUE (survey_id, employee_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to INTEGER REFERENCES users(id),
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT ${TS},
  updated_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  type TEXT,
  description TEXT,
  skills TEXT,
  min_experience REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS applicants (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  experience_years REAL NOT NULL DEFAULT 0,
  skills TEXT,
  resume_file TEXT,
  source TEXT,
  stage TEXT NOT NULL DEFAULT 'applied',
  score INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS interviews (
  id SERIAL PRIMARY KEY,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  round TEXT,
  scheduled_at TEXT,
  interviewer TEXT,
  interviewer_email TEXT,
  mode TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  feedback TEXT,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS kudos_reactions (
  id SERIAL PRIMARY KEY,
  kudos_id INTEGER NOT NULL REFERENCES kudos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${TS},
  UNIQUE (kudos_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${TS},
  stage TEXT, owner TEXT, due_date TEXT, auto_key TEXT, done_at TEXT, done_by TEXT
);

CREATE TABLE IF NOT EXISTS mood_checkins (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  note TEXT,
  date TEXT NOT NULL DEFAULT ${DT},
  created_at TEXT NOT NULL DEFAULT ${TS}
);
CREATE UNIQUE INDEX IF NOT EXISTS mood_checkins_emp_date ON mood_checkins(employee_id, date);

CREATE TABLE IF NOT EXISTS file_store (
  id TEXT PRIMARY KEY,
  mime TEXT,
  filename TEXT,
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  quantity INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 1,
  assigned_to INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  condition TEXT NOT NULL DEFAULT 'good',
  serial_number TEXT,
  purchase_date TEXT,
  purchase_price REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT ${TS},
  updated_at TEXT NOT NULL DEFAULT ${TS}
);

-- Leave accrual & carry-forward ledger. Each row is a +/- movement on an
-- employee's balance for a leave type. period is 'YYYY-MM' for monthly accrual
-- or 'YYYY' for carry-forward / opening; balance for a year sums substr(period,1,4).
CREATE TABLE IF NOT EXISTS leave_ledger (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'accrual',
  period TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${TS}
);
CREATE INDEX IF NOT EXISTS leave_ledger_emp ON leave_ledger(employee_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS leave_ledger_uniq ON leave_ledger(employee_id, type, kind, period);

-- Offboarding / exit management.
CREATE TABLE IF NOT EXISTS exits (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reason TEXT,
  reason_detail TEXT,
  resignation_date TEXT,
  notice_days INTEGER NOT NULL DEFAULT 30,
  last_working_day TEXT,
  status TEXT NOT NULL DEFAULT 'initiated',
  initiated_by TEXT,
  rehire_eligible INTEGER DEFAULT 1,
  exit_notes TEXT,
  settlement TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${TS},
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS exit_tasks (
  id SERIAL PRIMARY KEY,
  exit_id INTEGER NOT NULL REFERENCES exits(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  done_at TEXT, done_by TEXT
);

-- Project timesheets.
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  client TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  billable INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${TS}
);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 0,
  task TEXT,
  billable INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  approver_id INTEGER REFERENCES users(id),
  decided_at TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT ${TS}
);
CREATE INDEX IF NOT EXISTS timesheet_emp_date ON timesheet_entries(employee_id, date);

-- One-shot idempotency markers for the daily automation engine.
CREATE TABLE IF NOT EXISTS automation_markers (
  marker TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT ${TS}
);
`;

// Columns added to pre-existing tables after their first release. Postgres
// supports ADD COLUMN IF NOT EXISTS, so these are safe to run on every startup.
const COLUMN_MIGRATIONS = [
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS in_lat REAL",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS in_lng REAL",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_lat REAL",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_lng REAL",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS geo_accuracy REAL",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS in_geofenced INTEGER",
  // AI screening results for candidates who apply via the public careers page.
  "ALTER TABLE applicants ADD COLUMN IF NOT EXISTS ai_score INTEGER",
  "ALTER TABLE applicants ADD COLUMN IF NOT EXISTS ai_recommendation TEXT",
  "ALTER TABLE applicants ADD COLUMN IF NOT EXISTS ai_summary TEXT",
];

const INVENTORY_SEED = [
  ['Laptop (14" Business)', 'electronics', 5, 5, 'good', 55000, 'Standard dev laptops'],
  ['External Monitor (24")', 'electronics', 5, 5, 'good', 12000, '1080p IPS monitors'],
  ['Keyboard (Wired USB)', 'electronics', 6, 6, 'good', 800, 'Standard keyboards'],
  ['Mouse (Wired USB)', 'electronics', 6, 6, 'good', 600, 'Standard mice'],
  ['USB Hub (4-port)', 'electronics', 4, 4, 'good', 600, ''],
  ['Headset with Mic', 'electronics', 5, 5, 'good', 1500, 'For calls and meetings'],
  ['Webcam (1080p)', 'electronics', 3, 3, 'good', 2500, 'For video conferencing'],
  ['Phone (IP Desk)', 'electronics', 3, 3, 'good', 4000, 'Reception and HR desk'],
  ['Work Desk', 'furniture', 6, 6, 'good', 8000, 'Standard 4x2 work desks'],
  ['Ergonomic Chair', 'furniture', 6, 6, 'good', 6000, 'Lumbar-support chairs'],
  ['Whiteboard (4x3)', 'furniture', 2, 2, 'good', 3500, 'Meeting room whiteboards'],
  ['Bookshelf / Storage Rack', 'furniture', 2, 2, 'good', 3000, ''],
  ['Filing Cabinet (3-drawer)', 'furniture', 2, 2, 'good', 5000, 'HR document storage'],
  ['Conference Table', 'furniture', 1, 1, 'good', 15000, '6-seater meeting table'],
  ['Laser Printer', 'equipment', 1, 1, 'good', 18000, 'HP LaserJet — shared'],
  ['Flatbed Scanner', 'equipment', 1, 1, 'good', 8000, 'Document scanner'],
  ['Projector (HDMI)', 'equipment', 1, 1, 'good', 22000, 'Meeting room projector'],
  ['UPS / Power Backup', 'equipment', 3, 3, 'good', 4500, '650VA units'],
  ['Extension Board (6-socket)', 'equipment', 8, 8, 'good', 400, ''],
  ['WiFi Router (Dual-band)', 'network', 2, 2, 'good', 3500, 'Office WiFi access'],
  ['Network Switch (8-port)', 'network', 1, 1, 'good', 2000, 'Wired LAN switch'],
  ['Ethernet Cable (Cat6, 5m)', 'network', 10, 10, 'good', 150, ''],
  ['A4 Printer Paper (Ream)', 'stationery', 10, 10, 'good', 300, '500 sheets per ream'],
  ['Notebook / Legal Pad', 'stationery', 20, 20, 'good', 60, ''],
  ['Ballpoint Pens (Box)', 'stationery', 5, 5, 'good', 120, 'Pack of 10'],
  ['Sticky Notes Pack', 'stationery', 10, 10, 'good', 80, '3x3 inch pads'],
  ['Folders / Document Files', 'stationery', 15, 15, 'good', 40, ''],
  ['Stapler + Staple Pins', 'stationery', 4, 4, 'good', 150, ''],
  ['Scissors & Tape', 'stationery', 4, 4, 'good', 80, ''],
  ['MS Office 365 License', 'software', 5, 5, 'good', 5000, 'Annual per-user license'],
  ['Antivirus License', 'software', 5, 5, 'good', 1200, 'Annual per-device'],
  ['Zoom Pro License', 'software', 2, 2, 'good', 13200, 'Annual team plan'],
  ['Access / ID Card', 'access', 10, 10, 'good', 150, 'Employee access cards'],
  ['Door Key / Locker Key', 'access', 6, 6, 'good', 50, ''],
  ['Visitor Log Book', 'access', 2, 2, 'good', 100, 'Reception visitor register'],
];

const defaultSettings = {
  webhookSecret: crypto.randomBytes(24).toString('hex'),
  preboardLinkHours: 4,
  companyName: 'My Company', legalName: '', address: '', gst: '', cin: '', pan: '',
  email: '', phone: '', website: '', currency: '₹', logoFile: '',
  slipFooter: 'This is a computer-generated payslip and does not require a signature.',
  workStart: '09:30', workEnd: '18:30', workingDays: [1, 2, 3, 4, 5], weekendPolicy: 'sat-sun',
  attendanceSheetUrl: '', fullDayHours: 9, halfDayHours: 4.5, graceMinutes: 30,
  requiredDocs: [
    'Government-issued ID (Aadhaar & PAN, or Passport)', 'Recent passport-sized photographs',
    'Previous employment documents (offer / experience / resignation letters)',
    'Educational certificates and marksheets', 'Last 2-3 salary slips (last 2 organizations)',
    'Cancelled cheque or bank account details', 'Two contact numbers for reference check',
    'Emergency contact number',
  ],
  departmentAccounts: {
    default: ['Work email (Google Workspace)', 'Slack', 'HRMS login', 'Biometric / ID card'],
    Tech: ['Work email (Google Workspace)', 'Slack', 'GitHub', 'Jira', 'Cloud / AWS console', 'VPN'],
    Engineering: ['Work email (Google Workspace)', 'Slack', 'GitHub', 'Jira', 'Cloud / AWS console', 'VPN'],
    IT: ['Work email (Google Workspace)', 'Slack', 'Admin console', 'VPN', 'Asset management tool'],
    Product: ['Work email (Google Workspace)', 'Slack', 'Jira', 'Figma', 'Analytics dashboard'],
    Design: ['Work email (Google Workspace)', 'Slack', 'Figma', 'Adobe Creative Cloud'],
    Sales: ['Work email (Google Workspace)', 'Slack', 'CRM (HubSpot / Salesforce)', 'Calling / dialer tool', 'LinkedIn Sales Navigator'],
    'Field Sales': ['Work email (Google Workspace)', 'Slack', 'CRM', 'Calling / dialer tool', 'Mobile field app'],
    'Account Management': ['Work email (Google Workspace)', 'Slack', 'CRM', 'Customer success tool', 'Analytics dashboard'],
    Revenue: ['Work email (Google Workspace)', 'Slack', 'CRM', 'Billing / RevOps tool', 'Analytics dashboard'],
    Marketing: ['Work email (Google Workspace)', 'Slack', 'CRM', 'Social media scheduler', 'Analytics dashboard'],
    'Human Resources': ['Work email (Google Workspace)', 'Slack', 'HRMS admin', 'Payroll portal'],
    HR: ['Work email (Google Workspace)', 'Slack', 'HRMS admin', 'Payroll portal'],
    Finance: ['Work email (Google Workspace)', 'Slack', 'Accounting / ERP', 'Banking portal', 'Payroll portal'],
    Founder: ['Work email (Google Workspace)', 'Slack', 'Admin console', 'Banking portal', 'All-systems access'],
    Operations: ['Work email (Google Workspace)', 'Slack', 'HRMS login', 'Internal tools'],
    Support: ['Work email (Google Workspace)', 'Slack', 'Helpdesk / ticketing', 'CRM'],
  },
  leavePolicy: { casual: 7, sick: 7 },
  leaveTypes: [
    { code: 'casual', name: 'Casual Leave', quota: 7, paid: true },
    { code: 'sick', name: 'Sick Leave', quota: 7, paid: true },
    { code: 'unpaid', name: 'Unpaid Leave', quota: 0, paid: false },
  ],
  modules: {
    directory: true, notices: true, holidays: true, recognition: true, performance: true,
    surveys: true, helpdesk: true, assets: true, loans: true, reimbursement: true, recruitment: true,
    offboarding: true, timesheets: true,
  },
  // Monthly leave accrual + year-end carry-forward. When enabled for a type,
  // that type's "allowed" balance comes from the accrual ledger instead of the
  // flat annual quota. rules keyed by leave-type code.
  leaveAccrual: { enabled: false, rules: {} },
  // Optional office geofence for attendance marking (does not block — only flags).
  geofence: { enabled: false, lat: null, lng: null, radius: 200 },
  // Automatic birthday wishes (emailed to the employee only). Company timezone
  // controls which calendar day counts as "today" for birthdays.
  birthdayEmails: true,
  timezone: 'Asia/Kolkata',
  // Daily automation engine — recurring HR chores that run on their own so the
  // system keeps working when HR is away. Each is individually switchable.
  automation: {
    enabled: true,
    birthdays: true,
    anniversaries: true,
    holidayReminders: true,
    leaveAccrual: true,
    slackBackupSync: false,
  },
  // Server-managed snapshot of the last automation run (read-only in the UI).
  automationState: { lastRunDate: null, lastRunAt: null, results: {} },
  // AI copilot. Defaults to a FREE provider (Google Gemini); the admin pastes
  // their own free API key to switch it on. Groq and paid Claude also supported.
  ai: { enabled: true, provider: 'google', apiKey: '', model: 'gemini-2.0-flash', endpoint: '' },
  slack: {
    enabled: false, botToken: '', channelId: '', signingSecret: '',
    presentKeywords: ['in', 'present', 'wfo', 'office', 'working', 'available', 'checking in', 'logged in'],
    wfhKeywords: ['wfh', 'work from home', 'remote', 'working from home', 'home'],
    halfKeywords: ['half day', 'half-day', 'halfday'],
    leaveKeywords: ['leave', 'off', 'ooo', 'sick', 'holiday', 'pto', 'vacation'],
    absentKeywords: ['absent', 'not available', 'na'],
    autoReact: true, validReaction: 'thumbsup', invalidReaction: 'x', notifyOnInvalid: true,
  },
  payrollClosingDay: 30,
  payroll: { perDayBasis: 'working', deductAbsent: true, deductUnpaidLeave: true },
  statutory: {
    pf: { enabled: true, percent: 12, basisCap: 15000 },
    esi: { enabled: true, percent: 0.75, grossCap: 21000 },
    pt: { enabled: true, amount: 200 },
  },
};

let initialized = false;

async function init() {
  if (initialized) return;
  await exec(SCHEMA);

  // Add any columns introduced after the table's first release.
  for (const stmt of COLUMN_MIGRATIONS) await exec(stmt);

  // Normalise any legacy role values (harmless on a fresh DB).
  await exec("UPDATE users SET role='SUPER_ADMIN' WHERE role='admin'");
  await exec("UPDATE users SET role='EMPLOYEE' WHERE role='employee'");

  // Seed inventory once.
  const invCount = (await prepare('SELECT COUNT(*) AS n FROM inventory').get()).n;
  if (Number(invCount) === 0) {
    const ins = prepare('INSERT INTO inventory (name,category,quantity,available,condition,purchase_price,notes) VALUES (?,?,?,?,?,?,?)');
    for (const it of INVENTORY_SEED) await ins.run(...it);
  }

  // Seed / merge settings.
  const row = await prepare('SELECT data FROM settings WHERE id = 1').get();
  if (!row) {
    await prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify(defaultSettings));
  } else {
    const saved = JSON.parse(row.data);
    let changed = false;
    for (const k of Object.keys(defaultSettings)) {
      if (!(k in saved)) { saved[k] = defaultSettings[k]; changed = true; }
    }
    if (saved.departmentAccounts && typeof saved.departmentAccounts === 'object') {
      for (const dept of Object.keys(defaultSettings.departmentAccounts)) {
        if (!(dept in saved.departmentAccounts)) { saved.departmentAccounts[dept] = defaultSettings.departmentAccounts[dept]; changed = true; }
      }
    }
    // Newly-added modules default to on for existing installs.
    if (saved.modules && typeof saved.modules === 'object') {
      for (const m of Object.keys(defaultSettings.modules)) {
        if (!(m in saved.modules)) { saved.modules[m] = defaultSettings.modules[m]; changed = true; }
      }
    }
    if (changed) await prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(saved));
  }

  // Seed default admin.
  const admin = config.defaultAdmin;
  const existing = await prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(admin.email);
  if (!existing) {
    const hash = bcrypt.hashSync(admin.password, 10);
    await prepare('INSERT INTO users (email, password_hash, role, must_change) VALUES (?, ?, ?, 0)').run(admin.email, hash, 'SUPER_ADMIN');
    console.log(`Default admin ready: ${admin.email}`);
  }

  // Warm the in-memory settings cache so getSettings() can stay synchronous.
  await require('./services/settings').loadSettings();

  initialized = true;
  console.log('✅ Postgres schema ready (Supabase).');
}

module.exports = { prepare, exec, withTransaction, pool, init, defaultSettings };
