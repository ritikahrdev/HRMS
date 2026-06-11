const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');
const { can } = require('../services/permissions');
const { notifyUsers } = require('../services/notify');
const { getSettings } = require('../services/settings');
const { sendMail } = require('../services/email');

const router = express.Router();

const REASONS = {
  resignation: 'Resignation',
  termination: 'Termination',
  retirement: 'Retirement',
  end_of_contract: 'End of Contract',
  absconding: 'Absconding',
  other: 'Other',
};

// Standard clearance checklist created with every exit. owner = department that acts.
const EXIT_CHECKLIST = [
  { title: 'Submit resignation / exit acknowledgement', owner: 'employee' },
  { title: 'Knowledge transfer & handover document', owner: 'employee' },
  { title: "Manager's handover sign-off & clearance", owner: 'manager' },
  { title: 'Return laptop, assets & access/ID card', owner: 'it' },
  { title: 'Revoke email & all system accounts', owner: 'it' },
  { title: 'Recover company dues / outstanding advances', owner: 'finance' },
  { title: 'Process Full & Final settlement (FnF)', owner: 'finance' },
  { title: 'Conduct exit interview', owner: 'hr' },
  { title: 'Issue experience & relieving letter', owner: 'hr' },
];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z'); if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Build a Full & Final settlement summary for an employee (best-effort estimate).
async function settlementFor(employeeId, lastWorkingDay) {
  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return null;
  const s = getSettings();
  const monthly = Number(emp.monthly_salary || 0);
  const perDay = monthly ? +(monthly / 30).toFixed(2) : 0;

  // Days worked in the last working month up to LWD (simple pro-rata on 30-day basis).
  const lwd = lastWorkingDay || todayStr();
  const dayOfMonth = Number(lwd.slice(8, 10)) || 0;
  const lastMonthSalary = +(perDay * dayOfMonth).toFixed(2);

  // Leave encashment = remaining paid leave balance * per-day.
  let leaveBalanceDays = 0;
  try {
    const year = new Date().getFullYear();
    const types = (s.leaveTypes || []).filter((t) => t.paid !== false && t.code !== 'unpaid' && t.code !== 'comp_off');
    const accrual = require('../services/leaveAccrual');
    for (const t of types) {
      const usedRow = await db.prepare(
        "SELECT COALESCE(SUM(days),0) AS d FROM leave_requests WHERE employee_id=? AND type=? AND status='approved' AND substr(from_date,1,4)=?"
      ).get(employeeId, t.code, String(year));
      const allowed = (accrual.isEnabled() && accrual.accrualRules()[t.code])
        ? await accrual.ledgerAllowed(employeeId, t.code, year)
        : (t.quota || 0);
      leaveBalanceDays += Math.max(0, allowed - Number(usedRow.d));
    }
  } catch (e) { /* leave optional */ }
  leaveBalanceDays = +leaveBalanceDays.toFixed(1);
  const leaveEncashment = +(leaveBalanceDays * perDay).toFixed(2);

  // Outstanding loan/advance balance is recovered (deduction).
  const loanRow = await db.prepare("SELECT COALESCE(SUM(COALESCE(balance, amount)),0) AS s FROM loans WHERE employee_id=? AND status='active'").get(employeeId);
  const loanRecovery = +Number(loanRow.s).toFixed(2);

  const gross = +(lastMonthSalary + leaveEncashment).toFixed(2);
  const net = +(gross - loanRecovery).toFixed(2);
  return {
    currency: s.currency || '₹',
    monthly, perDay, daysWorkedLastMonth: dayOfMonth, lastMonthSalary,
    leaveBalanceDays, leaveEncashment, loanRecovery, gross, net,
  };
}

// Active exit for an employee, if any.
async function activeExit(employeeId) {
  return db.prepare("SELECT * FROM exits WHERE employee_id=? AND status IN ('initiated','in_progress') ORDER BY id DESC LIMIT 1").get(employeeId);
}

async function loadTasks(exitId) {
  return db.prepare('SELECT * FROM exit_tasks WHERE exit_id = ? ORDER BY position, id').all(exitId);
}

async function hrUserIds() {
  const rows = await db.prepare("SELECT id FROM users WHERE role IN ('SUPER_ADMIN','HR_ADMIN')").all();
  return rows.map((r) => r.id);
}

// ---- List all exits (HR) --------------------------------------------------
router.get('/', requirePerm('offboarding:manage'), async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT x.*, e.name AS employee_name, e.emp_code, e.department, e.designation
       FROM exits x JOIN employees e ON e.id = x.employee_id
       ORDER BY CASE x.status WHEN 'initiated' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END, x.created_at DESC`
    ).all();
    // progress for each
    for (const r of rows) {
      const t = await db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(done),0) AS done FROM exit_tasks WHERE exit_id = ?').get(r.id);
      r.tasks_total = Number(t.total); r.tasks_done = Number(t.done);
    }
    const counts = await db.prepare(
      "SELECT status, COUNT(*) AS c FROM exits GROUP BY status"
    ).all();
    const summary = { initiated: 0, in_progress: 0, completed: 0, cancelled: 0 };
    for (const c of counts) summary[c.status] = Number(c.c);
    res.json({ exits: rows, summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Initiate an exit (HR) ------------------------------------------------
router.post('/', requirePerm('offboarding:manage'), async (req, res) => {
  try {
    const { employee_id, reason, reason_detail, resignation_date, notice_days } = req.body || {};
    if (!employee_id) return res.status(400).json({ error: 'Employee is required.' });
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (emp.status !== 'active') return res.status(400).json({ error: 'This employee is not active.' });
    if (await activeExit(employee_id)) return res.status(400).json({ error: 'An exit is already in progress for this employee.' });

    const notice = Number(notice_days != null ? notice_days : 30);
    const resignDate = resignation_date || todayStr();
    const lwd = addDays(resignDate, notice);

    const r = await db.prepare(
      `INSERT INTO exits (employee_id, reason, reason_detail, resignation_date, notice_days, last_working_day, status, initiated_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', 'hr', ?)`
    ).run(employee_id, REASONS[reason] ? reason : 'resignation', reason_detail || '', resignDate, notice, lwd, req.session.user.id);
    const exitId = r.lastInsertRowid;

    const ins = db.prepare('INSERT INTO exit_tasks (exit_id, title, owner, position) VALUES (?, ?, ?, ?)');
    let pos = 0;
    for (const t of EXIT_CHECKLIST) await ins.run(exitId, t.title, t.owner, ++pos);

    // Notify HR + the employee's manager.
    const ids = await hrUserIds();
    if (emp.manager_id) {
      const mgr = await db.prepare('SELECT user_id FROM employees WHERE id = ?').get(emp.manager_id);
      if (mgr && mgr.user_id) ids.push(mgr.user_id);
    }
    await notifyUsers([...new Set(ids)], {
      type: 'offboarding',
      title: `Offboarding started: ${emp.name}`,
      body: `Last working day ${lwd}. ${EXIT_CHECKLIST.length} clearance tasks created.`,
      link: '#/offboarding',
    });

    res.json({ id: exitId, last_working_day: lwd });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Employee initiates their own resignation -----------------------------
router.post('/resign', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'Your login is not linked to an employee profile.' });
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
    if (!emp || emp.status !== 'active') return res.status(400).json({ error: 'Your profile is not active.' });
    if (await activeExit(empId)) return res.status(400).json({ error: 'You already have a resignation in progress.' });

    const { reason_detail, last_working_day } = req.body || {};
    const notice = Number(getSettings().noticePeriodDays || 30);
    const resignDate = todayStr();
    const lwd = last_working_day || addDays(resignDate, notice);

    const r = await db.prepare(
      `INSERT INTO exits (employee_id, reason, reason_detail, resignation_date, notice_days, last_working_day, status, initiated_by, created_by)
       VALUES (?, 'resignation', ?, ?, ?, ?, 'initiated', 'employee', ?)`
    ).run(empId, reason_detail || '', resignDate, notice, lwd, req.session.user.id);

    // Notify HR to review & process.
    await notifyUsers(await hrUserIds(), {
      type: 'offboarding',
      title: `Resignation submitted: ${emp.name}`,
      body: `${emp.name} has submitted a resignation. Requested last working day: ${lwd}.`,
      link: '#/offboarding',
    });
    res.json({ id: r.lastInsertRowid, last_working_day: lwd });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee views their own exit status (if any).
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.json({ exit: null });
    const x = await db.prepare("SELECT * FROM exits WHERE employee_id=? ORDER BY id DESC LIMIT 1").get(empId);
    if (!x) return res.json({ exit: null });
    const tasks = await loadTasks(x.id);
    res.json({ exit: x, tasks: tasks.map((t) => ({ title: t.title, owner: t.owner, done: t.done })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Single exit detail (HR) ----------------------------------------------
router.get('/:id', requirePerm('offboarding:manage'), async (req, res) => {
  try {
    const x = await db.prepare(
      `SELECT x.*, e.name AS employee_name, e.emp_code, e.department, e.designation, e.date_of_joining, e.email
       FROM exits x JOIN employees e ON e.id = x.employee_id WHERE x.id = ?`
    ).get(req.params.id);
    if (!x) return res.status(404).json({ error: 'Not found.' });
    const tasks = await loadTasks(x.id);
    const settlement = x.settlement ? JSON.parse(x.settlement) : await settlementFor(x.employee_id, x.last_working_day);
    res.json({ exit: x, tasks, settlement, reasons: REASONS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Toggle a clearance task.
router.post('/:id/tasks/:taskId/toggle', requirePerm('offboarding:manage'), async (req, res) => {
  try {
    const t = await db.prepare('SELECT * FROM exit_tasks WHERE id = ? AND exit_id = ?').get(req.params.taskId, req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found.' });
    const done = t.done ? 0 : 1;
    await db.prepare("UPDATE exit_tasks SET done = ?, done_at = CASE WHEN ?=1 THEN datetime('now') ELSE NULL END, done_by = ? WHERE id = ?")
      .run(done, done, done ? req.session.user.name || 'staff' : null, t.id);
    res.json({ ok: true, done });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edit exit fields (reason, dates, notice, rehire, notes).
router.patch('/:id', requirePerm('offboarding:manage'), async (req, res) => {
  try {
    const x = await db.prepare('SELECT * FROM exits WHERE id = ?').get(req.params.id);
    if (!x) return res.status(404).json({ error: 'Not found.' });
    if (x.status === 'completed') return res.status(400).json({ error: 'This exit is already completed.' });
    const b = req.body || {};
    const reason = REASONS[b.reason] ? b.reason : x.reason;
    const notice = b.notice_days != null ? Number(b.notice_days) : x.notice_days;
    const resignDate = b.resignation_date || x.resignation_date;
    const lwd = b.last_working_day || x.last_working_day;
    const rehire = b.rehire_eligible != null ? (b.rehire_eligible ? 1 : 0) : x.rehire_eligible;
    await db.prepare(
      `UPDATE exits SET reason=?, reason_detail=?, resignation_date=?, notice_days=?, last_working_day=?, rehire_eligible=?, exit_notes=?, status=CASE WHEN status='initiated' THEN 'in_progress' ELSE status END WHERE id=?`
    ).run(reason, b.reason_detail != null ? b.reason_detail : x.reason_detail, resignDate, notice, lwd, rehire, b.exit_notes != null ? b.exit_notes : x.exit_notes, x.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Complete the exit: deactivate the employee, snapshot the settlement.
router.post('/:id/complete', requirePerm('offboarding:manage'), async (req, res) => {
  try {
    const x = await db.prepare('SELECT * FROM exits WHERE id = ?').get(req.params.id);
    if (!x) return res.status(404).json({ error: 'Not found.' });
    if (x.status === 'completed') return res.status(400).json({ error: 'Already completed.' });
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(x.employee_id);
    const pending = await db.prepare('SELECT COUNT(*) AS c FROM exit_tasks WHERE exit_id = ? AND done = 0').get(x.id);
    if (Number(pending.c) > 0 && !(req.body && req.body.force)) {
      return res.status(400).json({ error: `${pending.c} clearance task(s) are still pending. Finish them or pass force to override.`, pending: Number(pending.c) });
    }
    const settlement = await settlementFor(x.employee_id, x.last_working_day);
    await db.withTransaction(async (tx) => {
      await tx.prepare("UPDATE exits SET status='completed', completed_at=datetime('now'), settlement=? WHERE id=?").run(JSON.stringify(settlement), x.id);
      await tx.prepare("UPDATE employees SET status='inactive' WHERE id=?").run(x.employee_id);
    });

    // Free any assets/inventory still assigned to them.
    await db.prepare("UPDATE assets SET employee_id=NULL, status='available' WHERE employee_id=?").run(x.employee_id).catch(() => {});
    await db.prepare("UPDATE inventory SET assigned_to=NULL, available=quantity WHERE assigned_to=?").run(x.employee_id).catch(() => {});

    if (emp && emp.email) {
      await sendMail({
        to: emp.email,
        subject: 'Your offboarding is complete',
        html: `<p>Hi ${emp.name},</p><p>Your exit formalities are complete and your last working day was <b>${x.last_working_day}</b>.</p>
          <p>Indicative Full & Final settlement: <b>${settlement.currency}${settlement.net.toLocaleString('en-IN')}</b> (including ${settlement.leaveBalanceDays} day(s) leave encashment). Finance will share the final figure.</p>
          <p>We wish you all the best for the future. 🙏</p>`,
      }).catch(() => {});
    }
    res.json({ ok: true, settlement });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cancel / withdraw an exit (reactivates nothing — employee was never deactivated yet).
router.post('/:id/cancel', requirePerm('offboarding:manage'), async (req, res) => {
  try {
    const x = await db.prepare('SELECT * FROM exits WHERE id = ?').get(req.params.id);
    if (!x) return res.status(404).json({ error: 'Not found.' });
    if (x.status === 'completed') return res.status(400).json({ error: 'A completed exit cannot be cancelled.' });
    await db.prepare("UPDATE exits SET status='cancelled' WHERE id=?").run(x.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
