
// popup.js

const {
  estimateCost,
  getMonthTotal,
  getModelCountsForDate,
  getSessionStats,
  getStreak,
  getWeekTotal,
  todayKey,
} = GptAndMeShared;

function formatCost(cost) {
  return `$${cost.toFixed(cost < 1 ? 3 : 2)}`;
}

function csvEscape(value) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

document.addEventListener('DOMContentLoaded', () => {
  function updateDisplay() {
    chrome.storage.local.get(
      { byDate: {}, byModel: {}, byHour: {}, sessions: {}, total: 0 },
      (data) => {
      const todayDate = todayKey();
      const today = data.byDate[todayDate] || 0;
      const total = data.total || 0;
      document.getElementById('today').textContent = today;
      document.getElementById('week').textContent = getWeekTotal(data.byDate);
      document.getElementById('month').textContent = getMonthTotal(data.byDate);
      document.getElementById('streak').textContent = `${getStreak(data.byDate)} days`;
      document.getElementById('total').textContent = total;

      // Model breakdown (today)
      const todayModels = getModelCountsForDate(data.byDate, data.byModel, todayDate);
      const sessionStats = getSessionStats(data.sessions);
      const modelSection = document.getElementById('modelSection');
      const modelDiv = document.getElementById('modelBreakdown');
      const models = Object.entries(todayModels).sort((a, b) => b[1] - a[1]);
      document.getElementById('cost').textContent = formatCost(estimateCost(todayModels));
      document.getElementById('sessions').textContent =
        `${sessionStats.count} (${sessionStats.avg} avg, ${sessionStats.max} max)`;
      if (models.length > 0) {
        modelSection.style.display = '';
        modelDiv.replaceChildren();
        for (const [model, count] of models) {
          const row = document.createElement('div');
          row.className = 'row';

          const label = document.createElement('div');
          label.textContent = model;

          const value = document.createElement('div');
          value.className = 'value';
          value.textContent = count;

          row.append(label, value);
          modelDiv.append(row);
        }
      } else {
        modelSection.style.display = 'none';
        modelDiv.replaceChildren();
      }
    });
  }

  updateDisplay();

  // Listen for changes in storage and update the display
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (
      namespace === 'local' &&
      (changes.byDate || changes.total || changes.byModel || changes.byHour || changes.sessions)
    ) {
      updateDisplay();
    }
  });

  // Add reset functionality
  document.getElementById('resetToday').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {}, byModel: {}, byHour: {}, total: 0 }, (data) => {
      const key = todayKey();
      const todayCount = data.byDate[key] || 0;
      const newByDate = { ...data.byDate };
      delete newByDate[key];
      const newByModel = { ...data.byModel };
      delete newByModel[key];
      const newByHour = { ...data.byHour };
      for (const hour of Object.keys(newByHour)) {
        if (hour.startsWith(`${key}-`)) delete newByHour[hour];
      }
      const newTotal = Math.max(0, (data.total || 0) - todayCount);
      chrome.storage.local.set({
        byDate: newByDate,
        byModel: newByModel,
        byHour: newByHour,
        total: newTotal,
      });
    });
  });

  document.getElementById('resetAll').addEventListener('click', () => {
    chrome.storage.local.set({ byDate: {}, byModel: {}, byHour: {}, sessions: {}, total: 0 });
  });

  // CSV export — date,model,count rows for billing/usage tracking
  document.getElementById('downloadCsv').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {}, byModel: {} }, (data) => {
      const rows = ['date,model,count'];
      const dates = [...new Set([...Object.keys(data.byDate), ...Object.keys(data.byModel)])].sort();
      for (const date of dates) {
        const models = getModelCountsForDate(data.byDate, data.byModel, date);
        if (Object.keys(models).length) {
          for (const [model, count] of Object.entries(models).sort()) {
            rows.push(`${date},${csvEscape(model)},${count}`);
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
