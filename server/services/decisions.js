const db = require('./../db');
const { sendMail } = require('./email');
const { notifyUsers } = require('./notify');

// Applies an approve/reject decision to a leave request. Idempotent-ish:
// if already decided, returns the current state without re-notifying.
async function applyLeaveDecision(id, decision, comment, approverUserId) {
  const lr = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!lr) return { ok: false, notFound: true };
  // Re-clicking the same decision (e.g. an email link twice) is a no-op.
  if (lr.status === decision) return { ok: true, already: true, leave: lr };
  const wasApproved = lr.status === 'approved';

  await db.prepare("UPDATE leave_requests SET status = ?, comment = ?, approver_id = ?, decided_at = datetime('now') WHERE id = ?")
    .run(decision, comment || '', approverUserId || null, lr.id);

  const markStatus = lr.half_day ? 'half' : 'leave';
  // Iterate dates as local YYYY-MM-DD strings (avoid UTC off-by-one).
  const addDays = (ds, n) => {
    const [y, m, d] = ds.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  if (decision === 'approved') {
    for (let ds = lr.from_date; ds <= lr.to_date; ds = addDays(ds, 1)) {
      const ex = await db.prepare('SELECT id, check_in, status FROM attendance WHERE employee_id = ? AND date = ?').get(lr.employee_id, ds);
      if (!ex) await db.prepare('INSERT INTO attendance (employee_id, date, status) VALUES (?, ?, ?)').run(lr.employee_id, ds, markStatus);
      // Only fill a blank/absent placeholder — never overwrite a real check-in
      // or a status synced from Slack/Sheets/Excel (e.g. an existing 'present').
      else if (!ex.check_in && (!ex.status || ex.status === 'absent')) await db.prepare('UPDATE attendance SET status = ? WHERE id = ?').run(markStatus, ex.id);
    }
  } else if (wasApproved) {
    // Reversing a previously-approved leave: delete ONLY the placeholder rows we
    // created for it (this leave's mark, no real check-in). This frees the
    // balance (balanceFor counts approved days) and un-corrupts attendance/payroll.
    for (let ds = lr.from_date; ds <= lr.to_date; ds = addDays(ds, 1)) {
      const ex = await db.prepare('SELECT id, check_in, status FROM attendance WHERE employee_id = ? AND date = ?').get(lr.employee_id, ds);
      if (ex && !ex.check_in && ex.status === markStatus) await db.prepare('DELETE FROM attendance WHERE id = ?').run(ex.id);
    }
  }

  const emp = await db.prepare('SELECT name, email, user_id FROM employees WHERE id = ?').get(lr.employee_id);
  // In-app bell notification (works even when email is not configured).
  if (emp && emp.user_id) {
    await notifyUsers([emp.user_id], {
      type: 'leave',
      title: `Leave ${decision} ${decision === 'approved' ? '✅' : '❌'}`,
      body: `Your ${lr.type} leave from ${lr.from_date} to ${lr.to_date} (${lr.days} day(s)) was ${decision}.${comment ? ' Comment: ' + comment : ''}`,
      link: '#/my-leave',
    });
  }
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

  const emp = await db.prepare('SELECT name, email, user_id FROM employees WHERE id = ?').get(row.employee_id);
  // In-app bell notification (works even when email is not configured).
  if (emp && emp.user_id) {
    await notifyUsers([emp.user_id], {
      type: 'reimbursement',
      title: `Reimbursement ${decision} ${decision === 'approved' ? '✅' : '❌'}`,
      body: `Your reimbursement "${row.title}" of ${row.amount} was ${decision}.${comment ? ' Comment: ' + comment : ''}`,
      link: '#/my-reimb',
    });
  }
  if (emp && emp.email) {
    await sendMail({
      to: emp.email,
      subject: `Reimbursement ${decision}`,
      html: `<p>Hi ${emp.name},</p><p>Your reimbursement "<b>${row.title}</b>" of amount ${row.amount} has been <b>${decision}</b>.</p>${comment ? `<p>Comment: ${comment}</p>` : ''}`,
    });
  }
  return { ok: true, reimbursement: { ...row, status: decision }, employee: emp };
}

// Finds who should approve a given employee's requests. Returns
// [{ userId, email, name }] so each approver can get a PERSONAL action link
// (and the decision records who clicked).
// kind = 'leave' (manager or HR) or 'reimbursement' (manager or Finance).
async function approversFor(employeeId, kind) {
  const emp = await db.prepare('SELECT manager_id FROM employees WHERE id = ?').get(employeeId);
  const out = [];
  const seen = new Set();
  const add = (userId, email, name) => {
    if (!email || seen.has(email.toLowerCase())) return;
    seen.add(email.toLowerCase());
    out.push({ userId: userId || null, email, name: name || email });
  };
  if (emp && emp.manager_id) {
    const mgr = await db.prepare('SELECT user_id, email, name FROM employees WHERE id = ?').get(emp.manager_id);
    if (mgr) add(mgr.user_id, mgr.email, mgr.name);
  }
  // Always also notify the relevant admins.
  const roles = kind === 'reimbursement' ? ['FINANCE_ADMIN', 'SUPER_ADMIN'] : ['HR_ADMIN', 'SUPER_ADMIN'];
  const admins = await db.prepare(
    `SELECT u.id, u.email, (SELECT name FROM employees e WHERE e.user_id = u.id) AS name
     FROM users u WHERE u.role IN (${roles.map(() => '?').join(',')}) AND u.email IS NOT NULL`
  ).all(...roles);
  for (const a of admins) add(a.id, a.email, a.name);
  return out;
}

// Back-compat: just the email list.
async function approverEmailsFor(employeeId, kind) {
  return (await approversFor(employeeId, kind)).map((a) => a.email);
}

module.exports = { applyLeaveDecision, applyReimbursementDecision, approverEmailsFor, approversFor };
