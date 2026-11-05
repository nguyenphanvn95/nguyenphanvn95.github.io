// ==UserScript==
// @name         Duolingo – Ẩn popup "Trải nghiệm trọn vẹn cùng ứng dụng"
// @name:en      Duolingo – Hide "open in app" popup
// @namespace    https://github.com/bsha/userscripts
// @version      1.0.0
// @description  Tự động đóng/ẩn popup nhắc mở ứng dụng Duolingo khi học trên trình duyệt di động.
// @match        https://www.duolingo.com/*
// @match        https://*.duolingo.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Điểm neo ổn định: nút "HỌC TRÊN ỨNG DỤNG" là thẻ <a> có nhãn tracking này.
  // (Class của Duolingo bị hash và đổi theo từng bản build nên không dùng class.)
  const APP_LINK = 'a[href*="mobile_web_to_app_conversion"]';

  // 1) CSS: ẩn ngay lập tức để không bị nháy popup trước khi JS kịp chạy.
  const style = document.createElement('style');
  style.textContent = `
    #overlays [data-focus-lock-disabled]:has(${APP_LINK}),
    #overlays:has(${APP_LINK}) > div[style*="pointer-events: none"] {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  // 2) JS: bấm nút "Học tiếp trên trình duyệt" để Duolingo tự đóng popup
  //    đúng cách (gỡ backdrop, mở lại cuộn trang). Nếu không được thì xoá thẳng.
  function dismiss() {
    const link = document.querySelector(APP_LINK);
    if (!link) return;

    const card = link.parentElement;                 // khung chứa logo + 2 nút
    const modal = link.closest('[data-focus-lock-disabled]') || card;
    if (!modal || modal.dataset.dsHandled) return;
    modal.dataset.dsHandled = '1';

    // Nút còn lại trong cùng khung (không phụ thuộc ngôn ngữ giao diện)
    const continueBtn = card && card.querySelector('button');
    if (continueBtn) continueBtn.click();

    // Dự phòng: nếu popup vẫn còn sau 300ms thì gỡ thủ công
    setTimeout(() => {
      if (!document.contains(link)) return;
      const overlays = document.getElementById('overlays');
      if (overlays) {
        overlays.querySelectorAll('[data-focus-guard]').forEach(el => el.remove());
        overlays.querySelectorAll('div[style*="pointer-events: none"]').forEach(el => el.remove());
      }
      modal.remove();
      document.documentElement.style.removeProperty('overflow');
      document.body && document.body.style.removeProperty('overflow');
    }, 300);
  }

  // 3) Theo dõi DOM vì popup được render sau khi trang tải (SPA React).
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; dismiss(); });
  });

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    dismiss();
  }

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
