const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const shared = require('../shared');

const {
  PROVIDERS,
  buildUsageCsv,
  getProviderCountsForDate,
  getProviderTotals,
  mergeUsageData,
  normalizeProviderId,
  normalizeProviderModelData,
  parseUsageCsv,
  providerForHost,
} = shared;

const CANONICAL_PROVIDERS = [
  'chatgpt',
  'claude',
  'gemini',
  'perplexity',
  'unknown',
];
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function nestedTotal(day = {}) {
  return Object.values(day || {}).reduce((providerTotal, models) => (
    providerTotal + Object.values(models || {}).reduce(
      (modelTotal, count) => modelTotal + Number(count || 0),
      0
    )
  ), 0);
}

function flattenPositiveJoint(data = {}) {
  const flattened = {};
  for (const [date, providers] of Object.entries(data || {})) {
    for (const [provider, models] of Object.entries(providers || {})) {
      for (const [model, countValue] of Object.entries(models || {})) {
        const count = Number(countValue || 0);
        if (!Number.isFinite(count) || count <= 0) continue;
        flattened[`${date}\u0000${provider}\u0000${model}`] = count;
      }
    }
  }
  return flattened;
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

function assertDailyInvariant(byDate, byProviderModel) {
  for (const [date, rawTotal] of Object.entries(byDate || {})) {
    const expected = Number(rawTotal || 0);
    assert.equal(
      nestedTotal(byProviderModel?.[date]),
      expected,
      `joint provider/model total must equal byDate for ${date}`
    );
  }
}

function providerNamesFromExport(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (value && typeof value === 'object') {
    return [...Object.keys(value), ...Object.values(value)];
  }
  return [];
}

describe('provider identity contract', () => {
  it('exports exactly the supported canonical provider identities', () => {
    assert.ok(PROVIDERS, 'PROVIDERS must be exported');
    assert.equal(typeof normalizeProviderId, 'function');

    const normalized = new Set(
      providerNamesFromExport(PROVIDERS)
        .filter((value) => typeof value === 'string')
        .map((value) => normalizeProviderId(value))
    );

    assert.deepEqual([...normalized].sort(), [...CANONICAL_PROVIDERS].sort());
  });

  it('maps every supported hostname and Perplexity alias to a stable provider', () => {
    const cases = [
      ['chatgpt.com', 'chatgpt'],
      ['chat.openai.com', 'chatgpt'],
      ['CHATGPT.COM', 'chatgpt'],
      ['claude.ai', 'claude'],
      ['CLAUDE.AI', 'claude'],
      ['gemini.google.com', 'gemini'],
      ['perplexity.ai', 'perplexity'],
      ['www.perplexity.ai', 'perplexity'],
      ['WWW.PERPLEXITY.AI', 'perplexity'],
    ];

    for (const [host, expected] of cases) {
      assert.equal(providerForHost(host), expected, host);
    }
  });

  it('does not accept suffix attacks or unrelated hosts', () => {
    for (const host of [
      '',
      null,
      'claude.ai.evil.example',
      'notclaude.ai',
      'perplexity.ai.example',
      'chatgpt.example',
      '__proto__',
    ]) {
      assert.equal(providerForHost(host), 'unknown', String(host));
    }
  });

  it('normalizes canonical IDs, display-case IDs, and historical host IDs', () => {
    const cases = [
      [' chatGPT ', 'chatgpt'],
      ['chat.openai.com', 'chatgpt'],
      ['CLAUDE', 'claude'],
      ['claude.ai', 'claude'],
      ['Gemini', 'gemini'],
      ['gemini.google.com', 'gemini'],
      ['Perplexity', 'perplexity'],
      ['www.perplexity.ai', 'perplexity'],
      ['unknown', 'unknown'],
    ];

    for (const [value, expected] of cases) {
      assert.equal(normalizeProviderId(value), expected, value);
    }
  });

  it('maps hostile, malformed, and non-string IDs to unknown without throwing', () => {
    for (const value of [
      '__proto__',
      'constructor',
      'prototype',
      'claude.ai.evil.example',
      '',
      null,
      undefined,
      {},
      [],
      42,
    ]) {
      assert.doesNotThrow(() => normalizeProviderId(value));
      assert.equal(normalizeProviderId(value), 'unknown', String(value));
    }
  });
});

describe('provider/model storage normalization', () => {
  it('migrates v1 date/model data into the unknown provider without losing counts', () => {
    const byDate = { '2026-07-08': 5 };
    const byModel = {
      '2026-07-08': {
        'gpt-5': 2,
        'claude-sonnet': 1,
      },
    };
    const beforeDate = plain(byDate);
    const beforeModel = plain(byModel);

    const normalized = normalizeProviderModelData(byDate, byModel, {});

    assert.equal(normalized['2026-07-08'].unknown['gpt-5'], 2);
    assert.equal(normalized['2026-07-08'].unknown['claude-sonnet'], 1);
    assert.equal(normalized['2026-07-08'].unknown.unknown, 2);
    assertDailyInvariant(byDate, normalized);
    assert.deepEqual(byDate, beforeDate, 'normalization must not mutate byDate');
    assert.deepEqual(byModel, beforeModel, 'normalization must not mutate byModel');
  });

  it('canonicalizes provider aliases and fills only the unattributed remainder', () => {
    const byDate = { '2026-07-09': 7 };
    const byModel = {
      '2026-07-09': {
        'gpt-5': 2,
        'claude-sonnet': 3,
        sonar: 1,
        unknown: 1,
      },
    };
    const byProviderModel = {
      '2026-07-09': {
        'chatgpt.com': { 'gpt-5': 2 },
        'CLAUDE.AI': { 'claude-sonnet': 3 },
        'www.perplexity.ai': { sonar: 1 },
      },
    };

    const normalized = normalizeProviderModelData(byDate, byModel, byProviderModel);

    assert.equal(normalized['2026-07-09'].chatgpt['gpt-5'], 2);
    assert.equal(normalized['2026-07-09'].claude['claude-sonnet'], 3);
    assert.equal(normalized['2026-07-09'].perplexity.sonar, 1);
    assert.equal(normalized['2026-07-09'].unknown.unknown, 1);
    assertDailyInvariant(byDate, normalized);
  });

  it('keeps canonical daily and all-time provider totals consistent', () => {
    const byDate = {
      '2026-07-08': 4,
      '2026-07-09': 5,
    };
    const joint = {
      '2026-07-08': {
        chatgpt: { 'gpt-5': 1 },
        claude: { sonnet: 2 },
        perplexity: { sonar: 1 },
      },
      '2026-07-09': {
        claude: { opus: 1 },
        gemini: { pro: 2 },
        perplexity: { sonar: 1 },
      },
    };

    const today = getProviderCountsForDate(byDate, joint, '2026-07-09');
    const totals = getProviderTotals(byDate, joint);

    assert.equal(today.claude, 1);
    assert.equal(today.gemini, 2);
    assert.equal(today.perplexity, 1);
    assert.equal(today.unknown, 1);
    assert.equal(Object.values(today).reduce((sum, count) => sum + count, 0), 5);

    assert.equal(totals.chatgpt, 1);
    assert.equal(totals.claude, 3);
    assert.equal(totals.gemini, 2);
    assert.equal(totals.perplexity, 2);
    assert.equal(totals.unknown, 1);
    assert.equal(Object.values(totals).reduce((sum, count) => sum + count, 0), 9);
  });

  it('rejects dangerous keys and invalid counts without prototype pollution', () => {
    delete Object.prototype.polluted;
    const hostile = JSON.parse(`{
      "2026-07-10": {
        "__proto__": { "polluted": 100 },
        "constructor": { "bad": 100 },
        "prototype": { "bad": 100 },
        "claude": {
          "safe-sonnet": 2,
          "__proto__": 100,
          "constructor": 100,
          "negative": -1,
          "fraction": 1.5,
          "not-a-number": "NaN"
        },
        "perplexity.ai": { "safe-sonar": 2 }
      }
    }`);
    const byDate = { '2026-07-10': 4 };
    const byModel = {
      '2026-07-10': { 'safe-sonnet': 2, 'safe-sonar': 2 },
    };

    const normalized = normalizeProviderModelData(byDate, byModel, hostile);

    assert.equal(Object.prototype.polluted, undefined);
    assertNoDangerousOwnKeys(normalized);
    assertDailyInvariant(byDate, normalized);
    assert.equal(normalized['2026-07-10'].claude?.['safe-sonnet'], 2);
    assert.equal(normalized['2026-07-10'].perplexity?.['safe-sonar'], 2);
    assert.equal(Object.hasOwn(normalized['2026-07-10'].claude || {}, 'negative'), false);
    assert.equal(Object.hasOwn(normalized['2026-07-10'].claude || {}, 'fraction'), false);
    assert.equal(Object.hasOwn(normalized['2026-07-10'].claude || {}, 'not-a-number'), false);
  });

  it('never lets corrupt provider data exceed the authoritative date total', () => {
    const byDate = { '2026-07-10': 2 };
    const byModel = { '2026-07-10': { unknown: 2 } };
    const corrupt = {
      '2026-07-10': {
        claude: { sonnet: 50 },
        perplexity: { sonar: 50 },
      },
    };

    const normalized = normalizeProviderModelData(byDate, byModel, corrupt);
    const counts = getProviderCountsForDate(byDate, corrupt, '2026-07-10');

    assertDailyInvariant(byDate, normalized);
    assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 2);
    assert.ok(Object.values(counts).every((count) => count >= 0 && Number.isInteger(count)));
  });

  it('preserves authoritative model history when joint model attribution conflicts', () => {
    const byDate = { '2026-07-10': 2 };
    const byModel = { '2026-07-10': { sonnet: 1, sonar: 1 } };
    const conflicting = {
      '2026-07-10': { claude: { sonnet: 2 } },
    };

    const normalized = normalizeProviderModelData(byDate, byModel, conflicting);

    assert.deepEqual(plain(normalized), {
      '2026-07-10': { unknown: { sonnet: 1, sonar: 1 } },
    });
    assertDailyInvariant(byDate, normalized);
  });
});

describe('provider-aware CSV compatibility', () => {
  it('imports v1 CSV rows under the unknown provider', () => {
    const parsed = parseUsageCsv([
      'date,model,count',
      '2026-07-08,gpt-5,2',
      '2026-07-08,unknown,1',
      '2026-07-09,sonnet,4',
    ].join('\n'));

    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(plain(parsed.byDate), {
      '2026-07-08': 3,
      '2026-07-09': 4,
    });
    assert.equal(parsed.byProviderModel['2026-07-08'].unknown['gpt-5'], 2);
    assert.equal(parsed.byProviderModel['2026-07-08'].unknown.unknown, 1);
    assert.equal(parsed.byProviderModel['2026-07-09'].unknown.sonnet, 4);
    assertDailyInvariant(parsed.byDate, parsed.byProviderModel);
  });

  it('imports v2 aliases into canonical providers and aggregates models', () => {
    const parsed = parseUsageCsv([
      'date,provider,model,count',
      '2026-07-10,claude.ai,sonnet,2',
      '2026-07-10,CLAUDE,sonnet,1',
      '2026-07-10,www.perplexity.ai,sonar,3',
      '2026-07-10,chat.openai.com,gpt-5,4',
    ].join('\n'));

    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.byDate['2026-07-10'], 10);
    assert.equal(parsed.byModel['2026-07-10'].sonnet, 3);
    assert.equal(parsed.byProviderModel['2026-07-10'].claude.sonnet, 3);
    assert.equal(parsed.byProviderModel['2026-07-10'].perplexity.sonar, 3);
    assert.equal(parsed.byProviderModel['2026-07-10'].chatgpt['gpt-5'], 4);
    assertDailyInvariant(parsed.byDate, parsed.byProviderModel);
  });

  it('round-trips v2 provider/model data, including quoted multiline model names', () => {
    const unusualModel = 'sonar, "deep"\nresearch';
    const byDate = {
      '2026-07-09': 2,
      '2026-07-10': 6,
    };
    const byProviderModel = {
      '2026-07-09': {
        unknown: { legacy: 2 },
      },
      '2026-07-10': {
        chatgpt: { 'gpt-5': 1 },
        claude: { sonnet: 2 },
        gemini: { pro: 1 },
        perplexity: { [unusualModel]: 2 },
      },
    };
    const byModel = {
      '2026-07-09': { legacy: 2 },
      '2026-07-10': {
        'gpt-5': 1,
        sonnet: 2,
        pro: 1,
        [unusualModel]: 2,
      },
    };

    const csv = buildUsageCsv(byDate, byModel, byProviderModel);
    const parsed = parseUsageCsv(csv);

    assert.equal(csv.split(/\r?\n/, 1)[0], 'date,provider,model,count');
    assert.equal(buildUsageCsv(byDate, byModel, byProviderModel), csv, 'CSV must be deterministic');
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(plain(parsed.byDate), byDate);
    assert.deepEqual(plain(parsed.byModel), byModel);
    assert.deepEqual(
      flattenPositiveJoint(parsed.byProviderModel),
      flattenPositiveJoint(byProviderModel)
    );
    assertDailyInvariant(parsed.byDate, parsed.byProviderModel);
  });

  it('does not allow hostile CSV keys to pollute prototypes', () => {
    delete Object.prototype.polluted;
    const parsed = parseUsageCsv([
      'date,provider,model,count',
      '2026-07-10,__proto__,polluted,1',
      '2026-07-10,constructor,__proto__,1',
      '2026-07-10,prototype,constructor,1',
      '2026-07-10,claude,safe,1',
    ].join('\n'));

    assert.equal(Object.prototype.polluted, undefined);
    assertNoDangerousOwnKeys(parsed.byProviderModel);
    assert.equal(parsed.byDate['2026-07-10'], 4);
    assertDailyInvariant(parsed.byDate, parsed.byProviderModel);
  });

  it('rejects unsafe integers and aggregate overflow', () => {
    const parsed = parseUsageCsv([
      'date,provider,model,count',
      '2026-07-10,claude,sonnet,9007199254740992',
      '2026-07-11,claude,sonnet,9007199254740989',
      '2026-07-11,perplexity,sonar,3',
      '2026-07-12,perplexity,sonar,2',
      '2026-07-13,perplexity,sonar,1',
    ].join('\n'));

    assert.deepEqual(plain(parsed.byDate), {
      '2026-07-11': Number.MAX_SAFE_INTEGER - 2,
      '2026-07-12': 2,
    });
    assert.deepEqual(parsed.errors, [
      'Row 2: invalid count',
      'Row 4: invalid count',
      'Row 6: invalid count',
    ]);
  });
});

describe('provider-aware merge', () => {
  it('merges joint provider/model data without mutating either input', () => {
    const current = {
      byDate: { '2026-07-10': 2 },
      byModel: { '2026-07-10': { 'gpt-5': 2 } },
      byProviderModel: {
        '2026-07-10': { chatgpt: { 'gpt-5': 2 } },
      },
    };
    const imported = {
      byDate: { '2026-07-10': 3, '2026-07-11': 1 },
      byModel: {
        '2026-07-10': { sonnet: 2, sonar: 1 },
        '2026-07-11': { sonar: 1 },
      },
      byProviderModel: {
        '2026-07-10': {
          claude: { sonnet: 2 },
          perplexity: { sonar: 1 },
        },
        '2026-07-11': {
          perplexity: { sonar: 1 },
        },
      },
    };
    const currentBefore = plain(current);
    const importedBefore = plain(imported);

    const merged = mergeUsageData(current, imported);

    assert.deepEqual(current, currentBefore);
    assert.deepEqual(imported, importedBefore);
    assert.equal(merged.total, 6);
    assert.equal(merged.byDate['2026-07-10'], 5);
    assert.equal(merged.byDate['2026-07-11'], 1);
    assert.equal(merged.byModel['2026-07-10']['gpt-5'], 2);
    assert.equal(merged.byModel['2026-07-10'].sonnet, 2);
    assert.equal(merged.byProviderModel['2026-07-10'].chatgpt['gpt-5'], 2);
    assert.equal(merged.byProviderModel['2026-07-10'].claude.sonnet, 2);
    assert.equal(merged.byProviderModel['2026-07-10'].perplexity.sonar, 1);
    assert.equal(merged.byProviderModel['2026-07-11'].perplexity.sonar, 1);
    assertDailyInvariant(merged.byDate, merged.byProviderModel);
  });

  it('preserves v1 imports as unknown-provider history when merging', () => {
    const current = {
      byDate: { '2026-07-10': 1 },
      byModel: { '2026-07-10': { sonnet: 1 } },
      byProviderModel: {
        '2026-07-10': { claude: { sonnet: 1 } },
      },
    };
    const legacyImport = parseUsageCsv([
      'date,model,count',
      '2026-07-10,legacy-model,2',
    ].join('\n'));

    const merged = mergeUsageData(current, legacyImport);

    assert.equal(merged.byDate['2026-07-10'], 3);
    assert.equal(merged.byProviderModel['2026-07-10'].claude.sonnet, 1);
    assert.equal(merged.byProviderModel['2026-07-10'].unknown['legacy-model'], 2);
    assertDailyInvariant(merged.byDate, merged.byProviderModel);
  });

  it('rejects a merge whose all-time total would exceed safe integer precision', () => {
    assert.throws(
      () => mergeUsageData(
        {
          byDate: { '2026-07-10': Number.MAX_SAFE_INTEGER },
          byModel: { '2026-07-10': { unknown: Number.MAX_SAFE_INTEGER } },
        },
        {
          byDate: { '2026-07-11': 1 },
          byModel: { '2026-07-11': { unknown: 1 } },
        }
      ),
      /safe integer/
    );
  });
});
