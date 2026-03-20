(() => {
  if (!window.location.hostname.includes('lichess')) return

  const CHANNEL = '__chess_helper_lichess_bridge__'
  const REQUEST_ACTION = 'move'
  const RESPONSE_ACTION = 'move_result'

  const isVisible = (el) => {
    if (!el || !el.isConnected) return false
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const findBoardWrap = () => {
    const selectors = [
      'main.round .cg-wrap',
      '.round__app .cg-wrap',
      'main.analyse .cg-wrap',
      '.analyse .cg-wrap',
      '.study__board .cg-wrap',
      'main.puzzle .cg-wrap',
      '.puzzle__board .cg-wrap',
      'main .cg-wrap',
    ]
    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (isVisible(el)) return el
    }
    return null
  }

  const getBoardContext = () => {
    const wrap = findBoardWrap()
    if (!wrap) return null
    const board = wrap.querySelector('cg-board')
    const container = wrap.querySelector('cg-container') || board?.parentElement || wrap
    if (!board || !container) return null
    return { wrap, board, container }
  }

  const getOrientation = (wrap) => {
    if (!wrap) return 'white'
    const attr = wrap.getAttribute('data-orientation') || ''
    if (attr === 'black' || wrap.classList.contains('orientation-black')) return 'black'
    const parent = wrap.closest('[data-orientation]')
    if (parent?.getAttribute('data-orientation') === 'black') return 'black'
    return 'white'
  }

  const squareFromBoardPoint = (board, x, y, orient) => {
    const rect = board.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const cellW = rect.width / 8
    const cellH = rect.height / 8
    let col = Math.floor(x / cellW)
    let row = Math.floor(y / cellH)
    col = Math.max(0, Math.min(7, col))
    row = Math.max(0, Math.min(7, row))
    const fileIndex = orient === 'black' ? 7 - col : col
    const rank = orient === 'black' ? row + 1 : 8 - row
    return `${String.fromCharCode(97 + fileIndex)}${rank}`
  }

  const squareFromElementRect = (board, el, orient) => {
    const boardRect = board.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    if (!boardRect.width || !boardRect.height || !rect.width || !rect.height) return null
    const x = rect.left + rect.width / 2 - boardRect.left
    const y = rect.top + rect.height / 2 - boardRect.top
    return squareFromBoardPoint(board, x, y, orient)
  }

  const pointForSquare = (board, square, orient) => {
    if (!/^[a-h][1-8]$/i.test(square || '')) return null
    const rect = board.getBoundingClientRect()
    const file = square.toLowerCase().charCodeAt(0) - 97
    const rank = Number(square[1])
    const col = orient === 'black' ? 7 - file : file
    const row = orient === 'black' ? rank - 1 : 8 - rank
    const cellW = rect.width / 8
    const cellH = rect.height / 8
    return {
      x: rect.left + (col + 0.5) * cellW,
      y: rect.top + (row + 0.5) * cellH,
    }
  }

  const getPieceAtSquare = (board, square, orient) => {
    const pieces = board.querySelectorAll('piece:not(.ghost)')
    for (const piece of pieces) {
      if (squareFromElementRect(board, piece, orient) === square) return piece
    }
    return null
  }

  const getMoveDestAtSquare = (board, square, orient) => {
    const targets = board.querySelectorAll('square.move-dest, square.premove-dest')
    for (const target of targets) {
      if (!isVisible(target)) continue
      if (squareFromElementRect(board, target, orient) === square) return target
    }
    return null
  }

  const dispatchPointerAndMouse = (target, type, x, y, buttons, detail) => {
    if (!target?.dispatchEvent) return
    if (typeof PointerEvent === 'function') {
      target.dispatchEvent(new PointerEvent(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons,
      }))
    }
    target.dispatchEvent(new MouseEvent(type.replace(/^pointer/, 'mouse'), {
      view: window,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
      detail,
    }))
  }

  const clickAt = (target, x, y) => {
    dispatchPointerAndMouse(target, 'pointermove', x, y, 0, 0)
    dispatchPointerAndMouse(target, 'pointerdown', x, y, 1, 1)
    dispatchPointerAndMouse(target, 'pointerup', x, y, 0, 1)
    target.dispatchEvent(new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 0,
      detail: 1,
    }))
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const humanMove = async (uci) => {
    if (typeof uci !== 'string' || uci.length < 4) return false
    const ctx = getBoardContext()
    if (!ctx) return false
    const orient = getOrientation(ctx.wrap)
    const from = uci.slice(0, 2).toLowerCase()
    const to = uci.slice(2, 4).toLowerCase()
    const fromPt = pointForSquare(ctx.board, from, orient)
    const toPt = pointForSquare(ctx.board, to, orient)
    const piece = getPieceAtSquare(ctx.board, from, orient)
    if (!fromPt || !toPt || !piece) return false

    clickAt(piece, fromPt.x, fromPt.y)
    clickAt(ctx.board, fromPt.x, fromPt.y)
    await sleep(40)

    const moveDest = getMoveDestAtSquare(ctx.board, to, orient)
    if (moveDest) {
      clickAt(moveDest, toPt.x, toPt.y)
      clickAt(ctx.board, toPt.x, toPt.y)
      await sleep(80)
      return true
    }

    clickAt(ctx.board, toPt.x, toPt.y)
    clickAt(ctx.container, toPt.x, toPt.y)
    await sleep(40)

    dispatchPointerAndMouse(piece, 'pointermove', fromPt.x, fromPt.y, 0, 0)
    dispatchPointerAndMouse(piece, 'pointerdown', fromPt.x, fromPt.y, 1, 1)
    piece.dispatchEvent(new MouseEvent('mousedown', {
      view: window,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: fromPt.x,
      clientY: fromPt.y,
      button: 0,
      buttons: 1,
      detail: 1,
    }))

    for (let i = 1; i <= 12; i += 1) {
      const x = fromPt.x + (toPt.x - fromPt.x) * (i / 12)
      const y = fromPt.y + (toPt.y - fromPt.y) * (i / 12)
      dispatchPointerAndMouse(ctx.board, 'pointermove', x, y, 1, 0)
      dispatchPointerAndMouse(ctx.container, 'pointermove', x, y, 1, 0)
      ctx.board.dispatchEvent(new MouseEvent('mousemove', {
        view: window,
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
        detail: 0,
      }))
      await sleep(12)
    }

    dispatchPointerAndMouse(ctx.board, 'pointerup', toPt.x, toPt.y, 0, 1)
    ctx.board.dispatchEvent(new MouseEvent('mouseup', {
      view: window,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: toPt.x,
      clientY: toPt.y,
      button: 0,
      buttons: 0,
      detail: 1,
    }))
    ctx.board.dispatchEvent(new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: toPt.x,
      clientY: toPt.y,
      button: 0,
      buttons: 0,
      detail: 1,
    }))
    await sleep(80)
    return true
  }

  const isLichessSocket = (ws) => {
    if (!ws || typeof ws.send !== 'function') return false
    const url = String(ws.url || '')
    return /(^|\/\/)(socket\d*\.)?lichess\.org([/:]|$)/i.test(url)
  }

  const patchWebSocketCapture = () => {
    if (typeof WebSocket !== 'function') return false
    const proto = WebSocket.prototype
    if (!proto || proto.__chessHelperWsPatched) return true

    const originalSend = proto.send
    proto.send = function(...args) {
      try {
        if (isLichessSocket(this)) window._ws = this
      } catch {}
      return originalSend.apply(this, args)
    }

    proto.__chessHelperWsPatched = true
    proto._patched = true
    return true
  }

  const subscribeToMoveLatency = () => {
    try {
      const subscribe = window.lichess?.socket?.subscribeToMoveLatency
      if (typeof subscribe !== 'function') return false
      subscribe.call(window.lichess.socket)
      return true
    } catch {
      return false
    }
  }

  const getOpenSocket = () => {
    const ws = window._ws
    if (!isLichessSocket(ws)) return null
    if (ws.readyState !== 1) return null
    return ws
  }

  const waitForSocket = async (timeoutMs = 1800) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      patchWebSocketCapture()
      subscribeToMoveLatency()
      const ws = getOpenSocket()
      if (ws) return ws
      await sleep(60)
    }
    return null
  }

  const sendMoveViaSocket = async (uci) => {
    if (typeof uci !== 'string' || uci.length < 4) return false
    const ws = getOpenSocket() || await waitForSocket(2000)
    if (!ws) return false
    try {
      ws.send(JSON.stringify({ t: 'move', d: { u: uci, b: 1 } }))
      return true
    } catch {
      return false
    }
  }

  const sendMove = async (uci) => {
    const domOk = await humanMove(uci)
    if (domOk) return true
    return await sendMoveViaSocket(uci)
  }

  const reply = (requestId, ok, error = '') => {
    window.postMessage(
      {
        channel: CHANNEL,
        action: RESPONSE_ACTION,
        requestId,
        ok: !!ok,
        error: String(error || ''),
      },
      '*'
    )
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event?.data
    if (!data || data.channel !== CHANNEL || data.action !== REQUEST_ACTION) return

    Promise.resolve(sendMove(data.uci))
      .then((ok) => reply(data.requestId, ok))
      .catch((e) => reply(data.requestId, false, e?.message || e))
  })

  patchWebSocketCapture()
  subscribeToMoveLatency()
})()
