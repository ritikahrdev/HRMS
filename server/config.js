const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Load .env file if it exists (optional, for local dev)
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key) process.env[key.trim()] = rest.join('=').trim();
  }
}

// Build config from environment variables and defaults
const config = {
  port: parseInt(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Session & security (required in production)
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-in-production',
  csrfSecret: process.env.CSRF_SECRET || 'dev-insecure-csrf-secret-change-in-production',
  requireHttps: process.env.REQUIRE_HTTPS === 'true' && process.env.NODE_ENV === 'production',

  // Default admin account (created on first run if no admin exists)
  defaultAdmin: {
    email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@company.local',
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe@12345', // Force change on first login in production
  },

  // Email service
  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'HR Team <noreply@company.local>',
  },

  // Public URL for email links
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${parseInt(process.env.PORT) || 4000}`).replace(/\/$/, ''),

  // Slack integration (optional)
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    channelId: process.env.SLACK_CHANNEL_ID || '',
    enabled: !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID),
  },
};

// File paths.
// DATA_DIR lets you point the database + uploads at a mounted persistent
// volume in production (e.g. /data on Render/Railway/Fly). Defaults to ./data.
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
config.paths = {
  root,
  data: dataDir,
  uploads: process.env.UPLOAD_DIR || path.join(dataDir, 'uploads'),
  db: process.env.DATABASE_PATH || path.join(dataDir, 'hr.db'),
};

// Create required directories
for (const dir of [config.paths.data, config.paths.uploads]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Warn if using insecure defaults in production
if (config.nodeEnv === 'production') {
  const warnings = [];
  if (config.sessionSecret.includes('dev-insecure')) warnings.push('SESSION_SECRET not set in environment');
  if (config.csrfSecret.includes('dev-insecure')) warnings.push('CSRF_SECRET not set in environment');
  if (config.defaultAdmin.password === 'ChangeMe@12345') warnings.push('DEFAULT_ADMIN_PASSWORD not changed from default');
  if (!process.env.PUBLIC_URL) warnings.push('PUBLIC_URL not set — email links may be incorrect');

  if (warnings.length > 0) {
    console.warn('⚠️  PRODUCTION SECURITY WARNINGS:');
    warnings.forEach(w => console.warn('   - ' + w));
    console.warn('   Set environment variables in .env or your hosting platform');
  }
}

module.exports = config;
