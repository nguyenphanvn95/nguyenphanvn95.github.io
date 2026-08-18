# Waka EPUB Downloader – Userscript v1.1

Tách phần tải EPUB + Copy metadata từ Waka Toolkit 5.3.17.

## Giao diện (giống extension gốc)

Trên trang `/ebook/` hoặc `/shop/`:
- Nút **Copy metadata** / **Nhận diện metadata** (màu cam) ngay dưới tiêu đề sách
- Nút **⬇ Tải EPUB** (màu tím) cạnh nút metadata — **1 click** lưu metadata + tải EPUB

Trên trang `/reader/`:
- Nút tải EPUB góc màn hình

## Bước 1: Upload lên GitHub Pages

Upload **toàn bộ** các file sau vào `https://nguyenphanvn95.github.io/waka/` :

| File | Bắt buộc |
|------|----------|
| `jszip.min.js` | ✅ |
| `crypto-js.min.js` | ✅ |
| `epub-decode.js` | ✅ |
| `epub-builder.js` | ✅ |
| `metadata-injector.js` | ✅ |
| `book-metadata.js` | ✅ |
| `ebook-content.js` | ✅ |
| `ebook-interceptor.js` | ✅ |
| `reader-content.js` | ✅ |
| `reader-interceptor.js` | ✅ |

## Bước 2: Cài userscript

1. Cài Tampermonkey
2. Tạo script mới → dán nội dung `waka-epub-downloader.user.js`
3. Lưu → bật script

## Bước 3: Dùng

1. Mở trang sách trên waka.vn/ebook/...
2. Đợi 1–2 giây → thấy 2 nút dưới tiêu đề
3. (Tuỳ chọn) bấm **Copy metadata** để xem/sửa rồi Lưu
4. Bấm **⬇ Tải EPUB** → tự động lưu metadata + tải file .epub

## Lưu ý

- Metadata được lưu trong `localStorage` (không cần extension background)
- Nếu nút không hiện: mở DevTools (F12) → Console, xem lỗi load script (thường do GitHub Pages chưa cập nhật hoặc sai tên file)
- `@grant none` → script chạy cùng context với trang
