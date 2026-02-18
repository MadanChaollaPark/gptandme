
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

function getWeekTotal(byDate) {
  const now = new Date();
  const day = now.getDay();              // 0=Sun … 6=Sat
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7)); // roll back to Monday
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    sum += byDate[key] || 0;
  }
  return sum;
}

function getMonthTotal(byDate) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();          // 0-indexed
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let sum = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    sum += byDate[key] || 0;
  }
  return sum;
}

function getRecentDays(byDate, n) {
  const days = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(d);
    dt.setDate(d.getDate() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    days.push(byDate[key] || 0);
  }
  return days;
}

function drawSparkline(values) {
  const canvas = document.getElementById('sparkline');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const max = Math.max(...values, 1);
  const n = values.length;
  const barGap = 2;
  const barW = Math.max(1, (w - barGap * (n - 1)) / n);
  const radius = Math.min(barW / 2, 3);

  ctx.clearRect(0, 0, w, h);
  values.forEach((v, i) => {
    const barH = Math.max(2, (v / max) * (h - 4));
    const x = i * (barW + barGap);
    const y = h - barH;
    ctx.fillStyle = i === n - 1 ? '#222' : '#a0a0a0';
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + barW - radius, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
    ctx.lineTo(x + barW, y + barH);
    ctx.lineTo(x, y + barH);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  let chartDays = 7;

  function updateDisplay() {
    chrome.storage.local.get({ byDate: {}, total: 0 }, (data) => {
      const today = data.byDate[todayKey()] || 0;
      const total = data.total || 0;
      const streak = getStreak(data.byDate);
      document.getElementById('today').textContent = today;
      document.getElementById('week').textContent = getWeekTotal(data.byDate);
      document.getElementById('month').textContent = getMonthTotal(data.byDate);
      document.getElementById('total').textContent = total;
      document.getElementById('streak').textContent =
        streak > 0 ? `${streak} day${streak === 1 ? '' : 's'}` : '0 days';
      drawSparkline(getRecentDays(data.byDate, chartDays));
    });
  }

  updateDisplay();

  document.getElementById('btn7d').addEventListener('click', () => {
    chartDays = 7;
    document.getElementById('btn7d').classList.add('active');
    document.getElementById('btn30d').classList.remove('active');
    updateDisplay();
  });
  document.getElementById('btn30d').addEventListener('click', () => {
    chartDays = 30;
    document.getElementById('btn30d').classList.add('active');
    document.getElementById('btn7d').classList.remove('active');
    updateDisplay();
  });

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

  document.getElementById('downloadCsv').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {} }, (data) => {
      const rows = ['date,count'];
      Object.keys(data.byDate)
        .sort()
        .forEach((date) => rows.push(`${date},${data.byDate[date]}`));
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
