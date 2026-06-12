const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { requireLogin, requirePerm, requireSuperAdmin, canActOnEmployee, teamEmployeeIds } = require('../middleware/auth');
const { createEmployee, FIELDS, SELF_ONBOARDING_FIELDS, ONBOARDING_REQUIRED_FIELDS, makeTempPassword, normaliseRole } = require('../services/employees');
const { upload, documentUpload, memoryUpload } = require('../services/upload');
const { saveFile, getFile, deleteFile, sendFile } = require('../services/filestore');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');
const { validatePAN, validateAadhaar, validateIFSC } = require('../services/verify');
const aadhaarOffline = require('../services/aadhaarOffline');
const { notifyUsers } = require('../services/notify');
const { can } = require('../services/permissions');
const { syncAutomatedTasks } = require('../services/onboardingJourney');

const router = express.Router();

const LIST_SQL = `
  SELECT e.*, u.role AS role,
         (SELECT name FROM employees m WHERE m.id = e.manager_id) AS manager_name
  FROM employees e LEFT JOIN users u ON u.id = e.user_id`;

// List all employees (HR / Finance / Super Admin).
// By default excludes archived employees; pass ?includeArchived=1 to see them too.
router.get('/', requirePerm('employees:read'), async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
    const sql = includeArchived
      ? LIST_SQL + ' ORDER BY e.name'
      : LIST_SQL + " WHERE e.status != 'archived' ORDER BY e.name";
    res.json({ employees: await db.prepare(sql).all() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Workforce statistics (active employees, with overall counts).
router.get('/stats', requirePerm('employees:read'), async (req, res) => {
  try {
    const W = "status = 'active'";
    const groupCount = (col) => db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(${col}), ''), 'Not set') AS label, COUNT(*) AS count
       FROM employees WHERE ${W} GROUP BY label ORDER BY count DESC, label`
    ).all();

    const totalActive = (await db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${W}`).get()).n;
    const totalArchived = (await db.prepare("SELECT COUNT(*) AS n FROM employees WHERE status='archived'").get()).n;
    const managers = (await db.prepare(
      `SELECT COUNT(DISTINCT manager_id) AS n FROM employees WHERE ${W} AND manager_id IS NOT NULL`
    ).get()).n;
    const withLogin = (await db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${W} AND user_id IS NOT NULL`).get()).n;

    // New joiners this month + this year.
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const newThisMonth = (await db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${W} AND substr(date_of_joining,1,7) = ?`).get(ym)).n;
    const newThisYear = (await db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${W} AND substr(date_of_joining,1,4) = ?`).get(String(now.getFullYear()))).n;

    res.json({
      totalActive,
      totalArchived,
      managers,
      withLogin,
      newThisMonth,
      newThisYear,
      byDepartment: await groupCount('department'),
      byType: await groupCount('employee_type'),
      byGender: await groupCount('gender'),
      byWorkMode: await groupCount('work_mode'),
      byBloodGroup: await groupCount('blood_group'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Staff directory — any logged-in user sees safe contact fields of active staff.
router.get('/directory', requireLogin, async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT e.id, e.name, e.emp_code, e.department, e.designation, e.email, e.phone, e.manager_id,
              (SELECT name FROM employees m WHERE m.id = e.manager_id) AS manager_name
       FROM employees e WHERE e.status = 'active' ORDER BY e.name`
    ).all();
    res.json({ employees: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upcoming birthdays & work anniversaries (next 30 days) for dashboards.
router.get('/celebrations', requireLogin, async (req, res) => {
  try {
    const rows = await db.prepare(
      "SELECT name, department, dob, date_of_joining FROM employees WHERE status = 'active'"
    ).all();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const windowEnd = new Date(today); windowEnd.setDate(windowEnd.getDate() + 30);
    // Next occurrence of a stored date's month-day; null if unparseable.
    const nextOccurrence = (iso) => {
      const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      let d = new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[3]));
      if (d < today) d = new Date(today.getFullYear() + 1, Number(m[2]) - 1, Number(m[3]));
      return { when: d, origYear: Number(m[1]) };
    };
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const birthdays = [], anniversaries = [];
    for (const r of rows) {
      const b = nextOccurrence(r.dob);
      if (b && b.when <= windowEnd) {
        birthdays.push({ name: r.name, department: r.department, date: fmt(b.when), isToday: b.when.getTime() === today.getTime() });
      }
      const a = nextOccurrence(r.date_of_joining);
      if (a && a.when <= windowEnd) {
        const years = a.when.getFullYear() - a.origYear;
        if (years >= 1) anniversaries.push({ name: r.name, department: r.department, date: fmt(a.when), years, isToday: a.when.getTime() === today.getTime() });
      }
    }
    birthdays.sort((x, y) => x.date.localeCompare(y.date));
    anniversaries.sort((x, y) => x.date.localeCompare(y.date));
    res.json({ birthdays, anniversaries });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// A manager's direct reports.
router.get('/team', requireLogin, async (req, res) => {
  try {
    const ids = await teamEmployeeIds(req);
    if (ids.length === 0) return res.json({ employees: [] });
    const rows = await db.prepare(LIST_SQL + ` WHERE e.id IN (${ids.map(() => '?').join(',')}) ORDER BY e.name`).all(...ids);
    res.json({ employees: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Current employee's own profile.
router.get('/me', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.json({ employee: null });
    const emp = await db.prepare(LIST_SQL + ' WHERE e.id = ?').get(empId);
    res.json({ employee: emp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Self-service onboarding form: a new hire saves their own personal/joining
// details straight into HRMS (whitelisted fields only). Documents are uploaded
// through the existing /:id/documents endpoint (self-upload is allowed).
router.put('/me/onboarding', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee record is linked to your login. Please contact HR.' });
    // Once submitted, the form is locked — changes go through HR.
    const cur = await db.prepare('SELECT onboarding_submitted FROM employees WHERE id = ?').get(empId);
    if (cur && cur.onboarding_submitted) {
      return res.status(400).json({ error: 'Your onboarding form is already submitted and locked. Please contact HR to change any details.' });
    }
    const updates = {};
    for (const f of SELF_ONBOARDING_FIELDS) {
      if (f in req.body) updates[f] = req.body[f] == null ? null : String(req.body[f]).trim();
    }
    const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    if (setClause) await db.prepare(`UPDATE employees SET ${setClause} WHERE id = @id`).run({ ...updates, id: empId });
    res.json({ employee: await db.prepare(LIST_SQL + ' WHERE e.id = ?').get(empId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The new hire submits the completed form -> notify HR + their manager so the
// documents can be reviewed/verified.
router.post('/me/onboarding/submit', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee record is linked to your login. Please contact HR.' });
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(empId);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (emp.onboarding_submitted) {
      return res.status(400).json({ error: 'Your onboarding form is already submitted. HR has been notified — no need to submit again.' });
    }

    // Enforce: every field filled + every required document uploaded.
    const missingFields = ONBOARDING_REQUIRED_FIELDS.filter((f) => !String(emp[f] == null ? '' : emp[f]).trim());
    const requiredDocs = getSettings().requiredDocs || [];
    const haveTypes = new Set(
      (await db.prepare('SELECT doc_type FROM employee_documents WHERE employee_id = ?').all(empId))
        .filter((d) => d.doc_type).map((d) => d.doc_type)
    );
    const missingDocs = requiredDocs.filter((t) => !haveTypes.has(t));
    if (missingFields.length || missingDocs.length) {
      return res.status(400).json({
        error: 'Please complete all fields and upload all required documents before submitting.',
        missingFields,
        missingDocs,
      });
    }

    await db.prepare("UPDATE employees SET onboarding_submitted = 1, onboarding_submitted_at = datetime('now') WHERE id = ?").run(empId);
    try { await syncAutomatedTasks(empId); } catch (e) { /* non-fatal */ }

    const recipients = new Set();
    if (emp.manager_id) {
      const mu = await db.prepare('SELECT user_id FROM employees WHERE id = ?').get(emp.manager_id);
      if (mu && mu.user_id) recipients.add(mu.user_id);
    }
    for (const u of await db.prepare('SELECT id, role FROM users').all()) if (can(u.role, 'employees:write')) recipients.add(u.id);
    recipients.delete(req.session.user.id);
    await notifyUsers([...recipients], {
      type: 'onboarding',
      title: `Onboarding form submitted: ${emp.name}`,
      body: `${emp.name} has completed their joining form and uploaded their documents. Please review and verify.`,
      link: '#/onboarding',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single employee.
router.get('/:id', requireLogin, async (req, res) => {
  try {
    if (!(await canActOnEmployee(req, req.params.id))) return res.status(403).json({ error: 'No access.' });
    const emp = await db.prepare(LIST_SQL + ' WHERE e.id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    res.json({ employee: emp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create employee.
router.post('/', requirePerm('employees:write'), async (req, res) => {
  try {
    const { employee, tempPassword } = await createEmployee(req.body || {});
    if (tempPassword && employee.email) {
      const s = getSettings();
      await sendMail({
        to: employee.email,
        subject: `Welcome to ${s.companyName || 'the company'}`,
        html: `<p>Hi ${employee.name},</p>
          <p>Your HR portal account has been created.</p>
          <p><b>Login email:</b> ${employee.email}<br/>
          <b>Temporary password:</b> ${tempPassword}</p>
          <p>Please log in and change your password.</p>`,
      });
    }
    res.json({ employee, tempPassword });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update employee (and optionally their login role).
router.put('/:id', requirePerm('employees:write'), async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });

    const updates = {};
    for (const f of FIELDS) if (f in req.body) updates[f] = req.body[f];
    if ('monthly_salary' in updates) updates.monthly_salary = Number(updates.monthly_salary) || 0;
    if ('manager_id' in updates) updates.manager_id = updates.manager_id ? Number(updates.manager_id) : null;

    const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    if (setClause) {
      await db.prepare(`UPDATE employees SET ${setClause} WHERE id = @id`).run({ ...updates, id: emp.id });
    }
    if ('role' in req.body && emp.user_id) {
      await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normaliseRole(req.body.role), emp.user_id);
    }
    res.json({ employee: await db.prepare(LIST_SQL + ' WHERE e.id = ?').get(emp.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Activate / deactivate.
router.post('/:id/status', requirePerm('employees:write'), async (req, res) => {
  try {
    const status = req.body.status === 'inactive' ? 'inactive' : 'active';
    await db.prepare('UPDATE employees SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ ok: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Archive an employee (super admin only). Their login is disabled and they
// disappear from active lists, but ALL their data (attendance, leave, payroll,
// mood, documents, etc.) is preserved and can be restored later.
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    // Don't allow archiving yourself.
    if (req.session.user.employeeId === emp.id) return res.status(400).json({ error: 'You cannot archive your own profile.' });
    // Soft-delete: mark archived. No data is removed — the employee row and all
    // related records (attendance, leave, payroll, mood, documents) stay intact.
    await db.prepare("UPDATE employees SET status = 'archived' WHERE id = ?").run(emp.id);
    res.json({ ok: true, archived: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Restore an archived employee back to active (super admin only).
router.post('/:id/restore', requireSuperAdmin, async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    await db.prepare("UPDATE employees SET status = 'active' WHERE id = ?").run(emp.id);
    res.json({ ok: true, restored: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PERMANENT delete — actually removes the employee and ALL their data forever
// (super admin only, and only for already-archived employees). Use with care.
router.delete('/:id/permanent', requireSuperAdmin, async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    if (req.session.user.employeeId === emp.id) return res.status(400).json({ error: 'You cannot delete your own profile.' });
    if (emp.status !== 'archived') return res.status(400).json({ error: 'Archive the employee first before permanent deletion.' });
    await db.prepare('UPDATE employees SET manager_id = NULL WHERE manager_id = ?').run(emp.id);
    await db.prepare('DELETE FROM employees WHERE id = ?').run(emp.id); // cascades attendance/leave/etc.
    if (emp.user_id) await db.prepare('DELETE FROM users WHERE id = ?').run(emp.user_id);
    res.json({ ok: true, permanentlyDeleted: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reset an employee's password -> returns a new temp password.
router.post('/:id/reset-password', requirePerm('employees:write'), async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp || !emp.user_id) return res.status(404).json({ error: 'No login for this employee' });
    const temp = makeTempPassword();
    await db.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').run(
      bcrypt.hashSync(temp, 10),
      emp.user_id
    );
    if (emp.email) {
      await sendMail({
        to: emp.email,
        subject: 'Your HR portal password was reset',
        html: `<p>Hi ${emp.name},</p><p>Your new temporary password is <b>${temp}</b>. Please log in and change it.</p>`,
      });
    }
    res.json({ tempPassword: temp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Salary structure (Finance / Super Admin) ------------------------------
router.get('/:id/salary', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const emp = await db.prepare('SELECT id, name, monthly_salary, salary_structure FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    let structure = null;
    try { structure = emp.salary_structure ? JSON.parse(emp.salary_structure) : null; } catch (e) { structure = null; }
    res.json({ employee: { id: emp.id, name: emp.name, monthly_salary: emp.monthly_salary }, structure });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id/salary', requirePerm('payroll:manage'), async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    const earnings = (req.body && Array.isArray(req.body.earnings) ? req.body.earnings : [])
      .map((e) => ({ name: String(e.name || 'Earning'), amount: +e.amount || 0 }))
      .filter((e) => e.name);
    const deductions = (req.body && Array.isArray(req.body.deductions) ? req.body.deductions : [])
      .map((d) => ({ name: String(d.name || 'Deduction'), amount: +d.amount || 0 }))
      .filter((d) => d.name);
    const gross = +earnings.reduce((s, e) => s + e.amount, 0).toFixed(2);
    const structure = { earnings, deductions };
    await db.prepare('UPDATE employees SET salary_structure = ?, monthly_salary = ? WHERE id = ?')
      .run(JSON.stringify(structure), gross, emp.id);
    res.json({ ok: true, gross, structure });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Employee documents ----------------------------------------------------
async function canManageDocs(req, employeeId) {
  // Admins with employee write access, or the employee themselves.
  if (req.session.user.role !== 'EMPLOYEE' && await canActOnEmployee(req, employeeId)) return true;
  return req.session.user.employeeId === Number(employeeId);
}

router.get('/:id/documents', requireLogin, async (req, res) => {
  try {
    if (!(await canManageDocs(req, req.params.id))) return res.status(403).json({ error: 'No access.' });
    const docs = await db.prepare('SELECT id, title, doc_type, file, status, verify_note, verified_at, uploaded_at FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC').all(req.params.id);
    res.json({ documents: docs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ID validity (format/checksum) + duplicate detection across employees.
router.get('/:id/verification', requireLogin, async (req, res) => {
  try {
    if (!(await canActOnEmployee(req, req.params.id))) return res.status(403).json({ error: 'No access.' });
    const e = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Not found' });

    const dupes = async (col, val) => {
      if (!val) return [];
      return (await db.prepare(`SELECT name FROM employees WHERE id != ? AND lower(trim(${col})) = lower(trim(?))`).all(e.id, val)).map((r) => r.name);
    };
    res.json({
      pan: e.pan ? { ...validatePAN(e.pan), duplicates: await dupes('pan', e.pan) } : null,
      aadhaar: e.aadhaar ? { ...validateAadhaar(e.aadhaar), duplicates: await dupes('aadhaar', e.aadhaar) } : null,
      ifsc: e.ifsc ? validateIFSC(e.ifsc) : null,
      emailDuplicates: await dupes('email', e.email),
      phoneDuplicates: await dupes('phone', e.phone),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Automatic Aadhaar verification via UIDAI Offline e-KYC XML (digital signature).
router.post('/:id/aadhaar-verify', requirePerm('employees:write'), memoryUpload.single('xml'), async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    if (!req.file) return res.status(400).json({ error: 'Upload the UIDAI Offline e-KYC XML file.' });

    let result;
    try { result = aadhaarOffline.check(req.file.buffer.toString('utf8'), getSettings().uidaiCert || ''); }
    catch (e) { return res.status(400).json({ error: 'Could not read that file. Download "Offline e-KYC" from UIDAI, unzip with your share code, and upload the XML.' }); }

    result.employeeName = emp.name;
    result.nameMatch = !!(result.name && emp.name && result.name.trim().toLowerCase() === emp.name.trim().toLowerCase());

    // If genuinely signed by UIDAI, store the file as a verified mandatory document.
    if (result.signatureValid === true) {
      const fname = await saveFile(req.file.buffer, 'application/xml', 'aadhaar-ekyc.xml');
      const docType = 'Government-issued ID (Aadhaar & PAN, or Passport)';
      await db.prepare("INSERT INTO employee_documents (employee_id, title, doc_type, file, uploaded_by, status, verify_note, verified_at) VALUES (?, ?, ?, ?, ?, 'verified', ?, datetime('now'))")
        .run(emp.id, 'Aadhaar (UIDAI Offline e-KYC — verified)', docType, fname, req.session.user.id,
          `UIDAI digital signature valid. Name on Aadhaar: ${result.name} (XXXX-XXXX-${result.last4}).` + (result.nameMatch ? ' Matches profile.' : ' ⚠ Differs from profile name.'));
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// HR marks a document verified / rejected after review.
router.post('/:id/documents/:docId/verify', requirePerm('employees:write'), async (req, res) => {
  try {
    const doc = await db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?').get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const status = ['verified', 'rejected', 'pending'].includes(req.body.status) ? req.body.status : 'pending';
    await db.prepare("UPDATE employee_documents SET status = ?, verify_note = ?, verified_by = ?, verified_at = datetime('now') WHERE id = ?")
      .run(status, (req.body && req.body.note) || '', req.session.user.id, doc.id);
    res.json({ ok: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/documents', requireLogin, documentUpload.single('file'), async (req, res) => {
  try {
    if (!(await canManageDocs(req, req.params.id))) return res.status(403).json({ error: 'No access.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const docType = (req.body && req.body.doc_type) || '';
    const title = (req.body && req.body.title) || docType || req.file.originalname;
    const key = await saveFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    const r = await db.prepare('INSERT INTO employee_documents (employee_id, title, doc_type, file, uploaded_by) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, title, docType, key, req.session.user.id);
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/documents/:docId/file', requireLogin, async (req, res) => {
  try {
    if (!(await canManageDocs(req, req.params.id))) return res.status(403).send('Forbidden');
    const doc = await db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?').get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).send('Not found');

    return await sendFile(res, doc.file);
  } catch (err) {
    console.error('Error retrieving document:', err);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

router.delete('/:id/documents/:docId', requireLogin, async (req, res) => {
  try {
    if (!(await canManageDocs(req, req.params.id))) return res.status(403).json({ error: 'No access.' });
    await db.prepare('DELETE FROM employee_documents WHERE id = ? AND employee_id = ?').run(req.params.docId, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
