const EmployeeViews = {
  async dashboard(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [todayRes, balanceRes, { payslips }] = await Promise.all([
      api.get('/attendance/today'),
      api.get('/leave/balance'),
      api.get('/payroll/my'),
    ]);
    const a = todayRes.attendance;
    const winState = todayRes.window || { open: true, cutoff: '' };
    const checkedIn = a && a.check_in;
    const checkedOut = a && a.check_out;
    const windowClosed = !winState.open && !checkedIn;

    const balRows = Object.values(balanceRes.balance || {})
      .map((v) => `<div class="card stat"><div class="label">${UI.esc(v.name)} left</div><div class="value">${v.remaining}<span class="muted" style="font-size:14px"> / ${v.allowed}</span></div></div>`)
      .join('');

    c.innerHTML = `
      <div class="cards">
        <div class="card">
          <div class="section-title">Today's Attendance</div>
          <div class="pill-clock" id="clock">--:--</div>
          <div class="muted" style="margin:6px 0 14px">
            ${checkedIn ? 'Clocked in at ' + UI.time(a.check_in) : (windowClosed ? '<span style="color:var(--red)">Window closed (till ' + UI.esc(winState.cutoff) + '). Raise a request from My Attendance.</span>' : 'Not clocked in yet (clock in before ' + UI.esc(winState.cutoff) + ')')}
            ${checkedOut ? ' &middot; Clocked out at ' + UI.time(a.check_out) : ''}
          </div>
          <div class="btn-row">
            <button class="btn green" id="checkin" ${(checkedIn || windowClosed) ? 'disabled' : ''}>Clock In</button>
            <button class="btn" id="checkout" ${(!checkedIn || checkedOut) ? 'disabled' : ''}>Clock Out</button>
          </div>
        </div>
        ${balRows}
      </div>
      <div class="section-title mt">Recent Payslips</div>
      ${UI.table(
        [
          { key: 'month', label: 'Month' },
          { key: 'net_salary', label: 'Net Salary', render: (r) => UI.money(r.net_salary) },
          { key: 'a', label: '', render: (r) => `<a href="/api/payroll/${r.id}/pdf" target="_blank">Download</a>` },
        ],
        payslips.slice(0, 3),
        'No payslips yet.'
      )}
    `;

    const tick = () => {
      const el = document.getElementById('clock');
      if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    clearInterval(this._clock);
    this._clock = setInterval(tick, 1000);

    const ci = document.getElementById('checkin');
    const co = document.getElementById('checkout');
    if (ci) ci.onclick = async () => {
      try { await api.post('/attendance/check-in'); UI.toast('Clocked in!', 'success'); this.dashboard(c); }
      catch (e) { UI.toast(e.message, 'error'); this.dashboard(c); }
    };
    if (co) co.onclick = async () => {
      try { const r = await api.post('/attendance/check-out'); UI.toast('Clocked out. ' + r.workHours + ' hrs worked (' + r.status + ').', 'success'); this.dashboard(c); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
  },

  async attendance(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const month = UI.thisMonth();
    const [{ attendance }, { corrections }, today] = await Promise.all([
      api.get('/attendance/my?month=' + month),
      api.get('/attendance/corrections/my'),
      api.get('/attendance/today'),
    ]);
    const a = today.attendance;
    const win = today.window || { open: true, cutoff: '' };
    const checkedIn = a && a.check_in;
    const checkedOut = a && a.check_out;
    const windowClosed = !win.open && !checkedIn;
    let statusLine;
    if (checkedIn) {
      statusLine = 'Clocked in at <b>' + UI.time(a.check_in) + '</b>'
        + (checkedOut ? ' &middot; Clocked out at <b>' + UI.time(a.check_out) + '</b>' : '')
        + (a.status ? ' &middot; Status: ' + UI.tag(a.status) : '');
    } else if (windowClosed) {
      statusLine = `<span style="color:var(--red)">Attendance window closed (clock-in was allowed until <b>${UI.esc(win.cutoff)}</b>). Use <b>Raise Attendance Request</b> below.</span>`;
    } else {
      statusLine = `You have not clocked in today. Please clock in before <b>${UI.esc(win.cutoff)}</b>.`;
    }
    c.innerHTML = `
      <div class="card">
        <div class="section-title">Mark Today's Attendance</div>
        <div class="pill-clock" id="clock">--:--</div>
        <div class="muted" style="margin:6px 0 14px">${statusLine}</div>
        <div class="btn-row">
          <button class="btn green" id="checkin" ${(checkedIn || windowClosed) ? 'disabled' : ''}>Clock In</button>
          <button class="btn" id="checkout" ${(!checkedIn || checkedOut) ? 'disabled' : ''}>Clock Out</button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:10px">Missed the window or need a half-day/past-day fix? Use <b>Raise Attendance Request</b> below — your manager/HR will approve it.</p>
      </div>
      <div class="toolbar mt">
        <label class="muted">Month</label>
        <input type="month" id="m" value="${month}" />
        <div class="spacer"></div>
        <button class="btn secondary" id="reqfix">Raise Attendance Request</button>
      </div>
      <div id="att">${this.attTable(attendance)}</div>
      <div class="section-title mt">My Attendance Requests</div>
      ${UI.table([
        { key: 'date', label: 'Date', render: (r) => UI.date(r.date) },
        { key: 'requested_status', label: 'Requested', render: (r) => UI.tag(r.requested_status) },
        { key: 'reason', label: 'Reason', render: (r) => UI.esc(r.reason || '-') },
        { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
        { key: 'comment', label: 'Comment', render: (r) => UI.esc(r.comment || '-') },
      ], corrections, 'No attendance requests.')}`;

    // Live clock
    const tick = () => { const el = document.getElementById('clock'); if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    tick(); clearInterval(this._clock); this._clock = setInterval(tick, 1000);

    const ci = document.getElementById('checkin');
    const co = document.getElementById('checkout');
    if (ci) ci.onclick = async () => {
      try { await api.post('/attendance/check-in'); UI.toast('Clocked in!', 'success'); this.attendance(c); }
      catch (e) { UI.toast(e.message, 'error'); this.attendance(c); }
    };
    if (co) co.onclick = async () => {
      try { const r = await api.post('/attendance/check-out'); UI.toast('Clocked out. ' + r.workHours + ' hrs worked (' + r.status + ').', 'success'); this.attendance(c); }
      catch (e) { UI.toast(e.message, 'error'); }
    };

    document.getElementById('m').onchange = async (e) => {
      const { attendance } = await api.get('/attendance/my?month=' + e.target.value);
      document.getElementById('att').innerHTML = this.attTable(attendance);
    };
    document.getElementById('reqfix').onclick = () => {
      const m = UI.modal({
        title: 'Raise Attendance Request',
        bodyHtml: `
          <p class="muted" style="font-size:13px">Use this if you missed the clock-in window, forgot to mark, or need a half-day. Admin/manager will approve or reject it.</p>
          <div class="field"><label>Date</label><input type="date" id="date" /></div>
          <div class="field"><label>Mark as</label>
            <select id="rstatus"><option value="present">Present (Full Day)</option><option value="half">Half Day</option><option value="leave">On Leave</option><option value="absent">Absent</option></select>
          </div>
          <div class="form-grid">
            <div class="field"><label>Clock In (optional)</label><input type="time" id="rin" /></div>
            <div class="field"><label>Clock Out (optional)</label><input type="time" id="rout" /></div>
          </div>
          <div class="field"><label>Reason</label><textarea id="reason" rows="2"></textarea></div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="submit">Submit</button>`,
      });
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#submit').onclick = async () => {
        try {
          await api.post('/attendance/correction', {
            date: m.root.querySelector('#date').value,
            requested_status: m.root.querySelector('#rstatus').value,
            requested_in: m.root.querySelector('#rin').value,
            requested_out: m.root.querySelector('#rout').value,
            reason: m.root.querySelector('#reason').value,
          });
          m.close(); UI.toast('Correction requested.', 'success'); this.attendance(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };
  },
  attTable(rows) {
    return UI.table([
      { key: 'date', label: 'Date', render: (r) => UI.date(r.date) },
      { key: 'check_in', label: 'Clock In', render: (r) => UI.time(r.check_in) },
      { key: 'check_out', label: 'Clock Out', render: (r) => UI.time(r.check_out) },
      { key: 'work_hours', label: 'Hours', render: (r) => r.work_hours || '-' },
      { key: 'late_minutes', label: 'Late', render: (r) => r.late_minutes ? r.late_minutes + 'm' : '-' },
      { key: 'ot_hours', label: 'OT', render: (r) => r.ot_hours ? r.ot_hours + 'h' : '-' },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
    ], rows, 'No attendance records for this month.');
  },

  async leave(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [{ leaves }, balRes, { types }] = await Promise.all([api.get('/leave/my'), api.get('/leave/balance'), api.get('/leave/types')]);
    const balCards = Object.values(balRes.balance || {})
      .map((v) => `<div class="card stat"><div class="label">${UI.esc(v.name)}</div><div class="value">${v.remaining}<span class="muted" style="font-size:14px"> / ${v.allowed}</span></div></div>`).join('');
    c.innerHTML = `
      <div class="cards" style="margin-bottom:16px">${balCards || ''}</div>
      <div class="toolbar"><div class="spacer"></div><button class="btn" id="apply">Apply for Leave</button></div>
      ${UI.table([
        { key: 'type', label: 'Type', render: (r) => UI.esc((types.find((t) => t.code === r.type) || {}).name || r.type) },
        { key: 'from_date', label: 'From', render: (r) => UI.date(r.from_date) },
        { key: 'to_date', label: 'To', render: (r) => UI.date(r.to_date) },
        { key: 'days', label: 'Days', render: (r) => r.days + (r.half_day ? ' (half)' : '') },
        { key: 'reason', label: 'Reason', render: (r) => UI.esc(r.reason || '-') },
        { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
        { key: 'comment', label: 'Comment', render: (r) => UI.esc(r.comment || '-') },
      ], leaves, 'You have not applied for any leave.')}`;

    document.getElementById('apply').onclick = () => {
      const m = UI.modal({
        title: 'Apply for Leave',
        bodyHtml: `
          <div class="field"><label>Leave Type</label><select id="type">${types.map((t) => `<option value="${t.code}">${UI.esc(t.name)}${t.paid === false ? ' (unpaid)' : ''}</option>`).join('')}</select></div>
          <div class="form-grid">
            <div class="field"><label>From</label><input type="date" id="from" /></div>
            <div class="field"><label>To</label><input type="date" id="to" /></div>
          </div>
          <label class="checkbox-row" style="margin-bottom:12px"><input type="checkbox" id="half" /> Half day (single date only)</label>
          <div class="field"><label>Reason</label><textarea id="reason" rows="3"></textarea></div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="submit">Submit</button>`,
      });
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      // When half-day is ticked, force To = From.
      const halfEl = m.root.querySelector('#half');
      halfEl.onchange = () => { if (halfEl.checked) m.root.querySelector('#to').value = m.root.querySelector('#from').value; };
      m.root.querySelector('#from').onchange = () => { if (halfEl.checked) m.root.querySelector('#to').value = m.root.querySelector('#from').value; };
      m.root.querySelector('#submit').onclick = async () => {
        try {
          await api.post('/leave', {
            type: m.root.querySelector('#type').value,
            from_date: m.root.querySelector('#from').value,
            to_date: m.root.querySelector('#to').value,
            half_day: m.root.querySelector('#half').checked,
            reason: m.root.querySelector('#reason').value,
          });
          m.close(); UI.toast('Leave applied.', 'success'); this.leave(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };
  },

  async reimbursement(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { reimbursements } = await api.get('/reimbursement/my');
    c.innerHTML = `
      <div class="toolbar"><div class="spacer"></div><button class="btn" id="apply">New Reimbursement</button></div>
      ${UI.table([
        { key: 'title', label: 'Title' },
        { key: 'category', label: 'Category', render: (r) => UI.esc(r.category || '-') },
        { key: 'amount', label: 'Amount', render: (r) => UI.money(r.amount) },
        { key: 'bill', label: 'Bill', render: (r) => r.bill_file ? `<a href="/api/reimbursement/${r.id}/bill" target="_blank">View</a>` : '-' },
        { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
        { key: 'comment', label: 'Comment', render: (r) => UI.esc(r.comment || '-') },
      ], reimbursements, 'No reimbursements yet.')}`;

    document.getElementById('apply').onclick = () => {
      const m = UI.modal({
        title: 'New Reimbursement',
        bodyHtml: `
          <div class="field"><label>Title</label><input id="title" placeholder="e.g. Client lunch" /></div>
          <div class="form-grid">
            <div class="field"><label>Category</label><input id="category" placeholder="Travel / Food / ..." /></div>
            <div class="field"><label>Amount</label><input id="amount" type="number" step="0.01" /></div>
          </div>
          <div class="field"><label>Bill / Receipt (optional)</label><input id="bill" type="file" /></div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="submit">Submit</button>`,
      });
      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#submit').onclick = async () => {
        const fd = new FormData();
        fd.append('title', m.root.querySelector('#title').value);
        fd.append('category', m.root.querySelector('#category').value);
        fd.append('amount', m.root.querySelector('#amount').value);
        const f = m.root.querySelector('#bill').files[0];
        if (f) fd.append('bill', f);
        try { await api.upload('/reimbursement', fd); m.close(); UI.toast('Submitted.', 'success'); this.reimbursement(c); }
        catch (e) { UI.toast(e.message, 'error'); }
      };
    };
  },

  async payslips(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { payslips } = await api.get('/payroll/my');
    c.innerHTML = UI.table([
      { key: 'month', label: 'Month' },
      { key: 'paid_days', label: 'Paid Days' },
      { key: 'gross', label: 'Gross', render: (r) => UI.money(r.gross) },
      { key: 'deductions', label: 'Deductions', render: (r) => UI.money(r.deductions) },
      { key: 'net_salary', label: 'Net Salary', render: (r) => UI.money(r.net_salary) },
      { key: 'dl', label: '', render: (r) => `<a class="btn sm" href="/api/payroll/${r.id}/pdf" target="_blank">Download PDF</a>` },
    ], payslips, 'No payslips generated yet.');
  },

  async profile(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { employee } = await api.get('/employees/me');
    const account = [
      ['Login Email', App.user.email],
      ['Role', App.user.roleLabel || App.user.role],
    ];
    let empCard = '';
    if (employee) {
      const rows = [
        ['Name', employee.name], ['Employee Code', employee.emp_code], ['Email', employee.email],
        ['Phone', employee.phone], ['Department', employee.department], ['Designation', employee.designation],
        ['Date of Joining', UI.date(employee.date_of_joining)], ['Manager', employee.manager_name || employee.manager],
        ['Date of Birth', employee.dob ? UI.date(employee.dob) : '-'], ['Gender', employee.gender],
        ['Blood Group', employee.blood_group], ['Emergency Contact', [employee.emergency_name, employee.emergency_phone].filter(Boolean).join(' · ')],
        ['Education', employee.education], ['Experience', employee.experience],
        ['Monthly Salary', UI.money(employee.monthly_salary)], ['Bank Account', employee.bank_account],
        ['IFSC', employee.ifsc], ['PAN', employee.pan], ['Aadhaar / ID', employee.aadhaar], ['Address', employee.address],
      ];
      empCard = `
        <div class="card mt" style="max-width:620px">
          <div class="section-title">Employee Details</div>
          <table>${rows.map((r) => `<tr><td class="muted">${UI.esc(r[0])}</td><td>${UI.esc(r[1] || '-')}</td></tr>`).join('')}</table>
          <div class="mt"><button class="btn secondary" id="docs">My Documents</button></div>
        </div>
        <div class="card mt" style="max-width:620px">
          <div class="section-title">My Assets</div>
          <div id="myassets" class="muted">Loading...</div>
        </div>`;
    }
    c.innerHTML = `
      <div class="card" style="max-width:620px">
        <div class="section-title">My Account</div>
        <table>${account.map((r) => `<tr><td class="muted">${UI.esc(r[0])}</td><td>${UI.esc(r[1] || '-')}</td></tr>`).join('')}</table>
        <div class="mt"><button class="btn secondary" id="pw">Change Password</button></div>
      </div>
      ${empCard}`;
    document.getElementById('pw').onclick = () => App.changePasswordModal();
    if (employee) {
      document.getElementById('docs').onclick = () => AdminViews.documentsModal(employee.id, employee.name);
      api.get('/assets/mine').then(({ assets }) => {
        document.getElementById('myassets').innerHTML = assets.length
          ? UI.table([{ key: 'name', label: 'Asset' }, { key: 'tag', label: 'Tag', render: (r) => UI.esc(r.tag || '-') }, { key: 'category', label: 'Category', render: (r) => UI.esc(r.category || '-') }], assets)
          : '<div class="empty">No assets assigned to you.</div>';
      }).catch(() => {});
    }
  },

  // Read-only holidays calendar for employees
  async holidays(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const year = new Date().getFullYear();
    const { holidays } = await api.get('/holidays?year=' + year);

    // Holiday type icons and colors
    const typeInfo = {
      'public': { icon: '🇮🇳', color: '#fbbf24', desc: 'National Holiday' },
      'restricted': { icon: '🎭', color: '#a78bfa', desc: 'Regional/Cultural Holiday' },
      'company': { icon: '🏢', color: '#60a5fa', desc: 'Company Holiday' },
    };

    const holidayCards = holidays.map((h) => {
      const info = typeInfo[h.type] || typeInfo['public'];
      const date = new Date(h.date + 'T00:00:00');
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      const daysUntil = Math.ceil((date - new Date()) / (1000 * 60 * 60 * 24));
      const upcoming = daysUntil > 0 && daysUntil <= 7 ? `<div style="color:#16a34a;font-size:12px;font-weight:600;margin-top:6px">⏰ In ${daysUntil} day(s)</div>` : '';

      return `<div class="card" style="border-left:4px solid ${info.color};padding:14px">
        <div style="display:flex;align-items:start;justify-content:space-between;gap:10px">
          <div style="flex:1">
            <div style="font-size:16px;font-weight:700;margin-bottom:4px">${info.icon} ${UI.esc(h.name)}</div>
            <div style="font-size:13px;color:var(--muted)">${UI.date(h.date)} • ${dayName}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">${info.desc}</div>
            ${upcoming}
          </div>
        </div>
      </div>`;
    }).join('');

    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">Company Holidays ${year}</div></div>
      <div class="card" style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px;margin-bottom:16px">
        <div style="font-size:13px;color:#166534">
          <strong>📢 You'll receive Slack & email notifications for upcoming holidays based on the holiday type!</strong>
        </div>
      </div>
      <div style="display:grid;gap:12px">${holidayCards}</div>`;
  },
};
