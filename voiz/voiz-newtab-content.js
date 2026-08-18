// voiz-newtab-content.js (isolated world)
// Phần của Mydio & Voiz Toolkit v6.7 – tính năng mở link sách ở tab mới.
//
// Voiz FM là SPA (Next.js): ô sách là <div> điều hướng bằng JS, không có href thật.
// interceptor (MAIN world) bắt response JSON từ api.voiz.vn, bắn CustomEvent sang
// script này. Khớp ảnh bìa <img> với sách qua ID trong đường dẫn ảnh
// (.../avatar/filename/<id>/...), chèn link "Nghe sách" → https://voiz.vn/play/<id>/.
// Còn phương án dự phòng đọc React fiber/props khi click.

(function () {
  console.log("[VoizNewTab] content script đã nạp trên", location.href);

  var EVENT_NAME = "__voiz_newtab_books_found__";
  var PLAY_URL_PREFIX = "https://voiz.vn/play/";
  var LINK_CLASS = "voiz-newtab-nghesach-link";
  var PROCESSED_ATTR = "data-voiz-newtab-done";
  var AVATAR_ID_RE = /\/filename\/(\d+)\//;

  // id ảnh bìa (vd "446498") -> { id, name }
  var bookByAvatarId = new Map();

  function injectStylesOnce() {
    if (document.getElementById("voiz-newtab-style")) return;
    var style = document.createElement("style");
    style.id = "voiz-newtab-style";
    style.textContent =
      "." + LINK_CLASS + "-wrap { position: relative !important; }" +
      "." + LINK_CLASS + " {" +
      "  position: absolute; left: 50%; bottom: 6px; transform: translateX(-50%);" +
      "  background: rgba(20,20,24,.88); color: #fff; font: 600 11px/1 -apple-system,Segoe UI,Roboto,sans-serif;" +
      "  padding: 5px 10px; border-radius: 999px; text-decoration: none; z-index: 2147483000;" +
      "  border: 1px solid rgba(255,255,255,.18); white-space: nowrap; opacity: .92;" +
      "  box-shadow: 0 1px 4px rgba(0,0,0,.35); transition: opacity .15s ease, background-color .15s ease;" +
      "  pointer-events: auto;" +
      "}" +
      "." + LINK_CLASS + ":hover { opacity: 1; background: #7C4DFF; }";
    (document.head || document.documentElement).appendChild(style);
  }

  // --- Nhận dữ liệu sách từ interceptor.js ---
  function extractAvatarIds(book) {
    var ids = [];
    var avatar = book.avatar || {};
    var urls = [avatar.original_url, avatar.thumb_url, avatar.small_url];
    if (avatar.webp) {
      urls.push(avatar.webp.original_url, avatar.webp.normal_url, avatar.webp.thumb_url);
    }
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      if (typeof u !== "string") continue;
      var m = u.match(AVATAR_ID_RE);
      if (m) ids.push(m[1]);
    }
    return ids;
  }

  function registerBooks(books) {
    var addedAny = false;
    for (var i = 0; i < books.length; i++) {
      var b = books[i];
      if (!b || typeof b.id === "undefined" || typeof b.name !== "string") continue;
      var avIds = extractAvatarIds(b);
      for (var j = 0; j < avIds.length; j++) {
        if (!bookByAvatarId.has(avIds[j])) addedAny = true;
        bookByAvatarId.set(avIds[j], { id: b.id, name: b.name });
      }
    }
    if (addedAny) {
      console.log("[VoizNewTab] đã nhận dữ liệu sách, tổng số ảnh bìa đã biết:", bookByAvatarId.size);
      scheduleInject();
    }
  }

  window.addEventListener(EVENT_NAME, function (event) {
    try {
      registerBooks((event && event.detail) || []);
    } catch (e) {
      console.log("[VoizNewTab] lỗi xử lý dữ liệu sách từ interceptor:", e);
    }
  });

  // --- Chèn link "Nghe sách" dưới từng ảnh bìa đã khớp được dữ liệu ---
  function findAvatarIdFromImg(img) {
    var src = img.currentSrc || img.src || "";
    var m = src.match(AVATAR_ID_RE);
    return m ? m[1] : null;
  }

  function openInNewTab(url) {
    try { window.open(url, "_blank"); } catch (e) {}
  }

  // Trang chi tiết (/play/<id>/) có một ảnh bìa lớn dạng "nền" full-bleed ở phần header
  // (Next/Image chế độ "fill": data-nimg="fill", alt="cover") - ảnh này được absolute
  // để lấp đầy khối cha theo tỉ lệ khung cố định. Chèn link vào đây làm khối cha bị
  // đẩy thêm khoảng trống trên/dưới trông xấu, nên bỏ qua, chỉ chèn link cho các ảnh bìa
  // dạng thumbnail bình thường (ví dụ mục "Có thể bạn muốn nghe").
  function isHeroCoverImage(img) {
    var alt = (img.getAttribute("alt") || "").trim().toLowerCase();
    var nimg = (img.getAttribute("data-nimg") || "").trim().toLowerCase();
    return alt === "cover" || nimg === "fill";
  }

  function makeLink(book) {
    var a = document.createElement("a");
    a.href = PLAY_URL_PREFIX + book.id + "/";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Nghe sách";
    a.title = book.name;
    a.className = LINK_CLASS;
    a.addEventListener(
      "click",
      function (ev) {
        // Chặn sự kiện lan lên các thẻ cha do React quản lý (card cả khối thường có
        // onClick riêng để tự điều hướng trong SPA) - nếu không chặn thì tab hiện tại
        // có thể vừa bị điều hướng vừa mở thêm tab mới.
        ev.stopPropagation();
      },
      false
    );
    return a;
  }

  function injectLinksForImages(root) {
    if (!bookByAvatarId.size) return;
    var scope = root && root.querySelectorAll ? root : document;
    var imgs = scope.querySelectorAll("img:not([" + PROCESSED_ATTR + "])");
    if (!imgs.length) return;
    injectStylesOnce();

    imgs.forEach(function (img) {
      if (isHeroCoverImage(img)) {
        img.setAttribute(PROCESSED_ATTR, "1"); // đánh dấu bỏ qua hẳn, không cần quét lại
        return;
      }

      var avatarId = findAvatarIdFromImg(img);
      if (!avatarId) return;
      var book = bookByAvatarId.get(avatarId);
      if (!book) return; // dữ liệu sách của ảnh này chưa tải kịp, chờ vòng quét sau

      img.setAttribute(PROCESSED_ATTR, "1");

      var wrap = img.closest("picture") || img;
      var parent = wrap.parentElement;
      if (!parent) return;
      if (parent.querySelector("." + LINK_CLASS)) return; // đã chèn rồi

      parent.classList.add(LINK_CLASS + "-wrap");
      var computedPos = window.getComputedStyle(parent).position;
      if (computedPos === "static") {
        parent.style.position = "relative";
      }
      parent.appendChild(makeLink(book));
    });
  }

  var injectScheduled = false;
  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    requestAnimationFrame(function () {
      injectScheduled = false;
      injectLinksForImages(document);
    });
  }

  function startObserving() {
    var observer = new MutationObserver(function () {
      scheduleInject();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleInject();
    // Voiz nạp ảnh lười (lazy) & đôi khi ảnh xuất hiện sau khi API đã trả về từ trước,
    // nên quét định kỳ nhẹ nhàng để không bỏ sót.
    setInterval(scheduleInject, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserving);
  } else {
    startObserving();
  }

  // ======================================================================
  // Phương án dự phòng cũ: đọc dữ liệu nội bộ React (fiber/props) khi click vào
  // các ô sách chưa được nhận diện qua API (ví dụ vừa vào trang, dữ liệu API
  // interceptor chưa kịp bắt). Giữ lại để tăng độ phủ, không xung đột với link
  // "Nghe sách" mới (link mới là thẻ <a target="_blank"> thật nên bị bỏ qua ở
  // handler đầu tiên bên dưới).
  // ======================================================================

  function getReactPropsKey(el) {
    return Object.keys(el).find(function (k) {
      return k.startsWith("__reactProps$");
    });
  }
  function getReactFiberKey(el) {
    return Object.keys(el).find(function (k) {
      return k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$");
    });
  }

  function findUrlFromReactInternals(domEl) {
    let node = domEl;
    for (let i = 0; i < 8 && node; i++) {
      const propsKey = getReactPropsKey(node);
      if (propsKey) {
        const props = node[propsKey];
        if (props) {
          for (const key of ["href", "to", "url"]) {
            if (typeof props[key] === "string" && props[key].length) {
              return props[key];
            }
          }
        }
      }
      node = node.parentElement;
    }

    const fiberKey = getReactFiberKey(domEl);
    if (fiberKey) {
      let fiber = domEl[fiberKey];
      const candidates = [];
      for (let i = 0; i < 20 && fiber; i++) {
        const props = fiber.memoizedProps;
        if (props && typeof props === "object") {
          for (const key of ["href", "to", "url", "slug", "bookId", "book_id", "id"]) {
            const val = props[key];
            if ((typeof val === "string" || typeof val === "number") && String(val).length && String(val).length < 200) {
              candidates.push({ key, val, depth: i });
            }
          }
        }
        fiber = fiber.return;
      }
      const direct = candidates.find((c) => ["href", "to", "url"].includes(c.key) && String(c.val).length > 3);
      if (direct) return String(direct.val);
    }

    return null;
  }

  function resolveVoizUrl(raw) {
    if (!raw) return null;
    try {
      return new URL(String(raw), location.href).href;
    } catch (e) {
      return null;
    }
  }

  document.addEventListener(
    "click",
    function (event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      if (event.target.closest("a[href]")) return; // thẻ <a> thật (kể cả link "Nghe sách" mới) xử lý ở khối bên dưới

      const raw = findUrlFromReactInternals(event.target);
      const url = resolveVoizUrl(raw);

      if (url && new URL(url).hostname.endsWith("voiz.vn") && url !== location.href) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openInNewTab(url);
      }
    },
    true
  );

  // --- Phương án dự phòng: click vào thẻ <a href> thật ---
  document.addEventListener(
    "click",
    function (event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link = event.target.closest("a[href]");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      if (link.target === "_blank") return; // link "Nghe sách" mới đã có target=_blank -> để trình duyệt tự mở tab mới

      let url;
      try {
        url = new URL(href, window.location.href);
      } catch (e) {
        return;
      }
      if (!url.hostname.endsWith("voiz.vn")) return;

      event.preventDefault();
      event.stopPropagation();
      openInNewTab(url.href);
    },
    true
  );

  // ─── PAGE_FETCH: tải m3u8/.ts trong context trang voiz.vn (tránh S3 AccessDenied) ───
  if (false && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
      if (!message || message.type !== "PAGE_FETCH" || !message.url) return false;
      var responseType = message.responseType === "arrayBuffer" ? "arrayBuffer" : "text";
      var url = message.url;
      (async function () {
        try {
          var res = await fetch(url, {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            mode: "cors",
            redirect: "follow",
            headers: {
              Accept: "*/*",
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          });
          if (!res.ok) {
            var errBody = "";
            try {
              errBody = await res.text();
            } catch (_) {}
            sendResponse({
              ok: false,
              status: res.status,
              error:
                res.status === 403 || /AccessDenied/i.test(errBody)
                  ? "AccessDenied HTTP " + res.status
                  : "HTTP " + res.status,
            });
            return;
          }
          if (responseType === "text") {
            sendResponse({ ok: true, status: res.status, text: await res.text() });
            return;
          }
          var ab = await res.arrayBuffer();
          var bytes = new Uint8Array(ab);
          var binary = "";
          var chunk = 0x8000;
          for (var i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          sendResponse({
            ok: true,
            status: res.status,
            base64: btoa(binary),
            byteLength: bytes.length,
          });
        } catch (err) {
          sendResponse({ ok: false, error: (err && err.message) || String(err) });
        }
      })();
      return true;
    });
  }
})();
