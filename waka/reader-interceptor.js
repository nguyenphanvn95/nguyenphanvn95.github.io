/**
 * reader-interceptor.js  –  MAIN world  –  /reader/*  v3.3
 *
 * 1. Đọc window.__NUXT__ → emit '__waka_epub_found__'
 * 2. Fetch tất cả EPUB files từ waka.vn origin (no CORS issue)
 * 3. QUAN TRỌNG: Capture nội dung jquery decryption scripts để decrypt chapters
 */
(function () {
  'use strict';

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function resolveUrl(href, base) {
    if (/^https?:\/\//.test(href)) return href;
    try { return new URL(href, base).href; }
    catch { return base.replace(/\/$/, '') + '/' + href; }
  }

  // ── 1. Đọc __NUXT__ ───────────────────────────────────────────────────────
  function tryReadNuxt() {
    try {
      const nuxt = window.__NUXT__;
      if (!nuxt) return false;
      const raw = JSON.stringify(nuxt);
      const m   = raw.match(/"epub_url"\s*:\s*"(https?:[^"]+)"/);
      if (!m) return false;
      const url   = m[1].replace(/\\u002F/g, '/');
      const tm    = raw.match(/"title"\s*:\s*"([^"]+)"/);
      const title = tm ? tm[1] : (document.title || 'Ebook');
      emit('__waka_epub_found__', { url, title });
      return true;
    } catch { return false; }
  }

  if (!tryReadNuxt()) {
    [300, 800, 1500, 3000].forEach(ms => setTimeout(tryReadNuxt, ms));
  }

  // ── 2. Fetch tất cả files khi được yêu cầu ───────────────────────────────
  window.addEventListener('__waka_do_download__', async (e) => {
    try { await fetchAllEpubFiles(e.detail.opfUrl); }
    catch (err) { emit('__waka_epub_error__', { msg: err.message }); }
  });

  async function fetchAllEpubFiles(opfUrl) {
    const [opfPath, qs] = opfUrl.split('?');
    const token          = qs ? '?' + qs : '';
    const oebpsDir       = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);

    emit('__waka_epub_progress__', { msg: 'Tải content.opf...' });

    // Fetch OPF
    let opfResp = await fetch(opfUrl, { credentials: 'omit' });
    if (!opfResp.ok) opfResp = await fetch(opfUrl, { credentials: 'include' });
    if (!opfResp.ok) throw new Error('content.opf HTTP ' + opfResp.status);

    const opfText = await opfResp.text();
    if (!opfText.includes('<manifest')) throw new Error('OPF không hợp lệ');

    emit('__waka_epub_opf__', { text: opfText, oebpsDir });

    // Parse manifest
    const parser = new DOMParser();
    const doc    = parser.parseFromString(opfText, 'application/xml');
    const items  = [];
    doc.querySelectorAll('manifest item').forEach(el => {
      const href = el.getAttribute('href');
      if (href) items.push({ href, type: el.getAttribute('media-type') || '' });
    });

    emit('__waka_epub_progress__', {
      msg: 'Phát hiện ' + items.length + ' files...', total: items.length, done: 0
    });

    // Phân loại: JS files (decrypt scripts) vs content files
    const jsItems      = items.filter(i => i.href.includes('/js/jquery0') || /jquery\d+\.js/.test(i.href));
    const contentItems = items.filter(i => !jsItems.includes(i));

    // 3a. Fetch và capture decrypt scripts TRƯỚC
    const decryptScripts = {};
    for (const item of jsItems) {
      try {
        const url  = resolveUrl(item.href, oebpsDir) + token;
        let resp = await fetch(url, { credentials: 'omit' });
        if (!resp.ok) resp = await fetch(url, { credentials: 'include' });
        if (resp.ok) {
          const buf  = await resp.arrayBuffer();
          const text = new TextDecoder().decode(buf);
          decryptScripts[item.href] = text;
          emit('__waka_decrypt_script__', { href: item.href, script: text });
          console.log('[Waka DL] Decrypt script captured:', item.href, text.length + 'B');
        }
      } catch (e) {
        console.warn('[Waka DL] JS file failed:', item.href, e.message);
      }
    }

    // 3b. Fetch content files (batch 5)
    let done = 0, failed = 0;
    const BATCH = 5;

    for (let i = 0; i < contentItems.length; i += BATCH) {
      await Promise.all(contentItems.slice(i, i + BATCH).map(async (item) => {
        const url = resolveUrl(item.href, oebpsDir) + token;
        try {
          let resp = await fetch(url, { credentials: 'omit' });
          if (!resp.ok) resp = await fetch(url, { credentials: 'include' });
          if (!resp.ok) {
            // toc.ncx và một số file metadata có thể không có → bỏ qua
            if (item.href.includes('toc.ncx') || resp.status === 404) {
              console.info('[Waka DL] Skipping (not critical):', item.href);
              return; // không tính là lỗi
            }
            throw new Error('HTTP ' + resp.status);
          }

          const buf = await resp.arrayBuffer();

          // Nếu là XHTML chapter có content mã hoá → thử decrypt
          let finalBuf = buf;
          if (item.href.includes('.xhtml') || item.href.includes('.html')) {
            const text = new TextDecoder().decode(buf);
            if (isEncrypted(text)) {
              const decrypted = tryDecrypt(text, decryptScripts, token);
              if (decrypted) {
                finalBuf = new TextEncoder().encode(decrypted).buffer;
              }
            }
          }

          emit('__waka_epub_file__', { href: item.href, buffer: finalBuf });
          done++;
        } catch (err) {
          failed++;
          console.warn('[Waka DL] File failed:', item.href, err.message);
        }

        emit('__waka_epub_progress__', {
          msg: 'Tải ' + (done + failed) + '/' + contentItems.length +
               ' — OK:' + done + ' Lỗi:' + failed,
          done, failed, total: contentItems.length
        });
      }));
    }

    emit('__waka_epub_done__', { done, failed, total: contentItems.length });
  }

  // ── 3. Phát hiện và decrypt encrypted XHTML ───────────────────────────────

  /** Kiểm tra XHTML có phải là encrypted content không */
  function isEncrypted(xhtmlText) {
    // Encrypted chapters: body chứa base64-like text dài (không phải HTML tags)
    const bodyMatch = xhtmlText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) return false;
    const bodyContent = bodyMatch[1].trim();
    // Nếu body không chứa HTML tags và chỉ chứa base64 chars
    const isBase64Like = /^[A-Za-z0-9+\/\s=]+$/.test(bodyContent) && bodyContent.length > 100;
    return isBase64Like;
  }

  /** Thử decrypt nội dung dựa trên scripts đã capture */
  function tryDecrypt(xhtmlText, scripts, token) {
    const bodyMatch = xhtmlText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) return null;
    const encrypted = bodyMatch[1].trim().replace(/\s/g, '');

    // Emit encrypted content để analyze (user có thể xem trong console)
    emit('__waka_encrypted_chapter__', {
      preview: encrypted.slice(0, 200),
      scriptsAvailable: Object.keys(scripts)
    });

    // TODO: implement actual decryption when algorithm is known
    // Hiện tại, ghi log để phân tích
    if (Object.keys(scripts).length > 0) {
      console.log('[Waka DL] Encrypted chapter detected. Scripts available:', Object.keys(scripts).join(', '));
      console.log('[Waka DL] Encrypted preview:', encrypted.slice(0, 100));

      // Thử tìm decryption pattern trong scripts
      const allScript = Object.values(scripts).join('\n');

      // Tìm key trong scripts
      const keyMatch = allScript.match(/['"](([0-9a-f]{32,64}))['"]/i);
      if (keyMatch) {
        console.log('[Waka DL] Potential key found in script:', keyMatch[1]);
        emit('__waka_decrypt_key_found__', { key: keyMatch[1], encrypted: encrypted.slice(0, 200) });
      }
    }

    return null; // Return null = giữ nguyên encrypted content (chờ analysis)
  }

  console.log('[Waka DL] Reader interceptor v3.3 (with decrypt capture).');
})();
