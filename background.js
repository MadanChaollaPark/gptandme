importScripts('shared.js');

const {
  hourKey,
  getModelCountsForDate,
  isChatGptPromptEndpoint,
  isUserSendPayload,
  mergeUsageData,
  normalizeModelName,
  normalizeProviderModelData,
  parseDateKey,
  providerForHost,
  siteConfigForHost,
  sumCounts,
  todayKey,
} = GptAndMeShared;
const DEDUPE_MS = 2000;
const EVENT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT_EVENTS = 500;
const MAX_RECENT_INCREMENTS = 500;
const MAX_SESSIONS = 500;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BADGE_REFRESH_ALARM = 'gptandme-refresh-badge';
const BADGE_BACKGROUND_COLOR = '#d1242f';
const BADGE_TEXT_COLOR = '#ffffff';
const GROK_ORIGIN = 'https://grok.com/*';
const GROK_CONTENT_SCRIPT_IDS = Object.freeze([
  'gptandme-grok-main',
  'gptandme-grok-isolated',
]);
const GROK_CONTENT_SCRIPTS = Object.freeze([
  Object.freeze({
    id: GROK_CONTENT_SCRIPT_IDS[0],
    matches: [GROK_ORIGIN],
    js: ['inject.js'],
    runAt: 'document_start',
    world: 'MAIN',
    persistAcrossSessions: true,
  }),
  Object.freeze({
    id: GROK_CONTENT_SCRIPT_IDS[1],
    matches: [GROK_ORIGIN],
    js: ['shared.js', 'content.js'],
    runAt: 'document_end',
    world: 'ISOLATED',
    persistAcrossSessions: true,
  }),
]);
const STORAGE_SCHEMA_VERSION = 2;
const EXPORT_SCHEMA_VERSION = 2;
const STORAGE_DEFAULTS = {
  byDate: {},
  byModel: {},
  byProviderModel: {},
  byHour: {},
  sessions: {},
  total: 0,
  storageSchemaVersion: STORAGE_SCHEMA_VERSION,
  lastCountedAt: null,
  lastCountReason: null,
  lastCountSite: null,
  lastCountModel: null,
  lastCountSessionId: null,
  lastSeenAt: null,
  lastSeenSite: null,
  extensionVersion: null,
  showPageCounter: true,
  lastIncrementKey: null,
  lastIncrementAt: 0,
  recentIncrements: {},
  recentEvents: {},
};
let incrementQueue = Promise.resolve();
let grokSyncQueue = Promise.resolve();

async function getCounts() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(STORAGE_DEFAULTS, data => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(`Could not read GPT&Me data: ${error.message || String(error)}`));
        return;
      }
      resolve(normalizeStoredData(data));
    });
  });
}

async function setCounts(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(`Could not save GPT&Me data: ${error.message || String(error)}`));
        return;
      }
      resolve();
    });
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

function safeNonNegativeInteger(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function normalizeDateCounts(value) {
  const normalized = {};
  let total = 0;
  for (const [date, countValue] of Object.entries(cloneObject(value))) {
    if (!parseDateKey(date)) continue;
    const count = safeNonNegativeInteger(countValue);
    if (count <= 0 || !Number.isSafeInteger(total + count)) continue;
    normalized[date] = count;
    total += count;
  }
  return normalized;
}

function normalizeModelCounts(byDate, value) {
  const source = cloneObject(value);
  const normalized = {};
  for (const date of Object.keys(byDate)) {
    const models = getModelCountsForDate(byDate, source, date);
    if (Object.keys(models).length) normalized[date] = models;
  }
  return normalized;
}

function normalizeHourCounts(value) {
  const normalized = {};
  for (const [hour, countValue] of Object.entries(cloneObject(value))) {
    const match = /^(\d{4}-\d{2}-\d{2})-(\d{2})$/.exec(hour);
    if (!match || !parseDateKey(match[1]) || Number(match[2]) > 23) continue;
    const count = safeNonNegativeInteger(countValue);
    if (count > 0) normalized[hour] = count;
  }
  return normalized;
}

function hashString(value) {
  const text = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function safeOpaqueId(value, fallback = 'default') {
  const text = String(value ?? '').trim();
  if (UNSAFE_OBJECT_KEYS.has(text)) return fallback || `legacy-${hashString(text)}`;
  if (/^[a-zA-Z0-9:._-]{1,180}$/.test(text)) return text;
  if (!text) return fallback;
  return `legacy-${hashString(text)}`;
}

function normalizeSessions(value) {
  const entries = [];
  let index = 0;
  for (const [rawId, rawSession] of Object.entries(cloneObject(value))) {
    if (!isObject(rawSession)) continue;
    const id = safeOpaqueId(rawId, `legacy-session-${index}`);
    index += 1;
    const session = {
      prompts: safeNonNegativeInteger(rawSession.prompts),
      site: siteForDiagnostics(rawSession.site),
      startedAt: rawSession.startedAt || null,
      lastModel: normalizeModelName(rawSession.lastModel),
      lastSeenAt: rawSession.lastSeenAt || null,
    };
    const sortTime = Date.parse(session.lastSeenAt || session.startedAt || '') || 0;
    entries.push([id, session, sortTime]);
  }
  entries.sort((left, right) => right[2] - left[2]);
  return Object.fromEntries(
    entries.slice(0, MAX_SESSIONS).map(([id, session]) => [id, session])
  );
}

function normalizeRecentEvents(value, now = Date.now()) {
  const entries = [];
  for (const [rawKey, rawAt] of Object.entries(cloneObject(value))) {
    const key = safeOpaqueId(rawKey, '');
    const at = Number(rawAt);
    if (!key || !Number.isFinite(at) || at <= 0 || now - at >= EVENT_DEDUPE_TTL_MS) continue;
    entries.push([key, at]);
  }
  entries.sort((left, right) => right[1] - left[1]);
  return Object.fromEntries(entries.slice(0, MAX_RECENT_EVENTS));
}

function normalizeRecentIncrements(value, now = Date.now()) {
  const entries = [];
  for (const [rawKey, rawAt] of Object.entries(cloneObject(value))) {
    const key = safeOpaqueId(rawKey, '');
    const at = Number(rawAt);
    if (!key || !Number.isFinite(at) || at <= 0 || now - at >= DEDUPE_MS) continue;
    entries.push([key, at]);
  }
  entries.sort((left, right) => right[1] - left[1]);
  return Object.fromEntries(entries.slice(0, MAX_RECENT_INCREMENTS));
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
  const byDate = normalizeDateCounts(data.byDate);
  const byModel = normalizeModelCounts(byDate, data.byModel);
  const byProviderModel = normalizeProviderModelData(
    byDate,
    byModel,
    cloneObject(data.byProviderModel)
  );
  const sessions = normalizeSessions(data.sessions);

  return {
    byDate,
    byModel,
    byProviderModel,
    byHour: normalizeHourCounts(data.byHour),
    sessions,
    total: sumCounts(byDate),
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    lastCountedAt: data.lastCountedAt || null,
    lastCountReason: data.lastCountReason ? safeString(data.lastCountReason) : null,
    lastCountSite: data.lastCountSite ? siteForDiagnostics(data.lastCountSite) : null,
    lastCountModel: data.lastCountModel ? normalizeModelName(data.lastCountModel) : null,
    lastCountSessionId: data.lastCountSessionId
      ? safeOpaqueId(data.lastCountSessionId)
      : null,
    lastSeenAt: data.lastSeenAt || null,
    lastSeenSite: data.lastSeenSite ? siteForDiagnostics(data.lastSeenSite) : null,
    extensionVersion: extensionVersion() || data.extensionVersion || null,
    showPageCounter: data.showPageCounter !== false,
    lastIncrementKey: data.lastIncrementKey ? safeOpaqueId(data.lastIncrementKey) : null,
    lastIncrementAt: Number(data.lastIncrementAt || 0),
    recentIncrements: normalizeRecentIncrements({
      ...cloneObject(data.recentIncrements),
      ...(data.lastIncrementKey ? { [data.lastIncrementKey]: data.lastIncrementAt } : {}),
    }),
    recentEvents: normalizeRecentEvents(data.recentEvents),
  };
}

function countDiagnostics({ countedAt, reason, site, model, sessionId }) {
  const normalizedSite = siteForDiagnostics(site);
  return {
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    lastCountedAt: countedAt,
    lastCountReason: safeString(reason),
    lastCountSite: normalizedSite,
    lastCountModel: safeString(model),
    lastCountSessionId: safeString(sessionId),
    lastSeenAt: countedAt,
    lastSeenSite: normalizedSite,
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

async function importUsageDelta(imported = {}) {
  const current = await getCounts();
  const merged = mergeUsageData(current, imported);
  const data = normalizeStoredData({
    ...current,
    ...merged,
    extensionVersion: extensionVersion(),
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
  reason = 'unknown',
  eventId = null
) {
  const normalizedSite = siteForDiagnostics(site);
  const provider = providerForHost(normalizedSite);
  const normalizedModel = normalizeModelName(model);
  const normalizedSessionId = safeOpaqueId(sessionId, `${provider}:default`);
  const normalizedEventId = eventId ? safeOpaqueId(eventId, '') : '';
  const stableEventKey = normalizedEventId
    ? `${provider}:${normalizedEventId}`
    : '';
  const dedupe = dedupeRecord(normalizedSite, normalizedSessionId, dedupeKey);
  const data = await getCounts();
  const recentEvents = normalizeRecentEvents(data.recentEvents, dedupe.now);
  const recentIncrements = normalizeRecentIncrements(data.recentIncrements, dedupe.now);

  if (stableEventKey) {
    if (recentEvents[stableEventKey]) return false;
    recentEvents[stableEventKey] = dedupe.now;
  } else {
    if (recentIncrements[dedupe.key]) {
      if (
        provider === 'chatgpt' &&
        reason === 'chatgpt-network' &&
        normalizedModel !== 'unknown' &&
        data.lastIncrementKey === dedupe.key &&
        data.lastCountReason === 'chatgpt-dom-fallback' &&
        data.lastCountModel !== normalizedModel &&
        data.lastCountSessionId === normalizedSessionId
      ) {
        const day = todayKey();
        const previousModel = normalizeModelName(data.lastCountModel);
        const previousCount = data.byModel[day]?.[previousModel] || 0;
        const providerPreviousCount = data.byProviderModel[day]?.chatgpt?.[previousModel] || 0;
        if (previousCount > 0 && providerPreviousCount > 0) {
          if (previousCount === 1) delete data.byModel[day][previousModel];
          else data.byModel[day][previousModel] = previousCount - 1;
          data.byModel[day][normalizedModel] = (data.byModel[day][normalizedModel] || 0) + 1;

          if (providerPreviousCount === 1) {
            delete data.byProviderModel[day].chatgpt[previousModel];
          } else {
            data.byProviderModel[day].chatgpt[previousModel] = providerPreviousCount - 1;
          }
          data.byProviderModel[day].chatgpt[normalizedModel] = (
            data.byProviderModel[day].chatgpt[normalizedModel] || 0
          ) + 1;

          const session = data.sessions[normalizedSessionId];
          if (session) session.lastModel = normalizedModel;
          await setCounts({
            byModel: data.byModel,
            byProviderModel: data.byProviderModel,
            sessions: data.sessions,
            lastCountReason: 'chatgpt-network-upgrade',
            lastCountModel: normalizedModel,
          });
        }
      }
      return false;
    }
    recentIncrements[dedupe.key] = dedupe.now;
  }

  const { byDate, byModel, byProviderModel, byHour, sessions, total } = data;
  const day = todayKey();
  const hour = hourKey();
  const countedAt = new Date().toISOString();

  byDate[day] = (byDate[day] || 0) + 1;
  byHour[hour] = (byHour[hour] || 0) + 1;

  if (!byModel[day]) byModel[day] = {};
  byModel[day][normalizedModel] = (byModel[day][normalizedModel] || 0) + 1;

  if (!byProviderModel[day]) byProviderModel[day] = {};
  if (!byProviderModel[day][provider]) byProviderModel[day][provider] = {};
  byProviderModel[day][provider][normalizedModel] = (
    byProviderModel[day][provider][normalizedModel] || 0
  ) + 1;

  if (!sessions[normalizedSessionId]) {
    sessions[normalizedSessionId] = {
      prompts: 0,
      site: normalizedSite,
      startedAt: countedAt,
    };
  }
  sessions[normalizedSessionId].prompts = (sessions[normalizedSessionId].prompts || 0) + 1;
  sessions[normalizedSessionId].site = normalizedSite;
  sessions[normalizedSessionId].lastModel = normalizedModel;
  sessions[normalizedSessionId].lastSeenAt = countedAt;

  const newTotal = (total || 0) + 1;
  await setCounts({
    byDate,
    byModel,
    byProviderModel,
    byHour,
    sessions: normalizeSessions(sessions),
    total: newTotal,
    ...(stableEventKey
      ? { recentEvents: normalizeRecentEvents(recentEvents, dedupe.now) }
      : {
        lastIncrementKey: dedupe.key,
        lastIncrementAt: dedupe.now,
        recentIncrements: normalizeRecentIncrements(recentIncrements, dedupe.now),
      }),
    ...countDiagnostics({
      countedAt,
      reason,
      site: normalizedSite,
      model: normalizedModel,
      sessionId: normalizedSessionId,
    }),
  });
  setBadgeCount(byDate[day]);
  return true;
}

function increment(...args) {
  return enqueueMutation(() => incrementNow(...args));
}

function enqueueMutation(operation) {
  incrementQueue = incrementQueue.then(
    operation,
    operation
  );
  return incrementQueue;
}

function clearedCountDiagnostics() {
  return {
    lastCountedAt: null,
    lastCountReason: null,
    lastCountSite: null,
    lastCountModel: null,
    lastCountSessionId: null,
    lastIncrementKey: null,
    lastIncrementAt: 0,
    recentIncrements: {},
    recentEvents: {},
  };
}

async function resetTodayData() {
  const data = await getCounts();
  const day = todayKey();
  delete data.byDate[day];
  delete data.byModel[day];
  delete data.byProviderModel[day];
  for (const hour of Object.keys(data.byHour)) {
    if (hour.startsWith(`${day}-`)) delete data.byHour[hour];
  }

  data.sessions = {};
  data.total = sumCounts(data.byDate);
  Object.assign(data, clearedCountDiagnostics());
  await setCounts(data);
  setBadgeCount(0);
  return { total: data.total, storageSchemaVersion: STORAGE_SCHEMA_VERSION };
}

async function resetAllData() {
  const current = await getCounts();
  const data = {
    ...STORAGE_DEFAULTS,
    extensionVersion: extensionVersion(),
    showPageCounter: current.showPageCounter !== false,
    ...clearedCountDiagnostics(),
  };
  await setCounts(data);
  setBadgeCount(0);
  return { total: 0, storageSchemaVersion: STORAGE_SCHEMA_VERSION };
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

async function migrateStoredData() {
  const data = await getCounts();
  await setCounts(data);
  return data;
}

async function hasOptionalGrokAccess() {
  if (!chrome.permissions?.contains) return false;
  return chrome.permissions.contains({ origins: [GROK_ORIGIN] });
}

async function syncOptionalGrokContentScripts() {
  const enabled = await hasOptionalGrokAccess();
  if (!chrome.scripting?.getRegisteredContentScripts) {
    if (enabled) {
      throw new Error('This Chrome version cannot configure optional Grok counting.');
    }
    return { enabled: false };
  }

  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [...GROK_CONTENT_SCRIPT_IDS],
  });
  const registeredIds = new Set((registered || []).map((entry) => entry.id));
  const complete = GROK_CONTENT_SCRIPT_IDS.every((id) => registeredIds.has(id));

  if (!enabled || !complete) {
    const existingIds = GROK_CONTENT_SCRIPT_IDS.filter((id) => registeredIds.has(id));
    if (existingIds.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existingIds });
    }
  }

  if (enabled && !complete) {
    await chrome.scripting.registerContentScripts(
      GROK_CONTENT_SCRIPTS.map((script) => ({
        ...script,
        matches: [...script.matches],
        js: [...script.js],
      }))
    );
  }

  return { enabled };
}

function enqueueOptionalGrokSync() {
  grokSyncQueue = grokSyncQueue.then(
    syncOptionalGrokContentScripts,
    syncOptionalGrokContentScripts
  );
  return grokSyncQueue;
}

function reconcileOptionalGrokAccess() {
  enqueueOptionalGrokSync().catch(() => {});
}

// Initialize badge on install/activate
chrome.runtime.onInstalled.addListener(async () => {
  ensureDefaultSettings();
  scheduleBadgeRefresh();
  reconcileOptionalGrokAccess();
  const data = await enqueueMutation(migrateStoredData);
  setBadgeCount(data.byDate[todayKey()]);
});
chrome.runtime.onStartup.addListener(async () => {
  scheduleBadgeRefresh();
  reconcileOptionalGrokAccess();
  const data = await enqueueMutation(migrateStoredData);
  setBadgeCount(data.byDate[todayKey()]);
});

chrome.permissions?.onAdded?.addListener?.(reconcileOptionalGrokAccess);
chrome.permissions?.onRemoved?.addListener?.(reconcileOptionalGrokAccess);

chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm.name !== BADGE_REFRESH_ALARM) return;
  enqueueMutation(migrateStoredData).then((data) => {
    setBadgeCount(data.byDate[todayKey()]);
  });
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local' || !changes.byDate) return;
  setBadgeCount((changes.byDate.newValue || {})[todayKey()]);
});

function parseJsonFromRequestBody(details) {
  const segments = (details.requestBody?.raw || [])
    .map(part => part?.bytes)
    .filter(Boolean)
    .map(bytes => new Uint8Array(bytes));
  if (!segments.length) return null;
  try {
    const byteLength = segments.reduce((total, segment) => total + segment.byteLength, 0);
    const combined = new Uint8Array(byteLength);
    let offset = 0;
    for (const segment of segments) {
      combined.set(segment, offset);
      offset += segment.byteLength;
    }
    const text = new TextDecoder().decode(combined);
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function isChatGptRequest(details = {}) {
  if (String(details.method || '').toUpperCase() !== 'POST') return false;
  try {
    const url = new URL(details.url);
    const host = url.hostname.toLowerCase();
    return (
      (host === 'chatgpt.com' || host === 'chat.openai.com') &&
      isChatGptPromptEndpoint(url.href) &&
      /^\/backend-api\/(?:[^/]+\/)?(?:conversation|responses)\/?$/.test(url.pathname)
    );
  } catch (_) {
    return false;
  }
}

function modelFromChatGptPayload(payload = {}) {
  const candidates = [
    payload.model,
    payload.model_slug,
    payload.model_id,
    payload.metadata?.model,
    payload.conversation_mode?.model,
  ];
  return candidates.find(value => typeof value === 'string' && value.trim()) || 'unknown';
}

function siteFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return 'chatgpt.com';
  }
}

function supportedSenderContext(sender = {}) {
  const url = sender.tab?.url;
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const entry = siteConfigForHost(host);
    if (!entry) return null;
    return {
      host,
      provider: entry.config.provider,
      tabId: sender.tab.id,
    };
  } catch (_) {
    return null;
  }
}

// Listen for tick messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === "tick") {
    const context = supportedSenderContext(sender);
    if (!context) return;
    const fallbackSessionId = `${context.provider}:tab-${context.tabId ?? 'unknown'}`;
    const sessionId = context.provider === 'chatgpt'
      ? fallbackSessionId
      : safeOpaqueId(message.sessionId, fallbackSessionId);
    const usesStablePageEvents = context.provider !== 'chatgpt';
    const eventId = usesStablePageEvents ? safeOpaqueId(message.eventId, '') : null;
    const dedupeKey = eventId || (
      context.provider === 'chatgpt' ? sessionId : `tab-${context.tabId ?? sessionId}`
    );
    const countPrompt = () => increment(
      message.model || 'unknown',
      context.host,
      sessionId,
      dedupeKey,
      message.reason || 'content-tick',
      eventId
    );
    const operation = context.provider === 'grok'
      ? hasOptionalGrokAccess().then(enabled => enabled ? countPrompt() : false)
      : countPrompt();
    return sendAsyncResponse(
      sendResponse,
      operation.then(counted => ({ ok: true, counted }))
    );
  }

  if (message.type === 'getStatus') {
    return sendAsyncResponse(
      sendResponse,
      getCounts().then(data => ({ ok: true, status: buildStatus(data) }))
    );
  }

  if (message.type === 'syncGrokAccess') {
    if (!canManageStoredData(sender)) {
      sendResponse({ ok: false, error: 'syncGrokAccess is only available from extension UI' });
      return;
    }
    return sendAsyncResponse(
      sendResponse,
      enqueueOptionalGrokSync().then(result => ({ ok: true, ...result }))
    );
  }

  if (message.type === 'exportData') {
    if (!canManageStoredData(sender)) {
      sendResponse({ ok: false, error: 'exportData is only available from extension UI' });
      return;
    }
    return sendAsyncResponse(
      sendResponse,
      getCounts().then(data => ({ ok: true, export: buildExportPayload(data) }))
    );
  }

  if (message.type === 'importData') {
    if (!canManageStoredData(sender)) {
      sendResponse({ ok: false, error: 'importData is only available from extension UI' });
      return;
    }
    return sendAsyncResponse(
      sendResponse,
      enqueueMutation(() => importData(message.payload ?? message.data))
        .then(result => ({ ok: true, import: result }))
    );
  }

  if (message.type === 'importUsage') {
    if (!canManageStoredData(sender)) {
      sendResponse({ ok: false, error: 'importUsage is only available from extension UI' });
      return;
    }
    return sendAsyncResponse(
      sendResponse,
      enqueueMutation(() => importUsageDelta(message.data))
        .then(result => ({ ok: true, import: result }))
    );
  }

  if (message.type === 'resetToday' || message.type === 'resetAll') {
    if (!canManageStoredData(sender)) {
      sendResponse({ ok: false, error: `${message.type} is only available from extension UI` });
      return;
    }
    const operation = message.type === 'resetToday' ? resetTodayData : resetAllData;
    return sendAsyncResponse(
      sendResponse,
      enqueueMutation(operation).then(result => ({ ok: true, reset: result }))
    );
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
    if (!isChatGptRequest(details)) return;
    const payload = parseJsonFromRequestBody(details);
    if (isUserSendPayload(payload)) {
      const sessionId = `chatgpt:tab-${details.tabId}`;
      increment(
        modelFromChatGptPayload(payload),
        siteFromUrl(details.url),
        sessionId,
        sessionId,
        'chatgpt-network'
      ).catch(() => {});
    }
  },
  { urls: urlFilters },
  ["requestBody"]
);
