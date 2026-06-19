const db = require('./../db');
const { getSettings } = require('./settings');

// ---- Defaults (used when a saved settings blob predates these keys) ----
const DEFAULTS = {
  presentKeywords: ['in', 'present', 'here', 'wfo', 'office', 'reached', 'reporting', 'online'],
  wfhKeywords: ['wfh', 'work from home', 'working from home', 'remote', 'from home'],
  halfKeywords: ['half', 'half day', 'half-day', 'halfday', 'first half', '1st half', 'second half', '2nd half', 'leaving early'],
  leaveKeywords: ['leave', 'on leave', 'ooo', 'out of office', 'pto', 'vacation'],
  sickKeywords: ['sick', 'unwell', 'not well', 'not feeling well', 'on sick leave'],
  absentKeywords: ['absent', 'not coming', "won't be in", 'wont be in', 'na', 'not available'],
  validReaction: 'thumbsup',
  invalidReaction: 'x',
};

// Emoji shorthands (unicode + Slack :shortcode:). 🏖️ carries a variation
// selector, so we match the base 🏖 to catch both forms.
const EMOJI = {
  present: ['✅', ':white_check_mark:'],
  wfh: ['🏠', ':house:'],
  sick: ['🤒', ':face_with_thermometer:'],
  vacation: ['🏖', ':beach_with_umbrella:'],
};
const hasEmoji = (text, list) => list.some((e) => text.includes(e));

function kw(slack, key) {
  // Always include the built-in defaults, then add any custom keywords saved in
  // settings on top. (Older saved blobs froze a smaller list and used to REPLACE
  // the defaults — which silently hid newly-added keywords like "second half".)
  const saved = Array.isArray(slack[key]) ? slack[key] : [];
  return [...new Set([...(DEFAULTS[key] || []), ...saved])]
    .map((s) => String(s).toLowerCase().trim())
    .filter(Boolean);
}

// Whole-word / whole-phrase match so the keyword "in" doesn't match "morning".
function matchesKeyword(text, keyword) {
  const k = String(keyword || '').toLowerCase().trim();
  if (!k) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)', 'i').test(text);
}

// Classify a Slack/attendance message into a status.
// Returns { valid, status, wfh, reason, half }. valid=false means unreadable.
// Most specific intent wins, so "half day" beats "present", "sick" -> leave, etc.
function classifyMessage(rawText, slack) {
  const text = String(rawText || '').toLowerCase().trim();
  const NONE = { valid: false, status: null, wfh: 0, reason: null, half: null };
  if (!text) return NONE;
  const has = (arr) => arr.some((k) => matchesKeyword(text, k));
  const whichHalf = /(^|[^a-z0-9])(second half|2nd half|afternoon|leaving early)([^a-z0-9]|$)/i.test(text) ? 'second'
    : /(^|[^a-z0-9])(first half|1st half|morning)([^a-z0-9]|$)/i.test(text) ? 'first' : null;

  // Most specific intent first.
  if (has(kw(slack, 'halfKeywords')))
    return { valid: true, status: 'half', wfh: 0, reason: whichHalf ? whichHalf + ' half' : null, half: whichHalf };
  if (has(kw(slack, 'sickKeywords')) || hasEmoji(text, EMOJI.sick))
    return { valid: true, status: 'leave', wfh: 0, reason: 'sick', half: null };
  if (has(kw(slack, 'leaveKeywords')) || hasEmoji(text, EMOJI.vacation)) {
    const vac = matchesKeyword(text, 'vacation') || hasEmoji(text, EMOJI.vacation);
    return { valid: true, status: 'leave', wfh: 0, reason: vac ? 'vacation' : null, half: null };
  }
  if (has(kw(slack, 'absentKeywords')))
    return { valid: true, status: 'absent', wfh: 0, reason: null, half: null };
  if (has(kw(slack, 'wfhKeywords')) || hasEmoji(text, EMOJI.wfh))
    return { valid: true, status: 'present', wfh: 1, reason: null, half: null };
  if (has(kw(slack, 'presentKeywords')) || hasEmoji(text, EMOJI.present))
    return { valid: true, status: 'present', wfh: 0, reason: null, half: null };
  return NONE;
}

// Build a resolver mapping a Slack user id -> employee id.
// Strongest identifiers first (slack_id -> email -> exact name), then UNIQUE
// fuzzy name matches among ACTIVE employees only — mirroring the forgiving
// webhook resolver (server/routes/webhook.js) so polling records the SAME people
// the proven webhook path did. Without the users:read.email scope the Slack
// profile email is blank, so a first-name-only or handle-style real_name (e.g.
// "Pranshu" -> "Pranshu Dubey") still resolves by name instead of silently going
// unmatched. Fuzzy matches resolve only when exactly one active employee fits,
// so it can never pick the wrong person.
async function buildResolver(slackUsers) {
  const employees = await db.prepare('SELECT id, emp_code, email, name, slack_id, status FROM employees').all();
  // Index ACTIVE employees only — archived/inactive people are ignored entirely
  // on EVERY match type (slack_id / email / exact name / fuzzy), so a stale
  // archived record can never capture a live person's attendance.
  const active = employees.filter((e) => e.status === 'active');
  const byId = {}, byEmail = {}, byName = {};
  for (const e of active) {
    if (e.slack_id) byId[String(e.slack_id)] = e.id;
    if (e.email) byEmail[String(e.email).toLowerCase()] = e.id;
    if (e.name) byName[String(e.name).toLowerCase()] = e.id;
  }
  // Normalise: lowercase, treat . and _ as spaces ("suraj.shukla" -> "suraj
  // shukla"), collapse whitespace.
  const norm = (x) => String(x == null ? '' : x).toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Unique active fuzzy match for a free-form name, else null.
  const fuzzy = (rawName) => {
    const n = norm(rawName);
    if (!n) return null;
    const toks = n.split(' ').filter(Boolean);
    let c = active.filter((e) => { const w = norm(e.name).split(' '); return toks.every((t) => w.includes(t)); }); // all incoming tokens present
    if (c.length === 1) return c[0].id;
    c = active.filter((e) => norm(e.name) === n || norm(e.name).startsWith(n + ' ')); // input is a name prefix
    if (c.length === 1) return c[0].id;
    c = active.filter((e) => { const w = norm(e.name).split(' ').filter(Boolean); return w.length && w.every((t) => toks.includes(t)); }); // stored tokens ⊆ incoming
    if (c.length === 1) return c[0].id;
    if (toks.length === 1) { c = active.filter((e) => norm(e.name).split(' ')[0] === toks[0]); if (c.length === 1) return c[0].id; } // unique first name
    return null;
  };
  return (uid) => {
    if (byId[uid]) return byId[uid];
    const u = slackUsers[uid];
    if (!u) return null;
    if (u.email && byEmail[String(u.email).toLowerCase()]) return byEmail[String(u.email).toLowerCase()];
    if (u.real_name && byName[String(u.real_name).toLowerCase()]) return byName[String(u.real_name).toLowerCase()];
    return fuzzy(u.real_name); // first-name / handle / fuller-name variants, unique active only
  };
}

const upsertAttendance = db.prepare(`
  INSERT INTO attendance (employee_id, date, check_in, status, wfh, source)
  VALUES (?, ?, ?, ?, ?, 'slack')
  ON CONFLICT(employee_id, date) DO UPDATE SET
    status = excluded.status,
    wfh = excluded.wfh,
    source = 'slack',
    check_in = COALESCE(excluded.check_in, attendance.check_in)`);

// Maps Slack messages (for one day) to attendance and upserts.
// Returns { total, synced, unmatched, invalid, unmatchedKeys, classified, mode:'slack' }.
// `classified` lists per-message outcomes so the caller can react/notify.
async function processSlackMessages(messages, slackUsers, date) {
  const slack = getSettings().slack || {};
  const resolve = await buildResolver(slackUsers);

  const perEmp = {};
  const classified = []; // { ts, user, empId, valid, status, wfh }
  const result = { total: 0, synced: 0, unmatched: 0, invalid: 0, unmatchedKeys: [], classified, mode: 'slack' };

  for (const m of messages) {
    if (!m.user || m.subtype) continue; // skip joins/bots/system
    result.total++;
    const cls = classifyMessage(m.text, slack);
    const empId = resolve(m.user);
    classified.push({ ts: m.ts, user: m.user, empId, valid: cls.valid, status: cls.status, wfh: cls.wfh, reactions: m.reactions || [] });

    if (!empId) {
      result.unmatched++;
      const u = slackUsers[m.user];
      const key = (u && (u.real_name || u.email)) || m.user;
      if (!result.unmatchedKeys.includes(key)) result.unmatchedKeys.push(String(key));
      continue;
    }
    if (!cls.valid) { result.invalid++; continue; }

    const time = new Date(Number(m.ts) * 1000);
    const cur = perEmp[empId];
    if (!cur) perEmp[empId] = { time, status: cls.status, wfh: cls.wfh };
    else {
      if (time < cur.time) cur.time = time;
      // Precedence: leave > absent > half > present.
      const rank = { leave: 4, absent: 3, half: 2, present: 1 };
      if ((rank[cls.status] || 0) > (rank[cur.status] || 0)) { cur.status = cls.status; }
      if (cls.wfh) cur.wfh = 1;
    }
  }

  for (const [empId, v] of Object.entries(perEmp)) {
    const ci = (v.status === 'leave' || v.status === 'absent') ? null : (isNaN(v.time) ? null : v.time.toISOString());
    await upsertAttendance.run(Number(empId), date, ci, v.status, v.wfh ? 1 : 0);
    result.synced++;
  }
  return result;
}

async function slackApi(token, method, params) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
}

async function slackGet(token, method, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  return res.json();
}

// Add an emoji reaction to a message (idempotent — ignores already_reacted).
async function reactToMessage(token, channel, ts, emoji) {
  try {
    const r = await slackApi(token, 'reactions.add', { channel, timestamp: ts, name: emoji });
    return r.ok || r.error === 'already_reacted';
  } catch (e) { return false; }
}

// Reply in-thread to a message.
async function replyInThread(token, channel, ts, text) {
  try {
    const r = await slackApi(token, 'chat.postMessage', { channel, thread_ts: ts, text, mrkdwn: true });
    return r.ok;
  } catch (e) { return false; }
}

// The friendly nudge sent when we can't read an attendance message.
function invalidNudge(userId, slack) {
  const examples = '`present` · `WFH` · `half day` · `leave` · `absent`';
  return `<@${userId}> ⚠️ I couldn't read your attendance from that message. Please post one of: ${examples} so it gets recorded. ✅`;
}

// Apply 👍 / ❌ reactions + notify for a set of classified messages.
async function applyReactions(token, channel, classified, slack) {
  if (slack.autoReact === false) return { reacted: 0, notified: 0 };
  const validEmoji = slack.validReaction || DEFAULTS.validReaction;
  const invalidEmoji = slack.invalidReaction || DEFAULTS.invalidReaction;
  let reacted = 0, notified = 0;
  for (const m of classified) {
    // Skip if we've clearly already reacted (avoid duplicate nudges on re-sync).
    const already = (m.reactions || []).some((r) => r.name === validEmoji || r.name === invalidEmoji);
    if (already) continue;
    if (m.valid) {
      if (await reactToMessage(token, channel, m.ts, validEmoji)) reacted++;
    } else {
      if (await reactToMessage(token, channel, m.ts, invalidEmoji)) reacted++;
      if (slack.notifyOnInvalid !== false) {
        if (await replyInThread(token, channel, m.ts, invalidNudge(m.user, slack))) notified++;
      }
    }
  }
  return { reacted, notified };
}

// Fetches one day's messages from the configured channel, syncs, and reacts.
async function syncFromSlack(date) {
  const s = getSettings().slack || {};
  if (!s.enabled) throw new Error('Slack sync is turned off. Enable it in Settings → Slack Attendance.');
  if (!s.botToken || !s.channelId) throw new Error('Add your Slack Bot token and Channel ID in Settings first.');

  const [y, mo, d] = date.split('-').map(Number);
  const oldest = (new Date(y, mo - 1, d, 0, 0, 0).getTime() / 1000).toFixed(6);
  const latest = (new Date(y, mo - 1, d, 23, 59, 59).getTime() / 1000).toFixed(6);

  let data;
  try {
    data = await slackGet(s.botToken, 'conversations.history', { channel: s.channelId, oldest, latest, limit: 1000 });
  } catch (e) {
    throw new Error('Could not reach Slack. Check your internet connection.');
  }
  if (!data.ok) {
    const hints = { missing_scope: ' (the bot needs channels:history, reactions:write & chat:write scopes)', not_in_channel: ' (invite the bot to the channel)', channel_not_found: ' (check the Channel ID)', invalid_auth: ' (check the Bot token)' };
    throw new Error('Slack: ' + data.error + (hints[data.error] || ''));
  }
  const messages = data.messages || [];

  // Resolve each Slack user's email/name so we can match to employees.
  const slackUsers = {};
  const ids = [...new Set(messages.filter((m) => m.user).map((m) => m.user))];
  for (const uid of ids) {
    try {
      const ud = await slackGet(s.botToken, 'users.info', { user: uid });
      if (ud.ok && ud.user) slackUsers[uid] = { email: (ud.user.profile && ud.user.profile.email) || '', real_name: ud.user.real_name || ud.user.name || '' };
    } catch (e) { /* ignore individual failures */ }
  }

  const result = await processSlackMessages(messages, slackUsers, date);
  // React + notify (best-effort; never blocks the sync result).
  try {
    const r = await applyReactions(s.botToken, s.channelId, result.classified, s);
    result.reacted = r.reacted; result.notified = r.notified;
  } catch (e) { /* ignore */ }
  delete result.classified;
  return result;
}

// ---- Real-time: handle a single Slack "message" event from the Events API ----
// event = { type:'message', channel, user, text, ts, subtype? }
async function processSlackEvent(event) {
  const s = getSettings().slack || {};
  if (!s.enabled || !s.botToken) return { ok: false, reason: 'disabled' };
  if (!event || event.type !== 'message' || event.subtype || !event.user || !event.text) return { ok: false, reason: 'ignored' };
  if (s.channelId && event.channel !== s.channelId) return { ok: false, reason: 'other_channel' };

  // Resolve the user (fetch profile if needed for email/name matching).
  let slackUsers = {};
  try {
    const ud = await slackGet(s.botToken, 'users.info', { user: event.user });
    if (ud.ok && ud.user) slackUsers[event.user] = { email: (ud.user.profile && ud.user.profile.email) || '', real_name: ud.user.real_name || ud.user.name || '' };
  } catch (e) { /* ignore */ }
  const resolve = await buildResolver(slackUsers);
  const empId = resolve(event.user);
  const cls = classifyMessage(event.text, s);
  const date = new Date(Number(event.ts) * 1000).toISOString().slice(0, 10);

  // Record attendance if valid + matched.
  if (empId && cls.valid) {
    const ci = (cls.status === 'leave' || cls.status === 'absent') ? null : new Date(Number(event.ts) * 1000).toISOString();
    await upsertAttendance.run(empId, date, ci, cls.status, cls.wfh ? 1 : 0);
  }

  // React + notify.
  if (s.autoReact !== false) {
    const validEmoji = s.validReaction || DEFAULTS.validReaction;
    const invalidEmoji = s.invalidReaction || DEFAULTS.invalidReaction;
    if (cls.valid) {
      await reactToMessage(s.botToken, event.channel, event.ts, validEmoji);
    } else {
      await reactToMessage(s.botToken, event.channel, event.ts, invalidEmoji);
      if (s.notifyOnInvalid !== false) await replyInThread(s.botToken, event.channel, event.ts, invalidNudge(event.user, s));
    }
  }
  return { ok: true, empId, valid: cls.valid, status: cls.status, wfh: cls.wfh, date };
}

// Pick the Incoming Webhook URL for a given purpose, so different actions can go
// to different Slack channels (each falls back to the general webhook).
function slackUrlFor(s, purpose) {
  if (purpose === 'attendance' && s.webhookAttendance) return s.webhookAttendance;
  if (purpose === 'shoutout' && s.webhookShoutout) return s.webhookShoutout;
  return s.incomingWebhookUrl || ''; // general / notices / default
}

// Post a message to Slack. Two ways, simplest first:
//   1) an Incoming Webhook URL (no bot token needed) — routed by `opts.purpose`
//      ('attendance' | 'shoutout' | else general), or
//   2) the bot token via chat.postMessage.
// `opts` may be an options object { purpose, channel } or a plain channel string.
async function postToSlack(message, opts) {
  const s = getSettings().slack || {};
  const purpose = (opts && typeof opts === 'object') ? opts.purpose : null;
  const legacyChannel = (typeof opts === 'string') ? opts : (opts && opts.channel);

  const url = slackUrlFor(s, purpose);
  if (url) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message }) });
      return r.ok;
    } catch (e) { console.error('Error posting to Slack webhook:', e.message); return false; }
  }
  if (!s.enabled || !s.botToken) return false;
  // Route by purpose: a shoutout posts to its own channel when `shoutoutChannelId`
  // is set, otherwise the default channel. (An incoming-webhook URL configured for
  // the purpose above already took precedence.) This keeps HRMS-originated
  // shoutouts (Recognition wall) out of the attendance channel.
  const purposeChannel = purpose === 'shoutout' ? (s.shoutoutChannelId || s.channelId) : s.channelId;
  const channelId = legacyChannel || purposeChannel;
  if (!channelId) return false;
  try {
    const data = await slackApi(s.botToken, 'chat.postMessage', { channel: channelId, text: message, mrkdwn: true });
    return data.ok;
  } catch (e) {
    console.error('Error posting to Slack:', e);
    return false;
  }
}

module.exports = { processSlackMessages, syncFromSlack, postToSlack, processSlackEvent, classifyMessage };
