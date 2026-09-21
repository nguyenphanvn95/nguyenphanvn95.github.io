# Waka EBook Reader

Trình đọc EPUB của **Waka Toolkit 6.9.5** chạy dưới dạng **web app + userscript**.
Mã trình đọc giữ nguyên như extension gốc (thư viện, chú thích, đọc to Edge TTS, nhạc nền, **Auto Scroll**, **10 font chữ tuỳ chỉnh**, giao diện desktop + mobile).

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
│  ├─ reader.html                 trang trình đọc (gốc + vài dòng vá, xem dưới)
│  ├─ platform-shim.js            MỚI — thay chrome.* bằng localStorage + cầu nối userscript
│  └─ epub-reader/*.js            17 module gốc (app, parser, zip, db, annotation, read-aloud, auto-scroll, custom-fonts, …)
├─ assets/{css,fonts,icons,wallpagers}/ CSS (gồm auto-scroll-pill.css), 10 font tuỳ chỉnh, icon, hình nền, ảnh bìa nhạc nền
└─ lang/{vi,en}.json
```

## Userscript làm gì

| Trang | Chức năng |
|---|---|
| `waka.vn` | **Bong bóng nổi** dùng `assets/icons/icon48.png` (kéo được, nhớ vị trí). Chạm vào → 3 lựa chọn: **Mở EPUB Reader**, **Nhập file EPUB…** (chuyển thẳng sang Reader), **Ẩn nút này**. Menu Tampermonkey/Violentmonkey có cùng các lệnh, cộng **Ẩn/Hiện nút nổi** để bật lại nút đã ẩn |
| `nguyenphanvn95.github.io/waka-ebook-reader/*` | Cầu nối cho Reader: **nhập EPUB từ URL** vượt CORS (GM_xmlhttpRequest), nhận EPUB từ tab waka.vn khi `window.opener` bị cắt |

Nếu CSP của waka.vn chặn ảnh từ github.io, userscript tự tải icon qua `GM_xmlhttpRequest` (data URL, có cache); nếu vẫn không được thì dùng biểu tượng sách SVG.

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

Chép đè `src/epub-reader/*`, `assets/*` (gồm `assets/fonts/`, `assets/css/auto-scroll-pill.css`), `lang/*`, `src/reader.html` từ bản extension mới, rồi áp lại **3 chỗ vá**:

1. `src/reader.html` — trong `<head>` thêm: `<link rel="manifest" href="../manifest.webmanifest" />` và 3 thẻ meta/icon PWA (tuỳ chọn).
2. `src/reader.html` — **trước** `<script src="epub-reader/i18n.js">` thêm `<script src="platform-shim.js"></script>` (bắt buộc).
3. `src/epub-reader/read-aloud.js` — chuỗi lỗi `socket.onerror` (chỉ đổi câu chữ, bỏ nhắc "reload extension").

## Lịch sử

- **Userscript 1.1.0 / Reader 6.9.5** — Reader nâng từ 6.9.2 lên 6.9.5 của extension: Auto Scroll (chế độ Cuộn, pill nổi, Shift+A), 10 font tuỳ chỉnh đủ chữ tiếng Việt (`assets/fonts/`, `custom-fonts.js`), sửa nhãn công tắc Auto Scroll, sửa thanh cuộn + cuộn được bảng "Cài đặt chữ" trên mobile. Userscript: bong bóng nổi dùng icon48.png, tự gắn lại khi trang SPA gỡ nút, đồng bộ Ẩn/Hiện giữa các tab, sửa rò rỉ listener.
- **1.0.1** — tích hợp one-click-to-read (bên dưới).

## Tích hợp với one-click-to-read (v1.0.1)

Userscript [`one-click-to-read`](../one-click-to-read/) dựng EPUB từ nút **Đọc ngay** trên waka.vn rồi đẩy vào Reader này bằng `?importToken=oc_…` (xem giao thức trong README của nó). Từ v1.0.1:

- `platform-shim.js` nhận biết cả hai userscript (`html[data-waka-reader-userscript]` và `html[data-waka-oneclick-userscript]`) cho kênh `consume`.
- `waka-ebook-reader.user.js` bỏ qua token `oc_…` (thuộc one-click-to-read), chỉ xử lý token `reader_…` của chính nó.

## Lưu ý

- **Dữ liệu tách biệt với extension**: thư viện sách/cài đặt nằm trong origin `github.io`, không tự chuyển từ extension sang; cần nhập lại sách.
- **Đọc to (Edge TTS)**: kết nối WebSocket tới `speech.platform.bing.com` giống bản gốc, nhưng extension dùng luật `declarativeNetRequest` để đặt header `User-Agent`; trang web/userscript không đặt được header này. Nếu máy chủ từ chối, tính năng này báo lỗi — các tính năng khác không bị ảnh hưởng.
- Cầu nối `fetch` của userscript dùng `anonymous: true` (không gửi cookie) và chỉ nhận yêu cầu từ chính origin Reader.
- Không bao gồm phần tải/giải mã EPUB, sách nói, truyện tranh, Hiệu Sói của Waka Toolkit (ngoài phạm vi trình đọc).
