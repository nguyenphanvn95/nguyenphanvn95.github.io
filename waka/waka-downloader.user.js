// ==UserScript==
// @name         Waka Downloader Vip
// @namespace    https://nguyenphanvn95.github.io/waka/
// @version      4.1.3
// @description  Tải sách nói (MP3) và ebook (EPUB) từ Waka.vn – nhận diện & nhúng metadata, tự mở rộng mô tả
// @author       nguyenphanvn95
// @match        https://waka.vn/sach-noi/*
// @match        https://waka.vn/ebook/*
// @match        https://waka.vn/reader/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      waka.vn
// @connect      vegacdn.vn
// @connect      307a0e78.vws.vegacdn.vn
// @connect      beta-api.waka.vn
// @connect      store.waka.vn
// @run-at       document-start
// @require      https://nguyenphanvn95.github.io/waka/lib/lame.min.js
// @require      https://nguyenphanvn95.github.io/waka/lib/jszip.min.js
// @require      https://nguyenphanvn95.github.io/waka/lib/crypto-js.min.js
// @downloadURL  https://nguyenphanvn95.github.io/waka/waka-downloader.user.js
// @updateURL    https://nguyenphanvn95.github.io/waka/waka-downloader.user.js
// ==/UserScript==

/**
 * Waka Downloader Vip v4.1.3
 *
 * FIX v4.1.3: JSZip/CryptoJS từ @require chỉ available trong userscript scope
 * (không phải window) khi dùng @grant. Toàn bộ EPUBBuilder, WakaEpubDecode,
 * injectMetaIntoBlob đều dùng trực tiếp JSZip/CryptoJS từ closure scope,
 * không qua window.JSZip hay window.CryptoJS.
 */

(function () {
  'use strict';

  // JSZip và CryptoJS đã được @require inject vào closure scope này
  // Kiểm tra sớm để báo lỗi rõ ràng
  if (typeof JSZip === 'undefined') {
    console.error('[Waka DL] JSZip chưa được load! Kiểm tra @require.');
  }
  if (typeof CryptoJS === 'undefined') {
    console.error('[Waka DL] CryptoJS chưa được load! Kiểm tra @require.');
  }

  const PATH      = window.location.pathname;
  const IS_AUDIO  = /\/sach-noi\//i.test(PATH);
  const IS_EBOOK  = /\/ebook\//i.test(PATH);
  const IS_READER = /\/reader\//i.test(PATH);

  if (!IS_AUDIO && !IS_EBOOK && !IS_READER) return;

  // ══════════════════════════════════════════════════════════════════════════
  // GM STORAGE
  // ══════════════════════════════════════════════════════════════════════════
  const MetaStorage = {
    KEY: 'wakaMetadata',
    save(meta)  { GM_setValue(this.KEY, JSON.stringify(meta)); },
    load()      { try { const r = GM_getValue(this.KEY, null); return r ? JSON.parse(r) : null; } catch { return null; } },
    clear()     { GM_deleteValue(this.KEY); },
    has()       { const m = this.load(); return !!(m && m.title); },
  };

  // ══════════════════════════════════════════════════════════════════════════
  // INJECT VÀO MAIN WORLD (cho interceptors)
  // ══════════════════════════════════════════════════════════════════════════
  function injectToMainWorld(fn) {
    const s = document.createElement('script');
    s.textContent = '(' + fn.toString() + ')();';
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FETCH ẢNH BÌA qua GM (bypass CORS)
  // ══════════════════════════════════════════════════════════════════════════
  function fetchImageBuffer(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      GM_xmlhttpRequest({
        method: 'GET', url,
        responseType: 'arraybuffer',
        onload:  (r) => resolve(r.status === 200 ? r.response : null),
        onerror: ()  => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // XML / MIME HELPERS
  // ══════════════════════════════════════════════════════════════════════════
  function xmlEsc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function guessMime(url) {
    if (/\.png(\?|$)/i.test(url))  return 'image/png';
    if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
    return 'image/jpeg';
  }
  function mimeToExt(mime) {
    return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WAKA EPUB DECODE — dùng CryptoJS từ closure (không qua window)
  // ══════════════════════════════════════════════════════════════════════════
  const WakaEpubDecode = (() => {
    function toText(input) {
      if (typeof input === 'string') return input;
      if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
      if (ArrayBuffer.isView(input)) return new TextDecoder().decode(input);
      return String(input ?? '');
    }
    function isWrappedJson(t) {
      const s = String(t || '').trim();
      return s.startsWith('{') && s.includes('"cd"') && s.includes('"wd"');
    }
    function decodeWrappedJson(text) {
      const raw = String(text ?? '').trim();
      if (!isWrappedJson(raw)) return raw;
      if (typeof CryptoJS === 'undefined') {
        console.error('[WakaEpubDecode] CryptoJS not available');
        return raw;
      }
      const d = JSON.parse(raw);
      if (!d.wd || !d.cd || !d.sw || !d.sd) return raw;
      const key = CryptoJS.enc.Utf8.parse(String(d.wd) + 'a|w8' + String(d.sw) + String(d.sd));
      const ct  = CryptoJS.enc.Base64.parse(String(d.cd));
      const dec = CryptoJS.AES.decrypt({ ciphertext: ct }, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 });
      const plain = dec.toString(CryptoJS.enc.Utf8);
      if (!plain) throw new Error('Decode failed: empty plaintext');
      return plain;
    }
    function decodeFileSync(input) { return decodeWrappedJson(toText(input)); }
    function extractTitleFromOpf(opfText, fallback) {
      const m = String(opfText || '').match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
      if (!m) return fallback || 'waka-ebook';
      return m[1].replace(/<[^>]+>/g, '').trim() || fallback || 'waka-ebook';
    }
    function safeName(s) { return String(s || 'waka-ebook').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, '_').slice(0, 100); }
    function normalizeFileName(name) { return String(name || '').replace(/^\/+/, ''); }
    return { toText, decodeFileSync, extractTitleFromOpf, safeName, normalizeFileName };
  })();

  // ══════════════════════════════════════════════════════════════════════════
  // EPUB BUILDER — dùng JSZip từ closure (không qua window)
  // ══════════════════════════════════════════════════════════════════════════
  const EPUBBuilder = (() => {
    function xe(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function normName(name) { return String(name || '').replace(/^\/+/, ''); }
    function addFile(folder, name, content) { const s = normName(name); if (!s) return; folder.file(s, content); }
    function containerXml() {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`;
    }
    function defaultCss() { return 'body{font-family:"Times New Roman",Georgia,serif;font-size:1em;line-height:1.7;margin:1em 1.5em;color:#1a1a1a;}h1,h2,h3{line-height:1.3;margin:1em 0 .5em;}p{margin:.5em 0;text-indent:1.5em;}img{max-width:100%;}'; }
    function extractNavEntries(tocXhtml) {
      const entries = [], re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
      while ((m = re.exec(tocXhtml))) {
        const href = m[1].trim(), title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (href && title) entries.push({ href, title });
      }
      return entries;
    }
    function generateNcx(bookTitle, tocXhtml, baseDir, fallback) {
      const entries = extractNavEntries(tocXhtml).map(i => ({ href: (baseDir || '') + i.href.replace(/^\/+/, ''), title: i.title }));
      const list = entries.length > 0 ? entries : (fallback || []);
      const navPoints = list.map((item, i) => `  <navPoint id="np${i}" playOrder="${i + 1}">\n    <navLabel><text>${xe(item.title || String(item.href || '').split('/').pop())}</text></navLabel>\n    <content src="${xe(item.href || item)}"/>\n  </navPoint>`).join('\n');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="waka-book"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>\n  <docTitle><text>${xe(bookTitle)}</text></docTitle>\n  <navMap>\n${navPoints}\n  </navMap>\n</ncx>`;
    }
    async function buildFromFiles(bookTitle, opfText, files) {
      if (!opfText || !String(opfText).trim()) throw new Error('content.opf is missing');
      if (typeof JSZip === 'undefined') throw new Error('JSZip không available! Kiểm tra @require.');

      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      zip.file('META-INF/container.xml', containerXml());
      const oebps = zip.folder('OEBPS');
      addFile(oebps, 'content.opf', opfText);

      const entries = files instanceof Map ? Array.from(files.entries())
                    : Array.isArray(files) ? files
                    : Object.entries(files || {});

      for (const entry of entries) {
        const href  = Array.isArray(entry) ? entry[0] : entry.href;
        const value = Array.isArray(entry) ? entry[1] : entry.content;
        if (!href || normName(href) === 'content.opf') continue;
        addFile(oebps, href, value);
      }

      // Tạo toc.ncx nếu chưa có
      const hasTocNcx = entries.some(e => normName(Array.isArray(e) ? e[0] : e.href) === 'toc.ncx');
      if (!hasTocNcx) {
        const tocEntry  = entries.find(e => /(^|\/)toc\.xhtml$/i.test(normName(Array.isArray(e) ? e[0] : e.href)));
        const tocHref   = tocEntry ? normName(Array.isArray(tocEntry) ? tocEntry[0] : tocEntry.href) : '';
        const tocBase   = tocHref ? tocHref.replace(/[^/]+$/, '') : '';
        const tocXhtml  = tocEntry ? (Array.isArray(tocEntry) ? tocEntry[1] : tocEntry.content) : '';
        const fallback  = entries.map(e => Array.isArray(e) ? e[0] : e.href)
                                 .filter(h => /\.xhtml?$/i.test(String(h)) && !/(^|\/)toc\.xhtml$/i.test(String(h)))
                                 .map(h => ({ href: normName(h), title: String(h).split('/').pop().replace(/\.xhtml?$/i, '') }));
        addFile(oebps, 'toc.ncx', generateNcx(bookTitle, String(tocXhtml || ''), tocBase, fallback));
      }

      if (!entries.some(e => normName(Array.isArray(e) ? e[0] : e.href) === 'style.css')) {
        addFile(oebps, 'style.css', defaultCss());
      }

      return zip.generateAsync({
        type: 'blob', mimeType: 'application/epub+zip',
        compression: 'DEFLATE', compressionOptions: { level: 6 },
      });
    }
    return { buildFromFiles };
  })();

  // ══════════════════════════════════════════════════════════════════════════
  // METADATA INJECTOR — dùng JSZip từ closure
  // ══════════════════════════════════════════════════════════════════════════
  function findExistingCover(zip, opfText, opfDir) {
    // 1. properties="cover-image"
    const propM = opfText.match(/<item\s[^>]*properties=["'][^"']*cover-image[^"']*["'][^>]*>/i);
    if (propM) {
      const hM = propM[0].match(/href=["']([^"']+)["']/i);
      const iM = propM[0].match(/\bid=["']([^"']+)["']/i);
      const mM = propM[0].match(/media-type=["']([^"']+)["']/i);
      if (hM) return { zipPath: opfDir + hM[1], href: hM[1], mimeType: mM ? mM[1] : 'image/jpeg', itemId: iM ? iM[1] : 'cover-image' };
    }
    // 2. <meta name="cover">
    const metaM = opfText.match(/<meta\s+name=["']cover["']\s+content=["']([^"']+)["']/i)
               || opfText.match(/<meta\s+content=["']([^"']+)["']\s+name=["']cover["']/i);
    if (metaM) {
      const id  = metaM[1];
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const iM  = opfText.match(new RegExp(`<item\\s[^>]*\\bid=["']${esc}["'][^>]*>`, 'i'));
      if (iM) {
        const hM = iM[0].match(/href=["']([^"']+)["']/i);
        const mM = iM[0].match(/media-type=["']([^"']+)["']/i);
        if (hM) return { zipPath: opfDir + hM[1], href: hM[1], mimeType: mM ? mM[1] : 'image/jpeg', itemId: id };
      }
    }
    // 3. Path phổ biến
    for (const rel of ['images/cover.jpg','images/cover.jpeg','images/cover.png','Images/cover.jpg','Images/cover.jpeg','Images/cover.png','cover.jpg','cover.jpeg','cover.png']) {
      const full = opfDir + rel;
      if (zip.file(full)) {
        const mime = /\.png$/i.test(rel) ? 'image/png' : 'image/jpeg';
        const esc  = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const iM   = opfText.match(new RegExp(`<item\\s[^>]*href=["'][^"']*${esc}["'][^>]*>`, 'i'));
        const idM  = iM ? iM[0].match(/\bid=["']([^"']+)["']/i) : null;
        return { zipPath: full, href: rel, mimeType: mime, itemId: idM ? idM[1] : 'cover-image' };
      }
    }
    return null;
  }

  function patchOpf(opfText, meta, coverInfo) {
    const dc = [];
    dc.push(`    <dc:identifier id="uid">waka-${Date.now()}</dc:identifier>`);
    if (meta.title)      dc.push(`    <dc:title>${xmlEsc(meta.title)}</dc:title>`);
    dc.push(`    <dc:language>${xmlEsc(meta.language || 'vi')}</dc:language>`);
    (meta.authors || []).forEach(a => dc.push(`    <dc:creator>${xmlEsc(a)}</dc:creator>`));
    if (meta.publisher)  dc.push(`    <dc:publisher>${xmlEsc(meta.publisher)}</dc:publisher>`);
    if (meta.pubdate)    dc.push(`    <dc:date>${xmlEsc(meta.pubdate)}</dc:date>`);
    if (meta.comments)   dc.push(`    <dc:description>${xmlEsc(meta.comments)}</dc:description>`);
    (meta.tags || []).forEach(t => dc.push(`    <dc:subject>${xmlEsc(t)}</dc:subject>`));
    if (meta.source_url) dc.push(`    <dc:source>${xmlEsc(meta.source_url)}</dc:source>`);
    dc.push(`    <meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta>`);
    if (coverInfo) dc.push(`    <meta name="cover" content="${xmlEsc(coverInfo.itemId)}"/>`);

    let patched = opfText.replace(
      /<metadata[\s\S]*?<\/metadata>/i,
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${dc.join('\n')}\n  </metadata>`
    );

    if (coverInfo) {
      patched = patched.replace(/<item\s[^>]*id=["']wdl-cover-image["'][^>]*\/?\s*>/gi, '');
      const idE   = coverInfo.itemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hrefE = coverInfo.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existRe = new RegExp(`<item\\s[^>]*(?:id=["']${idE}["']|href=["'][^"']*${hrefE}["'])[^>]*/?>`, 'gi');
      const newItem = `<item id="${xmlEsc(coverInfo.itemId)}" href="${xmlEsc(coverInfo.href)}" media-type="${xmlEsc(coverInfo.mimeType)}" properties="cover-image"/>`;
      if (existRe.test(patched)) patched = patched.replace(existRe, newItem);
      else patched = patched.replace(/<manifest>/i, `<manifest>\n    ${newItem}`);
    }
    return patched;
  }

  async function injectMetaIntoBlob(epubBlob) {
    const meta = MetaStorage.load();
    if (!meta || !meta.title) return epubBlob;
    if (typeof JSZip === 'undefined') { console.warn('[injectMeta] JSZip not available'); return epubBlob; }

    const zip = await JSZip.loadAsync(epubBlob);

    let opfPath = null;
    try {
      const cx = await zip.file('META-INF/container.xml').async('text');
      const m  = cx.match(/full-path="([^"]+)"/);
      if (m) opfPath = m[1];
    } catch {}
    if (!opfPath) zip.forEach(p => { if (!opfPath && p.endsWith('.opf')) opfPath = p; });
    if (!opfPath) return epubBlob;

    const opfFile = zip.file(opfPath);
    if (!opfFile) return epubBlob;
    const opfText = await opfFile.async('text');
    const opfDir  = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    const coverBuf = meta.cover ? await fetchImageBuffer(meta.cover) : null;
    let coverInfo  = null;

    if (coverBuf) {
      const mime     = guessMime(meta.cover);
      const ext      = mimeToExt(mime);
      const existing = findExistingCover(zip, opfText, opfDir);
      if (existing) {
        zip.file(existing.zipPath, coverBuf);
        coverInfo = { itemId: existing.itemId, href: existing.href, mimeType: mime };
      } else {
        const newHref = `images/cover.${ext}`;
        zip.file(opfDir + newHref, coverBuf);
        coverInfo = { itemId: 'cover-image', href: newHref, mimeType: mime };
      }
    }

    zip.remove(opfDir + 'wdl-cover.jpg');
    zip.remove('wdl-cover.jpg');
    zip.file(opfPath, patchOpf(opfText, meta, coverInfo));

    return zip.generateAsync({
      type: 'blob', mimeType: 'application/epub+zip',
      compression: 'DEFLATE', compressionOptions: { level: 6 },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HLS PARSER & DOWNLOADER
  // ══════════════════════════════════════════════════════════════════════════
  const HLSParser = (() => {
    function res(rel, base) { if (/^https?:\/\//i.test(rel)) return rel; try { return new URL(rel, base).href; } catch { return base.substring(0, base.lastIndexOf('/') + 1) + rel; } }
    function parseMaster(text, baseUrl) {
      const lines = text.split('\n').map(l => l.trim()); const variants = []; let bw = 0;
      for (const l of lines) { if (l.startsWith('#EXT-X-STREAM-INF:')) { const m = l.match(/BANDWIDTH=(\d+)/i); bw = m ? parseInt(m[1]) : 0; continue; } if (!l.startsWith('#') && l.length > 0 && bw > 0) { variants.push({ url: res(l, baseUrl), bandwidth: bw }); bw = 0; } }
      if (!variants.length) { for (const l of lines) { if (!l.startsWith('#') && l.includes('.m3u8')) return res(l, baseUrl); } return null; }
      return variants[0].url;
    }
    function parseChunk(text, baseUrl) {
      const lines = text.split('\n').map(l => l.trim()); const segs = []; let key = null, seq = 0;
      for (const l of lines) {
        if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { seq = parseInt(l.split(':')[1]) || 0; continue; }
        if (l.startsWith('#EXT-X-KEY:')) { const me = l.match(/METHOD=([^,\s]+)/i); const ur = l.match(/URI="([^"]+)"/i); const iv = l.match(/IV=0x([0-9a-fA-F]+)/i); const method = (me ? me[1] : 'NONE').toUpperCase(); key = method === 'NONE' ? null : { method, uri: ur ? res(ur[1], baseUrl) : null, iv: iv ? iv[1].padStart(32, '0') : null }; continue; }
        if (!l.startsWith('#') && l.length > 0) { segs.push({ url: res(l, baseUrl), keyInfo: key ? { ...key } : null, sequence: seq }); seq++; }
      }
      return segs;
    }
    return { parseMaster, parseChunk, res };
  })();

  const HLSDownloader = (() => {
    let _onP = null, _onS = null;
    function setCallbacks(p, s) { _onP = p; _onS = s; }
    async function fb(url) { const r = await fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }
    async function ft(url) { const r = await fetch(url, { credentials: 'omit', cache: 'no-store', mode: 'cors' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
    const _kc = {};
    async function fk(u) { if (!_kc[u]) _kc[u] = await fb(u); return _kc[u]; }
    function toIV(s) { const iv = new Uint8Array(16); let n = s; for (let i = 15; i >= 0; i--) { iv[i] = n & 0xff; n = Math.floor(n / 256); } return iv; }
    function hIV(h) { return Uint8Array.from(h.padStart(32, '0').match(/../g).map(b => parseInt(b, 16))); }
    async function dec128(enc, key, iv) { const ck = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']); return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, enc); }
    async function downloadAll(pu) {
      if (_onS) _onS('Tải master playlist...');
      const mt = await ft(pu); const cu = HLSParser.parseMaster(mt, pu); if (!cu) throw new Error('Không tìm thấy chunklist');
      if (_onS) _onS('Phân tích chunklist...');
      const ct = await ft(cu); const segs = HLSParser.parseChunk(ct, cu); if (!segs.length) throw new Error('Chunklist rỗng');
      if (_onS) _onS(`${segs.length} segments. Bắt đầu tải...`);
      const bufs = [];
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (_onP) _onP(i, segs.length, `Segment ${i + 1}/${segs.length}`);
        const enc = await fb(s.url);
        if (s.keyInfo?.method === 'AES-128' && s.keyInfo.uri) { const k = await fk(s.keyInfo.uri); const iv = s.keyInfo.iv ? hIV(s.keyInfo.iv) : toIV(s.sequence); bufs.push(new Uint8Array(await dec128(enc, k, iv))); }
        else { bufs.push(new Uint8Array(enc)); }
      }
      if (_onP) _onP(segs.length, segs.length, 'Ghép audio...');
      const total = bufs.reduce((s, b) => s + b.length, 0), merged = new Uint8Array(total); let off = 0;
      for (const b of bufs) { merged.set(b, off); off += b.length; }
      return merged;
    }
    return { downloadAll, setCallbacks };
  })();

  const MP3Encoder = (() => {
    let _onS = null, _onP = null;
    function setCallbacks(s, p) { _onS = s; _onP = p; }
    function f32i16(f) { const i = new Int16Array(f.length); for (let j = 0; j < f.length; j++) { const c = Math.max(-1, Math.min(1, f[j])); i[j] = c < 0 ? c * 0x8000 : c * 0x7fff; } return i; }
    function concat(arrs) { const t = arrs.reduce((s, a) => s + a.length, 0), o = new Uint8Array(t); let x = 0; for (const a of arrs) { o.set(a, x); x += a.length; } return o; }
    async function encode(aacData, audioCtx) {
      if (!window.lamejs) return { blob: new Blob([aacData], { type: 'audio/aac' }), ext: 'aac' };
      if (_onS) _onS('Giải mã AAC...');
      const buf = await new Promise((res, rej) => audioCtx.decodeAudioData(aacData.buffer.slice(aacData.byteOffset, aacData.byteOffset + aacData.byteLength), res, rej));
      if (_onS) _onS(`Encode MP3... (${buf.duration.toFixed(1)}s)`);
      const ch = buf.numberOfChannels, sr = buf.sampleRate, enc = new lamejs.Mp3Encoder(ch, sr, 128), chunks = [], bs = 1152;
      const L = buf.getChannelData(0), R = ch > 1 ? buf.getChannelData(1) : L;
      for (let i = 0; i < L.length; i += bs) { const l = f32i16(L.subarray(i, i + bs)), r = f32i16(R.subarray(i, i + bs)); const c = ch > 1 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l); if (c.length > 0) chunks.push(new Uint8Array(c)); }
      const fc = enc.flush(); if (fc.length > 0) chunks.push(new Uint8Array(fc));
      return { blob: new Blob([concat(chunks)], { type: 'audio/mpeg' }), ext: 'mp3' };
    }
    return { encode, setCallbacks };
  })();

  // ══════════════════════════════════════════════════════════════════════════
  // INTERCEPTORS (MAIN WORLD) — inject qua script tag
  // ══════════════════════════════════════════════════════════════════════════
  function audioInterceptorMain() {
    'use strict';
    const PL_RE=/vegacdn\.vn\/.+?\/playlist\.m3u8/,LIST_RE=/beta-api\.waka\.vn\/fm\/getListAudioFile\b/,NEXT_RE=/beta-api\.waka\.vn\/fm\/listNextBackFm\b/,DL_RE=/beta-api\.waka\.vn\/fm\/getDownloadItem\b/,SKEY='waka.audio.chapterList';
    function emit(t,d){window.dispatchEvent(new CustomEvent(t,{detail:d}));}
    function sj(t){try{return JSON.parse(t);}catch{return null;}}
    function pq(url){try{const u=new URL(url.startsWith('http')?url:'https://'+url);const o={};u.searchParams.forEach((v,k)=>{o[k]=v;});return o;}catch{return{};}}
    function ni(item,meta){if(!item||typeof item!=='object')return null;const id=item.id??item.audio_file_id??item.chapter_id??null;if(!id)return null;return{id,audio_id:item.audio_id??meta.audio_id??null,name:item.name??'',description:item.description??'',zone:item.zone??'',order:Number(item.order??0),thumb:item.thumb??'',duration:Number(item.duration??0),created_time:item.created_time??'',audio_data:Array.isArray(item.audio_data)?item.audio_data:[],read:item.read??null,is_download:item.is_download??null,parent_price:item.parent_price??null,content_type:item.content_type??'',parent_type:item.parent_type??'',content_detail_url:item.content_detail_url??'',parent_name:item.parent_name??''};}
    function ec(text,url){const j=sj(text);if(!j||j.code!==0)return null;const meta=pq(url);const src=LIST_RE.test(url)?'getListAudioFile':'listNextBackFm';const raw=j.data;const items=(Array.isArray(raw)?raw:raw?[raw]:[]).map(i=>ni(i,meta)).filter(Boolean);if(!items.length)return null;return{source:src,content_id:meta.content_id?Number(meta.content_id):null,chapter_id:meta.chapter_id?Number(meta.chapter_id):null,action:meta.action||null,page_no:meta.page_no?Number(meta.page_no):null,page_size:meta.page_size?Number(meta.page_size):null,total:Number(j.total??items.length),items,updatedAt:new Date().toISOString()};}
    function mc(payload){const cur=window.__waka_audio_chapter_list__||{items:[]};const map=new Map();for(const i of(cur.items||[])){if(i?.id!=null)map.set(String(i.id),i);}for(const i of(payload.items||[])){if(i?.id!=null)map.set(String(i.id),i);}const merged=Array.from(map.values()).sort((a,b)=>{const ao=Number(a.order??0),bo=Number(b.order??0);return ao!==bo?ao-bo:Number(a.id??0)-Number(b.id??0);});const out={...cur,...payload,items:merged,count:merged.length,updatedAt:payload.updatedAt};window.__waka_audio_chapter_list__=out;try{window.localStorage.setItem(SKEY,JSON.stringify(out));}catch{}emit('__waka_audio_chapters__',out);if(payload.source==='getListAudioFile')emit('__waka_audio_list_ready__',out);}
    if(!window.__waka_playlist_cache__)window.__waka_playlist_cache__={};
    if(!window.__waka_chapter_url_cache__)window.__waka_chapter_url_cache__={};
    function gc(id){if(id==null||id==='')return null;const k=String(id);if(!window.__waka_chapter_url_cache__[k])window.__waka_chapter_url_cache__[k]={};return window.__waka_chapter_url_cache__[k];}
    function sp(id,url,em){if(id==null||!url)return;const k=String(id);window.__waka_playlist_cache__[k]=url;const c=gc(k);if(c)c.playlistUrl=url;if(em)emit('__waka_playlist_ready__',{chapterId:k,playlistUrl:url});}
    function cru(url){if(!LIST_RE.test(url)&&!NEXT_RE.test(url)&&!DL_RE.test(url))return;const m=pq(url);const id=m.chapter_id??m.audio_file_id??m.content_id??null;const c=gc(id);if(!c)return;c.apiUrl=url;c.action=m.action||c.action||null;c.content_id=m.content_id?Number(m.content_id):c.content_id??null;c.chapter_id=m.chapter_id?Number(m.chapter_id):c.chapter_id??null;}
    function fpu(obj,depth){if(!obj||typeof obj!=='object'||(depth||0)>5)return null;for(const f of['url','play_url','hls_url','stream_url','file','src','link']){const v=obj[f];if(typeof v==='string'&&v&&(v.includes('.m3u8')||v.includes('vegacdn.vn')))return v;}if(Array.isArray(obj.audio_data)){for(const ad of obj.audio_data){const u=fpu(ad,(depth||0)+1);if(u)return u;}}for(const key of Object.keys(obj)){if(['thumb','raw','avatar','cover','image'].includes(key))continue;const val=obj[key];if(Array.isArray(val)){for(const el of val){if(el&&typeof el==='object'){const u=fpu(el,(depth||0)+1);if(u)return u;}}}else if(val&&typeof val==='object'){const u=fpu(val,(depth||0)+1);if(u)return u;}}return null;}
    function hr(url,text){if(PL_RE.test(url))emit('__waka_stream__',{playlistUrl:url});if(LIST_RE.test(url)||NEXT_RE.test(url)){const p=ec(text,url);if(p)mc(p);}if(DL_RE.test(url)){const j=sj(text);if(j?.code===0){const m=pq(url);const id=m.chapter_id??m.content_id??null;const pu=fpu(j.data?.data??j.data??null);if(pu)sp(id,pu,true);}}}
    const NX=window.XMLHttpRequest;function PX(){const x=new NX();let _u='';const _o=x.open.bind(x);x.open=function(m,u){_u=typeof u==='string'?u:'';cru(_u);return _o.apply(x,arguments);};x.addEventListener('readystatechange',function(){if(x.readyState!==4)return;hr(_u,x.responseText||'');});return x;}Object.setPrototypeOf(PX,NX);Object.setPrototypeOf(PX.prototype,NX.prototype);window.XMLHttpRequest=PX;
    const nF=window.fetch;window.fetch=async function(input,init){const url=typeof input==='string'?input:input instanceof Request?input.url:String(input);cru(url);const resp=await nF(input,init);if(PL_RE.test(url)||LIST_RE.test(url)||NEXT_RE.test(url)||DL_RE.test(url)){const c=resp.clone();c.text().then(t=>hr(url,t)).catch(()=>{});}return resp;};
    const nf2=nF;
    window.addEventListener('__waka_fetch_playlist__',async function(e){const{reqId,contentId,chapterId}=e.detail||{};if(!reqId)return;const k=String(chapterId);const ca=window.__waka_playlist_cache__[k];if(ca){emit('__waka_playlist_result__',{reqId,playlistUrl:ca});return;}const cc=gc(k)||{};if(cc.playlistUrl){sp(k,cc.playlistUrl,false);emit('__waka_playlist_result__',{reqId,playlistUrl:cc.playlistUrl});return;}try{let pu=null;if(cc.apiUrl){const r=await nf2(cc.apiUrl,{method:'GET',mode:'cors',credentials:'omit',referrer:'https://waka.vn/'});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();if(j.code!==0)throw new Error('code='+j.code);pu=fpu(j.data?.data??j.data??null);}else{const params=new URLSearchParams({audio_file_id:String(chapterId)});const r=await nf2('https://beta-api.waka.vn/fm/getDownloadItem?'+params,{method:'GET',mode:'cors',credentials:'omit',referrer:'https://waka.vn/'});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();if(!j||j.code!==0)throw new Error('code='+j?.code);pu=fpu(j.data?.data??j.data??null);}if(pu)sp(k,pu,true);emit('__waka_playlist_result__',{reqId,playlistUrl:pu});}catch(err){emit('__waka_playlist_result__',{reqId,playlistUrl:null,error:err.message});}});
  }

  function ebookInterceptorMain() {
    'use strict';
    const API='beta-api.waka.vn',II=/getItemInfo\?/,DI=/getDownloadItemWeb\?/;let _p=null,_c=false;
    function emit(t,d){window.dispatchEvent(new CustomEvent(t,{detail:d}));}
    function pq(url){try{const u=new URL(url.startsWith('http')?url:'https://'+url);const o={};u.searchParams.forEach((v,k)=>{o[k]=v;});return o;}catch{return{};}}
    function eu(text){try{const j=JSON.parse(text);const cs=[j?.data?.download_url,j?.data?.url,j?.data?.epub_url,j?.data?.file_url,j?.data?.link,j?.download_url,j?.url,j?.epub_url,j?.file_url,j?.link];for(const c of cs){if(typeof c==='string'&&c.startsWith('http'))return c;}const m=text.match(/"(https?:\/\/[^"]*(?:epub|book|download)[^"]*)"/i);return m?m[1]:null;}catch{return null;}}
    async function ca(params){if(_c)return;_c=true;const qs=new URLSearchParams({os:params.os||'wap',id:params.id,account:params.account||'guest',item_id:params.item_id,content_type:params.content_type||'book',rf:window.location.href,secure_code:params.secure_code});const url=`https://${API}/super/getDownloadItemWeb?${qs}`;emit('__waka_ebook_status__',{msg:`Phát hiện sách ID=${params.item_id}. Đang lấy link...`});try{const r=await fetch(url,{credentials:'omit'});const text=await r.text();emit('__waka_ebook_raw__',{raw:text,status:r.status});const dl=eu(text);if(dl)emit('__waka_ebook_ready__',{url:dl,itemId:params.item_id});else emit('__waka_ebook_status__',{msg:`API (${r.status}): ${text.slice(0,200)}`,isError:true});}catch(err){emit('__waka_ebook_status__',{msg:'Lỗi: '+err.message,isError:true});_c=false;}}
    function hr(url,text){if(!url.includes(API))return;if(II.test(url)&&!_p){const p=pq(url);if(p.item_id&&p.secure_code){_p=p;ca(p);}}if(DI.test(url)){const dl=eu(text);if(dl)emit('__waka_ebook_ready__',{url:dl});else emit('__waka_ebook_raw__',{raw:text});}}
    const NX=window.XMLHttpRequest;function PX(){const x=new NX();let _u='';const _o=x.open.bind(x);x.open=function(m,u){_u=typeof u==='string'?u:'';return _o.apply(x,arguments);};x.addEventListener('readystatechange',function(){if(x.readyState!==4)return;hr(_u,x.responseText||'');});return x;}Object.setPrototypeOf(PX,NX);Object.setPrototypeOf(PX.prototype,NX.prototype);window.XMLHttpRequest=PX;
    const nF=window.fetch;window.fetch=async function(input,init){const url=typeof input==='string'?input:input instanceof Request?input.url:String(input);const resp=await nF(input,init);if(url.includes(API)){const c=resp.clone();c.text().then(t=>hr(url,t)).catch(()=>{});}return resp;};
  }

  function readerInterceptorMain() {
    'use strict';
    function emit(t,d){window.dispatchEvent(new CustomEvent(t,{detail:d}));}
    function res(href,base){if(/^https?:\/\//.test(href))return href;try{return new URL(href,base).href;}catch{return base.replace(/\/$/,'')+'/'+href;}}
    function tryNuxt(){try{const n=window.__NUXT__;if(!n)return false;const raw=JSON.stringify(n);const m=raw.match(/"epub_url"\s*:\s*"(https?:[^"]+)"/);if(!m)return false;const url=m[1].replace(/\\u002F/g,'/');const tm=raw.match(/"title"\s*:\s*"([^"]+)"/);emit('__waka_epub_found__',{url,title:tm?tm[1]:document.title});return true;}catch{return false;}}
    if(!tryNuxt())[300,800,1500,3000].forEach(ms=>setTimeout(tryNuxt,ms));
    window.addEventListener('__waka_do_download__',async(e)=>{try{await fetchAll(e.detail.opfUrl);}catch(err){emit('__waka_epub_error__',{msg:err.message});}});
    async function fetchAll(opfUrl){
      const[opfPath,qs]=opfUrl.split('?');const token=qs?'?'+qs:'';const dir=opfPath.slice(0,opfPath.lastIndexOf('/')+1);
      emit('__waka_epub_progress__',{msg:'Tải content.opf...'});
      let r=await fetch(opfUrl,{credentials:'omit'});if(!r.ok)r=await fetch(opfUrl,{credentials:'include'});if(!r.ok)throw new Error('OPF HTTP '+r.status);
      const opfText=await r.text();if(!opfText.includes('<manifest'))throw new Error('OPF không hợp lệ');
      emit('__waka_epub_opf__',{text:opfText,oebpsDir:dir});
      const p=new DOMParser(),doc=p.parseFromString(opfText,'application/xml');
      const items=[];doc.querySelectorAll('manifest item').forEach(el=>{const h=el.getAttribute('href');if(h)items.push({href:h,type:el.getAttribute('media-type')||''});});
      emit('__waka_epub_progress__',{msg:'Phát hiện '+items.length+' files...',total:items.length,done:0});
      let done=0,failed=0;
      for(let i=0;i<items.length;i+=5){
        await Promise.all(items.slice(i,i+5).map(async item=>{
          const url=res(item.href,dir)+token;
          try{let resp=await fetch(url,{credentials:'omit'});if(!resp.ok)resp=await fetch(url,{credentials:'include'});if(!resp.ok){if(item.href.includes('toc.ncx')||resp.status===404)return;throw new Error('HTTP '+resp.status);}const buf=await resp.arrayBuffer();emit('__waka_epub_file__',{href:item.href,buffer:buf});done++;}
          catch(err){failed++;console.warn('[Waka DL]',item.href,err.message);}
          emit('__waka_epub_progress__',{msg:`Tải ${done+failed}/${items.length} — OK:${done} Lỗi:${failed}`,done,failed,total:items.length});
        }));
      }
      emit('__waka_epub_done__',{done,failed,total:items.length});
    }
  }

  // Inject interceptors ngay document-start
  if (IS_AUDIO)  injectToMainWorld(audioInterceptorMain);
  if (IS_EBOOK)  injectToMainWorld(ebookInterceptorMain);
  if (IS_READER) injectToMainWorld(readerInterceptorMain);

  // ══════════════════════════════════════════════════════════════════════════
  // BOOK METADATA — nhận diện + popup + auto-expand
  // ══════════════════════════════════════════════════════════════════════════
  function initBookMetadata() {
    function readNuxt() {
      try {
        const nuxt = unsafeWindow.__NUXT__;
        if (!nuxt?.data?.[0]) return null;
        const info = nuxt.data[0].ebookInfo || nuxt.data[0].bookInfo || nuxt.data[0].book || null;
        if (!info) return null;
        function dh(html) { if (!html) return ''; const el = document.createElement('div'); el.innerHTML = html; return (el.innerText || el.textContent || '').trim(); }
        const r = { title: info.title||'', authors:[], publisher:'', pubdate:'', pubdate_raw:'', tags:[], comments: dh(info.description||''), language:'vi', cover:'', source_url: window.location.href };
        if (info.authors_json) { try { r.authors = JSON.parse(info.authors_json).map(a=>a.name||a).filter(Boolean); } catch {} }
        if (!r.authors.length) { const raw=info.author_name||info.author||''; if(raw) r.authors=raw.split(/\s*[&,]\s*/).map(a=>a.trim()).filter(Boolean); }
        if (Array.isArray(info.publishing_houses)&&info.publishing_houses.length) r.publisher=info.publishing_houses[0].name||'';
        if (!r.publisher) r.publisher=info.publisher_name||info.publisher||'';
        const tagRaw=info.category_name||info.genre||info.category||'';
        if (tagRaw) r.tags=tagRaw.split(/\s*[,;]\s*/).map(t=>t.trim()).filter(Boolean);
        const dateRaw=info.published_time||info.publish_date||info.published_date||'';
        r.pubdate_raw=dateRaw;
        if (dateRaw) { const m=dateRaw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if(m) r.pubdate=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
        r.cover=info.image_url||info.thumbnail||info.cover_url||info.img||'';
        if (!r.cover&&info.id) r.cover=`https://307a0e78.vws.vegacdn.vn/view/v2/image/img.book/0/0/1/${info.id}.jpg?v=1&w=480&h=700`;
        return r;
      } catch { return null; }
    }

    function extractMetadata() {
      const nuxt = readNuxt();
      const meta = {};
      const h1 = document.querySelector('h1.text-white-50');
      meta.title = h1 ? h1.textContent.trim() : (nuxt?.title || document.title.replace(/\s*-\s*Thư viện ebook Waka\s*$/i,'').trim());
      meta.authors = [];
      document.querySelectorAll('.el-select-dropdown__item.selected a').forEach(a => { if((a.getAttribute('href')||'').includes('/author/')){const n=a.textContent.trim();if(n&&!meta.authors.includes(n))meta.authors.push(n);} });
      if (!meta.authors.length) {
        document.querySelectorAll('p.text-white-400').forEach(label => {
          if (label.textContent.trim()==='Tác giả') {
            const div=label.closest('div');
            if(div){div.querySelectorAll('a').forEach(a=>{const n=a.textContent.trim();if(n&&!meta.authors.includes(n))meta.authors.push(n);});if(!meta.authors.length){const p=div.querySelector('p.text-white-50');if(p)p.textContent.trim().split(',').forEach(n=>{const nm=n.trim();if(nm)meta.authors.push(nm);});}}
          }
        });
      }
      if (!meta.authors.length&&nuxt?.authors?.length) meta.authors=nuxt.authors;
      document.querySelectorAll('p.text-white-400').forEach(label => {
        const text=label.textContent.trim(),valEl=label.closest('div')?.querySelector('p.text-white-50');
        if(text==='Nhà xuất bản'&&valEl){const v=valEl.textContent.trim();if(v&&v!=='Đang cập nhật')meta.publisher=v;}
        if(text==='Phát hành'&&valEl){const raw=valEl.textContent.trim();meta.pubdate_raw=raw;const pts=raw.split('/');if(pts.length===3)meta.pubdate=`${pts[2]}-${pts[1].padStart(2,'0')}-${pts[0].padStart(2,'0')}`;}
        if(text==='Dịch giả'&&valEl)meta.translator=valEl.textContent.trim();
      });
      if(!meta.publisher&&nuxt?.publisher)meta.publisher=nuxt.publisher;
      if(!meta.pubdate&&nuxt?.pubdate)meta.pubdate=nuxt.pubdate;
      meta.tags=[];
      document.querySelectorAll('.el-select-dropdown__item.selected a').forEach(a=>{if((a.getAttribute('href')||'').includes('/ebook/')){const t=a.textContent.trim();if(t&&!meta.tags.includes(t))meta.tags.push(t);}});
      if(!meta.tags.length){document.querySelectorAll('p.text-white-400').forEach(label=>{if(label.textContent.trim()==='Thể loại')label.closest('div')?.querySelectorAll('a').forEach(a=>{const t=a.textContent.trim();if(t&&!meta.tags.includes(t))meta.tags.push(t);});});}
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
      meta.source_url=window.location.href;
      return meta;
    }

    function showPopup(meta) {
      document.getElementById('wdl-meta-popup')?.remove();
      document.getElementById('wdl-meta-toast-meta')?.remove();
      const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const pubLine=[meta.publisher,meta.pubdate_raw].filter(Boolean).join(' · ');
      const popup=document.createElement('div');
      popup.id='wdl-meta-popup';
      popup.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;width:340px;background:#0f0f11;border:1px solid #2a2a35;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.6);font-family:"Segoe UI",system-ui,sans-serif;font-size:12px;color:#f0ede8;overflow:hidden;';
      popup.innerHTML=`<div style="background:#1a1a1f;padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2a2a35;"><div style="background:#e85d26;color:#fff;font-weight:700;font-size:13px;width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">W</div><div><div style="font-size:13px;font-weight:600;">Metadata đã nhận diện</div><div style="font-size:10px;color:#888;">waka.vn/ebook/</div></div><button id="wdl-meta-close" style="margin-left:auto;background:none;border:none;color:#888;font-size:16px;cursor:pointer;padding:2px 4px;line-height:1;">✕</button></div><div style="display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid #1e1e28;"><div style="flex-shrink:0;">${meta.cover?`<img src="${esc(meta.cover)}" style="width:60px;height:86px;object-fit:cover;border-radius:4px;border:1px solid #2a2a35;" onerror="this.style.display='none'">`:`<div style="width:60px;height:86px;background:#1a1a1f;border:1px solid #2a2a35;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:22px;">📖</div>`}</div><div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:13px;line-height:1.4;margin-bottom:4px;">${esc(meta.title)||'—'}</div><div style="color:#f07040;font-size:11px;margin-bottom:3px;">${esc((meta.authors||[]).join(', '))||'Không rõ tác giả'}</div><div style="color:#888;font-size:10px;">${esc(pubLine)||'—'}</div></div></div><div style="padding:8px 14px;border-bottom:1px solid #1e1e28;"><div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid #1e1e28;"><div style="width:90px;flex-shrink:0;color:#888;font-size:11px;padding-top:1px;">Thể loại</div><div style="flex:1;font-size:11px;">${meta.tags?.length?meta.tags.map(t=>`<span style="display:inline-block;background:#2a1a10;border:1px solid #e85d26;color:#f07040;border-radius:4px;padding:1px 6px;font-size:10px;margin:1px 2px 1px 0;">${esc(t)}</span>`).join(''):'<span style="color:#555;">—</span>'}</div></div>${meta.translator?`<div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid #1e1e28;"><div style="width:90px;flex-shrink:0;color:#888;font-size:11px;padding-top:1px;">Dịch giả</div><div style="flex:1;font-size:11px;">${esc(meta.translator)}</div></div>`:''}<div style="display:flex;gap:6px;padding:4px 0;"><div style="width:90px;flex-shrink:0;color:#888;font-size:11px;padding-top:1px;">Ngôn ngữ</div><div style="flex:1;font-size:11px;">${esc(meta.language||'vi')}</div></div></div>${meta.comments?`<div style="padding:8px 14px;border-bottom:1px solid #1e1e28;"><div style="color:#888;font-size:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em;">Giới thiệu</div><div style="font-size:11px;line-height:1.6;max-height:80px;overflow-y:auto;color:#d0cdc8;scrollbar-width:thin;">${esc(meta.comments)}</div></div>`:''}<div style="padding:10px 14px;display:flex;gap:8px;"><button id="wdl-meta-save" style="flex:1;padding:9px 0;background:#e85d26;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">💾 Lưu vào bộ nhớ trình duyệt</button><button id="wdl-meta-copy" style="padding:9px 12px;background:#1a1a1f;border:1px solid #2a2a35;color:#ccc;border-radius:7px;font-size:12px;cursor:pointer;" title="Copy JSON">📋</button></div><div id="wdl-meta-status" style="padding:0 14px 10px;font-size:11px;display:none;line-height:1.5;"></div>`;
      document.body.appendChild(popup);
      const toast=document.createElement('div');toast.id='wdl-meta-toast-meta';toast.style.cssText='position:fixed;bottom:80px;right:20px;z-index:2147483647;background:#4caf7d;color:#fff;font-size:12px;font-weight:600;padding:8px 18px;border-radius:20px;pointer-events:none;opacity:0;transition:opacity .25s;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);white-space:nowrap;';
      document.body.appendChild(toast);
      function showToast(msg,color){toast.textContent=msg;toast.style.background=color||'#4caf7d';toast.style.opacity='1';clearTimeout(toast._t);toast._t=setTimeout(()=>{toast.style.opacity='0';},3000);}
      function setStatus(msg,color){const el=document.getElementById('wdl-meta-status');if(!el)return;el.textContent=msg;el.style.color=color||'#888';el.style.display=msg?'block':'none';}
      document.getElementById('wdl-meta-close').onclick=()=>{popup.remove();toast.remove();};
      document.getElementById('wdl-meta-save').onclick=()=>{
        const btn=document.getElementById('wdl-meta-save');btn.disabled=true;btn.textContent='⏳ Đang lưu...';setStatus('Đang lưu metadata...');
        MetaStorage.save(meta);
        setStatus('✅ Đã lưu! Khi tải EPUB, metadata + ảnh bìa sẽ tự động được nhúng vào.','#4caf7d');
        btn.textContent='✅ Đã lưu!';btn.style.background='#28a745';
        refreshMetaBadge();showToast('✅ Metadata đã lưu — sẵn sàng nhúng vào EPUB!');
      };
      document.getElementById('wdl-meta-copy').onclick=()=>{try{GM_setClipboard(JSON.stringify(meta,null,2));showToast('✅ Đã copy JSON!');}catch{showToast('⚠ Không copy được','#e85d26');}};
    }

    function refreshMetaBadge() {
      const hasMeta=MetaStorage.has();
      let badge=document.getElementById('wdl-meta-badge');
      if(hasMeta){
        const meta=MetaStorage.load();
        if(!badge){badge=document.createElement('div');badge.id='wdl-meta-badge';badge.style.cssText='background:#0d1f14;color:#4caf7d;font-size:10px;font-weight:700;padding:3px 10px;border-radius:10px;border:1px solid #1a5c33;cursor:pointer;white-space:nowrap;';badge.title='Nhấn để xóa metadata';badge.onclick=()=>{MetaStorage.clear();badge.remove();};const root=document.getElementById('waka-ebook-root');if(root)root.insertBefore(badge,root.firstChild);}
        badge.textContent=`📚 Meta: ${(meta?.title||'').slice(0,22)}`;
      }else if(badge){badge.remove();}
    }

    function injectDetectButton() {
      if (document.getElementById('wdl-book-detect-btn')) return true;
      const h1=document.querySelector('h1.text-white-50');if(!h1)return false;
      const wrapper=document.createElement('div');wrapper.style.cssText='margin-top:10px;display:inline-flex;align-items:center;gap:8px;';
      const btn=document.createElement('button');btn.id='wdl-book-detect-btn';
      btn.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Nhận diện metadata`;
      btn.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#e85d26;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .15s;';
      btn.onmouseenter=()=>btn.style.opacity='0.85';btn.onmouseleave=()=>btn.style.opacity='1';
      btn.onclick=()=>showPopup(extractMetadata());
      wrapper.appendChild(btn);h1.insertAdjacentElement('afterend',wrapper);
      return true;
    }

    function waitAndInject() {
      document.getElementById('wdl-book-detect-btn')?.closest('div')?.remove();
      if(injectDetectButton())return;
      let done=false;
      const obs=new MutationObserver(()=>{if(done)return;if(injectDetectButton()){done=true;obs.disconnect();}});
      obs.observe(document.documentElement,{childList:true,subtree:true});
      const iv=setInterval(()=>{if(done){clearInterval(iv);return;}if(injectDetectButton()){done=true;clearInterval(iv);obs.disconnect();}},400);
      setTimeout(()=>{if(!done){clearInterval(iv);obs.disconnect();}},15000);
    }

    function autoExpandDescription() {
      function tryExpand(){const btn=document.querySelector('.read-more');if(btn&&btn.offsetParent!==null){btn.click();return true;}return false;}
      if(tryExpand())return;
      let n=0;const iv=setInterval(()=>{n++;if(tryExpand()||n>30)clearInterval(iv);},300);
    }

    function autoClearOnNewPage() {
      if(MetaStorage.has()){MetaStorage.clear();document.getElementById('wdl-meta-badge')?.remove();}
    }

    waitAndInject();autoExpandDescription();autoClearOnNewPage();
    const _op=history.pushState.bind(history);
    history.pushState=function(...args){_op(...args);if(/\/ebook\//i.test(window.location.pathname))setTimeout(()=>{waitAndInject();autoExpandDescription();autoClearOnNewPage();},600);};
    window.addEventListener('popstate',()=>{if(/\/ebook\//i.test(window.location.pathname))setTimeout(()=>{waitAndInject();autoExpandDescription();autoClearOnNewPage();},600);});
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED UI HELPERS
  // ══════════════════════════════════════════════════════════════════════════
  function dlBlob(blob, fname) {
    const u=URL.createObjectURL(blob),a=Object.assign(document.createElement('a'),{href:u,download:fname,style:'display:none'});
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(u),30000);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EBOOK CONTENT UI (/ebook/*)
  // ══════════════════════════════════════════════════════════════════════════
  function initEbookContent() {
    let _dlUrl=null,_isBusy=false;

    function isOpf(url){return /\/content\.opf(\?|$)/i.test(String(url||''));}
    function resolveUrl(href,base){if(/^https?:\/\//i.test(href))return href;try{return new URL(href,base).href;}catch{return base.replace(/\/$/,'')+'/'+href;}}
    async function fetchW(url){let r=await fetch(url,{credentials:'omit',cache:'no-store'});if(!r.ok)r=await fetch(url,{credentials:'include',cache:'no-store'});return r;}
    function getTitle(){return document.querySelector('h1')?.textContent?.trim()||document.title||'waka-ebook';}

    function updateStatus(msg,isErr){const el=document.getElementById('waka-ebook-status');if(el){el.textContent=msg;el.style.color=isErr?'#e94560':'#9ca3af';el.style.display='block';}}
    function setPrimaryLabel(label,enabled){const btn=document.getElementById('waka-ebook-btn');if(btn){btn.innerHTML=label;btn.disabled=!enabled;btn.style.cursor=enabled?'pointer':'default';}}
    function showToast(msg,isErr){
      let t=document.getElementById('waka-ebook-toast');
      if(!t){t=Object.assign(document.createElement('div'),{id:'waka-ebook-toast'});t.style.cssText='position:fixed;bottom:80px;right:20px;background:#111827;color:#f3f4f6;border-radius:12px;padding:12px 18px;font-size:13px;max-width:340px;z-index:2147483647;font-family:system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);transition:opacity .3s;pointer-events:none;line-height:1.5';document.body.appendChild(t);}
      t.style.background=isErr?'#3b1a1a':'#111827';t.textContent=msg;t.style.opacity='1';clearTimeout(t._t);t._t=setTimeout(()=>t.style.opacity='0',5000);
    }

    function refreshBadge(){
      const has=MetaStorage.has();let badge=document.getElementById('wdl-meta-badge');
      if(has){const meta=MetaStorage.load();if(!badge){badge=document.createElement('div');badge.id='wdl-meta-badge';badge.style.cssText='background:#0d1f14;color:#4caf7d;font-size:10px;font-weight:700;padding:3px 10px;border-radius:10px;border:1px solid #1a5c33;cursor:pointer;white-space:nowrap;';badge.title='Nhấn để xóa metadata';badge.onclick=()=>{MetaStorage.clear();badge.remove();};const root=document.getElementById('waka-ebook-root');if(root)root.insertBefore(badge,root.firstChild);}badge.textContent=`📚 Meta: ${(meta?.title||'').slice(0,22)}`;}
      else if(badge)badge.remove();
    }

    async function downloadDirectFile(url) {
      updateStatus('Đang tải file EPUB...');
      const resp=await fetchW(url);if(!resp.ok)throw new Error('HTTP '+resp.status);
      let blob=await resp.blob();
      const ext=url.includes('.pdf')?'pdf':'epub';
      const fname=WakaEpubDecode.safeName(getTitle())+'.'+ext;
      let metaNote='';
      if(ext==='epub'&&MetaStorage.has()){
        updateStatus('📚 Đang nhúng metadata...');
        try{blob=await injectMetaIntoBlob(blob);metaNote=' + metadata';}catch(e){console.warn('[Waka DL] inject error:',e);}
      }
      dlBlob(blob,fname);
      updateStatus(`✅ Đã lưu: ${fname}${metaNote}`);showToast(`✅ ${fname}${metaNote}`);
      setPrimaryLabel('✅ Đã tải',true);
      const btn=document.getElementById('waka-ebook-btn');if(btn)btn.style.background='#28a745';
      if(metaNote){MetaStorage.clear();refreshBadge();}
    }

    async function buildEpubFromOpf(opfUrl) {
      const[opfPath,qs]=opfUrl.split('?'),token=qs?'?'+qs:'';
      const oebpsDir=opfPath.slice(0,opfPath.lastIndexOf('/')+1);
      updateStatus('Tải content.opf...');
      const opfResp=await fetchW(opfUrl);if(!opfResp.ok)throw new Error('OPF HTTP '+opfResp.status);
      const opfText=await opfResp.text();if(!opfText.includes('<manifest'))throw new Error('OPF không hợp lệ');
      const parser=new DOMParser(),doc=parser.parseFromString(opfText,'application/xml');
      const items=[];doc.querySelectorAll('manifest item').forEach(el=>{const h=el.getAttribute('href');if(h)items.push({href:h,type:el.getAttribute('media-type')||''});});
      updateStatus(`Phát hiện ${items.length} file...`);
      const files=new Map();let done=0,failed=0;
      for(let i=0;i<items.length;i+=5){
        await Promise.all(items.slice(i,i+5).map(async(item)=>{
          const fileUrl=resolveUrl(item.href,oebpsDir)+token;
          try{
            let resp=await fetchW(fileUrl);
            if(!resp.ok){if(item.href.includes('toc.ncx')||resp.status===404)return;throw new Error('HTTP '+resp.status);}
            const buf=await resp.arrayBuffer();
            const isText=/\.(xhtml|html?|xml|ncx|css|js|json)$/i.test(item.href);
            files.set(item.href,isText?WakaEpubDecode.decodeFileSync(buf):buf);done++;
          }catch(err){failed++;console.warn('[Waka DL]',item.href,err.message);}
        }));
        updateStatus(`Tải: ${done}/${items.length} · lỗi: ${failed}`);
      }
      if(files.size===0)throw new Error('Không tải được file nào');
      updateStatus(`Đóng gói ${files.size} file...`);

      // BUILD — dùng EPUBBuilder với JSZip từ closure
      const title=WakaEpubDecode.extractTitleFromOpf(opfText,getTitle());
      let blob;
      try {
        blob=await EPUBBuilder.buildFromFiles(title,opfText,files);
      } catch(buildErr) {
        console.error('[Waka DL] buildFromFiles error:', buildErr);
        throw buildErr;
      }

      const fname=`${WakaEpubDecode.safeName(title)}.epub`;
      let metaNote='';
      if(MetaStorage.has()){
        updateStatus('📚 Đang nhúng metadata + ảnh bìa...');
        try{blob=await injectMetaIntoBlob(blob);metaNote=' + metadata';}catch(e){console.warn('[Waka DL] inject error:',e);}
      }
      dlBlob(blob,fname);
      const sizeMb=(blob.size/1024/1024).toFixed(2);
      const msg=`✅ Đã lưu: ${fname}${metaNote} · ${sizeMb}MB · ${files.size} file`;
      updateStatus(msg);showToast(msg);
      setPrimaryLabel('✅ Đã tải',true);
      const btn=document.getElementById('waka-ebook-btn');if(btn)btn.style.background='#28a745';
      if(metaNote){MetaStorage.clear();refreshBadge();}
    }

    async function handleClick() {
      if(_isBusy)return;
      if(!_dlUrl){showToast('Đang tìm link, vui lòng đợi...');return;}
      _isBusy=true;
      setPrimaryLabel('⏳ Đang xử lý...',false);
      const btn=document.getElementById('waka-ebook-btn');if(btn){btn.style.background='#555';btn.style.opacity='0.7';}
      try{
        if(isOpf(_dlUrl))await buildEpubFromOpf(_dlUrl);
        else await downloadDirectFile(_dlUrl);
      }catch(err){
        console.error('[Waka DL]',err);
        updateStatus('❌ '+err.message,true);showToast('❌ '+err.message,true);
        setPrimaryLabel('⬇ Thử lại',true);
        if(btn){btn.style.background='#e94560';btn.style.opacity='1';}
      }finally{_isBusy=false;}
    }

    window.addEventListener('__waka_ebook_ready__',(e)=>{
      _dlUrl=e.detail.url;
      const btn=document.getElementById('waka-ebook-btn');
      if(btn){btn.innerHTML=isOpf(_dlUrl)?'⬇ Tải EPUB (OPF)':'⬇ Tải EPUB';btn.disabled=false;btn.style.cursor='pointer';btn.style.background='#e94560';btn.style.opacity='1';}
      showToast(isOpf(_dlUrl)?'✅ Link OPF sẵn sàng!':'✅ Link EPUB sẵn sàng!');
    });
    window.addEventListener('__waka_ebook_raw__',(e)=>{
      const m=(e.detail.raw||'').match(/"(https?:\/\/[^"]*(?:epub|book|download)[^"]*)"/i);
      if(m){_dlUrl=m[1];const btn=document.getElementById('waka-ebook-btn');if(btn){btn.innerHTML='⬇ Tải EPUB';btn.disabled=false;btn.style.cursor='pointer';btn.style.background='#e94560';btn.style.opacity='1';}showToast('✅ Link EPUB sẵn sàng!');}
      else setPrimaryLabel('🔍 Xem response',true);
    });
    window.addEventListener('__waka_ebook_status__',(e)=>updateStatus(e.detail.msg,e.detail.isError));

    function createUI() {
      if(document.getElementById('waka-ebook-root'))return;
      const root=document.createElement('div');root.id='waka-ebook-root';
      root.style.cssText='position:fixed;bottom:24px;right:20px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif';
      const status=document.createElement('div');status.id='waka-ebook-status';
      status.style.cssText='background:rgba(15,15,25,.92);color:#9ca3af;font-size:11px;padding:4px 12px;border-radius:10px;max-width:280px;text-align:right;line-height:1.5;display:none';
      const btn=document.createElement('button');btn.id='waka-ebook-btn';
      btn.innerHTML='⏳ Đang tìm EPUB...';
      btn.style.cssText='background:#555;color:#fff;border:none;border-radius:28px;padding:11px 22px;font-size:14px;font-weight:700;cursor:default;opacity:.55;box-shadow:0 4px 18px rgba(0,0,0,.4);transition:background .2s,opacity .2s;white-space:nowrap';
      btn.addEventListener('click',handleClick);
      root.appendChild(status);root.appendChild(btn);document.body.appendChild(root);
      refreshBadge();
    }

    if(document.body)createUI();
    else new MutationObserver((_,obs)=>{if(document.body){createUI();obs.disconnect();}}).observe(document.documentElement,{childList:true});
  }

  // ══════════════════════════════════════════════════════════════════════════
  // READER CONTENT UI (/reader/*)
  // ══════════════════════════════════════════════════════════════════════════
  function initReaderContent() {
    let _epubUrl=null,_title='Ebook',_opfText=null,_files=new Map(),_isBusy=false,_isWaiting=false;

    window.addEventListener('__waka_epub_found__',(e)=>{_epubUrl=e.detail.url;_title=e.detail.title||'Ebook';activateBtn();setStatus('Sẵn sàng, nhấn nút để tải!');});
    window.addEventListener('__waka_epub_opf__',(e)=>{_opfText=e.detail.text;});
    window.addEventListener('__waka_epub_file__',(e)=>{_files.set(e.detail.href,e.detail.buffer);});
    window.addEventListener('__waka_epub_progress__',(e)=>{setStatus(e.detail.msg||'');const btn=document.getElementById('wdl-btn');if(btn&&_isWaiting){const d=e.detail.done||0,f=e.detail.failed||0,t=e.detail.total||0;btn.textContent=t>0?`⏳ ${d+f}/${t}`:'⏳ Đang tải...';}});
    window.addEventListener('__waka_epub_done__',async(e)=>{const{done,failed}=e.detail;_isWaiting=false;if(done===0&&failed>0){setStatus(`${failed} file bị từ chối (403)`);const b=document.getElementById('wdl-btn');if(b){b.textContent='⬇ Thử lại';b.disabled=false;b.style.background='#e94560';}_isBusy=false;return;}setStatus(`Giải mã ${done} file...`);await buildAndDownload();});
    window.addEventListener('__waka_epub_error__',(e)=>{_isWaiting=false;_isBusy=false;setStatus('Lỗi: '+(e.detail.msg||''));showToast('Lỗi: '+e.detail.msg,true);const b=document.getElementById('wdl-btn');if(b){b.textContent='⬇ Thử lại';b.disabled=false;b.style.background='#e94560';}});

    async function handleClick(){
      if(_isBusy)return;if(!_epubUrl){showToast('Đang tìm EPUB URL...');return;}
      _isBusy=true;_isWaiting=true;_opfText=null;_files=new Map();
      const btn=document.getElementById('wdl-btn');if(btn){btn.textContent='⏳ Đang tải...';btn.disabled=true;}
      setStatus('Kết nối server...');
      window.dispatchEvent(new CustomEvent('__waka_do_download__',{detail:{opfUrl:_epubUrl}}));
    }

    async function buildAndDownload() {
      try{
        const decodedFiles=new Map();let decodedCount=0;
        for(const[href,buf]of _files){
          if(!buf||buf.byteLength===0)continue;
          const fn=WakaEpubDecode.normalizeFileName(href);
          const isText=/\.(xhtml|html?)$/i.test(fn);
          if(isText){try{decodedFiles.set(fn,WakaEpubDecode.decodeFileSync(buf));decodedCount++;continue;}catch(e){console.warn(fn,e.message);}}
          decodedFiles.set(fn,buf);
        }
        if(decodedFiles.size===0)throw new Error('Không có file nào để đóng gói');

        const title=WakaEpubDecode.extractTitleFromOpf(_opfText,_title||'waka-ebook');
        setStatus(`Đóng gói ${decodedFiles.size} file...`);
        let blob=await EPUBBuilder.buildFromFiles(title,_opfText,decodedFiles);
        const fname=WakaEpubDecode.safeName(title)+'.epub';

        let metaNote='';
        if(MetaStorage.has()){
          setStatus('📚 Đang nhúng metadata + ảnh bìa...');
          try{blob=await injectMetaIntoBlob(blob);metaNote=' + metadata';}catch(e){console.warn(e);}
        }

        dlBlob(blob,fname);
        const size=(blob.size/1024/1024).toFixed(2);
        const msg=`Đã lưu: ${fname}${metaNote} · ${size}MB · ${decodedFiles.size} files (${decodedCount} decoded)`;
        setStatus(msg);showToast(msg);
        const btn=document.getElementById('wdl-btn');if(btn){btn.textContent='✅ Đã tải!';btn.style.background='#059669';btn.disabled=false;}
        if(metaNote)MetaStorage.clear();
      }catch(err){
        console.error('[Waka DL]',err);setStatus('Lỗi: '+err.message);showToast('Lỗi: '+err.message,true);
        const btn=document.getElementById('wdl-btn');if(btn){btn.textContent='⬇ Thử lại';btn.disabled=false;btn.style.background='#e94560';}
      }finally{_isBusy=false;_isWaiting=false;}
    }

    let _tt;
    function showToast(msg,isErr){
      let t=document.getElementById('wdl-reader-toast');
      if(!t){t=Object.assign(document.createElement('div'),{id:'wdl-reader-toast'});t.style.cssText='position:fixed;bottom:80px;right:20px;background:#111827;color:#f3f4f6;border-radius:12px;padding:12px 18px;font-size:13px;max-width:340px;z-index:2147483647;font-family:system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);transition:opacity .3s;pointer-events:none;line-height:1.5';document.body.appendChild(t);}
      t.style.background=isErr?'#3b1a1a':'#111827';t.textContent=msg;t.style.opacity='1';clearTimeout(_tt);_tt=setTimeout(()=>t.style.opacity='0',5000);
    }
    function setStatus(msg){let el=document.getElementById('wdl-status');if(!el)return;el.style.display='block';el.textContent=msg;}
    function activateBtn(){const btn=document.getElementById('wdl-btn');if(!btn)return;btn.textContent='⬇ Tải EPUB';btn.style.background='#e94560';btn.style.opacity='1';btn.style.cursor='pointer';btn.onmouseenter=()=>btn.style.opacity='.82';btn.onmouseleave=()=>btn.style.opacity='1';}

    function createUI(){
      if(document.getElementById('wdl-root'))return;
      const root=document.createElement('div');root.id='wdl-root';
      root.style.cssText='position:fixed;right:20px;bottom:24px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif';
      const status=document.createElement('div');status.id='wdl-status';status.style.cssText='background:rgba(15,15,25,.92);color:#9ca3af;font-size:11px;padding:4px 12px;border-radius:10px;max-width:280px;text-align:right;line-height:1.5;display:none';
      const btn=document.createElement('button');btn.id='wdl-btn';btn.textContent='⏳ Đang tìm EPUB...';
      btn.style.cssText='background:#555;color:#fff;border:none;border-radius:28px;padding:11px 22px;font-size:14px;font-weight:700;cursor:default;opacity:.55;box-shadow:0 4px 18px rgba(0,0,0,.4);transition:background .2s,opacity .2s;white-space:nowrap';
      btn.addEventListener('click',handleClick);
      root.appendChild(status);root.appendChild(btn);document.body.appendChild(root);
    }
    if(document.body)createUI();
    else new MutationObserver((_,obs)=>{if(document.body){createUI();obs.disconnect();}}).observe(document.documentElement,{childList:true});
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUDIO CONTENT UI (/sach-noi/*)
  // ══════════════════════════════════════════════════════════════════════════
  function initAudioContent() {
    const SKEY='waka.audio.chapterList';
    let detectedUrl=null,chapterPayload=loadStored(),hasFullList=!!(chapterPayload?.source==='getListAudioFile'),isDownloading=false,isDownloadingAll=false;
    function loadStored(){try{const r=window.localStorage.getItem(SKEY);if(!r)return null;const p=JSON.parse(r);return(p&&Array.isArray(p.items))?p:null;}catch{return null;}}
    function persist(p){try{window.localStorage.setItem(SKEY,JSON.stringify(p));}catch{}}
    function bookTitle(){return document.querySelector('h1')?.textContent?.trim()||document.title||'waka-audio';}
    function safeF(name){return String(name||'waka-audio').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().replace(/\s+/g,'_').slice(0,100);}

    window.addEventListener('__waka_stream__',(e)=>{const u=e.detail?.playlistUrl;if(!u)return;detectedUrl=u;const btn=document.getElementById('waka-dl-btn');if(btn)activateAudioBtn(btn);});
    window.addEventListener('__waka_audio_chapters__',(e)=>{const p=e.detail;if(!p||!Array.isArray(p.items))return;chapterPayload=p;persist(p);ensureAllBtn();});
    window.addEventListener('__waka_audio_list_ready__',(e)=>{const p=e.detail;if(!p||!Array.isArray(p.items))return;hasFullList=true;chapterPayload=p;persist(p);ensureAllBtn();});

    let _rid=0;const _pend=new Map();
    window.addEventListener('__waka_playlist_result__',(e)=>{const{reqId,playlistUrl,error}=e.detail||{};const p=_pend.get(reqId);if(!p)return;clearTimeout(p.timer);_pend.delete(reqId);if(error&&!playlistUrl)p.reject(new Error(error));else p.resolve(playlistUrl||null);});
    function askPlaylist(contentId,chapterId){return new Promise((res,rej)=>{const id='dlall_'+(++_rid)+'_'+Date.now();const t=setTimeout(()=>{_pend.delete(id);rej(new Error('Timeout 12s'));},12000);_pend.set(id,{resolve:res,reject:rej,timer:t});window.dispatchEvent(new CustomEvent('__waka_fetch_playlist__',{detail:{reqId:id,contentId:String(contentId),chapterId:String(chapterId),action:'current'}}));});}

    function ensureOverlay(){let u=document.getElementById('waka-dl-overlay');if(u)return u;u=document.createElement('div');u.id='waka-dl-overlay';u.style.cssText='position:fixed;bottom:20px;right:20px;width:310px;background:#15151e;color:#e8e8e8;border-radius:14px;padding:18px 20px;box-shadow:0 6px 28px rgba(0,0,0,.5);font-family:system-ui,sans-serif;font-size:13px;z-index:2147483647;display:none';u.innerHTML=`<div style="font-weight:700;font-size:14px;color:#e94560;margin-bottom:10px">Waka Audio Downloader</div><div id="waka-dl-status-text" style="margin-bottom:10px;line-height:1.5">Khởi động...</div><div style="background:#2a2a3a;border-radius:6px;height:7px;overflow:hidden"><div id="waka-dl-bar" style="width:0%;height:100%;background:#e94560;transition:width .4s"></div></div><div style="display:flex;justify-content:space-between;margin-top:6px;color:#888;font-size:11px"><span id="waka-dl-pct">0%</span></div>`;document.body.appendChild(u);return u;}
    function showOverlay(msg){const u=ensureOverlay();document.getElementById('waka-dl-status-text').textContent=msg;document.getElementById('waka-dl-bar').style.width='0%';document.getElementById('waka-dl-pct').textContent='0%';u.style.display='block';}
    function updProg(cur,tot,msg){const p=tot>0?Math.round(cur/tot*100):0;const b=document.getElementById('waka-dl-bar'),pe=document.getElementById('waka-dl-pct'),st=document.getElementById('waka-dl-status-text');if(b)b.style.width=p+'%';if(pe)pe.textContent=p+'%';if(st&&msg)st.textContent=msg;}
    function updStatus(msg){const el=document.getElementById('waka-dl-status-text');if(el)el.textContent=msg;}
    function hideOverlay(ms){setTimeout(()=>{const u=document.getElementById('waka-dl-overlay');if(u)u.style.display='none';},ms);}

    function ensureAllOverlay(){let u=document.getElementById('waka-dl-all-overlay');if(u)return u;u=document.createElement('div');u.id='waka-dl-all-overlay';u.style.cssText='position:fixed;bottom:20px;left:20px;width:360px;background:#0f0f1a;color:#e8e8e8;border-radius:14px;padding:18px 20px;box-shadow:0 6px 28px rgba(0,0,0,.6);font-family:system-ui,sans-serif;font-size:13px;z-index:2147483647;display:none';u.innerHTML=`<div style="font-weight:700;font-size:14px;color:#7c3aed;margin-bottom:10px">Waka – Tải tất cả chương</div><div id="waka-all-cname" style="margin-bottom:4px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Đang chuẩn bị...</div><div id="waka-all-status" style="color:#aaa;font-size:11px;margin-bottom:8px">0/0</div><div style="background:#2a2a3a;border-radius:6px;height:7px;overflow:hidden;margin-bottom:4px"><div id="waka-all-bar" style="width:0%;height:100%;background:#7c3aed;transition:width .3s"></div></div><div style="display:flex;justify-content:space-between;color:#888;font-size:11px;margin-bottom:10px"><span id="waka-all-pct">0%</span><span id="waka-all-count">0/0</span></div><div style="color:#888;font-size:11px;display:flex;justify-content:space-between"><span id="waka-all-seg-txt">Segments: 0/0</span><button id="waka-all-stop-btn" style="background:#e94560;color:#fff;border:none;border-radius:8px;padding:2px 10px;cursor:pointer;font-size:11px">Dừng</button></div><div id="waka-all-log" style="margin-top:10px;max-height:80px;overflow-y:auto;font-size:10px;color:#888;line-height:1.6"></div>`;document.body.appendChild(u);document.getElementById('waka-all-stop-btn').onclick=()=>{window.__waka_dl_all_stop__=true;};return u;}
    function updAll({cname,ci,ct,sc,st,log}){const p=ct>0?Math.round(ci/ct*100):0;const b=document.getElementById('waka-all-bar'),pe=document.getElementById('waka-all-pct'),cnt=document.getElementById('waka-all-count'),sta=document.getElementById('waka-all-status'),nm=document.getElementById('waka-all-cname'),seg=document.getElementById('waka-all-seg-txt'),logEl=document.getElementById('waka-all-log');if(b)b.style.width=p+'%';if(pe)pe.textContent=p+'%';if(cnt)cnt.textContent=`${ci}/${ct}`;if(sta)sta.textContent=`Chương ${ci}/${ct}`;if(cname&&nm)nm.textContent=cname;if(sc!==undefined&&seg)seg.textContent=`Segments: ${sc}/${st}`;if(log&&logEl){const s=document.createElement('div');s.textContent=log;logEl.appendChild(s);logEl.scrollTop=logEl.scrollHeight;}}

    function activateAudioBtn(btn){btn.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#e94560;color:#fff;border:none;border-radius:24px;font-size:13px;font-weight:600;cursor:pointer;margin:6px 0 6px 10px;opacity:1;flex-shrink:0';btn.title='Tải audio về máy (MP3)';btn.innerHTML='Download MP3';btn.onmouseenter=()=>btn.style.opacity='.82';btn.onmouseleave=()=>btn.style.opacity='1';}

    async function handleAudioClick(){
      if(isDownloading)return;if(!detectedUrl){alert('Nhấn "Nghe sách" để phát hiện audio stream rồi thử lại!');return;}
      isDownloading=true;const btn=document.getElementById('waka-dl-btn');if(btn){btn.disabled=true;btn.style.opacity='0.5';btn.innerHTML='Đang tải...';}
      showOverlay('Khởi tạo...');
      const actx=new(window.AudioContext||window.webkitAudioContext)();
      HLSDownloader.setCallbacks((c,t,m)=>updProg(c,t,m),(m)=>updStatus(m));
      MP3Encoder.setCallbacks((m)=>updStatus(m),(p,m)=>updProg(p,100,m));
      try{const aac=await HLSDownloader.downloadAll(detectedUrl);updStatus('Encode MP3...');const{blob,ext}=await MP3Encoder.encode(aac,actx);const fname=`${safeF(bookTitle())}.${ext}`;dlBlob(blob,fname);updStatus(`Đã lưu: ${fname}`);updProg(100,100,`Hoàn tất! ${fname}`);hideOverlay(5000);if(btn){btn.disabled=false;btn.innerHTML='✅ Đã tải';btn.style.opacity='1';btn.style.cursor='pointer';btn.style.background='#28a745';}}
      catch(err){console.error(err);updStatus('Lỗi: '+err.message);if(btn){btn.disabled=false;btn.innerHTML='Thử lại';btn.style.opacity='1';btn.style.cursor='pointer';}}
      finally{isDownloading=false;actx.close();}
    }

    async function handleAllClick(){
      if(isDownloadingAll){alert('Đang tải! Nhấn "Dừng" để hủy.');return;}
      if(!chapterPayload?.items?.length){alert('Chưa có danh sách chương.');return;}
      const items=[...chapterPayload.items].sort((a,b)=>{const ao=Number(a.order??0),bo=Number(b.order??0);return ao!==bo?ao-bo:Number(a.id??0)-Number(b.id??0);});
      const contentId=chapterPayload.content_id;if(!contentId){alert('Không tìm thấy content_id.');return;}
      isDownloadingAll=true;const ui=ensureAllOverlay();window.__waka_dl_all_stop__=false;ui.style.display='block';
      const btn=document.getElementById('waka-dl-all-btn');if(btn){btn.disabled=true;btn.style.opacity='0.5';btn.innerHTML='Đang tải...';}
      let ok=0,fail=0;
      for(let i=0;i<items.length;i++){
        if(window.__waka_dl_all_stop__){updAll({cname:'⛔ Đã dừng',ci:i,ct:items.length});break;}
        const item=items[i];
        updAll({cname:`[${String(i+1).padStart(2,'0')}/${items.length}] ${item.name}`,ci:i,ct:items.length,sc:0,st:0});
        try{
          const cache=window.__waka_playlist_cache__||{};let pu=cache[String(item.id)];
          if(!pu){try{pu=await askPlaylist(contentId,item.id);}catch(e){console.warn(e);}}
          if(!pu)throw new Error('Không lấy được playlist URL');
          async function fb2(u){const r=await fetch(u,{credentials:'omit',cache:'no-store',mode:'cors'});if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();}
          async function ft2(u){const r=await fetch(u,{credentials:'omit',cache:'no-store',mode:'cors'});if(!r.ok)throw new Error('HTTP '+r.status);return r.text();}
          function ru(rel,base){if(/^https?:\/\//i.test(rel))return rel;return new URL(rel,base).href;}
          const mt=await ft2(pu);const lines=mt.split('\n').map(l=>l.trim());let cu=pu,bw=0;
          for(const l of lines){if(l.startsWith('#EXT-X-STREAM-INF:')){bw=1;continue;}if(bw&&!l.startsWith('#')&&l.length){cu=ru(l,pu);bw=0;break;}}
          const ct=await ft2(cu);const clines=ct.split('\n').map(l=>l.trim());
          const segs=[];let key=null,seq=0;
          for(const l of clines){if(l.startsWith('#EXT-X-MEDIA-SEQUENCE:')){seq=parseInt(l.split(':')[1])||0;continue;}if(l.startsWith('#EXT-X-KEY:')){const me=l.match(/METHOD=([^,\s]+)/i)?.[1]?.toUpperCase()??'NONE';if(me==='NONE'){key=null;}else{const ur=l.match(/URI="([^"]+)"/i)?.[1];const iv=l.match(/IV=0x([0-9a-fA-F]+)/i)?.[1]?.padStart(32,'0');key={method:me,uri:ur?ru(ur,cu):null,iv};}continue;}if(!l.startsWith('#')&&l.length){segs.push({url:ru(l,cu),key:key?{...key}:null,seq});seq++;}}
          const kc={};async function gk(u){if(!kc[u]){kc[u]=await fb2(u);}return kc[u];}
          function toIV(s){const iv=new Uint8Array(16);let n=s;for(let i=15;i>=0;i--){iv[i]=n&0xff;n=Math.floor(n/256);}return iv;}
          function hIV(h){return Uint8Array.from(h.padStart(32,'0').match(/../g).map(x=>parseInt(x,16)));}
          const parts=[];
          for(let j=0;j<segs.length;j++){
            updAll({cname:`[${String(i+1).padStart(2,'0')}/${items.length}] ${item.name}`,ci:i,ct:items.length,sc:j+1,st:segs.length});
            const s=segs[j];const enc=await fb2(s.url);
            if(s.key?.method==='AES-128'&&s.key.uri){const k=await gk(s.key.uri);const iv=s.key.iv?hIV(s.key.iv):toIV(s.seq);const ck=await crypto.subtle.importKey('raw',k,{name:'AES-CBC'},false,['decrypt']);const dec=await crypto.subtle.decrypt({name:'AES-CBC',iv},ck,enc);parts.push(new Uint8Array(dec));}
            else{parts.push(new Uint8Array(enc));}
          }
          const total=parts.reduce((s,b)=>s+b.length,0),out=new Uint8Array(total);let off=0;for(const p of parts){out.set(p,off);off+=p.length;}
          const pad=String(i+1).padStart(3,'0');const sn=(item.name||`chapter_${item.id}`).replace(/[<>:"/\\|?*]/g,'').trim().replace(/\s+/g,'_');
          dlBlob(new Blob([out],{type:'audio/aac'}),`${pad}_${sn}.aac`);
          updAll({log:`✅ ${pad}_${sn}.aac`,ci:i+1,ct:items.length});ok++;
        }catch(err){updAll({log:`❌ [${item.name}] ${err.message}`,ci:i+1,ct:items.length});fail++;}
        if(i<items.length-1&&!window.__waka_dl_all_stop__)await new Promise(r=>setTimeout(r,1200));
      }
      updAll({cname:`Xong! ✅ ${ok} / ❌ ${fail}`,ci:items.length,ct:items.length,sc:1,st:1});
      isDownloadingAll=false;setTimeout(()=>{const u=document.getElementById('waka-dl-all-overlay');if(u)u.style.display='none';},10000);
      if(btn){btn.disabled=false;btn.style.opacity='1';btn.innerHTML='Tải tất cả';btn.style.background='#7c3aed';btn.style.cursor='pointer';}
    }

    function injectButtons(){
      let anchor=null;
      for(const el of document.querySelectorAll('button,a,[role="button"]')){const text=(el.textContent||'').replace(/\s+/g,' ').trim();const aria=(el.getAttribute('aria-label')||'');const cls=(el.className||'').toString();if(text.includes('Nghe sách')||text.includes('Nghe audio')||text==='Nghe'||/nghe/i.test(aria)||/play/i.test(aria)||/play/i.test(cls)||!!el.querySelector('img[alt*="play" i],img[src*="icon-play" i]')){anchor=el;break;}}
      if(!anchor)return;
      const host=anchor.parentNode||anchor;
      if(!document.getElementById('waka-dl-btn')){const btn=document.createElement('button');btn.id='waka-dl-btn';btn.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#555;color:#fff;border:none;border-radius:24px;font-size:13px;font-weight:600;cursor:default;margin:6px 0 6px 10px;opacity:0.6;flex-shrink:0';btn.title='Nhấn Nghe sách trước';btn.innerHTML='Download MP3';if(detectedUrl)activateAudioBtn(btn);btn.addEventListener('click',handleAudioClick);host.insertBefore(btn,anchor.nextSibling);}
    }

    function ensureAllBtn(){
      if(!(hasFullList||(chapterPayload?.items?.length>0)))return;
      if(document.getElementById('waka-dl-all-btn'))return;
      const anchor=document.getElementById('waka-dl-btn');if(!anchor)return;
      const btn=document.createElement('button');btn.id='waka-dl-all-btn';btn.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#7c3aed;color:#fff;border:none;border-radius:24px;font-size:13px;font-weight:600;cursor:pointer;margin:6px 0 6px 10px;opacity:1;flex-shrink:0';btn.innerHTML='Tải tất cả';btn.addEventListener('click',handleAllClick);
      anchor.parentNode.insertBefore(btn,anchor.nextSibling);
    }

    let _mu=null;
    const obs=new MutationObserver(()=>{if(_mu)return;_mu=setTimeout(()=>{_mu=null;injectButtons();ensureAllBtn();},250);});
    function init(){if(!/\/sach-noi\//i.test(window.location.pathname))return;injectButtons();ensureAllBtn();obs.observe(document.body,{childList:true,subtree:true});}
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // KHỞI CHẠY
  // ══════════════════════════════════════════════════════════════════════════
  function runAfterDom(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  if (IS_EBOOK) {
    runAfterDom(() => { initEbookContent(); initBookMetadata(); });
  } else if (IS_READER) {
    runAfterDom(initReaderContent);
  } else if (IS_AUDIO) {
    runAfterDom(initAudioContent);
  }

})();
