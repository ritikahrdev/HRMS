const db = require('./../db');

// Inserts an in-app notification for each given user id.
function notifyUsers(userIds, { type, title, body, link }) {
  if (!userIds || !userIds.length) return;
  const ins = db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)');
  for (const id of userIds) ins.run(id, type || null, title, body || null, link || null);
}

// Notifies everyone with a login except the actor.
function notifyEveryone(exceptUserId, payload) {
  const ids = db.prepare('SELECT id FROM users').all().map((u) => u.id).filter((id) => id !== exceptUserId);
  notifyUsers(ids, payload);
}

module.exports = { notifyUsers, notifyEveryone };
