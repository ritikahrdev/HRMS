const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

// List surveys with analytics
router.get('/', requireLogin, async (req, res) => {
  const isAdmin = req.session.user.permissions.includes('*') || req.session.user.permissions.includes('settings:manage');
  let rows;
  if (isAdmin) {
    rows = await db.prepare('SELECT * FROM surveys ORDER BY created_at DESC').all();
  } else {
    rows = await db.prepare('SELECT * FROM surveys WHERE active = 1 ORDER BY created_at DESC').all();
  }

  const empId = req.session.user.employeeId;
  const emp = empId ? await db.prepare('SELECT department, manager_id FROM employees WHERE id = $1').get(empId) : null;

  for (const s of rows) {
    s.questions = JSON.parse(s.questions || '[]');
    const countRow = await db.prepare('SELECT COUNT(*) AS c FROM survey_responses WHERE survey_id = $1').get(s.id);
    s.responseCount = countRow ? Number(countRow.c) || 0 : 0;
    if (empId) {
      const respondedRow = await db.prepare('SELECT 1 AS found FROM survey_responses WHERE survey_id = $1 AND employee_id = $2').get(s.id, empId);
      s.responded = !!respondedRow;
    } else {
      s.responded = false;
    }

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
router.post('/', requirePerm('settings:manage'), async (req, res) => {
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

  const r = await db.prepare(`
    INSERT INTO surveys (title, description, questions, anonymous, category, deadline, target_department, target_manager_id, response_required, show_results, created_by, active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
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

router.put('/:id', requirePerm('settings:manage'), async (req, res) => {
  const s = await db.prepare('SELECT * FROM surveys WHERE id = $1').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const active = req.body && req.body.active ? 1 : 0;
  await db.prepare('UPDATE surveys SET active = $1 WHERE id = $2').run(active, s.id);
  res.json({ ok: true });
});

router.delete('/:id', requirePerm('settings:manage'), async (req, res) => {
  await db.prepare('DELETE FROM surveys WHERE id = $1').run(req.params.id);
  res.json({ ok: true });
});

// Submit a response.
router.post('/:id/respond', requireLogin, async (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.status(400).json({ error: 'Only employees can respond.' });
  const s = await db.prepare('SELECT * FROM surveys WHERE id = $1 AND active = 1').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Survey not available.' });
  const answers = (req.body && req.body.answers) || [];
  try {
    await db.prepare('INSERT INTO survey_responses (survey_id, employee_id, answers) VALUES ($1, $2, $3)')
      .run(s.id, empId, JSON.stringify(answers));
  } catch (e) {
    return res.status(400).json({ error: 'You have already responded to this survey.' });
  }
  res.json({ ok: true });
});

// View responses with analytics (HR/Super)
router.get('/:id/responses', requirePerm('settings:manage'), async (req, res) => {
  const s = await db.prepare('SELECT * FROM surveys WHERE id = $1').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });

  s.questions = JSON.parse(s.questions || '[]');
  const rows = await db.prepare(
    `SELECT sr.*, e.name AS employee_name FROM survey_responses sr
     LEFT JOIN employees e ON e.id = sr.employee_id WHERE sr.survey_id = $1 ORDER BY sr.created_at DESC`
  ).all(s.id);

  // Calculate eligible employees
  let eligibleRows;
  if (s.target_department && s.target_manager_id) {
    eligibleRows = await db.prepare(
      "SELECT COUNT(*) AS c FROM employees WHERE status = 'active' AND department = $1 AND manager_id = $2"
    ).get(s.target_department, s.target_manager_id);
  } else if (s.target_department) {
    eligibleRows = await db.prepare(
      "SELECT COUNT(*) AS c FROM employees WHERE status = 'active' AND department = $1"
    ).get(s.target_department);
  } else if (s.target_manager_id) {
    eligibleRows = await db.prepare(
      "SELECT COUNT(*) AS c FROM employees WHERE status = 'active' AND manager_id = $1"
    ).get(s.target_manager_id);
  } else {
    eligibleRows = await db.prepare(
      "SELECT COUNT(*) AS c FROM employees WHERE status = 'active'"
    ).get();
  }
  const totalEligible = eligibleRows ? Number(eligibleRows.c) || 0 : 0;

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
