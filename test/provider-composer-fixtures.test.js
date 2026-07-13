const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TestElement, createContentScriptHarness } = require('./helpers');

const PRIVATE_PATH_SEGMENT = 'private-conversation-7f4c1d';
const PRIVATE_PROMPT = 'Confidential launch codename marigold';

function enterEvent(target, overrides = {}) {
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

function nestedComposer({ input, send, busyControl = null }) {
  // Sanitized representation of the provider layouts: the editor and actions
  // live in separate, multi-level branches beneath their shared composer root.
  const root = new TestElement('form', { 'data-testid': 'composer-root' });
  const editorBranch = new TestElement('div', { 'data-testid': 'editor-branch' });
  const editorPadding = new TestElement('div');
  const editorSurface = new TestElement('div');
  editorSurface.append(input);
  editorPadding.append(editorSurface);
  editorBranch.append(editorPadding);

  const actionsBranch = new TestElement('div', { 'data-testid': 'actions-branch' });
  const actionsRow = new TestElement('div');
  const sendSlot = new TestElement('div');
  const clickTarget = new TestElement('span', { 'aria-hidden': 'true' });
  send.append(clickTarget);
  sendSlot.append(send);
  actionsRow.append(sendSlot);
  if (busyControl) actionsRow.append(busyControl);
  actionsBranch.append(actionsRow);

  root.append(editorBranch, actionsBranch);
  return { root, input, send, clickTarget };
}

function claudeComposer(options = {}) {
  const {
    prompt = PRIVATE_PROMPT,
    disabled = false,
    busy = false,
    queued = false,
  } = options;
  const input = new TestElement('div', {
    'data-testid': 'chat-input',
    'contenteditable': 'true',
    'aria-label': 'Write your prompt to Claude',
  });
  input.textContent = prompt;

  const send = new TestElement('button', {
    'aria-label': queued ? 'Queue message' : 'Send message',
    'data-testid': queued ? 'queue-message' : 'send-message',
  }, { disabled });
  const busyControl = busy
    ? new TestElement('button', { 'aria-label': 'Stop response' })
    : null;

  return nestedComposer({ input, send, busyControl });
}

function perplexityComposer(options = {}) {
  const {
    prompt = PRIVATE_PROMPT,
    disabled = false,
    busy = false,
  } = options;
  const input = new TestElement('textarea', {
    id: 'ask-input',
    'data-lexical-editor': 'true',
  });
  input.value = prompt;

  const send = new TestElement('button', {
    'aria-label': 'Submit',
    'data-testid': 'submit-button',
  }, { disabled });
  const busyControl = busy
    ? new TestElement('button', { 'aria-label': 'Stop generating answer' })
    : null;

  return nestedComposer({ input, send, busyControl });
}

function harnessFor(provider, options = {}) {
  const hostname = provider === 'claude' ? 'claude.ai' : 'www.perplexity.ai';
  return createContentScriptHarness({
    hostname,
    pathname: `/chat/${PRIVATE_PATH_SEGMENT}`,
    ...options,
  });
}

function plainMessages(harness) {
  return JSON.parse(JSON.stringify(harness.messages));
}

function assertSingleOpaqueTick(harness, provider) {
  const [message] = plainMessages(harness);
  const expectedSite = provider === 'claude' ? 'claude.ai' : 'www.perplexity.ai';

  assert.equal(harness.messages.length, 1, 'one user send must produce exactly one tick');
  assert.equal(message.type, 'tick');
  assert.equal(message.provider, provider);
  assert.equal(message.site, expectedSite);
  assert.equal(message.reason, `${provider}-dom-fallback`);
  assert.match(message.sessionId, new RegExp(`^${provider}:page-[^/:]+$`));
  assert.match(message.eventId, new RegExp(`^${provider}:page-[^/:]+:send-1$`));

  for (const id of [message.sessionId, message.eventId]) {
    assert.equal(id.includes(PRIVATE_PATH_SEGMENT), false, 'ID must not contain the pathname');
    assert.equal(id.includes('/chat/'), false, 'ID must not contain route structure');
    assert.equal(id.includes(PRIVATE_PROMPT), false, 'ID must not contain prompt text');
    assert.equal(id.includes('marigold'), false, 'ID must not contain prompt fragments');
  }
}

for (const provider of ['claude', 'perplexity']) {
  const buildComposer = provider === 'claude' ? claudeComposer : perplexityComposer;

  describe(`${provider} live-like composer fixture`, () => {
    it('counts bare Enter exactly once across nested sibling branches', () => {
      const harness = harnessFor(provider);
      const { input } = buildComposer();

      harness.dispatch('keydown', enterEvent(input));

      assertSingleOpaqueTick(harness, provider);
    });

    it('counts a nested send-button click exactly once', () => {
      const harness = harnessFor(provider);
      const { clickTarget } = buildComposer();

      harness.dispatch('click', { target: clickTarget });

      assertSingleOpaqueTick(harness, provider);
    });

    it('deduplicates Enter and the corresponding send-button click', () => {
      const harness = harnessFor(provider);
      const { input, clickTarget } = buildComposer();

      harness.dispatch('keydown', enterEvent(input));
      harness.dispatch('click', { target: clickTarget });

      assertSingleOpaqueTick(harness, provider);
    });

    it('does not count an empty composer', () => {
      const harness = harnessFor(provider);
      const { input, clickTarget } = buildComposer({ prompt: '   \n  ' });

      harness.dispatch('keydown', enterEvent(input));
      harness.dispatch('click', { target: clickTarget });

      assert.deepEqual(harness.messages, []);
    });

    it('does not count with a disabled send button', () => {
      const harness = harnessFor(provider);
      const { input, clickTarget } = buildComposer({ disabled: true });

      harness.dispatch('keydown', enterEvent(input));
      harness.dispatch('click', { target: clickTarget });

      assert.deepEqual(harness.messages, []);
    });

    it('does not count while the composer is busy', () => {
      const harness = harnessFor(provider);
      const { input, clickTarget } = buildComposer({ busy: true });

      harness.dispatch('keydown', enterEvent(input));
      harness.dispatch('click', { target: clickTarget });

      assert.deepEqual(harness.messages, []);
    });

    it('does not count Shift+Enter', () => {
      const harness = harnessFor(provider);
      const { input } = buildComposer();

      harness.dispatch('keydown', enterEvent(input, { shiftKey: true }));

      assert.deepEqual(harness.messages, []);
    });
  });
}

describe('provider-specific live-like controls', () => {
  it('counts Claude queued-send even while a response is busy', () => {
    const harness = harnessFor('claude');
    const { clickTarget } = claudeComposer({ busy: true, queued: true });

    harness.dispatch('click', { target: clickTarget });

    assertSingleOpaqueTick(harness, 'claude');
  });

  it('counts Perplexity #ask-input submitted through its Submit control', () => {
    const harness = harnessFor('perplexity');
    const { input, clickTarget } = perplexityComposer();

    assert.equal(input.id, 'ask-input');
    harness.dispatch('click', { target: clickTarget });

    assertSingleOpaqueTick(harness, 'perplexity');
  });

  it('does not count Enter while Perplexity typeahead is selecting a suggestion', () => {
    const harness = harnessFor('perplexity');
    const { input } = perplexityComposer();
    harness.document.body.append(new TestElement('div', {
      id: 'typeahead-menu',
      role: 'listbox',
    }));

    harness.dispatch('keydown', enterEvent(input));

    assert.deepEqual(harness.messages, []);
  });
});

describe('page-network to content-script bridge', () => {
  it('cancels a pending DOM fallback when the matching provider network event arrives', () => {
    const harness = harnessFor('claude', { deferTimers: true });
    const { input } = claudeComposer();

    harness.dispatch('keydown', enterEvent(input));
    assert.deepEqual(harness.messages, []);

    harness.emitWindowEvent('__gptandme_send', {
      detail: { provider: 'claude', eventId: 'claude:request-1', model: 'sonnet' },
    });
    harness.runTimers();

    assert.equal(harness.messages.length, 1);
    assert.equal(harness.messages[0].reason, 'claude-network');
    assert.equal(harness.messages[0].eventId, 'claude:request-1');
  });

  it('forwards two distinct rapid network events without time-window suppression', () => {
    const harness = harnessFor('perplexity', { deferTimers: true });

    for (const eventId of ['perplexity:request-1', 'perplexity:request-2']) {
      harness.emitWindowEvent('__gptandme_send', {
        detail: { provider: 'perplexity', eventId, model: 'sonar' },
      });
    }

    assert.deepEqual(
      harness.messages.map((message) => message.eventId),
      ['perplexity:request-1', 'perplexity:request-2']
    );
  });

  it('ignores malformed and wrong-provider page events', () => {
    const harness = harnessFor('claude', { deferTimers: true });

    harness.emitWindowEvent('__gptandme_send', { detail: null });
    harness.emitWindowEvent('__gptandme_send', {
      detail: { provider: 'perplexity', eventId: 'perplexity:wrong-provider' },
    });
    harness.emitWindowEvent('__gptandme_send', {
      detail: { provider: 'claude' },
    });

    assert.deepEqual(harness.messages, []);
  });
});
