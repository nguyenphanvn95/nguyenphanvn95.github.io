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

  const log = (...a) => { try { console.log('[Waka OneClick]', ...a); } catch (e) { /* bỏ qua */ } };
  const gmSet = (k, v) => {
    try { gm.setValue(k, v); return true; } catch (e) { log('GM_setValue lỗi:', k, e && e.message); return false; }
  };
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
    if (!p || !p.blob) return;
    log('Reader yêu cầu EPUB qua kênh GM, đang gửi', Math.round(p.blob.size / 1024) + 'KB');
    try {
      const dataUrl = await blobToDataUrl(p.blob);
      // Nếu ghi thất bại (vd. quá dung lượng) → báo lỗi ngay cho Reader thay vì để nó chờ hết giờ
      if (!gmSet('oc:res:' + token, { filename: p.filename, dataUrl })) {
        gmSet('oc:res:' + token, { error: 'Không ghi được EPUB vào bộ nhớ userscript (file quá lớn?)' });
      } else {
        log('Đã ghi EPUB vào kênh GM');
      }
    } catch (err) {
      gmSet('oc:res:' + token, { error: String((err && err.message) || err) });
    }
    drop(token);
  }

  // Gửi trạng thái (tiến trình / lỗi) cho tab Reader để nó hiện lớp phủ "Đang chờ sách từ Waka..."
  function sendState(p) {
    if (!p || !p.target) return;
    try {
      p.target.postMessage(
        p.error
          ? { __wakaReaderHandoff: 1, type: 'error', token: p.token, message: p.error }
          : { __wakaReaderHandoff: 1, type: 'progress', token: p.token, text: p.text, pct: p.pct },
        APP_ORIGIN
      );
    } catch (err) { /* Reader đã đóng / chưa sẵn sàng */ }
  }

  // Ảnh bìa cho lớp phủ của Reader: gửi URL (Reader thử tải trực tiếp) và/hoặc dataURL (tải bằng GM nên không bị hotlink)
  function sendCover(p) {
    if (!p || !p.target || (!p.cover && !p.coverData)) return;
    try {
      p.target.postMessage(
        { __wakaReaderHandoff: 1, type: 'cover', token: p.token, cover: p.cover || '', coverData: p.coverData || '' },
        APP_ORIGIN
      );
    } catch (err) { /* Reader đã đóng / chưa sẵn sàng */ }
  }

  function initWakaSide() {
    window.addEventListener('message', (e) => {
      if (e.origin !== APP_ORIGIN) return;
      const d = e.data;
      if (!d || d.__wakaReaderHandoff !== 1) return;
      const token = String(d.token || '');
      const p = pending.get(token);
      if (!p) return;
      // Người dùng bấm "Hủy bỏ" trên lớp phủ của tab Reader
      if (d.type === 'cancel') { log('Người dùng hủy từ tab Reader'); try { p.onCancel && p.onCancel(); } catch (err) { /* bỏ qua */ } return; }
      if (d.type !== 'ready' || !e.source) return;
      if (!p.blob) {                      // phiên mở sớm: Reader đã sẵn sàng nhưng sách chưa dựng xong
        p.target = e.source;
        log('Reader (mở sớm) đã sẵn sàng, chờ dựng EPUB xong');
        sendCover(p);
        sendState(p);
        return;
      }
      try {
        e.source.postMessage(
          { __wakaReaderHandoff: 1, type: 'epub', token, filename: p.filename, blob: p.blob },
          APP_ORIGIN
        );
        log('Đã gửi EPUB cho Reader qua kênh opener');
        drop(token);
      } catch (err) { log('Kênh opener lỗi, chuyển sang kênh GM:', err && err.message); }
    });
  }

  // Mở bằng window.open → tab Reader có window.opener → EPUB đi qua postMessage (kênh opener),
  // KHÔNG cần userscript chạy trên trang Reader. Chỉ thành công khi còn "user activation".
  function openViaWindow(url) {
    let w = null;
    try { w = window.open(url, '_blank'); } catch (e) { /* bị chặn */ }
    if (w) { log('Mở Reader bằng window.open (kênh opener)'); return true; }
    return false;
  }

  // Mở bằng API của userscript manager → tab không có opener → phải nhờ userscript chạy trên trang Reader (kênh GM).
  function openViaGM(url) {
    try { gm.openInTab(url, { active: true, insert: true, setParent: true }); log('Mở Reader bằng GM_openInTab (kênh GM)'); return true; } catch (e) { return false; }
  }

  function hasActivation() {
    try { return navigator.userActivation ? !!navigator.userActivation.isActive : true; } catch (e) { return true; }
  }

  /**
   * MỞ SỚM (auto-open): phải gọi ĐỒNG BỘ trong sự kiện click "Đọc ngay" — lúc đó window.open còn được
   * phép. Tab Reader mở ngay (có window.opener) và hiện lớp phủ tiến trình; khi EPUB dựng xong thì
   * session.deliver() đẩy sang qua postMessage — người dùng không phải bấm thêm gì.
   * Trả về null nếu trình duyệt vẫn chặn popup → gọi code sẽ dùng luồng cũ (openBlob).
   */
  function prepare() {
    const token = PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const url = READER_URL + '?importToken=' + encodeURIComponent(token);
    let w = null;
    try { w = window.open(url, '_blank'); } catch (e) { /* bị chặn */ }
    if (!w) { log('window.open bị chặn ngay lúc bấm → dùng luồng mở sau khi dựng xong'); return null; }
    log('Đã mở tab Reader sớm, token=' + token);

    const entry = {
      token, blob: null, filename: 'waka.epub', win: w, target: null,
      text: 'Đang chuẩn bị...', pct: 0, error: '', listener: null, timer: null,
      cover: '', coverData: '', onCancel: null,
    };
    pending.set(token, entry);
    try { entry.listener = gm.addValueChangeListener('oc:req:' + token, () => serveViaGM(token)); } catch (e) { /* chỉ kênh opener */ }
    entry.timer = setTimeout(() => drop(token), 30 * 60 * 1000);   // tải + dựng rất lâu vẫn còn hiệu lực

    let lastKey = '';
    return {
      setCover(url) { entry.cover = String(url || ''); sendCover(entry); },
      setCoverData(dataUrl) { entry.coverData = String(dataUrl || ''); sendCover(entry); },
      onCancel(fn) { entry.onCancel = fn; },
      progress(text, pct) {
        entry.text = String(text || '');
        entry.pct = Math.round(Number(pct) || 0);
        const key = entry.text + '|' + entry.pct;
        if (key === lastKey) return;
        lastKey = key;
        sendState(entry);
      },
      // true = đã giao (hoặc đang chờ Reader báo sẵn sàng); false = tab Reader đã bị đóng
      deliver(blob, filename) {
        if (!pending.has(token)) return Promise.resolve(false);
        let closed = false;
        try { closed = !!entry.win.closed; } catch (e) { closed = false; }
        if (closed) { drop(token); return Promise.resolve(false); }
        entry.blob = blob;
        entry.filename = filename || 'waka.epub';
        entry.text = 'Đang chuyển sách sang Reader...';
        entry.pct = 99;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => drop(token), PENDING_TTL_MS);
        if (entry.target) {
          try {
            entry.target.postMessage(
              { __wakaReaderHandoff: 1, type: 'epub', token, filename: entry.filename, blob },
              APP_ORIGIN
            );
            log('Đã gửi EPUB cho Reader (mở sớm)');
            drop(token);
          } catch (err) { log('Kênh opener lỗi, chờ kênh GM:', err && err.message); }
        } else {
          log('Đã dựng xong, chờ Reader báo sẵn sàng');
        }
        return Promise.resolve(true);
      },
      fail(message) {
        entry.error = String(message || 'Lỗi không rõ');
        sendState(entry);
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => drop(token), 60 * 1000);
      },
      close() {
        try { if (!entry.blob) entry.win.close(); } catch (e) { /* bỏ qua */ }
        drop(token);
      },
    };
  }

  /**
   * hooks.askUser({ open, dismiss }) — (tuỳ chọn) được gọi khi trình duyệt sẽ chặn popup (đã hết user
   * activation sau khi tải sách). UI hiển thị nút; khi người dùng bấm nút thì gọi open() TRONG sự kiện
   * click để window.open được phép → tab Reader có opener → không phụ thuộc userscript trên Reader.
   */
  function openBlob(blob, filename, hooks) {
    return new Promise((resolve, reject) => {
      if (!(blob instanceof Blob)) return reject(new Error('Không có dữ liệu EPUB'));
      const token = PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      const entry = { blob, filename: filename || 'waka.epub', listener: null, timer: null };
      pending.set(token, entry);
      log('Chuẩn bị chuyển EPUB', Math.round(blob.size / 1024) + 'KB, token=' + token);
      try {
        entry.listener = gm.addValueChangeListener('oc:req:' + token, () => serveViaGM(token));
      } catch (e) { /* không có kênh GM: chỉ còn kênh opener */ }
      entry.timer = setTimeout(() => drop(token), PENDING_TTL_MS);

      const url = READER_URL + '?importToken=' + encodeURIComponent(token);
      const fail = () => { drop(token); reject(new Error('Không mở được tab Reader — hãy cho phép popup cho waka.vn')); };

      // 1) Còn user activation (sách nhỏ, tải nhanh) → mở thẳng bằng window.open
      if (hasActivation() && openViaWindow(url)) return resolve();

      // 2) Hết activation → xin người dùng bấm 1 nút để có cử chỉ hợp lệ (đáng tin cậy nhất)
      if (hooks && typeof hooks.askUser === 'function') {
        log('Hết user activation → chờ người dùng bấm nút "Mở trong Reader"');
        hooks.askUser({
          open() {
            if (openViaWindow(url)) return resolve();
            if (openViaGM(url)) return resolve();       // popup vẫn bị chặn → thử kênh GM
            fail();
          },
          dismiss() {
            drop(token);
            const err = new Error('Đã đóng');
            err.isCancel = true;
            reject(err);
          },
        });
        return;
      }

      // 3) Không có UI để hỏi → kênh GM như trước
      if (openViaGM(url)) return resolve();
      fail();
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
      log('Reader yêu cầu EPUB, token=' + token);
      try {
        listener = gm.addValueChangeListener(resKey, (_n, _o, val) => {
          if (val && val.dataUrl) finish({ ok: true, filename: val.filename || 'waka.epub', dataUrl: val.dataUrl });
          else if (val && val.error) finish({ ok: false, error: val.error });
        });
      } catch (err) {
        return reply(d.id, { ok: false, error: 'Trình quản lý userscript không hỗ trợ GM_addValueChangeListener' });
      }
      timer = setTimeout(() => finish({ ok: false, error: 'Hết thời gian chờ tab waka.vn' }), 120000);
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

  window.WakaHandoff = { init, prepare, openBlob, READER_URL };
})();
