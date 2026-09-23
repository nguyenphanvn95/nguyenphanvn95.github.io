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

  // Nút icon "Nghe sách" - hình tròn nằm giữa ảnh bìa, giống nút play của
  // Waka (nền đen mờ + blur phía sau, icon trắng). Bản thân icon SVG (xem
  // makeListenIconSvg) đã tự vẽ nền tròn mờ + blur riêng, nên wrapper <a> ở
  // đây chỉ định vị trí/kích thước, không vẽ thêm nền để tránh chồng lớp.
  function injectStylesOnce() {
    if (document.getElementById("voiz-newtab-style")) return;
    var style = document.createElement("style");
    style.id = "voiz-newtab-style";
    style.textContent =
      "." + LINK_CLASS + "-wrap { position: relative !important; }" +
      "." + LINK_CLASS + " {" +
      "  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);" +
      "  width: 34px; height: 34px;" +
      "  display: flex; align-items: center; justify-content: center;" +
      "  text-decoration: none; z-index: 2147483000; pointer-events: auto;" +
      "}" +
      "." + LINK_CLASS + " svg {" +
      "  width: 100%; height: 100%; display: block;" +
      "  transition: transform .18s ease, filter .18s ease;" +
      "}" +
      // Giống hiệu ứng hover của Waka: phóng to icon một chút khi rê chuột tới.
      "." + LINK_CLASS + ":hover svg { transform: scale(1.15); filter: drop-shadow(0 2px 6px rgba(0,0,0,.45)); }";
    (document.head || document.documentElement).appendChild(style);
  }

  // Icon nghe sách (hình tròn nền tối mờ + tam giác play trắng), phỏng theo
  // assets/icons/icon-listen.svg. Mỗi lần gọi sinh id filter riêng để tránh
  // trùng id khi có nhiều icon trên cùng một trang.
  var listenIconIdSeq = 0;
  function makeListenIconSvg() {
    listenIconIdSeq++;
    var filterId = "voiz-newtab-listen-blur-" + listenIconIdSeq;
    return (
      '<svg width="42" height="42" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<g filter="url(#' + filterId + ')"><circle cx="21" cy="21" r="21" fill="#121214" fill-opacity="0.6"/></g>' +
      '<path d="M30.4086 18.3526C32.5305 19.5065 32.5305 22.4935 30.4086 23.6474L18.5966 30.6145C16.5344 31.736 14 30.2763 14 27.9671L14 14.0329C14 11.7237 16.5344 10.264 18.5966 11.3855L30.4086 18.3526Z" fill="white" stroke="white" stroke-width="2"/>' +
      "<defs>" +
      '<filter id="' + filterId + '" x="-16" y="-16" width="74" height="74" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">' +
      '<feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
      '<feGaussianBlur in="BackgroundImageFix" stdDeviation="8"/>' +
      '<feComposite in2="SourceAlpha" operator="in" result="effect1_backgroundBlur"/>' +
      '<feBlend mode="normal" in="SourceGraphic" in2="effect1_backgroundBlur" result="shape"/>' +
      "</filter>" +
      "</defs>" +
      "</svg>"
    );
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
    var candidates = [
      img.currentSrc,
      img.src,
      img.getAttribute("src"),
      img.getAttribute("data-src"),
      img.getAttribute("data-lazy-src"),
      img.getAttribute("srcset"),
      img.getAttribute("data-srcset"),
    ];
    for (var i = 0; i < candidates.length; i++) {
      var s = candidates[i];
      if (!s || typeof s !== "string") continue;
      var m = s.match(AVATAR_ID_RE);
      if (m) return m[1];
    }
    return null;
  }

  function openInNewTab(url) {
    // Userscript: không có background script để mở tab mới hộ — dùng window.open trực tiếp.
    try { window.open(url, "_blank", "noopener"); } catch (e) {}
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

  // Avatar tác giả: MuiAvatar tròn, nằm trong link /authors/, hoặc swiper author
  function isAuthorAvatarImage(img) {
    try {
      if (img.classList && img.classList.contains("MuiAvatar-img")) return true;
      if (img.closest(".MuiAvatar-root")) return true;
      if (img.closest('a[href*="/authors/"]')) return true;
      if (img.closest("#author-detail-info, .author-detail-info-swiper")) return true;
      var alt = (img.getAttribute("alt") || "").toLowerCase();
      if (alt.indexOf("image ") === 0) return true; // Voiz dùng alt="image <Tên tác giả>"
    } catch (e) {}
    return false;
  }

  function makeLink(book) {
    var a = document.createElement("a");
    a.href = PLAY_URL_PREFIX + book.id + "/";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = makeListenIconSvg();
    a.title = "Nghe sách: " + book.name;
    a.setAttribute("aria-label", "Nghe sách: " + book.name);
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
        img.setAttribute(PROCESSED_ATTR, "1");
        return;
      }
      // Không chèn lên avatar tác giả / vòng tròn MuiAvatar / link /authors/
      if (isAuthorAvatarImage(img)) {
        img.setAttribute(PROCESSED_ATTR, "1");
        return;
      }

      var avatarId = findAvatarIdFromImg(img);
      if (!avatarId) return;
      var book = bookByAvatarId.get(avatarId);
      if (!book) return;

      img.setAttribute(PROCESSED_ATTR, "1");

      var wrap = img.closest("picture") || img;
      var parent = wrap.parentElement;
      if (!parent) return;
      if (parent.querySelector("." + LINK_CLASS)) return;

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
  // Userscript: không có `chrome` global nên khối này tự động bị bỏ qua (typeof chrome === "undefined").
  // Giữ nguyên logic để nếu sau này có background script thật thì vẫn hoạt động không cần sửa gì.
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
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
