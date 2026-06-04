/**
 * interceptor.js
 * Runs in MAIN world to capture Waka network traffic.
 * - Detect playlist.m3u8 for audio download flow.
 * - Detect fm/getListAudioFile and fm/listNextBackFm to cache chapter list.
 *
 * Communicates with content.js via CustomEvent on window.
 */
(function () {
  'use strict';

  const PLAYLIST_REGEX = /vegacdn\.vn\/.+?\/playlist\.m3u8/;
  const GET_LIST_AUDIO_RE = /beta-api\.waka\.vn\/fm\/getListAudioFile\b/;
  const NEXT_BACK_AUDIO_RE = /beta-api\.waka\.vn\/fm\/listNextBackFm\b/;
  const DOWNLOAD_ITEM_RE = /beta-api\.waka\.vn\/fm\/getDownloadItem\b/;
  const CHAPTER_LIST_STORAGE_KEY = 'waka.audio.chapterList';

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function emitStreamDetected(url) {
    emit('__waka_stream__', { playlistUrl: url });
  }

  function emitChapterList(payload) {
    emit('__waka_audio_chapters__', payload);
  }

  function emitChapterListReady(payload) {
    emit('__waka_audio_list_ready__', payload);
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function parseQuery(url) {
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://' + url);
      const out = {};
      u.searchParams.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    } catch {
      return {};
    }
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

    for (const item of current.items || []) {
      if (item && item.id != null) map.set(String(item.id), item);
    }
    for (const item of payload.items || []) {
      if (item && item.id != null) map.set(String(item.id), item);
    }

    const mergedItems = Array.from(map.values()).sort((a, b) => {
      const ao = Number(a.order ?? 0);
      const bo = Number(b.order ?? 0);
      if (ao !== bo) return ao - bo;
      return Number(a.id ?? 0) - Number(b.id ?? 0);
    });

    const merged = {
      ...current,
      ...payload,
      items: mergedItems,
      count: mergedItems.length,
      updatedAt: payload.updatedAt,
    };

    window.__waka_audio_chapter_list__ = merged;
    try {
      window.localStorage.setItem(CHAPTER_LIST_STORAGE_KEY, JSON.stringify(merged));
    } catch {}

    emitChapterList(merged);
    if (payload.source === 'getListAudioFile') {
      emitChapterListReady(merged);
    }
    console.log('[Waka DL] Chapter list updated:', mergedItems.length, 'items');
  }

  if (!window.__waka_playlist_cache__) window.__waka_playlist_cache__ = {};
  if (!window.__waka_chapter_url_cache__) window.__waka_chapter_url_cache__ = {};

  function getChapterCache(chapterId) {
    if (chapterId == null || chapterId === '') return null;
    const key = String(chapterId);
    if (!window.__waka_chapter_url_cache__[key]) {
      window.__waka_chapter_url_cache__[key] = {};
    }
    return window.__waka_chapter_url_cache__[key];
  }

  function storePlaylistUrl(chapterId, playlistUrl, shouldEmitReady) {
    if (chapterId == null || !playlistUrl) return;

    const key = String(chapterId);
    window.__waka_playlist_cache__[key] = playlistUrl;

    const cache = getChapterCache(key);
    if (cache) {
      cache.playlistUrl = playlistUrl;
    }

    if (shouldEmitReady) {
      emit('__waka_playlist_ready__', { chapterId: key, playlistUrl });
    }
  }

  function cacheChapterRequestUrl(requestUrl) {
    if (typeof requestUrl !== 'string' || !requestUrl) return;
    if (!GET_LIST_AUDIO_RE.test(requestUrl) && !NEXT_BACK_AUDIO_RE.test(requestUrl) && !DOWNLOAD_ITEM_RE.test(requestUrl)) {
      return;
    }

    const meta = parseQuery(requestUrl);
    const chapterId = meta.chapter_id ?? meta.audio_file_id ?? meta.content_id ?? null;
    const cache = getChapterCache(chapterId);
    if (!cache) return;

    cache.apiUrl = requestUrl;
    cache.action = meta.action || cache.action || null;
    cache.content_id = meta.content_id ? Number(meta.content_id) : cache.content_id ?? null;
    cache.chapter_id = meta.chapter_id ? Number(meta.chapter_id) : cache.chapter_id ?? null;
  }

  // XMLHttpRequest
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

      if (PLAYLIST_REGEX.test(_url)) {
        emitStreamDetected(_url);
      }

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

  // fetch
  const nativeFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
        ? input.url
        : String(input);

    cacheChapterRequestUrl(url);

    const response = await nativeFetch(input, init);

    if (PLAYLIST_REGEX.test(url)) {
      emitStreamDetected(url);
    }

    if (GET_LIST_AUDIO_RE.test(url) || NEXT_BACK_AUDIO_RE.test(url)) {
      const clone = response.clone();
      clone
        .text()
        .then((text) => {
          const chapterPayload = extractChapterPayload(text, url);
          if (chapterPayload) mergeChapterList(chapterPayload);
          cacheChapterApiUrl(text, url);
        })
        .catch(() => {});
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
      for (const ad of obj.audio_data) {
        const u = findPlaylistUrl(ad, (depth || 0) + 1);
        if (u) return u;
      }
    }
    for (const key of Object.keys(obj)) {
      if (['thumb', 'raw', 'avatar', 'cover', 'image'].includes(key)) continue;
      const val = obj[key];
      if (Array.isArray(val)) {
        for (const el of val) {
          if (el && typeof el === 'object') {
            const u = findPlaylistUrl(el, (depth || 0) + 1);
            if (u) return u;
          }
        }
      } else if (val && typeof val === 'object') {
        const u = findPlaylistUrl(val, (depth || 0) + 1);
        if (u) return u;
      }
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
      const resp = await fetcher.getManual(api, {
        audio_file_id: String(chapterId),
      });

      const data = typeof fetcher.allResponse === 'function' ? fetcher.allResponse(resp) : resp && resp.data ? resp.data.data : null;
      const playlistUrl = findPlaylistUrl(data);
      if (playlistUrl) return playlistUrl;
      throw new Error('GET_DOWNLOAD_ITEM returned no playlist URL');
    }

    const params = new URLSearchParams({
      audio_file_id: String(chapterId),
    });
    const fallbackUrl = 'https://beta-api.waka.vn/fm/getDownloadItem?' + params;
    const resp = await nativeFetch(fallbackUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      referrer: 'https://waka.vn/',
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (!json || json.code !== 0) {
      throw new Error('API code=' + (json && json.code !== undefined ? json.code : 'unknown'));
    }
    const data = json.data?.data ?? json.data ?? null;
    return findPlaylistUrl(data);
  }

  // Proxy fetch cho content.js (isolated world)
  //
  // content.js -> CustomEvent '__waka_fetch_playlist__' {reqId, contentId, chapterId, action}
  // interceptor -> nativeFetch (MAIN world, cookie OK)
  // interceptor -> CustomEvent '__waka_playlist_result__' {reqId, playlistUrl, error}
  window.addEventListener('__waka_fetch_playlist__', async function (e) {
    const { reqId, contentId, chapterId, action } = e.detail || {};
    if (!reqId) return;

    const key = String(chapterId);
    const cachedPlaylist = window.__waka_playlist_cache__[key];
    if (cachedPlaylist) {
      emit('__waka_playlist_result__', { reqId, playlistUrl: cachedPlaylist });
      return;
    }

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
        const resp = await nativeFetch(apiUrl, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          referrer: 'https://waka.vn/',
        });

        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        const json = await resp.json();

        if (json.code !== 0) throw new Error('API code=' + json.code + ': ' + (json.message || ''));

        const data = json.data?.data ?? json.data ?? null;
        playlistUrl = findPlaylistUrl(data);
      } else {
        playlistUrl = await fetchPlaylistViaNuxt(contentId, chapterId, action);
      }

      if (playlistUrl) {
        storePlaylistUrl(key, playlistUrl, true);
      }

      emit('__waka_playlist_result__', { reqId: reqId, playlistUrl: playlistUrl });
    } catch (err) {
      emit('__waka_playlist_result__', { reqId: reqId, playlistUrl: null, error: err.message });
    }
  });

  console.log('[Waka DL] Interceptor ready (v3.8).');
})();
