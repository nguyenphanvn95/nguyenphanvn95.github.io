/**
 * oak-content.js — ISOLATED world trên /hieu-soi/*
 *
 * Chèn nút "⬇ EPUB" vào danh sách chương (.listchapter):
 *  - Desktop: thay vị trí nút "ĐỌC NGAY", ẩn nút gốc
 *  - Mobile / fallback: chèn sau tiêu đề chương
 * Bấm → interceptor gọi getDownloadItemOakWeb → dựng EPUB từ OPF
 */
(function () {
  'use strict';

  let _chapters = []; // { id, name, book_id, chapter_order, content_type }
  let _busyId = null;

  function isOpfUrl(url) {
    return /\/content\.opf(\?|$)/i.test(String(url || ''));
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

  // ── Nhúng metadata + cover vào EPUB blob ───────────────────────────────
  function xmlEscMeta(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchCoverBuffer(url) {
    if (!url) return null;
    try {
      const resp = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (resp.ok) {
        return {
          buf: await resp.arrayBuffer(),
          mime: resp.headers.get('content-type') || 'image/jpeg',
        };
      }
    } catch (_) {}
    // Fallback: canvas từ <img> trên trang (tránh CORS)
    try {
      const imgs = Array.from(document.querySelectorAll('img'));
      const match =
        imgs.find((img) => {
          const src = img.currentSrc || img.src || '';
          return src && (src === url || src.split('?')[0] === url.split('?')[0]);
        }) ||
        imgs.find((img) => {
          const src = (img.currentSrc || img.src || '').toLowerCase();
          return (
            src.includes('retail_book') ||
            src.includes('vegacdn') ||
            src.includes('img.book') ||
            src.includes('cover')
          );
        });
      if (match && match.naturalWidth > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = match.naturalWidth;
        canvas.height = match.naturalHeight;
        canvas.getContext('2d').drawImage(match, 0, 0);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
        if (blob) return { buf: await blob.arrayBuffer(), mime: 'image/jpeg' };
      }
    } catch (e) {
      console.warn('[Waka Oak] cover canvas fallback', e);
    }
    return null;
  }

  async function injectMetadataIntoBlob(epubBlob, meta) {
    if (!epubBlob || !meta || !meta.title) return epubBlob;
    if (!window.JSZip) {
      console.warn('[Waka Oak] JSZip missing, skip metadata inject');
      return epubBlob;
    }
    try {
      // Ưu tiên WakaMetaInjector nếu có
      if (window.WakaMetaInjector && typeof WakaMetaInjector.injectIntoBlob === 'function') {
        try {
          if (typeof WakaMetaInjector.saveMeta === 'function') {
            await WakaMetaInjector.saveMeta(meta);
          }
          const out = await WakaMetaInjector.injectIntoBlob(epubBlob);
          if (out && out.size) return out;
        } catch (e) {
          console.warn('[Waka Oak] WakaMetaInjector failed, fallback inline', e);
        }
      }

      const zip = await JSZip.loadAsync(epubBlob);
      let opfPath = null;
      try {
        const containerXml = await zip.file('META-INF/container.xml').async('text');
        const m = containerXml.match(/full-path="([^"]+)"/);
        if (m) opfPath = m[1];
      } catch {}
      if (!opfPath) {
        zip.forEach((p) => {
          if (!opfPath && p.endsWith('.opf')) opfPath = p;
        });
      }
      if (!opfPath) return epubBlob;

      const opfFile = zip.file(opfPath);
      if (!opfFile) return epubBlob;
      let opfText = await opfFile.async('text');
      const opfDir = opfPath.includes('/')
        ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1)
        : '';

      let coverInfo = null;
      const coverRes = meta.cover ? await fetchCoverBuffer(meta.cover) : null;
      if (coverRes && coverRes.buf) {
        const mime = /png/i.test(coverRes.mime)
          ? 'image/png'
          : /webp/i.test(coverRes.mime)
            ? 'image/webp'
            : 'image/jpeg';
        const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
        const href = `images/cover.${ext}`;
        zip.file(opfDir + href, coverRes.buf);
        coverInfo = { itemId: 'cover-image', href, mimeType: mime };
      }

      const dc = [];
      dc.push(`    <dc:identifier id="uid">waka-oak-${Date.now()}</dc:identifier>`);
      dc.push(`    <dc:title>${xmlEscMeta(meta.title)}</dc:title>`);
      dc.push(`    <dc:language>${xmlEscMeta(meta.language || 'vi')}</dc:language>`);
      (meta.authors || []).forEach((a) =>
        dc.push(`    <dc:creator>${xmlEscMeta(a)}</dc:creator>`)
      );
      if (meta.publisher) dc.push(`    <dc:publisher>${xmlEscMeta(meta.publisher)}</dc:publisher>`);
      if (meta.description || meta.comments) {
        dc.push(
          `    <dc:description>${xmlEscMeta(meta.description || meta.comments)}</dc:description>`
        );
      }
      (meta.tags || []).forEach((t) =>
        dc.push(`    <dc:subject>${xmlEscMeta(t)}</dc:subject>`)
      );
      if (meta.source_url) dc.push(`    <dc:source>${xmlEscMeta(meta.source_url)}</dc:source>`);
      dc.push(
        `    <meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta>`
      );
      if (coverInfo) {
        dc.push(`    <meta name="cover" content="${xmlEscMeta(coverInfo.itemId)}"/>`);
      }
      const metadataBlock =
        `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${dc.join('\n')}\n  </metadata>`;
      opfText = opfText.replace(/<metadata[\s\S]*?<\/metadata>/i, metadataBlock);

      if (coverInfo) {
        const newItem =
          `<item id="${xmlEscMeta(coverInfo.itemId)}" href="${xmlEscMeta(coverInfo.href)}" ` +
          `media-type="${xmlEscMeta(coverInfo.mimeType)}" properties="cover-image"/>`;
        opfText = opfText.replace(
          /<item\s[^>]*properties=["'][^"']*cover-image[^"']*["'][^>]*\/?\s*>/gi,
          ''
        );
        opfText = opfText.replace(/<item\s[^>]*id=["']cover-image["'][^>]*\/?\s*>/gi, '');
        if (/<manifest>/i.test(opfText)) {
          opfText = opfText.replace(/<manifest>/i, `<manifest>\n    ${newItem}`);
        }
      }

      zip.file(opfPath, opfText);
      const out = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/epub+zip',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      console.log(
        '[Waka Oak] Đã nhúng metadata' + (coverInfo ? ' + cover' : '') + ' →',
        meta.title,
        (out.size / 1024).toFixed(1) + ' KB'
      );
      return out;
    } catch (e) {
      console.warn('[Waka Oak] injectMetadataIntoBlob error', e);
      return epubBlob;
    }
  }

  function safeName(s) {
    return String(s || 'waka-chapter')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 120) || 'waka-chapter';
  }

  function getBookTitle() {
    const h1 = document.querySelector('h1');
    let title = h1?.textContent?.trim() || '';
    if (!title) {
      title = document.title.replace(/\s*[-–]\s*.*Waka.*$/i, '').trim();
    }
    return title || 'hieu-soi';
  }

  let _toastTimer;
  function showToast(msg, isError) {
    let t = document.getElementById('waka-oak-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'waka-oak-toast';
      t.style.cssText = [
        'position:fixed',
        'bottom:80px',
        'right:20px',
        'background:#111827',
        'color:#f3f4f6',
        'border-radius:12px',
        'padding:12px 18px',
        'font-size:13px',
        'max-width:360px',
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
    }, 4000);
  }

  function findChapterByTitle(titleText) {
    const t = (titleText || '').trim();
    if (!t) return null;
    let found = _chapters.find((c) => c.name === t || c.name.trim() === t);
    if (found) return found;
    // fuzzy: starts with same "Chương N"
    const m = t.match(/^Chương\s+(\d+)/i);
    if (m) {
      found = _chapters.find((c) => {
        const m2 = (c.name || '').match(/^Chương\s+(\d+)/i);
        return m2 && m2[1] === m[1] && (c.name || '').includes(t.slice(0, 20));
      });
      if (found) return found;
      found = _chapters.find((c) => {
        const m2 = (c.name || '').match(/^Chương\s+(\d+)/i);
        return m2 && m2[1] === m[1];
      });
    }
    return found || null;
  }

  function findChapterByDomIndex(rowEl) {
    const list = rowEl?.closest('.listchapter');
    if (!list) return null;
    const rows = Array.from(list.children).filter(
      (el) => el.nodeType === 1 && !el.classList.contains('waka-oak-ignore')
    );
    const idx = rows.indexOf(rowEl);
    if (idx < 0 || !_chapters.length) return null;
    // Map by order on current page — chapters may be sorted newest-first or oldest-first
    // Prefer matching by title; this is fallback by index within loaded page slice
    if (idx < _chapters.length) {
      // try both directions
      return _chapters[idx] || null;
    }
    return null;
  }

  async function buildEpubFromOpf(opfUrl, chapterTitle) {
    if (!window.WakaEpubDecode) throw new Error('WakaEpubDecode chưa được nạp');
    if (!window.EPUBBuilder || typeof EPUBBuilder.buildFromFiles !== 'function') {
      throw new Error('EPUBBuilder chưa sẵn sàng');
    }

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
    if (doc.querySelector('parsererror')) throw new Error('Không parse được content.opf');

    const items = Array.from(doc.querySelectorAll('manifest item'))
      .map((el) => ({
        href: el.getAttribute('href') || '',
        type: el.getAttribute('media-type') || '',
      }))
      .filter((item) => item.href);

    if (!items.length) throw new Error('OPF không có file trong manifest');

    const files = new Map();
    const batchSize = 5;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (item) => {
          const fileUrl = resolveUrl(item.href, oebpsDir) + token;
          try {
            let resp = await fetchWithFallback(fileUrl);
            if (!resp.ok) {
              if (item.href.includes('toc.ncx') || resp.status === 404) return;
              throw new Error('HTTP ' + resp.status);
            }
            const buf = await resp.arrayBuffer();
            const isTextFile = /\.(xhtml|html?|xml|ncx|css|js|json)$/i.test(item.href);
            let finalValue = buf;
            if (isTextFile) {
              finalValue = WakaEpubDecode.decodeFileSync(buf);
            }
            files.set(item.href, finalValue);
          } catch (err) {
            console.warn('[Waka Oak] file fail', item.href, err.message);
          }
        })
      );
    }

    if (!files.size) throw new Error('Không tải được file nào');

    const bookTitle = getBookTitle();
    const title =
      WakaEpubDecode.extractTitleFromOpf?.(opfText, chapterTitle || bookTitle) ||
      chapterTitle ||
      bookTitle;
    const displayTitle = chapterTitle
      ? `${bookTitle} - ${chapterTitle}`
      : title;

    let blob = await EPUBBuilder.buildFromFiles(displayTitle, opfText, files);

    // Nhúng metadata + cover từ trang hieu-soi
    try {
      const pageMeta = typeof extractPageMeta === 'function' ? extractPageMeta() : null;
      if (pageMeta && pageMeta.title) {
        // Giữ title chương trong OPF, nhưng thêm author/cover/publisher từ sách
        const metaForInject = {
          ...pageMeta,
          title: displayTitle,
        };
        blob = await injectMetadataIntoBlob(blob, metaForInject);
      }
    } catch (e) {
      console.warn('[Waka Oak] inject chapter meta', e);
    }

    const fname = `${safeName(displayTitle)}.epub`;
    downloadBlob(blob, fname);

    try {
      chrome.runtime.sendMessage({
        action: 'addDownloadHistory',
        entry: { title: displayTitle, filename: fname, type: 'epub' },
      });
    } catch {}

    return fname;
  }

  async function downloadDirectFile(url, chapterTitle) {
    const resp = await fetchWithFallback(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const contentType = resp.headers.get('content-type') || '';
    let blob = await resp.blob();
    let ext = 'epub';
    if (contentType.includes('pdf') || /\.pdf(\?|$)/i.test(url)) ext = 'pdf';
    const bookTitle = getBookTitle();
    const displayTitle = chapterTitle
      ? `${bookTitle} - ${chapterTitle}`
      : bookTitle;

    if (ext === 'epub') {
      try {
        const pageMeta = typeof extractPageMeta === 'function' ? extractPageMeta() : null;
        if (pageMeta && pageMeta.title) {
          blob = await injectMetadataIntoBlob(blob, {
            ...pageMeta,
            title: displayTitle,
          });
        }
      } catch (e) {
        console.warn('[Waka Oak] inject direct meta', e);
      }
    }

    const fname = `${safeName(displayTitle)}.${ext}`;
    downloadBlob(blob, fname);
    return fname;
  }

  function setBtnState(btn, html, disabled) {
    if (!btn) return;
    btn.innerHTML = html;
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? '0.7' : '1';
    btn.style.cursor = disabled ? 'default' : 'pointer';
  }

  async function onDownloadClick(btn, chapter) {
    if (_busyId) {
      showToast('Đang tải chương khác, vui lòng đợi...');
      return;
    }
    if (!chapter || !chapter.id) {
      showToast('Chưa có id chương — đợi danh sách load xong', true);
      window.dispatchEvent(new CustomEvent('__waka_oak_request_chapters__'));
      return;
    }

    _busyId = chapter.id;
    setBtnState(btn, '⏳...', true);
    showToast('Đang lấy link: ' + (chapter.name || chapter.id));

    try {
      const result = await new Promise((resolve) => {
        let done = false;
        const onReady = (e) => {
          if (done) return;
          if (e.detail?.item_id && String(e.detail.item_id) !== String(chapter.id)) return;
          done = true;
          window.removeEventListener('__waka_oak_chapter_ready__', onReady);
          window.removeEventListener('__waka_oak_status__', onStatus);
          resolve({ ok: true, url: e.detail?.url, name: e.detail?.name, via: e.detail?.via });
        };
        const onStatus = (e) => {
          if (done) return;
          if (e.detail?.isError && (!e.detail.item_id || String(e.detail.item_id) === String(chapter.id))) {
            done = true;
            window.removeEventListener('__waka_oak_chapter_ready__', onReady);
            window.removeEventListener('__waka_oak_status__', onStatus);
            resolve({ ok: false, error: e.detail?.msg || 'Lỗi' });
          }
        };
        window.addEventListener('__waka_oak_chapter_ready__', onReady);
        window.addEventListener('__waka_oak_status__', onStatus);
        window.dispatchEvent(
          new CustomEvent('__waka_oak_download_chapter__', {
            detail: {
              item_id: chapter.id,
              name: chapter.name,
              content_type: chapter.content_type || 'retail_book_chapter',
            },
          })
        );
        setTimeout(() => {
          if (done) return;
          done = true;
          window.removeEventListener('__waka_oak_chapter_ready__', onReady);
          window.removeEventListener('__waka_oak_status__', onStatus);
          resolve({ ok: false, error: 'Timeout lấy link chương' });
        }, 20000);
      });

      if (!result.ok || !result.url) {
        showToast(result.error || 'Không lấy được link', true);
        return;
      }

      setBtnState(btn, '📦...', true);
      if (result.via === 'opf-template') {
        showToast('Dùng OPF dự từ chương đã tải — đang dựng EPUB...');
      } else {
        showToast('Đang dựng EPUB...');
      }

      let fname;
      if (isOpfUrl(result.url)) {
        fname = await buildEpubFromOpf(result.url, chapter.name);
      } else {
        fname = await downloadDirectFile(result.url, chapter.name);
      }
      showToast('✅ Đã lưu: ' + fname);
    } catch (err) {
      console.error('[Waka Oak] download error', err);
      showToast('Lỗi: ' + (err && err.message ? err.message : err), true);
    } finally {
      _busyId = null;
      setBtnState(btn, '⬇ EPUB', false);
    }
  }

  function makeDownloadBtn(chapter) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'waka-oak-chap-dl';
    btn.dataset.chapterId = chapter?.id != null ? String(chapter.id) : '';
    btn.innerHTML = '⬇ EPUB';
    btn.title = chapter?.name
      ? 'Tải EPUB: ' + chapter.name
      : 'Tải EPUB chương này';
    btn.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:4px',
      'background:linear-gradient(135deg,#7c4dff,#651fff)',
      'color:#fff',
      'border:none',
      'border-radius:6px',
      'padding:3px 10px',
      'font-size:11px',
      'font-weight:700',
      'cursor:pointer',
      'font-family:inherit',
      'margin-left:8px',
      'vertical-align:middle',
      'box-shadow:0 2px 6px rgba(0,0,0,.25)',
      'transition:opacity .15s',
      'flex-shrink:0',
      'white-space:nowrap',
    ].join(';');
    btn.onmouseenter = () => {
      if (!btn.disabled) btn.style.opacity = '0.85';
    };
    btn.onmouseleave = () => {
      if (!btn.disabled) btn.style.opacity = '1';
    };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // refresh chapter from latest cache
      let ch = chapter;
      if (chapter?.id) {
        const fresh = _chapters.find((c) => String(c.id) === String(chapter.id));
        if (fresh) ch = fresh;
      }
      onDownloadClick(btn, ch);
    });
    return btn;
  }

  function isDocNgayText(t) {
    const s = String(t || '').trim().replace(/\s+/g, ' ');
    return /^ĐỌC\s*NGAY$/i.test(s) || /^Đọc\s*ngay$/i.test(s);
  }

  function findAllDocNgayButtons() {
    const out = [];
    const candidates = document.querySelectorAll(
      'button, a, [role="button"], div[class*="btn"], span[class*="btn"], div, span'
    );
    for (const el of candidates) {
      if (el.classList?.contains('waka-oak-chap-dl')) continue;
      if (el.classList?.contains('waka-oak-hidden-doc-ngay')) continue;
      // Chỉ lấy node lá / gần lá để tránh match container chứa
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent || '')
        .join('')
        .trim();
      const full = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (isDocNgayText(ownText) || isDocNgayText(full)) {
        // Nếu phần tử con cũng là ĐỌC NGAY thì bỏ qua cha
        const childIsBtn = Array.from(el.children || []).some((c) =>
          isDocNgayText((c.textContent || '').trim())
        );
        if (childIsBtn) continue;
        out.push(el);
      }
    }
    return out;
  }

  function getRowTitle(row, docNgayBtn) {
    const titleEl =
      row.querySelector('.t-ellipsis-1') ||
      row.querySelector('[class*="text-[14px]"]') ||
      row.querySelector('[class*="ellipsis"]') ||
      null;
    let titleText = '';
    if (titleEl) {
      titleText = (titleEl.textContent || '').trim();
    } else {
      // Lấy text dòng, bỏ metadata + ĐỌC NGAY
      titleText = (row.textContent || '').trim();
    }
    titleText = titleText
      .replace(/ĐỌC\s*NGAY/gi, '')
      .replace(/Đọc\s*ngay/gi, '')
      .replace(/\d[\d.,]*\s*chữ/gi, '')
      .replace(/\d{1,2}:\d{2}/g, '')
      .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '')
      .replace(/\b\d{2,4}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Ưu tiên đoạn bắt đầu bằng "Chương"
    const m = titleText.match(/Chương\s*[\d.]+[^\n]{0,80}/i);
    if (m) titleText = m[0].trim();
    return titleText;
  }

  function injectButtons() {
    let injected = 0;

    // ── Cách 1 (desktop): thay trực tiếp mọi nút "ĐỌC NGAY" ──
    const docBtns = findAllDocNgayButtons();
    docBtns.forEach((docNgayBtn, idx) => {
      // Đã có nút EPUB cạnh nó chưa?
      const parent = docNgayBtn.parentElement;
      if (!parent) return;
      if (parent.querySelector('.waka-oak-chap-dl')) return;
      if (docNgayBtn.previousElementSibling?.classList?.contains('waka-oak-chap-dl')) return;
      if (docNgayBtn.nextElementSibling?.classList?.contains('waka-oak-chap-dl')) return;

      const row =
        docNgayBtn.closest(
          '.border-gray-333, [class*="border-gray"], [class*="listchapter"] > *, [class*="list-chapter"] > *, li, [class*="chapter"]'
        ) || parent.parentElement || parent;

      const titleText = getRowTitle(row, docNgayBtn);
      let chapter = findChapterByTitle(titleText);
      if (!chapter && _chapters.length && idx < _chapters.length) {
        chapter = _chapters[idx];
      }

      const btn = makeDownloadBtn(
        chapter || { id: null, name: titleText || 'chapter', content_type: 'retail_book_chapter' }
      );

      // Style khớp nút ĐỌC NGAY
      btn.style.marginLeft = '0';
      btn.style.padding = '6px 14px';
      btn.style.fontSize = '12px';
      btn.style.borderRadius = '8px';
      btn.style.minWidth = docNgayBtn.offsetWidth
        ? Math.max(docNgayBtn.offsetWidth, 90) + 'px'
        : '90px';
      btn.style.justifyContent = 'center';
      btn.style.height = docNgayBtn.offsetHeight
        ? docNgayBtn.offsetHeight + 'px'
        : '';

      // Ẩn ĐỌC NGAY
      docNgayBtn.style.setProperty('display', 'none', 'important');
      docNgayBtn.setAttribute('aria-hidden', 'true');
      docNgayBtn.classList.add('waka-oak-hidden-doc-ngay');

      parent.insertBefore(btn, docNgayBtn);
      injected++;
    });

    // ── Cách 2 (mobile / fallback): .listchapter + chèn sau tiêu đề ──
    const list =
      document.querySelector('.listchapter') ||
      document.querySelector('[class*="listchapter"]') ||
      document.querySelector('[class*="list-chapter"]');
    if (list) {
      const rows = Array.from(list.children).filter((el) => el.nodeType === 1);
      rows.forEach((row, idx) => {
        if (row.querySelector('.waka-oak-chap-dl')) return;
        // Nếu dòng vẫn còn ĐỌC NGAY chưa ẩn thì bỏ qua (cách 1 sẽ xử lý)
        const stillDoc = Array.from(row.querySelectorAll('button, a, div, span')).some(
          (el) => isDocNgayText((el.textContent || '').trim()) && !el.classList.contains('waka-oak-hidden-doc-ngay')
        );
        if (stillDoc) return;

        const titleEl =
          row.querySelector('.t-ellipsis-1') ||
          row.querySelector('[class*="text-[14px]"]') ||
          row.querySelector('[class*="ellipsis"]') ||
          row.querySelector('div');
        if (!titleEl) return;

        let titleText = (titleEl.textContent || '').trim();
        titleText = titleText.replace(/ĐỌC\s*NGAY/gi, '').replace(/Đọc\s*ngay/gi, '').trim();
        if (!titleText || titleText.length < 2) return;

        let chapter = findChapterByTitle(titleText);
        if (!chapter && _chapters.length && idx < _chapters.length) {
          chapter = _chapters[idx];
        }

        const btn = makeDownloadBtn(
          chapter || { id: null, name: titleText, content_type: 'retail_book_chapter' }
        );

        if (titleEl.parentElement === row) {
          titleEl.style.display = 'flex';
          titleEl.style.alignItems = 'center';
          titleEl.style.flexWrap = 'wrap';
          titleEl.style.gap = '4px';
          titleEl.appendChild(btn);
        } else {
          titleEl.insertAdjacentElement('afterend', btn);
        }
        injected++;
      });
    }

    if (injected) {
      console.log('[Waka Oak] injected', injected, 'buttons, chapters cached=', _chapters.length);
    }
    return injected > 0;
  }

  function ensureHideStyle() {
    if (document.getElementById('waka-oak-hide-doc-ngay')) return;
    const style = document.createElement('style');
    style.id = 'waka-oak-hide-doc-ngay';
    style.textContent = `
      .waka-oak-hidden-doc-ngay {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
        width: 0 !important;
        min-width: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
      }
      .waka-oak-chap-dl {
        display: inline-flex !important;
        visibility: visible !important;
        z-index: 5;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function observeList() {
    ensureHideStyle();
    injectButtons();
    const obs = new MutationObserver(() => {
      injectButtons();
    });
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    }
    // Định kỳ reinject (pagination SPA)
    setInterval(injectButtons, 1500);
  }

  window.addEventListener('__waka_oak_chapters__', (e) => {
    _chapters = e.detail?.chapters || [];
    if (e.detail?.book_id) _bookId = e.detail.book_id;
    else if (_chapters[0]?.book_id) _bookId = _chapters[0].book_id;
    console.log('[Waka Oak] content nhận', _chapters.length, 'chương, book_id=', _bookId);
    injectButtons();
    // Cập nhật data-chapter-id trên nút đã có
    document.querySelectorAll('.waka-oak-chap-dl').forEach((btn) => {
      const row =
        btn.closest('.border-gray-333, .listchapter > div, .listchapter > *') ||
        btn.parentElement;
      const titleEl =
        row?.querySelector('.t-ellipsis-1') ||
        row?.querySelector('[class*="text-[14px]"]') ||
        btn.previousElementSibling;
      let titleText = (titleEl?.textContent || '').replace(btn.textContent || '', '').trim();
      titleText = titleText.replace(/ĐỌC\s*NGAY/gi, '').replace(/Đọc\s*ngay/gi, '').trim();
      const ch = findChapterByTitle(titleText);
      if (ch) {
        btn.dataset.chapterId = String(ch.id);
        btn.title = 'Tải EPUB: ' + ch.name;
        // rebind chapter for click via dataset
        btn.onclick = null;
        btn.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            onDownloadClick(btn, ch);
          },
          { once: false }
        );
      }
    });
  });

  window.addEventListener('__waka_oak_status__', (e) => {
    if (e.detail?.msg) showToast(e.detail.msg, !!e.detail.isError);
    updateFullStatus(e.detail?.msg, !!e.detail?.isError);
  });

  // ══════════════════════════════════════════════════════════════
  //  HEADER: Copy metadata + Tải full
  // ══════════════════════════════════════════════════════════════

  let _fullBusy = false;
  let _bookId = null;

  function extractPageMeta() {
    const title = getBookTitle();
    let author = '';
    let publisher = '';
    let description = '';
    let cover = '';
    let tags = [];

    // DOM heuristics (trang hieu-soi)
    const labels = Array.from(document.querySelectorAll('div, span, p, dt, dd'));
    for (let i = 0; i < labels.length; i++) {
      const t = (labels[i].textContent || '').trim();
      if (t === 'Tác giả' || t === 'Tác giả:') {
        const next = labels[i].parentElement?.querySelector('a, .text-f2f, [class*="text-"]') ||
          labels[i].nextElementSibling;
        const a = (next?.textContent || '').trim();
        if (a && a !== 'Tác giả') author = a;
      }
      if (t === 'Nhà xuất bản' || t === 'NXB') {
        const next = labels[i].nextElementSibling || labels[i].parentElement;
        const a = (next?.textContent || '').replace(/Nhà xuất bản/g, '').trim();
        if (a) publisher = a;
      }
    }
    // description
    const descEl = document.querySelector('[class*="description"], .desc-custom, article p');
    if (descEl) description = (descEl.innerText || '').trim().slice(0, 2000);

    // cover
    const img =
      document.querySelector('img[src*="retail_book"]') ||
      document.querySelector('img[src*="vegacdn"]') ||
      document.querySelector('img[alt*="' + title.slice(0, 10) + '"]');
    if (img) cover = img.src || '';

    // genre
    const genreLabel = Array.from(document.querySelectorAll('div, span')).find(
      (el) => (el.textContent || '').trim() === 'Thể loại'
    );
    if (genreLabel) {
      const g = (genreLabel.parentElement?.textContent || '')
        .replace('Thể loại', '')
        .trim();
      if (g) tags = g.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    }

    return {
      title,
      authors: author ? [author] : [],
      publisher,
      description,
      cover,
      tags,
      language: 'vi',
      source_url: location.href,
      waka_type: 'hieu-soi',
      book_id: _bookId || (_chapters[0] && _chapters[0].book_id) || null,
      chapter_count: _chapters.length || null,
    };
  }

  async function copyMetadata() {
    const meta = extractPageMeta();
    const text = JSON.stringify(meta, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ Đã copy metadata (' + (meta.title || '') + ')');
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('✅ Đã copy metadata');
    }
    console.log('[Waka Oak] metadata', meta);
  }

  function updateFullStatus(msg, isError) {
    const el = document.getElementById('waka-oak-full-status');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
    el.style.color = isError ? '#ff8a8a' : '#aaa';
  }

  function injectHeaderButtons() {
    if (document.getElementById('waka-oak-header-btns')) return true;

    const h1 =
      document.querySelector('h1.text-white-50') ||
      document.querySelector('h1[class*="text-"]') ||
      document.querySelector('h1');
    if (!h1 || !(h1.textContent || '').trim()) return false;
    // bỏ h1 ẩn mobile
    if (h1.classList.contains('hidden') && window.innerWidth > 768) {
      // try visible h1
    }

    // Tìm h1 hiển thị
    let target = null;
    document.querySelectorAll('h1').forEach((el) => {
      const st = window.getComputedStyle(el);
      if (st.display !== 'none' && st.visibility !== 'hidden' && (el.textContent || '').trim().length > 2) {
        target = el;
      }
    });
    if (!target) target = h1;

    const wrap = document.createElement('div');
    wrap.id = 'waka-oak-header-btns';
    wrap.style.cssText =
      'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 12px;';

    const btnMeta = document.createElement('button');
    btnMeta.type = 'button';
    btnMeta.id = 'waka-oak-copy-meta';
    btnMeta.innerHTML = '📋 Copy metadata';
    btnMeta.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'padding:6px 14px',
      'background:#e85d26',
      'color:#fff',
      'border:none',
      'border-radius:7px',
      'font-size:12px',
      'font-weight:700',
      'cursor:pointer',
      'font-family:inherit',
      'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    ].join(';');
    btnMeta.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyMetadata();
    };

    const btnFull = document.createElement('button');
    btnFull.type = 'button';
    btnFull.id = 'waka-oak-dl-full';
    btnFull.innerHTML = '⬇ Tải truyện full';
    btnFull.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:6px',
      'padding:6px 14px',
      'background:linear-gradient(135deg,#7c4dff,#651fff)',
      'color:#fff',
      'border:none',
      'border-radius:7px',
      'font-size:12px',
      'font-weight:700',
      'cursor:pointer',
      'font-family:inherit',
      'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    ].join(';');
    btnFull.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadFullBook(btnFull);
    };

    const status = document.createElement('div');
    status.id = 'waka-oak-full-status';
    status.style.cssText =
      'display:none;width:100%;font-size:12px;color:#aaa;margin-top:4px;line-height:1.4;';

    wrap.appendChild(btnMeta);
    wrap.appendChild(btnFull);
    wrap.appendChild(status);
    target.insertAdjacentElement('afterend', wrap);
    console.log('[Waka Oak] header buttons injected');
    return true;
  }

  // ── Full book: fetch OPF list ───────────────────────────────────────
  function resolveOpfPromise(chapter) {
    return new Promise((resolve) => {
      let done = false;
      const onRes = (e) => {
        if (done) return;
        if (String(e.detail?.item_id) !== String(chapter.id)) return;
        done = true;
        window.removeEventListener('__waka_oak_opf_resolved__', onRes);
        resolve(e.detail);
      };
      window.addEventListener('__waka_oak_opf_resolved__', onRes);
      window.dispatchEvent(
        new CustomEvent('__waka_oak_resolve_opf__', {
          detail: {
            item_id: chapter.id,
            name: chapter.name,
            content_type: chapter.content_type || 'retail_book_chapter',
            file_version: chapter.file_version || 1,
          },
        })
      );
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener('__waka_oak_opf_resolved__', onRes);
        resolve({ item_id: chapter.id, error: 'timeout' });
      }, 25000);
    });
  }

  function fetchAllChaptersPromise() {
    return new Promise((resolve) => {
      let done = false;
      const onAll = (e) => {
        if (done) return;
        done = true;
        window.removeEventListener('__waka_oak_all_chapters__', onAll);
        resolve(e.detail || {});
      };
      window.addEventListener('__waka_oak_all_chapters__', onAll);
      window.dispatchEvent(
        new CustomEvent('__waka_oak_fetch_all_chapters__', {
          detail: { book_id: _bookId },
        })
      );
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener('__waka_oak_all_chapters__', onAll);
        resolve({ chapters: _chapters.slice(), error: 'timeout' });
      }, 60000);
    });
  }

  async function downloadOpfAssets(opfUrl) {
    const [opfPath, qs = ''] = String(opfUrl).split('?');
    const token = qs ? '?' + qs : '';
    const oebpsDir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);

    const opfResp = await fetchWithFallback(opfUrl);
    if (!opfResp.ok) throw new Error('OPF HTTP ' + opfResp.status);
    const opfText = await opfResp.text();
    if (!opfText.includes('<manifest')) throw new Error('OPF invalid');

    const parser = new DOMParser();
    const doc = parser.parseFromString(opfText, 'application/xml');
    const items = Array.from(doc.querySelectorAll('manifest item'))
      .map((el) => ({
        href: el.getAttribute('href') || '',
        type: el.getAttribute('media-type') || '',
        id: el.getAttribute('id') || '',
      }))
      .filter((i) => i.href);

    const files = new Map(); // href -> { type, content }
    const batchSize = 4;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (item) => {
          const fileUrl = resolveUrl(item.href, oebpsDir) + token;
          try {
            const resp = await fetchWithFallback(fileUrl);
            if (!resp.ok) return;
            const buf = await resp.arrayBuffer();
            const isText = /\.(xhtml|html?|xml|ncx|css|js|json|opf)$/i.test(item.href);
            let content = buf;
            if (isText && window.WakaEpubDecode) {
              content = WakaEpubDecode.decodeFileSync(buf);
            }
            files.set(item.href, { type: item.type, content, id: item.id });
          } catch (err) {
            console.warn('[Waka Oak full] asset fail', item.href, err.message);
          }
        })
      );
    }
    return { opfText, files, oebpsDir, token };
  }

  function extractXhtmlBody(xhtmlText) {
    const s = String(xhtmlText || '');
    const m = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (m) return m[1].trim();
    return s;
  }

  function collectChapterHtml(files) {
    // Ưu tiên file xhtml không phải toc
    const entries = Array.from(files.entries()).filter(
      ([href]) => /\.xhtml?$/i.test(href) && !/toc/i.test(href)
    );
    // sort by name
    entries.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    if (!entries.length) return '';
    // gộp tất cả page*.xhtml của chương
    return entries
      .map(([, v]) => extractXhtmlBody(typeof v.content === 'string' ? v.content : ''))
      .filter(Boolean)
      .join('\n');
  }

  function collectAssetsFromFirst(files) {
    const assets = new Map();
    for (const [href, v] of files.entries()) {
      if (/\.(css|ttf|otf|woff2?|jpg|jpeg|png|gif|svg|webp)$/i.test(href)) {
        assets.set(href.replace(/^.*\//, ''), v.content); // basename
        assets.set(href, v.content);
      }
    }
    return assets;
  }

  function xmlEscape(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildTocXhtml(bookTitle, chapters) {
    // chapters: [{title, file}]
    const items = chapters
      .map(
        (ch, i) =>
          `      <li><a href="${xmlEscape(ch.file)}">${xmlEscape(ch.title)}</a></li>`
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="vi">
<head>
  <meta charset="UTF-8"/>
  <title>Mục lục — ${xmlEscape(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Mục lục</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
  }

  function buildTocNcx(bookTitle, chapters) {
    const nav = chapters
      .map(
        (ch, i) => `  <navPoint id="np${i}" playOrder="${i + 1}">
    <navLabel><text>${xmlEscape(ch.title)}</text></navLabel>
    <content src="${xmlEscape(ch.file)}"/>
  </navPoint>`
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="waka-oak-${Date.now()}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${xmlEscape(bookTitle)}</text></docTitle>
  <navMap>
${nav}
  </navMap>
</ncx>`;
  }

  function buildContentOpf(bookTitle, chapters, assetHrefs) {
    // chapters: [{title, file, id}]
    const manifestCh = chapters
      .map(
        (ch, i) =>
          `    <item id="chap${i}" href="${xmlEscape(ch.file)}" media-type="application/xhtml+xml"/>`
      )
      .join('\n');
    const spine = chapters.map((_, i) => `    <itemref idref="chap${i}"/>`).join('\n');

    const assetItems = [];
    const seen = new Set();
    for (const href of assetHrefs) {
      const base = href.replace(/^.*\//, '');
      if (seen.has(base)) continue;
      seen.add(base);
      let mt = 'application/octet-stream';
      if (/\.css$/i.test(base)) mt = 'text/css';
      else if (/\.ttf$/i.test(base)) mt = 'font/ttf';
      else if (/\.otf$/i.test(base)) mt = 'font/otf';
      else if (/\.woff2$/i.test(base)) mt = 'font/woff2';
      else if (/\.woff$/i.test(base)) mt = 'font/woff';
      else if (/\.png$/i.test(base)) mt = 'image/png';
      else if (/\.jpe?g$/i.test(base)) mt = 'image/jpeg';
      else if (/\.gif$/i.test(base)) mt = 'image/gif';
      else if (/\.svg$/i.test(base)) mt = 'image/svg+xml';
      assetItems.push(
        `    <item id="asset_${seen.size}" href="${xmlEscape(base)}" media-type="${mt}"/>`
      );
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">waka-oak-${Date.now()}</dc:identifier>
    <dc:title>${xmlEscape(bookTitle)}</dc:title>
    <dc:language>vi</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestCh}
${assetItems.join('\n')}
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
${spine}
  </spine>
</package>`;
  }

  function rewriteChapterXhtml(title, bodyHtml, hasCss) {
    const cssLink = hasCss
      ? '  <link rel="stylesheet" type="text/css" href="style.css"/>\n'
      : '';
    // fix relative asset paths to basename
    let body = String(bodyHtml || '');
    body = body.replace(/(src|href)=["']([^"']+\/)([^"'/]+)["']/gi, '$1="$3"');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="vi">
<head>
  <meta charset="UTF-8"/>
  <title>${xmlEscape(title)}</title>
${cssLink}</head>
<body>
${body}
</body>
</html>`;
  }

  async function buildFullEpubBlob(bookTitle, chapterPayloads, sharedAssets) {
    // chapterPayloads: [{title, html}]
    // sharedAssets: Map basename -> content
    if (!window.JSZip && !window.EPUBBuilder) {
      // JSZip should be global from jszip.min.js
    }
    const JSZipLib = window.JSZip;
    if (!JSZipLib) throw new Error('JSZip chưa được nạp');

    const zip = new JSZipLib();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );

    const oebps = zip.folder('OEBPS');
    const chaptersMeta = chapterPayloads.map((ch, i) => ({
      title: ch.title,
      file: `chuong${String(i + 1).padStart(4, '0')}.xhtml`,
      html: ch.html,
    }));

    // style from first chapter assets or default
    let cssContent = null;
    for (const [name, content] of sharedAssets.entries()) {
      if (/\.css$/i.test(name) && !name.includes('/')) {
        cssContent = typeof content === 'string' ? content : new TextDecoder().decode(content);
        break;
      }
    }
    if (!cssContent) {
      cssContent =
        'body{font-family:serif;line-height:1.7;margin:1em}p{text-indent:1.5em;margin:.5em 0}img{max-width:100%}';
    }
    oebps.file('style.css', cssContent);

    // other assets (fonts, images)
    const assetHrefs = ['style.css'];
    for (const [name, content] of sharedAssets.entries()) {
      if (name.includes('/')) continue;
      if (/\.css$/i.test(name)) continue;
      oebps.file(name, content);
      assetHrefs.push(name);
    }

    for (const ch of chaptersMeta) {
      oebps.file(ch.file, rewriteChapterXhtml(ch.title, ch.html, true));
    }

    oebps.file('toc.xhtml', buildTocXhtml(bookTitle, chaptersMeta));
    oebps.file('toc.ncx', buildTocNcx(bookTitle, chaptersMeta));
    oebps.file('content.opf', buildContentOpf(bookTitle, chaptersMeta, assetHrefs));

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  async function downloadFullBook(btn) {
    if (_fullBusy) {
      showToast('Đang tải full, vui lòng đợi...');
      return;
    }
    _fullBusy = true;
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.style.cursor = 'default';

    try {
      // 1) Lấy toàn bộ chương
      btn.innerHTML = '⏳ DS chương...';
      updateFullStatus('Bước 1/4: Lấy danh sách toàn bộ chương...');
      const allRes = await fetchAllChaptersPromise();
      let chapters = (allRes.chapters || []).slice();
      if (!chapters.length) chapters = _chapters.slice();
      if (!chapters.length) throw new Error('Không có danh sách chương');

      chapters.sort((a, b) => (a.chapter_order || 0) - (b.chapter_order || 0));
      // unique
      const map = new Map();
      chapters.forEach((c) => map.set(String(c.id), c));
      chapters = Array.from(map.values()).sort(
        (a, b) => (a.chapter_order || 0) - (b.chapter_order || 0)
      );
      _chapters = chapters;
      _bookId = allRes.book_id || chapters[0]?.book_id || _bookId;

      showToast('Có ' + chapters.length + ' chương — đang lấy link OPF...');
      updateFullStatus('Bước 2/4: Lấy link OPF từng chương (0/' + chapters.length + ')...');

      // 2) Resolve OPF for each chapter
      const opfList = []; // {chapter, url}
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        btn.innerHTML = '⏳ OPF ' + (i + 1) + '/' + chapters.length;
        updateFullStatus(
          'Bước 2/4: OPF chương ' + (i + 1) + '/' + chapters.length + ' — ' + (ch.name || ch.id)
        );
        const r = await resolveOpfPromise(ch);
        if (r?.url) {
          opfList.push({ chapter: ch, url: r.url, via: r.via });
        } else {
          console.warn('[Waka Oak full] skip chapter', ch.id, r?.error);
          updateFullStatus(
            '⚠ Bỏ qua chương ' + (ch.name || ch.id) + ': ' + (r?.error || 'no url'),
            true
          );
        }
        // small delay to avoid hammering
        await new Promise((r) => setTimeout(r, 120));
      }

      if (!opfList.length) throw new Error('Không lấy được OPF chương nào');

      showToast('Đã có ' + opfList.length + ' link OPF — đang tải nội dung...');
      updateFullStatus('Bước 3/4: Tải xhtml + assets...');

      // 3) Download content
      let sharedAssets = new Map();
      const chapterPayloads = [];

      for (let i = 0; i < opfList.length; i++) {
        const { chapter, url } = opfList[i];
        btn.innerHTML = '⏳ XHTML ' + (i + 1) + '/' + opfList.length;
        updateFullStatus(
          'Bước 3/4: Tải nội dung ' + (i + 1) + '/' + opfList.length + ' — ' + (chapter.name || '')
        );
        try {
          const pack = await downloadOpfAssets(url);
          const html = collectChapterHtml(pack.files);
          if (i === 0) {
            sharedAssets = collectAssetsFromFirst(pack.files);
          }
          chapterPayloads.push({
            title: chapter.name || 'Chương ' + (i + 1),
            html: html || '<p>(trống)</p>',
          });
        } catch (err) {
          console.warn('[Waka Oak full] chapter content fail', chapter.id, err);
          chapterPayloads.push({
            title: chapter.name || 'Chương ' + (i + 1),
            html: '<p>[Lỗi tải chương: ' + xmlEscape(err.message) + ']</p>',
          });
        }
      }

      // 4) Build EPUB + nhúng metadata/cover
      btn.innerHTML = '⏳ Đóng gói...';
      updateFullStatus('Bước 4/4: Dựng toc.xhtml + đóng gói EPUB (' + chapterPayloads.length + ' chương)...');
      const bookTitle = getBookTitle();
      let blob = await buildFullEpubBlob(bookTitle, chapterPayloads, sharedAssets);

      try {
        updateFullStatus('Đang nhúng metadata + ảnh bìa...');
        const pageMeta = typeof extractPageMeta === 'function' ? extractPageMeta() : null;
        if (pageMeta && pageMeta.title) {
          blob = await injectMetadataIntoBlob(blob, {
            ...pageMeta,
            title: bookTitle,
          });
        }
      } catch (e) {
        console.warn('[Waka Oak] inject full meta', e);
      }

      const fname = safeName(bookTitle) + '_full.epub';
      downloadBlob(blob, fname);

      const sizeMb = (blob.size / 1024 / 1024).toFixed(2);
      showToast('✅ Đã tải: ' + fname + ' (' + sizeMb + ' MB, ' + chapterPayloads.length + ' chương)');
      updateFullStatus('✅ Xong: ' + fname + ' — ' + chapterPayloads.length + ' chương, ' + sizeMb + 'MB');

      try {
        chrome.runtime.sendMessage({
          action: 'addDownloadHistory',
          entry: { title: bookTitle + ' (full)', filename: fname, type: 'epub' },
        });
      } catch {}
    } catch (err) {
      console.error('[Waka Oak full]', err);
      showToast('Lỗi tải full: ' + (err.message || err), true);
      updateFullStatus('Lỗi: ' + (err.message || err), true);
    } finally {
      _fullBusy = false;
      btn.disabled = false;
      btn.style.cursor = 'pointer';
      btn.innerHTML = origHtml;
    }
  }

  function observeHeader() {
    injectHeaderButtons();
    const obs = new MutationObserver(() => injectHeaderButtons());
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    setInterval(injectHeaderButtons, 2000);
  }

  function start() {
    observeList();
    observeHeader();
    window.dispatchEvent(new CustomEvent('__waka_oak_request_chapters__'));
    setTimeout(() => window.dispatchEvent(new CustomEvent('__waka_oak_request_chapters__')), 1000);
    setTimeout(() => window.dispatchEvent(new CustomEvent('__waka_oak_request_chapters__')), 3000);
  }

  if (document.body) start();
  else {
    new MutationObserver((_, obs) => {
      if (document.body) {
        start();
        obs.disconnect();
      }
    }).observe(document.documentElement, { childList: true });
  }
})();
