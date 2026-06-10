const express = require('express');
const db = require('../db');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();

// Dashboard headline numbers for admin.
router.get('/overview', requirePerm('reports:view'), async (req, res) => {
  try {
    const totalEmployees = (await db.prepare("SELECT COUNT(*) c FROM employees WHERE status='active'").get()).c;
    const pendingLeaves = (await db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='pending'").get()).c;
    const pendingReimb = (await db.prepare("SELECT COUNT(*) c FROM reimbursements WHERE status='pending'").get()).c;

    const today = new Date().toISOString().slice(0, 10);
    const presentToday = (await db.prepare(
      "SELECT COUNT(*) c FROM attendance WHERE date = ? AND (check_in IS NOT NULL OR status IN ('present','half'))"
    ).get(today)).c;

    res.json({
      totalEmployees,
      presentToday,
      absentToday: Math.max(0, totalEmployees - presentToday),
      pendingLeaves,
      pendingReimb,
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
              ROUND(COALESCE(SUM(a.ot_hours),0),2) AS ot_hours
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
