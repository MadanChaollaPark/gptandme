// Utility: yyyy-mm-dd for per-day counts
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Utility: yyyy-mm-dd-hh for per-hour counts
function hourKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day}-${h}`;
}

async function getCounts() {
  return new Promise(resolve => {
    chrome.storage.local.get({ byDate: {}, byHour: {}, byModel: {}, total: 0, dailyGoal: 0, sessions: {}, currentSessionId: null }, resolve);
  });
}

async function setCounts(byDate, byHour, byModel, total) {
  return new Promise(resolve => {
    chrome.storage.local.set({ byDate, byHour, byModel, total }, resolve);
  });
}

// --- Icon with baked-in counter ---
// Cache the base icon bitmap so we only fetch it once
let baseIconBitmap = null;

async function loadBaseIcon() {
  if (baseIconBitmap) return baseIconBitmap;
  const resp = await fetch(chrome.runtime.getURL('icons/icon128.png'));
  const blob = await resp.blob();
  baseIconBitmap = await createImageBitmap(blob);
  return baseIconBitmap;
}

async function updateIcon(count, badgeColor = '#e04040') {
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Draw base icon
  const icon = await loadBaseIcon();
  ctx.drawImage(icon, 0, 0, size, size);

  const text = String(count);

  // Draw counter badge
  const fontSize = text.length >= 3 ? 44 : 52;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Badge pill background
  const metrics = ctx.measureText(text);
  const padX = 10;
  const padY = 6;
  const bw = metrics.width + padX * 2;
  const bh = fontSize + padY;
  const bx = size - bw / 2 - 2;
  const by = size - bh / 2 - 2;

  ctx.fillStyle = badgeColor;
  ctx.beginPath();
  ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, bh / 2);
  ctx.fill();

  // White text
  ctx.fillStyle = '#fff';
  ctx.fillText(text, bx, by + 1);

  const imageData = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon({ imageData: { 128: imageData } });
}

async function updateBadge(count) {
  const { dailyGoal } = await new Promise(r =>
    chrome.storage.local.get({ dailyGoal: 0 }, r));
  const goalReached = dailyGoal > 0 && count >= dailyGoal;
  const badgeColor = goalReached ? '#22c55e' : '#e04040';
  // Set native badge as fallback for standard toolbar
  chrome.action.setBadgeText({ text: String(count) });
  chrome.action.setBadgeBackgroundColor({ color: goalReached ? '#22c55e' : '#444' });
  // Draw count directly on the icon for layouts that hide badges
  await updateIcon(count, badgeColor);
}

// --- Session tracking ---
async function startSession(site, path) {
  const { sessions, currentSessionId } = await getCounts();
  // If we already have a session for this exact path, keep it
  if (currentSessionId && sessions[currentSessionId] && sessions[currentSessionId].path === path) {
    return;
  }
  const id = `s-${Date.now()}`;
  sessions[id] = { start: Date.now(), prompts: 0, site: site || '', path: path || '' };
  await new Promise(r => chrome.storage.local.set({ sessions, currentSessionId: id }, r));
}

async function incrementSession() {
  const { sessions, currentSessionId } = await getCounts();
  if (!currentSessionId || !sessions[currentSessionId]) return;
  sessions[currentSessionId].prompts += 1;
  await new Promise(r => chrome.storage.local.set({ sessions }, r));
}

async function checkNotification(todayCount) {
  const { notifyAt, notifiedDate } = await new Promise(r =>
    chrome.storage.local.get({ notifyAt: 0, notifiedDate: '' }, r));
  if (notifyAt > 0 && todayCount >= notifyAt && notifiedDate !== todayKey()) {
    chrome.storage.local.set({ notifiedDate: todayKey() });
    chrome.notifications.create('prompt-limit', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Prompt check-in',
      message: `You've sent ${todayCount} prompts today — time for a break?`,
    });
  }
}

async function increment(model = 'unknown') {
  const { byDate, byHour, byModel, total } = await getCounts();
  const dateKey = todayKey();
  const hKey = hourKey();
  byDate[dateKey] = (byDate[dateKey] || 0) + 1;
  byHour[hKey] = (byHour[hKey] || 0) + 1;
  if (!byModel[dateKey]) byModel[dateKey] = {};
  byModel[dateKey][model] = (byModel[dateKey][model] || 0) + 1;
  const newTotal = (total || 0) + 1;
  await setCounts(byDate, byHour, byModel, newTotal);
  await incrementSession();
  await updateBadge(byDate[dateKey]);
  await checkNotification(byDate[dateKey]);
}

// Initialize badge on install/activate
chrome.runtime.onInstalled.addListener(async () => {
  const { byDate } = await getCounts();
  chrome.action.setBadgeBackgroundColor({ color: "#444" });
  await updateBadge(byDate[todayKey()] || 0);
});
chrome.runtime.onStartup.addListener(async () => {
  const { byDate } = await getCounts();
  chrome.action.setBadgeBackgroundColor({ color: "#444" });
  await updateBadge(byDate[todayKey()] || 0);
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "tick") {
    increment(message.model || 'unknown');
  } else if (message.type === "new-session") {
    startSession(message.site, message.path);
  }
});

// Keep badge in sync if date flips while browser is open
setInterval(async () => {
  const { byDate } = await getCounts();
  await updateBadge(byDate[todayKey()] || 0);
}, 60 * 1000);
