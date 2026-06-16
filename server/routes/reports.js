const express = require('express');
const db = require('../db');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();

// Dashboard headline numbers + detail panels for admin.
router.get('/overview', requirePerm('reports:view'), async (req, res) => {
  try {
    const totalEmployees = (await db.prepare("SELECT COUNT(*) c FROM employees WHERE status='active'").get()).c;
    const pendingLeaves = (await db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='pending'").get()).c;
    const pendingReimb = (await db.prepare("SELECT COUNT(*) c FROM reimbursements WHERE status='pending'").get()).c;

    const today = new Date().toISOString().slice(0, 10);
    const presentToday = (await db.prepare(
      "SELECT COUNT(*) c FROM attendance a JOIN employees e ON e.id = a.employee_id AND e.status='active' WHERE a.date = ? AND (a.check_in IS NOT NULL OR a.status IN ('present','half'))"
    ).get(today)).c;

    // Who is on leave today — from BOTH sources so the dashboard matches the
    // attendance board: (1) approved leave requests, and (2) attendance marked
    // 'leave' (e.g. via the Slack bot or a manual edit). Deduped by employee.
    const formalLeave = await db.prepare(
      `SELECT e.id AS emp_id, e.name, e.department, lr.type, lr.from_date, lr.to_date, lr.days, lr.half_day, lr.reason
       FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
       WHERE lr.status='approved' AND lr.from_date <= ? AND lr.to_date >= ?
       ORDER BY e.name`
    ).all(today, today);
    const attLeave = await db.prepare(
      `SELECT e.id AS emp_id, e.name, e.department, a.reason
       FROM attendance a JOIN employees e ON e.id = a.employee_id
       WHERE a.date = ? AND a.status = 'leave' AND e.status = 'active' ORDER BY e.name`
    ).all(today);
    const seenLeave = new Set(formalLeave.map((r) => r.emp_id));
    const onLeaveToday = [
      ...formalLeave,
      ...attLeave.filter((r) => !seenLeave.has(r.emp_id)).map((r) => ({
        emp_id: r.emp_id, name: r.name, department: r.department, type: 'Leave',
        from_date: today, to_date: today, days: 1, half_day: 0, reason: r.reason || '',
      })),
    ];

    // Detail: pending leave requests — with dates + reason (for quick triage).
    const pendingLeaveDetails = await db.prepare(
      `SELECT lr.id, e.name, e.department, lr.type, lr.from_date, lr.to_date, lr.days, lr.half_day, lr.reason, lr.applied_at
       FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
       WHERE lr.status='pending' ORDER BY lr.applied_at DESC LIMIT 8`
    ).all();

    // Detail: pending attendance correction requests — with date + reason.
    const pendingCorrections = await db.prepare(
      `SELECT c.id, e.name, c.date, c.type, c.requested_status, c.reason, c.applied_at
       FROM attendance_corrections c JOIN employees e ON e.id = c.employee_id
       WHERE c.status='pending' ORDER BY c.applied_at DESC LIMIT 8`
    ).all();

    res.json({
      totalEmployees,
      presentToday,
      absentToday: Math.max(0, totalEmployees - presentToday - onLeaveToday.length),
      pendingLeaves,
      pendingReimb,
      onLeaveToday,
      pendingLeaveDetails,
      pendingCorrections,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Monthly attendance report per employee.
router.get('/attendance', requirePerm('reports:view'), async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const rows = await db.prepare(
      `SELECT e.id, e.name, e.emp_code, e.department,
              SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN a.status='half' THEN 1 ELSE 0 END) AS half,
              SUM(CASE WHEN a.status='leave' THEN 1 ELSE 0 END) AS leave_days,
              SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN COALESCE(a.late_minutes,0) > 0 THEN 1 ELSE 0 END) AS late_days,
              ROUND(COALESCE(SUM(a.ot_hours),0)::numeric, 2) AS ot_hours
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date LIKE ?
       WHERE e.status='active'
       GROUP BY e.id ORDER BY e.name`
    ).all(`${month}-%`);
    res.json({ month, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Payroll summary for a month.
router.get('/payroll', requirePerm('reports:view'), async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const rows = await db.prepare(
      `SELECT p.*, e.name, e.emp_code, e.department FROM payslips p
       JOIN employees e ON e.id = p.employee_id WHERE p.month = ? ORDER BY e.name`
    ).all(month);
    const totals = rows.reduce(
      (t, r) => {
        t.gross += r.gross; t.deductions += r.deductions; t.net += r.net_salary;
        return t;
      },
      { gross: 0, deductions: 0, net: 0 }
    );
    res.json({ month, rows, totals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
