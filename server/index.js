const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db'); // Postgres adapter — schema/seed run via db.init() at startup
const { sendFile } = require('./services/filestore');

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

// Public pre-boarding portal page (no login). A candidate opens this with a
// private token to fill their joining form & upload documents before Day 1.
app.get('/preboard/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'preboard.html'));
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const port = config.port || 4000;

// Initialise the database (create schema + seed + warm caches) BEFORE listening.
(async () => {
  try {
    await db.init();
    // Best-effort: bring leave accrual up to date for the current year on boot.
    require('./services/leaveAccrual').autoCatchUp();
    app.listen(port, () => {
      console.log('\n==============================================');
      console.log('  HR Software is running!');
      console.log(`  Open your browser at:  http://localhost:${port}`);
      console.log(`  Admin login: ${config.defaultAdmin.email}`);
      console.log('==============================================\n');
    });
  } catch (e) {
    console.error('❌ Failed to start — database init error:', e.message);
    process.exit(1);
  }
})();
