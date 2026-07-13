const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createPopupScriptHarness, todayKey } = require('./helpers');

describe('popup diagnostics display', () => {
  it('uses readable labels for ChatGPT fallback and network corrections', () => {
    assert.equal(require('../popup').formatReason('chatgpt-dom-fallback'), 'Page fallback');
    assert.equal(require('../popup').formatReason('chatgpt-network-upgrade'), 'Network correction');
  });

  it('renders active-tab status and manifest version', () => {
    const harness = createPopupScriptHarness();

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'chatgpt.com supported');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Supported site');
    assert.equal(harness.document.getElementById('statusValue').className, 'pill supported');
    assert.equal(harness.document.getElementById('version').textContent, 'test-version');
  });

  it('distinguishes a supported Grok tab whose optional access is off', () => {
    const harness = createPopupScriptHarness({ activeTabUrl: 'https://grok.com/' });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'grok.com access off');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Grok access off');
    assert.equal(harness.document.getElementById('statusValue').className, 'pill unsupported');
  });

  it('shows a Grok tab as supported after optional access is granted', () => {
    const harness = createPopupScriptHarness(
      { activeTabUrl: 'https://grok.com/' },
      { grokPermissionGranted: true }
    );

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'grok.com supported');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Supported site');
    assert.equal(harness.document.getElementById('statusValue').className, 'pill supported');
  });

  it('falls back to last seen supported site when active tab URL is unavailable', () => {
    const harness = createPopupScriptHarness({
      activeTabUrl: null,
      lastSeenSite: 'claude.ai',
    });

    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('currentSite').textContent, 'Last seen claude.ai');
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Supported site');
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
    assert.equal(harness.document.getElementById('statusValue').textContent, 'Site unknown');
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

  it('gives the seven-day chart dated, count-specific accessible text', () => {
    const today = todayKey();
    const harness = createPopupScriptHarness({ byDate: { [today]: 3 } });

    harness.fireDOMContentLoaded();

    const sparkline = harness.document.getElementById('sparkline');
    assert.match(sparkline.getAttribute('aria-label'), /^Last 7 days: /);
    assert.match(sparkline.getAttribute('aria-label'), /3 prompts/);
    assert.equal(sparkline.children.length, 7);
    assert.match(sparkline.children.at(-1).title, /3 prompts/);
    assert.equal(sparkline.children.at(-1).getAttribute('aria-hidden'), 'true');
  });
});
