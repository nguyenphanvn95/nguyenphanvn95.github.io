# Waka One Click to Read

Userscript chuyển từ tính năng **One Click Reader** của Waka Toolkit 6.9.2:

1. Chèn nút **Đọc ngay** vào giữa ảnh bìa sách Waka và **ẩn nút đọc mặc định** của trang.
2. Bấm nút → tự tìm `item_id`, gọi API lấy link (ký `secure_code` HMAC-SHA1), tải `content.opf` + toàn bộ file, giải mã XHTML, dựng EPUB, trích metadata và nhúng ảnh bìa.
3. Mở thẳng EPUB trong **Waka EBook Reader** (`nguyenphanvn95.github.io/waka-ebook-reader/`).

Có lớp phủ tiến trình (mobile: nền xanh ngọc toàn màn hình; desktop: panel nổi), nút **Hủy bỏ** / phím `Esc`, hiển thị lỗi rồi tự đóng.

- Cài đặt: `https://nguyenphanvn95.github.io/one-click-to-read/one-click-to-read.user.js`
- Cần Tampermonkey hoặc Violentmonkey (desktop và Android). Nên cài kèm `waka-ebook-reader.user.js`.

## Triển khai

Upload toàn bộ nội dung thư mục này vào `nguyenphanvn95.github.io/one-click-to-read/` (giữ nguyên cấu trúc), rồi mở link `.user.js` để cài.

```
one-click-to-read/
├─ one-click-to-read.user.js   userscript (@require các file bên dưới, cũng là @updateURL)
├─ index.html                  trang giới thiệu + nút cài
├─ lib/
│  ├─ jszip.min.js             gốc extension
│  └─ crypto-js.min.js         gốc extension, bọc để `this` luôn là window
├─ src/
│  ├─ epub-decode.js           gốc extension (không sửa)
│  ├─ epub-builder.js          gốc extension (không sửa)
│  ├─ gm-fetch.js              MỚI  WakaGM: mạng qua GM_xmlhttpRequest (thay background.js)
│  ├─ metadata-injector.js     gốc + vá: metadata giữ trong bộ nhớ, ảnh bìa tải bằng WakaGM
│  ├─ reader-handoff.js        MỚI  WakaHandoff: đẩy EPUB sang Waka EBook Reader
│  └─ one-click-reader.js      gốc + vá (xem dưới)
└─ assets/icons/               icon-read.svg (đã nhúng sẵn trong JS), icon48.png (@icon)
```

## Tương ứng với extension

| Extension (background.js) | Userscript |
|---|---|
| `fetchUrlAsDataUrl` (fetch cross-origin có host permission) | `WakaGM.fetch` → `GM_xmlhttpRequest`; lần đầu không cookie, `!ok` thì thử lại có cookie |
| Luật DNR Referer/Origin cho `store.waka.vn/static/` | header `Referer`/`Origin` trong `GM_xmlhttpRequest` |
| `saveMetadata` / `getMetadata` / `clearMetadata` (chrome.storage) | `WakaMetaInjector.setMeta/getMeta/clearMeta` (bộ nhớ trang) |
| `openReaderWithEpub` + `consumeReaderEpub` | `WakaHandoff.openBlob` + `platform-shim.js` của Reader |
| `chrome.runtime.getURL('…icon-read.svg')` | SVG nhúng thẳng vào nút (không bị CSP `img-src` chặn) |
| Content script `document_idle`, `exclude_matches` | `@run-at document-idle`, `@exclude` cùng danh sách |
| Tiến trình tải EPUB trực tiếp (stream `content-length`) | `GM_xmlhttpRequest.onprogress` |

Các chỗ vá trong `one-click-reader.js`: bỏ `chrome.runtime.*`; `fetchWithFallback` → `WakaGM.fetch`; `openBlobInReader` → `WakaHandoff.openBlob`; CSS nạp bằng `GM_addStyle` (qua được CSP `style-src`); `start()` → `boot()` và xuất `WakaOneClick.start(gm)`. Toàn bộ logic tìm `item_id`, ký request, tải OPF, chọn/ẩn nút gốc, lớp phủ, hủy tác vụ được giữ nguyên.

## Giao thức chuyển EPUB sang Reader

1. Sau khi dựng xong, waka.vn mở `…/waka-ebook-reader/src/reader.html?importToken=oc_<id>` (`window.open`; nếu bị chặn thì `GM_openInTab`).
2. Reader (shim) gọi `consumeReaderEpub`:
   - **Kênh opener**: gửi `ready` cho `window.opener` → waka.vn trả `Blob` bằng `postMessage` (nhanh, không qua bộ nhớ GM).
   - **Kênh GM** (tab mở bằng `GM_openInTab` không có opener): userscript trên origin Reader ghi `oc:req:<token>` → tab waka.vn ghi `oc:res:<token>` (dataUrl) → Reader nhận; khoá được xoá ngay sau đó.
3. Token dùng một lần, tự huỷ sau 5 phút. Token `oc_…` thuộc script này, `reader_…` thuộc `waka-ebook-reader.user.js` nên hai script không giành nhau.

## Lưu ý

- Cần **giữ tab waka.vn mở** cho tới khi Reader nhận xong (thường dưới 1 giây).
- Nếu cài cả extension Waka Toolkit, hãy tắt một trong hai để tránh hai nút "Đọc ngay" tranh nhau.
- Trình quản lý userscript **cache các file `@require`**: sau khi sửa file trong thư mục này, tăng `?v=` ở các dòng `@require` và `@version`.
- `@connect *` cần để tải ảnh bìa từ CDN không cố định; trình quản lý sẽ hỏi cho phép lần đầu.
- Không bao gồm `hide-ui.js` (ẩn banner/Zalo/nút tải app) và các tính năng tải EPUB, sách nói, truyện tranh khác của Waka Toolkit.
