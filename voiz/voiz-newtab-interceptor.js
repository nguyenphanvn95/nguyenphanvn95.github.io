// voiz-newtab-interceptor.js (MAIN world)
// Phần của Mydio & Voiz Toolkit v6.7 – tính năng mở link sách ở tab mới.
//
// Chạy trong MAIN world (cùng ngữ cảnh JS với trang voiz.vn), vì content script
// isolated world không bắt được request mà React app tự gọi.
//
// Bắt mọi response JSON từ api.voiz.vn, trích mảng object giống "sách"
// (id, name, avatar + total_duration/coin_price/playlist_counter/author_string),
// rồi phát CustomEvent để voiz-newtab-content.js gắn link "Nghe sách".

(function () {
  var EVENT_NAME = "__voiz_newtab_books_found__";
  var API_HOST_RE = /(^|\.)api\.voiz\.vn$/i;

  function isBookLike(item) {
    if (!item || typeof item !== "object") return false;
    if (typeof item.id === "undefined" || item.id === null) return false;
    if (typeof item.name !== "string" || !item.name.length) return false;
    if (!item.avatar || typeof item.avatar !== "object") return false;

    // Loại tác giả / người đọc / kênh — không phải sách để nghe
    // (API authors cũng có id+name+avatar cùng path /filename/)
    if (item.type === "author" || item.type === "authors") return false;
    if ("author_type" in item || "is_author" in item) return false;
    // Object giống bio tác giả (description dài, không có field playlist)
    if (
      typeof item.description === "string" &&
      item.description.length > 80 &&
      !("total_duration" in item) &&
      !("coin_price" in item) &&
      !("playlist_counter" in item) &&
      item.type !== "voiz"
    ) {
      return false;
    }

    // Playlist đầy đủ
    if (
      "total_duration" in item ||
      "coin_price" in item ||
      "playlist_counter" in item ||
      "author_string" in item
    ) {
      return true;
    }

    // API rút gọn sách (new_contents, categories…): type voiz / promotion / group_type
    if (item.type === "voiz") return true;
    if (item.group_type != null) return true;
    if (item.promotion === "vip" || item.promotion === "free" || item.promotion === "coin") {
      return true;
    }

    return false;
  }

  // Quét đệ quy một JSON bất kỳ để tìm các mảng "giống sách", không phụ thuộc vào
  // đường dẫn cụ thể (data / data.playlists / data.items / ...) để chịu được nhiều
  // dạng endpoint khác nhau của Voiz.
  function findBookArrays(node, depth, out, seen) {
    if (!node || typeof node !== "object" || depth > 6) return out;
    if (seen.has(node)) return out;
    seen.add(node);

    if (Array.isArray(node)) {
      var matched = 0;
      var booksOnly = [];
      for (var i = 0; i < node.length; i++) {
        if (isBookLike(node[i])) {
          matched++;
          booksOnly.push(node[i]);
        }
      }
      // Nhận mảng khi hầu hết phần tử là sách (API đôi khi lẫn banner/null)
      if (matched > 0 && matched >= Math.max(1, Math.floor(node.length * 0.6))) {
        out.push(booksOnly);
        return out;
      }
      for (var j = 0; j < node.length; j++) {
        findBookArrays(node[j], depth + 1, out, seen);
      }
      return out;
    }

    for (var key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        findBookArrays(node[key], depth + 1, out, seen);
      }
    }
    return out;
  }

  function extractBooks(json) {
    try {
      var arrays = findBookArrays(json, 0, [], new Set());
      if (!arrays.length) return null;
      var books = [];
      for (var a = 0; a < arrays.length; a++) {
        for (var b = 0; b < arrays[a].length; b++) {
          books.push(arrays[a][b]);
        }
      }
      return books.length ? books : null;
    } catch (e) {
      return null;
    }
  }

  function publish(books) {
    if (!books || !books.length) return;
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: books }));
    } catch (e) {
      // trang có CSP lạ hoặc CustomEvent bị chặn -> bỏ qua âm thầm
    }
  }

  function urlHostIsApi(u) {
    try {
      var parsed = new URL(u, window.location.href);
      return API_HOST_RE.test(parsed.hostname);
    } catch (e) {
      return false;
    }
  }

  // ---- fetch ----
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      var args = arguments;
      var reqUrl = "";
      try {
        var first = args[0];
        reqUrl = typeof first === "string" ? first : (first && first.url) || "";
      } catch (e) {}

      var result = origFetch.apply(this, args);
      if (!urlHostIsApi(reqUrl)) return result;

      return result.then(function (res) {
        try {
          // Bỏ qua endpoint tác giả — tránh map avatar author → /play/<authorId>
          if (/\/authors?\b/i.test(reqUrl)) return res;
          res
            .clone()
            .json()
            .then(function (json) {
              publish(extractBooks(json));
            })
            .catch(function () {});
        } catch (e) {}
        return res;
      });
    };
  }

  // ---- XMLHttpRequest ----
  var OrigOpen = XMLHttpRequest.prototype.open;
  var OrigSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__voizNewTabUrl = url;
    return OrigOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (urlHostIsApi(xhr.__voizNewTabUrl)) {
      xhr.addEventListener("load", function () {
        try {
          if (/\/authors?\b/i.test(String(xhr.__voizNewTabUrl || ""))) return;
          var json = JSON.parse(xhr.responseText);
          publish(extractBooks(json));
        } catch (e) {}
      });
    }
    return OrigSend.apply(this, arguments);
  };
})();
