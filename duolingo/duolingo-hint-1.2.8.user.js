// ==UserScript==
// @name         Duolingo Hint
// @namespace    https://www.duolingo.com/
// @version      1.2.27
// @description  Duolingo answer hints and shortcuts.
// @icon         https://d35aaqx5ub95lt.cloudfront.net/images/700755cf688b76a1eba261e682def131.svg
// @match        https://www.duolingo.com/*
// @run-at       document-start
// @grant        none
// @updateURL   https://raw.githubusercontent.com/nguyenphanvn95/nguyenphanvn95.github.io/main/duolingo/duolingo-hint-1.2.8.user.js
// @downloadURL https://raw.githubusercontent.com/nguyenphanvn95/nguyenphanvn95.github.io/main/duolingo/duolingo-hint-1.2.8.user.js
// ==/UserScript==

/* Runs in page context. The H button opens settings, the floating Ctrl button
   uses the current answer hint, and Alt+H toggles Hint. */

(() => {
  const BRIDGE_KEY = '__duolingoHintUserscriptBridgeV1__';
  if (window[BRIDGE_KEY]) return;
  Object.defineProperty(window, BRIDGE_KEY, { value: true, configurable: false });
  const norm = s => String(s || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  let sessionChallenges = [];
  let activeSessionId = '';
  let podcastResponses = [];
  let storyElements = [];
  function sessionIdFromUrl(url) {
    try { return new URL(url, location.href).pathname.match(/\/sessions\/([^/?]+)\/?$/)?.[1] || ''; }
    catch { return ''; }
  }
  function storeSession(data, sessionId = '') {
    if (!data || typeof data !== 'object') return;
    const nextSessionId = sessionId || (typeof data.id === 'string' ? data.id : '');
    if (nextSessionId && activeSessionId && nextSessionId !== activeSessionId) {
      sessionChallenges = [];
      podcastResponses = [];
    }
    if (nextSessionId) activeSessionId = nextSessionId;
    const candidates = [data.challenges, data.adaptiveChallenges, data.mistakesReplacementChallenges, data.adaptiveInterleavedChallenges?.challenges]
      .filter(Array.isArray).flat();
    if (data.challengePools && typeof data.challengePools === 'object') {
      for (const pool of Object.values(data.challengePools)) if (Array.isArray(pool)) candidates.push(...pool);
    }
    const visited = new WeakSet(), stack = [data]; let scanned = 0;
    while (stack.length && scanned++ < 30000) {
      const value = stack.pop();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);
      if (Array.isArray(value)) { stack.push(...value.slice(0, 100)); continue; }
      const type = value.challengeType || value.type;
      const hasAnswer = Number.isInteger(value.correctIndex) || Number.isInteger(value.correctIndices?.[0]) ||
        Number.isInteger(value.correctAnswerIndex) || Number.isInteger(value.correctChoiceIndex) ||
        Array.isArray(value.correctSolutions) || Array.isArray(value.correctTokens) || Array.isArray(value.pairs) ||
        Array.isArray(value.phraseOrder) || value.challengeResponseTrackingProperties?.best_solution;
      if (typeof type === 'string' && hasAnswer) candidates.push(value);
      for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
    }
    const uniqueCandidates = [...new Set(candidates.filter(item => item && typeof item === 'object'))];
    if (!uniqueCandidates.length) return;
    sessionChallenges = [...sessionChallenges, ...uniqueCandidates].slice(-500);
    document.dispatchEvent(new CustomEvent('duo-hint-session-v1'));
  }
  function storeSessionPayload(payload, sessionId = '') {
    try { storeSession(typeof payload === 'string' ? JSON.parse(payload) : payload, sessionId); } catch {}
  }
  function isSession(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin && /\/sessions(?:\/[^/?]+)?\/?$/.test(u.pathname); }
    catch { return false; }
  }
  function isDuolingoApi(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin && !/\.(?:js|mjs|css|png|jpe?g|gif|svg|woff2?|ttf|mp3|mp4)(?:[?#]|$)/i.test(u.pathname); }
    catch { return false; }
  }
  function isPodcastData(url) {
    try {
      const u = new URL(url, location.href);
      return /(^|\.)duolingo\.com$/i.test(u.hostname) && /(?:duoradio|podcast|\/radio(?:\/|$))/i.test(u.pathname);
    } catch { return false; }
  }
  function isStoryData(url, method) {
    try {
      const u = new URL(url, location.href);
      return String(method || 'GET').toUpperCase() === 'GET' && u.hostname === 'stories.duolingo.com' && u.pathname.startsWith('/api2/stories/');
    } catch { return false; }
  }
  function storeStory(data) {
    if (!data || !Array.isArray(data.elements)) return;
    storyElements = data.elements;
    document.dispatchEvent(new CustomEvent('duo-hint-session-v1'));
  }
  function storePodcast(data) {
    if (!data || typeof data !== 'object') return;
    podcastResponses.push(data);
    if (podcastResponses.length > 5) podcastResponses.shift();
    document.dispatchEvent(new CustomEvent('duo-hint-session-v1'));
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    let requestCopy = null;
    try { if (args[0] instanceof Request && !args[0].bodyUsed) requestCopy = args[0].clone(); } catch {}
    const promise = originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    const method = args[1]?.method || args[0]?.method || 'GET';
    if (isSession(url)) {
      const sessionId = sessionIdFromUrl(url);
      const body = args[1]?.body;
      if (typeof body === 'string') storeSessionPayload(body, sessionId);
      else if (requestCopy) requestCopy.text().then(payload => storeSessionPayload(payload, sessionId)).catch(() => {});
      promise.then(response => {
        if (response.ok) response.clone().json().then(data => storeSession(data, sessionId)).catch(() => {});
      }).catch(() => {});
    }
    else if (isPodcastData(url)) promise.then(response => {
      if (response.ok && /json/i.test(response.headers.get('content-type') || '')) response.clone().json().then(storePodcast).catch(() => {});
    }).catch(() => {});
    else if (isDuolingoApi(url)) promise.then(response => {
      if (response.ok && /json/i.test(response.headers.get('content-type') || '')) response.clone().json().then(data => storeSession(data)).catch(() => {});
    }).catch(() => {});
    else if (isStoryData(url, method)) promise.then(response => {
      if (response.ok) response.clone().json().then(storeStory).catch(() => {});
    }).catch(() => {});
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
  const observedRequests = new WeakMap();
  const observedSessionIds = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isSession(url)) { observedRequests.set(this, 'session'); observedSessionIds.set(this, sessionIdFromUrl(url)); }
    else if (isPodcastData(url)) observedRequests.set(this, 'podcast');
    else if (isDuolingoApi(url)) observedRequests.set(this, 'api');
    else if (isStoryData(url, method)) observedRequests.set(this, 'story');
    else observedRequests.delete(this);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const kind = observedRequests.get(this);
    const sessionId = observedSessionIds.get(this) || '';
    if (kind === 'session' && typeof args[0] === 'string') storeSessionPayload(args[0], sessionId);
    if (kind) this.addEventListener('load', function () {
      if (this.status < 200 || this.status >= 300) return;
      try {
        const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
        if (kind === 'session' || kind === 'api') storeSession(data, sessionId); else if (kind === 'story') storeStory(data); else storePodcast(data);
      } catch {}
    }, { once: true });
    return originalSend.apply(this, args);
  };
  function selectFromSession(req, availableChallenges = sessionChallenges) {
    const screen = norm(req.screen);
    const visible = (req.words?.length ? req.words : req.choices || []).map(norm).filter(Boolean);
    const context = Array.isArray(req.hintWords) ? norm(req.hintWords.join('')) : '';
    const candidates = [];
    for (const c of availableChallenges) {
      if (!c || typeof c !== 'object') continue;
      const kind = req.kind || '';
      // Duoradio's challengePools wrap items as { type: "challenge",
      // challengeType: "listenMatch" }; ordinary lesson responses use type directly.
      const challengeType = String(c.challengeType || c.type || '').toLowerCase();
      const isListen = /challenge-listenTap(?:\s|$)/i.test(kind);
      const isAssist = /challenge-assist(?:\s|$)/i.test(kind);
      const expectedType = /challenge-translate(?:\s|$)/i.test(kind) ? 'translate'
        : isListen ? 'listenTap'
        : /challenge-assist(?:\s|$)/i.test(kind) ? 'assist'
        : /challenge-selectTranscription(?:\s|$)/i.test(kind) ? 'selectTranscription'
        : /challenge-listenMatch(?:\s|$)/i.test(kind) ? 'listenMatch'
        : /challenge-select(?:\s|$)/i.test(kind) ? 'select'
        : /challenge-sameDifferent(?:\s|$)/i.test(kind) ? 'sameDifferent'
        : /challenge-gapFill(?:\s|$)/i.test(kind) ? 'gapFill'
        : /challenge-tapComplete(?:\s|$)/i.test(kind) ? 'tapComplete' : '';
      if (expectedType && challengeType !== expectedType.toLowerCase()) continue;
      if (isAssist && challengeType && !/^assist$/i.test(challengeType)) continue;
      if (isListen && !/^listenTap$/i.test(challengeType)) continue;
      if (/challenge-listenMatch(?:\s|$)/i.test(kind) && challengeType && !/^listenMatch$/i.test(challengeType)) continue;
      if (/challenge-listenMatch(?:\s|$)/i.test(kind) && Array.isArray(c.pairs)) {
        const available = (req.words || []).map((word, index) => ({ word: norm(word), index, used: false }));
        const pairIndices = [], pairs = [];
        for (const pair of c.pairs) {
          const left = norm(pair?.learningWord ?? pair?.left ?? pair?.source ?? '');
          const right = norm(pair?.translation ?? pair?.right ?? pair?.target ?? '');
          const leftToken = available.find(token => !token.used && token.word === left);
          const rightToken = available.find(token => !token.used && token !== leftToken && token.word === right);
          if (!left || !right || !leftToken || !rightToken) { pairIndices.length = 0; pairs.length = 0; break; }
          leftToken.used = true; rightToken.used = true;
          pairIndices.push({ number: pairIndices.length + 1, indices: [leftToken.index, rightToken.index] });
          pairs.push([pair.learningWord ?? pair.left ?? pair.source, pair.translation ?? pair.right ?? pair.target]);
        }
        if (pairIndices.length && pairIndices.reduce((n, pair) => n + pair.indices.length, 0) === available.length) {
          const score = 500 + pairIndices.length;
          candidates.push({ score, answer: '', tokens: [], pairs, pairIndices });
        }
        continue;
      }
      const rawChoices = Array.isArray(c.choices) ? c.choices
        : isListen && Array.isArray(c.correctTokens) && Array.isArray(c.wrongTokens) ? [...c.correctTokens, ...c.wrongTokens] : [];
      const bank = rawChoices.map(x => norm(typeof x === 'string' ? x : x?.text)).filter(Boolean);
      const remaining = bank.slice();
      let overlap = 0;
      for (const word of visible) { const i = remaining.indexOf(word); if (i >= 0) { overlap++; remaining.splice(i, 1); } }
      const bankMatch = visible.length > 0 && bank.length > 0 && overlap === visible.length;
      // Listening questions have no visible prompt: require the whole word bank to match.
      if ((isListen || isAssist) && (!bankMatch || visible.length !== bank.length)) continue;
      const prompt = norm(c.prompt);
      const promptMatch = prompt.length >= 2 && screen.includes(prompt);
      const displayed = Array.isArray(c.displayTokens) ? norm(c.displayTokens.filter(x => x && !x.isBlank).map(x => x.text || '').join('')) : '';
      const contextMatch = context.length >= 2 && displayed.length >= 2 && (context === displayed || context.includes(displayed) || displayed.includes(context));
      if (/tapComplete/i.test(req.kind || '') && context && displayed && !contextMatch) continue;
      if (/tapComplete/i.test(req.kind || '') && bank.length <= 2 && context && !contextMatch && !promptMatch) continue;
      if (!promptMatch && !bankMatch && !c.currentScope) continue;
      const score = (c.currentScope ? 250 : 0) + (contextMatch ? 150 : 0) + (promptMatch ? 100 : 0) + (bankMatch ? 40 + overlap : 0) - (bankMatch ? Math.abs(bank.length - visible.length) : 0);
      let answer = Array.isArray(c.correctSolutions) ? c.correctSolutions.find(x => typeof x === 'string') : '';
      let tokens = Array.isArray(c.correctTokens) ? c.correctTokens.filter(x => typeof x === 'string') : [];
      if (!tokens.length && /^(tapComplete|listenTap)$/i.test(c.type || '') && Array.isArray(c.correctIndices) && Array.isArray(c.choices)) {
        const indices = c.correctIndices;
        if (indices.length && indices.every(i => Number.isInteger(i) && i >= 0 && i < c.choices.length)) {
          tokens = indices.map(i => typeof c.choices[i] === 'string' ? c.choices[i] : c.choices[i]?.text).filter(x => typeof x === 'string' && x.trim());
          if (tokens.length !== indices.length) tokens = [];
        }
      }
      if (isListen && tokens.length) {
        const remainingChoices = bank.slice();
        if (!tokens.every(word => { const i = remainingChoices.indexOf(norm(word)); if (i < 0) return false; remainingChoices.splice(i, 1); return true; })) continue;
      }
      if (!tokens.length && /tapComplete/i.test(c.type || '') && Array.isArray(c.displayTokens)) {
        const blanks = c.displayTokens.filter(x => x?.isBlank && typeof x.text === 'string' && x.text.trim()).map(x => x.text);
        const available = bank.slice();
        if (blanks.length && blanks.every(word => { const i = available.indexOf(norm(word)); if (i < 0) return false; available.splice(i, 1); return true; })) tokens = blanks;
      }
      let correctChoice = '';
      const singleCorrectIndex = Number.isInteger(c.correctIndex) ? c.correctIndex
        : Number.isInteger(c.correctAnswerIndex) ? c.correctAnswerIndex
        : Number.isInteger(c.correctChoiceIndex) ? c.correctChoiceIndex
        : Array.isArray(c.correctIndices) && c.correctIndices.length === 1 ? c.correctIndices[0] : -1;
      const correctIndices = Array.isArray(c.correctIndices) ? [...new Set(c.correctIndices.filter(i => Number.isInteger(i) && i >= 0 && i < (c.choices || []).length))]
        : singleCorrectIndex >= 0 && singleCorrectIndex < (c.choices || []).length ? [singleCorrectIndex] : [];
      if (singleCorrectIndex >= 0 && Array.isArray(c.choices) && singleCorrectIndex < c.choices.length &&
          /gapFill|tapComplete|select|sameDifferent|assist|podcast-judge/i.test(req.kind || '')) {
        const choice = c.choices[singleCorrectIndex]; correctChoice = typeof choice === 'string' ? choice : choice?.text || '';
      }
      if (correctIndices.length > 1 && Array.isArray(c.choices)) {
        const correctChoices = correctIndices.map(i => typeof c.choices[i] === 'string' ? c.choices[i] : c.choices[i]?.text).filter(Boolean);
        if (correctChoices.length === correctIndices.length) answer = correctChoices.join(' / ');
      }
      if (!correctChoice && c.currentScope && singleCorrectIndex >= 0 && singleCorrectIndex < (req.choices || []).length) correctChoice = req.choices[singleCorrectIndex];
      if (correctChoice) answer = correctChoice;
      if (!answer && c.type === 'listenTap') answer = c.prompt || '';
      if (!answer && tokens.length) answer = c.challengeResponseTrackingProperties?.best_solution || '';
      if (!answer && tokens.length) answer = tokens.join(' ');
      if (!answer) continue;
      const audioKey = typeof c.tts === 'string' ? c.tts.split(/[?#]/, 1)[0] : '';
      const audioRank = audioKey && Array.isArray(req.audioUrls) ? req.audioUrls.findIndex(url => String(url).split(/[?#]/, 1)[0] === audioKey) : -1;
      const audioMatch = audioRank >= 0;
      // The prompt audio is requested before the choice audio files. Lower resource
      // position therefore identifies the active prompt when choices are identical.
      candidates.push({ score: score + (audioMatch ? 300 - audioRank : 0), answer, tokens, correctChoice,
        index: singleCorrectIndex >= 0 ? singleCorrectIndex : undefined,
        indices: correctIndices.length > 1 ? correctIndices : undefined });
    }
    candidates.sort((a, b) => b.score - a.score);
    const signature = candidate => JSON.stringify([candidate.answer, candidate.tokens, candidate.indices, candidate.pairIndices]);
    if (!candidates.length || (candidates[1]?.score === candidates[0].score && signature(candidates[1]) !== signature(candidates[0]))) return null;
    return candidates[0];
  }
  function selectStory(challenge, req) {
    const seenFibers = new Set(), roots = [], currentChallenges = [];
    const footer = document.querySelector('[data-test="stories-player-continue"]');
    for (const el of [challenge, ...challenge.querySelectorAll('[data-test="stories-choice"], button[data-test*="challenge-tap-token"]'), footer].filter(Boolean)) {
      for (const key of Object.keys(el).filter(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))) {
        let fiber = el[key];
        for (let i = 0; fiber && i < 25; i++, fiber = fiber.return) {
          if (seenFibers.has(fiber)) continue;
          seenFibers.add(fiber);
          if (fiber.memoizedProps) roots.push(fiber.memoizedProps);
          if (fiber.memoizedState) roots.push(fiber.memoizedState);
          const props = fiber.stateNode?.props;
          if (props) roots.push(props);
          for (const candidate of [fiber.memoizedProps?.currentChallenge, props?.currentChallenge, props?.challenge]) {
            if (candidate && typeof candidate === 'object') currentChallenges.push(candidate);
          }
        }
      }
    }
    const choiceTexts = (req.choices || []).map(norm);
    const words = (req.words || []).map(norm);
    const visited = new WeakSet(); let count = 0;
    function values(value, depth = 0) {
      if (typeof value === 'string') return [norm(value)];
      if (!value || typeof value !== 'object' || depth > 3 || value instanceof Node) return [];
      if (Array.isArray(value)) return value.slice(0, 40).flatMap(x => values(x, depth + 1));
      return Object.entries(value).filter(([key]) => !/^(children|return|alternate|_owner|stateNode|ref)$/i.test(key)).flatMap(([, v]) => values(v, depth + 1));
    }
    // A named currentChallenge from the active React component is scoped to this question.
    const currentIndices = new Set();
    for (const current of currentChallenges) {
      if (!/multiple[-_ ]?choice/i.test(String(current.type || ''))) continue;
      const index = current.correctAnswerIndex;
      if (Number.isInteger(index) && index >= 0 && index < choiceTexts.length) currentIndices.add(index);
    }
    if (currentIndices.size === 1) {
      const index = [...currentIndices][0];
      return { index, answer: req.choices[index], fiberCount: seenFibers.size };
    }
    if (currentIndices.size > 1) return { fiberCount: seenFibers.size };
    // Story response candidates must match the question text as well as the choices.
    const prompt = norm(req.storyPrompt);
    const networkIndices = new Set();
    if (prompt.length >= 4) for (const element of storyElements) {
      if (!element || typeof element !== 'object') continue;
      const textValues = values(element);
      if (!textValues.includes(prompt)) continue;
      const seen = new WeakSet();
      function findCandidate(value, depth = 0) {
        if (!value || typeof value !== 'object' || value instanceof Node || seen.has(value) || depth > 6) return;
        seen.add(value);
        if (Array.isArray(value)) { for (const item of value.slice(0, 100)) findCandidate(item, depth + 1); return; }
        const options = value.choices || value.answers || value.options;
        const index = value.correctAnswerIndex;
        if (Array.isArray(options) && options.length === choiceTexts.length && Number.isInteger(index) && index >= 0 && index < choiceTexts.length && options.every((option, i) => choiceTexts[i] && values(option).includes(choiceTexts[i]))) networkIndices.add(index);
        for (const child of Object.values(value)) findCandidate(child, depth + 1);
      }
      findCandidate(element);
    }
    if (networkIndices.size === 1) {
      const index = [...networkIndices][0];
      return { index, answer: req.choices[index], fiberCount: seenFibers.size };
    }
    if (networkIndices.size > 1) return { fiberCount: seenFibers.size };
    function walk(value, depth) {
      if (!value || typeof value !== 'object' || value instanceof Node || visited.has(value) || depth > 6 || ++count > 8000) return null;
      visited.add(value);
      if (Array.isArray(value)) {
        if (value.length > 30) return null;
        for (const item of value) { const result = walk(item, depth + 1); if (result) return result; }
        return null;
      }
      if (prompt.length >= 4 && values(value.prompt || value.question || value.statement).includes(prompt) && Number.isInteger(value.correctAnswerIndex) && choiceTexts.length >= 2 && value.correctAnswerIndex >= 0 && value.correctAnswerIndex < choiceTexts.length) {
        const options = value.choices || value.answers || value.options;
        if (Array.isArray(options) && options.length === choiceTexts.length && options.every((option, i) => choiceTexts[i] && values(option).includes(choiceTexts[i]))) {
          return { index: value.correctAnswerIndex, answer: req.choices[value.correctAnswerIndex] };
        }
      }
      if (Array.isArray(value.phraseOrder) && words.length && value.phraseOrder.every(i => Number.isInteger(i) && i >= 0 && i < words.length)) {
        const phrases = value.phrases || value.choices || value.tokens;
        if (Array.isArray(phrases) && phrases.length === words.length && phrases.every((phrase, i) => values(phrase).includes(words[i]))) {
          const tokens = value.phraseOrder.map(i => req.words[i]);
          return { answer: tokens.join(' '), tokens };
        }
      }
      for (const [key, child] of Object.entries(value)) {
        if (/^(children|return|alternate|_owner|stateNode|ref)$/i.test(key)) continue;
        const result = walk(child, depth + 1); if (result) return result;
      }
      return null;
    }
    for (const object of roots) { const result = walk(object, 0); if (result) return { ...result, fiberCount: seenFibers.size }; }
    return { fiberCount: seenFibers.size };
  }
  function selectPodcastJudge(challenge, req) {
    const wanted = norm(req.prompt);
    if (wanted.length < 4 || (req.choices || []).length < 2) return {};
    const roots = [], seenFibers = new Set();
    for (const el of [challenge, ...challenge.querySelectorAll('[data-test="challenge-choice"]')]) {
      for (const key of Object.keys(el).filter(k => k.startsWith('__reactFiber$'))) {
        let fiber = el[key];
        for (let i = 0; fiber && i < 25; i++, fiber = fiber.return) {
          if (seenFibers.has(fiber)) continue;
          seenFibers.add(fiber);
          if (fiber.memoizedProps) roots.push(fiber.memoizedProps);
          if (fiber.memoizedState) roots.push(fiber.memoizedState);
        }
      }
    }
    roots.push(...podcastResponses, sessionChallenges);
    const found = new Set(), seen = new WeakSet(); let count = 0;
    function containsPrompt(value, depth = 0) {
      if (typeof value === 'string') return norm(value) === wanted;
      if (!value || typeof value !== 'object' || value instanceof Node || depth >= 3) return false;
      if (Array.isArray(value)) return value.length <= 40 && value.some(v => containsPrompt(v, depth + 1));
      return Object.entries(value).some(([key, val]) => /^(prompt|question|statement|sentence|text|value|displayText|content|transcript)$/i.test(key) && containsPrompt(val, depth + 1));
    }
    function walk(obj, depth) {
      if (!obj || typeof obj !== 'object' || obj instanceof Node || seen.has(obj) || depth > 9 || ++count > 25000) return;
      seen.add(obj);
      if (Array.isArray(obj)) { for (const item of obj.slice(0, 200)) walk(item, depth + 1); return; }
      const hasPrompt = Object.entries(obj).some(([key, value]) => /^(prompt|question|statement|sentence|text|displayText|content)$/i.test(key) && containsPrompt(value));
      if (hasPrompt) {
        for (const key of ['correctIndex', 'correctAnswerIndex', 'correctChoiceIndex', 'correctOptionIndex']) {
          if (Number.isInteger(obj[key]) && obj[key] >= 0 && obj[key] < req.choices.length) found.add(obj[key]);
        }
        if (req.booleanLabels) {
          for (const key of ['correctAnswer', 'isTrue', 'correctStatement']) {
            const val = obj[key];
            if (val === true || val === 'true') found.add(0);
            if (val === false || val === 'false') found.add(1);
          }
        }
      }
      for (const [key, value] of Object.entries(obj)) {
        if (!/^(children|return|alternate|_owner|stateNode|ref)$/i.test(key)) walk(value, depth + 1);
      }
    }
    for (const obj of roots) walk(obj, 0);
    if (!found.size) return { fiberCount: seenFibers.size };
    const indices = [...found].sort((a, b) => a - b);
    if (indices.length > 1) return { indices, answer: indices.map(index => req.choices[index]).join(' / '), fiberCount: seenFibers.size };
    const index = indices[0];
    return { index, answer: req.booleanLabels ? (index === 0 ? 'Đúng' : 'Sai') : `Lựa chọn ${index + 1}`, fiberCount: seenFibers.size };
  }
  document.addEventListener('duo-hint-request-v1', event => {
    let req; try { req = JSON.parse(event.detail); } catch { return; }
    const group = req.kind === 'podcast-judge' ? [...document.querySelectorAll('[role="radiogroup"]')].find(el => el.querySelector('[data-test="challenge-choice"]')) : null;
    const challenge = req.kind === 'podcast-judge' ? group?.parentElement?.parentElement : req.kind === 'stories-element' ? document.querySelectorAll('[data-test="stories-element"]')[req.storyIndex] : document.querySelector('[data-test^="challenge challenge-"]');
    if (!challenge) return;
    try {
    if (req.kind === 'podcast-judge') {
      const sessionResult = selectFromSession(req);
      if (sessionResult) {
        document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, answer: sessionResult.answer, index: sessionResult.index, indices: sessionResult.indices, source: 'session' }) }));
        return;
      }
      const result = selectPodcastJudge(challenge, req);
      document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, ...result, source: 'podcast-judge' }) }));
      return;
    }
    if (req.kind === 'stories-element') {
      const story = selectStory(challenge, req);
      document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, ...story, source: 'story' }) }));
      return;
    }
    const sessionResult = selectFromSession(req);
    if (sessionResult) {
      document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, answer: sessionResult.answer, tokens: sessionResult.tokens, index: sessionResult.index, indices: sessionResult.indices, pairs: sessionResult.pairs, pairIndices: sessionResult.pairIndices, source: 'session' }) }));
      return;
    }
    const words = Array.isArray(req.words) ? req.words.filter(x => typeof x === 'string') : [];
    const byText = new Map(words.map(w => [norm(w), w]));
    let bestPairs = [], answer = '', answerIndex;
    const visitedFibers = new Set(), objects = [];
    for (const el of [challenge, ...challenge.querySelectorAll('[data-test], button, [role="radio"]')]) {
      for (const key of Object.keys(el).filter(k => k.startsWith('__reactFiber$'))) {
        let fiber = el[key];
        for (let n = 0; fiber && n < 25; n++, fiber = fiber.return) {
          if (visitedFibers.has(fiber)) continue;
          visitedFibers.add(fiber);
          if (fiber.memoizedProps) objects.push(fiber.memoizedProps);
          if (fiber.memoizedState) objects.push(fiber.memoizedState);
        }
      }
    }
    const seen = new WeakSet(), reactChallenges = [], scopedAnswerIndices = new Set(); let count = 0;
    const sameOptions = options => Array.isArray(options) && options.length === (req.choices || []).length && options.every((option, index) => {
      const value = typeof option === 'string' ? option : option?.text ?? option?.label ?? option?.value;
      return !!norm(value) && norm(value) === norm(req.choices[index]);
    });
    function strings(obj, depth, out) {
      if (typeof obj === 'string') { const found = byText.get(norm(obj)); if (found) out.add(found); return; }
      if (!obj || typeof obj !== 'object' || depth > 3 || obj instanceof Node) return;
      if (Array.isArray(obj)) { for (const v of obj.slice(0, 30)) strings(v, depth + 1, out); return; }
      for (const [key, val] of Object.entries(obj)) {
        if (/^(children|return|alternate|_owner|stateNode|ref)$/i.test(key)) continue;
        strings(val, depth + 1, out);
      }
    }
    function walk(obj, depth) {
      if (!obj || typeof obj !== 'object' || obj instanceof Node || seen.has(obj) || depth > 8 || ++count > 18000) return;
      seen.add(obj);
      if (Array.isArray(obj)) {
        if (/challenge-match(?:\s|$)/.test(req.kind || '') && words.length >= 4 && obj.length >= 2 && obj.length <= 20) {
          const pairs = [];
          for (const item of obj) { const found = new Set(); strings(item, 0, found); if (found.size === 2) pairs.push([...found]); }
          const used = new Set(pairs.flat().map(norm));
          if (pairs.length > bestPairs.length && used.size === pairs.length * 2 && used.size === byText.size) bestPairs = pairs;
        }
        for (const item of obj.slice(0, 100)) walk(item, depth + 1);
        return;
      }
      if (/challenge-assist(?:\s|$)/i.test(req.kind || '') && (!obj.type || /^assist$/i.test(obj.type)) && Array.isArray(obj.choices) && Number.isInteger(obj.correctIndex)) {
        reactChallenges.push({ ...obj, type: 'assist' });
      }
      if (/challenge-(?:select|sameDifferent)(?:\s|$)/i.test(req.kind || '') &&
          (sameOptions(obj.choices) || (/challenge-sameDifferent(?:\s|$)/i.test(req.kind || '') && /^sameDifferent$/i.test(obj.type || ''))) &&
          (Number.isInteger(obj.correctIndex) || Number.isInteger(obj.correctAnswerIndex) || Number.isInteger(obj.correctChoiceIndex) ||
            (Array.isArray(obj.correctIndices) && obj.correctIndices.length === 1))) {
        const type = /challenge-select(?:\s|$)/i.test(req.kind || '') ? 'select' : 'sameDifferent';
        reactChallenges.push({ ...obj, type, currentScope: true, correctIndex: obj.correctIndex ?? obj.correctAnswerIndex ?? obj.correctChoiceIndex ?? obj.correctIndices[0] });
      }
      if (/tapComplete/i.test(req.kind || '') && Array.isArray(obj.choices) && (Array.isArray(obj.correctIndices) || Array.isArray(obj.displayTokens))) {
        reactChallenges.push({ ...obj, type: obj.type || 'tapComplete' });
      }
      if (/challenge-listenTap(?:\s|$)/i.test(req.kind || '') && (!obj.type || /^listenTap$/i.test(obj.type)) && (Array.isArray(obj.correctTokens) || Array.isArray(obj.correctIndices))) {
        const choices = Array.isArray(obj.choices) ? obj.choices : Array.isArray(obj.correctTokens) && Array.isArray(obj.wrongTokens) ? [...obj.correctTokens, ...obj.wrongTokens] : null;
        if (choices) reactChallenges.push({ ...obj, choices, type: 'listenTap' });
      }
      for (const [key, val] of Object.entries(obj)) {
        if (/^(children|return|alternate|_owner|stateNode|ref)$/i.test(key)) continue;
        if (sameOptions(obj.choices) && /^(correctIndex|correctChoiceIndex|correctAnswerIndex)$/i.test(key) && Number.isInteger(val) && val >= 0 && val < req.choices.length) scopedAnswerIndices.add(val);
        if (!answer && sameOptions(obj.choices) && (obj.isCorrect === true || obj.correct === true || obj.is_correct === true)) answer = [obj.text, obj.value, obj.label, obj.word].find(x => typeof x === 'string') || '';
        if (!answer && sameOptions(obj.choices) && /^(correctAnswer|correctSolution|solutionText|solutionTranslation|bestSolution|best_solution)$/i.test(key) && typeof val === 'string' && (req.choices || []).some(choice => norm(choice) === norm(val))) answer = val;
        if (!answer && sameOptions(obj.choices) && /^(correctSolutions|solutions|correctAnswers)$/i.test(key) && Array.isArray(val)) {
          const solution = val.find(x => typeof x === 'string');
          if (solution && (req.choices || []).some(choice => norm(choice) === norm(solution))) answer = solution;
        }
        walk(val, depth + 1);
      }
    }
    for (const object of objects) walk(object, 0);
    if (!Number.isInteger(answerIndex) && scopedAnswerIndices.size === 1) answerIndex = [...scopedAnswerIndices][0];
    const reactResult = selectFromSession(req, reactChallenges);
    if (reactResult) {
      document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, answer: reactResult.answer, tokens: reactResult.tokens, index: reactResult.index, indices: reactResult.indices, pairs: reactResult.pairs, pairIndices: reactResult.pairIndices, source: 'react', fiberCount: visitedFibers.size }) }));
      return;
    }
    if (/tapComplete|challenge-listenTap|challenge-assist/i.test(req.kind || '')) {
      document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, fiberCount: visitedFibers.size }) }));
      return;
    }
    document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, pairs: bestPairs, answer, index: answerIndex, fiberCount: visitedFibers.size }) }));
    } catch (error) {
      document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, error: String(error?.name || 'Error') }) }));
    }
  });
})();

(() => {
  const css = `#duolingo-hint-card {
  margin: 14px 0 10px;
  padding: 12px 15px;
  border: 2px solid #58cc02;
  border-radius: 14px;
  color: #263238;
  background: #f3ffe9;
  font: 600 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 3px 10px #26323812;
}
#duolingo-hint-card .duo-hint-label { display: block; margin-bottom: 3px; color: #398b00; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.duo-hint-correct { position: relative !important; overflow: visible !important; }
.duo-hint-correct::after { content: '✓'; position: absolute; top: -7px; left: -7px; z-index: 3; display: grid; width: 20px; height: 20px; place-items: center; border: 2px solid #fff; border-radius: 50%; color: white; background: #58a700; font: 800 12px/1 system-ui, sans-serif; pointer-events: none; box-shadow: 0 1px 3px #0004; }
.duo-hint-anchor { position: relative !important; overflow: visible !important; }
.duo-hint-number { position: absolute; top: -7px; left: -7px; z-index: 3; display: grid; min-width: 20px; height: 20px; padding: 0 3px; place-items: center; border: 2px solid #fff; border-radius: 999px; color: #fff; background: #58a700; font: 800 11px/1 system-ui, sans-serif; pointer-events: none; box-shadow: 0 1px 3px #0004; }

#duo-hint-ctrl { position: fixed; right: 12px; top: 50%; transform: translateY(-50%); z-index: 2147483001; display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 52px; height: 52px; margin: 0; padding: 0; border: 0; border-radius: 50%; background: transparent; line-height: 0; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; box-shadow: none; }
#duo-hint-ctrl img { position: absolute; top: 50%; left: 50%; display: block; width: 52px; height: 52px; max-width: none; max-height: none; margin: 0; padding: 0; object-fit: contain; object-position: center; vertical-align: top; transform: translate(-50%, -50%); pointer-events: none; }
#duo-hint-ctrl:hover { filter: brightness(1.08); }
#duo-hint-ctrl:active { cursor: grabbing; }
#duo-hint-ctrl[aria-disabled="true"] { opacity: .45; }
#duo-hint-ctrl[hidden] { display: none !important; }
#duo-hint-fab { position: fixed; top: 12px; left: 12px; right: auto; bottom: auto; z-index: 2147483000; display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 38px; height: 38px; margin: 0; padding: 0; border: 2px solid #fff; border-radius: 50%; background: #9aa5ad; line-height: 0; transform: none; cursor: pointer; opacity: .75; box-shadow: 0 2px 8px #0004; }
#duo-hint-fab[hidden] { display: none !important; }
#duo-hint-fab.duo-hint-mobile-nav { position: relative; top: auto; left: auto; right: auto; bottom: auto; flex: 0 0 38px; width: 38px; height: 38px; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; opacity: 1; box-shadow: none; transform: none; }
#duo-hint-fab img { position: absolute; top: 50%; left: 50%; display: block; width: 30px; height: 30px; max-width: none; max-height: none; margin: 0; padding: 0; object-fit: contain; object-position: center; vertical-align: top; transform: translate(-50%, -50%); pointer-events: none; }
#duo-hint-fab:hover, #duo-hint-fab.on { opacity: 1; }
#duo-hint-fab.on { background: #58a700; }
#duo-hint-fab.duo-hint-mobile-nav, #duo-hint-fab.duo-hint-mobile-nav:hover, #duo-hint-fab.duo-hint-mobile-nav.on { border: 0; background: transparent; opacity: 1; box-shadow: none; }
#duo-hint-panel { position: fixed; left: 12px; bottom: 56px; z-index: 2147483005; width: 290px; max-height: 80vh; max-height: calc(100dvh - 76px); overflow: auto; overscroll-behavior: contain; touch-action: pan-y; pointer-events: auto !important; box-sizing: border-box; padding: 14px; border: 2px solid #e5e5e5; border-radius: 16px; color: #3c3c3c; background: #fff; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 6px 24px #0003; }
#duo-hint-panel[hidden] { display: none; }
#duo-hint-panel h3 { margin: 0 0 10px; padding-right: 34px; font-size: 17px; } #duo-hint-panel h3 small { color: #999; font-weight: 600; font-size: 12px; }
#duo-hint-panel .duo-hint-close { position: absolute; top: 8px; right: 8px; z-index: 1; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; margin: 0; padding: 0; border: 0; border-radius: 8px; color: #777; background: transparent; font: 400 26px/1 system-ui, sans-serif; cursor: pointer; }
#duo-hint-panel .duo-hint-close:hover { color: #333; background: #f2f2f2; }
#duo-hint-panel .duo-hint-note, #duo-hint-panel .duo-hint-status, #duo-hint-panel .duo-hint-copy { display: none !important; }
#duo-hint-panel .duo-hint-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; cursor: pointer; }
#duo-hint-panel .duo-hint-row small { display: block; color: #777; }
#duo-hint-panel .duo-hint-row input { position: absolute; opacity: 0; pointer-events: none; }
#duo-hint-panel .duo-hint-switch { position: relative; flex: none; width: 40px; height: 22px; border-radius: 11px; background: #ccc; transition: background .15s; }
#duo-hint-panel .duo-hint-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
#duo-hint-panel input:checked + .duo-hint-switch { background: #58cc02; } #duo-hint-panel input:checked + .duo-hint-switch::after { transform: translateX(18px); }
#duo-hint-panel .duo-hint-group { margin: 10px 0; padding: 6px 10px; border: 1px solid #e5e5e5; border-radius: 10px; } #duo-hint-panel .duo-hint-group legend { padding: 0 4px; font-weight: 700; font-size: 12px; color: #777; }
#duo-hint-panel .duo-hint-group label { display: flex; align-items: center; min-height: 42px; margin: 3px 0; padding: 6px 8px; border-radius: 8px; cursor: pointer; touch-action: manipulation; pointer-events: auto !important; }
#duo-hint-panel .duo-hint-group input[type="radio"] { position: static !important; flex: none; width: 18px; height: 18px; margin: 0 10px 0 0; opacity: 1 !important; pointer-events: auto !important; appearance: auto !important; accent-color: #58cc02; }
@media (max-width: 600px) { #duo-hint-panel { left: 10px; right: 10px; bottom: 54px; width: auto; max-height: calc(100vh - 76px); max-height: calc(100dvh - 76px); padding: 12px; } }
#duo-hint-panel .duo-hint-note, #duo-hint-panel .duo-hint-status { margin: 8px 0; font-size: 12px; color: #777; word-break: break-word; }
#duo-hint-panel .duo-hint-copy { width: 100%; padding: 7px; border: 2px solid #e5e5e5; border-radius: 10px; background: #fff; font: 700 12px system-ui, sans-serif; cursor: pointer; }
`;
  const add = () => { if (document.getElementById('duo-hint-style')) return; const s = document.createElement('style'); s.id = 'duo-hint-style'; s.textContent = css; (document.head || document.documentElement).append(s); };
  add();
  document.addEventListener('DOMContentLoaded', add, { once: true });
})();

(() => {
  const VERSION = '1.2.27';
  const ICON_HINT_FALLBACK = 'data:image/png;base64,' +
    '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' +
    'SUVORK5CYII=';
  const ICON_CTRL_FALLBACK = 'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAioAAAIqCAMAAAA97pGBAAAAAXNSR0IB2cksfwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAJZQTFRFOq88AAAA////N645M601' +
    'Ma00LawwLawwMa0zKassKassSbVLVrlYR7RJasBrv+G/IqklVrlYPrFA+/77Yr5kJaooSrVM9Pv05fTlh8uId8V4fsh/N645M601PrFAasBrisyL3vHed8Z4' +
    'sN2xYr5k7vju1u3WOq88zurPjM2NyOfIgMmBoNahuOC5k9CUe8Z8qturmdSaqmc6aAAAADJ0Uk5T/wD/////6P/f8v//iaxc////wf9t+6X//xg+/9Ha////' +
    '////////yv8L/yj///8z//9kH4l6AAAhi0lEQVR4nO2daVfjOgxAk9pJutOWFujQspQdhgfz///cS9ItTZ1diq1E99s7550z0F5sSZZly2YCPm43m/v75+fp' +
    'dDC4s6y7u8FgMJ1On583tx+6fzZDsHT/ANr4+BnPh1ezlbvouW7XkVJssfbs/ls6Xdft9Rbd2dV8/LPU/WPro3WqfIyHs7fVeh3IIaNmZLLzprter95G8x/d' +
    'v0jttEiVr/mo13OdYn4kWSOl6y80V+MWrTJtUGU5Ho5m3UCSqoqcKSMdtzsbDedtMKbpqgy7i3AhgZbkRBjfmN5kNtb9uyLTYFX+DGduF9WRU2Gk2x0N/+j+' +
    'rfFopirLkZ/WIK8lSl1EEMJcNTO9bp4qH/NZz6ldkhNhnN5s/qX7cwCnWaosR5MeQvRawhbhuJNus6KXBqnyc6V5NTlD9poU6zZElT+zVdeE1SSOkN3VqCHV' +
    'uiaospz1TNRkTxC6NKHuQl6V8ahr2LajQDjd0Vz3J1UV2qrMe279GXE5/DR6MdT9eVWCsCrjmSt1C1AM4b4RDnOpqjIOSmy6v/oS+GsL1Z2IpCrLIbX1JIpw' +
    'r0jW5wiqsl6YH8em4+dEru5PsTjUVPl6c4l7ssN9o1ZuoaUKhcQ4L0KuZ7o/z0IQUuVj1ZAF5YBwu4Rqc2RUma+as6BEcFZkEiIaqny89QinPOnIHpF9iIIq' +
    'f2ZeExeUA8IdUciezVdluCBZayuEcCbml3FNV2XctFA2CemaLovZqqyaG6KcY3rQYrIqw15LVpQ9omdyOmSuKqNui1aUPbJr7spiqirDtsQocYR7pfuzT8BM' +
    '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';
  const REQUEST = 'duo-hint-request-v1', RESPONSE = 'duo-hint-response-v1', CARD = 'duolingo-hint-card';
  let enabled = false, autoContinue = true, mode = 'full', ctrlMode = 'all', observer, continueObserver, lastAutoContinued = null, pending = false, timer, requestId = 0;
  let diagnostics = { bridge: 'chưa kiểm tra', reactFibers: null, pairs: 0, result: 'chưa kiểm tra' };
  const savedSequences = new WeakMap();
  const podcastPairs = new WeakMap();
  const heldKeys = new Set();
  const observeOptions = { childList: true, subtree: true, attributes: true, attributeFilter: ['data-test', 'aria-disabled', 'aria-checked', 'aria-pressed', 'disabled', 'aria-hidden', 'hidden', 'class'] };
  let ctrlArmed = false, shortcutState = null, clickLocked = false, fillRun = null;
  const normalize = s => String(s || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  function root() {
    const lesson = document.querySelector('[data-test^="challenge challenge-"]');
    if (lesson) return lesson;
    const grid = document.querySelector('[style*="--match-challenge-rows"]');
    if (grid?.querySelectorAll('button[data-test$="-challenge-tap-token"]').length >= 2) return grid.parentElement;
    if (document.querySelector('img[src*="/images/duoRadio/"]')) {
      const group = [...document.querySelectorAll('[role="radiogroup"]')].find(el => el.querySelector('[data-test="challenge-choice"]'));
      if (group?.parentElement?.parentElement) return group.parentElement.parentElement;
    }
    const elements = [...document.querySelectorAll('[data-test="stories-element"]')];
    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i];
      // A question can contain a nested stories-element for its prompt; its outer
      // element owns the choices and must be considered as the active question.
      if (element.parentElement?.closest('[data-test="stories-element"]')) continue;
      if (!element.getClientRects().length || getComputedStyle(element).visibility !== 'visible') continue;
      if (element.querySelector('[data-test="stories-choice"], button[data-test*="challenge-tap-token"]')) return element;
      if ((element.textContent || '').trim()) return null;
    }
    return null;
  }
  const storyChoiceText = choice => (choice?.closest('li')?.querySelector('.phrase')?.textContent || choice?.getAttribute('aria-label') || '').trim();
  function podcastResult(challenge) {
    const grid = challenge.querySelector('[style*="--match-challenge-rows"]');
    if (!grid) return null;
    const buttons = [...grid.querySelectorAll('button[data-test$="-challenge-tap-token"]')];
    const groups = new Map();
    buttons.forEach((button, index) => {
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      const key = button.getAttribute('data-test');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ index, lang: button.getAttribute('lang') });
    });
    let saved = podcastPairs.get(grid);
    const matches = [...groups.entries()].filter(([, members]) => members.length === 2 && members[0].lang && members[1].lang && members[0].lang !== members[1].lang);
    if (saved && matches.length && !matches.some(([key]) => saved.has(key)) && ![...groups.keys()].some(key => saved.has(key))) saved = null;
    if (!saved) saved = new Map();
    for (const [key] of matches) {
      if (!saved.has(key)) {
        const usedNumbers = new Set(saved.values());
        let number = 1;
        while (usedNumbers.has(number)) number++;
        saved.set(key, number);
      }
    }
    if (saved.size) podcastPairs.set(grid, saved);
    const pairIndices = [], pairs = [];
    for (const [key, members] of groups) {
      const number = saved.get(key);
      if (!number || members.length > 2 || (members.length === 2 && (!members[0].lang || !members[1].lang || members[0].lang === members[1].lang))) continue;
      const text = key.slice(0, -'-challenge-tap-token'.length);
      pairIndices.push({ number, indices: members.map(member => member.index) });
      pairs.push([text, text]);
    }
    return { pairIndices, pairs, source: 'podcast' };
  }
  function tokenText(button) {
    const explicit = button.querySelector('[data-test="challenge-tap-token-text"]');
    if (explicit) return explicit.textContent.trim();
    const test = button.getAttribute('data-test') || '';
    const suffix = '-challenge-tap-token';
    if (test.endsWith(suffix)) return test.slice(0, -suffix.length).trim();
    const copy = button.cloneNode(true);
    copy.querySelectorAll('.duo-hint-number').forEach(el => el.remove());
    return (copy.querySelector('[lang]')?.textContent || copy.textContent || '').trim();
  }
  function splitAnswer(answer, buttons) {
    const target = normalize(answer);
    const terms = buttons.map(tokenText).map(normalize);
    if (!target || !terms.length || terms.length > 30 || target.length > 200) return [];
    const solutions = new Map();
    let steps = 0;
    function walk(pos, remaining, sequence) {
      if (++steps > 10000 || solutions.size > 1) return;
      if (pos === target.length) { solutions.set(sequence.join('\u0000'), sequence); return; }
      const attempted = new Set();
      for (let i = 0; i < terms.length; i++) {
        const term = terms[i];
        if (!remaining[i] || !term || attempted.has(term) || !target.startsWith(term, pos)) continue;
        attempted.add(term); remaining[i] = false;
        walk(pos + term.length, remaining, [...sequence, term]);
        remaining[i] = true;
      }
    }
    walk(0, terms.map(() => true), []);
    return solutions.size === 1 ? [...solutions.values()][0] : [];
  }
  function storyBlankAnswer(challenge, bank) {
    if (challenge.getAttribute('data-test') !== 'stories-element' || !bank) return null;
    const available = [...bank.querySelectorAll('button[data-test*="challenge-tap-token"]')].map(tokenText);
    const blanks = [...challenge.querySelectorAll('span')].filter(span => {
      if (bank.contains(span) || span.children.length || !span.textContent.trim() || !span.getClientRects().length) return false;
      const style = getComputedStyle(span);
      const transparent = style.color === 'transparent' || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/i.test(style.color);
      return transparent && style.display !== 'none' && style.visibility === 'visible' && parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== 'none';
    }).map(span => span.textContent.trim());
    if (!blanks.length) return null;
    const remaining = available.map(normalize);
    for (const blank of blanks) {
      const index = remaining.indexOf(normalize(blank));
      if (index < 0) return null;
      remaining.splice(index, 1);
    }
    return { answer: blanks.join(' '), tokens: blanks, source: 'story-blank' };
  }
  function storyListeningAnswer(challenge, bank) {
    if (challenge.getAttribute('data-test') !== 'stories-element' || !bank) return null;
    const line = challenge.previousElementSibling;
    if (!line || line.getAttribute('data-test') !== 'stories-element' || !visibleToken(line, line.parentElement)) return null;
    const phrases = [...line.querySelectorAll('.phrase')];
    if (phrases.length !== 1) return null;
    const phrase = phrases[0];
    const hidden = [...phrase.querySelectorAll('span')].some(span => {
      if (span.children.length || !normalize(span.textContent)) return false;
      const style = getComputedStyle(span);
      return (style.color === 'transparent' || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/i.test(style.color)) &&
        parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== 'none';
    });
    if (!hidden) return null;
    const copy = phrase.cloneNode(true);
    copy.querySelectorAll('rt, rp').forEach(node => node.remove());
    const answer = (copy.textContent || '').trim();
    const buttons = [...bank.querySelectorAll('button[data-test*="challenge-tap-token"]')];
    const sequence = splitAnswer(answer, buttons);
    if (!sequence.length) return null;
    return { answer, tokens: sequence, source: 'story-listening' };
  }
  function numberTokens(challenge, answer, tokens, showNumbers = true) {
    const bank = challenge.querySelector('[data-test="word-bank"]') || (challenge.getAttribute('data-test') === 'stories-element' ? challenge : null);
    if (!bank) return;
    const buttons = [...bank.querySelectorAll('button[data-test*="challenge-tap-token"]')];
    let sequence = Array.isArray(tokens) && tokens.length ? tokens.map(normalize) : splitAnswer(answer, buttons);
    const saved = savedSequences.get(challenge);
    if (!sequence.length && saved?.answer === answer) sequence = saved.sequence;
    if (sequence.length) savedSequences.set(challenge, { answer, sequence });
    if (!showNumbers) return sequence;
    const used = new Set();
    sequence.forEach((token, index) => {
      const button = buttons.find(el => !used.has(el) && normalize(tokenText(el)) === token);
      if (!button) return;
      used.add(button);
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      const badge = document.createElement('span'); badge.className = 'duo-hint-number'; badge.setAttribute('aria-hidden', 'true'); badge.textContent = String(index + 1);
      button.classList.add('duo-hint-anchor'); button.append(badge);
    });
    return sequence;
  }
  function editableTarget(target) {
    return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  }
  function choiceText(choice) {
    const label = choice.querySelector('[data-test="challenge-judge-text"]');
    const copy = (label || choice).cloneNode(true);
    copy.querySelectorAll('rt, rp, svg, .duo-hint-number, .n2-shortcut-desc, .n2-answer-text').forEach(node => node.remove());
    return (copy.textContent || '').trim();
  }
  function directVietnameseNumberChoice(challenge, choices) {
    if (!challenge.getAttribute('data-test')?.startsWith('challenge-select')) return null;
    const header = normalize(challenge.querySelector('[data-test="challenge-header"]')?.textContent || '');
    if (!header.includes('d\u00e2ul\u00e0')) return null;
    const numeralWords = new Map([
      ['kh\u00f4ng', ['\u96f6']], ['m\u1ed9t', ['\u4e00']], ['hai', ['\u4e8c', '\u4e24']], ['ba', ['\u4e09']],
      ['b\u1ed1n', ['\u56db']], ['t\u01b0', ['\u56db']], ['n\u0103m', ['\u4e94']], ['s\u00e1u', ['\u516d']],
      ['b\u1ea3y', ['\u4e03']], ['t\u00e1m', ['\u516b']], ['ch\u00edn', ['\u4e5d']], ['m\u01b0\u1eddi', ['\u5341']],
      ['0', ['\u96f6']], ['1', ['\u4e00']], ['2', ['\u4e8c', '\u4e24']], ['3', ['\u4e09']],
      ['4', ['\u56db']], ['5', ['\u4e94']], ['6', ['\u516d']], ['7', ['\u4e03']], ['8', ['\u516b']],
      ['9', ['\u4e5d']], ['10', ['\u5341']]
    ]);
    const found = [...numeralWords.entries()].filter(([word]) => header.includes(normalize(word)))
      .sort((a, b) => normalize(b[0]).length - normalize(a[0]).length);
    if (!found.length) return null;
    for (const [, translations] of found) {
      const indexes = choices.map((choice, index) => translations.includes(normalize(choice)) ? index : -1).filter(index => index >= 0);
      if (indexes.length === 1) return { index: indexes[0], answer: choices[indexes[0]] };
      if (indexes.length > 1) return null;
    }
    return null;
  }
  function resolveChoice(challenge, answer, correctIndex) {
    const story = challenge.getAttribute('data-test') === 'stories-element';
    const choices = [...challenge.querySelectorAll(story ? '[data-test="stories-choice"]' : '[data-test="challenge-choice"]')];
    const answerText = normalize(answer);
    const matches = answerText ? choices.map((choice, index) => {
      const text = story ? storyChoiceText(choice) : choiceText(choice);
      return normalize(text) === answerText ? index : -1;
    }).filter(index => index >= 0) : [];
    if (Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < choices.length) {
      if (matches.length && !matches.includes(correctIndex)) return null;
      return choices[correctIndex];
    }
    return matches.length === 1 ? choices[matches[0]] : null;
  }
  function selectedWordTokens(challenge, bank) {
    return [...challenge.querySelectorAll('button[data-test*="challenge-tap-token"]')]
      .filter(button => !bank.contains(button) && visibleToken(button, challenge))
      .map(button => normalize(tokenText(button)));
  }
  function isAnswerPrefix(selected, sequence) {
    return selected.length <= sequence.length && selected.every((token, index) => token === sequence[index]);
  }
  async function fillRemainingTokens(run) {
    const { challenge, sequence } = run;
    const active = () => enabled && fillRun === run && !run.cancelled && root() === challenge &&
      !editableTarget(document.activeElement) &&
      !(document.querySelector('[data-test="player-next"]') && pastCheckStage()) &&
      (!shortcutState || shortcutState.challenge !== challenge || !shortcutState.sequence ||
        (shortcutState.sequence.length === sequence.length && shortcutState.sequence.every((token, index) => token === sequence[index])));
    try {
      while (active()) {
        const bank = challenge.querySelector('[data-test="word-bank"]');
        if (!bank || challenge.querySelector('[style*="--match-challenge-rows"]')) return;
        const selected = selectedWordTokens(challenge, bank);
        if (!isAnswerPrefix(selected, sequence) || selected.length === sequence.length) return;
        const next = [...bank.querySelectorAll('button[data-test*="challenge-tap-token"]')].find(button =>
          !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
          visibleToken(button, challenge) && normalize(tokenText(button)) === sequence[selected.length]);
        if (!next) return;
        next.click();
        if (run.single) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return;
        }
        let advanced = false;
        for (let attempts = 0; attempts < 25; attempts++) {
          await new Promise(resolve => setTimeout(resolve, 60));
          if (!active()) return;
          const currentBank = challenge.querySelector('[data-test="word-bank"]');
          if (!currentBank) return;
          const current = selectedWordTokens(challenge, currentBank);
          if (!isAnswerPrefix(current, sequence) || current.length < selected.length) return;
          if (current.length > selected.length) { advanced = true; break; }
        }
        if (!advanced) return;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally {
      if (fillRun === run) fillRun = null;
    }
  }
  function selectNextToken() {
    if (!enabled || pending || clickLocked || fillRun || !shortcutState || editableTarget(document.activeElement)) return;
    const challenge = root();
    if (challenge !== shortcutState.challenge) return;
    if (shortcutState.choice) {
      const choice = shortcutState.choice;
      const footer = document.querySelector('[data-test="player-next"]');
      if (!challenge.contains(choice) || (footer && pastCheckStage()) || choice.disabled || choice.getAttribute('aria-disabled') === 'true' || choice.getAttribute('aria-checked') === 'true' || choice.getAttribute('aria-pressed') === 'true' || choice.querySelector('input:checked') || !visibleToken(choice, challenge)) return;
      clickLocked = true;
      choice.click();
      setTimeout(() => { clickLocked = false; }, 250);
      return;
    }
    if (!shortcutState.sequence?.length) return;
    if (!challenge.querySelector('[data-test="word-bank"]')) {
      // Story exercises without a separate bank cannot expose the selected order reliably.
      if (challenge.getAttribute('data-test') !== 'stories-element') return;
      const buttons = [...challenge.querySelectorAll('button[data-test*="challenge-tap-token"]')];
      const used = new Set();
      for (const token of shortcutState.sequence) {
        const matches = buttons.filter(button => !used.has(button) && normalize(tokenText(button)) === token);
        const selected = matches.find(button => button.disabled || button.getAttribute('aria-disabled') === 'true');
        if (selected) { used.add(selected); continue; }
        const next = matches.find(button => visibleToken(button, challenge) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
        if (!next) continue;
        clickLocked = true;
        next.click();
        setTimeout(() => { clickLocked = false; }, 250);
        return;
      }
      return;
    }
    const run = { challenge, sequence: [...shortcutState.sequence], cancelled: false, single: ctrlMode === 'one' };
    fillRun = run;
    void fillRemainingTokens(run);
  }
  function visibleToken(element, challenge) {
    if (!element.getClientRects().length) return false;
    for (let node = element; node && node !== challenge; node = node.parentElement) {
      if (node.getAttribute('aria-hidden') === 'true' || node.hidden) return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  function pastCheckStage() {
    const button = document.querySelector('[data-test="player-next"]');
    if (!button) return true;
    const text = (button.innerText || button.textContent || '').trim();
    return !/^(kiểm tra|check)(?:\s|\(|$)/i.test(text);
  }
  function continueButton() {
    const labels = /(?:ti\u1ebfp t\u1ee5c|continue|next|got it|\u7ee7\u7eed)/i;
    return [...document.querySelectorAll('[data-test="player-next"], [data-test="stories-player-continue"]')].find(button => {
      const text = (button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim();
      if (!labels.test(text) || button.disabled || button.getAttribute('aria-disabled') === 'true' || !button.getClientRects().length) return false;
      const style = getComputedStyle(button);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
    }) || null;
  }
  function maybeAutoContinue() {
    if (!autoContinue) return;
    const button = continueButton();
    if (!button) { lastAutoContinued = null; return; }
    if (lastAutoContinued?.button === button && lastAutoContinued.stage === 'continue') return;
    lastAutoContinued = { button, stage: 'continue' };
    button.click();
  }
  function startAutoContinue() {
    if (!autoContinue) return;
    if (!continueObserver && document.documentElement) {
      continueObserver = new MutationObserver(maybeAutoContinue);
      continueObserver.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['disabled', 'aria-disabled', 'data-test', 'hidden', 'class']
      });
    }
    maybeAutoContinue();
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Control') {
      if (!event.repeat && !event.altKey && !event.metaKey && !event.shiftKey && heldKeys.size === 0 && !editableTarget(event.target)) ctrlArmed = true;
    } else {
      heldKeys.add(event.code || event.key);
      ctrlArmed = false;
    }
  }, true);
  document.addEventListener('keyup', event => {
    if (event.key === 'Control') {
      const armed = ctrlArmed;
      ctrlArmed = false;
      if (armed && !event.altKey && !event.metaKey && !event.shiftKey && !editableTarget(event.target)) selectNextToken();
    } else heldKeys.delete(event.code || event.key);
  }, true);
  document.addEventListener('pointerdown', () => { ctrlArmed = false; if (fillRun) fillRun.cancelled = true; }, true);
  window.addEventListener('blur', () => { ctrlArmed = false; heldKeys.clear(); if (fillRun) fillRun.cancelled = true; });
  const clean = () => {
    document.getElementById(CARD)?.remove();
    document.querySelectorAll('.duo-hint-number').forEach(el => el.remove());
    document.querySelectorAll('.duo-hint-correct').forEach(el => el.classList.remove('duo-hint-correct'));
    document.querySelectorAll('.duo-hint-anchor').forEach(el => el.classList.remove('duo-hint-anchor'));
  };
  function card(text) {
    if (mode === 'compact') return;
    const container = root(); if (!container) return;
    let el = document.getElementById(CARD);
    if (!el) { el = document.createElement('aside'); el.id = CARD; container.prepend(el); }
    if (el.dataset.value === text) return;
    el.dataset.value = text;
    el.replaceChildren();
    const label = document.createElement('span'); label.className = 'duo-hint-label'; label.textContent = 'Gợi ý đáp án';
    const value = document.createElement('span'); value.textContent = text; el.append(label, value);
  }
  function schedule() {
    if (!enabled || pending) return;
    pending = true;
    timer = setTimeout(() => {
      pending = false;
      const challenge = root();
      if (!challenge) { clean(); return; }
      observer?.disconnect();
      card('Đang tìm dữ liệu đáp án…');
      observer?.observe(document.documentElement, observeOptions);
      const id = ++requestId;
      const bank = challenge.querySelector('[data-test="word-bank"]');
      const wordRoot = bank || challenge;
      const words = [...wordRoot.querySelectorAll('button[data-test*="challenge-tap-token"]')].map(tokenText).filter(Boolean);
      const hintWords = [...challenge.querySelectorAll('[data-test="hint-token"][aria-label]')].map(el => el.getAttribute('aria-label')).filter(Boolean);
      const story = challenge.getAttribute('data-test') === 'stories-element';
      const storyPrompt = story ? (challenge.querySelector('.phrase')?.textContent || '').trim() : '';
      const podcastJudge = !story && !challenge.getAttribute('data-test') && !!challenge.querySelector('[role="radiogroup"] [data-test="challenge-choice"]');
      const choices = story ? [...challenge.querySelectorAll('[data-test="stories-choice"]')].map(storyChoiceText) : [...challenge.querySelectorAll('[data-test="challenge-choice"]')].map(choiceText);
      const storyIndex = story ? [...document.querySelectorAll('[data-test="stories-element"]')].indexOf(challenge) : -1;
      const clone = challenge.cloneNode(true);
      clone.querySelector('#' + CARD)?.remove();
      clone.querySelectorAll('.duo-hint-number').forEach(el => el.remove());
      const screen = clone.textContent || '';
      const audioUrls = [...performance.getEntriesByType('resource')]
        .map(entry => entry.name).filter(url => /\.mp3(?:[?#]|$)|dyvwhs7jlfw68\.cloudfront\.net/i.test(url)).slice(-40);
      let prompt = '', booleanLabels = false;
      if (podcastJudge) {
        clone.querySelector('[role="radiogroup"]')?.remove();
        prompt = (clone.textContent || '').trim();
        const radios = [...challenge.querySelectorAll('[role="radiogroup"] [data-test="challenge-choice"]')];
        booleanLabels = radios.length === 2 && radios[0].querySelector('svg')?.getAttribute('viewBox') === '0 0 41 28' && radios[1].querySelector('svg')?.getAttribute('viewBox') === '0 0 36 38';
      }
      let received = false;
      const acknowledge = e => { try { if (JSON.parse(e.detail).id === id) received = true; } catch {} };
      document.addEventListener(RESPONSE, acknowledge, { once: true });
      const isPodcast = !!challenge.querySelector('[style*="--match-challenge-rows"]') && !challenge.getAttribute('data-test')?.startsWith('challenge ');
      const blankAnswer = storyBlankAnswer(challenge, bank) || storyListeningAnswer(challenge, bank);
      const localNumberChoice = directVietnameseNumberChoice(challenge, choices);
      if (localNumberChoice) {
        document.dispatchEvent(new CustomEvent(RESPONSE, { detail: JSON.stringify({ id, ...localNumberChoice, source: 'local-number' }) }));
      } else if (blankAnswer) {
        document.dispatchEvent(new CustomEvent(RESPONSE, { detail: JSON.stringify({ id, ...blankAnswer }) }));
      } else if (isPodcast) {
        document.dispatchEvent(new CustomEvent(RESPONSE, { detail: JSON.stringify({ id, ...podcastResult(challenge) }) }));
      } else {
        document.dispatchEvent(new CustomEvent(REQUEST, { detail: JSON.stringify({ id, words, choices, hintWords, screen, prompt, storyPrompt, booleanLabels, audioUrls, kind: podcastJudge ? 'podcast-judge' : challenge.getAttribute('data-test'), storyIndex }) }));
      }
      setTimeout(() => {
        document.removeEventListener(RESPONSE, acknowledge);
        if (!received && enabled && id === requestId && root() === challenge) {
          diagnostics = { bridge: 'không phản hồi', reactFibers: null, pairs: 0, result: 'không đọc được dữ liệu trang' };
          observer?.disconnect();
          card('Không thể đọc dữ liệu trang. Hãy tải lại trang Duolingo.');
          observer?.observe(document.documentElement, observeOptions);
        }
      }, 800);
    }, 120);
  }
  function start() {
    if (!observer) {
      observer = new MutationObserver(records => {
        if (records.every(r => r.target instanceof Element && (r.target.closest('#' + CARD) || r.target.closest('.duo-hint-number')))) return;
        schedule();
      });
      observer.observe(document.documentElement, observeOptions);
    }
    schedule();
  }
  document.addEventListener('duo-hint-session-v1', () => { if (enabled) schedule(); });
  function stop() { if (fillRun) fillRun.cancelled = true; observer?.disconnect(); observer = null; clearTimeout(timer); pending = false; requestId++; shortcutState = null; clean(); }
  document.addEventListener(RESPONSE, event => {
    if (!enabled) return;
    let result; try { result = JSON.parse(event.detail); } catch { return; }
    if (result.id !== requestId || !root()) return;
    diagnostics = { bridge: result.source === 'podcast' ? 'dữ liệu trên trang' : 'đã kết nối', reactFibers: result.fiberCount ?? null, pairs: result.pairs?.length || 0, result: result.error ? 'lỗi khi đọc dữ liệu' : result.source === 'podcast' && result.pairs?.length ? 'đã tìm thấy các cặp podcast' : result.source === 'session' ? 'đã tìm thấy trong phiên học' : (result.pairs?.length || result.answer || Number.isInteger(result.index)) ? 'đã tìm thấy dữ liệu React' : 'không tìm thấy đáp án', error: result.error || undefined };
    // Pause observation while updating our own UI to avoid a render loop.
    observer?.disconnect();
    clean();
    const challenge = root();
    shortcutState = null;
    if (result.pairIndices?.length) {
      const grid = challenge.querySelector('[style*="--match-challenge-rows"]');
      const buttons = grid ? [...grid.querySelectorAll('button[data-test$="-challenge-tap-token"]')] : [];
      if (mode !== 'card') result.pairIndices.forEach(pair => pair.indices.forEach(index => {
        const button = buttons[index];
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
        const badge = document.createElement('span');
        badge.className = 'duo-hint-number'; badge.setAttribute('aria-hidden', 'true'); badge.textContent = String(pair.number);
        button.classList.add('duo-hint-anchor'); button.append(badge);
      }));
      card(result.pairs.map((pair, index) => `${result.pairIndices[index].number}. ${pair[0]}`).join('   •   '));
    } else if (result.pairs?.length) {
      const buttons = [...challenge.querySelectorAll('button[data-test*="challenge-tap-token"]')];
      if (mode !== 'card') result.pairs.forEach((pair, index) => {
        for (const word of pair) {
          const button = buttons.find(el => normalize(tokenText(el)) === normalize(word));
          if (!button || button.querySelector('.duo-hint-number')) continue;
          const badge = document.createElement('span'); badge.className = 'duo-hint-number'; badge.setAttribute('aria-hidden', 'true'); badge.textContent = String(index + 1); button.classList.add('duo-hint-anchor'); button.append(badge);
        }
      });
      card(result.pairs.map(pair => pair.join(' ↔ ')).join('   •   '));
    } else if (result.answer || Number.isInteger(result.index)) {
      const story = challenge.getAttribute('data-test') === 'stories-element';
      const choices = [...challenge.querySelectorAll(story ? '[data-test="stories-choice"]' : '[data-test="challenge-choice"]')];
      const indexedChoices = Array.isArray(result.indices) ? [...new Set(result.indices)]
        .filter(index => Number.isInteger(index) && index >= 0 && index < choices.length).map(index => choices[index]) : [];
      const correctChoice = indexedChoices[0] || resolveChoice(challenge, result.answer, result.index);
      const correctChoices = indexedChoices.length ? indexedChoices : correctChoice ? [correctChoice] : [];
      if (mode !== 'card') correctChoices.forEach(choice => choice.classList.add('duo-hint-correct'));
      if (choices.length && !correctChoices.length) {
          card('Chưa xác định được lựa chọn đúng.');
      } else {
        const sequence = numberTokens(challenge, result.answer, result.tokens, mode !== 'card');
        if (sequence?.length) shortcutState = { challenge, sequence };
        else if (correctChoice) shortcutState = { challenge, choice: correctChoice };
        const choiceLabel = correctChoices.length > 1 ? correctChoices.map(choice => story ? storyChoiceText(choice) : choiceText(choice)).join(' / ')
          : Number.isInteger(result.index) && story ? storyChoiceText(choices[result.index]) : '';
        card(result.answer || choiceLabel || `Chọn đáp án ${result.index + 1}`);
      }
    } else { card('Chưa tìm thấy dữ liệu đáp án cho câu này.'); }
    observer?.observe(document.documentElement, observeOptions);
  });

  // ====== Cài đặt (thay chrome.storage bằng localStorage) ======
  const SKEY = 'duolingo-hint-settings-v1';
  const settings = { hintEnabled: false, hintMode: 'full', autoContinue: true, ctrlMode: 'all' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch {}
  delete settings.autoCheck;
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} }
  ctrlMode = settings.ctrlMode === 'one' ? 'one' : 'all';
  mode = ['compact', 'card', 'full'].includes(settings.hintMode) ? settings.hintMode : 'full';
  enabled = Boolean(settings.hintEnabled);
  if (enabled) start();

  function setSetting(key, value) {
    settings[key] = value;
    if (key === 'autoContinue') delete settings.autoCheck;
    saveSettings();
    if (key === 'ctrlMode') { ctrlMode = value === 'one' ? 'one' : 'all'; if (fillRun) fillRun.cancelled = true; }
    else if (key === 'autoContinue') { autoContinue = !!value; lastAutoContinued = null; if (autoContinue) startAutoContinue(); else { continueObserver?.disconnect(); continueObserver = null; } }
    else if (key === 'hintMode') { mode = ['compact', 'card', 'full'].includes(value) ? value : 'full'; if (enabled) { clean(); schedule(); } }
    else if (key === 'hintEnabled') { enabled = !!value; enabled ? start() : stop(); }
  }
  function statusText() {
    const q = root()?.getAttribute('data-test') || 'chưa tìm thấy câu hỏi';
    return `Userscript ${VERSION}; Hint ${enabled ? 'bật' : 'tắt'}; câu hỏi: ${q}; kết nối: ${diagnostics.bridge}; React: ${diagnostics.reactFibers ?? 'chưa có'}; cặp: ${diagnostics.pairs}; kết quả: ${diagnostics.result}${diagnostics.error ? '; lỗi: ' + diagnostics.error : ''}.`;
  }

  // ====== Giao diện thay cho popup ======
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  };
  function switchRow(title, sub, key) {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.checked = Boolean(settings[key]);
    input.addEventListener('change', () => { setSetting(key, input.checked); refresh(); });
    const subEl = h('small', {}, sub);
    return { row: h('label', { class: 'duo-hint-row' }, h('span', {}, h('strong', {}, title), subEl), input, h('i', { class: 'duo-hint-switch' })), input, subEl };
  }
  function radioGroup(legend, name, key, options) {
    const set = h('fieldset', { class: 'duo-hint-group' }, h('legend', {}, legend));
    const inputs = options.map(([value, label]) => {
      const input = h('input', { type: 'radio', name: 'duo-hint-' + name, value });
      input.checked = settings[key] === value || (!options.some(o => o[0] === settings[key]) && value === options[options.length - 1][0] && key === 'hintMode') || (key === 'ctrlMode' && settings[key] !== 'one' && value === 'all');
      input.addEventListener('change', () => { if (input.checked) setSetting(key, value); });
      set.append(h('label', {}, input, ' ' + label));
      return input;
    });
    return set;
  }
  let panel, fab, ctrlButton, statusEl, hintSwitch, statusTimer;
  function placeFabInNavigation() {
    if (!fab) return;
    const visible = element => element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    const mobile = window.matchMedia('(max-width: 600px)').matches;
    const lingotStat = document.querySelector('[data-test="lingot-stat"]');
    const lingotButton = lingotStat?.closest('[role="button"]');

    if (!mobile) {
      document.querySelectorAll('[data-duo-hint-original-display]').forEach(element => {
        element.style.display = element.dataset.duoHintOriginalDisplay;
        delete element.dataset.duoHintOriginalDisplay;
      });
      fab.classList.remove('duo-hint-mobile-nav');
      if (fab.parentElement !== document.body) document.body.append(fab);
      fab.style.left = '';
      fab.style.top = '';
      fab.style.right = '';
      fab.style.bottom = '';
      fab.style.transform = '';
    } else if (lingotButton && (visible(lingotButton) || Object.hasOwn(lingotButton.dataset, 'duoHintOriginalDisplay'))) {
      if (!Object.hasOwn(lingotButton.dataset, 'duoHintOriginalDisplay')) {
        lingotButton.dataset.duoHintOriginalDisplay = lingotButton.style.display;
      }
      lingotButton.style.display = 'none';
      fab.classList.add('duo-hint-mobile-nav');
      fab.hidden = false;
      fab.style.left = '';
      fab.style.top = '';
      fab.style.right = '';
      fab.style.bottom = '';
      fab.style.transform = '';
      if (fab.parentElement !== lingotButton.parentElement || fab.previousElementSibling !== lingotButton) {
        lingotButton.insertAdjacentElement('afterend', fab);
      }
      return;
    }

    fab.classList.remove('duo-hint-mobile-nav');
    const moreNav = document.querySelector('[data-test="more-nav"]');
    const shopLink = document.querySelector('a[data-test="shop-nav"]');
    const shopHost = shopLink?.closest('.SLpL3') || shopLink?.parentElement || shopLink;
    const host = visible(moreNav) ? moreNav : visible(shopHost) ? shopHost : null;
    if (!host) {
      fab.hidden = true;
      return;
    }
    if (fab.parentElement !== document.body) document.body.append(fab);
    fab.hidden = false;
    const target = host.getBoundingClientRect();
    const size = fab.getBoundingClientRect().width || 38;
    const margin = 8;
    let left = target.left + (target.width - size) / 2;
    let top = target.bottom + 6;
    if (top + size > window.innerHeight - margin) top = target.top - size - 6;
    left = Math.max(margin, Math.min(window.innerWidth - size - margin, left));
    top = Math.max(margin, Math.min(window.innerHeight - size - margin, top));
    fab.style.left = `${left}px`;
    fab.style.top = `${top}px`;
  }
  const CTRL_POSITION_KEY = 'duolingo-hint-ctrl-position-v1';
  let ctrlPosition = null, ctrlDrag = null, suppressCtrlClick = false, suppressCtrlClickTimer;
  try {
    const stored = JSON.parse(localStorage.getItem(CTRL_POSITION_KEY) || 'null');
    if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) ctrlPosition = stored;
  } catch {}
  function clampCtrlPosition(left, top) {
    if (!ctrlButton) return;
    const rect = ctrlButton.getBoundingClientRect();
    const margin = 6;
    const x = Math.max(margin, Math.min(window.innerWidth - rect.width - margin, left));
    const y = Math.max(margin, Math.min(window.innerHeight - rect.height - margin, top));
    ctrlButton.style.left = `${x}px`;
    ctrlButton.style.top = `${y}px`;
    ctrlButton.style.right = 'auto';
    ctrlButton.style.bottom = 'auto';
    ctrlButton.style.transform = 'none';
    return { left: x, top: y, width: rect.width, height: rect.height };
  }
  function applyCtrlPosition() {
    if (!ctrlButton || !ctrlPosition) return;
    const rect = ctrlButton.getBoundingClientRect();
    clampCtrlPosition(ctrlPosition.x * window.innerWidth - rect.width / 2,
      ctrlPosition.y * window.innerHeight - rect.height / 2);
  }
  function saveCtrlPosition() {
    const rect = ctrlButton?.getBoundingClientRect();
    if (!rect || !window.innerWidth || !window.innerHeight) return;
    ctrlPosition = { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight };
    try { localStorage.setItem(CTRL_POSITION_KEY, JSON.stringify(ctrlPosition)); } catch {}
  }
  function finishCtrlDrag() {
    if (!ctrlDrag) return;
    if (ctrlDrag.moved) {
      saveCtrlPosition();
      suppressCtrlClick = true;
      clearTimeout(suppressCtrlClickTimer);
      suppressCtrlClickTimer = setTimeout(() => { suppressCtrlClick = false; }, 500);
    }
    ctrlDrag = null;
  }
  function installCtrlDrag() {
    ctrlButton.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = ctrlButton.getBoundingClientRect();
      ctrlDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
      try { ctrlButton.setPointerCapture(event.pointerId); } catch {}
    });
    ctrlButton.addEventListener('pointermove', event => {
      if (!ctrlDrag || event.pointerId !== ctrlDrag.pointerId) return;
      const dx = event.clientX - ctrlDrag.startX, dy = event.clientY - ctrlDrag.startY;
      if (!ctrlDrag.moved && Math.hypot(dx, dy) < 5) return;
      ctrlDrag.moved = true;
      event.preventDefault();
      clampCtrlPosition(ctrlDrag.left + dx, ctrlDrag.top + dy);
    }, { passive: false });
    ctrlButton.addEventListener('pointerup', finishCtrlDrag);
    ctrlButton.addEventListener('pointercancel', finishCtrlDrag);
    ctrlButton.addEventListener('lostpointercapture', finishCtrlDrag);
  }
  function refresh() {
    if (hintSwitch) { hintSwitch.input.checked = enabled; hintSwitch.subEl.textContent = enabled ? 'Đang bật' : 'Đang tắt'; }
    if (fab) fab.classList.toggle('on', enabled);
    if (ctrlButton) { ctrlButton.hidden = !enabled; ctrlButton.setAttribute('aria-disabled', String(!enabled)); ctrlButton.title = enabled ? 'K\u00e9o \u0111\u1ec3 di chuy\u1ec3n; nh\u1ea5n \u0111\u1ec3 ch\u1ecdn g\u1ee3i \u00fd' : 'K\u00e9o \u0111\u1ec3 di chuy\u1ec3n; b\u1eadt Hint \u0111\u1ec3 d\u00f9ng'; }
  }
  function buildUI() {
    if (document.getElementById('duo-hint-fab') || !document.body) return;
    fab = h('button', { id: 'duo-hint-fab', type: 'button', title: 'Duolingo Hint (Alt+H bật/tắt)' }, h('img', { src: 'https://nguyenphanvn95.github.io/duolingo/icon-panel.png?v=1.2.27', alt: 'Duolingo Hint', onerror: event => { const image = event.currentTarget; if (!image.dataset.fallbackApplied) { image.dataset.fallbackApplied = 'true'; image.src = ICON_HINT_FALLBACK; } } }));
    ctrlButton = h('button', { id: 'duo-hint-ctrl', type: 'button', title: 'Use the current answer hint', onclick: event => {
      if (suppressCtrlClick) { event.preventDefault(); event.stopPropagation(); suppressCtrlClick = false; clearTimeout(suppressCtrlClickTimer); return; }
      if (enabled) selectNextToken();
    } }, h('img', { src: 'https://nguyenphanvn95.github.io/duolingo/icon-ctrl.png?v=1.2.27', alt: 'Ctrl', onerror: event => { const image = event.currentTarget; if (!image.dataset.fallbackApplied) { image.dataset.fallbackApplied = 'true'; image.src = ICON_CTRL_FALLBACK; } } }));
    installCtrlDrag();
    hintSwitch = switchRow('Hiện Hint', enabled ? 'Đang bật' : 'Đang tắt', 'hintEnabled');
    const autoContinueSwitch = switchRow('T\u1ef1 \u0111\u1ed9ng b\u1ea5m Ti\u1ebfp t\u1ee5c', 'T\u1ef1 b\u1ea5m khi n\u00fat Ti\u1ebfp t\u1ee5c ho\u1ea1t \u0111\u1ed9ng', 'autoContinue');
    statusEl = h('p', { class: 'duo-hint-status' });
    const copy = h('button', { type: 'button', class: 'duo-hint-copy', onclick: async () => {
      try { await navigator.clipboard.writeText(statusText()); copy.textContent = 'Đã sao chép'; } catch { copy.textContent = 'Không sao chép được'; }
      setTimeout(() => { copy.textContent = 'Sao chép trạng thái'; }, 1500);
    } }, 'Sao chép trạng thái');
    const closePanel = h('button', { type: 'button', class: 'duo-hint-close', title: 'Đóng', 'aria-label': 'Đóng cài đặt', onclick: () => {
      panel.hidden = true;
      clearInterval(statusTimer);
      statusTimer = null;
    } }, '×');
    panel = h('div', { id: 'duo-hint-panel', hidden: '' },
      h('h3', {}, 'Duolingo Hint ', h('small', {}, VERSION)), closePanel,
      hintSwitch.row, autoContinueSwitch.row,
      radioGroup('Cách hiện Hint', 'mode', 'hintMode', [['compact', 'Chỉ hiện Hint rút gọn'], ['card', 'Chỉ hiện khối đáp án gợi ý'], ['full', 'Hiện đầy đủ Hint']]),
      radioGroup('Phím tắt Ctrl cho bài xếp từ', 'ctrl', 'ctrlMode', [['all', 'Tự động điền hết'], ['one', 'Mỗi lần bấm chọn một từ']]),
      h('p', { class: 'duo-hint-note' }, 'Hint mặc định tắt. Trạng thái được lưu cho lần sau.'),
      statusEl, copy);
    fab.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      clearInterval(statusTimer);
      statusTimer = null;
      if (!panel.hidden) refresh();
    });
    document.body.append(fab, panel, ctrlButton);
    placeFabInNavigation();
    applyCtrlPosition();
    refresh();
  }
  window.addEventListener('resize', () => { applyCtrlPosition(); placeFabInNavigation(); }, { passive: true });
  window.addEventListener('scroll', placeFabInNavigation, { capture: true, passive: true });
  document.addEventListener('keydown', event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyH' && !editableTarget(event.target)) {
      event.preventDefault(); setSetting('hintEnabled', !enabled); refresh();
    }
  }, true);
  if (document.body) buildUI(); else document.addEventListener('DOMContentLoaded', buildUI, { once: true });
  if (autoContinue) {
    if (document.documentElement) startAutoContinue();
    else document.addEventListener('DOMContentLoaded', startAutoContinue, { once: true });
  }
  // SPA có thể thay body: kiểm tra lại định kỳ
  setInterval(() => {
    if (!document.body) return;
    if (!document.getElementById('duo-hint-fab')) buildUI();
    else placeFabInNavigation();
  }, 1500);
})();
