// ==UserScript==
// @name         Chess Killer
// @namespace    https://nguyenphanvn95.github.io/chesskiller
// @version      3.4.5
// @description  Chess engine hints cho chess.com và lichess.org – không cần extension
// @author       Chess Killer
// @match        *://*.chess.com/*
// @match        *://*.lichess.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      chess.com
// @connect      api.chess.com
// @connect      lichess.org
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ================================================================
     BASE URL – nơi bạn deploy lên GitHub Pages
  ================================================================ */
  const BASE = 'https://nguyenphanvn95.github.io/chesskiller';
  const REVIEW_URL   = BASE + '/review.html';
  const STREAM_URL   = BASE + '/stream.html';
  const SETTING_URL  = BASE + '/setting.html';
  const LOGO_URL     = BASE + '/media/photo/logo.png';
  const LIB_BASE     = BASE + '/lib';

  /* ================================================================
     GM Storage shim – thay chrome.storage.local
  ================================================================ */
  const _storageListeners = [];
  const gmStorage = {
    get(keys, cb) {
      const result = {};
      for (const k of (Array.isArray(keys) ? keys : [keys])) {
        const raw = GM_getValue('ck_' + k);
        if (raw !== undefined) try { result[k] = JSON.parse(raw); } catch { result[k] = raw; }
      }
      cb(result);
    },
    set(data, cb) {
      const changes = {};
      for (const [k, v] of Object.entries(data)) {
        const oldRaw = GM_getValue('ck_' + k);
        const oldValue = oldRaw !== undefined ? (() => { try { return JSON.parse(oldRaw); } catch { return oldRaw; } })() : undefined;
        GM_setValue('ck_' + k, JSON.stringify(v));
        changes[k] = { oldValue, newValue: v };
      }
      if (cb) cb();
      for (const fn of _storageListeners) try { fn(changes, 'local'); } catch {}
    },
    onChanged: { addListener(fn) { _storageListeners.push(fn); } }
  };

  /* ================================================================
     Fetch PGN qua GM_xmlhttpRequest (bypass CORS)
     Thay thế cho chrome.runtime.sendMessage { action: 'fetchGamePgn' }
  ================================================================ */
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url,
        onload: r => resolve(r.responseText),
        onerror: e => reject(new Error('GM_xmlhttpRequest failed: ' + url)),
      });
    });
  }

  function parseChessComGameUrl(gameUrl) {
    const m = String(gameUrl || '').match(/\/(?:analysis\/)?game\/(?:(live|daily)\/)?(\d+)/i);
    if (!m) return null;
    return { gameType: (m[1] || 'live').toLowerCase(), gameId: m[2] };
  }

  function normalizeChessUsername(v) { return String(v || '').trim().replace(/^@+/, '').toLowerCase(); }

  async function fetchGamePgn(gameUrl, usernameHints = []) {
    try {
      const meta = parseChessComGameUrl(gameUrl);
      if (!meta) throw new Error('Invalid game URL');

      // Try public archives first
      const users = [...new Set((usernameHints || []).map(normalizeChessUsername).filter(Boolean))];
      for (const user of users) {
        try {
          const archivesText = await gmFetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
          const archivesData = JSON.parse(archivesText);
          for (const archiveUrl of (archivesData.archives || []).slice(-6).reverse()) {
            try {
              const archiveText = await gmFetch(archiveUrl);
              const archiveData = JSON.parse(archiveText);
              const found = (archiveData.games || []).find(g => {
                const gUrl = String(g?.url || '').toLowerCase();
                return gUrl.includes(`/${meta.gameType}/${meta.gameId}`);
              });
              if (found?.pgn) return { success: true, pgn: found.pgn };
            } catch {}
          }
        } catch {}
      }

      // Fallback: chess.com callback API
      try {
        const callbackText = await gmFetch(`https://www.chess.com/callback/${meta.gameType}/game/${meta.gameId}`);
        const callbackData = JSON.parse(callbackText);
        const pgn = callbackData?.game?.pgn || callbackData?.pgn || '';
        if (pgn) return { success: true, pgn };
      } catch {}

      return { success: false, error: 'Game not found', needsRetry: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /* ================================================================
     chrome API shim
  ================================================================ */
  try {
    Object.defineProperty(window, 'chrome', {
      value: {
        storage: { local: gmStorage, onChanged: gmStorage.onChanged },
        runtime: {
          lastError: null,
          getURL: p => `${BASE}/${p.replace(/^(?:modules\/|photo\/|audio\/)/, m =>
            m === 'modules/' ? '' : m === 'photo/' ? 'media/photo/' : 'media/audio/'
          )}`,
          onMessage: { addListener() {} },
          sendMessage(msg, cb) {
            if (msg?.action === 'fetchGamePgn') {
              fetchGamePgn(msg.gameUrl, msg.usernameHints)
                .then(result => cb && cb(result))
                .catch(err => cb && cb({ success: false, error: err.message }));
              return;
            }
            if (cb) cb({ ok: false, error: 'not implemented in userscript' });
          },
        },
        tabs: {
          create(opts) { if (opts?.url) window.open(opts.url, '_blank'); },
          query(_, cb) { cb([]); },
          sendMessage() {},
        },
        scripting: { executeScript() {} },
        debugger: { attach() {}, detach() {}, sendCommand() {} },
      },
      writable: false, configurable: true
    });
  } catch {}

  /* ================================================================
     Engine Host iframe (Blob) – thay engine_host.html
     Dùng Blob Worker với URL relative tới GitHub Pages
  ================================================================ */
  function createEngineHostIframe() {
    const CHANNEL = 'ch-engine-host';
    const ENGINES = [
      { id: 'komodoro', workerUrl: LIB_BASE + '/komodoro-worker.js' },
      { id: 'stockfish', workerUrl: LIB_BASE + '/stockfish-worker.js' },
    ];

    const script = `
'use strict';
const CHANNEL = '${CHANNEL}';
const ENGINE_BOOT_TIMEOUT_MS = 10000;
const ENGINES = ${JSON.stringify(ENGINES)};

let worker = null;
let hostReady = false;
let sentUci = false;
let sentIsReady = false;
let activeEngine = null;
let bootTimer = null;
let startingEngine = false;
const queuedCommands = [];

function postToParent(type, extra) {
  window.parent.postMessage({ channel: CHANNEL, type, ...(extra||{}) }, '*');
}

function clearBootTimer() { if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; } }

function flushQueuedCommands() {
  if (!worker || !hostReady || !queuedCommands.length) return;
  queuedCommands.splice(0).forEach(cmd => worker.postMessage(cmd));
}

function markReadyOnce() {
  if (hostReady) return;
  clearBootTimer(); hostReady = true;
  postToParent('ready', { engine: activeEngine?.id || '' });
  flushQueuedCommands();
}

function terminateWorker() {
  try { worker?.terminate?.(); } catch(_) {}
  worker = null;
}

function startWorker(idx) {
  idx = idx || 0;
  if (idx >= ENGINES.length) {
    postToParent('worker-error', { message: 'No engine available' }); return;
  }
  const engine = ENGINES[idx];
  startingEngine = true; hostReady = false; sentUci = false; sentIsReady = false;
  clearBootTimer(); terminateWorker(); activeEngine = engine;

  const fallback = (msg) => {
    clearBootTimer(); terminateWorker();
    const next = ENGINES[idx + 1];
    if (!next) { startingEngine = false; postToParent('worker-error', { message: msg }); return; }
    postToParent('engine-fallback', { from: engine.id, to: next.id, message: msg });
    startWorker(idx + 1);
  };

  try {
    worker = new Worker(engine.workerUrl);
    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data || '');
      postToParent('engine-message', { line });
      if (!sentUci && /(^|\\s)uciok(\\s|$)/.test(line)) {
        sentUci = true;
        if (!sentIsReady) { sentIsReady = true; worker.postMessage('isready'); }
      }
      if (/(^|\\s)readyok(\\s|$)/.test(line)) { startingEngine = false; markReadyOnce(); }
    };
    worker.onerror = (err) => {
      const msg = err?.message || 'Worker error';
      if (startingEngine || !hostReady) { fallback(msg); return; }
      postToParent('worker-error', { message: msg });
    };
    bootTimer = setTimeout(() => fallback(engine.id + ' timeout'), ENGINE_BOOT_TIMEOUT_MS);
    worker.postMessage('uci');
  } catch(err) { fallback(String(err)); }
}

window.addEventListener('message', (e) => {
  if (!e.data || e.data.channel !== CHANNEL || e.data.type !== 'command') return;
  const cmd = String(e.data.command || '').trim();
  if (!cmd) return;
  if (!worker || !hostReady) { queuedCommands.push(cmd); return; }
  worker.postMessage(cmd);
});

startWorker(0);
`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>${script}<\/script></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const iframe = document.createElement('iframe');
    iframe.src = URL.createObjectURL(blob);
    iframe.id = 'ch-engine-host';
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, { position:'fixed', width:'0', height:'0', border:'0', opacity:'0', pointerEvents:'none', left:'-9999px', top:'-9999px' });
    return iframe;
  }

  /* ================================================================
     Expose iframe factory và fetch PGN để content script dùng
  ================================================================ */
  window.__CK_CREATE_ENGINE_HOST_IFRAME__ = createEngineHostIframe;
  window.__CK_FETCH_GAME_PGN__ = fetchGamePgn;
  window.__CK_BASE_URL__ = BASE;
  window.__CK_REVIEW_URL__ = REVIEW_URL;
  window.__CK_STREAM_URL__ = STREAM_URL;
  window.__CK_LOGO_URL__ = LOGO_URL;

  /* ================================================================
     Inject content script
  ================================================================ */
  function inject(code) {
    const s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  /* ================================================================
     CONTENT SCRIPT – toàn bộ content.js gốc với các patch
  ================================================================ */
  const CONTENT_SCRIPT = `(function(){
'use strict';

const LOG_PREFIX='[Chess Killer]';
const log=(...a)=>console.log(LOG_PREFIX,...a);
const warn=(...a)=>console.warn(LOG_PREFIX,...a);
const error=(...a)=>console.error(LOG_PREFIX,...a);
const DEBUG_VERBOSE=false;
const debug=(...a)=>{if(DEBUG_VERBOSE)log(...a);};

const ENGINE_HOST_CHANNEL='ch-engine-host';
const CONFIG_STORAGE_KEY='chConfig';
const BASE_URL=window.__CK_BASE_URL__||'https://nguyenphanvn95.github.io/chesskiller';
const REVIEW_URL=window.__CK_REVIEW_URL__||BASE_URL+'/review.html';
const STREAM_URL=window.__CK_STREAM_URL__||BASE_URL+'/stream.html';
const LOGO_URL=window.__CK_LOGO_URL__||BASE_URL+'/media/photo/logo.png';

const ELO_PRESETS=[
  {label:'Unlimited',elo:0},{label:'800 (Beginner)',elo:800},{label:'1000 (Casual)',elo:1000},
  {label:'1200 (Club)',elo:1200},{label:'1500 (Intermediate)',elo:1500},{label:'1800 (Advanced)',elo:1800},
  {label:'2000 (Expert)',elo:2000},{label:'2200 (Master)',elo:2200},{label:'2500 (GM)',elo:2500},{label:'2800 (Super-GM)',elo:2800},
];

const DEFAULT_CONFIG={
  depth:15,lines:3,enabled:true,showEval:true,showArrows:true,hintStyle:'classic',showPanel:false,
  autoPlayMode:'off',autoPlayDelay:1500,autoPlayAutoInterval:false,autoPlayDelayMin:500,autoPlayDelayMax:10000,
  quickMoveKey:' ',eloLimit:0,colors:['#4f8cff','#2ecc71','#f1c40f','#e67e22','#e74c3c'],
};

const PIECE_LABEL={p:'Tốt',n:'Mã',b:'Tượng',r:'Xe',q:'Hậu',k:'Vua',P:'Tốt',N:'Mã',B:'Tượng',R:'Xe',Q:'Hậu',K:'Vua'};

const SITE=location.hostname.includes('lichess.org')?'lichess':'chesscom';

const state={fen:null,turn:null,myColor:null,engineMoves:[],engineAnalyzing:false};
let cfg={...DEFAULT_CONFIG};
let configReady=false,uiBuilt=false,renderPending=false;
let worker=null,engineHostFrame=null,engineHostReady=false,engineListenerInstalled=false,engineCommandQueue=[];
let moveMap=new Map(),analysisTimer=null,activeAnalysisFen='',pendingAnalysisFen='',lastAnalyzedFen='',eloOptionsSent=false;
let lastHintSignature='',lastStreamPublishKey='';
let autoMoveInFlight=false,autoMoveTimer=null,autoMoveError=null,consecutiveAutoMoveFailures=0,quickMovePending=false;
let updatePollTimer=null,observerDebounce=null;
let elFen,elSide,elTurn,elMoves,elMovesLabel,elStatus,elPanel,elAutoModeButtons=[],prevTurnForNotify=null;
const IS_TOUCH=(navigator.maxTouchPoints||0)>0;
const PRIMARY_POINTER=IS_TOUCH?'touch':'mouse';

function isVisible(el){if(!el||!el.isConnected)return false;const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}

// ── Site adapters ─────────────────────────────────────────────────
const chesscom={
  getBoardEl(){return document.querySelector('wc-chess-board')||document.querySelector('chess-board')||document.querySelector('.board');},
  getOrientation(){
    const board=this.getBoardEl();if(!board)return'white';
    if(board.classList.contains('flipped'))return'black';
    const attr=board.getAttribute('orientation')||board.getAttribute('data-board-orientation')||'';
    if(attr)return attr.toLowerCase().includes('black')?'black':'white';
    try{
      const br=board.getBoundingClientRect();const pieces=[...board.querySelectorAll('.piece')];
      if(br.width>40&&pieces.length){
        const cW=br.width/8,cH=br.height/8;
        const score=(orient)=>{let t=0,s=0;for(const el of pieces){const cls=String(el.className||'');const sm=cls.match(/\\bsquare-(\\d)(\\d)\\b/);if(!sm)continue;const f=parseInt(sm[1],10)-1,rk=parseInt(sm[2],10);const r=el.getBoundingClientRect();if(!r.width)continue;const aX=r.left+r.width/2-br.left,aY=r.top+r.height/2-br.top;const eC=orient==='black'?7-f:f,eR=orient==='black'?rk-1:8-rk;t+=Math.hypot(aX-(eC+.5)*cW,aY-(eR+.5)*cH);s++;}return s?t/s:Infinity;};
        return score('black')+1<score('white')?'black':'white';
      }
    }catch(_){}
    return'white';
  },
  readFen(){
    const board=this.getBoardEl();if(!board)return null;
    for(const key of['game','_game']){if(board[key]?.getFEN){try{const f=board[key].getFEN();if(f?.includes('/'))return f;}catch(_){}}}
    try{const fk=Object.keys(board).find(k=>k.startsWith('__reactFiber$')||k.startsWith('__reactInternalInstance$'));if(fk){let node=board[fk];for(let i=0;i<30&&node;i++,node=node.return){const f=node.memoizedProps?.fen||node.memoizedState?.fen||node.stateNode?.state?.fen||node.stateNode?.props?.fen;if(f?.includes('/'))return f;}}}catch(_){}
    const grid=Array.from({length:8},()=>Array(8).fill(null));
    const pieces=board.querySelectorAll('.piece');if(!pieces.length)return null;
    let parsed=0;
    pieces.forEach(p=>{const cls=p.className||'';const pm=cls.match(/\\b([wb][pnbrqk])\\b/),sm=cls.match(/\\bsquare-(\\d)(\\d)\\b/);if(!pm||!sm)return;const file=parseInt(sm[1],10)-1,rank=parseInt(sm[2],10)-1;if(file<0||file>7||rank<0||rank>7)return;grid[7-rank][file]=pm[1][0]==='w'?pm[1][1].toUpperCase():pm[1][1];parsed++;});
    if(parsed<2)return null;
    return buildFenFromGrid(grid)+' '+this.readTurn()+' - - 0 1';
  },
  readTurn(){
    const board=this.getBoardEl();if(!board)return state.turn||'w';
    const ht=detectTurnFromLastMoveHighlight(board,'chesscom',this.getOrientation());if(ht)return ht;
    if(board.game){try{const t=board.game.getTurn?.()||board.game.turn?.();if(t==='white'||t==='w')return'w';if(t==='black'||t==='b')return'b';}catch(_){}}
    const clocks=document.querySelectorAll('.clock-component,[class*="clock"]');
    for(const clk of clocks){if(!isVisible(clk))continue;const running=clk.classList.contains('clock-running')||clk.getAttribute('data-running')==='true';if(!running)continue;const isBtm=clk.classList.contains('clock-bottom')||!!clk.closest('[class*="bottom"]'),isTop=clk.classList.contains('clock-top')||!!clk.closest('[class*="top"]'),orient=this.getOrientation();if(isBtm)return orient==='black'?'b':'w';if(isTop)return orient==='black'?'w':'b';}
    return state.turn||'w';
  },
  getMyColor(){return this.getOrientation()==='black'?'b':'w';},
};

const lichess={
  isSupportedBoardPage(){const p=location.pathname||'/';return(/^\\/[A-Za-z0-9]{8,12}(?:\\/|$)/.test(p)||/^\\/analysis(?:\\/|$)/.test(p)||/^\\/study(?:\\/|$)/.test(p)||/^\\/practice(?:\\/|$)/.test(p)||/^\\/training(?:\\/|$)/.test(p)||/^\\/puzzle(?:\\/|$)/.test(p)||/^\\/broadcast(?:\\/|$)/.test(p));},
  findBoardWrap(){if(!this.isSupportedBoardPage())return null;for(const s of['main.round .cg-wrap','.round__app .cg-wrap','main.analyse .cg-wrap','.analyse .cg-wrap','.study__board .cg-wrap','main.puzzle .cg-wrap','.puzzle__board .cg-wrap','main .cg-wrap']){const el=document.querySelector(s);if(el&&isVisible(el))return el;}return null;},
  getBoardEl(){const w=this.findBoardWrap();if(!w)return null;return w.querySelector('cg-board')||w.querySelector('cg-container')||w;},
  getBoardWrap(){return this.findBoardWrap();},
  getOrientation(){const w=this.getBoardWrap();if(!w)return'white';const a=w.getAttribute('data-orientation')||'';if(a==='black')return'black';if(w.classList.contains('orientation-black'))return'black';const p=w.closest('[data-orientation]');if(p?.getAttribute('data-orientation')==='black')return'black';return'white';},
  readFen(){
    try{const c=window.lichess?.getCurrentGame?.();if(c?.fen?.includes('/'))return c.fen;}catch(_){}
    try{for(const s of document.querySelectorAll('script')){const m=s.textContent?.match(/"fen"\\s*:\\s*"([^"]+)"/);if(m&&m[1].includes('/'))return m[1]+' w - - 0 1';}}catch(_){}
    return this._readFenFromCgBoard();
  },
  _readFenFromCgBoard(){
    const board=this.getBoardEl();if(!board)return null;
    const br=board.getBoundingClientRect();if(!br.width)return null;
    const cW=br.width/8,cH=br.height/8;
    const grid=Array.from({length:8},()=>Array(8).fill(null));
    const orient=this.getOrientation();
    const pieces=board.querySelectorAll('piece');if(!pieces.length)return null;
    let parsed=0;
    pieces.forEach(p=>{const cls=p.className||'';const isW=cls.includes('white'),isB=cls.includes('black');if(!isW&&!isB)return;const typeMap={king:'k',queen:'q',rook:'r',bishop:'b',knight:'n',pawn:'p'};let type=null;for(const[n,c]of Object.entries(typeMap)){if(cls.includes(n)){type=c;break;}}if(!type)return;let x=null,y=null;const style=p.getAttribute('style')||'';const mt=style.match(/translate(?:3d)?\\(\\s*([\\d.]+)px,\\s*([\\d.]+)px/);if(mt){x=parseFloat(mt[1]);y=parseFloat(mt[2]);}else{const r=p.getBoundingClientRect();x=r.left-br.left+r.width/2;y=r.top-br.top+r.height/2;}if(x===null)return;let col=Math.max(0,Math.min(7,Math.round(x/cW))),row=Math.max(0,Math.min(7,Math.round(y/cH)));const gC=orient==='black'?7-col:col,gR=orient==='black'?7-row:row;grid[gR][gC]=isW?type.toUpperCase():type;parsed++;});
    if(parsed<2)return null;
    return buildFenFromGrid(grid)+' '+this.readTurn()+' - - 0 1';
  },
  readTurn(){
    const board=this.getBoardEl();if(board){const ht=detectTurnFromLastMoveHighlight(board,'lichess',this.getOrientation());if(ht)return ht;}
    const clocks=document.querySelectorAll('.rclock,.clock,[class*="clock"]');
    for(const clk of clocks){if(!isVisible(clk))continue;const running=clk.classList.contains('running')||clk.classList.contains('clock-running');if(!running)continue;const isB=clk.classList.contains('rclock-bottom')||clk.classList.contains('clock-bottom')||!!clk.closest('.player.bottom')||!!clk.closest('[class*="bottom"]'),isTop=clk.classList.contains('rclock-top')||clk.classList.contains('clock-top')||!!clk.closest('.player.top')||!!clk.closest('[class*="top"]'),orient=this.getOrientation();if(isB)return orient==='black'?'b':'w';if(isTop)return orient==='black'?'w':'b';}
    return state.turn||'w';
  },
  getMyColor(){return this.getOrientation()==='black'?'b':'w';},
};

const adapter=SITE==='lichess'?lichess:chesscom;
const getBoardEl=()=>adapter.getBoardEl();
const getBoardOrientation=()=>adapter.getOrientation();
const readFenFromDom=()=>adapter.readFen();
const readTurn=()=>adapter.readTurn();
const getMyColor=()=>adapter.getMyColor();

function buildFenFromGrid(grid){let fen='';for(let r=0;r<8;r++){let e=0;for(let c=0;c<8;c++){if(grid[r][c]){if(e){fen+=e;e=0;}fen+=grid[r][c];}else e++;}if(e)fen+=e;if(r<7)fen+='/';}return fen;}
function fenTurn(fen){const p=String(fen||'').trim().split(/\\s+/);return/^[wb]$/.test(p[1])?p[1]:null;}
function pieceAtFenSquare(fen,sq){if(!fen||!sq)return'';const file=sq.charCodeAt(0)-97,rank=parseInt(sq[1],10);if(file<0||file>7||rank<1||rank>8)return'';const rows=fen.split(' ')[0]?.split('/')||[];const row=rows[8-rank];if(!row)return'';let col=0;for(const ch of row){if(/\\d/.test(ch)){col+=+ch;continue;}if(col===file)return ch;col++;}return'';}
function oppositeTurn(t){return t==='w'?'b':t==='b'?'w':null;}
function chesscomSquareClassFromSquare(sq){if(!/^[a-h][1-8]$/.test(String(sq||'')))return null;return'square-'+(sq.charCodeAt(0)-96)+sq[1];}

// Square helpers
function buildChesscomDirectGeometry(board){if(!board||SITE!=='chesscom')return null;try{const bR=board.getBoundingClientRect();if(!bR.width||!bR.height)return null;const samples=[];board.querySelectorAll('.piece').forEach(el=>{const cls=String(el.className||'');const m=cls.match(/\\bsquare-(\\d)(\\d)\\b/);if(!m)return;const file=parseInt(m[1],10),rank=parseInt(m[2],10);if(file<1||file>8||rank<1||rank>8)return;const r=el.getBoundingClientRect();if(!r.width||!r.height)return;samples.push({file,rank,x:r.left+r.width/2-bR.left,y:r.top+r.height/2-bR.top});});if(samples.length<2)return null;const fit=(pts,k,ok)=>{const n=pts.length;let sx=0,sy=0,sxx=0,sxy=0;for(const p of pts){const x=p[k],y=p[ok];sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}const den=n*sxx-sx*sx;if(Math.abs(den)<1e-6)return null;const a=(n*sxy-sx*sy)/den,b=(sy-a*sx)/n;return{a,b};};const xF=fit(samples,'file','x'),yF=fit(samples,'rank','y');if(!xF||!yF)return null;return{xFit:xF,yFit:yF,boardRect:bR};}catch(_){return null;}}
function getChesscomDirectSquareCenter(board,sq){if(!board||SITE!=='chesscom'||!sq)return null;const g=buildChesscomDirectGeometry(board);if(!g)return null;const file=sq.charCodeAt(0)-96,rank=parseInt(sq[1],10);if(file<1||file>8||rank<1||rank>8)return null;return{x:g.boardRect.left+(g.xFit.a*file+g.xFit.b),y:g.boardRect.top+(g.yFit.a*rank+g.yFit.b)};}
function squareFromChesscomPoint(board,x,y){const g=buildChesscomDirectGeometry(board);if(!g)return null;const file=Math.max(1,Math.min(8,Math.round((x-g.xFit.b)/g.xFit.a))),rank=Math.max(1,Math.min(8,Math.round((y-g.yFit.b)/g.yFit.a)));return String.fromCharCode(96+file)+rank;}
function squareFromChesscomClassName(cls){const m=String(cls||'').match(/\\bsquare-(\\d)(\\d)\\b/);if(!m)return null;const f=parseInt(m[1],10),r=parseInt(m[2],10);if(f<1||f>8||r<1||r>8)return null;return String.fromCharCode(96+f)+r;}
function squareFromBoardPoint(board,x,y,orient){const rect=board?.getBoundingClientRect?.();if(!rect?.width)return null;if(SITE==='chesscom'){const sq=squareFromChesscomPoint(board,x,y);if(sq)return sq;}const cW=rect.width/8,cH=rect.height/8;let col=Math.max(0,Math.min(7,Math.floor(x/cW))),row=Math.max(0,Math.min(7,Math.floor(y/cH)));const fi=orient==='black'?7-col:col,rk=orient==='black'?row+1:8-row;return String.fromCharCode(97+fi)+rk;}
function squareFromElementRect(board,el,orient){if(!board||!el?.getBoundingClientRect)return null;const bR=board.getBoundingClientRect(),r=el.getBoundingClientRect();if(!bR.width||!r.width)return null;return squareFromBoardPoint(board,r.left+r.width/2-bR.left,r.top+r.height/2-bR.top,orient);}
function getHighlightedSquares(board,site,orient){const out=[],seen=new Set();const add=sq=>{if(!sq||seen.has(sq))return;seen.add(sq);out.push(sq);};if(site==='chesscom'){board.querySelectorAll('.highlight,.move-square,.last-move,[class*="highlight"],[class*="move-square"],[class*="last-move"]').forEach(el=>add(squareFromChesscomClassName(el.className)));return out;}board.querySelectorAll('square.last-move,square.move-from,square.move-to,.last-move,.move-from,.move-to').forEach(el=>{const csq=String(el.className||'').match(/\\b([a-h][1-8])\\b/i)?.[1]?.toLowerCase();add(csq||squareFromElementRect(board,el,orient));});return out;}
function getPieceColorAtSquare(board,sq,site,orient){if(!board||!sq)return null;if(site==='chesscom'){const sc=chesscomSquareClassFromSquare(sq);if(!sc)return null;const t=board.querySelector('.piece.'+sc);const m=String(t?.className||'').match(/\\b([wb])[pnbrqk]\\b/i);return m?m[1].toLowerCase():null;}const pieces=board.querySelectorAll('piece');for(const p of pieces){if(squareFromElementRect(board,p,orient)!==sq)continue;const cls=String(p.className||'');if(/\\bwhite\\b/i.test(cls))return'w';if(/\\bblack\\b/i.test(cls))return'b';}return null;}
function detectTurnFromLastMoveHighlight(board,site,orient){const squares=getHighlightedSquares(board,site,orient);if(!squares.length)return null;for(let i=squares.length-1;i>=0;i--){const c=getPieceColorAtSquare(board,squares[i],site,orient);if(c)return oppositeTurn(c);}return null;}
function getLichessPieceElementAtSquare(board,sq,orient){if(!board||SITE!=='lichess'||!sq)return null;for(const p of board.querySelectorAll('piece')){if(squareFromElementRect(board,p,orient)===sq)return p;}return null;}

// ── Engine host ────────────────────────────────────────────────────
function installEngineHostListener(){if(engineListenerInstalled)return;engineListenerInstalled=true;window.addEventListener('message',e=>{if(e.source!==engineHostFrame?.contentWindow)return;const data=e.data||{};if(data.channel!==ENGINE_HOST_CHANNEL)return;if(data.type==='ready'){engineHostReady=true;flushEngineQueue();log('engine:ready');maybeAnalyze();return;}if(data.type==='worker-error'){autoMoveError=data.message||'Engine error';scheduleRender();return;}if(data.type==='engine-message')onEngineMsg(data.line);});}
function postToEngine(cmd){if(!engineHostFrame?.contentWindow||!engineHostReady){engineCommandQueue.push(cmd);return;}engineHostFrame.contentWindow.postMessage({channel:ENGINE_HOST_CHANNEL,type:'command',command:cmd},'*');}
function flushEngineQueue(){if(!engineHostReady||!engineCommandQueue.length)return;engineCommandQueue.splice(0).forEach(cmd=>postToEngine(cmd));}

// [US-PATCH] startEngineHost dùng Blob iframe thay vì chrome.runtime.getURL
function startEngineHost(){try{installEngineHostListener();worker={postMessage:cmd=>postToEngine(cmd)};if(!engineHostFrame){const factory=window.__CK_CREATE_ENGINE_HOST_IFRAME__;engineHostFrame=factory?factory():document.createElement('iframe');engineHostFrame.id='ch-engine-host';if(!factory)Object.assign(engineHostFrame.style,{position:'fixed',width:'0',height:'0',border:'0',opacity:'0',pointerEvents:'none',left:'-9999px',top:'-9999px'});(document.documentElement||document.body).appendChild(engineHostFrame);}}catch(err){error('engine:start-failed',err);}}

function sendEloOptions(){if(!engineHostReady)return;if(cfg.eloLimit>0){worker.postMessage('setoption name UCI_LimitStrength value true');worker.postMessage('setoption name UCI_Elo value '+cfg.eloLimit);worker.postMessage('setoption name UCI LimitStrength value true');worker.postMessage('setoption name UCI Elo value '+cfg.eloLimit);}else{worker.postMessage('setoption name UCI_LimitStrength value false');worker.postMessage('setoption name UCI LimitStrength value false');}eloOptionsSent=true;}

function onEngineMsg(line){if(!line)return;if(line.startsWith('info')&&line.includes(' pv ')){const depth=+(line.match(/\\bdepth (\\d+)/)||[])[1];if(!depth||depth<4)return;const pvIdx=+(line.match(/\\bmultipv (\\d+)/)||[,1])[1];const scoreMt=line.match(/\\bscore (cp|mate) (-?\\d+)/);const pvMt=line.match(/\\bpv ([a-h][1-8][a-h][1-8][qrbn]?)/);if(!pvMt)return;const from=pvMt[1].slice(0,2),to=pvMt[1].slice(2,4),promo=pvMt[1].slice(4)||'';const fen=activeAnalysisFen||state.fen;const src=pieceAtFenSquare(fen,from),turn=fenTurn(fen);if(src&&turn){const isW=src===src.toUpperCase();if(turn==='w'&&!isW)return;if(turn==='b'&&isW)return;}const ex=moveMap.get(pvIdx);if(ex&&ex.depth>depth)return;let evalText='',scoreCp=null,scoreMate=null;if(scoreMt){let score=Number(scoreMt[2]);if(turn==='b')score=-score;if(scoreMt[1]==='mate'){scoreMate=score;evalText='#'+score;}else{scoreCp=score;evalText=score>=0?'+'+( score/100).toFixed(1):(score/100).toFixed(1);}}moveMap.set(pvIdx,{from,to,promo,eval:evalText,depth,cp:scoreCp,mate:scoreMate});return;}
if(line.startsWith('bestmove')){finishAnalysis();const moves=[...moveMap.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v).slice(0,cfg.lines);state.engineMoves=moves;drawHintArrows(moves);scheduleRender();if(quickMovePending&&moves.length)triggerQuickMove('pending-bestmove');if(cfg.autoPlayMode!=='off'&&state.myColor&&state.turn===state.myColor&&moves.length){const chosen=cfg.autoPlayMode==='random'?moves[Math.floor(Math.random()*moves.length)]:moves[0];const delay=cfg.autoPlayAutoInterval?cfg.autoPlayDelayMin+Math.floor(Math.random()*(cfg.autoPlayDelayMax-cfg.autoPlayDelayMin+1)):cfg.autoPlayDelay;clearTimeout(autoMoveTimer);autoMoveTimer=setTimeout(async()=>{if(!chosen){autoMoveTimer=null;return;}autoMoveInFlight=true;try{const applied=await tryApplyMove(chosen);if(applied)consecutiveAutoMoveFailures=0;else{consecutiveAutoMoveFailures++;if(consecutiveAutoMoveFailures>=2){cfg.autoPlayMode='off';autoMoveError='Disabled after 2 failures';scheduleRender();}}}finally{autoMoveInFlight=false;autoMoveTimer=null;}},delay);}}}

function analyzePosition(fen,reason){if(!worker||!engineHostReady||!fen||!cfg.enabled)return;if(state.engineAnalyzing){pendingAnalysisFen=fen;return;}state.engineAnalyzing=true;state.engineMoves=[];clearHintOverlay();activeAnalysisFen=fen;moveMap.clear();clearTimeout(analysisTimer);analysisTimer=setTimeout(()=>{finishAnalysis();autoMoveError='Engine timeout';scheduleRender();},12000);worker.postMessage('stop');if(!eloOptionsSent)sendEloOptions();worker.postMessage('setoption name MultiPV value '+cfg.lines);worker.postMessage('isready');worker.postMessage('position fen '+fen);worker.postMessage('go depth '+cfg.depth+' movetime 8000');}
function finishAnalysis(){state.engineAnalyzing=false;activeAnalysisFen='';clearTimeout(analysisTimer);const q=pendingAnalysisFen;pendingAnalysisFen='';if(q)setTimeout(()=>analyzePosition(q,'queued'),0);}
function maybeAnalyze(){if(!configReady||!cfg.enabled||!state.fen||!state.turn||!state.myColor)return;if(state.turn!==state.myColor){if(state.engineMoves.length||lastHintSignature){state.engineMoves=[];clearHintOverlay();scheduleRender();}return;}if(lastAnalyzedFen===state.fen&&state.engineMoves.length)return;lastAnalyzedFen=state.fen;analyzePosition(state.fen,'hint-only');}

// ── Overlay ────────────────────────────────────────────────────────
function clearHintOverlay(){document.querySelectorAll('svg.ch-hint-overlay').forEach(s=>s.remove());lastHintSignature='';}
function isGameResultModalVisible(){if(SITE!=='chesscom')return false;const m=document.querySelector('#board-layout-chessboard > div.board-modal-container-container > div > div');if(!m||!isVisible(m))return false;return!!(m.querySelector('.board-modal-buttons,.buttons')||m.childElementCount>0);}
function hasActiveOverlay(board){const host=board?.parentElement||document.body;const svg=host?.querySelector('svg.ch-hint-overlay');if(!svg?.isConnected)return false;return!!svg.querySelector('[data-role="hint-arrow"]');}
function getSquareCenterOnBoard(sq,board){if(!board)return null;if(SITE==='chesscom'){const d=getChesscomDirectSquareCenter(board,sq);if(d)return d;}const ref=SITE==='lichess'?(adapter.getBoardWrap?.()||board):board;const bR=ref.getBoundingClientRect();if(bR.width<64)return null;const file=sq.charCodeAt(0)-97,rank=parseInt(sq[1],10),orient=getBoardOrientation();const col=orient==='black'?7-file:file,row=orient==='black'?rank-1:8-rank;const cW=bR.width/8,cH=bR.height/8;return{x:bR.left+(col+.5)*cW,y:bR.top+(row+.5)*cH};}
function getOverlayHost(board){if(SITE==='lichess'){const w=adapter.getBoardWrap?.();if(w)return w;}return board.parentElement||document.body;}
function getOverlayReference(board){if(SITE==='lichess')return adapter.getBoardWrap?.()||board;return board;}
function clamp(v,mn,mx){return Math.max(mn,Math.min(mx,v));}
function measureBadge(text,cell,idx){const fs=Math.max(9,cell*(idx===0?.18:.15)),px=Math.max(8,cell*.10),mw=Math.max(cell*.34,24),w=Math.max(mw,text.length*fs*.62+px*2),h=Math.max(20,fs*1.42);return{fontSize:fs,width:w,height:h,radius:h/2};}
function getChesscomBadgeColor(move,idx){const raw=String(move?.eval||'').trim().toUpperCase();if(raw.startsWith('M'))return'#22c55e';if(raw.includes('-'))return'#ff5a52';if(idx===0)return'#31c56f';if(idx===1)return'#f3c63a';if(idx===2)return'#ff5a52';return'#4f8cff';}
function getHintQualityType(move,bestMove,idx){if(!move)return'Good';if(idx===0)return'BestMove';if(bestMove?.mate!=null){if(move.mate==null)return bestMove.mate>0?'MissedWin':'Brilliant';return bestMove.mate>0?'Excellent':'ResignWhite';}if(move.mate!=null)return move.mate<0?'Brilliant':'Blunder';if(bestMove?.cp!=null&&move.cp!=null){const d=move.cp-bestMove.cp;if(d>100)return'Brilliant';if(d>0)return'GreatFind';if(d>-10)return'BestMove';if(d>-25)return'Excellent';if(d>-50)return'Good';if(d>-100)return'Inaccuracy';if(d>-250)return'Mistake';return'Blunder';}return idx===1?'Excellent':idx===2?'Good':'Inaccuracy';}
function getChesscomHighlightColor(t){const c={Brilliant:'#1baca6',GreatFind:'#5c8bb0',BestMove:'#9eba5a',Excellent:'#96bc4b',Good:'#96af8b',Book:'#a88865',Inaccuracy:'#f0c15c',Mistake:'#e6912c',Blunder:'#b33430',MissedWin:'#dbac16',WinnerWhite:'#31c56f',ResignWhite:'#ff5a52'};return c[t]||'#96bc4b';}

function drawHintArrows(moves){if(!cfg.showArrows){clearHintOverlay();return;}const board=getBoardEl();if(!board)return;const nm=(moves||[]).filter(m=>m?.from&&m?.to).slice(0,cfg.lines);const sig=JSON.stringify([state.fen,getBoardOrientation(),nm.map(m=>m.from+m.to+(m.eval||''))]);if(sig===lastHintSignature&&hasActiveOverlay(board))return;const host=getOverlayHost(board),refEl=getOverlayReference(board),hostRect=host.getBoundingClientRect(),boardRect=refEl.getBoundingClientRect();let svg=host.querySelector('svg.ch-hint-overlay');if(!svg){if(getComputedStyle(host).position==='static')host.style.position='relative';svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','ch-hint-overlay');Object.assign(svg.style,{position:'absolute',pointerEvents:'none',zIndex:'9998'});host.appendChild(svg);}Object.assign(svg.style,{left:(boardRect.left-hostRect.left)+'px',top:(boardRect.top-hostRect.top)+'px',width:boardRect.width+'px',height:boardRect.height+'px'});svg.setAttribute('viewBox','0 0 '+boardRect.width+' '+boardRect.height);svg.innerHTML='';
const cell=boardRect.width/8;let drawn=0;
nm.forEach((move,idx)=>{const fp=getSquareCenterOnBoard(move.from,board),tp=getSquareCenterOnBoard(move.to,board);if(!fp||!tp)return;const x1=fp.x-boardRect.left,y1=fp.y-boardRect.top,x2=tp.x-boardRect.left,y2=tp.y-boardRect.top,dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy);if(!Number.isFinite(len)||len<cell*.22)return;const nx=dx/len,ny=dy/len,color=cfg.colors[idx]||'#888',alpha=idx===0?.9:.72,startOff=cell*.2,headLen=Math.max(8,cell*(idx===0?.3:.26)),halfHead=Math.max(4,cell*(idx===0?.12:.10)),lineW=Math.max(2.2,cell*(idx===0?.09:.065)),ang=Math.atan2(dy,dx);const sx=x1+nx*startOff,sy=y1+ny*startOff,ex=x2-nx*headLen*.78,ey=y2-ny*headLen*.78;
const shaft=document.createElementNS('http://www.w3.org/2000/svg','path');shaft.setAttribute('data-role','hint-arrow');shaft.setAttribute('d','M '+sx+' '+sy+' L '+ex+' '+ey);shaft.setAttribute('stroke',color);shaft.setAttribute('stroke-width',String(lineW));shaft.setAttribute('stroke-linecap','round');shaft.setAttribute('fill','none');shaft.setAttribute('opacity',String(alpha));svg.appendChild(shaft);
const lx=x2-nx*headLen-Math.sin(ang)*halfHead,ly=y2-ny*headLen+Math.cos(ang)*halfHead,rx=x2-nx*headLen+Math.sin(ang)*halfHead,ry=y2-ny*headLen-Math.cos(ang)*halfHead;
const head=document.createElementNS('http://www.w3.org/2000/svg','polygon');head.setAttribute('data-role','hint-arrow');head.setAttribute('points',x2+','+y2+' '+lx+','+ly+' '+rx+','+ry);head.setAttribute('fill',color);head.setAttribute('opacity',String(alpha));svg.appendChild(head);
if(cfg.showEval&&move.eval){const lOff=cell*.16,lx2=x2+Math.sin(ang)*lOff+cell*.08,ly2=y2-Math.cos(ang)*lOff-cell*.12;const txt=document.createElementNS('http://www.w3.org/2000/svg','text');txt.setAttribute('x',String(lx2));txt.setAttribute('y',String(ly2));txt.setAttribute('font-size',String(Math.max(10,cell*(idx===0?.22:.19))));txt.setAttribute('font-family',"Consolas,'Courier New',monospace");txt.setAttribute('font-weight','700');txt.setAttribute('text-anchor','start');txt.setAttribute('dominant-baseline','middle');txt.setAttribute('stroke','rgba(0,0,0,0.78)');txt.setAttribute('stroke-width',String(Math.max(2.2,cell*.06)));txt.setAttribute('stroke-linejoin','round');txt.setAttribute('paint-order','stroke');txt.setAttribute('fill',color);txt.setAttribute('opacity',String(alpha));txt.textContent=move.eval;svg.appendChild(txt);}
drawn++;});
if(!drawn){svg.remove();lastHintSignature='';return;}lastHintSignature=sig;}

function ensureOverlayVisible(){if(!cfg.showArrows||!state.engineMoves.length)return;if(isGameResultModalVisible()){clearHintOverlay();return;}const board=getBoardEl();if(board&&!hasActiveOverlay(board)){lastHintSignature='';drawHintArrows(state.engineMoves);}}

// ── Stream publisher ────────────────────────────────────────────────
function publishStreamState(){if(!chrome?.storage?.local||!state.fen)return;const board=getBoardEl();const lastMoveSquares=board?getHighlightedSquares(board,SITE,getBoardOrientation()).slice(0,2):[];const payload={fen:state.fen,turn:fenTurn(state.fen),playerSide:state.myColor,lastMoveSquares,moves:(cfg.enabled?state.engineMoves:[]).slice(0,cfg.lines).map(m=>({from:m.from,to:m.to,promo:m.promo||'',eval:cfg.showEval?(m.eval||''):''})),colors:cfg.colors.slice(0,5),orientation:getBoardOrientation(),updatedAt:Date.now(),source:location.href,site:SITE};const key=JSON.stringify([payload.fen,payload.turn,payload.playerSide,payload.orientation,payload.lastMoveSquares.join('|'),payload.moves.map(m=>m.from+m.to+m.eval).join('|'),payload.colors.join('|')]);if(key===lastStreamPublishKey)return;lastStreamPublishKey=key;chrome.storage.local.set({chStreamState:payload});}

// ── Auto move ───────────────────────────────────────────────────────
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function dispatchPointerAndMouse(target,type,x,y,buttons,detail){if(!target?.dispatchEvent)return;if(typeof PointerEvent==='function')target.dispatchEvent(new PointerEvent(type,{view:window,bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,pointerId:1,pointerType:PRIMARY_POINTER,isPrimary:true,button:0,buttons}));const mtype=type.replace(/^pointer/,'mouse');target.dispatchEvent(new MouseEvent(mtype,{view:window,bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0,buttons,detail:detail||0}));}

async function dragPiece(from,to,forcedStart,forcedBoard,forcedContainer){const startEl=forcedStart||document.elementFromPoint(from.x,from.y);const boardEl_=forcedBoard||getBoardEl()||document.elementFromPoint(to.x,to.y);const containerEl=forcedContainer||boardEl_?.closest?.('cg-container')||boardEl_?.parentElement||boardEl_;if(!startEl||!boardEl_)return;const moveTargets=[boardEl_,containerEl,document].filter((t,i,l)=>t&&l.indexOf(t)===i);dispatchPointerAndMouse(startEl,'pointermove',from.x,from.y,0,0);dispatchPointerAndMouse(startEl,'pointerdown',from.x,from.y,1,1);startEl.dispatchEvent(new MouseEvent('mousedown',{view:window,bubbles:true,cancelable:true,composed:true,clientX:from.x,clientY:from.y,button:0,buttons:1,detail:1}));await sleep(36);for(let i=1;i<=12;i++){const x=from.x+(to.x-from.x)*(i/12),y=from.y+(to.y-from.y)*(i/12);for(const t of moveTargets){dispatchPointerAndMouse(t,'pointermove',x,y,1,0);t.dispatchEvent(new MouseEvent('mousemove',{view:window,bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0,buttons:1}));}await sleep(14);}dispatchPointerAndMouse(boardEl_,'pointerup',to.x,to.y,0,1);boardEl_.dispatchEvent(new MouseEvent('mouseup',{view:window,bubbles:true,cancelable:true,composed:true,clientX:to.x,clientY:to.y,button:0,buttons:0,detail:1}));boardEl_.dispatchEvent(new MouseEvent('click',{view:window,bubbles:true,cancelable:true,composed:true,clientX:to.x,clientY:to.y,button:0,buttons:0,detail:1}));}

async function tryApplyMove(move){autoMoveError=null;const board=getBoardEl();if(!board)return false;const fromPt=getSquareCenterOnBoard(move.from,board),toPt=getSquareCenterOnBoard(move.to,board);if(!fromPt||!toPt)return false;const fenBefore=state.fen;try{const fromEl=document.elementFromPoint(fromPt.x,fromPt.y),toEl=document.elementFromPoint(toPt.x,toPt.y);if(fromEl){fromEl.dispatchEvent(new MouseEvent('click',{view:window,bubbles:true,cancelable:true,composed:true,detail:1,clientX:fromPt.x,clientY:fromPt.y,button:0,buttons:0}));await sleep(100);}if(toEl){toEl.dispatchEvent(new MouseEvent('click',{view:window,bubbles:true,cancelable:true,composed:true,detail:1,clientX:toPt.x,clientY:toPt.y,button:0,buttons:0}));await sleep(600);}if(state.fen&&state.fen!==fenBefore)return true;if(fromEl&&toEl){await dragPiece(fromPt,toPt);await sleep(600);}return!!(state.fen&&state.fen!==fenBefore);}catch(err){autoMoveError=err?.message||String(err);scheduleRender();return false;}}

function isEditableTarget(t){if(!(t instanceof Element))return false;if(t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement||t instanceof HTMLSelectElement)return true;return!!t.closest('[contenteditable=""],[contenteditable="true"],[role="textbox"]');}
function getShortcutBestMove(){const m=state.engineMoves?.[0];return m?.from&&m?.to?m:null;}
function isMyTurnForMove(){const t=fenTurn(state.fen)||state.turn;return!!state.myColor&&t===state.myColor;}
function triggerQuickMove(reason){if(!cfg.enabled||!configReady)return false;if(!isMyTurnForMove()){quickMovePending=false;return false;}const best=getShortcutBestMove();if(!best){quickMovePending=!!state.engineAnalyzing;return false;}if(autoMoveInFlight)return false;quickMovePending=false;clearTimeout(autoMoveTimer);autoMoveTimer=null;autoMoveInFlight=true;tryApplyMove(best).finally(()=>{autoMoveInFlight=false;});return true;}

// ── UI ─────────────────────────────────────────────────────────────
function eloLabel(){if(!cfg.eloLimit||cfg.eloLimit<=0)return'∞ Unlimited';const p=ELO_PRESETS.find(x=>x.elo===cfg.eloLimit);return p?'ELO '+p.elo:'ELO '+cfg.eloLimit;}

function buildUI(){if(uiBuilt||!document.body)return;uiBuilt=true;
const siteName=SITE==='lichess'?'♜ Chess Killer':'♟ Chess Killer';
const style=document.createElement('style');
style.textContent=\`
#ch-root{position:fixed;bottom:max(12px,env(safe-area-inset-bottom));right:max(12px,env(safe-area-inset-right));z-index:999999;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:12px;max-width:min(90vw,340px);touch-action:none;user-select:none}
#ch-panel{background:linear-gradient(180deg,#262321 0%,#1b1a18 100%);border:1px solid #3a3835;border-radius:16px;min-width:min(278px,90vw);box-shadow:0 16px 36px rgba(0,0,0,.42);overflow:hidden}
#ch-panel.mini .ch-body,#ch-panel.mini .ch-foot{display:none}
.ch-hdr{display:flex;justify-content:space-between;align-items:center;padding:11px 13px 10px;background:linear-gradient(180deg,#1c1b18 0%,#13120f 100%);border-bottom:1px solid #3a3835;cursor:grab;touch-action:none}
.ch-hdr>span{color:#e8e5e0;font-weight:700;font-size:14px}
.ch-hdr-actions{display:flex;align-items:center;gap:6px}
.ch-btn{background:#252422;border:1px solid #3a3835;color:#e8e5e0;border-radius:10px;padding:0 10px;cursor:pointer;font:600 11px system-ui;min-height:32px;touch-action:manipulation;transition:background .15s,border-color .15s}
.ch-btn:hover{background:#1c3050;border-color:#35577f}
.ch-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0}
.ch-icon-btn svg{width:13px;height:13px}
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
.ch-val.elo{color:#f0a500;font-weight:700;font-size:11px}
.badge{display:inline-block;padding:3px 9px;border-radius:999px;font-weight:700;font-size:11px}
.badge-white{background:#d5d0c8;color:#1a1a1a}
.badge-black{background:#2e2c29;color:#e8e5e0;border:1px solid #4b4944}
.badge-orange{background:#6b3a00;color:#f0a500;border:1px solid #f0a50055}
.myturn{animation:glow 1s ease-in-out infinite alternate}
@keyframes glow{from{box-shadow:0 0 6px rgba(79,140,255,.35)}to{box-shadow:0 0 16px rgba(79,140,255,.7)}}
.ch-foot{padding:7px 11px;border-top:1px solid #3a3835;font-size:10px;color:#76b730;background:rgba(0,0,0,.14)}
.ch-moves-list{max-height:90px;overflow-y:auto;font-size:11px;color:#c0bdb8;white-space:pre;line-height:1.45;font-family:monospace}
#ch-notify{position:fixed;top:max(20px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);background:linear-gradient(180deg,#1c1b18,#13120f);color:#e8e5e0;padding:10px 16px;border:1px solid #3a3835;border-radius:14px;font-weight:700;font-size:13px;z-index:9999999;box-shadow:0 12px 26px rgba(0,0,0,.32);animation:ndrop .35s ease}
@keyframes ndrop{from{top:0;opacity:0}to{top:max(20px,env(safe-area-inset-top));opacity:1}}
\`;
(document.head||document.documentElement).appendChild(style);
const root=document.createElement('div');root.id='ch-root';root.style.display='none';
root.innerHTML=\`<div id="ch-panel">
<div class="ch-hdr">
  <span>\${siteName}</span>
  <div class="ch-hdr-actions">
    <button class="ch-btn ch-icon-btn" id="ch-review-btn" title="Open Review">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
    </button>
    <button class="ch-btn ch-icon-btn" id="ch-stream-btn" title="Open Stream Board">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    </button>
    <button class="ch-btn ch-icon-btn" id="ch-settings-btn" title="Settings">
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
      <button class="ch-btn ch-mode-btn" data-auto-mode="best">Best</button>
      <button class="ch-btn ch-mode-btn" data-auto-mode="random">Rng</button>
      <button class="ch-btn ch-mode-btn" data-auto-mode="off">Off</button>
    </div>
  </div>
  <div class="ch-row"><span class="ch-lbl">ELO limit</span><span class="ch-val elo" id="ch-elo-val">∞ Unlimited</span></div>
  <div class="ch-row"><span class="ch-lbl">FEN</span><span class="ch-val green" id="ch-fen">-</span><button class="ch-btn" id="ch-cp" style="font-size:10px;padding:1px 5px">CP</button></div>
  <div class="ch-row"><span class="ch-lbl">Hints</span><span class="ch-val yellow" id="ch-moves-label">-</span></div>
  <div class="ch-moves-list" id="ch-moves"></div>
</div>
<div class="ch-foot" id="ch-status">Tracking...</div>
</div>\`;
document.body.appendChild(root);
elFen=root.querySelector('#ch-fen');elSide=root.querySelector('#ch-side');elTurn=root.querySelector('#ch-turn');elMoves=root.querySelector('#ch-moves');elMovesLabel=root.querySelector('#ch-moves-label');elStatus=root.querySelector('#ch-status');elPanel=root.querySelector('#ch-panel');elAutoModeButtons=[...root.querySelectorAll('[data-auto-mode]')];

let mini=false;
root.querySelector('#ch-min').addEventListener('click',()=>{mini=!mini;elPanel.classList.toggle('mini',mini);root.querySelector('#ch-min').textContent=mini?'[]':'-';});
root.querySelector('#ch-stream-btn').addEventListener('click',()=>window.open(STREAM_URL,'_blank','noopener,width=900,height=650'));
root.querySelector('#ch-review-btn').addEventListener('click',()=>window.open(REVIEW_URL,'_blank','noopener,width=1200,height=820'));
root.querySelector('#ch-settings-btn').addEventListener('click',()=>window.open(window.__CK_BASE_URL__+'/setting.html','_blank','noopener,width=480,height=700'));
root.querySelector('#ch-cp').addEventListener('click',()=>{navigator.clipboard?.writeText(elFen.textContent?.trim()||'').then(()=>{const btn=root.querySelector('#ch-cp');btn.textContent='OK';setTimeout(()=>btn.textContent='CP',1200);}).catch(()=>{});});
elAutoModeButtons.forEach(btn=>btn.addEventListener('click',()=>{const nm=btn.dataset.autoMode||'off';if(nm===cfg.autoPlayMode)return;cfg.autoPlayMode=nm;persistConfig();scheduleRender();maybeAnalyze();}));
root.querySelector('#ch-fix-turn').addEventListener('click',()=>{state.turn=state.turn==='w'?'b':'w';if(state.fen)state.fen=state.fen.replace(/^(\\S+) [wb]/,'\$1 '+state.turn);scheduleRender();maybeAnalyze();});

const header=elPanel.querySelector('.ch-hdr');let drag=null;
header.addEventListener('pointerdown',e=>{if(e.target instanceof Element&&e.target.closest('button'))return;if(e.pointerType==='mouse'&&e.button!==0)return;const r=root.getBoundingClientRect();drag={startX:e.clientX,startY:e.clientY,originLeft:r.left,originTop:r.top};header.style.cursor='grabbing';header.setPointerCapture?.(e.pointerId);e.preventDefault();},{passive:false});
document.addEventListener('pointermove',e=>{if(!drag)return;root.style.left=(drag.originLeft+e.clientX-drag.startX)+'px';root.style.top=(drag.originTop+e.clientY-drag.startY)+'px';root.style.right='auto';root.style.bottom='auto';},{passive:true});
document.addEventListener('pointerup',()=>{drag=null;header.style.cursor='grab';},{passive:true});
}

function shouldShowPanel(){return!!cfg.enabled&&cfg.showPanel!==false&&!!getBoardEl();}
function showNotify(msg){if(cfg.showPanel===false)return;document.getElementById('ch-notify')?.remove();const n=document.createElement('div');n.id='ch-notify';n.textContent=msg;document.body.appendChild(n);setTimeout(()=>n.remove(),3000);}
function scheduleRender(){if(renderPending)return;renderPending=true;requestAnimationFrame(render);}
function render(){renderPending=false;if(!uiBuilt)buildUI();const root=document.getElementById('ch-root');const pv=shouldShowPanel();if(root)root.style.display=pv?'':'none';
if(pv&&elFen&&elSide&&elTurn&&elMoves&&elMovesLabel&&elStatus){
  if(state.myColor==='w')elSide.innerHTML='<span class="badge badge-white">WHITE</span>';
  else if(state.myColor==='b')elSide.innerHTML='<span class="badge badge-black">BLACK</span>';
  else elSide.textContent='Detecting...';
  const isMy=state.myColor&&state.turn===state.myColor;
  if(state.turn==='w')elTurn.innerHTML='<span class="badge badge-white'+(isMy?' myturn':'')+'">WHITE</span>'+(isMy?' ← <b style="color:#4f8cff">YOUR TURN</b>':'');
  else if(state.turn==='b')elTurn.innerHTML='<span class="badge badge-black'+(isMy?' myturn':'')+'">BLACK</span>'+(isMy?' ← <b style="color:#4f8cff">YOUR TURN</b>':'');
  else elTurn.textContent='-';
  if(isMy&&prevTurnForNotify!==state.turn)showNotify('Your turn!');
  prevTurnForNotify=state.turn;
  elAutoModeButtons.forEach(btn=>{const ia=btn.dataset.autoMode===cfg.autoPlayMode;btn.classList.toggle('active',ia);btn.disabled=ia;btn.setAttribute('aria-pressed',String(ia));});
  const eloEl=document.getElementById('ch-elo-val');if(eloEl){if(cfg.eloLimit>0)eloEl.innerHTML='<span class="badge badge-orange">ELO '+cfg.eloLimit+'</span>';else eloEl.textContent='∞ Unlimited';}
  elFen.textContent=state.fen||'-';
  if(state.turn!==state.myColor){elMovesLabel.textContent='Opponent turn: waiting';elMoves.textContent='';}
  else if(!cfg.enabled){elMovesLabel.textContent='Hints disabled';elMoves.textContent='';}
  else if(state.engineAnalyzing){elMovesLabel.textContent='Analyzing '+cfg.lines+' hints...';elMoves.textContent='';}
  else if(state.engineMoves.length){elMovesLabel.textContent=state.engineMoves.length+' engine hints';elMoves.textContent=state.engineMoves.map((m,i)=>{const p=pieceAtFenSquare(state.fen,m.from),name=PIECE_LABEL[p]||'?',ev=cfg.showEval?'  '+(m.eval||'-'):'';return'  '+(i+1)+'. '+name+' '+m.from.toUpperCase()+'-'+m.to.toUpperCase()+ev;}).join('\\n');}
  else{elMovesLabel.textContent=isMy?'No hints yet':'-';elMoves.textContent='';}
  const site=SITE==='lichess'?'lichess':'chess.com';
  elStatus.textContent=state.fen?site+' | '+new Date().toLocaleTimeString():'Waiting for board...';
  elStatus.style.color=state.fen?'#3dc96c':'#f80';
  if(autoMoveError){elStatus.textContent='Auto error: '+autoMoveError;elStatus.style.color='#ff6b6b';}
}
publishStreamState();ensureOverlayVisible();}

// ── Config ─────────────────────────────────────────────────────────
function normalizeConfig(input){const n={...DEFAULT_CONFIG,...(input||{})};n.depth=Math.min(25,Math.max(5,Number(n.depth)||15));n.lines=Math.min(5,Math.max(1,Number(n.lines)||3));n.autoPlayDelay=Math.min(5000,Math.max(300,Number(n.autoPlayDelay)||1500));n.autoPlayDelayMin=Math.min(10000,Math.max(500,Number(n.autoPlayDelayMin)||500));n.autoPlayDelayMax=Math.min(10000,Math.max(500,Number(n.autoPlayDelayMax)||10000));if(n.autoPlayDelayMin>n.autoPlayDelayMax)[n.autoPlayDelayMin,n.autoPlayDelayMax]=[n.autoPlayDelayMax,n.autoPlayDelayMin];n.eloLimit=Number.isInteger(Number(n.eloLimit))?Number(n.eloLimit):0;n.hintStyle=n.hintStyle==='chesscom'?'chesscom':'classic';n.colors=Array.isArray(n.colors)?n.colors.slice(0,5):DEFAULT_CONFIG.colors.slice();while(n.colors.length<5)n.colors.push(DEFAULT_CONFIG.colors[n.colors.length]);return n;}
function persistConfig(){chrome?.storage?.local?.set({[CONFIG_STORAGE_KEY]:cfg});}
function applyConfig(next){const prevElo=cfg.eloLimit;cfg=normalizeConfig(next);configReady=true;lastHintSignature='';if(prevElo!==cfg.eloLimit)eloOptionsSent=false;if(!cfg.enabled){state.engineMoves=[];clearHintOverlay();finishAnalysis();}if(!cfg.showArrows)clearHintOverlay();scheduleRender();maybeAnalyze();}
function loadConfig(){if(!chrome?.storage?.local){applyConfig(DEFAULT_CONFIG);return;}chrome.storage.local.get([CONFIG_STORAGE_KEY],r=>{applyConfig(r?.[CONFIG_STORAGE_KEY]||DEFAULT_CONFIG);});chrome.storage?.onChanged?.addListener((changes,area)=>{if(area!=='local'||!changes[CONFIG_STORAGE_KEY])return;applyConfig(changes[CONFIG_STORAGE_KEY].newValue||DEFAULT_CONFIG);});}

// ── Main loop ───────────────────────────────────────────────────────
function update(){const board=getBoardEl();if(!board){scheduleRender();return;}const nf=readFenFromDom(),nt=readTurn(),nc=getMyColor();const changed=nf!==state.fen||nt!==state.turn||nc!==state.myColor;if(nf)state.fen=nf;if(nt)state.turn=nt;state.myColor=nc;if(changed||!uiBuilt){if(changed){quickMovePending=false;autoMoveInFlight=false;}scheduleRender();}if(changed&&configReady)maybeAnalyze();}
function startObserver(){if(!document.body)return;const obs=new MutationObserver(()=>{clearTimeout(observerDebounce);observerDebounce=setTimeout(update,80);});obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','transform','data-board-fen','data-orientation']});}
function startPolling(){clearInterval(updatePollTimer);updatePollTimer=setInterval(update,document.hidden?4000:1500);document.addEventListener('visibilitychange',()=>{clearInterval(updatePollTimer);updatePollTimer=setInterval(update,document.hidden?4000:1500);});}
function bindShortcut(){document.addEventListener('keydown',e=>{if(!cfg.enabled||!configReady||e.repeat||e.metaKey||e.defaultPrevented)return;const key=cfg.quickMoveKey||' ';const match=key===' '?(e.code==='Space'||e.key===' '):e.key?.toLowerCase()===key.toLowerCase();if(!match)return;if(isEditableTarget(e.target))return;e.preventDefault();e.stopImmediatePropagation();triggerQuickMove('keydown');},true);}

function boot(){log('boot ['+SITE+']');loadConfig();startEngineHost();update();startObserver();startPolling();bindShortcut();window.addEventListener('resize',()=>{lastHintSignature='';scheduleRender();},{passive:true});log('boot:complete');}

if(document.body)boot();else document.addEventListener('DOMContentLoaded',boot,{once:true});
})();

// ── Review button injection cho chess.com ────────────────────────────
(()=>{
if(!/https:\\/\\/(?:www\\.)?chess\\.com\\//i.test(location.href))return;
const BASE_URL=window.__CK_BASE_URL__||'https://nguyenphanvn95.github.io/chesskiller';
const REVIEW_URL=window.__CK_REVIEW_URL__||BASE_URL+'/review.html';
const LOGO_URL=window.__CK_LOGO_URL__||BASE_URL+'/media/photo/logo.png';
const REVIEW_BUTTON_ATTR='data-chess-killer-review-button';
const REVIEW_MODAL_ATTR='data-chess-killer-review-modal';
const REVIEW_TOAST_ID='chess-killer-review-toast';
const REVIEW_IFRAME_OVERLAY_ID='chess-killer-review-iframe-overlay';
const REVIEW_IFRAME_ID='chess-killer-review-iframe';
const GAME_ROW_SELECTORS=['#profile-main table tbody tr','#vue-instance > div:nth-child(5) > div > div > table > tbody > tr','#games-root-index > div.table-responsive > table > tbody > tr'];
let reviewOverlayPrevBodyOverflow='',reviewOverlayPrevHtmlOverflow='';

function hideToast(){document.getElementById(REVIEW_TOAST_ID)?.remove();}
function showToast(message,type,duration){hideToast();const toast=document.createElement('div');toast.id=REVIEW_TOAST_ID;Object.assign(toast.style,{position:'fixed',top:'20px',right:'20px',zIndex:'2147483647',display:'flex',alignItems:'center',gap:'10px',maxWidth:'320px',padding:'12px 18px',borderRadius:'10px',boxShadow:'0 10px 30px rgba(0,0,0,.28)',font:'600 14px/1.35 system-ui,sans-serif',color:'#fff',background:type==='error'?'#dc2626':type==='loading'?'#2563eb':'#059669'});if(type==='loading'){toast.innerHTML='<span style="width:16px;height:16px;border:2px solid rgba(255,255,255,.9);border-top-color:transparent;border-radius:999px;display:inline-block;animation:chess-killer-spin 1s linear infinite"></span><span>'+message+'</span>';if(!document.getElementById('ck-spin-style')){const s=document.createElement('style');s.id='ck-spin-style';s.textContent='@keyframes chess-killer-spin{to{transform:rotate(360deg)}}';document.head.appendChild(s);}}else toast.textContent=message;document.body.appendChild(toast);if(duration>0)setTimeout(hideToast,duration);}
function swallowEvent(e){e.preventDefault();e.stopPropagation();}

function shouldUseEmbeddedReview(){return!!(window.matchMedia?.('(pointer: coarse)').matches&&window.matchMedia?.('(hover: none)').matches&&Math.min(window.innerWidth||0,window.innerHeight||0)<=900);}
function closeEmbeddedReview(){document.getElementById(REVIEW_IFRAME_OVERLAY_ID)?.remove();document.body.style.overflow=reviewOverlayPrevBodyOverflow;document.documentElement.style.overflow=reviewOverlayPrevHtmlOverflow;}

function openEmbeddedReview(url){const existing=document.getElementById(REVIEW_IFRAME_ID);if(existing instanceof HTMLIFrameElement){existing.src=url;return;}reviewOverlayPrevBodyOverflow=document.body.style.overflow||'';reviewOverlayPrevHtmlOverflow=document.documentElement.style.overflow||'';document.body.style.overflow='hidden';document.documentElement.style.overflow='hidden';const overlay=document.createElement('div');overlay.id=REVIEW_IFRAME_OVERLAY_ID;Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'2147483647',background:'rgba(3,7,18,.82)',backdropFilter:'blur(6px)'});const wrap=document.createElement('div');Object.assign(wrap.style,{position:'absolute',inset:'0',display:'flex',flexDirection:'column'});const closeBtn=document.createElement('button');closeBtn.type='button';closeBtn.textContent='✕';Object.assign(closeBtn.style,{position:'absolute',top:'max(12px,env(safe-area-inset-top))',right:'max(12px,env(safe-area-inset-right))',zIndex:'2',width:'44px',height:'44px',border:'0',borderRadius:'999px',background:'rgba(0,0,0,.72)',color:'#fff',font:'400 24px/1 system-ui',cursor:'pointer'});closeBtn.addEventListener('click',closeEmbeddedReview,true);const frame=document.createElement('iframe');frame.id=REVIEW_IFRAME_ID;frame.src=url;frame.setAttribute('allow','clipboard-read; clipboard-write');Object.assign(frame.style,{flex:'1 1 auto',width:'100%',height:'100%',border:'0',background:'#111'});overlay.addEventListener('click',e=>{if(e.target===overlay)closeEmbeddedReview();},true);wrap.appendChild(closeBtn);wrap.appendChild(frame);overlay.appendChild(wrap);document.body.appendChild(overlay);}

function createReviewButton(label){const btn=document.createElement('button');btn.type='button';btn.setAttribute(REVIEW_BUTTON_ATTR,'true');btn.title=label||'Review';btn.setAttribute('aria-label',label||'Review');btn.innerHTML='<img src="'+LOGO_URL+'" width="28" height="28" style="display:block" alt="'+(label||'Review')+'">';Object.assign(btn.style,{cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'2px',border:'0',borderRadius:'6px',background:'transparent',whiteSpace:'nowrap'});btn.addEventListener('mousedown',swallowEvent,true);btn.addEventListener('mouseup',swallowEvent,true);return btn;}

function createModalReviewButton(){const btn=createReviewButton('Review this game');btn.innerHTML='<img src="'+LOGO_URL+'" width="24" height="24" style="margin-right:8px" alt="Review"><span>Review this game</span>';Object.assign(btn.style,{width:'100%',minHeight:'44px',marginTop:'12px',padding:'10px 14px',border:'1px solid rgba(255,255,255,.08)',background:'linear-gradient(180deg,#3d3d3d,#2e2e2e)',boxShadow:'inset 0 1px 0 rgba(255,255,255,.06)',color:'#fff',font:'700 15px/1 system-ui,sans-serif'});return btn;}

function getGameUrlFromRow(row){const links=row.querySelectorAll('a[href*="/game/"]');for(const link of links){const href=link.getAttribute('href');if(href&&/\\/(?:analysis\\/)?game\\/(?:(live|daily)\\/)?\\d+/.test(href))return href.startsWith('http')?href:'https://www.chess.com'+href;}return null;}
function normalizeChessUsername(v){return String(v||'').trim().replace(/^@+/,'').toLowerCase();}
function collectUsernameHints(row){const usernames=new Set();const add=v=>{const n=normalizeChessUsername(v);if(n)usernames.add(n);};const pm=location.pathname.match(/^\\/member\\/([^/?#]+)/i);if(pm)add(pm[1]);row?.querySelectorAll?.('a[href*="/member/"]').forEach(link=>{const href=link.getAttribute('href')||'';const m=href.match(/\\/member\\/([^/?#]+)/i);if(m)add(m[1]);});return Array.from(usernames);}

// [US-PATCH] openReviewWithGameUrl dùng GM_xmlhttpRequest thay vì chrome.runtime.sendMessage
async function openReviewWithGameUrl(gameUrl,usernameHints){if(!gameUrl){showToast('Could not find a game link.','error',3000);return;}showToast('Fetching PGN...','loading');try{const fetchFn=window.__CK_FETCH_GAME_PGN__;if(!fetchFn)throw new Error('PGN fetcher not available');const response=await fetchFn(gameUrl,usernameHints||[]);if(response?.success&&response.pgn){const handoffKey='review-pgn:'+Date.now()+':'+Math.random().toString(36).slice(2,10);chrome.storage.local.set({[handoffKey]:{pgn:response.pgn,gameUrl,usernameHints:usernameHints||[],createdAt:Date.now()}},()=>{hideToast();const params=new URLSearchParams();params.set('pgnKey',handoffKey);params.set('gameUrl',gameUrl);const hints=(usernameHints||[]).map(normalizeChessUsername).filter(Boolean).join(',');if(hints)params.set('usernames',hints);const reviewUrl=REVIEW_URL+'?'+params.toString();if(shouldUseEmbeddedReview())openEmbeddedReview(reviewUrl);else window.open(reviewUrl,'_blank','noopener,noreferrer');});}else{hideToast();if(response?.needsRetry)showToast('Game not archived yet. Try again in a few seconds.','info',5000);else showToast('Could not fetch PGN for this game.','error',4000);}}catch(err){hideToast();showToast(err.message||'Could not open review.','error',4000);}}

function injectButtonsIntoGameList(root_){const rows=[];for(const sel of GAME_ROW_SELECTORS)root_?.querySelectorAll?.(sel).forEach(r=>rows.push(r));rows.forEach(row=>{if(row.querySelector('['+REVIEW_BUTTON_ATTR+']'))return;const table=row.closest('table');if(!table)return;const hr=table.querySelector('thead tr');if(hr&&!hr.querySelector('[data-chess-killer-review-header]')){const th=document.createElement('th');th.setAttribute('data-chess-killer-review-header','true');Object.assign(th.style,{textAlign:'center',width:'40px',whiteSpace:'nowrap'});hr.appendChild(th);}const cell=document.createElement('td');cell.setAttribute(REVIEW_BUTTON_ATTR,'true');Object.assign(cell.style,{textAlign:'center',verticalAlign:'middle'});const btn=createReviewButton();btn.addEventListener('click',e=>{swallowEvent(e);openReviewWithGameUrl(getGameUrlFromRow(row),collectUsernameHints(row));},true);cell.appendChild(btn);row.appendChild(cell);});}

function injectReviewButtonIntoGameOverModal(root_){const modal=root_?.querySelector?.('#board-layout-chessboard > div.board-modal-container-container > div > div');if(!modal||modal.querySelector('['+REVIEW_MODAL_ATTR+']'))return;const mount=modal.querySelector('.board-modal-buttons,.buttons')||modal.lastElementChild||modal;const btn=createModalReviewButton();btn.setAttribute(REVIEW_MODAL_ATTR,'true');btn.addEventListener('click',e=>{swallowEvent(e);openReviewWithGameUrl(window.location.href);},true);mount.parentElement?.appendChild(btn);}

function setupReviewButtons(){if(!document.body)return;const obs=new MutationObserver(mutations=>{for(const m of mutations){if(!m.addedNodes?.length)continue;m.addedNodes.forEach(node=>{if(!(node instanceof HTMLElement))return;injectButtonsIntoGameList(node);injectReviewButtonIntoGameOverModal(node);});}});obs.observe(document.body,{childList:true,subtree:true});injectButtonsIntoGameList(document);injectReviewButtonIntoGameOverModal(document);}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setupReviewButtons,{once:true});
else setupReviewButtons();
})();`;

  function run() {
    inject(CONTENT_SCRIPT);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

})();
