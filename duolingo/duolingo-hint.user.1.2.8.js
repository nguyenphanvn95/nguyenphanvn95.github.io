// ==UserScript==
// @name         Duolingo Hint
// @namespace    https://www.duolingo.com/
// @version      1.2.8
// @description  Duolingo answer hints and shortcuts.
// @icon         https://d35aaqx5ub95lt.cloudfront.net/images/700755cf688b76a1eba261e682def131.svg
// @match        https://www.duolingo.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* Runs in page context. The H button opens settings, the floating Ctrl button
   uses the current answer hint, and Alt+H toggles Hint. */

(() => {
  const norm = s => String(s || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  let sessionChallenges = [];
  let podcastResponses = [];
  let storyElements = [];
  function storeSession(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.challenges)) return;
    sessionChallenges = [data.challenges, data.adaptiveChallenges, data.mistakesReplacementChallenges, data.adaptiveInterleavedChallenges?.challenges]
      .filter(Array.isArray).flat().filter(item => item && typeof item === 'object');
    document.dispatchEvent(new CustomEvent('duo-hint-session-v1'));
  }
  function isSession(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin && /\/sessions(?:\/[^/?]+)?\/?$/.test(u.pathname); }
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
    const promise = originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    const method = args[1]?.method || args[0]?.method || 'GET';
    if (isSession(url)) promise.then(response => {
      if (response.ok) response.clone().json().then(storeSession).catch(() => {});
    }).catch(() => {});
    else if (isPodcastData(url)) promise.then(response => {
      if (response.ok && /json/i.test(response.headers.get('content-type') || '')) response.clone().json().then(storePodcast).catch(() => {});
    }).catch(() => {});
    else if (isStoryData(url, method)) promise.then(response => {
      if (response.ok) response.clone().json().then(storeStory).catch(() => {});
    }).catch(() => {});
    return promise;
  };
  const originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
  const observedRequests = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isSession(url)) observedRequests.set(this, 'session');
    else if (isPodcastData(url)) observedRequests.set(this, 'podcast');
    else if (isStoryData(url, method)) observedRequests.set(this, 'story');
    else observedRequests.delete(this);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const kind = observedRequests.get(this);
    if (kind) this.addEventListener('load', function () {
      if (this.status < 200 || this.status >= 300) return;
      try {
        const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
        if (kind === 'session') storeSession(data); else if (kind === 'story') storeStory(data); else storePodcast(data);
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
      const isListen = /challenge-listenTap(?:\s|$)/i.test(kind);
      const isAssist = /challenge-assist(?:\s|$)/i.test(kind);
      const expectedType = /challenge-translate(?:\s|$)/i.test(kind) ? 'translate'
        : isListen ? 'listenTap'
        : /challenge-assist(?:\s|$)/i.test(kind) ? 'assist'
        : /challenge-select(?:\s|$)/i.test(kind) ? 'select'
        : /challenge-sameDifferent(?:\s|$)/i.test(kind) ? 'sameDifferent'
        : /challenge-gapFill(?:\s|$)/i.test(kind) ? 'gapFill'
        : /challenge-tapComplete(?:\s|$)/i.test(kind) ? 'tapComplete' : '';
      if (expectedType && c.type && String(c.type).toLowerCase() !== expectedType.toLowerCase()) continue;
      if (isAssist && c.type && !/^assist$/i.test(c.type)) continue;
      if (isListen && !/^listenTap$/i.test(c.type || '')) continue;
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
      if (singleCorrectIndex >= 0 && Array.isArray(c.choices) && singleCorrectIndex < c.choices.length &&
          /gapFill|tapComplete|select|sameDifferent|assist/i.test(req.kind || '')) {
        const choice = c.choices[singleCorrectIndex]; correctChoice = typeof choice === 'string' ? choice : choice?.text || '';
      }
      if (!correctChoice && c.currentScope && singleCorrectIndex >= 0 && singleCorrectIndex < (req.choices || []).length) correctChoice = req.choices[singleCorrectIndex];
      if (correctChoice) answer = correctChoice;
      if (!answer && c.type === 'listenTap') answer = c.prompt || '';
      if (!answer && tokens.length) answer = c.challengeResponseTrackingProperties?.best_solution || '';
      if (!answer && tokens.length) answer = tokens.join(' ');
      if (!answer) continue;
      candidates.push({ score, answer, tokens, correctChoice, index: singleCorrectIndex >= 0 ? singleCorrectIndex : undefined });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length || (candidates[1]?.score === candidates[0].score && (candidates[1].answer !== candidates[0].answer || candidates[1].tokens.join('\u0000') !== candidates[0].tokens.join('\u0000')))) return null;
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
    if (wanted.length < 4 || (req.choices || []).length !== 2) return {};
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
          if (Number.isInteger(obj[key]) && obj[key] >= 0 && obj[key] < 2) found.add(obj[key]);
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
    if (found.size !== 1) return { fiberCount: seenFibers.size };
    const index = [...found][0];
    return { index, answer: req.booleanLabels ? (index === 0 ? 'Đúng' : 'Sai') : `Lựa chọn ${index + 1}`, fiberCount: seenFibers.size };
  }
  document.addEventListener('duo-hint-request-v1', event => {
    let req; try { req = JSON.parse(event.detail); } catch { return; }
    const group = req.kind === 'podcast-judge' ? [...document.querySelectorAll('[role="radiogroup"]')].find(el => el.querySelector('[data-test="challenge-choice"]')) : null;
    const challenge = req.kind === 'podcast-judge' ? group?.parentElement?.parentElement : req.kind === 'stories-element' ? document.querySelectorAll('[data-test="stories-element"]')[req.storyIndex] : document.querySelector('[data-test^="challenge challenge-"]');
    if (!challenge) return;
    try {
    if (req.kind === 'podcast-judge') {
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
      document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, answer: sessionResult.answer, tokens: sessionResult.tokens, index: sessionResult.index, source: 'session' }) }));
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
      document.dispatchEvent(new CustomEvent('duo-hint-response-v1', { detail: JSON.stringify({ id: req.id, answer: reactResult.answer, tokens: reactResult.tokens, index: reactResult.index, source: 'react', fiberCount: visitedFibers.size }) }));
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

#duo-hint-ctrl { position: fixed; right: 12px; top: 50%; transform: translateY(-50%); z-index: 2147483001; min-width: 54px; padding: 11px 9px; border: 2px solid #fff; border-radius: 999px; color: #fff; background: #58a700; font: 800 13px/1 system-ui, sans-serif; cursor: pointer; box-shadow: 0 2px 8px #0004; }
#duo-hint-ctrl:hover { filter: brightness(1.08); }
#duo-hint-ctrl:disabled { opacity: .45; cursor: not-allowed; }
#duo-hint-fab { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; width: 34px; height: 34px; border: 2px solid #fff; border-radius: 50%; color: #fff; background: #9aa5ad; font: 800 15px/1 system-ui, sans-serif; cursor: pointer; opacity: .55; box-shadow: 0 2px 8px #0004; }
#duo-hint-fab:hover, #duo-hint-fab.on { opacity: 1; }
#duo-hint-fab.on { background: #58a700; }
#duo-hint-panel { position: fixed; left: 12px; bottom: 56px; z-index: 2147483000; width: 290px; max-height: 80vh; overflow: auto; box-sizing: border-box; padding: 14px; border: 2px solid #e5e5e5; border-radius: 16px; color: #3c3c3c; background: #fff; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 6px 24px #0003; }
#duo-hint-panel[hidden] { display: none; }
#duo-hint-panel h3 { margin: 0 0 10px; font-size: 17px; } #duo-hint-panel h3 small { color: #999; font-weight: 600; font-size: 12px; }
#duo-hint-panel .duo-hint-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; cursor: pointer; }
#duo-hint-panel .duo-hint-row small { display: block; color: #777; }
#duo-hint-panel .duo-hint-row input { position: absolute; opacity: 0; pointer-events: none; }
#duo-hint-panel .duo-hint-switch { position: relative; flex: none; width: 40px; height: 22px; border-radius: 11px; background: #ccc; transition: background .15s; }
#duo-hint-panel .duo-hint-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
#duo-hint-panel input:checked + .duo-hint-switch { background: #58cc02; } #duo-hint-panel input:checked + .duo-hint-switch::after { transform: translateX(18px); }
#duo-hint-panel .duo-hint-group { margin: 10px 0; padding: 6px 10px; border: 1px solid #e5e5e5; border-radius: 10px; } #duo-hint-panel .duo-hint-group legend { padding: 0 4px; font-weight: 700; font-size: 12px; color: #777; }
#duo-hint-panel .duo-hint-group label { display: block; margin: 4px 0; cursor: pointer; }
#duo-hint-panel .duo-hint-note, #duo-hint-panel .duo-hint-status { margin: 8px 0; font-size: 12px; color: #777; word-break: break-word; }
#duo-hint-panel .duo-hint-copy { width: 100%; padding: 7px; border: 2px solid #e5e5e5; border-radius: 10px; background: #fff; font: 700 12px system-ui, sans-serif; cursor: pointer; }
`;
  const add = () => { if (document.getElementById('duo-hint-style')) return; const s = document.createElement('style'); s.id = 'duo-hint-style'; s.textContent = css; (document.head || document.documentElement).append(s); };
  add();
  document.addEventListener('DOMContentLoaded', add, { once: true });
})();

(() => {
  const VERSION = '1.2.8';
  const REQUEST = 'duo-hint-request-v1', RESPONSE = 'duo-hint-response-v1', CARD = 'duolingo-hint-card';
  let enabled = false, autoCheck = false, mode = 'full', ctrlMode = 'all', observer, pending = false, timer, requestId = 0;
  let diagnostics = { bridge: 'chưa kiểm tra', reactFibers: null, pairs: 0, result: 'chưa kiểm tra' };
  const savedSequences = new WeakMap();
  const podcastPairs = new WeakMap();
  const heldKeys = new Set();
  const observeOptions = { childList: true, subtree: true, attributes: true, attributeFilter: ['data-test', 'aria-disabled', 'aria-checked', 'aria-pressed', 'disabled', 'aria-hidden', 'hidden', 'class'] };
  let ctrlArmed = false, shortcutState = null, clickLocked = false, fillRun = null, autoState = null, autoTimer = null, lastSubmission = null;
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
        if (run.single) return;
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
  function matchesHint(state) {
    const challenge = state.challenge;
    const bank = challenge.querySelector('[data-test="word-bank"]');
    if (bank && state.sequence?.length) {
      const selected = [...challenge.querySelectorAll('button[data-test*="challenge-tap-token"]')]
        .filter(button => !bank.contains(button) && visibleToken(button, challenge))
        .map(button => normalize(tokenText(button)));
      return selected.length === state.sequence.length && selected.every((word, index) => word === state.sequence[index]);
    }
    const inputs = [...challenge.querySelectorAll('textarea, input:not([type="hidden"])')].filter(input => visibleToken(input, challenge));
    if (inputs.length === 1 && state.answer) return normalize(inputs[0].value) === normalize(state.answer) && !!normalize(state.answer);
    const choices = [...challenge.querySelectorAll('[data-test="challenge-choice"], [data-test="stories-choice"]')];
    const selected = choices.filter(choice => choice.getAttribute('aria-checked') === 'true' || choice.getAttribute('aria-pressed') === 'true' || choice.querySelector('input:checked'));
    if (selected.length !== 1) return false;
    const index = choices.indexOf(selected[0]);
    if (Number.isInteger(state.index)) return index === state.index;
    const text = selected[0].getAttribute('data-test') === 'stories-choice' ? storyChoiceText(selected[0]) : choiceText(selected[0]);
    return !!state.answer && normalize(text) === normalize(state.answer);
  }
  function checkButton() {
    const button = document.querySelector('[data-test="player-next"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || !button.getClientRects().length) return null;
    const text = (button.innerText || button.textContent || '').trim();
    return /^(kiểm tra|check)(?:\s|\(|$)/i.test(text) ? button : null;
  }
  function pastCheckStage() {
    const button = document.querySelector('[data-test="player-next"]');
    if (!button) return true;
    const text = (button.innerText || button.textContent || '').trim();
    return !/^(kiểm tra|check)(?:\s|\(|$)/i.test(text);
  }
  function queueAutoCheck() {
    if (!enabled || !autoCheck || autoTimer) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (!enabled || !autoCheck || !autoState || root() !== autoState.challenge) return;
      const button = checkButton();
      if (!button || !matchesHint(autoState)) return;
      const signature = [autoState.answer || '', ...(autoState.sequence || []), autoState.index ?? ''].join('\u0000');
      if (lastSubmission?.challenge === autoState.challenge && lastSubmission.signature === signature) return;
      lastSubmission = { challenge: autoState.challenge, signature };
      button.click();
    }, 80);
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
        document.dispatchEvent(new CustomEvent(REQUEST, { detail: JSON.stringify({ id, words, choices, hintWords, screen, prompt, storyPrompt, booleanLabels, kind: podcastJudge ? 'podcast-judge' : challenge.getAttribute('data-test'), storyIndex }) }));
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
        if (lastSubmission && (root() !== lastSubmission.challenge || pastCheckStage())) lastSubmission = null;
        queueAutoCheck();
        schedule();
      });
      observer.observe(document.documentElement, observeOptions);
    }
    schedule();
  }
  document.addEventListener('duo-hint-session-v1', () => { if (enabled) schedule(); });
  function stop() { if (fillRun) fillRun.cancelled = true; observer?.disconnect(); observer = null; clearTimeout(timer); clearTimeout(autoTimer); autoTimer = null; pending = false; requestId++; shortcutState = null; autoState = null; lastSubmission = null; clean(); }
  document.addEventListener('input', () => queueAutoCheck(), true);
  document.addEventListener('change', () => queueAutoCheck(), true);
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
    if (result.source === 'podcast' && result.pairIndices?.length) {
      autoState = null;
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
      autoState = null;
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
      const correctChoice = resolveChoice(challenge, result.answer, result.index);
      if (mode !== 'card' && correctChoice) correctChoice.classList.add('duo-hint-correct');
      if (choices.length && !correctChoice) {
        autoState = null;
        card('Chưa xác định được lựa chọn đúng.');
      } else {
        const sequence = numberTokens(challenge, result.answer, result.tokens, mode !== 'card');
        if (sequence?.length) shortcutState = { challenge, sequence };
        else if (correctChoice) shortcutState = { challenge, choice: correctChoice };
        autoState = { challenge, sequence: sequence || [], answer: result.answer || '', index: result.index };
        const choiceText = Number.isInteger(result.index) && story ? storyChoiceText(choices[result.index]) : '';
        card(result.answer || choiceText || `Chọn đáp án ${result.index + 1}`);
      }
    } else { autoState = null; card('Chưa tìm thấy dữ liệu đáp án cho câu này.'); }
    observer?.observe(document.documentElement, observeOptions);
    queueAutoCheck();
  });

  // ====== Cài đặt (thay chrome.storage bằng localStorage) ======
  const SKEY = 'duolingo-hint-settings-v1';
  const settings = { hintEnabled: false, hintMode: 'full', autoCheck: false, ctrlMode: 'all' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch {}
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} }
  ctrlMode = settings.ctrlMode === 'one' ? 'one' : 'all';
  mode = ['compact', 'card', 'full'].includes(settings.hintMode) ? settings.hintMode : 'full';
  autoCheck = Boolean(settings.autoCheck);
  enabled = Boolean(settings.hintEnabled);
  if (enabled) start();

  function setSetting(key, value) {
    settings[key] = value; saveSettings();
    if (key === 'ctrlMode') { ctrlMode = value === 'one' ? 'one' : 'all'; if (fillRun) fillRun.cancelled = true; }
    else if (key === 'autoCheck') { autoCheck = !!value; if (autoCheck) queueAutoCheck(); else { clearTimeout(autoTimer); autoTimer = null; } }
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
  function refresh() {
    if (hintSwitch) { hintSwitch.input.checked = enabled; hintSwitch.subEl.textContent = enabled ? 'Đang bật' : 'Đang tắt'; }
    if (statusEl) statusEl.textContent = statusText();
    if (fab) fab.classList.toggle('on', enabled);
    if (ctrlButton) { ctrlButton.disabled = !enabled; ctrlButton.title = enabled ? 'Ch\u1ecdn g\u1ee3i y\u0301 b\u0103\u0300ng ph\u00edm Ctrl' : 'B\u1eadt Hint \u0111\u1ec3 d\u00f9ng'; }
  }
  function buildUI() {
    if (document.getElementById('duo-hint-fab') || !document.body) return;
    fab = h('button', { id: 'duo-hint-fab', type: 'button', title: 'Duolingo Hint (Alt+H bật/tắt)' }, 'H');
    ctrlButton = h('button', { id: 'duo-hint-ctrl', type: 'button', title: 'Use the current answer hint', onclick: () => selectNextToken() }, 'Ctrl');
    hintSwitch = switchRow('Hiện Hint', enabled ? 'Đang bật' : 'Đang tắt', 'hintEnabled');
    const auto = switchRow('Tự động kiểm tra', 'Áp dụng khi đáp án khớp Hint', 'autoCheck');
    statusEl = h('p', { class: 'duo-hint-status' });
    const copy = h('button', { type: 'button', class: 'duo-hint-copy', onclick: async () => {
      try { await navigator.clipboard.writeText(statusText()); copy.textContent = 'Đã sao chép'; } catch { copy.textContent = 'Không sao chép được'; }
      setTimeout(() => { copy.textContent = 'Sao chép trạng thái'; }, 1500);
    } }, 'Sao chép trạng thái');
    panel = h('div', { id: 'duo-hint-panel', hidden: '' },
      h('h3', {}, 'Duolingo Hint ', h('small', {}, VERSION)),
      hintSwitch.row, auto.row,
      radioGroup('Cách hiện Hint', 'mode', 'hintMode', [['compact', 'Chỉ hiện Hint rút gọn'], ['card', 'Chỉ hiện khối đáp án gợi ý'], ['full', 'Hiện đầy đủ Hint']]),
      radioGroup('Phím tắt Ctrl cho bài xếp từ', 'ctrl', 'ctrlMode', [['all', 'Tự động điền hết'], ['one', 'Mỗi lần bấm chọn một từ']]),
      h('p', { class: 'duo-hint-note' }, 'Hint mặc định tắt. Trạng thái được lưu cho lần sau.'),
      statusEl, copy);
    fab.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      clearInterval(statusTimer);
      if (!panel.hidden) { refresh(); statusTimer = setInterval(refresh, 1000); }
    });
    document.body.append(fab, panel, ctrlButton);
    refresh();
  }
  document.addEventListener('keydown', event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyH' && !editableTarget(event.target)) {
      event.preventDefault(); setSetting('hintEnabled', !enabled); refresh();
    }
  }, true);
  if (document.body) buildUI(); else document.addEventListener('DOMContentLoaded', buildUI, { once: true });
  // SPA có thể thay body: kiểm tra lại định kỳ
  setInterval(() => { if (document.body && !document.getElementById('duo-hint-fab')) buildUI(); }, 3000);
})();
