/* App-owned WKWebView: activate the existing standalone layout before site scripts run. */
(function () {
  'use strict';
  window.DIASTOMY_NATIVE_APP = true;
  try { Object.defineProperty(navigator, 'standalone', { configurable: true, get: function () { return true; } }); } catch (_) {}
  function mark() {
    if (document.documentElement) document.documentElement.classList.add('dm-pwa-standalone', 'dm-figma-v2-active', 'dmf3-active');
  }
  mark();
  document.addEventListener('DOMContentLoaded', mark, { once: true });
})();
