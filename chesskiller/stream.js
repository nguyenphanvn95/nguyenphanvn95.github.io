
// [USERSCRIPT PATCH] Stream page chạy trên GitHub Pages, đọc state từ localStorage
// State được ghi bởi userscript qua GM_setValue -> key 'ck_chStreamState'
// Stream page polling từ localStorage key này
(function(){
  if (!window._ckStreamStorageReady) {
    window._ckStreamStorageReady = true;
    // Provide a chrome.storage-like API that reads from localStorage
    if (!window.chrome?.storage?.local) {
      window._ckStorageGet = function(keys, cb) {
        const result = {};
        for (const k of (Array.isArray(keys) ? keys : [keys])) {
          try {
            const raw = localStorage.getItem('ck_' + k);
            if (raw != null) result[k] = JSON.parse(raw);
          } catch {}
        }
        cb(result);
      };
    }
  }
})();
'use strict';

const STREAM_KEY = 'chStreamState';
const FILES = 8;
const BORDER = 4;
const CS_MIN = 36;
const CS_MAX = 220;

function assetUrl(path) {
  const base = (window.__CK_BASE_URL__ || 'https://nguyenphanvn95.github.io/chesskiller');
  path = String(path || '');
  path = path.replace(/^photo\//, 'media/photo/').replace(/^audio\//, 'media/audio/');
  return base + '/' + path;
}

const IMGS = {
  wK: assetUrl('photo/wK.svg'), wQ: assetUrl('photo/wQ.svg'),
  wR: assetUrl('photo/wR.svg'), wB: assetUrl('photo/wB.svg'),
  wN: assetUrl('photo/wN.svg'), wP: assetUrl('photo/wP.svg'),
  bK: assetUrl('photo/bK.svg'), bQ: assetUrl('photo/bQ.svg'),
  bR: assetUrl('photo/bR.svg'), bB: assetUrl('photo/bB.svg'),
  bN: assetUrl('photo/bN.svg'), bP: assetUrl('photo/bP.svg'),
};

let CS = 72;
let latestState = null;
let renderedSig = null;
let boardFlipped = false;

const ARROW_COLORS = ['#4f8cff', '#2ecc71', '#f1c40f', '#e67e22', '#e74c3c'];
const ARROW_ALPHAS = [0.92, 0.78, 0.68, 0.60, 0.52];

const $ = id => document.getElementById(id);
const boardEl = $('board');
const piecesLayer = $('piecesLayer');
const highlightLayer = $('highlightLayer');

function boardPx() {
  return CS * FILES + BORDER * 2;
}

function applyBoardSize() {
  const size = boardPx();
  boardEl.style.width = size + 'px';
  boardEl.style.height = size + 'px';
  ['cvGrid', 'cvArrow'].forEach(id => {
    const cv = $(id);
    cv.width = size;
    cv.height = size;
  });
  highlightLayer.style.width = size + 'px';
  highlightLayer.style.height = size + 'px';
  piecesLayer.style.width = size + 'px';
  piecesLayer.style.height = size + 'px';
}

function parseFen(fen) {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  const rows = String(fen || '').split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r] || '') {
      if (/\d/.test(ch)) {
        c += Number(ch);
        continue;
      }
      if (c < 8) {
        grid[r][c] = { t: ch, img: IMGS[ch === ch.toUpperCase() ? `w${ch}` : `b${ch.toUpperCase()}`] };
      }
      c++;
    }
  }
  return grid;
}

function sqToPixel(sq, flipped) {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1], 10);
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank - 1 : 8 - rank;
  return {
    x: BORDER + col * CS + CS / 2,
    y: BORDER + row * CS + CS / 2,
  };
}

function drawGrid() {
  const cv = $('cvGrid');
  const ctx = cv.getContext('2d');
  const size = boardPx();
  ctx.clearRect(0, 0, size, size);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f0d9b5' : '#b58863';
      ctx.fillRect(BORDER + c * CS, BORDER + r * CS, CS, CS);
    }
  }

  ctx.strokeStyle = '#080806';
  ctx.lineWidth = BORDER;
  ctx.strokeRect(BORDER / 2, BORDER / 2, size - BORDER, size - BORDER);
}

function drawHighlights(squares, flipped) {
  highlightLayer.innerHTML = '';
  if (!squares?.length) return;
  const seen = new Set();
  squares.forEach(sq => {
    if (!sq || seen.has(sq)) return;
    seen.add(sq);
    const file = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq[1], 10);
    const col = flipped ? 7 - file : file;
    const row = flipped ? rank - 1 : 8 - rank;
    const div = document.createElement('div');
    div.className = `sq-hl ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
    div.style.cssText = `left:${BORDER + col * CS}px;top:${BORDER + row * CS}px;width:${CS}px;height:${CS}px`;
    highlightLayer.appendChild(div);
  });
}

function drawPieces(grid, flipped) {
  piecesLayer.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = grid[r][c];
      if (!piece?.img) continue;
      const drawCol = flipped ? 7 - c : c;
      const drawRow = flipped ? 7 - r : r;
      const div = document.createElement('div');
      div.className = 'piece';
      div.style.cssText = `left:${BORDER + drawCol * CS}px;top:${BORDER + drawRow * CS}px;width:${CS}px;height:${CS}px;background-image:url('${piece.img}')`;
      piecesLayer.appendChild(div);
    }
  }
}

function drawArrows(moves, flipped, colors) {
  const cv = $('cvArrow');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!moves?.length) return;

  moves.forEach((move, idx) => {
    if (!move.from || !move.to) return;
    const from = sqToPixel(move.from, flipped);
    const to = sqToPixel(move.to, flipped);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < CS * 0.22) return;

    const nx = dx / len;
    const ny = dy / len;
    const color = colors?.[idx] || ARROW_COLORS[idx] || ARROW_COLORS[0];
    const alpha = ARROW_ALPHAS[idx] || 0.55;
    const startOff = CS * 0.22;
    const headLen = Math.max(8, CS * (idx === 0 ? 0.3 : 0.26));
    const halfHead = Math.max(4, CS * (idx === 0 ? 0.12 : 0.1));
    const lineW = Math.max(2, CS * (idx === 0 ? 0.09 : 0.065));
    const ang = Math.atan2(dy, dx);
    const sx = from.x + nx * startOff;
    const sy = from.y + ny * startOff;
    const ex = to.x - nx * headLen * 0.78;
    const ey = to.y - ny * headLen * 0.78;

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const lx = to.x - nx * headLen - Math.sin(ang) * halfHead;
    const ly = to.y - ny * headLen + Math.cos(ang) * halfHead;
    const rx = to.x - nx * headLen + Math.sin(ang) * halfHead;
    const ry = to.y - ny * headLen - Math.cos(ang) * halfHead;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(lx, ly);
    ctx.lineTo(rx, ry);
    ctx.closePath();
    ctx.fill();
  });

  ctx.globalAlpha = 1;
}

function renderState(state) {
  const flipped = state.playerSide === 'b';
  boardFlipped = flipped;
  const sig = JSON.stringify([
    state.fen,
    flipped,
    (state.lastMoveSquares || []).join('|'),
    (state.moves || []).map(move => `${move.from}${move.to}${move.eval || ''}`),
    (state.colors || []).join(','),
  ]);
  if (sig === renderedSig) return;
  renderedSig = sig;

  drawGrid();
  drawHighlights(state.lastMoveSquares || [], flipped);
  drawPieces(parseFen(state.fen), flipped);
  drawArrows(state.moves || [], flipped, state.colors);
}

function poll() {
  chrome.storage.local.get([STREAM_KEY], result => {
    const state = result?.[STREAM_KEY];
    if (!state?.fen) return;
    latestState = state;
    renderState(state);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STREAM_KEY]) return;
  const state = changes[STREAM_KEY].newValue;
  if (!state?.fen) return;
  latestState = state;
  renderState(state);
});

(function initResize() {
  const handle = $('board-resize');
  let drag = false;
  let startX = 0;
  let startCS = CS;

  const start = x => {
    drag = true;
    startX = x;
    startCS = CS;
  };

  const move = x => {
    if (!drag) return;
    CS = Math.max(CS_MIN, Math.min(CS_MAX, Math.round(startCS + (x - startX) / FILES)));
    applyBoardSize();
    renderedSig = null;
    if (latestState) renderState(latestState);
    else drawGrid();
  };

  const end = () => { drag = false; };

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    start(e.clientX);
  });
  document.addEventListener('mousemove', e => move(e.clientX));
  document.addEventListener('mouseup', end);
  handle.addEventListener('touchstart', e => {
    e.preventDefault();
    start(e.touches[0].clientX);
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!drag) return;
    e.preventDefault();
    move(e.touches[0].clientX);
  }, { passive: false });
  document.addEventListener('touchend', end);
})();

applyBoardSize();
drawGrid();
setInterval(poll, 600);
poll();
