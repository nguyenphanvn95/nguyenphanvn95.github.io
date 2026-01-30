# Notion to Anki - Web Version

Ứng dụng web giúp tạo bộ thẻ Anki (.apkg) từ Notion pages, dựa trên addon Notion2AnkiFree.

## Tính năng

✨ **Chức năng chính:**
- 🔐 Kết nối với Notion thông qua Token API
- 📄 Quản lý nhiều pages từ Notion
- 🎯 Chỉ định Target Deck cho từng page
- ⚙️ Tùy chọn: Recursive, AbsUpdate, IncUpdate
- 📦 Xuất file .apkg để import vào Anki
- 💾 Lưu cấu hình tự động (localStorage)
- 🎨 Giao diện hiện đại, dễ sử dụng

## Cách sử dụng

### 1. Lấy Notion Token

1. Đăng nhập vào [Notion](https://notion.so)
2. Mở DevTools (F12)
3. Vào tab **Application** > **Cookies**
4. Tìm cookie `token_v2` và copy giá trị

### 2. Cấu hình

1. Dán **Notion Token** vào ô tương ứng
2. Nhập **Notion Namespace** (username hoặc workspace)
3. Thêm pages cần đồng bộ:
   - Nhấn **Add Item**
   - Nhập **PageID** (lấy từ URL Notion)
   - Nhập **Target Deck** (tên deck trong Anki)

### 3. Tạo file Anki

1. Nhấn **Tải từ Notion** để lấy dữ liệu
2. Đặt tên cho **Deck Name**
3. Nhấn **Xuất .apkg** để tải file
4. Import file vào Anki

## Cấu trúc thư mục

```
notion-to-anki/
├── index.html          # Giao diện chính
├── app.js              # Logic ứng dụng
├── README.md           # Hướng dẫn
└── .gitignore          # Git ignore
```

## Deploy lên GitHub Pages

### Bước 1: Tạo repository

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/notion-to-anki.git
git push -u origin main
```

### Bước 2: Bật GitHub Pages

1. Vào repository trên GitHub
2. Settings > Pages
3. Source: chọn **main branch**
4. Save

Trang web sẽ có tại: `https://USERNAME.github.io/notion-to-anki/`

## Template mặc định

Ứng dụng hỗ trợ các template giống addon:

### Basic Card Template

**Front:**
```html
<div class="prettify-flashcard">
    <div class="prettify-deck">{{Deck}}</div>
    <div class="prettify-field prettify-field--front">{{Front}}</div>
</div>
```

**Back:**
```html
<div class="prettify-flashcard">
    <div class="prettify-deck">{{Deck}}</div>
    <div class="prettify-field prettify-field--front">{{Front}}</div>
    <hr id="answer">
    <div class="prettify-field prettify-field--back">{{Back}}</div>
</div>
```

### Cloze Card Template

**Front:**
```html
<div class="prettify-flashcard">
    <div class="prettify-deck">{{Deck}}</div>
    <div class="prettify-field prettify-field--front">{{cloze:Front}}</div>
</div>
```

## Công nghệ sử dụng

- **HTML5/CSS3** - Giao diện
- **JavaScript (Vanilla)** - Logic ứng dụng
- **JSZip** - Tạo file .apkg (zip format)
- **SQL.js** - Tạo database Anki (SQLite format)
- **LocalStorage** - Lưu cấu hình

## Lưu ý

⚠️ **Quan trọng:**
- Token Notion chỉ được lưu trên trình duyệt của bạn (localStorage)
- Không gửi token đến bất kỳ server nào
- Cần CORS proxy hoặc extension để gọi Notion API từ browser

## Hạn chế hiện tại

1. **CORS Issue**: Browser block Notion API calls
   - **Giải pháp**: Sử dụng CORS proxy hoặc browser extension
   - Hoặc: Build thành desktop app với Electron

2. **Mock Data**: Phiên bản demo sử dụng dữ liệu mẫu
   - Cần implement real Notion API integration
   - Hoặc: Dùng backend server để proxy requests

## Phát triển thêm

### Tính năng đề xuất:
- [ ] Real Notion API integration với proxy
- [ ] Hỗ trợ hình ảnh và media
- [ ] Custom templates editor
- [ ] Multiple note types (Basic, Cloze, etc.)
- [ ] Preview cards trước khi export
- [ ] Batch export nhiều decks
- [ ] Import/export configuration

### Cải tiến UX:
- [ ] Dark mode
- [ ] Drag & drop pages
- [ ] Progress bar khi export
- [ ] Sync history
- [ ] Error logging

## Đóng góp

Mọi đóng góp đều được chào đón! 

1. Fork repository
2. Tạo branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Tạo Pull Request

## License

MIT License - Tự do sử dụng và chỉnh sửa

## Credits

- Dựa trên [Notion2AnkiFree Addon](https://github.com/yourusername/notion2ankifree)
- Inspired by Anki community
- Built with ❤️ for language learners

## Hỗ trợ

Nếu gặp vấn đề, vui lòng tạo [Issue](https://github.com/USERNAME/notion-to-anki/issues) trên GitHub.

---

Made with ❤️ for Anki learners
