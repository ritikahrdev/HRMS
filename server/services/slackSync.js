const db = require('./../db');
const { getSettings } = require('./settings');

// Maps Slack messages (for one day) to attendance and upserts.
// messages: [{ user, text, ts, subtype? }]
// slackUsers: { userId: { email, real_name } }
// Returns { total, synced, unmatched, unmatchedKeys, mode:'slack' }.
function processSlackMessages(messages, slackUsers, date) {
  const slack = getSettings().slack || {};
  const leaveKw = (slack.leaveKeywords || []).filter(Boolean);
  const halfKw = (slack.halfKeywords || []).filter(Boolean);

  const employees = db.prepare('SELECT id, emp_code, email, name, slack_id FROM employees').all();
  const byId = {}, byEmail = {}, byName = {};
  for (const e of employees) {
    if (e.slack_id) byId[e.slack_id] = e.id;
    if (e.email) byEmail[String(e.email).toLowerCase()] = e.id;
    if (e.name) byName[String(e.name).toLowerCase()] = e.id;
  }
  const resolve = (uid) => {
    if (byId[uid]) return byId[uid];
    const u = slackUsers[uid];
    if (u) {
      if (u.email && byEmail[String(u.email).toLowerCase()]) return byEmail[String(u.email).toLowerCase()];
      if (u.real_name && byName[String(u.real_name).toLowerCase()]) return byName[String(u.real_name).toLowerCase()];
    }
    return null;
  };

  const perEmp = {};
  const result = { total: 0, synced: 0, unmatched: 0, unmatchedKeys: [], mode: 'slack' };

  for (const m of messages) {
    if (!m.user || m.subtype) continue; // skip joins/bots/system
    result.total++;
    const empId = resolve(m.user);
    if (!empId) {
      result.unmatched++;
      const u = slackUsers[m.user];
      const key = (u && (u.real_name || u.email)) || m.user;
      if (!result.unmatchedKeys.includes(key)) result.unmatchedKeys.push(String(key));
      continue;
    }
    const text = String(m.text || '').toLowerCase();
    let status = 'present';
    if (leaveKw.some((k) => text.includes(k))) status = 'leave';
    else if (halfKw.some((k) => text.includes(k))) status = 'half';
    const time = new Date(Number(m.ts) * 1000);

    const cur = perEmp[empId];
    if (!cur) perEmp[empId] = { time, status };
    else {
      if (time < cur.time) cur.time = time;
      if (status === 'leave') cur.status = 'leave';
      else if (status === 'half' && cur.status !== 'leave') cur.status = 'half';
    }
  }

  const upsert = db.prepare(`
    INSERT INTO attendance (employee_id, date, check_in, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      status = excluded.status,
      check_in = COALESCE(excluded.check_in, attendance.check_in)`);
  for (const [empId, v] of Object.entries(perEmp)) {
    const ci = v.status === 'leave' ? null : (isNaN(v.time) ? null : v.time.toISOString());
    upsert.run(Number(empId), date, ci, v.status);
    result.synced++;
  }
  return result;
}

async function slackApi(token, method, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  return res.json();
}

// Fetches one day's messages from the configured channel and syncs.
async function syncFromSlack(date) {
  const s = getSettings().slack || {};
  if (!s.enabled) throw new Error('Slack sync is turned off. Enable it in Settings → Slack Attendance.');
  if (!s.botToken || !s.channelId) throw new Error('Add your Slack Bot token and Channel ID in Settings first.');

  const [y, mo, d] = date.split('-').map(Number);
  const oldest = (new Date(y, mo - 1, d, 0, 0, 0).getTime() / 1000).toFixed(6);
  const latest = (new Date(y, mo - 1, d, 23, 59, 59).getTime() / 1000).toFixed(6);

  let data;
  try {
    data = await slackApi(s.botToken, 'conversations.history', { channel: s.channelId, oldest, latest, limit: 1000 });
  } catch (e) {
    throw new Error('Could not reach Slack. Check your internet connection.');
  }
  if (!data.ok) {
    const hints = { missing_scope: ' (the bot needs the channels:history scope)', not_in_channel: ' (invite the bot to the channel)', channel_not_found: ' (check the Channel ID)', invalid_auth: ' (check the Bot token)' };
    throw new Error('Slack: ' + data.error + (hints[data.error] || ''));
  }
  const messages = data.messages || [];

  // Resolve each Slack user's email/name so we can match to employees.
  const slackUsers = {};
  const ids = [...new Set(messages.filter((m) => m.user).map((m) => m.user))];
  for (const uid of ids) {
    try {
      const ud = await slackApi(s.botToken, 'users.info', { user: uid });
      if (ud.ok && ud.user) slackUsers[uid] = { email: (ud.user.profile && ud.user.profile.email) || '', real_name: ud.user.real_name || ud.user.name || '' };
    } catch (e) { /* ignore individual failures */ }
  }
  return processSlackMessages(messages, slackUsers, date);
}

// Post a message to Slack channel (e.g., announcements)
async function postToSlack(message, channel) {
  const s = getSettings().slack || {};
  if (!s.enabled || !s.botToken) return false;

  const channelId = channel || s.channelId;
  if (!channelId) return false;

  try {
    const data = await slackApi(s.botToken, 'chat.postMessage', {
      channel: channelId,
      text: message,
      mrkdwn: true,
    });
    return data.ok;
  } catch (e) {
    console.error('Error posting to Slack:', e);
    return false;
  }
}

module.exports = { processSlackMessages, syncFromSlack, postToSlack };
