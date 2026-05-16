// Tests for feat/cost-estimation
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { estimateCost, getModelCountsForDate, PRICE_PER_PROMPT } = require('./helpers');

describe('PRICE_PER_PROMPT', () => {
  it('has an unknown fallback price', () => {
    assert.ok(PRICE_PER_PROMPT['unknown'] > 0);
  });

  it('includes all expected models', () => {
    const expected = [
      'gpt-4o', 'gpt-4o-mini', 'gpt-4.5', 'gpt-4',
      'o1', 'o1-mini', 'o3', 'o3-mini',
      'claude-sonnet', 'claude-opus', 'claude-haiku',
      'gemini-flash', 'gemini-pro',
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
});

describe('estimateCost', () => {
  it('returns 0 for empty model counts', () => {
    assert.equal(estimateCost({}), 0);
  });

  it('calculates cost for a single known model', () => {
    const cost = estimateCost({ 'gpt-4o': 10 });
    assert.equal(cost, 10 * 0.02);
  });

  it('sums costs across multiple models', () => {
    const cost = estimateCost({ 'gpt-4o': 5, 'o3-mini': 10 });
    const expected = 5 * 0.02 + 10 * 0.01;
    assert.equal(cost, expected);
  });

  it('falls back to unknown price for unrecognized models', () => {
    const cost = estimateCost({ 'future-model-x': 3 });
    assert.equal(cost, 3 * PRICE_PER_PROMPT['unknown']);
  });

  it('mixes known and unknown models', () => {
    const cost = estimateCost({ 'claude-opus': 2, 'mystery': 1 });
    const expected = 2 * 0.08 + 1 * PRICE_PER_PROMPT['unknown'];
    assert.equal(cost, expected);
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
