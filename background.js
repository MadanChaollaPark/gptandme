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
    chrome.storage.sync.get({ byDate: {}, byHour: {}, total: 0, dailyGoal: 0 }, resolve);
  });
}

async function setCounts(byDate, byHour, total) {
  return new Promise(resolve => {
    chrome.storage.sync.set({ byDate, byHour, total }, resolve);
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
    chrome.storage.sync.get({ dailyGoal: 0 }, r));
  const goalReached = dailyGoal > 0 && count >= dailyGoal;
  const badgeColor = goalReached ? '#22c55e' : '#e04040';
  // Set native badge as fallback for standard toolbar
  chrome.action.setBadgeText({ text: String(count) });
  chrome.action.setBadgeBackgroundColor({ color: goalReached ? '#22c55e' : '#444' });
  // Draw count directly on the icon for layouts that hide badges
  await updateIcon(count, badgeColor);
}

async function increment() {
  const { byDate, byHour, total } = await getCounts();
  const dateKey = todayKey();
  const hKey = hourKey();
  byDate[dateKey] = (byDate[dateKey] || 0) + 1;
  byHour[hKey] = (byHour[hKey] || 0) + 1;
  const newTotal = (total || 0) + 1;
  await setCounts(byDate, byHour, newTotal);
  await updateBadge(byDate[dateKey]);
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

// Listen for tick messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "tick") {
    increment();
  }
});

// Keep badge in sync if date flips while browser is open
setInterval(async () => {
  const { byDate } = await getCounts();
  await updateBadge(byDate[todayKey()] || 0);
}, 60 * 1000);
