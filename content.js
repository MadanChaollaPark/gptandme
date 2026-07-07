// content.js - counts sends and detects model/site context.

const { SITES, shouldCountKey, todayKey } = GptAndMeShared;
const matchedSiteEntry = Object.entries(SITES).find(([, config]) =>
  (config.hosts || []).includes(location.hostname)
);
const siteEntry = matchedSiteEntry || [location.hostname, { sendButtons: [] }];
const [siteName, siteConfig] = siteEntry;
const countDomEvents = !siteConfig.countViaNetwork || siteConfig.domFallback;

function rememberCurrentSite() {
  if (!matchedSiteEntry) return;
  chrome.storage?.local?.set?.({
    lastSeenAt: new Date().toISOString(),
    lastSeenSite: siteName,
  });
}

rememberCurrentSite();
window.addEventListener?.('pageshow', rememberCurrentSite);

// ---------- MODEL DETECTION ----------

// Best signal: intercept ChatGPT fetches to learn the model from the request.
// inject.js runs in the page context and dispatches a custom event with the
// model slug read straight from the request body.
if (
  (siteName === 'chatgpt.com' || siteName === 'chat.openai.com') &&
  typeof chrome !== 'undefined' &&
  chrome.runtime?.getURL
) {
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
    reason: 'dom-event',
  });
}

function inComposer(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.closest('form')) return true;
  if (el.closest('[data-testid*="composer"], [data-qa*="composer"]')) return true;
  if (el.closest('textarea, [contenteditable="true"]')) return true;
  return false;
}

function composerRoot(el) {
  if (!el || !(el instanceof Element)) return null;
  const root = el.closest('form') || el.closest('[data-testid*="composer"], [data-qa*="composer"]');
  if (root) return root;
  const input = el.closest('textarea, [contenteditable="true"]');
  return input?.parentElement || input;
}

function attrIncludes(el, attr, terms) {
  const value = el.getAttribute?.(attr)?.toLowerCase() || '';
  return terms.some((term) => value.includes(term));
}

function isDisabledControl(el) {
  if (!el || !(el instanceof Element)) return true;
  if ('disabled' in el && el.disabled) return true;
  return (
    el.matches?.(':disabled') ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.getAttribute('data-disabled') === 'true'
  );
}

function isBusyControl(el) {
  if (!el || !(el instanceof Element)) return false;
  const busyTerms = ['stop', 'cancel', 'interrupt', 'abort'];
  return attrIncludes(el, 'data-testid', busyTerms) || attrIncludes(el, 'aria-label', busyTerms);
}

function hasBusyControl(root) {
  return [...root.querySelectorAll('button, [role="button"], [data-testid], [aria-label]')]
    .some(isBusyControl);
}

function activeSendButton(root) {
  const selector = siteConfig.sendButtons.join(', ');
  if (!selector) return null;
  return [...root.querySelectorAll(selector)].find((button) => !isDisabledControl(button)) || null;
}

function canSendFrom(el) {
  const root = composerRoot(el);
  if (!root || hasBusyControl(root)) return false;
  return Boolean(activeSendButton(root));
}

// capture so React can't swallow events before us
if (countDomEvents) {
  document.addEventListener('submit', (e) => { if (inComposer(e.target) && canSendFrom(e.target)) tick(); }, true);
  document.addEventListener('keydown', (e) => { if (inComposer(e.target) && shouldCountKey(e) && canSendFrom(e.target)) tick(); }, true);
  document.addEventListener('click', (e) => {
    const selector = siteConfig.sendButtons.join(', ');
    const btn = selector && (e.target instanceof Element) && e.target.closest(selector);
    if (btn && inComposer(btn) && !isDisabledControl(btn) && canSendFrom(btn)) tick();
  }, true);
}

// ---------- PAGE COUNTER WIDGET ----------

const PAGE_COUNTER_ID = 'gptandme-page-counter';
const PAGE_COUNTER_TITLE = 'GPT&Me prompts today';

let pageCounterEnabled = true;
let pageCounterCount = 0;
let pageCounterDate = todayKey();
let pageCounterHost = null;
let pageCounterShadow = null;
let pageCounterObserver = null;
let pageCounterInterval = null;
let pageCounterRenderQueued = false;

function supportedPageCounterSite() {
  return Boolean(matchedSiteEntry);
}

function pageCounterMountTarget() {
  return document.body || document.documentElement;
}

function currentTodayCount(byDate = {}) {
  const count = Number(byDate[todayKey()] || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function removePageCounter() {
  for (const host of document.querySelectorAll(`#${PAGE_COUNTER_ID}`)) {
    host.remove();
  }
  pageCounterHost = null;
  pageCounterShadow = null;
}

function stylePageCounterHost(host) {
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.right = '12px';
  host.style.bottom = '12px';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';
}

function createPageCounterHost() {
  const host = document.createElement('div');
  host.id = PAGE_COUNTER_ID;
  host.setAttribute('data-gptandme-page-counter', 'true');
  stylePageCounterHost(host);
  pageCounterMountTarget()?.appendChild(host);
  return host;
}

function getPageCounterHost() {
  const hosts = [...document.querySelectorAll(`#${PAGE_COUNTER_ID}`)];
  const host = hosts[0] || createPageCounterHost();

  for (const duplicate of hosts.slice(1)) {
    duplicate.remove();
  }

  if (!host.isConnected) {
    pageCounterMountTarget()?.appendChild(host);
  }

  stylePageCounterHost(host);
  return host;
}

function buildPageCounterShadow(shadow) {
  if (shadow.querySelector?.('[data-gptandme-counter-value]')) return;

  const style = document.createElement('style');
  style.textContent = `
    :host {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .counter {
      align-items: center;
      background: rgba(17, 24, 39, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 999px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
      box-sizing: border-box;
      color: #ffffff;
      display: inline-flex;
      gap: 6px;
      min-height: 30px;
      padding: 5px 9px;
      -webkit-backdrop-filter: blur(10px);
      backdrop-filter: blur(10px);
      user-select: none;
      white-space: nowrap;
    }
    .value {
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
    }
    .label {
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      opacity: 0.78;
      text-transform: uppercase;
    }
    @media (prefers-color-scheme: light) {
      .counter {
        background: rgba(255, 255, 255, 0.86);
        border-color: rgba(15, 23, 42, 0.12);
        color: #111827;
      }
    }
  `;

  const counter = document.createElement('div');
  counter.className = 'counter';
  counter.setAttribute('role', 'status');
  counter.setAttribute('aria-live', 'polite');
  counter.title = PAGE_COUNTER_TITLE;

  const value = document.createElement('span');
  value.className = 'value';
  value.setAttribute('data-gptandme-counter-value', 'true');

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'today';

  counter.append(value, label);
  shadow.append(style, counter);
}

function renderPageCounter() {
  if (!supportedPageCounterSite()) return;
  if (!pageCounterEnabled) {
    removePageCounter();
    return;
  }

  const host = getPageCounterHost();
  const shadow = getPageCounterShadow(host);
  if (!shadow) return;

  pageCounterHost = host;
  pageCounterShadow = shadow;
  buildPageCounterShadow(shadow);

  const value = shadow.querySelector('[data-gptandme-counter-value]');
  if (value) {
    value.textContent = String(pageCounterCount);
    value.setAttribute('aria-label', `${pageCounterCount} prompts today`);
  }
}

function queuePageCounterRender() {
  if (pageCounterRenderQueued) return;
  pageCounterRenderQueued = true;
  const schedule = typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (callback) => setTimeout(callback, 0);
  schedule(() => {
    pageCounterRenderQueued = false;
    renderPageCounter();
  });
}

function getPageCounterShadow(host) {
  if (host.shadowRoot) return host.shadowRoot;

  try {
    return host.attachShadow?.({ mode: 'open' }) || null;
  } catch (_) {
    host.remove();
    const replacement = createPageCounterHost();
    return replacement.attachShadow?.({ mode: 'open' }) || null;
  }
}

function syncPageCounterFromStorage() {
  if (!supportedPageCounterSite()) return;

  chrome.storage?.local?.get?.({ byDate: {}, showPageCounter: true }, (data = {}) => {
    pageCounterEnabled = data.showPageCounter !== false;
    pageCounterCount = currentTodayCount(data.byDate);
    pageCounterDate = todayKey();
    renderPageCounter();
  });
}

function onPageCounterStorageChange(changes, namespace) {
  if (namespace !== 'local') return;
  if (!changes.byDate && !changes.showPageCounter) return;

  if (changes.byDate) {
    pageCounterCount = currentTodayCount(changes.byDate.newValue || {});
    pageCounterDate = todayKey();
  }

  if (changes.showPageCounter) {
    pageCounterEnabled = changes.showPageCounter.newValue !== false;
  }

  renderPageCounter();
}

function keepPageCounterAttached() {
  if (!pageCounterEnabled || !supportedPageCounterSite()) return;
  const currentDate = todayKey();

  if (currentDate !== pageCounterDate) {
    syncPageCounterFromStorage();
    return;
  }

  if (!pageCounterHost?.isConnected || document.querySelectorAll(`#${PAGE_COUNTER_ID}`).length !== 1) {
    queuePageCounterRender();
  }
}

function startPageCounterObserver() {
  if (pageCounterObserver || !window.MutationObserver || !document.documentElement) return;

  pageCounterObserver = new MutationObserver(keepPageCounterAttached);
  pageCounterObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function startPageCounterInterval() {
  if (pageCounterInterval || typeof setInterval !== 'function') return;
  pageCounterInterval = setInterval(keepPageCounterAttached, 60 * 1000);
}

function initPageCounter() {
  if (!supportedPageCounterSite()) return;
  if (typeof chrome === 'undefined') return;
  if (!chrome.storage?.local?.get) return;

  syncPageCounterFromStorage();
  startPageCounterObserver();
  startPageCounterInterval();
  chrome.storage?.onChanged?.addListener?.(onPageCounterStorageChange);
  window.addEventListener?.('pageshow', syncPageCounterFromStorage);
}

initPageCounter();
