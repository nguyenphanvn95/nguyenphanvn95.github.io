 //Chèn trước </body>  <script src="assistant.js"></script>
//<!-- thư mục nhỏ hơn -->
//<script src="../assistant.js"></script>

const geminiContainer = document.createElement('div');
geminiContainer.innerHTML = `
<div id="gemini-bubble-container">
    <div id="gemini-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20Z" fill="white"/>
            <path d="M12 6C8.69 6 6 8.69 6 12C6 15.31 8.69 18 12 18C15.31 18 18 15.31 18 12C18 8.69 15.31 6 12 6ZM12 16C9.79 16 8 14.21 8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12C16 14.21 14.21 16 12 16Z" fill="white"/>
            <circle cx="12" cy="12" r="2" fill="white"/>
        </svg>
    </div>
    <div id="gemini-chat-container">
        <div class="chat-header">
            <h3>Gemini AI Assistant</h3>
            <div class="header-controls">
                <button class="settings-btn"><i class="fas fa-cog"></i></button>
                <button class="close-btn">×</button>
            </div>
        </div>
        <div class="chat-body">
            <div class="message bot-message">
                <div class="bot-message-content">
                    <p>Xin chào! Tôi là trợ lý Gemini AI.</p>
                    <p>Để bắt đầu:</p>
                    <ol>
                        <li>Nhấn biểu tượng <i class="fas fa-cog"></i> để mở cài đặt</li>
                        <li>Nhập API Key Gemini của bạn</li>
                        <li>Nhấn "Lưu" và bắt đầu trò chuyện</li>
                    </ol>
                    <p>Bạn có thể hỏi tôi bất kỳ điều gì!</p>
                </div>
            </div>
        </div>
        <div class="api-settings">
            <div class="api-input">
                <input type="password" id="api-key-input" placeholder="Nhập API Key Gemini">
                <button id="save-api-key">Lưu</button>
            </div>
            <div class="api-status" id="api-status">
                <i class="fas fa-info-circle"></i> <span>API Key chưa được cài đặt</span>
            </div>
        </div>
        <div class="chat-input">
            <input type="text" id="user-input" placeholder="Nhập câu hỏi...">
            <button id="send-btn"><i class="fas fa-paper-plane"></i></button>
        </div>
    </div>
</div>
`;
document.body.appendChild(geminiContainer);

// Inject custom Gemini CSS into <head>
(function injectGeminiStyles() {
    const css = `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        #gemini-bubble-container {
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 9999;
        }

        #gemini-icon {
            width: 70px;
            height: 70px;
            background: linear-gradient(135deg, #3494e6, #ec6ead);
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            cursor: pointer;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
            animation: pulse 2s infinite;
        }

        #gemini-icon:hover {
            transform: scale(1.1);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
        }

        #gemini-icon svg {
            width: 40px;
            height: 40px;
        }

        #gemini-chat-container {
            position: absolute;
            bottom: 85px;
            right: 0;
            width: 380px;
            height: 520px;
            background: #1a1a2e;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            display: none;
            flex-direction: column;
            overflow: hidden;
            z-index: 10000;
        }

        .chat-header {
            background: linear-gradient(90deg, #0f2027, #203a43, #2c5364);
            padding: 15px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: white;
        }

        .chat-header h3 {
            font-size: 1.2rem;
            font-weight: 600;
        }

        .header-controls {
            display: flex;
            gap: 10px;
        }

        .close-btn, .settings-btn {
            background: none;
            border: none;
            color: white;
            font-size: 1.2rem;
            cursor: pointer;
            transition: transform 0.2s;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
        }

        .close-btn:hover, .settings-btn:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: scale(1.1);
        }

        .chat-body {
            flex: 1;
            padding: 15px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 15px;
            background: #0f3460;
        }

        .message {
            max-width: 85%;
            padding: 12px 15px;
            border-radius: 18px;
            animation: fadeIn 0.3s ease;
        }

        .user-message {
            align-self: flex-end;
            background: linear-gradient(90deg, #3494e6, #ec6ead);
            color: white;
            border-bottom-right-radius: 5px;
        }

        .bot-message {
            align-self: flex-start;
            background: #16213e;
            color: #e1e1e1;
            border-bottom-left-radius: 5px;
        }

        .bot-message-content {
            line-height: 1.6;
        }

        .bot-message-content h1, .bot-message-content h2, .bot-message-content h3 {
            color: #4facfe;
            margin: 10px 0;
        }

        .bot-message-content p {
            margin: 8px 0;
        }

        .bot-message-content ul, .bot-message-content ol {
            margin: 10px 0;
            padding-left: 20px;
        }

        .bot-message-content li {
            margin-bottom: 5px;
        }

        .bot-message-content pre {
            background: #1e1e1e;
            border-radius: 8px;
            padding: 12px;
            margin: 10px 0;
            overflow-x: auto;
            font-family: monospace;
        }

        .bot-message-content code {
            background: #2c2c54;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
        }

        .bot-message-content blockquote {
            border-left: 3px solid #4facfe;
            padding-left: 12px;
            margin: 10px 0;
            color: #aaa;
        }

        .api-settings {
            padding: 15px;
            background: #16213e;
            border-top: 1px solid #2c5364;
            display: none;
        }

        .api-input {
            display: flex;
            margin-bottom: 10px;
        }

        .api-input input {
            flex: 1;
            padding: 10px;
            border: 1px solid #2c5364;
            border-radius: 5px 0 0 5px;
            background: #1a1a2e;
            color: white;
            outline: none;
        }

        .api-input button {
            padding: 10px 15px;
            background: linear-gradient(90deg, #3494e6, #ec6ead);
            border: none;
            border-radius: 0 5px 5px 0;
            color: white;
            cursor: pointer;
            transition: background 0.3s;
        }

        .api-input button:hover {
            background: linear-gradient(90deg, #2c83d0, #d45d9d);
        }

        .chat-input {
            display: flex;
            padding: 15px;
            background: #16213e;
            border-top: 1px solid #2c5364;
        }

        .chat-input input {
            flex: 1;
            padding: 12px;
            border: 1px solid #2c5364;
            border-radius: 25px 0 0 25px;
            background: #1a1a2e;
            color: white;
            outline: none;
        }

        .chat-input button {
            padding: 12px 20px;
            background: linear-gradient(90deg, #3494e6, #ec6ead);
            border: none;
            border-radius: 0 25px 25px 0;
            color: white;
            cursor: pointer;
            transition: background 0.3s;
        }

        .chat-input button:hover {
            background: linear-gradient(90deg, #2c83d0, #d45d9d);
        }

        .api-status {
            font-size: 0.8rem;
            color: #aaa;
            margin-top: 8px;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .api-status.valid {
            color: #4ade80;
        }

        .api-status.invalid {
            color: #f87171;
        }

        .typing-indicator {
            display: flex;
            align-items: center;
            gap: 5px;
            margin-top: 5px;
            color: #aaa;
            font-size: 0.9rem;
        }

        .typing-indicator span {
            width: 8px;
            height: 8px;
            background: #aaa;
            border-radius: 50%;
            display: inline-block;
            animation: bounce 1.5s infinite;
        }

        .typing-indicator span:nth-child(2) {
            animation-delay: 0.2s;
        }

        .typing-indicator span:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
        }

        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(52, 152, 219, 0.7); }
            70% { box-shadow: 0 0 0 15px rgba(52, 152, 219, 0); }
            100% { box-shadow: 0 0 0 0 rgba(52, 152, 219, 0); }
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    const styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);
})();
    
    // Gemini Chat Bubble Functionality
        document.addEventListener('DOMContentLoaded', function() {
            const geminiIcon = document.getElementById('gemini-icon');
            const chatContainer = document.getElementById('gemini-chat-container');
            const closeBtn = document.querySelector('.close-btn');
            const settingsBtn = document.querySelector('.settings-btn');
            const sendBtn = document.getElementById('send-btn');
            const userInput = document.getElementById('user-input');
            const chatBody = document.querySelector('.chat-body');
            const apiKeyInput = document.getElementById('api-key-input');
            const saveApiKeyBtn = document.getElementById('save-api-key');
            const apiStatus = document.getElementById('api-status');
            const apiSettings = document.querySelector('.api-settings');
            
            // Check if API key exists in localStorage
            const savedApiKey = localStorage.getItem('gemini-api-key');
            if (savedApiKey) {
                apiStatus.innerHTML = '<i class="fas fa-check-circle"></i> <span>API Key đã được lưu</span>';
                apiStatus.classList.add('valid');
                apiKeyInput.value = savedApiKey;
            }
            
            // Toggle chat container
            geminiIcon.addEventListener('click', function() {
                chatContainer.style.display = 'flex';
                userInput.focus();
            });
            
            // Close chat container
            closeBtn.addEventListener('click', function() {
                chatContainer.style.display = 'none';
                apiSettings.style.display = 'none';
            });
            
            // Toggle API settings
            settingsBtn.addEventListener('click', function() {
                if (apiSettings.style.display === 'block') {
                    apiSettings.style.display = 'none';
                } else {
                    apiSettings.style.display = 'block';
                    apiKeyInput.focus();
                }
            });
            
            // Save API key
            saveApiKeyBtn.addEventListener('click', function() {
                const apiKey = apiKeyInput.value.trim();
                if (apiKey) {
                    localStorage.setItem('gemini-api-key', apiKey);
                    apiStatus.innerHTML = '<i class="fas fa-check-circle"></i> <span>API Key đã được lưu</span>';
                    apiStatus.classList.add('valid');
                    apiStatus.classList.remove('invalid');
                    
                    // Add confirmation message
                    addMessage('API Key của bạn đã được lưu thành công! Bạn có thể bắt đầu hỏi tôi.', 'bot');
                    
                    // Hide settings after saving
                    setTimeout(() => {
                        apiSettings.style.display = 'none';
                    }, 2000);
                }
            });
            
            // Send message on button click
            sendBtn.addEventListener('click', sendMessage);
            
            // Send message on Enter key
            userInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
            
            // Function to call Gemini API
            async function callGeminiAPI(apiKey, message) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
                
                const requestData = {
                    contents: [{
                        parts: [{
                            text: message
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.9,
                        topK: 1,
                        topP: 1,
                        maxOutputTokens: 2048,
                        stopSequences: []
                    },
                    safetySettings: [{
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }, {
                        category: "HARM_CATEGORY_HATE_SPEECH",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }, {
                        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }, {
                        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }]
                };

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestData)
                    });

                    const result = await response.json();
                    
                    if (result.error) {
                        throw new Error(result.error.message);
                    }

                    // Extract the response text
                    return result.candidates?.[0]?.content?.parts?.[0]?.text || 
                           "Xin lỗi, tôi không thể tạo câu trả lời. Vui lòng thử lại.";
                } catch (error) {
                    console.error('Lỗi khi gọi Gemini API:', error);
                    return `Đã xảy ra lỗi: ${error.message || 'Không thể kết nối đến Gemini API'}`;
                }
            }
            
            // Function to convert markdown to HTML
            function markdownToHtml(markdown) {
                try {
                    // Sử dụng thư viện marked để chuyển đổi markdown sang HTML
                    return marked.parse(markdown);
                } catch (e) {
                    console.error('Lỗi chuyển đổi markdown:', e);
                    return markdown; // Trả về nguyên bản nếu có lỗi
                }
            }
            
            // Send message function
            async function sendMessage() {
                const message = userInput.value.trim();
                if (message === '') return;
                
                // Add user message
                addMessage(message, 'user');
                userInput.value = '';
                
                // Check if API key is set
                const apiKey = localStorage.getItem('gemini-api-key');
                if (!apiKey) {
                    addMessage('Vui lòng nhập API Key Gemini trước khi gửi câu hỏi. Nhấn biểu tượng ⚙️ để cài đặt.', 'bot');
                    apiSettings.style.display = 'block';
                    return;
                }
                
                // Show typing indicator
                const typingIndicator = document.createElement('div');
                typingIndicator.className = 'typing-indicator';
                typingIndicator.innerHTML = 'Gemini đang trả lời<span>.</span><span>.</span><span>.</span>';
                chatBody.appendChild(typingIndicator);
                chatBody.scrollTop = chatBody.scrollHeight;
                
                try {
                    // Call Gemini API with user's question
                    const responseText = await callGeminiAPI(apiKey, message);
                    
                    // Remove typing indicator
                    chatBody.removeChild(typingIndicator);
                    
                    // Add bot response with formatted markdown
                    addMessage(responseText, 'bot');
                } catch (error) {
                    chatBody.removeChild(typingIndicator);
                    addMessage(`Lỗi: ${error.message}`, 'bot');
                    apiStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <span>API Key không hợp lệ</span>';
                    apiStatus.classList.add('invalid');
                    apiStatus.classList.remove('valid');
                }
            }
            
            // Add message to chat with markdown support
            function addMessage(text, sender) {
                const messageDiv = document.createElement('div');
                messageDiv.classList.add('message');
                messageDiv.classList.add(sender === 'user' ? 'user-message' : 'bot-message');
                
                if (sender === 'user') {
                    messageDiv.textContent = text;
                } else {
                    // For bot messages, convert markdown to HTML
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'bot-message-content';
                    contentDiv.innerHTML = markdownToHtml(text);
                    messageDiv.appendChild(contentDiv);
                }
                
                chatBody.appendChild(messageDiv);
                
                // Scroll to bottom
                chatBody.scrollTop = chatBody.scrollHeight;
            }
        });