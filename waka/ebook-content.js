/**
 * ebook-content.js - ISOLATED world - chạy trên /ebook/*
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
    console.log("[Waka Userscript] Downloaded:", title, filename);
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

  async function downloadDirectFile(url) {
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

      // Nhúng metadata nếu có trong storage
      let finalBlob = blob;
      let metaNote = '';
      if (ext === 'epub' && window.WakaMetaInjector) {
        const hasMeta = await WakaMetaInjector.hasMeta();
        if (hasMeta) {
          updateStatus('📚 Đang nhúng metadata vào EPUB...');
          try {
            finalBlob = await WakaMetaInjector.injectIntoBlob(blob);
            metaNote = ' + metadata';
          } catch (e) {
            console.warn('[Waka DL] Inject metadata lỗi:', e);
          }
        }
      }

      const fname = `${safeName(getBookTitle())}.${ext}`;
      downloadBlob(finalBlob, fname);
      updateStatus(`✅ Đã lưu: ${fname}${metaNote}`);
      showToast(`✅ Đã tải: ${fname}${metaNote}`);
      logDownload(getBookTitle(), fname);

      // Xóa metadata sau khi đã nhúng thành công
      if (metaNote && window.WakaMetaInjector) {
        await WakaMetaInjector.clearMeta();
        document.getElementById('waka-meta-badge')?.remove();
      }

      if (btn) {
        btn.innerHTML = '✅&nbsp;Đã tải';
        btn.disabled = false;
        btn.style.background = '#28a745';
        btn.style.cursor = 'pointer';
      }
    } catch (err) {
      updateStatus('❌ ' + err.message, true);
      showToast('❌ Lỗi tải file: ' + err.message, true);
      if (btn) {
        btn.innerHTML = '⬇&nbsp;Thử lại';
        btn.disabled = false;
        btn.style.background = '#e94560';
        btn.style.cursor = 'pointer';
      }
    } finally {
      _isBusy = false;
    }
  }

  async function buildEpubFromOpf(opfUrl) {
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
      const title = WakaEpubDecode.extractTitleFromOpf(opfText, getBookTitle());
      let blob = await EPUBBuilder.buildFromFiles(title, opfText, files);
      const fname = `${safeName(title)}.epub`;

      // Nhúng metadata nếu có trong storage
      let metaNote = '';
      if (window.WakaMetaInjector) {
        const hasMeta = await WakaMetaInjector.hasMeta();
        if (hasMeta) {
          updateStatus('📚 Đang nhúng metadata + ảnh bìa vào EPUB...');
          try {
            blob = await WakaMetaInjector.injectIntoBlob(blob);
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

      // Xóa metadata sau khi đã nhúng thành công
      if (metaNote && window.WakaMetaInjector) {
        await WakaMetaInjector.clearMeta();
        document.getElementById('waka-meta-badge')?.remove();
      }

      if (btn) {
        btn.innerHTML = '✅&nbsp;Đã tải';
        btn.disabled = false;
        btn.style.background = '#28a745';
        btn.style.cursor = 'pointer';
      }
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
    _downloadUrl = e.detail.url;
    console.log('[Waka DL] EPUB URL:', _downloadUrl);
    updateBtnState();
    showToast(isOpfUrl(_downloadUrl) ? '✅ Link OPF sẵn sàng - nhấn nút để dựng EPUB!' : '✅ Link EPUB sẵn sàng - nhấn nút để tải!');
  });

  window.addEventListener('__waka_ebook_raw__', (e) => {
    _rawResponse = e.detail.raw;
    console.log('[Waka DL] Raw API response:', _rawResponse);

    const url = extractDownloadUrl(_rawResponse);
    if (url) {
      _downloadUrl = url;
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

  function injectInlineButtons() {
    if (document.getElementById('waka-inline-btns')) return true;

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
    btnEpub.type = 'button';
    btnEpub.innerHTML = '⬇ Tải EPUB';
    btnEpub.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'background:linear-gradient(135deg,#7c4dff,#651fff)',
      'color:#fff',
      'border:none',
      'border-radius:7px',
      'padding:6px 14px',
      'font-size:12px',
      'font-weight:700',
      'cursor:pointer',
      'font-family:inherit',
      'box-shadow:0 2px 8px rgba(0,0,0,.3)',
      'transition:opacity .15s'
    ].join(';');
    btnEpub.onmouseenter = function() { btnEpub.style.opacity = '0.85'; };
    btnEpub.onmouseleave = function() { btnEpub.style.opacity = '1'; };
    btnEpub.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      oneClickDownload();
    });
    container.appendChild(btnEpub);

    // Chèn vào cùng hàng với Copy metadata
    if (metaWrap) {
      metaWrap.style.display = 'flex';
      metaWrap.style.alignItems = 'center';
      metaWrap.style.flexWrap = 'wrap';
      metaWrap.style.gap = '8px';
      metaWrap.appendChild(container);
      console.log('[Waka DL] Tải EPUB chèn cạnh Copy metadata');
      return true;
    }
    if (metaBtn && metaBtn.parentElement) {
      metaBtn.parentElement.style.display = 'flex';
      metaBtn.parentElement.style.alignItems = 'center';
      metaBtn.parentElement.style.flexWrap = 'wrap';
      metaBtn.parentElement.style.gap = '8px';
      metaBtn.parentElement.appendChild(container);
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
      console.log('[Waka DL] Tải EPUB chèn ngay dưới tiêu đề');
      return true;
    }
    return false;
  }

  async function oneClickDownload() {
    if (_isBusy) {
      showToast('Đang xử lý, vui lòng đợi...');
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

      if (!_downloadUrl) {
        if (btn) btn.innerHTML = '⏳ Lấy link...';
        showToast('2/3 Đang lấy link EPUB...');
        var gotUrl = await new Promise(function(resolve) {
          var done = false;
          var onReady = function(e) {
            if (done) return;
            done = true;
            window.removeEventListener('__waka_ebook_ready__', onReady);
            resolve(e.detail && e.detail.url ? e.detail.url : null);
          };
          window.addEventListener('__waka_ebook_ready__', onReady);
          window.dispatchEvent(new CustomEvent('__waka_force_download__'));
          setTimeout(function() {
            if (done) return;
            done = true;
            window.removeEventListener('__waka_ebook_ready__', onReady);
            resolve(_downloadUrl);
          }, 12000);
        });
        if (gotUrl) _downloadUrl = gotUrl;
      }

      if (!_downloadUrl) {
        showToast('Không lấy được link EPUB (có thể sách bị chặn)', true);
        return;
      }

      if (btn) btn.innerHTML = '⏳ Tải file...';
      if (isOpfUrl(_downloadUrl)) {
        await buildEpubFromOpf(_downloadUrl);
      } else {
        await downloadDirectFile(_downloadUrl);
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
    _downloadUrl = e.detail.url;
    console.log('[Waka DL] EPUB URL:', _downloadUrl);
    updateBtnState();
    var inline = document.getElementById('waka-inline-epub');
    if (inline) {
      inline.style.background = 'linear-gradient(135deg,#2196f3,#1976d2)';
      inline.title = 'Link EPUB sẵn sàng';
    }
    showToast(isOpfUrl(_downloadUrl) ? '✅ Link OPF sẵn sàng!' : '✅ Link EPUB sẵn sàng!');
  });

  window.addEventListener('__waka_ebook_raw__', (e) => {
    _rawResponse = e.detail.raw;
    console.log('[Waka DL] Raw API response:', _rawResponse);

    const url = extractDownloadUrl(_rawResponse);
    if (url) {
      _downloadUrl = url;
      updateBtnState();
      showToast(isOpfUrl(url) ? '✅ Đã lọc được link OPF' : '✅ Đã lọc được link EPUB');
    } else {
      setPrimaryLabel('🔍&nbsp;Xem response', true);
    }

    if (SHOW_DEBUG_PANEL) {
      showDebugPanel(_rawResponse);
    }
  });

  window.addEventListener('__waka_ebook_status__', (e) => {
    updateStatus(e.detail.msg, e.detail.isError);
    if (e.detail && e.detail.isError) showToast(e.detail.msg, true);
  });

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
