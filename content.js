// content.js - counts sends and detects model/site context.

const { SITES, shouldCountKey, todayKey } = GptAndMeShared;
const matchedSiteEntry = Object.entries(SITES).find(([, config]) =>
  (config.hosts || []).includes(location.hostname)
);
const siteEntry = matchedSiteEntry || [location.hostname, { sendButtons: [] }];
const [siteName, siteConfig] = siteEntry;
const countDomEvents = !siteConfig.countViaNetwork || siteConfig.domFallback;

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
