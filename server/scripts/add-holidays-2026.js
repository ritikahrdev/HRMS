const db = require('../db');

const holidays2026 = [
  { date: '2026-01-01', name: 'New Year\'s Day' },
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-02-01', name: 'Guru Ravidas Jayanti' },
  { date: '2026-02-15', name: 'Maha Shivaratri' },
  { date: '2026-03-04', name: 'Holi' },
  { date: '2026-03-26', name: 'Rama Navami' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-08-28', name: 'Raksha Bandhan' },
  { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-08', name: 'Diwali/Deepavali' },
  { date: '2026-11-11', name: 'Bhai Duj' },
  { date: '2026-11-15', name: 'Chhat Puja' },
  { date: '2026-12-25', name: 'Christmas' },
];

let added = 0;
let skipped = 0;

for (const h of holidays2026) {
  try {
    db.prepare('INSERT INTO holidays (date, name, type) VALUES (?, ?, ?)').run(h.date, h.name, 'public');
    added++;
    console.log(`✅ Added: ${h.date} - ${h.name}`);
  } catch (e) {
    skipped++;
    console.log(`⚠️  Skipped: ${h.date} - ${h.name} (already exists)`);
  }
}

console.log(`\n✅ Total: ${added} holidays added, ${skipped} skipped`);
