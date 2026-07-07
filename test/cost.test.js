// Tests for feat/cost-estimation
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PROMPT_TOKEN_ESTIMATE,
  PRICE_PER_PROMPT,
  displayModelName,
  estimateCost,
  estimateCostDetails,
  getModelCountsForDate,
  normalizeModelName,
  priceForModel,
} = require('./helpers');

describe('PRICE_PER_PROMPT', () => {
  it('includes current OpenAI API proxy models', () => {
    const expected = [
      'gpt-5.5-pro',
      'gpt-5.5',
      'gpt-5.4-pro',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.3-codex',
      'gpt-5',
      'chat-latest',
    ];
    for (const model of expected) {
      assert.ok(model in PRICE_PER_PROMPT, `Missing price for ${model}`);
    }
  });

  it('prices are positive numbers', () => {
    for (const [model, price] of Object.entries(PRICE_PER_PROMPT)) {
      assert.ok(typeof price === 'number' && price > 0, `${model} price should be positive`);
    }
  });

  it('does not assign a fake fallback price to unknown models', () => {
    assert.equal(priceForModel('unknown'), null);
    assert.equal(priceForModel('future-model-x'), null);
  });
});

describe('estimateCost', () => {
  it('returns 0 for empty model counts', () => {
    assert.equal(estimateCost({}), 0);
  });

  it('calculates cost from the token-rate proxy for a single known model', () => {
    const cost = estimateCost({ 'gpt-5.5': 10 });
    const expectedUnit = (
      DEFAULT_PROMPT_TOKEN_ESTIMATE.input * 5 +
      DEFAULT_PROMPT_TOKEN_ESTIMATE.output * 30
    ) / 1_000_000;
    assert.equal(cost, 10 * expectedUnit);
  });

  it('sums costs across multiple priced models', () => {
    const cost = estimateCost({ 'gpt-5.5': 5, 'gpt-5.3-codex': 10 });
    const expected = 5 * PRICE_PER_PROMPT['gpt-5.5'] + 10 * PRICE_PER_PROMPT['gpt-5.3-codex'];
    assert.equal(cost, expected);
  });

  it('normalizes GPT-5.5 slug variants before pricing', () => {
    assert.equal(normalizeModelName('gpt-5-5-pro'), 'gpt-5.5-pro');
    assert.equal(displayModelName('openai/gpt-5-5-pro'), 'gpt-5.5-pro');
    assert.equal(priceForModel('gpt-5-5-pro'), PRICE_PER_PROMPT['gpt-5.5-pro']);
  });

  it('reports unpriced counts instead of silently charging the unknown fallback', () => {
    const details = estimateCostDetails({ 'gpt-5-5-pro': 7, unknown: 5 });

    assert.equal(details.total, 7 * PRICE_PER_PROMPT['gpt-5.5-pro']);
    assert.equal(details.pricedCount, 7);
    assert.equal(details.unpricedCount, 5);
    assert.equal(details.models['gpt-5-5-pro'].normalizedModel, 'gpt-5.5-pro');
    assert.equal(details.models.unknown.priced, false);
  });
});

describe('getModelCountsForDate', () => {
  it('uses model counts when they cover the date total', () => {
    const counts = getModelCountsForDate(
      { '2026-05-16': 3 },
      { '2026-05-16': { 'gpt-4o': 2, 'o3-mini': 1 } },
      '2026-05-16'
    );

    assert.deepEqual(counts, { 'gpt-4o': 2, 'o3-mini': 1 });
  });

  it('adds unknown counts for legacy date totals without model data', () => {
    const counts = getModelCountsForDate({ '2026-05-16': 13 }, {}, '2026-05-16');

    assert.deepEqual(counts, { unknown: 13 });
  });

  it('adds only the missing remainder as unknown for partial model data', () => {
    const counts = getModelCountsForDate(
      { '2026-05-16': 5 },
      { '2026-05-16': { 'gpt-4o': 2 } },
      '2026-05-16'
    );

    assert.deepEqual(counts, { 'gpt-4o': 2, unknown: 3 });
  });
});
