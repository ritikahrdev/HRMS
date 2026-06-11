// Leave accrual & carry-forward engine.
//
// When settings.leaveAccrual.enabled is on, paid leave types can "earn" a fixed
// number of days each month (perMonth) and carry a capped remainder into the
// next year. Movements are recorded in the leave_ledger table; the leave
// balance route sums the ledger for a type/year instead of using the flat quota.
const db = require('./../db');
const { getSettings } = require('./settings');

function pad(n) { return String(n).padStart(2, '0'); }

// Which leave types accrue, with their monthly rate and carry cap.
// Reads settings.leaveAccrual.rules keyed by type code; falls back to nothing.
function accrualRules() {
  const s = getSettings();
  const acc = s.leaveAccrual || {};
  if (!acc.enabled) return {};
  const rules = acc.rules || {};
  const out = {};
  for (const t of (s.leaveTypes || [])) {
    if (t.code === 'unpaid' || t.code === 'comp_off') continue;
    const r = rules[t.code] || {};
    const perMonth = Number(r.perMonth || 0);
    const carryCap = r.carryCap != null ? Number(r.carryCap) : 0;
    if (perMonth > 0 || carryCap > 0) out[t.code] = { perMonth, carryCap, name: t.name };
  }
  return out;
}

function isEnabled() {
  const s = getSettings();
  return !!(s.leaveAccrual && s.leaveAccrual.enabled) && Object.keys(accrualRules()).length > 0;
}

// Insert a ledger movement, ignoring duplicates (unique on emp+type+kind+period).
async function addEntry(employeeId, type, amount, kind, period, note, createdBy) {
  await db.prepare(
    `INSERT INTO leave_ledger (employee_id, type, amount, kind, period, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (employee_id, type, kind, period) DO NOTHING`
  ).run(employeeId, type, amount, kind, period, note || null, createdBy || null);
}

// Accrue one month (period 'YYYY-MM') for every active employee & accruing type.
// Idempotent: the unique index means re-running a month adds nothing.
async function runMonthlyAccrual(period, createdBy) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw new Error('period must be YYYY-MM');
  const rules = accrualRules();
  const codes = Object.keys(rules);
  if (!codes.length) return { accrued: 0, period };
  const emps = await db.prepare("SELECT id FROM employees WHERE status = 'active'").all();
  let accrued = 0;
  for (const e of emps) {
    for (const code of codes) {
      const before = await db.prepare(
        "SELECT 1 FROM leave_ledger WHERE employee_id=? AND type=? AND kind='accrual' AND period=?"
      ).get(e.id, code, period);
      await addEntry(e.id, code, rules[code].perMonth, 'accrual', period, 'Monthly accrual', createdBy);
      if (!before) accrued++;
    }
  }
  return { accrued, period, types: codes.length, employees: emps.length };
}

// Catch up accrual for every month from January of `year` up to (and including)
// the current month. Safe to call repeatedly — only missing months are added.
async function catchUpYear(year, createdBy) {
  const now = new Date();
  const curY = now.getFullYear();
  const lastMonth = year < curY ? 12 : now.getMonth() + 1;
  let total = 0;
  for (let m = 1; m <= lastMonth; m++) {
    const r = await runMonthlyAccrual(`${year}-${pad(m)}`, createdBy);
    total += r.accrued;
  }
  return { accrued: total, year, upToMonth: lastMonth };
}

// Carry-forward the remaining balance of `fromYear` into the next year, capped.
// remaining = ledger(fromYear) - approved leave used in fromYear.
async function runCarryForward(fromYear, createdBy) {
  const rules = accrualRules();
  const codes = Object.keys(rules);
  if (!codes.length) return { carried: 0 };
  const nextYear = String(Number(fromYear) + 1);
  const emps = await db.prepare("SELECT id FROM employees WHERE status = 'active'").all();
  let carried = 0;
  for (const e of emps) {
    for (const code of codes) {
      const cap = rules[code].carryCap || 0;
      if (cap <= 0) continue;
      const accruedRow = await db.prepare(
        "SELECT COALESCE(SUM(amount),0) AS s FROM leave_ledger WHERE employee_id=? AND type=? AND substr(period,1,4)=?"
      ).get(e.id, code, String(fromYear));
      const usedRow = await db.prepare(
        "SELECT COALESCE(SUM(days),0) AS s FROM leave_requests WHERE employee_id=? AND type=? AND status='approved' AND substr(from_date,1,4)=?"
      ).get(e.id, code, String(fromYear));
      const remaining = Number(accruedRow.s) - Number(usedRow.s);
      const carry = Math.max(0, Math.min(remaining, cap));
      if (carry > 0) {
        const before = await db.prepare(
          "SELECT 1 FROM leave_ledger WHERE employee_id=? AND type=? AND kind='carry_forward' AND period=?"
        ).get(e.id, code, nextYear);
        await addEntry(e.id, code, +carry.toFixed(1), 'carry_forward', nextYear, `Carried from ${fromYear}`, createdBy);
        if (!before) carried++;
      }
    }
  }
  return { carried, fromYear, toYear: nextYear };
}

// Total ledger balance granted for a type in a given year (used by balanceFor).
async function ledgerAllowed(employeeId, type, year) {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS s FROM leave_ledger WHERE employee_id=? AND type=? AND substr(period,1,4)=?"
  ).get(employeeId, type, String(year));
  return +Number(row.s).toFixed(1);
}

// Best-effort: on boot, make sure the current year is accrued up to this month.
async function autoCatchUp() {
  try {
    if (!isEnabled()) return;
    await catchUpYear(new Date().getFullYear(), null);
  } catch (e) { console.error('Leave accrual auto catch-up failed:', e.message); }
}

module.exports = {
  accrualRules, isEnabled, addEntry, runMonthlyAccrual, catchUpYear,
  runCarryForward, ledgerAllowed, autoCatchUp,
};
