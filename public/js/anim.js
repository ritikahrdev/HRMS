// Lightweight, self-contained UI animation helpers. Safe: wrapped in try/catch,
// only touches plain-integer stat values, never throws into the app.
(function () {
  'use strict';
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Count a stat number up from 0 to its value (e.g. dashboard KPIs).
    function countUp(el) {
      if (!el || el.dataset.counted) return;
      var txt = (el.textContent || '').trim();
      if (!/^\d{1,6}$/.test(txt)) return;          // plain integers only (skip ₹1,200 etc.)
      var target = parseInt(txt, 10);
      if (!(target > 0)) return;
      el.dataset.counted = '1';
      var dur = 750, start = performance.now();
      el.textContent = '0';
      function step(now) {
        var p = Math.min(1, (now - start) / dur);
        var eased = 1 - Math.pow(1 - p, 3);        // ease-out cubic
        el.textContent = Math.round(target * eased).toString();
        if (p < 1) requestAnimationFrame(step); else el.textContent = String(target);
      }
      requestAnimationFrame(step);
    }

    function scan(root) {
      try { (root.querySelectorAll('.stat .value') || []).forEach(countUp); } catch (e) {}
    }

    // Material-style click ripple on buttons. The IIFE already bailed out for
    // reduced-motion users, so this only runs when motion is welcome.
    function bindRipple() {
      document.addEventListener('click', function (e) {
        try {
          var btn = e.target && e.target.closest && e.target.closest('.btn');
          if (!btn || btn.disabled) return;
          var rect = btn.getBoundingClientRect();
          var size = Math.max(rect.width, rect.height);
          var r = document.createElement('span');
          r.className = 'ripple';
          r.style.width = r.style.height = size + 'px';
          r.style.left = (e.clientX - rect.left - size / 2) + 'px';
          r.style.top = (e.clientY - rect.top - size / 2) + 'px';
          btn.appendChild(r);
          setTimeout(function () { try { r.remove(); } catch (_) {} }, 600);
        } catch (_) { /* never break a click for an animation */ }
      }, true);
    }

    function start() {
      scan(document);
      bindRipple();
      try {
        new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            var added = muts[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
              var n = added[j];
              if (n.nodeType !== 1) continue;
              if (n.matches && n.matches('.stat .value')) countUp(n);
              if (n.querySelectorAll) scan(n);
            }
          }
        }).observe(document.body, { childList: true, subtree: true });
      } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  } catch (e) { /* never break the app for an animation */ }
})();
