// ==UserScript==
// @name         OnLooker Userscript
// @namespace    https://nguyenphanvn95.github.io/onlooker/
// @version      1.0.3
// @description  Hosted OnLooker panel for Tampermonkey/Userscript
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_getResourceURL
// @resource     ONLOOKER_CSS https://nguyenphanvn95.github.io/onlooker/popup-overlay.css?v=20260329-3
// @resource     ONLOOKER_ICON_APP https://nguyenphanvn95.github.io/onlooker/icons/icon-app.png?v=20260329-3
// @resource     ONLOOKER_UI_PLAY https://nguyenphanvn95.github.io/onlooker/icons/ui/play.svg?v=20260329-3
// @resource     ONLOOKER_UI_CAMERA https://nguyenphanvn95.github.io/onlooker/icons/ui/camera.svg?v=20260329-3
// @resource     ONLOOKER_UI_SEARCH https://nguyenphanvn95.github.io/onlooker/icons/ui/search.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_WK https://nguyenphanvn95.github.io/onlooker/icons/pieces/wK.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_WQ https://nguyenphanvn95.github.io/onlooker/icons/pieces/wQ.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_WR https://nguyenphanvn95.github.io/onlooker/icons/pieces/wR.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_WB https://nguyenphanvn95.github.io/onlooker/icons/pieces/wB.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_WN https://nguyenphanvn95.github.io/onlooker/icons/pieces/wN.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_WP https://nguyenphanvn95.github.io/onlooker/icons/pieces/wP.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_BK https://nguyenphanvn95.github.io/onlooker/icons/pieces/bK.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_BQ https://nguyenphanvn95.github.io/onlooker/icons/pieces/bQ.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_BR https://nguyenphanvn95.github.io/onlooker/icons/pieces/bR.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_BB https://nguyenphanvn95.github.io/onlooker/icons/pieces/bB.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_BN https://nguyenphanvn95.github.io/onlooker/icons/pieces/bN.svg?v=20260329-3
// @resource     ONLOOKER_PIECE_BP https://nguyenphanvn95.github.io/onlooker/icons/pieces/bP.svg?v=20260329-3
// @require      https://nguyenphanvn95.github.io/onlooker/userscript/bootstrap.js?v=20260329-3
// @require      https://nguyenphanvn95.github.io/onlooker/libs/dom-to-image.min.js?v=20260329-3
// @require      https://nguyenphanvn95.github.io/onlooker/hosted-runtime.js?v=20260329-3
// @require      https://nguyenphanvn95.github.io/onlooker/content.js?v=20260329-3
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
