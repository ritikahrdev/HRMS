// Public careers page logic (external file — inline scripts are blocked by CSP).
(async function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wrap = document.getElementById('jobs');

  // If the visitor is a logged-in HRMS user (staff previewing the page), show a
  // way back into the app. Candidates are never logged in, so they never see it.
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (r) {
    if (!r.ok) return;
    const b = document.createElement('a');
    b.href = '/#/recruitment';
    b.textContent = '← Back to HRMS';
    b.style.cssText = 'position:fixed;top:14px;left:14px;z-index:50;background:rgba(255,255,255,.95);color:#5b21b6;font-weight:700;font-size:13px;padding:9px 16px;border-radius:20px;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.18)';
    document.body.appendChild(b);
  }).catch(function () {});
  let data;
  try {
    data = await fetch('/api/careers/jobs').then((r) => r.json());
  } catch (e) {
    wrap.innerHTML = '<div class="empty">Could not load roles. Please refresh.</div>';
    return;
  }
  if (data.company) {
    document.getElementById('coName').textContent = 'Careers at ' + data.company;
    document.title = 'Careers at ' + data.company;
    if (data.logoFile) {
      const img = document.createElement('img');
      img.src = '/uploads/' + data.logoFile;
      document.getElementById('hero').prepend(img);
    }
  }
  const jobs = data.jobs || [];
  if (!jobs.length) {
    wrap.innerHTML = '<div class="empty"><div style="font-size:42px">🌱</div><p style="margin-top:8px">No open roles right now — check back soon!</p></div>';
    return;
  }
  wrap.innerHTML = jobs.map(function (j, i) {
    return '<div class="job" id="job-' + j.id + '" style="animation-delay:' + (i * 80) + 'ms">' +
      '<h2>' + esc(j.title) + '</h2>' +
      '<div class="meta">' +
        (j.department ? '<span>🏢 ' + esc(j.department) + '</span>' : '') +
        (j.location ? '<span>📍 ' + esc(j.location) + '</span>' : '') +
        (j.type ? '<span>💼 ' + esc(j.type) + '</span>' : '') +
        (j.min_experience ? '<span>🎓 ' + esc(j.min_experience) + '+ yrs</span>' : '') +
      '</div>' +
      (j.description ? '<div class="desc">' + esc(j.description) + '</div>' : '') +
      (j.skills ? '<div class="skills">' + String(j.skills).split(',').map(function (s) { return '<span class="skill">' + esc(s.trim()) + '</span>'; }).join('') + '</div>' : '') +
      '<button class="btn" data-open="' + j.id + '">Apply for this role</button>' +
      '<form data-job="' + j.id + '" enctype="multipart/form-data">' +
        '<div class="grid">' +
          '<div><label>Full Name *</label><input name="name" required maxlength="80" /></div>' +
          '<div><label>Email *</label><input name="email" type="email" required maxlength="120" /></div>' +
          '<div><label>Phone</label><input name="phone" maxlength="20" /></div>' +
          '<div><label>Years of Experience</label><input name="experience_years" type="number" min="0" max="50" step="0.5" /></div>' +
          '<div class="full"><label>Your Key Skills (comma separated)</label><input name="skills" maxlength="500" placeholder="e.g. React, Node.js, SQL" /></div>' +
          '<div class="full"><label>Resume (PDF/DOC) *</label><input name="resume" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" required /></div>' +
          '<div class="full"><label>Why you? (optional)</label><textarea name="note" rows="3" maxlength="1000" placeholder="A line or two about why you\'d be great for this role"></textarea></div>' +
        '</div>' +
        '<button class="btn" type="submit">Submit Application 🚀</button>' +
        '<div class="err"></div>' +
      '</form>' +
      '<div class="ok"></div>' +
    '</div>';
  }).join('');

  // Deep link: /careers#job-3 scrolls to that job.
  if (location.hash) {
    const el = document.querySelector(location.hash);
    if (el) setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.style.boxShadow = '0 0 0 3px #a78bfa'; }, 300);
  }

  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.onclick = function () {
      const f = document.querySelector('form[data-job="' + b.dataset.open + '"]');
      f.classList.toggle('open');
      b.textContent = f.classList.contains('open') ? 'Hide form' : 'Apply for this role';
    };
  });

  document.querySelectorAll('form[data-job]').forEach(function (f) {
    f.onsubmit = async function (e) {
      e.preventDefault();
      const err = f.querySelector('.err');
      err.style.display = 'none';
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Submitting…';
      try {
        const fd = new FormData(f);
        const r = await fetch('/api/careers/apply/' + f.dataset.job, { method: 'POST', body: fd });
        const j = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
        const card = f.closest('.job');
        f.style.display = 'none';
        card.querySelector('[data-open]').style.display = 'none';
        const ok = card.querySelector('.ok');
        ok.textContent = '🎉 ' + (j.message || 'Application received!');
        ok.style.display = 'block';
      } catch (ex) {
        err.textContent = ex.message;
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Submit Application 🚀';
      }
    };
  });
})();
