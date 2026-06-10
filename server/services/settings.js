const db = require('../db');

// Settings are cached in memory so getSettings() can stay SYNCHRONOUS — it's
// called from many non-async places (permissions, route guards). The cache is
// loaded once at startup (db.init) and refreshed on every save.
let cache = null;

function getSettings() {
  return cache || {};
}

async function loadSettings() {
  const row = await db.prepare('SELECT data FROM settings WHERE id = 1').get();
  cache = row ? JSON.parse(row.data) : {};
  return cache;
}

async function saveSettings(partial) {
  const current = cache || (await loadSettings());
  const merged = { ...current, ...partial };
  await db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(merged));
  cache = merged;
  return merged;
}

module.exports = { getSettings, saveSettings, loadSettings };
