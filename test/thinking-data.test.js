const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const shared = require('../shared');

const {
  MAX_RECENT_THINKING_EVENTS,
  THINKING_CONTRACT_VERSION,
  THINKING_DEDUPE_STORAGE_KEY,
  THINKING_DURATION_MAX_MS,
  THINKING_DURATION_MIN_MS,
  THINKING_EVENT_DEDUPE_TTL_MS,
  THINKING_MESSAGE_TYPE,
  THINKING_SOURCE_PROVIDER_REPORTED,
  THINKING_STORAGE_KEY,
  formatThinkingDuration,
  getThinkingStatsForDate,
  normalizeRecentThinkingEvents,
  normalizeThinkingAggregateRecord,
  normalizeThinkingDurationMs,
  normalizeThinkingEventId,
  normalizeThinkingMetric,
  normalizeThinkingProviderModelData,
  parseThinkingDurationMs,
  thinkingAverageMs,
} = shared;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoDangerousOwnKeys(value, path = 'root') {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    assert.equal(
      DANGEROUS_KEYS.has(key),
      false,
      `${path} must not contain dangerous own key ${key}`
    );
    assertNoDangerousOwnKeys(value[key], `${path}.${key}`);
  }
}

describe('thinking storage contract constants', () => {
  it('exports the v3 thinking storage, dedupe, message, source, and range contract', () => {
    assert.equal(THINKING_STORAGE_KEY, 'byThinkingProviderModel');
    assert.equal(THINKING_DEDUPE_STORAGE_KEY, 'recentThinkingEvents');
    assert.equal(THINKING_CONTRACT_VERSION, '1.5.0');
    assert.equal(THINKING_MESSAGE_TYPE, 'thinkingMetric');
    assert.equal(THINKING_SOURCE_PROVIDER_REPORTED, 'provider-reported');
    assert.equal(THINKING_DURATION_MIN_MS, 1000);
    assert.equal(THINKING_DURATION_MAX_MS, 6 * 60 * 60 * 1000);
    assert.equal(THINKING_EVENT_DEDUPE_TTL_MS, 24 * 60 * 60 * 1000);
    assert.equal(MAX_RECENT_THINKING_EVENTS, 500);
  });
});

describe('strict provider-reported thinking duration parsing', () => {
  it('parses finalized ChatGPT-style labels with numeric word units', () => {
    const cases = [
      ['Thought for 1 second', 1000],
      ['Thought for 2 seconds', 2000],
      ['Reasoned for 1 minute 2 seconds', 62_000],
      ['Thought for 1 hour 2 minutes 3 seconds', 3_723_000],
      ['  Thought\u00a0for   6 hours  ', THINKING_DURATION_MAX_MS],
    ];

    for (const [label, expected] of cases) {
      assert.equal(parseThinkingDurationMs(label), expected, label);
    }
  });

  it('parses finalized compact labels without accepting arbitrary text', () => {
    const cases = [
      ['Thought for 1s', 1000],
      ['Thought for 1m 5s', 65_000],
      ['Reasoned for 2h 3m 4s', 7_384_000],
    ];

    for (const [label, expected] of cases) {
      assert.equal(parseThinkingDurationMs(label), expected, label);
    }
  });

  it('rejects live, inferred, malformed, and out-of-range labels', () => {
    for (const label of [
      'Thinking for 5 seconds',
      '5 seconds',
      'The answer thought for 5 seconds',
      'Thought for about 5 seconds',
      'Thought for 0 seconds',
      'Thought for 999 milliseconds',
      'Thought for 1.5 seconds',
      'Thought for 1 seconds',
      'Thought for 2 second',
      'Thought for 1 minute 60 seconds',
      'Thought for 6 hours 1 second',
      '',
      null,
      undefined,
    ]) {
      assert.equal(parseThinkingDurationMs(label), null, String(label));
    }
  });

  it('normalizes only integer millisecond values in the valid range', () => {
    assert.equal(normalizeThinkingDurationMs(THINKING_DURATION_MIN_MS), 1000);
    assert.equal(normalizeThinkingDurationMs(THINKING_DURATION_MAX_MS), THINKING_DURATION_MAX_MS);

    for (const value of [
      0,
      999,
      THINKING_DURATION_MAX_MS + 1,
      1000.5,
      Number.NaN,
      Infinity,
      '1000',
      null,
    ]) {
      assert.equal(normalizeThinkingDurationMs(value), null, String(value));
    }
  });
});

describe('thinkingMetric runtime message normalization', () => {
  it('keeps only the frozen runtime payload fields and never trusts provider', () => {
    const normalized = normalizeThinkingMetric({
      type: THINKING_MESSAGE_TYPE,
      eventId: 'chatgpt:response-1',
      model: 'gpt-5-5',
      thinkingMs: 1500,
      source: THINKING_SOURCE_PROVIDER_REPORTED,
      provider: 'claude',
      rawLabel: 'Thought for 1.5 seconds',
      rawSample: 'private response text',
    });

    assert.deepEqual(normalized, {
      eventId: 'chatgpt:response-1',
      model: 'gpt-5.5',
      thinkingMs: 1500,
      source: THINKING_SOURCE_PROVIDER_REPORTED,
    });
    assert.equal(Object.hasOwn(normalized, 'provider'), false);
    assert.equal(Object.hasOwn(normalized, 'rawLabel'), false);
    assert.equal(Object.hasOwn(normalized, 'rawSample'), false);
  });

  it('rejects forged, inferred, unsafe, and untimed runtime messages', () => {
    for (const message of [
      null,
      {},
      {
        type: 'tick',
        eventId: 'chatgpt:response-1',
        model: 'gpt-5',
        thinkingMs: 1000,
        source: THINKING_SOURCE_PROVIDER_REPORTED,
      },
      {
        type: THINKING_MESSAGE_TYPE,
        eventId: 'chatgpt:response-1',
        model: 'gpt-5',
        thinkingMs: 1000,
        source: 'inferred-from-text',
      },
      {
        type: THINKING_MESSAGE_TYPE,
        eventId: 'bad key with spaces',
        model: 'gpt-5',
        thinkingMs: 1000,
        source: THINKING_SOURCE_PROVIDER_REPORTED,
      },
      {
        type: THINKING_MESSAGE_TYPE,
        eventId: 'chatgpt:too-short',
        model: 'gpt-5',
        thinkingMs: 999,
        source: THINKING_SOURCE_PROVIDER_REPORTED,
      },
    ]) {
      assert.equal(normalizeThinkingMetric(message), null, JSON.stringify(message));
    }
  });
});

describe('thinking aggregate normalization', () => {
  it('normalizes v3 provider/model aggregates without mutating source data', () => {
    const source = {
      '2026-07-15': {
        'chatgpt.com': {
          'gpt-5-5': { reportedCount: 2, totalMs: 3000 },
          o3: { reportedCount: 1, totalMs: 1000 },
        },
        chatgpt: {
          'gpt-5.5': { reportedCount: 1, totalMs: 3000 },
        },
        claude: {
          'claude-sonnet': { reportedCount: 1, totalMs: 2000 },
        },
      },
      'not-a-date': {
        chatgpt: {
          'gpt-5': { reportedCount: 1, totalMs: 1000 },
        },
      },
    };
    const before = clone(source);

    const normalized = normalizeThinkingProviderModelData(source);

    assert.deepEqual(source, before, 'normalization must not mutate source data');
    assert.deepEqual(normalized, {
      '2026-07-15': {
        chatgpt: {
          'gpt-5.5': { reportedCount: 3, totalMs: 6000 },
          o3: { reportedCount: 1, totalMs: 1000 },
        },
        claude: {
          'claude-sonnet': { reportedCount: 1, totalMs: 2000 },
        },
      },
    });
  });

  it('drops invalid, dangerous, and zero/untimed aggregate records', () => {
    const source = JSON.parse(`{
      "2026-07-15": {
        "chatgpt": {
          "gpt-5": { "reportedCount": 1, "totalMs": 1000 },
          "untimed-zero": { "reportedCount": 3, "totalMs": 0 },
          "average-too-low": { "reportedCount": 3, "totalMs": 2000 },
          "average-too-high": { "reportedCount": 1, "totalMs": 21600001 },
          "bad-count": { "reportedCount": 1.5, "totalMs": 1500 },
          "__proto__": { "reportedCount": 1, "totalMs": 1000 }
        },
        "__proto__": {
          "polluted": { "reportedCount": 1, "totalMs": 1000 }
        },
        "constructor": {
          "polluted": { "reportedCount": 1, "totalMs": 1000 }
        }
      }
    }`);

    const normalized = normalizeThinkingProviderModelData(source);

    assert.deepEqual(normalized, {
      '2026-07-15': {
        chatgpt: {
          'gpt-5': { reportedCount: 1, totalMs: 1000 },
        },
      },
    });
    assertNoDangerousOwnKeys(normalized);
  });

  it('normalizes individual records and derives averages from reportedCount only', () => {
    assert.deepEqual(
      normalizeThinkingAggregateRecord({ reportedCount: 2, totalMs: 3000 }),
      { reportedCount: 2, totalMs: 3000 }
    );
    assert.equal(
      thinkingAverageMs({ reportedCount: 2, totalMs: 3000 }),
      1500
    );

    for (const record of [
      { reportedCount: 0, totalMs: 0 },
      { reportedCount: 10, totalMs: 0 },
      { reportedCount: 2, totalMs: 1000 },
      { reportedCount: 1, totalMs: THINKING_DURATION_MAX_MS + 1 },
      { reportedCount: Number.MAX_SAFE_INTEGER + 1, totalMs: 1000 },
    ]) {
      assert.equal(normalizeThinkingAggregateRecord(record), null, JSON.stringify(record));
      assert.equal(thinkingAverageMs(record), null, JSON.stringify(record));
    }
  });
});

describe('thinking aggregate stats and formatting', () => {
  it('summarizes the requested day with averages derived from timed reports only', () => {
    const stats = getThinkingStatsForDate({
      '2026-07-15': {
        chatgpt: {
          'gpt-5.5': { reportedCount: 2, totalMs: 3000 },
          'gpt-5': { reportedCount: 1, totalMs: 3000 },
          untimed: { reportedCount: 4, totalMs: 0 },
        },
      },
      '2026-07-14': {
        chatgpt: {
          'gpt-5': { reportedCount: 1, totalMs: 6000 },
        },
      },
    }, '2026-07-15');

    assert.equal(stats.reportedCount, 3);
    assert.equal(stats.totalMs, 6000);
    assert.equal(stats.averageMs, 2000);
    assert.equal(stats.averageLabel, '2s');
    assert.equal(stats.providers.chatgpt.reportedCount, 3);
    assert.equal(stats.providers.chatgpt.averageMs, 2000);
    assert.equal(stats.providers.chatgpt.models['gpt-5.5'].averageMs, 1500);
    assert.equal(stats.providers.chatgpt.models['gpt-5.5'].averageLabel, '1.5s');
    assert.equal(Object.hasOwn(stats.providers.chatgpt.models, 'untimed'), false);
  });

  it('formats durations without displaying untimed or invalid values as zero', () => {
    const cases = [
      [null, '—'],
      [0, '—'],
      [999, '—'],
      [1000, '1s'],
      [1500, '1.5s'],
      [65_000, '1m 5s'],
      [3_723_000, '1h 2m 3s'],
      [THINKING_DURATION_MAX_MS, '6h'],
      [THINKING_DURATION_MAX_MS + 1, '—'],
    ];

    for (const [value, expected] of cases) {
      assert.equal(formatThinkingDuration(value), expected, String(value));
    }
    assert.equal(formatThinkingDuration(null, 'No timed reports'), 'No timed reports');
  });

  it('returns an explicit empty stats shape when there are no timed reports', () => {
    assert.deepEqual(getThinkingStatsForDate({}, '2026-07-15'), {
      reportedCount: 0,
      totalMs: 0,
      averageMs: null,
      averageLabel: '—',
      providers: {},
    });
  });

  it('skips imported model records that would overflow a provider rollup', () => {
    const count = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
    const totalMs = count * 1000;
    const stats = getThinkingStatsForDate({
      '2026-07-15': {
        chatgpt: {
          first: { reportedCount: count, totalMs },
          overflowing: { reportedCount: count, totalMs },
        },
      },
    }, '2026-07-15');

    assert.equal(stats.reportedCount, count);
    assert.equal(stats.totalMs, totalMs);
    assert.deepEqual(Object.keys(stats.providers.chatgpt.models), ['first']);
    assert.equal(Number.isSafeInteger(stats.totalMs), true);
  });
});

describe('recentThinkingEvents dedupe normalization', () => {
  it('normalizes safe event IDs for dedupe keys', () => {
    assert.equal(normalizeThinkingEventId(' chatgpt:response-1 '), 'chatgpt:response-1');
    assert.equal(normalizeThinkingEventId('__proto__'), '');
    assert.equal(normalizeThinkingEventId('bad key'), '');
    assert.equal(normalizeThinkingEventId('x'.repeat(181)), '');
  });

  it('bounds recentThinkingEvents like the existing event ledger', () => {
    const now = 10_000_000;
    const ledger = {
      constructor: now,
      'bad key': now,
      stale: now - THINKING_EVENT_DEDUPE_TTL_MS,
    };
    for (let index = 0; index < MAX_RECENT_THINKING_EVENTS + 5; index += 1) {
      ledger[`event-${index}`] = now - index;
    }

    const normalized = normalizeRecentThinkingEvents(ledger, now);

    assert.equal(Object.keys(normalized).length, MAX_RECENT_THINKING_EVENTS);
    assert.equal(normalized['event-0'], now);
    assert.equal(normalized[`event-${MAX_RECENT_THINKING_EVENTS - 1}`], now - 499);
    assert.equal(Object.hasOwn(normalized, `event-${MAX_RECENT_THINKING_EVENTS}`), false);
    assert.equal(Object.hasOwn(normalized, 'stale'), false);
    assertNoDangerousOwnKeys(normalized);
  });
});
