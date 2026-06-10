// Hide the harmless "SQLite is experimental" startup warning so the console
// stays clean for non-technical users.
const _emit = process.emit;
process.emit = function (name, data) {
  if (name === 'warning' && data && data.name === 'ExperimentalWarning' && /sqlite/i.test(data.message || '')) {
    return false;
  }
  return _emit.apply(process, arguments);
};

const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const config = require('./config');

const db = new DatabaseSync(config.paths.db);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'employee',  -- 'admin' or 'employee'
  must_change   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  emp_code       TEXT UNIQUE,
  name           TEXT NOT NULL,
  email          TEXT,
  phone          TEXT,
  department     TEXT,
  designation    TEXT,
  date_of_joining TEXT,
  monthly_salary REAL NOT NULL DEFAULT 0,
  manager        TEXT,
  bank_account   TEXT,
  ifsc           TEXT,
  pan            TEXT,
  address        TEXT,
  status         TEXT NOT NULL DEFAULT 'active', -- active / inactive
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,           -- YYYY-MM-DD
  check_in    TEXT,                    -- ISO timestamp
  check_out   TEXT,
  work_hours  REAL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'present', -- present / half / absent / leave
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,           -- casual / sick / earned / unpaid
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL,
  days        REAL NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected
  approver_id INTEGER REFERENCES users(id),
  comment     TEXT,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
);

CREATE TABLE IF NOT EXISTS reimbursements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  category    TEXT,
  amount      REAL NOT NULL,
  bill_file   TEXT,                    -- stored filename in /uploads
  status      TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected
  approver_id INTEGER REFERENCES users(id),
  comment     TEXT,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
);

CREATE TABLE IF NOT EXISTS payslips (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month         TEXT NOT NULL,         -- YYYY-MM
  base_salary   REAL NOT NULL,
  working_days  REAL NOT NULL,
  present_days  REAL NOT NULL,
  paid_leave    REAL NOT NULL,
  unpaid_days   REAL NOT NULL,
  paid_days     REAL NOT NULL,
  per_day       REAL NOT NULL,
  gross         REAL NOT NULL,
  deductions    REAL NOT NULL,
  reimbursements REAL NOT NULL DEFAULT 0,
  net_salary    REAL NOT NULL,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS settings (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr   TEXT,
  subject   TEXT,
  status    TEXT,           -- sent / disabled / error
  error     TEXT,
  body      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  requested_status TEXT,        -- present / half / leave / absent
  requested_in  TEXT,           -- HH:MM (optional)
  requested_out TEXT,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected
  approver_id   INTEGER REFERENCES users(id),
  comment       TEXT,
  applied_at    TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at    TEXT
);

CREATE TABLE IF NOT EXISTS holidays (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  date  TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
  name  TEXT NOT NULL,
  type  TEXT DEFAULT 'public'   -- public / restricted / company
);

CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  body       TEXT,
  created_by INTEGER REFERENCES users(id),
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  tag          TEXT,            -- serial / asset tag
  category     TEXT,            -- laptop / phone / ...
  employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'available', -- available / assigned / retired
  notes        TEXT,
  assigned_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  file         TEXT NOT NULL,
  uploaded_by  INTEGER REFERENCES users(id),
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'loan',   -- loan / advance
  title        TEXT,
  amount       REAL NOT NULL,                  -- total amount
  emi          REAL NOT NULL DEFAULT 0,        -- monthly deduction
  balance      REAL,                           -- remaining (informational)
  status       TEXT NOT NULL DEFAULT 'active', -- active / closed
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  month       TEXT PRIMARY KEY,               -- YYYY-MM
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft / approved
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comp_off_credits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  days        REAL NOT NULL DEFAULT 1,
  reason      TEXT,
  granted_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kudos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user   INTEGER REFERENCES users(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE, -- recipient
  badge       TEXT,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  target_date TEXT,
  progress    INTEGER NOT NULL DEFAULT 0, -- 0..100
  status      TEXT NOT NULL DEFAULT 'active', -- active / done / dropped
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,   -- e.g. 2026-H1 / 2026-Q1
  reviewer_id INTEGER REFERENCES users(id),
  rating      INTEGER,         -- 1..5
  strengths   TEXT,
  improvements TEXT,
  status      TEXT NOT NULL DEFAULT 'submitted',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS surveys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  questions   TEXT NOT NULL,   -- JSON array of {text,type}
  active      INTEGER NOT NULL DEFAULT 1,
  anonymous   INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id   INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  answers     TEXT NOT NULL,   -- JSON array aligned to questions
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (survey_id, employee_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category    TEXT,
  subject     TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'open', -- open / in_progress / closed
  assigned_to INTEGER REFERENCES users(id),
  resolution  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  department  TEXT,
  location    TEXT,
  type        TEXT,            -- Full-time / Part-time / Contract / Intern
  description TEXT,
  skills      TEXT,            -- comma-separated required skills
  min_experience REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open', -- open / closed
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applicants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  experience_years REAL NOT NULL DEFAULT 0,
  skills      TEXT,
  resume_file TEXT,
  source      TEXT,            -- LinkedIn / Referral / Website / ...
  stage       TEXT NOT NULL DEFAULT 'applied', -- applied/shortlisted/interview/offer/hired/rejected
  score       INTEGER,         -- criteria match %
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  round       TEXT,
  scheduled_at TEXT,           -- ISO timestamp
  interviewer TEXT,
  interviewer_email TEXT,
  mode        TEXT,            -- Online / In-person
  status      TEXT NOT NULL DEFAULT 'scheduled',
  feedback    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kudos_reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kudos_id   INTEGER NOT NULL REFERENCES kudos(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kudos_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Lightweight migrations (safe to run every start) ----------------------
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}
// Extended employee profile fields (Core HR pack).
for (const col of ['dob', 'gender', 'emergency_name', 'emergency_phone', 'aadhaar', 'education', 'experience', 'blood_group']) {
  if (!hasColumn('employees', col)) db.exec(`ALTER TABLE employees ADD COLUMN ${col} TEXT`);
}
// Payroll pack columns.
if (!hasColumn('employees', 'salary_structure')) db.exec('ALTER TABLE employees ADD COLUMN salary_structure TEXT');
if (!hasColumn('payslips', 'breakup')) db.exec('ALTER TABLE payslips ADD COLUMN breakup TEXT');
// Leave & time pack columns.
if (!hasColumn('leave_requests', 'half_day')) db.exec('ALTER TABLE leave_requests ADD COLUMN half_day INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('attendance', 'late_minutes')) db.exec('ALTER TABLE attendance ADD COLUMN late_minutes REAL DEFAULT 0');
if (!hasColumn('attendance', 'ot_hours')) db.exec('ALTER TABLE attendance ADD COLUMN ot_hours REAL DEFAULT 0');
// Engagement + Slack columns.
if (!hasColumn('kudos', 'cheers')) db.exec('ALTER TABLE kudos ADD COLUMN cheers INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('employee_documents', 'doc_type')) db.exec('ALTER TABLE employee_documents ADD COLUMN doc_type TEXT');
for (const col of ['status', 'verify_note', 'verified_at']) {
  if (!hasColumn('employee_documents', col)) db.exec(`ALTER TABLE employee_documents ADD COLUMN ${col} TEXT`);
}
if (!hasColumn('employee_documents', 'verified_by')) db.exec('ALTER TABLE employee_documents ADD COLUMN verified_by INTEGER');
if (!hasColumn('employees', 'slack_id')) db.exec('ALTER TABLE employees ADD COLUMN slack_id TEXT');
if (!hasColumn('employees', 'manager_id')) {
  db.exec('ALTER TABLE employees ADD COLUMN manager_id INTEGER');
}
// Extended employee profile columns (full HR roster import).
for (const col of [
  'personal_email', 'permanent_address', 'current_address', 'date_of_confirmation',
  'permission_role', 'work_mode', 'employee_type', 'office_address', 'latitude', 'longitude',
  'shift_timing', 'break_type', 'allowances', 'overtime_allowed', 'overtime_hours',
  'bank_holder_name', 'bank_name', 'marital_status', 'nationality', 'languages_known',
]) {
  if (!hasColumn('employees', col)) db.exec(`ALTER TABLE employees ADD COLUMN ${col} TEXT`);
}
for (const col of ['leave_earned', 'leave_casual', 'leave_comp_off']) {
  if (!hasColumn('employees', col)) db.exec(`ALTER TABLE employees ADD COLUMN ${col} REAL`);
}
// Onboarding completion flag. When the column is first introduced, every
// employee already in the system predates the onboarding feature, so they are
// backfilled as "already onboarded" (one-time). Employees added later start at
// 0 and are tracked through the Onboarding section.
if (!hasColumn('employees', 'onboarded')) {
  db.exec('ALTER TABLE employees ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE employees ADD COLUMN onboarded_at TEXT');
  db.exec("UPDATE employees SET onboarded = 1, onboarded_at = datetime('now')");
}
// Attendance correction enhancements
if (!hasColumn('attendance_corrections', 'type')) db.exec('ALTER TABLE attendance_corrections ADD COLUMN type TEXT DEFAULT "regularization"');
// Work-from-home flag (set when attendance comes from a Slack "WFH" message)
if (!hasColumn('attendance', 'wfh')) db.exec('ALTER TABLE attendance ADD COLUMN wfh INTEGER DEFAULT 0');
// Track where an attendance record came from (manual / slack / import)
if (!hasColumn('attendance', 'source')) db.exec('ALTER TABLE attendance ADD COLUMN source TEXT');
// Employee Happiness / Mood check-ins
db.exec(`
CREATE TABLE IF NOT EXISTS mood_checkins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
  note        TEXT,
  date        TEXT NOT NULL DEFAULT (date('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// One check-in per employee per day
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS mood_checkins_emp_date ON mood_checkins(employee_id, date);`);
// Survey enhancements pack - modern HRMS features
if (!hasColumn('surveys', 'category')) db.exec('ALTER TABLE surveys ADD COLUMN category TEXT DEFAULT "engagement"'); // engagement, satisfaction, performance, feedback, pulse
if (!hasColumn('surveys', 'deadline')) db.exec('ALTER TABLE surveys ADD COLUMN deadline TEXT'); // ISO date for survey end
if (!hasColumn('surveys', 'target_department')) db.exec('ALTER TABLE surveys ADD COLUMN target_department TEXT'); // null = all, or specific department
if (!hasColumn('surveys', 'target_manager_id')) db.exec('ALTER TABLE surveys ADD COLUMN target_manager_id INTEGER'); // null = all, or manager's team
if (!hasColumn('surveys', 'response_required')) db.exec('ALTER TABLE surveys ADD COLUMN response_required INTEGER DEFAULT 0'); // is it mandatory
if (!hasColumn('surveys', 'show_results')) db.exec('ALTER TABLE surveys ADD COLUMN show_results INTEGER DEFAULT 1'); // can employees see results
// HR Operations Inventory table
db.exec(`
CREATE TABLE IF NOT EXISTS inventory (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'other',
  quantity       INTEGER NOT NULL DEFAULT 1,
  available      INTEGER NOT NULL DEFAULT 1,
  assigned_to    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  condition      TEXT NOT NULL DEFAULT 'good',
  serial_number  TEXT,
  purchase_date  TEXT,
  purchase_price REAL DEFAULT 0,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Seed starter inventory items if table is empty
const invCount = db.prepare('SELECT COUNT(*) AS n FROM inventory').get().n;
if (invCount === 0) {
  const addItem = db.prepare(`INSERT INTO inventory (name,category,quantity,available,condition,purchase_price,notes) VALUES (?,?,?,?,?,?,?)`);
  const items = [
    // Electronics
    ['Laptop (14" Business)', 'electronics', 5, 5, 'good', 55000, 'Standard dev laptops'],
    ['External Monitor (24")', 'electronics', 5, 5, 'good', 12000, '1080p IPS monitors'],
    ['Keyboard (Wired USB)', 'electronics', 6, 6, 'good', 800, 'Standard keyboards'],
    ['Mouse (Wired USB)', 'electronics', 6, 6, 'good', 600, 'Standard mice'],
    ['USB Hub (4-port)', 'electronics', 4, 4, 'good', 600, ''],
    ['Headset with Mic', 'electronics', 5, 5, 'good', 1500, 'For calls and meetings'],
    ['Webcam (1080p)', 'electronics', 3, 3, 'good', 2500, 'For video conferencing'],
    ['Phone (IP Desk)', 'electronics', 3, 3, 'good', 4000, 'Reception and HR desk'],
    // Furniture
    ['Work Desk', 'furniture', 6, 6, 'good', 8000, 'Standard 4x2 work desks'],
    ['Ergonomic Chair', 'furniture', 6, 6, 'good', 6000, 'Lumbar-support chairs'],
    ['Whiteboard (4x3)', 'furniture', 2, 2, 'good', 3500, 'Meeting room whiteboards'],
    ['Bookshelf / Storage Rack', 'furniture', 2, 2, 'good', 3000, ''],
    ['Filing Cabinet (3-drawer)', 'furniture', 2, 2, 'good', 5000, 'HR document storage'],
    ['Conference Table', 'furniture', 1, 1, 'good', 15000, '6-seater meeting table'],
    // Office Equipment
    ['Laser Printer', 'equipment', 1, 1, 'good', 18000, 'HP LaserJet — shared'],
    ['Flatbed Scanner', 'equipment', 1, 1, 'good', 8000, 'Document scanner'],
    ['Projector (HDMI)', 'equipment', 1, 1, 'good', 22000, 'Meeting room projector'],
    ['UPS / Power Backup', 'equipment', 3, 3, 'good', 4500, '650VA units'],
    ['Extension Board (6-socket)', 'equipment', 8, 8, 'good', 400, ''],
    // Network
    ['WiFi Router (Dual-band)', 'network', 2, 2, 'good', 3500, 'Office WiFi access'],
    ['Network Switch (8-port)', 'network', 1, 1, 'good', 2000, 'Wired LAN switch'],
    ['Ethernet Cable (Cat6, 5m)', 'network', 10, 10, 'good', 150, ''],
    // Stationery
    ['A4 Printer Paper (Ream)', 'stationery', 10, 10, 'good', 300, '500 sheets per ream'],
    ['Notebook / Legal Pad', 'stationery', 20, 20, 'good', 60, ''],
    ['Ballpoint Pens (Box)', 'stationery', 5, 5, 'good', 120, 'Pack of 10'],
    ['Sticky Notes Pack', 'stationery', 10, 10, 'good', 80, '3x3 inch pads'],
    ['Folders / Document Files', 'stationery', 15, 15, 'good', 40, ''],
    ['Stapler + Staple Pins', 'stationery', 4, 4, 'good', 150, ''],
    ['Scissors & Tape', 'stationery', 4, 4, 'good', 80, ''],
    // Software / Licenses
    ['MS Office 365 License', 'software', 5, 5, 'good', 5000, 'Annual per-user license'],
    ['Antivirus License', 'software', 5, 5, 'good', 1200, 'Annual per-device'],
    ['Zoom Pro License', 'software', 2, 2, 'good', 13200, 'Annual team plan'],
    // Access & Security
    ['Access / ID Card', 'access', 10, 10, 'good', 150, 'Employee access cards'],
    ['Door Key / Locker Key', 'access', 6, 6, 'good', 50, ''],
    ['Visitor Log Book', 'access', 2, 2, 'good', 100, 'Reception visitor register'],
  ];
  for (const it of items) addItem.run(...it);
}

// Migrate the old two-role scheme to the new five-role scheme.
db.exec("UPDATE users SET role='SUPER_ADMIN' WHERE role='admin'");
db.exec("UPDATE users SET role='EMPLOYEE' WHERE role='employee'");

// ---- Seed default settings -------------------------------------------------
const defaultSettings = {
  // Attendance webhook secret (auto-generated; trusted systems send it in the
  // X-Webhook-Secret header). Override with the ATTENDANCE_WEBHOOK_SECRET env var.
  webhookSecret: require('crypto').randomBytes(24).toString('hex'),
  // Company
  companyName: 'My Company',
  legalName: '',
  address: '',
  gst: '',
  cin: '',
  pan: '',
  email: '',
  phone: '',
  website: '',
  currency: '₹',
  logoFile: '',
  slipFooter: 'This is a computer-generated payslip and does not require a signature.',
  // Attendance
  workStart: '09:30',
  workEnd: '18:30',
  workingDays: [1, 2, 3, 4, 5], // Mon-Fri (0=Sun .. 6=Sat)
  weekendPolicy: 'sat-sun', // informational
  attendanceSheetUrl: '', // published Google Sheet CSV link for attendance import
  fullDayHours: 9,
  halfDayHours: 4.5,
  graceMinutes: 30, // minutes after start time an employee may still clock in
  // Mandatory documents every employee should upload (editable in Settings).
  requiredDocs: [
    'Government-issued ID (Aadhaar & PAN, or Passport)',
    'Recent passport-sized photographs',
    'Previous employment documents (offer / experience / resignation letters)',
    'Educational certificates and marksheets',
    'Last 2-3 salary slips (last 2 organizations)',
    'Cancelled cheque or bank account details',
    'Two contact numbers for reference check',
    'Emergency contact number',
  ],
  // Onboarding → account provisioning. When a new hire is onboarded, the
  // managers / account creators are notified to set up the accounts their
  // department requires. Editable in Settings. "default" applies to any
  // department not explicitly listed.
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
  // Leave
  leavePolicy: { casual: 7, sick: 7 }, // legacy; superseded by leaveTypes
  leaveTypes: [
    { code: 'casual', name: 'Casual Leave', quota: 7, paid: true },
    { code: 'sick', name: 'Sick Leave', quota: 7, paid: true },
    { code: 'unpaid', name: 'Unpaid Leave', quota: 0, paid: false },
  ],
  // Optional modules — admins can switch these on/off in Settings.
  modules: {
    directory: true, notices: true, holidays: true, recognition: true,
    performance: true, surveys: true, helpdesk: true, assets: true,
    loans: true, reimbursement: true, recruitment: true,
  },
  // Slack attendance integration (off until a bot token + channel are set).
  slack: {
    enabled: false,
    botToken: '',
    channelId: '',
    signingSecret: '',                 // for verifying real-time event webhooks (optional)
    presentKeywords: ['in', 'present', 'wfo', 'office', 'working', 'available', 'checking in', 'logged in'],
    wfhKeywords: ['wfh', 'work from home', 'remote', 'working from home', 'home'],
    halfKeywords: ['half day', 'half-day', 'halfday'],
    leaveKeywords: ['leave', 'off', 'ooo', 'sick', 'holiday', 'pto', 'vacation'],
    absentKeywords: ['absent', 'not available', 'na'],
    autoReact: true,                   // 👍 / ❌ react to attendance messages
    validReaction: 'thumbsup',         // emoji name (no colons) for valid attendance
    invalidReaction: 'x',              // emoji name for unrecognised messages
    notifyOnInvalid: true,             // reply in-thread asking them to mark properly
  },
  // Payroll
  payrollClosingDay: 30,
  payroll: {
    // 'calendar' = divide salary by total days in month,
    // 'working'  = divide by working days in month
    perDayBasis: 'working',
    deductAbsent: true,
    deductUnpaidLeave: true,
  },
  // Statutory deductions (India defaults; toggle/edit in Settings).
  statutory: {
    pf: { enabled: true, percent: 12, basisCap: 15000 },   // 12% of Basic, basic capped at 15000
    esi: { enabled: true, percent: 0.75, grossCap: 21000 }, // 0.75% of gross if gross <= 21000
    pt: { enabled: true, amount: 200 },                     // flat professional tax
  },
};

const settingsRow = db.prepare('SELECT data FROM settings WHERE id = 1').get();
if (!settingsRow) {
  db.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(
    JSON.stringify(defaultSettings)
  );
} else {
  // Merge in any new default keys added by upgrades, without losing saved values.
  const saved = JSON.parse(settingsRow.data);
  let changed = false;
  for (const k of Object.keys(defaultSettings)) {
    if (!(k in saved)) { saved[k] = defaultSettings[k]; changed = true; }
  }
  // Backfill new default department→account lists without clobbering admin edits.
  if (saved.departmentAccounts && typeof saved.departmentAccounts === 'object') {
    for (const dept of Object.keys(defaultSettings.departmentAccounts)) {
      if (!(dept in saved.departmentAccounts)) {
        saved.departmentAccounts[dept] = defaultSettings.departmentAccounts[dept];
        changed = true;
      }
    }
  }
  if (changed) db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(saved));
}

// ---- Seed default admin ----------------------------------------------------
const admin = config.defaultAdmin;
const existingAdmin = db
  .prepare('SELECT id FROM users WHERE email = ?')
  .get(admin.email);
if (!existingAdmin) {
  const hash = bcrypt.hashSync(admin.password, 10);
  db.prepare(
    'INSERT INTO users (email, password_hash, role, must_change) VALUES (?, ?, ?, 0)'
  ).run(admin.email, hash, 'SUPER_ADMIN');
  console.log(`Default admin ready: ${admin.email}`);
}

module.exports = db;
