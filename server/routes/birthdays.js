const express = require('express');
const { requirePerm } = require('../middleware/auth');
const { sendTodaysBirthdayWishes, companyToday } = require('../services/birthdayWishes');
const db = require('../db');

const router = express.Router();

// Who has a birthday today (HR preview).
router.get('/today', requirePerm('settings:manage'), async (req, res) => {
  try {
    const today = companyToday();
    const mmdd = today.slice(5);
    const emps = await db.prepare(
      "SELECT name, email, dob FROM employees WHERE status='active' AND dob IS NOT NULL AND dob <> ''"
    ).all();
    const list = emps.filter((e) => String(e.dob).slice(5, 10) === mmdd).map((e) => ({ name: e.name, email: e.email }));
    res.json({ date: today, birthdays: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manually run today's birthday wishes now (HR/Super Admin).
router.post('/send', requirePerm('settings:manage'), async (req, res) => {
  try {
    const result = await sendTodaysBirthdayWishes();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
