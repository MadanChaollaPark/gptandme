// popup.js — todayKey() is provided by shared.js (loaded before this script)

document.addEventListener('DOMContentLoaded', () => {
  function updateDisplay() {
    chrome.storage.local.get({ byDate: {}, total: 0 }, (data) => {
      const today = data.byDate[todayKey()] || 0;
      const total = data.total || 0;
      document.getElementById('today').textContent = today;
      document.getElementById('total').textContent = total;
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
    chrome.storage.local.get({ byDate: {} }, (data) => {
      const newByDate = { ...data.byDate };
      delete newByDate[todayKey()];
      chrome.storage.local.set({ byDate: newByDate });
    });
  });

  document.getElementById('resetAll').addEventListener('click', () => {
    chrome.storage.local.set({ byDate: {}, total: 0 });
  });
});
