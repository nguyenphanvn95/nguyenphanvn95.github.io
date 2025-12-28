import React from 'react';
import { CheckCircle, XCircle, Download, Home } from 'lucide-react';

function TestResults({ result, onBackToLibrary }) {
  const exportResult = () => {
    const dataStr = JSON.stringify(result, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ielts-result-${result.testId}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getBandScore = (percentage) => {
    if (percentage >= 95) return 9.0;
    if (percentage >= 90) return 8.5;
    if (percentage >= 85) return 8.0;
    if (percentage >= 80) return 7.5;
    if (percentage >= 75) return 7.0;
    if (percentage >= 70) return 6.5;
    if (percentage >= 65) return 6.0;
    if (percentage >= 60) return 5.5;
    if (percentage >= 55) return 5.0;
    if (percentage >= 50) return 4.5;
    if (percentage >= 45) return 4.0;
    if (percentage >= 40) return 3.5;
    return 3.0;
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const isWritingTest = result.module === 'writing';
  const bandScore = !isWritingTest ? getBandScore(parseFloat(result.score)) : null;

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
      padding: '2rem'
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ 
            width: '80px', 
            height: '80px', 
            background: isWritingTest ? 'var(--bc-blue)' : 'var(--bc-green)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem'
          }}>
            {isWritingTest ? (
              <CheckCircle size={48} color="white" />
            ) : (
              <CheckCircle size={48} color="white" />
            )}
          </div>
          <h1 style={{ 
            fontSize: '2.5rem', 
            fontWeight: 700, 
            color: 'var(--bc-navy)',
            marginBottom: '0.5rem'
          }}>
            Test Completed!
          </h1>
          <p style={{ 
            fontSize: '1.125rem', 
            color: 'var(--bc-text-secondary)' 
          }}>
            {result.title}
          </p>
        </div>

        {/* Results Card */}
        <div style={{ 
          background: 'white', 
          borderRadius: '12px', 
          padding: '2rem',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          marginBottom: '2rem'
        }}>
          {!isWritingTest ? (
            <>
              {/* Score Display */}
              <div style={{ 
                textAlign: 'center', 
                padding: '2rem',
                borderBottom: '2px solid var(--bc-border)'
              }}>
                <div style={{ 
                  fontSize: '5rem', 
                  fontWeight: 700, 
                  color: 'var(--bc-navy)',
                  marginBottom: '0.5rem'
                }}>
                  {bandScore}
                </div>
                <div style={{ 
                  fontSize: '1.25rem', 
                  color: 'var(--bc-text-secondary)',
                  marginBottom: '1rem'
                }}>
                  Estimated Band Score
                </div>
                <div style={{ 
                  fontSize: '1rem', 
                  color: 'var(--bc-text-secondary)' 
                }}>
                  {result.correctAnswers} out of {result.totalQuestions} correct ({result.score}%)
                </div>
              </div>

              {/* Statistics */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                gap: '1.5rem',
                padding: '2rem'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <CheckCircle size={32} color="var(--bc-green)" style={{ marginBottom: '0.5rem' }} />
                  <div style={{ 
                    fontSize: '2rem', 
                    fontWeight: 600, 
                    color: 'var(--bc-green)' 
                  }}>
                    {result.correctAnswers}
                  </div>
                  <div style={{ 
                    fontSize: '0.875rem', 
                    color: 'var(--bc-text-secondary)' 
                  }}>
                    Correct
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <XCircle size={32} color="var(--bc-red)" style={{ marginBottom: '0.5rem' }} />
                  <div style={{ 
                    fontSize: '2rem', 
                    fontWeight: 600, 
                    color: 'var(--bc-red)' 
                  }}>
                    {result.totalQuestions - result.correctAnswers}
                  </div>
                  <div style={{ 
                    fontSize: '0.875rem', 
                    color: 'var(--bc-text-secondary)' 
                  }}>
                    Incorrect
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <div style={{ 
                    fontSize: '2rem', 
                    fontWeight: 600, 
                    color: 'var(--bc-navy)' 
                  }}>
                    {formatDuration(result.timeSpent)}
                  </div>
                  <div style={{ 
                    fontSize: '0.875rem', 
                    color: 'var(--bc-text-secondary)' 
                  }}>
                    Time Spent
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Writing Test Results */}
              <div style={{ padding: '2rem' }}>
                <h2 style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: 600, 
                  color: 'var(--bc-navy)',
                  marginBottom: '1.5rem'
                }}>
                  Your Essays
                </h2>

                {Object.entries(result.wordCounts || {}).map(([taskId, wordCount]) => (
                  <div key={taskId} style={{ 
                    marginBottom: '2rem',
                    padding: '1.5rem',
                    background: 'var(--bc-gray)',
                    borderRadius: '8px'
                  }}>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '1rem'
                    }}>
                      <h3 style={{ 
                        fontSize: '1.125rem', 
                        fontWeight: 600,
                        color: 'var(--bc-navy)'
                      }}>
                        Task {taskId}
                      </h3>
                      <div style={{ 
                        fontSize: '1rem',
                        fontWeight: 600,
                        color: 'var(--bc-blue)'
                      }}>
                        {wordCount} words
                      </div>
                    </div>
                    <div style={{ 
                      background: 'white',
                      padding: '1rem',
                      borderRadius: '6px',
                      maxHeight: '200px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontSize: '0.9375rem',
                      lineHeight: 1.7,
                      color: 'var(--bc-text)'
                    }}>
                      {result.essays?.[taskId] || 'No response'}
                    </div>
                  </div>
                ))}

                <div style={{ 
                  background: 'var(--bc-light-blue)',
                  padding: '1rem',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  color: 'var(--bc-text-secondary)'
                }}>
                  <strong>Note:</strong> Writing tasks require manual evaluation by an examiner. 
                  This system only tracks your responses and word counts. For accurate band scores, 
                  please have your essays evaluated by a qualified IELTS teacher.
                </div>

                <div style={{ 
                  marginTop: '1.5rem',
                  textAlign: 'center'
                }}>
                  <div style={{ 
                    fontSize: '1.125rem', 
                    fontWeight: 600, 
                    color: 'var(--bc-navy)' 
                  }}>
                    Time Spent: {formatDuration(result.timeSpent)}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ 
          display: 'flex', 
          gap: '1rem', 
          justifyContent: 'center',
          flexWrap: 'wrap'
        }}>
          <button 
            className="btn btn-secondary"
            onClick={exportResult}
            style={{ minWidth: '200px' }}
          >
            <Download size={18} />
            Export Results
          </button>
          <button 
            className="btn btn-primary"
            onClick={onBackToLibrary}
            style={{ minWidth: '200px' }}
          >
            <Home size={18} />
            Back to Library
          </button>
        </div>

        {/* Band Score Reference (for non-writing tests) */}
        {!isWritingTest && (
          <div style={{ 
            marginTop: '3rem',
            background: 'white',
            padding: '1.5rem',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
          }}>
            <h3 style={{ 
              fontSize: '1.125rem', 
              fontWeight: 600,
              color: 'var(--bc-navy)',
              marginBottom: '1rem'
            }}>
              Band Score Reference
            </h3>
            <div style={{ 
              fontSize: '0.875rem',
              color: 'var(--bc-text-secondary)',
              lineHeight: 1.7
            }}>
              <p style={{ marginBottom: '0.5rem' }}>
                <strong>Band 9:</strong> Expert user - Full operational command
              </p>
              <p style={{ marginBottom: '0.5rem' }}>
                <strong>Band 8:</strong> Very good user - Fully operational with minor inaccuracies
              </p>
              <p style={{ marginBottom: '0.5rem' }}>
                <strong>Band 7:</strong> Good user - Operational command with occasional inaccuracies
              </p>
              <p style={{ marginBottom: '0.5rem' }}>
                <strong>Band 6:</strong> Competent user - Effective command despite inaccuracies
              </p>
              <p style={{ marginBottom: '0.5rem' }}>
                <strong>Band 5:</strong> Modest user - Partial command with frequent problems
              </p>
              <p>
                <em>Note: This is an estimated score based on correct answers. 
                Actual IELTS scoring considers additional factors.</em>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TestResults;
