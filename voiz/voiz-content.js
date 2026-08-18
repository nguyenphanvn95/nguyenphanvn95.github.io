/**
 * voiz-content.js
 * Downloader UI for voiz.vn playlist pages.
 * Mobile icon-only mode for compact buttons on phones.
 * Continuous listen (nghe liên tục) – same stream source as download, optional attach to site player.
 * v7.2: Professional Voiz-like mini-player panel (cover, layout, polish).
 * v7.3: Picture-in-Picture (PiP) for continuous player – canvas cover + Media Session + auto-PiP.
 */
(function () {
  'use strict';

  const API_BASE = 'https://api.voiz.vn/v1';
  const SIGNATURE_SECRET = 'eo2fd31%Dgy4k@sd69et&nkth*thlt&nn3288ltkc#08384nddl617PcWq5b5lhvltml1f^fd2@Oc#b8';
  const ICON_MODE_KEY = 'mydio.ui.iconMode'; // shared with Mydio content script
  const MAX_CONCURRENT = 4;

  let isDownloadingAll = false;
  let cancelRequested = false;
  let voizTokenCache = '';
  let iconModePref = 'auto';
  let lastIconMode = null;
  const stats = {
    total: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    queue: 0,
    running: new Set(),
  };
  const activeProgress = new Map();

  // ─── Continuous play state ────────────────────────────────────────────────
  let continuousChapters = null; // cached chapter list
  let continuousIndex = -1;
  let continuousPlaying = false;
  let continuousLoading = false;
  let continuousAbort = false;
  let continuousAudio = null; // our HTMLAudioElement
  let continuousBlobUrl = null;
  let continuousPreferSitePlayer = true;
  let continuousSiteAttached = false;
  let continuousPlaybackRate = 1;
  let continuousSeeking = false;
  let continuousDuration = 0;
  let continuousSleepTimerId = null;
  let continuousSleepDeadline = 0;
  let continuousSleepMode = 'off'; // off | end | minutes
  let continuousSleepMinutes = 0;
  let continuousSleepTickId = null;
  // ─── Picture-in-Picture state ─────────────────────────────────────────────
  let pipCanvas = null;
  let pipVideo = null;
  let pipActive = false;
  let pipMediaSessionBound = false;
  const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
  // Voiz-like sleep presets
  const SLEEP_PRESETS = [
    { id: 'off', label: 'Tắt', minutes: 0 },
    { id: 'end', label: 'Hết chương', minutes: -1 },
    { id: '5', label: '5p', minutes: 5 },
    { id: '10', label: '10p', minutes: 10 },
    { id: '15', label: '15p', minutes: 15 },
    { id: '30', label: '30p', minutes: 30 },
    { id: '45', label: '45p', minutes: 45 },
    { id: '60', label: '60p', minutes: 60 },
  ];

  const ICONS = {
    download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>',
    metadata: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
    all: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/><path d="M3 7h2"/><path d="M19 7h2"/></svg>',
    redownload: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>',
    next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
    prev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M18 18l-8.5-6L18 6v12zM6 6v12H4V6h2z"/></svg>',
    continuous: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>',
    spinner: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></path></svg>',
    pip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/><path d="M8 21h8"/></svg>',
  };

  function isMobileViewport() {
    try {
      if (window.matchMedia('(max-width: 768px)').matches) return true;
      if (window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 900) return true;
    } catch {}
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  function isIconMode() {
    if (iconModePref === 'always') return true;
    if (iconModePref === 'never') return false;
    return isMobileViewport();
  }

  function loadIconModePref() {
    try {
      try {
      const mode = localStorage.getItem(ICON_MODE_KEY) === 'white' ? 'white' : 'color';
      applyIconMode(mode);
    } catch {
      applyIconMode('color');
    }
    } catch {}
  }

  try {
    /* userscript: no chrome.storage.onChanged */
  } catch {}

  window.addEventListener('resize', () => {
    const now = isIconMode();
    if (now !== lastIconMode) refreshVoizButtons();
  });

  /** Only show toolkit UI on Voiz audio play pages: /play/<id> */
  function isVoizPlayPage() {
    try {
      return /voiz\.vn$/i.test(location.hostname) && /\/play\/\d+/i.test(location.pathname);
    } catch {
      return false;
    }
  }

  if (!isVoizPlayPage()) return;

  function playlistIdFromUrl() {
    return location.pathname.match(/\/play\/(\d+)/i)?.[1] || '';
  }

  function getPageToken() {
    try {
      const cookie = document.cookie
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith('token='));
      if (cookie) return decodeURIComponent(cookie.slice('token='.length));
    } catch {}
    try {
      return localStorage.getItem('token') || '';
    } catch {
      return '';
    }
  }

  async function getToken() {
    const pageToken = getPageToken();
    if (pageToken) {
      voizTokenCache = pageToken;
      return pageToken;
    }
    if (voizTokenCache) return voizTokenCache;
    try {
      const response = await sendMessage({ type: 'GET_VOIZ_TOKEN' });
      voizTokenCache = response?.token || '';
      return voizTokenCache;
    } catch {
      return '';
    }
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function safeFileName(name) {
    return String(name || 'voiz-audio')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 120);
  }

  function secondsToDuration(seconds) {
    seconds = Number(seconds || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getNextDataPlaylist() {
    try {
      const raw = document.getElementById('__NEXT_DATA__')?.textContent || '';
      return JSON.parse(raw)?.props?.pageProps?.playlist || null;
    } catch {
      return null;
    }
  }

  function getBookTitle() {
    const playlist = getNextDataPlaylist();
    return cleanText(playlist?.name || document.querySelector('h1')?.textContent || document.title.replace(/\s*-\s*VoizFM.*$/i, '')) || 'voiz-audio';
  }

  function getCoverUrl(playlist) {
    return (
      playlist?.avatar?.original_url ||
      playlist?.avatar?.thumb_url ||
      playlist?.headData?.avatar?.original_url ||
      document.querySelector('meta[property="og:image"]')?.content ||
      ''
    );
  }

  async function voizHeaders(extra = {}) {
    const token = await getToken();
    return {
      accept: 'application/json',
      'cache-control': 'no-store',
      pragma: 'no-cache',
      'x-authorization': token,
      ...extra,
    };
  }

  async function fetchJson(url, options = {}) {
    const baseHeaders = await voizHeaders();
    const response = await fetchWithRetry(url, {
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
      ...options,
      headers: {
        ...baseHeaders,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok || json?.code === 0) {
      throw new Error(json?.error || `HTTP ${response.status}`);
    }
    return json;
  }

  async function fetchWithRetry(url, options = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, options);
        if (response.ok) return response;
        lastError = new Error(`HTTP ${response.status}`);
      } catch (err) {
        lastError = err;
      }
      if (attempt < 3) await delay([1000, 2000, 4000][attempt]);
    }
    throw lastError || new Error('Fetch failed');
  }

  async function hmacSha256Hex(secret, message) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function getStreamingUrl(audioId) {
    const token = await getToken();
    const payload = `audio_id=${audioId}${token ? `&access_token=${token}` : ''}`;
    const signature = await hmacSha256Hex(SIGNATURE_SECRET, payload);
    const headers = {
      'x-signature': signature,
      'x-authorization': token || '',
    };

    // Prefer web streaming (best for free/VIP preview), then web files, then android_files (APK-style, often empty unless purchased)
    const endpoints = [
      `${API_BASE}/web/audios/${encodeURIComponent(audioId)}/streaming`,
      `${API_BASE}/web/audios/${encodeURIComponent(audioId)}/files`,
      `${API_BASE}/audios/${encodeURIComponent(audioId)}/android_files`,
    ];

    let lastError = null;
    for (const url of endpoints) {
      try {
        const json = await fetchJson(url, { headers });
        const playlistUrl = findPlaylistUrl(json);
        if (playlistUrl) return playlistUrl;
        lastError = new Error(`No m3u8 in response from ${url}`);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Voiz did not return an HLS playlist URL');
  }

  function findPlaylistUrl(value, seen = new Set()) {
    if (typeof value === 'string') return /\.m3u8(?:[?#]|$)/i.test(value) ? value : '';
    if (!value || typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    const values = Array.isArray(value) ? value : Object.values(value);
    for (const item of values) {
      const found = findPlaylistUrl(item, seen);
      if (found) return found;
    }
    return '';
  }

  async function getPlaylist() {
    return (await fetchJson(`${API_BASE}/playlists/${encodeURIComponent(playlistIdFromUrl())}`)).data;
  }

  async function getAllChapters(totalHint = 0) {
    const playlistId = playlistIdFromUrl();
    const limit = Math.max(50, Math.min(200, Number(totalHint || 0) || 100));
    let page = 1;
    const items = [];
    while (true) {
      const json = await fetchJson(`${API_BASE}/playlists/${encodeURIComponent(playlistId)}/audios?page=${page}&limit=${limit}`);
      const data = Array.isArray(json?.data) ? json.data : [];
      items.push(...data);
      if (!data.length || data.length < limit || (totalHint && items.length >= totalHint)) break;
      page++;
    }
    return items
      .filter((item) => item?.id != null)
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  }

  function chapterPath(book, item, index) {
    const no = String(Number(item.position || index + 1)).padStart(3, '0');
    return `${safeFileName(book)}/${no}_${safeFileName(item.name || `chapter_${item.id}`)}.aac`;
  }

  function metadataOpf(playlist, chapters) {
    const title = xmlEscape(playlist?.name || getBookTitle());
    const description = xmlEscape(playlist?.description || '');
    const author = xmlEscape(playlist?.author_string || (playlist?.authors || []).map((item) => item.name).join(', '));
    const publisher = xmlEscape(playlist?.channel?.name || '');
    const cover = xmlEscape(getCoverUrl(playlist));
    const chapterMeta = chapters
      .map((item, index) => `    <meta property="voiz:chapter" id="chapter-${xmlEscape(item.id)}">${xmlEscape(`${String(index + 1).padStart(3, '0')} ${item.name || item.id}`)}</meta>`)
      .join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
         xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:opf="http://www.idpf.org/2007/opf"
         unique-identifier="BookId"
         version="3.0">
  <metadata>
    <dc:title>${title}</dc:title>
${author ? `    <dc:creator opf:role="aut">${author}</dc:creator>\n` : ''}${publisher ? `    <dc:publisher>${publisher}</dc:publisher>\n` : ''}    <dc:language>vi</dc:language>
    <dc:description>${description}</dc:description>
    <dc:identifier id="BookId" opf:scheme="VOIZ">${xmlEscape(playlist?.id || playlistIdFromUrl())}</dc:identifier>
    <meta property="dcterms:modified">${xmlEscape(new Date().toISOString())}</meta>
    <meta property="voiz:url">${xmlEscape(location.href)}</meta>
${cover ? `    <meta property="voiz:cover">${cover}</meta>\n` : ''}${chapterMeta}
  </metadata>
</package>
`;
  }

  function xmlEscape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async function fetchText(url) {
    const response = await fetchWithRetry(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  async function fetchBuffer(url) {
    const response = await fetchWithRetry(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  function resolveUrl(value, base) {
    return /^https?:\/\//i.test(value) ? value : new URL(value, base).href;
  }

  async function downloadHls(playlistUrl, onProgress) {
    const text = await fetchText(playlistUrl);
    const segments = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => resolveUrl(line, playlistUrl));
    if (!segments.length) throw new Error('Playlist has no audio segments');

    const parts = [];
    for (let i = 0; i < segments.length; i++) {
      if (cancelRequested || continuousAbort) throw new Error('Cancelled');
      onProgress?.(i + 1, segments.length);
      parts.push(new Uint8Array(await fetchBuffer(segments[i])));
    }
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    parts.length = 0;
    return output;
  }

  /** True when extension was reloaded/updated and this content script is orphaned. */
  function isExtensionContextDead(err) {
    // Userscript: never treat as extension context dead
    return false;
  }

  let reloadScheduled = false;
  function softReloadPage(reason) {
    if (reloadScheduled) return;
    reloadScheduled = true;
    try {
      console.warn('[Voiz Toolkit] Auto-reload:', reason || 'extension context lost');
    } catch {}
    // Không hiện alert — reload ngay để content script mới gắn lại
    try {
      location.reload();
    } catch {
      try {
        window.location.href = window.location.href;
      } catch {}
    }
  }

  function sendMessage(message) {
    // Userscript: no background SW — handle locally
    return new Promise(async (resolve, reject) => {
      try {
        const type = message && message.type;
        if (type === 'GET_VOIZ_TOKEN') {
          let token = '';
          try {
            const m = document.cookie.match(/(?:^|;\s*)token=([^;]*)/);
            if (m) token = decodeURIComponent(m[1]);
          } catch {}
          if (!token) {
            try {
              token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
            } catch {}
          }
          resolve({ ok: true, token: token || '' });
          return;
        }
        if (type === 'CHECK_DOWNLOADED_BATCH') {
          const names = Array.isArray(message.filenames) ? message.filenames : [];
          const set = new Set();
          try {
            const raw = localStorage.getItem('voiz_us_downloaded');
            const arr = raw ? JSON.parse(raw) : [];
            names.forEach((n) => { if (arr.includes(n)) set.add(n); });
          } catch {}
          resolve({ ok: true, downloaded: Array.from(set) });
          return;
        }
        if (type === 'MARK_DOWNLOADED') {
          try {
            const raw = localStorage.getItem('voiz_us_downloaded');
            const arr = raw ? JSON.parse(raw) : [];
            if (message.filename && !arr.includes(message.filename)) arr.push(message.filename);
            localStorage.setItem('voiz_us_downloaded', JSON.stringify(arr.slice(-5000)));
          } catch {}
          resolve({ ok: true });
          return;
        }
        if (type === 'UNMARK_DOWNLOADED_BATCH') {
          try {
            const names = new Set(Array.isArray(message.filenames) ? message.filenames : []);
            const raw = localStorage.getItem('voiz_us_downloaded');
            let arr = raw ? JSON.parse(raw) : [];
            arr = arr.filter((n) => !names.has(n));
            localStorage.setItem('voiz_us_downloaded', JSON.stringify(arr));
          } catch {}
          resolve({ ok: true });
          return;
        }
        if (type === 'CLEAR_AUDIO_CACHE') {
          resolve({ ok: true, cleared: false, note: 'userscript: no browsingData API' });
          return;
        }
        if (type === 'PROXY_FETCH') {
          // Direct page fetch (same as site)
          const url = message.url;
          const responseType = message.responseType === 'arrayBuffer' ? 'arrayBuffer' : 'text';
          const resp = await fetch(url, {
            credentials: 'omit',
            cache: 'no-store',
            mode: 'cors',
            headers: message.headers || {},
          });
          if (!resp.ok) {
            resolve({ ok: false, error: 'HTTP ' + resp.status });
            return;
          }
          if (responseType === 'arrayBuffer') {
            const buf = await resp.arrayBuffer();
            // cannot transfer ArrayBuffer easily via JSON — mark unsupported for binary via message
            resolve({ ok: false, error: 'userscript: use direct fetchBuffer' });
          } else {
            resolve({ ok: true, text: await resp.text() });
          }
          return;
        }
        if (type === 'OPEN_NEW_TAB') {
          try { window.open(message.url, '_blank'); } catch {}
          resolve({ ok: true });
          return;
        }
        // default
        resolve({ ok: false, error: 'unsupported in userscript: ' + type });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function checkDownloadedBatch(filenames) {
    const res = await sendMessage({ type: 'CHECK_DOWNLOADED_BATCH', filenames });
    return res?.map && typeof res.map === 'object' ? res.map : {};
  }

  async function saveViaBackground(data, filename, meta = {}) {
    let blob = new Blob([data], { type: meta.type || 'audio/aac' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const response = await sendMessage({
        type: 'DOWNLOAD_FILE',
        id: `${meta.idPrefix || 'voiz'}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        filename,
        blob: blobUrl,
        book: meta.book || '',
        chapter: meta.chapter || '',
        skipIfExists: meta.skipIfExists !== false,
        conflictAction: meta.conflictAction || 'uniquify',
      });
      if (!response) throw new Error('No response from background');
      if (!response.ok && response.status !== 'skipped') throw new Error(response.error || 'Background download failed');
      return response;
    } finally {
      URL.revokeObjectURL(blobUrl);
      blob = null;
    }
  }

  async function downloadUrlViaBackground(url, filename, meta = {}) {
    const response = await sendMessage({
      type: 'DOWNLOAD_FILE',
      id: `${meta.idPrefix || 'voiz_url'}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      filename,
      blob: url,
      book: meta.book || '',
      chapter: meta.chapter || '',
      skipIfExists: meta.skipIfExists !== false,
      conflictAction: meta.conflictAction || 'uniquify',
    });
    if (!response?.ok && response?.status !== 'skipped') throw new Error(response?.error || 'Background download failed');
    return response;
  }

  async function requestAudioCacheCleanup(reason = 'auto') {
    try {
      return await sendMessage({ type: 'CLEAR_AUDIO_CACHE', reason });
    } catch (err) {
      console.warn('[Voiz DL] Cache cleanup failed:', err);
      return { ok: false, error: err.message };
    }
  }

  function createButton(id, text, title, handler, iconKey) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.dataset.fullText = text;
    btn.dataset.iconKey = iconKey || 'download';
    btn.title = title;
    btn.addEventListener('click', handler);
    applyVoizButtonStyle(btn, text, title, iconKey, false);
    return btn;
  }

  function applyVoizButtonStyle(btn, text, title, iconKey, busy) {
    if (!btn) return;
    const iconOnly = isIconMode();
    lastIconMode = iconOnly;
    if (title) btn.title = title;
    if (iconOnly) {
      btn.innerHTML = busy ? ICONS.spinner : (ICONS[iconKey] || ICONS.download);
      btn.setAttribute('aria-label', title || text || '');
      btn.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'width:44px',
        'height:44px',
        'min-height:44px',
        'padding:0',
        'background:#7c3aed',
        'color:#fff',
        'border:0',
        'border-radius:12px',
        'font-size:0',
        'line-height:0',
        'font-weight:700',
        'cursor:pointer',
        'margin:0',
        'box-shadow:0 2px 8px rgba(124,58,237,0.35)',
        'z-index:2147483645',
        busy ? 'opacity:0.75' : 'opacity:1',
      ].join(';');
    } else {
      btn.textContent = busy ? 'Downloading...' : text;
      btn.removeAttribute('aria-label');
      btn.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'min-height:36px',
        'padding:8px 14px',
        'background:#7c3aed',
        'color:#fff',
        'border:0',
        'border-radius:8px',
        'font-size:13px',
        'font-weight:700',
        'cursor:pointer',
        'margin:0',
        'z-index:2147483645',
        busy ? 'opacity:0.75' : 'opacity:1',
      ].join(';');
    }
  }

  function refreshVoizButtons() {
    const meta = document.getElementById('voiz-dl-meta-btn');
    if (meta) {
      applyVoizButtonStyle(
        meta,
        'Download metadata + cover',
        'Download metadata.opf and cover image',
        'metadata',
        false
      );
    }
    const all = document.getElementById('voiz-dl-all-btn');
    if (all) {
      applyVoizButtonStyle(
        all,
        'Download all Voiz chapters',
        'Download all available Voiz chapters',
        'all',
        isDownloadingAll
      );
    }
    const cont = document.getElementById('voiz-continuous-btn');
    if (cont) {
      applyVoizButtonStyle(
        cont,
        continuousPlaying || continuousLoading ? 'Đang nghe liên tục…' : 'Nghe liên tục',
        continuousPlaying || continuousLoading
          ? 'Đang phát các chương tiếp theo — bấm để dừng'
          : 'Nghe liên tục các chương tiếp theo (cùng nguồn stream với tải)',
        continuousPlaying || continuousLoading ? 'pause' : 'continuous',
        continuousLoading
      );
    }
  }

  // ─── Continuous listen (nghe liên tục) ────────────────────────────────────

  function findSiteMedia() {
    // Prefer visible audio/video in the player area
    const medias = Array.from(document.querySelectorAll('audio, video'));
    if (!medias.length) return null;
    // Prefer ones that already have a source or are playing
    const active = medias.find((m) => !m.paused || m.currentSrc || m.src);
    return active || medias[0];
  }

  function revokeContinuousBlob() {
    if (continuousBlobUrl) {
      try {
        URL.revokeObjectURL(continuousBlobUrl);
      } catch {}
      continuousBlobUrl = null;
    }
  }

  function getActiveMedia() {
    if (continuousSiteAttached) {
      const media = findSiteMedia();
      if (media) return media;
    }
    return continuousAudio || findSiteMedia();
  }

  function applyPlaybackRate(rate) {
    continuousPlaybackRate = rate;
    try {
      const media = getActiveMedia();
      if (media) media.playbackRate = rate;
    } catch {}
    const ui = document.getElementById('voiz-continuous-overlay');
    if (!ui) return;
    ui.querySelectorAll('[data-ct-rate]').forEach((btn) => {
      const r = Number(btn.dataset.ctRate);
      const active = r === rate;
      btn.style.background = active ? '#7c3aed' : '#374151';
      btn.style.fontWeight = active ? '700' : '500';
      btn.style.opacity = active ? '1' : '0.85';
    });
    const speedMain = ui.querySelector('[data-ct-speed-main]');
    if (speedMain) {
      speedMain.textContent = rate === 1 ? '1x' : `${rate}x`;
    }
  }

  function seekActiveMedia(seconds) {
    const media = getActiveMedia();
    if (!media || !Number.isFinite(seconds)) return;
    try {
      const dur = media.duration;
      if (Number.isFinite(dur) && dur > 0) {
        seconds = Math.max(0, Math.min(dur, seconds));
      }
      media.currentTime = seconds;
    } catch (err) {
      console.warn('[Voiz Continuous] Seek failed:', err);
    }
  }

  function ensureOwnAudio() {
    if (continuousAudio && continuousAudio.isConnected) return continuousAudio;
    continuousAudio = document.createElement('audio');
    continuousAudio.id = 'voiz-toolkit-continuous-audio';
    continuousAudio.preload = 'auto';
    continuousAudio.style.display = 'none';
    continuousAudio.playbackRate = continuousPlaybackRate;
    continuousAudio.addEventListener('ended', () => {
      if (continuousPlaying && !continuousAbort) {
        if (onChapterEndedForSleep()) return;
        playNextContinuousChapter();
      }
    });
    continuousAudio.addEventListener('error', () => {
      updateContinuousUI({ status: 'Lỗi phát audio — thử chương tiếp…' });
      if (continuousPlaying && !continuousAbort) {
        setTimeout(() => playNextContinuousChapter(), 800);
      }
    });
    continuousAudio.addEventListener('timeupdate', () => {
      if (!continuousAudio || continuousSeeking) return;
      const cur = continuousAudio.currentTime || 0;
      const dur = continuousAudio.duration || 0;
      continuousDuration = dur;
      updateContinuousUI({
        currentTime: cur,
        duration: dur,
      });
    });
    continuousAudio.addEventListener('loadedmetadata', () => {
      continuousDuration = continuousAudio.duration || 0;
      continuousAudio.playbackRate = continuousPlaybackRate;
    });
    document.body.appendChild(continuousAudio);
    return continuousAudio;
  }

  function clearSleepTimer() {
    if (continuousSleepTimerId) {
      clearTimeout(continuousSleepTimerId);
      continuousSleepTimerId = null;
    }
    if (continuousSleepTickId) {
      clearInterval(continuousSleepTickId);
      continuousSleepTickId = null;
    }
    continuousSleepDeadline = 0;
  }

  function formatSleepRemain(ms) {
    if (ms <= 0) return '0:00';
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateSleepUI() {
    const ui = document.getElementById('voiz-continuous-overlay');
    if (!ui) return;
    const labelEl = ui.querySelector('[data-ct-sleep-label]');
    const timerMain = ui.querySelector('[data-ct-timer-main]');
    ui.querySelectorAll('[data-ct-sleep]').forEach((btn) => {
      const id = btn.dataset.ctSleep;
      const active =
        id === continuousSleepMode ||
        (continuousSleepMode === 'minutes' && id === String(continuousSleepMinutes));
      btn.style.background = active ? '#7c3aed' : '#374151';
      btn.style.fontWeight = active ? '700' : '500';
      btn.style.opacity = active ? '1' : '0.85';
    });

    let short = '⏱';
    let long = 'Hẹn giờ: Tắt';
    if (continuousSleepMode === 'end') {
      short = 'Chương';
      long = 'Hẹn giờ: Hết chương này';
    } else if (continuousSleepMode === 'minutes' && continuousSleepDeadline > Date.now()) {
      short = formatSleepRemain(continuousSleepDeadline - Date.now());
      long = `Hẹn giờ: còn ${short}`;
    } else if (continuousSleepMode === 'minutes' && continuousSleepMinutes > 0) {
      short = `${continuousSleepMinutes}p`;
      long = `Hẹn giờ: ${continuousSleepMinutes} phút`;
    }
    if (timerMain) {
      timerMain.textContent = short;
      timerMain.title = long;
      const active = continuousSleepMode !== 'off';
      timerMain.style.background = active ? '#7c3aed' : '#374151';
    }
    if (labelEl) labelEl.textContent = long;
  }

  function fireSleepTimer() {
    clearSleepTimer();
    continuousSleepMode = 'off';
    continuousSleepMinutes = 0;
    updateContinuousUI({ status: 'Đã tắt theo hẹn giờ' });
    stopContinuousPlayback(true);
    updateSleepUI();
    // Keep panel visible briefly so user sees the message
    const ui = document.getElementById('voiz-continuous-overlay');
    if (ui) {
      setTimeout(() => {
        if (!continuousPlaying) {
          ui.style.display = 'none';
          restoreToolkitButtonsZ();
        }
      }, 2500);
    }
  }

  function setSleepTimer(presetId) {
    const preset = SLEEP_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    clearSleepTimer();

    if (preset.minutes === 0) {
      continuousSleepMode = 'off';
      continuousSleepMinutes = 0;
      updateSleepUI();
      return;
    }

    if (preset.minutes === -1) {
      continuousSleepMode = 'end';
      continuousSleepMinutes = 0;
      updateSleepUI();
      return;
    }

    continuousSleepMode = 'minutes';
    continuousSleepMinutes = preset.minutes;
    continuousSleepDeadline = Date.now() + preset.minutes * 60 * 1000;
    continuousSleepTimerId = setTimeout(() => fireSleepTimer(), preset.minutes * 60 * 1000);
    continuousSleepTickId = setInterval(() => {
      if (continuousSleepMode !== 'minutes') {
        clearSleepTimer();
        return;
      }
      if (Date.now() >= continuousSleepDeadline) {
        fireSleepTimer();
        return;
      }
      updateSleepUI();
    }, 1000);
    updateSleepUI();
  }

  function onChapterEndedForSleep() {
    // Called when a chapter ends — if sleep mode is "end of chapter", stop
    if (continuousSleepMode === 'end') {
      fireSleepTimer();
      return true;
    }
    return false;
  }

  function stopContinuousPlayback(keepUI = false) {
    continuousPlaying = false;
    continuousLoading = false;
    continuousAbort = true;
    continuousSiteAttached = false;
    clearSleepTimer();
    continuousSleepMode = 'off';
    continuousSleepMinutes = 0;
    try {
      if (continuousAudio) {
        continuousAudio.pause();
        continuousAudio.removeAttribute('src');
        continuousAudio.load();
      }
    } catch {}
    revokeContinuousBlob();
    // Also try to stop site media if we attached
    try {
      const media = findSiteMedia();
      if (media && media.dataset.voizToolkitAttached === '1') {
        media.pause();
        delete media.dataset.voizToolkitAttached;
      }
    } catch {}
    if (!keepUI) {
      const ui = document.getElementById('voiz-continuous-overlay');
      if (ui) ui.style.display = 'none';
    }
    exitPictureInPicture().catch(() => {});
    updateSleepUI();
    restoreToolkitButtonsZ();
    refreshVoizButtons();
  }

  // ─── Picture-in-Picture (canvas + video + Media Session) ─────────────────
  function ensurePipElements() {
    if (!pipCanvas) {
      pipCanvas = document.createElement('canvas');
      pipCanvas.width = 512;
      pipCanvas.height = 512;
      pipCanvas.style.display = 'none';
    }
    if (!pipVideo) {
      pipVideo = document.createElement('video');
      pipVideo.id = 'voiz-toolkit-pip-video';
      pipVideo.muted = true;
      pipVideo.playsInline = true;
      pipVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;right:0;z-index:-1';
      pipVideo.srcObject = pipCanvas.captureStream(15);
      document.body.appendChild(pipVideo);
      pipVideo.addEventListener('leavepictureinpicture', () => {
        pipActive = false;
        updatePipButtonState();
      });
    }
    return { canvas: pipCanvas, video: pipVideo };
  }

  function drawPipCover(coverUrl, title, chapter) {
    const { canvas } = ensurePipElements();
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve();

    return new Promise((resolve) => {
      const finish = (img) => {
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, 512, 512);
        if (img) {
          // Cover full-bleed, slightly darkened
          const scale = Math.max(512 / img.width, 512 / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (512 - w) / 2;
          const y = (512 - h) / 2;
          ctx.drawImage(img, x, y, w, h);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(0, 0, 512, 512);
        } else {
          // Gradient fallback
          const g = ctx.createLinearGradient(0, 0, 512, 512);
          g.addColorStop(0, '#4c1d95');
          g.addColorStop(1, '#7c3aed');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 512, 512);
          ctx.font = 'bold 96px system-ui,sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff';
          ctx.fillText('🎧', 256, 220);
        }
        // Title + chapter text at bottom
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 380, 512, 132);
        ctx.fillStyle = '#f9fafb';
        ctx.font = 'bold 28px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const t = (title || 'Voiz').slice(0, 36);
        ctx.fillText(t, 256, 400);
        if (chapter) {
          ctx.fillStyle = '#c4b5fd';
          ctx.font = '22px system-ui,sans-serif';
          ctx.fillText(String(chapter).slice(0, 40), 256, 444);
        }
        resolve();
      };

      if (!coverUrl) {
        finish(null);
        return;
      }
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => finish(image);
      image.onerror = () => finish(null);
      image.src = coverUrl;
    });
  }

  function bindPipMediaSession() {
    if (pipMediaSessionBound || !navigator.mediaSession) return;
    pipMediaSessionBound = true;
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        const audio = getActiveMedia();
        if (audio) audio.play().catch(() => {});
        if (document.pictureInPictureElement) document.pictureInPictureElement.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        const audio = getActiveMedia();
        if (audio) audio.pause();
        if (document.pictureInPictureElement) document.pictureInPictureElement.pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (continuousIndex > 0) playContinuousChapter(continuousIndex - 1);
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNextContinuousChapter();
      });
      // Auto-enter PiP when user switches tab (Chrome 134+)
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture', async () => {
          if (!pipActive) await enterPictureInPicture();
        });
      } catch {}
    } catch (e) {
      console.warn('[Voiz PiP] MediaSession handlers failed:', e);
    }
  }

  function updateMediaSessionMetadata() {
    if (!navigator.mediaSession) return;
    try {
      const playlist = getNextDataPlaylist();
      const coverUrl = getCoverUrl(playlist);
      const title = cleanText(playlist?.name || document.title) || 'Voiz';
      const chapter = continuousChapters?.[continuousIndex];
      const chapterName = chapter?.name || chapter?.title || (continuousIndex >= 0 ? `Chương ${continuousIndex + 1}` : '');
      const artwork = coverUrl
        ? [
            { src: coverUrl, sizes: '96x96', type: 'image/jpeg' },
            { src: coverUrl, sizes: '256x256', type: 'image/jpeg' },
            { src: coverUrl, sizes: '512x512', type: 'image/jpeg' },
          ]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: chapterName || title,
        artist: title,
        album: 'Voiz FM',
        artwork,
      });
    } catch {}
  }

  async function enterPictureInPicture() {
    if (!document.pictureInPictureEnabled) {
      updateContinuousUI({ status: 'Trình duyệt không hỗ trợ PiP' });
      return false;
    }
    try {
      const playlist = getNextDataPlaylist();
      const coverUrl = getCoverUrl(playlist);
      const title = cleanText(playlist?.name || document.title) || 'Voiz';
      const chapter = continuousChapters?.[continuousIndex];
      const chapterName = chapter?.name || chapter?.title || (continuousIndex >= 0 ? `Chương ${continuousIndex + 1}` : '');

      await drawPipCover(coverUrl, title, chapterName);
      const { video } = ensurePipElements();
      await video.play();
      if (document.pictureInPictureElement !== video) {
        await video.requestPictureInPicture();
      }
      pipActive = true;
      bindPipMediaSession();
      updateMediaSessionMetadata();
      updatePipButtonState();
      updateContinuousUI({ status: 'Đang phát PiP (nổi trên màn hình)' });
      return true;
    } catch (err) {
      console.warn('[Voiz PiP] enter failed:', err);
      updateContinuousUI({ status: `PiP lỗi: ${err.message || err}` });
      pipActive = false;
      updatePipButtonState();
      return false;
    }
  }

  async function exitPictureInPicture() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    } catch {}
    pipActive = false;
    updatePipButtonState();
  }

  async function togglePictureInPicture() {
    if (pipActive || document.pictureInPictureElement) {
      await exitPictureInPicture();
      updateContinuousUI({ status: continuousPlaying ? 'Đang phát' : '' });
    } else {
      await enterPictureInPicture();
    }
  }

  function updatePipButtonState() {
    const btn = document.querySelector('#voiz-continuous-overlay [data-ct-pip]');
    if (!btn) return;
    btn.style.background = pipActive
      ? 'linear-gradient(145deg,#8b5cf6,#6d28d9)'
      : 'rgba(55,65,81,0.9)';
    btn.title = pipActive ? 'Thoát Picture-in-Picture' : 'Bật Picture-in-Picture (nổi trên màn hình)';
  }

  function updateContinuousUI(opts = {}) {
    const ui = document.getElementById('voiz-continuous-overlay');
    if (!ui) return;
    const titleEl = ui.querySelector('[data-ct-title]');
    const statusEl = ui.querySelector('[data-ct-status]');
    const progressEl = ui.querySelector('[data-ct-progress]');
    const seekEl = ui.querySelector('[data-ct-seek]');
    const timeCurEl = ui.querySelector('[data-ct-time-cur]');
    const timeDurEl = ui.querySelector('[data-ct-time-dur]');
    const chapterEl = ui.querySelector('[data-ct-chapter]');

    if (opts.title != null && titleEl) titleEl.textContent = opts.title;
    if (opts.status != null && statusEl) statusEl.textContent = opts.status;
    if (opts.chapterLabel != null && chapterEl) chapterEl.textContent = opts.chapterLabel;

    if (typeof opts.currentTime === 'number' && typeof opts.duration === 'number' && opts.duration > 0) {
      continuousDuration = opts.duration;
      if (seekEl && !continuousSeeking) {
        seekEl.max = String(opts.duration);
        seekEl.value = String(opts.currentTime);
        seekEl.disabled = false;
      }
      if (timeCurEl) timeCurEl.textContent = secondsToDuration(opts.currentTime);
      if (timeDurEl) timeDurEl.textContent = secondsToDuration(opts.duration);
      if (progressEl) progressEl.style.display = '';
    } else if (opts.hideProgress) {
      if (progressEl) progressEl.style.display = 'none';
      if (seekEl) {
        seekEl.value = '0';
        seekEl.disabled = true;
      }
      if (timeCurEl) timeCurEl.textContent = '0:00';
      if (timeDurEl) timeDurEl.textContent = '0:00';
    }
  }

  function renderChapterList(ui) {
    const listEl = ui.querySelector('[data-ct-list]');
    if (!listEl || !continuousChapters) return;
    listEl.innerHTML = '';
    continuousChapters.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.index = String(index);
      const isCurrent = index === continuousIndex;
      row.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:10px',
        'width:100%',
        'text-align:left',
        'padding:9px 12px',
        'border:0',
        'border-radius:10px',
        'cursor:pointer',
        'font-size:12.5px',
        'line-height:1.35',
        'transition:background .12s',
        isCurrent
          ? 'background:linear-gradient(90deg,#7c3aed,#6d28d9);color:#fff;font-weight:600;box-shadow:0 2px 10px rgba(124,58,237,0.35)'
          : 'background:transparent;color:#e5e7eb',
      ].join(';');
      const no = String(index + 1).padStart(3, '0');
      const name = item.name || `Chương ${item.id}`;
      row.innerHTML = `<span style="flex:none;opacity:0.8;font-variant-numeric:tabular-nums;font-size:11px;min-width:28px">${no}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(name)}</span>${isCurrent ? '<span style="flex:none;font-size:10px">▶</span>' : ''}`;
      if (!isCurrent) {
        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.06)'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      }
      row.addEventListener('click', () => {
        const panel = ui.querySelector('[data-ct-list-panel]');
        if (panel) panel.style.display = 'none';
        const listBtn = ui.querySelector('[data-ct-list-toggle]');
        if (listBtn) listBtn.innerHTML = '<span style="opacity:0.9">☰</span> Danh sách chương';
        playContinuousChapter(index);
      });
      listEl.appendChild(row);
    });
    const currentRow = listEl.querySelector(`[data-index="${continuousIndex}"]`);
    if (currentRow) {
      try {
        currentRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch {}
    }
  }

  function ensureContinuousUI() {
    if (!isVoizPlayPage()) {
      const existing = document.getElementById('voiz-continuous-overlay');
      if (existing) existing.remove();
      return null;
    }
    let ui = document.getElementById('voiz-continuous-overlay');
    if (ui) {
      ui.style.display = 'flex';
      ui.style.zIndex = '2147483647';
      lowerToolkitButtonsZ();
      if (continuousChapters) renderChapterList(ui);
      return ui;
    }
    ui = document.createElement('div');
    ui.id = 'voiz-continuous-overlay';
    ui.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:max(16px, env(safe-area-inset-bottom, 16px))',
      'transform:translateX(-50%)',
      'width:min(440px, calc(100vw - 20px))',
      'max-height:min(82vh, 620px)',
      'display:flex',
      'flex-direction:column',
      'background:linear-gradient(180deg, #1a1f2e 0%, #111827 100%)',
      'color:#fff',
      'border:1px solid rgba(255,255,255,0.10)',
      'border-radius:16px',
      'box-shadow:0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(124,58,237,0.12)',
      'padding:12px 14px 14px',
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      'font-size:13px',
      'z-index:2147483647',
      'box-sizing:border-box',
      'gap:0',
      'backdrop-filter:blur(12px)',
      '-webkit-backdrop-filter:blur(12px)',
    ].join(';');

    ui.innerHTML = `
      <!-- Header: cover + meta + close -->
      <div style="display:flex;align-items:center;gap:12px;flex-shrink:0;margin-bottom:10px">
        <div data-ct-cover-wrap style="flex:none;width:48px;height:48px;border-radius:12px;overflow:hidden;background:#1f2937;border:1px solid rgba(255,255,255,0.08);box-shadow:0 4px 12px rgba(0,0,0,0.3)">
          <img data-ct-cover src="" alt="" style="width:100%;height:100%;object-fit:cover;display:none" />
          <div data-ct-cover-fallback style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;background:linear-gradient(135deg,#4c1d95,#7c3aed)">🎧</div>
        </div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <div data-ct-title style="font-weight:700;font-size:14px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#f9fafb"></div>
          <div data-ct-chapter style="font-size:11px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
          <div data-ct-status style="font-size:11px;color:#a78bfa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
        </div>
        <button data-ct-close title="Dừng nghe liên tục" style="flex:none;background:transparent;color:#9ca3af;border:0;font-size:20px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:8px;transition:color .15s">×</button>
      </div>

      <!-- Progress -->
      <div data-ct-progress style="display:none;flex-shrink:0;margin-bottom:10px">
        <input data-ct-seek type="range" min="0" max="100" value="0" step="0.1" disabled
          style="width:100%;margin:0;accent-color:#8b5cf6;cursor:pointer;height:6px;border-radius:999px;background:rgba(255,255,255,0.12)" />
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:#9ca3af;font-variant-numeric:tabular-nums">
          <span data-ct-time-cur>0:00</span>
          <span data-ct-time-dur>0:00</span>
        </div>
      </div>

      <!-- Transport controls (Voiz-style) -->
      <div style="display:flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0;margin-bottom:4px">
        <button data-ct-speed-main type="button" title="Tốc độ phát" style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:36px;padding:0 8px;border:0;border-radius:10px;background:rgba(55,65,81,0.9);color:#e5e7eb;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:0.02em">1x</button>
        <button data-ct-prev title="Chương trước" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:0;border-radius:50%;background:rgba(55,65,81,0.9);color:#fff;cursor:pointer">${ICONS.prev}</button>
        <button data-ct-toggle title="Tạm dừng / Tiếp tục" style="display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border:0;border-radius:50%;background:linear-gradient(145deg,#8b5cf6,#6d28d9);color:#fff;cursor:pointer;box-shadow:0 4px 16px rgba(124,58,237,0.45)">${ICONS.pause}</button>
        <button data-ct-next title="Chương tiếp" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:0;border-radius:50%;background:rgba(55,65,81,0.9);color:#fff;cursor:pointer">${ICONS.next}</button>
        <button data-ct-pip type="button" title="Bật Picture-in-Picture (nổi trên màn hình)" style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:0;border-radius:10px;background:rgba(55,65,81,0.9);color:#e5e7eb;cursor:pointer">${ICONS.pip}</button>
        <button data-ct-timer-main type="button" title="Hẹn giờ tắt" style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:36px;padding:0 6px;border:0;border-radius:10px;background:rgba(55,65,81,0.9);color:#e5e7eb;cursor:pointer;font-size:12px;font-weight:700">⏱</button>
      </div>

      <!-- Expandable panels -->
      <div data-ct-speed-panel style="display:none;flex-shrink:0;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px 0 4px"></div>
      <div data-ct-sleep-panel style="display:none;flex-shrink:0;flex-direction:column;gap:6px;padding:8px 0 4px">
        <div data-ct-sleep-label style="font-size:11px;color:#9ca3af;text-align:center">Hẹn giờ: Tắt</div>
        <div data-ct-sleep-presets style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center"></div>
      </div>

      <!-- Chapter list toggle -->
      <button data-ct-list-toggle type="button" style="flex-shrink:0;width:100%;margin-top:6px;padding:9px 12px;border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(31,41,55,0.8);color:#e5e7eb;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
        <span style="opacity:0.9">☰</span> Danh sách chương
      </button>
      <div data-ct-list-panel style="display:none;flex:1;min-height:0;flex-direction:column;gap:4px;overflow:hidden;margin-top:8px">
        <div data-ct-list style="flex:1;min-height:120px;max-height:min(40vh,300px);overflow:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:2px;padding:2px 0;scrollbar-width:thin"></div>
      </div>
    `;

    // Cover
    try {
      const playlist = getNextDataPlaylist();
      const coverUrl = getCoverUrl(playlist);
      const img = ui.querySelector('[data-ct-cover]');
      const fallback = ui.querySelector('[data-ct-cover-fallback]');
      if (coverUrl && img) {
        img.src = coverUrl;
        img.onload = () => {
          img.style.display = 'block';
          if (fallback) fallback.style.display = 'none';
        };
        img.onerror = () => {
          img.style.display = 'none';
          if (fallback) fallback.style.display = 'flex';
        };
      }
    } catch {}

    ui.querySelector('[data-ct-close]')?.addEventListener('click', () => stopContinuousPlayback(false));
    ui.querySelector('[data-ct-prev]')?.addEventListener('click', () => {
      if (continuousIndex > 0) playContinuousChapter(continuousIndex - 1);
    });
    ui.querySelector('[data-ct-next]')?.addEventListener('click', () => playNextContinuousChapter());
    ui.querySelector('[data-ct-toggle]')?.addEventListener('click', () => {
      const audio = getActiveMedia();
      if (!audio) return;
      if (audio.paused) {
        audio.play().catch(() => {});
        const btn = ui.querySelector('[data-ct-toggle]');
        if (btn) btn.innerHTML = ICONS.pause;
      } else {
        audio.pause();
        const btn = ui.querySelector('[data-ct-toggle]');
        if (btn) btn.innerHTML = ICONS.play;
      }
    });
    ui.querySelector('[data-ct-pip]')?.addEventListener('click', () => {
      togglePictureInPicture();
    });
    updatePipButtonState();

    // Seekable progress bar
    const seekEl = ui.querySelector('[data-ct-seek]');
    if (seekEl) {
      const onSeekStart = () => { continuousSeeking = true; };
      const onSeekMove = () => {
        const t = Number(seekEl.value) || 0;
        const curEl = ui.querySelector('[data-ct-time-cur]');
        if (curEl) curEl.textContent = secondsToDuration(t);
      };
      const onSeekEnd = () => {
        const t = Number(seekEl.value) || 0;
        seekActiveMedia(t);
        continuousSeeking = false;
      };
      seekEl.addEventListener('pointerdown', onSeekStart);
      seekEl.addEventListener('touchstart', onSeekStart, { passive: true });
      seekEl.addEventListener('input', onSeekMove);
      seekEl.addEventListener('change', onSeekEnd);
      seekEl.addEventListener('pointerup', onSeekEnd);
      seekEl.addEventListener('touchend', onSeekEnd);
    }

    function hideExtraPanels(except) {
      const speedPanel = ui.querySelector('[data-ct-speed-panel]');
      const sleepPanel = ui.querySelector('[data-ct-sleep-panel]');
      const listPanel = ui.querySelector('[data-ct-list-panel]');
      const listBtn = ui.querySelector('[data-ct-list-toggle]');
      if (except !== 'speed' && speedPanel) speedPanel.style.display = 'none';
      if (except !== 'sleep' && sleepPanel) sleepPanel.style.display = 'none';
      if (except !== 'list' && listPanel) {
        listPanel.style.display = 'none';
        if (listBtn) listBtn.innerHTML = '<span style="opacity:0.9">☰</span> Danh sách chương';
      }
    }

    // Speed panel
    const speedPanel = ui.querySelector('[data-ct-speed-panel]');
    if (speedPanel) {
      PLAYBACK_RATES.forEach((rate) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.ctRate = String(rate);
        btn.textContent = rate === 1 ? '1x' : `${rate}x`;
        btn.title = `Tốc độ ${rate}x`;
        btn.style.cssText = [
          'border:0',
          'border-radius:8px',
          'padding:7px 12px',
          'font-size:12px',
          'line-height:1.2',
          'cursor:pointer',
          'color:#fff',
          'background:#374151',
          'opacity:0.9',
          'font-weight:600',
        ].join(';');
        btn.addEventListener('click', () => {
          applyPlaybackRate(rate);
          speedPanel.style.display = 'none';
        });
        speedPanel.appendChild(btn);
      });
      applyPlaybackRate(continuousPlaybackRate);
    }
    ui.querySelector('[data-ct-speed-main]')?.addEventListener('click', () => {
      if (!speedPanel) return;
      const open = speedPanel.style.display === 'none' || !speedPanel.style.display;
      hideExtraPanels('speed');
      speedPanel.style.display = open ? 'flex' : 'none';
    });

    // Sleep timer panel
    const sleepHost = ui.querySelector('[data-ct-sleep-presets]');
    const sleepPanel = ui.querySelector('[data-ct-sleep-panel]');
    if (sleepHost) {
      SLEEP_PRESETS.forEach((preset) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.ctSleep = preset.id;
        btn.textContent = preset.label;
        btn.title =
          preset.minutes === 0
            ? 'Tắt hẹn giờ'
            : preset.minutes === -1
              ? 'Tắt khi hết chương hiện tại'
              : `Tắt sau ${preset.minutes} phút`;
        btn.style.cssText = [
          'border:0',
          'border-radius:8px',
          'padding:7px 12px',
          'font-size:12px',
          'line-height:1.2',
          'cursor:pointer',
          'color:#fff',
          'background:#374151',
          'opacity:0.9',
          'font-weight:600',
        ].join(';');
        btn.addEventListener('click', () => {
          setSleepTimer(preset.id);
          if (sleepPanel) sleepPanel.style.display = 'none';
        });
        sleepHost.appendChild(btn);
      });
      updateSleepUI();
    }
    ui.querySelector('[data-ct-timer-main]')?.addEventListener('click', () => {
      if (!sleepPanel) return;
      const open = sleepPanel.style.display === 'none' || !sleepPanel.style.display;
      hideExtraPanels('sleep');
      sleepPanel.style.display = open ? 'flex' : 'none';
    });

    ui.querySelector('[data-ct-list-toggle]')?.addEventListener('click', () => {
      const panel = ui.querySelector('[data-ct-list-panel]');
      const btn = ui.querySelector('[data-ct-list-toggle]');
      if (!panel) return;
      const open = panel.style.display === 'none' || !panel.style.display;
      hideExtraPanels('list');
      if (open) {
        panel.style.display = 'flex';
        if (btn) btn.innerHTML = '<span style="opacity:0.9">☰</span> Ẩn danh sách';
        renderChapterList(ui);
      } else {
        panel.style.display = 'none';
        if (btn) btn.innerHTML = '<span style="opacity:0.9">☰</span> Danh sách chương';
      }
    });

    // Hover polish for close
    const closeBtn = ui.querySelector('[data-ct-close]');
    if (closeBtn) {
      closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#f9fafb'; });
      closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#9ca3af'; });
    }

    document.body.appendChild(ui);
    lowerToolkitButtonsZ();
    return ui;
  }

  function lowerToolkitButtonsZ() {
    const wrap = document.getElementById('voiz-dl-wrap');
    if (wrap) wrap.style.zIndex = '2147483645';
    ['voiz-dl-meta-btn', 'voiz-dl-all-btn', 'voiz-continuous-btn'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.zIndex = '2147483645';
    });
  }

  function restoreToolkitButtonsZ() {
    const wrap = document.getElementById('voiz-dl-wrap');
    if (wrap) wrap.style.zIndex = '2147483646';
    ['voiz-dl-meta-btn', 'voiz-dl-all-btn', 'voiz-continuous-btn'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.zIndex = '2147483646';
    });
  }

  async function tryAttachToSitePlayer(m3u8Url) {
    if (!continuousPreferSitePlayer) return false;
    const media = findSiteMedia();
    if (!media) return false;
    try {
      // Native HLS (Safari / iOS) often works with direct m3u8
      media.dataset.voizToolkitAttached = '1';
      media.src = m3u8Url;
      media.load();
      media.playbackRate = continuousPlaybackRate;
      await media.play();
      continuousSiteAttached = true;

      // Hook ended once
      const onEnded = () => {
        media.removeEventListener('ended', onEnded);
        if (continuousPlaying && !continuousAbort) {
          if (onChapterEndedForSleep()) return;
          playNextContinuousChapter();
        }
      };
      media.addEventListener('ended', onEnded);

      media.addEventListener('timeupdate', function onTu() {
        if (!continuousSiteAttached) {
          media.removeEventListener('timeupdate', onTu);
          return;
        }
        if (continuousSeeking) return;
        continuousDuration = media.duration || 0;
        updateContinuousUI({
          currentTime: media.currentTime || 0,
          duration: media.duration || 0,
        });
      });
      return true;
    } catch (err) {
      console.warn('[Voiz Continuous] Site player attach failed, fallback to own audio:', err);
      try {
        media.removeAttribute('src');
        delete media.dataset.voizToolkitAttached;
      } catch {}
      continuousSiteAttached = false;
      return false;
    }
  }

  async function playContinuousChapter(index) {
    if (!continuousChapters || index < 0 || index >= continuousChapters.length) {
      updateContinuousUI({ status: 'Hết danh sách chương' });
      continuousPlaying = false;
      refreshVoizButtons();
      return;
    }
    continuousAbort = false;
    continuousPlaying = true;
    continuousLoading = true;
    continuousIndex = index;
    continuousSiteAttached = false;
    refreshVoizButtons();
    const ui = ensureContinuousUI();
    // Keep list highlight in sync when jumping chapters
    if (ui && ui.querySelector('[data-ct-list-panel]')?.style.display !== 'none') {
      renderChapterList(ui);
    }

    const item = continuousChapters[index];
    const label = `${String(index + 1).padStart(3, '0')} / ${String(continuousChapters.length).padStart(3, '0')}`;
    const title = item.name || `Chương ${item.id}`;
    updateContinuousUI({
      chapterLabel: label,
      title,
      status: 'Đang lấy stream…',
      hideProgress: true,
    });

    try {
      const playlistUrl = await getStreamingUrl(item.id);
      if (continuousAbort) return;

      // 1) Try attach to site player with m3u8 (best when native HLS works)
      const attached = await tryAttachToSitePlayer(playlistUrl);
      if (attached) {
        continuousLoading = false;
        updateContinuousUI({
          status: 'Đang phát trên trình phát trang (HLS)',
        });
        updateMediaSessionMetadata();
        if (pipActive) {
          const playlist = getNextDataPlaylist();
          drawPipCover(getCoverUrl(playlist), cleanText(playlist?.name || document.title) || 'Voiz', title).catch(() => {});
        }
        refreshVoizButtons();
        return;
      }

      // 2) Fallback: download full chapter AAC (same as download pipeline) → play as blob
      updateContinuousUI({ status: 'Đang tải stream (giống luồng download)…' });
      let data = await downloadHls(playlistUrl, (current, total) => {
        if (continuousAbort) throw new Error('Cancelled');
        updateContinuousUI({
          status: `Tải segment ${current}/${total}…`,
        });
      });
      if (continuousAbort) {
        data = null;
        return;
      }

      revokeContinuousBlob();
      const blob = new Blob([data], { type: 'audio/aac' });
      data = null;
      continuousBlobUrl = URL.createObjectURL(blob);
      const audio = ensureOwnAudio();
      audio.src = continuousBlobUrl;
      audio.playbackRate = continuousPlaybackRate;
      continuousLoading = false;
      updateContinuousUI({ status: 'Đang phát (player riêng)' });
      await audio.play();
      const toggleBtn = document.querySelector('#voiz-continuous-overlay [data-ct-toggle]');
      if (toggleBtn) toggleBtn.innerHTML = ICONS.pause;
      updateMediaSessionMetadata();
      if (pipActive) {
        const playlist = getNextDataPlaylist();
        drawPipCover(getCoverUrl(playlist), cleanText(playlist?.name || document.title) || 'Voiz', title).catch(() => {});
      }
      refreshVoizButtons();
    } catch (err) {
      continuousLoading = false;
      if (String(err.message || '').includes('Cancelled')) return;
      console.error('[Voiz Continuous] Chapter failed:', item, err);
      updateContinuousUI({ status: `Lỗi: ${err.message}` });
      // Auto-skip to next after short delay
      if (continuousPlaying && !continuousAbort) {
        setTimeout(() => playNextContinuousChapter(), 1200);
      } else {
        refreshVoizButtons();
      }
    }
  }

  function playNextContinuousChapter() {
    if (!continuousChapters) return;
    const next = continuousIndex + 1;
    if (next >= continuousChapters.length) {
      updateContinuousUI({ status: 'Đã hết tất cả chương' });
      continuousPlaying = false;
      refreshVoizButtons();
      return;
    }
    playContinuousChapter(next);
  }

  async function handleContinuousPlay() {
    if (continuousPlaying || continuousLoading) {
      stopContinuousPlayback(false);
      return;
    }
    try {
      ensureContinuousUI();
      updateContinuousUI({
        title: getBookTitle(),
        status: 'Đang tải danh sách chương…',
        chapterLabel: '',
        hideProgress: true,
      });
      continuousLoading = true;
      refreshVoizButtons();

      const playlist = await getPlaylist();
      continuousChapters = await getAllChapters(playlist?.playlist_counter?.audios_count || 0);
      if (!continuousChapters.length) {
        updateContinuousUI({ status: 'Không tìm thấy chương nào' });
        continuousLoading = false;
        refreshVoizButtons();
        return;
      }

      // Start from the beginning (or first available). User can skip with Next.
      continuousIndex = -1;
      continuousPlaying = true;
      continuousAbort = false;
      playContinuousChapter(0);
    } catch (err) {
      continuousLoading = false;
      continuousPlaying = false;
      alert(`Nghe liên tục thất bại: ${err.message}`);
      console.error('[Voiz Continuous] Start failed:', err);
      refreshVoizButtons();
    }
  }

  /**
   * Find official listen CTAs: "Nghe chương đầu miễn phí" and optional "Nghe thử".
   * Returns { first, tryBtn, row } where row is the shared parent when available.
   */
  function findListenCtas() {
    const buttons = Array.from(document.querySelectorAll('button'));
    const listenFirst = buttons.find((b) => {
      if (b.closest('#voiz-dl-wrap') || b.id?.startsWith('voiz-')) return false;
      return /nghe\s*chương\s*đầu|nghe\s*chuong\s*dau|nghe chương đầu miễn phí/i.test(
        (b.textContent || '').replace(/\s+/g, ' ').trim()
      );
    });
    const listenTry = buttons.find((b) => {
      if (b.closest('#voiz-dl-wrap') || b.id?.startsWith('voiz-')) return false;
      // Avoid matching random buttons; require "Nghe thử" style label
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      return /^(nghe\s*thử|nghe\s*thu)$/i.test(t) || /^🎧?\s*nghe\s*thử/i.test(t) || /nghe\s*thử/i.test(t);
    });

    if (!listenFirst && !listenTry) return null;

    let row = null;
    if (listenFirst && listenTry && listenFirst.parentElement === listenTry.parentElement) {
      row = listenFirst.parentElement;
    } else if (listenFirst) {
      row = listenFirst.parentElement;
    } else if (listenTry) {
      row = listenTry.parentElement;
    }
    return { first: listenFirst || null, tryBtn: listenTry || null, row };
  }

  function hideListenCtas(ctas) {
    if (!ctas) return;
    [ctas.first, ctas.tryBtn].forEach((btn) => {
      if (!btn) return;
      if (btn.dataset.voizHidden === '1') return;
      btn.dataset.voizHidden = '1';
      btn.dataset.voizPrevDisplay = btn.style.display || '';
      btn.style.display = 'none';
      btn.setAttribute('aria-hidden', 'true');
    });
  }

  /** Hide "Thêm vào giỏ hàng" / "Mua gói VIP" and similar commerce CTAs. */
  function hideCommerceCtas() {
    const candidates = Array.from(
      document.querySelectorAll('button, a, [role="button"]')
    );
    for (const el of candidates) {
      if (el.closest('#voiz-dl-wrap') || el.closest('#voiz-continuous-overlay')) continue;
      if (el.id?.startsWith('voiz-') || el.dataset.voizHidden === '1') continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (
        !/thêm\s*vào\s*giỏ(\s*hàng)?|mua\s*gói\s*vip|mua\s*vip|nâng\s*cấp\s*(gói\s*)?vip|đăng\s*ký\s*vip/i.test(
          text
        )
      ) {
        continue;
      }
      el.dataset.voizHidden = '1';
      el.dataset.voizPrevDisplay = el.style.display || '';
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
      // Also hide a shared parent row if it only holds commerce buttons
      try {
        const parent = el.parentElement;
        if (parent && parent !== document.body) {
          const visibleSiblings = Array.from(parent.children).filter((c) => {
            if (c === el) return false;
            const st = window.getComputedStyle(c);
            return st.display !== 'none' && st.visibility !== 'hidden';
          });
          const onlyCommerce =
            visibleSiblings.length > 0 &&
            visibleSiblings.every((c) => {
              const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
              return /thêm\s*vào\s*giỏ|mua\s*(gói\s*)?vip|nâng\s*cấp\s*vip|đăng\s*ký\s*vip/i.test(t);
            });
          if (onlyCommerce || visibleSiblings.length === 0) {
            // Hide remaining commerce siblings too
            visibleSiblings.forEach((c) => {
              if (c.dataset.voizHidden === '1') return;
              c.dataset.voizHidden = '1';
              c.dataset.voizPrevDisplay = c.style.display || '';
              c.style.display = 'none';
              c.setAttribute('aria-hidden', 'true');
            });
            if (!parent.dataset.voizHidden) {
              parent.dataset.voizHidden = '1';
              parent.dataset.voizPrevDisplay = parent.style.display || '';
              parent.style.display = 'none';
            }
          }
        }
      } catch {}
    }
  }

  /**
   * Prefer replacing the listen-button row.
   * Fallback to cover image / title / audio list for older layouts.
   */
  function findCoverAnchor() {
    const ctas = findListenCtas();
    if (ctas?.row) return ctas.row;
    if (ctas?.first) return ctas.first.parentElement || ctas.first;
    if (ctas?.tryBtn) return ctas.tryBtn.parentElement || ctas.tryBtn;

    // 2) Largest visible playlist/cover image in the main player area
    const imgs = Array.from(document.querySelectorAll('img'));
    let best = null;
    let bestArea = 0;
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (!/avatar|cover|upload|playlist|filename/i.test(src) && !/voiz-prod\.s3/i.test(src)) continue;
      const rect = img.getBoundingClientRect();
      const w = rect.width || img.naturalWidth || 0;
      const h = rect.height || img.naturalHeight || 0;
      if (w < 80 || h < 80) continue;
      const area = w * h;
      const topBias = rect.top >= 0 && rect.top < window.innerHeight * 0.65 ? 1.5 : 1;
      const score = area * topBias;
      if (score > bestArea) {
        bestArea = score;
        best = img;
      }
    }
    if (best) {
      return (
        best.closest('.avatar-container') ||
        best.closest('[class*="avatar"]') ||
        best.parentElement ||
        best
      );
    }

    const title =
      document.querySelector('h1') ||
      document.querySelector('[class*="player-detail"] h1, [class*="player-detail"] p');
    if (title) return title;

    const listBtn = Array.from(document.querySelectorAll('button, [role="button"], p, div, span')).find(
      (el) => /danh sách audio/i.test(el.textContent || '')
    );
    if (listBtn) return listBtn.closest('button, [role="button"]') || listBtn;

    return null;
  }

  /** Remove all toolkit UI when leaving /play/<id> (SPA navigation). */
  function removeVoizToolkitUI() {
    try {
      if (continuousPlaying || continuousLoading) {
        stopContinuousPlayback(false);
      }
    } catch {}
    try {
      const wrap = document.getElementById('voiz-dl-wrap');
      if (wrap) wrap.remove();
    } catch {}
    try {
      const ct = document.getElementById('voiz-continuous-overlay');
      if (ct) ct.remove();
    } catch {}
    try {
      const dl = document.getElementById('voiz-dl-overlay');
      if (dl) dl.remove();
    } catch {}
  }

  function ensureButtons() {
    // SPA: hide toolkit completely outside audio play pages
    if (!isVoizPlayPage()) {
      removeVoizToolkitUI();
      return;
    }

    // Always try to hide official listen CTAs when present
    const ctas = findListenCtas();
    if (ctas) hideListenCtas(ctas);
    // Hide cart / VIP purchase buttons
    hideCommerceCtas();

    const existing = document.getElementById('voiz-dl-wrap');
    if (existing) {
      if (lastIconMode !== isIconMode()) refreshVoizButtons();
      // Re-home into the listen row when SPA re-renders it
      if (ctas?.row && existing.parentElement !== ctas.row) {
        placeWrapInListenRow(existing, ctas.row);
      } else if (!ctas) {
        const anchor = findCoverAnchor();
        if (
          anchor &&
          !anchor.contains(existing) &&
          existing.previousElementSibling !== anchor &&
          existing.parentElement !== anchor.parentElement
        ) {
          placeWrapAfterAnchor(existing, anchor);
        }
      }
      return;
    }

    const wrap = document.createElement('div');
    wrap.id = 'voiz-dl-wrap';
    wrap.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:10px',
      'margin:0',
      'padding:0',
      'justify-content:center',
      'align-items:center',
      'position:relative',
      'z-index:2147483645',
      'width:100%',
      'box-sizing:border-box',
    ].join(';');
    wrap.appendChild(
      createButton(
        'voiz-dl-meta-btn',
        'Download metadata + cover',
        'Download metadata.opf and cover image',
        handleMetadataDownload,
        'metadata'
      )
    );
    wrap.appendChild(
      createButton(
        'voiz-dl-all-btn',
        'Download all Voiz chapters',
        'Download all available Voiz chapters',
        handleDownloadAll,
        'all'
      )
    );
    wrap.appendChild(
      createButton(
        'voiz-continuous-btn',
        'Nghe liên tục',
        'Nghe liên tục các chương tiếp theo (cùng nguồn stream với tải) — gắn vào trình phát trang nếu được',
        handleContinuousPlay,
        'continuous'
      )
    );

    if (ctas?.row) {
      placeWrapInListenRow(wrap, ctas.row);
    } else {
      const anchor = findCoverAnchor();
      if (anchor) {
        placeWrapAfterAnchor(wrap, anchor);
      } else {
        const host =
          Array.from(document.querySelectorAll('button')).find((btn) =>
            /nghe|play|mua|vip/i.test(btn.textContent || '')
          )?.parentElement ||
          document.querySelector('main') ||
          document.body;
        if (!host) return;
        host.appendChild(wrap);
      }
    }
  }

  /** Put toolkit buttons inside the same row that held the official listen CTAs. */
  function placeWrapInListenRow(wrap, row) {
    if (!row) return;
    // Keep row layout; hide original children already done via hideListenCtas
    if (wrap.parentElement !== row) {
      row.appendChild(wrap);
    }
    wrap.style.width = '100%';
    wrap.style.margin = '0';
    wrap.style.padding = '0';
    // Encourage the row to look like a single control strip
    try {
      const cs = window.getComputedStyle(row);
      if (cs.display === 'flex' || cs.display === 'inline-flex') {
        row.style.flexWrap = row.style.flexWrap || 'wrap';
        row.style.justifyContent = row.style.justifyContent || 'center';
        row.style.alignItems = row.style.alignItems || 'center';
        row.style.gap = row.style.gap || '10px';
      }
    } catch {}
  }

  function placeWrapAfterAnchor(wrap, anchor) {
    // Fallback: place under cover / title when no listen row exists
    const parent = anchor.parentNode;
    if (!parent) {
      document.body.appendChild(wrap);
      return;
    }
    if (anchor.nextSibling) {
      parent.insertBefore(wrap, anchor.nextSibling);
    } else {
      parent.appendChild(wrap);
    }
    wrap.style.width = '100%';
  }

  function resetStats(total) {
    stats.total = total || 0;
    stats.completed = 0;
    stats.skipped = 0;
    stats.failed = 0;
    stats.queue = total || 0;
    stats.running.clear();
    activeProgress.clear();
  }

  function ensureProgressUI() {
    // Only show download panel on play pages (SPA-safe)
    if (!isVoizPlayPage()) {
      const existing = document.getElementById('voiz-dl-overlay');
      if (existing) existing.remove();
      return null;
    }
    let ui = document.getElementById('voiz-dl-overlay');
    if (ui) {
      ui.style.display = 'flex';
      return ui;
    }
    ui = document.createElement('div');
    ui.id = 'voiz-dl-overlay';
    ui.dataset.minimized = '0';
    ui.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:max(12px, env(safe-area-inset-bottom, 12px))',
      'transform:translateX(-50%)',
      'width:min(380px, calc(100vw - 24px))',
      'max-height:min(68vh, 460px)',
      'display:flex',
      'flex-direction:column',
      'background:#111827',
      'color:#fff',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:12px',
      'box-shadow:0 16px 48px rgba(0,0,0,0.45)',
      'padding:12px 14px',
      'font-family:system-ui,-apple-system,Arial,sans-serif',
      'font-size:13px',
      'z-index:2147483647',
      'box-sizing:border-box',
      'overflow:hidden',
      'transition:padding .15s ease,max-height .15s ease',
    ].join(';');
    ui.innerHTML = `
      <div data-header style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-shrink:0">
        <strong data-title style="font-size:14px;flex-shrink:0">Voiz download</strong>
        <span data-icon-mini style="display:none;flex-shrink:0;color:#c4b5fd;line-height:0" title="Voiz download">${ICONS.download.replace('width="18" height="18"', 'width="16" height="16"')}</span>
        <div data-pct-header style="flex:1;min-width:0;color:#c4b5fd;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;display:none;letter-spacing:0.02em"></div>
        <div style="display:flex;align-items:center;gap:2px;flex-shrink:0">
          <button data-minimize title="Thu gọn" style="background:transparent;color:#fff;border:0;font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;opacity:0.85">−</button>
          <button data-close title="Cancel All" style="background:transparent;color:#fff;border:0;font-size:18px;line-height:1;cursor:pointer;padding:2px 6px;opacity:0.85">×</button>
        </div>
      </div>
      <div data-body style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden">
        <div data-name style="font-weight:700;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0"></div>
        <div data-pct style="color:#c4b5fd;font-size:12px;margin-bottom:4px;letter-spacing:0.02em;flex-shrink:0"></div>
        <div data-status style="color:#d1d5db;margin-bottom:4px;font-size:12px;flex-shrink:0"></div>
        <div data-stats style="color:#9ca3af;font-size:11px;margin-bottom:6px;line-height:1.4;flex-shrink:0"></div>
        <div data-running style="color:#fde68a;font-size:11px;margin-bottom:6px;min-height:1.1em;flex-shrink:0"></div>
        <div data-actions style="display:none;flex-shrink:0;margin-bottom:8px;gap:8px;align-items:center">
          <button data-redownload type="button" title="Tải lại toàn bộ cuốn này (bỏ qua skip)" style="display:inline-flex;align-items:center;gap:6px;background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">
            ${ICONS.redownload.replace('width="18" height="18"', 'width="15" height="15"')}
            <span>Tải lại toàn bộ</span>
          </button>
        </div>
        <div data-scroll style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;-webkit-overflow-scrolling:touch">
          <div data-active style="display:grid;gap:6px"></div>
          <div data-log style="color:#d1d5db;font-size:11px;line-height:1.4"></div>
        </div>
      </div>
    `;
    ui.querySelector('[data-close]')?.addEventListener('click', () => {
      cancelRequested = true;
      const statusEl = ui.querySelector('[data-status]');
      if (statusEl) statusEl.textContent = 'Cancelling… running tasks will finish';
    });
    ui.querySelector('[data-redownload]')?.addEventListener('click', () => {
      const actions = ui.querySelector('[data-actions]');
      if (actions) actions.style.display = 'none';
      handleDownloadAll({ force: true });
    });
    ui.querySelector('[data-minimize]')?.addEventListener('click', () => {
      const minimized = ui.dataset.minimized === '1';
      const next = !minimized;
      ui.dataset.minimized = next ? '1' : '0';
      const body = ui.querySelector('[data-body]');
      const pctHeader = ui.querySelector('[data-pct-header]');
      const pctBody = ui.querySelector('[data-pct]');
      const header = ui.querySelector('[data-header]');
      const minBtn = ui.querySelector('[data-minimize]');
      const titleEl = ui.querySelector('[data-title]');
      const iconMini = ui.querySelector('[data-icon-mini]');
      if (body) body.style.display = next ? 'none' : 'flex';
      if (titleEl) titleEl.style.display = next ? 'none' : '';
      if (iconMini) iconMini.style.display = next ? 'inline-flex' : 'none';
      if (pctHeader) {
        pctHeader.style.display = next ? 'block' : 'none';
        if (next && pctBody) pctHeader.textContent = pctBody.textContent || '';
      }
      if (header) header.style.marginBottom = next ? '0' : '8px';
      ui.style.padding = next ? '10px 14px' : '12px 14px';
      ui.style.maxHeight = next ? 'none' : 'min(68vh, 460px)';
      if (minBtn) {
        minBtn.textContent = next ? '+' : '−';
        minBtn.title = next ? 'Mở rộng' : 'Thu gọn';
      }
    });
    document.body.appendChild(ui);
    return ui;
  }

  function barVisual(pct) {
    const filled = Math.max(0, Math.min(20, Math.round(pct / 5)));
    return '█'.repeat(filled) + '░'.repeat(20 - filled);
  }

  function renderActiveProgress(ui) {
    const activeEl = ui.querySelector('[data-active]');
    if (!activeEl) return;
    activeEl.textContent = '';
    for (const item of activeProgress.values()) {
      const pct = item.total > 0 ? Math.round((item.current / item.total) * 100) : 0;
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 8px;align-items:center';

      const title = document.createElement('div');
      title.style.cssText =
        'font-weight:700;color:#f9fafb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px';
      title.textContent = item.title;

      const status = document.createElement('div');
      status.style.cssText = 'color:#d1d5db;text-align:right;white-space:nowrap;font-size:11px';
      status.textContent = item.status || `${pct}%`;

      const track = document.createElement('div');
      track.style.cssText =
        'grid-column:1 / -1;height:6px;background:#374151;border-radius:999px;overflow:hidden';

      const bar = document.createElement('div');
      bar.style.cssText = `height:100%;width:${pct}%;background:#8b5cf6;transition:width .2s`;
      track.appendChild(bar);

      row.appendChild(title);
      row.appendChild(status);
      row.appendChild(track);
      activeEl.appendChild(row);
    }
  }

  function updateProgress({ name = '', current = 0, total = 0, status = '', logLine = '', forceStats = false, taskKey = '', taskTitle = '', taskDone = false } = {}) {
    const ui = ensureProgressUI();
    if (!ui) return;
    if (taskKey) {
      if (taskDone) activeProgress.delete(taskKey);
      else activeProgress.set(taskKey, { title: taskTitle || name || taskKey, current, total, status });
    }
    const done = stats.completed + stats.skipped + stats.failed;
    const pct =
      stats.total > 0
        ? Math.round((done / stats.total) * 100)
        : total > 0
          ? Math.round((current / total) * 100)
          : 0;

    const nameEl = ui.querySelector('[data-name]');
    const pctEl = ui.querySelector('[data-pct]');
    const statusEl = ui.querySelector('[data-status]');
    const statsEl = ui.querySelector('[data-stats]');
    const runningEl = ui.querySelector('[data-running]');
    const logEl = ui.querySelector('[data-log]');

    if (nameEl && name && !taskKey) nameEl.textContent = name;
    const pctText = `${barVisual(pct)}  ${pct}%`;
    if (pctEl) pctEl.textContent = pctText;
    const pctHeader = ui.querySelector('[data-pct-header]');
    if (pctHeader) pctHeader.textContent = pctText;
    if (statusEl && status) statusEl.textContent = status;

    if (statsEl && (forceStats || stats.total > 0)) {
      statsEl.textContent = [
        `Downloading ${done} / ${stats.total}`,
        `Queue: ${Math.max(0, stats.queue)}`,
        `Completed: ${stats.completed}`,
        `Skipped: ${stats.skipped}`,
        `Failed: ${stats.failed}`,
      ].join(' · ');
    }

    if (runningEl) {
      runningEl.textContent = stats.running.size
        ? `Running: ${[...stats.running].join(', ')}`
        : '';
    }

    renderActiveProgress(ui);

    if (logEl && logLine) {
      const line = document.createElement('div');
      line.textContent = logLine;
      logEl.appendChild(line);
      // Keep log from growing forever – keep last ~80 lines
      while (logEl.childElementCount > 80) logEl.removeChild(logEl.firstChild);
      const scroll = ui.querySelector('[data-scroll]');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function handleMetadataDownload() {
    try {
      const playlist = await getPlaylist();
      const chapters = await getAllChapters(playlist?.playlist_counter?.audios_count || 0);
      const book = safeFileName(playlist?.name || getBookTitle());
      await saveViaBackground(new TextEncoder().encode(metadataOpf(playlist, chapters)), `${book}/metadata.opf`, {
        idPrefix: 'voiz_meta',
        book,
        chapter: 'metadata',
        type: 'application/oebps-package+xml;charset=utf-8',
        skipIfExists: false,
        conflictAction: 'overwrite',
      });
      const coverUrl = getCoverUrl(playlist);
      if (coverUrl) {
        await downloadUrlViaBackground(coverUrl, `${book}/cover.jpg`, {
          idPrefix: 'voiz_cover',
          book,
          chapter: 'cover',
          skipIfExists: false,
          conflictAction: 'overwrite',
        });
      }
      updateProgress({ name: book, status: 'Metadata and cover saved', logLine: `OK ${book}/metadata.opf` });
    } catch (err) {
      console.error('[Voiz DL] Metadata failed:', err);
      if (isExtensionContextDead(err)) {
        softReloadPage(err.message);
        return;
      }
      // Lỗi lấy dữ liệu / API: tự reload thay vì hiện alert
      const msg = String(err?.message || err || '');
      if (
        /undefined|null|failed to fetch|network|token|playlist|not found|timeout|abort/i.test(msg) ||
        /cannot read properties/i.test(msg)
      ) {
        softReloadPage(msg);
        return;
      }
      alert(`Voiz metadata failed: ${err.message}`);
    }
  }

  async function handleDownloadAll(opts = {}) {
    const force = Boolean(opts && opts.force);
    if (isDownloadingAll) {
      alert('Voiz download is already running. Click x in the progress panel to cancel.');
      return;
    }
    isDownloadingAll = true;
    cancelRequested = false;
    const btn = document.getElementById('voiz-dl-all-btn');
    if (btn) {
      btn.disabled = true;
      applyVoizButtonStyle(
        btn,
        force ? 'Re-downloading all chapters…' : 'Download all Voiz chapters',
        force ? 'Re-downloading…' : 'Downloading…',
        force ? 'redownload' : 'all',
        true
      );
    }

    // Hide redownload action while a run is active
    try {
      const ui = document.getElementById('voiz-dl-overlay');
      const actions = ui?.querySelector('[data-actions]');
      if (actions) actions.style.display = 'none';
    } catch {}

    try {
      const playlist = await getPlaylist();
      const book = safeFileName(playlist?.name || getBookTitle());
      const chapters = await getAllChapters(playlist?.playlist_counter?.audios_count || 0);
      resetStats(chapters.length);
      updateProgress({
        name: book,
        status: force
          ? `Force re-download (${chapters.length} chapters)`
          : `Queue ready (${chapters.length} chapters)`,
        forceStats: true,
      });

      const filenames = chapters.map((item, index) => chapterPath(book, item, index));
      const jobs = [];
      if (force) {
        // Unmark so future normal downloads also see them as needed; then download all
        try {
          await sendMessage({ type: 'UNMARK_DOWNLOADED_BATCH', filenames });
        } catch (e) {
          console.warn('[Voiz DL] Unmark batch failed (will still force download):', e);
        }
        for (let i = 0; i < chapters.length; i++) {
          jobs.push({ item: chapters[i], index: i, filename: filenames[i] });
        }
        updateProgress({ logLine: `Force re-download: ${chapters.length} chapters (skip disabled)`, forceStats: true });
      } else {
        const existing = await checkDownloadedBatch(filenames);
        for (let i = 0; i < chapters.length; i++) {
          if (existing[filenames[i]]) {
            stats.skipped++;
            updateProgress({ logLine: `Skipped ${filenames[i]}`, forceStats: true });
          } else {
            jobs.push({ item: chapters[i], index: i, filename: filenames[i] });
          }
        }
      }
      stats.queue = jobs.length;
      updateProgress({
        name: book,
        status: force
          ? `Re-downloading ${jobs.length} chapters`
          : `Downloading ${jobs.length} chapters`,
        forceStats: true,
      });

      let cursor = 0;
      async function worker() {
        while (true) {
          if (cancelRequested) return;
          const myIndex = cursor++;
          if (myIndex >= jobs.length) return;
          const { item, index, filename } = jobs[myIndex];
          const label = String(index + 1).padStart(3, '0');
          const taskTitle = `${label} ${item.name || item.id}`;
          stats.running.add(label);
          stats.queue = Math.max(0, jobs.length - myIndex - 1);
          updateProgress({ taskKey: label, taskTitle, current: 0, total: 1, status: 'Getting stream', forceStats: true });
          try {
            const playlistUrl = await getStreamingUrl(item.id);
            let data = await downloadHls(playlistUrl, (current, total) => {
              updateProgress({ taskKey: label, taskTitle, current, total, status: `Segments ${current}/${total}`, forceStats: true });
            });
            updateProgress({ taskKey: label, taskTitle, current: 1, total: 1, status: 'Saving', forceStats: true });
            try {
              const result = await saveViaBackground(data, filename, {
                idPrefix: 'voiz_audio',
                book,
                chapter: item.name || String(item.id),
                skipIfExists: !force,
                conflictAction: force ? 'overwrite' : 'uniquify',
              });
              if (result.status === 'skipped') {
                stats.skipped++;
                updateProgress({ logLine: `Skipped ${filename}`, forceStats: true });
              } else {
                stats.completed++;
                updateProgress({ logLine: `OK ${filename}`, forceStats: true });
              }
            } finally {
              data = null;
            }
          } catch (err) {
            if (!String(err.message).includes('Cancelled')) {
              stats.failed++;
              updateProgress({ logLine: `Error ${item.name || item.id}: ${err.message}`, forceStats: true });
              console.error('[Voiz DL] Chapter failed:', item, err);
            }
          } finally {
            stats.running.delete(label);
            activeProgress.delete(label);
            updateProgress({ forceStats: true });
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, Math.max(1, jobs.length)) }, () => worker()));
      updateProgress({
        name: book,
        status: cancelRequested
          ? `Cancelled - ${stats.completed} ok, ${stats.skipped} skipped, ${stats.failed} failed`
          : `Done - ${stats.completed} ok, ${stats.skipped} skipped, ${stats.failed} failed`,
        forceStats: true,
      });
      if (!cancelRequested && stats.failed === 0) {
        const cleanup = await requestAudioCacheCleanup('voiz-book-completed');
        updateProgress({
          name: book,
          logLine: cleanup.ok ? 'Cache cleaned' : `Cache cleanup failed: ${cleanup.error || 'unknown error'}`,
          forceStats: true,
        });
      }

      // Show "Tải lại toàn bộ" when every chapter was skipped (already marked as downloaded)
      // so user can recover after losing local files.
      if (
        !cancelRequested &&
        !force &&
        stats.total > 0 &&
        stats.skipped === stats.total &&
        stats.completed === 0 &&
        stats.failed === 0
      ) {
        const ui = ensureProgressUI();
        const actions = ui?.querySelector('[data-actions]');
        if (actions) {
          actions.style.display = 'flex';
          updateProgress({
            logLine: 'Tất cả chương đã skip — bấm "Tải lại toàn bộ" nếu bạn muốn tải lại từ đầu',
            forceStats: true,
          });
        }
      }
    } catch (err) {
      console.error('[Voiz DL] Download all failed:', err);
      if (isExtensionContextDead(err) || /cannot read properties of undefined/i.test(String(err?.message || ''))) {
        softReloadPage(err.message);
      } else {
        alert(`Voiz download failed: ${err.message}`);
      }
    } finally {
      isDownloadingAll = false;
      if (btn) {
        btn.disabled = false;
        applyVoizButtonStyle(
          btn,
          'Download all Voiz chapters',
          'Download all available Voiz chapters',
          'all',
          false
        );
      }
    }
  }

  // React to SPA route changes (Next.js History API) so UI is removed
  // immediately when leaving /play/<id>, not only on the 2.5s poll.
  let lastPathname = location.pathname;
  function onRouteMaybeChanged() {
    const path = location.pathname;
    if (path === lastPathname) return;
    lastPathname = path;
    if (!isVoizPlayPage()) {
      removeVoizToolkitUI();
    } else {
      ensureButtons();
    }
  }
  window.addEventListener('popstate', onRouteMaybeChanged);
  // Patch pushState / replaceState so client-side navigations are detected
  try {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const ret = origPush.apply(this, args);
      try { onRouteMaybeChanged(); } catch {}
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = origReplace.apply(this, args);
      try { onRouteMaybeChanged(); } catch {}
      return ret;
    };
  } catch {}

  loadIconModePref();
  ensureButtons();
  setInterval(ensureButtons, 2500);
})();
