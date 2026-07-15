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
  const THINKING_STORAGE_KEY = 'byThinkingProviderModel';
  const THINKING_DEDUPE_STORAGE_KEY = 'recentThinkingEvents';
  const THINKING_CONTRACT_VERSION = '1.5.0';
  const THINKING_MESSAGE_TYPE = 'thinkingMetric';
  const THINKING_SOURCE_PROVIDER_REPORTED = 'provider-reported';
  const THINKING_DURATION_MIN_MS = 1000;
  const THINKING_DURATION_MAX_MS = 6 * 60 * 60 * 1000;
  const THINKING_EVENT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_RECENT_THINKING_EVENTS = 500;
  const MAX_THINKING_EVENT_ID_LENGTH = 180;

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

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

  function normalizeThinkingDurationMs(value) {
    if (typeof value !== 'number') return null;
    const ms = Number(value);
    if (!Number.isSafeInteger(ms)) return null;
    if (ms < THINKING_DURATION_MIN_MS || ms > THINKING_DURATION_MAX_MS) return null;
    return ms;
  }

  function normalizeThinkingEventId(value) {
    const text = String(value ?? '').trim();
    if (!text || text.length > MAX_THINKING_EVENT_ID_LENGTH) return '';
    if (UNSAFE_OBJECT_KEYS.has(text)) return '';
    return /^[a-zA-Z0-9:._-]+$/.test(text) ? text : '';
  }

  function thinkingUnitRank(unit) {
    if (unit === 'hour' || unit === 'hours' || unit === 'h') return 0;
    if (unit === 'minute' || unit === 'minutes' || unit === 'm') return 1;
    if (unit === 'second' || unit === 'seconds' || unit === 's') return 2;
    return -1;
  }

  function thinkingUnitName(unit) {
    if (unit === 'hour' || unit === 'hours' || unit === 'h') return 'hours';
    if (unit === 'minute' || unit === 'minutes' || unit === 'm') return 'minutes';
    if (unit === 'second' || unit === 'seconds' || unit === 's') return 'seconds';
    return null;
  }

  function parseThinkingWordDuration(body) {
    const tokens = body.split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.length % 2 !== 0) return null;

    const parts = { hours: 0, minutes: 0, seconds: 0 };
    let lastRank = -1;
    for (let index = 0; index < tokens.length; index += 2) {
      if (!/^\d+$/.test(tokens[index])) return null;
      const amount = Number(tokens[index]);
      const unit = tokens[index + 1];
      const rank = thinkingUnitRank(unit);
      const name = thinkingUnitName(unit);
      if (!Number.isSafeInteger(amount) || amount <= 0 || rank === -1 || !name) return null;
      if (rank <= lastRank) return null;
      if (amount === 1 && unit.endsWith('s')) return null;
      if (amount !== 1 && !unit.endsWith('s')) return null;
      parts[name] = amount;
      lastRank = rank;
    }

    return parts;
  }

  function parseThinkingCompactDuration(body) {
    if (!/^\d+\s*[hms](?:\s+\d+\s*[hms])*$/.test(body)) return null;

    const parts = { hours: 0, minutes: 0, seconds: 0 };
    let lastRank = -1;
    for (const token of body.match(/\d+\s*[hms]/g) || []) {
      const match = /^(\d+)\s*([hms])$/.exec(token);
      if (!match) return null;
      const amount = Number(match[1]);
      const unit = match[2];
      const rank = thinkingUnitRank(unit);
      const name = thinkingUnitName(unit);
      if (!Number.isSafeInteger(amount) || amount <= 0 || rank === -1 || !name) return null;
      if (rank <= lastRank) return null;
      parts[name] = amount;
      lastRank = rank;
    }

    return parts;
  }

  function thinkingPartsToMs(parts) {
    if (!parts) return null;
    const hours = Number(parts.hours || 0);
    const minutes = Number(parts.minutes || 0);
    const seconds = Number(parts.seconds || 0);
    if (
      !Number.isSafeInteger(hours) ||
      !Number.isSafeInteger(minutes) ||
      !Number.isSafeInteger(seconds) ||
      hours < 0 ||
      minutes < 0 ||
      seconds < 0
    ) {
      return null;
    }
    if (hours > 0 && minutes >= 60) return null;
    if ((hours > 0 || minutes > 0) && seconds >= 60) return null;

    return normalizeThinkingDurationMs(
      (hours * 60 * 60 * 1000) +
      (minutes * 60 * 1000) +
      (seconds * 1000)
    );
  }

  function parseThinkingDurationMs(label) {
    if (typeof label !== 'string') return null;
    const text = label.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const match = /^(?:thought|reasoned) for (.+)$/.exec(text);
    if (!match) return null;
    const body = match[1];
    return thinkingPartsToMs(parseThinkingWordDuration(body) || parseThinkingCompactDuration(body));
  }

  function normalizeThinkingMetric(message = {}) {
    if (!isPlainObject(message)) return null;
    if (message.type !== THINKING_MESSAGE_TYPE) return null;
    if (message.source !== THINKING_SOURCE_PROVIDER_REPORTED) return null;

    const eventId = normalizeThinkingEventId(message.eventId);
    const thinkingMs = normalizeThinkingDurationMs(message.thinkingMs);
    if (!eventId || thinkingMs === null) return null;

    return {
      eventId,
      model: normalizeModelName(message.model),
      thinkingMs,
      source: THINKING_SOURCE_PROVIDER_REPORTED,
    };
  }

  function normalizeThinkingAggregateRecord(record) {
    if (!isPlainObject(record)) return null;
    const reportedCount = Number(record.reportedCount);
    const totalMs = Number(record.totalMs);
    if (!Number.isSafeInteger(reportedCount) || reportedCount <= 0) return null;
    if (!Number.isSafeInteger(totalMs) || totalMs <= 0) return null;

    const averageMs = totalMs / reportedCount;
    if (
      !Number.isFinite(averageMs) ||
      averageMs < THINKING_DURATION_MIN_MS ||
      averageMs > THINKING_DURATION_MAX_MS
    ) {
      return null;
    }

    return { reportedCount, totalMs };
  }

  function mergeThinkingAggregate(target, provider, model, record) {
    if (!target[provider]) target[provider] = {};
    const existing = target[provider][model] || { reportedCount: 0, totalMs: 0 };
    const reportedCount = existing.reportedCount + record.reportedCount;
    const totalMs = existing.totalMs + record.totalMs;
    if (!Number.isSafeInteger(reportedCount) || !Number.isSafeInteger(totalMs)) return;
    target[provider][model] = { reportedCount, totalMs };
  }

  function normalizeThinkingProviderModelData(byThinkingProviderModel = {}) {
    const normalized = {};
    if (!isPlainObject(byThinkingProviderModel)) return normalized;

    for (const [date, providers] of Object.entries(byThinkingProviderModel)) {
      if (!parseDateKey(date) || !isPlainObject(providers)) continue;
      const day = {};

      for (const [providerValue, models] of Object.entries(providers)) {
        if (!isPlainObject(models)) continue;
        if (UNSAFE_OBJECT_KEYS.has(String(providerValue).trim())) continue;
        const provider = normalizeProviderId(providerValue);

        for (const [modelValue, recordValue] of Object.entries(models)) {
          if (UNSAFE_OBJECT_KEYS.has(String(modelValue).trim())) continue;
          const record = normalizeThinkingAggregateRecord(recordValue);
          if (!record) continue;
          const model = normalizeModelName(modelValue);
          mergeThinkingAggregate(day, provider, model, record);
        }
      }

      if (Object.keys(day).length) normalized[date] = day;
    }

    return normalized;
  }

  function thinkingAverageMs(record) {
    const normalized = normalizeThinkingAggregateRecord(record);
    return normalized ? normalized.totalMs / normalized.reportedCount : null;
  }

  function formatThinkingDuration(ms, emptyLabel = '—') {
    const value = Number(ms);
    if (
      !Number.isFinite(value) ||
      value < THINKING_DURATION_MIN_MS ||
      value > THINKING_DURATION_MAX_MS
    ) {
      return emptyLabel;
    }

    const totalSeconds = value / 1000;
    if (totalSeconds < 60) {
      const rounded = Math.round(totalSeconds * 10) / 10;
      return `${String(rounded).replace(/\.0$/, '')}s`;
    }

    let remainingSeconds = Math.round(totalSeconds);
    const hours = Math.floor(remainingSeconds / 3600);
    remainingSeconds -= hours * 3600;
    const minutes = Math.floor(remainingSeconds / 60);
    remainingSeconds -= minutes * 60;

    const parts = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (remainingSeconds) parts.push(`${remainingSeconds}s`);
    return parts.join(' ') || emptyLabel;
  }

  function thinkingRecordWithAverage(record) {
    const normalized = normalizeThinkingAggregateRecord(record);
    if (!normalized) {
      return {
        reportedCount: 0,
        totalMs: 0,
        averageMs: null,
        averageLabel: formatThinkingDuration(null),
      };
    }
    const averageMs = normalized.totalMs / normalized.reportedCount;
    return {
      ...normalized,
      averageMs,
      averageLabel: formatThinkingDuration(averageMs),
    };
  }

  function getThinkingStatsForDate(byThinkingProviderModel = {}, key = todayKey()) {
    const normalized = normalizeThinkingProviderModelData(byThinkingProviderModel);
    const day = normalized[key] || {};
    const totalRecord = { reportedCount: 0, totalMs: 0 };
    const providers = {};

    for (const [provider, models] of Object.entries(day)) {
      const providerRecord = { reportedCount: 0, totalMs: 0 };
      const providerStats = { models: {} };

      for (const [model, record] of Object.entries(models || {})) {
        const modelStats = thinkingRecordWithAverage(record);
        if (modelStats.reportedCount <= 0) continue;
        const nextProviderCount = providerRecord.reportedCount + modelStats.reportedCount;
        const nextProviderTotalMs = providerRecord.totalMs + modelStats.totalMs;
        if (
          !Number.isSafeInteger(nextProviderCount) ||
          !Number.isSafeInteger(nextProviderTotalMs)
        ) {
          continue;
        }
        providerStats.models[model] = modelStats;
        providerRecord.reportedCount = nextProviderCount;
        providerRecord.totalMs = nextProviderTotalMs;
      }

      if (providerRecord.reportedCount <= 0) continue;
      const nextTotalCount = totalRecord.reportedCount + providerRecord.reportedCount;
      const nextTotalMs = totalRecord.totalMs + providerRecord.totalMs;
      if (!Number.isSafeInteger(nextTotalCount) || !Number.isSafeInteger(nextTotalMs)) {
        continue;
      }
      Object.assign(providerStats, thinkingRecordWithAverage(providerRecord));
      providers[provider] = providerStats;
      totalRecord.reportedCount = nextTotalCount;
      totalRecord.totalMs = nextTotalMs;
    }

    return {
      ...thinkingRecordWithAverage(totalRecord),
      providers,
    };
  }

  function normalizeRecentThinkingEvents(value = {}, now = Date.now()) {
    const entries = [];
    if (!isPlainObject(value)) return {};

    for (const [rawKey, rawAt] of Object.entries(value)) {
      const key = normalizeThinkingEventId(rawKey);
      const at = Number(rawAt);
      if (
        !key ||
        !Number.isFinite(at) ||
        at <= 0 ||
        now - at >= THINKING_EVENT_DEDUPE_TTL_MS
      ) {
        continue;
      }
      entries.push([key, at]);
    }

    entries.sort((left, right) => right[1] - left[1]);
    return Object.fromEntries(entries.slice(0, MAX_RECENT_THINKING_EVENTS));
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
    MAX_RECENT_THINKING_EVENTS,
    THINKING_DEDUPE_STORAGE_KEY,
    THINKING_CONTRACT_VERSION,
    THINKING_DURATION_MAX_MS,
    THINKING_DURATION_MIN_MS,
    THINKING_EVENT_DEDUPE_TTL_MS,
    THINKING_MESSAGE_TYPE,
    THINKING_SOURCE_PROVIDER_REPORTED,
    THINKING_STORAGE_KEY,
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
    getThinkingStatsForDate,
    getWeekTotal,
    hourKey,
    isChatGptPromptEndpoint,
    isSupportedHost,
    isUserSendPayload,
    mergeUsageData,
    normalizeModelName,
    normalizeRecentThinkingEvents,
    normalizeThinkingAggregateRecord,
    normalizeThinkingDurationMs,
    normalizeThinkingEventId,
    normalizeThinkingMetric,
    normalizeThinkingProviderModelData,
    normalizeProviderId,
    normalizeProviderModelData,
    parseDateKey,
    parseThinkingDurationMs,
    parseUsageCsv,
    priceForModel,
    providerForHost,
    shouldCountKey,
    siteConfigForHost,
    sumCounts,
    thinkingAverageMs,
    formatThinkingDuration,
    todayKey,
  };
});
