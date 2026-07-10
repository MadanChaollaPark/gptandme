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
    inputText = 'Hello from the test composer',
  } = options;
  const form = new TestElement('form');
  const input = new TestElement('textarea');
  input.textContent = inputText;
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

    assert.equal(harness.messages.length, 1);
    const [message] = JSON.parse(JSON.stringify(harness.messages));
    assert.equal(message.type, 'tick');
    assert.equal(message.model, 'unknown');
    assert.equal(message.provider, 'claude');
    assert.equal(message.site, 'claude.ai');
    assert.equal(message.reason, 'claude-dom-fallback');
    assert.match(message.sessionId, /^claude:page-/);
    assert.match(message.eventId, /^claude:page-.*:send-1$/);
    assert.doesNotMatch(message.sessionId, /test-thread|\/chat\//);
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
