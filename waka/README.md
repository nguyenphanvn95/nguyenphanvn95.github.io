# Waka EPUB Downloader – Userscript

Tách phần tải EPUB từ Waka Toolkit 5.3.17 thành userscript cho Tampermonkey.

## Cách dùng

### 1. Upload thư viện lên GitHub Pages

Tạo repository (hoặc dùng sẵn) `nguyenphanvn95.github.io` và thư mục `waka/`.

Upload **4 file** sau vào `https://nguyenphanvn95.github.io/waka/` :

| File | Mô tả |
|------|-------|
| `jszip.min.js` | Thư viện tạo file ZIP/EPUB |
| `crypto-js.min.js` | Giải mã nội dung XHTML mã hóa của Waka |
| `epub-decode.js` | Module decode shared |
| `epub-builder.js` | Module đóng gói EPUB |

(Các file này đã có sẵn trong thư mục này.)

### 2. Cài userscript

1. Cài [Tampermonkey](https://www.tampermonkey.net/) (Chrome / Firefox / Edge…).
2. Tạo script mới → dán toàn bộ nội dung file `waka-epub-downloader.user.js`.
3. Lưu.

### 3. Sử dụng

- Vào trang **https://waka.vn/ebook/...** hoặc **https://waka.vn/reader/...**
- Đợi nút **⬇ Tải EPUB** hiện ở góc dưới bên phải.
- Nhấn nút → script sẽ tải, giải mã và đóng gói thành file `.epub` rồi tải về máy.

## Ghi chú

- Script chạy ở `document-start` để bắt request API sớm.
- Không cần quyền đặc biệt (`@grant none`).
- Metadata injector / book-metadata của bản extension gốc đã được lược bỏ để gọn.
- Nếu `@require` không load được (404), kiểm tra lại đường dẫn GitHub Pages.

## File trong thư mục này

```
waka-epub-downloader.user.js   ← userscript chính (cài vào Tampermonkey)
jszip.min.js
crypto-js.min.js
epub-decode.js
epub-builder.js
ebook-interceptor.js           (tham khảo)
reader-interceptor.js          (tham khảo)
ebook-content.js               (tham khảo)
reader-content.js              (tham khảo)
```
