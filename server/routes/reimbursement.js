const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const config = require('../config');
const { requireLogin, requirePerm, teamEmployeeIds, canActOnEmployee } = require('../middleware/auth');
const { upload } = require('../services/upload');
const { saveFile, getFile, deleteFile, sendFile } = require('../services/filestore');
const { sendMail } = require('../services/email');
const { applyReimbursementDecision, approversFor } = require('../services/decisions');
const { actionUrl } = require('../services/tokens');
const { escapeHtml } = require('../services/escape');

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
    if (typeof amount === 'string' && !/^\d+(\.\d+)?$/.test(amount.trim())) {
      return res.status(400).json({ error: 'Amount must be a number between 1 and 10,000,000.' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 10000000) {
      return res.status(400).json({ error: 'Amount must be a number between 1 and 10,000,000.' });
    }
    const billKey = req.file ? await saveFile(req.file.buffer, req.file.mimetype, req.file.originalname) : null;
    const r = await db.prepare(
      'INSERT INTO reimbursements (employee_id, title, category, amount, bill_file) VALUES (?, ?, ?, ?, ?)'
    ).run(empId, title, category || '', amt, billKey);

    const id = r.lastInsertRowid;
    const emp = await db.prepare('SELECT name FROM employees WHERE id = ?').get(empId);
    const approvers = await approversFor(empId, 'reimbursement');
    for (const ap of approvers) {
      await sendMail({
        to: ap.email,
        subject: `Reimbursement request from ${emp ? emp.name : 'an employee'}`,
        html: `<p><b>${escapeHtml(emp ? emp.name : 'An employee')}</b> submitted a reimbursement: <b>${escapeHtml(title)}</b> (${escapeHtml(category || 'general')}) for amount <b>${escapeHtml(amount)}</b>.</p>
          <p>
            <a href="${actionUrl('reimbursement', id, 'approved', ap.userId)}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-right:8px">Approve</a>
            <a href="${actionUrl('reimbursement', id, 'rejected', ap.userId)}" style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reject</a>
          </p>
          <p style="color:#888;font-size:12px">This link is personal to you (${escapeHtml(ap.name)}) — the decision will be recorded in your name. Or open the HR portal to review the bill and decide.</p>`,
      }).catch(() => {});
    }
    res.json({ id });
  } catch (err) {
    console.error('Error creating reimbursement:', err);
    res.status(500).json({ error: 'Failed to create reimbursement' });
  }
});

router.get('/my', requireLogin, async (req, res) => {
  try {
    const empId = myEmpId(req, res); if (!empId) return;
    const rows = await db.prepare(
      `SELECT r.*, (SELECT COALESCE(e2.name, u.email) FROM users u LEFT JOIN employees e2 ON e2.user_id = u.id WHERE u.id = r.approver_id) AS approver_name
       FROM reimbursements r WHERE r.employee_id = ? ORDER BY r.applied_at DESC`
    ).all(empId);
    res.json({ reimbursements: rows });
  } catch (err) {
    console.error('Error fetching reimbursements:', err);
    res.status(500).json({ error: err.message });
  }
});

// For approvers (Finance/Super = all; Manager = team).
router.get('/', requirePerm('reimbursement:approve'), async (req, res) => {
  try {
    const status = req.query.status;
    const base = `SELECT r.*, e.name AS employee_name, e.emp_code,
               (SELECT COALESCE(e2.name, u.email) FROM users u LEFT JOIN employees e2 ON e2.user_id = u.id WHERE u.id = r.approver_id) AS approver_name
               FROM reimbursements r JOIN employees e ON e.id = r.employee_id`;
    let where = '';
    let params = [];
    if (req.session.user.role === 'MANAGER') {
      const ids = await teamEmployeeIds(req);
      if (ids.length === 0) return res.json({ reimbursements: [] });
      where = ` WHERE r.employee_id IN (${ids.map(() => '?').join(',')})`;
      params = ids;
    }
    if (status) { where += (where ? ' AND' : ' WHERE') + ' r.status = ?'; params.push(status); }
    const rows = await db.prepare(base + where + ' ORDER BY r.applied_at DESC').all(...params);
    res.json({ reimbursements: rows });
  } catch (err) {
    console.error('Error fetching reimbursements:', err);
    res.status(500).json({ error: err.message });
  }
});

// View / download a bill (approver, or the owner).
router.get('/:id/bill', requireLogin, async (req, res) => {
  try {
    const row = await db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(req.params.id);
    if (!row || !row.bill_file) return res.status(404).send('No bill');
    if (!(await canActOnEmployee(req, row.employee_id))) return res.status(403).send('Forbidden');

    return await sendFile(res, row.bill_file, { download: true });
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
    const row = await db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!(await canActOnEmployee(req, row.employee_id))) return res.status(403).json({ error: 'Not in your team.' });

    await applyReimbursementDecision(row.id, decision, comment, req.session.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error processing reimbursement decision:', err);
    res.status(500).json({ error: 'Failed to process decision' });
  }
});

module.exports = router;
