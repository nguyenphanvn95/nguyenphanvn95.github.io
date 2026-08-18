/**
 * book-metadata.js — v4.4.6 + shop support
 * Chạy trên /ebook/* và /shop/* (trang chi tiết sách)
 * Logic extract metadata GIỐNG HỆT Waka Metadata Extractor 5.0
 * bao gồm: title, authors, publisher, pubdate, tags, description, cover
 *
 * v4.4.2: Thêm mobile mode
 *  - Nút Copy metadata hiện ngay dưới dòng tác giả trên mobile
 *  - Panel metadata hiện ngay dưới nút (inline) thay vì fixed top-right
 * v4.4.4: Lọc tag (bỏ giá, hội viên, CTA)
 * v4.4.3: Sửa extract metadata thiếu trên mobile (author, tags, publisher…)
 *  - Đọc __NUXT__ sâu hơn + fallback DOM kiểu "Tác giả: Name"
 */
(function () {
  'use strict';

  // ── MOBILE DETECT ───────────────────────────────────────────────────
  function isMobile() {
    return window.innerWidth <= 768 ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
  }

  // ── ĐỌC TỪ window.__NUXT__ (ưu tiên, tìm sâu hơn cho mobile) ───────
  function readNuxtData() {
    try {
      const nuxt = window.__NUXT__;
      if (!nuxt) return null;

      function decodeHtml(html) {
        if (!html) return '';
        const el = document.createElement('div');
        el.innerHTML = html;
        return (el.innerText || el.textContent || '').trim();
      }

      // Tìm object chứa info sách ở nhiều vị trí (desktop + mobile SPA)
      let info = null;
      const candidates = [];

      if (Array.isArray(nuxt.data)) {
        for (const d of nuxt.data) {
          if (!d || typeof d !== 'object') continue;
          candidates.push(
            d.ebookInfo, d.bookInfo, d.book, d.detail, d.ebook, d.productDetail,
            d.data?.ebookInfo, d.data?.bookInfo, d.data?.book, d.data?.productDetail,
            d.props?.productDetail, d.props?.ebookInfo, d.props?.bookInfo
          );
        }
      }
      // state / pinia-style
      if (nuxt.state) {
        const walk = (obj, depth = 0) => {
          if (!obj || typeof obj !== 'object' || depth > 4) return;
          if (obj.title && (obj.authors_json || obj.author_name || obj.author || obj.image_url || obj.description || obj.thumb)) {
            candidates.push(obj);
          }
          for (const k of Object.keys(obj)) {
            if (k === 'ebookInfo' || k === 'bookInfo' || k === 'book' || k === 'detail' || k === 'productDetail') {
              candidates.push(obj[k]);
            }
            if (typeof obj[k] === 'object') walk(obj[k], depth + 1);
          }
        };
        walk(nuxt.state);
      }

      for (const c of candidates) {
        if (c && typeof c === 'object' && (c.title || c.name || c.id)) {
          info = c;
          break;
        }
      }
      if (!info) return null;

      const result = {
        title:       info.title || info.name || '',
        authors:     [],
        publisher:   '',
        pubdate:     '',
        pubdate_raw: '',
        tags:        [],
        comments:    decodeHtml(info.description || info.desc || info.summary || ''),
        language:    'vi',
        cover:       '',
        source_url:  window.location.href,
      };

      // Authors
      if (info.authors_json) {
        try {
          const arr = JSON.parse(info.authors_json);
          result.authors = arr.map(a => (typeof a === 'string' ? a : (a.name || a.author_name || ''))).filter(Boolean);
        } catch (_) {}
      }
      if (result.authors.length === 0 && Array.isArray(info.authors)) {
        result.authors = info.authors.map(a => (typeof a === 'string' ? a : (a.name || ''))).filter(Boolean);
      }
      if (result.authors.length === 0) {
        const raw = info.author_name || info.author || info.writer || '';
        if (raw) result.authors = String(raw).split(/\s*[&,]\s*/).map(a => a.trim()).filter(Boolean);
      }

      // Publisher
      if (Array.isArray(info.publishing_houses) && info.publishing_houses.length) {
        result.publisher = info.publishing_houses[0].name || info.publishing_houses[0] || '';
      }
      if (!result.publisher) {
        result.publisher = info.publisher_name || info.publisher || info.publishing_house || '';
      }

      // Tags / categories
      if (Array.isArray(info.categories) && info.categories.length) {
        result.tags = info.categories.map(c => (typeof c === 'string' ? c : (c.name || c.title || ''))).filter(Boolean);
      } else if (Array.isArray(info.tags)) {
        result.tags = info.tags.map(t => (typeof t === 'string' ? t : (t.name || ''))).filter(Boolean);
      } else {
        const tagRaw = info.category_name || info.genre || info.category || info.cate_name || '';
        if (tagRaw) result.tags = String(tagRaw).split(/\s*[,;]\s*/).map(t => t.trim()).filter(Boolean);
      }

      // Date
      const dateRaw = info.published_time || info.publish_date || info.published_date || info.release_date || '';
      result.pubdate_raw = dateRaw;
      if (dateRaw) {
        const m = String(dateRaw).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (m) result.pubdate = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
        else {
          const m2 = String(dateRaw).match(/(\d{1,2})[\/\-](\d{4})/);
          if (m2) result.pubdate = `${m2[2]}-${m2[1].padStart(2,'0')}-01`;
          else if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) result.pubdate = dateRaw.slice(0, 10);
        }
      }

      // Cover
      result.cover = info.image_url || info.thumbnail || info.cover_url || info.img || info.cover || info.image || info.thumb || '';
      if (!result.cover && info.id) {
        result.cover = `https://307a0e78.vws.vegacdn.vn/view/v2/image/img.book/0/0/1/${info.id}.jpg?v=1&w=480&h=700`;
      }

      // Translator
      if (info.translator || info.translator_name) {
        result.translator = info.translator_name || info.translator;
      }

      return result;
    } catch (e) {
      return null;
    }
  }

  // ── EXTRACT TỪ DOM (tăng cường mobile) ──────────────────────────────
  function extractMetadata() {
    const nuxt = readNuxtData();
    const meta = {};

    // ── TITLE ────────────────────────────────────────────────────────
    const cleanBookTitle = (s) =>
      String(s || '')
        .replace(/^Đọc[\s_]*sách[\s_]*[-–:_]*[\s_]*/i, '')
        .replace(/\s*[-–]\s*.*Waka.*$/i, '')
        .replace(/\s*-\s*Thư viện ebook Waka\s*$/i, '')
        .replace(/\s*-\s*[^-]+$/, '')
        .trim();

    const h1El = document.querySelector('h1.text-white-50, h1, .book-title, [class*="title"]');
    if (h1El && h1El.textContent.trim().length > 2) {
      meta.title = cleanBookTitle(h1El.textContent.trim());
    } else if (nuxt?.title) {
      meta.title = cleanBookTitle(nuxt.title);
    } else {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const raw = ogTitle ? ogTitle.content : document.title;
      meta.title = cleanBookTitle(raw);
    }

    // ── AUTHOR ───────────────────────────────────────────────────────
    meta.authors = [];

    // 1. Link /author/
    document.querySelectorAll('a[href*="/author/"]').forEach((a) => {
      const name = a.textContent.trim();
      if (name && name.length < 60 && !meta.authors.includes(name)) meta.authors.push(name);
    });

    // 2. Dropdown selected (desktop)
    if (meta.authors.length === 0) {
      document.querySelectorAll('.el-select-dropdown__item.selected a').forEach((a) => {
        if ((a.getAttribute('href') || '').includes('/author/')) {
          const name = a.textContent.trim();
          if (name && !meta.authors.includes(name)) meta.authors.push(name);
        }
      });
    }

    // 3. Label "Tác giả" (desktop p.text-white-400)
    if (meta.authors.length === 0) {
      document.querySelectorAll('p.text-white-400, span, div, p, label').forEach((label) => {
        const t = (label.textContent || '').trim();
        if (t === 'Tác giả') {
          const parentDiv = label.closest('div') || label.parentElement;
          if (parentDiv) {
            parentDiv.querySelectorAll('a').forEach((a) => {
              const name = a.textContent.trim();
              if (name && !meta.authors.includes(name)) meta.authors.push(name);
            });
            if (meta.authors.length === 0) {
              const p = parentDiv.querySelector('p.text-white-50, span, strong, b');
              if (p) p.textContent.trim().split(/[,&]/).forEach(n => {
                const name = n.trim();
                if (name && name !== 'Tác giả') meta.authors.push(name);
              });
            }
          }
        }
      });
    }

    // 4. Mobile: text dạng "Tác giả: Clara Wynne" hoặc "Tác giả Clara Wynne"
    if (meta.authors.length === 0) {
      const allTextEls = document.querySelectorAll('p, div, span, h2, h3, a');
      for (const el of allTextEls) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        // Chỉ lấy node gần lá (tránh lấy cả khối lớn)
        if (t.length > 80 || t.length < 8) continue;
        const m = t.match(/^Tác giả\s*[:：]\s*(.+)$/i) || t.match(/^Tác giả\s+(.+)$/i);
        if (m) {
          const names = m[1].split(/[,&]/).map(s => s.trim()).filter(Boolean);
          names.forEach(n => {
            if (n && !meta.authors.includes(n) && n.length < 50) meta.authors.push(n);
          });
          if (meta.authors.length) break;
        }
      }
    }

    // 5. Fallback __NUXT__
    if (meta.authors.length === 0 && nuxt?.authors?.length) {
      meta.authors = nuxt.authors.slice();
    }

    // ── PUBLISHER / PUBDATE / TRANSLATOR ────────────────────────────
    const labels = document.querySelectorAll('p.text-white-400, span, div, p, label');
    labels.forEach((label) => {
      const text = (label.textContent || '').trim();
      const parentDiv = label.closest('div') || label.parentElement;
      const valEl = parentDiv?.querySelector('p.text-white-50, span:not(:first-child), strong, b') ||
                    (label.nextElementSibling);

      if ((text === 'Nhà xuất bản' || text.startsWith('Nhà xuất bản')) && valEl) {
        const v = valEl.textContent.trim().replace(/^Nhà xuất bản\s*[:：]?\s*/i, '');
        if (v && v !== 'Đang cập nhật' && v.length < 80) meta.publisher = v;
      }
      if ((text === 'Phát hành' || text.startsWith('Phát hành')) && valEl) {
        const raw = valEl.textContent.trim().replace(/^Phát hành\s*[:：]?\s*/i, '');
        meta.pubdate_raw = raw;
        const parts = raw.split(/[\/\-]/);
        if (parts.length === 3) {
          const [dd, mm, yyyy] = parts;
          if (yyyy && yyyy.length === 4) meta.pubdate = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
        }
      }
      if ((text === 'Dịch giả' || text.startsWith('Dịch giả')) && valEl) {
        meta.translator = valEl.textContent.trim().replace(/^Dịch giả\s*[:：]?\s*/i, '');
      }
    });

    // Mobile-style "Nhà xuất bản: XXX" / "Phát hành: dd/mm/yyyy"
    if (!meta.publisher || !meta.pubdate_raw) {
      document.querySelectorAll('p, div, span').forEach((el) => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length > 100 || t.length < 5) return;
        if (!meta.publisher) {
          const m = t.match(/^Nhà xuất bản\s*[:：]\s*(.+)$/i);
          if (m && m[1] !== 'Đang cập nhật') meta.publisher = m[1].trim();
        }
        if (!meta.pubdate_raw) {
          const m = t.match(/^Phát hành\s*[:：]\s*(.+)$/i);
          if (m) {
            meta.pubdate_raw = m[1].trim();
            const parts = meta.pubdate_raw.split(/[\/\-]/);
            if (parts.length === 3 && parts[2].length === 4) {
              meta.pubdate = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
            }
          }
        }
        if (!meta.translator) {
          const m = t.match(/^Dịch giả\s*[:：]\s*(.+)$/i);
          if (m) meta.translator = m[1].trim();
        }
      });
    }

    // Fallback __NUXT__
    if (!meta.publisher && nuxt?.publisher) meta.publisher = nuxt.publisher;
    if (!meta.pubdate && nuxt?.pubdate) meta.pubdate = nuxt.pubdate;
    if (!meta.pubdate_raw && nuxt?.pubdate_raw) meta.pubdate_raw = nuxt.pubdate_raw;
    if (!meta.translator && nuxt?.translator) meta.translator = nuxt.translator;

    // ── TAGS ─────────────────────────────────────────────────────────
    meta.tags = [];

    // Chỉ loại KHỚP ĐÚNG tên tác giả / NXB / dịch giả (không dùng includes)
    const excludeExact = new Set();
    (meta.authors || []).forEach(a => { const s = String(a).trim().toLowerCase(); if (s) excludeExact.add(s); });
    (nuxt?.authors || []).forEach(a => { const s = String(a).trim().toLowerCase(); if (s) excludeExact.add(s); });
    [meta.publisher, meta.translator, nuxt?.publisher, nuxt?.translator].forEach(v => {
      const s = String(v || '').trim().toLowerCase();
      if (s) excludeExact.add(s);
    });

    function isValidTag(t) {
      if (!t || typeof t !== 'string') return false;
      t = t.replace(/\s+/g, ' ').trim();
      if (t.length < 2 || t.length > 40) return false;
      const lower = t.toLowerCase();

      if (excludeExact.has(lower)) return false;

      // Giá / số thuần
      if (/\d[\d.,]*\s*đ/i.test(t) || /^\d+([.,]\d+)?%?$/.test(t)) return false;

      // UI extension + junk
      if (/đang\s*tìm\s*epub|close|cancel|save\s*area|copy\s*metadata|nhận\s*diện|lưu\s*vào\s*bộ\s*nhớ|tải\s*app|zalo|hỗ\s*trợ/i.test(t)) return false;

      // Hội viên / CTA / đánh giá / ranking
      if (/hội\s*viên|membership|premium|\bvip\b|chốt\s*đơn|rộp|khuyến\s*mãi|giảm\s*giá|freeship|đọc\s*thử|mua\s*sách|mua\s*ngay|xem\s*thêm|rút\s*gọn|bản\s*đầy\s*đủ|bản\s*tóm\s*tắt|top\s*xu\s*hướng|#\d+|đánh\s*giá|review|rating/i.test(t)) return false;

      if (/https?:|waka\.vn/i.test(t)) return false;
      if (/^(đọc|mua|tải|xem|thêm|đóng|mở|lưu|sao\s*chép|close|cancel|save|nxb)\b/i.test(t)) return false;

      return true;
    }

    function addTag(t) {
      t = (t || '').replace(/\s+/g, ' ').trim();
      // Bỏ prefix "Thể loại:"
      t = t.replace(/^thể\s*loại\s*[:：]?\s*/i, '').trim();
      if (isValidTag(t) && !meta.tags.includes(t)) meta.tags.push(t);
    }

    // 0. Ưu tiên __NUXT__ (thường chính xác nhất)
    if (nuxt?.tags?.length) {
      nuxt.tags.forEach(addTag);
    }

    // 1. Label "Thể loại" — desktop (p.text-white-400) + mobile text
    //    Lấy link/span kế bên, hoặc text sau dấu :
    document.querySelectorAll('p, span, div, label, dt, dd').forEach((el) => {
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw) return;

      // "Thể loại: Học tập - Hướng nghiệp"
      if (/^thể\s*loại\s*[:：]/i.test(raw) && raw.length < 80) {
        addTag(raw.replace(/^thể\s*loại\s*[:：]\s*/i, ''));
        return;
      }

      // Label đúng bằng "Thể loại"
      if (raw === 'Thể loại' || raw === 'Thể loại:') {
        const parent = el.closest('div') || el.parentElement;
        if (parent) {
          parent.querySelectorAll('a').forEach(a => {
            if (!(a.getAttribute('href') || '').includes('/author/')) addTag(a.textContent);
          });
          // Giá trị text (p.text-white-50 hoặc sibling)
          const val = parent.querySelector('p.text-white-50, dd, span') || el.nextElementSibling;
          if (val && val !== el) {
            const vt = (val.textContent || '').replace(/\s+/g, ' ').trim();
            // Chỉ lấy nếu ngắn (1-2 tag), không phải đoạn mô tả
            if (vt.length > 1 && vt.length < 60 && vt !== 'Thể loại') {
              vt.split(/[,;•|]/).forEach(part => addTag(part));
            }
          }
        }
      }
    });

    // 2. Dropdown selected (desktop)
    document.querySelectorAll('.el-select-dropdown__item.selected a').forEach((a) => {
      const href = (a.getAttribute('href') || '').toLowerCase();
      if (!href.includes('/author/')) addTag(a.textContent);
    });

    // 3. Mobile pills dưới nút Đọc thử / Mua sách
    //    Quét sibling container: các <a> ngắn không phải /author/
    if (meta.tags.length === 0) {
      const actionBtns = Array.from(document.querySelectorAll('button, a, div, span')).filter(el => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return /^(đọc\s*thử|mua\s*sách)$/i.test(t);
      });

      // Mở rộng scope: parent → parent.parent → next siblings
      const scopes = new Set();
      actionBtns.forEach(btn => {
        let p = btn.parentElement;
        for (let i = 0; i < 4 && p; i++) {
          scopes.add(p);
          p = p.parentElement;
        }
      });

      scopes.forEach(root => {
        root.querySelectorAll('a').forEach(a => {
          const href = (a.getAttribute('href') || '').toLowerCase();
          if (href.includes('/author/')) return;
          // Tránh link chính của sách hiện tại (title dài)
          const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length < 2 || t.length > 35) return;
          if (href && window.location.pathname && href.includes(window.location.pathname.split('/').pop()?.replace('.html',''))) return;
          addTag(t);
        });
      });
    }

    // 4. Fallback: mọi <a> có text ngắn + href chứa category / the-loai / chu-de
    if (meta.tags.length === 0) {
      document.querySelectorAll('a[href]').forEach(a => {
        const href = (a.getAttribute('href') || '').toLowerCase();
        if (href.includes('/author/')) return;
        if (!(href.includes('category') || href.includes('the-loai') || href.includes('chu-de') || href.includes('genre') || href.includes('cate='))) return;
        addTag(a.textContent);
      });
    }

    // Lọc lần cuối
    meta.tags = meta.tags.filter(isValidTag).slice(0, 8);

    // ── DESCRIPTION ──────────────────────────────────────────────────
    const descEl = document.querySelector('.check-des') ||
      document.querySelector('.text-16.text-white-50.text-justify') ||
      document.querySelector('[class*="des"]') ||
      document.querySelector('.book-description, .description');
    if (descEl) {
      meta.comments = descEl.innerText.trim()
        .replace(/\s*Rút gọn\s*$/i, '')
        .replace(/\s*Xem thêm\s*$/i, '')
        .trim();
    } else if (nuxt?.comments) {
      meta.comments = nuxt.comments;
    } else {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) meta.comments = ogDesc.content.trim();
    }

    // ── COVER ────────────────────────────────────────────────────────
    let coverImg = document.querySelector('div.pt-full-265-388 img') ||
                   document.querySelector('img[src*="img.book"]') ||
                   document.querySelector('img[src*="image-shop.waka"]') ||
                   document.querySelector('img[src*="vegacdn"]') ||
                   document.querySelector('.book-cover img, [class*="cover"] img');
    // Ưu tiên ảnh lớn
    if (!coverImg) {
      const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
        const s = img.src || '';
        return (s.includes('book') || s.includes('cover') || s.includes('vegacdn') || s.includes('image-shop')) && img.naturalWidth !== 1;
      });
      if (imgs.length) coverImg = imgs[0];
    }
    if (coverImg) {
      meta.cover = (coverImg.src || coverImg.getAttribute('data-src') || '').replace(/&amp;/g, '&');
    } else if (nuxt?.cover) {
      meta.cover = nuxt.cover;
    } else {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) meta.cover = ogImg.content.replace(/&amp;/g, '&');
    }

    // ── LANGUAGE / SOURCE ────────────────────────────────────────────
    meta.language = document.documentElement.lang || 'vi';
    meta.source_url = window.location.href;
    const urlMatch = window.location.pathname.match(/([A-Za-z0-9]+)(?:\.html)?$/);
    if (urlMatch) meta.waka_id = urlMatch[1];

    return meta;
  }

  // ── POPUP ────────────────────────────────────────────────────────────
  function showPopup(meta) {
    document.getElementById('wdl-meta-popup')?.remove();
    document.getElementById('wdl-meta-toast')?.remove();

    const esc = s => String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const pubLine = [meta.publisher, meta.pubdate_raw].filter(Boolean).join(' · ');
    const mobile = isMobile();

    const popup = document.createElement('div');
    popup.id = 'wdl-meta-popup';

    if (mobile) {
      // Mobile: panel inline ngay dưới nút, full-width trong luồng trang
      popup.style.cssText = `
        position:relative;z-index:2147483647;width:100%;max-width:100%;
        margin:8px 0 12px;background:#0f0f11;border:1px solid #2a2a35;
        border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.5);
        font-family:"Segoe UI",system-ui,sans-serif;font-size:12px;
        color:#f0ede8;overflow:hidden;box-sizing:border-box;
      `;
    } else {
      // Desktop: fixed top-right như cũ
      popup.style.cssText = `
        position:fixed;top:16px;right:16px;z-index:2147483647;
        width:340px;background:#0f0f11;border:1px solid #2a2a35;
        border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.6);
        font-family:"Segoe UI",system-ui,sans-serif;font-size:12px;
        color:#f0ede8;overflow:hidden;
      `;
    }

    popup.innerHTML = `
      <div style="background:#1a1a1f;padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2a2a35;">
        <div style="background:#e85d26;color:#fff;font-weight:700;font-size:13px;width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">W</div>
        <div>
          <div style="font-size:13px;font-weight:600;">Metadata đã nhận diện</div>
          <div style="font-size:10px;color:#888;">waka.vn/ebook/</div>
        </div>
        <button id="wdl-meta-close" style="margin-left:auto;background:none;border:none;color:#888;font-size:16px;cursor:pointer;padding:2px 4px;line-height:1;">✕</button>
      </div>

      <!-- Book header: cover + info -->
      <div style="display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid #1e1e28;">
        <div style="flex-shrink:0;">
          ${meta.cover
            ? `<img src="${esc(meta.cover)}" style="width:60px;height:86px;object-fit:cover;border-radius:4px;border:1px solid #2a2a35;" onerror="this.style.display='none'">`
            : `<div style="width:60px;height:86px;background:#1a1a1f;border:1px solid #2a2a35;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:22px;">📖</div>`
          }
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;line-height:1.4;margin-bottom:4px;">${esc(meta.title)||'—'}</div>
          <div style="color:#f07040;font-size:11px;margin-bottom:3px;">${esc((meta.authors||[]).join(', '))||'Không rõ tác giả'}</div>
          <div style="color:#888;font-size:10px;">${esc(pubLine)||'—'}</div>
        </div>
      </div>

      <!-- Metadata rows -->
      <div style="padding:8px 14px;border-bottom:1px solid #1e1e28;">
        <div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid #1e1e28;">
          <div style="width:90px;flex-shrink:0;color:#888;font-size:11px;padding-top:1px;">Thể loại</div>
          <div style="flex:1;font-size:11px;line-height:1.5;">
            ${meta.tags?.length
              ? meta.tags.map(t=>`<span style="display:inline-block;background:#2a1a10;border:1px solid #e85d26;color:#f07040;border-radius:4px;padding:1px 6px;font-size:10px;margin:1px 2px 1px 0;">${esc(t)}</span>`).join('')
              : '<span style="color:#555;">—</span>'
            }
          </div>
        </div>
        ${meta.translator ? `
        <div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid #1e1e28;">
          <div style="width:90px;flex-shrink:0;color:#888;font-size:11px;padding-top:1px;">Dịch giả</div>
          <div style="flex:1;font-size:11px;">${esc(meta.translator)}</div>
        </div>` : ''}
        <div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid #1e1e28;">
          <div style="width:90px;flex-shrink:0;color:#888;font-size:11px;padding-top:1px;">Ngôn ngữ</div>
          <div style="flex:1;font-size:11px;">${esc(meta.language||'vi')}</div>
        </div>
        <div style="display:flex;gap:6px;padding:4px 0;">
          <div style="width:90px;flex-shrink:0;color:#888;font-size:11px;padding-top:1px;">Nguồn</div>
          <div style="flex:1;font-size:10px;color:#888;word-break:break-all;">${esc(meta.source_url||'—')}</div>
        </div>
      </div>

      <!-- Description -->
      ${meta.comments ? `
      <div style="padding:8px 14px;border-bottom:1px solid #1e1e28;">
        <div style="color:#888;font-size:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em;">Giới thiệu</div>
        <div style="font-size:11px;line-height:1.6;max-height:80px;overflow-y:auto;color:#d0cdc8;scrollbar-width:thin;">${esc(meta.comments)}</div>
      </div>` : ''}

      <!-- Actions -->
      <div style="padding:10px 14px;display:flex;gap:8px;">
        <button id="wdl-meta-save" style="flex:1;padding:9px 0;background:#e85d26;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;transition:opacity .15s;">
          💾 Lưu vào bộ nhớ trình duyệt
        </button>
        <button id="wdl-meta-copy" style="padding:9px 12px;background:#1a1a1f;border:1px solid #2a2a35;color:#ccc;border-radius:7px;font-size:12px;cursor:pointer;" title="Copy JSON">📋</button>
      </div>
      <div id="wdl-meta-status" style="padding:0 14px 10px;font-size:11px;display:none;line-height:1.5;"></div>
    `;

    // Mobile: chèn panel ngay dưới wrapper của nút; Desktop: append body
    if (mobile) {
      const btnWrapper = document.getElementById('wdl-book-detect-btn')?.closest('#wdl-meta-btn-wrapper') ||
                         document.getElementById('wdl-book-detect-btn')?.parentElement;
      if (btnWrapper) {
        btnWrapper.insertAdjacentElement('afterend', popup);
      } else {
        document.body.appendChild(popup);
      }
    } else {
      document.body.appendChild(popup);
    }

    const toast = document.createElement('div');
    toast.id = 'wdl-meta-toast';
    toast.style.cssText = `position:fixed;bottom:80px;right:20px;z-index:2147483647;
      background:#4caf7d;color:#fff;font-size:12px;font-weight:600;
      padding:8px 18px;border-radius:20px;pointer-events:none;
      opacity:0;transition:opacity .25s;font-family:system-ui,sans-serif;
      box-shadow:0 4px 16px rgba(0,0,0,.4);white-space:nowrap;`;
    document.body.appendChild(toast);

    function showToast(msg, color = '#4caf7d') {
      toast.textContent = msg;
      toast.style.background = color;
      toast.style.opacity = '1';
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
    }
    function setStatus(msg, color = '#888') {
      const el = document.getElementById('wdl-meta-status');
      if (!el) return;
      el.textContent = msg;
      el.style.color = color;
      el.style.display = msg ? 'block' : 'none';
    }

    document.getElementById('wdl-meta-close').onclick = () => { popup.remove(); toast.remove(); };

    document.getElementById('wdl-meta-save').onclick = async () => {
      const btn = document.getElementById('wdl-meta-save');
      btn.disabled = true;
      btn.textContent = '⏳ Đang lưu...';
      setStatus('Đang lưu metadata...');
      try {
        await window.WakaMetaInjector.saveMeta(meta);
        setStatus('✅ Đã lưu! Khi tải EPUB trên trang này, metadata + ảnh bìa sẽ tự động được nhúng vào.', '#4caf7d');
        btn.textContent = '✅ Đã lưu!';
        btn.style.background = '#28a745';
        window.dispatchEvent(new CustomEvent('__wdl_meta_updated__'));
        showToast('✅ Metadata đã lưu — sẵn sàng nhúng vào EPUB!');
      } catch (e) {
        setStatus('❌ Lỗi: ' + e.message, '#f88');
        btn.disabled = false;
        btn.textContent = '💾 Lưu vào bộ nhớ trình duyệt';
      }
    };

    document.getElementById('wdl-meta-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(meta, null, 2));
        showToast('✅ Đã copy JSON metadata!');
      } catch { showToast('⚠ Không copy được', '#e85d26'); }
    };
  }

  // ── TÌM CONTAINER DÒNG TÁC GIẢ (dùng cho mobile) ───────────────────
  function findAuthorLine() {
    // 1. Label "Tác giả" chuẩn (desktop & một số layout mobile)
    let label = null;
    document.querySelectorAll('p.text-white-400, span, div, p').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (t === 'Tác giả' || t.startsWith('Tác giả:') || t.startsWith('Tác giả ')) {
        if (!label || el.textContent.length < label.textContent.length) label = el;
      }
    });
    if (label) {
      // Ưu tiên container gần nhất chứa nhiều nhất có thể
      return label.closest('div') || label.parentElement || label;
    }

    // 2. Fallback: tìm text chứa chứa "Tác giả: Tên"
    const candidates = Array.from(document.querySelectorAll('p, div, span, a'));
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (/^Tác giả\s*[:：]/.test(t) && t.length < 80) {
        return el.closest('div') || el.parentElement || el;
      }
    }
    return null;
  }

  // ── INJECT NÚT "Copy metadata" / "Nhận diện metadata" ───────────────
  function injectDetectButton() {
    if (document.getElementById('wdl-book-detect-btn')) return true;

    const mobile = isMobile();
    let insertAfter = null;

    if (mobile) {
      // Mobile: đặt nút ngay dưới dòng tác giả
      insertAfter = findAuthorLine();
    }

    // Fallback / Desktop: sau h1 title (ebook + shop)
    if (!insertAfter) {
      insertAfter = document.querySelector('h1.title-product, h1.text-white-50, h1');
    }
    if (!insertAfter) return false;

    const wrapper = document.createElement('div');
    wrapper.id = 'wdl-meta-btn-wrapper';
    wrapper.style.cssText = mobile
      ? 'margin:8px 0 4px;display:flex;align-items:center;gap:8px;width:100%;'
      : 'margin-top:10px;display:inline-flex;align-items:center;gap:8px;';

    const btn = document.createElement('button');
    btn.id = 'wdl-book-detect-btn';
    btn.innerHTML = mobile
      ? `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy metadata
      `
      : `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Nhận diện metadata
      `;
    btn.style.cssText = `
      display:inline-flex;align-items:center;gap:6px;
      padding:6px 14px;background:#e85d26;color:#fff;
      border:none;border-radius:7px;font-size:12px;font-weight:700;
      cursor:pointer;font-family:inherit;
      box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .15s;
    `;
    btn.onmouseenter = () => { btn.style.opacity = '0.85'; };
    btn.onmouseleave = () => { btn.style.opacity = '1'; };

    btn.addEventListener('click', () => {
      // Toggle: nếu panel đang mở thì đóng
      const existing = document.getElementById('wdl-meta-popup');
      if (existing) {
        existing.remove();
        document.getElementById('wdl-meta-toast')?.remove();
        return;
      }
      const meta = extractMetadata();
      showPopup(meta);
    });

    wrapper.appendChild(btn);
    insertAfter.insertAdjacentElement('afterend', wrapper);
    return true;
  }

  function waitAndInject() {
    // Xóa nút + panel cũ nếu có
    document.getElementById('wdl-meta-popup')?.remove();
    document.getElementById('wdl-meta-toast')?.remove();
    document.getElementById('wdl-meta-btn-wrapper')?.remove();
    document.getElementById('wdl-book-detect-btn')?.closest('div')?.remove();

    if (injectDetectButton()) return;

    let done = false;
    const obs = new MutationObserver(() => {
      if (done) return;
      if (injectDetectButton()) { done = true; obs.disconnect(); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const iv = setInterval(() => {
      if (done) { clearInterval(iv); return; }
      if (injectDetectButton()) { done = true; clearInterval(iv); obs.disconnect(); }
    }, 400);
    setTimeout(() => { if (!done) { clearInterval(iv); obs.disconnect(); } }, 15000);
  }

  waitAndInject();

  // SPA navigation
  const _orig = history.pushState.bind(history);
  history.pushState = function (...args) {
    _orig(...args);
    setTimeout(waitAndInject, 600);
  };
  window.addEventListener('popstate', () => setTimeout(waitAndInject, 600));

  // Re-inject khi xoay màn hình / đổi kích thước (mobile ↔ desktop)
  let _lastMobile = isMobile();
  window.addEventListener('resize', () => {
    const nowMobile = isMobile();
    if (nowMobile !== _lastMobile) {
      _lastMobile = nowMobile;
      setTimeout(waitAndInject, 300);
    }
  });

  // Expose for one-click download from ebook-content.js
  window.WakaBookMeta = {
    extract: extractMetadata,
    saveCurrent: async function () {
      const meta = extractMetadata();
      if (!meta || !meta.title) throw new Error('Không extract được metadata');
      await window.WakaMetaInjector.saveMeta(meta);
      return meta;
    }
  };
})();

// ── TỰ ĐỘNG MỞ RỘNG MÔ TẢ SÁCH ─────────────────────────────────────────────
(function autoExpandDescription() {
  function tryExpand() {
    // Nút "... Xem thêm" — class read-more, nằm trong .check-des
    const readMoreBtn = document.querySelector('.read-more');
    if (readMoreBtn && readMoreBtn.offsetParent !== null) {
      readMoreBtn.click();
      console.log('[Waka DL] Đã tự động mở rộng mô tả sách.');
      return true;
    }
    return false;
  }

  if (tryExpand()) return;

  // Chờ Vue render xong
  let attempts = 0;
  const iv = setInterval(() => {
    attempts++;
    if (tryExpand() || attempts > 30) clearInterval(iv);
  }, 300);
})();
