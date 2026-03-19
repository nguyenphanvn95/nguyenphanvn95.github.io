'use strict';

const COLS = 9;
const ROWS = 10;
const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const IMGS = {
  rR:'images/pieces/r-piece_white.svg', nR:'images/pieces/n-piece_white.svg',
  bR:'images/pieces/b-piece_white.svg', aR:'images/pieces/a-piece_white.svg',
  kR:'images/pieces/k-piece_white.svg', cR:'images/pieces/c-piece_white.svg',
  pR:'images/pieces/p-piece_white.svg',
  rB:'images/pieces/r-piece_black.svg', nB:'images/pieces/n-piece_black.svg',
  bB:'images/pieces/b-piece_black.svg', aB:'images/pieces/a-piece_black.svg',
  kB:'images/pieces/k-piece_black.svg', cB:'images/pieces/c-piece_black.svg',
  pB:'images/pieces/p-piece_black.svg',
};
const PNAME = { r: 'R', n: 'H', b: 'E', a: 'A', k: 'K', c: 'C', p: 'P' };
const MOVE_QUALITY = {
  brilliant: { key: 'brilliant', label: 'Brilliant', short: '!!' },
  best: { key: 'best', label: 'Best', short: '*' },
  excellent: { key: 'excellent', label: 'Excellent', short: '!' },
  good: { key: 'good', label: 'Good', short: '+' },
  inaccuracy: { key: 'inaccuracy', label: 'Inaccuracy', short: '?!' },
  mistake: { key: 'mistake', label: 'Mistake', short: '?' },
  blunder: { key: 'blunder', label: 'Blunder', short: '??' },
};
const PIECE_VALUE = { k: 0, r: 9, c: 4.5, n: 4, b: 2, a: 2, p: 1 };
const MIN_EVAL_DEPTH = 10;
const MIN_REVIEW_DEPTH = 12;
const QUALITY_ICON_SVG = {
  brilliant: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l1.8 4.3L18 9.1l-4.2 1.7L12 15l-1.8-4.2L6 9.1l4.2-1.8L12 3z"></path>
      <path d="M5 5l1.2 1.2M19 5l-1.2 1.2M5 19l1.2-1.2M19 19l-1.2-1.2M12 1.8v2.1M12 20.1v2.1M1.8 12h2.1M20.1 12h2.1"></path>
    </svg>`,
  best: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2l2.6 5.2 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.2z"></path>
    </svg>`,
  excellent: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.2 20H6.3c-.8 0-1.3-.6-1.3-1.3v-7.1c0-.8.5-1.3 1.3-1.3h2.9V20z"></path>
      <path d="M11 20h5.1c1.2 0 2.2-.8 2.5-2l1-4.7c.3-1.3-.7-2.5-2-2.5h-3.8l.5-3.1V6.8c0-1-.8-1.8-1.8-1.8h-.4L9.8 10v10H11z"></path>
    </svg>`,
  good: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.7 16.8L5.9 13l1.7-1.7 2.1 2.1 6.7-6.7 1.7 1.7-8.4 8.4z"></path>
    </svg>`,
  inaccuracy: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.6 9.1a2.7 2.7 0 1 1 5.4 0c0 1.6-1.3 2.3-2.1 2.9-.7.5-1 .8-1 1.7v.7"></path>
      <circle cx="12" cy="17.6" r="1.2"></circle>
      <path d="M18.4 7.7l2.2 2.2M19.5 7.7l1.1 1.1"></path>
    </svg>`,
  mistake: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.6 9.1a2.7 2.7 0 1 1 5.4 0c0 1.6-1.3 2.3-2.1 2.9-.7.5-1 .8-1 1.7v.7"></path>
      <circle cx="12" cy="17.6" r="1.2"></circle>
    </svg>`,
  blunder: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.8 9.1a2.6 2.6 0 1 1 5.2 0c0 1.4-1.1 2.1-1.8 2.6-.6.5-.9.8-.9 1.6v.7"></path>
      <circle cx="10.4" cy="17.6" r="1.1"></circle>
      <path d="M13.5 9.1a2.6 2.6 0 1 1 5.2 0c0 1.4-1.1 2.1-1.8 2.6-.6.5-.9.8-.9 1.6v.7"></path>
      <circle cx="16.1" cy="17.6" r="1.1"></circle>
    </svg>`,
};

let board = [];
let sel = null;
let turn = 'R';
let flipped = false;
let hist = [];
let states = [];
let hIdx = -1;
let baseToolsWidth = null;
let settingsOpen = false;
let manualBoardSize = false;
let CS = 64, PX = 29, PY = 29;
const CS_MIN = 32, CS_MAX = 220;

const engineState = {
  worker: null,
  booted: false,
  uciReady: false,
  optionsSent: false,
  awaitingReadyReason: '',
  on: true,
  ready: false,
  configuring: false,
  debug: false,
  showMultipleLines: false,
  pvByLine: new Map(),
  bestArrowMove: null,
  bestPvMoves: [],
  pvPreviewMoves: [],
  selectedLine: 1,
  lastEval: 0,
  evalDepth: 0,
  analysing: false,
  lastFen: '',
  debugSeq: 0,
  pendingRequest: null,
  currentFen: '',
  requestSeq: 0,
  timer: null,
  pendingMoveReview: null,
};

function $(id) { return document.getElementById(id); }
function dc(b) { return b.map(r => r.map(p => p ? { ...p } : null)); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function parseGameFEN(fen) {
  const [placement, active] = String(fen).trim().split(/\s+/);
  const rows = placement.split('/');
  if (rows.length !== ROWS) throw new Error('Invalid FEN');
  const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { c += Number(ch); continue; }
      if (c >= COLS) throw new Error('Invalid FEN');
      b[r][c] = { t: ch.toLowerCase(), s: ch === ch.toUpperCase() ? 'R' : 'B' };
      c++;
    }
    if (c !== COLS) throw new Error('Invalid FEN');
  }
  return { board: b, turn: active === 'b' ? 'B' : 'R' };
}

function boardToPlacement(b) {
  return b.map(row => {
    let s = '', e = 0;
    for (const p of row) {
      if (!p) { e++; continue; }
      if (e) { s += e; e = 0; }
      s += p.s === 'R' ? p.t.toUpperCase() : p.t;
    }
    if (e) s += e;
    return s;
  }).join('/');
}

function toFEN(b, t) {
  return `${boardToPlacement(b)} ${t === 'R' ? 'w' : 'b'} - - 0 ${Math.floor(hist.length / 2) + 1}`;
}

function cx(col) { return PX + col * CS; }
function cy(row) { return PY + row * CS; }
function boardColOrder() { return flipped ? [8,7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7,8]; }
function boardRowOrder() { return flipped ? [9,8,7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7,8,9]; }

function buildCoords() {
  const files = flipped ? ['1','2','3','4','5','6','7','8','9'] : ['9','8','7','6','5','4','3','2','1'];
  const top = $('coordTop'), bot = $('coordBot');
  top.innerHTML = ''; bot.innerHTML = '';
  const sidePad = PX - CS / 2;
  top.style.paddingLeft = `${sidePad}px`;
  top.style.paddingRight = `${sidePad}px`;
  bot.style.paddingLeft = `${sidePad}px`;
  bot.style.paddingRight = `${sidePad}px`;
  files.forEach(ch => {
    const a = document.createElement('span');
    a.textContent = ch;
    a.style.width = `${CS}px`;
    const b = a.cloneNode(true);
    top.appendChild(a);
    bot.appendChild(b);
  });
}

function applyBoardSize() {
  const bW = CS * (COLS - 1) + PX * 2;
  const bH = CS * (ROWS - 1) + PY * 2;
  const bEl = $('board');
  bEl.style.width = `${bW}px`;
  bEl.style.height = `${bH}px`;
  $('cvGrid').width = bW; $('cvGrid').height = bH;
  $('cvArrow').width = bW; $('cvArrow').height = bH;
}

function fitBoardToViewport() {
  if (manualBoardSize) return;
  const right = $('right-stack');
  const gaugeW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gauge-w'), 10) || 12;
  const rightW = right?.offsetWidth || 540;
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
  const widthUnits = (COLS - 1) + 0.92;
  const heightUnits = (ROWS - 1) + 0.92;
  const fitCS = Math.max(CS_MIN, Math.min(CS_MAX, Math.min(
    Math.floor(avW / widthUnits),
    Math.floor(avH / heightUnits)
  )));
  if (!hist.length && CS === 64) CS = fitCS;
  PX = Math.round(CS * 0.46);
  PY = PX;
}

function syncStagePanels() {
  const boardStage = $('board-stage');
  const boardCol = $('board-col');
  const boardEl = $('board');
  const gauge = $('gauge');
  const undr = $('undr');
  const tools = $('tools');
  const right = $('right-stack');
  const ctrl = $('ctrl');
  const stageW = boardCol.offsetWidth + gauge.offsetWidth;
  const boardRect = boardEl.getBoundingClientRect();
  const stageRect = boardStage.getBoundingClientRect();
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
  if (baseToolsWidth == null) baseToolsWidth = stageW;
  const viewportW = Math.max(280, window.innerWidth - (phoneLayout ? 12 : 20));
  const unifiedMobileW = Math.min(boardCol.offsetWidth || stageW, viewportW);
  const toolsW = (stackedLayout || mobileLayout) ? unifiedMobileW : Math.min(baseToolsWidth, stageW);
  const stageWidth = (stackedLayout || mobileLayout)
    ? Math.min(viewportW, boardLeft + boardW + reservedGaugeSpace)
    : stageW;
  boardStage.style.width = `${stageWidth}px`;
  const underW = (stackedLayout || mobileLayout) ? unifiedMobileW : boardW;
  undr.style.width = `${underW}px`;
  undr.style.minWidth = `${underW}px`;
  undr.style.maxWidth = `${underW}px`;
  gauge.style.marginTop = overlayGaugeLayout ? '0px' : `${gaugeTop}px`;
  gauge.style.height = `${boardH}px`;
  if (overlayGaugeLayout) {
    gauge.style.top = `${gaugeTop}px`;
    gauge.style.left = `${boardRight + mobileGaugeGap}px`;
    gauge.style.right = 'auto';
  } else {
    gauge.style.top = '';
    gauge.style.left = '';
    gauge.style.right = '';
  }
  tools.style.width = `${toolsW}px`;
  ctrl.style.width = `${toolsW}px`;
  right.style.width = `${toolsW}px`;
  right.style.minWidth = `${toolsW}px`;
  tools.style.height = (stackedLayout || mobileLayout) ? 'auto' : `${boardH}px`;
  right.style.height = (stackedLayout || mobileLayout) ? 'auto' : `${boardH + ctrl.offsetHeight}px`;
}

function centerAnalysisViewport() {
  const app = $('app');
  const viewport = $('analysis-viewport');
  const overflowX = viewport.offsetWidth - app.clientWidth;
  app.scrollLeft = overflowX > 0 ? Math.round(overflowX / 2) : 0;
}

function layout() {
  fitBoardToViewport();
  applyBoardSize();
  buildCoords();
  syncStagePanels();
  centerAnalysisViewport();
  drawGrid();
}

function pxToCell(x, y) {
  const col = Math.round((x - PX) / CS);
  const row = Math.round((y - PY) / CS);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return flipped ? { row: 9 - row, col: 8 - col } : { row, col };
}

function drawGrid() {
  const cv = $('cvGrid');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = 'rgba(80,45,12,0.85)';
  ctx.lineWidth = Math.max(1, Math.round(CS / 30));
  const x0 = PX, y0 = PY, x1 = PX + CS * (COLS - 1), y1 = PY + CS * (ROWS - 1);
  for (let r = 0; r < ROWS; r++) {
    const y = PY + r * CS;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  for (let c = 0; c < COLS; c++) {
    const x = PX + c * CS;
    ctx.beginPath(); ctx.moveTo(x, PY); ctx.lineTo(x, PY + 4 * CS); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, PY + 5 * CS); ctx.lineTo(x, y1); ctx.stroke();
  }
  [
    [[0, 3], [2, 5]],
    [[0, 5], [2, 3]],
    [[7, 3], [9, 5]],
    [[7, 5], [9, 3]],
  ].forEach(([[r0, c0], [r1, c1]]) => {
    ctx.beginPath();
    ctx.moveTo(PX + c0 * CS, PY + r0 * CS);
    ctx.lineTo(PX + c1 * CS, PY + r1 * CS);
    ctx.stroke();
  });
  drawMarks(ctx);
}

function drawCorner(ctx, x, y, sgnX, sgnY) {
  const a = CS * 0.12, b = CS * 0.22;
  ctx.beginPath();
  ctx.moveTo(x + sgnX * a, y + sgnY * b);
  ctx.lineTo(x + sgnX * a, y + sgnY * a);
  ctx.lineTo(x + sgnX * b, y + sgnY * a);
  ctx.stroke();
}

function drawMarks(ctx) {
  const marks = [[2,1],[2,7],[7,1],[7,7],[3,0],[3,2],[3,4],[3,6],[3,8],[6,0],[6,2],[6,4],[6,6],[6,8]];
  for (const [r,c] of marks) {
    const x = PX + c * CS, y = PY + r * CS;
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([sx,sy]) => {
      if ((c === 0 && sx === -1) || (c === 8 && sx === 1)) return;
      drawCorner(ctx, x, y, sx, sy);
    });
  }
}

function classifyMoveQuality(delta) {
  if (!Number.isFinite(delta)) return null;
  return delta >= 0 ? MOVE_QUALITY.good : MOVE_QUALITY.inaccuracy;
}

function pieceValue(piece) {
  if (!piece) return 0;
  return PIECE_VALUE[piece.t] || 0;
}

function countSquareAttackers(boardState, side, row, col) {
  let total = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = boardState[r]?.[c];
      if (!piece || piece.s !== side) continue;
      if (moves(r, c, boardState).some(m => m.row === row && m.col === col)) total++;
    }
  }
  return total;
}

function attackedTargetsFromSquare(boardState, side, row, col) {
  const piece = boardState[row]?.[col];
  if (!piece || piece.s !== side) return [];
  const targets = [];
  for (const mv of moves(row, col, boardState)) {
    const target = boardState[mv.row]?.[mv.col];
    if (!target || target.s === side) continue;
    targets.push({ row: mv.row, col: mv.col, piece: target, value: pieceValue(target) });
  }
  return targets;
}

function buildMoveQualityContext(review, move) {
  const beforeBoard = states[review.moveIndex] ? dc(states[review.moveIndex]) : null;
  const afterBoard = states[review.moveIndex + 1] ? dc(states[review.moveIndex + 1]) : null;
  if (!beforeBoard || !afterBoard || !move) return null;

  const mover = review.mover;
  const opponent = mover === 'R' ? 'B' : 'R';
  const movedPiece = beforeBoard[move.fr.row]?.[move.fr.col] || move.p || null;
  const capturedPiece = beforeBoard[move.to.row]?.[move.to.col] || null;
  const legalMovesBefore = collectLegalMovesForTurn(beforeBoard, mover);
  const attackersAfter = countSquareAttackers(afterBoard, opponent, move.to.row, move.to.col);
  const defendersAfter = countSquareAttackers(afterBoard, mover, move.to.row, move.to.col);
  const attackedTargets = attackedTargetsFromSquare(afterBoard, mover, move.to.row, move.to.col);
  const valuableTargets = attackedTargets.filter(target => target.value >= 4 || target.piece.t === 'k');
  const majorTargets = attackedTargets.filter(target => target.value >= 2);
  const movedValue = pieceValue(movedPiece);
  const capturedValue = pieceValue(capturedPiece);
  const checkAfter = inCheck(afterBoard, opponent);
  const wasInCheck = inCheck(beforeBoard, mover);
  const isOnlyLegalMove = wasInCheck && legalMovesBefore.length === 1;
  const isCapture = !!capturedPiece;
  const isSacrificeCandidate = movedValue >= 2
    && attackersAfter > defendersAfter
    && movedValue > capturedValue + 1;
  const createsFork = valuableTargets.length >= 2 || (checkAfter && majorTargets.length >= 1);
  const isQuiet = !isCapture && !checkAfter;

  return {
    beforeBoard,
    afterBoard,
    movedPiece,
    capturedPiece,
    movedValue,
    capturedValue,
    isCapture,
    checkAfter,
    wasInCheck,
    isOnlyLegalMove,
    attackersAfter,
    defendersAfter,
    isSacrificeCandidate,
    attackedTargets,
    valuableTargets,
    majorTargets,
    createsFork,
    isQuiet,
  };
}

function getAdaptiveQualityThresholds(beforeEval) {
  const absEval = Math.min(12, Math.abs(beforeEval || 0));
  const slack = absEval * 0.05;
  return {
    excellentLoss: 0.1 + slack,
    goodLoss: 0.3 + slack * 1.7,
    inaccuracyLoss: 0.8 + slack * 2.4,
    mistakeLoss: 1.8 + slack * 3.0,
  };
}

function getBrilliantReason(context) {
  if (!context) return '';
  if (context.isSacrificeCandidate && context.createsFork && context.checkAfter) return 'Best tactical sacrifice with check and follow-up threats';
  if (context.isSacrificeCandidate && context.createsFork) return 'Best tactical sacrifice creating multiple threats';
  if (context.isSacrificeCandidate && context.checkAfter) return 'Best sacrificial attack that keeps the initiative';
  if (context.isOnlyLegalMove && context.checkAfter) return 'Only defensive move that turns the tables with check';
  if (context.isOnlyLegalMove) return 'Only move that holds the position';
  if (context.createsFork && context.isQuiet) return 'Quiet best move creating a strong fork threat';
  if (context.createsFork) return 'Best move creating multiple tactical threats';
  return '';
}

function classifyMoveQualityAdvanced(delta, options = {}) {
  if (!Number.isFinite(delta)) return null;
  const beforeEval = Number(options.beforeEval) || 0;
  const exactBest = !!options.exactBest;
  const context = options.context || null;
  const loss = Math.max(0, -delta);
  const thresholds = getAdaptiveQualityThresholds(beforeEval);
  const brilliantReason = getBrilliantReason(context);
  const nearBest = loss <= thresholds.excellentLoss;

  if ((exactBest || nearBest) && brilliantReason) {
    return { ...MOVE_QUALITY.brilliant, reason: brilliantReason, delta: Number(delta.toFixed(2)) };
  }
  if (exactBest) {
    return { ...MOVE_QUALITY.best, reason: 'Engine top move', delta: Number(delta.toFixed(2)) };
  }
  if (loss <= thresholds.excellentLoss) {
    const reason = context?.checkAfter
      ? 'Very close to best and keeps the initiative'
      : 'Very close to the engine choice';
    return { ...MOVE_QUALITY.excellent, reason, delta: Number(delta.toFixed(2)) };
  }
  if (loss <= thresholds.goodLoss || delta >= 0) {
    return { ...MOVE_QUALITY.good, reason: 'Solid move with limited evaluation loss', delta: Number(delta.toFixed(2)) };
  }
  if (loss <= thresholds.inaccuracyLoss) {
    return { ...MOVE_QUALITY.inaccuracy, reason: 'Noticeable inaccuracy, but still playable', delta: Number(delta.toFixed(2)) };
  }
  if (loss <= thresholds.mistakeLoss) {
    return { ...MOVE_QUALITY.mistake, reason: 'Significant evaluation drop', delta: Number(delta.toFixed(2)) };
  }
  return { ...MOVE_QUALITY.blunder, reason: 'Large tactical or positional collapse', delta: Number(delta.toFixed(2)) };
}

function applyMoveQuality(review, redAdvAfter) {
  if (!review) return;
  const move = hist[review.moveIndex];
  if (!move) return;
  const before = review.mover === 'R' ? review.beforeEval : -review.beforeEval;
  const after = review.mover === 'R' ? redAdvAfter : -redAdvAfter;
  const delta = after - before;
  const context = buildMoveQualityContext(review, move);
  const quality = classifyMoveQualityAdvanced(delta, {
    beforeEval: before,
    exactBest: !!review.bestMoveUci && move.uci === review.bestMoveUci,
    context,
  }) || classifyMoveQuality(delta);
  move.quality = quality || null;
}

function formatQualityTitle(quality) {
  if (!quality) return '';
  const deltaText = quality.delta >= 0 ? `+${quality.delta}` : `${quality.delta}`;
  return quality.reason ? `${quality.label} (${deltaText}) - ${quality.reason}` : `${quality.label} (${deltaText})`;
}

function badgeIconMarkup(qualityKey) {
  return QUALITY_ICON_SVG[qualityKey] || '';
}

function clearArrow() {
  const ctx = $('cvArrow').getContext('2d');
  ctx.clearRect(0, 0, $('cvArrow').width, $('cvArrow').height);
}

function drawArrow(frRow, frCol, toRow, toCol, color = '#15781B', alpha = 0.78) {
  const ctx = $('cvArrow').getContext('2d');
  clearArrow();
  const [sCol, sRow] = flipped ? [8 - frCol, 9 - frRow] : [frCol, frRow];
  const [eCol, eRow] = flipped ? [8 - toCol, 9 - toRow] : [toCol, toRow];
  const x1 = cx(sCol), y1 = cy(sRow), x2 = cx(eCol), y2 = cy(eRow);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const nx = dx / len, ny = dy / len;
  const r = CS * 0.22;
  const ex = x2 - nx * r * 1.4, ey = y2 - ny * r * 1.4;
  const ang = Math.atan2(dy, dx);
  const ah = CS * 0.24;
  const aw = Math.max(3, CS * 0.1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = aw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1 + nx * r * 1.1, y1 + ny * r * 1.1);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2 - nx * r, y2 - ny * r);
  ctx.lineTo(x2 - nx * r - ah * Math.cos(ang - 0.5), y2 - ny * r - ah * Math.sin(ang - 0.5));
  ctx.lineTo(x2 - nx * r - ah * Math.cos(ang + 0.5), y2 - ny * r - ah * Math.sin(ang + 0.5));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function moves(row, col, b) {
  const p = b[row][col];
  if (!p) return [];
  const op = p.s === 'R' ? 'B' : 'R';
  const ok = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && (!b[r][c] || b[r][c].s === op);
  const em = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && !b[r][c];
  const mv = [];
  if (p.t === 'r') {
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      for (let r = row + dr, c = col + dc; r >= 0 && r < ROWS && c >= 0 && c < COLS; r += dr, c += dc) {
        if (!b[r][c]) { mv.push({ row: r, col: c }); continue; }
        if (b[r][c].s === op) mv.push({ row: r, col: c });
        break;
      }
    }
  } else if (p.t === 'n') {
    for (const [lr, lc, dr, dc] of [[-1,0,-2,-1],[-1,0,-2,1],[1,0,2,-1],[1,0,2,1],[0,-1,-1,-2],[0,-1,1,-2],[0,1,-1,2],[0,1,1,2]]) {
      if (em(row + lr, col + lc) && ok(row + dr, col + dc)) mv.push({ row: row + dr, col: col + dc });
    }
  } else if (p.t === 'b') {
    const zone = p.s === 'R' ? [5,6,7,8,9] : [0,1,2,3,4];
    for (const [dr, dc] of [[-2,-2],[-2,2],[2,-2],[2,2]]) {
      if (zone.includes(row + dr) && col + dc >= 0 && col + dc < COLS && em(row + dr / 2, col + dc / 2) && ok(row + dr, col + dc)) mv.push({ row: row + dr, col: col + dc });
    }
  } else if (p.t === 'a') {
    const zone = p.s === 'R' ? [7,8,9] : [0,1,2];
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr = row + dr, nc = col + dc;
      if (zone.includes(nr) && nc >= 3 && nc <= 5 && ok(nr, nc)) mv.push({ row: nr, col: nc });
    }
  } else if (p.t === 'k') {
    const zone = p.s === 'R' ? [7,8,9] : [0,1,2];
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nr = row + dr, nc = col + dc;
      if (zone.includes(nr) && nc >= 3 && nc <= 5 && ok(nr, nc)) mv.push({ row: nr, col: nc });
    }
    for (let r = row + (p.s === 'R' ? -1 : 1); r >= 0 && r < ROWS; r += (p.s === 'R' ? -1 : 1)) {
      if (!b[r][col]) continue;
      if (b[r][col].t === 'k' && b[r][col].s === op) mv.push({ row: r, col });
      break;
    }
  } else if (p.t === 'c') {
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      let jumped = false;
      for (let r = row + dr, c = col + dc; r >= 0 && r < ROWS && c >= 0 && c < COLS; r += dr, c += dc) {
        if (!jumped) {
          if (!b[r][c]) mv.push({ row: r, col: c });
          else jumped = true;
        } else if (b[r][c]) {
          if (b[r][c].s === op) mv.push({ row: r, col: c });
          break;
        }
      }
    }
  } else if (p.t === 'p') {
    if (p.s === 'R') {
      if (ok(row - 1, col)) mv.push({ row: row - 1, col });
      if (row <= 4) {
        if (ok(row, col - 1)) mv.push({ row, col: col - 1 });
        if (ok(row, col + 1)) mv.push({ row, col: col + 1 });
      }
    } else {
      if (ok(row + 1, col)) mv.push({ row: row + 1, col });
      if (row >= 5) {
        if (ok(row, col - 1)) mv.push({ row, col: col - 1 });
        if (ok(row, col + 1)) mv.push({ row, col: col + 1 });
      }
    }
  }
  return mv;
}

function findKing(b, s) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (b[r][c] && b[r][c].t === 'k' && b[r][c].s === s) return { row: r, col: c };
  return null;
}

function inCheck(b, s) {
  const k = findKing(b, s);
  if (!k) return false;
  const op = s === 'R' ? 'B' : 'R';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!b[r][c] || b[r][c].s !== op) continue;
      if (moves(r, c, b).some(m => m.row === k.row && m.col === k.col)) return true;
    }
  }
  const ok2 = findKing(b, op);
  if (ok2 && ok2.col === k.col) {
    const mn = Math.min(k.row, ok2.row), mx = Math.max(k.row, ok2.row);
    let blocked = false;
    for (let r = mn + 1; r < mx; r++) if (b[r][k.col]) { blocked = true; break; }
    if (!blocked) return true;
  }
  return false;
}

function collectLegalMovesForTurn(b, s) {
  const list = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p || p.s !== s) continue;
      for (const m of moves(r, c, b)) {
        const next = dc(b);
        next[m.row][m.col] = next[r][c];
        next[r][c] = null;
        if (!inCheck(next, s)) list.push({ fr: { row: r, col: c }, to: { row: m.row, col: m.col }, piece: { ...p } });
      }
    }
  }
  return list;
}

function notation(p, fr, fc, tr, tc) {
  const cols = '987654321';
  const fc2 = cols[fc] ?? String(fc + 1), tc2 = cols[tc] ?? String(tc + 1);
  let dir;
  if (p.s === 'R') dir = tr < fr ? '+' : tr > fr ? '-' : '=';
  else dir = tr > fr ? '+' : tr < fr ? '-' : '=';
  return `${PNAME[p.t] ?? '?'}${fc2}${dir}${Math.abs(tr - fr) || Math.abs(tc - fc)}`;
}

function applyMove(fr, fc, tr, tc) {
  const nb = dc(board);
  nb[tr][tc] = nb[fr][fc];
  nb[fr][fc] = null;
  if (inCheck(nb, turn)) return false;
  const p = board[fr][fc];
  board = nb;
  if (hIdx < hist.length - 1) {
    hist = hist.slice(0, hIdx + 1);
    states = states.slice(0, hIdx + 2);
  }
  const move = {
    fr: { row: fr, col: fc },
    to: { row: tr, col: tc },
    p: { ...p },
    mover: p.s,
    evalBefore: engineState.lastEval,
    not: notation(p, fr, fc, tr, tc),
    uci: moveToUci({ fr: { row: fr, col: fc }, to: { row: tr, col: tc } }),
  };
  hist.push(move);
  states.push(dc(board));
  hIdx = hist.length - 1;
  turn = turn === 'R' ? 'B' : 'R';
  engineState.pendingMoveReview = {
    moveIndex: hIdx,
    mover: p.s,
    beforeEval: engineState.lastEval,
    bestMoveUci: engineState.bestPvMoves?.[0]?.uci || engineState.bestArrowMove?.uci || null,
    fen: toFEN(board, turn),
  };
  sel = null;
  return true;
}

function moveToUci(move) {
  const file = c => String.fromCharCode(97 + c);
  const rank = r => String(9 - r);
  return `${file(move.fr.col)}${rank(move.fr.row)}${file(move.to.col)}${rank(move.to.row)}`;
}

function moveToLegacyUciVariants(move) {
  const file = c => String.fromCharCode(97 + c);
  const rank10 = r => String(10 - r);
  const rank9 = r => String(9 - r);
  const rankInv10 = r => String(r + 1);
  return [
    `${file(move.fr.col)}${rank10(move.fr.row)}${file(move.to.col)}${rank10(move.to.row)}`,
    `${file(move.fr.col)}${rank9(move.fr.row)}${file(move.to.col)}${rank9(move.to.row)}`,
    `${file(move.fr.col)}${rankInv10(move.fr.row)}${file(move.to.col)}${rankInv10(move.to.row)}`,
  ];
}

function parsePikafishSquare(fileChar, rankText) {
  const col = String(fileChar || '').toLowerCase().charCodeAt(0) - 97;
  const rank = Number(rankText);
  if (!Number.isInteger(col) || col < 0 || col >= COLS || !Number.isFinite(rank)) return null;
  if (rank < 0 || rank > 9) return null;
  return { row: 9 - rank, col };
}

function parseLegacySquare(fileChar, rankText) {
  const col = String(fileChar || '').toLowerCase().charCodeAt(0) - 97;
  const rank = Number(rankText);
  if (!Number.isInteger(col) || col < 0 || col >= COLS || !Number.isFinite(rank)) return null;
  if (rank >= 1 && rank <= 10) return { row: 10 - rank, col };
  return null;
}

function parseXiangqiSquare(fileChar, rankText, currentBoard = board, currentTurn = turn) {
  const candidates = [
    parsePikafishSquare(fileChar, rankText),
    parseLegacySquare(fileChar, rankText),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const piece = currentBoard[candidate.row]?.[candidate.col];
    if (piece && piece.s === currentTurn) return { ...candidate, piece };
  }
  for (const candidate of candidates) {
    const piece = currentBoard[candidate.row]?.[candidate.col];
    if (piece) return { ...candidate, piece };
  }
  return candidates.length ? { ...candidates[0], piece: null } : null;
}

function uciToCoords(uci, currentBoard = board, currentTurn = turn) {
  const m = String(uci || '').trim().match(/^([a-i])(10|[0-9])([a-i])(10|[0-9])$/i);
  if (!m) return null;
  const from = parseXiangqiSquare(m[1], m[2], currentBoard, currentTurn);
  const to = parseXiangqiSquare(m[3], m[4], currentBoard, currentTurn) || parseXiangqiSquare(m[3], m[4], currentBoard, currentTurn === 'R' ? 'B' : 'R');
  if (!from || !to) return null;
  const { row: row1, col: col1, piece } = from;
  const row2 = to.row;
  const col2 = to.col;
  if (!piece || piece.s !== currentTurn) return null;
  return {
    fr: { row: row1, col: col1 },
    to: { row: row2, col: col2 },
    piece: { ...piece },
    not: notation(piece, row1, col1, row2, col2),
    uci: moveToUci({ fr: { row: row1, col: col1 }, to: { row: row2, col: col2 } }),
  };
}

function uciToMove(uci, currentBoard = board, currentTurn = turn) {
  const token = String(uci || '').trim().toLowerCase();
  if (!token) return null;
  const legalMoves = collectLegalMovesForTurn(currentBoard, currentTurn);
  for (const legal of legalMoves) {
    if (moveToUci(legal) !== token) continue;
    const piece = currentBoard[legal.fr.row]?.[legal.fr.col];
    if (!piece) continue;
    return {
      fr: { ...legal.fr },
      to: { ...legal.to },
      piece: { ...piece },
      not: notation(piece, legal.fr.row, legal.fr.col, legal.to.row, legal.to.col),
      uci: moveToUci(legal),
    };
  }
  for (const legal of legalMoves) {
    const variants = moveToLegacyUciVariants(legal);
    if (!variants.includes(token)) continue;
    const piece = currentBoard[legal.fr.row]?.[legal.fr.col];
    if (!piece) continue;
    return {
      fr: { ...legal.fr },
      to: { ...legal.to },
      piece: { ...piece },
      not: notation(piece, legal.fr.row, legal.fr.col, legal.to.row, legal.to.col),
      uci: moveToUci(legal),
    };
  }
  return null;
}

function applyMoveToBoard(srcBoard, srcTurn, move) {
  const nb = dc(srcBoard);
  nb[move.to.row][move.to.col] = nb[move.fr.row][move.fr.col];
  nb[move.fr.row][move.fr.col] = null;
  return { board: nb, turn: srcTurn === 'R' ? 'B' : 'R' };
}

function render() {
  const bEl = $('board');
  bEl.querySelectorAll('.pc,.dot,.ring,.hl,.chk,.qbadge').forEach(e => e.remove());
  clearArrow();

  if (hIdx >= 0 && hist[hIdx]) {
    const mv = hist[hIdx];
    [mv.fr, mv.to].forEach(pos => {
      const d = document.createElement('div');
      d.className = 'hl';
      const col = flipped ? 8 - pos.col : pos.col;
      const row = flipped ? 9 - pos.row : pos.row;
      d.style.cssText = `left:${cx(col)}px;top:${cy(row)}px;width:${CS}px;height:${CS}px`;
      bEl.appendChild(d);
    });
  }

  if (engineState.bestArrowMove && !$('stBestArrow').classList.contains('off')) {
    drawArrow(engineState.bestArrowMove.fr.row, engineState.bestArrowMove.fr.col, engineState.bestArrowMove.to.row, engineState.bestArrowMove.to.col);
  }

  const kg = findKing(board, turn);
  if (kg && inCheck(board, turn)) {
    const d = document.createElement('div');
    d.className = 'chk';
    const col = flipped ? 8 - kg.col : kg.col;
    const row = flipped ? 9 - kg.row : kg.row;
    d.style.cssText = `left:${cx(col)}px;top:${cy(row)}px;width:${CS}px;height:${CS}px`;
    bEl.appendChild(d);
  }

  if (hIdx >= 0 && hist[hIdx]?.quality) {
    const mv = hist[hIdx];
    const badge = document.createElement('div');
    badge.className = `qbadge ${mv.quality.key}`;
    badge.innerHTML = badgeIconMarkup(mv.quality.key);
    badge.title = formatQualityTitle(mv.quality);
    const col = flipped ? 8 - mv.to.col : mv.to.col;
    const row = flipped ? 9 - mv.to.row : mv.to.row;
    badge.style.left = `${cx(col) + CS * 0.18}px`;
    badge.style.top = `${cy(row) - CS * 0.28}px`;
    bEl.appendChild(badge);
  }

  const ps = Math.round(CS * 0.9);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p) continue;
      const d = document.createElement('div');
      d.className = 'pc' + (sel && sel.row === r && sel.col === c ? ' sel' : '');
      const drawCol = flipped ? 8 - c : c;
      const drawRow = flipped ? 9 - r : r;
      d.style.cssText = `left:${cx(drawCol)}px;top:${cy(drawRow)}px;width:${ps}px;height:${ps}px;background-image:url('${IMGS[p.t + p.s] || ''}')`;
      d.addEventListener('click', e => { e.stopPropagation(); clickPc(r, c); });
      bEl.appendChild(d);
    }
  }

  if (sel) {
    for (const mv of collectLegalMovesForTurn(board, turn).filter(m => m.fr.row === sel.row && m.fr.col === sel.col)) {
      const has = board[mv.to.row][mv.to.col];
      const d = document.createElement('div');
      const ds = has ? Math.round(CS * 0.88) : Math.round(CS * 0.3);
      d.className = has ? 'ring' : 'dot';
      const drawCol = flipped ? 8 - mv.to.col : mv.to.col;
      const drawRow = flipped ? 9 - mv.to.row : mv.to.row;
      d.style.cssText = `left:${cx(drawCol)}px;top:${cy(drawRow)}px;width:${ds}px;height:${ds}px`;
      d.addEventListener('click', e => { e.stopPropagation(); clickDest(mv.to.row, mv.to.col); });
      bEl.appendChild(d);
    }
  }
}

function setEval(redAdv) {
  engineState.lastEval = redAdv;
  if (!Number.isFinite(redAdv)) redAdv = 0;
  const sign = redAdv > 0 ? '+' : '';
  $('evalScore').textContent = Math.abs(redAdv) > 99 ? (sign + redAdv.toFixed(0)) : (sign + redAdv.toFixed(1));
  const pct = Math.max(2, Math.min(98, 50 - redAdv * 4.5));
  $('gBlack').style.height = `${pct}%`;
  $('gTick').style.top = '50%';
}

function setEvalFromEngine(redAdv, depth, force = false) {
  if (!Number.isFinite(redAdv)) return;
  const acceptedDepth = Number(depth) || 0;
  if (!force && acceptedDepth < MIN_EVAL_DEPTH) return;
  if (!force && acceptedDepth < engineState.evalDepth) return;
  engineState.evalDepth = acceptedDepth;
  setEval(redAdv);
}

function updateMoveList() {
  const ml = $('moveList');
  ml.innerHTML = '';
  for (let i = 0; i < hist.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'mv-row';
    const nm = document.createElement('span');
    nm.className = 'mv-num';
    nm.textContent = `${i / 2 + 1}.`;
    row.appendChild(nm);
    [0,1].forEach(off => {
      const td = document.createElement('span');
      td.className = 'mv-cell' + (hIdx === i + off ? ' cur' : '');
      const move = hist[i + off];
      const wrap = document.createElement('span');
      wrap.className = 'mv-cell-inner';
      const text = document.createElement('span');
      text.textContent = move?.not || '';
      wrap.appendChild(text);
      if (move?.quality) {
        const badge = document.createElement('span');
        badge.className = `mv-qbadge ${move.quality.key}`;
        badge.innerHTML = badgeIconMarkup(move.quality.key);
        badge.title = formatQualityTitle(move.quality);
        wrap.appendChild(badge);
      }
      td.appendChild(wrap);
      if (move) td.onclick = () => jumpTo(i + off);
      row.appendChild(td);
    });
    ml.appendChild(row);
  }
  ml.scrollTop = ml.scrollHeight;
}

function updatePGN() {
  const ms = hist.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + m.not).join(' ');
  const currentFen = toFEN(states[0] || board, 'R');
  $('pgnBox').textContent = `[Event "?"]\n[Site "chrome-extension://xiangqi-analysis"]\n[Date "${new Date().toISOString().slice(0,10).replace(/-/g,'.')}"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n[Variant "Xiangqi"]\n[SetUp "1"]\n[FEN "${currentFen}"]\n\n${ms || '*'}`;
}

function updatePvRows() {
  const rows = [...engineState.pvByLine.entries()].sort((a, b) => a[0] - b[0]);
  const pvRows = $('pvRows');
  pvRows.innerHTML = '';
  syncAuxPanels();
  if (!rows.length) {
    $('pvLine').textContent = '...';
    engineState.bestArrowMove = null;
    engineState.bestPvMoves = [];
    engineState.pvPreviewMoves = [];
    engineState.selectedLine = 1;
    render();
    return;
  }

  const [bestIdx, best] = rows[0];
  const selectedIdx = rows.some(([idx]) => idx === engineState.selectedLine) ? engineState.selectedLine : bestIdx;
  const selected = engineState.pvByLine.get(selectedIdx) || best;
  engineState.selectedLine = selectedIdx;
  engineState.bestArrowMove = selected.moves?.[0] || uciToCoords(selected.firstMoveUci || '', board, turn) || best.moves?.[0] || uciToCoords(best.firstMoveUci || '', board, turn) || null;
  engineState.bestPvMoves = selected.moves || [];
  engineState.pvPreviewMoves = selected.moves || [];
  $('pvLine').textContent = formatPreviewLine(selected.moves || [], turn, currentMoveNumber()) || selected.previewText || $('pvLine').textContent || '...';
  rows.forEach(([idx, info]) => {
    const row = document.createElement('div');
    row.className = 'pv-row' + (idx === selectedIdx ? ' active' : '');
    row.dataset.line = String(idx);
    const rank = document.createElement('div');
    rank.className = 'pv-rank';
    rank.textContent = idx;
    const m1 = document.createElement('div');
    m1.className = 'pv-m';
    m1.textContent = info.moves?.[0]?.not || uciToCoords(info.firstMoveUci || '', board, turn)?.not || info.scoreText || '';
    const m2 = document.createElement('div');
    m2.className = 'pv-m2';
    m2.textContent = info.moves?.[1]?.not || info.scoreText || '';
    row.append(rank, m1, m2);
    row.addEventListener('click', () => {
      engineState.selectedLine = idx;
      updatePvRows();
      debugLog('PV row selected', { rank: idx, first: m1.textContent, second: m2.textContent, arrow: !!engineState.bestArrowMove });
    });
    pvRows.appendChild(row);
  });
  render();
}

function updateUI() {
  $('fenVal').textContent = toFEN(board, turn);
  updateMoveList();
  updatePGN();
  render();
  requestEngineAnalysis();
}

function clickPc(row, col) {
  const p = board[row][col];
  if (sel) {
    const legal = collectLegalMovesForTurn(board, turn).some(m => m.fr.row === sel.row && m.fr.col === sel.col && m.to.row === row && m.to.col === col);
    if (legal) {
      if (applyMove(sel.row, sel.col, row, col)) { render(); updateUI(); return; }
    }
    if (p && p.s === turn) { sel = { row, col }; render(); return; }
    sel = null; render(); return;
  }
  if (p && p.s === turn) { sel = { row, col }; render(); }
}

function clickDest(row, col) {
  if (!sel) return;
  if (applyMove(sel.row, sel.col, row, col)) { render(); updateUI(); }
  else { sel = null; render(); }
}

function jumpTo(i) {
  if (i < 0 || i >= hist.length) return;
  engineState.pendingMoveReview = null;
  hIdx = i;
  board = dc(states[i + 1]);
  turn = i % 2 === 0 ? 'B' : 'R';
  sel = null;
  render();
  updateUI();
}
function navB() {
  if (hIdx < 0) return;
  engineState.pendingMoveReview = null;
  hIdx--;
  board = dc(states[hIdx + 1]);
  turn = hIdx < 0 ? 'R' : hIdx % 2 === 0 ? 'B' : 'R';
  sel = null;
  render();
  updateUI();
}
function navF() {
  if (hIdx >= hist.length - 1) return;
  engineState.pendingMoveReview = null;
  hIdx++;
  board = dc(states[hIdx + 1]);
  turn = hIdx % 2 === 0 ? 'B' : 'R';
  sel = null;
  render();
  updateUI();
}
function nav0() { engineState.pendingMoveReview = null; hIdx = -1; board = dc(states[0]); turn = 'R'; sel = null; render(); updateUI(); }
function navEnd() { if (hist.length) jumpTo(hist.length - 1); }
function flipBoard() { flipped = !flipped; buildCoords(); render(); }

function setToggleButton(btn, on) {
  if (!btn) return;
  btn.classList.toggle('off', !on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function closeSettings() {
  settingsOpen = false;
  $('settingsPanel').classList.remove('open');
  $('settingsPanel').setAttribute('aria-hidden', 'true');
  $('menuBtn').classList.remove('active');
  $('menuBtn').setAttribute('aria-expanded', 'false');
}
function openSettings() {
  settingsOpen = true;
  $('settingsPanel').classList.add('open');
  $('settingsPanel').setAttribute('aria-hidden', 'false');
  $('menuBtn').classList.add('active');
  $('menuBtn').setAttribute('aria-expanded', 'true');
}
function toggleSettings() { settingsOpen ? closeSettings() : openSettings(); }

function formatPreviewLine(moves, startTurn, startMoveNo) {
  if (!moves.length) return '...';
  const parts = [];
  let moveNo = startMoveNo;
  let side = startTurn;
  if (side === 'B') parts.push(`${moveNo}...`);
  moves.forEach(mv => {
    if (side === 'R') parts.push(`${moveNo}.`);
    parts.push(mv.not);
    if (side === 'B') moveNo++;
    side = side === 'R' ? 'B' : 'R';
  });
  return parts.join(' ') + ' ...';
}

function currentMoveNumber() {
  return Math.floor((hIdx + 1) / 2) + 1;
}

function debugLog(message, data, force = false) {
  if (!force && !engineState.debug) return;
  const logEl = $('debugLog');
  if (!logEl) return;
  engineState.debugSeq += 1;
  const line = `[${String(engineState.debugSeq).padStart(3, '0')}] ${message}${data === undefined ? '' : ' ' + (typeof data === 'string' ? data : JSON.stringify(data))}`;
  logEl.textContent = logEl.textContent ? `${logEl.textContent}\n${line}` : line;
  const lines = logEl.textContent.split('\n');
  if (lines.length > 120) logEl.textContent = lines.slice(-120).join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

function syncAuxPanels() {
  $('pvRows')?.classList.toggle('hidden', !engineState.showMultipleLines);
  $('debugPanel')?.classList.toggle('hidden', !engineState.debug);
}

function clearEngineOutput(message = '...') {
  engineState.bestArrowMove = null;
  engineState.bestPvMoves = [];
  engineState.pvPreviewMoves = [];
  engineState.evalDepth = 0;
  $('pvLine').textContent = message;
  $('pvRows').innerHTML = '';
  render();
}

function startPendingEngineAnalysis(trigger = 'update') {
  if (!engineState.worker || !engineState.pendingRequest) return;
  const pending = engineState.pendingRequest;
  engineState.pendingRequest = null;
  engineState.requestSeq = pending.seq;
  engineState.currentFen = pending.fen;
  engineState.pvByLine.clear();
  clearTimeout(engineState.timer);
  clearEngineOutput(pending.infinite ? 'Analyzing...' : 'Calculating...');
  debugLog('Starting engine analysis', { trigger, seq: pending.seq, fen: pending.fen, infinite: pending.infinite });
  sendEngine('stop');
  engineState.timer = setTimeout(() => {
    if (!engineState.worker) return;
    if (engineState.currentFen !== pending.fen) {
      debugLog('Skipping stale engine start', { pendingFen: pending.fen, currentFen: engineState.currentFen });
      return;
    }
    sendEngine(`position fen ${pending.fen}`);
    sendEngine(pending.infinite ? 'go infinite' : `go depth ${pending.depth}`);
    engineState.analysing = true;
  }, 60);
}

function formatPreviewFromUciTokens(tokens, currentBoard = board, currentTurn = turn, startMoveNo = currentMoveNumber()) {
  const parsed = [];
  let tempBoard = dc(currentBoard);
  let tempTurn = currentTurn;
  for (const token of tokens) {
    const mv = uciToMove(token, tempBoard, tempTurn) || uciToCoords(token, tempBoard, tempTurn);
    if (!mv) break;
    parsed.push(mv);
    const next = applyMoveToBoard(tempBoard, tempTurn, mv);
    tempBoard = next.board;
    tempTurn = next.turn;
  }
  if (parsed.length) return formatPreviewLine(parsed, currentTurn, startMoveNo);
  return tokens.length ? tokens.join(' ') : '...';
}

function copyText(text) {
  return navigator.clipboard?.writeText(text).catch(() => {});
}

function dlPGN() {
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent($('pgnBox').textContent);
  a.download = 'game.pgn';
  a.click();
}

function copyUCI() {
  const u = hist.map(m => m.uci).join(' ');
  copyText(u);
  alert('UCI: ' + (u || '(no moves)'));
}

function loadFenPrompt() {
  const input = prompt('Paste a Xiangqi FEN here:', $('fenVal').textContent);
  if (!input) return;
  try {
    const parsed = parseGameFEN(input);
    board = parsed.board;
    turn = parsed.turn;
    sel = null;
    hist = [];
    states = [dc(board)];
    hIdx = -1;
    engineState.pendingMoveReview = null;
    engineState.pvByLine.clear();
    updatePvRows();
    updateUI();
  } catch (err) {
    alert('Invalid FEN.');
  }
}

function bindSettingControls() {
  [['stBestArrow', true], ['stMultiLine', false], ['stInfinite', false], ['stDebug', false]].forEach(([id, on]) => {
    const el = $(id);
    setToggleButton(el, on);
    if (!el) return;
    el.addEventListener('click', () => {
      const nextOn = el.classList.contains('off');
      setToggleButton(el, nextOn);
      if (id === 'stBestArrow') render();
      if (id === 'stMultiLine') {
        engineState.showMultipleLines = nextOn;
        updatePvRows();
      }
      if (id === 'stDebug') {
        engineState.debug = nextOn;
        syncAuxPanels();
        debugLog('Debug log ' + (nextOn ? 'enabled' : 'disabled'), undefined, true);
      }
      if (id === 'stInfinite' && engineState.on) {
        engineState.optionsSent = false;
        requestEngineAnalysis('setting-toggle:' + id);
      }
    });
  });

  [['stLines','stLinesVal', v => `${v} / 5`]].forEach(([sliderId, valueId, fmt]) => {
    const slider = $(sliderId), value = $(valueId);
    const sync = () => {
      value.textContent = fmt(slider.value);
    };
    slider.addEventListener('input', sync);
    slider.addEventListener('change', () => {
      sync();
      syncAuxPanels();
      if (sliderId === 'stLines' && engineState.worker && engineState.on) {
        engineState.optionsSent = false;
        requestEngineAnalysis('setting-slider:' + sliderId);
      }
    });
    sync();
  });

  $('settingsPanel').addEventListener('click', e => e.stopPropagation());
  $('menuBtn').addEventListener('click', e => { e.stopPropagation(); toggleSettings(); });
  document.addEventListener('click', e => {
    if (!settingsOpen) return;
    if ($('settingsPanel').contains(e.target) || $('menuBtn').contains(e.target)) return;
    closeSettings();
  });
}

function bindControls() {
  $('togBtn').addEventListener('click', toggleEngine);
  $('btnFirst').addEventListener('click', nav0);
  $('btnBack').addEventListener('click', navB);
  $('btnFlip').addEventListener('click', flipBoard);
  $('btnForward').addEventListener('click', navF);
  $('btnEnd').addEventListener('click', navEnd);
  $('pvLine').addEventListener('click', () => playPvFirstMove(engineState.selectedLine || 1));
  $('fenVal').addEventListener('click', () => selAll($('fenVal')));
  $('downloadPgnLink').addEventListener('click', dlPGN);
  $('copyUciLink').addEventListener('click', copyUCI);
  $('copyFenLink').addEventListener('click', () => copyText($('fenVal').textContent));
  $('loadFenLink').addEventListener('click', loadFenPrompt);
  $('clearDebugBtn')?.addEventListener('click', () => {
    if ($('debugLog')) $('debugLog').textContent = '';
    engineState.debugSeq = 0;
    debugLog('Debug log cleared', undefined, true);
  });
  $('board').addEventListener('click', function(e) {
    const rect = this.getBoundingClientRect();
    const cell = pxToCell(e.clientX - rect.left, e.clientY - rect.top);
    if (!sel) return;
    if (!cell) { sel = null; render(); return; }
    clickDest(cell.row, cell.col);
  });

  const handle = $('board-resize');
  let dragging = false, startX = 0, startCS = CS;
  handle.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    dragging = true; startX = e.clientX; startCS = CS; manualBoardSize = true; document.body.classList.add('resizing');
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const newCS = Math.round(startCS + dx / (COLS - 1 + 0.92));
    CS = Math.max(CS_MIN, Math.min(CS_MAX, newCS));
    PX = Math.round(CS * 0.46); PY = PX;
    layout(); render();
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.classList.remove('resizing'); });

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); navB(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); navF(); }
    else if (e.key === 'Home') { e.preventDefault(); nav0(); }
    else if (e.key === 'End') { e.preventDefault(); navEnd(); }
    else if (e.key === 'f' || e.key === 'F') flipBoard();
    else if (e.key === 'Escape') { closeSettings(); sel = null; render(); }
  });

  window.addEventListener('resize', () => { layout(); syncAuxPanels(); render(); });
}

function selAll(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function engineMessage(line) {
  if (typeof line !== 'string') return;
  if (engineState.debug && !line.includes(' currmove ')) debugLog('Engine =>', line);
  if (engineState.debug) console.log('[engine]', line);
  if (line.includes('uciok')) {
    engineState.booted = true;
    engineState.uciReady = true;
    engineState.configuring = true;
    $('engDepth').textContent = 'Applying engine settings...';
    applyEngineOptions();
    return;
  }
  if (line.includes('readyok')) {
    engineState.configuring = false;
    engineState.ready = true;
    const readyReason = engineState.awaitingReadyReason;
    engineState.awaitingReadyReason = '';
    debugLog('Engine ready', { fen: engineState.lastFen || toFEN(board, turn), reason: readyReason });
    if (engineState.pendingRequest) startPendingEngineAnalysis(readyReason || 'readyok');
    return;
  }
  if (line.startsWith('bestmove')) {
    engineState.analysing = false;
    return;
  }
  if (!line.startsWith('info ')) return;
  if (engineState.pendingRequest) {
    debugLog('Ignoring info while newer request is pending', { pending: true, fen: engineState.pendingRequest.fen });
    return;
  }

  const depth = Number((line.match(/\bdepth\s+(\d+)/) || [])[1] || 0);
  const multipv = Number((line.match(/\bmultipv\s+(\d+)/) || [])[1] || 1);
  const nps = Number((line.match(/\bnps\s+(\d+)/) || [])[1] || 0);
  const scoreCp = (line.match(/\bscore\s+cp\s+(-?\d+)/) || [])[1];
  const scoreMate = (line.match(/\bscore\s+mate\s+(-?\d+)/) || [])[1];
  const pv = (line.match(/\bpv\s+(.+)$/) || [])[1];
  if (!pv) return;

  const tokens = String(pv).trim().split(/\s+/).filter(Boolean);
  const parsed = parsePvMoves(pv);
  if (!parsed.length) {
    debugLog('Ignoring stale PV update', { line: multipv, first: tokens[0] || null, requestedFen: engineState.lastFen, boardFen: toFEN(board, turn) });
    return;
  }
  let redAdv = engineState.lastEval;
  let scoreText = '';
  if (scoreMate != null) {
    const mate = Number(scoreMate);
    redAdv = (turn === 'R' ? 1 : -1) * (mate > 0 ? 99 : -99);
    scoreText = `#${mate}`;
  } else if (scoreCp != null) {
    const cp = Number(scoreCp);
    redAdv = (turn === 'R' ? cp : -cp) / 100;
    scoreText = `${redAdv >= 0 ? '+' : ''}${redAdv.toFixed(1)}`;
  }

  engineState.pvByLine.set(multipv, {
    depth,
    nps,
    fen: engineState.currentFen || engineState.lastFen,
    firstMoveUci: tokens[0] || '',
    moves: parsed,
    previewText: formatPreviewFromUciTokens(tokens),
    scoreText,
  });
  if (multipv === 1) {
    setEvalFromEngine(redAdv, depth);
    if (
      engineState.pendingMoveReview &&
      engineState.pendingMoveReview.fen === (engineState.currentFen || engineState.lastFen) &&
      depth >= MIN_REVIEW_DEPTH
    ) {
      applyMoveQuality(engineState.pendingMoveReview, redAdv);
      engineState.pendingMoveReview = null;
      updateMoveList();
      render();
    }
    $('engDepth').textContent = `Depth ${depth || 0}, ${Math.round(nps / 1000) || 0} knodes/s`;
  }
  debugLog('PV updated', { line: multipv, first: tokens[0] || null, parsed: parsed.length, text: formatPreviewLine(parsed, turn, currentMoveNumber()) || pv });
  updatePvRows();
}

function parsePvMoves(pvText) {
  const tokens = String(pvText).trim().split(/\s+/).filter(Boolean);
  let tempBoard = dc(board);
  let tempTurn = turn;
  const parsed = [];
  for (const token of tokens) {
    const mv = uciToMove(token, tempBoard, tempTurn);
    if (!mv) break;
    parsed.push(mv);
    const next = applyMoveToBoard(tempBoard, tempTurn, mv);
    tempBoard = next.board;
    tempTurn = next.turn;
  }
  return parsed;
}

function ensureEngine() {
  if (engineState.worker) return;
  engineState.worker = new Worker('lib/xiangqi_engine.js');
  engineState.worker.onmessage = e => engineMessage(e.data);
  engineState.worker.onerror = e => {
    console.error(e);
    $('engDepth').textContent = 'Engine failed to load';
  };
  debugLog('Engine worker created', undefined, true);
  sendEngine('uci');
}

function sendEngine(command) {
  ensureEngine();
  if (engineState.debug) debugLog('Engine <=', command);
  engineState.worker.postMessage(command);
}

function applyEngineOptions() {
  if (!engineState.worker || !engineState.uciReady) return;
  sendEngine('stop');
  engineState.analysing = false;
  sendEngine(`setoption name Threads value ${$('stCpus')?.value || 1}`);
  sendEngine(`setoption name Hash value ${$('stMemory')?.value || 64}`);
  sendEngine(`setoption name MultiPV value ${$('stLines').value}`);
  sendEngine('setoption name UCI_AnalyseMode value true');
  engineState.ready = false;
  engineState.optionsSent = true;
  engineState.awaitingReadyReason = 'options';
  sendEngine('isready');
  debugLog('Engine options applied', { multipv: Number($('stLines')?.value || 1) });
}

function requestEngineAnalysis(reason = 'update') {
  clearTimeout(engineState.timer);
  if (!engineState.on) return;
  ensureEngine();
  if (!engineState.worker) return;
  const fen = toFEN(board, turn);
  engineState.lastFen = fen;
  const infinite = !$('stInfinite').classList.contains('off');
  const depth = Math.max(12, 14 + hist.length);
  const seq = engineState.requestSeq + 1;
  engineState.pendingRequest = { seq, fen, infinite, depth, reason };
  engineState.selectedLine = 1;
  debugLog('Queued engine request', { seq, reason, fen, ready: engineState.ready, uci: engineState.uciReady });
  if (!engineState.uciReady) {
    $('engDepth').textContent = 'Waiting for engine handshake';
    clearEngineOutput('Waiting for engine handshake');
    return;
  }
  if (!engineState.optionsSent) {
    $('engDepth').textContent = 'Applying engine options';
    clearEngineOutput('Applying engine options');
    applyEngineOptions();
    return;
  }
  if (!engineState.ready || engineState.configuring) {
    $('engDepth').textContent = 'Waiting for engine ready';
    return;
  }
  startPendingEngineAnalysis(reason);
}

function toggleEngine() {
  engineState.on = !engineState.on;
  setToggleButton($('togBtn'), engineState.on);
  if (engineState.on) {
    $('engDepth').textContent = engineState.ready ? 'Analyzing...' : 'Starting engine...';
    requestEngineAnalysis();
  } else {
    if (engineState.worker) sendEngine('stop');
    $('engDepth').textContent = 'Engine is off';
    engineState.pvByLine.clear();
    engineState.bestArrowMove = null;
    engineState.bestPvMoves = [];
    updatePvRows();
    setEvalFromEngine(0, MIN_EVAL_DEPTH, true);
  }
}

function playPvFirstMove(line = 1) {
  const info = engineState.pvByLine.get(line) || engineState.pvByLine.get(1);
  const mv = engineState.pvPreviewMoves?.[0] || info?.moves?.[0] || uciToCoords(info?.firstMoveUci || '', board, turn);
  if (!mv) {
    debugLog('PV click ignored: no preview move available');
    return;
  }
  debugLog('Applying PV first move', { from: mv.fr, to: mv.to, uci: mv.uci || info?.firstMoveUci || null });
  if (applyMove(mv.fr.row, mv.fr.col, mv.to.row, mv.to.col)) {
    render();
    updateUI();
    debugLog('PV first move applied successfully');
    return;
  }
  const piece = board[mv.fr.row]?.[mv.fr.col];
  if (!piece || piece.s !== turn) return;
  board[mv.to.row][mv.to.col] = board[mv.fr.row][mv.fr.col];
  board[mv.fr.row][mv.fr.col] = null;
  hist.push({
    fr: { ...mv.fr },
    to: { ...mv.to },
    p: { ...piece },
    not: mv.not || notation(piece, mv.fr.row, mv.fr.col, mv.to.row, mv.to.col),
    uci: mv.uci || moveToUci(mv),
  });
  states.push(dc(board));
  hIdx = hist.length - 1;
  turn = turn === 'R' ? 'B' : 'R';
  sel = null;
  render();
  updateUI();
  debugLog('PV first move applied with fallback');
}

function init() {
  const parsed = parseGameFEN(START_FEN);
  board = parsed.board;
  turn = parsed.turn;
  sel = null;
  hist = [];
  states = [dc(board)];
  hIdx = -1;
  bindSettingControls();
  bindControls();
  setToggleButton($('togBtn'), true);
  layout();
  syncAuxPanels();
  render();
  setEvalFromEngine(0, MIN_EVAL_DEPTH, true);
  debugLog('Xiangqi Analysis initialized', { fen: toFEN(board, turn) }, true);
  updateUI();
  ensureEngine();
}

init();




