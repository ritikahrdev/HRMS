const express = require('express');
const db = require('../db');
const { requirePerm, requireSuperAdmin } = require('../middleware/auth');
const { getSettings, saveSettings } = require('../services/settings');
const { upload } = require('../services/upload');
const { ROLES, ROLE_LABELS, ALL_PERMISSIONS, effectivePermissions } = require('../services/permissions');

const router = express.Router();

// Access-control matrix (Super Admin only) — catalogue + current per-role perms.
router.get('/access', requireSuperAdmin, (req, res) => {
  const matrix = {};
  for (const r of ROLES) matrix[r] = effectivePermissions(r);
  res.json({ permissions: ALL_PERMISSIONS, roles: ROLES, labels: ROLE_LABELS, matrix });
});

// Save the per-role permission overrides (Super Admin only).
router.put('/access', requireSuperAdmin, (req, res) => {
  const incoming = (req.body && req.body.rolePermissions) || {};
  const valid = new Set(ALL_PERMISSIONS.map((p) => p.key));
  const clean = {};
  for (const role of ROLES) {
    if (role === 'SUPER_ADMIN') continue; // always full access; never editable
    if (Array.isArray(incoming[role])) {
      clean[role] = incoming[role].filter((p) => valid.has(p));
    }
  }
  saveSettings({ rolePermissions: clean });
  res.json({ ok: true });
});

// Public branding (used on the login screen): only safe fields.
router.get('/public', (req, res) => {
  const s = getSettings();
  res.json({ companyName: s.companyName, logoFile: s.logoFile, currency: s.currency, modules: s.modules || {}, requiredDocs: s.requiredDocs || [] });
});

// Full settings.
router.get('/', requirePerm('settings:manage'), (req, res) => {
  res.json({ settings: getSettings() });
});

router.put('/', requirePerm('settings:manage'), (req, res) => {
  const allowed = [
    'companyName', 'legalName', 'address', 'gst', 'cin', 'pan', 'email', 'phone',
    'website', 'currency', 'slipFooter', 'workStart', 'workEnd', 'workingDays',
    'weekendPolicy', 'fullDayHours', 'halfDayHours', 'graceMinutes', 'attendanceCloseTime', 'leavePolicy',
    'payrollClosingDay', 'payroll', 'statutory', 'attendanceSheetUrl',
    'leaveTypes', 'modules', 'slack', 'requiredDocs', 'uidaiCert', 'webhookSecret',
  ];
  const partial = {};
  for (const k of allowed) if (k in req.body) partial[k] = req.body[k];
  res.json({ settings: saveSettings(partial) });
});

// Logo upload.
router.post('/logo', requirePerm('settings:manage'), upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const s = saveSettings({ logoFile: req.file.filename });
  res.json({ logoFile: s.logoFile });
});

module.exports = router;
