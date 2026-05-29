const db = require('../db');

function getSettings() {
  const row = db.prepare('SELECT data FROM settings WHERE id = 1').get();
  return row ? JSON.parse(row.data) : {};
}

function saveSettings(partial) {
  const current = getSettings();
  const merged = { ...current, ...partial };
  db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(
    JSON.stringify(merged)
  );
  return merged;
}

module.exports = { getSettings, saveSettings };
