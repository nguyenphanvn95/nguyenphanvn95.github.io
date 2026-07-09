
// ── STATE ──────────────────────────────────────────────────────
let allBooks = [];
let fileFormats = {};      // bookId → [{format, name}]
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = 48;
let currentFilter = 'all';
let currentTag = null;
let currentFormat = null;
let currentLang = null;
let currentPublisher = null;
let currentSort = 'added_desc';
let comments = {};

// Key used to cache the raw metadata_public.json text in sessionStorage, so
// it's only fetched once per browser tab session instead of on every reload.
// (Mỗi thư viện có 1 cache riêng, xem hàm metadataCacheKey() bên dưới.)
const METADATA_CACHE_KEY = 'mylibrary_metadata_cache_v1';

// Library source: always 'gdrive' once the metadata_public.json has loaded successfully.
let folderMode = null;

// Google Drive (metadata_public.json) state
let gdriveBooks = {};        // bookId (number) → raw book entry from metadata_public.json
let opfCache = {};           // bookId → parsed metadata.opf extra fields (or null if failed)

// ================================================================
// DANH SÁCH THƯ VIỆN (GOOGLE DRIVE) — THÊM THƯ VIỆN MỚI TẠI ĐÂY
// ================================================================
// Mỗi thư viện là 1 file metadata_public.json khác nhau trên Google Drive.
// Người dùng bấm vào nút "Thư viện" trên thanh header để mở hộp thoại chọn
// giữa các thư viện được khai báo trong mảng LIBRARIES dưới đây.
//
// Mỗi phần tử trong mảng gồm:
//   - id:   mã định danh duy nhất, viết liền không dấu (vd: 'default', 'lib2'...)
//           dùng để lưu lựa chọn của người dùng và làm khoá cache riêng.
//   - name: tên hiển thị cho người dùng trong hộp thoại & trên thanh header.
//   - link: link chia sẻ Google Drive (hoặc file_id trần) của file
//           metadata_public.json của thư viện đó. File này (và mọi file sách/
//           bìa mà nó trỏ tới) phải được chia sẻ ở chế độ
//           "Anyone with the link" (Bất kỳ ai có đường liên kết).
//
// ➕ CÁCH THÊM 1 THƯ VIỆN MỚI:
//   1. Tạo/lấy link chia sẻ Google Drive của file metadata_public.json cho
//      thư viện đó (chuột phải file → Share → Copy link).
//   2. Thêm 1 dòng mới vào mảng LIBRARIES bên dưới, ví dụ:
//        { id: 'sachnoiviet', name: 'Sách nói Việt', link: 'https://drive.google.com/file/d/XXXXXXXXXXXXXXXXXXXXXXXXX/view?usp=drive_link' }
//   3. Lưu file app.js lại — thư viện mới sẽ tự xuất hiện trong hộp thoại
//      chọn thư viện, không cần sửa gì thêm ở index.html hay chỗ khác.
//
// Thư viện đầu tiên trong danh sách (LIBRARIES[0]) là thư viện mặc định,
// được tự động tải khi mở trang lần đầu (nếu người dùng chưa từng chọn
// thư viện nào khác trước đó trên trình duyệt này).
const LIBRARIES = [
  { id: 'default', name: 'Thư viện mặc định', link: 'https://drive.google.com/file/d/1cnlQaEaUUKpWWuREqybUWGtbWq80CL7I/view?usp=drive_link' },
  { id: 'lib2', name: 'Old books', link: 'https://drive.google.com/file/d/1UdwpHQG0Fox-BF1_5nmZ0Upgs01zVNK5/view?usp=drive_link' }
  // { id: 'lib2', name: 'Tên thư viện thứ 2', link: 'https://drive.google.com/file/d/.../view?usp=drive_link' },
];

// localStorage key ghi nhớ thư viện người dùng đã chọn lần gần nhất, để lần
// mở trang sau (kể cả tắt hẳn trình duyệt) vẫn vào đúng thư viện đó.
const SELECTED_LIBRARY_KEY = 'mylibrary_selected_library_id';

// id của thư viện đang được chọn/hiển thị — khởi tạo dựa theo lựa chọn đã lưu
// trước đó (nếu còn hợp lệ trong LIBRARIES), hoặc mặc định LIBRARIES[0].
let currentLibraryId = (() => {
  try {
    const saved = localStorage.getItem(SELECTED_LIBRARY_KEY);
    if (saved && LIBRARIES.some(l => l.id === saved)) return saved;
  } catch (err) { /* localStorage không khả dụng — dùng mặc định */ }
  return LIBRARIES[0].id;
})();

function getLibraryById(id) {
  return LIBRARIES.find(l => l.id === id) || LIBRARIES[0];
}
// Cache key riêng cho từng thư viện, để chuyển qua lại giữa các thư viện
// không bị lẫn/ghi đè dữ liệu cache của nhau trong sessionStorage.
function metadataCacheKey(libId) {
  return `${METADATA_CACHE_KEY}::${libId}`;
}

// Note: the Google Apps Script proxy used to fetch Drive files (metadata_public.json,
// EPUB/PDF/audio/covers/opf) is configured further down, near the Drive helper
// functions, as GDRIVE_PROXY_URL.

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  autoLoadLibrary();
});

// Fetch metadata_public.json of a given library (mặc định là thư viện đang
// được chọn — currentLibraryId) và build thư viện sách từ đó — không cần
// thao tác chọn file/folder thủ công.
//
// forceReload = true bỏ qua cache trong sessionStorage và luôn tải lại từ
// Google Drive (dùng khi người dùng bấm nút "Tải lại thư viện" trên header,
// hoặc khi chuyển sang 1 thư viện khác).
// libId = id thư viện muốn tải (mặc định currentLibraryId, tức thư viện đang chọn).
async function autoLoadLibrary(forceReload = false, libId = currentLibraryId) {
  const lib = getLibraryById(libId);
  currentLibraryId = lib.id;
  try { localStorage.setItem(SELECTED_LIBRARY_KEY, lib.id); } catch (err) { /* ignore */ }

  document.getElementById('autoloadZone').style.display = 'flex';
  document.getElementById('autoloadCard').innerHTML = `
    <div class="autoload-icon">🌐</div>
    <h2>Đang tải thư viện…</h2>
    <p>Đang tải danh sách sách từ Google Drive (${esc(lib.name)}).</p>`;
  document.getElementById('appZone').style.display = 'none';

  const cacheKey = metadataCacheKey(lib.id);

  // Nếu đã có dữ liệu được cache trong phiên làm việc này (sessionStorage),
  // dùng lại luôn thay vì gọi lại Google Drive — giúp mở lại trang / chuyển
  // qua lại giữa index.html và reader.html trong cùng 1 phiên không phải tải
  // lại metadata_public.json nhiều lần.
  if (!forceReload) {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        showAppZoneLoading();
        loadPublicJsonData(data, lib);
        return;
      }
    } catch (err) {
      // Cache hỏng hoặc sessionStorage không khả dụng (chế độ ẩn danh, quota...)
      // -> bỏ qua, tải lại bình thường từ Google Drive bên dưới.
    }
  }

  try {
    const res = await driveFetch(lib.link);
    const text = await res.text();
    const data = JSON.parse(text);

    try {
      sessionStorage.setItem(cacheKey, text);
    } catch (err) {
      // Thư viện quá lớn vượt quota sessionStorage, hoặc trình duyệt chặn lưu
      // trữ — bỏ qua, không ảnh hưởng đến việc hiển thị thư viện lần này.
    }

    showAppZoneLoading();
    loadPublicJsonData(data, lib);
  } catch (err) {
    document.getElementById('autoloadCard').innerHTML = `
      <div class="autoload-icon">⚠️</div>
      <h2>Không tải được thư viện</h2>
      <p>Không lấy được metadata_public.json từ Google Drive (${esc(lib.name)}).</p>
      <p style="font-size:12px">${esc(err.message || '')}</p>
      <button class="btn-folder retry" onclick="autoLoadLibrary(true)">🔄 Thử lại</button>
      <button class="btn-folder secondary retry" onclick="openLibraryModal()">📚 Chọn thư viện khác</button>`;
  }
}

// ── HỘP THOẠI CHỌN THƯ VIỆN ──────────────────────────────────
function renderLibraryList() {
  const container = document.getElementById('libraryList');
  if (!container) return;
  container.innerHTML = LIBRARIES.map(lib => `
    <button class="sidebar-item library-item ${lib.id === currentLibraryId ? 'active' : ''}"
      style="border:1px solid var(--line);border-radius:var(--radius);margin-bottom:8px;padding:10px 14px"
      onclick="selectLibrary('${escAttr(lib.id)}')">
      <span>🌐 ${esc(lib.name)}</span>
      ${lib.id === currentLibraryId ? '<span class="badge">Đang dùng</span>' : ''}
    </button>`).join('');
}

function openLibraryModal() {
  renderLibraryList();
  document.getElementById('libraryModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLibraryModal(e) {
  if (e.target === document.getElementById('libraryModalOverlay')) closeLibraryModalDirect();
}
function closeLibraryModalDirect() {
  document.getElementById('libraryModalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
// Người dùng chọn 1 thư viện trong hộp thoại — đóng hộp thoại lại và tải
// thư viện đó (luôn tải mới, bỏ qua cache, để phản ánh đúng lựa chọn).
function selectLibrary(libId) {
  closeLibraryModalDirect();
  if (libId === currentLibraryId) { autoLoadLibrary(true, libId); return; }
  autoLoadLibrary(true, libId);
}

// Chuyển từ màn hình "đang tải" sang khung app chính, hiện spinner xử lý dữ
// liệu — dùng chung cho cả đường tải từ cache và đường tải mới từ Drive.
function showAppZoneLoading() {
  document.getElementById('autoloadZone').style.display = 'none';
  document.getElementById('appZone').style.display = 'flex';
  document.getElementById('loadingMain').style.display = 'flex';
  document.getElementById('loadingMain').innerHTML = `<div class="spinner"></div><span>Đang xử lý dữ liệu…</span>`;
  document.getElementById('bookGrid').innerHTML = '';
  document.getElementById('pagination').innerHTML = '';
}


// Shared "we now have allBooks[] populated, wire up the rest of the UI" step,
// used after metadata_public.json has been loaded from Google Drive.
function finalizeBooksLoaded() {
  buildSidebar();
  document.getElementById('searchWrap').style.display = 'flex';
  document.getElementById('viewBtns').style.display = 'flex';
  document.getElementById('totalCount').style.display = 'inline';
  document.getElementById('totalCount').textContent = `${allBooks.length} cuốn`;
  document.getElementById('badgeAll').textContent = allBooks.length;
  document.getElementById('badgeCover').textContent = allBooks.filter(b => b.has_cover).length;
  document.getElementById('badgeRated').textContent = allBooks.filter(b => b.rating).length;
  document.getElementById('folderIndicator').style.display = 'flex';

  if (!finalizeBooksLoaded._searchWired) {
    finalizeBooksLoaded._searchWired = true;
    document.getElementById('searchInput').addEventListener('input', debounce(() => {
      currentPage = 1; applyFilters();
    }, 220));
  }

  document.getElementById('loadingMain').style.display = 'none';
  currentPage = 1;
  applyFilters();
}

// Parse the already-loaded JSON object and build allBooks[] / fileFormats{} from it.
// lib = { id, name, link } của thư viện vừa tải (dùng để cập nhật tên hiển thị
// trên thanh header — mặc định là thư viện đang chọn nếu không truyền vào).
function loadPublicJsonData(data, lib = getLibraryById(currentLibraryId)) {
  comments = {};
  fileFormats = {};
  gdriveBooks = {};
  opfCache = {};
  folderMode = 'gdrive';

  const folderNameEl = document.getElementById('folderName');
  if (folderNameEl) folderNameEl.textContent = lib.name;

  // Tolerate both the newer flat shape ({ "23": {...}, "45": {...} }) and an
  // older { "books": { "23": {...} } } wrapper.
  const books = data.books || data;
  allBooks = Object.keys(books).map(key => {
    const entry = books[key];
    const id = entry.book_id != null ? entry.book_id : parseInt(key, 10);
    gdriveBooks[id] = entry;

    const formatKeys = Object.keys(entry.formats || {});
    fileFormats[id] = formatKeys.map(fmt => ({ format: fmt, name: fmt }));

    const authorsStr = entry.authors || '';
    const tagsArr = Array.isArray(entry.tags) ? entry.tags.filter(Boolean)
      : (entry.tags ? String(entry.tags).split(',').map(s => s.trim()).filter(Boolean) : []);
    const langsArr = Array.isArray(entry.languages) ? entry.languages.filter(Boolean)
      : (entry.languages ? [entry.languages] : []);
    const pubdate = entry.pubdate || '';
    // Ngày sách được NHẬP vào thư viện (khác với pubdate = ngày xuất bản).
    // Chấp nhận vài tên trường phổ biến tuỳ theo cách metadata_public.json
    // được xuất ra từ Calibre; nếu không có trường nào, sẽ dùng book_id để
    // suy ra thứ tự nhập trước/sau (id lớn hơn = nhập sau) khi sắp xếp.
    const added = entry.timestamp || entry.date_added || entry.added || entry.import_date || '';

    if (entry.comments) comments[id] = entry.comments;

    return {
      id,
      title: entry.title || '(Không có tiêu đề)',
      author_sort: entry.author_sort || authorsStr,
      authors: authorsStr,
      authors_arr: authorsStr ? authorsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
      tags: tagsArr.join(','),
      tags_arr: tagsArr,
      pubdate,
      added,
      year: pubdate ? String(pubdate).substring(0, 4) : '',
      has_cover: entry.has_cover != null ? !!entry.has_cover : !!(entry.cover && entry.cover.file_id),
      path: String(id),          // used as the lookup key into gdriveBooks for this mode
      series_index: entry.series_index != null ? entry.series_index : null,
      publisher: entry.publisher || '',
      series: entry.series || '',
      formats: formatKeys.join(','),
      formats_arr: formatKeys,
      rating: normalizeCalibreRating(entry.rating),
      lang: normalizeLangCode(langsArr[0] || ''),
      // Chuỗi tìm kiếm đã bỏ dấu tiếng Việt + viết thường, tính sẵn 1 lần lúc
      // nạp thư viện để tìm kiếm không dấu (xem hàm normalizeSearchText) nhanh,
      // không phải tính lại mỗi lần gõ phím.
      search_blob: normalizeSearchText([
        entry.title || '', authorsStr, tagsArr.join(' '), entry.publisher || '', entry.series || ''
      ].join(' '))
    };
  });

  if (!allBooks.length) { showEmpty('Không tìm thấy sách nào trong metadata_public.json.'); return; }

  document.getElementById('folderIndicator').style.display = 'flex';
  finalizeBooksLoaded();
}

// Calibre's ratings table stores values on a 0-10 scale (2 per star); tolerate
// a plain 0-5 star value too, in case a given export uses that scale instead.
function normalizeCalibreRating(r) {
  if (r == null || r === '') return 0;
  const n = parseFloat(r);
  if (isNaN(n)) return 0;
  return n <= 5 ? n * 2 : n;
}

// ── GOOGLE DRIVE FILE ACCESS (via file_id + Apps Script proxy) ──
// The new metadata_public.json only stores each file's raw Drive `file_id`
// (no more download_link/public_link). Files are fetched through a small
// Google Apps Script Web App deployed under the user's own account, which
// reads the file server-side via DriveApp and returns it directly (JSON as
// JSON, binary files as raw bytes) — this sidesteps the 403 / anti-bot
// throttling that direct "uc?export=download" links increasingly get when
// requested via fetch() from a browser.
const GDRIVE_PROXY_URL = 'https://script.google.com/macros/s/AKfycbz7X2ZUA5mfqz555M9eNUEssz-kjL9Gg0C0l3skOH_aCvIuKyqFA6PoRohuxrCC2ReCbQ/exec';

function driveProxyUrl(fileId) {
  return `${GDRIVE_PROXY_URL}?id=${encodeURIComponent(fileId)}`;
}

// Normal human-facing Google Drive "view" page for a file — used as a
// fallback link ("open in Drive") when in-app fetching fails for some reason.
function driveViewLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// Extracts a bare Drive file ID whether given one directly, or a full Drive
// link (kept for backward-compatibility with older metadata_public.json
// files that stored links instead of raw file_id).
function resolveDriveFileId(idOrLink) {
  if (!idOrLink) return null;
  if (/^[a-zA-Z0-9_-]{15,}$/.test(idOrLink)) return idOrLink; // already a bare file ID
  let m = idOrLink.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = idOrLink.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

// Ordered list of URLs to try for showing a Drive file as a cover <img>.
// The Apps Script proxy is tried first (most reliable); the rest are public
// Google endpoints kept as a fallback in case the proxy is ever unreachable.
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

// Ordered list of URLs to try for fetching the raw bytes of a Drive file
// (epub/pdf/audio/opf) directly, without the proxy — used only as a fallback
// if the Apps Script proxy call fails. The same direct links are also tried
// routed through public CORS proxies (corsproxy.io, allorigins), since
// Drive's anti-bot check often blocks a fetch() coming directly from a
// browser tab but allows the same request when it arrives from a proxy server.
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

// fetch() with a hard timeout so a slow/hanging candidate doesn't stall
// the whole driveFetch loop — move on to the next candidate instead.
async function __fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a Drive file's raw bytes/content given its file_id (or a legacy
// Drive link). Tries the Apps Script proxy first (reliable, no CORS/403
// issues since the actual Drive read happens server-side), then falls back
// to direct Drive links / public CORS proxies if the proxy call fails.
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

// Assign img.src trying each candidate URL in order; on load error, move on
// to the next candidate instead of leaving a broken image / giving up.
function loadImgWithFallback(img, candidates, idx = 0) {
  if (idx >= candidates.length) return;
  img.onerror = () => loadImgWithFallback(img, candidates, idx + 1);
  img.src = candidates[idx];
}

// ── GET FILE FROM GOOGLE DRIVE (via metadata_public.json) ──────
// Returns the raw Blob for a book's file, fetched over the network via its
// Google Drive file_id (bookPath is the book id — see loadPublicJsonData).
async function getFileObject(bookPath, fileName, format) {
  if (folderMode !== 'gdrive') return null;
  const entry = gdriveBooks[bookPath];
  const fmtEntry = entry && entry.formats && entry.formats[format];
  const fileId = fmtEntry && fmtEntry.file_id;
  if (!fileId) return null;
  try {
    const res = await driveFetch(fileId);
    return await res.blob(); // Blob has .arrayBuffer(), same interface File offers
  } catch (e) { return null; }
}

// Returns a fetchable URL (through the Apps Script proxy) for a book's file, or null.
async function getFileUrl(bookPath, fileName, format) {
  if (folderMode !== 'gdrive') return null;
  const entry = gdriveBooks[bookPath];
  const fmtEntry = entry && entry.formats && entry.formats[format];
  const fileId = fmtEntry && fmtEntry.file_id;
  return fileId ? driveProxyUrl(fileId) : null;
}

// Returns an ordered list of candidate URLs to try for a book's cover image.
// Returns [] if there's no cover.
async function getCoverUrls(bookPath, hasCover) {
  if (!hasCover || folderMode !== 'gdrive') return [];
  const entry = gdriveBooks[bookPath];
  const fileId = entry && entry.cover && entry.cover.file_id;
  return fileId ? driveCoverCandidates(fileId) : [];
}

// Kept for any external callers: single-URL convenience wrapper.
async function getCoverUrl(bookPath, hasCover) {
  const urls = await getCoverUrls(bookPath, hasCover);
  return urls[0] || null;
}

// Public (non-proxy) Google Drive "view" link for a given format, used as a
// fallback when in-app fetching fails, so the person can open/download it manually.
function getGdrivePublicLink(bookPath, format) {
  const entry = gdriveBooks[bookPath];
  const fmtEntry = entry && entry.formats && entry.formats[format];
  const fileId = fmtEntry && fmtEntry.file_id;
  return fileId ? driveViewLink(fileId) : null;
}

// The book's file_id for a given format — used by openBookFile to build the
// Google Drive "view" preview link (driveViewLink) when opening a file.
function getFormatFileId(bookPath, format) {
  const entry = gdriveBooks[bookPath];
  const fmtEntry = entry && entry.formats && entry.formats[format];
  return (fmtEntry && fmtEntry.file_id) || null;
}

// ── SIDEBAR ──────────────────────────────────────────────────
function buildSidebar() {
  const fmtMap = {};
  allBooks.forEach(b => b.formats_arr.forEach(f => { fmtMap[f] = (fmtMap[f]||0)+1; }));
  document.getElementById('formatList').innerHTML = Object.entries(fmtMap).sort((a,b)=>b[1]-a[1]).map(([f,c]) =>
    `<button class="sidebar-item" onclick="filterByFormat('${f}',this)">
      ${fmtIcon(f)} ${f} <span class="badge">${c}</span>
    </button>`).join('');

  const langMap = {};
  allBooks.forEach(b => { if (b.lang) langMap[b.lang] = (langMap[b.lang]||0)+1; });
  document.getElementById('langList').innerHTML = Object.entries(langMap).sort((a,b)=>b[1]-a[1]).map(([l,c]) =>
    `<button class="sidebar-item" onclick="filterByLang('${l}',this)">
      ${langFlag(l)} ${langName(l)} <span class="badge">${c}</span>
    </button>`).join('');

  const tagMap = {};
  allBooks.forEach(b => b.tags_arr.forEach(t => { if(t) tagMap[t] = (tagMap[t]||0)+1; }));
  document.getElementById('tagList').innerHTML = Object.entries(tagMap).sort((a,b)=>b[1]-a[1]).map(([t,c]) =>
    `<button class="sidebar-item" onclick="filterByTag('${escAttr(t)}',this)">
      🏷 ${esc(t)} <span class="badge">${c}</span>
    </button>`).join('');

  const pubMap = {};
  allBooks.forEach(b => { if (b.publisher) pubMap[b.publisher] = (pubMap[b.publisher]||0)+1; });
  document.getElementById('publisherList').innerHTML = Object.entries(pubMap).sort((a,b)=>b[1]-a[1]).map(([p,c]) =>
    `<button class="sidebar-item" onclick="filterByPublisher('${escAttr(p)}',this)">
      🏢 ${esc(p)} <span class="badge">${c}</span>
    </button>`).join('');
}

// ── FILTERS ──────────────────────────────────────────────────
function clearSidebarActive() {
  document.querySelectorAll('#sidebar .sidebar-item').forEach(el => el.classList.remove('active'));
}
function filterBy(type, el) {
  clearSidebarActive(); el.classList.add('active');
  currentFilter = type; currentTag = null; currentFormat = null; currentLang = null; currentPublisher = null;
  currentPage = 1; applyFilters();
}
function filterByFormat(fmt, el) {
  clearSidebarActive(); el.classList.add('active');
  currentFilter = 'format'; currentFormat = fmt;
  currentTag = null; currentLang = null; currentPublisher = null;
  currentPage = 1; applyFilters();
}
function filterByLang(lang, el) {
  clearSidebarActive(); el.classList.add('active');
  currentFilter = 'lang'; currentLang = lang;
  currentTag = null; currentFormat = null; currentPublisher = null;
  currentPage = 1; applyFilters();
}
function filterByTag(tag, el) {
  clearSidebarActive(); el.classList.add('active');
  currentFilter = 'tag'; currentTag = tag;
  currentFormat = null; currentLang = null; currentPublisher = null;
  currentPage = 1; applyFilters();
}
function filterByPublisher(pub, el) {
  clearSidebarActive(); el.classList.add('active');
  currentFilter = 'publisher'; currentPublisher = pub;
  currentTag = null; currentFormat = null; currentLang = null;
  currentPage = 1; applyFilters();
}
function applySort() {
  currentSort = document.getElementById('sortSelect').value;
  currentPage = 1; applyFilters();
}

function applyFilters() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  filtered = allBooks.filter(b => {
    if (currentFilter === 'has_cover' && !b.has_cover) return false;
    if (currentFilter === 'rated' && !b.rating) return false;
    if (currentFilter === 'format' && !b.formats_arr.includes(currentFormat)) return false;
    if (currentFilter === 'lang' && b.lang !== currentLang) return false;
    if (currentFilter === 'tag' && !b.tags_arr.includes(currentTag)) return false;
    if (currentFilter === 'publisher' && b.publisher !== currentPublisher) return false;
    if (q) {
      // Tìm không dấu: cả từ khoá lẫn dữ liệu sách đều được bỏ dấu trước khi
      // so khớp, nên gõ "nguyen nhat anh" vẫn tìm ra "Nguyễn Nhật Ánh".
      return b.search_blob.includes(normalizeSearchText(q));
    }
    return true;
  });

  filtered.sort((a, b) => {
    switch (currentSort) {
      case 'title_asc':   return (a.title||'').localeCompare(b.title||'', 'vi');
      case 'title_desc':  return (b.title||'').localeCompare(a.title||'', 'vi');
      case 'author_asc':  return (a.author_sort||'').localeCompare(b.author_sort||'', 'vi');
      case 'date_desc':   return (b.pubdate||'').localeCompare(a.pubdate||'');
      case 'date_asc':    return (a.pubdate||'').localeCompare(b.pubdate||'');
      case 'rating_desc': return (b.rating||0) - (a.rating||0);
      // Sắp xếp theo thời điểm sách được NHẬP vào thư viện (không phải ngày
      // xuất bản). Nếu có trường 'added' thì so sánh theo đó; nếu không, coi
      // book_id lớn hơn là sách nhập sau (đúng với cách Calibre cấp id tăng dần).
      case 'added_desc': {
        if (a.added && b.added) return String(b.added).localeCompare(String(a.added));
        if (a.added && !b.added) return -1;
        if (!a.added && b.added) return 1;
        return (b.id||0) - (a.id||0);
      }
      case 'added_asc': {
        if (a.added && b.added) return String(a.added).localeCompare(String(b.added));
        if (a.added && !b.added) return 1;
        if (!a.added && b.added) return -1;
        return (a.id||0) - (b.id||0);
      }
    }
    return 0;
  });

  const count = filtered.length;
  document.getElementById('resultCount').innerHTML =
    `Hiển thị <strong>${Math.min(PAGE_SIZE*(currentPage), count)}</strong> / <strong>${count}</strong> cuốn`;
  renderPage();
  renderPagination();
}

// ── RENDER ────────────────────────────────────────────────────
function renderPage() {
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);
  const grid = document.getElementById('bookGrid');

  if (!page.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="empty-icon">🔍</div><div>Không tìm thấy sách nào</div></div>`;
    return;
  }

  grid.innerHTML = page.map(b => renderCard(b)).join('');

  // Async: load cover images if folder selected
  if (folderMode) {
    page.forEach(b => { if (b.has_cover) loadCardCover(b); });
  }
}

function renderCard(b) {
  const hue = b.id % 8;
  const rating = b.rating ? '★'.repeat(Math.round(b.rating/2)) : '';
  const formatBadges = b.formats_arr.map(f =>
    `<span class="fmt-badge ${f.toLowerCase()}">${f}</span>`).join('');

  return `<div class="book-card" onclick="openModal(${b.id})">
    <div class="cover-wrap">
      <div class="cover-placeholder" data-hue="${hue}" id="cover-${b.id}">
        <div class="cover-placeholder-icon">📖</div>
        <div class="cover-placeholder-title">${esc(b.title)}</div>
      </div>
      <div class="format-badges">${formatBadges}</div>
    </div>
    <div class="card-info">
      <div class="card-title">${esc(b.title)}</div>
      <div class="card-author">${esc(b.authors || b.author_sort || '')}</div>
      ${rating ? `<div class="card-rating">${rating}</div>` : ''}
    </div>
  </div>`;
}

async function loadCardCover(b) {
  const candidates = await getCoverUrls(b.path, b.has_cover);
  if (!candidates.length) return;
  const el = document.getElementById(`cover-${b.id}`);
  if (!el) return;
  const img = document.createElement('img');
  img.onload = () => { el.replaceWith(img); };
  loadImgWithFallback(img, candidates);
}

// ── PAGINATION ────────────────────────────────────────────────
function renderPagination() {
  const total = Math.ceil(filtered.length / PAGE_SIZE);
  if (total <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
  let html = `<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
  const range = pageRange(currentPage, total);
  let prev = null;
  range.forEach(p => {
    if (prev !== null && p - prev > 1) html += `<span class="page-btn" style="opacity:.4;cursor:default">…</span>`;
    html += `<button class="page-btn ${p===currentPage?'active':''}" onclick="goPage(${p})">${p}</button>`;
    prev = p;
  });
  html += `<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===total?'disabled':''}>›</button>`;
  document.getElementById('pagination').innerHTML = html;
}

function pageRange(cur, total) {
  const delta = 2;
  const range = new Set([1, total]);
  for (let i = Math.max(2, cur-delta); i <= Math.min(total-1, cur+delta); i++) range.add(i);
  return [...range].sort((a,b)=>a-b);
}

function goPage(p) {
  const total = Math.ceil(filtered.length / PAGE_SIZE);
  if (p < 1 || p > total) return;
  currentPage = p; renderPage(); renderPagination();
  document.getElementById('bookGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── MODAL ────────────────────────────────────────────────────
async function openModal(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;

  // Cover
  const hue = book.id % 8;
  let coverHtml = `<div class="cover-placeholder" data-hue="${hue}" style="width:100%;height:100%">
    <div class="cover-placeholder-icon" style="font-size:40px">📖</div>
  </div>`;
  document.getElementById('modalCover').innerHTML = coverHtml;

  // Load real cover async
  if (folderMode && book.has_cover) {
    getCoverUrls(book.path, true).then(candidates => {
      if (!candidates.length) return;
      const img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:contain';
      img.onload = () => {
        const coverEl = document.getElementById('modalCover');
        if (coverEl) { coverEl.innerHTML = ''; coverEl.appendChild(img); }
      };
      loadImgWithFallback(img, candidates);
    });
  }

  document.getElementById('modalTitle').textContent = book.title;
  document.getElementById('modalAuthor').textContent = book.authors || book.author_sort || '';

  // Format pills
  document.getElementById('modalFormats').innerHTML = book.formats_arr.map(f =>
    `<span class="meta-pill format">${fmtIcon(f)} ${f}</span>`).join('');

  // Tags
  document.getElementById('modalTags').innerHTML = book.tags_arr.filter(Boolean).map(t =>
    `<span class="meta-pill">${esc(t)}</span>`).join('');

  // File action buttons
  renderFileActions(book);

  // Stats
  let statsHtml = '';
  if (book.year && book.year > '1900')
    statsHtml += `<div class="stat-box"><div class="stat-val">${book.year}</div><div class="stat-lbl">Năm XB</div></div>`;
  if (book.rating)
    statsHtml += `<div class="stat-box"><div class="stat-val">${(book.rating/2).toFixed(1)}★</div><div class="stat-lbl">Đánh giá</div></div>`;
  if (book.publisher)
    statsHtml += `<div class="stat-box"><div class="stat-val" style="font-size:11px;line-height:1.3">${esc(book.publisher)}</div><div class="stat-lbl">NXB</div></div>`;
  if (book.series)
    statsHtml += `<div class="stat-box"><div class="stat-val" style="font-size:11px;line-height:1.3">${esc(book.series)}</div><div class="stat-lbl">Bộ sách</div></div>`;
  if (book.lang)
    statsHtml += `<div class="stat-box"><div class="stat-val" style="font-size:18px">${langFlag(book.lang)}</div><div class="stat-lbl">${langName(book.lang)}</div></div>`;
  document.getElementById('modalStats').innerHTML = statsHtml;

  // Description
  const desc = comments[book.id];
  document.getElementById('modalBody').innerHTML = desc
    ? `<h3>Giới thiệu sách</h3><div class="modal-desc">${desc}</div>` : '';

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  // The new metadata_public.json already carries tags/publisher/language/series/
  // rating/pubdate directly, so metadata.opf is only needed as a fallback for
  // the description when the JSON didn't include one for this book.
  if (folderMode === 'gdrive' && !comments[book.id]) {
    fetchOpfMetadata(book).then(extra => {
      if (!extra) return;
      // Bail out if the user has since closed the modal or opened another book
      if (!document.getElementById('modalOverlay').classList.contains('open')) return;
      if (document.getElementById('modalTitle').textContent !== book.title) return;
      applyOpfExtrasToModal(book, extra);
    });
  }
}

// Fetch + parse a book's metadata.opf (OPF/Dublin-Core XML) from Google Drive,
// returning { description, publisher, language, tags, series, seriesIndex,
// rating, pubdate } or null if it could not be read (missing file_id, network
// error, etc). Used only to fill in a missing description — the rest of these
// fields normally already come straight from metadata_public.json.
async function fetchOpfMetadata(book) {
  if (opfCache.hasOwnProperty(book.id)) return opfCache[book.id];

  const entry = gdriveBooks[book.path];
  const opfFileId = entry && entry.metadata_opf && entry.metadata_opf.file_id;
  if (!opfFileId) { opfCache[book.id] = null; return null; }

  try {
    const res = await driveFetch(opfFileId);
    const xmlText = await res.text();
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('XML không hợp lệ');

    const dcText = (tag) => {
      const el = xml.getElementsByTagNameNS('*', tag)[0] || xml.querySelector(tag);
      return el && el.textContent ? el.textContent.trim() : '';
    };
    const metaContent = (name) => {
      const el = xml.querySelector(`meta[name="${name}"]`);
      return el ? (el.getAttribute('content') || '') : '';
    };
    const subjects = Array.from(xml.getElementsByTagNameNS('*', 'subject'))
      .map(el => (el.textContent || '').trim()).filter(Boolean);

    const extra = {
      description: dcText('description'),
      publisher: dcText('publisher'),
      language: dcText('language'),
      pubdate: dcText('date'),
      tags: subjects,
      series: metaContent('calibre:series'),
      seriesIndex: metaContent('calibre:series_index'),
      rating: metaContent('calibre:rating')
    };
    opfCache[book.id] = extra;
    return extra;
  } catch (e) {
    opfCache[book.id] = null;
    return null;
  }
}

// Merge freshly-fetched metadata.opf fields into the book object (so filters/
// sort keep working) and refresh the currently-open modal to show them.
function applyOpfExtrasToModal(book, extra) {
  if (extra.tags && extra.tags.length) {
    book.tags_arr = extra.tags;
    book.tags = extra.tags.join(',');
    document.getElementById('modalTags').innerHTML = book.tags_arr.map(t =>
      `<span class="meta-pill">${esc(t)}</span>`).join('');
  }
  if (extra.publisher) book.publisher = extra.publisher;
  if (extra.language) book.lang = normalizeLangCode(extra.language);
  if (extra.series) book.series = extra.series;
  if (extra.rating) {
    // Calibre's OPF stores calibre:rating either as 0-5 (stars) or already 0-10 —
    // the UI (like the DB path above) expects a 0-10 scale, so normalize up if needed.
    const r = parseFloat(extra.rating);
    if (!isNaN(r)) book.rating = r <= 5 ? r * 2 : r;
  }
  if (extra.pubdate) { book.pubdate = extra.pubdate; book.year = extra.pubdate.substring(0, 4); }
  if (extra.description) comments[book.id] = extra.description;

  // Cập nhật lại chuỗi tìm kiếm không dấu vì tags/publisher/series có thể vừa
  // được bổ sung thêm từ metadata.opf ở trên.
  book.search_blob = normalizeSearchText(
    [book.title, book.authors, book.tags, book.publisher, book.series].join(' ')
  );

  let statsHtml = '';
  if (book.year && book.year > '1900')
    statsHtml += `<div class="stat-box"><div class="stat-val">${book.year}</div><div class="stat-lbl">Năm XB</div></div>`;
  if (book.rating)
    statsHtml += `<div class="stat-box"><div class="stat-val">${(book.rating/2).toFixed(1)}★</div><div class="stat-lbl">Đánh giá</div></div>`;
  if (book.publisher)
    statsHtml += `<div class="stat-box"><div class="stat-val" style="font-size:11px;line-height:1.3">${esc(book.publisher)}</div><div class="stat-lbl">NXB</div></div>`;
  if (book.series)
    statsHtml += `<div class="stat-box"><div class="stat-val" style="font-size:11px;line-height:1.3">${esc(book.series)}</div><div class="stat-lbl">Bộ sách</div></div>`;
  if (book.lang)
    statsHtml += `<div class="stat-box"><div class="stat-val" style="font-size:18px">${langFlag(book.lang)}</div><div class="stat-lbl">${langName(book.lang)}</div></div>`;
  document.getElementById('modalStats').innerHTML = statsHtml;

  const desc = comments[book.id];
  document.getElementById('modalBody').innerHTML = desc
    ? `<h3>Giới thiệu sách</h3><div class="modal-desc">${desc}</div>` : '';

  // Progressively enrich the sidebar (tags/language/publisher lists) as more
  // books get their metadata.opf loaded, without disturbing the active filter.
  buildSidebar();
}

function renderFileActions(book) {
  const container = document.getElementById('fileActions');
  const formats = fileFormats[book.id] || [];

  if (!folderMode) {
    container.innerHTML = `
      <div class="no-folder-hint">
        📁 <span>Thư viện đang được tải, vui lòng đợi trong giây lát…</span>
      </div>`;
    return;
  }

  if (!formats.length) {
    container.innerHTML = `<div class="no-folder-hint">⚠️ Không có file nào cho cuốn sách này</div>`;
    return;
  }

  container.innerHTML = `
    <div class="file-actions-label">Mở file</div>
    <div class="file-btns" id="fileBtns-${book.id}">
      ${formats.map(f => `
        <button class="file-btn disabled" id="fbtn-${book.id}-${f.format}"
          onclick="openBookFile(${book.id},'${escAttr(book.path)}','${escAttr(f.name)}','${f.format}')">
          ${fmtIcon(f.format)} ${f.format}
        </button>`).join('')}
    </div>`;

  // Check which files actually exist
  formats.forEach(async f => {
    const url = await getFileUrl(book.path, f.name, f.format);
    const btn = document.getElementById(`fbtn-${book.id}-${f.format}`);
    if (!btn) return;
    if (url) {
      btn.classList.remove('disabled');
      btn.classList.add('open');
      btn.dataset.url = url;
    } else {
      btn.title = 'Không tìm thấy file trong thư viện';
    }
  });
}

// ── MỞ FILE: DÙNG THẲNG TRANG XEM TRƯỚC (PREVIEW) CỦA GOOGLE DRIVE ──
// Khi bấm vào 1 định dạng file (EPUB/PDF/MOBI/MP3/M4B/...), mở tab mới tới
// trang "view" gốc của Google Drive cho đúng file đó, dạng:
//   https://drive.google.com/file/d/<file_id>/view
// Trang này do Google cung cấp sẵn: xem trước được nhiều định dạng (PDF, ảnh,
// audio...) ngay trên trình duyệt, và luôn có nút tải xuống — không cần đăng
// nhập gì thêm (miễn file đã chia sẻ "Anyone with the link"), không phụ thuộc
// bất kỳ dịch vụ đọc/nghe online bên thứ 3 nào.
async function openBookFile(bookId, bookPath, fileName, format) {
  const btn = document.getElementById(`fbtn-${bookId}-${format}`);
  if (!btn || btn.classList.contains('disabled')) return;

  const fileId = getFormatFileId(bookPath, format);
  if (!fileId) { alert('Không tìm thấy file. Hãy kiểm tra lại thư viện.'); return; }

  window.open(driveViewLink(fileId), '_blank', 'noopener');
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModalDirect(); });

// ── VIEW ──────────────────────────────────────────────────────
function setView(mode) {
  document.getElementById('btnGrid').classList.toggle('active', mode === 'grid');
  document.getElementById('btnList').classList.toggle('active', mode === 'list');
  document.body.classList.toggle('list-view', mode === 'list');
}

// ── UTILS ─────────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function fmtIcon(f) {
  const icons = {EPUB:'📘',PDF:'📄',MP3:'🎵',M4B:'🎙',AAC:'🎧',MOBI:'📱',AZW3:'📱',OGG:'🎵',FLAC:'🎵'};
  return icons[f] || '📂';
}
function langFlag(code) {
  const flags = {vie:'🇻🇳',eng:'🇺🇸',zho:'🇨🇳',jpn:'🇯🇵',kor:'🇰🇷',fra:'🇫🇷',deu:'🇩🇪',ita:'🇮🇹',spa:'🇪🇸'};
  return flags[code] || '🌐';
}
function langName(code) {
  const names = {vie:'Tiếng Việt',eng:'Tiếng Anh',zho:'Tiếng Trung',jpn:'Tiếng Nhật',kor:'Tiếng Hàn',fra:'Tiếng Pháp',deu:'Tiếng Đức',ita:'Tiếng Ý',spa:'Tiếng Tây Ban Nha'};
  return names[code] || code;
}
// metadata.opf commonly uses 2-letter ISO 639-1 codes (vi, en, ...) while the
// sidebar/flags above key off Calibre's usual 3-letter codes — map the common ones.
function normalizeLangCode(code) {
  if (!code) return code;
  const c = code.trim().toLowerCase();
  const map = {vi:'vie',en:'eng',zh:'zho',ja:'jpn',ko:'kor',fr:'fra',de:'deu',it:'ita',es:'spa'};
  return map[c] || c;
}
// Bỏ dấu tiếng Việt + viết thường, dùng cho tìm kiếm không dấu (gõ "sach nau
// an" vẫn tìm ra "Sách nấu ăn"). NFD tách chữ cái ra khỏi dấu thanh/dấu phụ
// cho hầu hết ký tự có dấu; riêng "đ/Đ" không tách được bằng NFD (nó là 1 chữ
// cái riêng chứ không phải "d" + dấu) nên phải thay thế thủ công.
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
function showEmpty(msg) {
  document.getElementById('loadingMain').innerHTML =
    `<div class="empty"><div class="empty-icon">📭</div><div>${msg}</div></div>`;
}
