// ==UserScript==
// @name         Voiz Live Player + PiP
// @namespace    https://nguyenphanvn95.github.io/voiz/
// @version      7.3.0-us.1
// @description  Nghe liên tục trên Voiz.vn — stream HLS + fallback, panel player đầy đủ, Picture-in-Picture (từ Mydio-Voiz Toolkit 7.3.0)
// @author       Adapted for Tampermonkey
// @match        https://voiz.vn/*
// @match        https://*.voiz.vn/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  var BASES = [
    'https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/voiz/',
    'https://nguyenphanvn95.github.io/voiz/'
  ];

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = function () { resolve(url); };
      s.onerror = function () { reject(new Error('Failed ' + url)); };
      (document.documentElement || document.head).appendChild(s);
    });
  }

  async function loadFromBases(path) {
    var last;
    for (var i = 0; i < BASES.length; i++) {
      try {
        await loadScript(BASES[i] + path);
        console.log('[Voiz US] loaded', path);
        return;
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error(path);
  }

  // MAIN-world interceptor early
  loadFromBases('voiz-newtab-interceptor.js').catch(function (e) {
    console.warn('[Voiz US] interceptor', e);
  });

  // hide banners ASAP
  loadFromBases('voiz-hide.js').catch(function (e) {
    console.warn('[Voiz US] hide', e);
  });

  // newtab helpers (open in new tab buttons etc.)
  loadFromBases('voiz-newtab-content.js').catch(function (e) {
    console.warn('[Voiz US] newtab-content', e);
  });

  // Full continuous player + PiP only on /play/*
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    if (!/\/play\//i.test(location.pathname)) {
      console.log('[Voiz US] not a play page — skip continuous player panel');
      return;
    }
    loadFromBases('voiz-content.js')
      .then(function () {
        console.log('[Voiz US] player panel + PiP ready');
      })
      .catch(function (e) {
        console.error('[Voiz US] voiz-content failed', e);
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:20px;right:16px;background:#3b1a1a;color:#fff;padding:12px 16px;border-radius:10px;z-index:999999;font-size:13px;max-width:340px';
        t.textContent = 'Voiz Userscript: không tải được voiz-content.js — upload file lên GitHub Pages /voiz/';
        document.body.appendChild(t);
      });
  });
})();
