
// ── STATE ──────────────────────────────────────────────────────
let db = null;
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
let currentSort = 'title_asc';
let comments = {};

// Folder state
let libraryRoot = null;      // FileSystemDirectoryHandle (modern API)
let libraryFileMap = {};     // relative path (lowercase) → File object (fallback)
let folderMode = null;       // 'fsa' | 'input' | 'gdrive' | null

// Google Drive (metadata_public.json) state
let gdriveBooks = {};        // bookId (number) → raw book entry from metadata_public.json
let opfCache = {};           // bookId → parsed metadata.opf extra fields (or null if failed)

// ── GOOGLE APPS SCRIPT PROXY ────────────────────────────────────
// Google's "uc?export=download" / "usercontent.google.com/download" links are
// increasingly blocked (403) when requested via fetch() from a browser — Drive
// treats programmatic fetch() calls as abusive/bot traffic, unlike a real
// browser navigation. Deploying a tiny Google Apps Script Web App under your
// own account (which reads the file server-side via DriveApp, no CORS/anti-bot
// issue) fixes this reliably. Paste your deployed Web App "/exec" URL below —
// see APPS_SCRIPT_PROXY.gs for the script to deploy. Leave as '' to disable
// (falls back to the direct-link attempts only, which may keep hitting 403).
const GDRIVE_PROXY_URL = ''; // e.g. 'https://script.google.com/macros/s/AKfycb.../exec'

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initUpload();
  document.getElementById('folderInputHidden').addEventListener('change', onFolderInputChange);
});

function initUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const jsonInput = document.getElementById('jsonInput');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (/\.json$/i.test(file.name)) loadPublicJsonFile(file);
    else loadFile(file);
  });
  fileInput.addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  jsonInput.addEventListener('change', e => {
    if (e.target.files[0]) loadPublicJsonFile(e.target.files[0]);
    e.target.value = '';
  });
}

// Re-picking the source from the header indicator: offer folder or JSON depending on current mode
function changeLibrarySource() {
  if (folderMode === 'gdrive') {
    document.getElementById('jsonInput').click();
  } else {
    pickFolder();
  }
}

// ── LOAD DB FILE ──────────────────────────────────────────────
async function loadFile(file) {
  document.getElementById('uploadZone').style.display = 'none';
  document.getElementById('appZone').style.display = 'flex';
  document.getElementById('loadingMain').style.display = 'flex';
  document.getElementById('bookGrid').innerHTML = '';
  document.getElementById('pagination').innerHTML = '';

  try {
    const SQL = await initSqlJs({
      wasmBinary: __b64ToUint8Array(__SQL_WASM_B64__)
    });
    const buf = await file.arrayBuffer();
    db = new SQL.Database(new Uint8Array(buf));
    await loadData();
  } catch (err) {
    document.getElementById('loadingMain').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div><div>Không đọc được file: ${err.message}</div></div>`;
  }
}

// ── LOAD DATA ────────────────────────────────────────────────
async function loadData() {
  // Comments
  const cmtRes = db.exec(`SELECT book, text FROM comments`);
  if (cmtRes.length) cmtRes[0].values.forEach(([id, text]) => { comments[id] = text; });

  // File formats per book
  const fmtRes = db.exec(`SELECT book, format, name FROM data ORDER BY book, format`);
  if (fmtRes.length) {
    fmtRes[0].values.forEach(([bookId, fmt, name]) => {
      if (!fileFormats[bookId]) fileFormats[bookId] = [];
      fileFormats[bookId].push({ format: fmt, name });
    });
  }

  // Main query
  const res = db.exec(`
    SELECT b.id, b.title, b.author_sort,
           GROUP_CONCAT(DISTINCT a.name) as authors,
           GROUP_CONCAT(DISTINCT t.name) as tags,
           b.pubdate, b.has_cover, b.path, b.series_index,
           p.name as publisher,
           s.name as series,
           GROUP_CONCAT(DISTINCT d.format) as formats,
           r.rating,
           l.lang_code as lang
    FROM books b
    LEFT JOIN books_authors_link bal ON bal.book = b.id
    LEFT JOIN authors a ON a.id = bal.author
    LEFT JOIN books_tags_link btl ON btl.book = b.id
    LEFT JOIN tags t ON t.id = btl.tag
    LEFT JOIN books_publishers_link bpl ON bpl.book = b.id
    LEFT JOIN publishers p ON p.id = bpl.publisher
    LEFT JOIN books_series_link bsl ON bsl.book = b.id
    LEFT JOIN series s ON s.id = bsl.series
    LEFT JOIN data d ON d.book = b.id
    LEFT JOIN books_ratings_link brl ON brl.book = b.id
    LEFT JOIN ratings r ON r.id = brl.rating
    LEFT JOIN books_languages_link bll ON bll.book = b.id
    LEFT JOIN languages l ON l.id = bll.lang_code
    GROUP BY b.id
    ORDER BY b.title COLLATE NOCASE ASC
  `);

  if (!res.length) { showEmpty('Không tìm thấy sách nào.'); return; }

  const cols = res[0].columns;
  allBooks = res[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    obj.formats_arr = obj.formats ? [...new Set(obj.formats.split(','))] : [];
    obj.tags_arr = obj.tags ? obj.tags.split(',') : [];
    obj.authors_arr = obj.authors ? obj.authors.split(',') : [];
    obj.year = obj.pubdate ? obj.pubdate.substring(0,4) : '';
    return obj;
  });

  finalizeBooksLoaded();
}

// Shared "we now have allBooks[] populated, wire up the rest of the UI" step,
// used by both the Calibre metadata.db flow and the metadata_public.json (Google Drive) flow.
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

// ── LOAD FROM metadata_public.json (Google Drive links) ────────
async function loadPublicJsonFile(file) {
  document.getElementById('uploadZone').style.display = 'none';
  document.getElementById('appZone').style.display = 'flex';
  document.getElementById('loadingMain').style.display = 'flex';
  document.getElementById('loadingMain').innerHTML =
    `<div class="empty"><div class="empty-icon">🌐</div><div>Đang đọc metadata_public.json...</div></div>`;
  document.getElementById('bookGrid').innerHTML = '';
  document.getElementById('pagination').innerHTML = '';

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    loadPublicJsonData(data);
  } catch (err) {
    document.getElementById('loadingMain').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div><div>Không đọc được metadata_public.json: ${esc(err.message || '')}</div></div>`;
  }
}

// Parse the already-loaded JSON object and build allBooks[] / fileFormats{} from it.
function loadPublicJsonData(data) {
  db = null;
  comments = {};
  fileFormats = {};
  gdriveBooks = {};
  opfCache = {};
  libraryRoot = null;
  libraryFileMap = {};
  folderMode = 'gdrive';

  const books = data.books || {};
  allBooks = Object.keys(books).map(key => {
    const entry = books[key];
    const id = parseInt(key, 10);
    gdriveBooks[id] = entry;

    const formatKeys = Object.keys(entry.formats || {});
    fileFormats[id] = formatKeys.map(fmt => ({ format: fmt, name: fmt }));

    const authorsStr = entry.authors || '';
    return {
      id,
      title: entry.title || '(Không có tiêu đề)',
      author_sort: authorsStr,
      authors: authorsStr,
      authors_arr: authorsStr ? authorsStr.split(',').map(s => s.trim()).filter(Boolean) : [],
      tags: '',
      tags_arr: [],
      pubdate: '',
      year: '',
      has_cover: !!entry.cover,
      path: String(id),          // used as the lookup key into gdriveBooks for this mode
      series_index: null,
      publisher: '',
      series: '',
      formats: formatKeys.join(','),
      formats_arr: formatKeys,
      rating: 0,
      lang: ''
    };
  });

  if (!allBooks.length) { showEmpty('Không tìm thấy sách nào trong metadata_public.json.'); return; }

  finalizeBooksLoaded();
}

// ── FOLDER PICKER ─────────────────────────────────────────────
async function pickFolder() {
  // Try modern File System Access API first
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      libraryRoot = handle;
      folderMode = 'fsa';
      await autoDetectAndLoad(handle.name);
      return;
    } catch(e) {
      if (e.name === 'AbortError') return; // user cancelled
      console.warn('FSA picker failed, falling back to <input webkitdirectory>', e);
    }
  }
  // Fallback: <input webkitdirectory>
  document.getElementById('folderInputHidden').click();
}

async function onFolderInputChange(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  folderMode = 'input';
  libraryFileMap = {};
  // Build a map: relative path → File
  // The webkitRelativePath is like "CalibreLib/Author/Book (id)/file.epub"
  // We store from the second segment onward (skip root folder name)
  const rootName = files[0].webkitRelativePath.split('/')[0];
  files.forEach(f => {
    const rel = f.webkitRelativePath.slice(rootName.length + 1); // remove "RootFolder/"
    libraryFileMap[rel.toLowerCase()] = f;
  });

  // reset input so the same folder can be re-selected later
  e.target.value = '';

  // If a database is already loaded (user picked metadata.db manually first),
  // just attach the folder for cover/EPUB/PDF access — don't reload the DB.
  if (db) {
    onFolderSelected(rootName);
    return;
  }

  // Find metadata.db anywhere in the picked folder (prefer root-level)
  const dbEntry = Object.entries(libraryFileMap)
    .find(([rel]) => rel === 'metadata.db') ||
    Object.entries(libraryFileMap).find(([rel]) => rel.endsWith('/metadata.db'));

  if (!dbEntry) {
    alert('Không tìm thấy file metadata.db trong thư mục đã chọn. Hãy chắc chắn đây là thư mục gốc thư viện Calibre.');
    return;
  }
  onFolderSelected(rootName);
  await loadFile(dbEntry[1]);
}

// Recursively search a FileSystemDirectoryHandle (depth-limited) for metadata.db
async function findMetadataDbHandle(dirHandle, depth = 0) {
  // Check root level first (fast path — covers the vast majority of cases)
  try {
    const fh = await dirHandle.getFileHandle('metadata.db', { create: false });
    return fh;
  } catch (e) { /* not at this level, keep looking */ }

  if (depth >= 2) return null; // avoid scanning huge unrelated trees too deeply

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      const found = await findMetadataDbHandle(handle, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// After a directory is selected via the File System Access API:
// locate metadata.db automatically and load it, with zero extra prompts.
async function autoDetectAndLoad(rootName) {
  // If a database is already loaded (e.g. user picked metadata.db manually first,
  // and is now just attaching the library folder for cover/EPUB/PDF access),
  // skip re-finding/re-loading metadata.db — just attach the folder.
  if (db) {
    onFolderSelected(rootName);
    return;
  }

  document.getElementById('uploadZone').style.display = 'none';
  document.getElementById('appZone').style.display = 'flex';
  document.getElementById('loadingMain').style.display = 'flex';
  document.getElementById('loadingMain').innerHTML =
    `<div class="empty"><div class="empty-icon">🔍</div><div>Đang tìm metadata.db trong "${esc(rootName)}"...</div></div>`;

  try {
    const dbHandle = await findMetadataDbHandle(libraryRoot);
    if (!dbHandle) {
      document.getElementById('loadingMain').innerHTML =
        `<div class="empty"><div class="empty-icon">⚠️</div><div>
          Không tìm thấy <strong>metadata.db</strong> trong thư mục "${esc(rootName)}".<br>
          Hãy chọn đúng thư mục gốc của thư viện Calibre.
        </div></div>`;
      return;
    }
    onFolderSelected(rootName);
    const dbFile = await dbHandle.getFile();
    await loadFile(dbFile);
  } catch (err) {
    document.getElementById('loadingMain').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div><div>Lỗi khi đọc thư mục: ${esc(err.message || '')}</div></div>`;
  }
}

function onFolderSelected(name) {
  document.getElementById('folderName').textContent = name;
  document.getElementById('folderBanner').style.display = 'none';
  document.getElementById('folderIndicator').style.display = 'flex';
  // Re-render current page so cover images + file buttons appear (no-op if books not loaded yet)
  if (allBooks.length) renderPage();
}

// ── GOOGLE DRIVE LINK HELPERS ──────────────────────────────────
// The raw `download_link` values coming from metadata_public.json are usually
// plain "https://drive.google.com/uc?id=FILE_ID" links. Requesting that exact
// URL shape directly (as an <img src> or via fetch()) very often gets a 403
// from Google Drive (anti-hotlink / anti-abuse throttling on that endpoint),
// even when the file is shared "Anyone with the link". These helpers extract
// the underlying file ID and build the URL variants Google actually intends
// for embedding/downloading, trying several in order until one works.
function driveFileId(link) {
  if (!link) return null;
  let m = link.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = link.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

// Ordered list of URLs to try for showing a Drive file as a cover <img>.
// `thumbnail` is Google's dedicated embedding endpoint (fastest, least
// likely to 403); the googleusercontent host and uc?export=view are fallbacks.
function driveCoverCandidates(link, size = 800) {
  const id = driveFileId(link);
  if (!id) return link ? [link] : [];
  return [
    `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`,
    `https://lh3.googleusercontent.com/d/${id}=w${size}`,
    `https://drive.google.com/uc?export=view&id=${id}`,
    link
  ];
}

// Ordered list of URLs to try for fetching the raw bytes of a Drive file
// (epub/pdf/opf). The newer usercontent host is used as a fallback since it
// tends to succeed when the classic uc?export=download link gets a 403.
//
// After the direct links, the SAME urls are retried routed through public
// CORS proxies (corsproxy.io, allorigins). This is the same trick the
// reference EPUB reader (epub.html) uses to load .epub files straight from a
// Google Drive link: Drive's anti-bot check often blocks a fetch() coming
// directly from a browser tab, but allows the exact same request when it
// arrives from a proxy server — it just looks like an ordinary
// server-to-server HTTP request instead of a scripted browser fetch.
function driveDownloadCandidates(link) {
  const id = driveFileId(link);
  if (!id) return link ? [link] : [];
  const direct = [
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
    link
  ];
  const proxied = direct.flatMap(u => [
    `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`
  ]);
  return [...direct, ...proxied];
}

// Decode a base64 string (as returned by the Apps Script proxy) into a Uint8Array.
function __b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Fetch a Drive file's raw bytes through a Google Apps Script Web App deployed
// under the user's own account (see APPS_SCRIPT_PROXY.gs). This avoids the 403
// that direct "uc?export=download" / "usercontent.google.com/download" links
// increasingly get when called via fetch() (Drive's anti-bot throttling),
// because the actual Drive read happens server-side inside Apps Script.
// Returns a real Response wrapping a Blob, so callers can still use
// res.blob() / res.text() / res.arrayBuffer() exactly as before.
async function driveFetchViaProxy(link) {
  if (!GDRIVE_PROXY_URL) throw new Error('Chưa cấu hình GDRIVE_PROXY_URL');
  const id = driveFileId(link);
  if (!id) throw new Error('Không xác định được file ID từ link Drive');
  const proxyUrl = `${GDRIVE_PROXY_URL}?id=${encodeURIComponent(id)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error('Proxy HTTP ' + res.status);
  const b64 = (await res.text()).trim();
  if (b64.startsWith('ERROR:')) throw new Error(b64);
  const blob = new Blob([__b64ToBytes(b64)]);
  return new Response(blob, { status: 200 });
}

// fetch() with a hard timeout so a slow/hanging proxy candidate doesn't stall
// the whole driveFetch loop — move on to the next candidate instead.
async function __fetchWithTimeout(url, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Try each download candidate in turn, returning the first successful
// (res.ok) fetch Response. If all direct-link candidates fail (typically a
// 403 from Google Drive's anti-bot throttling on programmatic fetch()), fall
// back to the Apps Script proxy (if configured) before giving up entirely.
async function driveFetch(link) {
  let lastErr = null;
  for (const url of driveDownloadCandidates(link)) {
    try {
      const res = await __fetchWithTimeout(url);
      if (res.ok) return res;
      lastErr = new Error('HTTP ' + res.status + ' — ' + url);
    } catch (e) { lastErr = e; }
  }
  if (GDRIVE_PROXY_URL) {
    try {
      return await driveFetchViaProxy(link);
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

// ── GET FILE FROM FOLDER (or Google Drive, via metadata_public.json) ──────
// Returns the raw File/Blob object for a file inside the Calibre library, or null.
// In 'gdrive' mode, bookPath is actually the book id (see loadPublicJsonData),
// and the bytes are fetched over the network from the book's Google Drive download_link.
async function getFileObject(bookPath, fileName, format) {
  const ext = format.toLowerCase();
  const relPath = `${bookPath}/${fileName}.${ext}`;

  if (folderMode === 'fsa' && libraryRoot) {
    try {
      const parts = relPath.split('/');
      let dir = libraryRoot;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: false });
      return await fileHandle.getFile();
    } catch(e) { return null; }
  }

  if (folderMode === 'input') {
    const key = relPath.toLowerCase();
    return libraryFileMap[key] || null;
  }

  if (folderMode === 'gdrive') {
    const entry = gdriveBooks[bookPath];
    const fmtEntry = entry && entry.formats && entry.formats[format];
    if (!fmtEntry || !fmtEntry.download_link) return null;
    try {
      const res = await driveFetch(fmtEntry.download_link);
      return await res.blob(); // Blob has .arrayBuffer(), same interface File offers
    } catch (e) { return null; }
  }

  return null;
}

// Returns a URL for a file (object URL locally, or the direct Google Drive
// download link in 'gdrive' mode) inside the Calibre library, or null
async function getFileUrl(bookPath, fileName, format) {
  if (folderMode === 'gdrive') {
    const entry = gdriveBooks[bookPath];
    const fmtEntry = entry && entry.formats && entry.formats[format];
    return (fmtEntry && fmtEntry.download_link) || null;
  }
  const file = await getFileObject(bookPath, fileName, format);
  return file ? URL.createObjectURL(file) : null;
}

// Returns an ordered list of candidate URLs to try (in 'gdrive' mode several
// Google Drive endpoints are tried in turn since the raw uc?id= link commonly
//403s — see driveCoverCandidates above). Returns [] if there's no cover.
async function getCoverUrls(bookPath, hasCover) {
  if (!hasCover || !folderMode) return [];
  if (folderMode === 'gdrive') {
    const entry = gdriveBooks[bookPath];
    const link = entry && entry.cover && entry.cover.download_link;
    return link ? driveCoverCandidates(link) : [];
  }
  const url = await getFileUrl(bookPath, 'cover', 'jpg');
  return url ? [url] : [];
}

// Kept for any external callers: single-URL convenience wrapper.
async function getCoverUrl(bookPath, hasCover) {
  const urls = await getCoverUrls(bookPath, hasCover);
  return urls[0] || null;
}

// Public (non-download) Google Drive "view" link for a given format, used as a
// fallback when an in-browser fetch is blocked (e.g. by CORS) in 'gdrive' mode.
function getGdrivePublicLink(bookPath, format) {
  const entry = gdriveBooks[bookPath];
  const fmtEntry = entry && entry.formats && entry.formats[format];
  return (fmtEntry && fmtEntry.public_link) || null;
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
      const haystack = [b.title, b.authors, b.tags, b.publisher, b.series].join(' ').toLowerCase();
      return haystack.includes(q);
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

  // In 'gdrive' mode the JSON only carries title/authors — pull the rest
  // (description, tags, publisher, language, series, rating…) from each
  // book's own metadata.opf on demand, the first time its modal is opened.
  if (folderMode === 'gdrive') {
    fetchOpfMetadata(book).then(extra => {
      if (!extra) return;
      // Bail out if the user has since closed the modal or opened another book
      if (!document.getElementById('modalOverlay').classList.contains('open')) return;
      if (document.getElementById('modalTitle').textContent !== book.title) return;
      applyOpfExtrasToModal(book, extra);
    });
  }
}

// Fetch + parse a book's metadata.opf (OPF/Dublin-Core XML) from its Google Drive
// download link, returning { description, publisher, language, tags, series,
// seriesIndex, rating, pubdate } or null if it could not be read (missing link,
// network error, or blocked by Google Drive's CORS policy).
async function fetchOpfMetadata(book) {
  if (opfCache.hasOwnProperty(book.id)) return opfCache[book.id];

  const entry = gdriveBooks[book.path];
  const opfLink = entry && entry.metadata_opf && entry.metadata_opf.download_link;
  if (!opfLink) { opfCache[book.id] = null; return null; }

  try {
    const res = await driveFetch(opfLink);
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
        📁 <span>Chọn thư mục Calibre để mở file sách —
        <a onclick="closeModalDirect();pickFolder()">chọn ngay</a></span>
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
      btn.title = 'Không tìm thấy file trong thư mục đã chọn';
    }
  });
}

async function openBookFile(bookId, bookPath, fileName, format) {
  const btn = document.getElementById(`fbtn-${bookId}-${format}`);
  if (!btn || btn.classList.contains('disabled')) return;

  const book = allBooks.find(b => b.id === bookId);
  const niceTitle = book ? book.title : fileName;

  // EPUB / PDF need the raw file bytes (ArrayBuffer), not a blob: URL,
  // because epub.js/pdf.js try to XHR-fetch the URL otherwise, which fails on file://.
  if (format === 'EPUB' || format === 'PDF') {
    const fileObj = await getFileObject(bookPath, fileName, format);
    if (!fileObj) {
      if (folderMode === 'gdrive') {
        const link = getGdrivePublicLink(bookPath, format);
        if (link && confirm('Không thể tải trực tiếp file này trong trình đọc (có thể do giới hạn CORS của Google Drive).\nMở liên kết Google Drive trong tab mới?')) {
          window.open(link, '_blank');
        }
      } else {
        alert('Không tìm thấy file. Hãy kiểm tra lại thư mục Calibre.');
      }
      return;
    }
    const buf = await fileObj.arrayBuffer();
    if (format === 'EPUB') openEpubReader(buf, niceTitle, fileObj);
    else openPdfReader(buf, niceTitle, fileObj);
    return;
  }

  const url = btn.dataset.url || await getFileUrl(bookPath, fileName, format);
  if (!url) { alert('Không tìm thấy file. Hãy kiểm tra lại thư mục Calibre.'); return; }

  const audioFmts = ['MP3','M4B','AAC','OGG','FLAC'];
  if (audioFmts.includes(format)) {
    openAudioPlayer(url, niceTitle, format);
    return;
  }
  // Other formats: still download, but with a proper filename
  downloadAs(url, niceTitle, format);
}

// Force-download a blob URL with a human-readable filename
function downloadAs(url, title, format) {
  const safeName = sanitizeFilename(title) + '.' + format.toLowerCase();
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Trigger a download directly from a File object (used by EPUB/PDF reader's download button)
function downloadFileObject(fileObj, title, format) {
  const url = URL.createObjectURL(fileObj);
  downloadAs(url, title, format);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function sanitizeFilename(name) {
  return (name || 'sach').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}

// Mini audio player
function openAudioPlayer(url, name, format) {
  const existing = document.getElementById('audioPlayerBar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'audioPlayerBar';
  bar.style.cssText = `
    position:fixed;bottom:0;left:0;right:0;z-index:999;
    background:var(--ink);color:white;
    padding:10px 20px;display:flex;align-items:center;gap:12px;
    box-shadow:0 -4px 20px rgba(0,0,0,.3);
  `;
  bar.innerHTML = `
    <span style="font-size:18px">${fmtIcon(format)}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div>
      <audio controls autoplay style="width:100%;height:32px;margin-top:4px" src="${url}"></audio>
    </div>
    <button onclick="downloadAs('${url}', '${escAttr(name)}', '${format}')" title="Tải xuống" style="background:none;border:none;color:rgba(255,255,255,.6);font-size:16px;cursor:pointer;padding:4px">⬇</button>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:rgba(255,255,255,.6);font-size:18px;cursor:pointer;padding:4px">✕</button>
  `;
  document.body.appendChild(bar);
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ── READER: shared open/close ──────────────────────────────────
let currentEpubBook = null;
let currentEpubRendition = null;
let currentPdfDoc = null;
let currentPdfZoom = 1.2;

function openReader(title, fileObj, downloadName) {
  closeModalDirect();
  document.getElementById('readerTitle').textContent = title;
  document.getElementById('readerOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  const dlBtn = document.getElementById('readerDownloadBtn');
  dlBtn.onclick = () => downloadFileObject(fileObj, downloadName.replace(/\.[^.]+$/, ''), downloadName.split('.').pop());
}

function closeReader() {
  document.getElementById('readerOverlay').classList.remove('open');
  document.body.style.overflow = '';
  raShutdown(); // dừng & dọn dẹp Read Aloud nếu đang mở
  document.getElementById('readerBody').innerHTML = '';
  document.getElementById('readerTools').innerHTML = '';
  document.removeEventListener('keydown', epubKeyHandler);
  currentEpubBook = null;
  currentEpubRendition = null;
  currentPdfDoc = null;
}

// ── EPUB READER (epub.js) ──────────────────────────────────────
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

function openEpubReader(arrayBuffer, title, fileObj) {
  openReader(title, fileObj, sanitizeFilename(title) + '.epub');
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
  // instead of trying to XHR-fetch a URL (which fails on file://).
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

let epubFontPct = 100;
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
  const sub = document.getElementById('raStatusSub');
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
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  const numSamples = Math.floor(len / 2);
  const view = new DataView(bytes.buffer);
  const floatData = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) floatData[i] = view.getInt16(i * 2, true) / 32768;

  if (!RA.audioCtx || RA.audioCtx.sampleRate !== sampleRate) {
    if (RA.audioCtx) { try { await RA.audioCtx.close(); } catch (e) {} }
    RA.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
  }
  const ctx = RA.audioCtx;
  if (ctx.state === 'suspended') await ctx.resume();
  const buffer = ctx.createBuffer(1, numSamples, sampleRate);
  buffer.getChannelData(0).set(floatData);
  return buffer;
}

function raPlayBuffer(buffer, startOffset, idx) {
  const ctx = RA.audioCtx;
  if (!ctx) return;
  raStopSource();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = RA.speed;
  source.connect(ctx.destination);
  source.onended = () => {
    if (RA.playing && RA.activeSource === source) raHandleParagraphEnded(idx);
  };
  RA.activeSource = source;
  RA.startTimestamp = ctx.currentTime - startOffset / RA.speed;
  RA.elapsedOffset = startOffset;
  source.start(0, startOffset);
  RA.loading = false;
  RA.playing = true;
  raUpdateStatusUI();
  raUpdatePlayBtn();
}

async function raPlayFromIndex(idx, startOffset = 0) {
  if (idx >= RA.paragraphs.length) { raAdvanceSection(); return; }
  const item = RA.paragraphs[idx];
  if (!item) return;

  if (!RA.voice) {
    raShowError('Chưa chọn được giọng đọc (hoặc server TTS chưa chạy).');
    return;
  }
  raClearError();
  raStopSource();
  raClearHighlight();
  RA.currentIndex = idx;
  RA.activeEl = item.el;
  item.el.classList.add('ra-active-p');

  // Cuộn tới đúng vị trí đoạn văn — dùng CFI để epub.js tự lật đúng trang
  // (vì nội dung được phân trang bằng CSS column, không phải scroll thường).
  try {
    const cfi = item.contents.cfiFromNode(item.el);
    if (cfi) currentEpubRendition.display(cfi);
    else item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    try { item.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e2) {}
  }

  // Resume đúng vị trí đang phát dở (bấm tạm dừng rồi bấm play lại)
  if (RA.currentBuffer && RA.currentIndex === idx && startOffset > 0) {
    raPlayBuffer(RA.currentBuffer, startOffset, idx);
    return;
  }

  RA.loading = true;
  RA.playing = true;
  raUpdateStatusUI();
  raUpdatePlayBtn();

  const key = raParagraphKey(idx);
  try {
    let result = RA.cache.get(key);
    if (result) {
      RA.cache.delete(key);
    } else {
      const pending = RA.pending.get(key);
      result = pending ? await pending : await raFetchTTS(item.text);
      RA.pending.delete(key);
    }
    if (!result) result = await raFetchTTS(item.text); // prefetch lỗi -> thử lại 1 lần

    // Nếu người dùng đã bấm dừng/đổi đoạn trong lúc chờ tải thì bỏ qua kết quả trễ này
    if (RA.currentIndex !== idx || !RA.playing) return;

    // Tải trước đoạn kế tiếp ngay khi có dữ liệu đoạn hiện tại để phát liền mạch
    if (idx + 1 < RA.paragraphs.length) raPrefetch(idx + 1);

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

// Thêm keyframe spin cho icon loading trên nút play (chỉ cần chèn 1 lần)
(function raInjectSpinKeyframe() {
  const s = document.createElement('style');
  s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
})();

// ── PDF READER (pdf.js) ────────────────────────────────────────
if (window['pdfjsLib']) {
  // Build the worker as an in-memory Blob URL (no network needed, works on file://)
  const __workerBytes = __b64ToUint8Array(__PDF_WORKER_B64__);
  const __workerBlob = new Blob([__workerBytes], { type: 'application/javascript' });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(__workerBlob);
}

async function openPdfReader(arrayBuffer, title, fileObj) {
  openReader(title, fileObj, sanitizeFilename(title) + '.pdf');
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
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function showEmpty(msg) {
  document.getElementById('loadingMain').innerHTML =
    `<div class="empty"><div class="empty-icon">📭</div><div>${msg}</div></div>`;
}
