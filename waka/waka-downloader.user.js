// ==UserScript==
// @name         Waka Downloader Vip
// @namespace    https://nguyenphanvn95.github.io/waka/
// @version      4.1.0
// @description  Tải sách nói (MP3) và ebook (EPUB) từ Waka.vn — hỗ trợ nhận diện & nhúng metadata tự động
// @author       WakaDL
// @match        https://waka.vn/sach-noi/*
// @match        https://waka.vn/ebook/*
// @match        https://waka.vn/reader/*
// @connect      vegacdn.vn
// @connect      beta-api.waka.vn
// @connect      store.waka.vn
// @connect      waka.vn
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @require      https://nguyenphanvn95.github.io/waka/lib/jszip.min.js
// @require      https://nguyenphanvn95.github.io/waka/lib/crypto-js.min.js
// @require      https://nguyenphanvn95.github.io/waka/lib/lame.min.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  //  STORAGE SHIM  –  thay chrome.storage.local bằng GM_getValue/Set
  // ═══════════════════════════════════════════════════════════════════
  const WakaStorage = {
    saveMetadata(meta) {
      GM_setValue('wakaMetadata', JSON.stringify(meta || {}));
    },
    getMetadata() {
      try {
        const raw = GM_getValue('wakaMetadata', null);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    clearMetadata() {
      GM_deleteValue('wakaMetadata');
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  //  DETECT PAGE
  // ═══════════════════════════════════════════════════════════════════
  const path = location.pathname;
  const isSachNoi = /^\/sach-noi\//.test(path);
  const isEbook   = /^\/ebook\//.test(path);
  const isReader  = /^\/reader\//.test(path);

  // ═══════════════════════════════════════════════════════════════════
  //  HLS PARSER
  // ═══════════════════════════════════════════════════════════════════
  const HLSParser = (() => {
    function resolveUrl(rel, base) {
      if (/^https?:\/\//i.test(rel)) return rel;
      try { return new URL(rel, base).href; }
      catch { return base.slice(0, base.lastIndexOf('/') + 1) + rel; }
    }
    function parseMasterPlaylist(text, baseUrl) {
      const lines = text.split('\n').map(l => l.trim());
      const variants = [];
      let bw = 0;
      for (const l of lines) {
        if (l.startsWith('#EXT-X-STREAM-INF:')) {
          const m = l.match(/BANDWIDTH=(\d+)/i);
          bw = m ? parseInt(m[1]) : 0;
          continue;
        }
        if (!l.startsWith('#') && l.length && bw > 0) {
          variants.push({ url: resolveUrl(l, baseUrl), bandwidth: bw });
          bw = 0;
        }
      }
      if (!variants.length) {
        for (const l of lines)
          if (!l.startsWith('#') && l.includes('.m3u8')) return resolveUrl(l, baseUrl);
        return null;
      }
      return variants[0].url;
    }
    function parseChunklist(text, baseUrl) {
      const lines = text.split('\n').map(l => l.trim());
      const segs = [];
      let key = null, seq = 0;
      for (const l of lines) {
        if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { seq = parseInt(l.split(':')[1]) || 0; continue; }
        if (l.startsWith('#EXT-X-KEY:')) {
          const mm = l.match(/METHOD=([^,\s]+)/i);
          const um = l.match(/URI="([^"]+)"/i);
          const im = l.match(/IV=0x([0-9a-fA-F]+)/i);
          const method = mm ? mm[1].toUpperCase() : 'NONE';
          key = method === 'NONE' ? null : { method, uri: um ? resolveUrl(um[1], baseUrl) : null, iv: im ? im[1].padStart(32,'0') : null };
          continue;
        }
        if (!l.startsWith('#') && l.length) {
          segs.push({ url: resolveUrl(l, baseUrl), keyInfo: key ? {...key} : null, sequence: seq++ });
        }
      }
      return segs;
    }
    return { parseMasterPlaylist, parseChunklist, resolveUrl };
  })();

  // ═══════════════════════════════════════════════════════════════════
  //  HLS DOWNLOADER
  // ═══════════════════════════════════════════════════════════════════
  const HLSDownloader = (() => {
    let _onProgress = null, _onStatus = null;
    function setCallbacks(p, s) { _onProgress = p; _onStatus = s; }
    function reportProgress(c, t, m) { _onProgress && _onProgress(c, t, m); }
    function reportStatus(m) { _onStatus && _onStatus(m); }

    async function fetchArrayBuffer(url) {
      const resp = await fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
      return resp.arrayBuffer();
    }
    async function fetchText(url) {
      const resp = await fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    }

    const _keyCache = {};
    async function fetchKey(uri) {
      if (!_keyCache[uri]) _keyCache[uri] = await fetchArrayBuffer(uri);
      return _keyCache[uri];
    }
    function seqIV(s) {
      const iv = new Uint8Array(16); let n = s;
      for (let i = 15; i >= 0; i--) { iv[i] = n & 0xff; n = Math.floor(n / 256); }
      return iv;
    }
    function hexIV(h) {
      const p = h.padStart(32, '0');
      return Uint8Array.from(p.match(/../g).map(x => parseInt(x, 16)));
    }
    async function decryptAES128(enc, keyBuf, iv) {
      const ck = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);
      return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, enc);
    }

    async function downloadAll(playlistUrl) {
      reportStatus('Đang tải master playlist...');
      const masterText = await fetchText(playlistUrl);
      const chunkUrl = HLSParser.parseMasterPlaylist(masterText, playlistUrl);
      if (!chunkUrl) throw new Error('Không tìm thấy chunklist.');

      reportStatus('Đang phân tích chunklist...');
      const chunkText = await fetchText(chunkUrl);
      const segs = HLSParser.parseChunklist(chunkText, chunkUrl);
      if (!segs.length) throw new Error('Chunklist rỗng.');

      reportStatus(`${segs.length} segments. Bắt đầu tải...`);
      const bufs = [];
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        reportProgress(i, segs.length, `Tải segment ${i+1}/${segs.length}...`);
        const enc = await fetchArrayBuffer(s.url);
        if (s.keyInfo?.method === 'AES-128' && s.keyInfo.uri) {
          const kbuf = await fetchKey(s.keyInfo.uri);
          const iv = s.keyInfo.iv ? hexIV(s.keyInfo.iv) : seqIV(s.sequence);
          bufs.push(new Uint8Array(await decryptAES128(enc, kbuf, iv)));
        } else {
          bufs.push(new Uint8Array(enc));
        }
      }
      const total = bufs.reduce((s, b) => s + b.length, 0);
      const out = new Uint8Array(total); let off = 0;
      for (const b of bufs) { out.set(b, off); off += b.length; }
      return out;
    }
    return { downloadAll, setCallbacks };
  })();

  // ═══════════════════════════════════════════════════════════════════
  //  MP3 ENCODER
  // ═══════════════════════════════════════════════════════════════════
  const MP3Encoder = (() => {
    let _onStatus = null, _onProgress = null;
    function setCallbacks(s, p) { _onStatus = s; _onProgress = p; }
    function status(m) { _onStatus && _onStatus(m); }
    function progress(p, m) { _onProgress && _onProgress(p, m); }

    function float32ToInt16(f32) {
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const c = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = c < 0 ? c * 0x8000 : c * 0x7fff;
      }
      return i16;
    }
    function concatUint8(arrs) {
      const total = arrs.reduce((s, a) => s + a.length, 0);
      const out = new Uint8Array(total); let off = 0;
      for (const a of arrs) { out.set(a, off); off += a.length; }
      return out;
    }
    async function decodeAAC(data, ctx) {
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej));
    }
    function encodePCM(audioBuf, bitrate) {
      const ch = audioBuf.numberOfChannels, sr = audioBuf.sampleRate;
      const l = audioBuf.getChannelData(0);
      const r = ch > 1 ? audioBuf.getChannelData(1) : l;
      const lame = new lamejs();
      const enc = new lame.Mp3Encoder(ch > 1 ? 2 : 1, sr, bitrate || 128);
      const BLOCK = 1152; const chunks = [];
      const total = Math.ceil(l.length / BLOCK);
      for (let i = 0; i < l.length; i += BLOCK) {
        const l16 = float32ToInt16(l.subarray(i, i + BLOCK));
        const r16 = float32ToInt16(r.subarray(i, i + BLOCK));
        const encoded = ch > 1 ? enc.encodeBuffer(l16, r16) : enc.encodeBuffer(l16);
        if (encoded.length) chunks.push(new Uint8Array(encoded));
        if (i % (BLOCK * 50) === 0) progress(Math.round((i / BLOCK / total) * 100), `Encoding MP3...`);
      }
      const fl = enc.flush();
      if (fl.length) chunks.push(new Uint8Array(fl));
      return concatUint8(chunks);
    }
    async function encode(aacData, audioCtx) {
      try {
        status('Đang giải mã AAC → PCM...');
        const ab = await decodeAAC(aacData, audioCtx);
        status(`OK – ${ab.duration.toFixed(1)}s. Đang encode MP3...`);
        const mp3 = encodePCM(ab, 128);
        status(`Xong – ${(mp3.length/1024/1024).toFixed(1)} MB`);
        return { blob: new Blob([mp3], { type: 'audio/mpeg' }), ext: 'mp3' };
      } catch (err) {
        console.warn('[MP3Encoder] Fallback .aac:', err);
        status('⚠ Không encode được MP3, lưu .aac...');
        return { blob: new Blob([aacData], { type: 'audio/aac' }), ext: 'aac' };
      }
    }
    return { encode, setCallbacks };
  })();

  // ═══════════════════════════════════════════════════════════════════
  //  EPUB DECODE (Waka AES-ECB JSON wrapper)
  // ═══════════════════════════════════════════════════════════════════
  const WakaEpubDecode = (() => {
    function toText(input) {
      if (typeof input === 'string') return input;
      if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
      if (ArrayBuffer.isView(input)) return new TextDecoder().decode(input);
      return String(input ?? '');
    }
    function isWrapped(text) {
      const t = String(text || '').trim();
      return t.startsWith('{') && t.includes('"cd"') && t.includes('"wd"');
    }
    function decodeWrapped(text) {
      const raw = String(text ?? '').trim();
      if (!isWrapped(raw)) return raw;
      if (typeof CryptoJS === 'undefined') throw new Error('CryptoJS not loaded');
      const data = JSON.parse(raw);
      if (!data.wd || !data.cd || !data.sw || !data.sd) return raw;
      const keyStr = String(data.wd) + 'a|w8' + String(data.sw) + String(data.sd);
      const key = CryptoJS.enc.Utf8.parse(keyStr);
      const ciphertext = CryptoJS.enc.Base64.parse(String(data.cd));
      const dec = CryptoJS.AES.decrypt({ ciphertext }, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 });
      const plain = dec.toString(CryptoJS.enc.Utf8);
      if (!plain) throw new Error('Decode failed');
      return plain;
    }
    async function decodeFileContent(input) { return decodeWrapped(await Promise.resolve(toText(input))); }
    function decodeFileSync(input) { return decodeWrapped(toText(input)); }
    function looksEncrypted(text) { try { return isWrapped(text); } catch { return false; } }
    function extractTitleFromOpf(opfText, fallback) {
      const m = String(opfText || '').match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) ||
                String(opfText || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (!m) return fallback || 'waka-ebook';
      return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim() || fallback || 'waka-ebook';
    }
    function safeName(s) { return String(s||'waka-ebook').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().replace(/\s+/g,'_').slice(0,100); }
    function normalizeFileName(n) { return String(n||'').replace(/^\/+/,''); }
    return { toText, decodeWrapped, decodeFileContent, decodeFileSync, looksEncrypted, extractTitleFromOpf, safeName, normalizeFileName };
  })();

  // ═══════════════════════════════════════════════════════════════════
  //  EPUB BUILDER
  // ═══════════════════════════════════════════════════════════════════
  const EPUBBuilder = (() => {
    function xmlEsc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function mimetype() { return 'application/epub+zip'; }
    function containerXml() {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`;
    }
    function normName(n) { return String(n||'').replace(/^\/+/,''); }
    function addFile(zip, name, content) { const s = normName(name); if (s) zip.file(s, content); }

    async function buildFromFiles(bookTitle, opfText, files) {
      if (!opfText?.trim()) throw new Error('content.opf is missing');
      const zip = new JSZip();
      zip.file('mimetype', mimetype(), { compression: 'STORE' });
      zip.file('META-INF/container.xml', containerXml());
      const oebps = zip.folder('OEBPS');
      addFile(oebps, 'content.opf', opfText);
      const entries = files instanceof Map ? Array.from(files.entries()) : Array.isArray(files) ? files : Object.entries(files||{});
      for (const entry of entries) {
        const href = Array.isArray(entry) ? entry[0] : entry.href;
        const value = Array.isArray(entry) ? entry[1] : entry.content;
        if (!href || normName(href) === 'content.opf') continue;
        addFile(oebps, href, value);
      }
      return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    }
    return { buildFromFiles };
  })();

  // ═══════════════════════════════════════════════════════════════════
  //  META INJECTOR  –  dùng WakaStorage thay chrome.storage
  // ═══════════════════════════════════════════════════════════════════
  const WakaMetaInjector = (() => {
    function getMeta() { return WakaStorage.getMetadata(); }
    function hasMeta() { const m = getMeta(); return !!(m && m.title); }
    function clearMeta() { WakaStorage.clearMetadata(); }

    async function fetchCoverBuf(url) {
      if (!url) return null;
      try {
        const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        return r.ok ? r.arrayBuffer() : null;
      } catch { return null; }
    }
    function xmlEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function patchOpf(opfText, meta, hasCover) {
      const dc = [];
      dc.push(`    <dc:identifier id="uid">waka-${Date.now()}</dc:identifier>`);
      if (meta.title) dc.push(`    <dc:title>${xmlEsc(meta.title)}</dc:title>`);
      dc.push(`    <dc:language>${xmlEsc(meta.language||'vi')}</dc:language>`);
      (meta.authors||[]).forEach(a => dc.push(`    <dc:creator>${xmlEsc(a)}</dc:creator>`));
      if (meta.publisher) dc.push(`    <dc:publisher>${xmlEsc(meta.publisher)}</dc:publisher>`);
      if (meta.pubdate) dc.push(`    <dc:date>${xmlEsc(meta.pubdate)}</dc:date>`);
      if (meta.comments) dc.push(`    <dc:description>${xmlEsc(meta.comments)}</dc:description>`);
      (meta.tags||[]).forEach(t => dc.push(`    <dc:subject>${xmlEsc(t)}</dc:subject>`));
      if (meta.source_url) dc.push(`    <dc:source>${xmlEsc(meta.source_url)}</dc:source>`);
      dc.push(`    <meta property="dcterms:modified">${new Date().toISOString().slice(0,19)}Z</meta>`);
      if (hasCover) dc.push(`    <meta name="cover" content="wdl-cover-image"/>`);
      const block = `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${dc.join('\n')}\n  </metadata>`;
      let patched = opfText.replace(/<metadata[\s\S]*?<\/metadata>/i, block);
      if (hasCover && !patched.includes('wdl-cover-image'))
        patched = patched.replace(/<manifest>/i, `<manifest>\n    <item id="wdl-cover-image" href="wdl-cover.jpg" media-type="image/jpeg"/>`);
      return patched;
    }

    async function injectIntoBlob(epubBlob) {
      const meta = getMeta();
      if (!meta?.title) return epubBlob;
      const zip = await JSZip.loadAsync(epubBlob);
      let opfPath = null;
      const containerXml = await zip.file('META-INF/container.xml')?.async('text');
      if (containerXml) { const m = containerXml.match(/full-path="([^"]+)"/); if (m) opfPath = m[1]; }
      if (!opfPath) zip.forEach(p => { if (!opfPath && p.endsWith('.opf')) opfPath = p; });
      if (!opfPath) return epubBlob;

      const opfFile = zip.file(opfPath) || zip.file('OEBPS/' + opfPath);
      if (!opfFile) return epubBlob;

      let opfText = await opfFile.async('text');
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      const coverBuf = meta.cover ? await fetchCoverBuf(meta.cover) : null;
      zip.file(opfPath, patchOpf(opfText, meta, !!coverBuf));
      if (coverBuf) zip.file(opfDir + 'wdl-cover.jpg', coverBuf);

      return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    }
    return { injectIntoBlob, hasMeta, getMeta, clearMeta };
  })();

  // ═══════════════════════════════════════════════════════════════════
  //  INTERCEPTORS — chạy sớm (document-start) trong unsafeWindow
  // ═══════════════════════════════════════════════════════════════════

  function installInterceptors() {
    const win = unsafeWindow || window;

    // ── AUDIO INTERCEPTOR (sach-noi) ─────────────────────────────────
    if (isSachNoi) {
      const PLAYLIST_RE = /vegacdn\.vn\/.+?\/playlist\.m3u8/;
      const GET_LIST_RE  = /beta-api\.waka\.vn\/fm\/getListAudioFile\b/;
      const NEXT_BACK_RE = /beta-api\.waka\.vn\/fm\/listNextBackFm\b/;
      const DOWNLOAD_RE  = /beta-api\.waka\.vn\/fm\/getDownloadItem\b/;
      const CHAPTER_KEY  = 'waka.audio.chapterList';

      if (!win.__waka_playlist_cache__) win.__waka_playlist_cache__ = {};
      if (!win.__waka_chapter_url_cache__) win.__waka_chapter_url_cache__ = {};

      function emit(type, detail) { win.dispatchEvent(new CustomEvent(type, { detail })); }

      function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
      function parseQuery(url) {
        try { const u = new URL(url.startsWith('http') ? url : 'https://'+url); const o={}; u.searchParams.forEach((v,k)=>o[k]=v); return o; }
        catch { return {}; }
      }

      function normalizeItem(item, meta) {
        if (!item || typeof item !== 'object') return null;
        const id = item.id ?? item.audio_file_id ?? item.chapter_id ?? null;
        if (!id) return null;
        return { id, audio_id: item.audio_id ?? meta.audio_id ?? null, name: item.name ?? '', description: item.description ?? '', zone: item.zone ?? '', order: Number(item.order ?? 0), thumb: item.thumb ?? '', duration: Number(item.duration ?? 0), created_time: item.created_time ?? '', audio_data: Array.isArray(item.audio_data) ? item.audio_data : [], read: item.read ?? null, is_download: item.is_download ?? null, parent_price: item.parent_price ?? null, mini_app: item.mini_app ?? null, view: item.view ?? null, owner: item.owner ?? null, is_noted: item.is_noted ?? null, content_type: item.content_type ?? '', parent_type: item.parent_type ?? '', is_summary: item.is_summary ?? null, content_detail_url: item.content_detail_url ?? '', in_wishlist: item.in_wishlist ?? null, parent_name: item.parent_name ?? '' };
      }

      function extractChapterPayload(text, url) {
        const json = safeJson(text);
        if (!json || json.code !== 0) return null;
        const meta = parseQuery(url);
        const source = GET_LIST_RE.test(url) ? 'getListAudioFile' : 'listNextBackFm';
        const raw = json.data;
        const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const norm = items.map(i => normalizeItem(i, meta)).filter(Boolean);
        if (!norm.length) return null;
        return { source, content_id: meta.content_id ? Number(meta.content_id) : null, chapter_id: meta.chapter_id ? Number(meta.chapter_id) : null, action: meta.action || null, page_no: meta.page_no ? Number(meta.page_no) : null, page_size: meta.page_size ? Number(meta.page_size) : null, total: Number(json.total ?? norm.length), items: norm, updatedAt: new Date().toISOString() };
      }

      function mergeChapterList(payload) {
        const current = win.__waka_audio_chapter_list__ || { items: [] };
        const map = new Map();
        for (const i of current.items || []) if (i?.id != null) map.set(String(i.id), i);
        for (const i of payload.items || []) if (i?.id != null) map.set(String(i.id), i);
        const merged = Array.from(map.values()).sort((a,b) => { const ao=Number(a.order??0),bo=Number(b.order??0); return ao!==bo?ao-bo:Number(a.id??0)-Number(b.id??0); });
        const result = { ...current, ...payload, items: merged, count: merged.length, updatedAt: payload.updatedAt };
        win.__waka_audio_chapter_list__ = result;
        try { win.localStorage.setItem(CHAPTER_KEY, JSON.stringify(result)); } catch {}
        emit('__waka_audio_chapters__', result);
        if (payload.source === 'getListAudioFile') emit('__waka_audio_list_ready__', result);
      }

      function getChapterCache(id) {
        const k = String(id);
        if (!win.__waka_chapter_url_cache__[k]) win.__waka_chapter_url_cache__[k] = {};
        return win.__waka_chapter_url_cache__[k];
      }

      function storePlaylistUrl(id, url, emitReady) {
        if (id == null || !url) return;
        const k = String(id);
        win.__waka_playlist_cache__[k] = url;
        getChapterCache(k).playlistUrl = url;
        if (emitReady) emit('__waka_playlist_ready__', { chapterId: k, playlistUrl: url });
      }

      function cacheChapterRequest(url) {
        if (!GET_LIST_RE.test(url) && !NEXT_BACK_RE.test(url) && !DOWNLOAD_RE.test(url)) return;
        const meta = parseQuery(url);
        const id = meta.chapter_id ?? meta.audio_file_id ?? meta.content_id ?? null;
        const cache = getChapterCache(id);
        cache.apiUrl = url;
        cache.action = meta.action || cache.action || null;
        cache.content_id = meta.content_id ? Number(meta.content_id) : cache.content_id ?? null;
        cache.chapter_id = meta.chapter_id ? Number(meta.chapter_id) : cache.chapter_id ?? null;
      }

      function findPlaylistUrl(obj, depth) {
        if (!obj || typeof obj !== 'object' || (depth||0) > 5) return null;
        for (const f of ['url','play_url','hls_url','stream_url','file','src','link']) {
          const v = obj[f];
          if (typeof v === 'string' && v && (v.includes('.m3u8') || v.includes('vegacdn.vn'))) return v;
        }
        if (Array.isArray(obj.audio_data)) for (const ad of obj.audio_data) { const u=findPlaylistUrl(ad,(depth||0)+1); if(u) return u; }
        for (const k of Object.keys(obj)) {
          if (['thumb','raw','avatar','cover','image'].includes(k)) continue;
          const val = obj[k];
          if (Array.isArray(val)) { for (const el of val) { if(el&&typeof el==='object'){const u=findPlaylistUrl(el,(depth||0)+1);if(u)return u;} } }
          else if (val&&typeof val==='object') { const u=findPlaylistUrl(val,(depth||0)+1); if(u) return u; }
        }
        return null;
      }

      function cacheChapterApiUrl(text, url) {
        const json = safeJson(text);
        if (!json || json.code !== 0) return;
        const meta = parseQuery(url);
        const id = meta.chapter_id ?? meta.content_id ?? null;
        const cache = getChapterCache(id);
        cache.apiUrl = url; cache.action = meta.action || cache.action || null;
        cache.content_id = meta.content_id ? Number(meta.content_id) : cache.content_id ?? null;
        cache.chapter_id = meta.chapter_id ? Number(meta.chapter_id) : cache.chapter_id ?? null;
        const items = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
        for (const item of items) {
          const pu = findPlaylistUrl(item);
          if (!pu) continue;
          storePlaylistUrl(id, pu, true);
          break;
        }
      }

      // Patch XHR
      const NativeXHR = win.XMLHttpRequest;
      function PatchedXHR() {
        const xhr = new NativeXHR(); let _url = '';
        const _open = xhr.open.bind(xhr);
        xhr.open = function(method, url) { _url = typeof url==='string'?url:''; cacheChapterRequest(_url); return _open.apply(xhr, arguments); };
        xhr.addEventListener('readystatechange', function() {
          if (xhr.readyState !== 4) return;
          if (PLAYLIST_RE.test(_url)) emit('__waka_stream__', { playlistUrl: _url });
          if (GET_LIST_RE.test(_url) || NEXT_BACK_RE.test(_url)) {
            const p = extractChapterPayload(xhr.responseText||'', _url);
            if (p) mergeChapterList(p);
          }
        });
        return xhr;
      }
      Object.setPrototypeOf(PatchedXHR, NativeXHR);
      Object.setPrototypeOf(PatchedXHR.prototype, NativeXHR.prototype);
      win.XMLHttpRequest = PatchedXHR;

      // Patch fetch
      const nativeFetch = win.fetch;
      win.fetch = async function(input, init) {
        const url = typeof input==='string' ? input : input instanceof Request ? input.url : String(input);
        cacheChapterRequest(url);
        const response = await nativeFetch(input, init);
        if (PLAYLIST_RE.test(url)) emit('__waka_stream__', { playlistUrl: url });
        if (GET_LIST_RE.test(url) || NEXT_BACK_RE.test(url)) {
          const clone = response.clone();
          clone.text().then(text => {
            const p = extractChapterPayload(text, url);
            if (p) mergeChapterList(p);
            cacheChapterApiUrl(text, url);
          }).catch(()=>{});
        }
        return response;
      };

      // Proxy for playlist fetch requests from content script
      win.addEventListener('__waka_fetch_playlist__', async function(e) {
        const { reqId, chapterId, contentId, action } = e.detail || {};
        if (!reqId) return;
        const key = String(chapterId);
        if (win.__waka_playlist_cache__[key]) { emit('__waka_playlist_result__', { reqId, playlistUrl: win.__waka_playlist_cache__[key] }); return; }
        const cache = getChapterCache(key) || {};
        if (cache.playlistUrl) { storePlaylistUrl(key, cache.playlistUrl, false); emit('__waka_playlist_result__', { reqId, playlistUrl: cache.playlistUrl }); return; }
        try {
          let pu = null;
          if (cache.apiUrl) {
            const r = await nativeFetch(cache.apiUrl, { method:'GET', mode:'cors', credentials:'omit', referrer:'https://waka.vn/' });
            if (!r.ok) throw new Error('HTTP '+r.status);
            const json = await r.json();
            if (json.code !== 0) throw new Error('code='+json.code);
            pu = findPlaylistUrl(json.data?.data ?? json.data ?? null);
          } else {
            const params = new URLSearchParams({ audio_file_id: String(chapterId) });
            const r = await nativeFetch('https://beta-api.waka.vn/fm/getDownloadItem?'+params, { method:'GET', mode:'cors', credentials:'omit', referrer:'https://waka.vn/' });
            if (!r.ok) throw new Error('HTTP '+r.status);
            const json = await r.json();
            pu = findPlaylistUrl(json.data?.data ?? json.data ?? null);
          }
          if (pu) storePlaylistUrl(key, pu, true);
          emit('__waka_playlist_result__', { reqId, playlistUrl: pu });
        } catch(err) {
          emit('__waka_playlist_result__', { reqId, playlistUrl: null, error: err.message });
        }
      });

      console.log('[Waka DL] Audio interceptor ready.');
    }

    // ── EBOOK INTERCEPTOR (/ebook/*) ─────────────────────────────────
    if (isEbook) {
      const API_BASE     = 'beta-api.waka.vn';
      const ITEM_INFO_RE = /getItemInfo\?/;
      const DOWNLOAD_RE  = /getDownloadItemWeb\?/;
      let _capturedParams = null, _downloadCalled = false;

      function emit(type, detail) { win.dispatchEvent(new CustomEvent(type, { detail })); }
      function parseQuery(url) {
        try { const u = new URL(url.startsWith('http') ? url : 'https://'+url); const o={}; u.searchParams.forEach((v,k)=>o[k]=v); return o; }
        catch { return {}; }
      }
      function extractDownloadUrl(text) {
        try {
          const json = JSON.parse(text);
          const candidates = [json?.data?.download_url, json?.data?.url, json?.data?.epub_url, json?.data?.file_url, json?.data?.link, json?.download_url, json?.url, json?.epub_url, json?.file_url, json?.link];
          for (const c of candidates) if (typeof c==='string' && c.startsWith('http')) return c;
          const m = text.match(/"(https?:\/\/[^"]*(?:epub|book|download)[^"]*)"/i);
          return m ? m[1] : null;
        } catch { return null; }
      }

      async function callDownloadApi(params) {
        if (_downloadCalled) return;
        _downloadCalled = true;
        const qs = new URLSearchParams({ os: params.os||'wap', id: params.id, account: params.account||'guest', item_id: params.item_id, content_type: params.content_type||'book', rf: location.href, secure_code: params.secure_code });
        emit('__waka_ebook_status__', { msg: `Đang lấy link download... (item_id=${params.item_id})` });
        try {
          const r = await fetch(`https://${API_BASE}/super/getDownloadItemWeb?${qs}`, { credentials: 'omit' });
          const text = await r.text();
          const url = extractDownloadUrl(text);
          if (url) emit('__waka_ebook_ready__', { url, itemId: params.item_id });
          else emit('__waka_ebook_status__', { msg: `API trả về (${r.status}): ${text.slice(0,200)}`, isError: true });
        } catch(err) {
          emit('__waka_ebook_status__', { msg: `Lỗi: ${err.message}`, isError: true });
          _downloadCalled = false;
        }
      }

      function handleResponse(url, text) {
        if (!url.includes(API_BASE)) return;
        if (ITEM_INFO_RE.test(url) && !_capturedParams) {
          const p = parseQuery(url);
          if (p.item_id && p.secure_code) {
            _capturedParams = p;
            emit('__waka_ebook_status__', { msg: `Phát hiện sách ID=${p.item_id}. Đang lấy link...` });
            callDownloadApi(p);
          }
        }
        if (DOWNLOAD_RE.test(url)) {
          const u = extractDownloadUrl(text);
          if (u) emit('__waka_ebook_ready__', { url: u });
          else emit('__waka_ebook_raw__', { raw: text });
        }
      }

      const NativeXHR = win.XMLHttpRequest;
      function PatchedXHR() {
        const xhr = new NativeXHR(); let _url = '';
        const _open = xhr.open.bind(xhr);
        xhr.open = function(m, url) { _url = typeof url==='string'?url:''; return _open.apply(xhr, arguments); };
        xhr.addEventListener('readystatechange', function() { if (xhr.readyState===4) handleResponse(_url, xhr.responseText||''); });
        return xhr;
      }
      Object.setPrototypeOf(PatchedXHR, NativeXHR);
      Object.setPrototypeOf(PatchedXHR.prototype, NativeXHR.prototype);
      win.XMLHttpRequest = PatchedXHR;

      const nativeFetch = win.fetch;
      win.fetch = async function(input, init) {
        const url = typeof input==='string'?input:input instanceof Request?input.url:String(input);
        const resp = await nativeFetch(input, init);
        if (url.includes(API_BASE)) resp.clone().text().then(t => handleResponse(url, t)).catch(()=>{});
        return resp;
      };

      console.log('[Waka DL] Ebook interceptor ready.');
    }

    // ── READER INTERCEPTOR (/reader/*) ────────────────────────────────
    if (isReader) {
      function emit(type, detail) { win.dispatchEvent(new CustomEvent(type, { detail })); }
      function resolveUrl(href, base) {
        if (/^https?:\/\//.test(href)) return href;
        try { return new URL(href, base).href; } catch { return base.replace(/\/$/, '') + '/' + href; }
      }

      function tryReadNuxt() {
        try {
          const nuxt = win.__NUXT__;
          if (!nuxt) return false;
          const raw = JSON.stringify(nuxt);
          const m = raw.match(/"epub_url"\s*:\s*"(https?:[^"]+)"/);
          if (!m) return false;
          const url = m[1].replace(/\\u002F/g, '/');
          const tm = raw.match(/"title"\s*:\s*"([^"]+)"/);
          emit('__waka_epub_found__', { url, title: tm ? tm[1] : (document.title || 'Ebook') });
          return true;
        } catch { return false; }
      }
      if (!tryReadNuxt()) [300,800,1500,3000].forEach(ms => setTimeout(tryReadNuxt, ms));

      win.addEventListener('__waka_do_download__', async (e) => {
        try { await fetchAllEpubFiles(e.detail.opfUrl); }
        catch(err) { emit('__waka_epub_error__', { msg: err.message }); }
      });

      async function fetchAllEpubFiles(opfUrl) {
        const [opfPath, qs] = opfUrl.split('?');
        const token = qs ? '?'+qs : '';
        const oebpsDir = opfPath.slice(0, opfPath.lastIndexOf('/')+1);

        emit('__waka_epub_progress__', { msg: 'Tải content.opf...' });
        let opfResp = await fetch(opfUrl, { credentials: 'omit' });
        if (!opfResp.ok) opfResp = await fetch(opfUrl, { credentials: 'include' });
        if (!opfResp.ok) throw new Error('content.opf HTTP '+opfResp.status);
        const opfText = await opfResp.text();
        if (!opfText.includes('<manifest')) throw new Error('OPF không hợp lệ');
        emit('__waka_epub_opf__', { text: opfText, oebpsDir });

        const parser = new DOMParser();
        const doc = parser.parseFromString(opfText, 'application/xml');
        const items = [];
        doc.querySelectorAll('manifest item').forEach(el => {
          const href = el.getAttribute('href');
          if (href) items.push({ href, type: el.getAttribute('media-type')||'' });
        });
        emit('__waka_epub_progress__', { msg: `${items.length} files...`, total: items.length, done: 0 });

        const jsItems = items.filter(i => i.href.includes('/js/jquery0') || /jquery\d+\.js/.test(i.href));
        const contentItems = items.filter(i => !jsItems.includes(i));

        const decryptScripts = {};
        for (const item of jsItems) {
          try {
            const url = resolveUrl(item.href, oebpsDir) + token;
            let r = await fetch(url, { credentials: 'omit' });
            if (!r.ok) r = await fetch(url, { credentials: 'include' });
            if (r.ok) {
              const text = new TextDecoder().decode(await r.arrayBuffer());
              decryptScripts[item.href] = text;
              emit('__waka_decrypt_script__', { href: item.href, script: text });
            }
          } catch {}
        }

        let done = 0, failed = 0;
        const BATCH = 5;
        for (let i = 0; i < contentItems.length; i += BATCH) {
          await Promise.all(contentItems.slice(i, i+BATCH).map(async (item) => {
            const url = resolveUrl(item.href, oebpsDir) + token;
            try {
              let r = await fetch(url, { credentials: 'omit' });
              if (!r.ok) r = await fetch(url, { credentials: 'include' });
              if (!r.ok) {
                if (item.href.includes('toc.ncx') || r.status===404) return;
                throw new Error('HTTP '+r.status);
              }
              let buf = await r.arrayBuffer();
              if (/\.(x?html?)$/i.test(item.href)) {
                const text = new TextDecoder().decode(buf);
                if (WakaEpubDecode.looksEncrypted(text)) {
                  try { buf = new TextEncoder().encode(WakaEpubDecode.decodeWrapped(text)).buffer; } catch {}
                }
              }
              emit('__waka_epub_file__', { href: item.href, buffer: buf });
              done++;
            } catch { failed++; }
            emit('__waka_epub_progress__', { msg: `${done+failed}/${contentItems.length} — OK:${done} Lỗi:${failed}`, done, failed, total: contentItems.length });
          }));
        }
        emit('__waka_epub_done__', { done, failed, total: contentItems.length });
      }

      console.log('[Waka DL] Reader interceptor ready.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CONTENT SCRIPTS — chạy ở document-idle (waitForDom)
  // ═══════════════════════════════════════════════════════════════════

  function waitForDom(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // ────────────────────────────────────────────────────────────────
  //  AUDIO CONTENT  (/sach-noi/*)
  // ────────────────────────────────────────────────────────────────
  function runAudioContent() {
    const CHAPTER_KEY = 'waka.audio.chapterList';
    let detectedPlaylistUrl = null;
    let chapterListPayload = loadStoredChapterList();
    let hasFullChapterList = !!(chapterListPayload?.source === 'getListAudioFile');
    let isDownloading = false;
    let isDownloadingAll = false;
    let mutationTimer = null;

    function loadStoredChapterList() {
      try { const r = localStorage.getItem(CHAPTER_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
    }
    function persistChapterList(p) { try { localStorage.setItem(CHAPTER_KEY, JSON.stringify(p)); } catch {} }

    window.addEventListener('__waka_stream__', (e) => {
      const url = e.detail?.playlistUrl;
      if (!url) return;
      detectedPlaylistUrl = url;
      const btn = document.getElementById('waka-dl-btn');
      if (btn) activateAudioButton(btn);
    });

    window.addEventListener('__waka_audio_chapters__', (e) => {
      const p = e.detail;
      if (!p || !Array.isArray(p.items)) return;
      chapterListPayload = p; persistChapterList(p); updateChapterButtonState();
    });

    window.addEventListener('__waka_audio_list_ready__', (e) => {
      const p = e.detail;
      if (!p || !Array.isArray(p.items)) return;
      hasFullChapterList = true; chapterListPayload = p; persistChapterList(p);
      updateChapterButtonState(); ensureChapterButtonVisible();
      ensureDownloadAllButton();
    });

    function createAudioButton() {
      const btn = document.createElement('button');
      btn.id = 'waka-dl-btn';
      applyAudioButtonStyle(btn, false);
      btn.addEventListener('click', handleDownloadClick);
      return btn;
    }

    function applyAudioButtonStyle(btn, active) {
      btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:${active?'#e94560':'#555'};color:#fff;border:none;border-radius:24px;font-size:13px;font-weight:600;cursor:${active?'pointer':'default'};margin:6px 0 6px 10px;transition:background .25s,opacity .2s;opacity:${active?'1':'0.6'};flex-shrink:0;`;
      btn.title = active ? 'Tải audio về (MP3)' : 'Nhấn Nghe trước để phát hiện audio';
      btn.innerHTML = '⬇ Download MP3';
    }

    function activateAudioButton(btn) {
      applyAudioButtonStyle(btn, true);
      btn.addEventListener('mouseenter', () => btn.style.opacity='0.82');
      btn.addEventListener('mouseleave', () => btn.style.opacity='1');
    }

    function shouldShowChapterButton() {
      return hasFullChapterList && chapterListPayload?.items?.length > 0;
    }

    function updateChapterButtonState() {
      const btn = document.getElementById('waka-dl-chapters-btn');
      if (btn) btn.style.opacity = shouldShowChapterButton() ? '1' : '0.6';
    }

    function ensureChapterButtonVisible() {
      if (!document.getElementById('waka-dl-chapters-btn')) injectButtons();
    }

    let _pendingPlaylist = {};
    let _reqIdCounter = 0;

    function fetchPlaylistUrl(contentId, chapterId) {
      return new Promise((resolve, reject) => {
        const reqId = 'req_' + (++_reqIdCounter) + '_' + Date.now();
        const timeout = setTimeout(() => {
          delete _pendingPlaylist[reqId];
          reject(new Error('Timeout lấy playlist URL'));
        }, 30000);

        _pendingPlaylist[reqId] = { resolve, reject, timeout };
        window.dispatchEvent(new CustomEvent('__waka_fetch_playlist__', { detail: { reqId, contentId, chapterId, action: null } }));
      });
    }

    window.addEventListener('__waka_playlist_result__', (e) => {
      const { reqId, playlistUrl, error } = e.detail || {};
      const pending = _pendingPlaylist[reqId];
      if (!pending) return;
      clearTimeout(pending.timeout);
      delete _pendingPlaylist[reqId];
      if (error || !playlistUrl) pending.reject(new Error(error || 'Không có playlist URL'));
      else pending.resolve(playlistUrl);
    });

    async function handleDownloadClick() {
      if (!detectedPlaylistUrl) { alert('Chưa phát hiện stream. Hãy nhấn Nghe trước!'); return; }
      if (isDownloading) { alert('Đang tải...'); return; }
      isDownloading = true;

      const btn = document.getElementById('waka-dl-btn');
      if (btn) { btn.innerHTML = '⏳ Đang tải...'; btn.style.background = '#888'; }

      HLSDownloader.setCallbacks(
        (c,t,m) => { if (btn) btn.innerHTML = `⏳ ${c}/${t}`; },
        (m) => { if (btn) btn.title = m; }
      );

      try {
        const aacData = await HLSDownloader.downloadAll(detectedPlaylistUrl);
        const audioCtx = new AudioContext();
        MP3Encoder.setCallbacks(m => { if (btn) btn.title = m; }, null);
        const { blob, ext } = await MP3Encoder.encode(aacData, audioCtx);
        const title = document.title.replace(/\s*-\s*Waka.*$/i,'').trim() || 'audio';
        triggerDownload(blob, title + '.' + ext);
        if (btn) { btn.innerHTML = '✅ Đã tải!'; btn.style.background = '#28a745'; }
      } catch(err) {
        alert('Lỗi tải audio: ' + err.message);
        if (btn) { applyAudioButtonStyle(btn, !!detectedPlaylistUrl); btn.innerHTML = '⬇ Download MP3'; }
      }
      isDownloading = false;
    }

    function triggerDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename, style: 'display:none' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    function showToast(msg, color='#4caf7d') {
      let toast = document.getElementById('waka-dl-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'waka-dl-toast';
        toast.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:2147483647;background:#4caf7d;color:#fff;font-size:12px;font-weight:600;padding:8px 18px;border-radius:20px;pointer-events:none;opacity:0;transition:opacity .25s;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);';
        document.body.appendChild(toast);
      }
      toast.textContent = msg; toast.style.background = color; toast.style.opacity = '1';
      clearTimeout(toast._t); toast._t = setTimeout(() => toast.style.opacity='0', 3000);
    }

    function injectButtons() {
      const selectors = ['.player-controls', '.audio-controls', '[class*="player"]', '[class*="control"]'];
      let anchor = null;
      for (const s of selectors) { anchor = document.querySelector(s); if (anchor) break; }
      if (!anchor) return false;

      if (!document.getElementById('waka-dl-btn')) {
        const btn = createAudioButton();
        if (detectedPlaylistUrl) activateAudioButton(btn);
        anchor.appendChild(btn);
      }
      return true;
    }

    function showAllOverlay() {
      document.getElementById('waka-dl-all-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'waka-dl-all-overlay';
      overlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;background:#0f0f11;border:1px solid #2a2a35;border-radius:12px;padding:20px;min-width:360px;max-width:480px;font-family:system-ui,sans-serif;color:#f0ede8;box-shadow:0 16px 48px rgba(0,0,0,.7);';
      overlay.innerHTML = `
        <div style="font-weight:700;font-size:14px;margin-bottom:12px;">⬇ Tải tất cả chương</div>
        <div id="wdl-all-chapter" style="font-size:12px;color:#aaa;margin-bottom:8px;"></div>
        <div style="background:#1a1a1f;border-radius:6px;height:8px;margin-bottom:8px;overflow:hidden;">
          <div id="wdl-all-bar" style="height:100%;background:#e94560;width:0%;transition:width .3s;"></div>
        </div>
        <div id="wdl-all-log" style="font-size:11px;max-height:120px;overflow-y:auto;background:#0a0a0c;border-radius:6px;padding:8px;margin-bottom:8px;scrollbar-width:thin;"></div>
        <button id="wdl-all-stop" style="padding:6px 16px;background:#e94560;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Dừng</button>
      `;
      document.body.appendChild(overlay);
      document.getElementById('wdl-all-stop').onclick = () => { window.__waka_dl_all_stop__ = true; };
    }

    function updateAllOverlay({ chapterName, chapterIdx, chapterTotal, segCur, segTotal, logLine }) {
      const el = document.getElementById('wdl-all-chapter');
      const bar = document.getElementById('wdl-all-bar');
      const log = document.getElementById('wdl-all-log');
      if (el && chapterName) el.textContent = chapterName;
      if (bar && chapterTotal) bar.style.width = Math.round(((chapterIdx||0)/chapterTotal)*100)+'%';
      if (log && logLine) {
        const p = document.createElement('div');
        p.textContent = logLine;
        log.appendChild(p);
        log.scrollTop = log.scrollHeight;
      }
    }

    async function handleDownloadAllClick() {
      if (isDownloadingAll) { alert('Đang tải tất cả!'); return; }
      if (!shouldShowChapterButton() || !chapterListPayload) { alert('Chưa có danh sách chương.'); return; }

      const items = [...(chapterListPayload.items||[])].sort((a,b) => {
        const ao=Number(a.order??0),bo=Number(b.order??0);
        return ao!==bo?ao-bo:Number(a.id??0)-Number(b.id??0);
      });
      const contentId = chapterListPayload.content_id;
      if (!contentId) { alert('Không tìm thấy content_id.'); return; }

      isDownloadingAll = true;
      showAllOverlay();
      window.__waka_dl_all_stop__ = false;

      let success=0, fail=0;
      for (let i=0; i<items.length; i++) {
        if (window.__waka_dl_all_stop__) { updateAllOverlay({ chapterName: '⛔ Đã dừng', chapterIdx: i, chapterTotal: items.length }); break; }
        const item = items[i];
        updateAllOverlay({ chapterName: `[${String(i+1).padStart(2,'0')}/${items.length}] ${item.name}`, chapterIdx: i, chapterTotal: items.length, segCur:0, segTotal:0 });
        try {
          const pu = await fetchPlaylistUrl(contentId, item.id);
          if (!pu) throw new Error('Không lấy được playlist URL');
          const aacData = await HLSDownloader.downloadAll(pu);
          const ctx = new AudioContext();
          const { blob, ext } = await MP3Encoder.encode(aacData, ctx);
          const pad3 = String(i+1).padStart(3,'0');
          const safe = (item.name||`ch_${item.id}`).replace(/[<>:"/\\|?*]/g,'').trim().replace(/\s+/g,'_');
          triggerDownload(blob, `${pad3}_${safe}.${ext}`);
          updateAllOverlay({ logLine: `✅ ${pad3}_${safe}.${ext}`, chapterIdx: i+1, chapterTotal: items.length });
          success++;
        } catch(err) {
          updateAllOverlay({ logLine: `❌ [${item.name}] ${err.message}`, chapterIdx: i+1, chapterTotal: items.length });
          fail++;
        }
        if (i < items.length-1 && !window.__waka_dl_all_stop__) await new Promise(r => setTimeout(r, 1200));
      }
      updateAllOverlay({ chapterName: `Xong! ✅ ${success} thành công, ❌ ${fail} lỗi`, chapterIdx: items.length, chapterTotal: items.length });
      isDownloadingAll = false;
    }

    function ensureDownloadAllButton() {
      if (document.getElementById('waka-dl-all-btn')) return;
      if (!shouldShowChapterButton()) return;
      const anchor = document.getElementById('waka-dl-btn')?.parentElement;
      if (!anchor) return;
      const btn = document.createElement('button');
      btn.id = 'waka-dl-all-btn';
      btn.innerHTML = '⬇ Tải tất cả';
      btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#7c3aed;color:#fff;border:none;border-radius:24px;font-size:13px;font-weight:600;cursor:pointer;margin:6px 0 6px 10px;flex-shrink:0;';
      btn.addEventListener('click', handleDownloadAllClick);
      anchor.appendChild(btn);
    }

    // MutationObserver inject buttons
    let injected = false;
    const obs = new MutationObserver(() => {
      if (!injected) { injected = injectButtons(); }
      if (injected && !document.getElementById('waka-dl-btn')) { injected = false; }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { if (!injected) injectButtons(); }, 1500);
    setTimeout(() => { if (shouldShowChapterButton()) ensureDownloadAllButton(); }, 500);
  }

  // ────────────────────────────────────────────────────────────────
  //  EBOOK CONTENT  (/ebook/*)
  // ────────────────────────────────────────────────────────────────
  function runEbookContent() {
    let _downloadUrl = null;
    let _isBusy = false;

    function isOpfUrl(url) { return /\/content\.opf(\?|$)/i.test(String(url||'')); }

    function extractDownloadUrl(text) {
      if (!text) return null;
      try {
        const json = JSON.parse(text);
        const candidates = [json?.data?.download_url, json?.data?.url, json?.data?.epub_url, json?.data?.file_url, json?.data?.link, json?.download_url, json?.url, json?.epub_url, json?.file_url, json?.link];
        for (const c of candidates) if (typeof c==='string' && /^https?:\/\//i.test(c)) return c;
      } catch {}
      const pats = [/"(https?:\/\/[^"]*(?:epub|book|download)[^"]*)"/i, /"(?:download_url|epub_url|file_url|link|url)"\s*:\s*"(https?:\/\/[^"]+)"/i];
      for (const p of pats) { const m = text.match(p); if (m?.[1]) return m[1].replace(/\\\//g,'/'); }
      return null;
    }

    function resolveUrl(href, base) {
      if (/^https?:\/\//i.test(href)) return href;
      try { return new URL(href, base).href; }
      catch { return base.replace(/\/$/, '') + '/' + href; }
    }

    async function fetchWithFallback(url) {
      let r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (!r.ok) r = await fetch(url, { credentials: 'include', cache: 'no-store' });
      return r;
    }

    function triggerDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename, style: 'display:none' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    function safeName(s) { return String(s||'waka-ebook').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().replace(/\s+/g,'_').slice(0,100); }

    function getBookTitle() {
      const h1 = document.querySelector('h1');
      if (h1) return h1.textContent.trim();
      const og = document.querySelector('meta[property="og:title"]');
      return og ? og.content.replace(/\s*-\s*Waka.*$/i,'').trim() : (document.title || 'waka-ebook');
    }

    function showToast(msg, isErr=false) {
      let t = document.getElementById('wdl-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'wdl-toast';
        t.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:2147483647;font-size:12px;font-weight:600;padding:8px 18px;border-radius:20px;pointer-events:none;opacity:0;transition:opacity .25s;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);';
        document.body.appendChild(t);
      }
      t.textContent = msg; t.style.background = isErr ? '#e94560' : '#4caf7d'; t.style.color = '#fff';
      t.style.opacity = '1'; clearTimeout(t._t); t._t = setTimeout(()=>t.style.opacity='0', 3500);
    }

    function setStatus(msg, isErr=false) {
      const el = document.getElementById('wdl-ebook-status');
      if (!el) return;
      el.textContent = msg; el.style.color = isErr ? '#f88' : '#aaa';
    }

    async function handleDownloadOpf(url) {
      setStatus('Đang tải OPF manifest...');
      const oebpsDir = url.split('?')[0].slice(0, url.split('?')[0].lastIndexOf('/')+1);
      const token = url.includes('?') ? '?'+url.split('?')[1] : '';

      const opfResp = await fetchWithFallback(url);
      if (!opfResp.ok) throw new Error('content.opf HTTP '+opfResp.status);
      const opfText = await opfResp.text();
      if (!opfText.includes('<manifest')) throw new Error('OPF không hợp lệ');

      const parser = new DOMParser();
      const doc = parser.parseFromString(opfText, 'application/xml');
      const items = [];
      doc.querySelectorAll('manifest item').forEach(el => {
        const href = el.getAttribute('href');
        if (href) items.push({ href, type: el.getAttribute('media-type')||'' });
      });

      setStatus(`Tải ${items.length} files...`);
      const files = new Map();
      let done=0, failed=0;
      const BATCH = 5;
      for (let i=0; i<items.length; i+=BATCH) {
        await Promise.all(items.slice(i,i+BATCH).map(async (item) => {
          const fileUrl = resolveUrl(item.href, oebpsDir) + token;
          try {
            let r = await fetch(fileUrl, { credentials: 'omit', cache: 'no-store' });
            if (!r.ok) r = await fetch(fileUrl, { credentials: 'include', cache: 'no-store' });
            if (!r.ok) { if (r.status===404||item.href.includes('toc.ncx')) return; throw new Error('HTTP '+r.status); }
            let buf = await r.arrayBuffer();
            if (/\.(x?html?)$/i.test(item.href)) {
              const text = new TextDecoder().decode(buf);
              if (WakaEpubDecode.looksEncrypted(text)) {
                try { buf = new TextEncoder().encode(WakaEpubDecode.decodeWrapped(text)).buffer; } catch {}
              }
            }
            files.set(item.href, buf);
            done++;
          } catch { failed++; }
          setStatus(`${done+failed}/${items.length} — OK:${done} Lỗi:${failed}`);
        }));
      }

      setStatus('Đóng gói EPUB...');
      const title = WakaEpubDecode.extractTitleFromOpf(opfText, getBookTitle());
      let blob = await EPUBBuilder.buildFromFiles(title, opfText, files);
      blob = await WakaMetaInjector.injectIntoBlob(blob);
      triggerDownload(blob, safeName(title)+'.epub');
      setStatus('✅ Đã tải EPUB xong!'); showToast('✅ EPUB đã tải!');
    }

    async function handleDownloadDirect(url) {
      setStatus('Đang tải EPUB...');
      const r = await fetchWithFallback(url);
      if (!r.ok) throw new Error('HTTP '+r.status);
      let blob = await r.blob();
      blob = await WakaMetaInjector.injectIntoBlob(blob);
      const title = getBookTitle();
      triggerDownload(blob, safeName(title)+'.epub');
      setStatus('✅ Đã tải EPUB!'); showToast('✅ EPUB đã tải!');
    }

    async function handleDownload() {
      if (_isBusy) { showToast('⏳ Đang xử lý...'); return; }
      if (!_downloadUrl) { showToast('⚠ Chưa phát hiện link EPUB', true); return; }
      _isBusy = true;
      const btn = document.getElementById('wdl-ebook-btn');
      if (btn) { btn.textContent = '⏳ Đang tải...'; btn.disabled = true; }
      try {
        if (isOpfUrl(_downloadUrl)) await handleDownloadOpf(_downloadUrl);
        else await handleDownloadDirect(_downloadUrl);
        if (btn) { btn.textContent = '✅ Đã tải!'; btn.style.background = '#28a745'; }
      } catch(err) {
        setStatus('❌ Lỗi: '+err.message, true); showToast('❌ '+err.message, true);
        if (btn) { btn.textContent = '⬇ Tải EPUB'; btn.disabled = false; btn.style.background = '#e94560'; }
      }
      _isBusy = false;
    }

    window.addEventListener('__waka_ebook_ready__', (e) => {
      _downloadUrl = e.detail?.url;
      const btn = document.getElementById('wdl-ebook-btn');
      if (btn) { btn.textContent = '⬇ Tải EPUB'; btn.disabled = false; btn.style.background = '#e94560'; }
      setStatus('✅ Sẵn sàng tải EPUB!');
    });

    window.addEventListener('__waka_ebook_status__', (e) => {
      setStatus(e.detail?.msg || '', e.detail?.isError);
    });

    function injectEbookPanel() {
      if (document.getElementById('wdl-ebook-panel')) return true;

      // Try to find a good anchor
      const anchor = document.querySelector('h1') || document.querySelector('[class*="book-detail"]') || document.querySelector('[class*="ebook-detail"]') || document.body.firstElementChild;
      if (!anchor) return false;

      const hasMeta = WakaMetaInjector.hasMeta();
      const panel = document.createElement('div');
      panel.id = 'wdl-ebook-panel';
      panel.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0f0f11;border:1px solid #2a2a35;border-radius:12px;padding:14px 16px;font-family:system-ui,sans-serif;font-size:12px;color:#f0ede8;box-shadow:0 8px 32px rgba(0,0,0,.6);min-width:220px;';
      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <div style="background:#e85d26;color:#fff;font-weight:700;width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">W</div>
          <div style="font-size:13px;font-weight:600;">Waka Downloader</div>
          <button id="wdl-ebook-close" style="margin-left:auto;background:none;border:none;color:#888;font-size:14px;cursor:pointer;padding:0 2px;">✕</button>
        </div>
        <div id="wdl-ebook-status" style="color:#aaa;font-size:11px;margin-bottom:8px;min-height:16px;">Đang chờ phát hiện link EPUB...</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="wdl-ebook-btn" disabled style="flex:1;padding:8px 12px;background:#555;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:default;">⬇ Tải EPUB</button>
        </div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <button id="wdl-meta-detect-btn" style="flex:1;padding:6px 10px;background:#1a1a2e;border:1px solid #2a2a45;color:#aaa;border-radius:7px;font-size:11px;cursor:pointer;">🔍 Nhận diện metadata</button>
          ${hasMeta ? '<button id="wdl-meta-clear-btn" style="padding:6px 10px;background:#1a1a2e;border:1px solid #2a2a45;color:#f87;border-radius:7px;font-size:11px;cursor:pointer;">🗑 Xoá meta</button>' : ''}
        </div>
        ${hasMeta ? `<div style="margin-top:6px;font-size:10px;color:#4caf7d;">✅ Metadata đã lưu sẵn — sẽ nhúng vào EPUB</div>` : ''}
      `;
      document.body.appendChild(panel);

      document.getElementById('wdl-ebook-close').onclick = () => panel.remove();
      document.getElementById('wdl-ebook-btn').onclick = handleDownload;
      document.getElementById('wdl-meta-detect-btn').onclick = () => {
        const meta = extractMetadata();
        showMetaPopup(meta);
      };
      const clearBtn = document.getElementById('wdl-meta-clear-btn');
      if (clearBtn) clearBtn.onclick = () => {
        WakaMetaInjector.clearMeta();
        clearBtn.textContent = '✅ Đã xoá';
        setTimeout(() => location.reload(), 800);
      };
      return true;
    }

    // ── METADATA EXTRACT (book-metadata.js logic) ────────────────────
    function readNuxtData() {
      try {
        const nuxt = window.__NUXT__;
        if (!nuxt?.data?.[0]) return null;
        const d = nuxt.data[0];
        const info = d.ebookInfo || d.bookInfo || d.book || null;
        if (!info) return null;
        function decodeHtml(html) { if (!html) return ''; const el = document.createElement('div'); el.innerHTML = html; return (el.innerText||el.textContent||'').trim(); }
        const r = { title: info.title||'', authors:[], publisher:'', pubdate:'', pubdate_raw:'', tags:[], comments: decodeHtml(info.description||''), language:'vi', cover:'', source_url: location.href };
        if (info.authors_json) { try { const arr=JSON.parse(info.authors_json); r.authors=arr.map(a=>a.name||a).filter(Boolean); } catch {} }
        if (!r.authors.length) { const raw=info.author_name||info.author||''; if(raw) r.authors=raw.split(/\s*[&,]\s*/).map(a=>a.trim()).filter(Boolean); }
        if (Array.isArray(info.publishing_houses)&&info.publishing_houses.length) r.publisher=info.publishing_houses[0].name||'';
        if (!r.publisher) r.publisher=info.publisher_name||info.publisher||'';
        const tagRaw=info.category_name||info.genre||info.category||'';
        if(tagRaw) r.tags=tagRaw.split(/\s*[,;]\s*/).map(t=>t.trim()).filter(Boolean);
        const dateRaw=info.published_time||info.publish_date||info.published_date||'';
        r.pubdate_raw=dateRaw;
        if(dateRaw){ const m=dateRaw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if(m) r.pubdate=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
        r.cover=info.image_url||info.thumbnail||info.cover_url||info.img||'';
        if(!r.cover&&info.id) r.cover=`https://307a0e78.vws.vegacdn.vn/view/v2/image/img.book/0/0/1/${info.id}.jpg?v=1&w=480&h=700`;
        return r;
      } catch { return null; }
    }

    function extractMetadata() {
      const nuxt = readNuxtData();
      const meta = {};
      const h1El = document.querySelector('h1.text-white-50');
      if (h1El) meta.title = h1El.textContent.trim();
      else if (nuxt?.title) meta.title = nuxt.title;
      else { const og=document.querySelector('meta[property="og:title"]'); meta.title=(og?og.content:document.title).replace(/\s*-\s*[^-]+$/,'').trim(); }

      meta.authors = [];
      document.querySelectorAll('.el-select-dropdown__item.selected a').forEach(a => { if((a.getAttribute('href')||'').includes('/author/')) { const n=a.textContent.trim(); if(n&&!meta.authors.includes(n)) meta.authors.push(n); } });
      if (!meta.authors.length) {
        document.querySelectorAll('p.text-white-400').forEach(label => {
          if(label.textContent.trim()==='Tác giả'){
            const pd=label.closest('div');
            if(pd){ pd.querySelectorAll('a').forEach(a=>{const n=a.textContent.trim();if(n&&!meta.authors.includes(n))meta.authors.push(n);}); }
          }
        });
      }
      if (!meta.authors.length && nuxt?.authors?.length) meta.authors=nuxt.authors;

      const labels=document.querySelectorAll('p.text-white-400');
      labels.forEach(label=>{
        const text=label.textContent.trim(); const pd=label.closest('div'); const valEl=pd?.querySelector('p.text-white-50');
        if(text==='Nhà xuất bản'&&valEl){const v=valEl.textContent.trim();if(v&&v!=='Đang cập nhật')meta.publisher=v;}
        if(text==='Phát hành'&&valEl){const raw=valEl.textContent.trim();meta.pubdate_raw=raw;const parts=raw.split('/');if(parts.length===3)meta.pubdate=`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;}
        if(text==='Dịch giả'&&valEl)meta.translator=valEl.textContent.trim();
      });
      if(!meta.publisher&&nuxt?.publisher)meta.publisher=nuxt.publisher;

      meta.tags=[];
      document.querySelectorAll('.el-select-dropdown__item.selected a').forEach(a=>{if((a.getAttribute('href')||'').includes('/ebook/')){const t=a.textContent.trim();if(t&&!meta.tags.includes(t))meta.tags.push(t);}});
      if(!meta.tags.length)labels.forEach(l=>{if(l.textContent.trim()==='Thể loại')l.closest('div')?.querySelectorAll('a').forEach(a=>{const t=a.textContent.trim();if(t&&!meta.tags.includes(t))meta.tags.push(t);});});
      if(!meta.tags.length&&nuxt?.tags?.length)meta.tags=nuxt.tags;

      const descEl=document.querySelector('.check-des')||document.querySelector('.text-16.text-white-50.text-justify');
      if(descEl)meta.comments=descEl.innerText.trim().replace(/\s*Rút gọn\s*$/i,'').trim();
      else if(nuxt?.comments)meta.comments=nuxt.comments;
      else{const og=document.querySelector('meta[property="og:description"]');if(og)meta.comments=og.content.trim();}

      const coverImg=document.querySelector('div.pt-full-265-388 img');
      if(coverImg)meta.cover=coverImg.src.replace(/&amp;/g,'&');
      else if(nuxt?.cover)meta.cover=nuxt.cover;
      else{const og=document.querySelector('meta[property="og:image"]');if(og)meta.cover=og.content.replace(/&amp;/g,'&');}

      meta.language=document.documentElement.lang||'vi';
      meta.source_url=location.href;
      return meta;
    }

    function showMetaPopup(meta) {
      document.getElementById('wdl-meta-popup')?.remove();
      const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const pop=document.createElement('div');
      pop.id='wdl-meta-popup';
      pop.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;width:340px;background:#0f0f11;border:1px solid #2a2a35;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.6);font-family:system-ui,sans-serif;font-size:12px;color:#f0ede8;overflow:hidden;';
      pop.innerHTML=`
        <div style="background:#1a1a1f;padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2a2a35;">
          <div style="background:#e85d26;color:#fff;font-weight:700;font-size:13px;width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;">W</div>
          <div style="font-size:13px;font-weight:600;">Metadata đã nhận diện</div>
          <button id="wdl-meta-close" style="margin-left:auto;background:none;border:none;color:#888;font-size:16px;cursor:pointer;">✕</button>
        </div>
        <div style="display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid #1e1e28;">
          <div style="flex-shrink:0;">${meta.cover?`<img src="${esc(meta.cover)}" style="width:60px;height:86px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'">`:'<div style="width:60px;height:86px;background:#1a1a1f;border:1px solid #2a2a35;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:22px;">📖</div>'}</div>
          <div>
            <div style="font-weight:700;font-size:13px;line-height:1.4;margin-bottom:4px;">${esc(meta.title)||'—'}</div>
            <div style="color:#f07040;font-size:11px;">${esc((meta.authors||[]).join(', '))||'Không rõ tác giả'}</div>
          </div>
        </div>
        <div style="padding:8px 14px;border-bottom:1px solid #1e1e28;">
          <div style="display:flex;gap:6px;padding:4px 0;"><div style="width:90px;flex-shrink:0;color:#888;font-size:11px;">Thể loại</div><div style="flex:1;font-size:11px;">${meta.tags?.length?meta.tags.map(t=>`<span style="display:inline-block;background:#2a1a10;border:1px solid #e85d26;color:#f07040;border-radius:4px;padding:1px 6px;font-size:10px;margin:1px 2px 1px 0;">${esc(t)}</span>`).join(''):'—'}</div></div>
          ${meta.translator?`<div style="display:flex;gap:6px;padding:4px 0;"><div style="width:90px;flex-shrink:0;color:#888;font-size:11px;">Dịch giả</div><div style="flex:1;font-size:11px;">${esc(meta.translator)}</div></div>`:''}
          <div style="display:flex;gap:6px;padding:4px 0;"><div style="width:90px;flex-shrink:0;color:#888;font-size:11px;">Ngôn ngữ</div><div style="flex:1;font-size:11px;">${esc(meta.language||'vi')}</div></div>
        </div>
        ${meta.comments?`<div style="padding:8px 14px;border-bottom:1px solid #1e1e28;"><div style="color:#888;font-size:10px;margin-bottom:4px;">Giới thiệu</div><div style="font-size:11px;line-height:1.6;max-height:80px;overflow-y:auto;color:#d0cdc8;">${esc(meta.comments)}</div></div>`:''}
        <div style="padding:10px 14px;display:flex;gap:8px;">
          <button id="wdl-meta-save" style="flex:1;padding:9px 0;background:#e85d26;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">💾 Lưu vào bộ nhớ</button>
          <button id="wdl-meta-copy" style="padding:9px 12px;background:#1a1a1f;border:1px solid #2a2a35;color:#ccc;border-radius:7px;font-size:12px;cursor:pointer;" title="Copy JSON">📋</button>
        </div>
        <div id="wdl-meta-save-status" style="padding:0 14px 10px;font-size:11px;color:#888;display:none;"></div>
      `;
      document.body.appendChild(pop);
      pop.querySelector('#wdl-meta-close').onclick = () => pop.remove();
      pop.querySelector('#wdl-meta-save').onclick = () => {
        WakaStorage.saveMetadata(meta);
        const el = pop.querySelector('#wdl-meta-save-status');
        if(el){el.textContent='✅ Đã lưu! Sẽ nhúng vào EPUB khi tải.';el.style.color='#4caf7d';el.style.display='block';}
        showToast('✅ Metadata đã lưu!');
        setTimeout(()=>location.reload(),1500);
      };
      pop.querySelector('#wdl-meta-copy').onclick = () => {
        try { GM_setClipboard(JSON.stringify(meta, null, 2)); showToast('✅ Đã copy JSON!'); }
        catch { showToast('⚠ Không copy được', true); }
      };
    }

    function showToast(msg, isErr=false) {
      let t = document.getElementById('wdl-toast');
      if (!t) { t=document.createElement('div'); t.id='wdl-toast'; t.style.cssText='position:fixed;bottom:80px;right:20px;z-index:2147483647;font-size:12px;font-weight:600;padding:8px 18px;border-radius:20px;pointer-events:none;opacity:0;transition:opacity .25s;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);'; document.body.appendChild(t); }
      t.textContent=msg; t.style.background=isErr?'#e94560':'#4caf7d'; t.style.color='#fff';
      t.style.opacity='1'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.opacity='0',3500);
    }

    let injected=false;
    function tryInject() { if(!injected&&document.body) { injected=injectEbookPanel(); } }
    const obs=new MutationObserver(tryInject);
    obs.observe(document.documentElement, {childList:true,subtree:true});
    setTimeout(tryInject, 800); setTimeout(tryInject, 2000); setTimeout(tryInject, 4000);

    // SPA navigation
    const _orig=history.pushState.bind(history);
    history.pushState=function(...args){_orig(...args);injected=false;setTimeout(tryInject,600);};
    window.addEventListener('popstate',()=>{injected=false;setTimeout(tryInject,600);});
  }

  // ────────────────────────────────────────────────────────────────
  //  READER CONTENT  (/reader/*)
  // ────────────────────────────────────────────────────────────────
  function runReaderContent() {
    let _epubUrl=null, _title='Ebook', _opfText=null;
    const _files=new Map();
    let _isBusy=false, _isWaiting=false;

    window.addEventListener('__waka_epub_found__', (e)=>{
      _epubUrl=e.detail.url; _title=e.detail.title||'Ebook';
      activateBtn(); setStatus('Sẵn sàng, nhấn nút để tải!');
    });
    window.addEventListener('__waka_epub_opf__', (e)=>{ _opfText=e.detail.text; });
    window.addEventListener('__waka_epub_file__', (e)=>{ _files.set(e.detail.href, e.detail.buffer); });
    window.addEventListener('__waka_epub_progress__', (e)=>{
      setStatus(e.detail.msg||'');
      const btn=document.getElementById('wdl-btn');
      if(btn&&_isWaiting){ const d=e.detail.done||0,f=e.detail.failed||0,t=e.detail.total||0; btn.textContent=t>0?`⏳ ${d+f}/${t}`:'⏳ Đang tải...'; }
    });
    window.addEventListener('__waka_epub_done__', async (e)=>{
      const {done,failed}=e.detail; _isWaiting=false;
      if(done===0&&failed>0){setStatus(`${failed} file bị từ chối (403)`);resetBtn();_isBusy=false;return;}
      setStatus(`Đóng gói ${done} files thành EPUB...`);
      await buildAndDownload();
    });
    window.addEventListener('__waka_epub_error__', (e)=>{
      _isWaiting=false; _isBusy=false;
      setStatus('Lỗi: '+(e.detail.msg||'?')); showToast('❌ '+e.detail.msg, true); resetBtn();
    });

    function activateBtn() {
      const btn=document.getElementById('wdl-btn');
      if(!btn) return;
      btn.textContent='⬇ Tải EPUB'; btn.disabled=false;
      btn.style.background='#e94560'; btn.style.cursor='pointer';
    }
    function resetBtn() {
      const btn=document.getElementById('wdl-btn');
      if(!btn) return;
      btn.textContent=_epubUrl?'⬇ Thử lại':'⬇ Tải EPUB';
      btn.disabled=!_epubUrl; btn.style.background=_epubUrl?'#e94560':'#555';
    }
    function setStatus(msg) { const el=document.getElementById('wdl-reader-status'); if(el) el.textContent=msg; }
    function showToast(msg,isErr=false) {
      let t=document.getElementById('wdl-toast');
      if(!t){t=document.createElement('div');t.id='wdl-toast';t.style.cssText='position:fixed;bottom:80px;right:20px;z-index:2147483647;font-size:12px;font-weight:600;padding:8px 18px;border-radius:20px;pointer-events:none;opacity:0;transition:opacity .25s;font-family:system-ui,sans-serif;';document.body.appendChild(t);}
      t.textContent=msg;t.style.background=isErr?'#e94560':'#4caf7d';t.style.color='#fff';
      t.style.opacity='1';clearTimeout(t._t);t._t=setTimeout(()=>t.style.opacity='0',3500);
    }

    async function buildAndDownload() {
      try {
        if(!_opfText) throw new Error('Thiếu content.opf');
        const title = WakaEpubDecode.extractTitleFromOpf(_opfText, _title);
        let blob = await EPUBBuilder.buildFromFiles(title, _opfText, _files);
        blob = await WakaMetaInjector.injectIntoBlob(blob);
        const safeName = String(title||'waka').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().replace(/\s+/g,'_').slice(0,100);
        const url=URL.createObjectURL(blob);
        const a=Object.assign(document.createElement('a'),{href:url,download:safeName+'.epub',style:'display:none'});
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url),30000);
        setStatus('✅ EPUB đã tải!');showToast('✅ EPUB đã tải!');
        const btn=document.getElementById('wdl-btn');
        if(btn){btn.textContent='✅ Đã tải!';btn.style.background='#28a745';}
      } catch(err) {
        setStatus('❌ Lỗi: '+err.message);showToast('❌ '+err.message,true);resetBtn();
      }
      _isBusy=false;
    }

    async function handleClick() {
      if(_isBusy){showToast('⏳ Đang xử lý...');return;}
      if(!_epubUrl){showToast('⚠ Chưa phát hiện EPUB',true);return;}
      _isBusy=true; _isWaiting=true; _files.clear(); _opfText=null;
      const btn=document.getElementById('wdl-btn');
      if(btn){btn.textContent='⏳ Đang tải...';btn.disabled=true;}
      window.dispatchEvent(new CustomEvent('__waka_do_download__',{detail:{opfUrl:_epubUrl}}));
    }

    function injectReaderPanel() {
      if(document.getElementById('wdl-reader-panel')) return true;
      if(!document.body) return false;
      const hasMeta = WakaMetaInjector.hasMeta();
      const panel=document.createElement('div');
      panel.id='wdl-reader-panel';
      panel.style.cssText='position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0f0f11;border:1px solid #2a2a35;border-radius:12px;padding:14px 16px;font-family:system-ui,sans-serif;font-size:12px;color:#f0ede8;box-shadow:0 8px 32px rgba(0,0,0,.6);min-width:220px;';
      panel.innerHTML=`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <div style="background:#e85d26;color:#fff;font-weight:700;width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;">W</div>
          <div style="font-size:13px;font-weight:600;">Waka Reader DL</div>
          <button id="wdl-reader-close" style="margin-left:auto;background:none;border:none;color:#888;font-size:14px;cursor:pointer;">✕</button>
        </div>
        <div id="wdl-reader-status" style="color:#aaa;font-size:11px;margin-bottom:8px;min-height:16px;">Đang chờ phát hiện EPUB...</div>
        ${hasMeta?'<div style="font-size:10px;color:#4caf7d;margin-bottom:6px;">✅ Có metadata — sẽ nhúng vào EPUB</div>':''}
        <button id="wdl-btn" disabled style="width:100%;padding:9px;background:#555;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:default;">⬇ Tải EPUB</button>
      `;
      document.body.appendChild(panel);
      document.getElementById('wdl-reader-close').onclick=()=>panel.remove();
      document.getElementById('wdl-btn').onclick=handleClick;
      return true;
    }

    let injected=false;
    function tryInject(){if(!injected&&document.body)injected=injectReaderPanel();}
    const obs=new MutationObserver(tryInject);
    obs.observe(document.documentElement,{childList:true,subtree:true});
    setTimeout(tryInject,500);setTimeout(tryInject,1500);setTimeout(tryInject,3000);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BOOT
  // ═══════════════════════════════════════════════════════════════════

  // Interceptors run at document-start
  installInterceptors();

  // Content UI runs after DOM
  waitForDom(() => {
    if (isSachNoi) runAudioContent();
    else if (isEbook) runEbookContent();
    else if (isReader) runReaderContent();
  });

})();
