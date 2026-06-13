// Shared HTML escaper. Use everywhere user-supplied text is interpolated into
// an HTML string (email bodies, in-app notification title/body) so a value like
// `<img src=x onerror=...>` can never execute when rendered in an email client
// or via innerHTML on the frontend. Escapes the 5 HTML-significant characters.
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };
