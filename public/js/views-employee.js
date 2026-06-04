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
        <button class="btn" id="reqfix">+ Raise Attendance Request</button>
      </div>
      <div id="att">${this.attTable(attendance)}</div>

      <div style="margin-top:28px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <div class="section-title" style="margin:0">My Attendance Requests</div>
          <div style="display:flex;gap:6px">
            ${['all','pending','approved','rejected'].map((f,i) => `
              <button class="req-filter" data-filter="${f}"
                style="padding:4px 12px;border:1px solid #e5e7eb;background:${i===0?'#4f46e5':'#fff'};color:${i===0?'#fff':'#374151'};border-radius:16px;cursor:pointer;font-size:12px;font-weight:600">
                ${f.charAt(0).toUpperCase()+f.slice(1)}
                ${f==='pending' ? `<span id="pending-badge" style="background:#ef4444;color:#fff;border-radius:10px;padding:0 5px;font-size:10px;margin-left:3px">${corrections.filter(x=>x.status==='pending').length||''}</span>` : ''}
              </button>`).join('')}
          </div>
        </div>
        <div id="corrections-list">${this.correctionsList(corrections, 'all', false)}</div>
      </div>`;

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

    // Filter tabs
    document.querySelectorAll('.req-filter').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.req-filter').forEach(b => { b.style.background='#fff'; b.style.color='#374151'; b.style.borderColor='#e5e7eb'; });
        btn.style.background='#4f46e5'; btn.style.color='#fff'; btn.style.borderColor='#4f46e5';
        document.getElementById('corrections-list').innerHTML = this.correctionsList(corrections, btn.dataset.filter, false);
        this.bindCancelButtons(c, corrections);
      };
    });
    this.bindCancelButtons(c, corrections);

    // Raise request modal
    document.getElementById('reqfix').onclick = () => {
      const today = new Date().toISOString().split('T')[0];
      const types = [
        { key: 'missed_punch',    icon: '👊', label: 'Missed Punch',       desc: 'Forgot to clock in or clock out' },
        { key: 'regularization',  icon: '📋', label: 'Regularization',     desc: 'Working hours need to be updated' },
        { key: 'wfh',             icon: '🏠', label: 'Work From Home',     desc: 'Was working from home that day' },
        { key: 'late_arrival',    icon: '⏰', label: 'Late Arrival',       desc: 'Arrived late due to valid reason' },
        { key: 'early_departure', icon: '🚪', label: 'Early Departure',    desc: 'Left early due to valid reason' },
        { key: 'on_duty',         icon: '✈️', label: 'On Duty / Travel',   desc: 'Was on official duty or travel' },
        { key: 'half_day',        icon: '🌓', label: 'Half Day',           desc: 'Only worked half a day' },
      ];
      const m = UI.modal({
        title: '📝 Raise Attendance Request',
        bodyHtml: `
          <p style="font-size:13px;color:#6b7280;margin-bottom:16px">Select the type of request and fill in the details. Your manager/HR will review and approve.</p>

          <div class="field">
            <label><strong>Request Type *</strong></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px" id="type-grid">
              ${types.map((t,i) => `
                <button class="req-type-btn" data-type="${t.key}"
                  style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid ${i===0?'#4f46e5':'#e5e7eb'};border-radius:8px;background:${i===0?'#f5f3ff':'#fff'};cursor:pointer;text-align:left">
                  <span style="font-size:18px">${t.icon}</span>
                  <div>
                    <div style="font-size:12px;font-weight:600;color:#111">${t.label}</div>
                    <div style="font-size:11px;color:#6b7280">${t.desc}</div>
                  </div>
                </button>`).join('')}
            </div>
            <input type="hidden" id="req-type" value="${types[0].key}" />
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px">
            <div class="field">
              <label><strong>Date *</strong></label>
              <input type="date" id="req-date" max="${today}" style="width:100%" />
            </div>
            <div class="field">
              <label><strong>Mark attendance as *</strong></label>
              <select id="req-status" style="width:100%">
                <option value="present">Present (Full Day)</option>
                <option value="half">Half Day</option>
                <option value="leave">On Leave</option>
                <option value="absent">Absent</option>
              </select>
            </div>
            <div class="field">
              <label>Clock In <span style="color:#9ca3af;font-weight:400">(optional)</span></label>
              <input type="time" id="req-in" style="width:100%" />
            </div>
            <div class="field">
              <label>Clock Out <span style="color:#9ca3af;font-weight:400">(optional)</span></label>
              <input type="time" id="req-out" style="width:100%" />
            </div>
          </div>

          <div class="field" style="margin-top:4px">
            <label><strong>Reason *</strong></label>
            <textarea id="req-reason" rows="3" placeholder="Briefly explain why you need this correction…" style="width:100%"></textarea>
            <div id="reason-count" style="font-size:11px;color:#9ca3af;text-align:right;margin-top:3px">0 / 200 characters</div>
          </div>`,
        footHtml: `<button class="btn secondary" data-close-btn>Cancel</button><button class="btn" id="req-submit">Submit Request</button>`,
      });

      // Type button selection
      m.root.querySelectorAll('.req-type-btn').forEach(btn => {
        btn.onclick = () => {
          m.root.querySelectorAll('.req-type-btn').forEach(b => { b.style.borderColor='#e5e7eb'; b.style.background='#fff'; });
          btn.style.borderColor='#4f46e5'; btn.style.background='#f5f3ff';
          m.root.querySelector('#req-type').value = btn.dataset.type;
          // Auto-set status for WFH and on_duty
          const statusMap = { wfh:'present', on_duty:'present', half_day:'half', late_arrival:'present', early_departure:'present', missed_punch:'present', regularization:'present' };
          if (statusMap[btn.dataset.type]) m.root.querySelector('#req-status').value = statusMap[btn.dataset.type];
        };
      });

      // Reason character counter
      const reasonEl = m.root.querySelector('#req-reason');
      const countEl = m.root.querySelector('#reason-count');
      reasonEl.oninput = () => {
        const len = reasonEl.value.length;
        countEl.textContent = `${len} / 200 characters`;
        countEl.style.color = len > 180 ? '#ef4444' : '#9ca3af';
        if (len > 200) reasonEl.value = reasonEl.value.slice(0, 200);
      };

      m.root.querySelector('[data-close-btn]').onclick = m.close;
      m.root.querySelector('#req-submit').onclick = async () => {
        const date = m.root.querySelector('#req-date').value;
        const status = m.root.querySelector('#req-status').value;
        const reason = m.root.querySelector('#req-reason').value.trim();
        if (!date) { UI.toast('Please select a date.', 'error'); return; }
        if (!reason) { UI.toast('Please enter a reason.', 'error'); return; }
        try {
          await api.post('/attendance/correction', {
            date, type: m.root.querySelector('#req-type').value,
            requested_status: status,
            requested_in: m.root.querySelector('#req-in').value || null,
            requested_out: m.root.querySelector('#req-out').value || null,
            reason,
          });
          m.close();
          UI.toast('✅ Request submitted! Your manager/HR will review it.', 'success');
          this.attendance(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    };
  },

  correctionsList(corrections, filter, isAdmin) {
    const TYPE_ICONS = { missed_punch:'👊', regularization:'📋', wfh:'🏠', late_arrival:'⏰', early_departure:'🚪', on_duty:'✈️', half_day:'🌓' };
    const TYPE_LABELS = { missed_punch:'Missed Punch', regularization:'Regularization', wfh:'WFH', late_arrival:'Late Arrival', early_departure:'Early Departure', on_duty:'On Duty', half_day:'Half Day' };
    const STATUS_STYLE = { pending:['#fef9c3','#92400e','⏳'], approved:['#dcfce7','#166534','✅'], rejected:['#fee2e2','#991b1b','❌'] };

    const filtered = filter === 'all' ? corrections : corrections.filter(r => r.status === filter);
    if (!filtered.length) return `
      <div style="text-align:center;padding:36px 20px;color:#9ca3af;border:2px dashed #e5e7eb;border-radius:10px">
        <div style="font-size:32px;margin-bottom:8px">📭</div>
        <div style="font-weight:600">No ${filter === 'all' ? '' : filter} requests</div>
      </div>`;

    return filtered.map(r => {
      const typeIcon = TYPE_ICONS[r.type] || '📋';
      const typeLabel = TYPE_LABELS[r.type] || (r.type || 'Request');
      const [sbg, sfg, sicon] = STATUS_STYLE[r.status] || STATUS_STYLE.pending;
      return `
        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:10px;background:#fff;display:flex;gap:12px;align-items:flex-start">
          <div style="font-size:24px;flex-shrink:0;margin-top:2px">${typeIcon}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="font-weight:700;font-size:14px">${typeLabel}</span>
              <span style="background:${sbg};color:${sfg};padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600">${sicon} ${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span>
              ${isAdmin ? `<span style="font-size:12px;color:#6b7280;font-weight:600">${UI.esc(r.employee_name || '')} ${r.department ? '· '+UI.esc(r.department) : ''}</span>` : ''}
            </div>
            <div style="font-size:13px;color:#374151;margin-bottom:4px">
              📅 <strong>${UI.date(r.date)}</strong>
              &nbsp;·&nbsp; Mark as: ${UI.tag(r.requested_status)}
              ${r.requested_in ? ` &nbsp;·&nbsp; In: <strong>${r.requested_in}</strong>` : ''}
              ${r.requested_out ? ` Out: <strong>${r.requested_out}</strong>` : ''}
            </div>
            <div style="font-size:12px;color:#6b7280">${UI.esc(r.reason || '')}</div>
            ${r.comment ? `<div style="margin-top:6px;font-size:12px;background:#f3f4f6;padding:6px 10px;border-radius:6px;color:#374151">💬 <em>${UI.esc(r.comment)}</em></div>` : ''}
            <div style="font-size:11px;color:#9ca3af;margin-top:6px">Submitted ${UI.date(r.applied_at)}${r.decided_at ? ' · Decided '+UI.date(r.decided_at) : ''}</div>
          </div>
          ${!isAdmin && r.status === 'pending' ? `<button class="btn sm secondary cancel-req" data-id="${r.id}" style="flex-shrink:0;border-color:#e5e7eb;color:#6b7280">Cancel</button>` : ''}
          ${isAdmin && r.status === 'pending' ? `<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0"><button class="btn sm green appr-req" data-id="${r.id}">Approve</button><button class="btn sm red rej-req" data-id="${r.id}">Reject</button></div>` : ''}
        </div>`;
    }).join('');
  },

  bindCancelButtons(c, corrections) {
    document.querySelectorAll('.cancel-req').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Cancel this attendance request?')) return;
        try {
          await api.request('DELETE', '/attendance/corrections/' + btn.dataset.id);
          UI.toast('Request cancelled.', 'success');
          this.attendance(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    });
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
