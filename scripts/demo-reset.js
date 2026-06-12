// Reverses scripts/demo-prep.js — removes the demo content and restores the
// self-service persona. Run this after the demo to return to normal.
//   node scripts/demo-reset.js
const fs = require('fs');
const raw = fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8');
raw.split('\n').forEach((l) => { const i = l.indexOf('='); if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
const today = new Date().toISOString().slice(0, 10);
const DEMO_EMP = 38;

(async () => {
  const db = require('../server/db');
  await db.init();
  const log = [];

  const a = await db.prepare("DELETE FROM leave_requests WHERE employee_id=? AND reason IN ('Cousin''s wedding in Jaipur — travelling with family.','Short personal trip, will be reachable on phone.')").run(DEMO_EMP);
  log.push(`removed demo pending leaves: ${a.changes}`);
  const b = await db.prepare("DELETE FROM announcements WHERE title LIKE '🎉 Welcome to the new DigiStay HRMS%'").run();
  log.push(`removed demo announcement: ${b.changes}`);
  const c = await db.prepare("DELETE FROM kudos WHERE message LIKE 'Outstanding leadership shipping the new platform%'").run();
  log.push(`removed demo kudos: ${c.changes}`);
  const d = await db.prepare("DELETE FROM attendance WHERE source='demo'").run();
  log.push(`removed demo attendance (all dates): ${d.changes}`);
  const e = await db.prepare("DELETE FROM payslips WHERE employee_id=?").run(DEMO_EMP);
  log.push(`removed demo payslip(s): ${e.changes}`);
  // restore the self-service persona
  await db.prepare("UPDATE employees SET name='Test Employee', department='Engineering', designation='Software Developer', dob=NULL, monthly_salary=0, salary_structure=NULL WHERE id=?").run(DEMO_EMP);
  log.push('restored emp#38 → Test Employee, ₹0');

  console.log('\n=== DEMO RESET DONE ===');
  log.forEach((l) => console.log('  ✓ ' + l));
  console.log('\n(The archived junk employee row stays archived — it was test junk.)');
  await db.pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
