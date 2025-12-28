# HƯỚNG DẪN SỬ DỤNG - IELTS Practice App

## 🎯 Giới thiệu

Ứng dụng luyện thi IELTS với giao diện giống thi thật British Council, chạy hoàn toàn offline trên máy tính.

## 📦 Cài đặt trên Windows

### Bước 1: Cài đặt Node.js
1. Tải Node.js từ: https://nodejs.org/
2. Chọn phiên bản LTS (khuyên dùng)
3. Chạy file cài đặt, bấm "Next" hết
4. Khởi động lại máy tính

### Bước 2: Giải nén và chạy ứng dụng
1. Giải nén file `ielts-practice-app.zip`
2. Mở thư mục `ielts-practice-app`
3. Nhấn chuột phải vào khoảng trống → chọn "Open in Terminal" hoặc "Git Bash Here"
4. Gõ lệnh:
```bash
npm install
```
5. Đợi cài đặt xong (khoảng 2-3 phút)
6. Chạy ứng dụng:
```bash
npm run dev
```
7. Ứng dụng sẽ tự động mở ở địa chỉ: http://localhost:3000

### Lưu ý:
- Mỗi lần muốn dùng, mở Terminal trong thư mục và chạy `npm run dev`
- Không tắt cửa sổ Terminal khi đang làm bài
- Dữ liệu lưu trong trình duyệt, không cần Internet

## 📚 Cách sử dụng

### 1. Màn hình chính - Thư viện đề thi
- Hiển thị tất cả đề thi có sẵn
- Bấm "Start Test" để bắt đầu làm bài
- Bấm "Import Test" để thêm đề mới

### 2. Nhập đề thi mới

#### Cách 1: Upload file JSON
1. Bấm nút "Import Test"
2. Chọn "Upload JSON File"
3. Chọn file .json của bạn
4. Bấm "Import"

#### Cách 2: Dán JSON trực tiếp
1. Bấm nút "Import Test"
2. Dán nội dung JSON vào ô textarea
3. Bấm "Import"

### 3. Làm bài thi

#### Reading (Đọc):
- **Bên trái**: Bài đọc (passage)
- **Bên phải**: Câu hỏi
- **Panel phải**: Danh sách câu hỏi
- Bấm số câu để nhảy đến câu đó
- Bấm cờ 🚩 để đánh dấu câu cần xem lại
- Đồng hồ đếm ngược màu:
  - Trắng: Bình thường
  - Cam: Còn ≤ 10 phút
  - Đỏ: Còn ≤ 1 phút

#### Listening (Nghe):
- **Trên cùng**: Trình phát audio
- **Bên dưới**: Câu hỏi
- Bấm Play/Pause để điều khiển audio
- Lưu ý: Cần có file audio thì mới nghe được

#### Writing (Viết):
- 2 tasks: Task 1 (150 từ) và Task 2 (250 từ)
- Word counter hiển thị số từ đã viết
- Có thể chuyển qua lại giữa 2 tasks
- Màu cam: Chưa đủ số từ tối thiểu
- Màu xanh: Đã đủ số từ

### 4. Review (Xem lại)
- Bấm "Review Answers" để xem tổng quan
- Thống kê:
  - Answered: Đã trả lời
  - Unanswered: Chưa trả lời
  - Flagged: Đã đánh dấu
- Bấm vào câu hỏi để nhảy đến câu đó
- Bấm "Continue Test" để tiếp tục làm
- Bấm "Submit Test" để nộp bài

### 5. Kết quả

#### Reading & Listening:
- **Band Score**: Điểm band ước tính (1.0 - 9.0)
- **Correct/Incorrect**: Số câu đúng/sai
- **Time Spent**: Thời gian đã dùng
- Bấm "Export Results" để tải kết quả (file JSON)

#### Writing:
- Hiển thị bài viết của bạn
- Word count cho từng task
- Lưu ý: Writing không chấm tự động, cần giáo viên đánh giá

## 📝 Cấu trúc file JSON đề thi

### Đề Reading (Đọc)

```json
{
  "testId": "reading-test-1",
  "title": "Tiêu đề đề thi",
  "module": "reading",
  "description": "Mô tả ngắn",
  "timeLimit": 3600,
  "sections": [
    {
      "sectionId": 1,
      "title": "Tên passage",
      "passage": "Nội dung bài đọc đầy đủ...",
      "questions": [
        {
          "questionId": 1,
          "type": "multiple-choice-single",
          "text": "Câu hỏi?",
          "options": ["A", "B", "C", "D"],
          "correctAnswer": "B"
        }
      ]
    }
  ]
}
```

### Đề Listening (Nghe)

```json
{
  "testId": "listening-test-1",
  "title": "Tiêu đề",
  "module": "listening",
  "timeLimit": 1800,
  "sections": [
    {
      "sectionId": 1,
      "title": "Section 1",
      "audioUrl": "/audio/section1.mp3",
      "audioNote": "Ghi chú về audio",
      "questions": [...]
    }
  ]
}
```

### Đề Writing (Viết)

```json
{
  "testId": "writing-test-1",
  "title": "Tiêu đề",
  "module": "writing",
  "timeLimit": 3600,
  "tasks": [
    {
      "taskId": 1,
      "title": "Writing Task 1",
      "type": "graph-description",
      "minWords": 150,
      "instruction": "Hướng dẫn",
      "prompt": "Đề bài chi tiết..."
    },
    {
      "taskId": 2,
      "title": "Writing Task 2",
      "type": "opinion-essay",
      "minWords": 250,
      "instruction": "Hướng dẫn",
      "prompt": "Đề bài chi tiết..."
    }
  ]
}
```

## 🎯 Các loại câu hỏi

### 1. Multiple Choice Single (Chọn 1 đáp án)
```json
{
  "type": "multiple-choice-single",
  "text": "Câu hỏi",
  "options": ["A", "B", "C", "D"],
  "correctAnswer": "B"
}
```

### 2. Multiple Choice Multiple (Chọn nhiều đáp án)
```json
{
  "type": "multiple-choice-multiple",
  "text": "Chọn HAI đáp án",
  "options": ["A", "B", "C", "D"],
  "correctAnswers": ["B", "D"]
}
```

### 3. True/False/Not Given
```json
{
  "type": "true-false-notgiven",
  "text": "Nhận định",
  "correctAnswer": "TRUE"
}
```

### 4. Sentence Completion (Điền từ vào chỗ trống)
```json
{
  "type": "sentence-completion",
  "text": "Đáp án là _____",
  "correctAnswer": "đáp án đúng",
  "maxWords": 2
}
```

### 5. Short Answer (Câu trả lời ngắn)
```json
{
  "type": "short-answer",
  "text": "Câu hỏi?",
  "correctAnswer": "câu trả lời",
  "maxWords": 3
}
```

## 🎧 Thêm file audio cho Listening

1. Tạo thư mục `/public/audio/` trong project
2. Copy file audio (MP3, WAV, OGG) vào đó
3. Trong file JSON, ghi đường dẫn:
```json
"audioUrl": "/audio/section1.mp3"
```

## 💾 Lưu trữ dữ liệu

### Dữ liệu được lưu ở đâu?
- Tất cả lưu trong **localStorage** của trình duyệt
- Không cần Internet
- Không gửi dữ liệu lên server nào

### Các loại dữ liệu:
1. **Đề thi**: `ielts-tests` và `test-{testId}`
2. **Kết quả**: `test-results`
3. **Tiến độ**: `test-progress-{testId}` (tự động xóa khi nộp bài)

### Xóa dữ liệu:
1. Mở Developer Tools (F12)
2. Tab "Application" → "Local Storage"
3. Xóa các key cần thiết

## ⚠️ Xử lý lỗi thường gặp

### Lỗi: "npm is not recognized"
→ Chưa cài Node.js hoặc chưa restart máy sau khi cài

### Lỗi: Module not found
→ Chưa chạy `npm install`

### Đề thi không load
→ Kiểm tra format JSON có đúng không (dùng JSONLint.com)

### Audio không phát
→ Kiểm tra đường dẫn file audio, đảm bảo file tồn tại trong `/public/audio/`

### Timer không chạy
→ Đảm bảo tab trình duyệt đang active (không chuyển tab khác)

### Mất tiến độ
→ Không được xóa cache/cookies trong khi làm bài

## 🎓 Mẹo luyện tập hiệu quả

1. **Môi trường thi thật**:
   - Tắt điện thoại
   - Tìm chỗ yên tĩnh
   - Làm đúng giờ quy định

2. **Quản lý thời gian**:
   - Reading: 60 phút (20 phút/passage)
   - Listening: 30 phút
   - Writing: 60 phút (Task 1: 20 phút, Task 2: 40 phút)

3. **Chiến lược làm bài**:
   - Đọc câu hỏi trước khi đọc passage
   - Đánh dấu câu khó, làm sau
   - Luôn review trước khi nộp
   - Không bỏ trống câu nào

4. **Theo dõi tiến độ**:
   - Export kết quả sau mỗi bài
   - Ghi chú điểm yếu
   - Luyện tập thường xuyên

## 📊 Bảng quy đổi điểm band (ước lượng)

| % Đúng | Band Score |
|--------|------------|
| 95-100% | 9.0 |
| 90-94% | 8.5 |
| 85-89% | 8.0 |
| 80-84% | 7.5 |
| 75-79% | 7.0 |
| 70-74% | 6.5 |
| 65-69% | 6.0 |
| 60-64% | 5.5 |
| 55-59% | 5.0 |
| 50-54% | 4.5 |

*Lưu ý: Đây chỉ là ước lượng đơn giản. Điểm thi thật phức tạp hơn.*

## 🔧 Tuỳ chỉnh

### Đổi màu giao diện
Mở file `src/App.css`, tìm phần CSS variables:
```css
:root {
  --bc-navy: #003E74;
  --bc-blue: #0066B3;
  /* ... */
}
```

### Đổi thời gian làm bài
Trong file JSON của đề thi, sửa `timeLimit` (đơn vị: giây):
- 1800 = 30 phút
- 3600 = 60 phút

### Thêm font chữ khác
Mở file `index.html`, thêm Google Fonts link.

## 📞 Hỗ trợ

Nếu gặp vấn đề:
1. Đọc kỹ hướng dẫn này
2. Kiểm tra file JSON mẫu
3. Xem console của trình duyệt (F12)
4. Thử xóa localStorage và import lại

## 🎯 Checklist trước khi làm bài

- [ ] Đã cài đặt xong và chạy được app
- [ ] Đã import đề thi thành công
- [ ] Đã test thử các chức năng cơ bản
- [ ] Môi trường yên tĩnh, không bị làm phiền
- [ ] Đồng hồ và timer sẵn sàng
- [ ] Giấy nháp (nếu cần) đã chuẩn bị

---

**Chúc bạn luyện thi hiệu quả và đạt band điểm mong muốn! 🎯📚**
