/**
 * voiz-content.js  (Tampermonkey userscript build)
 * Downloader UI for voiz.vn playlist pages.
 * Mobile icon-only mode for compact buttons on phones.
 * Continuous listen (nghe liên tục) – same stream source as download, optional attach to site player.
 * v7.2: Professional Voiz-like mini-player panel (cover, layout, polish).
 * v7.4.3: Continuous fallback web→android_files + Spotify PiP – Document Picture-in-Picture miniplayer + canvas fallback + Media Session seek/progress/chapters.
 * v7.4.5: PiP responsive 3-layout (compact/standard/expanded) like Spotify + continuous desktop bar.
 * v7.5.0: Screen Wake Lock – giữ màn hình sáng khi đang phát audio (tab thường lẫn PiP),
 *         có lớp dự phòng (video ẩn loop) cho các trình duyệt xử lý Wake Lock API không ổn định,
 *         và dòng trạng thái hiển thị trên panel để dễ chẩn đoán.
 * v7.6.2-us.1: Port sang Tampermonkey userscript từ Mydio-Voiz Toolkit (extension) 7.6.2 —
 *         thay chrome.storage bằng localStorage, thay chrome.runtime.sendMessage bằng
 *         xử lý nội bộ (không cần background script): mở tab mới bằng window.open,
 *         tải file bằng <a download>/GM_download, đánh dấu "đã tải" bằng localStorage.
 *         Toàn bộ UI mini-player/PiP/Wake Lock/sleep-timer responsive mobile+desktop của
 *         bản extension 7.6.2 được giữ nguyên 1:1.
 */
(function () {
  'use strict';

  const VOIZ_BUILD = '7.6.2-us.1';
  try {
    console.log(
      '[Voiz Userscript] voiz-content.js build:', VOIZ_BUILD,
      '| wakeLock hỗ trợ:', ('wakeLock' in navigator),
      '| secure context (https):', window.isSecureContext
    );
  } catch {}

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
  // ─── Picture-in-Picture state (Spotify-style Document PiP + canvas) ───────
  let pipCanvas = null;
  let pipVideo = null;
  let pipActive = false;
  let pipMediaSessionBound = false;
  let docPipWindow = null;
  let pipRedrawTimer = null;
  let pipMode = null; // 'document' | 'video'
  // ─── Screen Wake Lock (giữ sáng màn hình khi đang phát) ───────────────────
  let wakeLockSentinel = null;
  let wakeLockWanted = false; // true bất cứ khi nào audio thực sự đang chạy
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
    seekBack10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" fill="currentColor" stroke="none"/></svg><span class="ct-seek-num">10</span>',
    seekFwd10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" fill="currentColor" stroke="none"/></svg><span class="ct-seek-num">10</span>',
    timer: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M9 2h6"/><path d="M18.5 5.5l1.2-1.2"/></svg>',
    list: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h13M3 12h13M3 18h9"/><path d="M20 9.5v9l-4.5-4.5z" fill="currentColor" stroke="none"/></svg>',
    expand: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5"/><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M16 21h5v-5"/><path d="M3 3l6 6"/><path d="M21 3l-6 6"/><path d="M3 21l6-6"/><path d="M21 21l-6-6"/></svg>',
    collapseDesktop: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v6H3"/><path d="M15 3v6h6"/><path d="M9 21v-6H3"/><path d="M15 21v-6h6"/><path d="M3 9l6-6"/><path d="M21 9l-6-6"/><path d="M3 15l6 6"/><path d="M21 15l-6 6"/></svg>',
    chevronDown: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    chevronUp: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
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
      const v = localStorage.getItem(ICON_MODE_KEY);
      if (v === 'auto' || v === 'always' || v === 'never') iconModePref = v;
      refreshVoizButtons();
    } catch {}
  }

  // Userscript: không có chrome.storage.onChanged — theo dõi thay đổi giữa các tab
  // bằng sự kiện 'storage' (chỉ bắn ở các tab KHÁC tab vừa ghi) + poll nhẹ trong cùng tab.
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== ICON_MODE_KEY) return;
      const v = e.newValue;
      if (v === 'auto' || v === 'always' || v === 'never') {
        iconModePref = v;
        refreshVoizButtons();
      }
    });
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

  async function getStreamingUrlCandidates(audioId) {
    const token = await getToken();
    const payload = `audio_id=${audioId}${token ? `&access_token=${token}` : ''}`;
    const signature = await hmacSha256Hex(SIGNATURE_SECRET, payload);
    const headers = {
      'x-signature': signature,
      'x-authorization': token || '',
    };

    // Order: web streaming → web files → android_files (APK-style, often works when web fails)
    const endpoints = [
      { name: 'web/streaming', url: `${API_BASE}/web/audios/${encodeURIComponent(audioId)}/streaming` },
      { name: 'web/files', url: `${API_BASE}/web/audios/${encodeURIComponent(audioId)}/files` },
      { name: 'android_files', url: `${API_BASE}/audios/${encodeURIComponent(audioId)}/android_files` },
    ];

    const candidates = [];
    const seen = new Set();
    let lastError = null;
    for (const ep of endpoints) {
      try {
        const json = await fetchJson(ep.url, { headers });
        const playlistUrl = findPlaylistUrl(json);
        if (playlistUrl && !seen.has(playlistUrl)) {
          seen.add(playlistUrl);
          candidates.push({ source: ep.name, playlistUrl });
        } else if (!playlistUrl) {
          lastError = new Error(`No m3u8 in response from ${ep.name}`);
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Voiz] Stream endpoint ${ep.name} failed:`, err?.message || err);
      }
    }
    if (!candidates.length) {
      throw lastError || new Error('Voiz did not return an HLS playlist URL (web + android)');
    }
    return candidates;
  }

  async function getStreamingUrl(audioId) {
    const list = await getStreamingUrlCandidates(audioId);
    return list[0].playlistUrl;
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

  /** Userscript: không có "extension context" nên khái niệm này luôn coi là còn sống.
   *  Giữ lại hàm (cùng chữ ký) để các đoạn gọi isExtensionContextDead()/softReloadPage()
   *  ở dưới không phải sửa từng chỗ — nhưng chúng sẽ không bao giờ kích hoạt reload nữa. */
  function isExtensionContextDead(_err) {
    return false;
  }

  let reloadScheduled = false;
  function softReloadPage(reason) {
    if (reloadScheduled) return;
    reloadScheduled = true;
    try {
      console.warn('[Voiz Userscript] Auto-reload:', reason || 'unexpected error');
    } catch {}
    try {
      location.reload();
    } catch {
      try {
        window.location.href = window.location.href;
      } catch {}
    }
  }

  // ─── Userscript: tự phục vụ các "message" mà bản extension gửi cho background.js ──
  // Không có Service Worker nền nên toàn bộ được xử lý ngay tại đây bằng
  // localStorage (đánh dấu đã tải) + tải file trực tiếp bằng thẻ <a download>
  // (hoặc GM_download nếu Tampermonkey cấp quyền @grant GM_download).
  const US_DOWNLOADED_KEY = 'voiz_us_downloaded';

  function usGetDownloadedSet() {
    try {
      const raw = localStorage.getItem(US_DOWNLOADED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  function usSaveDownloadedSet(set) {
    try {
      const arr = Array.from(set).slice(-5000);
      localStorage.setItem(US_DOWNLOADED_KEY, JSON.stringify(arr));
    } catch {}
  }

  function usMarkDownloaded(filename) {
    if (!filename) return;
    const set = usGetDownloadedSet();
    set.add(filename);
    usSaveDownloadedSet(set);
  }

  /** Tải 1 file về máy (không cần background script). Ưu tiên GM_download nếu có. */
  function usTriggerDownload(url, filename) {
    return new Promise((resolve) => {
      const cleanName = (filename || 'voiz-file').replace(/[\\]/g, '/');
      try {
        if (typeof GM_download === 'function') {
          GM_download({
            url,
            name: cleanName,
            saveAs: false,
            onload: () => resolve({ ok: true }),
            onerror: (e) => resolve({ ok: false, error: (e && e.error) || 'GM_download error' }),
          });
          return;
        }
      } catch {}
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = cleanName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try { a.remove(); } catch {}
        }, 1000);
        resolve({ ok: true });
      } catch (err) {
        resolve({ ok: false, error: String(err && err.message || err) });
      }
    });
  }

  function sendMessage(message) {
    return new Promise(async (resolve) => {
      const type = message && message.type;
      try {
        switch (type) {
          case 'GET_VOIZ_TOKEN': {
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
          case 'CHECK_DOWNLOADED_BATCH': {
            const names = Array.isArray(message.filenames) ? message.filenames : [];
            const have = usGetDownloadedSet();
            const map = {};
            names.forEach((n) => { map[n] = have.has(n); });
            resolve({ ok: true, map });
            return;
          }
          case 'UNMARK_DOWNLOADED_BATCH': {
            const names = new Set(Array.isArray(message.filenames) ? message.filenames : []);
            const set = usGetDownloadedSet();
            names.forEach((n) => set.delete(n));
            usSaveDownloadedSet(set);
            resolve({ ok: true });
            return;
          }
          case 'CLEAR_AUDIO_CACHE': {
            // Userscript không có chrome.browsingData — không có gì để dọn thêm.
            resolve({ ok: true, cleared: false, note: 'userscript: no browsingData API' });
            return;
          }
          case 'DOWNLOAD_FILE': {
            const skip = message.skipIfExists !== false;
            if (skip && usGetDownloadedSet().has(message.filename)) {
              resolve({ ok: true, status: 'skipped' });
              return;
            }
            const res = await usTriggerDownload(message.blob, message.filename);
            if (res.ok) usMarkDownloaded(message.filename);
            resolve(res.ok ? { ok: true, status: 'complete' } : { ok: false, error: res.error });
            return;
          }
          case 'OPEN_NEW_TAB': {
            try { window.open(message.url, '_blank', 'noopener'); } catch {}
            resolve({ ok: true });
            return;
          }
          default: {
            resolve({ ok: false, error: 'unsupported in userscript: ' + type });
          }
        }
      } catch (err) {
        resolve({ ok: false, error: String(err && err.message || err) });
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

  // Video ẩn 2x2px, 1 giây, câm tiếng, tự lặp — mẹo dự phòng "no-sleep" dùng khi
  // Screen Wake Lock API không tồn tại hoặc bị trình duyệt từ chối (một số bản
  // Edge/Chromium trên di động xử lý API này không ổn định). Một <video> đang
  // play() cũng đủ để hệ điều hành không tự khóa màn hình.
  const NOSLEEP_VIDEO_SRC = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMXbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG5bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABZG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASRzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2V+IiMBEAAADAAQAAAMACDxIllgBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFigAABYoAAAAGHN0dHMAAAAAAAAAAQAAAAEAAEAAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAAsUAAAABAAAAFHN0Y28AAAAAAAAAAQAAA0cAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAACzW1kYXQAAAKtBgX//6ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABBliIQAFf/+98nvwKbr29+B';
  let noSleepVideo = null;

  function ensureNoSleepVideo() {
    if (noSleepVideo) return noSleepVideo;
    noSleepVideo = document.createElement('video');
    noSleepVideo.id = 'voiz-toolkit-nosleep-video';
    noSleepVideo.setAttribute('playsinline', '');
    noSleepVideo.setAttribute('webkit-playsinline', '');
    noSleepVideo.muted = true;
    noSleepVideo.loop = true;
    noSleepVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;bottom:0;right:0;z-index:-1';
    noSleepVideo.src = NOSLEEP_VIDEO_SRC;
    document.body.appendChild(noSleepVideo);
    return noSleepVideo;
  }

  function startNoSleepFallback() {
    try {
      const v = ensureNoSleepVideo();
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        p.then(() => setWakeLockIndicator('🔆 Giữ sáng màn hình: bật (chế độ dự phòng)'))
          .catch((err) => {
            console.warn('[Voiz WakeLock] fallback video play failed:', err);
            setWakeLockIndicator('⚠️ Không giữ được sáng màn hình (video dự phòng bị chặn)');
          });
      }
    } catch (err) {
      console.warn('[Voiz WakeLock] fallback video error:', err);
    }
  }

  function stopNoSleepFallback() {
    if (noSleepVideo) {
      try { noSleepVideo.pause(); } catch {}
    }
  }

  function setWakeLockIndicator(text) {
    document.querySelectorAll('#voiz-continuous-overlay [data-ct-wakelock]').forEach((el) => {
      el.textContent = text;
    });
  }

  // Xin giữ màn hình sáng: thử Screen Wake Lock API thật, đồng thời luôn bật
  // song song video dự phòng — an toàn khi gọi nhiều lần.
  async function requestWakeLock() {
    wakeLockWanted = true;
    startNoSleepFallback();
    if (!('wakeLock' in navigator)) {
      console.warn('[Voiz WakeLock] navigator.wakeLock không tồn tại trên trình duyệt này — chỉ dùng video dự phòng.');
      return;
    }
    if (wakeLockSentinel) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      // Nếu trong lúc chờ Promise, người dùng đã bấm dừng → nhả ngay, không giữ nữa.
      if (!wakeLockWanted) {
        try { sentinel.release(); } catch {}
        return;
      }
      wakeLockSentinel = sentinel;
      setWakeLockIndicator('🔆 Giữ sáng màn hình: bật (Wake Lock)');
      wakeLockSentinel.addEventListener('release', () => {
        // Trình duyệt có thể tự nhả sentinel (vd. khi tab bị ẩn) — dọn biến để
        // lần visibilitychange/focus kế tiếp biết cần xin lại nếu vẫn đang phát.
        wakeLockSentinel = null;
        if (wakeLockWanted) setWakeLockIndicator('🔆 Giữ sáng màn hình: bật (chế độ dự phòng)');
      });
    } catch (err) {
      // Bị từ chối (thường do tab không hiển thị/không có focus lúc xin, hoặc bị
      // chính sách trình duyệt chặn) — video dự phòng ở trên vẫn tiếp tục chạy.
      wakeLockSentinel = null;
      console.warn('[Voiz WakeLock] request failed, dùng video dự phòng:', err && err.name, err && err.message);
    }
  }

  async function releaseWakeLock() {
    wakeLockWanted = false;
    stopNoSleepFallback();
    setWakeLockIndicator('');
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    if (sentinel) {
      try { await sentinel.release(); } catch {}
    }
  }

  // Screen Wake Lock API tự động nhả sentinel khi document bị ẩn (đổi tab).
  // Khi tab hiển thị lại (kể cả khi âm thanh vẫn đang phát nền/qua PiP), xin lại
  // nếu phiên nghe vẫn đang cần giữ sáng màn hình.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockWanted && !wakeLockSentinel) {
      requestWakeLock();
    }
  });
  window.addEventListener('focus', () => {
    if (wakeLockWanted && !wakeLockSentinel) requestWakeLock();
  });

  function getActiveMedia() {

    if (continuousSiteAttached) {
      const media = findSiteMedia();
      if (media) return media;
    }
    return continuousAudio || findSiteMedia();
  }

  // Ghi giá trị vào nút: nếu có span con [data-ct-value] (kiểu icon+nhãn ở
  // màn hình full mobile) thì cập nhật span đó, ngược lại ghi thẳng textContent
  // (kiểu nút chữ đơn giản trên thanh desktop).
  function setBtnValue(btn, text) {
    if (!btn) return;
    const valueEl = btn.querySelector('[data-ct-value]');
    if (valueEl) valueEl.textContent = text;
    else btn.textContent = text;
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
      btn.classList.toggle('ct-speed-selected', active);
      btn.style.background = active ? '#7c3aed' : '#374151';
      btn.style.fontWeight = active ? '700' : '500';
      btn.style.opacity = active ? '1' : '0.85';
    });
    ui.querySelectorAll('[data-ct-speed-main]').forEach((btn) => {
      setBtnValue(btn, rate === 1 ? '1x' : `${rate}x`);
    });
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

  // Tua tương đối ±N giây từ vị trí hiện tại (dùng cho nút lùi/tiến 10s).
  function seekRelative(delta) {
    const media = getActiveMedia();
    if (!media || !Number.isFinite(delta)) return;
    try {
      const dur = media.duration;
      let target = (media.currentTime || 0) + delta;
      target = Math.max(0, target);
      if (Number.isFinite(dur) && dur > 0) target = Math.min(dur, target);
      media.currentTime = target;
    } catch (err) {
      console.warn('[Voiz Continuous] Seek relative failed:', err);
    }
  }

  // Đồng bộ icon play/pause trên MỌI bản sao của nút toggle (chế độ full + thu gọn).
  function setContinuousToggleIcon(playing) {
    const ui = document.getElementById('voiz-continuous-overlay');
    if (!ui) return;
    ui.querySelectorAll('[data-ct-toggle]').forEach((btn) => {
      btn.innerHTML = playing ? ICONS.pause : ICONS.play;
    });
  }

  function ensureOwnAudio() {
    if (continuousAudio && continuousAudio.isConnected) return continuousAudio;
    continuousAudio = document.createElement('audio');
    continuousAudio.id = 'voiz-toolkit-continuous-audio';
    continuousAudio.preload = 'auto';
    continuousAudio.muted = false;
    continuousAudio.volume = 1;
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
      if (continuousPlaying) updateMediaSessionPosition();
    });
    continuousAudio.addEventListener('play', () => {
      bindPipMediaSession();
      updateMediaSessionMetadata();
      updateMediaSessionPosition();
      requestWakeLock();
      setContinuousToggleIcon(true);
    });
    continuousAudio.addEventListener('pause', () => {
      try {
        if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
      } catch {}
      releaseWakeLock();
      setContinuousToggleIcon(false);
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
    ui.querySelectorAll('[data-ct-sleep]').forEach((btn) => {
      const id = btn.dataset.ctSleep;
      const active =
        id === continuousSleepMode ||
        (continuousSleepMode === 'minutes' && id === String(continuousSleepMinutes));
      btn.classList.toggle('ct-sleep-selected', active);
      btn.style.background = active ? '#7c3aed' : '#374151';
      btn.style.fontWeight = active ? '700' : '500';
      btn.style.opacity = active ? '1' : '0.85';
    });

    let short = 'Hẹn giờ';
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
    const active = continuousSleepMode !== 'off';
    ui.querySelectorAll('[data-ct-timer-main]').forEach((btn) => {
      setBtnValue(btn, short);
      btn.title = long;
      btn.classList.toggle('ct-active', active);
      if (!btn.querySelector('[data-ct-value]')) {
        btn.style.background = active ? '#7c3aed' : '#374151';
      }
    });
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
    releaseWakeLock();
    updateSleepUI();
    restoreToolkitButtonsZ();
    refreshVoizButtons();
  }

  // ─── Picture-in-Picture (canvas + video + Media Session) ─────────────────
  function supportsDocumentPiP() {
    return !!(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function');
  }

  function ensurePipElements() {
    if (!pipCanvas) {
      pipCanvas = document.createElement('canvas');
      pipCanvas.width = 640;
      pipCanvas.height = 640;
      pipCanvas.style.display = 'none';
    }
    if (!pipVideo) {
      pipVideo = document.createElement('video');
      pipVideo.id = 'voiz-toolkit-pip-video';
      pipVideo.muted = true;
      pipVideo.playsInline = true;
      pipVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;right:0;z-index:-1';
      pipVideo.srcObject = pipCanvas.captureStream(30);
      document.body.appendChild(pipVideo);
      pipVideo.addEventListener('leavepictureinpicture', () => {
        pipActive = false;
        pipMode = null;
        stopPipRedraw();
        updatePipButtonState();
      });
    }
    return { canvas: pipCanvas, video: pipVideo };
  }

  function stopPipRedraw() {
    if (pipRedrawTimer) {
      clearInterval(pipRedrawTimer);
      pipRedrawTimer = null;
    }
  }

  function startPipRedraw() {
    stopPipRedraw();
    pipRedrawTimer = setInterval(() => {
      if (!pipActive) return;
      if (pipMode === 'document' && docPipWindow && !docPipWindow.closed) {
        updateDocPipUI();
        applyDocPipLayout(docPipWindow);
      } else if (pipMode === 'video') {
        const playlist = getNextDataPlaylist();
        const coverUrl = getCoverUrl(playlist);
        const title = cleanText(playlist?.name || document.title) || 'Voiz';
        const chapter = continuousChapters?.[continuousIndex];
        const chapterName = chapter?.name || chapter?.title || (continuousIndex >= 0 ? `Chương ${continuousIndex + 1}` : '');
        drawPipCover(coverUrl, title, chapterName, true).catch(() => {});
      }
      updateMediaSessionPosition();
    }, 1000);
  }

  function formatPipTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60) % 60;
    const h = Math.floor(sec / 3600);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPipCover(coverUrl, title, chapter, withProgress) {
    const { canvas } = ensurePipElements();
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve();
    const W = canvas.width;
    const H = canvas.height;
    return new Promise((resolve) => {
      const finish = (img) => {
        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, W, H);
        if (img) {
          // Spotify-style: full-bleed cover as background (darkened)
          const scaleBg = Math.max(W / img.width, H / img.height) * 1.25;
          const bw = img.width * scaleBg;
          const bh = img.height * scaleBg;
          ctx.globalAlpha = 0.55;
          ctx.drawImage(img, (W - bw) / 2, (H - bh) / 2, bw, bh);
          ctx.globalAlpha = 1;
          // Dark gradient overlay for readability
          const ov = ctx.createLinearGradient(0, 0, 0, H);
          ov.addColorStop(0, 'rgba(10,6,20,0.35)');
          ov.addColorStop(0.5, 'rgba(12,8,24,0.45)');
          ov.addColorStop(1, 'rgba(10,6,20,0.78)');
          ctx.fillStyle = ov;
          ctx.fillRect(0, 0, W, H);
          const size = Math.min(W, H) * 0.58;
          const cx = (W - size) / 2;
          const cy = H * 0.1;
          ctx.save();
          roundRectPath(ctx, cx, cy, size, size, 28);
          ctx.clip();
          const scale = Math.max(size / img.width, size / img.height);
          const iw = img.width * scale;
          const ih = img.height * scale;
          ctx.drawImage(img, cx + (size - iw) / 2, cy + (size - ih) / 2, iw, ih);
          ctx.restore();
        } else {
          const g = ctx.createLinearGradient(0, 0, W, H);
          g.addColorStop(0, '#4c1d95');
          g.addColorStop(1, '#7c3aed');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          ctx.font = 'bold 120px system-ui,sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff';
          ctx.fillText('🎧', W / 2, H * 0.35);
        }
        ctx.fillStyle = 'rgba(17,24,39,0.78)';
        ctx.fillRect(0, H - 170, W, 170);
        ctx.fillStyle = '#f9fafb';
        ctx.font = 'bold 30px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(title || 'Voiz').slice(0, 36), W / 2, H - 150);
        if (chapter) {
          ctx.fillStyle = '#c4b5fd';
          ctx.font = '22px system-ui,sans-serif';
          ctx.fillText(String(chapter).slice(0, 40), W / 2, H - 110);
        }
        if (withProgress) {
          const audio = getActiveMedia();
          const dur = audio?.duration || 0;
          const cur = audio?.currentTime || 0;
          const pct = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
          const barX = 48;
          const barW = W - 96;
          const barY = H - 42;
          ctx.fillStyle = 'rgba(196,181,253,0.3)';
          roundRectPath(ctx, barX, barY, barW, 8, 4);
          ctx.fill();
          ctx.fillStyle = '#a78bfa';
          roundRectPath(ctx, barX, barY, barW * pct, 8, 4);
          ctx.fill();
          ctx.fillStyle = '#d1d5db';
          ctx.font = '18px system-ui,sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(formatPipTime(cur), barX, barY - 22);
          ctx.textAlign = 'right';
          ctx.fillText(formatPipTime(dur), barX + barW, barY - 22);
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

  function buildDocPipHTML() {
    return `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%; height: 100%;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: #121212;
    color: #fff;
    overflow: hidden;
    user-select: none;
  }
  .pip-root {
    position: relative;
    width: 100%; height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Shared cover thumb */
  .pip-cover-wrap {
    flex-shrink: 0;
    width: 56px; height: 56px;
    border-radius: 4px;
    overflow: hidden;
    background: #282828;
  }
  .pip-cover {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }

  /* Blurred bg for bar modes */
  .pip-bg-wrap {
    position: absolute; inset: 0;
    overflow: hidden; z-index: 0;
    pointer-events: none;
    display: none;
  }
  .pip-bg {
    position: absolute; inset: -25%;
    width: 150%; height: 150%;
    object-fit: cover;
    filter: blur(40px) saturate(1.4) brightness(0.4);
    opacity: 0;
    transition: opacity 0.35s ease;
  }
  .pip-bg.visible { opacity: 1; }
  .pip-bg-dim {
    position: absolute; inset: 0;
    background: rgba(18,18,18,0.55);
  }

  .title-track { width: 100%; overflow: hidden; position: relative; }
  .title {
    font-size: 14px; font-weight: 700; line-height: 1.25;
    white-space: nowrap; display: block;
  }
  .title-track:not(.marquee) .title {
    overflow: hidden; text-overflow: ellipsis;
  }
  .title-track.marquee {
    mask-image: linear-gradient(90deg, transparent 0%, #000 6%, #000 94%, transparent 100%);
    -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 6%, #000 94%, transparent 100%);
  }
  .title-track.marquee .title {
    display: inline-block; width: max-content; max-width: none;
    animation: pip-marquee var(--marquee-dur, 8s) ease-in-out infinite alternate;
    will-change: transform;
  }
  @keyframes pip-marquee {
    0%, 10% { transform: translateX(0); }
    90%, 100% { transform: translateX(var(--marquee-x, -30%)); }
  }
  .chapter {
    font-size: 12px; color: #b3b3b3; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .pip-controls {
    display: flex; align-items: center; justify-content: center;
    gap: 8px; flex-shrink: 0;
  }
  .pip-controls button {
    border: 0; cursor: pointer;
    background: transparent; color: #fff;
    width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.12s, background 0.15s, opacity 0.15s;
    opacity: 0.9;
  }
  .pip-controls button:hover { opacity: 1; background: rgba(255,255,255,0.1); }
  .pip-controls button:active { transform: scale(0.92); }
  .pip-controls button.play {
    width: 36px; height: 36px;
    background: #fff; color: #000; opacity: 1;
  }
  .pip-controls button.play:hover { transform: scale(1.06); background: #fff; }
  .pip-controls svg { width: 16px; height: 16px; fill: currentColor; }
  .pip-controls button.play svg { width: 18px; height: 18px; }

  .pip-progress {
    display: flex; align-items: center; gap: 8px;
    width: 100%; font-size: 11px; color: #b3b3b3;
    font-variant-numeric: tabular-nums;
  }
  .pip-progress .bar {
    flex: 1; height: 4px; border-radius: 2px;
    background: rgba(255,255,255,0.3);
    overflow: hidden; cursor: pointer;
  }
  .pip-progress .bar > i {
    display: block; height: 100%; width: 0%;
    background: #fff; border-radius: 2px;
    transition: width 0.2s linear;
  }
  .pip-progress .bar:hover { height: 5px; }
  .pip-progress .bar:hover > i { background: #1db954; }
  .t-cur, .t-dur { min-width: 32px; }
  .t-dur { text-align: right; }

  .pip-shade-top, .pip-shade-bot { display: none; pointer-events: none; }

  /* Regions — visibility toggled per layout */
  .row-top { display: none; align-items: center; gap: 12px; min-width: 0; z-index: 2; }
  .row-top .pip-info { flex: 1; min-width: 0; }
  .row-controls { display: none; z-index: 2; }
  .row-progress { display: none; z-index: 2; }
  .expanded-layer { display: none; }

  /* ════════ COMPACT — cover | title | play next ════════ */
  .layout-compact {
    flex-direction: row;
    align-items: center;
    padding: 8px 12px;
    gap: 10px;
    background: #181818;
  }
  .layout-compact .pip-bg-wrap { display: block; }
  .layout-compact .row-top {
    display: flex; flex: 1; min-width: 0;
  }
  .layout-compact .pip-cover-wrap { width: 48px; height: 48px; }
  .layout-compact .title { font-size: 13px; }
  .layout-compact .chapter { font-size: 11px; }
  .layout-compact .row-controls {
    display: flex; gap: 4px; flex-shrink: 0;
  }
  .layout-compact .row-controls button:not(.play):not(#pip-next) { display: none; }
  .layout-compact .row-controls button.play { width: 32px; height: 32px; }
  .layout-compact .row-controls #pip-next { width: 28px; height: 28px; }
  .layout-compact .row-progress { display: none !important; }
  .layout-compact .expanded-layer { display: none !important; }

  /* ════════ STANDARD — top: cover+info; bottom: full controls ════════ */
  .layout-standard {
    flex-direction: column;
    justify-content: center;
    padding: 12px 14px 10px;
    gap: 10px;
    background: #181818;
  }
  .layout-standard .pip-bg-wrap { display: block; }
  .layout-standard .row-top {
    display: flex; width: 100%;
  }
  .layout-standard .pip-cover-wrap { width: 64px; height: 64px; border-radius: 6px; }
  .layout-standard .title { font-size: 14px; }
  .layout-standard .row-controls {
    display: flex; width: 100%;
    justify-content: center; gap: 10px;
  }
  .layout-standard .row-controls button.play { width: 40px; height: 40px; }
  .layout-standard .row-controls button.play svg { width: 20px; height: 20px; }
  .layout-standard #pip-seek-back,
  .layout-standard #pip-seek-fwd { display: none; }
  .layout-standard .row-progress { display: none !important; }
  .layout-standard .expanded-layer { display: none !important; }

  /* ════════ EXPANDED — full cover, controls center, progress+title bottom ════════ */
  .layout-expanded {
    padding: 0;
    background: #000;
  }
  .layout-expanded .pip-bg-wrap { display: none !important; }
  .layout-expanded .row-top,
  .layout-expanded .row-controls,
  .layout-expanded .row-progress { display: none !important; }

  .layout-expanded .expanded-layer {
    display: block;
    position: absolute; inset: 0;
    z-index: 1;
  }
  .layout-expanded .expanded-cover {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    object-fit: cover;
  }
  .layout-expanded .expanded-shade {
    position: absolute; inset: 0;
    background:
      linear-gradient(180deg, rgba(0,0,0,0.25) 0%, transparent 35%),
      linear-gradient(0deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 42%, transparent 70%);
    pointer-events: none;
  }
  .layout-expanded .expanded-controls {
    position: absolute;
    top: 42%; left: 50%;
    transform: translate(-50%, -50%);
    display: flex; align-items: center; gap: 14px;
    z-index: 3;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  /* Spotify-style: show transport only on hover */
  .layout-expanded:hover .expanded-controls,
  .layout-expanded.show-controls .expanded-controls {
    opacity: 1;
    pointer-events: auto;
  }
  .layout-expanded .expanded-controls button {
    width: 40px; height: 40px;
    background: transparent;
    color: #fff;
    border: 0; border-radius: 50%;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    opacity: 0.95;
  }
  .layout-expanded .expanded-controls button:hover {
    background: rgba(255,255,255,0.12);
  }
  .layout-expanded .expanded-controls button.play {
    width: 52px; height: 52px;
    background: #fff; color: #000; opacity: 1;
  }
  .layout-expanded .expanded-controls button.play:hover {
    transform: scale(1.06);
  }
  .layout-expanded .expanded-controls svg { width: 20px; height: 20px; fill: currentColor; }
  .layout-expanded .expanded-controls button.play svg { width: 24px; height: 24px; }

  .layout-expanded .expanded-bottom {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    z-index: 3;
    padding: 0 16px 14px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .layout-expanded .expanded-bottom .pip-progress {
    display: flex;
  }
  .layout-expanded .expanded-bottom .title {
    font-size: 15px;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }
  .layout-expanded .expanded-bottom .chapter {
    color: rgba(255,255,255,0.75);
  }

  .hide-controls .pip-controls,
  .hide-controls .expanded-controls {
    opacity: 0 !important;
    pointer-events: none;
  }
</style>

<div class="pip-root layout-expanded" id="pip-root" data-layout="expanded">
  <!-- Blurred background (compact / standard) -->
  <div class="pip-bg-wrap">
    <img class="pip-bg" id="pip-bg" alt="" />
    <div class="pip-bg-dim"></div>
  </div>

  <!-- Top row: cover + info (compact / standard) -->
  <div class="row-top">
    <div class="pip-cover-wrap">
      <img class="pip-cover" id="pip-cover" alt="" />
    </div>
    <div class="pip-info">
      <div class="title-track" id="pip-title-track">
        <div class="title" id="pip-title">Voiz</div>
      </div>
      <div class="chapter" id="pip-chapter"></div>
    </div>
  </div>

  <!-- Controls row (compact / standard) -->
  <div class="row-controls pip-controls" id="pip-center">
    <button type="button" id="pip-prev" title="Chương trước">
      <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
    </button>
    <button type="button" id="pip-seek-back" title="-15s">
      <svg viewBox="0 0 24 24"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
    </button>
    <button type="button" class="play" id="pip-play" title="Play/Pause">
      <svg id="pip-play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
    </button>
    <button type="button" id="pip-seek-fwd" title="+15s">
      <svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/></svg>
    </button>
    <button type="button" id="pip-next" title="Chương sau">
      <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
    </button>
  </div>

  <!-- Expanded full-bleed layer -->
  <div class="expanded-layer">
    <img class="expanded-cover" id="pip-cover-exp" alt="" />
    <div class="expanded-shade"></div>
    <div class="expanded-controls pip-controls" id="pip-center-exp">
      <button type="button" id="pip-prev-exp" title="Chương trước">
        <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
      </button>
      <button type="button" id="pip-seek-back-exp" title="-15s">
        <svg viewBox="0 0 24 24"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
      </button>
      <button type="button" class="play" id="pip-play-exp" title="Play/Pause">
        <svg id="pip-play-icon-exp" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <button type="button" id="pip-seek-fwd-exp" title="+15s">
        <svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/></svg>
      </button>
      <button type="button" id="pip-next-exp" title="Chương sau">
        <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
      </button>
    </div>
    <div class="expanded-bottom">
      <div class="pip-progress">
        <span class="t-cur" id="pip-cur">0:00</span>
        <div class="bar" id="pip-bar"><i id="pip-bar-fill"></i></div>
        <span class="t-dur" id="pip-dur">0:00</span>
      </div>
      <div class="pip-info">
        <div class="title-track" id="pip-title-track-exp">
          <div class="title" id="pip-title-exp">Voiz</div>
        </div>
        <div class="chapter" id="pip-chapter-exp"></div>
      </div>
    </div>
  </div>
</div>`;
  }

  function updateDocPipUI() {
    if (!docPipWindow || docPipWindow.closed) return;
    const doc = docPipWindow.document;
    const playlist = getNextDataPlaylist();
    const coverUrl = getCoverUrl(playlist);
    const title = cleanText(playlist?.name || document.title) || 'Voiz';
    const chapter = continuousChapters?.[continuousIndex];
    const chapterName = chapter?.name || chapter?.title || (continuousIndex >= 0 ? `Chương ${continuousIndex + 1}` : '');
    const audio = getActiveMedia();

    const setText = (id, val) => {
      const el = doc.getElementById(id);
      if (el) el.textContent = val;
    };
    setText('pip-title', title);
    setText('pip-title-exp', title);
    setText('pip-chapter', chapterName || '');
    setText('pip-chapter-exp', chapterName || '');

    // Marquee on visible title tracks
    const applyMarquee = (trackId, titleId) => {
      try {
        const titleTrack = doc.getElementById(trackId);
        const titleEl = doc.getElementById(titleId);
        if (!titleTrack || !titleEl) return;
        titleTrack.classList.remove('marquee');
        titleEl.style.animation = 'none';
        const overflow = titleEl.scrollWidth - titleTrack.clientWidth;
        if (overflow > 6) {
          const dist = Math.ceil(overflow + 12);
          const dur = Math.max(4.5, Math.min(12, dist / 22));
          titleTrack.style.setProperty('--marquee-x', `-${dist}px`);
          titleTrack.style.setProperty('--marquee-dur', `${dur}s`);
          titleTrack.classList.add('marquee');
          void titleEl.offsetWidth;
          titleEl.style.animation = '';
        } else {
          titleTrack.style.removeProperty('--marquee-x');
          titleTrack.style.removeProperty('--marquee-dur');
          titleEl.style.animation = '';
        }
      } catch {}
    };
    requestAnimationFrame(() => {
      applyMarquee('pip-title-track', 'pip-title');
      applyMarquee('pip-title-track-exp', 'pip-title-exp');
    });

    const setImg = (id) => {
      const el = doc.getElementById(id);
      if (!el || !coverUrl) return;
      if (el.getAttribute('data-src') === coverUrl) return;
      el.removeAttribute('crossorigin');
      el.setAttribute('data-src', coverUrl);
      el.referrerPolicy = 'no-referrer';
      el.onerror = () => { el.removeAttribute('src'); };
      el.src = coverUrl;
      if (id === 'pip-bg') {
        el.onload = () => el.classList.add('visible');
        if (el.complete && el.naturalWidth) el.classList.add('visible');
      }
    };
    setImg('pip-cover');
    setImg('pip-cover-exp');
    setImg('pip-bg');

    const cur = audio?.currentTime || 0;
    const dur = audio?.duration || 0;
    setText('pip-cur', formatPipTime(cur));
    setText('pip-dur', formatPipTime(dur));
    const fillEl = doc.getElementById('pip-bar-fill');
    if (fillEl) fillEl.style.width = (dur > 0 ? (cur / dur) * 100 : 0) + '%';

    const paused = !audio || audio.paused;
    const iconHtml = paused
      ? '<path d="M8 5v14l11-7z"/>'
      : '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
    ['pip-play-icon', 'pip-play-icon-exp'].forEach((id) => {
      const el = doc.getElementById(id);
      if (el) el.innerHTML = iconHtml;
    });
  }

  function wireDocPipControls(pipWin) {
    const doc = pipWin.document;
    const bindPlay = (id) => {
      doc.getElementById(id)?.addEventListener('click', () => {
        const a = getActiveMedia();
        if (!a) return;
        if (a.paused) a.play().catch(() => {});
        else a.pause();
        setTimeout(updateDocPipUI, 50);
      });
    };
    const bindSeek = (id, delta) => {
      doc.getElementById(id)?.addEventListener('click', () => {
        const a = getActiveMedia();
        if (!a) return;
        if (delta < 0) a.currentTime = Math.max(0, (a.currentTime || 0) + delta);
        else a.currentTime = Math.min(a.duration || Infinity, (a.currentTime || 0) + delta);
        updateDocPipUI();
      });
    };
    const bindPrev = (id) => {
      doc.getElementById(id)?.addEventListener('click', () => {
        if (continuousIndex > 0) playContinuousChapter(continuousIndex - 1);
        setTimeout(updateDocPipUI, 300);
      });
    };
    const bindNext = (id) => {
      doc.getElementById(id)?.addEventListener('click', () => {
        playNextContinuousChapter();
        setTimeout(updateDocPipUI, 300);
      });
    };
    bindPlay('pip-play');
    bindPlay('pip-play-exp');
    bindSeek('pip-seek-back', -15);
    bindSeek('pip-seek-back-exp', -15);
    bindSeek('pip-seek-fwd', 15);
    bindSeek('pip-seek-fwd-exp', 15);
    bindPrev('pip-prev');
    bindPrev('pip-prev-exp');
    bindNext('pip-next');
    bindNext('pip-next-exp');

    doc.getElementById('pip-bar')?.addEventListener('click', (e) => {
      const a = getActiveMedia();
      if (!a || !a.duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      a.currentTime = pct * a.duration;
      updateDocPipUI();
    });
  }

  function applyDocPipLayout(pipWin) {
    if (!pipWin || pipWin.closed) return;
    const h = pipWin.innerHeight || 0;
    const w = pipWin.innerWidth || 0;
    const root = pipWin.document.getElementById('pip-root') || pipWin.document.body;
    if (!root) return;

    // Spotify-style breakpoints (width + height)
    let layout = 'standard';
    if (h >= 280) {
      layout = 'expanded';
    } else if (w < 320 || h < 85) {
      layout = 'compact';
    } else {
      layout = 'standard';
    }

    root.classList.remove('layout-compact', 'layout-standard', 'layout-expanded', 'hide-controls');
    root.classList.add('layout-' + layout);
    root.dataset.layout = layout;
    if (h < 70) root.classList.add('hide-controls');

    // Re-evaluate title marquee after size change
    try {
      const titleEl = pipWin.document.getElementById('pip-title');
      const titleTrack = pipWin.document.getElementById('pip-title-track');
      if (titleEl && titleTrack) {
        titleTrack.classList.remove('marquee');
        titleEl.style.animation = 'none';
        const overflow = titleEl.scrollWidth - titleTrack.clientWidth;
        if (overflow > 6) {
          const dist = Math.ceil(overflow + 12);
          const dur = Math.max(4.5, Math.min(12, dist / 22));
          titleTrack.style.setProperty('--marquee-x', `-${dist}px`);
          titleTrack.style.setProperty('--marquee-dur', `${dur}s`);
          titleTrack.classList.add('marquee');
          void titleEl.offsetWidth;
          titleEl.style.animation = '';
        } else {
          titleTrack.style.removeProperty('--marquee-x');
          titleTrack.style.removeProperty('--marquee-dur');
          titleEl.style.animation = '';
        }
      }
    } catch {}
  }

  async function enterDocumentPiP() {
    const pipWin = await window.documentPictureInPicture.requestWindow({
      width: 360,
      height: 360,
    });
    docPipWindow = pipWin;
    pipWin.document.head.innerHTML = '';
    pipWin.document.body.innerHTML = buildDocPipHTML();
    wireDocPipControls(pipWin);
    updateDocPipUI();
    applyDocPipLayout(pipWin);
    try {
      const ro = new pipWin.ResizeObserver(() => applyDocPipLayout(pipWin));
      ro.observe(pipWin.document.documentElement);
      pipWin.__pipRo = ro;
    } catch {
      pipWin.addEventListener('resize', () => applyDocPipLayout(pipWin));
    }
    pipWin.addEventListener('pagehide', () => {
      try { pipWin.__pipRo?.disconnect(); } catch {}
      docPipWindow = null;
      pipActive = false;
      pipMode = null;
      stopPipRedraw();
      updatePipButtonState();
    });
    pipMode = 'document';
    pipActive = true;
    return true;
  }

  async function enterVideoPiP() {
    const playlist = getNextDataPlaylist();
    const coverUrl = getCoverUrl(playlist);
    const title = cleanText(playlist?.name || document.title) || 'Voiz';
    const chapter = continuousChapters?.[continuousIndex];
    const chapterName = chapter?.name || chapter?.title || (continuousIndex >= 0 ? `Chương ${continuousIndex + 1}` : '');
    await drawPipCover(coverUrl, title, chapterName, true);
    const { video } = ensurePipElements();
    await video.play();
    if (document.pictureInPictureElement !== video) {
      await video.requestPictureInPicture();
    }
    pipMode = 'video';
    pipActive = true;
    return true;
  }

  function bindPipMediaSession() {
    if (pipMediaSessionBound || !navigator.mediaSession) return;
    pipMediaSessionBound = true;
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        const audio = getActiveMedia();
        if (audio) audio.play().catch(() => {});
        if (document.pictureInPictureElement) document.pictureInPictureElement.play().catch(() => {});
        updateDocPipUI();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        const audio = getActiveMedia();
        if (audio) audio.pause();
        if (document.pictureInPictureElement) document.pictureInPictureElement.pause();
        updateDocPipUI();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (continuousIndex > 0) playContinuousChapter(continuousIndex - 1);
        setTimeout(updateDocPipUI, 300);
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNextContinuousChapter();
        setTimeout(updateDocPipUI, 300);
      });
      try {
        navigator.mediaSession.setActionHandler('seekbackward', (d) => {
          const a = getActiveMedia();
          if (a) a.currentTime = Math.max(0, a.currentTime - (d.seekOffset || 15));
          updateDocPipUI();
        });
        navigator.mediaSession.setActionHandler('seekforward', (d) => {
          const a = getActiveMedia();
          if (a) a.currentTime = Math.min(a.duration || Infinity, a.currentTime + (d.seekOffset || 15));
          updateDocPipUI();
        });
        navigator.mediaSession.setActionHandler('seekto', (d) => {
          const a = getActiveMedia();
          if (a && d.seekTime != null) a.currentTime = d.seekTime;
          updateDocPipUI();
        });
      } catch {}
      try {
        // Chrome gọi handler này khi user chuyển tab (Auto PiP) — không cần user gesture
        navigator.mediaSession.setActionHandler('enterpictureinpicture', async () => {
          if (pipActive || document.pictureInPictureElement) return;
          if (docPipWindow && !docPipWindow.closed) return;
          const media = getActiveMedia();
          if (!media || media.paused) return;
          try {
            await enterPictureInPicture();
          } catch (e) {
            console.warn('[Voiz PiP] auto enterpictureinpicture failed:', e);
          }
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

  function updateMediaSessionPosition() {
    if (!navigator.mediaSession || !navigator.mediaSession.setPositionState) return;
    try {
      const audio = getActiveMedia();
      if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return;
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, audio.duration),
      });
      navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    } catch {}
  }

  async function enterPictureInPicture() {
    if (!document.pictureInPictureEnabled && !supportsDocumentPiP()) {
      updateContinuousUI({ status: 'Trình duyệt không hỗ trợ PiP' });
      return false;
    }
    const audio = getActiveMedia();
    if (!audio && !continuousPlaying) {
      updateContinuousUI({ status: 'Hãy bắt đầu nghe liên tục trước khi bật PiP' });
      return false;
    }
    try {
      if (supportsDocumentPiP()) {
        await enterDocumentPiP();
      } else {
        await enterVideoPiP();
      }
      bindPipMediaSession();
      updateMediaSessionMetadata();
      updateMediaSessionPosition();
      startPipRedraw();
      updatePipButtonState();
      updateContinuousUI({ status: 'Đang phát PiP (Spotify-style)' });
      return true;
    } catch (err) {
      console.warn('[Voiz PiP] enter failed:', err);
      if (supportsDocumentPiP() && pipMode !== 'video') {
        try {
          await enterVideoPiP();
          bindPipMediaSession();
          updateMediaSessionMetadata();
          updateMediaSessionPosition();
          startPipRedraw();
          updatePipButtonState();
          updateContinuousUI({ status: 'Đang phát PiP (canvas)' });
          return true;
        } catch (e2) {
          console.warn('[Voiz PiP] video fallback failed:', e2);
        }
      }
      updateContinuousUI({ status: `PiP lỗi: ${err.message || err}` });
      pipActive = false;
      pipMode = null;
      updatePipButtonState();
      return false;
    }
  }

  async function exitPictureInPicture() {
    try {
      if (docPipWindow && !docPipWindow.closed) {
        docPipWindow.close();
        docPipWindow = null;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    } catch {}
    pipActive = false;
    pipMode = null;
    stopPipRedraw();
    updatePipButtonState();
  }

  async function togglePictureInPicture() {
    if (pipActive || document.pictureInPictureElement || (docPipWindow && !docPipWindow.closed)) {
      await exitPictureInPicture();
      updateContinuousUI({ status: continuousPlaying ? 'Đang phát' : '' });
    } else {
      await enterPictureInPicture();
    }
  }

  function updatePipButtonState() {
    document.querySelectorAll('#voiz-continuous-overlay [data-ct-pip]').forEach((btn) => {
      btn.classList.toggle('ct-active', pipActive);
      if (!btn.classList.contains('ct-full-icon-btn') && !btn.classList.contains('ct-desktop-control')) {
        btn.style.background = pipActive
          ? 'linear-gradient(145deg,#8b5cf6,#6d28d9)'
          : 'rgba(55,65,81,0.9)';
      }
      btn.title = pipActive ? 'Thoát Picture-in-Picture' : 'Bật Picture-in-Picture (Spotify-style · nổi trên màn hình)';
    });
  }

  function updateContinuousUI(opts = {}) {
    const ui = document.getElementById('voiz-continuous-overlay');
    if (!ui) return;
    // Có thể có 2 bản sao (chế độ full + thu gọn) — cập nhật đồng bộ cả hai.
    const titleEls = ui.querySelectorAll('[data-ct-title]');
    const statusEls = ui.querySelectorAll('[data-ct-status]');
    const progressEls = ui.querySelectorAll('[data-ct-progress]');
    const seekEls = ui.querySelectorAll('[data-ct-seek]');
    const timeCurEls = ui.querySelectorAll('[data-ct-time-cur]');
    const timeDurEls = ui.querySelectorAll('[data-ct-time-dur]');
    const timeRemainEls = ui.querySelectorAll('[data-ct-time-remain]');
    const chapterEls = ui.querySelectorAll('[data-ct-chapter]');
    const expandedStatusEls = ui.querySelectorAll('[data-ct-expanded-status]');
    const miniFillEl = ui.querySelector('[data-ct-mini-fill]');

    if (opts.title != null) titleEls.forEach((el) => { el.textContent = opts.title; });
    if (opts.status != null) statusEls.forEach((el) => { el.textContent = opts.status; });
    if (opts.chapterLabel != null) {
      chapterEls.forEach((el) => { el.textContent = opts.chapterLabel; });
      expandedStatusEls.forEach((el) => { el.textContent = `Đang phát: ${opts.chapterLabel}`; });
    }

    if (typeof opts.currentTime === 'number' && typeof opts.duration === 'number' && opts.duration > 0) {
      continuousDuration = opts.duration;
      seekEls.forEach((seekEl) => {
        if (!continuousSeeking) {
          seekEl.max = String(opts.duration);
          seekEl.value = String(opts.currentTime);
          seekEl.disabled = false;
        }
      });
      timeCurEls.forEach((el) => { el.textContent = secondsToDuration(opts.currentTime); });
      timeDurEls.forEach((el) => { el.textContent = secondsToDuration(opts.duration); });
      timeRemainEls.forEach((el) => {
        const remain = Math.max(0, opts.duration - opts.currentTime);
        el.textContent = `-${secondsToDuration(remain)}`;
      });
      progressEls.forEach((el) => { el.style.display = 'block'; });
      if (miniFillEl) {
        const pct = Math.max(0, Math.min(100, (opts.currentTime / opts.duration) * 100));
        miniFillEl.style.width = `${pct}%`;
      }
    } else if (opts.hideProgress) {
      progressEls.forEach((el) => { el.style.display = 'none'; });
      seekEls.forEach((seekEl) => {
        seekEl.value = '0';
        seekEl.disabled = true;
      });
      timeCurEls.forEach((el) => { el.textContent = '0:00'; });
      timeDurEls.forEach((el) => { el.textContent = '0:00'; });
      timeRemainEls.forEach((el) => { el.textContent = '-0:00'; });
      if (miniFillEl) miniFillEl.style.width = '0%';
    }
  }

  function renderChapterList(ui) {
    const listEls = ui.querySelectorAll('[data-ct-list]');
    if (!listEls.length || !continuousChapters) return;
    ui.querySelectorAll('[data-ct-list-count]').forEach((countEl) => {
      countEl.textContent = ` ${continuousChapters.length}`;
    });
    listEls.forEach((listEl) => {
      listEl.innerHTML = '';
      continuousChapters.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.index = String(index);
      row.className = 'ct-chapter-row';
      const isCurrent = index === continuousIndex;
      row.dataset.current = isCurrent ? '1' : '0';
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
        ui.querySelectorAll('[data-ct-list-panel]').forEach((panel) => { panel.style.display = 'none'; });
        ui.querySelectorAll('[data-ct-list-toggle]').forEach((btn) => {
          if (btn.querySelector('.lb')) btn.classList.remove('ct-active');
          else btn.innerHTML = '<span style="opacity:0.9">☰</span> Danh sách chương';
        });
        ui.dataset.ctSheet = '0';
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
    });
  }

  function stripListenCtasFromContinuousUI(ui) {
    if (!ui) return;
    try {
      ui.querySelectorAll('[data-ct-cover-wrap] a, [data-ct-cover-wrap] button, [data-ct-cover-wrap] [role="button"]').forEach((el) => {
        el.remove();
      });
      ui.querySelectorAll('a, button, [role="button"]').forEach((el) => {
        const text = cleanText(el.textContent || '');
        if (/^nghe\s+s[aá]ch$/i.test(text)) el.remove();
      });
    } catch {}
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
      try {
        const ctas = findListenCtas();
        if (ctas) hideListenCtas(ctas);
      } catch {}
      stripListenCtasFromContinuousUI(ui);
      if (continuousChapters) renderChapterList(ui);
      return ui;
    }
    ui = document.createElement('div');
    ui.id = 'voiz-continuous-overlay';
    // Base styles applied via injected stylesheet (responsive desktop / mobile)
    ui.style.cssText = 'z-index:2147483647;box-sizing:border-box;';

    ui.innerHTML = `
<style>
  #voiz-continuous-overlay {
    position: fixed;
    left: 50%;
    bottom: max(16px, env(safe-area-inset-bottom, 16px));
    transform: translateX(-50%);
    width: min(440px, calc(100vw - 20px));
    max-height: min(82vh, 620px);
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #1a1f2e 0%, #111827 100%);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(124,58,237,0.12);
    padding: 12px 14px 14px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 13px;
    gap: 0;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }
  #voiz-continuous-overlay * { box-sizing: border-box; }
  #voiz-continuous-overlay .ct-row-top {
    display: flex; align-items: center; gap: 12px; flex-shrink: 0; margin-bottom: 10px;
  }
  #voiz-continuous-overlay [data-ct-cover-wrap] {
    flex: none; width: 48px; height: 48px; border-radius: 12px; overflow: hidden;
    background: #1f2937; border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    position: relative;
  }
  #voiz-continuous-overlay [data-ct-cover] {
    width: 100%; height: 100%; object-fit: cover; display: none;
  }
  #voiz-continuous-overlay [data-ct-cover-wrap] a,
  #voiz-continuous-overlay [data-ct-cover-wrap] button,
  #voiz-continuous-overlay [data-ct-cover-wrap] [role="button"],
  #voiz-continuous-overlay [data-ct-cover-wrap] [class*="listen"],
  #voiz-continuous-overlay [data-ct-cover-wrap] [class*="nghe"] {
    display: none !important;
  }
  #voiz-continuous-overlay [data-ct-cover-fallback] {
    width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
    font-size: 22px; background: linear-gradient(135deg,#4c1d95,#7c3aed);
  }
  #voiz-continuous-overlay .ct-meta {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  }
  #voiz-continuous-overlay [data-ct-title] {
    font-weight: 700; font-size: 14px; line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #f9fafb;
  }
  #voiz-continuous-overlay [data-ct-chapter] {
    font-size: 11px; color: #9ca3af;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #voiz-continuous-overlay [data-ct-status] {
    font-size: 11px; color: #a78bfa;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #voiz-continuous-overlay [data-ct-wakelock] {
    font-size: 10px; color: #6b7280;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #voiz-continuous-overlay [data-ct-close] {
    flex: none; background: transparent; color: #9ca3af; border: 0;
    font-size: 20px; line-height: 1; cursor: pointer; padding: 4px 6px; border-radius: 8px;
  }
  #voiz-continuous-overlay [data-ct-close]:hover { color: #f9fafb; }
  #voiz-continuous-overlay [data-ct-progress] {
    display: none; flex-shrink: 0; margin-bottom: 10px;
  }
  #voiz-continuous-overlay [data-ct-seek] {
    width: 100%; margin: 0; accent-color: #8b5cf6; cursor: pointer;
    height: 6px; border-radius: 999px; background: rgba(255,255,255,0.12);
  }
  #voiz-continuous-overlay .ct-times {
    display: flex; justify-content: space-between; margin-top: 4px;
    font-size: 11px; color: #9ca3af; font-variant-numeric: tabular-nums;
  }
  #voiz-continuous-overlay .ct-controls {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    flex-shrink: 0; margin-bottom: 4px;
  }
  #voiz-continuous-overlay .ct-btn {
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 50%; background: rgba(55,65,81,0.9); color: #fff;
    cursor: pointer; transition: background .15s, transform .1s;
  }
  #voiz-continuous-overlay .ct-btn:hover { background: rgba(75,85,99,0.95); }
  #voiz-continuous-overlay .ct-btn:active { transform: scale(0.94); }
  #voiz-continuous-overlay [data-ct-speed-main],
  #voiz-continuous-overlay [data-ct-timer-main],
  #voiz-continuous-overlay [data-ct-pip] {
    border-radius: 10px; background: rgba(55,65,81,0.9); color: #e5e7eb;
    font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
  }
  #voiz-continuous-overlay [data-ct-speed-main] { min-width: 42px; height: 36px; padding: 0 8px; }
  #voiz-continuous-overlay [data-ct-timer-main] { min-width: 42px; height: 36px; padding: 0 6px; }
  #voiz-continuous-overlay [data-ct-pip] { width: 36px; height: 36px; }
  #voiz-continuous-overlay [data-ct-prev],
  #voiz-continuous-overlay [data-ct-next] { width: 40px; height: 40px; }
  #voiz-continuous-overlay [data-ct-toggle] {
    width: 52px; height: 52px;
    background: linear-gradient(145deg, #8b5cf6, #6d28d9);
    box-shadow: 0 4px 16px rgba(124,58,237,0.45);
  }
  #voiz-continuous-overlay [data-ct-toggle]:hover {
    background: linear-gradient(145deg, #a78bfa, #7c3aed);
  }
  #voiz-continuous-overlay [data-ct-speed-panel] {
    display: none; flex-shrink: 0; flex-wrap: wrap; gap: 6px; justify-content: center; padding: 8px 0 4px;
  }
  #voiz-continuous-overlay [data-ct-sleep-panel] {
    display: none; flex-shrink: 0; flex-direction: column; gap: 6px; padding: 8px 0 4px;
  }
  #voiz-continuous-overlay [data-ct-sleep-label] {
    font-size: 11px; color: #9ca3af; text-align: center;
  }
  #voiz-continuous-overlay [data-ct-sleep-presets] {
    display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
  }
  #voiz-continuous-overlay [data-ct-list-toggle] {
    flex-shrink: 0; width: 100%; margin-top: 6px; padding: 9px 12px;
    border: 1px solid rgba(255,255,255,0.10); border-radius: 10px;
    background: rgba(31,41,55,0.8); color: #e5e7eb; font-size: 12px; font-weight: 600;
    cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  #voiz-continuous-overlay [data-ct-list-toggle]:hover { background: rgba(55,65,81,0.9); }
  #voiz-continuous-overlay [data-ct-list-panel] {
    display: none; flex: 1; min-height: 0; flex-direction: column; gap: 4px;
    overflow: hidden; margin-top: 8px;
  }
  #voiz-continuous-overlay [data-ct-list] {
    flex: 1; min-height: 120px; max-height: min(40vh, 300px); overflow: auto;
    -webkit-overflow-scrolling: touch; display: flex; flex-direction: column; gap: 2px;
    padding: 2px 0; scrollbar-width: thin;
  }
  #voiz-continuous-overlay .ct-desktop-only { display: none; }
  #voiz-continuous-overlay .ct-bar { display: none; }
  #voiz-continuous-overlay .ct-expanded { display: none; }
  #voiz-continuous-overlay .ct-mini,
  #voiz-continuous-overlay .ct-full { display: none; }

  /* ════════════════════════════════════════════════════════════════════
     MOBILE (< 900px): chế độ "Thu gọn" (mini-bar) và "Full" (toàn màn hình)
     ════════════════════════════════════════════════════════════════════ */
  @media (max-width: 899.98px) {
    #voiz-continuous-overlay { padding: 0; overflow: visible; background: transparent; border: 0; box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
    /* Chế độ "full": bỏ transform/left/bottom trên gốc để .ct-full (position:fixed; inset:0)
       lấy viewport thật làm containing block, không bị kẹt trong khung nhỏ của .ct-mini */
    #voiz-continuous-overlay[data-ct-mode="full"] {
      left: 0; right: 0; bottom: 0; top: 0;
      transform: none;
      width: 100%; max-width: none; max-height: none;
    }

    /* ── Thu gọn: thanh mini bám đáy màn hình ─────────────────────────── */
    #voiz-continuous-overlay[data-ct-mode="collapsed"] .ct-mini { display: flex; }
    #voiz-continuous-overlay .ct-mini {
      position: relative; align-items: center; gap: 10px;
      width: min(440px, calc(100vw - 20px));
      background: linear-gradient(180deg, #232838 0%, #14171f 100%);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 14px;
      box-shadow: 0 14px 40px rgba(0,0,0,0.5);
      padding: 8px 10px;
      cursor: pointer;
      overflow: hidden;
    }
    #voiz-continuous-overlay .ct-mini-fillwrap {
      position: absolute; left: 0; right: 0; top: 0; height: 3px;
      background: rgba(255,255,255,0.08);
    }
    #voiz-continuous-overlay .ct-mini-fill {
      height: 100%; width: 0%; background: linear-gradient(90deg,#a78bfa,#7c3aed);
      transition: width .2s linear;
    }
    #voiz-continuous-overlay .ct-mini-cover {
      flex: none; width: 40px; height: 40px; border-radius: 9px; overflow: hidden;
      background: #1f2937; position: relative;
    }
    #voiz-continuous-overlay .ct-mini-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    #voiz-continuous-overlay .ct-mini-title { font-size: 12.5px; font-weight: 700; color: #f9fafb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #voiz-continuous-overlay .ct-mini-chapter { font-size: 10.5px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #voiz-continuous-overlay .ct-mini-btn {
      flex: none; width: 34px; height: 34px; border-radius: 50%; border: 0;
      background: rgba(255,255,255,0.08); color: #fff; display: flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    #voiz-continuous-overlay .ct-mini-btn.ct-mini-play { width: 38px; height: 38px; background: #7c3aed; }
    #voiz-continuous-overlay .ct-mini-btn.ct-mini-close { background: transparent; color: #6b7280; font-size: 18px; width: 26px; }
    #voiz-continuous-overlay .ct-mini-btn svg { width: 16px; height: 16px; }
    #voiz-continuous-overlay .ct-mini-btn.ct-mini-play svg { width: 18px; height: 18px; }

    /* ── Full: toàn màn hình, giống trình phát Mydio/Voiz app ───────────── */
    #voiz-continuous-overlay[data-ct-mode="full"] .ct-full { display: flex; }
    #voiz-continuous-overlay .ct-full {
      position: fixed; inset: 0; left: 0; right: 0; top: 0; bottom: 0;
      width: 100%; height: 100%;
      flex-direction: column;
      background: radial-gradient(120% 90% at 50% -10%, #2a2140 0%, #14151d 55%, #0c0d12 100%);
      color: #fff;
      padding: max(14px, env(safe-area-inset-top, 14px)) 20px max(18px, env(safe-area-inset-bottom, 18px));
      overflow: hidden;
    }
    #voiz-continuous-overlay .ct-full-header {
      display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; margin-bottom: 6px;
    }
    #voiz-continuous-overlay .ct-icon-btn {
      width: 40px; height: 40px; border-radius: 50%; border: 0; background: transparent;
      color: #e5e7eb; display: flex; align-items: center; justify-content: center; cursor: pointer;
      font-size: 22px; line-height: 1;
    }
    #voiz-continuous-overlay .ct-icon-btn:hover { background: rgba(255,255,255,0.08); }
    #voiz-continuous-overlay .ct-full-cover-wrap {
      flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center;
      margin: 6px auto 18px; width: 100%;
    }
    #voiz-continuous-overlay .ct-full-cover-wrap [data-ct-cover-wrap] {
      width: min(72vw, 320px); height: min(72vw, 320px); border-radius: 18px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.55);
    }
    #voiz-continuous-overlay .ct-full-cover-wrap [data-ct-cover-fallback] { font-size: 64px; }
    #voiz-continuous-overlay .ct-full-meta { flex-shrink: 0; text-align: center; padding: 0 6px; margin-bottom: 18px; }
    #voiz-continuous-overlay .ct-full-meta [data-ct-title] {
      display: block; font-size: 19px; font-weight: 800; color: #fff; white-space: normal;
      overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    #voiz-continuous-overlay .ct-full-meta [data-ct-chapter] {
      display: block; font-size: 13px; color: #9ca3af; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #voiz-continuous-overlay .ct-full-progress { flex-shrink: 0; margin-bottom: 14px; display: block !important; }
    #voiz-continuous-overlay .ct-full-progress [data-ct-seek] { height: 4px; accent-color: #a78bfa; }
    #voiz-continuous-overlay .ct-full-transport {
      display: flex; align-items: center; justify-content: center; gap: 20px; flex-shrink: 0; margin-bottom: 22px;
    }
    #voiz-continuous-overlay .ct-full-btn {
      border: 0; background: transparent; color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border-radius: 50%;
    }
    #voiz-continuous-overlay .ct-full-btn:active { transform: scale(0.92); }
    #voiz-continuous-overlay .ct-full-btn svg { width: 26px; height: 26px; fill: currentColor; }
    #voiz-continuous-overlay .ct-full-btn.ct-seek-btn { position: relative; width: 44px; height: 44px; }
    #voiz-continuous-overlay .ct-full-btn.ct-seek-btn svg { width: 30px; height: 30px; }
    #voiz-continuous-overlay .ct-seek-num {
      position: absolute; left: 50%; top: 54%; transform: translate(-50%, -50%);
      font-size: 9px; font-weight: 800; color: #14151d; pointer-events: none;
    }
    #voiz-continuous-overlay .ct-full-btn.ct-full-play {
      width: 68px; height: 68px; background: #fff; color: #14151d;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    #voiz-continuous-overlay .ct-full-btn.ct-full-play svg { width: 30px; height: 30px; }
    #voiz-continuous-overlay .ct-full-icons {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: flex-start; flex-shrink: 0; margin-bottom: 4px;
      gap: 4px; width: 100%;
    }
    #voiz-continuous-overlay .ct-full-icon-btn {
      border: 0; background: transparent; color: #e5e7eb; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      justify-content: flex-start; width: 100%; min-width: 0; height: 48px;
      padding: 4px 2px; border-radius: 12px;
    }
    #voiz-continuous-overlay .ct-full-icons [data-ct-speed-main] { display: flex !important; }
    #voiz-continuous-overlay .ct-full-icon-btn:active { background: rgba(255,255,255,0.06); }
    #voiz-continuous-overlay .ct-full-icon-btn.ct-active { color: #a78bfa; }
    #voiz-continuous-overlay .ct-full-icon-btn .ic {
      display: flex; align-items: center; justify-content: center; height: 24px; font-size: 15px; font-weight: 800;
    }
    #voiz-continuous-overlay .ct-full-icon-btn .ic svg { width: 22px; height: 22px; }
    #voiz-continuous-overlay .ct-full-icon-btn .lb { font-size: 11px; color: inherit; opacity: 0.85; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
    #voiz-continuous-overlay .ct-full-status,
    #voiz-continuous-overlay .ct-full-wakelock {
      flex-shrink: 0; text-align: center; font-size: 11px; color: #6b7280; margin-top: 6px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #voiz-continuous-overlay .ct-full-status { color: #a78bfa; }

    /* ── Bottom sheet: tốc độ / hẹn giờ / danh sách chương (dùng chung) ─── */
    #voiz-continuous-overlay .ct-panels { position: static; }
    #voiz-continuous-overlay[data-ct-sheet="1"] .ct-panels {
      position: fixed; inset: 0; z-index: 3; display: flex; align-items: flex-end; justify-content: center;
      background: rgba(0,0,0,0.55);
    }
    #voiz-continuous-overlay[data-ct-sheet="1"] [data-ct-speed-panel],
    #voiz-continuous-overlay[data-ct-sheet="1"] [data-ct-sleep-panel],
    #voiz-continuous-overlay[data-ct-sheet="1"] [data-ct-list-panel] {
      width: 100%;
      background: #181a22;
      border-radius: 18px 18px 0 0;
      padding: 10px 18px max(18px, env(safe-area-inset-bottom, 18px));
      max-height: 72vh;
      box-shadow: 0 -20px 50px rgba(0,0,0,0.5);
    }
    #voiz-continuous-overlay [data-ct-sheet-handle] {
      width: 40px; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.22);
      margin: 2px auto 14px;
    }
    #voiz-continuous-overlay [data-ct-sheet-title] {
      text-align: center; font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 12px;
    }
    #voiz-continuous-overlay [data-ct-speed-panel] { flex-direction: column; flex-wrap: nowrap; gap: 0; justify-content: flex-start; padding-top: 0; }
    #voiz-continuous-overlay [data-ct-speed-panel] button {
      width: 100%; height: 46px; border-radius: 0 !important; background: transparent !important;
      border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 15px !important; font-weight: 500 !important;
      padding: 0 !important; display: flex; align-items: center; justify-content: flex-start; text-align: left;
      color: #e5e7eb; aspect-ratio: auto; max-width: none; flex: none;
    }
    #voiz-continuous-overlay [data-ct-speed-panel] button.ct-speed-selected {
      color: #fff; font-weight: 800 !important; font-size: 17px !important;
    }
    #voiz-continuous-overlay [data-ct-sleep-panel] { padding-top: 0; }
    #voiz-continuous-overlay [data-ct-sleep-presets] { flex-direction: column; gap: 0; }
    #voiz-continuous-overlay [data-ct-sleep-presets] button {
      width: 100%; height: 46px; border-radius: 0 !important; background: transparent !important;
      border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 15px !important; font-weight: 500 !important;
      color: #e5e7eb;
    }
    #voiz-continuous-overlay [data-ct-sleep-presets] button.ct-sleep-selected {
      color: #fff; font-weight: 800 !important; font-size: 17px !important;
    }
    #voiz-continuous-overlay [data-ct-sheet-done] {
      display: block; width: 100%; margin-top: 14px; height: 48px; border: 0; border-radius: 999px;
      background: #e11d48; color: #fff; font-weight: 800; font-size: 14px; letter-spacing: 0.02em; cursor: pointer;
    }
    #voiz-continuous-overlay [data-ct-list-panel] { margin-top: 0; }
    #voiz-continuous-overlay [data-ct-list-header] {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
    }
    #voiz-continuous-overlay [data-ct-list-count] { color: #6b7280; font-weight: 600; font-size: 13px; margin-left: 6px; }
    #voiz-continuous-overlay [data-ct-list-close] {
      background: rgba(255,255,255,0.08); border: 0; color: #fff; width: 30px; height: 30px; border-radius: 50%;
      font-size: 16px; cursor: pointer;
    }
    #voiz-continuous-overlay [data-ct-list] { max-height: 52vh; }
  }

  /* ══════ Desktop ≥ 900px: Voiz-style full-width bottom bar ══════ */
  @media (min-width: 900px) {
    #voiz-continuous-overlay {
      left: 0; right: 0; bottom: 0;
      transform: none;
      width: 100%;
      max-width: none;
      max-height: none;
      border-radius: 16px 16px 0 0;
      border: 0;
      border-top: 1px solid rgba(255,255,255,0.08);
      padding: 0;
      background: rgba(17, 19, 28, 0.96);
      box-shadow: 0 -8px 40px rgba(0,0,0,0.45);
      backdrop-filter: blur(24px) saturate(1.2);
      -webkit-backdrop-filter: blur(24px) saturate(1.2);
    }
    #voiz-continuous-overlay .ct-mini,
    #voiz-continuous-overlay .ct-full { display: none !important; }
    #voiz-continuous-overlay .ct-bar {
      display: grid;
      grid-template-columns: minmax(200px, 1.1fr) minmax(280px, 1.4fr) minmax(160px, 0.9fr);
      align-items: center;
      gap: 16px 24px;
      padding: 12px 28px 14px;
      min-height: 88px;
    }
    #voiz-continuous-overlay .ct-row-top {
      margin: 0; gap: 14px; min-width: 0;
    }
    #voiz-continuous-overlay [data-ct-cover-wrap] {
      width: 64px; height: 64px; border-radius: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.35);
    }
    #voiz-continuous-overlay [data-ct-title] { font-size: 15px; }
    #voiz-continuous-overlay [data-ct-chapter] { font-size: 12px; color: #c4b5fd; }
    #voiz-continuous-overlay [data-ct-status] { font-size: 12px; }
    #voiz-continuous-overlay [data-ct-close] {
      width: 32px; height: 32px; font-size: 18px;
      border-radius: 8px; background: rgba(255,255,255,0.06);
    }
    #voiz-continuous-overlay [data-ct-close]:hover { background: rgba(255,255,255,0.12); }
    #voiz-continuous-overlay .ct-mobile-only { display: none !important; }

    /* Center column: progress + transport */
    #voiz-continuous-overlay .ct-center {
      display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 0;
    }
    #voiz-continuous-overlay [data-ct-progress] {
      display: block !important; margin: 0; order: 2;
    }
    #voiz-continuous-overlay [data-ct-seek] {
      height: 5px; accent-color: #a78bfa;
    }
    #voiz-continuous-overlay .ct-times { margin-top: 2px; font-size: 11px; color: #9ca3af; }
    #voiz-continuous-overlay .ct-controls {
      order: 1; margin: 0; gap: 10px;
    }
    #voiz-continuous-overlay [data-ct-toggle] {
      width: 48px; height: 48px;
      background: #7c3aed;
      box-shadow: 0 4px 18px rgba(124,58,237,0.5);
    }
    #voiz-continuous-overlay [data-ct-prev],
    #voiz-continuous-overlay [data-ct-next] {
      width: 38px; height: 38px; background: transparent;
    }
    #voiz-continuous-overlay [data-ct-prev]:hover,
    #voiz-continuous-overlay [data-ct-next]:hover {
      background: rgba(255,255,255,0.1);
    }
    #voiz-continuous-overlay [data-ct-speed-main],
    #voiz-continuous-overlay [data-ct-timer-main],
    #voiz-continuous-overlay [data-ct-pip] {
      background: transparent; color: #d1d5db;
      min-width: 40px; height: 36px;
    }
    #voiz-continuous-overlay [data-ct-speed-main]:hover,
    #voiz-continuous-overlay [data-ct-timer-main]:hover,
    #voiz-continuous-overlay [data-ct-pip]:hover {
      background: rgba(255,255,255,0.1); color: #fff;
    }

    /* Right column: chapter list + extras */
    #voiz-continuous-overlay .ct-right {
      display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0;
    }
    #voiz-continuous-overlay [data-ct-list-toggle] {
      width: auto; margin: 0; padding: 8px 14px;
      border-radius: 10px; white-space: nowrap;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
    }
    #voiz-continuous-overlay [data-ct-list-toggle].ct-active {
      background: rgba(124,58,237,0.35); border-color: rgba(167,139,250,0.5); color: #fff;
    }
    #voiz-continuous-overlay .ct-desktop-only { display: inline-flex; }

    /* Expandable panels sit above the bar */
    #voiz-continuous-overlay .ct-panels {
      order: -1;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      background: rgba(10,12,20,0.6);
    }
    #voiz-continuous-overlay [data-ct-speed-panel],
    #voiz-continuous-overlay [data-ct-sleep-panel] {
      padding: 12px 28px;
      justify-content: center;
    }
    #voiz-continuous-overlay [data-ct-sheet-handle],
    #voiz-continuous-overlay [data-ct-sheet-title],
    #voiz-continuous-overlay [data-ct-sheet-done],
    #voiz-continuous-overlay [data-ct-list-header] { display: none; }
    #voiz-continuous-overlay [data-ct-list-panel] {
      margin: 0; max-height: min(42vh, 360px);
      padding: 8px 28px 12px;
    }
    #voiz-continuous-overlay [data-ct-list] {
      max-height: min(38vh, 320px); min-height: 80px;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 4px 12px;
    }

    /* Tammi-style desktop player */
    #voiz-continuous-overlay[data-ct-desktop-view="expanded"] {
      top: 0;
      height: 100vh;
      min-height: 100vh;
      overflow: hidden;
      background:
        radial-gradient(60% 70% at 26% 44%, rgba(128, 76, 42, 0.38), transparent 62%),
        radial-gradient(65% 80% at 62% 40%, rgba(31, 42, 62, 0.58), transparent 66%),
        linear-gradient(180deg, #11101a 0%, #090a0f 100%);
    }
    /* .ct-expanded và .ct-bar là 2 flex-item xếp dọc trong overlay (flex-direction:column
       khai báo ở rule gốc #voiz-continuous-overlay). Thay vì đoán trước chiều cao thật của
       .ct-bar bằng calc(100vh - 108px) — con số này lệch với chiều cao render thật (padding +
       2 hàng nội dung của .ct-bar cao hơn 108px), khiến tổng chiều cao > 100vh và phần dưới của
       .ct-bar (đồng hồ thời gian) bị đẩy khuất dưới viewport — để flexbox tự chia chỗ:
       .ct-bar co theo đúng nội dung của nó (flex: 0 0 auto), .ct-expanded lấy phần còn lại
       (flex: 1 1 auto) và tự cuộn nếu nội dung cao hơn chỗ còn lại. */
    #voiz-continuous-overlay .ct-expanded {
      display: none;
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 42px clamp(44px, 8vw, 150px) 128px;
      grid-template-columns: minmax(320px, 1fr) minmax(360px, 0.9fr);
      align-items: center;
      gap: clamp(42px, 8vw, 110px);
    }
    #voiz-continuous-overlay[data-ct-desktop-view="expanded"] .ct-expanded { display: grid; }
    #voiz-continuous-overlay .ct-expanded-left {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; min-width: 0;
    }
    #voiz-continuous-overlay .ct-expanded-cover [data-ct-cover-wrap] {
      width: clamp(190px, 17vw, 260px); height: clamp(260px, 24vw, 360px);
      border-radius: 14px; border: 3px solid rgba(255,255,255,0.88);
      box-shadow: 0 26px 80px rgba(0,0,0,0.58);
    }
    #voiz-continuous-overlay .ct-expanded-cover [data-ct-cover-fallback] { font-size: 72px; }
    #voiz-continuous-overlay .ct-expanded-title {
      margin-top: 32px; max-width: 760px; font-size: clamp(28px, 3.2vw, 48px) !important;
      line-height: 1.08 !important; font-weight: 850 !important; white-space: normal !important;
      color: #fff !important; text-wrap: balance;
    }
    #voiz-continuous-overlay .ct-expanded-status {
      margin-top: 18px; max-width: 680px; font-size: 18px !important; color: rgba(255,255,255,0.54) !important;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #voiz-continuous-overlay .ct-expanded-list-panel {
      display: flex !important; flex-direction: column; gap: 14px; min-width: 0; max-height: min(72vh, 620px);
    }
    #voiz-continuous-overlay .ct-expanded-list-panel [data-ct-sheet-title] {
      display: block; margin: 0; font-size: 24px; font-weight: 850; color: #fff; text-align: left;
    }
    #voiz-continuous-overlay .ct-expanded-list-panel [data-ct-list] {
      display: flex; flex-direction: column; gap: 10px; min-height: 0; max-height: min(62vh, 520px);
      overflow: auto; padding-right: 12px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.5) transparent;
    }
    #voiz-continuous-overlay .ct-expanded-list-panel .ct-chapter-row {
      min-height: 78px; padding: 13px 16px !important; border-radius: 9px !important;
      background: rgba(34, 34, 44, 0.82) !important; box-shadow: none !important;
      font-size: 17px !important; color: #f4f4f5 !important;
    }
    #voiz-continuous-overlay .ct-expanded-list-panel .ct-chapter-row[data-current="1"] {
      color: #8df56f !important; background: rgba(36, 42, 45, 0.9) !important;
    }
    #voiz-continuous-overlay .ct-expanded-list-panel .ct-chapter-no { display: none; }
    #voiz-continuous-overlay .ct-expanded-list-panel .ct-chapter-play {
      width: 46px; height: 46px; border-radius: 50%; background: #fff; color: #050505;
      display: inline-flex; align-items: center; justify-content: center; font-size: 14px !important;
      box-shadow: 0 0 0 5px rgba(255,255,255,0.14);
    }
    #voiz-continuous-overlay .ct-expanded-list-panel .ct-chapter-row[data-current="1"] .ct-chapter-play {
      background: #88f36b; color: #101410;
    }

    #voiz-continuous-overlay .ct-bar {
      grid-template-columns: minmax(230px, 1fr) minmax(500px, 1.45fr) minmax(190px, 1fr);
      gap: 22px;
      flex: 0 0 auto;
      min-height: 108px;
      padding: 14px 28px 16px;
      background: #000;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    #voiz-continuous-overlay .ct-bar [data-ct-cover-wrap] { width: 72px; height: 72px; border-radius: 10px; }
    #voiz-continuous-overlay .ct-bar .ct-meta [data-ct-chapter],
    #voiz-continuous-overlay .ct-bar .ct-meta [data-ct-status],
    #voiz-continuous-overlay .ct-bar .ct-meta [data-ct-wakelock] { display: none; }
    #voiz-continuous-overlay .ct-bar .ct-meta [data-ct-title] { font-size: 16px; font-weight: 650; }
    #voiz-continuous-overlay .ct-bar [data-ct-close] {
      background: transparent; color: #fff; font-size: 34px; width: 42px; height: 42px;
    }
    #voiz-continuous-overlay .ct-center { position: relative; gap: 6px; }
    #voiz-continuous-overlay .ct-controls { gap: 16px; }
    #voiz-continuous-overlay .ct-bar .ct-controls > .ct-btn:not(.ct-desktop-control) { display: none; }
    #voiz-continuous-overlay .ct-btn svg { width: 24px; height: 24px; }
    #voiz-continuous-overlay .ct-seek-btn { position: relative; }
    #voiz-continuous-overlay .ct-seek-btn .ct-seek-num {
      position: absolute; left: 50%; top: 54%; transform: translate(-50%, -50%);
      font-size: 8px; font-weight: 900; color: currentColor; pointer-events: none;
    }
    #voiz-continuous-overlay [data-ct-pip],
    #voiz-continuous-overlay [data-ct-seek-back],
    #voiz-continuous-overlay [data-ct-seek-fwd],
    #voiz-continuous-overlay [data-ct-prev],
    #voiz-continuous-overlay [data-ct-next],
    #voiz-continuous-overlay [data-ct-expand],
    #voiz-continuous-overlay [data-ct-timer-main] {
      width: 42px; height: 42px; min-width: 42px; border-radius: 50%;
      background: transparent; color: #fff;
    }
    #voiz-continuous-overlay [data-ct-toggle] {
      width: 56px; height: 56px; background: #fff; color: #050505;
      box-shadow: 0 0 0 6px rgba(255,255,255,0.12);
    }
    #voiz-continuous-overlay [data-ct-speed-main] {
      width: 54px; min-width: 54px; height: 42px; border-radius: 10px;
      background: transparent; color: #fff; font-size: 17px;
    }
    #voiz-continuous-overlay [data-ct-progress] { max-width: 720px; width: 100%; align-self: center; }
    #voiz-continuous-overlay [data-ct-seek] { height: 5px; accent-color: #fff; }
    #voiz-continuous-overlay .ct-times { margin-top: 6px; font-size: 16px; color: rgba(255,255,255,0.66); }
    #voiz-continuous-overlay .ct-right { gap: 18px; }
    #voiz-continuous-overlay .ct-right [data-ct-list-toggle] { display: none; }

    #voiz-continuous-overlay .ct-panels {
      position: static; order: 0; border: 0; background: transparent;
    }
    #voiz-continuous-overlay [data-ct-speed-panel],
    #voiz-continuous-overlay [data-ct-sleep-panel] {
      position: absolute; bottom: 96px; z-index: 5; width: 190px;
      max-height: 330px; overflow: hidden auto; padding: 0;
      background: #000; border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,0.55);
      flex-direction: column; gap: 0; justify-content: flex-start;
    }
    #voiz-continuous-overlay [data-ct-speed-panel] { left: calc(50% + 205px); }
    #voiz-continuous-overlay [data-ct-sleep-panel] { right: 104px; }
    #voiz-continuous-overlay [data-ct-sheet-title] {
      display: block; padding: 16px 20px; margin: 0; text-align: left;
      font-size: 16px; font-weight: 750; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.14);
    }
    #voiz-continuous-overlay [data-ct-speed-panel] button,
    #voiz-continuous-overlay [data-ct-sleep-presets] button {
      width: 100%; min-height: 44px; padding: 0 20px; border: 0; border-radius: 0 !important;
      background: transparent !important; color: #fff; text-align: left; font-size: 16px !important;
      font-weight: 650 !important; opacity: 1 !important;
    }
    #voiz-continuous-overlay [data-ct-speed-panel] button:hover,
    #voiz-continuous-overlay [data-ct-sleep-presets] button:hover { background: rgba(255,255,255,0.09) !important; }
    #voiz-continuous-overlay [data-ct-speed-panel] button[style*="#7c3aed"],
    #voiz-continuous-overlay [data-ct-sleep-presets] button.ct-sleep-selected { color: #8df56f !important; }
    #voiz-continuous-overlay [data-ct-sleep-label],
    #voiz-continuous-overlay [data-ct-sheet-handle],
    #voiz-continuous-overlay [data-ct-sheet-done],
    #voiz-continuous-overlay .ct-panels > [data-ct-list-panel] { display: none !important; }
  }
</style>

<div class="ct-panels">
  <div data-ct-speed-panel>
    <div data-ct-sheet-handle></div>
    <div data-ct-sheet-title>Tốc độ</div>
  </div>
  <div data-ct-sleep-panel>
    <div data-ct-sheet-handle></div>
    <div data-ct-sheet-title>Hẹn giờ tắt</div>
    <div data-ct-sleep-label>Hẹn giờ: Tắt</div>
    <div data-ct-sleep-presets></div>
    <button type="button" data-ct-sheet-done>XONG</button>
  </div>
  <div data-ct-list-panel>
    <div data-ct-list-header>
      <div data-ct-sheet-title style="margin:0;text-align:left">Danh sách chương<span data-ct-list-count></span></div>
      <button type="button" data-ct-list-close aria-label="Đóng">✕</button>
    </div>
    <div data-ct-list></div>
  </div>
</div>

<!-- Desktop ≥900px: thanh phát rộng bám đáy trang (không đổi so với bản trước) -->
<div class="ct-expanded">
  <div class="ct-expanded-left">
    <div class="ct-expanded-cover">
      <div data-ct-cover-wrap>
        <img data-ct-cover src="" alt="" />
        <div data-ct-cover-fallback>Audio</div>
      </div>
    </div>
    <div data-ct-title class="ct-expanded-title"></div>
    <div data-ct-expanded-status class="ct-expanded-status"></div>
  </div>
  <div class="ct-expanded-list-panel" data-ct-list-panel>
    <div data-ct-sheet-title>Danh sách chương<span data-ct-list-count></span></div>
    <div data-ct-list></div>
  </div>
</div>

<div class="ct-bar">
  <div class="ct-row-top">
    <div data-ct-cover-wrap>
      <img data-ct-cover src="" alt="" />
      <div data-ct-cover-fallback>🎧</div>
    </div>
    <div class="ct-meta">
      <div data-ct-title></div>
      <div data-ct-chapter></div>
      <div data-ct-status></div>
      <div data-ct-wakelock></div>
    </div>
    <button data-ct-close type="button" title="Dừng nghe liên tục">×</button>
  </div>

  <div class="ct-center">
    <div class="ct-controls">
      <button data-ct-pip type="button" class="ct-btn ct-desktop-control" title="Picture-in-Picture">${ICONS.pip}</button>
      <button data-ct-seek-back type="button" class="ct-btn ct-seek-btn ct-desktop-control" title="Lùi 10 giây">${ICONS.seekBack10}</button>
      <button data-ct-prev type="button" class="ct-btn ct-desktop-control" title="Chương trước">${ICONS.prev}</button>
      <button data-ct-toggle type="button" class="ct-btn ct-desktop-control" title="Tạm dừng / Tiếp tục">${ICONS.pause}</button>
      <button data-ct-next type="button" class="ct-btn ct-desktop-control" title="Chương tiếp">${ICONS.next}</button>
      <button data-ct-seek-fwd type="button" class="ct-btn ct-seek-btn ct-desktop-control" title="Tiến 10 giây">${ICONS.seekFwd10}</button>
      <button data-ct-speed-main type="button" class="ct-btn ct-desktop-control" title="Tốc độ phát"><span data-ct-value>1x</span></button>
      <button data-ct-speed-main type="button" class="ct-btn" title="Tốc độ phát"><span data-ct-value>1x</span></button>
      <button data-ct-prev type="button" class="ct-btn" title="Chương trước">${ICONS.prev}</button>
      <button data-ct-toggle type="button" class="ct-btn" title="Tạm dừng / Tiếp tục">${ICONS.pause}</button>
      <button data-ct-next type="button" class="ct-btn" title="Chương tiếp">${ICONS.next}</button>
      <button data-ct-pip type="button" class="ct-btn" title="Picture-in-Picture">${ICONS.pip}</button>
      <button data-ct-timer-main type="button" class="ct-btn" title="Hẹn giờ tắt"><span data-ct-value>Hẹn giờ</span></button>
    </div>
    <div data-ct-progress>
      <input data-ct-seek type="range" min="0" max="100" value="0" step="0.1" disabled />
      <div class="ct-times">
        <span data-ct-time-cur>0:00</span>
        <span data-ct-time-remain>-0:00</span>
      </div>
    </div>
  </div>

  <div class="ct-right">
    <button data-ct-timer-main type="button" class="ct-btn" title="Hẹn giờ tắt">${ICONS.timer}<span data-ct-value style="display:none">Hẹn giờ</span></button>
    <button data-ct-expand type="button" class="ct-btn" title="Mở rộng">${ICONS.expand}</button>
    <button data-ct-list-toggle type="button">
      <span style="opacity:0.9">☰</span> Danh sách chương
    </button>
  </div>
</div>

<!-- Mobile < 900px: chế độ "Thu gọn" — thanh mini nổi bám đáy -->
<div class="ct-mini" data-ct-mini>
  <div class="ct-mini-fillwrap"><div class="ct-mini-fill" data-ct-mini-fill></div></div>
  <div class="ct-mini-cover" data-ct-cover-wrap>
    <img data-ct-cover src="" alt="" />
    <div data-ct-cover-fallback>🎧</div>
  </div>
  <div class="ct-mini-meta">
    <div data-ct-title class="ct-mini-title"></div>
    <div data-ct-chapter class="ct-mini-chapter"></div>
  </div>
  <button data-ct-toggle type="button" class="ct-mini-btn ct-mini-play" title="Tạm dừng / Tiếp tục">${ICONS.pause}</button>
  <button data-ct-next type="button" class="ct-mini-btn" title="Chương tiếp">${ICONS.next}</button>
  <button data-ct-close type="button" class="ct-mini-btn ct-mini-close" title="Dừng nghe liên tục">×</button>
</div>

<!-- Mobile < 900px: chế độ "Full" — toàn màn hình, tham khảo giao diện Mydio -->
<div class="ct-full">
  <div class="ct-full-header">
    <button data-ct-collapse type="button" class="ct-icon-btn ct-mobile-only" title="Thu gọn">${ICONS.chevronDown}</button>
    <button data-ct-close type="button" class="ct-icon-btn" title="Dừng nghe liên tục">×</button>
  </div>

  <div class="ct-full-cover-wrap">
    <div data-ct-cover-wrap>
      <img data-ct-cover src="" alt="" />
      <div data-ct-cover-fallback>🎧</div>
    </div>
  </div>

  <div class="ct-full-meta">
    <div data-ct-title></div>
    <div data-ct-chapter></div>
  </div>

  <div data-ct-progress class="ct-full-progress">
    <input data-ct-seek type="range" min="0" max="100" value="0" step="0.1" disabled />
    <div class="ct-times">
      <span data-ct-time-cur>0:00</span>
      <span data-ct-time-dur>0:00</span>
    </div>
  </div>

  <div class="ct-full-transport">
    <button data-ct-prev type="button" class="ct-full-btn" title="Chương trước">${ICONS.prev}</button>
    <button data-ct-seek-back type="button" class="ct-full-btn ct-seek-btn" title="Lùi 10 giây">${ICONS.seekBack10}</button>
    <button data-ct-toggle type="button" class="ct-full-btn ct-full-play" title="Tạm dừng / Tiếp tục">${ICONS.pause}</button>
    <button data-ct-seek-fwd type="button" class="ct-full-btn ct-seek-btn" title="Tiến 10 giây">${ICONS.seekFwd10}</button>
    <button data-ct-next type="button" class="ct-full-btn" title="Chương tiếp">${ICONS.next}</button>
  </div>

  <div class="ct-full-icons">
    <button data-ct-pip type="button" class="ct-full-icon-btn" title="PIP để thu nhỏ trình phát">
      <span class="ic">${ICONS.pip}</span><span class="lb">PIP</span>
    </button>
    <button data-ct-timer-main type="button" class="ct-full-icon-btn" title="Hẹn giờ tắt">
      <span class="ic">${ICONS.timer}</span><span class="lb" data-ct-value>Hẹn giờ tắt</span>
    </button>
    <button data-ct-list-toggle type="button" class="ct-full-icon-btn" title="Danh sách chương">
      <span class="ic">${ICONS.list}</span><span class="lb">Danh sách</span>
    </button>
    <button data-ct-speed-main type="button" class="ct-full-icon-btn" title="Tốc độ phát">
      <span class="ic" data-ct-value>1x</span><span class="lb">Tốc độ</span>
    </button>
  </div>

  <div data-ct-status class="ct-full-status"></div>
  <div data-ct-wakelock class="ct-full-wakelock"></div>
</div>
`;

    try {
      const ctas = findListenCtas();
      if (ctas) hideListenCtas(ctas);
    } catch {}
    stripListenCtasFromContinuousUI(ui);

    // Cover
    try {
      const playlist = getNextDataPlaylist();
      const coverUrl = getCoverUrl(playlist);
      if (coverUrl) {
        ui.querySelectorAll('[data-ct-cover]').forEach((img) => {
          const fallback = img.parentElement?.querySelector('[data-ct-cover-fallback]');
          img.referrerPolicy = 'no-referrer';
          img.src = coverUrl;
          img.onload = () => {
            img.style.display = 'block';
            if (fallback) fallback.style.display = 'none';
          };
          img.onerror = () => {
            img.style.display = 'none';
            if (fallback) fallback.style.display = 'flex';
          };
        });
      }
    } catch {}

    ui.querySelectorAll('[data-ct-close]').forEach((btn) => {
      btn.addEventListener('click', () => stopContinuousPlayback(false));
    });
    ui.querySelectorAll('[data-ct-prev]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (continuousIndex > 0) playContinuousChapter(continuousIndex - 1);
      });
    });
    ui.querySelectorAll('[data-ct-next]').forEach((btn) => {
      btn.addEventListener('click', () => playNextContinuousChapter());
    });
    ui.querySelectorAll('[data-ct-seek-back]').forEach((btn) => {
      btn.addEventListener('click', () => seekRelative(-10));
    });
    ui.querySelectorAll('[data-ct-seek-fwd]').forEach((btn) => {
      btn.addEventListener('click', () => seekRelative(10));
    });
    ui.querySelectorAll('[data-ct-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const audio = getActiveMedia();
        if (!audio) return;
        if (audio.paused) {
          audio.play().catch(() => {});
          setContinuousToggleIcon(true);
        } else {
          audio.pause();
          setContinuousToggleIcon(false);
        }
      });
    });
    ui.querySelectorAll('[data-ct-pip]').forEach((btn) => {
      btn.addEventListener('click', () => togglePictureInPicture());
    });
    updatePipButtonState();

    // Full ⇄ Thu gọn (giống chuyển đổi màn hình phát nhạc app di động):
    // chạm ⌄ để thu gọn xuống thanh mini, chạm vào thanh mini để mở lại full.
    function setContinuousMode(mode) {
      ui.dataset.ctMode = mode;
      try { localStorage.setItem('voizToolkit.continuousMode', mode); } catch {}
    }
    ui.querySelectorAll('[data-ct-collapse]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setContinuousMode('collapsed');
      });
    });
    ui.querySelector('[data-ct-mini]')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-ct-close], [data-ct-toggle], [data-ct-prev], [data-ct-next], [data-ct-pip]')) return;
      setContinuousMode('full');
    });
    let initialMode = 'full';
    try {
      const saved = localStorage.getItem('voizToolkit.continuousMode');
      if (saved === 'collapsed' || saved === 'full') initialMode = saved;
    } catch {}
    setContinuousMode(initialMode);

    function setDesktopView(view) {
      const next = view === 'expanded' ? 'expanded' : 'bar';
      ui.dataset.ctDesktopView = next;
      ui.querySelectorAll('[data-ct-expand]').forEach((btn) => {
        btn.innerHTML = next === 'expanded' ? ICONS.collapseDesktop : ICONS.expand;
        btn.title = next === 'expanded' ? 'Thu nhỏ' : 'Mở rộng';
        btn.classList.toggle('ct-active', next === 'expanded');
      });
      try { localStorage.setItem('voizToolkit.desktopView', next); } catch {}
      if (next === 'expanded' && continuousChapters) renderChapterList(ui);
    }
    let initialDesktopView = 'bar';
    try {
      const savedDesktopView = localStorage.getItem('voizToolkit.desktopView');
      if (savedDesktopView === 'expanded' || savedDesktopView === 'bar') initialDesktopView = savedDesktopView;
    } catch {}
    setDesktopView(initialDesktopView);
    ui.querySelectorAll('[data-ct-expand]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setDesktopView(ui.dataset.ctDesktopView === 'expanded' ? 'bar' : 'expanded');
      });
    });

    // Seekable progress bar — có thể có 2 bản sao (desktop bar + full mobile)
    const seekEls = ui.querySelectorAll('[data-ct-seek]');
    seekEls.forEach((seekEl) => {
      const onSeekStart = () => { continuousSeeking = true; };
      const onSeekMove = () => {
        const t = Number(seekEl.value) || 0;
        ui.querySelectorAll('[data-ct-time-cur]').forEach((el) => { el.textContent = secondsToDuration(t); });
        ui.querySelectorAll('[data-ct-time-remain]').forEach((el) => {
          el.textContent = `-${secondsToDuration(Math.max(0, continuousDuration - t))}`;
        });
        seekEls.forEach((other) => { if (other !== seekEl) other.value = seekEl.value; });
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
    });

    // Đồng bộ nhãn nút "Danh sách chương" trên mọi bản sao (desktop dùng chữ
    // đổi "Danh sách chương" ⇄ "Ẩn danh sách"; full mobile dùng icon tĩnh +
    // trạng thái tô sáng qua class ct-active).
    function syncListToggleState(open) {
      ui.querySelectorAll('[data-ct-list-toggle]').forEach((btn) => {
        if (btn.querySelector('.lb')) {
          btn.classList.toggle('ct-active', open);
        } else {
          btn.innerHTML = open
            ? '<span style="opacity:0.9">☰</span> Ẩn danh sách'
            : '<span style="opacity:0.9">☰</span> Danh sách chương';
        }
      });
    }

    // Bottom-sheet nền tối (chỉ có hiệu lực trên mobile qua CSS) — bật/tắt khi
    // có panel nào đang mở, để tạo hiệu ứng "sheet" trượt lên từ đáy màn hình.
    function updateSheetBackdrop() {
      const anyOpen = ['[data-ct-speed-panel]', '[data-ct-sleep-panel]', '[data-ct-list-panel]']
        .some((sel) => {
          const el = ui.querySelector(sel);
          return el && el.style.display && el.style.display !== 'none';
        });
      ui.dataset.ctSheet = anyOpen ? '1' : '0';
    }

    function hideExtraPanels(except) {
      const speedPanel = ui.querySelector('[data-ct-speed-panel]');
      const sleepPanel = ui.querySelector('[data-ct-sleep-panel]');
      const listPanel = ui.querySelector('[data-ct-list-panel]');
      ui.querySelectorAll('[data-ct-speed-main]').forEach((btn) => btn.classList.toggle('ct-active', except === 'speed'));
      ui.querySelectorAll('[data-ct-timer-main]').forEach((btn) => { if (except !== 'sleep') btn.classList.remove('ct-active-open'); else btn.classList.add('ct-active-open'); });
      if (except !== 'speed' && speedPanel) speedPanel.style.display = 'none';
      if (except !== 'sleep' && sleepPanel) sleepPanel.style.display = 'none';
      if (except !== 'list' && listPanel) {
        listPanel.style.display = 'none';
        syncListToggleState(false);
      }
      updateSheetBackdrop();
    }

    // Chạm ra ngoài tấm sheet (vùng nền tối) để đóng lại, giống bottom-sheet
    // tiêu chuẩn của các app di động.
    ui.querySelector('.ct-panels')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hideExtraPanels(null);
    });

    // Speed panel
    const speedPanel = ui.querySelector('[data-ct-speed-panel]');
    if (speedPanel && !speedPanel.dataset.ctBuilt) {
      speedPanel.dataset.ctBuilt = '1';
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
          hideExtraPanels(null);
        });
        speedPanel.appendChild(btn);
      });
      applyPlaybackRate(continuousPlaybackRate);
    }
    ui.querySelectorAll('[data-ct-speed-main]').forEach((mainBtn) => {
      mainBtn.addEventListener('click', () => {
        if (!speedPanel) return;
        const open = speedPanel.style.display === 'none' || !speedPanel.style.display;
        hideExtraPanels(open ? 'speed' : null);
        speedPanel.style.display = open ? 'flex' : 'none';
        updateSheetBackdrop();
      });
    });

    // Sleep timer panel
    const sleepHost = ui.querySelector('[data-ct-sleep-presets]');
    const sleepPanel = ui.querySelector('[data-ct-sleep-panel]');
    if (sleepHost && !sleepHost.dataset.ctBuilt) {
      sleepHost.dataset.ctBuilt = '1';
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
        });
        sleepHost.appendChild(btn);
      });
      updateSleepUI();
    }
    ui.querySelectorAll('[data-ct-timer-main]').forEach((mainBtn) => {
      mainBtn.addEventListener('click', () => {
        if (!sleepPanel) return;
        const open = sleepPanel.style.display === 'none' || !sleepPanel.style.display;
        hideExtraPanels(open ? 'sleep' : null);
        sleepPanel.style.display = open ? 'flex' : 'none';
        updateSheetBackdrop();
      });
    });
    // Nút "XONG" trên sheet hẹn giờ (chỉ hiển thị trên mobile qua CSS)
    ui.querySelector('[data-ct-sheet-done]')?.addEventListener('click', () => hideExtraPanels(null));

    // Danh sách chương — mở/đóng, đếm số chương, nút đóng riêng trên sheet mobile
    ui.querySelectorAll('[data-ct-list-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = ui.querySelector('[data-ct-list-panel]');
        if (!panel) return;
        const open = panel.style.display === 'none' || !panel.style.display;
        hideExtraPanels(open ? 'list' : null);
        if (open) {
          panel.style.display = 'flex';
          syncListToggleState(true);
          renderChapterList(ui);
        } else {
          panel.style.display = 'none';
          syncListToggleState(false);
        }
        updateSheetBackdrop();
      });
    });
    ui.querySelector('[data-ct-list-close]')?.addEventListener('click', () => hideExtraPanels(null));

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
      try { media.muted = false; } catch {}

      // Media Session sớm → Chrome có thể auto-PiP khi chuyển tab
      bindPipMediaSession();
      updateMediaSessionMetadata();
      updateMediaSessionPosition();

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
        if (continuousPlaying) updateMediaSessionPosition();
      });

      // Giữ màn hình sáng theo trạng thái phát/tạm dừng của player trang (chỉ khi
      // toolkit đang gắn vào nó). Gắn một lần cho mỗi phần tử media để tránh lặp.
      if (!media.dataset.voizWakeLockBound) {
        media.dataset.voizWakeLockBound = '1';
        media.addEventListener('play', () => {
          if (continuousSiteAttached) requestWakeLock();
          setContinuousToggleIcon(true);
        });
        media.addEventListener('pause', () => {
          if (continuousSiteAttached) releaseWakeLock();
          setContinuousToggleIcon(false);
        });
      }
      requestWakeLock();
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
      releaseWakeLock();
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
      const candidates = await getStreamingUrlCandidates(item.id);
      if (continuousAbort) return;

      let lastPlayError = null;
      let played = false;

      for (let i = 0; i < candidates.length; i++) {
        const { source, playlistUrl } = candidates[i];
        if (continuousAbort) return;
        const srcLabel = source === 'android_files' ? 'Android' : source;
        updateContinuousUI({
          status: candidates.length > 1
            ? `Thử stream ${i + 1}/${candidates.length} (${srcLabel})…`
            : `Đang lấy stream (${srcLabel})…`,
        });

        try {
          // 1) Try attach to site player with m3u8
          const attached = await tryAttachToSitePlayer(playlistUrl);
          if (attached) {
            continuousLoading = false;
            updateContinuousUI({
              status: `Đang phát trên trình phát trang (HLS · ${srcLabel})`,
            });
            played = true;
            break;
          }

          // 2) Fallback: download full chapter AAC → play as blob
          updateContinuousUI({
            status: `Đang tải stream (${srcLabel}${source === 'android_files' ? ' · giống app' : ''})…`,
          });
          let data = await downloadHls(playlistUrl, (current, total) => {
            if (continuousAbort) throw new Error('Cancelled');
            updateContinuousUI({
              status: `Tải segment ${current}/${total} (${srcLabel})…`,
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
          updateContinuousUI({
            status: source === 'android_files'
              ? 'Đang phát (player riêng · luồng Android)'
              : 'Đang phát (player riêng)',
          });
          await audio.play();
          requestWakeLock();
          played = true;
          break;
        } catch (tryErr) {
          if (String(tryErr.message || '').includes('Cancelled')) throw tryErr;
          lastPlayError = tryErr;
          console.warn(`[Voiz Continuous] Stream ${srcLabel} failed, thử nguồn tiếp theo:`, tryErr?.message || tryErr);
          continuousSiteAttached = false;
          // continue to next candidate (e.g. android_files)
        }
      }

      if (!played) {
        throw lastPlayError || new Error('Không phát được stream (web + android)');
      }

      setContinuousToggleIcon(true);
      // Media Session phải gắn sớm để Chrome auto-PiP khi chuyển tab (enterpictureinpicture)
      bindPipMediaSession();
      updateMediaSessionMetadata();
      updateMediaSessionPosition();
      if (pipActive) {
        const playlist = getNextDataPlaylist();
        const t = cleanText(playlist?.name || document.title) || 'Voiz';
        if (pipMode === 'document') updateDocPipUI();
        else drawPipCover(getCoverUrl(playlist), t, title, true).catch(() => {});
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
      releaseWakeLock();
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
      releaseWakeLock();
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
            const candidates = await getStreamingUrlCandidates(item.id);
            let data = null;
            let lastDlErr = null;
            for (const cand of candidates) {
              if (cancelRequested) throw new Error('Cancelled');
              try {
                updateProgress({
                  taskKey: label,
                  taskTitle,
                  current: 0,
                  total: 1,
                  status: `Stream ${cand.source}`,
                  forceStats: true,
                });
                data = await downloadHls(cand.playlistUrl, (current, total) => {
                  updateProgress({
                    taskKey: label,
                    taskTitle,
                    current,
                    total,
                    status: `Segments ${current}/${total} (${cand.source})`,
                    forceStats: true,
                  });
                });
                lastDlErr = null;
                break;
              } catch (dlErr) {
                if (String(dlErr.message || '').includes('Cancelled')) throw dlErr;
                lastDlErr = dlErr;
                console.warn(`[Voiz DL] ${label} ${cand.source} failed:`, dlErr?.message || dlErr);
              }
            }
            if (!data) throw lastDlErr || new Error('No stream (web + android)');
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
