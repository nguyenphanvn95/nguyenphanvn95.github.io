// Mobile reader shell for small screens. Runs after the desktop reader modules.
(() => {
  "use strict";

  const MOBILE_QUERY = "(max-width: 760px)";
  const MOBILE_DEFAULTS_KEY = "waka-mobile-reader-defaults-v1";
  const BRIGHTNESS_KEY = "waka-mobile-brightness-v1";
  const mq = window.matchMedia(MOBILE_QUERY);
  const $ = (sel) => document.querySelector(sel);
  const app = () => window.ReaderApp || {};
  const MOBILE_FORCE_STYLE_ID = "forced-mobile-media-rules";

  const readerView = $("#reader-view");
  const sidebar = $("#sidebar");
  const bookFrame = $("#book-frame");
  const viewport = $("#content-viewport");
  const mobileTabs = $("#mobile-sidebar-tabs");
  const mobileTts = $("#btn-mobile-tts");
  const mobileMusic = $("#btn-mobile-readaloud");
  const mobileTypo = $("#btn-mobile-typo");
  const mobileToc = $("#btn-mobile-toc");
  const settingsSheet = $("#mobile-settings-sheet");
  const musicPanel = $("#music-panel");
  const brightnessOverlay = $("#mobile-brightness-overlay");
  const brightnessInput = $("#mobile-brightness");
  const fontSizeInput = $("#mobile-font-size");
  const lineHeightGroup = $("#mobile-lineheight-group");
  const fontPills = $("#mobile-font-pills");
  const scrollMode = $("#mobile-scroll-mode");
  const prevChapter = $("#mchap-prev");
  const nextChapter = $("#mchap-next");

  if (!readerView) return;

  let uiTimer = 0;
  let defaultsApplied = false;
  let frameDocBound = null;

  function applyBrightness(value) {
    const v = Math.max(20, Math.min(100, Number(value) || 100));
    if (brightnessOverlay) brightnessOverlay.style.opacity = String(((100 - v) / 100) * 0.8);
    if (brightnessInput && brightnessInput.value !== String(v)) brightnessInput.value = String(v);
    try { localStorage.setItem(BRIGHTNESS_KEY, String(v)); } catch (e) {}
  }

  applyBrightness(Number(localStorage.getItem(BRIGHTNESS_KEY)) || 100);

  function logicalScreenWidth() {
    const dpr = window.devicePixelRatio || 1;
    const screenMin = Math.min(screen.width || 0, screen.height || 0);
    const visual = window.visualViewport ? Math.min(window.visualViewport.width, window.visualViewport.height) : 0;
    const byScreen = screenMin > 760 && dpr > 1 ? screenMin / dpr : screenMin;
    return Math.min(...[visual, byScreen, window.innerWidth].filter((n) => Number.isFinite(n) && n > 0));
  }

  function shouldForceMobile() {
    const touch = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
    const android = /Android/i.test(navigator.userAgent || "");
    const portraitLike = Math.max(screen.width || 0, screen.height || 0) / Math.max(1, Math.min(screen.width || 1, screen.height || 1)) > 1.25;
    return !mq.matches && (touch || android) && portraitLike && logicalScreenWidth() <= 1024;
  }

  function copyMatchingMobileRules() {
    const chunks = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of Array.from(rules || [])) {
        if (typeof CSSMediaRule === "undefined" || !(rule instanceof CSSMediaRule)) continue;
        const condition = rule.conditionText || "";
        const match = /max-width:\s*(\d+)px/i.exec(condition);
        if (!match || Number(match[1]) > 900) continue;
        for (const inner of Array.from(rule.cssRules || [])) chunks.push(inner.cssText);
      }
    }
    return chunks.join("\n");
  }

  function applyMobileDetection() {
    const forced = shouldForceMobile();
    document.documentElement.classList.toggle("mobile-reader-forced", forced);

    let style = document.getElementById(MOBILE_FORCE_STYLE_ID);
    if (!forced) {
      if (style) style.remove();
      return;
    }
    const css = copyMatchingMobileRules();
    if (!style) {
      style = document.createElement("style");
      style.id = MOBILE_FORCE_STYLE_ID;
      document.head.appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }

  applyMobileDetection();

  function isMobile() {
    return mq.matches || document.documentElement.classList.contains("mobile-reader-forced");
  }

  function isReaderOpen() {
    return !readerView.classList.contains("hidden") && !!(app().isReaderOpen && app().isReaderOpen());
  }

  function syncFloatingOffsets() {
    const nav = $("#mobile-chapter-nav");
    const navVisible = isMobile() && readerView.classList.contains("mobile-ui-visible") && nav;
    const h = navVisible ? nav.offsetHeight || 72 : 0;
    document.documentElement.style.setProperty("--waka-mobile-nav-h", h + "px");
  }

  function closeSettingsSheet() {
    if (!settingsSheet) return;
    settingsSheet.classList.add("hidden");
    settingsSheet.setAttribute("aria-hidden", "true");
    readerView.classList.remove("mobile-settings-open");
    syncFloatingOffsets();
    syncSettingsUi();
  }

  function closeMusicSheet() {
    if (!musicPanel) return;
    musicPanel.classList.add("hidden");
    readerView.classList.remove("mobile-music-open");
    syncFloatingOffsets();
    syncMusicButton();
  }

  function closeTtsPanel() {
    window.WakaTTSPill?.closePanel?.();
    readerView.classList.remove("mobile-tts-open");
    syncTtsButton();
    syncFloatingOffsets();
  }

  function openSettingsSheet() {
    if (!isMobile() || !settingsSheet) return;
    closeSidebar();
    closeMusicSheet();
    closeTtsPanel();
    syncSettingsUi();
    settingsSheet.classList.remove("hidden");
    settingsSheet.setAttribute("aria-hidden", "false");
    readerView.classList.add("mobile-settings-open", "mobile-ui-visible");
    syncFloatingOffsets();
    syncSettingsUi();
  }

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.add("hidden");
    readerView.classList.remove("mobile-sidebar-open", "mobile-tool-panel-open");
    if (mobileToc) mobileToc.classList.remove("active");
    syncFloatingOffsets();
  }

  function openSidebar(panel) {
    if (!isMobile()) return;
    closeSettingsSheet();
    closeMusicSheet();
    closeTtsPanel();
    const rail = panel === "marks" ? $("#rd-rail-marks")
      : panel === "search" ? $("#rd-rail-search")
      : $("#rd-rail-toc");
    clickRailEnsureOpen(rail, panel || "toc");
    readerView.classList.add("mobile-sidebar-open", "mobile-ui-visible");
    if (mobileToc) mobileToc.classList.add("active");
    syncFloatingOffsets();
    syncMobileTabs(panel || "toc");
  }

  function clickRailEnsureOpen(rail, panel) {
    if (!rail || !sidebar) return;
    if (getActivePanel() !== panel || sidebar.classList.contains("hidden")) rail.click();
    if (sidebar.classList.contains("hidden")) rail.click();
  }

  function getActivePanel() {
    const active = document.querySelector(".rd-rail .rail-btn.active");
    return active ? active.dataset.panel : "";
  }

  function syncMobileTabs(activePanel) {
    if (!mobileTabs) return;
    const panel = activePanel || getActivePanel() || "toc";
    const known = panel === "marks" || panel === "search" ? panel : "toc";
    mobileTabs.querySelectorAll("[data-mobile-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mobileTab === known);
    });
  }

  function showChrome(autoHide = true) {
    if (!isMobile() || !isReaderOpen()) return;
    readerView.classList.add("mobile-ui-visible");
    syncFloatingOffsets();
    clearTimeout(uiTimer);
    if (autoHide &&
        !readerView.classList.contains("mobile-sidebar-open") &&
        !readerView.classList.contains("mobile-tool-panel-open") &&
        !readerView.classList.contains("mobile-music-open") &&
        !readerView.classList.contains("mobile-tts-open") &&
        !readerView.classList.contains("mobile-settings-open")) {
      uiTimer = setTimeout(() => {
        readerView.classList.remove("mobile-ui-visible");
        syncFloatingOffsets();
      }, 4200);
    }
  }

  function toggleChrome() {
    if (!isMobile() || !isReaderOpen()) return;
    const visible = readerView.classList.toggle("mobile-ui-visible");
    clearTimeout(uiTimer);
    if (visible) showChrome(true);
    else syncFloatingOffsets();
  }

  function clickLooksLikeReadingTap(evt) {
    const target = evt.target;
    if (!target) return false;
    if (target.closest && target.closest("a, button, input, textarea, select, label")) return false;
    const selection = bookFrame?.contentWindow?.getSelection?.();
    if (selection && String(selection).trim()) return false;
    const settings = app().getSettings ? app().getSettings() : {};
    if (settings.mode === "paginated") {
      const width = bookFrame?.clientWidth || window.innerWidth || 1;
      const ratio = evt.clientX / width;
      return ratio >= 1 / 3 && ratio <= 2 / 3;
    }
    return true;
  }

  function bindFrameTap() {
    if (!bookFrame || !isMobile()) return;
    let doc = null;
    try { doc = bookFrame.contentDocument; } catch (e) {}
    if (!doc || doc === frameDocBound) return;
    frameDocBound = doc;
    doc.addEventListener("click", (evt) => {
      if (clickLooksLikeReadingTap(evt)) toggleChrome();
    }, true);
    bindChapterSwipe(doc);
  }

  function bindChapterSwipe(doc) {
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;

    function isBlockedTarget(target) {
      return !!(target && target.closest && target.closest("a, button, input, textarea, select, label"));
    }

    doc.addEventListener("touchstart", (evt) => {
      if (evt.touches.length !== 1 || isBlockedTarget(evt.target)) {
        tracking = false;
        return;
      }
      if (readerView.classList.contains("mobile-sidebar-open") ||
          readerView.classList.contains("mobile-settings-open") ||
          readerView.classList.contains("mobile-music-open")) {
        tracking = false;
        return;
      }
      const t = evt.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
      tracking = true;
    }, { passive: true });

    doc.addEventListener("touchend", (evt) => {
      if (!tracking) return;
      tracking = false;
      if (isBlockedTarget(evt.target)) return;
      const t = evt.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startT;
      if (dt > 600) return;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const sel = doc.getSelection ? doc.getSelection() : null;
      if (sel && String(sel).trim()) return;
      const loc = app().getLocation ? app().getLocation() : null;
      if (!loc || !app().gotoSpine) return;
      const spineIndex = Number(loc.spineIndex || 0);
      const spineCount = Number(loc.spineCount || 0);
      const nextIndex = dx > 0 ? spineIndex - 1 : spineIndex + 1;
      if (nextIndex < 0 || (spineCount > 0 && nextIndex >= spineCount)) return;
      app().gotoSpine(nextIndex);
    }, { passive: true });
  }

  function syncChapterButtons(loc) {
    if (!prevChapter || !nextChapter) return;
    const spineIndex = Number(loc?.spineIndex || 0);
    const spineCount = Number(loc?.spineCount || 0);
    prevChapter.disabled = spineIndex <= 0;
    nextChapter.disabled = spineCount <= 0 || spineIndex >= spineCount - 1;
  }

  function syncSettingsUi() {
    const s = app().getSettings ? app().getSettings() : {};
    if (fontSizeInput && document.activeElement !== fontSizeInput) fontSizeInput.value = String(s.fontSize || 19);
    if (lineHeightGroup) {
      const current = Number(s.lineHeight || 1.75).toFixed(2);
      lineHeightGroup.querySelectorAll("[data-line-height]").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.lineHeight).toFixed(2) === current);
      });
    }
    if (fontPills) {
      fontPills.querySelectorAll("[data-font-family]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.fontFamily === (s.fontFamily || ""));
      });
    }
    if (scrollMode) scrollMode.checked = s.mode !== "paginated";
    document.querySelectorAll("[data-mobile-theme]").forEach((btn) => {
      btn.classList.toggle("active", !s.bgImage && btn.dataset.mobileTheme === (s.theme || "light"));
    });
    document.querySelectorAll("[data-mobile-bg-image]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mobileBgImage === s.bgImage);
    });
    if (mobileTypo) mobileTypo.classList.toggle("active", readerView.classList.contains("mobile-settings-open"));
  }

  function syncMusicButton() {
    if (!mobileMusic) return;
    const panelOpen = !!musicPanel && !musicPanel.classList.contains("hidden");
    const playing = !!(window.ReaderFeatures && window.ReaderFeatures.music && window.ReaderFeatures.music.isPlaying());
    mobileMusic.classList.toggle("active", panelOpen || playing);
  }

  function syncTtsButton() {
    if (!mobileTts) return;
    const panelOpen = !!window.WakaTTSPill?.isPanelOpen?.();
    const active = !!window.ReaderReadAloud?.isActive?.();
    const playing = !!window.ReaderReadAloud?.isSpeaking?.();
    mobileTts.classList.toggle("active", panelOpen || active);
    mobileTts.classList.toggle("tts-playing", playing);
    readerView.classList.toggle("mobile-tts-open", panelOpen);
    syncFloatingOffsets();
  }

  async function applyMobileDefaultsOnce() {
    if (defaultsApplied || !isMobile() || !isReaderOpen()) return;
    defaultsApplied = true;
    if (sessionStorage.getItem(MOBILE_DEFAULTS_KEY)) return;
    sessionStorage.setItem(MOBILE_DEFAULTS_KEY, "1");
    if (app().setColumns) await app().setColumns(1);
    if (app().setMode) await app().setMode("scroll");
  }

  function handleModeChange() {
    if (!isMobile()) {
      closeSettingsSheet();
      closeSidebar();
      closeMusicSheet();
      closeTtsPanel();
      readerView.classList.remove("mobile-ui-visible", "mobile-sidebar-open", "mobile-tool-panel-open", "mobile-settings-open", "mobile-music-open", "mobile-tts-open");
      return;
    }
    syncSettingsUi();
    syncMusicButton();
    syncTtsButton();
  }

  if (mobileTts) {
    mobileTts.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSettingsSheet();
      closeSidebar();
      closeMusicSheet();
      if (window.WakaTTSPill?.isPanelOpen?.()) {
        closeTtsPanel();
      } else {
        window.WakaTTSPill?.openPanel?.();
        readerView.classList.add("mobile-tts-open", "mobile-ui-visible");
        syncFloatingOffsets();
      }
      syncTtsButton();
      showChrome(false);
    });
  }

  if (mobileMusic) {
    mobileMusic.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSettingsSheet();
      closeSidebar();
      closeTtsPanel();
      if (window.ReaderFeatures?.toggleMusicPanel) window.ReaderFeatures.toggleMusicPanel();
      else $("#btn-music")?.click();
      if (musicPanel && !musicPanel.classList.contains("hidden")) {
        readerView.classList.add("mobile-music-open", "mobile-ui-visible");
      } else {
        readerView.classList.remove("mobile-music-open");
      }
      syncFloatingOffsets();
      syncMusicButton();
      readerView.classList.add("mobile-ui-visible");
    });
  }

  $("#btn-bookmark")?.addEventListener("click", (e) => {
    if (!isMobile()) return;
    e.stopPropagation();
    showChrome(true);
  });

  if (mobileTypo) {
    mobileTypo.addEventListener("click", (e) => {
      e.stopPropagation();
      if (settingsSheet && !settingsSheet.classList.contains("hidden")) closeSettingsSheet();
      else openSettingsSheet();
    });
  }

  if (mobileToc) {
    mobileToc.addEventListener("click", (e) => {
      e.stopPropagation();
      if (sidebar && !sidebar.classList.contains("hidden") && getActivePanel() === "toc") closeSidebar();
      else openSidebar("toc");
    });
  }

  $(".rd-tab")?.addEventListener("click", (e) => {
    if (!isMobile()) return;
    e.stopPropagation();
    $("#btn-back-library")?.click();
  });

  if (mobileTabs) {
    mobileTabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mobile-tab]");
      if (!btn) return;
      const tab = btn.dataset.mobileTab;
      openSidebar(tab === "marks" || tab === "search" ? tab : "toc");
    });
  }

  if (settingsSheet) {
    settingsSheet.addEventListener("click", (e) => {
      if (e.target === settingsSheet) closeSettingsSheet();
    });
  }

  if (musicPanel) {
    const mo = new MutationObserver(() => {
      const open = !musicPanel.classList.contains("hidden");
      readerView.classList.toggle("mobile-music-open", isMobile() && open);
      syncMusicButton();
    });
    mo.observe(musicPanel, { attributes: true, attributeFilter: ["class"] });
  }

  document.querySelectorAll("[data-mobile-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (app().setTheme) app().setTheme(btn.dataset.mobileTheme);
    });
  });

  document.querySelectorAll("[data-mobile-bg-image]").forEach((btn) => {
    btn.addEventListener("click", () => app().setBgImage && app().setBgImage(btn.dataset.mobileBgImage));
  });

  brightnessInput?.addEventListener("input", () => applyBrightness(brightnessInput.value));
  fontSizeInput?.addEventListener("input", () => app().setFontSize && app().setFontSize(fontSizeInput.value));
  lineHeightGroup?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-line-height]");
    if (!btn) return;
    app().setLineHeight && app().setLineHeight(Number(btn.dataset.lineHeight));
  });
  fontPills?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-font-family]");
    if (!btn) return;
    app().setFontFamily && app().setFontFamily(btn.dataset.fontFamily);
  });
  scrollMode?.addEventListener("change", () => app().setMode && app().setMode(scrollMode.checked ? "scroll" : "paginated"));

  prevChapter?.addEventListener("click", () => {
    const loc = app().getLocation ? app().getLocation() : null;
    if (loc && app().gotoSpine) app().gotoSpine(loc.spineIndex - 1);
  });

  nextChapter?.addEventListener("click", () => {
    const loc = app().getLocation ? app().getLocation() : null;
    if (loc && app().gotoSpine) app().gotoSpine(loc.spineIndex + 1);
  });

  $("#toc-list")?.addEventListener("click", (e) => {
    if (isMobile() && e.target.closest("a[data-href]")) closeSidebar();
  });

  $("#bookmark-list")?.addEventListener("click", (e) => {
    if (isMobile() && e.target.closest(".bookmark-item")) closeSidebar();
  });

  document.addEventListener("click", (e) => {
    if (!isMobile()) return;
    if (sidebar && !sidebar.classList.contains("hidden")) {
      const insideSidebar = sidebar.contains(e.target);
      const insideToc = mobileToc && mobileToc.contains(e.target);
      const insideMusic = mobileMusic && mobileMusic.contains(e.target);
      const insideTts = mobileTts && mobileTts.contains(e.target);
      if (!insideSidebar && !insideToc && !insideMusic && !insideTts) closeSidebar();
    }
  }, true);

  document.addEventListener("click", (e) => {
    if (!isMobile() || !musicPanel || musicPanel.classList.contains("hidden")) return;
    const insidePanel = musicPanel.contains(e.target);
    const insideButton = mobileMusic && mobileMusic.contains(e.target);
    if (!insidePanel && !insideButton) closeMusicSheet();
  }, true);

  viewport?.addEventListener("click", (e) => {
    if (!e.target.closest("button")) toggleChrome();
  });

  bookFrame?.addEventListener("load", () => {
    bindFrameTap();
    showChrome(true);
  });

  document.addEventListener("reader:settings", syncSettingsUi);
  document.addEventListener("reader:location", async (e) => {
    syncChapterButtons(e.detail || {});
    syncFloatingOffsets();
    syncMobileTabs();
    bindFrameTap();
    await applyMobileDefaultsOnce();
  });

  document.addEventListener("music:state", syncMusicButton);
  document.addEventListener("readaloud:state", syncTtsButton);
  document.addEventListener("tts:panel", syncTtsButton);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isMobile()) {
      closeSettingsSheet();
      closeSidebar();
      closeTtsPanel();
    }
  });

  function refreshMobileMode() {
    applyMobileDetection();
    handleModeChange();
  }

  mq.addEventListener ? mq.addEventListener("change", refreshMobileMode) : mq.addListener(refreshMobileMode);
  window.addEventListener("resize", refreshMobileMode);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", refreshMobileMode);
  handleModeChange();
})();
