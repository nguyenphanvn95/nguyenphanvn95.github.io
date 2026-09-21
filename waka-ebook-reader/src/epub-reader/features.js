// features.js — Music Player · Display Settings Panel · Fullscreen
// Runs after app.js; extends the reader with the 3 new feature panels.

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const safe = (sel) => { const el = $(sel); if (!el) console.warn("features.js: not found:", sel); return el; };
  const tr = (key, params, fallback) => {
    const value = window.I18n?.t?.(key, params);
    return value && value !== key ? value : (fallback || key);
  };

  /* ═══════════════════════════════════════════════════════════════
     1.  UTILITY — close panels on outside click
  ═══════════════════════════════════════════════════════════════ */

  // Mỗi phần tử: { panel, triggers: [el, ...] }. Dùng mảng triggers (thay vì 1 trigger
  // duy nhất) để 1 panel có thể có nhiều nút mở khác nhau (ví dụ #btn-music và
  // #rd-open-music cùng mở musicPanel) mà không bị chính cơ chế này đóng lại ngay
  // sau khi mở, vì mọi trigger được kiểm tra cùng lúc trong 1 lần duyệt.
  const panels = [];
  document.addEventListener("click", (e) => {
    panels.forEach(({ panel, triggers }) => {
      if (!panel || !triggers || !triggers.length) return;
      const insideTrigger = triggers.some((t) => t && t.contains(e.target));
      if (!panel.classList.contains("hidden") &&
          !panel.contains(e.target) &&
          !insideTrigger) {
        panel.classList.add("hidden");
      }
    });
  });

  /* ═══════════════════════════════════════════════════════════════
     2.  FULLSCREEN
  ═══════════════════════════════════════════════════════════════ */

  const btnFullscreen  = safe("#btn-fullscreen");
  const iconEnter      = safe("#icon-fullscreen-enter");
  const iconExit       = safe("#icon-fullscreen-exit");
  const readerView     = safe("#reader-view");

  function updateFullscreenIcon() {
    if (!iconEnter || !iconExit || !btnFullscreen) return;
    const isFs = !!document.fullscreenElement;
    iconEnter.classList.toggle("hidden", isFs);
    iconExit.classList.toggle("hidden", !isFs);
    btnFullscreen.classList.toggle("active", isFs);
  }

  if (btnFullscreen && readerView) {
    btnFullscreen.addEventListener("click", () => {
      try {
        if (!document.fullscreenElement) {
          const req = readerView.requestFullscreen ||
                      readerView.webkitRequestFullscreen ||
                      readerView.mozRequestFullScreen;
          if (req) req.call(readerView).catch(() => {});
        } else {
          const exit = document.exitFullscreen ||
                       document.webkitExitFullscreen ||
                       document.mozCancelFullScreen;
          if (exit) exit.call(document).catch(() => {});
        }
      } catch(e) {}
    });

    document.addEventListener("fullscreenchange", updateFullscreenIcon);
    document.addEventListener("webkitfullscreenchange", updateFullscreenIcon);

    document.addEventListener("keydown", (e) => {
      if (!readerView || readerView.classList.contains("hidden")) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") btnFullscreen.click();
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     3.  DISPLAY SETTINGS PANEL
  ═══════════════════════════════════════════════════════════════ */

  const btnDisplay   = safe("#btn-display-settings");
  const displayPanel = safe("#display-panel");
  const musicPanel   = safe("#music-panel");

  if (btnDisplay && displayPanel) {
    panels.push({ panel: displayPanel, triggers: [btnDisplay] });

    btnDisplay.addEventListener("click", (e) => {
      e.stopPropagation();
      displayPanel.classList.toggle("hidden");
      if (musicPanel) musicPanel.classList.add("hidden");
      syncDisplayPanel();
    });
  }

  /* ---- theme buttons ---- */
  // Đổi nền đọc thật sự qua ReaderApp (vẽ lại chương), không còn ghi đè inline style.

  const app = () => window.ReaderApp || {};

  document.querySelectorAll(".dp-theme-btn[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (app().setTheme) app().setTheme(btn.dataset.theme);
      document.querySelectorAll(".rd-swatch").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  document.querySelectorAll("[data-bg-image]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (app().setBgImage) app().setBgImage(btn.dataset.bgImage);
      document.querySelectorAll(".rd-swatch").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  /* ---- dàn trang: cuộn / lật trang ---- */
  const dpScrollCheck   = $("#dp-scroll-check");
  const dpModeScroll    = $("#dp-mode-scroll");
  const dpModePaginated = $("#dp-mode-paginated");
  const bgOpacityWrap   = $("#rd-bg-opacity-wrap");
  const bgOpacityInput  = $("#rd-bg-opacity");
  const bgOpacityValue  = $("#rd-bg-opacity-value");

  if (dpModeScroll)    dpModeScroll.addEventListener("click", () => app().setMode && app().setMode("scroll"));
  if (dpModePaginated) dpModePaginated.addEventListener("click", () => app().setMode && app().setMode("paginated"));
  if (dpScrollCheck)   dpScrollCheck.addEventListener("change", () =>
    app().setMode && app().setMode(dpScrollCheck.checked ? "scroll" : "paginated"));

  bgOpacityInput?.addEventListener("input", () => {
    const pct = Math.max(0, Math.min(100, Number(bgOpacityInput.value) || 0));
    if (bgOpacityValue) bgOpacityValue.textContent = pct + "%";
    if (app().setBgImageOpacity) app().setBgImageOpacity(pct / 100);
  });

  /* ---- số cột: 1 hoặc 2 ---- */
  const dpCol1 = $("#dp-col-1");
  const dpCol2 = $("#dp-col-2");

  if (dpCol1) dpCol1.addEventListener("click", () => app().setColumns && app().setColumns(1));
  if (dpCol2) dpCol2.addEventListener("click", () => app().setColumns && app().setColumns(2));

  /* ---- cỡ chữ ---- */
  const dpFontDec = $("#dp-font-dec");
  const dpFontInc = $("#dp-font-inc");
  if (dpFontDec) dpFontDec.addEventListener("click", () => app().changeFontSize && app().changeFontSize(-1));
  if (dpFontInc) dpFontInc.addEventListener("click", () => app().changeFontSize && app().changeFontSize(1));

  /* ---- kiểu chữ ----
     GHI CHÚ (sửa lỗi font): trước đây khối này tự áp doc.body.style.fontFamily /
     wrap.style.fontFamily bằng JS mỗi khi #book-frame load xong (bất kể người dùng có
     bấm chọn font hay không, currentFontKey mặc định "serif") — nghĩa là MỌI epub, kể cả
     epub có font nhúng riêng, đều bị ép cứng về Georgia/serif ngay sau khi vẽ trang.
     Đây chính là nguyên nhân "font gốc EPUB không hiển thị đúng" dù cơ chế đọc/giải mã
     font nhúng (app.js) đã đúng. Nguồn sự thật duy nhất cho font giờ là
     state.settings.fontFamily, áp dụng thống nhất trong app.js (baseStyle/buildSrcDoc).
     .dp-font-item / #dp-font-list hiện trống & nằm trong .rd-legacy (display:none) nên
     không có UI nào gọi tới đoạn này — bỏ hẳn, không thay bằng override JS nào khác. */

  /* ---- đồng bộ trạng thái bảng với cài đặt thật ---- */
  function syncDisplayPanel() {
    const s = app().getSettings ? app().getSettings() : null;
    if (!s) return;
    const isScroll = s.mode !== "paginated";
    const cols = Number(s.columns) === 2 ? 2 : 1;

    if (dpScrollCheck) dpScrollCheck.checked = isScroll;
    if (dpModeScroll) dpModeScroll.classList.toggle("active", isScroll);
    if (dpModePaginated) dpModePaginated.classList.toggle("active", !isScroll);
    if (dpCol1) dpCol1.classList.toggle("active", cols === 1);
    if (dpCol2) dpCol2.classList.toggle("active", cols === 2);

    document.querySelectorAll(".dp-theme-btn[data-theme]").forEach((b) =>
      b.classList.toggle("active", !s.bgImage && b.dataset.theme === s.theme));
    document.querySelectorAll("[data-bg-image]").forEach((b) =>
      b.classList.toggle("active", b.dataset.bgImage === s.bgImage));
    if (bgOpacityWrap) bgOpacityWrap.classList.toggle("hidden", !s.bgImage);
    if (bgOpacityInput && document.activeElement !== bgOpacityInput) {
      bgOpacityInput.value = String(Math.round((Number(s.bgImageOpacity ?? 0.5)) * 100));
    }
    if (bgOpacityValue) bgOpacityValue.textContent = Math.round((Number(s.bgImageOpacity ?? 0.5)) * 100) + "%";
  }

  document.addEventListener("reader:settings", syncDisplayPanel);
  syncDisplayPanel();

  /* ═══════════════════════════════════════════════════════════════
     4.  MUSIC PLAYER
  ═══════════════════════════════════════════════════════════════ */

  const btnMusic      = safe("#btn-music");
  const btnMobileMusic = safe("#btn-mobile-readaloud");
  const btnMusicClose = safe("#btn-music-close");
  // Nút "Mở bảng nhạc nền" trong Settings pane (reader-ui.js) — đăng ký thẳng ở đây
  // làm 1 trigger hợp lệ của musicPanel, thay vì gọi hộ .click() của #btn-music.
  const rdOpenMusic   = $("#rd-open-music");
  const mmList        = $("#mm-list");
  let musicDisabledByTts = !!window.ReaderReadAloud?.isActive?.();

  function isMusicDisabledByTts() {
    return musicDisabledByTts || !!window.ReaderReadAloud?.isActive?.();
  }

  function syncMusicDisabledUi() {
    const disabled = isMusicDisabledByTts();
    [btnMusic, btnMobileMusic, rdOpenMusic, mmList].filter(Boolean).forEach((btn) => {
      if (!btn.dataset.musicTitle) btn.dataset.musicTitle = btn.title || "";
      btn.classList.toggle("music-disabled", disabled);
      btn.setAttribute("aria-disabled", disabled ? "true" : "false");
      btn.title = disabled ? tr("music.disabledByTts", null, "Nhạc nền tạm tắt khi đang dùng đọc to") : (btn.dataset.musicTitle || "");
    });
    if (musicPanel) musicPanel.classList.toggle("music-disabled", disabled);
  }

  /** Mở/đóng/toggle musicPanel — dùng chung cho mọi nút kích hoạt (btnMusic, rdOpenMusic…). */
  function openMusicPanel() {
    if (!musicPanel) return;
    if (isMusicDisabledByTts()) {
      closeMusicPanel();
      showMusicNotice(tr("music.disabledByTts", null, "Nhạc nền tạm tắt khi đang dùng đọc to"));
      syncMusicDisabledUi();
      return;
    }
    musicPanel.classList.remove("hidden");
    if (displayPanel) displayPanel.classList.add("hidden");
  }
  function closeMusicPanel() {
    if (!musicPanel) return;
    musicPanel.classList.add("hidden");
  }
  function toggleMusicPanel() {
    if (!musicPanel) return;
    if (isMusicDisabledByTts()) {
      closeMusicPanel();
      showMusicNotice(tr("music.disabledByTts", null, "Nhạc nền tạm tắt khi đang dùng đọc to"));
      syncMusicDisabledUi();
      return;
    }
    if (musicPanel.classList.contains("hidden")) openMusicPanel();
    else closeMusicPanel();
  }

  if (musicPanel) {
    const musicTriggers = [btnMusic, rdOpenMusic, mmList].filter(Boolean);
    if (musicTriggers.length) panels.push({ panel: musicPanel, triggers: musicTriggers });
  }

  if (btnMusic && musicPanel) {
    btnMusic.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isMusicDisabledByTts()) {
        closeMusicPanel();
        showMusicNotice(tr("music.disabledByTts", null, "Nhạc nền tạm tắt khi đang dùng đọc to"));
        syncMusicDisabledUi();
        return;
      }
      toggleMusicPanel();
    });
  }

  // #rd-open-music KHÔNG gắn listener ở đây — reader-ui.js gọi thẳng
  // window.ReaderFeatures.toggleMusicPanel() để tránh việc cả 2 file cùng lắng nghe
  // click trên cùng 1 nút (sẽ toggle 2 lần = mở rồi đóng ngay trong 1 cú click).
  // Nó vẫn được đăng ký làm trigger hợp lệ ở trên để click ra ngoài đóng đúng và
  // click vào chính nút này không bị cơ chế đóng-khi-click-ngoài tự đóng lại.

  if (btnMusicClose && musicPanel) {
    btnMusicClose.addEventListener("click", () => musicPanel.classList.add("hidden"));
  }

  // Giao tiếp sạch với reader-ui.js (nút #rd-open-music nằm ở file đó) — expose API
  // thay vì để reader-ui.js phải biết chi tiết nội bộ của music panel.
  window.ReaderFeatures = window.ReaderFeatures || {};
  window.ReaderFeatures.openMusicPanel = openMusicPanel;
  window.ReaderFeatures.closeMusicPanel = closeMusicPanel;
  window.ReaderFeatures.toggleMusicPanel = toggleMusicPanel;

  /* ---- audio engine ---- */
  const audio = new Audio();
  const MUSIC_VOLUME_KEY = "waka-music-volume-v1";
  const RATES = [0.75, 1, 1.25, 1.5, 2];
  const storedVolume = Number(localStorage.getItem(MUSIC_VOLUME_KEY));
  const defaultMusicVolume =
    (window.matchMedia?.("(max-width: 760px)")?.matches || document.documentElement.classList.contains("mobile-reader-forced")) ? 100 : 60;
  let musicVolume = Number.isFinite(storedVolume) ? Math.max(0, Math.min(100, storedVolume)) : defaultMusicVolume;
  audio.volume = musicVolume / 100;

  let playlist     = [];
  let currentIndex = -1;
  let isShuffled   = false;
  let isPlaying    = false;
  let isMuted      = false;
  let rateIndex    = 1;
  let ytIframe     = null;
  let ytReady      = false;
  let ytVideoId    = "";
  let ytLastState  = null;
  let ytLoadTimer  = null;
  let ytCurrentTime = 0;
  let ytDuration    = 0;
  const ytPlayerId = "waka-music-yt-" + Math.random().toString(36).slice(2, 9);

  const playlistEl     = $("#music-playlist");
  const nowPlayingEl   = $("#music-now-playing");
  const musicFileInput = $("#music-file-input");
  const btnAddMusic    = $("#btn-add-music");
  const youtubeInput   = $("#music-youtube-input");
  const btnAddYoutube  = $("#btn-add-youtube");
  const youtubeHost    = $("#music-yt-host");

  /* ---- lưu playlist vào IndexedDB (MusicDB) để không phải chọn lại nhạc
     mỗi lần mở lại reader ---- */

  /** Thêm 1 file nhạc vào playlist đang chạy + lưu xuống MusicDB (nếu có). */
  function addTrackToPlaylist(file) {
    const url = URL.createObjectURL(file);
    const track = { name: file.name.replace(/\.[^.]+$/, ""), type: "local", url };
    playlist.push(track);
    if (window.MusicDB) {
      window.MusicDB.addTrack({ name: track.name, blob: file, type: "local" })
        .then((id) => { track.id = id; })
        .catch((e) => console.warn("features.js: lưu nhạc vào MusicDB thất bại", e));
    }
    return track;
  }

  function addYoutubeTrackFromInput() {
    if (!youtubeInput) return;
    const sourceUrl = youtubeInput.value.trim();
    const videoId = parseYouTubeId(sourceUrl);
    if (!videoId) {
      pulseInvalidYoutubeInput();
      showMusicNotice("Link YouTube khong hop le");
      return;
    }
    const track = {
      name: "YouTube - " + videoId,
      type: "youtube",
      videoId,
      sourceUrl
    };
    playlist.push(track);
    if (window.MusicDB) {
      window.MusicDB.addTrack(track)
        .then((id) => { track.id = id; })
        .catch((e) => console.warn("features.js: luu YouTube vao MusicDB that bai", e));
    }
    youtubeInput.value = "";
    renderPlaylist();
    if (currentIndex === -1 && playlist.length > 0) loadTrack(playlist.length - 1);
  }

  /** Nạp lại playlist đã lưu từ MusicDB khi mở reader. */
  async function loadSavedPlaylist() {
    if (!window.MusicDB) return;
    try {
      const tracks = await window.MusicDB.listTracks();
      tracks.forEach((t) => {
        if (t.type === "youtube" && t.videoId) {
          playlist.push({
            id: t.id,
            name: t.name || ("YouTube - " + t.videoId),
            type: "youtube",
            videoId: t.videoId,
            sourceUrl: t.sourceUrl || ""
          });
          return;
        }
        if (t.blob) {
          const url = URL.createObjectURL(t.blob);
          playlist.push({ id: t.id, name: t.name, type: "local", url });
        }
      });
      renderPlaylist();
    } catch (e) {
      console.warn("features.js: không tải được playlist đã lưu", e);
    }
  }
  loadSavedPlaylist();

  /* ---- file input ---- */
  if (btnAddMusic && musicFileInput) {
    btnAddMusic.addEventListener("click", () => musicFileInput.click());

    musicFileInput.addEventListener("change", () => {
      const files = Array.from(musicFileInput.files || []);
      files.forEach((file) => addTrackToPlaylist(file));
      // Không set .value vì Chrome extension sandbox có thể chặn
      try { musicFileInput.value = ""; } catch(e) {}
      renderPlaylist();
      if (currentIndex === -1 && playlist.length > 0) loadTrack(0);
    });
  }

  if (btnAddYoutube) {
    btnAddYoutube.addEventListener("click", addYoutubeTrackFromInput);
  }
  if (youtubeInput) {
    youtubeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addYoutubeTrackFromInput();
      }
    });
  }

  /* ---- drag & drop ---- */
  if (musicPanel) {
    musicPanel.addEventListener("dragover", (e) => e.preventDefault());
    musicPanel.addEventListener("drop", (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("audio/"));
      files.forEach((file) => addTrackToPlaylist(file));
      renderPlaylist();
      if (currentIndex === -1 && playlist.length > 0) loadTrack(0);
    });
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function currentTrack() {
    return playlist[currentIndex] || null;
  }

  function trackType(track) {
    return track && track.type === "youtube" ? "youtube" : "local";
  }

  function splitTrackName(track) {
    const fallback = trackType(track) === "youtube" ? "YouTube" : tr("music.background", null, "Nhạc nền");
    const name = String(track?.name || tr("music.noTrack", null, "Chưa chọn bài")).replace(/\.[^.]+$/, "");
    const parts = name.split(/\s+-\s+/);
    if (parts.length >= 2) {
      return { artist: parts.shift().trim() || fallback, title: parts.join(" - ").trim() || name };
    }
    return { artist: track?.artist || fallback, title: name };
  }

  function getCurrentTime() {
    return trackType(currentTrack()) === "youtube" ? ytCurrentTime : (audio.currentTime || 0);
  }

  function getDuration() {
    return trackType(currentTrack()) === "youtube" ? ytDuration : (Number.isFinite(audio.duration) ? audio.duration : 0);
  }

  function getMusicState(reason = "state", extra = {}) {
    const track = currentTrack();
    const meta = splitTrackName(track);
    return {
      reason,
      playlistLength: playlist.length,
      currentIndex,
      hasTrack: !!track,
      isPlaying,
      isShuffled,
      isMuted,
      volume: musicVolume,
      rate: RATES[rateIndex] || 1,
      currentTime: getCurrentTime(),
      duration: getDuration(),
      track: track ? { ...track, title: meta.title, artist: meta.artist } : null,
      ...extra,
    };
  }

  function emitMusicState(reason = "state", extra = {}) {
    document.dispatchEvent(new CustomEvent("music:state", { detail: getMusicState(reason, extra) }));
  }

  function setPlaying(value) {
    isPlaying = !!value;
    updatePlayUi();
    emitMusicState("play");
  }

  function musicVolumePercent() {
    const raw = musicVolume;
    return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 60));
  }

  function showMusicNotice(message) {
    if (nowPlayingEl) nowPlayingEl.textContent = message;
  }

  function pulseInvalidYoutubeInput() {
    if (!youtubeInput) return;
    youtubeInput.classList.add("invalid");
    setTimeout(() => youtubeInput.classList.remove("invalid"), 1600);
  }

  function parseYouTubeId(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./i, "");
      if (host === "youtu.be") {
        const id = url.pathname.split("/").filter(Boolean)[0];
        return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : null;
      }
      if (/(^|\.)youtube\.com$/i.test(host)) {
        const v = url.searchParams.get("v");
        if (/^[A-Za-z0-9_-]{11}$/.test(v || "")) return v;
        const match = url.pathname.match(/\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
        if (match) return match[1];
      }
    } catch {}
    const fallback = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/|v\/))([A-Za-z0-9_-]{11})/i);
    return fallback ? fallback[1] : null;
  }

  function youtubeCommand(func, args = []) {
    if (!ytIframe || !ytIframe.contentWindow) return;
    ytIframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
  }

  function youtubeListen() {
    if (!ytIframe || !ytIframe.contentWindow) return;
    ytIframe.contentWindow.postMessage(JSON.stringify({ event: "listening", id: ytPlayerId }), "https://www.youtube.com");
  }

  function setYoutubeVolume() {
    youtubeCommand("setVolume", [isMuted ? 0 : musicVolumePercent()]);
  }

  function pauseYoutube() {
    youtubeCommand("pauseVideo");
  }

  function ensureYoutubeIframe(videoId) {
    if (!youtubeHost || ytIframe) return;
    ytIframe = document.createElement("iframe");
    ytIframe.id = ytPlayerId;
    ytIframe.className = "music-yt-frame";
    ytIframe.allow = "autoplay; encrypted-media";
    ytIframe.tabIndex = -1;
    const qs = new URLSearchParams({
      enablejsapi: "1",
      autoplay: "1",
      playsinline: "1",
      rel: "0",
      origin: location.origin
    });
    ytIframe.src = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?" + qs.toString();
    ytIframe.addEventListener("load", () => {
      youtubeListen();
      setYoutubeVolume();
      youtubeCommand("playVideo");
    });
    youtubeHost.textContent = "";
    youtubeHost.appendChild(ytIframe);
  }

  function renderPlaylist() {
    if (!playlistEl) return;
    if (!playlist.length) { playlistEl.innerHTML = ""; return; }
    playlistEl.innerHTML = playlist.map((t, i) => {
      const isYt = trackType(t) === "youtube";
      const icon = i === currentIndex ? ">" : (isYt ? "YT" : "~");
      const iconClass = "music-track-icon" + (isYt ? " music-track-icon--yt" : "");
      return `
        <div class="music-track${i === currentIndex ? " playing" : ""}" data-idx="${i}">
          <span class="${iconClass}">${icon}</span>
          <span class="music-track-name">${escHtml(t.name)}</span>
          <button class="music-track-remove" data-remove="${i}" title="Xoa">x</button>
        </div>`;
    }).join("");
  }

  function playYoutubeTrack(track) {
    try { audio.pause(); } catch {}
    try { audio.removeAttribute("src"); audio.load(); } catch {}
    ytLastState = null;
    ytCurrentTime = 0;
    ytDuration = 0;
    ytVideoId = track.videoId;
    ensureYoutubeIframe(track.videoId);
    setPlaying(true);
    if (ytReady) {
      youtubeCommand("loadVideoById", [track.videoId]);
      setYoutubeVolume();
      youtubeCommand("setPlaybackRate", [RATES[rateIndex] || 1]);
      youtubeCommand("playVideo");
    }
    clearTimeout(ytLoadTimer);
    ytLoadTimer = setTimeout(() => {
      if (currentTrack() === track && trackType(track) === "youtube" && !ytReady) {
        youtubeListen();
        youtubeCommand("playVideo");
      }
    }, 900);
  }

  function playLocalTrack(track) {
    pauseYoutube();
    audio.src = track.url;
    audio.volume = isMuted ? 0 : musicVolumePercent() / 100;
    audio.playbackRate = RATES[rateIndex] || 1;
    audio.play().catch((err) => {
      console.warn("features.js: khong phat duoc file nhac", err);
      setPlaying(false);
    });
  }

  function stopCurrentTrack() {
    try { audio.pause(); } catch {}
    pauseYoutube();
    setPlaying(false);
    if (btnMusic) btnMusic.classList.remove("music-active");
  }

  function closeMusicPlayer() {
    stopCurrentTrack();
    currentIndex = -1;
    ytCurrentTime = 0;
    ytDuration = 0;
    if (nowPlayingEl) nowPlayingEl.textContent = tr("music.noTrack", null, "Chưa chọn bài");
    renderPlaylist();
    emitMusicState("close");
  }

  function nextTrackIndex() {
    if (!playlist.length) return -1;
    return isShuffled
      ? Math.floor(Math.random() * playlist.length)
      : (currentIndex + 1) % playlist.length;
  }

  function prevTrackIndex() {
    if (!playlist.length) return -1;
    return isShuffled
      ? Math.floor(Math.random() * playlist.length)
      : (currentIndex - 1 + playlist.length) % playlist.length;
  }

  function playNextTrack() {
    if (isMusicDisabledByTts()) return;
    const idx = nextTrackIndex();
    if (idx >= 0) loadTrack(idx, { auto: true });
  }

  if (playlistEl) {
    playlistEl.addEventListener("click", (e) => {
      const removeBtn = e.target.closest("[data-remove]");
      if (removeBtn) {
        e.stopPropagation();
        const idx = Number(removeBtn.dataset.remove);
        const removed = playlist[idx];
        if (!removed) return;
        if (trackType(removed) === "local" && removed.url) URL.revokeObjectURL(removed.url);
        if (removed.id != null && window.MusicDB) {
          window.MusicDB.removeTrack(removed.id)
            .catch((e) => console.warn("features.js: xoá nhạc khỏi MusicDB thất bại", e));
        }
        playlist.splice(idx, 1);
        if (currentIndex === idx) {
          closeMusicPlayer();
        } else if (currentIndex > idx) currentIndex--;
        renderPlaylist();
        emitMusicState("track");
        return;
      }
      const track = e.target.closest(".music-track");
      if (track) loadTrack(Number(track.dataset.idx));
    });
  }

  function loadTrack(idx, opts = {}) {
    if (isMusicDisabledByTts()) {
      closeMusicPanel();
      stopCurrentTrack();
      showMusicNotice(tr("music.disabledByTts", null, "Nhạc nền tạm tắt khi đang dùng đọc to"));
      syncMusicDisabledUi();
      emitMusicState("disabled");
      return;
    }
    if (idx < 0 || idx >= playlist.length) return;
    currentIndex = idx;
    const track = playlist[idx];
    if (nowPlayingEl) nowPlayingEl.textContent = track.name;
    if (trackType(track) === "youtube") playYoutubeTrack(track);
    else playLocalTrack(track);
    renderPlaylist();
    if (btnMusic) btnMusic.classList.add("music-active");
    emitMusicState("track", { auto: !!opts.auto });
  }

  function updatePlayUi() {
    if (btnMusic) btnMusic.classList.toggle("music-active", isPlaying || !!currentTrack());
  }

  audio.addEventListener("ended", playNextTrack);
  audio.addEventListener("play", () => {
    if (trackType(currentTrack()) === "local") setPlaying(true);
  });
  audio.addEventListener("pause", () => {
    if (trackType(currentTrack()) === "local") setPlaying(false);
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== "https://www.youtube.com") return;
    let data = event.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch { return; }
    }
    if (!data || typeof data !== "object") return;
    if (data.event === "onReady") {
      ytReady = true;
      setYoutubeVolume();
      return;
    }
    if (data.event === "onError") {
      if (trackType(currentTrack()) === "youtube") {
        showMusicNotice("Video YouTube khong phat duoc, dang bo qua...");
        if (playlist.length > 1) playNextTrack();
        else stopCurrentTrack();
      }
      return;
    }
    if (data.event !== "infoDelivery") return;
    ytReady = true;
    const info = data.info || {};
    if (info.videoData && info.videoData.title && trackType(currentTrack()) === "youtube") {
      const track = currentTrack();
      if (track && track.videoId === ytVideoId && /^YouTube - /.test(track.name)) {
        track.name = info.videoData.title;
        track.artist = info.videoData.author || "YouTube";
        if (nowPlayingEl) nowPlayingEl.textContent = track.name;
        renderPlaylist();
        emitMusicState("meta");
      }
    }
    if (typeof info.currentTime === "number") ytCurrentTime = info.currentTime;
    if (typeof info.duration === "number") ytDuration = info.duration;
    if (typeof info.playerState === "number" && trackType(currentTrack()) === "youtube") {
      const state = info.playerState;
      if (state === 1) setPlaying(true);
      if (state === 2 || state === 5 || state === -1) setPlaying(false);
      if (state === 0 && ytLastState !== 0) playNextTrack();
      ytLastState = state;
    }
    emitMusicState("time");
  });

  audio.addEventListener("timeupdate", () => emitMusicState("time"));
  audio.addEventListener("loadedmetadata", () => emitMusicState("time"));

  function togglePlay() {
    if (isMusicDisabledByTts()) {
      closeMusicPanel();
      stopCurrentTrack();
      showMusicNotice(tr("music.disabledByTts", null, "Nhạc nền tạm tắt khi đang dùng đọc to"));
      syncMusicDisabledUi();
      emitMusicState("disabled");
      return;
    }
    if (!playlist.length) return;
    if (currentIndex === -1) { loadTrack(0); return; }
    if (trackType(currentTrack()) === "youtube") {
      if (isPlaying) {
        pauseYoutube();
        setPlaying(false);
      } else {
        youtubeCommand("playVideo");
        setPlaying(true);
      }
      return;
    }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }

  function seekTo(seconds) {
    if (isMusicDisabledByTts()) return;
    const duration = getDuration();
    const target = Math.max(0, Math.min(Number(seconds) || 0, duration || Number.MAX_SAFE_INTEGER));
    if (trackType(currentTrack()) === "youtube") {
      ytCurrentTime = target;
      youtubeCommand("seekTo", [target, true]);
    } else {
      try { audio.currentTime = target; } catch {}
    }
    emitMusicState("time");
  }

  function seekToFraction(fraction) {
    const duration = getDuration();
    if (!duration) return;
    seekTo(duration * Math.max(0, Math.min(1, Number(fraction) || 0)));
  }

  function seekBy(delta) {
    seekTo(getCurrentTime() + (Number(delta) || 0));
  }

  function setVolume(value) {
    if (isMusicDisabledByTts()) return;
    musicVolume = Math.max(0, Math.min(100, Number(value)));
    if (!Number.isFinite(musicVolume)) musicVolume = 60;
    localStorage.setItem(MUSIC_VOLUME_KEY, String(Math.round(musicVolume)));
    if (musicVolume > 0) isMuted = false;
    audio.volume = isMuted ? 0 : musicVolume / 100;
    setYoutubeVolume();
    emitMusicState("settings");
  }

  function toggleMute() {
    if (isMusicDisabledByTts()) return;
    isMuted = !isMuted;
    audio.volume = isMuted ? 0 : musicVolume / 100;
    setYoutubeVolume();
    emitMusicState("settings");
  }

  function cycleRate() {
    if (isMusicDisabledByTts()) return;
    rateIndex = (rateIndex + 1) % RATES.length;
    const rate = RATES[rateIndex] || 1;
    audio.playbackRate = rate;
    youtubeCommand("setPlaybackRate", [rate]);
    emitMusicState("settings");
  }

  function toggleShuffle() {
    if (isMusicDisabledByTts()) return;
    isShuffled = !isShuffled;
    emitMusicState("settings");
  }

  window.ReaderFeatures.music = {
    getState: () => getMusicState(),
    isPlaying: () => isPlaying,
    hasTrack: () => !!currentTrack(),
    togglePlay,
    next: playNextTrack,
    prev: () => {
      const idx = prevTrackIndex();
      if (idx >= 0) loadTrack(idx);
    },
    seekTo,
    seekBy,
    seekToFraction,
    setVolume,
    toggleMute,
    cycleRate,
    toggleShuffle,
    close: closeMusicPlayer,
  };
  emitMusicState("init");
  syncMusicDisabledUi();

  document.addEventListener("readaloud:state", (e) => {
    const active = !!e.detail?.speaking;
    musicDisabledByTts = active;
    syncMusicDisabledUi();
    if (active) {
      closeMusicPanel();
      closeMusicPlayer();
      showMusicNotice(tr("music.disabledByTts", null, "Nhạc nền tạm tắt khi đang dùng đọc to"));
      emitMusicState("disabled");
    } else {
      emitMusicState("enabled");
    }
  });

  function syncI18nMusic() {
    syncMusicDisabledUi();
    emitMusicState("i18n");
  }
  document.addEventListener("i18n:ready", syncI18nMusic);
  document.addEventListener("i18n:changed", syncI18nMusic);

  /* ---- dừng nhạc khi về thư viện ---- */
  const btnBackLib = $("#btn-back-library");
  if (btnBackLib) {
    btnBackLib.addEventListener("click", () => {
      closeMusicPlayer();
    }, true);
  }

})();
