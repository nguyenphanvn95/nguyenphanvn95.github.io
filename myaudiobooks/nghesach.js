// ── STATE ──────────────────────────────────────────────────────
let book = null;            // record trả về từ buildAudiobookRecord()
let libId = null;
let currentChapterIdx = -1;
let isPlaying = false;
let saveTimer = null;

const audioEl = document.getElementById('player');

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}
function progressKey(key) {
  return `nghesach_progress::${key}`;
}
function loadProgress(key) {
  try {
    const raw = localStorage.getItem(progressKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (err) { return null; }
}
function saveProgress(key, chapterIdx, time) {
  try {
    localStorage.setItem(progressKey(key), JSON.stringify({ chapterIdx, time, savedAt: Date.now() }));
  } catch (err) { /* ignore */ }
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

  // Khôi phục tiến trình nghe dở lần trước (nếu có), nếu không thì bắt đầu
  // từ chương đầu tiên.
  const progress = loadProgress(book.key);
  let startIdx = 0;
  let startTime = 0;
  if (progress && progress.chapterIdx >= 0 && progress.chapterIdx < book.chapters.length) {
    startIdx = progress.chapterIdx;
    startTime = progress.time || 0;
  }
  playChapter(startIdx, { autoplay: false, seekTo: startTime });
}

function renderChapterList() {
  const container = document.getElementById('chapterList');
  container.innerHTML = book.chapters.map(ch => `
    <button class="chapter-row" id="chrow-${ch.index}" onclick="playChapter(${ch.index - 1}, {autoplay:true})">
      <span class="chapter-num">${ch.index}</span>
      <span class="chapter-title">${esc(ch.title)}</span>
      <span class="chapter-playing" id="chplay-${ch.index}"></span>
    </button>`).join('');
}

function highlightChapter(idx) {
  document.querySelectorAll('.chapter-row').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.chapter-playing').forEach(el => el.innerHTML = '');
  const ch = book.chapters[idx];
  if (!ch) return;
  const row = document.getElementById(`chrow-${ch.index}`);
  if (row) {
    row.classList.add('active');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  const marker = document.getElementById(`chplay-${ch.index}`);
  if (marker) marker.innerHTML = isPlaying ? '▶' : '⏸';
}

// ── PLAYER ────────────────────────────────────────────────────
function playChapter(idx, { autoplay = true, seekTo = 0 } = {}) {
  if (idx < 0 || idx >= book.chapters.length) return;
  currentChapterIdx = idx;
  const ch = book.chapters[idx];

  document.getElementById('nowPlayingTitle').textContent = `${ch.index}. ${ch.title}`;
  highlightChapter(idx);

  const candidates = driveAudioCandidates(ch.file_id);
  if (!candidates.length) {
    document.getElementById('nowPlayingTitle').textContent = `${ch.index}. ${ch.title} — ⚠️ Không có file audio`;
    return;
  }

  loadMediaWithFallback(audioEl, candidates, 0, () => {
    if (seekTo > 0) audioEl.currentTime = seekTo;
    if (autoplay) audioEl.play().catch(() => {});
  });

  document.getElementById('btnPrev').disabled = idx <= 0;
  document.getElementById('btnNext').disabled = idx >= book.chapters.length - 1;
}

function togglePlay() {
  if (currentChapterIdx < 0) return;
  if (audioEl.paused) audioEl.play().catch(() => {}); else audioEl.pause();
}
function playPrev() {
  if (currentChapterIdx > 0) playChapter(currentChapterIdx - 1, { autoplay: true });
}
function playNext() {
  if (currentChapterIdx < book.chapters.length - 1) playChapter(currentChapterIdx + 1, { autoplay: true });
}
function seekBy(seconds) {
  if (!audioEl.duration) return;
  audioEl.currentTime = Math.max(0, Math.min(audioEl.duration, audioEl.currentTime + seconds));
}
function setSpeed(v) {
  audioEl.playbackRate = parseFloat(v);
}
function onSeekInput(e) {
  if (!audioEl.duration) return;
  audioEl.currentTime = (parseFloat(e.target.value) / 1000) * audioEl.duration;
}

audioEl.addEventListener('play', () => {
  isPlaying = true;
  document.getElementById('btnPlayIcon').textContent = '⏸';
  highlightChapter(currentChapterIdx);
});
audioEl.addEventListener('pause', () => {
  isPlaying = false;
  document.getElementById('btnPlayIcon').textContent = '▶';
  highlightChapter(currentChapterIdx);
});
audioEl.addEventListener('ended', () => {
  saveProgress(book.key, currentChapterIdx, 0);
  if (currentChapterIdx < book.chapters.length - 1) {
    playChapter(currentChapterIdx + 1, { autoplay: true });
  }
});
audioEl.addEventListener('timeupdate', () => {
  if (!audioEl.duration) return;
  const pct = (audioEl.currentTime / audioEl.duration) * 1000;
  const seekbar = document.getElementById('seekbar');
  if (seekbar && !seekbar.matches(':active')) seekbar.value = pct;
  document.getElementById('curTime').textContent = fmtTime(audioEl.currentTime);
  document.getElementById('durTime').textContent = fmtTime(audioEl.duration);

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProgress(book.key, currentChapterIdx, audioEl.currentTime), 1500);
});
window.addEventListener('pagehide', () => {
  if (currentChapterIdx >= 0) saveProgress(book.key, currentChapterIdx, audioEl.currentTime || 0);
});

function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function toggleDesc() {
  document.getElementById('bookDesc').classList.toggle('collapsed');
  document.getElementById('descToggleBtn').textContent =
    document.getElementById('bookDesc').classList.contains('collapsed') ? 'Xem thêm ▾' : 'Thu gọn ▴';
}
