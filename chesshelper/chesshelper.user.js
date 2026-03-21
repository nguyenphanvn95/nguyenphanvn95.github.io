// ==UserScript==
// @name         Chess Helper
// @namespace    https://nguyenphanvn95.github.io/chesshelper
// @version      2.4.0
// @description  Chess engine hints (Stockfish 18) cho chess.com và lichess.org
// @author       Chess Helper
// @match        *://*.chess.com/*
// @match        *://*.lichess.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      nguyenphanvn95.github.io
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ================================================================
     CONFIG
  ================================================================ */
  const BASE        = 'https://nguyenphanvn95.github.io/chesshelper';
  const LIB_BASE    = BASE + '/lib';
  const IMG_BASE    = BASE + '/images/wizardChess';
  const SETTING_URL = BASE + '/setting.html';

  const w   = unsafeWindow || window;
  const doc = (unsafeWindow && unsafeWindow.document) || document;

  /* ================================================================
     ENGINE — Blob Worker (bypass cross-origin restriction)
     Pattern đã được kiểm chứng từ Chess Killer userscript
  ================================================================ */
  function gmFetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url,
        onload: r => r.status >= 200 && r.status < 400 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)),
        onerror: () => reject(new Error('Fetch failed: ' + url)),
      });
    });
  }

  async function createBlobWorker(workerUrl) {
    const text = await gmFetchText(workerUrl);
    // Replace resolveLib to use absolute GitHub Pages URL
    // Also handle possible broken legacy payload containing stray `} catch` blocks
    let patched = text
    const resolveLibBlock = /function\s+resolveLib\s*\([^)]*\)\s*\{[\s\S]*?self\.Module\s*=\s*self\.Module/;
    if (resolveLibBlock.test(text)) {
      patched = text.replace(resolveLibBlock, `function resolveLib(file) {
        try {
          var name = String(file || '').split('/').pop() || file;
          return '${LIB_BASE}/' + name;
        } catch (err) {
          // Fall through to relative URL.
        }
        return new URL(file, self.location.href).href;
      }\n\n      self.Module = self.Module`);
    } else {
      patched = text.replace(
        /function resolveLib\s*\([^)]*\)\s*\{[\s\S]*?\}/,
        `function resolveLib(file) {
          var name = String(file || '').split('/').pop() || file;
          return '${LIB_BASE}/' + name;
        }`
      );
    }
    const blob = new Blob([patched], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    const worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);
    return worker;
  }

  /* ================================================================
     ENGINE HOST — runs directly in Tampermonkey sandbox
     Mirrors EngineHostClient from content.js but without chrome APIs
  ================================================================ */
  const ENGINE_HOST_CHANNEL = 'chess-helper-engine-host';

  class EngineHostClient {
    constructor(key) {
      this.key = key || 'main';
      this.worker = null;
      this.ready = false;
      this.sentUci = false;
      this.sentIsReady = false;
      this.queue = [];
      this.currentJob = null;
      this.lastConfigKey = '';
      this._readyResolve = null;
      this._readyReject = null;
      this._readyPromise = null;
      this._bootTimer = null;
      this._starting = false;
      this._readyAttempts = 0;
      this.resetReadyPromise();
      this.start();
    }

    resetReadyPromise() {
      this._readyPromise = new Promise((res, rej) => { this._readyResolve = res; this._readyReject = rej; });
    }

    resetHost() {
      if (this._bootTimer) { clearTimeout(this._bootTimer); this._bootTimer = null; }
      this.ready = false;
      this.sentUci = false;
      this.sentIsReady = false;
      this.queue = [];
      this.currentJob = null;
      if (this.worker) {
        try { this.worker.terminate(); } catch (e) {
          console.warn('[Chess Helper] Worker terminate failed', e);
        }
        this.worker = null;
      }
      this._starting = false;
      this.resetReadyPromise();
    }

    async start() {
      if (this._starting) return;
      this._starting = true;
      this._readyAttempts = 0;
      this.resetHost();
      this._starting = true;
      try {
        const ew = await createBlobWorker(LIB_BASE + '/stockfish-worker.js');
        this.worker = ew;
        ew.onmessage = (e) => this._onLine(typeof e.data === 'string' ? e.data : String(e.data || ''));
        ew.onerror = (err) => {
          console.warn('[Chess Helper] Worker error:', err?.message);
          if (!this.ready && this._readyReject) { this._readyReject(new Error(err?.message || 'Worker error')); }
          if (this.currentJob) { this.currentJob.reject(new Error(err?.message || 'Worker error')); this.currentJob = null; }
        };
        clearTimeout(this._bootTimer);
        this._bootTimer = setTimeout(() => {
          if (!this.ready && this._readyReject) this._readyReject(new Error('Engine timeout'));
        }, 12000);
        ew.postMessage('uci');
      } catch (err) {
        console.error('[Chess Helper] createBlobWorker failed:', err);
        if (this._readyReject) this._readyReject(err);
        this._starting = false;
      }
    }

    _onLine(line) {
      if (!line) return;
      console.log('[Chess Helper] [Engine] host:line', { frameKey: this.key, line });
      // Forward line to the content script's message handler via window.postMessage
      // This reuses the existing EngineHostClient.handleLine() in content.js
      // BUT content.js's EngineHostClient.installListener() filters by frame.contentWindow
      // So we can't use postMessage channel. Instead we directly call our own handleLine.
      this._handleEngineMsg(line);

      if (!this.sentUci && /uciok/.test(line)) {
        this.sentUci = true;
        if (!this.sentIsReady) { this.sentIsReady = true; this.worker.postMessage('isready'); }
      }
      if (/readyok/.test(line) && !this.ready) {
        clearTimeout(this._bootTimer);
        this.ready = true;
        this._readyResolve(true);
        this._flushQueue();
        console.log('[Chess Helper] Engine ready');
      }
    }

    _handleEngineMsg(line) {
      const job = this.currentJob;
      if (!job) return;
      if (line.startsWith('bestmove ')) {
        const parts = line.split(/\s+/);
        const bestmove = parts[1] || null;
        const byMultipv = [...job.lines.values()]
          .filter(e => e && e.uci)
          .sort((a, b) => (a.multipv || 0) - (b.multipv || 0));
        const primary = byMultipv[0] || (bestmove ? { uci: bestmove, san: bestmove, score: null, multipv: 1 } : null);
        clearTimeout(job.timer);
        this.currentJob = null;
        job.resolve(primary ? {
          ok: true,
          bestmove: primary.uci || bestmove,
          uci: primary.uci || bestmove,
          san: primary.san || primary.uci || bestmove,
          bestmoveUci: primary.uci || bestmove,
          bestmoveSan: primary.san || primary.uci || bestmove,
          score: primary.score || null,
          lines: byMultipv.map(({ multipv: _m, ...rest }) => rest),
        } : { ok: true, bestmove: bestmove || null, lines: [] });
        return;
      }
      if (!line.startsWith('info ')) return;
      const tokens = line.split(/\s+/);
      const pvIdx = tokens.indexOf('pv');
      if (pvIdx < 0 || pvIdx + 1 >= tokens.length) return;
      const uci = tokens[pvIdx + 1];
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return;
      const mpIdx = tokens.indexOf('multipv');
      const multipv = mpIdx >= 0 ? parseInt(tokens[mpIdx + 1], 10) : 1;
      const scIdx = tokens.indexOf('score');
      let score = null;
      if (scIdx >= 0 && scIdx + 2 < tokens.length) {
        const t = tokens[scIdx + 1], v = parseInt(tokens[scIdx + 2], 10);
        if ((t === 'cp' || t === 'mate') && Number.isFinite(v)) score = { type: t, value: v };
      }
      job.lines.set(Number.isFinite(multipv) ? multipv : 1, {
        multipv: Number.isFinite(multipv) ? multipv : 1, uci, san: uci, score,
      });
    }

    post(cmd) {
      if (!this.worker || !this.ready) { this.queue.push(cmd); return; }
      this.worker.postMessage(cmd);
    }

    _flushQueue() {
      if (!this.ready || !this.queue.length) return;
      this.queue.splice(0).forEach(c => this.post(c));
    }

    async ensureReady(timeoutMs) {
      timeoutMs = Math.max(8000, timeoutMs || 8000);
      const startedAt = Date.now();
      this._readyAttempts = this._readyAttempts || 0;
      console.log('[Chess Helper] [Engine] host:ensure-ready', {
        frameKey: this.key,
        attempt: this._readyAttempts + 1,
        timeoutMs,
        ready: this.ready,
      });

      if (this.ready) {
        console.log('[Chess Helper] [Engine] host:already-ready', { frameKey: this.key });
        this._readyAttempts = 0;
        return;
      }

      if (this._readyAttempts >= 2) {
        throw new Error('engine_host_ready_timeout');
      }

      this._readyAttempts += 1;

      try {
        await Promise.race([
          this._readyPromise,
          new Promise((_, rej) => setTimeout(() => {
            const err = new Error('engine_host_ready_timeout');
            console.error('[Chess Helper] [Engine] host:ready-timeout', {
              frameKey: this.key,
              attempt: this._readyAttempts,
              timeoutMs,
              elapsedMs: Date.now() - startedAt,
              ready: this.ready,
            });
            rej(err);
          }, timeoutMs))
        ]);

        console.log('[Chess Helper] [Engine] host:ready-complete', { frameKey: this.key, attempt: this._readyAttempts, elapsedMs: Date.now() - startedAt });
        this._readyAttempts = 0;
        return;
      } catch (err) {
        console.warn('[Chess Helper] [Engine] host:ready-failed', { frameKey: this.key, attempt: this._readyAttempts, error: err?.message });
        if (this._readyAttempts < 2) {
          console.log('[Chess Helper] [Engine] host:retrying', { frameKey: this.key, attempt: this._readyAttempts + 1 });
          this.resetHost();
          await this.start();
          return this.ensureReady(timeoutMs);
        }
        throw err;
      }
    }

    async analyze(fen, { depth, multipv, timeoutMs, styleMode }) {
      await this.ensureReady(Math.max(4000, timeoutMs));
      if (this.currentJob) {
        try { this.post('stop'); } catch {}
        clearTimeout(this.currentJob.timer);
        this.currentJob.reject(new Error('search_replaced'));
        this.currentJob = null;
      }
      return new Promise((resolve, reject) => {
        this.currentJob = { fen, depth, multipv, styleMode, resolve, reject, lines: new Map(), timer: null };
        const configKey = String(multipv);
        if (configKey !== this.lastConfigKey) {
          this.post(`setoption name MultiPV value ${multipv}`);
          this.lastConfigKey = configKey;
        }
        this.post('ucinewgame');
        this.post(`position fen ${fen}`);
        this.post(`go depth ${depth}`);
        this.currentJob.timer = setTimeout(() => {
          if (!this.currentJob) return;
          try { this.post('stop'); } catch {}
          const fallback = [...this.currentJob.lines.values()].filter(e => e?.uci).sort((a, b) => (a.multipv || 0) - (b.multipv || 0));
          const job = this.currentJob; this.currentJob = null;
          if (fallback.length) {
            job.resolve({ ok: true, bestmove: fallback[0].uci, uci: fallback[0].uci, san: fallback[0].uci, bestmoveUci: fallback[0].uci, bestmoveSan: fallback[0].uci, score: fallback[0].score || null, lines: fallback.map(({multipv: _m, ...r}) => r) });
          } else {
            job.reject(new Error('engine_timeout'));
          }
        }, Math.max(1500, timeoutMs));
      });
    }
  }

  /* ================================================================
     SHARED ENGINE INSTANCES
     (content.js creates one via getSharedEngineHost(), we mirror it)
  ================================================================ */
  let _mainHost = null;
  let _reviewHost = null;

  const getSharedEngineHost = () => { if (!_mainHost) _mainHost = new EngineHostClient('main'); return _mainHost; };
  const getReviewEngineHost = () => { if (!_reviewHost) _reviewHost = new EngineHostClient('review'); return _reviewHost; };

  /* ================================================================
     STORAGE SHIM — localStorage (same as setting.html uses)
     content.js uses localStorage directly, so no chrome.storage needed
  ================================================================ */
  const chromeStorageShim = {
    local: {
      _cache: new Map(),
      get(keys, cb) {
        const result = {};
        for (const k of (Array.isArray(keys) ? keys : [keys])) {
          try { const raw = localStorage.getItem('_ch_cache_' + k); if (raw != null) result[k] = JSON.parse(raw); } catch {}
        }
        if (cb) cb(result);
        return Promise.resolve(result);
      },
      set(data, cb) {
        for (const [k, v] of Object.entries(data)) {
          try { localStorage.setItem('_ch_cache_' + k, JSON.stringify(v)); } catch {}
        }
        if (cb) cb();
        return Promise.resolve();
      },
      remove(keys, cb) {
        for (const k of (Array.isArray(keys) ? keys : [keys])) {
          try { localStorage.removeItem('_ch_cache_' + k); } catch {}
        }
        if (cb) cb();
      },
    },
    onChanged: { addListener() {} },
    runtime: {
      lastError: null,
      getURL(path) {
        path = String(path || '');
        // Map extension paths to GitHub Pages paths
        if (path.startsWith('lib/')) return BASE + '/' + path;
        if (path.startsWith('images/')) return BASE + '/' + path;
        if (path.startsWith('icons/')) return BASE + '/' + path;
        return BASE + '/' + path;
      },
      sendMessage(msg, cb) {
        // background.js only handles __fen_stockfish_open_review__ → open chrome store URL
        // In userscript we can ignore or open setting page instead
        if (cb) cb({ ok: false });
      },
      onMessage: { addListener() {} },
    },
  };

  /* ================================================================
     LICHESS BRIDGE — inject into page MAIN world so it can access
     Lichess's internal WebSocket and chessground
  ================================================================ */
  function injectLichessBridge() {
    if (w.location.hostname.includes('lichess') && !doc.getElementById('__ch_lichess_bridge__')) {
      // Fetch bridge code and inject as script tag into page using Blob URL (CSP-safe)
      gmFetchText(BASE + '/lichess-page-bridge.js').then(code => {
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const s = doc.createElement('script');
        s.id = '__ch_lichess_bridge__';
        s.src = blobUrl;
        s.onload = () => { URL.revokeObjectURL(blobUrl); };
        (doc.head || doc.documentElement).appendChild(s);
        console.log('[Chess Helper] Lichess bridge injected');
      }).catch(err => {
        console.warn('[Chess Helper] Could not load lichess bridge:', err);
      });
    }
  }

  /* ================================================================
     CONTEXT USER ID PROBE for chess.com
  ================================================================ */
  function injectContextProbe() {
    if (!w.location.hostname.includes('chess.com')) return;
    if (doc.getElementById('__ch_context_user_probe__')) return;
    const code = `(function(){
      var post = function() {
        try {
          var id = window.context && window.context.user && window.context.user.id;
          var username = window.context && window.context.user && window.context.user.username;
          window.postMessage({ __chess_helper_type: '__CHESSCOM_CONTEXT_USER_ID__', userId: id||null, username: username||null }, '*');
        } catch(_) {}
      };
      post(); setInterval(post, 3000);
    })();`;
    const s = doc.createElement('script');
    s.id = '__ch_context_user_probe__';
    s.textContent = code;
    (doc.head || doc.documentElement).appendChild(s);
  }

  /* ================================================================
     WIZARD CHESS — image URLs from GitHub Pages
  ================================================================ */
  function getWizardImageUrl(color, piece) {
    return `${IMG_BASE}/${color}/${piece}.png`;
  }

  /* ================================================================
     PATCH CONTENT.JS DEPENDENCIES
     content.js calls: chrome.runtime.getURL, chrome.storage.local,
     getSharedEngineHost(), getReviewEngineHost(), window.postMessage lichess bridge
     We patch window.chrome and the engine host functions
  ================================================================ */
  function patchPageEnvironment() {
    // Set chrome shim on unsafeWindow (page context)
    // content.js runs in page context (no injection), so we need
    // to make chrome available there. Since we use inject via <script>,
    // we set it on w (unsafeWindow) before injecting content.js.
    try {
      if (!w.chrome || !w.chrome.storage) {
        Object.defineProperty(w, 'chrome', {
          value: {
            storage: chromeStorageShim,
            runtime: chromeStorageShim.runtime,
          },
          writable: true, configurable: true,
        });
      } else {
        // chess.com has real chrome — patch only what we need
        if (!w.chrome.storage?.local?.get) {
          w.chrome.storage = chromeStorageShim;
        }
      }
    } catch (e) {
      console.warn('[Chess Helper] chrome patch:', e.message);
    }
  }

  /* ================================================================
     INJECT CONTENT.JS
     content.js is a self-contained IIFE. We fetch it and inject it
     into the page. The engine host is provided by our EngineHostClient
     above via a special bridge on window.
  ================================================================ */

  // Bridge: content.js calls getSharedEngineHost() and getReviewEngineHost()
  // These are module-level functions defined inside content.js's IIFE.
  // We can't override them from outside.
  // 
  // SOLUTION: Instead of injecting content.js as-is, we patch it before injection:
  // Replace the EngineHostClient.ensureFrame() method to use our Blob-based engine
  // by overriding the iframe src with a Blob iframe that routes to our worker.

  async function fetchAndPatchContentJs() {
    const code = await gmFetchText(BASE + '/content.js');

    // Patch 1: Replace chrome.runtime.getURL('engine_host.html') with Blob iframe
    // The EngineHostClient.ensureFrame() creates an iframe with src = engine_host.html
    // We replace it with our blob-based engine host URL

    const engineHostBlob = createEngineHostBlob();

    let patched = code;

    // Patch engine_host.html URL → our blob engine host
    patched = patched.replace(
      /getExtensionUrl\s*\(\s*['"]engine_host\.html['"]\s*\)/g,
      JSON.stringify(engineHostBlob)
    );

    // Patch images/wizardChess → GitHub Pages URL
    patched = patched.replace(
      /chrome\.runtime\.getURL\s*\(\s*`images\/wizardChess\/\$\{([^}]+)\}\.png`\s*\)/g,
      `('${IMG_BASE}/' + $1 + '.png')`
    );
    // Also handle string concat form
    patched = patched.replace(
      /chrome\.runtime\.getURL\s*\(\s*['"]images\/wizardChess\/(.*?)['"]\s*\)/g,
      `'${IMG_BASE}/$1'`
    );

    // Patch context-userid-probe.js injection → use our inline version
    // content.js tries to create a <script src="context-userid-probe.js">
    // Replace with inline probe code
    patched = patched.replace(
      /s\.src\s*=\s*chrome\.runtime\.getURL\s*\(\s*['"]context-userid-probe\.js['"]\s*\)/g,
      `s.textContent = ${JSON.stringify(`(function(){
        var post = function() {
          try {
            var id = window.context && window.context.user && window.context.user.id;
            var username = window.context && window.context.user && window.context.user.username;
            window.postMessage({ __chess_helper_type: '__CHESSCOM_CONTEXT_USER_ID__', userId: id||null, username: username||null }, '*');
          } catch(_) {}
        };
        post(); setInterval(post, 3000);
      })();`)}; s.src = ''`
    );

    // Patch any remaining chrome.runtime.getURL calls
    patched = patched.replace(
      /chrome\.runtime\.getURL\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
      (_, q, path) => JSON.stringify(`${BASE}/${path}`)
    );

    return patched;
  }

  function createEngineHostBlob() {
    // This blob iframe hosts the Stockfish worker using our patched worker URL
    const script = `
'use strict';
var CHANNEL = 'chess-helper-engine-host';
var worker = null, hostReady = false, sentUci = false, sentIsReady = false;
var bootTimer = null, queue = [];

function post(type, extra) {
  window.parent.postMessage(Object.assign({ channel: CHANNEL, type: type }, extra || {}), '*');
}

function flushQueue() {
  if (!worker || !hostReady || !queue.length) return;
  queue.splice(0).forEach(function(cmd) { worker.postMessage(cmd); });
}

function markReady() {
  if (hostReady) return;
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  hostReady = true;
  post('ready', { engine: 'stockfish' });
  flushQueue();
}

// Fetch worker JS and create Blob Worker (bypass cross-origin restriction)
fetch('${LIB_BASE}/stockfish-worker.js')
  .then(function(r) { return r.text(); })
  .then(function(text) {
    // Best-effort fix old broken resolveLib code (extra } catch in payload)
    var patched;
    var resolveLibBlock = /function\s+resolveLib\s*\([^)]*\)\s*\{[\s\S]*?self\.Module\s*=\s*self\.Module/;
    if (resolveLibBlock.test(text)) {
      patched = text.replace(resolveLibBlock,
        'function resolveLib(file) {\n' +
        '  try {\n' +
        '    var name = String(file || "").split("/").pop() || file;\n' +
        '    return "${LIB_BASE}/" + name;\n' +
        '  } catch (err) {\n' +
        '    // Fall through to relative URL.\n' +
        '  }\n' +
        '  return new URL(file, self.location.href).href;\n' +
        '}\n\n' +
        '      self.Module = self.Module');
    } else {
      patched = text.replace(
        /function resolveLib\s*\([^)]*\)\s*\{[\s\S]*?\}/,
        'function resolveLib(file) { var name = String(file||"").split("/").pop()||file; return "${LIB_BASE}/" + name; }'
      );
    }
    var blob = new Blob([patched], { type: 'application/javascript' });
    var blobUrl = URL.createObjectURL(blob);
    worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);

    worker.onmessage = function(e) {
      var line = typeof e.data === 'string' ? e.data : String(e.data || '');
      post('engine-message', { line: line });
      if (!sentUci && /uciok/.test(line)) {
        sentUci = true;
        if (!sentIsReady) { sentIsReady = true; worker.postMessage('isready'); }
      }
      if (/readyok/.test(line)) markReady();
    };
    worker.onerror = function(err) {
      post('worker-error', { message: err && err.message || 'Worker error' });
    };
    bootTimer = setTimeout(function() {
      post('worker-error', { message: 'Engine timeout' });
    }, 12000);
    worker.postMessage('uci');
  })
  .catch(function(err) {
    post('worker-error', { message: String(err) });
  });


window.addEventListener('message', function(e) {
  if (!e.data || e.data.channel !== CHANNEL || e.data.type !== 'command') return;
  var cmd = String(e.data.command || '').trim();
  if (!cmd) return;
  if (!worker || !hostReady) { queue.push(cmd); return; }
  worker.postMessage(cmd);
});
`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>${script}<\/script></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }

  /* ================================================================
     MAIN BOOT
  ================================================================ */
  async function boot() {
    console.log('[Chess Helper] Booting...');

    // Inject lichess bridge into page MAIN world
    injectLichessBridge();

    // Patch chrome on the page
    patchPageEnvironment();

    // Fetch and patch content.js, then inject
    try {
      const patched = await fetchAndPatchContentJs();
      const blob = new Blob([patched], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const s = doc.createElement('script');
      s.id = '__ch_content_script__';
      s.src = blobUrl;
      s.onload = () => { URL.revokeObjectURL(blobUrl); };
      (doc.head || doc.documentElement).appendChild(s);
      console.log('[Chess Helper] Content script injected');
    } catch (err) {
      console.error('[Chess Helper] Failed to load content script:', err);
    }
  }

  if (doc.body) {
    boot();
  } else {
    const t = setInterval(() => { if (doc.body) { clearInterval(t); boot(); } }, 50);
  }

})();
