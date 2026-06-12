// ==UserScript==
// @name         Waka Downloader Vip
// @namespace    https://nguyenphanvn95.github.io/waka/
// @version      4.1.0
// @description  Tải sách nói (MP3) và ebook (EPUB) từ Waka.vn — hỗ trợ nhận diện & nhúng metadata tự động
// @author       Waka DL
// @match        https://waka.vn/sach-noi/*
// @match        https://waka.vn/ebook/*
// @match        https://waka.vn/reader/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

/**
 * Waka Downloader Vip – Userscript Port v4.1.0
 *
 * Kiến trúc:
 *  - Tất cả thư viện (jszip, crypto-js, lame) load từ nguyenphanvn95.github.io/waka/
 *  - Thay chrome.storage → GM_setValue / GM_getValue
 *  - MAIN world code inject qua <script> tag để patch XHR/fetch
 *  - ISOLATED world code chạy trực tiếp trong userscript
 *  - Giao tiếp MAIN ↔ ISOLATED vẫn qua CustomEvent (giữ nguyên)
 */

(function () {
  'use strict';

  const BASE_URL = 'https://nguyenphanvn95.github.io/waka/';
  const PAGE = window.location.pathname;
  const IS_AUDIO  = /\/sach-noi\//i.test(PAGE);
  const IS_EBOOK  = /\/ebook\//i.test(PAGE);
  const IS_READER = /\/reader\//i.test(PAGE);

  // ══════════════════════════════════════════════════════════════
  // 0. STORAGE HELPERS (thay chrome.storage)
  // ══════════════════════════════════════════════════════════════

  const Storage = {
    async set(key, value) {
      GM_setValue(key, JSON.stringify(value));
    },
    async get(key) {
      const raw = GM_getValue(key, null);
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    async remove(key) {
      GM_deleteValue(key);
    },
  };

  // ══════════════════════════════════════════════════════════════
  // 1. INJECT SCRIPT VÀO MAIN WORLD
  // ══════════════════════════════════════════════════════════════

  function injectMainScript(code) {
    const s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  // ══════════════════════════════════════════════════════════════
  // 2. LOAD THƯ VIỆN TỪ GITHUB (không CDN)
  // ══════════════════════════════════════════════════════════════

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Không tải được: ' + src));
      (document.head || document.documentElement).appendChild(s);
    });
  }

  async function loadLibs(libs) {
    for (const lib of libs) {
      await loadScript(BASE_URL + lib);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 3. INTERCEPTOR CODE (MAIN WORLD) – chạy ở document-start
  // ══════════════════════════════════════════════════════════════

  // --- AUDIO interceptor ---
  const AUDIO_INTERCEPTOR_CODE = `(${function () {
  'use strict';
  const PLAYLIST_REGEX = /vegacdn\.vn\/.+?\/playlist\.m3u8/;
  const GET_LIST_AUDIO_RE = /beta-api\.waka\.vn\/fm\/getListAudioFile\b/;
  const NEXT_BACK_AUDIO_RE = /beta-api\.waka\.vn\/fm\/listNextBackFm\b/;
  const DOWNLOAD_ITEM_RE = /beta-api\.waka\.vn\/fm\/getDownloadItem\b/;
  const CHAPTER_LIST_STORAGE_KEY = 'waka.audio.chapterList';

  function emit(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); }
  function emitStreamDetected(url) { emit('__waka_stream__', { playlistUrl: url }); }
  function emitChapterList(payload) { emit('__waka_audio_chapters__', payload); }
  function emitChapterListReady(payload) { emit('__waka_audio_list_ready__', payload); }
  function safeJsonParse(text) { try { return JSON.parse(text); } catch { return null; } }

  function parseQuery(url) {
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://' + url);
      const out = {};
      u.searchParams.forEach((v, k) => { out[k] = v; });
      return out;
    } catch { return {}; }
  }

  function normalizeChapterItem(item, meta) {
    if (!item || typeof item !== 'object') return null;
    const chapterId = item.id ?? item.audio_file_id ?? item.chapter_id ?? null;
    if (!chapterId) return null;
    return {
      id: chapterId, audio_id: item.audio_id ?? meta.audio_id ?? null,
      name: item.name ?? '', description: item.description ?? '',
      zone: item.zone ?? '', order: Number(item.order ?? 0),
      thumb: item.thumb ?? '', duration: Number(item.duration ?? 0),
      created_time: item.created_time ?? '', audio_data: Array.isArray(item.audio_data) ? item.audio_data : [],
      read: item.read ?? null, is_download: item.is_download ?? null,
      parent_price: item.parent_price ?? null, mini_app: item.mini_app ?? null,
      view: item.view ?? null, owner: item.owner ?? null, is_noted: item.is_noted ?? null,
      content_type: item.content_type ?? '', parent_type: item.parent_type ?? '',
      is_summary: item.is_summary ?? null, content_detail_url: item.content_detail_url ?? '',
      in_wishlist: item.in_wishlist ?? null, parent_name: item.parent_name ?? '',
    };
  }

  function extractChapterPayload(text, url) {
    const json = safeJsonParse(text);
    if (!json || json.code !== 0) return null;
    const meta = parseQuery(url);
    const source = GET_LIST_AUDIO_RE.test(url) ? 'getListAudioFile' : 'listNextBackFm';
    const rawData = json.data;
    const items = Array.isArray(rawData) ? rawData : rawData ? [rawData] : [];
    const normalizedItems = items.map(item => normalizeChapterItem(item, meta)).filter(Boolean);
    if (normalizedItems.length === 0) return null;
    return {
      source, content_id: meta.content_id ? Number(meta.content_id) : null,
      chapter_id: meta.chapter_id ? Number(meta.chapter_id) : null,
      action: meta.action || null, page_no: meta.page_no ? Number(meta.page_no) : null,
      page_size: meta.page_size ? Number(meta.page_size) : null,
      total: Number(json.total ?? normalizedItems.length),
      items: normalizedItems, updatedAt: new Date().toISOString(),
    };
  }

  function mergeChapterList(payload) {
    const current = window.__waka_audio_chapter_list__ || { items: [] };
    const map = new Map();
    for (const item of current.items || []) { if (item && item.id != null) map.set(String(item.id), item); }
    for (const item of payload.items || []) { if (item && item.id != null) map.set(String(item.id), item); }
    const mergedItems = Array.from(map.values()).sort((a, b) => {
      const ao = Number(a.order ?? 0), bo = Number(b.order ?? 0);
      if (ao !== bo) return ao - bo;
      return Number(a.id ?? 0) - Number(b.id ?? 0);
    });
    const merged = { ...current, ...payload, items: mergedItems, count: mergedItems.length, updatedAt: payload.updatedAt };
    window.__waka_audio_chapter_list__ = merged;
    try { window.localStorage.setItem(CHAPTER_LIST_STORAGE_KEY, JSON.stringify(merged)); } catch {}
    emitChapterList(merged);
    if (payload.source === 'getListAudioFile') emitChapterListReady(merged);
  }

  if (!window.__waka_playlist_cache__) window.__waka_playlist_cache__ = {};
  if (!window.__waka_chapter_url_cache__) window.__waka_chapter_url_cache__ = {};

  function getChapterCache(chapterId) {
    if (chapterId == null || chapterId === '') return null;
    const key = String(chapterId);
    if (!window.__waka_chapter_url_cache__[key]) window.__waka_chapter_url_cache__[key] = {};
    return window.__waka_chapter_url_cache__[key];
  }

  function storePlaylistUrl(chapterId, playlistUrl, shouldEmitReady) {
    if (chapterId == null || !playlistUrl) return;
    const key = String(chapterId);
    window.__waka_playlist_cache__[key] = playlistUrl;
    const cache = getChapterCache(key);
    if (cache) cache.playlistUrl = playlistUrl;
    if (shouldEmitReady) emit('__waka_playlist_ready__', { chapterId: key, playlistUrl });
  }

  function cacheChapterRequestUrl(requestUrl) {
    if (typeof requestUrl !== 'string' || !requestUrl) return;
    if (!GET_LIST_AUDIO_RE.test(requestUrl) && !NEXT_BACK_AUDIO_RE.test(requestUrl) && !DOWNLOAD_ITEM_RE.test(requestUrl)) return;
    const meta = parseQuery(requestUrl);
    const chapterId = meta.chapter_id ?? meta.audio_file_id ?? meta.content_id ?? null;
    const cache = getChapterCache(chapterId);
    if (!cache) return;
    cache.apiUrl = requestUrl;
    cache.action = meta.action || cache.action || null;
    cache.content_id = meta.content_id ? Number(meta.content_id) : cache.content_id ?? null;
    cache.chapter_id = meta.chapter_id ? Number(meta.chapter_id) : cache.chapter_id ?? null;
  }

  const NativeXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new NativeXHR();
    let _url = '';
    const _open = xhr.open.bind(xhr);
    xhr.open = function (method, url) { _url = typeof url === 'string' ? url : ''; cacheChapterRequestUrl(_url); return _open.apply(xhr, arguments); };
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState !== 4) return;
      if (PLAYLIST_REGEX.test(_url)) emitStreamDetected(_url);
      if (GET_LIST_AUDIO_RE.test(_url) || NEXT_BACK_AUDIO_RE.test(_url)) {
        const chapterPayload = extractChapterPayload(xhr.responseText || '', _url);
        if (chapterPayload) mergeChapterList(chapterPayload);
      }
    });
    return xhr;
  }
  Object.setPrototypeOf(PatchedXHR, NativeXHR);
  Object.setPrototypeOf(PatchedXHR.prototype, NativeXHR.prototype);
  window.XMLHttpRequest = PatchedXHR;

  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    cacheChapterRequestUrl(url);
    const response = await nativeFetch(input, init);
    if (PLAYLIST_REGEX.test(url)) emitStreamDetected(url);
    if (GET_LIST_AUDIO_RE.test(url) || NEXT_BACK_AUDIO_RE.test(url)) {
      const clone = response.clone();
      clone.text().then(text => {
        const chapterPayload = extractChapterPayload(text, url);
        if (chapterPayload) mergeChapterList(chapterPayload);
        cacheChapterApiUrl(text, url);
      }).catch(() => {});
    }
    return response;
  };

  function findPlaylistUrl(obj, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 5) return null;
    for (const f of ['url', 'play_url', 'hls_url', 'stream_url', 'file', 'src', 'link']) {
      const v = obj[f];
      if (typeof v === 'string' && v && (v.includes('.m3u8') || v.includes('vegacdn.vn'))) return v;
    }
    if (Array.isArray(obj.audio_data)) {
      for (const ad of obj.audio_data) { const u = findPlaylistUrl(ad, (depth || 0) + 1); if (u) return u; }
    }
    for (const key of Object.keys(obj)) {
      if (['thumb', 'raw', 'avatar', 'cover', 'image'].includes(key)) continue;
      const val = obj[key];
      if (Array.isArray(val)) { for (const el of val) { if (el && typeof el === 'object') { const u = findPlaylistUrl(el, (depth || 0) + 1); if (u) return u; } } }
      else if (val && typeof val === 'object') { const u = findPlaylistUrl(val, (depth || 0) + 1); if (u) return u; }
    }
    return null;
  }

  function cacheChapterApiUrl(responseText, requestUrl) {
    const json = safeJsonParse(responseText);
    if (!json || json.code !== 0) return;
    const meta = parseQuery(requestUrl);
    const chapterId = meta.chapter_id ?? meta.content_id ?? null;
    const cache = getChapterCache(chapterId);
    if (!cache) return;
    cache.apiUrl = requestUrl;
    cache.action = meta.action || cache.action || null;
    cache.content_id = meta.content_id ? Number(meta.content_id) : cache.content_id ?? null;
    cache.chapter_id = meta.chapter_id ? Number(meta.chapter_id) : cache.chapter_id ?? null;
    const items = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
    for (const item of items) {
      const playlistUrl = findPlaylistUrl(item);
      if (!playlistUrl) continue;
      storePlaylistUrl(chapterId, playlistUrl, true);
      break;
    }
  }

  async function fetchPlaylistViaNuxt(contentId, chapterId, action) {
    const params = new URLSearchParams({ audio_file_id: String(chapterId) });
    const fallbackUrl = 'https://beta-api.waka.vn/fm/getDownloadItem?' + params;
    const resp = await nativeFetch(fallbackUrl, { method: 'GET', mode: 'cors', credentials: 'omit', referrer: 'https://waka.vn/' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (!json || json.code !== 0) throw new Error('API code=' + (json && json.code !== undefined ? json.code : 'unknown'));
    const data = json.data?.data ?? json.data ?? null;
    return findPlaylistUrl(data);
  }

  window.addEventListener('__waka_fetch_playlist__', async function (e) {
    const { reqId, contentId, chapterId, action } = e.detail || {};
    if (!reqId) return;
    const key = String(chapterId);
    const cachedPlaylist = window.__waka_playlist_cache__[key];
    if (cachedPlaylist) { emit('__waka_playlist_result__', { reqId, playlistUrl: cachedPlaylist }); return; }
    const chapterCache = getChapterCache(key) || {};
    if (chapterCache.playlistUrl) {
      storePlaylistUrl(key, chapterCache.playlistUrl, false);
      emit('__waka_playlist_result__', { reqId, playlistUrl: chapterCache.playlistUrl });
      return;
    }
    try {
      const apiUrl = chapterCache.apiUrl;
      let playlistUrl = null;
      if (apiUrl) {
        const resp = await nativeFetch(apiUrl, { method: 'GET', mode: 'cors', credentials: 'omit', referrer: 'https://waka.vn/' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const json = await resp.json();
        if (json.code !== 0) throw new Error('API code=' + json.code);
        const data = json.data?.data ?? json.data ?? null;
        playlistUrl = findPlaylistUrl(data);
      } else {
        playlistUrl = await fetchPlaylistViaNuxt(contentId, chapterId, action);
      }
      if (playlistUrl) storePlaylistUrl(key, playlistUrl, true);
      emit('__waka_playlist_result__', { reqId, playlistUrl });
    } catch (err) {
      emit('__waka_playlist_result__', { reqId, playlistUrl: null, error: err.message });
    }
  });

  console.log('[Waka DL] Audio interceptor ready (userscript).');
}}.toString()})();`;

  // --- EBOOK interceptor ---
  const EBOOK_INTERCEPTOR_CODE = `(${function () {
  'use strict';
  const API_BASE = 'beta-api.waka.vn';
  const ITEM_INFO_RE = /getItemInfo\?/;
  const DOWNLOAD_RE = /getDownloadItemWeb\?/;
  let _capturedParams = null;
  let _downloadCalled = false;

  function emit(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); }

  function parseQuery(url) {
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://' + url);
      const obj = {};
      u.searchParams.forEach((v, k) => { obj[k] = v; });
      return obj;
    } catch { return {}; }
  }

  function extractDownloadUrl(text) {
    try {
      const json = JSON.parse(text);
      const candidates = [
        json?.data?.download_url, json?.data?.url, json?.data?.epub_url,
        json?.data?.file_url, json?.data?.link, json?.download_url,
        json?.url, json?.epub_url, json?.file_url, json?.link,
      ];
      for (const c of candidates) { if (typeof c === 'string' && c.startsWith('http')) return c; }
      const urlMatch = text.match(/"(https?:\/\/[^"]*(?:epub|book|download)[^"]*)"/i);
      if (urlMatch) return urlMatch[1];
      return null;
    } catch { return null; }
  }

  async function callDownloadApi(params) {
    if (_downloadCalled) return;
    _downloadCalled = true;
    const qs = new URLSearchParams({
      os: params.os || 'wap', id: params.id, account: params.account || 'guest',
      item_id: params.item_id, content_type: params.content_type || 'book',
      rf: window.location.href, secure_code: params.secure_code,
    });
    const url = `https://${API_BASE}/super/getDownloadItemWeb?${qs}`;
    emit('__waka_ebook_status__', { msg: `Đang lấy link download... (item_id=${params.item_id})` });
    try {
      const resp = await fetch(url, { credentials: 'omit' });
      const text = await resp.text();
      emit('__waka_ebook_raw__', { raw: text, status: resp.status });
      const downloadUrl = extractDownloadUrl(text);
      if (downloadUrl) emit('__waka_ebook_ready__', { url: downloadUrl, itemId: params.item_id });
      else emit('__waka_ebook_status__', { msg: `getDownloadItemWeb (${resp.status}): ${text.slice(0, 200)}`, isError: true });
    } catch (err) {
      emit('__waka_ebook_status__', { msg: `Lỗi gọi API: ${err.message}`, isError: true });
      _downloadCalled = false;
    }
  }

  const NativeXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new NativeXHR();
    let _url = '';
    const _open = xhr.open.bind(xhr);
    xhr.open = function (method, url) { _url = typeof url === 'string' ? url : ''; return _open.apply(xhr, arguments); };
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState !== 4) return;
      handleResponse(_url, xhr.responseText || '');
    });
    return xhr;
  }
  Object.setPrototypeOf(PatchedXHR, NativeXHR);
  Object.setPrototypeOf(PatchedXHR.prototype, NativeXHR.prototype);
  window.XMLHttpRequest = PatchedXHR;

  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const resp = await nativeFetch(input, init);
    if (url.includes(API_BASE)) { const clone = resp.clone(); clone.text().then(text => handleResponse(url, text)).catch(() => {}); }
    return resp;
  };

  function handleResponse(url, responseText) {
    if (!url.includes(API_BASE)) return;
    if (ITEM_INFO_RE.test(url) && !_capturedParams) {
      const params = parseQuery(url);
      if (params.item_id && params.secure_code) {
        _capturedParams = params;
        emit('__waka_ebook_status__', { msg: `Phát hiện sách ID=${params.item_id}. Đang lấy link...` });
        callDownloadApi(params);
      }
    }
    if (DOWNLOAD_RE.test(url)) {
      const downloadUrl = extractDownloadUrl(responseText);
      if (downloadUrl) emit('__waka_ebook_ready__', { url: downloadUrl });
      else emit('__waka_ebook_raw__', { raw: responseText });
    }
  }

  console.log('[Waka DL] Ebook interceptor ready (userscript).');
}}.toString()})();`;

  // --- READER interceptor ---
  const READER_INTERCEPTOR_CODE = `(${function () {
  'use strict';
  function emit(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); }
  function resolveUrl(href, base) {
    if (/^https?:\/\//.test(href)) return href;
    try { return new URL(href, base).href; } catch { return base.replace(/\/$/, '') + '/' + href; }
  }

  function tryReadNuxt() {
    try {
      const nuxt = window.__NUXT__;
      if (!nuxt) return false;
      const raw = JSON.stringify(nuxt);
      const m = raw.match(/"epub_url"\s*:\s*"(https?:[^"]+)"/);
      if (!m) return false;
      const url = m[1].replace(/\\u002F/g, '/');
      const tm = raw.match(/"title"\s*:\s*"([^"]+)"/);
      const title = tm ? tm[1] : (document.title || 'Ebook');
      emit('__waka_epub_found__', { url, title });
      return true;
    } catch { return false; }
  }

  if (!tryReadNuxt()) { [300, 800, 1500, 3000].forEach(ms => setTimeout(tryReadNuxt, ms)); }

  window.addEventListener('__waka_do_download__', async (e) => {
    try { await fetchAllEpubFiles(e.detail.opfUrl); }
    catch (err) { emit('__waka_epub_error__', { msg: err.message }); }
  });

  async function fetchAllEpubFiles(opfUrl) {
    const [opfPath, qs] = opfUrl.split('?');
    const token = qs ? '?' + qs : '';
    const oebpsDir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
    emit('__waka_epub_progress__', { msg: 'Tải content.opf...' });

    let opfResp = await fetch(opfUrl, { credentials: 'omit' });
    if (!opfResp.ok) opfResp = await fetch(opfUrl, { credentials: 'include' });
    if (!opfResp.ok) throw new Error('content.opf HTTP ' + opfResp.status);
    const opfText = await opfResp.text();
    if (!opfText.includes('<manifest')) throw new Error('OPF không hợp lệ');
    emit('__waka_epub_opf__', { text: opfText, oebpsDir });

    const parser = new DOMParser();
    const doc = parser.parseFromString(opfText, 'application/xml');
    const items = [];
    doc.querySelectorAll('manifest item').forEach(el => {
      const href = el.getAttribute('href');
      if (href) items.push({ href, type: el.getAttribute('media-type') || '' });
    });
    emit('__waka_epub_progress__', { msg: 'Phát hiện ' + items.length + ' files...', total: items.length, done: 0 });

    const jsItems = items.filter(i => i.href.includes('/js/jquery0') || /jquery\d+\.js/.test(i.href));
    const contentItems = items.filter(i => !jsItems.includes(i));
    const decryptScripts = {};

    for (const item of jsItems) {
      try {
        const url = resolveUrl(item.href, oebpsDir) + token;
        let resp = await fetch(url, { credentials: 'omit' });
        if (!resp.ok) resp = await fetch(url, { credentials: 'include' });
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          const text = new TextDecoder().decode(buf);
          decryptScripts[item.href] = text;
          emit('__waka_decrypt_script__', { href: item.href, script: text });
        }
      } catch {}
    }

    let done = 0, failed = 0;
    const BATCH = 5;
    for (let i = 0; i < contentItems.length; i += BATCH) {
      await Promise.all(contentItems.slice(i, i + BATCH).map(async (item) => {
        const url = resolveUrl(item.href, oebpsDir) + token;
        try {
          let resp = await fetch(url, { credentials: 'omit' });
          if (!resp.ok) resp = await fetch(url, { credentials: 'include' });
          if (!resp.ok) {
            if (item.href.includes('toc.ncx') || resp.status === 404) return;
            throw new Error('HTTP ' + resp.status);
          }
          const buf = await resp.arrayBuffer();
          let finalBuf = buf;
          if (item.href.includes('.xhtml') || item.href.includes('.html')) {
            const text = new TextDecoder().decode(buf);
            if (isEncrypted(text)) {
              const decrypted = tryDecrypt(text, decryptScripts, token);
              if (decrypted) finalBuf = new TextEncoder().encode(decrypted).buffer;
            }
          }
          emit('__waka_epub_file__', { href: item.href, buffer: finalBuf });
          done++;
        } catch {
          failed++;
        }
        emit('__waka_epub_progress__', { msg: 'Tải ' + (done + failed) + '/' + contentItems.length + ' — OK:' + done + ' Lỗi:' + failed, done, failed, total: contentItems.length });
      }));
    }
    emit('__waka_epub_done__', { done, failed, total: contentItems.length });
  }

  function isEncrypted(xhtmlText) {
    const bodyMatch = xhtmlText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) return false;
    const bodyContent = bodyMatch[1].trim();
    return /^[A-Za-z0-9+\/\s=]+$/.test(bodyContent) && bodyContent.length > 100;
  }

  function tryDecrypt(xhtmlText, scripts, token) {
    const bodyMatch = xhtmlText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) return null;
    const encrypted = bodyMatch[1].trim().replace(/\s/g, '');
    emit('__waka_encrypted_chapter__', { preview: encrypted.slice(0, 200), scriptsAvailable: Object.keys(scripts) });
    if (Object.keys(scripts).length > 0) {
      const allScript = Object.values(scripts).join('\n');
      const keyMatch = allScript.match(/['"](([0-9a-f]{32,64}))['"]/i);
      if (keyMatch) emit('__waka_decrypt_key_found__', { key: keyMatch[1], encrypted: encrypted.slice(0, 200) });
    }
    return null;
  }

  console.log('[Waka DL] Reader interceptor ready (userscript).');
}}.toString()})();`;

  // ══════════════════════════════════════════════════════════════
  // 4. INJECT INTERCEPTOR VÀO MAIN WORLD (document-start)
  // ══════════════════════════════════════════════════════════════

  if (IS_AUDIO) injectMainScript(AUDIO_INTERCEPTOR_CODE);
  if (IS_EBOOK) injectMainScript(EBOOK_INTERCEPTOR_CODE);
  if (IS_READER) injectMainScript(READER_INTERCEPTOR_CODE);

  // ══════════════════════════════════════════════════════════════
  // 5. METADATA INJECTOR (thay chrome.storage bằng GM_*)
  // ══════════════════════════════════════════════════════════════

  const STORAGE_KEY_META = 'wakaMetadata';

  window.WakaMetaInjector = (() => {
    async function getMeta() { return await Storage.get(STORAGE_KEY_META); }
    async function hasMeta() { const m = await getMeta(); return !!(m && m.title); }
    async function clearMeta() { await Storage.remove(STORAGE_KEY_META); }
    async function saveMeta(meta) { await Storage.set(STORAGE_KEY_META, meta); }

    async function fetchCoverAsArrayBuffer(url) {
      if (!url) return null;
      try {
        const resp = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        if (!resp.ok) return null;
        return await resp.arrayBuffer();
      } catch { return null; }
    }

    function guessMimeType(url) {
      if (/\.png(\?|$)/i.test(url)) return 'image/png';
      if (/\.gif(\?|$)/i.test(url)) return 'image/gif';
      if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
      return 'image/jpeg';
    }

    function xmlEsc(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function patchOpf(opfText, meta, hasCover) {
      const dcMeta = [];
      dcMeta.push(`    <dc:identifier id="uid">waka-${Date.now()}</dc:identifier>`);
      if (meta.title) dcMeta.push(`    <dc:title>${xmlEsc(meta.title)}</dc:title>`);
      dcMeta.push(`    <dc:language>${xmlEsc(meta.language || 'vi')}</dc:language>`);
      (meta.authors || []).forEach(a => { dcMeta.push(`    <dc:creator>${xmlEsc(a)}</dc:creator>`); });
      if (meta.publisher) dcMeta.push(`    <dc:publisher>${xmlEsc(meta.publisher)}</dc:publisher>`);
      if (meta.pubdate) dcMeta.push(`    <dc:date>${xmlEsc(meta.pubdate)}</dc:date>`);
      if (meta.comments) dcMeta.push(`    <dc:description>${xmlEsc(meta.comments)}</dc:description>`);
      (meta.tags || []).forEach(t => { dcMeta.push(`    <dc:subject>${xmlEsc(t)}</dc:subject>`); });
      if (meta.source_url) dcMeta.push(`    <dc:source>${xmlEsc(meta.source_url)}</dc:source>`);
      dcMeta.push(`    <meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta>`);
      if (hasCover) dcMeta.push(`    <meta name="cover" content="wdl-cover-image"/>`);
      const metadataBlock = `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${dcMeta.join('\n')}\n  </metadata>`;
      let patched = opfText.replace(/<metadata[\s\S]*?<\/metadata>/i, metadataBlock);
      if (hasCover) {
        const coverItem = `<item id="wdl-cover-image" href="wdl-cover.jpg" media-type="image/jpeg"/>`;
        if (!patched.includes('wdl-cover-image')) patched = patched.replace(/<manifest>/i, `<manifest>\n    ${coverItem}`);
      }
      return patched;
    }

    async function injectIntoBlob(epubBlob) {
      const meta = await getMeta();
      if (!meta || !meta.title) return epubBlob;
      if (typeof JSZip === 'undefined') return epubBlob;

      const zip = await JSZip.loadAsync(epubBlob);
      let opfPath = null;
      const containerXmlFile = zip.file('META-INF/container.xml');
      if (containerXmlFile) {
        const containerXml = await containerXmlFile.async('text');
        const m = containerXml.match(/full-path="([^"]+)"/);
        if (m) opfPath = m[1];
      }
      if (!opfPath) { zip.forEach((path) => { if (!opfPath && path.endsWith('.opf')) opfPath = path; }); }
      if (!opfPath) return epubBlob;

      const opfFile = zip.file(opfPath) || zip.file('OEBPS/' + opfPath);
      if (!opfFile) return epubBlob;

      let opfText = await opfFile.async('text');
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      let coverBuf = null;
      if (meta.cover) coverBuf = await fetchCoverAsArrayBuffer(meta.cover);

      const patchedOpf = patchOpf(opfText, meta, !!coverBuf);
      zip.file(opfPath, patchedOpf);
      if (coverBuf) zip.file(opfDir + 'wdl-cover.jpg', coverBuf);

      return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    }

    return { injectIntoBlob, hasMeta, getMeta, clearMeta, saveMeta };
  })();

  // ══════════════════════════════════════════════════════════════
  // 6. EPUB DECODE (giữ nguyên từ epub-decode.js)
  // ══════════════════════════════════════════════════════════════

  window.WakaEpubDecode = (() => {
    function toTextSync(input) {
      if (typeof input === 'string') return input;
      if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
      if (ArrayBuffer.isView(input)) return new TextDecoder().decode(input);
      return String(input ?? '');
    }
    function isWrappedJson(text) {
      const trimmed = String(text || '').trim();
      return trimmed.startsWith('{') && trimmed.includes('"cd"') && trimmed.includes('"wd"');
    }
    function decodeWrappedJson(text) {
      const trimmed = String(text ?? '').trim();
      if (!isWrappedJson(trimmed)) return trimmed;
      if (typeof CryptoJS === 'undefined') throw new Error('CryptoJS not loaded');
      const data = JSON.parse(trimmed);
      if (!data.wd || !data.cd || !data.sw || !data.sd) return trimmed;
      const keyStr = String(data.wd) + 'a|w8' + String(data.sw) + String(data.sd);
      const key = CryptoJS.enc.Utf8.parse(keyStr);
      const ciphertext = CryptoJS.enc.Base64.parse(String(data.cd));
      const decrypted = CryptoJS.AES.decrypt({ ciphertext }, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 });
      const plain = decrypted.toString(CryptoJS.enc.Utf8);
      if (!plain) throw new Error('Decode failed: empty plaintext');
      return plain;
    }
    function decodeFileSync(input) { return decodeWrappedJson(toTextSync(input)); }
    function extractTitleFromOpf(opfText, fallbackTitle = 'waka-ebook') {
      const raw = String(opfText || '');
      const titleMatch = raw.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) || raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (!titleMatch) return fallbackTitle;
      return titleMatch[1].replace(/<!--\[CDATA\[([\s\S]*?)\]\]-->/g, '$1').replace(/<[^>]+>/g, '').trim() || fallbackTitle;
    }
    function safeName(s) {
      return String(s || 'waka-ebook').replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, '_').slice(0, 100);
    }
    function normalizeFileName(name) { return String(name || '').replace(/^\/+/, ''); }
    return { toTextSync, decodeWrappedJson, decodeFileSync, extractTitleFromOpf, safeName, normalizeFileName };
  })();

  // ══════════════════════════════════════════════════════════════
  // 7. EPUB BUILDER (giữ nguyên từ epub-builder.js)
  // ══════════════════════════════════════════════════════════════

  window.EPUBBuilder = (() => {
    function xmlEscape(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function containerXml() {
      return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    }
    function mimetype() { return 'application/epub+zip'; }
    function normalizeFileName(name) { return String(name || '').replace(/^\/+/, ''); }
    function addFile(zipFolder, name, content) {
      const safeName = normalizeFileName(name);
      if (!safeName) return;
      zipFolder.file(safeName, content);
    }
    function generateNcxFromTocXhtml(bookTitle, tocXhtml, tocBaseDir, fallbackFiles) {
      const entries = [];
      const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(tocXhtml)) !== null) {
        const href = (tocBaseDir + m[1]).replace(/^\/+/, '');
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        if (title) entries.push({ href, title });
      }
      const navPoints = (entries.length > 0 ? entries : fallbackFiles).map((e, i) =>
        `  <navPoint id="np${i}" playOrder="${i + 1}">
    <navLabel><text>${xmlEscape(e.title || e.href)}</text></navLabel>
    <content src="${xmlEscape(e.href)}"/>
  </navPoint>`
      ).join('\n');
      return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="waka-book"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
  <docTitle><text>${xmlEscape(bookTitle)}</text></docTitle>
  <navMap>${navPoints}</navMap>
</ncx>`;
    }

    async function buildFromFiles(bookTitle, opfText, files) {
      if (!opfText || !String(opfText).trim()) throw new Error('content.opf is missing');
      const zip = new JSZip();
      zip.file('mimetype', mimetype(), { compression: 'STORE' });
      zip.file('META-INF/container.xml', containerXml());
      const oebps = zip.folder('OEBPS');
      addFile(oebps, 'content.opf', opfText);
      const entries = files instanceof Map ? Array.from(files.entries()) : Array.isArray(files) ? files : Object.entries(files || {});
      for (const entry of entries) {
        const href = Array.isArray(entry) ? entry[0] : entry.href;
        const value = Array.isArray(entry) ? entry[1] : entry.content;
        if (!href) continue;
        if (normalizeFileName(href) === 'content.opf') continue;
        addFile(oebps, href, value);
      }
      const hasTocNcx = entries.some(entry => { const href = Array.isArray(entry) ? entry[0] : entry.href; return normalizeFileName(href) === 'toc.ncx'; });
      if (!hasTocNcx) {
        const tocEntry = entries.find(entry => { const href = Array.isArray(entry) ? entry[0] : entry.href; return /(^|\/)toc\.xhtml$/i.test(normalizeFileName(href)); });
        const tocHref = tocEntry ? (Array.isArray(tocEntry) ? tocEntry[0] : tocEntry.href) : '';
        const tocBaseDir = tocHref ? normalizeFileName(tocHref).replace(/[^/]+$/, '') : '';
        const tocXhtml = tocEntry ? (Array.isArray(tocEntry) ? tocEntry[1] : tocEntry.content) : '';
        const fallbackFiles = entries.map(entry => (Array.isArray(entry) ? entry[0] : entry.href)).filter(href => /\.xhtml?$/i.test(String(href)) && !/(^|\/)toc\.xhtml$/i.test(String(href))).map(href => ({ href: normalizeFileName(href), title: String(href).split('/').pop().replace(/\.xhtml?$/i, '') }));
        addFile(oebps, 'toc.ncx', generateNcxFromTocXhtml(bookTitle, String(tocXhtml || ''), tocBaseDir, fallbackFiles));
      }
      return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    }

    return { buildFromFiles };
  })();

  // ══════════════════════════════════════════════════════════════
  // 8. HLS PARSER + DOWNLOADER + MP3 ENCODER
  //    (copy nguyên từ hls-parser.js, downloader.js, mp3-encoder.js)
  // ══════════════════════════════════════════════════════════════

  window.HLSParser = (() => {
    function resolveUrl(relativeUrl, baseUrl) {
      if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
      try { return new URL(relativeUrl, baseUrl).href; } catch { return baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1) + relativeUrl; }
    }
    function parseMasterPlaylist(text, baseUrl) {
      const lines = text.split('\n').map(l => l.trim());
      const variants = [];
      let pendingBandwidth = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('#EXT-X-STREAM-INF:')) { const bwMatch = line.match(/BANDWIDTH=(\d+)/i); pendingBandwidth = bwMatch ? parseInt(bwMatch[1]) : 0; continue; }
        if (!line.startsWith('#') && line.length > 0 && pendingBandwidth > 0) { variants.push({ url: resolveUrl(line, baseUrl), bandwidth: pendingBandwidth }); pendingBandwidth = 0; }
      }
      if (variants.length === 0) { for (const line of lines) { if (!line.startsWith('#') && line.includes('.m3u8')) return resolveUrl(line, baseUrl); } return null; }
      return variants[0].url;
    }
    function parseChunklist(text, baseUrl) {
      const lines = text.split('\n').map(l => l.trim());
      const segments = [];
      let currentKey = null;
      let seq = 0;
      for (const line of lines) {
        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { seq = parseInt(line.split(':')[1]) || 0; continue; }
        if (line.startsWith('#EXT-X-KEY:')) {
          const method = (line.match(/METHOD=([^,\s]+)/i)?.[1] || 'NONE').toUpperCase();
          if (method === 'NONE') { currentKey = null; continue; }
          const uri = line.match(/URI="([^"]+)"/i)?.[1];
          const iv = line.match(/IV=0x([0-9a-fA-F]+)/i)?.[1]?.padStart(32, '0');
          currentKey = { method, uri: uri ? resolveUrl(uri, baseUrl) : null, iv };
          continue;
        }
        if (!line.startsWith('#') && line.length > 0) {
          segments.push({ url: resolveUrl(line, baseUrl), key: currentKey ? { ...currentKey } : null, sequenceNumber: seq });
          seq++;
        }
      }
      return segments;
    }
    return { resolveUrl, parseMasterPlaylist, parseChunklist };
  })();

  window.HLSDownloader = (() => {
    let _onProgress = null, _onStatus = null;
    function setCallbacks(onProgress, onStatus) { _onProgress = onProgress; _onStatus = onStatus; }
    function reportProgress(current, total, msg) { if (_onProgress) _onProgress(current, total, msg); }
    function reportStatus(msg) { if (_onStatus) _onStatus(msg); }

    async function fetchArrayBuffer(url) {
      const resp = await fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} khi tải: ${url}`);
      return resp.arrayBuffer();
    }
    async function fetchText(url) {
      const resp = await fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} khi tải playlist`);
      return resp.text();
    }
    const _keyCache = {};
    async function fetchKey(keyUrl) {
      if (!_keyCache[keyUrl]) _keyCache[keyUrl] = await fetchArrayBuffer(keyUrl);
      return _keyCache[keyUrl];
    }
    function seqToIv(seq) {
      const iv = new Uint8Array(16);
      let n = seq;
      for (let i = 15; i >= 0; i--) { iv[i] = n & 0xff; n = Math.floor(n / 256); }
      return iv;
    }
    function hexToIv(hex) { return Uint8Array.from(hex.padStart(32, '0').match(/../g).map(x => parseInt(x, 16))); }
    async function decryptSegment(encryptedBuffer, keyInfo, sequenceNumber) {
      const keyBuffer = await fetchKey(keyInfo.uri);
      const iv = keyInfo.iv ? hexToIv(keyInfo.iv) : seqToIv(sequenceNumber);
      const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-CBC' }, false, ['decrypt']);
      return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, encryptedBuffer);
    }
    async function downloadAll(playlistUrl) {
      reportStatus('Đang phân tích playlist...');
      const masterText = await fetchText(playlistUrl);
      const chunklistUrl = HLSParser.parseMasterPlaylist(masterText, playlistUrl) || playlistUrl;
      reportStatus('Đang tải chunklist...');
      const chunklistText = await fetchText(chunklistUrl);
      const segments = HLSParser.parseChunklist(chunklistText, chunklistUrl);
      if (segments.length === 0) throw new Error('Không tìm thấy segment nào trong playlist');
      reportStatus(`Chuẩn bị tải ${segments.length} segments...`);
      const downloadedSegments = [];
      for (let i = 0; i < segments.length; i++) {
        reportProgress(i + 1, segments.length, `Tải segment ${i + 1}/${segments.length}...`);
        const segment = segments[i];
        const encBuffer = await fetchArrayBuffer(segment.url);
        if (segment.key && segment.key.method === 'AES-128') {
          const decBuffer = await decryptSegment(encBuffer, segment.key, segment.sequenceNumber);
          downloadedSegments.push(new Uint8Array(decBuffer));
        } else {
          downloadedSegments.push(new Uint8Array(encBuffer));
        }
      }
      reportStatus('Ghép các segment...');
      const totalLength = downloadedSegments.reduce((sum, seg) => sum + seg.length, 0);
      const mergedBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const seg of downloadedSegments) { mergedBuffer.set(seg, offset); offset += seg.length; }
      return mergedBuffer;
    }
    return { setCallbacks, downloadAll };
  })();

  window.MP3Encoder = (() => {
    let _onStatus = null, _onProgress = null;
    function setCallbacks(onStatus, onProgress) { _onStatus = onStatus; _onProgress = onProgress; }
    function status(msg) { if (_onStatus) _onStatus(msg); }
    function progress(pct, msg) { if (_onProgress) _onProgress(pct, msg); }
    function float32ToInt16(float32) {
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const clamped = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      return int16;
    }
    function concatUint8Arrays(arrays) {
      const total = arrays.reduce((s, a) => s + a.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const arr of arrays) { out.set(arr, off); off += arr.length; }
      return out;
    }
    async function encode(aacData, audioCtx) {
      status('Đang decode AAC...');
      let audioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(aacData.buffer.slice(0));
      } catch {
        status('Không thể decode, lưu dạng AAC...');
        return { blob: new Blob([aacData], { type: 'audio/aac' }), ext: 'aac' };
      }
      if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
        status('lamejs không có, lưu dạng AAC...');
        return { blob: new Blob([aacData], { type: 'audio/aac' }), ext: 'aac' };
      }
      const sampleRate = audioBuffer.sampleRate;
      const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
      const bitRate = 128;
      const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitRate);
      const mp3Data = [];
      const CHUNK_SIZE = 1152;
      const leftChannel = float32ToInt16(audioBuffer.getChannelData(0));
      const rightChannel = numChannels > 1 ? float32ToInt16(audioBuffer.getChannelData(1)) : leftChannel;
      const totalChunks = Math.ceil(leftChannel.length / CHUNK_SIZE);
      for (let i = 0; i < leftChannel.length; i += CHUNK_SIZE) {
        const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
        progress(Math.round((chunkNum / totalChunks) * 100), `Encode ${chunkNum}/${totalChunks}...`);
        const leftChunk = leftChannel.subarray(i, i + CHUNK_SIZE);
        const rightChunk = rightChannel.subarray(i, i + CHUNK_SIZE);
        const mp3buf = numChannels > 1 ? encoder.encodeBuffer(leftChunk, rightChunk) : encoder.encodeBuffer(leftChunk);
        if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
        await new Promise(r => setTimeout(r, 0));
      }
      const final = encoder.flush();
      if (final.length > 0) mp3Data.push(new Int8Array(final));
      const blob = new Blob(mp3Data, { type: 'audio/mp3' });
      return { blob, ext: 'mp3' };
    }
    return { setCallbacks, encode };
  })();

  // ══════════════════════════════════════════════════════════════
  // 9. BOOK METADATA EXTRACTOR
  // ══════════════════════════════════════════════════════════════

  function extractAndSaveBookMetadata() {
    if (!IS_EBOOK) return;

    function readNuxtData() {
      try {
        const nuxt = window.__NUXT__;
        if (!nuxt?.data?.[0]) return null;
        const d = nuxt.data[0];
        const info = d.ebookInfo || d.bookInfo || d.book || null;
        if (!info) return null;
        function decodeHtml(html) {
          if (!html) return '';
          const el = document.createElement('div');
          el.innerHTML = html;
          return (el.innerText || el.textContent || '').trim();
        }
        const result = {
          title: info.title || '', authors: [], publisher: '', pubdate: '', pubdate_raw: '',
          tags: [], comments: decodeHtml(info.description || ''), language: 'vi',
          cover: '', source_url: window.location.href,
        };
        if (info.authors_json) { try { const arr = JSON.parse(info.authors_json); result.authors = arr.map(a => a.name || a).filter(Boolean); } catch {} }
        if (result.authors.length === 0) { const raw = info.author_name || info.author || ''; if (raw) result.authors = raw.split(/\s*[&,]\s*/).map(a => a.trim()).filter(Boolean); }
        if (Array.isArray(info.publishing_houses) && info.publishing_houses.length) result.publisher = info.publishing_houses[0].name || '';
        if (!result.publisher) result.publisher = info.publisher_name || info.publisher || '';
        const tagRaw = info.category_name || info.genre || info.category || '';
        if (tagRaw) result.tags = tagRaw.split(/\s*[,;]\s*/).map(t => t.trim()).filter(Boolean);
        const dateRaw = info.published_time || info.publish_date || info.published_date || '';
        result.pubdate_raw = dateRaw;
        if (dateRaw) {
          const m = dateRaw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
          if (m) result.pubdate = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
          else { const m2 = dateRaw.match(/(\d{1,2})[\/\-](\d{4})/); if (m2) result.pubdate = `${m2[2]}-${m2[1].padStart(2, '0')}-01`; }
        }
        result.cover = info.image_url || info.thumbnail || info.cover_url || info.img || '';
        if (!result.cover && info.id) result.cover = `https://307a0e78.vws.vegacdn.vn/view/v2/image/img.book/0/0/1/${info.id}.jpg?v=1&w=480&h=700`;
        return result;
      } catch { return null; }
    }

    async function doExtract() {
      const nuxt = readNuxtData();
      if (nuxt && nuxt.title) {
        await WakaMetaInjector.saveMeta(nuxt);
        console.log('[Waka DL] Metadata auto-saved:', nuxt.title);
        return;
      }
    }

    setTimeout(doExtract, 1500);
  }

  // ══════════════════════════════════════════════════════════════
  // 10. AUDIO CONTENT (tương đương content.js + patch v3.6)
  // ══════════════════════════════════════════════════════════════

  function initAudioContent() {
    const CHAPTER_LIST_STORAGE_KEY = 'waka.audio.chapterList';
    let detectedPlaylistUrl = null;
    let chapterListPayload = loadStoredChapterList();
    let hasFullChapterList = !!(chapterListPayload && chapterListPayload.source === 'getListAudioFile');
    let isDownloading = false;
    let mutationTimer = null;

    function loadStoredChapterList() {
      try {
        const raw = window.localStorage.getItem(CHAPTER_LIST_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.items)) return null;
        return parsed;
      } catch { return null; }
    }

    function persistChapterList(payload) { try { window.localStorage.setItem(CHAPTER_LIST_STORAGE_KEY, JSON.stringify(payload)); } catch {} }
    function isRelevantPage() { return /\/sach-noi\//i.test(window.location.pathname) || /\/podcast\//i.test(window.location.pathname); }

    window.addEventListener('__waka_stream__', (e) => {
      const url = e.detail && e.detail.playlistUrl;
      if (!url) return;
      detectedPlaylistUrl = url;
      const btn = document.getElementById('waka-dl-btn');
      if (btn) activateAudioButton(btn);
    });

    window.addEventListener('__waka_audio_chapters__', (e) => {
      const payload = e.detail;
      if (!payload || !Array.isArray(payload.items)) return;
      chapterListPayload = payload;
      persistChapterList(payload);
      if (shouldShowChapterButton()) ensureDownloadAllButton();
    });

    window.addEventListener('__waka_audio_list_ready__', (e) => {
      const payload = e.detail;
      if (!payload || !Array.isArray(payload.items)) return;
      hasFullChapterList = true;
      chapterListPayload = payload;
      persistChapterList(payload);
      ensureDownloadAllButton();
    });

    function getBookTitle() {
      return document.querySelector('h1')?.textContent?.trim() || document.title || 'waka-audio';
    }
    function safeFileName(name) {
      return String(name || 'waka-audio').replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, '_').substring(0, 100);
    }

    function applyAudioButtonStyle(btn, active) {
      btn.style.cssText = [
        'display:inline-flex', 'align-items:center', 'gap:6px', 'padding:8px 18px',
        `background:${active ? '#e94560' : '#555'}`, 'color:#fff', 'border:none',
        'border-radius:24px', 'font-size:13px', 'font-weight:600',
        `cursor:${active ? 'pointer' : 'default'}`, 'margin:6px 0 6px 10px',
        'transition:background 0.25s, opacity 0.2s', `opacity:${active ? '1' : '0.6'}`, 'flex-shrink:0',
      ].join(';');
      btn.title = active ? 'Tải audio này về máy (MP3)' : 'Nhấn Nghe sách trước để phát hiện audio';
      btn.innerHTML = 'Download MP3';
    }

    function activateAudioButton(btn) {
      applyAudioButtonStyle(btn, true);
      btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.82'; });
      btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
    }

    function createAudioButton() {
      const btn = document.createElement('button');
      btn.id = 'waka-dl-btn';
      applyAudioButtonStyle(btn, false);
      btn.addEventListener('click', handleDownloadClick);
      return btn;
    }

    function injectButtons() {
      let anchor = null;
      const candidates = document.querySelectorAll('button, a, [role="button"], [aria-label], [class*="play" i], [class*="nghe" i]');
      for (const el of candidates) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const cls = (el.className || '').toString();
        const hasPlayIcon = !!el.querySelector('img[alt*="play" i], img[src*="icon-play" i], img[src*="play-o" i]');
        if (text.includes('Nghe sách') || text.includes('Nghe audio') || text === 'Nghe' || /nghe/i.test(text) || /nghe/i.test(aria) || /play/i.test(aria) || /play/i.test(cls) || hasPlayIcon) {
          anchor = el; break;
        }
      }
      if (!anchor) return;
      const host = anchor.parentNode || anchor;
      const existingAudioBtn = document.getElementById('waka-dl-btn');
      if (!existingAudioBtn) {
        const audioBtn = createAudioButton();
        if (detectedPlaylistUrl) activateAudioButton(audioBtn);
        host.insertBefore(audioBtn, anchor.nextSibling);
      } else if (detectedPlaylistUrl) {
        activateAudioButton(existingAudioBtn);
      }
      if (shouldShowChapterButton()) ensureDownloadAllButton();
    }

    function shouldShowChapterButton() {
      return hasFullChapterList || (chapterListPayload && Array.isArray(chapterListPayload.items) && chapterListPayload.items.length > 0);
    }

    function ensureProgressUI() {
      let ui = document.getElementById('waka-dl-overlay');
      if (ui) return ui;
      ui = document.createElement('div');
      ui.id = 'waka-dl-overlay';
      ui.style.cssText = [
        'position:fixed', 'bottom:20px', 'right:20px', 'width:310px',
        'background:#15151e', 'color:#e8e8e8', 'border-radius:14px',
        'padding:18px 20px', 'box-shadow:0 6px 28px rgba(0,0,0,0.5)',
        'font-family:system-ui,sans-serif', 'font-size:13px', 'z-index:2147483647', 'display:none',
      ].join(';');
      ui.innerHTML = `
        <div style="font-weight:700;font-size:14px;color:#e94560;margin-bottom:10px">Waka Audio Downloader</div>
        <div id="waka-dl-status-text" style="margin-bottom:10px;line-height:1.5">Đang khởi động...</div>
        <div style="background:#2a2a3a;border-radius:6px;height:7px;overflow:hidden">
          <div id="waka-dl-bar" style="width:0%;height:100%;background:#e94560;transition:width 0.4s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;color:#888;font-size:11px">
          <span id="waka-dl-pct">0%</span><span id="waka-dl-eta"></span>
        </div>
      `;
      document.body.appendChild(ui);
      return ui;
    }

    function showOverlay(msg) {
      const ui = ensureProgressUI();
      document.getElementById('waka-dl-status-text').textContent = msg;
      document.getElementById('waka-dl-bar').style.width = '0%';
      document.getElementById('waka-dl-pct').textContent = '0%';
      ui.style.display = 'block';
    }
    function updateOverlayProgress(current, total, msg) {
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      const bar = document.getElementById('waka-dl-bar');
      const pctEl = document.getElementById('waka-dl-pct');
      const statusEl = document.getElementById('waka-dl-status-text');
      if (bar) bar.style.width = pct + '%';
      if (pctEl) pctEl.textContent = pct + '%';
      if (statusEl && msg) statusEl.textContent = msg;
    }
    function updateOverlayStatus(msg) { const el = document.getElementById('waka-dl-status-text'); if (el) el.textContent = msg; }
    function hideOverlayAfter(ms) { setTimeout(() => { const ui = document.getElementById('waka-dl-overlay'); if (ui) ui.style.display = 'none'; }, ms); }
    function triggerDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = Object.assign(document.createElement('a'), { href: url, download: filename, style: 'display:none' });
      document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }

    async function handleDownloadClick() {
      if (isDownloading) return;
      if (!detectedPlaylistUrl) {
        alert('Hãy nhấn nút "Nghe sách" trên trang trước để phát hiện audio stream rồi thử lại!');
        return;
      }
      isDownloading = true;
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const btn = document.getElementById('waka-dl-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'default'; btn.innerHTML = 'Đang tải...'; }
      showOverlay('Khởi tạo...');
      HLSDownloader.setCallbacks(
        (current, total, msg) => updateOverlayProgress(current, total, msg),
        (msg) => updateOverlayStatus(msg)
      );
      MP3Encoder.setCallbacks(
        (msg) => updateOverlayStatus(msg),
        (pct, msg) => { updateOverlayProgress(pct, 100, msg); }
      );
      try {
        const aacData = await HLSDownloader.downloadAll(detectedPlaylistUrl);
        updateOverlayStatus('Đang encode sang MP3...');
        const { blob, ext } = await MP3Encoder.encode(aacData, audioCtx);
        const filename = `${safeFileName(getBookTitle())}.${ext}`;
        triggerDownload(blob, filename);
        updateOverlayStatus(`Đã lưu: ${filename}`);
        updateOverlayProgress(100, 100, `Hoàn tất! File: ${filename}`);
        hideOverlayAfter(5000);
        if (btn) { btn.disabled = false; btn.innerHTML = 'Đã tải'; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.style.background = '#28a745'; }
      } catch (err) {
        console.error('[Waka DL] Error:', err);
        updateOverlayStatus('Lỗi: ' + err.message);
        if (btn) { btn.disabled = false; btn.innerHTML = 'Thử lại'; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
      } finally {
        isDownloading = false;
        audioCtx.close();
      }
    }

    // ── Download All ──────────────────────────────────────────
    function applyDownloadAllButtonStyle(btn, active) {
      btn.style.cssText = [
        'display:inline-flex', 'align-items:center', 'gap:6px', 'padding:8px 18px',
        `background:${active ? '#7c3aed' : '#556'}`, 'color:#fff', 'border:none',
        'border-radius:24px', 'font-size:13px', 'font-weight:600',
        `cursor:${active ? 'pointer' : 'default'}`, 'margin:6px 0 6px 10px',
        'transition:background 0.25s, opacity 0.2s', `opacity:${active ? '1' : '0.6'}`, 'flex-shrink:0',
      ].join(';');
      btn.title = active ? 'Auto download all chapters (AAC)' : 'Cần có chapters trước';
      btn.innerHTML = 'Get all chapters';
    }

    function ensureDownloadAllButton() {
      if (!shouldShowChapterButton()) return;
      const existing = document.getElementById('waka-dl-all-btn');
      if (existing) { applyDownloadAllButtonStyle(existing, true); return; }
      const anchor = document.getElementById('waka-dl-btn');
      if (!anchor) return;
      const btn = document.createElement('button');
      btn.id = 'waka-dl-all-btn';
      applyDownloadAllButtonStyle(btn, true);
      btn.addEventListener('click', handleDownloadAllClick);
      anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    }

    function ensureAllChaptersProgressUI() {
      let ui = document.getElementById('waka-dl-all-overlay');
      if (ui) return ui;
      ui = document.createElement('div');
      ui.id = 'waka-dl-all-overlay';
      ui.style.cssText = [
        'position:fixed', 'bottom:20px', 'left:20px', 'width:360px',
        'background:#0f0f1a', 'color:#e8e8e8', 'border-radius:14px',
        'padding:18px 20px', 'box-shadow:0 6px 28px rgba(0,0,0,0.6)',
        'font-family:system-ui,sans-serif', 'font-size:13px', 'z-index:2147483647', 'display:none',
      ].join(';');
      ui.innerHTML = `
        <div style="font-weight:700;font-size:14px;color:#7c3aed;margin-bottom:10px">Waka – Tải tất cả chương</div>
        <div id="waka-all-chapter-name" style="margin-bottom:4px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Đang chuẩn bị...</div>
        <div id="waka-all-status" style="color:#aaa;font-size:11px;margin-bottom:8px">Chương 0 / 0</div>
        <div style="background:#2a2a3a;border-radius:6px;height:7px;overflow:hidden;margin-bottom:4px">
          <div id="waka-all-bar" style="width:0%;height:100%;background:#7c3aed;transition:width 0.3s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;color:#888;font-size:11px;margin-bottom:10px">
          <span id="waka-all-pct">0%</span><span id="waka-all-count">0 / 0</span>
        </div>
        <div style="background:#1a1a2e;border-radius:6px;height:5px;overflow:hidden;margin-bottom:8px">
          <div id="waka-all-seg-bar" style="width:0%;height:100%;background:#e94560;transition:width 0.2s"></div>
        </div>
        <div style="color:#888;font-size:11px;display:flex;justify-content:space-between">
          <span id="waka-all-seg-txt">Segments: 0/0</span>
          <button id="waka-all-stop-btn" style="background:#e94560;color:#fff;border:none;border-radius:8px;padding:2px 10px;cursor:pointer;font-size:11px">Dừng</button>
        </div>
        <div id="waka-all-log" style="margin-top:10px;max-height:80px;overflow-y:auto;font-size:10px;color:#888;line-height:1.6"></div>
      `;
      document.body.appendChild(ui);
      document.getElementById('waka-all-stop-btn').addEventListener('click', () => { window.__waka_dl_all_stop__ = true; });
      return ui;
    }

    function updateAllOverlay({ chapterName, chapterIdx, chapterTotal, segCur, segTotal, logLine }) {
      const pct = chapterTotal > 0 ? Math.round((chapterIdx / chapterTotal) * 100) : 0;
      const bar = document.getElementById('waka-all-bar');
      const pctEl = document.getElementById('waka-all-pct');
      const countEl = document.getElementById('waka-all-count');
      const statusEl = document.getElementById('waka-all-status');
      const nameEl = document.getElementById('waka-all-chapter-name');
      const segBar = document.getElementById('waka-all-seg-bar');
      const segTxt = document.getElementById('waka-all-seg-txt');
      const logEl = document.getElementById('waka-all-log');
      if (bar) bar.style.width = pct + '%';
      if (pctEl) pctEl.textContent = pct + '%';
      if (countEl) countEl.textContent = `${chapterIdx} / ${chapterTotal}`;
      if (statusEl) statusEl.textContent = `Chương ${chapterIdx} / ${chapterTotal}`;
      if (chapterName && nameEl) nameEl.textContent = chapterName;
      if (segCur !== undefined && segTotal !== undefined) {
        const sp = segTotal > 0 ? Math.round((segCur / segTotal) * 100) : 0;
        if (segBar) segBar.style.width = sp + '%';
        if (segTxt) segTxt.textContent = `Segments: ${segCur}/${segTotal}`;
      }
      if (logLine && logEl) {
        const span = document.createElement('div');
        span.textContent = logLine;
        logEl.appendChild(span);
        logEl.scrollTop = logEl.scrollHeight;
      }
    }

    // Proxy fetch playlist qua MAIN world (giữ nguyên logic)
    let _dlAllReqId = 0;
    const _dlAllPending = new Map();

    window.addEventListener('__waka_playlist_result__', function (e) {
      const { reqId, playlistUrl, error } = e.detail || {};
      const p = _dlAllPending.get(reqId);
      if (!p) return;
      clearTimeout(p.timer);
      _dlAllPending.delete(reqId);
      if (error && !playlistUrl) p.reject(new Error(error));
      else p.resolve(playlistUrl || null);
    });

    function askInterceptorForPlaylist(contentId, chapterId, action) {
      return new Promise(function (resolve, reject) {
        const reqId = 'dlall_' + (++_dlAllReqId) + '_' + Date.now();
        const timer = setTimeout(function () {
          _dlAllPending.delete(reqId);
          reject(new Error('Timeout 12s – chapter ' + chapterId));
        }, 12000);
        _dlAllPending.set(reqId, { resolve, reject, timer });
        window.dispatchEvent(new CustomEvent('__waka_fetch_playlist__', {
          detail: { reqId, contentId: String(contentId), chapterId: String(chapterId), action },
        }));
      });
    }

    async function fetchPlaylistUrl(contentId, chapterId) {
      try {
        const url = await askInterceptorForPlaylist(contentId, chapterId, 'current');
        return url;
      } catch (err) {
        console.warn('[Waka DL All] playlist fetch failed:', err.message);
        return null;
      }
    }

    async function browserDownloadHLS(playlistUrl, onSegmentProgress) {
      async function fetchBuf(url) {
        const r = await fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
        return r.arrayBuffer();
      }
      async function fetchTxt(url) {
        const r = await fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      }
      function resolve(rel, base) {
        if (/^https?:\/\//i.test(rel)) return rel;
        return new URL(rel, base).href;
      }
      const masterTxt = await fetchTxt(playlistUrl);
      const lines = masterTxt.split('\n').map(l => l.trim());
      let chunkUrl = playlistUrl;
      let bw = 0;
      for (const l of lines) {
        if (l.startsWith('#EXT-X-STREAM-INF:')) { bw = 1; continue; }
        if (bw && !l.startsWith('#') && l.length) { chunkUrl = resolve(l, playlistUrl); bw = 0; break; }
      }
      const chunkTxt = await fetchTxt(chunkUrl);
      const clines = chunkTxt.split('\n').map(l => l.trim());
      const segs = [];
      let key = null;
      let seq = 0;
      for (const l of clines) {
        if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { seq = parseInt(l.split(':')[1]) || 0; continue; }
        if (l.startsWith('#EXT-X-KEY:')) {
          const m = l.match(/METHOD=([^,\s]+)/i)?.[1]?.toUpperCase() ?? 'NONE';
          if (m === 'NONE') { key = null; }
          else {
            const uri = l.match(/URI="([^"]+)"/i)?.[1];
            const iv = l.match(/IV=0x([0-9a-fA-F]+)/i)?.[1]?.padStart(32, '0');
            key = { method: m, uri: uri ? resolve(uri, chunkUrl) : null, iv };
          }
          continue;
        }
        if (!l.startsWith('#') && l.length) { segs.push({ url: resolve(l, chunkUrl), key: key ? { ...key } : null, seq }); seq++; }
      }
      const _kc = {};
      async function getKey(uri) { if (!_kc[uri]) { _kc[uri] = await fetchBuf(uri); } return _kc[uri]; }
      function toIV(s) { const iv = new Uint8Array(16); let n = s; for (let i = 15; i >= 0; i--) { iv[i] = n & 0xff; n = Math.floor(n / 256); } return iv; }
      function hexIV(h) { return Uint8Array.from(h.padStart(32, '0').match(/../g).map(x => parseInt(x, 16))); }
      const parts = [];
      for (let i = 0; i < segs.length; i++) {
        onSegmentProgress?.(i + 1, segs.length);
        const s = segs[i];
        const enc = await fetchBuf(s.url);
        if (s.key?.method === 'AES-128' && s.key.uri) {
          const k = await getKey(s.key.uri);
          const iv = s.key.iv ? hexIV(s.key.iv) : toIV(s.seq);
          const ck = await crypto.subtle.importKey('raw', k, { name: 'AES-CBC' }, false, ['decrypt']);
          const dec = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, enc);
          parts.push(new Uint8Array(dec));
        } else {
          parts.push(new Uint8Array(enc));
        }
      }
      const total = parts.reduce((s, b) => s + b.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return out;
    }

    let isDownloadingAll = false;

    async function handleDownloadAllClick() {
      if (isDownloadingAll) { alert('Đang tải! Nhấn nút "Dừng" trong bảng tiến trình để hủy.'); return; }
      if (!shouldShowChapterButton() || !chapterListPayload) { alert('Chưa có danh sách chương.'); return; }
      const items = [...(chapterListPayload.items || [])].sort((a, b) => { const ao = Number(a.order ?? 0), bo = Number(b.order ?? 0); if (ao !== bo) return ao - bo; return Number(a.id ?? 0) - Number(b.id ?? 0); });
      const contentId = chapterListPayload.content_id;
      if (!contentId) { alert('Không tìm thấy content_id.'); return; }
      isDownloadingAll = true;
      const ui = ensureAllChaptersProgressUI();
      window.__waka_dl_all_stop__ = false;
      ui.style.display = 'block';
      const btn = document.getElementById('waka-dl-all-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.innerHTML = 'Đang tải...'; }
      let success = 0, fail = 0;
      for (let i = 0; i < items.length; i++) {
        if (window.__waka_dl_all_stop__) { updateAllOverlay({ chapterName: '⛔ Đã dừng', chapterIdx: i, chapterTotal: items.length }); break; }
        const item = items[i];
        updateAllOverlay({ chapterName: `[${String(i + 1).padStart(2, '0')}/${items.length}] ${item.name}`, chapterIdx: i, chapterTotal: items.length, segCur: 0, segTotal: 0 });
        try {
          const playlistUrl = await fetchPlaylistUrl(contentId, item.id);
          if (!playlistUrl) throw new Error('Không lấy được playlist URL');
          const aacData = await browserDownloadHLS(playlistUrl, (cur, total) => {
            updateAllOverlay({ chapterName: `[${String(i + 1).padStart(2, '0')}/${items.length}] ${item.name}`, chapterIdx: i, chapterTotal: items.length, segCur: cur, segTotal: total });
          });
          const pad3 = String(i + 1).padStart(3, '0');
          const safeName = (item.name || `chapter_${item.id}`).replace(/[<>:"\/\\|?*]/g, '').trim().replace(/\s+/g, '_');
          const filename = `${pad3}_${safeName}.aac`;
          const blob = new Blob([aacData], { type: 'audio/aac' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename; a.style.display = 'none';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 15_000);
          updateAllOverlay({ logLine: `✅ ${filename}`, chapterIdx: i + 1, chapterTotal: items.length });
          success++;
        } catch (err) {
          updateAllOverlay({ logLine: `❌ [${item.name}] ${err.message}`, chapterIdx: i + 1, chapterTotal: items.length });
          fail++;
        }
        if (i < items.length - 1 && !window.__waka_dl_all_stop__) await new Promise(r => setTimeout(r, 1200));
      }
      updateAllOverlay({ chapterName: `Xong! ✅ ${success} thành công, ❌ ${fail} lỗi`, chapterIdx: items.length, chapterTotal: items.length, segCur: 1, segTotal: 1 });
      isDownloadingAll = false;
      setTimeout(() => { const ui = document.getElementById('waka-dl-all-overlay'); if (ui) ui.style.display = 'none'; }, 10000);
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = 'Tải tất cả'; applyDownloadAllButtonStyle(btn, true); }
    }

    // Init
    function handleMutation() {
      if (mutationTimer) return;
      mutationTimer = setTimeout(() => { mutationTimer = null; injectButtons(); }, 250);
    }

    const observer = new MutationObserver(handleMutation);

    function init() {
      if (!isRelevantPage()) return;
      injectButtons();
      observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  // ══════════════════════════════════════════════════════════════
  // 11. EBOOK CONTENT
  // ══════════════════════════════════════════════════════════════

  function initEbookContent() {
    let _downloadUrl = null;
    let _rawResponse = null;
    let _isBusy = false;

    function isOpfUrl(url) { return /\/content\.opf(\?|$)/i.test(String(url || '')); }
    function extractDownloadUrl(text) {
      if (!text) return null;
      const raw = String(text);
      try {
        const json = JSON.parse(raw);
        const candidates = [json?.data?.download_url, json?.data?.url, json?.data?.epub_url, json?.data?.file_url, json?.data?.link, json?.download_url, json?.url, json?.epub_url, json?.file_url, json?.link];
        for (const c of candidates) { if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c; }
      } catch {}
      const patterns = [/\"(https?:\/\/[^\"]*(?:epub|book|download)[^\"]*)\"/i, /\"(?:download_url|epub_url|file_url|link|url)\"\s*:\s*\"(https?:\/\/[^\"]+)\"/i];
      for (const pattern of patterns) { const match = raw.match(pattern); if (match?.[1]) return match[1].replace(/\\\//g, '/'); }
      return null;
    }
    function resolveUrl(href, base) {
      if (/^https?:\/\//i.test(href)) return href;
      try { return new URL(href, base).href; } catch { return base.replace(/\/$/, '') + '/' + href; }
    }
    async function fetchWithFallback(url) {
      let resp = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (!resp.ok) resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
      return resp;
    }
    function downloadBlob(blob, filename) {
      const objectUrl = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: objectUrl, download: filename, style: 'display:none' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    }
    function safeName(s) { return String(s || 'waka-ebook').replace(/[<>:"\/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, '_').slice(0, 100); }
    function getBookTitle() { const h1 = document.querySelector('h1'); if (h1?.textContent.trim()) return h1.textContent.trim(); return document.title.replace(/\s*[-–]\s*.*Waka.*$/i, '').trim() || 'waka-ebook'; }

    let _toastTimer;
    function showToast(msg, isError = false) {
      let t = document.getElementById('waka-dl-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'waka-dl-toast';
        t.style.cssText = 'position:fixed;bottom:80px;right:20px;background:#111827;color:#f3f4f6;border-radius:12px;padding:12px 18px;font-size:13px;max-width:340px;z-index:2147483647;font-family:system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);transition:opacity .3s;pointer-events:none;line-height:1.5;';
        document.body.appendChild(t);
      }
      t.style.background = isError ? '#3b1a1a' : '#111827';
      t.textContent = msg;
      t.style.opacity = '1';
      clearTimeout(_toastTimer);
      _toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 5000);
    }

    function updateStatus(msg, isError = false) {
      let el = document.getElementById('waka-dl-status');
      if (!el) { createUI(); el = document.getElementById('waka-dl-status'); }
      if (!el) return;
      el.textContent = msg;
      el.style.display = 'block';
      el.style.color = isError ? '#ff8a8a' : '#888';
    }

    function setPrimaryLabel(text, active) {
      const btn = document.getElementById('waka-dl-btn');
      if (!btn) return;
      btn.innerHTML = text;
      if (active) {
        btn.style.background = '#e94560'; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
        btn.onmouseenter = () => { btn.style.opacity = '0.85'; };
        btn.onmouseleave = () => { btn.style.opacity = '1'; };
      }
    }

    function updateBtnState() {
      if (!_downloadUrl) { setPrimaryLabel('⏳&nbsp;Đang tìm EPUB...', false); return; }
      setPrimaryLabel('⬇&nbsp;Tải EPUB', true);
    }

    function createUI() {
      if (document.getElementById('waka-dl-overlay-ebook')) return;
      const ui = document.createElement('div');
      ui.id = 'waka-dl-overlay-ebook';
      ui.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:6px;';
      const status = document.createElement('div');
      status.id = 'waka-dl-status';
      status.style.cssText = 'background:rgba(21,21,30,0.9);color:#888;font-size:12px;padding:6px 12px;border-radius:8px;max-width:280px;text-align:right;display:none;font-family:system-ui,sans-serif;';
      const btn = document.createElement('button');
      btn.id = 'waka-dl-btn';
      btn.innerHTML = '⏳&nbsp;Đang tìm EPUB...';
      btn.style.cssText = 'background:#555;color:#fff;border:none;border-radius:24px;padding:10px 20px;font-size:13px;font-weight:700;cursor:default;opacity:0.7;box-shadow:0 3px 12px rgba(0,0,0,0.3);transition:background 0.2s,opacity 0.2s;white-space:nowrap;';
      btn.addEventListener('click', handleBtnClick);
      ui.appendChild(status);
      ui.appendChild(btn);
      document.body.appendChild(ui);
    }

    async function handleBtnClick() {
      if (_isBusy) return;
      if (!_downloadUrl) {
        if (_rawResponse && extractDownloadUrl(_rawResponse)) {
          _downloadUrl = extractDownloadUrl(_rawResponse);
          updateBtnState();
        } else { showToast('⏳ Đang chờ API phản hồi...'); return; }
      }
      if (isOpfUrl(_downloadUrl)) { await buildEpubFromOpf(_downloadUrl); return; }
      await downloadDirectFile(_downloadUrl);
    }

    async function downloadDirectFile(url) {
      _isBusy = true;
      const btn = document.getElementById('waka-dl-btn');
      if (btn) { btn.innerHTML = '⏳&nbsp;Đang tải...'; btn.disabled = true; btn.style.cursor = 'default'; }
      try {
        updateStatus('Đang tải file EPUB...');
        const resp = await fetchWithFallback(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        let ext = url.match(/\.pdf(\?|$)/i) ? 'pdf' : 'epub';
        let finalBlob = blob;
        let metaNote = '';
        if (ext === 'epub' && window.WakaMetaInjector) {
          const hasMeta = await WakaMetaInjector.hasMeta();
          if (hasMeta) {
            updateStatus('📚 Đang nhúng metadata vào EPUB...');
            try { finalBlob = await WakaMetaInjector.injectIntoBlob(blob); metaNote = ' + metadata'; } catch (e) { console.warn(e); }
          }
        }
        const fname = `${safeName(getBookTitle())}.${ext}`;
        downloadBlob(finalBlob, fname);
        updateStatus(`✅ Đã lưu: ${fname}${metaNote}`);
        showToast(`✅ Đã tải: ${fname}${metaNote}`);
        if (metaNote && window.WakaMetaInjector) await WakaMetaInjector.clearMeta();
        if (btn) { btn.innerHTML = '✅&nbsp;Đã tải'; btn.disabled = false; btn.style.background = '#28a745'; btn.style.cursor = 'pointer'; }
      } catch (err) {
        updateStatus('❌ ' + err.message, true); showToast('❌ ' + err.message, true);
        if (btn) { btn.innerHTML = '⬇&nbsp;Thử lại'; btn.disabled = false; btn.style.background = '#e94560'; btn.style.cursor = 'pointer'; }
      } finally { _isBusy = false; }
    }

    async function buildEpubFromOpf(opfUrl) {
      _isBusy = true;
      const btn = document.getElementById('waka-dl-btn');
      if (btn) { btn.innerHTML = '⏳&nbsp;Đang giải mã...'; btn.disabled = true; btn.style.cursor = 'default'; }
      try {
        if (!window.WakaEpubDecode) throw new Error('WakaEpubDecode chưa được nạp');
        if (!window.EPUBBuilder || typeof EPUBBuilder.buildFromFiles !== 'function') throw new Error('EPUBBuilder chưa sẵn sàng');
        updateStatus('Tải content.opf...');
        const [opfPath, qs = ''] = String(opfUrl).split('?');
        const token = qs ? '?' + qs : '';
        const oebpsDir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
        let opfResp = await fetchWithFallback(opfUrl);
        if (!opfResp.ok) throw new Error('content.opf HTTP ' + opfResp.status);
        const opfText = await opfResp.text();
        if (!opfText || !opfText.includes('<manifest')) throw new Error('OPF không hợp lệ');
        const parser = new DOMParser();
        const doc = parser.parseFromString(opfText, 'application/xml');
        const items = Array.from(doc.querySelectorAll('manifest item')).map(el => ({ href: el.getAttribute('href') || '', type: el.getAttribute('media-type') || '' })).filter(item => item.href);
        if (items.length === 0) throw new Error('OPF không có file nào');
        updateStatus(`Phát hiện ${items.length} file, đang tải...`);
        const files = new Map();
        let done = 0, failed = 0;
        for (let i = 0; i < items.length; i += 5) {
          await Promise.all(items.slice(i, i + 5).map(async (item) => {
            const fileUrl = resolveUrl(item.href, oebpsDir) + token;
            try {
              let resp = await fetchWithFallback(fileUrl);
              if (!resp.ok) { if (item.href.includes('toc.ncx') || resp.status === 404) return; throw new Error('HTTP ' + resp.status); }
              const buf = await resp.arrayBuffer();
              const isTextFile = /\.(xhtml|html?|xml|ncx|css|js|json)$/i.test(item.href);
              files.set(item.href, isTextFile ? WakaEpubDecode.decodeFileSync(buf) : buf);
              done++;
            } catch { failed++; }
          }));
          updateStatus(`Đang tải file: ${done}/${items.length} · lỗi: ${failed}`);
        }
        if (files.size === 0) throw new Error('Không tải được file nào');
        updateStatus(`Đang đóng gói ${files.size} file...`);
        const title = WakaEpubDecode.extractTitleFromOpf(opfText, getBookTitle());
        let blob = await EPUBBuilder.buildFromFiles(title, opfText, files);
        let metaNote = '';
        if (window.WakaMetaInjector) {
          const hasMeta = await WakaMetaInjector.hasMeta();
          if (hasMeta) {
            updateStatus('📚 Đang nhúng metadata + ảnh bìa...');
            try { blob = await WakaMetaInjector.injectIntoBlob(blob); metaNote = ' + metadata'; } catch {}
          }
        }
        const fname = `${safeName(title)}.epub`;
        downloadBlob(blob, fname);
        const sizeMb = (blob.size / 1024 / 1024).toFixed(2);
        const msg = `✅ Đã lưu: ${fname}${metaNote} · ${sizeMb}MB`;
        updateStatus(msg); showToast(msg);
        if (metaNote && window.WakaMetaInjector) await WakaMetaInjector.clearMeta();
        if (btn) { btn.innerHTML = '✅&nbsp;Đã tải'; btn.disabled = false; btn.style.background = '#28a745'; btn.style.cursor = 'pointer'; }
      } catch (err) {
        console.error('[Waka DL]', err); updateStatus('❌ ' + err.message, true); showToast('❌ ' + err.message, true);
        if (btn) { btn.innerHTML = '⬇&nbsp;Thử lại'; btn.disabled = false; btn.style.background = '#e94560'; btn.style.cursor = 'pointer'; }
      } finally { _isBusy = false; }
    }

    window.addEventListener('__waka_ebook_ready__', (e) => {
      _downloadUrl = e.detail.url;
      updateBtnState();
      showToast(isOpfUrl(_downloadUrl) ? '✅ Link OPF sẵn sàng!' : '✅ Link EPUB sẵn sàng!');
    });
    window.addEventListener('__waka_ebook_raw__', (e) => {
      _rawResponse = e.detail.raw;
      const url = extractDownloadUrl(_rawResponse);
      if (url) { _downloadUrl = url; updateBtnState(); showToast('✅ Đã lọc được link EPUB'); }
      else setPrimaryLabel('🔍&nbsp;Xem response', true);
    });
    window.addEventListener('__waka_ebook_status__', (e) => { updateStatus(e.detail.msg, e.detail.isError); });

    async function autoClearOnNewPage() {
      if (!window.WakaMetaInjector) return;
      const hasMeta = await WakaMetaInjector.hasMeta();
      if (hasMeta) { await WakaMetaInjector.clearMeta(); console.log('[Waka DL 4.1] Metadata cũ đã xóa tự động.'); }
    }

    if (document.body) { createUI(); autoClearOnNewPage(); }
    else { new MutationObserver((_, obs) => { if (document.body) { createUI(); autoClearOnNewPage(); obs.disconnect(); } }).observe(document.documentElement, { childList: true }); }
  }

  // ══════════════════════════════════════════════════════════════
  // 12. READER CONTENT
  // ══════════════════════════════════════════════════════════════

  function initReaderContent() {
    let _epubUrl = null;
    let _title = 'Ebook';
    let _opfText = null;
    let _files = new Map();
    let _isBusy = false;
    let _isWaiting = false;

    window.addEventListener('__waka_epub_found__', (e) => { _epubUrl = e.detail.url; _title = e.detail.title || 'Ebook'; activateBtn(); setStatus('Sẵn sàng, nhấn nút để tải!'); });
    window.addEventListener('__waka_epub_opf__', (e) => { _opfText = e.detail.text; });
    window.addEventListener('__waka_epub_file__', (e) => { _files.set(e.detail.href, e.detail.buffer); });
    window.addEventListener('__waka_epub_progress__', (e) => {
      setStatus(e.detail.msg || '');
      const btn = document.getElementById('wdl-btn');
      if (btn && _isWaiting) {
        const d = e.detail.done || 0, f = e.detail.failed || 0, t = e.detail.total || 0;
        btn.textContent = t > 0 ? `⏳ ${d + f}/${t}` : '⏳ Đang tải...';
      }
    });
    window.addEventListener('__waka_epub_done__', async (e) => {
      const { done, failed } = e.detail;
      _isWaiting = false;
      if (done === 0 && failed > 0) {
        setStatus(`${failed} file bị từ chối (403)`);
        const btn = document.getElementById('wdl-btn');
        if (btn) { btn.textContent = '⬇ Thử lại'; btn.disabled = false; btn.style.background = '#e94560'; }
        _isBusy = false; return;
      }
      setStatus(`Đang giải mã và đóng gói ${done} file...`);
      await buildAndDownload();
    });
    window.addEventListener('__waka_epub_error__', (e) => {
      _isWaiting = false; _isBusy = false;
      setStatus('Lỗi: ' + (e.detail.msg || 'Không xác định'));
      const btn = document.getElementById('wdl-btn');
      if (btn) { btn.textContent = '⬇ Thử lại'; btn.disabled = false; btn.style.background = '#e94560'; }
    });

    function setStatus(msg) {
      let el = document.getElementById('wdl-status');
      if (el) el.textContent = msg;
    }
    function activateBtn() {
      const btn = document.getElementById('wdl-btn');
      if (btn) { btn.disabled = false; btn.style.background = '#e94560'; btn.textContent = '⬇ Tải EPUB'; }
    }
    function showToast(msg) {
      let t = document.getElementById('wdl-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'wdl-toast';
        t.style.cssText = 'position:fixed;top:20px;right:20px;background:#111;color:#fff;padding:12px 18px;border-radius:10px;z-index:9999999;font-family:system-ui,sans-serif;font-size:13px;max-width:320px;';
        document.body.appendChild(t);
      }
      t.textContent = msg; t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 4000);
    }

    function createUI() {
      if (document.getElementById('wdl-ui')) return;
      const ui = document.createElement('div');
      ui.id = 'wdl-ui';
      ui.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:system-ui,sans-serif;';
      const status = document.createElement('div');
      status.id = 'wdl-status';
      status.style.cssText = 'background:rgba(0,0,0,0.8);color:#aaa;font-size:12px;padding:6px 12px;border-radius:8px;max-width:280px;text-align:right;';
      status.textContent = 'Đang tìm EPUB...';
      const btn = document.createElement('button');
      btn.id = 'wdl-btn';
      btn.textContent = '⏳ Đang tìm...';
      btn.disabled = true;
      btn.style.cssText = 'background:#555;color:#fff;border:none;border-radius:24px;padding:10px 22px;font-size:14px;font-weight:700;cursor:default;box-shadow:0 3px 12px rgba(0,0,0,0.4);';
      btn.addEventListener('click', handleClick);
      ui.appendChild(status);
      ui.appendChild(btn);
      document.body.appendChild(ui);
    }

    async function handleClick() {
      if (_isBusy) return;
      if (!_epubUrl) { showToast('Đang tìm EPUB URL, thử reload trang...'); return; }
      _isBusy = true; _isWaiting = true; _opfText = null; _files = new Map();
      const btn = document.getElementById('wdl-btn');
      if (btn) { btn.textContent = '⏳ Đang tải...'; btn.disabled = true; }
      setStatus('Kết nối với server...');
      window.dispatchEvent(new CustomEvent('__waka_do_download__', { detail: { opfUrl: _epubUrl } }));
    }

    async function buildAndDownload() {
      try {
        if (!window.WakaEpubDecode) throw new Error('WakaEpubDecode chưa được nạp');
        if (!window.EPUBBuilder || typeof EPUBBuilder.buildFromFiles !== 'function') throw new Error('EPUBBuilder chưa sẵn sàng');
        const decodedFiles = new Map();
        for (const [href, buf] of _files) {
          if (!buf || buf.byteLength === 0) continue;
          const fileName = WakaEpubDecode.normalizeFileName(href);
          const isTextFile = /\.(xhtml|html?)$/i.test(fileName);
          if (isTextFile) {
            try { decodedFiles.set(fileName, WakaEpubDecode.decodeFileSync(buf)); continue; } catch {}
          }
          decodedFiles.set(fileName, buf);
        }
        if (decodedFiles.size === 0) throw new Error('Không có file nào để đóng gói');
        const title = WakaEpubDecode.extractTitleFromOpf(_opfText, _title || 'waka-ebook');
        let blob = await EPUBBuilder.buildFromFiles(title, _opfText, decodedFiles);
        let metaNote = '';
        if (window.WakaMetaInjector) {
          const hasMeta = await WakaMetaInjector.hasMeta();
          if (hasMeta) {
            setStatus('📚 Đang nhúng metadata...');
            try { blob = await WakaMetaInjector.injectIntoBlob(blob); metaNote = ' + metadata'; } catch {}
          }
        }
        const fname = WakaEpubDecode.safeName(title) + '.epub';
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl; a.download = fname; a.style.display = 'none';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
        const sizeMb = (blob.size / 1024 / 1024).toFixed(2);
        const msg = `✅ ${fname}${metaNote} · ${sizeMb}MB`;
        setStatus(msg); showToast(msg);
        if (metaNote && window.WakaMetaInjector) await WakaMetaInjector.clearMeta();
        const btn = document.getElementById('wdl-btn');
        if (btn) { btn.textContent = '✅ Đã tải'; btn.disabled = false; btn.style.background = '#28a745'; btn.style.cursor = 'pointer'; }
      } catch (err) {
        console.error('[Waka DL Reader]', err); setStatus('❌ ' + err.message); showToast('❌ ' + err.message);
        const btn = document.getElementById('wdl-btn');
        if (btn) { btn.textContent = '⬇ Thử lại'; btn.disabled = false; btn.style.background = '#e94560'; btn.style.cursor = 'pointer'; }
      } finally { _isBusy = false; }
    }

    if (document.body) createUI();
    else { new MutationObserver((_, obs) => { if (document.body) { createUI(); obs.disconnect(); } }).observe(document.documentElement, { childList: true }); }
  }

  // ══════════════════════════════════════════════════════════════
  // 13. BOOTSTRAP – load thư viện rồi khởi chạy
  // ══════════════════════════════════════════════════════════════

  async function bootstrap() {
    try {
      if (IS_AUDIO) {
        await loadLibs(['lib/lame.min.js']);
        initAudioContent();
      }

      if (IS_EBOOK) {
        await loadLibs(['lib/jszip.min.js', 'lib/crypto-js.min.js']);
        extractAndSaveBookMetadata();
        initEbookContent();
      }

      if (IS_READER) {
        await loadLibs(['lib/jszip.min.js', 'lib/crypto-js.min.js']);
        initReaderContent();
      }

      console.log('[Waka DL] Userscript v4.1.0 ready.');
    } catch (err) {
      console.error('[Waka DL] Bootstrap error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
