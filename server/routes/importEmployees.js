const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');
const { requirePerm } = require('../middleware/auth');
const { memoryUpload } = require('../services/upload');
const { createEmployee } = require('../services/employees');
const { sendMail } = require('../services/email');
const { getSettings } = require('../services/settings');
const { escapeHtml } = require('../services/escape');

const router = express.Router();

// Maps many possible spreadsheet header names to our internal fields.
const HEADER_MAP = {
  name: 'name', 'full name': 'name', employee: 'name', 'employee name': 'name',
  email: 'email', 'email id': 'email', 'e-mail': 'email',
  phone: 'phone', mobile: 'phone', 'phone number': 'phone', contact: 'phone',
  'emp code': 'emp_code', 'employee code': 'emp_code', code: 'emp_code', 'emp id': 'emp_code',
  department: 'department', dept: 'department',
  designation: 'designation', title: 'designation', role: 'designation',
  'date of joining': 'date_of_joining', doj: 'date_of_joining', 'joining date': 'date_of_joining',
  salary: 'monthly_salary', 'monthly salary': 'monthly_salary', ctc: 'monthly_salary', 'gross salary': 'monthly_salary',
  manager: 'manager', 'reporting manager': 'manager',
  'bank account': 'bank_account', 'account number': 'bank_account', 'bank a/c': 'bank_account',
  ifsc: 'ifsc', 'ifsc code': 'ifsc',
  pan: 'pan', 'pan number': 'pan',
  address: 'address',
};

function normaliseHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function validateRow(row, seenCodes, seenEmails) {
  const issues = [];
  if (!row.name || !String(row.name).trim()) issues.push('Name is missing');

  if (row.email) {
    const email = String(row.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push('Email looks invalid');
    else {
      const dup = await db.prepare('SELECT 1 FROM users WHERE lower(email)=lower(?)').get(email);
      if (dup) issues.push('Email already exists in system');
      if (seenEmails.has(email.toLowerCase())) issues.push('Duplicate email in file');
      seenEmails.add(email.toLowerCase());
    }
  } else {
    issues.push('Email is missing (no login will be created)');
  }

  if (row.emp_code) {
    const code = String(row.emp_code).trim();
    const dup = await db.prepare('SELECT 1 FROM employees WHERE emp_code=?').get(code);
    if (dup) issues.push('Employee code already exists');
    if (seenCodes.has(code)) issues.push('Duplicate employee code in file');
    seenCodes.add(code);
  }

  if (row.monthly_salary === '' || row.monthly_salary == null) {
    issues.push('Salary is missing');
  } else if (isNaN(Number(row.monthly_salary))) {
    issues.push('Salary is not a number');
  }

  return issues;
}

// Severity: rows with only "missing email" warning are still importable.
function isBlocking(issues) {
  return issues.some((i) => !i.includes('no login will be created'));
}

// Parse + validate, but do not save.
router.post('/preview', requirePerm('employees:write'), memoryUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (e) {
    return res.status(400).json({ error: 'Could not read the file. Use an .xlsx or .csv file.' });
  }

  try {
    const seenCodes = new Set();
    const seenEmails = new Set();
    const out = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const raw = rows[idx];
      const mapped = {};
      for (const key of Object.keys(raw)) {
        const field = HEADER_MAP[normaliseHeader(key)];
        if (field) mapped[field] = typeof raw[key] === 'string' ? raw[key].trim() : raw[key];
      }
      const issues = await validateRow(mapped, seenCodes, seenEmails);
      out.push({ rowNumber: idx + 2, data: mapped, issues, blocking: isBlocking(issues) });
    }

    res.json({
      total: out.length,
      rows: out,
      okCount: out.filter((r) => !r.blocking).length,
      problemCount: out.filter((r) => r.blocking).length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Commit corrected rows.
router.post('/commit', requirePerm('employees:write'), async (req, res) => {
  const rows = (req.body && req.body.rows) || [];
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: 'No rows to import' });

  const s = getSettings();
  const results = { created: 0, skipped: 0, errors: [] };

  for (const r of rows) {
    try {
      // Bulk import never assigns privileged roles (allowRole defaults to false),
      // so a spreadsheet/JSON row can't mint an HR/Finance/Super-Admin login.
      const { employee, tempPassword } = await createEmployee(r);
      results.created++;
      if (tempPassword && employee.email) {
        await sendMail({
          to: employee.email,
          subject: `Welcome to ${s.companyName || 'the company'}`,
          html: `<p>Hi ${escapeHtml(employee.name)},</p><p>Your HR account is ready.</p>
            <p><b>Login:</b> ${escapeHtml(employee.email)}<br/><b>Temporary password:</b> ${escapeHtml(tempPassword)}</p>`,
        });
      }
    } catch (e) {
      results.skipped++;
      results.errors.push({ name: r.name || '(no name)', error: e.message });
    }
  }
  res.json(results);
});

// Download a ready-to-fill template.
router.get('/template', requirePerm('employees:write'), (req, res) => {
  const headers = [
    'Name', 'Email', 'Phone', 'Emp Code', 'Department', 'Designation',
    'Date Of Joining', 'Monthly Salary', 'Manager', 'Bank Account', 'IFSC', 'PAN', 'Address',
  ];
  const sample = [
    {
      Name: 'Asha Verma', Email: 'asha@example.com', Phone: '9876543210',
      'Emp Code': 'EMP0001', Department: 'Engineering', Designation: 'Developer',
      'Date Of Joining': '2024-01-15', 'Monthly Salary': 60000, Manager: 'Rahul',
      'Bank Account': '1234567890', IFSC: 'HDFC0000123', PAN: 'ABCDE1234F', Address: 'Pune',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sample, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="employee-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
