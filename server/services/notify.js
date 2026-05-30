const db = require('./../db');

// Inserts an in-app notification for each given user id.
async function notifyUsers(userIds, { type, title, body, link }) {
  if (!userIds || !userIds.length) return;
  const ins = db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)'
  );
  for (const id of userIds) {
    await ins.run(id, type || null, title, body || null, link || null);
  }
}

// Notifies everyone with a login except the actor.
async function notifyEveryone(exceptUserId, payload) {
  const rows = await db.prepare('SELECT id FROM users').all();
  const ids = rows.map((u) => u.id).filter((id) => id !== exceptUserId);
  await notifyUsers(ids, payload);
}

module.exports = { notifyUsers, notifyEveryone };
