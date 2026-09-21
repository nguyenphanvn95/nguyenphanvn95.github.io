// read-aloud.js — Edge Read Aloud TTS for the EPUB reader.
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const app = () => window.ReaderApp || {};
  const tr = (key, params, fallback) => {
    const value = window.I18n?.t?.(key, params);
    return value && value !== key ? value : (fallback || key);
  };

  const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  const EDGE_HOST = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
  const WS_URL = `wss://${EDGE_HOST}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
  const EDGE_VERSION = "1-143.0.3650.75";
  const OUTPUT_FORMAT = "webm-24khz-16bit-mono-opus";
  const AUDIO_TYPE = 'audio/webm; codecs="opus"';
  const EPOCH_OFFSET_SECONDS = 11644473600;

  const DEFAULT_VOICE = "vi-VN-HoaiMyNeural";
  const EDGE_VOICE_PRESETS = [
    { name: "vi-VN-HoaiMyNeural", lang: "vi-VN", label: "Hòa My" },
    { name: "vi-VN-NamMinhNeural", lang: "vi-VN", label: "Nam Minh" },
  ];
  const MAX_TEXT_BYTES = 3800;
  const MAX_TTS_ITEM_BYTES = 900;
  const SHORT_SENTENCE_WORDS = 12;
  const MAX_SHORT_SENTENCES_PER_ITEM = 3;
  const PREFETCH_AHEAD = 4;
  const PREFETCH_CONCURRENCY = 3;
  const SYNTH_RETRIES = 3;

  const els = {
    rail: $("#rd-rail-readaloud"),
    start: $("#tts-start"),
    pause: $("#tts-pause"),
    resume: $("#tts-resume"),
    stop: $("#tts-stop"),
    status: $("#tts-status"),
    voice: $("#tts-voice"),
    rate: $("#tts-rate"),
    rateValue: $("#tts-rate-value"),
    volume: $("#tts-volume"),
  };

  const state = {
    queue: [],
    index: 0,
    currentEl: null,
    audio: new Audio(),
    aborter: null,
    speaking: false,
    paused: false,
    stopping: false,
    runId: 0,
    voices: [],
    audioUrl: "",
    prefetch: new Map(),
    audioPrimed: false,
    wordHighlight: null,
    currentBoundaries: [],
    currentDuration: 0,
  };

  state.audio.preload = "auto";
  state.audio.playsInline = true;
  state.audio.addEventListener("timeupdate", () => {
    const currentTime = Number.isFinite(state.audio.currentTime) ? state.audio.currentTime : 0;
    const nativeDuration = Number.isFinite(state.audio.duration) ? state.audio.duration : 0;
    const duration = nativeDuration || state.currentDuration || estimateBoundaryDuration(state.currentBoundaries);
    const wordIndex = findBoundaryIndex(state.currentBoundaries, currentTime);
    document.dispatchEvent(new CustomEvent("readaloud:progress", {
      detail: {
        currentTime,
        duration,
        index: state.index,
        total: state.queue.length,
        currentText: state.queue[state.index]?.text || "",
        wordIndex,
        wordTotal: state.currentBoundaries.length,
      },
    }));
  });

  const BLOCK_SELECTOR = [
    "p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "td", "th", "div",
  ].join(",");

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function emitState() {
    document.dispatchEvent(new CustomEvent("readaloud:state", {
      detail: {
        speaking: state.speaking,
        paused: state.paused,
        index: state.index,
        total: state.queue.length,
      },
    }));
  }

  function hasBookOpen() {
    return !!(app().getBookInfo && app().getBookInfo());
  }

  function getDoc() {
    return app().frameDoc ? app().frameDoc() : null;
  }

  function getWrap() {
    const d = getDoc();
    return d ? d.getElementById("page-wrap") : null;
  }

  function requestId() {
    const data = new Uint8Array(16);
    crypto.getRandomValues(data);
    data[6] = (data[6] & 0x0f) | 0x40;
    data[8] = (data[8] & 0x3f) | 0x80;
    return Array.from(data).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function timestamp() {
    return new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
  }

  async function secMsGec() {
    let ticks = Date.now() / 1000 + EPOCH_OFFSET_SECONDS;
    ticks -= ticks % 300;
    ticks *= 10000000;
    const input = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function escapeXml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b\u200c\u200d\ufeff]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function utf8Length(text) {
    return new TextEncoder().encode(text).length;
  }

  function splitTextByBytes(text, maxBytes = MAX_TEXT_BYTES) {
    const clean = cleanText(text);
    if (!clean) return [];
    if (utf8Length(clean) <= maxBytes) return [clean];

    const parts = [];
    const sentences = clean.match(/[^.!?。！？…]+[.!?。！？…]+["')\]]*|[^.!?。！？…]+$/g) || [clean];
    let current = "";

    const pushCurrent = () => {
      const value = cleanText(current);
      if (value) parts.push(value);
      current = "";
    };

    const pushOversized = (value) => {
      let rest = cleanText(value);
      while (utf8Length(rest) > maxBytes) {
        let cut = Math.floor(rest.length * (maxBytes / utf8Length(rest)));
        cut = Math.max(1, Math.min(cut, rest.length - 1));
        while (cut > 1 && utf8Length(rest.slice(0, cut)) > maxBytes) cut -= 1;
        const windowText = rest.slice(0, cut);
        const softCut = Math.max(
          windowText.lastIndexOf(" "),
          windowText.lastIndexOf(","),
          windowText.lastIndexOf(";"),
          windowText.lastIndexOf(":")
        );
        if (softCut > 80) cut = softCut;
        const chunk = cleanText(rest.slice(0, cut));
        if (chunk) parts.push(chunk);
        rest = cleanText(rest.slice(cut));
      }
      if (rest) parts.push(rest);
    };

    for (const sentence of sentences) {
      const next = cleanText(current ? `${current} ${sentence}` : sentence);
      if (utf8Length(next) <= maxBytes) {
        current = next;
        continue;
      }
      pushCurrent();
      if (utf8Length(sentence) > maxBytes) pushOversized(sentence);
      else current = sentence;
    }
    pushCurrent();
    return parts;
  }

  function wordCount(text) {
    return (cleanText(text).match(/\S+/g) || []).length;
  }

  function sentenceParts(text) {
    const clean = cleanText(text);
    if (!clean) return [];
    const regex = /[^.!?\u2026\u3002\uff01\uff1f]+[.!?\u2026\u3002\uff01\uff1f]+["')\]]*|[^.!?\u2026\u3002\uff01\uff1f]+$/g;
    const parts = [];
    for (const match of clean.matchAll(regex)) {
      const value = cleanText(match[0]);
      if (!value) continue;
      const leading = match[0].search(/\S/);
      parts.push({ text: value, startOffset: (match.index || 0) + Math.max(0, leading) });
    }
    return parts.length ? parts : [{ text: clean, startOffset: 0 }];
  }

  function splitOversizedSentence(sentence, startOffset, maxBytes = MAX_TTS_ITEM_BYTES) {
    const parts = [];
    let rest = cleanText(sentence);
    let absoluteOffset = startOffset;
    while (utf8Length(rest) > maxBytes) {
      let cut = Math.floor(rest.length * (maxBytes / utf8Length(rest)));
      cut = Math.max(1, Math.min(cut, rest.length - 1));
      while (cut > 1 && utf8Length(rest.slice(0, cut)) > maxBytes) cut -= 1;
      const windowText = rest.slice(0, cut);
      const softCut = Math.max(
        windowText.lastIndexOf(" "),
        windowText.lastIndexOf(","),
        windowText.lastIndexOf(";"),
        windowText.lastIndexOf(":")
      );
      if (softCut > 80) cut = softCut;
      const text = cleanText(rest.slice(0, cut));
      if (text) parts.push({ text, startOffset: absoluteOffset });
      const consumed = rest.slice(0, cut).length;
      rest = cleanText(rest.slice(cut));
      absoluteOffset += consumed;
      while (sentence[absoluteOffset - startOffset] === " ") absoluteOffset += 1;
    }
    if (rest) parts.push({ text: rest, startOffset: absoluteOffset });
    return parts;
  }

  function splitTextForTtsItems(text) {
    const clean = cleanText(text);
    if (!clean) return [];
    const sentences = sentenceParts(clean).flatMap((sentence) =>
      utf8Length(sentence.text) > MAX_TTS_ITEM_BYTES
        ? splitOversizedSentence(sentence.text, sentence.startOffset)
        : [sentence]
    );
    const items = [];
    let current = null;

    const pushCurrent = () => {
      if (current?.text) items.push(current);
      current = null;
    };

    for (const sentence of sentences) {
      const wc = wordCount(sentence.text);
      if (!current) {
        current = { text: sentence.text, startOffset: sentence.startOffset, sentenceCount: 1, wordCount: wc };
        continue;
      }

      const merged = `${current.text} ${sentence.text}`;
      const canMerge =
        current.sentenceCount < MAX_SHORT_SENTENCES_PER_ITEM &&
        current.wordCount <= SHORT_SENTENCE_WORDS * current.sentenceCount &&
        wc <= SHORT_SENTENCE_WORDS &&
        utf8Length(merged) <= MAX_TTS_ITEM_BYTES;

      if (canMerge) {
        current.text = merged;
        current.sentenceCount += 1;
        current.wordCount += wc;
      } else {
        pushCurrent();
        current = { text: sentence.text, startOffset: sentence.startOffset, sentenceCount: 1, wordCount: wc };
      }
    }
    pushCurrent();
    return items.map(({ text, startOffset }) => ({ text, startOffset }));
  }

  function edgeRate() {
    const rate = els.rate ? Number(els.rate.value || 1) : 1;
    const pct = Math.max(-50, Math.min(100, Math.round((rate - 1) * 100)));
    return `${pct >= 0 ? "+" : ""}${pct}%`;
  }

  function audioVolume() {
    return els.volume ? Math.max(0, Math.min(1, Number(els.volume.value || 1))) : 1;
  }

  function selectedVoiceName() {
    const selected = els.voice?.value || DEFAULT_VOICE;
    return EDGE_VOICE_PRESETS.some((voice) => voice.name === selected) ? selected : DEFAULT_VOICE;
  }

  function voiceForSsml(shortName) {
    const voice = String(shortName || DEFAULT_VOICE);
    const m = voice.match(/^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/);
    if (!m) return voice;
    const lang = `${m[1]}-${m[2]}`;
    let name = m[3];
    if (name.includes("-")) name = name.split("-").pop();
    return `Microsoft Server Speech Text to Speech Voice (${lang}, ${name})`;
  }

  function ssml(text) {
    const voice = voiceForSsml(selectedVoiceName());
    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='vi-VN'><voice name='${escapeXml(voice)}'><prosody pitch='+0Hz' rate='${edgeRate()}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
  }

  function textFrame(path, contentType, body) {
    return `X-Timestamp:${timestamp()}\r\nContent-Type:${contentType}\r\nPath:${path}\r\n\r\n${body}`;
  }

  function ssmlFrame(body) {
    return `X-RequestId:${requestId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp()}Z\r\nPath:ssml\r\n\r\n${body}`;
  }

  function parseTextFrame(data) {
    const text = new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data));
    const split = text.indexOf("\r\n\r\n");
    const headers = {};
    if (split >= 0) {
      for (const line of text.slice(0, split).split("\r\n")) {
        const i = line.indexOf(":");
        if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1).trim();
      }
    }
    return headers;
  }

  async function dataToBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (typeof data === "string") return new TextEncoder().encode(data);
    return new Uint8Array();
  }

  async function parseBinaryFrame(data) {
    const bytes = await dataToBytes(data);
    if (bytes.length < 2) return null;
    const headerLength = (bytes[0] << 8) | bytes[1];
    if (bytes.length < headerLength + 2) return null;
    const headerText = new TextDecoder().decode(bytes.slice(2, headerLength + 2));
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1).trim();
    }
    return { headers, payload: bytes.slice(headerLength + 2) };
  }

  function edgeSocketUrl(gec) {
    return `${WS_URL}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${EDGE_VERSION}&ConnectionId=${requestId()}`;
  }

  function parseWordBoundaries(jsonBody) {
    try {
      const parsed = JSON.parse(jsonBody);
      const out = [];
      for (const entry of parsed.Metadata || []) {
        if (entry.Type !== "WordBoundary") continue;
        const offset = entry.Data && entry.Data.Offset;
        const duration = entry.Data && entry.Data.Duration;
        const text = entry.Data && entry.Data.text && entry.Data.text.Text;
        if (typeof offset !== "number" || typeof text !== "string" || !text) continue;
        out.push({ offsetSec: offset / 1e7, durationSec: (duration || 0) / 1e7, text });
      }
      return out;
    } catch {
      return [];
    }
  }

  function synthesizeEdgeAudioChunk(text, signal) {
    return new Promise(async (resolve, reject) => {
      const chunks = [];
      const boundaries = [];
      let socket;
      let gotAudio = false;
      let settled = false;
      let timeoutId;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try { socket && socket.readyState <= WebSocket.OPEN && socket.close(); } catch {}
        fn(value);
      };
      const fail = (err) => finish(reject, err instanceof Error ? err : new Error(String(err)));
      const abort = () => fail(new DOMException("Aborted", "AbortError"));

      try {
        if (signal?.aborted) return abort();
        socket = new WebSocket(edgeSocketUrl(await secMsGec()));
        timeoutId = setTimeout(() => fail(new Error("Edge TTS timeout")), 30000);
        if (signal) signal.addEventListener("abort", abort, { once: true });

        socket.onopen = () => {
          const config = {
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "true" },
                  outputFormat: OUTPUT_FORMAT,
                },
              },
            },
          };
          socket.send(textFrame("speech.config", "application/json; charset=utf-8", JSON.stringify(config)) + "\r\n");
          socket.send(ssmlFrame(ssml(text)));
        };

        socket.onerror = () => fail(new Error("Edge TTS websocket error. Kiểm tra kết nối mạng, tải lại trang rồi thử lại (một số trình duyệt/mạng chặn máy chủ Edge TTS)."));
        socket.onclose = (event) => {
          if (settled || signal?.aborted) return;
          if (!gotAudio) {
            const detail = event?.code ? ` (${event.code}${event.reason ? ": " + event.reason : ""})` : "";
            fail(new Error("Edge TTS không trả audio" + detail + "."));
          }
          else finish(resolve, { blob: new Blob(chunks, { type: AUDIO_TYPE }), boundaries });
        };

        socket.onmessage = async (event) => {
          try {
            if (typeof event.data === "string") {
              const headers = parseTextFrame(new TextEncoder().encode(event.data));
              if (headers.Path === "turn.end") {
                try { socket.close(); } catch {}
                return;
              }
              if (headers.Path === "audio.metadata") {
                const split = event.data.indexOf("\r\n\r\n");
                const body = split >= 0 ? event.data.slice(split + 4) : "";
                boundaries.push(...parseWordBoundaries(body));
              }
              return;
            }
            const frame = await parseBinaryFrame(event.data);
            if (!frame || frame.headers.Path !== "audio" || !frame.payload.length) return;
            gotAudio = true;
            chunks.push(frame.payload);
          } catch (err) {
            fail(err);
          }
        };
      } catch (err) {
        fail(err);
      }
    });
  }

  function estimateBlobDuration(blob) {
    return new Promise((resolve, reject) => {
      const probe = new Audio();
      probe.preload = "metadata";
      const url = URL.createObjectURL(blob);
      probe.src = url;
      probe.onloadedmetadata = () => {
        const d = Number.isFinite(probe.duration) ? probe.duration : 0;
        URL.revokeObjectURL(url);
        resolve(d);
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("probe failed"));
      };
    });
  }

  async function synthesizeEdgeAudio(text, signal) {
    const chunks = splitTextByBytes(text);
    const blobs = [];
    const boundaries = [];
    let cumulativeSec = 0;
    for (const chunk of chunks) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { blob, boundaries: chunkBoundaries } = await synthesizeEdgeAudioChunk(chunk, signal);
      blobs.push(blob);
      let chunkEndSec = 0;
      for (const b of chunkBoundaries) {
        boundaries.push({ offsetSec: cumulativeSec + b.offsetSec, durationSec: b.durationSec, text: b.text });
        chunkEndSec = Math.max(chunkEndSec, b.offsetSec + b.durationSec);
      }
      if (!chunkBoundaries.length || chunkEndSec <= 0) {
        chunkEndSec = await estimateBlobDuration(blob).catch(() => 0);
      }
      if (chunkEndSec <= 0) chunkEndSec = Math.max(1, cleanText(chunk).split(/\s+/).filter(Boolean).length * 0.36);
      cumulativeSec += chunkEndSec;
    }
    return { blob: new Blob(blobs, { type: AUDIO_TYPE }), boundaries, durationSec: cumulativeSec };
  }

  async function synthesizeWithRetries(text, signal) {
    let lastError;
    for (let attempt = 0; attempt < SYNTH_RETRIES; attempt += 1) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await synthesizeEdgeAudio(text, signal);
      } catch (err) {
        lastError = err;
        if (err?.name === "AbortError" || signal?.aborted) throw err;
        if (attempt < SYNTH_RETRIES - 1) {
          await new Promise((resolve) => setTimeout(resolve, 400 + attempt * 250));
        }
      }
    }
    throw lastError || new Error("Edge TTS không tạo được audio.");
  }

  function installFrameStyle() {
    const d = getDoc();
    if (!d) return;
    const existing = d.getElementById("waka-tts-style");
    const style = existing || d.createElement("style");
    style.id = "waka-tts-style";
    style.textContent = `
      ::highlight(waka-tts-word) {
        background-color: rgba(193, 122, 79, .55);
        color: inherit;
      }
    `;
    if (!existing) d.head.appendChild(style);
  }

  function isNestedWrapper(el) {
    if (!el || el.tagName !== "DIV") return false;
    return !!el.querySelector("p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th");
  }

  function isUsableBlock(el) {
    if (!el || isNestedWrapper(el)) return false;
    const text = cleanText(el.textContent);
    if (text.length < 2) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function collectBlocks() {
    const wrap = getWrap();
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll(BLOCK_SELECTOR)).filter(isUsableBlock);
  }

  function collectSpeechItems() {
    const items = [];
    for (const block of collectBlocks()) {
      for (const item of splitTextForTtsItems(block.textContent)) {
        items.push({ el: block, text: item.text, startOffset: item.startOffset });
      }
    }
    return items;
  }

  function blockFromSelection(items) {
    const d = getDoc();
    if (!d) return null;
    const sel = d.getSelection && d.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const block = node && node.closest ? node.closest(BLOCK_SELECTOR) : null;
    return block && items.some((item) => item.el === block) ? block : null;
  }

  function visibleStartBlock(items) {
    const d = getDoc();
    if (!d || !items.length) return null;
    const blocks = Array.from(new Set(items.map((item) => item.el)));
    const vh = d.defaultView ? d.defaultView.innerHeight : 800;
    const vw = d.defaultView ? d.defaultView.innerWidth : 1000;
    let best = null;
    let bestScore = Infinity;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.bottom < 20 || rect.top > vh - 20) continue;
      if (rect.right < 20 || rect.left > vw - 20) continue;
      const score = Math.abs(Math.max(rect.top, 0));
      if (score < bestScore) {
        best = block;
        bestScore = score;
      }
    }
    return best || blocks[0];
  }

  function findStartIndex(items) {
    const selected = blockFromSelection(items);
    const start = selected || visibleStartBlock(items);
    const index = items.findIndex((item) => item.el === start);
    return Math.max(0, index);
  }

  function clearHighlight() {
    try {
      if (state.currentEl) state.currentEl.classList.remove("waka-tts-current");
    } catch {}
    state.currentEl = null;
  }

  const WORD_HIGHLIGHT_NAME = "waka-tts-word";
  const textMapCache = new WeakMap();

  function buildTextMap(el) {
    const text = [];
    const map = [];
    let pendingSpace = false;
    let started = false;
    const doc = el.ownerDocument;
    const nodeFilter = doc.defaultView?.NodeFilter || window.NodeFilter;
    const walker = doc.createTreeWalker(el, nodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = node.data;
      for (let i = 0; i < data.length; i += 1) {
        const ch = data[i];
        if (/[\s\u200b\u200c\u200d\ufeff\u0000-\u001f]/.test(ch)) {
          if (started) pendingSpace = true;
          continue;
        }
        if (pendingSpace) {
          text.push(" ");
          map.push({ node, offset: i });
          pendingSpace = false;
        }
        text.push(ch);
        map.push({ node, offset: i });
        started = true;
      }
    }
    return { text: text.join(""), map };
  }

  function getTextMap(el) {
    if (textMapCache.has(el)) return textMapCache.get(el);
    const built = buildTextMap(el);
    textMapCache.set(el, built);
    return built;
  }

  function computeWordRanges(textMap, words, baseOffset) {
    const { text, map } = textMap;
    const ranges = [];
    let cursor = Math.max(0, Number(baseOffset) || 0);
    for (const word of words) {
      const needle = cleanText(word);
      if (!needle) {
        ranges.push(null);
        continue;
      }
      const idx = text.indexOf(needle, cursor);
      if (idx === -1) {
        ranges.push(null);
        continue;
      }
      cursor = idx + needle.length;
      const startInfo = map[idx];
      const endInfo = map[idx + needle.length - 1];
      if (!startInfo || !endInfo) {
        ranges.push(null);
        continue;
      }
      try {
        const range = startInfo.node.ownerDocument.createRange();
        range.setStart(startInfo.node, startInfo.offset);
        range.setEnd(endInfo.node, endInfo.offset + 1);
        ranges.push(range);
      } catch {
        ranges.push(null);
      }
    }
    return ranges;
  }

  function findBoundaryIndex(boundaries, seconds) {
    if (!boundaries || !boundaries.length) return -1;
    let lo = 0;
    let hi = boundaries.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (boundaries[mid].offsetSec <= seconds) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function estimateBoundaryDuration(boundaries) {
    if (!boundaries || !boundaries.length) return 0;
    const last = boundaries[boundaries.length - 1];
    const end = Number(last.offsetSec || 0) + Number(last.durationSec || 0);
    return Number.isFinite(end) && end > 0 ? end : 0;
  }

  function stopWordHighlight() {
    const wh = state.wordHighlight;
    if (!wh) return;
    try { wh.win.cancelAnimationFrame(wh.raf); } catch {}
    try { wh.win.CSS.highlights.delete(WORD_HIGHLIGHT_NAME); } catch {}
    state.wordHighlight = null;
  }

  function startWordHighlight(item, boundaries, runId) {
    stopWordHighlight();
    if (!boundaries || !boundaries.length) return;
    const d = getDoc();
    const win = d ? d.defaultView : null;
    if (!win || !win.CSS || !win.CSS.highlights || !win.Highlight) return;

    const textMap = getTextMap(item.el);
    const words = boundaries.map((b) => b.text);
    const wordRanges = computeWordRanges(textMap, words, item.startOffset || 0);
    const highlightObj = new win.Highlight();
    win.CSS.highlights.set(WORD_HIGHLIGHT_NAME, highlightObj);
    state.wordHighlight = { win, raf: 0, runId, boundaries, wordRanges, highlightObj, lastIndex: -2 };

    const tick = () => {
      const wh = state.wordHighlight;
      if (!wh || wh.runId !== runId) return;
      if (window.WakaTTSPill?.isPanelOpen?.()) {
        if (wh.lastIndex !== -3) {
          wh.lastIndex = -3;
          wh.highlightObj.clear();
        }
        wh.raf = win.requestAnimationFrame(tick);
        return;
      }
      const idx = findBoundaryIndex(boundaries, state.audio.currentTime);
      if (idx !== wh.lastIndex) {
        wh.lastIndex = idx;
        wh.highlightObj.clear();
        const range = idx >= 0 ? wh.wordRanges[idx] : null;
        if (range) wh.highlightObj.add(range);
      }
      wh.raf = win.requestAnimationFrame(tick);
    };
    state.wordHighlight.raf = win.requestAnimationFrame(tick);
  }

  function revealBlock(block) {
    const d = getDoc();
    if (!d || !block) return;
    installFrameStyle();
    clearHighlight();

    const rect = block.getBoundingClientRect();
    const win = d.defaultView;
    const vh = win ? win.innerHeight : 800;
    const vw = win ? win.innerWidth : 1000;
    if (rect.top >= 40 && rect.bottom <= vh - 40 && rect.left >= 0 && rect.right <= vw) return;

    const wrap = getWrap();
    const frame = app().bookFrame;
    if (wrap && frame && wrap.scrollWidth > wrap.clientWidth + 10) {
      let offsetLeft = 0;
      let node = block;
      while (node && node !== wrap) {
        offsetLeft += node.offsetLeft || 0;
        node = node.offsetParent;
      }
      const pageWidth = frame.clientWidth || wrap.clientWidth || 1;
      if (app().setPage) app().setPage(Math.max(0, Math.floor(offsetLeft / pageWidth)));
      return;
    }

    try {
      block.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      block.scrollIntoView();
    }
  }

  function clearAudioUrl() {
    if (!state.audioUrl) return;
    URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = "";
  }

  function primeAudioForGesture() {
    if (state.audioPrimed) return;
    state.audioPrimed = true;
    const oldMuted = state.audio.muted;
    const oldVolume = state.audio.volume;
    const silentWav = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
    try {
      state.audio.muted = true;
      state.audio.volume = 0;
      state.audio.src = silentWav;
      const p = state.audio.play();
      if (p && p.catch) p.catch(() => {});
      setTimeout(() => {
        try { state.audio.pause(); } catch {}
        state.audio.removeAttribute("src");
        try { state.audio.load(); } catch {}
        state.audio.muted = oldMuted;
        state.audio.volume = oldVolume || audioVolume();
      }, 80);
    } catch (err) {
      state.audio.muted = oldMuted;
      state.audio.volume = oldVolume || audioVolume();
    }
  }

  function clearPrefetch() {
    for (const job of state.prefetch.values()) {
      try { job.controller.abort(); } catch {}
    }
    state.prefetch.clear();
  }

  function prefetchItem(index, runId) {
    if (index < 0 || index >= state.queue.length) return null;
    if (state.prefetch.has(index)) return state.prefetch.get(index);
    const item = state.queue[index];
    const controller = new AbortController();
    const job = {
      controller,
      promise: synthesizeWithRetries(item.text, controller.signal)
        .then(({ blob, boundaries, durationSec }) => ({ ok: true, blob, boundaries, durationSec }))
        .catch((error) => ({ ok: false, error }))
        .finally(() => {
          if (runId !== state.runId) return;
          const current = state.prefetch.get(index);
          if (current === job && index < state.index) state.prefetch.delete(index);
        }),
    };
    state.prefetch.set(index, job);
    return job;
  }

  function primePrefetch(runId) {
    if (runId !== state.runId || state.stopping) return;
    for (const [index, job] of Array.from(state.prefetch.entries())) {
      if (index < state.index || index >= state.index + PREFETCH_AHEAD) {
        try { job.controller.abort(); } catch {}
        state.prefetch.delete(index);
      }
    }

    let active = 0;
    for (const index of state.prefetch.keys()) {
      if (index >= state.index && index < state.index + PREFETCH_AHEAD) active += 1;
    }
    for (let index = state.index; index < Math.min(state.queue.length, state.index + PREFETCH_AHEAD); index += 1) {
      if (active >= PREFETCH_CONCURRENCY) break;
      if (!state.prefetch.has(index)) {
        prefetchItem(index, runId);
        active += 1;
      }
    }
  }

  async function playBlob(blob, runId) {
    clearAudioUrl();
    state.audioUrl = URL.createObjectURL(blob);
    state.audio.src = state.audioUrl;
    state.audio.volume = audioVolume();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        state.audio.removeEventListener("ended", onEnd);
        state.audio.removeEventListener("error", onError);
      };
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Không phát được audio Edge TTS."));
      };
      state.audio.addEventListener("ended", onEnd, { once: true });
      state.audio.addEventListener("error", onError, { once: true });
      if (runId !== state.runId || state.stopping) {
        cleanup();
        resolve();
        return;
      }
      state.audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  async function continueNextChapter() {
    const runId = state.runId;
    const loc = app().getLocation ? app().getLocation() : null;
    if (!loc || loc.spineIndex + 1 >= loc.spineCount || !app().gotoLocation) {
      stop(false);
      setStatus(tr("tts.status.finished", null, "Đã đọc hết sách."));
      return;
    }
    setStatus(tr("tts.status.nextChapter", null, "Đang chuyển sang chương tiếp theo..."));
    await app().gotoLocation(loc.spineIndex + 1, { restorePage: 0 });
    await new Promise((r) => setTimeout(r, 300));
    if (state.stopping || runId !== state.runId) return;
    clearPrefetch();
    state.queue = collectSpeechItems();
    state.index = 0;
    if (!state.queue.length) {
      await continueNextChapter();
      return;
    }
    speakCurrent();
  }

  async function speakCurrent() {
    if (state.stopping) return;
    if (state.index >= state.queue.length) {
      continueNextChapter();
      return;
    }

    const runId = state.runId;
    primePrefetch(runId);
    const item = state.queue[state.index];
    const text = item?.text || "";
    if (!text) {
      state.index += 1;
      speakCurrent();
      return;
    }

    revealBlock(item.el);
    state.speaking = true;
    state.paused = false;
    emitState();
    state.aborter = state.prefetch.get(state.index)?.controller || null;
    setStatus(tr("tts.status.generating", { current: state.index + 1, total: state.queue.length }, `Edge TTS: đang tạo audio đoạn ${state.index + 1}/${state.queue.length}...`));

    try {
      const job = prefetchItem(state.index, runId);
      state.aborter = job.controller;
      const result = await job.promise;
      state.prefetch.delete(state.index);
      if (state.stopping || runId !== state.runId) return;
      if (!result.ok) throw result.error;
      primePrefetch(runId);
      setStatus(tr("tts.status.reading", { current: state.index + 1, total: state.queue.length }, `Edge TTS: đang đọc đoạn ${state.index + 1}/${state.queue.length}`));
      state.currentBoundaries = Array.isArray(result.boundaries) ? result.boundaries : [];
      state.currentDuration = Number.isFinite(result.durationSec) && result.durationSec > 0
        ? result.durationSec
        : estimateBoundaryDuration(state.currentBoundaries);
      startWordHighlight(item, result.boundaries, runId);
      await playBlob(result.blob, runId);
      stopWordHighlight();
      if (state.stopping || runId !== state.runId) return;
      state.index += 1;
      primePrefetch(runId);
      speakCurrent();
    } catch (err) {
      stopWordHighlight();
      if (state.stopping || runId !== state.runId || err?.name === "AbortError") return;
      console.warn("[Read Aloud Edge TTS]", err);
      setStatus(tr("tts.status.error", { message: err.message || err }, "Edge TTS lỗi, bỏ qua đoạn hiện tại: " + (err.message || err)));
      state.index += 1;
      setTimeout(speakCurrent, 300);
    }
  }

  function startFromCurrent() {
    if (!hasBookOpen()) {
      setStatus(tr("tts.status.noBook", null, "Hãy mở một sách trước khi dùng Read Aloud."));
      return;
    }
    stop(false);
    try { window.ReaderFeatures?.music?.close?.(); } catch {}
    try { window.ReaderFeatures?.closeMusicPanel?.(); } catch {}
    primeAudioForGesture();
    state.runId += 1;
    state.stopping = false;
    installFrameStyle();
    clearPrefetch();
    state.queue = collectSpeechItems();
    if (!state.queue.length) {
      setStatus(tr("tts.status.noText", null, "Không tìm thấy đoạn văn bản để đọc."));
      emitState();
      return;
    }
    state.index = findStartIndex(state.queue);
    speakCurrent();
  }

  function pause() {
    if (!state.speaking || state.paused) return;
    state.audio.pause();
    state.paused = true;
    emitState();
    setStatus(tr("tts.status.paused", null, "Đã tạm dừng."));
  }

  function resume() {
    if (state.paused) {
      state.audio.play().catch((err) => setStatus(tr("tts.status.resumeError", { message: err.message || err }, "Không đọc tiếp được: " + (err.message || err))));
      state.paused = false;
      emitState();
      setStatus(tr("tts.status.resumed", null, "Đang đọc tiếp."));
      return;
    }
    if (!state.speaking) startFromCurrent();
  }

  function stop(update = true) {
    state.stopping = true;
    state.runId += 1;
    try { state.aborter && state.aborter.abort(); } catch {}
    clearPrefetch();
    try { state.audio.pause(); } catch {}
    state.audio.removeAttribute("src");
    try { state.audio.load(); } catch {}
    clearAudioUrl();
    clearHighlight();
    stopWordHighlight();
    state.queue = [];
    state.index = 0;
    state.speaking = false;
    state.paused = false;
    state.aborter = null;
    state.stopping = false;
    state.audioPrimed = false;
    state.currentBoundaries = [];
    state.currentDuration = 0;
    emitState();
    if (update) setStatus(tr("tts.status.stopped", null, "Đã dừng Read Aloud."));
  }

  function stopCurrentPlaybackOnly() {
    try { state.aborter && state.aborter.abort(); } catch {}
    try { state.audio.pause(); } catch {}
    stopWordHighlight();
  }

  function skipBy(delta) {
    if (!state.speaking || !state.queue.length) return;
    state.runId += 1;
    state.stopping = false;
    stopCurrentPlaybackOnly();
    clearPrefetch();
    state.index = Math.max(0, Math.min(state.queue.length - 1, state.index + delta));
    state.paused = false;
    emitState();
    speakCurrent();
  }

  function seekTo(seconds) {
    const nativeDuration = Number.isFinite(state.audio.duration) ? state.audio.duration : 0;
    const duration = nativeDuration || state.currentDuration || estimateBoundaryDuration(state.currentBoundaries);
    if (!duration) return;
    try {
      const next = Number(seconds);
      state.audio.currentTime = Math.max(0, Math.min(Number.isFinite(next) ? next : 0, duration));
    } catch {}
  }

  function onRailClick() {
    setTimeout(() => {
      if (state.speaking && state.paused) resume();
      else if (!state.speaking) startFromCurrent();
    }, 0);
  }

  function toggleFromUserGesture() {
    if (state.speaking && !state.paused) stop(true);
    else if (state.speaking && state.paused) resume();
    else startFromCurrent();
  }

  function loadVoices() {
    if (!els.voice) return;
    state.voices = EDGE_VOICE_PRESETS.slice();
    els.voice.innerHTML = state.voices
      .map((v) => `<option value="${escapeAttr(v.name)}">${escapeHtml(v.label)}</option>`)
      .join("");
    els.voice.value = DEFAULT_VOICE;
  }

  if (els.rail) els.rail.addEventListener("click", onRailClick);
  if (els.start) els.start.addEventListener("click", startFromCurrent);
  if (els.pause) els.pause.addEventListener("click", pause);
  if (els.resume) els.resume.addEventListener("click", resume);
  if (els.stop) els.stop.addEventListener("click", () => stop(true));
  if (els.rate) {
    els.rate.addEventListener("input", () => {
      if (els.rateValue) els.rateValue.textContent = Number(els.rate.value).toFixed(1) + "x";
    });
  }
  if (els.volume) {
    els.volume.addEventListener("input", () => {
      state.audio.volume = audioVolume();
    });
  }

  loadVoices();
  window.ReaderReadAloud = {
    start: startFromCurrent,
    pause,
    resume,
    stop,
    toggle: toggleFromUserGesture,
    next: () => skipBy(1),
    prev: () => skipBy(-1),
    seekTo,
    isActive: () => state.speaking,
    isSpeaking: () => state.speaking && !state.paused,
    getProgress: () => {
      const currentTime = Number.isFinite(state.audio.currentTime) ? state.audio.currentTime : 0;
      const nativeDuration = Number.isFinite(state.audio.duration) ? state.audio.duration : 0;
      const duration = nativeDuration || state.currentDuration || estimateBoundaryDuration(state.currentBoundaries);
      const wordIndex = findBoundaryIndex(state.currentBoundaries, currentTime);
      return {
        index: state.index,
        total: state.queue.length,
        currentTime,
        duration,
        currentText: state.queue[state.index]?.text || "",
        wordIndex,
        wordTotal: state.currentBoundaries.length,
      };
    },
  };
  window.addEventListener("beforeunload", () => stop(false));
})();
