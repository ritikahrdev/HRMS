const express = require('express');
const { requirePerm, requireSuperAdmin } = require('../middleware/auth');
const { sendHolidayNotifications } = require('../services/holidayNotifications');

const router = express.Router();

// Manually trigger holiday notifications (HR/Super Admin only)
router.post('/send', requirePerm('settings:manage'), async (req, res) => {
  try {
    const result = await sendHolidayNotifications();
    res.json({
      ok: true,
      message: `Notified employees about ${result.notified} upcoming holiday(ies)`,
      holidays: result.holidays,
    });
  } catch (err) {
    console.error('Error sending holiday notifications:', err);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

module.exports = router;
