// Utility: yyyy-mm-dd for per-day counts
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getCounts() {
  return new Promise(resolve => {
    chrome.storage.local.get({ byDate: {}, byModel: {}, total: 0 }, resolve);
  });
}

async function setCounts(byDate, byModel, total) {
  return new Promise(resolve => {
    chrome.storage.local.set({ byDate, byModel, total }, resolve);
  });
}

async function increment(model = 'unknown') {
  const { byDate, byModel, total } = await getCounts();
  const key = todayKey();
  byDate[key] = (byDate[key] || 0) + 1;
  if (!byModel[key]) byModel[key] = {};
  byModel[key][model] = (byModel[key][model] || 0) + 1;
  const newTotal = (total || 0) + 1;
  await setCounts(byDate, byModel, newTotal);
  chrome.action.setBadgeText({ text: String(byDate[key]) });
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

// Decode requestBody raw bytes to JSON
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

// Heuristics: count only when a "user" message is being sent.
// Old ChatGPT UI hits /backend-api/conversation with {action:"next", messages:[{author.role:"user"}]}
// Newer payloads use messages:[{role:"user", content:[{type:"input_text", text:"..."}]}]
function isUserSendPayload(payload) {
  if (!payload) return false;

  // Typical "action": "next"
  if (payload.action && payload.action !== "next") return false;

  const msgs = payload.messages;
  if (!Array.isArray(msgs)) return false;

  // Count only if at least one user-authored message is present in THIS request.
  return msgs.some(m => {
    const role = m?.author?.role || m?.role;
    if (role !== "user") return false;
    // Guard against API-style requests that replay whole history.
    // Require some fresh user text in this message.
    const content = m?.content;
    if (typeof content === "string" && content.trim().length > 0) return true;
    if (Array.isArray(content)) {
      return content.some(part => {
        if (typeof part === "string") return part.trim().length > 0;
        if (part?.type === "input_text" && typeof part?.text === "string") {
          return part.text.trim().length > 0;
        }
        return false;
      });
    }
    // Some UIs send {parts:["..."]} inside content
    if (content?.parts && Array.isArray(content.parts)) {
      return content.parts.some(p => typeof p === "string" && p.trim().length > 0);
    }
    return false;
  });
}

// Listen for tick messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "tick") {
    increment(message.model || 'unknown');
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
      increment(payload.model || 'unknown');
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
