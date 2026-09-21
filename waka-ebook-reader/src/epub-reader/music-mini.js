(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const root = $("#music-mini");
  if (!root) return;
  const tr = (key, params, fallback) => {
    const value = window.I18n?.t?.(key, params);
    return value && value !== key ? value : (fallback || key);
  };

  const AUTO_COLLAPSE_MS = 3000;
  const coverFiles = [
    "100.jpg", "103.jpg", "106.jpg", "109.jpg",
    "112.jpg", "115.jpg", "118.jpg", "121.jpg",
    "124.jpg", "127.jpg", "130.jpg", "133.jpg"
  ];
  const coverBase = "../assets/wallpagers/playing/";

  const els = {
    bubble: $("#mm-bubble"),
    pill: $("#mm-pill"),
    info: $("#mm-info"),
    title: $("#mm-title"),
    artist: $("#mm-artist"),
    play: $("#mm-play"),
    prev: $("#mm-prev"),
    next: $("#mm-next"),
    back: $("#mm-back"),
    fwd: $("#mm-fwd"),
    speed: $("#mm-speed"),
    shuffle: $("#mm-shuffle"),
    cur: $("#mm-cur"),
    dur: $("#mm-dur"),
    seek: $("#mm-seek"),
    list: $("#mm-list"),
    mini: $("#mm-mini"),
    volBtn: $("#mm-volbtn"),
    vol: $("#mm-vol"),
    close: $("#mm-close"),
    covers: Array.from(root.querySelectorAll(".mm-cover")),
    rings: Array.from(root.querySelectorAll(".mm-ring-fg")),
  };

  let collapseTimer = 0;
  let hovering = false;
  let seeking = false;
  let lastTrackKey = "";
  let lastState = null;

  function api() {
    return window.ReaderFeatures && window.ReaderFeatures.music;
  }

  function isMobile() {
    return window.matchMedia("(max-width: 760px)").matches ||
      document.documentElement.classList.contains("mobile-reader-forced");
  }

  function randomCover() {
    const name = coverFiles[Math.floor(Math.random() * coverFiles.length)] || "10.jpg";
    return coverBase + name;
  }

  function setCover(src) {
    els.covers.forEach((img) => {
      img.src = src;
      img.classList.remove("is-broken");
      img.onerror = () => {
        img.classList.add("is-broken");
        const fallback = coverBase + "100.jpg";
        if (!img.src.endsWith("/100.jpg")) img.src = fallback;
      };
    });
  }

  function fmt(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(n / 60);
    const s = n % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function fmtRate(rate) {
    const n = Number(rate) || 1;
    if (Number.isInteger(n)) return n.toFixed(1) + "x";
    return n.toFixed(2).replace(/0$/, "") + "x";
  }

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function setProgressVisual(fraction) {
    const pct = clamp01(fraction) * 100;
    const scaled = Math.round(pct * 10);
    if (els.seek) {
      els.seek.value = String(scaled);
      els.seek.style.setProperty("--mm-range", pct + "%");
    }
    els.rings.forEach((circle) => {
      circle.style.setProperty("stroke-dasharray", "100", "important");
      circle.style.setProperty("stroke-dashoffset", String(100 - pct), "important");
    });
  }

  function setMode(mode) {
    root.dataset.mode = mode === "bubble" ? "bubble" : "full";
    scheduleCollapse();
  }

  function scheduleCollapse() {
    clearTimeout(collapseTimer);
    if (root.classList.contains("hidden") || root.dataset.mode === "bubble") return;
    collapseTimer = setTimeout(() => {
      if (!hovering && !seeking) setMode("bubble");
    }, AUTO_COLLAPSE_MS);
  }

  function showFull(auto = false) {
    root.dataset.mode = "full";
    if (!auto) scheduleCollapse();
  }

  function openMusicPanelFromMini() {
    window.ReaderFeatures?.openMusicPanel?.();
    if (isMobile()) {
      const reader = $("#reader-view");
      reader?.classList.add("mobile-music-open", "mobile-ui-visible");
    }
  }

  function render(state) {
    const hasTrack = !!state?.hasTrack;
    root.classList.toggle("hidden", !hasTrack);
    if (!hasTrack) return;

    const track = state.track || {};
    const key = [state.currentIndex, track.name, track.videoId, track.url].filter(Boolean).join("|");
    if (key && key !== lastTrackKey) {
      lastTrackKey = key;
      setCover(randomCover());
      if (!state.auto) showFull();
    }

    root.dataset.playing = state.isPlaying ? "true" : "false";
    root.dataset.muted = state.isMuted ? "true" : "false";
    els.title.textContent = track.title || track.name || tr("music.background", null, "Nhạc nền");
    els.artist.textContent = track.artist || tr("music.background", null, "Nhạc nền");
    els.speed.textContent = fmtRate(state.rate);
    els.shuffle.setAttribute("aria-pressed", state.isShuffled ? "true" : "false");
    els.shuffle.classList.toggle("active", !!state.isShuffled);
    els.cur.textContent = fmt(state.currentTime);
    els.dur.textContent = fmt(state.duration);
    if (!seeking) setProgressVisual(state.duration ? state.currentTime / state.duration : 0);
    if (els.vol) {
      if (Number(els.vol.value) !== Math.round(state.volume || 0)) els.vol.value = String(Math.round(state.volume || 0));
      els.vol.style.setProperty("--mm-range", Math.round(state.volume || 0) + "%");
    }
    if (state.reason !== "time") scheduleCollapse();
  }

  function refreshBottomOffset() {
    const nav = $("#mobile-chapter-nav");
    const reader = $("#reader-view");
    const navVisible = isMobile() && reader?.classList.contains("mobile-ui-visible") && nav;
    const h = navVisible ? nav.offsetHeight || 72 : 0;
    root.style.setProperty("--mm-nav-h", h + "px");
  }

  document.addEventListener("music:state", (e) => {
    lastState = e.detail || api()?.getState?.();
    render(lastState);
    refreshBottomOffset();
  });
  function syncI18n() {
    window.I18n?.apply?.(root);
    lastState = lastState || api()?.getState?.();
    if (lastState) render(lastState);
  }
  document.addEventListener("i18n:ready", syncI18n);
  document.addEventListener("i18n:changed", syncI18n);
  window.addEventListener("resize", refreshBottomOffset);
  document.addEventListener("reader:location", refreshBottomOffset);

  els.bubble?.addEventListener("click", () => showFull());
  els.info?.addEventListener("click", () => setMode("bubble"));
  els.title?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMusicPanelFromMini();
  });
  els.mini?.addEventListener("click", () => setMode("bubble"));
  els.play?.addEventListener("click", () => api()?.togglePlay());
  els.prev?.addEventListener("click", () => api()?.prev());
  els.next?.addEventListener("click", () => api()?.next());
  els.back?.addEventListener("click", () => api()?.seekBy(-15));
  els.fwd?.addEventListener("click", () => api()?.seekBy(15));
  els.speed?.addEventListener("click", () => api()?.cycleRate());
  els.shuffle?.addEventListener("click", () => api()?.toggleShuffle());
  els.volBtn?.addEventListener("click", () => api()?.toggleMute());
  els.vol?.addEventListener("input", () => api()?.setVolume(Number(els.vol.value)));
  els.close?.addEventListener("click", () => api()?.close());
  els.list?.addEventListener("click", (e) => {
    e.stopPropagation();
    window.ReaderFeatures?.toggleMusicPanel?.();
  });
  els.seek?.addEventListener("input", () => {
    seeking = true;
    const fraction = clamp01(Number(els.seek.value) / 1000);
    const state = api()?.getState?.() || {};
    setProgressVisual(fraction);
    if (state.duration) els.cur.textContent = fmt(state.duration * fraction);
  });
  els.seek?.addEventListener("change", () => {
    seeking = false;
    api()?.seekToFraction(Number(els.seek.value) / 1000);
    scheduleCollapse();
  });
  els.pill?.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") hovering = true;
  });
  els.pill?.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") {
      hovering = false;
      scheduleCollapse();
    }
  });

  render(api()?.getState?.() || {});
  refreshBottomOffset();
})();
