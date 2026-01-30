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
├── index.html              # Giao diện chính
├── app.js                  # Logic ứng dụng
├── notion-api.js           # Tích hợp Notion API
├── apkg-builder.js         # Module tạo file .apkg
├── templates/              # Template cho card types
│   ├── card1-front.html    # Template mặt trước Card 1
│   ├── card1-back.html     # Template mặt sau Card 1
│   └── card1-style.css     # CSS cho Card 1
├── README.md               # Hướng dẫn
└── .gitignore              # Git ignore
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

Ứng dụng hỗ trợ các template được load từ file riêng:

### Cấu trúc Template

Mỗi card type có 3 file:
- **Front HTML** (`card1-front.html`) - Giao diện mặt trước
- **Back HTML** (`card1-back.html`) - Giao diện mặt sau  
- **CSS** (`card1-style.css`) - Style chung

### Template fields

Templates hỗ trợ các field sau:
- `{{Front}}` - Nội dung mặt trước
- `{{Back}}` - Nội dung mặt sau
- `{{Deck}}` - Tên deck
- `{{Tags}}` - Tags của thẻ
- `{{#Tags}}...{{/Tags}}` - Hiển thị có điều kiện

### Tùy chỉnh Template

1. Chỉnh sửa file HTML/CSS trong thư mục `templates/`
2. Template sẽ tự động load khi mở trang
3. Hoặc dùng nút "Reset Templates" để reload

### Thêm Card Type mới

Để thêm card type thứ 2, 3...:
1. Tạo file: `card2-front.html`, `card2-back.html`, `card2-style.css`
2. Đánh số theo thứ tự: card1, card2, card3...
3. App sẽ tự động detect và load

## Công nghệ sử dụng

- **HTML5/CSS3** - Giao diện
- **JavaScript (Vanilla)** - Logic ứng dụng
- **JSZip** - Tạo file .apkg (zip format)
- **SQL.js** - Tạo database Anki (SQLite format)
- **LocalStorage** - Lưu cấu hình

## Sửa lỗi quan trọng

✅ **Đã fix lỗi "JsonError decoding decks":**
- Sử dụng cấu trúc database Anki chuẩn
- Thêm đầy đủ các field bắt buộc (sticky, rtl, font, size...)
- Tách template ra file riêng để dễ customize
- Đúng format JSON cho models, decks, dconf

✅ **Template được load từ file external:**
- Mỗi card type có front/back/css riêng
- Đánh số: card1-*, card2-*, card3-*
- Dễ dàng thêm/sửa/xóa card types

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
