// i18n.js - UI language switcher for EPUB Reader.
(() => {
  "use strict";

  const STORAGE_KEY = "reader-language";
  const DEFAULT_LANG = "vi";
  const LANGUAGES = [
    { code: "vi", label: "Tiếng Việt" },
    { code: "en", label: "English" },
  ];
  const dicts = {};
  let current = DEFAULT_LANG;
  let readyResolve;

  function urlFor(code) {
    const rel = `lang/${code}.json`;
    try {
      return chrome.runtime.getURL(rel);
    } catch {
      return new URL(`../${rel}`, document.baseURI).href;
    }
  }

  async function loadDict(code) {
    try {
      const resp = await fetch(urlFor(code), { cache: "no-store" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      dicts[code] = await resp.json();
    } catch (err) {
      console.warn("[i18n] Cannot load language", code, err);
      dicts[code] = {};
    }
  }

  function getStoredLang() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          resolve(res?.[STORAGE_KEY] || DEFAULT_LANG);
        });
      } catch {
        try { resolve(localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG); }
        catch { resolve(DEFAULT_LANG); }
      }
    });
  }

  function saveLang(code) {
    try { chrome.storage.local.set({ [STORAGE_KEY]: code }); }
    catch {
      try { localStorage.setItem(STORAGE_KEY, code); } catch {}
    }
  }

  function t(key, params) {
    const fallback = dicts[DEFAULT_LANG] || {};
    let value = dicts[current]?.[key] ?? fallback[key] ?? key;
    if (params) {
      value = String(value).replace(/\{(\w+)\}/g, (m, name) =>
        params[name] == null ? m : String(params[name]));
    }
    return value;
  }

  function setText(selector, key, root = document) {
    root.querySelectorAll(selector).forEach((el) => { el.textContent = t(key); });
  }

  function setAttr(selector, attr, key, root = document) {
    root.querySelectorAll(selector).forEach((el) => { el.setAttribute(attr, t(key)); });
  }

  function setPlaceholder(selector, key, root = document) {
    setAttr(selector, "placeholder", key, root);
  }

  function applyDataAttrs(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    ["title", "aria-label", "placeholder"].forEach((attr) => {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
        el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
      });
    });
  }

  function applyStatic(root = document) {
    document.documentElement.lang = current;
    document.title = t("app.title");
    applyDataAttrs(root);

    setAttr("#rd-rail-toc", "title", "rail.toc", root);
    setAttr("#rd-rail-toc", "aria-label", "rail.tocShort", root);
    setAttr("#rd-rail-search", "title", "rail.search", root);
    setAttr("#rd-rail-search", "aria-label", "rail.search", root);
    setAttr("#rd-rail-readaloud", "title", "rail.readAloud", root);
    setAttr("#rd-rail-readaloud", "aria-label", "rail.readAloud", root);
    setAttr("#rd-rail-marks", "title", "rail.bookmarks", root);
    setAttr("#rd-rail-marks", "aria-label", "rail.bookmarks", root);
    setAttr("#rd-rail-annotation", "title", "rail.notes", root);
    setAttr("#rd-rail-annotation", "aria-label", "rail.notes", root);
    setAttr("#rd-rail-images", "title", "rail.images", root);
    setAttr("#rd-rail-images", "aria-label", "rail.images", root);
    setAttr("#rd-rail-timeline", "title", "rail.timeline", root);
    setAttr("#rd-rail-theme", "title", "rail.theme", root);
    setAttr("#rd-rail-typo", "title", "rail.typography", root);
    setAttr("#rd-rail-settings", "title", "rail.settings", root);

    setText('[data-mobile-tab="toc"]', "panel.toc", root);
    setText('[data-mobile-tab="marks"]', "panel.marks", root);
    setText('[data-group="library"] span', "panel.library", root);
    setText('[data-group="toc"] span', "panel.toc", root);
    setPlaceholder("#search-input", "search.placeholder", root);
    setText("#bookmark-empty", "bookmark.empty", root);
    setText("#rd-ann-block-def [data-ann-toggle] span:first-of-type", "ann.vocabulary", root);
    setText("#rd-ann-block-note [data-ann-toggle] span:first-of-type", "ann.notes", root);
    setText("#rd-ann-def-empty", "ann.emptyVocabulary", root);
    setText("#rd-ann-note-empty", "ann.emptyNotes", root);
    setText("#rd-image-empty", "images.empty", root);
    setText("#rd-timeline-empty", "timeline.empty", root);

    setText('[data-pane="readaloud"] > .rd-label:first-child', "tts.readAloud", root);
    setAttr("#tts-start", "title", "tts.startTitle", root);
    setAttr("#tts-pause", "title", "tts.pause", root);
    setAttr("#tts-resume", "title", "tts.resume", root);
    setAttr("#tts-stop", "title", "tts.stop", root);
    setText('label[for="tts-voice"]', "tts.voice", root);
    setText('label[for="tts-rate"]', "tts.speed", root);
    setText('label[for="tts-volume"]', "tts.volume", root);

    setText('label[for="rd-mode"]', "typo.mode", root);
    setText('#rd-mode option[value="paginated"]', "typo.paginated", root);
    setText('#rd-mode option[value="scroll"]', "typo.scroll", root);
    setText('label[for="rd-columns"]', "typo.columns", root);
    setText('#rd-columns option[value="1"]', "typo.oneColumn", root);
    setText('#rd-columns option[value="2"]', "typo.twoColumns", root);
    setText('label[for="rd-fontfamily"]', "typo.fontFamily", root);
    setText('[data-font-preset=""]', "typo.originalFont", root);
    setText('[data-font-preset="serif"]', "typo.serif", root);
    setText('[data-font-preset="sans"]', "typo.sans", root);
    setText('[data-font-preset="dyslexic"]', "typo.easyRead", root);
    setPlaceholder("#rd-fontfamily", "typo.fontPlaceholder", root);
    setText('[data-pane="typography"] > .rd-label:nth-of-type(4)', "typo.fontSize", root);
    setText('[data-pane="typography"] > .rd-label:nth-of-type(5)', "typo.fontWeight", root);
    setText('[data-pane="typography"] > .rd-label:nth-of-type(6)', "typo.lineHeight", root);
    setText('[data-pane="typography"] > .rd-label:nth-of-type(7)', "typo.zoom", root);

    setText('label[for="rd-accent"]', "theme.sourceColor", root);
    setText('[data-pane="theme"] > .rd-label:nth-of-type(2)', "theme.backgroundColor", root);
    setText('label[for="rd-bg-opacity"]', "theme.backgroundOpacity", root);

    setText('[data-pane="settings"] > .rd-label:nth-of-type(1)', "settings.music", root);
    setText("#rd-open-music", "settings.openMusic", root);
    setText('[data-pane="settings"] > .rd-label:nth-of-type(2)', "settings.selectText", root);
    setText(".rd-setting-toggle:has(#rd-select-text) > span:first-child", "settings.enableSelectText", root);
    setText("#rd-language-label", "settings.language", root);
    setText("#rd-language-hint", "settings.languageHint", root);
    setText('[data-pane="settings"] > .rd-label:nth-of-type(4)', "settings.other", root);
    setText("#rd-reset-typo", "settings.resetTypography", root);
    setText("#rd-back-library", "settings.backLibrary", root);

    setAttr("#btn-mobile-tts", "title", "tts.readAloud", root);
    setAttr("#btn-mobile-tts", "aria-label", "tts.readAloud", root);
    setAttr("#btn-mobile-readaloud,#btn-music", "title", "music.background", root);
    setAttr("#btn-mobile-readaloud,#btn-music", "aria-label", "music.background", root);
    setAttr("#btn-bookmark", "title", "bookmark.addPage", root);
    setAttr("#btn-bookmark", "aria-label", "bookmark.addPage", root);
    setAttr("#btn-mobile-typo", "title", "mobile.typeSettings", root);
    setAttr("#btn-mobile-toc", "title", "panel.toc", root);
    setAttr("#btn-prev", "aria-label", "nav.prevPage", root);
    setAttr("#btn-next", "aria-label", "nav.nextPage", root);
    // 6.8.3: nút tròn chỉ có icon → thêm tooltip (title) cho dễ hiểu
    setAttr("#btn-prev", "title", "nav.prevPage", root);
    setAttr("#btn-next", "title", "nav.nextPage", root);
    setText("#mchap-prev span", "nav.prevChapter", root);
    setText("#mchap-next span", "nav.nextChapter", root);
    setAttr("#mchap-prev", "aria-label", "nav.prevChapter", root);
    setAttr("#mchap-next", "aria-label", "nav.nextChapter", root);

    setAttr("#music-mini", "aria-label", "music.player", root);
    setAttr("#mm-bubble", "title", "music.openPlayer", root);
    setAttr("#mm-bubble", "aria-label", "music.openPlayer", root);
    setAttr("#mm-pill", "aria-label", "music.controls", root);
    setAttr("#mm-info", "title", "music.collapse", root);
    setAttr("#mm-play", "title", "music.playPause", root);
    setAttr("#mm-play", "aria-label", "music.playPause", root);
    setAttr("#mm-speed", "title", "music.speed", root);
    setAttr("#mm-back", "title", "music.rewind15", root);
    setAttr("#mm-prev", "title", "music.prevTrack", root);
    setAttr("#mm-next", "title", "music.nextTrack", root);
    setAttr("#mm-fwd", "title", "music.forward15", root);
    setAttr("#mm-shuffle", "title", "music.shuffle", root);
    setAttr("#mm-list", "title", "music.playlist", root);
    setAttr("#mm-mini", "title", "music.collapse", root);
    setAttr("#mm-volbtn", "title", "music.mute", root);
    setAttr("#mm-close", "title", "music.closePlayer", root);
    setAttr("#mm-close", "aria-label", "music.closePlayer", root);

    setAttr("#mobile-settings-sheet .mobile-sheet-card", "aria-label", "settings.reader", root);
    setAttr("#mobile-brightness", "aria-label", "mobile.brightness", root);
    setAttr("#mobile-font-size", "aria-label", "typo.fontSize", root);
    setText(".mobile-lineheight-row > span", "typo.lineHeight", root);
    setText(".mobile-fontfamily-row > span", "typo.fontFamily", root);
    setText(".mobile-bg-row > span", "theme.backgroundColor", root);
    setText(".mobile-scroll-row > span", "typo.scroll", root);
    setAttr(".mobile-scroll-row .mobile-switch", "title", "mobile.scrollToggle", root);

    setText(".music-panel-title", "music.panelTitle", root);
    setAttr("#btn-music-close", "title", "common.close", root);
    setText("#btn-add-music", "music.add", root);
    setPlaceholder("#music-youtube-input", "music.youtubePlaceholder", root);
    setAttr("#btn-add-youtube", "title", "music.addYoutube", root);
    setText("#music-now-playing", "music.noTrack", root);
    if (root.querySelector("#mm-title")?.textContent.trim() === "" || root.querySelector("#mm-title")?.textContent.includes("Chưa") || root.querySelector("#mm-title")?.textContent === "No track selected") {
      setText("#mm-title", "music.noTrack", root);
    }
    if (root.querySelector("#mm-artist")?.textContent.includes("Nhạc") || root.querySelector("#mm-artist")?.textContent === "Background music") {
      setText("#mm-artist", "music.background", root);
    }

    setText("#loading-text", "loading.opening", root);
    setAttr("#bi-close", "title", "common.close", root);
    setAttr("#bi-close", "aria-label", "common.close", root);
  }

  function ensureSelect() {
    const select = document.getElementById("rd-language");
    if (!select) return;
    select.innerHTML = LANGUAGES.map((l) => `<option value="${l.code}">${t("language." + l.code)}</option>`).join("");
    select.value = current;
    if (!select.dataset.i18nBound) {
      select.dataset.i18nBound = "1";
      select.addEventListener("change", () => setLang(select.value));
    }
  }

  function apply(root = document) {
    ensureSelect();
    applyStatic(root);
    const select = document.getElementById("rd-language");
    if (select) select.value = current;
  }

  async function setLang(code) {
    if (!LANGUAGES.some((l) => l.code === code)) return current;
    await ready;
    if (code === current) return current;
    current = code;
    saveLang(code);
    apply(document);
    document.dispatchEvent(new CustomEvent("i18n:changed", { detail: { lang: current } }));
    return current;
  }

  function locale() {
    return t("meta.locale");
  }

  function formatDate(value) {
    if (!value) return "";
    try { return new Date(value).toLocaleDateString(locale()); }
    catch { return String(value); }
  }

  const ready = new Promise((resolve) => { readyResolve = resolve; });

  window.I18n = {
    ready,
    t,
    tr: t,
    apply,
    setLang,
    getLang: () => current,
    languages: () => LANGUAGES.slice(),
    locale,
    formatDate,
  };

  (async () => {
    const saved = await getStoredLang();
    current = LANGUAGES.some((l) => l.code === saved) ? saved : DEFAULT_LANG;
    await Promise.all(LANGUAGES.map((l) => loadDict(l.code)));
    apply(document);
    readyResolve();
    document.dispatchEvent(new CustomEvent("i18n:ready", { detail: { lang: current } }));
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) return;
        const next = changes[STORAGE_KEY].newValue;
        if (next && next !== current) {
          current = next;
          apply(document);
          document.dispatchEvent(new CustomEvent("i18n:changed", { detail: { lang: current } }));
        }
      });
    } catch {}
  })();
})();
