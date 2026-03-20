# ChessHv3 Userscript

Chuyển đổi Chrome Extension ChessHv3 thành Userscript — panel nổi trên trang chess.

## Cài đặt

### 1. Cài Tampermonkey / Violentmonkey
- [Tampermonkey for Chrome](https://tampermonkey.net/)
- [Tampermonkey for Firefox](https://tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)

### 2. Upload file lên GitHub Pages

Upload các file sau vào repo `nguyenphanvn95.github.io` thư mục `/chesshv3/`:

```
chesshv3/
├── chesshv3.user.js   ← userscript chính
├── alert.js           ← từ extension gốc
├── a.js               ← từ extension gốc
└── lib/
    ├── chess_min.js
    ├── engine.js
    ├── engine.wasm
    ├── stockfish.js
    └── stockfish.wasm
```

### 3. Cài userscript

Mở URL:
```
https://nguyenphanvn95.github.io/chesshv3/chesshv3.user.js
```
Tampermonkey/Violentmonkey sẽ nhận ra và hỏi cài đặt → nhấn **Install**.

## Sử dụng

- Panel sẽ xuất hiện góc phải dưới khi vào chess.com / lichess.org
- **Nút `−`** → Thu nhỏ thành icon nổi (click icon để mở lại)
- **Nút `✕`** → Ẩn hoàn toàn (reload trang để hiện lại)
- Kéo header panel để di chuyển
- Resize bằng cách kéo góc panel

## Lưu ý kỹ thuật

- Config lưu qua `GM_getValue/GM_setValue` (tương đương `chrome.storage.local`)
- Engine `.wasm` phải được serve từ domain có `Cross-Origin-Embedder-Policy` & `Cross-Origin-Opener-Policy` đúng
- Cần thêm header trong GitHub Pages hoặc dùng Cloudflare Worker nếu engine Worker bị chặn
