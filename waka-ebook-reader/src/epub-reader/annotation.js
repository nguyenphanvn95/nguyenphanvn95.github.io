// annotation.js — Tính năng "GHI CHÚ" (Annotation) kiểu flowoss.
//
// Toàn bộ logic riêng cho tính năng bôi chọn văn bản / tạo highlight / ghi chú:
//   - Bôi chọn trong nội dung chương (bên trong #book-frame) -> hiện popup chọn
//     LOẠI (Từ vựng / Ghi chú) + màu + nhập ghi chú -> lưu vào IndexedDB qua
//     BookDB.addAnnotation. Toggle "Từ vựng / Ghi chú" tự gợi ý sẵn theo số từ
//     bôi chọn (guessType) nhưng người dùng luôn bấm đổi được trước khi lưu —
//     đây là nút "lưu từ vựng" mà trước đây popup còn thiếu (guessType tự
//     quyết ngầm, không có cách nào chủ động chọn).
//   - Khôi phục lại highlight mỗi khi chương được dựng lại (renderChapter tạo
//     mới hoàn toàn nội dung iframe) bằng "text anchor" (prefix + quote + suffix
//     + charStart), KHÔNG dùng DOM path cố định.
//   - Sửa / xoá annotation bằng cách bấm vào đoạn <mark> đang hiển thị; ở popup
//     sửa cũng đổi được loại Từ vựng <-> Ghi chú bất cứ lúc nào.
//   - Bảng sidebar "GHI CHÚ" gồm 2 khối "TỪ VỰNG" (definition) / "GHI CHÚ"
//     (annotation), nhóm theo chương, bấm vào 1 mục thì nhảy tới đúng vị trí.
//
// Chạy sau app.js + reader-ui.js, dùng window.ReaderApp (đã được app.js bổ
// sung 1 số hàm/biến nội bộ dành riêng cho module này — xem "phần thêm cho
// Annotation" trong app.js). Gắn kết quả vào window.ReaderAnnotations, được
// app.js gọi lại (hook onChapterRendered) ngay sau khi renderChapter() dựng
// xong 1 chương.
//
// KHÔNG đụng tới panel "marks" (bookmark vị trí trang) — đó là tính năng khác.

(() => {
  "use strict";

  const readerView = document.getElementById("reader-view");
  if (!readerView) return; // trang không có khung đọc (vd trang thư viện độc lập)

  const app = () => window.ReaderApp || {};
  const esc = (s) => (app().escapeHtml ? app().escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s));

  /* ---------------------------------------------------------- hằng số */

  // 4 màu highlight preset (dạng nút "A"), tham khảo đúng bố cục flowoss:
  // đỏ nhạt/salmon, hồng nhạt, xanh lá nhạt, và 1 màu mặc định nhạt hơn.
  // Chọn tông pastel để hài hoà với cả 5 theme đọc hiện có (sáng lẫn tối).
  const HIGHLIGHT_COLORS = ["#eab6a0", "#f0c9d6", "#c3e2bb", "#ddd0bb"];
  const DEFAULT_COLOR_INDEX = 3;

  const PREFIX_LEN = 32;
  const SUFFIX_LEN = 32;
  const DEFINITION_MAX_WORDS = 3; // bôi chọn ≤ 3 từ -> tự động xếp vào "TỪ VỰNG"

  const MARK_STYLE_ID = "rd-annotation-inline-style";
  const FLASH_CLASS = "rd-annotation-flash";

  /* ---------------------------------------------------------- dom refs (parent document) */

  const $ = (sel) => document.querySelector(sel);

  const railBtn = $("#rd-rail-annotation");
  const defListEl = $("#rd-ann-def-list");
  const defEmptyEl = $("#rd-ann-def-empty");
  const defBadgeEl = $("#rd-ann-def-badge");
  const noteListEl = $("#rd-ann-note-list");
  const noteEmptyEl = $("#rd-ann-note-empty");
  const noteBadgeEl = $("#rd-ann-note-badge");
  const sashEl = $("#rd-ann-sash");
  const defBlockEl = $("#rd-ann-block-def");

  /* ---------------------------------------------------------- state của module */

  let currentBookId = null;
  let annotationsCache = []; // toàn bộ annotations của sách đang mở
  let currentDraft = null; // { mode: "create"|"edit", ... }
  let selectedColorIndex = DEFAULT_COLOR_INDEX;
  let pendingFocusId = null; // annotation cần cuộn/lật tới sau khi renderChapter xong

  /* ---------------------------------------------------------- popup (sống trong parent document) */

  // Toggle loại lưu: "definition" (Từ vựng, xếp vào khối TỪ VỰNG bên sidebar)
  // hay "annotation" (Ghi chú thường, xếp vào khối GHI CHÚ). Trước đây việc
  // này chỉ được ĐOÁN ngầm theo số từ bôi chọn (guessType), người dùng không
  // có cách nào chủ động bấm "lưu vào từ vựng" — đây chính là nút còn thiếu.
  const popupEl = document.createElement("div");
  popupEl.className = "rd-ann-popup hidden";
  popupEl.innerHTML = `
    <div class="rd-ann-type-toggle" role="tablist">
      <button type="button" class="rd-ann-type-btn" data-type="definition" role="tab">Từ vựng</button>
      <button type="button" class="rd-ann-type-btn" data-type="annotation" role="tab">Ghi chú</button>
    </div>
    <textarea class="rd-ann-textarea" placeholder="Ghi chú (không bắt buộc)…"></textarea>
    <div class="rd-ann-colors">
      ${HIGHLIGHT_COLORS.map((c, i) => `<button type="button" class="rd-ann-color-btn" data-color-index="${i}" style="background:${c}">A</button>`).join("")}
    </div>
    <div class="rd-ann-actions">
      <button type="button" class="rd-ann-btn rd-ann-btn-delete hidden">Xoá</button>
      <button type="button" class="rd-ann-btn rd-ann-btn-primary">Lưu từ vựng</button>
    </div>
  `;
  document.body.appendChild(popupEl);

  const popupTextarea = popupEl.querySelector(".rd-ann-textarea");
  const popupColorBtns = Array.from(popupEl.querySelectorAll(".rd-ann-color-btn"));
  const popupTypeBtns = Array.from(popupEl.querySelectorAll(".rd-ann-type-btn"));
  const popupDeleteBtn = popupEl.querySelector(".rd-ann-btn-delete");
  const popupSaveBtn = popupEl.querySelector(".rd-ann-btn-primary");

  let selectedType = "definition"; // "definition" | "annotation" — người dùng chọn qua toggle

  popupColorBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedColorIndex = Number(btn.dataset.colorIndex) || 0;
      syncColorButtons();
    });
  });

  popupTypeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedType = btn.dataset.type === "annotation" ? "annotation" : "definition";
      syncTypeButtons();
    });
  });

  function syncColorButtons() {
    popupColorBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.colorIndex) === selectedColorIndex));
  }

  function syncTypeButtons() {
    popupTypeBtns.forEach((b) => b.classList.toggle("active", b.dataset.type === selectedType));
    const isEdit = currentDraft && currentDraft.mode === "edit";
    const verb = isEdit ? "Cập nhật" : "Lưu";
    popupSaveBtn.textContent = selectedType === "definition" ? `${verb} từ vựng` : `${verb} ghi chú`;
  }

  function showPopupEl() { popupEl.classList.remove("hidden"); }
  function closePopup() {
    popupEl.classList.add("hidden");
    currentDraft = null;
  }

  // click ra ngoài popup -> đóng
  document.addEventListener("mousedown", (e) => {
    if (popupEl.classList.contains("hidden")) return;
    if (popupEl.contains(e.target)) return;
    closePopup();
  });
  // resize cửa sổ -> đóng (toạ độ popup có thể sai)
  window.addEventListener("resize", closePopup);
  // cuộn trang / lật trang / đổi chương đều phát sự kiện "reader:location" -> đóng
  document.addEventListener("reader:location", closePopup);

  function positionPopupFromRect(rect) {
    const bookFrame = app().bookFrame;
    if (!bookFrame) return;
    const frameRect = bookFrame.getBoundingClientRect();
    const popupWidth = 240;
    const popupHeightGuess = 248; // + hàng toggle Từ vựng/Ghi chú thêm ở đầu popup
    let left = frameRect.left + rect.left;
    let top = frameRect.top + rect.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
    if (top + popupHeightGuess > window.innerHeight) {
      top = frameRect.top + rect.top - popupHeightGuess - 8; // không đủ chỗ dưới -> đặt lên trên vùng bôi chọn
      if (top < 8) top = 8;
    }
    popupEl.style.left = left + "px";
    popupEl.style.top = top + "px";
  }

  /* ---------------------------------------------------------- text anchor: chỉ mục ký tự <-> text node */

  function buildTextIndex(root) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let text = "";
    let n;
    while ((n = walker.nextNode())) {
      const val = n.nodeValue;
      if (!val) continue;
      nodes.push({ node: n, start: text.length, end: text.length + val.length });
      text += val;
    }
    return { text, nodes };
  }

  function charOffsetForNode(index, node, offsetInNode) {
    for (const item of index.nodes) {
      if (item.node === node) return item.start + offsetInNode;
    }
    return null;
  }

  function firstTextNodeIn(node, doc) {
    if (node.nodeType === 3) return node;
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    return walker.nextNode();
  }

  function lastTextNodeIn(node, doc) {
    if (node.nodeType === 3) return node;
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    let last = null;
    let n;
    while ((n = walker.nextNode())) last = n;
    return last;
  }

  /** Đưa 1 đầu mút Range (có thể là node phần tử) về đúng text node gần nhất. */
  function normalizeStart(container, offset, doc) {
    if (container.nodeType === 3) return { node: container, offset };
    const child = container.childNodes[offset] || container.childNodes[container.childNodes.length - 1];
    const t = child ? firstTextNodeIn(child, doc) : firstTextNodeIn(container, doc);
    return t ? { node: t, offset: 0 } : null;
  }

  function normalizeEnd(container, offset, doc) {
    if (container.nodeType === 3) return { node: container, offset };
    const child = container.childNodes[offset - 1] || container.childNodes[0];
    const t = child ? lastTextNodeIn(child, doc) : lastTextNodeIn(container, doc);
    return t ? { node: t, offset: t.nodeValue.length } : null;
  }

  function charOffsetsForRange(index, range) {
    const doc = range.startContainer.ownerDocument;
    const s = normalizeStart(range.startContainer, range.startOffset, doc);
    const e = normalizeEnd(range.endContainer, range.endOffset, doc);
    if (!s || !e) return null;
    const startChar = charOffsetForNode(index, s.node, s.offset);
    const endChar = charOffsetForNode(index, e.node, e.offset);
    if (startChar == null || endChar == null || endChar <= startChar) return null;
    return { startChar, endChar };
  }

  function rangeFromCharOffsets(doc, index, startChar, endChar) {
    const range = doc.createRange();
    let startSet = false;
    let endSet = false;
    for (const item of index.nodes) {
      if (!startSet && startChar >= item.start && startChar <= item.end) {
        range.setStart(item.node, startChar - item.start);
        startSet = true;
      }
      if (!endSet && endChar >= item.start && endChar <= item.end) {
        range.setEnd(item.node, endChar - item.start);
        endSet = true;
      }
      if (startSet && endSet) break;
    }
    if (!startSet || !endSet) return null;
    return range;
  }

  /**
   * Tìm lại vị trí (charStart/charEnd) của 1 annotation trong text thuần hiện
   * tại của chương, dùng prefix+quote+suffix; nếu có nhiều kết quả trùng thì
   * ưu tiên vị trí gần charStart đã lưu nhất. Fallback: chỉ tìm theo quote.
   */
  function locateAnnotationRange(index, ann) {
    const text = index.text;
    const quote = ann.quote || "";
    if (!quote) return null;

    function bestIndexOf(needle, offsetInsideNeedle) {
      let searchFrom = 0;
      let bestPos = -1;
      let bestDist = Infinity;
      for (;;) {
        const idx = text.indexOf(needle, searchFrom);
        if (idx === -1) break;
        const candidate = idx + offsetInsideNeedle;
        const dist = ann.charStart != null ? Math.abs(candidate - ann.charStart) : 0;
        if (dist < bestDist) { bestDist = dist; bestPos = candidate; }
        searchFrom = idx + 1;
      }
      return bestPos;
    }

    const pattern = (ann.prefix || "") + quote + (ann.suffix || "");
    let startChar = pattern ? bestIndexOf(pattern, (ann.prefix || "").length) : -1;
    if (startChar === -1) startChar = bestIndexOf(quote, 0);
    if (startChar === -1) return null;
    return { startChar, endChar: startChar + quote.length };
  }

  /* ---------------------------------------------------------- wrap Range thành <mark> */

  function getTextNodesInRange(range) {
    const doc = range.startContainer.ownerDocument;
    const root = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentNode;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (range.intersectsNode) return range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const out = [];
    let n;
    while ((n = walker.nextNode())) {
      let start = 0;
      let end = n.nodeValue.length;
      if (n === range.startContainer) start = range.startOffset;
      if (n === range.endContainer) end = range.endOffset;
      if (start < end) out.push({ node: n, start, end });
    }
    return out;
  }

  /**
   * Bọc 1 Range (có thể xuyên qua nhiều text node/thẻ) thành các <mark
   * class="rd-annotation">. KHÔNG dùng Range.surroundContents() trực tiếp
   * trên range gốc (lỗi khi range chứa nhiều phần tử) — bọc từng đoạn text
   * node nằm trong range.
   */
  function wrapRangeAcrossNodes(range, annotationId, color) {
    const doc = range.startContainer.ownerDocument;
    const pieces = getTextNodesInRange(range);
    const marks = [];
    pieces.forEach(({ node, start, end }) => {
      if (start >= end) return;
      const subRange = doc.createRange();
      try {
        subRange.setStart(node, start);
        subRange.setEnd(node, end);
        const mark = doc.createElement("mark");
        mark.className = "rd-annotation";
        mark.dataset.annotationId = annotationId;
        mark.style.background = color;
        subRange.surroundContents(mark);
        marks.push(mark);
      } catch (err) {
        console.warn("Annotation: không thể bọc 1 đoạn văn bản cho ghi chú", annotationId, err);
      }
    });
    return marks;
  }

  function removeAllMarksFromDom(wrap) {
    if (!wrap) return;
    const marks = Array.from(wrap.querySelectorAll("mark.rd-annotation"));
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  /* ---------------------------------------------------------- style highlight trong iframe */

  function ensureMarkStyle(fd) {
    if (!fd || !fd.head || fd.getElementById(MARK_STYLE_ID)) return;
    const t = (app().themeVars ? app().themeVars() : null) || { link: "#c17a4f" };
    const style = fd.createElement("style");
    style.id = MARK_STYLE_ID;
    style.textContent = `
      mark.rd-annotation {
        cursor: pointer;
        border-radius: 2px;
        padding: 0 1px;
        color: #2b2b28;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }
      mark.rd-annotation:hover { box-shadow: 0 0 0 1px ${t.link}; }
      mark.rd-annotation.${FLASH_CLASS} { animation: rd-annotation-flash 1.1s ease; }
      @keyframes rd-annotation-flash {
        0% { box-shadow: 0 0 0 3px ${t.link}; }
        100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
      }
    `;
    fd.head.appendChild(style);
  }

  /* ---------------------------------------------------------- áp dụng annotation cho 1 chương */

  function getAnnotationsForSpine(spineIndex) {
    return annotationsCache.filter((a) => a.spineIndex === spineIndex);
  }

  async function applyAnnotationsToChapter(spineIndex) {
    const fd = app().frameDoc ? app().frameDoc() : null;
    const wrap = fd ? fd.getElementById("page-wrap") : null;
    if (!fd || !wrap) return;

    ensureMarkStyle(fd);
    removeAllMarksFromDom(wrap); // phòng khi hàm được gọi lại nhiều lần cho cùng 1 DOM

    const list = getAnnotationsForSpine(spineIndex);
    if (!list.length) return;

    // xử lý theo thứ tự charStart để việc bọc <mark> lồng nhau khó xảy ra hơn
    const sorted = list.slice().sort((a, b) => (a.charStart || 0) - (b.charStart || 0));
    for (const ann of sorted) {
      // dựng lại chỉ mục mỗi lần: nội dung text thuần không đổi sau khi bọc <mark>
      // (chỉ tham chiếu text node bị tách ra), nên vẫn khớp đúng vị trí cho các
      // annotation tiếp theo — làm vậy để tránh lệch offset do DOM đã bị chỉnh sửa.
      const index = buildTextIndex(wrap);
      const loc = locateAnnotationRange(index, ann);
      if (!loc) {
        console.warn("Annotation: không tìm thấy vị trí khớp trong chương (nội dung có thể đã đổi):", ann.id);
        continue;
      }
      const range = rangeFromCharOffsets(fd, index, loc.startChar, loc.endChar);
      if (!range) continue;
      wrapRangeAcrossNodes(range, ann.id, ann.color || HIGHLIGHT_COLORS[DEFAULT_COLOR_INDEX]);
    }
  }

  /* ---------------------------------------------------------- bôi chọn -> popup tạo mới */

  function isRangeInsideWrap(fd, range) {
    const wrap = fd.getElementById("page-wrap");
    return !!(wrap && wrap.contains(range.commonAncestorContainer));
  }

  function openCreatePopup(range) {
    const fd = app().frameDoc();
    const wrap = fd.getElementById("page-wrap");
    if (!wrap) return;
    const index = buildTextIndex(wrap);
    const offsets = charOffsetsForRange(index, range);
    if (!offsets) return;
    const { startChar, endChar } = offsets;
    const quote = index.text.slice(startChar, endChar);
    if (!quote.trim()) return;

    const prefix = index.text.slice(Math.max(0, startChar - PREFIX_LEN), startChar);
    const suffix = index.text.slice(endChar, endChar + SUFFIX_LEN);

    currentDraft = {
      mode: "create",
      spineIndex: app().getSpineIndex(),
      startChar,
      endChar,
      quote,
      prefix,
      suffix,
    };
    selectedColorIndex = DEFAULT_COLOR_INDEX;
    // gợi ý sẵn loại theo số từ bôi chọn (bôi 1 từ / cụm ngắn -> mặc định Từ
    // vựng), nhưng người dùng vẫn bấm đổi được qua toggle trước khi lưu.
    selectedType = guessType(quote);
    popupTextarea.value = "";
    popupDeleteBtn.classList.add("hidden");
    syncColorButtons();
    syncTypeButtons();

    const rect = range.getBoundingClientRect();
    positionPopupFromRect(rect);
    showPopupEl();
    popupTextarea.focus();
  }

  function colorIndexForHex(hex) {
    const idx = HIGHLIGHT_COLORS.findIndex((c) => c.toLowerCase() === String(hex || "").toLowerCase());
    return idx >= 0 ? idx : DEFAULT_COLOR_INDEX;
  }

  function openEditPopup(markEl) {
    const id = markEl.dataset.annotationId;
    const ann = annotationsCache.find((a) => a.id === id);
    if (!ann) return;

    currentDraft = { mode: "edit", id: ann.id, spineIndex: ann.spineIndex };
    selectedColorIndex = colorIndexForHex(ann.color);
    selectedType = ann.type === "annotation" ? "annotation" : "definition";
    popupTextarea.value = ann.note || "";
    popupDeleteBtn.classList.remove("hidden");
    syncColorButtons();
    syncTypeButtons();

    positionPopupFromRect(markEl.getBoundingClientRect());
    showPopupEl();
  }

  /* ---------------------------------------------------------- mouseup trong iframe */

  function onFrameMouseUp(e) {
    const fd = app().frameDoc();
    if (!fd) return;
    const sel = fd.getSelection ? fd.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (range.toString().trim().length > 0 && isRangeInsideWrap(fd, range)) {
        openCreatePopup(range.cloneRange());
        return;
      }
    }
    const mark = e.target && e.target.closest ? e.target.closest("mark.rd-annotation") : null;
    if (mark) {
      openEditPopup(mark);
      return;
    }
    closePopup();
  }

  function attachFrameSelectionHandlers() {
    const fd = app().frameDoc();
    if (!fd || !fd.body) return;
    fd.body.addEventListener("mouseup", onFrameMouseUp);
  }

  /* ---------------------------------------------------------- lưu / cập nhật / xoá */

  function guessType(quote) {
    const words = quote.trim().split(/\s+/).filter(Boolean);
    return words.length <= DEFINITION_MAX_WORDS ? "definition" : "annotation";
  }

  async function reapplyMarksForCurrentChapter() {
    const spineIndex = app().getSpineIndex ? app().getSpineIndex() : 0;
    await applyAnnotationsToChapter(spineIndex);
  }

  async function refreshAnnotationsCache(bookId) {
    const record = await BookDB.getBook(bookId);
    annotationsCache = (record && record.annotations) || [];
  }

  async function onSaveClick() {
    if (!currentDraft) return;
    const info = app().getBookInfo ? app().getBookInfo() : null;
    if (!info) return;
    const note = popupTextarea.value.trim();
    const color = HIGHLIGHT_COLORS[selectedColorIndex] || HIGHLIGHT_COLORS[DEFAULT_COLOR_INDEX];

    if (currentDraft.mode === "create") {
      const loc = app().getLocation ? app().getLocation() : null;
      const annotation = {
        id: "ann-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
        spineIndex: currentDraft.spineIndex,
        chapterTitle: (loc && loc.chapter) || "",
        quote: currentDraft.quote,
        prefix: currentDraft.prefix,
        suffix: currentDraft.suffix,
        charStart: currentDraft.startChar,
        color,
        note,
        type: selectedType,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await BookDB.addAnnotation(info.id, annotation);
    } else if (currentDraft.mode === "edit") {
      await BookDB.updateAnnotation(info.id, currentDraft.id, { color, note, type: selectedType, updatedAt: Date.now() });
    }

    closePopup();
    await refreshAnnotationsCache(info.id);
    await reapplyMarksForCurrentChapter();
    renderSidebar();
  }

  async function onDeleteClick() {
    if (!currentDraft || currentDraft.mode !== "edit") return;
    const info = app().getBookInfo ? app().getBookInfo() : null;
    if (!info) return;
    await BookDB.removeAnnotation(info.id, currentDraft.id);
    closePopup();
    await refreshAnnotationsCache(info.id);
    await reapplyMarksForCurrentChapter();
    renderSidebar();
  }

  popupSaveBtn.addEventListener("click", onSaveClick);
  popupDeleteBtn.addEventListener("click", onDeleteClick);

  /* ---------------------------------------------------------- điều hướng tới 1 annotation */

  function computePageForElement(bookFrame, wrap, target) {
    const pageWidth = bookFrame.clientWidth || 1;
    let offsetLeft = 0;
    let node = target;
    while (node && node !== wrap) {
      offsetLeft += node.offsetLeft || 0;
      node = node.offsetParent;
    }
    return Math.floor(offsetLeft / pageWidth);
  }

  function flashMark(mark) {
    mark.classList.remove(FLASH_CLASS);
    // ép reflow để có thể phát lại animation nếu bấm liên tiếp cùng 1 mục
    void mark.offsetWidth;
    mark.classList.add(FLASH_CLASS);
    setTimeout(() => mark.classList.remove(FLASH_CLASS), 1200);
  }

  function focusAnnotationInDom(id) {
    const fd = app().frameDoc ? app().frameDoc() : null;
    const wrap = fd ? fd.getElementById("page-wrap") : null;
    if (!fd || !wrap) return;
    const mark = fd.querySelector(`mark.rd-annotation[data-annotation-id="${CSS.escape(id)}"]`);
    if (!mark) return;

    const settings = app().getSettings ? app().getSettings() : {};
    if (settings.mode === "paginated") {
      const page = computePageForElement(app().bookFrame, wrap, mark);
      if (app().setPage) app().setPage(page);
    } else if (mark.scrollIntoView) {
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    flashMark(mark);
  }

  async function gotoAnnotation(id) {
    const ann = annotationsCache.find((a) => a.id === id);
    if (!ann) return;
    if (ann.spineIndex === (app().getSpineIndex ? app().getSpineIndex() : -1)) {
      focusAnnotationInDom(id);
      return;
    }
    pendingFocusId = id;
    await app().gotoLocation(ann.spineIndex, { restorePage: 0 });
  }

  /* ---------------------------------------------------------- bảng sidebar "GHI CHÚ" */

  function truncatePlain(s, max) {
    if (s.length <= max) return s;
    return s.slice(0, max - 1).trimEnd() + "…";
  }

  function buildChapterGroupsHtml(list) {
    if (!list.length) return "";
    const byChapter = new Map();
    list
      .slice()
      .sort((a, b) => (a.spineIndex - b.spineIndex) || ((a.charStart || 0) - (b.charStart || 0)))
      .forEach((a) => {
        const key = a.spineIndex + "::" + (a.chapterTitle || "");
        if (!byChapter.has(key)) {
          byChapter.set(key, { title: a.chapterTitle || `Phần ${a.spineIndex + 1}`, items: [] });
        }
        byChapter.get(key).items.push(a);
      });

    return Array.from(byChapter.values())
      .map(
        (group) => `
      <div class="rd-ann-chgroup">
        <button type="button" class="rd-group-head open" data-ann-chapter-toggle>
          <svg class="rd-caret" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
          <span class="rd-ann-chapter-title">${esc(group.title)}</span>
          <span class="rd-ann-badge">${group.items.length}</span>
        </button>
        <div class="rd-group-body">
          ${group.items
            .map(
              (a) => `
            <button type="button" class="rd-ann-item" data-id="${esc(a.id)}" style="--rd-ann-color:${esc(a.color || "")}">
              <span class="rd-ann-item-quote">${esc(truncatePlain(a.quote || "", 160))}</span>
              ${a.note ? `<span class="rd-ann-item-note">${esc(truncatePlain(a.note, 80))}</span>` : ""}
            </button>`
            )
            .join("")}
        </div>
      </div>`
      )
      .join("");
  }

  function renderSidebar() {
    const defs = annotationsCache.filter((a) => a.type === "definition");
    const notes = annotationsCache.filter((a) => a.type !== "definition");

    if (defListEl) defListEl.innerHTML = buildChapterGroupsHtml(defs);
    if (defEmptyEl) defEmptyEl.classList.toggle("hidden", defs.length > 0);
    if (defBadgeEl) defBadgeEl.textContent = String(defs.length);

    if (noteListEl) noteListEl.innerHTML = buildChapterGroupsHtml(notes);
    if (noteEmptyEl) noteEmptyEl.classList.toggle("hidden", notes.length > 0);
    if (noteBadgeEl) noteBadgeEl.textContent = String(notes.length);
  }

  function onSidebarListClick(e) {
    const toggle = e.target.closest("[data-ann-chapter-toggle]");
    if (toggle) {
      const body = toggle.nextElementSibling;
      if (body) {
        const open = body.classList.toggle("hidden") === false;
        toggle.classList.toggle("open", open);
      }
      return;
    }
    const item = e.target.closest(".rd-ann-item[data-id]");
    if (item) gotoAnnotation(item.dataset.id);
  }

  if (defListEl) defListEl.addEventListener("click", onSidebarListClick);
  if (noteListEl) noteListEl.addEventListener("click", onSidebarListClick);

  // khối TỪ VỰNG / GHI CHÚ cũng gập/mở được (giống mũi tên expand trong ảnh mẫu)
  document.querySelectorAll('.rd-ann-block > [data-ann-toggle]').forEach((head) => {
    head.addEventListener("click", () => {
      const block = head.closest(".rd-ann-block");
      const body = block ? block.querySelector(".rd-ann-block-body") : null;
      if (!body) return;
      const open = body.classList.toggle("hidden") === false;
      head.classList.toggle("open", open);
    });
  });

  // luôn làm mới danh sách khi mở lại bảng "GHI CHÚ" từ thanh công cụ
  if (railBtn) railBtn.addEventListener("click", () => renderSidebar());

  /* ---------------------------------------------------------- thanh kéo đổi cỡ 2 khối (sash) */

  if (sashEl && defBlockEl) {
    let dragging = false;
    let startY = 0;
    let startHeight = 0;

    sashEl.addEventListener("mousedown", (e) => {
      dragging = true;
      startY = e.clientY;
      startHeight = defBlockEl.getBoundingClientRect().height;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const delta = e.clientY - startY;
      const next = Math.max(70, Math.min(420, startHeight + delta));
      defBlockEl.style.flexBasis = next + "px";
    });

    document.addEventListener("mouseup", () => { dragging = false; });
  }

  /* ---------------------------------------------------------- hook gọi từ app.js sau mỗi renderChapter */

  async function onChapterRendered(spineIndex) {
    const info = app().getBookInfo ? app().getBookInfo() : null;
    if (!info) return;

    if (info.id !== currentBookId) {
      currentBookId = info.id;
      await refreshAnnotationsCache(info.id);
    }

    attachFrameSelectionHandlers();
    await applyAnnotationsToChapter(spineIndex);
    closePopup();
    renderSidebar();

    if (pendingFocusId) {
      const id = pendingFocusId;
      pendingFocusId = null;
      focusAnnotationInDom(id);
    }
  }

  window.ReaderAnnotations = {
    onChapterRendered,
  };
})();
