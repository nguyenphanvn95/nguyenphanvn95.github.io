        // DOM Elements
        const apiKeyInput = document.getElementById('api-key');
        const saveApiKeyBtn = document.getElementById('save-api-key');
        const levelOptions = document.querySelectorAll('.level-options .option');
        const typeOptions = document.querySelectorAll('.type-options .option');
        const startPracticeBtn = document.getElementById('start-practice');
        const exercisesSection = document.getElementById('exercises-section');
        const exercisesList = document.getElementById('exercises-list');
        const practiceSection = document.getElementById('practice-section');
        const vietnameseTextEl = document.getElementById('vietnamese-text');
        const exerciseTitle = document.getElementById('exercise-title');
        const exerciseLevel = document.getElementById('exercise-level');
        const exerciseType = document.getElementById('exercise-type');
        const currentSentenceEl = document.getElementById('current-sentence');
        const currentTranslationEl = document.getElementById('current-translation');
        const feedbackSection = document.getElementById('feedback-section');
        const feedbackContentEl = document.getElementById('feedback-content');
        const hintBtn = document.getElementById('hint-btn');
        const submitBtn = document.getElementById('submit-btn');
        const nextBtn = document.getElementById('next-btn');
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        const overallFeedbackContainer = document.getElementById('overall-feedback-container');
        const overallFeedback = document.getElementById('overall-feedback');
        const newExerciseBtn = document.getElementById('new-exercise-btn');
        const submitAllBtn = document.getElementById('submit-all-btn');
        const apiKeyError = document.getElementById('api-key-error');
        const resultsSummary = document.getElementById('results-summary');
        const originalSummary = document.getElementById('original-summary');
        const translationSummary = document.getElementById('translation-summary');
        const notification = document.getElementById('notification');
        const debugPanel = document.getElementById('debug-panel');
        const debugToggle = document.getElementById('debug-toggle');
        const debugContent = document.getElementById('debug-content');
        // Thêm các biến phân trang
    let currentPage = 1;
    const exercisesPerPage = 6;

    // DOM cho phân trang
    const pagination = document.getElementById('pagination');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');
        // App State
        let selectedLevel = null;
        let selectedType = null;
        let apiKey = null;
        let currentText = "";
        let sentences = [];
        let userTranslations = [];
        let currentSentenceIndex = 0;
        let generatedExercises = [];
        let selectedExercise = null;
        let exercisesData = {}; // Dữ liệu bài tập sẽ được load từ JSON

        // Gemini API Endpoint
        const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
        
        // Configure Marked.js
        marked.setOptions({
            breaks: true,
            gfm: true
        });

        // Show notification
        function showNotification(message, isError = true) {
            notification.textContent = message;
            notification.style.backgroundColor = isError ? '#e74c3c' : '#2ecc71';
            notification.style.display = 'block';
            
            setTimeout(() => {
                notification.style.display = 'none';
            }, 5000);
        }

        // Load exercises data from JSON file
        async function loadExercisesData() {
            try {
                const response = await fetch('exerciseData.json');
                if (!response.ok) {
                    throw new Error('Không thể tải dữ liệu bài tập');
                }
                exercisesData = await response.json();
            } catch (error) {
                console.error('Error loading exercises data:', error);
                showNotification('Có lỗi khi tải dữ liệu bài tập. Vui lòng thử lại.');
                logDebugInfo("Lỗi tải dữ liệu bài tập", error.message);
            }
        }

        // Load saved API key if exists
        window.addEventListener('DOMContentLoaded', () => {
            const savedApiKey = localStorage.getItem('gemini_api_key');
            if (savedApiKey) {
                apiKeyInput.value = savedApiKey;
                apiKey = savedApiKey;
                startPracticeBtn.disabled = false;
            }
            
            // Load exercises data
            loadExercisesData();
        });

        // Save API key
        saveApiKeyBtn.addEventListener('click', () => {
            apiKey = apiKeyInput.value.trim();
            if (apiKey) {
                localStorage.setItem('gemini_api_key', apiKey);
                startPracticeBtn.disabled = false;
                apiKeyError.style.display = 'none';
                showNotification('API key đã được lưu thành công!', false);
            } else {
                apiKeyError.textContent = 'Vui lòng nhập API key hợp lệ.';
                apiKeyError.style.display = 'block';
            }
        });

        // Select level
        levelOptions.forEach(option => {
            option.addEventListener('click', () => {
                levelOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                selectedLevel = option.getAttribute('data-level');
                checkSelections();
            });
        });

        // Select type
        typeOptions.forEach(option => {
            option.addEventListener('click', () => {
                typeOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                selectedType = option.getAttribute('data-type');
                checkSelections();
            });
        });

        // Enable start button when both selections are made
        function checkSelections() {
            if (selectedLevel && selectedType && apiKey) {
                startPracticeBtn.disabled = false;
            }
        }

       // Start practice - load predefined exercises
    startPracticeBtn.addEventListener('click', async () => {
        startPracticeBtn.innerHTML = '<span class="loading"></span> Đang tải bài tập...';
        startPracticeBtn.disabled = true;
        
        try {
            // Get exercises for selected level and type
            const exercises = exercisesData[selectedLevel][selectedType];
            // Reset về trang đầu tiên
            currentPage = 1;
            if (!exercises || exercises.length === 0) {
                throw new Error("Không tìm thấy bài tập phù hợp");
            }
            
            generatedExercises = exercises;
            renderExercisesList();
            
            // Show exercises list
            exercisesSection.style.display = 'block';
            startPracticeBtn.innerHTML = '<i class="fas fa-play"></i> Tải Bài Tập';
            startPracticeBtn.disabled = false;
            
            // Scroll to exercises section
            exercisesSection.scrollIntoView({ behavior: 'smooth' });
        } catch (error) {
            console.error('Error loading exercises:', error);
            showNotification('Có lỗi xảy ra khi tải bài tập. Vui lòng thử lại.');
            startPracticeBtn.innerHTML = '<i class="fas fa-play"></i> Tải Bài Tập';
            startPracticeBtn.disabled = false;
            logDebugInfo("Lỗi tải bài tập", error.message);
        }
    });


// Render exercises list - PHIÊN BẢN ĐÃ SỬA
    function renderExercisesList() {
        exercisesList.innerHTML = '';
        
        // Tính toán bài tập cho trang hiện tại
        const startIndex = (currentPage - 1) * exercisesPerPage;
        const endIndex = startIndex + exercisesPerPage;
        const currentExercises = generatedExercises.slice(startIndex, endIndex);
        
        currentExercises.forEach((exercise, index) => {
            const realIndex = startIndex + index;
            const exerciseCard = document.createElement('div');
            exerciseCard.className = 'exercise-card';
            exerciseCard.dataset.index = realIndex;
            
            exerciseCard.innerHTML = `
                <h3><i class="fas fa-file-alt"></i> ${exercise.title}</h3>
                <p>Bài tập ${selectedType} ở mức độ ${selectedLevel}. Nhấn để bắt đầu luyện dịch.</p>
                <div class="exercise-meta">
                    <div class="exercise-tag">${selectedLevel}</div>
                    <div class="exercise-tag">${selectedType}</div>
                </div>
            `;
            
            exerciseCard.addEventListener('click', () => {
                document.querySelectorAll('.exercise-card').forEach(card => {
                    card.classList.remove('selected');
                });
                exerciseCard.classList.add('selected');
                selectedExercise = realIndex;
                
                // Start exercise after 500ms
                setTimeout(() => {
                    startSelectedExercise();
                }, 500);
            });
            
            exercisesList.appendChild(exerciseCard);
        });
        
        // Cập nhật phân trang
        const totalPages = Math.ceil(generatedExercises.length / exercisesPerPage);
        
        if (totalPages > 1) {
            pagination.style.display = 'flex';
            pageInfo.textContent = `Trang ${currentPage}/${totalPages}`;
            
            // Cập nhật trạng thái nút
            prevPageBtn.disabled = currentPage === 1;
            nextPageBtn.disabled = currentPage === totalPages;
        } else {
            pagination.style.display = 'none';
        }
    }

    // Thêm sự kiện cho nút phân trang
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderExercisesList();
            exercisesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(generatedExercises.length / exercisesPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderExercisesList();
            exercisesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

        // Hàm ghi log debug
        function logDebugInfo(title, content) {
            debugContent.innerHTML += `\n\n=== ${title} ===\n`;
            
            if (typeof content === 'object') {
                debugContent.innerHTML += JSON.stringify(content, null, 2);
            } else {
                debugContent.innerHTML += content;
            }
            
            debugPanel.style.display = 'block';
        }
        
        debugToggle.addEventListener('click', () => {
            const isVisible = debugContent.style.display !== 'none';
            debugContent.style.display = isVisible ? 'none' : 'block';
            debugToggle.innerHTML = isVisible 
                ? '<i class="fas fa-bug"></i> Hiển thị thông tin gỡ lỗi' 
                : '<i class="fas fa-bug"></i> Ẩn thông tin gỡ lỗi';
        });

        // Start selected exercise
        async function startSelectedExercise() {
            if (selectedExercise === null) return;
            
            const exercise = generatedExercises[selectedExercise];
            exerciseTitle.textContent = exercise.title;
            exerciseLevel.textContent = selectedLevel.charAt(0).toUpperCase() + selectedLevel.slice(1);
            exerciseType.textContent = selectedType.charAt(0).toUpperCase() + selectedType.slice(1);
            
            try {
                // Generate exercise content using Gemini
                const prompt = `Hãy tạo một bài viết ngắn khoảng 12-15 câu với tiêu đề: "${exercise.title}" 
                bằng tiếng Việt, phù hợp với mức độ ${selectedLevel} và thể loại ${selectedType}. 
                Bài viết nên có nội dung liên quan đến tiêu đề và phù hợp với ngữ cảnh. 
		Nếu bài viết thư cần tên và địa chỉ thì tạo tên, địa chỉ ngẫu nhiên cho bài viết, 
		Trả lời văn bản đơn thuần, loại bỏ các ký tự không cần thiết, không cần trả lời tiêu đề bài viết. 
		Ví dụ: Tiêu đề Niềm vui nho nhỏ của tiếng cười trẻ thơ
		Bài viết là: Hôm nay là một ngày bận rộn với tôi. Tôi thức dậy sớm. Tôi pha cà phê và ăn bánh mì nướng. Tôi cảm thấy mệt mỏi nhưng vui vẻ. Tôi quyết định đi bộ đến công viên. Mặt trời chiếu sáng rực rỡ. Trong công viên, tôi nhìn thấy một đứa trẻ nhỏ. Nó đang chơi với một quả bóng bay màu đỏ. Quả bóng bay lơ lửng trên bầu trời. Đứa trẻ cười lớn. Tôi không thể không mỉm cười. Niềm vui của nó thật trong sáng. Nó khiến tôi nghĩ về hạnh phúc của chính mình. Tại sao những điều nhỏ nhặt lại khiến chúng ta cảm thấy vui? Tôi ngồi trên băng ghế để ngắm nhìn nó. 
		`;
                
                currentText = await callGeminiAPI(prompt);
                vietnameseTextEl.textContent = currentText;
                
                // Split text into sentences
                sentences = splitTextIntoSentences(currentText);
                
                // Reset translations
                userTranslations = new Array(sentences.length).fill('');
                currentSentenceIndex = 0;
                
                // Hide exercises, show practice section
                exercisesSection.style.display = 'none';
                practiceSection.style.display = 'block';
                overallFeedbackContainer.style.display = 'none';
                resultsSummary.style.display = 'none';
                
                // Scroll to practice section
                practiceSection.scrollIntoView({ behavior: 'smooth' });
                
                // Start with first sentence
                displayCurrentSentence();
                
                // Focus vào ô dịch tự động
                setTimeout(() => {
                    currentTranslationEl.focus();
                }, 300);
                
            } catch (error) {
                console.error('Error generating exercise content:', error);
                showNotification('Có lỗi khi tạo nội dung bài tập. Vui lòng thử lại.');
                logDebugInfo("Lỗi tạo nội dung bài tập", error.message);
            }
        }

        // Display current sentence
        function displayCurrentSentence() {
            // Highlight current sentence in the text
            const sentence = sentences[currentSentenceIndex];
            const highlightedText = sentences.map((s, i) => {
                if (i === currentSentenceIndex) {
                    return `<span class="current-sentence">${s}</span>`;
                }
                return s;
            }).join(' ');
            
            vietnameseTextEl.innerHTML = highlightedText;
            
            // Display current sentence for translation
            currentSentenceEl.textContent = sentence;
            currentTranslationEl.value = userTranslations[currentSentenceIndex] || '';
            
            // Clear feedback
            feedbackSection.style.display = 'none';
            feedbackContentEl.innerHTML = '';
            
            // Update progress
            const progressPercent = ((currentSentenceIndex + 1) / sentences.length) * 100;
            progressBar.style.width = `${progressPercent}%`;
            progressText.textContent = `Câu ${currentSentenceIndex + 1}/${sentences.length}`;
            
            // Scroll to current sentence
            const currentSentenceElement = vietnameseTextEl.querySelector('.current-sentence');
            if (currentSentenceElement) {
                currentSentenceElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        // Call Gemini API
        async function callGeminiAPI(prompt) {
            try {
                const response = await axios.post(
                    `${GEMINI_API_URL}?key=${apiKey}`,
                    {
                        contents: [{
                            parts: [{
                                text: prompt
                            }]
                        }]
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                return response.data.candidates[0].content.parts[0].text;
            } catch (error) {
                console.error('Gemini API Error:', error);
                if (error.response && error.response.data) {
                    console.error('API Error Details:', error.response.data);
                    if (error.response.data.error && error.response.data.error.message) {
                        throw new Error(`Gemini API: ${error.response.data.error.message}`);
                    }
                }
                throw new Error('Lỗi khi kết nối với Gemini API');
            }
        }

        // Split text into sentences
        function splitTextIntoSentences(text) {
            // Improved sentence splitting
            return text.split(/(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?|\!|…)\s/);
        }

        // Show hint for current sentence (only keywords)
        async function showHint() {
            const sentence = sentences[currentSentenceIndex];
            if (!sentence) return;
            
            // Get hint from Gemini
            try {
                hintBtn.innerHTML = '<span class="loading"></span> Đang tạo gợi ý...';
                hintBtn.disabled = true;
                
                const prompt = `Hãy đưa ra gợi ý dịch câu sau sang tiếng Anh: "${sentence}". 
                Gợi ý chỉ nên là các từ khóa, cụm từ quan trọng (tối đa 3-5 từ/cụm từ) cần dùng để dịch câu này, 
                không đưa ra cả câu dịch hoàn chỉnh. 
                Trả lời bằng một mảng JSON: { "hints": [ "từ 1", "từ 2", ... ] }`;
                
                const response = await callGeminiAPI(prompt);
                
                // Try to parse JSON response
                let hints = ["Không thể phân tích gợi ý"];
                try {
                    const jsonResponse = JSON.parse(response);
                    if (jsonResponse.hints && Array.isArray(jsonResponse.hints)) {
                        hints = jsonResponse.hints;
                    }
                } catch (e) {
                    console.error('Error parsing hints JSON:', e);
                    // If JSON parsing fails, try to extract hints from text
                    const matches = response.match(/"([^"]+)"/g);
                    if (matches) {
                        hints = matches.map(m => m.replace(/"/g, ''));
                    }
                }
                
                // Display hints
                feedbackContentEl.innerHTML = `
                    <p><strong>Gợi ý từ khóa:</strong></p>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
                        ${hints.map(hint => `<span style="background: #e8f4fc; padding: 5px 10px; border-radius: 20px;">${hint}</span>`).join('')}
                    </div>
                    <p style="margin-top: 15px; font-size: 0.9em; color: #6c757d;">
                        <i class="fas fa-info-circle"></i> Sử dụng các từ khóa này để xây dựng câu dịch của bạn.
                    </p>
                `;
                feedbackSection.style.display = 'block';
                
                hintBtn.innerHTML = '<i class="fas fa-lightbulb"></i> Gợi ý từ khóa';
                hintBtn.disabled = false;
                
            } catch (error) {
                console.error('Error getting hint:', error);
                feedbackContentEl.innerHTML = "<p>Không thể tạo gợi ý. Vui lòng thử lại.</p>";
                feedbackSection.style.display = 'block';
                
                hintBtn.innerHTML = '<i class="fas fa-lightbulb"></i> Gợi ý từ khóa';
                hintBtn.disabled = false;
            }
        }

        // Submit current translation for review
        async function submitTranslation() {
            const userTranslation = currentTranslationEl.value.trim();
            const sentence = sentences[currentSentenceIndex];
            
            if (!userTranslation) {
                feedbackContentEl.innerHTML = "<p>Vui lòng nhập bản dịch trước khi kiểm tra.</p>";
                feedbackSection.style.display = 'block';
                return;
            }
            
            // Save user translation
            userTranslations[currentSentenceIndex] = userTranslation;
            
            // Get feedback from Gemini
            try {
                submitBtn.innerHTML = '<span class="loading"></span> Đang kiểm tra...';
                submitBtn.disabled = true;
                
                const prompt = `Hãy đánh giá bản dịch sau của câu tiếng Việt sang tiếng Anh. 
                Trả lời bằng tiếng Việt, ngắn gọn (dưới 100 từ), tập trung vào độ chính xác và tự nhiên.
                Sử dụng định dạng markdown để làm rõ các điểm quan trọng.
                Câu gốc: "${sentence}"
                Bản dịch: "${userTranslation}"`;
                
                const feedback = await callGeminiAPI(prompt);
                
                feedbackContentEl.innerHTML = marked.parse(feedback);
                feedbackSection.style.display = 'block';
                
                submitBtn.innerHTML = '<i class="fas fa-check"></i> Kiểm tra';
                submitBtn.disabled = false;
                
            } catch (error) {
                console.error('Error getting feedback:', error);
                feedbackContentEl.innerHTML = "<p>Không thể kiểm tra bản dịch. Vui lòng thử lại.</p>";
                feedbackSection.style.display = 'block';
                
                submitBtn.innerHTML = '<i class="fas fa-check"></i> Kiểm tra';
                submitBtn.disabled = false;
            }
        }

        // Go to next sentence
        function goToNextSentence() {
            if (currentSentenceIndex < sentences.length - 1) {
                currentSentenceIndex++;
                displayCurrentSentence();
            } else {
                // All sentences completed
                overallFeedbackContainer.style.display = 'block';
                overallFeedbackContainer.scrollIntoView({ behavior: 'smooth' });
            }
        }

        // Submit all for overall feedback
        submitAllBtn.addEventListener('click', async () => {
            // Get overall feedback from Gemini
            try {
                submitAllBtn.innerHTML = '<span class="loading"></span> Đang tạo đánh giá...';
                submitAllBtn.disabled = true;
                
                const fullTranslation = userTranslations.join(' ');
                const prompt = `Hãy đánh giá tổng thể bản dịch sau từ tiếng Việt sang tiếng Anh. 
                Văn bản gốc: "${currentText}"
                Bản dịch: "${fullTranslation}"
                Trả lời bằng tiếng Việt, khoảng 200-300 từ, sử dụng định dạng markdown để trình bày rõ ràng.
                Bao gồm:
                - **Điểm tốt**: Liệt kê những điểm tốt trong bản dịch
                - **Điểm cần cải thiện**: Liệt kê những điểm cần cải thiện
                - **Gợi ý**: Đưa ra gợi ý để cải thiện bản dịch
                - **Điểm số**: Cho điểm từ 1-10 với giải thích ngắn gọn`;
                
                const feedback = await callGeminiAPI(prompt);
                
                overallFeedback.innerHTML = marked.parse(feedback);
                submitAllBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Gửi Đánh Giá';
                submitAllBtn.disabled = false;
                
                // Show results summary
                showResultsSummary();
                
            } catch (error) {
                console.error('Error getting overall feedback:', error);
                overallFeedback.innerHTML = "<p>Không thể tạo đánh giá tổng thể. Vui lòng thử lại.</p>";
                submitAllBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Gửi Đánh Giá';
                submitAllBtn.disabled = false;
            }
        });

        // Show results summary
        function showResultsSummary() {
            resultsSummary.style.display = 'block';
            
            // Format original text with sentence numbers
            const originalWithNumbers = sentences.map((sentence, index) => 
                `<p><strong>${index + 1}.</strong> ${sentence}</p>`
            ).join('');
            
            // Format translations with sentence numbers
            const translationWithNumbers = userTranslations.map((translation, index) => 
                `<p><strong>${index + 1}.</strong> ${translation}</p>`
            ).join('');
            
            originalSummary.innerHTML = originalWithNumbers;
            translationSummary.innerHTML = translationWithNumbers;
            
            resultsSummary.scrollIntoView({ behavior: 'smooth' });
        }

        // New exercise
        newExerciseBtn.addEventListener('click', () => {
            exercisesSection.style.display = 'block';
            practiceSection.style.display = 'none';
            resultsSummary.style.display = 'none';
            exercisesSection.scrollIntoView({ behavior: 'smooth' });
        });

        // Event listeners
        hintBtn.addEventListener('click', showHint);
        submitBtn.addEventListener('click', submitTranslation);
        nextBtn.addEventListener('click', goToNextSentence);
        
        // Setup keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            // Phím Tab - focus vào ô dịch
            if (e.key === 'Tab') {
                e.preventDefault();
                currentTranslationEl.focus();
            }
            
            // Phím H - gợi ý
            if (e.key.toLowerCase() === 'h' && 
                document.activeElement.tagName !== 'INPUT' && 
                document.activeElement.tagName !== 'TEXTAREA') {
                e.preventDefault();
                showHint();
            }
        });
        
        currentTranslationEl.addEventListener('keydown', function(e) {
            // Enter - kiểm tra
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitTranslation();
            }
            
            // Shift + Enter - chuyển câu tiếp theo
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                goToNextSentence();
            }
        });

const toggleApiSettingsBtn = document.getElementById('toggle-api-settings');
const apiKeyContainer = document.getElementById('api-key-container');

toggleApiSettingsBtn.addEventListener('click', () => {
    const isVisible = apiKeyContainer.style.display !== 'none';
    apiKeyContainer.style.display = isVisible ? 'none' : 'block';
    toggleApiSettingsBtn.innerHTML = isVisible 
        ? '<i class="fas fa-cog"></i> Cài đặt Gemini API' 
        : '<i class="fas fa-times"></i> Ẩn Cài đặt API';
});
