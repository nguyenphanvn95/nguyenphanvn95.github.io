(() => {
  // --- Cleanup previous instance (extension reload / duplicate injection) ---
  const MARKER = 'data-chess-helper'
  const PANEL_ID = '_chess_helper'
  const CANVAS_PREFIX = '_chess_helper_cv'
  // Remove new-style elements (with marker attribute)
  document.querySelectorAll(`[${MARKER}]`).forEach(el => el.remove())
  // Remove legacy panels (old random IDs like _pXXXXXX) by checking for chess-helper data attributes inside
  document.querySelectorAll('div[id^="_p"]').forEach(el => {
    if (el.querySelector('[data-move]') && el.querySelector('[data-depth]')) el.remove()
  })
  // Remove legacy canvases (old random IDs like _cXXXXXX_0)
  document.querySelectorAll('canvas[id^="_c"]').forEach(el => {
    if (el.style.position === 'fixed' && el.style.pointerEvents === 'none') el.remove()
  })
  // Remove legacy style tags injected by old instances
  document.querySelectorAll('style').forEach(s => {
    if (s.textContent && s.textContent.includes('[data-move]') && s.textContent.includes('[data-depth]')) s.remove()
  })

  const DEBUG = (() => {
    try { return localStorage.getItem('_dbg') === '1' } catch { return false }
  })()

  const shouldConsoleLog = (scope, message) => {
    if (DEBUG) return true
    const text = `${scope} ${message}`.toLowerCase()
    if (scope === 'Engine') {
      if (message === 'host:error' || message === 'host:ready') return true
      if (message === 'bestmove:request' || message === 'bestmove:response' || message === 'bestmove:error') return true
      return /error|exception|failed|timeout|fallback/.test(text)
    }
    return /error|exception|failed|timeout|fallback/.test(text)
  }

  const LOG = {
    max: 400, lines: [],
    push: (msg) => {
      try {
        const line = `[${new Date().toISOString()}] ${msg}`
        LOG.lines.push(line)
        if (LOG.lines.length > LOG.max) LOG.lines.splice(0, LOG.lines.length - LOG.max)
      } catch {}
    },
  }
  const logEvent = (scope, message, payload) => {
    const base = `[${scope}] ${message}`
    try {
      if (payload !== undefined) {
        if (shouldConsoleLog(scope, message)) console.log(`[Chess Helper] ${base}`, payload)
        LOG.push(`${base} ${JSON.stringify(payload)}`)
      } else {
        if (shouldConsoleLog(scope, message)) console.log(`[Chess Helper] ${base}`)
        LOG.push(base)
      }
    } catch {
      LOG.push(base)
    }
  }

  // --- Config ---
  const STORAGE = {
    depth: '_ch_d',
    skipEnemy: '_ch_s',
    startMove: '_ch_m',
    lines: '_ch_l',
    styleMode: '_ch_style',
    minimized: '_ch_min',
    arrows: '_ch_a',
    safeMode: '_ch_safe',
    autoDelayMin: '_ch_delay_min',
    autoDelayMax: '_ch_delay_max',
    hideSuggestion: '_ch_hide',
    panelPos: '_ch_pos',
    wizardChess: '_ch_wiz',
    autoPlay: '_ch_auto',
    analyzePlayerMoves: '_ch_analyze_moves',
  }
  const PREMIUM_MAX_DEPTH = 12
  const FREE_MAX_DEPTH = 5
  const PREMIUM_MAX_LINES = 3
  const FREE_MAX_LINES = 1
  const PROMO_END_MS = Date.parse('2026-03-17T02:59:59Z')
  const FREE_DAILY_SUGGESTIONS = 150
  const ENGINE_VERSION = 'Stockfish 18'
  const STYLE_MODE_OPTIONS = [
    { value: 'default', label: 'Default' },
    { value: 'aggressive', label: 'Aggressive' },
    { value: 'defensive', label: 'Defensive' },
    { value: 'endgame', label: 'Endgame' },
    { value: 'suicide', label: 'Suicide' },
    { value: 'human', label: 'Human' },
  ]
  const STYLE_MODE_VALUES = new Set(STYLE_MODE_OPTIONS.map((option) => option.value))

  // --- Site Detection ---
  const SITE = window.location.hostname.includes('lichess') ? 'lichess' : 'chesscom'
  const LICHESS_PIECE_MAP = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' }
  const LICHESS_BRIDGE_CHANNEL = '__chess_helper_lichess_bridge__'
  const LICHESS_BRIDGE_REQ_ACTION = 'move'
  const LICHESS_BRIDGE_RES_ACTION = 'move_result'
  let chessComContextUserId = null
  let chessComContextUsername = null
  let lichessBridgeSeq = 0
  const lichessBridgePending = new Map()
  let lichessBridgeListenerBound = false

  const ensureLichessBridgeListener = () => {
    if (SITE !== 'lichess' || lichessBridgeListenerBound) return
    lichessBridgeListenerBound = true
    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const data = event?.data
      if (!data || data.channel !== LICHESS_BRIDGE_CHANNEL || data.action !== LICHESS_BRIDGE_RES_ACTION) return
      const requestId = data.requestId
      if (!requestId || !lichessBridgePending.has(requestId)) return
      const resolver = lichessBridgePending.get(requestId)
      lichessBridgePending.delete(requestId)
      try { resolver(!!data.ok) } catch {}
    })
  }

  const requestLichessBridgeMove = (uci, promotion = null, timeoutMs = 700) =>
    new Promise((resolve) => {
      if (SITE !== 'lichess' || typeof uci !== 'string' || uci.length < 4) return resolve(false)
      ensureLichessBridgeListener()
      const requestId = `chm_${Date.now()}_${++lichessBridgeSeq}`
      const timer = setTimeout(() => {
        lichessBridgePending.delete(requestId)
        resolve(false)
      }, timeoutMs)
      lichessBridgePending.set(requestId, (ok) => {
        clearTimeout(timer)
        resolve(!!ok)
      })
      window.postMessage(
        {
          channel: LICHESS_BRIDGE_CHANNEL,
          action: LICHESS_BRIDGE_REQ_ACTION,
          requestId,
          uci,
          promotion: typeof promotion === 'string' ? promotion : null,
        },
        '*'
      )
    })

  const normalizeDetectedUsername = (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : null

  const isPlaceholderUsername = (value) => {
    const v = (normalizeDetectedUsername(value) || '').toLowerCase()
    return !v || v === 'guest' || v === 'player' || v === 'anonymous' || v === 'you' || v === 'testuser'
  }

  const pickFirstRealUsername = (...candidates) => {
    for (const candidate of candidates) {
      const normalized = normalizeDetectedUsername(candidate)
      if (!normalized) continue
      if (isPlaceholderUsername(normalized)) continue
      return normalized
    }
    return null
  }

  const UCI_MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/

  const normalizeUciMove = (value) => {
    const move = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return UCI_MOVE_RE.test(move) ? move : null
  }

  const normalizeUciMoves = (rawMoves, max = 600) => {
    const out = []
    if (Array.isArray(rawMoves)) {
      for (const item of rawMoves) {
        const move = normalizeUciMove(item)
        if (!move) continue
        out.push(move)
        if (out.length >= max) break
      }
      return out
    }
    if (typeof rawMoves === 'string') {
      const tokens = rawMoves.split(/[\s,]+/).filter(Boolean)
      for (const token of tokens) {
        const move = normalizeUciMove(token)
        if (!move) continue
        out.push(move)
        if (out.length >= max) break
      }
    }
    return out
  }

  // Detect if a string is in UCI move format (e.g. "e2e4", "g1f3", "e7e8q")
  const _isUciFormat = (s) => typeof s === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s)

  // Convert SAN notation (e.g. "Nf3", "exd5", "O-O") to UCI (e.g. "g1f3", "e4d5", "e1g1")
  // Uses the FEN to resolve the from-square by finding the matching piece on the board.
  const _sanToUci = (san, fen) => {
    if (!san || !fen) return null
    if (_isUciFormat(san)) return san
    let s = san.replace(/[+#!?]/g, '')
    // Castling
    if (/^O-O-O|^0-0-0/i.test(s)) {
      const t = (fen.split(' ')[1] || 'w')
      return t === 'w' ? 'e1c1' : 'e8c8'
    }
    if (/^O-O|^0-0/i.test(s)) {
      const t = (fen.split(' ')[1] || 'w')
      return t === 'w' ? 'e1g1' : 'e8g8'
    }
    // Promotion
    let promo = ''
    const pm = san.match(/=([QRBNqrbn])/)
    if (pm) { promo = pm[1].toLowerCase(); s = s.replace(/=[QRBNqrbn]/, '') }
    // Capture flag (important for pawn move disambiguation)
    const isCap = /x/i.test(s)
    // Target square (last file+rank in the string)
    const tm = s.match(/([a-h])([1-8])\s*$/)
    if (!tm) return null
    const toF = tm[1], toR = tm[2]
    const toFI = toF.charCodeAt(0) - 97, toRI = 8 - parseInt(toR)
    // Piece type
    let pc = ''
    if (/^[KQRBN]/.test(s)) { pc = s[0]; s = s.slice(1) }
    // Disambiguation
    s = s.replace(/x/gi, '').replace(toF + toR, '')
    let dF = null, dR = null
    for (const ch of s) {
      if (/[a-h]/.test(ch)) dF = ch
      else if (/[1-8]/.test(ch)) dR = ch
    }
    // Parse FEN board
    const rows = fen.split(' ')[0].split('/')
    const turn = (fen.split(' ')[1] || 'w')
    const bd = []
    for (let r = 0; r < 8; r++) {
      bd[r] = []; let c = 0
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') { for (let i = 0; i < +ch; i++) bd[r][c++] = null }
        else bd[r][c++] = ch
      }
    }
    const fp = !pc ? (turn === 'w' ? 'P' : 'p') : (turn === 'w' ? pc : pc.toLowerCase())
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (bd[r][c] !== fp) continue
        const ff = String.fromCharCode(97 + c), fr = String(8 - r)
        if (dF && ff !== dF) continue
        if (dR && fr !== dR) continue
        const dr = toRI - r, dc = toFI - c, adr = Math.abs(dr), adc = Math.abs(dc)
        let ok = false
        switch ((pc || 'P').toUpperCase()) {
          case 'P':
            if (turn === 'w') {
              ok = isCap || dF
                ? (adc === 1 && dr === -1)   // capture: diagonal
                : (dc === 0 && (dr === -1 || (dr === -2 && r === 6)))  // advance: straight
            } else {
              ok = isCap || dF
                ? (adc === 1 && dr === 1)
                : (dc === 0 && (dr === 1 || (dr === 2 && r === 1)))
            }
            break
          case 'N': ok = (adr === 2 && adc === 1) || (adr === 1 && adc === 2); break
          case 'B': ok = adr === adc && adr > 0; break
          case 'R': ok = (dr === 0 || dc === 0) && (adr + adc > 0); break
          case 'Q': ok = (dr === 0 || dc === 0 || adr === adc) && (adr + adc > 0); break
          case 'K': ok = adr <= 1 && adc <= 1 && (adr + adc > 0); break
        }
        if (ok) return ff + fr + toF + toR + promo
      }
    }
    return null
  }

  // Read Chess.com stable user id from page MAIN world (window.context.user.id)
  if (SITE === 'chesscom') {
    window.addEventListener('message', (ev) => {
      const data = ev?.data
      if (!data || data.__chess_helper_type !== '__CHESSCOM_CONTEXT_USER_ID__') return
      if (data.userId !== undefined && data.userId !== null && String(data.userId).trim()) {
        chessComContextUserId = String(data.userId).trim()
      }
      const contextUsername = normalizeDetectedUsername(data.username)
      if (contextUsername && !isPlaceholderUsername(contextUsername)) {
        chessComContextUsername = contextUsername
      }
    })

    const injectContextUserIdProbe = () => {
      try {
        if (document.getElementById('__ch_context_user_probe__')) return
        const s = document.createElement('script')
        s.id = '__ch_context_user_probe__'
        s.src = chrome.runtime.getURL('context-userid-probe.js')
        ;(document.head || document.documentElement).appendChild(s)
      } catch (_) {}
    }

    injectContextUserIdProbe()
  }

  // =========================================================================
  //  SITE ADAPTERS — Chess.com & Lichess specific DOM interactions
  //  Each adapter implements the same interface. The active adapter is
  //  selected based on SITE and exposed through wrapper functions below.
  // =========================================================================

  // --- Chess.com Adapter ---
  const CHESSCOM = {
    findBoardEl() {
      for (const el of document.querySelectorAll('wc-chess-board')) {
        const root = el.shadowRoot ?? el
        if (root?.querySelector?.('.piece')) return el
      }
      return null
    },

    getFen(board) {
      if (!board) return null
      const root = board.shadowRoot ?? board
      const grid = Array.from({ length: 8 }, () => Array(8).fill(null))
      const pieceMap = new Map()

      for (const el of root.querySelectorAll('.piece')) {
        let piece = null, file = null, rank = null
        for (const c of el.classList) {
          if (/^[wb][prnbqk]$/.test(c)) piece = c
          const m = c.match(/^square-(\d)(\d)$/)
          if (m) { file = +m[1] - 1; rank = +m[2] - 1 }
        }
        if (piece && file !== null && rank !== null) {
          grid[rank][file] = piece[0] === 'w' ? piece[1].toUpperCase() : piece[1]
          pieceMap.set(`${file + 1}${rank + 1}`, piece[0])
        }
      }

      const rows = []
      for (let r = 7; r >= 0; r--) {
        let empty = 0, row = ''
        for (let f = 0; f < 8; f++) {
          const p = grid[r][f]
          if (!p) { empty++; continue }
          if (empty) { row += empty; empty = 0 }
          row += p
        }
        if (empty) row += empty
        rows.push(row || '8')
      }

      let turn = 'w'
      const bottomActive = document.querySelector('.clock-bottom')?.classList?.contains('clock-player-turn')
      const topActive = document.querySelector('.clock-top')?.classList?.contains('clock-player-turn')

      if (bottomActive === true || topActive === true) {
        const orientation = board.classList?.contains('flipped') ? 'black' : 'white'
        turn = bottomActive ? (orientation === 'white' ? 'w' : 'b') : (orientation === 'white' ? 'b' : 'w')
      } else {
        const highlights = root.querySelectorAll('.highlight')
        if (highlights.length >= 2) {
          for (const h of highlights) {
            for (const c of h.classList) {
              const m = c.match(/^square-(\d)(\d)$/)
              if (m) {
                const pieceColor = pieceMap.get(`${m[1]}${m[2]}`)
                if (pieceColor) { turn = pieceColor === 'w' ? 'b' : 'w'; break }
              }
            }
          }
        }
      }

      return `${rows.join('/')} ${turn} - - 0 1`
    },

    detectUsers() {
      try {
        const bottomUsername = normalizeDetectedUsername(
          document.querySelector('#board-layout-player-bottom [data-test-element="user-tagline-username"]')?.textContent
        )
        const topUsername = document.querySelector('#board-layout-player-top [data-test-element="user-tagline-username"]')?.textContent?.trim()
        const bottomAvatar = document.querySelector('#board-layout-player-bottom .user-tagline-avatar img')?.src
        const topAvatar = document.querySelector('#board-layout-player-top .user-tagline-avatar img')?.src

        if (bottomUsername && !isPlaceholderUsername(bottomUsername)) {
          if (!currentUser || currentUser.username !== bottomUsername) {
            currentUser = { username: bottomUsername, avatar: bottomAvatar }
            LOG.push(`User detected: ${bottomUsername}`)
          }
          if (topUsername && !isPlaceholderUsername(topUsername) && (!opponent || opponent.username !== topUsername)) {
            opponent = { username: topUsername, avatar: topAvatar }
            LOG.push(`Opponent detected: ${topUsername}`)
          }
          return true
        }

        // Fallback: detect username from any chess.com page (home, profile, nav, context)
        if (!currentUser || isPlaceholderUsername(currentUser.username)) {
          const pageUsername = pickFirstRealUsername(
            document.querySelector('.home-username-link')?.textContent,
            document.querySelector('.user-username-component')?.textContent,
            document.querySelector('.header-user-username')?.textContent,
            document.querySelector('[data-test-element="user-tagline-username"]')?.textContent,
            chessComContextUsername,
            document.body?.dataset?.user
          )
          if (pageUsername) {
            currentUser = { username: pageUsername, avatar: null }
            LOG.push(`User detected (from page): ${pageUsername}`)
            return true
          }
        }
        return currentUser && !isPlaceholderUsername(currentUser.username) ? true : null
      } catch (e) {
        LOG.push(`Error detecting user: ${e.message}`)
        return null
      }
    },

    detectUserColor(fen) {
      if (!fen) return null
      try {
        const bottomPlayerEl = document.querySelector('#board-layout-player-bottom')
        if (bottomPlayerEl) {
          const bottomHtml = bottomPlayerEl.innerHTML?.toLowerCase() || ''
          const bottomText = bottomPlayerEl.textContent?.toLowerCase() || ''
          if (bottomHtml.includes('user-tagline-black') || bottomText.includes(' black')) {
            if (userColor !== 'black') { userColor = 'black'; LOG.push(`User color: black (bottom player)`) }
            return userColor
          }
          if (bottomHtml.includes('user-tagline-white') || bottomText.includes(' white')) {
            if (userColor !== 'white') { userColor = 'white'; LOG.push(`User color: white (bottom player)`) }
            return userColor
          }
          const pieceIndicator = bottomPlayerEl.querySelector('[class*="piece"], .player-piece')
          if (pieceIndicator) {
            const pieceClass = pieceIndicator.className?.toLowerCase() || ''
            if (pieceClass.includes('black') || pieceClass.includes('-b-') || pieceClass.includes('bp')) {
              if (userColor !== 'black') { userColor = 'black'; LOG.push(`User color: black (piece indicator)`) }
              return userColor
            }
            if (pieceClass.includes('white') || pieceClass.includes('-w-') || pieceClass.includes('wp')) {
              if (userColor !== 'white') { userColor = 'white'; LOG.push(`User color: white (piece indicator)`) }
              return userColor
            }
          }
        }

        const board = findBoardEl()
        if (board) {
          const colorFromBoard = board.classList?.contains('flipped') ? 'black' : 'white'
          if (userColor !== colorFromBoard) { userColor = colorFromBoard; LOG.push(`User color: ${userColor} (board orientation)`) }
          return userColor
        }

        const bottomClockActive = document.querySelector('.clock-bottom')?.classList?.contains('clock-player-turn')
        const fenTurn = fen.split(' ')[1]
        if (bottomClockActive && fenTurn) {
          const newColor = fenTurn === 'w' ? 'white' : 'black'
          if (userColor !== newColor) { userColor = newColor; LOG.push(`User color: ${userColor} (clock+FEN)`) }
        }
        return userColor
      } catch (e) {
        LOG.push(`Error detecting color: ${e.message}`)
        return null
      }
    },

    isInActiveGame() {
      const url = window.location.href
      const gamePatterns = ['/game/live', '/play/online', '/play/computer', '/live#g=', '/play/']
      const isGameUrl = gamePatterns.some(p => url.includes(p))

      const board = findBoardEl()
      if (!board) return false
      const root = board.shadowRoot ?? board
      if (root.querySelectorAll('.piece').length < 2) return false
      if (isGameUrl) return true

      if (document.querySelectorAll('.clock-component').length >= 2) return true

      return document.querySelector('[data-cy="game-over-modal"]') === null &&
        (document.querySelector('.resign-button-component') !== null ||
         document.querySelector('[data-cy="resign"]') !== null ||
         document.querySelector('.draw-button-component') !== null)
    },

    getCurrentTurn(fen) {
      const bottomActive = document.querySelector('.clock-bottom')?.classList?.contains('clock-player-turn')
      const topActive = document.querySelector('.clock-top')?.classList?.contains('clock-player-turn')
      if (bottomActive === true || topActive === true) {
        const board = findBoardEl()
        const orientation = board?.classList?.contains('flipped') ? 'black' : 'white'
        const turn = bottomActive ? (orientation === 'white' ? 'w' : 'b') : (orientation === 'white' ? 'b' : 'w')
        STATE.lastTurn = turn
        return turn
      }
      const fenTurn = getTurnFromFen(fen)
      STATE.lastTurn = fenTurn
      return fenTurn
    },

    getLastMoveUci() {
      try {
        const board = STATE.board
        if (!board) return null
        const root = board.shadowRoot ?? board
        const highlights = root.querySelectorAll('.highlight')
        if (highlights.length >= 2) {
          const squares = []
          for (const h of highlights) {
            for (const c of h.classList) {
              const m = c.match(/^square-(\d)(\d)$/)
              if (m) {
                squares.push(String.fromCharCode(96 + parseInt(m[1])) + m[2])
              }
            }
          }
          if (squares.length >= 2) return squares[0] + squares[1]
        }
      } catch (e) { LOG.push(`Error getting last move: ${e.message}`) }
      return null
    },

    getUciHistory() {
      try {
        const selectors = [
          '#board-layout-sidebar [data-ply][data-uci]',
          '#board-layout-sidebar [data-uci]',
          '.move-list-wrapper [data-ply][data-uci]',
          '.move-list-wrapper [data-uci]',
          '.vertical-move-list [data-ply][data-uci]',
          '.vertical-move-list [data-uci]',
          '.move-node[data-ply][data-uci]',
          '[data-ply][data-uci]',
        ]
        const nodes = document.querySelectorAll(selectors.join(','))
        if (!nodes.length) return []

        const parsed = []
        let seq = 0
        for (const node of nodes) {
          const uci =
            normalizeUciMove(node?.getAttribute?.('data-uci')) ||
            normalizeUciMove(node?.dataset?.uci) ||
            normalizeUciMove(node?.getAttribute?.('data-move')) ||
            normalizeUciMove(node?.dataset?.move) ||
            null
          if (!uci) continue
          const plyRaw = node?.getAttribute?.('data-ply') || node?.dataset?.ply || ''
          const ply = Number.parseInt(String(plyRaw), 10)
          parsed.push({
            ply: Number.isFinite(ply) && ply > 0 ? ply : Number.MAX_SAFE_INTEGER,
            seq: seq++,
            uci,
          })
        }
        if (!parsed.length) return []

        parsed.sort((a, b) => a.ply - b.ply || a.seq - b.seq)
        const out = []
        const seenPly = new Set()
        for (const entry of parsed) {
          if (entry.ply !== Number.MAX_SAFE_INTEGER) {
            if (seenPly.has(entry.ply)) continue
            seenPly.add(entry.ply)
          }
          out.push(entry.uci)
          if (out.length >= 600) break
        }
        return out
      } catch (e) {
        LOG.push(`Error getting UCI history: ${e.message}`)
        return []
      }
    },

    getMoveNumFromDOM() {
      try {
        const moveNodes = document.querySelectorAll('.move-node, [data-ply]')
        if (moveNodes.length > 0) return Math.floor(moveNodes.length / 2) + 1

        const moveNumbers = document.querySelectorAll('.move-number, .move-timestamps .move')
        if (moveNumbers.length > 0) {
          const lastNum = moveNumbers[moveNumbers.length - 1]?.textContent?.match(/(\d+)/)
          if (lastNum) return parseInt(lastNum[1])
        }

        const verticalMoves = document.querySelectorAll('.vertical-move-list .move, .move-list-wrapper .move')
        if (verticalMoves.length > 0) return Math.floor(verticalMoves.length / 2) + 1
      } catch (e) { LOG.push(`Error getting move number: ${e.message}`) }
      return 1
    },

    isBoardFlipped(board) {
      return !!board?.classList?.contains('flipped')
    },

    getObserveTarget(board) {
      return board?.shadowRoot ?? board
    },

    async executeMove(uci, opts = {}) {
      if (!uci || uci.length < 4) return false
      const board = this.findBoardEl()
      if (!board) return false

      const fromSq = uci.slice(0, 2)
      const toSq = uci.slice(2, 4)
      const promotion = typeof opts.promotion === 'string' ? opts.promotion.toLowerCase() : null

      const getCoords = (sq) => {
        const file = sq.charCodeAt(0) - 96
        const rank = parseInt(sq[1])
        if (!Number.isFinite(file) || !Number.isFinite(rank)) return null
        const isFlipped = board.classList.contains('flipped')
        const rect = board.getBoundingClientRect()
        if (!rect.width) return null
        const sqSize = rect.width / 8
        let f = file, r = rank
        if (isFlipped) { f = 9 - f; r = 9 - r }
        return {
          x: rect.left + (f - 0.5) * sqSize,
          y: rect.top + (8.5 - r) * sqSize
        }
      }

      const dispatch = (type, coords) => {
        const el = board.shadowRoot?.elementFromPoint(coords.x, coords.y) || board
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: coords.x,
          clientY: coords.y,
          buttons: 1,
          button: 0,
          pointerId: 1,
          isPrimary: true
        }
        el.dispatchEvent(new PointerEvent('pointerdown', opts))
        el.dispatchEvent(new MouseEvent('mousedown', opts))
        el.dispatchEvent(new PointerEvent('pointerup', opts))
        el.dispatchEvent(new MouseEvent('mouseup', opts))
        el.dispatchEvent(new MouseEvent('click', opts))
      }

      const fromCoords = getCoords(fromSq)
      const toCoords = getCoords(toSq)
      if (!fromCoords || !toCoords) return false

      dispatch('down', fromCoords)
      await new Promise(r => setTimeout(r, 100 + Math.random() * 100))
      dispatch('down', toCoords)

      if (promotion && ['q', 'r', 'b', 'n'].includes(promotion)) {
        const fromRank = Number.parseInt(fromSq[1], 10)
        const toRank = Number.parseInt(toSq[1], 10)
        const color = toRank > fromRank ? 'w' : 'b'
        const targetClass = `${color}${promotion}`
        const clickPromotionPiece = (pieceEl) => {
          if (!pieceEl) return false
          const rect = pieceEl.getBoundingClientRect()
          const x = Math.floor(rect.left + rect.width / 2)
          const y = Math.floor(rect.top + rect.height / 2)
          const target = document.elementFromPoint(x, y) || pieceEl
          const opts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            buttons: 1,
            button: 0,
            pointerId: 1,
            isPrimary: true
          }
          try {
            target.dispatchEvent(new PointerEvent('pointerdown', opts))
            target.dispatchEvent(new MouseEvent('mousedown', opts))
            target.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }))
            target.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }))
            target.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }))
            return true
          } catch {
            try { pieceEl.click() } catch {}
            return false
          }
        }

        const deadline = Date.now() + 3500
        while (Date.now() < deadline) {
          const win = document.querySelector('.promotion-window.promotion-window--visible, .promotion-window--visible, .promotion-window')
          if (win) {
            const piece = win.querySelector(`.promotion-piece.${targetClass}`)
            if (piece) {
              clickPromotionPiece(piece)
              await new Promise(r => setTimeout(r, 60))
              if (!document.querySelector('.promotion-window--visible')) break
            }
          }
          await new Promise(r => setTimeout(r, 60))
        }
      }
    },
  }

  // --- Lichess Adapter ---
  const LICHESS = {
    findBoardEl() {
      const board = document.querySelector('cg-board')
      if (board && board.querySelector('piece')) return board
      return null
    },

    getFen(board) {
      if (!board) return null
      const container = board.closest('cg-container') || board.parentElement
      if (!container) return null
      const squareSize = container.getBoundingClientRect().width / 8
      if (!squareSize || squareSize < 5) return null

      const isBlack = !!board.closest('.cg-wrap')?.classList.contains('orientation-black')
      const grid = Array.from({ length: 8 }, () => Array(8).fill(null))
      const pieceMap = new Map()

      for (const el of board.querySelectorAll('piece')) {
        const classes = el.className.split(/\s+/)
        // Skip ghost/anim/dragging pieces (transient states during animation or user drag)
        if (classes.includes('ghost') || classes.includes('anim') || classes.includes('dragging')) continue
        let color = null, type = null
        for (const c of classes) {
          if (c === 'white' || c === 'black') color = c
          if (LICHESS_PIECE_MAP[c]) type = c
        }
        if (!color || !type) continue

        const transform = el.style.transform || ''
        const match = transform.match(/translate\(\s*([\d.]+)px\s*,\s*([\d.]+)px\s*\)/)
        if (!match) continue

        const px = parseFloat(match[1])
        const py = parseFloat(match[2])
        let file, rank
        if (isBlack) {
          file = 7 - Math.round(px / squareSize)
          rank = Math.round(py / squareSize)
        } else {
          file = Math.round(px / squareSize)
          rank = 7 - Math.round(py / squareSize)
        }
        if (file < 0 || file > 7 || rank < 0 || rank > 7) continue

        const fenChar = LICHESS_PIECE_MAP[type]
        grid[rank][file] = color === 'white' ? fenChar.toUpperCase() : fenChar
        pieceMap.set(`${file}${rank}`, color === 'white' ? 'w' : 'b')
      }

      const rows = []
      for (let r = 7; r >= 0; r--) {
        let empty = 0, row = ''
        for (let f = 0; f < 8; f++) {
          const p = grid[r][f]
          if (!p) { empty++; continue }
          if (empty) { row += empty; empty = 0 }
          row += p
        }
        if (empty) row += empty
        rows.push(row || '8')
      }

      // Turn detection from running clock
      let turn = 'w'
      const runningClock = document.querySelector('.rclock.running')
      const path = (window.location.pathname || '').toLowerCase()
      const isPuzzleLikePath =
        path.includes('/training') ||
        path.includes('/puzzle') ||
        path.includes('/streak') ||
        path.includes('/storm') ||
        path.includes('/racer')
      if (runningClock) {
        turn = runningClock.classList.contains('rclock-white') ? 'w' : 'b'
      } else {
        // Fallback: check last-move squares for piece color
        const lastMoveSquares = board.querySelectorAll('square.last-move')
        if (lastMoveSquares.length >= 2) {
          for (const lmSq of lastMoveSquares) {
            const t = lmSq.style.transform || ''
            const m = t.match(/translate\(\s*([\d.]+)px\s*,\s*([\d.]+)px\s*\)/)
            if (!m) continue
            let f, r
            if (isBlack) {
              f = 7 - Math.round(parseFloat(m[1]) / squareSize)
              r = Math.round(parseFloat(m[2]) / squareSize)
            } else {
              f = Math.round(parseFloat(m[1]) / squareSize)
              r = 7 - Math.round(parseFloat(m[2]) / squareSize)
            }
            const pc = pieceMap.get(`${f}${r}`)
            if (pc) { turn = pc === 'w' ? 'b' : 'w'; break }
          }
        }
        // No clock + no last-move signal: in puzzle-like modes, orientation is
        // the best available guess for side to move.
        if (!lastMoveSquares.length && isPuzzleLikePath) {
          turn = isBlack ? 'b' : 'w'
        }
      }

      return `${rows.join('/')} ${turn} - - 0 1`
    },

    detectUsers() {
      try {
        const username = document.body.dataset?.user || document.body.dataset?.username || null

        if (username && (!currentUser || currentUser.username !== username)) {
          currentUser = { username, avatar: null }
          LOG.push(`[Lichess] User detected: ${username}`)
        } else if (!username && !currentUser) {
          currentUser = { username: 'Guest', avatar: null }
          LOG.push('[Lichess] Guest mode detected (not logged in)')
        }

        // Find opponent from player elements (use <a> to avoid including rating text)
        const playerEls = document.querySelectorAll('.ruser .user-link, .ruser a, .game__meta__players .user-link')
        const selfName = username || currentUser?.username || ''
        for (const el of playerEls) {
          const name = el.textContent?.trim()
          if (name && name !== selfName && name.toLowerCase() !== 'anonymous' && (!opponent || opponent.username !== name)) {
            opponent = { username: name, avatar: null }
            LOG.push(`[Lichess] Opponent detected: ${name}`)
            break
          }
        }
        return true
      } catch (e) {
        LOG.push(`[Lichess] Error detecting user: ${e.message}`)
        return null
      }
    },

    detectUserColor(fen) {
      if (!fen) return null
      try {
        // On Lichess, board orientation = user color in live games
        const cgWrap = document.querySelector('.cg-wrap')
        if (cgWrap) {
          if (cgWrap.classList.contains('orientation-black')) {
            if (userColor !== 'black') { userColor = 'black'; LOG.push(`[Lichess] User color: black (orientation)`) }
            return userColor
          }
          if (cgWrap.classList.contains('orientation-white')) {
            if (userColor !== 'white') { userColor = 'white'; LOG.push(`[Lichess] User color: white (orientation)`) }
            return userColor
          }
        }

        // Fallback: bottom clock color
        const bottomClock = document.querySelector('.rclock-bottom')
        if (bottomClock) {
          const color = bottomClock.classList.contains('rclock-white') ? 'white' : 'black'
          if (userColor !== color) { userColor = color; LOG.push(`[Lichess] User color: ${color} (bottom clock)`) }
          return userColor
        }
        return userColor
      } catch (e) {
        LOG.push(`[Lichess] Error detecting color: ${e.message}`)
        return null
      }
    },

    isInActiveGame() {
      const board = document.querySelector('cg-board')
      if (!board || board.querySelectorAll('piece').length < 2) return false
      // Game-over status means game ended (checkmate, resign, draw, timeout)
      if (document.querySelector('.result-wrap, .status:is(.mate, .stalemate, .draw, .aborted, .timeout, .outoftime, .resign, .variantEnd)')) return false
      const path = (window.location.pathname || '').toLowerCase()
      const isPuzzleLikePath =
        path.includes('/training') ||
        path.includes('/puzzle') ||
        path.includes('/streak') ||
        path.includes('/storm') ||
        path.includes('/racer')
      if (isPuzzleLikePath) return true
      if (document.querySelector('.rclock.running')) return true
      if (document.querySelector('.rcontrols .resign, .rcontrols .draw-yes')) return true
      return !!document.querySelector('.cg-wrap.manipulable')
    },

    getCurrentTurn(fen) {
      const runningClock = document.querySelector('.rclock.running')
      if (runningClock) {
        const turn = runningClock.classList.contains('rclock-white') ? 'w' : 'b'
        STATE.lastTurn = turn
        return turn
      }
      const fenTurn = getTurnFromFen(fen)
      STATE.lastTurn = fenTurn
      return fenTurn
    },

    getLastMoveUci() {
      try {
        const board = STATE.board
        if (!board) return null
        const container = board.closest('cg-container') || board.parentElement
        if (!container) return null
        const squareSize = container.getBoundingClientRect().width / 8
        if (!squareSize || squareSize < 5) return null

        const isBlack = !!board.closest('.cg-wrap')?.classList.contains('orientation-black')
        const lastMoveSquares = board.querySelectorAll('square.last-move')
        if (lastMoveSquares.length < 2) return null

        // Build set of piece positions to determine from/to order
        // Filter ghost/anim/dragging to avoid false positives (ghost sits on from-square)
        const piecePositions = new Set()
        for (const p of board.querySelectorAll('piece')) {
          const cls = p.className
          if (cls.includes('ghost') || cls.includes('anim') || cls.includes('dragging')) continue
          const pt = p.style.transform || ''
          const pm = pt.match(/translate\(\s*([\d.]+)px\s*,\s*([\d.]+)px\s*\)/)
          if (pm) piecePositions.add(`${Math.round(parseFloat(pm[1]))}:${Math.round(parseFloat(pm[2]))}`)
        }

        let fromSq = null, toSq = null
        for (const sq of lastMoveSquares) {
          const t = sq.style.transform || ''
          const m = t.match(/translate\(\s*([\d.]+)px\s*,\s*([\d.]+)px\s*\)/)
          if (!m) continue
          const rawX = Math.round(parseFloat(m[1]))
          const rawY = Math.round(parseFloat(m[2]))
          let file, rank
          if (isBlack) {
            file = 7 - Math.round(parseFloat(m[1]) / squareSize)
            rank = Math.round(parseFloat(m[2]) / squareSize)
          } else {
            file = Math.round(parseFloat(m[1]) / squareSize)
            rank = 7 - Math.round(parseFloat(m[2]) / squareSize)
          }
          const notation = String.fromCharCode(97 + file) + (rank + 1)
          // The square WITH a piece on it is the destination (to)
          if (piecePositions.has(`${rawX}:${rawY}`)) {
            toSq = notation
          } else {
            fromSq = notation
          }
        }
        if (fromSq && toSq) return fromSq + toSq
      } catch (e) { LOG.push(`[Lichess] Error getting last move: ${e.message}`) }
      return null
    },

    getUciHistory() {
      try {
        const selectors = [
          '.tview2 move[p]',
          '.tview2 move[data-uci]',
          '.analyse__moves move[p]',
          '.analyse__moves move[data-uci]',
          'l4x kwdb[p]',
          'l4x kwdb[data-uci]',
          'kwdb[p]',
          'kwdb[data-uci]',
          'move[p]',
          'move[data-uci]',
        ]
        const nodes = document.querySelectorAll(selectors.join(','))
        if (!nodes.length) return []

        const parsed = []
        let seq = 0
        for (const node of nodes) {
          const uci =
            normalizeUciMove(node?.getAttribute?.('data-uci')) ||
            normalizeUciMove(node?.dataset?.uci) ||
            normalizeUciMove(node?.getAttribute?.('p')) ||
            normalizeUciMove(node?.dataset?.p) ||
            normalizeUciMove(node?.getAttribute?.('data-move')) ||
            normalizeUciMove(node?.dataset?.move) ||
            null
          if (!uci) continue
          const plyRaw =
            node?.getAttribute?.('data-ply') ||
            node?.dataset?.ply ||
            node?.getAttribute?.('ply') ||
            ''
          const ply = Number.parseInt(String(plyRaw), 10)
          parsed.push({
            ply: Number.isFinite(ply) && ply > 0 ? ply : Number.MAX_SAFE_INTEGER,
            seq: seq++,
            uci,
          })
        }
        if (!parsed.length) return []

        parsed.sort((a, b) => a.ply - b.ply || a.seq - b.seq)
        const out = []
        const seenPly = new Set()
        for (const entry of parsed) {
          if (entry.ply !== Number.MAX_SAFE_INTEGER) {
            if (seenPly.has(entry.ply)) continue
            seenPly.add(entry.ply)
          }
          if (out[out.length - 1] === entry.uci) continue
          out.push(entry.uci)
          if (out.length >= 600) break
        }
        return out
      } catch (e) {
        LOG.push(`[Lichess] Error getting UCI history: ${e.message}`)
        return []
      }
    },

    getMoveNumFromDOM() {
      try {
        // Live game: <kwdb> ARE the move elements (inside <l4x>)
        const kwdbMoves = document.querySelectorAll('l4x kwdb')
        if (kwdbMoves.length > 0) return Math.floor(kwdbMoves.length / 2) + 1

        // Live game: <i5z> are the move number indices
        const i5zNodes = document.querySelectorAll('i5z')
        if (i5zNodes.length > 0) {
          const last = i5zNodes[i5zNodes.length - 1]?.textContent?.match(/(\d+)/)
          if (last) return parseInt(last[1])
        }

        // Analysis view: <move> elements inside .tview2
        const analysisMoves = document.querySelectorAll('.tview2 move')
        if (analysisMoves.length > 0) return Math.floor(analysisMoves.length / 2) + 1

        // Broad fallback: any <kwdb> on the page
        const allKwdb = document.querySelectorAll('kwdb')
        if (allKwdb.length > 0) return Math.floor(allKwdb.length / 2) + 1
      } catch (e) { LOG.push(`[Lichess] Error getting move number: ${e.message}`) }
      return 1
    },

    isBoardFlipped(board) {
      return !!board?.closest('.cg-wrap')?.classList.contains('orientation-black')
    },

    getObserveTarget(board) {
      return board
    },

    async executeMove(uci, opts = {}) {
      if (!uci || uci.length < 4) return false
      const promotion = typeof opts.promotion === 'string' ? opts.promotion.toLowerCase() : null
      return await requestLichessBridgeMove(uci, promotion, 2600)
    },
  }

  // --- Active Adapter (selected by current site) ---
  const ADAPTER = SITE === 'lichess' ? LICHESS : CHESSCOM

  // --- Opening Book (common openings) ---
  const OPENINGS = {
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': "King's Pawn Opening",
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b': "Queen's Pawn Opening",
    'rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b': 'English Opening',
    'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b': 'Réti Opening',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w': "King's Pawn Game",
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b': "King's Knight Opening",
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w': 'Italian Game / Spanish',
    'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b': 'Ruy Lopez',
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b': 'Italian Game',
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w': 'Two Knights Defense',
    'r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w': 'Berlin Defense',
    'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w': 'French Defense',
    'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w': 'Caro-Kann Defense',
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w': 'Sicilian Defense',
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b': 'Sicilian Defense: Open',
    'rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w': 'Sicilian: Old Sicilian',
    'rnbqkbnr/pp2pppp/3p4/8/3pP3/5N2/PPP2PPP/RNBQKB1R w': 'Sicilian: Open Game',
    'r1bqkbnr/pp2pppp/2np4/8/3pP3/5N2/PPP2PPP/RNBQKB1R w': 'Sicilian: Najdorf/Dragon',
    'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w': "Queen's Gambit",
    'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b': "Queen's Gambit",
    'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w': "Queen's Gambit Declined",
    'rnbqkbnr/ppp2ppp/8/3pp3/2PP4/8/PP2PPPP/RNBQKBNR w': "Queen's Gambit Accepted",
    'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w': 'Indian Defense',
    'rnbqkb1r/pppppppp/5n2/8/2P5/8/PP1PPPPP/RNBQKBNR w': 'Indian Defense',
    'rnbqkb1r/pppppp1p/5np1/8/2P5/8/PP1PPPPP/RNBQKBNR w': "King's Indian",
    'rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR b': "King's Indian Defense",
    'rnbqk2r/ppppppbp/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR b': "King's Indian: Main Line",
    'rnbqkb1r/p1pppppp/1p3n2/8/2P5/8/PP1PPPPP/RNBQKBNR w': 'English: Anglo-Indian',
    'rnbqkb1r/pppp1ppp/4pn2/8/2P5/8/PP1PPPPP/RNBQKBNR w': 'English: Agincourt',
    'rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/R1BQKBNR b': 'Van Geet Opening',
    'rnbqkbnr/pppppppp/8/8/8/1P6/P1PPPPPP/RNBQKBNR b': 'Nimzowitsch-Larsen',
    'rnbqkbnr/pppppppp/8/8/8/6P1/PPPPPP1P/RNBQKBNR b': "King's Fianchetto",
  }

  const getOpeningName = (fen) => {
    if (!fen) return null
    const key = fen.split(' ').slice(0, 2).join(' ')
    return OPENINGS[key] || null
  }

  const toNonNegativeInt = (value) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  }
  const parseUsageFromPayload = (data) => ({
    requestsToday:
      toNonNegativeInt(data?.requestsToday) ??
      toNonNegativeInt(data?.suggestionsToday) ??
      toNonNegativeInt(data?.requestsUsedToday) ??
      toNonNegativeInt(data?.usageToday),
    dailyLimit:
      toNonNegativeInt(data?.dailyLimit) ??
      toNonNegativeInt(data?.requestsDailyLimit) ??
      toNonNegativeInt(data?.suggestionsDailyLimit),
    requestsRemaining:
      toNonNegativeInt(data?.requestsRemaining) ??
      toNonNegativeInt(data?.suggestionsRemaining) ??
      toNonNegativeInt(data?.dailyRemaining),
  })

  // --- Subscription State (managed by backend, cached in chrome.storage) ---
  const SUB = {
    isActive: true,   // optimistic default until status check completes
    isPaid: true,
    trialRemaining: 0,
    expiresAt: null,
    requestsToday: 0,
    dailyLimit: null,
    requestsRemaining: null,
    ready: true,      // true after first status check
    recoveryRequired: false,
  }

  const readCachedStatus = async () => ({})

  const syncUsageState = (data = null) => {
    const usage = parseUsageFromPayload(data)
    const premium = SUB.isActive === true && SUB.isPaid === true
    if (usage.requestsToday !== null) {
      SUB.requestsToday = usage.requestsToday
    }

    if (premium) {
      SUB.dailyLimit = null
      SUB.requestsRemaining = null
      return
    }

    if (usage.dailyLimit !== null) {
      SUB.dailyLimit = usage.dailyLimit
    }
    if (usage.requestsRemaining !== null) {
      SUB.requestsRemaining = usage.requestsRemaining
    }
  }

  const getUsageBadgeText = () => {
    return ''
  }

  const getUsageLimitState = () => {
    return { isPremium: true, limitReached: false, text: '' }
  }

  const parseTelemetryInt = (value) => {
    const n = Number.parseInt(String(value), 10)
    return Number.isFinite(n) ? n : null
  }
  const telemetryClamp = (value, min, max) => {
    const n = Number.isFinite(value) ? Math.floor(value) : min
    return Math.max(min, Math.min(max, n))
  }
  const telemetryValueKey = (prefix, value, { min = 0, max = 999 } = {}) => {
    const parsed = parseTelemetryInt(value)
    if (parsed == null) return `${prefix}_invalid`
    return `${prefix}_${telemetryClamp(parsed, min, max)}`
  }

  const queueFeatureUsage = (_counterKey = null, _opts = {}) => {}
  const flushFeatureUsage = async () => {}
  let sharedReviewEngineHost = null
  const QUALITY_ICON_SVG = {
    brilliant: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.3L18 9.1l-4.2 1.7L12 15l-1.8-4.2L6 9.1l4.2-1.8L12 3z"></path><path d="M5 5l1.2 1.2M19 5l-1.2 1.2M5 19l1.2-1.2M19 19l-1.2-1.2M12 1.8v2.1M12 20.1v2.1M1.8 12h2.1M20.1 12h2.1"></path></svg>',
    great: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.2 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.2z"></path></svg>',
    best: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.2 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.2z"></path></svg>',
    excellent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 20H6.3c-.8 0-1.3-.6-1.3-1.3v-7.1c0-.8.5-1.3 1.3-1.3h2.9V20z"></path><path d="M11 20h5.1c1.2 0 2.2-.8 2.5-2l1-4.7c.3-1.3-.7-2.5-2-2.5h-3.8l.5-3.1V6.8c0-1-.8-1.8-1.8-1.8h-.4L9.8 10v10H11z"></path></svg>',
    good: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.7 16.8L5.9 13l1.7-1.7 2.1 2.1 6.7-6.7 1.7 1.7-8.4 8.4z"></path></svg>',
    inaccuracy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 9.1a2.7 2.7 0 1 1 5.4 0c0 1.6-1.3 2.3-2.1 2.9-.7.5-1 .8-1 1.7v.7"></path><circle cx="12" cy="17.6" r="1.2"></circle></svg>',
    mistake: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 9.1a2.7 2.7 0 1 1 5.4 0c0 1.6-1.3 2.3-2.1 2.9-.7.5-1 .8-1 1.7v.7"></path><circle cx="12" cy="17.6" r="1.2"></circle></svg>',
    blunder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.8 9.1a2.6 2.6 0 1 1 5.2 0c0 1.4-1.1 2.1-1.8 2.6-.6.5-.9.8-.9 1.6v.7"></path><circle cx="10.4" cy="17.6" r="1.1"></circle><path d="M13.5 9.1a2.6 2.6 0 1 1 5.2 0c0 1.4-1.1 2.1-1.8 2.6-.6.5-.9.8-.9 1.6v.7"></path><circle cx="16.1" cy="17.6" r="1.1"></circle></svg>',
  }
  const getReviewEngineHost = () => {
    if (!sharedReviewEngineHost) sharedReviewEngineHost = new EngineHostClient('review')
    return sharedReviewEngineHost
  }
  const normalizeReviewLabel = (value) => {
    const raw = String(value || '').trim().toLowerCase()
    const map = {
      brilliant: 'Brilliant',
      great: 'Great',
      best: 'Best',
      excellent: 'Excellent',
      good: 'Good',
      inaccuracy: 'Inaccuracy',
      mistake: 'Mistake',
      blunder: 'Blunder',
    }
    return map[raw] || 'Good'
  }
  const getMoverScoreCp = (scoreAfter) => {
    const cp = scoreToCp(scoreAfter)
    return -cp
  }
  const classifyMoveQuality = ({ bestUci, playedUci, bestScoreCp, playedScoreCp, lines = [], fenBefore = '' }) => {
    const safeBest = Number.isFinite(bestScoreCp) ? bestScoreCp : 0
    const safePlayed = Number.isFinite(playedScoreCp) ? playedScoreCp : safeBest
    const loss = Math.max(0, safeBest - safePlayed)
    const secondBestScore = lines.length > 1 ? scoreToCp(lines[1]?.score) : null
    const secondGap = Number.isFinite(secondBestScore) ? safeBest - secondBestScore : 0
    const facts = getMoveFacts(fenBefore, playedUci)
    const exactBest = !!playedUci && !!bestUci && playedUci === bestUci

    if (exactBest) {
      const isSacLike =
        facts &&
        ['n', 'b', 'r', 'q'].includes(facts.pieceKey) &&
        !facts.isCapture &&
        secondGap >= 180 &&
        safePlayed >= safeBest - 10
      if (isSacLike) return { classification: 'brilliant', label: 'Brilliant' }
      if (secondGap >= 130) return { classification: 'great', label: 'Great' }
      return { classification: 'best', label: 'Best' }
    }
    if (loss <= 20) return { classification: 'excellent', label: 'Excellent' }
    if (loss <= 60) return { classification: 'good', label: 'Good' }
    if (loss <= 140) return { classification: 'inaccuracy', label: 'Inaccuracy' }
    if (loss <= 280) return { classification: 'mistake', label: 'Mistake' }
    return { classification: 'blunder', label: 'Blunder' }
  }
  const ensureMoveReviewBadgeStyle = () => {
    const styleId = '__ch_move_review_badges__'
    if (document.getElementById(styleId)) return
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .ch-move-review-board-badge {
        position: fixed;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 1000010;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        box-shadow: 0 2px 8px rgba(0,0,0,.28);
        border: 2px solid rgba(255,255,255,.16);
      }
      .ch-move-review-board-badge svg { width: 14px; height: 14px; display: block; }
      .ch-move-review-board-badge svg path,
      .ch-move-review-board-badge svg circle { fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .ch-move-review-board-badge.best svg path,
      .ch-move-review-board-badge.good svg path,
      .ch-move-review-board-badge.excellent svg path,
      .ch-move-review-board-badge.great svg path { fill: #fff; stroke: none; }
      .ch-move-review-board-badge.brilliant { background: #22a8a4; }
      .ch-move-review-board-badge.great { background: #14b8a6; }
      .ch-move-review-board-badge.best { background: #8fb93e; }
      .ch-move-review-board-badge.excellent { background: #8b19ff; }
      .ch-move-review-board-badge.good { background: #2d74db; }
      .ch-move-review-board-badge.inaccuracy { background: #e2b21e; }
      .ch-move-review-board-badge.mistake { background: #ee7d3d; }
      .ch-move-review-board-badge.blunder { background: #e83e64; }
    `
    ;(document.head || document.documentElement).appendChild(style)
  }
  const getBoardSquareViewportPoint = (board, square, { xRatio = 0.78, yRatio = 0.22 } = {}) => {
    if (!board || typeof square !== 'string' || !/^[a-h][1-8]$/.test(square)) return null
    const rect = board.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const sq = rect.width / 8
    const flip = ADAPTER.isBoardFlipped(board)
    const file = square.charCodeAt(0) - 97
    const rank = Number.parseInt(square[1], 10) - 1
    if (!Number.isFinite(file) || !Number.isFinite(rank)) return null
    const left = rect.left + (flip ? 7 - file : file) * sq
    const top = rect.top + (flip ? rank : 7 - rank) * sq
    return {
      x: left + sq * xRatio,
      y: top + sq * yRatio,
      size: sq,
    }
  }
  const clearMoveReviewBadges = () => {
    try {
      document.querySelectorAll('.ch-move-review-board-badge').forEach((node) => node.remove())
    } catch {}
  }
  const renderMoveReviewBadges = () => {
    ensureMoveReviewBadgeStyle()
    clearMoveReviewBadges()
    if (!STATE?.analyzePlayerMoves || !STATE.board || !STATE.moveReviewByPly?.size) return
    const lastPly = Math.max(...STATE.moveReviewByPly.keys())
    if (!Number.isFinite(lastPly)) return
    const entry = STATE.moveReviewByPly.get(lastPly)
    const move = normalizeUciMove(entry?.uci)
    if (!entry || !move) return
    const point = getBoardSquareViewportPoint(STATE.board, move.slice(2, 4))
    if (!point) return
    const badge = document.createElement('div')
    badge.className = `ch-move-review-board-badge ${entry.classification || 'good'}`
    badge.setAttribute(MARKER, '')
    badge.innerHTML = QUALITY_ICON_SVG[entry.classification] || QUALITY_ICON_SVG.good
    badge.title = `${entry.moveLabel || entry.uci || ''}${entry.label ? ` - ${normalizeReviewLabel(entry.label)}` : ''}`
    badge.style.left = `${point.x}px`
    badge.style.top = `${point.y}px`
    document.body.appendChild(badge)
  }
  const analyzePlayerMoveEvent = async ({ fenBefore, fenAfter, moveUci = null, ply = null }) => {
    try {
      if (!STATE?.analyzePlayerMoves || !fenBefore || !fenAfter) return
      const history = getUciHistoryFromDom()
      const playedMove = normalizeUciMove(moveUci) || history[history.length - 1] || getLastMoveFromBoard()
      if (!playedMove) return
      const currentPly =
        Math.max(
          Number.isFinite(ply) && ply > 0 ? ply : 0,
          history.length || 0,
          (STATE.moveReviewByPly?.size || 0) + 1
        ) || null
      const sig = `${currentPly || '?'}|${fenBefore}|${fenAfter}|${playedMove}`
      if (STATE.lastAnalyzedMoveSig === sig) return
      STATE.lastAnalyzedMoveSig = sig

      const reviewHost = getReviewEngineHost()
      const beforeResp = await reviewHost.analyze(fenBefore, {
        depth: 10,
        multipv: 3,
        timeoutMs: 5000,
        styleMode: 'default',
      })
      const afterResp = await reviewHost.analyze(fenAfter, {
        depth: 10,
        multipv: 1,
        timeoutMs: 5000,
        styleMode: 'default',
      })
      if (!beforeResp?.ok || !afterResp?.ok) return

      const lines = Array.isArray(beforeResp.lines) ? beforeResp.lines : []
      const bestLine = lines.find((line) => getMoveUci(line)) || beforeResp
      const bestUci = normalizeUciMove(getMoveUci(bestLine))
      const bestScoreCp = scoreToCp(bestLine?.score || beforeResp?.score)
      const playedScoreCp = getMoverScoreCp(afterResp?.score)
      const quality = classifyMoveQuality({
        bestUci,
        playedUci: playedMove,
        bestScoreCp,
        playedScoreCp,
        lines,
        fenBefore,
      })
      const moveLabel = formatUciForDisplay(playedMove, fenBefore)

      if (!STATE.moveReviewByPly) STATE.moveReviewByPly = new Map()
      if (currentPly) {
        STATE.moveReviewByPly.set(currentPly, {
          uci: playedMove,
          moveLabel,
          classification: quality.classification,
          label: quality.label,
          fenAfter,
        })
      }

      STATE.moveReviewFlashText = `${moveLabel}: ${quality.label}`
      STATE.moveReviewFlashKind = quality.classification
      STATE.moveReviewFlashUntil = Date.now() + 3200
      STATE.moveReviewPinnedText = `${moveLabel} - ${quality.label}`
      STATE.moveReviewPinnedKind = quality.classification
      STATE.moveReviewPinnedAt = Date.now()
      renderMoveReviewBadges()

      if (STATE.ui) {
        setUI({
          status: '',
          type: '',
          move: STATE.ui.querySelector('[data-move]')?.textContent || '...',
          evalStr: STATE.lastEval || '',
          score: STATE.lastScore || null,
          scoreFen: fenAfter,
        })
      }
    } catch (error) {
      logEvent('Engine', 'analyze:error', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const tryAnalyzePlayedMove = ({ fenBefore, fenAfter, attempt = 0 }) => {
    if (!fenBefore || !fenAfter || !STATE?.analyzePlayerMoves) return
    const history = getUciHistoryFromDom()
    const playedUci = history[history.length - 1] || getLastMoveFromBoard()
    const ply = history.length || null
    if (!playedUci && attempt < 2) {
      setTimeout(() => {
        tryAnalyzePlayedMove({ fenBefore, fenAfter, attempt: attempt + 1 })
      }, 250 * (attempt + 1))
      return
    }
    if (playedUci || attempt === 0) {
      analyzePlayerMoveEvent({
        fenBefore,
        fenAfter,
        moveUci: playedUci || null,
        ply,
      })
    }
  }

  const getNextUtcResetMs = () => {
    const now = new Date()
    const nextUtcMidnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 0, 0
    )
    return Math.max(0, nextUtcMidnight - now.getTime())
  }

  const formatResetCountdown = () => {
    const ms = getNextUtcResetMs()
    const totalMinutes = Math.max(0, Math.ceil(ms / 60000))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours <= 0) return `Resets in ${minutes}m`
    if (minutes <= 0) return `Resets in ${hours}h`
    return `Resets in ${hours}h ${minutes}m`
  }

  const formatResetClock = () => {
    const ms = getNextUtcResetMs()
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
    const ss = String(totalSeconds % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }

  const updateSubState = (data) => {
    if (!data) return
    SUB.isActive = true
    SUB.isPaid = true
    if (typeof data.trialRemaining === 'number') SUB.trialRemaining = data.trialRemaining
    if (data.expiresAt !== undefined) SUB.expiresAt = data.expiresAt
    syncUsageState(data)
    SUB.recoveryRequired = false
    SUB.ready = true
    enforcePlanRestrictions({ schedule: false })
  }

  const hasPremiumAccess = () => true
  const getDepthMin = () => 1
  const getDepthLimit = () => PREMIUM_MAX_DEPTH
  const getLinesLimit = () => PREMIUM_MAX_LINES
  const getDepthOptionsHtml = () =>
    Array.from({ length: PREMIUM_MAX_DEPTH }, (_, idx) => {
      const value = idx + 1
      const selected = STATE.depth === value ? ' selected' : ''
      return `<option value="${value}"${selected}>${value}</option>`
    }).join('')

  const isPromoActive = () => Date.now() < PROMO_END_MS

  const getPromoCountdown = () => {
    const diff = PROMO_END_MS - Date.now()
    if (diff <= 0) return null
    const d = Math.floor(diff / 86400000)
    const h = Math.floor((diff % 86400000) / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    if (d > 0) return `${d}d ${h}h ${m}m`
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }
  const normalizeStyleMode = (value, fallback = 'default') => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return STYLE_MODE_VALUES.has(normalized) ? normalized : fallback
  }
  const clampStyleModeByPlan = (value, fallback = 'default') => {
    const normalized = normalizeStyleMode(value, fallback)
    return normalized
  }
  const getStyleOptionsHtml = () =>
    STYLE_MODE_OPTIONS.map((option) => {
      const selected = STATE.styleMode === option.value ? ' selected' : ''
      return `<option value="${option.value}"${selected}>${option.label}</option>`
    }).join('')

  const clampDepthByPlan = (value, fallback = 6) => {
    const parsed = Number.parseInt(value, 10)
    const base = Number.isFinite(parsed) ? parsed : fallback
    return Math.min(getDepthLimit(), Math.max(getDepthMin(), base))
  }

  const clampLinesByPlan = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10)
    const base = Number.isFinite(parsed) ? parsed : fallback
    return Math.min(getLinesLimit(), Math.max(1, base))
  }

  const showPremiumLockTooltip = (selector) => {
    if (!STATE.ui) return
    const lockEl = STATE.ui.querySelector(selector)
    if (!lockEl || lockEl.classList.contains('hidden')) return
    lockEl.classList.add('show-tooltip')
    if (lockEl.__hideTooltipTimer) clearTimeout(lockEl.__hideTooltipTimer)
    lockEl.__hideTooltipTimer = setTimeout(() => {
      lockEl.classList.remove('show-tooltip')
    }, 1800)
  }

  const disableAutoDelay = ({ syncUi = true } = {}) => {
    let changed = false
    if (STATE.autoDelayMin !== 0) {
      STATE.autoDelayMin = 0
      changed = true
    }
    if (STATE.autoDelayMax !== 0) {
      STATE.autoDelayMax = 0
      changed = true
    }
    if (changed) {
      try {
        localStorage.setItem(STORAGE.autoDelayMin, '0')
        localStorage.setItem(STORAGE.autoDelayMax, '0')
      } catch {}
    }
    if (syncUi && STATE.ui) {
      const minInput = STATE.ui.querySelector('[data-delay-min]')
      const maxInput = STATE.ui.querySelector('[data-delay-max]')
      if (minInput) minInput.value = '0'
      if (maxInput) maxInput.value = '0'
    }
    return changed
  }

  const syncAutoDelayControls = () => {
    if (!STATE.ui) return
    const enabled = !!STATE.autoPlay
    const row = STATE.ui.querySelector('[data-auto-delay-row]')
    if (row) row.style.display = enabled ? 'flex' : 'none'
    const minInput = STATE.ui.querySelector('[data-delay-min]')
    const maxInput = STATE.ui.querySelector('[data-delay-max]')
    if (minInput) minInput.disabled = !enabled
    if (maxInput) maxInput.disabled = !enabled
    if (!enabled) disableAutoDelay({ syncUi: true })
  }

  const syncPlanControls = () => {
    if (!STATE.ui) return
    const premium = true

    const depthInput = STATE.ui.querySelector('[data-depth]')
    if (depthInput) {
      const minDepth = getDepthMin()
      const maxDepth = getDepthLimit()
      const nextValue = Math.min(maxDepth, Math.max(minDepth, parseInt(depthInput.value, 10) || 6))
      if (depthInput.value !== String(nextValue)) depthInput.value = String(nextValue)
      depthInput.querySelectorAll('option').forEach((option) => {
        option.disabled = false
      })
    }

    const depthLock = STATE.ui.querySelector('[data-depth-lock]')
    if (depthLock) depthLock.classList.add('hidden')

    const linesSelect = STATE.ui.querySelector('[data-lines]')
    if (linesSelect) {
      linesSelect.querySelectorAll('option').forEach((option) => {
        option.disabled = false
      })
      const v = clampLinesByPlan(linesSelect.value, 1)
      if (linesSelect.value !== String(v)) linesSelect.value = String(v)
    }

    const linesLock = STATE.ui.querySelector('[data-lines-lock]')
    if (linesLock) linesLock.classList.add('hidden')

    const skipToggle = STATE.ui.querySelector('[data-skip]')
    if (skipToggle) {
      skipToggle.classList.remove('locked')
      skipToggle.setAttribute('aria-disabled', 'false')
    }

    const enemyLock = STATE.ui.querySelector('[data-enemy-lock]')
    if (enemyLock) enemyLock.classList.add('hidden')

    const analyzeToggle = STATE.ui.querySelector('[data-analyze]')
    if (analyzeToggle) {
      analyzeToggle.classList.toggle('on', !!STATE.analyzePlayerMoves)
      analyzeToggle.classList.remove('locked')
      analyzeToggle.setAttribute('aria-disabled', 'false')
    }
    const analyzeLock = STATE.ui.querySelector('[data-analyze-lock]')
    if (analyzeLock) analyzeLock.classList.add('hidden')

    const styleSelect = STATE.ui.querySelector('[data-style-mode]')
    if (styleSelect) {
      styleSelect.value = clampStyleModeByPlan(STATE.styleMode, 'default')
      styleSelect.querySelectorAll('option').forEach((option) => {
        option.disabled = false
      })
    }
    const styleLock = STATE.ui.querySelector('[data-style-lock]')
    if (styleLock) styleLock.classList.add('hidden')

    const autoToggle = STATE.ui.querySelector('[data-auto]')
    if (autoToggle) autoToggle.classList.toggle('on', !!STATE.autoPlay)

    const hideToggle = STATE.ui.querySelector('[data-hide]')
    if (hideToggle) hideToggle.classList.toggle('on', !!STATE.hideSuggestion)

    syncAutoDelayControls()
  }

  const enforcePlanRestrictions = ({ schedule = false } = {}) => {
    let changed = false

    const nextDepth = clampDepthByPlan(STATE.depth, 6)
    if (nextDepth !== STATE.depth) {
      STATE.depth = nextDepth
      try { localStorage.setItem(STORAGE.depth, nextDepth) } catch {}
      changed = true
    }

    const nextLines = clampLinesByPlan(STATE.lines, 1)
    if (nextLines !== STATE.lines) {
      STATE.lines = nextLines
      try { localStorage.setItem(STORAGE.lines, nextLines) } catch {}
      changed = true
    }

    const nextStyleMode = clampStyleModeByPlan(STATE.styleMode, 'default')
    if (nextStyleMode !== STATE.styleMode) {
      STATE.styleMode = nextStyleMode
      try { localStorage.setItem(STORAGE.styleMode, nextStyleMode) } catch {}
      changed = true
    }

    if (STATE.hideSuggestion && STATE.autoPlay) {
      STATE.autoPlay = false
      try { localStorage.setItem(STORAGE.autoPlay, '0') } catch {}
      disableAutoDelay({ syncUi: false })
      changed = true
    }

    if (STATE.wizardChess) {
      STATE.wizardChess = false
      try { localStorage.setItem(STORAGE.wizardChess, '0') } catch {}
      applyWizardChess()
      changed = true
    }

    if (!STATE.autoPlay && disableAutoDelay({ syncUi: false })) {
      changed = true
    }

    syncPlanControls()

    if (changed) {
      invalidate()
      if (schedule) scheduleUpdate()
    }

    return changed
  }

  const getPlatformUserData = () => {
    if (SITE === 'chesscom') {
      try {
        const bodyData = document.body?.dataset
        // Try multiple selectors: in-game, home page, nav, profile
        const username = pickFirstRealUsername(
          document.querySelector('#board-layout-player-bottom [data-test-element="user-tagline-username"]')?.textContent,
          document.querySelector('.home-username-link')?.textContent,
          document.querySelector('.user-username-component')?.textContent,
          document.querySelector('.header-user-username')?.textContent,
          document.querySelector('[data-test-element="user-tagline-username"]')?.textContent,
          chessComContextUsername,
          bodyData?.user,
          currentUser?.username
        )

        // Country detection: meta tag or navigator.language
        const lang = (navigator.language || '').split('-')
        const country = lang[1]?.toUpperCase() || (lang[0] === 'pt' ? 'BR' : null)

        return {
          platform: 'chess.com',
          platformUserId: chessComContextUserId || username || null,
          username: username || null,
          country: country,
          rating: null,
        }
      } catch { return { platform: 'chess.com' } }
    }
    // Lichess
    try {
      const user = document.body?.dataset?.user || document.body?.dataset?.username || null
      const lang = (navigator.language || '').split('-')
      const country = lang[1]?.toUpperCase() || (lang[0] === 'pt' ? 'BR' : null)
      return {
        platform: 'lichess',
        platformUserId: user || null,
        username: user || null,
        country: country,
        rating: null,
      }
    } catch { return { platform: 'lichess' } }
  }

  const initSubscription = async () => {
    try {
      const stored = await readCachedStatus()
      if (stored?._ch_status) updateSubState(stored._ch_status)
      else updateSubState({ isActive: true, isPaid: true })
      const currentData = getPlatformUserData()
      lastRegisteredUsername = currentData?.username || lastRegisteredUsername
      LOG.push('[Sub] Local-only mode active')
    } catch (e) {
      LOG.push(`[Sub] Init error: ${e.message}`)
      updateSubState({ isActive: true, isPaid: true })
    }
    updateFreemiumBanner()
  }

  const openCheckout = async (opts = {}) => {
    return null
  }

  const openCheckoutLegacy = async (_opts = {}) => null

  const updateFreemiumBanner = () => {
    if (!STATE.ui) return
    const banner = STATE.ui.querySelector('[data-freemium]')
    if (!banner) return
    const bannerBtn = banner.querySelector('[data-subscribe-banner]')
    if (bannerBtn) bannerBtn.style.display = 'none'
    banner.style.display = 'none'
    return
  }

  const updateFreemiumBannerLegacy = () => null

  // --- Depth to ELO mapping (heuristic estimate) ---
  // There is no official fixed "depth => Elo" conversion in Stockfish.
  // These ranges are conservative estimates tuned from Lichess/fishnet level profiles.
  const DEPTH_ELO_RANGES = {
    1: { min: 1200, max: 1500 },
    2: { min: 1300, max: 1550 },
    3: { min: 1350, max: 1650 },
    4: { min: 1450, max: 1700 },
    5: { min: 1500, max: 1800 },
    6: { min: 1600, max: 1850 },
    7: { min: 1650, max: 1950 },
    8: { min: 1750, max: 2050 },
    9: { min: 1800, max: 2100 },
    10: { min: 1900, max: 2200 },
    11: { min: 1950, max: 2250 },
    12: { min: 2050, max: 2350 },
  }
  const depthToElo = (depth) => {
    const d = Math.max(1, Math.min(12, parseInt(depth, 10) || 1))
    const range = DEPTH_ELO_RANGES[d] || DEPTH_ELO_RANGES[12]
    return {
      min: range.min,
      max: range.max,
      label: `${range.min}-${range.max}`,
    }
  }

  // --- User Detection (CSP-safe, no script injection) ---
  let currentUser = null
  let opponent = null
  let userColor = null
  let lastRegisteredUsername = null

  const detectUserFromDOM = () => ADAPTER.detectUsers()

  const detectUserColor = (fen) => ADAPTER.detectUserColor(fen)

  const isInActiveGame = () => ADAPTER.isInActiveGame()

  // --- Overlay (Canvas externo) ---
  const canvasLayers = []
  const ctxLayers = []
  const canvasId = CANVAS_PREFIX
  let lastCanvasSize = { w: 0, h: 0, dpr: 0 }

  const getViewportSize = () => {
    return {
      w: document.documentElement.clientWidth || window.innerWidth,
      h: document.documentElement.clientHeight || window.innerHeight,
      dpr: window.devicePixelRatio || 1
    }
  }

  const ensureCanvasLayer = (idx) => {
    const existing = canvasLayers[idx]
    if (existing && document.body.contains(existing)) return
    if (existing) existing.remove()
    const c = document.createElement('canvas')
    c.id = `${canvasId}_${idx}`
    c.setAttribute(MARKER, '')
    c.style.cssText = `position:fixed;top:0;left:0;pointer-events:none;z-index:${999999 + (3 - idx)};`
    document.body.appendChild(c)
    canvasLayers[idx] = c
    ctxLayers[idx] = c.getContext('2d')
    lastCanvasSize = { w: 0, h: 0, dpr: 0 }
  }

  const resizeCanvases = () => {
    const size = getViewportSize()
    if (lastCanvasSize.w === size.w && lastCanvasSize.h === size.h && lastCanvasSize.dpr === size.dpr) {
      return false
    }
    for (const c of canvasLayers) {
      if (!c) continue
      c.width = size.w * size.dpr
      c.height = size.h * size.dpr
      c.style.width = size.w + 'px'
      c.style.height = size.h + 'px'
    }
    lastCanvasSize = size
    return true
  }

  // --- Wizard Chess piece replacement ---
  const WIZARD_STYLE_ID = '__ch_wizard_css__'
  const applyWizardChess = () => {
    const existing = document.getElementById(WIZARD_STYLE_ID)
    if (!STATE.wizardChess) {
      if (existing) existing.remove()
      return
    }
    if (existing) return // already applied
    const pieces = [
      { asset: 'white/pawn', chessCom: '.piece.wp', lichess: 'piece.white.pawn' },
      { asset: 'white/knight', chessCom: '.piece.wn', lichess: 'piece.white.knight' },
      { asset: 'white/bishop', chessCom: '.piece.wb', lichess: 'piece.white.bishop' },
      { asset: 'white/rook', chessCom: '.piece.wr', lichess: 'piece.white.rook' },
      { asset: 'white/queen', chessCom: '.piece.wq', lichess: 'piece.white.queen' },
      { asset: 'white/king', chessCom: '.piece.wk', lichess: 'piece.white.king' },
      { asset: 'black/pawn', chessCom: '.piece.bp', lichess: 'piece.black.pawn' },
      { asset: 'black/knight', chessCom: '.piece.bn', lichess: 'piece.black.knight' },
      { asset: 'black/bishop', chessCom: '.piece.bb', lichess: 'piece.black.bishop' },
      { asset: 'black/rook', chessCom: '.piece.br', lichess: 'piece.black.rook' },
      { asset: 'black/queen', chessCom: '.piece.bq', lichess: 'piece.black.queen' },
      { asset: 'black/king', chessCom: '.piece.bk', lichess: 'piece.black.king' },
    ]
    let css = ''
    for (const piece of pieces) {
      const url = chrome.runtime.getURL(`images/wizardChess/${piece.asset}.png`)
      css += `${piece.chessCom} { background-image: url('${url}') !important; }\n`
      css += `${piece.lichess} { background-image: url('${url}') !important; background-size: 100% 100% !important; background-repeat: no-repeat !important; background-position: center !important; }\n`
    }
    const style = document.createElement('style')
    style.id = WIZARD_STYLE_ID
    style.textContent = css
    document.head.appendChild(style)
  }

  const clearCanvas = () => {
    for (let i = 0; i < ctxLayers.length; i++) {
      const ctx = ctxLayers[i]
      const canvas = canvasLayers[i]
      if (!ctx || !canvas) continue
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  // Arrow color palette: #1 green, #2 yellow, #3 blue
  const ARROW_COLORS = [
    { src: [99, 102, 241], dst: [34, 197, 94],  line: [34, 197, 94]  },  // #1 best: indigo src → green dst
    { src: [180, 160, 40], dst: [234, 179, 8],  line: [234, 179, 8]  },  // #2: dark yellow src → yellow dst
    { src: [50, 80, 180],  dst: [59, 130, 246], line: [59, 130, 246] },  // #3: dark blue src → blue dst
  ]

  const _drawSingleArrow = (board, uci, colorIdx, rect, size, sq, flip, opacity, ctx) => {
    if (!uci || uci.length < 4) return

    const files = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 }
    const fromF = files[uci[0]], fromR = parseInt(uci[1]) - 1
    const toF = files[uci[2]], toR = parseInt(uci[3]) - 1
    if (fromF === undefined || toF === undefined || !Number.isFinite(fromR) || !Number.isFinite(toR)) return

    const fromX = rect.left + (flip ? 7 - fromF : fromF) * sq + sq / 2
    const fromY = rect.top + (flip ? fromR : 7 - fromR) * sq + sq / 2
    const toX = rect.left + (flip ? 7 - toF : toF) * sq + sq / 2
    const toY = rect.top + (flip ? toR : 7 - toR) * sq + sq / 2

    if (fromX < 0 || fromY < 0 || toX < 0 || toY < 0 ||
        fromX > size.w || fromY > size.h || toX > size.w || toY > size.h) return

    const c = ARROW_COLORS[colorIdx] || ARROW_COLORS[0]
    const [sr, sg, sb] = c.src
    const [dr, dg, db] = c.dst
    const [lr, lg, lb] = c.line

    // Glow on source
    const g1 = ctx.createRadialGradient(fromX, fromY, 0, fromX, fromY, sq * 0.5)
    g1.addColorStop(0, `rgba(${sr},${sg},${sb},${0.8 * opacity})`)
    g1.addColorStop(0.5, `rgba(${sr},${sg},${sb},${0.3 * opacity})`)
    g1.addColorStop(1, 'transparent')
    ctx.fillStyle = g1
    ctx.fillRect(fromX - sq / 2, fromY - sq / 2, sq, sq)

    // Glow on target
    const g2 = ctx.createRadialGradient(toX, toY, 0, toX, toY, sq * 0.5)
    g2.addColorStop(0, `rgba(${dr},${dg},${db},${0.8 * opacity})`)
    g2.addColorStop(0.5, `rgba(${dr},${dg},${db},${0.3 * opacity})`)
    g2.addColorStop(1, 'transparent')
    ctx.fillStyle = g2
    ctx.fillRect(toX - sq / 2, toY - sq / 2, sq, sq)

    // Arrow line
    const angle = Math.atan2(toY - fromY, toX - fromX)
    const startOff = sq * 0.35, endOff = sq * 0.35
    const x1 = fromX + Math.cos(angle) * startOff
    const y1 = fromY + Math.sin(angle) * startOff
    const x2 = toX - Math.cos(angle) * endOff
    const y2 = toY - Math.sin(angle) * endOff

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},${0.95 * opacity})`
    ctx.lineWidth = Math.max(3, sq * 0.07)
    ctx.lineCap = 'round'
    ctx.stroke()

    // Arrow head
    const headLen = sq * 0.22
    ctx.beginPath()
    ctx.moveTo(toX - Math.cos(angle) * endOff * 0.5, toY - Math.sin(angle) * endOff * 0.5)
    ctx.lineTo(x2 - headLen * Math.cos(angle - 0.5), y2 - headLen * Math.sin(angle - 0.5))
    ctx.lineTo(x2 - headLen * Math.cos(angle + 0.5), y2 - headLen * Math.sin(angle + 0.5))
    ctx.closePath()
    ctx.fillStyle = `rgba(${lr},${lg},${lb},${0.95 * opacity})`
    ctx.fill()
  }

  const drawArrows = (board) => {
    if (!STATE.arrows || !board || !STATE.lastMoves?.length) {
      clearCanvas()
      return
    }

    const moves = STATE.lastMoves.filter(m => m?.uci || m?.bestmove)
    if (!moves.length) { clearCanvas(); return }

    const rect = board.getBoundingClientRect()
    if (!rect.width || rect.width < 50) { clearCanvas(); return }

    const count = STATE.isEnemyTurn ? 1 : Math.min(moves.length, STATE.lines)
    for (let i = 0; i < count; i++) ensureCanvasLayer(i)
    resizeCanvases()

    const size = getViewportSize()
    for (let i = 0; i < ctxLayers.length; i++) {
      const ctx = ctxLayers[i]
      const canvas = canvasLayers[i]
      if (!ctx || !canvas) continue
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
      ctx.clearRect(0, 0, size.w, size.h)
    }

    const sq = rect.width / 8
    const flip = ADAPTER.isBoardFlipped(board)

    // Draw each line on its own canvas (skip unrevealed lines when hideSuggestion is on)
    for (let i = 0; i < count; i++) {
      try {
        // If hideSuggestion is on, only draw arrows for revealed lines
        if (STATE.hideSuggestion && !STATE.revealedLines.has(i)) continue
        const opacity = i === 0 ? 1.0 : 0.6
        const uci = moves[i].uci || moves[i].bestmove
        const ctx = ctxLayers[i]
        if (!ctx) continue
        _drawSingleArrow(board, uci, i, rect, size, sq, flip, opacity, ctx)
      } catch (e) {
        if (DEBUG) console.log('[Chess Helper] Arrow draw error:', e)
      }
    }
  }

  // Debounced redraw on resize/scroll
  let redrawTimer = null
  const scheduleRedraw = () => {
    if (redrawTimer) clearTimeout(redrawTimer)
    redrawTimer = setTimeout(() => {
      redrawTimer = null
      if (STATE.arrows && getMoveUci(STATE.lastMoves?.[0]) && STATE.board) {
        drawArrows(STATE.board)
      }
      renderMoveReviewBadges()
    }, 50)
  }
  window.addEventListener('resize', scheduleRedraw)
  window.addEventListener('scroll', scheduleRedraw)

  // --- Persistent Cache for FEN results (chrome.storage.local) ---
  const CACHE_KEY = 'fenCache'
  const MAX_CACHE_SIZE = 1000
  const CACHE = {
    data: null, // Loaded lazily
    loading: null, // Promise while loading
    saveTimer: null,

    getKey: (fen, depth, multipv, styleMode = 'default') =>
      `${fen}|${depth}|${multipv || 1}|${normalizeStyleMode(styleMode)}`,

    load: async function() {
      if (this.data) return this.data
      if (this.loading) return this.loading

      this.loading = new Promise((resolve) => {
        try {
          chrome.storage.local.get([CACHE_KEY], (result) => {
            const stored = result[CACHE_KEY]
            this.data = stored ? new Map(Object.entries(stored)) : new Map()
            if (DEBUG) console.log('[Chess Helper] Cache loaded from extension storage, size:', this.data.size)
            resolve(this.data)
          })
        } catch {
          this.data = new Map()
          resolve(this.data)
        }
      })
      return this.loading
    },

    save: function() {
      if (!this.data) return
      // Debounce saves
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        try {
          const obj = Object.fromEntries(this.data)
          chrome.storage.local.set({ [CACHE_KEY]: obj }, () => {
            if (DEBUG) console.log('[Chess Helper] Cache saved to extension storage, size:', this.data.size)
          })
        } catch (e) {
          if (DEBUG) console.log('[Chess Helper] Error saving cache:', e)
        }
      }, 2000)
    },

    get: async function(fen, depth, multipv, styleMode = 'default') {
      await this.load()
      const key = this.getKey(fen, depth, multipv, styleMode)
      const entry = this.data.get(key)
      if (entry) {
        if (DEBUG) console.log('[Chess Helper] Cache HIT for FEN')
        return entry
      }
      return null
    },

    set: async function(fen, depth, multipv, styleMode, result) {
      await this.load()
      const key = this.getKey(fen, depth, multipv, styleMode)
      this.data.set(key, { ...result, timestamp: Date.now() })
      // Evict oldest entries when cache exceeds size limit
      if (this.data.size > MAX_CACHE_SIZE) {
        const sorted = [...this.data.entries()].sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0))
        const excess = this.data.size - MAX_CACHE_SIZE
        for (let i = 0; i < excess; i++) this.data.delete(sorted[i][0])
        if (DEBUG) console.log('[Chess Helper] Cache evicted', excess, 'entries')
      }
      if (DEBUG) console.log('[Chess Helper] Cached result, size:', this.data.size)
      this.save()
    },

    clear: function() {
      this.data = new Map()
      try { chrome.storage.local.remove(CACHE_KEY) } catch {}
    }
  }

  // --- State ---
  const STATE = {
    engine: null,
    board: null,
    observer: null,
    lastFen: null,
    lastMoves: [],
    lastEval: null,
    lastScore: null,
    lastAt: 0,
    stable: false,
    updating: false,
    needsUpdate: false,
    ui: null,
    minimized: (() => { try { return localStorage.getItem(STORAGE.minimized) === '1' } catch { return false } })(),
    depth: (() => {
      try {
        const n = parseInt(localStorage.getItem(STORAGE.depth) || '6')
        return n >= 1 && n <= PREMIUM_MAX_DEPTH ? n : 6
      } catch { return 6 }
    })(),
    skipEnemy: (() => { try { const v = localStorage.getItem(STORAGE.skipEnemy); return v === null ? true : v === '1' } catch { return true } })(),
    startMove: (() => { try { const n = parseInt(localStorage.getItem(STORAGE.startMove) || '1'); return n >= 1 ? n : 1 } catch { return 1 } })(),
    lines: (() => { try { const n = parseInt(localStorage.getItem(STORAGE.lines) || '1'); return n >= 1 && n <= PREMIUM_MAX_LINES ? n : 1 } catch { return 1 } })(),
    styleMode: (() => { try { return normalizeStyleMode(localStorage.getItem(STORAGE.styleMode) || 'default') } catch { return 'default' } })(),
    arrows: (() => { try { const v = localStorage.getItem(STORAGE.arrows); return v === null ? true : v === '1' } catch { return true } })(),
    safeMode: (() => { try { const v = localStorage.getItem(STORAGE.safeMode); return v === '1' } catch { return false } })(),
    autoDelayMin: (() => { try { const n = parseInt(localStorage.getItem(STORAGE.autoDelayMin) || '0'); return n >= 0 ? n : 0 } catch { return 0 } })(),
    autoDelayMax: (() => { try { const n = parseInt(localStorage.getItem(STORAGE.autoDelayMax) || '0'); return n >= 0 ? n : 0 } catch { return 0 } })(),
    hideSuggestion: (() => { try { const v = localStorage.getItem(STORAGE.hideSuggestion); return v === '1' } catch { return false } })(),
    wizardChess: false,
    autoPlay: (() => { try { const v = localStorage.getItem(STORAGE.autoPlay); return v === '1' } catch { return false } })(),
    analyzePlayerMoves: (() => { try { const v = localStorage.getItem(STORAGE.analyzePlayerMoves); return v === null ? true : v === '1' } catch { return true } })(),
    lastAutoMoveFen: null,
    lastAutoTryAt: 0,
    revealedLines: new Set(), // Which line indices (0,1,2) are revealed
    pendingFen: null,
    retry: null,
    // Accuracy tracking
    movesPlayed: [],
    lastSuggestedMove: null,
    lastMoveTime: 0,
    moveTimes: [],
    wasMyTurn: false,
    isEnemyTurn: false, // True when showing enemy best move (forces single line)
    lastTurn: null, // Track whose turn it was before position changed
    lastSeenFen: null, // Track last seen position (even when skipping)
    lastRequestedFen: null, // Track last FEN we requested from engine (avoid duplicate requests)
    requestInProgress: false, // Prevent concurrent requests
    retryCount: 0, // Exponential backoff counter for engine failures
    lastError: null, // Last error message for UI display
    pieceDragActive: false, // True while user is dragging a piece on Lichess
    dragLockUntil: 0, // Debounce transient board states right after piece drop
    dragGuardBound: false, // Ensure drag listeners are bound only once
    lastAnalyzedMoveSig: null,
    moveReviewFlashUntil: 0,
    moveReviewFlashText: '',
    moveReviewFlashKind: '',
    moveReviewPinnedText: '',
    moveReviewPinnedKind: '',
    moveReviewPinnedAt: 0,
    moveReviewByPly: new Map(),
    overrideScoreUntil: 0,
    overrideScore: null,
    overrideEval: '',
    overrideFen: '',
    promoInterval: null,
  }

  const invalidate = () => {
    STATE.lastFen = null
    STATE.lastSeenFen = null  // Reset position tracking
    STATE.lastRequestedFen = null  // Reset request tracking
    STATE.lastMoves = []
    STATE.lastEval = null
    STATE.lastAt = 0
    STATE.stable = false
    STATE.lastTurn = null  // Reset turn tracking for new game
    STATE.retryCount = 0  // Reset backoff counter
    STATE.pieceDragActive = false
    STATE.dragLockUntil = 0
    STATE.lastAnalyzedMoveSig = null
    STATE.moveReviewFlashUntil = 0
    STATE.moveReviewFlashText = ''
    STATE.moveReviewFlashKind = ''
    STATE.moveReviewPinnedText = ''
    STATE.moveReviewPinnedKind = ''
    STATE.moveReviewPinnedAt = 0
    STATE.moveReviewByPly = new Map()
    STATE.overrideScoreUntil = 0
    STATE.overrideScore = null
    STATE.overrideEval = ''
    STATE.overrideFen = ''
    if (STATE.retry) { clearTimeout(STATE.retry); STATE.retry = null }
    clearCanvas()
  }

  const hasLichessTransientDragState = (board = null) => {
    if (SITE !== 'lichess') return false
    const b = board || STATE.board || document.querySelector('cg-board')
    if (!b) return false
    if (b.querySelector('piece.dragging, piece.anim, piece.ghost')) return true
    const wrap = b.closest('.cg-wrap')
    if (wrap && wrap.classList.contains('dragging')) return true
    return false
  }

  const isLichessDragLocked = (board = null) => {
    if (SITE !== 'lichess') return false
    if (STATE.pieceDragActive) return true
    if (Date.now() < STATE.dragLockUntil) return true
    return hasLichessTransientDragState(board)
  }

  const setupLichessDragGuard = () => {
    if (SITE !== 'lichess' || STATE.dragGuardBound) return
    STATE.dragGuardBound = true

    const onPointerDown = (e) => {
      const target = e?.target
      if (!(target instanceof Element)) return
      const piece = target.closest('piece')
      if (!piece || !piece.closest('cg-board')) return
      STATE.pieceDragActive = true
      STATE.dragLockUntil = Date.now() + 100
    }

    const releaseDragLock = () => {
      const hadLock = STATE.pieceDragActive || Date.now() < STATE.dragLockUntil || hasLichessTransientDragState()
      if (!hadLock) return
      STATE.pieceDragActive = false
      STATE.dragLockUntil = Date.now() + 150
      scheduleUpdate()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', releaseDragLock, true)
    window.addEventListener('pointercancel', releaseDragLock, true)
    window.addEventListener('blur', releaseDragLock, true)
  }

  const normalizeMoves = (moves) => {
    if (!Array.isArray(moves)) return []
    for (const m of moves) {
      if (m && !m.uci && m.bestmove) m.uci = m.bestmove
    }
    return moves.filter(Boolean)
  }

  const getMoveUci = (m) => m?.uci || m?.bestmove || null
  const DEFAULT_AVATAR_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#60a5fa"/>
          <stop offset="100%" stop-color="#8b5cf6"/>
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="32" fill="url(#g)"/>
      <path d="M21 47h22v-4c0-4-3-7-7-8 4-2 6-5 6-9 0-7-5-12-10-12-3 0-5 1-7 3-1-3-3-5-6-5-2 0-4 1-5 3 3 1 5 4 5 7 0 2-1 5-4 7 5 0 8 2 10 5-3 2-4 5-4 9v4z" fill="#fff" opacity=".95"/>
    </svg>`
  )}`
  const PIECE_LABELS = {
    p: 'Tốt',
    n: 'Mã',
    b: 'Tượng',
    r: 'Xe',
    q: 'Hậu',
    k: 'Vua',
    P: 'Tốt',
    N: 'Mã',
    B: 'Tượng',
    R: 'Xe',
    Q: 'Hậu',
    K: 'Vua',
  }
  const getPieceAtFenSquare = (fen, square) => {
    const refFen = typeof fen === 'string' ? fen.trim() : ''
    const sq = typeof square === 'string' ? square.trim().toLowerCase() : ''
    if (!refFen || !/^[a-h][1-8]$/.test(sq)) return null
    const boardPart = refFen.split(' ')[0] || ''
    const rows = boardPart.split('/')
    if (rows.length !== 8) return null
    const fileIndex = sq.charCodeAt(0) - 97
    const rankIndex = 8 - Number.parseInt(sq[1], 10)
    if (fileIndex < 0 || fileIndex > 7 || rankIndex < 0 || rankIndex > 7) return null
    const row = rows[rankIndex] || ''
    let col = 0
    for (const ch of row) {
      if (/\d/.test(ch)) {
        col += Number.parseInt(ch, 10)
        continue
      }
      if (col === fileIndex) return ch
      col += 1
    }
    return null
  }
  const getPieceLabelFromFenMove = (uci, fen = null) => {
    const move = typeof uci === 'string' ? uci.trim().toLowerCase() : ''
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return null
    const refFen = typeof fen === 'string' && fen.trim() ? fen : (STATE?.lastFen || null)
    if (!refFen) return null
    const piece = getPieceAtFenSquare(refFen, move.slice(0, 2))
    if (!piece) return null
    return PIECE_LABELS[piece] || null
  }
  const formatUciForDisplay = (uci, fen = null) => {
    const move = typeof uci === 'string' ? uci.trim().toLowerCase() : ''
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return move || '...'
    const from = move.slice(0, 2)
    const to = move.slice(2, 4)
    const promotion = move[4]
    const pieceLabel = getPieceLabelFromFenMove(move, fen)
    const promoLabel = promotion ? `=${({ q: 'Hậu', r: 'Xe', b: 'Tượng', n: 'Mã' }[promotion] || promotion.toUpperCase())}` : ''
    return `${pieceLabel ? `${pieceLabel} ` : ''}${from}-${to}${promoLabel}`
  }
  const getMoveText = (m, fen = null) => {
    const uci = getMoveUci(m)
    if (uci) return formatUciForDisplay(uci, fen)
    return m?.san || m?.bestmove || '...'
  }
  const scoreToCp = (score) => {
    if (!score || typeof score !== 'object') return 0
    if (score.type === 'mate') return score.value > 0 ? 100000 - Math.abs(score.value) : -100000 + Math.abs(score.value)
    if (score.type === 'cp' && Number.isFinite(score.value)) return score.value
    return 0
  }
  const PIECE_VALUES = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000,
  }
  const getMoveFacts = (fen, uci) => {
    const move = typeof uci === 'string' ? uci.trim().toLowerCase() : ''
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return null
    const from = move.slice(0, 2)
    const to = move.slice(2, 4)
    const piece = getPieceAtFenSquare(fen, from)
    const target = getPieceAtFenSquare(fen, to)
    const file = to.charCodeAt(0) - 96
    const rank = Number.parseInt(to[1], 10)
    const centerDistance = Math.abs(file - 4.5) + Math.abs(rank - 4.5)
    const pieceKey = typeof piece === 'string' ? piece.toLowerCase() : ''
    return {
      from,
      to,
      piece,
      pieceKey,
      target,
      targetKey: typeof target === 'string' ? target.toLowerCase() : '',
      isCapture: !!target,
      isPromotion: move.length >= 5,
      isCastle: (from === 'e1' && (to === 'g1' || to === 'c1')) || (from === 'e8' && (to === 'g8' || to === 'c8')),
      centerDistance,
      targetValue: PIECE_VALUES[typeof target === 'string' ? target.toLowerCase() : ''] || 0,
    }
  }
  const getStyleSearchMultipv = (multipv, styleMode) => {
    const safeMultipv = Math.max(1, Number.parseInt(multipv, 10) || 1)
    if (styleMode === 'default') return safeMultipv
    return Math.max(safeMultipv, 5)
  }
  const getStyledLineWeight = (line, styleMode, fen) => {
    const facts = getMoveFacts(fen, line?.uci || line?.bestmove || '')
    const base = scoreToCp(line?.score)
    if (!facts || styleMode === 'default') return base
    if (styleMode === 'suicide') {
      return -base + (facts.isCapture ? 25 : 0) - facts.targetValue * 0.01
    }
    if (styleMode === 'aggressive') {
      return base + (facts.isCapture ? 180 + facts.targetValue * 0.25 : 0) + (facts.isPromotion ? 260 : 0) - facts.centerDistance * 8
    }
    if (styleMode === 'defensive') {
      return base + (facts.isCastle ? 260 : 0) + (facts.pieceKey === 'k' ? 80 : 0) + (facts.pieceKey === 'p' ? 35 : 0) - (facts.pieceKey === 'q' ? 80 : 0) + facts.centerDistance * 6
    }
    if (styleMode === 'endgame') {
      return base + (facts.pieceKey === 'k' ? 140 : 0) + (facts.pieceKey === 'p' ? 120 : 0) + (facts.isPromotion ? 320 : 0) - facts.centerDistance * 5
    }
    if (styleMode === 'human') {
      const fromRank = Number.parseInt(facts.from[1], 10)
      const developsMinor =
        (facts.pieceKey === 'n' || facts.pieceKey === 'b') &&
        ((/[wb]/.test(facts.piece || '') && (fromRank === 1 || fromRank === 8)) || ['b1', 'g1', 'c1', 'f1', 'b8', 'g8', 'c8', 'f8'].includes(facts.from))
      return base + (developsMinor ? 140 : 0) + (facts.pieceKey === 'p' ? 40 : 0) - (facts.pieceKey === 'q' ? 160 : 0) - (facts.pieceKey === 'k' && !facts.isCastle ? 120 : 0) - facts.centerDistance * 4
    }
    return base
  }
  const applyStyleModeToLines = (lines, styleMode, fen, limit = null) => {
    const normalized = Array.isArray(lines) ? lines.filter((line) => line && getMoveUci(line)) : []
    if (!normalized.length) return []
    if (styleMode === 'default') {
      return limit ? normalized.slice(0, limit) : normalized
    }
    const styled = normalized
      .map((line, index) => ({
        line,
        index,
        weight: getStyledLineWeight(line, styleMode, fen),
        scoreCp: scoreToCp(line?.score),
      }))
      .sort((a, b) => b.weight - a.weight || b.scoreCp - a.scoreCp || a.index - b.index)
      .map((entry) => entry.line)
    return limit ? styled.slice(0, limit) : styled
  }
  const setAvatarImage = (img, src) => {
    if (!(img instanceof HTMLImageElement)) return
    img.onerror = () => {
      img.onerror = null
      img.src = DEFAULT_AVATAR_SRC
    }
    img.src = typeof src === 'string' && src.trim() ? src.trim() : DEFAULT_AVATAR_SRC
    img.style.display = 'block'
  }
  const getExtensionUrl = (path) => {
    try {
      if (chrome?.runtime?.getURL) return chrome.runtime.getURL(path)
    } catch {}
    return path
  }
  const normalizeEngineLine = (value) =>
    typeof value === 'string'
      ? value
      : typeof value?.data === 'string'
        ? value.data
        : typeof value?.message === 'string'
          ? value.message
          : ''
  const parseScoreTokens = (tokens) => {
    const scoreIdx = tokens.indexOf('score')
    if (scoreIdx < 0 || scoreIdx + 2 >= tokens.length) return null
    const scoreType = tokens[scoreIdx + 1]
    const rawValue = Number.parseInt(tokens[scoreIdx + 2], 10)
    if (!Number.isFinite(rawValue)) return null
    if (scoreType === 'cp') return { type: 'cp', value: rawValue }
    if (scoreType === 'mate') return { type: 'mate', value: rawValue }
    return null
  }
  const ENGINE_HOST_CHANNEL = 'chess-helper-engine-host'
  let sharedEngineHost = null

  class EngineHostClient {
    constructor(frameKey = 'main') {
      this.frameKey = String(frameKey || 'main')
      this.frame = null
      this.ready = false
      this.listenerInstalled = false
      this.commandQueue = []
      this.currentJob = null
      this.lastConfigKey = ''
      this.readyPromise = null
      this.readyResolve = null
      this.readyReject = null
      this.resetReadyPromise()
      this.installListener()
      this.ensureFrame()
    }

    resetReadyPromise() {
      this.readyPromise = new Promise((resolve, reject) => {
        this.readyResolve = resolve
        this.readyReject = reject
      })
    }

    installListener() {
      if (this.listenerInstalled) return
      this.listenerInstalled = true
      window.addEventListener('message', (event) => {
        if (event.source !== this.frame?.contentWindow) return
        const data = event.data || {}
        if (data.channel !== ENGINE_HOST_CHANNEL) return
        if (data.type === 'ready') {
          this.ready = true
          if (this.readyResolve) this.readyResolve(true)
          this.flushQueue()
          logEvent('Engine', 'host:ready', { engine: data.engine || 'stockfish' })
          return
        }
        if (data.type === 'worker-error') {
          const message = data.message || 'engine_worker_error'
          logEvent('Engine', 'host:error', {
            error: message,
            filename: data.filename || null,
            lineno: data.lineno || null,
            colno: data.colno || null,
          })
          if (!this.ready && this.readyReject) {
            this.readyReject(new Error(message))
            this.resetReadyPromise()
          }
          if (this.currentJob?.timer) clearTimeout(this.currentJob.timer)
          if (this.currentJob?.reject) {
            const reject = this.currentJob.reject
            this.currentJob = null
            reject(new Error(message))
          }
          this.recreateFrame()
          return
        }
        if (data.type === 'engine-message') {
          this.handleLine(typeof data.line === 'string' ? data.line.trim() : '')
        }
      })
    }

    ensureFrame() {
      if (this.frame?.isConnected) return this.frame
      this.ready = false
      this.frame = document.createElement('iframe')
      this.frame.src = getExtensionUrl('engine_host.html')
      this.frame.id = `chess-helper-engine-host-${this.frameKey}`
      this.frame.setAttribute('aria-hidden', 'true')
      Object.assign(this.frame.style, {
        position: 'fixed',
        width: '0',
        height: '0',
        border: '0',
        opacity: '0',
        pointerEvents: 'none',
        left: '-9999px',
        top: '-9999px',
      })
      ;(document.documentElement || document.body).appendChild(this.frame)
      return this.frame
    }

    recreateFrame() {
      try { this.frame?.remove() } catch {}
      this.frame = null
      this.ready = false
      this.commandQueue = []
      this.lastConfigKey = ''
      this.resetReadyPromise()
      this.ensureFrame()
    }

    post(command) {
      if (!this.frame?.contentWindow || !this.ready) {
        this.commandQueue.push(command)
        return
      }
      logEvent('Engine', 'host:post', command)
      this.frame.contentWindow.postMessage({
        channel: ENGINE_HOST_CHANNEL,
        type: 'command',
        command,
      }, '*')
    }

    flushQueue() {
      if (!this.ready || !this.commandQueue.length) return
      this.commandQueue.splice(0).forEach((command) => this.post(command))
    }

    async ensureReady(timeoutMs = 8000) {
      this.ensureFrame()
      const startedAt = Date.now()
      logEvent('Engine', 'host:ensure-ready', {
        frameKey: this.frameKey,
        timeoutMs,
        ready: this.ready,
        frameSrc: this.frame?.src || null,
      })
      if (this.ready) {
        logEvent('Engine', 'host:already-ready', { frameKey: this.frameKey })
        return
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = new Error('engine_host_ready_timeout')
          logEvent('Engine', 'host:ready-timeout', {
            frameKey: this.frameKey,
            timeoutMs,
            elapsedMs: Date.now() - startedAt,
            frameReady: this.ready,
            frameConnected: !!this.frame?.isConnected,
            frameSrc: this.frame?.src || null,
          })
          reject(error)
        }, timeoutMs)

        this.readyPromise.then(
          () => {
            clearTimeout(timer)
            logEvent('Engine', 'host:ready-resolved', {
              frameKey: this.frameKey,
              elapsedMs: Date.now() - startedAt,
            })
            resolve(true)
          },
          (error) => {
            clearTimeout(timer)
            logEvent('Engine', 'host:ready-rejected', {
              frameKey: this.frameKey,
              error: error?.message || String(error),
              elapsedMs: Date.now() - startedAt,
            })
            reject(error)
          }
        )
      })
    }

    handleLine(line) {
      if (!line) return
      logEvent('Engine', 'host:line', line)
      const job = this.currentJob
      if (!job) return
      if (line.startsWith('bestmove ')) {
        const parts = line.split(/\s+/)
        const bestmove = parts[1] || null
        const byMultipv = [...job.lines.values()]
          .filter((entry) => entry && entry.uci)
          .sort((a, b) => (a.multipv || 0) - (b.multipv || 0))
        const primary = byMultipv[0] || (bestmove ? { uci: bestmove, san: bestmove, score: null, multipv: 1 } : null)
        clearTimeout(job.timer)
        this.currentJob = null
        job.resolve(primary ? {
          ok: true,
          bestmove: primary.uci || bestmove,
          uci: primary.uci || bestmove,
          san: primary.san || primary.uci || bestmove,
          bestmoveUci: primary.uci || bestmove,
          bestmoveSan: primary.san || primary.uci || bestmove,
          score: primary.score || null,
          lines: byMultipv.map(({ multipv, ...rest }) => rest),
          styleMode: job.styleMode,
        } : { ok: true, bestmove: bestmove || null, lines: [] })
        return
      }
      if (!line.startsWith('info ')) return
      const tokens = line.split(/\s+/)
      const pvIdx = tokens.indexOf('pv')
      if (pvIdx < 0 || pvIdx + 1 >= tokens.length) return
      const uci = tokens[pvIdx + 1]
      if (!_isUciFormat(uci)) return
      const multipvIdx = tokens.indexOf('multipv')
      const multipv = multipvIdx >= 0 ? Number.parseInt(tokens[multipvIdx + 1], 10) : 1
      job.lines.set(Number.isFinite(multipv) ? multipv : 1, {
        multipv: Number.isFinite(multipv) ? multipv : 1,
        uci,
        san: uci,
        score: parseScoreTokens(tokens),
      })
    }

    async analyze(fen, { depth, multipv, timeoutMs, styleMode }) {
      await this.ensureReady(Math.max(4000, timeoutMs))

      if (this.currentJob) {
        try { this.post('stop') } catch {}
        if (this.currentJob.timer) clearTimeout(this.currentJob.timer)
        this.currentJob.reject(new Error('search_replaced'))
        this.currentJob = null
      }

      return await new Promise((resolve, reject) => {
        this.currentJob = {
          fen,
          depth,
          multipv,
          styleMode,
          resolve,
          reject,
          lines: new Map(),
          timer: null,
        }
        const configKey = `${multipv}`
        if (configKey !== this.lastConfigKey) {
          this.post(`setoption name MultiPV value ${multipv}`)
          this.lastConfigKey = configKey
        }
        this.post('ucinewgame')
        this.post(`position fen ${fen}`)
        this.post(`go depth ${depth}`)
        this.currentJob.timer = setTimeout(() => {
          if (!this.currentJob) return
          try { this.post('stop') } catch {}
          const fallback = [...this.currentJob.lines.values()]
            .filter((entry) => entry && entry.uci)
            .sort((a, b) => (a.multipv || 0) - (b.multipv || 0))
          const activeJob = this.currentJob
          this.currentJob = null
          if (fallback.length) {
            activeJob.resolve({
              ok: true,
              bestmove: fallback[0].uci,
              uci: fallback[0].uci,
              san: fallback[0].san || fallback[0].uci,
              bestmoveUci: fallback[0].uci,
              bestmoveSan: fallback[0].san || fallback[0].uci,
              score: fallback[0].score || null,
              lines: fallback.map(({ multipv: _multipv, ...rest }) => rest),
              styleMode,
            })
            return
          }
          activeJob.reject(new Error('offline_engine_timeout'))
        }, Math.max(1500, timeoutMs))
      })
    }
  }

  const getSharedEngineHost = () => {
    if (!sharedEngineHost) sharedEngineHost = new EngineHostClient()
    return sharedEngineHost
  }

  const setLines = (value, { schedule = true } = {}) => {
    const v = clampLinesByPlan(value, 1)
    if (v === STATE.lines) return false
    STATE.lines = v
    try { localStorage.setItem(STORAGE.lines, v) } catch {}
    // Force re-request for new multipv
    STATE.lastFen = null
    STATE.stable = false
    STATE.lastAt = 0
    if (STATE.retry) { clearTimeout(STATE.retry); STATE.retry = null }
    if (schedule) scheduleUpdate()
    return true
  }

  // --- Stats Tracking ---

  const updateStats = () => {
    if (!STATE.ui) return

    // Opening name
    const openingEl = STATE.ui.querySelector('[data-opening]')
    if (openingEl && STATE.lastFen) {
      const opening = getOpeningName(STATE.lastFen)
      openingEl.textContent = opening || ''
      openingEl.style.display = opening ? 'block' : 'none'
    }
  }

  const trackMoveTime = () => {
    const now = Date.now()
    if (STATE.lastMoveTime > 0) {
      const elapsed = (now - STATE.lastMoveTime) / 1000 // in seconds
      if (elapsed > 0.5 && elapsed < 60) { // Reasonable move time
        STATE.moveTimes.push(elapsed)
        if (STATE.moveTimes.length > 20) STATE.moveTimes.shift()
      }
    }
    STATE.lastMoveTime = now
  }

  const trackAccuracy = (playerMove, suggestedMove) => {
    if (!playerMove || !suggestedMove) return
    const matched = playerMove === suggestedMove
    STATE.movesPlayed.push({ move: playerMove, suggested: suggestedMove, matched })
    if (STATE.movesPlayed.length > 20) STATE.movesPlayed.shift()
  }

  // --- UI ---
  const pid = PANEL_ID

  const CSS = `
    @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css');

    #${pid} {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483647;
      width: 280px;
      max-height: calc(100vh - 40px);
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #f8fafc;
      background: linear-gradient(135deg, #1e1e2e 0%, #2d2d3f 100%);
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.1);
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: row;
    }
    #${pid} .eval-bar-container {
      width: 14px;
      background: #000;
      position: relative;
      flex-shrink: 0;
      border-radius: 20px 0 0 20px;
    }
    #${pid} .eval-bar-white {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 50%;
      background: #fff;
      transition: height 0.3s ease;
      border-radius: 20px 0 0 0;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }
    #${pid} .eval-bar-score {
      font-size: 9px;
      font-weight: 700;
      color: #000;
      font-family: Arial, sans-serif;
      padding-bottom: 2px;
      text-shadow: 0 0 2px rgba(255,255,255,0.8);
    }
    #${pid} .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
    #${pid} .inner-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.15) transparent;
    }
    #${pid} .inner-scroll::-webkit-scrollbar { width: 4px; }
    #${pid} .inner-scroll::-webkit-scrollbar-track { background: transparent; }
    #${pid} .inner-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
    #${pid} .inner-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
    #${pid}.min { width: 160px; }
    #${pid}.min .eval-bar-container { display: none; }
    #${pid}.min .engine-badge { display: none; }
    #${pid}.min .logo-text { font-size: 12px; }
    #${pid}.min .head { padding: 10px 12px; }

    #${pid} .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 18px;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.15) 100%);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    #${pid} .logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #${pid} .logo-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    #${pid} .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      color: #fff;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
    }
    #${pid} .logo-text {
      font-weight: 700;
      font-size: 14px;
      background: linear-gradient(135deg, #f8fafc, #cbd5e1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.3px;
    }
    #${pid} .engine-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 9px;
      color: #fbbf24;
      font-weight: 700;
      letter-spacing: 0.2px;
      white-space: nowrap;
      max-width: 190px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${pid} .head-btn {
      width: 28px;
      height: 28px;
      border: none;
      background: rgba(255,255,255,0.08);
      border-radius: 8px;
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    #${pid} .head-btn:hover {
      background: rgba(255,255,255,0.15);
      color: #fff;
      transform: scale(1.05);
    }

    #${pid} .players {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      background: rgba(0,0,0,0.2);
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    #${pid} .players.show { display: flex; }
    #${pid} .player {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #${pid} .player-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      object-fit: cover;
    }
    #${pid} .player-info {
      display: flex;
      flex-direction: column;
    }
    #${pid} .player-name {
      font-weight: 600;
      font-size: 11px;
      color: #f1f5f9;
      max-width: 70px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${pid} .player-color {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
    }
    #${pid} .player-color.white { color: #fbbf24; }
    #${pid} .player-color.black { color: #a78bfa; }
    #${pid} .vs {
      font-size: 10px;
      font-weight: 700;
      color: #475569;
      padding: 4px 8px;
      background: rgba(0,0,0,0.3);
      border-radius: 6px;
    }
    #${pid} .me { flex-direction: row-reverse; }
    #${pid} .me .player-info { align-items: flex-end; }

    #${pid} .body { padding: 16px 18px; }
    #${pid}.min .body { display: none; }
    #${pid}.min .players { display: none !important; }

    #${pid} .status { display: none; }
    #${pid} .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 10px rgba(34, 197, 94, 0.5);
    }
    #${pid} .dot.calc { background: #f59e0b; animation: pulse 1s infinite; box-shadow: 0 0 10px rgba(245, 158, 11, 0.5); }
    #${pid} .dot.err { background: #ef4444; box-shadow: 0 0 10px rgba(239, 68, 68, 0.5); }
    #${pid} .dot.wait { background: #64748b; box-shadow: none; }
    #${pid} .dot.skip { background: #8b5cf6; box-shadow: 0 0 10px rgba(139, 92, 246, 0.5); }
    #${pid} .dot.nogame { background: #475569; box-shadow: none; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.9); } }
    #${pid} .status-text { font-size: 11px; color: #94a3b8; }
    #${pid} .runtime-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 4px 10px;
      color: #b8c3e0;
      font-size: 11px;
      min-height: 20px;
    }
    #${pid} .runtime-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${pid} .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: 0 0 auto;
      background: #94a3b8;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.14);
    }
    #${pid} .dot.calc { background: #38bdf8; box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.16); }
    #${pid} .dot.wait { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.16); }
    #${pid} .dot.err { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.16); }
    #${pid} .dot.skip { background: #a78bfa; box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.16); }
    #${pid} .dot.nogame { background: #64748b; box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.16); }
    #${pid} .error-detail { font-size: 9px; color: #ef4444; margin-top: 6px; word-break: break-all; max-width: 180px; line-height: 1.3; min-height: 12px; }

    #${pid} .best-section {
      margin-bottom: 8px;
      min-height: 170px;
    }
    #${pid} .best-card {
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%);
      border: 1px solid rgba(34, 197, 94, 0.25);
      border-radius: 12px;
      padding: 10px;
      text-align: center;
      position: relative;
      overflow: hidden;
      min-height: 170px;
      max-height: 170px;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
    }
    #${pid} .best-card::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(34, 197, 94, 0.1) 0%, transparent 70%);
      pointer-events: none;
    }
    #${pid} .best-label {
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #22c55e;
      margin-bottom: 4px;
      font-weight: 600;
    }
    #${pid} .best-move {
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      font-family: 'SF Mono', 'Fira Code', monospace;
      text-shadow: 0 4px 20px rgba(34, 197, 94, 0.4);
      letter-spacing: -1px;
      line-height: 1.1;
      min-height: 29px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${pid} .best-eval {
      font-size: 11px;
      color: #4ade80;
      margin-top: 4px;
      font-weight: 600;
      min-height: 14px;
    }
    #${pid} .best-eval.neg { color: #f87171; }
    #${pid} .best-eval.mate { color: #fbbf24; }
    #${pid} .best-usage {
      margin-top: auto;
      font-size: 10px;
      color: #7dd3fc;
      font-weight: 700;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: center;
      text-align: center;
      width: 100%;
      min-height: 44px;
      height: 44px;
      justify-content: center;
      line-height: 1.25;
      overflow: hidden;
    }
    #${pid} .best-usage .move-review {
      width: 100%;
      display: grid;
      gap: 2px;
      justify-items: center;
      padding: 0;
      border-radius: 0;
      border: none;
      background: transparent;
      box-sizing: border-box;
    }
    #${pid} .best-usage .move-review-move {
      font-size: 10px;
      letter-spacing: .4px;
      font-weight: 800;
      color: #e2e8f0;
      font-family: 'SF Mono', 'Fira Code', monospace;
    }
    #${pid} .best-usage .move-review-label {
      font-size: 11px;
      font-weight: 900;
    }
    #${pid} .best-usage .move-review.compact {
      padding: 0;
      gap: 0;
      min-height: 0;
    }
    #${pid} .best-usage .move-review.compact .move-review-move {
      display: none;
    }
    #${pid} .best-usage .move-review.compact .move-review-label {
      font-size: 14px;
      line-height: 1.05;
      letter-spacing: 0;
      text-transform: none;
    }
    #${pid} .best-usage .move-review.is-brilliant { border-color: transparent; background: transparent; }
    #${pid} .best-usage .move-review.is-brilliant .move-review-label { color: #fbbf24; }
    #${pid} .best-usage .move-review.is-great { border-color: transparent; background: transparent; }
    #${pid} .best-usage .move-review.is-great .move-review-label { color: #10d9a0; }
    #${pid} .best-usage .move-review.is-best { border-color: transparent; background: transparent; }
    #${pid} .best-usage .move-review.is-best .move-review-label { color: #2dd4bf; }
    #${pid} .best-usage .move-review.is-excellent { border-color: transparent; background: transparent; }
    #${pid} .best-usage .move-review.is-excellent .move-review-label { color: #22c55e; }
    #${pid} .best-usage .move-review.is-good { border-color: transparent; background: transparent; }
    #${pid} .best-usage .move-review.is-good .move-review-label { color: #60a5fa; }
    #${pid} .best-usage .move-review.is-inaccuracy { border-color: transparent; background: transparent; }
    #${pid} .best-usage .move-review.is-inaccuracy .move-review-label { color: #f59e0b; }
    #${pid} .best-usage .move-review.is-mistake { border-color: transparent; background: transparent; }
    #${pid} .best-usage .move-review.is-mistake .move-review-label { color: #f97316; }
    #${pid} .best-usage .move-review.is-blunder { border-color: transparent; background: transparent; }
    #${pid} .best-usage .move-review.is-blunder .move-review-label { color: #ef4444; }
    #${pid} .best-usage.limit-layout {
      align-items: center;
      text-align: center;
      width: 100%;
      min-height: 56px;
      height: auto;
    }
    #${pid} .best-usage .subscribe-btn {
      margin-left: 0;
    }
    #${pid} .best-card.limit-state .best-label {
      color: #fbbf24;
    }
    #${pid} .best-card.limit-state .best-move {
      color: #f8fafc;
      letter-spacing: 0;
      text-shadow: 0 4px 20px rgba(251, 191, 36, 0.35);
    }
    #${pid} .usage-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    #${pid} .usage-btn {
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 9px;
      font-weight: 700;
      line-height: 1.2;
      background: rgba(15, 23, 42, 0.55);
      color: #cbd5e1;
    }
    #${pid} .usage-btn:disabled {
      opacity: 0.85;
      cursor: default;
    }
    #${pid} .usage-btn.premium {
      border-color: rgba(251,191,36,0.45);
      color: #fbbf24;
      background: rgba(251,191,36,0.12);
      cursor: pointer;
    }
    #${pid} .usage-btn.premium:hover {
      background: rgba(251,191,36,0.2);
    }

    #${pid} .mate-alert {
      display: block;
      margin-top: 8px;
      padding: 6px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      text-align: center;
      animation: matePulse 1.5s ease-in-out infinite;
      min-height: 32px;
      box-sizing: border-box;
      visibility: hidden;
      opacity: 0;
    }
    #${pid} .mate-alert.winning {
      display: block;
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.25) 0%, rgba(16, 185, 129, 0.15) 100%);
      border: 1px solid rgba(34, 197, 94, 0.4);
      color: #4ade80;
      visibility: visible;
      opacity: 1;
    }
    #${pid} .mate-alert.losing {
      display: block;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.15) 100%);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      visibility: visible;
      opacity: 1;
    }
    #${pid} .mate-alert i { margin-right: 6px; }
    @keyframes matePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    #${pid} .alt-lines {
      margin-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.08);
      padding-top: 8px;
    }
    #${pid} .alt-lines:empty { display: none; }
    #${pid} .alt-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 10px;
      border-radius: 8px;
      margin-bottom: 4px;
    }
    #${pid} .alt-line:last-child { margin-bottom: 0; }
    #${pid} .alt-line[data-pv="2"] {
      background: rgba(234, 179, 8, 0.10);
      border-left: 3px solid rgba(234, 179, 8, 0.6);
    }
    #${pid} .alt-line[data-pv="3"] {
      background: rgba(59, 130, 246, 0.10);
      border-left: 3px solid rgba(59, 130, 246, 0.6);
    }
    #${pid} .alt-rank {
      font-size: 10px;
      font-weight: 700;
      min-width: 18px;
    }
    #${pid} .alt-line[data-pv="2"] .alt-rank { color: #eab308; }
    #${pid} .alt-line[data-pv="3"] .alt-rank { color: #3b82f6; }
    #${pid} .alt-move {
      font-size: 16px;
      font-weight: 700;
      color: #cbd5e1;
      font-family: 'SF Mono', 'Fira Code', monospace;
      flex: 1;
      text-align: center;
    }
    #${pid} .alt-eval {
      font-size: 11px;
      font-weight: 600;
      min-width: 50px;
      text-align: right;
    }
    #${pid} .alt-line[data-pv="2"] .alt-eval { color: #eab308; }
    #${pid} .alt-line[data-pv="3"] .alt-eval { color: #3b82f6; }
    #${pid} .alt-eval.neg { color: #f87171 !important; }
    #${pid} .alt-eval.mate { color: #fbbf24 !important; }

    #${pid} .settings {
      border-top: 1px solid rgba(255,255,255,0.06);
      padding-top: 10px;
    }
    #${pid} .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 0;
    }
    #${pid} .row-control {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }
    #${pid} .premium-crown-lock {
      position: relative;
      display: inline-flex;
      align-items: center;
      color: #fbbf24;
      cursor: help;
      font-size: 11px;
      margin-left: 4px;
    }
    #${pid} .premium-crown-lock i {
      color: #fbbf24 !important;
      width: auto;
      text-align: center;
    }
    #${pid} .premium-crown-lock.hidden {
      display: none;
    }
    #${pid} .row-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 10px;
      color: #94a3b8;
    }
    #${pid} .row-label i {
      width: 16px;
      text-align: center;
      color: #64748b;
    }
    #${pid} .input {
      width: 56px;
      height: 26px;
      padding: 3px 8px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #f8fafc;
      font-size: 11px;
      text-align: center;
      outline: none;
      transition: all 0.2s;
    }
    #${pid} .input:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }
    #${pid} .toggle {
      width: 40px;
      height: 22px;
      background: rgba(100, 116, 139, 0.4);
      border-radius: 11px;
      cursor: pointer;
      position: relative;
      transition: all 0.2s;
    }
    #${pid} .toggle.on { background: linear-gradient(135deg, #22c55e, #16a34a); }
    #${pid} .toggle.locked {
      opacity: 0.55;
      cursor: not-allowed;
      pointer-events: none;
    }
    #${pid} .toggle.blocked {
      box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.6);
      animation: blockedPulse 0.55s ease-in-out 2;
    }
    #${pid} .toggle.notice {
      box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.75);
      animation: noticePulse 0.7s ease-in-out 2;
    }
    @keyframes blockedPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }
    @keyframes noticePulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }
    #${pid} .toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      background: #fff;
      border-radius: 50%;
      transition: all 0.2s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    #${pid} .toggle.on::after { left: 20px; }
    #${pid} .select {
      height: 26px;
      padding: 3px 8px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #f8fafc;
      font-size: 11px;
      outline: none;
      cursor: pointer;
    }
    #${pid} .delay-inputs {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #${pid} .delay-sep {
      font-size: 10px;
      color: #94a3b8;
      line-height: 1;
    }
    #${pid} [data-auto-delay-row] {
      display: none;
    }
    #${pid} [data-wizard-row] {
      display: none !important;
    }
    #${pid} .select:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    #${pid} .select option { background: #1e1e2e; }
    #${pid} .elo-display {
      padding: 6px 12px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 8px;
      color: #a5b4fc;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    /* Tooltips */
    #${pid} .row-label {
      position: relative;
      cursor: help;
    }
    #${pid} .tooltip {
      visibility: hidden;
      opacity: 0;
      position: absolute;
      bottom: calc(100% + 10px);
      left: 0;
      width: 220px;
      padding: 12px;
      background: linear-gradient(135deg, #1a1a2e 0%, #252540 100%);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 12px;
      font-size: 11px;
      line-height: 1.5;
      color: #cbd5e1;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      z-index: 100;
      transition: all 0.2s ease;
      pointer-events: none;
    }
    #${pid} .tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 20px;
      border: 8px solid transparent;
      border-top-color: rgba(99, 102, 241, 0.3);
    }
    #${pid} .row-label:hover .tooltip {
      visibility: visible;
      opacity: 1;
    }
    #${pid} .premium-crown-lock .tooltip {
      left: auto;
      right: -10px;
      width: 210px;
    }
    #${pid} .premium-crown-lock .tooltip::after {
      left: auto;
      right: 10px;
    }
    #${pid} .premium-crown-lock:hover .tooltip,
    #${pid} .premium-crown-lock.show-tooltip .tooltip {
      visibility: visible;
      opacity: 1;
    }
    #${pid} .tooltip .warn {
      display: block;
      margin-top: 8px;
      padding: 6px 8px;
      background: rgba(239, 68, 68, 0.15);
      border-left: 3px solid #ef4444;
      border-radius: 4px;
      color: #fca5a5;
      font-size: 10px;
    }
    #${pid} .tooltip .tip {
      color: #22c55e;
      font-weight: 600;
    }

    #${pid} .mini {
      display: none;
      padding: 16px;
      text-align: center;
      cursor: pointer;
    }
    #${pid}.min .mini { display: block; }
    #${pid} .mini-move {
      font-size: 28px;
      font-weight: 800;
      color: #22c55e;
      font-family: 'SF Mono', monospace;
    }
    #${pid} .mini-eval {
      font-size: 12px;
      color: #64748b;
      margin-top: 4px;
    }

    /* Hide Suggestion / Per-line Reveal */
    #${pid} .best-section { position: relative; }

    /* Best card hidden state */
    #${pid} .best-card.line-hidden { position: relative; }
    #${pid} .best-card.line-hidden .best-move,
    #${pid} .best-card.line-hidden .best-eval {
      filter: blur(8px);
      user-select: none;
      pointer-events: none;
      opacity: 0.3;
    }
    #${pid} .best-card .best-label,
    #${pid} .best-card .best-move,
    #${pid} .best-card .best-eval {
      position: relative;
      z-index: 1;
    }
    #${pid} .best-card .best-usage,
    #${pid} .best-card .mate-alert {
      position: relative;
      z-index: 3;
    }
    #${pid} .best-card .line-reveal {
      display: none;
      position: absolute;
      top: 42px;
      left: 12px;
      right: 12px;
      height: 46px;
      justify-content: center;
      align-items: center;
      gap: 6px;
      z-index: 2;
      cursor: pointer;
      border-radius: 12px;
      transition: opacity 0.2s;
      background: transparent;
    }
    #${pid} .best-card.line-hidden .line-reveal { display: flex; }
    #${pid} .line-reveal i {
      font-size: 20px;
      color: rgba(255, 255, 255, 0.7);
      transition: all 0.2s;
    }
    #${pid} .line-reveal span {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
      font-weight: 600;
    }
    #${pid} .line-reveal:hover {
      background: transparent;
    }
    #${pid} .line-reveal:hover i {
      color: #fff;
      transform: scale(1.15);
    }
    #${pid} .line-reveal:hover span {
      color: rgba(255, 255, 255, 0.9);
    }

    /* Alt-line hidden state */
    #${pid} .alt-line.line-hidden {
      position: relative;
      cursor: pointer;
      min-height: 32px;
    }
    #${pid} .alt-line.line-hidden .alt-move,
    #${pid} .alt-line.line-hidden .alt-eval {
      filter: blur(6px);
      user-select: none;
      pointer-events: none;
      opacity: 0.3;
    }
    #${pid} .alt-line .line-reveal-alt {
      display: none;
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      justify-content: center;
      align-items: center;
      gap: 5px;
      z-index: 10;
      cursor: pointer;
      border-radius: 8px;
      transition: background 0.2s;
    }
    #${pid} .alt-line.line-hidden .line-reveal-alt { display: flex; }
    #${pid} .line-reveal-alt i {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.6);
      transition: all 0.2s;
    }
    #${pid} .line-reveal-alt span {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.4);
      font-weight: 600;
    }
    #${pid} .alt-line.line-hidden:hover {
      background: rgba(255, 255, 255, 0.04);
    }
    #${pid} .alt-line.line-hidden:hover .line-reveal-alt i {
      color: #fff;
      transform: scale(1.15);
    }
    #${pid} .alt-line.line-hidden:hover .line-reveal-alt span {
      color: rgba(255, 255, 255, 0.8);
    }

    #${pid} .foot {
      padding: 8px 10px;
      border-top: 1px solid rgba(255,255,255,0.06);
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: rgba(0,0,0,0.15);
    }
    #${pid} .foot-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
    }
    #${pid}.min .foot { display: none; }
    #${pid} .rate-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      padding: 7px 12px;
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      border: none;
      border-radius: 10px;
      color: #1e1e2e;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(251, 191, 36, 0.3);
      white-space: nowrap;
    }
    #${pid} .rate-btn-title {
      display: flex;
      align-items: center;
      gap: 5px;
      line-height: 1;
    }
    #${pid} .rate-btn-stars {
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 8px;
      line-height: 1;
    }
    #${pid} .rate-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(251, 191, 36, 0.4);
    }
    #${pid} .foot-banner {
      padding: 6px 10px;
      background: linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(245, 158, 11, 0.1) 100%);
      border: 1px solid rgba(251, 191, 36, 0.2);
      border-radius: 10px;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-width: 0;
      width: 100%;
      max-width: 100%;
      align-self: center;
      flex-wrap: wrap;
    }
    #${pid} .freemium-text {
      font-size: 10px;
      color: #fbbf24;
      font-weight: 600;
      line-height: 1.1;
      white-space: nowrap;
    }
    #${pid} .freemium-text i {
      margin-right: 6px;
    }
    #${pid} .freemium-days {
      font-size: 13px;
      font-weight: 800;
      color: #f59e0b;
    }
    #${pid} .foot-banner.expired {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.1) 100%);
      border-color: rgba(239, 68, 68, 0.2);
    }
    #${pid} .foot-banner.expired .freemium-text {
      color: #f87171;
    }
    #${pid} .foot-banner.paid {
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.12) 0%, rgba(22, 163, 74, 0.08) 100%);
      border-color: rgba(34, 197, 94, 0.2);
    }
    #${pid} .foot-banner.paid .freemium-text {
      color: #22c55e;
    }
    #${pid} .promo-price { font-size:10px; color:#fbbf24; line-height:1; white-space:nowrap; }
    #${pid} .promo-price s { opacity:0.55; font-size:9px; }
    #${pid} .promo-price strong { color:#fff; }
    #${pid} .promo-cd-wrap { font-size:9px; color:#94a3b8; white-space:nowrap; line-height:1; }
    #${pid} .promo-btn { font-size:9px; padding:4px 8px; }
    #${pid} .subscribe-btn {
      display: inline-block;
      margin-left: 8px;
      padding: 6px 14px;
      border: none;
      border-radius: 999px;
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      color: #111827;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    #${pid} .subscribe-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(251, 191, 36, 0.45);
    }
    #${pid} .expired-cta {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 28px 18px;
      text-align: center;
    }
    #${pid} .expired-cta .expired-icon {
      font-size: 32px;
      color: #f87171;
    }
    #${pid} .expired-cta .expired-title {
      font-size: 14px;
      font-weight: 700;
      color: #f1f5f9;
    }
    #${pid} .expired-cta .expired-desc {
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.4;
    }
    #${pid} .expired-cta .subscribe-btn-big {
      display: inline-block;
      padding: 10px 32px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
      margin-top: 4px;
    }
    #${pid} .expired-cta .subscribe-btn-big:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
    }
    #${pid}.min .foot-banner { display: none; }

    /* Drag handle */
    #${pid} .head { cursor: grab; }
    #${pid} .head:active { cursor: grabbing; }
    #${pid}.dragging { opacity: 0.9; transition: none; }

    /* Opening name */
    #${pid} .opening-name {
      font-size: 10px;
      color: #a78bfa;
      font-style: italic;
      text-align: center;
      padding: 8px 18px;
    }

    /* Small screens */
    @media (max-height: 700px) {
      #${pid} { bottom: 8px; right: 8px; max-height: calc(100vh - 16px); }
      #${pid} .head { padding: 8px 12px; }
      #${pid} .logo-icon { width: 24px; height: 24px; font-size: 12px; border-radius: 7px; }
      #${pid} .logo-text { font-size: 12px; }
      #${pid} .logo { gap: 7px; }
      #${pid} .head-btn { width: 24px; height: 24px; }
      #${pid} .body { padding: 8px 12px; }
      #${pid} .status { display: none; }
      #${pid} .dot { width: 8px; height: 8px; }
      #${pid} .status-text { font-size: 10px; }
      #${pid} .best-section { min-height: 142px; margin-bottom: 4px; }
      #${pid} .best-card { min-height: 142px; max-height: 142px; padding: 8px; border-radius: 10px; }
      #${pid} .best-label { font-size: 9px; margin-bottom: 3px; letter-spacing: 1px; }
      #${pid} .best-move { font-size: 20px; }
      #${pid} .best-eval { font-size: 11px; margin-top: 2px; }
      #${pid} .mate-alert { margin-top: 4px; padding: 4px 8px; font-size: 10px; }
      #${pid} .alt-line { padding: 3px 8px; margin-bottom: 2px; }
      #${pid} .alt-move { font-size: 13px; }
      #${pid} .alt-eval { font-size: 10px; }
      #${pid} .alt-lines { margin-top: 6px; padding-top: 6px; }
      #${pid} .settings { padding-top: 5px; }
      #${pid} .row { padding: 2px 0; }
      #${pid} .row-label { font-size: 10px; gap: 6px; }
      #${pid} .toggle { width: 34px; height: 18px; border-radius: 9px; }
      #${pid} .toggle::after { width: 14px; height: 14px; }
      #${pid} .toggle.on::after { left: 18px; }
      #${pid} .input { width: 48px; height: 22px; padding: 2px 6px; font-size: 10px; }
      #${pid} .select { height: 22px; padding: 2px 6px; font-size: 10px; }
      #${pid} .foot { padding: 6px 8px; gap: 4px; }
      #${pid} .foot-actions { gap: 6px; }
      #${pid} .rate-btn { padding: 5px 8px; font-size: 9px; border-radius: 7px; }
      #${pid} .rate-btn-stars { gap: 1px; font-size: 7px; }
      #${pid} .foot-banner { padding: 4px 6px; gap: 4px; }
      #${pid} .freemium-text { font-size: 9px; }
      #${pid} .players { padding: 6px 12px; }
      #${pid} .player-avatar { width: 24px; height: 24px; }
      #${pid} .player-name { font-size: 10px; }
      #${pid} .opening-name { padding: 3px 12px; font-size: 9px; }
      #${pid} .eval-bar-container { width: 10px; }
      #${pid} .eval-bar-score { font-size: 7px; }
    }

  `

  const createUI = () => {
    enforcePlanRestrictions({ schedule: false })

    const style = document.createElement('style')
    style.textContent = CSS
    style.setAttribute(MARKER, '')
    document.head.appendChild(style)

    const el = document.createElement('div')
    el.id = pid
    el.setAttribute(MARKER, '')
    if (STATE.minimized) el.classList.add('min')
    el.innerHTML = `
      <div class="eval-bar-container">
        <div class="eval-bar-white" data-eval-bar>
          <span class="eval-bar-score" data-eval-score>0.0</span>
        </div>
      </div>
      <div class="main-content">
        <div class="inner-scroll">
        <div class="head">
          <div class="logo">
            <div class="logo-icon"><i class="fas fa-chess-knight"></i></div>
            <div class="logo-meta">
              <span class="logo-text">Chess Helper</span>
              <span class="engine-badge"><i class="fas fa-microchip"></i> ${ENGINE_VERSION}</span>
            </div>
          </div>
          <button class="head-btn" data-min><i class="fas fa-minus"></i></button>
        </div>
        <div class="players" data-players>
          <div class="player opponent" data-opponent>
            <img class="player-avatar" data-opp-avatar src="${DEFAULT_AVATAR_SRC}" alt="">
            <div class="player-info">
              <span class="player-name" data-opp-name>Opponent</span>
              <span class="player-color" data-opp-color>White</span>
            </div>
          </div>
          <div class="vs">VS</div>
          <div class="player me" data-me>
            <img class="player-avatar" data-my-avatar src="${DEFAULT_AVATAR_SRC}" alt="">
            <div class="player-info">
              <span class="player-name" data-my-name>You</span>
              <span class="player-color" data-my-color>Black</span>
            </div>
          </div>
        </div>
        <div class="opening-name" data-opening style="padding:8px 18px;font-size:10px;color:#a78bfa;font-style:italic;text-align:center;display:none;"></div>
        <div class="body">
          <div class="runtime-status">
            <span class="runtime-dot wait" data-dot></span>
            <span class="runtime-text" data-status>Starting...</span>
          </div>
          <div class="best-section" data-best-section>
            <div class="best-card ${STATE.hideSuggestion ? 'line-hidden' : ''}" data-line-card="0">
              <div class="best-label"><i class="fas fa-bullseye"></i> Best Move</div>
              <div class="best-move" data-move>...</div>
              <div class="best-eval" data-eval></div>
              <div class="best-usage" data-best-usage>${getUsageBadgeText()}</div>
              <div class="mate-alert" data-mate-alert></div>
              <div class="error-detail" data-error-detail></div>
              <div class="line-reveal" data-reveal-line="0">
                <i class="fas fa-eye"></i>
              </div>
            </div>
            <div class="alt-lines" data-alt-lines></div>
          </div>
        <div class="settings">
          <div class="row">
              <span class="row-label">
              <i class="fas fa-brain"></i> Moves Ahead (Depth)
              <div class="tooltip">
                How many moves the bot analyzes before suggesting.
                Higher = more accurate but slower.
                Depth range: 1-12.
                <span class="warn"><i class="fas fa-exclamation-triangle"></i> Very high values (10+) increase detection risk!</span>
              </div>
            </span>
            <div class="row-control">
              <select class="select" data-depth>
                ${getDepthOptionsHtml()}
              </select>
            </div>
          </div>
          <div class="row">
            <span class="row-label">
              <i class="fas fa-robot"></i> Bot Rating (ELO)
              <div class="tooltip">
                This value is automatically defined by Depth.
                You cannot edit it manually.
                Higher Depth = Higher ELO = Stronger play.
                Values are approximate (not an official Stockfish conversion).
                <span class="warn"><i class="fas fa-exclamation-triangle"></i> High ELO (2000+) can still look suspicious and may increase ban risk.</span>
              </div>
            </span>
            <div class="row-control">
              <span class="elo-display" data-elo>${depthToElo(STATE.depth).label}</span>
            </div>
          </div>
          <div class="row">
            <span class="row-label">
              <i class="fas fa-chess-pawn"></i> Show Enemy Best Move
              <div class="tooltip">
                When enabled, also shows the best move
                during your opponent's turn.
                When disabled, only calculates on YOUR turn.
              </div>
            </span>
            <div class="row-control">
              <div class="toggle ${STATE.skipEnemy ? '' : 'on'}" data-skip></div>
            </div>
          </div>
          <div class="row">
            <span class="row-label">
              <i class="fas fa-hourglass-start"></i> Start at Move
              <div class="tooltip">
                Bot only starts suggesting after X moves.
                Useful to play the opening yourself.
                <span class="warn"><i class="fas fa-exclamation-triangle"></i> Starting at move 1 looks very suspicious!</span>
              </div>
            </span>
            <input type="number" class="input" data-start min="1" max="50" value="${STATE.startMove}">
          </div>
          <div class="row">
            <span class="row-label">
              <i class="fas fa-list-ol"></i> Show Lines (MultiPV)
              <div class="tooltip">
                How many moves to display.
                1 = best move only. 2 to 8 = shows
                alternative moves ranked by strength.
              </div>
            </span>
            <div class="row-control">
              <select class="select" data-lines>
              ${Array.from({ length: PREMIUM_MAX_LINES }, (_, idx) => {
                const value = idx + 1
                const selected = STATE.lines === value ? ' selected' : ''
                const label = value === 1 ? '1 (Best)' : String(value)
                return `<option value="${value}"${selected}>${label}</option>`
              }).join('')}
              </select>
            </div>
          </div>
          <div class="row">
            <span class="row-label">
              <i class="fas fa-chess-knight"></i> Style Mode (Beta)
              <div class="tooltip">
                Changes how the backend chooses among strong Stockfish candidates.
                Default keeps the strongest objective move. Other modes bias the style while preserving move quality.
              </div>
            </span>
            <div class="row-control">
              <select class="select" data-style-mode>
                ${getStyleOptionsHtml()}
              </select>
            </div>
          </div>
          <div class="row">
            <span class="row-label">
              <i class="fas fa-crosshairs"></i> Show Arrows
              <div class="tooltip">
                Draws an arrow on the board showing
                where to move the piece from and to.
                Useful to quickly visualize the move.
                <span class="warn"><i class="fas fa-exclamation-triangle"></i> Visual overlays may be detected by anti-cheat systems!</span>
              </div>
            </span>
            <div class="toggle ${STATE.arrows ? 'on' : ''}" data-arrows></div>
          </div>
          <!-- Auto Delay disabled
          <div class="row" data-auto-delay-row style="${STATE.autoPlay ? '' : 'display:none;'}">
            <span class="row-label">
              <i class="fas fa-clock"></i> Auto Delay
              <div class="tooltip">
                Adds a random delay of 8~12 seconds before
                showing the suggested move.
                Simulates natural thinking time and greatly
                helps avoid detection by anti-cheat systems.
                <span class="tip"><i class="fas fa-check-circle"></i> Highly recommended!</span>
              </div>
            </span>
            <div class="toggle ${STATE.safeMode ? 'on' : ''}" data-safe></div>
          </div>
          -->
          <div class="row">
            <span class="row-label">
              <i class="fas fa-eye-slash"></i> Hide Suggestions
              <div class="tooltip">
                Hides each move line behind an eye icon.
                Click to reveal each line individually.
                Works with MultiPV - choose which lines to see.
                <span class="tip"><i class="fas fa-bolt"></i> More natural & you pick what to reveal!</span>
              </div>
            </span>
            <div class="toggle ${STATE.hideSuggestion ? 'on' : ''}" data-hide></div>
          </div>
          <div class="row">
            <span class="row-label">
              <i class="fas fa-play"></i> Auto Play
              <div class="tooltip">
                Automatically moves the pieces for you based on the best move.
                <span class="warn"><i class="fas fa-exclamation-triangle"></i> HIGH detection risk! Use with caution.</span>
              </div>
            </span>
            <div class="toggle ${STATE.autoPlay ? 'on' : ''}" data-auto></div>
          </div>
          <div class="row" data-auto-delay-row style="${STATE.autoPlay ? '' : 'display:none;'}">
            <span class="row-label">
              <i class="fas fa-clock"></i> Auto Delay
              <div class="tooltip">
                Adds a random delay before requesting a move.
                Configure a min/max range in seconds.
                Example: 1 and 5 = random delay from 1s to 5s.
              </div>
            </span>
            <div class="row-control">
              <div class="delay-inputs">
                <input type="number" class="input" data-delay-min min="0" max="30" value="${STATE.autoDelayMin}">
                <span class="delay-sep">to</span>
                <input type="number" class="input" data-delay-max min="0" max="30" value="${STATE.autoDelayMax}">
              </div>
            </div>
          </div>
          <div class="row">
            <span class="row-label">
              <i class="fas fa-magnifying-glass-chart"></i> Analyze My Moves (Beta)
              <div class="tooltip">
                Evaluates each move you actually play and returns move quality
                (Brilliant, Excellent, Inaccuracy, Mistake, etc).
              </div>
            </span>
            <div class="toggle ${STATE.analyzePlayerMoves ? 'on' : ''}" data-analyze></div>
          </div>
          <div class="row" data-wizard-row style="display:none;">
            <span class="row-label">
              <i class="fas fa-hat-wizard"></i> Wizard Chess
              <div class="tooltip">
                Replaces all pieces with Wizard Chess style pieces.
                Pure cosmetic - does not affect gameplay.
              </div>
            </span>
            <div class="toggle ${STATE.wizardChess ? 'on' : ''}" data-wizard></div>
          </div>
        </div>
      </div>
      </div>
        <div class="mini">
          <div class="mini-move" data-mmove>...</div>
          <div class="mini-eval" data-meval></div>
        </div>
        <div class="foot"></div>
      </div>
    `
    document.body.appendChild(el)

    // Apply saved position
    try {
      const savedPos = localStorage.getItem(STORAGE.panelPos)
      if (savedPos) {
        const { x, y } = JSON.parse(savedPos)
        el.style.right = 'auto'
        el.style.bottom = 'auto'
        el.style.left = Math.min(x, window.innerWidth - 300) + 'px'
        el.style.top = Math.min(y, window.innerHeight - 200) + 'px'
      }
    } catch {}

    bindEvents(el)

    // Update subscription banner (uses backend-managed state)
    updateFreemiumBanner()

    return el
  }

  const hideAllLines = () => {
    if (!STATE.ui) return
    const bestCard = STATE.ui.querySelector('[data-line-card="0"]')
    if (bestCard) bestCard.classList.add('line-hidden')
    STATE.ui.querySelectorAll('.alt-line').forEach(el => el.classList.add('line-hidden'))
    clearCanvas()
  }

  const revealAllLines = () => {
    if (!STATE.ui) return
    const bestCard = STATE.ui.querySelector('[data-line-card="0"]')
    if (bestCard) bestCard.classList.remove('line-hidden')
    STATE.ui.querySelectorAll('.alt-line').forEach(el => el.classList.remove('line-hidden'))
  }

  const bindEvents = (el) => {
    // Drag functionality
    const head = el.querySelector('.head')
    let isDragging = false
    let startX, startY, startLeft, startTop

    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('.head-btn')) return // Don't drag when clicking button
      isDragging = true
      el.classList.add('dragging')
      const rect = el.getBoundingClientRect()
      startX = e.clientX
      startY = e.clientY
      startLeft = rect.left
      startTop = rect.top
      e.preventDefault()
    })

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const newLeft = Math.max(0, Math.min(startLeft + dx, window.innerWidth - el.offsetWidth))
      const newTop = Math.max(0, Math.min(startTop + dy, window.innerHeight - el.offsetHeight))
      el.style.right = 'auto'
      el.style.bottom = 'auto'
      el.style.left = newLeft + 'px'
      el.style.top = newTop + 'px'
    })

    document.addEventListener('mouseup', () => {
      if (!isDragging) return
      isDragging = false
      el.classList.remove('dragging')
      // Save position
      try {
        const rect = el.getBoundingClientRect()
        localStorage.setItem(STORAGE.panelPos, JSON.stringify({ x: rect.left, y: rect.top }))
      } catch {}
    })

    const applyMinimized = (nextValue) => {
      STATE.minimized = !!nextValue
      el.classList.toggle('min', STATE.minimized)
      const icon = el.querySelector('[data-min] i')
      if (icon) icon.className = STATE.minimized ? 'fas fa-plus' : 'fas fa-minus'
      try { localStorage.setItem(STORAGE.minimized, STATE.minimized ? '1' : '0') } catch {}
    }

    applyMinimized(STATE.minimized)

    const minBtn = el.querySelector('[data-min]')
    if (minBtn) {
      minBtn.onclick = () => applyMinimized(!STATE.minimized)
    }

    const miniPanel = el.querySelector('.mini')
    if (miniPanel) {
      miniPanel.addEventListener('click', () => {
        if (!STATE.minimized) return
        applyMinimized(false)
      })
    }

    el.querySelector('[data-depth]').oninput = (e) => {
      const raw = Number.parseInt(e.target.value, 10)
      if (!hasPremiumAccess() && Number.isFinite(raw) && raw > FREE_MAX_DEPTH) {
        showPremiumLockTooltip('[data-depth-lock]')
      }
      const n = clampDepthByPlan(e.target.value, STATE.depth || 6)
      if (e.target.value !== String(n)) e.target.value = String(n)
      el.querySelector('[data-elo]').textContent = depthToElo(n).label
    }

    el.querySelector('[data-depth]').onchange = (e) => {
      const raw = Number.parseInt(e.target.value, 10)
      const premium = hasPremiumAccess()
      if (!hasPremiumAccess() && Number.isFinite(raw) && raw > FREE_MAX_DEPTH) {
        showPremiumLockTooltip('[data-depth-lock]')
      }
      const n = clampDepthByPlan(e.target.value, STATE.depth || 6)
      e.target.value = n
      STATE.depth = n
      try { localStorage.setItem(STORAGE.depth, n) } catch {}
      el.querySelector('[data-elo]').textContent = depthToElo(n).label
      invalidate()
      scheduleUpdate()
      const counters = {
        [telemetryValueKey('depth_attempt_value', raw, { min: 1, max: 50 })]: 1,
        [`depth_applied_value_${n}`]: 1,
        [`bot_rating_depth_${n}`]: 1,
      }
      if (raw == null) counters.depth_attempt_invalid = (counters.depth_attempt_invalid || 0) + 1
      if (raw != null && raw !== n) counters.depth_clamped = 1
      if (!premium && raw != null && raw > FREE_MAX_DEPTH) counters.depth_attempt_over_free_limit = 1
      if (raw != null && raw > PREMIUM_MAX_DEPTH) counters.depth_attempt_over_premium_max = 1
      queueFeatureUsage('change_depth', { counters })
    }

    el.querySelector('[data-skip]').onclick = function() {
      if (!hasPremiumAccess()) {
        showPremiumLockTooltip('[data-enemy-lock]')
        queueFeatureUsage('toggle_show_enemy_best_move', {
          counters: { show_enemy_best_move_attempt_blocked_free: 1 },
        })
        return
      }
      const enablingShowEnemy = !!STATE.skipEnemy
      if (enablingShowEnemy) {
        disableHideSuggestions({
          reason: 'Hide Suggestions desligado: Show Enemy Best Move ligado',
          highlightSelectors: ['[data-skip]'],
        })
      }
      STATE.skipEnemy = !STATE.skipEnemy
      this.classList.toggle('on', !STATE.skipEnemy)
      try { localStorage.setItem(STORAGE.skipEnemy, STATE.skipEnemy ? '1' : '0') } catch {}
      invalidate()
      scheduleUpdate()
      queueFeatureUsage('toggle_show_enemy_best_move', {
        counters: { [`setting_show_enemy_best_move_${STATE.skipEnemy ? 'off' : 'on'}`]: 1 },
      })
    }

    el.querySelector('[data-start]').onchange = (e) => {
      const raw = Number.parseInt(e.target.value, 10)
      const n = Math.max(1, parseInt(e.target.value) || 1)
      e.target.value = n
      STATE.startMove = n
      try { localStorage.setItem(STORAGE.startMove, n) } catch {}
      invalidate()
      scheduleUpdate()
      queueFeatureUsage('change_start_move', {
        counters: {
          [telemetryValueKey('start_move_attempt_value', raw, { min: 1, max: 300 })]: 1,
          [telemetryValueKey('start_move_applied_value', n, { min: 1, max: 300 })]: 1,
          ...(raw != null && raw !== n ? { start_move_clamped: 1 } : {}),
        },
      })
    }

    const linesSelect = el.querySelector('[data-lines]')
    const handleLinesChange = (e) => {
      const target = e?.target
      if (!target) return
      const raw = Number.parseInt(target.value, 10)
      if (!hasPremiumAccess()) {
        showPremiumLockTooltip('[data-lines-lock]')
        target.value = '1'
        setLines(1)
        queueFeatureUsage('change_multipv', {
          counters: {
            [telemetryValueKey('multipv_attempt_value', raw, { min: 1, max: 10 })]: 1,
            multipv_applied_value_1: 1,
            multipv_attempt_blocked_free: 1,
          },
        })
        return
      }
      const v = clampLinesByPlan(target.value, STATE.lines)
      if (target.value !== String(v)) target.value = String(v)
      const changed = setLines(v)
      if (changed) {
        queueFeatureUsage('change_multipv', {
          counters: {
            [telemetryValueKey('multipv_attempt_value', raw, { min: 1, max: 10 })]: 1,
            [telemetryValueKey('multipv_applied_value', v, { min: 1, max: 10 })]: 1,
            ...(raw != null && raw !== v ? { multipv_clamped: 1 } : {}),
          },
        })
      }
    }
    if (linesSelect) {
      const showLinesPremiumHint = () => {
        if (!hasPremiumAccess()) showPremiumLockTooltip('[data-lines-lock]')
      }
      linesSelect.addEventListener('change', handleLinesChange)
      linesSelect.addEventListener('input', handleLinesChange)
      linesSelect.addEventListener('mousedown', showLinesPremiumHint)
      linesSelect.addEventListener('focus', showLinesPremiumHint)
    }

    const styleSelect = el.querySelector('[data-style-mode]')
    const handleStyleModeChange = (e) => {
      const target = e?.target
      if (!target) return
      const requested = normalizeStyleMode(target.value, 'default')
      const premium = hasPremiumAccess()
      if (!premium && requested !== 'default') {
        showPremiumLockTooltip('[data-style-lock]')
        target.value = 'default'
        if (STATE.styleMode !== 'default') {
          STATE.styleMode = 'default'
          try { localStorage.setItem(STORAGE.styleMode, 'default') } catch {}
          invalidate()
          scheduleUpdate()
        }
        queueFeatureUsage('change_style_mode', {
          counters: {
            [`style_mode_attempt_${requested}`]: 1,
            style_mode_attempt_blocked_free: 1,
            style_mode_applied_default: 1,
          },
        })
        return
      }
      const next = clampStyleModeByPlan(requested, 'default')
      target.value = next
      if (next === STATE.styleMode) return
      STATE.styleMode = next
      try { localStorage.setItem(STORAGE.styleMode, next) } catch {}
      invalidate()
      scheduleUpdate()
      queueFeatureUsage('change_style_mode', {
        counters: {
          [`style_mode_attempt_${requested}`]: 1,
          [`style_mode_applied_${next}`]: 1,
        },
      })
    }
    if (styleSelect) {
      const showStylePremiumHint = () => {
        if (!hasPremiumAccess()) showPremiumLockTooltip('[data-style-lock]')
      }
      styleSelect.addEventListener('change', handleStyleModeChange)
      styleSelect.addEventListener('input', handleStyleModeChange)
      styleSelect.addEventListener('mousedown', showStylePremiumHint)
      styleSelect.addEventListener('focus', showStylePremiumHint)
    }

    const bannerPremiumBtn = el.querySelector('[data-subscribe-banner]')
    if (bannerPremiumBtn) {
      bannerPremiumBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        openCheckout({ promo: isPromoActive() })
      })
    }

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-upgrade-usage]')
      if (!btn) return
      e.preventDefault()
      e.stopPropagation()
      openCheckout({ promo: isPromoActive() })
    })

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-promo-checkout]')
      if (!btn) return
      e.preventDefault(); e.stopPropagation()
      openCheckout({ promo: true })
    })

    el.querySelector('[data-arrows]').onclick = function() {
      STATE.arrows = !STATE.arrows
      this.classList.toggle('on', STATE.arrows)
      try { localStorage.setItem(STORAGE.arrows, STATE.arrows ? '1' : '0') } catch {}
      if (STATE.arrows && getMoveUci(STATE.lastMoves?.[0])) {
        drawArrows(STATE.board)
      } else {
        clearCanvas()
      }
      queueFeatureUsage('toggle_show_arrows', {
        counters: { [`setting_show_arrows_${STATE.arrows ? 'on' : 'off'}`]: 1 },
      })
    }

    // Auto Delay disabled
    // el.querySelector('[data-safe]').onclick = function() {
    //   STATE.safeMode = !STATE.safeMode
    //   this.classList.toggle('on', STATE.safeMode)
    //   try { localStorage.setItem(STORAGE.safeMode, STATE.safeMode ? '1' : '0') } catch {}
    // }

    const sanitizeDelayInput = (value) => {
      const n = Number.parseInt(value, 10)
      if (!Number.isFinite(n)) return 0
      return Math.max(0, Math.min(30, n))
    }
    const applyDelayRange = () => {
      const minInput = el.querySelector('[data-delay-min]')
      const maxInput = el.querySelector('[data-delay-max]')
      if (!minInput || !maxInput) return
      if (!STATE.autoPlay) {
        disableAutoDelay({ syncUi: true })
        return
      }
      const rawMin = Number.parseInt(minInput.value, 10)
      const rawMax = Number.parseInt(maxInput.value, 10)
      let min = sanitizeDelayInput(minInput.value)
      let max = sanitizeDelayInput(maxInput.value)
      if (max < min) max = min
      minInput.value = String(min)
      maxInput.value = String(max)
      STATE.autoDelayMin = min
      STATE.autoDelayMax = max
      let prevMin = 0
      let prevMax = 0
      try {
        prevMin = Number.parseInt(localStorage.getItem(STORAGE.autoDelayMin) || '0', 10)
        prevMax = Number.parseInt(localStorage.getItem(STORAGE.autoDelayMax) || '0', 10)
      } catch {}
      try {
        localStorage.setItem(STORAGE.autoDelayMin, String(min))
        localStorage.setItem(STORAGE.autoDelayMax, String(max))
      } catch {}
      if (prevMin !== min || prevMax !== max) {
        queueFeatureUsage('change_auto_delay', {
          counters: {
            [telemetryValueKey('auto_delay_min_attempt_value', rawMin, { min: 0, max: 30 })]: 1,
            [telemetryValueKey('auto_delay_max_attempt_value', rawMax, { min: 0, max: 30 })]: 1,
            [`auto_delay_min_applied_value_${min}`]: 1,
            [`auto_delay_max_applied_value_${max}`]: 1,
            [`auto_delay_range_${min}_${max}`]: 1,
            ...(rawMin != null && rawMin !== min ? { auto_delay_min_clamped: 1 } : {}),
            ...(rawMax != null && rawMax !== max ? { auto_delay_max_clamped: 1 } : {}),
          },
        })
      }
    }
    const delayMinInput = el.querySelector('[data-delay-min]')
    const delayMaxInput = el.querySelector('[data-delay-max]')
    if (delayMinInput) {
      delayMinInput.addEventListener('input', applyDelayRange)
      delayMinInput.addEventListener('change', applyDelayRange)
    }
    if (delayMaxInput) {
      delayMaxInput.addEventListener('input', applyDelayRange)
      delayMaxInput.addEventListener('change', applyDelayRange)
    }
    applyDelayRange()
    syncAutoDelayControls()

    const flashSettingBlocked = (...toggleSelectors) => {
      const uniq = Array.from(new Set(toggleSelectors.filter(Boolean)))
      uniq.forEach((toggleSelector) => {
        const toggleEl = el.querySelector(toggleSelector)
        if (!toggleEl) return
        toggleEl.classList.add('blocked')
        toggleEl.removeAttribute('title')
        setTimeout(() => {
          try { toggleEl.classList.remove('blocked') } catch {}
        }, 1200)
      })
      // Ensure no old warning text remains anywhere in move review area.
      if (
        typeof STATE.moveReviewPinnedText === 'string' &&
        (STATE.moveReviewPinnedText.includes('Desative Hide Suggestions para habilitar Auto Play') ||
          STATE.moveReviewPinnedText.includes('Auto Play desligado: Hide Suggestions esta ligado'))
      ) {
        STATE.moveReviewPinnedText = ''
        STATE.moveReviewPinnedKind = ''
        STATE.moveReviewPinnedAt = 0
      }
      if (STATE.ui) {
        setUI({
          status: '',
          type: '',
          move: STATE.ui.querySelector('[data-move]')?.textContent || '...',
          evalStr: STATE.lastEval || '',
          score: STATE.lastScore || null,
        })
      }
    }

    el.querySelector('[data-hide]').onclick = function() {
      STATE.hideSuggestion = !STATE.hideSuggestion
      this.classList.toggle('on', STATE.hideSuggestion)
      try { localStorage.setItem(STORAGE.hideSuggestion, STATE.hideSuggestion ? '1' : '0') } catch {}
      if (STATE.hideSuggestion) {
        if (!STATE.skipEnemy) {
          STATE.skipEnemy = true
          const skipToggle = el.querySelector('[data-skip]')
          if (skipToggle) skipToggle.classList.remove('on')
          try { localStorage.setItem(STORAGE.skipEnemy, '1') } catch {}
          flashSettingNotice('Show Enemy Best Move desligado: Hide Suggestions ligado', '[data-hide]', '[data-skip]')
          queueFeatureUsage('toggle_show_enemy_best_move', {
            counters: {
              setting_show_enemy_best_move_off: 1,
              show_enemy_best_move_forced_off_hide_suggestions_on: 1,
            },
          })
        }
        if (STATE.autoPlay) {
          STATE.autoPlay = false
          const autoToggle = el.querySelector('[data-auto]')
          if (autoToggle) autoToggle.classList.remove('on')
          try { localStorage.setItem(STORAGE.autoPlay, '0') } catch {}
          disableAutoDelay({ syncUi: true })
          syncAutoDelayControls()
          queueFeatureUsage('toggle_auto_play', {
            counters: {
              setting_auto_play_off: 1,
              auto_play_forced_off_hide_suggestions_on: 1,
            },
          })
          flashSettingNotice('Auto Play desligado: Hide Suggestions ligado', '[data-auto]', '[data-hide]')
        }
        STATE.revealedLines.clear()
        hideAllLines()
      } else {
        revealAllLines()
        scheduleUpdate()
      }
      queueFeatureUsage('toggle_hide_suggestions', {
        counters: { [`setting_hide_suggestions_${STATE.hideSuggestion ? 'on' : 'off'}`]: 1 },
      })
    }

    el.querySelector('[data-auto]').onclick = function() {
      const enablingAutoPlay = !STATE.autoPlay
      if (enablingAutoPlay) {
        disableHideSuggestions({
          reason: 'Hide Suggestions desligado: Auto Play ligado',
          highlightSelectors: ['[data-auto]'],
        })
      }
      STATE.autoPlay = !STATE.autoPlay
      this.classList.toggle('on', STATE.autoPlay)
      try { localStorage.setItem(STORAGE.autoPlay, STATE.autoPlay ? '1' : '0') } catch {}
      if (STATE.autoPlay) {
        STATE.lastAutoMoveFen = null
        STATE.lastAutoTryAt = 0
        scheduleUpdate()
      } else {
        disableAutoDelay({ syncUi: true })
      }
      syncAutoDelayControls()
      queueFeatureUsage('toggle_auto_play', {
        counters: { [`setting_auto_play_${STATE.autoPlay ? 'on' : 'off'}`]: 1 },
      })
    }

    el.querySelector('[data-analyze]').onclick = function() {
      if (!hasPremiumAccess()) {
        STATE.analyzePlayerMoves = false
        this.classList.remove('on')
        try { localStorage.setItem(STORAGE.analyzePlayerMoves, '0') } catch {}
        clearMoveReviewBadges()
        showPremiumLockTooltip('[data-analyze-lock]')
        queueFeatureUsage('toggle_analyze_player_moves', {
          counters: { analyze_player_moves_attempt_blocked_free: 1 },
        })
        return
      }
      STATE.analyzePlayerMoves = !STATE.analyzePlayerMoves
      this.classList.toggle('on', STATE.analyzePlayerMoves)
      try { localStorage.setItem(STORAGE.analyzePlayerMoves, STATE.analyzePlayerMoves ? '1' : '0') } catch {}
      if (!STATE.analyzePlayerMoves) {
        STATE.moveReviewFlashText = ''
        STATE.moveReviewPinnedText = ''
        STATE.moveReviewByPly = new Map()
        clearMoveReviewBadges()
      } else {
        renderMoveReviewBadges()
      }
      queueFeatureUsage('toggle_analyze_player_moves', {
        counters: { [`setting_analyze_player_moves_${STATE.analyzePlayerMoves ? 'on' : 'off'}`]: 1 },
      })
      queueFeatureUsage(null, { immediate: true })
    }

    const wizardToggle = el.querySelector('[data-wizard]')
    if (wizardToggle) {
      wizardToggle.onclick = function() {
        STATE.wizardChess = !STATE.wizardChess
        this.classList.toggle('on', STATE.wizardChess)
        try { localStorage.setItem(STORAGE.wizardChess, STATE.wizardChess ? '1' : '0') } catch {}
        applyWizardChess()
        queueFeatureUsage('toggle_wizard_chess', {
          counters: { [`setting_wizard_chess_${STATE.wizardChess ? 'on' : 'off'}`]: 1 },
        })
      }
    }

    const flashSettingNotice = (message, ...toggleSelectors) => {
      const uniq = Array.from(new Set(toggleSelectors.filter(Boolean)))
      uniq.forEach((toggleSelector) => {
        const toggleEl = el.querySelector(toggleSelector)
        if (!toggleEl) return
        toggleEl.classList.add('notice')
        setTimeout(() => {
          try { toggleEl.classList.remove('notice') } catch {}
        }, 1400)
      })
      if (message) {
        STATE.moveReviewFlashText = message
        STATE.moveReviewFlashKind = 'good'
        STATE.moveReviewFlashUntil = Date.now() + 2600
      }
      if (STATE.ui) {
        setUI({
          status: message || '',
          type: '',
          move: STATE.ui.querySelector('[data-move]')?.textContent || '...',
          evalStr: STATE.lastEval || '',
          score: STATE.lastScore || null,
        })
      }
    }

    const disableHideSuggestions = ({ reason = '', highlightSelectors = [] } = {}) => {
      if (!STATE.hideSuggestion) return false
      STATE.hideSuggestion = false
      const hideToggle = el.querySelector('[data-hide]')
      if (hideToggle) hideToggle.classList.remove('on')
      try { localStorage.setItem(STORAGE.hideSuggestion, '0') } catch {}
      revealAllLines()
      flashSettingNotice(reason, '[data-hide]', ...highlightSelectors)
      return true
    }

    // Delegated click for per-line reveal buttons

    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-reveal-line]')
      if (!btn) return

      const lineIdx = parseInt(btn.getAttribute('data-reveal-line'))

      // If data not loaded yet, fetch it
      if (!STATE.stable && STATE.pendingFen) {
        await fetchAndShowMove(STATE.pendingFen, true)
      }

      if (!STATE.lastMoves.length) return

      // Mark this line as revealed
      STATE.revealedLines.add(lineIdx)
      queueFeatureUsage('reveal_line')

      // Reveal this line's card
      const card = el.querySelector(`[data-line-card="${lineIdx}"]`)
      if (card) card.classList.remove('line-hidden')

      // Update suggested move tracking
      const m = STATE.lastMoves[lineIdx]
      if (lineIdx === 0 && getMoveUci(m)) STATE.lastSuggestedMove = getMoveUci(m)

      // Update UI - show best move info only if line 0 is revealed
      if (STATE.stable) {
        const best = STATE.lastMoves[0]
        setUI({
          status: '',
          type: '',
          move: STATE.revealedLines.has(0) ? getMoveText(best) : '...',
          evalStr: STATE.revealedLines.has(0) ? (STATE.lastEval || '') : '',
          score: STATE.revealedLines.has(0) ? STATE.lastScore : null
        })
      }

      // Redraw arrows for only revealed lines
      if (STATE.arrows && STATE.board) drawArrows(STATE.board)
    })

    const rateBtn = el.querySelector('[data-rate]')
    if (rateBtn) {
      rateBtn.onclick = () => {
        try { chrome.runtime.sendMessage({ type: '__fen_stockfish_open_review__' }) } catch {}
      }
    }

    // Sync initial state once UI is mounted.
    queueFeatureUsage(null, { immediate: true })
  }

  const handleLinesEvent = (e) => {
    const target = e?.target
    if (!target || !target.matches?.('[data-lines]')) return
    const v = clampLinesByPlan(target.value, STATE.lines)
    if (target.value !== String(v)) target.value = String(v)
    setLines(v)
  }
  document.addEventListener('change', handleLinesEvent, true)
  document.addEventListener('input', handleLinesEvent, true)

  const updateUserInfo = () => {
    if (!STATE.ui || !currentUser) return

    const playersEl = STATE.ui.querySelector('[data-players]')
    playersEl.classList.add('show')

    // Update my info (bottom player)
    const myAvatar = STATE.ui.querySelector('[data-my-avatar]')
    const myName = STATE.ui.querySelector('[data-my-name]')
    const myColor = STATE.ui.querySelector('[data-my-color]')

    setAvatarImage(myAvatar, currentUser.avatar)
    myName.textContent = currentUser.username || 'You'
    if (userColor) {
      myColor.textContent = userColor.charAt(0).toUpperCase() + userColor.slice(1)
      myColor.className = `player-color ${userColor}`
    }

    // Update opponent info (top player)
    if (opponent) {
      const oppAvatar = STATE.ui.querySelector('[data-opp-avatar]')
      const oppName = STATE.ui.querySelector('[data-opp-name]')
      const oppColor = STATE.ui.querySelector('[data-opp-color]')

      setAvatarImage(oppAvatar, opponent.avatar)
      oppName.textContent = opponent.username || 'Opponent'
      const oppColorValue = userColor === 'white' ? 'black' : 'white'
      oppColor.textContent = oppColorValue.charAt(0).toUpperCase() + oppColorValue.slice(1)
      oppColor.className = `player-color ${oppColorValue}`
    }
  }

  const setUI = ({ status, type, move, evalStr, score, errorDetail, scoreFen }) => {
    const justCreated = !STATE.ui
    if (!STATE.ui) STATE.ui = createUI()
    if (justCreated) updateFreemiumBanner()

    const dotEl = STATE.ui.querySelector('[data-dot]')
    if (dotEl) dotEl.className = `dot ${type || 'wait'}`
    const statusEl = STATE.ui.querySelector('[data-status]')
    if (statusEl) {
      let statusText = status || ''
      if (!statusText && STATE.moveReviewFlashText && Date.now() < (STATE.moveReviewFlashUntil || 0)) {
        statusText = STATE.moveReviewFlashText
      }
      statusEl.textContent = statusText
    }
    STATE.ui.querySelector('[data-move]').textContent = move || '...'
    const errEl = STATE.ui.querySelector('[data-error-detail]')
    if (errEl) errEl.textContent = errorDetail || ''

    const evalEl = STATE.ui.querySelector('[data-eval]')
    const hasLiveScore = !!score
    if (hasLiveScore) {
      STATE.overrideScoreUntil = 0
      STATE.overrideScore = null
      STATE.overrideEval = ''
      STATE.overrideFen = ''
    }
    const hasOverrideScore = !hasLiveScore && Date.now() < (STATE.overrideScoreUntil || 0) && STATE.overrideScore
    if (hasOverrideScore) {
      score = STATE.overrideScore
      if (!evalStr) evalStr = STATE.overrideEval || evalStr
    }

    const shouldKeepLastEval =
      !score &&
      !evalStr &&
      type !== 'err' &&
      type !== 'nogame'
    if (!shouldKeepLastEval) {
      evalEl.textContent = evalStr || ''
      evalEl.className = 'best-eval'
      if (evalStr?.startsWith('M')) evalEl.classList.add('mate')
      else if (evalStr?.startsWith('-')) evalEl.classList.add('neg')
    }

    // Normalize score to White's perspective
    // Stockfish returns scores from side-to-move's perspective
    // We need to negate when it's Black's turn so the eval bar is always White-relative
    const effectiveScoreFen = scoreFen || (hasOverrideScore ? (STATE.overrideFen || STATE.lastFen) : STATE.lastFen)
    const fenTurn = effectiveScoreFen ? getTurnFromFen(effectiveScoreFen) : 'w'
    const flipSign = fenTurn === 'b' ? -1 : 1
    // Update vertical eval bar (Chess.com style) - always from White's perspective
    const evalBar = STATE.ui.querySelector('[data-eval-bar]')
    const evalScoreEl = STATE.ui.querySelector('[data-eval-score]')

    if (shouldKeepLastEval) {
      // keep previous bar/score while requesting next move
    } else if (score && score.type === 'cp') {
      const whiteCP = score.value * flipSign
      const clampedCP = Math.max(-1200, Math.min(1200, whiteCP))
      const pct = 50 + (clampedCP / 1200) * 50
      evalBar.style.height = `${pct}%`
      const pawnScore = whiteCP / 100
      evalScoreEl.textContent = (pawnScore > 0 ? '+' : '') + pawnScore.toFixed(1)
    } else if (score && score.type === 'mate') {
      const whiteMate = score.value * flipSign
      evalBar.style.height = whiteMate > 0 ? '95%' : '5%'
      const mateScore = whiteMate > 0 ? MATE_PAWN_EQ : -MATE_PAWN_EQ
      evalScoreEl.textContent = (mateScore > 0 ? '+' : '') + mateScore.toFixed(1)
    }

    // Mate alert
    const mateAlert = STATE.ui.querySelector('[data-mate-alert]')
    if (mateAlert) {
      mateAlert.className = 'mate-alert'
      mateAlert.textContent = ''
      if (score && score.type === 'mate') {
        const movesUntilMate = Math.abs(score.value)
        // score.value > 0 means the side-to-move can deliver mate
        // We need to check if that's the USER or the opponent
        const myTurnLetter = userColor === 'white' ? 'w' : 'b'
        const iCanMate = (score.value > 0 && fenTurn === myTurnLetter) || (score.value < 0 && fenTurn !== myTurnLetter)

        if (iCanMate) {
          mateAlert.className = 'mate-alert winning'
          mateAlert.innerHTML = `<i class="fas fa-crown"></i> Checkmate in ${movesUntilMate}!`
        } else {
          mateAlert.className = 'mate-alert losing'
          mateAlert.innerHTML = `<i class="fas fa-skull-crossbones"></i> You get mated in ${movesUntilMate}`
        }
      }
    }

    STATE.ui.querySelector('[data-mmove]').textContent = move || '...'
    if (!shouldKeepLastEval) {
      STATE.ui.querySelector('[data-meval]').textContent = evalStr || ''
    }

    const bestCardEl = STATE.ui.querySelector('[data-line-card="0"]')
    const bestLabelEl = bestCardEl?.querySelector('.best-label')
    const bestUsageEl = STATE.ui.querySelector('[data-best-usage]')
    if (bestCardEl) bestCardEl.classList.remove('limit-state')
    if (bestLabelEl && bestLabelEl.textContent?.trim() === 'Reset in') {
      bestLabelEl.innerHTML = '<i class="fas fa-bullseye"></i> Best Move'
    }
    if (bestUsageEl) bestUsageEl.classList.remove('limit-layout')
    const pinnedText = String(STATE.moveReviewPinnedText || '').trim()
    if (bestUsageEl && pinnedText) {
      const clsRaw = String(STATE.moveReviewPinnedKind || '').toLowerCase()
      const cls = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'].includes(clsRaw)
        ? clsRaw
        : 'good'
      const idx = pinnedText.indexOf(' - ')
      const mv = idx > 0 ? pinnedText.slice(0, idx) : pinnedText
      const lb = idx > 0 ? pinnedText.slice(idx + 3) : ''
      const labelText = String(lb || mv || '').trim()
      const compactLabel =
        STATE.hideSuggestion && labelText
          ? `${mv}: ${labelText}${/move$/i.test(labelText) ? '' : ' Move'}`
          : labelText
      if (STATE.hideSuggestion) {
        bestUsageEl.innerHTML = `<div class="move-review compact is-${cls}"><span class="move-review-move"></span><span class="move-review-label">${compactLabel}</span></div>`
      } else {
        bestUsageEl.innerHTML = `<div class="move-review is-${cls}"><span class="move-review-move">${mv}</span><span class="move-review-label">${labelText}</span></div>`
      }
    } else if (bestUsageEl) {
      bestUsageEl.textContent = getUsageBadgeText()
    }

    // Update best-card hidden state (line 0)
    const bestCard = STATE.ui.querySelector('[data-line-card="0"]')
    const shouldHideLines = STATE.hideSuggestion
    if (bestCard && shouldHideLines) {
      if (STATE.revealedLines.has(0)) {
        bestCard.classList.remove('line-hidden')
      } else {
        bestCard.classList.add('line-hidden')
      }
    } else if (bestCard) {
      bestCard.classList.remove('line-hidden')
    }

    // Render alternative lines (MultiPV)
    // Always render placeholders when lines > 1 to prevent panel size oscillation
    const altContainer = STATE.ui.querySelector('[data-alt-lines]')
    if (altContainer) {
      altContainer.innerHTML = ''
      if (STATE.lines > 1) {
        for (let i = 1; i < STATE.lines; i++) {
          const alt = STATE.isEnemyTurn ? null : STATE.lastMoves[i]
          const hasData = !!alt
          const altEvalStr = hasData ? formatEval(alt.score) : ''
          const isHidden = shouldHideLines && !STATE.revealedLines.has(i)
          const div = document.createElement('div')
          div.className = `alt-line${isHidden ? ' line-hidden' : ''}`
          div.setAttribute('data-pv', i + 1)
          div.setAttribute('data-line-card', i)
          const rankSpan = document.createElement('span')
          rankSpan.className = 'alt-rank'
          rankSpan.textContent = `#${i + 1}`
          const moveSpan = document.createElement('span')
          moveSpan.className = 'alt-move'
          moveSpan.textContent = hasData ? getMoveText(alt) : '...'
          const evalSpan = document.createElement('span')
          evalSpan.className = 'alt-eval'
          if (hasData) {
            if (altEvalStr?.startsWith('M') || altEvalStr?.startsWith('-M')) evalSpan.classList.add('mate')
            else if (altEvalStr?.startsWith('-')) evalSpan.classList.add('neg')
          }
          evalSpan.textContent = altEvalStr || ''
          div.appendChild(rankSpan)
          div.appendChild(moveSpan)
          div.appendChild(evalSpan)
          // Add reveal button for hidden lines
          if (isHidden) {
            const revealBtn = document.createElement('div')
            revealBtn.className = 'line-reveal-alt'
            revealBtn.setAttribute('data-reveal-line', i)
            revealBtn.innerHTML = `<i class="fas fa-eye"></i>`
            div.appendChild(revealBtn)
          }
          altContainer.appendChild(div)
        }
      }
    }
    renderMoveReviewBadges()
  }

  // --- Engine ---
  class Engine {
    async bestMove(
      fen,
      {
        depth = 6,
        multipv = 1,
        timeoutMs = 5000,
        styleMode = 'default',
        showEnemyBestMove = false,
        isEnemyTurn = false,
      } = {}
    ) {
      logEvent('Engine', 'bestmove:request', {
        fen,
        depth,
        multipv,
        styleMode,
        showEnemyBestMove,
        isEnemyTurn,
      })
      const safeDepth = clampDepthByPlan(depth, 6)
      const safeMultipv = clampLinesByPlan(multipv, 1)
      const safeStyleMode = clampStyleModeByPlan(styleMode, 'default')
      const searchMultipv = getStyleSearchMultipv(safeMultipv, safeStyleMode)
      const host = getSharedEngineHost()
      logEvent('Engine', 'host:analyze', {
        depth: safeDepth,
        multipv: searchMultipv,
        styleMode: safeStyleMode,
        timeoutMs,
      })
      let resp
      try {
        resp = await host.analyze(fen, {
          depth: safeDepth,
          multipv: searchMultipv,
          timeoutMs,
          styleMode: safeStyleMode,
        })
      } catch (error) {
        logEvent('Engine', 'bestmove:error', {
          error: error instanceof Error ? error.message : String(error),
          status: null,
        })
        throw error
      }

      logEvent('Engine', 'bestmove:response', resp)

      if (!resp?.ok) {
        logEvent('Engine', 'bestmove:error', {
          error: resp?.error || 'failed',
          status: resp?.status || null,
        })
        throw new Error(resp?.error || 'failed')
      }
      if (!resp.bestmove && !resp.san && !resp.uci && !resp.bestmoveUci) {
        logEvent('Engine', 'bestmove:empty-response')
        return null
      }

      // Resolve UCI: prefer dedicated bestmoveUci field, then detect from other fields,
      // then fall back to SAN→UCI conversion using the FEN.
      const _pickUci = (a, b) => _isUciFormat(a) ? a : (_isUciFormat(b) ? b : null)

      const rawUci = resp.bestmoveUci || resp.uci || resp.bestmove
      const rawSan = resp.bestmoveSan || resp.san || resp.bestmove
      const uci = _pickUci(rawUci, rawSan) || _sanToUci(rawSan, fen) || _sanToUci(rawUci, fen) || rawUci || rawSan
      const san = rawSan && !_isUciFormat(rawSan) ? rawSan : (resp.san || resp.bestmove || rawSan)

      // Parse lines array from response
      const lines = (resp.lines || []).map(l => {
        const lRawUci = l.moveUci || l.uci || l.bestmove
        const lRawSan = l.moveSan || l.san || l.bestmove
        const lUci = _pickUci(lRawUci, lRawSan) || _sanToUci(lRawSan, fen) || _sanToUci(lRawUci, fen) || lRawUci || lRawSan
        const lSan = lRawSan && !_isUciFormat(lRawSan) ? lRawSan : (l.san || l.bestmove || lRawSan)
        return { uci: lUci, san: lSan, score: l.score }
      })
      const normalizedPrimary = { uci, san, score: resp.score }
      const styledLines = applyStyleModeToLines(
        lines.length ? lines : [normalizedPrimary],
        safeStyleMode,
        fen,
        safeMultipv
      )
      const selected = styledLines[0] || normalizedPrimary
      const result = {
        uci: selected.uci || uci,
        san: selected.san || san,
        score: selected.score || resp.score,
        lines: styledLines,
        styleMode: resp.styleMode || safeStyleMode,
      }
      logEvent('Engine', 'bestmove:normalized', {
        uci: result.uci,
        san: result.san,
        lines: Array.isArray(result.lines) ? result.lines.length : 0,
      })
      return result
    }
  }

  // --- FEN Logic (delegates to active adapter) ---
  const findBoardEl = () => ADAPTER.findBoardEl()
  const getFen = (board) => ADAPTER.getFen(board)
  const getLastMoveFromBoard = () => ADAPTER.getLastMoveUci()
  const getUciHistoryFromDom = () =>
    typeof ADAPTER.getUciHistory === 'function' ? normalizeUciMoves(ADAPTER.getUciHistory()) : []
  const getBackendUciHistory = ({ positionChanged = false } = {}) => {
    const history = getUciHistoryFromDom()
    if (positionChanged && !history.length) {
      renderMoveReviewBadges()
    }
    return history
  }
  const getMoveNumFromDOM = () => ADAPTER.getMoveNumFromDOM()
  const getMoveNum = () => getMoveNumFromDOM()
  const getTurnFromFen = (fen) => fen?.split(' ')[1] || 'w'
  const getCurrentTurn = (fen) => ADAPTER.getCurrentTurn(fen)
  const MATE_PAWN_EQ = 99

  const formatEvalForFen = (score, fenRef) => {
    if (!score) return ''
    const fenTurn = fenRef ? getTurnFromFen(fenRef) : 'w'
    const flip = fenTurn === 'b' ? -1 : 1
    if (score.type === 'mate') {
      const whiteMate = score.value * flip
      const val = whiteMate > 0 ? MATE_PAWN_EQ : -MATE_PAWN_EQ
      return (val > 0 ? '+' : '') + val.toFixed(2)
    }
    if (score.type === 'cp') {
      const p = (score.value * flip) / 100
      return (p > 0 ? '+' : '') + p.toFixed(2)
    }
    return ''
  }

  // Format eval - ALWAYS from White's perspective (chess standard)
  // Stockfish returns from side-to-move's perspective, so negate when Black's turn
  // Positive (+) = White advantage, Negative (-) = Black advantage
  const formatEval = (score) => formatEvalForFen(score, STATE.lastFen)

  // --- Main Loop ---
  // Note: currentTurn is passed from update() to avoid calling getCurrentTurn twice
  const shouldCalc = (fen, currentTurn) => {
    // Check if in active game
    if (!isInActiveGame()) {
      logEvent('Calc', 'blocked:no-active-game')
      return { ok: false, reason: 'No active game', type: 'nogame' }
    }

    if (isLichessDragLocked(STATE.board)) {
      logEvent('Calc', 'blocked:drag-lock')
      return { ok: false, reason: 'Waiting piece drop...', type: 'wait' }
    }

    const move = getMoveNum()
    if (move < STATE.startMove) {
      const remaining = STATE.startMove - move
      logEvent('Calc', 'blocked:start-move', { move, startMove: STATE.startMove, remaining })
      return { ok: false, reason: `${remaining} move${remaining > 1 ? 's' : ''} left (${move}/${STATE.startMove})`, type: 'skip' }
    }

    if (STATE.skipEnemy) {
      // Wait for user color to be detected before calculating
      if (!userColor) {
        logEvent('Calc', 'blocked:detecting-player')
        return { ok: false, reason: 'Detecting player...', type: 'wait' }
      }

      const myTurn = userColor === 'white' ? 'w' : 'b'
      if (currentTurn !== myTurn) {
        logEvent('Calc', 'blocked:waiting-turn', { currentTurn, myTurn, userColor })
        return { ok: false, reason: `Waiting for your turn`, type: 'skip' }
      }
    }

    logEvent('Calc', 'allowed', { currentTurn, userColor, skipEnemy: STATE.skipEnemy })
    return { ok: true }
  }

  const getMovePromotion = (m) => {
    const uci = String(m?.uci || m?.bestmove || '').trim()
    if (uci.length >= 5) {
      const c = uci[4].toLowerCase()
      if (['q', 'r', 'b', 'n'].includes(c)) return c
    }
    const san = String(m?.san || '').trim()
    const sanMatch = san.match(/=([QRBN])/i)
    if (sanMatch?.[1]) return sanMatch[1].toLowerCase()
    return null
  }

  const triggerAutoPlay = async (m, fen) => {
    const uci = getMoveUci(m)
    if (!STATE.autoPlay || !uci || STATE.lastAutoMoveFen === fen) return
    if (!userColor) return
    const myTurn = userColor === 'white' ? 'w' : 'b'
    if (getTurnFromFen(fen) !== myTurn) return

    // Keep Chess.com autoplay behavior unchanged.
    if (SITE !== 'lichess') {
      STATE.lastAutoMoveFen = fen
      if (getFen(STATE.board) === fen) {
        try {
          LOG.push(`[AutoPlay] Moving: ${uci}`)
          await ADAPTER.executeMove(uci, { promotion: getMovePromotion(m) })
        } catch (e) {
          LOG.push(`[AutoPlay] Move error: ${e?.message || e}`)
        }
      }
      return
    }

    const now = Date.now()
    if (now - (STATE.lastAutoTryAt || 0) < 250) return

    const boardFenBefore = getFen(STATE.board)
    const boardPosBefore = boardFenBefore?.split(' ')[0] || null
    const targetPos = fen?.split(' ')[0] || null
    if (!boardPosBefore || !targetPos || boardPosBefore !== targetPos) return
    STATE.lastAutoTryAt = now

    let moved = false
    try {
      LOG.push(`[AutoPlay] Moving: ${uci}`)
      moved = await ADAPTER.executeMove(uci, { promotion: getMovePromotion(m) })
    } catch (e) {
      LOG.push(`[AutoPlay] Move error: ${e?.message || e}`)
    }

    await new Promise(r => setTimeout(r, 120))
    const boardFenAfter = getFen(STATE.board)
    const boardPosAfter = boardFenAfter?.split(' ')[0] || null
    const changed =
      !!boardPosBefore &&
      !!boardPosAfter &&
      boardPosBefore !== boardPosAfter

    if (moved || changed || STATE.lastFen !== fen) {
      STATE.lastAutoMoveFen = fen
    } else {
      STATE.lastAutoMoveFen = null
      LOG.push(`[AutoPlay] Move not applied for FEN: ${fen}`)
    }
  }

  const getAutoDelayRangeSec = () => {
    const min = Math.max(0, Math.min(30, Number.parseInt(STATE.autoDelayMin, 10) || 0))
    const maxRaw = Math.max(0, Math.min(30, Number.parseInt(STATE.autoDelayMax, 10) || 0))
    const max = maxRaw < min ? min : maxRaw
    return { min, max }
  }

  const waitAutoDelayForFen = async (fen) => {
    const { min, max } = getAutoDelayRangeSec()
    if (min === 0 && max === 0) return true
    const delaySec = min + Math.random() * (max - min)
    const delayMs = Math.round(delaySec * 1000)
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    return STATE.lastFen === fen
  }

  const shouldKeepHiddenSuggestionsWarm = () =>
    !!STATE.hideSuggestion && !!SUB?.isPaid && !!STATE?.analyzePlayerMoves

  const getBackendRequestTimeoutMs = (depth) => Math.max(5000, clampDepthByPlan(depth, 6) * 1000)

  // Fetch and show move (used when hideSuggestion is enabled)
  // silent: true = don't show loading states (used for smooth reveal animation)
  const fetchAndShowMove = async (fen, silent = false) => {
    const effectiveDepth = clampDepthByPlan(STATE.depth, 6)
    const effectiveLines = clampLinesByPlan(STATE.lines, 1)
    const effectiveStyleMode = clampStyleModeByPlan(STATE.styleMode, 'default')
    const check = shouldCalc(fen, getTurnFromFen(fen))
    if (!check.ok) {
      if (!silent) {
        setUI({
          status: check.reason,
          type: check.type,
          move: '⏸',
          evalStr: STATE.lastEval || '',
          score: STATE.lastScore || null,
          scoreFen: STATE.lastFen || null,
        })
        clearCanvas()
      }
      return
    }

    // Check cache first
    const cached = await CACHE.get(fen, effectiveDepth, effectiveLines, effectiveStyleMode)
    if (cached) {
      const cachedLines = normalizeMoves(cached.lines)
      STATE.lastMoves = cachedLines.length ? cachedLines : [{ uci: cached.bestmove, san: cached.san, score: cached.score }]
      STATE.lastEval = formatEval(cached.score)
      STATE.lastScore = cached.score
      STATE.stable = true
      STATE.lastAt = Date.now()
      return
    }

    // Avoid duplicate/concurrent requests
    if (STATE.requestInProgress) {
      if (DEBUG) console.log('[Chess Helper] Request already in progress, skipping')
      return
    }

    // --- Subscription gate ---
    if (SUB.ready && SUB.recoveryRequired) {
      updateFreemiumBanner()
      return
    }

    if (!STATE.engine) STATE.engine = new Engine()
    STATE.lastRequestedFen = fen
    STATE.requestInProgress = true

    let best = null, err = null
    const hadStableSuggestion =
      STATE.lastFen === fen &&
      STATE.stable &&
      Array.isArray(STATE.lastMoves) &&
      STATE.lastMoves.length > 0
    try {
      best = await STATE.engine.bestMove(fen, {
        depth: effectiveDepth,
        multipv: effectiveLines,
        styleMode: effectiveStyleMode,
        showEnemyBestMove: !STATE.skipEnemy,
        isEnemyTurn: false,
        timeoutMs: getBackendRequestTimeoutMs(effectiveDepth)
      })
    } catch (e) { err = e }

    if (STATE.lastFen !== fen) {
      STATE.requestInProgress = false
      return
    }

    if (!best && err) {
      STATE.engine = new Engine()
      try {
        best = await STATE.engine.bestMove(fen, {
          depth: effectiveDepth,
          multipv: effectiveLines,
          styleMode: effectiveStyleMode,
          showEnemyBestMove: !STATE.skipEnemy,
          isEnemyTurn: false,
          timeoutMs: getBackendRequestTimeoutMs(effectiveDepth)
        })
        err = null
      } catch (e) { err = e }
    }

    STATE.requestInProgress = false

    if (STATE.lastFen !== fen) return

    STATE.lastAt = Date.now()
    if (best) {
      STATE.lastMoves = normalizeMoves(best.lines?.length ? best.lines : [best])
      STATE.lastEval = formatEval(best.score)
      STATE.lastScore = best.score
      STATE.stable = true
      STATE.retryCount = 0
      // Save to cache
      CACHE.set(fen, effectiveDepth, effectiveLines, effectiveStyleMode, { bestmove: best.uci, san: best.san, score: best.score, lines: STATE.lastMoves })
    } else {
      if (!hadStableSuggestion) {
        STATE.lastMoves = []
        STATE.lastEval = null
        STATE.lastScore = null
        STATE.stable = false
      }
    }

    // If silent mode (prefetch on hover), just store and return - don't show anything
    if (silent) {
      return
    }

    // Auto Delay disabled
    // if (STATE.safeMode && STATE.stable) {
    //   setUI({ status: 'Auto Delay...', type: 'wait', move: '...', evalStr: '', score: null })
    //   clearCanvas()
    //   const delay = 8000 + Math.random() * 4000 // 8s to 12s
    //   await new Promise(r => setTimeout(r, delay))
    //   if (STATE.lastFen !== fen) return
    // }

    const m = STATE.lastMoves[0]
    const primaryUci = getMoveUci(m)
    if (primaryUci) STATE.lastSuggestedMove = primaryUci
    setUI({
      status: STATE.stable ? '' : (err ? 'Error' : 'No move'),
      type: STATE.stable ? '' : (err ? 'err' : 'wait'),
      move: getMoveText(m),
      evalStr: STATE.lastEval || '',
      score: STATE.lastScore
    })

    if (STATE.stable && STATE.arrows && primaryUci) {
      drawArrows(STATE.board)
    } else {
      clearCanvas()
    }
  }

  const update = async () => {
    if (STATE.updating) return
    STATE.updating = true

    try {
      logEvent('Update', 'tick:start', {
        hasBoard: !!STATE.board,
        hasUi: !!STATE.ui,
        requestInProgress: !!STATE.requestInProgress,
      })
      enforcePlanRestrictions({ schedule: false })

      // Sync STATE.lines from select element (robust: works even if onchange fails)
      const linesSelect = STATE.ui?.querySelector('[data-lines]') || document.querySelector('[data-lines]')
      if (linesSelect) {
        const v = clampLinesByPlan(linesSelect.value, STATE.lines)
        if (linesSelect.value !== String(v)) linesSelect.value = String(v)
        if (v !== STATE.lines) {
          setLines(v, { schedule: false })
        }
      }

      // Reset stale board reference (element removed from DOM on page navigation)
      if (STATE.board && !document.contains(STATE.board)) {
        STATE.board = null
        if (STATE.observer) { STATE.observer.disconnect(); STATE.observer = null }
        invalidate()
      }

      if (!STATE.board) STATE.board = findBoardEl()
      if (!STATE.board) {
        logEvent('Update', 'board:not-found')
        setUI({ status: 'Waiting for board...', type: 'wait', move: '...' })
        return
      }

      // Detect username from DOM
      detectUserFromDOM()

      if (currentUser?.username && currentUser.username !== lastRegisteredUsername) {
        lastRegisteredUsername = currentUser.username
      }

      if (!STATE.observer) {
        const root = ADAPTER.getObserveTarget(STATE.board)
        STATE.observer = new MutationObserver(() => scheduleUpdate())
        STATE.observer.observe(root, { childList: true, subtree: true, attributes: true })
      }

      applyWizardChess()

      // Lichess emits transient DOM states while dragging/animating a move.
      // Skip updates until the move is dropped and board settles.
      if (isLichessDragLocked(STATE.board)) return

      let fen = getFen(STATE.board)
      if (!fen) {
        logEvent('Update', 'fen:missing')
        setUI({ status: 'FEN error', type: 'err', move: '...' })
        return
      }

      // Detect user color from FEN + active clock
      detectUserColor(fen)
      // Update UI with user info
      if (STATE.ui && currentUser) updateUserInfo()

      // Check if piece position changed (compare only position part, not turn)
      const fenPosition = fen.split(' ')[0]
      const lastPosition = STATE.lastSeenFen ? STATE.lastSeenFen.split(' ')[0] : null
      const positionChanged = lastPosition !== null && fenPosition !== lastPosition

      // Fix clock lag: when pieces moved but the clock-based turn didn't flip,
      // the clock is lagging behind the DOM piece update. Force the turn to flip
      // so we don't calculate for the wrong side (avoids double-calculation).
      if (positionChanged && STATE.lastTurn) {
        const fenTurn = fen.split(' ')[1]
        if (fenTurn === STATE.lastTurn) {
          const correctedTurn = STATE.lastTurn === 'w' ? 'b' : 'w'
          fen = `${fenPosition} ${correctedTurn} - - 0 1`
          if (DEBUG) console.log(`[Chess Helper] Clock lag: corrected turn ${STATE.lastTurn} → ${correctedTurn}`)
        }
      }

      // Update lastSeenFen with corrected FEN (so clock catch-up doesn't trigger recalc)
      const previousFen = STATE.lastSeenFen
      STATE.lastSeenFen = fen
      getBackendUciHistory({ positionChanged })

      // Debug: show FEN in console (enable with localStorage.setItem('_dbg', '1'))
      if (DEBUG) {
        console.log('[Chess Helper] FEN:', fen)
        const parts = fenPosition.split('/')
        console.log('[Chess Helper] Position (rank 8 to 1):')
        parts.forEach((rank, i) => console.log(`  Rank ${8-i}: ${rank}`))
      }

      // Track move time when position changes
      if (positionChanged) {
        trackMoveTime()
        // Track accuracy - check if last move matched suggestion
        if (STATE.lastSuggestedMove) {
          const lastMove = getLastMoveFromBoard()
          if (lastMove) {
            trackAccuracy(lastMove, STATE.lastSuggestedMove)
          }
        }
        // Premium feature: analyze played move on each board change.
        if (previousFen && SUB?.isPaid && STATE?.analyzePlayerMoves) {
          tryAnalyzePlayedMove({ fenBefore: previousFen, fenAfter: fen, attempt: 0 })
        }
      }

      // Use FEN turn directly (already corrected for clock lag above)
      const currentTurn = getTurnFromFen(fen)
      STATE.lastTurn = currentTurn
      const myTurn = userColor === 'white' ? 'w' : 'b'
      const isMyTurn = currentTurn === myTurn && userColor
      logEvent('Update', 'position', {
        fen,
        currentTurn,
        userColor,
        isMyTurn,
        hideSuggestion: !!STATE.hideSuggestion,
        skipEnemy: !!STATE.skipEnemy,
      })

      STATE.wasMyTurn = isMyTurn

      // On enemy turn, always request only 1 line (best move only)
      const isEnemyTurn = !isMyTurn && userColor && !STATE.skipEnemy
      const effectiveDepth = clampDepthByPlan(STATE.depth, 6)
      const effectiveMultipv = isEnemyTurn ? 1 : clampLinesByPlan(STATE.lines, 1)
      const effectiveStyleMode = clampStyleModeByPlan(STATE.styleMode, 'default')
      STATE.isEnemyTurn = isEnemyTurn

      // Update stats display
      updateStats()

      const check = shouldCalc(fen, currentTurn)
      if (!check.ok) {
        setUI({
          status: check.reason,
          type: check.type,
          move: '⏸',
          evalStr: STATE.lastEval || '',
          score: STATE.lastScore || null,
          scoreFen: STATE.lastFen || null,
        })
        clearCanvas()
        return
      }

      const now = Date.now()
      if (fen !== STATE.lastFen) {
        STATE.lastFen = fen
        STATE.lastMoves = []
        STATE.lastEval = null
        STATE.lastAt = 0
        STATE.stable = false
        STATE.lastError = null
        STATE.revealedLines.clear()
        STATE.pendingFen = fen
        if (STATE.retry) { clearTimeout(STATE.retry); STATE.retry = null }

        setUI({ status: 'Calculating...', type: 'calc', move: '...', evalStr: '' })
      } else if (STATE.hideSuggestion && STATE.revealedLines.size === 0 && STATE.stable) {
        // Data loaded but nothing revealed yet - keep backend idle unless move analysis is enabled.
        setUI({
          status: 'Click to reveal',
          type: '',
          move: '...',
          evalStr: shouldKeepHiddenSuggestionsWarm() ? (STATE.lastEval || '') : '',
          score: shouldKeepHiddenSuggestionsWarm() ? STATE.lastScore : null,
        })
        return
      } else if (STATE.lastMoves.length && (STATE.stable || now - STATE.lastAt < 5000)) {
        const m = STATE.lastMoves[0]
        const primaryUci = getMoveUci(m)
        const hideLines = STATE.hideSuggestion && !STATE.revealedLines.has(0)
        
        // Gatilho imediato se o Auto Play for ligado com lance já pronto
        if (STATE.stable && primaryUci) {
          triggerAutoPlay(m, fen)
        }

        setUI({
          status: STATE.stable ? '' : 'Error',
          type: STATE.stable ? '' : 'err',
          move: hideLines ? '...' : getMoveText(m),
          evalStr: hideLines && !shouldKeepHiddenSuggestionsWarm() ? '' : (STATE.lastEval || ''),
          score: hideLines && !shouldKeepHiddenSuggestionsWarm() ? null : STATE.lastScore
        })
        if (STATE.stable && STATE.arrows && primaryUci) drawArrows(STATE.board)
        return
      } else {
        setUI({ status: 'Recalculating...', type: 'calc', move: '...', evalStr: '', errorDetail: STATE.lastError ? `Last error: ${STATE.lastError}` : '' })
      }

      if (STATE.hideSuggestion && STATE.revealedLines.size === 0 && !shouldKeepHiddenSuggestionsWarm()) {
        setUI({ status: 'Click to reveal', type: '', move: '...', evalStr: '', score: null })
        clearCanvas()
        return
      }

      // Check cache first
      const cached = await CACHE.get(fen, effectiveDepth, effectiveMultipv, effectiveStyleMode)
      if (cached) {
        logEvent('Update', 'cache:hit', { fen, effectiveDepth, effectiveMultipv, effectiveStyleMode })
        if (!await waitAutoDelayForFen(fen)) return
        const cachedLines = normalizeMoves(cached.lines)
        // Ensure cached moves have valid UCI (may have SAN from older cache entries)
        for (const cm of cachedLines) {
          if (cm && !_isUciFormat(cm.uci)) {
            const converted = _sanToUci(cm.san || cm.uci, fen) || _sanToUci(cm.uci, fen)
            if (converted) cm.uci = converted
          }
        }
        STATE.lastMoves = cachedLines.length ? cachedLines : [{ uci: _isUciFormat(cached.bestmove) ? cached.bestmove : (_sanToUci(cached.san, fen) || _sanToUci(cached.bestmove, fen) || cached.bestmove), san: cached.san || cached.bestmove, score: cached.score }]
        STATE.lastEval = formatEval(cached.score)
        STATE.lastScore = cached.score
        STATE.stable = true
        STATE.lastAt = Date.now()
        const m = STATE.lastMoves[0]
        const primaryUci = getMoveUci(m)
        if (primaryUci) {
          STATE.lastSuggestedMove = primaryUci
          triggerAutoPlay(m, fen)
        }

        const hideLines = STATE.hideSuggestion
        if (hideLines && STATE.revealedLines.size === 0) {
          setUI({
            status: 'Click to reveal',
            type: '',
            move: '...',
            evalStr: shouldKeepHiddenSuggestionsWarm() ? (STATE.lastEval || '') : '',
            score: shouldKeepHiddenSuggestionsWarm() ? STATE.lastScore : null,
          })
          clearCanvas()
        } else {
          setUI({
            status: '',
            type: '',
            move: hideLines && !STATE.revealedLines.has(0) ? '...' : getMoveText(m),
            evalStr:
              hideLines && !STATE.revealedLines.has(0) && !shouldKeepHiddenSuggestionsWarm()
                ? ''
                : (STATE.lastEval || ''),
            score:
              hideLines && !STATE.revealedLines.has(0) && !shouldKeepHiddenSuggestionsWarm()
                ? null
                : STATE.lastScore
          })
          if (STATE.arrows) drawArrows(STATE.board)
        }
        return
      }

      // Avoid duplicate/concurrent requests
      if (STATE.requestInProgress) {
        logEvent('Update', 'request:skipped-in-progress')
        return
      }

      // --- Subscription gate ---
      if (SUB.ready && SUB.recoveryRequired) {
        updateFreemiumBanner()
        return
      }

      if (!STATE.engine) STATE.engine = new Engine()
      STATE.lastRequestedFen = fen
      STATE.requestInProgress = true

      let best = null, err = null
      const hadStableSuggestion = STATE.stable && Array.isArray(STATE.lastMoves) && STATE.lastMoves.length > 0
      try {
        if (!await waitAutoDelayForFen(fen)) return
        best = await STATE.engine.bestMove(fen, {
          depth: effectiveDepth,
          multipv: effectiveMultipv,
          styleMode: effectiveStyleMode,
          showEnemyBestMove: !STATE.skipEnemy,
          isEnemyTurn: isEnemyTurn,
          timeoutMs: getBackendRequestTimeoutMs(effectiveDepth)
        })
      } catch (e) {
        err = e
        LOG.push(`[BestMove] Attempt 1 FAILED: ${e.message}`)
        logEvent('Update', 'request:error:first-attempt', { error: e?.message || String(e) })
      } finally {
        STATE.requestInProgress = false
      }

      if (STATE.lastFen !== fen) return

      if (!best && err) {
        STATE.engine = new Engine()
        STATE.requestInProgress = true
        try {
          if (!await waitAutoDelayForFen(fen)) return
          best = await STATE.engine.bestMove(fen, {
            depth: effectiveDepth,
            multipv: effectiveMultipv,
            styleMode: effectiveStyleMode,
            showEnemyBestMove: !STATE.skipEnemy,
            isEnemyTurn: isEnemyTurn,
            timeoutMs: getBackendRequestTimeoutMs(effectiveDepth)
          })
          err = null
        } catch (e) {
          err = e
          LOG.push(`[BestMove] Attempt 2 FAILED: ${e.message}`)
          logEvent('Update', 'request:error:retry', { error: e?.message || String(e) })
        } finally {
          STATE.requestInProgress = false
        }
      }

      if (STATE.lastFen !== fen) return

      STATE.lastAt = Date.now()
      if (best) {
        logEvent('Update', 'request:success', {
          bestmove: best?.uci || null,
          san: best?.san || null,
          lines: Array.isArray(best?.lines) ? best.lines.length : 0,
        })
        STATE.lastMoves = normalizeMoves(best.lines?.length ? best.lines : [best])
        STATE.lastEval = formatEval(best.score)
        STATE.lastScore = best.score
        STATE.stable = true
        STATE.retryCount = 0
        STATE.lastError = null
        if (STATE.retry) { clearTimeout(STATE.retry); STATE.retry = null }
        // Save to cache
        CACHE.set(fen, effectiveDepth, effectiveMultipv, effectiveStyleMode, { bestmove: best.uci, san: best.san, score: best.score, lines: STATE.lastMoves })
      } else {
        logEvent('Update', 'request:no-result', {
          error: err?.message || null,
          hadStableSuggestion,
        })
        STATE.lastError = err ? err.message : 'no response'
        if (hadStableSuggestion) {
          // Keep previous suggestion on transient backend failures to avoid UI flicker.
          STATE.stable = true
        } else {
          STATE.lastMoves = []
          STATE.lastEval = null
          STATE.lastScore = null
          STATE.stable = false
          STATE.retryCount = Math.min((STATE.retryCount || 0) + 1, 5)
          const backoff = 1000 * Math.pow(2, STATE.retryCount - 1) // 1s, 2s, 4s, 8s, 16s
          STATE.retry = setTimeout(scheduleUpdate, backoff)
        }
      }

      // Auto Delay disabled
      // if (STATE.safeMode && STATE.stable) {
      //   setUI({ status: 'Auto Delay...', type: 'wait', move: '...', evalStr: '', score: null })
      //   clearCanvas()
      //   const delay = 8000 + Math.random() * 4000 // 8s to 12s
      //   await new Promise(r => setTimeout(r, delay))
      //   if (STATE.lastFen !== fen) return // position changed during delay
      // }

      const m = STATE.lastMoves[0]
      const primaryUci = getMoveUci(m)
      if (primaryUci) {
        STATE.lastSuggestedMove = primaryUci
        triggerAutoPlay(m, fen)
      }

      // If hideSuggestion is on, show ready state with hidden lines
      const hideLines = STATE.hideSuggestion
      if (hideLines && STATE.revealedLines.size === 0 && STATE.stable) {
        setUI({
          status: 'Click to reveal',
          type: '',
          move: '...',
          evalStr: shouldKeepHiddenSuggestionsWarm() ? (STATE.lastEval || '') : '',
          score: shouldKeepHiddenSuggestionsWarm() ? STATE.lastScore : null
        })
        clearCanvas()
      } else {
        setUI({
          status: STATE.stable ? '' : (err ? 'Error' : 'No move'),
          type: STATE.stable ? '' : (err ? 'err' : 'wait'),
          move: hideLines && !STATE.revealedLines.has(0) ? '...' : getMoveText(m),
          evalStr:
            hideLines && !STATE.revealedLines.has(0) && !shouldKeepHiddenSuggestionsWarm()
              ? ''
              : (STATE.lastEval || ''),
          score:
            hideLines && !STATE.revealedLines.has(0) && !shouldKeepHiddenSuggestionsWarm()
              ? null
              : STATE.lastScore,
          errorDetail: !STATE.stable && err ? err.message : ''
        })

        if (STATE.stable && STATE.arrows) {
          drawArrows(STATE.board)
        } else {
          clearCanvas()
        }
      }

    } finally {
      logEvent('Update', 'tick:end', {
        stable: !!STATE.stable,
        lastFen: STATE.lastFen || null,
        lastError: STATE.lastError || null,
      })
      STATE.updating = false
      if (STATE.needsUpdate) {
        STATE.needsUpdate = false
        scheduleUpdate()
      }
    }
  }

  let updateTimer = null
  const scheduleUpdate = () => {
    if (STATE.updating) { STATE.needsUpdate = true; return }
    if (updateTimer) clearTimeout(updateTimer)
    updateTimer = setTimeout(() => { updateTimer = null; update() }, 250)
  }

  // --- Bootstrap ---
  setupLichessDragGuard()
  setTimeout(detectUserFromDOM, 500)
  setInterval(() => {
    if (!currentUser || !userColor) detectUserFromDOM()
  }, 3000)
  setInterval(() => {
    if (!STATE.ui) return
    const usage = getUsageLimitState()
    if (!usage.isPremium && usage.limitReached) updateFreemiumBanner()
  }, 1000)

  // Initialize subscription FIRST, then start calculating
  initSubscription()
    .catch((e) => LOG.push(`[Sub] Bootstrap error: ${e.message}`))
    .finally(() => {
      scheduleUpdate()
      setInterval(() => {
        if (!STATE.board) STATE.board = findBoardEl()
        if (STATE.board) scheduleUpdate()
      }, 1000)
    })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushFeatureUsage().catch(() => {})
      return
    }
    if (document.visibilityState === 'visible' && SUB.ready && SUB.isActive) {
      scheduleUpdate()
    }
  })
  window.addEventListener('beforeunload', () => {
    flushFeatureUsage().catch(() => {})
  })
})()
