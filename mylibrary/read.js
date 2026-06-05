// â”€â”€ STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const state = {
  bookId: null,
  bookMeta: null,
  type: null,
  fontSize: 16,
  theme: 'light',
  epubBook: null,
  epubRendition: null,
  pdfDoc: null,
  pdfCurrentPage: 1,
  pdfTotalPages: 0,
  pdfZoom: 1.0,
  pdfRendering: false,
  pdfRenderQueue: null,
};

// â”€â”€ UTILS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

function setLoading(pct, msg) {
  $('loading-fill').style.width = pct + '%';
  $('loading-text').textContent = msg;
}

function showError(msg, detail = '') {
  $('loading-screen').classList.add('hide');
  $('error-screen').classList.add('show');
  $('error-msg').textContent = msg;
  $('error-code').textContent = detail;
  $('error-code').style.display = detail ? 'block' : 'none';
}

function showApp() {
  setTimeout(() => {
    $('loading-screen').classList.add('hide');
    setTimeout(() => {
      $('loading-screen').style.display = 'none';
      $('app').style.opacity = '';   // clear inline style nếu epub đã set
      $('app').classList.add('ready');
    }, 500);
  }, 300);
}

function setProgress(pct) {
  const p = Math.round(pct * 100) / 100;
  $('progress-fill').style.width = p + '%';
  $('progress-pct').textContent = Math.round(p) + '%';
}

function showKbdHint() {
  const h = $('kbd-hint');
  h.classList.add('show');
  setTimeout(() => h.classList.remove('show'), 3000);
}

// â”€â”€ LOAD LINK.JSON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadLinkJson() {
  setLoading(10, 'loading link.json...');
  const res = await fetch('link.json');
  if (!res.ok) throw new Error(`link.json: HTTP ${res.status}`);
  return await res.json();
}

// â”€â”€ BOOK META â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function applyMeta(meta) {
  state.bookMeta = meta;
  $('sidebar-title').textContent = meta.title || 'Unknown Title';
  $('sidebar-author').textContent = meta.author || '';
  $('topbar-title').textContent = meta.title || 'Book Reader';
  document.title = (meta.title || 'Book') + ' â€” Reader';

  if (meta.cover) {
    $('cover-wrap').innerHTML = `<img src="${meta.cover}" alt="cover" onerror="this.parentNode.innerHTML='<div class=book-cover-placeholder>ðŸ“–</div>'">`;
  }
}

// â”€â”€ EPUB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function ensureEpubJs() {
  if (typeof ePub === 'function') return;
  // fallback: load tá»« CDN khÃ¡c
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('KhÃ´ng táº£i Ä‘Æ°á»£c epub.js'));
    document.head.appendChild(s);
  });
  if (typeof ePub !== 'function') throw new Error('epub.js load xong nhÆ°ng ePub() khÃ´ng tá»“n táº¡i');
}


async function loadEpub(url) {
  setLoading(20, 'loading epub.js...');
  await ensureEpubJs();

  // EPUB.js is most reliable when opened directly from the .epub URL.
  // This avoids handing ArrayBuffer data to the parser as if it were a path.
  setLoading(30, 'opening epub...');
  const book = ePub(url);
  state.epubBook = book;

  await Promise.race([
    book.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error('epub parse timeout')), 30000))
  ]);
  setLoading(65, 'rendering...');

  $('epub-container').classList.add('active');

  const TOPBAR_H = 52;
  const W = window.innerWidth;
  const H = window.innerHeight - TOPBAR_H;

  const rendition = book.renderTo('epub-viewer', {
    width: W,
    height: H,
    flow: 'paginated',
    spread: 'none',
    allowScriptedContent: false,
  });
  state.epubRendition = rendition;

  const savedLoc = localStorage.getItem('reader_loc_' + state.bookId);
  setLoading(75, 'rendering page...');

  await Promise.race([
    rendition.display(savedLoc || undefined),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout render first page (20s)')), 20000))
  ]);

  setLoading(90, 'loading toc...');
  applyEpubTheme();

  try {
    const nav = await Promise.race([
      book.loaded.navigation,
      new Promise(r => setTimeout(() => r({ toc: [] }), 5000))
    ]);
    buildToc(nav.toc, rendition);
  } catch (e) {
    $('toc-list').innerHTML = '<div class="toc-title">Mục lục</div><div style="padding:12px 20px;font-size:0.8rem;color:var(--ink3);font-style:italic;">Không có mục lục</div>';
  }

  book.locations.generate(1024).then(() => {
    rendition.on('relocated', loc => {
      try {
        const pct = book.locations.percentageFromCfi(loc.start.cfi) * 100;
        setProgress(pct);
        localStorage.setItem('reader_loc_' + state.bookId, loc.start.cfi);
      } catch (e) {}
    });
  }).catch(() => {});

  $('epub-prev').onclick = () => rendition.prev();
  $('epub-next').onclick = () => rendition.next();

  const viewer = $('epub-viewer');
  let touchStartX = 0;
  viewer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  viewer.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(dx) > 50) dx < 0 ? rendition.next() : rendition.prev();
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') rendition.prev();
    if (e.key === 'ArrowRight') rendition.next();
  });

  window.addEventListener('resize', () => {
    rendition.resize(window.innerWidth, window.innerHeight - TOPBAR_H);
  });

  setLoading(100, 'done');
  showApp();
  showKbdHint();
}

function applyEpubTheme() {
  const r = state.epubRendition;
  if (!r) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--reader-bg').trim();
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--reader-text').trim();
  r.themes.default({
    body: {
      'font-family': "'Lora', Georgia, serif !important",
      'font-size': state.fontSize + 'px !important',
      'color': fg + ' !important',
      'background': bg + ' !important',
      'line-height': '1.85 !important',
      'max-width': '680px !important',
      'margin': '0 auto !important',
      'padding': '0 24px !important',
    },
    'a': { 'color': 'var(--accent) !important' }
  });
  r.themes.select('default');
}

function buildToc(toc, rendition) {
  const list = $('toc-list');
  list.innerHTML = '<div class="toc-title">Má»¥c lá»¥c</div>';
  if (!toc || toc.length === 0) {
    list.innerHTML += '<div style="padding:12px 20px;font-size:0.8rem;color:var(--ink3);font-style:italic;">KhÃ´ng cÃ³ má»¥c lá»¥c</div>';
    return;
  }
  function addItems(items, depth = 0) {
    items.forEach(item => {
      const el = document.createElement('a');
      el.className = 'toc-item';
      el.textContent = item.label;
      el.style.paddingLeft = (20 + depth * 12) + 'px';
      el.href = '#';
      el.onclick = e => {
        e.preventDefault();
        rendition.display(item.href);
        document.querySelectorAll('.toc-item').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        // mobile: close sidebar
        if (window.innerWidth <= 640) closeSidebarMobile();
      };
      list.appendChild(el);
      if (item.subitems && item.subitems.length) addItems(item.subitems, depth + 1);
    });
  }
  addItems(toc);
}

// â”€â”€ PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let pdfjsLib = null;
const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

async function loadPdfJs() {
  if (pdfjsLib) return;
  if (window.pdfjsLib) {
    pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
    return;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${PDFJS_CDN}/pdf.min.js`;
    s.onload = resolve;
    s.onerror = () => reject(new Error('KhÃ´ng táº£i Ä‘Æ°á»£c pdf.js tá»« CDN'));
    document.head.appendChild(s);
  });
  pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('pdf.js load xong nhÆ°ng window.pdfjsLib khÃ´ng tá»“n táº¡i');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
}

async function loadPdf(url) {
  setLoading(20, 'loading pdf.js...');
  await loadPdfJs();

  setLoading(40, 'downloading pdf...');
  $('pdf-container').classList.add('active');

  // Use a CORS proxy if direct access fails
  const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false });

  loadingTask.onProgress = p => {
    if (p.total) {
      const pct = 40 + (p.loaded / p.total) * 40;
      setLoading(pct, `downloading... ${Math.round(p.loaded/1024)}KB`);
    }
  };

  const pdf = await loadingTask.promise;
  state.pdfDoc = pdf;
  state.pdfTotalPages = pdf.numPages;
  state.pdfCurrentPage = 1;

  $('pdf-total-pages').textContent = pdf.numPages;
  $('pdf-page-input').max = pdf.numPages;

  setLoading(85, 'rendering pages...');

  // Build TOC from PDF outline
  const outline = await pdf.getOutline();
  buildPdfToc(outline, pdf);

  await renderAllPdfPages();

  setLoading(100, 'done');
  showApp();

  setupPdfControls();
  showKbdHint();
}

async function renderAllPdfPages() {
  const scroll = $('pdf-scroll-area');
  scroll.innerHTML = '';
  const pdf = state.pdfDoc;
  const zoom = state.pdfZoom;

  // Render pages one by one (lazy-ish: all at once for smaller docs)
  for (let i = 1; i <= pdf.numPages; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page-wrap';
    wrap.id = 'pdf-p-' + i;
    wrap.innerHTML = `<div class="pdf-loading-page">pÃ¡gina ${i}</div>`;
    scroll.appendChild(wrap);
  }

  // Intersection observer for lazy render
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        const pageNum = parseInt(id.replace('pdf-p-', ''));
        if (!entry.target.dataset.rendered) {
          entry.target.dataset.rendered = '1';
          renderPdfPage(pageNum, entry.target);
          observer.unobserve(entry.target);
        }
      }
    });
  }, { rootMargin: '200px' });

  document.querySelectorAll('.pdf-page-wrap').forEach(el => observer.observe(el));
}

async function renderPdfPage(num, container) {
  try {
    const page = await state.pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: state.pdfZoom });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    container.innerHTML = '';
    container.appendChild(canvas);
    const lbl = document.createElement('div');
    lbl.className = 'pdf-page-num';
    lbl.textContent = num;
    container.appendChild(lbl);
  } catch(e) {
    container.innerHTML = `<div class="pdf-loading-page" style="color:var(--accent)">Lá»—i trang ${num}</div>`;
  }
}

async function rerenderAllPdf() {
  const pdf = state.pdfDoc;
  if (!pdf) return;
  document.querySelectorAll('.pdf-page-wrap').forEach(el => {
    const num = parseInt(el.id.replace('pdf-p-', ''));
    el.removeAttribute('data-rendered');
    el.innerHTML = `<div class="pdf-loading-page">trang ${num}</div>`;
  });
  // re-observe
  await renderAllPdfPages();
}

function buildPdfToc(outline, pdf) {
  const list = $('toc-list');
  list.innerHTML = '<div class="toc-title">Má»¥c lá»¥c</div>';
  if (!outline || outline.length === 0) {
    list.innerHTML += '<div style="padding:12px 20px;font-size:0.8rem;color:var(--ink3);font-style:italic;">KhÃ´ng cÃ³ má»¥c lá»¥c</div>';
    return;
  }
  async function addItems(items, depth = 0) {
    for (const item of items) {
      const el = document.createElement('a');
      el.className = 'toc-item';
      el.textContent = item.title;
      el.style.paddingLeft = (20 + depth * 12) + 'px';
      el.href = '#';
      el.onclick = async e => {
        e.preventDefault();
        try {
          const dest = await pdf.getDestination(item.dest);
          if (dest) {
            const ref = dest[0];
            const pageNum = await pdf.getPageIndex(ref) + 1;
            scrollToPdfPage(pageNum);
          }
        } catch(err) {}
        document.querySelectorAll('.toc-item').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        if (window.innerWidth <= 640) closeSidebarMobile();
      };
      list.appendChild(el);
      if (item.items && item.items.length) await addItems(item.items, depth + 1);
    }
  }
  addItems(outline);
}

function scrollToPdfPage(num) {
  const el = $('pdf-p-' + num);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  state.pdfCurrentPage = num;
  $('pdf-page-input').value = num;
  updatePdfProgress();
}

function setupPdfControls() {
  $('pdf-prev').onclick = () => {
    if (state.pdfCurrentPage > 1) scrollToPdfPage(state.pdfCurrentPage - 1);
  };
  $('pdf-next').onclick = () => {
    if (state.pdfCurrentPage < state.pdfTotalPages) scrollToPdfPage(state.pdfCurrentPage + 1);
  };
  $('pdf-page-input').onchange = e => {
    const v = parseInt(e.target.value);
    if (v >= 1 && v <= state.pdfTotalPages) scrollToPdfPage(v);
  };

  let pdfZoomLevel = 1.0;
  $('pdf-zoom-in').onclick = async () => {
    pdfZoomLevel = Math.min(3, pdfZoomLevel + 0.25);
    state.pdfZoom = pdfZoomLevel;
    $('pdf-zoom-val').textContent = Math.round(pdfZoomLevel * 100) + '%';
    await rerenderAllPdf();
  };
  $('pdf-zoom-out').onclick = async () => {
    pdfZoomLevel = Math.max(0.5, pdfZoomLevel - 0.25);
    state.pdfZoom = pdfZoomLevel;
    $('pdf-zoom-val').textContent = Math.round(pdfZoomLevel * 100) + '%';
    await rerenderAllPdf();
  };

  // Track current page via scroll
  const scrollArea = $('pdf-scroll-area');
  scrollArea.addEventListener('scroll', () => {
    const pages = document.querySelectorAll('.pdf-page-wrap');
    let closest = 1;
    let minDist = Infinity;
    pages.forEach(el => {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top);
      if (dist < minDist) {
        minDist = dist;
        closest = parseInt(el.id.replace('pdf-p-', ''));
      }
    });
    state.pdfCurrentPage = closest;
    $('pdf-page-input').value = closest;
    updatePdfProgress();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (state.pdfCurrentPage > 1) scrollToPdfPage(state.pdfCurrentPage - 1);
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (state.pdfCurrentPage < state.pdfTotalPages) scrollToPdfPage(state.pdfCurrentPage + 1);
    }
  });
}

function updatePdfProgress() {
  const pct = (state.pdfCurrentPage / state.pdfTotalPages) * 100;
  setProgress(pct);
}

// â”€â”€ THEME & FONT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  localStorage.setItem('reader_theme', theme);
  if (state.epubRendition) applyEpubTheme();
}

function applyFontSize(size) {
  state.fontSize = size;
  $('font-size-val').textContent = size;
  localStorage.setItem('reader_fontsize', size);
  if (state.epubRendition) applyEpubTheme();
}

// â”€â”€ SIDEBAR & CONTROLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function closeSidebarMobile() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('show');
}

$('btn-sidebar').onclick = () => {
  if (window.innerWidth <= 640) {
    $('sidebar').classList.toggle('open');
    $('sidebar-overlay').classList.toggle('show');
  } else {
    $('sidebar').classList.toggle('collapsed');
  }
};
$('sidebar-overlay').onclick = closeSidebarMobile;

$('btn-fullscreen').onclick = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
};
document.addEventListener('keydown', e => {
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }
  if (e.key === 'Escape') $('settings-dropdown').classList.remove('open');
});

$('btn-settings').onclick = e => {
  e.stopPropagation();
  $('settings-dropdown').classList.toggle('open');
};
document.onclick = () => $('settings-dropdown').classList.remove('open');
$('settings-dropdown').onclick = e => e.stopPropagation();

$('font-inc').onclick = () => applyFontSize(Math.min(28, state.fontSize + 1));
$('font-dec').onclick = () => applyFontSize(Math.max(10, state.fontSize - 1));

document.querySelectorAll('.theme-btn').forEach(b => {
  b.onclick = () => applyTheme(b.dataset.theme);
});

// â”€â”€ RESTORE PREFERENCES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const savedTheme = localStorage.getItem('reader_theme') || 'light';
const savedFont  = parseInt(localStorage.getItem('reader_fontsize')) || 16;
applyTheme(savedTheme);
applyFontSize(savedFont);

// â”€â”€ MAIN INIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) {
      showError(
        'Thiáº¿u tham sá»‘ ?id=',
        'Truy cáº­p: read.html?id=your-book-id\nVÃ­ dá»¥: read.html?id=demo-epub'
      );
      return;
    }
    state.bookId = id;

    const links = await loadLinkJson();
    const meta = links[id];
    if (!meta) {
      showError(
        `KhÃ´ng tÃ¬m tháº¥y sÃ¡ch "${id}"`,
        `CÃ¡c ID cÃ³ sáºµn: ${Object.keys(links).join(', ')}`
      );
      return;
    }

    setLoading(20, 'book found: ' + id);
    applyMeta(meta);

    const type = (meta.type || '').toLowerCase() ||
                 (meta.url.endsWith('.epub') ? 'epub' : 'pdf');
    state.type = type;

    if (type === 'epub') {
      await loadEpub(meta.url);
    } else if (type === 'pdf') {
      await loadPdf(meta.url);
    } else {
      showError('Äá»‹nh dáº¡ng khÃ´ng há»— trá»£: ' + type, 'Chá»‰ há»— trá»£ epub vÃ  pdf');
    }
  } catch(err) {
    console.error(err);
    showError('Lá»—i khi táº£i sÃ¡ch', err.message || String(err));
  }
})();

