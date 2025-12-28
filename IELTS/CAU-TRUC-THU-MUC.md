# 📁 HƯỚNG DẪN TỔ CHỨC THƯ MỤC

## Cấu trúc thư mục cần tạo:

```
ielts-practice-app/
│
├── index.html
├── package.json
├── vite.config.js
├── .gitignore (đổi tên từ gitignore.txt)
│
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── App.css
│   │
│   └── components/
│       ├── TestLibrary.jsx
│       ├── TestLibrary.css
│       ├── ReadingTest.jsx
│       ├── ListeningTest.jsx
│       ├── WritingTest.jsx
│       └── TestResults.jsx
│
├── data/
│   └── tests/
│       ├── reading-advanced-1.json
│       └── listening-general-1.json
│
└── public/
    └── audio/
        (đặt file audio vào đây)
```

## 🔧 HƯỚNG DẪN TẠO THƯ MỤC:

### Bước 1: Tạo thư mục gốc
```
Tạo folder: ielts-practice-app
```

### Bước 2: Đặt file gốc
Đặt các file này vào thư mục gốc:
- index.html
- package.json
- vite.config.js
- gitignore.txt → đổi tên thành `.gitignore`

### Bước 3: Tạo thư mục src/
```
ielts-practice-app/src/
```

Đặt vào src/:
- main.jsx
- App.jsx
- App.css

### Bước 4: Tạo thư mục src/components/
```
ielts-practice-app/src/components/
```

Đặt vào src/components/:
- TestLibrary.jsx
- TestLibrary.css
- ReadingTest.jsx
- ListeningTest.jsx
- WritingTest.jsx
- TestResults.jsx

### Bước 5: Tạo thư mục data/tests/
```
ielts-practice-app/data/tests/
```

Đặt vào data/tests/:
- reading-advanced-1.json
- listening-general-1.json

### Bước 6: Tạo thư mục public/audio/
```
ielts-practice-app/public/audio/
```

(Thư mục này để chứa file audio cho listening tests - để trống cũng được)

## ✅ Checklist:

- [ ] Đã tạo thư mục gốc `ielts-practice-app/`
- [ ] Đã đặt 4 file gốc vào thư mục gốc
- [ ] Đã tạo `src/` và đặt 3 files vào
- [ ] Đã tạo `src/components/` và đặt 6 files vào
- [ ] Đã tạo `data/tests/` và đặt 2 files JSON vào
- [ ] Đã tạo `public/audio/` (có thể để trống)
- [ ] Đã đổi tên `gitignore.txt` → `.gitignore`

## 🚀 Sau khi tổ chức xong:

```bash
cd ielts-practice-app
npm install
npm run dev
```

## 📝 Danh sách file cần tải:

### Files gốc (4 files):
1. ✅ index.html
2. ✅ package.json
3. ✅ vite.config.js
4. ✅ gitignore.txt

### src/ (3 files):
5. ✅ main.jsx
6. ✅ App.jsx
7. ✅ App.css

### src/components/ (6 files):
8. ✅ TestLibrary.jsx
9. ✅ TestLibrary.css
10. ✅ ReadingTest.jsx
11. ✅ ListeningTest.jsx
12. ✅ WritingTest.jsx
13. ✅ TestResults.jsx

### data/tests/ (2 files):
14. ✅ reading-advanced-1.json
15. ✅ listening-general-1.json

### Documentation (2 files - optional):
16. ✅ README-EN.md
17. ✅ HUONG-DAN-TIENG-VIET.md

**Tổng cộng: 17 files**

## 💡 Mẹo:

1. **Windows**: Tạo folder bằng cách nhấn chuột phải → New → Folder
2. **File .gitignore**: 
   - Windows: Đổi tên từ `gitignore.txt` → `.gitignore`
   - Nếu Windows không cho đổi, dùng Command Prompt:
     ```
     ren gitignore.txt .gitignore
     ```

## ⚠️ Lưu ý quan trọng:

- **KHÔNG** tạo thư mục `node_modules/` - nó sẽ tự tạo khi chạy `npm install`
- **KHÔNG** tạo thư mục `dist/` - nó sẽ tự tạo khi build
- Đảm bảo tên file và thư mục ĐÚNG CHÍNH TẢ (phân biệt chữ hoa/thường)
- File `.gitignore` phải bắt đầu bằng dấu chấm

## 🎯 Kết quả cuối cùng:

Khi mở thư mục `ielts-practice-app` bạn sẽ thấy:
```
📁 data/
📁 public/
📁 src/
📄 .gitignore
📄 index.html
📄 package.json
📄 vite.config.js
📄 README-EN.md (optional)
📄 HUONG-DAN-TIENG-VIET.md (optional)
```

Xong! Bây giờ chạy `npm install` và `npm run dev` là được! 🎉
