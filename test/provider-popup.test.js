const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createPopupScriptHarness, todayKey } = require('./helpers');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function providerRows(harness) {
  return Object.fromEntries(
    harness.document.getElementById('providerBreakdown').children.map((row) => [
      row.children[0].textContent,
      {
        today: Number(row.children[1].textContent),
        total: Number(row.children[2].textContent),
      },
    ])
  );
}

describe('popup provider totals', () => {
  it('shows today and all-time counts for each supported service', () => {
    const today = todayKey();
    const harness = createPopupScriptHarness({
      byDate: { '2026-01-01': 3, [today]: 9 },
      byModel: {
        '2026-01-01': { 'gpt-5': 3 },
        [today]: { 'gpt-5': 2, sonnet: 2, sonar: 2, 'grok-4': 2, unknown: 1 },
      },
      byProviderModel: {
        '2026-01-01': { chatgpt: { 'gpt-5': 3 } },
        [today]: {
          chatgpt: { 'gpt-5': 2 },
          claude: { sonnet: 2 },
          perplexity: { sonar: 2 },
          grok: { 'grok-4': 2 },
          unknown: { unknown: 1 },
        },
      },
    });

    harness.fireDOMContentLoaded();

    assert.deepEqual(providerRows(harness), {
      ChatGPT: { today: 2, total: 5 },
      Claude: { today: 2, total: 2 },
      Gemini: { today: 0, total: 0 },
      Perplexity: { today: 2, total: 2 },
      Grok: { today: 2, total: 2 },
      Unknown: { today: 1, total: 1 },
    });
  });

  it('routes reset today through the serialized background mutation queue', () => {
    const today = todayKey();
    const harness = createPopupScriptHarness({
      byDate: { '2026-01-01': 2, [today]: 3 },
      byModel: { '2026-01-01': { legacy: 2 }, [today]: { sonnet: 3 } },
      byProviderModel: {
        '2026-01-01': { unknown: { legacy: 2 } },
        [today]: { claude: { sonnet: 3 } },
      },
      byHour: { [`${today}-12`]: 3 },
      total: 5,
    });
    harness.fireDOMContentLoaded();

    harness.click('resetToday');

    assert.ok(harness.runtimeMessages.some((message) => message.type === 'resetToday'));
  });

  it('routes reset all through the serialized background mutation queue', () => {
    const harness = createPopupScriptHarness();
    harness.fireDOMContentLoaded();

    harness.click('resetAll');

    assert.ok(harness.runtimeMessages.some((message) => message.type === 'resetAll'));
  });
});
