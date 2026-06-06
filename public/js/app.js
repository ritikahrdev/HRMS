const App = {
  user: null,
  branding: { companyName: 'HR Portal', logoFile: '', currency: '₹' },

  has(perm) {
    const p = (this.user && this.user.permissions) || [];
    return p.includes('*') || p.includes(perm);
  },

  // Builds the visible navigation for the current user from their permissions.
  // Is this user an admin/staff member (sees the Admin section)?
  isStaff() {
    return ['employees:read', 'employees:write', 'attendance:viewAll', 'attendance:viewTeam',
      'attendance:correct', 'leave:approve', 'reimbursement:approve', 'payroll:view',
      'reports:view', 'settings:manage'].some((p) => this.has(p)) || this.user.role === 'MANAGER' || this.user.isManager;
  },

  navFor() {
    const u = this.user;
    const c = () => App.content();
    const isManager = u.role === 'MANAGER' || u.isManager;
    const items = [];
    const push = (section, hash, label, view) => items.push({ section, hash, label, view });

    // ---- ME (personal self-service — every user) ----
    push('Me', '#/', 'Dashboard', () => App.dashboard(c()));
    if (u.employeeId) {
      push('Me', '#/my-attendance', 'My Attendance', () => EmployeeViews.attendance(c()));
      push('Me', '#/my-leave', 'My Leave', () => EmployeeViews.leave(c()));
      if (this.modOn('reimbursement')) push('Me', '#/my-reimb', 'My Reimbursements', () => EmployeeViews.reimbursement(c()));
      push('Me', '#/my-payslips', 'My Payslips', () => EmployeeViews.payslips(c()));
    }
    push('Me', '#/profile', 'My Profile', () => EmployeeViews.profile(c()));

    // ---- COMPANY (shared employee self-service — every user, if module on) ----
    if (this.modOn('directory')) push('Company', '#/directory', 'Directory', () => AdminViews.directory(c()));
    if (this.modOn('notices')) push('Company', '#/notices', 'Notice Board', () => AdminViews.announcements(c()));
    if (this.modOn('holidays')) push('Company', '#/holidays', 'Holidays', () => AdminViews.holidays(c()));
    if (this.modOn('recognition')) push('Company', '#/recognition', 'Recognition', () => AdminViews.recognition(c()));
    if (this.modOn('performance')) push('Company', '#/performance', 'Performance', () => AdminViews.performance(c()));
    if (this.modOn('surveys')) push('Company', '#/surveys', 'Surveys', () => AdminViews.surveys(c()));
    if (this.modOn('helpdesk')) push('Company', '#/helpdesk', 'Helpdesk', () => AdminViews.helpdesk(c()));
    // Mood/happiness is captured alongside attendance — no separate section.

    // ---- ADMIN (only for staff with the matching permission) ----
    if (this.has('employees:read')) push('Admin', '#/employees', 'Employees', () => AdminViews.employees(c()));
    if (isManager) push('Admin', '#/team', 'My Team', () => AdminViews.team(c()));
    if (this.has('employees:write')) push('Admin', '#/import', 'Import Excel', () => AdminViews.import(c()));
    if (this.has('recruitment:manage') && this.modOn('recruitment')) push('Admin', '#/recruitment', 'Recruitment', () => AdminViews.recruitment(c()));
    if (this.has('attendance:viewAll') || this.has('attendance:viewTeam')) push('Admin', '#/attendance', 'Attendance', () => AdminViews.attendance(c()));
    if (this.has('attendance:correct')) push('Admin', '#/corrections', 'Attendance Requests', () => AdminViews.corrections(c()));
    if (this.has('leave:approve')) push('Admin', '#/leave-approvals', 'Leave Approvals', () => AdminViews.leave(c()));
    if (this.has('leave:approve')) push('Admin', '#/leave-calendar', 'Leave Calendar', () => AdminViews.leaveCalendar(c()));
    if (this.has('reimbursement:approve') && this.modOn('reimbursement')) push('Admin', '#/reimb-approvals', 'Reimbursement Approvals', () => AdminViews.reimbursement(c()));
    if (this.has('payroll:view')) push('Admin', '#/payroll', 'Payroll', () => AdminViews.payroll(c()));
    if (this.has('payroll:manage') && this.modOn('loans')) push('Admin', '#/loans', 'Loans & Advances', () => AdminViews.loans(c()));
    if (this.has('employees:write') && this.modOn('assets')) push('Admin', '#/assets', 'Assets', () => AdminViews.assets(c()));
    if (this.has('settings:manage')) push('Admin', '#/inventory', 'Inventory', () => AdminViews.inventory(c()));
    if (this.has('reports:view')) push('Admin', '#/reports', 'Reports', () => AdminViews.reports(c()));
    if (this.has('settings:manage')) push('Admin', '#/settings', 'Settings', () => AdminViews.settings(c()));

    return items;
  },

  // Picks the right dashboard for the role.
  dashboard(c) {
    if (this.has('reports:view')) return AdminViews.dashboard(c);
    if (this.has('team:view') || this.user.isManager) return AdminViews.teamDashboard(c);
    return EmployeeViews.dashboard(c);
  },

  content() { return document.getElementById('view'); },

  NAV_ICONS: {
    '#/': '🏠', '#/my-attendance': '🕒', '#/my-leave': '🌴', '#/my-reimb': '🧾',
    '#/my-payslips': '💸', '#/profile': '👤',
    '#/directory': '📒', '#/notices': '📢', '#/holidays': '📅', '#/recognition': '🏆',
    '#/performance': '🎯', '#/surveys': '📝', '#/helpdesk': '🎧',
    '#/employees': '👥', '#/team': '🧑‍🤝‍🧑', '#/import': '📥', '#/attendance': '🕒',
    '#/corrections': '✏️', '#/leave-approvals': '✅', '#/leave-calendar': '📆',
    '#/reimb-approvals': '💳', '#/payroll': '💰', '#/loans': '🏦', '#/assets': '💻',
    '#/inventory': '📦', '#/happiness': '💛', '#/reports': '📊', '#/settings': '⚙️',
    '#/my-mood': '😊',
  },

  // Product branding (the software's own name; the company is separate).
  PRODUCT: { name: 'Hrika', tagline: 'your people, handled' },

  initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '')[0] || '') + (parts.length > 1 ? (parts[parts.length - 1][0] || '') : '');
  },

  modOn(key) { return !this.modules || this.modules[key] !== false; },

  async init() {
    try { this.branding = await api.get('/settings/public'); } catch (e) {}
    this.modules = (this.branding && this.branding.modules) || {};
    this.requiredDocs = (this.branding && this.branding.requiredDocs) || [];
    UI.currency = this.branding.currency || '₹';
    try {
      const { user } = await api.get('/auth/me');
      this.user = user;
      this.renderApp();
    } catch (e) {
      this.renderLogin();
    }
  },

  renderLogin(error) {
    const b = this.branding;
    document.getElementById('app').innerHTML = `
      <div class="login-wrap"><div class="login-card">
        ${b.logoFile ? `<img class="logo" src="/uploads/${UI.esc(b.logoFile)}" />` : ''}
        <h1>${UI.esc(App.PRODUCT.name)}</h1>
        <p class="sub">${UI.esc(App.PRODUCT.tagline)}</p>
        ${b.companyName ? `<p class="sub" style="margin-top:-18px;font-size:12px">for ${UI.esc(b.companyName)}</p>` : ''}
        <div class="field"><label>Email</label><input id="email" type="email" autocomplete="username" /></div>
        <div class="field"><label>Password</label><input id="password" type="password" autocomplete="current-password" /></div>
        ${error ? `<div class="issues" style="margin-bottom:12px">${UI.esc(error)}</div>` : ''}
        <button class="btn" id="login" style="width:100%">Sign In</button>
      </div></div>`;
    const submit = async () => {
      try {
        const { user } = await api.post('/auth/login', {
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        });
        this.user = user;
        if (user.must_change) { this.renderApp(); this.changePasswordModal(true); }
        else this.renderApp();
      } catch (e) { this.renderLogin(e.message); }
    };
    document.getElementById('login').onclick = submit;
    document.getElementById('password').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  },

  renderApp() {
    this.items = this.navFor();
    const items = this.items;
    const b = this.branding;
    document.getElementById('app').innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="brand">
            ${b.logoFile ? `<img src="/uploads/${UI.esc(b.logoFile)}" />` : ''}
            <b>${UI.esc(b.companyName || 'HR Portal')}</b>
          </div>
          <nav id="nav">${['Me', 'Company', 'Admin'].map((sec) => {
            const its = items.filter((i) => i.section === sec);
            if (!its.length) return '';
            return `<div class="nav-section">${sec === 'Me' ? 'My Space' : sec === 'Company' ? 'Company' : 'Admin'}</div>`
              + its.map((i) => `<div class="nav-item" data-hash="${i.hash}"><span class="nav-ico">${App.NAV_ICONS[i.hash] || '•'}</span><span class="label">${UI.esc(i.label)}</span></div>`).join('');
          }).join('')}</nav>
          <div class="nav-item" id="logout"><span class="nav-ico">↩</span><span class="label">Logout</span></div>
        </aside>
        <div class="main">
          <div class="topbar">
            <h2 id="page-title">Dashboard</h2>
            <div class="spacer"></div>
            <div class="notif-wrap">
              <button class="notif-btn" id="notifBell" title="Notifications">🔔<span class="notif-badge" id="notifBadge" style="display:none">0</span></button>
              <div class="notif-panel" id="notifPanel" style="display:none"></div>
            </div>
            <div class="userbox" id="userbox" tabindex="0">
              <div class="meta"><div class="nm">${UI.esc(this.user.name)}</div><div class="rl">${UI.esc(this.user.roleLabel || this.user.role)}</div></div>
              <div class="avatar">${UI.esc(App.initials(this.user.name))}</div>
              <div class="user-menu" id="userMenu">
                <div class="user-menu-item" id="menuProfile">👤 My Profile</div>
                <div class="user-menu-item" id="menuChangePw">🔑 Change Password</div>
                <div class="user-menu-item danger" id="menuLogout">↩ Logout</div>
              </div>
            </div>
          </div>
          <div class="content" id="view"></div>
        </div>
      </div>`;
    // Sidebar logout
    const doLogout = async () => { await api.post('/auth/logout'); location.hash = '#/'; location.reload(); };
    document.getElementById('logout').onclick = doLogout;

    // Topbar user menu dropdown
    const userbox = document.getElementById('userbox');
    const userMenu = document.getElementById('userMenu');
    userbox.onclick = (e) => { e.stopPropagation(); userMenu.classList.toggle('open'); };
    document.addEventListener('click', () => userMenu.classList.remove('open'), { once: false });
    document.getElementById('menuLogout').onclick = (e) => { e.stopPropagation(); doLogout(); };
    document.getElementById('menuProfile').onclick = (e) => { e.stopPropagation(); userMenu.classList.remove('open'); location.hash = '#/profile'; };
    document.getElementById('menuChangePw').onclick = (e) => {
      e.stopPropagation(); userMenu.classList.remove('open');
      const m = UI.modal({
        title: '🔑 Change Password',
        bodyHtml: `
          <div class="field"><label>Current Password</label><input type="password" id="cp-old" style="width:100%" /></div>
          <div class="field"><label>New Password</label><input type="password" id="cp-new" style="width:100%" /></div>
          <div class="field"><label>Confirm New Password</label><input type="password" id="cp-confirm" style="width:100%" /></div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="cp-save">Change Password</button>`,
      });
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#cp-save').onclick = async () => {
        const oldPw = m.root.querySelector('#cp-old').value;
        const newPw = m.root.querySelector('#cp-new').value;
        const confirm = m.root.querySelector('#cp-confirm').value;
        if (!oldPw || !newPw) return UI.toast('Please fill in all fields.', 'error');
        if (newPw !== confirm) return UI.toast('New passwords do not match.', 'error');
        if (newPw.length < 6) return UI.toast('Password must be at least 6 characters.', 'error');
        try {
          await api.post('/auth/change-password', { currentPassword: oldPw, newPassword: newPw });
          m.close(); UI.toast('✅ Password changed successfully!', 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };

    document.querySelectorAll('.nav-item[data-hash]').forEach((n) => n.onclick = () => { location.hash = n.dataset.hash; });
    window.onhashchange = () => this.route();
    if (!location.hash) location.hash = '#/';
    this.route();
    this.initNotifications();
  },

  // ---- Notifications (bell) ----
  initNotifications() {
    const bell = document.getElementById('notifBell');
    const panel = document.getElementById('notifPanel');
    if (!bell) return;
    bell.onclick = (e) => {
      e.stopPropagation();
      if (panel.style.display === 'none') { this.renderNotifPanel(); panel.style.display = 'block'; }
      else panel.style.display = 'none';
    };
    document.addEventListener('click', (e) => { if (panel && !panel.contains(e.target) && e.target !== bell) panel.style.display = 'none'; });
    this.refreshNotifBadge();
    clearInterval(this._notifTimer);
    this._notifTimer = setInterval(() => this.refreshNotifBadge(), 45000);
  },
  async refreshNotifBadge() {
    try {
      const { unread } = await api.get('/notifications');
      const b = document.getElementById('notifBadge');
      if (!b) return;
      if (unread > 0) { b.textContent = unread > 9 ? '9+' : unread; b.style.display = 'inline-block'; }
      else b.style.display = 'none';
    } catch (e) {}
  },
  async renderNotifPanel() {
    const panel = document.getElementById('notifPanel');
    panel.innerHTML = '<div class="notif-head">Notifications <button class="btn sm secondary" id="notifReadAll">Mark all read</button></div><div class="muted" style="padding:14px">Loading…</div>';
    const { notifications } = await api.get('/notifications');
    const list = notifications.length
      ? notifications.map((n) => `<div class="notif-item ${n.read ? '' : 'unread'}" data-link="${UI.esc(n.link || '')}" data-id="${n.id}">
          <div class="nt">${UI.esc(n.title)}</div>${n.body ? `<div class="nb">${UI.esc(n.body)}</div>` : ''}<div class="nd">${UI.date(n.created_at)}</div></div>`).join('')
      : '<div class="empty" style="padding:24px">No notifications yet.</div>';
    panel.innerHTML = '<div class="notif-head">Notifications <button class="btn sm secondary" id="notifReadAll">Mark all read</button></div>' + list;
    panel.querySelector('#notifReadAll').onclick = async (e) => { e.stopPropagation(); await api.post('/notifications/read-all'); this.refreshNotifBadge(); this.renderNotifPanel(); };
    panel.querySelectorAll('.notif-item').forEach((el) => el.onclick = async () => {
      await api.post('/notifications/' + el.dataset.id + '/read');
      panel.style.display = 'none';
      this.refreshNotifBadge();
      if (el.dataset.link) location.hash = el.dataset.link;
    });
  },

  route() {
    const items = this.items || (this.items = this.navFor());
    const hash = location.hash || '#/';
    const item = items.find((i) => i.hash === hash) || items[0];
    document.querySelectorAll('.nav-item[data-hash]').forEach((n) => n.classList.toggle('active', n.dataset.hash === item.hash));
    const title = document.getElementById('page-title');
    if (title) title.textContent = item.label;
    try { item.view(); } catch (e) { this.content().innerHTML = `<div class="empty">${UI.esc(e.message)}</div>`; }
  },

  changePasswordModal(forced) {
    const m = UI.modal({
      title: forced ? 'Set a New Password' : 'Change Password',
      bodyHtml: `
        ${forced ? '<p class="muted">Please set a new password to continue.</p>' : ''}
        <div class="field"><label>Current Password</label><input id="cur" type="password" /></div>
        <div class="field"><label>New Password</label><input id="new" type="password" /></div>`,
      footHtml: `${forced ? '' : '<button class="btn secondary" data-close-btn>Cancel</button>'}<button class="btn" id="save">Save</button>`,
    });
    const cancel = m.root.querySelector('[data-close-btn]');
    if (cancel) cancel.onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      try {
        await api.post('/auth/change-password', {
          currentPassword: m.root.querySelector('#cur').value,
          newPassword: m.root.querySelector('#new').value,
        });
        m.close(); UI.toast('Password updated.', 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
