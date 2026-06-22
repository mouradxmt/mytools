import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Web Crypto (crypto.subtle) only exists in a secure context. Auto-upgrade
// http→https off localhost so the vault crypto never runs on an insecure origin.
if (
  location.protocol === 'http:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
) {
  location.replace('https://' + location.host + location.pathname + location.search + location.hash);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
