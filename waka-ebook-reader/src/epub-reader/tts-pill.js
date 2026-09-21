// tts-pill.js - floating mini player and Readest-style panel for Edge Read Aloud.
(() => {
  "use strict";

  const SLEEP_OPTIONS = [0, 15, 30, 45, 60];
  const RATE_OPTIONS = [0.8, 1, 1.1, 1.2, 1.3, 1.5, 1.8, 2];
  const tr = (key, params, fallback) => {
    const value = window.I18n?.t?.(key, params);
    return value && value !== key ? value : (fallback || key);
  };

  const state = {
    el: null,
    panel: null,
    visible: false,
    panelOpen: false,
    seeking: false,
    sleepMinutes: 0,
    sleepTimer: null,
    sleepDeadline: 0,
    coverUrl: "",
    coverBookId: "",
    lastReadState: { speaking: false, paused: false, index: 0, total: 0 },
    lastProgress: { currentTime: 0, duration: 0, index: 0, total: 0, currentText: "" },
  };

  function icon(name) {
    const paths = {
      listen: "<path d=\"M4 10v4h3l4 3V7l-4 3H4z\"/><path d=\"M15 9.5a3.5 3.5 0 0 1 0 5\"/><path d=\"M17.5 7a6.5 6.5 0 0 1 0 10\"/>",
      prev: "<path d=\"M11 18V6\"/><path d=\"m19 6-8 6 8 6V6z\"/><path d=\"M5 6v12\"/>",
      next: "<path d=\"M13 6v12\"/><path d=\"m5 18 8-6-8-6v12z\"/><path d=\"M19 6v12\"/>",
      back: "<path d=\"m11 17-5-5 5-5\"/><path d=\"m18 17-5-5 5-5\"/>",
      fwd: "<path d=\"m13 7 5 5-5 5\"/><path d=\"m6 7 5 5-5 5\"/>",
      play: "<path d=\"M8 5v14l11-7-11-7z\"/>",
      pause: "<path d=\"M7 5h4v14H7z\"/><path d=\"M13 5h4v14h-4z\"/>",
      clock: "<circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M12 8v5l3 2\"/>",
      close: "<path d=\"M6 6l12 12\"/><path d=\"M18 6 6 18\"/>",
      voice: "<path d=\"M4 10v4h3l4 3V7l-4 3H4z\"/><path d=\"M16 9a4 4 0 0 1 0 6\"/>",
      download: "<path d=\"M12 3v12\"/><path d=\"m7 10 5 5 5-5\"/><path d=\"M5 21h14\"/>",
      chevron: "<path d=\"m9 6 6 6-6 6\"/>",
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
  }

  function build() {
    if (state.el && state.panel) return;

    const pill = document.createElement("div");
    pill.id = "waka-tts-pill";
    pill.className = "waka-tts-pill hidden";
    pill.innerHTML = `
      <div class="waka-tts-pill-track"><div class="waka-tts-pill-fill"></div></div>
      <div class="waka-tts-pill-row">
        <button class="waka-tts-pill-info" id="waka-tts-pill-info" type="button" title="Mở bảng đọc to" aria-label="Mở bảng đọc to">
          <span class="waka-tts-pill-icon">${icon("listen")}</span>
          <span class="waka-tts-pill-text">
            <span class="waka-tts-pill-title" id="waka-tts-pill-title">Read Aloud</span>
            <span class="waka-tts-pill-sub" id="waka-tts-pill-sub"></span>
          </span>
        </button>
        <div class="waka-tts-pill-transport" role="group" aria-label="Điều khiển đọc to">
          <button type="button" id="waka-tts-pill-prev" title="Đoạn trước" aria-label="Đoạn trước">${icon("prev")}</button>
          <button type="button" id="waka-tts-pill-play" title="Phát / tạm dừng" aria-label="Phát / tạm dừng">${icon("play")}</button>
          <button type="button" id="waka-tts-pill-next" title="Đoạn sau" aria-label="Đoạn sau">${icon("next")}</button>
          <button type="button" id="waka-tts-pill-sleep" title="Hẹn giờ ngủ" aria-label="Hẹn giờ ngủ">${icon("clock")}<span></span></button>
          <button type="button" id="waka-tts-pill-close" title="Dừng đọc" aria-label="Dừng đọc">${icon("close")}</button>
        </div>
      </div>
    `;

    const panel = document.createElement("div");
    panel.id = "waka-tts-panel";
    panel.className = "waka-tts-panel hidden";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Bảng đọc to");
    panel.innerHTML = `
      <div class="waka-tts-panel-backdrop" data-tts-panel-close></div>
      <section class="waka-tts-sheet">
        <button type="button" class="waka-tts-panel-close" data-tts-panel-close title="Đóng" aria-label="Đóng">${icon("close")}</button>
        <header class="waka-tts-head">
          <div class="waka-tts-cover" id="waka-tts-cover"><span>EPUB</span></div>
          <div class="waka-tts-book">
            <div class="waka-tts-book-title" id="waka-tts-book-title">Read Aloud</div>
            <div class="waka-tts-book-sub" id="waka-tts-book-sub">Sẵn sàng đọc</div>
          </div>
        </header>
        <div class="waka-tts-quote" id="waka-tts-quote">Bấm phát để đọc từ đoạn đang hiển thị.</div>
        <div class="waka-tts-progress">
          <span id="waka-tts-cur">00:00</span>
          <input id="waka-tts-seek" type="range" min="0" max="1000" value="0" aria-label="Tua đọc to" />
          <span id="waka-tts-rem">00:00</span>
        </div>
        <div class="waka-tts-main-controls">
          <button type="button" id="waka-tts-panel-prev" title="Đoạn trước" aria-label="Đoạn trước">${icon("back")}</button>
          <button type="button" id="waka-tts-panel-back" title="Lùi 15 giây" aria-label="Lùi 15 giây">${icon("prev")}</button>
          <button type="button" id="waka-tts-panel-play" class="primary" title="Phát / tạm dừng" aria-label="Phát / tạm dừng">${icon("play")}</button>
          <button type="button" id="waka-tts-panel-fwd" title="Tiến 15 giây" aria-label="Tiến 15 giây">${icon("next")}</button>
          <button type="button" id="waka-tts-panel-next" title="Đoạn sau" aria-label="Đoạn sau">${icon("fwd")}</button>
        </div>
        <div class="waka-tts-cards">
          <button type="button" class="waka-tts-card" id="waka-tts-speed-card">
            <strong id="waka-tts-speed">1.0x</strong>
            <span>Speed</span>
          </button>
          <button type="button" class="waka-tts-card" id="waka-tts-voice-card">
            ${icon("voice")}
            <strong id="waka-tts-voice-name">Hoa My - Mặc định</strong>
          </button>
          <button type="button" class="waka-tts-card" id="waka-tts-sleep-card">
            ${icon("clock")}
            <strong id="waka-tts-sleep-label">Sleep Timer</strong>
          </button>
        </div>
        <button type="button" class="waka-tts-offline" disabled>
          ${icon("download")}
          <span><strong>Offline Audio</strong><small>Download chapters for offline...</small></span>
          <em>Premium</em>
          ${icon("chevron")}
        </button>
      </section>
    `;

    document.body.append(pill, panel);
    state.el = pill;
    state.panel = panel;
    window.I18n?.apply?.(pill);
    window.I18n?.apply?.(panel);
    bindEvents();
  }

  function bindEvents() {
    const pill = state.el;
    const panel = state.panel;

    pill.querySelector("#waka-tts-pill-info")?.addEventListener("click", openPanel);
    pill.querySelector("#waka-tts-pill-play")?.addEventListener("click", togglePlay);
    pill.querySelector("#waka-tts-pill-prev")?.addEventListener("click", () => window.ReaderReadAloud?.prev?.());
    pill.querySelector("#waka-tts-pill-next")?.addEventListener("click", () => window.ReaderReadAloud?.next?.());
    pill.querySelector("#waka-tts-pill-close")?.addEventListener("click", () => window.ReaderReadAloud?.stop?.());
    pill.querySelector("#waka-tts-pill-sleep")?.addEventListener("click", cycleSleepTimer);

    panel.querySelectorAll("[data-tts-panel-close]").forEach((el) => el.addEventListener("click", closePanel));
    panel.querySelector("#waka-tts-panel-play")?.addEventListener("click", togglePlay);
    panel.querySelector("#waka-tts-panel-prev")?.addEventListener("click", () => window.ReaderReadAloud?.prev?.());
    panel.querySelector("#waka-tts-panel-next")?.addEventListener("click", () => window.ReaderReadAloud?.next?.());
    panel.querySelector("#waka-tts-panel-back")?.addEventListener("click", () => seekBy(-15));
    panel.querySelector("#waka-tts-panel-fwd")?.addEventListener("click", () => seekBy(15));
    panel.querySelector("#waka-tts-speed-card")?.addEventListener("click", cycleRate);
    panel.querySelector("#waka-tts-voice-card")?.addEventListener("click", cycleVoice);
    panel.querySelector("#waka-tts-sleep-card")?.addEventListener("click", cycleSleepTimer);

    const seek = panel.querySelector("#waka-tts-seek");
    seek?.addEventListener("input", () => {
      state.seeking = true;
      renderProgressPreview(Number(seek.value) / 1000);
    });
    seek?.addEventListener("change", () => {
      const rr = window.ReaderReadAloud;
      const progress = rr?.getProgress?.() || state.lastProgress;
      const duration = finiteSeconds(progress.duration);
      if (duration) rr?.seekTo?.(duration * (Number(seek.value) / 1000));
      state.seeking = false;
      render();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.panelOpen) closePanel();
    });
  }

  function setVisible(value) {
    build();
    state.visible = !!value;
    state.el.classList.toggle("hidden", !state.visible);
  }

  function openPanel() {
    build();
    state.panelOpen = true;
    state.panel.classList.remove("hidden");
    document.body.classList.add("waka-tts-panel-open");
    loadCover();
    render();
    document.dispatchEvent(new CustomEvent("tts:panel", { detail: { open: true } }));
  }

  function closePanel() {
    if (!state.panel) return;
    state.panelOpen = false;
    state.panel.classList.add("hidden");
    document.body.classList.remove("waka-tts-panel-open");
    document.dispatchEvent(new CustomEvent("tts:panel", { detail: { open: false } }));
  }

  function togglePlay() {
    const rr = window.ReaderReadAloud;
    if (!rr) return;
    if (rr.isActive?.() && rr.isSpeaking?.()) rr.pause?.();
    else if (rr.isActive?.()) rr.resume?.();
    else rr.start?.();
  }

  function seekBy(delta) {
    const rr = window.ReaderReadAloud;
    const progress = rr?.getProgress?.() || state.lastProgress;
    if (!finiteSeconds(progress.duration)) return;
    rr.seekTo?.(finiteSeconds(progress.currentTime) + delta);
  }

  function cycleSleepTimer() {
    const idx = SLEEP_OPTIONS.indexOf(state.sleepMinutes);
    const next = SLEEP_OPTIONS[(idx + 1) % SLEEP_OPTIONS.length];
    state.sleepMinutes = next;
    if (state.sleepTimer) {
      clearTimeout(state.sleepTimer);
      state.sleepTimer = null;
    }
    if (next > 0) {
      state.sleepDeadline = Date.now() + next * 60000;
      state.sleepTimer = setTimeout(() => {
        state.sleepMinutes = 0;
        window.ReaderReadAloud?.stop?.();
        render();
      }, next * 60000);
    } else {
      state.sleepDeadline = 0;
    }
    render();
  }

  function cycleRate() {
    const rate = document.getElementById("tts-rate");
    if (!rate) return;
    const current = Number(rate.value || 1);
    const index = RATE_OPTIONS.findIndex((v) => Math.abs(v - current) < 0.01);
    rate.value = String(RATE_OPTIONS[(index + 1) % RATE_OPTIONS.length]);
    rate.dispatchEvent(new Event("input", { bubbles: true }));
    render();
  }

  function cycleVoice() {
    const voice = document.getElementById("tts-voice");
    if (!voice || !voice.options.length) return;
    const list = Array.from(voice.options);
    const current = list.findIndex((option) => option.value === voice.value);
    voice.value = list[(current + 1) % list.length].value;
    voice.dispatchEvent(new Event("change", { bubbles: true }));
    render();
  }

  function bookInfo() {
    return window.ReaderApp?.getBookInfo?.() || null;
  }

  function bookTitle() {
    const info = bookInfo();
    return info?.title || info?.fileName || "Read Aloud";
  }

  function chapterLabel() {
    const loc = window.ReaderApp?.getLocation?.();
    return loc?.chapter || document.getElementById("chapter-label")?.textContent || "";
  }

  async function loadCover() {
    const info = bookInfo();
    const cover = state.panel?.querySelector("#waka-tts-cover");
    if (!info || !cover || state.coverBookId === info.id) return;
    state.coverBookId = info.id;
    if (state.coverUrl) {
      URL.revokeObjectURL(state.coverUrl);
      state.coverUrl = "";
    }
    cover.innerHTML = `<span>${escapeHtml((info.title || "EPUB").slice(0, 4))}</span>`;
    try {
      const record = await window.BookDB?.getBook?.(info.id);
      if (record?.coverBlob && state.coverBookId === info.id) {
        state.coverUrl = URL.createObjectURL(record.coverBlob);
        cover.innerHTML = `<img src="${state.coverUrl}" alt="">`;
      }
    } catch {}
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function finiteSeconds(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function fmt(seconds) {
    const n = Math.floor(finiteSeconds(seconds));
    const m = Math.floor(n / 60);
    const s = n % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function itemFraction(progress) {
    const duration = finiteSeconds(progress?.duration);
    if (!duration) {
      const wordTotal = Number(progress?.wordTotal) || 0;
      const wordIndex = Number(progress?.wordIndex);
      if (wordTotal > 0 && Number.isFinite(wordIndex) && wordIndex >= 0) {
        return clamp01((wordIndex + 1) / wordTotal);
      }
      return 0;
    }
    return clamp01(finiteSeconds(progress?.currentTime) / duration);
  }

  function progressPercent(progress) {
    if (!progress || !progress.total) return 0;
    const itemFrac = itemFraction(progress);
    return Math.max(0, Math.min(100, ((progress.index + itemFrac) / progress.total) * 100));
  }

  function splitLyricLines(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return ["Bấm phát để đọc từ đoạn đang hiển thị."];
    const chunks = clean.match(/[^.!?]+[.!?"']*|[^.!?]+$/g) || [clean];
    const lines = [];
    chunks.forEach((chunk) => {
      const words = chunk.trim().split(/\s+/).filter(Boolean);
      let line = "";
      words.forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (next.length > 86 && line) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      });
      if (line) lines.push(line);
    });
    return lines.slice(0, 18);
  }

  function wordCount(line) {
    return (String(line || "").match(/\S+/g) || []).length;
  }

  function highlightedLineHtml(line, baseWord, activeWord, progressChars, baseOffset) {
    let offset = baseOffset || 0;
    let wordOffset = baseWord || 0;
    return line.split(/(\s+)/).map((token) => {
      const start = offset;
      const end = start + token.length;
      offset = end;
      if (/^\s+$/.test(token)) return escapeHtml(token);
      let cls = "";
      if (activeWord >= 0) {
        if (wordOffset < activeWord) cls = " is-read";
        else if (wordOffset === activeWord) cls = " is-active";
        wordOffset += 1;
      } else if (end <= progressChars) cls = " is-read";
      else if (start <= progressChars && progressChars < end) cls = " is-active";
      return `<span class="waka-tts-word${cls}">${escapeHtml(token)}</span>`;
    }).join("");
  }

  function renderQuote(text, fraction, wordIndex = -1) {
    const quote = state.panel?.querySelector("#waka-tts-quote");
    if (!quote) return;
    const lines = splitLyricLines(text);
    const totalChars = lines.reduce((sum, line) => sum + line.length + 1, 0) || 1;
    const progressChars = Math.round(totalChars * clamp01(fraction));
    const activeWord = Number.isFinite(Number(wordIndex)) ? Number(wordIndex) : -1;
    let offset = 0;
    let wordOffset = 0;
    let currentIndex = -1;
    if (activeWord >= 0) {
      currentIndex = lines.findIndex((line) => {
        const count = wordCount(line);
        const start = wordOffset;
        const end = start + Math.max(1, count) - 1;
        wordOffset += count;
        return activeWord >= start && activeWord <= end;
      });
    } else {
      currentIndex = lines.findIndex((line) => {
        const start = offset;
        const end = start + line.length + 1;
        offset = end;
        return progressChars >= start && progressChars <= end;
      });
    }
    if (currentIndex < 0) currentIndex = lines.length - 1;
    offset = 0;
    wordOffset = 0;
    quote.innerHTML = `<div class="waka-tts-lyric-pad">${lines.map((line, index) => {
      const html = highlightedLineHtml(line, wordOffset, activeWord, progressChars, offset);
      offset += line.length + 1;
      wordOffset += wordCount(line);
      const cls = index < currentIndex ? "past" : index === currentIndex ? "current" : "future";
      return `<div class="waka-tts-line ${cls}" data-lyric-line="true">${html}</div>`;
    }).join("")}</div>`;
    requestAnimationFrame(() => {
      const current = quote.querySelector(".waka-tts-line.current");
      if (!current) return;
      const target = current.offsetTop - (quote.clientHeight / 2) + (current.offsetHeight / 2);
      quote.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    });
  }

  function currentVoiceLabel() {
    const voice = document.getElementById("tts-voice");
    const label = voice?.selectedOptions?.[0]?.textContent || "";
    const short = label.replace(/\s*\([^)]*\)\s*$/, "").replace(/^Vietnamese\s*-\s*/i, "").trim();
    return short || tr("tts.voiceDefault", null, "Hoa My - Mặc định");
  }

  function currentRateLabel() {
    const rate = document.getElementById("tts-rate");
    const value = Number(rate?.value || 1);
    return Number.isFinite(value) ? value.toFixed(1) + "x" : "1.0x";
  }

  function sleepLabel() {
    if (!state.sleepMinutes) return tr("tts.sleepTimer", null, "Sleep Timer");
    const remain = Math.max(0, Math.ceil((state.sleepDeadline - Date.now()) / 60000));
    return tr("tts.minutes", { minutes: remain }, `${remain} phút`);
  }

  function renderProgressPreview(fraction) {
    const progress = window.ReaderReadAloud?.getProgress?.() || state.lastProgress;
    const duration = finiteSeconds(progress.duration);
    const clamped = clamp01(fraction);
    const current = duration * clamped;
    state.panel.querySelector("#waka-tts-seek")?.style.setProperty("--tts-range", (clamped * 100) + "%");
    state.panel.querySelector("#waka-tts-cur").textContent = fmt(current);
    state.panel.querySelector("#waka-tts-rem").textContent = duration ? "-" + fmt(duration - current) : "00:00";
    renderQuote(progress.currentText, clamped, -1);
  }

  function render() {
    build();
    const rr = window.ReaderReadAloud;
    const progress = rr?.getProgress?.() || state.lastProgress;
    const readState = state.lastReadState;
    const speaking = !!(rr?.isActive?.() || readState.speaking);
    const playing = !!(rr?.isSpeaking?.() || (readState.speaking && !readState.paused));
    const pct = progressPercent(progress);
    const fraction = itemFraction(progress);
    const itemPct = fraction * 100;

    setVisible(speaking);
    state.el.querySelector("#waka-tts-pill-title").textContent = bookTitle();

    const parts = [];
    const chapter = chapterLabel();
    if (chapter && chapter !== "-") parts.push(chapter);
    if (progress?.total) {
      const current = Math.min(progress.index + 1, progress.total);
      parts.push(tr("tts.segment", { current, total: progress.total }, `Đoạn ${current}/${progress.total}`));
    }
    parts.push(currentRateLabel());
    const voice = currentVoiceLabel();
    if (voice) parts.push(voice);
    if (state.sleepMinutes > 0) {
      const minutes = Math.max(0, Math.ceil((state.sleepDeadline - Date.now()) / 60000));
      parts.push(tr("tts.timer", { minutes }, `Hẹn ${minutes} phút`));
    }
    state.el.querySelector("#waka-tts-pill-sub").textContent = parts.join(" · ");
    state.el.querySelector("#waka-tts-pill-play").innerHTML = icon(playing ? "pause" : "play");
    state.el.querySelector(".waka-tts-pill-fill").style.width = pct + "%";
    state.el.querySelector("#waka-tts-pill-sleep span").textContent = state.sleepMinutes ? `${state.sleepMinutes}` : "";

    if (!state.panelOpen) return;
    loadCover();
    state.panel.querySelector("#waka-tts-book-title").textContent = bookTitle();
    state.panel.querySelector("#waka-tts-book-sub").textContent = chapter || tr("tts.ready", null, "Sẵn sàng đọc");
    state.panel.querySelector("#waka-tts-quote").textContent = progress.currentText || tr("tts.readyLong", null, "Bấm phát để đọc từ đoạn đang hiển thị.");
    renderQuote(progress.currentText, fraction, progress.wordIndex);
    state.panel.querySelector("#waka-tts-panel-play").innerHTML = icon(playing ? "pause" : "play");
    state.panel.querySelector("#waka-tts-speed").textContent = currentRateLabel();
    state.panel.querySelector("#waka-tts-voice-name").textContent = currentVoiceLabel();
    state.panel.querySelector("#waka-tts-sleep-label").textContent = sleepLabel();
    state.panel.querySelector("#waka-tts-cur").textContent = fmt(progress.currentTime);
    state.panel.querySelector("#waka-tts-rem").textContent = finiteSeconds(progress.duration) ? "-" + fmt(finiteSeconds(progress.duration) - finiteSeconds(progress.currentTime)) : "00:00";
    const seek = state.panel.querySelector("#waka-tts-seek");
    if (seek && !state.seeking) {
      seek.value = String(Math.round(itemPct * 10));
      seek.style.setProperty("--tts-range", itemPct + "%");
    }
  }

  document.addEventListener("readaloud:state", (e) => {
    state.lastReadState = e.detail || state.lastReadState;
    render();
  });
  document.addEventListener("readaloud:progress", (e) => {
    state.lastProgress = e.detail || state.lastProgress;
    render();
  });
  function syncI18n() {
    if (state.el) window.I18n?.apply?.(state.el);
    if (state.panel) window.I18n?.apply?.(state.panel);
    render();
  }
  document.addEventListener("i18n:ready", syncI18n);
  document.addEventListener("i18n:changed", syncI18n);
  document.addEventListener("reader:location", render);
  document.getElementById("tts-rate")?.addEventListener("input", render);
  document.getElementById("tts-voice")?.addEventListener("change", render);
  window.addEventListener("beforeunload", () => {
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
  });

  build();
  window.WakaTTSPill = {
    show: () => setVisible(true),
    hide: () => setVisible(false),
    render,
    openPanel,
    closePanel,
    isPanelOpen: () => !!state.panelOpen,
  };
})();
