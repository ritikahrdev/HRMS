const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');
const { sendMail } = require('../services/email');
const { can } = require('../services/permissions');
const { escapeHtml } = require('../services/escape');

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
router.get('/mine', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.json({ tickets: [] });
    res.json({ tickets: await db.prepare('SELECT * FROM tickets WHERE employee_id = ? ORDER BY created_at DESC').all(empId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// All tickets (HR/Super) - sorted by status priority and creation date
router.get('/', requirePerm('settings:manage'), async (req, res) => {
  try {
    const status = req.query.status;
    const rows = status
      ? await db.prepare(LIST + ' WHERE t.status = ? ORDER BY t.created_at DESC').all(status)
      : await db.prepare(LIST + ' ORDER BY CASE t.status WHEN \'open\' THEN 0 WHEN \'in_progress\' THEN 1 ELSE 2 END, t.created_at DESC').all();
    res.json({ tickets: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Raise a ticket
router.post('/', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'Only employees can raise tickets.' });

    const { category, subject, description } = req.body || {};
    if (!subject) return res.status(400).json({ error: 'Subject is required.' });
    if (!category) return res.status(400).json({ error: 'Category is required.' });
    if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });

    const r = await db.prepare('INSERT INTO tickets (employee_id, category, subject, description, status) VALUES (?, ?, ?, ?, ?)')
      .run(empId, category, subject, description || '', 'open');

    // Send notification to HR team. (Recipients are users whose ROLE grants
    // settings:manage — the users table has no `permissions` column.)
    const hrUsers = (await db.prepare('SELECT id, email, role FROM users').all()).filter((u) => u.email && can(u.role, 'settings:manage'));
    const emp = await db.prepare('SELECT name, email FROM employees WHERE id = ?').get(empId);
    const categoryName = CATEGORY_NAMES[category] || category;
    const categoryIcon = CATEGORY_ICONS[category] || '❓';

    if (hrUsers.length > 0 && emp && emp.email) {
      const hrEmails = hrUsers.map(u => u.email).filter(Boolean).join(',');
      await sendMail({
        to: hrEmails,
        subject: `🎫 New Support Ticket: ${categoryIcon} ${subject}`,
        html: `
          <p><strong>New ticket raised by ${escapeHtml(emp.name)}</strong></p>
          <div style="background:#f0f9ff;padding:12px;border-radius:6px;border-left:4px solid #0ea5e9;margin:12px 0">
            <p><strong>Category:</strong> ${categoryIcon} ${escapeHtml(categoryName)}</p>
            <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
            <p><strong>Ticket ID:</strong> #${r.lastInsertRowid}</p>
            ${description ? `<p><strong>Details:</strong><br>${escapeHtml(description)}</p>` : ''}
          </div>
          <p>Please review and respond to this ticket in the HR system.</p>
        `
      }).catch(e => console.error('Email notification failed:', e));
    }

    res.json({ id: r.lastInsertRowid, category, subject });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update status / resolution (HR/Super).
router.put('/:id', requirePerm('settings:manage'), async (req, res) => {
  try {
    const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const status = ['open', 'in_progress', 'closed'].includes(req.body.status) ? req.body.status : t.status;
    const resolution = req.body.resolution != null ? req.body.resolution : t.resolution;
    await db.prepare("UPDATE tickets SET status = ?, resolution = ?, assigned_to = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, resolution, req.session.user.id, t.id);

    if (status === 'closed') {
      const emp = await db.prepare('SELECT name, email FROM employees WHERE id = ?').get(t.employee_id);
      if (emp && emp.email) {
        const categoryName = CATEGORY_NAMES[t.category] || t.category;
        const categoryIcon = CATEGORY_ICONS[t.category] || '❓';
        await sendMail({
          to: emp.email,
          subject: `✅ Your ticket #${t.id} has been resolved`,
          html: `
            <p>Hi <strong>${escapeHtml(emp.name)}</strong>,</p>
            <p>Your support ticket has been resolved:</p>
            <div style="background:#f0fdf4;padding:12px;border-radius:6px;border-left:4px solid #22c55e;margin:12px 0">
              <p><strong>Ticket #${t.id}</strong> - ${categoryIcon} ${escapeHtml(categoryName)}</p>
              <p><strong>Subject:</strong> ${escapeHtml(t.subject)}</p>
              ${resolution ? `<p><strong>Resolution:</strong><br>${escapeHtml(resolution)}</p>` : ''}
            </div>
            <p>If you need further assistance, feel free to raise another ticket.</p>
            <p>Best regards,<br>HR Team</p>
          `
        });
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
