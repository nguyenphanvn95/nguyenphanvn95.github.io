import React, { useState, useEffect } from 'react';
import './App.css';
import TestLibrary from './components/TestLibrary';
import ReadingTest from './components/ReadingTest';
import ListeningTest from './components/ListeningTest';
import WritingTest from './components/WritingTest';
import TestResults from './components/TestResults';

function App() {
  const [currentView, setCurrentView] = useState('library');
  const [currentTest, setCurrentTest] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const startTest = (test) => {
    setCurrentTest(test);
    setCurrentView('test');
  };

  const finishTest = (result) => {
    setTestResult(result);
    setCurrentView('results');
  };

  const backToLibrary = () => {
    setCurrentTest(null);
    setTestResult(null);
    setCurrentView('library');
  };

  return (
    <div className="app">
      {currentView === 'library' && (
        <TestLibrary onStartTest={startTest} />
      )}
      
      {currentView === 'test' && currentTest && (
        <>
          {currentTest.module === 'reading' && (
            <ReadingTest test={currentTest} onFinish={finishTest} onExit={backToLibrary} />
          )}
          {currentTest.module === 'listening' && (
            <ListeningTest test={currentTest} onFinish={finishTest} onExit={backToLibrary} />
          )}
          {currentTest.module === 'writing' && (
            <WritingTest test={currentTest} onFinish={finishTest} onExit={backToLibrary} />
          )}
        </>
      )}

      {currentView === 'results' && testResult && (
        <TestResults result={testResult} onBackToLibrary={backToLibrary} />
      )}
    </div>
  );
}

export default App;
