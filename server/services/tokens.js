const crypto = require('crypto');
const config = require('../config');

const secret = config.sessionSecret || 'hr-secret';

// Creates a tamper-proof token for one-click email actions.
function makeToken(parts) {
  const data = parts.join(':');
  return crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
}

function verifyToken(parts, token) {
  const expected = makeToken(parts);
  // constant-time compare
  if (!token || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

// Builds an absolute action URL with a valid token.
function actionUrl(type, id, decision) {
  const token = makeToken([type, String(id), decision]);
  return `${config.publicUrl}/api/actions/${type}/${id}/${decision}?t=${token}`;
}

module.exports = { makeToken, verifyToken, actionUrl };
