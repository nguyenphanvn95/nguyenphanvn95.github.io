// library-ui.js — bố cục thư viện kiểu flowoss
// Thanh công cụ dọc bên trái · nhập epub từ URL · Export/Import · tìm kiếm ·
// đổi cỡ bìa / kiểu xem · thống kê · cài đặt mặc định.
// Chạy sau app.js và features.js, dùng window.ReaderApp.

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const app = () => window.ReaderApp || {};

  const UI_KEY = "reader-library-ui";
  const SORT_KEYS = ["title", "author", "series", "dateRead", "dateAdded", "datePublished"];
  const PERSIST_KEYS = ["density", "view", "dark", "cols", "covers", "hideCovers", "showRecent", "sortBy", "sortDir"];
  const ui = {
    density: "md", view: "grid", dark: false, query: "",
    // 6.9.0 — tuỳ chọn của menu Hiển thị (mobile)
    cols: "auto",          // "auto" hoặc số cột 2..8
    covers: "crop",        // "crop" | "fit"
    hideCovers: false,
    showRecent: false,
    sortBy: "dateRead",    // mặc định = thứ tự cũ (lastOpened giảm dần)
    sortDir: "desc",
  };

  /** Chuẩn hoá giá trị đọc từ storage / từ LibraryUI.set(). */
  function sanitizeUi() {
    if (ui.view !== "list") ui.view = "grid";
    if (ui.covers !== "fit") ui.covers = "crop";
    if (ui.cols !== "auto") {
      const n = Math.round(Number(ui.cols));
      ui.cols = Number.isFinite(n) ? Math.max(2, Math.min(8, n)) : "auto";
    }
    if (!SORT_KEYS.includes(ui.sortBy)) ui.sortBy = "dateRead";
    if (ui.sortDir !== "asc") ui.sortDir = "desc";
    ui.hideCovers = !!ui.hideCovers;
    ui.showRecent = !!ui.showRecent;
  }

  const libraryView = $("#library-view");
  const grid = $("#library-grid");
  const dropzone = $("#dropzone");
  const emptyHint = $("#lib-empty-hint");
  const noMatch = $("#lib-nomatch");

  /* ═══════════════════════════════════════════════
     Lưu / nạp tuỳ chọn giao diện thư viện
     ═══════════════════════════════════════════════ */

  function saveUi() {
    try {
      const data = {};
      PERSIST_KEYS.forEach((k) => { data[k] = ui[k]; });
      chrome.storage.local.set({ [UI_KEY]: data });
    } catch (e) {}
  }

  function loadUi() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([UI_KEY], (res) => {
          Object.assign(ui, res[UI_KEY] || {});
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  function applyUi() {
    if (!libraryView) return;
    libraryView.classList.remove("density-sm", "density-md", "density-lg");
    libraryView.classList.add("density-" + ui.density);
    libraryView.classList.toggle("view-list", ui.view === "list");
    libraryView.classList.toggle("lib-dark", !!ui.dark);
    libraryView.classList.toggle("covers-fit", ui.covers === "fit");      // 6.9.0 · Bìa: Crop/Fit
    libraryView.classList.toggle("hide-covers", !!ui.hideCovers);         // 6.9.0 · Ẩn bìa
    const btnView = $("#rail-view");
    if (btnView) btnView.classList.toggle("active", ui.view === "list");
    const btnTheme = $("#rail-theme");
    if (btnTheme) btnTheme.classList.toggle("active", !!ui.dark);
    // #book-info-modal không nằm trong #library-view (2 phần tử anh em trong <body>)
    // nên không thừa hưởng được biến --lib-* của .lib-dark — gắn class riêng để
    // modal đổi màu theo đúng theme thư viện khi được mở từ màn hình thư viện.
    // (app.js sẽ ghi đè --modal-bg/--modal-fg lên chính element này khi modal được
    // mở trong lúc đang đọc, ưu tiên cao hơn class này nhờ specificity của inline style.)
    const bookInfoModal = $("#book-info-modal");
    if (bookInfoModal) bookInfoModal.classList.toggle("modal-light", !ui.dark);
  }

  /* ═══════════════════════════════════════════════
     Trạng thái rỗng + lọc theo từ khoá
     ═══════════════════════════════════════════════ */

  /** Bỏ dấu tiếng Việt + về chữ thường: "Đắc nhân tâm" khớp với "dac nhan tam". */
  const fold = (s) => String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

  function refreshGridState() {
    const cards = Array.from(grid ? grid.querySelectorAll(".book-card") : []);
    const total = cards.length;
    const q = fold(ui.query.trim());

    let visible = 0;
    cards.forEach((card) => {
      if (card._sf === undefined) card._sf = fold(card.dataset.search);   // cache theo từng thẻ (thẻ được vẽ mới sau mỗi renderLibrary)
      const hit = !q || card._sf.includes(q);
      card.classList.toggle("hidden", !hit);
      if (hit) visible++;
    });

    if (dropzone) {
      dropzone.classList.toggle("compact", total > 0);
      dropzone.classList.toggle("hidden", total > 0 && !!q);
    }
    if (emptyHint) emptyHint.classList.toggle("hidden", total > 0);
    if (noMatch) noMatch.classList.toggle("hidden", !(q && visible === 0 && total > 0));

    document.dispatchEvent(new CustomEvent("library:filtered", {
      detail: { total, visible, query: q, rawQuery: ui.query },
    }));
  }

  /** Đặt từ khoá tìm kiếm — đồng bộ ô tìm của desktop (#lib-search-input) và của mobile (#lib-msearch-input). */
  function setQuery(value) {
    ui.query = String(value || "");
    const d = $("#lib-search-input");
    if (d && d.value !== ui.query) d.value = ui.query;
    const m = $("#lib-msearch-input");
    if (m && m.value !== ui.query) m.value = ui.query;
    refreshGridState();
  }

  document.addEventListener("library:rendered", refreshGridState);

  /* ═══════════════════════════════════════════════
     Nhập EPUB từ URL
     ═══════════════════════════════════════════════ */

  const urlInput = $("#url-input");
  const btnUrlOpen = $("#btn-url-open");
  const btnUrlPaste = $("#btn-url-paste");

  function submitUrl() {
    if (!urlInput) return;
    const value = urlInput.value.trim();
    if (!value) { app().toast && app().toast("Hãy dán đường dẫn file .epub.", true); return; }
    app().importFromUrl && app().importFromUrl(value);
    urlInput.value = "";
  }

  if (btnUrlOpen) btnUrlOpen.addEventListener("click", submitUrl);
  if (urlInput) {
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submitUrl(); }
    });
  }
  if (btnUrlPaste && urlInput) {
    btnUrlPaste.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) { urlInput.value = text.trim(); urlInput.focus(); }
      } catch (e) {
        app().toast && app().toast("Trình duyệt không cho đọc clipboard — hãy dán bằng Ctrl+V.", true);
      }
    });
  }

  /* ═══════════════════════════════════════════════
     Import / Export
     ═══════════════════════════════════════════════ */

  const btnImport = $("#btn-import");
  const btnExport = $("#btn-export");
  const btnBulkExport = $("#btn-bulk-export");

  if (btnImport) btnImport.addEventListener("click", () => app().openFilePicker && app().openFilePicker());
  const railImport = $("#rail-import");
  if (railImport) railImport.addEventListener("click", () => app().openFilePicker && app().openFilePicker());

  function selectedIds() {
    return Array.from(grid ? grid.querySelectorAll(".book-card.selected") : []).map((c) => c.dataset.id);
  }

  async function exportBooks(ids) {
    if (!ids.length) { app().toast && app().toast("Chưa có sách nào để xuất.", true); return; }
    app().loading && app().loading(true, "Đang chuẩn bị file…");
    let ok = 0;
    for (const id of ids) {
      try {
        const record = await BookDB.getBook(id);
        if (!record || !record.buffer) continue;
        const blob = new Blob([record.buffer], { type: "application/epub+zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = record.fileName || ((record.title || "sach") + ".epub");
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        ok++;
        await new Promise((r) => setTimeout(r, 350)); // tránh bị trình duyệt chặn tải hàng loạt
      } catch (err) { console.error(err); }
    }
    app().loading && app().loading(false);
    app().toast && app().toast(`Đã xuất ${ok} file .epub.`);
  }

  // Logic export giữ nguyên: xuất sách đã chọn, hoặc toàn bộ thư viện nếu chưa chọn.
  async function handleExport() {
    const sel = selectedIds();
    if (sel.length) return exportBooks(sel);
    const books = await (app().listBooks ? app().listBooks() : Promise.resolve([]));
    if (!books.length) { app().toast && app().toast("Thư viện đang trống.", true); return; }
    if (!confirm(`Xuất toàn bộ ${books.length} cuốn sách ra file .epub?`)) return;
    exportBooks(books.map((b) => b.id));
  }

  if (btnExport) btnExport.addEventListener("click", handleExport);

  // Nút Export trên thanh trái (các nút cũ ở màn hình library đã bị ẩn bằng CSS)
  const railExport = $("#rail-export");
  if (railExport) railExport.addEventListener("click", handleExport);

  // Nút Chọn nhiều trên thanh trái: bật/tắt chế độ chọn bằng đúng logic của app.js
  const railSelect = $("#rail-select");
  const bulkBarEl = $("#bulk-bar");
  if (railSelect) {
    railSelect.addEventListener("click", () => {
      const selecting = bulkBarEl && !bulkBarEl.classList.contains("hidden");
      const target = $(selecting ? "#btn-select-cancel" : "#btn-select-mode");
      if (target) target.click();
    });
    // Đồng bộ trạng thái sáng của nút khi chế độ chọn bật/tắt (kể cả khi bấm Huỷ ở bulk-bar)
    if (bulkBarEl) {
      const syncSelectBtn = () => {
        railSelect.classList.toggle("active", !bulkBarEl.classList.contains("hidden"));
      };
      new MutationObserver(syncSelectBtn).observe(bulkBarEl, { attributes: true, attributeFilter: ["class", "style"] });
      syncSelectBtn();
    }
  }

  if (btnBulkExport) {
    btnBulkExport.addEventListener("click", () => exportBooks(selectedIds()));
  }

  /* ═══════════════════════════════════════════════
     Thanh công cụ dọc — tìm kiếm
     ═══════════════════════════════════════════════ */

  const railSearch = $("#rail-search");
  const searchBar = $("#lib-search-bar");
  const searchInput = $("#lib-search-input");
  const searchClear = $("#lib-search-clear");

  if (railSearch && searchBar) {
    railSearch.addEventListener("click", () => {
      const open = searchBar.classList.toggle("hidden") === false;
      railSearch.classList.toggle("active", open);
      if (open && searchInput) searchInput.focus();
      if (!open) setQuery("");
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      setQuery(searchInput.value);
    });
  }

  if (searchClear && searchInput) {
    searchClear.addEventListener("click", () => {
      setQuery("");
      searchInput.focus();
    });
  }

  /* ═══════════════════════════════════════════════
     Cỡ bìa · kiểu xem · sáng tối
     ═══════════════════════════════════════════════ */

  const DENSITIES = ["sm", "md", "lg"];
  const railDensity = $("#rail-density");
  if (railDensity) {
    railDensity.addEventListener("click", () => {
      const i = DENSITIES.indexOf(ui.density);
      ui.density = DENSITIES[(i + 1) % DENSITIES.length];
      applyUi(); saveUi();
    });
  }

  const railView = $("#rail-view");
  if (railView) {
    railView.addEventListener("click", () => {
      ui.view = ui.view === "grid" ? "list" : "grid";
      applyUi(); saveUi();
    });
  }

  const railTheme = $("#rail-theme");
  if (railTheme) {
    railTheme.addEventListener("click", () => {
      ui.dark = !ui.dark;
      applyUi(); saveUi();
    });
  }

  /* ═══════════════════════════════════════════════
     Bảng nhỏ: thống kê · chữ · cài đặt
     ═══════════════════════════════════════════════ */

  const panel = $("#rail-panel");
  const panelTitle = $("#rail-panel-title");
  const panelBody = $("#rail-panel-body");
  const panelClose = $("#rail-panel-close");
  let panelOwner = null;

  function closePanel() {
    if (panel) panel.classList.add("hidden");
    document.querySelectorAll(".rail-btn.active").forEach((b) => {
      if (b.id !== "rail-view" && b.id !== "rail-theme" && b.id !== "rail-search" && b.id !== "rail-select") b.classList.remove("active");
    });
    panelOwner = null;
  }

  function openPanel(owner, title, html, onMount) {
    if (!panel) return;
    if (panelOwner === owner) { closePanel(); return; }
    closePanel();
    panelOwner = owner;
    panelTitle.textContent = title;
    panelBody.innerHTML = html;
    panel.classList.remove("hidden");
    const btn = $("#" + owner);
    if (btn) btn.classList.add("active");
    if (onMount) onMount();
  }

  if (panelClose) panelClose.addEventListener("click", closePanel);

  document.addEventListener("click", (e) => {
    if (!panel || panel.classList.contains("hidden")) return;
    if (panel.contains(e.target)) return;
    if (e.target.closest(".rail-btn")) return;
    closePanel();
  });

  /* ---- thống kê ---- */

  function fmtSize(bytes) {
    if (!bytes) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    let v = bytes, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  }

  const railStats = $("#rail-stats");
  if (railStats) {
    railStats.addEventListener("click", async () => {
      const books = await (app().listBooks ? app().listBooks() : Promise.resolve([]));
      const size = books.reduce((s, b) => s + (b.fileSize || 0), 0);
      const reading = books.filter((b) => b.position && b.position.spineIndex > 0).length;
      const marks = books.reduce((s, b) => s + ((b.bookmarks || []).length), 0);
      const last = books[0];
      openPanel("rail-stats", "Thống kê đọc", `
        <div class="rp-row"><span class="rp-label">Tổng số sách</span><span class="rp-value">${books.length}</span></div>
        <div class="rp-row"><span class="rp-label">Đang đọc dở</span><span class="rp-value">${reading}</span></div>
        <div class="rp-row"><span class="rp-label">Đánh dấu</span><span class="rp-value">${marks}</span></div>
        <div class="rp-row"><span class="rp-label">Dung lượng</span><span class="rp-value">${fmtSize(size)}</span></div>
        <p class="rp-hint">${last ? "Gần nhất: " + escapeHtml(last.title || last.fileName || "") : "Thư viện đang trống."}</p>
      `);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---- chữ mặc định ---- */

  const FONT_OPTIONS = [
    ["serif", "Chữ có chân (Georgia)"],
    ["sans", "Chữ không chân"],
    ["dyslexic", "Dễ đọc (Verdana)"],
  ];

  const railTypo = $("#rail-typo");
  if (railTypo) {
    railTypo.addEventListener("click", () => {
      const s = app().getSettings ? app().getSettings() : { fontSize: 19, fontFamily: "serif" };
      openPanel("rail-typo", "Chữ mặc định", `
        <div class="rp-row">
          <span class="rp-label">Cỡ chữ</span>
          <span class="rp-group">
            <button class="rp-chip" data-size="-1">A−</button>
            <span class="rp-value" id="rp-size">${s.fontSize}px</span>
            <button class="rp-chip" data-size="1">A+</button>
          </span>
        </div>
        <div class="rp-row" style="display:block">
          <span class="rp-label">Phông chữ</span>
          <select class="rp-select" id="rp-font" style="margin-top:8px">
            ${FONT_OPTIONS.map(([v, l]) => `<option value="${v}"${v === s.fontFamily ? " selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <p class="rp-hint">Áp dụng cho mọi sách bạn mở. Trong lúc đọc vẫn có thể chỉnh riêng ở nút bánh răng.</p>
      `, () => {
        panelBody.querySelectorAll("[data-size]").forEach((b) =>
          b.addEventListener("click", async () => {
            await (app().changeFontSize ? app().changeFontSize(Number(b.dataset.size)) : null);
            const cur = app().getSettings ? app().getSettings().fontSize : "";
            const label = $("#rp-size");
            if (label) label.textContent = cur + "px";
          })
        );
        const sel = $("#rp-font");
        if (sel) sel.addEventListener("change", () => app().setFontFamily && app().setFontFamily(sel.value));
      });
    });
  }

  /* ---- cài đặt ---- */

  const railSettings = $("#rail-settings");
  if (railSettings) {
    railSettings.addEventListener("click", () => {
      const s = app().getSettings ? app().getSettings() : { mode: "scroll", columns: 1 };
      openPanel("rail-settings", "Cài đặt thư viện", `
        <div class="rp-row">
          <span class="rp-label">Kiểu đọc</span>
          <span class="rp-group">
            <button class="rp-chip${s.mode === "scroll" ? " active" : ""}" data-mode="scroll">Cuộn</button>
            <button class="rp-chip${s.mode === "paginated" ? " active" : ""}" data-mode="paginated">Lật trang</button>
          </span>
        </div>
        <div class="rp-row">
          <span class="rp-label">Số cột</span>
          <span class="rp-group">
            <button class="rp-chip${s.columns === 2 ? "" : " active"}" data-cols="1">1 cột</button>
            <button class="rp-chip${s.columns === 2 ? " active" : ""}" data-cols="2">2 cột</button>
          </span>
        </div>
        <div class="rp-row">
          <span class="rp-label">Cỡ bìa</span>
          <span class="rp-group">
            ${DENSITIES.map((d) => `<button class="rp-chip${ui.density === d ? " active" : ""}" data-density="${d}">${d === "sm" ? "Nhỏ" : d === "md" ? "Vừa" : "Lớn"}</button>`).join("")}
          </span>
        </div>
        <button class="rp-danger" id="rp-clear">Xoá toàn bộ thư viện</button>
        <p class="rp-hint">Sách được lưu ngoại tuyến trong trình duyệt, không tải lên máy chủ nào.</p>
      `, () => {
        panelBody.querySelectorAll("[data-mode]").forEach((b) =>
          b.addEventListener("click", () => {
            app().setMode && app().setMode(b.dataset.mode);
            panelBody.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("active", x === b));
          })
        );
        panelBody.querySelectorAll("[data-cols]").forEach((b) =>
          b.addEventListener("click", () => {
            app().setColumns && app().setColumns(Number(b.dataset.cols));
            panelBody.querySelectorAll("[data-cols]").forEach((x) => x.classList.toggle("active", x === b));
          })
        );
        panelBody.querySelectorAll("[data-density]").forEach((b) =>
          b.addEventListener("click", () => {
            ui.density = b.dataset.density;
            applyUi(); saveUi();
            panelBody.querySelectorAll("[data-density]").forEach((x) => x.classList.toggle("active", x === b));
          })
        );
        const clear = $("#rp-clear");
        if (clear) clear.addEventListener("click", async () => {
          const books = await (app().listBooks ? app().listBooks() : Promise.resolve([]));
          if (!books.length) { app().toast && app().toast("Thư viện đang trống."); return; }
          if (!confirm(`Xoá toàn bộ ${books.length} cuốn sách khỏi thư viện? Không thể hoàn tác.`)) return;
          await BookDB.deleteBooks(books.map((b) => b.id));
          app().renderLibrary && (await app().renderLibrary());
          app().toast && app().toast("Đã xoá toàn bộ thư viện.");
          closePanel();
        });
      });
    });
  }

  /* ═══════════════════════════════════════════════
     Khởi động
     ═══════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════
     6.9.0 — Sắp xếp + API dùng chung cho library-mobile.js / app.js
     ═══════════════════════════════════════════════ */

  /** Sắp xếp danh sách sách theo ui.sortBy / ui.sortDir. Giá trị thiếu luôn nằm cuối, bất kể chiều sắp xếp. */
  function sortBooks(books) {
    const dir = ui.sortDir === "asc" ? 1 : -1;
    let collator;
    try {
      collator = new Intl.Collator((window.I18n && window.I18n.locale && window.I18n.locale()) || "vi", { sensitivity: "base", numeric: true });
    } catch (e) {
      collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    }
    const time = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
    const getters = {
      title: (b) => (b.title || "").trim() || null,
      author: (b) => (b.creator || "").trim() || null,
      series: (b) => (b.series || "").trim() || null,
      dateRead: (b) => b.lastOpened || null,          // lastOpened = ngày thêm cho tới khi mở đọc lần đầu
      dateAdded: (b) => b.addedAt || null,
      datePublished: (b) => (b.pubDate ? time(b.pubDate) : null),
    };
    const get = getters[ui.sortBy] || getters.dateRead;
    const tie = (a, b) => collator.compare(a.title || "", b.title || "");

    return books.slice().sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === null || vb === null) return va === vb ? tie(a, b) : (va === null ? 1 : -1);
      let c = typeof va === "number" ? va - vb : collator.compare(va, vb);
      if (!c && ui.sortBy === "series") c = (a.seriesIndex || 0) - (b.seriesIndex || 0);   // cùng bộ → theo tập
      return c ? c * dir : tie(a, b);
    });
  }

  // nút "tải file" trên từng thẻ sách phát sự kiện này (xem app.js)
  document.addEventListener("library:export", (e) => exportBooks((e.detail && e.detail.ids) || []));

  const ready = (async () => {
    await loadUi();
    sanitizeUi();
    applyUi();
    refreshGridState();
    // thứ tự sắp xếp đã lưu khác mặc định → vẽ lại thư viện một lần cho đúng thứ tự
    if (ui.sortBy !== "dateRead" || ui.sortDir !== "desc") {
      const a = app();
      if (a.renderLibrary) await a.renderLibrary();
    }
  })();

  window.LibraryUI = {
    ready,
    prefs: () => ({ ...ui }),
    getQuery: () => ui.query,
    setQuery,
    /** Cập nhật tuỳ chọn hiển thị. opts.rerender = true khi thứ tự sắp xếp thay đổi. */
    set(patch, opts = {}) {
      Object.assign(ui, patch);
      sanitizeUi();
      applyUi();
      saveUi();
      if (opts.rerender) { const a = app(); if (a.renderLibrary) a.renderLibrary(); }
      document.dispatchEvent(new CustomEvent("library:prefs", { detail: { ...ui } }));
    },
    sortBooks,
    refresh: refreshGridState,
    exportBooks,
  };
})();
