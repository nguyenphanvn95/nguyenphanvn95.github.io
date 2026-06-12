/**
 * metadata-injector.js — v4.0.2 (GitHub Pages / Userscript edition)
 * Phiên bản này KHÔNG dùng chrome.runtime.
 * window.WakaMetaInjector sẽ được override bởi userscript với GM_setValue/GM_getValue.
 * File này chỉ export các helper functions.
 *
 * Phụ thuộc: JSZip (load trước qua @require hoặc CDN)
 */
(function () {
  'use strict';

  function xmlEsc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function guessMimeType(url) {
    if (/\.png(\?|$)/i.test(url)) return 'image/png';
    if (/\.gif(\?|$)/i.test(url)) return 'image/gif';
    if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
    return 'image/jpeg';
  }

  /**
   * Patch content.opf với metadata mới.
   * @param {string} opfText
   * @param {object} meta
   * @param {boolean} hasCover
   * @returns {string} patched OPF
   */
  function patchOpf(opfText, meta, hasCover) {
    const dcMeta = [];
    dcMeta.push(`    <dc:identifier id="uid">waka-${Date.now()}</dc:identifier>`);
    if (meta.title)   dcMeta.push(`    <dc:title>${xmlEsc(meta.title)}</dc:title>`);
    dcMeta.push(`    <dc:language>${xmlEsc(meta.language || 'vi')}</dc:language>`);
    (meta.authors || []).forEach(a => dcMeta.push(`    <dc:creator>${xmlEsc(a)}</dc:creator>`));
    if (meta.publisher) dcMeta.push(`    <dc:publisher>${xmlEsc(meta.publisher)}</dc:publisher>`);
    if (meta.pubdate)   dcMeta.push(`    <dc:date>${xmlEsc(meta.pubdate)}</dc:date>`);
    if (meta.comments)  dcMeta.push(`    <dc:description>${xmlEsc(meta.comments)}</dc:description>`);
    (meta.tags || []).forEach(t => dcMeta.push(`    <dc:subject>${xmlEsc(t)}</dc:subject>`));
    if (meta.source_url) dcMeta.push(`    <dc:source>${xmlEsc(meta.source_url)}</dc:source>`);
    dcMeta.push(`    <meta property="dcterms:modified">${new Date().toISOString().slice(0,19)}Z</meta>`);
    if (hasCover) dcMeta.push(`    <meta name="cover" content="wdl-cover-image"/>`);

    const metadataBlock = `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n${dcMeta.join('\n')}\n  </metadata>`;
    let patched = opfText.replace(/<metadata[\s\S]*?<\/metadata>/i, metadataBlock);

    if (hasCover && !patched.includes('wdl-cover-image')) {
      patched = patched.replace(/<manifest>/i, `<manifest>\n    <item id="wdl-cover-image" href="wdl-cover.jpg" media-type="image/jpeg"/>`);
    }
    return patched;
  }

  /**
   * Inject metadata vào EPUB blob.
   * Hàm này được gọi bởi WakaMetaInjector trong userscript.
   * @param {Blob} epubBlob
   * @param {object} meta — metadata object
   * @param {ArrayBuffer|null} coverBuf — ảnh bìa (null nếu không có)
   * @returns {Promise<Blob>}
   */
  async function injectMetaIntoBlob(epubBlob, meta, coverBuf) {
    const zip = await JSZip.loadAsync(epubBlob);

    let opfPath = null;
    try {
      const containerXml = await zip.file('META-INF/container.xml').async('text');
      const m = containerXml.match(/full-path="([^"]+)"/);
      if (m) opfPath = m[1];
    } catch {}
    if (!opfPath) zip.forEach((path) => { if (!opfPath && path.endsWith('.opf')) opfPath = path; });
    if (!opfPath) { console.warn('[WakaMetaInjector] Không tìm thấy OPF'); return epubBlob; }

    const opfFile = zip.file(opfPath) || zip.file('OEBPS/' + opfPath);
    if (!opfFile) return epubBlob;

    const opfText = await opfFile.async('text');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    const patchedOpf = patchOpf(opfText, meta, !!coverBuf);
    zip.file(opfPath, patchedOpf);

    if (coverBuf) {
      zip.file(opfDir + 'wdl-cover.jpg', coverBuf);
    }

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  // Export helper — userscript sẽ wrap với GM storage và GM_xmlhttpRequest
  window.WakaMetaInjectorCore = { injectMetaIntoBlob, patchOpf, xmlEsc };

  // Nếu chưa có WakaMetaInjector (chạy độc lập, không phải trong userscript)
  // tạo stub báo lỗi rõ ràng
  if (!window.WakaMetaInjector) {
    window.WakaMetaInjector = {
      async hasMeta() { return false; },
      async getMeta() { return null; },
      async clearMeta() {},
      async injectIntoBlob(blob) {
        console.warn('[WakaMetaInjector] Storage chưa được khởi tạo (cần GM storage).');
        return blob;
      },
    };
  }
})();
