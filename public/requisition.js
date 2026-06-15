// Public hiring-requisition form logic. Lives in an external file (not inline)
// so it satisfies the app's Content-Security-Policy (script-src 'self'); inline
// <script> blocks are blocked by CSP and would silently never run.
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const card = document.getElementById('card');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const initials = (s) => (String(s || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '?').toUpperCase();

function center(emoji, title, text) {
  card.innerHTML = `<div class="center"><div class="big">${emoji}</div><h1>${esc(title)}</h1><p class="sub">${esc(text)}</p></div>`;
}

function msg(t, cls) {
  const m = document.getElementById('msg');
  if (m) m.innerHTML = `<div class="msg ${cls}">${esc(t)}</div>`;
}

function form(d) {
  const j = d.job || {};
  const co = d.companyName || 'the company';
  card.innerHTML = `
    <div class="brand"><div class="logo">${esc(initials(co))}</div><div><div style="font-weight:800">${esc(co)}</div><div class="sub" style="margin:0">Hiring requirement</div></div></div>
    <h1>New hire — your requirements</h1>
    <p class="sub">Fill this in and HR will turn it into a job post automatically. Takes ~2 minutes.</p>
    <div id="msg"></div>
    <label>Role title *</label>
    <input id="title" value="${esc(j.title)}" placeholder="e.g. Senior Backend Engineer" />
    <div class="row">
      <div><label>Department</label><input id="department" value="${esc(j.department)}" placeholder="Engineering" /></div>
      <div><label>Location</label><input id="location" value="${esc(j.location)}" placeholder="Remote / Dehradun" /></div>
    </div>
    <div class="row">
      <div><label>Employment type</label><select id="type">${['Full-time', 'Part-time', 'Contract', 'Intern'].map((t) => `<option ${j.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div><label>Min experience (years)</label><input id="min_experience" type="number" min="0" step="0.5" value="${j.min_experience || 0}" /></div>
      <div><label>Openings</label><input id="headcount" type="number" min="1" step="1" value="${j.headcount || 1}" /></div>
    </div>
    <label>Required skills <span class="hint">(comma separated)</span></label>
    <input id="skills" value="${esc(j.skills)}" placeholder="Node.js, PostgreSQL, REST APIs" />
    <label>Key responsibilities</label>
    <textarea id="responsibilities" placeholder="What this person will own day to day…">${esc(j.responsibilities)}</textarea>
    <label>Must-have requirements</label>
    <textarea id="must_haves" placeholder="Non-negotiables — experience, qualifications, etc.">${esc(j.must_haves)}</textarea>
    <label>Nice to have <span class="hint">(optional)</span></label>
    <textarea id="nice_to_haves" placeholder="Bonus skills / experience">${esc(j.nice_to_haves)}</textarea>
    <button id="submit">Submit requirement →</button>`;

  document.getElementById('submit').onclick = async () => {
    const get = (id) => document.getElementById(id).value;
    const body = {
      title: get('title'), department: get('department'), location: get('location'), type: get('type'),
      min_experience: get('min_experience'), headcount: get('headcount'), skills: get('skills'),
      responsibilities: get('responsibilities'), must_haves: get('must_haves'), nice_to_haves: get('nice_to_haves'),
    };
    if (!body.title.trim()) { msg('Please give the role a title.', 'err'); return; }
    const btn = document.getElementById('submit'); btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const r = await fetch('/api/requisition/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const jd = await r.json();
      if (!r.ok) throw new Error(jd.error || 'Could not submit.');
      center('✅', 'Thank you!', 'Your hiring requirement has been sent to HR. They will create and publish the job post. You can close this page.');
    } catch (e) { msg(e.message, 'err'); btn.disabled = false; btn.textContent = 'Submit requirement →'; }
  };
}

(async () => {
  if (!token) return center('🔗', 'Invalid link', 'This link looks incomplete. Please ask HR for a new one.');
  // The free-tier server can take up to a minute to wake on first open — show a
  // friendly message instead of an endless "Loading…", and auto-retry.
  const slow = setTimeout(() => { const s = document.querySelector('#card .sub'); if (s) s.textContent = 'Waking up the server — this can take up to a minute on first load. Please wait…'; }, 6000);
  const load = async (tries) => {
    try {
      const r = await fetch('/api/requisition/' + encodeURIComponent(token), { cache: 'no-store' });
      const d = await r.json();
      clearTimeout(slow);
      if (!r.ok) return center('🔗', 'Link not found', d.error || 'Please contact HR for a new link.');
      if (d.submitted) return center('✅', 'Already submitted', 'Thanks — this requirement has already been sent to HR. Contact them if you need to change anything.');
      form(d);
    } catch (e) {
      if (tries > 0) { await new Promise((res) => setTimeout(res, 2500)); return load(tries - 1); }
      clearTimeout(slow);
      center('⚠️', 'Couldn’t load the form', 'Please refresh this page (the server may still be starting up). If it persists, contact HR.');
    }
  };
  load(4);
})();
