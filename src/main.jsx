import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { dbReady } from './db/db'

dbReady.then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch(err => {
  const root = document.getElementById('root');
  const container = document.createElement('div');
  container.style.cssText = 'color:#ef4444;padding:40px;font-family:sans-serif';
  const h2 = document.createElement('h2');
  h2.textContent = 'Database Error';
  const p1 = document.createElement('p');
  p1.textContent = err.message;
  const p2 = document.createElement('p');
  p2.textContent = 'Try clearing site data: DevTools → Application → IndexedDB → Delete "JSRedditGrowthOS"';
  container.append(h2, p1, p2);
  root.appendChild(container);
});
