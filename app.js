document.getElementById('submit-btn').addEventListener('click', async function() {
    const userText = document.getElementById('user-writing').value;
    const promptText = document.getElementById('prompt-text').textContent;
    
    if (!userText.trim()) {
        alert('Please write something first!');
        return;
    }
    
    // Hiển thị loading
    const feedbackContainer = document.getElementById('feedback-container');
    const feedbackContent = document.getElementById('feedback-content');
    feedbackContent.innerHTML = '<p>Analyzing your writing...</p>';
    feedbackContainer.style.display = 'block';
    
    try {
        // Gọi API OpenAI
        const feedback = await getFeedbackFromGPT(promptText, userText);
        feedbackContent.innerHTML = formatFeedback(feedback);
    } catch (error) {
        feedbackContent.innerHTML = `<p>Error: ${error.message}</p>`;
    }
});

async function getFeedbackFromGPT(prompt, userText) {
    // Thay YOUR_OPENAI_API_KEY bằng API key từ tài khoản premium của bạn
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': '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'
        },
        body: JSON.stringify({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are an English writing tutor. Provide detailed feedback on the student's writing, focusing on grammar, vocabulary, coherence, and suggestions for improvement. Keep the feedback constructive and professional."
                },
                {
                    role: "user",
                    content: `Writing prompt: ${prompt}\n\nStudent's writing:\n${userText}\n\nPlease provide detailed feedback.`
                }
            ],
            temperature: 0.7
        })
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
}

function formatFeedback(feedbackText) {
    // Xử lý định dạng feedback nếu cần
    return `<p>${feedbackText.replace(/\n/g, '</p><p>')}</p>`;
}