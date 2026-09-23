/**
 * voiz-summary.js
 * Load more playlists on Voiz category listing pages (summary-book, etc.).
 * Appends cards with the same markup/classes as the site so styling matches Voiz.
 */
(function () {
  'use strict';

  const API_BASE = 'https://api.voiz.vn/v1';
  const LIMIT = 10;
  const BUTTON_ID = 'mydio-voiz-load-more-btn';
  const WRAPPER_ID = 'mydio-voiz-load-more-wrap';

  /**
   * Only inject on pages that do NOT already have native "Xem thêm".
   * path (normalized, no trailing slash) → API category code
   */
  const PATH_TO_CATEGORY = {
    '/summary-book': 'summary_book',
    '/book-children': 'children_book',
  };

  const CARD_SELECTOR =
    'a.random-playlist-link-mb, a.random-playlist-link-desktop, a[href*="/play/"]';

  let loading = false;
  let hasMore = true;
  let lastPath = '';

  function normalizePath(pathname) {
    return String(pathname || '/').replace(/\/+$/, '') || '/';
  }

  function isListingPage() {
    try {
      if (!/voiz\.vn$/i.test(location.hostname)) return false;
      return Object.prototype.hasOwnProperty.call(PATH_TO_CATEGORY, normalizePath(location.pathname));
    } catch {
      return false;
    }
  }

  function categoryCode() {
    return PATH_TO_CATEGORY[normalizePath(location.pathname)] || null;
  }

  function getPageToken() {
    try {
      const cookie = document.cookie
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith('token='));
      if (cookie) return decodeURIComponent(cookie.slice('token='.length));
    } catch {}
    try {
      return localStorage.getItem('token') || '';
    } catch {
      return '';
    }
  }

  function getListContainer() {
    const first = document.querySelector(CARD_SELECTOR);
    if (!first) return null;
    // Prefer the box that holds all playlist cards
    let el = first.parentElement;
    if (!el) return null;
    while (el.parentElement) {
      const links = el.querySelectorAll(CARD_SELECTOR);
      const parentLinks = el.parentElement.querySelectorAll(CARD_SELECTOR);
      if (parentLinks.length > links.length && parentLinks.length >= 4) {
        el = el.parentElement;
        continue;
      }
      break;
    }
    return el;
  }

  function collectShownIds(container) {
    const ids = [];
    const seen = new Set();
    const root = container || document;
    root.querySelectorAll('a[href*="/play/"]').forEach((a) => {
      const m = a.getAttribute('href')?.match(/\/play\/(\d+)/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        ids.push(m[1]);
      }
    });
    return ids;
  }

  function getCardTemplate(container) {
    return (
      container.querySelector('a.random-playlist-link-desktop') ||
      container.querySelector('a.random-playlist-link-mb') ||
      container.querySelector('a[href*="/play/"]')
    );
  }

  function truncateDesc(text, max = 280) {
    const s = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length <= max) return s;
    return s.slice(0, max - 1).trim() + '…';
  }

  function pickAvatar(item) {
    return (
      item?.avatar?.webp?.normal_url ||
      item?.avatar?.webp?.original_url ||
      item?.avatar?.original_url ||
      item?.avatar?.thumb_url ||
      item?.avatar?.small_url ||
      ''
    );
  }

  function authorName(item) {
    if (item?.author_string) return item.author_string;
    if (Array.isArray(item?.authors) && item.authors.length) {
      return item.authors.map((a) => a.name).filter(Boolean).join(',');
    }
    return '';
  }

  /**
   * Clone an existing card node and fill with new playlist data.
   * Falls back to building a minimal matching structure if no template exists.
   */
  function buildCard(item, template) {
    const href = `https://voiz.vn/play/${item.id}/`;
    const title = item.name || '';
    const author = authorName(item);
    const desc = truncateDesc(item.description || '');
    const img = pickAvatar(item);

    if (template) {
      const node = template.cloneNode(true);
      if (node.tagName === 'A') {
        node.href = href;
        node.setAttribute('href', href);
      } else {
        const a = node.querySelector('a[href*="/play/"]') || node.querySelector('a');
        if (a) {
          a.href = href;
          a.setAttribute('href', href);
        }
      }
      const imgEl = node.querySelector('img');
      if (imgEl) {
        imgEl.src = img;
        imgEl.setAttribute('src', img);
        imgEl.removeAttribute('srcset');
        imgEl.alt = title;
        imgEl.loading = 'lazy';
      }

      // Title is always the h2 inside the card
      node.querySelectorAll('h2').forEach((h) => {
        h.textContent = title;
      });

      // Author sits next to AccountCircleOutlinedIcon
      const icon = node.querySelector('[data-testid="AccountCircleOutlinedIcon"]');
      if (icon) {
        const authorBox = icon.closest('.MuiBox-root') || icon.parentElement;
        const authorP = authorBox?.querySelector('p');
        if (authorP) authorP.textContent = author;
      }

      // Description: last <p> that is not inside the author row
      const authorRow = icon?.closest('.MuiBox-root') || null;
      const paras = Array.from(node.querySelectorAll('p'));
      let descEl = null;
      for (let i = paras.length - 1; i >= 0; i--) {
        const p = paras[i];
        if (authorRow && authorRow.contains(p)) continue;
        descEl = p;
        break;
      }
      if (descEl) descEl.textContent = desc;

      return node;
    }

    // Fallback when no template is available (rare). Prefer desktop class on book-children.
    const isChildren = categoryCode() === 'children_book';
    const a = document.createElement('a');
    a.className = isChildren ? 'random-playlist-link-desktop' : 'random-playlist-link-mb';
    a.href = href;
    const size = isChildren ? 200 : 153;
    a.innerHTML = `
      <div class="MuiBox-root">
        <div class="MuiBox-root">
          <img alt="${escapeAttr(title)}" loading="lazy" width="${size}" height="${size}" decoding="async"
            src="${escapeAttr(img)}"
            style="color: transparent; border-radius: 3px; object-fit: cover;" />
        </div>
        <div class="MuiBox-root">
          <h2 class="MuiTypography-root MuiTypography-body1">${escapeHtml(title)}</h2>
          <div class="MuiBox-root">
            <svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeMedium" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="AccountCircleOutlinedIcon">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM7.35 18.5C8.66 17.56 10.26 17 12 17s3.34.56 4.65 1.5c-1.31.94-2.91 1.5-4.65 1.5s-3.34-.56-4.65-1.5zm10.79-1.38C16.45 15.8 14.32 15 12 15s-4.45.8-6.14 2.12C4.7 15.73 4 13.95 4 12c0-4.42 3.58-8 8-8s8 3.58 8 8c0 1.95-.7 3.73-1.86 5.12z"></path>
              <path d="M12 6c-1.93 0-3.5 1.57-3.5 3.5S10.07 13 12 13s3.5-1.57 3.5-3.5S13.93 6 12 6zm0 5c-.83 0-1.5-.67-1.5-1.5S11.17 8 12 8s1.5.67 1.5 1.5S12.83 11 12 11z"></path>
            </svg>
            <p class="MuiTypography-root MuiTypography-body1">${escapeHtml(author)}</p>
          </div>
          <p class="MuiTypography-root MuiTypography-body1">${escapeHtml(desc)}</p>
        </div>
      </div>`;
    return a;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  async function fetchPlaylists(ignoreIds) {
    const code = categoryCode();
    if (!code) throw new Error('Unknown category');
    const qs = new URLSearchParams({
      limit: String(LIMIT),
      ignore_ids: ignoreIds.join(','),
      sort: 'latest',
      have_author: '1',
    });
    const url = `${API_BASE}/categories/${encodeURIComponent(code)}/playlists?${qs}`;
    const token = getPageToken();
    const headers = {
      accept: 'application/json',
      'cache-control': 'no-store',
      pragma: 'no-cache',
    };
    if (token) headers['x-authorization'] = token;

    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.code === 0) {
      throw new Error(json?.error || `HTTP ${res.status}`);
    }
    return Array.isArray(json?.data) ? json.data : [];
  }

  function ensureButtonStyles() {
    if (document.getElementById('mydio-voiz-load-more-style')) return;
    const style = document.createElement('style');
    style.id = 'mydio-voiz-load-more-style';
    style.textContent = `
      #${WRAPPER_ID} {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
        padding: 24px 16px 40px;
        box-sizing: border-box;
      }
      #${BUTTON_ID} {
        appearance: none;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-width: 160px;
        padding: 10px 28px;
        border-radius: 24px;
        font-family: "SF UI Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 15px;
        font-weight: 600;
        line-height: 1.4;
        letter-spacing: 0.02em;
        color: #fff;
        background: linear-gradient(90deg, #7c5cff 0%, #9b6dff 50%, #b57cff 100%);
        box-shadow: 0 4px 14px rgba(124, 92, 255, 0.35);
        transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
      }
      #${BUTTON_ID}:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(124, 92, 255, 0.45);
        filter: brightness(1.05);
      }
      #${BUTTON_ID}:active:not(:disabled) {
        transform: translateY(0);
      }
      #${BUTTON_ID}:disabled {
        opacity: 0.65;
        cursor: default;
        box-shadow: none;
      }
      #${BUTTON_ID} .mydio-lm-spinner {
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255,255,255,0.35);
        border-top-color: #fff;
        border-radius: 50%;
        animation: mydio-lm-spin 0.7s linear infinite;
      }
      @keyframes mydio-lm-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function setButtonState(btn, state) {
    if (!btn) return;
    if (state === 'loading') {
      btn.disabled = true;
      btn.innerHTML = '<span class="mydio-lm-spinner" aria-hidden="true"></span><span>Đang tải…</span>';
    } else if (state === 'done') {
      btn.disabled = true;
      btn.textContent = 'Đã tải hết';
    } else if (state === 'error') {
      btn.disabled = false;
      btn.textContent = 'Thử lại';
    } else {
      btn.disabled = false;
      btn.textContent = 'Xem thêm';
    }
  }

  function removeUI() {
    document.getElementById(WRAPPER_ID)?.remove();
  }

  function ensureUI() {
    if (!isListingPage()) {
      removeUI();
      return;
    }

    const container = getListContainer();
    if (!container) return;

    // Reset when path changes (SPA)
    if (lastPath !== location.pathname) {
      lastPath = location.pathname;
      hasMore = true;
      loading = false;
      removeUI();
    }

    if (document.getElementById(BUTTON_ID)) return;

    ensureButtonStyles();

    const wrap = document.createElement('div');
    wrap.id = WRAPPER_ID;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = 'Xem thêm';
    btn.addEventListener('click', onLoadMore);

    wrap.appendChild(btn);

    // Insert after the list container
    if (container.parentElement) {
      container.parentElement.insertBefore(wrap, container.nextSibling);
    } else {
      container.appendChild(wrap);
    }
  }

  async function onLoadMore() {
    if (loading || !hasMore) return;
    const btn = document.getElementById(BUTTON_ID);
    const container = getListContainer();
    if (!container) return;

    loading = true;
    setButtonState(btn, 'loading');

    try {
      const ignoreIds = collectShownIds(container);
      const items = await fetchPlaylists(ignoreIds);

      if (!items.length) {
        hasMore = false;
        setButtonState(btn, 'done');
        return;
      }

      const template = getCardTemplate(container);

      const frag = document.createDocumentFragment();
      const existing = new Set(ignoreIds.map(String));

      for (const item of items) {
        if (!item?.id || existing.has(String(item.id))) continue;
        existing.add(String(item.id));
        frag.appendChild(buildCard(item, template));
      }

      container.appendChild(frag);

      if (items.length < LIMIT) {
        hasMore = false;
        setButtonState(btn, 'done');
      } else {
        setButtonState(btn, 'idle');
      }
    } catch (err) {
      console.error('[Voiz Load More]', err);
      setButtonState(btn, 'error');
    } finally {
      loading = false;
    }
  }

  // ─── SPA route awareness ───────────────────────────────────────────────────
  function onRouteMaybeChanged() {
    if (!isListingPage()) {
      removeUI();
      return;
    }
    // Cards may render a moment after navigation
    ensureUI();
    // Retry a few times while Next.js hydrates the list
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      ensureUI();
      if (document.getElementById(BUTTON_ID) || tries > 15) clearInterval(t);
    }, 400);
  }

  window.addEventListener('popstate', onRouteMaybeChanged);
  try {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const ret = origPush.apply(this, args);
      try {
        onRouteMaybeChanged();
      } catch {}
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = origReplace.apply(this, args);
      try {
        onRouteMaybeChanged();
      } catch {}
      return ret;
    };
  } catch {}

  // Initial + poll (list may appear late)
  onRouteMaybeChanged();
  setInterval(() => {
    if (isListingPage()) ensureUI();
    else removeUI();
  }, 2500);
})();
