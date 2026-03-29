(function () {
  if (window.__fenScannerLoaded) return;
  window.__fenScannerLoaded = true;

  const PANEL_ID = 'fen-scanner-live-panel';
  const PANEL_HOST_ID = 'fen-scanner-live-panel-host';
  const PANEL_POS_KEY = 'onlookerPanelPosition';
  const PANEL_SESSION_PREFIX = 'onlookerPanelSession:';
  const PANEL_POLL_DELAY = 700;
  const BASE_PANEL_WIDTH = 390;
  const FILES = 8;
  const BOARD_BORDER = 4;
  const BASE_BOARD_SIZE = 168;
  const BASE_BOARD_FRAME_SIZE = BASE_BOARD_SIZE + BOARD_BORDER * 2;
  const BASE_INFO_WIDTH = 178;
  const BASE_MAIN_GAP = 12;
  const BASE_BODY_PADDING_X = 32;
  const MIN_PANEL_SCALE = 0.8;
  const MAX_PANEL_SCALE = 1.6;
  const PANEL_SCALE_STEP = 0.1;
  const SETTINGS_KEY = 'onlookerSettings';
  const START_POSITION_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
  const DEFAULT_SETTINGS = Object.freeze({
    depth: 5,
    arrowColors: ['#4f8cff', '#2ecc71', '#f1c40f', '#e67e22', '#e74c3c'],
    arrowCount: 2,
    showPanel: true,
  });

  let panelEl = null;
  let panelHostEl = null;
  let panelRoot = null;
  let liveRunning = false;
  let inflight = false;
  let pollTimer = null;
  let pollCount = 0;
  let currentFen = '';
  let prevFen = '';
  let moveCount = 0;
  let flipped = false;
  let bestMoveWhite = null;
  let bestMoveBlack = null;
  let bestMoveWhiteLines = [];
  let bestMoveBlackLines = [];
  let dragState = null;
  let resizeState = null;
  let launcherDragState = null;
  let panelScale = 1;
  let analyseJobSeq = 0;
  let lastScreenshotDataUrl = '';
  let lastCroppedDataUrl = '';
  let lastResizedDataUrl = '';
  let lastRawFen = '';
  let lastDetectedTurn = 'w';
  let lastEngineResult = null;
  let lastEngineDebugLines = [];
  let lastFenError = '';
  let lastServerResponse = null;
  let settings = { ...DEFAULT_SETTINGS };
  let showWhiteHints = true;
  let showBlackHints = true;
  let panelMinimized = false;
  let suppressLauncherClick = false;
  const failedDomResourceUrls = new Set();

  const LIGHT_SQ = '#f0d9b5';
  const DARK_SQ = '#b58863';
  const HIGHLIGHT_A = 'rgba(20,85,30,0.55)';
  const HIGHLIGHT_B = 'rgba(20,85,30,0.75)';
  const PIECE_IMAGES = buildPieceImages();
  const PIECE_GLYPHS = Object.freeze({
    K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
    k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'showLivePanel') {
      if (!isPanelFeatureEnabled()) {
        sendResponse?.({ ok: false, error: 'Panel and panel icon are disabled in Settings.' });
        return true;
      }
      showPanel(Boolean(msg.autoStart));
      sendResponse?.({ ok: true });
      return true;
    }

    if (msg.action === 'hideLivePanel') {
      hidePanel();
      sendResponse?.({ ok: true });
      return true;
    }

    if (msg.action === 'getCaptureRegion') {
      sendResponse?.(getCaptureRegion());
      return true;
    }

    if (msg.action === 'captureTabToPanel') {
      if (!isPanelFeatureEnabled()) {
        sendResponse?.({ ok: false, error: 'Panel and panel icon are disabled in Settings.' });
        return true;
      }
      showPanel(false);
      captureSingleFrame()
        .then(() => sendResponse?.({ ok: true }))
        .catch((err) => sendResponse?.({ ok: false, error: err.message }));
      return true;
    }

    if (msg.action === 'analyseImageInPanel') {
      if (!isPanelFeatureEnabled()) {
        sendResponse?.({ ok: false, error: 'Panel and panel icon are disabled in Settings.' });
        return true;
      }
      showPanel(false);
      analyseProvidedImage(msg.dataUrl, msg.sourceLabel || 'image')
        .then(() => sendResponse?.({ ok: true }))
        .catch((err) => sendResponse?.({ ok: false, error: err.message }));
      return true;
    }
  });

  initPanel();
  loadSettings();

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    syncPanelFeatureVisibility();
    redrawCurrentBoard();
    if (currentFen) analysePosition(currentFen);
  });

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  function normalizeColor(value) {
    const color = String(value || '').trim();
    return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_SETTINGS.arrowColors[0];
  }

  function normalizeArrowColors(rawColors, legacyColor) {
    const base = Array.isArray(rawColors) ? rawColors.slice(0, 5) : [];
    while (base.length < 5) {
      base.push(DEFAULT_SETTINGS.arrowColors[base.length]);
    }
    const normalized = base.map(normalizeColor);
    if (!Array.isArray(rawColors) && legacyColor) {
      normalized[0] = normalizeColor(legacyColor);
    }
    return normalized;
  }

  function normalizeSettings(raw) {
    return {
      depth: clampNumber(raw?.depth, 5, 25, DEFAULT_SETTINGS.depth),
      arrowColors: normalizeArrowColors(raw?.arrowColors, raw?.arrowColor),
      arrowCount: clampNumber(raw?.arrowCount, 1, 5, DEFAULT_SETTINGS.arrowCount),
      showPanel: raw?.showPanel !== false,
    };
  }

  function isPanelFeatureEnabled() {
    return settings.showPanel !== false;
  }

  function loadSettings() {
    if (!chrome.storage?.local) return;
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      settings = normalizeSettings(result?.[SETTINGS_KEY]);
      syncPanelFeatureVisibility();
      redrawCurrentBoard();
    });
  }

  function syncPanelFeatureVisibility() {
    if (!panelEl) return;
    if (isPanelFeatureEnabled()) {
      panelEl.style.display = 'block';
      if (isCompactMobilePanel()) {
        panelEl.querySelector('[data-role="result"]').style.display = 'flex';
        setPanelMinimized(true);
      } else {
        setPanelMinimized(false);
      }
      syncPanelLayoutMode();
      syncLauncherState();
      return;
    }

    liveRunning = false;
    inflight = false;
    clearTimeout(pollTimer);
    pollTimer = null;
    panelMinimized = false;
    panelEl.classList.remove('is-minimized');
    panelEl.style.display = 'none';
    syncLauncherState();
  }

  function redrawCurrentBoard() {
    if (!panelEl || !currentFen) return;
    const lastMove = panelEl.querySelector('[data-role="last-move"]')?.textContent || '';
    const highlight = lastMove ? parseLastMoveSquares(lastMove) : null;
    drawBoard(currentFen, flipped, highlight);
  }

  function assetUrl(path) {
    return chrome.runtime.getURL(path);
  }

  function buildPieceImages() {
    return {
      K: assetUrl('icons/pieces/wK.svg'),
      Q: assetUrl('icons/pieces/wQ.svg'),
      R: assetUrl('icons/pieces/wR.svg'),
      B: assetUrl('icons/pieces/wB.svg'),
      N: assetUrl('icons/pieces/wN.svg'),
      P: assetUrl('icons/pieces/wP.svg'),
      k: assetUrl('icons/pieces/bK.svg'),
      q: assetUrl('icons/pieces/bQ.svg'),
      r: assetUrl('icons/pieces/bR.svg'),
      b: assetUrl('icons/pieces/bB.svg'),
      n: assetUrl('icons/pieces/bN.svg'),
      p: assetUrl('icons/pieces/bP.svg'),
    };
  }

  function initPanel() {
    if (panelEl) return;

    panelHostEl = document.createElement('div');
    panelHostEl.id = PANEL_HOST_ID;
    panelRoot = panelHostEl.attachShadow({ mode: 'open' });

    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.innerHTML = `
      <div class="fen-live-shell">
        <div class="fen-live-header">
          <div class="fen-live-brand">
            <img class="fen-live-brand-icon" src="${chrome.runtime.getURL('icons/icon-app.png')}" alt="OnLooker" />
            <div class="fen-live-title">OnLooker</div>
          </div>
          <button class="fen-live-close" type="button" title="Close">x</button>
        </div>
        <div class="fen-live-body">
          <div class="fen-live-actions">
            <button class="fen-live-btn fen-live-btn-primary" data-role="start">Start live</button>
            <button class="fen-live-btn fen-live-btn-danger" data-role="stop" style="display:none;">Stop</button>
            <button class="fen-live-btn fen-live-btn-ghost" data-role="minimize">Minimize</button>
          </div>
          <div class="fen-live-status">
            <span class="fen-live-status-dot" data-role="status-dot"></span>
            <span class="fen-live-status-text" data-role="status-text">Panel ready</span>
            <span class="fen-live-status-count" data-role="poll-count"></span>
          </div>
          <div class="fen-live-result" data-role="result" style="display:none;">
            <div class="fen-live-main">
              <div class="fen-live-board-wrap">
                <canvas data-role="board-grid" width="176" height="176"></canvas>
                <div class="fen-live-highlight-layer" data-role="board-highlight"></div>
                <canvas data-role="board-arrow" width="176" height="176"></canvas>
                <div class="fen-live-pieces-layer" data-role="board-pieces"></div>
                <div class="fen-live-resize-handle" data-role="resize-handle" title="Resize board"></div>
              </div>
              <div class="fen-live-info">
                <div class="fen-live-labels">
                  <span class="fen-live-badge">FEN</span>
                  <span class="fen-live-turn" data-role="turn"></span>
                </div>
                <div class="fen-live-fenbox">
                  <span class="fen-live-fen" data-role="fen"></span>
                  <button type="button" class="fen-live-mobile-state" data-role="mobile-live-toggle">Live</button>
                  <button type="button" class="fen-live-mobile-minimize" data-role="mobile-minimize" title="Minimize">_</button>
                </div>
                <div class="fen-live-lastmove" data-role="last-move-wrap" style="display:none;">
                  <span>Last</span>
                  <strong data-role="last-move"></strong>
                  <span data-role="move-count"></span>
                </div>
              <div class="fen-live-links">
                <button type="button" data-role="flip">Flip</button>
                <button type="button" data-role="toggle-white" class="is-active">White</button>
                <button type="button" data-role="toggle-black" class="is-active">Black</button>
                <button type="button" data-role="logs">Logs</button>
              </div>
              </div>
            </div>
            <div class="fen-live-engine">
              <div class="fen-live-engine-status">
                <span class="fen-live-status-dot" data-role="eng-dot"></span>
                <span data-role="eng-status">Komodo offline idle</span>
              </div>
              <div class="fen-live-engine-line" data-role="hint-white" style="display:none;">
                White: <strong data-role="hint-white-move"></strong> <span data-role="hint-white-score"></span>
              </div>
              <div class="fen-live-engine-line" data-role="hint-black" style="display:none;">
                Black: <strong data-role="hint-black-move"></strong> <span data-role="hint-black-score"></span>
              </div>
            </div>
          </div>
          <div class="fen-live-logs" data-role="logs-panel" style="display:none;">
            <div class="fen-live-logs-head">
              <strong>Logs</strong>
              <button type="button" class="fen-live-log-close" data-role="logs-close">Close</button>
            </div>
            <div class="fen-live-logs-grid">
              <div class="fen-live-log-block">
                <div class="fen-live-log-label">Last screenshot</div>
                <img data-role="log-shot" alt="Last screenshot preview" />
              </div>
              <div class="fen-live-log-block">
                <div class="fen-live-log-label">Cropped board</div>
                <img data-role="log-crop" alt="Last crop preview" />
              </div>
            </div>
            <pre class="fen-live-log-text" data-role="log-text"></pre>
          </div>
        </div>
      </div>
      <button class="fen-live-launcher" type="button" data-role="launcher" title="Open OnLooker">
        <img class="fen-live-launcher-icon" src="${chrome.runtime.getURL('icons/icon-app.png')}" alt="OnLooker" />
        <span class="fen-live-launcher-dot" data-role="launcher-dot"></span>
      </button>
    `;

    panelRoot.appendChild(panelEl);
    (document.body || document.documentElement).appendChild(panelHostEl);
    panelEl.style.display = 'none';
    applyPanelScale(panelScale);
    restorePanelPosition();
    restorePanelSession();

    panelEl.querySelector('.fen-live-header')?.addEventListener('pointerdown', startPanelDrag);
    panelEl.querySelector('[data-role="resize-handle"]')?.addEventListener('pointerdown', startPanelResize);
    panelEl.querySelector('[data-role="start"]')?.addEventListener('click', () => startLive());
    panelEl.querySelector('[data-role="stop"]')?.addEventListener('click', () => stopLive());
    panelEl.querySelector('[data-role="minimize"]')?.addEventListener('click', () => minimizePanel());
    panelEl.querySelector('[data-role="mobile-live-toggle"]')?.addEventListener('click', () => {
      if (liveRunning) stopLive();
      else startLive();
    });
    panelEl.querySelector('[data-role="mobile-minimize"]')?.addEventListener('click', () => minimizePanel());
    panelEl.querySelector('[data-role="launcher"]')?.addEventListener('pointerdown', startLauncherDrag);
    panelEl.querySelector('[data-role="launcher"]')?.addEventListener('click', (event) => {
      if (suppressLauncherClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressLauncherClick = false;
        return;
      }
      restorePanel();
    });
    panelEl.querySelector('.fen-live-board-wrap')?.addEventListener('pointerdown', startPanelDrag);
    panelEl.querySelector('[data-role="flip"]')?.addEventListener('click', () => flipBoard());
    panelEl.querySelector('[data-role="toggle-white"]')?.addEventListener('click', () => {
      showWhiteHints = !showWhiteHints;
      syncHintToggleButtons();
      redrawCurrentBoard();
    });
    panelEl.querySelector('[data-role="toggle-black"]')?.addEventListener('click', () => {
      showBlackHints = !showBlackHints;
      syncHintToggleButtons();
      redrawCurrentBoard();
    });
    panelEl.querySelector('[data-role="logs"]')?.addEventListener('click', () => toggleLogsPanel(true));
    panelEl.querySelector('[data-role="logs-close"]')?.addEventListener('click', () => toggleLogsPanel(false));
    panelEl.querySelector('.fen-live-close')?.addEventListener('click', () => {
      stopLive();
      hidePanel();
    });
    setEngineStatus('', 'Komodo offline idle');
    syncHintToggleButtons();
    syncMobileLiveToggle();
    syncPanelLayoutMode();
    renderDefaultPanelState();
    window.addEventListener('resize', handlePanelViewportChange, { passive: true });

  }

  function syncHintToggleButtons() {
    const whiteBtn = panelEl?.querySelector('[data-role="toggle-white"]');
    const blackBtn = panelEl?.querySelector('[data-role="toggle-black"]');
    whiteBtn?.classList.toggle('is-active', showWhiteHints);
    blackBtn?.classList.toggle('is-active', showBlackHints);
    const whiteWrap = panelEl?.querySelector('[data-role="hint-white"]');
    const blackWrap = panelEl?.querySelector('[data-role="hint-black"]');
    if (whiteWrap) whiteWrap.style.opacity = showWhiteHints ? '1' : '0.45';
    if (blackWrap) blackWrap.style.opacity = showBlackHints ? '1' : '0.45';
  }

  function showPanel(autoStart) {
    initPanel();
    if (!isPanelFeatureEnabled()) return;
    syncPanelLayoutMode();
    if (!currentFen) renderDefaultPanelState();
    if (isCompactMobilePanel()) {
      panelEl.querySelector('[data-role="result"]').style.display = 'flex';
    }
    restorePanelPosition();
    panelEl.style.display = 'block';
    setPanelMinimized(false);
    savePanelSession();
    if (autoStart) startLive();
  }

  function hidePanel() {
    if (!panelEl) return;
    setPanelMinimized(false);
    panelEl.style.display = 'none';
    savePanelSession();
  }

  function minimizePanel() {
    if (!panelEl || !isPanelFeatureEnabled()) return;
    panelEl.style.display = 'block';
    setPanelMinimized(true);
    savePanelSession();
  }

  function restorePanel() {
    if (!panelEl) initPanel();
    if (!isPanelFeatureEnabled()) return;
    panelEl.style.display = 'block';
    setPanelMinimized(false);
    if (!currentFen) renderDefaultPanelState();
    if (isCompactMobilePanel()) {
      panelEl.querySelector('[data-role="result"]').style.display = 'flex';
    }
    syncPanelLayoutMode();
    savePanelSession();
  }

  function getPanelSessionKey() {
    if (!window.location?.href) return null;

    try {
      const url = new URL(window.location.href);
      return `${PANEL_SESSION_PREFIX}${url.origin}${url.pathname}`;
    } catch (_) {
      return null;
    }
  }

  function restorePanelSession() {
    if (!chrome.storage?.local) return;
    const key = getPanelSessionKey();
    if (!key) return;

    chrome.storage.local.get([key, SETTINGS_KEY], (result) => {
      const storedSettings = normalizeSettings(result?.[SETTINGS_KEY]);
      if (storedSettings.showPanel === false) return;
      const state = result?.[key];
      if (state?.visible) {
        showPanel(Boolean(state.liveRunning));
        setPanelMinimized(Boolean(state.minimized));
        return;
      }
      if (isCompactMobilePanel()) {
        panelEl.style.display = 'block';
        setPanelMinimized(true);
      }
    });
  }

  function savePanelSession() {
    if (!panelEl || !chrome.storage?.local) return;
    const key = getPanelSessionKey();
    if (!key) return;

    chrome.storage.local.set({
      [key]: {
        visible: panelEl.style.display !== 'none',
        liveRunning: Boolean(liveRunning),
        minimized: Boolean(panelMinimized),
      }
    });
  }

  function getCaptureRegion() {
    if (!panelEl || panelEl.style.display === 'none') {
      return { mode: 'full' };
    }

    const boardRegion = detectBoardRegion();
    if (boardRegion) {
      return boardRegion;
    }

    const rect = panelEl.getBoundingClientRect();
    const candidates = [
      {
        x: 0,
        y: 0,
        width: Math.floor(rect.left),
        height: window.innerHeight,
      },
      {
        x: Math.ceil(rect.right),
        y: 0,
        width: Math.floor(window.innerWidth - rect.right),
        height: window.innerHeight,
      },
      {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: Math.floor(rect.top),
      },
      {
        x: 0,
        y: Math.ceil(rect.bottom),
        width: window.innerWidth,
        height: Math.floor(window.innerHeight - rect.bottom),
      },
    ].filter((candidate) => candidate.width >= 40 && candidate.height >= 40);

    if (!candidates.length) {
      return { mode: 'full' };
    }

    const best = candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];

    return {
      mode: 'crop',
      x: best.x,
      y: best.y,
      width: best.width,
      height: best.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  function detectBoardRegion() {
    const selectors = [
      '.cg-wrap',
      'cg-board',
      'wc-chess-board',
      '[data-cy="board-layout-chessboard"]',
      '[data-cy="game-board"]',
      '.board',
      '.main-board',
      '.chessboard',
      '[class*="board"]',
    ];

    const candidates = [];
    const panelRect = panelEl?.getBoundingClientRect?.() || null;
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (panelEl?.contains(el)) return;
        const rect = el.getBoundingClientRect();
        if (!isLikelyBoardRect(rect)) return;
        if (panelRect && rectsOverlap(rect, panelRect, 24)) return;
        candidates.push(rect);
      });
    });

    if (!candidates.length) return null;

    const rect = candidates.sort((a, b) => scoreBoardRect(b) - scoreBoardRect(a))[0];
    const margin = Math.max(8, Math.round(Math.min(rect.width, rect.height) * 0.04));
    const x = clamp(Math.floor(rect.left - margin), 0, window.innerWidth);
    const y = clamp(Math.floor(rect.top - margin), 0, window.innerHeight);
    const right = clamp(Math.ceil(rect.right + margin), 0, window.innerWidth);
    const bottom = clamp(Math.ceil(rect.bottom + margin), 0, window.innerHeight);
    const width = right - x;
    const height = bottom - y;

    if (width < 40 || height < 40) return null;

    return {
      mode: 'crop',
      x,
      y,
      width,
      height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  function isLikelyBoardRect(rect) {
    if (!rect || rect.width < 220 || rect.height < 220) return false;
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
    const ratio = rect.width / rect.height;
    return ratio > 0.85 && ratio < 1.15;
  }

  function rectsOverlap(a, b, padding = 0) {
    if (!a || !b) return false;
    return !(
      a.right <= b.left - padding ||
      a.left >= b.right + padding ||
      a.bottom <= b.top - padding ||
      a.top >= b.bottom + padding
    );
  }

  function scoreBoardRect(rect) {
    if (!rect) return -Infinity;
    const area = rect.width * rect.height;
    const ratioPenalty = Math.abs(1 - (rect.width / rect.height)) * 100000;
    const edgePenalty = rect.left < 12 || rect.top < 12 ? 25000 : 0;
    return area - ratioPenalty - edgePenalty;
  }

  function startPanelDrag(event) {
    if (!panelEl || event.button !== 0) return;
    if (event.target.closest('.fen-live-close')) return;
    if (event.target.closest('[data-role="resize-handle"]')) return;
    if (event.target.closest('button, a, input, textarea, select, label')) return;

    const rect = panelEl.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      mobile: isCompactMobilePanel(),
    };

    panelEl.style.left = `${Math.round(rect.left)}px`;
    panelEl.style.top = `${Math.round(rect.top)}px`;
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
    if (dragState.mobile) panelEl.dataset.mobileDragged = '1';

    window.addEventListener('pointermove', onPanelDrag);
    window.addEventListener('pointerup', stopPanelDrag);
    window.addEventListener('pointercancel', stopPanelDrag);
    event.preventDefault();
  }

  function onPanelDrag(event) {
    if (!dragState || !panelEl) return;
    if (event.pointerId !== dragState.pointerId) return;

    const maxLeft = Math.max(0, window.innerWidth - panelEl.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panelEl.offsetHeight);
    const left = clamp(event.clientX - dragState.offsetX, 0, maxLeft);
    const top = clamp(event.clientY - dragState.offsetY, 0, maxTop);

    panelEl.style.left = `${Math.round(left)}px`;
    panelEl.style.top = `${Math.round(top)}px`;
  }

  function stopPanelDrag(event) {
    if (dragState && event && event.pointerId !== dragState.pointerId) return;
    if (panelEl) savePanelPosition();
    dragState = null;
    window.removeEventListener('pointermove', onPanelDrag);
    window.removeEventListener('pointerup', stopPanelDrag);
    window.removeEventListener('pointercancel', stopPanelDrag);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function startLauncherDrag(event) {
    const launcher = panelEl?.querySelector('[data-role="launcher"]');
    if (!launcher || event.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    launcherDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    launcher.style.left = `${Math.round(rect.left)}px`;
    launcher.style.top = `${Math.round(rect.top)}px`;
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
    window.addEventListener('pointermove', onLauncherDrag);
    window.addEventListener('pointerup', stopLauncherDrag);
    window.addEventListener('pointercancel', stopLauncherDrag);
    event.preventDefault();
  }

  function onLauncherDrag(event) {
    const launcher = panelEl?.querySelector('[data-role="launcher"]');
    if (!launcherDragState || !launcher) return;
    if (event.pointerId !== launcherDragState.pointerId) return;

    const maxLeft = Math.max(0, window.innerWidth - launcher.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - launcher.offsetHeight);
    const left = clamp(event.clientX - launcherDragState.offsetX, 0, maxLeft);
    const top = clamp(event.clientY - launcherDragState.offsetY, 0, maxTop);
    launcher.style.left = `${Math.round(left)}px`;
    launcher.style.top = `${Math.round(top)}px`;
    launcherDragState.moved = true;
  }

  function stopLauncherDrag(event) {
    if (launcherDragState && event && event.pointerId !== launcherDragState.pointerId) return;
    if (launcherDragState?.moved) {
      suppressLauncherClick = true;
      setTimeout(() => { suppressLauncherClick = false; }, 50);
      savePanelPosition();
    }
    launcherDragState = null;
    window.removeEventListener('pointermove', onLauncherDrag);
    window.removeEventListener('pointerup', stopLauncherDrag);
    window.removeEventListener('pointercancel', stopLauncherDrag);
  }

  function startPanelResize(event) {
    if (!panelEl || event.button !== 0) return;
    if (isCompactMobilePanel()) return;
    const boardRect = panelEl.querySelector('[data-role="board-grid"]')?.getBoundingClientRect();
    resizeState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScale: panelScale,
      startBoardSize: boardRect?.width || (BASE_BOARD_FRAME_SIZE * panelScale),
    };

    window.addEventListener('pointermove', onPanelResize);
    window.addEventListener('pointerup', stopPanelResize);
    window.addEventListener('pointercancel', stopPanelResize);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPanelResize(event) {
    if (!resizeState || !panelEl) return;
    if (event.pointerId !== resizeState.pointerId) return;

    const deltaX = event.clientX - resizeState.startX;
    const nextBoardSize = resizeState.startBoardSize + deltaX;
    const nextScale = clamp(roundScale(nextBoardSize / BASE_BOARD_FRAME_SIZE), MIN_PANEL_SCALE, MAX_PANEL_SCALE);
    if (nextScale === panelScale) return;

    panelScale = nextScale;
    applyPanelScale(panelScale);
    keepPanelInViewport();

    if (currentFen) {
      const highlight = panelEl.querySelector('[data-role="last-move"]').textContent
        ? parseLastMoveSquares(panelEl.querySelector('[data-role="last-move"]').textContent)
        : null;
      drawBoard(currentFen, flipped, highlight);
    }
  }

  function stopPanelResize(event) {
    if (resizeState && event && event.pointerId !== resizeState.pointerId) return;
    resizeState = null;
    if (panelEl) savePanelPosition();
    window.removeEventListener('pointermove', onPanelResize);
    window.removeEventListener('pointerup', stopPanelResize);
    window.removeEventListener('pointercancel', stopPanelResize);
  }

  function applyPanelScale(scale) {
    if (!panelEl) return;
    const compactMobile = isCompactMobilePanel();
    panelScale = compactMobile ? 1 : clamp(roundScale(scale), MIN_PANEL_SCALE, MAX_PANEL_SCALE);
    const infoWidth = compactMobile
      ? clamp(Math.round(window.innerWidth * 0.42), 150, 176)
      : BASE_INFO_WIDTH;
    const boardWidth = compactMobile
      ? clamp(window.innerWidth - infoWidth - 44, 128, 176)
      : Math.round(BASE_BOARD_FRAME_SIZE * panelScale);
    const gapWidth = compactMobile ? 10 : BASE_MAIN_GAP;
    const bodyPaddingX = compactMobile ? 24 : BASE_BODY_PADDING_X;
    const panelWidth = boardWidth + infoWidth + gapWidth + bodyPaddingX;
    panelEl.style.width = compactMobile
      ? `${Math.min(panelWidth, Math.max(260, window.innerWidth - 12))}px`
      : `${panelWidth}px`;
    panelEl.style.setProperty('--panel-scale', String(panelScale));
    panelEl.style.setProperty('--info-width', `${infoWidth}px`);
    const boardWrap = panelEl.querySelector('.fen-live-board-wrap');
    if (boardWrap) {
      boardWrap.style.width = `${boardWidth}px`;
      boardWrap.style.height = `${boardWidth}px`;
    }
    syncPanelLayoutMode();
  }

  function roundScale(value) {
    return Math.round(value * 100) / 100;
  }

  function keepPanelInViewport() {
    if (!panelEl) return;
    if (isCompactMobilePanel()) {
      const rect = panelEl.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - panelEl.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panelEl.offsetHeight);
      const left = clamp(rect.left, 0, maxLeft);
      const top = clamp(rect.top, 0, maxTop);
      if (panelEl.dataset.mobileDragged === '1') {
        panelEl.style.left = `${Math.round(left)}px`;
        panelEl.style.top = `${Math.round(top)}px`;
        panelEl.style.right = 'auto';
        panelEl.style.bottom = 'auto';
      } else {
        syncPanelLayoutMode();
      }
      return;
    }
    const rect = panelEl.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - panelEl.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panelEl.offsetHeight);
    const left = clamp(rect.left, 0, maxLeft);
    const top = clamp(rect.top, 0, maxTop);
    panelEl.style.left = `${Math.round(left)}px`;
    panelEl.style.top = `${Math.round(top)}px`;
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
  }

  function restorePanelPosition() {
    if (!panelEl || !chrome.storage?.local) return;
    chrome.storage.local.get(PANEL_POS_KEY, (result) => {
      const pos = result?.[PANEL_POS_KEY];
      applyPanelScale(typeof pos?.scale === 'number' ? pos.scale : panelScale);

      if (isCompactMobilePanel()) {
        const launcher = panelEl.querySelector('[data-role="launcher"]');
        if (typeof pos?.mobileLauncherLeft === 'number' && typeof pos?.mobileLauncherTop === 'number' && launcher) {
          const maxLeft = Math.max(0, window.innerWidth - launcher.offsetWidth);
          const maxTop = Math.max(0, window.innerHeight - launcher.offsetHeight);
          launcher.style.left = `${Math.round(clamp(pos.mobileLauncherLeft, 0, maxLeft))}px`;
          launcher.style.top = `${Math.round(clamp(pos.mobileLauncherTop, 0, maxTop))}px`;
          launcher.style.right = 'auto';
          launcher.style.bottom = 'auto';
        } else if (launcher) {
          launcher.style.left = '';
          launcher.style.top = '';
          launcher.style.right = '';
          launcher.style.bottom = '';
        }

        if (typeof pos?.mobileLeft === 'number' && typeof pos?.mobileTop === 'number') {
          const maxLeft = Math.max(0, window.innerWidth - panelEl.offsetWidth);
          const maxTop = Math.max(0, window.innerHeight - panelEl.offsetHeight);
          panelEl.style.left = `${Math.round(clamp(pos.mobileLeft, 0, maxLeft))}px`;
          panelEl.style.top = `${Math.round(clamp(pos.mobileTop, 0, maxTop))}px`;
          panelEl.style.right = 'auto';
          panelEl.style.bottom = 'auto';
          panelEl.dataset.mobileDragged = '1';
        } else {
          delete panelEl.dataset.mobileDragged;
          syncPanelLayoutMode();
        }
        return;
      }

      if (typeof pos?.left !== 'number' || typeof pos?.top !== 'number') return;

      const maxLeft = Math.max(0, window.innerWidth - panelEl.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panelEl.offsetHeight);
      const left = clamp(pos.left, 0, maxLeft);
      const top = clamp(pos.top, 0, maxTop);

      panelEl.style.left = `${Math.round(left)}px`;
      panelEl.style.top = `${Math.round(top)}px`;
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
    });
  }

  function savePanelPosition() {
    if (!panelEl || !chrome.storage?.local) return;
    const rect = panelEl.getBoundingClientRect();
    const launcher = panelEl.querySelector('[data-role="launcher"]');
    const launcherRect = launcher?.getBoundingClientRect?.();
    const payload = {
      scale: panelScale,
    };

    if (isCompactMobilePanel()) {
      if (panelEl.dataset.mobileDragged === '1') {
        payload.mobileLeft = Math.round(rect.left);
        payload.mobileTop = Math.round(rect.top);
      }
      if (launcherRect) {
        payload.mobileLauncherLeft = Math.round(launcherRect.left);
        payload.mobileLauncherTop = Math.round(launcherRect.top);
      }
    } else {
      payload.left = Math.round(rect.left);
      payload.top = Math.round(rect.top);
    }

    chrome.storage.local.set({
      [PANEL_POS_KEY]: payload
    });
  }

  async function startLive() {
    if (liveRunning) return;

    panelEl.style.display = 'block';
    liveRunning = true;
    pollCount = 0;
    inflight = false;
    panelEl.querySelector('[data-role="start"]').style.display = 'none';
    panelEl.querySelector('[data-role="stop"]').style.display = 'inline-flex';
    panelEl.querySelector('[data-role="poll-count"]').textContent = '';
    syncMobileLiveToggle();
    setLiveStatus('scanning', 'Capturing...');
    savePanelSession();
    schedulePoll(0);
  }

  async function captureSingleFrame() {
    if (!panelEl) initPanel();
    panelEl.style.display = 'block';
    liveRunning = false;
    inflight = false;
    clearTimeout(pollTimer);
    pollTimer = null;
    pollCount = 0;
    panelEl.querySelector('[data-role="start"]').style.display = 'inline-flex';
    panelEl.querySelector('[data-role="stop"]').style.display = 'none';
    panelEl.querySelector('[data-role="poll-count"]').textContent = '';
    syncMobileLiveToggle();
    savePanelSession();
    await scanCurrentPosition({ incrementPoll: false });
  }

  async function analyseProvidedImage(dataUrl, sourceLabel = 'image') {
    if (!dataUrl) throw new Error('No image data provided.');
    if (!panelEl) initPanel();
    panelEl.style.display = 'block';
    liveRunning = false;
    inflight = false;
    clearTimeout(pollTimer);
    pollTimer = null;
    pollCount = 0;
    moveCount = 0;
    panelEl.querySelector('[data-role="start"]').style.display = 'inline-flex';
    panelEl.querySelector('[data-role="stop"]').style.display = 'none';
    panelEl.querySelector('[data-role="poll-count"]').textContent = '';
    syncMobileLiveToggle();
    savePanelSession();

    inflight = true;
    setLiveStatus('scanning', `Analysing ${sourceLabel}...`);

    try {
      lastScreenshotDataUrl = dataUrl;
      lastCroppedDataUrl = dataUrl;
      const resized = await resizeImage(dataUrl, 1800, 1800);
      lastResizedDataUrl = resized || '';
      const result = await sendRuntime({
        action: 'callChessvision',
        payload: {
          image: resized,
          cropped: false,
          current_player: 'white',
          board_orientation: 'predict',
          predict_turn: true,
        },
      });

      lastServerResponse = result;
      lastFenError = '';

      if (!result.success) {
        currentFen = '';
        lastRawFen = '';
        lastEngineResult = null;
        lastEngineDebugLines = [];
        lastFenError = result.error || 'API error';
        updateLogsPanel();
        toggleLogsPanel(true);
        throw new Error(lastFenError);
      }

      const data = result.data;
      if (!data.success) {
        currentFen = '';
        lastRawFen = '';
        lastEngineResult = null;
        lastEngineDebugLines = [];
        lastFenError = data.forbidden?.reason || data.error || data.message || 'FEN detection failed';
        updateLogsPanel();
        toggleLogsPanel(true);
        throw new Error(lastFenError);
      }

      const turn = normalizeTurnValue(data.turn);
      lastDetectedTurn = turn;
      lastRawFen = String(data.result || '');
      const newFen = normalizeFen(data.result, turn);
      prevFen = currentFen;
      currentFen = newFen;
      updateLogsPanel();
      updateResult(newFen, turn, null);
      analysePosition(newFen);
      setLiveStatus('ok', 'Updated');
    } catch (err) {
      if (!lastFenError) {
        lastFenError = String(err?.message || err || 'Unknown error');
        updateLogsPanel();
        toggleLogsPanel(true);
      }
      setLiveStatus('err', err.message);
      throw err;
    } finally {
      inflight = false;
    }
  }

  function stopLive() {
    liveRunning = false;
    inflight = false;
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!panelEl) return;
    panelEl.querySelector('[data-role="start"]').style.display = 'inline-flex';
    panelEl.querySelector('[data-role="stop"]').style.display = 'none';
    syncMobileLiveToggle();
    setLiveStatus('idle', 'Stopped');
    savePanelSession();
  }

  function schedulePoll(delay = PANEL_POLL_DELAY) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(doPoll, delay);
  }

  async function doPoll() {
    if (!liveRunning || inflight) return;
    try {
      await scanCurrentPosition({ incrementPoll: true });
    } catch (_) {}
    if (liveRunning) schedulePoll(PANEL_POLL_DELAY);
  }

  async function scanCurrentPosition({ incrementPoll }) {
    if (inflight) return;
    inflight = true;
    setLiveStatus('scanning', shouldUseDomSnapshot() ? 'Building DOM snapshot...' : 'Capturing screenshot...');

    try {
      const shotResp = await captureCurrentFrame();
      if (!shotResp.success) throw new Error(shotResp.error || 'Capture failed');
      lastScreenshotDataUrl = shotResp.screenshot || '';

      const cropped = await cropImage(shotResp.screenshot, shotResp.crop || { mode: 'full' });
      lastCroppedDataUrl = cropped || '';
      const resized = await resizeImage(cropped, 1800, 1800);
      lastResizedDataUrl = resized || '';
      const result = await sendRuntime({
        action: 'callChessvision',
        payload: {
          image: resized,
          cropped: false,
          current_player: 'white',
          board_orientation: 'predict',
          predict_turn: true,
        },
      });
      lastServerResponse = result;
      lastFenError = '';

      if (incrementPoll) {
        pollCount += 1;
        panelEl.querySelector('[data-role="poll-count"]').textContent = `#${pollCount}`;
      }

      if (!result.success) {
        currentFen = '';
        lastRawFen = '';
        lastEngineResult = null;
        lastEngineDebugLines = [];
        lastFenError = result.error || 'API error';
        updateLogsPanel();
        toggleLogsPanel(true);
        throw new Error(lastFenError);
      }
      const data = result.data;
      if (!data.success) {
        currentFen = '';
        lastRawFen = '';
        lastEngineResult = null;
        lastEngineDebugLines = [];
        lastFenError = data.forbidden?.reason || data.error || data.message || 'FEN detection failed';
        updateLogsPanel();
        toggleLogsPanel(true);
        throw new Error(lastFenError);
      }

      const turn = normalizeTurnValue(data.turn);
      lastDetectedTurn = turn;
      lastRawFen = String(data.result || '');
      const newFen = normalizeFen(data.result, turn);
      updateLogsPanel();

      if (newFen !== currentFen) {
        const lastMove = currentFen ? diffFen(currentFen, newFen) : null;
        prevFen = currentFen;
        currentFen = newFen;
        if (lastMove) moveCount += 1;
        updateResult(newFen, turn, lastMove);
        analysePosition(newFen);
        setLiveStatus('ok', lastMove ? `Move: ${lastMove}` : 'Updated');
      } else {
        setLiveStatus('ok', 'No change');
      }
    } catch (err) {
      if (!lastFenError) {
        lastFenError = String(err?.message || err || 'Unknown error');
        updateLogsPanel();
        toggleLogsPanel(true);
      }
      setLiveStatus('err', err.message);
    } finally {
      inflight = false;
    }
  }

  async function captureCurrentFrame() {
    if (shouldUseDomSnapshot()) {
      const domShot = await buildDomSnapshot();
      if (domShot?.success) return domShot;
    }
    return sendRuntime({ action: 'captureScreenshot' });
  }

  function shouldUseDomSnapshot() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
    const noHover = window.matchMedia?.('(hover: none)')?.matches;
    const narrowViewport = Math.min(window.innerWidth, window.innerHeight) <= 540;
    return Boolean((coarsePointer && noHover) || narrowViewport);
  }

  async function buildDomSnapshot() {
    const viewportWidth = Math.max(1, Math.floor(window.innerWidth));
    const viewportHeight = Math.max(1, Math.floor(window.innerHeight));
    const boardVisual = await buildBoardVisualFromDom();

    const domShot = await buildDomToImageSnapshot(viewportWidth, viewportHeight, boardVisual);
    if (domShot?.success) return domShot;

    const canvas = document.createElement('canvas');
    canvas.width = viewportWidth;
    canvas.height = viewportHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const bg = pickViewportBackground();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    await renderViewportDomSnapshot(ctx, { width: viewportWidth, height: viewportHeight });

    if (boardVisual && shouldOverlayBoardVisual(boardVisual)) {
      ctx.drawImage(boardVisual.canvas, boardVisual.rect.x, boardVisual.rect.y, boardVisual.rect.width, boardVisual.rect.height);
    }

    return {
      success: true,
      screenshot: canvas.toDataURL('image/jpeg', 0.9),
      crop: boardVisual ? {
        mode: 'crop',
        x: boardVisual.rect.x,
        y: boardVisual.rect.y,
        width: boardVisual.rect.width,
        height: boardVisual.rect.height,
        viewportWidth,
        viewportHeight,
      } : { mode: 'full' },
    };
  }

  async function buildDomToImageSnapshot(viewportWidth, viewportHeight, boardVisual) {
    if (!window.domtoimage?.toPng) return null;
    try {
      primeDomToImageForSnapshot();
      const dpr = window.devicePixelRatio || 1;
      const sx = window.scrollX || window.pageXOffset || 0;
      const sy = window.scrollY || window.pageYOffset || 0;
      const panelNode = panelHostEl || panelEl || null;
      const rootNode = document.body || document.documentElement;

      const dataUrl = await window.domtoimage.toPng(rootNode, {
        width: Math.floor(viewportWidth * dpr),
        height: Math.floor(viewportHeight * dpr),
        style: {
          transform: `scale(${dpr}) translate(${-sx}px, ${-sy}px)`,
          transformOrigin: 'top left',
          width: `${viewportWidth}px`,
          height: `${viewportHeight}px`,
        },
        filter: (node) => node !== panelNode && !panelNode?.contains?.(node),
      });

      const finalShot = shouldOverlayBoardVisual(boardVisual)
        ? await overlayBoardVisualOnSnapshot(dataUrl, boardVisual, viewportWidth, viewportHeight)
        : dataUrl;
      return {
        success: true,
        screenshot: finalShot,
        crop: boardVisual ? {
          mode: 'crop',
          x: boardVisual.rect.x,
          y: boardVisual.rect.y,
          width: boardVisual.rect.width,
          height: boardVisual.rect.height,
          viewportWidth,
          viewportHeight,
        } : { mode: 'full' },
      };
    } catch (_) {
      return null;
    }
  }

  function primeDomToImageForSnapshot() {
    if (!window.domtoimage?.impl || window.__onlookerDomToImagePatched) return;
    window.__onlookerDomToImagePatched = true;

    const impl = window.domtoimage.impl;
    if (impl.fontFaces?.resolveAll) {
      impl.fontFaces.resolveAll = () => Promise.resolve('');
    }
    if (impl.fontFaces?.impl?.readAll) {
      impl.fontFaces.impl.readAll = () => Promise.resolve([]);
    }
    if (impl.util) {
      impl.util.getAndEncode = (url) => silentGetAndEncode(url);
    }
    if (impl.images?.inlineAll) {
      const originalInlineAll = impl.images.inlineAll.bind(impl.images);
      impl.images.inlineAll = (node) => originalInlineAll(node).catch(() => node);
    }
  }

  function silentGetAndEncode(url) {
    const timeoutMs = 6000;
    if (!url || /^data:/i.test(url) || shouldSkipDomImageResourceUrl(url)) {
      return Promise.resolve('');
    }

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.responseType = 'blob';
      xhr.timeout = timeoutMs;
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        if (xhr.status !== 200 || !xhr.response) {
          failedDomResourceUrls.add(url);
          resolve('');
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = String(reader.result || '');
          const base64 = result.split(',')[1] || '';
          resolve(base64);
        };
        reader.onerror = () => resolve('');
        reader.readAsDataURL(xhr.response);
      };
      xhr.onerror = () => {
        failedDomResourceUrls.add(url);
        resolve('');
      };
      xhr.ontimeout = () => {
        failedDomResourceUrls.add(url);
        resolve('');
      };
      try {
        xhr.open('GET', url, true);
        xhr.send();
      } catch (_) {
        failedDomResourceUrls.add(url);
        resolve('');
      }
    });
  }

  function shouldSkipDomImageResourceUrl(url) {
    if (!url || failedDomResourceUrls.has(url)) return true;

    try {
      const parsed = new URL(url, location.href);
      const href = parsed.href.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();

      if (
        href.includes('cdn.jsdelivr.net/gh/gbtami/pychess-variants') &&
        /\/static\/images\/pieces\/[^/]+\/[wb]l[kqrbnp]\.svg$/i.test(pathname)
      ) {
        failedDomResourceUrls.add(url);
        return true;
      }
    } catch (_) {}

    return false;
  }

  async function overlayBoardVisualOnSnapshot(snapshotDataUrl, boardVisual, viewportWidth, viewportHeight) {
    const base = await loadSnapshotImage(snapshotDataUrl);
    if (!base) return snapshotDataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = viewportWidth;
    canvas.height = viewportHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return snapshotDataUrl;
    ctx.drawImage(base, 0, 0, viewportWidth, viewportHeight);
    ctx.drawImage(boardVisual.canvas, boardVisual.rect.x, boardVisual.rect.y, boardVisual.rect.width, boardVisual.rect.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  function shouldOverlayBoardVisual(boardVisual) {
    return Boolean(boardVisual && boardVisual.pieceCount > 0);
  }

  function pickViewportBackground() {
    const bodyBg = window.getComputedStyle(document.body || document.documentElement).backgroundColor;
    if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') return bodyBg;
    const rootBg = window.getComputedStyle(document.documentElement).backgroundColor;
    if (rootBg && rootBg !== 'rgba(0, 0, 0, 0)' && rootBg !== 'transparent') return rootBg;
    return '#111111';
  }

  async function renderViewportDomSnapshot(ctx, viewport) {
    const elements = collectRenderableElements(viewport);
    for (const el of elements) {
      drawElementBox(ctx, el);
      await drawElementMedia(ctx, el);
      drawElementText(ctx, el);
    }
  }

  function collectRenderableElements(viewport) {
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    const result = [];
    let node = walker.currentNode;

    while (node) {
      if (isRenderableSnapshotElement(node, viewport)) {
        result.push(node);
        if (result.length >= 450) break;
      }
      node = walker.nextNode();
    }

    return result.sort((a, b) => {
      const depthA = getDomDepth(a);
      const depthB = getDomDepth(b);
      if (depthA !== depthB) return depthA - depthB;
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return (rectA.top - rectB.top) || (rectA.left - rectB.left);
    });
  }

  function isRenderableSnapshotElement(el, viewport) {
    if (!(el instanceof Element)) return false;
    if (panelEl?.contains(el) || panelHostEl?.contains(el)) return false;
    if (el === document.body || el === document.documentElement) return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.02) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > viewport.height || rect.left > viewport.width) return false;

    const hasOwnPaint =
      hasVisiblePaint(style) ||
      isMediaElement(el) ||
      hasMeaningfulInlineText(el) ||
      isFormLikeElement(el);

    return hasOwnPaint;
  }

  function hasVisiblePaint(style) {
    const bg = style.backgroundColor;
    const borderWidth = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style[`border${side}Width`]) > 0.2);
    const shadow = style.boxShadow && style.boxShadow !== 'none';
    return (
      (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
      borderWidth ||
      shadow
    );
  }

  function isMediaElement(el) {
    const tag = el.tagName.toLowerCase();
    return tag === 'img' || tag === 'canvas' || tag === 'svg' || tag === 'video';
  }

  function isFormLikeElement(el) {
    const tag = el.tagName.toLowerCase();
    return tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function hasMeaningfulInlineText(el) {
    if (el.children.length > 0) return false;
    return !!String(el.textContent || '').trim();
  }

  function getDomDepth(el) {
    let depth = 0;
    let current = el;
    while (current?.parentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function drawElementBox(ctx, el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const w = Math.max(0, Math.min(window.innerWidth, rect.right) - x);
    const h = Math.max(0, Math.min(window.innerHeight, rect.bottom) - y);
    if (w < 1 || h < 1) return;

    const radius = Math.max(
      parseFloat(style.borderTopLeftRadius) || 0,
      parseFloat(style.borderTopRightRadius) || 0,
      parseFloat(style.borderBottomRightRadius) || 0,
      parseFloat(style.borderBottomLeftRadius) || 0
    );

    ctx.save();
    roundedRectPath(ctx, x, y, w, h, Math.min(radius, Math.min(w, h) / 2));
    const bg = style.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fill();
    }

    const borderWidth = parseFloat(style.borderTopWidth) || 0;
    const borderColor = style.borderTopColor;
    if (borderWidth > 0.2 && borderColor && borderColor !== 'transparent') {
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = borderColor;
      ctx.stroke();
    }
    ctx.restore();
  }

  async function drawElementMedia(ctx, el) {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const w = Math.max(0, Math.min(window.innerWidth, rect.right) - x);
    const h = Math.max(0, Math.min(window.innerHeight, rect.bottom) - y);
    if (w < 2 || h < 2) return;

    const tag = el.tagName.toLowerCase();
    try {
      if (tag === 'img' && el.currentSrc) {
        if (!el.complete) return;
        ctx.drawImage(el, x, y, w, h);
      } else if (tag === 'canvas') {
        ctx.drawImage(el, x, y, w, h);
      } else if (tag === 'svg') {
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(el));
        const img = await loadSnapshotImage(dataUrl);
        if (img) ctx.drawImage(img, x, y, w, h);
      } else if (tag === 'video' && el.readyState >= 2) {
        ctx.drawImage(el, x, y, w, h);
      }
    } catch (_) {}
  }

  function drawElementText(ctx, el) {
    const directText = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim());
    const tag = el.tagName.toLowerCase();
    const formText = tag === 'input' || tag === 'textarea' ? (el.value || el.placeholder || '') : '';
    const text = String(formText || directText?.textContent || '').trim();
    if (!text) return;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 14;
    const lineHeight = parseFloat(style.lineHeight) || (fontSize * 1.25);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const color = style.color || '#ffffff';
    const fontWeight = style.fontWeight || '400';
    const fontFamily = style.fontFamily || 'system-ui';

    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';

    const x = Math.max(0, rect.left + paddingLeft);
    const maxWidth = Math.max(0, rect.width - paddingLeft - (parseFloat(style.paddingRight) || 0));
    const y = Math.max(0, rect.top + paddingTop + Math.max(0, (rect.height - lineHeight) / 2));
    const clipped = clipTextToWidth(ctx, text.replace(/\s+/g, ' '), maxWidth);
    if (clipped) ctx.fillText(clipped, x, y, maxWidth);
    ctx.restore();
  }

  function clipTextToWidth(ctx, text, maxWidth) {
    if (!text || maxWidth <= 4) return '';
    if (ctx.measureText(text).width <= maxWidth) return text;
    let clipped = text;
    while (clipped.length > 1 && ctx.measureText(clipped + '…').width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    return clipped ? (clipped + '…') : '';
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (!radius) {
      ctx.rect(x, y, width, height);
      return;
    }
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  async function buildBoardVisualFromDom() {
    const boardEl = findPrimaryBoardElement();
    if (!boardEl) return null;
    const rect = boardEl.getBoundingClientRect();
    if (!isLikelyBoardRect(rect)) return null;

    const size = Math.max(80, Math.floor(Math.min(rect.width, rect.height)));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const sq = size / 8;
    const sampledColors = sampleBoardColors(boardEl, rect);
    const lightColor = sampledColors?.light || LIGHT_SQ;
    const darkColor = sampledColors?.dark || DARK_SQ;
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        ctx.fillStyle = (r + c) % 2 === 0 ? lightColor : darkColor;
        ctx.fillRect(c * sq, r * sq, sq, sq);
      }
    }

    const pieces = await extractVisibleBoardPieces(boardEl, rect);
    const boardMedia = await extractBoardMediaImage(boardEl);
    if (boardMedia) {
      ctx.drawImage(boardMedia, 0, 0, size, size);
    } else if (!pieces.length) {
      return null;
    }

    for (const piece of pieces) {
      const img = await loadPieceImage(PIECE_IMAGES[piece.code]);
      if (!img) continue;
      ctx.drawImage(img, piece.col * sq, piece.row * sq, sq, sq);
    }

    return {
      canvas,
      rect: {
        x: Math.max(0, Math.floor(rect.left)),
        y: Math.max(0, Math.floor(rect.top)),
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      },
      pieceCount: pieces.length,
      hasBoardMedia: Boolean(boardMedia),
    };
  }

  function findPrimaryBoardElement() {
    const selectors = [
      '.cg-wrap',
      'cg-board',
      'wc-chess-board',
      '[data-cy="board-layout-chessboard"]',
      '[data-cy="game-board"]',
      '.board',
      '.main-board',
      '.chessboard',
      '[class*="board"]',
    ];

    const candidates = [];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (panelEl?.contains(el)) return;
        const rect = el.getBoundingClientRect();
        if (!isLikelyBoardRect(rect)) return;
        candidates.push({ el, rect, score: scoreBoardCandidate(el, rect) });
      });
    });

    document.querySelectorAll('img, canvas, svg').forEach((el) => {
      if (panelEl?.contains(el)) return;
      const rect = el.getBoundingClientRect();
      if (!isLikelyBoardRect(rect)) return;
      candidates.push({ el, rect, score: scoreBoardCandidate(el, rect) });
    });

    if (!candidates.length) return null;
    return candidates.sort((a, b) => b.score - a.score)[0].el;
  }

  function scoreBoardCandidate(el, rect) {
    const tag = String(el.tagName || '').toLowerCase();
    const className = String(el.className || '').toLowerCase();
    const attrs = [
      className,
      String(el.getAttribute?.('id') || '').toLowerCase(),
      String(el.getAttribute?.('data-testid') || '').toLowerCase(),
      String(el.getAttribute?.('data-cy') || '').toLowerCase(),
      String(el.getAttribute?.('src') || '').toLowerCase(),
      String(el.getAttribute?.('aria-label') || '').toLowerCase(),
    ].join(' ');

    let score = scoreBoardRect(rect);
    if (tag === 'canvas' || tag === 'img' || tag === 'svg') score += 45000;
    if (/\bboard\b/.test(attrs)) score += 60000;
    if (/\bchess\b/.test(attrs)) score += 30000;
    if (/\bpuzzle\b/.test(attrs)) score += 12000;
    if (/\bcoordinate|rank|file\b/.test(attrs)) score += 5000;
    return score;
  }

  function sampleBoardColors(boardEl, rect) {
    try {
      const probe = boardEl.tagName.toLowerCase() === 'canvas' ? boardEl : boardEl.querySelector('canvas,img');
      if (!probe) return null;
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 16;
      sampleCanvas.height = 16;
      const sctx = sampleCanvas.getContext('2d');
      if (!sctx) return null;
      sctx.drawImage(probe, 0, 0, 16, 16);
      const img = sctx.getImageData(0, 0, 16, 16).data;
      const readPixel = (x, y) => {
        const idx = (y * 16 + x) * 4;
        return `rgb(${img[idx]}, ${img[idx + 1]}, ${img[idx + 2]})`;
      };
      return { light: readPixel(2, 2), dark: readPixel(3, 2) };
    } catch (_) {
      const style = window.getComputedStyle(boardEl);
      const bg = style.backgroundColor;
      return bg && bg !== 'rgba(0, 0, 0, 0)' ? { light: bg, dark: DARK_SQ } : null;
    }
  }

  async function extractBoardMediaImage(boardEl) {
    const tag = String(boardEl.tagName || '').toLowerCase();
    try {
      if (tag === 'canvas') return boardEl;
      if (tag === 'img' && boardEl.currentSrc && boardEl.complete) return boardEl;
      if (tag === 'svg') {
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(boardEl));
        return loadSnapshotImage(dataUrl);
      }

      const media = boardEl.querySelector('canvas, img, svg');
      if (!media) return null;
      if (media.tagName.toLowerCase() === 'canvas') return media;
      if (media.tagName.toLowerCase() === 'img' && media.currentSrc && media.complete) return media;
      if (media.tagName.toLowerCase() === 'svg') {
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(media));
        return loadSnapshotImage(dataUrl);
      }
    } catch (_) {}
    return null;
  }

  async function extractVisibleBoardPieces(boardEl, boardRect) {
    const squareSize = Math.min(boardRect.width, boardRect.height) / 8;
    const scopeSet = new Set();

    Array.from(boardEl.querySelectorAll?.('*') || []).forEach((el) => scopeSet.add(el));
    Array.from(document.querySelectorAll('*')).forEach((el) => {
      const className = String(el.className || '').toLowerCase();
      const datasetPiece = String(el.getAttribute?.('data-piece') || '').toLowerCase();
      const tag = String(el.tagName || '').toLowerCase();
      const bgImage = String(window.getComputedStyle(el).backgroundImage || '').toLowerCase();
      const shouldInclude = (
        className.includes('piece') ||
        className.includes('square-') ||
        datasetPiece ||
        tag === 'piece' ||
        /url\(/.test(bgImage)
      );
      if (shouldInclude) scopeSet.add(el);
    });

    const scope = Array.from(scopeSet);
    const pieces = [];
    for (const el of scope) {
      const rect = el.getBoundingClientRect();
      if (rect.width < squareSize * 0.35 || rect.height < squareSize * 0.35) continue;
      if (!rectsOverlap(rect, boardRect, 2)) continue;
      const code = parsePieceCodeFromElement(el);
      if (!code) continue;

      const posFromClass = parseSquarePositionFromElement(el);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const col = posFromClass ? posFromClass.col : Math.max(0, Math.min(7, Math.floor(((cx - boardRect.left) / boardRect.width) * 8)));
      const row = posFromClass ? posFromClass.row : Math.max(0, Math.min(7, Math.floor(((cy - boardRect.top) / boardRect.height) * 8)));
      const key = `${row}:${col}`;
      if (pieces.some((piece) => piece.key === key)) continue;
      pieces.push({ code, row, col, key });
    }

    return pieces;
  }

  function parsePieceCodeFromElement(el) {
    const className = String(el.className || '').toLowerCase();
    const style = window.getComputedStyle(el);
    const attrs = [
      className,
      String(el.getAttribute?.('data-piece') || '').toLowerCase(),
      String(el.getAttribute?.('data-state') || '').toLowerCase(),
      String(el.getAttribute?.('data-role') || '').toLowerCase(),
      String(el.getAttribute?.('data-testid') || '').toLowerCase(),
      String(el.getAttribute?.('alt') || '').toLowerCase(),
      String(el.getAttribute?.('aria-label') || '').toLowerCase(),
      String(el.getAttribute?.('src') || '').toLowerCase(),
      String(style.backgroundImage || '').toLowerCase(),
    ].join(' ');

    const shortCode = attrs.match(/(?:^|[^a-z])([wb])([kqrbnp])(?:[^a-z]|$)/);
    if (shortCode) {
      const side = shortCode[1] === 'w' ? 'white' : 'black';
      const piece = shortCode[2];
      return side === 'white' ? piece.toUpperCase() : piece;
    }

    const fileNameCode = attrs.match(/\/([wb])([kqrbnp])\.(svg|png|jpg|jpeg|webp)/);
    if (fileNameCode) {
      const side = fileNameCode[1] === 'w' ? 'white' : 'black';
      const piece = fileNameCode[2];
      return side === 'white' ? piece.toUpperCase() : piece;
    }

    const side = /\bwhite\b/.test(attrs) ? 'white' : (/\bblack\b/.test(attrs) ? 'black' : '');
    const pieceName = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'].find((name) => attrs.includes(name));
    if (!side || !pieceName) return null;

    const map = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
    const letter = map[pieceName];
    return side === 'white' ? letter.toUpperCase() : letter;
  }

  function parseSquarePositionFromElement(el) {
    const attrs = [
      String(el.className || '').toLowerCase(),
      String(el.getAttribute?.('data-square') || '').toLowerCase(),
      String(el.getAttribute?.('data-coord') || '').toLowerCase(),
      String(el.getAttribute?.('data-position') || '').toLowerCase(),
    ].join(' ');

    const coordMatch = attrs.match(/\b([a-h])([1-8])\b/);
    if (coordMatch) {
      const col = coordMatch[1].charCodeAt(0) - 97;
      const row = 8 - Number(coordMatch[2]);
      return { row, col };
    }

    const squareMatch = attrs.match(/square[-_]?([1-8])([1-8])/);
    if (squareMatch) {
      const file = Number(squareMatch[1]) - 1;
      const rank = Number(squareMatch[2]);
      return { row: 8 - rank, col: file };
    }

    return null;
  }

  const loadedPieceImageCache = new Map();
  const loadedSnapshotImageCache = new Map();

  function loadPieceImage(src) {
    if (!src) return Promise.resolve(null);
    if (loadedPieceImageCache.has(src)) return loadedPieceImageCache.get(src);
    const promise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    loadedPieceImageCache.set(src, promise);
    return promise;
  }

  function loadSnapshotImage(src) {
    if (!src) return Promise.resolve(null);
    if (loadedSnapshotImageCache.has(src)) return loadedSnapshotImageCache.get(src);
    const promise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    loadedSnapshotImageCache.set(src, promise);
    return promise;
  }

  function setLiveStatus(state, msg) {
    const dot = panelEl.querySelector('[data-role="status-dot"]');
    const text = panelEl.querySelector('[data-role="status-text"]');
    dot.className = 'fen-live-status-dot';
    if (state) dot.classList.add(state);
    text.textContent = msg;
    syncMobileLiveToggle(msg);
  }

  function syncMobileLiveToggle(statusText = '') {
    const toggle = panelEl?.querySelector('[data-role="mobile-live-toggle"]');
    if (!toggle) return;
    toggle.textContent = liveRunning ? 'Stop' : 'Live';
    toggle.classList.toggle('is-live', liveRunning);
    toggle.title = statusText || (liveRunning ? 'Stop live scan' : 'Start live scan');
    syncLauncherState();
  }

  function isCompactMobilePanel() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
    return Boolean(coarsePointer || window.innerWidth <= 520);
  }

  function setPanelMinimized(minimized) {
    if (!panelEl) return;
    panelMinimized = Boolean(minimized);
    panelEl.classList.toggle('is-minimized', panelMinimized);
    syncLauncherState();
  }

  function syncLauncherState() {
    const launcher = panelEl?.querySelector('[data-role="launcher"]');
    const dot = panelEl?.querySelector('[data-role="launcher-dot"]');
    if (!launcher) return;
    const showLauncher = isPanelFeatureEnabled() && panelMinimized && panelEl.style.display !== 'none';
    launcher.style.display = showLauncher ? 'flex' : 'none';
    launcher.title = liveRunning ? 'Open OnLooker (Live)' : 'Open OnLooker';
    if (dot) {
      dot.classList.toggle('is-live', liveRunning);
      dot.classList.toggle('is-idle', !liveRunning);
    }
  }

  function syncPanelLayoutMode() {
    if (!panelEl) return;
    const compactMobile = isCompactMobilePanel();
    panelEl.classList.toggle('is-mobile', compactMobile);
    if (compactMobile) {
      panelEl.style.maxWidth = 'calc(100vw - 12px)';
      if (panelEl.dataset.mobileDragged === '1') {
        panelEl.style.right = 'auto';
        panelEl.style.bottom = 'auto';
      } else {
        panelEl.style.left = `${Math.max(6, Math.round((window.innerWidth - panelEl.offsetWidth) / 2))}px`;
        panelEl.style.right = 'auto';
        panelEl.style.top = 'auto';
        panelEl.style.bottom = '0';
      }
    } else {
      delete panelEl.dataset.mobileDragged;
      panelEl.style.bottom = 'auto';
      panelEl.style.maxWidth = 'calc(100vw - 24px)';
    }
  }

  function handlePanelViewportChange() {
    if (!panelEl) return;
    applyPanelScale(panelScale);
    restorePanelPosition();
    if (currentFen) {
      const lastMove = panelEl.querySelector('[data-role="last-move"]').textContent;
      const highlight = lastMove ? parseLastMoveSquares(lastMove) : null;
      drawBoard(currentFen, flipped, highlight);
    } else {
      renderDefaultPanelState();
    }
  }

  function renderDefaultPanelState() {
    if (!panelEl) return;
    const resultWrap = panelEl.querySelector('[data-role="result"]');
    const fenEl = panelEl.querySelector('[data-role="fen"]');
    const turnEl = panelEl.querySelector('[data-role="turn"]');
    const lastMoveWrap = panelEl.querySelector('[data-role="last-move-wrap"]');
    const lastMoveEl = panelEl.querySelector('[data-role="last-move"]');
    const moveCountEl = panelEl.querySelector('[data-role="move-count"]');

    if (resultWrap) resultWrap.style.display = 'flex';
    if (fenEl) fenEl.textContent = START_POSITION_FEN;
    if (turnEl) turnEl.textContent = 'White to move';
    if (lastMoveWrap) lastMoveWrap.style.display = 'none';
    if (lastMoveEl) lastMoveEl.textContent = '';
    if (moveCountEl) moveCountEl.textContent = '';
    drawBoard(START_POSITION_FEN, false, null);
  }

  function updateResult(fen, turn, lastMove) {
    const resultWrap = panelEl.querySelector('[data-role="result"]');
    const fenEl = panelEl.querySelector('[data-role="fen"]');
    const turnEl = panelEl.querySelector('[data-role="turn"]');
    const lastMoveWrap = panelEl.querySelector('[data-role="last-move-wrap"]');
    const lastMoveEl = panelEl.querySelector('[data-role="last-move"]');
    const moveCountEl = panelEl.querySelector('[data-role="move-count"]');

    resultWrap.style.display = 'flex';
    fenEl.textContent = fen;
    const normalizedTurn = normalizeTurnValue(turn);
    turnEl.textContent = normalizedTurn === 'b' ? 'Black to move' : 'White to move';

    if (!bestMoveWhite) flipped = normalizedTurn === 'b';

    if (lastMove) {
      lastMoveWrap.style.display = 'flex';
      lastMoveEl.textContent = lastMove;
      moveCountEl.textContent = `x${moveCount}`;
    } else {
      lastMoveWrap.style.display = 'none';
      lastMoveEl.textContent = '';
      moveCountEl.textContent = '';
    }

    const highlight = lastMove ? parseLastMoveSquares(lastMove) : null;
    drawBoard(fen, flipped, highlight);
    updateLogsPanel();
  }

  function diffFen(fenA, fenB) {
    const boardA = fenToSquares(fenA);
    const boardB = fenToSquares(fenB);
    const lost = [];
    const gained = [];

    for (let sq = 0; sq < 64; sq += 1) {
      if (boardA[sq] === boardB[sq]) continue;
      if (boardA[sq] && !boardB[sq]) lost.push(sq);
      else if (!boardA[sq] && boardB[sq]) gained.push(sq);
      else {
        gained.push(sq);
        if (boardA[sq] !== boardB[sq]) lost.push(sq);
      }
    }

    if (lost.length && gained.length) {
      return sqToAlg(lost[0]) + sqToAlg(gained[gained.length - 1]);
    }
    return null;
  }

  function fenToSquares(fen) {
    const arr = new Array(64).fill('');
    const rows = fen.split(' ')[0].split('/');
    let idx = 0;
    for (const row of rows) {
      for (const ch of row) {
        if (Number.isNaN(Number(ch))) arr[idx++] = ch;
        else idx += Number(ch);
      }
    }
    return arr;
  }

  function sqToAlg(idx) {
    return 'abcdefgh'[idx % 8] + (8 - Math.floor(idx / 8));
  }

  function parseLastMoveSquares(move) {
    if (!move || move.length < 4) return null;
    const files = 'abcdefgh';
    const fromFile = files.indexOf(move[0]);
    const fromRank = 8 - Number(move[1]);
    const toFile = files.indexOf(move[2]);
    const toRank = 8 - Number(move[3]);
    if (fromFile < 0 || toFile < 0) return null;
    return {
      from: fromRank * 8 + fromFile,
      to: toRank * 8 + toFile,
    };
  }

  function parseFenBoard(fen) {
    return fen.split(' ')[0].split('/').map((rank) => {
      const row = [];
      for (const ch of rank) {
        if (Number.isNaN(Number(ch))) row.push(ch);
        else for (let i = 0; i < Number(ch); i += 1) row.push('');
      }
      return row;
    });
  }

  function normalizeFen(fen, turn = 'w') {
    const raw = String(fen || '').trim();
    if (!raw) return '';

    let parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 1 && raw.includes('_')) {
      const underscoreParts = raw.split('_').filter(Boolean);
      if (underscoreParts.length >= 2) {
        parts = [
          underscoreParts[0],
          underscoreParts[1],
          underscoreParts[2] || '-',
          underscoreParts[3] || '-',
          underscoreParts[4] || '0',
          underscoreParts[5] || '1',
        ];
      }
    }

    const board = parts[0] || '';
    if (board.split('/').length !== 8) return raw;

    const side = normalizeTurnValue(parts[1] || turn);
    const castling = /^(?:-|[KQkq]+)$/.test(parts[2] || '') ? parts[2] : '-';
    const enPassant = /^(-|[a-h][36])$/.test(parts[3] || '') ? parts[3] : '-';
    const halfmove = /^\d+$/.test(parts[4] || '') ? parts[4] : '0';
    const fullmove = /^[1-9]\d*$/.test(parts[5] || '') ? parts[5] : '1';

    return [board, side, castling, enPassant, halfmove, fullmove].join(' ');
  }

  function normalizeTurnValue(turn) {
    const value = String(turn || '').trim().toLowerCase();
    if (value === 'b' || value === 'black') return 'b';
    return 'w';
  }

  function drawBoard(fen, flip, highlight) {
    const gridCanvas = panelEl.querySelector('[data-role="board-grid"]');
    const arrowCanvas = panelEl.querySelector('[data-role="board-arrow"]');
    const highlightLayer = panelEl.querySelector('[data-role="board-highlight"]');
    const piecesLayer = panelEl.querySelector('[data-role="board-pieces"]');
    const squareSize = Math.round(BASE_BOARD_SIZE * panelScale) / FILES;
    const size = Math.round(BASE_BOARD_FRAME_SIZE * panelScale);
    const board = parseFenBoard(fen);

    [gridCanvas, arrowCanvas].forEach((canvas) => {
      canvas.width = size;
      canvas.height = size;
    });

    drawBoardGrid(gridCanvas, squareSize, size);
    drawBoardHighlights(highlightLayer, highlight, flip, squareSize);
    drawBoardPieces(piecesLayer, board, flip, squareSize);
    drawHintArrows(arrowCanvas.getContext('2d'), squareSize, flip, size);
  }

  function drawBoardGrid(canvas, sq, size) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT_SQ : DARK_SQ;
        ctx.fillRect(BOARD_BORDER + c * sq, BOARD_BORDER + r * sq, sq, sq);
      }
    }

    ctx.strokeStyle = '#080806';
    ctx.lineWidth = BOARD_BORDER;
    ctx.strokeRect(BOARD_BORDER / 2, BOARD_BORDER / 2, size - BOARD_BORDER, size - BOARD_BORDER);
  }

  function drawBoardHighlights(layer, highlight, flip, sq) {
    layer.innerHTML = '';
    if (!highlight) return;

    [highlight.from, highlight.to].forEach((sqIdx, index) => {
      if (sqIdx === null || sqIdx === undefined) return;
      const file = sqIdx % 8;
      const rank = Math.floor(sqIdx / 8);
      const drawCol = flip ? 7 - file : file;
      const drawRow = flip ? 7 - rank : rank;
      const node = document.createElement('div');
      node.className = 'fen-live-board-highlight';
      node.style.left = `${BOARD_BORDER + drawCol * sq}px`;
      node.style.top = `${BOARD_BORDER + drawRow * sq}px`;
      node.style.width = `${sq}px`;
      node.style.height = `${sq}px`;
      node.style.background = index === 0 ? HIGHLIGHT_A : HIGHLIGHT_B;
      layer.appendChild(node);
    });
  }

  function drawBoardPieces(layer, board, flip, sq) {
    layer.innerHTML = '';
    const useTextPieces = isCompactMobilePanel();
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const piece = board[r][c];
        if (!piece) continue;
        const drawCol = flip ? 7 - c : c;
        const drawRow = flip ? 7 - r : r;
        const node = document.createElement('div');
        node.className = useTextPieces ? 'fen-live-board-piece fen-live-board-piece-text' : 'fen-live-board-piece';
        node.style.left = `${BOARD_BORDER + drawCol * sq}px`;
        node.style.top = `${BOARD_BORDER + drawRow * sq}px`;
        node.style.width = `${sq}px`;
        node.style.height = `${sq}px`;
        if (useTextPieces) {
          node.textContent = PIECE_GLYPHS[piece] || '';
          node.style.fontSize = `${Math.max(16, Math.floor(sq * 0.82))}px`;
          node.style.lineHeight = `${sq}px`;
          node.style.color = piece === piece.toUpperCase() ? '#fff6dd' : '#151515';
          node.style.textShadow = piece === piece.toUpperCase()
            ? '0 1px 1px rgba(0,0,0,0.45)'
            : '0 1px 1px rgba(255,255,255,0.18)';
        } else {
          if (!PIECE_IMAGES[piece]) continue;
          node.style.backgroundImage = `url("${PIECE_IMAGES[piece]}")`;
        }
        layer.appendChild(node);
      }
    }
  }

  function drawHintArrows(ctx, sq, flip, size) {
    ctx.clearRect(0, 0, size, size);
    const whiteLines = showWhiteHints ? bestMoveWhiteLines.slice(0, settings.arrowCount) : [];
    const blackLines = showBlackHints ? bestMoveBlackLines.slice(0, settings.arrowCount) : [];

    const renderArrowSet = (arrows) => arrows.forEach((arrow, index) => {
      if (!arrow?.move || arrow.move.length < 4) return;
      const fromSq = uciToSquareIndex(arrow.move.slice(0, 2));
      const toSq = uciToSquareIndex(arrow.move.slice(2, 4));
      if (!fromSq || !toSq) return;

      const visCol = (file) => (flip ? 7 - file : file);
      const visRow = (rank) => (flip ? 7 - rank : rank);
      drawArrow(
        ctx,
        BOARD_BORDER + (visCol(fromSq.f) + 0.5) * sq,
        BOARD_BORDER + (visRow(fromSq.r) + 0.5) * sq,
        BOARD_BORDER + (visCol(toSq.f) + 0.5) * sq,
        BOARD_BORDER + (visRow(toSq.r) + 0.5) * sq,
        hexToRgba(settings.arrowColors[index] || settings.arrowColors[0], Math.max(0.3, 0.9 - (index * 0.14))),
        sq * Math.max(0.07, 0.13 - (index * 0.012)),
        sq * 0.32
      );
    });

    renderArrowSet(whiteLines);
    renderArrowSet(blackLines);
  }

  function hexToRgba(hex, alpha) {
    const normalized = normalizeColor(hex).replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function uciToSquareIndex(square) {
    const files = 'abcdefgh';
    const f = files.indexOf(square[0]);
    const r = 8 - Number(square[1]);
    if (f < 0 || Number.isNaN(r)) return null;
    return { r, f };
  }

  function drawArrow(ctx, x1, y1, x2, y2, color, lineWidth, headSize) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const angle = Math.atan2(dy, dx);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const endX = x2 - Math.cos(angle) * headSize * 0.4;
    const endY = y2 - Math.sin(angle) * headSize * 0.4;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headSize * Math.cos(angle - Math.PI / 6),
      y2 - headSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      x2 - headSize * Math.cos(angle + Math.PI / 6),
      y2 - headSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  async function analysePosition(fen) {
    const jobId = ++analyseJobSeq;
    bestMoveWhite = null;
    bestMoveBlack = null;
    bestMoveWhiteLines = [];
    bestMoveBlackLines = [];
    renderHints();
    setEngineStatus('scanning', 'Komodo offline is analysing...');

    try {
      const result = await sendRuntime({
        action: 'analyseFenOffline',
        fen,
        depth: settings.depth,
        multiPv: settings.arrowCount,
      });
      if (jobId !== analyseJobSeq || fen !== currentFen) return;
      if (!result?.success) {
        throw new Error(result?.error || 'Komodo offline analysis failed');
      }

      bestMoveWhite = result.white || null;
      bestMoveBlack = result.black || null;
      bestMoveWhiteLines = Array.isArray(result.whiteLines) ? result.whiteLines : (result.white ? [result.white] : []);
      bestMoveBlackLines = Array.isArray(result.blackLines) ? result.blackLines : (result.black ? [result.black] : []);
      lastEngineResult = result || null;
      lastEngineDebugLines = Array.isArray(result?.debugLines) ? result.debugLines : [];
      updateLogsPanel();
      renderHints();
      const engineName = result.engine === 'stockfish' ? 'Stockfish offline' : 'Komodo offline';
      setEngineStatus('ok', `${engineName} hints ready`);

      if (currentFen) {
        const highlight = panelEl.querySelector('[data-role="last-move"]').textContent
          ? parseLastMoveSquares(panelEl.querySelector('[data-role="last-move"]').textContent)
          : null;
        drawBoard(currentFen, flipped, highlight);
      }
    } catch (err) {
      if (jobId !== analyseJobSeq) return;
      bestMoveWhite = null;
      bestMoveBlack = null;
      bestMoveWhiteLines = [];
      bestMoveBlackLines = [];
      lastEngineResult = null;
      lastEngineDebugLines = [];
      updateLogsPanel();
      renderHints();
      setEngineStatus('err', err.message || 'Komodo offline analysis failed');
    }
  }

  function renderHints() {
    const whiteWrap = panelEl.querySelector('[data-role="hint-white"]');
    const blackWrap = panelEl.querySelector('[data-role="hint-black"]');
    const whiteMove = panelEl.querySelector('[data-role="hint-white-move"]');
    const blackMove = panelEl.querySelector('[data-role="hint-black-move"]');
    const whiteScore = panelEl.querySelector('[data-role="hint-white-score"]');
    const blackScore = panelEl.querySelector('[data-role="hint-black-score"]');

    if (bestMoveWhite?.move) {
      whiteWrap.style.display = 'block';
      whiteMove.textContent = bestMoveWhite.move;
      whiteScore.textContent = formatScore(bestMoveWhite.cp, 'w');
    } else {
      whiteWrap.style.display = 'none';
    }

    if (bestMoveBlack?.move) {
      blackWrap.style.display = 'block';
      blackMove.textContent = bestMoveBlack.move;
      blackScore.textContent = formatScore(bestMoveBlack.cp, 'b');
    } else {
      blackWrap.style.display = 'none';
    }

    syncHintToggleButtons();
  }

  function formatScore(cp, side) {
    if (cp === null || cp === undefined) return '';
    if (Math.abs(cp) >= 90000) return cp > 0 ? '#' : '#-';
    const value = (side === 'b' ? -cp : cp) / 100;
    return (value >= 0 ? '+' : '') + value.toFixed(2);
  }

  function setEngineStatus(state, msg) {
    const dot = panelEl.querySelector('[data-role="eng-dot"]');
    const text = panelEl.querySelector('[data-role="eng-status"]');
    dot.className = 'fen-live-status-dot';
    if (state) dot.classList.add(state);
    text.textContent = msg;
  }

  function flipBoard() {
    flipped = !flipped;
    if (!currentFen) return;
    const lastMove = panelEl.querySelector('[data-role="last-move"]').textContent;
    const highlight = lastMove ? parseLastMoveSquares(lastMove) : null;
    drawBoard(currentFen, flipped, highlight);
  }

  function toggleLogsPanel(forceOpen) {
    const logsPanel = panelEl.querySelector('[data-role="logs-panel"]');
    if (!logsPanel) return;
    if (isCompactMobilePanel()) {
      logsPanel.style.display = 'none';
      return;
    }
    const shouldOpen = typeof forceOpen === 'boolean'
      ? forceOpen
      : logsPanel.style.display === 'none';
    logsPanel.style.display = shouldOpen ? 'block' : 'none';
    if (shouldOpen) updateLogsPanel();
  }

  function updateLogsPanel() {
    if (!panelEl) return;
    const shotEl = panelEl.querySelector('[data-role="log-shot"]');
    const cropEl = panelEl.querySelector('[data-role="log-crop"]');
    const textEl = panelEl.querySelector('[data-role="log-text"]');
    if (!shotEl || !cropEl || !textEl) return;

    applyLogImage(shotEl, lastScreenshotDataUrl);
    applyLogImage(cropEl, lastCroppedDataUrl || lastResizedDataUrl);

    const normalizedFen = currentFen || normalizeFen(lastRawFen, lastDetectedTurn);
    const normalizedParts = String(normalizedFen || '').trim().split(/\s+/).filter(Boolean);
    const rawParts = String(lastRawFen || '').trim().split(/\s+/).filter(Boolean);
    const lines = [
      `fen error: ${lastFenError || '-'}`,
      `turn: ${lastDetectedTurn || '-'}`,
      `raw fen fields: ${rawParts.length}`,
      `normalized fen fields: ${normalizedParts.length}`,
      `raw fen: ${lastRawFen || '-'}`,
      `normalized fen: ${normalizedFen || '-'}`,
      `white move: ${lastEngineResult?.white?.move || 'null'}`,
      `white cp: ${lastEngineResult?.white?.cp ?? 'null'}`,
      `black move: ${lastEngineResult?.black?.move || 'null'}`,
      `black cp: ${lastEngineResult?.black?.cp ?? 'null'}`,
      `engine: ${lastEngineResult?.engine || '-'}`,
      '',
      'server response:',
      formatLogValue(lastServerResponse),
      '',
      'engine raw lines:',
      ...(lastEngineDebugLines.length ? lastEngineDebugLines : ['-']),
    ];
    textEl.textContent = lines.join('\n');
  }

  function applyLogImage(imgEl, src) {
    const hasImage = Boolean(src);
    imgEl.style.display = hasImage ? 'block' : 'none';
    if (hasImage) imgEl.src = src;
    else imgEl.removeAttribute('src');
  }

  function formatLogValue(value) {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }

  function cropImage(dataUrl, crop) {
    if (!crop || crop.mode !== 'crop') return Promise.resolve(dataUrl);

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scaleX = img.width / (crop.viewportWidth || img.width);
        const scaleY = img.height / (crop.viewportHeight || img.height);
        const sx = Math.max(0, Math.floor((crop.x || 0) * scaleX));
        const sy = Math.max(0, Math.floor((crop.y || 0) * scaleY));
        const sw = Math.max(1, Math.floor(crop.width * scaleX));
        const sh = Math.max(1, Math.floor(crop.height * scaleY));
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = dataUrl;
    });
  }

  function resizeImage(dataUrl, maxW, maxH) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const w = Math.floor(img.width * scale);
        const h = Math.floor(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      };
      img.src = dataUrl;
    });
  }

  function sendRuntime(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }
})();

