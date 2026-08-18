// ==UserScript==
// @name         Waka EPUB Downloader
// @namespace    https://nguyenphanvn95.github.io/waka/
// @version      1.2.0
// @description  Tải EPUB 1-click + Copy metadata từ waka.vn/ebook/ và /reader/
// @author       Adapted for Tampermonkey
// @match        https://waka.vn/ebook/*
// @match        https://waka.vn/reader/*
// @match        https://waka.vn/shop/*
// @grant        none
// @run-at       document-start
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/jszip.min.js
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/crypto-js.min.js
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/epub-decode.js
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/epub-builder.js
// @require      https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/metadata-injector.js
// ==/UserScript==

(function () {
  'use strict';

  // jsDelivr (ưu tiên) — không bị raw.githubusercontent MIME/CORS
  // Fallback: GitHub Pages
  const BASES = [
    'https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/',
    'https://nguyenphanvn95.github.io/waka/',
  ];

  const isReader = /\/reader\//i.test(location.pathname);
  const isEbook  = /\/ebook\//i.test(location.pathname) || /\/shop\//i.test(location.pathname);

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
        console.log('[Waka Userscript] loaded', url);
        return;
      } catch (e) {
        lastErr = e;
        console.warn('[Waka Userscript]', e.message);
      }
    }
    throw lastErr || new Error('All bases failed for ' + filename);
  }

  // ── 1. Interceptor ngay document-start ──────────────────────────────────
  if (isEbook) {
    loadFromBases('ebook-interceptor.js').catch(e =>
      console.error('[Waka Userscript] ebook-interceptor', e)
    );
  }
  if (isReader) {
    loadFromBases('reader-interceptor.js').catch(e =>
      console.error('[Waka Userscript] reader-interceptor', e)
    );
  }

  // ── 2. Content + metadata sau DOM ready ─────────────────────────────────
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(async () => {
    if (typeof JSZip === 'undefined') {
      console.error('[Waka Userscript] JSZip missing – @require chưa load. Kiểm tra jsDelivr/GitHub.');
    }
    if (typeof CryptoJS === 'undefined') {
      console.error('[Waka Userscript] CryptoJS missing');
    }

    try {
      if (isEbook) {
        await loadFromBases('book-metadata.js');
        await loadFromBases('ebook-content.js');
        console.log('[Waka Userscript] ebook mode ready');
      }
      if (isReader) {
        await loadFromBases('reader-content.js');
        console.log('[Waka Userscript] reader mode ready');
      }
    } catch (err) {
      console.error('[Waka Userscript] content load error', err);
      const t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:20px;right:16px;background:#3b1a1a;color:#fff;padding:12px 16px;border-radius:10px;z-index:999999;font-size:13px;max-width:340px;line-height:1.4;';
      t.innerHTML = 'Waka Userscript: không tải được script.<br>Kiểm tra file trên GitHub + đợi jsDelivr cache (~1–5 phút).';
      document.body.appendChild(t);
    }
  });
})();
