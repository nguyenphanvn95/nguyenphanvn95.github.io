// Hover-to-preview for the EPUB library. Runs only on desktop pointers.
(() => {
  "use strict";

  const HOVER_DELAY = 0;
  const HIDE_GRACE = 180;
  const DESC_MAX = 260;
  const EDGE = 8;

  const grid = document.querySelector("#library-grid");
  const libraryView = document.querySelector("#library-view");
  const libMain = document.querySelector(".lib-main");
  if (!grid || !libraryView) return;

  const desktopMQ = window.matchMedia("(hover: hover) and (pointer: fine)");
  const mobileMQ = window.matchMedia("(max-width: 760px)");
  const app = () => window.ReaderApp || {};

  let popup = null;
  let popupCoverUrl = null;
  let showTimer = 0;
  let hideTimer = 0;
  let hoverToken = 0;

  function isDesktopMode() {
    return desktopMQ.matches && !mobileMQ.matches;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function estimateProgress(record) {
    if (!record || !record.position || !record.spineCount) return 0;
    const within = record.position.scrollFraction || 0;
    const frac = (record.position.spineIndex + within) / record.spineCount;
    return Math.min(99, Math.max(1, Math.round(frac * 100)));
  }

  function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement("div");
    popup.className = "hover-preview";
    popup.innerHTML = `
      <div class="hp-cover"></div>
      <div class="hp-body">
        <p class="hp-title"></p>
        <p class="hp-author"></p>
        <p class="hp-progress"></p>
        <p class="hp-desc"></p>
        <div class="hp-actions">
          <button type="button" class="hp-read">
            <img src="../assets/icons/icon-read.svg" alt="" aria-hidden="true">
            <span></span>
          </button>
          <a href="#" class="hp-detail">Chi tiết</a>
        </div>
      </div>`;
    document.body.appendChild(popup);

    popup.addEventListener("mouseenter", cancelHide);
    popup.addEventListener("mouseleave", scheduleHide);

    popup.querySelector(".hp-read").addEventListener("click", () => {
      const id = popup.dataset.bookId;
      hideNow();
      if (id && app().openBookById) app().openBookById(id);
    });

    popup.querySelector(".hp-detail").addEventListener("click", (event) => {
      event.preventDefault();
      const id = popup.dataset.bookId;
      hideNow();
      if (id && app().openBookInfoById) app().openBookInfoById(id);
    });

    return popup;
  }

  function cancelShow() {
    clearTimeout(showTimer);
    showTimer = 0;
  }

  function cancelHide() {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function hideNow() {
    cancelShow();
    cancelHide();
    hoverToken++;
    if (popup) popup.classList.remove("visible");
    if (popupCoverUrl) {
      URL.revokeObjectURL(popupCoverUrl);
      popupCoverUrl = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(() => {
      if (popup && popup.matches(":hover")) return;
      hideNow();
    }, HIDE_GRACE);
  }

  async function showFor(cover) {
    if (!isDesktopMode()) return;
    const card = cover.closest(".book-card");
    if (!card || card.classList.contains("selectable")) return;
    const id = card.dataset.id;
    if (!id || typeof BookDB === "undefined") return;

    const token = ++hoverToken;
    const record = await BookDB.getBook(id);
    if (token !== hoverToken || !record) return;

    fill(record, id);
    position(cover);
    ensurePopup().classList.add("visible");
  }

  function fill(record, id) {
    const panel = ensurePopup();
    panel.dataset.bookId = id;
    panel.classList.toggle("lib-dark", libraryView.classList.contains("lib-dark"));

    if (popupCoverUrl) {
      URL.revokeObjectURL(popupCoverUrl);
      popupCoverUrl = null;
    }

    const coverEl = panel.querySelector(".hp-cover");
    if (record.coverBlob) {
      popupCoverUrl = URL.createObjectURL(record.coverBlob);
      coverEl.innerHTML = `<img src="${popupCoverUrl}" alt="">`;
    } else {
      coverEl.innerHTML = `<div class="hp-cover-fallback">${escapeHtml(record.title || "Không tên")}</div>`;
    }

    panel.querySelector(".hp-title").textContent = record.title || "Không tên";
    panel.querySelector(".hp-author").textContent = record.creator || "Không rõ tác giả";

    const progress = estimateProgress(record);
    const progressEl = panel.querySelector(".hp-progress");
    if (progress > 0) {
      progressEl.textContent = `Đang đọc - ${progress}%`;
      progressEl.hidden = false;
    } else {
      progressEl.hidden = true;
    }

    const descEl = panel.querySelector(".hp-desc");
    const desc = String(record.description || "").trim();
    if (desc) {
      descEl.textContent = desc.length > DESC_MAX ? `${desc.slice(0, DESC_MAX).trim()}...` : desc;
      descEl.hidden = false;
    } else {
      descEl.hidden = true;
    }

    panel.querySelector(".hp-read span").textContent = progress > 0 ? "Đọc tiếp" : "Đọc ngay";
  }

  function position(cover) {
    const panel = ensurePopup();
    const rect = cover.getBoundingClientRect();
    const coverStyle = getComputedStyle(cover);
    const availableRight = window.innerWidth - EDGE - rect.right;
    const availableLeft = rect.left - EDGE;
    const shouldFlip = availableRight < 300 && availableLeft > availableRight;
    const availableBody = shouldFlip ? availableLeft : availableRight;
    const bodyWidth = Math.min(430, Math.max(240, availableBody));

    panel.classList.remove("flip");
    panel.style.setProperty("--hp-cover-w", `${rect.width}px`);
    panel.style.setProperty("--hp-cover-h", `${rect.height}px`);
    panel.style.setProperty("--hp-cover-radius", coverStyle.borderRadius || "10px");
    panel.style.setProperty("--hp-body-w", `${bodyWidth}px`);

    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    let left;
    if (shouldFlip) {
      panel.classList.add("flip");
      const measuredBody = panel.querySelector(".hp-body").getBoundingClientRect().width;
      left = rect.left - measuredBody;
    } else {
      left = rect.left;
    }
    if (left + width > window.innerWidth - EDGE) left = window.innerWidth - width - EDGE;
    if (left < EDGE) left = EDGE;

    let top = rect.top;
    if (top + height > window.innerHeight - EDGE) top = window.innerHeight - height - EDGE;
    if (top < EDGE) top = EDGE;

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  grid.addEventListener("mouseover", (event) => {
    if (!isDesktopMode()) return;
    const cover = event.target.closest(".book-cover");
    if (!cover || !grid.contains(cover) || cover.contains(event.relatedTarget)) return;
    cancelHide();
    cancelShow();
    if (HOVER_DELAY > 0) showTimer = setTimeout(() => showFor(cover), HOVER_DELAY);
    else showFor(cover);
  });

  grid.addEventListener("mouseout", (event) => {
    const cover = event.target.closest(".book-cover");
    if (!cover || !grid.contains(cover) || cover.contains(event.relatedTarget)) return;
    if (popup && popup.contains(event.relatedTarget)) return;
    cancelShow();
    scheduleHide();
  });

  if (libMain) libMain.addEventListener("scroll", hideNow, { passive: true });
  window.addEventListener("resize", hideNow);
  document.addEventListener("library:rendered", hideNow);
  document.addEventListener("mousedown", (event) => {
    if (popup && popup.classList.contains("visible") && !popup.contains(event.target)) hideNow();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideNow();
  });
})();
