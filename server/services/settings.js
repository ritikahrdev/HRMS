const db = require('../db');

let _cache = null;

async function getSettings() {
  if (_cache) return _cache;
  const row = await db.prepare('SELECT data FROM settings WHERE id = 1').get();
  _cache = row ? JSON.parse(row.data) : {};
  return _cache;
}

async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(
    JSON.stringify(merged)
  );
  _cache = merged;
  return merged;
}

module.exports = { getSettings, saveSettings };
