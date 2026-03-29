// ==UserScript==
// @name         OnLooker Userscript
// @namespace    https://nguyenphanvn95.github.io/onlooker/
// @version      1.0.1
// @description  Hosted OnLooker panel for Tampermonkey/Userscript
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @resource     ONLOOKER_CSS https://nguyenphanvn95.github.io/onlooker/popup-overlay.css
// @require      https://nguyenphanvn95.github.io/onlooker/userscript/bootstrap.js
// @require      https://nguyenphanvn95.github.io/onlooker/libs/dom-to-image.min.js
// @require      https://nguyenphanvn95.github.io/onlooker/hosted-runtime.js
// @require      https://nguyenphanvn95.github.io/onlooker/content.js
// @connect      nguyenphanvn95.github.io
// @connect      app.chessvision.ai
// @connect      lichess.org
// ==/UserScript==

(function () {
  try {
    const rawCss = typeof GM_getResourceText === 'function' ? GM_getResourceText('ONLOOKER_CSS') : '';
    const safeCss = String(rawCss || '').replace(/@import\s+url\([^)]+\);\s*/g, '');
    if (safeCss && typeof GM_addStyle === 'function') {
      GM_addStyle(safeCss);
    }
  } catch (_) {}

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('OnLooker: Open Dashboard', () => {
      window.__ONLOOKER_HOSTED__?.openDashboard?.();
    });
    GM_registerMenuCommand('OnLooker: Toggle Panel', () => {
      const current = GM_getValue('onlookerSettings', null) || {};
      const next = { ...current, showPanel: current.showPanel === false };
      GM_setValue('onlookerSettings', next);
      window.location.reload();
    });
  }
})();
