// ==UserScript==
// @name         Waka Hiệu Sói (Chapter) Downloader
// @namespace    https://nguyenphanvn95.github.io/waka/
// @version      1.0.0
// @description  Tải từng chương EPUB + tải full tất cả chương từ waka.vn/hieu-soi/*
// @author       Adapted for Tampermonkey (từ Waka Toolkit 5.3.17)
// @match        https://waka.vn/hieu-soi/*
// @grant        none
// @run-at       document-start
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/jszip.min.js
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/crypto-js.min.js
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/epub-decode.js
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/epub-builder.js
// ==/UserScript==

(function () {
  'use strict';

  const BASES = [
    'https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/',
    'https://nguyenphanvn95.github.io/waka/',
  ];

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = () => resolve(url);
      s.onerror = () => reject(new Error('Failed: ' + url));
      (document.documentElement || document.head).appendChild(s);
    });
  }

  async function loadFromBases(filename) {
    let lastErr;
    for (const base of BASES) {
      try {
        const url = base + filename;
        await loadScript(url);
        console.log('[Waka Hiệu Sói] loaded', url);
        return;
      } catch (e) {
        lastErr = e;
        console.warn('[Waka Hiệu Sói]', e.message);
      }
    }
    throw lastErr || new Error('All bases failed for ' + filename);
  }

  // 1) Interceptor MAIN world ngay document-start
  loadFromBases('oak-interceptor.js').catch((e) =>
    console.error('[Waka Hiệu Sói] oak-interceptor', e)
  );

  // 2) Content sau DOM ready
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(async () => {
    if (typeof JSZip === 'undefined') {
      console.error('[Waka Hiệu Sói] JSZip missing – kiểm tra @require');
    }
    if (typeof CryptoJS === 'undefined') {
      console.error('[Waka Hiệu Sói] CryptoJS missing');
    }

    try {
      await loadFromBases('oak-content.js');
      console.log('[Waka Hiệu Sói] ready – nút ⬇ EPUB trên từng chương + Tải full');
    } catch (err) {
      console.error('[Waka Hiệu Sói] content load error', err);
      const t = document.createElement('div');
      t.style.cssText =
        'position:fixed;bottom:20px;right:16px;background:#3b1a1a;color:#fff;padding:12px 16px;border-radius:10px;z-index:999999;font-size:13px;max-width:340px;line-height:1.4;';
      t.innerHTML =
        'Waka Hiệu Sói: không tải được script.<br>Upload <b>oak-interceptor.js</b> + <b>oak-content.js</b> lên GitHub (thư mục waka/).';
      document.body.appendChild(t);
    }
  });
})();
