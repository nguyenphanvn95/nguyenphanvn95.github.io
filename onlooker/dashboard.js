(function () {
  const DEFAULT_SETTINGS = Object.freeze({
    depth: 5,
    arrowColors: ['#4f8cff', '#2ecc71', '#f1c40f', '#e67e22', '#e74c3c'],
    arrowCount: 2,
    showPanel: true,
  });

  const statusEl = document.getElementById('status');
  const showPanelEl = document.getElementById('showPanel');
  const depthEl = document.getElementById('depth');
  const depthValueEl = document.getElementById('depthValue');
  const arrowCountEl = document.getElementById('arrowCount');
  const arrowCountValueEl = document.getElementById('arrowCountValue');
  const arrowColorValueEl = document.getElementById('arrowColorValue');
  const arrowColorInputs = [1, 2, 3, 4, 5].map((index) => document.getElementById(`arrowColor${index}`));
  const btnRefresh = document.getElementById('btnRefresh');
  const btnClose = document.getElementById('btnClose');
  const btnExport = document.getElementById('btnExport');
  const importFile = document.getElementById('importFile');

  let settings = { ...DEFAULT_SETTINGS };

  function normalizeColor(value, fallback) {
    const color = String(value || '').trim();
    return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const colors = Array.isArray(source.arrowColors) ? source.arrowColors.slice(0, 5) : DEFAULT_SETTINGS.arrowColors.slice();
    while (colors.length < 5) colors.push(DEFAULT_SETTINGS.arrowColors[colors.length]);
    return {
      depth: clampNumber(source.depth, 5, 25, DEFAULT_SETTINGS.depth),
      arrowColors: colors.map((color, index) => normalizeColor(color, DEFAULT_SETTINGS.arrowColors[index])),
      arrowCount: clampNumber(source.arrowCount, 1, 5, DEFAULT_SETTINGS.arrowCount),
      showPanel: source.showPanel !== false,
    };
  }

  function syncUI() {
    showPanelEl.checked = settings.showPanel !== false;
    depthEl.value = String(settings.depth);
    depthValueEl.textContent = String(settings.depth);
    arrowCountEl.value = String(settings.arrowCount);
    arrowCountValueEl.textContent = String(settings.arrowCount);
    arrowColorValueEl.textContent = `${settings.arrowCount} active`;

    arrowColorInputs.forEach((input, index) => {
      if (!input) return;
      input.value = settings.arrowColors[index];
      const card = input.closest('.color-item');
      if (card) card.style.opacity = index < settings.arrowCount ? '1' : '0.45';
    });
  }

  function setStatus(message, tone = 'idle') {
    statusEl.textContent = message;
    statusEl.style.color = tone === 'error' ? '#ff8f8f' : (tone === 'ok' ? '#9ed98f' : '#959595');
    statusEl.style.borderColor = tone === 'error' ? '#5a2020' : (tone === 'ok' ? '#264226' : '#2b2b2b');
    statusEl.style.background = tone === 'error' ? '#1d1010' : (tone === 'ok' ? '#101910' : '#161616');
  }

  function postToParent(type, payload = {}) {
    window.parent?.postMessage({ channel: 'onlooker-dashboard', type, ...payload }, '*');
  }

  function persist() {
    localStorage.setItem('onlooker-dashboard-settings', JSON.stringify(settings));
    postToParent('set-settings', { settings });
    setStatus('Settings saved and pushed to open panels.', 'ok');
  }

  function loadLocalFallback() {
    try {
      const raw = JSON.parse(localStorage.getItem('onlooker-dashboard-settings') || 'null');
      settings = normalizeSettings(raw);
      syncUI();
      setStatus('Loaded local preview settings. Open through the userscript for live sync.', 'idle');
    } catch (_) {
      settings = { ...DEFAULT_SETTINGS };
      syncUI();
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== 'onlooker-dashboard') return;
    if (data.type !== 'settings') return;
    settings = normalizeSettings(data.settings);
    syncUI();
    localStorage.setItem('onlooker-dashboard-settings', JSON.stringify(settings));
    setStatus('Synced with userscript settings.', 'ok');
  });

  showPanelEl.addEventListener('change', () => {
    settings.showPanel = showPanelEl.checked;
    persist();
  });

  depthEl.addEventListener('input', () => {
    settings.depth = clampNumber(depthEl.value, 5, 25, DEFAULT_SETTINGS.depth);
    syncUI();
    persist();
  });

  arrowCountEl.addEventListener('input', () => {
    settings.arrowCount = clampNumber(arrowCountEl.value, 1, 5, DEFAULT_SETTINGS.arrowCount);
    syncUI();
    persist();
  });

  arrowColorInputs.forEach((input, index) => {
    input?.addEventListener('input', () => {
      settings.arrowColors[index] = normalizeColor(input.value, DEFAULT_SETTINGS.arrowColors[index]);
      syncUI();
      persist();
    });
  });

  btnRefresh.addEventListener('click', () => {
    postToParent('get-settings');
    setStatus('Requesting current settings from the userscript…');
  });

  btnClose.addEventListener('click', () => {
    postToParent('close');
  });

  btnExport.addEventListener('click', () => {
    const payload = {
      version: 'userscript-1.0.0',
      exportedAt: new Date().toISOString(),
      settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `onlooker-settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus('Settings exported.', 'ok');
  });

  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      settings = normalizeSettings(parsed?.settings ?? parsed);
      syncUI();
      persist();
      setStatus('Settings imported.', 'ok');
    } catch (_) {
      setStatus('Invalid settings file.', 'error');
    } finally {
      importFile.value = '';
    }
  });

  loadLocalFallback();
  postToParent('get-settings');
})();
