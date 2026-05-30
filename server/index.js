const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db');

const app = express();

// ============ Security Middleware ============
app.use(helmet());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv !== 'production',
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  skip: () => config.nodeEnv !== 'production',
});

// ============ Body Parser & Session ============
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.requireHttps || false,
    sameSite: 'strict',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || (1000 * 60 * 60 * 8),
  },
}));

app.use('/api/', apiLimiter);

const attachLoginLimiter = (req, res, next) => { req.loginLimiter = loginLimiter; next(); };

// ============ API Routes ============
app.use('/api/auth',        attachLoginLimiter, require('./routes/auth'));
app.use('/api/employees',   require('./routes/employees'));
app.use('/api/import',      require('./routes/importEmployees'));
app.use('/api/attendance',  require('./routes/attendance'));
app.use('/api/leave',       require('./routes/leave'));
app.use('/api/reimbursement', require('./routes/reimbursement'));
app.use('/api/payroll',     require('./routes/payroll'));
app.use('/api/settings',    require('./routes/settings'));
app.use('/api/reports',     require('./routes/reports'));
app.use('/api/actions',     require('./routes/actions'));
app.use('/api/holidays',    require('./routes/holidays'));
app.use('/api/holiday-notifications', require('./routes/holiday-notifications'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/assets',      require('./routes/assets'));
app.use('/api/loans',       require('./routes/loans'));
app.use('/api/kudos',       require('./routes/kudos'));
app.use('/api/goals',       require('./routes/goals'));
app.use('/api/reviews',     require('./routes/reviews'));
app.use('/api/surveys',     require('./routes/surveys'));
app.use('/api/tickets',     require('./routes/tickets'));
app.use('/api/onboarding',  require('./routes/onboarding'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/recruitment', require('./routes/recruitment'));
app.use('/api/inventory',   require('./routes/inventory'));

// Serve uploaded files
app.get('/uploads/:file', (req, res) => {
  const name = path.basename(req.params.file);
  const filePath = path.resolve(path.join(config.paths.uploads, name));
  const uploadsDir = path.resolve(config.paths.uploads);
  if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.sendFile(filePath, (err) => { if (err) res.status(404).end(); });
});

// Frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// ============ Startup ============
async function start() {
  try {
    console.log('Connecting to PostgreSQL (Neon)...');
    await db.init();
    console.log('✅ Database ready.');

    const port = config.port || 4000;
    app.listen(port, () => {
      console.log('\n==============================================');
      console.log('  Hrika HRMS is running!');
      console.log(`  Open your browser:  http://localhost:${port}`);
      console.log(`  Admin login:        ${config.defaultAdmin.email}`);
      console.log('==============================================\n');
    });
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
}

start();
