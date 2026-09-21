/**
 * gm-fetch.js — WakaGM
 *
 * Lớp truy cập mạng cho userscript, thay cho service worker của extension
 * (background.js: `fetchUrlAsDataUrl` / `fetchImageAsBase64`).
 *
 *  - URL CÙNG origin với trang (waka.vn)  → fetch() thường (giữ cookie đăng nhập)
 *  - URL KHÁC origin (beta-api.waka.vn, CDN vegacdn.vn, ảnh bìa…) → GM_xmlhttpRequest
 *    (không bị CORS). Giống extension: thử không cookie trước, nếu !ok thì thử lại có cookie.
 *  - Luật declarativeNetRequest của extension (Referer/Origin = waka.vn cho
 *    store.waka.vn/static/) được áp dụng lại bằng header của GM_xmlhttpRequest.
 *
 * API:  WakaGM.init(gm)
 *       WakaGM.fetch(url, { signal, onProgress(ratio 0..1) }) → Promise<Response-like>
 *         Response-like: { ok, status, url, headers.get(name), text(), arrayBuffer(), blob() }
 */
(function () {
  'use strict';

  let gm = null;

  function init(api) { gm = api; }

  function parseHeaders(str) {
    const out = {};
    String(str || '').split(/\r?\n/).forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
    return out;
  }

  function abortError() {
    try { return new DOMException('Aborted', 'AbortError'); } catch (e) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return err;
    }
  }

  function extraHeaders(u) {
    // Tương đương rule id=2 trong rules/edge_tts_headers.json của extension
    if (u.hostname === 'store.waka.vn' && u.pathname.indexOf('/static/') === 0) {
      return { Referer: 'https://waka.vn/', Origin: 'https://waka.vn' };
    }
    return {};
  }

  function makeResponse(r, finalUrl) {
    const buf = r.response instanceof ArrayBuffer ? r.response : new ArrayBuffer(0);
    const hdr = parseHeaders(r.responseHeaders);
    const contentType = hdr['content-type'] || '';
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      url: r.finalUrl || finalUrl,
      headers: { get: (name) => { const v = hdr[String(name || '').toLowerCase()]; return v === undefined ? null : v; } },
      text: async () => new TextDecoder().decode(buf),
      arrayBuffer: async () => buf,
      blob: async () => new Blob([buf], { type: contentType.split(';')[0].trim() || 'application/octet-stream' }),
    };
  }

  function gmRequest(url, { anonymous, signal, onProgress }) {
    return new Promise((resolve, reject) => {
      if (!gm || typeof gm.xhr !== 'function') return reject(new Error('GM_xmlhttpRequest không khả dụng'));
      if (signal && signal.aborted) return reject(abortError());

      let u;
      try { u = new URL(url, location.href); } catch (e) { return reject(new Error('URL không hợp lệ: ' + url)); }

      let settled = false;
      let handle = null;
      const done = (fn, v) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        fn(v);
      };
      const onAbort = () => {
        try { handle && handle.abort && handle.abort(); } catch (e) { /* bỏ qua */ }
        done(reject, abortError());
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      try {
        handle = gm.xhr({
          method: 'GET',
          url: u.href,
          headers: Object.assign({ Accept: '*/*' }, extraHeaders(u)),
          responseType: 'arraybuffer',
          anonymous: !!anonymous,
          nocache: true,
          timeout: 300000,
          onprogress: (e) => {
            if (onProgress && e && e.lengthComputable && e.total > 0) {
              try { onProgress(Math.min(1, e.loaded / e.total)); } catch (err) { /* bỏ qua */ }
            }
          },
          onload: (r) => done(resolve, makeResponse(r, u.href)),
          onerror: () => done(reject, new Error('Failed to fetch')),
          ontimeout: () => done(reject, new Error('Hết thời gian chờ')),
          onabort: () => done(reject, abortError()),
        });
      } catch (err) {
        done(reject, err);
      }
    });
  }

  function isSameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  async function wakaFetch(url, opts) {
    const signal = opts && opts.signal;
    const onProgress = opts && opts.onProgress;

    if (isSameOrigin(url)) {
      let resp = await fetch(url, { credentials: 'omit', cache: 'no-store', signal });
      if (!resp.ok) resp = await fetch(url, { credentials: 'include', cache: 'no-store', signal });
      return resp;
    }

    let resp = await gmRequest(url, { anonymous: true, signal, onProgress });
    if (!resp.ok) resp = await gmRequest(url, { anonymous: false, signal, onProgress });
    return resp;
  }

  window.WakaGM = { init, fetch: wakaFetch };
})();
