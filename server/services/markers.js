const db = require('./../db');

// One-shot idempotency markers for automation. claimOnce(key) atomically
// inserts the key and returns true ONLY the first time — so a recurring job can
// guard "did I already do this?" independent of email/Slack state.
async function claimOnce(marker) {
  const r = await db.prepare(
    'INSERT INTO automation_markers (marker) VALUES (?) ON CONFLICT (marker) DO NOTHING'
  ).run(marker);
  return (r.changes || 0) > 0;
}

module.exports = { claimOnce };
