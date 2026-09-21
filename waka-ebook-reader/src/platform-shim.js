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

  var VERSION = "1.0.0";
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

    function present() {
      return !!document.documentElement && document.documentElement.hasAttribute("data-waka-reader-userscript");
    }
    function waitPresent(ms) {
      return new Promise(function (resolve) {
        var t0 = Date.now();
        (function poll() {
          if (present()) return resolve(true);
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
    return { present: present, waitPresent: waitPresent, call: call };
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
    var TIMEOUT_MS = 45000;

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
        function finish(res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          w.removeEventListener("message", onMsg);
          resolve(res);
        }
        function onMsg(e) {
          var d = e.data;
          if (!d || d.__wakaReaderHandoff !== 1 || d.type !== "epub" || d.token !== token) return;
          if (ALLOWED_ORIGINS.indexOf(e.origin) < 0) return;
          toDataUrl(d).then(
            function (dataUrl) { finish({ success: true, filename: d.filename || "waka.epub", dataUrl: dataUrl }); },
            function (err) { finish({ success: false, error: err.message }); }
          );
        }
        w.addEventListener("message", onMsg);
        timer = setTimeout(function () {
          finish({ success: false, error: "Hết thời gian chờ EPUB từ trang Waka — hãy mở lại bằng nút Reader trên waka.vn" });
        }, TIMEOUT_MS);

        // Kênh 1: cửa sổ đã mở reader (window.opener) — nhanh, không qua bộ nhớ GM.
        try {
          if (w.opener && !w.opener.closed) {
            w.opener.postMessage({ __wakaReaderHandoff: 1, type: "ready", token: token }, "*");
          }
        } catch (e) { /* opener bị chặn */ }

        // Kênh 2: userscript (trình duyệt cắt opener, ví dụ noopener / một số bản mobile).
        // Nếu có opener thì nhường kênh 1 ~2 giây trước, tránh chuyển dữ liệu hai lần.
        var gmDelay = (w.opener && !w.opener.closed) ? 2000 : 0;
        new Promise(function (r) { setTimeout(r, gmDelay); })
          .then(function () { return done ? false : Bridge.waitPresent(3000); })
          .then(function (ok) {
          if (!ok || done) return;
          Bridge.call("consume", { token: token }, TIMEOUT_MS).then(
            function (d) { finish({ success: true, filename: d.filename || "waka.epub", dataUrl: d.dataUrl }); },
            function () { /* để kênh 1 / timeout xử lý */ }
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
