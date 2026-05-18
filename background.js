importScripts('shared.js');

const { hourKey, isChatGptPromptEndpoint, isUserSendPayload, todayKey } = GptAndMeShared;
const DEDUPE_MS = 2000;
const BADGE_BACKGROUND_COLOR = '#d1242f';
const BADGE_TEXT_COLOR = '#ffffff';
let lastIncrement = { key: null, at: 0 };

async function getCounts() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      { byDate: {}, byModel: {}, byHour: {}, sessions: {}, total: 0 },
      resolve
    );
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

function shouldDedupe(site, sessionId, dedupeKey = sessionId) {
  const now = Date.now();
  const key = `${site || 'unknown'}:${dedupeKey || sessionId || 'unknown'}`;
  if (lastIncrement.key === key && now - lastIncrement.at < DEDUPE_MS) {
    return true;
  }
  lastIncrement = { key, at: now };
  return false;
}

async function increment(model = 'unknown', site = 'unknown', sessionId = 'default', dedupeKey = sessionId) {
  if (shouldDedupe(site, sessionId, dedupeKey)) return;

  const { byDate, byModel, byHour, sessions, total } = await getCounts();
  const day = todayKey();
  const hour = hourKey();

  byDate[day] = (byDate[day] || 0) + 1;
  byHour[hour] = (byHour[hour] || 0) + 1;

  if (!byModel[day]) byModel[day] = {};
  byModel[day][model] = (byModel[day][model] || 0) + 1;

  if (!sessions[sessionId]) {
    sessions[sessionId] = { prompts: 0, site, startedAt: new Date().toISOString() };
  }
  sessions[sessionId].prompts = (sessions[sessionId].prompts || 0) + 1;
  sessions[sessionId].site = site;
  sessions[sessionId].lastModel = model;
  sessions[sessionId].lastSeenAt = new Date().toISOString();

  const newTotal = (total || 0) + 1;
  await setCounts({ byDate, byModel, byHour, sessions, total: newTotal });
  setBadgeCount(byDate[day]);
}

// Initialize badge on install/activate
chrome.runtime.onInstalled.addListener(async () => {
  const { byDate } = await getCounts();
  setBadgeCount(byDate[todayKey()]);
});
chrome.runtime.onStartup.addListener(async () => {
  const { byDate } = await getCounts();
  setBadgeCount(byDate[todayKey()]);
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
