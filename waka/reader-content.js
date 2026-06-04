/**
 * reader-content.js - ISOLATED world - /reader/*
 *
 * Nhận dữ liệu từ reader-interceptor.js (MAIN world) qua CustomEvents,
 * giải mã XHTML bằng WakaEpubDecode rồi đóng gói thành EPUB hợp lệ.
 *
 * Phụ thuộc:
 *   - lib/jszip.min.js
 *   - lib/crypto-js.min.js
 *   - epub-decode.js
 *   - epub-builder.js
 */
(function () {
  'use strict';

  let _epubUrl = null;
  let _title = 'Ebook';
  let _opfText = null;
  let _files = new Map();
  let _isBusy = false;
  let _isWaiting = false;

  window.addEventListener('__waka_epub_found__', (e) => {
    _epubUrl = e.detail.url;
    _title = e.detail.title || 'Ebook';
    activateBtn();
    setStatus('Sẵn sàng, nhấn nút để tải!');
  });

  window.addEventListener('__waka_epub_opf__', (e) => {
    _opfText = e.detail.text;
  });

  window.addEventListener('__waka_epub_file__', (e) => {
    _files.set(e.detail.href, e.detail.buffer);
  });

  window.addEventListener('__waka_epub_progress__', (e) => {
    setStatus(e.detail.msg || '');
    const btn = document.getElementById('wdl-btn');
    if (btn && _isWaiting) {
      const d = e.detail.done || 0;
      const f = e.detail.failed || 0;
      const t = e.detail.total || 0;
      btn.textContent = t > 0 ? `⏳ ${d + f}/${t}` : '⏳ Đang tải...';
    }
  });

  window.addEventListener('__waka_epub_done__', async (e) => {
    const { done, failed } = e.detail;
    _isWaiting = false;

    if (done === 0 && failed > 0) {
      setStatus(`Tất cả ${failed} file bị từ chối (403) - cần kiểm tra token`);
      const btn = document.getElementById('wdl-btn');
      if (btn) {
        btn.textContent = '⬇ Thử lại';
        btn.disabled = false;
        btn.style.background = '#e94560';
      }
      _isBusy = false;
      return;
    }

    setStatus(`Đang giải mã và đóng gói ${done} file thành EPUB...`);
    await buildAndDownload();
  });

  window.addEventListener('__waka_epub_error__', (e) => {
    _isWaiting = false;
    _isBusy = false;
    setStatus('Lỗi: ' + (e.detail.msg || 'Không xác định'));
    showToast('Lỗi: ' + e.detail.msg, true);
    const btn = document.getElementById('wdl-btn');
    if (btn) {
      btn.textContent = '⬇ Thử lại';
      btn.disabled = false;
      btn.style.background = '#e94560';
    }
  });

  async function handleClick() {
    if (_isBusy) return;
    if (!_epubUrl) {
      showToast('Đang tìm EPUB URL, thử reload trang...');
      return;
    }

    _isBusy = true;
    _isWaiting = true;
    _opfText = null;
    _files = new Map();

    const btn = document.getElementById('wdl-btn');
    if (btn) {
      btn.textContent = '⏳ Đang tải...';
      btn.disabled = true;
    }
    setStatus('Kết nối với server...');

    window.dispatchEvent(new CustomEvent('__waka_do_download__', {
      detail: { opfUrl: _epubUrl },
    }));
  }

  async function buildAndDownload() {
    try {
      if (!window.WakaEpubDecode) {
        throw new Error('WakaEpubDecode chưa được nạp');
      }
      if (!window.EPUBBuilder || typeof EPUBBuilder.buildFromFiles !== 'function') {
        throw new Error('EPUBBuilder.buildFromFiles chưa sẵn sàng');
      }

      const decodedFiles = new Map();
      let decodedCount = 0;

      for (const [href, buf] of _files) {
        if (!buf || buf.byteLength === 0) continue;

        const fileName = WakaEpubDecode.normalizeFileName(href);
        const isTextFile = /\.(xhtml|html?)$/i.test(fileName);

        if (isTextFile) {
          try {
            const decoded = WakaEpubDecode.decodeFileSync(buf);
            decodedFiles.set(fileName, decoded);
            decodedCount++;
            continue;
          } catch (err) {
            console.warn('[Waka DL] Decode failed, keeping original:', fileName, err.message);
          }
        }

        decodedFiles.set(fileName, buf);
      }

      if (decodedFiles.size === 0) {
        throw new Error('Không có file nào để đóng gói');
      }

      const title = WakaEpubDecode.extractTitleFromOpf(_opfText, _title || 'waka-ebook');
      const blob = await EPUBBuilder.buildFromFiles(title, _opfText, decodedFiles);
      const fname = WakaEpubDecode.safeName(title) + '.epub';
      triggerDownload(blob, fname);

      const size = (blob.size / 1024 / 1024).toFixed(2);
      const msg = `Đã lưu: ${fname} · ${size}MB · ${decodedFiles.size} files (${decodedCount} decoded)`;
      setStatus(msg);
      showToast(msg);

      const btn = document.getElementById('wdl-btn');
      if (btn) {
        btn.textContent = '✅ Đã tải!';
        btn.style.background = '#059669';
        btn.disabled = false;
      }
    } catch (err) {
      console.error('[Waka DL]', err);
      setStatus('Lỗi: ' + err.message);
      showToast('Lỗi: ' + err.message, true);
      const btn = document.getElementById('wdl-btn');
      if (btn) {
        btn.textContent = '⬇ Thử lại';
        btn.disabled = false;
        btn.style.background = '#e94560';
      }
    } finally {
      _isBusy = false;
      _isWaiting = false;
    }
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: filename,
      style: 'display:none',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function createUI() {
    if (document.getElementById('wdl-root')) return;

    const root = document.createElement('div');
    root.id = 'wdl-root';
    root.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'right:20px',
      'display:flex',
      'flex-direction:column',
      'align-items:flex-end',
      'gap:6px',
      'z-index:2147483647',
      'font-family:system-ui,-apple-system,sans-serif',
    ].join(';');

    const status = document.createElement('div');
    status.id = 'wdl-status';
    status.style.cssText = [
      'background:rgba(15,15,25,.92)',
      'color:#9ca3af',
      'font-size:11px',
      'padding:4px 12px',
      'border-radius:10px',
      'max-width:280px',
      'text-align:right',
      'line-height:1.5',
      'display:none',
    ].join(';');

    const btn = document.createElement('button');
    btn.id = 'wdl-btn';
    btn.textContent = '⏳ Đang tìm EPUB...';
    btn.style.cssText = [
      'background:#555',
      'color:#fff',
      'border:none',
      'border-radius:28px',
      'padding:11px 22px',
      'font-size:14px',
      'font-weight:700',
      'cursor:default',
      'opacity:.55',
      'box-shadow:0 4px 18px rgba(0,0,0,.4)',
      'transition:background .2s,opacity .2s',
      'white-space:nowrap',
    ].join(';');
    btn.addEventListener('click', handleClick);

    root.appendChild(status);
    root.appendChild(btn);
    document.body.appendChild(root);
  }

  function activateBtn() {
    const btn = document.getElementById('wdl-btn');
    if (!btn) return;
    btn.textContent = '⬇ Tải EPUB';
    btn.style.background = '#e94560';
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.onmouseenter = () => { btn.style.opacity = '.82'; };
    btn.onmouseleave = () => { btn.style.opacity = '1'; };
  }

  function setStatus(msg) {
    let el = document.getElementById('wdl-status');
    if (!el) {
      createUI();
      el = document.getElementById('wdl-status');
    }
    if (!el) return;
    el.style.display = 'block';
    el.textContent = msg;
  }

  let _tt;
  function showToast(msg, isError) {
    let t = document.getElementById('wdl-toast');
    if (!t) {
      t = Object.assign(document.createElement('div'), { id: 'wdl-toast' });
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
    clearTimeout(_tt);
    _tt = setTimeout(() => {
      t.style.opacity = '0';
    }, 5000);
  }

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
