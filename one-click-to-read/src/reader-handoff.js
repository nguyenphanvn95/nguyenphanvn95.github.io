/**
 * reader-handoff.js — WakaHandoff
 *
 * Thay cho `openReaderWithEpub` (background.js) của extension: đẩy EPUB vừa dựng
 * vào Waka EBook Reader (https://nguyenphanvn95.github.io/waka-ebook-reader/).
 *
 * Giao thức (trùng với src/platform-shim.js của Reader, token dạng "oc_…"):
 *   1. waka.vn mở  <reader>/src/reader.html?importToken=<token>
 *   2. Reader gọi chrome.runtime.sendMessage({action:"consumeReaderEpub", token}) (shim)
 *        a) kênh opener : Reader postMessage {type:"ready"} cho window.opener
 *           → waka.vn trả lại {type:"epub", blob}
 *        b) kênh GM     : (tab mở bằng GM_openInTab, không có opener) shim gửi op "consume"
 *           tới userscript trên origin của Reader → ghi khoá oc:req:<token> →
 *           tab waka.vn ghi lại oc:res:<token> = {filename, dataUrl}
 *
 * API:  WakaHandoff.init(gm)               — gọi ở cả waka.vn lẫn origin của Reader
 *       WakaHandoff.openBlob(blob, name)   — (waka.vn) mở Reader và chuyển EPUB sang
 */
(function () {
  'use strict';

  const APP_ORIGIN = 'https://nguyenphanvn95.github.io';
  const READER_URL = APP_ORIGIN + '/waka-ebook-reader/src/reader.html';
  const PREFIX = 'oc_';               // token của script này (Reader-script dùng "reader_")
  const PENDING_TTL_MS = 5 * 60 * 1000;

  let gm = null;
  const pending = new Map();          // token → { blob, filename, listener, timer }

  const gmSet = (k, v) => { try { gm.setValue(k, v); } catch (e) { /* bỏ qua */ } };
  const gmDel = (k) => { try { gm.deleteValue(k); } catch (e) { /* bỏ qua */ } };

  // Firefox: đối tượng tạo trong sandbox phải cloneInto() thì trang mới đọc được.
  function toPage(obj) {
    try { return typeof cloneInto === 'function' ? cloneInto(obj, window) : obj; } catch (e) { return obj; }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('Không đọc được EPUB'));
      fr.readAsDataURL(blob);
    });
  }

  /* ---------------------------------------------------------------- phía waka.vn */
  function drop(token) {
    const p = pending.get(token);
    if (!p) return;
    pending.delete(token);
    clearTimeout(p.timer);
    try { if (p.listener != null) gm.removeValueChangeListener(p.listener); } catch (e) { /* bỏ qua */ }
    gmDel('oc:req:' + token);
  }

  async function serveViaGM(token) {
    const p = pending.get(token);
    if (!p) return;
    try {
      gmSet('oc:res:' + token, { filename: p.filename, dataUrl: await blobToDataUrl(p.blob) });
    } catch (err) {
      gmSet('oc:res:' + token, { error: String((err && err.message) || err) });
    }
    drop(token);
  }

  function initWakaSide() {
    window.addEventListener('message', (e) => {
      if (e.origin !== APP_ORIGIN) return;
      const d = e.data;
      if (!d || d.__wakaReaderHandoff !== 1 || d.type !== 'ready') return;
      const token = String(d.token || '');
      const p = pending.get(token);
      if (!p || !e.source) return;
      try {
        e.source.postMessage(
          { __wakaReaderHandoff: 1, type: 'epub', token, filename: p.filename, blob: p.blob },
          APP_ORIGIN
        );
        drop(token);
      } catch (err) { /* để kênh GM xử lý */ }
    });
  }

  function openTab(url) {
    let w = null;
    try { w = window.open(url, '_blank'); } catch (e) { /* bị chặn */ }
    if (w) return true;
    // Đã qua vài giây tải sách nên popup thường bị chặn → dùng API của userscript manager.
    try { gm.openInTab(url, { active: true, insert: true, setParent: true }); return true; } catch (e) { return false; }
  }

  function openBlob(blob, filename) {
    return new Promise((resolve, reject) => {
      if (!(blob instanceof Blob)) return reject(new Error('Không có dữ liệu EPUB'));
      const token = PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      const entry = { blob, filename: filename || 'waka.epub', listener: null, timer: null };
      pending.set(token, entry);
      try {
        entry.listener = gm.addValueChangeListener('oc:req:' + token, () => serveViaGM(token));
      } catch (e) { /* không có kênh GM: chỉ còn kênh opener */ }
      entry.timer = setTimeout(() => drop(token), PENDING_TTL_MS);

      if (!openTab(READER_URL + '?importToken=' + encodeURIComponent(token))) {
        drop(token);
        return reject(new Error('Trình duyệt chặn cửa sổ mới — hãy cho phép popup cho waka.vn'));
      }
      resolve();
    });
  }

  /* ---------------------------------------------------------------- phía Reader */
  function initReaderSide() {
    const mark = () => {
      if (document.documentElement) document.documentElement.setAttribute('data-waka-oneclick-userscript', '1');
      else setTimeout(mark, 0);
    };
    mark();

    const reply = (id, data) => {
      window.postMessage(toPage(Object.assign({ __wakaReader: 1, dir: 'us->page', id }, data)), APP_ORIGIN);
    };

    function opConsume(d) {
      const token = String(d.token || '');
      const reqKey = 'oc:req:' + token;
      const resKey = 'oc:res:' + token;
      let listener = null;
      let timer = null;
      let done = false;
      const finish = (payload) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { if (listener != null) gm.removeValueChangeListener(listener); } catch (e) { /* bỏ qua */ }
        gmDel(resKey);
        gmDel(reqKey);
        reply(d.id, payload);
      };
      try {
        listener = gm.addValueChangeListener(resKey, (_n, _o, val) => {
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
      if (!d || d.__wakaReader !== 1 || d.dir !== 'page->us' || d.op !== 'consume') return;
      // Chỉ nhận token của mình; token "reader_…" thuộc userscript waka-ebook-reader.
      if (String(d.token || '').indexOf(PREFIX) !== 0) return;
      opConsume(d);
    });
  }

  function init(api) {
    gm = api;
    if (location.origin === APP_ORIGIN) initReaderSide();
    else initWakaSide();
  }

  window.WakaHandoff = { init, openBlob, READER_URL };
})();
