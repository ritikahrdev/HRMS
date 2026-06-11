const AdminViews = {
  async dashboard(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const o = await api.get('/reports/overview');
    const dateRange = (r) => UI.date(r.from_date) + (r.to_date && r.to_date !== r.from_date ? ' → ' + UI.date(r.to_date) : '') + (r.half_day ? ' (half)' : '');
    const reasonTxt = (t) => t ? UI.esc(t) : '<span style="color:#c7ccd8">no reason given</span>';

    const onLeaveRows = (o.onLeaveToday || []).map((r) => `
      <div style="padding:8px 0;border-bottom:1px dashed #eef1f6">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b>${UI.esc(r.name)}</b>
          <span class="tag" style="font-size:10px">${UI.esc(r.type)}</span>
          <span class="muted" style="font-size:12px">📅 ${dateRange(r)} · ${r.days} day${r.days > 1 ? 's' : ''}</span>
        </div>
        <div class="muted" style="font-size:12px;margin-top:2px">💬 ${reasonTxt(r.reason)}</div>
      </div>`).join('');

    const pendingRows = (o.pendingLeaveDetails || []).map((r) => `
      <div style="padding:8px 0;border-bottom:1px dashed #eef1f6">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b>${UI.esc(r.name)}</b>
          <span class="tag" style="font-size:10px">${UI.esc(r.type)}</span>
          <span class="muted" style="font-size:12px">📅 ${dateRange(r)} · ${r.days} day${r.days > 1 ? 's' : ''}</span>
        </div>
        <div class="muted" style="font-size:12px;margin-top:2px">💬 ${reasonTxt(r.reason)} <span style="color:#c7ccd8">· applied ${UI.date(r.applied_at)}</span></div>
      </div>`).join('');

    const corrRows = (o.pendingCorrections || []).map((r) => `
      <div style="padding:8px 0;border-bottom:1px dashed #eef1f6">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b>${UI.esc(r.name)}</b>
          <span class="tag pending" style="font-size:10px">${UI.esc(r.requested_status || '')}</span>
          <span class="muted" style="font-size:12px">📅 ${UI.date(r.date)}</span>
        </div>
        <div class="muted" style="font-size:12px;margin-top:2px">💬 ${reasonTxt(r.reason)}</div>
      </div>`).join('');

    c.innerHTML = `
      <div class="cards">
        <div class="card stat" style="cursor:pointer" onclick="location.hash='#/employees'"><div class="stat-ico">👥</div><div class="label">Active Employees</div><div class="value">${o.totalEmployees}</div></div>
        <div class="card stat" style="cursor:pointer" onclick="location.hash='#/attendance'"><div class="stat-ico">✅</div><div class="label">Present Today</div><div class="value green">${o.presentToday}</div></div>
        <div class="card stat" style="cursor:pointer" onclick="location.hash='#/attendance'"><div class="stat-ico">🚫</div><div class="label">Absent Today</div><div class="value red">${o.absentToday}</div></div>
        <div class="card stat" style="cursor:pointer" onclick="location.hash='#/leave-approvals'"><div class="stat-ico">⏳</div><div class="label">Pending Leave Approvals</div><div class="value amber">${o.pendingLeaves || 0}</div></div>
      </div>
      <div class="section-title mt">Quick Actions</div>
      <div class="btn-row">
        <button class="btn" onclick="location.hash='#/employees'">Add Employee</button>
        <button class="btn secondary" onclick="location.hash='#/import'">Import from Excel</button>
        <button class="btn secondary" onclick="location.hash='#/payroll'">Run Payroll</button>
        <button class="btn secondary" onclick="location.hash='#/attendance'">View Attendance</button>
      </div>
      <div class="cards mt" style="align-items:flex-start">
        <div class="card" style="flex:1;min-width:300px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="font-weight:650">🌴 On Leave Today <span class="muted" style="font-size:12px">(${(o.onLeaveToday || []).length})</span></div>
            <button class="btn sm secondary" onclick="location.hash='#/leave-calendar'">Calendar</button>
          </div>
          ${onLeaveRows || '<div class="muted" style="font-size:13px;padding:10px 0">Nobody is on leave today. 🎉</div>'}
        </div>
        <div class="card" style="flex:1;min-width:300px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="font-weight:650">⏳ Pending Leave Requests <span class="muted" style="font-size:12px">(${o.pendingLeaves || 0})</span></div>
            <button class="btn sm" onclick="location.hash='#/leave-approvals'">Review</button>
          </div>
          ${pendingRows || '<div class="muted" style="font-size:13px;padding:10px 0">Nothing waiting — all caught up. ✅</div>'}
        </div>
        ${corrRows ? `<div class="card" style="flex:1;min-width:300px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="font-weight:650">✏️ Attendance Requests</div>
            <button class="btn sm" onclick="location.hash='#/corrections'">Review</button>
          </div>
          ${corrRows}
        </div>` : ''}
      </div>
      <div id="celebrations"></div>`;
    AdminViews.celebrationsCard(document.getElementById('celebrations'));
  },

  // Upcoming birthdays & work anniversaries (Keka-style celebrations widget).
  async celebrationsCard(host) {
    if (!host) return;
    try {
      const { birthdays, anniversaries } = await api.get('/employees/celebrations');
      if (!birthdays.length && !anniversaries.length) return;
      const row = (icon, r, extra) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px dashed #eef1f6">
        <span style="font-size:18px">${icon}</span>
        <span style="flex:1"><b>${UI.esc(r.name)}</b>${r.department ? ` <span class="muted" style="font-size:12px">· ${UI.esc(r.department)}</span>` : ''}</span>
        <span class="muted" style="font-size:12px">${r.isToday ? '<b style="color:#16a34a">Today!</b>' : UI.date(r.date)}${extra || ''}</span>
      </div>`;
      host.innerHTML = `
        <div class="section-title mt">🎉 Celebrations — next 30 days</div>
        <div class="cards">
          <div class="card" style="min-width:280px;flex:1">
            <div style="font-weight:650;margin-bottom:6px">🎂 Birthdays</div>
            ${birthdays.length ? birthdays.map((b) => row('🎂', b)).join('') : '<div class="muted" style="font-size:13px">None coming up.</div>'}
          </div>
          <div class="card" style="min-width:280px;flex:1">
            <div style="font-weight:650;margin-bottom:6px">🏅 Work Anniversaries</div>
            ${anniversaries.length ? anniversaries.map((a) => row('🏅', a, ` · ${a.years} yr${a.years > 1 ? 's' : ''}`)).join('') : '<div class="muted" style="font-size:13px">None coming up.</div>'}
          </div>
        </div>`;
    } catch (e) { /* celebrations are decorative — never break the dashboard */ }
  },

  // ---------------- Manager dashboard ----------------
  async teamDashboard(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [{ employees }, corrections] = await Promise.all([
      api.get('/employees/team'),
      api.get('/attendance/corrections').catch(() => ({ corrections: [] })),
    ]);
    const pendingCorr = (corrections.corrections || []).filter((x) => x.status === 'pending').length;
    c.innerHTML = `
      <div class="cards">
        <div class="card stat"><div class="label">My Team</div><div class="value">${employees.length}</div></div>
        <div class="card stat"><div class="label">Pending Attendance Requests</div><div class="value amber">${pendingCorr}</div></div>
      </div>
      <div class="section-title mt">Quick Actions</div>
      <div class="btn-row">
        <button class="btn secondary" onclick="location.hash='#/team'">My Team</button>
        <button class="btn secondary" onclick="location.hash='#/leave-approvals'">Leave Approvals</button>
        <button class="btn secondary" onclick="location.hash='#/reimb-approvals'">Reimbursement Approvals</button>
        <button class="btn secondary" onclick="location.hash='#/attendance'">Team Attendance</button>
      </div>`;
  },

  // ---------------- My Team ----------------
  async team(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { employees } = await api.get('/employees/team');
    c.innerHTML = `<div class="section-title">My Team</div>` + UI.table([
      { key: 'emp_code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'department', label: 'Dept', render: (r) => UI.esc(r.department || '-') },
      { key: 'designation', label: 'Designation', render: (r) => UI.esc(r.designation || '-') },
      { key: 'email', label: 'Email', render: (r) => UI.esc(r.email || '-') },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
    ], employees, 'No team members report to you yet.');
  },

  // ---------------- Attendance corrections (approve) ----------------
  async corrections(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { corrections } = await api.get('/attendance/corrections');
    const pending = corrections.filter(r => r.status === 'pending');
    const approved = corrections.filter(r => r.status === 'approved');
    const rejected = corrections.filter(r => r.status === 'rejected');

    const renderList = (filter) => {
      const list = filter === 'all' ? corrections : corrections.filter(r => r.status === filter);
      return EmployeeViews.correctionsList(list, filter, true);
    };

    c.innerHTML = `
      <div class="section-title">✏️ Attendance Requests</div>

      <!-- Stats row -->
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:14px 0 20px">
        <div style="flex:1;min-width:120px;background:#fef9c3;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#92400e">${pending.length}</div>
          <div style="font-size:12px;color:#92400e;font-weight:600">⏳ Pending</div>
        </div>
        <div style="flex:1;min-width:120px;background:#dcfce7;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#166534">${approved.length}</div>
          <div style="font-size:12px;color:#166534;font-weight:600">✅ Approved</div>
        </div>
        <div style="flex:1;min-width:120px;background:#fee2e2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#991b1b">${rejected.length}</div>
          <div style="font-size:12px;color:#991b1b;font-weight:600">❌ Rejected</div>
        </div>
        <div style="flex:1;min-width:120px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#374151">${corrections.length}</div>
          <div style="font-size:12px;color:#6b7280;font-weight:600">📋 Total</div>
        </div>
      </div>

      ${pending.length > 0 ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#92400e">
          ⚡ <strong>${pending.length} request${pending.length > 1 ? 's' : ''} waiting for your review.</strong>
          These employees are waiting — please review as soon as possible.
        </div>` : ''}

      <!-- Filter tabs -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
        ${[['all','📋 All',corrections.length],['pending','⏳ Pending',pending.length],['approved','✅ Approved',approved.length],['rejected','❌ Rejected',rejected.length]].map(([f,label,count],i) => `
          <button class="corr-tab" data-filter="${f}"
            style="padding:7px 16px;border:1px solid ${i===0?'#4f46e5':'#e5e7eb'};background:${i===0?'#4f46e5':'#fff'};color:${i===0?'#fff':'#374151'};border-radius:20px;cursor:pointer;font-size:13px;font-weight:600">
            ${label} <span style="opacity:.7">${count}</span>
          </button>`).join('')}
      </div>

      <div id="corr-list">${renderList('all')}</div>`;

    // Filter tab switching
    document.querySelectorAll('.corr-tab').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.corr-tab').forEach(b => { b.style.background='#fff'; b.style.color='#374151'; b.style.borderColor='#e5e7eb'; });
        btn.style.background='#4f46e5'; btn.style.color='#fff'; btn.style.borderColor='#4f46e5';
        document.getElementById('corr-list').innerHTML = renderList(btn.dataset.filter);
        this.bindCorrectionButtons(c, corrections);
      };
    });

    this.bindCorrectionButtons(c, corrections);
  },

  bindCorrectionButtons(c, corrections) {
    // Approve buttons
    document.querySelectorAll('.appr-req').forEach(btn => {
      btn.onclick = async () => {
        try {
          await api.post(`/attendance/corrections/${btn.dataset.id}/decision`, { decision: 'approved', comment: '' });
          UI.toast('✅ Request approved. Attendance updated and employee notified.', 'success');
          this.corrections(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    });

    // Reject buttons — show a proper modal with comment
    document.querySelectorAll('.rej-req').forEach(btn => {
      btn.onclick = () => {
        const req = corrections.find(r => r.id == btn.dataset.id);
        const m = UI.modal({
          title: '❌ Reject Attendance Request',
          bodyHtml: `
            <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:14px;font-size:13px">
              <strong>${UI.esc(req ? req.employee_name : '')}</strong> · ${req ? UI.date(req.date) : ''}
              ${req && req.reason ? `<br><span style="color:#6b7280">Reason: ${UI.esc(req.reason)}</span>` : ''}
            </div>
            <div class="field">
              <label><strong>Reason for rejection</strong> <span style="color:#9ca3af;font-weight:400">(optional — will be sent to employee)</span></label>
              <textarea id="rej-comment" rows="3" placeholder="e.g. Insufficient reason provided, please resubmit with supporting documentation…" style="width:100%"></textarea>
            </div>`,
          footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" style="background:#ef4444" id="confirm-rej">Reject Request</button>`,
        });
        m.root.querySelector('[data-close-btn]').onclick = m.close;
        m.root.querySelector('#confirm-rej').onclick = async () => {
          const comment = m.root.querySelector('#rej-comment').value.trim();
          try {
            await api.post(`/attendance/corrections/${btn.dataset.id}/decision`, { decision: 'rejected', comment });
            m.close();
            UI.toast('Request rejected. Employee has been notified.', 'success');
            this.corrections(c);
          } catch (e) { UI.toast(e.message, 'error'); }
        };
      };
    });
  },

  // ---------------- Employees ----------------
  async employees(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    let showArchived = false;
    const isSuper = App.user.role === 'SUPER_ADMIN';
    let employees = (await api.get('/employees')).employees;

    c.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
        <div class="section-title" style="margin:0">👥 Employees</div>
        <button class="btn sm secondary" id="toggle-stats">📊 Show Stats</button>
      </div>
      <div id="emp-stats" style="display:none"></div>
      <div class="toolbar">
        <input id="search" placeholder="Search name / code / dept..." />
        <div class="spacer"></div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;cursor:pointer">
          <input type="checkbox" id="show-archived" /> Show archived
        </label>
        <button class="btn" id="add">Add Employee</button>
      </div>
      <div id="archived-note"></div>
      <div id="list"></div>`;

    // Workforce stats panel (lazy-loaded on first open)
    let statsLoaded = false;
    document.getElementById('toggle-stats').onclick = async (e) => {
      const panel = document.getElementById('emp-stats');
      const open = panel.style.display === 'none';
      panel.style.display = open ? 'block' : 'none';
      e.target.textContent = open ? '📊 Hide Stats' : '📊 Show Stats';
      if (open && !statsLoaded) {
        panel.innerHTML = '<div class="muted" style="margin:10px 0">Loading stats…</div>';
        const s = await api.get('/employees/stats').catch(() => null);
        panel.innerHTML = s ? this.employeeStatsHtml(s) : '<div class="muted">Could not load stats.</div>';
        statsLoaded = true;
      }
    };

    const render = (rows) => {
      document.getElementById('list').innerHTML = UI.table([
        { key: 'name', label: 'Name', sticky: true },
        { key: 'emp_code', label: 'Code' },
        { key: 'department', label: 'Dept', render: (r) => UI.esc(r.department || '-') },
        { key: 'designation', label: 'Designation', render: (r) => UI.esc(r.designation || '-') },
        { key: 'role', label: 'Role', render: (r) => UI.esc((r.role || 'EMPLOYEE').replace('_', ' ')) },
        { key: 'manager_name', label: 'Manager', render: (r) => UI.esc(r.manager_name || '-') },
        { key: 'monthly_salary', label: 'Salary', render: (r) => UI.money(r.monthly_salary) },
        { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
        { key: 'act', label: '', render: (r) => {
          if (r.status === 'archived') {
            // Archived employees: restore (remove from archive) or permanently delete
            return `<button class="btn sm secondary" data-docs="${r.id}">Docs</button>`
              + (isSuper ? ` <button class="btn sm green" data-restore="${r.id}">♻ Restore to Active</button> <button class="btn sm red" data-perm="${r.id}">Delete Forever</button>` : '');
          }
          return `<button class="btn sm secondary" data-edit="${r.id}">Edit</button>`
            + (App.has('payroll:manage') ? ` <button class="btn sm secondary" data-salary="${r.id}">Salary</button>` : '')
            + ` <button class="btn sm secondary" data-docs="${r.id}">Docs</button>`
            + ` <button class="btn sm secondary" data-onboard="${r.id}">Onboarding</button>`
            + ` <button class="btn sm secondary" data-reset="${r.id}">Reset PW</button>`
            + (isSuper ? ` <button class="btn sm red" data-del="${r.id}">Archive</button>` : '');
        } },
      ], rows, 'No employees yet. Add one or import from Excel.');

      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => this.employeeForm(c, employees.find((e) => e.id == b.dataset.edit)));
      document.querySelectorAll('[data-salary]').forEach((b) => b.onclick = () => { const e = employees.find((x) => x.id == b.dataset.salary); this.salaryModal(e.id, e.name); });
      document.querySelectorAll('[data-docs]').forEach((b) => b.onclick = () => { const e = employees.find((x) => x.id == b.dataset.docs); this.documentsModal(e.id, e.name); });
      document.querySelectorAll('[data-onboard]').forEach((b) => b.onclick = () => { const e = employees.find((x) => x.id == b.dataset.onboard); this.onboardingModal(e.id, e.name); });
      document.querySelectorAll('[data-reset]').forEach((b) => b.onclick = async () => {
        try { const r = await api.post(`/employees/${b.dataset.reset}/reset-password`); UI.toast('New temp password: ' + r.tempPassword, 'success'); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
      // Archive (soft delete — keeps all data)
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        const emp = employees.find((e) => e.id == b.dataset.del);
        if (!confirm(`Archive ${emp ? emp.name : 'this employee'}?\n\nTheir login will be disabled and they'll be removed from active lists, but ALL their data (attendance, leave, payroll, documents) is preserved. You can restore them anytime.`)) return;
        try { await api.request('DELETE', '/employees/' + b.dataset.del); UI.toast('Employee archived. Their data is preserved.', 'success'); reload(); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
      // Restore archived employee
      document.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
        const emp = employees.find((e) => e.id == b.dataset.restore);
        if (!confirm(`Restore ${emp ? emp.name : 'this employee'} back to active? Their login will be re-enabled.`)) return;
        try { await api.post('/employees/' + b.dataset.restore + '/restore'); UI.toast('Employee restored.', 'success'); reload(); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
      // Permanent delete (only for archived)
      document.querySelectorAll('[data-perm]').forEach((b) => b.onclick = async () => {
        const emp = employees.find((e) => e.id == b.dataset.perm);
        const name = emp ? emp.name : 'this employee';
        if (!confirm(`⚠️ PERMANENTLY DELETE ${name} and ALL their records (attendance, leave, payroll, documents)?\n\nThis CANNOT be undone.`)) return;
        if (!confirm(`Are you absolutely sure? Type-check: this erases ${name}'s data forever.`)) return;
        try { await api.request('DELETE', '/employees/' + b.dataset.perm + '/permanent'); UI.toast('Employee permanently deleted.', 'success'); reload(); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
    };

    const applySearch = () => {
      const q = (document.getElementById('search').value || '').toLowerCase();
      // When viewing the archive, show ONLY archived employees; otherwise show active/inactive only.
      const base = showArchived
        ? employees.filter((e) => e.status === 'archived')
        : employees.filter((e) => e.status !== 'archived');
      const list = q ? base.filter((x) => [x.name, x.emp_code, x.department, x.email].join(' ').toLowerCase().includes(q)) : base;
      if (showArchived && base.length === 0) {
        document.getElementById('list').innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af"><div style="font-size:36px;margin-bottom:8px">📦</div><div style="font-weight:600">No archived employees</div><div style="font-size:13px">Archived employees will appear here. Their data stays preserved.</div></div>';
        return;
      }
      render(list);
    };

    const reload = async () => {
      employees = (await api.get('/employees' + (showArchived ? '?includeArchived=1' : ''))).employees;
      const archivedCount = employees.filter((e) => e.status === 'archived').length;
      document.getElementById('archived-note').innerHTML = showArchived
        ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#9a3412">📦 <strong>Archive view</strong> — showing ${archivedCount} archived employee${archivedCount !== 1 ? 's' : ''} only. Their data is preserved. Click <strong>Restore</strong> to move someone back to active staff.</div>`
        : '';
      applySearch();
    };

    await reload();
    document.getElementById('add').onclick = () => this.employeeForm(c, null);
    document.getElementById('search').oninput = applySearch;
    document.getElementById('show-archived').onchange = (e) => { showArchived = e.target.checked; reload(); };
  },

  // Renders the workforce statistics panel.
  employeeStatsHtml(s) {
    const COLORS = ['#4f46e5', '#16a34a', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#ec4899', '#14b8a6', '#84cc16', '#f97316'];
    const card = (label, value, color) => `
      <div class="card" style="flex:1;min-width:120px;text-align:center">
        <div style="font-size:26px;font-weight:800;color:${color}">${value}</div>
        <div class="muted" style="font-size:12px">${label}</div>
      </div>`;

    // Horizontal bar breakdown for a grouped list.
    const breakdown = (title, rows) => {
      const total = rows.reduce((a, b) => a + b.count, 0) || 1;
      return `
        <div class="card" style="flex:1;min-width:240px">
          <div style="font-weight:700;margin-bottom:12px">${title}</div>
          ${rows.length ? rows.map((r, i) => {
            const pct = Math.round((r.count / total) * 100);
            const clr = COLORS[i % COLORS.length];
            return `<div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                <span style="font-weight:600">${UI.esc(r.label)}</span>
                <span style="color:#6b7280">${r.count} <span style="color:#9ca3af">(${pct}%)</span></span>
              </div>
              <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${clr};border-radius:4px"></div>
              </div>
            </div>`;
          }).join('') : '<div class="muted" style="font-size:13px">No data.</div>'}
        </div>`;
    };

    return `
      <div style="margin:6px 0 18px">
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
          ${card('Active Headcount', s.totalActive, '#4f46e5')}
          ${card('Managers', s.managers, '#16a34a')}
          ${card('New This Month', s.newThisMonth, '#0ea5e9')}
          ${card('New This Year', s.newThisYear, '#a855f7')}
          ${card('With Login', s.withLogin, '#f59e0b')}
          ${card('Archived', s.totalArchived, '#9ca3af')}
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
          ${breakdown('🏢 By Department', s.byDepartment)}
          ${breakdown('💼 By Employee Type', s.byType)}
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          ${breakdown('⚧ By Gender', s.byGender)}
          ${breakdown('🏠 By Work Mode', s.byWorkMode)}
          ${breakdown('🩸 By Blood Group', s.byBloodGroup)}
        </div>
      </div>`;
  },

  async employeeForm(c, emp) {
    const f = (k) => emp && emp[k] != null ? UI.esc(emp[k]) : '';
    const ROLES = [
      ['EMPLOYEE', 'Employee'], ['MANAGER', 'Manager'], ['HR_ADMIN', 'HR Admin'],
      ['FINANCE_ADMIN', 'Finance Admin'], ['SUPER_ADMIN', 'Super Admin'],
    ];
    const curRole = (emp && emp.role) || 'EMPLOYEE';
    // Fetch potential managers (everyone except this employee).
    let people = [];
    try { people = (await api.get('/employees')).employees; } catch (e) {}
    const mgrOptions = ['<option value="">— None —</option>'].concat(
      people.filter((p) => !emp || p.id !== emp.id)
        .map((p) => `<option value="${p.id}" ${emp && emp.manager_id == p.id ? 'selected' : ''}>${UI.esc(p.name)} (${UI.esc(p.emp_code || '')})</option>`)
    ).join('');

    const m = UI.modal({
      title: emp ? 'Edit Employee' : 'Add Employee',
      bodyHtml: `
        <div class="form-grid">
          <div class="field"><label>Name *</label><input id="name" value="${f('name')}" /></div>
          <div class="field"><label>Employee Code</label><input id="emp_code" value="${f('emp_code')}" placeholder="auto if blank" /></div>
          <div class="field"><label>Email (login)</label><input id="email" value="${f('email')}" /></div>
          <div class="field"><label>Personal Email</label><input id="personal_email" value="${f('personal_email')}" /></div>
          <div class="field"><label>Phone</label><input id="phone" value="${f('phone')}" /></div>
          <div class="field"><label>Role</label><select id="role">${ROLES.map((r) => `<option value="${r[0]}" ${curRole === r[0] ? 'selected' : ''}>${r[1]}</option>`).join('')}</select></div>
          <div class="field"><label>Reporting Manager</label><select id="manager_id">${mgrOptions}</select></div>
          <div class="field"><label>Department</label><input id="department" value="${f('department')}" /></div>
          <div class="field"><label>Designation</label><input id="designation" value="${f('designation')}" /></div>
          <div class="field"><label>Date of Joining</label><input id="date_of_joining" type="date" value="${f('date_of_joining')}" /></div>
          <div class="field"><label>Monthly Salary</label><input id="monthly_salary" type="number" step="0.01" value="${emp ? emp.monthly_salary : ''}" /></div>
          <div class="field"><label>Account Holder Name</label><input id="bank_holder_name" value="${f('bank_holder_name')}" /></div>
          <div class="field"><label>Bank Name</label><input id="bank_name" value="${f('bank_name')}" /></div>
          <div class="field"><label>Bank Account</label><input id="bank_account" value="${f('bank_account')}" /></div>
          <div class="field"><label>IFSC</label><input id="ifsc" value="${f('ifsc')}" /></div>
          <div class="field"><label>PAN</label><input id="pan" value="${f('pan')}" /></div>
          <div class="field"><label>Aadhaar / ID Proof</label><input id="aadhaar" value="${f('aadhaar')}" /></div>
          <div class="field"><label>Date of Birth</label><input type="date" id="dob" value="${f('dob')}" /></div>
          <div class="field"><label>Gender</label><select id="gender"><option value=""></option><option value="Male" ${emp && emp.gender === 'Male' ? 'selected' : ''}>Male</option><option value="Female" ${emp && emp.gender === 'Female' ? 'selected' : ''}>Female</option><option value="Other" ${emp && emp.gender === 'Other' ? 'selected' : ''}>Other</option></select></div>
          <div class="field"><label>Marital Status</label><select id="marital_status"><option value=""></option>${['Single', 'Married', 'Other'].map((o) => `<option ${emp && emp.marital_status === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          <div class="field"><label>Blood Group</label><input id="blood_group" value="${f('blood_group')}" /></div>
          <div class="field"><label>Nationality</label><input id="nationality" value="${f('nationality')}" /></div>
          <div class="field"><label>Languages Known</label><input id="languages_known" value="${f('languages_known')}" /></div>
          <div class="field"><label>Emergency Contact Name</label><input id="emergency_name" value="${f('emergency_name')}" /></div>
          <div class="field"><label>Emergency Contact Phone</label><input id="emergency_phone" value="${f('emergency_phone')}" /></div>
          <div class="field full"><label>Education</label><input id="education" value="${f('education')}" /></div>
          <div class="field full"><label>Previous Experience</label><input id="experience" value="${f('experience')}" /></div>
          <div class="field"><label>Slack Member ID (for attendance sync)</label><input id="slack_id" value="${f('slack_id')}" placeholder="U0XXXXXXX (optional)" /></div>
          <div class="field full"><label>Address</label><textarea id="address" rows="2">${f('address')}</textarea></div>
          <div class="field full"><label>Current Address</label><textarea id="current_address" rows="2">${f('current_address')}</textarea></div>
          <div class="field full"><label>Permanent Address</label><textarea id="permanent_address" rows="2">${f('permanent_address')}</textarea></div>
          ${emp ? `<div class="field"><label>Status</label><select id="status"><option value="active" ${emp.status === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${emp.status === 'inactive' ? 'selected' : ''}>inactive</option></select></div>` : ''}
        </div>
        <p class="muted" style="font-size:12px">Tip: set role to <b>Manager</b> and assign team members' Reporting Manager to this person so they can approve their team.</p>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      const ids = ['name', 'emp_code', 'email', 'phone', 'personal_email', 'role', 'manager_id', 'department', 'designation', 'date_of_joining', 'monthly_salary', 'bank_holder_name', 'bank_name', 'bank_account', 'ifsc', 'pan', 'address', 'current_address', 'permanent_address', 'aadhaar', 'dob', 'gender', 'marital_status', 'blood_group', 'nationality', 'languages_known', 'emergency_name', 'emergency_phone', 'education', 'experience', 'slack_id'];
      const data = {};
      ids.forEach((id) => data[id] = m.root.querySelector('#' + id).value);
      if (emp) data.status = m.root.querySelector('#status').value;
      try {
        if (emp) { await api.put('/employees/' + emp.id, data); UI.toast('Saved.', 'success'); }
        else { const r = await api.post('/employees', data); UI.toast(r.tempPassword ? 'Added. Temp password: ' + r.tempPassword : 'Added.', 'success'); }
        m.close(); this.employees(c);
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  // ---------------- Excel import ----------------
  async import(c) {
    c.innerHTML = `
      <div class="card" style="max-width:720px">
        <div class="section-title">Import Employees from Excel</div>
        <p class="muted">Step 1: Download the template, fill it in, then upload it. We'll check for problems before saving anything.</p>
        <div class="btn-row mt">
          <a class="btn secondary" href="/api/import/template">Download Template (.xlsx)</a>
          <label class="btn">Choose File<input type="file" id="file" accept=".xlsx,.xls,.csv" style="display:none" /></label>
        </div>
        <div id="fname" class="muted mt"></div>
      </div>
      <div id="preview" class="mt"></div>`;
    const fileInput = document.getElementById('file');
    fileInput.onchange = async () => {
      const f = fileInput.files[0];
      if (!f) return;
      document.getElementById('fname').textContent = 'Selected: ' + f.name + ' — checking...';
      const fd = new FormData(); fd.append('file', f);
      try {
        const res = await api.upload('/import/preview', fd);
        this.renderImportPreview(c, res);
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  renderImportPreview(c, res) {
    const cols = ['name', 'email', 'phone', 'emp_code', 'department', 'designation', 'date_of_joining', 'monthly_salary'];
    const headerCells = cols.map((k) => `<th>${k}</th>`).join('') + '<th>Issues</th>';
    const rowsHtml = res.rows.map((r, i) => {
      const cells = cols.map((k) => `<td><input data-row="${i}" data-field="${k}" value="${UI.esc(r.data[k] != null ? r.data[k] : '')}" style="min-width:120px" /></td>`).join('');
      const issues = r.issues.length ? `<span class="issues">${r.issues.map(UI.esc.bind(UI)).join('<br/>')}</span>` : '<span class="tag approved">OK</span>';
      return `<tr data-rownum="${i}">${cells}<td>${issues}</td></tr>`;
    }).join('');

    document.getElementById('preview').innerHTML = `
      <div class="card">
        <div class="section-title">Review &amp; Fix (${res.total} rows — ${res.problemCount} need attention)</div>
        <p class="muted">Edit any cell to fix issues. Rows marked OK or with only an email warning will be imported.</p>
        <div class="table-wrap"><table><thead><tr>${headerCells}</tr></thead><tbody>${rowsHtml}</tbody></table></div>
        <div class="btn-row mt">
          <button class="btn" id="commit">Import These Employees</button>
          <button class="btn secondary" id="revalidate">Re-check</button>
        </div>
      </div>`;

    const collect = () => res.rows.map((r, i) => {
      const data = {};
      cols.forEach((k) => {
        const el = document.querySelector(`input[data-row="${i}"][data-field="${k}"]`);
        if (el) data[k] = el.value;
      });
      return data;
    });

    document.getElementById('commit').onclick = async () => {
      const rows = collect().filter((r) => r.name && r.name.trim());
      if (!rows.length) { UI.toast('No valid rows to import.', 'error'); return; }
      try {
        const r = await api.post('/import/commit', { rows });
        let msg = `Imported ${r.created} employee(s).`;
        if (r.skipped) msg += ` ${r.skipped} skipped.`;
        UI.toast(msg, 'success');
        if (r.errors && r.errors.length) UI.modal({ title: 'Some rows were skipped', bodyHtml: r.errors.map((e) => `<div>${UI.esc(e.name)}: ${UI.esc(e.error)}</div>`).join(''), footHtml: '<button class="btn" data-close>OK</button>' });
        location.hash = '#/employees';
      } catch (e) { UI.toast(e.message, 'error'); }
    };
    document.getElementById('revalidate').onclick = async () => {
      // Re-run validation by sending current values back through preview is not available;
      // simplest: just recolor obvious empties client-side.
      UI.toast('Fix cells, then click Import.', '');
    };
  },

  // ---------------- Attendance ----------------
  async attendance(c) {
    c.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:16px">
        <button class="att-tab" data-tab="daily" style="padding:8px 18px;border:1px solid #4f46e5;background:#4f46e5;color:#fff;border-radius:20px;cursor:pointer;font-size:13px;font-weight:600">📋 Daily View</button>
        <button class="att-tab" data-tab="insights" style="padding:8px 18px;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:20px;cursor:pointer;font-size:13px;font-weight:600">📅 Monthly Insights</button>
      </div>
      <div id="att-tab-body"></div>`;
    const body = c.querySelector('#att-tab-body');
    const tabs = c.querySelectorAll('.att-tab');
    const setTab = (name) => {
      tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.style.background = on ? '#4f46e5' : '#fff';
        t.style.color = on ? '#fff' : '#374151';
        t.style.borderColor = on ? '#4f46e5' : '#e5e7eb';
      });
      if (name === 'daily') this.attendanceDaily(body);
      else this.attendanceInsights(body);
    };
    tabs.forEach((t) => t.onclick = () => setTab(t.dataset.tab));
    setTab('daily');
  },

  async attendanceDaily(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    // If the user clicked a day in the calendar, open that date instead of today.
    const today = this._pendingAttDate || new Date().toISOString().slice(0, 10);
    this._pendingAttDate = null;
    const canSync = App.has('attendance:viewAll');
    const data = await api.get('/attendance/day?date=' + today);
    c.innerHTML = `
      <div class="toolbar">
        <label class="muted">Date</label><input type="date" id="date" value="${today}" />
        ${canSync ? '<button class="btn secondary" id="sync">Import Attendance</button>' : ''}
        <div class="spacer"></div>
        <span class="tag present">Present <b id="s-present">${data.summary.present || 0}</b></span>
        <span class="tag half">Half <b id="s-half">${data.summary.half || 0}</b></span>
        <span class="tag leave">Leave <b id="s-leave">${data.summary.leave || 0}</b></span>
        <span class="tag absent">Absent <b id="s-absent">${data.summary.absent || 0}</b></span>
      </div>
      <div id="holidayBanner">${data.holiday ? `<div class="card" style="border-left:3px solid #5b21b6;margin-bottom:12px"><b>🎉 Holiday:</b> ${UI.esc(data.holiday)}</div>` : ''}</div>
      <div id="list">${this.attDayTable(data.list, today)}</div>`;

    const reload = async () => {
      const date = document.getElementById('date').value;
      const d = await api.get('/attendance/day?date=' + date);
      document.getElementById('list').innerHTML = this.attDayTable(d.list, date);
      for (const k of ['present', 'half', 'leave', 'absent']) document.getElementById('s-' + k).textContent = d.summary[k] || 0;
      document.getElementById('holidayBanner').innerHTML = d.holiday ? `<div class="card" style="border-left:3px solid #5b21b6;margin-bottom:12px"><b>🎉 Holiday:</b> ${UI.esc(d.holiday)}</div>` : '';
      this.bindAttRows(c, date, reload);
    };
    document.getElementById('date').onchange = reload;
    const syncBtn = document.getElementById('sync');
    if (syncBtn) syncBtn.onclick = () => this.syncAttendance(c, reload);
    this.bindAttRows(c, today, reload);
  },

  async attendanceInsights(c) {
    c.innerHTML = '<div class="muted">Loading insights...</div>';
    const thisMonth = new Date().toISOString().slice(0, 7);

    const rateColor = (rate) => {
      if (rate == null) return '#f1f5f9';
      if (rate >= 90) return '#16a34a';
      if (rate >= 75) return '#65a30d';
      if (rate >= 60) return '#eab308';
      if (rate >= 40) return '#f97316';
      return '#ef4444';
    };

    const load = async (month) => {
      c.innerHTML = '<div class="muted">Loading insights...</div>';
      const d = await api.get('/attendance/insights?month=' + month).catch(() => null);
      if (!d) { c.innerHTML = '<div class="muted">Could not load insights.</div>'; return; }
      const { days, stats, byWeekday, byDepartment, topAttendees, topAbsentees, punctuality, distribution, firstDow, activeCount } = d;

      // Build calendar grid (weeks). Pad leading blanks for the first weekday.
      const cells = [];
      for (let i = 0; i < firstDow; i++) cells.push(null);
      days.forEach((x) => cells.push(x));
      const weekRows = [];
      for (let i = 0; i < cells.length; i += 7) weekRows.push(cells.slice(i, i + 7));

      const cellHtml = (x) => {
        if (!x) return '<div style="aspect-ratio:1"></div>';
        if (x.isFuture) return `<div style="aspect-ratio:1;border:1px solid #f1f5f9;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#cbd5e1;font-size:13px">${x.day}</div>`;
        if (x.type === 'holiday') return `<div title="🎉 ${UI.esc(x.holiday)}" style="aspect-ratio:1;border:1px solid #ede9fe;background:#f5f3ff;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:default"><div style="font-size:13px;font-weight:600;color:#5b21b6">${x.day}</div><div style="font-size:14px">🎉</div></div>`;
        if (x.type === 'off') return `<div title="Weekend / non-working" style="aspect-ratio:1;border:1px solid #f1f5f9;background:#fafafa;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#cbd5e1;font-size:13px">${x.day}</div>`;
        const clr = rateColor(x.rate);
        return `<div class="ins-day" data-date="${x.date}" title="${x.date}: ${x.rate}% present (${x.present} present, ${x.half} half, ${x.leave} leave, ${x.absent} absent)"
          style="aspect-ratio:1;border-radius:8px;background:${clr};cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;position:relative">
          <div style="font-size:13px;font-weight:700">${x.day}</div>
          <div style="font-size:10px;opacity:.95">${Math.round(x.rate)}%</div>
        </div>`;
      };

      // Month-over-month delta badge.
      const delta = stats.rateDelta;
      const deltaBadge = delta == null ? '' :
        delta > 0 ? `<span style="color:#16a34a;font-size:13px;font-weight:700">▲ ${delta}%</span>`
        : delta < 0 ? `<span style="color:#ef4444;font-size:13px;font-weight:700">▼ ${Math.abs(delta)}%</span>`
        : `<span style="color:#9ca3af;font-size:13px;font-weight:700">●  0%</span>`;

      // Daily trend bars (working days only).
      const workingDays = days.filter(x => x.type === 'working' && x.rate != null);

      c.innerHTML = `
        <div class="toolbar">
          <label class="muted">Month</label>
          <input type="month" id="ins-month" value="${month}" />
          <div class="spacer"></div>
          <span class="muted" style="font-size:12px">${activeCount} active employees</span>
        </div>

        <!-- Hero stat cards -->
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div class="card" style="flex:1;min-width:140px;text-align:center">
            <div style="font-size:28px;font-weight:800;color:${rateColor(stats.avgRate)}">${stats.avgRate != null ? stats.avgRate + '%' : '—'}</div>
            <div class="muted" style="font-size:12px">Avg Attendance ${deltaBadge}</div>
            ${stats.prevAvgRate != null ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px">vs ${stats.prevAvgRate}% last month</div>` : ''}
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center">
            <div style="font-size:28px;font-weight:800;color:${punctuality.onTimeRate == null ? '#9ca3af' : (punctuality.onTimeRate >= 80 ? '#16a34a' : '#f97316')}">${punctuality.onTimeRate != null ? punctuality.onTimeRate + '%' : '—'}</div>
            <div class="muted" style="font-size:12px">⏰ On-Time Rate</div>
            ${punctuality.late ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px">${punctuality.late} late · avg ${UI.duration(punctuality.avgLateMin)}</div>` : ''}
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center">
            <div style="font-size:28px;font-weight:800;color:#7c3aed">${stats.avgWorkHours != null ? stats.avgWorkHours + 'h' : '—'}</div>
            <div class="muted" style="font-size:12px">⏱ Avg Work Hours</div>
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center">
            <div style="font-size:28px;font-weight:800;color:#16a34a">${stats.perfectCount}</div>
            <div class="muted" style="font-size:12px">⭐ Perfect Attendance</div>
          </div>
          <div class="card" style="flex:1;min-width:110px;text-align:center">
            <div style="font-size:28px;font-weight:800;color:#374151">${stats.workingDays}</div>
            <div class="muted" style="font-size:12px">Working Days</div>
          </div>
        </div>

        <!-- Status distribution -->
        <div class="card" style="margin-bottom:18px">
          <div style="font-weight:700;margin-bottom:12px">📊 Status Distribution</div>
          <div style="display:flex;height:26px;border-radius:6px;overflow:hidden;font-size:11px;font-weight:700;color:#fff">
            ${distribution.presentPct ? `<div title="Present ${distribution.present}" style="width:${distribution.presentPct}%;background:#16a34a;display:flex;align-items:center;justify-content:center">${distribution.presentPct >= 8 ? distribution.presentPct + '%' : ''}</div>` : ''}
            ${distribution.halfPct ? `<div title="Half ${distribution.half}" style="width:${distribution.halfPct}%;background:#eab308;display:flex;align-items:center;justify-content:center">${distribution.halfPct >= 8 ? distribution.halfPct + '%' : ''}</div>` : ''}
            ${distribution.leavePct ? `<div title="Leave ${distribution.leave}" style="width:${distribution.leavePct}%;background:#2563eb;display:flex;align-items:center;justify-content:center">${distribution.leavePct >= 8 ? distribution.leavePct + '%' : ''}</div>` : ''}
            ${distribution.absentPct ? `<div title="Absent ${distribution.absent}" style="width:${distribution.absentPct}%;background:#ef4444;display:flex;align-items:center;justify-content:center">${distribution.absentPct >= 8 ? distribution.absentPct + '%' : ''}</div>` : ''}
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:#6b7280">
            <span>🟢 Present: <b>${distribution.present}</b></span>
            <span>🟡 Half: <b>${distribution.half}</b></span>
            <span>🔵 Leave: <b>${distribution.leave}</b></span>
            <span>🔴 Absent: <b>${distribution.absent}</b></span>
          </div>
        </div>

        <!-- Calendar heatmap -->
        <div class="card" style="margin-bottom:18px">
          <div style="font-weight:700;margin-bottom:12px">📅 Attendance Calendar — ${month}</div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px">
            ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div style="text-align:center;font-size:11px;font-weight:700;color:#9ca3af">${d}</div>`).join('')}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${weekRows.map(week => `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">${week.map(cellHtml).join('')}</div>`).join('')}
          </div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:14px;font-size:11px;color:#6b7280">
            <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;height:12px;background:#16a34a;border-radius:3px;display:inline-block"></span>≥90%</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;height:12px;background:#eab308;border-radius:3px;display:inline-block"></span>60-75%</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;height:12px;background:#ef4444;border-radius:3px;display:inline-block"></span>&lt;40%</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;height:12px;background:#f5f3ff;border:1px solid #ede9fe;border-radius:3px;display:inline-block"></span>🎉 Holiday</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;height:12px;background:#fafafa;border:1px solid #f1f5f9;border-radius:3px;display:inline-block"></span>Weekend/off</span>
            <span style="font-style:italic">Tip: click a day to open it in Daily View</span>
          </div>
        </div>

        <!-- Daily trend bar chart -->
        ${workingDays.length > 1 ? `
        <div class="card" style="margin-bottom:18px">
          <div style="font-weight:700;margin-bottom:12px">📈 Daily Attendance Trend</div>
          <div style="display:flex;align-items:flex-end;gap:3px;height:90px">
            ${workingDays.map(x => `<div title="${x.date}: ${x.rate}%" style="flex:1;background:${rateColor(x.rate)};height:${x.rate}%;border-radius:3px 3px 0 0;min-width:5px;cursor:default"></div>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-top:4px">
            <span>${UI.date(workingDays[0].date)}</span><span>${UI.date(workingDays[workingDays.length-1].date)}</span>
          </div>
        </div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <!-- Department breakdown -->
          <div class="card">
            <div style="font-weight:700;margin-bottom:12px">🏢 By Department</div>
            ${byDepartment.length ? byDepartment.map(dp => `
              <div style="margin-bottom:11px">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                  <span style="font-weight:600">${UI.esc(dp.department)} <span style="color:#9ca3af;font-weight:400">(${dp.employees})</span></span>
                  <span style="color:${rateColor(dp.avgRate)};font-weight:700">${dp.avgRate}%</span>
                </div>
                <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                  <div style="height:100%;width:${dp.avgRate}%;background:${rateColor(dp.avgRate)};border-radius:4px"></div>
                </div>
              </div>`).join('') : '<div class="muted" style="font-size:13px">No data yet.</div>'}
          </div>
          <!-- By weekday -->
          <div class="card">
            <div style="font-weight:700;margin-bottom:12px">📊 By Weekday</div>
            ${byWeekday.length ? byWeekday.map(w => `
              <div style="margin-bottom:11px">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                  <span style="font-weight:600">${w.name}</span><span style="color:${rateColor(w.avgRate)};font-weight:700">${w.avgRate}%</span>
                </div>
                <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                  <div style="height:100%;width:${w.avgRate}%;background:${rateColor(w.avgRate)};border-radius:4px"></div>
                </div>
              </div>`).join('') : '<div class="muted" style="font-size:13px">No data yet.</div>'}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          <!-- Top attendees -->
          <div class="card">
            <div style="font-weight:700;margin-bottom:12px">⭐ Top Attendance</div>
            ${topAttendees.length ? topAttendees.map((a, i) => `
              <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9">
                <span style="font-size:13px;width:18px;color:#9ca3af">${i+1}</span>
                <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${UI.esc(a.name)}</div><div style="font-size:11px;color:#9ca3af">${UI.esc(a.department||'')}</div></div>
                <span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700">${a.rate}%</span>
              </div>`).join('') : '<div class="muted" style="font-size:13px">No data yet.</div>'}
          </div>
          <!-- Most absences -->
          <div class="card">
            <div style="font-weight:700;margin-bottom:12px">🔴 Most Absences</div>
            ${topAbsentees.length ? topAbsentees.map(a => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9">
                <div style="min-width:0"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${UI.esc(a.name)}</div><div style="font-size:11px;color:#9ca3af">${UI.esc(a.department||'')}</div></div>
                <span style="background:#fef2f2;color:#991b1b;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700">${a.absent} day${a.absent !== 1 ? 's' : ''}</span>
              </div>`).join('') : '<div class="muted" style="font-size:13px">Great — no absences recorded! 🎉</div>'}
          </div>
        </div>

        ${stats.best ? `<div class="card" style="margin-top:16px;display:flex;gap:20px;flex-wrap:wrap;font-size:13px">
          <span>🏆 <strong>Best day:</strong> ${UI.date(stats.best.date)} (${stats.best.rate}%)</span>
          <span>⚠️ <strong>Lowest day:</strong> ${UI.date(stats.worst.date)} (${stats.worst.rate}%)</span>
        </div>` : ''}
      `;

      // Click a calendar day → jump to Daily View on that date.
      c.querySelectorAll('.ins-day').forEach((el) => el.onclick = () => {
        AdminViews._pendingAttDate = el.dataset.date;
        const parent = c.closest('#view') || document;
        const tabBtn = parent.querySelector('.att-tab[data-tab="daily"]');
        if (tabBtn) tabBtn.click();
      });

      document.getElementById('ins-month').onchange = (e) => load(e.target.value);
    };

    load(thisMonth);
  },

  attDayTable(list, date) {
    return UI.table([
      { key: 'emp_code', label: 'Code' },
      { key: 'name', label: 'Employee' },
      { key: 'department', label: 'Dept', render: (r) => UI.esc(r.department || '-') },
      { key: 'check_in', label: 'Marked At', render: (r) => r.check_in ? '<b>' + UI.time(r.check_in) + '</b>' : '<span style="color:#cbd5e1">—</span>' },
      { key: 'late', label: 'Late By', render: (r) => r.late_minutes > 0 ? '<span style="background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:700">⏰ ' + UI.duration(r.late_minutes) + '</span>' : (r.marked ? '<span style="color:#16a34a;font-size:12px">On time</span>' : '<span style="color:#cbd5e1">—</span>') },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) + (r.wfh ? ' <span title="Work from home" style="font-size:12px">🏠</span>' : '') + (r.source === 'slack' ? ' <span title="Marked via Slack" style="font-size:11px;color:#6b7280">💬</span>' : '') },
      { key: 'location', label: 'Location', render: (r) => (r.in_lat != null && r.in_lng != null)
        ? `<a href="https://www.google.com/maps?q=${r.in_lat},${r.in_lng}" target="_blank" rel="noopener" title="Marked from this location">📍 Map</a>${r.in_geofenced === 0 ? ' <span title="Outside office radius" style="font-size:11px;color:#dc2626">⚠ off-site</span>' : (r.in_geofenced === 1 ? ' <span title="At office" style="font-size:11px;color:#16a34a">✓</span>' : '')}`
        : '<span style="color:#cbd5e1">—</span>' },
      { key: 'mood', label: 'Mood', render: (r) => r.mood_note ? `<span title="${UI.esc(r.mood_note)}">${UI.mood(r.mood_score)}</span>` : UI.mood(r.mood_score) },
      { key: 'act', label: '', render: (r) => `<button class="btn sm secondary" data-edit="${r.id}">Edit</button> <button class="btn sm red" data-del="${r.id}">Delete</button>` },
    ], list, 'No active employees.');
  },

  bindAttRows(c, date, reload) {
    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => this.editAttendance(b.dataset.edit, date, reload));
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this attendance record for ' + date + '?')) return;
      try { await api.post('/attendance/delete', { employee_id: Number(b.dataset.del), date }); UI.toast('Deleted.', 'success'); reload(); }
      catch (e) { UI.toast(e.message, 'error'); }
    });
  },

  editAttendance(employeeId, date, reload) {
    const hhmm = (t) => {
      if (!t) return '';
      const d = new Date(t); if (isNaN(d)) return '';
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    // Pull current row from the table to prefill.
    const m = UI.modal({
      title: 'Edit Attendance — ' + date,
      bodyHtml: `
        <div class="field"><label>Status</label>
          <select id="status"><option value="present">Present</option><option value="half">Half Day</option><option value="leave">On Leave</option><option value="absent">Absent</option></select>
        </div>
        <div class="form-grid">
          <div class="field"><label>Clock In</label><input type="time" id="cin" /></div>
          <div class="field"><label>Clock Out</label><input type="time" id="cout" /></div>
        </div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      try {
        await api.post('/attendance/mark', {
          employee_id: Number(employeeId), date,
          status: m.root.querySelector('#status').value,
          check_in: m.root.querySelector('#cin').value,
          check_out: m.root.querySelector('#cout').value,
        });
        m.close(); UI.toast('Saved.', 'success'); reload();
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  syncAttendance(c, reload) {
    const m = UI.modal({
      title: 'Import Attendance',
      bodyHtml: `
        <div class="card" style="box-shadow:none;border:1px solid var(--border)">
          <div class="section-title">Option 1 — Upload a file</div>
          <p class="muted" style="font-size:13px">Upload an <b>Excel (.xlsx/.xls)</b> or <b>CSV</b> file exported from your attendance sheet. (In Google Sheets: File → Download → Microsoft Excel or CSV.)</p>
          <div class="btn-row">
            <label class="btn secondary">Choose File<input type="file" id="file" accept=".xlsx,.xls,.csv" style="display:none" /></label>
            <span id="fname" class="muted" style="align-self:center"></span>
          </div>
          <div class="btn-row mt"><button class="btn" id="goFile" disabled>Upload &amp; Sync</button></div>
        </div>
        <div class="card mt" style="box-shadow:none;border:1px solid var(--border)">
          <div class="section-title">Option 2 — Link a Google Sheet</div>
          <p class="muted" style="font-size:13px">Paste your Google Sheet link. Set the sheet to <b>"Anyone with the link can view"</b> (Share button), or use a Published-to-web CSV link. It is saved for next time.</p>
          <div class="field"><input id="url" placeholder="https://docs.google.com/spreadsheets/d/..." /></div>
          <div class="btn-row"><button class="btn" id="goUrl">Sync from Link</button></div>
        </div>
        <div class="card mt" style="box-shadow:none;border:1px solid var(--border)">
          <div class="section-title">Option 3 — Sync from Slack</div>
          <p class="muted" style="font-size:13px">Pull attendance from your Slack channel (set it up in <b>Settings → Slack Attendance</b>). Anyone who posted that day is marked Present.</p>
          <div class="toolbar"><label class="muted">Date</label><input type="date" id="slackDate" value="${new Date().toISOString().slice(0, 10)}" /><button class="btn" id="goSlack">Sync from Slack</button></div>
        </div>
        <p class="muted mt" style="font-size:12px">For file/sheet imports, include <b>Emp Code</b> (or Email/Name), <b>Date</b>, and either a <b>Status</b> (Present/Absent/Half/Leave) or <b>Check In</b>/<b>Check Out</b> times.</p>`,
      footHtml: `<button class="btn secondary" data-close-btn>Close</button>`,
    });
    api.get('/settings').then(({ settings }) => { const i = m.root.querySelector('#url'); if (i && settings.attendanceSheetUrl) i.value = settings.attendanceSheetUrl; }).catch(() => {});
    m.root.querySelector('[data-close-btn]').onclick = m.close;

    const report = (r) => {
      let msg = `Synced ${r.synced} of ${r.total} rows.`;
      if (r.unmatched) msg += ` ${r.unmatched} rows had no matching employee.`;
      UI.toast(msg, 'success');
      if (r.unmatchedKeys && r.unmatchedKeys.length) {
        const m2 = UI.modal({ title: 'Some rows did not match', bodyHtml: `<p class="muted">These codes/emails in the sheet did not match any employee. Check the Emp Code / Email columns:</p><p>${r.unmatchedKeys.map(UI.esc.bind(UI)).join('<br/>')}</p>`, footHtml: '<button class="btn" id="ok2">OK</button>' });
        m2.root.querySelector('#ok2').onclick = m2.close;
      } else { m.close(); }
      reload();
    };

    const fileInput = m.root.querySelector('#file');
    const goFile = m.root.querySelector('#goFile');
    fileInput.onchange = () => {
      const f = fileInput.files[0];
      m.root.querySelector('#fname').textContent = f ? f.name : '';
      goFile.disabled = !f;
    };
    goFile.onclick = async () => {
      const f = fileInput.files[0];
      if (!f) return;
      const fd = new FormData(); fd.append('file', f);
      try { report(await api.upload('/attendance/sync-file', fd)); }
      catch (e) { UI.toast(e.message, 'error'); }
    };

    m.root.querySelector('#goUrl').onclick = async () => {
      const url = m.root.querySelector('#url').value.trim();
      try { report(await api.post('/attendance/sync', url ? { url } : {})); }
      catch (e) { UI.toast(e.message, 'error'); }
    };

    m.root.querySelector('#goSlack').onclick = async () => {
      const date = m.root.querySelector('#slackDate').value;
      try { report(await api.post('/attendance/slack-sync', { date })); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  // ---------------- Leave approvals ----------------
  async leave(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [{ leaves }, { types }] = await Promise.all([api.get('/leave'), api.get('/leave/types')]);
    const typeName = (code) => (types.find((t) => t.code === code) || {}).name || code;
    const anyPending = leaves.some((l) => l.status === 'pending');
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Leave Requests</div><div class="spacer"></div>${anyPending ? '<button class="btn secondary" id="aiSuggest">✨ AI suggestions</button>' : ''}<button class="btn secondary" id="grant">Grant Comp-off</button></div>
      ` + UI.table([
      { key: 'employee_name', label: 'Employee' },
      { key: 'type', label: 'Type', render: (r) => UI.esc(typeName(r.type)) },
      { key: 'from_date', label: 'From', render: (r) => UI.date(r.from_date) },
      { key: 'to_date', label: 'To', render: (r) => UI.date(r.to_date) },
      { key: 'days', label: 'Days', render: (r) => r.days + (r.half_day ? ' (half)' : '') },
      { key: 'reason', label: 'Reason', render: (r) => UI.esc(r.reason || '-') },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
      { key: 'act', label: '', render: (r) => r.status === 'pending' ? `<button class="btn sm green" data-ok="${r.id}">Approve</button> <button class="btn sm red" data-no="${r.id}">Reject</button>` : UI.esc(r.comment || '') },
    ], leaves, 'No leave requests.');
    const decide = async (id, decision) => {
      const comment = decision === 'rejected' ? (prompt('Reason for rejection (optional):') || '') : '';
      try { await api.post(`/leave/${id}/decision`, { decision, comment }); UI.toast('Leave ' + decision + '.', 'success'); this.leave(c); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    document.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => decide(b.dataset.ok, 'approved'));
    document.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => decide(b.dataset.no, 'rejected'));
    const aiSuggest = document.getElementById('aiSuggest');
    if (aiSuggest) aiSuggest.onclick = async () => {
      aiSuggest.disabled = true; aiSuggest.textContent = '✨ Thinking…';
      try {
        const r = await api.get('/ai/recommendations?type=leave');
        if (!r.configured) { UI.toast('Enable AI in Settings → AI Assistant first.', 'error'); }
        const recs = r.recommendations || {};
        document.querySelectorAll('[data-ok]').forEach((b) => {
          const rec = recs[b.dataset.ok];
          if (!rec) return;
          const ok = rec.suggestion === 'approve';
          const chip = document.createElement('div');
          chip.style.cssText = 'font-size:11px;margin-bottom:4px;color:' + (ok ? '#16a34a' : '#dc2626');
          chip.innerHTML = `✨ ${ok ? 'Suggest approve' : 'Suggest reject'}: <span style="color:#6b7280">${UI.esc(rec.reason || '')}</span>`;
          b.parentElement.insertBefore(chip, b);
        });
        UI.toast('AI suggestions added — you decide. 💜', 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
      aiSuggest.disabled = false; aiSuggest.textContent = '✨ AI suggestions';
    };
    document.getElementById('grant').onclick = async () => {
      let list = [];
      try { list = (await api.get('/employees')).employees; } catch (e) {}
      if (!list.length) { try { list = (await api.get('/employees/team')).employees; } catch (e) {} }
      const m = UI.modal({
        title: 'Grant Comp-off Credit',
        bodyHtml: `
          <p class="muted" style="font-size:13px">Give comp-off days (e.g. for working a holiday/weekend). The employee can then apply for Comp-off leave.</p>
          <div class="field"><label>Employee</label><select id="emp">${list.map((e) => `<option value="${e.id}">${UI.esc(e.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Days</label><input type="number" step="0.5" id="days" value="1" /></div>
          <div class="field"><label>Reason</label><input id="reason" placeholder="e.g. Worked on Sunday" /></div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Grant</button>`,
      });
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#save').onclick = async () => {
        try { await api.post('/leave/compoff', { employee_id: m.root.querySelector('#emp').value, days: m.root.querySelector('#days').value, reason: m.root.querySelector('#reason').value }); m.close(); UI.toast('Comp-off granted.', 'success'); }
        catch (e) { UI.toast(e.message, 'error'); }
      };
    };
  },

  // ---------------- Leave Calendar ----------------
  async leaveCalendar(c) {
    const month = UI.thisMonth();
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Leave Calendar</div><div class="spacer"></div><label class="muted">Month</label><input type="month" id="month" value="${month}" /></div>
      <div id="list" class="muted">Loading...</div>`;
    const [{ types }] = await Promise.all([api.get('/leave/types')]);
    const typeName = (code) => (types.find((t) => t.code === code) || {}).name || code;
    const load = async () => {
      const mv = document.getElementById('month').value;
      const { leaves } = await api.get('/leave/calendar?month=' + mv);
      document.getElementById('list').innerHTML = UI.table([
        { key: 'employee_name', label: 'Employee' },
        { key: 'type', label: 'Type', render: (r) => UI.esc(typeName(r.type)) },
        { key: 'from_date', label: 'From', render: (r) => UI.date(r.from_date) },
        { key: 'to_date', label: 'To', render: (r) => UI.date(r.to_date) },
        { key: 'days', label: 'Days', render: (r) => r.days + (r.half_day ? ' (half)' : '') },
      ], leaves, 'No one is on approved leave this month.');
    };
    document.getElementById('month').onchange = load;
    load();
  },

  // ---------------- Reimbursement approvals ----------------
  async reimbursement(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { reimbursements } = await api.get('/reimbursement');
    c.innerHTML = UI.table([
      { key: 'employee_name', label: 'Employee' },
      { key: 'title', label: 'Title' },
      { key: 'category', label: 'Category', render: (r) => UI.esc(r.category || '-') },
      { key: 'amount', label: 'Amount', render: (r) => UI.money(r.amount) },
      { key: 'bill', label: 'Bill', render: (r) => r.bill_file ? `<a href="/api/reimbursement/${r.id}/bill" target="_blank">View</a>` : '-' },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
      { key: 'act', label: '', render: (r) => r.status === 'pending' ? `<button class="btn sm green" data-ok="${r.id}">Approve</button> <button class="btn sm red" data-no="${r.id}">Reject</button>` : UI.esc(r.comment || '') },
    ], reimbursements, 'No reimbursement requests.');
    const decide = async (id, decision) => {
      const comment = decision === 'rejected' ? (prompt('Reason (optional):') || '') : '';
      try { await api.post(`/reimbursement/${id}/decision`, { decision, comment }); UI.toast('Reimbursement ' + decision + '.', 'success'); this.reimbursement(c); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    document.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => decide(b.dataset.ok, 'approved'));
    document.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => decide(b.dataset.no, 'rejected'));
  },

  // ---------------- Payroll ----------------
  async payroll(c) {
    const month = UI.thisMonth();
    const canManage = App.has('payroll:manage');
    c.innerHTML = `
      <div class="toolbar">
        <label class="muted">Month</label><input type="month" id="month" value="${month}" />
        ${canManage ? '<button class="btn" id="gen">Generate / Recalculate</button>' : '<span class="muted">View only — Finance generates payroll.</span>'}
        <div class="spacer"></div>
        <span id="runStatus"></span>
        ${canManage ? '<button class="btn green" id="approve" style="display:none">Approve Payroll</button> <button class="btn secondary" id="unlock" style="display:none">Unlock</button>' : ''}
      </div>
      <div id="list" class="muted">${canManage ? 'Pick a month and click Generate, or view existing payslips below.' : 'Select a month to view payslips.'}</div>`;
    const approveBtn = document.getElementById('approve');
    const unlockBtn = document.getElementById('unlock');
    const showRun = (run) => {
      const approved = run && run.status === 'approved';
      document.getElementById('runStatus').innerHTML = approved
        ? '<span class="tag approved">Approved &amp; Locked</span>'
        : '<span class="tag pending">Draft</span>';
      if (approveBtn) approveBtn.style.display = approved ? 'none' : '';
      if (unlockBtn) unlockBtn.style.display = approved ? '' : 'none';
    };
    const load = async () => {
      const mv = document.getElementById('month').value;
      const [{ payslips }, { run }] = await Promise.all([api.get('/payroll?month=' + mv), api.get('/payroll/run?month=' + mv)]);
      this.renderPayrollList(payslips, canManage);
      showRun(run);
    };
    const genBtn = document.getElementById('gen');
    if (genBtn) genBtn.onclick = async () => {
      const mv = document.getElementById('month').value;
      try { const r = await api.post('/payroll/generate', { month: mv }); UI.toast(`Generated ${r.count} payslips.`, 'success'); this.renderPayrollList(r.payslips, canManage); showRun(r.run); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    if (approveBtn) approveBtn.onclick = async () => {
      const mv = document.getElementById('month').value;
      if (!confirm('Approve and lock payroll for ' + mv + '? It cannot be regenerated until unlocked.')) return;
      try { const r = await api.post('/payroll/approve', { month: mv }); UI.toast('Payroll approved & locked.', 'success'); showRun(r.run); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    if (unlockBtn) unlockBtn.onclick = async () => {
      const mv = document.getElementById('month').value;
      try { const r = await api.post('/payroll/unlock', { month: mv }); UI.toast('Unlocked.', 'success'); showRun(r.run); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    document.getElementById('month').onchange = load;
    load();
  },
  renderPayrollList(payslips, canManage) {
    if (canManage === undefined) canManage = App.has('payroll:manage');
    document.getElementById('list').innerHTML = UI.table([
      { key: 'employee_name', label: 'Employee' },
      { key: 'paid_days', label: 'Paid Days', render: (r) => `${r.paid_days}/${r.working_days}` },
      { key: 'gross', label: 'Gross', render: (r) => UI.money(r.gross) },
      { key: 'deductions', label: 'Deductions', render: (r) => UI.money(r.deductions) },
      { key: 'reimbursements', label: 'Reimb.', render: (r) => UI.money(r.reimbursements) },
      { key: 'net_salary', label: 'Net', render: (r) => UI.money(r.net_salary) },
      { key: 'act', label: '', render: (r) => `<a class="btn sm secondary" href="/api/payroll/${r.id}/pdf" target="_blank">PDF</a>${canManage ? ` <button class="btn sm" data-email="${r.id}">Email</button>` : ''}` },
    ], payslips, 'No payslips for this month yet.' + (canManage ? ' Click Generate.' : ''));
    document.querySelectorAll('[data-email]').forEach((b) => b.onclick = async () => {
      try { const r = await api.post(`/payroll/${b.dataset.email}/email`); UI.toast(r.ok ? 'Payslip emailed.' : 'Email not sent (' + (r.reason || 'check email settings') + ').', r.ok ? 'success' : 'error'); }
      catch (e) { UI.toast(e.message, 'error'); }
    });
  },

  // ---------------- Happiness Score ----------------
  async happiness(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    let days = 30;
    const load = async () => {
      c.innerHTML = '<div class="muted">Loading...</div>';
      const d = await api.get(`/mood/dashboard?days=${days}`).catch(() => null);
      if (!d) { c.innerHTML = '<div class="muted">Could not load happiness data.</div>'; return; }
      const { overall, by_department, trend, per_employee, recent_notes } = d;

      const MOODS = [
        { score:1, emoji:'😞', label:'Very Unhappy', color:'#ef4444' },
        { score:2, emoji:'😟', label:'Unhappy',      color:'#f97316' },
        { score:3, emoji:'😐', label:'Neutral',      color:'#eab308' },
        { score:4, emoji:'😊', label:'Happy',        color:'#22c55e' },
        { score:5, emoji:'😄', label:'Very Happy',   color:'#10b981' },
      ];
      const getMood = s => MOODS.find(m => m.score === Math.round(s)) || MOODS[2];
      const scoreColor = s => s >= 4 ? '#22c55e' : s >= 3 ? '#eab308' : '#ef4444';
      const scorePct = s => s ? Math.round(s * 20) : 0;

      const avgScore = overall.avg_score || 0;
      const moodInfo = getMood(avgScore);
      const happinessPct = scorePct(avgScore);

      c.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px">
          <div class="section-title" style="margin:0">💛 Employee Happiness Score</div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="muted" style="font-size:13px">Period:</span>
            ${[7,30,90].map(n => `<button class="btn ${n===days?'':'secondary'} sm" data-days="${n}">${n}d</button>`).join('')}
          </div>
        </div>

        <!-- Main score hero -->
        <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border-radius:16px;padding:28px 32px;color:#fff;display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:20px">
          <div style="font-size:72px;line-height:1">${moodInfo.emoji}</div>
          <div style="flex:1">
            <div style="font-size:52px;font-weight:900;line-height:1">${happinessPct}%</div>
            <div style="font-size:18px;opacity:.9;margin-top:4px">${moodInfo.label} · ${avgScore ? avgScore.toFixed(1) : '—'}/5</div>
            <div style="font-size:13px;opacity:.7;margin-top:6px">Company Happiness Score · Last ${days} days</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;text-align:center">
            <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:12px 20px">
              <div style="font-size:24px;font-weight:800">${overall.participating}</div>
              <div style="font-size:11px;opacity:.8">Participated</div>
            </div>
            <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:12px 20px">
              <div style="font-size:24px;font-weight:800">${overall.participation_rate}%</div>
              <div style="font-size:11px;opacity:.8">Participation</div>
            </div>
          </div>
        </div>

        <!-- Stats row -->
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
          <div class="card" style="flex:1;min-width:120px;text-align:center">
            <div style="font-size:22px;font-weight:800;color:#4f46e5">${overall.total_checkins}</div>
            <div class="muted" style="font-size:12px">Total Check-ins</div>
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center">
            <div style="font-size:22px;font-weight:800;color:#4f46e5">${overall.total_active}</div>
            <div class="muted" style="font-size:12px">Active Employees</div>
          </div>
          <div class="card" style="flex:1;min-width:120px;text-align:center">
            <div style="font-size:22px;font-weight:800;color:${overall.participation_rate >= 70 ? '#22c55e' : '#ef4444'}">${overall.participation_rate}%</div>
            <div class="muted" style="font-size:12px">Participation Rate</div>
          </div>
        </div>

        <!-- Trend chart -->
        ${trend.length > 1 ? `
        <div class="card" style="margin-bottom:20px">
          <div style="font-weight:700;margin-bottom:14px">📈 Mood Trend</div>
          <div style="display:flex;align-items:flex-end;gap:3px;height:80px">
            ${trend.map(t => {
              const pct = (t.avg_score/5)*100;
              const m = getMood(t.avg_score);
              return `<div title="${t.date}: ${t.avg_score?.toFixed(1)} (${t.responses} responses)"
                style="flex:1;background:${m.color};height:${pct}%;border-radius:4px 4px 0 0;opacity:.8;cursor:default;min-width:4px"></div>`;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-top:4px">
            <span>${trend[0]?.date || ''}</span><span>${trend[trend.length-1]?.date || ''}</span>
          </div>
        </div>` : ''}

        <!-- Department breakdown -->
        ${by_department.length ? `
        <div class="card" style="margin-bottom:20px">
          <div style="font-weight:700;margin-bottom:14px">🏢 By Department</div>
          ${by_department.map(dept => {
            const pct = scorePct(dept.avg_score);
            const clr = scoreColor(dept.avg_score);
            const m = getMood(dept.avg_score);
            return `<div style="margin-bottom:14px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                <span style="font-weight:600;font-size:14px">${m.emoji} ${UI.esc(dept.department)}</span>
                <span style="font-size:13px;font-weight:700;color:${clr}">${pct}% · ${dept.avg_score?.toFixed(1)}/5</span>
              </div>
              <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${clr};border-radius:4px;transition:width .4s"></div>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:3px">${dept.employees} employee${dept.employees!==1?'s':''} · ${dept.checkins} check-in${dept.checkins!==1?'s':''}</div>
            </div>`;
          }).join('')}
        </div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
          <!-- Needs attention -->
          <div class="card">
            <div style="font-weight:700;margin-bottom:12px">🔴 Needs Attention</div>
            ${per_employee.filter(e => e.avg_score && e.avg_score < 3).slice(0,5).map(e => {
              const m = getMood(e.avg_score);
              return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">
                <span style="font-size:20px">${m.emoji}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${UI.esc(e.name)}</div>
                  <div style="font-size:11px;color:#9ca3af">${UI.esc(e.department||'')}</div>
                </div>
                <span style="font-weight:700;color:#ef4444;font-size:13px">${scorePct(e.avg_score)}%</span>
              </div>`;
            }).join('') || '<div class="muted" style="font-size:13px">Everyone is doing well! 🎉</div>'}
          </div>
          <!-- Top happiness -->
          <div class="card">
            <div style="font-weight:700;margin-bottom:12px">🟢 Happiest Employees</div>
            ${per_employee.filter(e => e.avg_score >= 4).slice(-5).reverse().map(e => {
              const m = getMood(e.avg_score);
              return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">
                <span style="font-size:20px">${m.emoji}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${UI.esc(e.name)}</div>
                  <div style="font-size:11px;color:#9ca3af">${UI.esc(e.department||'')}</div>
                </div>
                <span style="font-weight:700;color:#22c55e;font-size:13px">${scorePct(e.avg_score)}%</span>
              </div>`;
            }).join('') || '<div class="muted" style="font-size:13px">No data yet.</div>'}
          </div>
        </div>

        <!-- Not checked in -->
        ${per_employee.filter(e => !e.avg_score).length ? `
        <div class="card" style="margin-bottom:20px">
          <div style="font-weight:700;margin-bottom:10px">⚠️ Never Checked In (${per_employee.filter(e=>!e.avg_score).length} employees)</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${per_employee.filter(e=>!e.avg_score).map(e =>
              `<span style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:20px;padding:4px 12px;font-size:12px">${UI.esc(e.name)}</span>`
            ).join('')}
          </div>
        </div>` : ''}

        <!-- Recent notes -->
        ${recent_notes.length ? `
        <div class="card">
          <div style="font-weight:700;margin-bottom:12px">💬 Recent Employee Notes</div>
          ${recent_notes.map(n => {
            const m = MOODS.find(x=>x.score===n.score)||MOODS[2];
            return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9;align-items:flex-start">
              <span style="font-size:22px;flex-shrink:0">${m.emoji}</span>
              <div style="flex:1">
                <div style="font-size:13px;color:#374151">"${UI.esc(n.note)}"</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:3px">${UI.esc(n.name)} · ${UI.esc(n.department||'')} · ${UI.date(n.date)}</div>
              </div>
            </div>`;
          }).join('')}
        </div>` : ''}

        <!-- Full employee table -->
        <div class="section-title mt">All Employees</div>
        ${UI.table([
          { key:'name', label:'Employee' },
          { key:'department', label:'Dept', render: r => UI.esc(r.department||'—') },
          { key:'avg_score', label:'Score', render: r => r.avg_score ? `${getMood(r.avg_score).emoji} ${r.avg_score.toFixed(1)}/5` : '—' },
          { key:'pct', label:'Happiness %', render: r => r.avg_score ? `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;background:#f1f5f9;border-radius:3px"><div style="width:${scorePct(r.avg_score)}%;height:100%;background:${scoreColor(r.avg_score)};border-radius:3px"></div></div><span style="font-size:12px;font-weight:600;color:${scoreColor(r.avg_score)}">${scorePct(r.avg_score)}%</span></div>` : '<span style="color:#9ca3af">No data</span>' },
          { key:'checkins', label:'Check-ins', render: r => r.checkins || 0 },
          { key:'last_checkin', label:'Last Check-in', render: r => r.last_checkin ? UI.date(r.last_checkin) : '—' },
        ], per_employee, 'No employee data.')}
      `;

      // Period buttons
      c.querySelectorAll('[data-days]').forEach(btn => {
        btn.onclick = () => { days = parseInt(btn.dataset.days); load(); };
      });
    };
    load();
  },

  // ---------------- Reports ----------------
  async reports(c) {
    const month = UI.thisMonth();
    c.innerHTML = `
      <div class="toolbar">
        <label class="muted">Month</label>
        <input type="month" id="month" value="${month}" />
        <span class="spacer"></span>
        <button class="btn ghost" id="btnExport">⬇ Export CSV</button>
      </div>
      <div id="kpis" class="cards"></div>
      <div class="section-title mt">Per-employee breakdown</div>
      <div id="emp" class="muted">Loading...</div>`;

    // Small inline SVG horizontal stacked bar: present / half / leave / absent.
    const stackedBar = (p, h, l, a) => {
      const total = Math.max(1, p + h + l + a);
      const W = 320, H = 14;
      const px = (n) => (n / total) * W;
      const wp = px(p), wh = px(h), wl = px(l), wa = px(a);
      let x = 0;
      const seg = (w, color) => {
        const r = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="${color}"/>`;
        x += w; return r;
      };
      return `<svg width="${W}" height="${H}" role="img" aria-label="attendance bar" style="border-radius:7px;overflow:hidden;display:block">
        ${seg(wp, '#16a34a')}${seg(wh, '#f59e0b')}${seg(wl, '#6366f1')}${seg(wa, '#dc2626')}
      </svg>`;
    };

    const legendDot = (c, label) =>
      `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:12.5px;color:var(--muted)">
        <span style="width:10px;height:10px;border-radius:3px;background:${c};display:inline-block"></span>${label}
      </span>`;

    const miniStat = (label, value, color) =>
      `<div style="text-align:center;padding:8px 6px;background:#f8fafc;border-radius:8px;min-width:62px">
        <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em">${label}</div>
        <div style="font-size:18px;font-weight:700;margin-top:3px;color:${color || 'var(--text)'}">${value}</div>
      </div>`;

    let lastAtt = [], lastPay = [], lastMonth = month;

    const render = (att, pay) => {
      // Index payroll by employee name for quick join.
      const payByName = {};
      (pay.rows || []).forEach((r) => { payByName[r.name] = r; });

      // ---- KPIs ----
      const totalEmp = att.rows.length;
      const totalPresent = att.rows.reduce((s, r) => s + (r.present || 0), 0);
      const totalHalf = att.rows.reduce((s, r) => s + (r.half || 0), 0);
      const totalAbsent = att.rows.reduce((s, r) => s + (r.absent || 0), 0);
      const totalLeave = att.rows.reduce((s, r) => s + (r.leave_days || 0), 0);
      const totalOt = att.rows.reduce((s, r) => s + (r.ot_hours || 0), 0);
      const totalLate = att.rows.reduce((s, r) => s + (r.late_days || 0), 0);
      const possibleDays = totalPresent + totalHalf + totalAbsent + totalLeave;
      const attRate = possibleDays ? Math.round(((totalPresent + totalHalf * 0.5) / possibleDays) * 100) : 0;
      const netPayout = pay.totals ? pay.totals.net : 0;
      const grossPayout = pay.totals ? pay.totals.gross : 0;

      document.getElementById('kpis').innerHTML = `
        <div class="card stat"><div class="label">👥 Employees</div><div class="value">${totalEmp}</div></div>
        <div class="card stat"><div class="label">✅ Attendance rate</div><div class="value green">${attRate}%</div></div>
        <div class="card stat"><div class="label">🌴 Leave days</div><div class="value">${totalLeave}</div></div>
        <div class="card stat"><div class="label">❌ Absent days</div><div class="value red">${totalAbsent}</div></div>
        <div class="card stat"><div class="label">⏰ OT hours</div><div class="value amber">${totalOt}</div></div>
        <div class="card stat"><div class="label">💰 Net payout</div><div class="value">${UI.money(netPayout)}</div></div>`;

      // ---- Per-employee cards ----
      if (!att.rows.length) {
        document.getElementById('emp').innerHTML = '<div class="card muted">No data for this month.</div>';
        return;
      }

      const legend = `<div class="card" style="display:flex;flex-wrap:wrap;align-items:center;padding:10px 14px">
        <span style="font-size:12.5px;font-weight:600;margin-right:14px">Legend:</span>
        ${legendDot('#16a34a', 'Present')}${legendDot('#f59e0b', 'Half')}${legendDot('#6366f1', 'Leave')}${legendDot('#dc2626', 'Absent')}
      </div>`;

      const cards = att.rows.map((r) => {
        const ini = App.initials ? App.initials(r.name) : (r.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
        const p = r.present || 0, h = r.half || 0, l = r.leave_days || 0, a = r.absent || 0;
        const lateD = r.late_days || 0, ot = r.ot_hours || 0;
        const pay = payByName[r.name];
        const payBlock = pay ? `
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--border)">
            <div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600">Gross</div><div style="font-weight:700">${UI.money(pay.gross)}</div></div>
            <div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600">Deductions</div><div style="font-weight:700;color:var(--red)">${UI.money(pay.deductions)}</div></div>
            <div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600">Net</div><div style="font-weight:700;color:var(--green)">${UI.money(pay.net_salary)}</div></div>
          </div>` : `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);font-size:12.5px;color:var(--muted)">No payslip generated for this month.</div>`;

        return `<div class="card" style="padding:18px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
            <div class="avatar">${UI.esc(ini)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:15px;line-height:1.2">${UI.esc(r.name)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${UI.esc(r.department || 'No department')}</div>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            ${miniStat('Present', p, '#16a34a')}
            ${miniStat('Half', h, '#f59e0b')}
            ${miniStat('Leave', l, '#6366f1')}
            ${miniStat('Absent', a, '#dc2626')}
            ${miniStat('Late', lateD)}
            ${miniStat('OT hrs', ot)}
          </div>
          ${stackedBar(p, h, l, a)}
          ${payBlock}
        </div>`;
      }).join('');

      document.getElementById('emp').innerHTML = legend + `<div class="cards mt" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">${cards}</div>`;
    };

    const load = async () => {
      const mv = document.getElementById('month').value;
      lastMonth = mv;
      document.getElementById('emp').innerHTML = '<div class="muted">Loading...</div>';
      const [att, pay] = await Promise.all([
        api.get('/reports/attendance?month=' + mv),
        api.get('/reports/payroll?month=' + mv),
      ]);
      lastAtt = att.rows || [];
      lastPay = pay.rows || [];
      render(att, pay);
    };

    document.getElementById('month').onchange = load;
    document.getElementById('btnExport').onclick = () => {
      const payByName = {};
      lastPay.forEach((r) => { payByName[r.name] = r; });
      const head = ['Employee', 'Department', 'Present', 'Half', 'Leave', 'Absent', 'Late', 'OT hrs', 'Gross', 'Deductions', 'Net'];
      const esc = (v) => {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const rows = lastAtt.map((r) => {
        const p = payByName[r.name] || {};
        return [r.name, r.department || '', r.present || 0, r.half || 0, r.leave_days || 0, r.absent || 0, r.late_days || 0, r.ot_hours || 0, p.gross || '', p.deductions || '', p.net_salary || ''].map(esc).join(',');
      });
      const csv = head.join(',') + '\n' + rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `hrika-report-${lastMonth}.csv`; a.click();
      URL.revokeObjectURL(url);
    };
    load();
  },

  // ---------------- Settings ----------------
  async settings(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { settings: s } = await api.get('/settings');
    const st = s.statutory || {};
    let ltState = (s.leaveTypes && s.leaveTypes.length ? s.leaveTypes : [
      { code: 'casual', name: 'Casual Leave', quota: 12, paid: true },
      { code: 'unpaid', name: 'Unpaid Leave', quota: 0, paid: false },
    ]).map((t) => ({ code: t.code, name: t.name, quota: t.quota || 0, paid: t.paid !== false }));
    const days = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
    const wd = s.workingDays || [];
    const da = s.departmentAccounts || {};
    const daKeys = ['default', ...Object.keys(da).filter((k) => k.toLowerCase() !== 'default')];
    const daText = daKeys.map((k) => `${k}: ${(da[k] || []).join(', ')}`).join('\n');
    c.innerHTML = `
      <div class="card" style="max-width:760px">
        <div class="section-title">Company</div>
        <div class="form-grid">
          <div class="field"><label>Company Name</label><input id="companyName" value="${UI.esc(s.companyName)}" /></div>
          <div class="field"><label>Legal Name</label><input id="legalName" value="${UI.esc(s.legalName)}" /></div>
          <div class="field"><label>GST Number</label><input id="gst" value="${UI.esc(s.gst)}" /></div>
          <div class="field"><label>CIN (optional)</label><input id="cin" value="${UI.esc(s.cin)}" /></div>
          <div class="field"><label>PAN (optional)</label><input id="pan" value="${UI.esc(s.pan)}" /></div>
          <div class="field"><label>Currency Symbol</label><input id="currency" value="${UI.esc(s.currency)}" /></div>
          <div class="field"><label>Company Email</label><input id="email" value="${UI.esc(s.email)}" /></div>
          <div class="field"><label>Phone</label><input id="phone" value="${UI.esc(s.phone)}" /></div>
          <div class="field"><label>Website</label><input id="website" value="${UI.esc(s.website)}" /></div>
          <div class="field full"><label>Address</label><textarea id="address" rows="2">${UI.esc(s.address)}</textarea></div>
          <div class="field full"><label>Salary Slip Footer Text</label><input id="slipFooter" value="${UI.esc(s.slipFooter)}" /></div>
          <div class="field full"><label>Logo</label>
            ${s.logoFile ? `<div><img src="/uploads/${UI.esc(s.logoFile)}" style="max-height:48px;margin-bottom:8px"/></div>` : ''}
            <input type="file" id="logo" accept="image/*" />
          </div>
        </div>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Attendance / Working Hours</div>

        <!-- Dedicated, prominent attendance-cutoff control -->
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:14px 16px;margin-bottom:18px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="font-size:22px">⏰</div>
            <div style="flex:1;min-width:220px">
              <div style="font-weight:700;font-size:14px;color:#5b21b6">Allowed attendance time (cut-off)</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px">Employees can mark attendance until this time. <b>After it, they can't mark directly</b> — they must raise an <b>Attendance Request</b> for admin approval.</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="time" id="attendanceCloseTime" value="${UI.esc(s.attendanceCloseTime || '')}" style="font-size:15px;padding:6px 10px" />
              <button class="btn sm secondary" type="button" id="clearCutoff" title="Remove the cut-off (open all day)">Clear</button>
            </div>
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-top:8px">Leave blank for <b>no limit</b> — attendance stays open all day (flexible hours). Example: set <b>11:00</b> so anyone after 11:00 must raise a request.</div>
        </div>

        <div class="form-grid">
          <div class="field"><label>In Time (shift start)</label><input type="time" id="workStart" value="${UI.esc(s.workStart)}" /></div>
          <div class="field"><label>Out Time (shift end)</label><input type="time" id="workEnd" value="${UI.esc(s.workEnd)}" /></div>
          <div class="field"><label>Clock-in grace (minutes)</label><input type="number" id="graceMinutes" value="${s.graceMinutes != null ? s.graceMinutes : 30}" /><span class="muted" style="font-size:12px">After In&nbsp;Time + grace, marks are flagged <b>late</b> (they can still mark until the cut-off above).</span></div>
          <div class="field"><label>Full Day Hours (≥ = Present)</label><input type="number" step="0.5" id="fullDayHours" value="${s.fullDayHours}" /></div>
          <div class="field"><label>Half Day Hours (≥ = Half)</label><input type="number" step="0.5" id="halfDayHours" value="${s.halfDayHours}" /><span class="muted" style="font-size:12px">Below this many hours counts as Absent.</span></div>
          <div class="field"><label>Weekend Policy (note)</label><input id="weekendPolicy" value="${UI.esc(s.weekendPolicy)}" placeholder="e.g. sat-sun" /></div>
          <div class="field full"><label>Attendance Google Sheet (published CSV link)</label><input id="attendanceSheetUrl" value="${UI.esc(s.attendanceSheetUrl)}" placeholder="https://docs.google.com/.../pub?output=csv" /><span class="muted" style="font-size:12px">In Google Sheets: File → Share → Publish to web → CSV. Then use "Sync from Google Sheet" on the Attendance page.</span></div>
        </div>
        <div class="field"><label>Working Days</label>
          <div class="checkbox-row">${days.map((d) => `<label><input type="checkbox" class="wd" value="${d[0]}" ${wd.includes(Number(d[0])) ? 'checked' : ''}/> ${d[1]}</label>`).join('')}</div>
        </div>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Leave Types (annual quota per year)</div>
        <p class="muted" style="font-size:12px">Add the leave types employees can apply for. "Paid" types are not deducted from salary. Comp-off quota comes from granted credits.</p>
        <div id="ltList"></div>
        <button class="btn sm secondary mt" id="addLt">+ Add leave type</button>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Salary Rules</div>
        <div class="form-grid">
          <div class="field"><label>Per-day salary basis</label>
            <select id="perDayBasis">
              <option value="working" ${(s.payroll || {}).perDayBasis === 'working' ? 'selected' : ''}>Divide by working days in month</option>
              <option value="calendar" ${(s.payroll || {}).perDayBasis === 'calendar' ? 'selected' : ''}>Divide by calendar days in month</option>
            </select>
          </div>
          <div class="field"><label>Payroll Closing Day</label><input type="number" id="payrollClosingDay" min="1" max="31" value="${s.payrollClosingDay || 30}" /></div>
        </div>
        <div class="checkbox-row">
          <label><input type="checkbox" id="deductAbsent" ${(s.payroll || {}).deductAbsent !== false ? 'checked' : ''}/> Deduct salary for absent days</label>
          <label><input type="checkbox" id="deductUnpaidLeave" ${(s.payroll || {}).deductUnpaidLeave !== false ? 'checked' : ''}/> Deduct for unpaid leave</label>
        </div>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Statutory Deductions</div>
        <p class="muted" style="font-size:12px">Auto-calculated on each payslip. Defaults follow common India rules — adjust to your registration.</p>
        <div class="checkbox-row" style="margin-bottom:8px"><label><input type="checkbox" id="pfEnabled" ${(st.pf || {}).enabled ? 'checked' : ''}/> Provident Fund (PF)</label></div>
        <div class="form-grid">
          <div class="field"><label>PF % (of Basic)</label><input type="number" step="0.01" id="pfPercent" value="${(st.pf || {}).percent != null ? st.pf.percent : 12}" /></div>
          <div class="field"><label>PF Basic cap</label><input type="number" id="pfCap" value="${(st.pf || {}).basisCap != null ? st.pf.basisCap : 15000}" /></div>
        </div>
        <div class="checkbox-row" style="margin:8px 0"><label><input type="checkbox" id="esiEnabled" ${(st.esi || {}).enabled ? 'checked' : ''}/> ESI</label></div>
        <div class="form-grid">
          <div class="field"><label>ESI % (of Gross)</label><input type="number" step="0.01" id="esiPercent" value="${(st.esi || {}).percent != null ? st.esi.percent : 0.75}" /></div>
          <div class="field"><label>ESI applies if gross ≤</label><input type="number" id="esiCap" value="${(st.esi || {}).grossCap != null ? st.esi.grossCap : 21000}" /></div>
        </div>
        <div class="checkbox-row" style="margin:8px 0"><label><input type="checkbox" id="ptEnabled" ${(st.pt || {}).enabled ? 'checked' : ''}/> Professional Tax</label></div>
        <div class="form-grid">
          <div class="field"><label>PT amount / month</label><input type="number" id="ptAmount" value="${(st.pt || {}).amount != null ? st.pt.amount : 200}" /></div>
        </div>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Modules (turn sections on/off)</div>
        <p class="muted" style="font-size:12px">Switch off sections you don't use — they disappear from everyone's menu. Core HR (Employees, Attendance, Leave, Payroll) is always on.</p>
        <div class="checkbox-row">
          ${[['directory', 'Directory'], ['notices', 'Notice Board'], ['holidays', 'Holidays'], ['recognition', 'Recognition'], ['performance', 'Performance'], ['surveys', 'Surveys'], ['helpdesk', 'Helpdesk'], ['assets', 'Assets'], ['loans', 'Loans & Advances'], ['reimbursement', 'Reimbursements'], ['recruitment', 'Recruitment'], ['offboarding', 'Offboarding / Exits'], ['timesheets', 'Timesheets']]
            .map(([k, label]) => `<label><input type="checkbox" class="mod" value="${k}" ${(s.modules || {})[k] !== false ? 'checked' : ''}/> ${label}</label>`).join('')}
        </div>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Leave Accrual & Carry-forward</div>
        <p class="muted" style="font-size:12px">When on, paid leave is <b>earned monthly</b> instead of given as a flat yearly quota. Set how many days accrue per month and the maximum that can carry into next year.</p>
        <div class="checkbox-row" style="margin-bottom:10px"><label><input type="checkbox" id="accEnabled" ${(s.leaveAccrual || {}).enabled ? 'checked' : ''}/> Enable monthly accrual</label></div>
        <table style="width:100%;font-size:13px">
          <thead><tr><th style="text-align:left">Leave Type</th><th>Days / month</th><th>Carry-forward cap</th></tr></thead>
          <tbody>
            ${(s.leaveTypes || []).filter((t) => t.paid !== false && t.code !== 'unpaid' && t.code !== 'comp_off').map((t) => {
              const r = ((s.leaveAccrual || {}).rules || {})[t.code] || {};
              return `<tr data-acc-code="${UI.esc(t.code)}">
                <td>${UI.esc(t.name)}</td>
                <td style="text-align:center"><input type="number" step="0.5" min="0" class="acc-pm" value="${r.perMonth != null ? r.perMonth : ''}" placeholder="0" style="width:90px" /></td>
                <td style="text-align:center"><input type="number" step="0.5" min="0" class="acc-cap" value="${r.carryCap != null ? r.carryCap : ''}" placeholder="0" style="width:90px" /></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div class="btn-row mt">
          <button class="btn sm secondary" id="runAccrual" type="button">▶ Run accrual for this year</button>
          <button class="btn sm secondary" id="runCarry" type="button">↪ Carry forward last year</button>
        </div>
        <p class="muted" style="font-size:11px;margin-top:6px">Save first, then "Run accrual" tops up every employee for each month of the year (safe to click repeatedly).</p>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Attendance Location (Geofence)</div>
        <p class="muted" style="font-size:12px">Capture each employee's GPS location when they mark attendance. If you set an office location, marks are flagged as inside/outside the radius (it never blocks marking).</p>
        <div class="checkbox-row" style="margin-bottom:10px"><label><input type="checkbox" id="geoEnabled" ${(s.geofence || {}).enabled ? 'checked' : ''}/> Enable office geofence check</label></div>
        <div class="form-grid">
          <div class="field"><label>Office Latitude</label><input id="geoLat" value="${(s.geofence || {}).lat != null ? UI.esc(String(s.geofence.lat)) : ''}" placeholder="e.g. 28.6139" /></div>
          <div class="field"><label>Office Longitude</label><input id="geoLng" value="${(s.geofence || {}).lng != null ? UI.esc(String(s.geofence.lng)) : ''}" placeholder="e.g. 77.2090" /></div>
          <div class="field"><label>Radius (metres)</label><input type="number" id="geoRadius" value="${(s.geofence || {}).radius != null ? s.geofence.radius : 200}" /></div>
          <div class="field" style="align-self:end"><button class="btn sm secondary" id="geoHere" type="button">📍 Use my current location</button></div>
        </div>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Birthday Wishes</div>
        <p class="muted" style="font-size:12px">Automatically email a warm birthday wish to each employee on their birthday — sent only to them, from your company. (Uses each employee's Date of Birth.)</p>
        <div class="checkbox-row" style="margin-bottom:8px"><label><input type="checkbox" id="birthdayEmails" ${s.birthdayEmails !== false ? 'checked' : ''}/> Send automatic birthday emails</label></div>
        <button class="btn sm secondary" id="birthdaySendNow" type="button">🎂 Send today's wishes now</button>
        <span class="muted" id="birthdayToday" style="font-size:12px;margin-left:8px"></span>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">⚙️ Automation <span class="muted" style="font-size:12px">(runs on its own — works even when you're away)</span></div>
        <p class="muted" style="font-size:12px">These recurring HR jobs run automatically every day — no clicks needed. Switch any off if you'd rather do it manually.</p>
        <div class="checkbox-row" style="margin-bottom:6px"><label><input type="checkbox" id="autoEnabled" ${(s.automation || {}).enabled !== false ? 'checked' : ''}/> <b>Master switch — run daily automations</b></label></div>
        <div class="checkbox-row" style="padding-left:18px">
          <label><input type="checkbox" class="auto-job" value="birthdays" ${(s.automation || {}).birthdays !== false ? 'checked' : ''}/> 🎂 Birthday wishes</label>
          <label><input type="checkbox" class="auto-job" value="anniversaries" ${(s.automation || {}).anniversaries !== false ? 'checked' : ''}/> 🎊 Work-anniversary wishes</label>
          <label><input type="checkbox" class="auto-job" value="holidayReminders" ${(s.automation || {}).holidayReminders !== false ? 'checked' : ''}/> 📅 Holiday reminders</label>
          <label><input type="checkbox" class="auto-job" value="leaveAccrual" ${(s.automation || {}).leaveAccrual !== false ? 'checked' : ''}/> 🌴 Monthly leave accrual + year-end carry-forward</label>
          <label><input type="checkbox" class="auto-job" value="slackBackupSync" ${(s.automation || {}).slackBackupSync ? 'checked' : ''}/> 💬 Slack attendance backup sync</label>
        </div>
        <div class="btn-row mt"><button class="btn sm secondary" id="autoRunNow" type="button">▶ Run automations now</button></div>
        <div class="muted" id="autoStatus" style="font-size:12px;margin-top:8px"></div>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">🤖 AI Assistant</div>
        <p class="muted" style="font-size:12px">Turn on the AI copilot — it answers questions from your HRMS data, drafts announcements & job posts, suggests approve/reject on pending requests, and screens candidates. Pick a provider (Google &amp; Groq are <b>free</b>; or use your own Azure OpenAI), get a key from the link, and paste it below.</p>
        <div class="checkbox-row" style="margin-bottom:10px"><label><input type="checkbox" id="aiEnabled" ${(s.ai || {}).enabled !== false ? 'checked' : ''}/> Enable AI features</label></div>
        <div class="form-grid">
          <div class="field"><label>Provider</label><select id="aiProvider" style="width:100%"></select></div>
          <div class="field"><label>Model / Deployment</label><input id="aiModel" list="aiModelList" style="width:100%" autocomplete="off" /><datalist id="aiModelList"></datalist></div>
          <div class="field full" id="aiEndpointWrap" style="display:none"><label>Azure Endpoint</label><input id="aiEndpoint" value="${UI.esc((s.ai || {}).endpoint || '')}" placeholder="https://your-resource.openai.azure.com/openai/v1" autocomplete="off" /></div>
          <div class="field full"><label>API Key</label><input id="aiKey" type="password" value="${UI.esc((s.ai || {}).apiKey || '')}" placeholder="paste your key here" autocomplete="off" />
            <span class="muted" id="aiKeyHint" style="font-size:11px"></span></div>
        </div>
        <button class="btn sm secondary" id="aiTest" type="button">✨ Test the AI</button>
        <span class="muted" id="aiTestOut" style="font-size:12px;margin-left:8px"></span>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Mandatory Documents</div>
        <p class="muted" style="font-size:12px">One document name per line. These show as a required checklist (✓ uploaded / Missing) on every employee's Documents.</p>
        <textarea id="requiredDocs" rows="8">${(s.requiredDocs || []).join('\n')}</textarea>
        <div class="field mt"><label>UIDAI Public Certificate (for automatic Aadhaar verification)</label>
          <textarea id="uidaiCert" rows="5" placeholder="-----BEGIN CERTIFICATE-----&#10;...paste UIDAI's offline e-KYC public certificate (PEM)...&#10;-----END CERTIFICATE-----">${UI.esc(s.uidaiCert || '')}</textarea>
          <span class="muted" style="font-size:12px">Paste UIDAI's public certificate so the app can auto-verify Offline e-KYC files. Until set, Aadhaar files are parsed but the signature is not confirmed.</span>
        </div>
      </div>
      <div class="card mt" style="max-width:760px">
        <div class="section-title">Slack Attendance</div>
        <p class="muted" style="font-size:12px">Employees post their status in a Slack channel (e.g. <i>present</i>, <i>WFH</i>, <i>leave</i>) and it syncs here. The bot also reacts 👍 to valid messages and ❌ + a reminder to unreadable ones. <b>Scopes needed:</b> channels:history, chat:write, reactions:write, users:read, users:read.email.</p>
        <div class="checkbox-row" style="margin-bottom:10px"><label><input type="checkbox" id="slackEnabled" ${(s.slack || {}).enabled ? 'checked' : ''}/> Enable Slack integration</label></div>
        <div class="form-grid">
          <div class="field"><label>Bot Token (xoxb-…)</label><input id="slackToken" value="${UI.esc((s.slack || {}).botToken || '')}" placeholder="xoxb-..." /></div>
          <div class="field"><label>Channel ID</label><input id="slackChannel" value="${UI.esc((s.slack || {}).channelId || '')}" placeholder="C0XXXXXXX" /></div>
          <div class="field full"><label>Signing Secret <span style="color:#9ca3af;font-weight:400">(for real-time events — optional)</span></label><input id="slackSigning" value="${UI.esc((s.slack || {}).signingSecret || '')}" placeholder="from Slack app → Basic Information" /></div>
          <div class="field full"><label>"Present" keywords</label><input id="slackPresent" value="${UI.esc(((s.slack || {}).presentKeywords || ['in','present','wfo','office','working','available']).join(', '))}" /></div>
          <div class="field full"><label>"Work from home" keywords</label><input id="slackWfh" value="${UI.esc(((s.slack || {}).wfhKeywords || ['wfh','work from home','remote']).join(', '))}" /></div>
          <div class="field full"><label>"Half day" keywords</label><input id="slackHalf" value="${UI.esc(((s.slack || {}).halfKeywords || []).join(', '))}" /></div>
          <div class="field full"><label>"Leave" keywords</label><input id="slackLeave" value="${UI.esc(((s.slack || {}).leaveKeywords || []).join(', '))}" /></div>
          <div class="field full"><label>"Absent" keywords</label><input id="slackAbsent" value="${UI.esc(((s.slack || {}).absentKeywords || ['absent']).join(', '))}" /></div>
        </div>
        <div class="checkbox-row" style="margin-top:10px">
          <label><input type="checkbox" id="slackAutoReact" ${(s.slack || {}).autoReact !== false ? 'checked' : ''}/> React 👍 / ❌ to messages</label>
          <label><input type="checkbox" id="slackNotify" ${(s.slack || {}).notifyOnInvalid !== false ? 'checked' : ''}/> Reply to unreadable messages with a reminder</label>
        </div>
        <p class="muted" style="font-size:12px;margin-top:10px"><b>Real-time:</b> point your Slack app's Event Subscription Request URL to <code>YOUR_PUBLIC_URL/api/slack/events</code> (subscribe to <code>message.channels</code>). For manual pull, use <b>Attendance → Import → Sync from Slack</b>. Employees are matched by Slack email = HR email, or a Slack ID on the employee.</p>
      </div>

      <div class="card mt" style="max-width:760px">
        <div class="section-title">🔐 Account provisioning by department</div>
        <p class="muted" style="font-size:12px">When a new hire is onboarded, their manager and HR/IT get an alert to create these accounts, and the items are added to the onboarding checklist. One department per line as <code>Department: account1, account2, …</code>. The <code>default</code> line is used for any department not listed.</p>
        <div class="field">
          <textarea id="departmentAccounts" rows="9" style="font-family:monospace;font-size:12px;white-space:pre">${UI.esc(daText)}</textarea>
        </div>
        <div class="field" style="max-width:280px;margin-top:10px">
          <label>Pre-boarding link validity (hours)</label>
          <input id="preboardLinkHours" type="number" min="1" max="720" value="${UI.esc(s.preboardLinkHours != null ? s.preboardLinkHours : 4)}" />
          <p class="muted" style="font-size:11px;margin:4px 0 0">How long a candidate's pre-boarding link stays usable after it's generated. After this it stops working and HR regenerates it.</p>
        </div>
      </div>

      <div class="card mt" style="max-width:760px">
        <div class="section-title">🔗 Attendance Webhook (for trusted systems)</div>
        <p class="muted" style="font-size:12px">Let an external system push attendance straight into HRMS. It must send a <code>POST</code> with the secret below in the <code>X-Webhook-Secret</code> header. Re-sending for the same person + day updates the existing record (no duplicates).</p>
        <div class="field">
          <label>Endpoint URL</label>
          <div class="btn-row" style="align-items:center">
            <input id="whUrl" readonly value="${UI.esc((window.location.origin) + '/api/webhook/attendance')}" />
            <button class="btn sm" type="button" id="whCopyUrl">Copy</button>
          </div>
        </div>
        <div class="field">
          <label>Webhook Secret</label>
          <div class="btn-row" style="align-items:center">
            <input id="whSecret" readonly type="password" value="${UI.esc(s.webhookSecret || '')}" />
            <button class="btn sm" type="button" id="whShow">Show</button>
            <button class="btn sm" type="button" id="whCopySecret">Copy</button>
            <button class="btn sm red" type="button" id="whRegen">Regenerate</button>
          </div>
          <p class="muted" style="font-size:11px;margin-top:4px">Keep this private. Regenerating immediately invalidates the old secret.</p>
        </div>
        <div class="field">
          <label>Example payload</label>
          <pre style="background:#0d1117;color:#c9d1d9;padding:10px;border-radius:6px;overflow:auto;font-size:12px;margin:0">{
  "name": "Ankit Singh Rawat",
  "status": "WFH",
  "time": "2026-06-09T10:00:00Z"
}</pre>
          <p class="muted" style="font-size:11px;margin-top:6px">Statuses: <code>Present</code>, <code>Absent</code>, <code>WFH</code>, <code>Holiday</code>. Responses: <code>200</code> success · <code>401</code> bad secret · <code>404</code> unknown employee · <code>400</code> bad payload.</p>
        </div>
      </div>

      <div class="btn-row mt"><button class="btn" id="save">Save Settings</button></div>
      ${App.user.role === 'SUPER_ADMIN' ? '<div id="accessCard" class="mt"></div>' : ''}`;

    if (App.user.role === 'SUPER_ADMIN') this.accessControlCard();

    // ----- Attendance webhook card -----
    const whSecret = document.getElementById('whSecret');
    const copyText = async (text, msg) => {
      try { await navigator.clipboard.writeText(text); UI.toast(msg, 'success'); }
      catch { UI.toast('Copy failed — select and copy manually.', 'error'); }
    };
    const whCopyUrl = document.getElementById('whCopyUrl');
    if (whCopyUrl) whCopyUrl.onclick = () => copyText(document.getElementById('whUrl').value, 'Endpoint URL copied.');
    const whCopySecret = document.getElementById('whCopySecret');
    if (whCopySecret) whCopySecret.onclick = () => copyText(whSecret.value, 'Secret copied.');
    const whShow = document.getElementById('whShow');
    if (whShow) whShow.onclick = () => {
      const hidden = whSecret.type === 'password';
      whSecret.type = hidden ? 'text' : 'password';
      whShow.textContent = hidden ? 'Hide' : 'Show';
    };
    const whRegen = document.getElementById('whRegen');
    if (whRegen) whRegen.onclick = async () => {
      if (!confirm('Generate a new secret? Any system using the current secret will stop working until you give it the new one.')) return;
      const bytes = new Uint8Array(24);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      const next = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      try {
        await api.put('/settings', { webhookSecret: next });
        whSecret.value = next; whSecret.type = 'text';
        if (whShow) whShow.textContent = 'Hide';
        UI.toast('New webhook secret generated.', 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
    };

    document.getElementById('logo').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('logo', f);
      try { await api.upload('/settings/logo', fd); UI.toast('Logo uploaded.', 'success'); this.settings(c); }
      catch (err) { UI.toast(err.message, 'error'); }
    };

    // Leave types editor
    const syncLt = () => {
      document.querySelectorAll('#ltList [data-lt]').forEach((el) => {
        const i = +el.dataset.lt, f = el.dataset.f;
        if (!ltState[i]) return;
        if (f === 'paid') ltState[i].paid = el.checked;
        else if (f === 'quota') ltState[i].quota = Number(el.value) || 0;
        else ltState[i][f] = el.value;
      });
    };
    const renderLt = () => {
      document.getElementById('ltList').innerHTML = ltState.map((t, i) => `
        <div class="btn-row" style="margin-bottom:6px;align-items:center">
          <input data-lt="${i}" data-f="name" value="${UI.esc(t.name)}" placeholder="Name" />
          <input data-lt="${i}" data-f="code" value="${UI.esc(t.code)}" placeholder="code" style="max-width:110px" />
          <input data-lt="${i}" data-f="quota" type="number" value="${t.quota}" placeholder="Quota" style="max-width:90px" />
          <label style="display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" data-lt="${i}" data-f="paid" ${t.paid ? 'checked' : ''} style="width:auto"/> Paid</label>
          <button class="btn sm red" data-rmlt="${i}">✕</button>
        </div>`).join('');
      document.querySelectorAll('[data-rmlt]').forEach((b) => b.onclick = () => { syncLt(); ltState.splice(+b.dataset.rmlt, 1); renderLt(); });
    };
    renderLt();
    document.getElementById('addLt').onclick = () => { syncLt(); ltState.push({ code: '', name: '', quota: 0, paid: true }); renderLt(); };

    const clearCutoff = document.getElementById('clearCutoff');
    if (clearCutoff) clearCutoff.onclick = () => { const el = document.getElementById('attendanceCloseTime'); if (el) el.value = ''; };

    document.getElementById('save').onclick = async () => {
      syncLt();
      const payload = {
        companyName: val('companyName'), legalName: val('legalName'), gst: val('gst'),
        cin: val('cin'), pan: val('pan'), currency: val('currency'),
        email: val('email'), phone: val('phone'), website: val('website'),
        address: val('address'), slipFooter: val('slipFooter'),
        workStart: val('workStart'), workEnd: val('workEnd'), weekendPolicy: val('weekendPolicy'),
        attendanceSheetUrl: val('attendanceSheetUrl'),
        fullDayHours: Number(val('fullDayHours')), halfDayHours: Number(val('halfDayHours')), graceMinutes: Number(val('graceMinutes')),
        attendanceCloseTime: val('attendanceCloseTime'),
        workingDays: Array.from(document.querySelectorAll('.wd:checked')).map((x) => Number(x.value)),
        leaveTypes: ltState.filter((t) => t.code && t.name),
        payrollClosingDay: Number(val('payrollClosingDay')),
        requiredDocs: val('requiredDocs').split('\n').map((x) => x.trim()).filter(Boolean),
        uidaiCert: val('uidaiCert').trim(),
        departmentAccounts: (() => {
          const out = {};
          val('departmentAccounts').split('\n').forEach((line) => {
            const i = line.indexOf(':'); if (i < 0) return;
            const dept = line.slice(0, i).trim(); if (!dept) return;
            out[dept] = line.slice(i + 1).split(',').map((x) => x.trim()).filter(Boolean);
          });
          return out;
        })(),
        preboardLinkHours: Number(val('preboardLinkHours')) || 4,
        payroll: {
          perDayBasis: val('perDayBasis'),
          deductAbsent: document.getElementById('deductAbsent').checked,
          deductUnpaidLeave: document.getElementById('deductUnpaidLeave').checked,
        },
        statutory: {
          pf: { enabled: document.getElementById('pfEnabled').checked, percent: Number(val('pfPercent')), basisCap: Number(val('pfCap')) },
          esi: { enabled: document.getElementById('esiEnabled').checked, percent: Number(val('esiPercent')), grossCap: Number(val('esiCap')) },
          pt: { enabled: document.getElementById('ptEnabled').checked, amount: Number(val('ptAmount')) },
        },
        modules: (() => {
          const all = ['directory', 'notices', 'holidays', 'recognition', 'performance', 'surveys', 'helpdesk', 'assets', 'loans', 'reimbursement', 'recruitment', 'offboarding', 'timesheets'];
          const on = new Set(Array.from(document.querySelectorAll('.mod:checked')).map((x) => x.value));
          const m = {}; all.forEach((k) => { m[k] = on.has(k); }); return m;
        })(),
        slack: {
          enabled: document.getElementById('slackEnabled').checked,
          botToken: val('slackToken').trim(),
          channelId: val('slackChannel').trim(),
          signingSecret: val('slackSigning').trim(),
          presentKeywords: val('slackPresent').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
          wfhKeywords: val('slackWfh').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
          halfKeywords: val('slackHalf').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
          leaveKeywords: val('slackLeave').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
          absentKeywords: val('slackAbsent').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
          autoReact: document.getElementById('slackAutoReact').checked,
          notifyOnInvalid: document.getElementById('slackNotify').checked,
          validReaction: ((s.slack || {}).validReaction) || 'thumbsup',
          invalidReaction: ((s.slack || {}).invalidReaction) || 'x',
        },
        leaveAccrual: (() => {
          const rules = {};
          document.querySelectorAll('[data-acc-code]').forEach((tr) => {
            const code = tr.getAttribute('data-acc-code');
            const pm = Number(tr.querySelector('.acc-pm').value) || 0;
            const cap = Number(tr.querySelector('.acc-cap').value) || 0;
            if (pm > 0 || cap > 0) rules[code] = { perMonth: pm, carryCap: cap };
          });
          return { enabled: document.getElementById('accEnabled').checked, rules };
        })(),
        geofence: {
          enabled: document.getElementById('geoEnabled').checked,
          lat: val('geoLat').trim() === '' ? null : Number(val('geoLat')),
          lng: val('geoLng').trim() === '' ? null : Number(val('geoLng')),
          radius: Number(val('geoRadius')) || 200,
        },
        birthdayEmails: document.getElementById('birthdayEmails').checked,
        ai: {
          enabled: document.getElementById('aiEnabled').checked,
          provider: val('aiProvider'),
          apiKey: val('aiKey').trim(),
          model: val('aiModel').trim(),
          endpoint: (document.getElementById('aiEndpoint') ? val('aiEndpoint').trim() : ''),
        },
        automation: (() => {
          const on = new Set(Array.from(document.querySelectorAll('.auto-job:checked')).map((x) => x.value));
          return {
            enabled: document.getElementById('autoEnabled').checked,
            birthdays: on.has('birthdays'),
            anniversaries: on.has('anniversaries'),
            holidayReminders: on.has('holidayReminders'),
            leaveAccrual: on.has('leaveAccrual'),
            slackBackupSync: on.has('slackBackupSync'),
          };
        })(),
      };
      try { await api.put('/settings', payload); UI.currency = payload.currency || UI.currency; UI.toast('Settings saved. Reloading menu…', 'success'); setTimeout(() => location.reload(), 800); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    function val(id) { return document.getElementById(id).value; }

    // Leave-accrual action buttons.
    const runAcc = document.getElementById('runAccrual');
    if (runAcc) runAcc.onclick = async () => {
      try { const r = await api.post('/leave/accrual/run', {}); UI.toast(`Accrual done — ${r.accrued} new entries through month ${r.upToMonth || ''}.`, 'success'); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    const runCarry = document.getElementById('runCarry');
    if (runCarry) runCarry.onclick = async () => {
      const year = new Date().getFullYear() - 1;
      if (!confirm(`Carry forward remaining balances from ${year} into ${year + 1} (capped)?`)) return;
      try { const r = await api.post('/leave/accrual/carry-forward', { year }); UI.toast(`Carried forward for ${r.carried} employee-types.`, 'success'); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    const geoHere = document.getElementById('geoHere');
    if (geoHere) geoHere.onclick = () => {
      if (!navigator.geolocation) return UI.toast('Geolocation not available in this browser.', 'error');
      geoHere.textContent = '📍 Locating…';
      navigator.geolocation.getCurrentPosition(
        (p) => { document.getElementById('geoLat').value = p.coords.latitude.toFixed(6); document.getElementById('geoLng').value = p.coords.longitude.toFixed(6); geoHere.textContent = '📍 Use my current location'; UI.toast('Location filled in. Click Save to keep it.', 'success'); },
        () => { geoHere.textContent = '📍 Use my current location'; UI.toast('Could not get your location.', 'error'); },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    };

    // Birthday wishes — show who's celebrating today + a manual send.
    const bToday = document.getElementById('birthdayToday');
    if (bToday) api.get('/birthdays/today').then((r) => {
      bToday.textContent = r.birthdays.length ? `🎂 Today: ${r.birthdays.map((b) => b.name).join(', ')}` : 'No birthdays today.';
    }).catch(() => {});
    const bSend = document.getElementById('birthdaySendNow');
    if (bSend) bSend.onclick = async () => {
      try { const r = await api.post('/birthdays/send', {}); UI.toast(r.found ? `🎂 ${r.sent} wish(es) sent, ${r.skipped} already sent.` : 'No birthdays today.', 'success'); }
      catch (e) { UI.toast(e.message, 'error'); }
    };

    // Automation status + manual run.
    const autoStatus = document.getElementById('autoStatus');
    const showAutoStatus = (st) => {
      if (!autoStatus) return;
      if (st && st.lastRunAt) autoStatus.innerHTML = `✅ Last run: <b>${UI.esc(String(st.lastRunAt))}</b>` + (st.lastRunDate ? ` <span class="muted">(${UI.esc(st.lastRunDate)})</span>` : '');
      else autoStatus.textContent = 'Has not run yet — it runs automatically on the first activity each day.';
    };
    if (autoStatus) api.get('/automation/status').then((r) => showAutoStatus(r.state)).catch(() => {});
    // Populate AI provider + model dropdowns from the live catalogue.
    (async () => {
      const provSel = document.getElementById('aiProvider');
      const modelSel = document.getElementById('aiModel');
      const hint = document.getElementById('aiKeyHint');
      if (!provSel) return;
      let cat;
      try { cat = (await api.get('/ai/status')).providers; } catch (e) { return; }
      const curProvider = (s.ai || {}).provider || 'google';
      const curModel = (s.ai || {}).model;
      provSel.innerHTML = cat.map((p) => `<option value="${p.id}" ${p.id === curProvider ? 'selected' : ''}>${UI.esc(p.label)}</option>`).join('');
      const dataList = document.getElementById('aiModelList');
      const endpointWrap = document.getElementById('aiEndpointWrap');
      const fillModels = (pid, selModel) => {
        const p = cat.find((x) => x.id === pid) || cat[0];
        dataList.innerHTML = p.models.map((m) => `<option value="${UI.esc(m.id)}">${UI.esc(m.label)}</option>`).join('');
        modelSel.value = selModel || p.models[0].id;
        hint.innerHTML = `${UI.esc(p.keyHint)} <a href="${p.keyUrl}" target="_blank" rel="noopener"><b>Get a key →</b></a>`;
        if (endpointWrap) endpointWrap.style.display = p.needsEndpoint ? '' : 'none';
      };
      fillModels(curProvider, curModel);
      provSel.onchange = () => fillModels(provSel.value, null);
    })();

    const aiTest = document.getElementById('aiTest');
    if (aiTest) aiTest.onclick = async () => {
      const out = document.getElementById('aiTestOut');
      out.textContent = 'Save settings first if you just pasted the key…';
      aiTest.disabled = true;
      try {
        const r = await api.post('/ai/chat', { question: 'In one short sentence, confirm you are connected and ready to help with HR.' });
        out.innerHTML = '✅ ' + UI.esc(r.answer || 'Connected.');
      } catch (e) { out.innerHTML = '❌ ' + UI.esc(e.message); }
      aiTest.disabled = false;
    };
    const autoRun = document.getElementById('autoRunNow');
    if (autoRun) autoRun.onclick = async () => {
      autoRun.disabled = true; autoRun.textContent = '⏳ Running…';
      try {
        const r = await api.post('/automation/run', {});
        const res = r.results || {};
        const bits = [];
        if (res.birthdays) bits.push(`🎂 ${res.birthdays.sent || 0} birthday`);
        if (res.anniversaries) bits.push(`🎊 ${res.anniversaries.sent || 0} anniversary`);
        if (res.holidays) bits.push(`📅 ${res.holidays.notified || 0} holiday`);
        if (res.accrual) bits.push(`🌴 ${res.accrual.accrued || 0} accrual`);
        UI.toast('Automations ran. ' + (bits.join(' · ') || 'Nothing due right now.'), 'success');
        api.get('/automation/status').then((s) => showAutoStatus(s.state)).catch(() => {});
      } catch (e) { UI.toast(e.message, 'error'); }
      autoRun.disabled = false; autoRun.textContent = '▶ Run automations now';
    };
  },

  // ---------------- Access Control matrix (Super Admin only) ----------------
  async accessControlCard() {
    const host = document.getElementById('accessCard');
    if (!host) return;
    let data;
    try { data = await api.get('/settings/access'); } catch (e) { host.innerHTML = ''; return; }
    const editable = data.roles.filter((r) => r !== 'SUPER_ADMIN');
    const has = (role, key) => (data.matrix[role] || []).includes('*') || (data.matrix[role] || []).includes(key);

    const head = `<tr><th>Permission</th><th>Super Admin</th>${editable.map((r) => `<th>${UI.esc(data.labels[r] || r)}</th>`).join('')}</tr>`;
    const rows = data.permissions.map((p) => `
      <tr>
        <td><b>${UI.esc(p.label)}</b><br/><span class="muted" style="font-size:11px">${UI.esc(p.group)}</span></td>
        <td style="text-align:center"><input type="checkbox" checked disabled title="Super Admin always has full access" style="width:auto"/></td>
        ${editable.map((r) => `<td style="text-align:center"><input type="checkbox" class="accbox" data-role="${r}" data-perm="${p.key}" ${has(r, p.key) ? 'checked' : ''} style="width:auto"/></td>`).join('')}
      </tr>`).join('');

    host.innerHTML = `
      <div class="card" style="max-width:900px">
        <div class="section-title">🔐 Access Control (who can do what)</div>
        <p class="muted" style="font-size:12px">Tick what each role is allowed to do. Super Admin always has full access and can't be changed. Changes apply to users the next time they sign in.</p>
        <div class="table-wrap"><table>${head}${rows}</table></div>
        <div class="btn-row mt"><button class="btn" id="saveAccess">Save Access Control</button></div>
      </div>`;

    host.querySelector('#saveAccess').onclick = async () => {
      const rolePermissions = {};
      editable.forEach((r) => { rolePermissions[r] = []; });
      host.querySelectorAll('.accbox:checked').forEach((b) => rolePermissions[b.dataset.role].push(b.dataset.perm));
      try { await api.put('/settings/access', { rolePermissions }); UI.toast('Access control saved.', 'success'); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  // ---------------- Staff Directory ----------------
  async directory(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { employees } = await api.get('/employees/directory');
    c.innerHTML = `
      <div class="toolbar">
        <input id="search" placeholder="Search name / dept / designation..." />
        <div class="spacer"></div>
        <button class="btn sm secondary" id="viewList">☰ List</button>
        <button class="btn sm secondary" id="viewChart">🌳 Org Chart</button>
        <span class="muted">${employees.length} people</span>
      </div>
      <div id="list"></div>`;

    const renderList = (rows) => {
      document.getElementById('list').innerHTML = UI.table([
        { key: 'name', label: 'Name', render: (r) => `<div style="display:flex;align-items:center;gap:10px"><span class="avatar sm">${UI.esc(App.initials(r.name))}</span><span><b>${UI.esc(r.name)}</b><br/><span class="muted" style="font-size:12px">${UI.esc(r.emp_code || '')}</span></span></div>` },
        { key: 'designation', label: 'Designation', render: (r) => UI.esc(r.designation || '-') },
        { key: 'department', label: 'Department', render: (r) => UI.esc(r.department || '-') },
        { key: 'manager_name', label: 'Manager', render: (r) => UI.esc(r.manager_name || '-') },
        { key: 'email', label: 'Email', render: (r) => r.email ? `<a href="mailto:${UI.esc(r.email)}">${UI.esc(r.email)}</a>` : '-' },
        { key: 'phone', label: 'Phone', render: (r) => UI.esc(r.phone || '-') },
      ], rows, 'No employees.');
    };

    // Org chart: nested boxes built from manager_id (roots = no active manager).
    const renderChart = () => {
      const byId = {}; employees.forEach((e) => { byId[e.id] = e; });
      const childrenOf = {}; const roots = [];
      employees.forEach((e) => {
        if (e.manager_id && byId[e.manager_id]) (childrenOf[e.manager_id] = childrenOf[e.manager_id] || []).push(e);
        else roots.push(e);
      });
      const node = (e, depth) => {
        const kids = childrenOf[e.id] || [];
        return `<div style="margin:6px 0 6px ${depth ? 26 : 0}px;${depth ? 'border-left:2px solid #e2e8f0;padding-left:14px;' : ''}">
          <div class="card" style="display:inline-flex;align-items:center;gap:10px;padding:9px 14px;margin:0">
            <span class="avatar sm">${UI.esc(App.initials(e.name))}</span>
            <span><b>${UI.esc(e.name)}</b> <span class="muted" style="font-size:12px">${UI.esc(e.designation || '')}${e.department ? ' · ' + UI.esc(e.department) : ''}</span>
            ${kids.length ? `<span class="tag" style="margin-left:6px;font-size:10px">${kids.length} report${kids.length > 1 ? 's' : ''}</span>` : ''}</span>
          </div>
          ${kids.map((k) => node(k, depth + 1)).join('')}
        </div>`;
      };
      document.getElementById('list').innerHTML = roots.length
        ? `<div style="overflow-x:auto;padding:4px">${roots.map((r) => node(r, 0)).join('')}</div>`
        : '<div class="empty">No employees.</div>';
    };

    let mode = 'list';
    const setMode = (m) => {
      mode = m;
      document.getElementById('viewList').className = 'btn sm' + (m === 'list' ? '' : ' secondary');
      document.getElementById('viewChart').className = 'btn sm' + (m === 'chart' ? '' : ' secondary');
      if (m === 'list') renderList(employees); else renderChart();
    };
    document.getElementById('viewList').onclick = () => setMode('list');
    document.getElementById('viewChart').onclick = () => setMode('chart');
    document.getElementById('search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      if (mode !== 'list') setMode('list');
      renderList(employees.filter((x) => [x.name, x.department, x.designation, x.email, x.emp_code].join(' ').toLowerCase().includes(q)));
    };
    setMode('list');
  },

  // ---------------- Announcements / Notice Board ----------------
  async announcements(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const canManage = App.has('settings:manage');
    const { announcements } = await api.get('/announcements');
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Notice Board</div><div class="spacer"></div>${canManage ? '<button class="btn" id="add">Post Announcement</button>' : ''}</div>
      ${canManage ? '<div class="card" style="background:#f0fdf4;border-left:4px solid #16a34a;margin-bottom:16px;padding:12px"><div style="font-size:13px;color:#166534"><strong>💡 Tip:</strong> Announcements posted here will automatically be sent to your Slack channel and emailed to all employees.</div></div>' : ''}
      <div id="list">${announcements.length ? announcements.map((a) => `
        <div class="announcement">
          <h4>${a.pinned ? '📌 ' : ''}${UI.esc(a.title)}</h4>
          <div class="meta">${UI.esc(a.author || 'Admin')} &middot; ${UI.date(a.created_at)}</div>
          <div style="margin-top:6px;white-space:pre-wrap">${UI.esc(a.body || '')}</div>
          ${canManage ? `<div class="mt"><button class="btn sm red" data-del="${a.id}">Delete</button></div>` : ''}
        </div>`).join('') : '<div class="empty">No announcements yet.</div>'}</div>`;
    if (canManage) {
      const add = document.getElementById('add');
      if (add) add.onclick = () => {
        const m = UI.modal({
          title: 'Post Announcement',
          bodyHtml: `
            <div class="field"><label>Title</label><input id="title" /></div>
            <div class="field"><label>Message</label><textarea id="body" rows="4"></textarea></div>
            <div style="display:flex;gap:6px;align-items:center;margin:-4px 0 4px">
              <input id="aiBrief" placeholder="Or describe it and let AI draft… e.g. 'office closed Friday for Diwali'" style="flex:1;font-size:12px" />
              <button class="btn sm secondary" id="aiDraft" type="button">✨ Draft</button>
            </div>
            <label class="checkbox-row"><input type="checkbox" id="pinned" /> Pin to top</label>
            <div style="background:#fef3c7;border-left:4px solid #d97706;padding:10px;margin-top:12px;border-radius:4px;font-size:13px;color:#78350f">
              <strong>📢 Auto-notify:</strong> This announcement will be posted to your Slack group and emailed to all active employees.
            </div>`,
          footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Post</button>`,
        });
        m.root.querySelector('[data-close-btn]').onclick = m.close;
        m.root.querySelector('#aiDraft').onclick = async () => {
          const brief = m.root.querySelector('#aiBrief').value.trim();
          if (!brief) return UI.toast('Type a quick brief for the AI first.', 'error');
          const btn = m.root.querySelector('#aiDraft'); btn.disabled = true; btn.textContent = '✨ Drafting…';
          try {
            const r = await api.post('/ai/draft', { kind: 'announcement', brief });
            const lines = r.text.split('\n').filter(Boolean);
            if (!m.root.querySelector('#title').value && lines.length > 1) { m.root.querySelector('#title').value = lines[0].replace(/^#+\s*/, '').slice(0, 80); m.root.querySelector('#body').value = lines.slice(1).join('\n').trim(); }
            else m.root.querySelector('#body').value = r.text;
            UI.toast('Draft ready — review and edit before posting.', 'success');
          } catch (e) { UI.toast(e.message, 'error'); }
          btn.disabled = false; btn.textContent = '✨ Draft';
        };
        m.root.querySelector('#save').onclick = async () => {
          try { await api.post('/announcements', { title: m.root.querySelector('#title').value, body: m.root.querySelector('#body').value, pinned: m.root.querySelector('#pinned').checked }); m.close(); UI.toast('Posted.', 'success'); this.announcements(c); }
          catch (e) { UI.toast(e.message, 'error'); }
        };
      };
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!confirm('Delete this announcement?')) return;
        try { await api.request('DELETE', '/announcements/' + b.dataset.del); UI.toast('Deleted.', 'success'); this.announcements(c); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
    }
  },

  // ---------------- Holidays ----------------
  async holidays(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const canManage = App.has('settings:manage');
    const year = new Date().getFullYear();
    const { holidays } = await api.get('/holidays?year=' + year);
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Holidays ${year}</div><div class="spacer"></div>${canManage ? '<button class="btn" id="notify">Send Notifications</button>' : ''} ${canManage ? '<button class="btn" id="add">Add Holiday</button>' : ''}</div>
      ${UI.table([
        { key: 'date', label: 'Date', render: (r) => UI.date(r.date) },
        { key: 'day', label: 'Day', render: (r) => new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) },
        { key: 'name', label: 'Holiday' },
        { key: 'type', label: 'Type', render: (r) => UI.esc(r.type || 'public') },
        { key: 'act', label: '', render: (r) => canManage ? `<button class="btn sm red" data-del="${r.id}">Delete</button>` : '' },
      ], holidays, 'No holidays added for this year.')}`;
    if (canManage) {
      document.getElementById('notify').onclick = async () => {
        try {
          UI.toast('Sending holiday notifications...', 'info');
          const { message, holidays: notified } = await api.post('/holiday-notifications/send', {});
          UI.toast(message, 'success');
        } catch (e) {
          UI.toast(e.message, 'error');
        }
      };
      document.getElementById('add').onclick = () => {
        const m = UI.modal({
          title: 'Add Holiday',
          bodyHtml: `
            <div class="field"><label>Date</label><input type="date" id="date" /></div>
            <div class="field"><label>Holiday Name</label><input id="name" placeholder="e.g. Diwali" /></div>
            <div class="field"><label>Type</label><select id="type"><option value="public">Public</option><option value="restricted">Restricted</option><option value="company">Company</option></select></div>`,
          footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Add</button>`,
        });
        m.root.querySelector('[data-close-btn]').onclick = m.close;
        m.root.querySelector('#save').onclick = async () => {
          try { await api.post('/holidays', { date: m.root.querySelector('#date').value, name: m.root.querySelector('#name').value, type: m.root.querySelector('#type').value }); m.close(); UI.toast('Holiday added.', 'success'); this.holidays(c); }
          catch (e) { UI.toast(e.message, 'error'); }
        };
      };
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        try { await api.request('DELETE', '/holidays/' + b.dataset.del); UI.toast('Deleted.', 'success'); this.holidays(c); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
    }
  },

  // ---------------- Assets ----------------
  async assets(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [{ assets }, { employees }] = await Promise.all([api.get('/assets'), api.get('/employees')]);
    const empOpts = '<option value="">— Unassigned —</option>' + employees.map((e) => `<option value="${e.id}">${UI.esc(e.name)}</option>`).join('');
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Assets</div><div class="spacer"></div><button class="btn" id="add">Add Asset</button></div>
      <div id="list"></div>`;
    const render = () => {
      document.getElementById('list').innerHTML = UI.table([
        { key: 'name', label: 'Asset' },
        { key: 'tag', label: 'Tag/Serial', render: (r) => UI.esc(r.tag || '-') },
        { key: 'category', label: 'Category', render: (r) => UI.esc(r.category || '-') },
        { key: 'employee_name', label: 'Assigned To', render: (r) => UI.esc(r.employee_name || '-') },
        { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
        { key: 'act', label: '', render: (r) => `<button class="btn sm secondary" data-edit="${r.id}">Edit</button> <button class="btn sm red" data-del="${r.id}">Delete</button>` },
      ], assets, 'No assets yet.');
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(assets.find((a) => a.id == b.dataset.edit)));
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!confirm('Delete this asset?')) return;
        try { await api.request('DELETE', '/assets/' + b.dataset.del); UI.toast('Deleted.', 'success'); this.assets(c); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
    };
    const form = (asset) => {
      const f = (k) => asset && asset[k] != null ? UI.esc(asset[k]) : '';
      const m = UI.modal({
        title: asset ? 'Edit Asset' : 'Add Asset',
        bodyHtml: `
          <div class="form-grid">
            <div class="field"><label>Name *</label><input id="name" value="${f('name')}" /></div>
            <div class="field"><label>Tag / Serial</label><input id="tag" value="${f('tag')}" /></div>
            <div class="field"><label>Category</label><input id="category" value="${f('category')}" placeholder="Laptop / Phone / ..." /></div>
            <div class="field"><label>Assign To</label><select id="employee_id">${empOpts}</select></div>
            <div class="field full"><label>Notes</label><textarea id="notes" rows="2">${f('notes')}</textarea></div>
          </div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
      });
      if (asset && asset.employee_id) m.root.querySelector('#employee_id').value = asset.employee_id;
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#save').onclick = async () => {
        const data = { name: m.root.querySelector('#name').value, tag: m.root.querySelector('#tag').value, category: m.root.querySelector('#category').value, employee_id: m.root.querySelector('#employee_id').value, notes: m.root.querySelector('#notes').value };
        try {
          if (asset) await api.put('/assets/' + asset.id, data); else await api.post('/assets', data);
          m.close(); UI.toast('Saved.', 'success'); this.assets(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };
    render();
    document.getElementById('add').onclick = () => form(null);
  },

  // ---------------- Documents (shared modal) with mandatory checklist ----------------
  documentsModal(employeeId, name) {
    const required = App.requiredDocs || [];
    const m = UI.modal({
      title: 'Documents' + (name ? ' — ' + name : ''),
      bodyHtml: `<div id="docBody" class="muted">Loading...</div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Close</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;

    const upload = async (file, docType) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('doc_type', docType || '');
      fd.append('title', docType || file.name);
      try { await api.upload(`/employees/${employeeId}/documents`, fd); UI.toast('Uploaded.', 'success'); load(); }
      catch (e) { UI.toast(e.message, 'error'); }
    };

    const canVerify = App.has('employees:write');
    const canSeeId = App.has('employees:read');
    const stChip = (d) => d.status === 'verified' ? '<span class="tag approved">✓ Verified</span>'
      : (d.status === 'rejected' ? '<span class="tag rejected">✗ Rejected</span>' : '<span class="tag pending">⏳ Pending review</span>');
    // Only show verify/reject controls while a document still needs a decision.
    // Verified docs need no action; rejected docs can be re-verified.
    const vActions = (d) => {
      if (!canVerify) return '';
      if (d.status === 'verified') return '';
      if (d.status === 'rejected') return ` <button class="btn sm green" data-verify="${d.id}" title="Mark verified">✓ Verify</button>`;
      return ` <button class="btn sm green" data-verify="${d.id}" title="Mark verified">✓ Verify</button> <button class="btn sm red" data-reject="${d.id}" title="Reject">✗ Reject</button>`;
    };

    const load = async () => {
      const { documents } = await api.get(`/employees/${employeeId}/documents`);
      const byType = {};
      documents.forEach((d) => { if (d.doc_type) byType[d.doc_type] = d; });
      const done = required.filter((t) => byType[t]).length;
      const verified = documents.filter((d) => d.status === 'verified').length;

      const checklist = required.map((t) => {
        const doc = byType[t];
        if (!doc) return `<div class="doc-row"><div class="doc-name">${UI.esc(t)}</div><div><span class="tag rejected">Missing</span></div><div class="doc-act"><label class="btn sm">Upload<input type="file" class="reqfile" data-type="${UI.esc(t)}" style="display:none"/></label></div></div>`;
        return `<div class="doc-row"><div class="doc-name">${UI.esc(t)}</div><div>${stChip(doc)}</div><div class="doc-act"><a class="btn sm secondary" href="/api/employees/${employeeId}/documents/${doc.id}/file" target="_blank">View</a>${vActions(doc)} <button class="btn sm secondary" data-del="${doc.id}">✕</button></div></div>`;
      }).join('');

      const others = documents.filter((d) => !required.includes(d.doc_type));
      const otherRows = others.map((d) => `<div class="doc-row"><div class="doc-name">${UI.esc(d.title || d.doc_type || 'Document')}<br/><span class="muted" style="font-size:11px;font-weight:400">${UI.date(d.uploaded_at)}</span></div><div>${stChip(d)}</div><div class="doc-act"><a class="btn sm secondary" href="/api/employees/${employeeId}/documents/${d.id}/file" target="_blank">View</a>${vActions(d)} <button class="btn sm secondary" data-del="${d.id}">✕</button></div></div>`).join('');

      // Identity checks (number validity + duplicates) — staff only.
      let idPanel = '';
      if (canSeeId) {
        try {
          const v = await api.get(`/employees/${employeeId}/verification`);
          const row = (label, info) => {
            if (!info) return `<div class="doc-row"><div class="doc-name">${label}</div><div class="muted">Not provided</div></div>`;
            const chip = info.valid ? '<span class="tag approved">✓ Valid</span>' : `<span class="tag rejected">Invalid</span>`;
            const reason = (!info.valid && info.reason) ? ` <span class="muted" style="font-size:12px">${UI.esc(info.reason)}</span>` : '';
            const dup = (info.duplicates && info.duplicates.length) ? ` <span class="tag pending">⚠ also on ${UI.esc(info.duplicates.join(', '))}</span>` : '';
            return `<div class="doc-row"><div class="doc-name">${label}<br/><span class="muted" style="font-size:11px;font-weight:400">${UI.esc(info.value || '')}</span></div><div>${chip}${reason}${dup}</div></div>`;
          };
          const extraDup = [];
          if (v.emailDuplicates && v.emailDuplicates.length) extraDup.push(`Email also on: ${UI.esc(v.emailDuplicates.join(', '))}`);
          if (v.phoneDuplicates && v.phoneDuplicates.length) extraDup.push(`Phone also on: ${UI.esc(v.phoneDuplicates.join(', '))}`);
          idPanel = `
            <div class="section-title">Identity Checks <span class="muted" style="font-weight:400;font-size:12px">(number format & duplicates)</span></div>
            <div class="doc-list" style="margin-bottom:10px">
              ${row('PAN', v.pan)}${row('Aadhaar', v.aadhaar)}${row('Bank IFSC', v.ifsc)}
              ${extraDup.length ? `<div class="doc-row"><div class="doc-name" style="color:var(--red)">⚠ ${extraDup.join(' · ')}</div></div>` : ''}
            </div>
            ${canVerify ? `<div class="btn-row" style="margin-bottom:16px"><label class="btn sm">🔒 Auto-verify Aadhaar (UIDAI Offline e-KYC)<input type="file" id="aadhaarVerifyFile" accept=".xml" style="display:none"/></label><span class="muted" style="font-size:11px;align-self:center">Upload the resident's UIDAI Offline e-KYC XML — the app checks UIDAI's digital signature.</span></div>` : ''}`;
        } catch (e) { /* ignore */ }
      }

      m.root.querySelector('#docBody').innerHTML = `
        ${idPanel}
        ${required.length ? `
          <div class="section-title">Mandatory Documents <span class="muted" style="font-weight:400">(${done}/${required.length} uploaded · ${verified} verified)</span></div>
          <div class="doc-list" style="margin-bottom:16px">${checklist}</div>` : ''}
        <div class="section-title">Other Documents</div>
        <div class="doc-list">${otherRows || '<div class="muted" style="padding:14px">No other documents.</div>'}</div>
        <div class="btn-row mt">
          <label class="btn secondary">Upload Other Document<input type="file" id="otherfile" style="display:none"/></label>
          <input id="othertitle" placeholder="Document name" style="width:auto" />
        </div>`;

      m.root.querySelectorAll('.reqfile').forEach((inp) => inp.onchange = (e) => { const f = e.target.files[0]; if (f) upload(f, inp.dataset.type); });
      m.root.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        try { await api.request('DELETE', `/employees/${employeeId}/documents/${b.dataset.del}`); load(); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
      m.root.querySelectorAll('[data-verify]').forEach((b) => b.onclick = async () => {
        try { await api.post(`/employees/${employeeId}/documents/${b.dataset.verify}/verify`, { status: 'verified' }); UI.toast('Marked verified.', 'success'); load(); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
      m.root.querySelectorAll('[data-reject]').forEach((b) => b.onclick = async () => {
        const note = prompt('Reason for rejection (optional):') || '';
        try { await api.post(`/employees/${employeeId}/documents/${b.dataset.reject}/verify`, { status: 'rejected', note }); UI.toast('Marked rejected.', 'success'); load(); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
      const of = m.root.querySelector('#otherfile');
      if (of) of.onchange = (e) => { const f = e.target.files[0]; if (f) upload(f, m.root.querySelector('#othertitle').value.trim()); };

      const av = m.root.querySelector('#aadhaarVerifyFile');
      if (av) av.onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const fd = new FormData(); fd.append('xml', f);
        try {
          const r = await api.upload(`/employees/${employeeId}/aadhaar-verify`, fd);
          if (r.signatureValid === true) UI.toast('✓ Genuine — UIDAI signature valid' + (r.nameMatch ? ' & name matches.' : ' (⚠ name on Aadhaar differs from profile).'), 'success');
          else if (r.signatureValid === false) UI.toast('✗ Not verified: ' + (r.reason || 'signature invalid / file tampered.'), 'error');
          else UI.toast(r.reason || 'Add UIDAI certificate in Settings to confirm the signature.', 'error');
          load();
        } catch (err) { UI.toast(err.message, 'error'); }
      };
    };
    load();
  },

  // ---------------- Salary structure (CTC breakup) ----------------
  async salaryModal(employeeId, name) {
    const { structure, employee } = await api.get(`/employees/${employeeId}/salary`);
    let earnings = (structure && structure.earnings && structure.earnings.length) ? structure.earnings.slice()
      : [{ name: 'Basic', amount: employee.monthly_salary || 0 }];
    let deductions = (structure && structure.deductions) ? structure.deductions.slice() : [];

    const m = UI.modal({
      title: 'Salary Structure — ' + (name || ''),
      bodyHtml: `
        <p class="muted" style="font-size:13px">Define the monthly salary components. Statutory deductions (PF/ESI/PT) are added automatically at payroll time per your Settings.</p>
        <div class="btn-row" style="margin-bottom:10px">
          <input id="genGross" type="number" placeholder="Monthly gross e.g. 30000" style="width:auto" />
          <button class="btn secondary" id="gen">Auto-generate breakup</button>
        </div>
        <div class="section-title">Earnings</div>
        <div id="earn"></div>
        <button class="btn sm secondary" id="addEarn">+ Add earning</button>
        <div class="section-title mt">Other Deductions (optional)</div>
        <div id="ded"></div>
        <button class="btn sm secondary" id="addDed">+ Add deduction</button>
        <div class="card mt" style="box-shadow:none;border:1px solid var(--border)"><b>Monthly Gross: <span id="grossView"></span></b></div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
    });

    const rowsHtml = (arr, kind) => arr.map((r, i) => `
      <div class="btn-row" style="margin-bottom:6px">
        <input data-k="${kind}" data-i="${i}" data-f="name" value="${UI.esc(r.name)}" placeholder="Name" />
        <input data-k="${kind}" data-i="${i}" data-f="amount" type="number" value="${r.amount}" placeholder="Amount" style="max-width:140px" />
        <button class="btn sm red" data-rm="${kind}:${i}">✕</button>
      </div>`).join('');

    const syncFromInputs = () => {
      m.root.querySelectorAll('input[data-k]').forEach((el) => {
        const arr = el.dataset.k === 'earn' ? earnings : deductions;
        const i = +el.dataset.i;
        if (!arr[i]) return;
        if (el.dataset.f === 'name') arr[i].name = el.value;
        else arr[i].amount = +el.value || 0;
      });
    };
    const gross = () => earnings.reduce((s, e) => s + (+e.amount || 0), 0);
    const render = () => {
      m.root.querySelector('#earn').innerHTML = rowsHtml(earnings, 'earn');
      m.root.querySelector('#ded').innerHTML = rowsHtml(deductions, 'ded');
      m.root.querySelector('#grossView').textContent = UI.money(gross());
      m.root.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
        syncFromInputs();
        const [k, i] = b.dataset.rm.split(':');
        (k === 'earn' ? earnings : deductions).splice(+i, 1);
        render();
      });
      m.root.querySelectorAll('input[data-k]').forEach((el) => el.oninput = () => { syncFromInputs(); m.root.querySelector('#grossView').textContent = UI.money(gross()); });
    };
    render();

    m.root.querySelector('#addEarn').onclick = () => { syncFromInputs(); earnings.push({ name: '', amount: 0 }); render(); };
    m.root.querySelector('#addDed').onclick = () => { syncFromInputs(); deductions.push({ name: '', amount: 0 }); render(); };
    m.root.querySelector('#gen').onclick = () => {
      const g = +m.root.querySelector('#genGross').value || 0;
      if (!g) { UI.toast('Enter a monthly gross first.', 'error'); return; }
      earnings = [
        { name: 'Basic', amount: Math.round(g * 0.5) },
        { name: 'HRA', amount: Math.round(g * 0.2) },
        { name: 'Special Allowance', amount: g - Math.round(g * 0.5) - Math.round(g * 0.2) },
      ];
      render();
    };
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      syncFromInputs();
      try {
        const r = await api.put(`/employees/${employeeId}/salary`, { earnings, deductions });
        m.close(); UI.toast('Salary structure saved. Gross ' + UI.money(r.gross), 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  // ---------------- Loans & Advances ----------------
  async loans(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [{ loans }, { employees }] = await Promise.all([api.get('/loans'), api.get('/employees')]);
    const empOpts = employees.map((e) => `<option value="${e.id}">${UI.esc(e.name)}</option>`).join('');
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Loans & Advances</div><div class="spacer"></div><button class="btn" id="add">Add Loan / Advance</button></div>
      <div id="list"></div>`;
    const render = () => {
      document.getElementById('list').innerHTML = UI.table([
        { key: 'employee_name', label: 'Employee' },
        { key: 'type', label: 'Type', render: (r) => UI.esc(r.type) },
        { key: 'title', label: 'Title', render: (r) => UI.esc(r.title || '-') },
        { key: 'amount', label: 'Amount', render: (r) => UI.money(r.amount) },
        { key: 'emi', label: 'Monthly EMI', render: (r) => UI.money(r.emi) },
        { key: 'balance', label: 'Balance', render: (r) => UI.money(r.balance) },
        { key: 'status', label: 'Status', render: (r) => UI.tag(r.status === 'active' ? 'approved' : 'inactive') + (r.status === 'active' ? ' Active' : ' Closed') },
        { key: 'act', label: '', render: (r) => `<button class="btn sm secondary" data-edit="${r.id}">Edit</button> <button class="btn sm red" data-del="${r.id}">Delete</button>` },
      ], loans, 'No loans or advances recorded.');
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(loans.find((l) => l.id == b.dataset.edit)));
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!confirm('Delete this record?')) return;
        try { await api.request('DELETE', '/loans/' + b.dataset.del); UI.toast('Deleted.', 'success'); this.loans(c); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
    };
    const form = (loan) => {
      const f = (k) => loan && loan[k] != null ? UI.esc(loan[k]) : '';
      const m = UI.modal({
        title: loan ? 'Edit Loan / Advance' : 'Add Loan / Advance',
        bodyHtml: `
          <div class="form-grid">
            <div class="field"><label>Employee</label><select id="employee_id">${empOpts}</select></div>
            <div class="field"><label>Type</label><select id="type"><option value="loan">Loan</option><option value="advance">Advance</option></select></div>
            <div class="field"><label>Title</label><input id="title" value="${f('title')}" placeholder="e.g. Festival advance" /></div>
            <div class="field"><label>Total Amount</label><input id="amount" type="number" value="${loan ? loan.amount : ''}" /></div>
            <div class="field"><label>Monthly EMI (deducted from salary)</label><input id="emi" type="number" value="${loan ? loan.emi : ''}" /></div>
            <div class="field"><label>Balance Remaining</label><input id="balance" type="number" value="${loan ? loan.balance : ''}" /></div>
            ${loan ? `<div class="field"><label>Status</label><select id="status"><option value="active" ${loan.status === 'active' ? 'selected' : ''}>Active</option><option value="closed" ${loan.status === 'closed' ? 'selected' : ''}>Closed</option></select></div>` : ''}
            <div class="field full"><label>Notes</label><textarea id="notes" rows="2">${f('notes')}</textarea></div>
          </div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
      });
      if (loan) { m.root.querySelector('#employee_id').value = loan.employee_id; m.root.querySelector('#type').value = loan.type; }
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#save').onclick = async () => {
        const data = {
          employee_id: m.root.querySelector('#employee_id').value, type: m.root.querySelector('#type').value,
          title: m.root.querySelector('#title').value, amount: m.root.querySelector('#amount').value,
          emi: m.root.querySelector('#emi').value, balance: m.root.querySelector('#balance').value,
          notes: m.root.querySelector('#notes').value,
        };
        if (loan) data.status = m.root.querySelector('#status').value;
        try {
          if (loan) await api.put('/loans/' + loan.id, data); else await api.post('/loans', data);
          m.close(); UI.toast('Saved.', 'success'); this.loans(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };
    render();
    document.getElementById('add').onclick = () => form(null);
  },

  // ---------------- Recognition / Kudos (Wall of Fame) ----------------
  BADGES: [
    // Performance & Excellence
    ['🌟', 'Star Performer'], ['🚀', 'Above & Beyond'], ['🏆', 'Champion'],
    ['🔥', 'On Fire'], ['⚡', 'Lightning Fast'], ['💎', 'Premium Quality'],

    // Innovation & Ideas
    ['💡', 'Bright Idea'], ['🧠', 'Problem Solver'], ['🎯', 'Strategic Thinker'],
    ['🔬', 'Innovator'], ['🎨', 'Creative Mind'], ['💫', 'Game Changer'],

    // Teamwork & Collaboration
    ['🤝', 'Team Player'], ['🙌', 'Helping Hand'], ['❤️', 'Customer Hero'],
    ['🤲', 'Mentor'], ['👥', 'Network Builder'], ['🔗', 'Bridge Builder'],

    // Leadership & Attitude
    ['👑', 'Leader'], ['🦸', 'Super Hero'], ['🎖️', 'Achiever'],
    ['💪', 'Go Getter'], ['🌈', 'Positive Energy'], ['📈', 'Growth Mindset'],

    // Learning & Development
    ['📚', 'Quick Learner'], ['🎓', 'Knowledge Master'], ['🧑‍🎓', 'Scholar'],
    ['📖', 'Wisdom Keeper'], ['🏅', 'Skill Master'], ['🌱', 'Growing Star'],

    // Reliability & Excellence
    ['✅', 'Reliable'], ['⭐', 'Trusted Expert'], ['🎪', 'Entertainer'],
    ['🌺', 'Compassionate'], ['💼', 'Professional'], ['🎭', 'Multi-talented'],
  ],
  async recognition(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [{ kudos }, dir, lb] = await Promise.all([api.get('/kudos'), api.get('/employees/directory'), api.get('/kudos/leaderboard')]);
    const opts = dir.employees.map((e) => `<option value="${e.id}">${UI.esc(e.name)}</option>`).join('');
    const medals = ['🥇', '🥈', '🥉'];
    const leaderCards = (lb.leaders || []).length
      ? lb.leaders.map((l, i) => `<div class="card stat" style="border-top:3px solid var(--primary)"><div class="label">${medals[i] || '⭐'} ${UI.esc(l.name)}</div><div class="value">${l.kudos_count}<span class="muted" style="font-size:13px"> kudos · ${l.cheers} 👏</span></div></div>`).join('')
      : '<div class="muted">No recognition this month yet.</div>';

    c.innerHTML = `
      <div class="card" style="max-width:680px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none">
        <div class="section-title" style="color:#fff">🎉 Give a Shoutout</div>
        <div class="form-grid">
          <div class="field"><label style="color:#e9e7ff">To</label><select id="to">${opts}</select></div>
          <div class="field"><label style="color:#e9e7ff">Badge</label><select id="badge">${this.BADGES.map(([e, n]) => `<option value="${e}|${n}">${e} ${n}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label style="color:#e9e7ff">Message</label><textarea id="msg" rows="2" placeholder="Shout out a teammate for something awesome..."></textarea></div>
        <button class="btn" id="give" style="background:#fff;color:#4f46e5">Post Shoutout 🎉</button>
      </div>

      <div class="section-title mt">🏅 Wall of Fame — this month</div>
      <div class="cards">${leaderCards}</div>

      <div class="section-title mt">📣 Recent Shoutouts</div>
      <div id="wall">${this.kudosWall(kudos)}</div>`;

    document.getElementById('give').onclick = async () => {
      const msg = document.getElementById('msg').value.trim();
      if (!msg) { UI.toast('Write a message.', 'error'); return; }
      const badge = (document.getElementById('badge').value.split('|')[0]);
      try {
        await api.post('/kudos', { employee_id: document.getElementById('to').value, badge, message: msg });
        UI.celebrate(); UI.toast('Shoutout posted! 🎉', 'success'); this.recognition(c);
      } catch (e) { UI.toast(e.message, 'error'); }
    };
    this.bindCheers(c);
  },
  REACTIONS: ['👏', '❤️', '🎉', '🔥', '💯', '🙌', '🚀', '👍', '⭐', '😂'],
  kudosWall(kudos) {
    if (!kudos.length) return '<div class="empty">No shoutouts yet — be the first to recognise a teammate!</div>';
    const badgeName = (e) => (this.BADGES.find((b) => b[0] === e) || [, ''])[1];
    return kudos.map((k) => `
      <div class="announcement" style="border-left-color:#7c3aed">
        <h4>${UI.esc(k.badge || '👏')} ${UI.esc(k.to_name)} <span class="tag" style="background:#ede9fe;color:#5b21b6;font-weight:600">${UI.esc(badgeName(k.badge) || 'Kudos')}</span></h4>
        <div style="margin:6px 0;font-size:15px">${UI.esc(k.message)}</div>
        <div class="meta">from ${UI.esc(k.from_name || 'Someone')} &middot; ${UI.date(k.created_at)}</div>
        ${this.reactionBar(k.id, k.reactions)}
      </div>`).join('');
  },
  reactionBar(kid, reactions) {
    const chips = (reactions || []).map((r) => `<button class="rchip ${r.mine ? 'mine' : ''}" data-react="${kid}" data-emoji="${r.emoji}">${r.emoji} ${r.count}</button>`).join('');
    const palette = this.REACTIONS.map((e) => `<button class="rchip pal" data-react="${kid}" data-emoji="${e}">${e}</button>`).join('');
    return `<div class="reactions" data-bar="${kid}">${chips}
      <span class="rwrap"><button class="rchip add" data-pick="${kid}" title="Add reaction">＋</button>
      <span class="rpalette" data-pal="${kid}" style="display:none">${palette}</span></span></div>`;
  },
  bindCheers(c) {
    const rebind = () => this.bindCheers(c);
    c.querySelectorAll('[data-react]').forEach((b) => b.onclick = async () => {
      const kid = b.dataset.react, emoji = b.dataset.emoji;
      try {
        const r = await api.post('/kudos/' + kid + '/react', { emoji });
        const bar = c.querySelector('[data-bar="' + kid + '"]');
        if (bar) { bar.outerHTML = this.reactionBar(kid, r.reactions); rebind(); }
        if (r.added) UI.celebrate([emoji]);
      } catch (e) { UI.toast(e.message, 'error'); }
    });
    c.querySelectorAll('[data-pick]').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const pal = c.querySelector('[data-pal="' + b.dataset.pick + '"]');
      if (pal) pal.style.display = pal.style.display === 'none' ? 'inline-flex' : 'none';
    });
  },

  // ---------------- Performance (goals + reviews) ----------------
  async performance(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const canManage = App.has('leave:approve');
    const mine = App.user.employeeId ? (await api.get('/goals/mine')).goals : [];
    const myReviews = App.user.employeeId ? (await api.get('/reviews/mine')).reviews : [];
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">My Goals</div><div class="spacer"></div>${App.user.employeeId ? '<button class="btn" id="addGoal">Add Goal</button>' : ''}</div>
      <div id="goals">${this.goalTable(mine)}</div>
      <div class="section-title mt">My Reviews</div>
      ${UI.table([
        { key: 'period', label: 'Period' },
        { key: 'rating', label: 'Rating', render: (r) => r.rating ? r.rating + '/5' : '-' },
        { key: 'strengths', label: 'Strengths', render: (r) => UI.esc(r.strengths || '-') },
        { key: 'improvements', label: 'To Improve', render: (r) => UI.esc(r.improvements || '-') },
        { key: 'reviewer_name', label: 'Reviewer', render: (r) => UI.esc(r.reviewer_name || '-') },
      ], myReviews, 'No reviews yet.')}
      ${canManage ? `<div class="section-title mt">Manage Team Member</div>
        <div class="toolbar"><select id="member" style="width:auto"></select></div>
        <div id="teamPerf" class="muted">Pick a team member.</div>` : ''}`;

    const bindGoals = (rootSel, list, reloadFn) => {
      document.querySelectorAll(rootSel + ' [data-prog]').forEach((b) => b.onclick = async () => {
        const val = prompt('Progress % (0-100):'); if (val == null) return;
        try { await api.put('/goals/' + b.dataset.prog, { progress: Number(val) }); reloadFn(); } catch (e) { UI.toast(e.message, 'error'); }
      });
      document.querySelectorAll(rootSel + ' [data-gdone]').forEach((b) => b.onclick = async () => {
        try { await api.put('/goals/' + b.dataset.gdone, { status: 'done', progress: 100 }); reloadFn(); } catch (e) { UI.toast(e.message, 'error'); }
      });
      document.querySelectorAll(rootSel + ' [data-gdel]').forEach((b) => b.onclick = async () => {
        if (!confirm('Delete this goal?')) return;
        try { await api.request('DELETE', '/goals/' + b.dataset.gdel); reloadFn(); } catch (e) { UI.toast(e.message, 'error'); }
      });
    };
    bindGoals('#goals', mine, () => this.performance(c));

    const addGoalBtn = document.getElementById('addGoal');
    if (addGoalBtn) addGoalBtn.onclick = () => this.goalForm(null, () => this.performance(c));

    if (canManage) {
      let people = [];
      try { people = (await api.get('/employees')).employees; } catch (e) {}
      if (!people.length) { try { people = (await api.get('/employees/team')).employees; } catch (e) {} }
      const sel = document.getElementById('member');
      sel.innerHTML = '<option value="">— Select —</option>' + people.map((p) => `<option value="${p.id}">${UI.esc(p.name)}</option>`).join('');
      sel.onchange = async () => {
        const id = sel.value; if (!id) { document.getElementById('teamPerf').innerHTML = 'Pick a team member.'; return; }
        const [g, rv] = await Promise.all([api.get('/goals/' + id), api.get('/reviews/' + id)]);
        document.getElementById('teamPerf').innerHTML = `
          <div class="toolbar"><b>Goals</b><div class="spacer"></div><button class="btn sm" id="tAddGoal">Add Goal</button></div>
          <div id="tGoals">${this.goalTable(g.goals)}</div>
          <div class="toolbar mt"><b>Reviews</b><div class="spacer"></div><button class="btn sm" id="tAddRev">Add Review</button></div>
          ${UI.table([
            { key: 'period', label: 'Period' }, { key: 'rating', label: 'Rating', render: (r) => r.rating ? r.rating + '/5' : '-' },
            { key: 'strengths', label: 'Strengths', render: (r) => UI.esc(r.strengths || '-') },
            { key: 'improvements', label: 'To Improve', render: (r) => UI.esc(r.improvements || '-') },
          ], rv.reviews, 'No reviews.')}`;
        bindGoals('#tGoals', g.goals, () => sel.onchange());
        document.getElementById('tAddGoal').onclick = () => this.goalForm(id, () => sel.onchange());
        document.getElementById('tAddRev').onclick = () => this.reviewForm(id, () => sel.onchange());
      };
    }
  },
  goalTable(goals) {
    return UI.table([
      { key: 'title', label: 'Goal' },
      { key: 'target_date', label: 'Target', render: (r) => r.target_date ? UI.date(r.target_date) : '-' },
      { key: 'progress', label: 'Progress', render: (r) => `${r.progress}%` },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status === 'done' ? 'approved' : 'pending') + ' ' + r.status },
      { key: 'act', label: '', render: (r) => `<button class="btn sm secondary" data-prog="${r.id}">Progress</button> <button class="btn sm green" data-gdone="${r.id}">Done</button> <button class="btn sm red" data-gdel="${r.id}">✕</button>` },
    ], goals, 'No goals yet.');
  },
  goalForm(employeeId, reload) {
    const m = UI.modal({
      title: 'Add Goal',
      bodyHtml: `
        <div class="field"><label>Title</label><input id="title" /></div>
        <div class="field"><label>Description</label><textarea id="desc" rows="2"></textarea></div>
        <div class="field"><label>Target Date</label><input type="date" id="target" /></div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      const data = { title: m.root.querySelector('#title').value, description: m.root.querySelector('#desc').value, target_date: m.root.querySelector('#target').value };
      if (employeeId) data.employee_id = employeeId;
      try { await api.post('/goals', data); m.close(); UI.toast('Goal added.', 'success'); reload(); } catch (e) { UI.toast(e.message, 'error'); }
    };
  },
  reviewForm(employeeId, reload) {
    const m = UI.modal({
      title: 'Add Review',
      bodyHtml: `
        <div class="form-grid">
          <div class="field"><label>Period</label><input id="period" placeholder="e.g. 2026-H1" /></div>
          <div class="field"><label>Rating (1-5)</label><input type="number" id="rating" min="1" max="5" /></div>
        </div>
        <div class="field"><label>Strengths</label><textarea id="strengths" rows="2"></textarea></div>
        <div class="field"><label>Areas to improve</label><textarea id="improvements" rows="2"></textarea></div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      try {
        await api.post('/reviews', { employee_id: employeeId, period: m.root.querySelector('#period').value, rating: m.root.querySelector('#rating').value, strengths: m.root.querySelector('#strengths').value, improvements: m.root.querySelector('#improvements').value });
        m.close(); UI.toast('Review saved.', 'success'); reload();
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  // ---------------- Surveys ----------------
  async surveys(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { surveys, isAdmin } = await api.get('/surveys');
    const categoryIcons = { engagement: '🎯', satisfaction: '😊', performance: '📊', feedback: '💬', pulse: '⚡' };

    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Surveys</div><div class="spacer"></div>${isAdmin ? '<button class="btn" id="create">Create Survey</button>' : ''}</div>
      ${surveys.length ? surveys.map((s) => {
        const statusTag = !s.active ? '<span class="tag inactive">🔒 Closed</span>' : s.isExpired ? '<span class="tag warning">⏰ Expired</span>' : s.daysRemaining <= 3 && s.daysRemaining > 0 ? '<span class="tag warning">⏰ Ending soon</span>' : '<span class="tag approved">✓ Active</span>';
        const respondText = s.responded ? '<span class="tag approved">✓ Responded</span>' : (s.active && s.isEligible && App.user.employeeId ? `<button class="btn sm" data-fill="${s.id}">Fill</button>` : '');
        const responseInfo = `<div class="muted" style="font-size:12px;margin-top:4px">${s.responseCount} response(s)${s.deadline ? ' • Deadline: ' + s.deadline : ''}</div>`;
        return `
        <div class="card" style="margin-bottom:12px;border-left:4px solid var(--primary)">
          <div class="toolbar">
            <div style="flex:1">
              <b>${UI.esc(s.title)}</b> <span style="font-size:12px;color:#666">${categoryIcons[s.category] || '❓'}</span><br>
              ${statusTag} ${respondText}<br>
              ${responseInfo}
            </div>
            <div style="text-align:right;white-space:nowrap">
              ${isAdmin ? `<button class="btn sm secondary" data-res="${s.id}">Results</button> <button class="btn sm secondary" data-toggle="${s.id}" data-active="${s.active}">${s.active ? 'Close' : 'Reopen'}</button> <button class="btn sm red" data-sdel="${s.id}">✕</button>` : ''}
            </div>
          </div>
          <div class="muted" style="font-size:13px">${UI.esc(s.description || '')}</div>
        </div>`;
      }).join('') : '<div class="empty">No surveys yet. Create one to gather feedback!</div>'}`;

    // store surveys for fill
    const byId = {}; surveys.forEach((s) => byId[s.id] = s);
    document.querySelectorAll('[data-fill]').forEach((b) => b.onclick = () => this.fillSurvey(byId[b.dataset.fill], () => this.surveys(c)));
    document.querySelectorAll('[data-res]').forEach((b) => b.onclick = () => this.surveyResults(b.dataset.res));
    document.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
      try { await api.put('/surveys/' + b.dataset.toggle, { active: b.dataset.active == '1' ? 0 : 1 }); this.surveys(c); } catch (e) { UI.toast(e.message, 'error'); }
    });
    document.querySelectorAll('[data-sdel]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this survey and all responses?')) return;
      try { await api.request('DELETE', '/surveys/' + b.dataset.sdel); UI.toast('Deleted.', 'success'); this.surveys(c); } catch (e) { UI.toast(e.message, 'error'); }
    });
    const createBtn = document.getElementById('create');
    if (createBtn) createBtn.onclick = () => this.createSurvey(() => this.surveys(c));
  },
  fillSurvey(s, reload) {
    const renderQuestion = (q, i) => {
      const renderByType = {
        text: `<textarea data-q="${i}" rows="2" placeholder="Your response..."></textarea>`,
        rating: `<div class="rating-scale">${[1,2,3,4,5].map(n => `<label><input type="radio" name="q${i}" value="${n}" /> ${n}</label>`).join('')}</div>`,
        nps: `<div class="nps-scale">${[...Array(11).keys()].map(n => `<label style="display:inline-block;margin:0 4px"><input type="radio" name="q${i}" value="${n}" /> ${n}</label>`).join('')}</div>`,
        choice: `<select data-q="${i}"><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option><option value="Maybe">Maybe</option></select>`,
        yes_no: `<div class="yes-no"><label><input type="radio" name="q${i}" value="Yes" /> Yes</label><label><input type="radio" name="q${i}" value="No" /> No</label></div>`,
        ranking: `<div data-q="${i}" class="ranking-field"><input type="number" min="1" max="10" placeholder="Rank 1-10" /></div>`,
        matrix: `<div data-q="${i}" class="matrix-field"><input type="text" placeholder="Response..." /></div>`,
      };
      return `<div class="field"><label><strong>${UI.esc(q.text)}</strong></label>${renderByType[q.type] || renderByType.text}</div>`;
    };

    const m = UI.modal({
      title: s.title,
      bodyHtml: `<div style="max-height:65vh;overflow-y:auto"><p class="muted">${UI.esc(s.description || '')}</p>${s.questions.map((q, i) => renderQuestion(q, i)).join('')}</div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="submit">Submit Response</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#submit').onclick = async () => {
      const answers = s.questions.map((q, i) => {
        if (['rating', 'nps', 'yes_no'].includes(q.type)) {
          const radio = m.root.querySelector(`input[name="q${i}"]:checked`);
          return radio ? radio.value : '';
        } else if (q.type === 'choice') {
          const select = m.root.querySelector(`select[data-q="${i}"]`);
          return select ? select.value : '';
        } else {
          const input = m.root.querySelector(`[data-q="${i}"]`);
          return input ? input.value : '';
        }
      });
      try { await api.post(`/surveys/${s.id}/respond`, { answers }); m.close(); UI.toast('Thank you for your response!', 'success'); reload(); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
  },
  createSurvey(reload) {
    let qs = [{ text: '', type: 'text' }];
    const surveyCategories = [
      ['engagement', 'Engagement'],
      ['satisfaction', 'Satisfaction'],
      ['performance', 'Performance'],
      ['feedback', 'Feedback'],
      ['pulse', 'Pulse (Quick Check)'],
    ];
    const questionTypes = [
      ['text', 'Text'],
      ['rating', 'Rating 1-5'],
      ['nps', 'NPS (0-10)'],
      ['choice', 'Multiple Choice'],
      ['yes_no', 'Yes / No'],
      ['ranking', 'Ranking'],
      ['matrix', 'Matrix/Grid'],
    ];
    const m = UI.modal({
      title: 'Create Survey',
      bodyHtml: `
        <div style="max-height:60vh;overflow-y:auto">
          <div class="form-grid">
            <div class="field"><label>Title *</label><input id="title" /></div>
            <div class="field"><label>Category</label><select id="category">${surveyCategories.map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label>Description</label><textarea id="desc" rows="2"></textarea></div>
          <div class="form-grid">
            <div class="field"><label>Deadline (optional)</label><input type="date" id="deadline" /></div>
            <div class="field"><label>Target Department</label><input id="target_dept" placeholder="Leave blank for all" /></div>
          </div>
          <div class="field"><label class="checkbox-row"><input type="checkbox" id="anon" /> Anonymous responses</label></div>
          <div class="field"><label class="checkbox-row"><input type="checkbox" id="required" /> Response is mandatory</label></div>
          <div class="field"><label class="checkbox-row"><input type="checkbox" id="show_results" checked /> Show results to employees</label></div>
          <div class="section-title">Questions <span style="font-size:12px;color:#999">(${questionTypes.length} types available)</span></div>
          <div id="qs"></div>
          <button class="btn sm secondary" id="addQ">+ Add question</button>
        </div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Create Survey</button>`,
    });
    const sync = () => { m.root.querySelectorAll('[data-q]').forEach((el) => { const i = +el.dataset.q, f = el.dataset.f; if (f === 'text') qs[i].text = el.value; else qs[i].type = el.value; }); };
    const render = () => {
      m.root.querySelector('#qs').innerHTML = qs.map((q, i) => `
        <div class="btn-row" style="margin-bottom:6px">
          <input data-q="${i}" data-f="text" value="${UI.esc(q.text)}" placeholder="Question" />
          <select data-q="${i}" data-f="type" style="max-width:140px">
            ${questionTypes.map(([v,l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <button class="btn sm red" data-rmq="${i}">✕</button>
        </div>`).join('');
      m.root.querySelectorAll('[data-rmq]').forEach((b) => b.onclick = () => { sync(); qs.splice(+b.dataset.rmq, 1); if (!qs.length) qs.push({ text: '', type: 'text' }); render(); });
    };
    render();
    m.root.querySelector('#addQ').onclick = () => { sync(); qs.push({ text: '', type: 'text' }); render(); };
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      sync();
      const title = m.root.querySelector('#title').value.trim();
      if (!title) { UI.toast('Title is required.', 'error'); return; }
      const cleanedQs = qs.filter((q) => q.text.trim());
      if (!cleanedQs.length) { UI.toast('At least one question is required.', 'error'); return; }
      try {
        await api.post('/surveys', {
          title,
          description: m.root.querySelector('#desc').value,
          category: m.root.querySelector('#category').value,
          deadline: m.root.querySelector('#deadline').value || null,
          target_department: m.root.querySelector('#target_dept').value || null,
          anonymous: m.root.querySelector('#anon').checked,
          response_required: m.root.querySelector('#required').checked,
          show_results: m.root.querySelector('#show_results').checked,
          questions: cleanedQs
        });
        m.close();
        UI.toast('Survey created successfully!', 'success');
        reload();
      }
      catch (e) { UI.toast(e.message, 'error'); }
    };
  },
  async surveyResults(id) {
    const { survey, responses } = await api.get(`/surveys/${id}/responses`);
    const responseRate = survey.totalEligible ? ((responses.length / survey.totalEligible) * 100).toFixed(1) : '—';

    let body = `<div style="margin-bottom:16px;padding:12px;background:#f3f4f6;border-radius:6px">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div><div class="muted" style="font-size:12px">Responses</div><div style="font-size:20px;font-weight:bold">${responses.length}</div></div>
        <div><div class="muted" style="font-size:12px">Response Rate</div><div style="font-size:20px;font-weight:bold">${responseRate}%</div></div>
        <div><div class="muted" style="font-size:12px">Status</div><div style="font-size:16px;font-weight:bold">${survey.active ? '<span style="color:#16a34a">● Active</span>' : '<span style="color:#dc2626">● Closed</span>'}</div></div>
      </div>
    </div>`;

    body += survey.questions.map((q, i) => {
      const ans = responses.map((r) => r.answers[i]).filter((a) => a != null && a !== '');
      let result = `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e5e7eb"><b style="font-size:15px">${UI.esc(q.text)}</b><span class="muted" style="margin-left:8px">(${ans.length}/${responses.length} answered)</span><br>`;

      if (['rating', 'nps'].includes(q.type)) {
        const nums = ans.map(Number).filter((n) => !isNaN(n));
        const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '-';
        const max = q.type === 'nps' ? 10 : 5;
        const freq = {};
        nums.forEach(n => freq[n] = (freq[n] || 0) + 1);
        result += `<div style="margin:8px 0;font-weight:bold">Average: ${avg}/${max}</div>`;
        result += '<div style="display:flex;gap:2px;align-items:flex-end;height:60px">';
        for (let n = 1; n <= max; n++) {
          const h = (freq[n] || 0) / Math.max(...Object.values(freq)) * 100;
          result += `<div style="flex:1;background:#4f46e5;border-radius:2px;height:${h}%;opacity:${freq[n] ? 1 : 0.2}" title="${n}: ${freq[n] || 0}"></div>`;
        }
        result += '</div>';
      } else if (q.type === 'yes_no') {
        const freq = { Yes: ans.filter(a => a === 'Yes').length, No: ans.filter(a => a === 'No').length };
        result += '<div style="display:flex;gap:16px;margin:8px 0">';
        result += `<div><span style="font-weight:bold;color:#16a34a">✓ Yes: ${freq.Yes}</span> <span class="muted">(${freq.Yes + freq.No ? ((freq.Yes/(freq.Yes+freq.No))*100).toFixed(0) : 0}%)</span></div>`;
        result += `<div><span style="font-weight:bold;color:#dc2626">✗ No: ${freq.No}</span> <span class="muted">(${freq.Yes + freq.No ? ((freq.No/(freq.Yes+freq.No))*100).toFixed(0) : 0}%)</span></div>`;
        result += '</div>';
      } else {
        result += ans.length ? '<ul style="margin:8px 0;max-height:200px;overflow-y:auto">' + ans.slice(0, 10).map((a) => `<li style="font-size:13px">${UI.esc(a)}</li>`).join('') + (ans.length > 10 ? `<li class="muted" style="font-size:12px">... and ${ans.length - 10} more</li>` : '') + '</ul>' : '<div class="muted">No answers</div>';
      }
      result += '</div>';
      return result;
    }).join('');

    const m = UI.modal({
      title: 'Results — ' + survey.title,
      bodyHtml: `<div style="max-height:70vh;overflow-y:auto">${body}</div>`,
      footHtml: '<button class="btn" data-close-btn>Close</button>'
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
  },

  // ---------------- Helpdesk ----------------
  HR_TICKET_CATEGORIES: [
    { key: 'leave', icon: '📅', name: 'Leave & Attendance', desc: 'Leave requests, attendance issues, work from home' },
    { key: 'payroll', icon: '💰', name: 'Salary & Payroll', desc: 'Salary slips, deductions, reimbursements, advances' },
    { key: 'documents', icon: '📄', name: 'Documents & IDs', desc: 'Document verification, certificates, ID proofs' },
    { key: 'benefits', icon: '🎁', name: 'Benefits & Allowances', desc: 'Insurance, health benefits, allowances, claims' },
    { key: 'office', icon: '🏢', name: 'Office & Facilities', desc: 'Desk setup, access cards, parking, amenities' },
    { key: 'performance', icon: '⭐', name: 'Performance & Appraisal', desc: 'Performance review, goals, feedback, appraisal' },
    { key: 'training', icon: '🎓', name: 'Training & Development', desc: 'Courses, certifications, skill development, training' },
    { key: 'grievance', icon: '⚠️', name: 'Grievances & Complaints', desc: 'Complaints, disputes, conflicts, resolutions' },
    { key: 'general', icon: '❓', name: 'General HR', desc: 'Other HR-related queries and requests' },
  ],

  async helpdesk(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const isAdmin = App.has('settings:manage');
    const isEmployee = !!App.user.employeeId;
    const mine = isEmployee ? (await api.get('/tickets/mine')).tickets : [];
    const all = isAdmin ? (await api.get('/tickets')).tickets : [];
    // Always show raise ticket UI to everyone (backend enforces employee-only on submit)

    // Reusable function to open the raise ticket modal
    const openRaiseModal = (preselectedCategory) => {
      const categoryOptions = this.HR_TICKET_CATEGORIES.map((cat) =>
        `<option value="${cat.key}" ${preselectedCategory === cat.key ? 'selected' : ''}>${cat.icon} ${cat.name}</option>`
      ).join('');
      const preselected = this.HR_TICKET_CATEGORIES.find(cat => cat.key === preselectedCategory);

      const m = UI.modal({
        title: '📝 Raise an HR Support Ticket',
        bodyHtml: `
          <div class="field">
            <label><strong>Category *</strong></label>
            <select id="cat" style="width:100%">
              <option value="">— Select a category —</option>
              ${categoryOptions}
            </select>
            <div id="cat-desc" style="margin-top:6px;font-size:12px;color:#6b7280;min-height:16px">${preselected ? preselected.desc : ''}</div>
          </div>
          <div class="field">
            <label><strong>Subject *</strong></label>
            <input id="subject" placeholder="Brief description of your issue" style="width:100%" />
          </div>
          <div class="field">
            <label><strong>Details</strong> <span style="color:#9ca3af;font-weight:400">(optional)</span></label>
            <textarea id="desc" rows="4" placeholder="Provide more details so HR can help you faster..." style="width:100%"></textarea>
          </div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="submit-ticket">Submit Ticket</button>`,
      });

      const catSelect = m.root.querySelector('#cat');
      const catDesc = m.root.querySelector('#cat-desc');
      catSelect.onchange = () => {
        const selected = this.HR_TICKET_CATEGORIES.find(x => x.key === catSelect.value);
        catDesc.textContent = selected ? selected.desc : '';
      };
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#submit-ticket').onclick = async () => {
        const category = m.root.querySelector('#cat').value;
        const subject = m.root.querySelector('#subject').value.trim();
        if (!category) { UI.toast('Please select a category.', 'error'); return; }
        if (!subject) { UI.toast('Please enter a subject.', 'error'); return; }
        try {
          await api.post('/tickets', { category, subject, description: m.root.querySelector('#desc').value.trim() });
          m.close();
          UI.toast('✅ Ticket submitted! HR will review it shortly.', 'success');
          this.helpdesk(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };

    // Category filter tabs HTML builder
    const buildTabs = (containerId, prefix) => `
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:4px;border-bottom:2px solid #e5e7eb">
        <button class="tab-btn-${prefix}" data-filter="all" data-target="${containerId}"
          style="padding:6px 14px;border:none;background:#4f46e5;color:#fff;border-radius:20px;cursor:pointer;font-size:13px;font-weight:600">
          📋 All
        </button>
        ${this.HR_TICKET_CATEGORIES.map(cat => `
          <button class="tab-btn-${prefix}" data-filter="${cat.key}" data-target="${containerId}"
            style="padding:6px 14px;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:20px;cursor:pointer;font-size:13px">
            ${cat.icon} ${cat.name}
          </button>
        `).join('')}
      </div>`;

    // ---- Build page HTML ----
    let html = `<div class="section-title">🎧 Help Desk — HR Support</div>`;

    // ---- Raise Ticket section — always visible ----
    html += `
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:12px;padding:24px 28px;margin:16px 0;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <div style="font-size:18px;font-weight:700;margin-bottom:4px">Need help from HR?</div>
          <div style="opacity:.85;font-size:14px">Pick a category below and raise a support ticket — HR will respond shortly.</div>
        </div>
        <button id="raise-main" style="background:#fff;color:#4f46e5;border:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">
          📝 Raise a Ticket
        </button>
      </div>

      <div style="margin-bottom:24px">
        <div style="font-size:13px;color:#6b7280;margin-bottom:10px;font-weight:500">Select a category to raise a ticket:</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
          ${this.HR_TICKET_CATEGORIES.map(cat => `
            <button class="cat-quick-btn" data-cat="${cat.key}"
              style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 10px;border:1.5px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)">
              <span style="font-size:26px">${cat.icon}</span>
              <span style="font-size:12px;font-weight:600;color:#374151;line-height:1.3">${cat.name}</span>
              <span style="font-size:11px;color:#9ca3af;line-height:1.3">${cat.desc}</span>
            </button>
          `).join('')}
        </div>
      </div>`;

    // ---- My Tickets section (only for employees) ----
    if (isEmployee) {
      html += `
        <div style="margin-top:24px">
          <div class="section-title" style="margin-bottom:12px">My Tickets</div>
          ${buildTabs('my-tickets-container', 'my')}
          <div id="my-tickets-container">
            ${mine.length === 0
              ? `<div style="text-align:center;padding:40px 20px;color:#9ca3af;border:2px dashed #e5e7eb;border-radius:10px">
                  <div style="font-size:36px;margin-bottom:8px">📭</div>
                  <div style="font-weight:600;margin-bottom:4px">No tickets yet</div>
                  <div style="font-size:13px">Use the category cards above to raise your first ticket.</div>
                </div>`
              : this.ticketTable(mine, false)}
          </div>
        </div>`;
    }

    if (isAdmin) {
      const openCount = all.filter(t => t.status === 'open').length;
      const inProgCount = all.filter(t => t.status === 'in_progress').length;
      html += `
        <div style="margin-top:${isEmployee ? '32px' : '8px'}">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
            <div class="section-title" style="margin:0">All Employee Tickets</div>
            <span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${openCount} Open 🔴</span>
            <span style="background:#fef9c3;color:#ca8a04;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${inProgCount} In Progress 🟡</span>
          </div>
          ${buildTabs('all-tickets-container', 'adm')}
          <div id="all-tickets-container">
            ${all.length === 0
              ? `<div style="text-align:center;padding:40px 20px;color:#9ca3af;border:2px dashed #e5e7eb;border-radius:10px">
                  <div style="font-size:36px;margin-bottom:8px">🎉</div>
                  <div style="font-weight:600">No tickets raised yet</div>
                </div>`
              : this.ticketTable(all, true)}
          </div>
        </div>`;
    }

    c.innerHTML = html;

    // Bind raise ticket buttons
    const raiseMain = document.getElementById('raise-main');
    if (raiseMain) raiseMain.onclick = () => openRaiseModal('');

    // Bind category quick-pick buttons
    document.querySelectorAll('.cat-quick-btn').forEach(btn => {
      btn.onmouseenter = () => { btn.style.borderColor = '#4f46e5'; btn.style.background = '#f5f3ff'; };
      btn.onmouseleave = () => { btn.style.borderColor = '#e5e7eb'; btn.style.background = '#fff'; };
      btn.onclick = () => openRaiseModal(btn.dataset.cat);
    });

    // Bind tab filters (pill style)
    ['my', 'adm'].forEach(prefix => {
      document.querySelectorAll(`.tab-btn-${prefix}`).forEach(btn => {
        btn.onclick = () => {
          const filter = btn.dataset.filter;
          const targetId = btn.dataset.target;
          const tickets = prefix === 'my' ? mine : all;
          const isAdminView = prefix === 'adm';

          // Update pill styles
          document.querySelectorAll(`.tab-btn-${prefix}`).forEach(b => {
            b.style.background = '#fff'; b.style.color = '#374151'; b.style.border = '1px solid #e5e7eb';
          });
          btn.style.background = '#4f46e5'; btn.style.color = '#fff'; btn.style.border = '1px solid #4f46e5';

          const filtered = filter === 'all' ? tickets : tickets.filter(t => t.category === filter);
          const container = document.getElementById(targetId);
          if (container) {
            container.innerHTML = filtered.length === 0
              ? `<div style="text-align:center;padding:32px;color:#9ca3af">No tickets in this category.</div>`
              : this.ticketTable(filtered, isAdminView);
            if (isAdminView) setTimeout(() => this.bindManageButtons(c, all), 0);
          }
        };
      });
    });

    // Bind manage buttons for admin
    if (isAdmin) this.bindManageButtons(c, all);
  },

  bindManageButtons(c, all) {
    document.querySelectorAll('[data-manage]').forEach((b) => {
      b.onclick = () => {
        const t = all.find((x) => x.id == b.dataset.manage);
        const catInfo = this.HR_TICKET_CATEGORIES.find(cat => cat.key === t.category);
        const m = UI.modal({
          title: `🎫 Ticket #${t.id} — ${UI.esc(t.subject)}`,
          bodyHtml: `
            <div style="background:#f0f9ff;padding:12px;border-radius:6px;margin-bottom:12px;border-left:4px solid #0ea5e9">
              <div style="font-size:13px;color:#0369a1">
                <strong>${UI.esc(t.employee_name)}</strong> • ${catInfo ? catInfo.icon + ' ' + catInfo.name : t.category || 'General'}<br>
                <span class="muted">Created: ${new Date(t.created_at).toLocaleDateString()}</span>
              </div>
            </div>
            <p style="white-space:pre-wrap;background:#f9fafb;padding:12px;border-radius:4px;margin-bottom:12px">${UI.esc(t.description || 'No description provided')}</p>
            <div class="field">
              <label><strong>Status</strong></label>
              <select id="status" style="width:100%">
                <option value="open" ${t.status === 'open' ? 'selected' : ''}>🔴 Open</option>
                <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>🟡 In Progress</option>
                <option value="closed" ${t.status === 'closed' ? 'selected' : ''}>🟢 Closed</option>
              </select>
            </div>
            <div class="field">
              <label><strong>Resolution / Reply</strong></label>
              <textarea id="resolution" rows="3" placeholder="Provide your response or resolution here...">${UI.esc(t.resolution || '')}</textarea>
            </div>`,
          footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save & Respond</button>`,
        });
        m.root.querySelector('[data-close-btn]').onclick = m.close;
        m.root.querySelector('#save').onclick = async () => {
          try {
            await api.put('/tickets/' + t.id, {
              status: m.root.querySelector('#status').value,
              resolution: m.root.querySelector('#resolution').value.trim()
            });
            m.close();
            UI.toast('✅ Ticket updated. Employee will be notified.', 'success');
            this.helpdesk(c);
          }
          catch (e) { UI.toast(e.message, 'error'); }
        };
      };
    });
  },
  ticketTable(tickets, admin) {
    const catIcon = (key) => {
      const cat = this.HR_TICKET_CATEGORIES.find(c => c.key === key);
      return cat ? cat.icon : '❓';
    };
    const catName = (key) => {
      const cat = this.HR_TICKET_CATEGORIES.find(c => c.key === key);
      return cat ? cat.name : (key || 'General');
    };

    const cols = [
      ...(admin ? [{ key: 'employee_name', label: 'Employee' }] : []),
      { key: 'subject', label: 'Subject' },
      { key: 'category', label: 'Category', render: (r) => `${catIcon(r.category)} ${catName(r.category)}` },
      { key: 'status', label: 'Status', render: (r) => {
        const statusIcon = r.status === 'closed' ? '🟢' : (r.status === 'open' ? '🔴' : '🟡');
        const statusColor = r.status === 'closed' ? 'approved' : (r.status === 'open' ? 'pending' : 'leave');
        return `${statusIcon} ${r.status.replace('_', ' ')}`;
      }},
      { key: 'resolution', label: 'Resolution', render: (r) => r.resolution ? UI.esc(r.resolution.substring(0, 40) + (r.resolution.length > 40 ? '...' : '')) : '<span class="muted">—</span>' },
    ];
    if (admin) cols.push({ key: 'act', label: '', render: (r) => `<button class="btn sm secondary" data-manage="${r.id}">Manage</button>` });
    return UI.table(cols, tickets, tickets.length === 0 ? '📭 No tickets in this category.' : '');
  },

  // ---------------- Onboarding section (dedicated page) ----------------
  async onboarding(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { employees } = await api.get('/onboarding');
    const statusOf = (e) => (e.onboarded ? 'done' : (e.total === 0 ? 'notstarted' : (e.done >= e.total ? 'done' : 'inprogress')));
    const pct = (e) => (e.total ? Math.round((e.done / e.total) * 100) : 0);
    const now = new Date();
    const daysSince = (d) => { if (!d) return Infinity; return Math.floor((now - new Date(d + 'T00:00:00')) / 86400000); };
    const newThisMonth = employees.filter((e) => daysSince(e.date_of_joining) <= 31).length;
    const inProg = employees.filter((e) => statusOf(e) === 'inprogress').length;
    const notStarted = employees.filter((e) => statusOf(e) === 'notstarted').length;
    const completed = employees.filter((e) => statusOf(e) === 'done').length;
    const tile = (label, val, color, filter) => `<div class="card ob-tile" data-tile="${filter}" title="Click to show these" style="flex:1;min-width:120px;text-align:center;margin:0;cursor:pointer;transition:box-shadow .15s,transform .1s"><div style="font-size:26px;font-weight:700;color:${color}">${val}</div><div class="muted" style="font-size:12px">${label}</div></div>`;

    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">🚀 Onboarding</div><div class="spacer"></div>
        <input id="obSearch" placeholder="Search name / department" style="max-width:220px" />
        <select id="obFilter">
          <option value="attention">Needs attention</option>
          <option value="all">All employees</option>
          <option value="recent">Joined this month</option>
          <option value="notstarted">Not started</option>
          <option value="inprogress">In progress</option>
          <option value="done">Onboarded / done</option>
        </select>
        <button class="btn" id="obPreboard">➕ Pre-board new hire</button>
        <button class="btn secondary" id="obMarkAll">✓ Mark all as onboarded</button>
      </div>
      <p class="muted" style="margin-top:-4px">Track every new hire's checklist and account setup in one place. Click any card below to filter. Open a person to tick tasks or notify managers/IT to create their accounts.</p>
      <div class="btn-row" style="gap:10px;margin:12px 0 16px;align-items:stretch">
        ${tile('Joined this month', newThisMonth, '#2563eb', 'recent')}
        ${tile('In progress', inProg, '#d97706', 'inprogress')}
        ${tile('Not started', notStarted, '#dc2626', 'notstarted')}
        ${tile('Onboarded', completed, '#16a34a', 'done')}
      </div>
      <div id="obTable"></div>`;

    const reload = () => AdminViews.onboarding(c);
    const preboardBtn = document.getElementById('obPreboard');
    if (preboardBtn) preboardBtn.onclick = () => AdminViews.preboardNewModal(reload);
    const markAll = document.getElementById('obMarkAll');
    if (markAll) markAll.onclick = async () => {
      const pending = employees.filter((e) => !e.onboarded).length;
      if (!pending) return UI.toast('Everyone is already marked onboarded.', 'success');
      if (!confirm(`Mark ${pending} employee(s) who aren't onboarded yet as already onboarded? Use this for staff who joined before you started using the system.`)) return;
      try { const r = await api.post('/onboarding/bulk-complete', { all: true }); UI.toast(`Marked ${r.count} employee(s) as onboarded.`, 'success'); reload(); }
      catch (err) { UI.toast(err.message, 'error'); }
    };
    const badge = (e) => {
      if (e.onboarded) return '<span class="tag" style="background:#dcfce7;color:#166534">✓ Onboarded</span>';
      const s = statusOf(e);
      if (s === 'done') return '<span class="tag" style="background:#dcfce7;color:#166534">Completed</span>';
      if (s === 'inprogress') return '<span class="tag" style="background:#fef3c7;color:#92400e">In progress</span>';
      return '<span class="tag" style="background:#fee2e2;color:#991b1b">Not started</span>';
    };
    const bar = (e) => {
      if (e.onboarded && e.total === 0) return '<span class="muted" style="font-size:11px">— already onboarded —</span>';
      const p = pct(e);
      return `<div style="display:flex;align-items:center;gap:8px;min-width:150px"><div style="flex:1;height:8px;background:#e5e7eb;border-radius:6px;overflow:hidden"><div style="width:${p}%;height:100%;background:${p === 100 ? '#16a34a' : '#2563eb'}"></div></div><span class="muted" style="font-size:11px;white-space:nowrap">${e.done}/${e.total || 0}</span></div>`;
    };
    const renderTable = () => {
      const q = (document.getElementById('obSearch').value || '').toLowerCase();
      const f = document.getElementById('obFilter').value;
      let rows = employees.filter((e) => !q || (e.name || '').toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q));
      if (f === 'notstarted') rows = rows.filter((e) => statusOf(e) === 'notstarted');
      else if (f === 'inprogress') rows = rows.filter((e) => statusOf(e) === 'inprogress');
      else if (f === 'done') rows = rows.filter((e) => statusOf(e) === 'done');
      else if (f === 'attention') rows = rows.filter((e) => statusOf(e) !== 'done');
      else if (f === 'recent') rows = rows.filter((e) => daysSince(e.date_of_joining) <= 31);
      document.querySelectorAll('.ob-tile').forEach((el) => {
        const on = el.dataset.tile === f;
        el.style.boxShadow = on ? '0 0 0 2px #6366f1' : '';
        el.style.transform = on ? 'translateY(-1px)' : '';
      });
      document.getElementById('obTable').innerHTML = UI.table([
        { key: 'name', label: 'Employee', sticky: true, render: (e) => `<b>${UI.esc(e.name)}</b>${e.designation ? `<br><span class="muted" style="font-size:11px">${UI.esc(e.designation)}</span>` : ''}${(e.onboarding_submitted && !e.onboarded) ? '<br><span class="tag" style="background:#dbeafe;color:#1e40af;font-size:10px">📋 Form submitted — review docs</span>' : ''}` },
        { key: 'department', label: 'Department', render: (e) => UI.esc(e.department || '—') },
        { key: 'doj', label: 'Joined', render: (e) => (e.date_of_joining ? UI.esc(e.date_of_joining) : '—') },
        { key: 'progress', label: 'Progress', render: bar },
        { key: 'status', label: 'Status', render: badge },
        { key: 'actions', label: '', render: (e) => {
          const btns = [];
          if (e.total === 0 && !e.onboarded) btns.push(`<button class="btn sm" data-start="${e.id}">Start onboarding</button>`);
          else btns.push(`<button class="btn sm secondary" data-open="${e.id}">Open checklist</button>`);
          if (e.onboarded) btns.push(`<button class="btn sm secondary" data-reopen="${e.id}" title="Mark as not onboarded">Reopen</button>`);
          else btns.push(`<button class="btn sm" data-mark="${e.id}">Mark onboarded</button>`);
          return `<div class="btn-row" style="gap:6px;justify-content:flex-end">${btns.join('')}</div>`;
        } },
      ], rows, 'No employees match this filter.');
      document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => {
        const e = employees.find((x) => x.id == b.dataset.open);
        AdminViews.onboardingModal(e.id, e.name, reload);
      });
      document.querySelectorAll('[data-start]').forEach((b) => b.onclick = async () => {
        const e = employees.find((x) => x.id == b.dataset.start);
        try { await api.post('/onboarding/' + e.id + '/template'); UI.toast('Onboarding started — checklist added & managers notified.', 'success'); reload(); }
        catch (err) { UI.toast(err.message, 'error'); }
      });
      document.querySelectorAll('[data-mark]').forEach((b) => b.onclick = async () => {
        try { await api.post('/onboarding/' + b.dataset.mark + '/complete'); UI.toast('Marked as onboarded.', 'success'); reload(); }
        catch (err) { UI.toast(err.message, 'error'); }
      });
      document.querySelectorAll('[data-reopen]').forEach((b) => b.onclick = async () => {
        try { await api.post('/onboarding/' + b.dataset.reopen + '/reopen'); UI.toast('Onboarding reopened.', 'success'); reload(); }
        catch (err) { UI.toast(err.message, 'error'); }
      });
    };
    document.getElementById('obSearch').oninput = renderTable;
    document.getElementById('obFilter').onchange = renderTable;
    document.querySelectorAll('.ob-tile').forEach((el) => el.onclick = () => {
      document.getElementById('obFilter').value = el.dataset.tile;
      renderTable();
    });
    renderTable();
  },

  // ---------------- Pre-board a new hire (candidate, no login) ----------------
  preboardNewModal(reload) {
    const m = UI.modal({
      title: '➕ Pre-board a new hire',
      bodyHtml: `
        <p class="muted" style="font-size:13px;margin-top:0">Create a candidate record and get a private link to send them — with your intent-of-hiring or offer email. They fill their details and upload documents <b>before Day 1, with no company login</b>. Everything lands straight in the HRMS.</p>
        <div class="form-grid">
          <div class="field"><label>Full Name *</label><input id="pbName" /></div>
          <div class="field"><label>Personal Email</label><input id="pbEmail" type="email" /></div>
          <div class="field"><label>Department</label><input id="pbDept" /></div>
          <div class="field"><label>Designation</label><input id="pbDesig" /></div>
          <div class="field"><label>Date of Joining</label><input id="pbDoj" type="date" /></div>
        </div>
        <div id="pbResult" style="margin-top:12px"></div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Close</button><button class="btn" id="pbCreate">Create & get link</button>`,
    });
    const close = () => { m.close(); if (reload) reload(); };
    m.root.querySelector('[data-close-btn]').onclick = close;
    m.root.querySelector('[data-close]').onclick = close;
    m.root.querySelector('#pbCreate').onclick = async () => {
      const name = m.root.querySelector('#pbName').value.trim();
      if (!name) return UI.toast('Candidate name is required.', 'error');
      try {
        const r = await api.post('/onboarding/preboard', {
          name,
          personal_email: m.root.querySelector('#pbEmail').value.trim(),
          department: m.root.querySelector('#pbDept').value.trim(),
          designation: m.root.querySelector('#pbDesig').value.trim(),
          date_of_joining: m.root.querySelector('#pbDoj').value,
        });
        const when = r.expiresAt ? new Date(r.expiresAt).toLocaleString() : '';
        m.root.querySelector('#pbResult').innerHTML = `
          <div class="card" style="border-left:4px solid #16a34a">
            <b>✓ Candidate created.</b> Share this private link with them:
            <div class="btn-row mt" style="align-items:center"><input id="pbNewUrl" readonly value="${UI.esc(r.url)}" style="flex:1" /><button class="btn sm" id="pbNewCopy">Copy</button></div>
            <p class="muted" style="font-size:11px;margin:6px 0 0">⏳ Active for ${r.hours || 4} hours${when ? ` — until <b>${UI.esc(when)}</b>` : ''}. Paste it into your intent/offer email (or Leegality flow). It works with no login.</p>
          </div>`;
        m.root.querySelector('#pbNewCopy').onclick = async () => {
          try { await navigator.clipboard.writeText(r.url); UI.toast('Link copied.', 'success'); } catch { UI.toast('Copy failed — select the text manually.', 'error'); }
        };
        UI.toast('Candidate pre-boarding created.', 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  // ---------------- Onboarding journey (modal) ----------------
  async onboardingModal(employeeId, name, onClose) {
    const m = UI.modal({
      title: '🚀 Onboarding journey — ' + (name || ''),
      bodyHtml: `<div id="ob" class="muted">Loading…</div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Close</button>`,
    });
    const closeAnd = () => { m.close(); if (onClose) onClose(); };
    m.root.querySelector('[data-close-btn]').onclick = closeAnd;
    m.root.querySelector('[data-close]').onclick = closeAnd;
    const overlay = m.root.querySelector('[data-overlay]');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay && onClose) onClose(); });

    const OWNER = { employee: { l: 'New hire', i: '👤', c: '#6366f1' }, hr: { l: 'HR', i: '🧑‍💼', c: '#0ea5e9' }, it: { l: 'IT', i: '💻', c: '#8b5cf6' }, manager: { l: 'Manager', i: '👔', c: '#f59e0b' } };
    const today = new Date().toISOString().slice(0, 10);

    const load = async () => {
      const { tasks, stages, preboard } = await api.get('/onboarding/' + employeeId);
      const body = m.root.querySelector('#ob');
      const pb = preboard || {};

      if (!tasks.length) {
        body.innerHTML = `<div class="empty" style="padding:18px">No onboarding journey yet.</div>
          <div class="btn-row"><button class="btn" id="startJourney">🚀 Start automated onboarding</button></div>`;
        body.querySelector('#startJourney').onclick = async () => {
          try { await api.post('/onboarding/' + employeeId + '/template'); UI.toast('Automated onboarding journey started.', 'success'); load(); }
          catch (e) { UI.toast(e.message, 'error'); }
        };
        return;
      }

      const done = tasks.filter((t) => t.done).length;
      const pctAll = Math.round((done / tasks.length) * 100);
      const autoDone = tasks.filter((t) => t.done && t.done_by === 'system').length;
      const order = (stages && stages.length) ? stages : ['Pre-boarding', 'Day 1', 'Week 1', 'First 30 Days'];
      const groups = {};
      tasks.forEach((t) => { (groups[t.stage || 'Other'] = groups[t.stage || 'Other'] || []).push(t); });
      const stageOrder = [...order.filter((s) => groups[s]), ...Object.keys(groups).filter((s) => !order.includes(s))];

      const taskRow = (t) => {
        const o = OWNER[t.owner] || { l: t.owner || '', i: '•', c: '#94a3b8' };
        const overdue = !t.done && t.due_date && t.due_date < today;
        const auto = t.auto_key
          ? `<span class="tag" style="background:#ecfeff;color:#0e7490;font-size:10px" title="Completes automatically">⚡ auto</span>`
          : '';
        const sysDone = t.done && t.done_by === 'system' ? ' <span class="muted" style="font-size:10px">(auto)</span>' : '';
        const due = t.due_date ? `<span class="muted" style="font-size:11px;${overdue ? 'color:#dc2626;font-weight:600' : ''}">${overdue ? '⚠ ' : ''}${UI.date(t.due_date)}</span>` : '';
        return `<div class="doc-row" style="align-items:center">
          <div style="display:flex;align-items:center;gap:8px;flex:1">
            <input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''} ${t.auto_key ? 'title="Auto task — completes by itself, but you can override"' : ''}/>
            <span style="${t.done ? 'text-decoration:line-through;color:#94a3b8' : ''}">${UI.esc(t.title)}${sysDone}</span> ${auto}
          </div>
          <span class="tag" style="background:${o.c}22;color:${o.c};font-size:10px">${o.i} ${o.l}</span>
          <div style="min-width:78px;text-align:right">${due}</div>
          <button class="btn sm red" data-tdel="${t.id}" title="Remove" style="margin-left:6px">✕</button>
        </div>`;
      };

      const stageBlocks = stageOrder.map((s) => {
        const list = groups[s];
        const d = list.filter((t) => t.done).length;
        const p = Math.round((d / list.length) * 100);
        return `<div style="margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <div style="font-weight:700">${UI.esc(s)}</div>
            <div style="flex:1;height:6px;background:#e5e7eb;border-radius:6px;overflow:hidden"><div style="width:${p}%;height:100%;background:${p === 100 ? '#16a34a' : '#2563eb'}"></div></div>
            <span class="muted" style="font-size:11px">${d}/${list.length}</span>
          </div>
          <div class="doc-list">${list.map(taskRow).join('')}</div>
        </div>`;
      }).join('');

      const pbWhen = pb.expiresAt ? new Date(pb.expiresAt).toLocaleString() : '';
      const pbInner = (pb.hasLink && !pb.expired) ? `
            <div class="btn-row" style="align-items:center"><input id="pbUrl" readonly value="${UI.esc(pb.url || '')}" style="flex:1" /><button class="btn sm" id="pbCopy">Copy</button></div>
            <div class="muted" style="font-size:11px;margin-top:6px">Send this private link to the candidate (e.g. with the intent/offer email). They fill details & upload documents — no login needed.${pbWhen ? ` <b>· ⏳ Active until ${UI.esc(pbWhen)}</b>` : ' <b>· No time limit set (older link) — click Regenerate to apply the expiry</b>'}${pb.submitted ? ' <b style="color:#16a34a">· Submitted ✓</b>' : ''}</div>
            <div class="btn-row mt"><button class="btn sm secondary" id="pbRegen">Regenerate</button><button class="btn sm red" id="pbRevoke">Revoke</button></div>
          ` : (pb.hasLink && pb.expired) ? `
            <div class="tag" style="background:#fee2e2;color:#991b1b">⏳ Link expired${pbWhen ? ' on ' + UI.esc(pbWhen) : ''}</div>
            <p class="muted" style="font-size:11px;margin:6px 0 8px">The candidate can no longer open it. Generate a new one to reactivate access.</p>
            <div class="btn-row"><button class="btn sm" id="pbGen">Generate new link</button><button class="btn sm red" id="pbRevoke">Revoke</button></div>
          ` : `
            <p class="muted" style="font-size:12px;margin:4px 0 8px">Generate a secure link the candidate can use before Day 1 — no company credentials required.</p>
            <button class="btn sm" id="pbGen">Generate pre-boarding link</button>
          `;
      const preboardCard = `
        <div class="card" style="margin-bottom:14px;border-left:4px solid #6366f1">
          <div class="section-title" style="font-size:14px">🔗 Pre-boarding link <span class="muted" style="font-weight:400;font-size:12px">— for candidates who don't have a company login yet</span></div>
          ${pbInner}
        </div>`;

      body.innerHTML = `
        <div class="card" style="background:#f8fafc;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:30px;font-weight:800;color:${pctAll === 100 ? '#16a34a' : '#2563eb'}">${pctAll}%</div>
            <div style="flex:1">
              <div style="height:9px;background:#e5e7eb;border-radius:6px;overflow:hidden"><div style="width:${pctAll}%;height:100%;background:${pctAll === 100 ? '#16a34a' : '#2563eb'}"></div></div>
              <div class="muted" style="font-size:12px;margin-top:4px">${done}/${tasks.length} steps done · ⚡ ${autoDone} completed automatically</div>
            </div>
          </div>
          <div class="btn-row mt">
            <button class="btn sm" id="runAuto">⚡ Run automation</button>
            <button class="btn sm secondary" id="remind">🔔 Send reminders</button>
            <button class="btn sm secondary" id="rebuild" title="Reset to the standard journey">↻ Rebuild</button>
          </div>
        </div>
        ${preboardCard}
        ${stageBlocks}
        <div class="btn-row mt"><input id="newtask" placeholder="Add a custom step" /><button class="btn secondary" id="addtask">Add</button></div>`;

      const pbCopy = body.querySelector('#pbCopy');
      if (pbCopy) pbCopy.onclick = async () => { try { await navigator.clipboard.writeText(body.querySelector('#pbUrl').value); UI.toast('Link copied.', 'success'); } catch { UI.toast('Copy failed — select the text manually.', 'error'); } };
      const pbGen = body.querySelector('#pbGen');
      if (pbGen) pbGen.onclick = async () => { try { await api.post('/onboarding/' + employeeId + '/preboard-link'); UI.toast('Pre-boarding link generated.', 'success'); load(); } catch (e) { UI.toast(e.message, 'error'); } };
      const pbRegen = body.querySelector('#pbRegen');
      if (pbRegen) pbRegen.onclick = async () => { if (!confirm('Generate a new link? The old one will stop working immediately.')) return; try { await api.post('/onboarding/' + employeeId + '/preboard-link', { regenerate: true }); UI.toast('New link generated.', 'success'); load(); } catch (e) { UI.toast(e.message, 'error'); } };
      const pbRevoke = body.querySelector('#pbRevoke');
      if (pbRevoke) pbRevoke.onclick = async () => { if (!confirm('Revoke this link? The candidate will no longer be able to access it.')) return; try { await api.post('/onboarding/' + employeeId + '/preboard-revoke'); UI.toast('Link revoked.', 'success'); load(); } catch (e) { UI.toast(e.message, 'error'); } };

      body.querySelectorAll('[data-task]').forEach((el) => el.onchange = async () => {
        try { await api.put('/onboarding/task/' + el.dataset.task, { done: el.checked }); load(); } catch (e) { UI.toast(e.message, 'error'); }
      });
      body.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = async () => {
        try { await api.request('DELETE', '/onboarding/task/' + b.dataset.tdel); load(); } catch (e) { UI.toast(e.message, 'error'); }
      });
      body.querySelector('#addtask').onclick = async () => {
        const title = body.querySelector('#newtask').value.trim(); if (!title) return;
        try { await api.post('/onboarding/' + employeeId, { title }); load(); } catch (e) { UI.toast(e.message, 'error'); }
      };
      body.querySelector('#runAuto').onclick = async () => {
        try { const r = await api.post('/onboarding/' + employeeId + '/sync'); UI.toast(r.autoCompleted ? `⚡ ${r.autoCompleted} step(s) auto-completed.` : 'Nothing new to auto-complete yet.', 'success'); if (r.justOnboarded) UI.celebrate && UI.celebrate(); load(); }
        catch (e) { UI.toast(e.message, 'error'); }
      };
      body.querySelector('#remind').onclick = async () => {
        try { const r = await api.post('/onboarding/' + employeeId + '/remind'); UI.toast(r.pending ? `🔔 Reminded ${r.notified} owner(s) about ${r.pending} pending step(s).` : 'Nothing pending — no reminders sent.', 'success'); }
        catch (e) { UI.toast(e.message, 'error'); }
      };
      body.querySelector('#rebuild').onclick = async () => {
        if (!confirm('Reset this person to the standard onboarding journey? Custom steps will be removed.')) return;
        try { await api.post('/onboarding/' + employeeId + '/rebuild'); UI.toast('Journey rebuilt.', 'success'); load(); } catch (e) { UI.toast(e.message, 'error'); }
      };
    };
    load();
  },

  // ---------------- Recruitment (ATS): jobs list ----------------
  async recruitment(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { jobs } = await api.get('/recruitment/jobs');
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Recruitment</div><div class="spacer"></div><button class="btn" id="newJob">+ New Job</button></div>
      <div class="cards">${jobs.length ? jobs.map((j) => `
        <div class="card">
          <div style="display:flex;align-items:start;gap:8px">
            <div style="flex:1">
              <div style="font-weight:650;font-size:16px">${UI.esc(j.title)}</div>
              <div class="muted" style="font-size:12px">${UI.esc([j.department, j.location, j.type].filter(Boolean).join(' · '))}</div>
            </div>
            <span class="tag ${j.status === 'open' ? 'approved' : 'inactive'}">${j.status}</span>
          </div>
          <div class="mt" style="font-size:13px"><b>${j.applicants}</b> applicants · <b>${j.hired}</b> hired</div>
          <div class="btn-row mt">
            <button class="btn sm" data-open="${j.id}">Open Pipeline</button>
            <button class="btn sm secondary" data-linkedin="${j.id}">Post on LinkedIn</button>
            <button class="btn sm secondary" data-edit="${j.id}">Edit</button>
            <button class="btn sm red" data-del="${j.id}">Delete</button>
          </div>
        </div>`).join('') : '<div class="empty">No job openings yet. Click “New Job”.</div>'}</div>`;

    document.getElementById('newJob').onclick = () => this.jobForm(c, null);
    document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => this.jobBoard(c, b.dataset.open));
    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => this.jobForm(c, jobs.find((j) => j.id == b.dataset.edit)));
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this job and all its applicants?')) return;
      try { await api.request('DELETE', '/recruitment/jobs/' + b.dataset.del); UI.toast('Deleted.', 'success'); this.recruitment(c); }
      catch (e) { UI.toast(e.message, 'error'); }
    });
    document.querySelectorAll('[data-linkedin]').forEach((b) => b.onclick = () => {
      const j = jobs.find((x) => x.id == b.dataset.linkedin);
      const text = `${j.title}${j.location ? ' — ' + j.location : ''}\n${j.type || ''}\n\n${j.description || ''}\n\nRequired skills: ${j.skills || '-'}\nMin experience: ${j.min_experience || 0} yrs`;
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
      UI.toast('Job details copied — paste them into LinkedIn.', 'success');
      window.open('https://www.linkedin.com/job-posting/', '_blank');
    });
  },

  jobForm(c, job) {
    const f = (k) => job && job[k] != null ? UI.esc(job[k]) : '';
    const m = UI.modal({
      title: job ? 'Edit Job' : 'New Job Opening',
      bodyHtml: `
        <div class="form-grid">
          <div class="field"><label>Title *</label><input id="title" value="${f('title')}" /></div>
          <div class="field"><label>Department</label><input id="department" value="${f('department')}" /></div>
          <div class="field"><label>Location</label><input id="location" value="${f('location')}" /></div>
          <div class="field"><label>Type</label><select id="type">${['Full-time', 'Part-time', 'Contract', 'Intern'].map((t) => `<option ${job && job.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label>Required Skills (comma separated)</label><input id="skills" value="${f('skills')}" placeholder="e.g. React, Node, SQL" /></div>
          <div class="field"><label>Min Experience (years)</label><input type="number" step="0.5" id="min_experience" value="${job ? job.min_experience : 0}" /></div>
          <div class="field full"><label>Description</label><textarea id="description" rows="4">${f('description')}</textarea></div>
          ${job ? `<div class="field"><label>Status</label><select id="status"><option value="open" ${job.status === 'open' ? 'selected' : ''}>open</option><option value="closed" ${job.status === 'closed' ? 'selected' : ''}>closed</option></select></div>` : ''}
        </div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      const data = { title: m.root.querySelector('#title').value, department: m.root.querySelector('#department').value, location: m.root.querySelector('#location').value, type: m.root.querySelector('#type').value, skills: m.root.querySelector('#skills').value, min_experience: m.root.querySelector('#min_experience').value, description: m.root.querySelector('#description').value };
      if (job) data.status = m.root.querySelector('#status').value;
      try { if (job) await api.put('/recruitment/jobs/' + job.id, data); else await api.post('/recruitment/jobs', data); m.close(); UI.toast('Saved.', 'success'); this.recruitment(c); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  // ---------------- Recruitment pipeline board ----------------
  STAGES: [['applied', 'Applied'], ['shortlisted', 'Shortlisted'], ['interview', 'Interview'], ['offer', 'Offer'], ['hired', 'Hired'], ['rejected', 'Rejected']],
  async jobBoard(c, jobId) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { job, applicants } = await api.get('/recruitment/jobs/' + jobId);
    const stageOpts = (cur) => this.STAGES.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
    const cols = this.STAGES.map(([sv, sl]) => {
      const cards = applicants.filter((a) => a.stage === sv).map((a) => `
        <div class="kcard">
          <div style="display:flex;justify-content:space-between;gap:6px"><b>${UI.esc(a.name)}</b><span class="tag ${a.score >= 60 ? 'approved' : (a.score >= 40 ? 'pending' : 'rejected')}">${a.score != null ? a.score + '%' : '-'}</span></div>
          <div class="muted" style="font-size:12px">${UI.esc(a.experience_years || 0)} yrs · ${UI.esc((a.skills || '').slice(0, 40))}</div>
          <div class="muted" style="font-size:11px">${UI.esc(a.email || '')}</div>
          <div class="btn-row mt" style="gap:4px">
            <select class="kmove" data-id="${a.id}" style="font-size:11px;padding:3px 6px;width:auto">${stageOpts(a.stage)}</select>
            ${a.resume_file ? `<a class="btn sm secondary" href="/api/recruitment/applicants/${a.id}/resume" target="_blank">CV</a>` : ''}
            <button class="btn sm secondary" data-screen="${a.id}" data-sname="${UI.esc(a.name)}">✨ Screen</button>
            <button class="btn sm secondary" data-iv="${a.id}" data-name="${UI.esc(a.name)}" data-email="${UI.esc(a.email || '')}">Interview</button>
            <button class="btn sm green" data-hire="${a.id}">Hire</button>
          </div>
        </div>`).join('');
      return `<div class="kcol"><div class="kcol-head">${sl} <span class="muted">${applicants.filter((a) => a.stage === sv).length}</span></div>${cards || '<div class="muted" style="font-size:12px;padding:6px">—</div>'}</div>`;
    }).join('');

    c.innerHTML = `
      <div class="toolbar">
        <button class="btn sm secondary" id="back">← Jobs</button>
        <div class="section-title" style="margin:0">${UI.esc(job.title)}</div>
        <span class="tag ${job.status === 'open' ? 'approved' : 'inactive'}">${job.status}</span>
        <div class="spacer"></div>
        <button class="btn secondary" id="auto">⚡ Auto-shortlist</button>
        <button class="btn" id="addApp">+ Add Applicant</button>
      </div>
      <div class="kanban">${cols}</div>`;

    document.getElementById('back').onclick = () => this.recruitment(c);
    document.getElementById('addApp').onclick = () => this.applicantForm(c, jobId);
    document.getElementById('auto').onclick = async () => {
      try { const r = await api.post('/recruitment/jobs/' + jobId + '/auto-shortlist'); UI.toast(`Shortlisted ${r.shortlisted} of ${r.evaluated} (≥${r.threshold}% match).`, 'success'); this.jobBoard(c, jobId); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    c.querySelectorAll('.kmove').forEach((s) => s.onchange = async () => {
      try { await api.put('/recruitment/applicants/' + s.dataset.id, { stage: s.value }); this.jobBoard(c, jobId); }
      catch (e) { UI.toast(e.message, 'error'); }
    });
    c.querySelectorAll('[data-screen]').forEach((b) => b.onclick = async () => {
      const m = UI.modal({ title: '✨ AI Screening — ' + b.dataset.sname, bodyHtml: '<div class="muted">Screening against the job…</div>', footHtml: '<button class="btn secondary" data-close-btn>Close</button>' });
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      try {
        const r = await api.post('/ai/screen/' + b.dataset.screen, {});
        const sc = r.screening || {};
        const recColor = sc.recommendation === 'strong' ? '#16a34a' : sc.recommendation === 'weak' ? '#dc2626' : '#d97706';
        m.root.querySelector('.body').innerHTML = `
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
            <div style="font-size:34px;font-weight:800;color:${recColor}">${sc.score != null ? sc.score : '—'}<span style="font-size:14px;color:#9ca3af">/100</span></div>
            <div><span class="tag" style="background:${recColor};color:#fff">${UI.esc(sc.recommendation || 'n/a')} fit</span></div>
          </div>
          <p style="font-size:14px">${UI.esc(sc.summary || '')}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px">
            <div><b style="color:#16a34a;font-size:13px">Strengths</b><ul style="font-size:13px;margin:6px 0 0;padding-left:18px">${(sc.strengths || []).map((x) => '<li>' + UI.esc(x) + '</li>').join('') || '<li class="muted">—</li>'}</ul></div>
            <div><b style="color:#dc2626;font-size:13px">Concerns</b><ul style="font-size:13px;margin:6px 0 0;padding-left:18px">${(sc.concerns || []).map((x) => '<li>' + UI.esc(x) + '</li>').join('') || '<li class="muted">—</li>'}</ul></div>
          </div>
          <p class="muted" style="font-size:11px;margin-top:12px">AI guidance only — make your own hiring decision. Based on the details on file.</p>`;
      } catch (e) { m.root.querySelector('.body').innerHTML = '<div style="color:#dc2626">' + UI.esc(e.message) + '</div>'; }
    });
    c.querySelectorAll('[data-hire]').forEach((b) => b.onclick = async () => {
      if (!confirm('Hire this candidate? This creates an employee + onboarding checklist.')) return;
      try { const r = await api.post('/recruitment/applicants/' + b.dataset.hire + '/hire'); UI.toast('Hired! Employee created' + (r.tempPassword ? ' (temp password: ' + r.tempPassword + ')' : '') + '.', 'success'); this.jobBoard(c, jobId); }
      catch (e) { UI.toast(e.message, 'error'); }
    });
    c.querySelectorAll('[data-iv]').forEach((b) => b.onclick = () => this.scheduleInterview(c, jobId, b.dataset.iv, b.dataset.name, b.dataset.email));
  },

  applicantForm(c, jobId) {
    const m = UI.modal({
      title: 'Add Applicant',
      bodyHtml: `
        <div class="form-grid">
          <div class="field"><label>Name *</label><input id="name" /></div>
          <div class="field"><label>Email</label><input id="email" /></div>
          <div class="field"><label>Phone</label><input id="phone" /></div>
          <div class="field"><label>Experience (years)</label><input type="number" step="0.5" id="exp" value="0" /></div>
          <div class="field full"><label>Skills (comma separated)</label><input id="skills" placeholder="e.g. React, Node, SQL" /></div>
          <div class="field"><label>Source</label><input id="source" placeholder="LinkedIn / Referral / ..." /></div>
          <div class="field"><label>Resume (optional)</label><input type="file" id="resume" /></div>
        </div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Add</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      const fd = new FormData();
      fd.append('name', m.root.querySelector('#name').value);
      fd.append('email', m.root.querySelector('#email').value);
      fd.append('phone', m.root.querySelector('#phone').value);
      fd.append('experience_years', m.root.querySelector('#exp').value);
      fd.append('skills', m.root.querySelector('#skills').value);
      fd.append('source', m.root.querySelector('#source').value);
      const file = m.root.querySelector('#resume').files[0];
      if (file) fd.append('resume', file);
      try { const r = await api.upload('/recruitment/jobs/' + jobId + '/applicants', fd); m.close(); UI.toast('Added — match score ' + r.score + '%.', 'success'); this.jobBoard(c, jobId); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  scheduleInterview(c, jobId, applicantId, name, email) {
    const m = UI.modal({
      title: 'Schedule Interview — ' + name,
      bodyHtml: `
        <div class="form-grid">
          <div class="field"><label>Round</label><input id="round" value="Interview" /></div>
          <div class="field"><label>Mode</label><select id="mode"><option>Online</option><option>In-person</option></select></div>
          <div class="field"><label>Date & Time</label><input type="datetime-local" id="when" /></div>
          <div class="field"><label>Duration (min)</label><input type="number" id="dur" value="45" /></div>
          <div class="field"><label>Interviewer name</label><input id="ivname" /></div>
          <div class="field"><label>Interviewer email</label><input id="ivemail" /></div>
        </div>
        <p class="muted" style="font-size:12px">On save, this opens Google Calendar with the event pre-filled (candidate + interviewer invited).</p>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save & Open Calendar</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      const when = m.root.querySelector('#when').value;
      if (!when) { UI.toast('Pick a date & time.', 'error'); return; }
      const round = m.root.querySelector('#round').value, mode = m.root.querySelector('#mode').value;
      const ivname = m.root.querySelector('#ivname').value, ivemail = m.root.querySelector('#ivemail').value;
      const dur = Number(m.root.querySelector('#dur').value) || 45;
      try {
        await api.post('/recruitment/applicants/' + applicantId + '/interviews', { round, mode, scheduled_at: new Date(when).toISOString(), interviewer: ivname, interviewer_email: ivemail });
        // Build Google Calendar link
        const fmt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const start = fmt(when), end = fmt(new Date(new Date(when).getTime() + dur * 60000));
        const guests = [email, ivemail].filter(Boolean).join(',');
        const u = new URL('https://calendar.google.com/calendar/render');
        u.searchParams.set('action', 'TEMPLATE');
        u.searchParams.set('text', `${round}: ${name}`);
        u.searchParams.set('dates', `${start}/${end}`);
        u.searchParams.set('details', `${mode} interview with ${name}.${ivname ? ' Interviewer: ' + ivname : ''}`);
        if (guests) u.searchParams.set('add', guests);
        window.open(u.toString(), '_blank');
        m.close(); UI.toast('Interview scheduled — opening Google Calendar.', 'success'); this.jobBoard(c, jobId);
      } catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  // ============================================================
  // HR OPERATIONS INVENTORY
  // ============================================================
  INVENTORY_CATEGORIES: [
    { key: 'electronics', icon: '💻', name: 'Electronics',      color: '#3b82f6' },
    { key: 'furniture',   icon: '🪑', name: 'Furniture',        color: '#8b5cf6' },
    { key: 'equipment',   icon: '🖨️', name: 'Office Equipment', color: '#f59e0b' },
    { key: 'network',     icon: '🌐', name: 'Network',          color: '#10b981' },
    { key: 'stationery',  icon: '📦', name: 'Stationery',       color: '#6b7280' },
    { key: 'software',    icon: '📋', name: 'Software / Licenses', color: '#ec4899' },
    { key: 'access',      icon: '🔑', name: 'Access & Security', color: '#f97316' },
    { key: 'other',       icon: '📁', name: 'Other',            color: '#64748b' },
  ],

  async inventory(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [{ items }, { stats, totals }] = await Promise.all([
      api.get('/inventory'),
      api.get('/inventory/stats'),
    ]);
    const { employees } = await api.get('/employees').catch(() => ({ employees: [] }));

    const catMeta = (key) => this.INVENTORY_CATEGORIES.find(x => x.key === key) || { icon: '📁', name: key, color: '#64748b' };
    const condBadge = (c) => {
      const map = { good: ['#d1fae5','#065f46','Good'], fair: ['#fef9c3','#854d0e','Fair'], damaged: ['#fee2e2','#991b1b','Damaged'] };
      const [bg, fg, label] = map[c] || ['#f3f4f6','#374151', c];
      return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${label}</span>`;
    };

    // Summary stat cards
    const statCards = this.INVENTORY_CATEGORIES.map(cat => {
      const s = stats.find(x => x.category === cat.key);
      if (!s) return '';
      return `
        <div class="inv-cat-card" data-filter="${cat.key}" style="background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;padding:14px 16px;cursor:pointer;transition:all .15s;min-width:130px">
          <div style="font-size:22px;margin-bottom:4px">${cat.icon}</div>
          <div style="font-weight:700;font-size:14px;color:#111">${cat.name}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px">${s.total_items} items · ${s.available_qty}/${s.total_qty} available</div>
        </div>`;
    }).join('');

    c.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div class="section-title" style="margin:0">📦 HR Operations Inventory</div>
        <button class="btn" id="inv-add">+ Add Item</button>
      </div>

      <!-- Summary cards -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;padding:16px;background:#f8fafc;border-radius:10px;align-items:flex-start">
        <div style="min-width:130px;border-right:2px solid #e5e7eb;padding-right:16px;margin-right:6px">
          <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Total Items</div>
          <div style="font-size:28px;font-weight:800;color:#111">${totals.total_items || 0}</div>
          <div style="font-size:12px;color:#6b7280">${totals.available_qty || 0} available</div>
          <div style="font-size:12px;color:#6b7280">₹${((totals.total_value || 0)/1000).toFixed(0)}k total value</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;flex:1">${statCards}</div>
      </div>

      <!-- Filter tabs -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        <button class="inv-tab" data-filter="all" style="padding:6px 14px;border:none;background:#4f46e5;color:#fff;border-radius:20px;cursor:pointer;font-size:13px;font-weight:600">📋 All</button>
        ${this.INVENTORY_CATEGORIES.map(cat => `
          <button class="inv-tab" data-filter="${cat.key}" style="padding:6px 14px;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:20px;cursor:pointer;font-size:13px">
            ${cat.icon} ${cat.name}
          </button>
        `).join('')}
      </div>

      <!-- Items table -->
      <div id="inv-table-container">
        ${this._invTable(items, catMeta, condBadge)}
      </div>`;

    // Tab filter logic
    const filterTable = (filterKey) => {
      document.querySelectorAll('.inv-tab').forEach(b => {
        const active = b.dataset.filter === filterKey;
        b.style.background = active ? '#4f46e5' : '#fff';
        b.style.color = active ? '#fff' : '#374151';
        b.style.border = active ? '1px solid #4f46e5' : '1px solid #e5e7eb';
      });
      const filtered = filterKey === 'all' ? items : items.filter(x => x.category === filterKey);
      document.getElementById('inv-table-container').innerHTML = this._invTable(filtered, catMeta, condBadge);
      bindRowButtons();
    };

    document.querySelectorAll('.inv-tab').forEach(b => b.onclick = () => filterTable(b.dataset.filter));
    document.querySelectorAll('.inv-cat-card').forEach(card => {
      card.onmouseenter = () => { card.style.borderColor = '#4f46e5'; card.style.background = '#f5f3ff'; };
      card.onmouseleave = () => { card.style.borderColor = '#e5e7eb'; card.style.background = '#fff'; };
      card.onclick = () => filterTable(card.dataset.filter);
    });

    // Open add/edit modal
    const openModal = (item) => {
      const isEdit = !!item;
      const empOptions = employees.map(e => `<option value="${e.id}" ${item && item.assigned_to == e.id ? 'selected' : ''}>${UI.esc(e.name)}</option>`).join('');
      const catOptions = this.INVENTORY_CATEGORIES.map(cat =>
        `<option value="${cat.key}" ${(item ? item.category : '') === cat.key ? 'selected' : ''}>${cat.icon} ${cat.name}</option>`
      ).join('');

      const m = UI.modal({
        title: isEdit ? `✏️ Edit — ${UI.esc(item.name)}` : '+ Add Inventory Item',
        bodyHtml: `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field" style="grid-column:1/-1">
              <label><strong>Item Name *</strong></label>
              <input id="inv-name" value="${isEdit ? UI.esc(item.name) : ''}" placeholder="e.g. MacBook Pro 14-inch" style="width:100%" />
            </div>
            <div class="field">
              <label><strong>Category *</strong></label>
              <select id="inv-cat" style="width:100%">
                <option value="">— Select —</option>${catOptions}
              </select>
            </div>
            <div class="field">
              <label><strong>Condition</strong></label>
              <select id="inv-cond" style="width:100%">
                <option value="good" ${!item || item.condition === 'good' ? 'selected' : ''}>✅ Good</option>
                <option value="fair" ${item && item.condition === 'fair' ? 'selected' : ''}>⚠️ Fair</option>
                <option value="damaged" ${item && item.condition === 'damaged' ? 'selected' : ''}>❌ Damaged</option>
              </select>
            </div>
            <div class="field">
              <label><strong>Total Quantity</strong></label>
              <input id="inv-qty" type="number" min="0" value="${isEdit ? item.quantity : 1}" style="width:100%" />
            </div>
            <div class="field">
              <label><strong>Available</strong></label>
              <input id="inv-avail" type="number" min="0" value="${isEdit ? item.available : 1}" style="width:100%" />
            </div>
            <div class="field">
              <label><strong>Purchase Price (₹)</strong></label>
              <input id="inv-price" type="number" min="0" value="${isEdit ? item.purchase_price : ''}" placeholder="0" style="width:100%" />
            </div>
            <div class="field">
              <label><strong>Purchase Date</strong></label>
              <input id="inv-date" type="date" value="${isEdit && item.purchase_date ? item.purchase_date : ''}" style="width:100%" />
            </div>
            <div class="field">
              <label><strong>Serial / Asset No.</strong></label>
              <input id="inv-serial" value="${isEdit && item.serial_number ? UI.esc(item.serial_number) : ''}" placeholder="Optional" style="width:100%" />
            </div>
            <div class="field">
              <label><strong>Assigned To</strong></label>
              <select id="inv-emp" style="width:100%">
                <option value="">— Unassigned —</option>${empOptions}
              </select>
            </div>
            <div class="field" style="grid-column:1/-1">
              <label><strong>Notes</strong></label>
              <textarea id="inv-notes" rows="2" style="width:100%">${isEdit && item.notes ? UI.esc(item.notes) : ''}</textarea>
            </div>
          </div>`,
        footHtml: `
          ${isEdit ? `<button class="btn secondary" id="inv-del" style="margin-right:auto;background:#fee2e2;color:#dc2626;border:none">🗑 Delete</button>` : ''}
          <button class="btn secondary" data-close-btn>Cancel</button>
          <button class="btn" id="inv-save">${isEdit ? 'Save Changes' : 'Add Item'}</button>`,
      });

      m.root.querySelector('[data-close-btn]').onclick = m.close;

      if (isEdit) {
        m.root.querySelector('#inv-del').onclick = async () => {
          if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
          try { await api.request('DELETE', '/inventory/' + item.id); m.close(); UI.toast('Item deleted.', 'success'); this.inventory(c); }
          catch (e) { UI.toast(e.message, 'error'); }
        };
      }

      m.root.querySelector('#inv-save').onclick = async () => {
        const name = m.root.querySelector('#inv-name').value.trim();
        const category = m.root.querySelector('#inv-cat').value;
        if (!name) { UI.toast('Item name is required.', 'error'); return; }
        if (!category) { UI.toast('Please select a category.', 'error'); return; }
        const payload = {
          name, category,
          condition: m.root.querySelector('#inv-cond').value,
          quantity: m.root.querySelector('#inv-qty').value,
          available: m.root.querySelector('#inv-avail').value,
          purchase_price: m.root.querySelector('#inv-price').value,
          purchase_date: m.root.querySelector('#inv-date').value || null,
          serial_number: m.root.querySelector('#inv-serial').value.trim() || null,
          assigned_to: m.root.querySelector('#inv-emp').value || null,
          notes: m.root.querySelector('#inv-notes').value.trim() || null,
        };
        try {
          if (isEdit) await api.put('/inventory/' + item.id, payload);
          else await api.post('/inventory', payload);
          m.close();
          UI.toast(isEdit ? '✅ Item updated.' : '✅ Item added.', 'success');
          this.inventory(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };

    document.getElementById('inv-add').onclick = () => openModal(null);

    const bindRowButtons = () => {
      document.querySelectorAll('[data-inv-edit]').forEach(btn => {
        btn.onclick = () => {
          const it = items.find(x => x.id == btn.dataset.invEdit);
          if (it) openModal(it);
        };
      });
    };
    bindRowButtons();
  },

  _invTable(items, catMeta, condBadge) {
    if (!items.length) return `
      <div style="text-align:center;padding:40px 20px;color:#9ca3af;border:2px dashed #e5e7eb;border-radius:10px">
        <div style="font-size:36px;margin-bottom:8px">📦</div>
        <div style="font-weight:600">No items in this category</div>
      </div>`;
    return UI.table([
      { key: 'name', label: 'Item', render: r => {
        const cat = catMeta(r.category);
        return `<div style="font-weight:600">${cat.icon} ${UI.esc(r.name)}</div>
                <div style="font-size:11px;color:#6b7280">${cat.name}${r.serial_number ? ' · #' + UI.esc(r.serial_number) : ''}</div>`;
      }},
      { key: 'quantity', label: 'Qty', render: r => `
        <span style="font-weight:700">${r.available}</span><span style="color:#9ca3af"> / ${r.quantity}</span>
        <div style="font-size:11px;color:#6b7280">available</div>` },
      { key: 'condition', label: 'Condition', render: r => condBadge(r.condition) },
      { key: 'assigned_name', label: 'Assigned To', render: r => r.assigned_name
        ? `<span style="color:#4f46e5;font-weight:500">${UI.esc(r.assigned_name)}</span>`
        : '<span style="color:#9ca3af">—</span>' },
      { key: 'purchase_price', label: 'Value', render: r => r.purchase_price ? `₹${r.purchase_price.toLocaleString('en-IN')}` : '<span class="muted">—</span>' },
      { key: 'act', label: '', render: r => `<button class="btn sm secondary" data-inv-edit="${r.id}">Edit</button>` },
    ], items, '');
  },

  // ==================== OFFBOARDING / EXITS ====================
  async offboarding(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { exits, summary } = await api.get('/offboarding');
    const stat = (label, val, cls) => `<div class="card stat"><div class="label">${label}</div><div class="value ${cls || ''}">${val}</div></div>`;
    c.innerHTML = `
      <div class="cards">
        ${stat('Resignations Submitted', summary.initiated, 'amber')}
        ${stat('In Process', summary.in_progress, 'amber')}
        ${stat('Completed', summary.completed, 'green')}
        ${stat('Cancelled', summary.cancelled || 0)}
      </div>
      <div class="toolbar mt"><div class="section-title" style="margin:0">Employee Exits</div><div class="spacer"></div><button class="btn" id="startExit">+ Start Offboarding</button></div>
      <div id="exitList"></div>`;

    const statusTag = (s) => UI.tag(s === 'initiated' ? 'submitted' : s === 'in_progress' ? 'in process' : s);
    document.getElementById('exitList').innerHTML = UI.table([
      { key: 'employee_name', label: 'Employee', render: (r) => `<b>${UI.esc(r.employee_name)}</b><br/><span class="muted" style="font-size:12px">${UI.esc(r.emp_code || '')} · ${UI.esc(r.department || '-')}</span>` },
      { key: 'reason', label: 'Reason', render: (r) => UI.esc((r.reason || '').replace(/_/g, ' ')) },
      { key: 'last_working_day', label: 'Last Working Day', render: (r) => UI.date(r.last_working_day) },
      { key: 'progress', label: 'Clearance', render: (r) => `${r.tasks_done}/${r.tasks_total}` },
      { key: 'status', label: 'Status', render: (r) => statusTag(r.status) },
      { key: 'act', label: '', render: (r) => `<button class="btn sm secondary" data-exit="${r.id}">Open</button>` },
    ], exits, 'No exits yet. Click "Start Offboarding" to begin one.');

    document.querySelectorAll('[data-exit]').forEach((b) => b.onclick = () => this.exitDetail(b.dataset.exit, c));
    document.getElementById('startExit').onclick = async () => {
      const { employees } = await api.get('/employees');
      const active = employees.filter((e) => e.status === 'active');
      const m = UI.modal({
        title: '🚪 Start Offboarding',
        bodyHtml: `
          <div class="field"><label>Employee *</label><select id="ex-emp" style="width:100%"><option value="">— Select —</option>${active.map((e) => `<option value="${e.id}">${UI.esc(e.name)} (${UI.esc(e.emp_code || '')})</option>`).join('')}</select></div>
          <div class="form-grid">
            <div class="field"><label>Reason</label><select id="ex-reason" style="width:100%">
              <option value="resignation">Resignation</option><option value="termination">Termination</option>
              <option value="retirement">Retirement</option><option value="end_of_contract">End of Contract</option>
              <option value="absconding">Absconding</option><option value="other">Other</option></select></div>
            <div class="field"><label>Notice Period (days)</label><input type="number" id="ex-notice" value="30" min="0" style="width:100%" /></div>
            <div class="field"><label>Resignation / Notice Date</label><input type="date" id="ex-date" value="${new Date().toISOString().slice(0, 10)}" style="width:100%" /></div>
          </div>
          <div class="field"><label>Note <span class="muted">(optional)</span></label><textarea id="ex-note" rows="2" style="width:100%"></textarea></div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="ex-create">Start Offboarding</button>`,
      });
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#ex-create').onclick = async () => {
        const employee_id = m.root.querySelector('#ex-emp').value;
        if (!employee_id) return UI.toast('Please select an employee.', 'error');
        try {
          await api.post('/offboarding', {
            employee_id, reason: m.root.querySelector('#ex-reason').value,
            notice_days: Number(m.root.querySelector('#ex-notice').value),
            resignation_date: m.root.querySelector('#ex-date').value,
            reason_detail: m.root.querySelector('#ex-note').value.trim(),
          });
          m.close(); UI.toast('Offboarding started.', 'success'); this.offboarding(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };
  },

  async exitDetail(id, c) {
    const { exit: x, tasks, settlement } = await api.get('/offboarding/' + id);
    const cur = settlement.currency || '₹';
    const money = (n) => cur + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const ownerIcon = { hr: '🧑‍💼', it: '💻', finance: '💰', manager: '👔', employee: '👤' };
    const tasksHtml = tasks.map((t) => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed #eef1f6;cursor:pointer">
        <input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''} />
        <span style="flex:1">${UI.esc(t.title)} <span class="muted" style="font-size:11px">${ownerIcon[t.owner] || ''} ${UI.esc(t.owner || '')}</span></span>
        ${t.done ? `<span class="muted" style="font-size:11px">✓ ${UI.esc(t.done_by || '')}</span>` : ''}
      </label>`).join('');
    const done = tasks.filter((t) => t.done).length;
    const editable = x.status !== 'completed' && x.status !== 'cancelled';

    // Local, editable copy of the Full & Final settlement.
    const fnf = {
      currency: cur,
      meta: settlement.meta || {},
      earnings: (settlement.earnings || []).map((e) => ({ ...e })),
      deductions: (settlement.deductions || []).map((d) => ({ ...d })),
    };

    const m = UI.modal({
      title: `🚪 ${UI.esc(x.employee_name)} — Offboarding`,
      bodyHtml: `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px">
          <div>
            <div class="section-title" style="font-size:14px">Exit Details</div>
            <table style="font-size:13px">
              <tr><td class="muted">Code / Dept</td><td>${UI.esc(x.emp_code || '-')} · ${UI.esc(x.department || '-')}</td></tr>
              <tr><td class="muted">Joined</td><td>${UI.date(x.date_of_joining)}</td></tr>
              <tr><td class="muted">Reason</td><td>${UI.esc((x.reason || '').replace(/_/g, ' '))}</td></tr>
              <tr><td class="muted">Resignation date</td><td>${UI.date(x.resignation_date)}</td></tr>
              <tr><td class="muted">Notice</td><td>${x.notice_days} days</td></tr>
              <tr><td class="muted">Last working day</td><td><b>${UI.date(x.last_working_day)}</b></td></tr>
              <tr><td class="muted">Status</td><td>${UI.tag(x.status === 'initiated' ? 'submitted' : x.status === 'in_progress' ? 'in process' : x.status)}</td></tr>
            </table>
            ${editable ? `<div class="field mt"><label style="font-size:12px">Adjust last working day</label><input type="date" id="ex-lwd" value="${x.last_working_day || ''}" style="width:100%" /></div>
              <div class="field"><label style="font-size:12px"><input type="checkbox" id="ex-rehire" ${x.rehire_eligible ? 'checked' : ''}/> Eligible for rehire</label></div>
              <div class="field"><label style="font-size:12px">Exit notes</label><textarea id="ex-notes" rows="2" style="width:100%">${UI.esc(x.exit_notes || '')}</textarea></div>` : ''}
          </div>
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between">
              <div class="section-title" style="font-size:14px;margin:0">Full & Final Settlement ${settlement.edited ? '<span class="muted" style="font-size:11px">(edited)</span>' : '<span class="muted" style="font-size:11px">(auto)</span>'}</div>
              ${editable ? `<button class="btn sm secondary" id="fnf-recompute" type="button" title="Reset to auto-calculated figures">↻ Recompute</button>` : ''}
            </div>
            <div id="exFnf"></div>
          </div>
        </div>
        <div class="section-title mt" style="font-size:14px">Clearance Checklist <span class="muted" style="font-size:12px">(${done}/${tasks.length} done)</span></div>
        <div id="exTasks">${tasksHtml}</div>`,
      footHtml: editable
        ? `<button class="btn secondary" id="ex-cancel">Cancel Exit</button><button class="btn secondary" id="ex-save">Save Details</button><button class="btn green" id="ex-complete">Complete & Pay F&F</button>`
        : `<button class="btn secondary" data-close-btn>Close</button>`,
    });
    const close = m.root.querySelector('[data-close-btn]'); if (close) close.onclick = m.close;

    // ---- editable F&F renderer ----
    const recalc = () => {
      const sum = (arr) => arr.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const g = sum(fnf.earnings), d = sum(fnf.deductions);
      return { gross: g, totalDeductions: d, net: g - d };
    };
    const paintFnf = () => {
      const host = m.root.querySelector('#exFnf');
      const line = (item, idx, kind) => `
        <div style="display:flex;align-items:center;gap:6px;margin:4px 0">
          ${editable
            ? `<input data-fnf-label="${kind}:${idx}" value="${UI.esc(item.label)}" ${item.auto ? 'readonly' : ''} style="flex:1;font-size:12px;${item.auto ? 'border:none;background:transparent;color:#374151' : ''}" />`
            : `<span style="flex:1;font-size:12px">${UI.esc(item.label)}</span>`}
          ${editable ? `<span style="font-size:12px;color:#9ca3af">${cur}</span><input type="number" step="0.01" data-fnf-amt="${kind}:${idx}" value="${item.amount}" style="width:100px;text-align:right;font-size:12px${kind === 'd' ? ';color:#dc2626' : ''}" />`
            : `<span style="font-size:12px${kind === 'd' ? ';color:#dc2626' : ''}">${kind === 'd' ? '- ' : ''}${money(item.amount)}</span>`}
          ${editable && !item.auto ? `<button data-fnf-del="${kind}:${idx}" type="button" title="Remove" style="border:none;background:none;color:#dc2626;cursor:pointer;font-size:14px">×</button>` : (editable ? '<span style="width:14px"></span>' : '')}
        </div>`;
      const t = recalc();
      host.innerHTML = `
        <div style="font-size:12px;font-weight:600;color:#16a34a;margin-top:4px">Earnings</div>
        ${fnf.earnings.map((e, i) => line(e, i, 'e')).join('')}
        ${editable ? `<button class="btn sm secondary" id="fnf-add-e" type="button" style="margin-top:4px">+ Add earning</button>` : ''}
        <div style="font-size:12px;font-weight:600;color:#dc2626;margin-top:12px">Deductions</div>
        ${fnf.deductions.map((d, i) => line(d, i, 'd')).join('')}
        ${editable ? `<button class="btn sm secondary" id="fnf-add-d" type="button" style="margin-top:4px">+ Add deduction</button>` : ''}
        <table style="font-size:13px;margin-top:12px;width:100%;border-top:1px solid #e5e7eb">
          <tr><td class="muted">Gross earnings</td><td style="text-align:right" id="fnf-gross">${money(t.gross)}</td></tr>
          <tr><td class="muted">Total deductions</td><td style="text-align:right;color:#dc2626" id="fnf-ded">- ${money(t.totalDeductions)}</td></tr>
          <tr><td><b>Net payable</b></td><td style="text-align:right"><b id="fnf-net">${money(t.net)}</b></td></tr>
        </table>`;
      if (!editable) return;
      // bind amount/label edits (live totals, no repaint to keep focus)
      host.querySelectorAll('[data-fnf-amt]').forEach((el) => el.oninput = () => {
        const [k, i] = el.dataset.fnfAmt.split(':');
        (k === 'e' ? fnf.earnings : fnf.deductions)[Number(i)].amount = Number(el.value) || 0;
        const tt = recalc();
        host.querySelector('#fnf-gross').textContent = money(tt.gross);
        host.querySelector('#fnf-ded').textContent = '- ' + money(tt.totalDeductions);
        host.querySelector('#fnf-net').textContent = money(tt.net);
      });
      host.querySelectorAll('[data-fnf-label]').forEach((el) => el.oninput = () => {
        const [k, i] = el.dataset.fnfLabel.split(':');
        (k === 'e' ? fnf.earnings : fnf.deductions)[Number(i)].label = el.value;
      });
      host.querySelectorAll('[data-fnf-del]').forEach((el) => el.onclick = () => {
        const [k, i] = el.dataset.fnfDel.split(':');
        (k === 'e' ? fnf.earnings : fnf.deductions).splice(Number(i), 1); paintFnf();
      });
      host.querySelector('#fnf-add-e').onclick = () => { fnf.earnings.push({ key: 'custom', label: 'New earning', amount: 0, auto: false }); paintFnf(); };
      host.querySelector('#fnf-add-d').onclick = () => { fnf.deductions.push({ key: 'custom', label: 'New deduction', amount: 0, auto: false }); paintFnf(); };
    };
    paintFnf();

    const saveFnf = async (silent) => {
      try { const r = await api.put(`/offboarding/${id}/settlement`, { settlement: { earnings: fnf.earnings, deductions: fnf.deductions } });
        if (!silent) UI.toast('Settlement saved.', 'success'); return r.settlement; }
      catch (e) { UI.toast(e.message, 'error'); throw e; }
    };

    m.root.querySelectorAll('[data-task]').forEach((cb) => cb.onchange = async () => {
      try { await api.post(`/offboarding/${id}/tasks/${cb.dataset.task}/toggle`); } catch (e) { UI.toast(e.message, 'error'); cb.checked = !cb.checked; }
    });
    if (editable) {
      m.root.querySelector('#fnf-recompute').onclick = async () => {
        if (!confirm('Reset the settlement to the auto-calculated figures? Your manual edits to it will be lost.')) return;
        const fresh = await api.get(`/offboarding/${id}?recompute=1`);
        fnf.earnings = (fresh.settlement.earnings || []).map((e) => ({ ...e }));
        fnf.deductions = (fresh.settlement.deductions || []).map((d) => ({ ...d }));
        fnf.meta = fresh.settlement.meta || fnf.meta;
        paintFnf(); UI.toast('Recomputed from latest data.', 'success');
      };
      m.root.querySelector('#ex-save').onclick = async () => {
        try {
          await api.patch('/offboarding/' + id, {
            last_working_day: m.root.querySelector('#ex-lwd').value,
            rehire_eligible: m.root.querySelector('#ex-rehire').checked,
            exit_notes: m.root.querySelector('#ex-notes').value,
          });
          await saveFnf(true);
          UI.toast('Saved.', 'success');
        } catch (e) { UI.toast(e.message, 'error'); }
      };
      m.root.querySelector('#ex-cancel').onclick = async () => {
        if (!confirm('Cancel this exit? The employee stays active.')) return;
        try { await api.post(`/offboarding/${id}/cancel`); m.close(); UI.toast('Exit cancelled.', 'success'); this.offboarding(c); } catch (e) { UI.toast(e.message, 'error'); }
      };
      m.root.querySelector('#ex-complete').onclick = async () => {
        const t = recalc();
        const ok = done < tasks.length
          ? confirm(`${tasks.length - done} clearance task(s) are still pending.\n\nComplete anyway and finalise F&F of ${money(t.net)}? This deactivates the employee.`)
          : confirm(`Complete offboarding and finalise F&F of ${money(t.net)}? This deactivates the employee.`);
        if (!ok) return;
        try {
          await saveFnf(true);                       // persist edited F&F first
          await api.post(`/offboarding/${id}/complete`, { force: true });
          m.close(); UI.toast('Offboarding completed. Employee deactivated.', 'success'); this.offboarding(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    }
  },

  // ==================== TIMESHEETS (admin) ====================
  async timesheets(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    let tab = 'approvals';
    const render = async () => {
      c.innerHTML = `
        <div class="toolbar">
          <button class="btn sm ${tab === 'approvals' ? '' : 'secondary'}" data-tab="approvals">Approvals</button>
          <button class="btn sm ${tab === 'projects' ? '' : 'secondary'}" data-tab="projects">Projects</button>
          <button class="btn sm ${tab === 'summary' ? '' : 'secondary'}" data-tab="summary">Summary</button>
        </div>
        <div id="tsBody" class="mt"><div class="muted">Loading...</div></div>`;
      c.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
      const body = document.getElementById('tsBody');
      if (tab === 'approvals') return this.tsApprovals(body, render);
      if (tab === 'projects') return this.tsProjects(body, render);
      return this.tsSummary(body);
    };
    await render();
  },

  async tsApprovals(body, refresh) {
    const { groups } = await api.get('/timesheets');
    if (!groups.length) { body.innerHTML = '<div class="empty">No timesheets awaiting approval. 🎉</div>'; return; }
    body.innerHTML = groups.map((g, gi) => `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div><b>${UI.esc(g.employee_name)}</b> <span class="muted" style="font-size:12px">${UI.esc(g.emp_code || '')} · week of ${UI.date(g.weekStart)}</span></div>
          <div><span class="muted">Total <b>${g.totalHours}h</b> · Billable <b>${g.billableHours}h</b></span></div>
        </div>
        <div style="margin:8px 0">${UI.table([
          { key: 'date', label: 'Date', render: (r) => UI.date(r.date) },
          { key: 'project_name', label: 'Project', render: (r) => UI.esc(r.project_name || '—') },
          { key: 'task', label: 'Task', render: (r) => UI.esc(r.task || '-') },
          { key: 'hours', label: 'Hours', render: (r) => `<b>${r.hours}</b>` },
          { key: 'billable', label: 'Billable', render: (r) => r.billable ? '💰' : '—' },
        ], g.entries, '')}</div>
        <div class="btn-row"><button class="btn green sm" data-approve="${gi}">✓ Approve Week</button><button class="btn danger sm" data-reject="${gi}">✕ Reject</button></div>
      </div>`).join('');
    const decide = async (gi, decision) => {
      const g = groups[gi];
      let comment = '';
      if (decision === 'rejected') { comment = prompt('Reason for rejection (optional):') || ''; }
      try { await api.post('/timesheets/decision', { ids: g.ids, decision, comment }); UI.toast(`Timesheet ${decision}.`, 'success'); refresh(); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    body.querySelectorAll('[data-approve]').forEach((b) => b.onclick = () => decide(Number(b.dataset.approve), 'approved'));
    body.querySelectorAll('[data-reject]').forEach((b) => b.onclick = () => decide(Number(b.dataset.reject), 'rejected'));
  },

  async tsProjects(body, refresh) {
    const { projects } = await api.get('/timesheets/projects?all=1');
    body.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Projects</div><div class="spacer"></div><button class="btn sm" id="addProj">+ Add Project</button></div>
      ${UI.table([
        { key: 'name', label: 'Project', render: (r) => `<b>${UI.esc(r.name)}</b>${r.code ? ` <span class="muted">(${UI.esc(r.code)})</span>` : ''}` },
        { key: 'client', label: 'Client', render: (r) => UI.esc(r.client || '-') },
        { key: 'billable', label: 'Billable', render: (r) => r.billable ? '💰 Yes' : 'No' },
        { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
        { key: 'act', label: '', render: (r) => `<button class="btn sm secondary" data-pedit="${r.id}">Edit</button> <button class="btn sm danger" data-pdel="${r.id}">${'Delete'}</button>` },
      ], projects, 'No projects yet.')}`;
    const projModal = (p) => {
      const m = UI.modal({
        title: p ? '✏️ Edit Project' : '➕ Add Project',
        bodyHtml: `
          <div class="field"><label>Name *</label><input id="p-name" value="${p ? UI.esc(p.name) : ''}" style="width:100%" /></div>
          <div class="form-grid">
            <div class="field"><label>Code</label><input id="p-code" value="${p ? UI.esc(p.code || '') : ''}" style="width:100%" /></div>
            <div class="field"><label>Client</label><input id="p-client" value="${p ? UI.esc(p.client || '') : ''}" style="width:100%" /></div>
          </div>
          <div class="field"><label><input type="checkbox" id="p-bill" ${!p || p.billable ? 'checked' : ''}/> Billable project</label></div>
          ${p ? `<div class="field"><label>Status</label><select id="p-status" style="width:100%"><option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option><option value="archived" ${p.status === 'archived' ? 'selected' : ''}>Archived</option></select></div>` : ''}`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="p-save">Save</button>`,
      });
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#p-save').onclick = async () => {
        const payload = { name: m.root.querySelector('#p-name').value.trim(), code: m.root.querySelector('#p-code').value.trim(), client: m.root.querySelector('#p-client').value.trim(), billable: m.root.querySelector('#p-bill').checked };
        if (p) payload.status = m.root.querySelector('#p-status').value;
        if (!payload.name) return UI.toast('Name is required.', 'error');
        try { if (p) await api.patch('/timesheets/projects/' + p.id, payload); else await api.post('/timesheets/projects', payload); m.close(); UI.toast('Saved.', 'success'); refresh(); }
        catch (e) { UI.toast(e.message, 'error'); }
      };
    };
    document.getElementById('addProj').onclick = () => projModal(null);
    body.querySelectorAll('[data-pedit]').forEach((b) => b.onclick = () => projModal(projects.find((p) => String(p.id) === b.dataset.pedit)));
    body.querySelectorAll('[data-pdel]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this project? (If it has logged time, it will be archived instead.)')) return;
      try { await api.del('/timesheets/projects/' + b.dataset.pdel); UI.toast('Done.', 'success'); refresh(); } catch (e) { UI.toast(e.message, 'error'); }
    });
  },

  async tsSummary(body) {
    const monday = (() => { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.toISOString().slice(0, 10); })();
    const sunday = (() => { const d = new Date(monday + 'T00:00:00'); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })();
    body.innerHTML = `
      <div class="toolbar"><label class="muted">From</label><input type="date" id="sFrom" value="${monday}" /><label class="muted">To</label><input type="date" id="sTo" value="${sunday}" /><button class="btn sm" id="sGo">View</button></div>
      <div id="sumOut" class="mt"><div class="muted">Pick a range and click View.</div></div>`;
    const load = async () => {
      const from = document.getElementById('sFrom').value, to = document.getElementById('sTo').value;
      const out = document.getElementById('sumOut');
      out.innerHTML = '<div class="muted">Loading...</div>';
      const r = await api.get(`/timesheets/summary?from=${from}&to=${to}`);
      out.innerHTML = `
        <div class="cards">
          <div class="card stat"><div class="label">Approved Hours</div><div class="value">${r.totals.hours}</div></div>
          <div class="card stat"><div class="label">Billable Hours</div><div class="value green">${r.totals.billable}</div></div>
          <div class="card stat"><div class="label">Utilisation</div><div class="value">${r.totals.hours ? Math.round((r.totals.billable / r.totals.hours) * 100) : 0}%</div></div>
        </div>
        <div class="section-title mt">By Project</div>
        ${UI.table([{ key: 'project', label: 'Project', render: (x) => UI.esc(x.project) }, { key: 'hours', label: 'Hours' }, { key: 'billable', label: 'Billable' }], r.byProject, 'No approved time in this range.')}
        <div class="section-title mt">By Employee</div>
        ${UI.table([{ key: 'employee', label: 'Employee', render: (x) => UI.esc(x.employee) }, { key: 'hours', label: 'Hours' }, { key: 'billable', label: 'Billable' }], r.byEmployee, 'No approved time in this range.')}`;
    };
    document.getElementById('sGo').onclick = load;
    load();
  },
};
