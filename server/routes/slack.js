const express = require('express');
const crypto = require('crypto');
const { getSettings } = require('../services/settings');
const { processSlackEvent } = require('../services/slackSync');

const router = express.Router();

// Slack Events API webhook.
// Uses the RAW body so we can verify Slack's request signature. This route is
// mounted BEFORE the global JSON body parser in index.js for that reason.
router.post('/events', express.raw({ type: '*/*' }), (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : '');
  let body;
  try { body = JSON.parse(raw || '{}'); } catch (e) { return res.status(400).send('bad json'); }

  // 1) URL verification handshake (when you first add the Request URL in Slack).
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge });
  }

  // 2) MANDATORY signature verification. Slack always signs its requests with
  // the app's Signing Secret. Without a configured secret we cannot trust a
  // request, so we refuse to process events — otherwise anyone could POST a
  // forged "message" event and inject/alter attendance (unsafe-by-default).
  const s = getSettings().slack || {};
  if (!s.signingSecret) {
    // No secret configured → we can't verify, so we never process events.
    console.warn('[slack] event ignored — no Signing Secret configured in Settings → Slack.');
    return res.status(401).send('signing secret not configured');
  }
  {
    const ts = req.headers['x-slack-request-timestamp'];
    const sig = req.headers['x-slack-signature'];
    if (!ts || !sig) return res.status(401).send('unsigned');
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) return res.status(401).send('stale'); // replay guard
    const base = `v0:${ts}:${raw}`;
    const mine = 'v0=' + crypto.createHmac('sha256', s.signingSecret).update(base).digest('hex');
    const a = Buffer.from(mine);
    const b = Buffer.from(String(sig));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).send('bad signature');
  }

  // 3) Acknowledge immediately (Slack requires a response within 3s), then process.
  res.status(200).send('ok');
  if (body.type === 'event_callback' && body.event) {
    Promise.resolve(processSlackEvent(body.event)).catch((e) => console.error('Slack event error:', e));
  }
});

module.exports = router;
