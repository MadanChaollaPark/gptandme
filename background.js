importScripts('shared.js');

const { hourKey, isUserSendPayload, todayKey } = GptAndMeShared;
const DEDUPE_MS = 700;
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

function shouldDedupe(site, sessionId) {
  const now = Date.now();
  const key = `${site || 'unknown'}:${sessionId || 'unknown'}`;
  if (lastIncrement.key === key && now - lastIncrement.at < DEDUPE_MS) {
    return true;
  }
  lastIncrement = { key, at: now };
  return false;
}

async function increment(model = 'unknown', site = 'unknown', sessionId = 'default') {
  if (shouldDedupe(site, sessionId)) return;

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
  chrome.action.setBadgeText({ text: String(byDate[day]) });
}

// Initialize badge on install/activate
chrome.runtime.onInstalled.addListener(async () => {
  const { byDate } = await getCounts();
  chrome.action.setBadgeBackgroundColor({ color: "#444" });
  chrome.action.setBadgeText({ text: String(byDate[todayKey()] || 0) });
});
chrome.runtime.onStartup.addListener(async () => {
  const { byDate } = await getCounts();
  chrome.action.setBadgeBackgroundColor({ color: "#444" });
  chrome.action.setBadgeText({ text: String(byDate[todayKey()] || 0) });
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

// Listen for tick messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "tick") {
    const site = message.site || sender.tab?.url || 'unknown';
    const sessionId = message.sessionId || `tab-${sender.tab?.id ?? 'unknown'}`;
    increment(message.model || 'unknown', site, sessionId);
  }
});

// Observe outgoing requests to the ChatGPT web backend (backup method)
const urlFilters = [
  "*://chat.openai.com/backend-api/conversation*",
  "*://chatgpt.com/backend-api/conversation*"
];

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const payload = parseJsonFromRequestBody(details);
    if (isUserSendPayload(payload)) {
      increment(payload.model || 'unknown', 'chatgpt.com', `tab-${details.tabId}`);
    }
  },
  { urls: urlFilters },
  ["requestBody"]
);

// Keep badge in sync if date flips while browser is open
setInterval(async () => {
  const { byDate } = await getCounts();
  chrome.action.setBadgeText({ text: String(byDate[todayKey()] || 0) });
}, 60 * 1000);
