// Pre-boarding portal logic. Kept in an external file so it complies with the
// app's Content Security Policy (script-src 'self' — no inline scripts).
(function () {
  const token = decodeURIComponent((location.pathname.split('/preboard/')[1] || '').replace(/\/+$/, '')) ||
                new URLSearchParams(location.search).get('token') || '';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  let toastTimer;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

  const FIELDS = [
    { section: 'Personal' },
    { id: 'phone', label: 'Phone' },
    { id: 'personal_email', label: 'Personal Email', type: 'email' },
    { id: 'dob', label: 'Date of Birth', type: 'date' },
    { id: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other', 'Prefer not to say'] },
    { id: 'blood_group', label: 'Blood Group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'] },
    { id: 'marital_status', label: 'Marital Status', type: 'select', options: ['Single', 'Married', 'Other'] },
    { id: 'nationality', label: 'Nationality' },
    { id: 'languages_known', label: 'Languages Known' },
    { section: 'Address' },
    { id: 'current_address', label: 'Current Address', type: 'textarea' },
    { id: 'permanent_address', label: 'Permanent Address', type: 'textarea' },
    { section: 'Emergency contact' },
    { id: 'emergency_name', label: 'Contact Name' },
    { id: 'emergency_phone', label: 'Contact Phone' },
    { section: 'Bank details (for salary)' },
    { id: 'bank_holder_name', label: 'Account Holder Name' },
    { id: 'bank_name', label: 'Bank Name' },
    { id: 'bank_account', label: 'Account Number' },
    { id: 'ifsc', label: 'IFSC Code' },
    { section: 'Identity' },
    { id: 'pan', label: 'PAN' },
    { id: 'aadhaar', label: 'Aadhaar / National ID' },
    { section: 'Background' },
    { id: 'education', label: 'Highest Education' },
    { id: 'experience', label: 'Total Experience' },
  ];
  const FIELD_IDS = FIELDS.filter((f) => f.id).map((f) => f.id);

  async function api(method, path, body, isForm) {
    const opt = { method };
    if (body && !isForm) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    if (isForm) opt.body = body;
    const r = await fetch('/api/preboard/' + token + path, opt);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  let DATA = null;

  function fieldHtml(f, val) {
    if (f.section) return '<div class="sub">' + esc(f.section) + '</div>';
    const id = 'f-' + f.id;
    if (f.type === 'select') {
      return '<div class="field"><label>' + esc(f.label) + '</label><select id="' + id + '"><option value="">—</option>'
        + f.options.map((o) => '<option ' + (val === o ? 'selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></div>';
    }
    if (f.type === 'textarea') {
      return '<div class="field full"><label>' + esc(f.label) + '</label><textarea id="' + id + '" rows="2">' + esc(val) + '</textarea></div>';
    }
    const v = f.type === 'date' ? esc((val || '').slice(0, 10)) : esc(val);
    return '<div class="field"><label>' + esc(f.label) + '</label><input id="' + id + '" type="' + (f.type || 'text') + '" value="' + v + '" /></div>';
  }

  function collect() {
    const p = {};
    FIELD_IDS.forEach((id) => { const el = $('f-' + id); if (el) p[id] = el.value; });
    return p;
  }

  function render() {
    const d = DATA;
    $('welcome').textContent = 'Welcome, ' + (d.name || '') + '!';
    $('company').textContent = d.companyName ? ('Joining ' + d.companyName) : '';
    if (d.logoFile) $('logo').innerHTML = '<img src="/uploads/' + esc(d.logoFile) + '" alt="" />';

    const required = d.requiredDocs || [];
    const byType = {}; (d.documents || []).forEach((x) => { if (x.doc_type) byType[x.doc_type] = x; });
    const uploaded = required.filter((t) => byType[t]).length;

    const docRows = required.map((t) => {
      const doc = byType[t];
      const status = !doc ? '<span class="tag miss">Not uploaded</span>'
        : (doc.status === 'verified' ? '<span class="tag ok">✓ Verified</span>'
          : (doc.status === 'rejected' ? '<span class="tag miss">Rejected — re-upload</span>' : '<span class="tag wait">Uploaded</span>'));
      const act = doc
        ? '<a class="btn sm secondary" href="/api/preboard/' + token + '/documents/' + doc.id + '/file" target="_blank">View</a> <label class="btn sm secondary">Replace<input type="file" class="up hide" data-type="' + esc(t) + '"></label>'
        : '<label class="btn sm">Upload<input type="file" class="up hide" data-type="' + esc(t) + '"></label>';
      return '<div class="row"><div class="name">' + esc(t) + '</div>' + status + '<div>' + act + '</div></div>';
    }).join('');

    const detailsGrid = FIELDS.map((f) => fieldHtml(f, d.details ? d.details[f.id] : '')).join('');
    const allDocs = required.length === 0 || uploaded >= required.length;

    $('content').innerHTML =
      (d.submitted ? '<div class="ok-banner">✓ You have submitted your details. You can still update anything below — your HR team will review it.</div>'
        : '<div class="note">Please fill in your details and upload your documents below. Everything is saved securely with your new employer — there is nothing to download or email.</div>')
      + '<div class="card"><h2>1. Your details</h2><div class="grid">' + detailsGrid + '</div>'
      + '<div style="margin-top:14px"><button class="btn" id="saveBtn">Save details</button></div></div>'
      + '<div class="card"><h2>2. Upload your documents <span class="muted">(' + uploaded + '/' + required.length + ')</span></h2>'
      + (required.length ? docRows : '<div class="muted">No documents required.</div>') + '</div>'
      + '<div class="card"><h2>3. Submit</h2>'
      + '<p class="muted">When your details are filled and all documents are uploaded, submit. Your HR team will be notified.</p>'
      + '<button class="btn" id="submitBtn" ' + (allDocs ? '' : 'disabled') + '>Submit pre-boarding</button>'
      + (allDocs ? '' : '<span class="muted" style="margin-left:8px">Upload all documents to enable.</span>') + '</div>';

    $('saveBtn').onclick = async () => {
      try { await api('PUT', '', collect()); toast('Details saved ✓'); } catch (e) { toast(e.message); }
    };
    document.querySelectorAll('.up').forEach((inp) => inp.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const fd = new FormData(); fd.append('file', file); fd.append('doc_type', inp.dataset.type); fd.append('title', inp.dataset.type);
      try { await api('POST', '/documents', fd, true); toast('Uploaded ✓'); await load(); } catch (err) { toast(err.message); }
    });
    $('submitBtn').onclick = async () => {
      if (!confirm('Submit your pre-boarding? Your HR team will be notified to review. You can still make changes afterwards.')) return;
      try { await api('PUT', '', collect()); await api('POST', '/submit'); toast('Submitted 🎉'); await load(); } catch (e) { toast(e.message); }
    };
  }

  async function load() {
    try { DATA = await api('GET', ''); render(); }
    catch (e) {
      $('content').innerHTML = '<div class="card center"><h2>Link not valid</h2><p class="muted">' + esc(e.message) + '</p></div>';
    }
  }

  if (!token) { $('content').innerHTML = '<div class="card center"><h2>Missing link</h2><p class="muted">Please use the full link your HR team sent you.</p></div>'; }
  else load();
})();
