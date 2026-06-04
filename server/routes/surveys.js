const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

// List surveys with analytics
router.get('/', requireLogin, (req, res) => {
  const isAdmin = req.session.user.permissions.includes('*') || req.session.user.permissions.includes('settings:manage');
  const rows = isAdmin
    ? db.prepare('SELECT * FROM surveys ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM surveys WHERE active = 1 ORDER BY created_at DESC').all();

  const empId = req.session.user.employeeId;
  const emp = empId ? db.prepare('SELECT department, manager_id FROM employees WHERE id = ?').get(empId) : null;

  for (const s of rows) {
    s.questions = JSON.parse(s.questions || '[]');
    s.responseCount = db.prepare('SELECT COUNT(*) c FROM survey_responses WHERE survey_id = ?').get(s.id).c;
    s.responded = empId ? !!db.prepare('SELECT 1 FROM survey_responses WHERE survey_id = ? AND employee_id = ?').get(s.id, empId) : false;

    // Check if deadline passed
    const now = new Date();
    s.isExpired = s.deadline ? new Date(s.deadline) < now : false;

    // Calculate if eligible
    s.isEligible = true;
    if (emp && s.target_department && s.target_department !== emp.department) s.isEligible = false;
    if (emp && s.target_manager_id && s.target_manager_id !== emp.manager_id) s.isEligible = false;

    // Add days remaining
    if (s.deadline) {
      const diff = new Date(s.deadline) - now;
      s.daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }
  }
  res.json({ surveys: rows, isAdmin });
});

// Create a survey (HR/Super) with modern HRMS features
router.post('/', requirePerm('settings:manage'), (req, res) => {
  const { title, description, questions, anonymous, category, deadline, target_department, target_manager_id, response_required, show_results } = req.body || {};
  if (!title || !Array.isArray(questions) || !questions.length) return res.status(400).json({ error: 'Title and at least one question are required.' });

  // Validate question types
  const validTypes = ['text', 'rating', 'nps', 'choice', 'yes_no', 'ranking', 'matrix'];
  const clean = questions
    .map((q) => ({
      text: String(q.text || '').trim(),
      type: validTypes.includes(q.type) ? q.type : 'text'
    }))
    .filter((q) => q.text);

  const r = db.prepare(`
    INSERT INTO surveys (title, description, questions, anonymous, category, deadline, target_department, target_manager_id, response_required, show_results, created_by, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    title,
    description || '',
    JSON.stringify(clean),
    anonymous ? 1 : 0,
    category || 'engagement',
    deadline || null,
    target_department || null,
    target_manager_id || null,
    response_required ? 1 : 0,
    show_results !== false ? 1 : 0,
    req.session.user.id
  );
  res.json({ id: r.lastInsertRowid, message: 'Survey created successfully' });
});

router.put('/:id', requirePerm('settings:manage'), (req, res) => {
  const s = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const active = req.body && req.body.active ? 1 : 0;
  db.prepare('UPDATE surveys SET active = ? WHERE id = ?').run(active, s.id);
  res.json({ ok: true });
});

router.delete('/:id', requirePerm('settings:manage'), (req, res) => {
  db.prepare('DELETE FROM surveys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Submit a response.
router.post('/:id/respond', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.status(400).json({ error: 'Only employees can respond.' });
  const s = db.prepare('SELECT * FROM surveys WHERE id = ? AND active = 1').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Survey not available.' });
  const answers = (req.body && req.body.answers) || [];
  try {
    db.prepare('INSERT INTO survey_responses (survey_id, employee_id, answers) VALUES (?, ?, ?)')
      .run(s.id, empId, JSON.stringify(answers));
  } catch (e) {
    return res.status(400).json({ error: 'You have already responded to this survey.' });
  }
  res.json({ ok: true });
});

// View responses with analytics (HR/Super)
router.get('/:id/responses', requirePerm('settings:manage'), (req, res) => {
  const s = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });

  s.questions = JSON.parse(s.questions || '[]');
  const rows = db.prepare(
    `SELECT sr.*, e.name AS employee_name FROM survey_responses sr
     LEFT JOIN employees e ON e.id = sr.employee_id WHERE sr.survey_id = ? ORDER BY sr.created_at DESC`
  ).all(s.id);

  // Calculate eligible employees
  let eligibleQuery = 'SELECT COUNT(*) c FROM employees WHERE status = "active"';
  if (s.target_department) {
    eligibleQuery += ` AND department = '${s.target_department}'`;
  }
  if (s.target_manager_id) {
    eligibleQuery += ` AND manager_id = ${s.target_manager_id}`;
  }
  const totalEligible = db.prepare(eligibleQuery).get().c;

  const responses = rows.map((r) => ({
    employee_name: s.anonymous ? 'Anonymous' : r.employee_name,
    answers: JSON.parse(r.answers || '[]'),
    created_at: r.created_at,
  }));

  res.json({
    survey: {
      id: s.id,
      title: s.title,
      description: s.description,
      questions: s.questions,
      category: s.category,
      anonymous: !!s.anonymous,
      deadline: s.deadline,
      show_results: !!s.show_results,
      totalEligible,
      responseCount: responses.length,
    },
    responses
  });
});

module.exports = router;
