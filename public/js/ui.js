// Shared UI helpers used by all views.
const UI = {
  currency: '₹',

  esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },

  money(n) {
    return this.currency + Number(n || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  },

  date(s) {
    if (!s) return '-';
    const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  time(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  },

  // Mood score (1-5) -> emoji + label. Used to show happiness with attendance.
  MOODS: { 1: ['😞', 'Very Unhappy'], 2: ['😟', 'Unhappy'], 3: ['😐', 'Neutral'], 4: ['😊', 'Happy'], 5: ['😄', 'Very Happy'] },
  mood(score, withLabel) {
    const m = this.MOODS[Math.round(Number(score))];
    if (!m) return '<span style="color:#cbd5e1">—</span>';
    return withLabel ? `<span title="${m[1]}">${m[0]} <span style="font-size:11px;color:#6b7280">${m[1]}</span></span>` : `<span title="${m[1]}" style="font-size:18px">${m[0]}</span>`;
  },

  // Format a number of minutes as "1h 59m", "45m", or "2h".
  duration(mins) {
    const m = Math.max(0, Math.round(Number(mins) || 0));
    if (m === 0) return '0m';
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (h && r) return `${h}h ${r}m`;
    if (h) return `${h}h`;
    return `${r}m`;
  },

  tag(status) {
    const label = String(status || '').replace(/^\w/, (c) => c.toUpperCase());
    return `<span class="tag ${this.esc(status)}">${this.esc(label)}</span>`;
  },

  toast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
  },

  // Opens a modal. fields render in .body. Returns nothing; use buttons for actions.
  modal({ title, bodyHtml, footHtml }) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay" data-overlay>
        <div class="modal">
          <header><h3>${this.esc(title)}</h3><button class="close" data-close>&times;</button></header>
          <div class="body">${bodyHtml}</div>
          ${footHtml ? `<div class="foot">${footHtml}</div>` : ''}
        </div>
      </div>`;
    const overlay = root.querySelector('[data-overlay]');
    const close = () => { root.innerHTML = ''; };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    root.querySelector('[data-close]').addEventListener('click', close);
    return { root, close };
  },

  closeModal() { document.getElementById('modal-root').innerHTML = ''; },

  // Renders a table. columns: [{key, label, render?, sticky?}]. rows: array of objects.
  // A column with sticky:true stays frozen on the left when scrolling sideways.
  table(columns, rows, emptyMsg = 'Nothing here yet.') {
    if (!rows || rows.length === 0) return `<div class="table-wrap"><div class="empty">${this.esc(emptyMsg)}</div></div>`;
    const head = columns.map((c) => `<th${c.sticky ? ' class="sticky-col"' : ''}>${this.esc(c.label)}</th>`).join('');
    const body = rows.map((r) => {
      const tds = columns.map((c) => {
        const v = c.render ? c.render(r) : this.esc(r[c.key]);
        return `<td${c.sticky ? ' class="sticky-col"' : ''}>${v == null ? '' : v}</td>`;
      }).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  },

  thisMonth() { return new Date().toISOString().slice(0, 7); },

  // A quick confetti burst for celebrations (no library).
  celebrate(emojis) {
    const set = emojis || ['🎉', '🎊', '⭐', '👏', '🙌', '💜', '🥳'];
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
    document.body.appendChild(layer);
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('div');
      p.textContent = set[Math.floor(Math.random() * set.length)];
      const left = Math.random() * 100;
      const dur = 1.6 + Math.random() * 1.4;
      const size = 16 + Math.random() * 20;
      p.style.cssText = `position:absolute;left:${left}vw;top:-40px;font-size:${size}px;animation:hrfall ${dur}s linear forwards;transform:rotate(${Math.random() * 360}deg)`;
      layer.appendChild(p);
    }
    if (!document.getElementById('hrfall-kf')) {
      const st = document.createElement('style');
      st.id = 'hrfall-kf';
      st.textContent = '@keyframes hrfall{to{transform:translateY(105vh) rotate(720deg);opacity:.9}}';
      document.head.appendChild(st);
    }
    setTimeout(() => layer.remove(), 3200);
  },
};
