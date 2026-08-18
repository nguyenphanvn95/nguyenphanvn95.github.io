/**
 * voiz-hide.js
 * Ẩn banner quảng cáo / promo trên trang chủ và các trang Voiz
 * (khối "Nghe thử miễn phí, không giới hạn sách mỗi tháng" + nút TẢI NGAY).
 */
(function () {
  'use strict';

  const STYLE_ID = 'mydio-voiz-hide-promo-style';
  const HIDDEN_ATTR = 'data-voiz-promo-hidden';

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Banner image homepage */
      img[alt="banner"][src*="Banner-home"],
      img[src*="/images/Banner-home"],
      img[src*="Banner-home-2"] {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        width: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
      }

      /* Khối đã đánh dấu ẩn bởi script */
      [${HIDDEN_ATTR}="1"] {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        max-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function normalizeText(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isPromoBlock(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute(HIDDEN_ATTR) === '1') return true;

    const text = normalizeText(el);
    if (!text) return false;

    // Khớp nội dung banner trang chủ trong ảnh
    const hasHeadline =
      /nghe\s*thử\s*miễn\s*phí/i.test(text) &&
      /không\s*giới\s*hạn\s*sách\s*mỗi\s*tháng/i.test(text);
    const hasDesc =
      /ứng\s*dụng\s*sách\s*nói\s*hàng\s*đầu\s*việt\s*nam/i.test(text) ||
      /hơn\s*15[,.]?000\s*nội\s*dung/i.test(text);
    const hasCta = /tải\s*ngay/i.test(text);

    // Có ảnh banner
    const hasBannerImg = !!el.querySelector(
      'img[alt="banner"][src*="Banner-home"], img[src*="/images/Banner-home"], img[src*="Banner-home-2"]'
    );

    // Khối promo đủ điều kiện: (headline + mô tả) hoặc (banner img + CTA) hoặc (headline + CTA)
    if (hasHeadline && (hasDesc || hasCta)) return true;
    if (hasBannerImg && (hasHeadline || hasCta || hasDesc)) return true;
    return false;
  }

  function hideElement(el) {
    if (!el || el.getAttribute(HIDDEN_ATTR) === '1') return;
    el.setAttribute(HIDDEN_ATTR, '1');
    el.setAttribute('aria-hidden', 'true');
    // Giữ lại style cũ nếu cần restore sau này
    if (!el.dataset.voizPrevDisplay) {
      el.dataset.voizPrevDisplay = el.style.display || '';
    }
    el.style.display = 'none';
  }

  /**
   * Tìm và ẩn khối promo chính xác nhất:
   * - Ưu tiên div chứa đựng img banner + text "Nghe thử miễn phí..."
   * - Fallback: ẩn từng phần tử chứa text/CTA
   */
  function hidePromoBlocks() {
    injectCss();

    // 1) Ảnh banner → leo lên parent phù hợp
    const bannerImgs = document.querySelectorAll(
      'img[alt="banner"][src*="Banner-home"], img[src*="/images/Banner-home"], img[src*="Banner-home-2"]'
    );
    bannerImgs.forEach((img) => {
      let target = img;
      // Leo tối đa vài cấp để bắt đúng container flex chứa cả text + button
      for (let i = 0; i < 6; i++) {
        const parent = target.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) break;
        if (isPromoBlock(parent)) {
          target = parent;
          break;
        }
        // Nếu parent chứa text promo thì coi là candidate
        const pText = normalizeText(parent);
        if (
          /nghe\s*thử\s*miễn\s*phí|tải\s*ngay|15[,.]?000\s*nội\s*dung/i.test(pText) &&
          parent.children.length >= 2
        ) {
          target = parent;
        }
      }
      hideElement(target);
      // Ẩn luôn img phòng khi parent không ẩn được
      hideElement(img);
    });

    // 2) Tìm theo heading / button text (layout có thể đổi class)
    const candidates = document.querySelectorAll(
      'h1, h2, p, button, [class*="MuiTypography"], [class*="MuiButton"], [class*="MuiBox"]'
    );
    const seen = new Set();

    candidates.forEach((node) => {
      const text = normalizeText(node);
      if (!text) return;

      const isHeadline = /nghe\s*thử\s*miễn\s*phí/i.test(text) && text.length < 120;
      const isCta = /^(tải\s*ngay|download\s*now)$/i.test(text);
      if (!isHeadline && !isCta) return;

      // Leo lên tìm container promo
      let el = node;
      for (let i = 0; i < 8; i++) {
        if (!el || el === document.body) break;
        if (isPromoBlock(el) && !seen.has(el)) {
          seen.add(el);
          hideElement(el);
          return;
        }
        el = el.parentElement;
      }

      // Fallback: ẩn chính node + vài parent gần
      if (isHeadline || isCta) {
        hideElement(node);
        const p = node.parentElement;
        if (p && isPromoBlock(p)) hideElement(p);
      }
    });

    // 3) Selector class gần đúng với HTML bạn gửi (có thể thay đổi sau build)
    document
      .querySelectorAll(
        'div.sc-d4804eaf-0, div.ixuzyo, main [class*="MuiBox"] > div[class*="MuiBox"]'
      )
      .forEach((el) => {
        if (isPromoBlock(el)) hideElement(el);
      });
  }

  // Chạy ngay + theo dõi SPA / hydrate
  injectCss();
  hidePromoBlocks();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hidePromoBlocks, { once: true });
  }

  // MutationObserver: Voiz dùng Next.js / MUI, content load async
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(hidePromoBlocks, 200);
  });

  try {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch {}

  // Poll nhẹ phòng observer bị disconnect
  setInterval(hidePromoBlocks, 3000);

  // Route change (SPA)
  let lastPath = location.pathname;
  function onRoute() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    setTimeout(hidePromoBlocks, 100);
    setTimeout(hidePromoBlocks, 600);
  }
  window.addEventListener('popstate', onRoute);
  try {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const r = origPush.apply(this, args);
      try {
        onRoute();
      } catch {}
      return r;
    };
    history.replaceState = function (...args) {
      const r = origReplace.apply(this, args);
      try {
        onRoute();
      } catch {}
      return r;
    };
  } catch {}
})();
