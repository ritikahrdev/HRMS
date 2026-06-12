// Load .env into process.env (no external dependency). Host/OS env vars take
// precedence, so this only fills what isn't already set — and is a no-op in
// production (Render injects env vars directly; there's no .env file there).
// This must run BEFORE any module that reads process.env (config, db, pg).
(function loadDotEnv() {
  try {
    const fs = require('fs');
    const p = require('path').join(__dirname, '..', '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('=');
      if (i < 1) continue;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch (e) { /* ignore — fall back to OS env */ }
})();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db'); // Postgres adapter — schema/seed run via db.init() at startup
const { sendFile } = require('./services/filestore');

// --- Crash-proofing -------------------------------------------------------
// Express 4 does NOT forward a rejected promise from an async route handler to
// the error middleware; it becomes an unhandledRejection and, on modern Node,
// kills the process. That means one malformed request (e.g. a non-numeric :id
// reaching Postgres) could take the whole server down. Patch the router Layer
// so async rejections are forwarded to next(err) → the central error handler.
const Layer = require('express/lib/router/layer');
const _handleRequest = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  const fn = this.handle;
  if (fn && !fn.__asyncWrapped && typeof fn === 'function' && fn.length < 4) {
    const wrapped = function (rq, rs, nx) {
      let out;
      try { out = fn.call(this, rq, rs, nx); } catch (e) { return nx(e); }
      if (out && typeof out.then === 'function') out.catch(nx);
      return out;
    };
    wrapped.__asyncWrapped = true;
    this.handle = wrapped;
  }
  return _handleRequest.call(this, req, res, next);
};

// Last-resort backstops: even if something slips past the above, log and keep
// the process alive instead of crashing the whole HRMS for every user.
process.on('unhandledRejection', (reason) => console.error('UnhandledRejection:', reason));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));

const app = express();

// Behind a hosting proxy (Railway/Render/Fly), trust the first proxy hop so
// req.ip, rate limiting, and secure cookies use the real client connection.
app.set('trust proxy', 1);

// ============ Security Middleware ============
// Helmet: sets security headers (X-Frame-Options, X-Content-Type-Options, etc.)
app.use(helmet());

// Rate limiting: prevent brute force attacks on login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP per windowMs
  message: 'Too many login attempts, please try again later',
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  skip: (req) => config.nodeEnv !== 'production', // Don't rate limit in development
});

// General API rate limiter (lighter than login)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per IP per windowMs
  skip: (req) => config.nodeEnv !== 'production',
});

// Slack Events webhook needs the RAW request body for signature verification,
// so it must be mounted BEFORE the JSON parser consumes the stream.
app.use('/api/slack', require('./routes/slack'));

// ============ Body Parser & Session ============
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new pgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: true }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.requireHttps || false, // Set to true if HTTPS is enforced
      sameSite: 'strict',
      maxAge: parseInt(process.env.SESSION_MAX_AGE) || (1000 * 60 * 60 * 8), // 8 hours
    },
  })
);

// Apply general rate limiter to all API routes
app.use('/api/', apiLimiter);

// Daily automation tick (birthdays, anniversaries, holiday reminders, leave
// accrual, year-end carry-forward, optional Slack sync). Fires on API activity
// but an in-memory date-guard means the real work runs at most once per day
// (the free tier has no cron).
const automation = require('./services/automation');
app.use('/api/', (req, res, next) => { automation.dailyTick(); next(); });

// Public health/heartbeat endpoint — point a free uptime pinger (e.g.
// cron-job.org) at this to keep the free server awake AND guarantee the daily
// automations fire even on a day nobody logs in.
app.get('/api/health', (req, res) => { automation.dailyTick(); res.json({ ok: true, time: new Date().toISOString() }); });

// Scheduler hook — an external cron (the committed GitHub Actions workflow, or
// any uptime pinger) calls this daily so the HR chores (birthday & anniversary
// wishes, holiday reminders, leave accrual, year-end carry-forward) run even
// when nobody opens the app. Every chore is idempotent, so extra calls are
// harmless. Optionally lock it down by setting CRON_KEY in the environment and
// passing ?key=<value>.
app.get('/api/cron/run', async (req, res) => {
  if (process.env.CRON_KEY && req.query.key !== process.env.CRON_KEY) {
    return res.status(403).json({ error: 'Invalid cron key.' });
  }
  try {
    const result = await automation.runDailyAutomations();
    res.json({ ok: true, ranAt: new Date().toISOString(), ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Middleware to attach loginLimiter to req so auth route can use it
const attachLoginLimiter = (req, res, next) => {
  req.loginLimiter = loginLimiter;
  next();
};

// API routes
app.use('/api/auth', attachLoginLimiter, require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/import', require('./routes/importEmployees'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leave', require('./routes/leave'));
app.use('/api/reimbursement', require('./routes/reimbursement'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/actions', require('./routes/actions'));
app.use('/api/holidays', require('./routes/holidays'));
app.use('/api/holiday-notifications', require('./routes/holiday-notifications'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/kudos', require('./routes/kudos'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/surveys', require('./routes/surveys'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/recruitment', require('./routes/recruitment'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/mood', require('./routes/mood'));
app.use('/api/preboard', require('./routes/preboard'));
app.use('/api/offboarding', require('./routes/offboarding'));
app.use('/api/timesheets', require('./routes/timesheets'));
app.use('/api/birthdays', require('./routes/birthdays'));
app.use('/api/automation', require('./routes/automation'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/careers', require('./routes/careers'));

// --- Numeric id guard -----------------------------------------------------
// All :id / :employeeId / :docId / :taskId / :jobId / :applicantId params map
// to integer primary keys. A non-numeric value (e.g. /api/employees/abc) would
// otherwise reach Postgres and throw an "invalid input syntax for integer"
// error → an ugly 500. Register a param validator on EVERY mounted router so
// any non-positive-integer id returns a clean 404 instead. (app.param does not
// propagate to sub-routers, so we walk the router stack and register on each.)
(function installIdGuards() {
  const NUMERIC_PARAMS = ['id', 'employeeId', 'docId', 'taskId', 'jobId', 'applicantId', 'goalId', 'reviewId'];
  const guard = (req, res, next, val) => {
    if (!/^[1-9][0-9]{0,17}$/.test(String(val))) return res.status(404).json({ error: 'Not found.' });
    next();
  };
  const stack = (app._router && app._router.stack) || [];
  for (const layer of stack) {
    const r = layer.handle;
    if (r && typeof r.param === 'function' && Array.isArray(r.stack)) {
      for (const name of NUMERIC_PARAMS) r.param(name, guard);
    }
  }
})();

// Public pre-boarding portal page (no login). A candidate opens this with a
// private token to fill their joining form & upload documents before Day 1.
app.get('/preboard/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'preboard.html'));
});

// Public careers page (no login) — the shareable "apply here" link for job
// posts on LinkedIn or anywhere else.
app.get('/careers', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'careers.html'));
});

// Serve uploaded logo (read-only) for branding.
// Includes path traversal protection.
app.get('/uploads/:file', async (req, res) => {
  await sendFile(res, req.params.file);
});

// Frontend (no build step). Disable caching so code updates always load fresh.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

// Central error handler. Map common Postgres input errors to a clean 400 so a
// malformed value (non-numeric id, oversized number, bad date, null byte)
// returns a friendly response instead of a 500.
app.use((err, req, res, next) => {
  console.error(err);
  const code = err && err.code;
  // Body-parser / client errors carry an explicit status (e.g. malformed JSON → 400).
  if (err && (err.status || err.statusCode) && (err.status || err.statusCode) < 500) {
    return res.status(err.status || err.statusCode).json({ error: 'Invalid request.' });
  }
  if (['22P02', '22007', '22008', '22021', '22023'].includes(code)) {
    return res.status(400).json({ error: 'Invalid input.' });
  }
  if (code === '22003') return res.status(400).json({ error: 'A value is out of the allowed range.' });
  res.status(500).json({ error: (err && err.message) || 'Server error' });
});

const port = config.port || 4000;

// Initialise the database (create schema + seed + warm caches) BEFORE listening.
(async () => {
  try {
    await db.init();
    // Best-effort: run the day's automations on boot/wake (birthdays,
    // anniversaries, holiday reminders, leave accrual, carry-forward, etc.).
    require('./services/automation').dailyTick();
    app.listen(port, '0.0.0.0', () => {
      // List this machine's LAN/WiFi IPv4 addresses so the server is reachable
      // from other devices on the same network (e.g. for webhook testing).
      const os = require('os');
      const lan = [];
      for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const i of ifaces || []) if (i.family === 'IPv4' && !i.internal) lan.push(i.address);
      }
      // Prefer a real home/office WiFi address (192.168.x) for the convenience
      // line, ahead of virtual adapters (Hyper-V/WSL are usually 172.x).
      const rank = (ip) => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 3 : 2;
      lan.sort((a, b) => rank(a) - rank(b));
      const net = lan[0] || 'localhost';
      console.log('\n==============================================');
      console.log('  HR Software is running!');
      console.log(`  Local:    http://localhost:${port}`);
      for (const ip of lan) console.log(`  Network:  http://${ip}:${port}`);
      console.log(`  Webhook:  http://${net}:${port}/api/webhook/attendance`);
      console.log(`  Admin login: ${config.defaultAdmin.email}`);
      console.log('==============================================\n');
    });
  } catch (e) {
    console.error('❌ Failed to start — database init error:', e.message);
    process.exit(1);
  }
})();
