import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function showBootError(text: string) {
  const el = document.getElementById("boot-error");
  if (!el) return;
  el.textContent = "App error: " + text;
  el.hidden = false;
}

window.addEventListener("error", (e) => {
  showBootError(e.message || (e.error && String(e.error)) || "script error");
});
window.addEventListener("unhandledrejection", (e) => {
  showBootError((e.reason && (e.reason.message || String(e.reason))) || "promise rejection");
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
