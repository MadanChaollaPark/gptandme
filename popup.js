
// popup.js

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Aggregate byHour into a 7×24 grid (day-of-week × hour-of-day)
function buildHeatmapGrid(byHour) {
  // grid[dow][hour] where dow: 0=Mon … 6=Sun
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const [key, count] of Object.entries(byHour)) {
    const parts = key.split('-');
    if (parts.length !== 4) continue;
    const dateStr = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const hour = parseInt(parts[3], 10);
    const date = new Date(dateStr + 'T00:00:00');
    const dow = (date.getDay() + 6) % 7; // Mon=0, Sun=6
    grid[dow][hour] += count;
  }
  return grid;
}

function getHeatmapColor(value, max) {
  if (value === 0) return '#ebedf0';
  const ratio = value / max;
  if (ratio <= 0.25) return '#9be9a8';
  if (ratio <= 0.50) return '#40c463';
  if (ratio <= 0.75) return '#30a14e';
  return '#216e39';
}

function renderHeatmap(byHour) {
  const container = document.getElementById('heatmap');
  const grid = buildHeatmapGrid(byHour);
  const allValues = grid.flat();
  const max = Math.max(...allValues, 1);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let html = '<div class="hm-grid">';

  // Header row: empty corner + hour labels
  html += '<div class="hm-corner"></div>';
  for (let h = 0; h < 24; h++) {
    const label = h % 6 === 0 ? `${h}` : '';
    html += `<div class="hm-hlabel">${label}</div>`;
  }

  // Data rows
  for (let dow = 0; dow < 7; dow++) {
    html += `<div class="hm-dlabel">${dayLabels[dow]}</div>`;
    for (let h = 0; h < 24; h++) {
      const v = grid[dow][h];
      const color = getHeatmapColor(v, max);
      html += `<div class="hm-cell" style="background:${color}" title="${dayLabels[dow]} ${String(h).padStart(2, '0')}:00 — ${v} prompt${v !== 1 ? 's' : ''}"></div>`;
    }
  }

  html += '</div>';

  // Legend
  html += '<div class="hm-legend">';
  html += '<span>Less</span>';
  for (const c of ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']) {
    html += `<div class="hm-cell" style="background:${c}"></div>`;
  }
  html += '<span>More</span>';
  html += '</div>';

  container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
  function updateDisplay() {
    chrome.storage.local.get({ byDate: {}, byHour: {}, total: 0, dailyGoal: 0 }, (data) => {
      const today = data.byDate[todayKey()] || 0;
      const total = data.total || 0;
      const goal = data.dailyGoal || 0;
      document.getElementById('today').textContent = today;
      document.getElementById('total').textContent = total;

      // Goal UI
      document.getElementById('goalInput').value = goal || '';
      const progressWrap = document.getElementById('progressWrap');
      if (goal > 0) {
        progressWrap.style.display = '';
        const pct = Math.min((today / goal) * 100, 100);
        const fill = document.getElementById('progressFill');
        fill.style.width = pct + '%';
        if (pct >= 100) fill.style.background = '#22c55e';
        else if (pct >= 75) fill.style.background = '#f59e0b';
        else fill.style.background = '#3b82f6';
        document.getElementById('progressLabel').textContent =
          `${today} / ${goal}` + (pct >= 100 ? ' — Goal reached!' : '');
      } else {
        progressWrap.style.display = 'none';
      }

      renderHeatmap(data.byHour || {});
    });
  }

  updateDisplay();

  // Listen for changes in storage and update the display
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.byDate || changes.total || changes.dailyGoal || changes.byHour)) {
      updateDisplay();
    }
  });

  // Save daily goal
  document.getElementById('goalSave').addEventListener('click', () => {
    const val = parseInt(document.getElementById('goalInput').value, 10) || 0;
    chrome.storage.local.set({ dailyGoal: Math.max(0, val) });
  });

  // Add reset functionality
  document.getElementById('resetToday').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {}, byHour: {}, total: 0 }, (data) => {
      const key = todayKey();
      const todayCount = data.byDate[key] || 0;
      const newByDate = { ...data.byDate };
      delete newByDate[key];
      // Also remove today's hourly entries
      const newByHour = { ...data.byHour };
      for (const hKey of Object.keys(newByHour)) {
        if (hKey.startsWith(key)) delete newByHour[hKey];
      }
      const newTotal = Math.max(0, (data.total || 0) - todayCount);
      chrome.storage.local.set({ byDate: newByDate, byHour: newByHour, total: newTotal });
    });
  });

  document.getElementById('resetAll').addEventListener('click', () => {
    chrome.storage.local.set({ byDate: {}, byHour: {}, total: 0 });
  });
});
