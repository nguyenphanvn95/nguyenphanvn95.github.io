// auto-scroll.js — Auto Scroll cho chế độ Cuộn (kiểu teleprompter, theo pill của Readest).
//
// • Chỉ chạy khi state.settings.mode === "scroll"; đổi sang Lật trang là tự dừng.
// • Nút bật/tắt: pane Typography (#rd-autoscroll-toggle) + bảng cài đặt mobile
//   (#mobile-autoscroll) + phím tắt Shift+A. Bật → hiện pill nổi
//   [−] [NN%] [+] | [▶/⏸] | [✕] và trang tự cuộn.
// • Tap/click vào trang khi đang chạy = tạm dừng / tiếp tục; Esc = thoát hẳn.
// • Hết chương → tự sang chương kế (ReaderApp.gotoSpine); hết sách → tự dừng + toast.
//
// Độc lập với TTS/Read Aloud và với logic lưu vị trí đọc: file này chỉ cuộn `scrollTop`
// của iframe nội dung, các sự kiện scroll hợp lệ đó để app.js (onFrameScroll →
// persistPosition) tự bắt như khi người dùng cuộn tay.
// Chạy sau app.js + reader-ui.js, dùng window.ReaderApp (chỉ thêm ReaderApp.autoScroll).

(() => {
  "use strict";

  const RA = window.ReaderApp;
  if (!RA) return;

  /* ---------------------------------------------------------- hằng số */

  const BASE_PX_PER_SEC = 30;      // 100% ≈ 30 px/giây (≈ 1 dòng/giây ở cỡ chữ mặc định)
  const DEFAULT_SPEED = 100;       // %
  const MIN_SPEED = 25;            // % — phải khớp clamp trong app.js (autoScrollSpeed)
  const MAX_SPEED = 400;           // %
  const SPEED_STEP = 25;           // mỗi lần bấm +/−
  const MAX_FRAME_DT_MS = 100;     // trần dt giữa 2 frame: tránh "nhảy cóc" khi tab bị background
  const END_STALL_MS = 800;        // chạm đáy chương liên tục ngần này ms → coi là hết chương
  const SHORT_CHAPTER_DWELL_MS = 2500; // chương ngắn hơn 1 màn hình (không cuộn được): dừng lâu hơn
                                   // trước khi sang chương kế, để kịp nhìn (trang bìa, trang tựa…)
  const END_TOLERANCE_PX = 2;      // sai số khi so scrollTop với đáy (scrollHeight làm tròn)

  const tr = (key, fallback) => {
    const v = window.I18n?.t?.(key);
    return v && v !== key ? v : fallback;
  };
  const $ = (sel) => document.querySelector(sel);

  /* ---------------------------------------------------------- state */

  let active = false;      // đang bật Auto Scroll (pill đang hiện)
  let paused = false;      // đang tạm dừng (pill vẫn hiện, không cuộn)
  let speed = normalizeSpeed(RA.getSettings?.().autoScrollSpeed);
  let rafId = 0;
  let lastTime = 0;        // mốc thời gian frame trước (0 = chưa có, bỏ qua frame đầu)
  let residual = 0;        // phần dư < 1 pixel vật lý chưa cuộn được, cộng dồn sang frame sau
  let stallStartTs = 0;    // mốc bắt đầu chạm đáy chương (0 = chưa chạm)
  let lastScroller = null; // scrollingElement của frame trước: đổi = đã sang chương khác
  let navigating = false;  // đang chờ sang chương kế
  let bookId = null;       // sách đang auto-scroll: đổi sách/tab thì dừng
  let pillEl = null;
  let pillParts = null;

  function normalizeSpeed(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_SPEED;
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.round(n)));
  }

  const isScrollMode = () => RA.getSettings?.().mode === "scroll";
  const isReaderOpen = () => !!RA.isReaderOpen?.();

  /* ---------------------------------------------------------- phần tử cuộn thật */

  /** scrollingElement của iframe chương hiện tại (cùng cách onFrameScroll() trong app.js lấy).
   *  Trả null khi chương chưa dựng xong. */
  function getScroller() {
    let d = null;
    try { d = RA.frameDoc?.(); } catch (e) { d = null; }
    if (!d || !d.body || d.readyState !== "complete") return null;
    return d.scrollingElement || null;
  }

  /** app.js đang dựng chương (renderChapter bật #loading-overlay) → chưa cuộn/đo gì cả. */
  function isBusy() {
    const ov = $("#loading-overlay");
    return !!ov && !ov.classList.contains("hidden");
  }

  /* ---------------------------------------------------------- vòng lặp cuộn (PacedScroller) */

  function resetTiming() {
    lastTime = 0;
    residual = 0;
    stallStartTs = 0;
  }

  function tick(now) {
    rafId = 0;
    if (!active || paused) return;
    rafId = requestAnimationFrame(tick); // đặt lịch trước: stop() gọi giữa chừng sẽ huỷ được

    if (!isReaderOpen()) { stop(); return; }
    if (!lastTime) { lastTime = now; return; }
    const dt = Math.min(now - lastTime, MAX_FRAME_DT_MS);
    lastTime = now;

    if (navigating || isBusy()) { stallStartTs = 0; return; }
    const se = getScroller();
    if (!se) { stallStartTs = 0; return; }
    if (se !== lastScroller) { // sang chương mới / vừa vẽ lại: đo lại từ đầu
      lastScroller = se;
      residual = 0;
      stallStartTs = 0;
    }

    const maxScroll = se.scrollHeight - se.clientHeight;
    if (maxScroll <= END_TOLERANCE_PX || se.scrollTop >= maxScroll - END_TOLERANCE_PX) {
      onReachedEnd(now, maxScroll <= END_TOLERANCE_PX);
      return;
    }
    stallStartTs = 0;

    // velocity (px/s) × dt → quãng đường frame này; phần lẻ cộng dồn để cuộn mượt cả ở tốc độ rất chậm.
    // Chỉ cuộn theo bội của 1 pixel VẬT LÝ (1/DPR px CSS) vì trình duyệt làm tròn offset cuộn theo
    // pixel vật lý; residual trừ theo quãng đường THỰC SỰ đã cuộn nên tự bù nếu bị làm tròn.
    residual += (BASE_PX_PER_SEC * speed / 100) * (dt / 1000);
    const quantum = 1 / (window.devicePixelRatio || 1);
    const step = Math.floor(residual / quantum) * quantum;
    if (step <= 0) return;

    const before = se.scrollTop;
    try {
      se.scrollBy({ top: step, left: 0, behavior: "instant" }); // "instant": bỏ qua scroll-behavior:smooth của CSS sách
    } catch (e) {
      se.scrollTop = before + step;
    }
    const moved = se.scrollTop - before;
    residual = moved > 0 ? Math.max(0, residual - moved) : 0;
  }

  /** Chạm đáy chương: chờ đủ ngưỡng liên tục mới coi là hết chương (tránh nhầm khi ảnh đang nạp
   *  làm chương dài thêm, hoặc khi mới cuộn tới sát đáy). */
  function onReachedEnd(now, unscrollable) {
    residual = 0;
    if (!stallStartTs) { stallStartTs = now; return; }
    if (now - stallStartTs < (unscrollable ? SHORT_CHAPTER_DWELL_MS : END_STALL_MS)) return;
    stallStartTs = 0;
    advanceChapter();
  }

  async function advanceChapter() {
    const loc = RA.getLocation?.();
    if (!loc) { stop(); return; }
    if (loc.spineIndex >= loc.spineCount - 1) { // chương cuối → hết sách
      stop();
      try { RA.toast?.(tr("autoscroll.endOfBook", "Đã đọc hết sách")); } catch (e) { /* bỏ qua */ }
      return;
    }
    navigating = true;
    try {
      await RA.gotoSpine(loc.spineIndex + 1); // dùng lại điều hướng có sẵn (renderChapter, vị trí đầu chương)
    } catch (e) {
      console.warn("[AutoScroll] không sang được chương kế:", e);
      navigating = false;
      stop();
      return;
    }
    navigating = false;
    if (active) resetTiming();
  }

  /* ---------------------------------------------------------- bật / tắt / tạm dừng */

  function start() {
    if (active) return true;
    if (!isReaderOpen() || !isScrollMode()) return false; // Lật trang: không bao giờ chạy
    active = true;
    paused = false;
    navigating = false;
    lastScroller = null;
    bookId = RA.getBookInfo?.()?.id ?? null;
    resetTiming();
    bindFrame();
    window.addEventListener("keydown", onEscKey, true);
    showPill();
    syncUi();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
    return true;
  }

  function stop() {
    const wasActive = active;
    active = false;
    paused = false;
    navigating = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
    window.removeEventListener("keydown", onEscKey, true);
    if (wasActive) hidePill();
    syncUi();
  }

  function toggle() {
    if (active) stop(); else start();
    return active;
  }

  function togglePause() {
    if (!active) return;
    paused = !paused;
    cancelAnimationFrame(rafId);
    rafId = 0;
    if (!paused) {
      resetTiming();
      rafId = requestAnimationFrame(tick);
    }
    updatePill();
  }

  function setSpeed(value, opts = {}) {
    const next = normalizeSpeed(value);
    const changed = next !== speed;
    speed = next;
    updatePill();
    if (changed && opts.persist !== false) {
      try { RA.setAutoScrollSpeed?.(next); } catch (e) { /* bỏ qua: chỉ là lưu tốc độ */ }
    }
    return speed;
  }

  function adjustSpeed(dir) {
    return setSpeed(speed + (dir < 0 ? -SPEED_STEP : SPEED_STEP));
  }

  /* ---------------------------------------------------------- phím tắt + tương tác trong trang */

  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!t.isContentEditable;
  }

  function onEscKey(e) {
    if (active && e.key === "Escape") stop();
  }

  /** Shift+A bật/tắt (như Readest); chỉ khi đang mở sách ở chế độ Cuộn và không đang gõ chữ. */
  function onShortcutKey(e) {
    if (e.key !== "A" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) || !isReaderOpen()) return;
    if (!active && !isScrollMode()) return;
    e.preventDefault();
    toggle();
  }
  document.addEventListener("keydown", onShortcutKey);

  // Sau khi bấm vào trang, focus nằm TRONG iframe nên phím không tới document cha:
  // gắn thêm vào cửa sổ của iframe để Esc / Shift+A vẫn hoạt động.
  function onFrameKey(e) {
    onEscKey(e);
    onShortcutKey(e);
  }

  /** Click/tap vào nội dung khi đang Auto Scroll = tạm dừng / tiếp tục, thay cho hành vi mặc định
   *  (mobile-reader.js: ẩn/hiện thanh công cụ). Gắn ở pha capture của WINDOW iframe nên chạy
   *  trước mọi listener capture ở document/body (app.js, mobile-reader.js). */
  function onFrameClick(e) {
    if (!active) return;
    const t = e.target;
    // Link, nút, ô nhập… vẫn hoạt động bình thường.
    if (t && t.closest && t.closest("a[href], button, input, textarea, select, label, [contenteditable='true']")) return;
    // Đang bôi chọn chữ (Annotation/Select Text) thì không can thiệp.
    try {
      const sel = e.view && e.view.getSelection ? String(e.view.getSelection()) : "";
      if (sel.trim()) return;
    } catch (err) { /* bỏ qua */ }
    e.preventDefault();
    e.stopPropagation();
    togglePause();
  }

  // Mỗi chương là 1 document mới → gắn 1 lần cho mỗi document (WeakSet); listener chết cùng document.
  const boundDocs = new WeakSet();
  function bindFrame() {
    let d = null;
    try { d = RA.frameDoc?.(); } catch (e) { d = null; }
    const w = d && d.defaultView;
    if (!d || !w || boundDocs.has(d)) return;
    boundDocs.add(d);
    w.addEventListener("click", onFrameClick, true);
    w.addEventListener("keydown", onFrameKey, true);
  }
  if (RA.bookFrame) RA.bookFrame.addEventListener("load", bindFrame);

  /* ---------------------------------------------------------- pill panel */

  function icon(name) {
    const paths = {
      minus: '<path d="M6 12h12"/>',
      plus: '<path d="M12 6v12"/><path d="M6 12h12"/>',
      play: '<path d="M8 5v14l11-7-11-7z"/>',
      pause: '<path d="M7 5h4v14H7z"/><path d="M13 5h4v14h-4z"/>',
      close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    };
    const solid = name === "play" || name === "pause";
    return `<svg class="${solid ? "was-solid" : "was-line"}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
  }

  function buildPill() {
    if (pillEl) return;
    const pill = document.createElement("div");
    pill.id = "waka-autoscroll-pill";
    pill.className = "waka-autoscroll-pill hidden";
    pill.setAttribute("role", "group");
    pill.innerHTML = `
      <button type="button" id="was-slower">${icon("minus")}</button>
      <span class="was-speed" id="was-speed">100%</span>
      <button type="button" id="was-faster">${icon("plus")}</button>
      <div class="was-divider"></div>
      <button type="button" id="was-playpause"></button>
      <div class="was-divider"></div>
      <button type="button" id="was-exit">${icon("close")}</button>`;
    // Gắn vào #reader-view (không phải body) để vẫn thấy khi trình đọc vào toàn màn hình.
    (document.getElementById("reader-view") || document.body).appendChild(pill);
    pillEl = pill;
    pillParts = {
      slower: pill.querySelector("#was-slower"),
      faster: pill.querySelector("#was-faster"),
      speed: pill.querySelector("#was-speed"),
      play: pill.querySelector("#was-playpause"),
      exit: pill.querySelector("#was-exit"),
    };
    pillParts.slower.addEventListener("click", () => adjustSpeed(-1));
    pillParts.faster.addEventListener("click", () => adjustSpeed(1));
    pillParts.play.addEventListener("click", togglePause);
    pillParts.exit.addEventListener("click", stop);
  }

  function showPill() {
    buildPill();
    updatePill();
  }

  function hidePill() {
    if (pillEl) pillEl.classList.add("hidden");
  }

  /** Vẽ lại pill theo state hiện tại (tốc độ, biên min/max, icon play/pause, nhãn i18n). */
  function updatePill() {
    if (!pillEl) return;
    const P = pillParts;
    pillEl.classList.toggle("hidden", !active);
    pillEl.classList.toggle("is-paused", paused);
    pillEl.setAttribute("aria-label", tr("autoscroll.label", "Auto Scroll"));
    P.speed.textContent = speed + "%";
    P.slower.disabled = speed <= MIN_SPEED;
    P.faster.disabled = speed >= MAX_SPEED;
    const slower = tr("autoscroll.slower", "Chậm hơn");
    const faster = tr("autoscroll.faster", "Nhanh hơn");
    const playLabel = paused ? tr("autoscroll.play", "Tiếp tục") : tr("autoscroll.pause", "Tạm dừng");
    const exitLabel = tr("autoscroll.exit", "Thoát Auto Scroll");
    for (const [btn, label] of [[P.slower, slower], [P.faster, faster], [P.play, playLabel], [P.exit, exitLabel]]) {
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
    P.play.innerHTML = icon(paused ? "play" : "pause");
  }

  /* ---------------------------------------------------------- nút bật/tắt (pane Typography + mobile) */

  function wireToggle(input) {
    if (!input) return;
    input.addEventListener("change", () => {
      if (input.checked) { if (!start()) input.checked = false; }
      else stop();
      syncUi();
    });
  }
  wireToggle($("#rd-autoscroll-toggle"));
  wireToggle($("#mobile-autoscroll"));

  /** Đồng bộ các nút bật/tắt + gợi ý + pill theo (mode, active). */
  function syncUi() {
    const usable = active || isScrollMode();
    for (const input of [$("#rd-autoscroll-toggle"), $("#mobile-autoscroll")]) {
      if (!input) continue;
      input.checked = active;
      input.disabled = !usable;
    }
    const row = $("#rd-autoscroll-row");
    if (row) {
      row.classList.toggle("is-disabled", !usable);
      row.title = active ? tr("autoscroll.toggleOff", "Tắt Auto Scroll") : tr("autoscroll.toggleOn", "Bật Auto Scroll");
    }
    const hint = $("#rd-autoscroll-hint");
    if (hint) hint.classList.toggle("hidden", usable);
    updatePill();
  }

  /* ---------------------------------------------------------- lắng nghe app */

  // "reader:settings" do app.js phát mỗi khi đổi cài đặt (kể cả đổi mode): rời Cuộn → dừng ngay.
  document.addEventListener("reader:settings", (e) => {
    const s = e.detail || {};
    if (active && s.mode !== "scroll") stop();
    if (s.autoScrollSpeed != null) setSpeed(s.autoScrollSpeed, { persist: false });
    syncUi();
  });

  // Đổi sách / đổi tab đọc khi đang chạy → dừng (không cuộn nhầm sang sách khác).
  document.addEventListener("reader:location", () => {
    if (!active) return;
    const id = RA.getBookInfo?.()?.id ?? null;
    if (id !== bookId) stop();
  });

  document.addEventListener("i18n:ready", syncUi);
  document.addEventListener("i18n:changed", syncUi);

  /* ---------------------------------------------------------- API công khai */

  RA.autoScroll = {
    isActive: () => active,
    isPaused: () => paused,
    getSpeed: () => speed,
    toggle,          // bật/tắt hẳn (nút chính, mở/đóng pill)
    togglePause,     // Play/Pause trong pill
    adjustSpeed,     // dir = 1 hoặc -1, bước cố định SPEED_STEP
    setSpeed,
    stop,            // tắt hẳn — dùng chung cho nút ✕, phím Esc, rời chế độ Cuộn
  };

  syncUi();
})();
