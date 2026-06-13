const express = require('express');
const { requirePerm } = require('../middleware/auth');
const { getSettings } = require('../services/settings');
const automation = require('../services/automation');

const router = express.Router();

// What the automation engine does, its toggles, and the last run (HR view).
router.get('/status', requirePerm('settings:manage'), (req, res) => {
  const s = getSettings();
  res.json({
    automation: s.automation || {},
    state: s.automationState || {},
    today: automation.companyToday(),
    timezone: s.timezone || 'Asia/Kolkata',
  });
});

// Run all of today's automations now (HR/Super Admin).
router.post('/run', requirePerm('settings:manage'), async (req, res) => {
  try {
    const result = await automation.runDailyAutomations({ force: true });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Preview / send the "you haven't marked attendance" reminder right now. Returns
// who is still unmarked and whether it could actually post to Slack.
router.post('/remind', requirePerm('settings:manage'), async (req, res) => {
  try {
    const result = await automation.sendUnmarkedReminders({ force: true });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
