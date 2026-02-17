// content.js — v0.4 (counts + sidebar widget)

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

// ---------- SIDEBAR WIDGET INJECTION ----------
let host = null, shadow = null, valueEl = null;

function todayKey() { return new Date().toISOString().slice(0,10); }

function readToday(cb) {
  chrome.storage.local.get(['byDate'], (res) => {
    cb((res.byDate && res.byDate[todayKey()]) || 0);
  });
}

function buildWidget() {
  host = document.createElement('div');
  host.id = 'gpt-prompt-counter-host';
  host.style.display = 'block';
  host.style.margin = '6px 8px';

  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .card {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 10px;
      background: rgba(0,0,0,.06);
      font: 600 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: #111;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .7; }
    .grow { flex: 1 1 auto; }
    .title { opacity: .7; font-weight: 600; }
    .val { font-size: 14px; }
    .btn {
      border: 0; background: transparent; cursor: pointer; padding: 2px 4px;
      font: 500 11px/1 system-ui, sans-serif; opacity: .7;
    }
    .btn:hover { opacity: 1; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      .card { background: rgba(255,255,255,.06); color: #eee; }
    }
  `;
  const wrap = document.createElement('div');
  wrap.className = 'card';

  const dot = document.createElement('div');
  dot.className = 'dot';

  const grow = document.createElement('div');
  grow.className = 'grow';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'Prompts today';

  valueEl = document.createElement('div');
  valueEl.className = 'val';
  valueEl.textContent = '0';

  grow.append(title, valueEl);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn';
  resetBtn.title = 'Reset today';
  resetBtn.textContent = 'reset';

  wrap.append(dot, grow, resetBtn);
  shadow.append(style, wrap);

  resetBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    chrome.storage.local.get({ byDate: {}, total: 0 }, (res) => {
      const byDate = res.byDate || {};
      const todayCount = byDate[todayKey()] || 0;
      delete byDate[todayKey()];
      const newTotal = Math.max(0, (res.total || 0) - todayCount);
      chrome.storage.local.set({ byDate, total: newTotal });
    });
  });

  refreshWidget();
}

function placeWidget() {
  // Best target: the "New chat" item in the sidebar
  const newChat = document.querySelector('a[data-testid="create-new-chat-button"]');
  if (newChat && newChat.parentElement) {
    newChat.insertAdjacentElement('afterend', host);
    return true;
  }
  // Fallback: top of the left <aside>
  const aside = document.querySelector('aside');
  if (aside) { aside.prepend(host); return true; }
  // Last resort: fixed top-left so you can at least see it
  document.body.appendChild(host);
  Object.assign(host.style, { position: 'fixed', top: '8px', left: '8px', zIndex: 2147483647 });
  return false;
}

function mountWidget() {
  if (host && document.contains(host)) return;
  buildWidget();
  placeWidget();
}

function refreshWidget() {
  readToday((n) => { if (valueEl) valueEl.textContent = String(n); });
}

// Update on storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.byDate || changes.total)) refreshWidget();
});

// Keep it mounted across SPA re-renders
const rebinder = new MutationObserver(() => {
  if (!host || !document.contains(host)) mountWidget();
});
rebinder.observe(document.documentElement, { childList: true, subtree: true });

// Initial mount
mountWidget();
refreshWidget();