
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
    chrome.storage.local.get({ byDate: {}, byModel: {}, total: 0 }, (data) => {
      const today = data.byDate[todayKey()] || 0;
      const total = data.total || 0;
      document.getElementById('today').textContent = today;
      document.getElementById('total').textContent = total;

      // Model breakdown (today)
      const todayModels = data.byModel[todayKey()] || {};
      const modelSection = document.getElementById('modelSection');
      const modelDiv = document.getElementById('modelBreakdown');
      const models = Object.entries(todayModels).sort((a, b) => b[1] - a[1]);
      if (models.length > 0) {
        modelSection.style.display = '';
        modelDiv.innerHTML = models
          .map(([m, c]) => `<div class="row"><div>${m}</div><div>${c}</div></div>`)
          .join('');
      } else {
        modelSection.style.display = 'none';
      }
    });
  }

  updateDisplay();

  // Listen for changes in storage and update the display
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.byDate || changes.total || changes.byModel)) {
      updateDisplay();
    }
  });

  // Add reset functionality
  document.getElementById('resetToday').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {}, byModel: {}, total: 0 }, (data) => {
      const key = todayKey();
      const todayCount = data.byDate[key] || 0;
      const newByDate = { ...data.byDate };
      delete newByDate[key];
      const newByModel = { ...data.byModel };
      delete newByModel[key];
      const newTotal = Math.max(0, (data.total || 0) - todayCount);
      chrome.storage.local.set({ byDate: newByDate, byModel: newByModel, total: newTotal });
    });
  });

  document.getElementById('resetAll').addEventListener('click', () => {
    chrome.storage.local.set({ byDate: {}, byModel: {}, total: 0 });
  });

  // CSV export — date,model,count rows for billing/usage tracking
  document.getElementById('downloadCsv').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {}, byModel: {} }, (data) => {
      const rows = ['date,model,count'];
      const dates = [...new Set([...Object.keys(data.byDate), ...Object.keys(data.byModel)])].sort();
      for (const date of dates) {
        const models = data.byModel[date];
        if (models && Object.keys(models).length) {
          for (const [model, count] of Object.entries(models).sort()) {
            rows.push(`${date},${model},${count}`);
          }
        } else {
          // Older data without model info
          rows.push(`${date},unknown,${data.byDate[date] || 0}`);
        }
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gptandme-usage.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  });
});
