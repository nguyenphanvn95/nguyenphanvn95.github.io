# Waka EBook Reader

Trình đọc EPUB của **Waka Toolkit 6.9.6** chạy dưới dạng **web app + userscript**.
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

- **Userscript 1.2.7 / Reader — theme "Đọc to" + đồng bộ theme thư viện ⇄ reader** — Đồng bộ với bản vá Waka Toolkit 6.11.2–6.11.8 (không đổi logic loader): (1) `assets/css/tts-pill.css` viết lại theo biến `--wtts-*`, mặc định tối, `body.waka-theme-light` ghi đè tông sáng; sửa lỗi comment đầu file chứa `*/` đóng sớm làm mất khối biến tối (chữ/nút biến mất ở theme tối); giảm nét icon (`.waka-tts-panel svg` 2.2, `.waka-tts-pill-transport svg` 2) và độ đậm nhãn thẻ (700/500). (2) `assets/icons/read-aloud.svg` đổi fill `#212121` → `#F2F2F2` để icon Đọc to ở mobile không còn đen ở theme tối. (3) `assets/css/reader.css`: bộ biến `--mm-*` cho pill Nhạc nền theo theme (`#reader-view.rd-dark` = tối) + đảo màu icon điều khiển ở theme sáng. (4) Đồng bộ theme: `app.js` (`themeIsDark`, `ReaderApp.isDarkTheme`), `reader-ui.js` (gắn `waka-theme-dark/light` lên `<body>`), `library-ui.js` + `library-mobile.js` (nghe `reader:settings`; nút đổi theme thư viện gọi `ReaderApp.setTheme("dark"/"white")`). Gộp bằng 3-way merge từ nền 6.11 nên giữ nguyên các vá riêng của bản userscript (Dropbox, platform-shim, thanh chuyển chương mobile nhỏ gọn, sửa volume nhạc nền). Cần deploy lại toàn bộ file đã đổi lên GitHub Pages; người dùng đã cài userscript nhận bản 1.2.7 qua `@updateURL`.
- **Reader — nút "Đồng bộ ngay" (đẩy lên Dropbox thủ công)** — Thêm nút `#dbx-upload-now-btn` trong khối đồng bộ Dropbox (`dropbox-sync.js`, hàm `syncBlockHtml()`/`mountSyncBlock()`), đặt ngay trên dòng dropdown "Tự động đồng bộ" — vì khối này dùng chung cho cả desktop (`#rp-sync-block`) lẫn mobile (`#lib-sync-block`) nên chỉ cần sửa 1 chỗ là hiện ở cả hai. Bấm vào sẽ chạy hàm mới `uploadAllNow()`: quét toàn bộ thư viện cục bộ (`BookDB.listBooks()`) và gọi `uploadOneBook()` cho từng cuốn ngay lập tức (không chờ debounce ~9s hay chu kỳ tự động), báo tổng kết qua `toast` (`dropbox.uploadNowSummary`). Nút bị vô hiệu hoá (disabled) nếu chưa đăng nhập; nếu đang có 1 lượt đồng bộ khác chạy dở thì báo "đang đồng bộ, vui lòng đợi" thay vì chạy chồng. File: `src/epub-reader/dropbox-sync.js`, `lang/vi.json`, `lang/en.json` (thêm `dropbox.uploadNow`, `dropbox.uploadingNow`, `dropbox.uploadBusy`, `dropbox.uploadNowSummary`). Không đổi `library-ui.js`/`library-mobile.js`/CSS.
- **Reader — tính năng Đồng bộ Dropbox (mới)** — Thêm module mới `src/epub-reader/dropbox-sync.js` (`window.DropboxSync`): đăng nhập Dropbox qua OAuth 2.0 Authorization Code + PKCE (không cần App Secret, chỉ App Key, lưu vào App folder riêng của app). **Lên Dropbox = tự động** khi đã đăng nhập + đã bật (dropdown 0/3/5/10/20 phút): backup file `.epub` gốc + vị trí đọc/bookmark/ghi chú/metadata, có debounce ~9s theo sự kiện `waka:book-changed` (mới bắn ra từ các hàm ghi trong `db.js`), cộng 1 timer quét định kỳ dự phòng theo dropdown; không upload lại `.epub` nếu Dropbox đã có file cùng `id` (id = SHA-256 của buffer → cùng id chắc chắn cùng nội dung). **Từ Dropbox = thủ công** qua nút "Đồng bộ từ Dropbox": sách mới nhập thẳng qua `ReaderApp.addBookFromFile` (mới expose thêm hàm này); sách trùng `id` hiện hộp thoại riêng hỏi Ghi đè/Bỏ qua (có tuỳ chọn áp dụng cho tất cả), không tải lại `.epub` khi đã trùng. UI: khối đăng nhập + dropdown chu kỳ trong panel "Cài đặt thư viện" (desktop, ngay trên nút "Xoá toàn bộ thư viện") / bottom sheet "Cài đặt" (mobile, cùng vị trí), nút rail `#rail-sync-download` (desktop, dưới `#rail-export`) + mục "Đồng bộ từ Dropbox" trong menu "..." (mobile, dưới "Xuất sách"). File: `src/epub-reader/dropbox-sync.js` (mới), `src/epub-reader/db.js` (bắn `waka:book-changed` ở `saveBook`/`updatePosition`/`addBookmark`/`removeBookmark`/`addAnnotation`/`updateAnnotation`/`removeAnnotation`/`deleteBook`/`deleteBooks`), `src/epub-reader/app.js` (expose `addBookFromFile` qua `ReaderApp`), `src/reader.html` (nút rail + thẻ `<script>`), `src/epub-reader/library-ui.js`, `src/epub-reader/library-mobile.js`, `assets/css/library.css` (`.rp-sync-block`, `.dbx-*`), `lang/{vi,en}.json` (nhóm khoá `dropbox.*` + `lib.syncDownload`). Không đổi `waka-ebook-reader.user.js`, không đổi logic export/import EPUB hiện có, không thay IndexedDB làm nguồn dữ liệu chính (Dropbox chỉ backup/đồng bộ thêm). **Cần tự điền `DROPBOX_APP_KEY`** ở đầu `dropbox-sync.js` (tạo app tại Dropbox App Console, loại Scoped App / quyền "App folder", khai Redirect URI đúng `https://nguyenphanvn95.github.io/waka-ebook-reader/src/reader.html`) — **chưa** kiểm thử end-to-end với tài khoản Dropbox thật (môi trường tạo bản vá này không chạy được trình duyệt/OAuth thật), tự kiểm tra kỹ luồng đăng nhập + đồng bộ trước khi dùng thật.
- **Reader — nâng cấp UI trang "Thông tin sách" (mobile)** — Vá riêng phần Reader (không đổi `waka-ebook-reader.user.js`, không đổi các phần khác của Reader), cùng nội dung với bản vá của Waka Toolkit 6.11: nền ảnh bìa mờ đậm hơn (`.bi-backdrop`), giảm cỡ chữ tiêu đề/tác giả/mô tả/meta/tag đang quá to trên mobile, thêm khối thu gọn/mở rộng `#bi-collapsible` (mô tả + "Thông tin xuất bản" + meta + tag, giới hạn cao 260px kèm nút "Xem thêm"/"Rút gọn" `#bi-toggle` khi nội dung tràn), gộp 3 nút Đọc sách/Xuất file/Xoá về chung 1 hàng ngang. File: `assets/css/style.css` (khối `@media (max-width: 760px)` của `#book-info-modal`, cộng 2 rule mặc định ngoài media query), `src/reader.html` (thêm `#bi-collapsible`, `#bi-toggle`), `src/epub-reader/app.js` (`el.biCollapsible`/`el.biToggle`/`el.biInfo`, hàm `setupBookInfoCollapse()`, listener `#bi-toggle`). Các thay đổi khác giữa Reader 6.9.6 (bản gốc của thư mục này) và 6.11 của extension (nếu có, ngoài trang Thông tin sách) **chưa** được đồng bộ.
- **Reader — thu gọn toolbar trên cùng + bottom sheet (mobile)** — Vá riêng CSS mobile của Reader (cùng nội dung với bản vá kích thước của Waka Toolkit 6.9.10; không đổi `waka-ebook-reader.user.js`, không đổi các phần khác của Reader): thanh công cụ trên cùng 56px → 44px (nút 46px → 34px, icon 28px → 20px), bottom sheet "Cài đặt chữ" — mỗi hàng 68px → 52px, chấm chọn Nền 56px → 38px, công tắc 64×36px → 46×26px, các phần khác co theo tỉ lệ tương ứng. File: `assets/css/reader.css` (chỉ file này thay đổi).
- **Reader — 4 theme nền mới** — Vá riêng phần theme của Reader (không đổi `waka-ebook-reader.user.js`, không đổi các phần khác của Reader): thêm 4 theme ảnh nền vào pane Theme (desktop) và bảng "Cài đặt chữ" → hàng "Nền" (mobile), giống 4 theme mới thêm ở Waka Toolkit 6.9.9 — **Giấy scrapbook** (chữ tông Sepia), **Cát** (tông Trắng), **Trăng đêm** (tông Tối), **Lá cây** (tông Trắng). File: `src/epub-reader/app.js` (4 mục `BG_IMAGES`), `src/reader.html` (4 nút mỗi bên desktop/mobile), `src/epub-reader/reader-ui.js` (điều kiện thanh công cụ tối `rd-dark`), `assets/css/reader.css` (CSS thumbnail), `assets/wallpagers/{scrapbook,sand,moonsky,leaves}-bg{,-thumbnail}.jpg`. Các thay đổi khác giữa Reader 6.9.6 (bản gốc của thư mục này) và 6.9.9 của extension (nếu có, ngoài 4 theme) **chưa** được đồng bộ.
- **platform-shim.js 1.0.5 / app.js** — Reader tự kiểm tra thư viện (IndexedDB) theo **tiêu đề sách** trước khi chờ EPUB từ one-click-to-read: nếu `?importToken=oc_…&titleHint=<tên sách>` khớp 1 sách đã có (so khớp không phân biệt hoa/thường, bỏ khoảng trắng thừa) → mở thẳng sách đó, gửi `{type:"titleFound"}` để waka.vn hủy tải/dựng EPUB đang dở; nếu chưa có mới chờ nhận EPUB như cũ. Xem README của `one-click-to-read`.
- **Userscript 1.1.0 / Reader 6.9.6** — Reader nâng từ 6.9.5 lên 6.9.6 của extension: bottom sheet Mục lục ở mobile có thêm tab **Tìm kiếm** (bên cạnh Mục lục, Đánh dấu), dùng lại nguyên tính năng tìm kiếm trong sách đã có ở desktop (`#search-input`/`#search-results`/`runSearch` trong `app.js`, không đổi logic tìm kiếm) — chỉ nối thêm đường vào từ tab mobile (`src/reader.html`, `src/epub-reader/mobile-reader.js`, `src/epub-reader/i18n.js`) và style riêng cho theme tối của panel mobile (`assets/css/reader.css`). Userscript (loader) không đổi.
- **Userscript 1.1.0 / Reader 6.9.5** — Reader nâng từ 6.9.2 lên 6.9.5 của extension: Auto Scroll (chế độ Cuộn, pill nổi, Shift+A), 10 font tuỳ chỉnh đủ chữ tiếng Việt (`assets/fonts/`, `custom-fonts.js`), sửa nhãn công tắc Auto Scroll, sửa thanh cuộn + cuộn được bảng "Cài đặt chữ" trên mobile. Userscript: bong bóng nổi dùng icon48.png, tự gắn lại khi trang SPA gỡ nút, đồng bộ Ẩn/Hiện giữa các tab, sửa rò rỉ listener.
- **1.0.1** — tích hợp one-click-to-read (bên dưới).

## Tích hợp với one-click-to-read (v1.0.1)

Userscript [`one-click-to-read`](../one-click-to-read/) dựng EPUB từ nút **Đọc ngay** trên waka.vn rồi đẩy vào Reader này bằng `?importToken=oc_…` (xem giao thức trong README của nó). Từ v1.0.1:

- `platform-shim.js` nhận biết cả hai userscript (`html[data-waka-reader-userscript]` và `html[data-waka-oneclick-userscript]`) cho kênh `consume`.
- `waka-ebook-reader.user.js` bỏ qua token `oc_…` (thuộc one-click-to-read), chỉ xử lý token `reader_…` của chính nó.
- Từ `platform-shim.js` 1.0.5: nếu URL có thêm `titleHint=<tên sách>`, Reader kiểm tra thư viện trước — có sách cùng tên thì mở luôn (không tải EPUB); action `reportTitleMatch` báo ngược cho waka.vn để hủy job.

## Lưu ý

- **Dữ liệu tách biệt với extension**: thư viện sách/cài đặt nằm trong origin `github.io`, không tự chuyển từ extension sang; cần nhập lại sách.
- **Đọc to (Edge TTS)**: kết nối WebSocket tới `speech.platform.bing.com` giống bản gốc, nhưng extension dùng luật `declarativeNetRequest` để đặt header `User-Agent`; trang web/userscript không đặt được header này. Nếu máy chủ từ chối, tính năng này báo lỗi — các tính năng khác không bị ảnh hưởng.
- Cầu nối `fetch` của userscript dùng `anonymous: true` (không gửi cookie) và chỉ nhận yêu cầu từ chính origin Reader.
- Không bao gồm phần tải/giải mã EPUB, sách nói, truyện tranh, Hiệu Sói của Waka Toolkit (ngoài phạm vi trình đọc).
