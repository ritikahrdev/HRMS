const { can } = require('../services/permissions');
const db = require('../db');

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Please log in.' });
  }
  next();
}

// Requires a specific permission. MANAGER passes for team-scoped permissions;
// the route handler is responsible for limiting results to the manager's team.
function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Please log in.' });
    if (!can(req.session.user.role, perm)) return res.status(403).json({ error: 'You do not have access to this.' });
    next();
  };
}

// SUPER_ADMIN only.
function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Please log in.' });
  if (req.session.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Super admin only.' });
  next();
}

// Returns the employee ids managed by the current user (their direct reports).
function teamEmployeeIds(req) {
  const myEmpId = req.session.user.employeeId;
  if (!myEmpId) return [];
  return db.prepare('SELECT id FROM employees WHERE manager_id = ?').all(myEmpId).map((r) => r.id);
}

// True if the user may act on a given employee record (admins: any; managers: own team).
function canActOnEmployee(req, employeeId) {
  const role = req.session.user.role;
  if (role === 'SUPER_ADMIN' || role === 'HR_ADMIN' || role === 'FINANCE_ADMIN') return true;
  if (role === 'MANAGER') return teamEmployeeIds(req).includes(Number(employeeId));
  return req.session.user.employeeId === Number(employeeId);
}

module.exports = { requireLogin, requirePerm, requireSuperAdmin, teamEmployeeIds, canActOnEmployee };
