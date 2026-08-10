// ── STATE ──────────────────────────────────────────────────────
let book = null;            // record trả về từ buildAudiobookRecord()
let libId = null;
let isDownloadingAll = false;

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);

async function init() {
  libId = qs('lib') || getSelectedAudiobookLibraryId();
  const bookKey = qs('book');
  const lib = getAudiobookLibraryById(libId);
  document.getElementById('backLink').href = `myaudiobooks.html`;

  if (!bookKey) {
    showError('Thiếu thông tin sách cần mở (thiếu tham số "book" trên đường dẫn).');
    return;
  }

  try {
    const { data } = await loadAudiobookLibraryData(lib.id, false);
    const entry = (data.audiobooks || {})[bookKey];
    if (!entry) {
      showError('Không tìm thấy cuốn sách này trong thư viện. Có thể thư viện đã được đồng bộ lại — hãy quay lại danh sách và mở lại sách.');
      return;
    }
    book = buildAudiobookRecord(bookKey, entry, 0);
    renderBook();
  } catch (err) {
    showError('Không tải được dữ liệu thư viện từ Google Drive. ' + (err.message || ''));
  }
}

function showError(msg) {
  document.getElementById('loadingZone').innerHTML = `
    <div class="autoload-icon">⚠️</div>
    <h2>Không mở được sách</h2>
    <p>${esc(msg)}</p>
    <a class="btn-folder retry" href="myaudiobooks.html">← Quay lại danh sách</a>`;
}

// ── RENDER ────────────────────────────────────────────────────
function renderBook() {
  document.getElementById('loadingZone').style.display = 'none';
  document.getElementById('bookZone').style.display = 'flex';
  document.title = `${book.title} — Nghe sách`;

  document.getElementById('bookTitle').textContent = book.title;
  document.getElementById('headerTitle').textContent = book.title;
  document.getElementById('bookCreators').textContent = book.creators || '';

  let pillsHtml = `<span class="meta-pill format">🎧 ${book.chapterCount} chương</span>`;
  if (book.publisher) pillsHtml += `<span class="meta-pill">🏢 ${esc(book.publisher)}</span>`;
  if (book.language) pillsHtml += `<span class="meta-pill">${langFlag(book.language)} ${langName(book.language)}</span>`;
  document.getElementById('bookPills').innerHTML = pillsHtml;

  document.getElementById('bookDesc').innerHTML = book.description
    ? `<div class="modal-desc">${book.description}</div>` : '';

  const coverEl = document.getElementById('bookCover');
  const hue = 0;
  coverEl.innerHTML = `<div class="cover-placeholder" data-hue="${hue}" style="width:100%;height:100%">
    <div class="cover-placeholder-icon" style="font-size:40px">🎧</div>
  </div>`;
  if (book.cover_file_id) {
    const candidates = driveCoverCandidates(book.cover_file_id);
    if (candidates.length) {
      const img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:contain';
      img.onload = () => { coverEl.innerHTML = ''; coverEl.appendChild(img); };
      loadImgWithFallback(img, candidates);
    }
  }

  renderChapterList();

  const btnAll = document.getElementById('btnDownloadAll');
  if (btnAll) btnAll.disabled = book.chapters.length === 0;
}

function renderChapterList() {
  const container = document.getElementById('chapterList');
  container.innerHTML = book.chapters.map(ch => `
    <div class="chapter-row" id="chrow-${ch.index}">
      <span class="chapter-num">${ch.index}</span>
      <span class="chapter-title" title="${escAttr(ch.title)}">${esc(ch.title)}</span>
      ${ch.size ? `<span class="chapter-size">${fmtBytes(ch.size)}</span>` : ''}
      <button class="chapter-dl-btn" id="chdl-${ch.index}" title="Tải xuống chương này"
        onclick="downloadChapter(${ch.index - 1})">⬇</button>
    </div>`).join('');
}

// ── TẢI XUỐNG ─────────────────────────────────────────────────
// Link tải trực tiếp của Google Drive (bỏ qua trang cảnh báo virus-scan
// cho file lớn nhờ tham số confirm=t). Dùng navigation <a download> thay vì
// fetch() để tránh vướng CORS (Drive không set header CORS cho các link này,
// nhưng điều hướng trình duyệt bình thường thì không bị chặn).
function chapterDownloadUrl(ch) {
  const id = resolveDriveFileId(ch.file_id);
  if (!id) return null;
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}

function downloadChapter(idx) {
  const ch = book.chapters[idx];
  if (!ch) return;
  const url = chapterDownloadUrl(ch);
  const btn = document.getElementById(`chdl-${ch.index}`);

  if (!url) {
    if (btn) btn.title = 'Không có file audio cho chương này';
    alert(`Chương ${ch.index}. ${ch.title} — không có file audio.`);
    return;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = ch.filename || `${ch.title}.mp3`;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();

  if (btn) {
    btn.classList.add('done');
    btn.textContent = '✓';
    btn.title = 'Đã gửi yêu cầu tải xuống — nếu không thấy hộp thoại lưu file, bấm lại';
  }
}

async function downloadAllChapters() {
  if (isDownloadingAll || !book || !book.chapters.length) return;
  isDownloadingAll = true;
  const btnAll = document.getElementById('btnDownloadAll');
  const originalLabel = btnAll ? btnAll.textContent : '';
  if (btnAll) { btnAll.disabled = true; }

  // Trình duyệt (đặc biệt Chrome) sẽ chặn/hỏi xác nhận nếu 1 trang tự động
  // mở quá nhiều tải xuống liên tiếp — nên giãn cách mỗi lượt tải ~700ms
  // và cho người dùng biết tiến trình ngay trên nút bấm.
  for (let i = 0; i < book.chapters.length; i++) {
    if (btnAll) btnAll.textContent = `⬇ Đang tải ${i + 1}/${book.chapters.length}…`;
    downloadChapter(i);
    await new Promise(r => setTimeout(r, 700));
  }

  if (btnAll) {
    btnAll.textContent = '✓ Đã gửi yêu cầu tải tất cả';
    setTimeout(() => { btnAll.textContent = originalLabel; btnAll.disabled = false; }, 3000);
  }
  isDownloadingAll = false;
}

function fmtBytes(bytes) {
  if (!bytes || !isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function toggleDesc() {
  document.getElementById('bookDesc').classList.toggle('collapsed');
  document.getElementById('descToggleBtn').textContent =
    document.getElementById('bookDesc').classList.contains('collapsed') ? 'Xem thêm ▾' : 'Thu gọn ▴';
}
