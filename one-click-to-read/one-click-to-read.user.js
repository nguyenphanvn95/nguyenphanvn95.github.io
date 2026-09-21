// ==UserScript==
// @name         Waka One Click to Read
// @name:vi      Waka One Click to Read — Đọc ngay 1 chạm
// @namespace    https://nguyenphanvn95.github.io/one-click-to-read/
// @version      1.0.0
// @description  Chèn nút "Đọc ngay" lên bìa sách Waka (ẩn nút đọc mặc định): bấm là tự lấy link, tải + dựng EPUB, nhúng metadata rồi mở thẳng trong Waka EBook Reader. Chuyển từ Waka Toolkit 6.9.2, chạy được trên desktop và mobile.
// @description:vi  Chèn nút "Đọc ngay" lên bìa sách Waka (ẩn nút đọc mặc định): bấm là tự lấy link, tải + dựng EPUB, nhúng metadata rồi mở thẳng trong Waka EBook Reader.
// @author       nguyenphanvn95
// @license      MIT
// @icon         https://nguyenphanvn95.github.io/one-click-to-read/assets/icons/icon48.png
// @homepageURL  https://nguyenphanvn95.github.io/one-click-to-read/
// @downloadURL  https://nguyenphanvn95.github.io/one-click-to-read/one-click-to-read.user.js
// @updateURL    https://nguyenphanvn95.github.io/one-click-to-read/one-click-to-read.user.js
// @match        https://waka.vn/*
// @exclude      https://waka.vn/reader/*
// @exclude      https://waka.vn/reader-comic/*
// @exclude      https://waka.vn/sach-noi/*
// @exclude      https://waka.vn/hieu-soi/*
// @exclude      https://waka.vn/truyen-tranh/*
// @match        https://nguyenphanvn95.github.io/waka-ebook-reader/*
// @require      https://nguyenphanvn95.github.io/one-click-to-read/lib/jszip.min.js?v=1.0.0
// @require      https://nguyenphanvn95.github.io/one-click-to-read/lib/crypto-js.min.js?v=1.0.0
// @require      https://nguyenphanvn95.github.io/one-click-to-read/src/epub-decode.js?v=1.0.0
// @require      https://nguyenphanvn95.github.io/one-click-to-read/src/epub-builder.js?v=1.0.0
// @require      https://nguyenphanvn95.github.io/one-click-to-read/src/gm-fetch.js?v=1.0.0
// @require      https://nguyenphanvn95.github.io/one-click-to-read/src/metadata-injector.js?v=1.0.0
// @require      https://nguyenphanvn95.github.io/one-click-to-read/src/reader-handoff.js?v=1.0.0
// @require      https://nguyenphanvn95.github.io/one-click-to-read/src/one-click-reader.js?v=1.0.0
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @connect      waka.vn
// @connect      beta-api.waka.vn
// @connect      store.waka.vn
// @connect      vegacdn.vn
// @connect      *
// ==/UserScript==

/*
 * Toàn bộ mã nằm ở https://nguyenphanvn95.github.io/one-click-to-read/ và được nạp bằng @require:
 *   lib/jszip.min.js, lib/crypto-js.min.js   thư viện (giống extension)
 *   src/epub-decode.js, src/epub-builder.js  giải mã XHTML + dựng EPUB (giống extension)
 *   src/gm-fetch.js                          WakaGM  — mạng qua GM_xmlhttpRequest (thay background.js)
 *   src/metadata-injector.js                 nhúng metadata + ảnh bìa vào EPUB
 *   src/reader-handoff.js                    WakaHandoff — đẩy EPUB sang Waka EBook Reader
 *   src/one-click-reader.js                  nút "Đọc ngay", ẩn nút gốc, luồng tải, lớp phủ tiến trình
 *
 * Khi đổi file trong các thư mục trên, tăng "?v=" ở @require và @version để trình quản lý
 * userscript tải lại (nó lưu cache các file @require).
 */
/* global GM_xmlhttpRequest, GM_addStyle, GM_openInTab, GM_setValue, GM_deleteValue,
          GM_addValueChangeListener, GM_removeValueChangeListener,
          WakaGM, WakaHandoff, WakaOneClick */
(function () {
  'use strict';

  // Các hàm GM_* chỉ tồn tại trong phạm vi userscript → truyền vào module thay vì để module tự tìm.
  const gm = {
    xhr: GM_xmlhttpRequest,
    addStyle: typeof GM_addStyle === 'function' ? GM_addStyle : null,
    openInTab: GM_openInTab,
    setValue: GM_setValue,
    deleteValue: GM_deleteValue,
    addValueChangeListener: GM_addValueChangeListener,
    removeValueChangeListener: GM_removeValueChangeListener,
  };

  WakaHandoff.init(gm);              // origin của Reader: nhận yêu cầu "consume"; waka.vn: phục vụ EPUB

  if (location.hostname === 'waka.vn') {
    WakaGM.init(gm);
    WakaOneClick.start(gm);          // chèn nút "Đọc ngay", ẩn nút đọc gốc
  }
})();
