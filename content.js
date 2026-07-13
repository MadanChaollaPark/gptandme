// content.js - counts sends and detects model/site context.

const { SITES, shouldCountKey, todayKey } = GptAndMeShared;
const matchedSiteEntry = Object.entries(SITES).find(([, config]) =>
  (config.hosts || []).includes(location.hostname)
);
const siteEntry = matchedSiteEntry || [location.hostname, { sendButtons: [] }];
const [siteName, siteConfig] = siteEntry;
const provider = siteConfig.provider || 'unknown';
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

// The manifest installs inject.js in the page's MAIN world at document_start.
// It reports only opaque send IDs and model metadata through these events.

let lastDetectedModel = null;
let pendingDomFallback = null;
let sendSequence = 0;

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {
    // Fall through to a non-sensitive per-document random ID.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const pageSessionId = `${provider}:page-${randomId()}`;

window.addEventListener('__gptandme_model', (e) => {
  lastDetectedModel = normalizeDetectedModel(e.detail); // e.g. "gpt-4o", "o3"
});

window.addEventListener('__gptandme_send', (event) => {
  const detail = event?.detail;
  if (!detail || detail.provider !== provider || !detail.eventId) return;
  if (pendingDomFallback !== null && typeof clearTimeout === 'function') {
    clearTimeout(pendingDomFallback);
    pendingDomFallback = null;
  }
  tick({
    eventId: String(detail.eventId).slice(0, 160),
    model: normalizeDetectedModel(detail.model) || detectModel(),
    reason: `${provider}-network`,
    throttle: false,
  });
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

function normalizeDetectedModel(value) {
  const text = String(value ?? '')
    .replace(/^model\s*:\s*/i, '')
    .trim()
    .toLowerCase();
  if (!text) return null;
  const normalized = text
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9._:/+\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || null;
}

function modelFromProviderDom() {
  if (provider !== 'claude') return null;
  const selector = 'button[data-testid="model-selector-dropdown"]';
  const button = document.querySelectorAll(selector)[0];
  if (!button) return null;
  return normalizeDetectedModel(button.getAttribute('aria-label') || button.textContent);
}

function detectModel() {
  return (
    lastDetectedModel ||
    normalizeDetectedModel(modelFromSlugAttr()) ||
    modelFromProviderDom() ||
    normalizeDetectedModel(modelFromURL()) ||
    'unknown'
  );
}

// ---------- COUNTING ----------
let lastTick = 0;
const throttleMs = 400;
const domFallbackDelayMs = 1500;

function sessionId() {
  return pageSessionId;
}

function tick({
  eventId = `${pageSessionId}:send-${++sendSequence}`,
  model = detectModel(),
  reason = 'dom-event',
  throttle = true,
} = {}) {
  const now = Date.now();
  if (throttle && now - lastTick < throttleMs) return;
  lastTick = now;
  const request = chrome.runtime?.sendMessage?.({
    type: "tick",
    eventId,
    model,
    provider,
    site: siteName,
    sessionId: sessionId(),
    reason,
  });
  request?.catch?.(() => {});
}

function recordDomSend() {
  if (!siteConfig.countViaPageNetwork && !siteConfig.countViaNetwork) {
    tick();
    return;
  }

  if (pendingDomFallback !== null) return;
  if (typeof setTimeout !== 'function') {
    tick({ reason: `${provider}-dom-fallback` });
    return;
  }

  pendingDomFallback = setTimeout(() => {
    pendingDomFallback = null;
    tick({ reason: `${provider}-dom-fallback` });
  }, domFallbackDelayMs);
}

function inComposer(el) {
  return Boolean(composerRoot(el));
}

function composerRoot(el) {
  if (!el || !(el instanceof Element)) return null;
  const inputSelector = (siteConfig.composerInputs || ['textarea', '[contenteditable="true"]']).join(', ');
  const semanticRoot = el.closest?.('form, [role="form"], [data-testid*="composer"]');
  if (semanticRoot) {
    const containsInput = Boolean(
      semanticRoot.matches?.(inputSelector) || semanticRoot.querySelector?.(inputSelector)
    );
    if (containsInput && activeSendButton(semanticRoot)) return semanticRoot;
  }

  let root = el;
  let depth = 0;

  while (root && depth < 32 && root !== document.documentElement) {
    const containsInput = Boolean(
      root.matches?.(inputSelector) || root.querySelector?.(inputSelector)
    );
    if (containsInput && activeSendButton(root)) return root;
    root = root.parentElement;
    depth += 1;
  }

  return null;
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

function isQueueControl(el) {
  const queueTerms = ['queue'];
  return attrIncludes(el, 'data-testid', queueTerms) || attrIncludes(el, 'aria-label', queueTerms);
}

function activeSendButton(root) {
  const selector = siteConfig.sendButtons.join(', ');
  if (!selector) return null;
  return [...root.querySelectorAll(selector)].find((button) => !isDisabledControl(button)) || null;
}

function composerHasUserInput(root) {
  const inputSelector = (siteConfig.composerInputs || ['textarea', '[contenteditable="true"]']).join(', ');
  const inputs = [
    ...(root.matches?.(inputSelector) ? [root] : []),
    ...root.querySelectorAll(inputSelector),
  ];
  if (inputs.some((input) => {
    const value = 'value' in input ? input.value : input.textContent;
    return typeof value === 'string' && value.trim().length > 0;
  })) {
    return true;
  }

  return Boolean(root.querySelector(
    '[data-testid*="attachment"], [data-qa*="attachment"], [aria-label*="Remove file"], [aria-label*="Remove attachment"]'
  ));
}

function canSendFrom(el) {
  const root = composerRoot(el);
  if (!root || !composerHasUserInput(root)) return false;
  const sendButton = activeSendButton(root);
  if (!sendButton) return false;
  return isQueueControl(sendButton) || !hasBusyControl(root);
}

function isVisibleSuggestionMenu(menu) {
  if (menu.hidden || menu.getAttribute?.('aria-hidden') === 'true') return false;
  if (menu.id === 'typeahead-menu') return true;
  if (typeof menu.getBoundingClientRect !== 'function') return false;
  const rect = menu.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function hasActiveSuggestionMenu(target) {
  const root = composerRoot(target);
  const menus = document.querySelectorAll('#typeahead-menu, [role="listbox"]');
  const scopedMenus = new Set(root
    ? [...root.querySelectorAll('#typeahead-menu, [role="listbox"]')]
    : []);
  const controlledIds = new Set();
  const controls = [target, ...(root?.querySelectorAll?.('[aria-controls]') || [])];
  for (const control of controls) {
    for (const id of String(control?.getAttribute?.('aria-controls') || '').split(/\s+/)) {
      if (id) controlledIds.add(id);
    }
  }

  return [...menus].some((menu) => {
    if (!isVisibleSuggestionMenu(menu)) return false;
    if (provider === 'perplexity' && menu.id === 'typeahead-menu') return true;
    return scopedMenus.has(menu) || controlledIds.has(menu.id);
  });
}

// capture so React can't swallow events before us
if (countDomEvents) {
  document.addEventListener('submit', (e) => { if (inComposer(e.target) && canSendFrom(e.target)) recordDomSend(); }, true);
  document.addEventListener('keydown', (e) => {
    if (
      inComposer(e.target) &&
      shouldCountKey(e) &&
      !hasActiveSuggestionMenu(e.target) &&
      canSendFrom(e.target)
    ) {
      recordDomSend();
    }
  }, true);
  document.addEventListener('click', (e) => {
    const selector = siteConfig.sendButtons.join(', ');
    const btn = selector && (e.target instanceof Element) && e.target.closest(selector);
    if (btn && inComposer(btn) && !isDisabledControl(btn) && canSendFrom(btn)) recordDomSend();
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
const pageCounterShadows = new WeakMap();
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
  const existing = pageCounterShadows.get(host);
  if (existing) return existing;

  try {
    const shadow = host.attachShadow?.({ mode: 'closed' }) || null;
    if (shadow) pageCounterShadows.set(host, shadow);
    return shadow;
  } catch (_) {
    host.remove();
    const replacement = createPageCounterHost();
    const shadow = replacement.attachShadow?.({ mode: 'closed' }) || null;
    if (shadow) pageCounterShadows.set(replacement, shadow);
    return shadow;
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
  const mountTarget = pageCounterMountTarget();
  if (pageCounterObserver || !window.MutationObserver || !mountTarget) return;

  pageCounterObserver = new MutationObserver(keepPageCounterAttached);
  pageCounterObserver.observe(mountTarget, { childList: true });
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
