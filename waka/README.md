# Waka Downloader Vip

Tải sách nói (MP3) và ebook (EPUB) từ Waka.vn.

## Cài đặt Userscript (Tampermonkey)

1. Cài [Tampermonkey](https://www.tampermonkey.net/)
2. Click link sau để cài script:
   **[Cài đặt Waka Downloader Vip](https://nguyenphanvn95.github.io/waka/waka-downloader.user.js)**

## Cách dùng

### Sách nói (`/sach-noi/*`)
- Vào trang sách nói → nhấn **Nghe sách** một lần để phát hiện stream
- Nút **Download MP3** xuất hiện → click để tải file hiện tại
- Nút **Tải tất cả** → tải toàn bộ chương dạng AAC

### Ebook (`/ebook/*`)
- Vào trang ebook → script tự động phát hiện link
- Nút **⬇ Tải EPUB** ở góc phải → click để tải

### Reader (`/reader/*`)
- Vào trang đọc → nút **⬇ Tải EPUB** xuất hiện sau vài giây
- Click để tải toàn bộ ebook dưới dạng EPUB

## Files nguồn

| File | Mô tả |
|------|-------|
| `waka-downloader.user.js` | **Userscript chính** (Tampermonkey) |
| `lib/lame.min.js` | lamejs – encode MP3 |
| `lib/jszip.min.js` | JSZip – đóng gói EPUB |
| `lib/crypto-js.min.js` | CryptoJS – giải mã nội dung |
| `epub_decoder.html` | Tool decode EPUB standalone |
