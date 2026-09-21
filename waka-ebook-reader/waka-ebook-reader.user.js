// ==UserScript==
// @name         Waka EBook Reader
// @name:vi      Waka EBook Reader — Trình đọc EPUB
// @namespace    https://nguyenphanvn95.github.io/waka-ebook-reader/
// @version      1.1.0
// @description  Trình đọc EPUB của Waka Toolkit 6.9.5 dưới dạng userscript: thư viện sách, chú thích, đọc to (Edge TTS), tự động cuộn, font chữ tuỳ chỉnh, nhạc nền, giao diện desktop + mobile. Bong bóng nổi trên waka.vn: mở Reader, nhập file EPUB, ẩn nút.
// @description:vi  Trình đọc EPUB của Waka Toolkit 6.9.5 dưới dạng userscript: thư viện sách, chú thích, đọc to (Edge TTS), tự động cuộn, font chữ tuỳ chỉnh, nhạc nền, giao diện desktop + mobile. Bong bóng nổi trên waka.vn: mở Reader, nhập file EPUB, ẩn nút.
// @author       nguyenphanvn95
// @license      MIT
// @icon         https://nguyenphanvn95.github.io/waka-ebook-reader/assets/icons/icon48.png
// @homepageURL  https://nguyenphanvn95.github.io/waka-ebook-reader/
// @downloadURL  https://nguyenphanvn95.github.io/waka-ebook-reader/waka-ebook-reader.user.js
// @updateURL    https://nguyenphanvn95.github.io/waka-ebook-reader/waka-ebook-reader.user.js
// @match        https://waka.vn/*
// @match        https://nguyenphanvn95.github.io/waka-ebook-reader/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @grant        GM_info
// @connect      *
// ==/UserScript==

/*
 * Cấu trúc:
 *  - Trên nguyenphanvn95.github.io/waka-ebook-reader/*  → "phía Reader":
 *      + đánh dấu html[data-waka-reader-userscript] để trang biết có userscript
 *      + cầu nối fetch  : trang Reader gọi GM_xmlhttpRequest để nhập EPUB từ URL bị CORS chặn
 *      + cầu nối consume: nhận EPUB do trang waka.vn gửi qua kênh GM (khi window.opener bị cắt)
 *  - Trên waka.vn → "phía Waka":
 *      + bong bóng nổi (icon48.png, kéo được, nhớ vị trí). Chạm vào → 3 lựa chọn:
 *        Mở EPUB Reader · Nhập file EPUB · Ẩn nút
 *      + menu Tampermonkey/Violentmonkey: cùng các lệnh trên (Ẩn/Hiện nút nổi để bật lại nút đã ẩn)
 *      + chuyển EPUB sang Reader: postMessage qua window.opener (chính), GM_setValue (dự phòng)
 *
 * Toàn bộ mã trình đọc (giống hệt extension gốc, gồm Auto Scroll + font tuỳ chỉnh) nằm trên máy chủ tĩnh,
 * không nhúng trong file này → cập nhật Reader không cần cập nhật userscript.
 *
 * v1.1.0
 *  - Nút nổi dùng icon48.png của Reader làm bong bóng (thay nút cam + biểu tượng sách).
 *    Nếu CSP của trang chặn ảnh từ github.io → tự tải ảnh qua GM_xmlhttpRequest (data URL), cuối cùng mới về biểu tượng SVG.
 *  - Nút tự gắn lại nếu trang (SPA) gỡ nó khỏi DOM; đồng bộ Ẩn/Hiện giữa các tab waka.vn đang mở.
 *  - Sửa rò rỉ listener khi ẩn rồi hiện lại nút nhiều lần.
 */
/* global GM_xmlhttpRequest, GM_registerMenuCommand, GM_getValue, GM_setValue, GM_deleteValue,
          GM_addValueChangeListener, GM_removeValueChangeListener, GM_openInTab, GM_info, cloneInto */
(function () {
  'use strict';

  const APP_ORIGIN = 'https://nguyenphanvn95.github.io';
  const APP_BASE = APP_ORIGIN + '/waka-ebook-reader/';
  const READER_URL = APP_BASE + 'src/reader.html';
  const ICON_URL = APP_BASE + 'assets/icons/icon48.png';
  const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '1.1.0';

  /* ---------------------------------------------------------------- tiện ích GM */
  const gmGet = (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } };
  const gmSet = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* bỏ qua */ } };
  const gmDel = (k) => { try { GM_deleteValue(k); } catch (e) { /* bỏ qua */ } };

  // Firefox: đối tượng tạo trong sandbox phải cloneInto() mới đọc được từ trang.
  function toPage(obj) {
    try { return typeof cloneInto === 'function' ? cloneInto(obj, window) : obj; } catch (e) { return obj; }
  }

  function openTab(url) {
    let w = null;
    try { w = window.open(url, '_blank'); } catch (e) { /* bị chặn */ }
    if (w) return w;
    try { GM_openInTab(url, { active: true, insert: true, setParent: true }); return true; } catch (e) { return null; }
  }

  /* ================================================================
   *  PHÍA READER  (nguyenphanvn95.github.io/waka-ebook-reader/*)
   * ================================================================ */
  function initReaderSide() {
    const mark = () => {
      if (document.documentElement) document.documentElement.setAttribute('data-waka-reader-userscript', VERSION);
      else setTimeout(mark, 0);
    };
    mark();

    const reply = (id, data) => {
      const msg = Object.assign({ __wakaReader: 1, dir: 'us->page', id }, data);
      window.postMessage(toPage(msg), APP_ORIGIN);
    };

    // op "fetch": tải URL bất kỳ (vượt CORS) → trả ArrayBuffer + header
    function opFetch(d) {
      const url = String(d.url || '');
      if (!/^https?:\/\//i.test(url)) return reply(d.id, { ok: false, error: 'URL không hợp lệ' });
      try {
        GM_xmlhttpRequest({
          method: d.method === 'HEAD' ? 'HEAD' : 'GET',
          url,
          headers: { Accept: '*/*' },
          responseType: 'arraybuffer',
          anonymous: true,          // không gửi cookie của trang đích
          timeout: 120000,
          onload: (r) => reply(d.id, {
            ok: true,
            status: r.status,
            statusText: r.statusText || '',
            headers: r.responseHeaders || '',
            buffer: r.response,
            finalUrl: r.finalUrl || url,
          }),
          onerror: () => reply(d.id, { ok: false, error: 'Lỗi mạng khi tải ' + url }),
          ontimeout: () => reply(d.id, { ok: false, error: 'Hết thời gian tải ' + url }),
          onabort: () => reply(d.id, { ok: false, error: 'Đã huỷ' }),
        });
      } catch (err) {
        reply(d.id, { ok: false, error: String((err && err.message) || err) });
      }
    }

    // op "consume": xin tab waka.vn gửi EPUB qua kênh GM_setValue/GM_addValueChangeListener
    function opConsume(d) {
      const token = String(d.token || '');
      // Token "oc_…" thuộc userscript one-click-to-read → bỏ qua, để script đó tự trả lời.
      if (token.indexOf('oc_') === 0) return;
      if (!token) return reply(d.id, { ok: false, error: 'Thiếu token' });
      const reqKey = 'wr:req:' + token;
      const resKey = 'wr:res:' + token;
      let listener = null;
      let timer = null;
      let done = false;
      const finish = (payload) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { if (listener != null) GM_removeValueChangeListener(listener); } catch (e) { /* bỏ qua */ }
        gmDel(resKey);
        gmDel(reqKey);
        reply(d.id, payload);
      };
      try {
        listener = GM_addValueChangeListener(resKey, (_name, _old, val) => {
          if (val && val.dataUrl) finish({ ok: true, filename: val.filename || 'waka.epub', dataUrl: val.dataUrl });
          else if (val && val.error) finish({ ok: false, error: val.error });
        });
      } catch (err) {
        return reply(d.id, { ok: false, error: 'Trình quản lý userscript không hỗ trợ GM_addValueChangeListener' });
      }
      timer = setTimeout(() => finish({ ok: false, error: 'Hết thời gian chờ tab waka.vn' }), 60000);
      gmSet(reqKey, Date.now());
    }

    window.addEventListener('message', (e) => {
      if (e.origin !== APP_ORIGIN) return;
      const d = e.data;
      if (!d || d.__wakaReader !== 1 || d.dir !== 'page->us') return;
      if (d.op === 'fetch') opFetch(d);
      else if (d.op === 'consume') opConsume(d);
      else reply(d.id, { ok: false, error: 'Không hỗ trợ thao tác: ' + d.op });
    });
  }

  /* ================================================================
   *  PHÍA WAKA  (waka.vn)
   * ================================================================ */
  function initWakaSide() {
    const lang = /^vi/i.test(navigator.language || 'vi') ? 'vi' : 'en';
    const STR = {
      vi: {
        title: 'EPUB Reader',
        open: 'Mở EPUB Reader',
        pick: 'Nhập file EPUB…',
        hide: 'Ẩn nút này',
        toggle: 'Ẩn/Hiện nút nổi',
        notEpub: 'Vui lòng chọn file .epub',
        blocked: 'Trình duyệt chặn cửa sổ mới — hãy cho phép popup cho waka.vn rồi thử lại.',
        hiddenNote: 'Đã ẩn nút. Bật lại trong menu Tampermonkey/Violentmonkey → "Ẩn/Hiện nút nổi".',
        opening: 'Đang mở Reader…',
      },
      en: {
        title: 'EPUB Reader',
        open: 'Open EPUB Reader',
        pick: 'Import EPUB file…',
        hide: 'Hide this button',
        toggle: 'Hide/Show floating button',
        notEpub: 'Please choose an .epub file',
        blocked: 'Pop-up blocked — allow pop-ups for waka.vn and try again.',
        hiddenNote: 'Button hidden. Re-enable it from the Tampermonkey/Violentmonkey menu → "Hide/Show floating button".',
        opening: 'Opening Reader…',
      },
    }[lang];

    /* ---------- chuyển EPUB sang Reader ---------- */
    const pending = new Map(); // token → { blob, filename, listener, timer }

    function drop(token) {
      const p = pending.get(token);
      if (!p) return;
      pending.delete(token);
      clearTimeout(p.timer);
      try { if (p.listener != null) GM_removeValueChangeListener(p.listener); } catch (e) { /* bỏ qua */ }
      gmDel('wr:req:' + token);
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => reject(fr.error || new Error('Không đọc được file'));
        fr.readAsDataURL(blob);
      });
    }

    // Kênh chính: tab Reader báo "ready" qua window.opener → gửi Blob lại bằng postMessage.
    window.addEventListener('message', (e) => {
      if (e.origin !== APP_ORIGIN) return;
      const d = e.data;
      if (!d || d.__wakaReaderHandoff !== 1 || d.type !== 'ready') return;
      const p = pending.get(String(d.token));
      if (!p || !e.source) return;
      try {
        e.source.postMessage(
          { __wakaReaderHandoff: 1, type: 'epub', token: String(d.token), filename: p.filename, blob: p.blob },
          APP_ORIGIN
        );
        drop(String(d.token));
      } catch (err) { /* để kênh GM xử lý */ }
    });

    // Kênh dự phòng: Reader ghi wr:req:<token> → ta trả wr:res:<token> (dataUrl).
    async function serveViaGM(token) {
      const p = pending.get(token);
      if (!p) return;
      try {
        const dataUrl = await blobToDataUrl(p.blob);
        gmSet('wr:res:' + token, { filename: p.filename, dataUrl });
      } catch (err) {
        gmSet('wr:res:' + token, { error: String((err && err.message) || err) });
      }
      drop(token);
    }

    function openReader(extraQuery) {
      const url = READER_URL + (extraQuery ? '?' + extraQuery : '');
      if (!openTab(url)) toast(STR.blocked);
    }

    function openWithBlob(blob, filename) {
      const token = 'reader_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      const entry = { blob, filename: filename || 'waka.epub', listener: null, timer: null };
      pending.set(token, entry);
      try {
        entry.listener = GM_addValueChangeListener('wr:req:' + token, () => serveViaGM(token));
      } catch (e) { /* không có kênh GM: chỉ dùng opener */ }
      entry.timer = setTimeout(() => drop(token), 5 * 60 * 1000);
      toast(STR.opening);
      if (!openTab(READER_URL + '?importToken=' + encodeURIComponent(token))) {
        drop(token);
        toast(STR.blocked);
      }
    }

    /* ---------- giao diện: bong bóng nổi trong Shadow DOM ---------- */
    let host = null;
    let root = null;
    let toastTimer = null;
    let hidden = !!gmGet('fabHidden', false);
    let ui = null; // { wrap, fab, menu, input, onDocDown, onResize }

    function toast(text) {
      if (!root) return;
      const t = root.querySelector('.toast');
      t.textContent = text;
      t.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('on'), 3500);
    }

    const CSS = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .wrap { position: fixed; z-index: 2147483646; touch-action: none; }
      /* Bong bóng = chính icon48.png (đã là hình tròn, viền trắng, nền trong suốt) */
      .fab {
        display: block; width: 48px; height: 48px; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
        background: transparent; color: #fff; opacity: .95; user-select: none; -webkit-user-select: none;
        filter: drop-shadow(0 3px 7px rgba(0,0,0,.38));
        transition: transform .15s ease, opacity .15s ease, filter .15s ease;
        -webkit-tap-highlight-color: transparent; touch-action: none;
      }
      .fab:hover { opacity: 1; transform: scale(1.07); filter: drop-shadow(0 5px 11px rgba(0,0,0,.45)); }
      .fab:active { transform: scale(.94); }
      .fab:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .fab img { display: block; width: 100%; height: 100%; border-radius: 50%; pointer-events: none; -webkit-user-drag: none; }
      /* Dự phòng khi không tải được ảnh: nút cam + biểu tượng sách như bản 1.0.x */
      .fab.fallback { background: #c17a4f; display: flex; align-items: center; justify-content: center; }
      .fab.fallback svg { width: 26px; height: 26px; pointer-events: none; }
      .menu {
        position: absolute; min-width: 230px; padding: 6px; border-radius: 12px;
        background: #1e2430; color: #e6e9ee; box-shadow: 0 10px 34px rgba(0,0,0,.5);
        border: 1px solid rgba(255,255,255,.1); display: none; flex-direction: column; gap: 2px;
      }
      .menu.on { display: flex; }
      .menu.up { bottom: 58px; } .menu.down { top: 58px; }
      .menu.left { right: 0; } .menu.right { left: 0; }
      .item {
        display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 12px; border: 0; border-radius: 8px;
        background: none; color: inherit; font-size: 14px; text-align: left; cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .item:hover, .item:focus-visible { background: rgba(255,255,255,.09); outline: none; }
      .item .ic { width: 20px; text-align: center; flex: none; }
      .toast {
        position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
        max-width: min(92vw, 420px); padding: 10px 16px; border-radius: 10px; background: rgba(20,24,32,.95); color: #fff;
        font-size: 13px; line-height: 1.4; box-shadow: 0 6px 24px rgba(0,0,0,.4); opacity: 0; pointer-events: none;
        transition: opacity .2s; z-index: 2147483647;
      }
      .toast.on { opacity: 1; }
      input[type=file] { display: none; }
    `;

    const ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4H9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H3.5A1.5 1.5 0 0 1 2 16z"/><path d="M22 5.5A1.5 1.5 0 0 0 20.5 4H15a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5h6a1.5 1.5 0 0 0 1.5-1.5z"/></svg>';

    // Nạp icon cho bong bóng: URL trực tiếp → (nếu CSP của trang chặn) data URL tải qua GM → biểu tượng SVG.
    // data URL tải được sẽ nhớ trong GM storage để lần sau khỏi phải thử lại đường trực tiếp.
    function setupIcon(fab) {
      const img = fab.querySelector('img');
      const cache = gmGet('iconCache', null);
      const cached = cache && cache.url === ICON_URL && /^data:image\//.test(cache.data || '') ? cache.data : '';
      let stage = cached ? 'data' : 'direct';
      const toFallback = () => { fab.classList.add('fallback'); fab.innerHTML = ICON_SVG; };
      img.addEventListener('error', () => {
        if (stage !== 'direct') return toFallback();
        stage = 'data';
        try {
          GM_xmlhttpRequest({
            method: 'GET', url: ICON_URL, responseType: 'blob', anonymous: true, timeout: 20000,
            onload: (r) => {
              if (r.status !== 200 || !r.response) return toFallback();
              blobToDataUrl(r.response).then((data) => {
                if (!/^data:image\//.test(data)) return toFallback();
                gmSet('iconCache', { url: ICON_URL, data });
                img.src = data;
              }, toFallback);
            },
            onerror: toFallback,
            ontimeout: toFallback,
          });
        } catch (e) { toFallback(); }
      });
      img.src = cached || ICON_URL;
    }

    function mountUI() {
      if (host || hidden || !document.body) return;
      host = document.createElement('div');
      host.id = 'waka-ebook-reader-fab';
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <div class="wrap">
          <div class="menu up left" role="menu">
            <button class="item" data-act="open" role="menuitem"><span class="ic">📖</span><span>${STR.open}</span></button>
            <button class="item" data-act="pick" role="menuitem"><span class="ic">📂</span><span>${STR.pick}</span></button>
            <button class="item" data-act="hide" role="menuitem"><span class="ic">🙈</span><span>${STR.hide}</span></button>
          </div>
          <button class="fab" type="button" aria-label="${STR.title}" title="${STR.title}"><img alt="" draggable="false"></button>
        </div>
        <input type="file" accept=".epub,application/epub+zip">
        <div class="toast" role="status"></div>`;
      // Constructable stylesheet không bị CSP `style-src` của trang chặn; dự phòng bằng thẻ <style>.
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [sheet];
      } catch (e) {
        const st = document.createElement('style');
        st.textContent = CSS;
        root.prepend(st);
      }
      document.body.appendChild(host);

      const wrap = root.querySelector('.wrap');
      const fab = root.querySelector('.fab');
      const menu = root.querySelector('.menu');
      const input = root.querySelector('input[type=file]');
      const SIZE = 48;
      setupIcon(fab);

      // --- vị trí (kéo được, nhớ lại) ---
      const clampPos = (x, y) => ({
        x: Math.min(Math.max(4, x), Math.max(4, window.innerWidth - SIZE - 4)),
        y: Math.min(Math.max(4, y), Math.max(4, window.innerHeight - SIZE - 4)),
      });
      let pos = clampPos(...(() => {
        const s = gmGet('fabPos', null);
        return s && typeof s.x === 'number' ? [s.x, s.y] : [window.innerWidth - SIZE - 14, window.innerHeight - SIZE - 96];
      })());
      const place = () => {
        pos = clampPos(pos.x, pos.y);
        wrap.style.left = pos.x + 'px';
        wrap.style.top = pos.y + 'px';
        menu.classList.toggle('up', pos.y > window.innerHeight / 2);
        menu.classList.toggle('down', pos.y <= window.innerHeight / 2);
        menu.classList.toggle('left', pos.x > window.innerWidth / 2);
        menu.classList.toggle('right', pos.x <= window.innerWidth / 2);
      };
      place();

      let drag = null;
      fab.addEventListener('pointerdown', (e) => {
        drag = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
        try { fab.setPointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
      });
      fab.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) < 7) return;
        drag.moved = true;
        menu.classList.remove('on');
        pos = clampPos(drag.ox + dx, drag.oy + dy);
        place();
      });
      const endDrag = () => {
        if (!drag) return;
        if (drag.moved) gmSet('fabPos', pos);
        else menu.classList.toggle('on');
        drag = null;
      };
      fab.addEventListener('pointerup', endDrag);
      fab.addEventListener('pointercancel', () => { drag = null; });
      fab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menu.classList.toggle('on'); }
      });

      // đóng menu khi chạm ra ngoài — listener gắn ở document nên phải gỡ khi unmount
      const onDocDown = (e) => {
        if (!menu.classList.contains('on')) return;
        const path = e.composedPath();
        if (path[0] !== fab && !path.includes(menu)) menu.classList.remove('on');
      };
      document.addEventListener('pointerdown', onDocDown, true);
      window.addEventListener('resize', place);

      menu.addEventListener('click', (e) => {
        const btn = e.target.closest('.item');
        if (!btn) return;
        menu.classList.remove('on');
        const act = btn.dataset.act;
        if (act === 'open') openReader();
        else if (act === 'pick') { input.value = ''; input.click(); }
        else if (act === 'hide') setHidden(true, true);
      });

      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!/\.epub$/i.test(file.name) && file.type !== 'application/epub+zip') { toast(STR.notEpub); return; }
        openWithBlob(file, file.name);
      });

      ui = { wrap, fab, menu, input, onDocDown, onResize: place };
    }

    function unmountUI() {
      if (ui) {
        document.removeEventListener('pointerdown', ui.onDocDown, true);
        window.removeEventListener('resize', ui.onResize);
      }
      if (host) host.remove();
      host = null;
      root = null;
      ui = null;
    }

    function setHidden(value, notify) {
      hidden = !!value;
      gmSet('fabHidden', hidden);
      if (hidden) {
        // toast cần root → hiện trước rồi mới gỡ
        if (notify) toast(STR.hiddenNote);
        const h = host;
        setTimeout(() => { if (hidden && host === h) unmountUI(); }, notify ? 3600 : 0);
      } else {
        mountUI();
      }
    }

    // Trang waka.vn là SPA: nếu framework thay/gỡ <body> hoặc con của nó thì gắn bong bóng lại.
    function watchHost() {
      if (typeof MutationObserver === 'undefined') return;
      const check = () => {
        if (host && !hidden && !host.isConnected && document.body) document.body.appendChild(host);
      };
      const mo = new MutationObserver(check);
      mo.observe(document.documentElement, { childList: true });
      if (document.body) mo.observe(document.body, { childList: true });
    }

    /* ---------- menu Tampermonkey / Violentmonkey ---------- */
    try {
      GM_registerMenuCommand('📖 ' + STR.open, () => openReader());
      GM_registerMenuCommand('📂 ' + STR.pick, () => {
        if (hidden) setHidden(false, false);
        const i = root && root.querySelector('input[type=file]');
        if (i) { i.value = ''; i.click(); }
      });
      GM_registerMenuCommand('👁 ' + STR.toggle, () => setHidden(!hidden, false));
    } catch (e) { /* GM_registerMenuCommand không có */ }

    // Đồng bộ Ẩn/Hiện giữa các tab waka.vn đang mở
    try {
      GM_addValueChangeListener('fabHidden', (_name, _old, val, remote) => {
        if (!remote) return;
        hidden = !!val;
        if (hidden) unmountUI(); else mountUI();
      });
    } catch (e) { /* không có GM_addValueChangeListener */ }

    const start = () => { mountUI(); watchHost(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  /* ---------------------------------------------------------------- khởi động */
  if (location.origin === APP_ORIGIN) initReaderSide();
  else if (location.hostname === 'waka.vn') initWakaSide();
})();
