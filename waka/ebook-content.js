/**
 * ebook-content.js - chạy trên /ebook/* và /shop/*  (Waka EPUB Downloader userscript 1.3)
 *
 * [userscript 1.3] Chuyển từ Waka Toolkit 6.9.2 — "Tải EPUB hàng loạt các phần":
 *  - Bộ chọn phần (#waka-part-select) + hộp thoại "Tải các phần của ebook:"
 *  - Bỏ phần dùng chrome.* (lịch sử tải, nút "Đọc sách" mở Reader của extension)
 *  - Thêm lớp bảo vệ điều hướng SPA (resetPartsIfNavigated) để không tải nhầm phần của sách trước
 *
 * Luồng đúng:
 *  - Nhận URL từ ebook-interceptor.js
 *  - Nếu URL là content.opf: tải OPF, kéo toàn bộ file trong manifest, decode nếu cần,
 *    rồi đóng gói lại thành EPUB hợp lệ
 *  - Nếu URL là file EPUB thật: tải trực tiếp
 *  - Raw response vẫn được giữ để debug / fallback
 */
(function () {
  'use strict';

  let _downloadUrl = null;
  let _rawResponse = null;
  let _isBusy = false;
  let _currentBookId = null;
  let _selectedPartId = null;
  let _relatedParts = [];
  let _relatedRequestBookId = null;
  const _downloadUrlsByBookId = new Map();
  const SHOW_DEBUG_PANEL = false;

  function isOpfUrl(url) {
    return /\/content\.opf(\?|$)/i.test(String(url || ''));
  }

  function extractDownloadUrl(text) {
    if (!text) return null;

    const raw = String(text);

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
          return candidate;
        }
      }
    } catch {}

    const patterns = [
      /"(https?:\/\/[^"]*(?:epub|book|download)[^"]*)"/i,
      /"(?:download_url|epub_url|file_url|link|url)"\s*:\s*"(https?:\/\/[^"]+)"/i,
      /(?:download_url|epub_url|file_url|link|url)\s*[:=]\s*["']?(https?:\/\/[^\s"'\\]+)["']?/i,
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match?.[1]) return match[1].replace(/\\\//g, '/');
    }

    return null;
  }

  function resolveUrl(href, base) {
    if (/^https?:\/\//i.test(href)) return href;
    try {
      return new URL(href, base).href;
    } catch {
      return base.replace(/\/$/, '') + '/' + href;
    }
  }

  async function fetchWithFallback(url) {
    let resp = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    if (!resp.ok) resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
    return resp;
  }

  function downloadBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: objectUrl,
      download: filename,
      style: 'display:none',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }

  function cleanTitle(s) {
    if (window.WakaEpubDecode?.cleanTitle) return window.WakaEpubDecode.cleanTitle(s);
    return String(s || '')
      .replace(/^Đọc[\s_]*sách[\s_]*[-–:_]*[\s_]*/i, '')
      .replace(/\s*[-–]\s*.*Waka.*$/i, '')
      .replace(/\s*[-–]\s*Thư viện ebook.*$/i, '')
      .trim();
  }

  function safeName(s) {
    if (window.WakaEpubDecode?.safeName) return window.WakaEpubDecode.safeName(s);
    return cleanTitle(s || 'waka-ebook')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 100) || 'waka-ebook';
  }

  function logDownload(title, filename) {
    console.log('[Waka Userscript] Downloaded:', title, filename);
  }

  function getBookTitle() {
    const h1 = document.querySelector('h1.title-product, h1.text-white-50, h1');
    let title = h1?.textContent?.trim() || '';
    if (!title) {
      title = document.title
        .replace(/\s*[-–]\s*.*Waka.*$/i, '')
        .replace(/\s*[-–]\s*Sách giấy.*$/i, '')
        .replace(/\s*[-–]\s*Alpha Books.*$/i, '')
        .trim();
    }
    title = cleanTitle(title);
    return title || 'waka-ebook';
  }

  function decodeText(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = raw;
    return textarea.value.trim();
  }

  function getSelectedPart() {
    const id = String(_selectedPartId || _currentBookId || '');
    return _relatedParts.find((part) => String(part.book_id) === id || String(part.id) === id) || null;
  }

  function getSelectedBookId() {
    return String(_selectedPartId || _currentBookId || extractCurrentBookId() || '');
  }

  function getPartDisplayTitle(baseTitle, opts = {}) {
    const part = opts.part || getSelectedPart();
    const title = cleanTitle(baseTitle || getBookTitle());
    if (!part) return title;
    const label = decodeText(part.name || part.label || ('Phần ' + (part.order || '')));
    return label ? `${title} - ${label}` : title;
  }

  function extractProductDetail() {
    try {
      const nuxt = window.__NUXT__;
      const entries = [];
      if (Array.isArray(nuxt?.data)) entries.push(...nuxt.data);
      else if (nuxt?.data && typeof nuxt.data === 'object') entries.push(...Object.values(nuxt.data));
      if (nuxt?.state && typeof nuxt.state === 'object') entries.push(...Object.values(nuxt.state));
      for (const item of entries) {
        if (!item || typeof item !== 'object') continue;
        const detail = item.ebookDetail || item.ebookInfo || item.bookInfo || item.productDetail || item.props?.productDetail || item.data?.productDetail;
        if (detail && (detail.book_id || detail.id || detail.collection_status || detail.parent_xbol_id)) return detail;
      }
    } catch {}
    return null;
  }

  function extractCurrentBookId() {
    if (_currentBookId) return _currentBookId;
    try {
      const detail = extractProductDetail();
      const id = detail?.book_id || detail?.id || detail?.ebook?.[0]?.id || detail?.ebook_price?.id;
      if (id && Number(id) > 100) {
        _currentBookId = String(id);
        return _currentBookId;
      }
    } catch {}
    try {
      const html = document.documentElement.innerHTML;
      const patterns = [
        /book_id\s*:\s*(\d{3,})/i,
        /["']book_id["']\s*:\s*(\d{3,})/i,
        /[?&](?:data|book_id|item_id|content_id)=(\d{3,})\b/i,
      ];
      for (const pattern of patterns) {
        const m = html.match(pattern);
        if (m?.[1] && Number(m[1]) > 100) {
          _currentBookId = String(m[1]);
          return _currentBookId;
        }
      }
    } catch {}
    return null;
  }

  function hasMultiPartSignal() {
    try {
      const detail = extractProductDetail();
      if (detail) {
        if (detail.parent_xbol_id && Number(detail.parent_xbol_id) > 0) return true;
        if (detail.collection_status && String(detail.collection_status).trim()) return true;
        if (Array.isArray(detail.list_chapter) && detail.list_chapter.length > 1) return true;
      }
    } catch {}
    try {
      const bodyText = document.body?.innerText || '';
      if (/Tình trạng ra/i.test(bodyText)) return true;
      const html = document.documentElement.innerHTML;
      if (/collection_status\s*:\s*["'][^"']+["']/i.test(html)) return true;
      if (/["']collection_status["']\s*:\s*["'][^"']+["']/i.test(html)) return true;
    } catch {}
    return false;
  }

  function normalizeRelatedParts(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
      .map((item, index) => {
        const bookId = item?.book_id || item?.id || item?.epub_id;
        if (!bookId || Number(bookId) <= 100) return null;
        return {
          book_id: String(bookId),
          order: Number(item.order || index + 1),
          name: decodeText(item.name || item.label || ('Phần ' + (item.order || index + 1))),
          title: decodeText(item.title || ''),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order)
      .filter((item) => {
        if (seen.has(item.book_id)) return false;
        seen.add(item.book_id);
        return true;
      });
  }

  // [userscript] Waka là SPA: nếu đã chuyển sang sách khác thì danh sách phần đang giữ là của sách
  // trước → bỏ đi và nhận diện lại, tránh tải nhầm. (Extension nạp lại content script mỗi lần vào trang.)
  let _partsPath = location.pathname;

  function resetPartsIfNavigated() {
    if (location.pathname === _partsPath) return false;
    if (_batchState.running) return false; // đang tải hàng loạt: không đụng tới cho đến khi xong
    _partsPath = location.pathname;
    _currentBookId = null;
    _selectedPartId = null;
    _relatedParts = [];
    _relatedRequestBookId = null;
    _downloadUrl = null;
    _rawResponse = null;
    _downloadUrlsByBookId.clear();
    document.getElementById('waka-part-select')?.remove();
    closeBatchDialog();
    updateBtnState();
    setTimeout(requestRelatedParts, 900);
    return true;
  }

  function renderPartSelector(parts) {
    if (!parts || parts.length <= 1) return;
    _partsPath = location.pathname;
    _relatedParts = parts;
    const current = extractCurrentBookId();
    if (!_selectedPartId) _selectedPartId = current || parts[0].book_id;

    let select = document.getElementById('waka-part-select');
    if (!select) {
      select = document.createElement('select');
      select.id = 'waka-part-select';
      select.title = 'Chọn phần để tải/đọc';
      select.addEventListener('change', () => {
        _selectedPartId = select.value;
        const cached = _downloadUrlsByBookId.get(String(_selectedPartId));
        if (cached) _downloadUrl = cached;
        updatePartHint();
      });
    }
    select.innerHTML = parts.map((part) => {
      const label = part.name || ('Phần ' + part.order);
      const suffix = part.book_id === current ? ' · Hiện tại' : '';
      return `<option value="${part.book_id}">${escapeHtml(label + suffix)}</option>`;
    }).join('');
    select.value = String(_selectedPartId || current || parts[0].book_id);

    const container = document.getElementById('waka-inline-btns');
    if (container && select.parentElement !== container) {
      container.insertBefore(select, container.firstChild);
    }
    updatePartHint();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function updatePartHint() {
    const part = getSelectedPart();
    const select = document.getElementById('waka-part-select');
    if (select && part) select.title = `Đang chọn ${part.name || part.book_id}`;
  }

  function requestRelatedParts() {
    if (_relatedParts.length > 1) return;
    if (!hasMultiPartSignal()) return;
    const detail = extractProductDetail();
    const inlineParts = normalizeRelatedParts(detail?.list_chapter);
    if (inlineParts.length > 1) {
      renderPartSelector(inlineParts);
      return;
    }
    const bookId = extractCurrentBookId();
    if (!bookId) return;
    if (_relatedRequestBookId === String(bookId)) return;
    _relatedRequestBookId = String(bookId);
    window.dispatchEvent(new CustomEvent('__waka_request_related_books__', { detail: { book_id: bookId } }));
  }

  function rememberDownloadUrl(bookId, url) {
    if (!url) return;
    const id = String(bookId || getSelectedBookId() || _currentBookId || '');
    if (id) _downloadUrlsByBookId.set(id, url);
    if (!id || String(id) === String(getSelectedBookId())) _downloadUrl = url;
  }

  function isReadyForSelectedPart(detail, selectedId) {
    const readyId = detail && (detail.item_id || detail.book_id || detail.bookId);
    return !selectedId || !readyId || String(readyId) === String(selectedId);
  }

  async function getDownloadUrlForBookId(bookId, btn, opts = {}) {
    const selectedId = String(bookId || getSelectedBookId() || '');
    const cached = selectedId ? _downloadUrlsByBookId.get(String(selectedId)) : null;
    if (cached) {
      if (String(selectedId) === String(getSelectedBookId())) _downloadUrl = cached;
      return cached;
    }
    if (!selectedId && _downloadUrl) return _downloadUrl;

    if (btn) btn.innerHTML = '⏳ Lấy link...';
    if (!opts.silent) showToast('2/3 Đang lấy link EPUB...');
    const gotUrl = await new Promise(function(resolve) {
      var done = false;
      var onReady = function(e) {
        if (done) return;
        const detail = e.detail || {};
        if (!isReadyForSelectedPart(detail, selectedId)) return;
        done = true;
        window.removeEventListener('__waka_ebook_ready__', onReady);
        const url = detail.url || null;
        if (url) rememberDownloadUrl(selectedId || detail.item_id, url);
        resolve(url);
      };
      window.addEventListener('__waka_ebook_ready__', onReady);
      window.dispatchEvent(new CustomEvent('__waka_force_download__', {
        detail: selectedId ? { item_id: selectedId, book_id: selectedId } : {},
      }));
      setTimeout(function() {
        if (done) return;
        done = true;
        window.removeEventListener('__waka_ebook_ready__', onReady);
        resolve(selectedId ? _downloadUrlsByBookId.get(String(selectedId)) : _downloadUrl);
      }, 12000);
    });
    if (gotUrl) rememberDownloadUrl(selectedId, gotUrl);
    return gotUrl || null;
  }

  async function getDownloadUrlForSelectedPart(btn) {
    return getDownloadUrlForBookId(getSelectedBookId(), btn);
  }

  function setPrimaryLabel(text, active) {
    const btn = document.getElementById('waka-dl-btn');
    if (!btn) return;
    btn.innerHTML = text;
    if (active) {
      btn.style.background = '#e94560';
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.onmouseenter = () => { btn.style.opacity = '0.85'; };
      btn.onmouseleave = () => { btn.style.opacity = '1'; };
    }
  }

  function updateBtnState() {
    if (!_downloadUrl) {
      setPrimaryLabel('⏳&nbsp;Đang tìm EPUB...', false);
      return;
    }

    if (isOpfUrl(_downloadUrl)) {
      setPrimaryLabel('⬇&nbsp;Tải EPUB', true);
      return;
    }

    setPrimaryLabel('⬇&nbsp;Tải EPUB', true);
  }

  function updateStatus(msg, isError = false) {
    let el = document.getElementById('waka-dl-status');
    if (!el) {
      createUI();
      el = document.getElementById('waka-dl-status');
    }
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.color = isError ? '#ff8a8a' : '#888';
  }

  let _toastTimer;
  function showToast(msg, isError = false) {
    let t = document.getElementById('waka-dl-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'waka-dl-toast';
      t.style.cssText = [
        'position:fixed',
        'bottom:80px',
        'right:20px',
        'background:#111827',
        'color:#f3f4f6',
        'border-radius:12px',
        'padding:12px 18px',
        'font-size:13px',
        'max-width:340px',
        'z-index:2147483647',
        'font-family:system-ui,sans-serif',
        'box-shadow:0 6px 24px rgba(0,0,0,.5)',
        'transition:opacity .3s',
        'pointer-events:none',
        'line-height:1.5',
      ].join(';');
      document.body.appendChild(t);
    }
    t.style.background = isError ? '#3b1a1a' : '#111827';
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      t.style.opacity = '0';
    }, 5000);
  }

  // Kiểm tra và hiện badge "Có metadata" nếu đã lưu
  async function checkMetaBadge() {
    if (!window.WakaMetaInjector) return;
    const hasMeta = await WakaMetaInjector.hasMeta();
    let badge = document.getElementById('waka-meta-badge');
    if (hasMeta) {
      const meta = await WakaMetaInjector.getMeta();
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'waka-meta-badge';
        badge.style.cssText = [
          'background:#0d1f14','color:#4caf7d','font-size:10px','font-weight:700',
          'padding:3px 10px','border-radius:10px','text-align:right',
          'backdrop-filter:blur(4px)','cursor:pointer',
          'border:1px solid #1a5c33',
        ].join(';');
        badge.title = 'Nhấn để xoá metadata đã lưu';
        badge.addEventListener('click', async () => {
          await WakaMetaInjector.clearMeta();
          badge.remove();
          showToast('🗑 Đã xoá metadata khỏi bộ nhớ');
        });
        const ui = document.getElementById('waka-dl-ui');
        if (ui) ui.insertBefore(badge, ui.firstChild);
      }
      badge.textContent = `📚 Meta: ${meta?.title?.slice(0,20) || '—'}`;
    } else if (badge) {
      badge.remove();
    }
  }

  function createUI() {
    if (document.getElementById('waka-dl-ui')) return;

    const ui = document.createElement('div');
    ui.id = 'waka-dl-ui';
    ui.style.cssText = [
      'position:fixed',
      'bottom:20px',
      'right:16px',
      'display:none', /* v4.5 hide corner */
      'flex-direction:column',
      'align-items:flex-end',
      'gap:8px',
      'z-index:2147483647',
      'font-family:system-ui,sans-serif',
    ].join(';');

    const status = document.createElement('div');
    status.id = 'waka-dl-status';
    status.style.cssText = [
      'background:#15151ecc',
      'color:#aaa',
      'font-size:11px',
      'padding:4px 10px',
      'border-radius:10px',
      'max-width:280px',
      'text-align:right',
      'backdrop-filter:blur(4px)',
      'display:none',
    ].join(';');

    const btn = document.createElement('button');
    btn.id = 'waka-dl-btn';
    btn.innerHTML = '⏳&nbsp;Đang tìm EPUB...';
    btn.style.cssText = [
      'background:#555',
      'color:#fff',
      'border:none',
      'border-radius:24px',
      'padding:10px 20px',
      'font-size:13px',
      'font-weight:700',
      'cursor:default',
      'opacity:0.7',
      'box-shadow:0 3px 12px rgba(0,0,0,0.3)',
      'transition:background 0.2s,opacity 0.2s',
      'white-space:nowrap',
    ].join(';');
    btn.addEventListener('click', handleBtnClick);

    ui.appendChild(status);
    ui.appendChild(btn);
    document.body.appendChild(ui);
  }

  async function handleBtnClick() {
    if (_isBusy) return;

    if (!_downloadUrl) {
      if (_rawResponse && extractDownloadUrl(_rawResponse)) {
        _downloadUrl = extractDownloadUrl(_rawResponse);
        updateBtnState();
      } else {
        showToast('⏳ Đang chờ API phản hồi...');
        return;
      }
    }

    if (isOpfUrl(_downloadUrl)) {
      await buildEpubFromOpf(_downloadUrl);
      return;
    }

    await downloadDirectFile(_downloadUrl);
  }

  async function downloadDirectFile(url, opts = {}) {
    _isBusy = true;
    const btn = document.getElementById('waka-dl-btn');
    if (btn) {
      btn.innerHTML = '⏳&nbsp;Đang tải...';
      btn.disabled = true;
      btn.style.cursor = 'default';
    }

    try {
      updateStatus('Đang tải file EPUB...');
      const resp = await fetchWithFallback(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const contentType = resp.headers.get('content-type') || '';
      const blob = await resp.blob();

      let ext = 'epub';
      if (contentType.includes('pdf')) ext = 'pdf';
      if (contentType.includes('zip')) ext = 'epub';
      if (/\.pdf(\?|$)/i.test(url)) ext = 'pdf';
      if (/\.epub(\?|$)/i.test(url)) ext = 'epub';

      // Nhúng metadata nếu có trong storage (dùng chung metadata trang đang duyệt,
      // riêng tiêu đề lấy theo phần đang tải)
      const displayTitle = getPartDisplayTitle(getBookTitle(), opts);
      let finalBlob = blob;
      let metaNote = '';
      if (ext === 'epub' && window.WakaMetaInjector) {
        const hasMeta = await WakaMetaInjector.hasMeta();
        if (hasMeta) {
          updateStatus('📚 Đang nhúng metadata vào EPUB...');
          try {
            finalBlob = await WakaMetaInjector.injectIntoBlob(blob, displayTitle);
            metaNote = ' + metadata';
          } catch (e) {
            console.warn('[Waka DL] Inject metadata lỗi:', e);
          }
        }
      }

      const fname = `${safeName(displayTitle)}.${ext}`;
      downloadBlob(finalBlob, fname);
      updateStatus(`✅ Đã lưu: ${fname}${metaNote}`);
      showToast(`✅ Đã tải: ${fname}${metaNote}`);
      logDownload(displayTitle, fname);

      // Xóa metadata sau khi đã nhúng thành công (bỏ qua nếu đang tải hàng loạt nhiều phần)
      if (metaNote && window.WakaMetaInjector && !opts.keepMeta) {
        await WakaMetaInjector.clearMeta();
        document.getElementById('waka-meta-badge')?.remove();
      }

      if (btn) {
        btn.innerHTML = '✅&nbsp;Đã tải';
        btn.disabled = false;
        btn.style.background = '#28a745';
        btn.style.cursor = 'pointer';
      }
      return true;
    } catch (err) {
      updateStatus('❌ ' + err.message, true);
      showToast('❌ Lỗi tải file: ' + err.message, true);
      if (btn) {
        btn.innerHTML = '⬇&nbsp;Thử lại';
        btn.disabled = false;
        btn.style.background = '#e94560';
        btn.style.cursor = 'pointer';
      }
      return false;
    } finally {
      _isBusy = false;
    }
  }

  async function buildEpubFromOpf(opfUrl, opts = {}) {
    _isBusy = true;
    const btn = document.getElementById('waka-dl-btn');
    if (btn) {
      btn.innerHTML = '⏳&nbsp;Đang giải mã...';
      btn.disabled = true;
      btn.style.cursor = 'default';
    }

    try {
      if (!window.WakaEpubDecode) {
        throw new Error('WakaEpubDecode chưa được nạp');
      }
      if (!window.EPUBBuilder || typeof EPUBBuilder.buildFromFiles !== 'function') {
        throw new Error('EPUBBuilder.buildFromFiles chưa sẵn sàng');
      }

      updateStatus('Tải content.opf...');
      const [opfPath, qs = ''] = String(opfUrl).split('?');
      const token = qs ? '?' + qs : '';
      const oebpsDir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);

      let opfResp = await fetchWithFallback(opfUrl);
      if (!opfResp.ok) throw new Error('content.opf HTTP ' + opfResp.status);

      const opfText = await opfResp.text();
      if (!opfText || !opfText.includes('<manifest')) {
        throw new Error('OPF không hợp lệ');
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(opfText, 'application/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('Không parse được content.opf');
      }

      const items = Array.from(doc.querySelectorAll('manifest item'))
        .map((el) => ({
          href: el.getAttribute('href') || '',
          type: el.getAttribute('media-type') || '',
        }))
        .filter((item) => item.href);

      if (items.length === 0) {
        throw new Error('OPF không có file nào trong manifest');
      }

      updateStatus(`Phát hiện ${items.length} file, đang tải...`);

      const files = new Map();
      let done = 0;
      let failed = 0;
      const batchSize = 5;

      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(batch.map(async (item) => {
          const fileUrl = resolveUrl(item.href, oebpsDir) + token;

          try {
            let resp = await fetchWithFallback(fileUrl);
            if (!resp.ok) {
              if (item.href.includes('toc.ncx') || resp.status === 404) {
                return;
              }
              throw new Error('HTTP ' + resp.status);
            }

            const buf = await resp.arrayBuffer();
            const isTextFile = /\.(xhtml|html?|xml|ncx|css|js|json)$/i.test(item.href);
            let finalValue = buf;

            if (isTextFile) {
              const decoded = WakaEpubDecode.decodeFileSync(buf);
              finalValue = decoded;
            }

            files.set(item.href, finalValue);
            done++;
          } catch (err) {
            failed++;
            console.warn('[Waka DL] File failed:', item.href, err.message);
          }
        }));

        updateStatus(`Đang tải file: ${done}/${items.length} · lỗi: ${failed}`);
      }

      if (files.size === 0) {
        throw new Error('Không tải được file dữ liệu nào');
      }

      updateStatus(`Đang giải mã và đóng gói ${files.size} file...`);
      const title = getPartDisplayTitle(WakaEpubDecode.extractTitleFromOpf(opfText, getBookTitle()), opts);
      let blob = await EPUBBuilder.buildFromFiles(title, opfText, files);
      const fname = `${safeName(title)}.epub`;

      // Nhúng metadata nếu có trong storage (dùng chung metadata trang đang duyệt,
      // riêng tiêu đề lấy theo phần đang tải)
      let metaNote = '';
      if (window.WakaMetaInjector) {
        const hasMeta = await WakaMetaInjector.hasMeta();
        if (hasMeta) {
          updateStatus('📚 Đang nhúng metadata + ảnh bìa vào EPUB...');
          try {
            blob = await WakaMetaInjector.injectIntoBlob(blob, title);
            metaNote = ' + metadata';
          } catch (e) {
            console.warn('[Waka DL] Inject metadata lỗi:', e);
          }
        }
      }

      downloadBlob(blob, fname);
      const sizeMb = (blob.size / 1024 / 1024).toFixed(2);
      const msg = `✅ Đã lưu: ${fname}${metaNote} · ${sizeMb}MB · ${files.size} file`;
      updateStatus(msg);
      showToast(msg);
      logDownload(title, fname);

      // Xóa metadata sau khi đã nhúng thành công (bỏ qua nếu đang tải hàng loạt nhiều phần)
      if (metaNote && window.WakaMetaInjector && !opts.keepMeta) {
        await WakaMetaInjector.clearMeta();
        document.getElementById('waka-meta-badge')?.remove();
      }

      if (btn) {
        btn.innerHTML = '✅&nbsp;Đã tải';
        btn.disabled = false;
        btn.style.background = '#28a745';
        btn.style.cursor = 'pointer';
      }
      return true;
    } catch (err) {
      console.error('[Waka DL]', err);
      updateStatus('❌ ' + err.message, true);
      showToast('❌ ' + err.message, true);
      if (btn) {
        btn.innerHTML = '⬇&nbsp;Thử lại';
        btn.disabled = false;
        btn.style.background = '#e94560';
        btn.style.cursor = 'pointer';
      }
      return false;
    } finally {
      _isBusy = false;
    }
  }

  function showDebugPanel(raw) {
    if (!SHOW_DEBUG_PANEL) return;

    let panel = document.getElementById('waka-dl-debug');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'waka-dl-debug';
      panel.style.cssText = [
        'position:fixed',
        'bottom:80px',
        'right:16px',
        'width:340px',
        'background:#0d0d1a',
        'border:1px solid #e94560',
        'border-radius:12px',
        'padding:14px',
        'font-family:monospace',
        'font-size:11px',
        'color:#ccc',
        'z-index:2147483646',
        'overflow-y:auto',
        'max-height:300px',
        'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
      ].join(';');
      document.body.appendChild(panel);
    }

    let display = raw;
    try {
      display = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {}

    const downloadUrl = extractDownloadUrl(raw);
    const modeText = downloadUrl
      ? (isOpfUrl(downloadUrl) ? 'Link OPF đã lọc' : 'Link EPUB đã lọc')
      : 'Chưa tìm thấy link tải';

    panel.innerHTML = `
      <div style="color:#e94560;font-weight:700;margin-bottom:8px;font-family:system-ui">
        📋 API Response (getDownloadItemWeb)
      </div>
      <pre style="white-space:pre-wrap;word-break:break-all;margin:0">${escHtml(display)}</pre>
      <div style="margin-top:10px;padding:10px;border:1px solid #2f6fed;border-radius:10px;background:#10192f">
        <div style="color:#7fb0ff;font-weight:700;margin-bottom:6px;font-family:system-ui">
          ${modeText}
        </div>
        ${
          downloadUrl
            ? `
              <div style="word-break:break-all;color:#d9e6ff;font-size:11px;line-height:1.5;margin-bottom:8px">${escHtml(downloadUrl)}</div>
              <button id="waka-dl-debug-download" style="background:#e94560;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer">
                ${isOpfUrl(downloadUrl) ? 'Tải EPUB ngay' : 'Tải EPUB ngay'}
              </button>
            `
            : `
              <div style="color:#888;font-size:11px;line-height:1.6">
                Chưa trích được URL tải từ response. Hãy chờ log panel đầy đủ hơn.
              </div>
            `
        }
      </div>
    `;

    const debugBtn = document.getElementById('waka-dl-debug-download');
    if (debugBtn && downloadUrl) {
      debugBtn.addEventListener('click', async () => {
        if (isOpfUrl(downloadUrl)) {
          await buildEpubFromOpf(downloadUrl);
        } else {
          await downloadDirectFile(downloadUrl);
        }
      });
    }
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  window.addEventListener('__waka_ebook_ready__', (e) => {
    const detail = e.detail || {};
    rememberDownloadUrl(detail.item_id || detail.book_id || extractCurrentBookId(), detail.url);
    console.log('[Waka DL] EPUB URL:', _downloadUrl);
    updateBtnState();
    showToast(isOpfUrl(_downloadUrl) ? '✅ Link OPF sẵn sàng - nhấn nút để dựng EPUB!' : '✅ Link EPUB sẵn sàng - nhấn nút để tải!');
  });

  window.addEventListener('__waka_ebook_raw__', (e) => {
    _rawResponse = e.detail.raw;
    console.log('[Waka DL] Raw API response:', _rawResponse);

    const url = extractDownloadUrl(_rawResponse);
    if (url) {
      rememberDownloadUrl(extractCurrentBookId(), url);
      updateBtnState();
      showToast(isOpfUrl(url) ? '✅ Đã lọc được link OPF từ log panel' : '✅ Đã lọc được link EPUB từ log panel');
    } else {
      setPrimaryLabel('🔍&nbsp;Xem response', true);
    }

    if (SHOW_DEBUG_PANEL) {
      showDebugPanel(_rawResponse);
    }
  });

  window.addEventListener('__waka_ebook_status__', (e) => {
    updateStatus(e.detail.msg, e.detail.isError);
  });

  window.addEventListener('__waka_related_books__', (e) => {
    const detail = e.detail || {};
    if (detail.book_id && _relatedRequestBookId && String(detail.book_id) !== String(_relatedRequestBookId)) return;
    const parts = normalizeRelatedParts(detail.books || detail.data?.list_chapter);
    if (parts.length > 1) {
      renderPartSelector(parts);
      showToast(`Đã phát hiện ${parts.length} phần của ebook`);
    } else if (detail.error) {
      console.warn('[Waka DL] getRelatedBooks:', detail.error);
    }
  });


  // ===== v4.5 Inline buttons + 1-click EPUB =====
  function buildReaderUrl() {
    var match = location.pathname.match(/\/ebook\/(.+)\.html$/i);
    if (!match) return null;
    var slug = match[1];
    if (/-bb([A-Za-z0-9]+)$/.test(slug)) {
      slug = slug.replace(/-bb([A-Za-z0-9]+)$/, '-rb$1');
    } else if (/-b([A-Za-z0-9]+)$/.test(slug)) {
      slug = slug.replace(/-b([A-Za-z0-9]+)$/, '-rb$1');
    }
    return 'https://waka.vn/reader/' + slug + '.html';
  }

  function isShopPage() {
    return /\/shop\//i.test(location.pathname);
  }

  function ensureInlineButtonStyles() {
    if (document.getElementById('waka-inline-btns-style')) return;
    var style = document.createElement('style');
    style.id = 'waka-inline-btns-style';
    style.textContent = [
      '#waka-inline-btns .waka-inline-action{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:linear-gradient(135deg,#22d8ad,#12b992);color:#fff;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:700;line-height:1.2;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .15s,transform .15s,box-shadow .15s;white-space:nowrap;}',
      '#waka-inline-btns .waka-inline-action:disabled{opacity:.72;}',
      '#waka-inline-btns #waka-part-select{height:32px;max-width:230px;border:1px solid rgba(255,255,255,.22);border-radius:7px;background:#121214;color:#fff;padding:0 30px 0 10px;font-size:12px;font-weight:700;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,.25);outline:none;}',
      '#waka-inline-btns #waka-part-select:focus{border-color:#22d8ad;box-shadow:0 0 0 2px rgba(34,216,173,.22);}',
      '@media (max-width:760px),(hover:none) and (pointer:coarse){',
      '  #wdl-meta-btn-wrapper{width:100%!important;justify-content:center!important;}',
      '  #waka-inline-btns-wrap{width:100%!important;margin:16px auto 18px!important;display:flex!important;justify-content:center!important;}',
      '  #waka-inline-btns{width:min(86vw,620px)!important;margin:16px auto 18px!important;display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:12px!important;align-items:center!important;justify-content:center!important;}',
      '  #waka-inline-btns #waka-part-select{grid-column:1/-1!important;width:100%!important;max-width:none!important;height:46px!important;border-radius:999px!important;background:#17181c!important;font-size:15px!important;padding:0 18px!important;}',
      '  #waka-inline-btns .waka-inline-action{width:100%!important;min-height:48px!important;border-radius:999px!important;padding:0 18px!important;background:linear-gradient(180deg,#20d6ad 0%,#12bd96 100%)!important;color:#fff!important;font-size:16px!important;font-weight:800!important;letter-spacing:0!important;box-shadow:0 10px 24px rgba(18,189,150,.28),inset 0 1px 0 rgba(255,255,255,.18)!important;}',
      '  #waka-inline-btns .waka-inline-action:active{transform:scale(.98)!important;}',
      '  #waka-inline-btns #waka-inline-epub{grid-column:1/-1!important;}',
      '}',
      '@media (max-width:380px){',
      '  #waka-inline-btns{width:min(90vw,620px)!important;gap:10px!important;}',
      '  #waka-inline-btns .waka-inline-action{font-size:15px!important;padding:0 12px!important;}',
      '}'
    ].join('\n');
    document.documentElement.appendChild(style);
  }

  // ===== v6.9.2 Tải hàng loạt EPUB các phần =====
  const _batchState = { running: false, cancel: false };

  function randomBatchDelayMs() {
    return 3000 + Math.floor(Math.random() * 2001); // 3000..5000ms
  }

  function ensureBatchDialogStyles() {
    if (document.getElementById('waka-batch-dialog-style')) return;
    var style = document.createElement('style');
    style.id = 'waka-batch-dialog-style';
    style.textContent = [
      '#waka-batch-overlay{position:fixed;inset:0;background:rgba(10,10,14,.72);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif;}',
      '#waka-batch-overlay .waka-batch-box{width:min(520px,94vw);max-height:86vh;background:#17181c;border:1px solid rgba(255,255,255,.08);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;}',
      '#waka-batch-overlay .waka-batch-title{padding:18px 20px 4px;font-size:17px;font-weight:800;color:#fff;}',
      '#waka-batch-overlay .waka-batch-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 20px;}',
      '#waka-batch-overlay .waka-batch-toolbar-left{display:flex;align-items:center;gap:8px;}',
      '#waka-batch-overlay .waka-batch-link-btn{background:transparent;border:1px solid rgba(255,255,255,.18);color:#cfd3da;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;}',
      '#waka-batch-overlay .waka-batch-link-btn:hover{border-color:#22d8ad;color:#22d8ad;}',
      '#waka-batch-overlay .waka-batch-count{font-size:12px;color:#9aa0aa;white-space:nowrap;}',
      '#waka-batch-overlay .waka-batch-list{overflow-y:auto;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);}',
      '#waka-batch-overlay .waka-batch-row{display:flex;align-items:center;gap:10px;padding:10px 20px;border-bottom:1px solid rgba(255,255,255,.05);}',
      '#waka-batch-overlay .waka-batch-row:last-child{border-bottom:none;}',
      '#waka-batch-overlay .waka-batch-cb{width:16px;height:16px;flex:0 0 auto;accent-color:#22d8ad;cursor:pointer;}',
      '#waka-batch-overlay .waka-batch-name{flex:1 1 auto;min-width:0;font-size:13px;color:#e7e9ee;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#waka-batch-overlay .waka-batch-status{flex:0 0 auto;font-size:12px;color:#9aa0aa;white-space:nowrap;}',
      '#waka-batch-overlay .waka-batch-status.waka-batch-status-ok{color:#22d8ad;}',
      '#waka-batch-overlay .waka-batch-status.waka-batch-status-error{color:#ff8a8a;}',
      '#waka-batch-overlay .waka-batch-retry{flex:0 0 auto;background:#e94560;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:800;cursor:pointer;}',
      '#waka-batch-overlay .waka-batch-actions{display:flex;gap:10px;padding:14px 20px 18px;}',
      '#waka-batch-overlay .waka-batch-download-btn{flex:1 1 auto;background:linear-gradient(180deg,#20d6ad 0%,#12bd96 100%);color:#fff;border:none;border-radius:10px;padding:12px 16px;font-size:14px;font-weight:800;cursor:pointer;}',
      '#waka-batch-overlay .waka-batch-download-btn:disabled{opacity:.6;cursor:default;}',
      '#waka-batch-overlay .waka-batch-cancel-btn{flex:0 0 auto;background:transparent;border:1px solid rgba(255,255,255,.18);color:#cfd3da;border-radius:10px;padding:12px 18px;font-size:14px;font-weight:700;cursor:pointer;}',
    ].join('\n');
    document.documentElement.appendChild(style);
  }

  function updateBatchSelectedCount() {
    var overlay = document.getElementById('waka-batch-overlay');
    if (!overlay) return;
    var boxes = overlay.querySelectorAll('.waka-batch-cb');
    var checked = overlay.querySelectorAll('.waka-batch-cb:checked').length;
    var countEl = overlay.querySelector('.waka-batch-count');
    if (countEl) countEl.textContent = 'Đã chọn: ' + checked + '/' + boxes.length;
  }

  function closeBatchDialog() {
    var overlay = document.getElementById('waka-batch-overlay');
    if (overlay) overlay.remove();
  }

  async function ensureBatchMetadataSaved() {
    if (!window.WakaBookMeta || typeof window.WakaBookMeta.saveCurrent !== 'function') return;
    try {
      await window.WakaBookMeta.saveCurrent();
    } catch (e) {
      console.warn('[Waka DL] save metadata (batch):', e);
    }
  }

  async function downloadSinglePartForBatch(part, statusEl, retryBtn, opts) {
    opts = opts || {};
    var clearMetaAfter = opts.clearMetaAfter !== false; // mặc định: dọn meta sau khi xong (dùng riêng lẻ)

    if (!part) return false;
    if (statusEl) {
      statusEl.textContent = 'Đang tải...';
      statusEl.classList.remove('waka-batch-status-ok', 'waka-batch-status-error');
    }
    if (retryBtn) retryBtn.style.display = 'none';

    // Toàn bộ các phần dùng chung 1 metadata của trang ebook đang duyệt (giống tải sách 1 phần),
    // chỉ tiêu đề nhúng vào EPUB thay đổi theo phần (xử lý trong buildEpubFromOpf/downloadDirectFile).
    await ensureBatchMetadataSaved();

    var ok = false;
    try {
      var url = await getDownloadUrlForBookId(part.book_id, null, { silent: true });
      if (!url) {
        throw new Error('Không lấy được link EPUB');
      }
      if (isOpfUrl(url)) {
        ok = await buildEpubFromOpf(url, { part: part, keepMeta: true });
      } else {
        ok = await downloadDirectFile(url, { part: part, keepMeta: true });
      }
    } catch (err) {
      ok = false;
    }

    if (clearMetaAfter && window.WakaMetaInjector) {
      await WakaMetaInjector.clearMeta();
      document.getElementById('waka-meta-badge')?.remove();
    }

    if (statusEl) {
      if (ok) {
        statusEl.textContent = 'Đã tải';
        statusEl.classList.add('waka-batch-status-ok');
        statusEl.classList.remove('waka-batch-status-error');
      } else {
        statusEl.textContent = 'Lỗi tải';
        statusEl.classList.add('waka-batch-status-error');
        statusEl.classList.remove('waka-batch-status-ok');
      }
    }
    if (retryBtn) retryBtn.style.display = ok ? 'none' : 'inline-block';
    return ok;
  }

  async function runBatchDownload(rows) {
    _batchState.running = true;
    _batchState.cancel = false;

    var overlay = document.getElementById('waka-batch-overlay');
    var downloadBtn = overlay ? overlay.querySelector('.waka-batch-download-btn') : null;
    var cancelBtn = overlay ? overlay.querySelector('.waka-batch-cancel-btn') : null;
    if (downloadBtn) { downloadBtn.disabled = true; downloadBtn.textContent = 'Đang tải...'; }
    if (cancelBtn) cancelBtn.textContent = 'Dừng';

    // Lưu metadata trang đang duyệt 1 lần, dùng chung cho mọi phần trong lượt tải này
    await ensureBatchMetadataSaved();

    for (var i = 0; i < rows.length; i++) {
      if (_batchState.cancel) break;
      var row = rows[i];
      var bookId = row.dataset.bookId;
      var part = _relatedParts.find(function(p) { return String(p.book_id) === String(bookId); });
      var statusEl = row.querySelector('.waka-batch-status');
      var retryBtn = row.querySelector('.waka-batch-retry');

      await downloadSinglePartForBatch(part, statusEl, retryBtn, { clearMetaAfter: false });

      if (_batchState.cancel) break;
      if (i < rows.length - 1) {
        await new Promise(function(resolve) { setTimeout(resolve, randomBatchDelayMs()); });
      }
    }

    // Dọn metadata dùng chung sau khi cả lượt tải hàng loạt kết thúc (xong hoặc bị dừng)
    if (window.WakaMetaInjector) {
      await WakaMetaInjector.clearMeta();
      document.getElementById('waka-meta-badge')?.remove();
    }

    _batchState.running = false;
    if (downloadBtn) { downloadBtn.disabled = false; downloadBtn.textContent = 'Tải các phần được chọn'; }
    if (cancelBtn) cancelBtn.textContent = 'Hủy';
    showToast(_batchState.cancel ? 'Đã dừng tải hàng loạt' : '✅ Đã tải xong các phần đã chọn');
  }

  function openBatchDownloadDialog() {
    if (resetPartsIfNavigated()) {
      showToast('Đã chuyển sang sách khác — đang nhận diện lại các phần, thử lại sau giây lát', true);
      return;
    }
    if (!_relatedParts || _relatedParts.length <= 1) {
      oneClickDownload();
      return;
    }
    if (document.getElementById('waka-batch-overlay')) return;
    ensureBatchDialogStyles();

    var overlay = document.createElement('div');
    overlay.id = 'waka-batch-overlay';

    var box = document.createElement('div');
    box.className = 'waka-batch-box';

    var title = document.createElement('div');
    title.className = 'waka-batch-title';
    title.textContent = 'Tải các phần của ebook:';
    box.appendChild(title);

    var toolbar = document.createElement('div');
    toolbar.className = 'waka-batch-toolbar';
    var toolbarLeft = document.createElement('div');
    toolbarLeft.className = 'waka-batch-toolbar-left';
    var btnAll = document.createElement('button');
    btnAll.type = 'button';
    btnAll.className = 'waka-batch-link-btn';
    btnAll.textContent = 'Chọn tất cả';
    var btnNone = document.createElement('button');
    btnNone.type = 'button';
    btnNone.className = 'waka-batch-link-btn';
    btnNone.textContent = 'Bỏ chọn';
    toolbarLeft.appendChild(btnAll);
    toolbarLeft.appendChild(btnNone);
    var countEl = document.createElement('div');
    countEl.className = 'waka-batch-count';
    toolbar.appendChild(toolbarLeft);
    toolbar.appendChild(countEl);
    box.appendChild(toolbar);

    var list = document.createElement('div');
    list.className = 'waka-batch-list';
    box.appendChild(list);

    _relatedParts.forEach(function(part) {
      var row = document.createElement('div');
      row.className = 'waka-batch-row';
      row.dataset.bookId = part.book_id;

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'waka-batch-cb';
      cb.checked = true;
      cb.addEventListener('change', updateBatchSelectedCount);
      row.appendChild(cb);

      var nameEl = document.createElement('div');
      nameEl.className = 'waka-batch-name';
      nameEl.textContent = part.name || ('Phần ' + part.order);
      nameEl.title = nameEl.textContent;
      row.appendChild(nameEl);

      var statusEl = document.createElement('div');
      statusEl.className = 'waka-batch-status';
      statusEl.textContent = 'Chờ tải';
      row.appendChild(statusEl);

      var retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'waka-batch-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.style.display = 'none';
      retryBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (_batchState.running) {
          showToast('Đang tải hàng loạt, vui lòng đợi...');
          return;
        }
        downloadSinglePartForBatch(part, statusEl, retryBtn);
      });
      row.appendChild(retryBtn);

      list.appendChild(row);
    });

    var actions = document.createElement('div');
    actions.className = 'waka-batch-actions';
    var btnDownload = document.createElement('button');
    btnDownload.type = 'button';
    btnDownload.className = 'waka-batch-download-btn';
    btnDownload.textContent = 'Tải các phần được chọn';
    var btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'waka-batch-cancel-btn';
    btnCancel.textContent = 'Hủy';
    actions.appendChild(btnDownload);
    actions.appendChild(btnCancel);
    box.appendChild(actions);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    updateBatchSelectedCount();

    btnAll.addEventListener('click', function() {
      list.querySelectorAll('.waka-batch-cb').forEach(function(cb) { cb.checked = true; });
      updateBatchSelectedCount();
    });
    btnNone.addEventListener('click', function() {
      list.querySelectorAll('.waka-batch-cb').forEach(function(cb) { cb.checked = false; });
      updateBatchSelectedCount();
    });

    btnCancel.addEventListener('click', function() {
      if (_batchState.running) {
        _batchState.cancel = true;
        return;
      }
      closeBatchDialog();
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay && !_batchState.running) closeBatchDialog();
    });

    btnDownload.addEventListener('click', function() {
      if (_batchState.running) return;
      var rows = Array.from(list.querySelectorAll('.waka-batch-row'));
      var selected = rows.filter(function(row) {
        var cb = row.querySelector('.waka-batch-cb');
        return cb && cb.checked;
      });
      if (!selected.length) {
        showToast('Chưa chọn phần nào để tải');
        return;
      }
      runBatchDownload(selected);
    });
  }

  function injectInlineButtons() {
    if (document.getElementById('waka-inline-btns')) {
      requestRelatedParts();
      return true;
    }
    ensureInlineButtonStyles();

    // Ưu tiên chèn cạnh nút Copy metadata (ổn định nhất)
    var metaBtn = document.getElementById('wdl-book-detect-btn');
    var metaWrap = document.getElementById('wdl-meta-btn-wrapper');

    // Shop: nếu chưa có metadata btn thì chèn ngay dưới tiêu đề
    var titleEl = document.querySelector('h1.title-product, h1.text-white-50, h1');
    if (!metaBtn && !metaWrap) {
      if (isShopPage() && titleEl) {
        // tiếp tục — sẽ chèn dưới title
      } else {
        // Chưa có nút metadata → đợi injectDetectButton tạo xong
        return false;
      }
    }

    var container = document.createElement('div');
    container.id = 'waka-inline-btns';
    container.style.cssText = 'display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center;margin-left:6px;';

    // Chỉ nút Tải EPUB (không thêm Đọc thử)
    var btnEpub = document.createElement('button');
    btnEpub.id = 'waka-inline-epub';
    btnEpub.className = 'waka-inline-action';
    btnEpub.type = 'button';
    btnEpub.innerHTML = '⬇ Tải EPUB';
    btnEpub.onmouseenter = function() { btnEpub.style.opacity = '0.85'; };
    btnEpub.onmouseleave = function() { btnEpub.style.opacity = '1'; };
    btnEpub.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (_relatedParts && _relatedParts.length > 1) {
        openBatchDownloadDialog();
      } else {
        oneClickDownload();
      }
    });
    container.appendChild(btnEpub);

    // Chèn vào cùng hàng với Copy metadata
    if (metaWrap) {
      metaWrap.style.display = 'flex';
      metaWrap.style.alignItems = 'center';
      metaWrap.style.flexWrap = 'wrap';
      metaWrap.style.gap = '8px';
      metaWrap.appendChild(container);
      requestRelatedParts();
      console.log('[Waka DL] Tải EPUB chèn cạnh Copy metadata');
      return true;
    }
    if (metaBtn && metaBtn.parentElement) {
      metaBtn.parentElement.style.display = 'flex';
      metaBtn.parentElement.style.alignItems = 'center';
      metaBtn.parentElement.style.flexWrap = 'wrap';
      metaBtn.parentElement.style.gap = '8px';
      metaBtn.parentElement.appendChild(container);
      requestRelatedParts();
      console.log('[Waka DL] Tải EPUB chèn cạnh metadata btn');
      return true;
    }

    // Shop / fallback: chèn ngay dưới tiêu đề sách
    if (titleEl) {
      var wrap = document.createElement('div');
      wrap.id = 'waka-inline-btns-wrap';
      wrap.style.cssText = 'margin:8px 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
      wrap.appendChild(container);
      titleEl.insertAdjacentElement('afterend', wrap);
      requestRelatedParts();
      console.log('[Waka DL] Tải EPUB chèn ngay dưới tiêu đề');
      return true;
    }
    return false;
  }

  async function oneClickDownload(opts = {}) {
    if (_isBusy) {
      showToast('Đang xử lý, vui lòng đợi...');
      return;
    }
    if (resetPartsIfNavigated()) {
      showToast('Đã chuyển sang sách khác — đang nhận diện lại các phần, thử lại sau giây lát', true);
      return;
    }
    var btn = document.getElementById('waka-inline-epub');
    try {
      if (btn) { btn.disabled = true; btn.style.cursor = 'default'; btn.innerHTML = '⏳ Metadata...'; }
      showToast('1/3 Đang lưu metadata...');

      if (window.WakaBookMeta && typeof window.WakaBookMeta.saveCurrent === 'function') {
        try {
          await window.WakaBookMeta.saveCurrent();
          showToast('1/3 Metadata đã lưu');
        } catch (e) {
          console.warn('[Waka DL] save metadata:', e);
        }
      }

      const selectedPart = getSelectedPart();
      const downloadUrl = await getDownloadUrlForSelectedPart(btn);

      if (!downloadUrl) {
        showToast('Không lấy được link EPUB (có thể sách bị chặn)', true);
        return;
      }

      if (btn) btn.innerHTML = '⏳ Tải file...';
      if (isOpfUrl(downloadUrl)) {
        await buildEpubFromOpf(downloadUrl, { part: selectedPart });
      } else {
        await downloadDirectFile(downloadUrl, { part: selectedPart });
      }
    } catch (err) {
      showToast('Lỗi tải: ' + (err && err.message ? err.message : err), true);
    } finally {
      if (btn) {
        btn.innerHTML = '⬇ Tải EPUB';
        btn.disabled = false;
        btn.style.cursor = 'pointer';
      }
    }
  }

  function observeAndInject() {
    injectInlineButtons();
    var obs = new MutationObserver(function() {
      if (!document.getElementById('waka-inline-btns')) injectInlineButtons();
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('__waka_ebook_ready__', (e) => {
    const detail = e.detail || {};
    rememberDownloadUrl(detail.item_id || detail.book_id || extractCurrentBookId(), detail.url);
    console.log('[Waka DL] EPUB URL:', _downloadUrl);
    updateBtnState();
    var inline = document.getElementById('waka-inline-epub');
    if (inline) {
      inline.style.background = 'linear-gradient(135deg,#22d8ad,#12b992)';
      inline.title = 'Link EPUB sẵn sàng';
    }
    showToast(isOpfUrl(_downloadUrl) ? '✅ Link OPF sẵn sàng!' : '✅ Link EPUB sẵn sàng!');
  });

  window.addEventListener('__waka_ebook_raw__', (e) => {
    _rawResponse = e.detail.raw;
    console.log('[Waka DL] Raw API response:', _rawResponse);

    const url = extractDownloadUrl(_rawResponse);
    if (url) {
      rememberDownloadUrl(extractCurrentBookId(), url);
      updateBtnState();
      showToast(isOpfUrl(url) ? '✅ Đã lọc được link OPF' : '✅ Đã lọc được link EPUB');
    } else {
      setPrimaryLabel('🔍&nbsp;Xem response', true);
    }

    if (SHOW_DEBUG_PANEL) {
      showDebugPanel(_rawResponse);
    }
  });

  window.addEventListener('__waka_params__', (e) => {
    const detail = e.detail || {};
    if (detail.item_id && !_currentBookId) _currentBookId = String(detail.item_id);
  });

  window.addEventListener('__waka_ebook_status__', (e) => {
    updateStatus(e.detail.msg, e.detail.isError);
    if (e.detail && e.detail.isError) showToast(e.detail.msg, true);
  });

  try {
    const _ps = history.pushState.bind(history);
    history.pushState = function (...args) {
      const r = _ps(...args);
      setTimeout(resetPartsIfNavigated, 300);
      return r;
    };
    window.addEventListener('popstate', () => setTimeout(resetPartsIfNavigated, 300));
  } catch (e) { /* bỏ qua */ }

  async function autoClearOnNewPage() {
    if (!window.WakaMetaInjector) return;
    const hasMeta = await WakaMetaInjector.hasMeta();
    if (hasMeta) {
      await WakaMetaInjector.clearMeta();
      document.getElementById('waka-meta-badge')?.remove();
      console.log('[Waka DL 4.5] Metadata cũ đã xóa khi vào trang mới.');
    }
  }

  if (document.body) {
    createUI();
    checkMetaBadge();
    autoClearOnNewPage();
    setTimeout(observeAndInject, 800);
  } else {
    new MutationObserver(function(_, obs) {
      if (document.body) {
        createUI();
        checkMetaBadge();
        autoClearOnNewPage();
        setTimeout(observeAndInject, 800);
        obs.disconnect();
      }
    }).observe(document.documentElement, { childList: true });
  }
})();

