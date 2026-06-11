// Central role + permission definitions. Defaults can be overridden per role
// from Settings (settings.rolePermissions), controllable by the Super Admin.

const ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'FINANCE_ADMIN', 'MANAGER', 'EMPLOYEE'];

// '*' means "all permissions".
// MANAGER permissions are team-scoped — route handlers restrict to own reports.
const DEFAULT_PERMISSIONS = {
  SUPER_ADMIN: ['*'],
  HR_ADMIN: [
    'employees:read', 'employees:write',
    'attendance:viewAll', 'attendance:correct',
    'leave:approve', 'reports:view', 'settings:manage', 'payroll:view',
    'recruitment:manage', 'offboarding:manage', 'timesheets:approve',
  ],
  FINANCE_ADMIN: [
    'employees:read', 'payroll:manage', 'payroll:view',
    'reimbursement:approve', 'reports:view',
  ],
  MANAGER: [
    'team:view', 'attendance:viewTeam', 'attendance:correct',
    'leave:approve', 'reimbursement:approve', 'timesheets:approve',
  ],
  EMPLOYEE: [],
};

// Catalogue of every grantable permission, with friendly labels for the UI.
const ALL_PERMISSIONS = [
  { key: 'employees:read', label: 'View employees', group: 'People' },
  { key: 'employees:write', label: 'Add / edit / delete employees', group: 'People' },
  { key: 'team:view', label: 'View own team (manager)', group: 'People' },
  { key: 'attendance:viewAll', label: 'View everyone’s attendance', group: 'Attendance' },
  { key: 'attendance:viewTeam', label: 'View team attendance', group: 'Attendance' },
  { key: 'attendance:correct', label: 'Edit attendance & approve requests', group: 'Attendance' },
  { key: 'leave:approve', label: 'Approve leave & comp-off', group: 'Leave' },
  { key: 'reimbursement:approve', label: 'Approve reimbursements', group: 'Reimbursement' },
  { key: 'payroll:view', label: 'View payroll & payslips', group: 'Payroll' },
  { key: 'payroll:manage', label: 'Run / manage payroll & loans', group: 'Payroll' },
  { key: 'reports:view', label: 'View reports', group: 'Reports' },
  { key: 'settings:manage', label: 'Manage company settings', group: 'Admin' },
  { key: 'recruitment:manage', label: 'Manage recruitment & hiring', group: 'Recruitment' },
  { key: 'offboarding:manage', label: 'Manage offboarding & exits', group: 'Offboarding' },
  { key: 'timesheets:approve', label: 'Manage projects & approve timesheets', group: 'Timesheets' },
];

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  HR_ADMIN: 'HR Admin',
  FINANCE_ADMIN: 'Finance Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

// Lazily read Settings overrides (avoids module load-order cycles).
function getOverrides() {
  try { return require('./settings').getSettings().rolePermissions || {}; }
  catch (e) { return {}; }
}

// Effective permission list for a role (override wins over default).
// Super Admin is always full access — it can never be locked out.
function effectivePermissions(role) {
  if (role === 'SUPER_ADMIN') return ['*'];
  const ov = getOverrides();
  if (Array.isArray(ov[role])) return ov[role];
  return DEFAULT_PERMISSIONS[role] || [];
}

function can(role, perm) {
  const list = effectivePermissions(role);
  return list.includes('*') || list.includes(perm);
}

function isStaff(role) {
  return role !== 'EMPLOYEE';
}

module.exports = {
  ROLES, ROLE_LABELS, ALL_PERMISSIONS,
  PERMISSIONS: DEFAULT_PERMISSIONS, DEFAULT_PERMISSIONS,
  effectivePermissions, can, isStaff,
};
