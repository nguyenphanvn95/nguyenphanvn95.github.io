// ==UserScript==
// @name         Chess Killer
// @namespace    https://nguyenphanvn95.github.io/chesskiller
// @version      3.4.5
// @description  Chess engine hints cho chess.com và lichess.org
// @author       Chess Killer
// @match        *://*.chess.com/*
// @match        *://*.lichess.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      chess.com
// @connect      api.chess.com
// @connect      lichess.org
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────────
  const BASE       = 'https://nguyenphanvn95.github.io/chesskiller';
  const REVIEW_URL = BASE + '/review.html';
  const STREAM_URL = BASE + '/stream.html';
  const SETTING_URL= BASE + '/setting.html';
  const LOGO_URL   = BASE + '/media/photo/logo.png';
  const LIB_BASE   = BASE + '/lib';

  // Use unsafeWindow to access real DOM (Tampermonkey sandbox isolation)
  const w   = unsafeWindow || window;
  const doc = w.document;

  // ── STORAGE (localStorage – accessible from both sandbox & page) ─────
  const LS_PREFIX = 'ck_';

  const store = {
    get(key) {
      try { const r = localStorage.getItem(LS_PREFIX + key); return r != null ? JSON.parse(r) : undefined; } catch { return undefined; }
    },
    set(key, value) {
      try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch {}
    },
  };

  // ── GM fetch helper (bypass CORS) ────────────────────────────────────
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url,
        onload: r => resolve(r.responseText),
        onerror: () => reject(new Error('Fetch failed: ' + url)),
      });
    });
  }

  // ── PGN fetcher ───────────────────────────────────────────────────────
  function normalizeUser(v) { return String(v || '').trim().replace(/^@+/, '').toLowerCase(); }

  function parseGameUrl(url) {
    const m = String(url || '').match(/\/(?:analysis\/)?game\/(?:(live|daily)\/)?(\d+)/i);
    if (!m) return null;
    return { gameType: (m[1] || 'live').toLowerCase(), gameId: m[2] };
  }

  async function fetchGamePgn(gameUrl, usernameHints = []) {
    try {
      const meta = parseGameUrl(gameUrl);
      if (!meta) throw new Error('Invalid game URL');
      const users = [...new Set((usernameHints || []).map(normalizeUser).filter(Boolean))];
      for (const user of users) {
        try {
          const data = JSON.parse(await gmFetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`));
          for (const archiveUrl of (data.archives || []).slice(-6).reverse()) {
            try {
              const archive = JSON.parse(await gmFetch(archiveUrl));
              const found = (archive.games || []).find(g => String(g?.url || '').toLowerCase().includes(`/${meta.gameType}/${meta.gameId}`));
              if (found?.pgn) return { success: true, pgn: found.pgn };
            } catch {}
          }
        } catch {}
      }
      // Fallback: chess.com callback API
      try {
        const cb = JSON.parse(await gmFetch(`https://www.chess.com/callback/${meta.gameType}/game/${meta.gameId}`));
        const pgn = cb?.game?.pgn || cb?.pgn || '';
        if (pgn) return { success: true, pgn };
      } catch {}
      return { success: false, error: 'Not found', needsRetry: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── ENGINE HOST (Blob iframe) ─────────────────────────────────────────
  const ENGINE_HOST_CHANNEL = 'ch-engine-host';

  function createEngineHostIframe() {
    const engines = [
      { id: 'komodoro', url: LIB_BASE + '/komodoro-worker.js' },
      { id: 'stockfish', url: LIB_BASE + '/stockfish-worker.js' },
    ];
    const script = `
'use strict';
var CH='${ENGINE_HOST_CHANNEL}';
var ENGINES=${JSON.stringify(engines)};
var worker=null,ready=false,uciOk=false,isReadySent=false,active=null,booting=false,timer=null;
var queue=[];
function post(type,extra){window.parent.postMessage(Object.assign({channel:CH,type:type},extra||{}),'*');}
function flush(){if(!worker||!ready||!queue.length)return;queue.splice(0).forEach(function(c){worker.postMessage(c);});}
function kill(){try{worker&&worker.terminate();}catch(e){}worker=null;}
function start(i){
  i=i||0;
  if(i>=ENGINES.length){post('worker-error',{message:'No engine available'});return;}
  var e=ENGINES[i];booting=true;ready=false;uciOk=false;isReadySent=false;
  if(timer){clearTimeout(timer);timer=null;}
  kill();active=e;
  function fallback(msg){
    if(timer){clearTimeout(timer);timer=null;}kill();
    var next=ENGINES[i+1];
    if(!next){booting=false;post('worker-error',{message:msg});return;}
    post('engine-fallback',{from:e.id,to:next.id,message:msg});
    start(i+1);
  }
  try{
    worker=new Worker(e.url);
    worker.onmessage=function(ev){
      var line=typeof ev.data==='string'?ev.data:String(ev.data||'');
      post('engine-message',{line:line});
      if(!uciOk&&/uciok/.test(line)){uciOk=true;if(!isReadySent){isReadySent=true;worker.postMessage('isready');}}
      if(/readyok/.test(line)){booting=false;if(!ready){if(timer){clearTimeout(timer);timer=null;}ready=true;post('ready',{engine:e.id});flush();}}
    };
    worker.onerror=function(err){
      var msg=err&&err.message||'Worker error';
      if(booting||!ready){fallback(msg);}else{post('worker-error',{message:msg});}
    };
    timer=setTimeout(function(){fallback(e.id+' timeout');},12000);
    worker.postMessage('uci');
  }catch(err){fallback(String(err));}
}
window.addEventListener('message',function(e){
  if(!e.data||e.data.channel!==CH||e.data.type!=='command')return;
  var cmd=String(e.data.command||'').trim();
  if(!cmd)return;
  if(!worker||!ready){queue.push(cmd);return;}
  worker.postMessage(cmd);
});
start(0);
`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>${script}<\/script></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const iframe = doc.createElement('iframe');
    iframe.src = URL.createObjectURL(blob);
    iframe.id = 'ch-engine-host';
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, { position:'fixed', width:'0', height:'0', border:'0', opacity:'0', pointerEvents:'none', left:'-9999px', top:'-9999px' });
    return iframe;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  MAIN LOGIC (runs in Tampermonkey sandbox, accesses DOM via doc/w)
  // ══════════════════════════════════════════════════════════════════════

  const LOG = '[Chess Killer]';
  const log   = (...a) => console.log(LOG, ...a);
  const warn  = (...a) => console.warn(LOG, ...a);
  const error = (...a) => console.error(LOG, ...a);

  const SITE = w.location.hostname.includes('lichess.org') ? 'lichess' : 'chesscom';
  const CONFIG_KEY = 'chConfig';

  const DEFAULT_CONFIG = {
    depth: 15, lines: 3, enabled: true, showEval: true, showArrows: true,
    hintStyle: 'classic', showPanel: false,
    autoPlayMode: 'off', autoPlayDelay: 1500, autoPlayAutoInterval: false,
    autoPlayDelayMin: 500, autoPlayDelayMax: 10000,
    quickMoveKey: ' ', eloLimit: 0,
    colors: ['#4f8cff', '#2ecc71', '#f1c40f', '#e67e22', '#e74c3c'],
  };

  const PIECE_LABEL = { p:'Tốt',n:'Mã',b:'Tượng',r:'Xe',q:'Hậu',k:'Vua',P:'Tốt',N:'Mã',B:'Tượng',R:'Xe',Q:'Hậu',K:'Vua' };

  const state = { fen: null, turn: null, myColor: null, engineMoves: [], engineAnalyzing: false };
  let cfg = { ...DEFAULT_CONFIG };
  let configReady = false, uiBuilt = false, renderPending = false;

  // Engine
  let worker = null, engineHostFrame = null, engineHostReady = false;
  let engineListenerInstalled = false, engineCommandQueue = [];
  let moveMap = new Map(), analysisTimer = null, activeAnalysisFen = '', pendingAnalysisFen = '';
  let lastAnalyzedFen = '', eloOptionsSent = false;

  // Overlay
  let lastHintSignature = '', lastStreamPublishKey = '';

  // Auto-move
  let autoMoveInFlight = false, autoMoveTimer = null, autoMoveError = null;
  let consecutiveAutoMoveFailures = 0, quickMovePending = false;

  // Polling
  let updatePollTimer = null, observerDebounce = null;

  // UI refs
  let elFen, elSide, elTurn, elMoves, elMovesLabel, elStatus, elPanel;
  let elAutoModeButtons = [], prevTurnForNotify = null;

  const IS_TOUCH = (navigator.maxTouchPoints || 0) > 0;

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // ── Site adapters ─────────────────────────────────────────────────────

  const chesscom = {
    getBoardEl() {
      return doc.querySelector('wc-chess-board') || doc.querySelector('chess-board') || doc.querySelector('.board');
    },
    getOrientation() {
      const board = this.getBoardEl();
      if (!board) return 'white';
      if (board.classList.contains('flipped')) return 'black';
      const attr = board.getAttribute('orientation') || board.getAttribute('data-board-orientation') || '';
      if (attr) return attr.toLowerCase().includes('black') ? 'black' : 'white';
      try {
        const br = board.getBoundingClientRect();
        const pieces = [...board.querySelectorAll('.piece')];
        if (br.width > 40 && pieces.length) {
          const cW = br.width / 8, cH = br.height / 8;
          const score = (orient) => {
            let t = 0, n = 0;
            for (const el of pieces) {
              const cls = String(el.className || '');
              const sm = cls.match(/\bsquare-(\d)(\d)\b/);
              if (!sm) continue;
              const f = parseInt(sm[1], 10) - 1, rk = parseInt(sm[2], 10);
              const r = el.getBoundingClientRect();
              if (!r.width) continue;
              const aX = r.left + r.width / 2 - br.left, aY = r.top + r.height / 2 - br.top;
              const eC = orient === 'black' ? 7 - f : f, eR = orient === 'black' ? rk - 1 : 8 - rk;
              t += Math.hypot(aX - (eC + .5) * cW, aY - (eR + .5) * cH); n++;
            }
            return n ? t / n : Infinity;
          };
          return score('black') + 1 < score('white') ? 'black' : 'white';
        }
      } catch (_) {}
      return 'white';
    },
    readFen() {
      const board = this.getBoardEl();
      if (!board) return null;
      for (const key of ['game', '_game']) {
        if (board[key]?.getFEN) try { const f = board[key].getFEN(); if (f?.includes('/')) return f; } catch (_) {}
      }
      try {
        const fk = Object.keys(board).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (fk) {
          let node = board[fk];
          for (let i = 0; i < 30 && node; i++, node = node.return) {
            const f = node.memoizedProps?.fen || node.memoizedState?.fen || node.stateNode?.state?.fen || node.stateNode?.props?.fen;
            if (f?.includes('/')) return f;
          }
        }
      } catch (_) {}
      const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
      const pieces = board.querySelectorAll('.piece');
      if (!pieces.length) return null;
      let parsed = 0;
      pieces.forEach(p => {
        const cls = p.className || '';
        const pm = cls.match(/\b([wb][pnbrqk])\b/), sm = cls.match(/\bsquare-(\d)(\d)\b/);
        if (!pm || !sm) return;
        const file = parseInt(sm[1], 10) - 1, rank = parseInt(sm[2], 10) - 1;
        if (file < 0 || file > 7 || rank < 0 || rank > 7) return;
        grid[7 - rank][file] = pm[1][0] === 'w' ? pm[1][1].toUpperCase() : pm[1][1];
        parsed++;
      });
      if (parsed < 2) return null;
      return buildFenFromGrid(grid) + ' ' + this.readTurn() + ' - - 0 1';
    },
    readTurn() {
      const board = this.getBoardEl();
      if (!board) return state.turn || 'w';
      const ht = detectTurnFromHighlight(board, 'chesscom', this.getOrientation());
      if (ht) return ht;
      if (board.game) try { const t = board.game.getTurn?.() || board.game.turn?.(); if (t === 'white' || t === 'w') return 'w'; if (t === 'black' || t === 'b') return 'b'; } catch (_) {}
      const clocks = doc.querySelectorAll('.clock-component,[class*="clock"]');
      for (const clk of clocks) {
        if (!isVisible(clk)) continue;
        const running = clk.classList.contains('clock-running') || clk.getAttribute('data-running') === 'true';
        if (!running) continue;
        const isBtm = clk.classList.contains('clock-bottom') || !!clk.closest('[class*="bottom"]');
        const isTop = clk.classList.contains('clock-top') || !!clk.closest('[class*="top"]');
        const or = this.getOrientation();
        if (isBtm) return or === 'black' ? 'b' : 'w';
        if (isTop) return or === 'black' ? 'w' : 'b';
      }
      return state.turn || 'w';
    },
    getMyColor() { return this.getOrientation() === 'black' ? 'b' : 'w'; },
  };

  const lichess = {
    isSupportedPage() {
      const p = w.location.pathname || '/';
      return /^\/[A-Za-z0-9]{8,12}(\/|$)/.test(p) || /^\/(analysis|study|practice|training|puzzle|broadcast)(\/|$)/.test(p);
    },
    findBoardWrap() {
      if (!this.isSupportedPage()) return null;
      for (const s of ['main.round .cg-wrap', '.round__app .cg-wrap', 'main.analyse .cg-wrap', '.analyse .cg-wrap', '.study__board .cg-wrap', 'main.puzzle .cg-wrap', 'main .cg-wrap']) {
        const el = doc.querySelector(s);
        if (el && isVisible(el)) return el;
      }
      return null;
    },
    getBoardEl() { const w2 = this.findBoardWrap(); if (!w2) return null; return w2.querySelector('cg-board') || w2; },
    getBoardWrap() { return this.findBoardWrap(); },
    getOrientation() {
      const wrap = this.getBoardWrap();
      if (!wrap) return 'white';
      if (wrap.getAttribute('data-orientation') === 'black') return 'black';
      if (wrap.classList.contains('orientation-black')) return 'black';
      return 'white';
    },
    readFen() {
      const board = this.getBoardEl();
      if (!board) return null;
      const br = board.getBoundingClientRect();
      if (!br.width) return null;
      const cW = br.width / 8, cH = br.height / 8;
      const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
      const orient = this.getOrientation();
      const pieces = board.querySelectorAll('piece');
      if (!pieces.length) return null;
      let parsed = 0;
      pieces.forEach(p => {
        const cls = p.className || '';
        const isW = cls.includes('white'), isB = cls.includes('black');
        if (!isW && !isB) return;
        const typeMap = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
        let type = null;
        for (const [nm, ch] of Object.entries(typeMap)) if (cls.includes(nm)) { type = ch; break; }
        if (!type) return;
        let x = null, y = null;
        const style = p.getAttribute('style') || '';
        const mt = style.match(/translate(?:3d)?\(\s*([\d.]+)px,\s*([\d.]+)px/);
        if (mt) { x = parseFloat(mt[1]); y = parseFloat(mt[2]); }
        else { const r = p.getBoundingClientRect(); x = r.left - br.left + r.width / 2; y = r.top - br.top + r.height / 2; }
        if (x === null) return;
        let col = Math.max(0, Math.min(7, Math.round(x / cW))), row = Math.max(0, Math.min(7, Math.round(y / cH)));
        const gC = orient === 'black' ? 7 - col : col, gR = orient === 'black' ? 7 - row : row;
        grid[gR][gC] = isW ? type.toUpperCase() : type;
        parsed++;
      });
      if (parsed < 2) return null;
      return buildFenFromGrid(grid) + ' ' + this.readTurn() + ' - - 0 1';
    },
    readTurn() {
      const board = this.getBoardEl();
      if (board) { const ht = detectTurnFromHighlight(board, 'lichess', this.getOrientation()); if (ht) return ht; }
      const clocks = doc.querySelectorAll('.rclock,.clock,[class*="clock"]');
      for (const clk of clocks) {
        if (!isVisible(clk)) continue;
        if (!clk.classList.contains('running') && !clk.classList.contains('clock-running')) continue;
        const isBtm = clk.classList.contains('rclock-bottom') || !!clk.closest('.player.bottom');
        const isTop = clk.classList.contains('rclock-top') || !!clk.closest('.player.top');
        const or = this.getOrientation();
        if (isBtm) return or === 'black' ? 'b' : 'w';
        if (isTop) return or === 'black' ? 'w' : 'b';
      }
      return state.turn || 'w';
    },
    getMyColor() { return this.getOrientation() === 'black' ? 'b' : 'w'; },
  };

  const adapter = SITE === 'lichess' ? lichess : chesscom;
  const getBoardEl = () => adapter.getBoardEl();
  const getBoardOrientation = () => adapter.getOrientation();
  const readFenFromDom = () => adapter.readFen();
  const readTurn = () => adapter.readTurn();
  const getMyColor = () => adapter.getMyColor();

  // ── FEN helpers ────────────────────────────────────────────────────────

  function buildFenFromGrid(grid) {
    let fen = '';
    for (let r = 0; r < 8; r++) {
      let e = 0;
      for (let c = 0; c < 8; c++) {
        if (grid[r][c]) { if (e) { fen += e; e = 0; } fen += grid[r][c]; } else e++;
      }
      if (e) fen += e;
      if (r < 7) fen += '/';
    }
    return fen;
  }

  function fenTurn(fen) { const p = String(fen || '').trim().split(/\s+/); return /^[wb]$/.test(p[1]) ? p[1] : null; }

  function pieceAtSquare(fen, sq) {
    if (!fen || !sq) return '';
    const file = sq.charCodeAt(0) - 97, rank = parseInt(sq[1], 10);
    if (file < 0 || file > 7 || rank < 1 || rank > 8) return '';
    const rows = fen.split(' ')[0]?.split('/') || [];
    const row = rows[8 - rank];
    if (!row) return '';
    let col = 0;
    for (const ch of row) { if (/\d/.test(ch)) { col += +ch; continue; } if (col === file) return ch; col++; }
    return '';
  }

  function oppTurn(t) { return t === 'w' ? 'b' : t === 'b' ? 'w' : null; }

  // ── Board square helpers ───────────────────────────────────────────────

  function getSquareCenter(sq, board) {
    if (!board) return null;
    if (SITE === 'chesscom') {
      // Use piece positions to build geometry
      const br = board.getBoundingClientRect();
      if (!br.width) return null;
      const samples = [];
      board.querySelectorAll('.piece').forEach(el => {
        const cls = String(el.className || '');
        const m = cls.match(/\bsquare-(\d)(\d)\b/);
        if (!m) return;
        const file = parseInt(m[1], 10), rank = parseInt(m[2], 10);
        if (file < 1 || file > 8 || rank < 1 || rank > 8) return;
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        samples.push({ file, rank, x: r.left + r.width / 2 - br.left, y: r.top + r.height / 2 - br.top });
      });
      if (samples.length >= 2) {
        const fit = (pts, k, ok) => {
          const n = pts.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
          for (const p of pts) { const x = p[k], y = p[ok]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
          const den = n * sxx - sx * sx;
          if (Math.abs(den) < 1e-6) return null;
          return { a: (n * sxy - sx * sy) / den, b: (sy - (n * sxy - sx * sy) / den * sx) / n };
        };
        const xF = fit(samples, 'file', 'x'), yF = fit(samples, 'rank', 'y');
        if (xF && yF) {
          const file = sq.charCodeAt(0) - 96, rank = parseInt(sq[1], 10);
          if (file >= 1 && file <= 8 && rank >= 1 && rank <= 8) {
            return { x: br.left + xF.a * file + xF.b, y: br.top + yF.a * rank + yF.b };
          }
        }
      }
      // Fallback grid
      const file = sq.charCodeAt(0) - 97, rank = parseInt(sq[1], 10);
      const orient = this ? this.getOrientation() : getBoardOrientation();
      const col = orient === 'black' ? 7 - file : file, row = orient === 'black' ? rank - 1 : 8 - rank;
      return { x: br.left + (col + .5) * br.width / 8, y: br.top + (row + .5) * br.height / 8 };
    }
    // Lichess
    const refEl = (SITE === 'lichess' && adapter.getBoardWrap?.()) || board;
    const br = refEl.getBoundingClientRect();
    if (br.width < 64) return null;
    const file = sq.charCodeAt(0) - 97, rank = parseInt(sq[1], 10);
    const orient = getBoardOrientation();
    const col = orient === 'black' ? 7 - file : file, row = orient === 'black' ? rank - 1 : 8 - rank;
    return { x: br.left + (col + .5) * br.width / 8, y: br.top + (row + .5) * br.height / 8 };
  }

  function squareFromClassName(cls) {
    const m = String(cls || '').match(/\bsquare-(\d)(\d)\b/);
    if (!m) return null;
    const f = parseInt(m[1], 10), r = parseInt(m[2], 10);
    if (f < 1 || f > 8 || r < 1 || r > 8) return null;
    return String.fromCharCode(96 + f) + r;
  }

  function squareFromElemRect(board, el, orient) {
    if (!board || !el?.getBoundingClientRect) return null;
    const br = board.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!br.width || !r.width) return null;
    const x = r.left + r.width / 2 - br.left, y = r.top + r.height / 2 - br.top;
    const cW = br.width / 8, cH = br.height / 8;
    let col = Math.max(0, Math.min(7, Math.floor(x / cW))), row = Math.max(0, Math.min(7, Math.floor(y / cH)));
    const fi = orient === 'black' ? 7 - col : col, rk = orient === 'black' ? row + 1 : 8 - row;
    return String.fromCharCode(97 + fi) + rk;
  }

  function getHighlightedSquares(board, site, orient) {
    const out = [], seen = new Set();
    const add = sq => { if (!sq || seen.has(sq)) return; seen.add(sq); out.push(sq); };
    if (site === 'chesscom') {
      board.querySelectorAll('.highlight,.move-square,.last-move,[class*="highlight"],[class*="move-square"],[class*="last-move"]').forEach(el => add(squareFromClassName(el.className)));
    } else {
      board.querySelectorAll('square.last-move,square.move-from,square.move-to,.last-move,.move-from,.move-to').forEach(el => {
        const csq = String(el.className || '').match(/\b([a-h][1-8])\b/i)?.[1]?.toLowerCase();
        add(csq || squareFromElemRect(board, el, orient));
      });
    }
    return out;
  }

  function getPieceColorAtSquare(board, sq, site, orient) {
    if (!board || !sq) return null;
    if (site === 'chesscom') {
      const f = sq.charCodeAt(0) - 96, r = sq[1];
      const t = board.querySelector(`.piece.square-${f}${r}`);
      const m = String(t?.className || '').match(/\b([wb])[pnbrqk]\b/i);
      return m ? m[1].toLowerCase() : null;
    }
    for (const p of board.querySelectorAll('piece')) {
      if (squareFromElemRect(board, p, orient) !== sq) continue;
      const cls = String(p.className || '');
      if (/\bwhite\b/i.test(cls)) return 'w';
      if (/\bblack\b/i.test(cls)) return 'b';
    }
    return null;
  }

  function detectTurnFromHighlight(board, site, orient) {
    const squares = getHighlightedSquares(board, site, orient);
    for (let i = squares.length - 1; i >= 0; i--) {
      const c = getPieceColorAtSquare(board, squares[i], site, orient);
      if (c) return oppTurn(c);
    }
    return null;
  }

  // ── ENGINE ─────────────────────────────────────────────────────────────

  function installEngineListener() {
    if (engineListenerInstalled) return;
    engineListenerInstalled = true;
    w.addEventListener('message', e => {
      if (e.source !== engineHostFrame?.contentWindow) return;
      const data = e.data || {};
      if (data.channel !== ENGINE_HOST_CHANNEL) return;
      if (data.type === 'ready') { engineHostReady = true; flushEngineQueue(); log('engine:ready'); maybeAnalyze(); return; }
      if (data.type === 'worker-error') { autoMoveError = data.message || 'Engine error'; scheduleRender(); return; }
      if (data.type === 'engine-message') onEngineMsg(data.line);
    });
  }

  function postToEngine(cmd) {
    if (!engineHostFrame?.contentWindow || !engineHostReady) { engineCommandQueue.push(cmd); return; }
    engineHostFrame.contentWindow.postMessage({ channel: ENGINE_HOST_CHANNEL, type: 'command', command: cmd }, '*');
  }

  function flushEngineQueue() {
    if (!engineHostReady || !engineCommandQueue.length) return;
    engineCommandQueue.splice(0).forEach(cmd => postToEngine(cmd));
  }

  function startEngine() {
    try {
      installEngineListener();
      worker = { postMessage: cmd => postToEngine(cmd) };
      if (!engineHostFrame) {
        engineHostFrame = createEngineHostIframe();
        (doc.documentElement || doc.body).appendChild(engineHostFrame);
      }
    } catch (err) { error('engine:start-failed', err); }
  }

  function sendEloOptions() {
    if (!engineHostReady) return;
    if (cfg.eloLimit > 0) {
      worker.postMessage('setoption name UCI_LimitStrength value true');
      worker.postMessage(`setoption name UCI_Elo value ${cfg.eloLimit}`);
    } else {
      worker.postMessage('setoption name UCI_LimitStrength value false');
    }
    eloOptionsSent = true;
  }

  function onEngineMsg(line) {
    if (!line) return;
    if (line.startsWith('info') && line.includes(' pv ')) {
      const depth = +(line.match(/\bdepth (\d+)/) || [])[1];
      if (!depth || depth < 4) return;
      const pvIdx = +(line.match(/\bmultipv (\d+)/) || [, 1])[1];
      const scoreMt = line.match(/\bscore (cp|mate) (-?\d+)/);
      const pvMt = line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (!pvMt) return;
      const from = pvMt[1].slice(0, 2), to = pvMt[1].slice(2, 4), promo = pvMt[1].slice(4) || '';
      const fen = activeAnalysisFen || state.fen;
      const src = pieceAtSquare(fen, from), turn = fenTurn(fen);
      if (src && turn) { const isW = src === src.toUpperCase(); if ((turn === 'w') !== isW) return; }
      const ex = moveMap.get(pvIdx);
      if (ex && ex.depth > depth) return;
      let evalText = '', scoreCp = null, scoreMate = null;
      if (scoreMt) {
        let score = Number(scoreMt[2]);
        if (turn === 'b') score = -score;
        if (scoreMt[1] === 'mate') { scoreMate = score; evalText = '#' + score; }
        else { scoreCp = score; evalText = score >= 0 ? '+' + (score / 100).toFixed(1) : (score / 100).toFixed(1); }
      }
      moveMap.set(pvIdx, { from, to, promo, eval: evalText, depth, cp: scoreCp, mate: scoreMate });
      return;
    }
    if (line.startsWith('bestmove')) {
      finishAnalysis();
      const moves = [...moveMap.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).slice(0, cfg.lines);
      state.engineMoves = moves;
      drawHints(moves);
      scheduleRender();
      if (quickMovePending && moves.length) triggerQuickMove('pending');
      if (cfg.autoPlayMode !== 'off' && state.myColor && state.turn === state.myColor && moves.length) {
        const chosen = cfg.autoPlayMode === 'random' ? moves[Math.floor(Math.random() * moves.length)] : moves[0];
        const delay = cfg.autoPlayAutoInterval
          ? cfg.autoPlayDelayMin + Math.floor(Math.random() * (cfg.autoPlayDelayMax - cfg.autoPlayDelayMin + 1))
          : cfg.autoPlayDelay;
        clearTimeout(autoMoveTimer);
        autoMoveTimer = setTimeout(async () => {
          if (!chosen) { autoMoveTimer = null; return; }
          autoMoveInFlight = true;
          try {
            const ok = await applyMove(chosen);
            if (ok) consecutiveAutoMoveFailures = 0;
            else {
              consecutiveAutoMoveFailures++;
              if (consecutiveAutoMoveFailures >= 2) { cfg.autoPlayMode = 'off'; autoMoveError = 'Disabled after 2 failures'; scheduleRender(); }
            }
          } finally { autoMoveInFlight = false; autoMoveTimer = null; }
        }, delay);
      }
    }
  }

  function analyzePosition(fen, reason) {
    if (!worker || !engineHostReady || !fen || !cfg.enabled) return;
    if (state.engineAnalyzing) { pendingAnalysisFen = fen; return; }
    state.engineAnalyzing = true;
    state.engineMoves = [];
    clearOverlay();
    activeAnalysisFen = fen;
    moveMap.clear();
    clearTimeout(analysisTimer);
    analysisTimer = setTimeout(() => { finishAnalysis(); autoMoveError = 'Engine timeout'; scheduleRender(); }, 12000);
    worker.postMessage('stop');
    if (!eloOptionsSent) sendEloOptions();
    worker.postMessage(`setoption name MultiPV value ${cfg.lines}`);
    worker.postMessage('isready');
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${cfg.depth} movetime 8000`);
  }

  function finishAnalysis() {
    state.engineAnalyzing = false; activeAnalysisFen = '';
    clearTimeout(analysisTimer);
    const q = pendingAnalysisFen; pendingAnalysisFen = '';
    if (q) setTimeout(() => analyzePosition(q, 'queued'), 0);
  }

  function maybeAnalyze() {
    if (!configReady || !cfg.enabled || !state.fen || !state.turn || !state.myColor) return;
    if (state.turn !== state.myColor) {
      if (state.engineMoves.length || lastHintSignature) { state.engineMoves = []; clearOverlay(); scheduleRender(); }
      return;
    }
    if (lastAnalyzedFen === state.fen && state.engineMoves.length) return;
    lastAnalyzedFen = state.fen;
    analyzePosition(state.fen, 'hint-only');
  }

  // ── OVERLAY ────────────────────────────────────────────────────────────

  function clearOverlay() {
    doc.querySelectorAll('svg.ch-hint-overlay').forEach(s => s.remove());
    lastHintSignature = '';
  }

  function isGameEndModalVisible() {
    if (SITE !== 'chesscom') return false;
    const m = doc.querySelector('#board-layout-chessboard > div.board-modal-container-container > div > div');
    return !!(m && isVisible(m) && (m.querySelector('.board-modal-buttons,.buttons') || m.childElementCount > 0));
  }

  function hasOverlay(board) {
    const host = board?.parentElement || doc.body;
    const svg = host?.querySelector('svg.ch-hint-overlay');
    return !!(svg?.isConnected && svg.querySelector('[data-role="hint-arrow"]'));
  }

  function getOverlayHost(board) {
    if (SITE === 'lichess') { const wr = adapter.getBoardWrap?.(); if (wr) return wr; }
    return board.parentElement || doc.body;
  }

  function getOverlayRef(board) {
    if (SITE === 'lichess') return adapter.getBoardWrap?.() || board;
    return board;
  }

  function svgNode(tag, attrs) {
    const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }

  function drawHints(moves) {
    if (!cfg.showArrows) { clearOverlay(); return; }
    const board = getBoardEl();
    if (!board) return;
    const nm = (moves || []).filter(m => m?.from && m?.to).slice(0, cfg.lines);
    const sig = JSON.stringify([state.fen, getBoardOrientation(), nm.map(m => m.from + m.to + (m.eval || ''))]);
    if (sig === lastHintSignature && hasOverlay(board)) return;

    const host = getOverlayHost(board);
    const refEl = getOverlayRef(board);
    const hostRect = host.getBoundingClientRect();
    const boardRect = refEl.getBoundingClientRect();

    let svg = host.querySelector('svg.ch-hint-overlay');
    if (!svg) {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      svg = svgNode('svg', { class: 'ch-hint-overlay' });
      Object.assign(svg.style, { position: 'absolute', pointerEvents: 'none', zIndex: '9998' });
      host.appendChild(svg);
    }
    Object.assign(svg.style, {
      left: `${boardRect.left - hostRect.left}px`, top: `${boardRect.top - hostRect.top}px`,
      width: `${boardRect.width}px`, height: `${boardRect.height}px`,
    });
    svg.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
    svg.innerHTML = '';

    const cell = boardRect.width / 8;
    let drawn = 0;

    nm.forEach((move, idx) => {
      const fp = getSquareCenter(move.from, board);
      const tp = getSquareCenter(move.to, board);
      if (!fp || !tp) return;
      const x1 = fp.x - boardRect.left, y1 = fp.y - boardRect.top;
      const x2 = tp.x - boardRect.left, y2 = tp.y - boardRect.top;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      if (!Number.isFinite(len) || len < cell * 0.22) return;
      const nx = dx / len, ny = dy / len;
      const color = cfg.colors[idx] || '#888';
      const alpha = idx === 0 ? 0.9 : 0.72;
      const headLen = Math.max(8, cell * (idx === 0 ? 0.3 : 0.26));
      const halfHead = Math.max(4, cell * (idx === 0 ? 0.12 : 0.10));
      const lineW = Math.max(2.2, cell * (idx === 0 ? 0.09 : 0.065));
      const ang = Math.atan2(dy, dx);
      const sx = x1 + nx * cell * 0.2, sy = y1 + ny * cell * 0.2;
      const ex2 = x2 - nx * headLen * 0.78, ey2 = y2 - ny * headLen * 0.78;

      svg.appendChild(svgNode('path', { 'data-role': 'hint-arrow', d: `M ${sx} ${sy} L ${ex2} ${ey2}`, stroke: color, 'stroke-width': lineW, 'stroke-linecap': 'round', fill: 'none', opacity: alpha }));
      const lx = x2 - nx * headLen - Math.sin(ang) * halfHead, ly = y2 - ny * headLen + Math.cos(ang) * halfHead;
      const rx = x2 - nx * headLen + Math.sin(ang) * halfHead, ry = y2 - ny * headLen - Math.cos(ang) * halfHead;
      svg.appendChild(svgNode('polygon', { 'data-role': 'hint-arrow', points: `${x2},${y2} ${lx},${ly} ${rx},${ry}`, fill: color, opacity: alpha }));

      if (cfg.showEval && move.eval) {
        const lo = cell * 0.16;
        const txt = svgNode('text', {
          x: x2 + Math.sin(ang) * lo + cell * 0.08, y: y2 - Math.cos(ang) * lo - cell * 0.12,
          'font-size': Math.max(10, cell * (idx === 0 ? 0.22 : 0.19)), 'font-family': "Consolas,'Courier New',monospace",
          'font-weight': '700', 'text-anchor': 'start', 'dominant-baseline': 'middle',
          stroke: 'rgba(0,0,0,0.78)', 'stroke-width': Math.max(2.2, cell * 0.06), 'stroke-linejoin': 'round',
          'paint-order': 'stroke', fill: color, opacity: alpha,
        });
        txt.textContent = move.eval;
        svg.appendChild(txt);
      }
      drawn++;
    });

    if (!drawn) { svg.remove(); lastHintSignature = ''; return; }
    lastHintSignature = sig;
  }

  function ensureOverlayVisible() {
    if (!cfg.showArrows || !state.engineMoves.length) return;
    if (isGameEndModalVisible()) { clearOverlay(); return; }
    const board = getBoardEl();
    if (board && !hasOverlay(board)) { lastHintSignature = ''; drawHints(state.engineMoves); }
  }

  // ── STREAM ─────────────────────────────────────────────────────────────

  function publishStream() {
    if (!state.fen) return;
    const board = getBoardEl();
    const lastMoveSquares = board ? getHighlightedSquares(board, SITE, getBoardOrientation()).slice(0, 2) : [];
    const payload = {
      fen: state.fen, turn: fenTurn(state.fen), playerSide: state.myColor, lastMoveSquares,
      moves: (cfg.enabled ? state.engineMoves : []).slice(0, cfg.lines).map(m => ({ from: m.from, to: m.to, promo: m.promo || '', eval: cfg.showEval ? (m.eval || '') : '' })),
      colors: cfg.colors.slice(0, 5), orientation: getBoardOrientation(),
      updatedAt: Date.now(), source: w.location.href, site: SITE,
    };
    const key = JSON.stringify([payload.fen, payload.turn, payload.playerSide, payload.orientation,
      payload.lastMoveSquares.join('|'), payload.moves.map(m => m.from + m.to + m.eval).join('|'), payload.colors.join('|')]);
    if (key === lastStreamPublishKey) return;
    lastStreamPublishKey = key;
    // Write to localStorage so stream.html can read it
    store.set('chStreamState', payload);
  }

  // ── AUTO-MOVE ───────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function dispatchME(target, type, x, y, buttons) {
    if (!target?.dispatchEvent) return;
    target.dispatchEvent(new w.PointerEvent(type, { view: w, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: IS_TOUCH ? 'touch' : 'mouse', isPrimary: true, button: 0, buttons }));
    target.dispatchEvent(new w.MouseEvent(type.replace(/^pointer/, 'mouse'), { view: w, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons }));
  }

  async function applyMove(move) {
    autoMoveError = null;
    const board = getBoardEl();
    if (!board) return false;
    const fp = getSquareCenter(move.from, board), tp = getSquareCenter(move.to, board);
    if (!fp || !tp) return false;
    const fenBefore = state.fen;
    try {
      const fromEl = doc.elementFromPoint(fp.x, fp.y), toEl = doc.elementFromPoint(tp.x, tp.y);
      if (fromEl) { fromEl.dispatchEvent(new w.MouseEvent('click', { view: w, bubbles: true, cancelable: true, composed: true, detail: 1, clientX: fp.x, clientY: fp.y, button: 0 })); await sleep(100); }
      if (toEl) { toEl.dispatchEvent(new w.MouseEvent('click', { view: w, bubbles: true, cancelable: true, composed: true, detail: 1, clientX: tp.x, clientY: tp.y, button: 0 })); await sleep(600); }
      if (state.fen && state.fen !== fenBefore) return true;
      // Try drag
      const startEl = doc.elementFromPoint(fp.x, fp.y) || board;
      const endEl = doc.elementFromPoint(tp.x, tp.y) || board;
      dispatchME(startEl, 'pointerdown', fp.x, fp.y, 1);
      await sleep(30);
      for (let i = 1; i <= 10; i++) {
        const mx = fp.x + (tp.x - fp.x) * (i / 10), my = fp.y + (tp.y - fp.y) * (i / 10);
        dispatchME(board, 'pointermove', mx, my, 1);
        await sleep(12);
      }
      dispatchME(endEl, 'pointerup', tp.x, tp.y, 0);
      endEl.dispatchEvent(new w.MouseEvent('click', { view: w, bubbles: true, cancelable: true, composed: true, clientX: tp.x, clientY: tp.y, button: 0 }));
      await sleep(600);
      return !!(state.fen && state.fen !== fenBefore);
    } catch (err) { autoMoveError = err?.message || String(err); scheduleRender(); return false; }
  }

  function isEditableTarget(t) {
    if (!(t instanceof Element)) return false;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
    return !!t.closest('[contenteditable=""],[contenteditable="true"],[role="textbox"]');
  }

  function isMyTurn() { const t = fenTurn(state.fen) || state.turn; return !!state.myColor && t === state.myColor; }

  function triggerQuickMove(reason) {
    if (!cfg.enabled || !configReady || !isMyTurn()) { quickMovePending = false; return false; }
    const best = state.engineMoves?.[0];
    if (!best?.from) { quickMovePending = !!state.engineAnalyzing; return false; }
    if (autoMoveInFlight) return false;
    quickMovePending = false;
    clearTimeout(autoMoveTimer); autoMoveTimer = null;
    autoMoveInFlight = true;
    applyMove(best).finally(() => { autoMoveInFlight = false; });
    return true;
  }

  // ── UI ──────────────────────────────────────────────────────────────────

  function buildUI() {
    if (uiBuilt || !doc.body) return;
    uiBuilt = true;

    const style = doc.createElement('style');
    style.textContent = `
      #ch-root{position:fixed;bottom:max(12px,env(safe-area-inset-bottom));right:max(12px,env(safe-area-inset-right));z-index:999999;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:12px;max-width:min(90vw,340px);touch-action:none;user-select:none}
      #ch-panel{background:linear-gradient(180deg,#262321 0%,#1b1a18 100%);border:1px solid #3a3835;border-radius:16px;min-width:min(278px,90vw);box-shadow:0 16px 36px rgba(0,0,0,.42);overflow:hidden}
      #ch-panel.mini .ch-body,#ch-panel.mini .ch-foot{display:none}
      .ch-hdr{display:flex;justify-content:space-between;align-items:center;padding:11px 13px 10px;background:linear-gradient(180deg,#1c1b18 0%,#13120f 100%);border-bottom:1px solid #3a3835;cursor:grab;touch-action:none}
      .ch-hdr>span{color:#e8e5e0;font-weight:700;font-size:14px}
      .ch-hdr-actions{display:flex;align-items:center;gap:6px}
      .ch-btn{background:#252422;border:1px solid #3a3835;color:#e8e5e0;border-radius:10px;padding:0 10px;cursor:pointer;font:600 11px system-ui;min-height:32px;touch-action:manipulation}
      .ch-btn:hover{background:#1c3050;border-color:#35577f}
      .ch-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0}
      .ch-icon-btn svg{width:14px;height:14px}
      .ch-segmented{display:flex;align-items:center;gap:4px}
      .ch-mode-btn{min-width:44px;flex:1 1 0;padding:0 6px}
      .ch-mode-btn.active,.ch-mode-btn:disabled{background:#1c3050;border-color:#6ea4ff;color:#fff;cursor:default;pointer-events:none}
      .ch-body{padding:10px 11px 8px;display:flex;flex-direction:column;gap:7px}
      .ch-row{display:grid;grid-template-columns:64px minmax(0,1fr) auto;align-items:center;gap:8px;padding:10px 11px;background:#1e1d1b;border:1px solid #3a3835;border-radius:13px}
      .ch-row-auto{grid-template-columns:64px minmax(0,1fr)}
      .ch-lbl{color:#888580;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
      .ch-val{color:#e8e5e0;word-break:break-word;line-height:1.4;font-size:12px}
      .ch-val.green{color:#76b730;font-size:10px;font-family:monospace}
      .ch-val.yellow{color:#f0c040;font-weight:600}
      .badge{display:inline-block;padding:3px 9px;border-radius:999px;font-weight:700;font-size:11px}
      .badge-w{background:#d5d0c8;color:#1a1a1a}
      .badge-b{background:#2e2c29;color:#e8e5e0;border:1px solid #4b4944}
      .myturn{animation:glow 1s ease-in-out infinite alternate}
      @keyframes glow{from{box-shadow:0 0 6px rgba(79,140,255,.35)}to{box-shadow:0 0 16px rgba(79,140,255,.7)}}
      .ch-foot{padding:7px 11px;border-top:1px solid #3a3835;font-size:10px;color:#76b730;background:rgba(0,0,0,.14)}
      .ch-moves-list{max-height:90px;overflow-y:auto;font-size:11px;color:#c0bdb8;white-space:pre;line-height:1.45;font-family:monospace}
      #ch-notify{position:fixed;top:max(20px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);background:linear-gradient(180deg,#1c1b18,#13120f);color:#e8e5e0;padding:10px 16px;border:1px solid #3a3835;border-radius:14px;font-weight:700;font-size:13px;z-index:9999999;box-shadow:0 12px 26px rgba(0,0,0,.32);animation:ndrop .35s ease}
      @keyframes ndrop{from{top:0;opacity:0}to{top:max(20px,env(safe-area-inset-top));opacity:1}}
    `;
    (doc.head || doc.documentElement).appendChild(style);

    const siteName = SITE === 'lichess' ? '♜ Chess Killer' : '♟ Chess Killer';
    const root = doc.createElement('div');
    root.id = 'ch-root';
    root.style.display = 'none';
    root.innerHTML = `<div id="ch-panel">
<div class="ch-hdr">
  <span>${siteName}</span>
  <div class="ch-hdr-actions">
    <button class="ch-btn ch-icon-btn" id="ch-review-btn" title="Open Review">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
    </button>
    <button class="ch-btn ch-icon-btn" id="ch-stream-btn" title="Stream Board">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    </button>
    <button class="ch-btn ch-icon-btn" id="ch-cfg-btn" title="Settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
    <button class="ch-btn" id="ch-min">-</button>
  </div>
</div>
<div class="ch-body">
  <div class="ch-row"><span class="ch-lbl">Your side</span><span class="ch-val" id="ch-side">Detecting...</span></div>
  <div class="ch-row"><span class="ch-lbl">Turn</span><span class="ch-val" id="ch-turn">-</span><button class="ch-btn" id="ch-fix-turn" style="font-size:10px">Fix</button></div>
  <div class="ch-row ch-row-auto">
    <span class="ch-lbl">Auto</span>
    <div class="ch-segmented">
      <button class="ch-btn ch-mode-btn" data-mode="best">Best</button>
      <button class="ch-btn ch-mode-btn" data-mode="random">Rng</button>
      <button class="ch-btn ch-mode-btn" data-mode="off">Off</button>
    </div>
  </div>
  <div class="ch-row"><span class="ch-lbl">FEN</span><span class="ch-val green" id="ch-fen">-</span><button class="ch-btn" id="ch-cp" style="font-size:10px;padding:1px 5px">CP</button></div>
  <div class="ch-row"><span class="ch-lbl">Hints</span><span class="ch-val yellow" id="ch-hints-label">-</span></div>
  <div class="ch-moves-list" id="ch-hints"></div>
</div>
<div class="ch-foot" id="ch-status">Tracking...</div>
</div>`;
    doc.body.appendChild(root);

    elFen       = root.querySelector('#ch-fen');
    elSide      = root.querySelector('#ch-side');
    elTurn      = root.querySelector('#ch-turn');
    elMoves     = root.querySelector('#ch-hints');
    elMovesLabel= root.querySelector('#ch-hints-label');
    elStatus    = root.querySelector('#ch-status');
    elPanel     = root.querySelector('#ch-panel');
    elAutoModeButtons = [...root.querySelectorAll('[data-mode]')];

    let mini = false;
    root.querySelector('#ch-min').addEventListener('click', () => {
      mini = !mini; elPanel.classList.toggle('mini', mini);
      root.querySelector('#ch-min').textContent = mini ? '[]' : '-';
    });
    root.querySelector('#ch-review-btn').addEventListener('click', () => w.open(REVIEW_URL, '_blank', 'noopener,width=1200,height=820'));
    root.querySelector('#ch-stream-btn').addEventListener('click', () => w.open(STREAM_URL, '_blank', 'noopener,width=900,height=650'));
    root.querySelector('#ch-cfg-btn').addEventListener('click', () => w.open(SETTING_URL, '_blank', 'noopener,width=480,height=700'));
    root.querySelector('#ch-cp').addEventListener('click', () => {
      navigator.clipboard?.writeText(elFen.textContent?.trim() || '').then(() => {
        const btn = root.querySelector('#ch-cp'); btn.textContent = 'OK'; setTimeout(() => btn.textContent = 'CP', 1200);
      }).catch(() => {});
    });
    elAutoModeButtons.forEach(btn => btn.addEventListener('click', () => {
      const nm = btn.dataset.mode || 'off';
      if (nm === cfg.autoPlayMode) return;
      cfg.autoPlayMode = nm; persistConfig(); scheduleRender(); maybeAnalyze();
    }));
    root.querySelector('#ch-fix-turn').addEventListener('click', () => {
      state.turn = state.turn === 'w' ? 'b' : 'w';
      if (state.fen) state.fen = state.fen.replace(/^(\S+) [wb]/, `$1 ${state.turn}`);
      scheduleRender(); maybeAnalyze();
    });

    // Draggable header
    const header = elPanel.querySelector('.ch-hdr');
    let drag = null;
    header.addEventListener('pointerdown', e => {
      if (e.target instanceof Element && e.target.closest('button')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const r = root.getBoundingClientRect();
      drag = { startX: e.clientX, startY: e.clientY, originLeft: r.left, originTop: r.top };
      header.style.cursor = 'grabbing';
      header.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }, { passive: false });
    doc.addEventListener('pointermove', e => {
      if (!drag) return;
      root.style.left = `${drag.originLeft + e.clientX - drag.startX}px`;
      root.style.top  = `${drag.originTop  + e.clientY - drag.startY}px`;
      root.style.right = 'auto'; root.style.bottom = 'auto';
    }, { passive: true });
    doc.addEventListener('pointerup', () => { drag = null; header.style.cursor = 'grab'; }, { passive: true });
  }

  function showNotify(msg) {
    doc.getElementById('ch-notify')?.remove();
    const n = doc.createElement('div'); n.id = 'ch-notify'; n.textContent = msg;
    doc.body.appendChild(n); setTimeout(() => n.remove(), 3000);
  }

  function scheduleRender() { if (renderPending) return; renderPending = true; requestAnimationFrame(render); }

  function render() {
    renderPending = false;
    if (!uiBuilt) buildUI();
    const root = doc.getElementById('ch-root');
    const pv = !!cfg.enabled && !!getBoardEl();
    if (root) root.style.display = pv ? '' : 'none';
    if (pv && elFen && elSide && elTurn && elMoves && elMovesLabel && elStatus) {
      if (state.myColor === 'w') elSide.innerHTML = '<span class="badge badge-w">WHITE</span>';
      else if (state.myColor === 'b') elSide.innerHTML = '<span class="badge badge-b">BLACK</span>';
      else elSide.textContent = 'Detecting...';
      const isMy = state.myColor && state.turn === state.myColor;
      if (state.turn === 'w') elTurn.innerHTML = `<span class="badge badge-w${isMy ? ' myturn' : ''}">WHITE</span>${isMy ? ' ← <b style="color:#4f8cff">YOUR TURN</b>' : ''}`;
      else if (state.turn === 'b') elTurn.innerHTML = `<span class="badge badge-b${isMy ? ' myturn' : ''}">BLACK</span>${isMy ? ' ← <b style="color:#4f8cff">YOUR TURN</b>' : ''}`;
      else elTurn.textContent = '-';
      if (isMy && prevTurnForNotify !== state.turn) showNotify('Your turn!');
      prevTurnForNotify = state.turn;
      elAutoModeButtons.forEach(btn => {
        const ia = btn.dataset.mode === cfg.autoPlayMode;
        btn.classList.toggle('active', ia); btn.disabled = ia;
      });
      elFen.textContent = state.fen || '-';
      if (state.turn !== state.myColor) { elMovesLabel.textContent = 'Opponent turn: waiting'; elMoves.textContent = ''; }
      else if (!cfg.enabled) { elMovesLabel.textContent = 'Hints disabled'; elMoves.textContent = ''; }
      else if (state.engineAnalyzing) { elMovesLabel.textContent = `Analyzing ${cfg.lines} hints...`; elMoves.textContent = ''; }
      else if (state.engineMoves.length) {
        elMovesLabel.textContent = `${state.engineMoves.length} engine hints`;
        elMoves.textContent = state.engineMoves.map((m, i) => {
          const p = pieceAtSquare(state.fen, m.from), name = PIECE_LABEL[p] || '?';
          const ev = cfg.showEval ? `  ${m.eval || '-'}` : '';
          return `  ${i + 1}. ${name} ${m.from.toUpperCase()}-${m.to.toUpperCase()}${ev}`;
        }).join('\n');
      } else { elMovesLabel.textContent = isMy ? 'No hints yet' : '-'; elMoves.textContent = ''; }
      const site = SITE === 'lichess' ? 'lichess' : 'chess.com';
      elStatus.textContent = state.fen ? `${site} | ${new Date().toLocaleTimeString()}` : 'Waiting for board...';
      elStatus.style.color = state.fen ? '#3dc96c' : '#f80';
      if (autoMoveError) { elStatus.textContent = `Auto error: ${autoMoveError}`; elStatus.style.color = '#ff6b6b'; }
    }
    publishStream();
    ensureOverlayVisible();
  }

  // ── CONFIG ─────────────────────────────────────────────────────────────

  function normalizeConfig(input) {
    const n = { ...DEFAULT_CONFIG, ...(input || {}) };
    n.depth = Math.min(25, Math.max(5, Number(n.depth) || 15));
    n.lines = Math.min(5, Math.max(1, Number(n.lines) || 3));
    n.autoPlayDelay = Math.min(5000, Math.max(300, Number(n.autoPlayDelay) || 1500));
    n.autoPlayDelayMin = Math.min(10000, Math.max(500, Number(n.autoPlayDelayMin) || 500));
    n.autoPlayDelayMax = Math.min(10000, Math.max(500, Number(n.autoPlayDelayMax) || 10000));
    if (n.autoPlayDelayMin > n.autoPlayDelayMax) [n.autoPlayDelayMin, n.autoPlayDelayMax] = [n.autoPlayDelayMax, n.autoPlayDelayMin];
    n.eloLimit = Number.isInteger(Number(n.eloLimit)) ? Number(n.eloLimit) : 0;
    n.colors = Array.isArray(n.colors) ? n.colors.slice(0, 5) : DEFAULT_CONFIG.colors.slice();
    while (n.colors.length < 5) n.colors.push(DEFAULT_CONFIG.colors[n.colors.length]);
    return n;
  }

  function persistConfig() { store.set(CONFIG_KEY, cfg); }

  function applyConfig(next) {
    const prevElo = cfg.eloLimit;
    cfg = normalizeConfig(next);
    configReady = true;
    lastHintSignature = '';
    if (prevElo !== cfg.eloLimit) eloOptionsSent = false;
    if (!cfg.enabled) { state.engineMoves = []; clearOverlay(); finishAnalysis(); }
    if (!cfg.showArrows) clearOverlay();
    scheduleRender();
    maybeAnalyze();
  }

  function loadConfig() {
    const saved = store.get(CONFIG_KEY);
    applyConfig(saved || DEFAULT_CONFIG);
    // Poll localStorage for changes (from setting.html)
    setInterval(() => {
      const latest = store.get(CONFIG_KEY);
      if (!latest) return;
      const sig = JSON.stringify(latest);
      if (sig !== JSON.stringify(cfg)) applyConfig(latest);
    }, 1000);
  }

  // ── MAIN LOOP ───────────────────────────────────────────────────────────

  function update() {
    const board = getBoardEl();
    if (!board) { scheduleRender(); return; }
    const nf = readFenFromDom(), nt = readTurn(), nc = getMyColor();
    const changed = nf !== state.fen || nt !== state.turn || nc !== state.myColor;
    if (nf) state.fen = nf;
    if (nt) state.turn = nt;
    state.myColor = nc;
    if (changed || !uiBuilt) { if (changed) { quickMovePending = false; autoMoveInFlight = false; } scheduleRender(); }
    if (changed && configReady) maybeAnalyze();
  }

  function startObserver() {
    if (!doc.body) return;
    const obs = new MutationObserver(() => { clearTimeout(observerDebounce); observerDebounce = setTimeout(update, 80); });
    obs.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'transform', 'data-orientation'] });
  }

  function startPolling() {
    clearInterval(updatePollTimer);
    updatePollTimer = setInterval(update, doc.hidden ? 4000 : 1500);
    doc.addEventListener('visibilitychange', () => { clearInterval(updatePollTimer); updatePollTimer = setInterval(update, doc.hidden ? 4000 : 1500); });
  }

  function bindShortcut() {
    doc.addEventListener('keydown', e => {
      if (!cfg.enabled || !configReady || e.repeat || e.metaKey || e.defaultPrevented) return;
      const key = cfg.quickMoveKey || ' ';
      const match = key === ' ' ? (e.code === 'Space' || e.key === ' ') : e.key?.toLowerCase() === key.toLowerCase();
      if (!match || isEditableTarget(e.target)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      triggerQuickMove('keydown');
    }, true);
  }

  // ── REVIEW BUTTONS (chess.com only) ────────────────────────────────────

  function setupReviewButtons() {
    if (SITE !== 'chesscom') return;
    const ATTR = 'data-ck-review';
    const MODAL_ATTR = 'data-ck-review-modal';
    const TOAST_ID = 'ck-review-toast';
    const SELECTORS = [
      '#profile-main table tbody tr',
      '#vue-instance > div:nth-child(5) > div > div > table > tbody > tr',
      '#games-root-index > div.table-responsive > table > tbody > tr',
    ];

    function hideToast() { doc.getElementById(TOAST_ID)?.remove(); }
    function showToast(msg, type, duration) {
      hideToast();
      const t = doc.createElement('div'); t.id = TOAST_ID;
      Object.assign(t.style, { position: 'fixed', top: '20px', right: '20px', zIndex: '2147483647', padding: '12px 18px', borderRadius: '10px', font: '600 14px/1.35 system-ui,sans-serif', color: '#fff', background: type === 'error' ? '#dc2626' : type === 'loading' ? '#2563eb' : '#059669', boxShadow: '0 8px 24px rgba(0,0,0,.28)' });
      if (type === 'loading') {
        if (!doc.getElementById('ck-spin-st')) { const s = doc.createElement('style'); s.id = 'ck-spin-st'; s.textContent = '@keyframes ck-spin{to{transform:rotate(360deg)}}'; doc.head.appendChild(s); }
        t.innerHTML = `<span style="width:14px;height:14px;border:2px solid rgba(255,255,255,.9);border-top-color:transparent;border-radius:999px;display:inline-block;animation:ck-spin 1s linear infinite;margin-right:8px"></span>${msg}`;
      } else { t.textContent = msg; }
      doc.body.appendChild(t);
      if (duration > 0) setTimeout(hideToast, duration);
    }

    function stop(e) { e.preventDefault(); e.stopPropagation(); }

    function makeBtn(label) {
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.title = label || 'Review'; btn.setAttribute('aria-label', label || 'Review');
      btn.innerHTML = `<img src="${LOGO_URL}" width="26" height="26" style="display:block" alt="Review">`;
      Object.assign(btn.style, { cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px', border: '0', borderRadius: '6px', background: 'transparent' });
      btn.setAttribute(ATTR, 'true');
      btn.addEventListener('mousedown', stop, true);
      return btn;
    }

    function getGameUrl(row) {
      for (const link of row.querySelectorAll('a[href*="/game/"]')) {
        const href = link.getAttribute('href');
        if (href && /\/(?:analysis\/)?game\/(?:(live|daily)\/)?(\d+)/.test(href))
          return href.startsWith('http') ? href : `https://www.chess.com${href}`;
      }
      return null;
    }

    function collectHints(row) {
      const users = new Set();
      const pm = w.location.pathname.match(/^\/member\/([^/?#]+)/i);
      if (pm) users.add(normalizeUser(pm[1]));
      row?.querySelectorAll?.('a[href*="/member/"]').forEach(a => {
        const m = a.getAttribute('href')?.match(/\/member\/([^/?#]+)/i);
        if (m) users.add(normalizeUser(m[1]));
      });
      return [...users];
    }

    async function openReview(gameUrl, hints) {
      if (!gameUrl) { showToast('Could not find a game link.', 'error', 3000); return; }
      showToast('Fetching PGN...', 'loading');
      try {
        const result = await fetchGamePgn(gameUrl, hints || []);
        if (result?.success && result.pgn) {
          const handoffKey = `review-pgn:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
          store.set(handoffKey, { pgn: result.pgn, gameUrl, usernameHints: hints || [], createdAt: Date.now() });
          hideToast();
          const params = new URLSearchParams({ pgnKey: handoffKey, gameUrl });
          const hu = (hints || []).map(normalizeUser).filter(Boolean).join(',');
          if (hu) params.set('usernames', hu);
          w.open(`${REVIEW_URL}?${params}`, '_blank', 'noopener,noreferrer');
        } else {
          hideToast();
          showToast(result?.needsRetry ? 'Game not archived yet. Try again.' : 'Could not fetch PGN.', result?.needsRetry ? 'info' : 'error', 4000);
        }
      } catch (err) {
        hideToast(); showToast(err.message || 'Error fetching PGN.', 'error', 4000);
      }
    }

    function injectIntoList(root2) {
      const rows = [];
      for (const sel of SELECTORS) root2?.querySelectorAll?.(sel).forEach(r => rows.push(r));
      rows.forEach(row => {
        if (row.querySelector(`[${ATTR}]`)) return;
        const table = row.closest('table'); if (!table) return;
        const hr = table.querySelector('thead tr');
        if (hr && !hr.querySelector('[data-ck-th]')) {
          const th = doc.createElement('th'); th.setAttribute('data-ck-th', 'true');
          Object.assign(th.style, { textAlign: 'center', width: '40px' });
          hr.appendChild(th);
        }
        const cell = doc.createElement('td');
        Object.assign(cell.style, { textAlign: 'center', verticalAlign: 'middle' });
        cell.setAttribute(ATTR, 'true');
        const btn = makeBtn('Review');
        btn.addEventListener('click', e => { stop(e); openReview(getGameUrl(row), collectHints(row)); }, true);
        cell.appendChild(btn); row.appendChild(cell);
      });
    }

    function injectIntoModal(root2) {
      const modal = root2?.querySelector?.('#board-layout-chessboard > div.board-modal-container-container > div > div');
      if (!modal || modal.querySelector(`[${MODAL_ATTR}]`)) return;
      const mount = modal.querySelector('.board-modal-buttons,.buttons') || modal.lastElementChild || modal;
      const btn = makeBtn('Review this game');
      btn.innerHTML = `<img src="${LOGO_URL}" width="22" height="22" style="margin-right:8px" alt="Review"><span>Review this game</span>`;
      Object.assign(btn.style, { width: '100%', minHeight: '44px', marginTop: '12px', padding: '10px 14px', border: '1px solid rgba(255,255,255,.08)', background: 'linear-gradient(180deg,#3d3d3d,#2e2e2e)', color: '#fff', font: '700 15px/1 system-ui,sans-serif' });
      btn.setAttribute(MODAL_ATTR, 'true');
      btn.addEventListener('click', e => { stop(e); openReview(w.location.href); }, true);
      mount.parentElement?.appendChild(btn);
    }

    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        m.addedNodes?.forEach(node => {
          if (!(node instanceof Element)) return;
          injectIntoList(node); injectIntoModal(node);
        });
      }
    });
    obs.observe(doc.body, { childList: true, subtree: true });
    injectIntoList(doc);
    injectIntoModal(doc);
  }

  // ── BOOT ────────────────────────────────────────────────────────────────

  function boot() {
    log(`boot [${SITE}]`);
    loadConfig();
    startEngine();
    buildUI();
    update();
    startObserver();
    startPolling();
    bindShortcut();
    setupReviewButtons();
    w.addEventListener('resize', () => { lastHintSignature = ''; scheduleRender(); }, { passive: true });
    log('boot:complete');
  }

  // Wait for body to be ready
  if (doc.body) {
    boot();
  } else {
    const bodyWait = setInterval(() => { if (doc.body) { clearInterval(bodyWait); boot(); } }, 50);
  }

})();
