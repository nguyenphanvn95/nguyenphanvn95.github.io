/**
 * platform-shim.js — Waka EBook Reader (bản web / userscript)
 *
 * Trình đọc EPUB gốc chạy trong trang extension nên dùng vài API `chrome.*`.
 * File này thay thế chúng để CÙNG MỘT bộ mã nguồn chạy được trên trang web
 * (nguyenphanvn95.github.io/waka-ebook-reader/) mà không phải sửa các file
 * epub-reader/*.js:
 *
 *   chrome.storage.local      → localStorage (kèm onChanged giữa các tab)
 *   chrome.runtime.getURL     → URL tuyệt đối theo thư mục gốc của reader
 *   chrome.permissions.*      → luôn "đã cấp" (web không có khái niệm này)
 *   chrome.runtime.sendMessage({action:"consumeReaderEpub"}) → nhận EPUB do
 *       trang waka.vn chuyển sang (postMessage qua window.opener, dự phòng
 *       qua kênh GM_* của userscript)
 *   fetch()                   → nếu bị CORS chặn và có userscript, thử lại
 *       qua GM_xmlhttpRequest (giữ tính năng "nhập EPUB từ URL" như extension)
 *
 * Khi chạy trong extension thật (chrome.runtime.id tồn tại) file này không làm gì.
 */
(function () {
  "use strict";

  var w = window;
  try {
    if (w.chrome && w.chrome.runtime && w.chrome.runtime.id && w.chrome.storage && w.chrome.storage.local) return;
  } catch (e) { /* tiếp tục cài shim */ }
  if (w.__wakaPlatformShim) return;
  w.__wakaPlatformShim = true;

  var VERSION = "1.0.5";
  var script = document.currentScript;
  // File nằm ở <gốc>/src/platform-shim.js → gốc = thư mục cha.
  var ROOT = new URL("../", script && script.src ? script.src : location.href).href;

  /* ------------------------------------------------------------------ *
   * Tiện ích callback/promise kiểu chrome.* (MV3: hỗ trợ cả hai)
   * ------------------------------------------------------------------ */
  var runtime = { lastError: undefined };

  function runCb(cb, result, err) {
    runtime.lastError = err ? { message: String((err && err.message) || err) } : undefined;
    try { cb(result); } finally { runtime.lastError = undefined; }
  }

  function api(fn) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
      var p = Promise.resolve().then(function () { return fn.apply(null, args); });
      if (cb) {
        p.then(function (r) { runCb(cb, r); }, function (e) { runCb(cb, undefined, e); });
        return undefined;
      }
      return p;
    };
  }

  /* ------------------------------------------------------------------ *
   * chrome.storage.local  →  localStorage (dự phòng: bộ nhớ tạm)
   * ------------------------------------------------------------------ */
  var PREFIX = "wakaReader:";
  var mem = new Map();
  var useLS = (function () {
    try {
      var k = "__wakaReaderProbe";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function parse(s) { if (s == null) return undefined; try { return JSON.parse(s); } catch (e) { return undefined; } }

  function rawGet(k) {
    if (useLS) {
      try { return parse(localStorage.getItem(PREFIX + k)); } catch (e) { /* rơi xuống mem */ }
    }
    return mem.has(k) ? clone(mem.get(k)) : undefined;
  }
  function rawSet(k, v) {
    if (useLS) {
      try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); return; } catch (e) { /* hết quota → mem */ }
    }
    mem.set(k, clone(v));
  }
  function rawRemove(k) {
    if (useLS) { try { localStorage.removeItem(PREFIX + k); } catch (e) {} }
    mem.delete(k);
  }
  function allKeys() {
    var out = new Set(mem.keys());
    if (useLS) {
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf(PREFIX) === 0) out.add(key.slice(PREFIX.length));
        }
      } catch (e) {}
    }
    return Array.from(out);
  }

  var changeListeners = [];
  function fireChanged(changes) {
    if (!changes || !Object.keys(changes).length) return;
    changeListeners.slice().forEach(function (fn) {
      try { fn(changes, "local"); } catch (e) { console.error(e); }
    });
  }
  // Thay đổi từ tab khác (ví dụ đổi ngôn ngữ) — giống chrome.storage.onChanged.
  w.addEventListener("storage", function (e) {
    if (!e.key || e.key.indexOf(PREFIX) !== 0) return;
    var changes = {};
    changes[e.key.slice(PREFIX.length)] = { oldValue: parse(e.oldValue), newValue: parse(e.newValue) };
    fireChanged(changes);
  });

  var storageLocal = {
    get: api(function (keys) {
      var out = {};
      if (keys == null) {
        allKeys().forEach(function (k) { out[k] = rawGet(k); });
      } else if (typeof keys === "string") {
        var v = rawGet(keys);
        if (v !== undefined) out[keys] = v;
      } else if (Array.isArray(keys)) {
        keys.forEach(function (k) { var val = rawGet(k); if (val !== undefined) out[k] = val; });
      } else if (typeof keys === "object") {
        Object.keys(keys).forEach(function (k) {
          var val = rawGet(k);
          out[k] = val === undefined ? keys[k] : val;
        });
      }
      return out;
    }),
    set: api(function (items) {
      var changes = {};
      Object.keys(items || {}).forEach(function (k) {
        if (items[k] === undefined) return;
        var old = rawGet(k);
        rawSet(k, items[k]);
        changes[k] = { oldValue: old, newValue: clone(items[k]) };
      });
      fireChanged(changes);
    }),
    remove: api(function (keys) {
      var changes = {};
      (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
        var old = rawGet(k);
        if (old === undefined) return;
        rawRemove(k);
        changes[k] = { oldValue: old };
      });
      fireChanged(changes);
    }),
    clear: api(function () {
      var changes = {};
      allKeys().forEach(function (k) { changes[k] = { oldValue: rawGet(k) }; rawRemove(k); });
      fireChanged(changes);
    }),
  };
  var storage = {
    local: storageLocal,
    onChanged: {
      addListener: function (fn) { if (typeof fn === "function") changeListeners.push(fn); },
      removeListener: function (fn) { changeListeners = changeListeners.filter(function (f) { return f !== fn; }); },
      hasListener: function (fn) { return changeListeners.indexOf(fn) >= 0; },
    },
  };

  /* ------------------------------------------------------------------ *
   * Cầu nối với userscript (postMessage trong cùng cửa sổ)
   *   trang → userscript : {__wakaReader:1, dir:"page->us", id, op, ...}
   *   userscript → trang : {__wakaReader:1, dir:"us->page", id, ok, ...}
   * Userscript đánh dấu sự có mặt bằng thuộc tính html[data-waka-reader-userscript].
   * ------------------------------------------------------------------ */
  var Bridge = (function () {
    var pending = new Map();
    var seq = 0;

    w.addEventListener("message", function (e) {
      if (e.origin !== location.origin) return;
      var d = e.data;
      if (!d || d.__wakaReader !== 1 || d.dir !== "us->page") return;
      var p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      clearTimeout(p.timer);
      if (d.ok) p.resolve(d); else p.reject(new Error(d.error || "Bridge error"));
    });

    // Dấu hiệu userscript: waka-ebook-reader.user.js (fetch + consume) hoặc one-click-to-read.user.js (chỉ consume)
    var READER_ATTR = "data-waka-reader-userscript";
    var ONECLICK_ATTR = "data-waka-oneclick-userscript";
    function present(attrs) {
      var el = document.documentElement;
      if (!el) return false;
      return (attrs || [READER_ATTR]).some(function (a) { return el.hasAttribute(a); });
    }
    function waitPresent(ms, attrs) {
      return new Promise(function (resolve) {
        var t0 = Date.now();
        (function poll() {
          if (present(attrs)) return resolve(true);
          if (Date.now() - t0 >= ms) return resolve(false);
          setTimeout(poll, 100);
        })();
      });
    }
    function call(op, payload, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var id = ++seq + "-" + Date.now();
        var timer = setTimeout(function () {
          pending.delete(id);
          reject(new Error("Bridge timeout: " + op));
        }, timeoutMs || 30000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        var msg = { __wakaReader: 1, dir: "page->us", id: id, op: op };
        Object.keys(payload || {}).forEach(function (k) { msg[k] = payload[k]; });
        w.postMessage(msg, location.origin);
      });
    }
    return { present: present, waitPresent: waitPresent, call: call, READER_ATTR: READER_ATTR, ONECLICK_ATTR: ONECLICK_ATTR };
  })();

  /* ------------------------------------------------------------------ *
   * fetch(): thử lại qua userscript khi bị CORS/mixed-content chặn
   * ------------------------------------------------------------------ */
  (function wrapFetch() {
    var nativeFetch = w.fetch && w.fetch.bind(w);
    if (!nativeFetch) return;

    function isCrossOriginHttp(url) {
      try {
        var u = new URL(url, location.href);
        return /^https?:$/.test(u.protocol) && u.origin !== location.origin;
      } catch (e) { return false; }
    }
    function parseHeaders(str) {
      var h = new Headers();
      String(str || "").split(/\r?\n/).forEach(function (line) {
        var i = line.indexOf(":");
        if (i <= 0) return;
        try { h.append(line.slice(0, i).trim(), line.slice(i + 1).trim()); } catch (e) { /* header không hợp lệ */ }
      });
      return h;
    }

    w.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || String(input);
      return nativeFetch(input, init).catch(function (err) {
        var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
        var canRetry = err instanceof TypeError
          && (method === "GET" || method === "HEAD")
          && isCrossOriginHttp(url)
          && Bridge.present()
          && !(init && init.signal && init.signal.aborted);
        if (!canRetry) throw err;
        return Bridge.call("fetch", { url: new URL(url, location.href).href, method: method }, 120000)
          .then(function (r) {
            var noBody = r.status === 204 || r.status === 205 || r.status === 304 || method === "HEAD";
            return new Response(noBody ? null : r.buffer, {
              status: r.status,
              statusText: r.statusText || "",
              headers: parseHeaders(r.headers),
            });
          })
          .catch(function () { throw err; }); // báo lỗi gốc (CORS) nếu userscript cũng thất bại
      });
    };
  })();

  /* ------------------------------------------------------------------ *
   * Nhận EPUB từ trang waka.vn  (thay cho background.js: consumeReaderEpub)
   * ------------------------------------------------------------------ */
  var Handoff = (function () {
    var ALLOWED_ORIGINS = ["https://waka.vn", "https://www.waka.vn", location.origin];
    var TIMEOUT_MS = 120000;      // hết thời gian chờ khi KHÔNG có hoạt động (mỗi tin "progress" từ waka.vn làm mới bộ đếm)

    /* Lớp phủ tiến trình giống trang waka.vn (ảnh bìa + dòng trạng thái + thanh tiến trình + nút Hủy bỏ).
       Chỉ hiện khi tab được waka.vn mở sớm (token oc_…, có window.opener). Dữ liệu do waka.vn gửi sang
       bằng postMessage: {type:"cover"|"progress"|"error"|"epub"}; nút Hủy bỏ gửi {type:"cancel"} lại. */
    var Overlay = (function () {
      var token = new URLSearchParams(location.search).get("importToken") || "";
      var enabled = token.indexOf("oc_") === 0 && !!w.opener;
      var el = null, bgEl, coverBox, coverImg, statusEl, barEl, fillEl, cancelBtn;
      var progress = 0, removeTimer = 0, cancelExtra = null, locked = false, failed = false;

      var CSS = [
        ".wkr-ov,.wkr-ov *,.wkr-ov *::before,.wkr-ov *::after{box-sizing:border-box}",
        ".wkr-ov{--wkr-w:190px;position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;overflow:hidden;color:#fff;",
        "font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;opacity:0;transition:opacity .18s ease;overscroll-behavior:contain;touch-action:none;-webkit-tap-highlight-color:transparent}",
        ".wkr-ov.is-in{opacity:1}",
        ".wkr-ov-bg{position:absolute;inset:0;background-position:center;background-size:cover;background-repeat:no-repeat;pointer-events:none}",
        ".wkr-ov-panel{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center}",
        ".wkr-ov-cover{display:none;width:var(--wkr-w);border-radius:6px;overflow:hidden;background:rgba(255,255,255,.12);box-shadow:0 12px 34px rgba(0,0,0,.38)}",
        ".wkr-ov-cover img{display:block;width:100%;height:auto;max-height:56vh;object-fit:cover;user-select:none;-webkit-user-drag:none}",
        ".wkr-ov-status{width:min(100%,340px);min-height:22px;margin:22px 0 14px;font-size:15px;line-height:22px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.35)}",
        ".wkr-ov.is-error .wkr-ov-status{color:#ffd9d2}",
        ".wkr-ov-bar{width:var(--wkr-w);height:4px;margin-bottom:26px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.3)}",
        ".wkr-ov-bar>i{display:block;width:0;height:100%;border-radius:999px;background:#fff;transition:width .28s ease}",
        ".wkr-ov.is-error .wkr-ov-bar>i{background:#ffb4a8}",
        ".wkr-ov-cancel{-webkit-appearance:none;appearance:none;width:var(--wkr-w);height:44px;margin:0;padding:0 16px;border:1.5px solid rgba(255,255,255,.78);border-radius:999px;background:transparent;color:#fff;",
        "font:500 14px/1 system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:background .15s ease,border-color .15s ease,opacity .15s ease}",
        ".wkr-ov-cancel:hover{background:rgba(255,255,255,.12);border-color:#fff}",
        ".wkr-ov-cancel:active{background:rgba(255,255,255,.22)}",
        ".wkr-ov-cancel:focus-visible{outline:2px solid #fff;outline-offset:3px}",
        ".wkr-ov-cancel:disabled{opacity:.45;cursor:default;background:transparent}",
        ".wkr-ov--mobile{--wkr-w:min(54vw,210px);background:linear-gradient(165deg,#0f8f86 0%,#0a635e 55%,#06423f 100%)}",
        ".wkr-ov--mobile .wkr-ov-bg{display:none}",
        ".wkr-ov--mobile .wkr-ov-panel{width:100%}",
        ".wkr-ov--desktop{background:rgba(10,18,18,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}",
        ".wkr-ov--desktop .wkr-ov-bg{opacity:.38;filter:blur(30px) saturate(1.15);transform:scale(1.2)}",
        ".wkr-ov--desktop .wkr-ov-panel{width:420px;max-width:calc(100vw - 32px);padding:40px 32px 34px;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(28,38,38,.5);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);box-shadow:0 26px 70px rgba(0,0,0,.5)}",
      ].join("\n");

      function isMobile() {
        return w.innerWidth <= 768 ||
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "") ||
          !!(w.matchMedia && w.matchMedia("(max-width: 768px)").matches);
      }
      function onKey(e) {
        if (e.key !== "Escape" || !el) return;
        e.preventDefault(); e.stopPropagation();
        if (!cancelBtn.disabled) cancelBtn.click();
      }
      function remove() {
        clearTimeout(removeTimer);
        document.removeEventListener("keydown", onKey, true);
        var node = el; el = null;
        if (node) { node.classList.remove("is-in"); setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 200); }
      }
      function build() {
        if (el || !enabled) return;
        var root = document.documentElement;
        if (!root) return setTimeout(build, 0);
        if (!document.getElementById("wkr-ov-style")) {
          var st = document.createElement("style");
          st.id = "wkr-ov-style"; st.textContent = CSS;
          root.appendChild(st);
        }
        el = document.createElement("div");
        el.className = "wkr-ov " + (isMobile() ? "wkr-ov--mobile" : "wkr-ov--desktop");
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        el.setAttribute("aria-label", "Đang mở sách");
        el.innerHTML = '<div class="wkr-ov-bg"></div><div class="wkr-ov-panel">' +
          '<div class="wkr-ov-cover"><img alt="" draggable="false"></div>' +
          '<div class="wkr-ov-status" role="status" aria-live="polite"></div>' +
          '<div class="wkr-ov-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>' +
          '<button type="button" class="wkr-ov-cancel">Hủy bỏ</button></div>';
        bgEl = el.querySelector(".wkr-ov-bg");
        coverBox = el.querySelector(".wkr-ov-cover");
        coverImg = coverBox.querySelector("img");
        statusEl = el.querySelector(".wkr-ov-status");
        barEl = el.querySelector(".wkr-ov-bar");
        fillEl = barEl.querySelector("i");
        cancelBtn = el.querySelector(".wkr-ov-cancel");
        statusEl.textContent = "Đang chờ sách từ Waka...";
        coverImg.addEventListener("load", function () { coverBox.style.display = "block"; });
        coverImg.addEventListener("error", function () { coverBox.style.display = "none"; });
        cancelBtn.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation();
          if (failed) return remove();                     // lỗi: nút "Đóng"
          try { if (w.opener) w.opener.postMessage({ __wakaReaderHandoff: 1, type: "cancel", token: token }, "*"); } catch (err) { /* opener đã đóng */ }
          if (cancelExtra) { try { cancelExtra(); } catch (err) { /* bỏ qua */ } }
          try { w.close(); } catch (err) { /* bỏ qua */ }
          removeTimer = setTimeout(remove, 300);           // nếu tab không tự đóng được thì chỉ gỡ lớp phủ
        });
        el.addEventListener("wheel", function (e) { e.preventDefault(); }, { passive: false });
        el.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
        document.addEventListener("keydown", onKey, true);
        root.appendChild(el);
        requestAnimationFrame(function () { if (el) el.classList.add("is-in"); });
      }
      function setImage(src) {
        if (!src || !el) return;
        if (coverImg.getAttribute("src") !== src) { coverImg.referrerPolicy = "no-referrer"; coverImg.src = src; }
        bgEl.style.backgroundImage = 'url("' + String(src).replace(/["\\\n\r]/g, encodeURIComponent) + '")';
      }
      return {
        enabled: enabled,
        show: build,
        // Gỡ lớp phủ ngay (không cần chờ EPUB) — dùng khi trang đã tự tìm thấy sách
        // cùng tiêu đề trong thư viện và mở thẳng, không cần chờ waka.vn gửi EPUB nữa.
        skip: function () { if (el) remove(); },
        onCancel: function (fn) { cancelExtra = fn; },
        // Ảnh bìa: dataURL (tải bằng GM, chắc chắn hiển thị) ưu tiên hơn URL gốc (có thể bị hotlink)
        setCover: function (d) { if (!enabled) return; build(); setImage((d && (d.coverData || d.cover)) || ""); },
        update: function (text, pct) {
          if (!enabled) return; build(); if (!el) return;
          if (text) { statusEl.textContent = text; statusEl.title = text; }
          progress = Math.max(progress, Math.min(100, Number(pct) || 0));   // chỉ chạy tới, không lùi
          fillEl.style.width = progress + "%";
          barEl.setAttribute("aria-valuenow", String(Math.round(progress)));
        },
        lock: function () { locked = true; if (cancelBtn) cancelBtn.disabled = true; },
        done: function () {
          if (!el) return;
          statusEl.textContent = "Đang nhập sách vào Reader...";
          progress = 100; fillEl.style.width = "100%";
          cancelBtn.disabled = true;
          removeTimer = setTimeout(remove, 1500);
        },
        error: function (msg) {
          if (!enabled) return; build(); if (!el) return;
          failed = true;
          el.classList.add("is-error");
          statusEl.textContent = "Lỗi: " + String(msg || "Không rõ nguyên nhân").slice(0, 120);
          cancelBtn.disabled = false;
          cancelBtn.textContent = "Đóng";
        },
      };
    })();
    Overlay.show();
    var USERSCRIPT_WAIT_MS = 30000; // userscript có thể nạp trễ (trang nặng / trình quản lý khởi động chậm)

    function toDataUrl(d) {
      return new Promise(function (resolve, reject) {
        var blob = d.blob instanceof Blob ? d.blob : (d.buffer ? new Blob([d.buffer], { type: "application/epub+zip" }) : null);
        if (!blob) return reject(new Error("Không có dữ liệu EPUB"));
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || "")); };
        fr.onerror = function () { reject(fr.error || new Error("Không đọc được EPUB")); };
        fr.readAsDataURL(blob);
      });
    }

    function consume(token) {
      token = String(token || "");
      return new Promise(function (resolve) {
        var done = false;
        var timer;
        function armTimer() {
          clearTimeout(timer);
          timer = setTimeout(function () {
            finish({ success: false, error: "Hết thời gian chờ EPUB từ trang Waka — hãy mở lại bằng nút Reader trên waka.vn" });
          }, TIMEOUT_MS);
        }
        function finish(res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          w.removeEventListener("message", onMsg);
          if (res && res.success) Overlay.done(); else Overlay.error(res && res.error);
          resolve(res);
        }
        function onMsg(e) {
          var d = e.data;
          if (!d || d.__wakaReaderHandoff !== 1 || d.token !== token) return;
          if (ALLOWED_ORIGINS.indexOf(e.origin) < 0) return;
          // Tiến trình / lỗi do waka.vn báo trong lúc còn đang tải + dựng EPUB
          if (d.type === "cover") { Overlay.setCover(d); return; }
          if (d.type === "progress") { Overlay.update(d.text, d.pct); armTimer(); return; }
          if (d.type === "error") { finish({ success: false, error: d.message || "Waka báo lỗi" }); return; }
          if (d.type !== "epub") return;
          console.info("[Waka Reader] consume: nhận EPUB qua kênh opener");
          Overlay.lock();
          toDataUrl(d).then(
            function (dataUrl) { finish({ success: true, filename: d.filename || "waka.epub", dataUrl: dataUrl }); },
            function (err) { finish({ success: false, error: err.message }); }
          );
        }
        w.addEventListener("message", onMsg);
        armTimer();
        // Người dùng bấm "Hủy bỏ" trên lớp phủ: dừng chờ, không báo lỗi cho ứng dụng (tab sắp đóng)
        Overlay.onCancel(function () { done = true; clearTimeout(timer); w.removeEventListener("message", onMsg); });

        // Kênh 1: cửa sổ đã mở reader (window.opener) — nhanh, không qua bộ nhớ GM.
        try {
          if (w.opener && !w.opener.closed) {
            console.info("[Waka Reader] consume: gửi 'ready' cho opener, token=" + token);
            w.opener.postMessage({ __wakaReaderHandoff: 1, type: "ready", token: token }, "*");
          } else {
            console.info("[Waka Reader] consume: không có opener → chờ kênh userscript, token=" + token);
          }
        } catch (e) { /* opener bị chặn */ }

        // Kênh 2: userscript (trình duyệt cắt opener, ví dụ noopener / một số bản mobile).
        // Nếu có opener thì nhường kênh 1 ~2 giây trước, tránh chuyển dữ liệu hai lần.
        var gmDelay = (w.opener && !w.opener.closed) ? 2000 : 0;
        new Promise(function (r) { setTimeout(r, gmDelay); })
          .then(function () { return done ? false : Bridge.waitPresent(USERSCRIPT_WAIT_MS, [Bridge.READER_ATTR, Bridge.ONECLICK_ATTR]); })
          .then(function (ok) {
          if (done) return;
          if (!ok) {
            console.warn("[Waka Reader] consume: không thấy userscript sau " + USERSCRIPT_WAIT_MS + "ms (kiểm tra @match của Waka One Click to Read có gồm trang Reader)");
            return;
          }
          console.info("[Waka Reader] consume: userscript đã sẵn sàng, yêu cầu EPUB qua kênh GM");
          Bridge.call("consume", { token: token }, TIMEOUT_MS).then(
            function (d) { console.info("[Waka Reader] consume: nhận EPUB qua kênh GM"); finish({ success: true, filename: d.filename || "waka.epub", dataUrl: d.dataUrl }); },
            function (err) { console.warn("[Waka Reader] consume: kênh GM lỗi:", err && err.message); /* để kênh 1 / timeout xử lý */ }
          );
        });
      });
    }

    /* Trang đã tự kiểm tra thư viện (IndexedDB) và thấy sẵn sách cùng tiêu đề: gỡ lớp phủ
       "Đang chờ sách từ Waka..." ngay và báo cho tab waka.vn để nó hủy tải/dựng EPUB đang dở. */
    function reportTitleMatch(token) {
      token = String(token || "");
      Overlay.skip();
      try {
        if (w.opener && !w.opener.closed) {
          w.opener.postMessage({ __wakaReaderHandoff: 1, type: "titleFound", token: token }, "*");
        }
      } catch (e) { /* opener đã đóng */ }
    }

    return { consume: consume, reportTitleMatch: reportTitleMatch };
  })();

  /* ------------------------------------------------------------------ *
   * chrome.runtime / chrome.permissions
   * ------------------------------------------------------------------ */
  runtime.getURL = function (rel) {
    return new URL(String(rel || "").replace(/^\/+/, ""), ROOT).href;
  };
  runtime.getManifest = function () {
    return { name: "Waka EBook Reader", version: VERSION, manifest_version: 3 };
  };
  runtime.sendMessage = function (msg, cb) {
    var p = Promise.resolve().then(function () {
      msg = msg || {};
      if (msg.action === "consumeReaderEpub") return Handoff.consume(msg.token);
      if (msg.action === "reportTitleMatch") { Handoff.reportTitleMatch(msg.token); return { success: true }; }
      return { success: false, error: "Unsupported action: " + msg.action };
    });
    if (typeof cb === "function") {
      p.then(function (r) { runCb(cb, r); }, function (e) { runCb(cb, undefined, e); });
      return undefined;
    }
    return p;
  };
  runtime.onMessage = {
    addListener: function () {},
    removeListener: function () {},
    hasListener: function () { return false; },
  };

  var permissions = {
    contains: api(function () { return true; }),
    request: api(function () { return true; }),
  };

  var shim = { runtime: runtime, storage: storage, permissions: permissions };
  try {
    if (!w.chrome || typeof w.chrome !== "object") {
      w.chrome = shim;
    } else {
      Object.keys(shim).forEach(function (k) {
        Object.defineProperty(w.chrome, k, { value: shim[k], configurable: true, writable: true, enumerable: true });
      });
    }
  } catch (e) {
    try { Object.defineProperty(w, "chrome", { value: Object.assign({}, w.chrome, shim), configurable: true, writable: true }); }
    catch (e2) { console.error("[Waka Reader] Không cài được lớp tương thích chrome.*", e2); }
  }

  /* ------------------------------------------------------------------ *
   * Xin lưu trữ bền vững (IndexedDB chứa thư viện sách) — thay cho quyền
   * "unlimitedStorage" của extension. Chỉ hỏi 1 lần, sau thao tác đầu tiên
   * của người dùng (Firefox hiện hộp thoại xin phép).
   * ------------------------------------------------------------------ */
  (function persistStorage() {
    if (!(navigator.storage && navigator.storage.persist)) return;
    var FLAG = PREFIX + "__persistAsked";
    try { if (localStorage.getItem(FLAG)) return; } catch (e) {}
    function ask() {
      w.removeEventListener("pointerdown", ask, true);
      w.removeEventListener("keydown", ask, true);
      try { localStorage.setItem(FLAG, "1"); } catch (e) {}
      navigator.storage.persisted().then(function (p) { if (!p) return navigator.storage.persist(); }).catch(function () {});
    }
    w.addEventListener("pointerdown", ask, true);
    w.addEventListener("keydown", ask, true);
  })();
})();
