const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { requireLogin, requirePerm, requireSuperAdmin, canActOnEmployee, teamEmployeeIds } = require('../middleware/auth');
const { createEmployee, FIELDS, makeTempPassword, normaliseRole } = require('../services/employees');
const { upload, memoryUpload } = require('../services/upload');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');
const { validatePAN, validateAadhaar, validateIFSC } = require('../services/verify');
const aadhaarOffline = require('../services/aadhaarOffline');

const router = express.Router();

const LIST_SQL = `
  SELECT e.*, u.role AS role,
         (SELECT name FROM employees m WHERE m.id = e.manager_id) AS manager_name
  FROM employees e LEFT JOIN users u ON u.id = e.user_id`;

// List all employees (HR / Finance / Super Admin).
// By default excludes archived employees; pass ?includeArchived=1 to see them too.
router.get('/', requirePerm('employees:read'), (req, res) => {
  const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
  const sql = includeArchived
    ? LIST_SQL + ' ORDER BY e.name'
    : LIST_SQL + " WHERE e.status != 'archived' ORDER BY e.name";
  res.json({ employees: db.prepare(sql).all() });
});

// Workforce statistics (active employees, with overall counts).
router.get('/stats', requirePerm('employees:read'), (req, res) => {
  const W = "status = 'active'";
  const groupCount = (col) => db.prepare(
    `SELECT COALESCE(NULLIF(TRIM(${col}), ''), 'Not set') AS label, COUNT(*) AS count
     FROM employees WHERE ${W} GROUP BY label ORDER BY count DESC, label`
  ).all();

  const totalActive = db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${W}`).get().n;
  const totalArchived = db.prepare("SELECT COUNT(*) AS n FROM employees WHERE status='archived'").get().n;
  const managers = db.prepare(
    `SELECT COUNT(DISTINCT manager_id) AS n FROM employees WHERE ${W} AND manager_id IS NOT NULL`
  ).get().n;
  const withLogin = db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${W} AND user_id IS NOT NULL`).get().n;

  // New joiners this month + this year.
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const newThisMonth = db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${W} AND substr(date_of_joining,1,7) = ?`).get(ym).n;
  const newThisYear = db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${W} AND substr(date_of_joining,1,4) = ?`).get(String(now.getFullYear())).n;

  res.json({
    totalActive,
    totalArchived,
    managers,
    withLogin,
    newThisMonth,
    newThisYear,
    byDepartment: groupCount('department'),
    byType: groupCount('employee_type'),
    byGender: groupCount('gender'),
    byWorkMode: groupCount('work_mode'),
    byBloodGroup: groupCount('blood_group'),
  });
});

// Staff directory — any logged-in user sees safe contact fields of active staff.
router.get('/directory', requireLogin, (req, res) => {
  const rows = db.prepare(
    `SELECT e.id, e.name, e.emp_code, e.department, e.designation, e.email, e.phone,
            (SELECT name FROM employees m WHERE m.id = e.manager_id) AS manager_name
     FROM employees e WHERE e.status = 'active' ORDER BY e.name`
  ).all();
  res.json({ employees: rows });
});

// A manager's direct reports.
router.get('/team', requireLogin, (req, res) => {
  const ids = teamEmployeeIds(req);
  if (ids.length === 0) return res.json({ employees: [] });
  const rows = db.prepare(LIST_SQL + ` WHERE e.id IN (${ids.map(() => '?').join(',')}) ORDER BY e.name`).all(...ids);
  res.json({ employees: rows });
});

// Current employee's own profile.
router.get('/me', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.json({ employee: null });
  const emp = db.prepare(LIST_SQL + ' WHERE e.id = ?').get(empId);
  res.json({ employee: emp });
});

// Single employee.
router.get('/:id', requireLogin, (req, res) => {
  if (!canActOnEmployee(req, req.params.id)) return res.status(403).json({ error: 'No access.' });
  const emp = db.prepare(LIST_SQL + ' WHERE e.id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  res.json({ employee: emp });
});

// Create employee.
router.post('/', requirePerm('employees:write'), async (req, res) => {
  try {
    const { employee, tempPassword } = createEmployee(req.body || {});
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
router.put('/:id', requirePerm('employees:write'), (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  for (const f of FIELDS) if (f in req.body) updates[f] = req.body[f];
  if ('monthly_salary' in updates) updates.monthly_salary = Number(updates.monthly_salary) || 0;
  if ('manager_id' in updates) updates.manager_id = updates.manager_id ? Number(updates.manager_id) : null;

  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  if (setClause) {
    db.prepare(`UPDATE employees SET ${setClause} WHERE id = @id`).run({ ...updates, id: emp.id });
  }
  if ('role' in req.body && emp.user_id) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(normaliseRole(req.body.role), emp.user_id);
  }
  res.json({ employee: db.prepare(LIST_SQL + ' WHERE e.id = ?').get(emp.id) });
});

// Activate / deactivate.
router.post('/:id/status', requirePerm('employees:write'), (req, res) => {
  const status = req.body.status === 'inactive' ? 'inactive' : 'active';
  db.prepare('UPDATE employees SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true, status });
});

// Archive an employee (super admin only). Their login is disabled and they
// disappear from active lists, but ALL their data (attendance, leave, payroll,
// mood, documents, etc.) is preserved and can be restored later.
router.delete('/:id', requireSuperAdmin, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  // Don't allow archiving yourself.
  if (req.session.user.employeeId === emp.id) return res.status(400).json({ error: 'You cannot archive your own profile.' });
  // Soft-delete: mark archived. No data is removed — the employee row and all
  // related records (attendance, leave, payroll, mood, documents) stay intact.
  db.prepare("UPDATE employees SET status = 'archived' WHERE id = ?").run(emp.id);
  res.json({ ok: true, archived: true });
});

// Restore an archived employee back to active (super admin only).
router.post('/:id/restore', requireSuperAdmin, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE employees SET status = 'active' WHERE id = ?").run(emp.id);
  res.json({ ok: true, restored: true });
});

// PERMANENT delete — actually removes the employee and ALL their data forever
// (super admin only, and only for already-archived employees). Use with care.
router.delete('/:id/permanent', requireSuperAdmin, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  if (req.session.user.employeeId === emp.id) return res.status(400).json({ error: 'You cannot delete your own profile.' });
  if (emp.status !== 'archived') return res.status(400).json({ error: 'Archive the employee first before permanent deletion.' });
  db.prepare('UPDATE employees SET manager_id = NULL WHERE manager_id = ?').run(emp.id);
  db.prepare('DELETE FROM employees WHERE id = ?').run(emp.id); // cascades attendance/leave/etc.
  if (emp.user_id) db.prepare('DELETE FROM users WHERE id = ?').run(emp.user_id);
  res.json({ ok: true, permanentlyDeleted: true });
});

// Reset an employee's password -> returns a new temp password.
router.post('/:id/reset-password', requirePerm('employees:write'), async (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp || !emp.user_id) return res.status(404).json({ error: 'No login for this employee' });
  const temp = makeTempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').run(
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
});

// ---- Salary structure (Finance / Super Admin) ------------------------------
router.get('/:id/salary', requirePerm('payroll:manage'), (req, res) => {
  const emp = db.prepare('SELECT id, name, monthly_salary, salary_structure FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  let structure = null;
  try { structure = emp.salary_structure ? JSON.parse(emp.salary_structure) : null; } catch (e) { structure = null; }
  res.json({ employee: { id: emp.id, name: emp.name, monthly_salary: emp.monthly_salary }, structure });
});

router.put('/:id/salary', requirePerm('payroll:manage'), (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  const earnings = (req.body && Array.isArray(req.body.earnings) ? req.body.earnings : [])
    .map((e) => ({ name: String(e.name || 'Earning'), amount: +e.amount || 0 }))
    .filter((e) => e.name);
  const deductions = (req.body && Array.isArray(req.body.deductions) ? req.body.deductions : [])
    .map((d) => ({ name: String(d.name || 'Deduction'), amount: +d.amount || 0 }))
    .filter((d) => d.name);
  const gross = +earnings.reduce((s, e) => s + e.amount, 0).toFixed(2);
  const structure = { earnings, deductions };
  db.prepare('UPDATE employees SET salary_structure = ?, monthly_salary = ? WHERE id = ?')
    .run(JSON.stringify(structure), gross, emp.id);
  res.json({ ok: true, gross, structure });
});

// ---- Employee documents ----------------------------------------------------
function canManageDocs(req, employeeId) {
  // Admins with employee write access, or the employee themselves.
  if (req.session.user.role !== 'EMPLOYEE' && canActOnEmployee(req, employeeId)) return true;
  return req.session.user.employeeId === Number(employeeId);
}

router.get('/:id/documents', requireLogin, (req, res) => {
  if (!canManageDocs(req, req.params.id)) return res.status(403).json({ error: 'No access.' });
  const docs = db.prepare('SELECT id, title, doc_type, file, status, verify_note, verified_at, uploaded_at FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC').all(req.params.id);
  res.json({ documents: docs });
});

// ID validity (format/checksum) + duplicate detection across employees.
router.get('/:id/verification', requireLogin, (req, res) => {
  if (!canActOnEmployee(req, req.params.id)) return res.status(403).json({ error: 'No access.' });
  const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });

  const dupes = (col, val) => {
    if (!val) return [];
    return db.prepare(`SELECT name FROM employees WHERE id != ? AND lower(trim(${col})) = lower(trim(?))`).all(e.id, val).map((r) => r.name);
  };
  res.json({
    pan: e.pan ? { ...validatePAN(e.pan), duplicates: dupes('pan', e.pan) } : null,
    aadhaar: e.aadhaar ? { ...validateAadhaar(e.aadhaar), duplicates: dupes('aadhaar', e.aadhaar) } : null,
    ifsc: e.ifsc ? validateIFSC(e.ifsc) : null,
    emailDuplicates: dupes('email', e.email),
    phoneDuplicates: dupes('phone', e.phone),
  });
});

// Automatic Aadhaar verification via UIDAI Offline e-KYC XML (digital signature).
router.post('/:id/aadhaar-verify', requirePerm('employees:write'), memoryUpload.single('xml'), (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'Upload the UIDAI Offline e-KYC XML file.' });

  let result;
  try { result = aadhaarOffline.check(req.file.buffer.toString('utf8'), getSettings().uidaiCert || ''); }
  catch (e) { return res.status(400).json({ error: 'Could not read that file. Download "Offline e-KYC" from UIDAI, unzip with your share code, and upload the XML.' }); }

  result.employeeName = emp.name;
  result.nameMatch = !!(result.name && emp.name && result.name.trim().toLowerCase() === emp.name.trim().toLowerCase());

  // If genuinely signed by UIDAI, store the file as a verified mandatory document.
  if (result.signatureValid === true) {
    const fname = `aadhaar-ekyc-${emp.id}-${Date.now()}.xml`;
    fs.writeFileSync(path.join(config.paths.uploads, fname), req.file.buffer);
    const docType = 'Government-issued ID (Aadhaar & PAN, or Passport)';
    db.prepare("INSERT INTO employee_documents (employee_id, title, doc_type, file, uploaded_by, status, verify_note, verified_at) VALUES (?, ?, ?, ?, ?, 'verified', ?, datetime('now'))")
      .run(emp.id, 'Aadhaar (UIDAI Offline e-KYC — verified)', docType, fname, req.session.user.id,
        `UIDAI digital signature valid. Name on Aadhaar: ${result.name} (XXXX-XXXX-${result.last4}).` + (result.nameMatch ? ' Matches profile.' : ' ⚠ Differs from profile name.'));
  }
  res.json(result);
});

// HR marks a document verified / rejected after review.
router.post('/:id/documents/:docId/verify', requirePerm('employees:write'), (req, res) => {
  const doc = db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?').get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const status = ['verified', 'rejected', 'pending'].includes(req.body.status) ? req.body.status : 'pending';
  db.prepare("UPDATE employee_documents SET status = ?, verify_note = ?, verified_by = ?, verified_at = datetime('now') WHERE id = ?")
    .run(status, (req.body && req.body.note) || '', req.session.user.id, doc.id);
  res.json({ ok: true, status });
});

router.post('/:id/documents', requireLogin, upload.single('file'), (req, res) => {
  if (!canManageDocs(req, req.params.id)) return res.status(403).json({ error: 'No access.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const docType = (req.body && req.body.doc_type) || '';
  const title = (req.body && req.body.title) || docType || req.file.originalname;
  const r = db.prepare('INSERT INTO employee_documents (employee_id, title, doc_type, file, uploaded_by) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, title, docType, req.file.filename, req.session.user.id);
  res.json({ id: r.lastInsertRowid });
});

router.get('/:id/documents/:docId/file', requireLogin, (req, res) => {
  try {
    if (!canManageDocs(req, req.params.id)) return res.status(403).send('Forbidden');
    const doc = db.prepare('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?').get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).send('Not found');

    // Path traversal protection: verify resolved path is within uploads directory
    const fp = path.resolve(path.join(config.paths.uploads, doc.file));
    const uploadsDir = path.resolve(config.paths.uploads);
    if (!fp.startsWith(uploadsDir + path.sep) && fp !== uploadsDir) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(fp)) return res.status(404).send('File missing');
    res.sendFile(fp);
  } catch (err) {
    console.error('Error retrieving document:', err);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

router.delete('/:id/documents/:docId', requireLogin, (req, res) => {
  if (!canManageDocs(req, req.params.id)) return res.status(403).json({ error: 'No access.' });
  db.prepare('DELETE FROM employee_documents WHERE id = ? AND employee_id = ?').run(req.params.docId, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
