// ==UserScript==
// @name         Waka EPUB Downloader
// @namespace    https://nguyenphanvn95.github.io/waka/
// @version      1.0.0
// @description  Tải EPUB từ waka.vn/ebook/* và /reader/* (tách từ Waka Toolkit 5.3.17)
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
// ==/UserScript==

(function () {
  'use strict';

  const isReader = /\/reader\//i.test(location.pathname);
  const isEbook  = /\/ebook\//i.test(location.pathname) || /\/shop\//i.test(location.pathname);

  // ─────────────────────────────────────────────────────────────
  // Inject interceptor vào MAIN world (page context)
  // ─────────────────────────────────────────────────────────────
  function injectInterceptor(code) {
    const s = document.createElement('script');
    s.textContent = code;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.remove();
  }

  // Load interceptor source via fetch from the same origin as the userscript host
  // Because @require already loaded the libs, we embed the interceptor code inline
  // for reliability (no extra network dependency for interceptors).

  if (isEbook) {
    // ── ebook-interceptor (MAIN world) ──
    injectInterceptor(`
/**
 * MAIN world – generate secure_code đúng thuật toán Waka
 * verified: Base64(HmacSHA1("account item_id content_type id os", key))
 * key = cookie fm.auth.tid  ||  md5(account)
 */
(function () {
  'use strict';
  if (window.__wakaEbookInterceptorV45) return;
  window.__wakaEbookInterceptorV45 = true;

  const API_BASE = 'beta-api.waka.vn';
  const DOWNLOAD_FIELDS = ['account', 'item_id', 'content_type', 'id', 'os'];

  let state = {
    item_id: null,
    account: 'guest',
    deviceId: null,
    tid: null,
    download_url: null
  };
  let _inFlight = false;

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ===== MD5 =====
  function md5(str) {
    function cmn(q,a,b,x,s,t){a=a+(q+x+t)|0;return(((a<<s)|(a>>>32-s))+b)|0}
    function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t)}
    function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t)}
    function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)}
    function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t)}
    function md5cycle(x,k){
      var a=x[0],b=x[1],c=x[2],d=x[3];
      a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);
      c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
      a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);
      c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
      a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);
      c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
      a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);
      c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
      a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);
      c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
      a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);
      c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
      a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);
      c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
      a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);
      c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
      a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);
      c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
      a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);
      c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
      a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);
      c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
      a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);
      c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
      a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);
      c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
      a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);
      c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
      a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);
      c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
      a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);
      c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
      x[0]=(a+x[0])|0;x[1]=(b+x[1])|0;x[2]=(c+x[2])|0;x[3]=(d+x[3])|0;
    }
    function md5blk(s){var i,md5blks=[];for(i=0;i<64;i+=4)md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);return md5blks}
    function md51(s){
      var n=s.length,state=[1732584193,-271733879,-1732584194,271733878],i;
      for(i=64;i<=n;i+=64) md5cycle(state, md5blk(s.substring(i-64,i)));
      s=s.substring(i-64); var tail=Array(16).fill(0);
      for(i=0;i<s.length;i++) tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);
      tail[i>>2]|=0x80<<((i%4)<<3);
      if(i>55){md5cycle(state,tail);tail=Array(16).fill(0)}
      tail[14]=n*8; md5cycle(state,tail); return state;
    }
    function rhex(n){var s='',j;for(j=0;j<4;j++)s+=('0'+((n>>(j*8))&255).toString(16)).slice(-2);return s}
    function hex(x){for(var i=0;i<x.length;i++)x[i]=rhex(x[i]);return x.join('')}
    return hex(md51(str));
  }

  async function hmacSha1Base64(message, key) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
    const bytes = new Uint8Array(sig);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }

  function encodeParam(t) {
    return encodeURIComponent(String(t))
      .replace(/!/g, '%21').replace(/'/g, '%27')
      .replace(/\\(/g, '%28').replace(/\\)/g, '%29').replace(/\\*/g, '%2A');
  }

  async function makeSecureCode(params, key) {
    const parts = DOWNLOAD_FIELDS.map(f => encodeParam(params[f] ?? ''));
    return hmacSha1Base64(parts.join(' '), key);
  }

  function getCookie(name) {
    try {
      const m = document.cookie.match(new RegExp('(?:^|;\\\\s*)' + name.replace(/\\./g, '\\\\.') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch { return null; }
  }

  function getTid() {
    const candidates = ['fm.auth.tid', 'tidToken', 'tid', 'fm.auth.tidToken'];
    for (const c of candidates) {
      const v = getCookie(c);
      if (v && v.length > 8) return v;
    }
    try {
      for (const store of [localStorage, sessionStorage]) {
        for (const k of ['fm.auth.tid', 'tidToken', 'tid', 'auth.tid']) {
          const v = store.getItem(k);
          if (v && v.length > 8) return v.replace(/^"|"$/g, '');
        }
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && /tid/i.test(k)) {
            const v = store.getItem(k);
            if (v && v.length > 8 && v.length < 200) return v.replace(/^"|"$/g, '');
          }
        }
      }
    } catch {}
    try {
      if (window.__NUXT__?.state?.auth?.user?.tid) return window.__NUXT__.state.auth.user.tid;
      if (window.$nuxt?.$store?.state?.auth?.user?.tid) return window.$nuxt.$store.state.auth.user.tid;
    } catch {}
    return null;
  }

  function getAccountFromState() {
    try {
      const u = window.__NUXT__?.state?.auth?.user || window.$nuxt?.$store?.state?.auth?.user;
      if (u?.userId) return String(u.userId);
      if (u?.id) return String(u.id);
    } catch {}
    const c = getCookie('fm.auth.user') || getCookie('account');
    if (c) {
      try {
        const j = JSON.parse(c);
        if (j.userId) return String(j.userId);
      } catch {}
    }
    return null;
  }

  function parseQuery(url) {
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://x/' + url);
      const o = {};
      u.searchParams.forEach((v, k) => { o[k] = v; });
      return o;
    } catch { return {}; }
  }

  function extractDownloadUrl(text) {
    try {
      const json = JSON.parse(text);
      if (json && json.code && json.code !== 0 && json.code !== 200) {
        return { error: json.message || ('code ' + json.code), code: json.code };
      }
      const cands = [
        json?.data?.download_url, json?.data?.url, json?.data?.epub_url,
        json?.data?.file_url, json?.data?.link,
        json?.download_url, json?.url, json?.epub_url, json?.file_url, json?.link
      ];
      for (const c of cands) {
        if (typeof c === 'string' && c.startsWith('http')) return { url: c };
      }
      if (json?.message) return { error: json.message, code: json.code };
    } catch {}
    const m = text.match(/"(https?:\\/\\/[^"]*(?:epub|book|download|vegacdn)[^"]*)"/i);
    if (m) return { url: m[1] };
    return null;
  }

  function handleUrl(url) {
    if (!url || !url.includes(API_BASE)) return;
    const p = parseQuery(url);
    if (p.id && p.id.length > 16) state.deviceId = p.id;
    if (p.account) state.account = p.account;

    const isShop = /\\/shop\\//i.test(location.pathname);

    if (p.item_id) {
      if (isShop) {
        // simplified for userscript
        state.item_id = p.item_id;
      } else {
        state.item_id = p.item_id;
      }
    }
    if (p.content_id && !state.item_id) {
      state.item_id = p.content_id;
    }

    const tid = getTid();
    if (tid) state.tid = tid;
    const acc = getAccountFromState();
    if (acc) state.account = acc;
    emit('__waka_params__', { ...state });
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      handleUrl(url);
      if (url.includes('getDownloadItemWeb')) {
        const clone = resp.clone();
        clone.text().then(text => {
          const r = extractDownloadUrl(text);
          if (r?.url) {
            state.download_url = r.url;
            emit('__waka_ebook_ready__', { url: r.url });
          }
        }).catch(() => {});
      }
    } catch {}
    return resp;
  };

  const NX = window.XMLHttpRequest;
  function PX() {
    const xhr = new NX();
    let _url = '';
    const oo = xhr.open;
    xhr.open = function (m, u, ...r) { _url = u || ''; return oo.apply(this, [m, u, ...r]); };
    xhr.addEventListener('load', function () {
      try {
        handleUrl(_url);
        if (_url.includes('getDownloadItemWeb') && xhr.responseText) {
          const r = extractDownloadUrl(xhr.responseText);
          if (r?.url) {
            state.download_url = r.url;
            emit('__waka_ebook_ready__', { url: r.url });
          }
        }
      } catch {}
    });
    return xhr;
  }
  PX.prototype = NX.prototype;
  window.XMLHttpRequest = PX;

  window.addEventListener('__waka_request_params__', () => {
    state.tid = getTid() || state.tid;
    const acc = getAccountFromState();
    if (acc) state.account = acc;
    emit('__waka_params__', { ...state });
  });

  function getOrCreateDeviceId() {
    try {
      const k = 'waka_toolkit_device_id';
      let id = localStorage.getItem(k);
      if (id && id.length >= 20) return id;
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(k, id);
      return id;
    } catch {
      return 'web_' + Date.now().toString(36);
    }
  }

  // Request download when button clicked (from content script)
  window.addEventListener('__waka_request_download__', async (e) => {
    if (_inFlight) return;
    _inFlight = true;
    try {
      const tid = getTid() || state.tid;
      const account = getAccountFromState() || state.account || 'guest';
      const item_id = state.item_id;
      if (!item_id) {
        emit('__waka_ebook_error__', { msg: 'Không tìm thấy item_id' });
        return;
      }
      const deviceId = state.deviceId || getOrCreateDeviceId();
      const key = tid || md5(account);
      const params = {
        account,
        item_id,
        content_type: '2', // ebook
        id: deviceId,
        os: 'web'
      };
      const secure_code = await makeSecureCode(params, key);
      const qs = new URLSearchParams({
        ...params,
        secure_code,
        type: '1'
      });
      const apiUrl = 'https://beta-api.waka.vn/v3/book/getDownloadItemWeb?' + qs.toString();
      const resp = await fetch(apiUrl, { credentials: 'include' });
      const text = await resp.text();
      const r = extractDownloadUrl(text);
      if (r?.url) {
        state.download_url = r.url;
        emit('__waka_ebook_ready__', { url: r.url });
      } else {
        emit('__waka_ebook_error__', { msg: r?.error || 'Không lấy được URL tải' });
      }
    } catch (err) {
      emit('__waka_ebook_error__', { msg: err.message });
    } finally {
      _inFlight = false;
    }
  });

  console.log('[Waka Userscript] ebook-interceptor injected');
})();
    `);
  }

  if (isReader) {
    // ── reader-interceptor (MAIN world) ──
    injectInterceptor(`
(function () {
  'use strict';
  if (window.__wakaReaderInterceptor) return;
  window.__wakaReaderInterceptor = true;

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function resolveUrl(href, base) {
    if (/^https?:\\/\\//.test(href)) return href;
    try { return new URL(href, base).href; }
    catch { return base.replace(/\\/$/, '') + '/' + href; }
  }

  function tryReadNuxt() {
    try {
      const nuxt = window.__NUXT__;
      if (!nuxt) return false;
      const raw = JSON.stringify(nuxt);
      const m   = raw.match(/"epub_url"\\s*:\\s*"(https?:[^"]+)"/);
      if (!m) return false;
      const url   = m[1].replace(/\\\\u002F/g, '/');
      const tm    = raw.match(/"title"\\s*:\\s*"([^"]+)"/);
      let title = tm ? tm[1] : (document.title || 'Ebook');
      title = String(title)
        .replace(/^Đọc[\\s_]*sách[\\s_]*[-–:_]*[\\s_]*/i, '')
        .replace(/\\s*[-–]\\s*.*Waka.*$/i, '')
        .trim() || 'Ebook';
      emit('__waka_epub_found__', { url, title });
      return true;
    } catch { return false; }
  }

  if (!tryReadNuxt()) {
    [300, 800, 1500, 3000].forEach(ms => setTimeout(tryReadNuxt, ms));
  }

  window.addEventListener('__waka_do_download__', async (e) => {
    try { await fetchAllEpubFiles(e.detail.opfUrl); }
    catch (err) { emit('__waka_epub_error__', { msg: err.message }); }
  });

  async function fetchAllEpubFiles(opfUrl) {
    const [opfPath, qs] = opfUrl.split('?');
    const token          = qs ? '?' + qs : '';
    const oebpsDir       = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);

    emit('__waka_epub_progress__', { msg: 'Tải content.opf...' });

    let opfResp = await fetch(opfUrl, { credentials: 'omit' });
    if (!opfResp.ok) opfResp = await fetch(opfUrl, { credentials: 'include' });
    if (!opfResp.ok) throw new Error('content.opf HTTP ' + opfResp.status);

    const opfText = await opfResp.text();
    if (!opfText.includes('<manifest')) throw new Error('OPF không hợp lệ');

    emit('__waka_epub_opf__', { text: opfText, oebpsDir });

    const parser = new DOMParser();
    const doc    = parser.parseFromString(opfText, 'application/xml');
    const items  = [];
    doc.querySelectorAll('manifest item').forEach(el => {
      const href = el.getAttribute('href');
      if (href) items.push({ href, type: el.getAttribute('media-type') || '' });
    });

    emit('__waka_epub_progress__', {
      msg: 'Phát hiện ' + items.length + ' files...', total: items.length, done: 0
    });

    const jsItems      = items.filter(i => i.href.includes('/js/jquery0') || /jquery\\d+\\.js/.test(i.href));
    const contentItems = items.filter(i => !jsItems.includes(i));

    const decryptScripts = {};
    for (const item of jsItems) {
      try {
        const url  = resolveUrl(item.href, oebpsDir) + token;
        let resp = await fetch(url, { credentials: 'omit' });
        if (!resp.ok) resp = await fetch(url, { credentials: 'include' });
        if (resp.ok) {
          const buf  = await resp.arrayBuffer();
          const text = new TextDecoder().decode(buf);
          decryptScripts[item.href] = text;
          emit('__waka_decrypt_script__', { href: item.href, script: text });
        }
      } catch (e) {}
    }

    let done = 0, failed = 0;
    const batchSize = 6;
    for (let i = 0; i < contentItems.length; i += batchSize) {
      const batch = contentItems.slice(i, i + batchSize);
      await Promise.all(batch.map(async (item) => {
        try {
          const url = resolveUrl(item.href, oebpsDir) + token;
          let resp = await fetch(url, { credentials: 'omit' });
          if (!resp.ok) resp = await fetch(url, { credentials: 'include' });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const buf = await resp.arrayBuffer();
          emit('__waka_epub_file__', { href: item.href, buffer: buf });
          done++;
        } catch (e) {
          failed++;
        }
      }));
      emit('__waka_epub_progress__', {
        msg: 'Đang tải ' + (done + failed) + '/' + contentItems.length,
        done, failed, total: contentItems.length
      });
    }

    emit('__waka_epub_done__', { done, failed });
  }

  console.log('[Waka Userscript] reader-interceptor injected');
})();
    `);
  }

  // ─────────────────────────────────────────────────────────────
  // Content logic (runs after DOM ready, in userscript context)
  // ─────────────────────────────────────────────────────────────
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(() => {
    // Ensure libs are available (from @require)
    if (typeof JSZip === 'undefined') {
      console.error('[Waka Userscript] JSZip not loaded. Check @require URL.');
      return;
    }
    if (typeof CryptoJS === 'undefined') {
      console.error('[Waka Userscript] CryptoJS not loaded. Check @require URL.');
      return;
    }
    // epub-decode & epub-builder expose globals via @require
    if (!window.WakaEpubDecode) {
      console.warn('[Waka Userscript] WakaEpubDecode missing – decode may fail');
    }
    if (!window.EPUBBuilder) {
      console.warn('[Waka Userscript] EPUBBuilder missing – build may fail');
    }

    if (isEbook) {
      loadEbookContent();
    } else if (isReader) {
      loadReaderContent();
    }
  });

  // ── Ebook content (adapted) ──
  function loadEbookContent() {
    // We inject a simplified version that listens for events from interceptor
    const code = `
(function () {
  'use strict';
  let _downloadUrl = null;
  let _isBusy = false;

  function isOpfUrl(url) {
    return /\\/content\\.opf(\\?|$)/i.test(String(url || ''));
  }

  function resolveUrl(href, base) {
    if (/^https?:\\/\\//i.test(href)) return href;
    try { return new URL(href, base).href; }
    catch { return base.replace(/\\/$/, '') + '/' + href; }
  }

  async function fetchWithFallback(url) {
    let resp = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    if (!resp.ok) resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
    return resp;
  }

  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: objectUrl, download: filename, style: 'display:none'
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }

  function cleanTitle(s) {
    if (window.WakaEpubDecode?.cleanTitle) return window.WakaEpubDecode.cleanTitle(s);
    return String(s || '')
      .replace(/^Đọc[\\s_]*sách[\\s_]*[-–:_]*[\\s_]*/i, '')
      .replace(/\\s*[-–]\\s*.*Waka.*$/i, '')
      .trim();
  }

  function safeName(s) {
    if (window.WakaEpubDecode?.safeName) return window.WakaEpubDecode.safeName(s);
    return cleanTitle(s || 'waka-ebook')
      .replace(/[<>:"/\\\\|?*\\x00-\\x1f]/g, '')
      .trim().replace(/\\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
      .slice(0, 100) || 'waka-ebook';
  }

  function getBookTitle() {
    const h1 = document.querySelector('h1.title-product, h1.text-white-50, h1');
    let title = h1?.textContent?.trim() || '';
    if (!title) {
      title = document.title
        .replace(/\\s*[-–]\\s*.*Waka.*$/i, '')
        .replace(/\\s*[-–]\\s*Sách giấy.*$/i, '')
        .trim();
    }
    return cleanTitle(title) || 'waka-ebook';
  }

  function createUI() {
    if (document.getElementById('waka-dl-ui')) return;
    const ui = document.createElement('div');
    ui.id = 'waka-dl-ui';
    ui.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:2147483646;display:flex;flex-direction:column;gap:8px;align-items:flex-end;font-family:system-ui,sans-serif;';
    ui.innerHTML = \`
      <div id="waka-dl-status" style="display:none;background:#111827;color:#9ca3af;font-size:12px;padding:6px 12px;border-radius:8px;max-width:280px;text-align:right;"></div>
      <button id="waka-dl-btn" style="background:#e94560;color:#fff;border:none;border-radius:12px;padding:12px 20px;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(233,69,96,.4);">⏳ Đang tìm EPUB...</button>
    \`;
    document.body.appendChild(ui);

    document.getElementById('waka-dl-btn').addEventListener('click', handleBtnClick);
  }

  function setStatus(msg, isError) {
    let el = document.getElementById('waka-dl-status');
    if (!el) { createUI(); el = document.getElementById('waka-dl-status'); }
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.color = isError ? '#ff8a8a' : '#9ca3af';
  }

  function updateBtn(text, active) {
    const btn = document.getElementById('waka-dl-btn');
    if (!btn) return;
    btn.innerHTML = text;
    btn.disabled = !active;
    btn.style.background = active ? '#e94560' : '#6b7280';
    btn.style.cursor = active ? 'pointer' : 'default';
  }

  window.addEventListener('__waka_ebook_ready__', (e) => {
    _downloadUrl = e.detail.url;
    updateBtn('⬇ Tải EPUB', true);
    setStatus('Sẵn sàng tải');
  });

  window.addEventListener('__waka_ebook_error__', (e) => {
    setStatus(e.detail.msg || 'Lỗi', true);
    updateBtn('⬇ Thử lại', true);
  });

  // Also try to request download after a short delay
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('__waka_request_download__'));
  }, 2500);

  async function handleBtnClick() {
    if (_isBusy) return;
    if (!_downloadUrl) {
      window.dispatchEvent(new CustomEvent('__waka_request_download__'));
      setStatus('Đang yêu cầu URL tải...');
      return;
    }
    if (isOpfUrl(_downloadUrl)) {
      await buildEpubFromOpf(_downloadUrl);
    } else {
      await downloadDirectFile(_downloadUrl);
    }
  }

  async function downloadDirectFile(url) {
    _isBusy = true;
    updateBtn('⏳ Đang tải...', false);
    try {
      setStatus('Đang tải file EPUB...');
      const resp = await fetchWithFallback(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const title = getBookTitle();
      const fname = safeName(title) + '.epub';
      downloadBlob(blob, fname);
      setStatus('✅ Đã lưu: ' + fname);
      updateBtn('✅ Đã tải', true);
    } catch (err) {
      setStatus('❌ ' + err.message, true);
      updateBtn('⬇ Thử lại', true);
    } finally {
      _isBusy = false;
    }
  }

  async function buildEpubFromOpf(opfUrl) {
    _isBusy = true;
    updateBtn('⏳ Đang giải mã...', false);
    try {
      if (!window.WakaEpubDecode) throw new Error('WakaEpubDecode chưa sẵn sàng');
      if (!window.EPUBBuilder?.buildFromFiles) throw new Error('EPUBBuilder chưa sẵn sàng');

      setStatus('Tải content.opf...');
      const [opfPath, qs = ''] = String(opfUrl).split('?');
      const token = qs ? '?' + qs : '';
      const oebpsDir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);

      let opfResp = await fetchWithFallback(opfUrl);
      if (!opfResp.ok) throw new Error('content.opf HTTP ' + opfResp.status);
      const opfText = await opfResp.text();
      if (!opfText.includes('<manifest')) throw new Error('OPF không hợp lệ');

      const parser = new DOMParser();
      const doc = parser.parseFromString(opfText, 'application/xml');
      const items = Array.from(doc.querySelectorAll('manifest item'))
        .map(el => ({ href: el.getAttribute('href') || '', type: el.getAttribute('media-type') || '' }))
        .filter(i => i.href);

      setStatus('Phát hiện ' + items.length + ' file, đang tải...');
      const files = new Map();
      let done = 0, failed = 0;
      const batchSize = 5;

      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(batch.map(async (item) => {
          const fileUrl = resolveUrl(item.href, oebpsDir) + token;
          try {
            let resp = await fetchWithFallback(fileUrl);
            if (!resp.ok) {
              if (item.href.includes('toc.ncx') || resp.status === 404) return;
              throw new Error('HTTP ' + resp.status);
            }
            const buf = await resp.arrayBuffer();
            const isTextFile = /\\.(xhtml|html?|xml|ncx|css|js|json)$/i.test(item.href);
            let finalValue = buf;
            if (isTextFile) {
              finalValue = window.WakaEpubDecode.decodeFileSync(buf);
            }
            files.set(item.href, finalValue);
            done++;
          } catch (err) {
            failed++;
          }
        }));
        setStatus('Đang tải: ' + done + '/' + items.length + ' · lỗi: ' + failed);
      }

      if (files.size === 0) throw new Error('Không tải được file nào');
      setStatus('Đang đóng gói ' + files.size + ' file...');
      const title = window.WakaEpubDecode.extractTitleFromOpf(opfText, getBookTitle());
      const blob = await window.EPUBBuilder.buildFromFiles(title, opfText, files);
      const fname = safeName(title) + '.epub';
      downloadBlob(blob, fname);
      setStatus('✅ Đã lưu: ' + fname + ' · ' + (blob.size/1024/1024).toFixed(2) + 'MB');
      updateBtn('✅ Đã tải', true);
    } catch (err) {
      console.error(err);
      setStatus('❌ ' + err.message, true);
      updateBtn('⬇ Thử lại', true);
    } finally {
      _isBusy = false;
    }
  }

  createUI();
  console.log('[Waka Userscript] ebook-content ready');
})();
    `;
    // Run in page context so it can share events with interceptor
    const s = document.createElement('script');
    s.textContent = code;
    document.documentElement.appendChild(s);
    s.remove();
  }

  // ── Reader content (adapted) ──
  function loadReaderContent() {
    const code = `
(function () {
  'use strict';
  let _epubUrl = null;
  let _title = 'Ebook';
  let _opfText = null;
  let _files = new Map();
  let _isBusy = false;
  let _isWaiting = false;

  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: objectUrl, download: filename, style: 'display:none'
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }

  function safeName(s) {
    if (window.WakaEpubDecode?.safeName) return window.WakaEpubDecode.safeName(s);
    return String(s || 'Ebook').replace(/[<>:"/\\\\|?*]/g, '').trim().replace(/\\s+/g, '_').slice(0, 100) || 'Ebook';
  }

  function createUI() {
    if (document.getElementById('wdl-ui')) return;
    const ui = document.createElement('div');
    ui.id = 'wdl-ui';
    ui.style.cssText = 'position:fixed;bottom:20px;right:16px;z-index:2147483646;display:flex;flex-direction:column;gap:8px;align-items:flex-end;font-family:system-ui,sans-serif;';
    ui.innerHTML = \`
      <div id="wdl-status" style="display:none;background:#111827;color:#9ca3af;font-size:12px;padding:6px 12px;border-radius:8px;max-width:280px;text-align:right;"></div>
      <button id="wdl-btn" style="background:#6b7280;color:#fff;border:none;border-radius:12px;padding:12px 20px;font-weight:700;font-size:14px;cursor:default;">⏳ Đang tìm...</button>
    \`;
    document.body.appendChild(ui);
    document.getElementById('wdl-btn').addEventListener('click', handleClick);
  }

  function setStatus(msg) {
    const el = document.getElementById('wdl-status');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function activateBtn() {
    const btn = document.getElementById('wdl-btn');
    if (btn) {
      btn.textContent = '⬇ Tải EPUB';
      btn.disabled = false;
      btn.style.background = '#e94560';
      btn.style.cursor = 'pointer';
    }
  }

  window.addEventListener('__waka_epub_found__', (e) => {
    _epubUrl = e.detail.url;
    _title = e.detail.title || 'Ebook';
    if (window.WakaEpubDecode?.cleanTitle) _title = window.WakaEpubDecode.cleanTitle(_title);
    activateBtn();
    setStatus('Sẵn sàng, nhấn nút để tải!');
  });

  window.addEventListener('__waka_epub_opf__', (e) => {
    _opfText = e.detail.text;
  });

  window.addEventListener('__waka_epub_file__', (e) => {
    _files.set(e.detail.href, e.detail.buffer);
  });

  window.addEventListener('__waka_epub_progress__', (e) => {
    setStatus(e.detail.msg || '');
    const btn = document.getElementById('wdl-btn');
    if (btn && _isWaiting) {
      const d = e.detail.done || 0;
      const f = e.detail.failed || 0;
      const t = e.detail.total || 0;
      btn.textContent = t > 0 ? '⏳ ' + (d + f) + '/' + t : '⏳ Đang tải...';
    }
  });

  window.addEventListener('__waka_epub_done__', async (e) => {
    const { done, failed } = e.detail;
    _isWaiting = false;
    if (done === 0 && failed > 0) {
      setStatus('Tất cả file bị từ chối');
      const btn = document.getElementById('wdl-btn');
      if (btn) { btn.textContent = '⬇ Thử lại'; btn.disabled = false; btn.style.background = '#e94560'; }
      _isBusy = false;
      return;
    }
    setStatus('Đang giải mã và đóng gói ' + done + ' file...');
    await buildAndDownload();
  });

  window.addEventListener('__waka_epub_error__', (e) => {
    _isWaiting = false;
    _isBusy = false;
    setStatus('Lỗi: ' + (e.detail.msg || ''));
    const btn = document.getElementById('wdl-btn');
    if (btn) { btn.textContent = '⬇ Thử lại'; btn.disabled = false; btn.style.background = '#e94560'; }
  });

  async function handleClick() {
    if (_isBusy || !_epubUrl) return;
    _isBusy = true;
    _isWaiting = true;
    _files.clear();
    _opfText = null;
    const btn = document.getElementById('wdl-btn');
    if (btn) { btn.textContent = '⏳ Đang tải...'; btn.disabled = true; }
    window.dispatchEvent(new CustomEvent('__waka_do_download__', { detail: { opfUrl: _epubUrl } }));
  }

  async function buildAndDownload() {
    try {
      if (!window.WakaEpubDecode || !window.EPUBBuilder?.buildFromFiles) {
        throw new Error('Thiếu thư viện decode/builder');
      }
      // Decode text files
      const decodedFiles = new Map();
      for (const [href, buf] of _files) {
        const isText = /\\.(xhtml|html?|xml|ncx|css|js|json)$/i.test(href);
        if (isText) {
          decodedFiles.set(href, window.WakaEpubDecode.decodeFileSync(buf));
        } else {
          decodedFiles.set(href, buf);
        }
      }
      const title = window.WakaEpubDecode.extractTitleFromOpf(_opfText, _title);
      const blob = await window.EPUBBuilder.buildFromFiles(title, _opfText, decodedFiles);
      const fname = safeName(title) + '.epub';
      downloadBlob(blob, fname);
      setStatus('✅ Đã lưu: ' + fname);
      const btn = document.getElementById('wdl-btn');
      if (btn) { btn.textContent = '✅ Đã tải'; btn.disabled = false; btn.style.background = '#28a745'; }
    } catch (err) {
      setStatus('❌ ' + err.message);
      const btn = document.getElementById('wdl-btn');
      if (btn) { btn.textContent = '⬇ Thử lại'; btn.disabled = false; btn.style.background = '#e94560'; }
    } finally {
      _isBusy = false;
    }
  }

  createUI();
  console.log('[Waka Userscript] reader-content ready');
})();
    `;
    const s = document.createElement('script');
    s.textContent = code;
    document.documentElement.appendChild(s);
    s.remove();
  }
})();
