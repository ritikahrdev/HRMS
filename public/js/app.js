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
      if (this.modOn('timesheets')) push('Me', '#/my-timesheet', 'My Timesheet', () => EmployeeViews.timesheet(c()));
      push('Me', '#/my-payslips', 'My Payslips', () => EmployeeViews.payslips(c()));
      push('Me', '#/my-onboarding', 'My Onboarding', () => EmployeeViews.onboardingForm(c()));
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
    if (this.has('employees:write')) push('Admin', '#/onboarding', 'Onboarding', () => AdminViews.onboarding(c()));
    if (this.has('offboarding:manage') && this.modOn('offboarding')) push('Admin', '#/offboarding', 'Offboarding', () => AdminViews.offboarding(c()));
    if (this.has('timesheets:approve') && this.modOn('timesheets')) push('Admin', '#/timesheet-approvals', 'Timesheets', () => AdminViews.timesheets(c()));
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
    '#/my-payslips': '💸', '#/my-onboarding': '📋', '#/profile': '👤', '#/my-timesheet': '⏱️',
    '#/offboarding': '🚪', '#/timesheet-approvals': '⏱️',
    '#/directory': '📒', '#/notices': '📢', '#/holidays': '📅', '#/recognition': '🏆',
    '#/performance': '🎯', '#/surveys': '📝', '#/helpdesk': '🎧',
    '#/employees': '👥', '#/team': '🧑‍🤝‍🧑', '#/import': '📥', '#/onboarding': '🚀', '#/attendance': '🕒',
    '#/corrections': '✏️', '#/leave-approvals': '✅', '#/leave-calendar': '📆',
    '#/reimb-approvals': '💳', '#/payroll': '💰', '#/loans': '🏦', '#/assets': '💻',
    '#/inventory': '📦', '#/happiness': '💛', '#/reports': '📊', '#/settings': '⚙️',
    '#/my-mood': '😊',
  },

  // Product branding (the software's own name; the company is separate).
  PRODUCT: { name: 'Hrika', tagline: 'your people, handled' },

  // The Hrika AI bot icon (inline SVG so it's crisp at any size, white on the orb).
  AI_ICON(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:block">
      <rect x="4.5" y="8" width="15" height="11" rx="3.5"/>
      <path d="M12 8V5.2"/>
      <circle cx="12" cy="3.7" r="1.5" fill="#fff" stroke="none"/>
      <circle cx="9" cy="12.6" r="1.25" fill="#fff" stroke="none"/>
      <circle cx="15" cy="12.6" r="1.25" fill="#fff" stroke="none"/>
      <path d="M9.3 16.1c.8.8 1.7 1.1 2.7 1.1s1.9-.3 2.7-1.1"/>
      <path d="M2.5 12.5v3M21.5 12.5v3"/>
    </svg>`;
  },

  initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '')[0] || '') + (parts.length > 1 ? (parts[parts.length - 1][0] || '') : '');
  },

  modOn(key) { return !this.modules || this.modules[key] !== false; },

  async init() {
    // Delegated navigation clicks. Inline onclick attributes are blocked by the
    // CSP (helmet script-src-attr 'none'), so clickable cards/buttons carry a
    // data-nav attribute and this single listener routes them.
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-nav]');
      if (t && t.dataset.nav) location.hash = t.dataset.nav;
    });
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
      </div>
      <style>
        @keyframes aiOrbPulse{0%,100%{box-shadow:0 6px 22px rgba(124,58,237,.45),0 0 0 0 rgba(124,58,237,.35)}50%{box-shadow:0 8px 30px rgba(124,58,237,.55),0 0 0 13px rgba(124,58,237,0)}}
        @keyframes aiPop{0%{opacity:0;transform:translateY(18px) scale(.95)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes aiBlink{0%,80%,100%{transform:scale(.5);opacity:.35}40%{transform:scale(1);opacity:1}}
        @keyframes aiAurora{0%{background-position:0% 50%}100%{background-position:200% 50%}}
        #aiFab{transition:transform .15s ease}#aiFab:hover{transform:scale(1.08) rotate(8deg)}
        .ai-dot{width:7px;height:7px;border-radius:50%;background:#8b5cf6;display:inline-block;animation:aiBlink 1.2s infinite}
        .ai-dot:nth-child(2){animation-delay:.2s}.ai-dot:nth-child(3){animation-delay:.4s}
        .ai-send:hover{filter:brightness(1.12)}.ai-chip:hover{background:#f1edff;border-color:#c4b5fd}
        #aiInput:focus{border-color:#a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,.18)}
      </style>
      <div id="aiFab" title="Ask Hrika AI" style="position:fixed;right:22px;bottom:22px;z-index:60;width:60px;height:60px;border-radius:50%;background:radial-gradient(circle at 30% 28%,#a78bfa,#7c3aed 58%,#6366f1);color:#fff;font-size:27px;display:flex;align-items:center;justify-content:center;cursor:pointer;animation:aiOrbPulse 2.6s infinite">${this.AI_ICON(32)}</div>
      <div id="aiPanel" style="position:fixed;right:22px;bottom:96px;z-index:60;width:392px;max-width:93vw;height:560px;max-height:74vh;background:#fff;border-radius:22px;box-shadow:0 24px 60px rgba(60,40,140,.28);display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(124,58,237,.14)">
        <div style="padding:15px 18px;color:#fff;background:linear-gradient(110deg,#6d28d9,#7c3aed,#c026d3,#7c3aed);background-size:220% 100%;animation:aiAurora 9s linear infinite;display:flex;align-items:center;gap:12px">
          <div style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center">${this.AI_ICON(22)}</div>
          <div style="flex:1"><div style="font-weight:800;font-size:16px;line-height:1.1">Hrika AI</div><div style="font-size:11px;opacity:.88">your HR copilot · ask, or tell me to do it</div></div>
          <span id="aiClose" style="cursor:pointer;font-size:20px;opacity:.9">✕</span>
        </div>
        <div id="aiMsgs" style="flex:1;overflow-y:auto;padding:16px;background:linear-gradient(#faf9ff,#f4f3fb);font-size:14px;line-height:1.55"></div>
        <div style="padding:12px;border-top:1px solid #eee9f7;display:flex;gap:9px;align-items:center;background:#fff">
          <input id="aiInput" placeholder="Ask anything, or say what to do…" autocomplete="off" style="flex:1;border:1px solid #e3def3;border-radius:22px;padding:10px 16px;outline:none;font-size:14px;transition:.15s" />
          <button id="aiSend" class="ai-send" style="width:42px;height:42px;border:none;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#c026d3);color:#fff;font-size:17px;cursor:pointer;flex:none">➤</button>
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
    this.initAiAssistant();
  },

  // ---- Hrika AI Assistant (floating copilot) ----
  initAiAssistant() {
    const fab = document.getElementById('aiFab');
    const panel = document.getElementById('aiPanel');
    const msgs = document.getElementById('aiMsgs');
    const input = document.getElementById('aiInput');
    const send = document.getElementById('aiSend');
    if (!fab) return;
    this._aiHistory = [];
    const AV = '<div style="width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#a78bfa,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;flex:none">' + App.AI_ICON(16) + '</div>';
    const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
    // me -> right gradient bubble; ai -> orb + bubble (caller passes ready HTML).
    const bubble = (who, html) => {
      msgs.insertAdjacentHTML('beforeend', who === 'me'
        ? `<div style="display:flex;justify-content:flex-end;margin:9px 0"><div style="max-width:80%;padding:9px 13px;border-radius:15px 15px 4px 15px;background:linear-gradient(135deg,#7c3aed,#8b5cf6);color:#fff">${html}</div></div>`
        : `<div style="display:flex;gap:8px;margin:9px 0;align-items:flex-end">${AV}<div style="max-width:80%;padding:9px 13px;border-radius:15px 15px 15px 4px;background:#fff;border:1px solid #ece7f8;color:#1f2937">${html}</div></div>`);
      scroll();
    };
    const fmt = (t) => UI.esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•]\s?/gm, '• ').replace(/\n/g, '<br/>');
    const showTyping = () => {
      const id = 'typ' + Date.now();
      msgs.insertAdjacentHTML('beforeend', `<div id="${id}" style="display:flex;gap:8px;margin:9px 0;align-items:flex-end">${AV}<div style="padding:12px 15px;border-radius:15px 15px 15px 4px;background:#fff;border:1px solid #ece7f8"><span class="ai-dot"></span> <span class="ai-dot"></span> <span class="ai-dot"></span></div></div>`);
      scroll();
      return document.getElementById(id);
    };
    const navButton = (nav) => {
      const id = 'go' + Date.now();
      msgs.insertAdjacentHTML('beforeend', `<div style="margin:2px 0 10px 34px"><button id="${id}" style="border:none;border-radius:20px;padding:8px 17px;background:linear-gradient(135deg,#7c3aed,#c026d3);color:#fff;font-weight:600;font-size:13px;cursor:pointer">→ ${UI.esc(nav.label || 'Open page')}</button></div>`);
      scroll();
      const b = document.getElementById(id);
      if (b) b.onclick = () => { location.hash = nav.route; panel.style.display = 'none'; fab.innerHTML = App.AI_ICON(32); };
    };
    const actionCard = (pa) => {
      const id = 'act' + Date.now();
      msgs.insertAdjacentHTML('beforeend', `<div id="${id}" style="margin:2px 0 10px 34px;border:1.5px solid #e3def3;border-radius:14px;padding:12px 13px;background:#fff;max-width:88%;box-shadow:0 3px 10px rgba(124,58,237,.07)">
        <div style="font-size:11px;color:#7c3aed;font-weight:800;letter-spacing:.3px;margin-bottom:5px">⚡ ACTION READY</div>
        <div style="font-size:13px;color:#374151;margin-bottom:11px">${UI.esc(pa.summary || pa.label)}</div>
        <div class="act-row" style="display:flex;gap:8px"><button data-yes style="border:none;border-radius:18px;padding:7px 16px;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;font-weight:600;font-size:13px;cursor:pointer">✓ ${UI.esc(pa.label || 'Confirm')}</button><button data-no style="border:1px solid #e5e7eb;border-radius:18px;padding:7px 15px;background:#fff;color:#6b7280;font-size:13px;cursor:pointer">Cancel</button></div></div>`);
      scroll();
      const card = document.getElementById(id);
      const row = card.querySelector('.act-row');
      card.querySelector('[data-no]').onclick = () => { row.innerHTML = '<span style="color:#9ca3af;font-size:12px">Cancelled.</span>'; };
      card.querySelector('[data-yes]').onclick = async () => {
        row.innerHTML = '<span class="muted" style="font-size:12px">⏳ Working…</span>';
        try { const r = await api.post('/ai/act', { name: pa.name, params: pa.params }); row.innerHTML = `<span style="color:#16a34a;font-size:13px;font-weight:600">${UI.esc(r.message || 'Done ✅')}</span>`; }
        catch (e) { row.innerHTML = `<span style="color:#dc2626;font-size:12px">${UI.esc(e.message)}</span>`; }
      };
    };

    const greet = async () => {
      msgs.innerHTML = '';
      let st; try { st = await api.get('/ai/status'); } catch (e) { st = { configured: false }; }
      if (!st.configured) {
        bubble('ai', App.has('settings:manage')
          ? "Hi! I'm <b>Hrika AI</b> ✦. To switch me on, add an API key in <b>Settings → AI Assistant</b>."
          : "Hi! The AI assistant isn't set up yet — please ask your HR admin to enable it.");
        return;
      }
      bubble('ai', "Hi! I'm <b>Hrika AI</b> ✦ — ask me anything, or just <b>tell me what to do</b> (apply leave, submit a claim, find a page…). 💜");
      const chips = App.has('reports:view')
        ? ['Who is on leave today?', 'Pending approvals', 'Draft an announcement', 'How many employees?']
        : ['Apply for casual leave tomorrow', 'Download my payslip', 'How much leave do I have?', 'Submit a reimbursement'];
      msgs.insertAdjacentHTML('beforeend', `<div style="margin:6px 0 0 34px;display:flex;flex-wrap:wrap;gap:6px">${chips.map((c) => `<button class="ai-chip" style="padding:6px 11px;border:1px solid #e3def3;border-radius:15px;background:#fff;cursor:pointer;font-size:12px;color:#5b21b6">${UI.esc(c)}</button>`).join('')}</div>`);
      msgs.querySelectorAll('.ai-chip').forEach((b) => b.onclick = () => { input.value = b.textContent; ask(); });
    };

    const ask = async () => {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      bubble('me', UI.esc(q));
      this._aiHistory.push({ role: 'user', content: q });
      const typing = showTyping();
      try {
        const r = await api.post('/ai/chat', { messages: this._aiHistory.slice(0, -1), question: q });
        typing.remove();
        if (r.answer) bubble('ai', fmt(r.answer));
        if (r.proposedAction) actionCard(r.proposedAction);
        else if (r.navigate && r.navigate.route) navButton(r.navigate);
        this._aiHistory.push({ role: 'assistant', content: r.answer || '' });
      } catch (e) {
        typing.remove();
        bubble('ai', '<span style="color:#dc2626">' + UI.esc(e.message) + '</span>');
      }
    };

    let opened = false;
    const fabIcon = (open) => { fab.innerHTML = open ? '<span style="font-size:26px;line-height:1">✕</span>' : App.AI_ICON(32); };
    fab.onclick = () => {
      const show = panel.style.display === 'none';
      panel.style.display = show ? 'flex' : 'none';
      if (show) { panel.style.animation = 'aiPop .22s ease'; fabIcon(true); if (!opened) { opened = true; greet(); } setTimeout(() => input.focus(), 60); }
      else fabIcon(false);
    };
    document.getElementById('aiClose').onclick = () => { panel.style.display = 'none'; fabIcon(false); };
    send.onclick = ask;
    input.onkeydown = (e) => { if (e.key === 'Enter') ask(); };
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
