(function () {
  if (window.__onlookerHostedRuntimeLoaded) return;
  window.__onlookerHostedRuntimeLoaded = true;

  const config = window.__ONLOOKER_HOSTED_CONFIG__ || {};
  const baseUrl = String(config.baseUrl || new URL('./', location.href).href);
  const resourceMap = config.resourceMap || {};
  const SETTINGS_KEY = 'onlookerSettings';
  const CHANNEL = 'fen-engine-host';
  const DEFAULT_SETTINGS = Object.freeze({
    depth: 5,
    arrowColors: ['#4f8cff', '#2ecc71', '#f1c40f', '#e67e22', '#e74c3c'],
    arrowCount: 2,
    showPanel: true,
  });

  const runtimeListeners = [];
  const storageListeners = [];
  let dashboardOverlay = null;
  let engineFrame = null;
  let engineReady = false;
  let engineReadyPromise = null;
  let currentAnalysis = null;
  let analysisQueue = Promise.resolve();

  function resolveUrl(path) {
    const normalized = String(path || '').replace(/^\/+/, '');
    const resourceName = resourceMap[normalized];
    if (resourceName && typeof config.getResourceUrl === 'function') {
      const resourceUrl = config.getResourceUrl(resourceName);
      if (resourceUrl) return resourceUrl;
    }
    return new URL(normalized, baseUrl).href;
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function gmGetValue(key, fallback) {
    try {
      if (typeof config.getValue === 'function') return config.getValue(key, fallback);
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch (_) {}
    try {
      const raw = localStorage.getItem(`onlooker:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function gmSetValue(key, value) {
    try {
      if (typeof config.setValue === 'function') {
        config.setValue(key, value);
        return;
      }
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {}
    try {
      localStorage.setItem(`onlooker:${key}`, JSON.stringify(value));
    } catch (_) {}
  }

  function gmRemoveValue(key) {
    try {
      if (typeof config.deleteValue === 'function') {
        config.deleteValue(key);
        return;
      }
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
        return;
      }
    } catch (_) {}
    try {
      localStorage.removeItem(`onlooker:${key}`);
    } catch (_) {}
  }

  function normalizeStorageResult(keys) {
    const result = {};
    if (keys === null || keys === undefined) {
      const settings = gmGetValue(SETTINGS_KEY, undefined);
      if (settings !== undefined) result[SETTINGS_KEY] = settings;
      return result;
    }

    if (typeof keys === 'string') {
      result[keys] = gmGetValue(keys, undefined);
      return result;
    }

    if (Array.isArray(keys)) {
      keys.forEach((key) => { result[key] = gmGetValue(key, undefined); });
      return result;
    }

    if (typeof keys === 'object') {
      Object.keys(keys).forEach((key) => {
        result[key] = gmGetValue(key, keys[key]);
      });
      return result;
    }

    return result;
  }

  function emitStorageChanges(changes, areaName) {
    storageListeners.slice().forEach((listener) => {
      try { listener(changes, areaName); } catch (_) {}
    });
  }

  function createStorageArea() {
    return {
      get(keys, callback) {
        const result = normalizeStorageResult(keys);
        callback?.(clone(result));
      },
      set(items, callback) {
        const changes = {};
        Object.keys(items || {}).forEach((key) => {
          const oldValue = gmGetValue(key, undefined);
          const newValue = clone(items[key]);
          gmSetValue(key, newValue);
          changes[key] = { oldValue, newValue };
        });
        if (Object.keys(changes).length) emitStorageChanges(changes, 'local');
        callback?.();
      },
      remove(keys, callback) {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        list.forEach((key) => {
          const oldValue = gmGetValue(key, undefined);
          gmRemoveValue(key);
          changes[key] = { oldValue, newValue: undefined };
        });
        if (Object.keys(changes).length) emitStorageChanges(changes, 'local');
        callback?.();
      },
    };
  }

  function createRuntimeApi() {
    return {
      getURL(path) {
        return resolveUrl(path);
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        },
      },
      sendMessage(message, callback) {
        handleRuntimeMessage(message)
          .then((result) => callback?.(result))
          .catch((error) => callback?.({ success: false, error: error?.message || String(error) }));
      },
      lastError: null,
    };
  }

  function ensureChromePolyfill() {
    const existing = window.chrome || {};
    existing.runtime = existing.runtime || createRuntimeApi();
    existing.runtime.getURL = existing.runtime.getURL || ((path) => resolveUrl(path));
    if (!existing.runtime.onMessage?.addListener) existing.runtime.onMessage = createRuntimeApi().onMessage;
    if (!existing.runtime.sendMessage) existing.runtime.sendMessage = createRuntimeApi().sendMessage;
    existing.storage = existing.storage || {};
    existing.storage.local = existing.storage.local || createStorageArea();
    existing.storage.onChanged = existing.storage.onChanged || {
      addListener(listener) {
        storageListeners.push(listener);
      },
    };
    window.chrome = existing;
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const arrowColors = Array.isArray(source.arrowColors) ? source.arrowColors.slice(0, 5) : DEFAULT_SETTINGS.arrowColors.slice();
    while (arrowColors.length < 5) arrowColors.push(DEFAULT_SETTINGS.arrowColors[arrowColors.length]);
    return {
      depth: clampNumber(source.depth, 5, 25, DEFAULT_SETTINGS.depth),
      arrowColors: arrowColors.map((color, index) => normalizeColor(color, DEFAULT_SETTINGS.arrowColors[index])),
      arrowCount: clampNumber(source.arrowCount, 1, 5, DEFAULT_SETTINGS.arrowCount),
      showPanel: source.showPanel !== false,
    };
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  function normalizeColor(value, fallback) {
    const color = String(value || '').trim();
    return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  }

  async function handleRuntimeMessage(message) {
    switch (message?.action) {
      case 'callChessvision':
        return callChessvisionAPI(message.payload);
      case 'callCloudEval':
        return callCloudEvalAPI(message.fen);
      case 'analyseFenOffline':
        return analyseFenOffline(message.fen, { depth: message.depth, multiPv: message.multiPv });
      case 'captureScreenshot':
        return captureVisibleDom();
      default:
        return dispatchRuntimeMessage(message);
    }
  }

  async function dispatchRuntimeMessage(message) {
    if (!runtimeListeners.length) return null;
    return new Promise((resolve) => {
      let settled = false;
      const sendResponse = (response) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };

      for (const listener of runtimeListeners.slice()) {
        try {
          const maybeAsync = listener(message, { tab: null }, sendResponse);
          if (maybeAsync === true) return;
        } catch (_) {}
      }

      if (!settled) resolve(null);
    });
  }

  async function callChessvisionAPI(payload) {
    try {
      const response = await fetch('https://app.chessvision.ai/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      const data = await response.json();
      if (!response.ok) return { success: false, error: `HTTP ${response.status}`, data };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error?.message || 'Chessvision request failed' };
    }
  }

  async function callCloudEvalAPI(fen) {
    try {
      const response = await fetch(`https://lichess.org/api/cloud-eval?multiPv=1&fen=${encodeURIComponent(fen)}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) return { success: false, error: `HTTP ${response.status}`, data };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error?.message || 'Cloud eval failed' };
    }
  }

  async function captureVisibleDom() {
    const domtoimage = window.domtoimage;
    if (!domtoimage?.toJpeg) return { success: false, error: 'dom-to-image is unavailable' };

    const dpr = window.devicePixelRatio || 1;
    const viewportWidth = Math.max(1, Math.floor(window.innerWidth));
    const viewportHeight = Math.max(1, Math.floor(window.innerHeight));
    const sx = window.scrollX || window.pageXOffset || 0;
    const sy = window.scrollY || window.pageYOffset || 0;
    const node = document.body || document.documentElement;

    try {
      const screenshot = await domtoimage.toJpeg(node, {
        quality: 0.92,
        width: Math.floor(viewportWidth * dpr),
        height: Math.floor(viewportHeight * dpr),
        style: {
          transform: `scale(${dpr}) translate(${-sx}px, ${-sy}px)`,
          transformOrigin: 'top left',
          width: `${viewportWidth}px`,
          height: `${viewportHeight}px`,
        },
      });
      return { success: true, screenshot, crop: { mode: 'full' } };
    } catch (error) {
      return { success: false, error: error?.message || 'DOM capture failed' };
    }
  }

  function ensureEngineFrame() {
    if (engineReadyPromise) return engineReadyPromise;

    engineReadyPromise = new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.src = resolveUrl('engine/engine_host.html');
      iframe.style.display = 'none';
      iframe.width = '0';
      iframe.height = '0';
      iframe.setAttribute('aria-hidden', 'true');
      engineFrame = iframe;
      document.documentElement.appendChild(iframe);

      const timeoutId = setTimeout(() => {
        reject(new Error('Engine host boot timeout'));
      }, 12000);

      const onMessage = (event) => {
        if (!event.data || event.data.channel !== CHANNEL) return;
        if (event.data.type === 'ready') {
          clearTimeout(timeoutId);
          engineReady = true;
          resolve();
        }
      };

      window.addEventListener('message', onMessage);
    });

    return engineReadyPromise;
  }

  function engSend(cmd) {
    engineFrame?.contentWindow?.postMessage({ channel: CHANNEL, type: 'cmd', cmd }, '*');
  }

  function normalizeEngineLines(chunk) {
    return String(chunk || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function swapTurnInFen(fen) {
    const parts = String(fen || '').split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    return parts.join(' ');
  }

  function toWhitePerspective(cp, side) {
    return side === 'w' ? cp : -cp;
  }

  function collectResultSet(infoLines, turn, fallbackMove, fallbackCp) {
    const lines = Object.keys(infoLines)
      .map((key) => Number(key))
      .sort((a, b) => a - b)
      .map((key) => infoLines[key])
      .filter((entry) => entry?.move)
      .map((entry) => ({
        move: entry.move,
        cp: entry.cp === null ? null : toWhitePerspective(entry.cp, turn),
        depth: entry.depth || 0,
        turn,
      }));

    if (!lines.length && fallbackMove) {
      lines.push({
        move: fallbackMove,
        cp: fallbackCp === null ? null : toWhitePerspective(fallbackCp, turn),
        depth: 0,
        turn,
      });
    }

    return { turn, top: lines[0] || null, lines };
  }

  function handleEngineLine(line) {
    if (!currentAnalysis) return;
    if (line.startsWith('info ')) {
      if (line.includes('info string')) return;
      const pvMatch = line.match(/\bpv\s+(\S+)/);
      if (!pvMatch) return;
      const cpMatch = line.match(/\bscore cp\s+(-?\d+)/);
      const mateMatch = line.match(/\bscore mate\s+(-?\d+)/);
      const multiPvMatch = line.match(/\bmultipv\s+(\d+)/);
      const depthMatch = line.match(/\bdepth\s+(\d+)/);
      const mpv = multiPvMatch ? Number(multiPvMatch[1]) : 1;
      const cp = cpMatch ? Number(cpMatch[1]) : (mateMatch ? (Number(mateMatch[1]) > 0 ? 99999 : -99999) : 0);
      const depth = depthMatch ? Number(depthMatch[1]) : 0;
      currentAnalysis.infoLines[mpv] = { move: pvMatch[1], cp, depth };
      return;
    }

    if (!line.startsWith('bestmove')) return;

    const parts = line.split(/\s+/);
    const bestmove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
    const bestEntry = currentAnalysis.infoLines[1] || null;
    const move = bestmove || bestEntry?.move || null;
    const cp = bestEntry?.cp ?? null;

    if (currentAnalysis.phase === 1) {
      currentAnalysis.result1 = collectResultSet(currentAnalysis.infoLines, currentAnalysis.turn1, move, cp);
      currentAnalysis.phase = 2;
      currentAnalysis.infoLines = {};
      setTimeout(() => {
        engSend(`position fen ${currentAnalysis.fen2}`);
        engSend(`go depth ${currentAnalysis.depth}`);
      }, 40);
      return;
    }

    if (currentAnalysis.phase === 2) {
      currentAnalysis.result2 = collectResultSet(
        currentAnalysis.infoLines,
        currentAnalysis.turn1 === 'w' ? 'b' : 'w',
        move,
        cp
      );

      const white = currentAnalysis.result1?.turn === 'w' ? currentAnalysis.result1.top : currentAnalysis.result2?.top || null;
      const black = currentAnalysis.result1?.turn === 'b' ? currentAnalysis.result1.top : currentAnalysis.result2?.top || null;
      const whiteLines = currentAnalysis.result1?.turn === 'w' ? currentAnalysis.result1.lines : currentAnalysis.result2?.lines || [];
      const blackLines = currentAnalysis.result1?.turn === 'b' ? currentAnalysis.result1.lines : currentAnalysis.result2?.lines || [];
      const resolve = currentAnalysis.resolve;
      clearTimeout(currentAnalysis.timeoutId);
      currentAnalysis = null;
      resolve({
        success: true,
        white,
        black,
        whiteLines,
        blackLines,
        engine: 'komodoro',
      });
    }
  }

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.channel !== CHANNEL) return;
    if (event.data.type === 'line') {
      normalizeEngineLines(event.data.line).forEach(handleEngineLine);
      return;
    }
    if (event.data.type === 'error' && currentAnalysis) {
      clearTimeout(currentAnalysis.timeoutId);
      const reject = currentAnalysis.reject;
      currentAnalysis = null;
      reject(new Error(event.data.msg || 'Engine error'));
    }
  });

  function analyseFenOffline(fen, options = {}) {
    const depth = clampNumber(options.depth, 5, 25, DEFAULT_SETTINGS.depth);
    const multiPv = clampNumber(options.multiPv, 1, 5, DEFAULT_SETTINGS.arrowCount);

    analysisQueue = analysisQueue.then(async () => {
      await ensureEngineFrame();
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          currentAnalysis = null;
          reject(new Error('Offline engine timed out'));
        }, 20000);

        currentAnalysis = {
          resolve,
          reject,
          timeoutId,
          infoLines: {},
          phase: 1,
          depth,
          multiPv,
          turn1: String(fen || '').split(' ')[1] || 'w',
          fen2: swapTurnInFen(fen),
          result1: null,
          result2: null,
        };

        engSend('stop');
        setTimeout(() => {
          engSend(`setoption name MultiPV value ${multiPv}`);
          engSend(`position fen ${fen}`);
          engSend(`go depth ${depth}`);
        }, 40);
      });
    });

    return analysisQueue.catch((error) => ({ success: false, error: error?.message || 'Offline engine failed' }));
  }

  function createDashboard() {
    if (dashboardOverlay) return dashboardOverlay;
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'background:rgba(0,0,0,0.65)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:16px',
    ].join(';');
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeDashboard();
    });

    const frame = document.createElement('iframe');
    frame.src = resolveUrl('index.html');
    frame.style.cssText = [
      'width:min(960px, 100%)',
      'height:min(760px, 100%)',
      'border:0',
      'border-radius:18px',
      'background:#0f0f0f',
      'box-shadow:0 24px 80px rgba(0,0,0,0.45)',
    ].join(';');
    overlay.appendChild(frame);
    dashboardOverlay = overlay;
    return overlay;
  }

  function openDashboard() {
    const overlay = createDashboard();
    document.documentElement.appendChild(overlay);
  }

  function closeDashboard() {
    dashboardOverlay?.remove();
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== 'onlooker-dashboard') return;

    if (data.type === 'get-settings') {
      event.source?.postMessage({
        channel: 'onlooker-dashboard',
        type: 'settings',
        settings: normalizeSettings(gmGetValue(SETTINGS_KEY, DEFAULT_SETTINGS)),
      }, '*');
      return;
    }

    if (data.type === 'set-settings') {
      const next = normalizeSettings(data.settings);
      const oldValue = gmGetValue(SETTINGS_KEY, DEFAULT_SETTINGS);
      gmSetValue(SETTINGS_KEY, next);
      emitStorageChanges({ [SETTINGS_KEY]: { oldValue, newValue: next } }, 'local');
      event.source?.postMessage({
        channel: 'onlooker-dashboard',
        type: 'settings',
        settings: next,
      }, '*');
      return;
    }

    if (data.type === 'close') {
      closeDashboard();
    }
  });

  ensureChromePolyfill();
  window.__ONLOOKER_HOSTED__ = {
    baseUrl,
    openDashboard,
    closeDashboard,
    dispatchRuntimeMessage,
    getSettings() {
      return normalizeSettings(gmGetValue(SETTINGS_KEY, DEFAULT_SETTINGS));
    },
  };
})();
