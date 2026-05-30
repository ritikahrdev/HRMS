const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const { requireLogin, requirePerm, teamEmployeeIds, canActOnEmployee } = require('../middleware/auth');
const { upload } = require('../services/upload');
const { sendMail } = require('../services/email');
const { applyReimbursementDecision, approverEmailsFor } = require('../services/decisions');
const { actionUrl } = require('../services/tokens');

const router = express.Router();

function myEmpId(req, res) {
  const id = req.session.user.employeeId;
  if (!id) { res.status(400).json({ error: 'Your login is not linked to an employee profile.' }); return null; }
  return id;
}

// Apply for reimbursement with optional bill upload (employee).
router.post('/', requireLogin, upload.single('bill'), async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const { title, amount, category } = req.body || {};
    if (!title || !amount) return res.status(400).json({ error: 'Title and amount are required.' });
    const billFile = req.file ? req.file.filename : null;
    const r = await db.prepare(
      'INSERT INTO reimbursements (employee_id, title, category, amount, bill_file) VALUES ($1, $2, $3, $4, $5)'
    ).run(empId, title, category || '', Number(amount) || 0, billFile);

    const id = r.lastInsertRowid;
    const emp = await db.prepare('SELECT name FROM employees WHERE id = $1').get(empId);
    const to = await approverEmailsFor(empId, 'reimbursement');
    if (to.length) {
      await sendMail({
        to: to.join(','),
        subject: `Reimbursement request from ${emp ? emp.name : 'an employee'}`,
        html: `<p><b>${emp ? emp.name : 'An employee'}</b> submitted a reimbursement: <b>${title}</b> (${category || 'general'}) for amount <b>${amount}</b>.</p>
          <p>
            <a href="${actionUrl('reimbursement', id, 'approved')}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-right:8px">Approve</a>
            <a href="${actionUrl('reimbursement', id, 'rejected')}" style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reject</a>
          </p>
          <p style="color:#888;font-size:12px">Or open the HR portal to review the bill and decide.</p>`,
      });
    }
    res.json({ id });
  } catch (err) {
    console.error('Error creating reimbursement:', err);
    res.status(500).json({ error: 'Failed to create reimbursement' });
  }
});

router.get('/my', requireLogin, async (req, res) => {
  const empId = myEmpId(req, res); if (!empId) return;
  const rows = await db.prepare('SELECT * FROM reimbursements WHERE employee_id = $1 ORDER BY applied_at DESC').all(empId);
  res.json({ reimbursements: rows });
});

// For approvers (Finance/Super = all; Manager = team).
router.get('/', requirePerm('reimbursement:approve'), async (req, res) => {
  const status = req.query.status;
  const base = `SELECT r.*, e.name AS employee_name, e.emp_code
               FROM reimbursements r JOIN employees e ON e.id = r.employee_id`;
  let where = '';
  let params = [];
  if (req.session.user.role === 'MANAGER') {
    const ids = await teamEmployeeIds(req);
    if (ids.length === 0) return res.json({ reimbursements: [] });
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    where = ` WHERE r.employee_id IN (${placeholders})`;
    params = ids;
  }
  if (status) {
    const statusParam = `$${params.length + 1}`;
    where += (where ? ' AND' : ' WHERE') + ` r.status = ${statusParam}`;
    params.push(status);
  }
  const rows = await db.prepare(base + where + ' ORDER BY r.applied_at DESC').all(...params);
  res.json({ reimbursements: rows });
});

// View / download a bill (approver, or the owner).
router.get('/:id/bill', requireLogin, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM reimbursements WHERE id = $1').get(req.params.id);
    if (!row || !row.bill_file) return res.status(404).send('No bill');
    if (!await canActOnEmployee(req, row.employee_id)) return res.status(403).send('Forbidden');

    // Path traversal protection: verify resolved path is within uploads directory
    const filePath = path.resolve(path.join(config.paths.uploads, row.bill_file));
    const uploadsDir = path.resolve(config.paths.uploads);
    if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
    res.sendFile(filePath);
  } catch (err) {
    console.error('Error retrieving bill:', err);
    res.status(500).json({ error: 'Failed to retrieve bill' });
  }
});

router.post('/:id/decision', requirePerm('reimbursement:approve'), async (req, res) => {
  try {
    const { decision, comment } = req.body || {};
    if (!['approved', 'rejected'].includes(decision))
      return res.status(400).json({ error: 'decision must be approved or rejected' });
    const row = await db.prepare('SELECT * FROM reimbursements WHERE id = $1').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!await canActOnEmployee(req, row.employee_id)) return res.status(403).json({ error: 'Not in your team.' });

    await applyReimbursementDecision(row.id, decision, comment, req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error processing reimbursement decision:', err);
    res.status(500).json({ error: 'Failed to process decision' });
  }
});

module.exports = router;
