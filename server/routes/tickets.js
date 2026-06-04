const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');
const { sendMail } = require('../services/email');

const router = express.Router();

const LIST = `SELECT t.*, e.name AS employee_name, e.emp_code FROM tickets t JOIN employees e ON e.id = t.employee_id`;

// Valid HR ticket categories
const VALID_CATEGORIES = ['leave', 'payroll', 'documents', 'benefits', 'office', 'performance', 'training', 'grievance', 'general'];
const CATEGORY_ICONS = {
  leave: '📅', payroll: '💰', documents: '📄', benefits: '🎁', office: '🏢',
  performance: '⭐', training: '🎓', grievance: '⚠️', general: '❓'
};
const CATEGORY_NAMES = {
  leave: 'Leave & Attendance', payroll: 'Salary & Payroll', documents: 'Documents & IDs',
  benefits: 'Benefits & Allowances', office: 'Office & Facilities', performance: 'Performance & Appraisal',
  training: 'Training & Development', grievance: 'Grievances & Complaints', general: 'General HR'
};

// My tickets
router.get('/mine', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.json({ tickets: [] });
  res.json({ tickets: db.prepare('SELECT * FROM tickets WHERE employee_id = ? ORDER BY created_at DESC').all(empId) });
});

// All tickets (HR/Super) - sorted by status priority and creation date
router.get('/', requirePerm('settings:manage'), (req, res) => {
  const status = req.query.status;
  const rows = status
    ? db.prepare(LIST + ' WHERE t.status = ? ORDER BY t.created_at DESC').all(status)
    : db.prepare(LIST + ' ORDER BY CASE t.status WHEN \'open\' THEN 0 WHEN \'in_progress\' THEN 1 ELSE 2 END, t.created_at DESC').all();
  res.json({ tickets: rows });
});

// Raise a ticket
router.post('/', requireLogin, async (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.status(400).json({ error: 'Only employees can raise tickets.' });

  const { category, subject, description } = req.body || {};
  if (!subject) return res.status(400).json({ error: 'Subject is required.' });
  if (!category) return res.status(400).json({ error: 'Category is required.' });
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });

  const r = db.prepare('INSERT INTO tickets (employee_id, category, subject, description, status) VALUES (?, ?, ?, ?, ?)')
    .run(empId, category, subject, description || '', 'open');

  // Send notification to HR team
  const hrUsers = db.prepare("SELECT id, email FROM users WHERE permissions LIKE '%settings:manage%'").all();
  const emp = db.prepare('SELECT name, email FROM employees WHERE id = ?').get(empId);
  const categoryName = CATEGORY_NAMES[category] || category;
  const categoryIcon = CATEGORY_ICONS[category] || '❓';

  if (hrUsers.length > 0 && emp && emp.email) {
    const hrEmails = hrUsers.map(u => u.email).filter(Boolean).join(',');
    await sendMail({
      to: hrEmails,
      subject: `🎫 New Support Ticket: ${categoryIcon} ${subject}`,
      html: `
        <p><strong>New ticket raised by ${emp.name}</strong></p>
        <div style="background:#f0f9ff;padding:12px;border-radius:6px;border-left:4px solid #0ea5e9;margin:12px 0">
          <p><strong>Category:</strong> ${categoryIcon} ${categoryName}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Ticket ID:</strong> #${r.lastInsertRowid}</p>
          ${description ? `<p><strong>Details:</strong><br>${description}</p>` : ''}
        </div>
        <p>Please review and respond to this ticket in the HR system.</p>
      `
    }).catch(e => console.error('Email notification failed:', e));
  }

  res.json({ id: r.lastInsertRowid, category, subject });
});

// Update status / resolution (HR/Super).
router.put('/:id', requirePerm('settings:manage'), async (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const status = ['open', 'in_progress', 'closed'].includes(req.body.status) ? req.body.status : t.status;
  const resolution = req.body.resolution != null ? req.body.resolution : t.resolution;
  db.prepare("UPDATE tickets SET status = ?, resolution = ?, assigned_to = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, resolution, req.session.user.id, t.id);

  if (status === 'closed') {
    const emp = db.prepare('SELECT name, email FROM employees WHERE id = ?').get(t.employee_id);
    if (emp && emp.email) {
      const categoryName = CATEGORY_NAMES[t.category] || t.category;
      const categoryIcon = CATEGORY_ICONS[t.category] || '❓';
      await sendMail({
        to: emp.email,
        subject: `✅ Your ticket #${t.id} has been resolved`,
        html: `
          <p>Hi <strong>${emp.name}</strong>,</p>
          <p>Your support ticket has been resolved:</p>
          <div style="background:#f0fdf4;padding:12px;border-radius:6px;border-left:4px solid #22c55e;margin:12px 0">
            <p><strong>Ticket #${t.id}</strong> - ${categoryIcon} ${categoryName}</p>
            <p><strong>Subject:</strong> ${t.subject}</p>
            ${resolution ? `<p><strong>Resolution:</strong><br>${resolution}</p>` : ''}
          </div>
          <p>If you need further assistance, feel free to raise another ticket.</p>
          <p>Best regards,<br>HR Team</p>
        `
      });
    }
  }
  res.json({ ok: true });
});

module.exports = router;
