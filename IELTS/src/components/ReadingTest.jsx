import React, { useState, useEffect, useRef } from 'react';
import { Clock, Flag, HelpCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';

function ReadingTest({ test, onFinish, onExit }) {
  const [timeRemaining, setTimeRemaining] = useState(test.timeLimit);
  const [currentSection, setCurrentSection] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState({});
  const [flagged, setFlagged] = useState(new Set());
  const [showReview, setShowReview] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const timerRef = useRef(null);

  const section = test.sections[currentSection];
  const totalQuestions = test.sections.reduce((sum, s) => sum + s.questions.length, 0);
  
  useEffect(() => {
    // Load saved state
    const savedState = localStorage.getItem(`test-progress-${test.testId}`);
    if (savedState) {
      const state = JSON.parse(savedState);
      setAnswers(state.answers || {});
      setFlagged(new Set(state.flagged || []));
      setTimeRemaining(state.timeRemaining || test.timeLimit);
    }

    // Start timer
    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          handleFinishTest();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Save state
    const state = {
      answers,
      flagged: Array.from(flagged),
      timeRemaining,
      currentSection,
      currentQuestion
    };
    localStorage.setItem(`test-progress-${test.testId}`, JSON.stringify(state));
  }, [answers, flagged, timeRemaining, currentSection, currentQuestion]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimerClass = () => {
    if (timeRemaining <= 60) return 'critical';
    if (timeRemaining <= 300) return 'warning';
    return '';
  };

  const handleAnswer = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const toggleFlag = (questionId) => {
    setFlagged(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
  };

  const jumpToQuestion = (sectionIdx, questionIdx) => {
    setCurrentSection(sectionIdx);
    setCurrentQuestion(questionIdx);
    setShowReview(false);
  };

  const handleNext = () => {
    if (currentQuestion < section.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else if (currentSection < test.sections.length - 1) {
      setCurrentSection(currentSection + 1);
      setCurrentQuestion(0);
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    } else if (currentSection > 0) {
      setCurrentSection(currentSection - 1);
      setCurrentQuestion(test.sections[currentSection - 1].questions.length - 1);
    }
  };

  const handleFinishTest = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    const result = {
      testId: test.testId,
      module: test.module,
      title: test.title,
      answers,
      timeSpent: test.timeLimit - timeRemaining,
      totalQuestions,
      completedAt: new Date().toISOString()
    };

    // Calculate score for reading
    let correctAnswers = 0;
    test.sections.forEach(section => {
      section.questions.forEach(q => {
        const userAnswer = answers[q.questionId];
        if (q.type === 'multiple-choice-multiple') {
          const correct = q.correctAnswers?.sort().join(',');
          const user = Array.isArray(userAnswer) ? userAnswer.sort().join(',') : '';
          if (correct === user) correctAnswers++;
        } else {
          const correct = q.correctAnswer?.toString().toLowerCase().trim();
          const user = userAnswer?.toString().toLowerCase().trim();
          if (correct === user) correctAnswers++;
        }
      });
    });

    result.correctAnswers = correctAnswers;
    result.score = ((correctAnswers / totalQuestions) * 100).toFixed(1);

    // Save result
    const results = JSON.parse(localStorage.getItem('test-results') || '[]');
    results.push(result);
    localStorage.setItem('test-results', JSON.stringify(results));
    localStorage.removeItem(`test-progress-${test.testId}`);

    onFinish(result);
  };

  const renderQuestion = (question) => {
    const answer = answers[question.questionId];

    switch (question.type) {
      case 'multiple-choice-single':
        return (
          <div className="options-list">
            {question.options.map((option, idx) => (
              <div
                key={idx}
                className={`option-item ${answer === option ? 'selected' : ''}`}
                onClick={() => handleAnswer(question.questionId, option)}
              >
                <div className="option-radio" />
                <div className="option-text">{option}</div>
              </div>
            ))}
          </div>
        );

      case 'multiple-choice-multiple':
        const selectedOptions = Array.isArray(answer) ? answer : [];
        return (
          <div className="options-list">
            {question.options.map((option, idx) => {
              const isSelected = selectedOptions.includes(option);
              return (
                <div
                  key={idx}
                  className={`option-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    const newSelection = isSelected
                      ? selectedOptions.filter(o => o !== option)
                      : [...selectedOptions, option];
                    handleAnswer(question.questionId, newSelection);
                  }}
                >
                  <div className="option-checkbox" />
                  <div className="option-text">{option}</div>
                </div>
              );
            })}
          </div>
        );

      case 'true-false-notgiven':
        return (
          <div className="options-list">
            {['TRUE', 'FALSE', 'NOT GIVEN'].map((option) => (
              <div
                key={option}
                className={`option-item ${answer === option ? 'selected' : ''}`}
                onClick={() => handleAnswer(question.questionId, option)}
              >
                <div className="option-radio" />
                <div className="option-text">{option}</div>
              </div>
            ))}
          </div>
        );

      case 'yes-no-notgiven':
        return (
          <div className="options-list">
            {['YES', 'NO', 'NOT GIVEN'].map((option) => (
              <div
                key={option}
                className={`option-item ${answer === option ? 'selected' : ''}`}
                onClick={() => handleAnswer(question.questionId, option)}
              >
                <div className="option-radio" />
                <div className="option-text">{option}</div>
              </div>
            ))}
          </div>
        );

      case 'sentence-completion':
      case 'short-answer':
        return (
          <input
            type="text"
            className="question-input"
            value={answer || ''}
            onChange={(e) => handleAnswer(question.questionId, e.target.value)}
            placeholder="Type your answer here"
            maxLength={question.maxWords ? question.maxWords * 10 : undefined}
          />
        );

      default:
        return <div>Question type not supported</div>;
    }
  };

  if (showReview) {
    const answeredCount = Object.keys(answers).length;
    const flaggedCount = flagged.size;

    return (
      <div>
        <div className="test-header">
          <div className="test-header-left">
            <div className="test-module-title">IELTS Reading - Review</div>
          </div>
          <div className="test-header-right">
            <div className={`timer-display ${getTimerClass()}`}>
              <Clock size={20} />
              {formatTime(timeRemaining)}
            </div>
            <button className="header-btn" onClick={() => setShowReview(false)}>
              Back to Test
            </button>
          </div>
        </div>

        <div className="review-screen">
          <div className="review-header">
            <h2 className="review-title">Review Your Answers</h2>
            <p className="review-subtitle">Check all questions before submitting</p>
          </div>

          <div className="review-stats">
            <div className="stat-card">
              <div className="stat-value">{answeredCount}/{totalQuestions}</div>
              <div className="stat-label">Answered</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{totalQuestions - answeredCount}</div>
              <div className="stat-label">Unanswered</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{flaggedCount}</div>
              <div className="stat-label">Flagged</div>
            </div>
          </div>

          <div className="review-questions">
            {test.sections.map((sec, sIdx) => (
              <div key={sIdx}>
                <h3 style={{ margin: '1.5rem 0 1rem', color: 'var(--bc-navy)' }}>
                  Section {sIdx + 1}: {sec.title}
                </h3>
                {sec.questions.map((q, qIdx) => {
                  const isAnswered = answers[q.questionId] !== undefined && answers[q.questionId] !== '';
                  const isFlagged = flagged.has(q.questionId);
                  
                  return (
                    <div
                      key={q.questionId}
                      className="review-question-item"
                      onClick={() => jumpToQuestion(sIdx, qIdx)}
                    >
                      <div className="review-question-info">
                        <div className="review-question-number">Q{q.questionId}</div>
                        <div className={`review-question-status ${isAnswered ? 'answered' : 'unanswered'}`}>
                          {isAnswered ? 'Answered' : 'Unanswered'}
                        </div>
                        {isFlagged && <span>🚩</span>}
                      </div>
                      <ChevronRight size={20} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'center' }}>
            <button className="btn btn-secondary" onClick={() => setShowReview(false)}>
              Continue Test
            </button>
            <button className="btn btn-primary" onClick={handleFinishTest}>
              Submit Test
            </button>
          </div>
        </div>
      </div>
    );
  }

  const question = section.questions[currentQuestion];
  const globalQuestionNumber = test.sections
    .slice(0, currentSection)
    .reduce((sum, s) => sum + s.questions.length, 0) + currentQuestion + 1;

  return (
    <div>
      <div className="test-header">
        <div className="test-header-left">
          <div className="test-module-title">IELTS Reading</div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.875rem' }}>
            Section {currentSection + 1} of {test.sections.length}
          </div>
        </div>
        <div className="test-header-right">
          <div className={`timer-display ${getTimerClass()}`}>
            <Clock size={20} />
            {formatTime(timeRemaining)}
          </div>
          <button className="header-btn" title="Help">
            <HelpCircle size={18} />
          </button>
          <button className="header-btn danger" onClick={() => setShowExitConfirm(true)}>
            <X size={18} />
            End Test
          </button>
        </div>
      </div>

      <div className="test-content">
        <div className="test-main">
          <div className="test-passage-panel">
            <div className="passage-container">
              <h2 className="passage-title">{section.title}</h2>
              <div className="passage-text" dangerouslySetInnerHTML={{ __html: section.passage.replace(/\n/g, '<p>') }} />
            </div>
          </div>

          <div className="test-questions-panel">
            <div className="question-block">
              <div className="question-header">
                <div className="question-label">Question {globalQuestionNumber}</div>
                <button
                  className={`flag-btn ${flagged.has(question.questionId) ? 'flagged' : ''}`}
                  onClick={() => toggleFlag(question.questionId)}
                  title="Flag question"
                >
                  <Flag size={20} />
                </button>
              </div>
              <div className="question-text">{question.text}</div>
              {question.maxWords && (
                <div style={{ fontSize: '0.875rem', color: 'var(--bc-text-secondary)', marginBottom: '0.75rem' }}>
                  (Write NO MORE THAN {question.maxWords} WORDS)
                </div>
              )}
              {renderQuestion(question)}
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button
                className="btn btn-secondary"
                onClick={handlePrevious}
                disabled={currentSection === 0 && currentQuestion === 0}
              >
                <ChevronLeft size={18} />
                Previous
              </button>
              <button
                className="btn btn-primary"
                onClick={handleNext}
                disabled={currentSection === test.sections.length - 1 && currentQuestion === section.questions.length - 1}
              >
                Next
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="test-navigation">
          <div className="nav-section">
            <div className="nav-section-title">Questions</div>
            <div className="question-grid">
              {Array.from({ length: totalQuestions }, (_, i) => {
                let qNum = i + 1;
                let sIdx = 0;
                let qIdx = i;
                
                for (let s = 0; s < test.sections.length; s++) {
                  if (qIdx < test.sections[s].questions.length) {
                    sIdx = s;
                    break;
                  }
                  qIdx -= test.sections[s].questions.length;
                }
                
                const q = test.sections[sIdx].questions[qIdx];
                const isAnswered = answers[q.questionId] !== undefined && answers[q.questionId] !== '';
                const isFlagged = flagged.has(q.questionId);
                const isActive = sIdx === currentSection && qIdx === currentQuestion;

                return (
                  <div
                    key={qNum}
                    className={`question-number ${isAnswered ? 'answered' : ''} ${isFlagged ? 'flagged' : ''} ${isActive ? 'active' : ''}`}
                    onClick={() => jumpToQuestion(sIdx, qIdx)}
                  >
                    {qNum}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="nav-actions">
            <button className="nav-btn nav-btn-primary" onClick={() => setShowReview(true)}>
              Review Answers
            </button>
            <button className="nav-btn nav-btn-secondary" onClick={handleFinishTest}>
              Finish Test
            </button>
          </div>
        </div>
      </div>

      {showExitConfirm && (
        <div className="modal-overlay" onClick={() => setShowExitConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Exit Test?</h2>
            <div className="modal-body">
              Are you sure you want to exit? Your progress will be lost.
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowExitConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={onExit}>
                Exit Test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReadingTest;
