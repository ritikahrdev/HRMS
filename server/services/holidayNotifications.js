const db = require('../db');
const { sendMail } = require('./email');
const { postToSlack } = require('./slackSync');
const { getSettings } = require('./settings');

function getHolidayTypeStyle(type) {
  const styles = {
    public:     { icon: '🇮🇳', color: '#fbbf24', desc: 'National Holiday',          message: 'A national holiday is coming up!', emoji: '🎉' },
    restricted: { icon: '🎭', color: '#a78bfa', desc: 'Regional/Cultural Holiday',  message: 'Mark your calendar for this cultural celebration!', emoji: '🎊' },
    company:    { icon: '🏢', color: '#60a5fa', desc: 'Company Holiday',             message: 'Our company holiday is coming up! Enjoy some well-deserved rest.', emoji: '🌟' },
  };
  return styles[type] || styles['public'];
}

async function sendHolidayNotifications(specificDate) {
  try {
    let upcomingHolidays;
    if (specificDate) {
      const h = await db.prepare('SELECT * FROM holidays WHERE date = ?').get(specificDate);
      upcomingHolidays = h ? [h] : [];
    } else {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const sevenDaysLater = new Date(today); sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
      upcomingHolidays = await db.prepare('SELECT * FROM holidays WHERE date >= ? AND date <= ? ORDER BY date ASC')
        .all(today.toISOString().split('T')[0], sevenDaysLater.toISOString().split('T')[0]);
    }
    if (!upcomingHolidays.length) return { notified: 0, holidays: [] };

    const employees = await db.prepare("SELECT id, name, email FROM employees WHERE status='active' AND email IS NOT NULL").all();
    const settings = await getSettings();
    let notified = 0;

    for (const holiday of upcomingHolidays) {
      const style = getHolidayTypeStyle(holiday.type);
      const dateObj = new Date(holiday.date + 'T00:00:00');
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const slackMessage = `${style.emoji} *${holiday.name}* (${dayName})\n${style.message}\n_Type: ${style.desc}_`;
      await postToSlack(slackMessage).catch(() => {});
      if (employees.length > 0) {
        const emails = employees.map((e) => e.email).filter(Boolean);
        const emailHtml = `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <div style="background:${style.color};padding:20px;border-radius:8px;margin-bottom:20px;color:#000">
              <h1 style="margin:0;font-size:28px">${style.icon} ${holiday.name}</h1>
              <p style="margin:8px 0 0;font-size:14px">${dayName}</p>
            </div>
            <p style="color:#333;font-size:16px"><strong>${style.message}</strong></p>
            <div style="background:#f3f4f6;padding:15px;border-radius:8px;border-left:4px solid ${style.color}">
              <p style="margin:0;color:#666;font-size:14px"><strong>Holiday Type:</strong> ${style.desc}</p>
            </div>
            <p style="color:#999;font-size:12px;margin-top:20px">Check the HR portal for more details about company holidays.</p>
          </div>`;
        await sendMail({ to: emails.join(','), subject: `${style.emoji} ${holiday.name} - ${dayName}`, html: emailHtml })
          .catch((e) => console.error(`Error sending holiday email for ${holiday.name}:`, e));
      }
      notified++;
    }
    return { notified, holidays: upcomingHolidays.map((h) => ({ ...h, notified: true })) };
  } catch (err) {
    console.error('Error sending holiday notifications:', err);
    throw err;
  }
}

module.exports = { sendHolidayNotifications, getHolidayTypeStyle };
