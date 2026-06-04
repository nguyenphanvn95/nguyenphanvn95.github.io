/**
 * content.js
 * Runs in ISOLATED world (document_idle).
 * - Listens to '__waka_stream__' from interceptor.js for audio stream.
 * - Listens to '__waka_audio_chapters__' to cache chapter list.
 * - Injects a download button near the audio play control.
 * - Allows exporting the cached chapter list as JSON.
 *
 * Dependencies: hls-parser.js, downloader.js, mp3-encoder.js, lib/lame.min.js
 */
(function () {
  'use strict';

  const CHAPTER_LIST_STORAGE_KEY = 'waka.audio.chapterList';

  let detectedPlaylistUrl = null;
  let chapterListPayload = loadStoredChapterList();
  let hasFullChapterList = !!(chapterListPayload && chapterListPayload.source === 'getListAudioFile');
  let isDownloading = false;
  let mutationTimer = null;

  function isRelevantPage() {
    return /\/sach-noi\//i.test(window.location.pathname) || /\/podcast\//i.test(window.location.pathname);
  }

  window.addEventListener('__waka_stream__', (e) => {
    const url = e.detail && e.detail.playlistUrl;
    if (!url) return;

    detectedPlaylistUrl = url;
    console.log('[Waka DL] Detected stream:', url);

    const btn = document.getElementById('waka-dl-btn');
    if (btn) activateAudioButton(btn);
  });

  window.addEventListener('__waka_audio_chapters__', (e) => {
    const payload = e.detail;
    if (!payload || !Array.isArray(payload.items)) return;

    chapterListPayload = payload;
    persistChapterList(payload);
    updateChapterButtonState();
    console.log('[Waka DL] Cached chapter list:', payload.items.length, 'items');
  });

  window.addEventListener('__waka_audio_list_ready__', (e) => {
    const payload = e.detail;
    if (!payload || !Array.isArray(payload.items)) return;

    hasFullChapterList = true;
    chapterListPayload = payload;
    persistChapterList(payload);
    updateChapterButtonState();
    ensureChapterButtonVisible();
    console.log('[Waka DL] Full chapter list detected:', payload.items.length, 'items');
  });

  function loadStoredChapterList() {
    try {
      const raw = window.localStorage.getItem(CHAPTER_LIST_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function persistChapterList(payload) {
    try {
      window.localStorage.setItem(CHAPTER_LIST_STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }

  function createAudioButton() {
    const btn = document.createElement('button');
    btn.id = 'waka-dl-btn';
    btn.setAttribute('aria-label', 'Tai audio');
    applyAudioButtonStyle(btn, false);
    btn.addEventListener('click', handleDownloadClick);
    return btn;
  }

  function createChapterButton() {
    return null;
  }

  function applyAudioButtonStyle(btn, active) {
    btn.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'padding:8px 18px',
      `background:${active ? '#e94560' : '#555'}`,
      'color:#fff',
      'border:none',
      'border-radius:24px',
      'font-size:13px',
      'font-weight:600',
      `cursor:${active ? 'pointer' : 'default'}`,
      'margin:6px 0 6px 10px',
      'transition:background 0.25s, opacity 0.2s',
      `opacity:${active ? '1' : '0.6'}`,
      'flex-shrink:0',
    ].join(';');
    btn.title = active
      ? 'Tai audio nay ve may (MP3)'
      : 'Nhan Nghe sach truoc de phat hien audio';
    btn.innerHTML = 'Download MP3';
  }

  function applyChapterButtonStyle(btn, active) {
    btn.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'padding:8px 18px',
      `background:${active ? '#2563eb' : '#556'}`,
      'color:#fff',
      'border:none',
      'border-radius:24px',
      'font-size:13px',
      'font-weight:600',
      `cursor:${active ? 'pointer' : 'default'}`,
      'margin:6px 0 6px 10px',
      'transition:background 0.25s, opacity 0.2s',
      `opacity:${active ? '1' : '0.6'}`,
      'flex-shrink:0',
    ].join(';');
    btn.title = active
      ? 'Tai chapters.json cua cuon sach nay'
      : 'Dang cho getListAudioFile';
    btn.innerHTML = 'Tai chapters.json';
  }

  function activateAudioButton(btn) {
    applyAudioButtonStyle(btn, true);
    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '0.82';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '1';
    });
  }

  function activateChapterButton(btn) {
    applyChapterButtonStyle(btn, true);
    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '0.82';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '1';
    });
  }

  function injectButtons() {
    let anchor = null;
    const candidates = document.querySelectorAll(
      'button, a, [role="button"], [aria-label], [class*="play" i], [class*="nghe" i]'
    );
    for (const el of candidates) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      const cls = (el.className || '').toString();
      const hasPlayIcon = !!el.querySelector(
        'img[alt*="play" i], img[src*="icon-play" i], img[src*="play-o" i]'
      );

      if (
        text.includes('Nghe sach') ||
        text.includes('Nghe audio') ||
        text === 'Nghe' ||
        /nghe/i.test(text) ||
        /nghe/i.test(aria) ||
        /play/i.test(aria) ||
        /play/i.test(cls) ||
        hasPlayIcon
      ) {
        anchor = el;
        break;
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
  }

  function shouldShowChapterButton() {
    return (
      hasFullChapterList ||
      (chapterListPayload && Array.isArray(chapterListPayload.items) && chapterListPayload.items.length > 0)
    );
  }

  function ensureChapterButtonVisible() {
    return;
  }

  function updateChapterButtonState() {
    return;
  }

  function handleChapterExportClick() {
    if (!shouldShowChapterButton()) {
      alert('Chua phat hien getListAudioFile cua cuon sach nay.');
      return;
    }

    const bookTitle = getBookTitle();
    const safe = safeFileName(bookTitle || 'waka-chapter-list');
    const payload = {
      title: bookTitle,
      exportedAt: new Date().toISOString(),
      count: chapterListPayload.items.length,
      source: chapterListPayload.source || 'unknown',
      content_id: chapterListPayload.content_id || null,
      items: chapterListPayload.items,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    triggerDownload(blob, `${safe}_chapters.json`);
  }

  function getBookTitle() {
    const title = document.querySelector('h1')?.textContent?.trim();
    return title || document.title || 'waka-audio';
  }

  function safeFileName(name) {
    return String(name || 'waka-audio')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }

  function ensureProgressUI() {
    let ui = document.getElementById('waka-dl-overlay');
    if (ui) return ui;

    ui = document.createElement('div');
    ui.id = 'waka-dl-overlay';
    ui.style.cssText = [
      'position:fixed',
      'bottom:20px',
      'right:20px',
      'width:310px',
      'background:#15151e',
      'color:#e8e8e8',
      'border-radius:14px',
      'padding:18px 20px',
      'box-shadow:0 6px 28px rgba(0,0,0,0.5)',
      'font-family:system-ui,sans-serif',
      'font-size:13px',
      'z-index:2147483647',
      'display:none',
    ].join(';');
    ui.innerHTML = `
      <div style="font-weight:700;font-size:14px;color:#e94560;margin-bottom:10px">
        Waka Audio Downloader
      </div>
      <div id="waka-dl-status-text" style="margin-bottom:10px;line-height:1.5">
        Dang khoi dong...
      </div>
      <div style="background:#2a2a3a;border-radius:6px;height:7px;overflow:hidden">
        <div id="waka-dl-bar" style="width:0%;height:100%;background:#e94560;transition:width 0.4s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;color:#888;font-size:11px">
        <span id="waka-dl-pct">0%</span>
        <span id="waka-dl-eta"></span>
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

  function updateOverlayStatus(msg) {
    const statusEl = document.getElementById('waka-dl-status-text');
    if (statusEl) statusEl.textContent = msg;
  }

  function hideOverlayAfter(ms) {
    setTimeout(() => {
      const ui = document.getElementById('waka-dl-overlay');
      if (ui) ui.style.display = 'none';
    }, ms);
  }

  async function handleDownloadClick() {
    if (isDownloading) return;

    if (!detectedPlaylistUrl) {
      alert('Hay nhan nut "Nghe sach" tren trang truoc de phat hien audio stream roi thu lai!');
      return;
    }

    isDownloading = true;
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const btn = document.getElementById('waka-dl-btn');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'default';
      btn.innerHTML = 'Dang tai...';
    }

    showOverlay('Khoi tao...');

    HLSDownloader.setCallbacks(
      (current, total, msg) => updateOverlayProgress(current, total, msg),
      (msg) => updateOverlayStatus(msg)
    );

    MP3Encoder.setCallbacks(
      (msg) => updateOverlayStatus(msg),
      (pct, msg) => {
        updateOverlayProgress(pct, 100, msg);
      }
    );

    try {
      const aacData = await HLSDownloader.downloadAll(detectedPlaylistUrl);

      updateOverlayStatus('Dang encode sang MP3...');
      const { blob, ext } = await MP3Encoder.encode(aacData, audioCtx);

      const pageTitle = getBookTitle();
      const safeName = safeFileName(pageTitle);
      const filename = `${safeName}.${ext}`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

      updateOverlayStatus(`Da luu: ${filename}`);
      updateOverlayProgress(100, 100, `Hoan tat! File: ${filename}`);
      hideOverlayAfter(5000);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Da tai';
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.style.background = '#28a745';
      }
    } catch (err) {
      console.error('[Waka DL] Error:', err);
      updateOverlayStatus('Loi: ' + err.message);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Thu lai';
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
      }
    } finally {
      isDownloading = false;
      audioCtx.close();
    }
  }

  function handleMutation() {
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      injectButtons();
    }, 250);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement('a'), {
      href: url,
      download: filename,
      style: 'display:none',
    });
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  const observer = new MutationObserver(handleMutation);

  function init() {
    if (!isRelevantPage()) return;
    injectButtons();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


// ============================================================
// PATCH v3.6 – Thêm vào cuối content.js (trước dòng cuối cùng)
// Nút "Tải tất cả" + auto-download queue trong extension
// ============================================================

// ─── Nút "Tải tất cả chương" ────────────────────────────────

function createDownloadAllButton() {
  const btn = document.createElement('button');
  btn.id = 'waka-dl-all-btn';
  btn.setAttribute('aria-label', 'Tai tat ca chuong');
  applyDownloadAllButtonStyle(btn, false);
  btn.addEventListener('click', handleDownloadAllClick);
  return btn;
}

function applyDownloadAllButtonStyle(btn, active) {
  btn.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:6px',
    'padding:8px 18px',
    `background:${active ? '#7c3aed' : '#556'}`,
    'color:#fff',
    'border:none',
    'border-radius:24px',
    'font-size:13px',
    'font-weight:600',
    `cursor:${active ? 'pointer' : 'default'}`,
    'margin:6px 0 6px 10px',
    'transition:background 0.25s, opacity 0.2s',
    `opacity:${active ? '1' : '0.6'}`,
    'flex-shrink:0',
  ].join(';');
  btn.title = active
    ? 'Auto download all chapters (AAC)'
    : 'Can co chapters.json truoc';
  btn.innerHTML = 'Get all chapters';
}

function ensureDownloadAllButton() {
  if (!shouldShowChapterButton()) return;
  const existing = document.getElementById('waka-dl-all-btn');
  if (existing) {
    applyDownloadAllButtonStyle(existing, true);
    return;
  }

  const anchor = document.getElementById('waka-chapters-btn')
    || document.getElementById('waka-dl-btn');
  if (!anchor) return;

  const btn = createDownloadAllButton();
  applyDownloadAllButtonStyle(btn, true);
  anchor.parentNode.insertBefore(btn, anchor.nextSibling);
}

// ─── Download-all overlay ──────────────────────────────────────

function ensureAllChaptersProgressUI() {
  let ui = document.getElementById('waka-dl-all-overlay');
  if (ui) return ui;

  ui = document.createElement('div');
  ui.id = 'waka-dl-all-overlay';
  ui.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'left:20px',
    'width:360px',
    'background:#0f0f1a',
    'color:#e8e8e8',
    'border-radius:14px',
    'padding:18px 20px',
    'box-shadow:0 6px 28px rgba(0,0,0,0.6)',
    'font-family:system-ui,sans-serif',
    'font-size:13px',
    'z-index:2147483647',
    'display:none',
  ].join(';');
  ui.innerHTML = `
    <div style="font-weight:700;font-size:14px;color:#7c3aed;margin-bottom:10px">
      Waka – Tải tất cả chương
    </div>
    <div id="waka-all-chapter-name" style="margin-bottom:4px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
      Đang chuẩn bị...
    </div>
    <div id="waka-all-status" style="color:#aaa;font-size:11px;margin-bottom:8px">
      Chương 0 / 0
    </div>
    <div style="background:#2a2a3a;border-radius:6px;height:7px;overflow:hidden;margin-bottom:4px">
      <div id="waka-all-bar" style="width:0%;height:100%;background:#7c3aed;transition:width 0.3s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;color:#888;font-size:11px;margin-bottom:10px">
      <span id="waka-all-pct">0%</span>
      <span id="waka-all-count">0 / 0</span>
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

  document.getElementById('waka-all-stop-btn').addEventListener('click', () => {
    window.__waka_dl_all_stop__ = true;
  });

  return ui;
}

function showAllOverlay() {
  const ui = ensureAllChaptersProgressUI();
  window.__waka_dl_all_stop__ = false;
  ui.style.display = 'block';
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

function hideAllOverlayAfter(ms) {
  setTimeout(() => {
    const ui = document.getElementById('waka-dl-all-overlay');
    if (ui) ui.style.display = 'none';
  }, ms);
}

// ─── Core: fetch playlist URL qua interceptor (MAIN world proxy) ───────────────
//
// Problem: content script (isolated world) fetch beta-api.waka.vn với
//   credentials:'include' → CORS block (ACAO:* + credentials = invalid).
// Solution: uỷ thác sang interceptor.js (MAIN world) qua CustomEvent.
//   interceptor dùng nativeFetch với đủ headers → cookie gắn tự động → OK.

let _dlAllReqId = 0;
const _dlAllPending = new Map();

// Nhận kết quả từ interceptor
window.addEventListener('__waka_playlist_result__', function (e) {
  const { reqId, playlistUrl, error } = e.detail || {};
  const p = _dlAllPending.get(reqId);
  if (!p) return;
  clearTimeout(p.timer);
  _dlAllPending.delete(reqId);
  if (error && !playlistUrl) {
    p.reject(new Error(error));
  } else {
    p.resolve(playlistUrl || null);
  }
});

function askInterceptorForPlaylist(contentId, chapterId, action) {
  return new Promise(function (resolve, reject) {
    const reqId = 'dlall_' + (++_dlAllReqId) + '_' + Date.now();
    const timer = setTimeout(function () {
      _dlAllPending.delete(reqId);
      reject(new Error('Timeout 12s – chapter ' + chapterId + ' action=' + action));
    }, 12000);
    _dlAllPending.set(reqId, { resolve: resolve, reject: reject, timer: timer });
    window.dispatchEvent(new CustomEvent('__waka_fetch_playlist__', {
      detail: {
        reqId: reqId,
        contentId: String(contentId),
        chapterId: String(chapterId),
        action: action,
      },
    }));
  });
}

async function fetchPlaylistUrl(contentId, chapterId) {
  // Kiểm tra cache từ traffic trang (user đã click Nghe chương này)
  const cache = window.__waka_playlist_cache__ || {};
  if (cache[String(chapterId)]) {
    console.log('[Waka DL All] Cache hit chapter', chapterId);
    return cache[String(chapterId)];
  }

  // Nhờ interceptor fetch (MAIN world, cookie OK)
  try {
    const url = await askInterceptorForPlaylist(contentId, chapterId, 'current');
    if (url) {
      console.log('[Waka DL All] Got playlist:', url);
      return url;
    }
  } catch (err) {
    console.warn('[Waka DL All] playlist fetch failed:', err.message);
  }
  return null;
}

// ─── HLS downloader (browser) ─────────────────────────────────

async function browserDownloadHLS(playlistUrl, onSegmentProgress) {
  // CDN vegacdn.vn là cross-site → credentials:'omit' bắt buộc
  // (credentials:'include' với ACAO:* bị browser block)
  // cache:'no-store' vì URL CDN chứa token thời gian, không cache được
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

  // Master
  const masterTxt = await fetchTxt(playlistUrl);
  const lines = masterTxt.split('\n').map(l => l.trim());
  let chunkUrl = playlistUrl;
  let bw = 0;
  for (const l of lines) {
    if (l.startsWith('#EXT-X-STREAM-INF:')) { bw = 1; continue; }
    if (bw && !l.startsWith('#') && l.length) { chunkUrl = resolve(l, playlistUrl); bw = 0; break; }
  }

  // Chunklist
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
    if (!l.startsWith('#') && l.length) {
      segs.push({ url: resolve(l, chunkUrl), key: key ? { ...key } : null, seq });
      seq++;
    }
  }

  const _kc = {};
  async function getKey(uri) {
    if (!_kc[uri]) { _kc[uri] = await fetchBuf(uri); }
    return _kc[uri];
  }
  function toIV(s) {
    const iv = new Uint8Array(16);
    let n = s;
    for (let i = 15; i >= 0; i--) { iv[i] = n & 0xff; n = Math.floor(n / 256); }
    return iv;
  }
  function hexIV(h) { return Uint8Array.from(h.padStart(32,'0').match(/../g).map(x=>parseInt(x,16))); }

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

// ─── Download-all handler ─────────────────────────────────────

let isDownloadingAll = false;

async function handleDownloadAllClick() {
  if (isDownloadingAll) {
    alert('Đang tải! Nhấn nút "Dừng" trong bảng tiến trình để hủy.');
    return;
  }
  if (!shouldShowChapterButton() || !chapterListPayload) {
    alert('Chưa có danh sách chương. Hãy đợi extension load xong chapters.json.');
    return;
  }

  const items = [...(chapterListPayload.items || [])].sort((a, b) => {
    const ao = Number(a.order ?? 0);
    const bo = Number(b.order ?? 0);
    if (ao !== bo) return ao - bo;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
  });

  const contentId = chapterListPayload.content_id;
  if (!contentId) {
    alert('Không tìm thấy content_id trong dữ liệu chương.');
    return;
  }

  isDownloadingAll = true;
  showAllOverlay();
  window.__waka_dl_all_stop__ = false;

  const btn = document.getElementById('waka-dl-all-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.innerHTML = 'Đang tải...'; }

  let success = 0;
  let fail = 0;

  for (let i = 0; i < items.length; i++) {
    if (window.__waka_dl_all_stop__) {
      updateAllOverlay({ chapterName: '⛔ Đã dừng', chapterIdx: i, chapterTotal: items.length });
      break;
    }

    const item = items[i];
    updateAllOverlay({
      chapterName: `[${String(i + 1).padStart(2, '0')}/${items.length}] ${item.name}`,
      chapterIdx: i,
      chapterTotal: items.length,
      segCur: 0, segTotal: 0,
    });

    try {
      const playlistUrl = await fetchPlaylistUrl(contentId, item.id);
      if (!playlistUrl) throw new Error('Không lấy được playlist URL (cần đăng nhập hoặc mở chương trước)');

      const aacData = await browserDownloadHLS(playlistUrl, (cur, total) => {
        updateAllOverlay({
          chapterName: `[${String(i + 1).padStart(2, '0')}/${items.length}] ${item.name}`,
          chapterIdx: i, chapterTotal: items.length,
          segCur: cur, segTotal: total,
        });
      });

      // Lưu file
      const pad3 = String(i + 1).padStart(3, '0');
      const safeName = (item.name || `chapter_${item.id}`).replace(/[<>:"/\\|?*]/g, '').trim().replace(/\s+/g, '_');
      const filename = `${pad3}_${safeName}.aac`;

      const blob = new Blob([aacData], { type: 'audio/aac' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 15_000);

      updateAllOverlay({ logLine: `✅ ${filename}`, chapterIdx: i + 1, chapterTotal: items.length });
      success++;
    } catch (err) {
      updateAllOverlay({ logLine: `❌ [${item.name}] ${err.message}`, chapterIdx: i + 1, chapterTotal: items.length });
      console.error('[Waka DL All] Chapter error:', item.name, err);
      fail++;
    }

    // Delay nhỏ giữa chương để tránh bị block
    if (i < items.length - 1 && !window.__waka_dl_all_stop__) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  updateAllOverlay({
    chapterName: `Xong! ✅ ${success} thành công, ❌ ${fail} lỗi`,
    chapterIdx: items.length, chapterTotal: items.length,
    segCur: 1, segTotal: 1,
  });

  isDownloadingAll = false;
  hideAllOverlayAfter(10000);

  if (btn) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.innerHTML = 'Tải tất cả';
    applyDownloadAllButtonStyle(btn, true);
  }
}

// ─── Hook vào các event đã có ─────────────────────────────────

// Khi chapter list ready → hiện nút Tải tất cả
const _origUpdateChapterButtonState = updateChapterButtonState;
window.addEventListener('__waka_audio_list_ready__', () => {
  ensureDownloadAllButton();
});
window.addEventListener('__waka_audio_chapters__', () => {
  ensureDownloadAllButton();
});

// Cũng thử inject ngay lúc init
const _origInjectButtons = injectButtons;
// Gọi sau khi DOM inject xong
setTimeout(() => {
  if (shouldShowChapterButton()) ensureDownloadAllButton();
}, 500);


})();
