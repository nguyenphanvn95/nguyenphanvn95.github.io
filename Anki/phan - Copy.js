// ===========================================================
// ⚡️ PHẦN 1: KHỞI CHẠY CHÍNH VÀ GIỚI HẠN LƯỢT DÙNG
// ===========================================================

(async () => {
  const config = {
    devMode: true,
    enableChatbot: true,
  };

  const platform = detectPlatform();
  let markdownConverter;
  const now = Date.now();
  const storageKey = "anki_run_timestamps";

  let timestamps = JSON.parse(localStorage.getItem(storageKey) || "[]").filter(t => now - t <= 1000);
  timestamps.push(now);
  localStorage.setItem(storageKey, JSON.stringify(timestamps));
  await sleep(100);

  const updated = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (now !== updated[updated.length - 1]) return;

  const isPycmdAvailable = await (async () => {
    try {
      pycmd("check");
      return true;
    } catch {
      return false;
    }
  })();

  // Tính toán giới hạn lượt dùng trong ngày
  const todayKey = new Date().toISOString().split('T')[0];
  let usageData = JSON.parse(localStorage.getItem("anki_daily_usage") || "{}");
  usageData[todayKey] = (usageData[todayKey] || 0) + 1;
  localStorage.setItem("anki_daily_usage", JSON.stringify(usageData));

  if (usageData[todayKey] > 50) {
    alert("⚠️ Bạn đã vượt quá 50 lượt dùng trong ngày!");
    return;
  }

  await loadDependencies();
  await initAfterLoad(platform, config, isPycmdAvailable);
  localStorage.setItem("anki_last_run", now.toString());
})();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function detectPlatform() {
  if (window.anki && window.webkit && window.anki.getCollection && window.anki.getCollection.cb !== undefined) {
    return "AnkiDesktop";
  } else if (document.querySelector('#mobile')?.innerHTML.includes("AnkiWeb")) {
    return "AnkiWeb";
  } else if (typeof AnkiDroidJS !== 'undefined') {
    return "AnkiDroid";
  } else if (typeof pycmd !== 'undefined') {
    return "AnkiDesktopLegacy";
  } else {
    return "Unknown";
  }
}

async function loadDependencies() {
  await Promise.all([
    loadScript("https://cdn.jsdelivr.net/npm/showdown@2.1.0/dist/showdown.min.js", "Showdown")
  ]);
}

function loadScript(url, name) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject();
    document.head.appendChild(script);
  });
}

async function initAfterLoad(platform, config, isPycmdAvailable) {
  try {
    markdownConverter = new showdown.Converter();
    if (isPycmdAvailable && platform === "AnkiDesktop") pycmd("anki:loaded");

    await prepareCard(config);
    await handleBackSide(config);
    await handleButtons();
    await handleAudio();
    if (config.enableChatbot) await initChatbot();
    await restoreFlashcardState(config);
    await initEnhancedStyles(platform, config);
  } catch (error) {
    showErrorMessage(error);
  }
}

async function prepareCard(config) {
  const container = document.getElementById("container");
  const prompt = document.getElementById("prompt");
  if (!container || !prompt) return;

  const wrapper = document.createElement("div");
  wrapper.className = "flashcard";
  const blocks = container.getElementsByClassName("card-content");
  const audios = container.getElementsByTagName("audio");

  if (blocks.length > 0) {
    for (let block of blocks) wrapper.appendChild(block);
  } else {
    for (let audio of audios) wrapper.appendChild(audio);
  }

  if (config.devMode && markdownConverter) {
    const raw = wrapper.textContent || "";
    wrapper.innerHTML = markdownConverter.makeHtml(raw);
  }

  prompt.innerHTML = "";
  prompt.appendChild(wrapper);
}

async function handleBackSide(config) {
  const back = document.getElementById("back");
  if (!back || !markdownConverter) return;

  if (config.devMode) {
    const raw = back.innerText || "";
    back.innerHTML = markdownConverter.makeHtml(raw);
  }
}

async function handleButtons() {
  const btn = document.querySelector(".show-answer-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const back = document.getElementById("back");
    if (back) back.classList.remove("hidden");
  });
}

async function handleAudio() {
  const audio = document.querySelector("audio");
  if (audio) {
    try {
      await audio.play();
    } catch (err) {
      console.warn("Audio error:", err);
    }
  }
}

async function initChatbot() {
  const chatContainer = document.createElement("div");
  chatContainer.id = "chatbot-container";
  document.getElementById("prompt").appendChild(chatContainer);

  if (typeof window.ChatbotUI !== "undefined") {
    await ChatbotUI.init({
      element: chatContainer,
      welcome: "Chào bạn! Tôi có thể giúp gì về thẻ này?",
    });
  }
}

async function restoreFlashcardState(config) {
  const backSideElements = document.getElementsByClassName("back-side");
  if (backSideElements.length === 1) {
    const savedMessages = JSON.parse(localStorage.getItem("ai-messages") || "[]");
    const filtered = extractSavedConversation(savedMessages);

    const fullMessages = [];
    for (let msg of filtered) {
      const cleaned = msg.content.replace(/<br>/g, "
").trim();
      if (msg.role === "AI") {
        const bubble = ChatbotUI.bot(cleaned);
        await displayMessage(bubble);
        fullMessages.push({ role: "assistant", content: cleaned });
      } else {
        const bubble = ChatbotUI.user(cleaned);
        await displayMessage(bubble);
        fullMessages.push({ role: "user", content: cleaned });
      }
    }

    // Gọi GPT tiếp tục nếu cần
    if (fullMessages.length > 0) {
      const reply = await callGPT(fullMessages);
      const bubble = ChatbotUI.bot(reply);
      await displayMessage(bubble);
    }
  } else {
    const back = document.getElementById("back");
    if (back && config.devMode) {
      localStorage.setItem("back", JSON.stringify(back.innerHTML));
    }
  }
}

function extractSavedConversation(messages) {
  let found = false, result = [];
  for (let msg of messages) {
    if (msg.role === "👍") {
      found = true;
      continue;
    }
    if (found) {
      result.push({
        role: msg.role,
        content: msg.content
      });
    }
  }
  return result;
}

async function callGPT(messages) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer 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"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: messages
      })
    });
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (err) {
    console.error("GPT Error:", err);
    return "Tôi không thể trả lời lúc này.";
  }
}

async function displayMessage(element) {
  if (!element) return;
  document.getElementById("chatbot-container").appendChild(element);
  await sleep(100);
}

async function initEnhancedStyles(platform, config) {
  const container = document.getElementById("container");
  if (!container) return;

  if (platform === "AnkiDesktop") {
    container.innerHTML = container.innerHTML
      .replace(/<textarea[^>]*>/g, "<div contenteditable='true'>")
      .replace(/<\/textarea>/g, "</div>");
  }

  if (config.devMode) {
    const style = document.createElement("style");
    style.innerHTML = `
      .chatbot-container {
        border-radius: 10px;
        overflow: hidden;
        width: 100%;
        max-width: 800px;
        margin: auto;
      }
      .flashcard {
        margin: 1rem auto;
        padding: 1rem;
        background: white;
        border: 1px solid #ccc;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      @media (max-width: 768px) {
        .chatbot-container, .flashcard {
          width: 95%;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

function showErrorMessage(error) {
  const box = document.createElement("div");
  box.innerText = "Lỗi: " + error.message;
  box.style.color = "red";
  box.style.padding = "10px";
  document.body.appendChild(box);
}


// ===========================================================
// 📚 PHẦN 8: XỬ LÝ CÂU HỎI QUIZ (DẠNG TRẮC NGHIỆM)
// ===========================================================

function renderMultipleChoiceQuestion(container, questionData) {
  const question = document.createElement("div");
  question.className = "quiz-question";
  question.innerText = questionData.question;

  const choices = document.createElement("div");
  choices.className = "quiz-choices";

  questionData.choices.forEach((choice, index) => {
    const btn = document.createElement("button");
    btn.className = "quiz-choice-btn";
    btn.innerText = choice;
    btn.onclick = () => {
      const isCorrect = index === questionData.answer;
      btn.style.backgroundColor = isCorrect ? "lightgreen" : "salmon";
      if (!isCorrect) {
        const correctBtn = choices.children[questionData.answer];
        correctBtn.style.backgroundColor = "lightgreen";
      }
    };
    choices.appendChild(btn);
  });

  container.appendChild(question);
  container.appendChild(choices);
}

// Dữ liệu mẫu quiz
const sampleQuiz = {
  question: "What is the capital of France?",
  choices: ["Berlin", "Madrid", "Paris", "Rome"],
  answer: 2
};

// Nếu có container quiz, render quiz vào
const quizContainer = document.getElementById("quiz-container");
if (quizContainer) {
  renderMultipleChoiceQuestion(quizContainer, sampleQuiz);
}


// ===========================================================
// 📦 PHẦN 9: XỬ LÝ MARKDOWN NÂNG CAO
// ===========================================================

function convertMarkdownToHTML(markdownText) {
  if (!markdownConverter) return markdownText;
  return markdownConverter.makeHtml(markdownText);
}

// Gọi ví dụ
// const raw = "**bold** _italic_";
// const html = convertMarkdownToHTML(raw);


// ===========================================================
// 🔍 PHẦN 10: LOG HỆ THỐNG, pycmd, GỬI DỮ LIỆU RA NGOÀI
// ===========================================================

function logEventToConsole(message) {
  if (typeof console !== "undefined") {
    console.log("📝 LOG:", message);
  }
}

function notifyAnki(message) {
  if (typeof pycmd !== "undefined") {
    pycmd(`notify:${message}`);
  }
}


// ===========================================================
// 🧠 PHẦN 11: XỬ LÝ CHATBOT MỞ RỘNG (CHATBOTUI HANDLER)
// ===========================================================

const ChatbotUI = {
  init: async ({ element, welcome }) => {
    const msg = document.createElement("div");
    msg.className = "chatbot-welcome";
    msg.innerText = welcome;
    element.appendChild(msg);
  },
  user: (text) => {
    const div = document.createElement("div");
    div.className = "chat-user";
    div.innerText = text;
    return div;
  },
  bot: (text) => {
    const div = document.createElement("div");
    div.className = "chat-bot";
    div.innerText = text;
    return div;
  }
};

// ====== KẾT THÚC FILE ======
