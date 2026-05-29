const db = require('../db');

const holidays = db.prepare("SELECT * FROM holidays WHERE date LIKE '2026-%' ORDER BY date").all();

console.log('\n📅 2026 Holidays in Hrika:\n');
holidays.forEach(h => console.log(`   ${h.date} - ${h.name}`));
console.log(`\nTotal: ${holidays.length} holidays\n`);
