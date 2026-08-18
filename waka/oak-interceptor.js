/**
 * oak-interceptor.js — MAIN world trên /hieu-soi/*
 *
 * - Bắt response loadListChapBookOak → lưu danh sách chương (id, name, book_id)
 * - Cung cấp __waka_oak_download_chapter__ → gọi getDownloadItemOakWeb
 *   content_type=retail_book_chapter, lấy link OPF/EPUB
 *
 * secure_code = Base64(HmacSHA1("account item_id content_type id os", key))
 * key = tid || md5(account)
 */
(function () {
  'use strict';
  if (window.__wakaOakInterceptorV1) return;
  window.__wakaOakInterceptorV1 = true;

  const API_BASE = 'beta-api.waka.vn';
  const DOWNLOAD_FIELDS = ['account', 'item_id', 'content_type', 'id', 'os'];

  const state = {
    chapters: [], // { id, name, book_id, chapter_order, content_type }
    book_id: null,
    deviceId: null,
    account: 'guest',
    tid: null,
  };

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ===== MD5 =====
  function md5(str) {
    function cmn(q, a, b, x, s, t) { a = a + (q + x + t) | 0; return (((a << s) | (a >>> 32 - s)) + b) | 0; }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function md5cycle(x, k) {
      var a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = (a + x[0]) | 0; x[1] = (b + x[1]) | 0; x[2] = (c + x[2]) | 0; x[3] = (d + x[3]) | 0;
    }
    function md5blk(s) {
      var i, md5blks = [];
      for (i = 0; i < 64; i += 4)
        md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
      return md5blks;
    }
    function md51(s) {
      var n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i;
      for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
      s = s.substring(i - 64);
      var tail = Array(16).fill(0);
      for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) { md5cycle(state, tail); tail = Array(16).fill(0); }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    }
    function rhex(n) {
      var s = '', j;
      for (j = 0; j < 4; j++) s += ('0' + ((n >> (j * 8)) & 255).toString(16)).slice(-2);
      return s;
    }
    function hex(x) {
      for (var i = 0; i < x.length; i++) x[i] = rhex(x[i]);
      return x.join('');
    }
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
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }

  function encodeParam(t) {
    return encodeURIComponent(String(t))
      .replace(/!/g, '%21').replace(/'/g, '%27')
      .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
  }

  async function makeSecureCode(params, key) {
    const parts = DOWNLOAD_FIELDS.map((f) => encodeParam(params[f] ?? ''));
    return hmacSha1Base64(parts.join(' '), key);
  }

  function getCookie(name) {
    try {
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name.replace(/\./g, '\\.') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
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

  function getOrCreateDeviceId() {
    try {
      const k = 'waka_toolkit_device_id';
      let id = localStorage.getItem(k);
      if (id && id.length >= 20) return id;
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(k, id);
      return id;
    } catch {
      return 'web' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
    }
  }

  function parseQuery(url) {
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://x/' + url);
      const o = {};
      u.searchParams.forEach((v, k) => {
        o[k] = v;
      });
      return o;
    } catch {
      return {};
    }
  }

  function extractDownloadUrl(text) {
    try {
      const json = JSON.parse(text);
      if (json && json.code && json.code !== 0 && json.code !== 200) {
        return { error: json.message || 'code ' + json.code, code: json.code };
      }
      const cands = [
        json?.data?.download_url,
        json?.data?.url,
        json?.data?.epub_url,
        json?.data?.file_url,
        json?.data?.link,
        json?.data?.content_url,
        json?.download_url,
        json?.url,
        json?.epub_url,
        json?.file_url,
        json?.link,
      ];
      for (const c of cands) {
        if (typeof c === 'string' && c.startsWith('http')) return { url: c };
      }
      if (json?.message) return { error: json.message, code: json.code };
    } catch {}
    const m = text.match(/"(https?:\/\/[^"]*(?:epub|book|download|vegacdn|store\.waka|content\.opf)[^"]*)"/i);
    if (m) return { url: m[1] };
    return null;
  }

  function mergeChapters(list) {
    if (!Array.isArray(list)) return;
    const byId = new Map(state.chapters.map((c) => [String(c.id), c]));
    for (const ch of list) {
      if (!ch || ch.id == null) continue;
      const entry = {
        id: ch.id,
        name: ch.name || '',
        book_id: ch.book_id,
        chapter_order: ch.chapter_order,
        content_type: ch.content_type || 'retail_book_chapter',
        file_version: ch.file_version || 1,
      };
      byId.set(String(ch.id), entry);
      if (ch.book_id) state.book_id = ch.book_id;
    }
    state.chapters = Array.from(byId.values()).sort(
      (a, b) => (a.chapter_order || 0) - (b.chapter_order || 0)
    );
    emit('__waka_oak_chapters__', { chapters: state.chapters, book_id: state.book_id });
    console.log('[Waka Oak] chapters cached:', state.chapters.length);
  }

  function handleListResponse(text, url) {
    try {
      const json = JSON.parse(text);
      if (json && Array.isArray(json.data)) {
        mergeChapters(json.data);
      }
    } catch {}
    const p = parseQuery(url || '');
    if (p.id && p.id.length > 16) state.deviceId = p.id;
    if (p.account) state.account = p.account;
    if (p.book_id) state.book_id = p.book_id;
  }

  function handleUrlParams(url) {
    if (!url || !url.includes(API_BASE)) return;
    const p = parseQuery(url);
    if (p.id && p.id.length > 16) state.deviceId = p.id;
    if (p.account) state.account = p.account;
    if (p.book_id) state.book_id = p.book_id;
    const tid = getTid();
    if (tid) state.tid = tid;
    const acc = getAccountFromState();
    if (acc) state.account = acc;
  }

  // Hook fetch
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      handleUrlParams(url);
      if (url.includes('loadListChapBookOak') || url.includes('loadListChap')) {
        const clone = resp.clone();
        clone.text().then((text) => handleListResponse(text, url)).catch(() => {});
      }
      if (url.includes('getDownloadItemOakWeb')) {
        const clone = resp.clone();
        const p = parseQuery(url);
        clone.text().then((text) => {
          const r = extractDownloadUrl(text);
          if (r?.url) {
            if (p.item_id) saveOpfTemplate(r.url, p.item_id);
            emit('__waka_oak_chapter_ready__', { url: r.url, item_id: p.item_id });
          }
        }).catch(() => {});
      }
    } catch {}
    return resp;
  };

  // Hook XHR
  const NX = window.XMLHttpRequest;
  function PX() {
    const xhr = new NX();
    let _url = '';
    const oo = xhr.open;
    xhr.open = function (m, u, ...r) {
      _url = u || '';
      return oo.apply(this, [m, u, ...r]);
    };
    xhr.addEventListener('load', function () {
      try {
        handleUrlParams(_url);
        if ((_url.includes('loadListChapBookOak') || _url.includes('loadListChap')) && xhr.responseText) {
          handleListResponse(xhr.responseText, _url);
        }
        if (_url.includes('getDownloadItemOakWeb') && xhr.responseText) {
          const r = extractDownloadUrl(xhr.responseText);
          const p = parseQuery(_url);
          if (r?.url) {
            if (p.item_id) saveOpfTemplate(r.url, p.item_id);
            emit('__waka_oak_chapter_ready__', { url: r.url, item_id: p.item_id });
          }
        }
      } catch {}
    });
    return xhr;
  }
  PX.prototype = NX.prototype;
  window.XMLHttpRequest = PX;

  const OPF_STORE_KEY = 'waka_oak_last_opf_template';
  const OPF_MAP_KEY = 'waka_oak_opf_map'; // bookId -> { itemId: url, ... last }

  // Lịch sử OPF thành công trong session
  const _opfHistory = []; // { itemId, folder, ver, url, bookId }

  function isPriceError(msg) {
    const s = String(msg || '').toLowerCase();
    return (
      /giá|sồi|oak|mua|thanh toán|không có quyền|chưa mua|payment|price|xu sồi|cần.*sồi/.test(s) ||
      /ebook giá/.test(s) ||
      /không thể tải|chưa sở hữu|own/.test(s)
    );
  }

  function currentBookKey() {
    return String(state.book_id || location.pathname || 'unknown');
  }

  function parseOpfPath(url) {
    const u = String(url || '');
    // .../0/0/{folder}/{id}_{ver}/OEBPS/content.opf?token=...
    let m = u.match(/\/0\/0\/(\d+)\/(\d+)_(\d+)\/OEBPS\/content\.opf/i);
    if (m) {
      return {
        folder: parseInt(m[1], 10),
        itemId: m[2],
        ver: parseInt(m[3], 10),
        token: u.includes('?') ? u.slice(u.indexOf('?')) : '',
        prefix: u.slice(0, m.index) + '/0/0/',
        enterprise: (u.match(/\/enterprise\/([^/]+)\//) || [])[1] || '',
      };
    }
    m = u.match(/\/(\d+)\/(\d+)_(\d+)\/OEBPS\/content\.opf/i);
    if (m) {
      return {
        folder: parseInt(m[1], 10),
        itemId: m[2],
        ver: parseInt(m[3], 10),
        token: u.includes('?') ? u.slice(u.indexOf('?')) : '',
        prefix: u.slice(0, m.index) + '/',
        enterprise: (u.match(/\/enterprise\/([^/]+)\//) || [])[1] || '',
      };
    }
    return null;
  }

  function loadOpfMap() {
    try {
      return JSON.parse(localStorage.getItem(OPF_MAP_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveOpfMap(map) {
    try {
      localStorage.setItem(OPF_MAP_KEY, JSON.stringify(map));
    } catch {}
  }

  function saveOpfTemplate(url, itemId) {
    if (!url || !/content\.opf/i.test(url)) return;
    try {
      const parsed = parseOpfPath(url);
      const bookKey = currentBookKey();
      const entry = {
        url: String(url),
        itemId: String(itemId || (parsed && parsed.itemId) || ''),
        folder: parsed ? parsed.folder : null,
        ver: parsed ? parsed.ver : 1,
        bookKey,
        path: location.pathname,
        ts: Date.now(),
      };
      localStorage.setItem(OPF_STORE_KEY, JSON.stringify(entry));

      const map = loadOpfMap();
      if (!map[bookKey]) map[bookKey] = { byId: {}, last: null };
      map[bookKey].byId[entry.itemId] = url;
      map[bookKey].last = entry;
      // giữ tối đa 200 id / sách
      const ids = Object.keys(map[bookKey].byId);
      if (ids.length > 200) {
        ids.slice(0, ids.length - 200).forEach((k) => delete map[bookKey].byId[k]);
      }
      saveOpfMap(map);

      if (parsed) {
        _opfHistory.push({
          itemId: entry.itemId,
          folder: parsed.folder,
          ver: parsed.ver,
          url: entry.url,
          bookId: bookKey,
        });
        if (_opfHistory.length > 50) _opfHistory.shift();
      }
      console.log(
        '[Waka Oak] saved OPF',
        entry.itemId,
        'folder=',
        entry.folder,
        'ver=',
        entry.ver,
        'book=',
        bookKey
      );
    } catch (e) {
      console.warn('[Waka Oak] save OPF template fail', e);
    }
  }

  function loadOpfTemplate() {
    try {
      const bookKey = currentBookKey();
      const map = loadOpfMap();
      if (map[bookKey] && map[bookKey].last && map[bookKey].last.url) {
        return map[bookKey].last;
      }
      const raw = localStorage.getItem(OPF_STORE_KEY);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || !entry.url) return null;
      // tránh dùng template sách khác
      if (entry.bookKey && entry.bookKey !== bookKey && entry.path !== location.pathname) {
        return null;
      }
      return entry;
    } catch {
      return null;
    }
  }

  function getKnownOpfForId(itemId) {
    const map = loadOpfMap();
    const bookKey = currentBookKey();
    return (map[bookKey] && map[bookKey].byId && map[bookKey].byId[String(itemId)]) || null;
  }

  /**
   * Dựng nhiều ứng viên OPF.
   * Path: {prefix}{folder}/{id}_{ver}/OEBPS/content.opf{token}
   */
  function buildOpfUrlCandidates(newItemId, fileVersion) {
    const newId = String(newItemId);
    const known = getKnownOpfForId(newId);
    if (known) return [known];

    const entry = loadOpfTemplate();
    if (!entry || !entry.url) return [];

    const parsed = parseOpfPath(entry.url);
    const oldId = entry.itemId ? String(entry.itemId) : parsed ? parsed.itemId : null;
    let prefix = parsed ? parsed.prefix : null;
    let token = parsed ? parsed.token : '';
    let baseFolder = parsed && parsed.folder != null ? parsed.folder : 1;
    let baseVer = fileVersion || (parsed ? parsed.ver : 1) || 1;

    if (!token && entry.url.includes('?')) {
      token = entry.url.slice(entry.url.indexOf('?'));
    }
    if (!prefix) {
      const pathPart = entry.url.split('?')[0];
      const mPrefix = pathPart.match(/^(https?:\/\/.+?\/0\/0\/)\d+\/\d+_\d+\/OEBPS\/content\.opf$/i);
      if (mPrefix) prefix = mPrefix[1];
    }
    if (!prefix) {
      // last resort: string replace only
      const u = entry.url
        .replace(new RegExp('/' + String(oldId || '___') + '_(\\d+)/'), '/' + newId + '_$1/')
        .replace(/\/(\d+)_\d+\/OEBPS\//i, '/' + newId + '_' + baseVer + '/OEBPS/');
      return u !== entry.url ? [u] : [];
    }

    const candidates = [];
    const seen = new Set();
    const push = (url, label) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      candidates.push({ url, label });
    };
    const make = (folder, ver) =>
      prefix + folder + '/' + newId + '_' + ver + '/OEBPS/content.opf' + token;

    // folder ưu tiên từ history cùng book
    const bookKey = currentBookKey();
    const hist = _opfHistory.filter((h) => h.bookId === bookKey);
    const preferredFolders = [];
    if (hist.length) {
      const last = hist[hist.length - 1];
      preferredFolders.push(last.folder, last.folder + 1, last.folder - 1, last.folder + 2);
      if (hist.length >= 2) {
        const a = hist[hist.length - 2];
        const b = last;
        const idDelta = Number(b.itemId) - Number(a.itemId);
        const fDelta = b.folder - a.folder;
        if (idDelta !== 0) {
          const est = Math.round(b.folder + ((Number(newId) - Number(b.itemId)) * fDelta) / idDelta);
          if (est >= 0) preferredFolders.push(est, est + 1, est - 1, est + 2, est - 2);
        }
      }
    }
    preferredFolders.push(baseFolder);

    // Ước lượng theo khoảng cách id
    if (oldId) {
      const idDelta = Number(newId) - Number(oldId);
      for (const per of [30, 50, 80, 100, 120, 150, 200, 250, 300, 400, 500, 800, 1000, 2000]) {
        const est = Math.round(baseFolder + idDelta / per);
        if (est >= 0) preferredFolders.push(est, est + 1, est - 1);
      }
    }

    const vers = [];
    [baseVer, fileVersion, 1, 2, 3, 4, 5].forEach((v) => {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n > 0 && !vers.includes(n)) vers.push(n);
    });

    // 1) preferred folders
    for (const f of preferredFolders) {
      if (f == null || f < 0) continue;
      for (const ver of vers) push(make(f, ver), 'pref-f' + f + '-v' + ver);
    }

    // 2) wide scan folder ±50 (chỉ ver chính để giảm số lượng)
    const mainVer = vers[0] || 1;
    for (let d = 0; d <= 50; d++) {
      for (const sign of d === 0 ? [0] : [1, -1]) {
        const f = baseFolder + d * sign;
        if (f < 0) continue;
        push(make(f, mainVer), 'scan-f' + f + '-v' + mainVer);
      }
    }

    // 3) wide scan với ver khác (folder ±10)
    for (const ver of vers.slice(1)) {
      for (let d = 0; d <= 10; d++) {
        for (const sign of d === 0 ? [0] : [1, -1]) {
          const f = baseFolder + d * sign;
          if (f < 0) continue;
          push(make(f, ver), 'scan-f' + f + '-v' + ver);
        }
      }
    }

    // 4) pure id replace
    if (oldId && oldId !== newId) {
      let u = entry.url;
      const re = new RegExp('/' + oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(_\\d+)(/)');
      if (re.test(u)) u = u.replace(re, '/' + newId + '$1$2');
      else u = u.split(oldId).join(newId);
      push(u, 'id-only');
    }

    console.log('[Waka Oak] built', candidates.length, 'OPF candidates for', newId, 'baseFolder=', baseFolder);
    // log vài cái đầu
    candidates.slice(0, 8).forEach((c) => console.log('  ', c.label, c.url));
    return candidates.map((c) => c.url);
  }

  async function probeOpfUrl(url) {
    try {
      // Thử omit trước, rồi include
      for (const cred of ['omit', 'include']) {
        try {
          const resp = await origFetch(url, {
            credentials: cred,
            cache: 'no-store',
            mode: 'cors',
          });
          if (!resp.ok) continue;
          const text = await resp.text();
          if (!text) continue;
          // nhận OPF hợp lệ (nới điều kiện)
          if (
            text.includes('<manifest') ||
            text.includes('<package') ||
            text.includes('application/oebps') ||
            text.includes('<spine') ||
            (text.includes('<?xml') && text.includes('opf'))
          ) {
            return url;
          }
        } catch {}
      }
      return null;
    } catch {
      return null;
    }
  }

  async function probeOpfCandidates(candidates, item_id, statusEmit) {
    if (!candidates || !candidates.length) return null;
    const batchSize = 6;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      if (statusEmit) {
        statusEmit(
          'Thử OPF ' +
            (i + 1) +
            '-' +
            Math.min(i + batch.length, candidates.length) +
            '/' +
            candidates.length +
            '...'
        );
      }
      const results = await Promise.all(batch.map((u) => probeOpfUrl(u)));
      const hit = results.find((u) => !!u);
      if (hit) return hit;
    }
    return null;
  }

    async function tryDownloadChapter(account, item_id, deviceId, key, label, contentType, os) {
    const ct = contentType || 'retail_book_chapter';
    const osVal = os || 'web';
    const params = { account, item_id, content_type: ct, id: deviceId, os: osVal };
    const secure_code = await makeSecureCode(params, key);
    const qs = new URLSearchParams({
      os: osVal,
      id: deviceId,
      account,
      item_id,
      content_type: ct,
      rf: location.href,
      secure_code,
    });
    const url = `https://${API_BASE}/super/getDownloadItemOakWeb?${qs}`;
    console.log('[Waka Oak] try', label, 'item_id=', item_id, 'ct=', ct, 'os=', osVal);
    const resp = await origFetch(url, { credentials: 'omit' });
    const text = await resp.text();
    console.log('[Waka Oak] response', label, resp.status, text.slice(0, 250));
    return extractDownloadUrl(text);
  }

  let _inFlight = false;

  window.addEventListener('__waka_oak_download_chapter__', async (e) => {
    if (_inFlight) {
      emit('__waka_oak_status__', { msg: 'Đang xử lý chương khác...', isError: false });
      return;
    }
    const detail = e.detail || {};
    let item_id = detail.item_id || detail.chapter_id;
    const chapterName = detail.name || '';
    const contentType = detail.content_type || 'retail_book_chapter';

    if (!item_id && chapterName) {
      const found = state.chapters.find(
        (c) => c.name === chapterName || c.name.trim() === chapterName.trim()
      );
      if (found) item_id = found.id;
    }

    if (!item_id) {
      emit('__waka_oak_status__', {
        msg: 'Không tìm thấy id chương. Đợi danh sách chương load xong rồi thử lại.',
        isError: true,
      });
      return;
    }

    let deviceId = detail.id || state.deviceId || getOrCreateDeviceId();
    state.deviceId = deviceId;
    const tid = getTid() || state.tid;
    let account = getAccountFromState() || detail.account || state.account || 'guest';

    _inFlight = true;
    emit('__waka_oak_status__', { msg: 'Đang lấy link chương...', item_id });

    try {
      const attempts = [];
      if (tid && account && account !== 'guest') {
        attempts.push({ account, key: tid, label: 'login+tid' });
      }
      if (account && account !== 'guest') {
        attempts.push({ account, key: md5(account), label: 'login+md5' });
      }
      attempts.push({ account: 'guest', key: md5('guest'), label: 'guest' });

      // Thử os=web rồi os=wap (app dùng wap)
      const osList = ['web', 'wap'];
      let lastError = null;

      for (const a of attempts) {
        for (const os of osList) {
          const result = await tryDownloadChapter(
            a.account,
            item_id,
            deviceId,
            a.key,
            a.label,
            contentType,
            os
          );
          if (result?.url) {
            saveOpfTemplate(result.url, item_id);
            emit('__waka_oak_chapter_ready__', {
              url: result.url,
              item_id,
              name: chapterName,
              via: 'api',
            });
            return;
          }
          lastError = result?.error || 'unknown';
        }
      }

      // Fallback: API báo giá sồi / không có quyền → dựng OPF từ template đã lưu
      const priceLike = isPriceError(lastError) || !lastError || lastError === 'unknown';
      if (priceLike) {
        emit('__waka_oak_status__', {
          msg: 'API chặn (có thể cần sồi) — thử OPF dự đoán (id + folder +0..+3)...',
          item_id,
        });
        const chMeta = state.chapters.find((c) => String(c.id) === String(item_id));
        const fileVer = chMeta && chMeta.file_version;
        const candidates = buildOpfUrlCandidates(item_id, fileVer);
        if (candidates.length) {
          const okUrl = await probeOpfCandidates(candidates, item_id, (msg) => {
            emit('__waka_oak_status__', { msg, item_id });
          });
          if (okUrl) {
            saveOpfTemplate(okUrl, item_id);
            emit('__waka_oak_chapter_ready__', {
              url: okUrl,
              item_id,
              name: chapterName,
              via: 'opf-template',
            });
            return;
          }
          lastError =
            (lastError || '') +
            ' · Đã thử ' +
            candidates.length +
            ' link OPF (folder±50, multi-ver) — không mở được';
        } else {
          lastError =
            (lastError || 'Không lấy được link') +
            ' · Chưa có template OPF (tải 1 chương thành công trước)';
        }
      }

      emit('__waka_oak_status__', {
        msg: lastError || 'Không lấy được link chương',
        isError: true,
        item_id,
      });
    } catch (err) {
      emit('__waka_oak_status__', {
        msg: 'Lỗi: ' + (err && err.message ? err.message : err),
        isError: true,
        item_id,
      });
    } finally {
      _inFlight = false;
    }
  });

  window.addEventListener('__waka_oak_request_chapters__', () => {
    emit('__waka_oak_chapters__', { chapters: state.chapters, book_id: state.book_id });
  });

  // ── Lấy toàn bộ chương (phân trang loadListChapBookOak) ───────────────
  const LIST_FIELD_ORDERS = [
    ['account', 'book_id', 'filter_id', 'id', 'os', 'page_no', 'page_size'],
    ['account', 'book_id', 'filter_id', 'id', 'os'],
    ['os', 'id', 'account', 'book_id', 'filter_id', 'page_no', 'page_size'],
    ['account', 'book_id', 'id', 'os', 'page_no', 'page_size'],
  ];

  async function makeSecureCodeFields(params, key, fields) {
    const parts = fields.map((f) => encodeParam(params[f] ?? ''));
    return hmacSha1Base64(parts.join(' '), key);
  }

  function extractBookIdFromPage() {
    if (state.book_id) return state.book_id;
    if (state.chapters[0]?.book_id) return state.chapters[0].book_id;
    try {
      const nuxt = window.__NUXT__;
      const walk = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 5) return null;
        if (obj.book_id && Number(obj.book_id) > 0) return obj.book_id;
        if (obj.bookId && Number(obj.bookId) > 0) return obj.bookId;
        for (const k of Object.keys(obj)) {
          const r = walk(obj[k], depth + 1);
          if (r) return r;
        }
        return null;
      };
      if (nuxt) {
        const r = walk(nuxt, 0);
        if (r) return r;
      }
    } catch {}
    try {
      const html = document.documentElement.innerHTML;
      const m = html.match(/book_id["'\s:=]+(\d{2,})/);
      if (m) return m[1];
      const m2 = html.match(/img\.retail_book\/0\/0\/0\/(\d+)\./);
      if (m2) return m2[1];
    } catch {}
    return null;
  }

  async function fetchChapterPage(bookId, pageNo, pageSize, account, deviceId, key, fields, os) {
    const params = {
      account,
      book_id: String(bookId),
      filter_id: '1',
      id: deviceId,
      os: os || 'web',
      page_no: String(pageNo),
      page_size: String(pageSize),
    };
    const secure_code = await makeSecureCodeFields(params, key, fields);
    const qs = new URLSearchParams({ ...params, secure_code });
    const url = `https://${API_BASE}/super/loadListChapBookOak?${qs}`;
    const resp = await origFetch(url, { credentials: 'omit' });
    const text = await resp.text();
    try {
      const json = JSON.parse(text);
      if (json && json.code === 0 && Array.isArray(json.data)) {
        return json.data;
      }
    } catch {}
    return null;
  }

  async function fetchAllChaptersFromApi(bookId) {
    const deviceId = state.deviceId || getOrCreateDeviceId();
    state.deviceId = deviceId;
    const tid = getTid() || state.tid;
    let account = getAccountFromState() || state.account || 'guest';
    const pageSize = 100;
    const osList = ['web', 'wap'];

    const authAttempts = [];
    if (tid && account && account !== 'guest') authAttempts.push({ account, key: tid, label: 'tid' });
    if (account && account !== 'guest') authAttempts.push({ account, key: md5(account), label: 'md5' });
    authAttempts.push({ account: 'guest', key: md5('guest'), label: 'guest' });

    // Tìm combo auth + fields + os hoạt động với page 1
    let working = null;
    let page1 = null;
    outer: for (const a of authAttempts) {
      for (const fields of LIST_FIELD_ORDERS) {
        for (const os of osList) {
          const data = await fetchChapterPage(bookId, 1, pageSize, a.account, deviceId, a.key, fields, os);
          if (data && data.length) {
            working = { ...a, fields, os };
            page1 = data;
            break outer;
          }
        }
      }
    }

    if (!page1) {
      // fallback: dùng chapters đã cache từ interceptor trang
      if (state.chapters.length) return state.chapters.slice();
      return null;
    }

    mergeChapters(page1);
    let all = page1.slice();
    let page = 2;
    // tiếp tục đến khi trang trả ít hơn pageSize hoặc rỗng
    while (page <= 50) {
      const data = await fetchChapterPage(
        bookId, page, pageSize,
        working.account, deviceId, working.key, working.fields, working.os
      );
      if (!data || !data.length) break;
      mergeChapters(data);
      all = all.concat(data);
      if (data.length < pageSize) break;
      page++;
      emit('__waka_oak_status__', { msg: `Đã lấy ${all.length} chương (trang ${page - 1})...` });
    }

    // unique by id, sort by chapter_order
    const map = new Map();
    for (const c of all) map.set(String(c.id), c);
    const sorted = Array.from(map.values()).sort(
      (a, b) => (a.chapter_order || 0) - (b.chapter_order || 0)
    );
    state.chapters = sorted;
    state.book_id = bookId;
    return sorted;
  }

  /** Resolve OPF URL for one chapter (API + template fallback) */
  async function resolveChapterOpf(item_id, contentType, fileVersion) {
    // Đã có cache?
    const cached = getKnownOpfForId(item_id);
    if (cached) {
      const ok = await probeOpfUrl(cached);
      if (ok) return { url: ok, via: 'cache' };
    }

    const deviceId = state.deviceId || getOrCreateDeviceId();
    state.deviceId = deviceId;
    const tid = getTid() || state.tid;
    let account = getAccountFromState() || state.account || 'guest';
    const ct = contentType || 'retail_book_chapter';

    const attempts = [];
    if (tid && account && account !== 'guest') attempts.push({ account, key: tid, label: 'tid' });
    if (account && account !== 'guest') attempts.push({ account, key: md5(account), label: 'md5' });
    attempts.push({ account: 'guest', key: md5('guest'), label: 'guest' });

    let lastError = null;
    for (const a of attempts) {
      for (const os of ['web', 'wap']) {
        const result = await tryDownloadChapter(a.account, item_id, deviceId, a.key, a.label, ct, os);
        if (result?.url) {
          saveOpfTemplate(result.url, item_id);
          return { url: result.url, via: 'api' };
        }
        lastError = result?.error || 'unknown';
      }
    }

    // template fallback mở rộng (folder ±50, nhiều ver, history)
    const candidates = buildOpfUrlCandidates(item_id, fileVersion);
    console.log('[Waka Oak] fallback candidates', candidates.length, 'for', item_id, 'err=', lastError);
    const hit = await probeOpfCandidates(candidates, item_id, null);
    if (hit) {
      saveOpfTemplate(hit, item_id);
      return { url: hit, via: 'opf-template' };
    }
    return {
      error: (lastError || 'Không resolve được OPF') + ' · tried ' + candidates.length + ' urls',
      via: null,
    };
  }

  window.addEventListener('__waka_oak_fetch_all_chapters__', async (e) => {
    const detail = e.detail || {};
    let bookId = detail.book_id || extractBookIdFromPage();
    if (!bookId) {
      emit('__waka_oak_status__', { msg: 'Không tìm thấy book_id', isError: true });
      emit('__waka_oak_all_chapters__', { chapters: [], error: 'no book_id' });
      return;
    }
    emit('__waka_oak_status__', { msg: 'Đang lấy danh sách toàn bộ chương (book_id=' + bookId + ')...' });
    try {
      const list = await fetchAllChaptersFromApi(bookId);
      if (!list || !list.length) {
        emit('__waka_oak_all_chapters__', { chapters: state.chapters.slice(), book_id: bookId, error: list ? null : 'api fail' });
        emit('__waka_oak_chapters__', { chapters: state.chapters, book_id: bookId });
        return;
      }
      emit('__waka_oak_all_chapters__', { chapters: list, book_id: bookId });
      emit('__waka_oak_chapters__', { chapters: list, book_id: bookId });
      emit('__waka_oak_status__', { msg: 'Đã lấy ' + list.length + ' chương' });
    } catch (err) {
      emit('__waka_oak_status__', { msg: 'Lỗi lấy danh sách: ' + err.message, isError: true });
      emit('__waka_oak_all_chapters__', { chapters: [], error: err.message });
    }
  });

  window.addEventListener('__waka_oak_resolve_opf__', async (e) => {
    const detail = e.detail || {};
    const item_id = detail.item_id;
    if (!item_id) {
      emit('__waka_oak_opf_resolved__', { item_id, error: 'missing item_id' });
      return;
    }
    try {
      const r = await resolveChapterOpf(item_id, detail.content_type, detail.file_version);
      if (r.url) {
        emit('__waka_oak_opf_resolved__', { item_id, url: r.url, via: r.via, name: detail.name });
      } else {
        emit('__waka_oak_opf_resolved__', { item_id, error: r.error, name: detail.name });
      }
    } catch (err) {
      emit('__waka_oak_opf_resolved__', { item_id, error: err.message, name: detail.name });
    }
  });

  // Init device id sớm
  try {
    state.deviceId = getOrCreateDeviceId();
    state.tid = getTid();
    const acc = getAccountFromState();
    if (acc) state.account = acc;
  } catch {}

  console.log('[Waka Oak] interceptor v1.5 — OPF fallback folder±50 + book-scoped cache');
})();
