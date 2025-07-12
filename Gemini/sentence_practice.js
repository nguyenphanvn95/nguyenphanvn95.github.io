// DOM Elements
const apiKeyInput = document.getElementById('api-key-input');
const saveApiBtn = document.getElementById('save-api-btn');
const apiStatus = document.getElementById('api-status');
const vietnameseText = document.getElementById('vietnamese-text');
const showHintBtn = document.getElementById('show-hint-btn');
const hintContent = document.getElementById('hint-content');
const sentenceInput = document.getElementById('sentence-input');
const skipBtn = document.getElementById('skip-btn');
const submitBtn = document.getElementById('submit-btn');
const spinner = document.getElementById('spinner');
const suggestionText = document.getElementById('suggestion-text');
const errorsList = document.getElementById('errors');
const summary = document.getElementById('summary');
const defaultFeedback = document.getElementById('default-feedback');
const levelCards = document.querySelectorAll('.level-card');
const categoryItems = document.querySelectorAll('.category-item');
const startPracticeBtn = document.getElementById('start-practice-btn');
const practiceContainer = document.getElementById('practice-container');
const levelIndicator = document.getElementById('level-indicator');
const backBtn = document.getElementById('back-btn');

// App State
let currentSentenceIndex = 0;
let geminiApiKey = localStorage.getItem('gemini_api_key') || '';
let selectedLevel = '';
let selectedCategory = '';
let sentences = [];
let hintCache = {}; // Cache for hints to avoid repeated API calls
let generatedSentences = JSON.parse(localStorage.getItem('generated_sentences')) || {};

// Initialize the app
async function initApp() {
    // Load API key if exists
    if (geminiApiKey) {
        apiKeyInput.value = geminiApiKey;
        apiStatus.textContent = '✅ API Key đã được lưu';
        apiStatus.style.color = 'green';
    } else {
        apiStatus.textContent = '⚠️ Vui lòng nhập API Key để sử dụng Gemini AI';
        apiStatus.style.color = '#e74c3c';
    }
    
    // Add event listeners
    setupEventListeners();
}

// Set up event listeners
function setupEventListeners() {
    // Level selection
    levelCards.forEach(card => {
        card.addEventListener('click', () => {
            // Remove active class from all cards
            levelCards.forEach(c => c.classList.remove('active'));
            // Add active class to clicked card
            card.classList.add('active');
            selectedLevel = card.getAttribute('data-level');
        });
    });
    
    // Category selection
    categoryItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all items
            categoryItems.forEach(i => i.classList.remove('active'));
            // Add active class to clicked item
            item.classList.add('active');
            selectedCategory = item.getAttribute('data-category');
        });
    });
    
    // Start practice button
    startPracticeBtn.addEventListener('click', async () => {
        if (!selectedLevel || !selectedCategory) {
            alert('Vui lòng chọn mức độ và thể loại trước khi bắt đầu');
            return;
        }
        
        if (!geminiApiKey) {
            apiStatus.textContent = '⚠️ Vui lòng nhập API Key để bắt đầu luyện tập';
            apiStatus.style.color = '#e74c3c';
            return;
        }
        
        // Show loading state
        startPracticeBtn.disabled = true;
        startPracticeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo câu luyện tập...';
        
        try {
            // Hide level/category section, show practice section
            document.querySelector('.level-category-section').classList.add('hidden');
            practiceContainer.classList.remove('hidden');
            
            // Set level indicator
            levelIndicator.textContent = `${selectedLevel.charAt(0).toUpperCase() + selectedLevel.slice(1)} | ${getCategoryName(selectedCategory)}`;
            
            // Generate or load sentences for selected level and category
            const cacheKey = `${selectedLevel}_${selectedCategory}`;
            
            if (!generatedSentences[cacheKey] || generatedSentences[cacheKey].length === 0) {
                // Generate new sentences if not in cache
                sentences = await generateSentences(selectedLevel, selectedCategory);
                generatedSentences[cacheKey] = sentences;
                localStorage.setItem('generated_sentences', JSON.stringify(generatedSentences));
            } else {
                // Use cached sentences
                sentences = generatedSentences[cacheKey];
            }
            
            // Load first sentence
            loadSentence();
        } catch (error) {
            console.error('Error starting practice:', error);
            alert('Đã xảy ra lỗi khi tạo câu luyện tập. Vui lòng thử lại.');
        } finally {
            // Reset button state
            startPracticeBtn.disabled = false;
            startPracticeBtn.innerHTML = '<i class="fas fa-play"></i> Bắt đầu luyện tập';
        }
    });
    
    // Toggle hint visibility
    showHintBtn.addEventListener('click', async () => {
        if (hintContent.style.display === 'flex') {
            hintContent.style.display = 'none';
            showHintBtn.innerHTML = '<i class="fas fa-lightbulb"></i> Hiển thị gợi ý';
        } else {
            // Show loading state
            hintContent.innerHTML = '<div class="spinner"><div class="spinner-border"></div><p>Đang tải gợi ý...</p></div>';
            hintContent.style.display = 'flex';
            
            // Generate hints using Gemini AI
            const vietnamese = sentences[currentSentenceIndex].vi;
            const hints = await getGeminiHints(vietnamese);
            
            // Display hints
            loadHintWords(hints);
            
            showHintBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Ẩn gợi ý';
        }
    });
    
    // Save API key
    saveApiBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        
        if (key) {
            localStorage.setItem('gemini_api_key', key);
            geminiApiKey = key;
            apiStatus.textContent = '✅ API Key đã được lưu';
            apiStatus.style.color = 'green';
        } else {
            apiStatus.textContent = '⚠️ Vui lòng nhập API Key';
            apiStatus.style.color = '#e74c3c';
        }
    });
    
    // Skip to next sentence
    skipBtn.addEventListener('click', async () => {
        currentSentenceIndex++;
        
        // Check if we need to generate more sentences
        if (currentSentenceIndex >= sentences.length) {
            try {
                // Show loading state
                skipBtn.disabled = true;
                skipBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo thêm câu...';
                
                // Generate new sentences
                const newSentences = await generateSentences(selectedLevel, selectedCategory);
                
                // Update sentences array and cache
                const cacheKey = `${selectedLevel}_${selectedCategory}`;
                sentences = [...newSentences];
                generatedSentences[cacheKey] = sentences;
                localStorage.setItem('generated_sentences', JSON.stringify(generatedSentences));
                
                // Reset index
                currentSentenceIndex = 0;
                
                // Load new sentence
                loadSentence();
            } catch (error) {
                console.error('Error generating more sentences:', error);
                alert('Đã xảy ra lỗi khi tạo thêm câu. Vui lòng thử lại.');
            } finally {
                // Reset button state
                skipBtn.disabled = false;
                skipBtn.innerHTML = '<i class="fas fa-forward"></i> Câu tiếp theo';
            }
        } else {
            // Just load next sentence
            loadSentence();
        }
    });
    
    // Back to level/category selection
    backBtn.addEventListener('click', () => {
        practiceContainer.classList.add('hidden');
        document.querySelector('.level-category-section').classList.remove('hidden');
        clearFeedback();
    });
    
    // Submit translation for checking
    submitBtn.addEventListener('click', async () => {
        if (!geminiApiKey) {
            apiStatus.textContent = '⚠️ Vui lòng nhập API Key trước khi gửi';
            apiStatus.style.color = '#e74c3c';
            return;
        }
        
        const studentTranslation = sentenceInput.value.trim();
        
        if (!studentTranslation) {
            alert('Vui lòng nhập bản dịch của bạn trước khi gửi');
            return;
        }
        
        // Show spinner while processing
        spinner.style.display = 'block';
        defaultFeedback.style.display = 'none';
        
        try {
            // Get feedback from Gemini AI
            const feedback = await getGeminiFeedback(
                sentences[currentSentenceIndex].vi, 
                studentTranslation
            );
            
            // Display feedback
            displayFeedback(feedback);
        } catch (error) {
            console.error('Error getting feedback:', error);
            alert('Đã xảy ra lỗi khi kết nối với Gemini AI. Vui lòng thử lại.');
        } finally {
            // Hide spinner
            spinner.style.display = 'none';
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Skip if in API key input
        if (document.activeElement === apiKeyInput) return;
        
        // Enter: Submit translation
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitBtn.click();
        }
        
        // Shift+Enter: Skip to next sentence
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            skipBtn.click();
        }
        
        // H: Toggle hints (chỉ khi không ở trong textarea)
        if ((e.key === 'h' || e.key === 'H') && document.activeElement !== sentenceInput) {
            e.preventDefault();
            showHintBtn.click();
        }
        
        // Tab: Focus on input field
        if (e.key === 'Tab' && document.activeElement !== sentenceInput) {
            e.preventDefault();
            sentenceInput.focus();
        }
    });
}

// Generate sentences using Gemini AI
async function generateSentences(level, category) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;
    
    // Construct the prompt based on level and category
    const levelDescription = {
        'beginner': 'đơn giản, ngắn gọn, sử dụng từ vựng cơ bản',
        'intermediate': 'phức tạp hơn, có thể chứa các cụm từ và cấu trúc ngữ pháp trung cấp',
        'advanced': 'phức tạp, sử dụng từ vựng nâng cao và cấu trúc ngữ pháp phức tạp'
    }[level] || 'đơn giản, ngắn gọn';
    
    const prompt = `Bạn là một giáo viên dạy tiếng Anh. Hãy tạo 10 câu tiếng Việt thuộc chủ đề "${getCategoryName(category)}" với mức độ ${levelDescription}.
    
    Yêu cầu:
    - Mỗi câu phải phù hợp với mức độ ${level} và chủ đề ${category}
    - Các câu phải đa dạng, không trùng lặp
    - Trả về kết quả dưới dạng mảng JSON với cấu trúc: [{"vi": "Câu tiếng Việt 1"}, {"vi": "Câu tiếng Việt 2"}, ...]
    - Chỉ trả về mảng JSON, không có bất kỳ văn bản nào khác`;
    
    const requestBody = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000
        }
    };
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    
    // Extract JSON from the response
    try {
        // Find JSON substring in the response
        const jsonStart = responseText.indexOf('[');
        const jsonEnd = responseText.lastIndexOf(']') + 1;
        const jsonString = responseText.substring(jsonStart, jsonEnd);
        
        return JSON.parse(jsonString);
    } catch (e) {
        console.error('Error parsing generated sentences:', e);
        // Fallback sentences if parsing fails
        return [
            { vi: "Xin chào, hôm nay bạn thế nào?" },
            { vi: "Bạn có thể giúp tôi một chút được không?" },
            { vi: "Tôi muốn học tiếng Anh để đi du lịch." },
            { vi: "Thời tiết hôm nay thật đẹp phải không?" },
            { vi: "Bạn có biết nhà hàng nào ngon quanh đây không?" },
            { vi: "Tôi thích đọc sách vào thời gian rảnh." },
            { vi: "Bạn đã từng đi du lịch nước ngoài chưa?" },
            { vi: "Tôi cần mua một ít đồ dùng cá nhân." },
            { vi: "Bạn có thể nói chậm lại một chút được không?" },
            { vi: "Cảm ơn bạn đã giúp đỡ tôi." }
        ];
    }
}

// Get category name for display
function getCategoryName(category) {
    const categoryNames = {
        'everyday': 'Công việc hàng ngày',
        'transportation': 'Giao thông & Du lịch',
        'education': 'Trường học & Giáo dục',
        'public-services': 'Dịch vụ công cộng',
        'health': 'Sức khỏe & Y tế',
        'shopping': 'Mua sắm & Tiền bạc',
        'entertainment': 'Giải trí & Thư giãn',
        'nature': 'Thiên nhiên & Môi trường',
        'science': 'Khoa học & Công nghệ',
        'government': 'Chính phủ & Chính trị',
        'history': 'Lịch sử & Địa lý',
        'sports': 'Thể thao & Thể hình'
    };
    return categoryNames[category] || category;
}

// Load a sentence
function loadSentence() {
    vietnameseText.textContent = sentences[currentSentenceIndex].vi;
    sentenceInput.value = '';
    clearFeedback();
    
    // Hide hint content by default
    hintContent.style.display = 'none';
    hintContent.innerHTML = '';
    showHintBtn.innerHTML = '<i class="fas fa-lightbulb"></i> Hiển thị gợi ý';
    
    // Focus on input field
    sentenceInput.focus();
}

// Get hints from Gemini AI
async function getGeminiHints(vietnameseSentence) {
    // Check cache first
    if (hintCache[vietnameseSentence]) {
        return hintCache[vietnameseSentence];
    }
    
    if (!geminiApiKey) {
        alert('Vui lòng nhập API Key để sử dụng tính năng gợi ý');
        return [];
    }
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;
    
    // Construct the prompt
    const prompt = `Bạn là một trợ lý học tiếng Anh. Hãy cung cấp một số từ vựng và cụm từ hữu ích để dịch câu sau sang tiếng Anh.
    
    Câu tiếng Việt: "${vietnameseSentence}"
    
    Hãy trả về kết quả dưới dạng một mảng JSON của các đối tượng, mỗi đối tượng có hai thuộc tính: "en" (từ/cụm từ tiếng Anh) và "vi" (nghĩa tiếng Việt). Chỉ trả về mảng JSON, không có bất kỳ văn bản nào khác.`;
    
    const requestBody = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 500
        }
    };
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status}`);
        }
        
        const data = await response.json();
        const responseText = data.candidates[0].content.parts[0].text;
        
        // Extract JSON from the response
        try {
            // Find JSON substring in the response
            const jsonStart = responseText.indexOf('[');
            const jsonEnd = responseText.lastIndexOf(']') + 1;
            const jsonString = responseText.substring(jsonStart, jsonEnd);
            
            const hints = JSON.parse(jsonString);
            // Cache the result
            hintCache[vietnameseSentence] = hints;
            return hints;
        } catch (e) {
            console.error('Error parsing Gemini hints:', e);
            return [
                { en: "Error", vi: "Không thể tải gợi ý" }
            ];
        }
    } catch (error) {
        console.error('Error getting hints:', error);
        return [
            { en: "Error", vi: "Lỗi kết nối với AI" }
        ];
    }
}

// Load hint words
function loadHintWords(hints) {
    hintContent.innerHTML = '';
    
    if (!hints || hints.length === 0) {
        hintContent.innerHTML = '<p>Không có gợi ý nào được tìm thấy</p>';
        return;
    }
    
    hints.forEach(hint => {
        const hintElement = document.createElement('div');
        hintElement.className = 'hint-word';
        hintElement.innerHTML = `
            <span class="en">${hint.en}</span>
            <span class="vi">${hint.vi}</span>
        `;
        
        // Add click event to insert word
        hintElement.addEventListener('click', () => {
            insertWordAtCursor(hint.en);
        });
        
        hintContent.appendChild(hintElement);
    });
}

// Insert word at cursor position
function insertWordAtCursor(word) {
    const cursorPos = sentenceInput.selectionStart;
    const textBefore = sentenceInput.value.substring(0, cursorPos);
    const textAfter = sentenceInput.value.substring(cursorPos);
    
    // Add space before word if needed
    const spaceBefore = textBefore.length > 0 && !textBefore.endsWith(' ') ? ' ' : '';
    // Add space after word if needed
    const spaceAfter = textAfter.length > 0 && !textAfter.startsWith(' ') ? ' ' : '';
    
    sentenceInput.value = textBefore + spaceBefore + word + spaceAfter + textAfter;
    
    // Set cursor position after the inserted word
    const newCursorPos = cursorPos + spaceBefore.length + word.length + spaceAfter.length;
    sentenceInput.setSelectionRange(newCursorPos, newCursorPos);
    sentenceInput.focus();
}

// Clear feedback area
function clearFeedback() {
    defaultFeedback.style.display = 'block';
    suggestionText.style.display = 'none';
    errorsList.style.display = 'none';
    summary.style.display = 'none';
}

// Get feedback from Gemini AI
async function getGeminiFeedback(vietnamese, studentTranslation) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;
    
    // Construct the prompt
    const prompt = `Bạn là một giáo viên dạy tiếng Anh. Hãy kiểm tra bản dịch của học sinh và đưa ra nhận xét bằng tiếng Việt.
    
    Câu gốc tiếng Việt: "${vietnamese}"
    Câu dịch của học sinh: "${studentTranslation}"
    
    Hãy thực hiện các bước sau:
    1. So sánh bản dịch của học sinh với bản dịch chuẩn
    2. Chỉ ra lỗi (nếu có) và giải thích ngắn gọn
    3. Đưa ra gợi ý cải thiện
    4. Cuối cùng, đưa ra bản dịch chuẩn
    
    Kết quả trả về dưới dạng JSON với cấu trúc:
    {
        "correction": "Bản dịch chuẩn",
        "suggestions": ["Gợi ý 1", "Gợi ý 2", ...],
        "explanation": "Giải thích tổng quan về lỗi và cách cải thiện"
    }`;
    
    const requestBody = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800
        }
    };
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;
    
    // Extract JSON from the response
    try {
        // Find JSON substring in the response
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}') + 1;
        const jsonString = responseText.substring(jsonStart, jsonEnd);
        
        return JSON.parse(jsonString);
    } catch (e) {
        console.error('Error parsing Gemini response:', e);
        return {
            correction: "Bản dịch chuẩn không khả dụng",
            suggestions: ["Không thể phân tích phản hồi từ AI"],
            explanation: "Xin lỗi, đã xảy ra lỗi khi phân tích phản hồi từ Gemini AI."
        };
    }
}

// Display feedback from Gemini
function displayFeedback(feedback) {
    // Show all feedback elements
    suggestionText.style.display = 'block';
    errorsList.style.display = 'block';
    summary.style.display = 'block';
    defaultFeedback.style.display = 'none';
    
    // Display explanation first
    summary.innerHTML = `<strong>Nhận xét:</strong> ${feedback.explanation || "Không có nhận xét cụ thể."}`;
    
    // Display suggestions
    errorsList.innerHTML = '';
    if (feedback.suggestions && feedback.suggestions.length > 0) {
        feedback.suggestions.forEach(suggestion => {
            const li = document.createElement('li');
            li.textContent = suggestion;
            errorsList.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = "Bản dịch của bạn rất tốt! Không có lỗi cần sửa.";
        errorsList.appendChild(li);
    }
    
    // Display correction last
    suggestionText.innerHTML = `<strong>Bản dịch gợi ý:</strong> ${feedback.correction || "Không có bản dịch gợi ý."}`;
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    initApp().catch(error => {
        console.error('Khởi tạo ứng dụng thất bại:', error);
        alert('Đã xảy ra lỗi khi khởi tạo ứng dụng. Vui lòng tải lại trang.');
    });
});

// Toggle hiển thị khu vực nhập API key
const toggleApiSettingsBtn = document.getElementById('toggle-api-settings');
const apiKeySection = document.getElementById('api-key-section');

toggleApiSettingsBtn.addEventListener('click', () => {
    const isVisible = apiKeySection.style.display !== 'none';
    apiKeySection.style.display = isVisible ? 'none' : 'block';
    toggleApiSettingsBtn.innerHTML = isVisible
        ? '<i class="fas fa-cog"></i> Cài đặt Gemini API'
        : '<i class="fas fa-times"></i> Ẩn Cài đặt API';
});
