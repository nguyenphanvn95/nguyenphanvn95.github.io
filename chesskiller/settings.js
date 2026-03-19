'use strict';

(function initChessSettings(global){
  const STORAGE_KEY = 'chessAnalyzerSettings';
  const DEFAULTS = Object.freeze({
    analysisDepth: 20,
    boardTheme: 'classic',
    pieceStyle: 'classic',
    backgroundStyle: 'obsidian',
    preset: 'tournament',
    moveAnimation: true,
    moveSound: false,
    arrowColor: '#6f8f4b',
  });

  const BOARD_THEMES = Object.freeze({
    classic: {
      light: '#f0d9b5',
      dark: '#b58863',
      highlightLight: 'rgba(205,210,20,.5)',
      highlightDark: 'rgba(205,210,20,.4)',
    },
    forest: {
      light: '#dce7c3',
      dark: '#6f8f4b',
      highlightLight: 'rgba(96,146,60,.34)',
      highlightDark: 'rgba(201,233,121,.28)',
    },
    slate: {
      light: '#d8dee9',
      dark: '#5e81ac',
      highlightLight: 'rgba(136,192,208,.34)',
      highlightDark: 'rgba(229,233,240,.2)',
    },
    sand: {
      light: '#f3e7cf',
      dark: '#c49a6c',
      highlightLight: 'rgba(217,142,58,.34)',
      highlightDark: 'rgba(255,231,184,.22)',
    },
  });

  const BACKGROUND_STYLES = Object.freeze({
    obsidian: {
      appBg: 'radial-gradient(circle at 20% 0%,rgba(125,90,20,.12),transparent 32%), linear-gradient(180deg,#11100d 0%,#070707 100%)',
    },
    walnut: {
      appBg: 'radial-gradient(circle at top left,rgba(184,115,51,.18),transparent 28%), linear-gradient(180deg,#26170f 0%,#120b07 100%)',
    },
    ocean: {
      appBg: 'radial-gradient(circle at 15% 10%,rgba(94,129,172,.22),transparent 30%), linear-gradient(180deg,#0f1a26 0%,#060b12 100%)',
    },
  });

  const PIECE_STYLES = Object.freeze({
    classic: 'none',
    crisp: 'drop-shadow(0 1px 2px rgba(0,0,0,.28)) contrast(1.06) saturate(1.02)',
    warm: 'sepia(.18) saturate(1.08) contrast(1.02) drop-shadow(0 1px 2px rgba(0,0,0,.28))',
    glass: 'brightness(1.04) saturate(.92) drop-shadow(0 2px 5px rgba(0,0,0,.36))',
  });

  const PRESETS = Object.freeze({
    tournament: {
      label: 'Tournament',
      boardTheme: 'classic',
      pieceStyle: 'classic',
      backgroundStyle: 'obsidian',
      arrowColor: '#6f8f4b',
    },
    forest: {
      label: 'Forest',
      boardTheme: 'forest',
      pieceStyle: 'warm',
      backgroundStyle: 'walnut',
      arrowColor: '#5eb054',
    },
    nordic: {
      label: 'Nordic',
      boardTheme: 'slate',
      pieceStyle: 'glass',
      backgroundStyle: 'ocean',
      arrowColor: '#66c7ff',
    },
    desert: {
      label: 'Desert',
      boardTheme: 'sand',
      pieceStyle: 'crisp',
      backgroundStyle: 'walnut',
      arrowColor: '#d97706',
    },
  });

  let currentSettings = { ...DEFAULTS };
  const listeners = new Set();

  function hasChromeStorage(){
    return !!(global.chrome?.storage?.local);
  }

  function normalize(raw){
    const next = { ...DEFAULTS, ...(raw || {}) };
    const depth = Number(next.analysisDepth);
    next.analysisDepth = Number.isFinite(depth) ? Math.max(5, Math.min(25, Math.round(depth))) : DEFAULTS.analysisDepth;
    next.boardTheme = BOARD_THEMES[next.boardTheme] ? next.boardTheme : DEFAULTS.boardTheme;
    next.pieceStyle = PIECE_STYLES[next.pieceStyle] ? next.pieceStyle : DEFAULTS.pieceStyle;
    next.backgroundStyle = BACKGROUND_STYLES[next.backgroundStyle] ? next.backgroundStyle : DEFAULTS.backgroundStyle;
    next.moveAnimation = Boolean(next.moveAnimation);
    next.moveSound = Boolean(next.moveSound);
    next.arrowColor = /^#[\da-f]{6}$/i.test(String(next.arrowColor || '').trim()) ? String(next.arrowColor).trim() : DEFAULTS.arrowColor;
    next.preset = PRESETS[next.preset] ? next.preset : inferPreset(next);
    return next;
  }

  function inferPreset(settings){
    const match = Object.entries(PRESETS).find(([, preset]) =>
      preset.boardTheme === settings.boardTheme &&
      preset.pieceStyle === settings.pieceStyle &&
      preset.backgroundStyle === settings.backgroundStyle &&
      preset.arrowColor.toLowerCase() === String(settings.arrowColor || '').toLowerCase()
    );
    return match ? match[0] : 'custom';
  }

  function emit(){
    listeners.forEach(listener => {
      try{ listener({ ...currentSettings }); }catch(err){ console.error(err); }
    });
  }

  async function load(){
    let saved = null;
    if(hasChromeStorage()){
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      saved = stored?.[STORAGE_KEY] || null;
    }else{
      try{ saved = JSON.parse(global.localStorage?.getItem(STORAGE_KEY) || 'null'); }catch(err){ saved = null; }
    }
    currentSettings = normalize(saved);
    return { ...currentSettings };
  }

  async function save(partial){
    currentSettings = normalize({ ...currentSettings, ...(partial || {}) });
    if(hasChromeStorage()){
      await chrome.storage.local.set({ [STORAGE_KEY]: currentSettings });
    }else{
      global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
    }
    emit();
    return { ...currentSettings };
  }

  function subscribe(listener){
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function applyTheme(doc, settings){
    const root = doc?.documentElement;
    if(!root) return;
    const next = normalize(settings || currentSettings);
    const board = BOARD_THEMES[next.boardTheme];
    const background = BACKGROUND_STYLES[next.backgroundStyle];
    root.style.setProperty('--sq-light', board.light);
    root.style.setProperty('--sq-dark', board.dark);
    root.style.setProperty('--sq-hl-light', board.highlightLight);
    root.style.setProperty('--sq-hl-dark', board.highlightDark);
    root.style.setProperty('--piece-filter', PIECE_STYLES[next.pieceStyle]);
    root.style.setProperty('--arrow-color', next.arrowColor);
    root.style.setProperty('--app-bg', background.appBg);
    root.dataset.boardTheme = next.boardTheme;
    root.dataset.backgroundStyle = next.backgroundStyle;
    root.dataset.pieceStyle = next.pieceStyle;
  }

  if(global.chrome?.storage?.onChanged){
    chrome.storage.onChanged.addListener((changes, areaName)=>{
      if(areaName !== 'local' || !changes[STORAGE_KEY]) return;
      currentSettings = normalize(changes[STORAGE_KEY].newValue);
      emit();
    });
  }

  global.ChessSettings = {
    STORAGE_KEY,
    DEFAULTS,
    BOARD_THEMES,
    BACKGROUND_STYLES,
    PIECE_STYLES,
    PRESETS,
    normalize,
    inferPreset,
    load,
    save,
    subscribe,
    applyTheme,
    getSettings(){
      return { ...currentSettings };
    },
  };
})(window);
