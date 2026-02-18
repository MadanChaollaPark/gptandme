// content.js — v0.6 (counts + model detection)

// ---------- MODEL DETECTION ----------

// Best signal: intercept fetch to /backend-api/conversation (ChatGPT).
// inject.js runs in the page context and dispatches a custom event with the
// model slug read straight from the request body.
const s = document.createElement('script');
s.src = chrome.runtime.getURL('inject.js');
s.onload = () => s.remove();
(document.head || document.documentElement).appendChild(s);

let lastDetectedModel = null;

window.addEventListener('__gptandme_model', (e) => {
  lastDetectedModel = e.detail; // e.g. "gpt-4o", "o3"
});

// Fallback: data-message-model-slug on the latest assistant response
function modelFromSlugAttr() {
  const divs = document.querySelectorAll('div[data-message-model-slug]');
  if (divs.length) return divs[divs.length - 1].getAttribute('data-message-model-slug');
  return null;
}

// Fallback: URL ?model= param (new-conversation links)
function modelFromURL() {
  try { return new URL(location.href).searchParams.get('model') || null; }
  catch (_) { return null; }
}

function detectModel() {
  return lastDetectedModel || modelFromSlugAttr() || modelFromURL() || 'unknown';
}

// ---------- COUNTING ----------
let lastTick = 0;
const throttleMs = 400;

function tick() {
  const now = Date.now();
  if (now - lastTick < throttleMs) return;
  lastTick = now;
  const model = detectModel();
  chrome.runtime?.sendMessage?.({ type: "tick", model });
}

function inComposer(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.closest('form')) return true;
  if (el.closest('[data-testid*="composer"], [data-qa*="composer"]')) return true;
  if (el.closest('textarea, [contenteditable="true"]')) return true;
  return false;
}

function shouldCountKey(e) {
  if (e.isComposing || e.altKey) return false;
  if (e.key !== 'Enter') return false;
  if (e.ctrlKey || e.metaKey) return true; // Ctrl/Cmd+Enter
  return !e.shiftKey; // Enter (no Shift) sends
}

// capture so React can't swallow events before us
document.addEventListener('submit', (e) => { if (inComposer(e.target)) tick(); }, true);
document.addEventListener('keydown', (e) => { if (inComposer(e.target) && shouldCountKey(e)) tick(); }, true);
document.addEventListener('click', (e) => {
  const btn = (e.target instanceof Element) && e.target.closest(
    '[data-testid="send-button"], #composer-submit-button, button[aria-label*="Send"]'
  );
  if (btn && inComposer(btn)) tick();
}, true);

