'use strict';

const CHANNEL = 'fen-engine-host';
const BOOT_TIMEOUT = 8000;
const ENGINE_BASE_URL = new URL('./', self.location.href).href;

const ENGINES = [
  { id: 'komodoro',  script: 'komodoro-worker.js',  wasm: 'komodoro.wasm'  },
];

let worker = null;
let ready = false;
let uciOk = false;
let activeIdx = 0;
let bootTimer = null;
const queue = [];

function url(f) { return new URL(f, ENGINE_BASE_URL).href; }

function toParent(type, extra = {}) {
  window.parent.postMessage({ channel: CHANNEL, type, ...extra }, '*');
}

function flush() {
  if (!worker || !ready) return;
  queue.splice(0).forEach(cmd => worker.postMessage(cmd));
}

function markReady() {
  if (ready) return;
  clearTimeout(bootTimer);
  ready = true;
  toParent('ready', { engine: ENGINES[activeIdx]?.id });
  flush();
}

function killWorker() {
  try { worker?.terminate(); } catch (_) {}
  worker = null;
}

function boot(idx) {
  if (idx >= ENGINES.length) {
    toParent('error', { msg: 'No engine could start' });
    return;
  }
  const eng = ENGINES[idx];
  activeIdx = idx;
  ready = false; uciOk = false;
  clearTimeout(bootTimer);
  killWorker();

  const fallback = (msg) => {
    clearTimeout(bootTimer);
    killWorker();
    if (idx + 1 < ENGINES.length) {
      toParent('fallback', { from: eng.id, to: ENGINES[idx+1].id });
      boot(idx + 1);
    } else {
      toParent('error', { msg });
    }
  };

  try {
    if (eng.id === 'komodoro') {
      // Komodoro needs Module patched before import
      const blob = new Blob([
        `self.Module={locateFile:(p)=>p.endsWith('.wasm')?${JSON.stringify(url(eng.wasm))}:p};` +
        `importScripts(${JSON.stringify(url(eng.script))});`
      ], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      worker = new Worker(blobUrl);
      URL.revokeObjectURL(blobUrl);
    } else {
      worker = new Worker(url(eng.script));
    }

    worker.onmessage = (e) => {
      const line = String(e.data || '');
      toParent('line', { line });
      if (!uciOk && /\buciok\b/.test(line)) {
        uciOk = true;
        worker.postMessage('isready');
      }
      if (/\breadyok\b/.test(line)) {
        markReady();
      }
    };

    worker.onerror = (err) => {
      if (!ready) fallback(err?.message || 'worker error');
      else toParent('error', { msg: err?.message });
    };

    bootTimer = setTimeout(() => fallback(eng.id + ' timeout'), BOOT_TIMEOUT);
    worker.postMessage('uci');

  } catch (err) {
    fallback(String(err));
  }
}

window.addEventListener('message', (e) => {
  if (!e.data || e.data.channel !== CHANNEL || e.data.type !== 'cmd') return;
  const cmd = String(e.data.cmd || '').trim();
  if (!cmd) return;
  if (!worker || !ready) { queue.push(cmd); return; }
  worker.postMessage(cmd);
});

boot(0);
