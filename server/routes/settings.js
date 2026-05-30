const express = require('express');
const { requirePerm, requireSuperAdmin } = require('../middleware/auth');
const { getSettings, saveSettings } = require('../services/settings');
const { upload } = require('../services/upload');
const { ROLES, ROLE_LABELS, ALL_PERMISSIONS, effectivePermissions } = require('../services/permissions');

const router = express.Router();

router.get('/access', requireSuperAdmin, (req, res) => {
  const matrix = {};
  for (const r of ROLES) matrix[r] = effectivePermissions(r);
  res.json({ permissions: ALL_PERMISSIONS, roles: ROLES, labels: ROLE_LABELS, matrix });
});

router.put('/access', requireSuperAdmin, async (req, res) => {
  try {
    const incoming = (req.body && req.body.rolePermissions) || {};
    const valid = new Set(ALL_PERMISSIONS.map((p) => p.key));
    const clean = {};
    for (const role of ROLES) {
      if (role === 'SUPER_ADMIN') continue;
      if (Array.isArray(incoming[role])) clean[role] = incoming[role].filter((p) => valid.has(p));
    }
    await saveSettings({ rolePermissions: clean });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/public', async (req, res) => {
  try {
    const s = await getSettings();
    res.json({ companyName: s.companyName, logoFile: s.logoFile, currency: s.currency, modules: s.modules || {}, requiredDocs: s.requiredDocs || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/', requirePerm('settings:manage'), async (req, res) => {
  try { res.json({ settings: await getSettings() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', requirePerm('settings:manage'), async (req, res) => {
  try {
    const allowed = [
      'companyName', 'legalName', 'address', 'gst', 'cin', 'pan', 'email', 'phone',
      'website', 'currency', 'slipFooter', 'workStart', 'workEnd', 'workingDays',
      'weekendPolicy', 'fullDayHours', 'halfDayHours', 'graceMinutes', 'leavePolicy',
      'payrollClosingDay', 'payroll', 'statutory', 'attendanceSheetUrl',
      'leaveTypes', 'modules', 'slack', 'requiredDocs', 'uidaiCert',
    ];
    const partial = {};
    for (const k of allowed) if (k in req.body) partial[k] = req.body[k];
    res.json({ settings: await saveSettings(partial) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/logo', requirePerm('settings:manage'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const s = await saveSettings({ logoFile: req.file.filename });
    res.json({ logoFile: s.logoFile });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
