const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createPopupScriptHarness, todayKey } = require('./helpers');
const { formatThinkingDuration } = require('../popup');

function priorDateKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return todayKey(date);
}

function thinkingRows(harness) {
  return harness.document.getElementById('thinkingModelRows').children.map((row) => ({
    model: row.children[0].textContent,
    timed: row.children[1]?.textContent,
    average: row.children[2]?.textContent,
    total: row.children[3]?.textContent,
  }));
}

describe('popup Thinking time display', () => {
  it('preserves seconds when formatting hour-scale averages and totals', () => {
    assert.equal(formatThinkingDuration(3_601_000), '1h 1s');
    assert.equal(formatThinkingDuration(7_199_000), '1h 59m 59s');
  });

  it('renders provider-reported ChatGPT totals, averages, timed counts, and model rows', () => {
    const today = todayKey();
    const prior = priorDateKey();
    const harness = createPopupScriptHarness({
      byThinkingProviderModel: {
        [prior]: {
          chatgpt: {
            'gpt-5-5-pro': { reportedCount: 1, totalMs: 3000 },
          },
        },
        [today]: {
          chatgpt: {
            'gpt-5-5-pro': { reportedCount: 2, totalMs: 5000 },
            'gpt-5': { reportedCount: 1, totalMs: 120000 },
          },
          claude: {
            sonnet: { reportedCount: 1, totalMs: 60000 },
          },
        },
      },
    });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('thinkingTodayTimed').textContent, '3');
    assert.equal(harness.document.getElementById('thinkingTodayTotal').textContent, '2m 5s');
    assert.equal(harness.document.getElementById('thinkingTodayAverage').textContent, '42s');
    assert.equal(harness.document.getElementById('thinkingAllTimeTimed').textContent, '4');
    assert.equal(harness.document.getElementById('thinkingAllTimeTotal').textContent, '2m 8s');
    assert.equal(harness.document.getElementById('thinkingAllTimeAverage').textContent, '32s');

    assert.deepEqual(thinkingRows(harness), [
      { model: 'gpt-5.5-pro', timed: '2', average: '2.5s', total: '5s' },
      { model: 'gpt-5', timed: '1', average: '2m', total: '2m' },
    ]);
  });

  it('reads byThinkingProviderModel defensively and does not average untimed prompts as zero', () => {
    const today = todayKey();
    const harness = createPopupScriptHarness({
      byDate: { [today]: 9 },
      byThinkingProviderModel: {
        'not-a-date': {
          chatgpt: {
            ignored: { reportedCount: 10, totalMs: 10000 },
          },
        },
        [today]: {
          chatgpt: {
            valid: { reportedCount: 1, totalMs: 1000 },
            malformed: null,
            tooFastAverage: { reportedCount: 3, totalMs: 2000 },
            tooSlowAverage: { reportedCount: 1, totalMs: 21600001 },
            negativeCount: { reportedCount: -1, totalMs: 1000 },
          },
          'chatgpt.com': {
            alias: { reportedCount: 1, totalMs: 2000 },
          },
          claude: {
            sonnet: { reportedCount: 1, totalMs: 90000 },
          },
        },
      },
    });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('thinkingTodayTimed').textContent, '2');
    assert.equal(harness.document.getElementById('thinkingTodayTotal').textContent, '3s');
    assert.equal(harness.document.getElementById('thinkingTodayAverage').textContent, '1.5s');
    assert.match(
      harness.document.getElementById('thinkingNote').textContent,
      /Only timed responses enter averages/
    );
    assert.deepEqual(thinkingRows(harness), [
      { model: 'alias', timed: '1', average: '2s', total: '2s' },
      { model: 'valid', timed: '1', average: '1s', total: '1s' },
    ]);
  });

  it('shows an accessible empty state when no ChatGPT thinking timings exist today', () => {
    const harness = createPopupScriptHarness({
      byThinkingProviderModel: {
        [priorDateKey()]: {
          chatgpt: {
            'gpt-5': { reportedCount: 1, totalMs: 3000 },
          },
        },
      },
    });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('thinkingTodayTimed').textContent, '0');
    assert.equal(harness.document.getElementById('thinkingTodayAverage').textContent, '—');
    assert.equal(
      harness.document.getElementById('thinkingTodayAverage').getAttribute('aria-label'),
      'No timed ChatGPT responses today'
    );
    assert.equal(
      harness.document.getElementById('thinkingModelRows').children[0].children[0].textContent,
      'No timed ChatGPT responses today.'
    );
  });
});
