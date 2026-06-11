const EmployeeViews = {
  async dashboard(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const [todayRes, balanceRes, { payslips }, moodData] = await Promise.all([
      api.get('/attendance/today'),
      api.get('/leave/balance'),
      api.get('/payroll/my'),
      api.get('/mood/my').catch(() => ({ today: null })),
    ]);
    const a = todayRes.attendance;
    const winState = todayRes.window || { open: true, cutoff: '' };
    const checkedIn = a && a.check_in;
    const checkedOut = a && a.check_out;
    const windowClosed = !winState.open && !checkedIn;
    const todayMood = moodData && moodData.today ? moodData.today : null;

    const balRows = Object.values(balanceRes.balance || {})
      .map((v) => `<div class="card stat"><div class="label">${UI.esc(v.name)} left</div><div class="value">${v.remaining}<span class="muted" style="font-size:14px"> / ${v.allowed}</span></div></div>`)
      .join('');

    c.innerHTML = `
      <div class="cards">
        <div class="card">
          <div class="section-title">Today's Attendance</div>
          <div class="pill-clock" id="clock">--:--</div>
          <div class="muted" style="margin:6px 0 14px">
            ${checkedIn ? 'Attendance marked at ' + UI.time(a.check_in) + (a.late_minutes > 0 ? ' <span style="background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:700">⏰ Late by ' + UI.duration(a.late_minutes) + '</span>' : '') : (windowClosed ? '<span style="color:var(--red)">Window closed (till ' + UI.esc(winState.cutoff) + '). Raise a request from My Attendance.</span>' : (winState.allDay ? 'Not marked yet — you can mark anytime today.' : 'Not marked yet (mark before ' + UI.esc(winState.cutoff) + ')'))}
          </div>
          <div class="btn-row">
            <button class="btn green" id="markatt" ${(checkedIn || windowClosed) ? 'disabled' : ''}>${checkedIn ? '✓ Attendance Marked' : 'Mark Attendance'}</button>
          </div>
          ${checkedIn ? '' : `<div id="mood-inline" style="margin-top:14px;padding-top:12px;border-top:1px dashed #e5e7eb">${this.moodInlineHtml(todayMood)}</div>`}
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
      <div id="emp-celebrations"></div>
    `;
    AdminViews.celebrationsCard(document.getElementById('emp-celebrations'));

    const tick = () => {
      const el = document.getElementById('clock');
      if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    clearInterval(this._clock);
    this._clock = setInterval(tick, 1000);

    // Inline mood picker (mood is mandatory before attendance)
    this.bindMoodInline(c);

    const mark = document.getElementById('markatt');
    if (mark) mark.onclick = async () => {
      const fresh = await api.get('/mood/my').catch(() => ({ today: null }));
      if (!fresh.today) {
        UI.toast('😊 Please mark your mood for today first — it is required.', 'error');
        const wrap = document.getElementById('mood-inline');
        if (wrap) { wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); wrap.style.outline = '2px solid #ef4444'; wrap.style.borderRadius = '8px'; setTimeout(() => { wrap.style.outline = ''; }, 2500); }
        return;
      }
      try { await api.post('/attendance/check-in'); UI.toast('Attendance marked!', 'success'); this.dashboard(c); }
      catch (e) { UI.toast(e.message, 'error'); this.dashboard(c); }
    };

    // Nudge new hires who haven't completed their joining form yet.
    api.get('/employees/me').then(({ employee }) => {
      if (!employee || employee.onboarding_submitted) return;
      const banner = document.createElement('div');
      banner.className = 'card';
      banner.style.cssText = 'border-left:4px solid #2563eb;margin-bottom:14px;cursor:pointer';
      banner.innerHTML = '<b>📋 Complete your onboarding</b><div class="muted" style="font-size:13px">Fill in your joining details and upload your documents so HR can finish setting you up. Click here to start.</div>';
      banner.onclick = () => { location.hash = '#/my-onboarding'; };
      c.insertBefore(banner, c.firstChild);
    }).catch(() => {});
  },

  async attendance(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const month = UI.thisMonth();
    const [{ attendance }, { corrections }, today, moodData] = await Promise.all([
      api.get('/attendance/my?month=' + month),
      api.get('/attendance/corrections/my'),
      api.get('/attendance/today'),
      api.get('/mood/my').catch(() => ({ today: null })),
    ]);
    const todayMood = moodData && moodData.today ? moodData.today : null;
    const a = today.attendance;
    const win = today.window || { open: true, cutoff: '' };
    const checkedIn = a && a.check_in;
    const checkedOut = a && a.check_out;
    const windowClosed = !win.open && !checkedIn;
    let statusLine;
    if (checkedIn) {
      statusLine = 'Attendance marked at <b>' + UI.time(a.check_in) + '</b>'
        + (a.status ? ' &middot; Status: ' + UI.tag(a.status) : '')
        + (a.late_minutes > 0 ? ' &middot; <span style="background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:700">⏰ Late by ' + UI.duration(a.late_minutes) + '</span>' : '');
    } else if (windowClosed) {
      statusLine = `<span style="color:var(--red)">Attendance window closed (you could mark until <b>${UI.esc(win.cutoff)}</b>). Use <b>Raise Attendance Request</b> below.</span>`;
    } else if (win.allDay) {
      statusLine = `You haven't marked attendance today. You can mark it <b>anytime today</b> — it records your actual time.`;
    } else {
      statusLine = `You haven't marked attendance today. Please mark it before <b>${UI.esc(win.cutoff)}</b>.`;
    }
    c.innerHTML = `
      <div class="card">
        <div class="section-title">Mark Today's Attendance</div>
        <div class="pill-clock" id="clock">--:--</div>
        <div class="muted" style="margin:6px 0 14px">${statusLine}</div>
        <div class="btn-row">
          <button class="btn green" id="markatt" ${(checkedIn || windowClosed) ? 'disabled' : ''}>${checkedIn ? '✓ Attendance Marked' : 'Mark Attendance'}</button>
        </div>

        <!-- Daily happiness check-in (marked along with attendance) -->
        <div id="mood-inline" style="margin-top:16px;padding-top:14px;border-top:1px dashed #e5e7eb">
          ${this.moodInlineHtml(todayMood)}
        </div>

        <p class="muted" style="font-size:12px;margin-top:12px">Missed the window or need a half-day/past-day fix? Use <b>Raise Attendance Request</b> below — your manager/HR will approve it.</p>
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

    // Inline happiness check-in
    this.bindMoodInline(c);

    const mark = document.getElementById('markatt');
    if (mark) mark.onclick = async () => {
      // Mood is mandatory — must be marked for today before attendance.
      const fresh = await api.get('/mood/my').catch(() => ({ today: null }));
      if (!fresh.today) {
        UI.toast('😊 Please mark your mood for today first — it is required.', 'error');
        const wrap = document.getElementById('mood-inline');
        if (wrap) { wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); wrap.style.outline = '2px solid #ef4444'; wrap.style.borderRadius = '8px'; setTimeout(() => { wrap.style.outline = ''; }, 2500); }
        return;
      }
      try {
        const r = await api.post('/attendance/check-in');
        const lateMsg = r.lateMinutes > 0 ? ` ⏰ You're ${UI.duration(r.lateMinutes)} late.` : '';
        UI.toast(`Attendance marked!${lateMsg}`, 'success');
        this.attendance(c);
      } catch (e) { UI.toast(e.message, 'error'); this.attendance(c); }
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
              <input type="date" id="req-date" value="${today}" min="${today}" max="${today}" disabled style="width:100%;background:#f3f4f6;color:#6b7280" />
              <div style="font-size:11px;color:#9ca3af;margin-top:3px">Requests can only be raised for <strong>today</strong>.</div>
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
              <label>Attendance Time <span style="color:#9ca3af;font-weight:400">(optional)</span></label>
              <input type="time" id="req-in" style="width:100%" />
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
        const date = today; // requests are for the present day only
        const status = m.root.querySelector('#req-status').value;
        const reason = m.root.querySelector('#req-reason').value.trim();
        if (!reason) { UI.toast('Please enter a reason.', 'error'); return; }
        try {
          await api.post('/attendance/correction', {
            date, type: m.root.querySelector('#req-type').value,
            requested_status: status,
            requested_in: m.root.querySelector('#req-in').value || null,
            requested_out: null,
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

    const todayStr = new Date().toISOString().slice(0, 10);
    return filtered.map(r => {
      const typeIcon = TYPE_ICONS[r.type] || '📋';
      const typeLabel = TYPE_LABELS[r.type] || (r.type || 'Request');
      const [sbg, sfg, sicon] = STATUS_STYLE[r.status] || STATUS_STYLE.pending;
      // A pending request whose day has passed can no longer be approved (same-day only).
      const expired = r.status === 'pending' && r.date < todayStr;
      return `
        <div style="border:1px solid ${expired ? '#fed7aa' : '#e5e7eb'};border-radius:10px;padding:14px 16px;margin-bottom:10px;background:#fff;display:flex;gap:12px;align-items:flex-start">
          <div style="font-size:24px;flex-shrink:0;margin-top:2px">${typeIcon}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
              <span style="font-weight:700;font-size:14px">${typeLabel}</span>
              <span style="background:${sbg};color:${sfg};padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600">${sicon} ${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span>
              ${expired ? `<span style="background:#fff7ed;color:#9a3412;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600">⏰ Expired</span>` : ''}
              ${isAdmin ? `<span style="font-size:12px;color:#6b7280;font-weight:600">${UI.esc(r.employee_name || '')} ${r.department ? '· '+UI.esc(r.department) : ''}</span>` : ''}
            </div>
            <div style="font-size:13px;color:#374151;margin-bottom:4px">
              📅 <strong>${UI.date(r.date)}</strong>
              &nbsp;·&nbsp; Mark as: ${UI.tag(r.requested_status)}
              ${r.requested_in ? ` &nbsp;·&nbsp; In: <strong>${r.requested_in}</strong>` : ''}
              ${r.requested_out ? ` Out: <strong>${r.requested_out}</strong>` : ''}
            </div>
            <div style="font-size:12px;color:#6b7280">${UI.esc(r.reason || '')}</div>
            ${expired ? `<div style="margin-top:6px;font-size:12px;background:#fff7ed;border:1px solid #fed7aa;padding:6px 10px;border-radius:6px;color:#9a3412">⏰ This request was for a past day and can no longer be approved (same-day approval only). You can reject it.</div>` : ''}
            ${r.comment ? `<div style="margin-top:6px;font-size:12px;background:#f3f4f6;padding:6px 10px;border-radius:6px;color:#374151">💬 <em>${UI.esc(r.comment)}</em></div>` : ''}
            <div style="font-size:11px;color:#9ca3af;margin-top:6px">Submitted ${UI.date(r.applied_at)}${r.decided_at ? ' · Decided '+UI.date(r.decided_at) : ''}</div>
          </div>
          ${!isAdmin && r.status === 'pending' ? `<button class="btn sm secondary cancel-req" data-id="${r.id}" style="flex-shrink:0;border-color:#e5e7eb;color:#6b7280">Cancel</button>` : ''}
          ${isAdmin && r.status === 'pending' ? `<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">${expired ? '' : `<button class="btn sm green appr-req" data-id="${r.id}">Approve</button>`}<button class="btn sm red rej-req" data-id="${r.id}">Reject</button></div>` : ''}
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

  // The 5 mood levels used in the inline attendance check-in.
  MOOD_LEVELS: [
    { score: 1, emoji: '😞', label: 'Very Unhappy', color: '#ef4444', bg: '#fef2f2' },
    { score: 2, emoji: '😟', label: 'Unhappy',      color: '#f97316', bg: '#fff7ed' },
    { score: 3, emoji: '😐', label: 'Neutral',      color: '#eab308', bg: '#fefce8' },
    { score: 4, emoji: '😊', label: 'Happy',        color: '#22c55e', bg: '#f0fdf4' },
    { score: 5, emoji: '😄', label: 'Very Happy',   color: '#10b981', bg: '#ecfdf5' },
  ],

  // Renders the inline mood row: recorded mood, or the picker if not set yet.
  moodInlineHtml(todayMood) {
    const M = this.MOOD_LEVELS;
    if (todayMood) {
      const m = M.find(x => x.score === todayMood.score) || M[2];
      return `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:13px;color:#374151;font-weight:600">Today's mood:</span>
          <span style="display:inline-flex;align-items:center;gap:6px;background:${m.bg};color:${m.color};padding:4px 12px;border-radius:16px;font-size:13px;font-weight:700">${m.emoji} ${m.label}</span>
          ${todayMood.note ? `<span style="font-size:12px;color:#9ca3af">— ${UI.esc(todayMood.note)}</span>` : ''}
          <button class="btn sm secondary" id="mood-change" style="margin-left:auto">Change</button>
        </div>`;
    }
    return `
      <div>
        <div style="font-size:13px;color:#374151;font-weight:600;margin-bottom:8px">😊 How are you feeling today? <span style="color:#ef4444;font-weight:700">* required</span> <span style="color:#9ca3af;font-weight:400">— mark before attendance</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${M.map(m => `
            <button class="mood-inline-btn" data-score="${m.score}" title="${m.label}"
              style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;min-width:62px">
              <span style="font-size:26px">${m.emoji}</span>
              <span style="font-size:10px;font-weight:600;color:#6b7280">${m.label}</span>
            </button>`).join('')}
        </div>
      </div>`;
  },

  // Wires the inline mood buttons. Saves immediately and re-renders the row.
  bindMoodInline(c) {
    const wrap = document.getElementById('mood-inline');
    if (!wrap) return;
    const save = async (score) => {
      try {
        const r = await api.post('/mood/checkin', { score });
        UI.toast(`${r.emoji} Mood saved: ${r.label}`, 'success');
        const fresh = await api.get('/mood/my').catch(() => ({ today: null }));
        wrap.innerHTML = this.moodInlineHtml(fresh.today);
        this.bindMoodInline(c);
      } catch (e) { UI.toast(e.message, 'error'); }
    };
    wrap.querySelectorAll('.mood-inline-btn').forEach(btn => {
      btn.onmouseenter = () => { btn.style.borderColor = '#4f46e5'; btn.style.background = '#f5f3ff'; };
      btn.onmouseleave = () => { btn.style.borderColor = '#e5e7eb'; btn.style.background = '#fff'; };
      btn.onclick = () => save(parseInt(btn.dataset.score));
    });
    const change = document.getElementById('mood-change');
    if (change) change.onclick = () => { wrap.innerHTML = this.moodInlineHtml(null); this.bindMoodInline(c); };
  },
  attTable(rows) {
    return UI.table([
      { key: 'date', label: 'Date', render: (r) => UI.date(r.date) },
      { key: 'check_in', label: 'Marked At', render: (r) => UI.time(r.check_in) },
      { key: 'late_minutes', label: 'Late', render: (r) => r.late_minutes ? UI.duration(r.late_minutes) : '-' },
      { key: 'status', label: 'Status', render: (r) => UI.tag(r.status) },
      { key: 'mood', label: 'Mood', render: (r) => r.mood_note ? `<span title="${UI.esc(r.mood_note)}">${UI.mood(r.mood_score)}</span>` : UI.mood(r.mood_score) },
    ], rows, 'No attendance records for this month.');
  },

  async mood(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const data = await api.get('/mood/my').catch(() => ({ checkins: [], today: null, average: null }));
    const { checkins, today, average, mood } = data;
    const MOODS = [
      { score: 1, emoji: '😞', label: 'Very Unhappy', color: '#ef4444', bg: '#fef2f2' },
      { score: 2, emoji: '😟', label: 'Unhappy',      color: '#f97316', bg: '#fff7ed' },
      { score: 3, emoji: '😐', label: 'Neutral',      color: '#eab308', bg: '#fefce8' },
      { score: 4, emoji: '😊', label: 'Happy',        color: '#22c55e', bg: '#f0fdf4' },
      { score: 5, emoji: '😄', label: 'Very Happy',   color: '#10b981', bg: '#ecfdf5' },
    ];

    const moodColor = mood ? mood.color : '#6b7280';
    const moodEmoji = mood ? mood.emoji : '😐';

    c.innerHTML = `
      <div class="section-title">😊 My Mood & Happiness</div>

      <!-- Today's check-in card -->
      <div class="card" style="margin-bottom:20px">
        <div style="font-weight:700;font-size:16px;margin-bottom:4px">How are you feeling today?</div>
        <div class="muted" style="font-size:13px;margin-bottom:18px">${today ? `You checked in today: <strong>${MOODS.find(m=>m.score===today.score)?.emoji} ${MOODS.find(m=>m.score===today.score)?.label}</strong>${today.note ? ` — <em>${UI.esc(today.note)}</em>` : ''}` : 'You haven\'t checked in yet today. Share how you\'re feeling!'}</div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:16px" id="mood-btns">
          ${MOODS.map(m => `
            <button class="mood-pick" data-score="${m.score}"
              style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 18px;border:2px solid ${today && today.score===m.score ? m.color : '#e5e7eb'};border-radius:12px;background:${today && today.score===m.score ? m.bg : '#fff'};cursor:pointer;transition:all .15s;min-width:70px">
              <span style="font-size:32px">${m.emoji}</span>
              <span style="font-size:11px;font-weight:600;color:#374151">${m.label}</span>
            </button>`).join('')}
        </div>
        <div id="mood-note-area" style="display:${today ? 'block' : 'none'}">
          <input id="mood-note" type="text" placeholder="Add a note (optional)…" value="${today && today.note ? UI.esc(today.note) : ''}"
            style="width:100%;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;box-sizing:border-box;margin-bottom:10px"/>
          <button class="btn" id="mood-save" style="width:100%">Save Today's Mood</button>
        </div>
      </div>

      <!-- 30-day summary -->
      ${average ? `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <div class="card" style="flex:1;min-width:140px;text-align:center">
          <div style="font-size:42px">${moodEmoji}</div>
          <div style="font-size:26px;font-weight:800;color:${moodColor}">${(average * 20).toFixed(0)}%</div>
          <div class="muted" style="font-size:12px">Your 30-day happiness score</div>
        </div>
        <div class="card" style="flex:1;min-width:140px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#4f46e5">${checkins.length}</div>
          <div class="muted" style="font-size:12px">Check-ins this month</div>
        </div>
        <div class="card" style="flex:1;min-width:140px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#4f46e5">${average.toFixed(1)}<span style="font-size:14px;color:#9ca3af">/5</span></div>
          <div class="muted" style="font-size:12px">Average score</div>
        </div>
      </div>` : ''}

      <!-- Trend chart -->
      ${checkins.length > 1 ? `
      <div class="card" style="margin-bottom:20px">
        <div style="font-weight:700;margin-bottom:14px">My Mood Trend (Last 30 Days)</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:80px;padding:0 4px">
          ${checkins.slice(0,30).reverse().map(r => {
            const pct = (r.score/5)*100;
            const m = MOODS.find(x=>x.score===r.score)||MOODS[2];
            return `<div title="${UI.date(r.date)}: ${m.label}" style="flex:1;background:${m.color};height:${pct}%;border-radius:4px 4px 0 0;opacity:.85;min-width:8px;cursor:default"></div>`;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-top:4px">
          <span>${UI.date(checkins[Math.min(29, checkins.length-1)]?.date)}</span>
          <span>Today</span>
        </div>
      </div>` : ''}

      <!-- History list -->
      <div class="section-title">Check-in History</div>
      ${checkins.length === 0 ? '<div class="muted" style="text-align:center;padding:30px">No check-ins yet. Start today!</div>' :
        checkins.slice(0, 14).map(r => {
          const m = MOODS.find(x => x.score === r.score) || MOODS[2];
          return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px">
            <span style="font-size:28px">${m.emoji}</span>
            <div style="flex:1">
              <div style="font-weight:600;font-size:14px;color:${m.color}">${m.label}</div>
              ${r.note ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${UI.esc(r.note)}</div>` : ''}
            </div>
            <div style="font-size:12px;color:#9ca3af">${UI.date(r.date)}</div>
          </div>`;
        }).join('')}
    `;

    // Mood picker interaction
    const noteArea = c.querySelector('#mood-note-area');
    let selectedScore = today ? today.score : null;
    c.querySelectorAll('.mood-pick').forEach(btn => {
      btn.onmouseenter = () => { if (btn.dataset.score != selectedScore) { btn.style.transform = 'scale(1.08)'; btn.style.boxShadow = '0 4px 12px rgba(0,0,0,.12)'; } };
      btn.onmouseleave = () => { btn.style.transform = ''; btn.style.boxShadow = ''; };
      btn.onclick = () => {
        selectedScore = parseInt(btn.dataset.score);
        c.querySelectorAll('.mood-pick').forEach(b => {
          const m = MOODS.find(x => x.score == b.dataset.score);
          b.style.border = `2px solid ${b.dataset.score == selectedScore ? m.color : '#e5e7eb'}`;
          b.style.background = b.dataset.score == selectedScore ? m.bg : '#fff';
          b.style.transform = '';
        });
        noteArea.style.display = 'block';
      };
    });

    const saveBtn = c.querySelector('#mood-save');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        if (!selectedScore) { UI.toast('Please select a mood first.', 'error'); return; }
        const note = c.querySelector('#mood-note').value.trim();
        try {
          const r = await api.post('/mood/checkin', { score: selectedScore, note });
          UI.toast(`${r.emoji} Mood saved: ${r.label}`, 'success');
          this.mood(c);
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    }
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

  // ---------------- Self-service onboarding / joining form ----------------
  async onboardingForm(c) {
    c.innerHTML = '<div class="muted">Loading...</div>';
    const { employee } = await api.get('/employees/me');
    if (!employee) { c.innerHTML = '<div class="empty">No employee record is linked to your login yet. Please contact HR.</div>'; return; }
    const required = App.requiredDocs || [];
    const submitted = !!employee.onboarding_submitted;

    const SELF_FIELDS = ['phone', 'personal_email', 'dob', 'gender', 'blood_group', 'marital_status',
      'nationality', 'languages_known', 'emergency_name', 'emergency_phone', 'address', 'current_address',
      'permanent_address', 'bank_holder_name', 'bank_name', 'bank_account', 'ifsc', 'pan', 'aadhaar',
      'education', 'experience'];
    const collect = () => { const p = {}; SELF_FIELDS.forEach((f) => { const el = document.getElementById('of-' + f); if (el) p[f] = el.value; }); return p; };

    // Every field on this form is mandatory before the employee can submit.
    const REQUIRED = ['phone', 'personal_email', 'dob', 'gender', 'blood_group', 'marital_status',
      'nationality', 'languages_known', 'current_address', 'permanent_address', 'emergency_name',
      'emergency_phone', 'bank_holder_name', 'bank_name', 'bank_account', 'ifsc', 'pan', 'aadhaar',
      'education', 'experience'];
    const missingFields = () => REQUIRED.filter((id) => { const el = document.getElementById('of-' + id); return el && !el.value.trim(); });
    const clearBad = () => REQUIRED.forEach((id) => { const el = document.getElementById('of-' + id); if (el) el.style.borderColor = ''; });
    const markBad = (ids) => ids.forEach((id) => { const el = document.getElementById('of-' + id); if (el) el.style.borderColor = '#dc2626'; });

    const req = ' <span style="color:#dc2626">*</span>';
    const val = (id) => UI.esc(employee[id] || '');
    const F = (id, label, type) => `<div class="field"><label>${label}${req}</label><input id="of-${id}" type="${type || 'text'}" value="${type === 'date' ? UI.esc((employee[id] || '').slice(0, 10)) : val(id)}" /></div>`;
    const FA = (id, label) => `<div class="field" style="grid-column:1/-1"><label>${label}${req}</label><textarea id="of-${id}" rows="2">${val(id)}</textarea></div>`;
    const SEL = (id, label, options) => `<div class="field"><label>${label}${req}</label><select id="of-${id}"><option value="">—</option>${options.map((o) => `<option ${(employee[id] || '') === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    const sub = (t) => `<div style="grid-column:1/-1;font-weight:650;color:#475569;margin:6px 0 -2px;font-size:13px">${t}</div>`;

    c.innerHTML = `
      <div class="toolbar"><div class="section-title" style="margin:0">📋 My Onboarding</div></div>
      ${submitted
        ? `<div class="card" style="border-left:4px solid #16a34a;max-width:760px"><b>✓ Your onboarding form is submitted${employee.onboarding_submitted_at ? ' on ' + UI.date(employee.onboarding_submitted_at) : ''}.</b><div class="muted" style="font-size:13px">HR is reviewing your documents. You can still update details or replace documents below.</div></div>`
        : `<div class="card" style="border-left:4px solid #2563eb;max-width:760px"><b>Welcome aboard! 👋</b><div class="muted" style="font-size:13px">Fill in your details and upload your documents below. Everything saves straight into HR records — no email attachments needed.</div></div>`}

      <div class="card mt" id="ofTasks" style="max-width:760px;display:none"></div>

      <div class="card mt" style="max-width:760px">
        <div class="section-title">1. Your details</div>
        <div class="form-grid">
          ${sub('Personal')}
          ${F('phone', 'Phone')}
          ${F('personal_email', 'Personal Email', 'email')}
          ${F('dob', 'Date of Birth', 'date')}
          ${SEL('gender', 'Gender', ['Male', 'Female', 'Other', 'Prefer not to say'])}
          ${SEL('blood_group', 'Blood Group', ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'])}
          ${SEL('marital_status', 'Marital Status', ['Single', 'Married', 'Other'])}
          ${F('nationality', 'Nationality')}
          ${F('languages_known', 'Languages Known')}
          ${sub('Address')}
          ${FA('current_address', 'Current Address')}
          ${FA('permanent_address', 'Permanent Address')}
          ${sub('Emergency contact')}
          ${F('emergency_name', 'Contact Name')}
          ${F('emergency_phone', 'Contact Phone')}
          ${sub('Bank details (for salary)')}
          ${F('bank_holder_name', 'Account Holder Name')}
          ${F('bank_name', 'Bank Name')}
          ${F('bank_account', 'Account Number')}
          ${F('ifsc', 'IFSC Code')}
          ${sub('Identity')}
          ${F('pan', 'PAN')}
          ${F('aadhaar', 'Aadhaar / National ID')}
          ${sub('Background')}
          ${F('education', 'Highest Education')}
          ${F('experience', 'Total Experience')}
        </div>
        <div class="btn-row mt"><button class="btn" id="ofSave">Save details</button></div>
      </div>

      <div class="card mt" style="max-width:760px">
        <div class="section-title">2. Upload your documents</div>
        <div id="ofDocs" class="muted">Loading…</div>
      </div>

      <div class="card mt" style="max-width:760px">
        <div class="section-title">3. Submit</div>
        <p class="muted" style="font-size:13px;margin-top:2px">When your details are filled and all required documents are uploaded, submit your onboarding. HR will be notified to verify.</p>
        <div id="ofSubmitWrap"></div>
      </div>`;

    REQUIRED.forEach((id) => { const el = document.getElementById('of-' + id); if (el) el.addEventListener('input', () => { el.style.borderColor = ''; }); });

    document.getElementById('ofSave').onclick = async () => {
      try { await api.put('/employees/me/onboarding', collect()); UI.toast('Progress saved ✓', 'success'); loadTasks(); }
      catch (e) { UI.toast(e.message, 'error'); }
    };

    // The new hire's own slice of the onboarding journey (auto steps tick
    // themselves; manual steps they can check off).
    const loadTasks = async () => {
      const host = document.getElementById('ofTasks');
      try {
        const { tasks } = await api.get('/onboarding/' + employee.id);
        const mine = tasks.filter((t) => t.owner === 'employee');
        if (!mine.length) { host.style.display = 'none'; return; }
        const done = mine.filter((t) => t.done).length;
        host.style.display = '';
        host.innerHTML = `<div class="section-title">Your onboarding checklist <span class="muted" style="font-weight:400;font-size:12px">(${done}/${mine.length} done)</span></div>`
          + mine.map((t) => `<label class="checkbox-row" style="padding:5px 0;display:flex;align-items:center;gap:8px">
              <input type="checkbox" data-mtask="${t.id}" ${t.done ? 'checked' : ''} ${t.auto_key ? 'disabled title="This completes automatically once you finish the related step"' : ''}/>
              <span style="${t.done ? 'text-decoration:line-through;color:#94a3b8' : ''}">${UI.esc(t.title)}</span>
              ${t.auto_key ? '<span class="tag" style="background:#ecfeff;color:#0e7490;font-size:10px">⚡ auto</span>' : ''}
            </label>`).join('');
        host.querySelectorAll('[data-mtask]').forEach((el) => el.onchange = async () => {
          try { await api.put('/onboarding/task/' + el.dataset.mtask, { done: el.checked }); loadTasks(); }
          catch (e) { UI.toast(e.message, 'error'); }
        });
      } catch (e) { host.style.display = 'none'; }
    };

    const uploadDoc = async (file, docType) => {
      const fd = new FormData(); fd.append('file', file); fd.append('doc_type', docType || ''); fd.append('title', docType || file.name);
      try { await api.upload(`/employees/${employee.id}/documents`, fd); UI.toast('Uploaded ✓', 'success'); loadDocs(); }
      catch (e) { UI.toast(e.message, 'error'); }
    };
    const stChip = (d) => d.status === 'verified' ? '<span class="tag approved">✓ Verified</span>'
      : (d.status === 'rejected' ? '<span class="tag rejected">✗ Rejected — please re-upload</span>' : '<span class="tag pending">⏳ Pending review</span>');

    const loadDocs = async () => {
      const { documents } = await api.get(`/employees/${employee.id}/documents`);
      const byType = {}; documents.forEach((d) => { if (d.doc_type) byType[d.doc_type] = d; });
      const done = required.filter((t) => byType[t]).length;
      const checklist = required.map((t) => {
        const doc = byType[t];
        if (!doc) return `<div class="doc-row"><div class="doc-name">${UI.esc(t)}</div><div><span class="tag rejected">Not uploaded</span></div><div class="doc-act"><label class="btn sm">Upload<input type="file" class="ofreq" data-type="${UI.esc(t)}" style="display:none"/></label></div></div>`;
        return `<div class="doc-row"><div class="doc-name">${UI.esc(t)}</div><div>${stChip(doc)}</div><div class="doc-act"><a class="btn sm secondary" href="/api/employees/${employee.id}/documents/${doc.id}/file" target="_blank">View</a> <label class="btn sm secondary">Replace<input type="file" class="ofreq" data-type="${UI.esc(t)}" style="display:none"/></label></div></div>`;
      }).join('');
      const others = documents.filter((d) => !required.includes(d.doc_type));
      const otherRows = others.map((d) => `<div class="doc-row"><div class="doc-name">${UI.esc(d.title || d.doc_type || 'Document')}</div><div>${stChip(d)}</div><div class="doc-act"><a class="btn sm secondary" href="/api/employees/${employee.id}/documents/${d.id}/file" target="_blank">View</a></div></div>`).join('');

      document.getElementById('ofDocs').innerHTML = `
        <div class="muted" style="margin-bottom:8px">${done}/${required.length} required documents uploaded</div>
        <div class="doc-list">${checklist || '<div class="muted" style="padding:10px">No required documents configured.</div>'}</div>
        ${otherRows ? `<div style="font-weight:650;color:#475569;margin:14px 0 6px;font-size:13px">Other documents</div><div class="doc-list">${otherRows}</div>` : ''}
        <div class="btn-row mt"><label class="btn secondary">+ Upload another document<input type="file" id="ofOther" style="display:none"/></label><input id="ofOtherTitle" placeholder="Document name (optional)" style="width:auto"/></div>`;

      document.querySelectorAll('.ofreq').forEach((inp) => inp.onchange = (e) => { const f = e.target.files[0]; if (f) uploadDoc(f, inp.dataset.type); });
      const other = document.getElementById('ofOther');
      if (other) other.onchange = (e) => { const f = e.target.files[0]; if (!f) return; const t = (document.getElementById('ofOtherTitle').value || '').trim(); uploadDoc(f, t || f.name); };

      const wrap = document.getElementById('ofSubmitWrap');
      if (submitted) {
        wrap.innerHTML = '<span class="tag approved">✓ Submitted</span> <span class="muted" style="font-size:13px">Need to resend? Update anything above and use Save details.</span>';
      } else {
        wrap.innerHTML = '<p class="muted" style="font-size:13px;margin:0 0 8px"><b>All fields and all documents are required.</b></p><button class="btn" id="ofSubmit">Submit my onboarding</button>';
        const sb = document.getElementById('ofSubmit');
        if (sb) sb.onclick = async () => {
          clearBad();
          const miss = missingFields();
          const missDocs = required.filter((t) => !byType[t]);
          if (miss.length || missDocs.length) {
            markBad(miss);
            const first = miss.length ? document.getElementById('of-' + miss[0]) : null;
            if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const parts = [];
            if (miss.length) parts.push(miss.length + ' field' + (miss.length > 1 ? 's' : '') + ' left');
            if (missDocs.length) parts.push(missDocs.length + ' document' + (missDocs.length > 1 ? 's' : '') + ' missing');
            UI.toast('Please complete everything — ' + parts.join(' and ') + '.', 'error');
            return;
          }
          if (!confirm('Submit your onboarding form? HR will be notified to review your documents. You can still make changes afterwards.')) return;
          try {
            await api.put('/employees/me/onboarding', collect());
            await api.post('/employees/me/onboarding/submit');
            UI.toast('🎉 Onboarding submitted! HR has been notified.', 'success');
            if (UI.celebrate) UI.celebrate();
            EmployeeViews.onboardingForm(c);
          } catch (e) { UI.toast(e.message, 'error'); }
        };
      }
    };
    loadDocs();
    loadTasks();
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
