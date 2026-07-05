
// ── UTILS ─────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

function sanitizeFilename(name) {
  return (name || 'sach').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function downloadAs(url, title, format) {
  const safeName = sanitizeFilename(title) + '.' + (format || 'bin').toLowerCase();
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadArrayBuffer(buf, title, format) {
  const blob = new Blob([buf]);
  const url = URL.createObjectURL(blob);
  downloadAs(url, title, format);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function goBack() {
  window.location.href = 'index.html';
}

// ── GOOGLE DRIVE FILE ACCESS (via file_id + Apps Script proxy) ──
// Files are identified in metadata_public.json by their raw Drive `file_id`.
// They're fetched through a small Google Apps Script Web App deployed under
// the library owner's own account, which reads the file server-side via
// DriveApp and returns it directly (JSON as JSON, binary files as raw bytes).
// This sidesteps the 403 / anti-bot throttling that direct
// "uc?export=download" links increasingly get when requested via fetch()
// from a browser. index.html already passes the resulting proxy URL as the
// `url` query param; the raw file_id is also passed as `id` so this page can
// fall back to direct Drive links if the proxy call ever fails.
const GDRIVE_PROXY_URL = 'https://script.google.com/macros/s/AKfycbz7X2ZUA5mfqz555M9eNUEssz-kjL9Gg0C0l3skOH_aCvIuKyqFA6PoRohuxrCC2ReCbQ/exec';

function driveProxyUrl(fileId) {
  return `${GDRIVE_PROXY_URL}?id=${encodeURIComponent(fileId)}`;
}

function resolveDriveFileId(idOrLink) {
  if (!idOrLink) return null;
  if (/^[a-zA-Z0-9_-]{15,}$/.test(idOrLink)) return idOrLink; // already a bare file ID
  let m = idOrLink.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = idOrLink.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

// Ordered list of direct-Drive fallback URLs for a file_id (tried only if the
// Apps Script proxy call fails), including routing the same links through
// public CORS proxies as a last resort.
function driveDownloadCandidates(fileId) {
  if (!fileId) return [];
  const direct = [
    `https://drive.google.com/uc?export=download&id=${fileId}`,
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
  ];
  const proxied = direct.flatMap(u => [
    `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`
  ]);
  return [...direct, ...proxied];
}

async function __fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a Drive file's bytes given its file_id (or a legacy Drive link):
// tries the Apps Script proxy first, then falls back to direct Drive links /
// public CORS proxies if the proxy call fails.
async function driveFetch(idOrLink) {
  const id = resolveDriveFileId(idOrLink);
  if (!id) throw new Error('Không xác định được file ID trên Google Drive');

  let lastErr = null;
  if (GDRIVE_PROXY_URL) {
    try {
      const res = await __fetchWithTimeout(driveProxyUrl(id));
      if (res.ok) return res;
      lastErr = new Error('Proxy HTTP ' + res.status);
    } catch (e) { lastErr = e; }
  }
  for (const url of driveDownloadCandidates(id)) {
    try {
      const res = await __fetchWithTimeout(url);
      if (res.ok) return res;
      lastErr = new Error('HTTP ' + res.status + ' — ' + url);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Không tải được file từ Google Drive');
}

// Fetch the raw bytes of a book file. `url` is normally already the Apps
// Script proxy URL (built by index.html); `fileId`, if given, lets this page
// retry via direct Drive links / driveFetch as a fallback if the initial
// plain fetch to `url` fails for any reason.
async function fetchBookBytes(url, fileId) {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.arrayBuffer();
    throw new Error('HTTP ' + res.status);
  } catch (primaryErr) {
    if (fileId) {
      try {
        const res = await driveFetch(fileId);
        return await res.arrayBuffer();
      } catch (fallbackErr) { /* fall through to original error below */ }
    }
    throw primaryErr;
  }
}

// ── ERROR / FALLBACK UI ─────────────────────────────────────────
function showReaderError(message, fallbackLink) {
  document.getElementById('initialLoading')?.remove();
  document.getElementById('readerBody').innerHTML = `
    <div class="empty">
      <div class="empty-icon">⚠️</div>
      <div>${esc(message)}</div>
      ${fallbackLink ? `<button class="reader-back" onclick="window.open('${escAttr(fallbackLink)}','_blank')">Mở trên Google Drive</button>` : ''}
    </div>`;
}

function showMobiNotice(url, fileId, title) {
  document.getElementById('initialLoading')?.remove();
  document.getElementById('readerBody').innerHTML = `
    <div class="empty">
      <div class="empty-icon">📱</div>
      <div>Trình duyệt chưa hỗ trợ đọc trực tiếp file <strong>MOBI</strong>.<br>Hãy tải về máy để mở bằng ứng dụng đọc sách (Kindle, Calibre…).</div>
      <button class="reader-back" id="mobiDownloadBtn">⬇ Tải file MOBI</button>
    </div>`;

  const doDownload = async (btn) => {
    const label = btn.textContent;
    btn.textContent = 'Đang tải…'; btn.disabled = true;
    try {
      const buf = await fetchBookBytes(url, fileId);
      downloadArrayBuffer(buf, title, 'mobi');
    } catch (err) {
      alert('Không tải được file: ' + (err.message || ''));
    } finally {
      btn.textContent = label; btn.disabled = false;
    }
  };

  const inlineBtn = document.getElementById('mobiDownloadBtn');
  inlineBtn.onclick = () => doDownload(inlineBtn);

  const topBtn = document.getElementById('readerDownloadBtn');
  topBtn.disabled = false;
  topBtn.onclick = () => doDownload(topBtn);
}

// ── INIT ──────────────────────────────────────────────────────
function inferFormat(url, hint) {
  if (hint) return hint.toUpperCase();
  const m = (url || '').match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  return m ? m[1].toUpperCase() : '';
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('url');
  const fileId = params.get('id') || resolveDriveFileId(url) || '';
  const title = params.get('title') || 'Sách';
  const format = inferFormat(url, params.get('format'));
  const driveLink = fileId ? `https://drive.google.com/file/d/${fileId}/view` : null;

  document.title = title + ' — Đọc sách';
  document.getElementById('readerTitle').textContent = title;

  if (!url) {
    showReaderError('Thiếu đường dẫn file sách (thiếu tham số url trong địa chỉ trang).');
    return;
  }

  if (format === 'MOBI') {
    showMobiNotice(url, fileId, title);
    return;
  }

  if (format !== 'EPUB' && format !== 'PDF') {
    // Unknown/unsupported format for in-browser rendering: fetch and force a download instead.
    try {
      const buf = await fetchBookBytes(url, fileId);
      downloadArrayBuffer(buf, title, format || 'bin');
      showReaderError(`Định dạng "${format || '?'}" không hỗ trợ đọc trực tiếp trong trình duyệt — file đã được tải xuống.`, driveLink);
    } catch (err) {
      showReaderError('Không tải được file: ' + (err.message || ''), driveLink);
    }
    return;
  }

  try {
    const buf = await fetchBookBytes(url, fileId);
    const dlBtn = document.getElementById('readerDownloadBtn');
    dlBtn.disabled = false;
    dlBtn.onclick = () => downloadArrayBuffer(buf, title, format);
    if (format === 'EPUB') openEpubReader(buf, title);
    else openPdfReader(buf, title);
  } catch (err) {
    showReaderError(
      'Không tải được file sách: ' + (err.message || '') + ' (có thể do Google Drive giới hạn truy cập trực tiếp).',
      driveLink
    );
  }
}

window.addEventListener('DOMContentLoaded', init);

// ── EPUB READER (epub.js) ──────────────────────────────────────
let currentEpubBook = null;
let currentEpubRendition = null;
let epubFontPct = 100;

function openEpubReader(arrayBuffer, title) {
  document.getElementById('initialLoading')?.remove();
  const body = document.getElementById('readerBody');
  body.innerHTML = `
    <div id="epubViewer"></div>
    <button class="epub-nav-btn prev" onclick="epubNav('prev')">‹</button>
    <button class="epub-nav-btn next" onclick="epubNav('next')">›</button>
    <div class="reader-loading" id="epubLoading">📖 <span>Đang tải sách...</span></div>`;
  document.getElementById('readerTools').innerHTML = `
    <button onclick="epubFontSize(-1)" title="Giảm cỡ chữ">A−</button>
    <button onclick="epubFontSize(1)" title="Tăng cỡ chữ">A+</button>
    <button class="ra-toggle-btn" id="raToggleBtn" onclick="raTogglePanel()" title="Đọc to đoạn văn bằng giọng nói">🔊 Đọc to</button>`;

  raReset(); // reset state Read Aloud cho sách mới

  // Pass the raw ArrayBuffer directly so epub.js parses it via JSZip in-memory,
  // instead of trying to XHR-fetch a URL.
  currentEpubBook = ePub(arrayBuffer);
  currentEpubRendition = currentEpubBook.renderTo('epubViewer', {
    width: '100%', height: '100%', spread: 'auto'
  });

  // Hook chạy mỗi khi epub.js render nội dung 1 section vào iframe — dùng để
  // dò các đoạn văn (<p>) và gắn khả năng bấm-vào-để-đọc + tô sáng khi đang đọc.
  currentEpubRendition.hooks.content.register(raOnContentLoaded);

  currentEpubRendition.display().then(() => {
    const loading = document.getElementById('epubLoading');
    if (loading) loading.remove();
  }).catch(err => {
    document.getElementById('epubViewer').innerHTML =
      `<div class="reader-loading">⚠️ Không đọc được file EPUB: ${esc(err.message || '')}</div>`;
  });
  document.addEventListener('keydown', epubKeyHandler);
}

function epubKeyHandler(e) {
  if (!currentEpubRendition) return;
  if (e.key === 'ArrowLeft') epubNav('prev');
  if (e.key === 'ArrowRight') epubNav('next');
}

// Điều hướng trang/chương EPUB — dừng Read Aloud trước nếu đang phát,
// để tránh đọc lệch nội dung khi người dùng tự lật trang bằng tay.
function epubNav(dir) {
  if (!currentEpubRendition) return;
  if (RA.playing || RA.loading) raStopAll();
  if (dir === 'prev') currentEpubRendition.prev();
  else currentEpubRendition.next();
}

function epubFontSize(delta) {
  if (!currentEpubRendition) return;
  epubFontPct = Math.min(180, Math.max(70, epubFontPct + delta * 10));
  currentEpubRendition.themes.fontSize(epubFontPct + '%');
}

// ── READ ALOUD (TTS qua server localhost:3000, kiểu Piper/Nghi-TTS) ─────
// Server tương thích: cùng API /api/tts và /api/voices như dự án
// "epub-reader-offline" (tts_server.py) — POST text, nhận về base64 PCM16
// mono + sampleRate, phát bằng Web Audio API, tô sáng đoạn <p> đang đọc
// ngay trong iframe của epub.js để tiện theo dõi.
const RA_TTS_SERVER = 'http://localhost:3000';
const RA_HIGHLIGHT_STYLE_ID = 'ra-highlight-style-tag';
const RA_HIGHLIGHT_CSS = `
  .ra-active-p {
    background: linear-gradient(120deg, rgba(192,131,42,.38), rgba(192,131,42,.22)) !important;
    border-radius: 4px !important;
    box-shadow: 0 0 0 3px rgba(192,131,42,.22) !important;
    transition: background .25s ease, box-shadow .25s ease !important;
  }
  .ra-readable-p { cursor: pointer !important; }
  .ra-readable-p:hover { background: rgba(192,131,42,.10) !important; border-radius: 4px !important; }
`;

const RA = {
  open: false,          // panel đang mở?
  playing: false,       // đang phát audio?
  loading: false,       // đang chờ TTS trả dữ liệu?
  voices: {},            // danh sách giọng lấy từ /api/voices
  voicesLoaded: false,
  voice: localStorage.getItem('ra_voice') || '', // "piper:xxx" hoặc "nghitts:xxx"
  speed: parseFloat(localStorage.getItem('ra_speed') || '1'),
  paragraphs: [],        // đoạn văn của section đang hiển thị: {el, text, contents}
  currentIndex: -1,
  activeEl: null,        // <p> đang được tô sáng
  audioCtx: null,
  activeSource: null,
  currentBuffer: null,
  elapsedOffset: 0,
  startTimestamp: 0,
  cache: new Map(),      // idx -> {audio, sampleRate}
  pending: new Map(),    // idx -> Promise
  autoAdvance: false,    // vừa tự động next() sang chương mới để đọc tiếp
  errorMsg: null,
  seenDocs: new WeakSet(),
};

function raReset() {
  raStopAll();
  RA.open = false;
  RA.paragraphs = [];
  RA.currentIndex = -1;
  RA.activeEl = null;
  RA.cache.clear();
  RA.pending.clear();
  RA.autoAdvance = false;
  RA.errorMsg = null;
  RA.seenDocs = new WeakSet();
  const bar = document.getElementById('raBar');
  if (bar) bar.remove();
}

function raShutdown() {
  raStopAll();
  const bar = document.getElementById('raBar');
  if (bar) bar.remove();
  if (RA.audioCtx) { try { RA.audioCtx.close(); } catch (e) {} RA.audioCtx = null; }
  RA.open = false;
}

// ── Panel mở/đóng ──────────────────────────────────────────────
function raTogglePanel() {
  if (RA.open) { raClosePanel(); return; }
  raOpenPanel();
}

function raOpenPanel() {
  RA.open = true;
  document.getElementById('raToggleBtn')?.classList.add('active');
  const readerBody = document.getElementById('readerBody');
  if (!readerBody || document.getElementById('raBar')) return;

  const bar = document.createElement('div');
  bar.id = 'raBar';
  bar.className = 'ra-bar';
  bar.innerHTML = `
    <div class="ra-progress-track"><div class="ra-progress-fill" id="raProgressFill" style="width:0%"></div></div>
    <button class="ra-playbtn" id="raPlayBtn" onclick="raTogglePlayPause()" title="Phát/Tạm dừng">▶</button>
    <button class="ra-stopbtn" onclick="raStopAll()" title="Dừng">■</button>
    <div class="ra-info">
      <div class="ra-status-main" id="raStatusMain">Chưa đọc</div>
      <div class="ra-status-sub" id="raStatusSub">Bấm ▶ hoặc nhấn vào 1 đoạn văn để bắt đầu</div>
    </div>
    <select class="ra-voice-select" id="raVoiceSelect" onchange="raOnVoiceChange(this.value)"><option>Đang tải giọng đọc…</option></select>
    <div class="ra-speed-wrap">
      <span>Tốc độ</span>
      <input type="range" class="ra-speed-range" id="raSpeedRange" min="0.5" max="2" step="0.05" value="${RA.speed}" oninput="raOnSpeedChange(this.value)">
      <span class="ra-speed-val" id="raSpeedVal">${RA.speed.toFixed(2)}x</span>
    </div>
    <button class="ra-closebtn" onclick="raClosePanel()" title="Đóng">✕</button>
  `;
  readerBody.appendChild(bar);
  raLoadVoices();
  raCollectParagraphs(); // gom đoạn văn của trang đang hiển thị (nếu đã render sẵn)
}

function raClosePanel() {
  raStopAll();
  RA.open = false;
  document.getElementById('raToggleBtn')?.classList.remove('active');
  const bar = document.getElementById('raBar');
  if (bar) bar.remove();
}

// ── Tải danh sách giọng đọc từ server ─────────────────────────
function raLoadVoices() {
  fetch(RA_TTS_SERVER + '/api/voices')
    .then(r => r.json())
    .then(data => {
      RA.voices = data || {};
      RA.voicesLoaded = true;
      raBuildVoiceOptions();
    })
    .catch(() => {
      RA.voicesLoaded = true;
      raShowError('Không kết nối được TTS server tại ' + RA_TTS_SERVER + '. Hãy chạy start.bat (hoặc python tts_server.py) trước rồi thử lại.');
      const sel = document.getElementById('raVoiceSelect');
      if (sel) sel.innerHTML = '<option>⚠ Server chưa chạy</option>';
    });
}

function raBuildVoiceOptions() {
  const sel = document.getElementById('raVoiceSelect');
  if (!sel) return;
  const entries = Object.entries(RA.voices);
  if (entries.length === 0) { sel.innerHTML = '<option>Không có giọng nào</option>'; return; }

  const piper = entries.filter(([k]) => k.startsWith('piper:'));
  const nghitts = entries.filter(([k]) => k.startsWith('nghitts:'));
  const other = entries.filter(([k]) => !k.startsWith('piper:') && !k.startsWith('nghitts:'));

  const optHtml = ([key, info]) =>
    `<option value="${escAttr(key)}"${!info.downloaded ? ' disabled' : ''}>${esc(info.label || key)}${!info.downloaded ? ' ⚠ chưa tải' : ''}</option>`;

  let html = '';
  if (piper.length) html += `<optgroup label="Piper TTS">${piper.map(optHtml).join('')}</optgroup>`;
  if (nghitts.length) html += `<optgroup label="Nghi-TTS">${nghitts.map(optHtml).join('')}</optgroup>`;
  if (other.length) html += other.map(optHtml).join('');
  sel.innerHTML = html;

  // Chọn giọng: ưu tiên giọng đã lưu trước đó nếu còn tồn tại & đã tải,
  // nếu không thì chọn giọng đầu tiên đã tải sẵn.
  let chosen = RA.voice && RA.voices[RA.voice] && RA.voices[RA.voice].downloaded ? RA.voice : '';
  if (!chosen) {
    const firstDownloaded = entries.find(([, v]) => v.downloaded);
    chosen = firstDownloaded ? firstDownloaded[0] : (entries[0] ? entries[0][0] : '');
  }
  RA.voice = chosen;
  sel.value = chosen;
  if (chosen) localStorage.setItem('ra_voice', chosen);
}

function raOnVoiceChange(val) {
  RA.voice = val;
  localStorage.setItem('ra_voice', val);
  RA.cache.clear();
  RA.pending.clear();
  RA.currentBuffer = null;
}

function raOnSpeedChange(val) {
  RA.speed = parseFloat(val);
  localStorage.setItem('ra_speed', String(RA.speed));
  const label = document.getElementById('raSpeedVal');
  if (label) label.textContent = RA.speed.toFixed(2) + 'x';
  if (RA.activeSource) { try { RA.activeSource.playbackRate.value = RA.speed; } catch (e) {} }
  RA.cache.clear();
  RA.pending.clear();
}

function raShowError(msg) {
  RA.errorMsg = msg;
  let err = document.getElementById('raErrorMsg');
  if (!err) {
    err = document.createElement('div');
    err.id = 'raErrorMsg';
    err.className = 'ra-error-msg';
    document.getElementById('raBar')?.appendChild(err);
  }
  err.textContent = '⚠ ' + msg;
}

function raClearError() {
  RA.errorMsg = null;
  document.getElementById('raErrorMsg')?.remove();
}

// ── Dò đoạn văn (<p>) trong iframe epub.js hiện tại ──────────────
// Được gọi mỗi khi epub.js render nội dung 1 section vào iframe mới.
function raOnContentLoaded(contents) {
  try {
    const doc = contents.document;
    if (!doc || RA.seenDocs.has(doc)) return; // tránh gắn trùng nếu hook fire lại trên cùng document
    RA.seenDocs.add(doc);

    // Chèn CSS tô sáng vào bên trong iframe (CSS ngoài không lọt vào được vì
    // iframe là 1 document độc lập).
    if (!doc.getElementById(RA_HIGHLIGHT_STYLE_ID)) {
      const styleTag = doc.createElement('style');
      styleTag.id = RA_HIGHLIGHT_STYLE_ID;
      styleTag.textContent = RA_HIGHLIGHT_CSS;
      doc.head?.appendChild(styleTag);
    }

    raCollectParagraphs();
  } catch (e) {
    // im lặng bỏ qua — 1 số section (trang bìa, trang trắng...) có thể không có <p>
  }
}

// Gom toàn bộ <p> (rơi vào trường hợp không có <p> thì lấy li/div có chữ)
// từ tất cả iframe đang render (chế độ 1 trang hoặc spread 2 trang), gắn
// sự kiện click "đọc từ đây" và style con trỏ tay.
function raCollectParagraphs() {
  if (!currentEpubRendition) return;
  let contentsList = [];
  try { contentsList = currentEpubRendition.getContents() || []; } catch (e) { return; }
  if (!contentsList.length) return;

  const wasPlayingIdx = RA.currentIndex;
  const list = [];

  contentsList.forEach(contents => {
    const doc = contents.document;
    if (!doc || !doc.body) return;
    let nodes = Array.from(doc.body.querySelectorAll('p'));
    if (nodes.length === 0) {
      nodes = Array.from(doc.body.querySelectorAll('li, blockquote, h1, h2, h3, h4, div'))
        .filter(el => el.children.length === 0); // chỉ lấy node lá để tránh trùng lặp text
    }
    nodes.forEach(el => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 2) return;
      if (!el.classList.contains('ra-readable-p')) {
        el.classList.add('ra-readable-p');
        el.addEventListener('click', () => raHandleParagraphClick(el));
      }
      list.push({ el, text, contents });
    });
  });

  RA.paragraphs = list;

  if (RA.autoAdvance && RA.playing) {
    // Vừa tự động next() sang section mới trong lúc đang phát -> đọc tiếp từ đầu
    RA.autoAdvance = false;
    if (list.length > 0) {
      setTimeout(() => raPlayFromIndex(0), 250);
    } else {
      // Section này không có đoạn nào đọc được -> thử qua section kế tiếp
      setTimeout(() => raAdvanceSection(), 150);
    }
  } else if (wasPlayingIdx >= 0) {
    RA.currentIndex = -1; // section đổi ngoài ý muốn (VD người dùng bấm nav) -> reset chỉ số
  }
}

function raHandleParagraphClick(el) {
  const idx = RA.paragraphs.findIndex(p => p.el === el);
  if (idx < 0) return;
  if (!RA.open) raOpenPanel();
  RA.currentBuffer = null;
  RA.elapsedOffset = 0;
  raPlayFromIndex(idx);
}

// ── Playback engine (Web Audio API, PCM16 mono base64 giống tts_server.py) ──
function raParagraphKey(idx) { return String(idx); }

function raStopSource() {
  if (RA.activeSource) {
    try { RA.activeSource.onended = null; RA.activeSource.stop(); } catch (e) {}
    RA.activeSource = null;
  }
}

function raStopAll() {
  raStopSource();
  RA.playing = false;
  RA.loading = false;
  raClearHighlight();
  RA.currentIndex = -1;
  RA.elapsedOffset = 0;
  RA.currentBuffer = null;
  RA.cache.clear();
  RA.pending.clear();
  raUpdateStatusUI();
  raUpdatePlayBtn();
}

function raClearHighlight() {
  if (RA.activeEl) { RA.activeEl.classList.remove('ra-active-p'); RA.activeEl = null; }
}

async function raFetchTTS(text) {
  const [engine, voiceKey] = RA.voice.includes(':') ? RA.voice.split(':') : ['piper', RA.voice];
  const res = await fetch(RA_TTS_SERVER + '/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, engine, voice: voiceKey, speed: RA.speed }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Lỗi TTS server (HTTP ${res.status})`);
  }
  const data = await res.json();
  if (!data.audio) throw new Error('Server không trả về dữ liệu âm thanh.');
  return { audio: data.audio, sampleRate: data.sampleRate || 22050 };
}

function raPrefetch(idx) {
  const item = RA.paragraphs[idx];
  if (!item) return;
  const key = raParagraphKey(idx);
  if (RA.cache.has(key) || RA.pending.has(key)) return;
  const promise = raFetchTTS(item.text)
    .then(result => { RA.cache.set(key, result); RA.pending.delete(key); return result; })
    .catch(() => { RA.pending.delete(key); return undefined; });
  RA.pending.set(key, promise);
}

async function raDecodeBuffer(base64Str, sampleRate) {
  const binary = atob(base64Str);
  const len = binary.length;
  const pcm16 = new Int16Array(len / 2);
  for (let i = 0; i < pcm16.length; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    let val = (hi << 8) | lo;
    if (val >= 0x8000) val -= 0x10000;
    pcm16[i] = val;
  }
  if (!RA.audioCtx || RA.audioCtx.sampleRate !== sampleRate) {
    if (RA.audioCtx) { try { await RA.audioCtx.close(); } catch (e) {} }
    RA.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
  }
  const ctx = RA.audioCtx;
  const buffer = ctx.createBuffer(1, pcm16.length, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm16.length; i++) channel[i] = pcm16[i] / 32768;
  return buffer;
}

function raPlayBuffer(buffer, offsetSeconds, idx) {
  const ctx = RA.audioCtx;
  raStopSource();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = RA.speed;
  source.connect(ctx.destination);
  const safeOffset = Math.min(Math.max(offsetSeconds || 0, 0), buffer.duration);
  source.onended = () => {
    if (RA.activeSource === source) raHandleParagraphEnded(idx);
  };
  RA.activeSource = source;
  RA.startTimestamp = ctx.currentTime - safeOffset / RA.speed;
  source.start(0, safeOffset);
  RA.playing = true;
  RA.loading = false;
  raUpdateStatusUI();
  raUpdatePlayBtn();
}

async function raPlayFromIndex(idx, startOffset = 0) {
  if (idx < 0 || idx >= RA.paragraphs.length) { raStopAll(); return; }
  raClearHighlight();
  raClearError();
  const item = RA.paragraphs[idx];
  item.el.classList.add('ra-active-p');
  RA.activeEl = item.el;
  RA.currentIndex = idx;
  RA.playing = true;
  RA.loading = true;
  raUpdateStatusUI();
  raUpdatePlayBtn();

  // Cuộn tới đoạn đang đọc cho dễ theo dõi
  try { item.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}

  raPrefetch(idx + 1); // dự tải trước đoạn kế tiếp để đỡ giật

  try {
    const key = raParagraphKey(idx);
    let result = RA.cache.get(key);
    if (!result) {
      result = RA.pending.get(key) ? await RA.pending.get(key) : await raFetchTTS(item.text);
      if (result) RA.cache.set(key, result);
    }
    if (!result) throw new Error('Không lấy được âm thanh cho đoạn này.');
    if (RA.currentIndex !== idx) return; // người dùng đã bấm sang đoạn khác trong lúc chờ

    RA.currentBuffer = await raDecodeBuffer(result.audio, result.sampleRate);
    if (RA.currentIndex !== idx || !RA.playing) return;
    raPlayBuffer(RA.currentBuffer, startOffset, idx);
  } catch (err) {
    raShowError(err.message || 'Không thể tạo âm thanh cho đoạn này.');
    RA.playing = false;
    RA.loading = false;
    raUpdateStatusUI();
    raUpdatePlayBtn();
  }
}

function raHandleParagraphEnded(idx) {
  RA.currentBuffer = null;
  RA.elapsedOffset = 0;
  if (idx + 1 < RA.paragraphs.length) {
    raPlayFromIndex(idx + 1);
  } else {
    raAdvanceSection();
  }
}

// Hết đoạn văn của section/chương hiện tại -> tự lật sang chương kế tiếp và
// đọc tiếp từ đầu (giống hành vi audiobook liên tục của epub-reader-offline).
function raAdvanceSection() {
  if (!currentEpubRendition) { raStopAll(); return; }
  const beforeCount = RA.paragraphs.length;
  RA.autoAdvance = true;
  RA.loading = true;
  raUpdateStatusUI();
  currentEpubRendition.next().then(() => {
    // Nếu đã ở chương cuối, epub.js sẽ không có gì thay đổi -> dừng lại sau 1 khoảng chờ
    setTimeout(() => {
      if (RA.autoAdvance && RA.paragraphs.length === beforeCount) {
        RA.autoAdvance = false;
        RA.playing = false;
        RA.loading = false;
        raClearHighlight();
        RA.currentIndex = -1;
        document.getElementById('raStatusMain').textContent = 'Đã đọc hết sách';
        document.getElementById('raStatusSub').textContent = '📖 Hoàn thành';
        raUpdatePlayBtn();
      }
    }, 900);
  }).catch(() => {
    RA.autoAdvance = false;
    raStopAll();
  });
}

function raTogglePlayPause() {
  if (!RA.voice) { raShowError('Chưa có giọng đọc khả dụng — kiểm tra TTS server.'); return; }
  if (RA.currentIndex < 0) {
    // Chưa đọc đoạn nào -> bắt đầu từ đoạn đầu tiên đang hiển thị
    raCollectParagraphs();
    raPlayFromIndex(0);
    return;
  }
  if (RA.playing && RA.activeSource) {
    // Tạm dừng: lưu lại vị trí đang phát dở để resume đúng chỗ
    if (RA.audioCtx) {
      const elapsed = (RA.audioCtx.currentTime - RA.startTimestamp) * RA.speed;
      RA.elapsedOffset = Math.min(elapsed, RA.currentBuffer?.duration ?? 0);
    }
    raStopSource();
    RA.playing = false;
    raUpdateStatusUI();
    raUpdatePlayBtn();
  } else {
    RA.playing = true;
    raPlayFromIndex(RA.currentIndex, RA.elapsedOffset);
  }
}

function raUpdatePlayBtn() {
  const btn = document.getElementById('raPlayBtn');
  if (!btn) return;
  if (RA.loading) { btn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></span>'; }
  else if (RA.playing) { btn.textContent = '❚❚'; }
  else { btn.textContent = '▶'; }
}

function raUpdateStatusUI() {
  const main = document.getElementById('raStatusMain');
  const sub = document.getElementById('raStatusSub');
  const fill = document.getElementById('raProgressFill');
  if (!main || !sub) return;
  if (RA.currentIndex < 0) {
    main.textContent = 'Chưa đọc';
    sub.textContent = 'Bấm ▶ hoặc nhấn vào 1 đoạn văn để bắt đầu';
    if (fill) fill.style.width = '0%';
    return;
  }
  const total = RA.paragraphs.length;
  main.textContent = RA.loading ? 'Đang tải giọng đọc…' : (RA.playing ? 'Đang đọc…' : 'Tạm dừng');
  sub.textContent = `Đoạn ${RA.currentIndex + 1}/${total}`;
  if (fill) fill.style.width = total ? `${Math.round(((RA.currentIndex + 1) / total) * 100)}%` : '0%';
}

// ── PDF READER (pdf.js) ────────────────────────────────────────
if (window['pdfjsLib']) {
  // Build the worker as an in-memory Blob URL (no network needed, works on file://)
  const __workerBytes = __b64ToUint8Array(__PDF_WORKER_B64__);
  const __workerBlob = new Blob([__workerBytes], { type: 'application/javascript' });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(__workerBlob);
}

let currentPdfDoc = null;
let currentPdfZoom = 1.2;

async function openPdfReader(arrayBuffer, title) {
  document.getElementById('initialLoading')?.remove();
  const body = document.getElementById('readerBody');
  body.innerHTML = `<div id="pdfViewer"><div class="reader-loading" id="pdfLoading">📄 <span>Đang tải PDF...</span></div></div>`;
  document.getElementById('readerTools').innerHTML = `
    <button onclick="pdfZoom(-0.15)" title="Thu nhỏ">−</button>
    <span id="pdfZoomLabel">${Math.round(currentPdfZoom*100)}%</span>
    <button onclick="pdfZoom(0.15)" title="Phóng to">+</button>`;

  try {
    // Pass raw bytes directly so pdf.js doesn't try to fetch a URL.
    currentPdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    await renderAllPdfPages();
  } catch (err) {
    document.getElementById('pdfViewer').innerHTML =
      `<div class="reader-loading">⚠️ Không đọc được file PDF: ${esc(err.message || '')}</div>`;
  }
}

async function renderAllPdfPages() {
  const viewer = document.getElementById('pdfViewer');
  if (!viewer || !currentPdfDoc) return;
  viewer.innerHTML = '';
  const numPages = currentPdfDoc.numPages;
  for (let i = 1; i <= numPages; i++) {
    const page = await currentPdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: currentPdfZoom });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    viewer.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
}

let pdfZoomTimer = null;
function pdfZoom(delta) {
  currentPdfZoom = Math.min(3, Math.max(0.4, +(currentPdfZoom + delta).toFixed(2)));
  document.getElementById('pdfZoomLabel').textContent = Math.round(currentPdfZoom * 100) + '%';
  clearTimeout(pdfZoomTimer);
  pdfZoomTimer = setTimeout(renderAllPdfPages, 250);
}

// Dừng & dọn dẹp khi rời trang (đóng tab / điều hướng đi nơi khác)
window.addEventListener('beforeunload', () => { raShutdown(); });
