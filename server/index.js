const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');

require('./db'); // initialise schema + seed

const app = express();

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

// ============ Body Parser & Session ============
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
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
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/recruitment', require('./routes/recruitment'));

// Serve uploaded logo (read-only) for branding.
// Includes path traversal protection.
app.get('/uploads/:file', (req, res) => {
  const name = path.basename(req.params.file);
  const filePath = path.resolve(path.join(config.paths.uploads, name));

  // Verify the resolved path is within the uploads directory
  const uploadsDir = path.resolve(config.paths.uploads);
  if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.sendFile(filePath, (err) => {
    if (err) res.status(404).end();
  });
});

// Frontend (no build step).
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const port = config.port || 4000;
app.listen(port, () => {
  console.log('\n==============================================');
  console.log('  HR Software is running!');
  console.log(`  Open your browser at:  http://localhost:${port}`);
  console.log(`  Admin login: ${config.defaultAdmin.email}`);
  console.log('==============================================\n');
});
