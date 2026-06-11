// Tiny fetch wrapper. All endpoints live under /api.
const api = {
  async request(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api' + url, opts);
    return handle(res);
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  patch(url, body) { return this.request('PATCH', url, body); },
  del(url, body) { return this.request('DELETE', url, body); },

  // multipart/form-data upload (FormData passed in)
  async upload(url, formData) {
    const res = await fetch('/api' + url, { method: 'POST', body: formData, credentials: 'same-origin' });
    return handle(res);
  },
};

async function handle(res) {
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}
