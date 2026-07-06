importScripts('shared.js');

const { hourKey, isChatGptPromptEndpoint, isUserSendPayload, sumCounts, todayKey } = GptAndMeShared;
const DEDUPE_MS = 2000;
const BADGE_REFRESH_ALARM = 'gptandme-refresh-badge';
const BADGE_BACKGROUND_COLOR = '#d1242f';
const BADGE_TEXT_COLOR = '#ffffff';
const STORAGE_SCHEMA_VERSION = 1;
const EXPORT_SCHEMA_VERSION = 1;
const STORAGE_DEFAULTS = {
  byDate: {},
  byModel: {},
  byHour: {},
  sessions: {},
  total: 0,
  storageSchemaVersion: STORAGE_SCHEMA_VERSION,
  lastCountedAt: null,
  lastCountReason: null,
  lastCountSite: null,
  lastCountModel: null,
  lastCountSessionId: null,
  extensionVersion: null,
  showPageCounter: true,
  lastIncrementKey: null,
  lastIncrementAt: 0,
};
let lastIncrement = { key: null, at: 0 };
let incrementQueue = Promise.resolve();

async function getCounts() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_DEFAULTS, data => {
      resolve(normalizeStoredData(data));
    });
  });
}

async function setCounts(data) {
  return new Promise(resolve => {
    chrome.storage.local.set(data, resolve);
  });
}

function setBadgeCount(count) {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND_COLOR });
  chrome.action.setBadgeTextColor?.({ color: BADGE_TEXT_COLOR });
  chrome.action.setBadgeText({ text: String(count || 0) });
}

function dedupeRecord(site, sessionId, dedupeKey = sessionId) {
  const now = Date.now();
  const key = `${site || 'unknown'}:${dedupeKey || sessionId || 'unknown'}`;
  return { key, now };
}

function shouldDedupeRecord(record, storedKey = null, storedAt = 0) {
  const { key, now } = record;
  if (lastIncrement.key === key && now - lastIncrement.at < DEDUPE_MS) {
    return true;
  }
  return storedKey === key && now - Number(storedAt || 0) < DEDUPE_MS;
}

function rememberDedupeRecord(record) {
  lastIncrement = { key: record.key, at: record.now };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneObject(value) {
  if (!isObject(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return {};
  }
}

function safeString(value, fallback = 'unknown', maxLength = 256) {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, maxLength);
}

function siteForDiagnostics(site) {
  const text = safeString(site, 'unknown', 512);
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).hostname || 'unknown';
  } catch (_) {
    return text.split(/[/?#]/)[0] || 'unknown';
  }
}

function extensionVersion() {
  try {
    return chrome.runtime.getManifest?.().version || null;
  } catch (_) {
    return null;
  }
}

function normalizeStoredData(data = {}) {
  const byDate = cloneObject(data.byDate);

  return {
    byDate,
    byModel: cloneObject(data.byModel),
    byHour: cloneObject(data.byHour),
    sessions: cloneObject(data.sessions),
    total: sumCounts(byDate),
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    lastCountedAt: data.lastCountedAt || null,
    lastCountReason: data.lastCountReason || null,
    lastCountSite: data.lastCountSite || null,
    lastCountModel: data.lastCountModel || null,
    lastCountSessionId: data.lastCountSessionId || null,
    extensionVersion: data.extensionVersion || extensionVersion(),
    showPageCounter: data.showPageCounter !== false,
    lastIncrementKey: data.lastIncrementKey || null,
    lastIncrementAt: Number(data.lastIncrementAt || 0),
  };
}

function countDiagnostics({ countedAt, reason, site, model, sessionId }) {
  return {
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    lastCountedAt: countedAt,
    lastCountReason: safeString(reason),
    lastCountSite: siteForDiagnostics(site),
    lastCountModel: safeString(model),
    lastCountSessionId: safeString(sessionId),
    extensionVersion: extensionVersion(),
  };
}

function buildStatus(data) {
  return normalizeStoredData({
    ...data,
    extensionVersion: data.extensionVersion || extensionVersion(),
  });
}

function buildExportPayload(data, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    exportedAt,
    extensionVersion: extensionVersion(),
    data: buildStatus(data),
  };
}

async function importData(payload) {
  const source = isObject(payload?.data) ? payload.data : payload;
  const data = normalizeStoredData({
    ...source,
    extensionVersion: extensionVersion() || source?.extensionVersion,
  });
  await setCounts(data);
  setBadgeCount(data.byDate[todayKey()]);
  return {
    total: data.total,
    storageSchemaVersion: data.storageSchemaVersion,
  };
}

function canManageStoredData(sender = {}) {
  return !sender?.tab;
}

function sendAsyncResponse(sendResponse, promise) {
  promise
    .then(response => sendResponse(response))
    .catch(error => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
}

async function incrementNow(
  model = 'unknown',
  site = 'unknown',
  sessionId = 'default',
  dedupeKey = sessionId,
  reason = 'unknown'
) {
  const dedupe = dedupeRecord(site, sessionId, dedupeKey);
  const data = await getCounts();
  if (shouldDedupeRecord(dedupe, data.lastIncrementKey, data.lastIncrementAt)) return;
  rememberDedupeRecord(dedupe);

  const { byDate, byModel, byHour, sessions, total } = data;
  const day = todayKey();
  const hour = hourKey();
  const countedAt = new Date().toISOString();

  byDate[day] = (byDate[day] || 0) + 1;
  byHour[hour] = (byHour[hour] || 0) + 1;

  if (!byModel[day]) byModel[day] = {};
  byModel[day][model] = (byModel[day][model] || 0) + 1;

  if (!sessions[sessionId]) {
    sessions[sessionId] = { prompts: 0, site, startedAt: countedAt };
  }
  sessions[sessionId].prompts = (sessions[sessionId].prompts || 0) + 1;
  sessions[sessionId].site = site;
  sessions[sessionId].lastModel = model;
  sessions[sessionId].lastSeenAt = countedAt;

  const newTotal = (total || 0) + 1;
  await setCounts({
    byDate,
    byModel,
    byHour,
    sessions,
    total: newTotal,
    lastIncrementKey: dedupe.key,
    lastIncrementAt: dedupe.now,
    ...countDiagnostics({ countedAt, reason, site, model, sessionId }),
  });
  setBadgeCount(byDate[day]);
}

function increment(...args) {
  incrementQueue = incrementQueue.then(
    () => incrementNow(...args),
    () => incrementNow(...args)
  );
  return incrementQueue;
}

async function refreshBadgeFromStorage() {
  const { byDate } = await getCounts();
  setBadgeCount(byDate[todayKey()]);
}

function scheduleBadgeRefresh() {
  chrome.alarms?.create?.(BADGE_REFRESH_ALARM, { periodInMinutes: 60 });
}

function ensureDefaultSettings() {
  chrome.storage.local.get({ showPageCounter: null }, (data) => {
    const updates = { extensionVersion: extensionVersion() };
    if (data.showPageCounter === null) updates.showPageCounter = true;
    chrome.storage.local.set(updates);
  });
}

// Initialize badge on install/activate
chrome.runtime.onInstalled.addListener(async () => {
  ensureDefaultSettings();
  scheduleBadgeRefresh();
  await refreshBadgeFromStorage();
});
chrome.runtime.onStartup.addListener(async () => {
  chrome.storage.local.set({ extensionVersion: extensionVersion() });
  scheduleBadgeRefresh();
  await refreshBadgeFromStorage();
});

chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm.name === BADGE_REFRESH_ALARM) refreshBadgeFromStorage();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local' || !changes.byDate) return;
  setBadgeCount((changes.byDate.newValue || {})[todayKey()]);
});

function parseJsonFromRequestBody(details) {
  const raw = details.requestBody?.raw?.[0]?.bytes;
  if (!raw) return null;
  try {
    const text = new TextDecoder().decode(new Uint8Array(raw));
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function siteFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return 'chatgpt.com';
  }
}

// Listen for tick messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === "tick") {
    const site = message.site || sender.tab?.url || 'unknown';
    const sessionId = message.sessionId || `tab-${sender.tab?.id ?? 'unknown'}`;
    const dedupeKey = `tab-${sender.tab?.id ?? sessionId}`;
    increment(message.model || 'unknown', site, sessionId, dedupeKey);
  }
});

// Observe outgoing requests to the ChatGPT web backend (backup method)
const urlFilters = [
  "*://chat.openai.com/backend-api/conversation*",
  "*://chat.openai.com/backend-api/*/conversation*",
  "*://chat.openai.com/backend-api/responses*",
  "*://chat.openai.com/backend-api/*/responses*",
  "*://chatgpt.com/backend-api/conversation*",
  "*://chatgpt.com/backend-api/*/conversation*",
  "*://chatgpt.com/backend-api/responses*",
  "*://chatgpt.com/backend-api/*/responses*"
];

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isChatGptPromptEndpoint(details.url)) return;
    const payload = parseJsonFromRequestBody(details);
    if (isUserSendPayload(payload)) {
      const sessionId = `tab-${details.tabId}`;
      increment(payload.model || 'unknown', siteFromUrl(details.url), sessionId, sessionId);
    }
  },
  { urls: urlFilters },
  ["requestBody"]
);

// Keep badge in sync if date flips while browser is open
setInterval(async () => {
  const { byDate } = await getCounts();
  setBadgeCount(byDate[todayKey()]);
}, 60 * 1000);
