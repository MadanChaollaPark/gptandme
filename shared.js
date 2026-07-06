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
    '[data-testid="composer-send-button"]',
    '#composer-submit-button',
    'button[aria-label*="Send"]',
    'button[aria-label*="Submit"]',
    'button[data-testid*="send"]',
    'button[type="submit"]',
  ];

  const SITES = {
    'chatgpt.com': {
      sendButtons: CHATGPT_SEND_BUTTONS,
      countViaNetwork: true,
      domFallback: true,
      hosts: ['chatgpt.com'],
    },
    'chat.openai.com': {
      sendButtons: CHATGPT_SEND_BUTTONS,
      countViaNetwork: true,
      domFallback: true,
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

  function siteConfigForHost(hostname = '') {
    const normalized = String(hostname || '').toLowerCase();
    const entry = Object.entries(SITES).find(([, config]) =>
      (config.hosts || []).includes(normalized)
    );
    if (!entry) return null;
    return { name: entry[0], config: entry[1] };
  }

  function isSupportedHost(hostname = '') {
    return Boolean(siteConfigForHost(hostname));
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

  function textHasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function partHasUserInput(part) {
    if (textHasValue(part)) return true;
    if (!part || typeof part !== 'object') return false;

    if (textHasValue(part.text) || textHasValue(part.input_text)) return true;
    if (part.type === 'input_text' && textHasValue(part.text)) return true;

    const attachmentTypes = new Set([
      'file',
      'image',
      'input_file',
      'input_image',
    ]);
    if (attachmentTypes.has(part.type)) return true;
    if (part.asset_pointer || part.file_id || part.upload_id || part.image_url) return true;

    if ('content' in part) return contentHasUserInput(part.content);
    if (Array.isArray(part.parts)) return part.parts.some(partHasUserInput);

    return false;
  }

  function contentHasUserInput(content) {
    if (textHasValue(content)) return true;
    if (Array.isArray(content)) return content.some(partHasUserInput);
    if (!content || typeof content !== 'object') return false;

    if (textHasValue(content.text) || textHasValue(content.input_text)) return true;
    if (Array.isArray(content.parts)) return content.parts.some(partHasUserInput);
    if (Array.isArray(content.content)) return content.content.some(partHasUserInput);
    if ('content' in content) return contentHasUserInput(content.content);

    return partHasUserInput(content);
  }

  function messageHasUserInput(message) {
    if (!message || typeof message !== 'object') return false;
    const role = message.author?.role || message.role;
    if (role !== 'user') return false;

    if ('content' in message) return contentHasUserInput(message.content);
    if (Array.isArray(message.parts)) return message.parts.some(partHasUserInput);

    return false;
  }

  function inputHasUserInput(input) {
    if (textHasValue(input)) return true;
    if (Array.isArray(input)) {
      return input.some((item) => {
        if (textHasValue(item)) return true;
        if (item?.role || item?.author?.role) return messageHasUserInput(item);
        return partHasUserInput(item);
      });
    }
    if (!input || typeof input !== 'object') return false;
    if (input.role || input.author?.role) return messageHasUserInput(input);
    return partHasUserInput(input);
  }

  function isUserSendPayload(payload) {
    if (!payload) return false;
    if (payload.action && payload.action !== 'next') return false;

    const messages = Array.isArray(payload.messages)
      ? payload.messages
      : payload.message
        ? [payload.message]
        : [];

    if (messages.some(messageHasUserInput)) return true;
    if ('input' in payload) return inputHasUserInput(payload.input);

    return false;
  }

  function isChatGptPromptEndpoint(url) {
    try {
      const pathSegments = new URL(url).pathname.split('/').filter(Boolean);
      const backendIndex = pathSegments.indexOf('backend-api');
      if (backendIndex === -1) return false;
      const backendSegments = pathSegments.slice(backendIndex + 1);
      return backendSegments.includes('conversation') || backendSegments.includes('responses');
    } catch (_) {
      return false;
    }
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

  function getModelCountsForDate(byDate = {}, byModel = {}, key = todayKey()) {
    const modelCounts = byModel[key] || {};
    const normalized = Object.fromEntries(
      Object.entries(modelCounts).map(([model, count]) => [model, Number(count || 0)])
    );

    const dayTotal = Number(byDate[key] || 0);
    const modelTotal = Object.values(normalized).reduce((sum, count) => sum + count, 0);
    const unassigned = dayTotal - modelTotal;

    if (unassigned > 0) {
      normalized.unknown = (normalized.unknown || 0) + unassigned;
    }

    return normalized;
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

  function getRecentHours(byHour = {}, hours = 24, now = new Date()) {
    const values = [];
    for (let offset = hours - 1; offset >= 0; offset -= 1) {
      const date = new Date(now);
      date.setHours(now.getHours() - offset, 0, 0, 0);
      values.push(byHour[hourKey(date)] || 0);
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

  function csvEscape(value) {
    const text = String(value ?? '');
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function buildUsageCsv(byDate = {}, byModel = {}) {
    const rows = ['date,model,count'];
    const dates = [...new Set([...Object.keys(byDate), ...Object.keys(byModel)])].sort();
    for (const date of dates) {
      const models = getModelCountsForDate(byDate, byModel, date);
      if (Object.keys(models).length) {
        for (const [model, count] of Object.entries(models).sort()) {
          rows.push(`${date},${csvEscape(model)},${Number(count || 0)}`);
        }
      } else {
        rows.push(`${date},unknown,${Number(byDate[date] || 0)}`);
      }
    }
    return rows.join('\n');
  }

  function parseCsvLine(line) {
    const cells = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === ',') {
        cells.push(cell);
        cell = '';
      } else if (char === '"' && cell === '') {
        quoted = true;
      } else {
        cell += char;
      }
    }

    cells.push(cell);
    return cells.map((value) => value.trim());
  }

  function parseUsageCsv(text = '') {
    const errors = [];
    const byDate = {};
    const byModel = {};
    const lines = String(text).split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return { byDate, byModel, errors: ['CSV is empty'] };
    }

    const header = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
    const dateIndex = header.indexOf('date');
    const modelIndex = header.indexOf('model');
    const countIndex = header.indexOf('count');

    if (dateIndex === -1 || countIndex === -1) {
      return { byDate, byModel, errors: ['CSV must include date and count columns'] };
    }

    for (let i = 1; i < lines.length; i += 1) {
      const rowNumber = i + 1;
      const cells = parseCsvLine(lines[i]);
      const date = cells[dateIndex];
      const model = modelIndex === -1 ? 'unknown' : (cells[modelIndex] || 'unknown');
      const count = Number(cells[countIndex]);

      if (!parseDateKey(date)) {
        errors.push(`Row ${rowNumber}: invalid date`);
        continue;
      }
      if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
        errors.push(`Row ${rowNumber}: invalid count`);
        continue;
      }

      byDate[date] = (byDate[date] || 0) + count;
      if (!byModel[date]) byModel[date] = {};
      byModel[date][model] = (byModel[date][model] || 0) + count;
    }

    return { byDate, byModel, errors };
  }

  function sumCounts(byDate = {}) {
    return Object.values(byDate).reduce((sum, count) => sum + Number(count || 0), 0);
  }

  function mergeUsageData(current = {}, imported = {}) {
    const byDate = { ...(current.byDate || {}) };
    const byModel = { ...(current.byModel || {}) };

    for (const [date, count] of Object.entries(imported.byDate || {})) {
      byDate[date] = Number(byDate[date] || 0) + Number(count || 0);
    }

    for (const [date, models] of Object.entries(imported.byModel || {})) {
      if (!byModel[date]) byModel[date] = {};
      for (const [model, count] of Object.entries(models || {})) {
        byModel[date][model] = Number(byModel[date][model] || 0) + Number(count || 0);
      }
    }

    return { byDate, byModel, total: sumCounts(byDate) };
  }

  return {
    PRICE_PER_PROMPT,
    SITES,
    buildHeatmapGrid,
    buildUsageCsv,
    csvEscape,
    estimateCost,
    getHeatmapColor,
    getMonthTotal,
    getModelCountsForDate,
    getRecentDays,
    getSessionStats,
    getStreak,
    getWeekTotal,
    hourKey,
    isChatGptPromptEndpoint,
    isUserSendPayload,
    shouldCountKey,
    todayKey,
  };
});
