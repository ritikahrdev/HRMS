const express = require('express');
const db = require('../db');
const { requirePerm } = require('../middleware/auth');

const router = express.Router();

// Dashboard headline numbers for admin.
router.get('/overview', requirePerm('reports:view'), async (req, res) => {
  const totalRow = await db.prepare("SELECT COUNT(*) AS c FROM employees WHERE status='active'").get();
  const totalEmployees = totalRow ? Number(totalRow.c) || 0 : 0;

  const leavesRow = await db.prepare("SELECT COUNT(*) AS c FROM leave_requests WHERE status='pending'").get();
  const pendingLeaves = leavesRow ? Number(leavesRow.c) || 0 : 0;

  const reimbRow = await db.prepare("SELECT COUNT(*) AS c FROM reimbursements WHERE status='pending'").get();
  const pendingReimb = reimbRow ? Number(reimbRow.c) || 0 : 0;

  const today = new Date().toISOString().slice(0, 10);
  const presentRow = await db.prepare(
    "SELECT COUNT(*) AS c FROM attendance WHERE date = $1 AND (check_in IS NOT NULL OR status IN ('present','half'))"
  ).get(today);
  const presentToday = presentRow ? Number(presentRow.c) || 0 : 0;

  res.json({
    totalEmployees,
    presentToday,
    absentToday: Math.max(0, totalEmployees - presentToday),
    pendingLeaves,
    pendingReimb,
  });
});

// Monthly attendance report per employee.
router.get('/attendance', requirePerm('reports:view'), async (req, res) => {
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
     LEFT JOIN attendance a ON a.employee_id = e.id AND a.date LIKE $1
     WHERE e.status='active'
     GROUP BY e.id, e.name, e.emp_code, e.department ORDER BY e.name`
  ).all(`${month}-%`);
  res.json({ month, rows });
});

// Payroll summary for a month.
router.get('/payroll', requirePerm('reports:view'), async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = await db.prepare(
    `SELECT p.*, e.name, e.emp_code, e.department FROM payslips p
     JOIN employees e ON e.id = p.employee_id WHERE p.month = $1 ORDER BY e.name`
  ).all(month);
  const totals = rows.reduce(
    (t, r) => {
      t.gross += Number(r.gross) || 0;
      t.deductions += Number(r.deductions) || 0;
      t.net += Number(r.net_salary) || 0;
      return t;
    },
    { gross: 0, deductions: 0, net: 0 }
  );
  res.json({ month, rows, totals });
});

module.exports = router;
