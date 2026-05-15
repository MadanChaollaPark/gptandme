// content.js - counts sends and detects model/site context.

const { SITES, shouldCountKey } = GptAndMeShared;
const siteEntry = Object.entries(SITES).find(([, config]) =>
  (config.hosts || []).includes(location.hostname)
) || [location.hostname, { sendButtons: [] }];
const [siteName, siteConfig] = siteEntry;

// ---------- MODEL DETECTION ----------

// Best signal: intercept fetch to /backend-api/conversation (ChatGPT).
// inject.js runs in the page context and dispatches a custom event with the
// model slug read straight from the request body.
if (siteName === 'chatgpt.com' || siteName === 'chat.openai.com') {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
}

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

function sessionId() {
  const conversationMatch = location.pathname.match(/\/c\/[^/?#]+/);
  const pathKey = conversationMatch ? conversationMatch[0] : location.pathname || '/';
  return `${siteName}:${pathKey}`;
}

function tick() {
  const now = Date.now();
  if (now - lastTick < throttleMs) return;
  lastTick = now;
  const model = detectModel();
  chrome.runtime?.sendMessage?.({
    type: "tick",
    model,
    site: siteName,
    sessionId: sessionId(),
  });
}

function inComposer(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.closest('form')) return true;
  if (el.closest('[data-testid*="composer"], [data-qa*="composer"]')) return true;
  if (el.closest('textarea, [contenteditable="true"]')) return true;
  return false;
}

// capture so React can't swallow events before us
document.addEventListener('submit', (e) => { if (inComposer(e.target)) tick(); }, true);
document.addEventListener('keydown', (e) => { if (inComposer(e.target) && shouldCountKey(e)) tick(); }, true);
document.addEventListener('click', (e) => {
  const selector = siteConfig.sendButtons.join(', ');
  const btn = selector && (e.target instanceof Element) && e.target.closest(selector);
  if (btn && inComposer(btn)) tick();
}, true);
