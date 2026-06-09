// ==UserScript==
// @name         Waka Downloader Vip
// @namespace    https://nguyenphanvn95.github.io/waka/
// @version      3.7.1
// @description  Tải sách nói miễn phí (MP3) và full ebook (EPUB) từ Waka.vn
// @author       nguyenphanvn95
// @match        https://waka.vn/sach-noi/*
// @match        https://waka.vn/ebook/*
// @match        https://waka.vn/reader/*
// @grant        none
// @run-at       document-start
// @require      https://nguyenphanvn95.github.io/waka/lib/lame.min.js
// @require      https://nguyenphanvn95.github.io/waka/lib/jszip.min.js
// @require      https://nguyenphanvn95.github.io/waka/lib/crypto-js.min.js
// ==/UserScript==

/**
 * Waka Downloader Vip – Tampermonkey Userscript
 *
 * Nguồn gốc: Chrome Extension MV3 – chuyển đổi thành userscript.
 *
 * Vì Tampermonkey chạy trong isolated world (như content script), nhưng
 * userscript KHÔNG thể dùng `world: MAIN`, ta dùng kỹ thuật inject script tag
 * để chạy code interceptor trong MAIN world (trực tiếp trên page context).
 *
 * Ba flow:
 *   /sach-noi/*  → interceptor (MAIN) + content logic (isolated)
 *   /ebook/*     → ebook-interceptor (MAIN) + ebook-content logic (isolated)
 *   /reader/*    → reader-interceptor (MAIN) + reader-content logic (isolated)
 */

(function () {
  'use strict';

  const PATH = window.location.pathname;
  const IS_AUDIO  = /\/sach-noi\//i.test(PATH);
  const IS_EBOOK  = /\/ebook\//i.test(PATH);
  const IS_READER = /\/reader\//i.test(PATH);

  if (!IS_AUDIO && !IS_EBOOK && !IS_READER) return;

  // ══════════════════════════════════════════════════════════════════
  // HELPER: inject script vào MAIN world
  // ══════════════════════════════════════════════════════════════════
  function injectToMainWorld(fn) {
    const script = document.createElement('script');
    script.textContent = '(' + fn.toString() + ')();';
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  // ══════════════════════════════════════════════════════════════════
  // FLOW 1: /sach-noi/* – Audio downloader
  // ══════════════════════════════════════════════════════════════════

  // --- MAIN world interceptor ---
  function audioInterceptorMain() {
    /* ---- interceptor.js (MAIN world) ---- */
    'use strict';

    const PLAYLIST_REGEX = /vegacdn\.vn\/.+?\/playlist\.m3u8/;
    const GET_LIST_AUDIO_RE = /beta-api\.waka\.vn\/fm\/getListAudioFile\b/;
    const NEXT_BACK_AUDIO_RE = /beta-api\.waka\.vn\/fm\/listNextBackFm\b/;
    const DOWNLOAD_ITEM_RE = /beta-api\.waka\.vn\/fm\/getDownloadItem\b/;
    const CHAPTER_LIST_STORAGE_KEY = 'waka.audio.chapterList';

    function emit(type, detail) {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    }
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
        id: chapterId,
        audio_id: item.audio_id ?? meta.audio_id ?? null,
        name: item.name ?? '',
        description: item.description ?? '',
        zone: item.zone ?? '',
        order: Number(item.order ?? 0),
        thumb: item.thumb ?? '',
        duration: Number(item.duration ?? 0),
        created_time: item.created_time ?? '',
        audio_data: Array.isArray(item.audio_data) ? item.audio_data : [],
        read: item.read ?? null,
        is_download: item.is_download ?? null,
        parent_price: item.parent_price ?? null,
        mini_app: item.mini_app ?? null,
        view: item.view ?? null,
        owner: item.owner ?? null,
        is_noted: item.is_noted ?? null,
        content_type: item.content_type ?? '',
        parent_type: item.parent_type ?? '',
        is_summary: item.is_summary ?? null,
        content_detail_url: item.content_detail_url ?? '',
        in_wishlist: item.in_wishlist ?? null,
        parent_name: item.parent_name ?? '',
      };
    }

    function extractChapterPayload(text, url) {
      const json = safeJsonParse(text);
      if (!json || json.code !== 0) return null;
      const meta = parseQuery(url);
      const source = GET_LIST_AUDIO_RE.test(url) ? 'getListAudioFile' : 'listNextBackFm';
      const rawData = json.data;
      const items = Array.isArray(rawData) ? rawData : rawData ? [rawData] : [];
      const normalizedItems = items.map((item) => normalizeChapterItem(item, meta)).filter(Boolean);
      if (normalizedItems.length === 0) return null;
      return {
        source,
        content_id: meta.content_id ? Number(meta.content_id) : null,
        chapter_id: meta.chapter_id ? Number(meta.chapter_id) : null,
        action: meta.action || null,
        page_no: meta.page_no ? Number(meta.page_no) : null,
        page_size: meta.page_size ? Number(meta.page_size) : null,
        total: Number(json.total ?? normalizedItems.length),
        items: normalizedItems,
        updatedAt: new Date().toISOString(),
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
      console.log('[Waka DL] Chapter list updated:', mergedItems.length, 'items');
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

    // XMLHttpRequest patch
    const NativeXHR = window.XMLHttpRequest;
    function PatchedXHR() {
      const xhr = new NativeXHR();
      let _url = '';
      const _open = xhr.open.bind(xhr);
      xhr.open = function (method, url) {
        _url = typeof url === 'string' ? url : '';
        cacheChapterRequestUrl(_url);
        return _open.apply(xhr, arguments);
      };
      xhr.addEventListener('readystatechange', function () {
        if (xhr.readyState !== 4) return;
        if (PLAYLIST_REGEX.test(_url)) emitStreamDetected(_url);
        if (GET_LIST_AUDIO_RE.test(_url) || NEXT_BACK_AUDIO_RE.test(_url)) {
          const p = extractChapterPayload(xhr.responseText || '', _url);
          if (p) mergeChapterList(p);
        }
      });
      return xhr;
    }
    Object.setPrototypeOf(PatchedXHR, NativeXHR);
    Object.setPrototypeOf(PatchedXHR.prototype, NativeXHR.prototype);
    window.XMLHttpRequest = PatchedXHR;

    // fetch patch
    const nativeFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      cacheChapterRequestUrl(url);
      const response = await nativeFetch(input, init);
      if (PLAYLIST_REGEX.test(url)) emitStreamDetected(url);
      if (GET_LIST_AUDIO_RE.test(url) || NEXT_BACK_AUDIO_RE.test(url)) {
        const clone = response.clone();
        clone.text().then((text) => {
          const p = extractChapterPayload(text, url);
          if (p) mergeChapterList(p);
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
        if (Array.isArray(val)) {
          for (const el of val) { if (el && typeof el === 'object') { const u = findPlaylistUrl(el, (depth || 0) + 1); if (u) return u; } }
        } else if (val && typeof val === 'object') { const u = findPlaylistUrl(val, (depth || 0) + 1); if (u) return u; }
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
        console.log('[Waka DL] Playlist cached for chapter', chapterId);
        break;
      }
    }

    async function fetchPlaylistViaNuxt(contentId, chapterId, action) {
      const nuxt = window.$nuxt;
      const fetcher = nuxt && nuxt.$fetcher;
      const api = fetcher && fetcher.api && fetcher.api.GET_DOWNLOAD_ITEM;
      if (fetcher && api && typeof fetcher.getManual === 'function') {
        const resp = await fetcher.getManual(api, { audio_file_id: String(chapterId) });
        const data = typeof fetcher.allResponse === 'function' ? fetcher.allResponse(resp) : resp && resp.data ? resp.data.data : null;
        const playlistUrl = findPlaylistUrl(data);
        if (playlistUrl) return playlistUrl;
        throw new Error('GET_DOWNLOAD_ITEM returned no playlist URL');
      }
      const params = new URLSearchParams({ audio_file_id: String(chapterId) });
      const fallbackUrl = 'https://beta-api.waka.vn/fm/getDownloadItem?' + params;
      const resp = await nativeFetch(fallbackUrl, { method: 'GET', mode: 'cors', credentials: 'omit', referrer: 'https://waka.vn/' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      if (!json || json.code !== 0) throw new Error('API code=' + (json && json.code !== undefined ? json.code : 'unknown'));
      const data = json.data?.data ?? json.data ?? null;
      return findPlaylistUrl(data);
    }

    // Proxy fetch cho isolated world
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
          if (json.code !== 0) throw new Error('API code=' + json.code + ': ' + (json.message || ''));
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

    console.log('[Waka DL] Audio Interceptor ready (userscript v3.7.1).');
  }

  // ══════════════════════════════════════════════════════════════════
  // FLOW 2: /ebook/* – Ebook interceptor (MAIN world)
  // ══════════════════════════════════════════════════════════════════
  function ebookInterceptorMain() {
    /* ---- ebook-interceptor.js (MAIN world) ---- */
    'use strict';

    const API_BASE     = 'beta-api.waka.vn';
    const ITEM_INFO_RE = /getItemInfo\?/;
    const DOWNLOAD_RE  = /getDownloadItemWeb\?/;

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
        if (downloadUrl) { emit('__waka_ebook_ready__', { url: downloadUrl, itemId: params.item_id }); }
        else { emit('__waka_ebook_status__', { msg: `getDownloadItemWeb (${resp.status}): ${text.slice(0, 200)}`, isError: true }); }
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
      xhr.addEventListener('readystatechange', function () { if (xhr.readyState !== 4) return; handleResponse(_url, xhr.responseText || ''); });
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
          console.log('[Waka DL] Captured params:', params.item_id, params.content_type);
          emit('__waka_ebook_status__', { msg: `Phát hiện sách ID=${params.item_id}. Đang lấy link...` });
          callDownloadApi(params);
        }
      }
      if (DOWNLOAD_RE.test(url)) {
        const downloadUrl = extractDownloadUrl(responseText);
        if (downloadUrl) { emit('__waka_ebook_ready__', { url: downloadUrl }); }
        else { emit('__waka_ebook_raw__', { raw: responseText }); }
      }
    }

    console.log('[Waka DL] Ebook interceptor ready (userscript v3.7.1).');
  }

  // ══════════════════════════════════════════════════════════════════
  // FLOW 3: /reader/* – Reader interceptor (MAIN world)
  // ══════════════════════════════════════════════════════════════════
  function readerInterceptorMain() {
    /* ---- reader-interceptor.js (MAIN world) ---- */
    'use strict';

    function emit(type, detail) { window.dispatchEvent(new CustomEvent(type, { detail })); }
    function resolveUrl(href, base) {
      if (/^https?:\/\//.test(href)) return href;
      try { return new URL(href, base).href; }
      catch { return base.replace(/\/$/, '') + '/' + href; }
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
        } catch (e) { console.warn('[Waka DL] JS file failed:', item.href, e.message); }
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
              if (isEncrypted(text)) { const dec = tryDecrypt(text, decryptScripts, token); if (dec) finalBuf = new TextEncoder().encode(dec).buffer; }
            }
            emit('__waka_epub_file__', { href: item.href, buffer: finalBuf });
            done++;
          } catch (err) { failed++; console.warn('[Waka DL] File failed:', item.href, err.message); }
          emit('__waka_epub_progress__', { msg: `Tải ${done + failed}/${contentItems.length} — OK:${done} Lỗi:${failed}`, done, failed, total: contentItems.length });
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
      if (Object.keys(scripts).length > 0) {
        const allScript = Object.values(scripts).join('\n');
        const keyMatch = allScript.match(/['"]([0-9a-f]{32,64})['"]/i);
        if (keyMatch) { emit('__waka_decrypt_key_found__', { key: keyMatch[1] }); }
      }
      return null;
    }

    console.log('[Waka DL] Reader interceptor ready (userscript v3.7.1).');
  }

  // ══════════════════════════════════════════════════════════════════
  // Inject interceptors vào MAIN world ngay khi document-start
  // ══════════════════════════════════════════════════════════════════
  if (IS_AUDIO)  injectToMainWorld(audioInterceptorMain);
  if (IS_EBOOK)  injectToMainWorld(ebookInterceptorMain);
  if (IS_READER) injectToMainWorld(readerInterceptorMain);

  // ══════════════════════════════════════════════════════════════════
  // Phần còn lại (UI + logic) chạy ở isolated world (document_idle)
  // ══════════════════════════════════════════════════════════════════
  function runIsolatedLogic() {

    // ──────────────────────────────────────────────────────────────
    // Shared libs (loaded via @require)
    // HLSParser, HLSDownloader, MP3Encoder, EPUBBuilder, WakaEpubDecode
    // ──────────────────────────────────────────────────────────────

    /* ================================================================
       HLS PARSER
    ================================================================ */
    const HLSParser = (() => {
      function resolveUrl(relativeUrl, baseUrl) {
        if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
        try { return new URL(relativeUrl, baseUrl).href; }
        catch { return baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1) + relativeUrl; }
      }
      function parseMasterPlaylist(text, baseUrl) {
        const lines = text.split('\n').map(l => l.trim());
        const variants = [];
        let pendingBandwidth = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('#EXT-X-STREAM-INF:')) { const m = line.match(/BANDWIDTH=(\d+)/i); pendingBandwidth = m ? parseInt(m[1]) : 0; continue; }
          if (!line.startsWith('#') && line.length > 0 && pendingBandwidth > 0) { variants.push({ url: resolveUrl(line, baseUrl), bandwidth: pendingBandwidth }); pendingBandwidth = 0; }
        }
        if (variants.length === 0) {
          for (const line of lines) { if (!line.startsWith('#') && line.includes('.m3u8')) return resolveUrl(line, baseUrl); }
          return null;
        }
        return variants[0].url;
      }
      function parseChunklist(text, baseUrl) {
        const lines = text.split('\n').map(l => l.trim());
        const segments = [];
        let currentKey = null, sequence = 0;
        for (const line of lines) {
          if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { sequence = parseInt(line.split(':')[1]) || 0; continue; }
          if (line.startsWith('#EXT-X-KEY:')) {
            const methodMatch = line.match(/METHOD=([^,\s]+)/i);
            const uriMatch = line.match(/URI="([^"]+)"/i);
            const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/i);
            const method = methodMatch ? methodMatch[1].toUpperCase() : 'NONE';
            currentKey = method === 'NONE' ? null : { method, uri: uriMatch ? resolveUrl(uriMatch[1], baseUrl) : null, iv: ivMatch ? ivMatch[1].padStart(32, '0') : null };
            continue;
          }
          if (!line.startsWith('#') && line.length > 0) { segments.push({ url: resolveUrl(line, baseUrl), keyInfo: currentKey ? { ...currentKey } : null, sequence }); sequence++; }
        }
        return segments;
      }
      return { parseMasterPlaylist, parseChunklist, resolveUrl };
    })();

    /* ================================================================
       HLS DOWNLOADER
    ================================================================ */
    const HLSDownloader = (() => {
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
      function sequenceToIV(seq) {
        const iv = new Uint8Array(16);
        let n = seq;
        for (let i = 15; i >= 0; i--) { iv[i] = n & 0xff; n = Math.floor(n / 256); }
        return iv;
      }
      function hexToIV(hexStr) {
        const padded = hexStr.padStart(32, '0');
        return Uint8Array.from(padded.match(/../g).map(byte => parseInt(byte, 16)));
      }
      async function decryptAES128(encryptedBuffer, keyBuffer, iv) {
        const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-CBC' }, false, ['decrypt']);
        return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, encryptedBuffer);
      }
      async function downloadAll(playlistUrl) {
        reportStatus('Đang tải master playlist...');
        const masterText = await fetchText(playlistUrl);
        const chunklistUrl = HLSParser.parseMasterPlaylist(masterText, playlistUrl);
        if (!chunklistUrl) throw new Error('Không tìm thấy chunklist trong master playlist.');
        reportStatus('Đang phân tích chunklist...');
        const chunklistText = await fetchText(chunklistUrl);
        const segments = HLSParser.parseChunklist(chunklistText, chunklistUrl);
        if (segments.length === 0) throw new Error('Chunklist không có segment nào.');
        reportStatus(`Tìm thấy ${segments.length} segments. Bắt đầu tải...`);
        const decryptedBuffers = [];
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          reportProgress(i, segments.length, `Tải segment ${i + 1} / ${segments.length}...`);
          const encData = await fetchArrayBuffer(seg.url);
          if (seg.keyInfo && seg.keyInfo.method === 'AES-128' && seg.keyInfo.uri) {
            const keyBuffer = await fetchKey(seg.keyInfo.uri);
            const iv = seg.keyInfo.iv ? hexToIV(seg.keyInfo.iv) : sequenceToIV(seg.sequence);
            const decrypted = await decryptAES128(encData, keyBuffer, iv);
            decryptedBuffers.push(new Uint8Array(decrypted));
          } else { decryptedBuffers.push(new Uint8Array(encData)); }
        }
        reportProgress(segments.length, segments.length, 'Đang ghép các đoạn audio...');
        const totalBytes = decryptedBuffers.reduce((sum, b) => sum + b.length, 0);
        const merged = new Uint8Array(totalBytes);
        let offset = 0;
        for (const buf of decryptedBuffers) { merged.set(buf, offset); offset += buf.length; }
        return merged;
      }
      return { downloadAll, setCallbacks };
    })();

    /* ================================================================
       MP3 ENCODER (depends on lamejs loaded via @require)
    ================================================================ */
    const MP3Encoder = (() => {
      let _onStatus = null, _onProgress = null;
      function setCallbacks(onStatus, onProgress) { _onStatus = onStatus; _onProgress = onProgress; }
      function status(msg) { if (_onStatus) _onStatus(msg); }
      function progress(pct, msg) { if (_onProgress) _onProgress(pct, msg); }
      function float32ToInt16(float32) {
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) { const c = Math.max(-1, Math.min(1, float32[i])); int16[i] = c < 0 ? c * 0x8000 : c * 0x7fff; }
        return int16;
      }
      function concatUint8Arrays(arrays) {
        const total = arrays.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const arr of arrays) { out.set(arr, off); off += arr.length; }
        return out;
      }
      async function decodeAAC(aacData, audioCtx) {
        const buffer = aacData.buffer.slice(aacData.byteOffset, aacData.byteOffset + aacData.byteLength);
        return new Promise((resolve, reject) => { audioCtx.decodeAudioData(buffer, resolve, reject); });
      }
      function encodePCMtoMP3(audioBuffer, bitrate) {
        const channels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const mp3Bitrate = bitrate || 128;
        const leftPCM = audioBuffer.getChannelData(0);
        const rightPCM = channels > 1 ? audioBuffer.getChannelData(1) : leftPCM;
        const encoder = new lamejs.Mp3Encoder(channels, sampleRate, mp3Bitrate);
        const mp3Chunks = [];
        const blockSize = 1152;
        for (let i = 0; i < leftPCM.length; i += blockSize) {
          const left = float32ToInt16(leftPCM.subarray(i, i + blockSize));
          const right = float32ToInt16(rightPCM.subarray(i, i + blockSize));
          const chunk = channels > 1 ? encoder.encodeBuffer(left, right) : encoder.encodeBuffer(left);
          if (chunk.length > 0) mp3Chunks.push(new Uint8Array(chunk));
        }
        const finalChunk = encoder.flush();
        if (finalChunk.length > 0) mp3Chunks.push(new Uint8Array(finalChunk));
        return concatUint8Arrays(mp3Chunks);
      }
      async function encode(aacData, audioCtx) {
        if (!window.lamejs) { status('lame.js chưa được tải. Lưu file AAC thay thế.'); return { blob: new Blob([aacData], { type: 'audio/aac' }), ext: 'aac' }; }
        status('Đang giải mã AAC...');
        const audioBuffer = await decodeAAC(aacData, audioCtx);
        status(`Đang encode MP3... (${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch)`);
        const mp3Data = encodePCMtoMP3(audioBuffer, 128);
        return { blob: new Blob([mp3Data], { type: 'audio/mpeg' }), ext: 'mp3' };
      }
      return { encode, setCallbacks };
    })();

    /* ================================================================
       WAKA EPUB DECODE (depends on crypto-js via @require)
    ================================================================ */
    const WakaEpubDecode = (() => {
      function toText(input) {
        if (typeof input === 'string') return input;
        if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
        if (ArrayBuffer.isView(input)) return new TextDecoder().decode(input);
        return String(input ?? '');
      }
      function toTextSync(input) {
        if (typeof input === 'string') return input;
        if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
        if (ArrayBuffer.isView(input)) return new TextDecoder().decode(input);
        return String(input ?? '');
      }
      function isWrappedJson(text) {
        const t = String(text || '').trim();
        return t.startsWith('{') && t.includes('"cd"') && t.includes('"wd"');
      }
      function decodeWrappedJson(text) {
        const raw = String(text ?? '');
        const trimmed = raw.trim();
        if (!isWrappedJson(trimmed)) return raw;
        if (typeof CryptoJS === 'undefined') throw new Error('CryptoJS not loaded');
        const data = JSON.parse(trimmed);
        if (!data.wd || !data.cd || !data.sw || !data.sd) return raw;
        const keyStr = String(data.wd) + 'a|w8' + String(data.sw) + String(data.sd);
        const key = CryptoJS.enc.Utf8.parse(keyStr);
        const ciphertext = CryptoJS.enc.Base64.parse(String(data.cd));
        const decrypted = CryptoJS.AES.decrypt({ ciphertext }, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 });
        const plain = decrypted.toString(CryptoJS.enc.Utf8);
        if (!plain) throw new Error('Decode failed: empty plaintext');
        return plain;
      }
      async function decodeFileContent(input) { return decodeWrappedJson(await toText(input)); }
      function decodeFileSync(input) { return decodeWrappedJson(toTextSync(input)); }
      function looksLikeEncryptedXhtml(text) { try { return isWrappedJson(text); } catch { return false; } }
      function extractTitleFromOpf(opfText, fallbackTitle = 'waka-ebook') {
        const raw = String(opfText || '');
        const m = raw.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) || raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (!m) return fallbackTitle;
        const title = m[1].replace(/<!--\[CDATA\[([\s\S]*?)\]\]-->/g, '$1').replace(/<[^>]+>/g, '').trim();
        return title || fallbackTitle;
      }
      function safeName(s) { return String(s || 'waka-ebook').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, '_').slice(0, 100); }
      function normalizeFileName(name) { return String(name || '').replace(/^\/+/, ''); }
      return { toText, toTextSync, decodeWrappedJson, decodeFileContent, decodeFileSync, looksLikeEncryptedXhtml, extractTitleFromOpf, safeName, normalizeFileName };
    })();

    /* ================================================================
       EPUB BUILDER (depends on JSZip via @require)
    ================================================================ */
    const EPUBBuilder = (() => {
      function sanitizeHtml(rawHtml) { return rawHtml.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/\son\w+="[^"]*"/g,'').replace(/\son\w+='[^']*'/g,'').trim(); }
      function xmlEscape(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      function mimetype() { return 'application/epub+zip'; }
      function containerXml() { return `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`; }
      function normalizeFileName(name) { return String(name || '').replace(/^\/+/, ''); }
      function addFile(zipFolder, name, content) { const s = normalizeFileName(name); if (!s) return; zipFolder.file(s, content); }
      function extractNavEntriesFromTocXhtml(tocXhtml) {
        const entries = [];
        const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(tocXhtml))) { const href = m[1].trim(); const title = m[2].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim(); if (href && title) entries.push({href,title}); }
        return entries;
      }
      function resolveHref(baseDir, href) {
        const clean = String(href||'').trim();
        if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith('#') || clean.startsWith('../') || clean.startsWith('./')) return clean;
        return (baseDir||'') + clean.replace(/^\/+/,'');
      }
      function generateNcxFromTocXhtml(bookTitle, tocXhtml, baseDir='', fallbackFiles=[]) {
        const entries = extractNavEntriesFromTocXhtml(tocXhtml).map(i=>({href:resolveHref(baseDir,i.href),title:i.title}));
        const list = entries.length > 0 ? entries : fallbackFiles;
        const navPoints = list.map((item,i) => { const href=item.href||item; const title=item.title||String(href).split('/').pop(); return `  <navPoint id="np${i}" playOrder="${i+1}">\n    <navLabel><text>${xmlEscape(title)}</text></navLabel>\n    <content src="${xmlEscape(href)}"/>\n  </navPoint>`; }).join('\n');
        return `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head>\n    <meta name="dtb:uid" content="waka-book"/>\n    <meta name="dtb:depth" content="1"/>\n    <meta name="dtb:totalPageCount" content="0"/>\n    <meta name="dtb:maxPageNumber" content="0"/>\n  </head>\n  <docTitle><text>${xmlEscape(bookTitle)}</text></docTitle>\n  <navMap>\n${navPoints}\n  </navMap>\n</ncx>`;
      }
      function defaultCss() { return 'body{font-family:"Times New Roman",Georgia,serif;font-size:1em;line-height:1.7;margin:1em 1.5em;color:#1a1a1a;}h1,h2,h3{line-height:1.3;margin:1em 0 .5em;}p{margin:.5em 0;text-indent:1.5em;}img{max-width:100%;}'; }
      async function buildFromFiles(bookTitle, opfText, files) {
        if (!opfText || !String(opfText).trim()) throw new Error('content.opf is missing');
        const zip = new JSZip();
        zip.file('mimetype', mimetype(), { compression: 'STORE' });
        zip.file('META-INF/container.xml', containerXml());
        const oebps = zip.folder('OEBPS');
        addFile(oebps, 'content.opf', opfText);
        const entries = files instanceof Map ? Array.from(files.entries()) : Array.isArray(files) ? files : Object.entries(files||{});
        for (const entry of entries) {
          const href = Array.isArray(entry) ? entry[0] : entry.href;
          const value = Array.isArray(entry) ? entry[1] : entry.content;
          if (!href || normalizeFileName(href) === 'content.opf') continue;
          addFile(oebps, href, value);
        }
        const hasTocNcx = entries.some(e => normalizeFileName(Array.isArray(e)?e[0]:e.href) === 'toc.ncx');
        if (!hasTocNcx) {
          const tocEntry = entries.find(e => /(^|\/)toc\.xhtml$/i.test(normalizeFileName(Array.isArray(e)?e[0]:e.href)));
          const tocHref = tocEntry ? normalizeFileName(Array.isArray(tocEntry)?tocEntry[0]:tocEntry.href) : '';
          const tocBaseDir = tocHref ? tocHref.replace(/[^/]+$/,'') : '';
          const tocXhtml = tocEntry ? (Array.isArray(tocEntry)?tocEntry[1]:tocEntry.content) : '';
          const fallbackFiles = entries.map(e=>Array.isArray(e)?e[0]:e.href).filter(h=>/\.xhtml?$/i.test(String(h))&&!/(^|\/)toc\.xhtml$/i.test(String(h))).map(h=>({href:normalizeFileName(h),title:String(h).split('/').pop().replace(/\.xhtml?$/i,'')}));
          addFile(oebps, 'toc.ncx', generateNcxFromTocXhtml(bookTitle, String(tocXhtml||''), tocBaseDir, fallbackFiles));
        }
        if (!entries.some(e=>normalizeFileName(Array.isArray(e)?e[0]:e.href)==='style.css')) addFile(oebps, 'style.css', defaultCss());
        return zip.generateAsync({ type:'blob', mimeType:'application/epub+zip', compression:'DEFLATE', compressionOptions:{level:6} });
      }
      return { buildFromFiles };
    })();

    // ──────────────────────────────────────────────────────────────────────────
    // AUDIO CONTENT LOGIC (isolated world, /sach-noi/*)
    // ──────────────────────────────────────────────────────────────────────────
    if (IS_AUDIO) (function audioContentIsolated() {
      const CHAPTER_LIST_STORAGE_KEY = 'waka.audio.chapterList';
      let detectedPlaylistUrl = null;
      let chapterListPayload = loadStoredChapterList();
      let hasFullChapterList = !!(chapterListPayload && chapterListPayload.source === 'getListAudioFile');
      let isDownloading = false;
      let mutationTimer = null;

      function loadStoredChapterList() {
        try { const raw = window.localStorage.getItem(CHAPTER_LIST_STORAGE_KEY); if (!raw) return null; const p = JSON.parse(raw); return (p && Array.isArray(p.items)) ? p : null; } catch { return null; }
      }
      function persistChapterList(payload) { try { window.localStorage.setItem(CHAPTER_LIST_STORAGE_KEY, JSON.stringify(payload)); } catch {} }
      function getBookTitle() { return document.querySelector('h1')?.textContent?.trim() || document.title || 'waka-audio'; }
      function safeFileName(name) { return String(name||'waka-audio').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().replace(/\s+/g,'_').substring(0,100); }
      function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'),{href:url,download:filename,style:'display:none'});
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url),30_000);
      }
      function shouldShowChapterButton() { return hasFullChapterList || (chapterListPayload && Array.isArray(chapterListPayload.items) && chapterListPayload.items.length > 0); }

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
        chapterListPayload = payload; persistChapterList(payload);
        ensureDownloadAllButton();
      });
      window.addEventListener('__waka_audio_list_ready__', (e) => {
        const payload = e.detail;
        if (!payload || !Array.isArray(payload.items)) return;
        hasFullChapterList = true; chapterListPayload = payload; persistChapterList(payload);
        ensureDownloadAllButton();
      });

      // Playlist result từ interceptor
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
          const timer = setTimeout(function () { _dlAllPending.delete(reqId); reject(new Error('Timeout 12s – chapter ' + chapterId)); }, 12000);
          _dlAllPending.set(reqId, { resolve, reject, timer });
          window.dispatchEvent(new CustomEvent('__waka_fetch_playlist__', { detail: { reqId, contentId: String(contentId), chapterId: String(chapterId), action } }));
        });
      }
      async function fetchPlaylistUrl(contentId, chapterId) {
        const cache = window.__waka_playlist_cache__ || {};
        if (cache[String(chapterId)]) return cache[String(chapterId)];
        try { const url = await askInterceptorForPlaylist(contentId, chapterId, 'current'); if (url) return url; } catch (err) { console.warn('[Waka DL All] playlist fetch failed:', err.message); }
        return null;
      }

      // Progress overlays
      function ensureProgressUI() {
        let ui = document.getElementById('waka-dl-overlay');
        if (ui) return ui;
        ui = document.createElement('div');
        ui.id = 'waka-dl-overlay';
        ui.style.cssText = 'position:fixed;bottom:20px;right:20px;width:310px;background:#15151e;color:#e8e8e8;border-radius:14px;padding:18px 20px;box-shadow:0 6px 28px rgba(0,0,0,.5);font-family:system-ui,sans-serif;font-size:13px;z-index:2147483647;display:none';
        ui.innerHTML = `<div style="font-weight:700;font-size:14px;color:#e94560;margin-bottom:10px">Waka Audio Downloader</div><div id="waka-dl-status-text" style="margin-bottom:10px;line-height:1.5">Đang khởi động...</div><div style="background:#2a2a3a;border-radius:6px;height:7px;overflow:hidden"><div id="waka-dl-bar" style="width:0%;height:100%;background:#e94560;transition:width .4s"></div></div><div style="display:flex;justify-content:space-between;margin-top:6px;color:#888;font-size:11px"><span id="waka-dl-pct">0%</span><span id="waka-dl-eta"></span></div>`;
        document.body.appendChild(ui);
        return ui;
      }
      function showOverlay(msg) { const ui = ensureProgressUI(); document.getElementById('waka-dl-status-text').textContent = msg; document.getElementById('waka-dl-bar').style.width = '0%'; document.getElementById('waka-dl-pct').textContent = '0%'; ui.style.display = 'block'; }
      function updateOverlayProgress(current, total, msg) {
        const pct = total > 0 ? Math.round((current/total)*100) : 0;
        const bar = document.getElementById('waka-dl-bar'), pctEl = document.getElementById('waka-dl-pct'), statusEl = document.getElementById('waka-dl-status-text');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (statusEl && msg) statusEl.textContent = msg;
      }
      function updateOverlayStatus(msg) { const el = document.getElementById('waka-dl-status-text'); if (el) el.textContent = msg; }
      function hideOverlayAfter(ms) { setTimeout(()=>{ const ui = document.getElementById('waka-dl-overlay'); if (ui) ui.style.display='none'; }, ms); }

      // All-chapters overlay
      function ensureAllChaptersUI() {
        let ui = document.getElementById('waka-dl-all-overlay');
        if (ui) return ui;
        ui = document.createElement('div');
        ui.id = 'waka-dl-all-overlay';
        ui.style.cssText = 'position:fixed;bottom:20px;left:20px;width:360px;background:#0f0f1a;color:#e8e8e8;border-radius:14px;padding:18px 20px;box-shadow:0 6px 28px rgba(0,0,0,.6);font-family:system-ui,sans-serif;font-size:13px;z-index:2147483647;display:none';
        ui.innerHTML = `<div style="font-weight:700;font-size:14px;color:#7c3aed;margin-bottom:10px">Waka – Tải tất cả chương</div><div id="waka-all-chapter-name" style="margin-bottom:4px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Đang chuẩn bị...</div><div id="waka-all-status" style="color:#aaa;font-size:11px;margin-bottom:8px">Chương 0 / 0</div><div style="background:#2a2a3a;border-radius:6px;height:7px;overflow:hidden;margin-bottom:4px"><div id="waka-all-bar" style="width:0%;height:100%;background:#7c3aed;transition:width .3s"></div></div><div style="display:flex;justify-content:space-between;color:#888;font-size:11px;margin-bottom:10px"><span id="waka-all-pct">0%</span><span id="waka-all-count">0 / 0</span></div><div style="background:#1a1a2e;border-radius:6px;height:5px;overflow:hidden;margin-bottom:8px"><div id="waka-all-seg-bar" style="width:0%;height:100%;background:#e94560;transition:width .2s"></div></div><div style="color:#888;font-size:11px;display:flex;justify-content:space-between"><span id="waka-all-seg-txt">Segments: 0/0</span><button id="waka-all-stop-btn" style="background:#e94560;color:#fff;border:none;border-radius:8px;padding:2px 10px;cursor:pointer;font-size:11px">Dừng</button></div><div id="waka-all-log" style="margin-top:10px;max-height:80px;overflow-y:auto;font-size:10px;color:#888;line-height:1.6"></div>`;
        document.body.appendChild(ui);
        document.getElementById('waka-all-stop-btn').addEventListener('click', ()=>{ window.__waka_dl_all_stop__ = true; });
        return ui;
      }
      function updateAllOverlay({ chapterName, chapterIdx, chapterTotal, segCur, segTotal, logLine }) {
        const pct = chapterTotal > 0 ? Math.round((chapterIdx/chapterTotal)*100) : 0;
        const bar = document.getElementById('waka-all-bar'), pctEl = document.getElementById('waka-all-pct'), countEl = document.getElementById('waka-all-count'), statusEl = document.getElementById('waka-all-status'), nameEl = document.getElementById('waka-all-chapter-name'), segBar = document.getElementById('waka-all-seg-bar'), segTxt = document.getElementById('waka-all-seg-txt'), logEl = document.getElementById('waka-all-log');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (countEl) countEl.textContent = `${chapterIdx} / ${chapterTotal}`;
        if (statusEl) statusEl.textContent = `Chương ${chapterIdx} / ${chapterTotal}`;
        if (chapterName && nameEl) nameEl.textContent = chapterName;
        if (segCur !== undefined && segTotal !== undefined) { const sp = segTotal > 0 ? Math.round((segCur/segTotal)*100) : 0; if (segBar) segBar.style.width = sp + '%'; if (segTxt) segTxt.textContent = `Segments: ${segCur}/${segTotal}`; }
        if (logLine && logEl) { const span = document.createElement('div'); span.textContent = logLine; logEl.appendChild(span); logEl.scrollTop = logEl.scrollHeight; }
      }

      // Buttons
      function applyAudioButtonStyle(btn, active) {
        btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:${active?'#e94560':'#555'};color:#fff;border:none;border-radius:24px;font-size:13px;font-weight:600;cursor:${active?'pointer':'default'};margin:6px 0 6px 10px;transition:background .25s,opacity .2s;opacity:${active?'1':'0.6'};flex-shrink:0`;
        btn.title = active ? 'Tải audio này về máy (MP3)' : 'Nhấn Nghe sách trước để phát hiện audio';
        btn.innerHTML = 'Download MP3';
      }
      function activateAudioButton(btn) {
        applyAudioButtonStyle(btn, true);
        btn.addEventListener('mouseenter', ()=>btn.style.opacity='.82');
        btn.addEventListener('mouseleave', ()=>btn.style.opacity='1');
      }

      function applyDownloadAllButtonStyle(btn, active) {
        btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:${active?'#7c3aed':'#556'};color:#fff;border:none;border-radius:24px;font-size:13px;font-weight:600;cursor:${active?'pointer':'default'};margin:6px 0 6px 10px;transition:background .25s,opacity .2s;opacity:${active?'1':'0.6'};flex-shrink:0`;
        btn.title = active ? 'Auto download all chapters (AAC)' : 'Cần có chapters.json trước';
        btn.innerHTML = 'Tải tất cả';
      }

      async function handleDownloadClick() {
        if (isDownloading) return;
        if (!detectedPlaylistUrl) { alert('Hãy nhấn nút "Nghe sách" trên trang trước để phát hiện audio stream rồi thử lại!'); return; }
        isDownloading = true;
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const btn = document.getElementById('waka-dl-btn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'default'; btn.innerHTML = 'Đang tải...'; }
        showOverlay('Khởi tạo...');
        HLSDownloader.setCallbacks((current, total, msg) => updateOverlayProgress(current, total, msg), (msg) => updateOverlayStatus(msg));
        MP3Encoder.setCallbacks((msg) => updateOverlayStatus(msg), (pct, msg) => updateOverlayProgress(pct, 100, msg));
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
        } finally { isDownloading = false; audioCtx.close(); }
      }

      let isDownloadingAll = false;
      async function handleDownloadAllClick() {
        if (isDownloadingAll) { alert('Đang tải! Nhấn nút "Dừng" trong bảng tiến trình để hủy.'); return; }
        if (!shouldShowChapterButton() || !chapterListPayload) { alert('Chưa có danh sách chương. Hãy đợi tải xong chapters.'); return; }
        const items = [...(chapterListPayload.items||[])].sort((a,b)=>{ const ao=Number(a.order??0),bo=Number(b.order??0); return ao!==bo?ao-bo:Number(a.id??0)-Number(b.id??0); });
        const contentId = chapterListPayload.content_id;
        if (!contentId) { alert('Không tìm thấy content_id trong dữ liệu chương.'); return; }
        isDownloadingAll = true;
        const ui = ensureAllChaptersUI();
        window.__waka_dl_all_stop__ = false;
        ui.style.display = 'block';
        const btn = document.getElementById('waka-dl-all-btn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.innerHTML = 'Đang tải...'; }
        let success = 0, fail = 0;
        for (let i = 0; i < items.length; i++) {
          if (window.__waka_dl_all_stop__) { updateAllOverlay({ chapterName: '⛔ Đã dừng', chapterIdx: i, chapterTotal: items.length }); break; }
          const item = items[i];
          updateAllOverlay({ chapterName: `[${String(i+1).padStart(2,'0')}/${items.length}] ${item.name}`, chapterIdx: i, chapterTotal: items.length, segCur: 0, segTotal: 0 });
          try {
            const playlistUrl = await fetchPlaylistUrl(contentId, item.id);
            if (!playlistUrl) throw new Error('Không lấy được playlist URL');
            const aacData = await (async()=>{
              async function fetchBuf(url) { const r = await fetch(url,{credentials:'omit',cache:'no-store',mode:'cors'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }
              async function fetchTxt(url) { const r = await fetch(url,{credentials:'omit',cache:'no-store',mode:'cors'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
              function resolve(rel,base) { if(/^https?:\/\//i.test(rel)) return rel; return new URL(rel,base).href; }
              const masterTxt = await fetchTxt(playlistUrl);
              const lines = masterTxt.split('\n').map(l=>l.trim());
              let chunkUrl = playlistUrl, bw = 0;
              for (const l of lines) { if(l.startsWith('#EXT-X-STREAM-INF:')){ bw=1; continue; } if(bw&&!l.startsWith('#')&&l.length){ chunkUrl=resolve(l,playlistUrl); bw=0; break; } }
              const chunkTxt = await fetchTxt(chunkUrl);
              const clines = chunkTxt.split('\n').map(l=>l.trim());
              const segs = []; let key=null, seq=0;
              for (const l of clines) {
                if(l.startsWith('#EXT-X-MEDIA-SEQUENCE:')){ seq=parseInt(l.split(':')[1])||0; continue; }
                if(l.startsWith('#EXT-X-KEY:')){ const m=l.match(/METHOD=([^,\s]+)/i)?.[1]?.toUpperCase()??'NONE'; if(m==='NONE'){key=null;}else{const uri=l.match(/URI="([^"]+)"/i)?.[1]; const iv=l.match(/IV=0x([0-9a-fA-F]+)/i)?.[1]?.padStart(32,'0'); key={method:m,uri:uri?resolve(uri,chunkUrl):null,iv};} continue; }
                if(!l.startsWith('#')&&l.length){ segs.push({url:resolve(l,chunkUrl),key:key?{...key}:null,seq}); seq++; }
              }
              const _kc={};
              async function getKey(uri){ if(!_kc[uri]){_kc[uri]=await fetchBuf(uri);} return _kc[uri]; }
              function toIV(s){const iv=new Uint8Array(16);let n=s;for(let i=15;i>=0;i--){iv[i]=n&0xff;n=Math.floor(n/256);}return iv;}
              function hexIV(h){return Uint8Array.from(h.padStart(32,'0').match(/../g).map(x=>parseInt(x,16)));}
              const parts=[];
              for(let i=0;i<segs.length;i++){
                updateAllOverlay({chapterName:`[${String(items.indexOf(item)+1).padStart(2,'0')}/${items.length}] ${item.name}`,chapterIdx:items.indexOf(item),chapterTotal:items.length,segCur:i+1,segTotal:segs.length});
                const s=segs[i];
                const enc=await fetchBuf(s.url);
                if(s.key?.method==='AES-128'&&s.key.uri){const k=await getKey(s.key.uri);const iv=s.key.iv?hexIV(s.key.iv):toIV(s.seq);const ck=await crypto.subtle.importKey('raw',k,{name:'AES-CBC'},false,['decrypt']);const dec=await crypto.subtle.decrypt({name:'AES-CBC',iv},ck,enc);parts.push(new Uint8Array(dec));}
                else{parts.push(new Uint8Array(enc));}
              }
              const total=parts.reduce((s,b)=>s+b.length,0);const out=new Uint8Array(total);let off=0;for(const p of parts){out.set(p,off);off+=p.length;}return out;
            })();
            const pad3 = String(i+1).padStart(3,'0');
            const safeName = (item.name||`chapter_${item.id}`).replace(/[<>:"/\\|?*]/g,'').trim().replace(/\s+/g,'_');
            const filename = `${pad3}_${safeName}.aac`;
            const blob = new Blob([aacData],{type:'audio/aac'});
            triggerDownload(blob, filename);
            updateAllOverlay({ logLine: `✅ ${filename}`, chapterIdx: i+1, chapterTotal: items.length });
            success++;
          } catch (err) {
            updateAllOverlay({ logLine: `❌ [${item.name}] ${err.message}`, chapterIdx: i+1, chapterTotal: items.length });
            fail++;
          }
          if (i < items.length-1 && !window.__waka_dl_all_stop__) await new Promise(r=>setTimeout(r,1200));
        }
        updateAllOverlay({ chapterName: `Xong! ✅ ${success} thành công, ❌ ${fail} lỗi`, chapterIdx: items.length, chapterTotal: items.length, segCur:1, segTotal:1 });
        isDownloadingAll = false;
        setTimeout(()=>{ const ui=document.getElementById('waka-dl-all-overlay'); if(ui) ui.style.display='none'; },10000);
        if (btn) { btn.disabled=false; btn.style.opacity='1'; btn.innerHTML='Tải tất cả'; applyDownloadAllButtonStyle(btn, true); }
      }

      function injectButtons() {
        let anchor = null;
        const candidates = document.querySelectorAll('button,a,[role="button"],[aria-label],[class*="play" i],[class*="nghe" i]');
        for (const el of candidates) {
          const text = (el.textContent||'').replace(/\s+/g,' ').trim();
          const aria = (el.getAttribute('aria-label')||'').trim();
          const cls = (el.className||'').toString();
          const hasPlayIcon = !!el.querySelector('img[alt*="play" i],img[src*="icon-play" i],img[src*="play-o" i]');
          if (text.includes('Nghe sách')||text.includes('Nghe audio')||text==='Nghe'||/nghe/i.test(text)||/nghe/i.test(aria)||/play/i.test(aria)||/play/i.test(cls)||hasPlayIcon) { anchor = el; break; }
        }
        if (!anchor) return;
        const host = anchor.parentNode || anchor;
        const existingAudioBtn = document.getElementById('waka-dl-btn');
        if (!existingAudioBtn) {
          const audioBtn = document.createElement('button');
          audioBtn.id = 'waka-dl-btn';
          applyAudioButtonStyle(audioBtn, false);
          if (detectedPlaylistUrl) activateAudioButton(audioBtn);
          audioBtn.addEventListener('click', handleDownloadClick);
          host.insertBefore(audioBtn, anchor.nextSibling);
        } else if (detectedPlaylistUrl) { activateAudioButton(existingAudioBtn); }
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

      let mutTimerRef = null;
      const observer = new MutationObserver(()=>{ if(mutTimerRef) return; mutTimerRef=setTimeout(()=>{ mutTimerRef=null; injectButtons(); if(shouldShowChapterButton()) ensureDownloadAllButton(); },250); });
      function init() {
        if (!/\/sach-noi\//i.test(window.location.pathname)) return;
        injectButtons();
        if (shouldShowChapterButton()) ensureDownloadAllButton();
        observer.observe(document.body, {childList:true,subtree:true});
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
      else init();
    })();

    // ──────────────────────────────────────────────────────────────────────────
    // EBOOK CONTENT LOGIC (isolated world, /ebook/*)
    // ──────────────────────────────────────────────────────────────────────────
    if (IS_EBOOK) (function ebookContentIsolated() {
      let _downloadUrl = null;
      let _rawResponse = null;
      let _isBusy = false;

      function isOpfUrl(url) { return /\/content\.opf(\?|$)/i.test(String(url||'')); }
      function resolveUrl(href, base) { if(/^https?:\/\//i.test(href)) return href; try { return new URL(href,base).href; } catch { return base.replace(/\/$/,'')+'/'+href; } }
      async function fetchWithFallback(url) { let r=await fetch(url,{credentials:'omit',cache:'no-store'}); if(!r.ok) r=await fetch(url,{credentials:'include',cache:'no-store'}); return r; }
      function downloadBlob(blob, filename) {
        const u=URL.createObjectURL(blob);
        const a=Object.assign(document.createElement('a'),{href:u,download:filename,style:'display:none'});
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(u),30_000);
      }
      function getBookTitle() { return document.querySelector('h1')?.textContent?.trim()||document.title||'waka-ebook'; }
      function updateStatus(msg, isError) {
        let el = document.getElementById('waka-ebook-status');
        if (el) { el.textContent = msg; el.style.color = isError ? '#e94560' : '#9ca3af'; }
      }
      function setPrimaryLabel(label, enabled) {
        const btn = document.getElementById('waka-ebook-btn');
        if (btn) { btn.innerHTML = label; btn.disabled = !enabled; btn.style.cursor = enabled ? 'pointer' : 'default'; }
      }
      function updateBtnState() {
        if (!_downloadUrl) return;
        const label = isOpfUrl(_downloadUrl) ? '⬇&nbsp;Tải EPUB (OPF)' : '⬇&nbsp;Tải EPUB';
        setPrimaryLabel(label, true);
        const btn = document.getElementById('waka-ebook-btn');
        if (btn) { btn.style.background = '#e94560'; btn.style.opacity = '1'; }
      }
      function showToast(msg, isError) {
        let t = document.getElementById('waka-ebook-toast');
        if (!t) { t=Object.assign(document.createElement('div'),{id:'waka-ebook-toast'}); t.style.cssText='position:fixed;bottom:80px;right:20px;background:#111827;color:#f3f4f6;border-radius:12px;padding:12px 18px;font-size:13px;max-width:340px;z-index:2147483647;font-family:system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);transition:opacity .3s;pointer-events:none;line-height:1.5'; document.body.appendChild(t); }
        t.style.background = isError ? '#3b1a1a' : '#111827';
        t.textContent = msg; t.style.opacity='1';
        clearTimeout(t._tt);
        t._tt = setTimeout(()=>t.style.opacity='0', 5000);
      }

      async function downloadDirectFile(url) {
        updateStatus('Đang tải file EPUB...');
        const resp = await fetchWithFallback(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        const urlParts = url.split('/').pop().split('?')[0];
        const fname = urlParts || (WakaEpubDecode.safeName(getBookTitle()) + '.epub');
        downloadBlob(new Blob([buf], {type:'application/epub+zip'}), fname);
        updateStatus(`✅ Đã lưu: ${fname}`);
        showToast(`✅ Đã lưu: ${fname}`);
        setPrimaryLabel('✅&nbsp;Đã tải', true);
        document.getElementById('waka-ebook-btn').style.background = '#28a745';
      }

      async function buildEpubFromOpf(opfUrl) {
        const [opfPath, qs] = opfUrl.split('?');
        const token = qs ? '?' + qs : '';
        const oebpsDir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
        const opfResp = await fetchWithFallback(opfUrl);
        if (!opfResp.ok) throw new Error('OPF HTTP ' + opfResp.status);
        const opfText = await opfResp.text();
        if (!opfText.includes('<manifest')) throw new Error('OPF không hợp lệ');
        const parser = new DOMParser();
        const doc = parser.parseFromString(opfText, 'application/xml');
        const items = [];
        doc.querySelectorAll('manifest item').forEach(el => { const href=el.getAttribute('href'); if(href) items.push({href,type:el.getAttribute('media-type')||''}); });
        updateStatus(`Phát hiện ${items.length} file, đang tải...`);
        const files = new Map();
        let done=0, failed=0;
        for (let i=0; i<items.length; i+=5) {
          await Promise.all(items.slice(i,i+5).map(async(item)=>{
            const fileUrl = resolveUrl(item.href, oebpsDir) + token;
            try {
              let resp = await fetchWithFallback(fileUrl);
              if (!resp.ok) { if(item.href.includes('toc.ncx')||resp.status===404) return; throw new Error('HTTP '+resp.status); }
              const buf = await resp.arrayBuffer();
              const isTextFile = /\.(xhtml|html?|xml|ncx|css|js|json)$/i.test(item.href);
              files.set(item.href, isTextFile ? WakaEpubDecode.decodeFileSync(buf) : buf);
              done++;
            } catch(err) { failed++; console.warn('[Waka DL] File failed:', item.href, err.message); }
          }));
          updateStatus(`Đang tải file: ${done}/${items.length} · lỗi: ${failed}`);
        }
        if (files.size === 0) throw new Error('Không tải được file dữ liệu nào');
        updateStatus(`Đang giải mã và đóng gói ${files.size} file...`);
        const title = WakaEpubDecode.extractTitleFromOpf(opfText, getBookTitle());
        const blob = await EPUBBuilder.buildFromFiles(title, opfText, files);
        const fname = `${WakaEpubDecode.safeName(title)}.epub`;
        downloadBlob(blob, fname);
        const sizeMb = (blob.size/1024/1024).toFixed(2);
        const msg = `✅ Đã lưu: ${fname} · ${sizeMb}MB · ${files.size} file`;
        updateStatus(msg); showToast(msg);
        setPrimaryLabel('✅&nbsp;Đã tải', true);
        document.getElementById('waka-ebook-btn').style.background = '#28a745';
      }

      async function handleEbookClick() {
        if (_isBusy) return;
        if (!_downloadUrl) { showToast('Đang tìm link, vui lòng đợi...'); return; }
        _isBusy = true;
        setPrimaryLabel('⏳&nbsp;Đang xử lý...', false);
        const btn = document.getElementById('waka-ebook-btn');
        if (btn) { btn.style.background = '#555'; btn.style.opacity = '0.7'; }
        try {
          if (isOpfUrl(_downloadUrl)) await buildEpubFromOpf(_downloadUrl);
          else await downloadDirectFile(_downloadUrl);
        } catch(err) {
          console.error('[Waka DL]', err);
          updateStatus('❌ ' + err.message, true); showToast('❌ ' + err.message, true);
          setPrimaryLabel('⬇&nbsp;Thử lại', true);
          if (btn) { btn.style.background='#e94560'; btn.style.opacity='1'; }
        } finally { _isBusy = false; }
      }

      window.addEventListener('__waka_ebook_ready__', (e) => { _downloadUrl=e.detail.url; updateBtnState(); showToast(isOpfUrl(_downloadUrl)?'✅ Link OPF sẵn sàng!':'✅ Link EPUB sẵn sàng!'); });
      window.addEventListener('__waka_ebook_raw__', (e) => {
        _rawResponse = e.detail.raw;
        const candidates = [
          ...Array.from((_rawResponse.match(/"(https?:\/\/[^"]*(?:epub|book|download)[^"]*)"/gi)||[])).map(m=>m.slice(1,-1)),
        ];
        for (const c of candidates) { if(/^https?:\/\//i.test(c)){_downloadUrl=c; updateBtnState(); showToast(isOpfUrl(c)?'✅ Link OPF từ log panel':'✅ Link EPUB từ log panel'); return;} }
        setPrimaryLabel('🔍&nbsp;Xem response', true);
      });
      window.addEventListener('__waka_ebook_status__', (e) => { updateStatus(e.detail.msg, e.detail.isError); });

      function createEbookUI() {
        if (document.getElementById('waka-ebook-root')) return;
        const root = document.createElement('div');
        root.id = 'waka-ebook-root';
        root.style.cssText = 'position:fixed;bottom:24px;right:20px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif';
        const status = document.createElement('div');
        status.id = 'waka-ebook-status';
        status.style.cssText = 'background:rgba(15,15,25,.92);color:#9ca3af;font-size:11px;padding:4px 12px;border-radius:10px;max-width:280px;text-align:right;line-height:1.5;display:none';
        const btn = document.createElement('button');
        btn.id = 'waka-ebook-btn';
        btn.innerHTML = '⏳ Đang tìm EPUB...';
        btn.style.cssText = 'background:#555;color:#fff;border:none;border-radius:28px;padding:11px 22px;font-size:14px;font-weight:700;cursor:default;opacity:.55;box-shadow:0 4px 18px rgba(0,0,0,.4);transition:background .2s,opacity .2s;white-space:nowrap';
        btn.addEventListener('click', handleEbookClick);
        root.appendChild(status); root.appendChild(btn);
        document.body.appendChild(root);
      }

      if (document.body) createEbookUI();
      else new MutationObserver((_,obs)=>{ if(document.body){createEbookUI();obs.disconnect();} }).observe(document.documentElement,{childList:true});
    })();

    // ──────────────────────────────────────────────────────────────────────────
    // READER CONTENT LOGIC (isolated world, /reader/*)
    // ──────────────────────────────────────────────────────────────────────────
    if (IS_READER) (function readerContentIsolated() {
      let _epubUrl = null;
      let _title = 'Ebook';
      let _opfText = null;
      let _files = new Map();
      let _isBusy = false;
      let _isWaiting = false;

      window.addEventListener('__waka_epub_found__', (e) => { _epubUrl=e.detail.url; _title=e.detail.title||'Ebook'; activateBtn(); setStatus('Sẵn sàng, nhấn nút để tải!'); });
      window.addEventListener('__waka_epub_opf__', (e) => { _opfText=e.detail.text; });
      window.addEventListener('__waka_epub_file__', (e) => { _files.set(e.detail.href, e.detail.buffer); });
      window.addEventListener('__waka_epub_progress__', (e) => {
        setStatus(e.detail.msg||'');
        const btn=document.getElementById('wdl-btn');
        if(btn&&_isWaiting){ const d=e.detail.done||0,f=e.detail.failed||0,t=e.detail.total||0; btn.textContent=t>0?`⏳ ${d+f}/${t}`:'⏳ Đang tải...'; }
      });
      window.addEventListener('__waka_epub_done__', async (e) => {
        const {done,failed}=e.detail; _isWaiting=false;
        if(done===0&&failed>0){ setStatus(`Tất cả ${failed} file bị từ chối (403)`); const btn=document.getElementById('wdl-btn'); if(btn){btn.textContent='⬇ Thử lại';btn.disabled=false;btn.style.background='#e94560';} _isBusy=false; return; }
        setStatus(`Đang giải mã và đóng gói ${done} file...`);
        await buildAndDownload();
      });
      window.addEventListener('__waka_epub_error__', (e) => { _isWaiting=false; _isBusy=false; setStatus('Lỗi: '+(e.detail.msg||'Không xác định')); showToast('Lỗi: '+e.detail.msg,true); const btn=document.getElementById('wdl-btn'); if(btn){btn.textContent='⬇ Thử lại';btn.disabled=false;btn.style.background='#e94560';} });

      async function handleClick() {
        if(_isBusy) return;
        if(!_epubUrl){ showToast('Đang tìm EPUB URL, thử reload trang...'); return; }
        _isBusy=true; _isWaiting=true; _opfText=null; _files=new Map();
        const btn=document.getElementById('wdl-btn');
        if(btn){btn.textContent='⏳ Đang tải...';btn.disabled=true;}
        setStatus('Kết nối với server...');
        window.dispatchEvent(new CustomEvent('__waka_do_download__',{detail:{opfUrl:_epubUrl}}));
      }

      async function buildAndDownload() {
        try {
          const decodedFiles = new Map();
          let decodedCount = 0;
          for (const [href, buf] of _files) {
            if(!buf||buf.byteLength===0) continue;
            const fileName = WakaEpubDecode.normalizeFileName(href);
            const isTextFile = /\.(xhtml|html?)$/i.test(fileName);
            if(isTextFile){ try{ const decoded=WakaEpubDecode.decodeFileSync(buf); decodedFiles.set(fileName,decoded); decodedCount++; continue; }catch(err){ console.warn('[Waka DL] Decode failed:',fileName,err.message); } }
            decodedFiles.set(fileName, buf);
          }
          if(decodedFiles.size===0) throw new Error('Không có file nào để đóng gói');
          const title = WakaEpubDecode.extractTitleFromOpf(_opfText, _title||'waka-ebook');
          const blob = await EPUBBuilder.buildFromFiles(title, _opfText, decodedFiles);
          const fname = WakaEpubDecode.safeName(title)+'.epub';
          const url=URL.createObjectURL(blob);
          const a=Object.assign(document.createElement('a'),{href:url,download:fname,style:'display:none'});
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(()=>URL.revokeObjectURL(url),30_000);
          const size=(blob.size/1024/1024).toFixed(2);
          const msg=`Đã lưu: ${fname} · ${size}MB · ${decodedFiles.size} files (${decodedCount} decoded)`;
          setStatus(msg); showToast(msg);
          const btn=document.getElementById('wdl-btn');
          if(btn){btn.textContent='✅ Đã tải!';btn.style.background='#059669';btn.disabled=false;}
        } catch(err) {
          console.error('[Waka DL]',err); setStatus('Lỗi: '+err.message); showToast('Lỗi: '+err.message,true);
          const btn=document.getElementById('wdl-btn'); if(btn){btn.textContent='⬇ Thử lại';btn.disabled=false;btn.style.background='#e94560';}
        } finally { _isBusy=false; _isWaiting=false; }
      }

      let _placementObserver=null;

      function normalizeTitle(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
      function findTitleAnchor(){
        const wanted=normalizeTitle(_title);
        if(!wanted) return null;
        const sel='h1,h2,h3,[class*="title" i],[aria-label],[data-testid]';
        const candidates=Array.from(document.querySelectorAll(sel))
          .filter(el=>normalizeTitle(el.textContent)===wanted)
          .map(el=>{ const r=el.getBoundingClientRect(); return {el,left:r.left,top:r.top,area:r.width*r.height}; })
          .filter(item=>item.area>0);
        if(!candidates.length){
          for(const el of Array.from(document.querySelectorAll('*'))){
            if(normalizeTitle(el.textContent)!==wanted) continue;
            const r=el.getBoundingClientRect();
            if(r.width<=0||r.height<=0) continue;
            candidates.push({el,left:r.left,top:r.top,area:r.width*r.height});
          }
        }
        if(!candidates.length) return null;
        candidates.sort((a,b)=>a.left-b.left||a.top-b.top||a.area-b.area);
        return candidates[0].el;
      }
      function applyInlineRootStyle(root){
        root.style.cssText='display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin-top:10px;max-width:100%;width:fit-content;font-family:system-ui,-apple-system,sans-serif;position:static;z-index:1';
      }
      function applyFloatingRootStyle(root){
        root.style.cssText='position:fixed;right:20px;bottom:24px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif';
      }
      function createReaderUI() {
        if(document.getElementById('wdl-root')) return;
        const root=document.createElement('div');
        root.id='wdl-root';
        applyInlineRootStyle(root);
        const status=document.createElement('div');
        status.id='wdl-status';
        status.style.cssText='background:rgba(15,15,25,.92);color:#9ca3af;font-size:11px;padding:4px 12px;border-radius:10px;max-width:280px;text-align:right;line-height:1.5;display:none';
        const btn=document.createElement('button');
        btn.id='wdl-btn';
        btn.textContent='⏳ Đang tìm EPUB...';
        btn.style.cssText='background:#555;color:#fff;border:none;border-radius:14px;padding:11px 16px;font-size:14px;font-weight:700;cursor:default;opacity:.55;box-shadow:0 4px 18px rgba(0,0,0,.4);transition:background .2s,opacity .2s;white-space:nowrap';
        btn.addEventListener('click',handleClick);
        root.appendChild(status); root.appendChild(btn);
        document.body.appendChild(root);
      }
      function placeUI(){
        let root=document.getElementById('wdl-root');
        if(!root){ createReaderUI(); root=document.getElementById('wdl-root'); }
        if(!root) return;
        const titleAnchor=findTitleAnchor();
        if(titleAnchor&&titleAnchor.parentNode){
          applyInlineRootStyle(root);
          if(titleAnchor.nextElementSibling!==root) titleAnchor.insertAdjacentElement('afterend',root);
          return;
        }
        applyFloatingRootStyle(root);
        if(root.parentElement!==document.body) document.body.appendChild(root);
      }
      function startPlacementObserver(){
        if(_placementObserver) return;
        _placementObserver=new MutationObserver(()=>placeUI());
        _placementObserver.observe(document.documentElement,{childList:true,subtree:true});
      }

      function activateBtn() { placeUI(); const btn=document.getElementById('wdl-btn'); if(!btn) return; btn.textContent='⬇ Tải EPUB'; btn.style.background='#e94560'; btn.style.opacity='1'; btn.style.cursor='pointer'; btn.onmouseenter=()=>btn.style.opacity='.82'; btn.onmouseleave=()=>btn.style.opacity='1'; }
      function setStatus(msg) { let el=document.getElementById('wdl-status'); if(!el){placeUI();el=document.getElementById('wdl-status');} if(!el) return; el.style.display='block'; el.textContent=msg; }
      if(document.body) createReaderUI();
      else new MutationObserver((_,obs)=>{if(document.body){createReaderUI();obs.disconnect();}}).observe(document.documentElement,{childList:true});
    })();

  } // end runIsolatedLogic

  // Chạy isolated logic sau khi DOM idle
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runIsolatedLogic);
  } else {
    runIsolatedLogic();
  }

})();
