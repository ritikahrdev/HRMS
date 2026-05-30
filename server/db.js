const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_sWp7kGNy5icD@ep-super-night-aq3o64ck-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({ connectionString: DATABASE_URL });

// ISO timestamp expression used as a column default (PostgreSQL).
const NOW_ISO = `to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

// ---------------------------------------------------------------------------
// SQL translation helpers
// ---------------------------------------------------------------------------

/**
 * Converts SQLite-style SQL into PostgreSQL-compatible SQL.
 *
 * Transformations applied:
 *  1. datetime('now') → PostgreSQL UTC ISO string expression
 *  2. INSERT OR IGNORE INTO tablename → INSERT INTO tablename ... ON CONFLICT DO NOTHING
 *     (the ON CONFLICT clause is appended before any RETURNING clause, or at end)
 *  3. ? positional params → $1, $2, $3 …
 *  4. @name named params are left in the SQL as markers – resolved separately in
 *     translateNamedParams().
 *  5. substr( → substring(
 */
function translateSQL(sql) {
  let s = sql;

  // 1. datetime('now')
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, NOW_ISO);

  // 2. INSERT OR IGNORE INTO
  let insertOrIgnore = false;
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO\b/gi, (match) => {
    insertOrIgnore = true;
    return 'INSERT INTO';
  });

  // 3. substr( → substring(
  s = s.replace(/\bsubstr\s*\(/gi, 'substring(');

  // 4. ? → $1, $2, …
  let paramIndex = 0;
  s = s.replace(/\?/g, () => `$${++paramIndex}`);

  // 5. Append ON CONFLICT DO NOTHING for INSERT OR IGNORE
  if (insertOrIgnore) {
    // Insert before any RETURNING clause (case-insensitive), otherwise at end.
    if (/\bRETURNING\b/i.test(s)) {
      s = s.replace(/\bRETURNING\b/i, 'ON CONFLICT DO NOTHING RETURNING');
    } else {
      s = s.trimEnd();
      if (s.endsWith(';')) {
        s = s.slice(0, -1).trimEnd() + ' ON CONFLICT DO NOTHING;';
      } else {
        s += ' ON CONFLICT DO NOTHING';
      }
    }
  }

  return s;
}

/**
 * Converts @name style named params into $N positional params and builds the
 * values array from the provided object.
 *
 * Returns { sql, values }.
 */
function translateNamedParams(sql, obj) {
  const values = [];
  const sql2 = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    values.push(obj[name] !== undefined ? obj[name] : null);
    return `$${values.length}`;
  });
  return { sql: sql2, values };
}

/**
 * Appends RETURNING id to an INSERT statement (before the semicolon if present).
 * Used by db.run() so callers can read result.lastInsertRowid.
 */
function appendReturningId(sql) {
  const trimmed = sql.trimEnd();
  // If it already has a RETURNING clause, leave it alone.
  if (/\bRETURNING\b/i.test(trimmed)) return sql;
  if (!/^\s*INSERT\b/i.test(trimmed)) return sql;
  if (trimmed.endsWith(';')) {
    return trimmed.slice(0, -1).trimEnd() + ' RETURNING id;';
  }
  return trimmed + ' RETURNING id';
}

// ---------------------------------------------------------------------------
// db compatibility shim
// ---------------------------------------------------------------------------

/**
 * db.prepare(sql) returns a statement-like object with three async methods:
 *
 *   .all(...args)  – returns an array of rows
 *   .get(...args)  – returns the first row or undefined
 *   .run(...args)  – executes (with RETURNING id for INSERTs) and returns
 *                    { lastInsertRowid, changes }
 *
 * args can be:
 *   - nothing / a single array  → positional $1…$N params
 *   - spread positional values  → positional $1…$N params
 *   - a single plain object     → @name named params
 */
function prepare(originalSql) {
  return {
    async all(...args) {
      const { sql, values } = resolveArgs(translateSQL(originalSql), args);
      const result = await pool.query(sql, values);
      return result.rows;
    },

    async get(...args) {
      const { sql, values } = resolveArgs(translateSQL(originalSql), args);
      const result = await pool.query(sql, values);
      return result.rows[0];
    },

    async run(...args) {
      const translatedSql = appendReturningId(translateSQL(originalSql));
      const { sql, values } = resolveArgs(translatedSql, args);
      const result = await pool.query(sql, values);
      const lastInsertRowid =
        result.rows && result.rows.length > 0 ? result.rows[0].id : null;
      const changes = result.rowCount || 0;
      return { lastInsertRowid, changes };
    },
  };
}

/**
 * Resolves args into { sql, values } handling three calling conventions:
 *   1. Single plain object arg → named @param style
 *   2. Single array arg        → positional values (already $N in sql)
 *   3. Spread positional args  → positional values
 */
function resolveArgs(sql, args) {
  if (args.length === 0) {
    return { sql, values: [] };
  }
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === 'object' &&
    !Array.isArray(args[0])
  ) {
    // Named params object
    return translateNamedParams(sql, args[0]);
  }
  if (args.length === 1 && Array.isArray(args[0])) {
    return { sql, values: args[0] };
  }
  // Spread positional
  return { sql, values: args };
}

/**
 * db.exec(sql) – runs multi-statement DDL/DML sequentially.
 * Splits on semicolons, ignoring empty statements.
 */
async function exec(sql) {
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await pool.query(translateSQL(stmt));
  }
}

/**
 * db.run(sql, ...args) – convenience shorthand (used occasionally in legacy code).
 */
async function run(sql, ...args) {
  return prepare(sql).run(...args);
}

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'EMPLOYEE',
  must_change   INTEGER NOT NULL DEFAULT 0,
  permissions   TEXT,
  created_at    TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS employees (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  emp_code        TEXT UNIQUE,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  department      TEXT,
  designation     TEXT,
  date_of_joining TEXT,
  monthly_salary  REAL NOT NULL DEFAULT 0,
  manager         TEXT,
  manager_id      INTEGER,
  bank_account    TEXT,
  ifsc            TEXT,
  pan             TEXT,
  address         TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT DEFAULT ${NOW_ISO},
  dob             TEXT,
  gender          TEXT,
  emergency_name  TEXT,
  emergency_phone TEXT,
  aadhaar         TEXT,
  education       TEXT,
  experience      TEXT,
  blood_group     TEXT,
  slack_id        TEXT,
  salary_structure TEXT
);

CREATE TABLE IF NOT EXISTS attendance (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  check_in    TEXT,
  check_out   TEXT,
  work_hours  REAL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'present',
  late_minutes REAL DEFAULT 0,
  ot_hours    REAL DEFAULT 0,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL,
  days        REAL NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER REFERENCES users(id),
  comment     TEXT,
  applied_at  TEXT DEFAULT ${NOW_ISO},
  decided_at  TEXT,
  half_day    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reimbursements (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  category    TEXT,
  amount      REAL NOT NULL,
  bill_file   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  approver_id INTEGER REFERENCES users(id),
  comment     TEXT,
  applied_at  TEXT DEFAULT ${NOW_ISO},
  decided_at  TEXT
);

CREATE TABLE IF NOT EXISTS payslips (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month          TEXT NOT NULL,
  base_salary    REAL NOT NULL,
  working_days   REAL NOT NULL,
  present_days   REAL NOT NULL,
  paid_leave     REAL NOT NULL,
  unpaid_days    REAL NOT NULL,
  paid_days      REAL NOT NULL,
  per_day        REAL NOT NULL,
  gross          REAL NOT NULL,
  deductions     REAL NOT NULL,
  reimbursements REAL NOT NULL DEFAULT 0,
  net_salary     REAL NOT NULL,
  generated_at   TEXT DEFAULT ${NOW_ISO},
  breakup        TEXT,
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS settings (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id         SERIAL PRIMARY KEY,
  to_addr    TEXT,
  subject    TEXT,
  status     TEXT,
  error      TEXT,
  body       TEXT,
  created_at TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id               SERIAL PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  requested_status TEXT,
  requested_in     TEXT,
  requested_out    TEXT,
  reason           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  approver_id      INTEGER REFERENCES users(id),
  comment          TEXT,
  applied_at       TEXT DEFAULT ${NOW_ISO},
  decided_at       TEXT
);

CREATE TABLE IF NOT EXISTS holidays (
  id   SERIAL PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'public'
);

CREATE TABLE IF NOT EXISTS announcements (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT,
  created_by INTEGER REFERENCES users(id),
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS assets (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  tag         TEXT,
  category    TEXT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'available',
  notes       TEXT,
  assigned_at TEXT,
  created_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  file        TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT DEFAULT ${NOW_ISO},
  doc_type    TEXT,
  status      TEXT,
  verify_note TEXT,
  verified_at TEXT,
  verified_by INTEGER
);

CREATE TABLE IF NOT EXISTS loans (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'loan',
  title       TEXT,
  amount      REAL NOT NULL,
  emi         REAL NOT NULL DEFAULT 0,
  balance     REAL,
  status      TEXT NOT NULL DEFAULT 'active',
  notes       TEXT,
  created_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  month       TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'draft',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  updated_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS comp_off_credits (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  days        REAL NOT NULL DEFAULT 1,
  reason      TEXT,
  granted_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS kudos (
  id          SERIAL PRIMARY KEY,
  from_user   INTEGER REFERENCES users(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  badge       TEXT,
  message     TEXT NOT NULL,
  cheers      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS goals (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  target_date TEXT,
  progress    INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS reviews (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,
  reviewer_id INTEGER REFERENCES users(id),
  rating      INTEGER,
  strengths   TEXT,
  improvements TEXT,
  status      TEXT NOT NULL DEFAULT 'submitted',
  created_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS surveys (
  id                  SERIAL PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT,
  questions           TEXT NOT NULL,
  active              INTEGER NOT NULL DEFAULT 1,
  anonymous           INTEGER NOT NULL DEFAULT 0,
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT DEFAULT ${NOW_ISO},
  category            TEXT DEFAULT 'engagement',
  deadline            TEXT,
  target_department   TEXT,
  target_manager_id   INTEGER,
  response_required   INTEGER DEFAULT 0,
  show_results        INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id          SERIAL PRIMARY KEY,
  survey_id   INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  answers     TEXT NOT NULL,
  created_at  TEXT DEFAULT ${NOW_ISO},
  UNIQUE (survey_id, employee_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category    TEXT,
  subject     TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  assigned_to INTEGER REFERENCES users(id),
  resolution  TEXT,
  created_at  TEXT DEFAULT ${NOW_ISO},
  updated_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS jobs (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  department     TEXT,
  location       TEXT,
  type           TEXT,
  description    TEXT,
  skills         TEXT,
  min_experience REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'open',
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS applicants (
  id               SERIAL PRIMARY KEY,
  job_id           INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  experience_years REAL NOT NULL DEFAULT 0,
  skills           TEXT,
  resume_file      TEXT,
  source           TEXT,
  stage            TEXT NOT NULL DEFAULT 'applied',
  score            INTEGER,
  notes            TEXT,
  created_at       TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS interviews (
  id               SERIAL PRIMARY KEY,
  applicant_id     INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  round            TEXT,
  scheduled_at     TEXT,
  interviewer      TEXT,
  interviewer_email TEXT,
  mode             TEXT,
  status           TEXT NOT NULL DEFAULT 'scheduled',
  feedback         TEXT,
  created_at       TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS kudos_reactions (
  id         SERIAL PRIMARY KEY,
  kudos_id   INTEGER NOT NULL REFERENCES kudos(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW_ISO},
  UNIQUE (kudos_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT ${NOW_ISO}
);

CREATE TABLE IF NOT EXISTS inventory (
  id             SERIAL PRIMARY KEY,
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
  created_at     TEXT DEFAULT ${NOW_ISO},
  updated_at     TEXT DEFAULT ${NOW_ISO}
);
`;

// ---------------------------------------------------------------------------
// Default settings
// ---------------------------------------------------------------------------

const defaultSettings = {
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
  slipFooter: 'This is a computer-generated payslip.',
  workStart: '09:30',
  workEnd: '18:30',
  workingDays: [1, 2, 3, 4, 5],
  weekendPolicy: 'sat-sun',
  attendanceSheetUrl: '',
  fullDayHours: 9,
  halfDayHours: 4.5,
  graceMinutes: 30,
  requiredDocs: [
    'Government-issued ID (Aadhaar & PAN, or Passport)',
    'Recent passport-sized photographs',
    'Previous employment documents',
    'Educational certificates',
    'Last 2-3 salary slips',
    'Cancelled cheque or bank account details',
    'Two reference contacts',
    'Emergency contact number',
  ],
  leavePolicy: { casual: 7, sick: 7 },
  leaveTypes: [
    { code: 'casual', name: 'Casual Leave', quota: 7, paid: true },
    { code: 'sick', name: 'Sick Leave', quota: 7, paid: true },
    { code: 'earned', name: 'Earned Leave', quota: 15, paid: true },
    { code: 'unpaid', name: 'Unpaid Leave', quota: 0, paid: false },
  ],
  modules: {
    reimbursement: true,
    recruitment: true,
    assets: true,
    loans: true,
    notices: true,
    holidays: true,
    recognition: true,
    performance: true,
    surveys: true,
    helpdesk: true,
    directory: true,
  },
  slack: {
    botToken: '',
    channelId: '',
    enabled: false,
    leaveKeywords: ['leave', 'absent', 'wfh'],
    halfKeywords: ['half day', 'half-day'],
  },
};

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedInventory() {
  const items = [
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

  // Only seed if table is empty
  const countRes = await pool.query('SELECT COUNT(*) AS n FROM inventory');
  if (parseInt(countRes.rows[0].n) === 0) {
    for (const it of items) {
      await pool.query(
        `INSERT INTO inventory (name, category, quantity, available, condition, purchase_price, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        it
      );
    }
  }
}

// ---------------------------------------------------------------------------
// db.init() – create schema + seed data
// ---------------------------------------------------------------------------

async function init() {
  // Run schema DDL statements one by one
  const statements = SCHEMA_SQL.split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await pool.query(stmt);
  }

  // Seed inventory
  await seedInventory();

  // Seed default settings
  const settingsRow = await pool.query('SELECT data FROM settings WHERE id = 1');
  if (settingsRow.rows.length === 0) {
    await pool.query(
      'INSERT INTO settings (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [1, JSON.stringify(defaultSettings)]
    );
  } else {
    const saved = JSON.parse(settingsRow.rows[0].data);
    let changed = false;
    for (const k of Object.keys(defaultSettings)) {
      if (!(k in saved)) {
        saved[k] = defaultSettings[k];
        changed = true;
      }
    }
    if (changed) {
      await pool.query('UPDATE settings SET data = $1 WHERE id = 1', [
        JSON.stringify(saved),
      ]);
    }
  }

  // Seed default admin
  const adminEmail =
    process.env.DEFAULT_ADMIN_EMAIL || 'admin@company.local';
  const adminPassword =
    process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe@12345';

  const existingAdmin = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    [adminEmail]
  );
  if (existingAdmin.rows.length === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, role, must_change) VALUES ($1, $2, $3, 0)',
      [adminEmail, hash, 'SUPER_ADMIN']
    );
    console.log(`Default admin ready: ${adminEmail}`);
  }
}

// ---------------------------------------------------------------------------
// Exported db object
// ---------------------------------------------------------------------------

const db = {
  prepare,
  exec,
  run,
  init,
  // Expose the raw pool for callers that need it directly.
  pool,
};

module.exports = db;
