// ==UserScript==
// @name         Waka EPUB Downloader
// @namespace    https://nguyenphanvn95.github.io/waka/
// @version      1.1.0
// @description  Tải EPUB 1-click + Copy metadata từ waka.vn/ebook/ và /reader/ (tách từ Waka Toolkit 5.3.17)
// @author       Adapted for Tampermonkey
// @match        https://waka.vn/ebook/*
// @match        https://waka.vn/reader/*
// @match        https://waka.vn/shop/*
// @grant        none
// @run-at       document-start
// @require      https://nguyenphanvn95.github.io/waka/jszip.min.js
// @require      https://nguyenphanvn95.github.io/waka/crypto-js.min.js
// @require      https://nguyenphanvn95.github.io/waka/epub-decode.js
// @require      https://nguyenphanvn95.github.io/waka/epub-builder.js
// @require      https://nguyenphanvn95.github.io/waka/metadata-injector.js
// ==/UserScript==

/**
 * Luồng:
 * 1. document-start: inject interceptor (MAIN world) để bắt API / đọc __NUXT__
 * 2. document-idle: load book-metadata (nút Copy metadata) + ebook-content / reader-content
 *    (nút ⬇ Tải EPUB cạnh Copy metadata, one-click download)
 *
 * Upload các file sau lên https://nguyenphanvn95.github.io/waka/ :
 *   jszip.min.js, crypto-js.min.js, epub-decode.js, epub-builder.js,
 *   metadata-injector.js, book-metadata.js, ebook-content.js,
 *   ebook-interceptor.js, reader-interceptor.js, reader-content.js
 */

(function () {
  'use strict';

  const BASE = 'https://nguyenphanvn95.github.io/waka/';
  const isReader = /\/reader\//i.test(location.pathname);
  const isEbook  = /\/ebook\//i.test(location.pathname) || /\/shop\//i.test(location.pathname);

  function injectScriptUrl(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + url));
      (document.documentElement || document.head).appendChild(s);
    });
  }

  // ── 1. Inject interceptor ngay (MAIN world) ─────────────────────────────
  if (isEbook) {
    injectScriptUrl(BASE + 'ebook-interceptor.js').catch(err => {
      console.error('[Waka Userscript] ebook-interceptor load failed', err);
    });
  }
  if (isReader) {
    injectScriptUrl(BASE + 'reader-interceptor.js').catch(err => {
      console.error('[Waka Userscript] reader-interceptor load failed', err);
    });
  }

  // ── 2. Sau DOM sẵn sàng: load content + metadata ────────────────────────
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(async () => {
    if (typeof JSZip === 'undefined') {
      console.error('[Waka Userscript] JSZip missing – kiểm tra @require / GitHub Pages');
    }
    if (typeof CryptoJS === 'undefined') {
      console.error('[Waka Userscript] CryptoJS missing');
    }

    try {
      if (isEbook) {
        // book-metadata trước (tạo nút Copy metadata)
        await injectScriptUrl(BASE + 'book-metadata.js');
        // ebook-content (chèn nút Tải EPUB cạnh metadata + one-click)
        await injectScriptUrl(BASE + 'ebook-content.js');
        console.log('[Waka Userscript] ebook mode ready');
      }
      if (isReader) {
        await injectScriptUrl(BASE + 'reader-content.js');
        console.log('[Waka Userscript] reader mode ready');
      }
    } catch (err) {
      console.error('[Waka Userscript] content script load error', err);
      const t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:20px;right:16px;background:#3b1a1a;color:#fff;padding:12px 16px;border-radius:10px;z-index:999999;font-size:13px;max-width:320px;';
      t.textContent = 'Waka Userscript: không tải được script từ GitHub Pages. Kiểm tra đã upload đủ file.';
      document.body.appendChild(t);
    }
  });
})();
