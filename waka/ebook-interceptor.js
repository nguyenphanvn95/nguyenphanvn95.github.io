/**
 * ebook-interceptor.js  –  MAIN world  –  chạy trên /ebook/*
 *
 * Chiến lược (đúc kết từ phân tích network log thực tế):
 *
 *  1. Intercept XHR/fetch → bắt response của:
 *       a. beta-api.waka.vn/super/getItemInfo    → lấy item_id + toàn bộ query params
 *       b. beta-api.waka.vn/super/getDownloadItemWeb → lấy URL download EPUB
 *
 *  2. Khi đã có params từ getItemInfo, tự gọi getDownloadItemWeb
 *     (cùng secure_code – xác nhận từ network log: 2 endpoint dùng chung mã)
 *
 *  3. Parse response → emit '__waka_ebook_ready__' với download URL
 *
 * Giao tiếp với ebook-content.js (ISOLATED) qua CustomEvent trên window.
 */
(function () {
  'use strict';

  const API_BASE     = 'beta-api.waka.vn';
  const ITEM_INFO_RE = /getItemInfo\?/;
  const DOWNLOAD_RE  = /getDownloadItemWeb\?/;

  // Trạng thái đã capture
  let _capturedParams = null;   // params từ getItemInfo
  let _downloadCalled = false;  // tránh gọi lại

  // ── Helpers ────────────────────────────────────────────────────────────────

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Parse query string → object */
  function parseQuery(url) {
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://' + url);
      const obj = {};
      u.searchParams.forEach((v, k) => { obj[k] = v; });
      return obj;
    } catch { return {}; }
  }

  /** Tìm URL download trong JSON response */
  function extractDownloadUrl(text) {
    try {
      const json = JSON.parse(text);
      // Thử các field thường gặp theo thứ tự ưu tiên
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
      for (const c of candidates) {
        if (typeof c === 'string' && c.startsWith('http')) return c;
      }

      // Fallback: scan toàn bộ JSON string tìm URL vegacdn hoặc epub
      const urlMatch = text.match(/"(https?:\/\/[^"]*(?:epub|book|download)[^"]*)"/i);
      if (urlMatch) return urlMatch[1];

      // Lưu raw JSON để debug
      return null;
    } catch {
      return null;
    }
  }

  /** Gọi getDownloadItemWeb bằng params đã capture từ getItemInfo */
  async function callDownloadApi(params) {
    if (_downloadCalled) return;
    _downloadCalled = true;

    const qs = new URLSearchParams({
      os:           params.os || 'wap',
      id:           params.id,
      account:      params.account || 'guest',
      item_id:      params.item_id,
      content_type: params.content_type || 'book',
      rf:           window.location.href,
      secure_code:  params.secure_code,
    });

    const url = `https://${API_BASE}/super/getDownloadItemWeb?${qs}`;
    emit('__waka_ebook_status__', { msg: `Đang lấy link download... (item_id=${params.item_id})` });

    try {
      const resp = await fetch(url, { credentials: 'omit' });
      const text = await resp.text();
      emit('__waka_ebook_raw__', { raw: text, status: resp.status });

      const downloadUrl = extractDownloadUrl(text);
      if (downloadUrl) {
        emit('__waka_ebook_ready__', { url: downloadUrl, itemId: params.item_id });
      } else {
        emit('__waka_ebook_status__', {
          msg: `getDownloadItemWeb trả về (${resp.status}): ${text.slice(0, 200)}`,
          isError: true,
        });
      }
    } catch (err) {
      emit('__waka_ebook_status__', { msg: `Lỗi gọi API: ${err.message}`, isError: true });
      _downloadCalled = false; // cho phép retry
    }
  }

  // ── XHR interceptor ────────────────────────────────────────────────────────

  const NativeXHR = window.XMLHttpRequest;

  function PatchedXHR() {
    const xhr = new NativeXHR();
    let _url = '';

    const _open = xhr.open.bind(xhr);
    xhr.open = function (method, url) {
      _url = typeof url === 'string' ? url : '';
      return _open.apply(xhr, arguments);
    };

    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState !== 4) return;
      handleResponse(_url, xhr.responseText || '');
    });

    return xhr;
  }

  Object.setPrototypeOf(PatchedXHR, NativeXHR);
  Object.setPrototypeOf(PatchedXHR.prototype, NativeXHR.prototype);
  window.XMLHttpRequest = PatchedXHR;

  // ── fetch interceptor ──────────────────────────────────────────────────────

  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url  = typeof input === 'string' ? input
               : input instanceof Request  ? input.url : String(input);
    const resp = await nativeFetch(input, init);

    if (url.includes(API_BASE)) {
      const clone = resp.clone();
      clone.text().then(text => handleResponse(url, text)).catch(() => {});
    }

    return resp;
  };

  // ── Core handler ───────────────────────────────────────────────────────────

  function handleResponse(url, responseText) {
    if (!url.includes(API_BASE)) return;

    // A. getItemInfo → capture params, trigger download API call
    if (ITEM_INFO_RE.test(url) && !_capturedParams) {
      const params = parseQuery(url);
      if (params.item_id && params.secure_code) {
        _capturedParams = params;
        console.log('[Waka DL] Captured params:', params.item_id, params.content_type);
        emit('__waka_ebook_status__', { msg: `Phát hiện sách ID=${params.item_id}. Đang lấy link...` });
        callDownloadApi(params);
      }
    }

    // B. getDownloadItemWeb → parse luôn nếu app đã tự gọi
    if (DOWNLOAD_RE.test(url)) {
      const downloadUrl = extractDownloadUrl(responseText);
      if (downloadUrl) {
        emit('__waka_ebook_ready__', { url: downloadUrl });
      } else {
        // Emit raw để debug
        emit('__waka_ebook_raw__', { raw: responseText });
      }
    }
  }

  console.log('[Waka DL] Ebook interceptor v3 ready (ebook page).');
})();
