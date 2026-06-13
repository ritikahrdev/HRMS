// Shared HTTP helpers for the audit suites. Cookie-based session auth.
const BASE = process.env.BASE || 'http://localhost:4100';

async function rawLogin(email, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = r.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, cookie, user: j && j.user };
}

// Returns a `call` bound to a role's cookie.
function client(cookie) {
  return async function call(method, path, body, opts = {}) {
    const headers = { cookie: cookie || '' };
    let payload;
    if (body !== undefined && body !== null && !opts.multipart) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    } else if (opts.multipart) {
      payload = body; // FormData
    }
    if (opts.headers) Object.assign(headers, opts.headers);
    const r = await fetch(BASE + path, { method, headers, body: payload });
    let j = null, text = null;
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) { try { j = await r.json(); } catch (e) {} }
    else { try { text = await r.text(); } catch (e) {} }
    return { status: r.status, json: j, text, headers: r.headers };
  };
}

async function loginAll() {
  const creds = {
    admin: ['admin@company.local', 'ChangeMe@12345'],
    hr: ['hr@company.local', 'hr12345'],
    finance: ['finance@company.local', 'fin12345'],
    manager: ['manager@company.local', 'mgr12345'],
    employee: ['employee@company.local', 'employee123'],
    employee2: ['employee2@company.local', 'employee123'],
  };
  const sessions = {};
  for (const [role, [e, p]] of Object.entries(creds)) {
    const l = await rawLogin(e, p);
    sessions[role] = { cookie: l.cookie, user: l.user, status: l.status, call: client(l.cookie) };
  }
  sessions.anon = { cookie: '', user: null, call: client('') };
  return sessions;
}

module.exports = { BASE, rawLogin, client, loginAll };
