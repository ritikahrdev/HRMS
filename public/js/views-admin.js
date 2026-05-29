const AdminViews = {
  async dashboard(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const o = await api.get('/reports/overview');
    c.innerHTML = `
      <div class="cards">
        <div class="card stat"><div class="stat-ico">👥</div><div class="label">Active Employees</div><div class="value">${o.totalEmployees}</div></div>
        <div class="card stat"><div class="stat-ico">✅</div><div class="label">Present Today</div><div class="value green">${o.presentToday}</div></div>
        <div class="card stat"><div class="stat-ico">🚫</div><div class="label">Absent Today</div><div class="value red">${o.absentToday}</div></div>
      </div>
      <div class="section-title mt">Quick Actions</div>
      <div class="btn-row">
        <button class="btn" onclick="location.hash='#/employees'">Add Employee</button>
        <button class="btn secondary" onclick="location.hash='#/import'">Import from Excel</button>
        <button class="btn secondary" onclick="location.hash='#/payroll'">Run Payroll</button>
        <button class="btn secondary" onclick="location.hash='#/attendance'">View Attendance</button>
      </div>`;
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
    c.innerHTML = `<div class="section-title">Attendance Requests (missed punches, half-days, regularizations)</div>` + UI.table([
      { key: 'employee_name', label: 'Employee' },
      { key: 'date', label: 'Date', render: (r) => UI.date(r.date) },
      { key: 'requested_status', label: 'Requested', render: (r) => UI.tag(r.requested_status) },
      { key: 'times', label: 'In/Out', render: (r) => `${UI.esc(r.requested_in || '-')} / ${UI.esc(r.requested_out || '-')}` },
      { key: 'reason', label: 'Reason', render: (r) => UI.esc(r.reason || '-') },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
      { key: 'act', label: '', render: (r) => r.status === 'pending' ? `<button class="btn sm green" data-ok="${r.id}">Approve</button> <button class="btn sm red" data-no="${r.id}">Reject</button>` : UI.esc(r.comment || '') },
    ], corrections, 'No correction requests.');
    const decide = async (id, decision) => {
      const comment = decision === 'rejected' ? (prompt('Reason (optional):') || '') : '';
      try { await api.post(`/attendance/corrections/${id}/decision`, { decision, comment }); UI.toast('Correction ' + decision + '.', 'success'); this.corrections(c); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    document.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => decide(b.dataset.ok, 'approved'));
    document.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => decide(b.dataset.no, 'rejected'));
  },

  // ---------------- Employees ----------------
  async employees(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { employees } = await api.get('/employees');
    c.innerHTML = `
      <div class="toolbar">
        <input id="search" placeholder="Search name / code / dept..." />
        <div class="spacer"></div>
        <button class="btn" id="add">Add Employee</button>
      </div>
      <div id="list"></div>`;
    const render = (rows) => {
      document.getElementById('list').innerHTML = UI.table([
        { key: 'emp_code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Dept', render: (r) => UI.esc(r.department || '-') },
        { key: 'designation', label: 'Designation', render: (r) => UI.esc(r.designation || '-') },
        { key: 'role', label: 'Role', render: (r) => UI.esc((r.role || 'EMPLOYEE').replace('_', ' ')) },
        { key: 'manager_name', label: 'Manager', render: (r) => UI.esc(r.manager_name || '-') },
        { key: 'monthly_salary', label: 'Salary', render: (r) => UI.money(r.monthly_salary) },
        { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
        { key: 'act', label: '', render: (r) => `<button class="btn sm secondary" data-edit="${r.id}">Edit</button>${App.has('payroll:manage') ? ` <button class="btn sm secondary" data-salary="${r.id}">Salary</button>` : ''} <button class="btn sm secondary" data-docs="${r.id}">Docs</button> <button class="btn sm secondary" data-onboard="${r.id}">Onboarding</button> <button class="btn sm secondary" data-reset="${r.id}">Reset PW</button>${App.user.role === 'SUPER_ADMIN' ? ` <button class="btn sm red" data-del="${r.id}">Delete</button>` : ''}` },
      ], rows, 'No employees yet. Add one or import from Excel.');
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => this.employeeForm(c, employees.find((e) => e.id == b.dataset.edit)));
      document.querySelectorAll('[data-salary]').forEach((b) => b.onclick = () => { const e = employees.find((x) => x.id == b.dataset.salary); this.salaryModal(e.id, e.name); });
      document.querySelectorAll('[data-docs]').forEach((b) => b.onclick = () => { const e = employees.find((x) => x.id == b.dataset.docs); this.documentsModal(e.id, e.name); });
      document.querySelectorAll('[data-onboard]').forEach((b) => b.onclick = () => { const e = employees.find((x) => x.id == b.dataset.onboard); this.onboardingModal(e.id, e.name); });
      document.querySelectorAll('[data-reset]').forEach((b) => b.onclick = async () => {
        try { const r = await api.post(`/employees/${b.dataset.reset}/reset-password`); UI.toast('New temp password: ' + r.tempPassword, 'success'); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        const emp = employees.find((e) => e.id == b.dataset.del);
        if (!confirm(`Permanently delete ${emp ? emp.name : 'this employee'} and all their records? This cannot be undone.`)) return;
        try { await api.request('DELETE', '/employees/' + b.dataset.del); UI.toast('Employee deleted.', 'success'); this.employees(c); }
        catch (e) { UI.toast(e.message, 'error'); }
      });
    };
    render(employees);
    document.getElementById('add').onclick = () => this.employeeForm(c, null);
    document.getElementById('search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      render(employees.filter((x) => [x.name, x.emp_code, x.department, x.email].join(' ').toLowerCase().includes(q)));
    };
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
          <div class="field"><label>Phone</label><input id="phone" value="${f('phone')}" /></div>
          <div class="field"><label>Role</label><select id="role">${ROLES.map((r) => `<option value="${r[0]}" ${curRole === r[0] ? 'selected' : ''}>${r[1]}</option>`).join('')}</select></div>
          <div class="field"><label>Reporting Manager</label><select id="manager_id">${mgrOptions}</select></div>
          <div class="field"><label>Department</label><input id="department" value="${f('department')}" /></div>
          <div class="field"><label>Designation</label><input id="designation" value="${f('designation')}" /></div>
          <div class="field"><label>Date of Joining</label><input id="date_of_joining" type="date" value="${f('date_of_joining')}" /></div>
          <div class="field"><label>Monthly Salary</label><input id="monthly_salary" type="number" step="0.01" value="${emp ? emp.monthly_salary : ''}" /></div>
          <div class="field"><label>Bank Account</label><input id="bank_account" value="${f('bank_account')}" /></div>
          <div class="field"><label>IFSC</label><input id="ifsc" value="${f('ifsc')}" /></div>
          <div class="field"><label>PAN</label><input id="pan" value="${f('pan')}" /></div>
          <div class="field"><label>Aadhaar / ID Proof</label><input id="aadhaar" value="${f('aadhaar')}" /></div>
          <div class="field"><label>Date of Birth</label><input type="date" id="dob" value="${f('dob')}" /></div>
          <div class="field"><label>Gender</label><select id="gender"><option value=""></option><option value="Male" ${emp && emp.gender === 'Male' ? 'selected' : ''}>Male</option><option value="Female" ${emp && emp.gender === 'Female' ? 'selected' : ''}>Female</option><option value="Other" ${emp && emp.gender === 'Other' ? 'selected' : ''}>Other</option></select></div>
          <div class="field"><label>Blood Group</label><input id="blood_group" value="${f('blood_group')}" /></div>
          <div class="field"><label>Emergency Contact Name</label><input id="emergency_name" value="${f('emergency_name')}" /></div>
          <div class="field"><label>Emergency Contact Phone</label><input id="emergency_phone" value="${f('emergency_phone')}" /></div>
          <div class="field full"><label>Education</label><input id="education" value="${f('education')}" /></div>
          <div class="field full"><label>Previous Experience</label><input id="experience" value="${f('experience')}" /></div>
          <div class="field"><label>Slack Member ID (for attendance sync)</label><input id="slack_id" value="${f('slack_id')}" placeholder="U0XXXXXXX (optional)" /></div>
          <div class="field full"><label>Address</label><textarea id="address" rows="2">${f('address')}</textarea></div>
          ${emp ? `<div class="field"><label>Status</label><select id="status"><option value="active" ${emp.status === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${emp.status === 'inactive' ? 'selected' : ''}>inactive</option></select></div>` : ''}
        </div>
        <p class="muted" style="font-size:12px">Tip: set role to <b>Manager</b> and assign team members' Reporting Manager to this person so they can approve their team.</p>`,
      footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Save</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    m.root.querySelector('#save').onclick = async () => {
      const ids = ['name', 'emp_code', 'email', 'phone', 'role', 'manager_id', 'department', 'designation', 'date_of_joining', 'monthly_salary', 'bank_account', 'ifsc', 'pan', 'address', 'aadhaar', 'dob', 'gender', 'blood_group', 'emergency_name', 'emergency_phone', 'education', 'experience', 'slack_id'];
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
    c.innerHTML = '<div class="muted">Loading...</div>';
    const today = new Date().toISOString().slice(0, 10);
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

  attDayTable(list, date) {
    return UI.table([
      { key: 'emp_code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'department', label: 'Dept', render: (r) => UI.esc(r.department || '-') },
      { key: 'check_in', label: 'In', render: (r) => UI.time(r.check_in) },
      { key: 'check_out', label: 'Out', render: (r) => UI.time(r.check_out) },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
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
    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Leave Requests</div><div class="spacer"></div><button class="btn secondary" id="grant">Grant Comp-off</button></div>
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
        <div class="form-grid">
          <div class="field"><label>In Time (shift start)</label><input type="time" id="workStart" value="${UI.esc(s.workStart)}" /></div>
          <div class="field"><label>Out Time (shift end)</label><input type="time" id="workEnd" value="${UI.esc(s.workEnd)}" /></div>
          <div class="field"><label>Clock-in grace (minutes)</label><input type="number" id="graceMinutes" value="${s.graceMinutes != null ? s.graceMinutes : 30}" /><span class="muted" style="font-size:12px">Employees can clock in until In&nbsp;Time + this many minutes. After that they must raise a request.</span></div>
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
          ${[['directory', 'Directory'], ['notices', 'Notice Board'], ['holidays', 'Holidays'], ['recognition', 'Recognition'], ['performance', 'Performance'], ['surveys', 'Surveys'], ['helpdesk', 'Helpdesk'], ['assets', 'Assets'], ['loans', 'Loans & Advances'], ['reimbursement', 'Reimbursements'], ['recruitment', 'Recruitment']]
            .map(([k, label]) => `<label><input type="checkbox" class="mod" value="${k}" ${(s.modules || {})[k] !== false ? 'checked' : ''}/> ${label}</label>`).join('')}
        </div>
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
        <p class="muted" style="font-size:12px">Pull attendance from your Slack channel where staff post each day. Create a Slack app with a Bot token (scopes: <b>channels:history</b>, <b>users:read</b>, <b>users:read.email</b>), add it to the channel, and paste the details below. Then use <b>Import Attendance → Sync from Slack</b>.</p>
        <div class="checkbox-row" style="margin-bottom:10px"><label><input type="checkbox" id="slackEnabled" ${(s.slack || {}).enabled ? 'checked' : ''}/> Enable Slack sync</label></div>
        <div class="form-grid">
          <div class="field"><label>Bot Token (xoxb-…)</label><input id="slackToken" value="${UI.esc((s.slack || {}).botToken || '')}" placeholder="xoxb-..." /></div>
          <div class="field"><label>Channel ID</label><input id="slackChannel" value="${UI.esc((s.slack || {}).channelId || '')}" placeholder="C0XXXXXXX" /></div>
          <div class="field full"><label>"Leave" keywords (comma separated)</label><input id="slackLeave" value="${UI.esc(((s.slack || {}).leaveKeywords || []).join(', '))}" /></div>
          <div class="field full"><label>"Half day" keywords</label><input id="slackHalf" value="${UI.esc(((s.slack || {}).halfKeywords || []).join(', '))}" /></div>
        </div>
        <p class="muted" style="font-size:12px">Anyone who posts in the channel that day is marked <b>Present</b> (with their post time as clock-in), unless their message matches a Leave/Half keyword. Match employees by their Slack email = HR email, or set a Slack ID on the employee.</p>
      </div>
      <div class="btn-row mt"><button class="btn" id="save">Save Settings</button></div>
      ${App.user.role === 'SUPER_ADMIN' ? '<div id="accessCard" class="mt"></div>' : ''}`;

    if (App.user.role === 'SUPER_ADMIN') this.accessControlCard();

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
        workingDays: Array.from(document.querySelectorAll('.wd:checked')).map((x) => Number(x.value)),
        leaveTypes: ltState.filter((t) => t.code && t.name),
        payrollClosingDay: Number(val('payrollClosingDay')),
        requiredDocs: val('requiredDocs').split('\n').map((x) => x.trim()).filter(Boolean),
        uidaiCert: val('uidaiCert').trim(),
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
          const all = ['directory', 'notices', 'holidays', 'recognition', 'performance', 'surveys', 'helpdesk', 'assets', 'loans', 'reimbursement', 'recruitment'];
          const on = new Set(Array.from(document.querySelectorAll('.mod:checked')).map((x) => x.value));
          const m = {}; all.forEach((k) => { m[k] = on.has(k); }); return m;
        })(),
        slack: {
          enabled: document.getElementById('slackEnabled').checked,
          botToken: val('slackToken').trim(),
          channelId: val('slackChannel').trim(),
          leaveKeywords: val('slackLeave').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
          halfKeywords: val('slackHalf').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
        },
      };
      try { await api.put('/settings', payload); UI.currency = payload.currency || UI.currency; UI.toast('Settings saved. Reloading menu…', 'success'); setTimeout(() => location.reload(), 800); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    function val(id) { return document.getElementById(id).value; }
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
      <div class="toolbar"><input id="search" placeholder="Search name / dept / designation..." /><div class="spacer"></div><span class="muted">${employees.length} people</span></div>
      <div id="list"></div>`;
    const render = (rows) => {
      document.getElementById('list').innerHTML = UI.table([
        { key: 'name', label: 'Name', render: (r) => `<div style="display:flex;align-items:center;gap:10px"><span class="avatar sm">${UI.esc(App.initials(r.name))}</span><span><b>${UI.esc(r.name)}</b><br/><span class="muted" style="font-size:12px">${UI.esc(r.emp_code || '')}</span></span></div>` },
        { key: 'designation', label: 'Designation', render: (r) => UI.esc(r.designation || '-') },
        { key: 'department', label: 'Department', render: (r) => UI.esc(r.department || '-') },
        { key: 'manager_name', label: 'Manager', render: (r) => UI.esc(r.manager_name || '-') },
        { key: 'email', label: 'Email', render: (r) => r.email ? `<a href="mailto:${UI.esc(r.email)}">${UI.esc(r.email)}</a>` : '-' },
        { key: 'phone', label: 'Phone', render: (r) => UI.esc(r.phone || '-') },
      ], rows, 'No employees.');
    };
    render(employees);
    document.getElementById('search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      render(employees.filter((x) => [x.name, x.department, x.designation, x.email, x.emp_code].join(' ').toLowerCase().includes(q)));
    };
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
            <label class="checkbox-row"><input type="checkbox" id="pinned" /> Pin to top</label>
            <div style="background:#fef3c7;border-left:4px solid #d97706;padding:10px;margin-top:12px;border-radius:4px;font-size:13px;color:#78350f">
              <strong>📢 Auto-notify:</strong> This announcement will be posted to your Slack group and emailed to all active employees.
            </div>`,
          footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="save">Post</button>`,
        });
        m.root.querySelector('[data-close-btn]').onclick = m.close;
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
    const vActions = (id) => canVerify ? ` <button class="btn sm green" data-verify="${id}" title="Mark verified">✓</button> <button class="btn sm red" data-reject="${id}" title="Reject">✗</button>` : '';

    const load = async () => {
      const { documents } = await api.get(`/employees/${employeeId}/documents`);
      const byType = {};
      documents.forEach((d) => { if (d.doc_type) byType[d.doc_type] = d; });
      const done = required.filter((t) => byType[t]).length;
      const verified = documents.filter((d) => d.status === 'verified').length;

      const checklist = required.map((t) => {
        const doc = byType[t];
        if (!doc) return `<div class="doc-row"><div class="doc-name">${UI.esc(t)}</div><div><span class="tag rejected">Missing</span></div><div class="doc-act"><label class="btn sm">Upload<input type="file" class="reqfile" data-type="${UI.esc(t)}" style="display:none"/></label></div></div>`;
        return `<div class="doc-row"><div class="doc-name">${UI.esc(t)}</div><div>${stChip(doc)}</div><div class="doc-act"><a class="btn sm secondary" href="/api/employees/${employeeId}/documents/${doc.id}/file" target="_blank">View</a>${vActions(doc.id)} <button class="btn sm secondary" data-del="${doc.id}">✕</button></div></div>`;
      }).join('');

      const others = documents.filter((d) => !required.includes(d.doc_type));
      const otherRows = others.map((d) => `<div class="doc-row"><div class="doc-name">${UI.esc(d.title || d.doc_type || 'Document')}<br/><span class="muted" style="font-size:11px;font-weight:400">${UI.date(d.uploaded_at)}</span></div><div>${stChip(d)}</div><div class="doc-act"><a class="btn sm secondary" href="/api/employees/${employeeId}/documents/${d.id}/file" target="_blank">View</a>${vActions(d.id)} <button class="btn sm secondary" data-del="${d.id}">✕</button></div></div>`).join('');

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

    if (isEmployee) {
      // Big prominent "Raise Ticket" section
      html += `
        <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:12px;padding:24px 28px;margin:16px 0;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
          <div>
            <div style="font-size:18px;font-weight:700;margin-bottom:4px">Need help from HR?</div>
            <div style="opacity:.85;font-size:14px">Raise a ticket and our HR team will get back to you.</div>
          </div>
          <button id="raise-main" style="background:#fff;color:#4f46e5;border:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;white-space:nowrap">
            📝 Raise a Ticket
          </button>
        </div>

        <div style="margin-bottom:24px">
          <div style="font-size:13px;color:#6b7280;margin-bottom:12px">Or pick a category to get started quickly:</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
            ${this.HR_TICKET_CATEGORIES.map(cat => `
              <button class="cat-quick-btn" data-cat="${cat.key}"
                style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border:1.5px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;transition:all .15s;text-align:center">
                <span style="font-size:22px">${cat.icon}</span>
                <span style="font-size:12px;font-weight:600;color:#374151;line-height:1.3">${cat.name}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div style="margin-top:24px">
          <div class="section-title" style="margin-bottom:12px">My Tickets</div>
          ${buildTabs('my-tickets-container', 'my')}
          <div id="my-tickets-container">
            ${mine.length === 0
              ? `<div style="text-align:center;padding:40px 20px;color:#9ca3af;border:2px dashed #e5e7eb;border-radius:10px">
                  <div style="font-size:36px;margin-bottom:8px">📭</div>
                  <div style="font-weight:600;margin-bottom:4px">No tickets yet</div>
                  <div style="font-size:13px">Raise your first ticket using the button above.</div>
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

  // ---------------- Onboarding checklist (modal) ----------------
  async onboardingModal(employeeId, name) {
    const m = UI.modal({
      title: 'Onboarding — ' + (name || ''),
      bodyHtml: `<div id="ob" class="muted">Loading...</div>
        <div class="btn-row mt"><input id="newtask" placeholder="New task" /><button class="btn secondary" id="addtask">Add</button><button class="btn secondary" id="template">Use default checklist</button></div>`,
      footHtml: `<button class="btn secondary" data-close-btn>Close</button>`,
    });
    m.root.querySelector('[data-close-btn]').onclick = m.close;
    const load = async () => {
      const { tasks } = await api.get('/onboarding/' + employeeId);
      const done = tasks.filter((t) => t.done).length;
      m.root.querySelector('#ob').innerHTML = (tasks.length ? `<div class="muted">${done}/${tasks.length} completed</div>` : '') + (tasks.length ? tasks.map((t) => `
        <label class="checkbox-row" style="padding:4px 0"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''}/> ${UI.esc(t.title)} <button class="btn sm red" data-tdel="${t.id}" style="margin-left:auto">✕</button></label>`).join('') : '<div class="empty">No tasks yet. Add some or use the default checklist.</div>');
      m.root.querySelectorAll('[data-task]').forEach((el) => el.onchange = async () => { try { await api.put('/onboarding/task/' + el.dataset.task, { done: el.checked }); load(); } catch (e) { UI.toast(e.message, 'error'); } });
      m.root.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = async () => { try { await api.request('DELETE', '/onboarding/task/' + b.dataset.tdel); load(); } catch (e) { UI.toast(e.message, 'error'); } });
    };
    m.root.querySelector('#addtask').onclick = async () => {
      const title = m.root.querySelector('#newtask').value.trim(); if (!title) return;
      try { await api.post('/onboarding/' + employeeId, { title }); m.root.querySelector('#newtask').value = ''; load(); } catch (e) { UI.toast(e.message, 'error'); }
    };
    m.root.querySelector('#template').onclick = async () => {
      try { await api.post('/onboarding/' + employeeId + '/template'); UI.toast('Default checklist added.', 'success'); load(); } catch (e) { UI.toast(e.message, 'error'); }
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
};
