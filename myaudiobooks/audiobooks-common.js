// ================================================================
// audiobooks-common.js
// ----------------------------------------------------------------
// Cấu hình & các hàm dùng chung cho cả 2 trang:
//   - myaudiobooks.html (duyệt danh sách sách nói)
//   - nghesach.html     (trang nghe sách, danh sách chương + trình phát)
//
// File này đọc dữ liệu từ metadata_public.json do plugin
// "Calibre GDrive Sync" (mục Audiobook Sync) sinh ra, có dạng:
//
// {
//   "generated_at": "...",
//   "source": "google_drive_api",
//   "drive_folder_url": "https://drive.google.com/drive/folders/<id>...",
//   "audiobooks": {
//     "<root_path>|<folder_name>": {
//       "folder_name": "...",
//       "root_path": "...",
//       "drive_folder_id": "...",
//       "title": "...",
//       "creators": [{"name": "...", "role": "..."}],
//       "publisher": "...",
//       "language": "...",
//       "description": "...",
//       "identifiers": [...],
//       "modified": "...",
//       "chapters": [{"id": "...", "title": "..."}],
//       "extra_meta": {...},
//       "cover": {"filename": "...", "file_id": "..."} | null,
//       "metadata_opf": {"filename": "...", "file_id": "..."},
//       "audio_files": { "<filename>": {"file_id": "...", "size": 123}, ... }
//     }
//   }
// }
// ================================================================

// ── DANH SÁCH THƯ VIỆN SÁCH NÓI — THÊM THƯ VIỆN MỚI TẠI ĐÂY ────
// Mỗi phần tử là 1 file metadata_public.json khác nhau (thư mục
// "Audiobooks" khác nhau) đã được đồng bộ lên Google Drive bởi tính
// năng "Audiobook Sync" của plugin Calibre GDrive Sync.
//
// ➕ CÁCH THÊM 1 THƯ VIỆN SÁCH NÓI MỚI:
//   1. Trong Calibre, chạy "Audiobook Sync" (plugin gdrive_sync) ít nhất
//      1 lần để có file Audiobooks/metadata_public.json trên Drive.
//   2. Chuột phải file đó trên Google Drive → Share → đặt "Anyone with
//      the link" → Copy link.
//   3. Thêm 1 dòng vào mảng AUDIOBOOK_LIBRARIES bên dưới.
const AUDIOBOOK_LIBRARIES = [
  { id: 'default', name: 'Sách nói mặc định', link: 'https://drive.google.com/file/d/19rgedzNXtMP6pjaYqLtsURklOI7GGct3/view?usp=drive_link' },
  // { id: 'lib2', name: 'Tên thư viện sách nói thứ 2', link: 'https://drive.google.com/file/d/.../view?usp=drive_link' },
];

const AUDIOBOOK_METADATA_CACHE_KEY = 'myaudiobooks_metadata_cache_v1';
const AUDIOBOOK_SELECTED_LIBRARY_KEY = 'myaudiobooks_selected_library_id';

function getAudiobookLibraryById(id) {
  return AUDIOBOOK_LIBRARIES.find(l => l.id === id) || AUDIOBOOK_LIBRARIES[0];
}
function audiobookMetadataCacheKey(libId) {
  return `${AUDIOBOOK_METADATA_CACHE_KEY}::${libId}`;
}
function getSelectedAudiobookLibraryId() {
  try {
    const saved = localStorage.getItem(AUDIOBOOK_SELECTED_LIBRARY_KEY);
    if (saved && AUDIOBOOK_LIBRARIES.some(l => l.id === saved)) return saved;
  } catch (err) { /* localStorage không khả dụng */ }
  return AUDIOBOOK_LIBRARIES[0].id;
}
function setSelectedAudiobookLibraryId(id) {
  try { localStorage.setItem(AUDIOBOOK_SELECTED_LIBRARY_KEY, id); } catch (err) { /* ignore */ }
}

// ── GOOGLE DRIVE FILE ACCESS (Apps Script proxy, giống mylibrary) ──
const GDRIVE_PROXY_URL = 'https://script.google.com/macros/s/AKfycbz7X2ZUA5mfqz555M9eNUEssz-kjL9Gg0C0l3skOH_aCvIuKyqFA6PoRohuxrCC2ReCbQ/exec';

function driveProxyUrl(fileId) {
  return `${GDRIVE_PROXY_URL}?id=${encodeURIComponent(fileId)}`;
}
function driveViewLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}
function resolveDriveFileId(idOrLink) {
  if (!idOrLink) return null;
  if (/^[a-zA-Z0-9_-]{15,}$/.test(idOrLink)) return idOrLink;
  let m = idOrLink.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = idOrLink.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}
function driveCoverCandidates(idOrLink, size = 800) {
  const id = resolveDriveFileId(idOrLink);
  if (!id) return [];
  const candidates = [];
  if (GDRIVE_PROXY_URL) candidates.push(driveProxyUrl(id));
  candidates.push(
    `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`,
    `https://lh3.googleusercontent.com/d/${id}=w${size}`,
    `https://drive.google.com/uc?export=view&id=${id}`
  );
  return candidates;
}
function driveDownloadCandidates(idOrLink) {
  const id = resolveDriveFileId(idOrLink);
  if (!id) return [];
  const direct = [
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
  ];
  const proxied = direct.flatMap(u => [
    `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`
  ]);
  return [...direct, ...proxied];
}
// Danh sách URL ưu tiên cho THẺ <audio> (audio/video cần hỗ trợ HTTP Range để
// tua được) — link tải trực tiếp của Drive hỗ trợ Range tốt hơn proxy Apps
// Script (proxy luôn trả về toàn bộ nội dung 1 lần), nên thử link trực tiếp
// trước, proxy dùng như phương án cuối cùng.
function driveAudioCandidates(idOrLink) {
  const id = resolveDriveFileId(idOrLink);
  if (!id) return [];
  const candidates = [
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
  ];
  if (GDRIVE_PROXY_URL) candidates.push(driveProxyUrl(id));
  return candidates;
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
function loadImgWithFallback(img, candidates, idx = 0) {
  if (idx >= candidates.length) return;
  img.onerror = () => loadImgWithFallback(img, candidates, idx + 1);
  img.src = candidates[idx];
}
// Tương tự loadImgWithFallback nhưng cho thẻ <audio>/<video>: gán src lần
// lượt từng candidate, nếu phát lỗi thì thử candidate kế tiếp.
//
// onAllFailed (tuỳ chọn): gọi khi ĐÃ thử hết mọi candidate mà vẫn không phát
// được — ví dụ do Google Drive tạm chặn tải file (403) hoặc proxy Apps
// Script trả về nội dung rỗng (một số trường hợp Drive áp giới hạn lượt
// tải/xem cho 1 file cụ thể sẽ khiến mọi cách truy cập, kể cả qua proxy,
// đều thất bại).
//
// Có 1 canh giữ (watchdog) riêng: một số trường hợp lỗi (như response 200
// nhưng 0 byte từ proxy Apps Script) KHÔNG kích hoạt sự kiện "error" của thẻ
// <audio>/<video> — trình duyệt cứ treo ở trạng thái "đang tải" mãi mãi mà
// không báo lỗi cũng không phát được. Watchdog sẽ tự chuyển sang candidate
// kế tiếp nếu sau một khoảng thời gian vẫn chưa có metadata (duration).
function loadMediaWithFallback(mediaEl, candidates, idx = 0, onReady = null, onAllFailed = null, timeoutMs = 9000) {
  // Dọn watchdog / handler của lần gọi trước để tránh trùng lặp.
  if (mediaEl.__fallbackWatchdog) { clearTimeout(mediaEl.__fallbackWatchdog); mediaEl.__fallbackWatchdog = null; }

  if (idx >= candidates.length) {
    mediaEl.removeAttribute('src');
    if (onAllFailed) onAllFailed();
    return;
  }

  const tryNext = () => {
    if (mediaEl.__fallbackWatchdog) { clearTimeout(mediaEl.__fallbackWatchdog); mediaEl.__fallbackWatchdog = null; }
    loadMediaWithFallback(mediaEl, candidates, idx + 1, onReady, onAllFailed, timeoutMs);
  };

  mediaEl.onerror = tryNext;
  mediaEl.onloadedmetadata = () => {
    if (mediaEl.__fallbackWatchdog) { clearTimeout(mediaEl.__fallbackWatchdog); mediaEl.__fallbackWatchdog = null; }
    // duration hợp lệ (không NaN/0/Infinity giả) mới coi là thành công thật.
    if (!mediaEl.duration || !isFinite(mediaEl.duration)) { tryNext(); return; }
    if (onReady) onReady();
  };
  mediaEl.src = candidates[idx];
  mediaEl.load();

  // Watchdog: nếu quá timeoutMs mà chưa có metadata/lỗi → coi là thất bại
  // (xử lý case proxy trả 200 rỗng khiến audio "treo" không lỗi không chạy).
  mediaEl.__fallbackWatchdog = setTimeout(tryNext, timeoutMs);
}

// ── TẢI metadata_public.json (dùng chung cho cả 2 trang) ────────
// Trả về { data, lib } — dùng sessionStorage cache theo từng thư viện,
// giống mylibrary, để chuyển qua lại giữa myaudiobooks.html và
// nghesach.html trong cùng phiên không phải tải lại nhiều lần.
async function loadAudiobookLibraryData(libId, forceReload = false) {
  const lib = getAudiobookLibraryById(libId);
  const cacheKey = audiobookMetadataCacheKey(lib.id);

  if (!forceReload) {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) return { data: JSON.parse(cached), lib };
    } catch (err) { /* cache hỏng — tải lại bên dưới */ }
  }

  const res = await driveFetch(lib.link);
  const text = await res.text();
  const data = JSON.parse(text);
  try { sessionStorage.setItem(cacheKey, text); } catch (err) { /* vượt quota — bỏ qua */ }
  return { data, lib };
}

// ── UTILS DÙNG CHUNG ─────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function langFlag(code) {
  const flags = {vie:'🇻🇳',eng:'🇺🇸',zho:'🇨🇳',jpn:'🇯🇵',kor:'🇰🇷',fra:'🇫🇷',deu:'🇩🇪',ita:'🇮🇹',spa:'🇪🇸'};
  return flags[code] || '🌐';
}
function langName(code) {
  const names = {vie:'Tiếng Việt',eng:'Tiếng Anh',zho:'Tiếng Trung',jpn:'Tiếng Nhật',kor:'Tiếng Hàn',fra:'Tiếng Pháp',deu:'Tiếng Đức',ita:'Tiếng Ý',spa:'Tiếng Tây Ban Nha'};
  return names[code] || code;
}
function normalizeLangCode(code) {
  if (!code) return code;
  const c = code.trim().toLowerCase();
  const map = {vi:'vie',en:'eng',zh:'zho',ja:'jpn',ko:'kor',fr:'fra',de:'deu',it:'ita',es:'spa'};
  return map[c] || c;
}
function normalizeSearchText(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
// So sánh tên file kiểu "tự nhiên" (Chương 2 < Chương 10), dùng để sắp xếp
// audio_files theo đúng thứ tự chương thay vì thứ tự chuỗi thuần (2 > 10).
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const ax = String(a).match(re) || [];
  const bx = String(b).match(re) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const av = ax[i] || '', bv = bx[i] || '';
    const an = parseInt(av, 10), bn = parseInt(bv, 10);
    if (!isNaN(an) && !isNaN(bn)) {
      if (an !== bn) return an - bn;
    } else if (av !== bv) {
      return av < bv ? -1 : 1;
    }
  }
  return 0;
}
// Bỏ phần đuôi file + số thứ tự thừa để dùng tạm làm tên chương khi không
// có tiêu đề chương thật (từ metadata.opf) khớp số lượng.
function titleFromFilename(filename) {
  return String(filename).replace(/\.[a-zA-Z0-9]+$/, '').replace(/[_]+/g, ' ').trim();
}

// ── CHUYỂN 1 "book entry" thô trong metadata_public.json thành 1 object
// tiện dùng cho cả list/grid/modal (myaudiobooks.html) lẫn trang nghe
// (nghesach.html) ─────────────────────────────────────────────────
function buildAudiobookRecord(key, entry, uid) {
  const creatorsArr = Array.isArray(entry.creators) ? entry.creators.filter(c => c && c.name) : [];
  const creatorsStr = creatorsArr.map(c => c.name).join(', ');

  const audioFiles = Object.keys(entry.audio_files || {})
    .sort(naturalCompare)
    .map(filename => ({
      filename,
      file_id: (entry.audio_files[filename] || {}).file_id || '',
      size: (entry.audio_files[filename] || {}).size || null,
    }));

  // Nếu số chương lấy từ metadata.opf (voiz:chapter) khớp đúng số file audio,
  // dùng tiêu đề chương thật theo đúng thứ tự; ngược lại lấy tạm tên file.
  const chaptersMeta = Array.isArray(entry.chapters) ? entry.chapters : [];
  const useMetaTitles = chaptersMeta.length > 0 && chaptersMeta.length === audioFiles.length;
  const chapters = audioFiles.map((af, idx) => ({
    index: idx + 1,
    filename: af.filename,
    file_id: af.file_id,
    size: af.size,
    title: useMetaTitles ? (chaptersMeta[idx].title || titleFromFilename(af.filename)) : titleFromFilename(af.filename),
  }));

  const language = normalizeLangCode(entry.language || '');

  return {
    key,
    uid,
    title: entry.title || entry.folder_name || '(Không có tiêu đề)',
    creators_arr: creatorsArr,
    creators: creatorsStr,
    publisher: entry.publisher || '',
    language,
    description: entry.description || '',
    modified: entry.modified || '',
    has_cover: !!(entry.cover && entry.cover.file_id),
    cover_file_id: entry.cover && entry.cover.file_id ? entry.cover.file_id : null,
    chapters,
    chapterCount: chapters.length,
    folder_name: entry.folder_name || '',
    search_blob: normalizeSearchText([
      entry.title || '', creatorsStr, entry.publisher || '', entry.folder_name || ''
    ].join(' ')),
  };
}
