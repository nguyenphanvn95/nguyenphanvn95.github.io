import React, { useState, useEffect, useRef } from 'react';
import { Clock, HelpCircle, X, FileText } from 'lucide-react';

function WritingTest({ test, onFinish, onExit }) {
  const [timeRemaining, setTimeRemaining] = useState(test.timeLimit);
  const [currentTask, setCurrentTask] = useState(0);
  const [essays, setEssays] = useState({});
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const timerRef = useRef(null);

  const task = test.tasks[currentTask];

  useEffect(() => {
    const savedState = localStorage.getItem(`test-progress-${test.testId}`);
    if (savedState) {
      const state = JSON.parse(savedState);
      setEssays(state.essays || {});
      setTimeRemaining(state.timeRemaining || test.timeLimit);
    }

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
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const state = {
      essays,
      timeRemaining,
      currentTask
    };
    localStorage.setItem(`test-progress-${test.testId}`, JSON.stringify(state));
  }, [essays, timeRemaining, currentTask]);

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

  const handleEssayChange = (taskId, text) => {
    setEssays(prev => ({
      ...prev,
      [taskId]: text
    }));
  };

  const countWords = (text) => {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  };

  const handleFinishTest = () => {
    if (timerRef.current) clearInterval(timerRef.current);

    const result = {
      testId: test.testId,
      module: test.module,
      title: test.title,
      essays,
      timeSpent: test.timeLimit - timeRemaining,
      completedAt: new Date().toISOString(),
      wordCounts: {}
    };

    test.tasks.forEach(task => {
      result.wordCounts[task.taskId] = countWords(essays[task.taskId] || '');
    });

    const results = JSON.parse(localStorage.getItem('test-results') || '[]');
    results.push(result);
    localStorage.setItem('test-results', JSON.stringify(results));
    localStorage.removeItem(`test-progress-${test.testId}`);

    onFinish(result);
  };

  const essay = essays[task.taskId] || '';
  const wordCount = countWords(essay);
  const isUnderMinimum = wordCount < task.minWords;

  return (
    <div>
      <div className="test-header">
        <div className="test-header-left">
          <div className="test-module-title">IELTS Writing</div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.875rem' }}>
            {task.title}
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
        <div className="test-main" style={{ display: 'block' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
            {/* Task Tabs */}
            <div style={{ 
              display: 'flex', 
              gap: '1rem', 
              marginBottom: '2rem',
              borderBottom: '2px solid var(--bc-border)'
            }}>
              {test.tasks.map((t, idx) => (
                <button
                  key={t.taskId}
                  onClick={() => setCurrentTask(idx)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: currentTask === idx ? 'var(--bc-navy)' : 'transparent',
                    color: currentTask === idx ? 'white' : 'var(--bc-text)',
                    border: 'none',
                    borderBottom: currentTask === idx ? '3px solid var(--bc-navy)' : '3px solid transparent',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginBottom: '-2px',
                    transition: 'all 0.2s',
                    borderRadius: '4px 4px 0 0'
                  }}
                >
                  {t.title}
                </button>
              ))}
            </div>

            {/* Task Instructions */}
            <div style={{ 
              background: 'var(--bc-light-blue)', 
              padding: '1.5rem', 
              borderRadius: '8px',
              marginBottom: '1.5rem',
              border: '2px solid var(--bc-blue)'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'flex-start', 
                gap: '1rem',
                marginBottom: '1rem'
              }}>
                <FileText size={24} color="var(--bc-blue)" />
                <div>
                  <h3 style={{ 
                    color: 'var(--bc-navy)', 
                    fontWeight: 600,
                    marginBottom: '0.5rem'
                  }}>
                    {task.instruction}
                  </h3>
                  <div style={{ 
                    fontSize: '0.875rem', 
                    color: 'var(--bc-text-secondary)',
                    marginBottom: '0.5rem'
                  }}>
                    Minimum words: {task.minWords} | Type: {task.type}
                  </div>
                </div>
              </div>
              <div style={{ 
                whiteSpace: 'pre-wrap',
                lineHeight: 1.7,
                color: 'var(--bc-text)',
                background: 'white',
                padding: '1rem',
                borderRadius: '6px'
              }}>
                {task.prompt}
              </div>
            </div>

            {/* Word Count */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem'
            }}>
              <div style={{ 
                fontSize: '0.875rem',
                color: 'var(--bc-text-secondary)'
              }}>
                Your response:
              </div>
              <div style={{ 
                fontSize: '1rem',
                fontWeight: 600,
                color: isUnderMinimum ? 'var(--bc-orange)' : 'var(--bc-green)'
              }}>
                {wordCount} {isUnderMinimum ? `/ ${task.minWords}` : ''} words
                {isUnderMinimum && (
                  <span style={{ 
                    fontSize: '0.875rem', 
                    marginLeft: '0.5rem',
                    color: 'var(--bc-orange)'
                  }}>
                    (Minimum not reached)
                  </span>
                )}
              </div>
            </div>

            {/* Text Editor */}
            <textarea
              value={essay}
              onChange={(e) => handleEssayChange(task.taskId, e.target.value)}
              placeholder="Type your essay here..."
              style={{
                width: '100%',
                minHeight: '500px',
                padding: '1.5rem',
                border: '2px solid var(--bc-border)',
                borderRadius: '8px',
                fontSize: '1rem',
                fontFamily: 'var(--font-primary)',
                lineHeight: 1.8,
                resize: 'vertical',
                background: 'var(--bc-white)',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--bc-blue)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--bc-border)'}
            />

            {/* Action Buttons */}
            <div style={{ 
              display: 'flex', 
              gap: '1rem', 
              marginTop: '2rem',
              justifyContent: 'center'
            }}>
              {currentTask < test.tasks.length - 1 ? (
                <button 
                  className="btn btn-primary"
                  onClick={() => setCurrentTask(currentTask + 1)}
                >
                  Next Task
                </button>
              ) : (
                <button 
                  className="btn btn-primary"
                  onClick={handleFinishTest}
                >
                  Finish Test
                </button>
              )}
            </div>

            {/* Tips */}
            <div style={{ 
              marginTop: '2rem',
              padding: '1rem',
              background: 'var(--bc-gray)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: 'var(--bc-text-secondary)'
            }}>
              <strong>Tips:</strong>
              <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                <li>Task 1: Spend about 20 minutes (minimum 150 words)</li>
                <li>Task 2: Spend about 40 minutes (minimum 250 words)</li>
                <li>Plan your answer before writing</li>
                <li>Check your spelling and grammar</li>
                <li>Make sure you fully address all parts of the task</li>
              </ul>
            </div>
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

export default WritingTest;
