const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

// List surveys with analytics
router.get('/', requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.user.permissions.includes('*') || req.session.user.permissions.includes('settings:manage');
    const rows = isAdmin
      ? await db.prepare('SELECT * FROM surveys ORDER BY created_at DESC').all()
      : await db.prepare('SELECT * FROM surveys WHERE active = 1 ORDER BY created_at DESC').all();

    const empId = req.session.user.employeeId;
    const emp = empId ? await db.prepare('SELECT department, manager_id FROM employees WHERE id = ?').get(empId) : null;

    for (const s of rows) {
      s.questions = JSON.parse(s.questions || '[]');
      s.responseCount = (await db.prepare('SELECT COUNT(*) c FROM survey_responses WHERE survey_id = ?').get(s.id)).c;
      s.responded = empId ? !!await db.prepare('SELECT 1 FROM survey_responses WHERE survey_id = ? AND employee_id = ?').get(s.id, empId) : false;

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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a survey (HR/Super) with modern HRMS features
router.post('/', requirePerm('settings:manage'), async (req, res) => {
  try {
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', requirePerm('settings:manage'), async (req, res) => {
  try {
    const s = await db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const active = req.body && req.body.active ? 1 : 0;
    await db.prepare('UPDATE surveys SET active = ? WHERE id = ?').run(active, s.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', requirePerm('settings:manage'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM surveys WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Submit a response.
router.post('/:id/respond', requireLogin, async (req, res) => {
  try {
    const empId = req.session.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'Only employees can respond.' });
    const s = await db.prepare('SELECT * FROM surveys WHERE id = ? AND active = 1').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Survey not available.' });
    // Enforce targeting server-side (don't trust the client's eligibility view):
    // a department-/manager-targeted survey may only be answered by its audience.
    if (s.target_department || s.target_manager_id) {
      const emp = await db.prepare('SELECT department, manager_id FROM employees WHERE id = ?').get(empId);
      if (s.target_department && (!emp || emp.department !== s.target_department)) return res.status(403).json({ error: 'This survey is not addressed to you.' });
      if (s.target_manager_id && (!emp || emp.manager_id !== s.target_manager_id)) return res.status(403).json({ error: 'This survey is not addressed to you.' });
    }
    const answers = (req.body && req.body.answers) || [];
    try {
      await db.prepare('INSERT INTO survey_responses (survey_id, employee_id, answers) VALUES (?, ?, ?)')
        .run(s.id, empId, JSON.stringify(answers));
    } catch (e) {
      return res.status(400).json({ error: 'You have already responded to this survey.' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// View responses with analytics (HR/Super)
router.get('/:id/responses', requirePerm('settings:manage'), async (req, res) => {
  try {
    const s = await db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });

    s.questions = JSON.parse(s.questions || '[]');
    const rows = await db.prepare(
      `SELECT sr.*, e.name AS employee_name FROM survey_responses sr
       LEFT JOIN employees e ON e.id = sr.employee_id WHERE sr.survey_id = ? ORDER BY sr.created_at DESC`
    ).all(s.id);

    // Calculate eligible employees. (Single-quoted literal — Postgres treats
    // "active" as an identifier; parameterised to avoid SQL injection.)
    let eligibleQuery = "SELECT COUNT(*) c FROM employees WHERE status = 'active'";
    const eligibleParams = [];
    if (s.target_department) {
      eligibleQuery += ' AND department = ?';
      eligibleParams.push(s.target_department);
    }
    if (s.target_manager_id) {
      eligibleQuery += ' AND manager_id = ?';
      eligibleParams.push(s.target_manager_id);
    }
    const totalEligible = (await db.prepare(eligibleQuery).get(...eligibleParams)).c;

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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
