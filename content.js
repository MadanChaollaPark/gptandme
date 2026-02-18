// content.js — v0.5 (counts only)

// ---------- COUNTING ----------
let lastTick = 0;
const throttleMs = 400;

function tick() {
  const now = Date.now();
  if (now - lastTick < throttleMs) return;
  lastTick = now;
  chrome.runtime?.sendMessage?.({ type: "tick" }); // service_worker.js increments storage
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
