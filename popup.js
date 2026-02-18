
// popup.js

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getStreak(byDate) {
  let streak = 0;
  const d = new Date();
  while (true) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    if (byDate[key] > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

document.addEventListener('DOMContentLoaded', () => {
  function updateDisplay() {
    chrome.storage.local.get({ byDate: {}, total: 0 }, (data) => {
      const today = data.byDate[todayKey()] || 0;
      const total = data.total || 0;
      const streak = getStreak(data.byDate);
      document.getElementById('today').textContent = today;
      document.getElementById('total').textContent = total;
      document.getElementById('streak').textContent =
        streak > 0 ? `${streak} day${streak === 1 ? '' : 's'}` : '0 days';
    });
  }

  updateDisplay();

  // Listen for changes in storage and update the display
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.byDate || changes.total)) {
      updateDisplay();
    }
  });

  // Add reset functionality
  document.getElementById('resetToday').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {}, total: 0 }, (data) => {
      const todayCount = data.byDate[todayKey()] || 0;
      const newByDate = { ...data.byDate };
      delete newByDate[todayKey()];
      const newTotal = Math.max(0, (data.total || 0) - todayCount);
      chrome.storage.local.set({ byDate: newByDate, total: newTotal });
    });
  });

  document.getElementById('resetAll').addEventListener('click', () => {
    chrome.storage.local.set({ byDate: {}, total: 0 });
  });
});
