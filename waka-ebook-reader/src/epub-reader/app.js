// js/app.js
// Toàn bộ logic của EPUB Reader Offline.

(() => {
  "use strict";

  /* ---------------------------------------------------------- constants */

  const FONT_STACKS = {
    serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    dyslexic: 'Verdana, Tahoma, "Trebuchet MS", sans-serif',
    bookerly: '"Bookerly", Georgia, "Iowan Old Style", serif',
    minion: '"Minion Pro", "Palatino Linotype", Palatino, Georgia, serif',
    notoserif: '"Noto Serif", Georgia, serif',
    roboto: 'Roboto, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  };

  const THEMES = {
    light: { bg: "#faf7f0", fg: "#2b2b28", link: "#9a5a35", dim: "#8a8378" },
    white: { bg: "#ffffff", fg: "#1a1a1a", link: "#1a5fb4", dim: "#777777" },
    gray:  { bg: "#e8e8e8", fg: "#2b2b28", link: "#8a4a26", dim: "#6f6f6f" },
    sepia: { bg: "#f1e7d0", fg: "#4b3621", link: "#8a4a26", dim: "#8c7858" },
    dark: { bg: "#1b1f24", fg: "#d8dee5", link: "#e3935f", dim: "#7c8893" },
  };

  const WALLPAPER_BASE =
    globalThis.chrome && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL("assets/wallpagers/")
      : "../assets/wallpagers/";

  const BG_IMAGES = {
    "starry-night": {
      base: "dark",
      image: `radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,.9) 0, transparent 60%),
              radial-gradient(1px 1px at 70% 15%, rgba(255,255,255,.7) 0, transparent 60%),
              radial-gradient(1.5px 1.5px at 45% 60%, rgba(255,255,255,.8) 0, transparent 60%),
              radial-gradient(1px 1px at 85% 75%, rgba(255,255,255,.6) 0, transparent 60%),
              radial-gradient(1px 1px at 10% 85%, rgba(255,255,255,.5) 0, transparent 60%),
              linear-gradient(160deg, #0b1226 0%, #17244a 100%)`,
    },
    "warm-paper": {
      base: "sepia",
      image: `repeating-linear-gradient(0deg, rgba(0,0,0,.015) 0 2px, transparent 2px 4px),
              radial-gradient(120% 90% at 15% 0%, rgba(255,255,255,.25), transparent 60%),
              linear-gradient(180deg, #f6e9c9 0%, #eeddb3 100%)`,
    },
    black: {
      base: "dark",
      image: `url("${WALLPAPER_BASE}black-bg.jpg") center center / cover fixed no-repeat`,
    },
    blue: {
      base: "dark",
      image: `url("${WALLPAPER_BASE}blue-bg.jpg") center center / cover fixed no-repeat`,
    },
    green: {
      base: "dark",
      image: `url("${WALLPAPER_BASE}green-bg.jpg") center center / cover fixed no-repeat`,
    },
    green2: {
      base: "dark",
      image: `url("${WALLPAPER_BASE}green2-bg.jpg") center center / cover fixed no-repeat`,
    },
    white: {
      base: "white",
      image: `url("${WALLPAPER_BASE}white-bg.jpg") center center / cover fixed no-repeat`,
    },
  };

  const MIME_BY_EXT = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    svg: "image/svg+xml", webp: "image/webp",
    css: "text/css",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    xhtml: "application/xhtml+xml", html: "text/html", xml: "application/xml",
    ncx: "application/x-dtbncx+xml",
  };

  const SETTINGS_KEY = "reader-settings";
  // fontFamily rỗng ("") = dùng đúng font gốc của EPUB (không ghi đè font-family).
  // Chỉ khi người dùng chủ động chọn "serif"/"sans"/"dyslexic" hoặc gõ tên 1 font khác
  // thì mới ghi đè — xem resolveFontFamilyCss() và buildSrcDoc().
  const DEFAULT_SETTINGS = {
    fontSize: 19,
    fontFamily: "",
    theme: "light",
    bgImage: "",
    bgImageOpacity: 0.5,
    mode: "paginated",
    columns: 2,
    lineHeight: 1.75,
    fontWeight: 400,
    zoom: 1,
    accent: "#c17a4f",
    selectTextEnabled: true,
  };

  const clamp = (v, lo, hi, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
  };

  /* ---------------------------------------------------------- state */

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    book: null, // { id, fileName, title, creator, zip, epub, fullPathMime, blobUrls, chapterCache, record }
    spineIndex: 0,
    page: 0,
    scrollFraction: 0,
    totalPages: 1,
    sidebarOpen: false,
    activeTab: "toc",
    selectMode: false,
    selectedIds: new Set(),
    infoModalRecord: null,
    // ---- nhiều sách mở cùng lúc, mỗi cuốn một tab (không đóng tab hiện tại khi
    // mở cuốn khác) ----
    // Mỗi phần tử: { id, book, spineIndex, page, scrollFraction }. `book` có cùng
    // hình dạng với state.book ở trên; state.book luôn là con trỏ trỏ tới
    // tab.book của tab đang active (activeTabId) — xem activateTab()/snapshotActiveTab().
    tabs: [],
    activeTabId: null,
  };

  /* ---------------------------------------------------------- dom refs */

  const $ = (sel) => document.querySelector(sel);
  const el = {
    libraryView: $("#library-view"),
    readerView: $("#reader-view"),
    fileInput: $("#file-input"),
    btnOpenFile: $("#btn-open-file"),
    dropzone: $("#dropzone"),
    libraryGrid: $("#library-grid"),
    libEmptyHint: $("#lib-empty-hint"),

    btnSelectMode: $("#btn-select-mode"),
    btnSelectCancel: $("#btn-select-cancel"),
    bulkBar: $("#bulk-bar"),
    bulkCount: $("#bulk-count"),
    btnBulkDelete: $("#btn-bulk-delete"),

    bookInfoModal: $("#book-info-modal"),
    biClose: $("#bi-close"),
    biBackdrop: $("#bi-backdrop"),
    biCover: $("#bi-cover"),
    biTitle: $("#bi-title"),
    biCreator: $("#bi-creator"),
    biProgress: $("#bi-progress"),
    biMeta: $("#bi-meta"),
    biMetaHeading: $("#bi-meta-heading"),
    biDescription: $("#bi-description"),
    biTags: $("#bi-tags"),
    biDelete: $("#bi-delete"),
    biExport: $("#bi-export"),
    biRead: $("#bi-read"),

    btnBackLibrary: $("#btn-back-library"),
    btnToggleSidebar: $("#btn-toggle-sidebar"),
    readerTitle: $("#reader-book-title"),
    rdTabsExtra: $("#rd-tabs-extra"),

    btnSearchToggle: $("#btn-search-toggle"),
    searchInput: $("#search-input"),
    searchResults: $("#search-results"),

    btnFontDec: $("#btn-font-dec"),
    btnFontInc: $("#btn-font-inc"),
    selectFontFamily: $("#select-font-family"),
    themeDots: Array.from(document.querySelectorAll(".theme-dot")),
    btnMode: $("#btn-mode"),
    btnBookmark: $("#btn-bookmark"),

    sidebar: $("#sidebar"),
    sidebarTabs: Array.from(document.querySelectorAll(".sidebar-tab")),
    tocPanel: $("#toc-panel"),
    tocList: $("#toc-list"),
    bookmarksPanel: $("#bookmarks-panel"),
    bookmarkList: $("#bookmark-list"),
    bookmarkEmpty: $("#bookmark-empty"),

    btnPrev: $("#btn-prev"),
    btnNext: $("#btn-next"),
    bookFrame: $("#book-frame"),

    progressTrack: $("#progress-track"),
    progressFill: $("#progress-fill"),
    chapterLabel: $("#chapter-label"),
    progressPercent: $("#progress-percent"),

    loadingOverlay: $("#loading-overlay"),
    loadingText: $("#loading-text"),
    toast: $("#toast"),
  };

  /* ---------------------------------------------------------- utils */

  function show(elm) { elm.classList.remove("hidden"); }
  function hide(elm) { elm.classList.add("hidden"); }

  function toast(msg, isError = false) {
    el.toast.textContent = msg;
    el.toast.classList.toggle("error", isError);
    show(el.toast);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => hide(el.toast), 3200);
  }

  function loading(on, msg) {
    if (on) { el.loadingText.textContent = msg || "Đang xử lý…"; show(el.loadingOverlay); }
    else hide(el.loadingOverlay);
  }

  let screenWakeLock = null;
  let wakeLockWanted = false;
  let wakeLockRequesting = false;

  function isMobileReadingTarget() {
    return document.documentElement.classList.contains("mobile-reader-forced")
      || window.matchMedia("(max-width: 760px)").matches
      || window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  }

  function isReaderVisible() {
    return !!state.book && !!state.activeTabId && el.readerView && !el.readerView.classList.contains("hidden");
  }

  async function acquireScreenWakeLock() {
    if (!wakeLockWanted || !isReaderVisible() || document.visibilityState !== "visible") return;
    if (!isMobileReadingTarget() || !navigator.wakeLock?.request || screenWakeLock || wakeLockRequesting) return;
    wakeLockRequesting = true;
    try {
      screenWakeLock = await navigator.wakeLock.request("screen");
      screenWakeLock.addEventListener("release", () => {
        screenWakeLock = null;
      });
      if (!wakeLockWanted || !isReaderVisible() || document.visibilityState !== "visible") {
        await releaseScreenWakeLock();
        return;
      }
      console.log("[Reader WakeLock] Screen wake lock enabled");
    } catch (err) {
      screenWakeLock = null;
      console.warn("[Reader WakeLock] Cannot keep screen awake", err);
    } finally {
      wakeLockRequesting = false;
    }
  }

  async function releaseScreenWakeLock() {
    const lock = screenWakeLock;
    screenWakeLock = null;
    if (!lock) return;
    try {
      await lock.release();
    } catch (err) {
      console.warn("[Reader WakeLock] Cannot release screen wake lock", err);
    }
  }

  function startReadingWakeLock() {
    wakeLockWanted = true;
    acquireScreenWakeLock();
  }

  function stopReadingWakeLock() {
    wakeLockWanted = false;
    releaseScreenWakeLock();
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function extOf(path) {
    const m = /\.([a-z0-9]+)$/i.exec(path);
    return m ? m[1].toLowerCase() : "";
  }

  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get([SETTINGS_KEY], (res) => {
        state.settings = { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] || {}) };
        // chuẩn hoá giá trị
        state.settings.columns = Number(state.settings.columns) === 2 ? 2 : 1;
        state.settings.lineHeight = clamp(state.settings.lineHeight, 1.1, 2.6, 1.75);
        state.settings.fontWeight = clamp(state.settings.fontWeight, 200, 900, 400);
        state.settings.zoom = clamp(state.settings.zoom, 0.6, 2.5, 1);
        state.settings.fontSize = clamp(state.settings.fontSize, 12, 40, 19);
        if (!/^#[0-9a-f]{3,8}$/i.test(state.settings.accent || "")) state.settings.accent = "#c17a4f";
        if (!THEMES[state.settings.theme]) state.settings.theme = "light";
        if (!BG_IMAGES[state.settings.bgImage]) state.settings.bgImage = "";
        state.settings.bgImageOpacity = clamp(state.settings.bgImageOpacity, 0, 1, 0.5);
        if (state.settings.mode !== "paginated") state.settings.mode = "scroll";
        state.settings.selectTextEnabled = state.settings.selectTextEnabled !== false;
        // lần đầu chạy bản 6.4: chuyển sang lật trang 2 cột cho giống bố cục mới
        if (!state.settings.layoutMigrated) {
          state.settings.mode = "paginated";
          state.settings.columns = 2;
          state.settings.layoutMigrated = true;
          chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
        }
        // Di trú 1 lần: bản cũ luôn ép font-family="serif" (Georgia) làm mặc định,
        // đè lên font gốc nhúng trong EPUB. Nếu chưa từng chạy di trú này và giá trị
        // đang lưu đúng bằng mặc định cũ "serif" (nhiều khả năng người dùng chưa từng
        // chủ động chọn font), đưa về "" (dùng font gốc EPUB) theo đúng thiết kế mới.
        // Nếu người dùng đã gõ tên font khác thì giá trị đó không phải "serif" nên
        // không bị đụng tới.
        if (!state.settings.fontFamilyMigratedV2) {
          if (state.settings.fontFamily === "serif") state.settings.fontFamily = "";
          state.settings.fontFamilyMigratedV2 = true;
          chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
        }
        resolve();
      });
    });
  }

  function saveSettings() {
    chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
  }

  /* ---------------------------------------------------------- library view */

  // ── 6.9.0 · thư viện mobile ─────────────────────────────────────────────────
  // true  = ở mobile mode, chạm vào thẻ sách sẽ MỞ SÁCH luôn (giống Readest);
  //         muốn xem thông tin thì bấm nút (i) trên thẻ.
  // false = giữ hành vi cũ (chạm thẻ → hiện "Thông tin sách" trước).
  const MOBILE_TAP_OPENS_BOOK = true;

  /** Đang ở bố cục thư viện mobile? (toolbar mobile chỉ hiển thị trong mobile mode / forced mobile mode) */
  function isLibraryMobileLayout() {
    const tb = document.getElementById("lib-mtoolbar");
    return !!tb && getComputedStyle(tb).display !== "none";
  }

  // URL bìa được tạo lại ở mỗi lần vẽ thư viện → thu hồi ở lần vẽ kế tiếp (trước đây bị rò rỉ bộ nhớ).
  const coverUrlPool = new Set();
  function coverUrl(blob) {
    const url = URL.createObjectURL(blob);
    coverUrlPool.add(url);
    return url;
  }
  function releaseCoverUrls() {
    coverUrlPool.forEach((u) => URL.revokeObjectURL(u));
    coverUrlPool.clear();
  }

  /** Dịch nhanh khoá i18n, có chuỗi dự phòng khi từ điển chưa nạp. */
  function lt(key, fallback) {
    try { const v = window.I18n ? window.I18n.t(key) : key; return v === key ? fallback : v; }
    catch (e) { return fallback; }
  }

  /** Bỏ thẻ HTML trong mô tả sách (dc:description hay chứa <p>…</p>) và cắt ngắn. */
  function plainText(html, max) {
    const t = String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max) : t;
  }

  const ICON_INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r=".7" fill="currentColor" stroke="none"/></svg>';
  const ICON_CLOUD_DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 18.5H7a4.25 4.25 0 0 1-.6-8.46A6 6 0 0 1 18 9.2a4.7 4.7 0 0 1-.5 9.3z"/><path d="M12 10.8v5.7m0 0-2.4-2.4m2.4 2.4 2.4-2.4"/></svg>';

  function bookCardHtml(record) {
    const progress = estimateProgressPercent(record);
    const title = record.title || "Không tên";
    const author = record.creator || "";
    const hasCover = !!record.coverBlob;
    const selected = state.selectedIds.has(record.id);
    const fileName = record.fileName || "";
    const searchKey = `${record.title || ""} ${record.creator || ""} ${fileName}`.toLowerCase();
    // luôn có sẵn "bìa chữ" (.book-cover-fallback): CSS chỉ hiện nó khi sách không có ảnh bìa hoặc khi bật "Ẩn bìa"
    const coverHtml =
      (hasCover ? `<img src="${coverUrl(record.coverBlob)}" alt="" loading="lazy" decoding="async" draggable="false">` : "") +
      `<div class="book-cover-fallback"><span class="bcf-title">${escapeHtml(title)}</span>` +
      (author ? `<span class="bcf-author">${escapeHtml(author)}</span>` : "") + `</div>`;
    return `
      <div class="book-card${state.selectMode ? " selectable" : ""}${selected ? " selected" : ""}"
           data-id="${record.id}"
           data-filename="${escapeHtml(fileName)}"
           data-search="${escapeHtml(searchKey)}">
        <button class="book-select" data-action="select" title="Chọn">
          <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
        </button>
        <button class="book-delete" data-action="delete" title="Xoá khỏi thư viện">✕</button>
        <div class="book-cover${hasCover ? " has-img" : ""}">
          ${coverHtml}
          <span class="book-progress-ring">${progress}%</span>
        </div>
        <p class="book-file" title="${escapeHtml(fileName || record.title || "")}">${escapeHtml(fileName || record.title || "Không tên")}</p>
        <p class="book-title">${escapeHtml(title)}</p>
        <p class="book-author">${escapeHtml(author)}</p>
        <p class="book-desc">${escapeHtml(plainText(record.description, 240))}</p>
        <div class="book-meta">
          <span class="book-pct">${progress}%</span>
          <span class="book-actions">
            <button type="button" class="book-act" data-action="info" title="${escapeHtml(lt("lib.details", "Chi tiết sách"))}" aria-label="${escapeHtml(lt("lib.details", "Chi tiết sách"))}">${ICON_INFO}</button>
            <button type="button" class="book-act" data-action="export" title="${escapeHtml(lt("lib.exportBook", "Tải file .epub về máy"))}" aria-label="${escapeHtml(lt("lib.exportBook", "Tải file .epub về máy"))}">${ICON_CLOUD_DL}</button>
          </span>
        </div>
      </div>`;
  }

  function estimateProgressPercent(record) {
    if (!record.position || !record.spineCount) return 0;
    const within = record.position.scrollFraction || 0;
    const frac = (record.position.spineIndex + within) / record.spineCount;
    return Math.min(99, Math.max(1, Math.round(frac * 100)));
  }

  async function renderLibrary() {
    let books = await BookDB.listBooks();
    if (window.LibraryUI && window.LibraryUI.sortBooks) books = window.LibraryUI.sortBooks(books);  // 6.9.0: sắp xếp theo menu Hiển thị
    releaseCoverUrls();                                                                            // 6.9.0: thu hồi URL bìa của lần vẽ trước
    el.libEmptyHint.classList.toggle("hidden", books.length > 0);
    el.libraryGrid.innerHTML = books.map(bookCardHtml).join("");
    updateBulkBar();
    document.dispatchEvent(new CustomEvent("library:rendered", { detail: { count: books.length, books } }));
  }

  /* -------- chế độ chọn nhiều / xoá hàng loạt -------- */

  function enterSelectMode() {
    state.selectMode = true;
    state.selectedIds.clear();
    el.btnSelectMode.classList.add("hidden");
    show(el.bulkBar);
    renderLibrary();
  }

  function exitSelectMode() {
    state.selectMode = false;
    state.selectedIds.clear();
    el.btnSelectMode.classList.remove("hidden");
    hide(el.bulkBar);
    renderLibrary();
  }

  function updateBulkBar() {
    const n = state.selectedIds.size;
    el.bulkCount.textContent = `Đã chọn ${n} sách`;
    el.btnBulkDelete.disabled = n === 0;
  }

  el.btnSelectMode.addEventListener("click", enterSelectMode);
  el.btnSelectCancel.addEventListener("click", exitSelectMode);

  el.btnBulkDelete.addEventListener("click", async () => {
    const ids = Array.from(state.selectedIds);
    if (!ids.length) return;
    const ok = confirm(`Xoá ${ids.length} cuốn sách đã chọn khỏi thư viện? Hành động này không thể hoàn tác.`);
    if (!ok) return;
    await BookDB.deleteBooks(ids);
    toast(`Đã xoá ${ids.length} cuốn sách.`);
    exitSelectMode();
  });

  el.libraryGrid.addEventListener("click", async (e) => {
    const card = e.target.closest(".book-card");
    if (!card) return;
    const id = card.dataset.id;

    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) {
      e.stopPropagation();
      const ok = confirm("Xoá cuốn sách này khỏi thư viện? Hành động này không thể hoàn tác.");
      if (!ok) return;
      await BookDB.deleteBook(id);
      toast("Đã xoá sách khỏi thư viện.");
      renderLibrary();
      return;
    }

    // 6.9.0: nút (i) / nút tải file trên thẻ sách (chỉ hiện ở mobile mode)
    const actBtn = e.target.closest(".book-act");
    if (actBtn) {
      e.stopPropagation();
      if (state.selectMode) return;
      if (actBtn.dataset.action === "info") {
        const rec = await BookDB.getBook(id);
        if (rec) openBookInfo(rec);
      } else if (actBtn.dataset.action === "export") {
        document.dispatchEvent(new CustomEvent("library:export", { detail: { ids: [id] } }));
      }
      return;
    }

    if (state.selectMode) {
      e.stopPropagation();
      if (state.selectedIds.has(id)) state.selectedIds.delete(id);
      else state.selectedIds.add(id);
      card.classList.toggle("selected", state.selectedIds.has(id));
      updateBulkBar();
      return;
    }

    const record = await BookDB.getBook(id);
    if (!record) return;
    // 6.9.0: mobile → mở sách luôn (nút (i) trên thẻ mới mở Thông tin sách); desktop giữ nguyên
    if (MOBILE_TAP_OPENS_BOOK && isLibraryMobileLayout()) openBook(record);
    else openBookInfo(record);
  });

  if (el.btnOpenFile) el.btnOpenFile.addEventListener("click", () => el.fileInput.click());
  if (el.fileInput) {
    el.fileInput.addEventListener("change", () => {
      const files = Array.from(el.fileInput.files || []);
      if (files.length) importFiles(files);
      el.fileInput.value = "";
    });
  }

  /* -------- kéo & thả: nhận 1 hoặc nhiều file trên toàn bộ cửa sổ -------- */

  const dropOverlay = $("#drop-overlay");
  let dragDepth = 0;

  function hasFiles(e) {
    const dt = e.dataTransfer;
    if (!dt) return false;
    // bảng nhạc nền có trình xử lý kéo thả riêng
    if (e.target && e.target.closest && e.target.closest("#music-panel")) return false;
    if (dt.types) return Array.from(dt.types).includes("Files");
    return true;
  }

  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (dropOverlay) show(dropOverlay);
    if (el.dropzone) el.dropzone.classList.add("dragover");
  });

  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) endDrag();
  });

  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    endDrag();
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length) importFiles(files);
  });

  function endDrag() {
    dragDepth = 0;
    if (dropOverlay) hide(dropOverlay);
    if (el.dropzone) el.dropzone.classList.remove("dragover");
  }

  /* -------- nhập sách -------- */

  function isEpubFile(file) {
    return /\.epub$/i.test(file.name || "") || file.type === "application/epub+zip";
  }

  /**
   * Nhập một danh sách file. Nếu chỉ có đúng 1 file epub thì mở luôn,
   * nhiều file thì chỉ thêm vào thư viện.
   */
  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter(isEpubFile);
    const skipped = Array.from(fileList || []).length - files.length;
    if (!files.length) {
      toast("Không tìm thấy file .epub nào trong những gì bạn thả vào.", true);
      return;
    }

    const single = files.length === 1 && !state.book;
    let ok = 0;
    const failed = [];

    for (let i = 0; i < files.length; i++) {
      loading(true, files.length > 1 ? `Đang nhập ${i + 1}/${files.length}: ${files[i].name}` : "Đang mở sách…");
      try {
        const result = await addBookFromFile(files[i]);
        ok++;
        if (single) {
          await renderLibrary();
          loading(false);
          await openBook(result.record, { zip: result.zip, epub: result.epub });
          return;
        }
      } catch (err) {
        console.error(err);
        failed.push(files[i].name);
      }
    }

    loading(false);
    await renderLibrary();

    let msg = `Đã thêm ${ok} sách vào thư viện.`;
    if (skipped > 0) msg += ` Bỏ qua ${skipped} file không phải .epub.`;
    if (failed.length) msg += ` Lỗi: ${failed.join(", ")}`;
    toast(msg, failed.length > 0);
  }

  /** Đọc 1 file epub, lưu vào IndexedDB, trả về { record, zip, epub }. */
  async function addBookFromFile(file) {
    const buffer = await file.arrayBuffer();
    const id = await BookDB.hashBuffer(buffer);
    const zip = await ZipArchive.open(buffer);
    const epub = await parseEpub(zip, file.name);

    let coverBlob = null;
    if (epub.coverPath && zip.hasFile(epub.coverPath)) {
      const bytes = await zip.extract(epub.coverPath);
      const mime = MIME_BY_EXT[extOf(epub.coverPath)] || "image/jpeg";
      coverBlob = new Blob([bytes], { type: mime });
    }

    const record = await BookDB.saveBook({
      id, fileName: file.name, title: epub.title, creator: epub.creator, coverBlob, buffer,
      language: epub.language, publisher: epub.publisher, description: epub.description,
      rights: epub.rights, identifier: epub.identifier, pubDate: epub.pubDate, subject: epub.subject,
      spineCount: epub.spine.length,
      series: epub.series, seriesIndex: epub.seriesIndex,
    });
    record.spineCount = epub.spine.length;
    return { record, zip, epub };
  }

  /** Nhập epub từ một đường dẫn http(s) trực tiếp. */
  async function importFromUrl(rawUrl) {
    const url = String(rawUrl || "").trim();
    if (!url) { toast("Hãy dán đường dẫn file .epub.", true); return; }

    let parsed;
    try { parsed = new URL(url); } catch { toast("Đường dẫn không hợp lệ.", true); return; }
    if (!/^https?:$/.test(parsed.protocol)) { toast("Chỉ hỗ trợ đường dẫn http/https.", true); return; }

    loading(true, "Đang tải file từ đường dẫn…");
    try {
      await ensureHostPermission(parsed.origin + "/*");
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();

      let name = decodeURIComponent(parsed.pathname.split("/").pop() || "");
      const disp = res.headers.get("content-disposition") || "";
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
      if (m) name = decodeURIComponent(m[1]);
      if (!/\.epub$/i.test(name)) name = (name || "remote") + ".epub";

      const file = new File([blob], name, { type: "application/epub+zip" });
      loading(false);
      await importFiles([file]);
    } catch (err) {
      console.error(err);
      loading(false);
      toast("Không tải được file: " + err.message + " (máy chủ có thể chặn CORS)", true);
    }
  }

  /** Xin quyền truy cập host khi cần (khai báo trong optional_host_permissions). */
  function ensureHostPermission(pattern) {
    return new Promise((resolve) => {
      try {
        if (!chrome.permissions || !chrome.permissions.contains) return resolve(false);
        chrome.permissions.contains({ origins: [pattern] }, (has) => {
          if (chrome.runtime.lastError) return resolve(false);
          if (has) return resolve(true);
          chrome.permissions.request({ origins: [pattern] }, (granted) => resolve(!!granted));
        });
      } catch { resolve(false); }
    });
  }

  /* ---------------------------------------------------------- book info modal */

  const LANGUAGE_NAMES = { vi: "Tiếng Việt", en: "Tiếng Anh", fr: "Tiếng Pháp", zh: "Tiếng Trung", ja: "Tiếng Nhật", ko: "Tiếng Hàn" };

  function formatFileSize(bytes) {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let v = bytes, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function metaRow(label, value) {
    if (!value) return "";
    return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
  }

  /**
   * Đồng bộ màu #book-info-modal theo đúng ngữ cảnh nó được mở:
   * - Đang đọc sách (state.book tồn tại): ghi đè --modal-bg/--modal-fg trực tiếp lên
   *   phần tử modal theo đúng THEMES[state.settings.theme], khớp chính xác màu đang đọc
   *   (kể cả các theme trung gian như sepia/gray) thay vì chỉ 2 trạng thái sáng/tối.
   * - Đang ở thư viện (state.book null): bỏ style ghi đè, để CSS quyết định qua class
   *   .modal-light mà library-ui.js gắn song song với .lib-dark trên #library-view.
   * Style inline luôn thắng biến từ class nên 2 cơ chế không giẫm lên nhau.
   */
  function applyModalThemeForContext() {
    if (!el.bookInfoModal) return;
    if (state.book) {
      const t = themeVars();
      el.bookInfoModal.style.setProperty("--modal-bg", t.bg);
      el.bookInfoModal.style.setProperty("--modal-fg", t.fg);
    } else {
      el.bookInfoModal.style.removeProperty("--modal-bg");
      el.bookInfoModal.style.removeProperty("--modal-fg");
    }
  }

  function openBookInfo(record) {
    state.infoModalRecord = record;
    const progress = estimateProgressPercent(record);
    applyModalThemeForContext();

    el.biCover.innerHTML = record.coverBlob
      ? `<img src="${URL.createObjectURL(record.coverBlob)}" alt="">`
      : `<div class="book-cover-fallback">${escapeHtml(record.title || "Không tên")}</div>`;

    if (el.biBackdrop) {
      if (record.coverBlob) {
        el.biBackdrop.style.backgroundImage = `url(${URL.createObjectURL(record.coverBlob)})`;
        show(el.biBackdrop);
      } else {
        el.biBackdrop.style.backgroundImage = "";
        hide(el.biBackdrop);
      }
    }

    el.biTitle.textContent = record.title || "Không tên";
    el.biCreator.textContent = record.creator || "Không rõ tác giả";

    if (progress > 0) {
      el.biProgress.textContent = `Đang đọc — ${progress}%`;
      show(el.biProgress);
    } else {
      hide(el.biProgress);
    }

    const langLabel = LANGUAGE_NAMES[(record.language || "").toLowerCase().slice(0, 2)] || record.language || "";
    el.biMeta.innerHTML = [
      metaRow("Nhà xuất bản", record.publisher),
      metaRow("Năm phát hành", record.pubDate),
      metaRow("Ngôn ngữ", langLabel),
      metaRow("Mã định danh", record.identifier),
      metaRow("Bản quyền", record.rights),
      metaRow("Dung lượng", formatFileSize(record.fileSize)),
      metaRow("Số chương", record.spineCount ? String(record.spineCount) : ""),
      metaRow("Đã thêm", formatDate(record.addedAt)),
      metaRow("Đọc gần nhất", record.position ? formatDate(record.lastOpened) : ""),
    ].join("");

    if (record.description) {
      el.biDescription.textContent = record.description;
      show(el.biDescription);
    } else {
      hide(el.biDescription);
    }

    if (el.biTags) {
      const tags = (record.subject || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (tags.length) {
        el.biTags.innerHTML = tags.map((t) => `<span class="bi-tag">${escapeHtml(t)}</span>`).join("");
        show(el.biTags);
      } else {
        el.biTags.innerHTML = "";
        hide(el.biTags);
      }
    }

    const readLabel = el.biRead.querySelector("span");
    if (readLabel) readLabel.textContent = progress > 0 ? "Đọc tiếp" : "Bắt đầu đọc";
    else el.biRead.textContent = progress > 0 ? "Đọc tiếp" : "Bắt đầu đọc";
    show(el.bookInfoModal);
  }

  function closeBookInfo() {
    hide(el.bookInfoModal);
    state.infoModalRecord = null;
  }

  el.biClose.addEventListener("click", closeBookInfo);
  el.bookInfoModal.addEventListener("click", (e) => {
    if (e.target === el.bookInfoModal) closeBookInfo();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.bookInfoModal.classList.contains("hidden")) closeBookInfo();
  });

  el.biRead.addEventListener("click", () => {
    const record = state.infoModalRecord;
    if (!record) return;
    closeBookInfo();
    openBook(record);
  });

  el.biDelete.addEventListener("click", async () => {
    const record = state.infoModalRecord;
    if (!record) return;
    const ok = confirm(`Xoá "${record.title || "cuốn sách này"}" khỏi thư viện? Hành động này không thể hoàn tác.`);
    if (!ok) return;
    await BookDB.deleteBook(record.id);
    closeBookInfo();
    toast("Đã xoá sách khỏi thư viện.");
    renderLibrary();
  });

  if (el.biExport) {
    el.biExport.addEventListener("click", async () => {
      const record = state.infoModalRecord;
      if (!record || !record.buffer) {
        toast("Không tìm thấy file gốc để xuất.", true);
        return;
      }
      try {
        const blob = new Blob([record.buffer], { type: "application/epub+zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = record.fileName || ((record.title || "sach") + ".epub");
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        toast("Đã xuất file .epub.");
      } catch (err) {
        console.error(err);
        toast("Xuất file thất bại.", true);
      }
    });
  }

  /* ---------------------------------------------------------- open / close book (đa tab) */

  function findTab(id) {
    return state.tabs.find((t) => t.id === id) || null;
  }

  /** Chép trạng thái đọc hiện tại (state.spineIndex/page/scrollFraction) vào tab
   *  đang active trước khi rời khỏi nó (chuyển tab hoặc đóng), và lưu vị trí vào DB. */
  function snapshotActiveTab() {
    const tab = findTab(state.activeTabId);
    if (!tab) return;
    tab.spineIndex = state.spineIndex;
    tab.page = state.page;
    tab.scrollFraction = state.scrollFraction;
    clearTimeout(scrollPersistDebounce);
    persistPosition();
  }

  /** Vẽ lại thanh tab: mỗi cuốn sách đang mở là 1 tab, tab đang active dùng đúng
   *  phần tử tĩnh #reader-book-title/#btn-back-library sẵn có trong HTML (để
   *  không đụng tới các listener đã gắn ở reader-ui.js/features.js); các tab
   *  còn lại (chưa active) được vẽ động vào #rd-tabs-extra. */
  function renderTabStrip() {
    if (!el.rdTabsExtra) return;
    const others = state.tabs.filter((t) => t.id !== state.activeTabId);
    el.rdTabsExtra.innerHTML = others.map((t) => `
      <div class="rd-tab" data-tab-id="${escapeHtml(t.id)}" title="${escapeHtml(t.book.fileName || t.book.title || "")}">
        <svg class="rd-tab-icon" viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/></svg>
        <span class="rd-tab-name">${escapeHtml(t.book.fileName || t.book.title || "—")}</span>
        <button class="rd-tab-close" data-close-tab-id="${escapeHtml(t.id)}" title="Đóng sách" aria-label="Đóng sách">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`).join("");
  }

  if (el.rdTabsExtra) {
    el.rdTabsExtra.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-close-tab-id]");
      if (closeBtn) {
        e.stopPropagation();
        closeTab(closeBtn.dataset.closeTabId);
        return;
      }
      const tabEl = e.target.closest("[data-tab-id]");
      if (tabEl) switchToTab(tabEl.dataset.tabId);
    });
  }

  /** Chuyển sang 1 tab đã có sẵn (không tạo mới), vẽ lại vùng đọc từ trạng thái đã lưu. */
  async function switchToTab(id) {
    if (id === state.activeTabId) return;
    const tab = findTab(id);
    if (!tab) return;
    loading(true, "Đang mở sách…");
    try {
      if (state.activeTabId) snapshotActiveTab();
      await activateTab(tab);
    } finally {
      loading(false);
    }
  }

  /** Đưa 1 tab (đã có object `book` dựng sẵn) lên làm tab đang đọc + vẽ lại UI. */
  async function activateTab(tab) {
    state.book = tab.book;
    state.activeTabId = tab.id;
    state.spineIndex = tab.spineIndex;
    state.page = tab.page;
    state.scrollFraction = tab.scrollFraction;

    el.readerTitle.textContent = tab.book.title;
    renderToc(tab.book.epub.toc);
    await renderBookmarks();

    hide(el.libraryView);
    show(el.readerView);
    startReadingWakeLock();
    applyThemeAndFontUi();
    renderTabStrip();
    await renderChapter(state.spineIndex, {
      restorePage: state.page,
      restoreScrollFraction: state.scrollFraction,
    });
  }

  /**
   * Mở 1 cuốn sách. Nếu cuốn đó đã có tab đang mở sẵn (dù đang active hay không)
   * thì chuyển sang tab đó thay vì tải lại; nếu chưa, tạo tab mới — các tab khác
   * đang mở vẫn giữ nguyên, không bị đóng (đúng yêu cầu "mỗi cuốn là một tab").
   */
  async function openBook(record, preloaded) {
    const existing = findTab(record.id);
    if (existing) {
      if (existing.id === state.activeTabId) return; // đã đang đọc sẵn cuốn này
      await switchToTab(existing.id);
      return;
    }

    loading(true, "Đang chuẩn bị sách…");
    try {
      const zip = preloaded ? preloaded.zip : await ZipArchive.open(record.buffer);
      const epub = preloaded ? preloaded.epub : await parseEpub(zip, record.fileName);

      const fullPathMime = new Map();
      for (const item of epub.manifest.values()) fullPathMime.set(item.fullPath, item.mediaType);

      const book = {
        id: record.id,
        fileName: record.fileName,
        title: epub.title,
        creator: epub.creator,
        zip, epub,
        fullPathMime,
        blobUrls: new Map(),
        chapterCache: new Map(),
        record,
      };

      const pos = record.position;
      const tab = {
        id: record.id,
        book,
        spineIndex: pos && pos.spineIndex < epub.spine.length ? pos.spineIndex : 0,
        page: pos ? pos.page || 0 : 0,
        scrollFraction: pos ? pos.scrollFraction || 0 : 0,
      };

      if (state.activeTabId) snapshotActiveTab();
      state.tabs.push(tab);
      await activateTab(tab);
    } catch (err) {
      console.error(err);
      toast("Không thể mở sách: " + err.message, true);
    } finally {
      loading(false);
    }
  }

  /** Đóng 1 tab theo id (giải phóng blob URL của sách đó). Nếu là tab đang active
   *  thì chuyển sang tab kế bên (nếu còn tab nào khác) hoặc về thư viện. */
  function closeTab(id) {
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const wasActive = id === state.activeTabId;

    if (wasActive) {
      clearTimeout(scrollPersistDebounce);
      persistPosition();
    }
    for (const url of state.tabs[idx].book.blobUrls.values()) URL.revokeObjectURL(url);
    state.tabs.splice(idx, 1);

    if (!wasActive) {
      renderTabStrip();
      return;
    }

    state.book = null;
    state.activeTabId = null;
    const next = state.tabs[idx] || state.tabs[idx - 1] || state.tabs[0];
    if (next) {
      activateTab(next);
    } else {
      stopReadingWakeLock();
      hide(el.readerView);
      show(el.libraryView);
      renderLibrary();
    }
  }

  /** Đóng tab đang active — dùng cho nút X trên tab hiện tại (#btn-back-library),
   *  vẫn giữ đúng hành vi cũ khi chỉ có 1 sách (đóng xong thì về thư viện). */
  function closeBook() {
    if (state.activeTabId) closeTab(state.activeTabId);
  }

  el.btnBackLibrary.addEventListener("click", closeBook);

  /* ---------------------------------------------------------- font de-obfuscation (IDPF / Adobe) */
  // Epub có font nhúng bị bảo vệ nhẹ thường XOR N byte đầu file font, khai báo thuật
  // toán trong META-INF/encryption.xml (đã parse sẵn ở parser.js -> epub.encryptedResources).
  // Khoá tính từ unique-identifier của sách (epub.uniqueIdentifierRaw), cache theo book
  // để không phải tính lại SHA-1 cho từng file font.

  /** Xoá mọi khoảng trắng (chuẩn XML) và bỏ tiền tố "urn:uuid:" khỏi unique-identifier. */
  function normalizeIdentifierForFontKey(raw) {
    return String(raw || "").replace(/\s+/g, "").replace(/^urn:uuid:/i, "");
  }

  /** Khoá IDPF: SHA-1 (20 byte thô) của unique-identifier đã chuẩn hoá. */
  async function computeIdpfFontKey(book) {
    if (book.fontKeyIdpf !== undefined) return book.fontKeyIdpf;
    const id = normalizeIdentifierForFontKey(book.epub.uniqueIdentifierRaw || book.epub.identifier);
    if (!id) { book.fontKeyIdpf = null; return null; }
    try {
      const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(id));
      book.fontKeyIdpf = new Uint8Array(digest);
    } catch (e) {
      book.fontKeyIdpf = null;
    }
    return book.fontKeyIdpf;
  }

  /** Khoá Adobe: 16 byte thô suy từ UUID (bỏ dấu "-", parse hex). */
  function computeAdobeFontKey(book) {
    if (book.fontKeyAdobe !== undefined) return book.fontKeyAdobe;
    const hex = normalizeIdentifierForFontKey(book.epub.uniqueIdentifierRaw || book.epub.identifier).replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(hex)) { book.fontKeyAdobe = null; return null; }
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    book.fontKeyAdobe = out;
    return book.fontKeyAdobe;
  }

  /** XOR (tự nghịch đảo) N byte đầu của bytes với key, lặp vòng key nếu key ngắn hơn N. */
  function xorFirstBytes(bytes, key, n) {
    if (!key || !key.length) return bytes;
    const lim = Math.min(n, bytes.length);
    for (let i = 0; i < lim; i++) bytes[i] = bytes[i] ^ key[i % key.length];
    return bytes;
  }

  /** Giải mã bytes của 1 resource nếu nó nằm trong danh sách obfuscate của epub. */
  async function deobfuscateResourceBytes(book, fullPath, bytes) {
    const algo = book.epub.encryptedResources && book.epub.encryptedResources.get(fullPath);
    if (!algo) return bytes;
    if (algo === "idpf") {
      const key = await computeIdpfFontKey(book);
      if (key) xorFirstBytes(bytes, key, 1040);
    } else if (algo === "adobe") {
      const key = computeAdobeFontKey(book);
      if (key) xorFirstBytes(bytes, key, 1024);
    }
    return bytes;
  }

  /* ---------------------------------------------------------- resources / blob urls */

  async function getResourceBlobUrl(fullPath) {
    const book = state.book;
    if (book.blobUrls.has(fullPath)) return book.blobUrls.get(fullPath);
    if (!book.zip.hasFile(fullPath)) return null;
    let bytes = await book.zip.extract(fullPath);
    if (book.epub.encryptedResources && book.epub.encryptedResources.has(fullPath)) {
      bytes = await deobfuscateResourceBytes(book, fullPath, bytes);
    }
    const mime = book.fullPathMime.get(fullPath) || MIME_BY_EXT[extOf(fullPath)] || "application/octet-stream";
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    book.blobUrls.set(fullPath, url);
    return url;
  }

  /**
   * Viết lại mọi url(...) trong 1 khối CSS (kể cả bên trong @font-face) thành Blob URL,
   * resolve đường dẫn tương đối theo VỊ TRÍ FILE CSS (basePath), không phải theo file
   * XHTML đang hiển thị. Dựng lại chuỗi bằng chỉ số vị trí thay vì split/join theo chuỗi
   * thô, để không bị lệch khi url(...) có khoảng trắng nội bộ (ví dụ "url( a.ttf )") hay
   * ký tự đặc biệt — bản cũ dùng split/join nên những trường hợp này bị bỏ sót, không
   * viết lại được, khiến font/ảnh không load.
   */
  async function rewriteCssUrls(cssText, basePath) {
    const regex = /url\(\s*(['"]?)([^'")]*?)\1\s*\)/g;
    const matches = [];
    let m;
    while ((m = regex.exec(cssText))) {
      matches.push({ start: m.index, end: m.index + m[0].length, raw: m[2] });
    }
    if (!matches.length) return cssText;

    let out = "";
    let last = 0;
    for (const t of matches) {
      out += cssText.slice(last, t.start);
      last = t.end;
      const raw = t.raw.trim();
      if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) {
        out += cssText.slice(t.start, t.end);
        continue;
      }
      // font.woff2?v=1 / font.ttf#glyf — bỏ query string / fragment trước khi tìm
      // trong ZIP (chúng không phải 1 phần đường dẫn file thật), giữ nguyên phần còn
      // lại của rule (format(...), unicode-range, ...) vì những cái đó nằm ngoài url().
      const cleanRaw = raw.split(/[?#]/)[0];
      const full = resolvePath(basePath, cleanRaw);
      const url = await getResourceBlobUrl(full);
      out += url ? `url("${url}")` : cssText.slice(t.start, t.end);
    }
    out += cssText.slice(last);
    return out;
  }

  /* ---------------------------------------------------------- chapter loading / cache */

  async function loadChapterIntoCache(spineIndex) {
    const book = state.book;
    if (book.chapterCache.has(spineIndex)) return book.chapterCache.get(spineIndex);

    const item = book.epub.spine[spineIndex];
    const rawText = await book.zip.extractText(item.fullPath);

    let doc = new DOMParser().parseFromString(rawText, "application/xhtml+xml");
    if (doc.querySelector("parsererror")) {
      doc = new DOMParser().parseFromString(rawText, "text/html");
    }

    const bodyEl = doc.body || doc.documentElement;

    // ảnh: <img src>, <image xlink:href> (svg)
    const imgEls = Array.from(bodyEl.querySelectorAll("img[src]"));
    for (const img of imgEls) {
      const src = img.getAttribute("src");
      const full = resolvePath(item.fullPath, src);
      const url = await getResourceBlobUrl(full);
      if (url) img.setAttribute("src", url);
    }
    const svgImgEls = Array.from(bodyEl.querySelectorAll("image"));
    for (const img of svgImgEls) {
      const href = img.getAttribute("href") || img.getAttribute("xlink:href");
      if (!href) continue;
      const full = resolvePath(item.fullPath, href);
      const url = await getResourceBlobUrl(full);
      if (url) { img.setAttribute("href", url); img.setAttribute("xlink:href", url); }
    }

    // css liên kết ngoài
    let styleHtml = "";
    const linkEls = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    for (const link of linkEls) {
      const href = link.getAttribute("href");
      if (!href) continue;
      const full = resolvePath(item.fullPath, href);
      if (book.zip.hasFile(full)) {
        const cssText = await book.zip.extractText(full);
        const rewritten = await rewriteCssUrls(cssText, full);
        styleHtml += `<style>${rewritten}</style>\n`;
      }
    }
    // css nội tuyến
    const styleEls = Array.from(doc.querySelectorAll("style"));
    for (const styleEl of styleEls) {
      const rewritten = await rewriteCssUrls(styleEl.textContent || "", item.fullPath);
      styleHtml += `<style>${rewritten}</style>\n`;
    }

    const bodyHtml = bodyEl.innerHTML;
    const plainText = (bodyEl.textContent || "").replace(/\s+/g, " ").trim();

    const entry = { bodyHtml, styleHtml, plainText, bodyClass: bodyEl.className || "" };
    book.chapterCache.set(spineIndex, entry);
    return entry;
  }

  /* ---------------------------------------------------------- rendering / pagination */

  function themeVars() {
    const bg = BG_IMAGES[state.settings.bgImage];
    return THEMES[bg ? bg.base : state.settings.theme] || THEMES.light;
  }

  /**
   * Trả về chuỗi CSS font-family cần GHI ĐÈ lên font gốc của EPUB, hoặc null nếu
   * không ghi đè gì cả (rỗng / "epub" / "original" = giữ nguyên font gốc EPUB).
   * Đây là NGUỒN SỰ THẬT DUY NHẤT cho việc chọn font — baseStyle() và buildSrcDoc()
   * đều gọi qua hàm này, không còn nơi nào khác tự ý set font-family lên iframe nữa.
   */
  function resolveFontFamilyCss(raw) {
    if (!raw || raw === "epub" || raw === "original") return null;
    if (FONT_STACKS[raw]) return FONT_STACKS[raw];
    const val = String(raw).trim();
    if (!val) return null;
    // người dùng dán hẳn 1 font-stack đầy đủ (có dấu phẩy) -> dùng nguyên văn
    if (val.includes(",")) return val;
    // người dùng gõ 1 tên font đơn (ví dụ "Roboto") -> nếu máy có font đó trình
    // duyệt sẽ dùng đúng font đó; nếu không có, trình duyệt tự fallback sang
    // sans-serif hệ thống — đây là fallback MINH BẠCH của trình duyệt, không phải
    // Reader giả vờ đã áp dụng được font.
    return `"${val.replace(/"/g, "")}", ${FONT_STACKS.sans}`;
  }

  /** Style riêng, chỉ ghi đè đúng 1 thuộc tính font-family, không đụng các CSS khác
   *  của EPUB (font-size/weight/line-height/margin/table/svg/...). Được chèn SAU cùng,
   *  sau cả CSS gốc của EPUB, nên thắng theo thứ tự nguồn mà không cần rải !important
   *  khắp nơi — chỉ 1 khối duy nhất, phạm vi hẹp. */
  function fontOverrideStyle(familyCss) {
    if (!familyCss) return "";
    return `#page-wrap.reader-font-override, #page-wrap.reader-font-override * { font-family: ${familyCss} !important; }`;
  }

  // 6.8.3 — bề rộng đệm trái/phải của trang ở chế độ lật trang.
  // BẤT BIẾN QUAN TRỌNG: column-gap PHẢI = 2 × padding ngang, để dịch đúng 100% bề rộng
  // khung (frame.clientWidth) là sang đúng trang kế tiếp — app.js, annotation.js,
  // read-aloud.js đều dựa vào bất biến này. Desktop: 2 nút tròn nổi đè lên vùng đệm nên
  // đệm rộng hơn; mobile (nút ẩn): giữ 28px như cũ.
  const PAGE_PAD_DESKTOP = 56;
  const PAGE_PAD_DEFAULT = 28;   // mobile (nút trang ẩn) + chế độ cuộn

  function pageSidePad() {
    // Đọc thẳng CSS: nút trang đang hiển thị (desktop) hay bị ẩn (mobile / mobile-reader-forced).
    const btn = el.btnNext;
    const navVisible = !!btn && window.getComputedStyle(btn).display !== "none";
    return navVisible ? PAGE_PAD_DESKTOP : PAGE_PAD_DEFAULT;
  }

  function baseStyle() {
    const t = themeVars();
    const bgImage = BG_IMAGES[state.settings.bgImage];
    const bodyBackgroundCss = bgImage ? "transparent" : t.bg;
    const bgImageOpacity = clamp(state.settings.bgImageOpacity, 0, 1, 0.5);
    const bgImageLayerCss = bgImage ? `
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background: ${bgImage.image};
        opacity: ${bgImageOpacity};
      }
    ` : "";
    const fontSize = state.settings.fontSize;
    const lineHeight = state.settings.lineHeight || 1.75;
    const fontWeight = state.settings.fontWeight || 400;
    const zoom = state.settings.zoom || 1;
    const paginated = state.settings.mode === "paginated";
    const cols = Number(state.settings.columns) === 2 ? 2 : 1;
    const selectTextCss = state.settings.selectTextEnabled === false ? `
      body, #page-wrap, #page-wrap * {
        -webkit-user-select: none !important;
        user-select: none !important;
      }
      ::selection { background: transparent; color: inherit; }
    ` : `
      ::selection { background:${t.link}; color:#fff; }
    `;

    // Khoảng đệm 2 bên = pad, khe giữa cột = 2 × pad (desktop 56/112px, mobile 28/56px).
    // Nhờ vậy dịch chuyển đúng 100% bề rộng khung là sang đúng trang kế tiếp,
    // với cả 1 cột lẫn 2 cột.
    const pad = pageSidePad();
    const paginatedCss = `
          column-count: ${cols};
          column-gap: ${pad * 2}px;
          column-fill: auto;
          column-rule: ${cols === 2 ? `1px solid ${t.dim}33` : "none"};
          height: calc(100vh / ${zoom});
          padding: 28px ${pad}px;
          overflow: visible;
          transform: translateX(0);
          will-change: transform;
    `;

    // Cuộn giờ độc lập với số cột (state.settings.columns) — 2 cột khi Cuộn hiển thị
    // kiểu 2 cột báo giấy nhưng vẫn cuộn dọc bình thường, khác hẳn cơ chế lật trang
    // ngang của paginatedCss: không set height cố định, không overflow hidden, không
    // transform. Dùng column-fill: auto (không dùng balance) để cột trái được lấp đầy
    // trước rồi mới tràn sang cột phải — giữ đúng thứ tự đọc khi cuộn xuống, tránh giật
    // do trình duyệt ước lượng lại chiều cao mỗi khi ảnh/heading reflow.
    // 6.8.3: desktop có 2 nút tròn nổi hai bên → đệm ngang tối thiểu bằng PAGE_PAD_DESKTOP
    // để chữ không bị nút che khi khung hẹp (mobile: 0 → giữ nguyên như cũ).
    const scrollMinPad = pad === PAGE_PAD_DESKTOP ? PAGE_PAD_DESKTOP : 0;
    const scrollCss = cols === 2 ? `
          column-count: 2;
          column-gap: 56px;
          column-fill: auto;
          column-rule: 1px solid ${t.dim}33;
          padding: 28px max(6vw, ${scrollMinPad}px) 60px;
          max-width: 1100px;
          margin: 0 auto;
        ` : `
          padding: 28px max(8vw, ${scrollMinPad}px) 60px;
          max-width: 760px;
          margin: 0 auto;
        `;

    return `
      :root { color-scheme: ${state.settings.theme === "dark" ? "dark" : "light"}; }
      html { margin:0; padding:0; background:${t.bg}; ${paginated ? "overflow:hidden;" : ""} }
      body { margin:0; padding:0; background:${bodyBackgroundCss}; ${paginated ? "overflow:hidden;" : ""} }
      /* thanh cuộn dọc của khung đọc: đồng bộ theo nền của theme đang chọn thay vì
         thanh cuộn xám mặc định của trình duyệt (Firefox + trình duyệt Chromium). */
      html { scrollbar-width: thin; scrollbar-color: ${t.dim}80 ${t.bg}; }
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: ${t.bg}; }
      ::-webkit-scrollbar-thumb { background: ${t.dim}80; border-radius: 8px; border: 2px solid ${t.bg}; }
      ::-webkit-scrollbar-thumb:hover { background: ${t.dim}; }
      ::-webkit-scrollbar-corner { background: ${t.bg}; }
      body {
        position: relative;
        isolation: isolate;
        min-height: 100vh;
        font-size:${fontSize}px;
        line-height:${lineHeight};
        font-weight:${fontWeight};
        color:${t.fg};
        -webkit-font-smoothing:antialiased;
        padding: 0;
        zoom: ${zoom};
        text-align: ${paginated ? "justify" : "left"};
        hyphens: auto;
      }
      ${bgImageLayerCss}
      p { orphans: 2; widows: 2; }
      a { color:${t.link}; }
      img, svg { max-width:100%; height:auto; }
      * { box-sizing:border-box; }
      ${selectTextCss}
      #page-wrap { position: relative; z-index: 1; ${paginated ? paginatedCss : scrollCss} }
      #page-wrap img, #page-wrap svg { max-height: ${paginated ? "80vh" : "86vh"}; object-fit: contain; }
      /* tránh tiêu đề / ảnh bị cắt đôi giữa hai cột */
      #page-wrap h1, #page-wrap h2, #page-wrap h3, #page-wrap h4,
      #page-wrap img, #page-wrap svg, #page-wrap table, #page-wrap pre {
        break-inside: avoid;
        -webkit-column-break-inside: avoid;
      }
      /* Highlight tạm thời đoạn vừa nhảy tới từ kết quả Search (xem flashHighlight()). */
      .search-hit-flash {
        background: rgba(255, 214, 0, 0.35);
        transition: background 1.2s ease-out;
      }
    `;
  }

  function buildSrcDoc(entry) {
    const overrideFamily = resolveFontFamilyCss(state.settings.fontFamily);
    const wrapClass = entry.bodyClass + (overrideFamily ? " reader-font-override" : "");
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style id="reader-base-style">${baseStyle()}</style>
${entry.styleHtml}
<style id="reader-font-override">${fontOverrideStyle(overrideFamily)}</style>
</head>
<body>
<div id="page-wrap" class="${wrapClass}">${entry.bodyHtml}</div>
</body></html>`;
  }

  let renderToken = 0;

  async function renderChapter(spineIndex, opts = {}) {
    const book = state.book;
    if (!book) return;
    spineIndex = Math.max(0, Math.min(book.epub.spine.length - 1, spineIndex));
    const myToken = ++renderToken;

    loading(true, "Đang tải chương…");
    let entry;
    try {
      entry = await loadChapterIntoCache(spineIndex);
    } catch (err) {
      loading(false);
      toast("Không thể tải nội dung chương: " + err.message, true);
      return;
    }
    if (myToken !== renderToken) return;

    state.spineIndex = spineIndex;
    el.bookFrame.srcdoc = buildSrcDoc(entry);

    await new Promise((resolve) => { el.bookFrame.onload = resolve; });
    if (myToken !== renderToken) return;

    await new Promise((r) => requestAnimationFrame(r));
    if (myToken !== renderToken) return;

    // Font nhúng qua blob URL (hoặc font override do người dùng chọn) nạp bất đồng bộ —
    // phải chờ document.fonts.ready xong RỒI mới đo cột/tính số trang, nếu không việc đo
    // sẽ dựa trên font tạm (fallback) và bị lệch khi font thật load xong rồi tự reflow.
    // waitForFonts() có timeout dự phòng nên không treo UI vô hạn nếu vì lý do gì đó
    // không resolve được.
    await waitForFonts(frameDoc());
    if (myToken !== renderToken) return;

    applyColumnMetrics();
    computeTotalPages();

    let targetPage = 0;
    if (opts.restorePage != null) targetPage = opts.restorePage;
    if (opts.lastPage) targetPage = state.totalPages - 1;
    if (opts.anchorId) {
      const found = findPageForAnchor(opts.anchorId);
      if (found != null) targetPage = found;
    }
    setPage(targetPage, { skipPersist: true });

    if (state.settings.mode !== "paginated") {
      const frac = opts.restoreScrollFraction || 0;
      state.scrollFraction = frac;
      if (frac > 0) {
        const d = frameDoc();
        if (d && d.scrollingElement) {
          const se = d.scrollingElement;
          se.scrollTop = (se.scrollHeight - se.clientHeight) * frac;
        }
      }
      updateProgressUi();
    }

    attachFrameInteractions();
    watchImagesForReflow();
    persistPosition();
    // Phải đánh dấu mục "current" trong TOC (highlightCurrentToc) TRƯỚC khi đọc tên
    // chương hiển thị (updateChapterLabel) — updateChapterLabel lấy tên từ đúng mục
    // "current" đó. Trước đây thứ tự bị ngược nên el.chapterLabel (và vì vậy cả nhãn
    // bookmark, vốn dùng lại chuỗi này) luôn hiển thị tên của CHƯƠNG TRƯỚC ĐÓ, chậm
    // đúng 1 nhịp so với chương đang thực sự hiển thị.
    highlightCurrentToc();
    updateChapterLabel();

    // phần thêm cho Annotation: khôi phục highlight + gắn sự kiện bôi chọn cho
    // chương vừa dựng xong (annotation.js tự lo toàn bộ logic, ở đây chỉ gọi hook).
    if (window.ReaderAnnotations && window.ReaderAnnotations.onChapterRendered) {
      try { window.ReaderAnnotations.onChapterRendered(spineIndex); } catch (e) { console.warn("Annotation: lỗi khi áp dụng highlight", e); }
    }

    loading(false);
  }

  function frameDoc() {
    return el.bookFrame.contentDocument;
  }

  /**
   * Chờ font trong iframe load xong trước khi đo/tính trang (yêu cầu bắt buộc — không
   * được tính pagination bằng font tạm rồi mới load font thật). Có timeout an toàn để
   * không treo UI vô hạn nếu document.fonts.ready vì lý do gì đó không bao giờ resolve
   * (một số bản Chromium hiếm khi không settle với srcdoc iframe).
   */
  async function waitForFonts(doc, timeoutMs = 2500) {
    if (!doc || !doc.fonts) return;
    try {
      // đảm bảo mọi FontFace khai báo trong @font-face đã thực sự được yêu cầu tải,
      // không chỉ khai báo suông (một số engine trì hoãn tải tới khi có text dùng nó).
      doc.fonts.forEach((f) => { try { f.load().catch(() => {}); } catch (e) {} });
    } catch (e) {}
    try {
      await Promise.race([
        doc.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    } catch (e) {
      console.debug("[EPUB FONT] document.fonts.ready lỗi:", e);
    }
  }

  /** Debug: liệt kê toàn bộ font hiện có trong iframe + trạng thái load của từng font.
   *  Gọi từ DevTools: ReaderApp.debugEmbeddedFonts() để biết font nào đã/chưa load. */
  function debugEmbeddedFonts() {
    const d = frameDoc();
    if (!d || !d.fonts) { console.debug("[EPUB FONT] document.fonts không khả dụng trong iframe này."); return []; }
    const entries = [];
    d.fonts.forEach((f) => entries.push({ family: f.family, style: f.style, weight: f.weight, status: f.status }));
    const overrideFamily = resolveFontFamilyCss(state.settings.fontFamily);
    console.debug("[EPUB FONT]", {
      fontFamilySetting: state.settings.fontFamily || "(EPUB gốc)",
      overrideFamily: overrideFamily || "(không ghi đè — dùng font gốc EPUB)",
      documentFontsStatus: d.fonts.status,
      entries,
    });
    return entries;
  }

  function pageWrapEl() {
    const d = frameDoc();
    return d ? d.getElementById("page-wrap") : null;
  }

  /**
   * Đặt bề rộng cột bằng pixel cụ thể theo state.settings.columns. Ở mode lật trang,
   * trình duyệt luôn tạo đúng 1 hoặc 2 cột mỗi trang và phần nội dung dôi ra sẽ tràn
   * sang các cột kế tiếp (cơ chế "overflow columns"). Ở mode Cuộn, columnWidth đo theo
   * cùng công thức để cột trái/phải đều nhau khi hiển thị 2 cột kiểu báo giấy — nhưng
   * KHÔNG ảnh hưởng tới computeTotalPages(), hàm đó vẫn luôn trả totalPages = 1 khi
   * không phải paginated (2 cột lúc Cuộn không phải là "trang" theo nghĩa lật trang).
   */
  function applyColumnMetrics() {
    const wrap = pageWrapEl();
    if (!wrap) return;
    const paginated = state.settings.mode === "paginated";
    const PAD = paginated ? pageSidePad() : PAGE_PAD_DEFAULT; // đệm ngang mỗi bên
    const GAP = PAD * 2; // = 2 × padding (cũng là khe giữa 2 cột)
    const cols = Number(state.settings.columns) === 2 ? 2 : 1;
    const inner = wrap.clientWidth - GAP; // trừ padding trái + phải
    if (inner <= 0) return;
    // khung quá hẹp thì tự hạ về 1 cột cho dễ đọc
    const effCols = cols === 2 && wrap.clientWidth >= 760 ? 2 : 1;
    const colWidth = effCols === 2 ? (inner - GAP) / 2 : inner;
    state.effectiveColumns = effCols;
    wrap.style.columnWidth = Math.max(80, Math.floor(colWidth)) + "px";
    if (paginated) {
      // đồng bộ lại khi cửa sổ đổi cỡ và nút trang bật/tắt (vượt mốc 760px)
      wrap.style.paddingLeft = PAD + "px";
      wrap.style.paddingRight = PAD + "px";
      wrap.style.columnGap = GAP + "px";
    }
  }

  function computeTotalPages() {
    if (state.settings.mode !== "paginated") { state.totalPages = 1; return; }
    const wrap = pageWrapEl();
    if (!wrap) { state.totalPages = 1; return; }
    // đo bằng chính #page-wrap: giá trị nằm cùng hệ toạ độ với zoom nên không bị lệch
    const pageWidth = wrap.clientWidth || el.bookFrame.clientWidth || 1;
    const total = Math.max(1, Math.ceil((wrap.scrollWidth - 1) / pageWidth));
    state.totalPages = total;
  }

  function setPage(n, opts = {}) {
    state.page = Math.max(0, Math.min(state.totalPages - 1, n));
    const wrap = pageWrapEl();
    if (wrap && state.settings.mode === "paginated") {
      const pageWidth = wrap.clientWidth || el.bookFrame.clientWidth || 1;
      wrap.style.transform = `translateX(-${state.page * pageWidth}px)`;
    }
    updateProgressUi();
    if (!opts.skipPersist) persistPosition();
  }

  function watchImagesForReflow() {
    const d = frameDoc();
    if (!d) return;
    const imgs = Array.from(d.querySelectorAll("img"));
    for (const img of imgs) {
      if (img.complete) continue;
      img.addEventListener("load", () => {
        const oldTotal = state.totalPages || 1;
        const fraction = state.page / oldTotal;
        applyColumnMetrics();
        computeTotalPages();
        setPage(Math.round(fraction * state.totalPages), { skipPersist: true });
      }, { once: true });
    }
  }

  function findPageForAnchor(anchorId) {
    const d = frameDoc();
    if (!d) return null;
    const target = d.getElementById(anchorId) || d.querySelector(`[name="${CSS.escape(anchorId)}"]`);
    if (!target) return null;
    const wrap = pageWrapEl();
    const pageWidth = el.bookFrame.clientWidth || 1;
    let offsetLeft = 0;
    let node = target;
    while (node && node !== wrap) {
      offsetLeft += node.offsetLeft || 0;
      node = node.offsetParent;
    }
    return Math.floor(offsetLeft / pageWidth);
  }

  /* ---------------------------------------------------------- navigation */

  function goNextPage() {
    if (state.settings.mode === "paginated") {
      if (state.page < state.totalPages - 1) { setPage(state.page + 1); return; }
    } else {
      const d = frameDoc();
      if (d && d.scrollingElement) {
        const se = d.scrollingElement;
        if (se.scrollTop + se.clientHeight < se.scrollHeight - 4) {
          se.scrollBy({ top: se.clientHeight * 0.9, behavior: "smooth" });
          setTimeout(updateProgressUi, 300);
          return;
        }
      }
    }
    if (state.spineIndex < state.book.epub.spine.length - 1) {
      renderChapter(state.spineIndex + 1, { restorePage: 0 });
    }
  }

  function goPrevPage() {
    if (state.settings.mode === "paginated") {
      if (state.page > 0) { setPage(state.page - 1); return; }
    } else {
      const d = frameDoc();
      if (d && d.scrollingElement && d.scrollingElement.scrollTop > 4) {
        d.scrollingElement.scrollBy({ top: -d.scrollingElement.clientHeight * 0.9, behavior: "smooth" });
        setTimeout(updateProgressUi, 300);
        return;
      }
    }
    if (state.spineIndex > 0) {
      renderChapter(state.spineIndex - 1, { lastPage: true });
    }
  }

  el.btnPrev.addEventListener("click", goPrevPage);
  el.btnNext.addEventListener("click", goNextPage);

  document.addEventListener("keydown", (e) => {
    if (el.readerView.classList.contains("hidden")) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { goNextPage(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { goPrevPage(); }
    else if (e.key === "Escape") { closeSearch(); closeSidebar(); }
  });

  function attachFrameInteractions() {
    const d = frameDoc();
    if (!d || !d.body) return;

    d.body.addEventListener("click", (e) => {
      const link = e.target.closest("a[href]");
      if (link) {
        e.preventDefault();
        handleInternalLink(link.getAttribute("href"));
        return;
      }
      if (state.settings.mode !== "paginated") return;
      const x = e.clientX;
      const ratio = x / (el.bookFrame.clientWidth || 1);
      if (ratio < 1 / 3) goPrevPage();
      else if (ratio > 2 / 3) goNextPage();
    });

    d.addEventListener("wheel", (e) => {
      if (state.settings.mode !== "paginated") return;
      if (Math.abs(e.deltaY) < 10 && Math.abs(e.deltaX) < 10) return;
      e.preventDefault();
      if (e.deltaY > 0 || e.deltaX > 0) goNextPage(); else goPrevPage();
    }, { passive: false });

    if (d.scrollingElement) {
      d.addEventListener("scroll", onFrameScroll, { passive: true });
    }
  }

  let scrollPersistDebounce;
  function onFrameScroll() {
    if (state.settings.mode === "paginated") return;
    const d = frameDoc();
    if (!d || !d.scrollingElement) return;
    const se = d.scrollingElement;
    const maxScroll = se.scrollHeight - se.clientHeight;
    state.scrollFraction = maxScroll > 0 ? Math.max(0, Math.min(1, se.scrollTop / maxScroll)) : 0;
    updateProgressUi();
    clearTimeout(scrollPersistDebounce);
    scrollPersistDebounce = setTimeout(persistPosition, 400);
  }

  function handleInternalLink(href) {
    if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
      return; // liên kết ngoài: bỏ qua khi offline
    }
    const book = state.book;
    const currentPath = book.epub.spine[state.spineIndex].fullPath;
    const [pathPart, anchor] = href.split("#");

    if (!pathPart) {
      const page = findPageForAnchor(anchor);
      if (page != null) setPage(page);
      return;
    }
    const fullPath = resolvePath(currentPath, pathPart);
    const idx = book.epub.spine.findIndex((s) => s.fullPath === fullPath);
    if (idx >= 0) {
      renderChapter(idx, anchor ? { anchorId: anchor } : { restorePage: 0 });
    }
  }

  /* ---------------------------------------------------------- TOC */

  function renderToc(toc) {
    function buildList(items) {
      if (!items.length) return "";
      return `<ul>${items
        .map(
          (it) => `<li class="toc-item">
              ${it.href ? `<a href="#" data-href="${escapeHtml(it.href)}">${escapeHtml(it.label || "(không tên)")}</a>` : `<span class="toc-item-label">${escapeHtml(it.label || "")}</span>`}
              ${buildList(it.children || [])}
            </li>`
        )
        .join("")}</ul>`;
    }
    el.tocList.innerHTML = buildList(toc) || `<p class="sidebar-empty">Sách này không có mục lục.</p>`;
  }

  el.tocList.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-href]");
    if (!a) return;
    e.preventDefault();
    const href = a.dataset.href;
    const [pathPart, anchor] = href.split("#");
    const book = state.book;
    const idx = book.epub.spine.findIndex((s) => s.fullPath === pathPart || s.href === pathPart);
    if (idx >= 0) renderChapter(idx, anchor ? { anchorId: anchor } : { restorePage: 0 });
  });

  function highlightCurrentToc() {
    const book = state.book;
    const currentPath = book.epub.spine[state.spineIndex].fullPath;
    el.tocList.querySelectorAll("a.current").forEach((a) => a.classList.remove("current"));
    el.tocList.querySelectorAll("a[data-href]").forEach((a) => {
      const p = a.dataset.href.split("#")[0];
      if (p === currentPath) a.classList.add("current");
    });
  }

  function updateChapterLabel() {
    const a = el.tocList.querySelector("a.current");
    el.chapterLabel.textContent = a ? a.textContent.trim() : state.book.title;
    updateProgressUi(); // phát lại vị trí kèm tên chương vừa cập nhật
  }

  /* ---------------------------------------------------------- bookmarks */

  function findCurrentBookmark(bookmarks) {
    const list = bookmarks || [];
    const paginated = state.settings.mode === "paginated";
    const scrollFraction = state.scrollFraction || 0;
    return list.find((b) => {
      if (Number(b.spineIndex) !== state.spineIndex) return false;
      if (paginated) return Number(b.page || 0) === state.page;
      return Math.abs(Number(b.scrollFraction || 0) - scrollFraction) <= 0.015;
    }) || null;
  }

  async function getCurrentBookmark() {
    const book = state.book;
    if (!book) return null;
    const record = await BookDB.getBook(book.id);
    return findCurrentBookmark((record && record.bookmarks) || []);
  }

  function emitBookmarkState(bookmark) {
    const active = !!bookmark;
    if (el.btnBookmark) {
      el.btnBookmark.classList.toggle("active", active);
      el.btnBookmark.title = active ? "Bỏ đánh dấu trang này" : "Đánh dấu trang này";
      el.btnBookmark.setAttribute("aria-label", el.btnBookmark.title);
    }
    document.dispatchEvent(new CustomEvent("reader:bookmark-state", {
      detail: { active, bookmark: bookmark || null },
    }));
  }

  async function syncBookmarkState() {
    emitBookmarkState(await getCurrentBookmark());
  }

  async function toggleCurrentBookmark() {
    const book = state.book;
    if (!book) return null;
    const current = await getCurrentBookmark();
    if (current) {
      await BookDB.removeBookmark(book.id, Number(current.createdAt));
      toast("Đã bỏ đánh dấu trang này");
      await renderBookmarks();
      emitBookmarkState(null);
      return null;
    }

    const paginated = state.settings.mode === "paginated";
    // Chế độ lật trang: vị trí là state.page (số trang trong chương).
    // Chế độ cuộn: state.page KHÔNG được cập nhật khi cuộn (chỉ setPage() mới đổi nó),
    // nên vị trí thật sự nằm ở state.scrollFraction — phải lưu cả 2 để khôi phục đúng
    // chỗ đã đánh dấu (trước đây chỉ lưu spineIndex+page nên khi bấm lại bookmark ở
    // chế độ cuộn luôn nhảy về đầu chương thay vì đúng vị trí đã cuộn tới).
    const scrollFraction = paginated ? 0 : (state.scrollFraction || 0);
    const posLabel = paginated ? `trang ${state.page + 1}` : `~${Math.round(scrollFraction * 100)}%`;
    const label = (el.chapterLabel.textContent || book.title) + ` — ${posLabel}`;
    const bookmark = {
      spineIndex: state.spineIndex, page: state.page, scrollFraction, label, createdAt: Date.now(),
    };
    await BookDB.addBookmark(book.id, bookmark);
    toast("Đã đánh dấu trang này");
    await renderBookmarks();
    emitBookmarkState(bookmark);
    return bookmark;
  }

  el.btnBookmark.addEventListener("click", toggleCurrentBookmark);

  async function renderBookmarks() {
    const book = state.book;
    if (!book) return;
    const record = await BookDB.getBook(book.id);
    const bookmarks = (record && record.bookmarks) || [];
    el.bookmarkEmpty.classList.toggle("hidden", bookmarks.length > 0);
    el.bookmarkList.innerHTML = bookmarks
      .slice()
      .reverse()
      .map(
        (b) => `<li class="bookmark-item" data-spine="${b.spineIndex}" data-page="${b.page}" data-scroll="${b.scrollFraction || 0}" data-created="${b.createdAt}">
          <span class="bookmark-item-label">${escapeHtml(b.label)}</span>
          <button class="bookmark-remove" data-remove="${b.createdAt}" title="Xoá">✕</button>
        </li>`
      )
      .join("");
    syncBookmarkState();
  }

  el.bookmarkList.addEventListener("click", async (e) => {
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      e.stopPropagation();
      await BookDB.removeBookmark(state.book.id, Number(removeBtn.dataset.remove));
      await renderBookmarks();
      await syncBookmarkState();
      return;
    }
    const item = e.target.closest(".bookmark-item");
    if (!item) return;
    renderChapter(Number(item.dataset.spine), {
      restorePage: Number(item.dataset.page) || 0,
      restoreScrollFraction: Number(item.dataset.scroll) || 0,
    });
  });

  document.addEventListener("reader:location", () => {
    clearTimeout(syncBookmarkState._t);
    syncBookmarkState._t = setTimeout(syncBookmarkState, 120);
  });

  /* ---------------------------------------------------------- sidebar */

  function openSidebar() { state.sidebarOpen = true; show(el.sidebar); el.btnToggleSidebar.classList.add("active"); }
  function closeSidebar() { state.sidebarOpen = false; hide(el.sidebar); el.btnToggleSidebar.classList.remove("active"); }
  el.btnToggleSidebar.addEventListener("click", () => (state.sidebarOpen ? closeSidebar() : openSidebar()));

  el.sidebarTabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      el.sidebarTabs.forEach((t) => t.classList.toggle("active", t === tab));
      el.tocPanel.classList.toggle("hidden", state.activeTab !== "toc");
      el.bookmarksPanel.classList.toggle("hidden", state.activeTab !== "bookmarks");
    })
  );

  /* ---------------------------------------------------------- search */

  let searchDebounce;
  el.btnSearchToggle.addEventListener("click", () => {
    el.searchInput.classList.toggle("hidden");
    if (!el.searchInput.classList.contains("hidden")) el.searchInput.focus();
    else closeSearch();
  });

  function closeSearch() {
    hide(el.searchResults);
  }

  el.searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = el.searchInput.value.trim();
    if (q.length < 2) { hide(el.searchResults); return; }
    searchDebounce = setTimeout(() => runSearch(q), 350);
  });

  async function runSearch(query) {
    const book = state.book;
    if (!book) return;
    show(el.searchResults);
    el.searchResults.innerHTML = `<div class="search-result-empty">Đang tìm…</div>`;

    const lowerQ = query.toLowerCase();
    const results = [];
    for (let i = 0; i < book.epub.spine.length && results.length < 60; i++) {
      let entry;
      try { entry = await loadChapterIntoCache(i); } catch { continue; }
      const text = entry.plainText;
      const lowerText = text.toLowerCase();
      let from = 0;
      while (results.length < 60) {
        const idx = lowerText.indexOf(lowerQ, from);
        if (idx === -1) break;
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + lowerQ.length + 40);
        const snippet =
          (start > 0 ? "…" : "") +
          escapeHtml(text.slice(start, idx)) +
          "<b>" + escapeHtml(text.slice(idx, idx + lowerQ.length)) + "</b>" +
          escapeHtml(text.slice(idx + lowerQ.length, end)) +
          (end < text.length ? "…" : "");
        results.push({ spineIndex: i, charIndex: idx, snippet });
        from = idx + lowerQ.length;
      }
    }

    if (!results.length) {
      el.searchResults.innerHTML = `<div class="search-result-empty">Không tìm thấy "${escapeHtml(query)}".</div>`;
      return;
    }
    el.searchResults.innerHTML = results
      .map((r) => `<div class="search-result-item" data-spine="${r.spineIndex}" data-char="${r.charIndex}">${r.snippet}</div>`)
      .join("");
  }

  el.searchResults.addEventListener("click", async (e) => {
    const item = e.target.closest(".search-result-item");
    if (!item || item.dataset.spine == null) return;
    const spineIndex = Number(item.dataset.spine);
    const charIndex = Number(item.dataset.char);
    await renderChapter(spineIndex, { restorePage: 0 });
    await jumpToCharOffset(charIndex);
    closeSearch();
  });

  /** Duyệt text node trong #page-wrap để tìm phần tử cha chứa đúng charIndex — dùng
   *  chung cho cả 2 nhánh mode bên dưới (chỉ khác nhau ở cách "nhảy" tới sau khi tìm). */
  function locateCharOffset(charIndex) {
    const d = frameDoc();
    const wrap = pageWrapEl();
    if (!d || !wrap) return null;
    const walker = d.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (acc + len >= charIndex) {
        return { node, parent: node.parentElement };
      }
      acc += len;
    }
    return null;
  }

  /** Nhảy tới đúng đoạn chứa charIndex sau khi chương đã render xong. Ở mode Lật trang
   *  vẫn tính trang từ offsetLeft như cũ; ở mode Cuộn (1 hoặc 2 cột) thì cuộn thẳng tới
   *  phần tử bằng scrollIntoView rồi đồng bộ lại thanh tiến trình qua onFrameScroll(). */
  async function jumpToCharOffset(charIndex) {
    const hit = locateCharOffset(charIndex);
    if (!hit || !hit.parent) return;

    if (state.settings.mode === "paginated") {
      const wrap = pageWrapEl();
      const pageWidth = el.bookFrame.clientWidth || 1;
      let offsetLeft = 0;
      let n = hit.parent;
      while (n && n !== wrap) { offsetLeft += n.offsetLeft || 0; n = n.offsetParent; }
      setPage(Math.floor(offsetLeft / pageWidth));
    } else {
      const d = frameDoc();
      if (d && d.scrollingElement && hit.parent.scrollIntoView) {
        hit.parent.scrollIntoView({ block: "center", behavior: "auto" });
        onFrameScroll();
      }
    }

    flashHighlight(hit.parent);
  }

  /** Highlight tạm thời đoạn vừa nhảy tới để người dùng nhận biết ngay đúng vị trí. */
  function flashHighlight(elm) {
    if (!elm || !elm.classList) return;
    elm.classList.add("search-hit-flash");
    setTimeout(() => elm.classList.remove("search-hit-flash"), 1500);
  }

  /* ---------------------------------------------------------- progress bar */

  function updateProgressUi() {
    const book = state.book;
    if (!book) return;
    const spineLen = book.epub.spine.length;
    const within = state.settings.mode === "paginated"
      ? (state.totalPages > 1 ? state.page / state.totalPages : 0)
      : state.scrollFraction;
    const fraction = (state.spineIndex + within) / spineLen;
    const pct = Math.round(fraction * 100);
    el.progressFill.style.width = pct + "%";
    el.progressPercent.textContent = pct + "%";

    const item = book.epub.spine[state.spineIndex] || {};
    document.dispatchEvent(new CustomEvent("reader:location", { detail: {
      page: state.page + 1,
      totalPages: state.totalPages,
      spineIndex: state.spineIndex,
      spineCount: spineLen,
      percent: pct,
      path: item.fullPath || "",
      chapter: el.chapterLabel.textContent || "",
      columns: state.effectiveColumns || 1,
      mode: state.settings.mode,
    }}));
  }

  el.progressTrack.addEventListener("click", (e) => {
    const book = state.book;
    if (!book) return;
    const rect = el.progressTrack.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(book.epub.spine.length - 1, Math.floor(frac * book.epub.spine.length)));
    renderChapter(idx, { restorePage: 0 });
  });

  function persistPosition() {
    const book = state.book;
    if (!book) return;
    BookDB.updatePosition(book.id, {
      spineIndex: state.spineIndex,
      page: state.page,
      scrollFraction: state.settings.mode === "paginated" ? 0 : state.scrollFraction,
    });
  }

  /* ---------------------------------------------------------- theme / font / mode controls */

  function applyThemeAndFontUi() {
    el.themeDots.forEach((d) => d.classList.toggle("active", !state.settings.bgImage && d.dataset.theme === state.settings.theme));
    if (el.selectFontFamily) el.selectFontFamily.value = state.settings.fontFamily;
    if (el.btnMode) el.btnMode.classList.toggle("active", state.settings.mode === "scroll");
    const t = themeVars();
    document.documentElement.style.setProperty("--reading-bg", t.bg);
    document.documentElement.style.setProperty("--reading-fg", t.fg);
    if (state.settings.accent) {
      document.documentElement.style.setProperty("--terracotta", state.settings.accent);
      document.documentElement.style.setProperty("--lib-accent", state.settings.accent);
    }
    // Modal thông tin sách có thể đang mở trong lúc đọc (yêu cầu 2.4): đổi theme đọc
    // thì modal phải cập nhật ngay, không cần đóng mở lại.
    applyModalThemeForContext();
    document.dispatchEvent(new CustomEvent("reader:settings", { detail: { ...state.settings } }));
  }

  /** Áp dụng thay đổi cài đặt và vẽ lại chương hiện tại. */
  async function applySettings(patch, opts = {}) {
    Object.assign(state.settings, patch);
    saveSettings();
    applyThemeAndFontUi();
    if (state.book) {
      await renderChapter(state.spineIndex, {
        restorePage: opts.resetPage ? 0 : state.page,
        restoreScrollFraction: state.scrollFraction,
      });
    }
  }

  el.themeDots.forEach((dot) =>
    dot.addEventListener("click", () => applySettings({ theme: dot.dataset.theme }))
  );

  if (el.selectFontFamily) {
    el.selectFontFamily.addEventListener("change", () =>
      applySettings({ fontFamily: el.selectFontFamily.value })
    );
  }

  if (el.btnFontDec) el.btnFontDec.addEventListener("click", () => changeFontSize(-1));
  if (el.btnFontInc) el.btnFontInc.addEventListener("click", () => changeFontSize(1));

  async function changeFontSize(delta) {
    const size = Math.max(13, Math.min(34, state.settings.fontSize + delta));
    await applySettings({ fontSize: size }, { resetPage: true });
  }

  if (el.btnMode) {
    el.btnMode.addEventListener("click", () =>
      applySettings({ mode: state.settings.mode === "paginated" ? "scroll" : "paginated" }, { resetPage: true })
    );
  }

  /* ---------------------------------------------------------- resize */

  function setupResizeObserver() {
    const ro = new ResizeObserver(() => {
      if (!state.book || state.settings.mode !== "paginated") return;
      const oldTotal = state.totalPages || 1;
      const fraction = state.page / oldTotal;
      applyColumnMetrics();
      computeTotalPages();
      setPage(Math.round(fraction * state.totalPages), { skipPersist: true });
    });
    ro.observe($("#content-viewport"));
  }

  /* ---------------------------------------------------------- public api */

  window.ReaderApp = {
    /* nhập sách */
    importFiles,
    importFromUrl,
    openFilePicker: () => el.fileInput && el.fileInput.click(),

    /* thư viện */
    renderLibrary,
    listBooks: () => BookDB.listBooks(),
    estimateProgress: estimateProgressPercent,
    isReaderOpen: () => !!state.book,
    getCurrentBookmark,
    toggleCurrentBookmark,

    /* cài đặt hiển thị */
    getSettings: () => ({ ...state.settings }),
    setTheme: (theme) => applySettings({ theme: THEMES[theme] ? theme : "light", bgImage: "" }),
    setBgImage: (key) => applySettings({ bgImage: BG_IMAGES[key] ? key : "" }),
    setBgImageOpacity: (value) => applySettings({ bgImageOpacity: clamp(value, 0, 1, 0.5) }),
    bgImages: () => Object.keys(BG_IMAGES),
    // "" / "epub" / "original" = dùng đúng font gốc EPUB (không ghi đè). Bất kỳ chuỗi
    // nào khác đều được chấp nhận nguyên văn (khoá "serif"/"sans"/"dyslexic" có sẵn,
    // hoặc tên font người dùng tự gõ) — resolveFontFamilyCss() ở trên xử lý phần còn lại.
    setFontFamily: (family) => applySettings({ fontFamily: family == null ? "" : String(family) }),
    setFontSize: (size) => applySettings({ fontSize: Math.max(13, Math.min(34, Number(size) || 19)) }, { resetPage: true }),
    changeFontSize,
    setMode: (mode) => applySettings({ mode: mode === "paginated" ? "paginated" : "scroll" }, { resetPage: true }),
    setColumns: (n) => applySettings({ columns: Number(n) === 2 ? 2 : 1 }, { resetPage: true }),
    setLineHeight: (v) => applySettings({ lineHeight: clamp(v, 1.1, 2.6, 1.75) }, { resetPage: true }),
    setFontWeight: (v) => applySettings({ fontWeight: clamp(v, 200, 900, 400) }),
    setZoom: (v) => applySettings({ zoom: clamp(v, 0.6, 2.5, 1) }, { resetPage: true }),
    setSelectTextEnabled: (enabled) => applySettings({ selectTextEnabled: enabled !== false }),
    setAccent: (color) => {
      const c = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#c17a4f";
      state.settings.accent = c;
      saveSettings();
      document.documentElement.style.setProperty("--terracotta", c);
      document.documentElement.style.setProperty("--lib-accent", c);
      document.dispatchEvent(new CustomEvent("reader:settings", { detail: { ...state.settings } }));
    },
    resetSettings: () => applySettings({ ...DEFAULT_SETTINGS, theme: state.settings.theme }, { resetPage: true }),

    /* sách đang mở */
    getBookInfo: () => state.book ? {
      id: state.book.id,
      title: state.book.title,
      creator: state.book.creator,
      fileName: state.book.fileName,
      spineCount: state.book.epub.spine.length,
    } : null,
    getLocation: () => state.book ? {
      spineIndex: state.spineIndex,
      spineCount: state.book.epub.spine.length,
      page: state.page + 1,
      totalPages: state.totalPages,
      path: (state.book.epub.spine[state.spineIndex] || {}).fullPath || "",
      chapter: el.chapterLabel.textContent || "",
    } : null,
    gotoSpine: (i) => state.book && renderChapter(Number(i) || 0, { restorePage: 0 }),
    openBookById: async (id) => {
      const record = await BookDB.getBook(id);
      if (!record) return false;
      await openBook(record); // đã tự xử lý: đang active thì bỏ qua, đã có tab thì chuyển, chưa có thì mở tab mới
      return true;
    },
    openBookInfoById: async (id) => {
      const record = await BookDB.getBook(id);
      if (!record) return false;
      openBookInfo(record);
      return true;
    },
    closeBook: () => { if (state.activeTabId) closeTab(state.activeTabId); },
    /* đa tab: đóng 1 cuốn cụ thể theo id mà không cần nó đang active */
    closeTabById: (id) => closeTab(id),
    listOpenTabs: () => state.tabs.map((t) => ({ id: t.id, title: t.book.title, fileName: t.book.fileName, active: t.id === state.activeTabId })),

    /* danh sách ảnh trong sách, dùng cho bảng IMAGE */
    listImages: async () => {
      const book = state.book;
      if (!book) return [];
      const out = [];
      for (const item of book.epub.manifest.values()) {
        if (!/^image\//.test(item.mediaType || "")) continue;
        const url = await getResourceBlobUrl(item.fullPath);
        if (url) out.push({ path: item.fullPath, url, name: item.fullPath.split("/").pop() });
      }
      return out;
    },

    /* tiện ích */
    toast,
    loading,
    themes: () => Object.keys(THEMES),

    /* phần thêm cho Annotation: expose các nội bộ cần thiết cho annotation.js */
    frameDoc,
    bookFrame: el.bookFrame,
    THEMES,
    themeVars,
    escapeHtml,
    getSpineIndex: () => state.spineIndex,
    gotoLocation: (spineIndex, opts) => renderChapter(spineIndex, opts),
    setPage: (n) => setPage(n),

    /* debug font (yêu cầu 9: dùng trong DevTools để kiểm tra font đã load hay chưa) */
    debugEmbeddedFonts,
  };

  function dataUrlToBlob(dataUrl) {
    const raw = String(dataUrl || "");
    const comma = raw.indexOf(",");
    if (!raw.startsWith("data:") || comma < 0) {
      throw new Error("EPUB data URL không hợp lệ");
    }

    const header = raw.slice(5, comma);
    const body = raw.slice(comma + 1);
    const mime = (header.split(";")[0] || "application/epub+zip").trim();
    const isBase64 = /(?:^|;)base64(?:;|$)/i.test(header);
    if (!isBase64) return new Blob([decodeURIComponent(body)], { type: mime });

    const binary = atob(body);
    const chunkSize = 1024 * 256;
    const chunks = [];
    for (let offset = 0; offset < binary.length; offset += chunkSize) {
      const slice = binary.slice(offset, offset + chunkSize);
      const bytes = new Uint8Array(slice.length);
      for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i);
      chunks.push(bytes);
    }
    return new Blob(chunks, { type: mime || "application/epub+zip" });
  }

  async function importPendingReaderEpubFromToken() {
    const params = new URLSearchParams(location.search || "");
    const token = params.get("importToken");
    if (!token || !chrome?.runtime?.sendMessage) return;

    chrome.runtime.sendMessage({ action: "consumeReaderEpub", token }, async (payload) => {
      try {
        if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
        if (!payload?.success || !payload.dataUrl) {
          throw new Error(payload?.error || "Không nhận được EPUB từ Waka Toolkit");
        }

        loading(true, "Đang nhập EPUB từ Waka Toolkit...");
        const blob = dataUrlToBlob(payload.dataUrl);
        const filename = payload.filename || "waka.epub";
        const file = new File([blob], filename, { type: "application/epub+zip" });
        await importFiles([file]);
        try {
          history.replaceState(null, "", location.pathname);
        } catch {}
      } catch (err) {
        console.error(err);
        loading(false);
        toast("Không nhập được EPUB: " + err.message, true);
      }
    });
  }

  /* ---------------------------------------------------------- init */

  async function init() {
    await loadSettings();
    applyThemeAndFontUi();
    if (el.selectFontFamily) el.selectFontFamily.value = state.settings.fontFamily;
    setupResizeObserver();
    await renderLibrary();
    await importPendingReaderEpubFromToken();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.book) {
      clearTimeout(scrollPersistDebounce);
      persistPosition();
    }
    if (document.visibilityState === "visible") acquireScreenWakeLock();
    else releaseScreenWakeLock();
  });
  window.addEventListener("beforeunload", () => {
    if (state.book) persistPosition();
    releaseScreenWakeLock();
  });

  init();
})();
