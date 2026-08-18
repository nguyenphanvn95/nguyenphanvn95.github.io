/**
 * metadata-injector.js — v4.1
 * Nhúng metadata + ảnh bìa chuẩn EPUB 3 vào EPUB blob.
 *
 * Chuẩn ảnh bìa:
 *  - Tìm ảnh bìa hiện có trong EPUB (images/cover.*, OEBPS/Images/cover.*, v.v.)
 *    → nếu có thì GHI ĐÈ file đó, cập nhật manifest item thêm properties="cover-image"
 *  - Nếu không có → tạo mới tại images/cover.jpg (tương đối với thư mục OPF)
 *  - manifest item: id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"
 *  - metadata:      <meta name="cover" content="cover-image"/>   (EPUB 2 compat)
 *
 * API:
 *   window.WakaMetaInjector.injectIntoBlob(blob) → Promise<Blob>
 *   window.WakaMetaInjector.hasMeta()            → Promise<boolean>
 *   window.WakaMetaInjector.getMeta()            → Promise<object|null>
 *   window.WakaMetaInjector.clearMeta()          → Promise<void>
 */
const WakaMetaInjector = (() => {
  'use strict';

  // ── Storage (localStorage – userscript) ────────────────────────────────
  const META_KEY = 'waka_userscript_metadata';

  async function getMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }
  async function hasMeta() {
    const m = await getMeta();
    return !!(m && m.title);
  }
  async function clearMeta() {
    try { localStorage.removeItem(META_KEY); } catch {}
  }
  async function saveMeta(meta) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn('[WakaMetaInjector] save failed', e);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function xmlEsc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function guessMimeFromUrl(url) {
    if (/\.png(\?|$)/i.test(url)) return 'image/png';
    if (/\.gif(\?|$)/i.test(url)) return 'image/gif';
    if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
    return 'image/jpeg';
  }

  function extFromMime(mime) {
    if (mime === 'image/png')  return 'png';
    if (mime === 'image/gif')  return 'gif';
    if (mime === 'image/webp') return 'webp';
    return 'jpg';
  }

  async function fetchCoverBuffer(url) {
    if (!url) return null;
    try {
      const resp = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (!resp.ok) return null;
      return await resp.arrayBuffer();
    } catch { return null; }
  }

  // ── Tìm ảnh bìa hiện có trong EPUB ──────────────────────────────────────
  // Trả về { zipPath, href, mimeType, itemId } hoặc null
  function findExistingCover(zip, opfText, opfDir) {
    // 1. Tìm qua manifest item có properties="cover-image"
    const propMatch = opfText.match(
      /<item\s+[^>]*properties=["'][^"']*cover-image[^"']*["'][^>]*>/i
    );
    if (propMatch) {
      const hrefM = propMatch[0].match(/href=["']([^"']+)["']/i);
      const idM   = propMatch[0].match(/\bid=["']([^"']+)["']/i);
      const mimeM = propMatch[0].match(/media-type=["']([^"']+)["']/i);
      if (hrefM) {
        const zipPath = opfDir + hrefM[1];
        return {
          zipPath,
          href: hrefM[1],
          mimeType: mimeM ? mimeM[1] : 'image/jpeg',
          itemId: idM ? idM[1] : 'cover-image',
        };
      }
    }

    // 2. Tìm qua <meta name="cover" content="...">
    const metaCoverM = opfText.match(/<meta\s+name=["']cover["']\s+content=["']([^"']+)["']/i)
                    || opfText.match(/<meta\s+content=["']([^"']+)["']\s+name=["']cover["']/i);
    if (metaCoverM) {
      const itemId = metaCoverM[1];
      const itemRe = new RegExp(`<item\\s[^>]*\\bid=["']${itemId}["'][^>]*>`, 'i');
      const itemM  = opfText.match(itemRe);
      if (itemM) {
        const hrefM = itemM[0].match(/href=["']([^"']+)["']/i);
        const mimeM = itemM[0].match(/media-type=["']([^"']+)["']/i);
        if (hrefM) {
          return {
            zipPath: opfDir + hrefM[1],
            href: hrefM[1],
            mimeType: mimeM ? mimeM[1] : 'image/jpeg',
            itemId,
          };
        }
      }
    }

    // 3. Tìm file ảnh bìa theo path phổ biến trong zip
    const candidates = [
      'images/cover.jpg', 'images/cover.jpeg', 'images/cover.png',
      'Images/cover.jpg', 'Images/cover.jpeg', 'Images/cover.png',
      'image/cover.jpg',  'image/cover.jpeg',  'image/cover.png',
      'cover.jpg', 'cover.jpeg', 'cover.png',
    ];
    for (const rel of candidates) {
      const full = opfDir + rel;
      if (zip.file(full)) {
        const mime = /\.png$/i.test(rel) ? 'image/png' : 'image/jpeg';
        // Tìm item tương ứng trong manifest
        const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const itemRe = new RegExp(`<item\\s[^>]*href=["'](?:[^"']*/)?(${escaped})["'][^>]*>`, 'i');
        const itemM = opfText.match(itemRe);
        const idM   = itemM ? itemM[0].match(/\bid=["']([^"']+)["']/i) : null;
        return {
          zipPath: full,
          href: rel,
          mimeType: mime,
          itemId: idM ? idM[1] : 'cover-image',
        };
      }
    }

    return null;
  }

  // ── Patch OPF ─────────────────────────────────────────────────────────────
  function patchOpf(opfText, meta, coverInfo) {
    // 1. Build <metadata> block
    const dcMeta = [];
    dcMeta.push(`    <dc:identifier id="uid">waka-${Date.now()}</dc:identifier>`);
    if (meta.title)      dcMeta.push(`    <dc:title>${xmlEsc(meta.title)}</dc:title>`);
    dcMeta.push(`    <dc:language>${xmlEsc(meta.language || 'vi')}</dc:language>`);
    (meta.authors || []).forEach(a => dcMeta.push(`    <dc:creator>${xmlEsc(a)}</dc:creator>`));
    if (meta.publisher)  dcMeta.push(`    <dc:publisher>${xmlEsc(meta.publisher)}</dc:publisher>`);
    if (meta.pubdate)    dcMeta.push(`    <dc:date>${xmlEsc(meta.pubdate)}</dc:date>`);
    if (meta.comments)   dcMeta.push(`    <dc:description>${xmlEsc(meta.comments)}</dc:description>`);
    (meta.tags || []).forEach(t => dcMeta.push(`    <dc:subject>${xmlEsc(t)}</dc:subject>`));
    if (meta.source_url) dcMeta.push(`    <dc:source>${xmlEsc(meta.source_url)}</dc:source>`);
    dcMeta.push(`    <meta property="dcterms:modified">${new Date().toISOString().slice(0,19)}Z</meta>`);
    // EPUB 2 compat: <meta name="cover">
    if (coverInfo) {
      dcMeta.push(`    <meta name="cover" content="${xmlEsc(coverInfo.itemId)}"/>`);
    }

    const metadataBlock = `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${dcMeta.join('\n')}\n  </metadata>`;
    let patched = opfText.replace(/<metadata[\s\S]*?<\/metadata>/i, metadataBlock);

    if (!coverInfo) return patched;

    // 2. Cập nhật/thêm manifest item cho ảnh bìa
    // Xóa tất cả item cũ liên quan đến cover (wdl-cover-image, cover-image cũ...)
    patched = patched.replace(/<item\s[^>]*id=["']wdl-cover-image["'][^>]*\/?\s*>/gi, '');

    // Tìm item có cùng id hoặc cùng href
    const idEsc  = coverInfo.itemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hrefEsc = coverInfo.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingItemRe = new RegExp(
      `<item\\s[^>]*(?:id=["']${idEsc}["']|href=["'][^"']*${hrefEsc}["'])[^>]*\\/?>`,
      'gi'
    );

    const newItem = `<item id="${xmlEsc(coverInfo.itemId)}" href="${xmlEsc(coverInfo.href)}" media-type="${xmlEsc(coverInfo.mimeType)}" properties="cover-image"/>`;

    if (existingItemRe.test(patched)) {
      // Thay thế item cũ bằng item mới đã có properties="cover-image"
      patched = patched.replace(existingItemRe, newItem);
    } else {
      // Thêm mới vào đầu manifest
      patched = patched.replace(/<manifest>/i, `<manifest>\n    ${newItem}`);
    }

    return patched;
  }

  // ── Main: inject metadata vào EPUB blob ──────────────────────────────────
  async function injectIntoBlob(epubBlob) {
    const meta = await getMeta();
    if (!meta || !meta.title) {
      console.log('[WakaMetaInjector] Không có metadata, bỏ qua.');
      return epubBlob;
    }

    console.log('[WakaMetaInjector] Nhúng metadata:', meta.title);
    const zip = await JSZip.loadAsync(epubBlob);

    // Tìm OPF
    let opfPath = null;
    try {
      const containerXml = await zip.file('META-INF/container.xml').async('text');
      const m = containerXml.match(/full-path="([^"]+)"/);
      if (m) opfPath = m[1];
    } catch {}
    if (!opfPath) zip.forEach(p => { if (!opfPath && p.endsWith('.opf')) opfPath = p; });
    if (!opfPath) { console.warn('[WakaMetaInjector] Không tìm thấy OPF'); return epubBlob; }

    const opfFile = zip.file(opfPath);
    if (!opfFile) { console.warn('[WakaMetaInjector] Không đọc được OPF'); return epubBlob; }

    const opfText = await opfFile.async('text');
    // opfDir: thư mục chứa OPF, ví dụ "OEBPS/"
    const opfDir = opfPath.includes('/')
      ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1)
      : '';

    // Tải ảnh bìa từ URL
    const coverBuf = meta.cover ? await fetchCoverBuffer(meta.cover) : null;

    let coverInfo = null;

    if (coverBuf) {
      const mime = guessMimeFromUrl(meta.cover);
      const ext  = extFromMime(mime);

      // Tìm vị trí ảnh bìa hiện có trong EPUB
      const existing = findExistingCover(zip, opfText, opfDir);

      if (existing) {
        // Ghi đè ảnh bìa cũ
        zip.file(existing.zipPath, coverBuf);
        coverInfo = {
          itemId:   existing.itemId,
          href:     existing.href,
          mimeType: mime,   // cập nhật mime theo ảnh mới
        };
        console.log('[WakaMetaInjector] Ghi đè ảnh bìa tại:', existing.zipPath);
      } else {
        // Tạo ảnh bìa mới tại images/cover.jpg (chuẩn Calibre)
        const newHref    = `images/cover.${ext}`;
        const newZipPath = opfDir + newHref;
        zip.file(newZipPath, coverBuf);
        coverInfo = {
          itemId:   'cover-image',
          href:     newHref,
          mimeType: mime,
        };
        console.log('[WakaMetaInjector] Tạo ảnh bìa mới tại:', newZipPath);
      }
    }

    // Xóa file wdl-cover.jpg cũ nếu còn tồn tại (từ các version trước)
    zip.remove(opfDir + 'wdl-cover.jpg');
    zip.remove('wdl-cover.jpg');

    // Patch OPF
    const patchedOpf = patchOpf(opfText, meta, coverInfo);
    zip.file(opfPath, patchedOpf);

    const newBlob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    console.log('[WakaMetaInjector] Xong. EPUB size:', (newBlob.size / 1024).toFixed(1), 'KB');
    return newBlob;
  }

  return { injectIntoBlob, hasMeta, getMeta, clearMeta };
})();

window.WakaMetaInjector = WakaMetaInjector;
