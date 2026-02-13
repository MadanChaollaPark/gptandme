
// popup.js

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

document.addEventListener('DOMContentLoaded', () => {
  function updateDisplay() {
    chrome.storage.local.get({ byDate: {}, total: 0 }, (data) => {
      const today = data.byDate[todayKey()] || 0;
      const total = data.total || 0;
      document.getElementById('today').textContent = today;
      document.getElementById('total').textContent = total;
      renderHistory(data.byDate);
    });
  }

  function renderHistory(byDate) {
    const container = document.getElementById('history');
    const keys = Object.keys(byDate).sort().reverse();
    const today = todayKey();
    // Show past days only (today is already shown above)
    const pastDays = keys.filter(k => k !== today).slice(0, 7);
    if (pastDays.length === 0) {
      container.innerHTML = '';
      return;
    }
    let html = '<div class="history-title">Recent days</div>';
    for (const day of pastDays) {
      html += `<div class="history-row"><span>${day}</span><span>${byDate[day]}</span></div>`;
    }
    container.innerHTML = html;
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
