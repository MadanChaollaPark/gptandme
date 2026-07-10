(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.GptAndMeShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PRICING_PROFILE_VERSION = 'openai-api-2026-07-07';
  const DEFAULT_PROMPT_TOKEN_ESTIMATE = Object.freeze({
    input: 1000,
    output: 500,
  });
  const MODEL_TOKEN_PRICES_PER_1M = Object.freeze({
    'gpt-5.5-pro': { input: 30, output: 180 },
    'gpt-5.5': { input: 5, output: 30 },
    'gpt-5.4-pro': { input: 30, output: 180 },
    'gpt-5.4': { input: 2.5, output: 15 },
    'gpt-5.4-mini': { input: 0.75, output: 4.5 },
    'gpt-5.4-nano': { input: 0.2, output: 1.25 },
    'gpt-5.3-codex': { input: 1.75, output: 14 },
    'gpt-5': { input: 1.25, output: 10 },
    'chat-latest': { input: 5, output: 30 },
  });
  const MODEL_ALIASES = Object.freeze({
    'gpt-5-5-pro': 'gpt-5.5-pro',
    'gpt-5-5': 'gpt-5.5',
    'gpt-5-4-pro': 'gpt-5.4-pro',
    'gpt-5-4-mini': 'gpt-5.4-mini',
    'gpt-5-4-nano': 'gpt-5.4-nano',
    'gpt-5-4': 'gpt-5.4',
    'gpt-5-3-codex': 'gpt-5.3-codex',
    'openai/gpt-5-5-pro': 'gpt-5.5-pro',
    'openai/gpt-5-5': 'gpt-5.5',
    'openai/gpt-5-4-pro': 'gpt-5.4-pro',
    'openai/gpt-5-4': 'gpt-5.4',
  });

  const PROVIDERS = Object.freeze({
    chatgpt: Object.freeze({ label: 'ChatGPT' }),
    claude: Object.freeze({ label: 'Claude' }),
    gemini: Object.freeze({ label: 'Gemini' }),
    perplexity: Object.freeze({ label: 'Perplexity' }),
    grok: Object.freeze({ label: 'Grok' }),
    unknown: Object.freeze({ label: 'Unknown' }),
  });
  const PROVIDER_ALIASES = Object.freeze({
    'chatgpt.com': 'chatgpt',
    'chat.openai.com': 'chatgpt',
    'claude.ai': 'claude',
    'gemini.google.com': 'gemini',
    'perplexity.ai': 'perplexity',
    'www.perplexity.ai': 'perplexity',
    'grok.com': 'grok',
  });
  const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const MAX_STORAGE_KEY_LENGTH = 160;

  function pricePerPromptFromTokenRates(rates = {}, estimate = DEFAULT_PROMPT_TOKEN_ESTIMATE) {
    const input = Number(rates.input || 0) * Number(estimate.input || 0);
    const output = Number(rates.output || 0) * Number(estimate.output || 0);
    return (input + output) / 1_000_000;
  }

  const PRICE_PER_PROMPT = Object.freeze(Object.fromEntries(
    Object.entries(MODEL_TOKEN_PRICES_PER_1M).map(([model, rates]) => [
      model,
      pricePerPromptFromTokenRates(rates),
    ])
  ));

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
      composerInputs: [
        '#prompt-textarea',
        '[data-testid="composer-input"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      countViaNetwork: true,
      domFallback: true,
      hosts: ['chatgpt.com'],
      provider: 'chatgpt',
    },
    'chat.openai.com': {
      sendButtons: CHATGPT_SEND_BUTTONS,
      composerInputs: [
        '#prompt-textarea',
        '[data-testid="composer-input"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      countViaNetwork: true,
      domFallback: true,
      hosts: ['chat.openai.com'],
      provider: 'chatgpt',
    },
    'claude.ai': {
      sendButtons: [
        'button[aria-label="Send message"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="Queue"]',
        'button[data-testid*="send"]',
        'button[type="submit"]',
      ],
      composerInputs: [
        '[data-testid="chat-input"]',
        '[aria-label="Write your prompt to Claude"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      countViaPageNetwork: true,
      domFallback: true,
      hosts: ['claude.ai'],
      provider: 'claude',
    },
    'gemini.google.com': {
      sendButtons: ['button[aria-label*="Send"]', 'button[aria-label*="Submit"]'],
      composerInputs: ['textarea', '[contenteditable="true"]'],
      hosts: ['gemini.google.com'],
      provider: 'gemini',
    },
    'www.perplexity.ai': {
      sendButtons: [
        'button[data-testid="submit-button"]',
        'button[aria-label="Submit"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="Send"]',
      ],
      composerInputs: [
        '#ask-input',
        '[data-lexical-editor="true"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      countViaPageNetwork: true,
      domFallback: true,
      hosts: ['www.perplexity.ai', 'perplexity.ai'],
      provider: 'perplexity',
    },
    'grok.com': {
      sendButtons: [
        'button[data-testid="chat-submit"]',
        'button[aria-label="Submit"][type="submit"]',
      ],
      composerInputs: [
        '[role="textbox"][contenteditable="true"][aria-label="Ask Grok anything"]',
      ],
      countViaPageNetwork: true,
      domFallback: true,
      hosts: ['grok.com'],
      provider: 'grok',
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

  function normalizeProviderId(provider = '') {
    const normalized = String(provider || '').trim().toLowerCase();
    if (Object.hasOwn(PROVIDERS, normalized)) return normalized;
    return Object.hasOwn(PROVIDER_ALIASES, normalized)
      ? PROVIDER_ALIASES[normalized]
      : 'unknown';
  }

  function providerForHost(hostname = '') {
    const entry = siteConfigForHost(hostname);
    return entry ? normalizeProviderId(entry.config.provider) : 'unknown';
  }

  function safeStorageKey(value, fallback = 'unknown') {
    const text = String(value ?? '').trim().slice(0, MAX_STORAGE_KEY_LENGTH);
    if (!text || UNSAFE_OBJECT_KEYS.has(text)) return fallback;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return fallback;
    return text;
  }

  function safeCount(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
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

  function normalizeModelName(model) {
    const raw = safeStorageKey(model).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:/+\-]{0,79}$/.test(raw)) return 'unknown';
    return MODEL_ALIASES[raw] || raw;
  }

  function displayModelName(model) {
    return normalizeModelName(model);
  }

  function priceForModel(model) {
    const normalized = normalizeModelName(model);
    const price = PRICE_PER_PROMPT[normalized];
    return Number.isFinite(price) ? price : null;
  }

  function estimateCostDetails(modelCounts = {}) {
    const details = {
      total: 0,
      pricedCount: 0,
      unpricedCount: 0,
      modelCount: 0,
      pricingProfileVersion: PRICING_PROFILE_VERSION,
      assumedInputTokens: DEFAULT_PROMPT_TOKEN_ESTIMATE.input,
      assumedOutputTokens: DEFAULT_PROMPT_TOKEN_ESTIMATE.output,
      models: {},
    };

    for (const [model, countValue] of Object.entries(modelCounts)) {
      const count = Number(countValue || 0);
      if (!Number.isFinite(count) || count <= 0) continue;

      const normalized = normalizeModelName(model);
      const price = priceForModel(normalized);
      const modelDetails = {
        count,
        normalizedModel: normalized,
        priced: price !== null,
        unitCost: price,
        cost: 0,
      };

      details.modelCount += count;
      if (price === null) {
        details.unpricedCount += count;
      } else {
        modelDetails.cost = count * price;
        details.total += modelDetails.cost;
        details.pricedCount += count;
      }

      details.models[model] = modelDetails;
    }

    return details;
  }

  function estimateCost(modelCounts = {}) {
    return estimateCostDetails(modelCounts).total;
  }

  function getModelCountsForDate(byDate = {}, byModel = {}, key = todayKey()) {
    const modelCounts = byModel[key] || {};
    const normalized = {};
    for (const [modelValue, countValue] of Object.entries(modelCounts)) {
      const count = safeCount(countValue);
      if (count <= 0) continue;
      const model = safeStorageKey(modelValue);
      normalized[model] = (normalized[model] || 0) + count;
    }

    const dayTotal = safeCount(byDate[key]);
    const modelTotal = Object.values(normalized).reduce((sum, count) => sum + count, 0);
    if (modelTotal > dayTotal) {
      return dayTotal > 0 ? { unknown: dayTotal } : {};
    }
    const unassigned = dayTotal - modelTotal;

    if (unassigned > 0) {
      normalized.unknown = (normalized.unknown || 0) + unassigned;
    }

    return normalized;
  }

  function providerModelFallback(modelCounts = {}) {
    const unknown = {};
    for (const [model, countValue] of Object.entries(modelCounts)) {
      const count = safeCount(countValue);
      if (count > 0) unknown[safeStorageKey(model)] = count;
    }
    return Object.keys(unknown).length ? { unknown } : {};
  }

  function normalizeProviderModelData(byDate = {}, byModel = {}, byProviderModel = {}) {
    const normalized = {};
    const dates = new Set([
      ...Object.keys(byDate || {}),
      ...Object.keys(byModel || {}),
      ...Object.keys(byProviderModel || {}),
    ]);

    for (const date of dates) {
      if (!parseDateKey(date)) continue;
      const targetModels = getModelCountsForDate(byDate, byModel, date);
      const targetTotal = Object.values(targetModels).reduce((sum, count) => sum + safeCount(count), 0);
      if (targetTotal <= 0) continue;

      const day = {};
      const modelTotals = {};
      let jointTotal = 0;
      let invalid = false;

      for (const [providerValue, models] of Object.entries(byProviderModel?.[date] || {})) {
        if (!models || typeof models !== 'object' || Array.isArray(models)) continue;
        if (UNSAFE_OBJECT_KEYS.has(String(providerValue).trim())) continue;
        const provider = normalizeProviderId(providerValue);

        for (const [modelValue, countValue] of Object.entries(models)) {
          const count = safeCount(countValue);
          if (count <= 0) continue;
          if (UNSAFE_OBJECT_KEYS.has(String(modelValue).trim())) continue;
          const model = safeStorageKey(modelValue);
          const nextModelTotal = (modelTotals[model] || 0) + count;

          if (nextModelTotal > safeCount(targetModels[model])) {
            invalid = true;
            break;
          }

          if (!day[provider]) day[provider] = {};
          day[provider][model] = (day[provider][model] || 0) + count;
          modelTotals[model] = nextModelTotal;
          jointTotal += count;
        }

        if (invalid) break;
      }

      if (invalid || jointTotal > targetTotal) {
        normalized[date] = providerModelFallback(targetModels);
        continue;
      }

      let remainderTotal = targetTotal - jointTotal;
      for (const [model, targetCountValue] of Object.entries(targetModels)) {
        if (remainderTotal <= 0) break;
        const remainder = Math.min(
          remainderTotal,
          safeCount(targetCountValue) - safeCount(modelTotals[model])
        );
        if (remainder <= 0) continue;
        if (!day.unknown) day.unknown = {};
        day.unknown[model] = (day.unknown[model] || 0) + remainder;
        remainderTotal -= remainder;
      }

      if (remainderTotal > 0) {
        if (!day.unknown) day.unknown = {};
        day.unknown.unknown = (day.unknown.unknown || 0) + remainderTotal;
      }

      normalized[date] = day;
    }

    return normalized;
  }

  function getProviderCountsForDate(byDate = {}, byProviderModel = {}, key = todayKey()) {
    const counts = Object.fromEntries(Object.keys(PROVIDERS).map((provider) => [provider, 0]));
    const total = safeCount(byDate[key]);
    let attributed = 0;

    for (const [providerValue, models] of Object.entries(byProviderModel?.[key] || {})) {
      const provider = normalizeProviderId(providerValue);
      if (!models || typeof models !== 'object' || Array.isArray(models)) continue;
      const providerTotal = Object.values(models).reduce((sum, count) => sum + safeCount(count), 0);
      counts[provider] += providerTotal;
      attributed += providerTotal;
    }

    if (attributed > total) {
      return { ...Object.fromEntries(Object.keys(PROVIDERS).map((provider) => [provider, 0])), unknown: total };
    }

    counts.unknown += total - attributed;
    return counts;
  }

  function getProviderTotals(byDate = {}, byProviderModel = {}) {
    const totals = Object.fromEntries(Object.keys(PROVIDERS).map((provider) => [provider, 0]));
    for (const date of Object.keys(byDate || {})) {
      const counts = getProviderCountsForDate(byDate, byProviderModel, date);
      for (const provider of Object.keys(PROVIDERS)) {
        totals[provider] += safeCount(counts[provider]);
      }
    }
    return totals;
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
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function buildUsageCsv(byDate = {}, byModel = {}, byProviderModel = {}) {
    const rows = ['date,provider,model,count'];
    const normalized = normalizeProviderModelData(byDate, byModel, byProviderModel);
    const dates = Object.keys(normalized).sort();
    for (const date of dates) {
      const providers = normalized[date] || {};
      for (const provider of Object.keys(providers).sort()) {
        for (const [model, countValue] of Object.entries(providers[provider] || {}).sort()) {
          const count = safeCount(countValue);
          if (count > 0) {
            rows.push(`${date},${provider},${csvEscape(model)},${count}`);
          }
        }
      }
    }
    return rows.join('\n');
  }

  function parseCsvRows(text = '') {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"' && cell === '') {
        quoted = true;
      } else if (char === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(cell.trim());
        if (row.some((value) => value.length > 0)) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }

    row.push(cell.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
    return rows;
  }

  function parseUsageCsv(text = '') {
    const errors = [];
    const byDate = {};
    const byModel = {};
    const byProviderModel = {};
    let runningTotal = 0;
    const source = String(text);
    if (source.length > 5 * 1024 * 1024) {
      return { byDate, byModel, byProviderModel, errors: ['CSV is too large'] };
    }
    const rows = parseCsvRows(source);

    if (rows.length === 0) {
      return { byDate, byModel, byProviderModel, errors: ['CSV is empty'] };
    }

    if (rows.length > 100001) {
      return { byDate, byModel, byProviderModel, errors: ['CSV has too many rows'] };
    }

    const header = rows[0].map((value) => value.toLowerCase());
    const dateIndex = header.indexOf('date');
    const providerIndex = Math.max(header.indexOf('provider'), header.indexOf('site'));
    const modelIndex = header.indexOf('model');
    const countIndex = header.indexOf('count');

    if (dateIndex === -1 || countIndex === -1) {
      return { byDate, byModel, byProviderModel, errors: ['CSV must include date and count columns'] };
    }

    for (let i = 1; i < rows.length; i += 1) {
      const rowNumber = i + 1;
      const cells = rows[i];
      const date = cells[dateIndex];
      const provider = providerIndex === -1
        ? 'unknown'
        : normalizeProviderId(cells[providerIndex]);
      const model = safeStorageKey(modelIndex === -1 ? 'unknown' : cells[modelIndex]);
      const count = Number(cells[countIndex]);

      if (!parseDateKey(date)) {
        errors.push(`Row ${rowNumber}: invalid date`);
        continue;
      }
      if (!Number.isSafeInteger(count) || count < 0) {
        errors.push(`Row ${rowNumber}: invalid count`);
        continue;
      }

      const nextDateCount = (Object.hasOwn(byDate, date) ? byDate[date] : 0) + count;
      const nextRunningTotal = runningTotal + count;
      if (!Number.isSafeInteger(nextDateCount) || !Number.isSafeInteger(nextRunningTotal)) {
        errors.push(`Row ${rowNumber}: invalid count`);
        continue;
      }

      byDate[date] = nextDateCount;
      runningTotal = nextRunningTotal;
      if (!byModel[date]) byModel[date] = {};
      byModel[date][model] = (Object.hasOwn(byModel[date], model) ? byModel[date][model] : 0) + count;
      if (!byProviderModel[date]) byProviderModel[date] = {};
      if (!byProviderModel[date][provider]) byProviderModel[date][provider] = {};
      byProviderModel[date][provider][model] = (
        Object.hasOwn(byProviderModel[date][provider], model)
          ? byProviderModel[date][provider][model]
          : 0
      ) + count;
    }

    return { byDate, byModel, byProviderModel, errors };
  }

  function sumCounts(byDate = {}) {
    return Object.values(byDate).reduce((sum, count) => sum + Number(count || 0), 0);
  }

  function mergeUsageData(current = {}, imported = {}) {
    const currentTotal = sumCounts(current.byDate || {});
    const importedTotal = sumCounts(imported.byDate || {});
    if (
      !Number.isSafeInteger(currentTotal) ||
      !Number.isSafeInteger(importedTotal) ||
      !Number.isSafeInteger(currentTotal + importedTotal)
    ) {
      throw new RangeError('Usage count exceeds the safe integer limit');
    }
    const byDate = { ...(current.byDate || {}) };
    const byModel = Object.fromEntries(
      Object.entries(current.byModel || {}).map(([date, models]) => [date, { ...(models || {}) }])
    );
    const currentJoint = normalizeProviderModelData(
      current.byDate,
      current.byModel,
      current.byProviderModel
    );
    const importedJoint = normalizeProviderModelData(
      imported.byDate,
      imported.byModel,
      imported.byProviderModel
    );
    const byProviderModel = Object.fromEntries(
      Object.entries(currentJoint).map(([date, providers]) => [
        date,
        Object.fromEntries(
          Object.entries(providers).map(([provider, models]) => [provider, { ...models }])
        ),
      ])
    );

    for (const [date, count] of Object.entries(imported.byDate || {})) {
      byDate[date] = Number(byDate[date] || 0) + Number(count || 0);
    }

    for (const [date, models] of Object.entries(imported.byModel || {})) {
      if (!byModel[date]) byModel[date] = {};
      for (const [model, count] of Object.entries(models || {})) {
        byModel[date][model] = Number(byModel[date][model] || 0) + Number(count || 0);
      }
    }

    for (const [date, providers] of Object.entries(importedJoint)) {
      if (!byProviderModel[date]) byProviderModel[date] = {};
      for (const [provider, models] of Object.entries(providers || {})) {
        if (!byProviderModel[date][provider]) byProviderModel[date][provider] = {};
        for (const [model, count] of Object.entries(models || {})) {
          byProviderModel[date][provider][model] = (
            Number(byProviderModel[date][provider][model] || 0) + Number(count || 0)
          );
        }
      }
    }

    return {
      byDate,
      byModel,
      byProviderModel: normalizeProviderModelData(byDate, byModel, byProviderModel),
      total: sumCounts(byDate),
    };
  }

  return {
    DEFAULT_PROMPT_TOKEN_ESTIMATE,
    MODEL_TOKEN_PRICES_PER_1M,
    PRICE_PER_PROMPT,
    PRICING_PROFILE_VERSION,
    PROVIDERS,
    SITES,
    buildHeatmapGrid,
    buildUsageCsv,
    csvEscape,
    displayModelName,
    estimateCost,
    estimateCostDetails,
    getHeatmapColor,
    getMonthTotal,
    getModelCountsForDate,
    getProviderCountsForDate,
    getProviderTotals,
    getRecentHours,
    getRecentDays,
    getSessionStats,
    getStreak,
    getWeekTotal,
    hourKey,
    isChatGptPromptEndpoint,
    isSupportedHost,
    isUserSendPayload,
    mergeUsageData,
    normalizeModelName,
    normalizeProviderId,
    normalizeProviderModelData,
    parseDateKey,
    parseUsageCsv,
    priceForModel,
    providerForHost,
    shouldCountKey,
    siteConfigForHost,
    sumCounts,
    todayKey,
  };
});
