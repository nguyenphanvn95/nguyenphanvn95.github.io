// dropbox-sync.js — Đồng bộ thư viện lên/từ Dropbox (App folder, OAuth 2.0 PKCE).
//
// Chạy sau db.js + app.js (cần cả window.BookDB lẫn window.ReaderApp), trước
// library-ui.js/library-mobile.js (2 file đó gọi window.DropboxSync.mountSyncBlock
// và window.DropboxSync.syncNow). Không có build step nên toàn bộ là 1 file thuần,
// theo đúng phong cách IIFE các file khác trong thư mục này.
//
// Kiến trúc dữ liệu trên Dropbox (App folder riêng của app):
//   /manifest.json            [{ id, fileName, title, creator, updatedAt,
//                                hasPosition, hasBookmarks, hasAnnotations }, ...]
//   /books/<id>.epub          đúng bytes của record.buffer (chỉ ghi khi chưa có / đổi)
//   /books/<id>.meta.json     metadata + position/bookmarks/annotations (KHÔNG có buffer/coverBlob)
//
// Lên Dropbox (upload) = tự động, có debounce, bám theo sự kiện "waka:book-changed"
// mà db.js bắn ra sau mỗi lần ghi. Từ Dropbox (download) = thủ công, bấm nút mới bắt đầu.
//
// Đồng bộ 2 chiều, ưu tiên dữ liệu trình duyệt (local) là bản "mới hơn":
//   - Lên (uploadAllNow / periodicSafetyScan): sau khi đẩy đủ sách cục bộ, DỌN trên
//     Dropbox mọi sách KHÔNG còn trong thư viện cục bộ (xoá .epub + .meta.json + entry
//     trong manifest) → dữ liệu Dropbox khớp hệt trình duyệt.
//   - Xuống (syncNow): sách đã có sẵn cục bộ (trùng id = trùng buffer byte-for-byte) thì
//     BỎ QUA việc hỏi ghi đè — chỉ luôn đồng bộ tiến trình đọc/bookmark/ghi chú (meta.json)
//     từ Dropbox xuống, không tải lại .epub.

(() => {
  "use strict";

  const app = () => window.ReaderApp || {};
  const tr = (key, params, fallback) => {
    const value = window.I18n?.t?.(key, params);
    return value && value !== key ? value : (fallback || key);
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Cần tạo 1 app tại https://www.dropbox.com/developers/apps (loại Scoped App,
  // quyền "App folder"), rồi điền App Key vào đây. Redirect URI khai báo trong
  // Dropbox App Console phải khớp CHÍNH XÁC:
  // https://nguyenphanvn95.github.io/waka-ebook-reader/src/reader.html
  const DROPBOX_APP_KEY = "txjev524hdzy123";
  const REDIRECT_URI = "https://nguyenphanvn95.github.io/waka-ebook-reader/src/reader.html";

  const STORAGE_AUTH_KEY = "dropboxAuth"; // { accessToken, refreshToken, expiresAt, accountEmail }
  const STORAGE_AUTOSYNC_KEY = "dropboxAutoSyncMinutes"; // 0/3/5/10/20
  const SS_VERIFIER_KEY = "dropboxPkceVerifier";
  const SS_STATE_KEY = "dropboxPkceState";

  const UPLOAD_DEBOUNCE_MS = 9000;
  const AUTOSYNC_OPTIONS = [0, 3, 5, 10, 20];

  /* ---------------------------------------------------------- storage helpers */
  // Dùng chrome.storage.local (thật hoặc qua shim của platform-shim.js) để tự
  // đồng bộ giữa các tab đang mở, đúng quy ước "cài đặt" đã dùng ở app.js.

  function storageGet(key) {
    return Promise.resolve().then(() => chrome.storage.local.get([key])).then((res) => res?.[key]);
  }
  function storageSet(key, value) {
    return Promise.resolve().then(() => chrome.storage.local.set({ [key]: value }));
  }
  function storageRemove(key) {
    return Promise.resolve().then(() => chrome.storage.local.remove(key));
  }

  /* ---------------------------------------------------------- state phiên chạy */

  let auth = null; // nạp từ storage lúc init(); null = chưa đăng nhập
  let autoSyncMinutes = 0;
  let autoSyncTimer = null;
  let mountedBlocks = []; // các <div id="rp-sync-block"/"lib-sync-block"> đang hiển thị, để cập nhật UI khi đổi trạng thái
  let pendingIds = new Set(); // hàng đợi upload (debounce)
  let uploadDebounceTimer = null;
  let uploadInFlight = false;
  let manifestCache = null; // cache /manifest.json trong lúc syncNow() đang chạy

  /* ---------------------------------------------------------- PKCE + OAuth */

  function base64url(bytes) {
    let str = "";
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomString(len) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return base64url(bytes).slice(0, len);
  }

  async function sha256Base64Url(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64url(new Uint8Array(digest));
  }

  async function login() {
    if (!DROPBOX_APP_KEY) {
      app().toast?.(tr("dropbox.noAppKey", null, "Chưa cấu hình Dropbox App Key (xem đầu file dropbox-sync.js)."), true);
      return;
    }
    const verifier = randomString(64);
    const state = randomString(24);
    try {
      sessionStorage.setItem(SS_VERIFIER_KEY, verifier);
      sessionStorage.setItem(SS_STATE_KEY, state);
    } catch { /* sessionStorage có thể bị chặn (Private mode) — không chặn luồng chính */ }
    const challenge = await sha256Base64Url(verifier);
    const url = new URL("https://www.dropbox.com/oauth2/authorize");
    url.searchParams.set("client_id", DROPBOX_APP_KEY);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("token_access_type", "offline");
    url.searchParams.set("state", state);
    location.href = url.toString();
  }

  async function logout() {
    auth = null;
    await storageRemove(STORAGE_AUTH_KEY);
    stopAutoSyncTimer();
    refreshMountedBlocks();
    app().toast?.(tr("dropbox.loggedOut", null, "Đã đăng xuất khỏi Dropbox."));
  }

  /** Xử lý redirect `?code=&state=` khi reader.html load lại sau khi cấp quyền. */
  async function handleOAuthRedirect() {
    const params = new URLSearchParams(location.search || "");
    const code = params.get("code");
    const state = params.get("state");
    if (!code) return;

    let savedState, verifier;
    try {
      savedState = sessionStorage.getItem(SS_STATE_KEY);
      verifier = sessionStorage.getItem(SS_VERIFIER_KEY);
      sessionStorage.removeItem(SS_STATE_KEY);
      sessionStorage.removeItem(SS_VERIFIER_KEY);
    } catch { /* ignore */ }

    // Dọn URL ngay (đúng convention importToken ở app.js) dù thành công hay lỗi,
    // tránh đăng nhập lặp lại khi người dùng tải lại trang.
    try { history.replaceState(null, "", location.pathname); } catch { /* ignore */ }

    if (!code || !state || state !== savedState || !verifier) {
      if (code) app().toast?.(tr("dropbox.stateMismatch", null, "Phiên đăng nhập Dropbox không hợp lệ, hãy thử lại."), true);
      return;
    }

    app().loading?.(true, tr("dropbox.loggingIn", null, "Đang đăng nhập Dropbox…"));
    try {
      const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          client_id: DROPBOX_APP_KEY,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error_summary || `HTTP ${res.status}`);
      auth = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 14400) * 1000,
        accountEmail: "",
      };
      await fetchAccountEmail();
      await storageSet(STORAGE_AUTH_KEY, auth);
      app().loading?.(false);
      app().toast?.(tr("dropbox.loginSuccess", null, "Đăng nhập Dropbox thành công."));
      refreshMountedBlocks();
      startAutoSyncTimerIfNeeded();
    } catch (err) {
      console.error("[DropboxSync] OAuth error:", err);
      app().loading?.(false);
      app().toast?.(tr("dropbox.loginError", { message: err.message }, "Đăng nhập Dropbox thất bại: " + err.message), true);
    }
  }

  async function fetchAccountEmail() {
    try {
      const res = await apiCall("https://api.dropboxapi.com/2/users/get_current_account", {}, true);
      if (auth) auth.accountEmail = res?.email || "";
    } catch (err) {
      console.warn("[DropboxSync] Không lấy được email tài khoản:", err);
    }
  }

  async function ensureFreshToken() {
    if (!auth) throw new Error("Chưa đăng nhập Dropbox");
    if (auth.expiresAt - Date.now() > 60000) return; // còn hạn > 1 phút, dùng tiếp
    if (!auth.refreshToken) throw new Error("Thiếu refresh token, hãy đăng nhập lại");
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
        client_id: DROPBOX_APP_KEY,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error_summary || `HTTP ${res.status}`);
    auth.accessToken = data.access_token;
    auth.expiresAt = Date.now() + (Number(data.expires_in) || 14400) * 1000;
    await storageSet(STORAGE_AUTH_KEY, auth);
  }

  /* ---------------------------------------------------------- gọi Dropbox API */

  /**
   * Gọi 1 API JSON của Dropbox (api.dropboxapi.com/2/...). `skipAuthCheck=true`
   * dùng riêng cho fetchAccountEmail() lúc auth vừa nhận token mới (chưa lưu vào
   * biến `auth` kịp refresh logic bình thường).
   */
  async function apiCall(url, body, skipAuthCheck) {
    if (!skipAuthCheck) await ensureFreshToken();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + auth.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || null),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Dropbox API ${res.status}: ${errText.slice(0, 200)}`);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res;
  }

  async function apiUpload(path, data) {
    await ensureFreshToken();
    const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + auth.accessToken,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", mute: true }),
      },
      body: data,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Dropbox upload ${res.status}: ${errText.slice(0, 200)}`);
    }
    return res.json();
  }

  async function apiDownload(path) {
    await ensureFreshToken();
    const res = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + auth.accessToken,
        "Dropbox-API-Arg": JSON.stringify({ path }),
      },
    });
    if (res.status === 409) return null; // path/not_found
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Dropbox download ${res.status}: ${errText.slice(0, 200)}`);
    }
    return res.arrayBuffer();
  }

  async function apiDownloadJson(path) {
    const buf = await apiDownload(path);
    if (buf == null) return null;
    try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
  }

  async function apiDeletePath(path) {
    try {
      await apiCall("https://api.dropboxapi.com/2/files/delete_v2", { path });
    } catch (err) {
      // path/not_found: không có gì để xoá, bỏ qua lặng lẽ
      if (!/not_found/i.test(err.message)) console.warn("[DropboxSync] delete lỗi:", err);
    }
  }

  /* ---------------------------------------------------------- manifest.json */

  async function readManifest() {
    const list = await apiDownloadJson("/manifest.json");
    return Array.isArray(list) ? list : [];
  }

  async function writeManifest(list) {
    const body = new TextEncoder().encode(JSON.stringify(list));
    await apiUpload("/manifest.json", body);
  }

  function manifestEntryFor(record) {
    return {
      id: record.id,
      fileName: record.fileName || "",
      title: record.title || "",
      creator: record.creator || "",
      updatedAt: Date.now(),
      hasPosition: !!record.position,
      hasBookmarks: !!(record.bookmarks && record.bookmarks.length),
      hasAnnotations: !!(record.annotations && record.annotations.length),
    };
  }

  function metaFromRecord(record) {
    // Toàn bộ field của record, TRỪ buffer/coverBlob (nặng, không cần cho meta.json).
    const { buffer, coverBlob, ...meta } = record;
    meta.updatedAt = Date.now();
    return meta;
  }

  /* ---------------------------------------------------------- upload lên Dropbox (tự động) */

  /** Upload 1 cuốn: chỉ upload lại .epub nếu Dropbox CHƯA có file cùng id (id = hash buffer). */
  async function uploadOneBook(id) {
    const record = await window.BookDB.getBook(id);
    if (!record) return; // đã bị xoá trước khi debounce kịp chạy — bỏ qua, uploadOneDelete lo phần xoá
    const epubPath = `/books/${id}.epub`;
    const metaPath = `/books/${id}.meta.json`;

    // Kiểm tra .epub đã có trên Dropbox chưa (id = SHA-256 của buffer → cùng id chắc chắn
    // cùng nội dung, không cần tải lại để so sánh byte-for-byte).
    let hasEpub = false;
    try {
      await apiCall("https://api.dropboxapi.com/2/files/get_metadata", { path: epubPath });
      hasEpub = true;
    } catch { hasEpub = false; }

    if (!hasEpub && record.buffer) {
      await apiUpload(epubPath, record.buffer);
    }
    await apiUpload(metaPath, new TextEncoder().encode(JSON.stringify(metaFromRecord(record))));

    // Cập nhật đúng 1 dòng trong manifest.json (đọc–sửa–ghi; đủ dùng cho quy mô thư viện cá nhân).
    const list = await readManifest();
    const idx = list.findIndex((it) => it.id === id);
    const entry = manifestEntryFor(record);
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    await writeManifest(list);
  }

  async function uploadOneDelete(id) {
    await apiDeletePath(`/books/${id}.epub`);
    await apiDeletePath(`/books/${id}.meta.json`);
    const list = await readManifest();
    const next = list.filter((it) => it.id !== id);
    if (next.length !== list.length) await writeManifest(next);
  }

  /**
   * Dọn trên Dropbox mọi entry manifest KHÔNG còn nằm trong `localIds` (sách đã bị xoá
   * khỏi trình duyệt bằng cách nào đó — kể cả khi sự kiện "waka:book-changed" bị bỏ lỡ,
   * vd. xoá lúc offline/mất mạng). Trả về số sách đã dọn để hiện trong toast tổng kết.
   * Không đụng tới sách nào có id nằm trong `localIds`.
   */
  async function cleanupRemoteExtras(localIds) {
    const localIdSet = new Set(localIds);
    const list = await readManifest();
    const toRemove = list.filter((it) => !localIdSet.has(it.id));
    if (!toRemove.length) return 0;
    for (const entry of toRemove) {
      try {
        await apiDeletePath(`/books/${entry.id}.epub`);
        await apiDeletePath(`/books/${entry.id}.meta.json`);
      } catch (err) {
        console.warn("[DropboxSync] Lỗi dọn sách thừa trên Dropbox", entry.id, err);
      }
    }
    // Ghi lại manifest 1 lần duy nhất (đọc lại để tránh đè lên thay đổi xen giữa lúc xoá).
    const latest = await readManifest();
    const latestLocalIds = localIdSet;
    const next = latest.filter((it) => latestLocalIds.has(it.id));
    if (next.length !== latest.length) await writeManifest(next);
    return toRemove.length;
  }

  /** Xử lý hàng đợi debounce: gộp mọi id đổi trong ~9s gần nhất, upload tuần tự. */
  async function flushUploadQueue() {
    if (uploadInFlight || !pendingIds.size) return;
    if (!auth || autoSyncMinutes === 0) { pendingIds.clear(); return; }
    uploadInFlight = true;
    const ids = Array.from(pendingIds);
    pendingIds.clear();
    for (const item of ids) {
      try {
        if (item.deleted) await uploadOneDelete(item.id);
        else await uploadOneBook(item.id);
      } catch (err) {
        console.warn("[DropboxSync] upload lỗi cho", item.id, err);
        // Không throw tiếp — 1 cuốn lỗi không nên chặn các cuốn khác trong hàng đợi.
      }
    }
    uploadInFlight = false;
    if (pendingIds.size) flushUploadQueue(); // có thay đổi mới tới trong lúc đang chạy
  }

  function queueUpload(id, deleted) {
    if (!id) return;
    // Loại bỏ mục cũ cùng id trước khi thêm lại (Set theo object nên không tự dedupe) —
    // đơn giản hoá bằng cách lưu thẳng theo id trong 1 Map ẩn dưới dạng thuộc tính.
    for (const it of pendingIds) if (it.id === id) pendingIds.delete(it);
    pendingIds.add({ id, deleted: !!deleted });
    clearTimeout(uploadDebounceTimer);
    uploadDebounceTimer = setTimeout(flushUploadQueue, UPLOAD_DEBOUNCE_MS);
  }

  function requestUploadFlush(reason) {
    // Được gọi nội bộ bởi handler "waka:book-changed" — giữ lại như API public
    // để nơi khác có thể ép chạy ngay hàng đợi hiện có nếu cần (vd. trước khi đóng tab).
    clearTimeout(uploadDebounceTimer);
    flushUploadQueue();
  }

  document.addEventListener("waka:book-changed", (e) => {
    const detail = e.detail || {};
    if (!auth || autoSyncMinutes === 0) return;
    if (detail.reason === "delete-bulk" && Array.isArray(detail.ids)) {
      detail.ids.forEach((id) => queueUpload(id, true));
      return;
    }
    if (!detail.id) return;
    queueUpload(detail.id, detail.reason === "delete");
  });

  /* ---------------------------------------------------------- quét định kỳ (an toàn dự phòng) */

  /** Quét toàn bộ thư viện cục bộ, đối chiếu manifest, upload phần còn thiếu/lệch. */
  async function periodicSafetyScan() {
    if (!auth || autoSyncMinutes === 0) return;
    try {
      const [books, list] = await Promise.all([window.BookDB.listBooks(), readManifest()]);
      const byId = new Map(list.map((it) => [it.id, it]));
      for (const b of books) {
        const entry = byId.get(b.id);
        const changed = !entry
          || entry.hasPosition !== !!b.position
          || entry.hasBookmarks !== !!(b.bookmarks && b.bookmarks.length)
          || entry.hasAnnotations !== !!(b.annotations && b.annotations.length);
        if (changed) queueUpload(b.id, false);
      }
      // Dọn luôn sách thừa trên Dropbox không còn trong thư viện cục bộ (phòng khi sự
      // kiện xoá ở nơi khác bị bỏ lỡ, vd. xoá lúc mất mạng). Việc dọn chỉ dựa trên danh
      // sách id cục bộ hiện tại nên không cần chờ hàng đợi upload phía trên xong.
      await cleanupRemoteExtras(books.map((b) => b.id));
    } catch (err) {
      console.warn("[DropboxSync] Quét định kỳ lỗi:", err);
    }
  }

  function stopAutoSyncTimer() {
    if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
  }

  function startAutoSyncTimerIfNeeded() {
    stopAutoSyncTimer();
    if (!auth || autoSyncMinutes === 0) return;
    autoSyncTimer = setInterval(periodicSafetyScan, autoSyncMinutes * 60 * 1000);
  }

  async function setAutoSyncMinutes(n) {
    autoSyncMinutes = AUTOSYNC_OPTIONS.includes(Number(n)) ? Number(n) : 0;
    await storageSet(STORAGE_AUTOSYNC_KEY, autoSyncMinutes);
    startAutoSyncTimerIfNeeded();
  }

  /* ---------------------------------------------------------- tải LÊN (thủ công, nút "Đồng bộ ngay") */

  /**
   * Đẩy toàn bộ thư viện cục bộ hiện có lên Dropbox ngay lập tức (không chờ debounce 9s,
   * không chờ chu kỳ tự động). Dùng lại `uploadOneBook()` — file .epub chỉ upload nếu
   * Dropbox chưa có (so theo id = hash buffer), phần .meta.json luôn ghi đè bằng bản mới
   * nhất từ IndexedDB. Không đụng tới sách đã bị xoá cục bộ (việc xoá trên Dropbox đã do
   * `uploadOneDelete()` xử lý riêng qua sự kiện "waka:book-changed" lúc xoá sách).
   */
  async function uploadAllNow() {
    if (!auth) {
      app().toast?.(tr("dropbox.loginRequired", null, "Hãy đăng nhập Dropbox trước."), true);
      return;
    }
    if (uploadInFlight) {
      app().toast?.(tr("dropbox.uploadBusy", null, "Đang đồng bộ lên Dropbox, vui lòng đợi…"), true);
      return;
    }
    // Huỷ hàng đợi debounce đang chờ — các cuốn đó sẽ được xử lý trong lượt quét toàn bộ này luôn.
    clearTimeout(uploadDebounceTimer);
    pendingIds.clear();
    uploadInFlight = true;
    app().loading?.(true, tr("dropbox.uploadingNow", null, "Đang đồng bộ lên Dropbox…"));
    let ok = 0, failed = 0, removed = 0;
    try {
      const books = await window.BookDB.listBooks();
      for (const b of books) {
        try {
          await uploadOneBook(b.id);
          ok++;
        } catch (err) {
          console.warn("[DropboxSync] Đồng bộ ngay lỗi cho", b.id, err);
          failed++;
        }
      }
      // Dọn trên Dropbox mọi sách không còn trong thư viện cục bộ (ưu tiên dữ liệu
      // trình duyệt — trình duyệt không có thì Dropbox cũng không được giữ).
      try {
        removed = await cleanupRemoteExtras(books.map((b) => b.id));
      } catch (err) {
        console.warn("[DropboxSync] Dọn sách thừa trên Dropbox lỗi:", err);
      }
      app().toast?.(tr("dropbox.uploadNowSummary", { ok, failed, removed },
        `Đã đồng bộ ${ok} sách lên Dropbox, ${failed} sách lỗi, dọn ${removed} sách thừa.`));
    } catch (err) {
      console.error("[DropboxSync] uploadAllNow lỗi:", err);
      app().toast?.(tr("dropbox.syncError", { message: err.message }, "Đồng bộ Dropbox thất bại: " + err.message), true);
    } finally {
      uploadInFlight = false;
      app().loading?.(false);
      if (pendingIds.size) flushUploadQueue(); // có thay đổi mới tới trong lúc đang chạy
    }
  }

  /* ---------------------------------------------------------- tải XUỐNG (thủ công) */

  /** Áp dữ liệu (position/bookmarks/annotations) từ Dropbox vào 1 record cục bộ đã có sẵn (trùng id). */
  async function applyRemoteMetaToLocal(id, meta) {
    if (!meta) return;
    if (meta.position) await window.BookDB.updatePosition(id, meta.position);
    if (Array.isArray(meta.bookmarks) || Array.isArray(meta.annotations)) {
      const record = await window.BookDB.getBook(id);
      if (record) {
        await window.BookDB.saveBook({
          ...record,
          bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks : record.bookmarks,
          annotations: Array.isArray(meta.annotations) ? meta.annotations : record.annotations,
        });
      }
    }
  }

  /** Nhập 1 cuốn hoàn toàn mới (chưa có trong thư viện cục bộ) từ Dropbox. */
  async function importNewBookFromDropbox(entry) {
    const epubBuf = await apiDownload(`/books/${entry.id}.epub`);
    if (!epubBuf) return false; // epub không còn trên Dropbox (bị xoá tay?) — bỏ qua mục này
    const meta = await apiDownloadJson(`/books/${entry.id}.meta.json`);
    const fileName = (meta && meta.fileName) || entry.fileName || `${entry.title || "book"}.epub`;
    const file = new File([epubBuf], fileName, { type: "application/epub+zip" });
    const { record } = await app().addBookFromFile(file);
    if (meta) {
      await window.BookDB.saveBook({
        ...record,
        position: meta.position || null,
        bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks : [],
        annotations: Array.isArray(meta.annotations) ? meta.annotations : [],
      });
    }
    return true;
  }

  async function syncNow() {
    if (!auth) {
      app().toast?.(tr("dropbox.loginRequired", null, "Hãy đăng nhập Dropbox trước."), true);
      return;
    }
    app().loading?.(true, tr("dropbox.syncing", null, "Đang đồng bộ từ Dropbox…"));
    let added = 0, updated = 0, skipped = 0;
    try {
      const [list, localBooks] = await Promise.all([readManifest(), window.BookDB.listBooks()]);
      const localById = new Map(localBooks.map((b) => [b.id, b]));

      for (const entry of list) {
        const local = localById.get(entry.id);
        if (!local) {
          try {
            const ok = await importNewBookFromDropbox(entry);
            if (ok) added++; else skipped++;
          } catch (err) {
            console.warn("[DropboxSync] Lỗi nhập sách mới", entry.id, err);
            skipped++;
          }
          continue;
        }

        // id trùng = buffer trùng byte-for-byte → sách đã có sẵn cục bộ, KHÔNG tải lại
        // .epub và KHÔNG hỏi ghi đè nữa — luôn đồng bộ tiến trình đọc/bookmark/ghi chú
        // xuống từ Dropbox (dữ liệu trình duyệt sau đó khớp hệt Dropbox).
        try {
          const meta = await apiDownloadJson(`/books/${entry.id}.meta.json`);
          await applyRemoteMetaToLocal(entry.id, meta);
          updated++;
        } catch (err) {
          console.warn("[DropboxSync] Lỗi cập nhật sách", entry.id, err);
          skipped++;
        }
      }

      await app().renderLibrary?.();
      app().loading?.(false);
      app().toast?.(tr("dropbox.summary", { added, updated, skipped },
        `Đã thêm ${added} sách mới, cập nhật ${updated} sách, bỏ qua ${skipped} sách.`));
    } catch (err) {
      console.error("[DropboxSync] syncNow lỗi:", err);
      app().loading?.(false);
      app().toast?.(tr("dropbox.syncError", { message: err.message }, "Đồng bộ Dropbox thất bại: " + err.message), true);
    }
  }

  /* ---------------------------------------------------------- UI: khối đăng nhập + chu kỳ */

  function syncBlockHtml() {
    const loggedIn = !!auth;
    return `
      <div class="dbx-row">
        ${loggedIn
          ? `<span class="dbx-account" title="${esc(auth.accountEmail || "")}">${esc(tr("dropbox.loggedInAs", { email: auth.accountEmail || "…" }, "Đã đăng nhập: " + (auth.accountEmail || "…")))}</span>
             <button type="button" class="rp-chip" id="dbx-logout-btn">${esc(tr("dropbox.logout", null, "Đăng xuất"))}</button>`
          : `<button type="button" class="rp-chip" id="dbx-login-btn">${esc(tr("dropbox.login", null, "Đăng nhập vào Dropbox"))}</button>`}
      </div>
      <div class="dbx-row">
        <button type="button" class="rp-chip" id="dbx-upload-now-btn" ${loggedIn ? "" : "disabled"}>${esc(tr("dropbox.uploadNow", null, "Đồng bộ ngay"))}</button>
      </div>
      <div class="dbx-row">
        <span class="rp-label" style="flex:none">${esc(tr("dropbox.autoSync", null, "Tự động đồng bộ"))}</span>
        <select class="rp-select" id="dbx-autosync-select" ${loggedIn ? "" : "disabled"}>
          ${AUTOSYNC_OPTIONS.map((m) => `<option value="${m}"${m === autoSyncMinutes ? " selected" : ""}>${m === 0 ? esc(tr("dropbox.autoSyncOff", null, "Tắt")) : m + " phút"}</option>`).join("")}
        </select>
      </div>`;
  }

  function mountSyncBlock(container) {
    if (!container) return;
    render();
    if (!mountedBlocks.includes(container)) mountedBlocks.push(container);

    function render() {
      container.innerHTML = syncBlockHtml();
      const loginBtn = container.querySelector("#dbx-login-btn");
      const logoutBtn = container.querySelector("#dbx-logout-btn");
      const uploadNowBtn = container.querySelector("#dbx-upload-now-btn");
      const sel = container.querySelector("#dbx-autosync-select");
      if (loginBtn) loginBtn.addEventListener("click", () => login());
      if (logoutBtn) logoutBtn.addEventListener("click", () => logout());
      if (uploadNowBtn) uploadNowBtn.addEventListener("click", () => uploadAllNow());
      if (sel) sel.addEventListener("change", () => setAutoSyncMinutes(Number(sel.value)));
    }
  }

  function refreshMountedBlocks() {
    mountedBlocks = mountedBlocks.filter((el) => el.isConnected);
    mountedBlocks.forEach((el) => mountSyncBlock(el));
  }

  /* ---------------------------------------------------------- khởi động */

  async function init() {
    const [savedAuth, savedMinutes] = await Promise.all([
      storageGet(STORAGE_AUTH_KEY),
      storageGet(STORAGE_AUTOSYNC_KEY),
    ]);
    if (savedAuth && savedAuth.accessToken) auth = savedAuth;
    autoSyncMinutes = AUTOSYNC_OPTIONS.includes(Number(savedMinutes)) ? Number(savedMinutes) : 0;
    startAutoSyncTimerIfNeeded();
    await handleOAuthRedirect();
  }

  window.DropboxSync = {
    isLoggedIn: () => !!auth,
    login,
    logout,
    getAccountEmail: () => (auth ? auth.accountEmail || "" : ""),
    getAutoSyncMinutes: () => autoSyncMinutes,
    setAutoSyncMinutes,
    syncNow,
    uploadNow: uploadAllNow,
    requestUploadFlush,
    /* dùng nội bộ bởi library-ui.js / library-mobile.js để vẽ khối đăng nhập + chu kỳ */
    mountSyncBlock,
  };

  init();
})();
