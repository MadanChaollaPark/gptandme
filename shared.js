(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.GptAndMeShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PRICE_PER_PROMPT = {
    unknown: 0.01,
    'gpt-4o': 0.02,
    'gpt-4o-mini': 0.002,
    'gpt-4.5': 0.05,
    'gpt-4': 0.03,
    o1: 0.04,
    'o1-mini': 0.01,
    o3: 0.04,
    'o3-mini': 0.01,
    'claude-sonnet': 0.03,
    'claude-opus': 0.08,
    'claude-haiku': 0.004,
    'gemini-flash': 0.002,
    'gemini-pro': 0.02,
  };

  const CHATGPT_SEND_BUTTONS = [
    '[data-testid="send-button"]',
    '#composer-submit-button',
    'button[aria-label*="Send"]',
  ];

  const SITES = {
    'chatgpt.com': {
      sendButtons: CHATGPT_SEND_BUTTONS,
      hosts: ['chatgpt.com'],
    },
    'chat.openai.com': {
      sendButtons: CHATGPT_SEND_BUTTONS,
      hosts: ['chat.openai.com'],
    },
    'claude.ai': {
      sendButtons: ['button[aria-label*="Send"]', 'button[data-testid*="send"]'],
      hosts: ['claude.ai'],
    },
    'gemini.google.com': {
      sendButtons: ['button[aria-label*="Send"]', 'button[aria-label*="Submit"]'],
      hosts: ['gemini.google.com'],
    },
    'www.perplexity.ai': {
      sendButtons: ['button[aria-label*="Submit"]', 'button[aria-label*="Send"]'],
      hosts: ['www.perplexity.ai', 'perplexity.ai'],
    },
  };

  function dateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function todayKey(date = new Date()) {
    return dateKey(date);
  }

  function hourKey(date = new Date()) {
    return `${dateKey(date)}-${String(date.getHours()).padStart(2, '0')}`;
  }

  function parseDateKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function isUserSendPayload(payload) {
    if (!payload) return false;
    if (payload.action && payload.action !== 'next') return false;

    const messages = payload.messages;
    if (!Array.isArray(messages)) return false;

    return messages.some((message) => {
      const role = message?.author?.role || message?.role;
      if (role !== 'user') return false;

      const content = message?.content;
      if (typeof content === 'string') return content.trim().length > 0;

      if (Array.isArray(content)) {
        return content.some((part) => {
          if (typeof part === 'string') return part.trim().length > 0;
          if (part?.type === 'input_text' && typeof part?.text === 'string') {
            return part.text.trim().length > 0;
          }
          return false;
        });
      }

      if (Array.isArray(content?.parts)) {
        return content.parts.some((part) => typeof part === 'string' && part.trim().length > 0);
      }

      return false;
    });
  }

  function shouldCountKey(event) {
    if (event.isComposing || event.altKey) return false;
    if (event.key !== 'Enter') return false;
    if (event.ctrlKey || event.metaKey) return true;
    return !event.shiftKey;
  }

  function estimateCost(modelCounts = {}) {
    return Object.entries(modelCounts).reduce((sum, [model, count]) => {
      const price = PRICE_PER_PROMPT[model] || PRICE_PER_PROMPT.unknown;
      return sum + Number(count || 0) * price;
    }, 0);
  }

  function getRecentDays(byDate = {}, days = 7, now = new Date()) {
    const values = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - offset);
      values.push(byDate[dateKey(date)] || 0);
    }
    return values;
  }

  function getStreak(byDate = {}, now = new Date()) {
    let streak = 0;
    const cursor = new Date(now);

    while ((byDate[dateKey(cursor)] || 0) > 0) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
  }

  function getWeekTotal(byDate = {}, now = new Date()) {
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));

    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);

    return Object.entries(byDate).reduce((sum, [key, count]) => {
      const date = parseDateKey(key);
      if (!date || date < monday || date >= nextMonday) return sum;
      return sum + Number(count || 0);
    }, 0);
  }

  function getMonthTotal(byDate = {}, now = new Date()) {
    const year = now.getFullYear();
    const month = now.getMonth();

    return Object.entries(byDate).reduce((sum, [key, count]) => {
      const date = parseDateKey(key);
      if (!date || date.getFullYear() !== year || date.getMonth() !== month) return sum;
      return sum + Number(count || 0);
    }, 0);
  }

  function getSessionStats(sessions = {}) {
    const promptCounts = Object.values(sessions)
      .map((session) => Number(session?.prompts || 0))
      .filter((count) => count > 0);

    if (promptCounts.length === 0) return { count: 0, avg: 0, max: 0 };

    const sum = promptCounts.reduce((total, count) => total + count, 0);
    return {
      count: promptCounts.length,
      avg: Math.round((sum / promptCounts.length) * 10) / 10,
      max: Math.max(...promptCounts),
    };
  }

  function buildHeatmapGrid(byHour = {}) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));

    for (const [key, count] of Object.entries(byHour)) {
      const match = /^(\d{4}-\d{2}-\d{2})-(\d{2})$/.exec(key);
      if (!match) continue;

      const date = parseDateKey(match[1]);
      const hour = Number(match[2]);
      if (!date || hour < 0 || hour > 23) continue;

      const mondayBasedDay = (date.getDay() + 6) % 7;
      grid[mondayBasedDay][hour] += Number(count || 0);
    }

    return grid;
  }

  function getHeatmapColor(value, max) {
    if (!value || !max) return '#ebedf0';
    const ratio = value / max;
    if (ratio <= 0.25) return '#9be9a8';
    if (ratio <= 0.5) return '#40c463';
    if (ratio <= 0.75) return '#30a14e';
    return '#216e39';
  }

  return {
    PRICE_PER_PROMPT,
    SITES,
    buildHeatmapGrid,
    estimateCost,
    getHeatmapColor,
    getMonthTotal,
    getRecentDays,
    getSessionStats,
    getStreak,
    getWeekTotal,
    hourKey,
    isUserSendPayload,
    shouldCountKey,
    todayKey,
  };
});
