const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createPopupScriptHarness, todayKey } = require('./helpers');

describe('popup diagnostics display', () => {
  it('renders active-tab status and manifest version', () => {
    const harness = createPopupScriptHarness();

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'chatgpt.com supported');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Supported');
    assert.equal(harness.document.getElementById('statusValue').className, 'pill supported');
    assert.equal(harness.document.getElementById('version').textContent, 'test-version');
  });

  it('falls back to last seen supported site when active tab URL is unavailable', () => {
    const harness = createPopupScriptHarness({
      activeTabUrl: null,
      lastSeenSite: 'claude.ai',
    });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'Last seen claude.ai');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Supported');
    assert.equal(harness.document.getElementById('statusValue').className, 'pill supported');
  });

  it('renders stored last-count diagnostics with user-facing reason labels', () => {
    const harness = createPopupScriptHarness({
      activeTabUrl: null,
      lastCountedAt: '2026-01-02T03:04:00.000Z',
      lastCountReason: 'dom-event',
    });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'Unavailable');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Unknown');
    assert.equal(harness.document.getElementById('statusValue').className, 'pill unknown');
    assert.equal(harness.document.getElementById('lastReason').textContent, 'Page event');
    assert.notEqual(harness.document.getElementById('lastCounted').textContent, 'Never');
  });

  it('renders GPT-5.5 Pro API proxy cost without pricing unknown sends', () => {
    const today = todayKey();
    const harness = createPopupScriptHarness({
      byDate: { [today]: 12 },
      byModel: { [today]: { 'gpt-5-5-pro': 7, unknown: 5 } },
    });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('cost').textContent, '~$0.840');
    assert.match(harness.document.getElementById('costNote').textContent, /7 sends priced/);
    assert.match(harness.document.getElementById('costNote').textContent, /5 sends unpriced/);
  });
});
