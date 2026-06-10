// ==UserScript==
// @name         Waka Metadata Extractor & Injector
// @namespace    https://nguyenphanvn95.github.io/waka-metadata
// @version      5.0.0
// @description  Trích xuất metadata sách từ waka.vn — xuất OPF/YAML/CSV/Copy to Calibre + Inject vào EPUB
// @author       nguyenphanvn95
// @match        https://waka.vn/ebook/*
// @match        https://waka.vn/reader/*
// @grant        GM_setClipboard
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      vegacdn.vn
// @connect      vws.vegacdn.vn
// @connect      waka.vn
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @updateURL    https://nguyenphanvn95.github.io/waka-metadata/waka-metadata.user.js
// @downloadURL  https://nguyenphanvn95.github.io/waka-metadata/waka-metadata.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1: EXTRACT METADATA
  // ══════════════════════════════════════════════════════════════════════

  function readNuxtData() {
    try {
      const nuxt = window.__NUXT__;
      if (!nuxt?.data?.[0]) return null;
      const d = nuxt.data[0];
      const info = d.ebookInfo || d.bookInfo || null;
      if (!info) return null;

      function decodeHtml(html) {
        if (!html) return '';
        const txt = document.createElement('div');
        txt.innerHTML = html;
        return (txt.innerText || txt.textContent || '').trim();
      }

      const result = {
        title:       info.title || '',
        authors:     [],
        publisher:   '',
        pubdate:     '',
        pubdate_raw: '',
        tags:        [],
        comments:    decodeHtml(info.description || ''),
        language:    'vi',
        cover:       '',
        source_url:  window.location.href,
      };

      if (info.authors_json) {
        try {
          const arr = JSON.parse(info.authors_json);
          result.authors = arr.map(a => a.name || a).filter(Boolean);
        } catch (_) {}
      }
      if (result.authors.length === 0) {
        const raw = info.author_name || info.author || '';
        if (raw) result.authors = raw.split(/\s*[&,]\s*/).map(a => a.trim()).filter(Boolean);
      }

      if (Array.isArray(info.publishing_houses) && info.publishing_houses.length) {
        result.publisher = info.publishing_houses[0].name || '';
      }
      if (!result.publisher) result.publisher = info.publisher_name || info.publisher || '';

      const tagRaw = info.category_name || info.genre || info.category || '';
      if (tagRaw) result.tags = tagRaw.split(/\s*[,;]\s*/).map(t => t.trim()).filter(Boolean);

      const dateRaw = info.published_time || info.publish_date || info.published_date || '';
      result.pubdate_raw = dateRaw;
      if (dateRaw) {
        const m = dateRaw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (m) {
          result.pubdate = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        } else {
          const m2 = dateRaw.match(/(\d{1,2})[\/\-](\d{4})/);
          if (m2) result.pubdate = `${m2[2]}-${m2[1].padStart(2, '0')}-01`;
        }
      }

      result.cover = info.image_url || info.thumbnail || info.cover_url || info.img || '';
      if (!result.cover && info.id) {
        result.cover = `https://307a0e78.vws.vegacdn.vn/view/v2/image/img.book/0/0/1/${info.id}.jpg?v=1&w=480&h=700`;
      }

      if (info.detail_url) result.source_url = info.detail_url;
      return result;
    } catch (e) {
      console.warn('[waka-meta] __NUXT__ parse error:', e);
      return null;
    }
  }

  function readReaderDom() {
    try {
      const result = {
        title: '', authors: [], publisher: '', pubdate: '', pubdate_raw: '',
        tags: [], comments: '', language: 'vi', cover: '', source_url: window.location.href,
      };
      const titleEl = document.querySelector("a.text-lg-18-24, a[class*='text-lg-18-24']");
      if (titleEl) {
        result.title = titleEl.textContent.trim();
        const href = titleEl.getAttribute('href');
        if (href) result.source_url = href.startsWith('http') ? href : 'https://waka.vn' + href;
      }
      if (!result.title) {
        result.title = document.title.replace(/^Đọc sách\s*[-–]\s*/i, '').trim();
      }
      const authorEl = titleEl?.closest('div')?.querySelector("p.text-f2f, p[class*='text-f2f']");
      if (authorEl) {
        const raw = authorEl.textContent.trim();
        result.authors = raw.split(/\s*[,&]\s*/).map(a => a.trim()).filter(Boolean);
      }
      const coverImg = document.querySelector('img[src*="img.book"]');
      if (coverImg) result.cover = coverImg.src.replace(/&amp;/g, '&');
      const descEl = document.querySelector('p.text-sm-15-20 p, p.text-sm-15-20');
      if (descEl) result.comments = descEl.innerText?.trim() || descEl.textContent?.trim() || '';
      return result;
    } catch (e) {
      console.warn('[waka-meta] readReaderDom error:', e);
      return null;
    }
  }

  function extractMetadata() {
    const meta = {};
    const isReader = window.location.pathname.startsWith('/reader/');
    const nuxt = readNuxtData() || (isReader ? readReaderDom() : null);

    // Title
    const h1El = document.querySelector('h1.text-white-50');
    if (h1El) {
      meta.title = h1El.textContent.trim();
    } else if (nuxt?.title) {
      meta.title = nuxt.title;
    } else {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const raw = ogTitle ? ogTitle.content : document.title;
      meta.title = raw
        .replace(/\s*-\s*Thư viện ebook Waka\s*$/i, '')
        .replace(/\s*-\s*[^-]+$/, '')
        .trim();
    }

    // Authors
    meta.authors = [];
    document.querySelectorAll('.el-select-dropdown__item.selected a').forEach((a) => {
      if ((a.getAttribute('href') || '').includes('/author/')) {
        const name = a.textContent.trim();
        if (name && !meta.authors.includes(name)) meta.authors.push(name);
      }
    });
    if (meta.authors.length === 0) {
      document.querySelectorAll('p.text-white-400').forEach((label) => {
        if (label.textContent.trim() === 'Tác giả') {
          const parentDiv = label.closest('div');
          if (parentDiv) {
            parentDiv.querySelectorAll('a').forEach((a) => {
              const name = a.textContent.trim();
              if (name && !meta.authors.includes(name)) meta.authors.push(name);
            });
            if (meta.authors.length === 0) {
              const p = parentDiv.querySelector('p.text-white-50');
              if (p) p.textContent.trim().split(',').forEach(n => {
                const name = n.trim();
                if (name) meta.authors.push(name);
              });
            }
          }
        }
      });
    }
    if (meta.authors.length === 0 && nuxt?.authors?.length) meta.authors = nuxt.authors;

    // Publisher / Pubdate / Translator
    const labels = document.querySelectorAll('p.text-white-400');
    labels.forEach((label) => {
      const text = label.textContent.trim();
      const parentDiv = label.closest('div');
      const valEl = parentDiv?.querySelector('p.text-white-50');
      if (text === 'Nhà xuất bản' && valEl) meta.publisher = valEl.textContent.trim();
      if (text === 'Phát hành' && valEl) {
        const raw = valEl.textContent.trim();
        meta.pubdate_raw = raw;
        const parts = raw.split('/');
        if (parts.length === 3) {
          const [dd, mm, yyyy] = parts;
          meta.pubdate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
        }
      }
      if (text === 'Dịch giả' && valEl) meta.translator = valEl.textContent.trim();
    });
    if (!meta.publisher && nuxt?.publisher) meta.publisher = nuxt.publisher;
    if (!meta.pubdate && nuxt?.pubdate) meta.pubdate = nuxt.pubdate;
    if (!meta.pubdate_raw && nuxt?.pubdate_raw) meta.pubdate_raw = nuxt.pubdate_raw;

    // Tags
    meta.tags = [];
    document.querySelectorAll('.el-select-dropdown__item.selected a').forEach((a) => {
      if ((a.getAttribute('href') || '').includes('/ebook/')) {
        const tag = a.textContent.trim();
        if (tag && !meta.tags.includes(tag)) meta.tags.push(tag);
      }
    });
    if (meta.tags.length === 0) {
      labels.forEach((label) => {
        if (label.textContent.trim() === 'Thể loại') {
          label.closest('div')?.querySelectorAll('a').forEach((a) => {
            const tag = a.textContent.trim();
            if (tag && !meta.tags.includes(tag)) meta.tags.push(tag);
          });
        }
      });
    }
    if (meta.tags.length === 0 && nuxt?.tags?.length) meta.tags = nuxt.tags;

    // Description
    const descEl = document.querySelector('.check-des') ||
      document.querySelector('.text-16.text-white-50.text-justify');
    if (descEl) {
      meta.comments = descEl.innerText.trim().replace(/\s*Rút gọn\s*$/i, '').trim();
    } else if (nuxt?.comments) {
      meta.comments = nuxt.comments;
    } else {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) meta.comments = ogDesc.content.trim();
    }

    // Cover
    const coverImg = document.querySelector('div.pt-full-265-388 img');
    if (coverImg) {
      meta.cover = coverImg.src.replace(/&amp;/g, '&');
    } else if (nuxt?.cover) {
      meta.cover = nuxt.cover;
    } else {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) meta.cover = ogImg.content.replace(/&amp;/g, '&');
    }

    meta.language = document.documentElement.lang || 'vi';
    meta.source_url = window.location.href;
    const urlMatch = window.location.pathname.match(/([A-Za-z0-9]+)(?:\.html)?$/);
    if (urlMatch) meta.waka_id = urlMatch[1];

    return meta;
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: FORMAT GENERATORS (OPF / YAML / CSV / CALIBRE CLIPBOARD)
  // ══════════════════════════════════════════════════════════════════════

  function escapeXML(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function generateOPF(meta) {
    const now = new Date().toISOString();
    const uuid = 'urn:uuid:' + generateUUID();
    const authorsXML = (meta.authors || ['Không rõ'])
      .map(a => `    <dc:creator opf:role="aut" opf:file-as="${escapeXML(a)}">${escapeXML(a)}</dc:creator>`)
      .join('\n');
    const tagsXML = (meta.tags || [])
      .map(t => `    <dc:subject>${escapeXML(t)}</dc:subject>`)
      .join('\n');
    const publisher  = meta.publisher ? escapeXML(meta.publisher) : '';
    const pubdate    = meta.pubdate || '';
    const language   = meta.language || 'vi';
    const title      = escapeXML(meta.title || 'Không có tiêu đề');
    const comments   = escapeXML(meta.comments || '');
    const translator = meta.translator ? escapeXML(meta.translator) : '';
    const sourceUrl  = escapeXML(meta.source_url || '');

    return `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier opf:scheme="uuid" id="uuid_id">${uuid}</dc:identifier>
    <dc:title>${title}</dc:title>
${authorsXML}
    <dc:language>${language}</dc:language>${publisher ? `\n    <dc:publisher>${publisher}</dc:publisher>` : ''}${pubdate ? `\n    <dc:date opf:event="publication">${pubdate}</dc:date>` : ''}${tagsXML ? `\n${tagsXML}` : ''}${comments ? `\n    <dc:description>${comments}</dc:description>` : ''}${translator ? `\n    <dc:contributor opf:role="trl">${translator}</dc:contributor>` : ''}${sourceUrl ? `\n    <dc:source>${sourceUrl}</dc:source>` : ''}
    <meta name="calibre:timestamp" content="${now}"/>
    <meta name="calibre:title_sort" content="${title}"/>
  </metadata>
  <manifest/>
  <spine/>
</package>`;
  }

  function generateYAML(meta) {
    function yamlStr(val) {
      if (!val) return '""';
      if (String(val).includes('\n')) return '|\n' + String(val).replace(/^/gm, '    ');
      const s = String(val);
      if (/[:#\[\]{}&*!|>'",%@`]/.test(s) || s.startsWith(' ') || s.endsWith(' ')) {
        return '"' + s.replace(/"/g, '\\"') + '"';
      }
      return s;
    }
    const lines = ['# Calibre metadata YAML', '---'];
    lines.push(`title: ${yamlStr(meta.title)}`);
    lines.push(`authors:\n${(meta.authors || []).map(a => `  - ${yamlStr(a)}`).join('\n')}`);
    if (meta.publisher) lines.push(`publisher: ${yamlStr(meta.publisher)}`);
    if (meta.pubdate)   lines.push(`pubdate: "${meta.pubdate}"`);
    if (meta.translator) lines.push(`translator: ${yamlStr(meta.translator)}`);
    if (meta.tags && meta.tags.length) lines.push(`tags:\n${meta.tags.map(t => `  - ${yamlStr(t)}`).join('\n')}`);
    lines.push(`language: ${meta.language || 'vi'}`);
    if (meta.cover)      lines.push(`cover: ${yamlStr(meta.cover)}`);
    if (meta.source_url) lines.push(`source: ${yamlStr(meta.source_url)}`);
    if (meta.comments)   lines.push(`comments: ${yamlStr(meta.comments)}`);
    return lines.join('\n');
  }

  function generateCSV(meta) {
    const headers = ['title','authors','publisher','pubdate','tags','comments','language','translator','cover'];
    const row = [
      meta.title || '',
      (meta.authors || []).join(' & '),
      meta.publisher || '',
      meta.pubdate || '',
      (meta.tags || []).join(', '),
      meta.comments || '',
      meta.language || 'vi',
      meta.translator || '',
      meta.cover || '',
    ];
    function csvCell(val) {
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    return headers.join(',') + '\n' + row.map(csvCell).join(',');
  }

  function generateCalibreClipboard(meta) {
    const pad = (label) => label.padEnd(20, ' ');
    const lines = [];
    lines.push(`${pad('Title')} : ${meta.title || ''}`);
    lines.push(`${pad('Title sort')} : ${meta.title || ''}`);
    const authorsFormatted = (meta.authors || ['Unknown']).map((a) => {
      const parts = a.trim().split(/\s+/);
      if (parts.length <= 1) return `${a} [${a}]`;
      const last = parts[parts.length - 1];
      const rest = parts.slice(0, -1).join(' ');
      return `${a} [${last}, ${rest}]`;
    });
    lines.push(`${pad('Author(s)')} : ${authorsFormatted.join(' & ')}`);
    if (meta.publisher) lines.push(`${pad('Publisher')} : ${meta.publisher}`);
    if (meta.tags && meta.tags.length) lines.push(`${pad('Tags')} : ${meta.tags.join(', ')}`);
    lines.push(`${pad('Languages')} : ${meta.language || 'vie'}`);
    lines.push(`${pad('Timestamp')} : ${new Date().toISOString().replace(/\.\d+Z$/, '+00:00')}`);
    if (meta.pubdate) lines.push(`${pad('Published')} : ${meta.pubdate}T00:00:00+00:00`);
    if (meta.comments) {
      const html = meta.comments.trim().startsWith('<')
        ? meta.comments.trim()
        : `<div>\n<p>${meta.comments.trim()}</p></div>`;
      lines.push(`${pad('Comments')} : ${html}`);
    }
    return lines.join('\r\n');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: EPUB INJECT HELPERS
  // ══════════════════════════════════════════════════════════════════════

  async function findOpfPath(zip) {
    const container = zip.file('META-INF/container.xml');
    if (container) {
      const xml = await container.async('string');
      const m = xml.match(/full-path="([^"]+\.opf)"/i);
      if (m) return m[1];
    }
    const found = Object.keys(zip.files).find(n => n.endsWith('.opf') && !n.includes('META-INF'));
    if (found) return found;
    throw new Error('Không tìm thấy .opf trong EPUB');
  }

  function parseOpfMeta(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const DC = 'http://purl.org/dc/elements/1.1/';
    const meta = {};
    ['title','creator','language','publisher','date','subject','description','source','rights','contributor','identifier'].forEach(f => {
      const el = doc.getElementsByTagNameNS(DC, f)[0];
      if (el && el.textContent.trim()) meta[f] = el.textContent.trim();
    });
    doc.querySelectorAll('meta[name]').forEach(m => {
      if (m.getAttribute('name') && m.getAttribute('content'))
        meta['meta:' + m.getAttribute('name')] = m.getAttribute('content');
    });
    return meta;
  }

  function buildWakaOpfMeta(waka) {
    const m = {};
    if (waka.title)      m.title       = waka.title;
    if (waka.authors && waka.authors.length) m.creator = waka.authors.join(', ');
    if (waka.language)   m.language    = waka.language;
    if (waka.publisher)  m.publisher   = waka.publisher;
    if (waka.pubdate)    m.date        = waka.pubdate;
    if (waka.tags && waka.tags.length) m.subject = waka.tags.join(', ');
    if (waka.comments)   m.description = waka.comments;
    if (waka.source_url) m.source      = waka.source_url;
    if (waka.translator) m.contributor = waka.translator;
    m['meta:calibre:timestamp']  = new Date().toISOString();
    m['meta:calibre:title_sort'] = waka.title || '';
    return m;
  }

  function mergeEpubMeta(epubOpfXml, wakaMeta) {
    const DC = 'http://purl.org/dc/elements/1.1/';
    const parser = new DOMParser();
    const serializer = new XMLSerializer();
    const doc = parser.parseFromString(epubOpfXml, 'application/xml');
    const metaEl = doc.querySelector('metadata');
    if (!metaEl) throw new Error('Không tìm thấy <metadata> trong EPUB');

    const DC_MAP = {
      title:'title', creator:'creator', language:'language',
      publisher:'publisher', date:'date', subject:'subject',
      description:'description', source:'source',
      rights:'rights', contributor:'contributor',
    };

    Object.entries(DC_MAP).forEach(([key, dcField]) => {
      if (!wakaMeta[key]) return;
      [...doc.getElementsByTagNameNS(DC, dcField)].forEach(el => el.parentNode.removeChild(el));
      const newEl = doc.createElementNS(DC, 'dc:' + dcField);
      newEl.textContent = wakaMeta[key];
      metaEl.appendChild(newEl);
    });

    Object.entries(wakaMeta).forEach(([key, val]) => {
      if (!key.startsWith('meta:') || !val) return;
      const name = key.slice(5);
      [...doc.querySelectorAll(`meta[name="${name}"]`)].forEach(el => el.parentNode.removeChild(el));
      const m = doc.createElement('meta');
      m.setAttribute('name', name);
      m.setAttribute('content', val);
      metaEl.appendChild(m);
    });

    let result = serializer.serializeToString(doc);
    result = result.replace(/ xmlns=""/g, '');
    result = result.replace(/xmlns:NS\d+="[^"]*"/g, '');
    result = result.replace(/\bNS\d+:/g, '');
    if (!result.startsWith('<?xml')) {
      result = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n' + result;
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: UTILITIES
  // ══════════════════════════════════════════════════════════════════════

  function slugify(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 60);
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 5000);
  }

  function copyToClipboard(text) {
    // GM_setClipboard từ Tampermonkey
    if (typeof GM_setClipboard !== 'undefined') {
      GM_setClipboard(text, 'text');
      return true;
    }
    // Fallback: navigator.clipboard
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
      return true;
    }
    // Fallback cuối: execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: UI — FLOATING PANEL
  // ══════════════════════════════════════════════════════════════════════

  const PANEL_ID = 'waka-meta-panel';
  const BTN_ID   = 'waka-meta-toggle-btn';
  let currentMeta = null;
  let epubFile    = null;

  const STYLES = `
    #${BTN_ID} {
      position: fixed; bottom: 24px; left: 24px; z-index: 2147483646;
      width: 48px; height: 48px; border-radius: 50%;
      background: #e85d26; color: #fff;
      border: none; cursor: pointer;
      font-size: 20px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      transition: transform 0.2s, opacity 0.2s;
      font-family: system-ui, sans-serif;
    }
    #${BTN_ID}:hover { transform: scale(1.08); }
    #${BTN_ID}.active { background: #b84210; }

    #${PANEL_ID} {
      position: fixed; bottom: 84px; left: 20px; z-index: 2147483645;
      width: 420px; max-height: 90vh;
      background: #0f0f11; color: #f0ede8;
      border: 1px solid #2a2a35; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 13px; overflow-y: auto;
      display: none;
      scrollbar-width: thin;
    }
    #${PANEL_ID}.open { display: block; }

    /* Reuse popup styles, scoped to panel */
    #${PANEL_ID} * { box-sizing: border-box; margin: 0; padding: 0; }
    #${PANEL_ID} .wm-header {
      background: #1a1a1f; border-bottom: 1px solid #2a2a35;
      padding: 12px 16px; display: flex; align-items: center; gap: 10px;
      position: sticky; top: 0; z-index: 1;
    }
    #${PANEL_ID} .wm-logo {
      width: 28px; height: 28px; background: #e85d26; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; font-weight: 700; color: #fff; flex-shrink: 0;
    }
    #${PANEL_ID} .wm-header-text .wm-title { font-size: 14px; font-weight: 600; }
    #${PANEL_ID} .wm-header-text .wm-sub   { font-size: 11px; color: #888; }
    #${PANEL_ID} .wm-close {
      margin-left: auto; background: none; border: none; color: #888;
      font-size: 18px; cursor: pointer; padding: 4px 6px; border-radius: 4px;
      line-height: 1;
    }
    #${PANEL_ID} .wm-close:hover { color: #f0ede8; background: #2a2a35; }

    #${PANEL_ID} #wm-state-loading,
    #${PANEL_ID} #wm-state-error,
    #${PANEL_ID} #wm-state-empty { padding: 28px 20px; text-align: center; color: #888; }

    #${PANEL_ID} .wm-spinner {
      width: 28px; height: 28px; border: 3px solid #2a2a35;
      border-top-color: #e85d26; border-radius: 50%;
      animation: wm-spin 0.7s linear infinite;
      margin: 0 auto 10px;
    }
    @keyframes wm-spin { to { transform: rotate(360deg); } }

    #${PANEL_ID} .wm-book-header {
      display: flex; gap: 12px; padding: 14px 16px;
      border-bottom: 1px solid #2a2a35;
    }
    #${PANEL_ID} .wm-cover-wrap { flex-shrink: 0; width: 72px; }
    #${PANEL_ID} .wm-cover-wrap img {
      width: 72px; height: 104px; object-fit: cover;
      border-radius: 4px; border: 1px solid #2a2a35;
    }
    #${PANEL_ID} .wm-cover-ph {
      width: 72px; height: 104px; background: #1a1a1f;
      border: 1px solid #2a2a35; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      color: #888; font-size: 24px;
    }
    #${PANEL_ID} .wm-book-info  { flex: 1; min-width: 0; }
    #${PANEL_ID} .wm-book-title { font-size: 14px; font-weight: 700; line-height: 1.4; margin-bottom: 4px; }
    #${PANEL_ID} .wm-book-author{ color: #f07040; margin-bottom: 4px; font-size: 12px; }
    #${PANEL_ID} .wm-book-pub   { color: #888; font-size: 11px; }

    #${PANEL_ID} .wm-meta-section { padding: 10px 16px 0; }
    #${PANEL_ID} .wm-meta-row {
      display: flex; gap: 8px; padding: 6px 0;
      border-bottom: 1px solid #2a2a35; align-items: flex-start;
    }
    #${PANEL_ID} .wm-meta-row:last-child { border-bottom: none; }
    #${PANEL_ID} .wm-meta-label { width: 96px; flex-shrink: 0; color: #888; font-size: 11px; padding-top: 1px; }
    #${PANEL_ID} .wm-meta-value { flex: 1; color: #f0ede8; font-size: 12px; line-height: 1.45; word-break: break-word; }
    #${PANEL_ID} .wm-tag-pill {
      display: inline-block; background: #2a1a10;
      border: 1px solid #e85d26; color: #f07040;
      border-radius: 4px; padding: 1px 7px;
      font-size: 10px; margin: 2px 2px 2px 0;
    }

    #${PANEL_ID} .wm-desc-section { padding: 10px 16px; border-top: 1px solid #2a2a35; }
    #${PANEL_ID} .wm-desc-label   { color: #888; font-size: 11px; margin-bottom: 5px; }
    #${PANEL_ID} .wm-desc-text    {
      color: #f0ede8; font-size: 12px; line-height: 1.6;
      max-height: 96px; overflow-y: auto; scrollbar-width: thin;
    }

    #${PANEL_ID} .wm-action-bar  {
      display: flex; gap: 8px; padding: 10px 16px 14px;
    }
    #${PANEL_ID} .wm-btn {
      flex: 1; padding: 9px 0; border-radius: 8px;
      font-size: 12px; font-weight: 600; cursor: pointer;
      border: none; transition: opacity 0.15s, transform 0.1s;
      display: flex; align-items: center; justify-content: center; gap: 5px;
    }
    #${PANEL_ID} .wm-btn:active { transform: scale(0.97); }
    #${PANEL_ID} .wm-btn-opf  { background: #1a1a1f; border: 1px solid #2a2a35; color: #f0ede8; }
    #${PANEL_ID} .wm-btn-opf:hover  { border-color: #e85d26; }
    #${PANEL_ID} .wm-btn-yaml { background: #1a1a1f; border: 1px solid #2a2a35; color: #f0ede8; }
    #${PANEL_ID} .wm-btn-yaml:hover  { border-color: #e85d26; }
    #${PANEL_ID} .wm-btn-csv  { background: #1a1a1f; border: 1px solid #2a2a35; color: #f0ede8; }
    #${PANEL_ID} .wm-btn-csv:hover   { border-color: #e85d26; }
    #${PANEL_ID} .wm-btn-calibre { background: #e85d26; color: #fff; flex: 2; }
    #${PANEL_ID} .wm-btn-calibre:hover { opacity: 0.9; }
    #${PANEL_ID} .wm-btn-refresh {
      flex: 0 0 36px; background: #1a1a1f;
      border: 1px solid #2a2a35; color: #888; font-size: 14px;
    }

    #${PANEL_ID} .wm-toast {
      position: sticky; bottom: 0; left: 0; right: 0;
      padding: 8px 16px; text-align: center;
      background: #4caf7d; color: #fff;
      font-size: 12px; font-weight: 600;
      opacity: 0; transition: opacity 0.2s;
      pointer-events: none;
    }
    #${PANEL_ID} .wm-toast.show { opacity: 1; }
    #${PANEL_ID} .wm-toast.error-toast { background: #e85d26; }

    /* EPUB Inject section */
    #${PANEL_ID} .wm-epub-section { border-top: 2px solid #2a2a35; margin-top: 2px; }
    #${PANEL_ID} .wm-epub-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 16px; cursor: pointer; user-select: none;
      background: #1a1a1f;
    }
    #${PANEL_ID} .wm-epub-header:hover { background: #1f1f26; }
    #${PANEL_ID} .wm-epub-title {
      display: flex; align-items: center; gap: 7px;
      font-size: 12px; font-weight: 600; color: #f0ede8;
    }
    #${PANEL_ID} .wm-epub-badge {
      background: #2a1a10; border: 1px solid #e85d26;
      color: #f07040; border-radius: 4px; padding: 1px 6px;
      font-size: 10px; font-weight: 700;
    }
    #${PANEL_ID} .wm-epub-chevron { color: #888; font-size: 11px; transition: transform 0.2s; }
    #${PANEL_ID} .wm-epub-chevron.open { transform: rotate(180deg); }
    #${PANEL_ID} .wm-epub-body { display: none; padding: 10px 16px 14px; }
    #${PANEL_ID} .wm-epub-body.open { display: block; }

    #${PANEL_ID} .wm-drop-zone {
      border: 2px dashed #2a2a35; border-radius: 8px;
      padding: 13px 12px; text-align: center; cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      position: relative; background: transparent;
    }
    #${PANEL_ID} .wm-drop-zone:hover,
    #${PANEL_ID} .wm-drop-zone.drag-over { border-color: #e85d26; background: #1e140e; }
    #${PANEL_ID} .wm-drop-zone.has-file { border-color: #4caf7d; border-style: solid; background: #0d1f14; }
    #${PANEL_ID} .wm-drop-zone input[type="file"] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
    }
    #${PANEL_ID} .wm-drop-icon     { font-size: 20px; margin-bottom: 4px; }
    #${PANEL_ID} .wm-drop-label    { font-size: 12px; font-weight: 600; color: #888; }
    #${PANEL_ID} .wm-drop-hint     { font-size: 10px; color: #555; margin-top: 2px; }
    #${PANEL_ID} .wm-drop-filename { font-size: 11px; font-weight: 700; color: #4caf7d; margin-top: 3px; word-break: break-all; }
    #${PANEL_ID} .wm-drop-zone .wm-clear-btn {
      position: absolute; top: 6px; right: 7px;
      background: none; border: none; font-size: 14px; cursor: pointer;
      color: #555; line-height: 1; padding: 2px; display: none;
    }
    #${PANEL_ID} .wm-drop-zone.has-file .wm-clear-btn { display: block; }
    #${PANEL_ID} .wm-drop-zone.has-file .wm-drop-hint { display: none; }

    #${PANEL_ID} .wm-epub-status {
      font-size: 11px; padding: 6px 10px; border-radius: 6px;
      margin-top: 8px; display: none;
    }
    #${PANEL_ID} .wm-epub-status.show { display: block; }
    #${PANEL_ID} .wm-epub-status.info    { background: #1a1a2f; color: #7090e8; }
    #${PANEL_ID} .wm-epub-status.success { background: #0d1f14; color: #4caf7d; }
    #${PANEL_ID} .wm-epub-status.error   { background: #2a0f0f; color: #f88; }

    #${PANEL_ID} .wm-epub-preview { margin-top: 10px; border: 1px solid #2a2a35; border-radius: 8px; overflow: hidden; display: none; }
    #${PANEL_ID} .wm-epub-preview.show { display: block; }
    #${PANEL_ID} .wm-epub-preview-head {
      background: #1f1f26; padding: 6px 10px; font-size: 10px; font-weight: 700;
      color: #888; text-transform: uppercase; letter-spacing: .05em;
      display: flex; align-items: center; justify-content: space-between;
    }
    #${PANEL_ID} .wm-epub-preview-badges { display: flex; gap: 5px; }
    #${PANEL_ID} .wm-pbadge { font-size: 10px; padding: 1px 6px; border-radius: 99px; font-weight: 700; }
    #${PANEL_ID} .wm-pbadge-new  { background: #0d2a18; color: #4caf7d; border: 1px solid #1a5c33; }
    #${PANEL_ID} .wm-pbadge-keep { background: #1a1a2f; color: #7090e8; border: 1px solid #2a3a7a; }
    #${PANEL_ID} .wm-epub-preview-rows { padding: 6px 10px; }
    #${PANEL_ID} .wm-epub-prow {
      display: grid; grid-template-columns: 80px 1fr; gap: 6px; align-items: start;
      padding: 4px 0; border-bottom: 1px solid #2a2a35;
    }
    #${PANEL_ID} .wm-epub-prow:last-child { border-bottom: none; }
    #${PANEL_ID} .wm-epub-pkey  { font-size: 10px; font-weight: 600; color: #888; padding-top: 2px; }
    #${PANEL_ID} .wm-epub-pval  { font-size: 11px; color: #f0ede8; word-break: break-word; line-height: 1.45; }
    #${PANEL_ID} .wm-epub-pval.is-new { color: #4caf7d; }
    #${PANEL_ID} .wm-epub-pval .wm-ptag {
      font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; margin-left: 4px; vertical-align: middle;
    }
    #${PANEL_ID} .wm-ptag-new  { background: #0d2a18; color: #4caf7d; }
    #${PANEL_ID} .wm-ptag-keep { background: #1a1a2f; color: #7090e8; }
    #${PANEL_ID} .wm-epub-pval.desc-val {
      max-height: 64px; overflow-y: auto; background: #14141a; border-radius: 4px;
      padding: 4px 6px; font-size: 10px; border: 1px solid #2a2a35; scrollbar-width: thin;
    }

    #${PANEL_ID} .wm-btn-inject {
      width: 100%; margin-top: 10px; padding: 10px;
      background: #e85d26; color: #fff; border: none;
      border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      transition: opacity 0.15s, transform 0.1s;
    }
    #${PANEL_ID} .wm-btn-inject:hover:not(:disabled) { opacity: 0.88; }
    #${PANEL_ID} .wm-btn-inject:active:not(:disabled) { transform: scale(0.98); }
    #${PANEL_ID} .wm-btn-inject:disabled { opacity: 0.4; cursor: not-allowed; }
    #${PANEL_ID} .wm-inject-spinner {
      width: 13px; height: 13px; border: 2px solid rgba(255,255,255,.3);
      border-top-color: #fff; border-radius: 50%;
      animation: wm-spin 0.6s linear infinite; display: none;
    }
  `;

  const PANEL_HTML = `
    <div class="wm-header">
      <div class="wm-logo">W</div>
      <div class="wm-header-text">
        <div class="wm-title">Waka Metadata Extractor</div>
        <div class="wm-sub">Xuất metadata sách cho Calibre</div>
      </div>
      <button class="wm-close" id="wm-close-btn" title="Đóng">✕</button>
    </div>

    <div id="wm-state-loading" style="display:none">
      <div class="wm-spinner"></div>
      <div>Đang trích xuất metadata...</div>
    </div>

    <div id="wm-state-error" style="display:none;padding:12px 16px;background:#2a0f0f;border:1px solid #6b1a1a;border-radius:8px;margin:12px 16px;color:#f88;font-size:12px;line-height:1.5;"></div>

    <div id="wm-state-empty" style="display:none">
      <div style="font-size:32px;margin-bottom:8px">📚</div>
      <p>Mở một trang sách trên waka.vn/ebook/ hoặc waka.vn/reader/ để trích xuất metadata.</p>
    </div>

    <div id="wm-main" style="display:none">
      <div class="wm-book-header">
        <div class="wm-cover-wrap" id="wm-cover-wrap">
          <div class="wm-cover-ph">📖</div>
        </div>
        <div class="wm-book-info">
          <div class="wm-book-title" id="wm-book-title">—</div>
          <div class="wm-book-author" id="wm-book-author">—</div>
          <div class="wm-book-pub" id="wm-book-pub">—</div>
        </div>
      </div>

      <div class="wm-meta-section">
        <div class="wm-meta-row">
          <div class="wm-meta-label">Thể loại</div>
          <div class="wm-meta-value" id="wm-meta-tags">—</div>
        </div>
        <div class="wm-meta-row" id="wm-row-translator" style="display:none">
          <div class="wm-meta-label">Dịch giả</div>
          <div class="wm-meta-value" id="wm-meta-translator">—</div>
        </div>
        <div class="wm-meta-row">
          <div class="wm-meta-label">Ngôn ngữ</div>
          <div class="wm-meta-value" id="wm-meta-lang">vi</div>
        </div>
        <div class="wm-meta-row">
          <div class="wm-meta-label">Nguồn</div>
          <div class="wm-meta-value" id="wm-meta-source" style="color:#888;font-size:10px;word-break:break-all">—</div>
        </div>
      </div>

      <div class="wm-desc-section">
        <div class="wm-desc-label">Giới thiệu / Mô tả</div>
        <div class="wm-desc-text" id="wm-meta-desc">—</div>
      </div>

      <div class="wm-action-bar">
        <button class="wm-btn wm-btn-opf"  id="wm-btn-opf">⬇ OPF</button>
        <button class="wm-btn wm-btn-yaml" id="wm-btn-yaml">⬇ YAML</button>
        <button class="wm-btn wm-btn-csv"  id="wm-btn-csv">⬇ CSV</button>
        <button class="wm-btn wm-btn-calibre" id="wm-btn-calibre">📋 Copy to Calibre</button>
        <button class="wm-btn wm-btn-refresh" id="wm-btn-refresh" title="Trích xuất lại">↺</button>
      </div>
    </div>

    <!-- EPUB Inject -->
    <div class="wm-epub-section">
      <div class="wm-epub-header" id="wm-epub-toggle">
        <div class="wm-epub-title">
          📦 Inject vào EPUB
          <span class="wm-epub-badge">INJECT</span>
        </div>
        <span class="wm-epub-chevron" id="wm-epub-chevron">▼</span>
      </div>
      <div class="wm-epub-body" id="wm-epub-body">
        <div class="wm-drop-zone" id="wm-drop-zone">
          <input type="file" id="wm-epub-input" accept=".epub" />
          <div class="wm-drop-icon">📖</div>
          <div class="wm-drop-label">Chọn hoặc kéo thả file EPUB</div>
          <div class="wm-drop-hint">Định dạng: .epub</div>
          <div class="wm-drop-filename" id="wm-drop-filename"></div>
          <button class="wm-clear-btn" id="wm-epub-clear" type="button">✕</button>
        </div>

        <div class="wm-epub-status" id="wm-epub-status"></div>

        <div class="wm-epub-preview" id="wm-epub-preview">
          <div class="wm-epub-preview-head">
            Thay đổi metadata
            <div class="wm-epub-preview-badges">
              <span class="wm-pbadge wm-pbadge-new">● Thêm mới</span>
              <span class="wm-pbadge wm-pbadge-keep">● Cập nhật</span>
            </div>
          </div>
          <div class="wm-epub-preview-rows" id="wm-epub-preview-rows"></div>
        </div>

        <button class="wm-btn-inject" id="wm-btn-inject" disabled>
          <div class="wm-inject-spinner" id="wm-inject-spinner"></div>
          <span id="wm-inject-text">⚡ Inject & Xuất EPUB mới</span>
        </button>
      </div>
    </div>

    <div class="wm-toast" id="wm-toast"></div>
  `;

  // ── Inject styles + panel ────────────────────────────────────────────
  function injectUI() {
    if (document.getElementById(PANEL_ID)) return;

    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = 'W';
    btn.title = 'Waka Metadata Extractor';
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = PANEL_HTML;
    document.body.appendChild(panel);

    setupPanelEvents(btn, panel);
  }

  // ── Show/hide states ─────────────────────────────────────────────────
  function showState(state) {
    const panel = document.getElementById(PANEL_ID);
    ['loading','error','empty','main'].forEach(s => {
      const el = panel.querySelector(`#wm-state-${s}`);
      if (el) el.style.display = s === state ? 'block' : 'none';
    });
    const main = panel.querySelector('#wm-main');
    if (main) main.style.display = state === 'main' ? 'block' : 'none';
  }

  function showError(msg) {
    const el = document.getElementById('wm-state-error');
    if (el) { el.innerHTML = '⚠️ ' + msg; el.style.display = 'block'; }
    const loading = document.getElementById('wm-state-loading');
    if (loading) loading.style.display = 'none';
  }

  // ── Render metadata ─────────────────────────────────────────────────
  function renderMeta(meta) {
    setText('wm-book-title', meta.title || '—');
    setText('wm-book-author', (meta.authors || []).join(', ') || 'Không rõ tác giả');

    let pubLine = [];
    if (meta.publisher) pubLine.push(meta.publisher);
    if (meta.pubdate_raw) pubLine.push(meta.pubdate_raw);
    setText('wm-book-pub', pubLine.join(' · ') || '—');

    if (meta.cover) {
      const wrap = document.getElementById('wm-cover-wrap');
      const img = document.createElement('img');
      img.src = meta.cover; img.alt = meta.title;
      img.onerror = () => { wrap.innerHTML = '<div class="wm-cover-ph">📖</div>'; };
      wrap.innerHTML = ''; wrap.appendChild(img);
    }

    const tagsEl = document.getElementById('wm-meta-tags');
    if (meta.tags && meta.tags.length) {
      tagsEl.innerHTML = meta.tags.map(t => `<span class="wm-tag-pill">${escHtml(t)}</span>`).join('');
    } else { tagsEl.textContent = '—'; }

    const transRow = document.getElementById('wm-row-translator');
    if (meta.translator) {
      setText('wm-meta-translator', meta.translator);
      transRow.style.display = 'flex';
    } else { transRow.style.display = 'none'; }

    setText('wm-meta-lang', meta.language || 'vi');
    setText('wm-meta-source', meta.source_url || '—');
    setText('wm-meta-desc', meta.comments || 'Không có mô tả.');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function showToast(msg, isError = false) {
    const el = document.getElementById('wm-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'wm-toast show' + (isError ? ' error-toast' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.className = 'wm-toast', 2500);
  }

  // ── Extract & render ─────────────────────────────────────────────────
  function doExtract() {
    showState('loading');
    try {
      const meta = extractMetadata();
      if (!meta.title) {
        showError('Không trích xuất được metadata. Hãy thử reload trang rồi mở lại.');
        return;
      }
      currentMeta = meta;
      renderMeta(meta);
      showState('main');
      // trigger epub preview nếu đã có file
      tryEpubPreview();
    } catch (e) {
      showError('Lỗi: ' + e.message);
    }
  }

  // ── Panel events ─────────────────────────────────────────────────────
  function setupPanelEvents(btn, panel) {
    // Toggle panel
    btn.addEventListener('click', () => {
      const isOpen = panel.classList.toggle('open');
      btn.classList.toggle('active', isOpen);
      if (isOpen && !currentMeta) {
        const isWaka = /waka\.vn\/(ebook|reader)\//.test(window.location.href);
        if (isWaka) doExtract(); else showState('empty');
      }
    });

    // Close
    panel.querySelector('#wm-close-btn').addEventListener('click', () => {
      panel.classList.remove('open');
      btn.classList.remove('active');
    });

    // Action buttons
    panel.querySelector('#wm-btn-opf').addEventListener('click', () => {
      if (!currentMeta) return;
      const slug = slugify(currentMeta.title || 'book');
      downloadBlob(generateOPF(currentMeta), slug + '.opf', 'application/oebps-package+xml');
      showToast('Đã tải ' + slug + '.opf');
    });
    panel.querySelector('#wm-btn-yaml').addEventListener('click', () => {
      if (!currentMeta) return;
      const slug = slugify(currentMeta.title || 'book');
      downloadBlob(generateYAML(currentMeta), slug + '_metadata.yaml', 'text/yaml');
      showToast('Đã tải ' + slug + '_metadata.yaml');
    });
    panel.querySelector('#wm-btn-csv').addEventListener('click', () => {
      if (!currentMeta) return;
      const slug = slugify(currentMeta.title || 'book');
      downloadBlob(generateCSV(currentMeta), slug + '_metadata.csv', 'text/csv');
      showToast('Đã tải ' + slug + '_metadata.csv');
    });
    panel.querySelector('#wm-btn-calibre').addEventListener('click', () => {
      if (!currentMeta) return;
      const text = generateCalibreClipboard(currentMeta);
      const ok = copyToClipboard(text);
      if (ok) showToast('✓ Đã copy — Paste metadata trong Calibre');
      else    showToast('⚠ Không copy được. Hãy thử lại.', true);
    });
    panel.querySelector('#wm-btn-refresh').addEventListener('click', () => {
      currentMeta = null;
      doExtract();
    });

    // EPUB accordion
    panel.querySelector('#wm-epub-toggle').addEventListener('click', () => {
      const body    = panel.querySelector('#wm-epub-body');
      const chevron = panel.querySelector('#wm-epub-chevron');
      body.classList.toggle('open');
      chevron.classList.toggle('open');
    });

    // EPUB file input
    panel.querySelector('#wm-epub-input').addEventListener('change', e => {
      if (e.target.files[0]) setEpubFile(e.target.files[0]);
    });
    panel.querySelector('#wm-epub-clear').addEventListener('click', e => {
      e.stopPropagation(); clearEpubFile();
    });

    // Drag & drop
    const zone = panel.querySelector('#wm-drop-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) setEpubFile(e.dataTransfer.files[0]);
    });

    // Inject button
    panel.querySelector('#wm-btn-inject').addEventListener('click', runInject);
  }

  // ── EPUB file set/clear ──────────────────────────────────────────────
  function setEpubFile(file) {
    epubFile = file;
    const zone = document.getElementById('wm-drop-zone');
    zone.classList.add('has-file');
    setText('wm-drop-filename', '✓  ' + file.name);
    setEpubStatus('', '');
    tryEpubPreview();
  }
  function clearEpubFile() {
    epubFile = null;
    const zone = document.getElementById('wm-drop-zone');
    zone.classList.remove('has-file');
    setText('wm-drop-filename', '');
    const inp = document.getElementById('wm-epub-input');
    if (inp) inp.value = '';
    hideEpubPreview();
    setEpubStatus('', '');
    const btn = document.getElementById('wm-btn-inject');
    if (btn) btn.disabled = true;
  }

  // ── EPUB preview ─────────────────────────────────────────────────────
  const FIELD_LABELS = {
    title:'Tiêu đề', creator:'Tác giả', language:'Ngôn ngữ',
    publisher:'NXB', date:'Ngày XB', subject:'Thể loại',
    description:'Mô tả', source:'Nguồn', rights:'Bản quyền',
    contributor:'Dịch giả/CB', identifier:'UUID',
    'meta:calibre:timestamp':'Calibre TS',
    'meta:calibre:title_sort':'Title sort',
  };

  async function tryEpubPreview() {
    if (!epubFile || !currentMeta) {
      if (!currentMeta) setEpubStatus('⚠ Cần trích xuất metadata từ waka.vn trước.', 'info');
      return;
    }
    setEpubStatus('Đang phân tích EPUB…', 'info');
    try {
      const zip = await JSZip.loadAsync(epubFile);
      const opfPath = await findOpfPath(zip);
      const xml = await zip.file(opfPath).async('string');
      const epubMeta = parseOpfMeta(xml);
      const wakaMeta = buildWakaOpfMeta(currentMeta);
      renderEpubPreview(epubMeta, wakaMeta);
      setEpubStatus('', '');
      document.getElementById('wm-btn-inject').disabled = false;
    } catch (err) {
      setEpubStatus('❌ Lỗi đọc EPUB: ' + err.message, 'error');
      hideEpubPreview();
    }
  }

  function renderEpubPreview(epubMeta, wakaMeta) {
    const rows = document.getElementById('wm-epub-preview-rows');
    rows.innerHTML = '';
    Object.entries(wakaMeta).forEach(([key, val]) => {
      if (!val) return;
      const inEpub = !!epubMeta[key];
      const label = FIELD_LABELS[key] || key;
      const isNew = !inEpub;

      const row = document.createElement('div');
      row.className = 'wm-epub-prow';

      const keyEl = document.createElement('div');
      keyEl.className = 'wm-epub-pkey';
      keyEl.textContent = label;

      const valEl = document.createElement('div');
      valEl.className = 'wm-epub-pval' + (isNew ? ' is-new' : '');
      if (key === 'description') valEl.classList.add('desc-val');
      valEl.textContent = val;

      const tag = document.createElement('span');
      tag.className = 'wm-ptag ' + (isNew ? 'wm-ptag-new' : 'wm-ptag-keep');
      tag.textContent = isNew ? 'MỚI' : 'CẬP NHẬT';
      valEl.appendChild(tag);

      row.appendChild(keyEl); row.appendChild(valEl);
      rows.appendChild(row);
    });
    document.getElementById('wm-epub-preview').classList.add('show');
  }

  function hideEpubPreview() {
    const el = document.getElementById('wm-epub-preview');
    if (el) el.classList.remove('show');
  }

  function setEpubStatus(msg, type) {
    const el = document.getElementById('wm-epub-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'wm-epub-status';
    if (type) el.classList.add(type, 'show');
  }

  // ── Inject & export ──────────────────────────────────────────────────
  async function runInject() {
    if (!epubFile || !currentMeta) return;
    const btn     = document.getElementById('wm-btn-inject');
    const spinner = document.getElementById('wm-inject-spinner');
    const btnText = document.getElementById('wm-inject-text');
    btn.disabled = true; spinner.style.display = 'block';
    btnText.textContent = 'Đang xử lý…';
    setEpubStatus('⏳ Đang inject metadata…', 'info');
    try {
      const zip = await JSZip.loadAsync(epubFile);
      const opfPath = await findOpfPath(zip);
      const opfXml = await zip.file(opfPath).async('string');
      const wakaMeta = buildWakaOpfMeta(currentMeta);
      zip.file(opfPath, mergeEpubMeta(opfXml, wakaMeta));

      const blob = await zip.generateAsync({
        type: 'blob', mimeType: 'application/epub+zip',
        compression: 'DEFLATE', compressionOptions: { level: 6 },
      });
      const outName = epubFile.name.replace(/\.epub$/i, '') + '_updated.epub';
      downloadBlob(blob, outName, 'application/epub+zip');
      setEpubStatus('✅ Thành công! Đang tải "' + outName + '"…', 'success');
      showToast('✓ Đã xuất ' + outName);
    } catch (err) {
      console.error('[waka-meta] EpubInject:', err);
      setEpubStatus('❌ Lỗi: ' + err.message, 'error');
    } finally {
      btn.disabled = false; spinner.style.display = 'none';
      btnText.textContent = '⚡ Inject & Xuất EPUB mới';
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: BOOT — wait for DOM, watch SPA navigation
  // ══════════════════════════════════════════════════════════════════════

  function boot() {
    if (document.getElementById(PANEL_ID)) return;
    injectUI();
  }

  // Chạy ngay khi DOM sẵn sàng
  if (document.body) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  // Waka.vn là Nuxt SPA — theo dõi navigation
  const _origPush = history.pushState.bind(history);
  history.pushState = function (...args) {
    _origPush(...args);
    // Reset meta khi đổi trang
    setTimeout(() => {
      const isWaka = /waka\.vn\/(ebook|reader)\//.test(window.location.href);
      if (isWaka && document.getElementById(PANEL_ID)) {
        currentMeta = null;
        epubFile = null;
        clearEpubFile();
        // Nếu panel đang mở thì tự extract trang mới
        const panel = document.getElementById(PANEL_ID);
        if (panel && panel.classList.contains('open')) doExtract();
      }
    }, 600);
  };
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      currentMeta = null;
      const panel = document.getElementById(PANEL_ID);
      if (panel && panel.classList.contains('open')) doExtract();
    }, 600);
  });

})();
