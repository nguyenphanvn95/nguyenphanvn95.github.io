// js/db.js
//
// Lưu trữ offline bằng IndexedDB:
// - books: file epub gốc (ArrayBuffer) + metadata + vị trí đọc cuối + bookmark
// - settings: cỡ chữ, theme, font, chế độ đọc (lưu trong chrome.storage.local)

const DB_NAME = "epub-reader-db";
// v2: thêm store "music" để lưu playlist nhạc nền (xem MusicDB bên dưới) —
// không đụng tới store "books" đã có, onupgradeneeded chỉ bổ sung thêm.
const DB_VERSION = 2;
const STORE_BOOKS = "books";
const STORE_MUSIC = "music";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        const store = db.createObjectStore(STORE_BOOKS, { keyPath: "id" });
        store.createIndex("lastOpened", "lastOpened", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MUSIC)) {
        db.createObjectStore(STORE_MUSIC, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKS, mode);
    const store = tx.objectStore(STORE_BOOKS);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

async function hashBuffer(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const BookDB = {
  /**
   * Lưu (hoặc cập nhật) 1 cuốn sách vào thư viện.
   */
  async saveBook({ id, fileName, title, creator, coverBlob, buffer, language, publisher, description, rights, identifier, pubDate, subject, series, seriesIndex, spineCount }) {
    const existing = await this.getBook(id);
    const record = {
      id,
      fileName,
      title,
      creator,
      language: language || "",
      publisher: publisher || "",
      description: description || "",
      rights: rights || "",
      identifier: identifier || "",
      pubDate: pubDate || "",
      subject: subject || "",
      series: series || (existing && existing.series) || "",
      seriesIndex: seriesIndex || (existing && existing.seriesIndex) || 0,
      spineCount: spineCount || (existing && existing.spineCount) || 0,
      fileSize: buffer ? buffer.byteLength : (existing && existing.fileSize) || 0,
      coverBlob: coverBlob || (existing && existing.coverBlob) || null,
      buffer: buffer || (existing && existing.buffer),
      addedAt: (existing && existing.addedAt) || Date.now(),
      lastOpened: (existing && existing.lastOpened) || Date.now(),
      position: (existing && existing.position) || null, // { spineIndex, scrollFraction }
      bookmarks: (existing && existing.bookmarks) || [], // [{ spineIndex, scrollFraction, label, createdAt }]
      // phần thêm cho Annotation: [{ id, spineIndex, chapterTitle, quote, prefix, suffix,
      //   charStart, color, note, type: "annotation"|"definition", createdAt, updatedAt }]
      annotations: (existing && existing.annotations) || [],
    };
    await withStore("readwrite", (store) => store.put(record));
    return record;
  },

  async getBook(id) {
    return withStore("readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }).then((p) => p);
  },

  async listBooks() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, "readonly");
      const store = tx.objectStore(STORE_BOOKS);
      const req = store.getAll();
      req.onsuccess = () => {
        const books = req.result || [];
        books.sort((a, b) => b.lastOpened - a.lastOpened);
        resolve(books);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async deleteBook(id) {
    return withStore("readwrite", (store) => store.delete(id));
  },

  async deleteBooks(ids) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async updatePosition(id, position) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve(null);
        record.position = position;
        record.lastOpened = Date.now();
        store.put(record);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async addBookmark(id, bookmark) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve(null);
        record.bookmarks = record.bookmarks || [];
        record.bookmarks.push(bookmark);
        store.put(record);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async removeBookmark(id, createdAt) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve(null);
        record.bookmarks = (record.bookmarks || []).filter((b) => b.createdAt !== createdAt);
        store.put(record);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  /* ---------------------------------------------------------- phần thêm cho Annotation */

  async addAnnotation(id, annotation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve(null);
        record.annotations = record.annotations || [];
        record.annotations.push(annotation);
        store.put(record);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async updateAnnotation(id, annotationId, patch) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve(null);
        record.annotations = record.annotations || [];
        const idx = record.annotations.findIndex((a) => a.id === annotationId);
        if (idx >= 0) record.annotations[idx] = { ...record.annotations[idx], ...patch };
        store.put(record);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async removeAnnotation(id, annotationId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve(null);
        record.annotations = (record.annotations || []).filter((a) => a.id !== annotationId);
        store.put(record);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  hashBuffer,
};

window.BookDB = BookDB;

/* ════════════════════════════════════════════════════════════════
   MusicDB — lưu playlist nhạc nền (bảng nhạc nền) để không phải
   nhập/chọn lại file mỗi lần mở lại reader. Lưu trực tiếp Blob file
   nhạc vào IndexedDB (store "music"), keyPath "id" tự tăng nên
   listTracks() trả về đúng thứ tự đã thêm.
════════════════════════════════════════════════════════════════ */

async function withMusicStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MUSIC, mode);
    const store = tx.objectStore(STORE_MUSIC);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

const MusicDB = {
  /** Thêm 1 bài nhạc (Blob/File) vào playlist đã lưu. Trả về id vừa tạo. */
  async addTrack({ name, blob, type = "local", videoId = "", sourceUrl = "" }) {
    const trackType = type === "youtube" ? "youtube" : "local";
    if (trackType === "local" && !blob) {
      throw new Error("MusicDB.addTrack: local track requires blob");
    }
    if (trackType === "youtube" && !videoId) {
      throw new Error("MusicDB.addTrack: YouTube track requires videoId");
    }
    const record = trackType === "youtube"
      ? { name, type: "youtube", videoId, sourceUrl, addedAt: Date.now() }
      : { name, type: "local", blob, addedAt: Date.now() };
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MUSIC, "readwrite");
      const store = tx.objectStore(STORE_MUSIC);
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  /** Lấy toàn bộ playlist đã lưu, theo đúng thứ tự đã thêm. */
  async listTracks() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MUSIC, "readonly");
      const store = tx.objectStore(STORE_MUSIC);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  /** Xoá 1 bài khỏi playlist đã lưu. */
  async removeTrack(id) {
    return withMusicStore("readwrite", (store) => store.delete(id));
  },
};

window.MusicDB = MusicDB;
