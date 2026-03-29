'use strict';

const DEFAULT_ENG_DEPTH = 5;
const DEFAULT_MULTI_PV = 2;
const ENGINE_BOOT_TIMEOUT_MS = 8000;
const ENGINES = [
  {
    id: 'komodoro',
    scriptUrl: chrome.runtime.getURL('engine/komodoro.js'),
    wasmUrl: chrome.runtime.getURL('engine/komodoro.wasm'),
  },
  {
    id: 'stockfish',
    scriptUrl: chrome.runtime.getURL('engine/stockfish-worker.js'),
    wasmUrl: chrome.runtime.getURL('engine/stockfish.wasm'),
  },
];

let worker = null;
let ready = false;
let booting = false;
let sentUci = false;
let sentIsReady = false;
let activeEngine = null;
let currentJob = null;
let queuedJob = null;
let bootTimer = null;
let infoLines = {};
let analysisPhase = 0;
let analysisTurn1 = 'w';
let analysisFen2 = null;
let analysisRes1 = null;
let analysisRes2 = null;
let engineDebugLines = [];

const MAX_DEBUG_LINES = 60;

function clearBootTimer() {
  if (!bootTimer) return;
  clearTimeout(bootTimer);
  bootTimer = null;
}

function resolveEngineFile(file) {
  return chrome.runtime.getURL('engine/' + file);
}

function resetEngineState() {
  ready = false;
  sentUci = false;
  sentIsReady = false;
  clearBootTimer();
}

function terminateWorker() {
  try { worker?.terminate?.(); } catch (_) {}
  worker = null;
}

function resetDebugLines() {
  engineDebugLines = [];
}

function pushDebugLine(line) {
  if (!line) return;
  engineDebugLines.push(line);
  if (engineDebugLines.length > MAX_DEBUG_LINES) {
    engineDebugLines.splice(0, engineDebugLines.length - MAX_DEBUG_LINES);
  }
}

function notifyError(requestId, error) {
  if (!requestId) return;
  chrome.runtime.sendMessage({
    action: 'engineAnalyseResult',
    requestId,
    success: false,
    error,
    engine: activeEngine?.id || '',
    debugLines: engineDebugLines.slice(),
  });
}

function notifySuccess(requestId, white, black, whiteLines, blackLines, engine) {
  chrome.runtime.sendMessage({
    action: 'engineAnalyseResult',
    requestId,
    success: true,
    white,
    black,
    whiteLines,
    blackLines,
    engine,
    debugLines: engineDebugLines.slice(),
  });
}

function normalizeEngineLines(chunk) {
  return String(chunk || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function createWorkerFromEngine(engine) {
  if (engine.id === 'stockfish') {
    return new Worker(engine.scriptUrl);
  }

  const engineBaseUrl = resolveEngineFile('');
  const blob = new Blob([
    `self.Module=self.Module||{};` +
    `self.Module.wasmBinaryFile=${JSON.stringify(engine.wasmUrl)};` +
    `self.Module.mainScriptUrlOrBlob=${JSON.stringify(engine.scriptUrl)};` +
    `self.Module.locateFile=function(path){` +
      `var name=String(path||'').split('/').pop();` +
      `if(name==='komodoro-worker.wasm'||name==='engine.wasm')name='komodoro.wasm';` +
      `return ${JSON.stringify(engineBaseUrl)}+name;` +
    `};` +
    `try{self.fetch=undefined;}catch(_){}` +
    `importScripts(${JSON.stringify(engine.scriptUrl)});`
  ], { type: 'application/javascript' });

  const blobUrl = URL.createObjectURL(blob);
  const createdWorker = new Worker(blobUrl);
  URL.revokeObjectURL(blobUrl);
  return createdWorker;
}

function queueJob(requestId, fen, options = {}) {
  const depth = clampNumber(options.depth, 5, 25, DEFAULT_ENG_DEPTH);
  const multiPv = clampNumber(options.multiPv, 1, 5, DEFAULT_MULTI_PV);
  queuedJob = { requestId, fen, depth, multiPv };
  if (!worker) startWorker(0);
  if (ready && !currentJob) runNextJob();
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function finishCurrentJobWithError(error) {
  const requestId = currentJob?.requestId || queuedJob?.requestId;
  currentJob = null;
  queuedJob = null;
  analysisPhase = 0;
  notifyError(requestId, error);
}

function runNextJob() {
  if (!ready || currentJob || !queuedJob || !worker) return;

  currentJob = queuedJob;
  queuedJob = null;
  resetDebugLines();
  infoLines = {};
  analysisPhase = 1;
  analysisTurn1 = currentJob.fen.split(' ')[1] || 'w';
  analysisFen2 = swapTurnInFen(currentJob.fen);
  analysisRes1 = null;
  analysisRes2 = null;

  worker.postMessage('stop');
  setTimeout(() => {
    worker.postMessage('setoption name MultiPV value ' + currentJob.multiPv);
    worker.postMessage('position fen ' + currentJob.fen);
    worker.postMessage('go depth ' + currentJob.depth);
  }, 40);
}

function startWorker(engineIndex = 0) {
  if (engineIndex >= ENGINES.length) {
    booting = false;
    resetEngineState();
    terminateWorker();
    finishCurrentJobWithError('No available offline engine could be started');
    return;
  }

  const engine = ENGINES[engineIndex];
  activeEngine = engine;
  booting = true;
  resetEngineState();
  terminateWorker();

  const fallbackToNext = (message) => {
    clearBootTimer();
    terminateWorker();
    const nextEngine = ENGINES[engineIndex + 1];
    if (!nextEngine) {
      booting = false;
      finishCurrentJobWithError(message);
      return;
    }
    startWorker(engineIndex + 1);
  };

  try {
    worker = createWorkerFromEngine(engine);

    worker.onmessage = (event) => {
      for (const line of normalizeEngineLines(event.data)) {
        pushDebugLine(line);
        if (!ready && /Aborted\(\)/.test(line)) {
          fallbackToNext(`${engine.id} aborted during startup`);
          return;
        }

        if (!sentUci && /(^|\s)uciok(\s|$)/.test(line)) {
          sentUci = true;
          if (!sentIsReady) {
            sentIsReady = true;
            worker.postMessage('isready');
          }
        }

        if (/(^|\s)readyok(\s|$)/.test(line)) {
          booting = false;
          clearBootTimer();
          ready = true;
          runNextJob();
          continue;
        }

        handleEngineLine(line);
      }
    };

    worker.onerror = (error) => {
      const message = error?.message || `Worker error in ${engine.id}`;
      if (booting || !ready) {
        fallbackToNext(message);
        return;
      }
      terminateWorker();
      ready = false;
      booting = false;
      finishCurrentJobWithError(message);
    };

    bootTimer = setTimeout(() => {
      fallbackToNext(`${engine.id} ready timeout`);
    }, ENGINE_BOOT_TIMEOUT_MS);

    worker.postMessage('uci');
  } catch (err) {
    fallbackToNext(String(err));
  }
}

function handleEngineLine(line) {
  if (!currentJob) return;

  if (line.startsWith('info ')) {
    handleEngineInfo(line);
    return;
  }

  if (!line.startsWith('bestmove')) return;

  const parts = line.split(/\s+/);
  const bestmove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
  const bestEntry = infoLines[1] || null;
  const move = bestmove || bestEntry?.move || null;
  const cp = bestEntry?.cp ?? null;

  if (analysisPhase === 1) {
    analysisRes1 = collectResultSet(analysisTurn1, move, cp);
    analysisPhase = 2;
    infoLines = {};
    setTimeout(() => {
      worker.postMessage('position fen ' + analysisFen2);
      worker.postMessage('go depth ' + currentJob.depth);
    }, 40);
    return;
  }

  if (analysisPhase === 2) {
    const turn2 = analysisTurn1 === 'w' ? 'b' : 'w';
    analysisRes2 = collectResultSet(turn2, move, cp);

    const requestId = currentJob.requestId;
    const engineId = activeEngine?.id || '';
    const whiteTop = analysisRes1?.turn === 'w' ? analysisRes1.top : analysisRes2?.top || null;
    const blackTop = analysisRes1?.turn === 'b' ? analysisRes1.top : analysisRes2?.top || null;
    const whiteLines = analysisRes1?.turn === 'w' ? analysisRes1.lines : analysisRes2?.lines || [];
    const blackLines = analysisRes1?.turn === 'b' ? analysisRes1.lines : analysisRes2?.lines || [];
    currentJob = null;
    analysisPhase = 0;
    notifySuccess(requestId, whiteTop, blackTop, whiteLines, blackLines, engineId);
    runNextJob();
  }
}

function collectResultSet(turn, fallbackMove, fallbackCp) {
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

  return {
    turn,
    top: lines[0] || null,
    lines,
  };
}

function handleEngineInfo(line) {
  if (line.includes('info string')) return;
  const pvM = line.match(/\bpv\s+(\S+)/);
  if (!pvM) return;
  const cpM = line.match(/\bscore cp\s+(-?\d+)/);
  const mateM = line.match(/\bscore mate\s+(-?\d+)/);
  const mvM = line.match(/\bmultipv\s+(\d+)/);
  const depM = line.match(/\bdepth\s+(\d+)/);
  const mpv = mvM ? Number(mvM[1]) : 1;
  const cp = cpM ? Number(cpM[1]) : (mateM ? (Number(mateM[1]) > 0 ? 99999 : -99999) : 0);
  const depth = depM ? Number(depM[1]) : 0;
  infoLines[mpv] = { move: pvM[1], cp, depth };
}

function swapTurnInFen(fen) {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  return parts.join(' ');
}

function toWhitePerspective(cp, side) {
  return side === 'w' ? cp : -cp;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'engineAnalyse' && msg.requestId && msg.fen) {
    queueJob(msg.requestId, msg.fen, {
      depth: msg.depth,
      multiPv: msg.multiPv,
    });
  }
});
