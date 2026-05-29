const db = require('../db');
const { getSettings } = require('./settings');

function pad(n) {
  return String(n).padStart(2, '0');
}

// All YYYY-MM-DD dates within a given month (month is 1-12).
function datesInMonth(year, month) {
  const last = new Date(year, month, 0).getDate(); // day 0 of next month
  const out = [];
  for (let d = 1; d <= last; d++) out.push(`${year}-${pad(month)}-${pad(d)}`);
  return out;
}

function weekday(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay(); // 0=Sun .. 6=Sat
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Computes a salary breakdown for one employee for one month (YYYY-MM).
 * Does NOT save anything; pure calculation.
 */
function computePayroll(employeeId, monthStr) {
  const settings = getSettings();
  const [yearS, monthS] = monthStr.split('-');
  const year = parseInt(yearS, 10);
  const month = parseInt(monthS, 10);

  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!emp) throw new Error('Employee not found');

  const workingDaysCfg = settings.workingDays || [1, 2, 3, 4, 5];
  const allDates = datesInMonth(year, month);
  const today = todayStr();

  // Working days = configured weekdays in the month.
  const workingDates = allDates.filter((d) => workingDaysCfg.includes(weekday(d)));
  const workingDaysInMonth = workingDates.length;

  // Attendance map for the month.
  const attRows = db
    .prepare(
      "SELECT date, status FROM attendance WHERE employee_id = ? AND date LIKE ?"
    )
    .all(employeeId, `${monthStr}-%`);
  const attByDate = {};
  for (const r of attRows) attByDate[r.date] = r.status;

  // Approved leaves overlapping the month.
  const leaves = db
    .prepare(
      `SELECT type, from_date, to_date, half_day FROM leave_requests
       WHERE employee_id = ? AND status = 'approved'
         AND NOT (to_date < ? OR from_date > ?)`
    )
    .all(employeeId, `${monthStr}-01`, `${monthStr}-31`);

  function leaveOn(dateStr) {
    for (const lv of leaves) {
      if (dateStr >= lv.from_date && dateStr <= lv.to_date) return lv;
    }
    return null;
  }

  // Which leave types are paid (from configurable types; 'unpaid' is unpaid).
  const paidByCode = {};
  for (const t of (settings.leaveTypes || [])) paidByCode[t.code] = t.paid !== false;
  const isPaidLeave = (code) => code !== 'unpaid' && paidByCode[code] !== false;

  // Company holidays in the month are paid and never counted as absent.
  const holidayRows = db.prepare('SELECT date FROM holidays WHERE date LIKE ?').all(`${monthStr}-%`);
  const holidaySet = new Set(holidayRows.map((h) => h.date));

  let present = 0;
  let paidLeave = 0;
  let unpaid = 0;
  let holidays = 0;

  for (const d of workingDates) {
    // Do not penalise future days.
    if (d > today) continue;

    const status = attByDate[d];

    // Leave takes precedence (handles paid/unpaid and half-day).
    const lv = leaveOn(d);
    if (lv) {
      const portion = lv.half_day ? 0.5 : 1;
      if (isPaidLeave(lv.type)) paidLeave += portion; else unpaid += portion;
      // For a half day leave, the other half is treated as worked (no deduction).
      if (lv.half_day) present += 0.5;
      continue;
    }

    if (status === 'present') { present += 1; continue; }
    if (status === 'half') { present += 0.5; unpaid += 0.5; continue; }

    // A holiday with no work is a paid day (no deduction).
    if (holidaySet.has(d) && status !== 'absent') { holidays += 1; continue; }

    // No attendance, no leave, not a holiday, and the day has passed -> absent.
    unpaid += 1;
  }

  // ---- Salary structure (earnings & deductions) ----
  let structure = null;
  try { structure = emp.salary_structure ? JSON.parse(emp.salary_structure) : null; } catch (e) { structure = null; }
  let earnings;
  if (structure && Array.isArray(structure.earnings) && structure.earnings.length) {
    earnings = structure.earnings.map((e) => ({ name: e.name || 'Earning', amount: +e.amount || 0 }));
  } else {
    earnings = [{ name: 'Basic', amount: emp.monthly_salary || 0 }];
  }
  const gross = +earnings.reduce((s, e) => s + e.amount, 0).toFixed(2);
  const basicComp = earnings.find((e) => /basic/i.test(e.name));
  const basic = basicComp ? basicComp.amount : gross;

  const basis = (settings.payroll && settings.payroll.perDayBasis) || 'working';
  const divisor = basis === 'calendar' ? allDates.length : workingDaysInMonth || 1;
  const perDay = gross / divisor;

  const deductUnpaid = !settings.payroll || settings.payroll.deductUnpaidLeave !== false;
  const deductAbsent = !settings.payroll || settings.payroll.deductAbsent !== false;
  const deductibleDays = deductUnpaid || deductAbsent ? unpaid : 0;
  const lop = +(deductibleDays * perDay).toFixed(2);

  // ---- Deduction line items ----
  const ded = [];
  if (lop > 0) ded.push({ name: `Loss of Pay (${deductibleDays} day${deductibleDays === 1 ? '' : 's'})`, amount: lop });

  const st = settings.statutory || {};
  if (st.pf && st.pf.enabled) {
    const capBasic = st.pf.basisCap ? Math.min(basic, st.pf.basisCap) : basic;
    const pf = +(capBasic * (st.pf.percent || 12) / 100).toFixed(2);
    if (pf > 0) ded.push({ name: 'Provident Fund (PF)', amount: pf });
  }
  if (st.esi && st.esi.enabled && gross <= (st.esi.grossCap || 21000)) {
    const esi = +(gross * (st.esi.percent || 0.75) / 100).toFixed(2);
    if (esi > 0) ded.push({ name: 'ESI', amount: esi });
  }
  if (st.pt && st.pt.enabled && (+st.pt.amount || 0) > 0) {
    ded.push({ name: 'Professional Tax', amount: +(+st.pt.amount).toFixed(2) });
  }
  if (structure && Array.isArray(structure.deductions)) {
    for (const d of structure.deductions) {
      const amt = +d.amount || 0;
      if (amt > 0) ded.push({ name: d.name || 'Deduction', amount: +amt.toFixed(2) });
    }
  }
  const activeLoans = db.prepare("SELECT emi FROM loans WHERE employee_id = ? AND status = 'active' AND emi > 0").all(employeeId);
  const loanEmi = +activeLoans.reduce((s, l) => s + l.emi, 0).toFixed(2);
  if (loanEmi > 0) ded.push({ name: 'Loan / Advance EMI', amount: loanEmi });

  const totalDeductions = +ded.reduce((s, d) => s + d.amount, 0).toFixed(2);

  // Approved reimbursements decided within this month are added to net pay.
  const reimb = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM reimbursements
       WHERE employee_id = ? AND status = 'approved'
         AND substr(COALESCE(decided_at, applied_at),1,7) = ?`
    )
    .get(employeeId, monthStr).total;

  const net = +(gross - totalDeductions + reimb).toFixed(2);
  const paidDays = +(present + paidLeave + holidays).toFixed(2);
  const breakup = { earnings, deductions: ded };

  return {
    employee_id: employeeId,
    month: monthStr,
    base_salary: gross,
    working_days: workingDaysInMonth,
    present_days: +present.toFixed(2),
    paid_leave: +paidLeave.toFixed(2),
    unpaid_days: +unpaid.toFixed(2),
    paid_days: paidDays,
    per_day: +perDay.toFixed(2),
    gross,
    deductions: totalDeductions,
    reimbursements: +reimb.toFixed(2),
    net_salary: net,
    breakup: JSON.stringify(breakup),
  };
}

/** Computes and saves (upsert) a payslip row. Returns the saved row. */
function generatePayslip(employeeId, monthStr) {
  const p = computePayroll(employeeId, monthStr);
  db.prepare(
    `INSERT INTO payslips
       (employee_id, month, base_salary, working_days, present_days, paid_leave,
        unpaid_days, paid_days, per_day, gross, deductions, reimbursements, net_salary, breakup, generated_at)
     VALUES
       (@employee_id, @month, @base_salary, @working_days, @present_days, @paid_leave,
        @unpaid_days, @paid_days, @per_day, @gross, @deductions, @reimbursements, @net_salary, @breakup, datetime('now'))
     ON CONFLICT(employee_id, month) DO UPDATE SET
        base_salary=@base_salary, working_days=@working_days, present_days=@present_days,
        paid_leave=@paid_leave, unpaid_days=@unpaid_days, paid_days=@paid_days,
        per_day=@per_day, gross=@gross, deductions=@deductions,
        reimbursements=@reimbursements, net_salary=@net_salary, breakup=@breakup, generated_at=datetime('now')`
  ).run(p);

  return db
    .prepare('SELECT * FROM payslips WHERE employee_id = ? AND month = ?')
    .get(employeeId, monthStr);
}

module.exports = { computePayroll, generatePayslip, datesInMonth, weekday };
