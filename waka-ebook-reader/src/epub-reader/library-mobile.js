// library-mobile.js — Thư viện ở MOBILE MODE (6.9.0)
// Toolbar (tìm kiếm + nhập) · menu Hiển thị · menu Khác (popover) ·
// bottom sheet (Nhập sách / Thống kê / Chữ mặc định / Cài đặt) · dải "Đọc gần đây".
// Chạy sau library-ui.js. Phụ thuộc: window.LibraryUI, window.ReaderApp, window.I18n.
// Không dùng inline handler (CSP của extension: script-src 'self').

(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const lib = $("#library-view");
  const toolbar = $("#lib-mtoolbar");
  if (!lib || !toolbar || !window.LibraryUI) return;

  const LU = window.LibraryUI;
  const app = () => window.ReaderApp || {};

  /* ═══════════════════════════════════════════════
     Tiện ích
     ═══════════════════════════════════════════════ */

  /** Dịch khoá i18n; nếu chưa nạp xong từ điển thì dùng chuỗi dự phòng. */
  const tr = (key, params, fallback) => {
    try {
      const v = window.I18n ? window.I18n.t(key, params) : key;
      return v === key && fallback != null ? fallback : v;
    } catch (e) { return fallback != null ? fallback : key; }
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const isMobileNow = () => getComputedStyle(toolbar).display !== "none";

  const svg = (inner, vb = "0 0 24 24") => `<svg viewBox="${vb}" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    chev: svg('<path d="M6 9l6 6 6-6"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    select: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
    export: svg('<path d="M12 4v11m0 0l-4-4m4 4l4-4"/><path d="M5 19.5h14"/>'),
    stats: svg('<path d="M4 19h16"/><path d="M6 16v-5M11 16V6M16 16v-8"/>'),
    typo: svg('<path d="M4 18 8.5 6l4.5 12"/><path d="M5.6 14h5.8"/><path d="M15 18l3-8 3 8"/><path d="M16 15.5h4"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
    book: svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8M8 11h8"/>'),
  };

  /* ═══════════════════════════════════════════════
     Cột (Columns): Auto hoặc số cố định
     ═══════════════════════════════════════════════ */

  const COL_MIN = 2;
  const COL_MAX = 8;
  let autoN = 3;

  function calcAutoCols(width) {
    // thẻ ~92px + khoảng cách 16px, tối thiểu 3 cột (giống Readest trên điện thoại)
    return clamp(Math.floor((width - 16) / 108), 3, COL_MAX);
  }
  const currentCols = () => (LU.prefs().cols === "auto" ? autoN : LU.prefs().cols);

  function applyCols() {
    const n = currentCols();
    lib.style.setProperty("--m-cols", String(n));
    lib.classList.toggle("cols-dense", n >= 5);
  }

  const mainEl = $(".lib-main", lib);
  if (mainEl && "ResizeObserver" in window) {
    new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w <= 0) return;                       // thư viện đang ẩn (đang mở sách)
      const next = calcAutoCols(w);
      if (next === autoN) return;
      autoN = next;
      applyCols();
      if (popOwner === "view") renderPopover();
    }).observe(mainEl);
  }

  /* ═══════════════════════════════════════════════
     Ô tìm kiếm + placeholder "Tìm trong N sách…"
     ═══════════════════════════════════════════════ */

  const searchInput = $("#lib-msearch-input");
  const searchClear = $("#lib-msearch-clear");
  let bookCount = 0;

  function updatePlaceholder() {
    if (searchInput) searchInput.placeholder = tr("lib.searchIn", { count: bookCount }, `Tìm trong ${bookCount} sách…`);
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => LU.setQuery(searchInput.value));
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") searchInput.blur(); });
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => { LU.setQuery(""); if (searchInput) searchInput.focus(); });
  }

  /* ═══════════════════════════════════════════════
     Popover (menu Hiển thị / menu Khác)
     ═══════════════════════════════════════════════ */

  const pop = $("#lib-popover");
  const popScrim = $("#lib-popover-scrim");
  const btnView = $("#lib-mview-btn");
  const btnMore = $("#lib-mmore-btn");
  let popOwner = null;      // "view" | "more" | null
  let popBtn = null;
  let sortOpen = false;

  const SORT_KEYS = [
    ["title", "lib.sort.title", "Tiêu đề"],
    ["author", "lib.sort.author", "Tác giả"],
    ["series", "lib.sort.series", "Bộ sách"],
    ["dateRead", "lib.sort.dateRead", "Ngày đọc"],
    ["dateAdded", "lib.sort.dateAdded", "Ngày thêm"],
    ["datePublished", "lib.sort.datePublished", "Ngày xuất bản"],
  ];

  const check = (on) => `<span class="lib-mi-check">${on ? ICON.check : ""}</span>`;

  function viewMenuHtml() {
    const p = LU.prefs();
    const auto = p.cols === "auto";
    const n = currentCols();
    const radio = (act, val, label, on) =>
      `<button type="button" class="lib-mi" role="menuitemradio" aria-checked="${on}" data-act="${act}" data-val="${val}">${check(on)}<span class="lib-mi-label">${esc(label)}</span></button>`;
    const toggle = (act, label, on) =>
      `<button type="button" class="lib-mi" role="menuitemcheckbox" aria-checked="${on}" data-act="${act}">${check(on)}<span class="lib-mi-label">${esc(label)}</span></button>`;

    const sortItems = sortOpen
      ? SORT_KEYS.map(([k, key, fb]) => radio("sort", k, tr(key, null, fb), p.sortBy === k)).join("") +
        `<div class="lib-msep"></div>` +
        radio("dir", "asc", tr("lib.sort.asc", null, "Tăng dần"), p.sortDir === "asc") +
        radio("dir", "desc", tr("lib.sort.desc", null, "Giảm dần"), p.sortDir === "desc")
      : "";

    return [
      radio("view", "list", tr("lib.view.list", null, "Danh sách"), p.view === "list"),
      radio("view", "grid", tr("lib.view.grid", null, "Lưới"), p.view === "grid"),
      `<div class="lib-msep"></div>`,
      `<div class="lib-mlabel">${esc(tr("lib.columns", null, "Số cột"))}</div>`,
      `<div class="lib-mrow${p.view === "list" ? " is-dim" : ""}">
         <button type="button" class="lib-mi" role="menuitemcheckbox" aria-checked="${auto}" data-act="cols-auto">${check(auto)}<span class="lib-mi-label">${esc(tr("lib.auto", null, "Tự động"))}</span></button>
         <span class="lib-stepper">
           <button type="button" class="lib-step-btn" data-act="cols-dec" aria-label="−"${auto || n <= COL_MIN ? " disabled" : ""}>${ICON.minus}</button>
           <span class="lib-step-num">${n}</span>
           <button type="button" class="lib-step-btn" data-act="cols-inc" aria-label="+"${auto || n >= COL_MAX ? " disabled" : ""}>${ICON.plus}</button>
         </span>
       </div>`,
      `<div class="lib-msep"></div>`,
      `<div class="lib-mlabel">${esc(tr("lib.covers", null, "Bìa sách"))}</div>`,
      radio("covers", "crop", tr("lib.cover.crop", null, "Cắt vừa khung"), p.covers === "crop"),
      radio("covers", "fit", tr("lib.cover.fit", null, "Giữ nguyên tỉ lệ"), p.covers === "fit"),
      `<div class="lib-msep"></div>`,
      toggle("hide-covers", tr("lib.hideCovers", null, "Ẩn bìa sách"), p.hideCovers),
      `<div class="lib-msep"></div>`,
      toggle("show-recent", tr("lib.showRecent", null, "Hiện sách đọc gần đây"), p.showRecent),
      `<div class="lib-msep"></div>`,
      `<button type="button" class="lib-mi" data-act="sort-toggle" aria-expanded="${sortOpen}"><span class="lib-mi-check"></span><span class="lib-mi-label">${esc(tr("lib.sortBy", null, "Sắp xếp theo…"))}</span><span class="lib-mi-chev">${ICON.chev}</span></button>`,
      sortItems,
    ].join("");
  }

  function moreMenuHtml() {
    const p = LU.prefs();
    const row = (act, icon, label, right = "", role = "menuitem", extra = "") =>
      `<button type="button" class="lib-mi" role="${role}" ${extra} data-act="${act}"><span class="lib-mi-ico">${icon}</span><span class="lib-mi-label">${esc(label)}</span>${right}</button>`;
    return [
      row("select", ICON.select, tr("lib.selectMultiple", null, "Chọn nhiều")),
      row("export", ICON.export, tr("lib.export", null, "Xuất sách")),
      row("stats", ICON.stats, tr("lib.stats", null, "Thống kê đọc")),
      row("typo", ICON.typo, tr("lib.typoZoom", null, "Cỡ chữ & thu phóng mặc định")),
      row("theme", p.dark ? ICON.sun : ICON.moon, tr("lib.darkMode", null, "Giao diện tối"),
        `<span class="lib-switch${p.dark ? " on" : ""}" aria-hidden="true"><i></i></span>`, "menuitemcheckbox", `aria-checked="${!!p.dark}"`),
      `<div class="lib-msep"></div>`,
      row("settings", ICON.gear, tr("lib.settings", null, "Cài đặt")),
    ].join("");
  }

  function renderPopover() {
    if (!popOwner || !pop) return;
    const st = pop.scrollTop;
    pop.innerHTML = popOwner === "view" ? viewMenuHtml() : moreMenuHtml();
    pop.scrollTop = st;
  }

  function placePopover(btn) {
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(popOwner === "more" ? 320 : 290, vw - 16);
    const left = clamp(r.right - width, 8, vw - width - 8);
    pop.style.width = width + "px";
    pop.style.left = left + "px";
    pop.style.top = Math.round(r.bottom + 6) + "px";
    pop.style.maxHeight = Math.max(180, vh - r.bottom - 16) + "px";
  }

  function openPopover(owner, btn) {
    if (popOwner === owner) { closePopover(); return; }
    closePopover();
    closeSheet();
    popOwner = owner;
    popBtn = btn;
    btn.setAttribute("aria-expanded", "true");
    renderPopover();
    pop.classList.remove("hidden");
    popScrim.classList.remove("hidden");
    placePopover(btn);
  }

  function closePopover() {
    if (!popOwner) return;
    popOwner = null;
    if (popBtn) popBtn.setAttribute("aria-expanded", "false");
    popBtn = null;
    pop.classList.add("hidden");
    popScrim.classList.add("hidden");
  }

  if (btnView) btnView.addEventListener("click", () => openPopover("view", btnView));
  if (btnMore) btnMore.addEventListener("click", () => openPopover("more", btnMore));
  if (popScrim) popScrim.addEventListener("click", closePopover);

  function stepCols(delta) {
    const p = LU.prefs();
    if (p.cols === "auto") return;
    LU.set({ cols: clamp(p.cols + delta, COL_MIN, COL_MAX) });
    applyCols();
  }

  if (pop) {
    pop.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      const act = btn.dataset.act;
      const val = btn.dataset.val;
      const p = LU.prefs();

      // ── menu Hiển thị: giữ menu mở để thấy kết quả ngay phía sau ──
      if (popOwner === "view") {
        switch (act) {
          case "view": LU.set({ view: val }); break;
          case "cols-auto": LU.set({ cols: p.cols === "auto" ? clamp(autoN, COL_MIN, COL_MAX) : "auto" }); applyCols(); break;
          case "cols-dec": stepCols(-1); break;
          case "cols-inc": stepCols(1); break;
          case "covers": LU.set({ covers: val }); break;
          case "hide-covers": LU.set({ hideCovers: !p.hideCovers }); break;
          case "show-recent": LU.set({ showRecent: !p.showRecent }); renderRecent(); break;
          case "sort-toggle": sortOpen = !sortOpen; break;
          case "sort": LU.set({ sortBy: val }, { rerender: true }); break;
          case "dir": LU.set({ sortDir: val }, { rerender: true }); break;
        }
        renderPopover();
        return;
      }

      // ── menu Khác ──
      if (act === "theme") { LU.set({ dark: !p.dark }); renderPopover(); return; }
      closePopover();
      switch (act) {
        case "select": { const b = $("#btn-select-mode"); if (b) b.click(); break; }
        case "export": { const b = $("#btn-export"); if (b) b.click(); break; }
        case "stats": openStats(); break;
        case "typo": openTypo(); break;
        case "settings": openSettings(); break;
      }
    });
  }

  /* ═══════════════════════════════════════════════
     Bottom sheet (cùng kiểu với #music-panel ở mobile mode)
     ═══════════════════════════════════════════════ */

  const sheet = $("#lib-sheet");
  const sheetCard = sheet ? $(".lib-sheet-card", sheet) : null;
  const sheetTitle = $("#lib-sheet-title");
  const sheetBody = $("#lib-sheet-body");
  let sheetId = null;

  function openSheet(id, title, html, onMount) {
    if (!sheet) return;
    closePopover();
    sheetId = id;
    sheetTitle.textContent = title;
    sheetBody.innerHTML = html;
    sheetBody.scrollTop = 0;
    sheetCard.style.transform = "";
    sheet.classList.remove("hidden");
    sheet.setAttribute("aria-hidden", "false");
    lib.classList.add("lib-sheet-open");
    if (onMount) onMount(sheetBody);
    sheetCard.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!sheet || !sheetId) return;
    sheetId = null;
    sheet.classList.add("hidden");
    sheet.setAttribute("aria-hidden", "true");
    lib.classList.remove("lib-sheet-open");
    sheetCard.style.transform = "";
    sheetBody.innerHTML = "";
  }

  if (sheet) {
    sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
    const closeBtn = $("#lib-sheet-close");
    if (closeBtn) closeBtn.addEventListener("click", closeSheet);

    // vuốt xuống ở tay nắm / tiêu đề để đóng
    [$(".lib-sheet-handle", sheet), $(".lib-sheet-head", sheet)].forEach((grip) => {
      let startY = 0, dy = 0, t0 = 0, dragging = false;
      grip.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        dragging = true; startY = e.clientY; dy = 0; t0 = Date.now();
        grip.setPointerCapture(e.pointerId);
        sheetCard.style.transition = "none";
      });
      grip.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        dy = Math.max(0, e.clientY - startY);
        sheetCard.style.transform = `translateY(${dy}px)`;
      });
      const end = () => {
        if (!dragging) return;
        dragging = false;
        sheetCard.style.transition = "";
        const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
        if (dy > 90 || (fast && dy > 30)) closeSheet();
        else sheetCard.style.transform = "";
      };
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);
    });
  }

  /* ---- Nhập sách (nút +) ---- */

  function openImport() {
    openSheet("import", tr("lib.import", null, "Nhập sách"), `
      <button type="button" class="lib-row-btn" data-act="file">${ICON.file}<span>${esc(tr("lib.import.file", null, "Chọn file EPUB trên máy"))}</span></button>
      <div class="lib-url">
        <span class="lib-url-label">${esc(tr("lib.import.url", null, "Hoặc dán đường dẫn file .epub"))}</span>
        <div class="lib-url-row">
          <input type="url" id="lib-url-input" class="lib-url-input" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…/sach.epub">
          <button type="button" class="lib-btn2" data-act="paste">${esc(tr("lib.import.paste", null, "Dán"))}</button>
        </div>
        <button type="button" class="lib-primary" data-act="url-go">${esc(tr("lib.import.go", null, "Tải & thêm vào thư viện"))}</button>
      </div>`, (body) => {
      const input = $("#lib-url-input", body);
      const submit = () => {
        const v = input.value.trim();
        if (!v) { app().toast && app().toast(tr("lib.import.empty", null, "Hãy dán đường dẫn file .epub."), true); return; }
        closeSheet();
        app().importFromUrl && app().importFromUrl(v);
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      body.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-act]");
        if (!b) return;
        if (b.dataset.act === "file") {
          // phải gọi ngay trong cú chạm (user gesture) thì trình duyệt mới cho mở hộp chọn file
          app().openFilePicker && app().openFilePicker();
          closeSheet();
        } else if (b.dataset.act === "paste") {
          try {
            const text = await navigator.clipboard.readText();
            if (text) { input.value = text.trim(); input.focus(); }
          } catch (err) {
            app().toast && app().toast(tr("lib.import.noClipboard", null, "Trình duyệt không cho đọc clipboard — hãy dán thủ công."), true);
          }
        } else if (b.dataset.act === "url-go") submit();
      });
    });
  }

  const btnAdd = $("#lib-madd");
  if (btnAdd) btnAdd.addEventListener("click", openImport);
  const emptyImport = $("#lib-mempty-import");
  if (emptyImport) emptyImport.addEventListener("click", openImport);

  /* ---- Thống kê đọc ---- */

  function fmtSize(bytes) {
    if (!bytes) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    let v = bytes, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  }

  async function openStats() {
    const books = await (app().listBooks ? app().listBooks() : Promise.resolve([]));
    const size = books.reduce((s, b) => s + (b.fileSize || 0), 0);
    const reading = books.filter((b) => b.position && b.position.spineIndex > 0).length;
    const marks = books.reduce((s, b) => s + ((b.bookmarks || []).length), 0);
    const last = books.slice().sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))[0];
    const row = (label, value) => `<div class="lib-srow lib-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
    openSheet("stats", tr("lib.stats", null, "Thống kê đọc"), `
      <div>
        ${row(tr("lib.stats.total", null, "Tổng số sách"), books.length)}
        ${row(tr("lib.stats.reading", null, "Đang đọc dở"), reading)}
        ${row(tr("lib.stats.bookmarks", null, "Đánh dấu"), marks)}
        ${row(tr("lib.stats.size", null, "Dung lượng"), fmtSize(size))}
      </div>
      <p class="lib-hint">${esc(last
        ? tr("lib.stats.last", { title: last.title || last.fileName || "" }, "Gần nhất: " + (last.title || last.fileName || ""))
        : tr("lib.stats.empty", null, "Thư viện đang trống."))}</p>`);
  }

  /* ---- Cỡ chữ & thu phóng mặc định ---- */

  const FONT_PILLS = [
    ["", "typo.originalFont", "Font gốc"],
    ["bookerly", null, "Bookerly"],
    ["minion", null, "Minion"],
    ["notoserif", null, "Noto Serif"],
    ["roboto", null, "Roboto"],
    ["dyslexic", "typo.easyRead", "Dễ đọc"],
  ];

  function openTypo() {
    const s = app().getSettings ? app().getSettings() : { fontSize: 19, zoom: 1, fontFamily: "" };
    const zoomPct = Math.round((s.zoom || 1) * 100);
    openSheet("typo", tr("lib.typoZoom", null, "Cỡ chữ & thu phóng mặc định"), `
      <div class="lib-field">
        <div class="lib-field-head"><span>${esc(tr("typo.fontSize", null, "Cỡ chữ"))}</span><b id="lib-fs-val">${s.fontSize}px</b></div>
        <div class="lib-slider"><span class="lib-a sm">A</span>
          <input type="range" id="lib-fs" class="lib-range" min="13" max="34" step="1" value="${s.fontSize}" aria-label="${esc(tr("typo.fontSize", null, "Cỡ chữ"))}">
          <span class="lib-a lg">A</span></div>
      </div>
      <div class="lib-field">
        <div class="lib-field-head"><span>${esc(tr("typo.zoom", null, "Thu phóng"))}</span><b id="lib-zoom-val">${zoomPct}%</b></div>
        <div class="lib-slider"><span class="lib-a sm">−</span>
          <input type="range" id="lib-zoom" class="lib-range" min="60" max="250" step="5" value="${zoomPct}" aria-label="${esc(tr("typo.zoom", null, "Thu phóng"))}">
          <span class="lib-a lg">+</span></div>
      </div>
      <div class="lib-field">
        <div class="lib-field-head"><span>${esc(tr("typo.fontFamily", null, "Font chữ"))}</span></div>
        <div class="lib-pills" id="lib-font-pills">
          ${FONT_PILLS.map(([v, key, fb]) => `<button type="button" class="lib-pill${(s.fontFamily || "") === v ? " active" : ""}" data-font="${v}">${esc(key ? tr(key, null, fb) : fb)}</button>`).join("")}
        </div>
      </div>
      <p class="lib-hint">${esc(tr("lib.typo.hint", null, "Áp dụng cho mọi sách bạn mở. Trong lúc đọc vẫn chỉnh riêng được."))}</p>`, (body) => {
      const fs = $("#lib-fs", body), fsVal = $("#lib-fs-val", body);
      const zm = $("#lib-zoom", body), zmVal = $("#lib-zoom-val", body);
      fs.addEventListener("input", () => { fsVal.textContent = fs.value + "px"; app().setFontSize && app().setFontSize(fs.value); });
      zm.addEventListener("input", () => { zmVal.textContent = zm.value + "%"; app().setZoom && app().setZoom(Number(zm.value) / 100); });
      $("#lib-font-pills", body).addEventListener("click", (e) => {
        const b = e.target.closest("[data-font]");
        if (!b) return;
        app().setFontFamily && app().setFontFamily(b.dataset.font);
        body.querySelectorAll("[data-font]").forEach((x) => x.classList.toggle("active", x === b));
      });
    });
  }

  /* ---- Cài đặt thư viện ---- */

  function openSettings() {
    const s = app().getSettings ? app().getSettings() : { mode: "scroll", columns: 1 };
    const seg = (attr, val, label, on) => `<button type="button" class="lib-pill${on ? " active" : ""}" data-${attr}="${val}">${esc(label)}</button>`;
    openSheet("settings", tr("lib.settings", null, "Cài đặt"), `
      <div class="lib-field">
        <div class="lib-field-head"><span>${esc(tr("typo.mode", null, "Chế độ đọc"))}</span></div>
        <div class="lib-seg">
          ${seg("mode", "scroll", tr("typo.scroll", null, "Cuộn dọc"), s.mode !== "paginated")}
          ${seg("mode", "paginated", tr("typo.paginated", null, "Lật trang"), s.mode === "paginated")}
        </div>
      </div>
      <div class="lib-field">
        <div class="lib-field-head"><span>${esc(tr("typo.columns", null, "Số cột"))}</span></div>
        <div class="lib-seg">
          ${seg("cols", "1", tr("typo.oneColumn", null, "Một cột"), s.columns !== 2)}
          ${seg("cols", "2", tr("typo.twoColumns", null, "Hai cột"), s.columns === 2)}
        </div>
      </div>
      <button type="button" class="lib-danger" id="lib-clear-all">${esc(tr("lib.clearAll", null, "Xoá toàn bộ thư viện"))}</button>
      <p class="lib-hint">${esc(tr("lib.offlineHint", null, "Sách được lưu ngoại tuyến trong trình duyệt, không tải lên máy chủ nào."))}</p>`, (body) => {
      body.addEventListener("click", async (e) => {
        const m = e.target.closest("[data-mode]");
        const c = e.target.closest("[data-cols]");
        if (m) {
          app().setMode && app().setMode(m.dataset.mode);
          body.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("active", x === m));
        } else if (c) {
          app().setColumns && app().setColumns(Number(c.dataset.cols));
          body.querySelectorAll("[data-cols]").forEach((x) => x.classList.toggle("active", x === c));
        } else if (e.target.closest("#lib-clear-all")) {
          const books = await (app().listBooks ? app().listBooks() : Promise.resolve([]));
          if (!books.length) { app().toast && app().toast(tr("lib.empty.title", null, "Thư viện đang trống.")); return; }
          if (!confirm(tr("lib.clearAll.confirm", { count: books.length }, `Xoá toàn bộ ${books.length} cuốn sách khỏi thư viện? Không thể hoàn tác.`))) return;
          await BookDB.deleteBooks(books.map((b) => b.id));
          app().renderLibrary && (await app().renderLibrary());
          app().toast && app().toast(tr("lib.clearAll.done", null, "Đã xoá toàn bộ thư viện."));
          closeSheet();
        }
      });
    });
  }

  /* ═══════════════════════════════════════════════
     Dải "Đọc gần đây"
     ═══════════════════════════════════════════════ */

  const recentBox = $("#lib-recent");
  const recentList = $("#lib-recent-list");
  let recentBooks = [];
  let recentUrls = [];

  function renderRecent(books) {
    if (Array.isArray(books)) recentBooks = books;
    if (!recentBox || !recentList) return;
    recentUrls.forEach((u) => URL.revokeObjectURL(u));
    recentUrls = [];

    const items = recentBooks
      .filter((b) => b.position)
      .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
      .slice(0, 10);

    const show = LU.prefs().showRecent && items.length > 0 && !LU.getQuery().trim();
    recentBox.classList.toggle("hidden", !show);
    if (!show) { recentList.innerHTML = ""; return; }

    const pct = (b) => (app().estimateProgress ? app().estimateProgress(b) : 0);
    recentList.innerHTML = items.map((b) => {
      let cover = `<em>${esc(b.title || "")}</em>`;
      if (b.coverBlob) {
        const u = URL.createObjectURL(b.coverBlob);
        recentUrls.push(u);
        cover = `<img src="${u}" alt="" loading="lazy" decoding="async" draggable="false">`;
      }
      return `<button type="button" class="lib-recent-item" data-id="${esc(b.id)}" title="${esc(b.title || "")}">
        <span class="lib-recent-cover">${cover}<i style="--p:${pct(b)}%"></i></span>
        <span class="lib-recent-name">${esc(b.title || "")}</span></button>`;
    }).join("");
  }

  if (recentList) {
    recentList.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (b && app().openBookById) app().openBookById(b.dataset.id);
    });
  }

  /* ═══════════════════════════════════════════════
     Sự kiện chung
     ═══════════════════════════════════════════════ */

  document.addEventListener("library:rendered", (e) => {
    const d = e.detail || {};
    bookCount = d.count || 0;
    updatePlaceholder();
    renderRecent(d.books || []);
  });

  document.addEventListener("library:filtered", (e) => {
    const d = e.detail || {};
    if (searchInput && searchInput.value !== d.rawQuery) searchInput.value = d.rawQuery || "";
    if (searchClear) searchClear.classList.toggle("hidden", !d.rawQuery);
    const empty = $("#lib-mempty");
    if (empty) empty.classList.toggle("hidden", d.total > 0);
    renderRecent();
  });

  // đổi tuỳ chọn hiển thị (từ menu hoặc từ nơi khác) → cập nhật số cột + dải "Đọc gần đây"
  document.addEventListener("library:prefs", () => { applyCols(); renderRecent(); });

  document.addEventListener("i18n:ready", () => { updatePlaceholder(); });
  document.addEventListener("i18n:changed", () => { closePopover(); closeSheet(); updatePlaceholder(); });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (sheetId) closeSheet();
    else if (popOwner) closePopover();
  });

  // thoát mobile mode (xoay máy / đổi cỡ cửa sổ) hoặc thư viện bị ẩn (đang mở sách) → đóng mọi lớp phủ
  function reconcile() {
    if (!isMobileNow() || lib.classList.contains("hidden")) { closePopover(); closeSheet(); return; }
    if (popOwner && popBtn) placePopover(popBtn);
  }
  window.addEventListener("resize", reconcile);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", reconcile);
  new MutationObserver(reconcile).observe(lib, { attributes: true, attributeFilter: ["class"] });

  // khởi động
  // Các sự kiện library:rendered / library:filtered của lần vẽ đầu tiên có thể đã bắn TRƯỚC khi file này được nạp
  // (IndexedDB trả kết quả nhanh với thư viện rỗng/nhỏ) → tự đồng bộ trạng thái ban đầu từ dữ liệu thật.
  async function syncInitialState() {
    try {
      const books = await (app().listBooks ? app().listBooks() : Promise.resolve([]));
      bookCount = books.length;
      updatePlaceholder();
      renderRecent(books);
      const empty = $("#lib-mempty");
      if (empty) empty.classList.toggle("hidden", books.length > 0);
    } catch (e) { /* bỏ qua: sự kiện library:rendered kế tiếp sẽ đồng bộ lại */ }
  }
  LU.ready.then(() => {
    applyCols();
    updatePlaceholder();
    syncInitialState();
  });
  if (window.I18n && window.I18n.ready) window.I18n.ready.then(updatePlaceholder);
})();
