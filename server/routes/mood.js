const express = require('express');
const db = require('../db');
const { requireLogin, requirePerm } = require('../middleware/auth');

const router = express.Router();

// Score labels and emoji
const MOOD = {
  1: { emoji: '😞', label: 'Very Unhappy', color: '#ef4444' },
  2: { emoji: '😟', label: 'Unhappy',      color: '#f97316' },
  3: { emoji: '😐', label: 'Neutral',      color: '#eab308' },
  4: { emoji: '😊', label: 'Happy',        color: '#22c55e' },
  5: { emoji: '😄', label: 'Very Happy',   color: '#10b981' },
};

function scoreToLabel(s) { return MOOD[Math.round(s)] || MOOD[3]; }

// Employee submits today's mood
router.post('/checkin', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account.' });
  const score = parseInt(req.body && req.body.score);
  if (!score || score < 1 || score > 5) return res.status(400).json({ error: 'Score must be 1–5.' });
  const note = (req.body && req.body.note) ? String(req.body.note).trim().slice(0, 300) : null;
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO mood_checkins (employee_id, score, note, date)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET score=excluded.score, note=excluded.note
  `).run(empId, score, note, today);
  res.json({ ok: true, score, label: MOOD[score].label, emoji: MOOD[score].emoji });
});

// Employee's own mood history (last 30 days)
router.get('/my', requireLogin, (req, res) => {
  const empId = req.session.user.employeeId;
  if (!empId) return res.json({ checkins: [], today: null, average: null });
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM mood_checkins
    WHERE employee_id = ?
    ORDER BY date DESC LIMIT 30
  `).all(empId);
  const todayEntry = rows.find(r => r.date === today) || null;
  const avg = rows.length ? +(rows.reduce((s, r) => s + r.score, 0) / rows.length).toFixed(2) : null;
  res.json({ checkins: rows, today: todayEntry, average: avg, mood: avg ? scoreToLabel(avg) : null });
});

// ---- Admin / HR endpoints ----

// Company-wide happiness dashboard
router.get('/dashboard', requirePerm('reports:view'), (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // Overall company score
  const overall = db.prepare(`
    SELECT ROUND(AVG(m.score), 2) AS avg_score, COUNT(*) AS total_checkins,
           COUNT(DISTINCT m.employee_id) AS participating
    FROM mood_checkins m
    JOIN employees e ON e.id = m.employee_id
    WHERE m.date >= ? AND e.status = 'active'
  `).get(since);

  // Total active employees
  const totalActive = db.prepare("SELECT COUNT(*) AS n FROM employees WHERE status='active'").get().n;

  // Department breakdown
  const byDept = db.prepare(`
    SELECT e.department,
           ROUND(AVG(m.score), 2) AS avg_score,
           COUNT(*) AS checkins,
           COUNT(DISTINCT m.employee_id) AS employees
    FROM mood_checkins m
    JOIN employees e ON e.id = m.employee_id
    WHERE m.date >= ? AND e.status = 'active' AND e.department IS NOT NULL AND e.department != ''
    GROUP BY e.department
    ORDER BY avg_score DESC
  `).all(since);

  // Daily trend (last 30 days)
  const trend = db.prepare(`
    SELECT date, ROUND(AVG(score), 2) AS avg_score, COUNT(*) AS responses
    FROM mood_checkins
    WHERE date >= ?
    GROUP BY date ORDER BY date ASC
  `).all(since);

  // Per-employee scores (admins only — for spotting who needs attention)
  const perEmployee = db.prepare(`
    SELECT e.id, e.name, e.emp_code, e.department,
           ROUND(AVG(m.score), 2) AS avg_score,
           COUNT(*) AS checkins,
           MAX(m.date) AS last_checkin
    FROM employees e
    LEFT JOIN mood_checkins m ON m.employee_id = e.id AND m.date >= ?
    WHERE e.status = 'active'
    GROUP BY e.id
    ORDER BY avg_score ASC NULLS LAST
  `).all(since);

  // Recent check-ins with notes (last 10 notes)
  const recentNotes = db.prepare(`
    SELECT m.score, m.note, m.date, e.name, e.department
    FROM mood_checkins m
    JOIN employees e ON e.id = m.employee_id
    WHERE m.note IS NOT NULL AND m.note != '' AND m.date >= ?
    ORDER BY m.created_at DESC LIMIT 10
  `).all(since);

  res.json({
    days,
    overall: {
      avg_score: overall.avg_score,
      total_checkins: overall.total_checkins,
      participating: overall.participating,
      total_active: totalActive,
      participation_rate: totalActive ? Math.round((overall.participating / totalActive) * 100) : 0,
      mood: overall.avg_score ? scoreToLabel(overall.avg_score) : null,
    },
    by_department: byDept,
    trend,
    per_employee: perEmployee,
    recent_notes: recentNotes,
  });
});

module.exports = router;
