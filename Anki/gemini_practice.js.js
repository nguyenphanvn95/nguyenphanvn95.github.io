// gemini_practice.js

// Hàm chuyển markdown sang HTML đơn giản
function markdownToHtml(text) {
  if (!text) return '';
  
  // Xử lý tiêu đề
  text = text.replace(/^#\s+(.*$)/gm, '<h4>$1</h4>');
  text = text.replace(/^##\s+(.*$)/gm, '<h5>$1</h5>');
  
  // Xử lý in đậm và in nghiêng
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Xử lý gạch đầu dòng
  text = text.replace(/^\s*[-*+]\s+(.*$)/gm, '<li>$1</li>');
  text = text.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  
  // Xử lý liên kết
  text = text.replace(/\[([^\[]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  
  // Xử lý các đoạn văn
  text = text.split(/\n\n+/);
  text = text.map(paragraph => {
    if (!paragraph.match(/^<(h|ul|ol|li)/)) {
      return `<p>${paragraph}</p>`;
    }
    return paragraph;
  }).join('');
  
  return text;
}

// Hàm gọi API Gemini để đánh giá câu
async function evaluateSentence(word, sentence) {
  try {
    const prompt = PROMPT_EVALUATION.replace("{word}", word).replace("{sentence}", sentence);
    
    const response = await fetch(API_URL + API_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });
    
    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Không có phản hồi.";
  } catch (error) {
    return `Lỗi kết nối: ${error.message}`;
  }
}

// Hàm hiển thị mặt sau
function showBackContainer() {
  // Ẩn phần nhập liệu mặt trước
  document.getElementById("sentence-practice").style.display = "none";
  
  // Hiển thị container mặt sau
  document.getElementById("back-container").style.display = "block";
}

// Hàm khởi tạo card
async function initCard() {
  const word = document.getElementById("practice-word").textContent.trim();
  const isBack = document.getElementById("back") !== null;
  
  // Gắn sự kiện nút Gửi đánh giá
  document.getElementById("submit-sentence").addEventListener("click", async function() {
    const sentence = document.getElementById("user-sentence").value.trim();
    if (!sentence) {
      document.getElementById("gemini-feedback").style.display = "block";
      document.getElementById("feedback-content").innerHTML = '<div class="error">Vui lòng nhập câu trước khi gửi đánh giá!</div>';
      return;
    }
    
    // Hiển thị trạng thái đang tải
    document.getElementById("gemini-feedback").style.display = "block";
    document.getElementById("feedback-content").innerHTML = '<div class="loading"><div class="spinner"></div> Đang phân tích câu...</div>';
    
    // Lưu câu vào localStorage
    localStorage.setItem(`sentence_${word}`, sentence);
    
    try {
      // Gửi đánh giá và lưu phản hồi
      const feedbackMarkdown = await evaluateSentence(word, sentence);
      const feedbackHtml = markdownToHtml(feedbackMarkdown);
      
      localStorage.setItem(`feedback_${word}`, feedbackHtml);
      document.getElementById("feedback-content").innerHTML = feedbackHtml;
    } catch (error) {
      document.getElementById("feedback-content").innerHTML = `<div class="error">Lỗi khi gửi đánh giá: ${error.message}</div>`;
    }
  });
  
  // Gắn sự kiện nút Viết lại
  document.getElementById("reset-sentence").addEventListener("click", function() {
    document.getElementById("user-sentence").value = "";
    document.getElementById("user-sentence").focus();
    document.getElementById("gemini-feedback").style.display = "none";
  });
  
  // Xử lý khi ở mặt sau (Show Answer)
  if (isBack) {
    showBackContainer();
    
    const userSentence = localStorage.getItem(`sentence_${word}`);
    const savedFeedback = localStorage.getItem(`feedback_${word}`);
    
    // Hiển thị câu đã nhập
    if (userSentence) {
      document.getElementById("back-sentence").textContent = userSentence;
    } else {
      document.getElementById("back-sentence").textContent = "Bạn chưa nhập câu";
    }
    
    // Hiển thị phản hồi nếu đã có
    if (savedFeedback) {
      document.getElementById("back-feedback").innerHTML = savedFeedback;
    } 
    // Tự động gửi đánh giá nếu chưa có phản hồi
    else if (userSentence) {
      document.getElementById("back-feedback").innerHTML = '<div class="loading"><div class="spinner"></div> Đang phân tích câu...</div>';
      
      try {
        const feedbackMarkdown = await evaluateSentence(word, userSentence);
        const feedbackHtml = markdownToHtml(feedbackMarkdown);
        
        localStorage.setItem(`feedback_${word}`, feedbackHtml);
        document.getElementById("back-feedback").innerHTML = feedbackHtml;
      } catch (error) {
        document.getElementById("back-feedback").innerHTML = `<div class="error">Lỗi khi tải đánh giá: ${error.message}</div>`;
      }
    } else {
      document.getElementById("back-feedback").innerHTML = '<div class="tip">Bạn chưa nhập câu nên không có đánh giá.</div>';
    }
  }
}

// Tạo spinner nếu chưa có
const spinnerStyle = document.createElement('style');
spinnerStyle.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .loading {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px;
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid rgba(74, 108, 247, 0.1);
    border-top: 3px solid #4a6cf7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
`;
document.head.appendChild(spinnerStyle);

// Khởi tạo card sau 100ms để đảm bảo DOM đã sẵn sàng
setTimeout(initCard, 100);