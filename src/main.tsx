import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { handleGoogleCallback } from './utils/youtube';

if (window.location.pathname.startsWith('/auth/youtube/callback') || window.location.hash.includes('access_token=')) {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    rootEl.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        background-color: #0d0e11;
        color: #ff0000;
        font-family: monospace;
        text-align: center;
        padding: 20px;
      ">
        <div style="font-size: 24px; margin-bottom: 12px; font-weight: bold; letter-spacing: 2px;">WINAMP</div>
        <div style="font-size: 14px; color: #b4b5b8; margin-bottom: 20px;">Conectando con YouTube...</div>
        <div style="
          width: 40px;
          height: 40px;
          border: 3px solid #111;
          border-top: 3px solid #ff0000;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        "></div>
        <button onclick="window.location.href='/'" style="
          margin-top: 24px;
          padding: 6px 14px;
          background: #222;
          color: #ccc;
          border: 1px solid #444;
          cursor: pointer;
          border-radius: 2px;
          font-family: monospace;
          font-size: 11px;
        ">Volver a Winamp</button>
        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </div>
    `;
  }
  handleGoogleCallback();
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

