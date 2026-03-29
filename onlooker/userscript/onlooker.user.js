// ==UserScript==
// @name         OnLooker Userscript
// @namespace    https://nguyenphanvn95.github.io/onlooker/
// @version      1.0.0
// @description  Hosted OnLooker panel for Tampermonkey/Userscript
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      nguyenphanvn95.github.io
// @connect      app.chessvision.ai
// @connect      lichess.org
// ==/UserScript==

(async function () {
  const BASE_URL = 'https://nguyenphanvn95.github.io/onlooker/';

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }
          reject(new Error(`Failed to load ${url}: HTTP ${response.status}`));
        },
        onerror() {
          reject(new Error(`Failed to load ${url}`));
        },
      });
    });
  }

  function injectCss(url) {
    if (document.querySelector(`link[data-onlooker="${url}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.onlooker = url;
    document.documentElement.appendChild(link);
  }

  function runCode(source, url) {
    const wrapped = `${source}\n//# sourceURL=${url}`;
    (0, eval)(wrapped);
  }

  window.__ONLOOKER_HOSTED_CONFIG__ = {
    baseUrl: BASE_URL,
    getValue(key, fallback) {
      return GM_getValue(key, fallback);
    },
    setValue(key, value) {
      GM_setValue(key, value);
    },
    deleteValue(key) {
      if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
    },
  };

  injectCss(`${BASE_URL}popup-overlay.css`);

  const scripts = [
    `${BASE_URL}libs/dom-to-image.min.js`,
    `${BASE_URL}hosted-runtime.js`,
    `${BASE_URL}content.js`,
  ];

  for (const url of scripts) {
    const source = await fetchText(url);
    runCode(source, url);
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('OnLooker: Open Dashboard', () => {
      window.__ONLOOKER_HOSTED__?.openDashboard?.();
    });
    GM_registerMenuCommand('OnLooker: Toggle Panel', async () => {
      const current = GM_getValue('onlookerSettings', null) || {};
      const next = { ...current, showPanel: current.showPanel === false };
      GM_setValue('onlookerSettings', next);
      window.location.reload();
    });
  }
})();
