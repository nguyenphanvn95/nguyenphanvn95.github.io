# Waka EPUB Downloader v1.2

## Lỗi raw.githubusercontent.com

**Không dùng** `raw.githubusercontent.com/...` làm nguồn `<script src>`.
Trình duyệt hay fail vì MIME `text/plain`.

Userscript v1.2 dùng:
1. **jsDelivr** (ưu tiên): `https://cdn.jsdelivr.net/gh/nguyenphanvn95/nguyenphanvn95.github.io@main/waka/`
2. Fallback: `https://nguyenphanvn95.github.io/waka/`

## Upload file

Đẩy các file JS vào repo `nguyenphanvn95/nguyenphanvn95.github.io`, thư mục `waka/`:

- jszip.min.js, crypto-js.min.js
- epub-decode.js, epub-builder.js, metadata-injector.js
- book-metadata.js, ebook-content.js, ebook-interceptor.js
- reader-content.js, reader-interceptor.js

Sau khi push, đợi 1–5 phút để jsDelivr cập nhật cache.

## Cài userscript

Dán `waka-epub-downloader.user.js` vào Tampermonkey → Save.

Trên trang ebook sẽ thấy nút **Copy metadata** + **⬇ Tải EPUB** dưới tiêu đề sách.

---

# Waka Hiệu Sói (Chapter) Downloader

Userscript riêng cho `https://waka.vn/hieu-soi/*`.

## Tính năng

- Nút **⬇ EPUB** trên **từng chương** trong danh sách
- Nút **Tải full / tất cả chương** (gộp thành 1 file EPUB)

## File cần upload thêm lên `waka/`

| File | Mô tả |
|------|--------|
| `oak-interceptor.js` | Bắt API getDownloadItemOakWeb + danh sách chương |
| `oak-content.js` | UI nút từng chương + tải full |

(Các lib jszip, crypto-js, epub-decode, epub-builder dùng chung với userscript ebook.)

## Cài

Dán `waka-hieu-soi-downloader.user.js` vào Tampermonkey → Save.
