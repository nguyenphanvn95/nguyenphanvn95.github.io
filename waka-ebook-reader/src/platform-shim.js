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

  var VERSION = "1.0.3";
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

    /* Lớp phủ "Đang chờ sách từ Waka..." — chỉ khi tab được waka.vn mở sớm (token oc_…, có window.opener) */
    var Overlay = (function () {
      var el = null, statusEl = null, barEl = null, btn = null, removeTimer = 0;
      var params = new URLSearchParams(location.search);
      var token = params.get("importToken") || "";
      var enabled = token.indexOf("oc_") === 0 && !!w.opener;

      function build() {
        if (el || !enabled) return;
        var root = document.documentElement || document.body;
        if (!root) return setTimeout(build, 0);
        el = document.createElement("div");
        el.setAttribute("role", "status");
        el.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
          "background:rgba(10,18,18,.82);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);" +
          "font:500 15px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#fff;";
        el.innerHTML = '<div style="width:min(86vw,360px);text-align:center">' +
          '<div style="font-size:18px;font-weight:700;margin-bottom:14px">Đang mở sách từ Waka</div>' +
          '<div data-st style="min-height:22px;margin-bottom:14px;opacity:.9">Đang chờ sách từ Waka...</div>' +
          '<div style="height:6px;border-radius:99px;background:rgba(255,255,255,.22);overflow:hidden"><i data-bar style="display:block;height:100%;width:0;background:#2dd4bf;transition:width .25s ease"></i></div>' +
          '<button data-close type="button" style="display:none;margin-top:18px;height:40px;padding:0 22px;border-radius:99px;border:1.5px solid rgba(255,255,255,.8);background:transparent;color:#fff;font:inherit;cursor:pointer">Đóng</button>' +
          '</div>';
        statusEl = el.querySelector("[data-st]");
        barEl = el.querySelector("[data-bar]");
        btn = el.querySelector("[data-close]");
        btn.addEventListener("click", function () { remove(); });
        root.appendChild(el);
      }
      function remove() { clearTimeout(removeTimer); if (el && el.parentNode) el.parentNode.removeChild(el); el = null; }
      return {
        enabled: enabled,
        show: build,
        update: function (text, pct) {
          if (!enabled) return; build(); if (!el) return;
          if (text) statusEl.textContent = text;
          if (typeof pct === "number") barEl.style.width = Math.max(0, Math.min(100, pct)) + "%";
        },
        done: function () {
          if (!el) return;
          statusEl.textContent = "Đang nhập sách vào Reader...";
          barEl.style.width = "100%";
          removeTimer = setTimeout(remove, 1500);
        },
        error: function (msg) {
          if (!enabled) return; build(); if (!el) return;
          statusEl.textContent = "Lỗi: " + String(msg || "Không rõ nguyên nhân");
          barEl.style.background = "#f87171";
          btn.style.display = "inline-block";
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
          if (d.type === "progress") { Overlay.update(d.text, d.pct); armTimer(); return; }
          if (d.type === "error") { finish({ success: false, error: d.message || "Waka báo lỗi" }); return; }
          if (d.type !== "epub") return;
          console.info("[Waka Reader] consume: nhận EPUB qua kênh opener");
          toDataUrl(d).then(
            function (dataUrl) { finish({ success: true, filename: d.filename || "waka.epub", dataUrl: dataUrl }); },
            function (err) { finish({ success: false, error: err.message }); }
          );
        }
        w.addEventListener("message", onMsg);
        armTimer();

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
    return { consume: consume };
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
