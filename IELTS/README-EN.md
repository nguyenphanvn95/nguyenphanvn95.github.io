# IELTS Practice App

A comprehensive IELTS practice application with an authentic British Council-style interface for practicing Reading, Listening, and Writing modules.

## 🎯 Features

### Core Functionality
- ✅ **Authentic BC-style Interface** - Clean, professional design matching real IELTS computer-based tests
- ✅ **Three Test Modules** - Reading, Listening, and Writing with full support
- ✅ **Timer System** - Accurate countdown with visual warnings (10 min, 5 min, 1 min)
- ✅ **Question Types Support**:
  - Multiple choice (single/multiple)
  - True/False/Not Given
  - Yes/No/Not Given
  - Sentence completion
  - Short answer
  - Matching (basic)
- ✅ **Navigation Panel** - Visual question map with answered/unanswered/flagged status
- ✅ **Review Screen** - Check all answers before submission
- ✅ **Progress Auto-Save** - Resume test after browser refresh
- ✅ **Automatic Scoring** - For Reading and Listening with band score estimation
- ✅ **Test Library** - Import, manage, and organize tests
- ✅ **Export Results** - Download results as JSON files

### Special Features
- **Flag Questions** - Mark questions for review
- **Word Counter** - Real-time word count for Writing tasks
- **Audio Player** - Built-in player for Listening tests (supports local audio files)
- **Responsive Design** - Works on desktop and tablets
- **Offline Support** - Runs completely offline with local storage

## 📁 Project Structure

```
ielts-practice-app/
├── src/
│   ├── components/
│   │   ├── TestLibrary.jsx        # Test management and import
│   │   ├── TestLibrary.css
│   │   ├── ReadingTest.jsx        # Reading module interface
│   │   ├── ListeningTest.jsx      # Listening module interface
│   │   ├── WritingTest.jsx        # Writing module interface
│   │   └── TestResults.jsx        # Results and scoring
│   ├── App.jsx                    # Main app component
│   ├── App.css                    # Global styles
│   └── main.jsx                   # React entry point
├── data/
│   ├── tests/                     # Test JSON files
│   │   ├── reading-advanced-1.json
│   │   └── listening-general-1.json
│   └── results/                   # Exported results (created automatically)
├── public/                        # Static assets
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## 🚀 Getting Started

### Prerequisites
- Node.js (version 16 or higher)
- npm or yarn

### Installation

1. **Install Dependencies**
```bash
cd ielts-practice-app
npm install
```

2. **Start Development Server**
```bash
npm run dev
```

The application will open automatically at `http://localhost:3000`

### Building for Production

```bash
npm run build
npm run preview
```

## 📝 Test JSON Structure

### Reading Test Format

```json
{
  "testId": "unique-test-id",
  "title": "Test Title",
  "module": "reading",
  "description": "Test description",
  "timeLimit": 3600,
  "sections": [
    {
      "sectionId": 1,
      "title": "Section Title",
      "passage": "Full passage text...",
      "questions": [
        {
          "questionId": 1,
          "type": "multiple-choice-single",
          "text": "Question text",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": "Option A"
        },
        {
          "questionId": 2,
          "type": "true-false-notgiven",
          "text": "Statement to evaluate",
          "correctAnswer": "TRUE"
        },
        {
          "questionId": 3,
          "type": "sentence-completion",
          "text": "Complete: The answer is _____",
          "correctAnswer": "example answer",
          "maxWords": 2
        }
      ]
    }
  ]
}
```

### Listening Test Format

```json
{
  "testId": "unique-test-id",
  "title": "Test Title",
  "module": "listening",
  "timeLimit": 1800,
  "sections": [
    {
      "sectionId": 1,
      "title": "Section 1 - Conversation",
      "audioUrl": "/audio/section1.mp3",
      "audioNote": "Optional note about audio",
      "questions": [
        {
          "questionId": 1,
          "type": "sentence-completion",
          "text": "The answer is _____",
          "correctAnswer": "example"
        }
      ]
    }
  ]
}
```

### Writing Test Format

```json
{
  "testId": "unique-test-id",
  "title": "Test Title",
  "module": "writing",
  "timeLimit": 3600,
  "tasks": [
    {
      "taskId": 1,
      "title": "Writing Task 1",
      "type": "graph-description",
      "minWords": 150,
      "instruction": "Task instruction",
      "prompt": "Full task prompt..."
    },
    {
      "taskId": 2,
      "title": "Writing Task 2",
      "type": "opinion-essay",
      "minWords": 250,
      "instruction": "Task instruction",
      "prompt": "Full task prompt..."
    }
  ]
}
```

## 📥 Importing Tests

### Method 1: Upload JSON File
1. Click "Import Test" button in the Test Library
2. Choose "Upload JSON File"
3. Select your `.json` file
4. Click "Import"

### Method 2: Paste JSON
1. Click "Import Test" button
2. Paste your JSON data in the textarea
3. Click "Import"

### Method 3: Manual Storage
Save test files directly to localStorage with key `test-{testId}`:

```javascript
const testData = { /* your test object */ };
localStorage.setItem('test-reading-sample-1', JSON.stringify(testData));
```

## 🎯 Question Types Reference

### 1. Multiple Choice Single
```json
{
  "type": "multiple-choice-single",
  "text": "Question text",
  "options": ["A", "B", "C", "D"],
  "correctAnswer": "B"
}
```

### 2. Multiple Choice Multiple
```json
{
  "type": "multiple-choice-multiple",
  "text": "Choose TWO answers",
  "options": ["A", "B", "C", "D"],
  "correctAnswers": ["B", "D"]
}
```

### 3. True/False/Not Given
```json
{
  "type": "true-false-notgiven",
  "text": "Statement",
  "correctAnswer": "TRUE"
}
```

### 4. Sentence Completion
```json
{
  "type": "sentence-completion",
  "text": "The answer is _____",
  "correctAnswer": "correct answer",
  "maxWords": 2
}
```

### 5. Short Answer
```json
{
  "type": "short-answer",
  "text": "What is...?",
  "correctAnswer": "answer",
  "maxWords": 3
}
```

## 💾 Data Storage

### Tests
- Stored in `localStorage` with key `ielts-tests`
- Full test content stored separately as `test-{testId}`

### Results
- Stored in `localStorage` with key `test-results`
- Can be exported as JSON files

### Progress
- Auto-saved during test with key `test-progress-{testId}`
- Cleared upon test completion

## 🎨 Customization

### Colors (in App.css)
```css
--bc-navy: #003E74;
--bc-blue: #0066B3;
--bc-green: #008A00;
--bc-red: #D32F2F;
```

### Time Limits
- Reading: 3600 seconds (60 minutes)
- Listening: 1800 seconds (30 minutes)
- Writing: 3600 seconds (60 minutes)

Modify in test JSON `timeLimit` property.

## 📊 Band Score Calculation

The app estimates band scores based on percentage of correct answers:
- 95%+ = Band 9.0
- 90-94% = Band 8.5
- 85-89% = Band 8.0
- 80-84% = Band 7.5
- 75-79% = Band 7.0
- 70-74% = Band 6.5
- 65-69% = Band 6.0
- 60-64% = Band 5.5

Note: This is a simplified estimation. Actual IELTS scoring is more complex.

## 🎧 Audio Files for Listening

1. Place audio files in `/public/audio/` folder
2. Reference in test JSON:
```json
"audioUrl": "/audio/section1.mp3"
```

Supported formats: MP3, WAV, OGG

## 🔧 Troubleshooting

### Tests not loading
- Check localStorage is enabled
- Verify JSON format is correct
- Check browser console for errors

### Timer not working
- Ensure browser tab is active
- Check if timer was accidentally stopped

### Audio not playing
- Verify audio file path is correct
- Check audio file format is supported
- Ensure audio file is in `/public/audio/`

### Progress not saving
- Check localStorage quota (usually 5-10MB)
- Clear old test progress if needed

## 🌐 Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari
- Opera

Requires JavaScript enabled and localStorage support.

## 📱 Mobile Support

While primarily designed for desktop (matching real IELTS computer tests), the app includes responsive breakpoints for tablets. Phone use is not recommended for authentic practice.

## 🔐 Privacy

- All data stored locally in browser
- No server communication
- No tracking or analytics
- Export/delete data anytime

## 📄 License

MIT License - Free for personal and educational use

## 🤝 Contributing

To add new question types or features:

1. Update question rendering in test components
2. Add scoring logic if needed
3. Update JSON schema documentation
4. Test thoroughly

## 📞 Support

For issues or questions:
- Check this README first
- Review sample JSON files
- Check browser console for errors
- Verify test JSON structure

## 🎓 Tips for Best Practice

1. **Take tests in a quiet environment**
2. **Use full-screen mode** for authentic experience
3. **Time yourself strictly** - don't pause the timer
4. **Review flagged questions** before submitting
5. **Export results** for tracking progress
6. **Practice regularly** with varied test types

## 🚀 Future Enhancements

Potential features for future versions:
- Speaking module (with audio recording)
- More question types (diagram labeling, map completion)
- Score history and analytics
- Cloud sync for test bank
- Mobile app version
- AI-powered Writing feedback

---

**Happy Practicing! Good luck with your IELTS preparation! 🎯**
