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
  document.getElementById('root').innerHTML =
    `<div style="color:#ef4444;padding:40px;font-family:sans-serif">
      <h2>Database Error</h2>
      <p>${err.message}</p>
      <p>Try clearing site data: DevTools → Application → IndexedDB → Delete "JSRedditGrowthOS"</p>
    </div>`;
});
