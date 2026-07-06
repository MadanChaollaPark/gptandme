const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createPopupScriptHarness } = require('./helpers');

describe('popup diagnostics display', () => {
  it('renders unavailable active-tab status and manifest version without tabs access', () => {
    const harness = createPopupScriptHarness();

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'Unavailable');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Unknown');
    assert.equal(harness.document.getElementById('version').textContent, 'test-version');
  });

  it('renders stored last-count diagnostics with user-facing reason labels', () => {
    const harness = createPopupScriptHarness({
      lastCountedAt: '2026-01-02T03:04:00.000Z',
      lastCountReason: 'dom-event',
    });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'Unavailable');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Unknown');
    assert.equal(harness.document.getElementById('lastReason').textContent, 'Page event');
    assert.notEqual(harness.document.getElementById('lastCounted').textContent, 'Never');
  });
});
