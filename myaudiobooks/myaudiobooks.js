
// ── STATE ──────────────────────────────────────────────────────
let allBooks = [];
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = 48;
let currentFilter = 'all';
let currentAuthor = null;
let currentLang = null;
let currentPublisher = null;
let currentSort = 'title_asc';

let currentLibraryId = getSelectedAudiobookLibraryId();

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  autoLoadLibrary();
});

async function autoLoadLibrary(forceReload = false, libId = currentLibraryId) {
  const lib = getAudiobookLibraryById(libId);
  currentLibraryId = lib.id;
  setSelectedAudiobookLibraryId(lib.id);

  document.getElementById('autoloadZone').style.display = 'flex';
  document.getElementById('autoloadCard').innerHTML = `
    <div class="autoload-icon">🎧</div>
    <h2>Đang tải sách nói…</h2>
    <p>Đang tải danh sách sách nói từ Google Drive (${esc(lib.name)}).</p>`;
  document.getElementById('appZone').style.display = 'none';

  try {
    const { data } = await loadAudiobookLibraryData(lib.id, forceReload);
    showAppZoneLoading();
    loadPublicJsonData(data, lib);
  } catch (err) {
    document.getElementById('autoloadCard').innerHTML = `
      <div class="autoload-icon">⚠️</div>
      <h2>Không tải được thư viện sách nói</h2>
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
  container.innerHTML = AUDIOBOOK_LIBRARIES.map(lib => `
    <button class="sidebar-item library-item ${lib.id === currentLibraryId ? 'active' : ''}"
      style="border:1px solid var(--line);border-radius:var(--radius);margin-bottom:8px;padding:10px 14px"
      onclick="selectLibrary('${escAttr(lib.id)}')">
      <span>🎧 ${esc(lib.name)}</span>
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
function selectLibrary(libId) {
  closeLibraryModalDirect();
  autoLoadLibrary(true, libId);
}

function showAppZoneLoading() {
  document.getElementById('autoloadZone').style.display = 'none';
  document.getElementById('appZone').style.display = 'flex';
  document.getElementById('loadingMain').style.display = 'flex';
  document.getElementById('loadingMain').innerHTML = `<div class="spinner"></div><span>Đang xử lý dữ liệu…</span>`;
  document.getElementById('bookGrid').innerHTML = '';
  document.getElementById('pagination').innerHTML = '';
}

function finalizeBooksLoaded() {
  buildSidebar();
  document.getElementById('searchWrap').style.display = 'flex';
  document.getElementById('viewBtns').style.display = 'flex';
  document.getElementById('totalCount').style.display = 'inline';
  document.getElementById('totalCount').textContent = `${allBooks.length} cuốn`;
  document.getElementById('badgeAll').textContent = allBooks.length;
  document.getElementById('badgeCover').textContent = allBooks.filter(b => b.has_cover).length;
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

function loadPublicJsonData(data, lib = getAudiobookLibraryById(currentLibraryId)) {
  const folderNameEl = document.getElementById('folderName');
  if (folderNameEl) folderNameEl.textContent = lib.name;

  const books = data.audiobooks || {};
  allBooks = Object.keys(books).map((key, idx) => buildAudiobookRecord(key, books[key], idx));

  if (!allBooks.length) { showEmpty('Không tìm thấy sách nói nào trong metadata_public.json.'); return; }

  document.getElementById('folderIndicator').style.display = 'flex';
  finalizeBooksLoaded();
}

// ── SIDEBAR ──────────────────────────────────────────────────
function buildSidebar() {
  const authorMap = {};
  allBooks.forEach(b => b.creators_arr.forEach(c => { if (c.name) authorMap[c.name] = (authorMap[c.name]||0)+1; }));
  document.getElementById('authorList').innerHTML = Object.entries(authorMap).sort((a,b)=>b[1]-a[1]).map(([a,c]) =>
    `<button class="sidebar-item" onclick="filterByAuthor('${escAttr(a)}',this)">
      🎙 ${esc(a)} <span class="badge">${c}</span>
    </button>`).join('');

  const langMap = {};
  allBooks.forEach(b => { if (b.language) langMap[b.language] = (langMap[b.language]||0)+1; });
  document.getElementById('langList').innerHTML = Object.entries(langMap).sort((a,b)=>b[1]-a[1]).map(([l,c]) =>
    `<button class="sidebar-item" onclick="filterByLang('${l}',this)">
      ${langFlag(l)} ${langName(l)} <span class="badge">${c}</span>
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
  currentFilter = type; currentAuthor = null; currentLang = null; currentPublisher = null;
  currentPage = 1; applyFilters();
}
function filterByAuthor(author, el) {
  clearSidebarActive(); el.classList.add('active');
  currentFilter = 'author'; currentAuthor = author;
  currentLang = null; currentPublisher = null;
  currentPage = 1; applyFilters();
}
function filterByLang(lang, el) {
  clearSidebarActive(); el.classList.add('active');
  currentFilter = 'lang'; currentLang = lang;
  currentAuthor = null; currentPublisher = null;
  currentPage = 1; applyFilters();
}
function filterByPublisher(pub, el) {
  clearSidebarActive(); el.classList.add('active');
  currentFilter = 'publisher'; currentPublisher = pub;
  currentAuthor = null; currentLang = null;
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
    if (currentFilter === 'author' && !b.creators_arr.some(c => c.name === currentAuthor)) return false;
    if (currentFilter === 'lang' && b.language !== currentLang) return false;
    if (currentFilter === 'publisher' && b.publisher !== currentPublisher) return false;
    if (q) return b.search_blob.includes(normalizeSearchText(q));
    return true;
  });

  filtered.sort((a, b) => {
    switch (currentSort) {
      case 'title_asc':  return (a.title||'').localeCompare(b.title||'', 'vi');
      case 'title_desc': return (b.title||'').localeCompare(a.title||'', 'vi');
      case 'author_asc': return (a.creators||'').localeCompare(b.creators||'', 'vi');
      case 'chapters_desc': return (b.chapterCount||0) - (a.chapterCount||0);
      case 'modified_desc': return String(b.modified||'').localeCompare(String(a.modified||''));
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
      <div class="empty-icon">🔍</div><div>Không tìm thấy sách nói nào</div></div>`;
    return;
  }

  grid.innerHTML = page.map(b => renderCard(b)).join('');
  page.forEach(b => { if (b.has_cover) loadCardCover(b); });
}

function renderCard(b) {
  const hue = b.uid % 8;
  return `<div class="book-card" onclick="openModal(${b.uid})">
    <div class="cover-wrap">
      <div class="cover-placeholder" data-hue="${hue}" id="cover-${b.uid}">
        <div class="cover-placeholder-icon">🎧</div>
        <div class="cover-placeholder-title">${esc(b.title)}</div>
      </div>
      <div class="format-badges"><span class="fmt-badge mp3">${b.chapterCount} chương</span></div>
    </div>
    <div class="card-info">
      <div class="card-title">${esc(b.title)}</div>
      <div class="card-author">${esc(b.creators || '')}</div>
    </div>
  </div>`;
}

function loadCardCover(b) {
  if (!b.cover_file_id) return;
  const candidates = driveCoverCandidates(b.cover_file_id);
  if (!candidates.length) return;
  const el = document.getElementById(`cover-${b.uid}`);
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
function openModal(uid) {
  const book = allBooks.find(b => b.uid === uid);
  if (!book) return;

  const hue = book.uid % 8;
  document.getElementById('modalCover').innerHTML = `<div class="cover-placeholder" data-hue="${hue}" style="width:100%;height:100%">
    <div class="cover-placeholder-icon" style="font-size:40px">🎧</div>
  </div>`;

  if (book.cover_file_id) {
    const candidates = driveCoverCandidates(book.cover_file_id);
    if (candidates.length) {
      const img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:contain';
      img.onload = () => {
        const coverEl = document.getElementById('modalCover');
        if (coverEl) { coverEl.innerHTML = ''; coverEl.appendChild(img); }
      };
      loadImgWithFallback(img, candidates);
    }
  }

  document.getElementById('modalTitle').textContent = book.title;
  document.getElementById('modalAuthor').textContent = book.creators || '';

  document.getElementById('modalFormats').innerHTML =
    `<span class="meta-pill format">🎧 ${book.chapterCount} chương</span>`;
  document.getElementById('modalTags').innerHTML = '';

  renderFileActions(book);

  let statsHtml = '';
  if (book.publisher)
    statsHtml += `<div class="stat-box"><div class="stat-val" style="font-size:11px;line-height:1.3">${esc(book.publisher)}</div><div class="stat-lbl">NXB</div></div>`;
  if (book.language)
    statsHtml += `<div class="stat-box"><div class="stat-val" style="font-size:18px">${langFlag(book.language)}</div><div class="stat-lbl">${langName(book.language)}</div></div>`;
  statsHtml += `<div class="stat-box"><div class="stat-val">${book.chapterCount}</div><div class="stat-lbl">Số chương</div></div>`;
  document.getElementById('modalStats').innerHTML = statsHtml;

  document.getElementById('modalBody').innerHTML = book.description
    ? `<h3>Giới thiệu sách</h3><div class="modal-desc">${book.description}</div>` : '';

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// Thay vì các nút "Mở file" theo định dạng như mylibrary, sách nói chỉ có
// đúng 1 hành động: mở trang nghesach.html để nghe (danh sách chương + trình
// phát audio). Truyền kèm thư viện đang chọn + khoá sách để nghesach.html
// tự tải lại đúng cuốn đó (dùng chung cache sessionStorage nếu có).
function renderFileActions(book) {
  const container = document.getElementById('fileActions');

  if (!book.chapterCount) {
    container.innerHTML = `<div class="no-folder-hint">⚠️ Không có file audio nào cho cuốn sách này</div>`;
    return;
  }

  const url = `nghesach.html?lib=${encodeURIComponent(currentLibraryId)}&book=${encodeURIComponent(book.key)}`;
  container.innerHTML = `
    <div class="file-actions-label">Nghe sách</div>
    <div class="file-btns">
      <a class="file-btn open" href="${escAttr(url)}">🎧 Nghe sách (${book.chapterCount} chương)</a>
    </div>`;
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

function showEmpty(msg) {
  document.getElementById('loadingMain').innerHTML =
    `<div class="empty"><div class="empty-icon">📭</div><div>${msg}</div></div>`;
}
