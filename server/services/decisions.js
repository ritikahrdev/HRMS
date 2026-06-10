const db = require('./../db');
const { sendMail } = require('./email');

// Applies an approve/reject decision to a leave request. Idempotent-ish:
// if already decided, returns the current state without re-notifying.
async function applyLeaveDecision(id, decision, comment, approverUserId) {
  const lr = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!lr) return { ok: false, notFound: true };
  if (lr.status !== 'pending') return { ok: true, already: true, leave: lr };

  await db.prepare("UPDATE leave_requests SET status = ?, comment = ?, approver_id = ?, decided_at = datetime('now') WHERE id = ?")
    .run(decision, comment || '', approverUserId || null, lr.id);

  if (decision === 'approved') {
    const markStatus = lr.half_day ? 'half' : 'leave';
    // Iterate dates as local YYYY-MM-DD strings (avoid UTC off-by-one).
    const addDays = (ds, n) => {
      const [y, m, d] = ds.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + n);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    for (let ds = lr.from_date; ds <= lr.to_date; ds = addDays(ds, 1)) {
      const ex = await db.prepare('SELECT id, check_in FROM attendance WHERE employee_id = ? AND date = ?').get(lr.employee_id, ds);
      if (!ex) await db.prepare('INSERT INTO attendance (employee_id, date, status) VALUES (?, ?, ?)').run(lr.employee_id, ds, markStatus);
      else if (!ex.check_in) await db.prepare('UPDATE attendance SET status = ? WHERE id = ?').run(markStatus, ex.id);
    }
  }

  const emp = await db.prepare('SELECT name, email FROM employees WHERE id = ?').get(lr.employee_id);
  if (emp && emp.email) {
    await sendMail({
      to: emp.email,
      subject: `Leave request ${decision}`,
      html: `<p>Hi ${emp.name},</p><p>Your ${lr.type} leave from <b>${lr.from_date}</b> to <b>${lr.to_date}</b> (${lr.days} day(s)) has been <b>${decision}</b>.</p>${comment ? `<p>Comment: ${comment}</p>` : ''}`,
    });
  }
  return { ok: true, leave: { ...lr, status: decision }, employee: emp };
}

async function applyReimbursementDecision(id, decision, comment, approverUserId) {
  const row = await db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(id);
  if (!row) return { ok: false, notFound: true };
  if (row.status !== 'pending') return { ok: true, already: true, reimbursement: row };

  await db.prepare("UPDATE reimbursements SET status = ?, comment = ?, approver_id = ?, decided_at = datetime('now') WHERE id = ?")
    .run(decision, comment || '', approverUserId || null, row.id);

  const emp = await db.prepare('SELECT name, email FROM employees WHERE id = ?').get(row.employee_id);
  if (emp && emp.email) {
    await sendMail({
      to: emp.email,
      subject: `Reimbursement ${decision}`,
      html: `<p>Hi ${emp.name},</p><p>Your reimbursement "<b>${row.title}</b>" of amount ${row.amount} has been <b>${decision}</b>.</p>${comment ? `<p>Comment: ${comment}</p>` : ''}`,
    });
  }
  return { ok: true, reimbursement: { ...row, status: decision }, employee: emp };
}

// Finds who should approve a given employee's requests and returns their emails.
// kind = 'leave' (manager or HR) or 'reimbursement' (manager or Finance).
async function approverEmailsFor(employeeId, kind) {
  const emp = await db.prepare('SELECT manager_id FROM employees WHERE id = ?').get(employeeId);
  const emails = [];
  if (emp && emp.manager_id) {
    const mgr = await db.prepare('SELECT email FROM employees WHERE id = ?').get(emp.manager_id);
    if (mgr && mgr.email) emails.push(mgr.email);
  }
  // Always also notify the relevant admins.
  const roles = kind === 'reimbursement' ? ['FINANCE_ADMIN', 'SUPER_ADMIN'] : ['HR_ADMIN', 'SUPER_ADMIN'];
  const admins = await db.prepare(
    `SELECT email FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND email IS NOT NULL`
  ).all(...roles);
  for (const a of admins) if (a.email && !emails.includes(a.email)) emails.push(a.email);
  return emails;
}

module.exports = { applyLeaveDecision, applyReimbursementDecision, approverEmailsFor };
