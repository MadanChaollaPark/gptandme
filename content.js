// content.js — v0.6 (counts + model detection)

// ---------- SITE CONFIG ----------
const SITES = {
  "chatgpt.com": {
    modelSelectors: [
      '[data-testid*="model"]',
      'button[class*="model"]',
      'nav button span',
    ],
  },
  "claude.ai": {
    modelSelectors: [
      'button[data-testid*="model"]',
      '[class*="model-selector"] button',
      'button[aria-haspopup="listbox"]',
    ],
  },
  "gemini.google.com": {
    modelSelectors: [
      'button[data-test-id*="model"]',
      '[class*="model"] button',
      'header button span',
    ],
  },
  "perplexity.ai": {
    modelSelectors: [
      '[class*="model"]',
      'button[aria-label*="model"]',
    ],
  },
};

const hostname = location.hostname.replace(/^www\./, '');
const siteConfig = SITES[hostname] || null;

// ---------- MODEL DETECTION ----------
function normalizeModel(raw) {
  const t = raw.toLowerCase().replace(/[\u2011-\u2014]/g, '-');
  if (/gpt-?4o-?mini/i.test(t)) return 'gpt-4o-mini';
  if (/gpt-?4o/i.test(t)) return 'gpt-4o';
  if (/gpt-?4\.?5/i.test(t)) return 'gpt-4.5';
  if (/gpt-?4/i.test(t)) return 'gpt-4';
  if (/o3-?mini/i.test(t)) return 'o3-mini';
  if (/o1-?mini/i.test(t)) return 'o1-mini';
  if (/\bo3\b/.test(t)) return 'o3';
  if (/\bo1\b/.test(t)) return 'o1';
  if (/claude.*opus/i.test(t)) return 'claude-opus';
  if (/claude.*haiku/i.test(t)) return 'claude-haiku';
  if (/claude.*sonnet/i.test(t)) return 'claude-sonnet';
  if (/gemini.*flash/i.test(t)) return 'gemini-flash';
  if (/gemini.*pro/i.test(t)) return 'gemini-pro';
  return 'unknown';
}

function detectModel() {
  if (!siteConfig?.modelSelectors) return 'unknown';
  for (const sel of siteConfig.modelSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) {
        const m = normalizeModel(el.textContent);
        if (m !== 'unknown') return m;
      }
    } catch (_) {}
  }
  return 'unknown';
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

// ---------- SESSION TRACKING ----------
let lastPath = location.pathname;

function signalNewSession() {
  chrome.runtime?.sendMessage?.({
    type: "new-session",
    site: location.hostname,
    path: location.pathname,
  });
}

function checkUrlChange() {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    signalNewSession();
  }
}

// SPA navigations don't always fire popstate, so poll as well
setInterval(checkUrlChange, 1000);
window.addEventListener('popstate', checkUrlChange);

// Signal a session on initial page load
signalNewSession();

// capture so React can't swallow events before us
document.addEventListener('submit', (e) => { if (inComposer(e.target)) tick(); }, true);
document.addEventListener('keydown', (e) => { if (inComposer(e.target) && shouldCountKey(e)) tick(); }, true);
document.addEventListener('click', (e) => {
  const btn = (e.target instanceof Element) && e.target.closest(
    '[data-testid="send-button"], #composer-submit-button, button[aria-label*="Send"]'
  );
  if (btn && inComposer(btn)) tick();
}, true);
