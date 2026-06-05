const manifestUrl = './data/manifest.json';

const state = {
  categories: [],
  books: [],
  filtered: [],
  activeCategory: 'all',
  query: '',
  currentPage: 1,
  pageSize: 12
};

const els = {};

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function initElements() {
  els.searchForm = $('searchForm');
  els.searchInput = $('searchInput');
  els.categoryMenu = $('categoryMenu');
  els.sidebarCategories = $('sidebarCategories');
  els.statusLine = $('statusLine');
  els.bookList = $('bookList');
  els.pagination = $('pagination');
  els.emptyState = $('emptyState');
  els.bookDialog = $('bookDialog');
  els.dialogBody = $('dialogBody');
  els.dialogClose = els.bookDialog.querySelector('.dialog-close');
}

function normalizeText(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .toLowerCase()
    .trim();
}

function tokenize(value) {
  return normalizeText(value).split(/[\s,.;:!?/()\-_[\]{}"'+=*&^%$#@~`|<>]+/g).filter(Boolean);
}

function escapeXml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveCoverUrl(url = '', title = '', category = '') {
  const value = String(url || '').trim();
  if (!value) return fallbackCover(title, category);

  const directImage = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(value) || value.startsWith('data:image/');
  if (directImage) return value;

  const driveMatch = value.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([a-zA-Z0-9_-]+)/i);
  if (driveMatch) {
    return `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w1000`;
  }

  return value;
}

function slugify(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function searchIndex(book) {
  return normalizeText(
    [
      book.name,
      book.tacgia,
      book.mieuta,
      book.theloai,
      ...(book.tags || []),
      ...(book.formats || []).map((item) => item.type),
      ...(book.formats || []).map((item) => item.label)
    ].join(' ')
  );
}

function scoreBook(book, queryTokens) {
  if (!queryTokens.length) return 1;
  const haystack = book.__searchText;
  let score = 0;

  for (const token of queryTokens) {
    if (!haystack.includes(token)) return 0;
    if (normalizeText(book.name).includes(token)) score += 40;
    else if (normalizeText(book.tacgia).includes(token)) score += 20;
    else if (normalizeText(book.theloai).includes(token)) score += 14;
    else if (normalizeText(book.mieuta).includes(token)) score += 8;
    else score += 4;
  }

  if (normalizeText(book.name).includes(queryTokens.join(' '))) score += 35;
  return score;
}

function formatLabel(formatType) {
  const mapping = {
    pdf: 'PDF',
    epub: 'EPUB',
    mobi: 'MOBI',
    azw3: 'AZW3',
    mp3: 'MP3',
    mp4: 'MP4',
    doconline: 'DOC ONLINE',
    online: 'ONLINE'
  };
  return mapping[formatType.toLowerCase()] || formatType.toUpperCase();
}

function fallbackCover(title, category) {
  const combined = `${title}|${category}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i += 1) {
    hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 30) % 360;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 340">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="hsl(${hue}, 70%, 62%)"/>
          <stop offset="100%" stop-color="hsl(${hue2}, 72%, 46%)"/>
        </linearGradient>
      </defs>
      <rect width="240" height="340" rx="6" fill="url(#g)"/>
      <rect x="18" y="18" width="204" height="304" rx="4" fill="rgba(255,255,255,0.08)"/>
      <text x="120" y="125" text-anchor="middle" fill="#fff" font-family="Tahoma, Arial, sans-serif" font-size="22" font-weight="700">${escapeXml(title.slice(0, 24))}</text>
      <text x="120" y="165" text-anchor="middle" fill="rgba(255,255,255,.9)" font-family="Tahoma, Arial, sans-serif" font-size="12">${escapeXml(category)}</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${url}`);
  return response.json();
}

async function loadData() {
  const manifest = await loadJson(manifestUrl);
  state.categories = manifest.categories || [];
  const results = await Promise.all(
    state.categories.map(async (category) => {
      const payload = await loadJson(`./data/${category.file}`);
      return { category, items: payload.items || [] };
    })
  );

  state.books = results.flatMap(({ category, items }) =>
    items.map((item) => ({
      ...item,
      categoryId: category.id,
      categoryName: category.name,
      __searchText: searchIndex(item)
    }))
  );
}

function renderCategoryMenu() {
  const items = [
    { id: 'all', name: 'Tất cả' },
    ...state.categories
  ];

  els.categoryMenu.innerHTML = items
    .map(
      (item) =>
        `<a href="#" data-category="${item.id}" class="${item.id === state.activeCategory ? 'active' : ''}">${escapeXml(item.name)}</a>`
    )
    .join('');

  els.sidebarCategories.innerHTML = items
    .map(
      (item) =>
        `<a href="#" data-category="${item.id}" class="cat-item ${item.id === state.activeCategory ? 'active' : ''}">
          <span class="cat-icon">◎</span>
          <span class="cat-name">${escapeXml(item.name)}</span>
          <span class="cat-count">${item.id === 'all'
            ? state.books.length
            : state.books.filter((book) => book.categoryId === item.id).length}</span>
        </a>`
    )
    .join('');

  const bind = (root) => {
    root.querySelectorAll('[data-category]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        state.activeCategory = el.dataset.category;
        renderAll();
      });
    });
  };

  bind(els.categoryMenu);
  bind(els.sidebarCategories);
}

function filterBooks() {
  const queryTokens = tokenize(state.query);
  const pool =
    state.activeCategory === 'all'
      ? state.books
      : state.books.filter((book) => book.categoryId === state.activeCategory);

  const ranked = pool
    .map((book) => ({
      book,
      score: scoreBook(book, queryTokens)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.book.name.localeCompare(b.book.name));

  state.filtered = ranked.map((item) => item.book);
}

function getTotalPages() {
  return Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
}

function getPageBooks() {
  const totalPages = getTotalPages();
  state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);
  const start = (state.currentPage - 1) * state.pageSize;
  return state.filtered.slice(start, start + state.pageSize);
}

function renderBook(book) {
  const cover = resolveCoverUrl(book.anhbia, book.name, book.theloai);

  return `
    <article class="book-item" data-book-id="${escapeXml(book.id)}" data-open-book="${escapeXml(book.id)}">
      <div class="book-cover">
        <img src="${cover}" alt="${escapeXml(book.name)}" loading="lazy" data-fallback="${fallbackCover(book.name, book.theloai)}" onerror="if(!this.dataset.fallbackApplied){this.dataset.fallbackApplied='1';this.src=this.dataset.fallback;}">
      </div>
      <h3 class="book-title">${escapeXml(book.name)}</h3>
    </article>
  `;
}

function renderBooks() {
  const pageBooks = getPageBooks();
  els.bookList.innerHTML = pageBooks.map(renderBook).join('');
  els.emptyState.hidden = state.filtered.length > 0;

  els.bookList.querySelectorAll('[data-open-book]').forEach((item) => {
    item.addEventListener('click', () => {
      const book = state.filtered.find((entry) => entry.id === item.dataset.openBook);
      if (book) openDialog(book);
    });
  });
}

function renderPagination() {
  const totalPages = getTotalPages();

  if (!state.filtered.length || totalPages <= 1) {
    els.pagination.innerHTML = '';
    return;
  }

  const items = [];
  const current = state.currentPage;
  const addButton = (page, label = String(page), active = false) => {
    items.push(`
      <button class="page-btn ${active ? 'active' : ''}" data-page="${page}">${label}</button>
    `);
  };
  const addGap = () => {
    items.push(`<span class="page-gap">...</span>`);
  };

  const renderStartWindow = () => {
    const end = Math.min(totalPages - 1, 5);
    for (let page = 1; page <= end; page += 1) {
      addButton(page, String(page), current === page);
    }
    if (totalPages > 1) {
      if (totalPages > 6) addGap();
      addButton(totalPages, 'Last', current === totalPages);
    }
  };

  const renderMiddleWindow = () => {
    addButton(1, '1', current === 1);
    addGap();
    addButton(current - 1, String(current - 1), current === current - 1);
    addButton(current, String(current), true);
    addButton(current + 1, String(current + 1), current === current + 1);
    addGap();
    addButton(totalPages, 'Last', current === totalPages);
  };

  const renderEndWindow = () => {
    addButton(1, '1', current === 1);
    addGap();
    const start = Math.max(2, totalPages - 4);
    for (let page = start; page <= totalPages - 1; page += 1) {
      addButton(page, String(page), current === page);
    }
    addButton(totalPages, 'Last', current === totalPages);
  };

  if (totalPages <= 7) {
    addButton(1, '1', current === 1);
    for (let page = 2; page < totalPages; page += 1) {
      addButton(page, String(page), current === page);
    }
    if (totalPages > 1) {
      addButton(totalPages, 'Last', current === totalPages);
    }
  } else if (current <= 4) {
    renderStartWindow();
  } else if (current >= totalPages - 3) {
    renderEndWindow();
  } else {
    renderMiddleWindow();
  }

  if (current < totalPages) {
    items.push(`<button class="page-btn next" data-page="${current + 1}">»</button>`);
  }

  els.pagination.innerHTML = items.join('');
  els.pagination.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentPage = Number(button.dataset.page);
      renderAll();
    });
  });
}

function openDialog(book) {
  const cover = resolveCoverUrl(book.anhbia, book.name, book.theloai);
  const links = (book.formats || [])
    .map(
      (format) =>
        `<a class="format-btn format-${slugify(format.type)}" href="${format.url}" target="_blank" rel="noreferrer">${escapeXml(formatLabel(format.type))}</a>`
    )
    .join('');

  els.dialogBody.innerHTML = `
    <div class="dialog-grid">
      <div class="dialog-cover">
        <img src="${cover}" alt="${escapeXml(book.name)}" loading="lazy" data-fallback="${fallbackCover(book.name, book.theloai)}" onerror="if(!this.dataset.fallbackApplied){this.dataset.fallbackApplied='1';this.src=this.dataset.fallback;}">
      </div>
      <div class="dialog-info">
        <h3>${escapeXml(book.name)}</h3>
        <div class="dialog-meta"><strong>Tác giả:</strong> ${escapeXml(book.tacgia || 'Chưa rõ')}</div>
        <div class="dialog-meta"><strong>Thể loại:</strong> ${escapeXml(book.theloai || '')}</div>
        <div class="dialog-alert">Vui lòng chọn định dạng file để tải hoặc đọc online.</div>
        <div class="format-row">${links}</div>
        <div class="dialog-description">
          <h4>Mô tả</h4>
          <p class="dialog-desc">${escapeXml(book.mieuta || 'Chưa có mô tả cho cuốn sách này.')}</p>
        </div>
      </div>
    </div>
  `;

  els.bookDialog.showModal();
}

function renderStatus() {
  const total = state.filtered.length;
  const activeName =
    state.activeCategory === 'all'
      ? 'Tất cả'
      : state.categories.find((category) => category.id === state.activeCategory)?.name || 'Tất cả';

  els.statusLine.textContent = state.query
    ? `Đang tìm kiếm "${state.query}" trong ${activeName.toLowerCase()}`
    : `Đang hiển thị ${activeName.toLowerCase()}`;

  els.emptyState.hidden = total > 0;
  const totalPages = getTotalPages();
  if (total > 0) {
    els.statusLine.textContent += ` | Trang ${state.currentPage}/${totalPages}`;
  }
}

function renderAll() {
  filterBooks();
  renderCategoryMenu();
  renderBooks();
  renderPagination();
  renderStatus();
}

function wireEvents() {
  els.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.query = els.searchInput.value.trim();
    state.currentPage = 1;
    renderAll();
  });

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value.trim();
    state.currentPage = 1;
    renderAll();
  });

  els.dialogClose.addEventListener('click', () => {
    els.bookDialog.close();
  });

  els.bookDialog.addEventListener('click', (event) => {
    const rect = els.bookDialog.querySelector('.dialog-card').getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (outside) {
      els.bookDialog.close();
    }
  });
}

async function init() {
  try {
    initElements();
    wireEvents();
    await loadData();
    renderAll();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `
      <div style="padding:24px;font-family:Tahoma,Arial,sans-serif;">
        <h1>Lỗi khởi tạo</h1>
        <p>${escapeXml(error.message)}</p>
      </div>`;
  }
}

init();
