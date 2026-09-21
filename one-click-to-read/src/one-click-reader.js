/**
 * one-click-reader.js - catalog/home cards -> build EPUB -> open reader.html
 *
 * [userscript] Ban chuyen tu extension Waka Toolkit 6.9.2 sang userscript:
 *  - chrome.runtime.sendMessage (background.js) -> WakaGM (GM_xmlhttpRequest) + WakaHandoff (mo Waka EBook Reader)
 *  - chrome.runtime.getURL(icon) -> icon SVG nhung truc tiep
 *  - phan con lai (tim item_id, ky secure_code, tai OPF/EPUB, nut Doc ngay, an nut goc, lop phu tien trinh) giu nguyen
 *
 * 6.9.1: lop phu tien trinh khi bam "Doc ngay"
 *  - Mobile mode: lop phu xanh ngoc toan man hinh (anh bia + dong trang thai + thanh tien trinh + nut Huy bo)
 *  - Desktop: panel noi tren nen la chinh anh bia (opacity thap)
 *  - Nut "Huy bo": huy tai + dung EPUB, xoa cache link/metadata dang do, dong lop phu
 */
(function () {
  'use strict';

  let GM = null; // API GM_* do userscript chinh truyen vao qua WakaOneClick.start(gm)

  const API_BASE = 'https://beta-api.waka.vn/super/getDownloadItemWeb';
  const CARD_ATTR = 'data-waka-one-click-reader';
  const BUSY_ATTR = 'data-waka-reader-busy';
  const DOWNLOAD_FIELDS = ['account', 'item_id', 'content_type', 'id', 'os'];
  const downloadCache = new Map();
  // Icon "doc" (assets/icons/icon-read.svg) nhung truc tiep: khong bi CSP img-src cua trang chan
  const READ_ICON_SVG = '<svg class="waka-ocr-icon" aria-hidden="true" focusable="false" width="42" height="42" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg"><g filter="url(#waka-ocr-blur)"><path d="M42 21C42 32.598 32.598 42 21 42C9.40202 42 0 32.598 0 21C0 9.40202 9.40202 0 21 0C32.598 0 42 9.40202 42 21Z" fill="#121214" fill-opacity="0.6"/></g><path fill-rule="evenodd" clip-rule="evenodd" d="M22 30.3447C22.3787 30.2581 22.7482 30.1215 23.098 29.9351C24.0862 29.4083 25.2922 28.8378 26.2551 28.5837C27.0335 28.3783 28.0924 28.264 29.0476 28.2043C30.6436 28.1044 32 26.8049 32 25.127V13.9155C32 12.2134 30.4716 11 29 11C27.9312 11 26.3769 11.1634 25.2132 11.5118C24.189 11.8184 23.0491 12.4125 22.1729 12.9195C22.1163 12.9523 22.0586 12.9827 22 13.0108V30.3447ZM20 13.0883C19.9148 13.055 19.8312 13.0168 19.7497 12.9737C18.7511 12.4457 17.4205 11.8103 16.2551 11.5028C15.5249 11.3101 14.5968 11.1023 13.6725 11.0282L13.6725 11.0282C13.4471 11.0101 13.222 11 13 11H13C11.4926 11 10 12.2858 10 13.9801V25.127C10 26.8049 11.3564 28.1044 12.9524 28.2043C13.9076 28.264 14.9665 28.3783 15.7449 28.5837C16.7078 28.8378 17.9138 29.4083 18.902 29.9351C19.2518 30.1215 19.6213 30.2581 20 30.3447V13.0883Z" fill="white"/><defs><filter id="waka-ocr-blur" x="-16" y="-16" width="74" height="74" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feGaussianBlur in="BackgroundImageFix" stdDeviation="8"/><feComposite in2="SourceAlpha" operator="in" result="effect1_backgroundBlur_4990_15993"/><feBlend mode="normal" in="SourceGraphic" in2="effect1_backgroundBlur_4990_15993" result="shape"/></filter></defs></svg>';

  function isEbookUrl(url) {
    try {
      const u = new URL(url, location.href);
      return u.hostname === 'waka.vn'
        && /^\/ebook\/[^/?#]+\.html$/i.test(u.pathname)
        && !/\/(?:hieu-soi|truyen-tranh|sach-noi)\//i.test(u.pathname);
    } catch {
      return false;
    }
  }

  function normalizeUrl(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return String(url || '');
    }
  }

  function cleanTitle(value) {
    if (window.WakaEpubDecode?.cleanTitle) return window.WakaEpubDecode.cleanTitle(value);
    return String(value || '')
      .replace(/^Doc[\s_]*sach[\s_]*[-:_]*/i, '')
      .replace(/\s*[-\u2013\u2014]\s*.*Waka.*$/i, '')
      .trim();
  }

  function safeName(value) {
    if (window.WakaEpubDecode?.safeName) return window.WakaEpubDecode.safeName(value);
    return cleanTitle(value || 'waka-ebook')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 100) || 'waka-ebook';
  }

  function getCardTitle(anchor, img) {
    return cleanTitle(
      img?.alt ||
      anchor?.getAttribute('title') ||
      anchor?.textContent ||
      document.title ||
      'waka-ebook'
    ) || 'waka-ebook';
  }

  function extractItemIdFromCover(url) {
    const raw = String(url || '').replace(/&amp;/g, '&');
    const patterns = [
      /\/img\.book\/(?:\d+\/){3}(\d+)\.(?:jpe?g|png|webp)(?:[?#]|$)/i,
      /\/img\.book\/.*?\/(\d+)\.(?:jpe?g|png|webp)(?:[?#]|$)/i,
      /[?&](?:data|book_id|item_id|content_id)=(\d{3,})\b/i,
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match && Number(match[1]) > 100) return match[1];
    }
    return null;
  }

  function extractItemIdFromHtml(html) {
    const raw = String(html || '').replace(/\\u002F/g, '/').replace(/&amp;/g, '&');
    const patterns = [
      /\/img\.book\/(?:\d+\/){3}(\d+)\.(?:jpe?g|png|webp)(?:[?#]|$)/i,
      /(?:waka:\/\/ebook\.waka\.vn|vwaka:\/\/open)\?[^"']*(?:data|book_id)=(\d{3,})/i,
      /["']al:android:url["'][^>]+content=["'][^"']*(?:data|book_id)=(\d{3,})/i,
      /["']al:ios:url["'][^>]+content=["'][^"']*(?:data|book_id)=(\d{3,})/i,
      /["']book_id["']\s*:\s*(\d{3,})/i,
      /\bbook_id\s*:\s*(\d{3,})\b/i,
      /\bbook_id\s*:\s*([a-z])\b[\s\S]{0,800}?\}\((?:[^)]*,\s*)*(\d{3,})(?:,\s*[^)]*)*\)\s*;?\s*<\/script>/i,
      /["'](?:item_id|content_id)["']\s*:\s*(\d{3,})/i,
      /\b(?:item_id|content_id)\s*:\s*(\d{3,})/i,
      /[?&](?:data|book_id|item_id|content_id)=(\d{3,})\b/i,
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      const value = match && match[2] ? match[2] : match && match[1];
      if (value && Number(value) > 100) return value;
    }
    return null;
  }

  async function fetchItemPageInfo(bookUrl, job) {
    const resp = await fetchWithFallback(bookUrl, job?.signal);
    if (!resp.ok) throw new Error('Khong tai duoc trang sach: HTTP ' + resp.status);
    const html = await resp.text();
    const titleMatch = html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      itemId: extractItemIdFromHtml(html),
      html,
      title: titleMatch ? decodeHtml(titleMatch[1]) : '',
      meta: extractBookMetadataFromHtml(html, bookUrl),
    };
  }

  function decodeHtml(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  }

  function stripHtml(value) {
    const el = document.createElement('div');
    el.innerHTML = String(value || '');
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function firstText(...values) {
    for (const value of values) {
      const text = decodeHtml(value || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  }

  function normalizeArray(value) {
    if (!value) return [];
    const arr = Array.isArray(value) ? value : [value];
    return arr.map((item) => {
      if (typeof item === 'string') return firstText(item);
      if (item && typeof item === 'object') return firstText(item.name, item.title, item.author_name);
      return '';
    }).filter(Boolean);
  }

  function findJsonLdBook(doc) {
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    const queue = [];
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent || '');
        queue.push(parsed);
      } catch {}
    }
    while (queue.length) {
      const item = queue.shift();
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item)) {
        queue.push(...item);
        continue;
      }
      const type = item['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((t) => String(t).toLowerCase() === 'book')) return item;
      if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
      for (const key of ['workExample', 'mainEntity', 'about']) {
        if (item[key] && typeof item[key] === 'object') queue.push(item[key]);
      }
    }
    return null;
  }

  function metaContent(doc, selector) {
    return doc.querySelector(selector)?.getAttribute('content') || '';
  }

  function cleanMetaTitle(value) {
    return cleanTitle(value)
      .replace(/\s*-\s*Thu vien ebook Waka\s*$/i, '')
      .replace(/\s*-\s*Thư viện ebook Waka\s*$/i, '')
      .trim();
  }

  function extractPubDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = raw.match(/(\d{4})/);
    return m ? `${m[1]}-01-01` : '';
  }

  function extractBookMetadataFromHtml(html, bookUrl) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const book = findJsonLdBook(doc) || {};
    const ogTitle = metaContent(doc, 'meta[property="og:title"], meta[name="og:title"], meta[name="title"]');
    const ogDesc = metaContent(doc, 'meta[property="og:description"], meta[name="description"], meta[name="og:description"]');
    const ogImage = metaContent(doc, 'meta[property="og:image"], meta[name="og:image"], meta[property="twitter:image"]');
    const titleEl = doc.querySelector('title')?.textContent || '';
    const image = Array.isArray(book.image) ? book.image[0] : book.image;
    const genre = normalizeArray(book.genre);
    const authors = normalizeArray(book.author || book.authors);
    const publisher = normalizeArray(book.publisher)[0] || firstText(book.publisher?.name);
    const comments = stripHtml(book.description || ogDesc);
    const meta = {
      title: cleanMetaTitle(firstText(book.name, ogTitle, titleEl)),
      authors,
      publisher,
      pubdate: extractPubDate(book.datePublished || book.dateCreated || book.copyrightYear),
      pubdate_raw: firstText(book.datePublished || book.dateCreated || book.copyrightYear),
      tags: genre,
      comments,
      language: doc.documentElement.getAttribute('lang') || 'vi',
      cover: firstText(image, ogImage).replace(/&amp;/g, '&'),
      source_url: book.url || bookUrl,
    };

    if (!meta.authors.length) {
      const title = meta.title;
      const raw = firstText(ogTitle, titleEl);
      if (title && raw.includes(title)) {
        const tail = raw.slice(raw.indexOf(title) + title.length).replace(/^\s*[-\u2013\u2014]\s*/, '');
        const author = tail.replace(/\s*[-\u2013\u2014]\s*.*Waka.*$/i, '').trim();
        if (author && author.length < 80) meta.authors = [author];
      }
    }

    meta.tags = Array.from(new Set((meta.tags || []).filter((tag) => tag && tag.length <= 60)));
    return meta;
  }

  // Metadata giu trong bo nho (WakaMetaInjector.setMeta) thay vi chrome.storage qua background.js
  // Lỗi/treo khi nhúng metadata không được chặn việc đọc sách → giữ nguyên EPUB gốc và đi tiếp.
  async function injectMetadataIntoEpub(blob, meta) {
    if (!meta || !meta.title || !window.WakaMetaInjector?.injectIntoBlob) return blob;
    try {
      WakaMetaInjector.setMeta(meta);
      return await withTimeout(WakaMetaInjector.injectIntoBlob(blob), INJECT_TIMEOUT_MS, 'Nhúng metadata quá thời gian');
    } catch (err) {
      if (err?.isCancel) throw err;
      console.warn('[Waka One Click Reader] Bỏ qua nhúng metadata:', err);
      return blob;
    } finally {
      try { await WakaMetaInjector.clearMeta(); } catch {}
    }
  }

  const BUILD_TIMEOUT_MS = 120000;    // dựng EPUB (JSZip) tối đa 2 phút
  const INJECT_TIMEOUT_MS = 60000;    // nhúng metadata + tải ảnh bìa tối đa 1 phút

  // Promise không bao giờ treo vô hạn: quá hạn thì báo lỗi rõ ràng thay vì đứng yên ở một bước.
  function withTimeout(promise, ms, message) {
    let timer = 0;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message || 'Hết thời gian chờ')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function getCookie(name) {
    try {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function readStorageValue(names) {
    try {
      for (const store of [localStorage, sessionStorage]) {
        for (const name of names) {
          const value = store.getItem(name);
          if (value) return value.replace(/^"|"$/g, '');
        }
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i) || '';
          if (names.some((name) => key.toLowerCase().includes(name.toLowerCase()))) {
            const value = store.getItem(key);
            if (value) return value.replace(/^"|"$/g, '');
          }
        }
      }
    } catch {}
    return null;
  }

  function getTid() {
    const cookie = getCookie('fm.auth.tid') || getCookie('tidToken') || getCookie('tid');
    if (cookie && cookie.length > 8) return cookie;
    const stored = readStorageValue(['fm.auth.tid', 'tidToken', 'auth.tid', 'tid']);
    if (stored && stored.length > 8 && stored.length < 200) return stored;
    const html = document.documentElement.innerHTML;
    const match = html.match(/\btid["']?\s*:\s*["']([a-f0-9]{16,})["']/i)
      || html.match(/["']tid["']\s*:\s*["']([a-f0-9]{16,})["']/i);
    return match ? match[1] : null;
  }

  function getAccount() {
    const cookie = getCookie('fm.auth.user') || getCookie('account');
    if (cookie) {
      try {
        const data = JSON.parse(cookie);
        if (data.userId) return String(data.userId);
      } catch {}
      if (/^\d+$/.test(cookie)) return cookie;
    }
    const html = document.documentElement.innerHTML;
    const match = html.match(/\buserId["']?\s*:\s*(\d{3,})/i)
      || html.match(/["']userId["']\s*:\s*(\d{3,})/i);
    return match ? match[1] : 'guest';
  }

  function getDeviceId() {
    try {
      const key = 'waka_toolkit_device_id';
      let id = localStorage.getItem(key);
      if (id && id.length >= 20) return id;
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, id);
      return id;
    } catch {
      return 'web' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
    }
  }

  function md5(value) {
    if (window.CryptoJS?.MD5) return String(window.CryptoJS.MD5(String(value)));
    throw new Error('CryptoJS chua san sang');
  }

  function encodeParam(value) {
    return encodeURIComponent(String(value))
      .replace(/!/g, '%21')
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/\*/g, '%2A');
  }

  async function hmacSha1Base64(message, key) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(key),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
    let bin = '';
    new Uint8Array(sig).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  async function makeSecureCode(params, key) {
    const message = DOWNLOAD_FIELDS.map((field) => encodeParam(params[field] ?? '')).join(' ');
    return hmacSha1Base64(message, key);
  }

  function extractDownloadUrl(text) {
    const raw = String(text || '');
    try {
      const json = JSON.parse(raw);
      const candidates = [
        json?.data?.download_url,
        json?.data?.url,
        json?.data?.epub_url,
        json?.data?.file_url,
        json?.data?.link,
        json?.download_url,
        json?.url,
        json?.epub_url,
        json?.file_url,
        json?.link,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
          return { url: candidate.replace(/\\\//g, '/') };
        }
      }
      if (json?.message) return { error: json.message };
    } catch {}
    const match = raw.match(/"(https?:\/\/[^"]*(?:epub|book|download|vegacdn)[^"]*)"/i);
    return match ? { url: match[1].replace(/\\\//g, '/') } : { error: 'Khong tim thay link EPUB' };
  }

  async function tryDownloadUrl(account, itemId, deviceId, key, contentType, bookUrl, job) {
    const params = { account, item_id: itemId, content_type: contentType, id: deviceId, os: 'web' };
    const secureCode = await makeSecureCode(params, key);
    const qs = new URLSearchParams({
      os: 'web',
      id: deviceId,
      account,
      item_id: itemId,
      content_type: contentType,
      rf: bookUrl || location.href,
      secure_code: secureCode,
    });
    const resp = await fetchWithFallback(API_BASE + '?' + qs, job?.signal);
    return extractDownloadUrl(await resp.text());
  }

  async function getDownloadUrl(itemId, bookUrl, job) {
    const cacheKey = itemId + '|' + (bookUrl || '');
    if (downloadCache.has(cacheKey)) return downloadCache.get(cacheKey);

    const deviceId = getDeviceId();
    const account = getAccount();
    const tid = getTid();
    const attempts = [];
    if (tid && account && account !== 'guest') attempts.push({ account, key: tid });
    if (account && account !== 'guest') attempts.push({ account, key: md5(account) });
    attempts.push({ account: 'guest', key: md5('guest') });

    let lastError = '';
    for (const attempt of attempts) {
      job?.throwIfCancelled();
      let result;
      try {
        result = await tryDownloadUrl(attempt.account, itemId, deviceId, attempt.key, 'book', bookUrl, job);
      } catch (err) {
        job?.throwIfCancelled();
        lastError = err?.message || String(err);
        continue;
      }
      job?.throwIfCancelled();
      if (result?.url) {
        downloadCache.set(cacheKey, result.url);
        return result.url;
      }
      lastError = result?.error || lastError;
    }
    throw new Error(lastError || 'Khong lay duoc link EPUB');
  }

  function isOpfUrl(url) {
    return /\/content\.opf(?:\?|$)/i.test(String(url || ''));
  }

  function resolveUrl(href, base) {
    try {
      return new URL(href, base).href;
    } catch {
      return String(base || '').replace(/\/$/, '') + '/' + href;
    }
  }

  // Same-origin: fetch thuong; cross-origin: GM_xmlhttpRequest (thay cho background fetchUrlAsDataUrl)
  function fetchWithFallback(url, signal, opts) {
    return WakaGM.fetch(url, Object.assign({ signal }, opts || {}));
  }

  function looksLikeForbiddenText(value) {
    const text = String(value || '').trim();
    return /^Forbidden\.?$/i.test(text)
      || /<title>\s*Forbidden\.?\s*<\/title>/i.test(text)
      || /<body[^>]*>\s*Forbidden\.?\s*<\/body>/i.test(text)
      || /AccessDenied|Access Denied|Request has expired/i.test(text);
  }

  function isOptionalEpubItem(href) {
    return /(?:^|\/)toc\.ncx$/i.test(String(href || ''));
  }

  async function openBlobInReader(blob, filename, job, ui) {
    if (job) {
      job.throwIfCancelled();
      job.commit(); // qua diem nay khong huy duoc nua (tab Reader sap mo)
    }
    // Neu trinh duyet se chan popup (het user activation) -> hien nut de nguoi dung bam mo Reader
    await WakaHandoff.openBlob(blob, filename, {
      askUser: ({ open, dismiss }) => ui && ui.showAction('Mở trong Reader', open, dismiss),
    });
  }

  async function buildEpubFromOpf(opfUrl, titleHint, job) {
    if (!window.WakaEpubDecode) throw new Error('WakaEpubDecode chua san sang');
    if (!window.EPUBBuilder?.buildFromFiles) throw new Error('EPUBBuilder chua san sang');

    const [opfPath, qs = ''] = String(opfUrl).split('?');
    const token = qs ? '?' + qs : '';
    const oebpsDir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
    job?.report('Đang tải content.opf...', 12);
    const opfResp = await fetchWithFallback(opfUrl, job?.signal);
    job?.throwIfCancelled();
    if (!opfResp.ok) throw new Error('content.opf HTTP ' + opfResp.status);

    const opfText = await opfResp.text();
    if (looksLikeForbiddenText(opfText)) throw new Error('CDN Forbidden: content.opf');
    if (!opfText.includes('<manifest')) throw new Error('OPF khong hop le');

    const doc = new DOMParser().parseFromString(opfText, 'application/xml');
    const items = Array.from(doc.querySelectorAll('manifest item'))
      .map((el) => ({ href: el.getAttribute('href') || '', type: el.getAttribute('media-type') || '' }))
      .filter((item) => item.href);
    if (!items.length) throw new Error('OPF khong co manifest');

    const files = new Map();
    job?.onCancel(() => files.clear()); // huy -> bo cac file da tai do dang
    const total = items.length;
    let done = 0;

    async function fetchItem(item) {
      const fileUrl = resolveUrl(item.href, oebpsDir) + token;
      let resp;
      try {
        resp = await fetchWithFallback(fileUrl, job?.signal);
      } catch (err) {
        if (isOptionalEpubItem(item.href)) {
          console.warn('[Waka One Click Reader] Skip optional EPUB item:', item.href, err);
          return;
        }
        throw err;
      }
      if (!resp.ok) {
        if (isOptionalEpubItem(item.href) || resp.status === 404) return;
        throw new Error(item.href + ' HTTP ' + resp.status);
      }
      const buf = await resp.arrayBuffer();
      const isText = /\.(xhtml|html?|xml|ncx|css|js|json)$/i.test(item.href);
      if (isText) {
        const decoded = WakaEpubDecode.decodeFileSync(buf);
        if (looksLikeForbiddenText(decoded)) {
          if (isOptionalEpubItem(item.href)) return;
          throw new Error('CDN Forbidden: ' + item.href);
        }
        files.set(item.href, decoded);
      } else {
        files.set(item.href, buf);
      }
    }

    const batchSize = 5;
    for (let i = 0; i < items.length; i += batchSize) {
      job?.throwIfCancelled();
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map(async (item) => {
        job?.throwIfCancelled();
        await fetchItem(item);
        done++;
        // 14% -> 80%: tien trinh theo ti le file da tai xong / tong so file trong manifest
        job?.report('Đang tải ' + shortFileName(item.href) + ' (' + done + '/' + total + ')...', 14 + (done / total) * 66);
      }));
    }
    job?.throwIfCancelled();
    if (!files.size) throw new Error('Khong tai duoc file EPUB nao');

    job?.report('Đang dựng EPUB...', 82);
    const title = WakaEpubDecode.extractTitleFromOpf(opfText, titleHint || 'waka-ebook');
    const blob = await withTimeout(
      EPUBBuilder.buildFromFiles(title, opfText, files, (pct) => {
        // 82% -> 87%: tiến trình nén ZIP
        job?.report('Đang dựng EPUB... ' + Math.round(pct) + '%', 82 + (pct / 100) * 5);
      }),
      BUILD_TIMEOUT_MS,
      'Dựng EPUB quá thời gian (JSZip không phản hồi)'
    );
    job?.throwIfCancelled();
    return {
      blob,
      filename: safeName(title) + '.epub',
    };
  }

  async function getDirectEpub(url, titleHint, job) {
    const filename = safeName(titleHint || 'waka-ebook') + '.epub';
    job?.report('Đang tải ' + shortFileName(filename) + '...', 12);
    // Tien trinh tai: GM_xmlhttpRequest.onprogress (thay cho doc stream cua fetch)
    const resp = await fetchWithFallback(url, job?.signal, {
      onProgress: (ratio) => job?.report('Đang tải ' + shortFileName(filename) + '...', 12 + ratio * 68),
    });
    job?.throwIfCancelled();
    if (!resp.ok) throw new Error('EPUB HTTP ' + resp.status);
    const contentType = resp.headers.get('content-type') || '';
    if (/text\/html|text\/plain/i.test(contentType)) {
      const text = await resp.text();
      if (looksLikeForbiddenText(text)) throw new Error('CDN Forbidden: EPUB file');
      return {
        blob: new Blob([text], { type: contentType || 'text/plain' }),
        filename,
      };
    }
    const blob = await resp.blob();
    job?.throwIfCancelled();
    return { blob, filename };
  }

  function setButtonState(btn, text, busy) {
    btn.querySelector('.waka-ocr-text').textContent = text;
    btn.disabled = !!busy;
    btn.toggleAttribute(BUSY_ATTR, !!busy);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 6.9.1 · LỚP PHỦ TIẾN TRÌNH KHI BẤM "ĐỌC NGAY"
   *  - createJob():             quản lý 1 lần tải (hủy, dọn cache, báo tiến trình)
   *  - createProgressOverlay(): dựng giao diện (mobile = phủ xanh ngọc, desktop = panel nổi)
   * ───────────────────────────────────────────────────────────────────────── */
  const OVERLAY_ID = 'waka-ocr-overlay';
  const LINK_READY_HOLD_MS = 350;   // giữ dòng "Link OPF sẵn sàng" đủ lâu để nhìn thấy (đặt 0 nếu muốn bỏ)
  const ERROR_AUTO_CLOSE_MS = 6000;
  let activeJob = null;

  class CancelError extends Error {
    constructor() {
      super('Da huy');
      this.name = 'CancelError';
      this.isCancel = true;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Cùng tiêu chí "mobile mode" với book-metadata.js
  function isMobileUi() {
    return window.innerWidth <= 768
      || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '')
      || !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
  }

  // "OEBPS/Text/chapter_0012345.xhtml" -> "chapter_0012345.xhtml" (rút gọn giữa nếu quá dài, giữ đuôi file)
  function shortFileName(href, max = 22) {
    let name = String(href || '').split(/[?#]/)[0].split('/').pop() || '';
    try { name = decodeURIComponent(name); } catch {}
    if (name.length <= max) return name;
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
    return name.slice(0, Math.max(4, max - ext.length - 1)) + '…' + ext;
  }

  function createJob() {
    const controller = new AbortController();
    const cleanups = [];
    const job = {
      cancelled: false,
      committed: false,
      signal: controller.signal,
      report() {},          // được gán lại thành ui.step khi có overlay
      onCommit() {},
      onCancel(fn) { cleanups.push(fn); },
      throwIfCancelled() { if (job.cancelled) throw new CancelError(); },
      commit() {
        job.committed = true;
        try { job.onCommit(); } catch {}
      },
      // Trả về true nếu thực sự hủy được (chưa tới bước mở Reader)
      cancel() {
        if (job.cancelled || job.committed) return false;
        job.cancelled = true;
        try { controller.abort(); } catch {}
        cleanups.splice(0).forEach((fn) => { try { fn(); } catch {} });
        return true;
      },
    };
    return job;
  }

  function createProgressOverlay({ coverUrl }) {
    ensureStyles();
    document.getElementById(OVERLAY_ID)?.remove();

    const mobile = isMobileUi();
    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.className = 'waka-ocr-ov ' + (mobile ? 'waka-ocr-ov--mobile' : 'waka-ocr-ov--desktop');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Đang mở sách');
    root.innerHTML = ''
      + '<div class="waka-ocr-ov-bg"></div>'
      + '<div class="waka-ocr-ov-panel">'
      +   '<div class="waka-ocr-ov-cover"><img alt="" draggable="false"></div>'
      +   '<div class="waka-ocr-ov-status" role="status" aria-live="polite"></div>'
      +   '<div class="waka-ocr-ov-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>'
      +   '<button type="button" class="waka-ocr-ov-action" hidden></button>'
      +   '<button type="button" class="waka-ocr-ov-cancel">Hủy bỏ</button>'
      + '</div>';

    const bg = root.querySelector('.waka-ocr-ov-bg');
    const coverBox = root.querySelector('.waka-ocr-ov-cover');
    const coverImg = coverBox.querySelector('img');
    const statusEl = root.querySelector('.waka-ocr-ov-status');
    const barEl = root.querySelector('.waka-ocr-ov-bar');
    const fillEl = barEl.querySelector('i');
    const cancelBtn = root.querySelector('.waka-ocr-ov-cancel');
    const actionBtn = root.querySelector('.waka-ocr-ov-action');

    if (coverUrl) {
      coverImg.src = coverUrl;
      bg.style.backgroundImage = 'url("' + String(coverUrl).replace(/["\\\n\r]/g, encodeURIComponent) + '")';
    } else {
      coverBox.style.display = 'none';
    }

    let cancelHandler = () => {};
    let progress = 0;
    let closed = false;
    let autoCloseTimer = 0;

    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!cancelBtn.disabled) cancelBtn.click();
    }

    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelHandler();
    });
    // Không cho trang phía sau cuộn khi đang phủ
    root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', onKeyDown, true);

    // Gắn vào <html> (không phải <body>) để MutationObserver của trang không quét lại mỗi lần cập nhật
    document.documentElement.appendChild(root);
    requestAnimationFrame(() => root.classList.add('is-in'));
    try { cancelBtn.focus({ preventScroll: true }); } catch {}

    const ui = {
      setStatus(text) {
        statusEl.textContent = text;
        statusEl.title = text;
      },
      // Thanh chạy từ trái sang phải, không bao giờ lùi
      setProgress(pct) {
        progress = Math.max(progress, Math.min(100, Number(pct) || 0));
        fillEl.style.width = progress + '%';
        barEl.setAttribute('aria-valuenow', String(Math.round(progress)));
      },
      step(text, pct) {
        if (closed) return;
        ui.setStatus(text);
        if (pct != null) ui.setProgress(pct);
      },
      onCancel(fn) { cancelHandler = fn; },
      lockCancel() { cancelBtn.disabled = true; },
      // Hiện nút hành động (cần cử chỉ người dùng để trình duyệt cho phép mở tab Reader)
      showAction(label, onClick, onDismiss) {
        if (closed) return;
        ui.setStatus('EPUB đã sẵn sàng — bấm nút để mở trong Reader');
        ui.setProgress(97);
        actionBtn.textContent = label;
        actionBtn.hidden = false;
        actionBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          actionBtn.hidden = true;
          onClick();            // gọi ĐỒNG BỘ trong sự kiện click để window.open hợp lệ
        };
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Đóng';
        cancelHandler = () => { try { onDismiss && onDismiss(); } catch {} };
        try { actionBtn.focus({ preventScroll: true }); } catch {}
      },
      showError(message) {
        if (closed) return;
        root.classList.add('is-error');
        ui.setStatus('Lỗi: ' + String(message || 'Không rõ nguyên nhân').slice(0, 120));
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Đóng';
        cancelHandler = () => ui.close();
        autoCloseTimer = setTimeout(() => ui.close(), ERROR_AUTO_CLOSE_MS);
      },
      close() {
        if (closed) return;
        closed = true;
        clearTimeout(autoCloseTimer);
        document.removeEventListener('keydown', onKeyDown, true);
        root.classList.remove('is-in');
        setTimeout(() => root.remove(), 200);
      },
    };
    ui.setProgress(0);
    return ui;
  }

  async function handleQuickRead(e, data) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    if (btn.disabled || activeJob) return;

    const job = createJob();
    activeJob = job;
    const coverUrl = data.img?.currentSrc || data.img?.src || '';
    const ui = createProgressOverlay({ coverUrl });
    job.report = (text, pct) => ui.step(text, pct);
    job.onCommit = () => ui.lockCancel();
    ui.onCancel(() => {
      if (!job.cancel()) return;   // job.cancel() dọn cache + file đang dở
      if (activeJob === job) activeJob = null;
      ui.close();
      setButtonState(btn, 'Đọc ngay', false);
    });
    // Hủy -> xóa metadata tạm đã đẩy sang background (nếu có)
    job.onCancel(() => {
      try { Promise.resolve(window.WakaMetaInjector?.clearMeta?.()).catch(() => {}); } catch {}
    });

    setButtonState(btn, 'Dang lay ID...', true);
    ui.step('Đang lấy link OPF...', 3);

    try {
      // Trang sách (metadata) tải song song với việc lấy link OPF; chỉ chờ khi cần
      let info = { itemId: '', title: '', meta: null };
      const infoPromise = (data.bookUrl ? fetchItemPageInfo(data.bookUrl, job) : Promise.resolve(info))
        .then((result) => { info = result; return result; })
        .catch((err) => {
          if (!job.cancelled) console.warn('[Waka One Click Reader] Cannot fetch ebook metadata, continuing with cover item_id:', err);
          return info;
        });

      let itemId = extractItemIdFromCover(coverUrl);
      if (!itemId) {
        await infoPromise;
        job.throwIfCancelled();
        itemId = info.itemId;
      }
      if (!itemId) throw new Error('Khong tim thay item_id');
      const cacheKey = itemId + '|' + (data.bookUrl || '');
      job.onCancel(() => downloadCache.delete(cacheKey));   // hủy -> xóa link đã cache của cuốn này

      const downloadUrl = await getDownloadUrl(itemId, data.bookUrl, job);
      job.throwIfCancelled();
      const viaOpf = isOpfUrl(downloadUrl);
      ui.step(viaOpf ? 'Link OPF sẵn sàng' : 'Link EPUB sẵn sàng', 10);
      if (LINK_READY_HOLD_MS > 0) {
        await sleep(LINK_READY_HOLD_MS);
        job.throwIfCancelled();
      }

      const titleHint = cleanTitle(info.meta?.title || info.title) || data.title;
      const epub = viaOpf
        ? await buildEpubFromOpf(downloadUrl, titleHint, job)
        : await getDirectEpub(downloadUrl, titleHint, job);
      job.throwIfCancelled();

      ui.step('Đang trích xuất metadata...', 88);
      await infoPromise;
      job.throwIfCancelled();

      ui.step('Đang nhúng metadata vào EPUB...', 93);
      epub.blob = await injectMetadataIntoEpub(epub.blob, info.meta);
      job.throwIfCancelled();
      if (info.meta?.title) epub.filename = safeName(info.meta.title) + '.epub';

      ui.step('Đang mở file epub...', 97);
      await openBlobInReader(epub.blob, epub.filename, job, ui);

      ui.step('Đã mở', 100);
      setTimeout(() => ui.close(), 450);
      setButtonState(btn, 'Da mo', false);
      setTimeout(() => setButtonState(btn, 'Đọc ngay', false), 1600);
    } catch (err) {
      if (job.cancelled || err?.isCancel) {
        ui.close();
        setButtonState(btn, 'Đọc ngay', false);
        return;
      }
      console.error('[Waka One Click Reader]', err);
      setButtonState(btn, 'Loi', false);
      btn.title = err?.message || String(err);
      ui.showError(err?.message || String(err));
      setTimeout(() => setButtonState(btn, 'Đọc ngay', false), 2200);
    } finally {
      if (activeJob === job) activeJob = null;
    }
  }

  function ensureStyles() {
    if (document.getElementById('waka-one-click-reader-style')) return;
    const css = `
      .waka-ocr-cover {
        position: relative !important;
      }
      .waka-ocr-native-hidden {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      /* Chỉ ẩn đúng icon "đọc" gốc (icon nhỏ, không chứa gì khác).
         KHÔNG dùng :has() / bg-black / backdrop-blur ở đây: các class này
         nằm ở cả wrapper của trang -> ẩn nhầm cả trang => màn hình đen. */
      img[src*="icon-continue-read.svg"]:not(.waka-ocr-icon),
      image[href*="icon-continue-read.svg"],
      [style*="icon-continue-read.svg"],
      .waka-ocr-cover i.icon-book,
      .waka-ocr-cover [class~="icon-book"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      .waka-ocr-button {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        z-index: 30;
        width: 58px;
        height: 58px;
        border: 0;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        background: transparent;
        box-shadow: none;
        cursor: pointer;
        opacity: .96;
        transition: transform .16s ease, opacity .16s ease, filter .16s ease;
      }
      .waka-ocr-button:hover {
        opacity: 1;
        filter: drop-shadow(0 8px 18px rgba(0,0,0,.32));
        transform: translate(-50%, -50%) scale(1.04);
      }
      .waka-ocr-button:disabled {
        cursor: wait;
        opacity: .82;
      }
      .waka-ocr-button[${BUSY_ATTR}] {
        cursor: wait;
      }
      .waka-ocr-button img,
      .waka-ocr-button svg {
        width: 42px;
        height: 42px;
        display: block;
        pointer-events: none;
      }
      .waka-ocr-text {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      /* ===== 6.9.1 · lớp phủ tiến trình "Đọc ngay" ===== */
      .waka-ocr-ov, .waka-ocr-ov *, .waka-ocr-ov *::before, .waka-ocr-ov *::after {
        box-sizing: border-box;
      }
      .waka-ocr-ov {
        --waka-ocr-w: 190px;
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        overflow: hidden;
        color: #fff;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        opacity: 0;
        transition: opacity .18s ease;
        overscroll-behavior: contain;
        touch-action: none;
        -webkit-tap-highlight-color: transparent;
      }
      .waka-ocr-ov.is-in { opacity: 1; }
      .waka-ocr-ov-bg {
        position: absolute;
        inset: 0;
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        pointer-events: none;
      }
      .waka-ocr-ov-panel {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .waka-ocr-ov-cover {
        width: var(--waka-ocr-w);
        border-radius: 6px;
        overflow: hidden;
        background: rgba(255,255,255,.12);
        box-shadow: 0 12px 34px rgba(0,0,0,.38);
      }
      .waka-ocr-ov-cover img {
        display: block;
        width: 100%;
        height: auto;
        max-height: 56vh;
        object-fit: cover;
        user-select: none;
        -webkit-user-drag: none;
      }
      .waka-ocr-ov-status {
        width: min(100%, 340px);
        min-height: 22px;
        margin: 22px 0 14px;
        font-size: 15px;
        line-height: 22px;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-shadow: 0 1px 2px rgba(0,0,0,.35);
      }
      .waka-ocr-ov.is-error .waka-ocr-ov-status { color: #ffd9d2; }
      .waka-ocr-ov-bar {
        width: var(--waka-ocr-w);
        height: 4px;
        margin-bottom: 26px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255,255,255,.3);
      }
      .waka-ocr-ov-bar > i {
        display: block;
        width: 0;
        height: 100%;
        border-radius: 999px;
        background: #fff;
        transition: width .28s ease;
      }
      .waka-ocr-ov.is-error .waka-ocr-ov-bar > i { background: #ffb4a8; }
      .waka-ocr-ov-cancel {
        -webkit-appearance: none;
        appearance: none;
        width: var(--waka-ocr-w);
        height: 44px;
        margin: 0;
        padding: 0 16px;
        border: 1.5px solid rgba(255,255,255,.78);
        border-radius: 999px;
        background: transparent;
        color: #fff;
        font: 500 14px/1 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        letter-spacing: .06em;
        text-transform: uppercase;
        cursor: pointer;
        transition: background .15s ease, border-color .15s ease, opacity .15s ease;
      }
      .waka-ocr-ov-cancel:hover { background: rgba(255,255,255,.12); border-color: #fff; }
      .waka-ocr-ov-cancel:active { background: rgba(255,255,255,.22); }
      .waka-ocr-ov-cancel:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
      .waka-ocr-ov-cancel:disabled { opacity: .45; cursor: default; background: transparent; }

      .waka-ocr-ov-action {
        -webkit-appearance: none;
        appearance: none;
        width: var(--waka-ocr-w);
        height: 46px;
        margin: 0 0 12px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: #fff;
        color: #0a635e;
        font: 700 14px/1 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        letter-spacing: .04em;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(0,0,0,.28);
      }
      .waka-ocr-ov-action[hidden] { display: none !important; }
      .waka-ocr-ov-action:hover { background: #eafaf8; }
      .waka-ocr-ov-action:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

      /* Mobile: phủ toàn màn hình màu xanh ngọc */
      .waka-ocr-ov--mobile {
        --waka-ocr-w: min(54vw, 210px);
        background: linear-gradient(165deg, #0f8f86 0%, #0a635e 55%, #06423f 100%);
      }
      .waka-ocr-ov--mobile .waka-ocr-ov-bg { display: none; }
      .waka-ocr-ov--mobile .waka-ocr-ov-panel { width: 100%; }

      /* Desktop: panel nổi, nền là chính ảnh bìa (opacity thấp, làm mờ) */
      .waka-ocr-ov--desktop {
        background: rgba(10,18,18,.62);
        -webkit-backdrop-filter: blur(3px);
        backdrop-filter: blur(3px);
      }
      .waka-ocr-ov--desktop .waka-ocr-ov-bg {
        opacity: .38;
        filter: blur(30px) saturate(1.15);
        transform: scale(1.2);
      }
      .waka-ocr-ov--desktop .waka-ocr-ov-panel {
        width: 420px;
        max-width: calc(100vw - 32px);
        padding: 40px 32px 34px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,.16);
        background: rgba(28,38,38,.5);
        -webkit-backdrop-filter: blur(18px);
        backdrop-filter: blur(18px);
        box-shadow: 0 26px 70px rgba(0,0,0,.5);
      }
    `;
    injectStyle(css);
  }

  // GM_addStyle di qua userscript manager nen khong bi CSP style-src cua trang chan
  function injectStyle(css) {
    let el = null;
    try { if (GM && typeof GM.addStyle === 'function') el = GM.addStyle(css); } catch {}
    if (!el || !el.nodeType) {
      el = document.createElement('style');
      el.textContent = css;
      document.documentElement.appendChild(el);
    }
    el.id = 'waka-one-click-reader-style';
  }

  function makeBookIcon() {
    return READ_ICON_SVG;
  }

  function findCoverForAnchor(anchor) {
    const candidates = [];
    let node = anchor;
    for (let i = 0; i < 5 && node; i++) {
      candidates.push(node);
      node = node.previousElementSibling || node.parentElement;
    }
    const scope = anchor.parentElement || anchor;
    candidates.push(scope);

    for (const root of candidates) {
      const img = root?.querySelector?.('img[src*="img.book"]');
      if (!img) continue;
      const cover = img.closest('[class*="h-["][class*="overflow-hidden"], [class*="pt-full"], [class*="relative"][class*="overflow-hidden"], .relative[class*="overflow-hidden"]')
        || img.parentElement;
      if (cover) return { cover, img };
    }
    return null;
  }

  function nativeReadSelector() {
    return [
      'img[src*="icon-continue-read.svg"]',
      'image[href*="icon-continue-read.svg"]',
      '[style*="icon-continue-read.svg"]',
      'i.icon-book',
      '[class~="icon-book"]',
    ].join(',');
  }

  // Selector "khung ảnh bìa" (giữ đồng bộ với findCoverForAnchor ở trên)
  const COVER_SELECTOR = '[class*="h-["][class*="overflow-hidden"], [class*="pt-full"], [class*="relative"][class*="overflow-hidden"], .relative[class*="overflow-hidden"]';
  const CHIP_CLASS_RE = /rounded-full|backdrop-blur|bg-black|cursor-pointer|w-\[\d+px\]|h-\[\d+px\]/;
  const LAYOUT_CLASS_RE = /absolute|flex|items-center|justify-center|inset-0/;

  // Một phần tử CHỈ được ẩn khi chắc chắn nó là nút "đọc" gốc, không phải wrapper của trang/card:
  //  - nằm bên trong cover (không bao giờ là cover, body, html)
  //  - không chứa ảnh bìa, link /ebook/, nút của mình, form, media
  //  - text ngắn (nút chỉ có icon / vài chữ)
  function isSafeNativeTarget(el, cover, ownButton) {
    if (!el || !cover || el === cover || !cover.contains(el)) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (ownButton && (el === ownButton || el.contains(ownButton) || ownButton.contains(el))) return false;
    if (el.matches?.('a[href*="/ebook/"]')) return false;
    if (el.querySelector?.('img[src*="img.book"], a[href*="/ebook/"], video, canvas, input, textarea, select')) return false;
    if ((el.textContent || '').trim().length > 24) return false;
    return true;
  }

  // Đi từ icon lên "chip" bao quanh nó (tối đa 3 cấp, không vượt quá cover)
  function nativeReadContainer(node, cover, ownButton) {
    let target = node;
    for (let i = 0; i < 3; i++) {
      const parent = target.parentElement;
      if (!parent || parent === cover) break;
      if (!isSafeNativeTarget(parent, cover, ownButton)) break;
      const cls = String(parent.className && parent.className.baseVal !== undefined ? parent.className.baseVal : parent.className || '');
      const isChip = CHIP_CLASS_RE.test(cls) || parent.tagName === 'BUTTON' || parent.tagName === 'A';
      const isPureWrapper = LAYOUT_CLASS_RE.test(cls) && parent.children.length === 1;
      if (!isChip && !isPureWrapper) break;
      target = parent;
    }
    return target;
  }

  function hideNativeReadButton(cover, ownButton) {
    // 1) Tìm icon "đọc" gốc trong cover rồi ẩn chip bao quanh nó
    cover.querySelectorAll(nativeReadSelector()).forEach((node) => {
      if (node.closest?.('.waka-ocr-button')) return;
      const target = nativeReadContainer(node, cover, ownButton);
      if (isSafeNativeTarget(target, cover, ownButton)) target.classList.add('waka-ocr-native-hidden');
    });

    // 2) Overlay căn giữa phủ cả cover, chỉ chứa icon (không có icon-continue-read cụ thể)
    Array.from(cover.children).forEach((child) => {
      if (!isSafeNativeTarget(child, cover, ownButton)) return;
      const cls = String(child.className && child.className.baseVal !== undefined ? child.className.baseVal : child.className || '');
      const centered = /absolute/.test(cls)
        && (/top-0/.test(cls) || /inset-0/.test(cls))
        && (/left-0/.test(cls) || /inset-0/.test(cls))
        && (/right-0/.test(cls) || /inset-0/.test(cls))
        && (/bottom-0/.test(cls) || /inset-0/.test(cls))
        && /justify-center|items-center|grid-center/.test(cls);
      const iconOnly = child.querySelector('svg,img,i.icon-book,[class~="icon-book"]')
        || /rounded-full|backdrop-blur|bg-black|icon-book/.test(child.innerHTML);
      if (centered && iconOnly) child.classList.add('waka-ocr-native-hidden');
    });
  }

  // Ancestor nhỏ nhất của node mà chứa đúng 1 ảnh bìa sách = "thẻ" của cuốn sách đó
  function findBookScope(node) {
    let el = node.parentElement;
    for (let i = 0; i < 8 && el && el !== document.body && el !== document.documentElement; i++, el = el.parentElement) {
      const imgs = el.querySelectorAll('img[src*="img.book"]');
      if (imgs.length === 1) return { scope: el, img: imgs[0] };
      if (imgs.length > 1) return null;
    }
    return null;
  }

  // Tìm link /ebook/xxx.html của đúng cuốn này (có thể không có với thẻ "đang đọc")
  function findBookAnchor(scope, img) {
    let el = scope;
    for (let i = 0; i < 4 && el && el !== document.body && el !== document.documentElement; i++, el = el.parentElement) {
      if (el.querySelectorAll('img[src*="img.book"]').length !== 1) break;
      if (el.matches?.('a[href*="/ebook/"]') && isEbookUrl(el.href)) return el;
      const a = Array.from(el.querySelectorAll('a[href*="/ebook/"]')).find((x) => isEbookUrl(x.href));
      if (a) return a;
    }
    return null;
  }

  // Thẻ có nút gốc bị ẩn nhưng chưa có nút "Đọc ngay" -> chèn vào chính giữa ảnh bìa
  function ensureOwnButton(scope, img) {
    if (scope.querySelector('.waka-ocr-button')) return;
    let cover = img.closest(COVER_SELECTOR) || img.parentElement;
    if (!cover || cover.querySelectorAll('img[src*="img.book"]').length !== 1) cover = img.parentElement;
    if (!cover || cover.querySelector(':scope > .waka-ocr-button')) return;
    const anchor = findBookAnchor(scope, img);
    const bookUrl = anchor ? normalizeUrl(anchor.href) : '';
    const title = anchor
      ? getCardTitle(anchor, img)
      : (cleanTitle(img.alt || img.title || '') || 'waka-ebook');
    attachOneButton(cover, img, bookUrl, title);
  }

  // Quét lại toàn trang (nút gốc có thể render sau khi mình inject) nhưng CHỈ trong thẻ của 1 cuốn sách
  function hideAllNativeContinueReadButtons(root = document) {
    root.querySelectorAll?.(nativeReadSelector()).forEach((node) => {
      if (node.closest?.('.waka-ocr-button')) return;
      const found = findBookScope(node);
      if (!found) return;
      const { scope, img } = found;

      // icon-book chung chung: chỉ tính khi nằm trong lớp phủ absolute của thẻ (tránh icon "số trang", menu...)
      const isContinueRead = node.matches?.('img[src*="icon-continue-read.svg"], image[href*="icon-continue-read.svg"], [style*="icon-continue-read.svg"]');
      if (!isContinueRead) {
        const abs = node.closest?.('[class*="absolute"]');
        if (!abs || !scope.contains(abs)) return;
      }

      const ownButton = scope.querySelector('.waka-ocr-button');
      const target = nativeReadContainer(node, scope, ownButton);
      if (isSafeNativeTarget(target, scope, ownButton)) target.classList.add('waka-ocr-native-hidden');
      ensureOwnButton(scope, img);
    });
  }

  function attachOneButton(cover, img, bookUrl, title) {
    cover.setAttribute(CARD_ATTR, '1');
    if (cover.querySelector(':scope > .waka-ocr-button')) return;
    cover.classList.add('waka-ocr-cover');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'waka-ocr-button';
    btn.title = 'Đọc ngay';
    btn.innerHTML = makeBookIcon() + '<span class="waka-ocr-text">Đọc ngay</span>';
    btn.addEventListener('click', (e) => handleQuickRead(e, { bookUrl, img, title }));

    cover.appendChild(btn);
    hideNativeReadButton(cover, btn);
  }

  function injectOneButton(anchor) {
    const bookUrl = normalizeUrl(anchor.href);
    if (!isEbookUrl(bookUrl)) return;

    const found = findCoverForAnchor(anchor);
    if (!found?.cover || !found?.img) return;
    attachOneButton(found.cover, found.img, bookUrl, getCardTitle(anchor, found.img));
  }

  let scheduled = false;
  function scan() {
    scheduled = false;
    ensureStyles();
    document.querySelectorAll('a[href*="/ebook/"]').forEach(injectOneButton);
    hideAllNativeContinueReadButtons(document);
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 160);
  }

  function boot() {
    if (!document.body) {
      setTimeout(boot, 80);
      return;
    }
    scan();
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    [800, 1800, 3500, 6500].forEach((ms) => setTimeout(scan, ms));
  }

  function startOnce(gm) {
    if (window.__wakaOneClickToRead) return;
    window.__wakaOneClickToRead = true;
    GM = gm;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }

  window.WakaOneClick = { start: startOnce };
})();
