# Waka EBook Reader

Trình đọc EPUB của **Waka Toolkit 6.9.2** chạy dưới dạng **web app + userscript**.
Mã trình đọc giữ nguyên như extension gốc (thư viện, chú thích, đọc to Edge TTS, nhạc nền, giao diện desktop + mobile).

- Reader: `https://nguyenphanvn95.github.io/waka-ebook-reader/`
- Cài userscript: `https://nguyenphanvn95.github.io/waka-ebook-reader/waka-ebook-reader.user.js`

## Triển khai

1. Trong repo `nguyenphanvn95.github.io`, tạo thư mục `waka-ebook-reader/`.
2. Upload **toàn bộ nội dung** của thư mục này vào đó (giữ nguyên cấu trúc bên dưới).
3. Chờ GitHub Pages build xong, mở `https://nguyenphanvn95.github.io/waka-ebook-reader/` để kiểm tra.
4. Mở link `.user.js` ở trên bằng Tampermonkey / Violentmonkey để cài userscript.

```
waka-ebook-reader/
├─ index.html                     chuyển hướng tới src/reader.html (giữ ?query, #hash)
├─ manifest.webmanifest           cài lên màn hình chính (mobile / desktop)
├─ waka-ebook-reader.user.js      userscript (cũng là @updateURL / @downloadURL)
├─ src/
│  ├─ reader.html                 trang trình đọc (gốc + 2 dòng vá, xem dưới)
│  ├─ platform-shim.js            MỚI — thay chrome.* bằng localStorage + cầu nối userscript
│  └─ epub-reader/*.js            15 module gốc (app, parser, zip, db, annotation, read-aloud, …)
├─ assets/{css,icons,wallpagers}/ CSS, icon, hình nền, ảnh bìa nhạc nền
└─ lang/{vi,en}.json
```

## Userscript làm gì

| Trang | Chức năng |
|---|---|
| `waka.vn` | Nút nổi 📖 (kéo được, nhớ vị trí; chạm để mở menu) + menu Tampermonkey: **Mở EPUB Reader**, **Chọn file EPUB để đọc…** (chuyển thẳng sang Reader), **Ẩn/Hiện nút nổi** |
| `nguyenphanvn95.github.io/waka-ebook-reader/*` | Cầu nối cho Reader: **nhập EPUB từ URL** vượt CORS (GM_xmlhttpRequest), nhận EPUB từ tab waka.vn khi `window.opener` bị cắt |

Reader vẫn dùng được **không cần userscript** (như một web app/PWA); userscript chỉ bổ sung hai việc trên.

## Tương ứng với extension gốc

| Extension | Bản web/userscript |
|---|---|
| `chrome.storage.local` (cài đặt, ngôn ngữ, trạng thái panel) | `localStorage` (có `onChanged` giữa các tab) |
| `chrome.runtime.getURL` | URL tuyệt đối theo thư mục gốc |
| `chrome.permissions` (nhập URL) | luôn cho phép; CORS được xử lý qua userscript |
| `openReaderWithEpub` / `consumeReaderEpub` (background.js) | `postMessage` qua `window.opener`, dự phòng `GM_setValue` |
| Quyền `unlimitedStorage` | `navigator.storage.persist()` (hỏi 1 lần sau thao tác đầu tiên) |
| Thư viện sách (IndexedDB) | IndexedDB của origin `nguyenphanvn95.github.io` |

## Cập nhật khi extension có bản mới

Chép đè `src/epub-reader/*`, `assets/*`, `lang/*`, `src/reader.html` từ bản extension mới, rồi áp lại **3 chỗ vá**:

1. `src/reader.html` — trong `<head>` thêm: `<link rel="manifest" href="../manifest.webmanifest" />` và 3 thẻ meta/icon PWA (tuỳ chọn).
2. `src/reader.html` — **trước** `<script src="epub-reader/i18n.js">` thêm `<script src="platform-shim.js"></script>` (bắt buộc).
3. `src/epub-reader/read-aloud.js` — chuỗi lỗi `socket.onerror` (chỉ đổi câu chữ, bỏ nhắc "reload extension").

## Lưu ý

- **Dữ liệu tách biệt với extension**: thư viện sách/cài đặt nằm trong origin `github.io`, không tự chuyển từ extension sang; cần nhập lại sách.
- **Đọc to (Edge TTS)**: kết nối WebSocket tới `speech.platform.bing.com` giống bản gốc, nhưng extension dùng luật `declarativeNetRequest` để đặt header `User-Agent`; trang web/userscript không đặt được header này. Nếu máy chủ từ chối, tính năng này báo lỗi — các tính năng khác không bị ảnh hưởng.
- Cầu nối `fetch` của userscript dùng `anonymous: true` (không gửi cookie) và chỉ nhận yêu cầu từ chính origin Reader.
- Không bao gồm phần tải/giải mã EPUB, sách nói, truyện tranh, Hiệu Sói của Waka Toolkit (ngoài phạm vi trình đọc).
