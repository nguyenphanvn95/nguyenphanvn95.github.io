// reader-ui.js — khung đọc kiểu flowoss
// Thanh công cụ dọc bên trái · bảng TOC/Library, tìm kiếm, đánh dấu, ảnh,
// dòng thời gian, chữ & dàn trang, màu nền, cài đặt · thanh tab · chân trang.
// Chạy sau app.js + features.js, dùng window.ReaderApp.

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const app = () => window.ReaderApp || {};

  const readerView = $("#reader-view");
  const side = $("#sidebar");
  const sideTitle = $("#rd-side-title");
  const panes = Array.from(document.querySelectorAll(".rd-pane"));
  const railBtns = Array.from(document.querySelectorAll(".rd-rail .rail-btn"));

  if (!readerView || !side) return;

  const PANEL_TITLES = {
    toc: "TOC",
    search: "SEARCH",
    readaloud: "READ ALOUD",
    marks: "ĐÁNH DẤU",
    images: "IMAGE",
    timeline: "TIMELINE",
    typography: "TYPOGRAPHY",
    theme: "THEME",
    settings: "CÀI ĐẶT",
  };

  const PANEL_TITLE_KEYS = {
    toc: "panel.toc",
    search: "panel.search",
    readaloud: "panel.readaloud",
    marks: "panel.marks",
    images: "panel.images",
    timeline: "panel.timeline",
    typography: "panel.typography",
    theme: "panel.theme",
    settings: "panel.settings",
  };
  const tr = (key, fallback) => window.I18n?.t?.(key) || fallback || key;
  const SIDE_KEY = "reader-side-panel";
  let activePanel = "toc";
  let sideOpen = true;

  /* ═══════════════════════════════════════════════
     Bảng bên trái
     ═══════════════════════════════════════════════ */

  function showPanel(name) {
    activePanel = name;
    sideOpen = true;
    side.classList.remove("hidden");
    sideTitle.textContent = tr(PANEL_TITLE_KEYS[name], PANEL_TITLES[name] || name.toUpperCase());
    panes.forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== name));
    railBtns.forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
    try { chrome.storage.local.set({ [SIDE_KEY]: { panel: name, open: true } }); } catch (e) {}
    onPanelShown(name);
  }

  function closeSide() {
    sideOpen = false;
    side.classList.add("hidden");
    railBtns.forEach((b) => b.classList.remove("active"));
    try { chrome.storage.local.set({ [SIDE_KEY]: { panel: activePanel, open: false } }); } catch (e) {}
  }

  railBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const name = btn.dataset.panel;
      if (name === "readaloud") {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.WakaTTSPill?.openPanel?.();
        railBtns.forEach((b) => b.classList.toggle("active", b === btn));
        return;
      }
      if (sideOpen && activePanel === name) closeSide();
      else showPanel(name);
    });
  });

  // nút ẩn cũ trong app.js vẫn gọi được: bật/tắt bảng
  const legacyToggle = $("#btn-toggle-sidebar");
  if (legacyToggle) {
    legacyToggle.addEventListener("click", () => (sideOpen ? closeSide() : showPanel(activePanel)));
  }

  function onPanelShown(name) {
    if (name === "search") {
      const input = $("#search-input");
      if (input) { input.classList.remove("hidden"); input.focus(); }
    }
    if (name === "toc") renderLibraryList();
    if (name === "images") renderImages();
    if (name === "timeline") renderTimeline();
    if (name === "typography" || name === "theme" || name === "settings") syncControls();
  }

  /* nhóm gập mở */
  document.querySelectorAll(".rd-group-head").forEach((head) => {
    head.addEventListener("click", () => {
      const body = head.nextElementSibling;
      if (!body) return;
      const open = body.classList.toggle("hidden") === false;
      head.classList.toggle("open", open);
      if (open && head.dataset.group === "library") renderLibraryList();
    });
  });

  /* ═══════════════════════════════════════════════
     LIBRARY trong bảng TOC
     ═══════════════════════════════════════════════ */

  const libList = $("#rd-library-list");

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function renderLibraryList() {
    if (!libList || libList.classList.contains("hidden")) return;
    const books = await (app().listBooks ? app().listBooks() : Promise.resolve([]));
    const current = app().getBookInfo ? app().getBookInfo() : null;
    if (!books.length) {
      libList.innerHTML = `<p class="sidebar-empty" style="padding-left:22px">Thư viện đang trống.</p>`;
      return;
    }
    libList.innerHTML = books.map((b) => `
      <button class="rd-lib-item${current && current.id === b.id ? " current" : ""}" data-id="${b.id}"
              title="${escapeHtml(b.fileName || b.title)}">
        <span>${escapeHtml(b.fileName || b.title || "Không tên")}</span>
      </button>`).join("");
  }

  if (libList) {
    libList.addEventListener("click", async (e) => {
      const btn = e.target.closest(".rd-lib-item");
      if (!btn) return;
      await (app().openBookById ? app().openBookById(btn.dataset.id) : null);
      renderLibraryList();
    });
  }

  /* ═══════════════════════════════════════════════
     Bảng IMAGE
     ═══════════════════════════════════════════════ */

  const imageGrid = $("#rd-image-grid");
  const imageEmpty = $("#rd-image-empty");
  let imagesForBook = null;

  async function renderImages() {
    if (!imageGrid) return;
    const info = app().getBookInfo ? app().getBookInfo() : null;
    if (!info) { imageGrid.innerHTML = ""; if (imageEmpty) imageEmpty.classList.remove("hidden"); return; }
    if (imagesForBook === info.id) return;

    imageGrid.innerHTML = `<p class="sidebar-empty">Đang đọc ảnh…</p>`;
    const images = await (app().listImages ? app().listImages() : Promise.resolve([]));
    imagesForBook = info.id;

    if (!images.length) {
      imageGrid.innerHTML = "";
      if (imageEmpty) imageEmpty.classList.remove("hidden");
      return;
    }
    if (imageEmpty) imageEmpty.classList.add("hidden");
    imageGrid.innerHTML = images.map((im) => `
      <figure data-url="${im.url}">
        <img src="${im.url}" alt="" loading="lazy">
        <figcaption title="${escapeHtml(im.path)}">${escapeHtml(im.name)}</figcaption>
      </figure>`).join("");
  }

  if (imageGrid) {
    imageGrid.addEventListener("click", (e) => {
      const fig = e.target.closest("figure[data-url]");
      if (fig) window.open(fig.dataset.url, "_blank");
    });
  }

  /* ═══════════════════════════════════════════════
     Dòng thời gian (phiên đọc hiện tại)
     ═══════════════════════════════════════════════ */

  const timelineEl = $("#rd-timeline");
  const timelineEmpty = $("#rd-timeline-empty");
  const timeline = [];
  let lastSpine = -1;

  function pushTimeline(loc) {
    if (loc.spineIndex === lastSpine) {
      const top = timeline[0];
      if (top) { top.percent = loc.percent; top.at = Date.now(); }
      return;
    }
    lastSpine = loc.spineIndex;
    timeline.unshift({
      spineIndex: loc.spineIndex,
      label: loc.chapter || loc.path || `Phần ${loc.spineIndex + 1}`,
      percent: loc.percent,
      at: Date.now(),
    });
    if (timeline.length > 40) timeline.pop();
    renderTimeline();
  }

  function renderTimeline() {
    if (!timelineEl) return;
    if (timelineEmpty) timelineEmpty.classList.toggle("hidden", timeline.length > 0);
    timelineEl.innerHTML = timeline.map((t) => `
      <button class="rd-tl-item" data-spine="${t.spineIndex}">
        <span class="rd-tl-time">${new Date(t.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="rd-tl-label">${escapeHtml(t.label)}</span>
        <span class="rd-tl-pct">${t.percent}%</span>
      </button>`).join("");
  }

  if (timelineEl) {
    timelineEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".rd-tl-item");
      if (btn && app().gotoSpine) app().gotoSpine(Number(btn.dataset.spine));
    });
  }

  /* ═══════════════════════════════════════════════
     TYPOGRAPHY / THEME
     ═══════════════════════════════════════════════ */

  const modeSelect = $("#rd-mode");
  const columnsSelect = $("#rd-columns");
  const fontFamilyInput = $("#rd-fontfamily");
  const accentInput = $("#rd-accent");
  const selectTextToggle = $("#rd-select-text");

  const DEFAULTS = { fontSize: 19, fontWeight: 400, lineHeight: 1.75, zoom: 1 };

  if (modeSelect) {
    modeSelect.addEventListener("change", async () => {
      // columns độc lập hoàn toàn với mode — chuyển Cuộn/Lật trang không còn đụng tới
      // state.settings.columns nữa, số cột đã chọn giữ nguyên ở cả 2 mode.
      await app().setMode(modeSelect.value === "scroll" ? "scroll" : "paginated");
      syncColumnsControlState();
    });
  }

  if (columnsSelect) {
    columnsSelect.addEventListener("change", () => {
      // Chỉ đổi số cột, không đụng tới mode.
      app().setColumns(columnsSelect.value === "2" ? 2 : 1);
    });
  }

  /** Số cột giờ có ý nghĩa ở cả Lật trang lẫn Cuộn, nên control này luôn bật —
   *  hàm giữ lại (no-op) vì vẫn còn nơi khác gọi tới khi đồng bộ UI settings. */
  function syncColumnsControlState() {
    if (!columnsSelect) return;
    columnsSelect.disabled = false;
  }

  if (fontFamilyInput) {
    let t;
    fontFamilyInput.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        // Bỏ trống = dùng đúng font gốc của EPUB (không ép "serif" như trước — ép mặc
        // định lên tất cả epub, kể cả epub có font nhúng riêng, là nguyên nhân gây lỗi).
        const v = fontFamilyInput.value.trim();
        app().setFontFamily && app().setFontFamily(v);
      }, 400);
    });
  }
  const fontReset = $("#rd-fontfamily-reset");
  if (fontReset) fontReset.addEventListener("click", () => {
    if (fontFamilyInput) fontFamilyInput.value = "";
    app().setFontFamily && app().setFontFamily(""); // về đúng font gốc EPUB
  });

  const fontPresetBtns = Array.from(document.querySelectorAll("[data-font-preset]"));
  if (fontPresetBtns.length) {
    fontPresetBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.fontPreset || ""; // "" = EPUB gốc, hoặc "serif"/"sans"/"dyslexic"
        if (fontFamilyInput) fontFamilyInput.value = ""; // ô nhập chỉ dành cho tên font tuỳ chỉnh
        fontPresetBtns.forEach((b) => b.classList.toggle("active", b === btn));
        app().setFontFamily && app().setFontFamily(preset);
      });
    });
  }

  const SETTERS = {
    fontSize: (v) => app().setFontSize(v),
    fontWeight: (v) => app().setFontWeight(v),
    lineHeight: (v) => app().setLineHeight(v),
    zoom: (v) => app().setZoom(v),
  };

  document.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.step;
      const delta = Number(btn.dataset.delta);
      const s = app().getSettings ? app().getSettings() : DEFAULTS;
      const next = Math.round(((Number(s[key]) || DEFAULTS[key]) + delta) * 100) / 100;
      SETTERS[key] && SETTERS[key](next);
    });
  });

  document.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.reset;
      SETTERS[key] && SETTERS[key](DEFAULTS[key]);
    });
  });

  if (accentInput) {
    accentInput.addEventListener("input", () => app().setAccent && app().setAccent(accentInput.value));
  }

  if (selectTextToggle) {
    selectTextToggle.addEventListener("change", () => {
      app().setSelectTextEnabled && app().setSelectTextEnabled(selectTextToggle.checked);
    });
  }

  const resetTypo = $("#rd-reset-typo");
  if (resetTypo) resetTypo.addEventListener("click", () => {
    app().resetSettings && app().resetSettings();
    if (fontFamilyInput) fontFamilyInput.value = "";
  });

  // Không giả lập .click() lên #btn-music nữa (gây double-click ảo khiến panel tự
  // đóng ngay) — gọi thẳng API của features.js. Bản thân #rd-open-music cũng đã được
  // đăng ký làm trigger hợp lệ của musicPanel bên features.js nên click ra ngoài vẫn
  // đóng đúng, còn click vào chính nút này thì không bị tự đóng.
  const openMusic = $("#rd-open-music");
  if (openMusic) openMusic.addEventListener("click", (e) => {
    e.stopPropagation();
    const rf = window.ReaderFeatures;
    if (rf && rf.toggleMusicPanel) rf.toggleMusicPanel();
  });

  const backLib = $("#rd-back-library");
  if (backLib) backLib.addEventListener("click", () => {
    const btn = $("#btn-back-library");
    if (btn) btn.click();
  });

  function syncControls() {
    const s = app().getSettings ? app().getSettings() : null;
    if (!s) return;

    if (modeSelect) modeSelect.value = s.mode === "paginated" ? "paginated" : "scroll";
    if (columnsSelect) columnsSelect.value = Number(s.columns) === 2 ? "2" : "1";
    syncColumnsControlState();
    const isPreset = !s.fontFamily || ["serif", "sans", "dyslexic"].includes(s.fontFamily);
    if (fontFamilyInput && document.activeElement !== fontFamilyInput) {
      fontFamilyInput.value = isPreset ? "" : (s.fontFamily || "");
    }
    if (fontPresetBtns.length) {
      fontPresetBtns.forEach((b) => b.classList.toggle("active", (b.dataset.fontPreset || "") === (s.fontFamily || "")));
    }
    if (accentInput && /^#[0-9a-f]{6}$/i.test(s.accent || "")) accentInput.value = s.accent;
    if (selectTextToggle) selectTextToggle.checked = s.selectTextEnabled !== false;

    const set = (id, text) => { const e = $(id); if (e) e.textContent = text; };
    set("#rd-fontsize-value", (s.fontSize || 19) + "px");
    set("#rd-fontweight-value", String(s.fontWeight || 400));
    set("#rd-lineheight-value", (Math.round((s.lineHeight || 1.75) * 100) / 100).toFixed(2));
    set("#rd-zoom-value", Math.round((s.zoom || 1) * 100) + "%");

    document.querySelectorAll(".rd-swatch[data-theme]").forEach((b) =>
      b.classList.toggle("active", !s.bgImage && b.dataset.theme === s.theme));
    document.querySelectorAll(".rd-swatch[data-bg-image]").forEach((b) =>
      b.classList.toggle("active", b.dataset.bgImage === s.bgImage));
    const bgOpacityWrap = $("#rd-bg-opacity-wrap");
    const bgOpacityInput = $("#rd-bg-opacity");
    const bgOpacityValue = $("#rd-bg-opacity-value");
    const bgOpacityPct = Math.round((Number(s.bgImageOpacity ?? 0.5)) * 100);
    if (bgOpacityWrap) bgOpacityWrap.classList.toggle("hidden", !s.bgImage);
    if (bgOpacityInput && document.activeElement !== bgOpacityInput) bgOpacityInput.value = String(bgOpacityPct);
    if (bgOpacityValue) bgOpacityValue.textContent = bgOpacityPct + "%";

    readerView.classList.toggle("rd-dark", (s.bgImage && s.bgImage !== "white" && s.bgImage !== "warm-paper") || s.theme === "dark");
  }

  document.addEventListener("reader:settings", syncControls);

  /* ═══════════════════════════════════════════════
     Thanh tab · dòng chương · chân trang
     ═══════════════════════════════════════════════ */

  const pageCount = $("#rd-pagecount");
  const srcPath = $("#rd-srcpath");
  const tabName = $("#reader-book-title");

  document.addEventListener("reader:location", (e) => {
    const loc = e.detail || {};
    if (pageCount) {
      pageCount.textContent = loc.mode === "paginated"
        ? `${loc.page} / ${loc.totalPages}`
        : `Phần ${loc.spineIndex + 1} / ${loc.spineCount}`;
    }
    if (srcPath) {
      // 6.8.3: #rd-srcpath giờ hiện TÊN CHƯƠNG đang đọc (không còn là đường dẫn file).
      const chapter = String(loc.chapter || "").trim();
      const label = chapter && chapter !== "—" ? chapter : "—";
      if (srcPath.textContent !== label) srcPath.textContent = label;
      const pos = loc.mode === "paginated"
        ? `${loc.page} / ${loc.totalPages}`
        : `Phần ${loc.spineIndex + 1} / ${loc.spineCount}`;
      srcPath.title = label === "—" ? pos : `${label} — ${pos}`;
    }
    pushTimeline(loc);
  });

  // tên tab = tên file cho giống flowoss
  const bookObserver = new MutationObserver(() => {
    const info = app().getBookInfo ? app().getBookInfo() : null;
    if (info && tabName && info.fileName && tabName.textContent !== info.fileName) {
      tabName.textContent = info.fileName;
      tabName.title = `${info.title || ""}${info.creator ? " — " + info.creator : ""}`;
    }
  });
  if (tabName) bookObserver.observe(tabName, { childList: true, characterData: true, subtree: true });

  /* mở sách mới thì làm mới các bảng phụ thuộc vào sách */
  document.addEventListener("reader:location", () => {
    const info = app().getBookInfo ? app().getBookInfo() : null;
    if (info && imagesForBook && imagesForBook !== info.id) {
      imagesForBook = null;
      if (activePanel === "images") renderImages();
    }
  });

  /* Esc đóng bảng khi đang đọc */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (readerView.classList.contains("hidden")) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (sideOpen) closeSide();
  });

  /* ═══════════════════════════════════════════════
     Phím tắt: H/B/M/A/T/S/U
     H = về thư viện · B = đánh dấu nhanh vị trí đang đọc · M = bảng nhạc nền
     A = tab Ghi chú (annotation) · T = tab màu nền (theme) · S = tab tìm kiếm
     U = tab đánh dấu (bookmarks)
     Vô hiệu khi: chưa mở sách, đang gõ trong ô nhập liệu (input/textarea/select,
     kể cả textarea ghi chú của annotation.js — vốn cũng là 1 <textarea> trong
     document cha), đang gõ IME (isComposing), hoặc đang giữ phím tổ hợp
     (Ctrl/Cmd/Alt) để không đụng các phím tắt khác của trình duyệt.
     ═══════════════════════════════════════════════ */

  const SHORTCUT_KEYS = {
    h: () => $("#btn-back-library"),
    b: () => $("#btn-bookmark"),
    m: () => null, // xử lý riêng bên dưới (không phải rail-btn/nút đơn thuần)
    a: () => $("#rd-rail-annotation"),
    t: () => $("#rd-rail-theme"),
    s: () => $("#rd-rail-search"),
    u: () => $("#rd-rail-marks"),
  };

  document.addEventListener("keydown", (e) => {
    if (readerView.classList.contains("hidden")) return;
    if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (document.activeElement && document.activeElement.isContentEditable) return;

    const key = e.key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(SHORTCUT_KEYS, key)) return;

    if (key === "m") {
      const rf = window.ReaderFeatures;
      if (rf && rf.toggleMusicPanel) rf.toggleMusicPanel();
      e.preventDefault();
      return;
    }

    const target = SHORTCUT_KEYS[key]();
    if (target) {
      target.click();
      e.preventDefault();
    }
  });

  /* ═══════════════════════════════════════════════
     Khởi động
     ═══════════════════════════════════════════════ */

  function syncI18nTitle() {
    if (sideTitle) {
      sideTitle.textContent = tr(PANEL_TITLE_KEYS[activePanel], PANEL_TITLES[activePanel] || activePanel.toUpperCase());
    }
  }
  document.addEventListener("i18n:ready", syncI18nTitle);
  document.addEventListener("i18n:changed", syncI18nTitle);

  try {
    chrome.storage.local.get([SIDE_KEY], (res) => {
      const saved = (res && res[SIDE_KEY]) || {};
      activePanel = PANEL_TITLES[saved.panel] && saved.panel !== "readaloud" ? saved.panel : "toc";
      if (saved.open === false) { showPanel(activePanel); closeSide(); }
      else showPanel(activePanel);
      syncControls();
    });
  } catch (e) {
    showPanel("toc");
    syncControls();
  }
})();
