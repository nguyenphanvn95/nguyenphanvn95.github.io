/**
 * epub-builder.js
 * Tạo file EPUB 3 hợp lệ từ mảng { title, html } bằng JSZip.
 * Expose global: EPUBBuilder
 *
 * Phụ thuộc: lib/jszip.min.js
 */
const EPUBBuilder = (() => {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────────────────────

  function sanitizeHtml(rawHtml) {
    // Xoá script/style để EPUB sạch, giữ lại text và inline tags
    return rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\son\w+="[^"]*"/g, '')   // event attrs
      .replace(/\son\w+='[^']*'/g, '')
      .trim();
  }

  function xmlEscape(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Template generators ───────────────────────────────────────────────────

  function mimetype() {
    return 'application/epub+zip';
  }

  function containerXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  }

  function contentOpf(bookTitle, bookId, chapters) {
    const manifest = chapters
      .map((_, i) =>
        `    <item id="chap${i}" href="chapter_${String(i).padStart(3,'0')}.xhtml" media-type="application/xhtml+xml"/>`
      ).join('\n');

    const spine = chapters
      .map((_, i) => `    <itemref idref="chap${i}"/>`)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${xmlEscape(bookId)}</dc:identifier>
    <dc:title>${xmlEscape(bookTitle)}</dc:title>
    <dc:language>vi</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().slice(0,19)}Z</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>`;
  }

  function tocNcx(bookTitle, chapters) {
    const navPoints = chapters.map((ch, i) =>
      `  <navPoint id="np${i}" playOrder="${i + 1}">
    <navLabel><text>${xmlEscape(ch.title)}</text></navLabel>
    <content src="chapter_${String(i).padStart(3,'0')}.xhtml"/>
  </navPoint>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="waka-book"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(bookTitle)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
  </ncx>`;
  }

  function extractNavEntriesFromTocXhtml(tocXhtml) {
    const entries = [];
    const re = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = re.exec(tocXhtml))) {
      const href = match[1].trim();
      const title = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (href && title) entries.push({ href, title });
    }
    return entries;
  }

  function resolveHref(baseDir, href) {
    const clean = String(href || '').trim();
    if (!clean) return clean;
    if (/^[a-z]+:/i.test(clean) || clean.startsWith('#') || clean.startsWith('../') || clean.startsWith('./')) {
      return clean;
    }
    return (baseDir || '') + clean.replace(/^\/+/, '');
  }

  function generateNcxFromTocXhtml(bookTitle, tocXhtml, baseDir = '', fallbackFiles = []) {
    const entries = extractNavEntriesFromTocXhtml(tocXhtml).map((item) => ({
      href: resolveHref(baseDir, item.href),
      title: item.title,
    }));
    const list = entries.length > 0 ? entries : fallbackFiles;

    const navPoints = list.map((item, i) => {
      const href = item.href || item;
      const title = item.title || String(href).split('/').pop();
      return `  <navPoint id="np${i}" playOrder="${i + 1}">
    <navLabel><text>${xmlEscape(title)}</text></navLabel>
    <content src="${xmlEscape(href)}"/>
  </navPoint>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="waka-book"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(bookTitle)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
  }

  function chapterXhtml(title, htmlBody) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="vi">
<head>
  <meta charset="UTF-8"/>
  <title>${xmlEscape(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<h2>${xmlEscape(title)}</h2>
${sanitizeHtml(htmlBody)}
</body>
</html>`;
  }

  function defaultCss() {
    return `body {
  font-family: "Times New Roman", Georgia, serif;
  font-size: 1em;
  line-height: 1.7;
  margin: 1em 1.5em;
  color: #1a1a1a;
}
h1, h2, h3 { line-height: 1.3; margin: 1em 0 0.5em; }
p { margin: 0.5em 0; text-indent: 1.5em; }
img { max-width: 100%; }`;
  }

  // ── Main build function ───────────────────────────────────────────────────

  /**
   * @param {string} bookTitle
   * @param {Array<{title:string, html:string}>} chapters
   * @returns {Promise<Blob>} .epub Blob
   */
  async function build(bookTitle, chapters) {
    if (!chapters || chapters.length === 0) {
      throw new Error('Không có chapter nào để đóng gói.');
    }

    const zip = new JSZip();
    const bookId = `waka-${Date.now()}`;

    // EPUB structure
    zip.file('mimetype', mimetype(), { compression: 'STORE' });
    zip.file('META-INF/container.xml', containerXml());

    const oebps = zip.folder('OEBPS');
    oebps.file('content.opf', contentOpf(bookTitle, bookId, chapters));
    oebps.file('toc.ncx',     tocNcx(bookTitle, chapters));
    oebps.file('style.css',   defaultCss());

    chapters.forEach((ch, i) => {
      const filename = `chapter_${String(i).padStart(3, '0')}.xhtml`;
      oebps.file(filename, chapterXhtml(ch.title, ch.html));
    });

    return zip.generateAsync({
      type:             'blob',
      mimeType:         'application/epub+zip',
      compression:      'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  function containerXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  }

  function mimetype() {
    return 'application/epub+zip';
  }

  function normalizeFileName(name) {
    return String(name || '').replace(/^\/+/, '');
  }

  function addFile(zipFolder, name, content) {
    const safeName = normalizeFileName(name);
    if (!safeName) return;
    zipFolder.file(safeName, content);
  }

  /**
   * Build a real EPUB from an OPF file and its related assets.
   * @param {string} bookTitle
   * @param {string} opfText
   * @param {Map<string, string|ArrayBuffer|Uint8Array>|Array<[string, any]>|Object<string, any>} files
   * @returns {Promise<Blob>}
   */
  async function buildFromFiles(bookTitle, opfText, files) {
    if (!opfText || !String(opfText).trim()) {
      throw new Error('content.opf is missing');
    }

    const zip = new JSZip();

    zip.file('mimetype', mimetype(), { compression: 'STORE' });
    zip.file('META-INF/container.xml', containerXml());

    const oebps = zip.folder('OEBPS');
    addFile(oebps, 'content.opf', opfText);

    const entries = files instanceof Map
      ? Array.from(files.entries())
      : Array.isArray(files)
        ? files
        : Object.entries(files || {});

    for (const entry of entries) {
      const href = Array.isArray(entry) ? entry[0] : entry.href;
      const value = Array.isArray(entry) ? entry[1] : entry.content;
      if (!href) continue;
      if (normalizeFileName(href) === 'content.opf') continue;
      addFile(oebps, href, value);
    }

    const hasTocNcx = entries.some((entry) => {
      const href = Array.isArray(entry) ? entry[0] : entry.href;
      return normalizeFileName(href) === 'toc.ncx';
    });
    if (!hasTocNcx) {
      const tocEntry = entries.find((entry) => {
        const href = Array.isArray(entry) ? entry[0] : entry.href;
        return /(^|\/)toc\.xhtml$/i.test(normalizeFileName(href));
      });
      const tocHref = tocEntry ? (Array.isArray(tocEntry) ? tocEntry[0] : tocEntry.href) : '';
      const tocBaseDir = tocHref ? normalizeFileName(tocHref).replace(/[^/]+$/, '') : '';
      const tocXhtml = tocEntry
        ? (Array.isArray(tocEntry) ? tocEntry[1] : tocEntry.content)
        : '';
      const fallbackFiles = entries
        .map((entry) => (Array.isArray(entry) ? entry[0] : entry.href))
        .filter((href) => /\.xhtml?$/i.test(String(href)) && !/(^|\/)toc\.xhtml$/i.test(String(href)))
        .map((href) => ({ href: normalizeFileName(href), title: String(href).split('/').pop().replace(/\.xhtml?$/i, '') }));
      addFile(oebps, 'toc.ncx', generateNcxFromTocXhtml(bookTitle, String(tocXhtml || ''), tocBaseDir, fallbackFiles));
    }

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  }

  return { build, buildFromFiles };
})();

window.EPUBBuilder = EPUBBuilder;
