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

  function safeName(s) {
    return String(s || 'waka-ebook')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 100);
  }

  function getBookTitle() {
    const h1 = document.querySelector('h1');
    if (h1?.textContent.trim()) return h1.textContent.trim();
    return document.title.replace(/\s*[-–]\s*.*Waka.*$/i, '').trim() || 'waka-ebook';
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

  function createUI() {
    if (document.getElementById('waka-dl-ui')) return;

    const ui = document.createElement('div');
    ui.id = 'waka-dl-ui';
    ui.style.cssText = [
      'position:fixed',
      'bottom:20px',
      'right:16px',
      'display:flex',
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

      const fname = `${safeName(getBookTitle())}.${ext}`;
      downloadBlob(blob, fname);
      updateStatus(`✅ Đã lưu: ${fname}`);
      showToast(`✅ Đã tải: ${fname}`);

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
      const blob = await EPUBBuilder.buildFromFiles(title, opfText, files);
      const fname = `${safeName(title)}.epub`;

      downloadBlob(blob, fname);
      const sizeMb = (blob.size / 1024 / 1024).toFixed(2);
      const msg = `✅ Đã lưu: ${fname} · ${sizeMb}MB · ${files.size} file`;
      updateStatus(msg);
      showToast(msg);

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

  if (document.body) {
    createUI();
  } else {
    new MutationObserver((_, obs) => {
      if (document.body) {
        createUI();
        obs.disconnect();
      }
    }).observe(document.documentElement, { childList: true });
  }
})();
