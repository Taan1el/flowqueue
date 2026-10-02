import React from 'react';
import { isDemoMode, resetDemoData } from '../services/index.js';

export const DemoBanner: React.FC<{ onReset: () => void }> = ({ onReset }) => {
  if (!isDemoMode) return null;

  const handleReset = () => {
    if (window.confirm('Reset the queues, jobs and deliveries to the sample data?')) {
      resetDemoData();
      onReset();
    }
  };

  return (
    <div className="demo-bar">
      <div className="demo-bar-inner">
        <output>Demo: everything runs in your browser with sample data.</output>
        <span className="demo-bar-links">
          <button type="button" className="link-btn" onClick={handleReset}>
            Reset sample data
          </button>
          <a href="https://github.com/Taan1el/flowqueue" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </span>
      </div>
    </div>
  );
};
