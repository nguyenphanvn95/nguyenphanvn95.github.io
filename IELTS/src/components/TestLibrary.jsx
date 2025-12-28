import React, { useState, useEffect } from 'react';
import { BookOpen, Volume2, PenTool, Plus, Upload, Trash2, Play } from 'lucide-react';
import './TestLibrary.css';

function TestLibrary({ onStartTest }) {
  const [tests, setTests] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [filterModule, setFilterModule] = useState('all');

  useEffect(() => {
    loadTests();
  }, []);

  const loadTests = () => {
    const savedTests = localStorage.getItem('ielts-tests');
    if (savedTests) {
      setTests(JSON.parse(savedTests));
    } else {
      // Load sample tests
      const sampleTests = getSampleTests();
      setTests(sampleTests);
      localStorage.setItem('ielts-tests', JSON.stringify(sampleTests));
    }
  };

  const getSampleTests = () => {
    return [
      {
        testId: 'reading-sample-1',
        title: 'Academic Reading Test 1',
        module: 'reading',
        description: 'Practice test with 3 passages about technology, environment, and history',
        timeLimit: 3600,
        created: new Date().toISOString()
      },
      {
        testId: 'listening-sample-1',
        title: 'Listening Test 1',
        module: 'listening',
        description: 'Full listening test with 4 sections',
        timeLimit: 1800,
        created: new Date().toISOString()
      },
      {
        testId: 'writing-sample-1',
        title: 'Academic Writing Test 1',
        module: 'writing',
        description: 'Task 1: Graph description, Task 2: Opinion essay',
        timeLimit: 3600,
        created: new Date().toISOString()
      }
    ];
  };

  const handleImport = () => {
    try {
      const newTest = JSON.parse(importJson);
      
      // Validate test structure
      if (!newTest.testId || !newTest.module || !newTest.title) {
        alert('Invalid test format. Missing required fields: testId, module, or title');
        return;
      }

      const updatedTests = [...tests, { ...newTest, created: new Date().toISOString() }];
      setTests(updatedTests);
      localStorage.setItem('ielts-tests', JSON.stringify(updatedTests));
      
      setImportJson('');
      setShowImport(false);
      alert('Test imported successfully!');
    } catch (error) {
      alert('Invalid JSON format. Please check your input.');
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImportJson(e.target.result);
      };
      reader.readAsText(file);
    }
  };

  const deleteTest = (testId) => {
    if (confirm('Are you sure you want to delete this test?')) {
      const updatedTests = tests.filter(t => t.testId !== testId);
      setTests(updatedTests);
      localStorage.setItem('ielts-tests', JSON.stringify(updatedTests));
    }
  };

  const startTest = (testId) => {
    const test = tests.find(t => t.testId === testId);
    if (!test) {
      alert('Test not found');
      return;
    }

    // Load full test data
    const fullTestData = loadFullTestData(testId);
    if (!fullTestData) {
      alert('Test content not found. Please import the full test data.');
      return;
    }

    onStartTest(fullTestData);
  };

  const loadFullTestData = (testId) => {
    const testData = localStorage.getItem(`test-${testId}`);
    if (testData) {
      return JSON.parse(testData);
    }
    
    // If not found, load sample data
    if (testId.startsWith('reading-sample')) {
      return getSampleReadingTest();
    } else if (testId.startsWith('listening-sample')) {
      return getSampleListeningTest();
    } else if (testId.startsWith('writing-sample')) {
      return getSampleWritingTest();
    }
    
    return null;
  };

  const getSampleReadingTest = () => {
    return {
      testId: 'reading-sample-1',
      title: 'Academic Reading Test 1',
      module: 'reading',
      timeLimit: 3600,
      sections: [
        {
          sectionId: 1,
          title: 'The Impact of Artificial Intelligence on Modern Society',
          passage: `Artificial Intelligence (AI) has become one of the most transformative technologies of the 21st century. From healthcare to transportation, AI systems are revolutionizing how we live and work. Machine learning algorithms can now diagnose diseases with accuracy comparable to experienced doctors, while autonomous vehicles promise to reshape urban transportation.

The economic implications of AI are profound. According to recent studies, AI could contribute up to $15.7 trillion to the global economy by 2030. However, this technological revolution also raises important questions about employment. While AI creates new job opportunities in fields like data science and AI ethics, it also threatens to automate millions of existing jobs, particularly in manufacturing and administrative roles.

Privacy concerns represent another significant challenge. AI systems often require vast amounts of personal data to function effectively. This has led to debates about data protection, surveillance, and the balance between technological innovation and individual privacy rights. Governments worldwide are grappling with how to regulate AI while fostering innovation.

Despite these challenges, proponents argue that AI's potential benefits far outweigh the risks. AI could help address global challenges such as climate change through better energy management and resource allocation. In education, AI-powered personalized learning systems could revolutionize how students learn, adapting to individual needs and learning styles.`,
          questions: [
            {
              questionId: 1,
              type: 'multiple-choice-single',
              text: 'According to the passage, what is the potential economic contribution of AI by 2030?',
              options: [
                'Up to $10 trillion',
                'Up to $15.7 trillion',
                'Up to $20 trillion',
                'Up to $25 trillion'
              ],
              correctAnswer: 'Up to $15.7 trillion'
            },
            {
              questionId: 2,
              type: 'true-false-notgiven',
              text: 'AI systems can diagnose diseases more accurately than human doctors.',
              correctAnswer: 'NOT GIVEN'
            },
            {
              questionId: 3,
              type: 'true-false-notgiven',
              text: 'AI will create more jobs than it eliminates.',
              correctAnswer: 'NOT GIVEN'
            },
            {
              questionId: 4,
              type: 'multiple-choice-single',
              text: 'Which sector is mentioned as being threatened by AI automation?',
              options: [
                'Healthcare',
                'Manufacturing',
                'Education',
                'Transportation'
              ],
              correctAnswer: 'Manufacturing'
            },
            {
              questionId: 5,
              type: 'sentence-completion',
              text: 'AI could help address global challenges such as _____ through better energy management.',
              correctAnswer: 'climate change'
            },
            {
              questionId: 6,
              type: 'multiple-choice-multiple',
              text: 'According to the passage, which TWO areas are mentioned as being impacted by AI?',
              options: [
                'Healthcare',
                'Agriculture',
                'Transportation',
                'Construction'
              ],
              correctAnswers: ['Healthcare', 'Transportation']
            },
            {
              questionId: 7,
              type: 'true-false-notgiven',
              text: 'Governments have successfully regulated AI without hindering innovation.',
              correctAnswer: 'NOT GIVEN'
            },
            {
              questionId: 8,
              type: 'short-answer',
              text: 'What two new job fields are mentioned in relation to AI?',
              correctAnswer: 'data science and AI ethics',
              maxWords: 6
            },
            {
              questionId: 9,
              type: 'true-false-notgiven',
              text: 'Privacy concerns arise because AI systems need large amounts of personal data.',
              correctAnswer: 'TRUE'
            },
            {
              questionId: 10,
              type: 'sentence-completion',
              text: 'In education, AI-powered systems could adapt to individual needs and _____.',
              correctAnswer: 'learning styles'
            }
          ]
        }
      ]
    };
  };

  const getSampleListeningTest = () => {
    return {
      testId: 'listening-sample-1',
      title: 'Listening Test 1',
      module: 'listening',
      timeLimit: 1800,
      sections: [
        {
          sectionId: 1,
          title: 'Section 1 - Conversation',
          audioUrl: null,
          audioNote: 'Please upload your audio file or provide audio URL',
          questions: [
            {
              questionId: 1,
              type: 'sentence-completion',
              text: 'The customer wants to book a table for _____ people.',
              correctAnswer: '4'
            },
            {
              questionId: 2,
              type: 'multiple-choice-single',
              text: 'What time does the customer want to book?',
              options: [
                '7:00 PM',
                '7:30 PM',
                '8:00 PM',
                '8:30 PM'
              ],
              correctAnswer: '7:30 PM'
            },
            {
              questionId: 3,
              type: 'sentence-completion',
              text: 'The customer\'s name is _____.',
              correctAnswer: 'Smith'
            },
            {
              questionId: 4,
              type: 'sentence-completion',
              text: 'The contact number is _____.',
              correctAnswer: '555-1234'
            },
            {
              questionId: 5,
              type: 'multiple-choice-single',
              text: 'What special requirement does the customer have?',
              options: [
                'Window seat',
                'Quiet area',
                'High chair',
                'Vegetarian menu'
              ],
              correctAnswer: 'Window seat'
            },
            {
              questionId: 6,
              type: 'sentence-completion',
              text: 'The booking reference number is _____.',
              correctAnswer: 'BR-2024-1234'
            },
            {
              questionId: 7,
              type: 'multiple-choice-single',
              text: 'How will the customer receive confirmation?',
              options: [
                'By email',
                'By phone',
                'By text message',
                'In person'
              ],
              correctAnswer: 'By email'
            },
            {
              questionId: 8,
              type: 'sentence-completion',
              text: 'The restaurant is located on _____ Street.',
              correctAnswer: 'Main'
            },
            {
              questionId: 9,
              type: 'short-answer',
              text: 'What is the cancellation policy? (No more than 3 words)',
              correctAnswer: '24 hours notice',
              maxWords: 3
            },
            {
              questionId: 10,
              type: 'multiple-choice-single',
              text: 'What does the restaurant offer for birthdays?',
              options: [
                'Free dessert',
                'Discount',
                'Free drink',
                'Birthday song'
              ],
              correctAnswer: 'Free dessert'
            }
          ]
        }
      ]
    };
  };

  const getSampleWritingTest = () => {
    return {
      testId: 'writing-sample-1',
      title: 'Academic Writing Test 1',
      module: 'writing',
      timeLimit: 3600,
      tasks: [
        {
          taskId: 1,
          title: 'Writing Task 1',
          type: 'graph-description',
          minWords: 150,
          instruction: 'The graph below shows the percentage of people using different social media platforms in 2020 and 2024. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.',
          prompt: `You should spend about 20 minutes on this task.

The bar chart compares the usage percentages of four major social media platforms (Facebook, Instagram, Twitter, and TikTok) between 2020 and 2024.

Write at least 150 words.`
        },
        {
          taskId: 2,
          title: 'Writing Task 2',
          type: 'opinion-essay',
          minWords: 250,
          instruction: 'Write about the following topic:',
          prompt: `Some people believe that technology has made our lives more complicated, while others think it has made life easier. 

Discuss both views and give your own opinion.

Give reasons for your answer and include any relevant examples from your own knowledge or experience.

Write at least 250 words.

You should spend about 40 minutes on this task.`
        }
      ]
    };
  };

  const filteredTests = filterModule === 'all' 
    ? tests 
    : tests.filter(t => t.module === filterModule);

  const getModuleIcon = (module) => {
    switch(module) {
      case 'reading': return <BookOpen size={24} />;
      case 'listening': return <Volume2 size={24} />;
      case 'writing': return <PenTool size={24} />;
      default: return null;
    }
  };

  const getModuleColor = (module) => {
    switch(module) {
      case 'reading': return '#0066B3';
      case 'listening': return '#008A00';
      case 'writing': return '#D32F2F';
      default: return '#666';
    }
  };

  return (
    <div className="library-container">
      <div className="library-header">
        <div>
          <h1 className="library-title">IELTS Practice Tests</h1>
          <p className="library-subtitle">Practice with authentic test formats</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowImport(true)}>
          <Plus size={20} />
          Import Test
        </button>
      </div>

      <div className="library-filters">
        <button 
          className={`filter-btn ${filterModule === 'all' ? 'active' : ''}`}
          onClick={() => setFilterModule('all')}
        >
          All Tests
        </button>
        <button 
          className={`filter-btn ${filterModule === 'reading' ? 'active' : ''}`}
          onClick={() => setFilterModule('reading')}
        >
          <BookOpen size={18} />
          Reading
        </button>
        <button 
          className={`filter-btn ${filterModule === 'listening' ? 'active' : ''}`}
          onClick={() => setFilterModule('listening')}
        >
          <Volume2 size={18} />
          Listening
        </button>
        <button 
          className={`filter-btn ${filterModule === 'writing' ? 'active' : ''}`}
          onClick={() => setFilterModule('writing')}
        >
          <PenTool size={18} />
          Writing
        </button>
      </div>

      <div className="tests-grid">
        {filteredTests.map(test => (
          <div key={test.testId} className="test-card">
            <div className="test-card-header" style={{ borderLeftColor: getModuleColor(test.module) }}>
              <div className="test-icon" style={{ background: getModuleColor(test.module) }}>
                {getModuleIcon(test.module)}
              </div>
              <div className="test-info">
                <h3 className="test-title">{test.title}</h3>
                <p className="test-description">{test.description}</p>
                <div className="test-meta">
                  <span className="test-module-badge" style={{ background: `${getModuleColor(test.module)}20`, color: getModuleColor(test.module) }}>
                    {test.module.toUpperCase()}
                  </span>
                  <span className="test-time">{Math.floor(test.timeLimit / 60)} minutes</span>
                </div>
              </div>
            </div>
            <div className="test-card-actions">
              <button 
                className="btn btn-primary"
                onClick={() => startTest(test.testId)}
              >
                <Play size={18} />
                Start Test
              </button>
              <button 
                className="btn-icon-danger"
                onClick={() => deleteTest(test.testId)}
                title="Delete test"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Import Test</h2>
            <div className="modal-body">
              <div className="import-section">
                <label className="import-label">
                  Upload JSON File:
                  <input 
                    type="file" 
                    accept=".json"
                    onChange={handleFileUpload}
                    className="file-input"
                  />
                </label>
              </div>
              <div className="import-divider">OR</div>
              <div className="import-section">
                <label className="import-label">Paste JSON:</label>
                <textarea
                  className="import-textarea"
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  placeholder='{"testId": "...", "module": "reading", "title": "...", ...}'
                  rows={10}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowImport(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleImport}>
                <Upload size={18} />
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TestLibrary;
