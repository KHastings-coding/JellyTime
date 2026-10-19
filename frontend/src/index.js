import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Register service worker with cache busting
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js?v=' + new Date().getTime()).then(reg => {
    console.log('Service Worker registered:', reg);
    // Check for updates every 5 seconds
    setInterval(() => {
      reg.update();
    }, 5000);
  }).catch(err => {
    console.error('Service Worker registration failed:', err);
  });
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
