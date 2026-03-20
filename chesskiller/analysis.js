
// [USERSCRIPT PATCH]
(function(){
  const _BASE = (typeof window !== 'undefined' && window.__CK_BASE_URL__) || 'https://nguyenphanvn95.github.io/chesskiller';
  window._ckAssetUrl = window._ckAssetUrl || function(path) {
    path = String(path || '');
    path = path.replace(/^(?:modules\/lib\/)/, 'lib/');
    path = path.replace(/^(?:modules\/)?/, '');
    path = path.replace(/^photo\//, 'media/photo/');
    path = path.replace(/^audio\//, 'media/audio/');
    return _BASE + '/' + path;
  };
})();
'use strict';
/* ================================================================
   CONSTANTS
================================================================ */
const FILES = 8, RANKS = 8;

const assetUrl = path => (window.chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : path);

// Piece images from photo/ folder
const IMGS = {
  wK:assetUrl('photo/wK.svg'), wQ:assetUrl('photo/wQ.svg'), wR:assetUrl('photo/wR.svg'),
  wB:assetUrl('photo/wB.svg'), wN:assetUrl('photo/wN.svg'), wP:assetUrl('photo/wP.svg'),
  bK:assetUrl('photo/bK.svg'), bQ:assetUrl('photo/bQ.svg'), bR:assetUrl('photo/bR.svg'),
  bB:assetUrl('photo/bB.svg'), bN:assetUrl('photo/bN.svg'), bP:assetUrl('photo/bP.svg'),
};

// SAN piece names
const SAN = {p:'',n:'N',b:'B',r:'R',q:'Q',k:'K'};

const ENG_LINES = [
  ['c4','e5'],['d4','Nf6'],['Nf3','d5'],['e3','c5'],
  ['Nc3','Bb4'],['g3','O-O'],['Bg5','h6'],['Bh4','g5'],
];

/* ================================================================
   STATE
================================================================ */
// UI state, board state, and engine state are kept together because this page
// is a single-file app with no external state manager.
let board = [], sel = null, turn = 'w', flipped = false;
let hist = [], states = [], hIdx = -1;
let evalV = 0.5, engOn = true;
let CS = 64;   // cell size in px
let engTimer = null, engDepthV = 18;
let engineWorker = null;
let engineReady = false;
let engineUciReady = false;
let engineBusy = false;
let engineStopped = true;
let engineLines = new Map();
let engineBestMove = null;
let engineRequestSeq = 0;
let engineLastNps = 0;
let engineLastSelDepth = 0;
let engineIsInfinite = true;
let enginePendingRequest = null;
let engineOptionsSent = false;
let engineHandshakeTimer = null;
let engineBootCount = 0;
const engineCandidates = ['modules/lib/komodoro-worker.js', 'modules/lib/stockfish-worker.js'];
let engineCandidateIndex = 0;
let engineActiveScript = engineCandidates[0];
let engineAwaitingReadyReason = null;
let engineCurrentFen = null;
let currentEvalEntry = null;
let baseToolsWidth = null;
let settingsOpen = false;
let bestArrowMove = null;
let pvPreviewMoves = [];
let movePreview = null;
let movePreviewActive = false;
let pvHoverItems = [];
let debugSeq = 0;
let sharedSettings = window.ChessSettings ? ChessSettings.getSettings() : {
  analysisDepth: 20,
  boardTheme: 'classic',
  pieceStyle: 'classic',
  backgroundStyle: 'obsidian',
  preset: 'tournament',
  moveAnimation: true,
  moveSound: false,
  arrowColor: '#6f8f4b',
};
let moveFxQueue = null;
let audioCtx = null;
let moveSoundTemplates = null;
let moveSoundUnlocked = false;
let moveSoundUnlockBound = false;
// castling rights, en passant
let castling = {wK:true,wQ:true,bK:true,bQ:true};
let epSquare = null; // {row,col} or null

function getSharedSettings(){
  return sharedSettings || ChessSettings?.DEFAULTS || {};
}

function applySharedTheme(){
  if(window.ChessSettings) ChessSettings.applyTheme(document, getSharedSettings());
}

function applySharedSettings(next, options={}){
  sharedSettings = window.ChessSettings ? ChessSettings.normalize(next) : { ...getSharedSettings(), ...(next || {}) };
  applySharedTheme();
  engDepthV = sharedSettings.analysisDepth || 20;
  if(sharedSettings.moveSound){
    bindMoveSoundUnlock();
    try{
      const templates = ensureMoveSoundTemplates();
      templates.move.load();
      templates.capture.load();
    }catch(err){}
  }
  if(options.refreshBoard){
    drawBoard();
    render();
    syncStagePanels();
  }
}

async function initSharedSettings(){
  if(!window.ChessSettings) return;
  applySharedSettings(await ChessSettings.load());
  ChessSettings.subscribe(next=>{
    const prevDepth = engDepthV;
    applySharedSettings(next, { refreshBoard:true });
    if(prevDepth !== engDepthV && engOn){
      engineOptionsSent = false;
      requestEngineAnalysis('shared-depth-change');
    }
  });
}

function shouldPlayMoveAnimation(){
  return !!getSharedSettings().moveAnimation;
}

function shouldPlayMoveSound(){
  return !!getSharedSettings().moveSound;
}

function ensureMoveSoundTemplates(){
  if(moveSoundTemplates) return moveSoundTemplates;
  const move = new Audio(assetUrl('audio/move.mp3'));
  move.preload = 'auto';
  move.volume = 0.42;
  const capture = new Audio(assetUrl('audio/capture.mp3'));
  capture.preload = 'auto';
  capture.volume = 0.5;
  moveSoundTemplates = { move, capture };
  return moveSoundTemplates;
}

function unlockMoveSound(){
  if(moveSoundUnlocked || !shouldPlayMoveSound()) return;
  try{
    const audio = ensureMoveSoundTemplates().move;
    audio.muted = true;
    audio.currentTime = 0;
    const p = audio.play();
    if(p && typeof p.then === 'function'){
      p.then(()=>{
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        moveSoundUnlocked = true;
      }).catch(()=>{
        audio.muted = false;
      });
    }else{
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      moveSoundUnlocked = true;
    }
  }catch(err){}
}

function bindMoveSoundUnlock(){
  if(moveSoundUnlockBound) return;
  moveSoundUnlockBound = true;
  const unlock = ()=>unlockMoveSound();
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  document.addEventListener('touchstart', unlock, { passive:true, capture:true });
}

function playMoveSoundFallback(kind='move'){
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if(!AudioCtor) return;
  if(!audioCtx) audioCtx = new AudioCtor();
  const ctx = audioCtx;
  if(ctx.state === 'suspended') ctx.resume().catch(()=>{});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = kind === 'capture' ? 'triangle' : 'sine';
  osc.frequency.setValueAtTime(kind === 'capture' ? 180 : 240, now);
  osc.frequency.exponentialRampToValueAtTime(kind === 'capture' ? 120 : 190, now + 0.08);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.028, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

function queueMoveFx(piece, from, to){
  if(!piece || !from || !to) return;
  moveFxQueue = {
    pieceKey: piece.s + piece.t.toUpperCase(),
    from: { ...from },
    to: { ...to },
  };
}

function flushMoveFx(){
  const fx = moveFxQueue;
  moveFxQueue = null;
  if(!fx || !shouldPlayMoveAnimation()) return;
  const boardEl = document.getElementById('board');
  if(!boardEl) return;
  const pieceImg = IMGS[fx.pieceKey] || '';
  if(!pieceImg) return;
  const anim = document.createElement('div');
  anim.className = 'pc animating';
  anim.style.left = sx(fx.from.col) + 'px';
  anim.style.top = sy(fx.from.row) + 'px';
  anim.style.width = CS + 'px';
  anim.style.height = CS + 'px';
  anim.style.backgroundImage = `url('${pieceImg}')`;
  anim.style.setProperty('--move-dx', (sx(fx.to.col) - sx(fx.from.col)) + 'px');
  anim.style.setProperty('--move-dy', (sy(fx.to.row) - sy(fx.from.row)) + 'px');
  boardEl.appendChild(anim);
  anim.addEventListener('animationend', ()=>anim.remove(), { once:true });
}

function playMoveSound(kind='move'){
  if(!shouldPlayMoveSound()) return;
  try{
    const templates = ensureMoveSoundTemplates();
    const base = kind === 'capture' ? templates.capture : templates.move;
    base.load();
    const audio = base.cloneNode();
    audio.volume = kind === 'capture' ? 0.5 : 0.42;
    audio.playbackRate = 1;
    audio.currentTime = 0;
    const p = audio.play();
    if(p && typeof p.catch === 'function'){
      p.catch(()=>playMoveSoundFallback(kind));
    }
  }catch(err){
    playMoveSoundFallback(kind);
  }
}

/* ================================================================
   DRAG-TO-RESIZE
================================================================ */
const CS_MIN = 36, CS_MAX = 220;

(function initResize(){
  const handle = document.getElementById('board-resize');
  let drag=false, startX, startCS;
  function start(x){ drag=true; startX=x; startCS=CS; document.body.classList.add('resizing'); }
  function move(x){
    if(!drag)return;
    const newCS=Math.round(startCS+(x-startX)/FILES);
    CS=Math.max(CS_MIN,Math.min(CS_MAX,newCS));
    applyBoardSize(); buildCoords(); syncStagePanels(); centerAnalysisViewport(); drawBoard(); render();
  }
  function end(){ drag=false; document.body.classList.remove('resizing'); }
  handle.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();start(e.clientX)});
  document.addEventListener('mousemove',e=>move(e.clientX));
  document.addEventListener('mouseup',end);
  handle.addEventListener('touchstart',e=>{e.preventDefault();start(e.touches[0].clientX)},{passive:false});
  document.addEventListener('touchmove',e=>{if(drag){e.preventDefault();move(e.touches[0].clientX)}},{passive:false});
  document.addEventListener('touchend',end);
})();

function applyBoardSize(){
  const sz = CS*FILES;
  const bEl = document.getElementById('board');
  bEl.style.width = sz+'px'; bEl.style.height = sz+'px';
  ['cvBoard','cvArrow'].forEach(id=>{
    const cv=document.getElementById(id);
    cv.width=sz; cv.height=sz;
  });
}

function syncStagePanels(){
  const boardStage = document.getElementById('board-stage');
  const boardCol = document.getElementById('board-col');
  const board = document.getElementById('board');
  const gauge = document.getElementById('gauge');
  const undr = document.getElementById('undr');
  const tools = document.getElementById('tools');
  const right = document.getElementById('right-stack');
  const ctrl = document.getElementById('ctrl');
  const moveWrap = document.getElementById('moveWrap');
  const ceval = document.getElementById('ceval');
  const pvLine = document.getElementById('pvLine');
  const pvRows = document.getElementById('pvRows');
  const debugPanel = document.getElementById('debugPanel');
  const boardRect = board.getBoundingClientRect();
  const stageRect = boardStage.getBoundingClientRect();
  const stageW = boardCol.offsetWidth + gauge.offsetWidth;
  const boardW = Math.round(boardRect.width);
  const boardH = Math.round(boardRect.height);
  const boardLeft = Math.round(boardRect.left - stageRect.left);
  const boardRight = Math.round(boardRect.right - stageRect.left);
  const gaugeTop = Math.round(boardRect.top - stageRect.top);
  const stackedLayout = window.innerWidth <= 1180;
  const mobileLayout = window.innerWidth <= 1100;
  const phoneLayout = window.innerWidth <= 640;
  const overlayGaugeLayout = window.innerWidth <= 1180;
  const mobileGaugeGap = overlayGaugeLayout ? 6 : 0;
  const reservedGaugeSpace = overlayGaugeLayout ? (gauge.offsetWidth + mobileGaugeGap) : 0;
  if(baseToolsWidth == null) baseToolsWidth = stageW;
  const viewportW = Math.max(280, window.innerWidth - (phoneLayout ? 12 : 20));
  const unifiedMobileW = Math.min(boardCol.offsetWidth || stageW, viewportW);
  const stageWidth = (stackedLayout || mobileLayout)
    ? Math.min(viewportW, boardLeft + boardW + reservedGaugeSpace)
    : stageW;
  const columnWidth = phoneLayout ? stageWidth : unifiedMobileW;
  const toolsW = (stackedLayout || mobileLayout) ? columnWidth : Math.min(baseToolsWidth, stageW);
  boardStage.style.width = stageWidth + 'px';
  const underW = (stackedLayout || mobileLayout) ? columnWidth : boardW;
  undr.style.width = underW + 'px';
  undr.style.minWidth = underW + 'px';
  undr.style.maxWidth = underW + 'px';
  gauge.style.marginTop = overlayGaugeLayout ? '0px' : gaugeTop + 'px';
  gauge.style.height = boardH + 'px';
  if(overlayGaugeLayout){
    gauge.style.top = gaugeTop + 'px';
    gauge.style.left = (boardRight + mobileGaugeGap) + 'px';
    gauge.style.right = 'auto';
  }else{
    gauge.style.top = '';
    gauge.style.left = '';
    gauge.style.right = '';
  }
  tools.style.width = toolsW + 'px';
  ctrl.style.width = toolsW + 'px';
  right.style.width = toolsW + 'px';
  right.style.minWidth = toolsW + 'px';
  if(stackedLayout || mobileLayout){
    boardStage.style.marginLeft = 'auto';
    boardStage.style.marginRight = 'auto';
    right.style.marginLeft = 'auto';
    right.style.marginRight = 'auto';
    undr.style.marginLeft = 'auto';
    undr.style.marginRight = 'auto';
  }else{
    boardStage.style.marginLeft = '';
    boardStage.style.marginRight = '';
    right.style.marginLeft = '';
    right.style.marginRight = '';
    undr.style.marginLeft = '';
    undr.style.marginRight = '';
  }
  tools.style.height = (stackedLayout || mobileLayout) ? 'auto' : boardH + 'px';
  right.style.height = (stackedLayout || mobileLayout) ? 'auto' : (boardH + ctrl.offsetHeight) + 'px';
  if(moveWrap){
    const fixedToolsHeight =
      (ceval?.offsetHeight || 0) +
      (pvLine?.offsetHeight || 0) +
      (pvRows?.offsetHeight || 0) +
      (debugPanel && !debugPanel.classList.contains('hidden') ? debugPanel.offsetHeight : 0);
    if(phoneLayout){
      moveWrap.style.height = Math.max(180, boardH - fixedToolsHeight) + 'px';
      moveWrap.style.maxHeight = boardH + 'px';
    }else if(stackedLayout || mobileLayout){
      moveWrap.style.height = '';
      moveWrap.style.maxHeight = '';
    }else{
      moveWrap.style.height = '';
      moveWrap.style.maxHeight = '';
    }
  }
}

function centerAnalysisViewport(){
  const app = document.getElementById('app');
  const viewport = document.getElementById('analysis-viewport');
  if(window.innerWidth <= 1180){
    app.scrollLeft = 0;
    return;
  }
  const overflowX = viewport.offsetWidth - app.clientWidth;
  app.scrollLeft = overflowX > 0 ? Math.round(overflowX / 2) : 0;
}

function layout(){
  const right = document.getElementById('right-stack');
  const gaugeW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gauge-w'),10);
  const rightW = right.offsetWidth || 540;
  const stackedLayout = window.innerWidth <= 1180;
  const phoneLayout = window.innerWidth <= 640;
  const horizontalPadding = phoneLayout ? 20 : 96;
  const boardSideUi = stackedLayout ? (phoneLayout ? 34 : 42) : 0;
  const avW = stackedLayout
    ? Math.max(phoneLayout ? 220 : 280, window.innerWidth - horizontalPadding - boardSideUi)
    : Math.max(300, window.innerWidth - rightW - gaugeW - 96);
  const avH = stackedLayout
    ? Math.max(phoneLayout ? 220 : 280, Math.round(window.innerHeight * (phoneLayout ? 0.42 : 0.5)))
    : Math.max(320, window.innerHeight - 190);
  const fitCS = Math.max(CS_MIN, Math.min(CS_MAX, Math.min(
    Math.floor(avW / FILES),
    Math.floor(avH / RANKS)
  )));
  if(!hist.length && CS === 64) CS = fitCS;
  applyBoardSize();
  buildCoords();
  syncStagePanels();
  centerAnalysisViewport();
  drawBoard();
}

/* ================================================================
   COORDINATE HELPERS
================================================================ */
// col 0=a..7=h, row 0=rank8..7=rank1 (internal)
// screen x,y
function sx(col){ return flipped ? (FILES-1-col)*CS : col*CS; }
function sy(row){ return flipped ? (RANKS-1-row)*CS : row*CS; }
function pxToCell(px,py){
  const col = flipped ? FILES-1-Math.floor(px/CS) : Math.floor(px/CS);
  const row = flipped ? RANKS-1-Math.floor(py/CS) : Math.floor(py/CS);
  if(col<0||col>=FILES||row<0||row>=RANKS) return null;
  return {row,col};
}
function isDark(row,col){ return (row+col)%2===1; }

/* ================================================================
   COORD LABELS
================================================================ */
function buildCoords(){
  const bW = CS*FILES;
  // File letters (top/bottom)
  const files = flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  ['coordTop','coordBot'].forEach(id=>{
    const el=document.getElementById(id);
    el.innerHTML=''; el.style.width=bW+'px';
    files.forEach(f=>{
      const s=document.createElement('span');s.textContent=f;
      s.style.cssText=`width:${CS}px;text-align:center;flex-shrink:0;font-size:11px`;
      el.appendChild(s);
    });
  });
  // Rank numbers (left side)
  const ranks = flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  const rl = document.getElementById('rankLeft');
  rl.innerHTML=''; rl.style.height=bW+'px';
  ranks.forEach(r=>{
    const s=document.createElement('span');s.textContent=r;
    s.style.cssText=`height:${CS}px;line-height:${CS}px;font-size:11px;text-align:right;`;
    rl.appendChild(s);
  });
}

/* ================================================================
   DRAW BOARD (checker pattern)
================================================================ */
function drawBoard(){
  const cv = document.getElementById('cvBoard');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  for(let r=0;r<RANKS;r++){
    for(let c=0;c<FILES;c++){
      ctx.fillStyle = isDark(r,c) ? getComputedStyle(document.documentElement).getPropertyValue('--sq-dark').trim() : getComputedStyle(document.documentElement).getPropertyValue('--sq-light').trim();
      ctx.fillRect(sx(c), sy(r), CS, CS);
    }
  }
}
// fallback color strings
const SQ_LIGHT='#f0d9b5', SQ_DARK='#b58863';

function drawBoardDirect(){
  const cv = document.getElementById('cvBoard');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  const light = getComputedStyle(document.documentElement).getPropertyValue('--sq-light').trim() || SQ_LIGHT;
  const dark = getComputedStyle(document.documentElement).getPropertyValue('--sq-dark').trim() || SQ_DARK;
  for(let r=0;r<RANKS;r++){
    for(let c=0;c<FILES;c++){
      ctx.fillStyle = isDark(r,c) ? dark : light;
      ctx.fillRect(sx(c), sy(r), CS, CS);
    }
  }
}

/* ================================================================
   ARROW
================================================================ */
function drawArrow(fr,fc,tr,tc,color='#15781B',alpha=.78){
  const cv=document.getElementById('cvArrow');
  const ctx=cv.getContext('2d');
  // from/to center
  const x1=sx(fc)+CS/2, y1=sy(fr)+CS/2;
  const x2=sx(tc)+CS/2, y2=sy(tr)+CS/2;
  const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy);
  if(len<1) return;
  const nx=dx/len, ny=dy/len, r=CS*.22;
  const ex=x2-nx*r*1.4, ey=y2-ny*r*1.4;
  const ang=Math.atan2(dy,dx), ah=CS*.24, aw=CS*.1;
  ctx.save(); ctx.globalAlpha=alpha;
  ctx.strokeStyle=color; ctx.fillStyle=color;
  ctx.lineWidth=aw; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(x1+nx*r*1.1, y1+ny*r*1.1); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2-nx*r, y2-ny*r);
  ctx.lineTo(x2-nx*r-ah*Math.cos(ang-.5), y2-ny*r-ah*Math.sin(ang-.5));
  ctx.lineTo(x2-nx*r-ah*Math.cos(ang+.5), y2-ny*r-ah*Math.sin(ang+.5));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
function clearArrow(){
  const cv=document.getElementById('cvArrow');
  cv.getContext('2d').clearRect(0,0,cv.width,cv.height);
}

function eventClientPoint(e){
  if(e.touches && e.touches[0]) return { x:e.touches[0].clientX, y:e.touches[0].clientY };
  if(e.changedTouches && e.changedTouches[0]) return { x:e.changedTouches[0].clientX, y:e.changedTouches[0].clientY };
  return { x:e.clientX, y:e.clientY };
}

function debugLog(message, data){
  const stamp = new Date().toLocaleTimeString('en-GB', { hour12:false });
  const suffix = data === undefined ? '' : ' ' + (typeof data === 'string' ? data : JSON.stringify(data));
  const line = `[${String(++debugSeq).padStart(4,'0')}] ${stamp} ${message}${suffix}`;
  console.log('[ChessAnalysis]', line);
  const el = document.getElementById('debugLog');
  if(!el) return;
  const rows = (el.textContent ? el.textContent.split('\n') : []).filter(Boolean);
  rows.push(line);
  el.textContent = rows.slice(-120).join('\n');
  el.scrollTop = el.scrollHeight;
}

function resetEngineState(keepPending=false){
  // Reset only runtime engine state; keep the queued request when recovering.
  clearTimeout(engineHandshakeTimer);
  engineHandshakeTimer = null;
  engineReady = false;
  engineUciReady = false;
  engineBusy = false;
  engineStopped = true;
  engineOptionsSent = false;
  engineLastNps = 0;
  engineLastSelDepth = 0;
  engineAwaitingReadyReason = null;
  engineCurrentFen = null;
  currentEvalEntry = null;
  if(!keepPending) enginePendingRequest = null;
}

function currentEngineScript(){
  // Prefer Komodo and fall back to Stockfish if the primary worker cannot boot.
  return engineCandidates[Math.min(engineCandidateIndex, engineCandidates.length - 1)];
}

function engineDisplayName(script){
  return String(script || '').includes('komodoro') ? 'Komodo' : 'Stockfish';
}

function buildEngineWorkerBootstrap(script){
  const workerUrl = assetUrl(script);
  const wasmUrl = String(script || '').includes('komodoro')
    ? assetUrl('modules/lib/komodoro.wasm')
    : assetUrl('modules/lib/stockfish.wasm');
  const mainScriptUrl = String(script || '').includes('komodoro')
    ? assetUrl('modules/lib/komodoro.js')
    : assetUrl('modules/lib/stockfish.js');
  return `
    self.Module = self.Module || {};
    self.Module.locateFile = function(path) {
      var name = String(path || '').split('/').pop();
      if (name === 'engine.wasm' || name === 'komodoro-worker.wasm') name = 'komodoro.wasm';
      if (name === 'stockfish-worker.wasm') name = 'stockfish.wasm';
      return name && name.endsWith('.wasm') ? ${JSON.stringify(wasmUrl)} : name;
    };
    self.Module.wasmBinaryFile = ${JSON.stringify(wasmUrl)};
    self.Module.mainScriptUrlOrBlob = ${JSON.stringify(mainScriptUrl)};
    importScripts(${JSON.stringify(workerUrl)});
  `;
}

function createEngineWorkerForScript(script){
  const normalized = String(script || '');
  const blob = new Blob([buildEngineWorkerBootstrap(normalized)], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  const worker = new Worker(blobUrl);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  return worker;
}

function computeRandomBestArrow(){
  const candidates=[];
  for(let r=0;r<RANKS;r++){
    for(let c=0;c<FILES;c++){
      const p=board[r][c];
      if(!p||p.s!==turn) continue;
      legalMoves(r,c,board,castling,epSquare).forEach(mv=>{
        candidates.push({fr:{row:r,col:c},to:{row:mv.row,col:mv.col}});
      });
    }
  }
  bestArrowMove = candidates.length ? candidates[Math.floor(Math.random()*candidates.length)] : null;
}

/* ================================================================
   FEN PARSING / GENERATION
================================================================ */
function parseFEN(fen){
  // Parse only the FEN fields this app actively uses in analysis and move legality.
  const parts = fen.split(' ');
  const rows = parts[0].split('/');
  const b = Array.from({length:RANKS},()=>Array(FILES).fill(null));
  for(let r=0;r<RANKS;r++){
    let c=0;
    for(const ch of rows[r]){
      if(/\d/.test(ch)){c+=+ch;continue;}
      const color = ch===ch.toUpperCase()?'w':'b';
      b[r][c] = {t:ch.toLowerCase(), s:color};
      c++;
    }
  }
  turn = parts[1]||'w';
  // castling
  const cas = parts[2]||'-';
  castling = {
    wK: cas.includes('K'), wQ: cas.includes('Q'),
    bK: cas.includes('k'), bQ: cas.includes('q')
  };
  // en passant
  if(parts[3]&&parts[3]!=='-'){
    const f='abcdefgh'.indexOf(parts[3][0]);
    const rk=8-+parts[3][1];
    epSquare = {row:rk, col:f};
  } else epSquare=null;
  return b;
}

function toFEN(b,t){
  // Serialize the current position back to UCI/Stockfish format.
  const rows = b.map(row=>{
    let s='',e=0;
    for(const p of row){
      if(!p){e++;continue;}
      if(e){s+=e;e=0;}
      s+=p.s==='w'?p.t.toUpperCase():p.t;
    }
    if(e)s+=e; return s;
  }).join('/');
  const cas = [
    castling.wK?'K':'',castling.wQ?'Q':'',
    castling.bK?'k':'',castling.bQ?'q':''
  ].join('')||'-';
  const ep = epSquare ? ('abcdefgh'[epSquare.col] + (8-epSquare.row)) : '-';
  const fullmove = Math.floor(hist.length/2) + 1;
  return rows + ' ' + t + ' ' + cas + ' ' + ep + ' 0 ' + fullmove;
}

function dc(b){return b.map(r=>r.map(p=>p?{...p}:null));}

/* ================================================================
   MOVE GENERATION (standard chess)
================================================================ */
function legalMoves(row,col,b,cas,ep){
  // Generate legal moves by creating pseudo-legal moves first, then filtering
  // out moves that leave the moving side in check.
  const p=b[row][col]; if(!p) return [];
  const op=p.s==='w'?'b':'w';
  const mv=[];
  const ok=(r,c)=>r>=0&&r<RANKS&&c>=0&&c<FILES&&(!b[r][c]||b[r][c].s===op);
  const em=(r,c)=>r>=0&&r<RANKS&&c>=0&&c<FILES&&!b[r][c];

  if(p.t==='p'){
    const dir=p.s==='w'?-1:1;
    const start=p.s==='w'?6:1;
    // forward
    if(em(row+dir,col)) mv.push({row:row+dir,col,ep:false});
    if(row===start&&em(row+dir,col)&&em(row+2*dir,col))
      mv.push({row:row+2*dir,col,ep2:true,ep:false});
    // captures
    [-1,1].forEach(dc_=>{
      if(ok(row+dir,col+dc_)&&b[row+dir]?.[col+dc_]?.s===op)
        mv.push({row:row+dir,col:col+dc_,ep:false});
      if(ep&&ep.row===row+dir&&ep.col===col+dc_)
        mv.push({row:row+dir,col:col+dc_,ep:true,epCapRow:row,epCapCol:col+dc_});
    });
  }
  else if(p.t==='n'){
    for(const[dr,dc_]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])
      if(ok(row+dr,col+dc_)) mv.push({row:row+dr,col:col+dc_});
  }
  else if(p.t==='b'||p.t==='q'){
    for(const[dr,dc_]of[[-1,-1],[-1,1],[1,-1],[1,1]]){
      for(let r=row+dr,c=col+dc_;r>=0&&r<RANKS&&c>=0&&c<FILES;r+=dr,c+=dc_){
        if(!b[r][c]) mv.push({row:r,col:c});
        else{if(b[r][c].s===op) mv.push({row:r,col:c}); break;}
      }
    }
  }
  if(p.t==='r'||p.t==='q'){
    for(const[dr,dc_]of[[-1,0],[1,0],[0,-1],[0,1]]){
      for(let r=row+dr,c=col+dc_;r>=0&&r<RANKS&&c>=0&&c<FILES;r+=dr,c+=dc_){
        if(!b[r][c]) mv.push({row:r,col:c});
        else{if(b[r][c].s===op) mv.push({row:r,col:c}); break;}
      }
    }
  }
  if(p.t==='k'){
    for(const[dr,dc_]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
      if(ok(row+dr,col+dc_)) mv.push({row:row+dr,col:col+dc_});
    // castling
    if(p.s==='w'&&row===7&&col===4){
      if(cas.wK&&em(7,5)&&em(7,6)&&!isAttacked(b,7,4,'w')&&!isAttacked(b,7,5,'w')&&!isAttacked(b,7,6,'w'))
        mv.push({row:7,col:6,castle:'wK'});
      if(cas.wQ&&em(7,3)&&em(7,2)&&em(7,1)&&!isAttacked(b,7,4,'w')&&!isAttacked(b,7,3,'w')&&!isAttacked(b,7,2,'w'))
        mv.push({row:7,col:2,castle:'wQ'});
    }
    if(p.s==='b'&&row===0&&col===4){
      if(cas.bK&&em(0,5)&&em(0,6)&&!isAttacked(b,0,4,'b')&&!isAttacked(b,0,5,'b')&&!isAttacked(b,0,6,'b'))
        mv.push({row:0,col:6,castle:'bK'});
      if(cas.bQ&&em(0,3)&&em(0,2)&&em(0,1)&&!isAttacked(b,0,4,'b')&&!isAttacked(b,0,3,'b')&&!isAttacked(b,0,2,'b'))
        mv.push({row:0,col:2,castle:'bQ'});
    }
  }
  // filter: don't leave own king in check
  return mv.filter(m=>{
    const nb=dc(b);
    nb[m.row][m.col]=nb[row][col]; nb[row][col]=null;
    if(m.ep) nb[m.epCapRow][m.epCapCol]=null;
    if(m.castle==='wK'){nb[7][5]=nb[7][7];nb[7][7]=null;}
    if(m.castle==='wQ'){nb[7][3]=nb[7][0];nb[7][0]=null;}
    if(m.castle==='bK'){nb[0][5]=nb[0][7];nb[0][7]=null;}
    if(m.castle==='bQ'){nb[0][3]=nb[0][0];nb[0][0]=null;}
    const k=findKing(nb,p.s);
    return k&&!isAttacked(nb,k.row,k.col,p.s);
  });
}

function findKing(b,s){
  if(!Array.isArray(b) || b.length < RANKS) return null;
  for(let r=0;r<RANKS;r++) for(let c=0;c<FILES;c++)
    if(Array.isArray(b[r]) && b[r][c] && b[r][c].t==='k' && b[r][c].s===s) return{row:r,col:c};
  return null;
}

function isAttacked(b,row,col,s){
  // is square (row,col) attacked by opponent of s?
  const op=s==='w'?'b':'w';
  for(let r=0;r<RANKS;r++) for(let c=0;c<FILES;c++){
    const p=b[r][c]; if(!p||p.s!==op) continue;
    // generate raw moves (no legality check to avoid recursion)
    if(attacks(b,r,c,row,col)) return true;
  }
  return false;
}

function attacks(b,fr,fc,tr,tc){
  const p=b[fr][fc]; if(!p) return false;
  const dr=tr-fr, dc_=tc-fc;
  if(p.t==='p'){
    const dir=p.s==='w'?-1:1;
    return dr===dir&&Math.abs(dc_)===1;
  }
  if(p.t==='n') return (Math.abs(dr)===2&&Math.abs(dc_)===1)||(Math.abs(dr)===1&&Math.abs(dc_)===2);
  if(p.t==='k') return Math.abs(dr)<=1&&Math.abs(dc_)<=1;
  if(p.t==='b'||p.t==='q'){
    if(Math.abs(dr)===Math.abs(dc_)){
      const sr=Math.sign(dr),sc=Math.sign(dc_);
      for(let r=fr+sr,c=fc+sc;r!==tr||c!==tc;r+=sr,c+=sc)
        if(b[r][c]) return false;
      return true;
    }
  }
  if(p.t==='r'||p.t==='q'){
    if(dr===0||dc_===0){
      const sr=Math.sign(dr),sc=Math.sign(dc_);
      for(let r=fr+sr,c=fc+sc;r!==tr||c!==tc;r+=sr,c+=sc)
        if(b[r][c]) return false;
      return true;
    }
  }
  return false;
}

/* ================================================================
   APPLY MOVE
================================================================ */
function applyMove(fr,fc,tr,tc,promoTo){
  // Apply a move to the real board, update history, and advance the side to move.
  const p=board[fr][fc]; if(!p||p.s!==turn) return false;
  const ms=legalMoves(fr,fc,board,castling,epSquare);
  const m=ms.find(m=>m.row===tr&&m.col===tc); if(!m) return false;
  const movePiece = { ...p, t:(p.t==='p'&&(tr===0||tr===7)) ? (promoTo||'q') : p.t };

  const nb=dc(board);
  const cap=nb[tr][tc];
  nb[tr][tc]=nb[fr][fc]; nb[fr][fc]=null;
  if(m.ep){ nb[m.epCapRow][m.epCapCol]=null; }
  if(m.castle==='wK'){nb[7][5]=nb[7][7];nb[7][7]=null;}
  if(m.castle==='wQ'){nb[7][3]=nb[7][0];nb[7][0]=null;}
  if(m.castle==='bK'){nb[0][5]=nb[0][7];nb[0][7]=null;}
  if(m.castle==='bQ'){nb[0][3]=nb[0][0];nb[0][0]=null;}
  // pawn promotion
  if(p.t==='p'&&(tr===0||tr===7)){
    nb[tr][tc]={t:promoTo||'q',s:p.s};
  }
  // new ep square
  let newEp=null;
  if(p.t==='p'&&Math.abs(tr-fr)===2) newEp={row:(fr+tr)/2,col:fc};

  // Update castling rights
  const newCas={...castling};
  if(p.t==='k'){ if(p.s==='w'){newCas.wK=false;newCas.wQ=false;}else{newCas.bK=false;newCas.bQ=false;} }
  if(fr===7&&fc===0) newCas.wQ=false;
  if(fr===7&&fc===7) newCas.wK=false;
  if(fr===0&&fc===0) newCas.bQ=false;
  if(fr===0&&fc===7) newCas.bK=false;

  // trim forward
  if(hIdx<hist.length-1){hist=hist.slice(0,hIdx+1);states=states.slice(0,hIdx+2);}

  const not=buildSAN(p,fr,fc,tr,tc,cap,m,nb);
  hist.push({fr:{row:fr,col:fc},to:{row:tr,col:tc},p,cap,not,castle:m.castle});
  board=nb; castling=newCas; epSquare=newEp;
  states.push({b:dc(board),t:turn==='w'?'b':'w',cas:{...castling},ep:newEp});
  hIdx=hist.length-1;
  turn=turn==='w'?'b':'w';
  sel=null;
  currentEvalEntry = null;
  queueMoveFx(movePiece, { row:fr, col:fc }, { row:tr, col:tc });
  playMoveSound(cap || m.ep ? 'capture' : 'move');
  return true;
}

function buildSAN(p,fr,fc,tr,tc,cap,m,nb){
  // SAN is intentionally lightweight here: enough for readable move history/PV.
  const files='abcdefgh';
  if(m.castle==='wK'||m.castle==='bK') return 'O-O';
  if(m.castle==='wQ'||m.castle==='bQ') return 'O-O-O';
  let s=SAN[p.t];
  if(p.t!=='p'){ s+=files[fc]; } // simplified â€“ no disambiguation
  else if(cap||m.ep) s+=files[fc]+'x';
  if(cap&&p.t!=='p') s+='x';
  s+=files[tc]+(8-tr);
  if(p.t==='p'&&(tr===0||tr===7)) s+='=Q';
  // check?
  const k=findKing(nb,turn==='w'?'b':'w');
  if(k&&isAttacked(nb,k.row,k.col,turn==='w'?'b':'w')) s+= hasLegalMoves(nb,turn==='w'?'b':'w')?'+':'#';
  return s;
}

function moveNotationForPreview(p,fr,fc,tr,tc,cap,m){
  const files='abcdefgh';
  if(m.castle==='wK'||m.castle==='bK') return 'O-O';
  if(m.castle==='wQ'||m.castle==='bQ') return 'O-O-O';
  let s=SAN[p.t];
  if(p.t==='p'){
    if(cap||m.ep) s+=files[fc]+'x';
  }else if(cap){
    s+='x';
  }
  s+=files[tc]+(8-tr);
  if(p.t==='p'&&(tr===0||tr===7)) s+='=Q';
  return s;
}

function collectLegalMovesForState(b,s,cas,ep){
  // Helper used only for preview lines, not for the live board interaction.
  const moves=[];
  for(let r=0;r<RANKS;r++){
    for(let c=0;c<FILES;c++){
      const p=b[r][c];
      if(!p||p.s!==s) continue;
      legalMoves(r,c,b,cas,ep).forEach(m=>{
        moves.push({fr:{row:r,col:c},to:{row:m.row,col:m.col},meta:m,piece:{...p}});
      });
    }
  }
  return moves;
}

function applyPreviewMove(state,move){
  // Apply a move on an isolated preview state so PV parsing never mutates the board.
  const nb=dc(state.board);
  const p=nb[move.fr.row][move.fr.col];
  const cap=nb[move.to.row][move.to.col];
  nb[move.to.row][move.to.col]=p;
  nb[move.fr.row][move.fr.col]=null;
  if(move.meta.ep) nb[move.meta.epCapRow][move.meta.epCapCol]=null;
  if(move.meta.castle==='wK'){nb[7][5]=nb[7][7];nb[7][7]=null;}
  if(move.meta.castle==='wQ'){nb[7][3]=nb[7][0];nb[7][0]=null;}
  if(move.meta.castle==='bK'){nb[0][5]=nb[0][7];nb[0][7]=null;}
  if(move.meta.castle==='bQ'){nb[0][3]=nb[0][0];nb[0][0]=null;}
  if(p.t==='p'&&(move.to.row===0||move.to.row===7)) nb[move.to.row][move.to.col]={t:'q',s:p.s};
  const nextCas={...state.cas};
  if(p.t==='k'){ if(p.s==='w'){nextCas.wK=false;nextCas.wQ=false;} else {nextCas.bK=false;nextCas.bQ=false;} }
  if(move.fr.row===7&&move.fr.col===0) nextCas.wQ=false;
  if(move.fr.row===7&&move.fr.col===7) nextCas.wK=false;
  if(move.fr.row===0&&move.fr.col===0) nextCas.bQ=false;
  if(move.fr.row===0&&move.fr.col===7) nextCas.bK=false;
  if(cap&&cap.t==='r'){
    if(move.to.row===7&&move.to.col===0) nextCas.wQ=false;
    if(move.to.row===7&&move.to.col===7) nextCas.wK=false;
    if(move.to.row===0&&move.to.col===0) nextCas.bQ=false;
    if(move.to.row===0&&move.to.col===7) nextCas.bK=false;
  }
  const nextEp=(p.t==='p'&&Math.abs(move.to.row-move.fr.row)===2)?{row:(move.fr.row+move.to.row)/2,col:move.fr.col}:null;
  return {
    board:nb,
    turn:state.turn==='w'?'b':'w',
    cas:nextCas,
    ep:nextEp,
    notation:moveNotationForPreview(p,move.fr.row,move.fr.col,move.to.row,move.to.col,cap,move.meta),
  };
}

function formatPreviewLine(moves,startTurn,startMoveNo){
  // Convert parsed PV moves into a human-readable single-line notation string.
  if(!moves.length) return '';
  const parts=[];
  let moveNo=startMoveNo;
  let side=startTurn;
  if(side==='b') parts.push(`${moveNo}...`);
  moves.forEach((mv,idx)=>{
    if(side==='w') parts.push(`${moveNo}.`);
    parts.push(mv.not);
    if(side==='b') moveNo++;
    side=side==='w'?'b':'w';
  });
  return parts.join(' ')+' ...';
}

function buildRandomPreviewLine(maxPlies=8){
  const state={
    board:dc(board),
    turn,
    cas:{...castling},
    ep:epSquare?{...epSquare}:null,
  };
  const previewMoves=[];
  for(let ply=0;ply<maxPlies;ply++){
    const legal=collectLegalMovesForState(state.board,state.turn,state.cas,state.ep);
    if(!legal.length) break;
    const chosen=legal[Math.floor(Math.random()*legal.length)];
    const applied=applyPreviewMove(state,chosen);
    previewMoves.push({
      fr:chosen.fr,
      to:chosen.to,
      promoTo:chosen.piece.t==='p'&&(chosen.to.row===0||chosen.to.row===7)?'q':undefined,
      not:applied.notation,
    });
    state.board=applied.board;
    state.turn=applied.turn;
    state.cas=applied.cas;
    state.ep=applied.ep;
  }
  return previewMoves;
}

/* ================================================================
   MOVE PREVIEW (HOVER)
================================================================ */
function ensureMovePreview(){
  if(movePreview) return movePreview;
  const root = document.getElementById('movePreview');
  const boardEl = document.getElementById('movePreviewBoard');
  const label = document.getElementById('movePreviewLabel');
  if(!root || !boardEl || !label) return null;
  boardEl.innerHTML = '';
  const squares = [];
  for(let r=0;r<RANKS;r++){
    for(let c=0;c<FILES;c++){
      const sq = document.createElement('div');
      sq.className = 'mp-sq ' + (isDark(r,c) ? 'dark' : 'light');
      const pc = document.createElement('div');
      pc.className = 'mp-piece';
      sq.appendChild(pc);
      boardEl.appendChild(sq);
      squares.push({ sq, pc });
    }
  }
  movePreview = { root, boardEl, label, squares, highlighted: [] };
  return movePreview;
}

function previewIndexForBoardCell(row,col){
  const vr = flipped ? (RANKS - 1 - row) : row;
  const vc = flipped ? (FILES - 1 - col) : col;
  return vr * FILES + vc;
}

function clearMovePreviewHighlights(preview){
  if(!preview || !preview.highlighted) return;
  preview.highlighted.forEach(idx=>{
    const cell = preview.squares[idx];
    if(cell) cell.sq.classList.remove('mp-from','mp-to');
  });
  preview.highlighted = [];
}

function setMovePreviewBoard(state, lastMove, labelText){
  const preview = ensureMovePreview();
  if(!preview || !state || !state.board) return;
  preview.label.textContent = labelText || '';
  clearMovePreviewHighlights(preview);
  for(let r=0;r<RANKS;r++){
    for(let c=0;c<FILES;c++){
      const idx = previewIndexForBoardCell(r,c);
      const cell = preview.squares[idx];
      if(!cell) continue;
      const piece = state.board[r]?.[c];
      const key = piece ? (piece.s + piece.t.toUpperCase()) : '';
      cell.pc.style.backgroundImage = key && IMGS[key] ? `url('${IMGS[key]}')` : '';
    }
  }
  if(lastMove){
    if(lastMove.fr){
      const fromIdx = previewIndexForBoardCell(lastMove.fr.row, lastMove.fr.col);
      if(preview.squares[fromIdx]){
        preview.squares[fromIdx].sq.classList.add('mp-from');
        preview.highlighted.push(fromIdx);
      }
    }
    if(lastMove.to){
      const toIdx = previewIndexForBoardCell(lastMove.to.row, lastMove.to.col);
      if(preview.squares[toIdx]){
        preview.squares[toIdx].sq.classList.add('mp-to');
        preview.highlighted.push(toIdx);
      }
    }
  }
}

function positionMovePreview(clientX, clientY){
  const preview = ensureMovePreview();
  if(!preview) return;
  const root = preview.root;
  const pad = 14;
  const rect = root.getBoundingClientRect();
  const width = rect.width || 180;
  const height = rect.height || 200;
  let left = clientX + pad;
  let top = clientY + pad;
  if(left + width > window.innerWidth - 6) left = clientX - width - pad;
  if(top + height > window.innerHeight - 6) top = clientY - height - pad;
  left = Math.max(6, Math.min(left, window.innerWidth - width - 6));
  top = Math.max(6, Math.min(top, window.innerHeight - height - 6));
  root.style.left = Math.round(left) + 'px';
  root.style.top = Math.round(top) + 'px';
}

function showMovePreview(state, lastMove, labelText, evt){
  const preview = ensureMovePreview();
  if(!preview) return;
  setMovePreviewBoard(state, lastMove, labelText);
  preview.root.classList.remove('hidden');
  preview.root.setAttribute('aria-hidden','false');
  if(evt) positionMovePreview(evt.clientX, evt.clientY);
  movePreviewActive = true;
}

function hideMovePreview(){
  const preview = ensureMovePreview();
  if(!preview) return;
  preview.root.classList.add('hidden');
  preview.root.setAttribute('aria-hidden','true');
  movePreviewActive = false;
}

function movePreviewFollow(evt){
  if(!movePreviewActive || !evt) return;
  positionMovePreview(evt.clientX, evt.clientY);
}

function buildPvMoveLabel(moveNo, side, notation){
  const prefix = side === 'b' ? `${moveNo}...` : `${moveNo}.`;
  return `${prefix} ${notation || ''}`.trim();
}

function applySimplePreviewMove(state, mv){
  if(!state || !mv) return null;
  const piece = state.board[mv.fr.row]?.[mv.fr.col];
  if(!piece) return null;
  const legal = legalMoves(mv.fr.row, mv.fr.col, state.board, state.cas, state.ep);
  const meta = legal.find(m => m.row === mv.to.row && m.col === mv.to.col);
  if(!meta) return null;
  return applyPreviewMove(state, { fr: mv.fr, to: mv.to, meta, piece: { ...piece } });
}

function renderPvLineInteractive(previewMoves, startTurn, startMoveNo, fallbackText){
  const pvLine = document.getElementById('pvLine');
  if(!pvLine) return;
  pvHoverItems = [];
  if(!previewMoves || !previewMoves.length){
    pvLine.textContent = fallbackText || '';
    return;
  }
  pvLine.innerHTML = '';
  const frag = document.createDocumentFragment();
  let moveNo = startMoveNo;
  let side = startTurn;
  let state = { board: dc(board), turn: startTurn, cas: { ...castling }, ep: epSquare ? { ...epSquare } : null };
  if(side === 'b'){
    const num = document.createElement('span');
    num.className = 'pv-num';
    num.textContent = `${moveNo}...`;
    frag.appendChild(num);
  }
  previewMoves.forEach((mv, idx)=>{
    if(side === 'w'){
      const num = document.createElement('span');
      num.className = 'pv-num';
      num.textContent = `${moveNo}.`;
      frag.appendChild(num);
    }
    const token = document.createElement('span');
    token.className = 'pv-token';
    token.textContent = mv.not || '';
    token.dataset.idx = String(idx);
    frag.appendChild(token);

    const applied = applySimplePreviewMove(state, mv);
    if(applied){
      pvHoverItems[idx] = {
        state: { board: applied.board, turn: applied.turn, cas: applied.cas, ep: applied.ep },
        move: mv,
        label: buildPvMoveLabel(moveNo, side, mv.not),
      };
      state = { board: applied.board, turn: applied.turn, cas: applied.cas, ep: applied.ep };
    }
    if(side === 'b') moveNo++;
    side = side === 'w' ? 'b' : 'w';
  });
  const tail = document.createElement('span');
  tail.className = 'pv-ellipsis';
  tail.textContent = ' ...';
  frag.appendChild(tail);
  pvLine.appendChild(frag);
  pvLine.onmouseleave = hideMovePreview;

  pvLine.querySelectorAll('.pv-token').forEach(token=>{
    token.addEventListener('mouseenter', e=>{
      const idx = Number(e.currentTarget.dataset.idx || -1);
      const item = pvHoverItems[idx];
      if(!item) return;
      showMovePreview(
        item.state,
        { fr: item.move.fr, to: item.move.to },
        item.label,
        e
      );
    });
    token.addEventListener('mousemove', movePreviewFollow);
    token.addEventListener('mouseleave', hideMovePreview);
  });
}

function playPvFirstMove(){
  // Clicking the main PV line should play only the first suggested move.
  const mv=pvPreviewMoves[0];
  if(!mv){
    debugLog('PV click ignored: no preview move available');
    return;
  }
  debugLog('Applying PV first move', { from: mv.fr, to: mv.to, promo: mv.promoTo || null });
  if(applyMove(mv.fr.row,mv.fr.col,mv.to.row,mv.to.col,mv.promoTo)){
    render();
    updateUI();
    debugLog('PV first move applied successfully');
  }else{
    debugLog('PV first move failed to apply', { from: mv.fr, to: mv.to, fen: toFEN(board,turn) });
  }
}

function hasLegalMoves(b,s){
  for(let r=0;r<RANKS;r++) for(let c=0;c<FILES;c++){
    if(b[r][c]&&b[r][c].s===s&&legalMoves(r,c,b,castling,epSquare).length>0) return true;
  }
  return false;
}

function firstUciFromPv(pvText){
  return (pvText || '').trim().split(/\s+/).find(token => /^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(token)) || null;
}

/* ================================================================
   RENDER
================================================================ */
function render(){
  // Rebuild board overlays and pieces from scratch to keep rendering predictable.
  const bEl=document.getElementById('board');
  bEl.querySelectorAll('.pc,.dot,.ring,.sq-sel,.sq-mv,.sq-chk').forEach(e=>e.remove());

  drawBoardDirect();
  clearArrow();

  // Last-move highlight squares
  if(hIdx>=0&&hist[hIdx]){
    const mv=hist[hIdx];
    [mv.fr,mv.to].forEach(pos=>{
      const d=document.createElement('div');
      d.className='sq-mv '+(isDark(pos.row,pos.col)?'dark':'light');
      d.style.cssText=`left:${sx(pos.col)}px;top:${sy(pos.row)}px;width:${CS}px;height:${CS}px;`;
      bEl.appendChild(d);
    });
  }


  // Selected square
  if(sel){
    const d=document.createElement('div');d.className='sq-sel';
    d.style.cssText=`left:${sx(sel.col)}px;top:${sy(sel.row)}px;width:${CS}px;height:${CS}px;`;
    bEl.appendChild(d);
  }

  // Check glow
  const kg=findKing(board,turn);
  if(kg&&isAttacked(board,kg.row,kg.col,turn)){
    const d=document.createElement('div');d.className='sq-chk';
    d.style.cssText=`left:${sx(kg.col)}px;top:${sy(kg.row)}px;width:${CS}px;height:${CS}px;`;
    bEl.appendChild(d);
  }

  // Pieces
  for(let r=0;r<RANKS;r++) for(let c=0;c<FILES;c++){
    const row = Array.isArray(board?.[r]) ? board[r] : null;
    const p=row?.[c]; if(!p) continue;
    const d=document.createElement('div');
    d.className='pc'+(sel&&sel.row===r&&sel.col===c?' sel':'');
    d.style.cssText=`left:${sx(c)}px;top:${sy(r)}px;width:${CS}px;height:${CS}px;`+
      `background-image:url('${IMGS[p.s+p.t.toUpperCase()]||IMGS[p.s+p.t]||''}');`;
    d.addEventListener('click',e=>{e.stopPropagation();clickPc(r,c);});
    d.addEventListener('touchstart',e=>{
      e.preventDefault();
      e.stopPropagation();
      clickPc(r,c);
    }, { passive:false });
    // drag support
    d.addEventListener('mousedown',e=>{if(e.button===0){e.stopPropagation();startDrag(r,c,e);}});
    bEl.appendChild(d);
  }

  // Move hints
  if(sel){
    legalMoves(sel.row,sel.col,board,castling,epSquare).forEach(mv=>{
      const has=board[mv.row][mv.col]||(mv.ep);
      const d=document.createElement('div');
      const ds=has?Math.round(CS*.88):Math.round(CS*.3);
      const off=has?Math.round(CS*.06):Math.round(CS*.35);
      d.className=has?'ring':'dot';
      d.style.cssText=`left:${sx(mv.col)+off}px;top:${sy(mv.row)+off}px;width:${ds}px;height:${ds}px;`;
      d.addEventListener('click',e=>{e.stopPropagation();clickDest(mv.row,mv.col);});
      d.addEventListener('touchstart',e=>{
        e.preventDefault();
        e.stopPropagation();
        clickDest(mv.row,mv.col);
      }, { passive:false });
      bEl.appendChild(d);
    });
  }

  flushMoveFx();
}

/* ================================================================
   DRAG & DROP
================================================================ */
let dragState=null;

function startDrag(row,col,e){
  if(!board[row][col]||board[row][col].s!==turn) return;
  sel={row,col};
  render();
  const bEl=document.getElementById('board');
  const rect=bEl.getBoundingClientRect();

  // Create floating drag piece
  const fp=document.createElement('div');
  fp.className='pc drag';
  fp.style.cssText=`position:fixed;pointer-events:none;z-index:1000;`+
    `width:${CS}px;height:${CS}px;`+
    `background-image:url('${IMGS[board[row][col].s+board[row][col].t.toUpperCase()]||''}');`+
    `transform:translate(-50%,-50%);`;
  fp.style.left=(e.clientX)+'px';
  fp.style.top=(e.clientY)+'px';
  document.body.appendChild(fp);
  dragState={row,col,fp,rect};

  const onMove=ev=>{
    fp.style.left=ev.clientX+'px';
    fp.style.top=ev.clientY+'px';
  };
  const onUp=ev=>{
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    fp.remove();
    const bRect=bEl.getBoundingClientRect();
    const cell=pxToCell(ev.clientX-bRect.left, ev.clientY-bRect.top);
    if(cell) clickDest(cell.row,cell.col);
    else {sel=null;render();}
    dragState=null;
  };
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

/* ================================================================
   INTERACTIONS
================================================================ */
function clickPc(row,col){
  const p=board[row][col];
  if(sel){
    const ms=legalMoves(sel.row,sel.col,board,castling,epSquare);
    if(ms.some(m=>m.row===row&&m.col===col)){
      if(applyMove(sel.row,sel.col,row,col)){render();updateUI();return;}
    }
    if(p&&p.s===turn){sel={row,col};render();return;}
    sel=null;render();return;
  }
  if(p&&p.s===turn){sel={row,col};render();}
}
function clickDest(row,col){
  if(!sel) return;
  if(applyMove(sel.row,sel.col,row,col)){render();updateUI();}
  else{sel=null;render();}
}
document.getElementById('board').addEventListener('click',function(e){
  if(!sel) return;
  const rect=this.getBoundingClientRect();
  const cell=pxToCell(e.clientX-rect.left,e.clientY-rect.top);
  if(!cell){sel=null;render();return;}
  clickDest(cell.row,cell.col);
});
document.getElementById('board').addEventListener('touchstart',function(e){
  if(!sel) return;
  if(e.target !== this) return;
  e.preventDefault();
  const point=eventClientPoint(e);
  const rect=this.getBoundingClientRect();
  const cell=pxToCell(point.x-rect.left, point.y-rect.top);
  if(!cell){sel=null;render();return;}
  clickDest(cell.row,cell.col);
}, { passive:false });

/* ================================================================
   NAVIGATION
================================================================ */
function jumpTo(i){
  // Navigation always restores a snapshot from `states`, never replays moves.
  if(i<0||i>=hist.length) return;
  const prev=hIdx;
  if(i===prev+1){
    const mv=hist[i];
    if(mv) queueMoveFx(mv.p, mv.fr, mv.to);
  }else if(i===prev-1){
    const mv=hist[prev];
    if(mv) queueMoveFx(mv.p, mv.to, mv.fr);
  }
  hIdx=i;
  const s=states[i+1];
  board=dc(s.b); turn=s.t; castling={...s.cas}; epSquare=s.ep;
  if(prev!==i) playMoveSound('move');
  sel=null; render(); updateUI();
}
function navB(){
  if(hIdx<0) return; hIdx--;
  const mv=hist[hIdx+1];
  if(mv) queueMoveFx(mv.p, mv.to, mv.fr);
  const s=states[hIdx+1];
  board=dc(s.b); turn=s.t; castling={...s.cas}; epSquare=s.ep;
  playMoveSound('move');
  sel=null; render(); updateUI();
}
function navF(){
  if(hIdx>=hist.length-1) return; hIdx++;
  const mv=hist[hIdx];
  if(mv) queueMoveFx(mv.p, mv.fr, mv.to);
  const s=states[hIdx+1];
  board=dc(s.b); turn=s.t; castling={...s.cas}; epSquare=s.ep;
  playMoveSound('move');
  sel=null; render(); updateUI();
}
function nav0(){
  hIdx=-1;
  const s=states[0];
  board=dc(s.b); turn=s.t; castling={...s.cas}; epSquare=s.ep;
  sel=null; render(); updateUI();
}
function navEnd(){ if(hist.length) jumpTo(hist.length-1); }
function flipBoard(){ flipped=!flipped; buildCoords(); render(); }
function setToggleButton(btn,on){
  if(!btn)return;
  btn.classList.toggle('off',!on);
  btn.setAttribute('aria-pressed',on?'true':'false');
}
function isToggleOn(id){
  const el=document.getElementById(id);
  return !!el && !el.classList.contains('off');
}
function syncAuxPanels(){
  // Auxiliary panels are visibility-only UI state derived from settings + content.
  const pvRows=document.getElementById('pvRows');
  const debugPanel=document.getElementById('debugPanel');
  const showLines=isToggleOn('stShowLines');
  const lineCount=Number(document.getElementById('stLines')?.value || 1);
  const shouldShowPvRows=showLines && lineCount > 1 && pvRows && pvRows.childElementCount > 0;
  if(pvRows) pvRows.classList.toggle('hidden', !shouldShowPvRows);
  if(debugPanel) debugPanel.classList.toggle('hidden', !isToggleOn('stDebug'));
}
function closeSettings(){
  settingsOpen=false;
  const panel=document.getElementById('settingsPanel');
  const btn=document.getElementById('menuBtn');
  if(panel){
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden','true');
  }
  if(btn){
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded','false');
  }
}
function openSettings(){
  settingsOpen=true;
  const panel=document.getElementById('settingsPanel');
  const btn=document.getElementById('menuBtn');
  if(panel){
    panel.classList.add('open');
    panel.setAttribute('aria-hidden','false');
  }
  if(btn){
    btn.classList.add('active');
    btn.setAttribute('aria-expanded','true');
  }
}
function toggleSettings(){ settingsOpen ? closeSettings() : openSettings(); }
function bindSettingControls(){
  // Settings are plain DOM controls; each one updates UI immediately and triggers
  // a fresh engine request only when it changes engine behavior.
  [['stShowLines',true],['stInfinite',false],['stDebug',false]].forEach(([id,on])=>{
    const el=document.getElementById(id);
    setToggleButton(el,on);
    if(el) el.addEventListener('click',()=>{
      setToggleButton(el,el.classList.contains('off'));
      if(id==='stShowLines' || id==='stDebug') syncAuxPanels();
      if(id==='stInfinite' && engOn){
        engineOptionsSent = false;
        requestEngineAnalysis('setting-toggle:' + id);
      }
    });
  });
  [
    ['stLines','stLinesVal',v=>`${v} / 5`],
  ].forEach(([sliderId,valueId,fmt])=>{
    const slider=document.getElementById(sliderId);
    const value=document.getElementById(valueId);
    if(!slider||!value)return;
    const sync=()=>{
      value.textContent=fmt(slider.value);
      if(sliderId==='stLines') syncAuxPanels();
      if(engineWorker&&engOn){
        engineOptionsSent = false;
        requestEngineAnalysis('setting-slider:' + sliderId);
      }
    };
    slider.addEventListener('input',sync);
    sync();
  });
  const panel=document.getElementById('settingsPanel');
  const menuBtn=document.getElementById('menuBtn');
  if(panel) panel.addEventListener('click',e=>e.stopPropagation());
  if(menuBtn) menuBtn.addEventListener('click',e=>{e.stopPropagation();toggleSettings();});
  document.addEventListener('click',e=>{
    if(!settingsOpen)return;
    if(panel&&panel.contains(e.target))return;
    if(menuBtn&&menuBtn.contains(e.target))return;
    closeSettings();
  });
  syncAuxPanels();
}

/* ================================================================
   UI UPDATE
================================================================ */
function updateUI(){
  // Central UI refresh after navigation, board changes, or engine state changes.
  document.getElementById('fenVal').textContent=toFEN(board,turn);
  applyEvalDisplay(currentEvalEntry);
  if(!engOn) computeRandomBestArrow();
  updateMoveList(); updatePGN();
  render();
  if(engOn) requestEngineAnalysis('ui-update');
}

function updateMoveList(){
  // Move list is rendered from SAN history and highlights the current ply.
  const ml=document.getElementById('moveList'); ml.innerHTML='';
  let currentCell = null;
  for(let i=0;i<hist.length;i+=2){
    const row=document.createElement('div'); row.className='mv-row';
    const nm=document.createElement('span'); nm.className='mv-num';
    nm.textContent=(i/2+1)+'.'; row.appendChild(nm);
    [0,1].forEach(off=>{
      const td=document.createElement('span');
      td.className='mv-cell'+(hIdx===i+off?' cur':'');
      td.textContent=hist[i+off]?.not||'';
      if(hIdx===i+off) currentCell = td;
      if(hist[i+off]) td.onclick=()=>jumpTo(i+off);
      row.appendChild(td);
    });
    ml.appendChild(row);
  }
  const wrap = document.getElementById('moveWrap');
  if(!wrap) return;
  if(currentCell){
    currentCell.scrollIntoView({ block:'nearest', inline:'nearest' });
  }else{
    wrap.scrollTop = wrap.scrollHeight;
  }
}

function updatePGN(){
  const ms=hist.map((m,i)=>(i%2===0?`${i/2+1}. `:'')+m.not).join(' ');
  document.getElementById('pgnBox').textContent=
`[Event "?"]
[Site "https://www.pychess.org/analysis/chess"]
[Date "2026.03.10"]
[White "?"]
[Black "?"]
[Result "*"]
[Variant "Chess"]

${ms||'*'}`;
}

/* ================================================================
   REAL ENGINE
================================================================ */
function initEngine(){
  // Create one worker instance and perform the UCI handshake once per engine boot.
  if(engineWorker) return;
  try{
    engineActiveScript = currentEngineScript();
    engineWorker = createEngineWorkerForScript(engineActiveScript);
    engineWorker.onmessage = (e)=>handleEngineMessage(String(e.data||''));
    engineWorker.onerror = (err)=>{
      console.error('Engine error:', err);
      debugLog('Engine worker error', String(err?.message || err));
      document.getElementById('engDepth').textContent='Engine load error';
      restartEngine('worker-error', true);
    };
    resetEngineState(true);
    engineBootCount++;
    debugLog('Engine worker created', { boot: engineBootCount, script: engineActiveScript });
    document.getElementById('engDepth').textContent = `Starting ${engineDisplayName(engineActiveScript)}...`;
    engineHandshakeTimer = setTimeout(()=>{
      if(engineUciReady) return;
      debugLog('Engine handshake timeout', { boot: engineBootCount, script: engineActiveScript });
      restartEngine('handshake-timeout', true);
    }, 4000);
    sendEngine('uci');
  }catch(err){
    console.error(err);
    debugLog('Engine init failed', String(err?.message || err));
    document.getElementById('engDepth').textContent='Engine unavailable';
  }
}

function sendEngine(cmd){
  if(!engineWorker) return;
  debugLog('Engine <=', cmd);
  try{ engineWorker.postMessage(cmd); }catch(err){ console.error(err); debugLog('Engine send failed', String(err?.message || err)); }
}

function stopEngineAnalysis(){
  if(!engineWorker) return;
  clearTimeout(engTimer);
  clearTimeout(engineHandshakeTimer);
  engineHandshakeTimer = null;
  sendEngine('stop');
  engineStopped = true;
  engineBusy = false;
  debugLog('Engine analysis stopped');
}

function scoreToWhiteCp(entry){
  // Engine scores are stored from White's perspective to keep eval formatting simple.
  if(!entry) return 0;
  if(entry.mate !== null && entry.mate !== undefined){
    const mateScore = Number(entry.mate);
    return mateScore > 0 ? 100000 : -100000;
  }
  return Number(entry.cp || 0);
}

function evalToGaugePercent(entry){
  // A logistic curve makes the eval bar feel less jumpy than a linear cp mapping.
  const whiteCp = scoreToWhiteCp(entry);
  const normalized = 1 / (1 + Math.exp(-whiteCp / 220));
  const blackPercent = (1 - normalized) * 100;
  return Math.max(2, Math.min(98, blackPercent));
}

function applyEvalDisplay(entry){
  // Keep the numeric eval and the gauge in sync from the same score source.
  currentEvalEntry = entry || null;
  if(!entry){
    evalV = 0;
    document.getElementById('evalScore').textContent = '+0.0';
    document.getElementById('gBlack').style.height = '50%';
    return;
  }
  const whiteCp = scoreToWhiteCp(entry);
  evalV = Math.max(-9, Math.min(9, whiteCp / 100));
  document.getElementById('evalScore').textContent = formatEval(entry);
  document.getElementById('gBlack').style.height = evalToGaugePercent(entry) + '%';
}

function destroyEngine(){
  if(!engineWorker) return;
  try{
    engineWorker.terminate();
  }catch(err){
    debugLog('Engine terminate failed', String(err?.message || err));
  }
  engineWorker = null;
  resetEngineState(true);
}

function restartEngine(reason, rotateCandidate=false){
  // Recovery path for worker crashes or unsupported engine builds.
  if(rotateCandidate && engineCandidateIndex < engineCandidates.length - 1){
    engineCandidateIndex++;
  }
  debugLog('Restarting engine', { reason, pending: !!enginePendingRequest, nextScript: currentEngineScript() });
  destroyEngine();
  document.getElementById('engDepth').textContent = `Restarting ${engineDisplayName(currentEngineScript())}...`;
  if(engOn){
    initEngine();
    if(enginePendingRequest) requestEngineAnalysis('restart:' + reason);
  }
}

function applyEngineOptions(){
  // Only MultiPV is user-configurable in this trimmed UI.
  if(!engineWorker || !engineUciReady) return;
  const lines = Number(document.getElementById('stLines')?.value || 1);
  sendEngine('setoption name MultiPV value ' + lines);
  engineReady = false;
  engineOptionsSent = true;
  engineAwaitingReadyReason = 'options';
  debugLog('Engine options applied', { lines });
  sendEngine('isready');
}

function startPendingEngineAnalysis(trigger){
  // Every new request replaces the previous one; stale starts are discarded later.
  if(!engineWorker || !enginePendingRequest) return;
  const pending = enginePendingRequest;
  enginePendingRequest = null;
  engineRequestSeq = pending.seq;
  engineCurrentFen = pending.fen;
  engineLines.clear();
  engineBestMove = null;
  engineLastNps = 0;
  engineLastSelDepth = 0;
  engineStopped = false;
  engineBusy = true;
  engineReady = true;
  engineAwaitingReadyReason = null;
  currentEvalEntry = null;
  clearEngineOutput('Calculating...');
  debugLog('Starting engine analysis', { trigger, seq: pending.seq, fen: pending.fen, infinite: pending.infinite });
  sendEngine('stop');
  engTimer = setTimeout(()=>{
    if(!engineWorker) return;
    if(engineCurrentFen !== pending.fen){
      debugLog('Skipping stale engine start', { pendingFen: pending.fen, currentFen: engineCurrentFen });
      return;
    }
    sendEngine('position fen ' + pending.fen);
    if(pending.infinite){
      sendEngine('go infinite');
    }else{
      sendEngine('go depth ' + pending.depth);
    }
  }, 60);
}

function requestEngineAnalysis(reason='update'){
  // Queue the latest board state for analysis; only the newest request matters.
  clearTimeout(engTimer);
  if(!engOn){
    debugLog('Engine request skipped: engine paused');
    stopEngineAnalysis();
    clearEngineOutput('Engine paused');
    return;
  }
  initEngine();
  if(!engineWorker) return;
  const fen = toFEN(board,turn);
  engineIsInfinite = !document.getElementById('stInfinite')?.classList.contains('off');
  const seq = engineRequestSeq + 1;
  const depth = Math.max(5, Math.min(25, Number(engDepthV || getSharedSettings().analysisDepth || 20)));
  enginePendingRequest = { seq, fen, infinite: engineIsInfinite, depth, reason };
  debugLog('Queued engine request', { seq, reason, fen, ready: engineReady, uci: engineUciReady });
  if(!engineUciReady){
    document.getElementById('engDepth').textContent='Waiting for engine handshake';
    clearEngineOutput('Waiting for engine handshake');
    return;
  }
  if(!engineOptionsSent){
    applyEngineOptions();
    document.getElementById('engDepth').textContent='Applying engine options';
    clearEngineOutput('Applying engine options');
    return;
  }
  if(!engineReady){
    document.getElementById('engDepth').textContent='Waiting for engine ready';
    clearEngineOutput('Waiting for engine ready');
    return;
  }
  startPendingEngineAnalysis(reason);
}

function handleEngineMessage(line){
  // The worker speaks UCI lines, so message handling is a small line parser.
  if(!line) return;
  debugLog('Engine =>', line);
  if(line.startsWith('info string')){
    return;
  }
  if(line === 'uciok'){
    clearTimeout(engineHandshakeTimer);
    engineHandshakeTimer = null;
    engineUciReady = true;
    engineCandidateIndex = engineCandidates.indexOf(engineActiveScript);
    debugLog('Engine UCI handshake complete');
    applyEngineOptions();
    return;
  }
  if(line === 'readyok'){
    engineReady = true;
    const readyReason = engineAwaitingReadyReason;
    engineAwaitingReadyReason = null;
    debugLog('Engine ready acknowledged', { pending: !!enginePendingRequest, reason: readyReason });
    if(readyReason === 'options'){
      if(enginePendingRequest) startPendingEngineAnalysis('options-ready');
      return;
    }
    if(enginePendingRequest) startPendingEngineAnalysis('readyok');
    return;
  }
  if(line.startsWith('bestmove')){
    engineBusy = false;
    const parts = line.split(/\s+/);
    if(parts[1] && parts[1] !== '(none)') engineBestMove = parts[1];
    debugLog('Engine bestmove received', { bestmove: engineBestMove, pending: !!enginePendingRequest });
    return;
  }
  if(!line.startsWith('info ')) return;
  if(enginePendingRequest){
    debugLog('Ignoring info while newer request is pending', { pending: true, fen: enginePendingRequest.fen });
    return;
  }
  const depthMatch = line.match(/\bdepth\s+(\d+)/);
  const selMatch = line.match(/\bseldepth\s+(\d+)/);
  const npsMatch = line.match(/\bnps\s+(\d+)/);
  const multiMatch = line.match(/\bmultipv\s+(\d+)/);
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  const depth = depthMatch ? Number(depthMatch[1]) : 0;
  const seldepth = selMatch ? Number(selMatch[1]) : 0;
  const nps = npsMatch ? Number(npsMatch[1]) : 0;
  const multipv = multiMatch ? Number(multiMatch[1]) : 1;
  if(!pvMatch) return;
  engineLastNps = nps || engineLastNps;
  engineLastSelDepth = seldepth || engineLastSelDepth;
  const entry = { depth, seldepth, nps, pv: pvMatch[1].trim(), cp: cpMatch ? Number(cpMatch[1]) : null, mate: mateMatch ? Number(mateMatch[1]) : null, fen: engineCurrentFen };
  engineLines.set(multipv, entry);
  renderEngineLines();
}

function formatEval(entry){
  if(!entry) return '+0.0';
  if(entry.mate !== null && entry.mate !== undefined){
    return '#' + Number(entry.mate);
  }
  const whiteCp = scoreToWhiteCp(entry);
  return (whiteCp >= 0 ? '+' : '') + (whiteCp/100).toFixed(1);
}

function squareToCoords(sq){
  if(!/^[a-h][1-8]$/.test(sq)) return null;
  return { col: sq.charCodeAt(0)-97, row: 8-Number(sq[1]) };
}

function uciToPreviewMove(uci, state){
  // Convert one UCI token into a legal preview move in the current preview state.
  if(!uci || uci.length < 4) return null;
  const from = squareToCoords(uci.slice(0,2));
  let to = squareToCoords(uci.slice(2,4));
  const promo = uci[4]?.toLowerCase();
  if(!from || !to) return null;
  const piece = state.board[from.row]?.[from.col];
  if(!piece || piece.s !== state.turn) return null;
  const legal = legalMoves(from.row, from.col, state.board, state.cas, state.ep);
  let meta = legal.find(m => m.row===to.row && m.col===to.col);
  if(!meta && piece.t === 'k'){
    const targetPiece = state.board[to.row]?.[to.col];
    if(targetPiece && targetPiece.t === 'r' && targetPiece.s === piece.s){
      meta = legal.find(m => m.castle && ((to.col > from.col && m.col === 6) || (to.col < from.col && m.col === 2))) || null;
      if(meta) to = { row: meta.row, col: meta.col };
    }
  }
  if(!meta) return null;
  const applied = applyPreviewMove(state, { fr: from, to, meta, piece: {...piece} });
  return {
    fr: from,
    to,
    promoTo: promo || (piece.t==='p' && (to.row===0 || to.row===7) ? 'q' : undefined),
    not: applied.notation,
    nextState: { board: applied.board, turn: applied.turn, cas: applied.cas, ep: applied.ep }
  };
}

function buildPvPreviewFromUci(pvText, maxPlies=10){
  // Parse the engine PV token by token until one move fails or the preview cap is hit.
  const tokens = (pvText || '').trim().split(/\s+/).filter(Boolean);
  const preview = [];
  let state = { board: dc(board), turn, cas: {...castling}, ep: epSquare ? {...epSquare} : null };
  for(const uci of tokens){
    const mv = uciToPreviewMove(uci, state);
    if(!mv){
      debugLog('PV parse stopped on token', { token: uci, built: preview.length, fen: toFEN(state.board,state.turn) });
      break;
    }
    preview.push({ fr: mv.fr, to: mv.to, promoTo: mv.promoTo, not: mv.not });
    state = mv.nextState;
    if(preview.length >= maxPlies) break;
  }
  return preview;
}

function renderEngineLines(){
  // Render the current best line and optional MultiPV rows for the active position only.
  const best = engineLines.get(1);
  if(!best) return;
  const currentFen = toFEN(board,turn);
  if(best.fen && best.fen !== currentFen){
    debugLog('Ignoring stale PV render', { engineFen: best.fen, boardFen: currentFen });
    return;
  }
  applyEvalDisplay(best);
  document.getElementById('engDepth').textContent = 'Depth ' + best.depth + (engineLastSelDepth ? '/' + engineLastSelDepth : '') + ', ' + Math.round((engineLastNps||0)/1000) + ' knodes/s';

  const linesWanted = Number(document.getElementById('stLines')?.value || 1);
  const pvRows = document.getElementById('pvRows');
  pvRows.innerHTML = '';
  for(let i=1;i<=linesWanted;i++){
    const entry = engineLines.get(i);
    if(!entry) continue;
    if(entry.fen && entry.fen !== currentFen){
      debugLog('Skipping stale PV entry', { rank: i, engineFen: entry.fen, boardFen: currentFen });
      continue;
    }
    const previewMoves = buildPvPreviewFromUci(entry.pv, 12);
    const firstMove = previewMoves[0] || (() => {
      const uci = firstUciFromPv(entry.pv);
      if(!uci) return null;
      const mv = uciToPreviewMove(uci, { board: dc(board), turn, cas: {...castling}, ep: epSquare ? {...epSquare} : null });
      return mv ? { fr: mv.fr, to: mv.to, promoTo: mv.promoTo, not: mv.not } : null;
    })();
    const playablePreview = previewMoves.length ? previewMoves : (firstMove ? [firstMove] : []);
    debugLog('Render PV line', { rank: i, previewMoves: previewMoves.length, firstMove: firstMove ? `${firstMove.not}:${firstMove.fr.row},${firstMove.fr.col}->${firstMove.to.row},${firstMove.to.col}` : null });
    if(i===1){
      pvPreviewMoves = playablePreview;
      bestArrowMove = firstMove ? { fr: firstMove.fr, to: firstMove.to } : null;
      const moveNo = Math.floor(hist.length/2)+1;
      renderPvLineInteractive(previewMoves, turn, moveNo, formatPreviewLine(previewMoves,turn,moveNo) || entry.pv);
      debugLog('Primary PV updated', { text: document.getElementById('pvLine').textContent, arrow: !!bestArrowMove });
    }
    const row = document.createElement('div');
    row.className = 'pv-row';
    row.title = entry.pv;
    row.innerHTML = '<div class="pv-rank">' + i + '</div><div class="pv-m">' + (firstMove?.not || previewMoves[0]?.not || entry.pv.split(/\s+/)[0] || '') + '</div><div class="pv-m2">' + (previewMoves[1]?.not || '') + '</div>';
    row.addEventListener('mouseenter', e=>{
      const uci = firstUciFromPv(entry.pv);
      if(!uci) return;
      const state = { board: dc(board), turn, cas: {...castling}, ep: epSquare ? {...epSquare} : null };
      const mv = uciToPreviewMove(uci, state);
      if(!mv) return;
      showMovePreview(
        mv.nextState,
        { fr: mv.fr, to: mv.to },
        `PV ${i}: ${mv.not || ''}`.trim(),
        e
      );
    });
    row.addEventListener('mousemove', movePreviewFollow);
    row.addEventListener('mouseleave', hideMovePreview);
    row.addEventListener('click', ()=>{
      pvPreviewMoves = playablePreview;
      bestArrowMove = firstMove ? { fr: firstMove.fr, to: firstMove.to } : null;
      const moveNo = Math.floor(hist.length/2)+1;
      renderPvLineInteractive(previewMoves, turn, moveNo, formatPreviewLine(previewMoves,turn,moveNo) || entry.pv);
      debugLog('PV row selected', { rank: i, arrow: !!bestArrowMove, playable: !!pvPreviewMoves[0] });
      render();
    });
    pvRows.appendChild(row);
  }
  syncAuxPanels();
  render();
}

function clearEngineOutput(message='Waiting for engine'){
  // Clear only engine-owned UI, keeping the underlying board/history intact.
  bestArrowMove = null;
  pvPreviewMoves = [];
  hideMovePreview();
  document.getElementById('pvLine').textContent = message;
  pvHoverItems = [];
  document.getElementById('pvRows').innerHTML = '';
  applyEvalDisplay(currentEvalEntry);
  syncAuxPanels();
  render();
}

function toggleEngine(){
  engOn=!engOn;
  document.getElementById('togBtn').classList.toggle('off',!engOn);
  if(engOn){
    requestEngineAnalysis('toggle-on');
  }else{
    stopEngineAnalysis();
    document.getElementById('engDepth').textContent='Engine paused';
  }
}

/* ================================================================
   UTILS
================================================================ */
function selAll(el){
  const r=document.createRange(); r.selectNodeContents(el);
  const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
}
function dlPGN(){
  const a=document.createElement('a');
  a.href='data:text/plain;charset=utf-8,'+encodeURIComponent(document.getElementById('pgnBox').textContent);
  a.download='game.pgn'; a.click();
}

function sanitizePgnText(pgnText){
  return String(pgnText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '\n')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/\$\d+/g, ' ')
    .replace(/(?:e\.p\.)/gi, ' ')
    .trim();
}

function normalizeSanToken(token){
  return String(token || '')
    .replace(/^\uFEFF/, '')
    .replace(/^\d+\.(\.\.)?/, '')
    .replace(/^\.\.\./, '')
    .replace(/\$\d+/g, '')
    .replace(/[!?+#]+$/g, '')
    .replace(/(?:e\.p\.)$/i, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
}

function simplifyChessSan(token){
  const san = normalizeSanToken(token).replace(/0-0-0/g,'O-O-O').replace(/0-0/g,'O-O');
  const m = san.match(/^([KQRBN])([a-h1-8]{1,2})(x?[a-h][1-8](=?[QRBN])?)$/);
  return m ? `${m[1]}${m[3]}` : san;
}

function findLegalMoveForSan(state, token, legal){
  const normalized = normalizeSanToken(token).replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
  if(normalized === 'O-O' || normalized === 'O-O-O'){
    return legal.find(move => {
      const castle = move.meta?.castle;
      return normalized === 'O-O' ? castle === 'wK' || castle === 'bK' : castle === 'wQ' || castle === 'bQ';
    }) || null;
  }
  const targetMatch = normalized.match(/([a-h][1-8])(?:=[QRBN])?$/);
  if(!targetMatch) return null;
  const targetSquare = targetMatch[1];
  const targetCol = 'abcdefgh'.indexOf(targetSquare[0]);
  const targetRow = 8 - Number(targetSquare[1]);
  const pieceMatch = normalized.match(/^[KQRBN]/);
  const pieceType = pieceMatch ? pieceMatch[0].toLowerCase() : 'p';
  const capture = normalized.includes('x');
  const promotionMatch = normalized.match(/=([QRBN])/);
  const promotion = promotionMatch ? promotionMatch[1].toLowerCase() : '';
  let hint = normalized
    .replace(/^[KQRBN]/, '')
    .replace(/=([QRBN])$/, '')
    .replace(targetSquare, '')
    .replace('x', '');
  const fromFile = hint.match(/[a-h]/)?.[0] || '';
  const fromRank = hint.match(/[1-8]/)?.[0] || '';
  const candidates = legal.filter(move => {
    const piece = move.piece || move.p;
    if(!piece || piece.t !== pieceType) return false;
    if(move.to.row !== targetRow || move.to.col !== targetCol) return false;
    const isCapture = Boolean(state.board[targetRow]?.[targetCol]) || Boolean(move.meta?.ep);
    if(capture !== isCapture) return false;
    if(fromFile && move.fr.col !== 'abcdefgh'.indexOf(fromFile)) return false;
    if(fromRank && move.fr.row !== 8 - Number(fromRank)) return false;
    if(promotion && !(piece.t === 'p' && (move.to.row === 0 || move.to.row === 7))) return false;
    return true;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function coordsToUci(fr,fc,tr,tc,promo){
  const files='abcdefgh';
  return `${files[fc]}${8-fr}${files[tc]}${8-tr}${promo||''}`;
}

function getChessConstructor(){
  if(typeof Chess === 'function') return Chess;
  if(typeof globalThis !== 'undefined'){
    if(typeof globalThis.Chess === 'function') return globalThis.Chess;
    if(typeof globalThis.Chess?.Chess === 'function') return globalThis.Chess.Chess;
    if(typeof globalThis.module?.exports?.Chess === 'function') return globalThis.module.exports.Chess;
    if(typeof globalThis.exports?.Chess === 'function') return globalThis.exports.Chess;
  }
  return null;
}

function extractPgnDataWithChessJs(pgnText){
  const ChessCtor = getChessConstructor();
  if(typeof ChessCtor !== 'function') return null;
  const sanitized = sanitizePgnText(pgnText);
  const parser = new ChessCtor();
  const load = typeof parser.load_pgn === 'function'
    ? (text, options) => parser.load_pgn(text, options)
    : typeof parser.loadPgn === 'function'
      ? (text, options) => parser.loadPgn(text, options)
      : null;
  if(!load) return null;
  const loaded = load(sanitized, { sloppy: true });
  if(!loaded) return null;
  const header = typeof parser.header === 'function'
    ? parser.header()
    : typeof parser.getHeaders === 'function'
      ? parser.getHeaders()
      : {};
  let history = typeof parser.history === 'function' ? (parser.history({ verbose: true }) || []) : [];
  if(history.length && typeof history[0] !== 'object'){
    const startFen = header?.SetUp === '1' && header?.FEN ? header.FEN : undefined;
    const replay = startFen ? new ChessCtor(startFen) : new ChessCtor();
    history = history.map(token => {
      if(typeof replay.move === 'function') return replay.move(token, { sloppy: true });
      return null;
    }).filter(Boolean);
  }
  if(!history.length) return { tags: { ...(header || {}) }, moves: [] };
  const moves = history.map(entry => {
    const fr = squareToCoords(entry.from);
    const to = squareToCoords(entry.to);
    const promo = entry.promotion ? String(entry.promotion).toLowerCase() : undefined;
    return {
      fr,
      to,
      p: { t: String(entry.piece || '').toLowerCase(), s: entry.color === 'w' ? 'w' : 'b' },
      not: String(entry.san || ''),
      uci: `${entry.from}${entry.to}${promo || ''}`,
      meta: {},
    };
  });
  return { tags: { ...(header || {}) }, moves };
}

function extractPgnData(pgnText){
  const chessJsParsed = extractPgnDataWithChessJs(pgnText);
  if(chessJsParsed) return chessJsParsed;
  const text = sanitizePgnText(pgnText);
  const tags = {};
  text.replace(/\[(\w+)\s+"([^"]*)"\]/g, (_, key, value) => { tags[key] = value; return ''; });
  let body = text
    .replace(/\[(\w+)\s+"([^"]*)"\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n\r]*/g, ' ')
    .replace(/(?:^|\s)\d+\.(?:\.\.)?/g, ' ');
  while(/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, ' ');
  const rawTokens = body.split(/\s+/).map(t=>t.trim()).filter(Boolean);
  const moves = [];
  const startFen = tags.SetUp === '1' && tags.FEN ? tags.FEN : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const parts = String(startFen).trim().split(/\s+/);
  const startBoard = parseFEN(startFen);
  const startTurn = parts[1] === 'b' ? 'b' : 'w';
  const casText = parts[2] || 'KQkq';
  const epText = parts[3] || '-';
  let state = {
    board:dc(startBoard),
    turn:startTurn,
    cas:{
      wK:casText.includes('K'),
      wQ:casText.includes('Q'),
      bK:casText.includes('k'),
      bQ:casText.includes('q'),
    },
    ep: epText && epText !== '-' ? squareToCoords(epText) : null,
  };
  for(const raw of rawTokens){
    const token = normalizeSanToken(raw);
    if(!token || /^\d+\.$/.test(raw) || /^\.\.\.$/.test(raw) || /^(1-0|0-1|1\/2-1\/2|\*)$/i.test(token)) continue;
    const legal = collectLegalMovesForState(state.board,state.turn,state.cas,state.ep);
    const found = legal.map(legalMove => {
      const san = simplifyChessSan(moveNotationForPreview(legalMove.piece, legalMove.fr.row, legalMove.fr.col, legalMove.to.row, legalMove.to.col, Boolean(state.board[legalMove.to.row]?.[legalMove.to.col]) || Boolean(legalMove.meta?.ep), legalMove.meta));
      const target = simplifyChessSan(token);
      if(san !== target) return null;
      const promo = legalMove.piece.t==='p' && (legalMove.to.row===0||legalMove.to.row===7) ? 'q' : undefined;
      return {
        fr:{...legalMove.fr},
        to:{...legalMove.to},
        not:moveNotationForPreview(legalMove.piece, legalMove.fr.row, legalMove.fr.col, legalMove.to.row, legalMove.to.col, Boolean(state.board[legalMove.to.row]?.[legalMove.to.col]) || Boolean(legalMove.meta?.ep), legalMove.meta),
        uci:coordsToUci(legalMove.fr.row, legalMove.fr.col, legalMove.to.row, legalMove.to.col, promo),
      };
    }).find(Boolean) || (() => {
      const fallback = findLegalMoveForSan(state, token, legal);
      if(!fallback) return null;
      const promo = fallback.piece.t==='p' && (fallback.to.row===0||fallback.to.row===7) ? 'q' : undefined;
      return {
        fr:{...fallback.fr},
        to:{...fallback.to},
        not:moveNotationForPreview(fallback.piece, fallback.fr.row, fallback.fr.col, fallback.to.row, fallback.to.col, Boolean(state.board[fallback.to.row]?.[fallback.to.col]) || Boolean(fallback.meta?.ep), fallback.meta),
        uci:coordsToUci(fallback.fr.row, fallback.fr.col, fallback.to.row, fallback.to.col, promo),
      };
    })();
    if(!found) throw new Error(`Could not parse move: ${token}`);
    moves.push(found);
    state = applyPreviewMove(state, {
      fr:found.fr,
      to:found.to,
      meta:legal.find(m => m.fr.row === found.fr.row && m.fr.col === found.fr.col && m.to.row === found.to.row && m.to.col === found.to.col)?.meta || {},
      piece:state.board[found.fr.row][found.fr.col],
    });
  }
  return { tags, moves };
}

async function loadAnalysisPgnText(pgnText){
  const parsed = extractPgnData(pgnText);
  const startFEN = parsed.tags.SetUp === '1' && parsed.tags.FEN
    ? parsed.tags.FEN
    : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const fenParts = String(startFEN).trim().split(/\s+/);
  board = parseFEN(startFEN);
  turn = fenParts[1] === 'b' ? 'b' : 'w';
  castling = {
    wK:(fenParts[2] || 'KQkq').includes('K'),
    wQ:(fenParts[2] || 'KQkq').includes('Q'),
    bK:(fenParts[2] || 'KQkq').includes('k'),
    bQ:(fenParts[2] || 'KQkq').includes('q'),
  };
  epSquare = fenParts[3] && fenParts[3] !== '-' ? squareToCoords(fenParts[3]) : null;
  hist = [];
  states = [{ b:dc(board), t:turn, cas:{...castling}, ep:epSquare?{...epSquare}:null }];
  hIdx = -1;
  sel = null;
  currentEvalEntry = null;
  bestArrowMove = null;
  pvPreviewMoves = [];
  for(const move of parsed.moves){
    if(!applyMove(move.fr.row, move.fr.col, move.to.row, move.to.col, move.uci[4])){
      throw new Error(`Could not apply move: ${move.not || move.uci}`);
    }
    hist[hist.length - 1].uci = move.uci;
  }
  document.getElementById('pgnBox').textContent = sanitizePgnText(pgnText);
  nav0();
  updateUI();
}


function bindPageControls(){
  // Wire top-level page actions once during initialization.
  document.getElementById('togBtn')?.addEventListener('click', toggleEngine);
  document.getElementById('btnNav0')?.addEventListener('click', nav0);
  document.getElementById('btnNavB')?.addEventListener('click', navB);
  document.getElementById('btnFlip')?.addEventListener('click', flipBoard);
  document.getElementById('btnNavF')?.addEventListener('click', navF);
  document.getElementById('btnNavEnd')?.addEventListener('click', navEnd);
  document.getElementById('fenVal')?.addEventListener('click', function(){ selAll(this); });
  document.getElementById('dlPgnLink')?.addEventListener('click', (e)=>{ e.preventDefault(); dlPGN(); });
  document.getElementById('loadAnalysisPgnLink')?.addEventListener('click', (e)=>{
    e.preventDefault();
    document.getElementById('analysisPgnFile')?.click();
  });
  document.getElementById('analysisPgnFile')?.addEventListener('change', async e=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      await loadAnalysisPgnText(text);
    }catch(err){
      console.error('Failed to load PGN into analysis:', err);
      alert(err?.message || 'Could not load PGN.');
    }finally{
      e.target.value = '';
    }
  });
  document.getElementById('pngHintLink')?.addEventListener('click', (e)=>{ e.preventDefault(); alert('Right-click board -> Save image'); });
  document.getElementById('clearDebugBtn')?.addEventListener('click', ()=>{
    const logEl = document.getElementById('debugLog');
    if(logEl) logEl.textContent = '';
    debugSeq = 0;
    debugLog('Debug log cleared');
  });
}

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();navB();}
  else if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();navF();}
  else if(e.key==='Home'){e.preventDefault();nav0();}
  else if(e.key==='End'){e.preventDefault();navEnd();}
  else if(e.key==='f'||e.key==='F') flipBoard();
  else if(e.key==='Escape'){closeSettings();sel=null;render();}
});

/* ================================================================
   INIT
================================================================ */
async function init(){
  // Initialize the page with the standard chess starting position.
  await initSharedSettings();
  bindMoveSoundUnlock();
  const startFEN='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  board=parseFEN(startFEN);
  hist=[]; hIdx=-1; evalV=.5; bestArrowMove=null; pvPreviewMoves=[];
  currentEvalEntry = null;
  states=[{b:dc(board),t:turn,cas:{...castling},ep:null}];
  bindPageControls();
  bindSettingControls();
  document.getElementById('pvLine').addEventListener('click',playPvFirstMove);
  clearEngineOutput('Waiting for engine');
  initEngine();
  layout(); render(); updateUI();
}

window.addEventListener('resize',()=>{layout();render();});
window.addEventListener('scroll', hideMovePreview, true);
window.addEventListener('blur', hideMovePreview);
init().catch(err=>console.error('Init failed', err));

window.addEventListener('beforeunload',()=>{ try{ stopEngineAnalysis(); if(engineWorker) engineWorker.terminate(); if(audioCtx) audioCtx.close(); }catch(e){} });
