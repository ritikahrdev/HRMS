const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { requireLogin, requirePerm, canActOnEmployee } = require('../middleware/auth');
const { provisionAccountsForOnboarding, accountsForDepartment } = require('../services/accountSetup');
const { createEmployee } = require('../services/employees');
const { getSettings } = require('../services/settings');
const { sendMail } = require('../services/email');
const { escapeHtml } = require('../services/escape');
const {
  OWNERS, STAGES, buildJourney, rebuildJourney, syncAutomatedTasks, sendReminders,
} = require('../services/onboardingJourney');

const router = express.Router();

// Build the public pre-boarding URL for a token.
function preboardUrl(req, token) {
  const base = (config.publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/preboard/${token}`;
}

// How long a pre-boarding link stays valid (hours), from Settings.
function linkHours() {
  const h = Number(getSettings().preboardLinkHours);
  return (h > 0 && h <= 720) ? h : 4;
}

// SQLite "YYYY-MM-DD HH:MM:SS" (UTC) -> ISO so the browser can localise it.
function toIso(s) { return s ? s.replace(' ', 'T') + 'Z' : null; }

// Generate a fresh token + expiry for an employee and return it.
async function issuePreboardToken(employeeId) {
  const token = require('crypto').randomBytes(24).toString('hex');
  await db.prepare("UPDATE employees SET preboard_token = ?, preboard_expires = datetime('now', ?) WHERE id = ?")
    .run(token, '+' + linkHours() + ' hours', employeeId);
  return token;
}

// Email the onboarding/pre-boarding link to the new (upcoming) employee, CC'd to
// the onboarding coordinator (Settings → onboardingCcEmail, defaults to Abhinav).
// Sends to the candidate's personal email (they have no company login yet).
async function sendOnboardingEmail(req, employeeId, token) {
  const emp = await db.prepare('SELECT name, email, personal_email, designation, date_of_joining FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return { emailed: false, emailedTo: null, cc: null };
  const to = (emp.personal_email || emp.email || '').trim();
  const s = getSettings();
  const cc = (s.onboardingCcEmail || 'abhinav@digistay.ai').trim();
  if (!to) return { emailed: false, emailedTo: null, cc };
  const link = preboardUrl(req, token);
  const co = s.companyName || 'the company';
  const designation = emp.designation || 'a valued member of our team';
  // Pretty joining date (e.g. "1 July 2026"), only if one is set.
  let joiningDate = '';
  if (emp.date_of_joining) {
    const d = new Date(emp.date_of_joining + 'T00:00:00Z');
    if (!isNaN(d.getTime())) joiningDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  }
  // Signature = the HR person sending it (name + their designation).
  const u = req.session.user || {};
  const senderName = u.name || 'HR Team';
  let senderTitle = 'HR';
  if (u.employeeId) {
    const se = await db.prepare('SELECT designation FROM employees WHERE id = ?').get(u.employeeId);
    if (se && se.designation) senderTitle = se.designation;
  }
  const r = await sendMail({
    to,
    cc: cc || undefined,
    subject: `Congratulations & welcome to ${co} — complete your onboarding`,
    html: `<p>Hi ${escapeHtml(emp.name)},</p>
      <p>Congratulations once again on your selection as <b>${escapeHtml(designation)}</b> at <b>${escapeHtml(co)}</b>! We're excited to have you join our team and look forward to the creativity and passion you'll bring.${joiningDate ? ` Your joining date will be <b>${escapeHtml(joiningDate)}</b>.` : ''}</p>
      <p>To help us complete the onboarding process smoothly, please fill this form:</p>
      <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Complete your onboarding →</a></p>
      <p style="color:#888;font-size:12px">Or paste this link into your browser:<br>${link}</p>
      <p style="color:#888;font-size:12px">This link is valid for ${linkHours()} hours. If it expires, contact HR for a new one.</p>
      <p>If you have any queries, please feel free to reach out. I'll be happy to assist you.</p>
      <p>Looking forward to working with you.</p>
      <p style="margin:18px 0 0">Best regards,<br><b>${escapeHtml(senderName)}</b><br>${escapeHtml(senderTitle)}</p>`,
  }).catch(() => ({ ok: false }));
  return { emailed: !!(r && r.ok), emailedTo: to, cc };
}

// Onboarding overview: every active employee with their checklist progress,
// newest joiners first. Powers the dedicated Onboarding section. Auto-keyed
// tasks are synced for in-flight hires so the numbers are always live.
router.get('/', requirePerm('employees:write'), async (req, res) => {
  try {
    for (const e of await db.prepare("SELECT id FROM employees WHERE status='active' AND COALESCE(onboarded,0)=0").all()) {
      try { await syncAutomatedTasks(e.id); } catch (err) { /* keep overview resilient */ }
    }
    const rows = await db.prepare(`
      SELECT e.id, e.name, e.department, e.designation, e.date_of_joining, e.status,
        e.onboarded, e.onboarded_at, e.onboarding_submitted, e.onboarding_submitted_at,
        (SELECT COUNT(*) FROM onboarding_tasks t WHERE t.employee_id = e.id) AS total,
        (SELECT COUNT(*) FROM onboarding_tasks t WHERE t.employee_id = e.id AND t.done = 1) AS done,
        (SELECT stage FROM onboarding_tasks t WHERE t.employee_id = e.id AND t.done = 0 ORDER BY t.position LIMIT 1) AS current_stage
      FROM employees e
      WHERE e.status = 'active'
      ORDER BY (e.date_of_joining IS NULL), e.date_of_joining DESC, e.id DESC
    `).all();
    res.json({ employees: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mark several employees as already onboarded in one go. Body: { all: true }
// marks every active employee not yet onboarded; or { ids: [..] } for a subset.
// Defined before '/:employeeId' so "bulk-complete" isn't read as an id.
router.post('/bulk-complete', requirePerm('employees:write'), async (req, res) => {
  try {
    const body = req.body || {};
    let ids;
    if (Array.isArray(body.ids) && body.ids.length) {
      ids = body.ids.map(Number).filter((n) => Number.isInteger(n));
    } else if (body.all) {
      ids = (await db.prepare("SELECT id FROM employees WHERE status = 'active' AND COALESCE(onboarded,0) = 0").all()).map((r) => r.id);
    } else {
      return res.status(400).json({ error: 'Provide { all: true } or { ids: [...] }.' });
    }
    const upd = db.prepare("UPDATE employees SET onboarded = 1, onboarded_at = datetime('now') WHERE id = ?");
    let count = 0;
    for (const id of ids) count += (await upd.run(id)).changes;
    res.json({ ok: true, count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a pre-hire (a candidate, with NO company login yet), build their
// onboarding journey, and hand back a private pre-boarding link to share.
// Defined before '/:employeeId' so "preboard" isn't read as an id.
router.post('/preboard', requirePerm('employees:write'), async (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Candidate name is required.' });
  try {
    const { employee } = await createEmployee({
      name,
      department: b.department || '',
      designation: b.designation || '',
      date_of_joining: b.date_of_joining || '',
    }, { createLogin: false });
    const extra = {};
    if (b.personal_email) extra.personal_email = String(b.personal_email).trim();
    if (b.phone) extra.phone = String(b.phone).trim();
    if (Object.keys(extra).length) {
      const setClause = Object.keys(extra).map((k) => `${k} = @${k}`).join(', ');
      await db.prepare(`UPDATE employees SET ${setClause} WHERE id = @id`).run({ ...extra, id: employee.id });
    }
    await db.prepare('UPDATE employees SET onboarded = 0, onboarded_at = NULL, onboarding_submitted = 0, onboarding_submitted_at = NULL WHERE id = ?').run(employee.id);
    await buildJourney(employee.id);
    const token = await issuePreboardToken(employee.id);
    const exp = (await db.prepare('SELECT preboard_expires FROM employees WHERE id = ?').get(employee.id)).preboard_expires;
    // Auto-email the onboarding link to the upcoming employee (CC the coordinator).
    const mail = await sendOnboardingEmail(req, employee.id, token);
    res.json({ ok: true, employeeId: employee.id, url: preboardUrl(req, token), expiresAt: toIso(exp), hours: linkHours(), ...mail });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Generate (or return) a pre-boarding link for an existing employee record.
// A fresh link is issued if none exists, if asked to regenerate, or if the
// current one has already expired — so "Generate" always yields a working link.
router.post('/:employeeId/preboard-link', requirePerm('employees:write'), async (req, res) => {
  try {
    const emp = await db.prepare("SELECT id, preboard_token, (preboard_expires IS NOT NULL AND preboard_expires <= datetime('now')) AS expired FROM employees WHERE id = ?").get(req.params.employeeId);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    let token = emp.preboard_token;
    if (!token || (req.body && req.body.regenerate) || emp.expired) {
      token = await issuePreboardToken(emp.id);
    }
    const exp = (await db.prepare('SELECT preboard_expires FROM employees WHERE id = ?').get(emp.id)).preboard_expires;
    // Optionally (re)send the onboarding email to the employee when asked.
    const mail = (req.body && req.body.email) ? await sendOnboardingEmail(req, emp.id, token) : {};
    res.json({ ok: true, token, url: preboardUrl(req, token), expiresAt: toIso(exp), hours: linkHours(), ...mail });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Revoke the pre-boarding link (the URL stops working immediately).
router.post('/:employeeId/preboard-revoke', requirePerm('employees:write'), async (req, res) => {
  try {
    await db.prepare('UPDATE employees SET preboard_token = NULL WHERE id = ?').run(req.params.employeeId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// View an employee's onboarding journey (self or manager/HR). Runs the
// automation first so self-completing tasks reflect the latest state.
router.get('/:employeeId', requireLogin, async (req, res) => {
  try {
    if (!await canActOnEmployee(req, req.params.employeeId)) return res.status(403).json({ error: 'No access.' });
    try { await syncAutomatedTasks(req.params.employeeId); } catch (e) { /* non-fatal */ }
    const tasks = await db.prepare('SELECT * FROM onboarding_tasks WHERE employee_id = ? ORDER BY position, id').all(req.params.employeeId);
    const emp = await db.prepare("SELECT preboard_token, preboard_expires, onboarding_submitted, (preboard_expires IS NOT NULL AND preboard_expires <= datetime('now')) AS expired FROM employees WHERE id = ?").get(req.params.employeeId);
    // Only HR/managers (write access) get the actual link back, not the employee.
    const canManage = req.session.user.role !== 'EMPLOYEE';
    const preboard = {
      hasLink: !!(emp && emp.preboard_token),
      url: (canManage && emp && emp.preboard_token) ? preboardUrl(req, emp.preboard_token) : null,
      submitted: !!(emp && emp.onboarding_submitted),
      expiresAt: toIso(emp && emp.preboard_expires),
      expired: !!(emp && emp.expired),
    };
    res.json({ tasks, owners: OWNERS, stages: STAGES, preboard });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run the automation on demand and report what it ticked off.
router.post('/:employeeId/sync', requirePerm('employees:write'), async (req, res) => {
  try {
    res.json(await syncAutomatedTasks(req.params.employeeId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Nudge each task owner about their pending onboarding tasks.
router.post('/:employeeId/remind', requirePerm('employees:write'), async (req, res) => {
  try {
    res.json(await sendReminders(req.params.employeeId, req.session.user.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rebuild the journey from scratch (wipes existing tasks).
router.post('/:employeeId/rebuild', requirePerm('employees:write'), async (req, res) => {
  try {
    const added = await rebuildJourney(req.params.employeeId);
    await provisionAccountsForOnboarding(req.params.employeeId, req.session.user.id);
    await syncAutomatedTasks(req.params.employeeId);
    res.json({ ok: true, added });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add a task (HR/employee-write).
router.post('/:employeeId', requirePerm('employees:write'), async (req, res) => {
  try {
    const title = (req.body && req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Task title required.' });
    const max = (await db.prepare('SELECT COALESCE(MAX(position),0) m FROM onboarding_tasks WHERE employee_id = ?').get(req.params.employeeId)).m;
    const r = await db.prepare('INSERT INTO onboarding_tasks (employee_id, title, position) VALUES (?, ?, ?)').run(req.params.employeeId, title, max + 1);
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start onboarding (HR): build the full automated journey, provision the
// department's accounts, and run the automation once.
router.post('/:employeeId/template', requirePerm('employees:write'), async (req, res) => {
  try {
    const existing = (await db.prepare('SELECT COUNT(*) c FROM onboarding_tasks WHERE employee_id = ?').get(req.params.employeeId)).c;
    if (existing) return res.status(400).json({ error: 'An onboarding journey already exists for this employee.' });
    const added = await buildJourney(req.params.employeeId);
    const setup = await provisionAccountsForOnboarding(req.params.employeeId, req.session.user.id);
    await syncAutomatedTasks(req.params.employeeId);
    res.json({ ok: true, added, accountSetup: setup });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// What accounts does this employee's department require? (for the UI preview)
router.get('/:employeeId/account-setup', requireLogin, async (req, res) => {
  try {
    if (!await canActOnEmployee(req, req.params.employeeId)) return res.status(403).json({ error: 'No access.' });
    const emp = await db.prepare('SELECT department FROM employees WHERE id = ?').get(req.params.employeeId);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ department: (emp.department || '').trim() || 'General', accounts: accountsForDepartment(emp.department) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Notify managers/IT to create the department's required accounts (HR action).
// Also drops "Create account: X" tasks onto the checklist. Idempotent + re-sendable.
router.post('/:employeeId/account-setup', requirePerm('employees:write'), async (req, res) => {
  try {
    const result = await provisionAccountsForOnboarding(req.params.employeeId, req.session.user.id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mark a single employee as onboarded (complete) or reopen onboarding.
router.post('/:employeeId/complete', requirePerm('employees:write'), async (req, res) => {
  try {
    const r = await db.prepare("UPDATE employees SET onboarded = 1, onboarded_at = datetime('now') WHERE id = ?").run(req.params.employeeId);
    if (!r.changes) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:employeeId/reopen', requirePerm('employees:write'), async (req, res) => {
  try {
    const r = await db.prepare('UPDATE employees SET onboarded = 0, onboarded_at = NULL WHERE id = ?').run(req.params.employeeId);
    if (!r.changes) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle a task done (self or HR).
router.put('/task/:id', requireLogin, async (req, res) => {
  try {
    const t = await db.prepare('SELECT * FROM onboarding_tasks WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!await canActOnEmployee(req, t.employee_id)) return res.status(403).json({ error: 'No access.' });
    await db.prepare('UPDATE onboarding_tasks SET done = ? WHERE id = ?').run(req.body && req.body.done ? 1 : 0, t.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/task/:id', requirePerm('employees:write'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM onboarding_tasks WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
