# Waka Downloader Vip — Userscript

Tải sách nói (MP3) và ebook (EPUB) từ Waka.vn. Hỗ trợ nhận diện & nhúng metadata tự động.

## Cài đặt

1. Cài [Tampermonkey](https://www.tampermonkey.net/) hoặc [Violentmonkey](https://violentmonkey.github.io/)
2. Cài script: [waka-downloader.user.js](https://nguyenphanvn95.github.io/waka/waka-downloader.user.js)

## Cấu trúc thư mục

```
waka/
├── waka-downloader.user.js   ← Script chính (cài cái này)
└── lib/
    ├── jszip.min.js
    ├── crypto-js.min.js
    └── lame.min.js
```

## Tính năng

| Trang | Chức năng |
|---|---|
| `/sach-noi/*` | Download MP3 chương đang nghe; Download tất cả chương |
| `/ebook/*` | Download EPUB; Nhận diện & lưu metadata |
| `/reader/*` | Download EPUB từ reader |

## Lưu ý
- Metadata lưu bằng `GM_setValue` (thay thế `chrome.storage`)
- Thư viện JSZip, CryptoJS, lamejs được load từ `lib/` trong repo
