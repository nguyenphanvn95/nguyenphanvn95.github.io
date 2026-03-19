
// [USERSCRIPT PATCH] Resolve asset URLs from GitHub Pages
(function(){
  const _BASE = (typeof window !== 'undefined' && window.__CK_BASE_URL__) || 'https://nguyenphanvn95.github.io/chesskiller';
  window._ckAssetUrl = function(path) {
    path = String(path || '');
    // Convert chrome extension paths to GitHub Pages paths
    path = path.replace(/^(?:modules\/lib\/)/, 'lib/');
    path = path.replace(/^(?:modules\/)?/, '');
    path = path.replace(/^photo\//, 'media/photo/');
    path = path.replace(/^audio\//, 'media/audio/');
    return _BASE + '/' + path;
  };
})();
'use strict';

const REVIEW_CATEGORY_ORDER = ['brilliant', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
const REVIEW_CP_CAP = 1500;
const MOVE_QUALITY = {
  brilliant: { key: 'brilliant', label: 'Brilliant' },
  best: { key: 'best', label: 'Best' },
  excellent: { key: 'excellent', label: 'Excellent' },
  good: { key: 'good', label: 'Good' },
  inaccuracy: { key: 'inaccuracy', label: 'Inaccuracy' },
  mistake: { key: 'mistake', label: 'Mistake' },
  blunder: { key: 'blunder', label: 'Blunder' },
};
const QUALITY_ICON_SVG = {
  brilliant: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.3L18 9.1l-4.2 1.7L12 15l-1.8-4.2L6 9.1l4.2-1.8L12 3z"></path><path d="M5 5l1.2 1.2M19 5l-1.2 1.2M5 19l1.2-1.2M19 19l-1.2-1.2M12 1.8v2.1M12 20.1v2.1M1.8 12h2.1M20.1 12h2.1"></path></svg>',
  best: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.2 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.2z"></path></svg>',
  excellent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 20H6.3c-.8 0-1.3-.6-1.3-1.3v-7.1c0-.8.5-1.3 1.3-1.3h2.9V20z"></path><path d="M11 20h5.1c1.2 0 2.2-.8 2.5-2l1-4.7c.3-1.3-.7-2.5-2-2.5h-3.8l.5-3.1V6.8c0-1-.8-1.8-1.8-1.8h-.4L9.8 10v10H11z"></path></svg>',
  good: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.7 16.8L5.9 13l1.7-1.7 2.1 2.1 6.7-6.7 1.7 1.7-8.4 8.4z"></path></svg>',
  inaccuracy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 9.1a2.7 2.7 0 1 1 5.4 0c0 1.6-1.3 2.3-2.1 2.9-.7.5-1 .8-1 1.7v.7"></path><circle cx="12" cy="17.6" r="1.2"></circle><path d="M18.4 7.7l2.2 2.2M19.5 7.7l1.1 1.1"></path></svg>',
  mistake: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 9.1a2.7 2.7 0 1 1 5.4 0c0 1.6-1.3 2.3-2.1 2.9-.7.5-1 .8-1 1.7v.7"></path><circle cx="12" cy="17.6" r="1.2"></circle></svg>',
  blunder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.8 9.1a2.6 2.6 0 1 1 5.2 0c0 1.4-1.1 2.1-1.8 2.6-.6.5-.9.8-.9 1.6v.7"></path><circle cx="10.4" cy="17.6" r="1.1"></circle><path d="M13.5 9.1a2.6 2.6 0 1 1 5.2 0c0 1.4-1.1 2.1-1.8 2.6-.6.5-.9.8-.9 1.6v.7"></path><circle cx="16.1" cy="17.6" r="1.1"></circle></svg>',
};

const reviewState = {
  overlayVisible: true,
  running: false,
  loaded: false,
  status: 'Load a PGN to start review.',
  summary: null,
  positionReviews: [],
  tags: {},
  cacheKey: '',
  showBadges: true,
  worker: null,
  uciReady: false,
  ready: false,
  pendingResolve: null,
  pendingReject: null,
  pendingInfo: null,
  startedWithPgn: false,
  importOverlayVisible: false,
  importTab: 'paste',
  importBusy: false,
  importStatus: '',
  importStatusKind: '',
  chessComUsername: '',
  chessComResultsVisible: false,
  chessComArchives: [],
  chessComArchiveIndex: -1,
  chessComGames: [],
  lichessUsername: '',
  lichessResultsVisible: false,
  lichessGames: [],
  engineScriptIndex: 0,
  engineScript: '',
  engineBootTimer: null,
};

function getReviewDepth(){
  return Math.max(5, Math.min(25, Number(getSharedSettings?.().analysisDepth || 20)));
}

function delay(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(value){
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const baseLayout = layout;
layout = function reviewAwareLayout(){
  baseLayout();
  syncReviewScale();
  renderReviewOverlay();
};

function badgeIconMarkup(key){ return QUALITY_ICON_SVG[key] || ''; }

function reviewCacheKey(pgnText){
  let hash = 0;
  const text = String(pgnText || '');
  for(let i=0;i<text.length;i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return 'chess-review:v2:' + Math.abs(hash) + ':d' + getReviewDepth();
}

function loadReviewCache(key){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }catch(err){ return null; }
}

function saveReviewCache(key,payload){
  try{ localStorage.setItem(key, JSON.stringify(payload)); }catch(err){}
}

function clearReviewCache(key){
  try{ localStorage.removeItem(key); }catch(err){}
}

function storageLocalGet(key){
  return new Promise((resolve, reject) => {
    if(!chrome?.storage?.local){
      resolve({});
      return;
    }
    chrome.storage.local.get(key, items => {
      if(chrome.runtime?.lastError){
        reject(new Error(chrome.runtime.lastError.message || 'chrome.storage.local.get failed'));
        return;
      }
      resolve(items || {});
    });
  });
}

function storageLocalRemove(key){
  return new Promise((resolve, reject) => {
    if(!chrome?.storage?.local){
      resolve();
      return;
    }
    chrome.storage.local.remove(key, () => {
      if(chrome.runtime?.lastError){
        reject(new Error(chrome.runtime.lastError.message || 'chrome.storage.local.remove failed'));
        return;
      }
      resolve();
    });
  });
}

function runtimeSendMessage(message){
  return new Promise((resolve, reject) => {
    if(!chrome?.runtime?.sendMessage){
      reject(new Error('chrome.runtime.sendMessage unavailable'));
      return;
    }
    chrome.runtime.sendMessage(message, response => {
      if(chrome.runtime?.lastError){
        reject(new Error(chrome.runtime.lastError.message || 'chrome.runtime.sendMessage failed'));
        return;
      }
      resolve(response);
    });
  });
}

function cleanupExpiredReviewPgnHandoffs(maxAgeMs = 6 * 60 * 60 * 1000){
  if(!chrome?.storage?.local) return;
  chrome.storage.local.get(null, items => {
    if(chrome.runtime?.lastError || !items) return;
    const now = Date.now();
    const expiredKeys = Object.entries(items)
      .filter(([key, value]) => key.startsWith('review-pgn:') && (now - Number(value?.createdAt || 0)) > maxAgeMs)
      .map(([key]) => key);
    if(expiredKeys.length){
      chrome.storage.local.remove(expiredKeys, () => {});
    }
  });
}

function readUsernameHintsFromParams(params){
  return String(params?.get('usernames') || '')
    .split(',')
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function decodePgnFromUrl(value){
  try{
    return decodeURIComponent(escape(atob(String(value || ''))));
  }catch(err){
    try{
      return atob(String(value || ''));
    }catch(_){
      return '';
    }
  }
}

function readRawQueryParam(name){
  const match = String(window.location.href || '').match(new RegExp(`[?&]${name}=([^&#]+)`));
  return match ? String(match[1] || '') : '';
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

function getVisibleResultsSource(){
  if(reviewState.chessComResultsVisible) return 'chesscom';
  if(reviewState.lichessResultsVisible) return 'lichess';
  return '';
}

function setResultsOverlayMessage(source, message){
  const metaId = source === 'chesscom' ? 'chessComMeta' : source === 'lichess' ? 'lichessMeta' : '';
  const root = metaId ? document.getElementById(metaId) : null;
  if(!root) return;
  const sub = root.querySelector('.import-results-sub');
  if(sub) sub.innerHTML = message;
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

function formatDateTime(value){
  if(!value) return '-';
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatArchiveLabel(url){
  const match = String(url || '').match(/\/(\d{4})\/(\d{2})$/);
  if(!match) return 'Archive';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function chessComGameResult(game){
  const whiteResult = game?.white?.result || '';
  const blackResult = game?.black?.result || '';
  if(game?.white?.result === 'win') return { label: 'White wins', tone: 'win' };
  if(game?.black?.result === 'win') return { label: 'Black wins', tone: 'win' };
  if(whiteResult === 'agreed' || blackResult === 'agreed') return { label: 'Draw agreed', tone: 'draw' };
  if(whiteResult === 'repetition' || blackResult === 'repetition') return { label: 'Draw by repetition', tone: 'draw' };
  if(whiteResult === 'stalemate' || blackResult === 'stalemate') return { label: 'Draw by stalemate', tone: 'draw' };
  if(whiteResult === 'timevsinsufficientmaterial' || blackResult === 'timevsinsufficientmaterial') return { label: 'Draw on time', tone: 'draw' };
  return { label: 'Game complete', tone: 'neutral' };
}

function lichessGameResult(game){
  if(game?.winner === 'white') return { label: 'White wins', tone: 'win' };
  if(game?.winner === 'black') return { label: 'Black wins', tone: 'win' };
  return { label: 'Draw', tone: 'draw' };
}

function resultToneClass(result){
  if(result?.tone === 'draw') return ' draw';
  if(result?.tone === 'loss') return ' loss';
  return '';
}

function clockIconSvg(){
  return '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
}

function setImportStatus(message, kind=''){
  reviewState.importStatus = message;
  reviewState.importStatusKind = kind;
  const el = document.getElementById('importStatus');
  if(!el) return;
  el.textContent = message || '';
  el.className = `import-status${kind ? ` ${kind}` : ''}`;
}

function setImportBusy(isBusy){
  reviewState.importBusy = isBusy;
  ['importPgnBtn','searchChessComBtn','searchLichessBtn','chessComPrevMonthBtn','chessComNextMonthBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.disabled = isBusy;
  });
}

function setImportOverlayVisible(visible){
  if(!visible && !reviewState.loaded){
    visible = true;
  }
  reviewState.importOverlayVisible = visible;
  document.getElementById('importOverlay')?.classList.toggle('visible', visible);
  document.getElementById('importCloseBtn')?.toggleAttribute('hidden', !reviewState.loaded);
  document.getElementById('continueWithoutGameBtn')?.toggleAttribute('hidden', !reviewState.loaded);
  if(!visible){
    setChessComResultsVisible(false);
    setLichessResultsVisible(false);
  }else if(!reviewState.chessComResultsVisible && !reviewState.lichessResultsVisible){
    const panel = document.getElementById('importPanel');
    if(panel){
      panel.hidden = false;
      panel.style.display = 'flex';
    }
  }
}

function setChessComResultsVisible(visible){
  reviewState.chessComResultsVisible = visible;
  if(visible) reviewState.lichessResultsVisible = false;
  document.getElementById('chessComResultsOverlay')?.classList.toggle('visible', visible);
  document.getElementById('lichessResultsOverlay')?.classList.remove('visible');
  const panel = document.getElementById('importPanel');
  if(panel){
    panel.hidden = visible;
    panel.style.display = visible ? 'none' : 'flex';
  }
}

function setLichessResultsVisible(visible){
  reviewState.lichessResultsVisible = visible;
  if(visible) reviewState.chessComResultsVisible = false;
  document.getElementById('lichessResultsOverlay')?.classList.toggle('visible', visible);
  document.getElementById('chessComResultsOverlay')?.classList.remove('visible');
  const panel = document.getElementById('importPanel');
  if(panel){
    panel.hidden = visible;
    panel.style.display = visible ? 'none' : 'flex';
  }
}

function setImportTab(tab){
  reviewState.importTab = tab;
  const order = ['paste','chesscom','lichess'];
  const index = Math.max(0, order.indexOf(tab));
  document.querySelectorAll('[data-import-tab]').forEach(btn=>{
    btn.classList.toggle('active', btn.getAttribute('data-import-tab') === tab);
  });
  const indicator = document.getElementById('importTabIndicator');
  if(indicator) indicator.style.transform = `translateX(${index * 100}%)`;
  document.querySelectorAll('[data-import-section]').forEach(section=>{
    section.classList.toggle('active', section.getAttribute('data-import-section') === tab);
  });
  if(tab !== 'chesscom') setChessComResultsVisible(false);
  if(tab !== 'lichess') setLichessResultsVisible(false);
}

function renderGameCards(targetId, games, mapper){
  const root = document.getElementById(targetId);
  if(!root) return;
  if(!games.length){
    root.innerHTML = '<div class="import-empty">No games found.</div>';
    return;
  }
  root.innerHTML = games.map((game, index) => mapper(game, index)).join('');
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
    const isCapture = Boolean(state.b[targetRow]?.[targetCol]) || Boolean(move.meta?.ep);
    if(capture !== isCapture) return false;
    if(fromFile && move.fr.col !== 'abcdefgh'.indexOf(fromFile)) return false;
    if(fromRank && move.fr.row !== 8 - Number(fromRank)) return false;
    if(promotion && !(piece.t === 'p' && (move.to.row === 0 || move.to.row === 7))) return false;
    return true;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

async function fetchChessComGamePgn(game){
  if(game?.pgn) return game.pgn;
  const gameUrl = String(game?.url || '');
  const match = gameUrl.match(/\/game\/(?:(live|daily)\/)?(\d+)/);
  if(!match) throw new Error('Could not identify this Chess.com game.');
  const gameType = match[1] || 'live';
  const gameId = match[2];
  const callbackRes = await fetch(`https://www.chess.com/callback/${gameType}/game/${gameId}`);
  if(!callbackRes.ok) throw new Error('Could not fetch Chess.com game callback.');
  const callbackData = await callbackRes.json();
  const directPgn = extractDirectPgnFromCallback(callbackData);
  if(directPgn) return directPgn;
  const headers = callbackData.game?.pgnHeaders;
  if(!headers?.Date) throw new Error('Chess.com game archive is not ready.');
  const [year, month] = String(headers.Date).split('.');
  const usernames = [
    String(headers.White || '').trim().toLowerCase(),
    String(headers.Black || '').trim().toLowerCase(),
  ].filter(Boolean);
  let archiveGame = null;
  for(const username of usernames){
    const archiveRes = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${year}/${month}`);
    if(!archiveRes.ok) continue;
    const archiveData = await archiveRes.json();
    archiveGame = archiveData.games?.find(entry => String(entry?.url || '').includes(`/${gameType}/${gameId}`));
    if(archiveGame?.pgn) break;
  }
  if(!archiveGame?.pgn) throw new Error('PGN not found in Chess.com archive.');
  return archiveGame.pgn;
}

function extractDirectPgnFromCallback(callbackData){
  const game = callbackData?.game || {};
  const candidates = [
    game.pgn,
    game.game?.pgn,
    game.moveList?.pgn,
    callbackData?.pgn,
  ];
  const found = candidates.find(value => typeof value === 'string' && value.trim());
  return found ? String(found).trim() : '';
}

async function fetchLichessGamePgn(game){
  if(game?.pgn) return game.pgn;
  const gameId = String(game?.id || game?.gameId || '').trim();
  if(!gameId) throw new Error('Could not identify this Lichess game.');
  const response = await fetch(`https://lichess.org/game/export/${encodeURIComponent(gameId)}?clocks=false&evals=false&opening=true`);
  if(!response.ok) throw new Error('Could not fetch Lichess PGN.');
  const pgn = await response.text();
  if(!String(pgn || '').trim()) throw new Error('Empty PGN returned from Lichess.');
  return pgn;
}

async function handleImportedGameClick(source, index){
  const list = source === 'chesscom' ? reviewState.chessComGames : reviewState.lichessGames;
  const game = list?.[index];
  if(!game) return;
  setImportStatus('Fetching PGN for selected game...', 'success');
  setResultsOverlayMessage(source, 'Fetching PGN for selected game...');
  try{
    const pgn = source === 'chesscom'
      ? await fetchChessComGamePgn(game)
      : await fetchLichessGamePgn(game);
    setImportStatus('Loading game into review...', 'success');
    setResultsOverlayMessage(source, 'Loading game into review...');
    await loadReviewGameFromPgn(pgn);
  }catch(err){
    renderChessComGames();
    renderLichessGames();
    setImportStatus(err?.message || 'Could not load the selected game.', 'error');
    setResultsOverlayMessage(source, escapeHtml(err?.message || 'Could not load the selected game.'));
  }
}

function renderChessComGames(){
  const nav = document.getElementById('chessComMonthNav');
  const label = document.getElementById('chessComMonthLabel');
  const meta = document.getElementById('chessComMeta');
  const prev = document.getElementById('chessComPrevMonthBtn');
  const next = document.getElementById('chessComNextMonthBtn');
  const archiveUrl = reviewState.chessComArchives[reviewState.chessComArchiveIndex] || '';
  if(label) label.textContent = archiveUrl ? formatArchiveLabel(archiveUrl) : '';
  if(meta){
    const count = reviewState.chessComGames.length;
    meta.innerHTML = `<div class="import-results-head"><div class="import-results-title">Recent Games</div><div class="import-results-sub"><span class="accent">${escapeHtml(reviewState.chessComUsername)}</span> &bull; ${escapeHtml(String(count))} games this month</div></div>`;
  }
  if(nav) nav.hidden = !archiveUrl;
  if(prev) prev.disabled = reviewState.importBusy || reviewState.chessComArchiveIndex <= 0;
  if(next) next.disabled = reviewState.importBusy || reviewState.chessComArchiveIndex >= reviewState.chessComArchives.length - 1;
  renderGameCards('chessComResults', reviewState.chessComGames, (game, index) => {
    const result = chessComGameResult(game);
    const searched = reviewState.chessComUsername.toLowerCase();
    const whiteName = String(game?.white?.username || 'White');
    const blackName = String(game?.black?.username || 'Black');
    const whiteAccent = whiteName.toLowerCase() === searched ? ' accent' : '';
    const blackAccent = blackName.toLowerCase() === searched ? ' accent' : '';
    return `
      <article class="import-game-card" data-import-source="chesscom" data-import-index="${index}">
        <div class="import-game-main">
          <div class="import-game-title">
            <span class="import-game-player${whiteAccent}">${escapeHtml(whiteName)}</span>
            <span class="import-game-vs">vs</span>
            <span class="import-game-player${blackAccent}">${escapeHtml(blackName)}</span>
          </div>
          <div class="import-game-info">
            <div class="import-game-meta-left">
              <span class="import-time">${clockIconSvg()}${escapeHtml(formatDateTime(game?.end_time ? game.end_time * 1000 : game?.start_time ? game.start_time * 1000 : null))}</span>
              <span class="import-chip">${escapeHtml(String(game?.time_class || 'game'))}</span>
            </div>
          </div>
        </div>
        <div class="import-result${resultToneClass(result)}">${escapeHtml(result.label)}</div>
      </article>
    `;
  });
}

function renderLichessGames(){
  const meta = document.getElementById('lichessMeta');
  if(meta){
    const count = reviewState.lichessGames.length;
    meta.innerHTML = `<div class="import-results-head"><div class="import-results-title">Recent Games</div><div class="import-results-sub"><span class="accent">${escapeHtml(reviewState.lichessUsername)}</span> &bull; ${escapeHtml(String(count))} recent public games</div></div>`;
  }
  renderGameCards('lichessResults', reviewState.lichessGames, (game, index) => {
    const result = lichessGameResult(game);
    const searched = reviewState.lichessUsername.toLowerCase();
    const whiteName = String(game?.players?.white?.user?.name || game?.players?.white?.name || 'White');
    const blackName = String(game?.players?.black?.user?.name || game?.players?.black?.name || 'Black');
    const whiteAccent = whiteName.toLowerCase() === searched ? ' accent' : '';
    const blackAccent = blackName.toLowerCase() === searched ? ' accent' : '';
    return `
      <article class="import-game-card" data-import-source="lichess" data-import-index="${index}">
        <div class="import-game-main">
          <div class="import-game-title">
            <span class="import-game-player${whiteAccent}">${escapeHtml(whiteName)}</span>
            <span class="import-game-vs">vs</span>
            <span class="import-game-player${blackAccent}">${escapeHtml(blackName)}</span>
          </div>
          <div class="import-game-info">
            <div class="import-game-meta-left">
              <span class="import-time">${clockIconSvg()}${escapeHtml(formatDateTime(game?.createdAt || game?.lastMoveAt))}</span>
              <span class="import-chip">${escapeHtml(String(game?.speed || game?.perf || 'game'))}</span>
            </div>
          </div>
        </div>
        <div class="import-result${resultToneClass(result)}">${escapeHtml(result.label)}</div>
      </article>
    `;
  });
}

async function loadReviewGameFromPgn(pgnText){
  const text = String(pgnText || '').trim();
  if(!text){
    setImportStatus('Please provide a PGN first.', 'error');
    return;
  }
  document.getElementById('pgnBox').textContent = text;
  setImportStatus('Loading game...', 'success');
  const loaded = await loadReviewPgnText(text);
  if(loaded){
    setImportOverlayVisible(false);
    setImportStatus('');
  }
}

async function fetchChessComArchives(username){
  const normalized = String(username || '').trim().toLowerCase();
  const response = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(normalized)}/games/archives`);
  if(!response.ok) throw new Error('Could not fetch Chess.com archives.');
  const data = await response.json();
  return Array.isArray(data.archives) ? data.archives : [];
}

async function fetchChessComArchiveGames(url){
  const response = await fetch(String(url || '').trim());
  if(!response.ok) throw new Error('Could not fetch Chess.com games for this month.');
  const data = await response.json();
  return Array.isArray(data.games) ? data.games.filter(game => game?.url) : [];
}

async function fetchLichessGames(username){
  const response = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=100&pgnInJson=true&clocks=false&evals=false&opening=true`, {
    headers: { Accept: 'application/x-ndjson' }
  });
  if(!response.ok) throw new Error('Could not fetch Lichess games.');
  const text = await response.text();
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(game => game?.pgn);
}

async function loadChessComArchiveByIndex(index){
  if(index < 0 || index >= reviewState.chessComArchives.length) return;
  setImportBusy(true);
  setImportStatus('Loading Chess.com games...', 'success');
  try{
    reviewState.chessComArchiveIndex = index;
    const root = document.getElementById('chessComResults');
    const meta = document.getElementById('chessComMeta');
    if(meta){
      meta.innerHTML = `<div class="import-results-head"><div class="import-results-title">Recent Games</div><div class="import-results-sub"><span class="accent">${escapeHtml(reviewState.chessComUsername)}</span> &bull; Loading games...</div></div>`;
    }
    if(root){
      root.innerHTML = '<div class="import-empty">Loading games...</div>';
    }
    setChessComResultsVisible(true);
    reviewState.chessComGames = await fetchChessComArchiveGames(reviewState.chessComArchives[index]);
    renderChessComGames();
    setImportStatus(reviewState.chessComGames.length ? 'Select a game to load it into review.' : 'No games found in this archive.', reviewState.chessComGames.length ? 'success' : '');
  }catch(err){
    reviewState.chessComGames = [];
    renderChessComGames();
    setChessComResultsVisible(true);
    setImportStatus(err?.message || 'Could not load Chess.com games for this month.', 'error');
  }finally{
    setImportBusy(false);
  }
}

async function handleChessComSearch(){
  const username = document.getElementById('chessComUsername')?.value.trim();
  if(!username){
    setImportStatus('Enter a Chess.com username.', 'error');
    return;
  }
  setImportBusy(true);
  setImportStatus('Fetching Chess.com archives...', 'success');
  try{
    reviewState.chessComUsername = String(username || '').trim().toLowerCase();
    reviewState.chessComGames = [];
    renderChessComGames();
    reviewState.chessComArchives = await fetchChessComArchives(username);
    if(!reviewState.chessComArchives.length) throw new Error('No public game archives found for this Chess.com user.');
    await loadChessComArchiveByIndex(reviewState.chessComArchives.length - 1);
  }catch(err){
    reviewState.chessComGames = [];
    renderChessComGames();
    const root = document.getElementById('chessComResults');
    if(root) root.innerHTML = `<div class="import-empty">${escapeHtml(err?.message || 'Chess.com search failed.')}</div>`;
    setChessComResultsVisible(true);
    setImportStatus(err?.message || 'Chess.com search failed.', 'error');
  }finally{
    setImportBusy(false);
  }
}

async function handleLichessSearch(){
  const username = document.getElementById('lichessUsername')?.value.trim();
  if(!username){
    setImportStatus('Enter a Lichess username.', 'error');
    return;
  }
  setImportBusy(true);
  setImportStatus('Fetching Lichess games...', 'success');
  try{
    reviewState.lichessUsername = username;
    const root = document.getElementById('lichessResults');
    const meta = document.getElementById('lichessMeta');
    if(meta){
      meta.innerHTML = `<div class="import-results-head"><div class="import-results-title">Recent Games</div><div class="import-results-sub"><span class="accent">${escapeHtml(reviewState.lichessUsername)}</span> &bull; Loading games...</div></div>`;
    }
    if(root){
      root.innerHTML = '<div class="import-empty">Loading games...</div>';
    }
    setLichessResultsVisible(true);
    reviewState.lichessGames = await fetchLichessGames(username);
    renderLichessGames();
    setLichessResultsVisible(true);
    setImportStatus(reviewState.lichessGames.length ? 'Select a game to load it into review.' : 'No recent public Lichess games were found.', reviewState.lichessGames.length ? 'success' : '');
  }catch(err){
    reviewState.lichessGames = [];
    renderLichessGames();
    const root = document.getElementById('lichessResults');
    if(root) root.innerHTML = `<div class="import-empty">${escapeHtml(err?.message || 'Lichess search failed.')}</div>`;
    setLichessResultsVisible(true);
    setImportStatus(err?.message || 'Lichess search failed.', 'error');
  }finally{
    setImportBusy(false);
  }
}

function stateToFen(state, plyIndex){
  const rows = state.b.map(row=>{
    let s='',e=0;
    for(const p of row){
      if(!p){ e++; continue; }
      if(e){ s += e; e = 0; }
      s += p.s==='w' ? p.t.toUpperCase() : p.t;
    }
    if(e) s += e;
    return s;
  }).join('/');
  const cas = [state.cas.wK?'K':'',state.cas.wQ?'Q':'',state.cas.bK?'k':'',state.cas.bQ?'q':''].join('') || '-';
  const ep = state.ep ? ('abcdefgh'[state.ep.col] + (8-state.ep.row)) : '-';
  return `${rows} ${state.t} ${cas} ${ep} 0 ${Math.floor(plyIndex/2)+1}`;
}

function coordsToUci(fr,fc,tr,tc,promo){
  const files='abcdefgh';
  return `${files[fc]}${8-fr}${files[tc]}${8-tr}${promo||''}`;
}

function scoreToWhiteCpLocal(entry){
  if(!entry) return 0;
  if(entry.mate !== null && entry.mate !== undefined) return Number(entry.mate) > 0 ? REVIEW_CP_CAP : -REVIEW_CP_CAP;
  const cp = Number(entry.cp || 0);
  if(!Number.isFinite(cp)) return 0;
  return Math.max(-REVIEW_CP_CAP, Math.min(REVIEW_CP_CAP, cp));
}

function computeReviewAccuracy(avgLoss){
  if(!Number.isFinite(avgLoss) || avgLoss <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - avgLoss * 12)));
}

function classifyMoveQuality(delta){
  if(!Number.isFinite(delta)) return null;
  if(delta >= 3.0) return MOVE_QUALITY.brilliant;
  if(delta >= 1.1) return MOVE_QUALITY.excellent;
  if(delta >= 0.2) return MOVE_QUALITY.good;
  if(delta <= -3.0) return MOVE_QUALITY.blunder;
  if(delta <= -1.2) return MOVE_QUALITY.mistake;
  if(delta <= -0.35) return MOVE_QUALITY.inaccuracy;
  return MOVE_QUALITY.good;
}

function applyMoveQualityReview(review, entry){
  if(!review || !entry) return;
  const move = hist[review.moveIndex];
  if(!move) return;
  if(review.bestMoveUci && move.uci === review.bestMoveUci){
    move.quality = { ...MOVE_QUALITY.best, delta: 0 };
    return;
  }
  const beforeWhite = Number(review.beforeCp || 0);
  const afterWhite = scoreToWhiteCpLocal(entry);
  const beforeMover = review.mover === 'w' ? beforeWhite : -beforeWhite;
  const afterMover = review.mover === 'w' ? afterWhite : -afterWhite;
  const delta = (afterMover - beforeMover) / 100;
  const quality = classifyMoveQuality(delta);
  move.quality = quality ? { ...quality, delta: Number(delta.toFixed(2)) } : null;
}

function buildReviewSanForMove(state, move, legalMoves=null){
  const piece = move.piece || move.p;
  const files = 'abcdefgh';
  if(!piece) return '';
  if(move.meta?.castle === 'wK' || move.meta?.castle === 'bK') return 'O-O';
  if(move.meta?.castle === 'wQ' || move.meta?.castle === 'bQ') return 'O-O-O';
  const targetSquare = `${files[move.to.col]}${8 - move.to.row}`;
  const capture = Boolean(state.b[move.to.row]?.[move.to.col]) || Boolean(move.meta?.ep);
  let san = '';
  if(piece.t === 'p'){
    if(capture) san += `${files[move.fr.col]}x`;
  }else{
    const symbols = { k:'K', q:'Q', r:'R', b:'B', n:'N' };
    san += symbols[piece.t] || '';
    const peers = (legalMoves || collectLegalMovesForState(state.b,state.t,state.cas,state.ep)).filter(other => {
      if(other === move) return false;
      const otherPiece = other.piece || other.p;
      return otherPiece?.t === piece.t && other.to.row === move.to.row && other.to.col === move.to.col;
    });
    if(peers.length){
      const sameFile = peers.some(other => other.fr.col === move.fr.col);
      const sameRank = peers.some(other => other.fr.row === move.fr.row);
      if(sameFile && sameRank) san += `${files[move.fr.col]}${8 - move.fr.row}`;
      else if(sameFile) san += `${8 - move.fr.row}`;
      else san += files[move.fr.col];
    }
    if(capture) san += 'x';
  }
  san += targetSquare;
  if(piece.t === 'p' && (move.to.row === 0 || move.to.row === 7)) san += '=Q';
  const applied = applyPreviewMove({ board:dc(state.b), turn:state.t, cas:{...state.cas}, ep:state.ep?{...state.ep}:null }, move);
  const enemy = applied.turn;
  const king = findKing(applied.board, enemy);
  let suffix = '';
  if(king && isAttacked(applied.board, king.row, king.col, enemy)){
    const legal = collectLegalMovesForState(applied.board, enemy, applied.cas, applied.ep);
    suffix = legal.length ? '+' : '#';
  }
  return san + suffix;
}

function squareToCoords(square){
  const files = 'abcdefgh';
  return {
    row: 8 - Number(String(square || '').slice(1)),
    col: files.indexOf(String(square || '').charAt(0)),
  };
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
  const startBoard = parseFEN(startFen);
  let state = { b:dc(startBoard), t:turn, cas:{...castling}, ep:epSquare?{...epSquare}:null };
  for(const raw of rawTokens){
    const token = normalizeSanToken(raw);
    if(!token || /^\d+\.$/.test(raw) || /^\.\.\.$/.test(raw) || /^(1-0|0-1|1\/2-1\/2|\*)$/i.test(token)) continue;
    const legal = collectLegalMovesForState(state.b,state.t,state.cas,state.ep);
    const found = legal.map(legalMove => {
      const san = buildReviewSanForMove(state, legalMove, legal);
      const simple = simplifyChessSan(san);
      const target = simplifyChessSan(token);
      if(simple !== target) return null;
      const promo = legalMove.piece.t==='p' && (legalMove.to.row===0||legalMove.to.row===7) ? 'q' : undefined;
      return {
        fr:{...legalMove.fr},
        to:{...legalMove.to},
        p:{...legalMove.piece},
        not:san,
        uci:coordsToUci(legalMove.fr.row, legalMove.fr.col, legalMove.to.row, legalMove.to.col, promo),
        meta:legalMove.meta,
      };
    }).find(Boolean) || (() => {
      const fallback = findLegalMoveForSan(state, token, legal);
      if(!fallback) return null;
      const san = buildReviewSanForMove(state, fallback, legal);
      const promo = fallback.piece.t==='p' && (fallback.to.row===0||fallback.to.row===7) ? 'q' : undefined;
      return {
        fr:{...fallback.fr},
        to:{...fallback.to},
        p:{...fallback.piece},
        not:san,
        uci:coordsToUci(fallback.fr.row, fallback.fr.col, fallback.to.row, fallback.to.col, promo),
        meta:fallback.meta,
      };
    })();
    if(!found) throw new Error(`Could not parse move: ${token}`);
    moves.push(found);
    const next = applyPreviewMove({ board:dc(state.b), turn:state.t, cas:{...state.cas}, ep:state.ep?{...state.ep}:null }, { fr:found.fr, to:found.to, meta:found.meta, piece:{...found.p} });
    state = { b:next.board, t:next.turn, cas:next.cas, ep:next.ep };
  }
  return { tags, moves };
}

function renderCurrentMoveBadge(){
  document.querySelectorAll('.qbadge').forEach(el=>el.remove());
  if(!reviewState.showBadges || hIdx < 0 || !hist[hIdx]?.quality) return;
  const mv = hist[hIdx];
  const bEl = document.getElementById('board');
  const badge = document.createElement('div');
  badge.className = 'qbadge ' + mv.quality.key;
  badge.innerHTML = badgeIconMarkup(mv.quality.key);
  badge.title = `${mv.quality.label} (${mv.quality.delta >= 0 ? '+' : ''}${mv.quality.delta})`;
  badge.style.left = (sx(mv.to.col) + CS * 0.78) + 'px';
  badge.style.top = (sy(mv.to.row) + CS * 0.22) + 'px';
  bEl.appendChild(badge);
}

const baseRender = render;
render = function reviewRender(){
  baseRender();
  renderCurrentMoveBadge();
  if(!reviewState.showBadges) document.querySelectorAll('.qbadge').forEach(el=>el.remove());
};

const baseUpdatePGN = updatePGN;
updatePGN = function reviewUpdatePGN(){
  if(!reviewState.loaded){
    baseUpdatePGN();
    return;
  }
  const preferredOrder = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'TimeControl', 'ECO', 'Opening', 'Termination', 'Variant', 'FEN'];
  const lines = [];
  const seen = new Set();
  preferredOrder.forEach(key => {
    if(reviewState.tags[key] == null || reviewState.tags[key] === '') return;
    seen.add(key);
    lines.push(`[${key} "${String(reviewState.tags[key]).replace(/"/g, '\\"')}"]`);
  });
  Object.entries(reviewState.tags).forEach(([key, value]) => {
    if(seen.has(key) || value == null || value === '') return;
    lines.push(`[${key} "${String(value).replace(/"/g, '\\"')}"]`);
  });
  if(!seen.has('Result')) lines.push('[Result "*"]');
  const moves = hist.map((move, index) => `${index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ''}${move.not}`).join(' ').trim() || '*';
  document.getElementById('pgnBox').textContent = `${lines.join('\n')}\n\n${moves}`;
};

function updateMoveListReview(){
  const ml=document.getElementById('moveList'); ml.innerHTML='';
  let currentCell = null;
  for(let i=0;i<hist.length;i+=2){
    const row=document.createElement('div'); row.className='mv-row';
    const nm=document.createElement('span'); nm.className='mv-num'; nm.textContent=(i/2+1)+'.'; row.appendChild(nm);
    [0,1].forEach(off=>{
      const td=document.createElement('span');
      td.className='mv-cell'+(hIdx===i+off?' cur':'');
      if(hIdx===i+off) currentCell = td;
      const move = hist[i+off];
      const wrap = document.createElement('span'); wrap.className='mv-cell-inner';
      const text = document.createElement('span'); text.textContent = move?.not || ''; wrap.appendChild(text);
      if(move?.quality){
        const badge=document.createElement('span');
        badge.className='mv-qbadge ' + move.quality.key;
        badge.innerHTML=badgeIconMarkup(move.quality.key);
        badge.title=`${move.quality.label} (${move.quality.delta >= 0 ? '+' : ''}${move.quality.delta})`;
        wrap.appendChild(badge);
      }
      td.appendChild(wrap);
      if(move) td.onclick=()=>jumpTo(i+off);
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

function renderReviewSummary(){
  const summaryEl = document.getElementById('reviewSummary');
  if(!summaryEl) return;
  if(!reviewState.summary){ summaryEl.innerHTML=''; return; }
  const whiteName = reviewState.tags.White || 'White';
  const blackName = reviewState.tags.Black || 'Black';
  const white = reviewState.summary.w;
  const black = reviewState.summary.b;
  const rows = [['Accuracy',null],['Brilliant','brilliant'],['Best','best'],['Excellent','excellent'],['Good','good'],['Inaccuracy','inaccuracy'],['Mistake','mistake'],['Blunder','blunder']];
  summaryEl.innerHTML = `
    <div class="review-head">
      <div class="review-player-card">
        <div class="review-player-name">${escapeHtml(whiteName)}</div>
        <div class="review-player-meta">
          <div class="review-avatar white">W</div>
          <div class="review-accuracy-block">
            <div class="review-accuracy">${white.accuracy}%</div>
            <div class="review-accuracy-label">Accuracy</div>
          </div>
        </div>
      </div>
      <div class="review-player-card">
        <div class="review-player-name">${escapeHtml(blackName)}</div>
        <div class="review-player-meta">
          <div class="review-avatar black">B</div>
          <div class="review-accuracy-block">
            <div class="review-accuracy">${black.accuracy}%</div>
            <div class="review-accuracy-label">Accuracy</div>
          </div>
        </div>
      </div>
    </div>
    <div class="review-stats">
      ${rows.map(([label,key])=>{
        const icon = key ? `<span class="review-stat-icon review-${key}">${badgeIconMarkup(key)}</span>` : '<span class="review-stat-icon review-empty"></span>';
        return `<div class="review-stat-row">
          <span class="review-stat-value white">${key ? white.counts[key] : `${white.accuracy}%`}</span>
          <span class="review-stat-label">${label}</span>
          ${icon}
          <span class="review-stat-value black">${key ? black.counts[key] : `${black.accuracy}%`}</span>
        </div>`;
      }).join('')}
    </div>
  `;
}

function syncReviewScale(){
  const root = document.documentElement;
  const scale = Math.max(0.72, Math.min(1.12, CS / 64));
  root.style.setProperty('--review-status-size', `${Math.round(11 * scale)}px`);
  root.style.setProperty('--review-summary-pad', `${Math.round(6 * scale)}px`);
  root.style.setProperty('--review-gap', `${Math.round(6 * scale)}px`);
  root.style.setProperty('--review-card-pad', `${Math.round(6 * scale)}px`);
  root.style.setProperty('--review-name-size', `${Math.round(12 * scale)}px`);
  root.style.setProperty('--review-avatar-size', `${Math.round(38 * scale)}px`);
  root.style.setProperty('--review-avatar-font', `${Math.round(18 * scale)}px`);
  root.style.setProperty('--review-accuracy-size', `${Math.round(22 * scale)}px`);
  root.style.setProperty('--review-row-pad-y', `${Math.max(1, Math.round(2 * scale))}px`);
  root.style.setProperty('--review-row-pad-x', `${Math.round(5 * scale)}px`);
  root.style.setProperty('--review-label-size', `${Math.round(12 * scale)}px`);
  root.style.setProperty('--review-value-size', `${Math.round(14 * scale)}px`);
  root.style.setProperty('--review-icon-size', `${Math.round(16 * scale)}px`);
  root.style.setProperty('--review-icon-svg', `${Math.round(8 * scale)}px`);
  root.style.setProperty('--review-value-col', `${Math.round(52 * scale)}px`);
}

function renderReviewOverlay(){
  const overlay=document.getElementById('reviewOverlay');
  const status=document.getElementById('reviewStatus');
  const toggle=document.getElementById('btnReviewToggle');
  if(!overlay||!status||!toggle) return;
  overlay.classList.toggle('hidden', !reviewState.overlayVisible);
  toggle.classList.toggle('active', reviewState.overlayVisible);
  toggle.textContent = reviewState.overlayVisible ? '👁' : '🙈';
  status.textContent = reviewState.status;
  renderReviewSummary();
}

function summarizeReview(){
  const empty = ()=>({ accuracy:100, moves:0, loss:0, counts:Object.fromEntries(REVIEW_CATEGORY_ORDER.map(k=>[k,0])) });
  const stats = { w:empty(), b:empty() };
  hist.forEach(move=>{
    if(!move?.quality) return;
    const side = stats[move.mover];
    side.moves++;
    side.counts[move.quality.key]++;
    side.loss += Math.max(0, Number(move.reviewLoss || 0));
  });
  ['w','b'].forEach(side=>{
    const avgLoss = stats[side].moves ? stats[side].loss / stats[side].moves : 0;
    stats[side].accuracy = computeReviewAccuracy(avgLoss);
  });
  return stats;
}

function syncReviewPositionUi(){
  const ply = hIdx + 1;
  const info = reviewState.positionReviews[ply] || null;
  if(!info){
    bestArrowMove = null;
    applyEvalDisplay(null);
    document.getElementById('engDepth').textContent = reviewState.running ? reviewState.status : 'Load PGN to review the game.';
    render();
    return;
  }
  applyEvalDisplay(info.entry || null);
  const state = { board:dc(board), turn, cas:{...castling}, ep:epSquare?{...epSquare}:null };
  const preview = info.bestMoveUci ? uciToPreviewMove(info.bestMoveUci, state) : null;
  bestArrowMove = preview ? { fr:preview.fr, to:preview.to } : null;
  document.getElementById('engDepth').textContent = `Review ply ${ply}/${Math.max(hist.length,1)}, depth ${info.depth || getReviewDepth()}`;
  updateMoveListReview();
  render();
}

function serializeReviewData(){
  return {
    summary:reviewState.summary,
    positionReviews:reviewState.positionReviews,
    moveReviews:hist.map(move=>({ key:move.quality?.key||null, delta:Number(move.quality?.delta||0), loss:Number(move.reviewLoss||0) })),
    status:'Review loaded from browser cache.',
  };
}

function applyCachedReviewData(cached){
  reviewState.summary = cached?.summary || null;
  reviewState.positionReviews = Array.isArray(cached?.positionReviews) ? cached.positionReviews : [];
  hist.forEach((move,index)=>{
    const stored = cached?.moveReviews?.[index] || null;
    move.quality = stored?.key ? { ...MOVE_QUALITY[stored.key], delta:Number(stored.delta||0) } : null;
    move.reviewLoss = Number(stored?.loss || 0);
  });
  reviewState.status = cached?.status || 'Review loaded from browser cache.';
}

function isReviewCacheUsable(cached){
  const moveReviews = Array.isArray(cached?.moveReviews) ? cached.moveReviews : [];
  if(!hist.length) return false;
  if(moveReviews.length !== hist.length) return false;
  return true;
}

function ensureReviewWorker(){
  if(reviewState.worker) return;
  const fallbackScripts = Array.isArray(engineCandidates) && engineCandidates.length
    ? engineCandidates
    : ['modules/lib/komodoro.js', 'modules/lib/stockfish-worker.js'];
  const script = fallbackScripts[Math.min(reviewState.engineScriptIndex, fallbackScripts.length - 1)];
  reviewState.engineScript = script;
  clearTimeout(reviewState.engineBootTimer);
  if(typeof createEngineWorkerForScript === 'function'){
    reviewState.worker = createEngineWorkerForScript(script);
  }else if(String(script || '').includes('komodoro')){
    const wasmUrl = window._ckAssetUrl('modules/lib/komodoro.wasm');
    const scriptUrl = chrome.runtime.getURL(script);
    const blob = new Blob([`self.Module={locateFile:(path)=>path.endsWith('.wasm')?${JSON.stringify(wasmUrl)}:path};importScripts(${JSON.stringify(scriptUrl)});`], {
      type: 'application/javascript'
    });
    const blobUrl = URL.createObjectURL(blob);
    reviewState.worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);
  }else{
    reviewState.worker = new Worker(chrome.runtime.getURL(script));
  }
  reviewState.engineBootTimer = setTimeout(() => {
    if(reviewState.ready && reviewState.uciReady) return;
    try{ reviewState.worker?.terminate(); }catch(_){}
    reviewState.worker = null;
    reviewState.ready = false;
    reviewState.uciReady = false;
    if(reviewState.engineScriptIndex < fallbackScripts.length - 1){
      reviewState.engineScriptIndex++;
      reviewState.status = `Review engine fallback: ${typeof engineDisplayName === 'function' ? engineDisplayName(script) : script} timed out, retrying...`;
      renderReviewOverlay();
      ensureReviewWorker();
      return;
    }
    reviewState.status = 'Review engine handshake timed out.';
    reviewState.running = false;
    if(reviewState.pendingReject) reviewState.pendingReject(new Error(reviewState.status));
    reviewState.pendingResolve = null;
    reviewState.pendingReject = null;
    renderReviewOverlay();
  }, 5000);
  reviewState.worker.onmessage = e => handleReviewWorkerMessage(String(e.data || ''));
  reviewState.worker.onerror = err => {
    console.error(err);
    clearTimeout(reviewState.engineBootTimer);
    try{ reviewState.worker?.terminate(); }catch(_){}
    reviewState.worker = null;
    reviewState.ready = false;
    reviewState.uciReady = false;
    if(reviewState.engineScriptIndex < fallbackScripts.length - 1){
      reviewState.engineScriptIndex++;
      reviewState.status = `Review engine fallback: ${typeof engineDisplayName === 'function' ? engineDisplayName(script) : script} failed, retrying...`;
      renderReviewOverlay();
      ensureReviewWorker();
      return;
    }
    reviewState.status = 'Review engine failed to load.';
    reviewState.running = false;
    if(reviewState.pendingReject) reviewState.pendingReject(err);
    reviewState.pendingResolve = null;
    reviewState.pendingReject = null;
    renderReviewOverlay();
  };
  reviewSend('uci');
}

function reviewSend(cmd){ ensureReviewWorker(); reviewState.worker.postMessage(cmd); }

function handleReviewWorkerMessage(line){
  if(!line) return;
  if(line === 'uciok'){
    reviewState.uciReady = true;
    reviewSend('setoption name MultiPV value 1');
    if(!String(reviewState.engineScript || '').includes('komodoro')){
      reviewSend('setoption name UCI_AnalyseMode value true');
    }
    reviewSend('isready');
    return;
  }
  if(line === 'readyok'){
    reviewState.ready = true;
    clearTimeout(reviewState.engineBootTimer);
    reviewState.engineBootTimer = null;
    return;
  }
  if(line.startsWith('info ')){
    const depth = Number((line.match(/\bdepth\s+(\d+)/)||[])[1]||0);
    const cp = (line.match(/\bscore\s+cp\s+(-?\d+)/)||[])[1];
    const mate = (line.match(/\bscore\s+mate\s+(-?\d+)/)||[])[1];
    const pv = (line.match(/\bpv\s+(.+)$/)||[])[1];
    if(!pv) return;
    reviewState.pendingInfo = { depth, cp: cp!=null ? Number(cp) : null, mate: mate!=null ? Number(mate) : null, pv:pv.trim(), bestMoveUci:pv.trim().split(/\s+/)[0]||null };
    return;
  }
  if(line.startsWith('bestmove')){
    const bestmove = line.split(/\s+/)[1] || reviewState.pendingInfo?.bestMoveUci || null;
    if(reviewState.pendingResolve) reviewState.pendingResolve({ ...(reviewState.pendingInfo||{}), bestMoveUci:bestmove });
    reviewState.pendingResolve = null;
    reviewState.pendingReject = null;
    reviewState.pendingInfo = null;
  }
}

async function waitForReviewReady(){
  ensureReviewWorker();
  while(!reviewState.ready || !reviewState.uciReady) await delay(50);
}

async function reviewAnalyzeFen(fen, depth=getReviewDepth()){
  await waitForReviewReady();
  return new Promise((resolve,reject)=>{
    reviewState.pendingInfo = null;
    reviewState.pendingResolve = info => resolve(info);
    reviewState.pendingReject = reject;
    reviewSend('stop');
    reviewSend('position fen ' + fen);
    reviewSend('go depth ' + depth);
  });
}

async function analyzeLoadedGame(){
  if(!hist.length){ reviewState.status='No moves to review.'; renderReviewOverlay(); return; }
  reviewState.running = true;
  reviewState.status = `Analyzing 0/${hist.length} moves (0%)...`;
  renderReviewOverlay();
  try{
    reviewState.positionReviews = [];
    let before = await reviewAnalyzeFen(stateToFen(states[0],0));
    reviewState.positionReviews[0] = { entry:before, bestMoveUci:before.bestMoveUci||null, depth:before.depth||getReviewDepth() };
    for(let i=0;i<hist.length;i++){
      const after = await reviewAnalyzeFen(stateToFen(states[i+1], i+1));
      const move = hist[i];
      applyMoveQualityReview({ moveIndex:i, mover:move.mover, beforeCp:scoreToWhiteCpLocal(before), bestMoveUci:before.bestMoveUci }, after);
      const beforeMover = move.mover==='w' ? scoreToWhiteCpLocal(before) : -scoreToWhiteCpLocal(before);
      const afterMover = move.mover==='w' ? scoreToWhiteCpLocal(after) : -scoreToWhiteCpLocal(after);
      move.reviewLoss = Math.max(0, Number(((beforeMover - afterMover)/100).toFixed(2)));
      reviewState.positionReviews[i+1] = { entry:after, bestMoveUci:after.bestMoveUci||null, depth:after.depth||getReviewDepth() };
      before = after;
      const completed = i + 1;
      const pct = Math.round((completed / hist.length) * 100);
      reviewState.status = `Analyzing ${completed}/${hist.length} moves (${pct}%)...`;
      renderReviewOverlay();
    }
    reviewState.summary = summarizeReview();
    reviewState.status = `Review complete: ${hist.length} moves analyzed.`;
    if(reviewState.cacheKey) saveReviewCache(reviewState.cacheKey, serializeReviewData());
  }catch(err){
    console.error(err);
    reviewState.status = `Review failed: ${err?.message || err}`;
  }finally{
    reviewState.running = false;
    updateUI();
  }
}

async function loadReviewPgnText(pgnText){
  try{
    const sanitized = sanitizePgnText(pgnText);
    reviewState.cacheKey = reviewCacheKey(sanitized);
    await loadAnalysisPgnText(sanitized);
    const parsed = extractPgnDataWithChessJs(sanitized) || extractPgnData(sanitized);
    hist.forEach((move, index) => {
      move.uci = move.uci || parsed.moves?.[index]?.uci || move.uci;
      move.mover = index % 2 === 0 ? 'w' : 'b';
      move.quality = null;
      move.reviewLoss = 0;
    });
    reviewState.tags = parsed.tags || {};
    reviewState.loaded = hist.length > 0;
    setImportOverlayVisible(!reviewState.loaded);
    nav0();
    const cached = loadReviewCache(reviewState.cacheKey);
    if(cached && isReviewCacheUsable(cached)){
      applyCachedReviewData(cached);
      updateUI();
      return true;
    }
    if(cached && !isReviewCacheUsable(cached) && reviewState.cacheKey){
      clearReviewCache(reviewState.cacheKey);
    }
    if(!hist.length){
      throw new Error('PGN parsed without any moves.');
    }
    reviewState.summary = null;
    reviewState.positionReviews = [];
    reviewState.status = `Analyzing 0/${hist.length} moves (0%)...`;
    updateUI();
    analyzeLoadedGame().catch(err => {
      console.error(err);
      reviewState.status = `Review failed: ${err?.message || err}`;
      reviewState.running = false;
      updateUI();
    });
    return true;
  }catch(err){
    console.error(err);
    reviewState.loaded = false;
    reviewState.status = err?.message || 'Failed to load PGN.';
    reviewState.summary = null;
    setImportOverlayVisible(true);
    renderReviewOverlay();
    setImportStatus(reviewState.status, 'error');
    setResultsOverlayMessage(getVisibleResultsSource(), escapeHtml(reviewState.status));
    return false;
  }
}

async function consumeInitialReviewPgn(){
  const params = new URLSearchParams(window.location.search);
  cleanupExpiredReviewPgnHandoffs();
  const pgnKey = params.get('pgnKey');
  if(pgnKey && typeof chrome !== 'undefined' && chrome.storage?.local){
    try{
      const stored = await storageLocalGet(pgnKey);
      const payload = stored?.[pgnKey];
      const storedPgn = String(payload?.pgn || '').trim();
      if(storedPgn) return storedPgn;
      reviewState.status = 'PGN handoff key was found, but payload was empty.';
    }catch(err){
      console.error('Failed to read review PGN handoff:', err);
      reviewState.status = err?.message || 'Failed to read review PGN handoff.';
    }
  }
  const pgn64 = params.get('pgn64') || decodeURIComponent(readRawQueryParam('pgn64'));
  if(pgn64){
    const decodedPgn = String(decodePgnFromUrl(pgn64) || '').trim();
    if(decodedPgn) return decodedPgn;
    reviewState.status = 'PGN was passed in the URL, but could not be decoded.';
  }
  const gameUrl = String(params.get('gameUrl') || '').trim();
  if(gameUrl && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage){
    try{
      const response = await runtimeSendMessage({
        action: 'fetchGamePgn',
        gameUrl,
        usernameHints: readUsernameHintsFromParams(params),
      });
      const fetchedPgn = String(response?.pgn || '').trim();
      if(response?.success && fetchedPgn) return fetchedPgn;
      if(response?.needsRetry){
        reviewState.status = 'Game archive is not ready yet. Try again in a few seconds.';
      }else if(response?.error){
        reviewState.status = response.error;
      }
    }catch(err){
      console.error('Failed to fetch review PGN by gameUrl:', err);
      reviewState.status = err?.message || 'Failed to fetch PGN for review.';
    }
  }
  return params.get('pgn') || '';
}

const baseUpdateUI = updateUI;
updateUI = function reviewUpdateUI(){
  document.getElementById('fenVal').textContent = toFEN(board,turn);
  updateMoveListReview();
  updatePGN();
  syncReviewPositionUi();
  syncEmptyStateCtas();
  renderReviewOverlay();
};

function openImportOverlayFromEmptyState(){
  if(reviewState.loaded) return;
  setImportOverlayVisible(true);
}

function syncEmptyStateCtas(){
  const reviewStatus = document.getElementById('reviewStatus');
  const engDepth = document.getElementById('engDepth');
  [reviewStatus, engDepth].forEach(el=>{
    if(!el) return;
    el.classList.toggle('clickable-empty-state', !reviewState.loaded);
    if(!reviewState.loaded){
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', 'Open PGN import');
    }else{
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      el.removeAttribute('aria-label');
    }
  });
}

function bindReviewControls(){
  setToggleButton(document.getElementById('stShowBadges'), true);
  document.getElementById('stShowBadges')?.addEventListener('click', ()=>{
    const nextOn = document.getElementById('stShowBadges').classList.contains('off');
    reviewState.showBadges = nextOn;
    setToggleButton(document.getElementById('stShowBadges'), nextOn);
    render();
  });
  document.getElementById('btnReviewToggle')?.addEventListener('click', ()=>{ reviewState.overlayVisible = !reviewState.overlayVisible; renderReviewOverlay(); });
  document.getElementById('loadPgnLink')?.addEventListener('click', e=>{ e.preventDefault(); document.getElementById('reviewPgnFile')?.click(); });
  document.getElementById('reviewStatus')?.addEventListener('click', openImportOverlayFromEmptyState);
  document.getElementById('engDepth')?.addEventListener('click', openImportOverlayFromEmptyState);
  [document.getElementById('reviewStatus'), document.getElementById('engDepth')].forEach(el=>{
    el?.addEventListener('keydown', e=>{
      if(reviewState.loaded) return;
      if(e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openImportOverlayFromEmptyState();
    });
  });
  document.getElementById('reviewPgnFile')?.addEventListener('change', async e=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    document.getElementById('pgnBox').textContent = text;
    await loadReviewPgnText(text);
    e.target.value = '';
  });
  document.querySelectorAll('[data-import-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=> setImportTab(btn.getAttribute('data-import-tab')));
  });
  document.getElementById('importCloseBtn')?.addEventListener('click', ()=> setImportOverlayVisible(false));
  document.getElementById('continueWithoutGameBtn')?.addEventListener('click', ()=> setImportOverlayVisible(false));
  document.getElementById('importPgnBtn')?.addEventListener('click', ()=> loadReviewGameFromPgn(document.getElementById('importPgnText')?.value || ''));
  document.getElementById('searchChessComBtn')?.addEventListener('click', ()=> handleChessComSearch());
  document.getElementById('chessComBackBtn')?.addEventListener('click', ()=> setChessComResultsVisible(false));
  document.getElementById('chessComResultsCloseBtn')?.addEventListener('click', ()=> setImportOverlayVisible(false));
  document.getElementById('searchLichessBtn')?.addEventListener('click', ()=> handleLichessSearch());
  document.getElementById('lichessBackBtn')?.addEventListener('click', ()=> setLichessResultsVisible(false));
  document.getElementById('lichessResultsCloseBtn')?.addEventListener('click', ()=> setImportOverlayVisible(false));
  document.getElementById('chessComPrevMonthBtn')?.addEventListener('click', ()=> loadChessComArchiveByIndex(reviewState.chessComArchiveIndex - 1));
  document.getElementById('chessComNextMonthBtn')?.addEventListener('click', ()=> loadChessComArchiveByIndex(reviewState.chessComArchiveIndex + 1));
  document.getElementById('chessComResults')?.addEventListener('click', async event=>{
    if(!(event.target instanceof Element)) return;
    const card = event.target.closest('[data-import-source="chesscom"]');
    if(!card) return;
    await handleImportedGameClick('chesscom', Number(card.getAttribute('data-import-index')));
  });
  document.getElementById('lichessResults')?.addEventListener('click', async event=>{
    if(!(event.target instanceof Element)) return;
    const card = event.target.closest('[data-import-source="lichess"]');
    if(!card) return;
    await handleImportedGameClick('lichess', Number(card.getAttribute('data-import-index')));
  });
}

function initReviewPage(){
  if(!Array.isArray(board) || board.length !== 8){
    board = parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }
  engOn = false;
  bestArrowMove = null;
  pvPreviewMoves = [];
  engineLines.clear();
  if(engineWorker){
    try{ engineWorker.postMessage('stop'); }catch(err){}
    try{ engineWorker.terminate(); }catch(err){}
    engineWorker = null;
  }
  sel = null;
  clickPc = function() { return; };
  clickDest = function() { return; };
  startDrag = function() { return; };
  document.getElementById('board').style.cursor = 'default';
  document.getElementById('board').style.touchAction = 'none';
  document.getElementById('togBtn').disabled = true;
  bindReviewControls();
  syncReviewScale();
  renderReviewOverlay();
  syncReviewPositionUi();
  syncEmptyStateCtas();
  consumeInitialReviewPgn().then(pgn => {
    if(pgn && !reviewState.startedWithPgn){
      reviewState.startedWithPgn = true;
      document.getElementById('pgnBox').textContent = pgn;
      const importBox = document.getElementById('importPgnText');
      if(importBox) importBox.value = pgn;
      return loadReviewGameFromPgn(pgn);
    }
    if(!pgn && paramsHasPgnKey()){
      updateUI();
    }
    setImportOverlayVisible(true);
    return null;
  }).catch(err => {
    console.error(err);
    reviewState.status = err?.message || 'Failed to load PGN.';
    setImportOverlayVisible(true);
    updateUI();
  });
}

function paramsHasPgnKey(){
  return new URLSearchParams(window.location.search).has('pgnKey');
}

window.addEventListener('beforeunload', ()=>{
  if(reviewState.worker){
    clearTimeout(reviewState.engineBootTimer);
    try{ reviewState.worker.postMessage('stop'); }catch(err){}
    try{ reviewState.worker.terminate(); }catch(err){}
  }
});

initReviewPage();


