const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TestElement, createContentScriptHarness } = require('./helpers');

function fakeEnterEvent(target, overrides = {}) {
  return {
    target,
    key: 'Enter',
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function composer(options = {}) {
  const {
    sendAttributes = { 'aria-label': 'Send message' },
    sendOptions = {},
    busyAttributes = null,
  } = options;
  const form = new TestElement('form');
  const input = new TestElement('textarea');
  const send = new TestElement('button', sendAttributes, sendOptions);

  form.append(input, send);
  if (busyAttributes) {
    form.append(new TestElement('button', busyAttributes));
  }

  return { input, send };
}

describe('content send gating', () => {
  it('ticks for Enter from a composer with an active send button', () => {
    const harness = createContentScriptHarness({
      hostname: 'claude.ai',
      pathname: '/chat/test-thread',
    });
    const { input } = composer();

    harness.dispatch('keydown', fakeEnterEvent(input));

    assert.deepEqual(JSON.parse(JSON.stringify(harness.messages)), [{
      type: 'tick',
      model: 'unknown',
      site: 'claude.ai',
      sessionId: 'claude.ai:/chat/test-thread',
      reason: 'dom-event',
    }]);
  });

  it('does not tick when the send button is disabled', () => {
    const harness = createContentScriptHarness();
    const { input, send } = composer({ sendOptions: { disabled: true } });

    harness.dispatch('keydown', fakeEnterEvent(input));
    harness.dispatch('click', { target: send });

    assert.deepEqual(harness.messages, []);
  });

  it('does not tick while the composer shows a stop control', () => {
    const harness = createContentScriptHarness();
    const { input, send } = composer({
      busyAttributes: { 'aria-label': 'Stop generating' },
    });

    harness.dispatch('keydown', fakeEnterEvent(input));
    harness.dispatch('click', { target: send });

    assert.deepEqual(harness.messages, []);
  });

  it('ignores Enter outside a composer even if the key would otherwise count', () => {
    const harness = createContentScriptHarness();
    const outsideComposer = new TestElement('div');

    harness.dispatch('keydown', fakeEnterEvent(outsideComposer));

    assert.deepEqual(harness.messages, []);
  });

  it('throttles repeated DOM events inside the content-script window', () => {
    const harness = createContentScriptHarness();
    const { send } = composer();

    harness.setNow(1000);
    harness.dispatch('click', { target: send });
    harness.setNow(1200);
    harness.dispatch('click', { target: send });
    harness.setNow(1501);
    harness.dispatch('click', { target: send });

    assert.equal(harness.messages.length, 2);
  });
});
