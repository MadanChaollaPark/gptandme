const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shared = require('../shared');
const { TestElement } = require('./helpers');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

function createDocument() {
  const listeners = new Map();
  const document = {
    documentElement: new TestElement('html'),
    head: new TestElement('head'),
    body: new TestElement('body'),

    createElement(tagName) {
      const element = new TestElement(tagName);
      element.ownerDocument = document;
      return element;
    },

    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },

    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) || []) {
        callback(event);
      }
    },

    querySelectorAll(selector) {
      return document.documentElement.querySelectorAll(selector);
    },

    querySelector(selector) {
      return document.querySelectorAll(selector)[0] || null;
    },
  };

  document.documentElement.ownerDocument = document;
  document.head.ownerDocument = document;
  document.body.ownerDocument = document;
  document.documentElement.append(document.head, document.body);

  return document;
}

function createHarness({ hostname = 'chatgpt.com', beforeRun = null } = {}) {
  const document = createDocument();
  const messages = [];
  const observers = [];
  const timers = new Map();
  const windowListeners = new Map();
  let timerId = 1;
  let now = 1_000;

  class HarnessDate extends Date {
    static now() {
      return now;
    }
  }

  class HarnessMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      observers.push(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
      this.active = true;
    }

    disconnect() {
      this.active = false;
    }
  }

  function notifyMutations() {
    for (const observer of [...observers]) {
      if (observer.active) observer.callback([{ type: 'childList' }], observer);
    }
  }

  function addWindowListener(type, callback) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(callback);
  }

  beforeRun?.({ document, notifyMutations });

  const location = {
    hostname,
    href: `https://${hostname}/`,
    pathname: '/',
  };

  const context = {
    Date: HarnessDate,
    Element: TestElement,
    GptAndMeShared: shared,
    MutationObserver: HarnessMutationObserver,
    URL,
    clearTimeout(id) {
      timers.delete(id);
    },
    chrome: {
      runtime: {
        sendMessage(message) {
          messages.push(JSON.parse(JSON.stringify(message)));
          return Promise.resolve({ ok: true });
        },
      },
    },
    console,
    crypto: {
      randomUUID() {
        return 'content-thinking-page';
      },
    },
    document,
    location,
    queueMicrotask(callback) {
      callback();
    },
    setTimeout(callback, delay = 0) {
      const id = timerId;
      timerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    window: {
      MutationObserver: HarnessMutationObserver,
      addEventListener: addWindowListener,
    },
  };
  context.globalThis = context;

  vm.runInNewContext(contentSource, context, { filename: 'content.js' });

  return {
    document,
    messages,
    notifyMutations,
    setNow(value) {
      now = value;
    },
    advanceNow(delta) {
      now += delta;
    },
    dispatch(type, event) {
      document.dispatch(type, event);
    },
    emitWindowEvent(type, event) {
      for (const callback of windowListeners.get(type) || []) callback(event);
    },
    runTimers(maxDelay = 2000) {
      const pending = [...timers.entries()]
        .filter(([, timer]) => timer.delay <= maxDelay);
      for (const [id] of pending) timers.delete(id);
      for (const [, timer] of pending) timer.callback();
    },
    runImmediateTimers() {
      const pending = [...timers.entries()]
        .filter(([, timer]) => timer.delay === 0);
      for (const [id] of pending) timers.delete(id);
      for (const [, timer] of pending) timer.callback();
    },
    navigate(pathname) {
      location.pathname = pathname;
      location.href = `https://${hostname}${pathname}`;
      notifyMutations();
    },
    activeObserverCount() {
      return observers.filter((observer) => observer.active).length;
    },
  };
}

function enterEvent(target) {
  return {
    target,
    key: 'Enter',
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
}

function appendComposer(document, prompt = 'please think carefully') {
  const form = new TestElement('form');
  const input = new TestElement('textarea');
  input.textContent = prompt;
  const send = new TestElement('button', { 'data-testid': 'send-button' });
  form.append(input, send);
  document.body.append(form);
  return { form, input, send };
}

function realUserSend(harness) {
  harness.advanceNow(THINKING_TEST_SEND_INTERVAL_MS);
  const { input } = appendComposer(harness.document);
  harness.dispatch('keydown', enterEvent(input));
  harness.runTimers();
}

const THINKING_TEST_SEND_INTERVAL_MS = 500;

function appendAssistantTurn(
  harness,
  {
    turnId = 'turn-fixture-1',
    label = 'Thought for 22s',
    modelSlug = 'GPT-5.5 Pro',
    prose = '',
    includeButton = true,
  } = {}
) {
  const section = new TestElement('section', {
    'data-turn': 'assistant',
    'data-turn-id': turnId,
  });
  const model = new TestElement('div', { 'data-message-model-slug': modelSlug });
  section.append(model);

  if (prose) {
    const proseElement = new TestElement('p');
    proseElement.textContent = prose;
    section.append(proseElement);
  }

  if (includeButton) {
    const button = new TestElement('button');
    button.textContent = label;
    section.append(button);
  }

  harness.document.body.append(section);
  harness.notifyMutations();
  return section;
}

function thinkingMessages(harness) {
  return harness.messages.filter((message) => message.type === 'thinkingMetric');
}

describe('ChatGPT provider-reported thinking DOM capture', () => {
  it('does not backfill historical labels or capture labels without a real send', () => {
    const harness = createHarness({
      beforeRun({ document }) {
        const historical = new TestElement('section', { 'data-turn-id': 'historical-turn' });
        const button = new TestElement('button');
        button.textContent = 'Thought for 22s';
        historical.append(button);
        document.body.append(historical);
      },
    });

    appendAssistantTurn(harness, { turnId: 'ungated-turn', label: 'Thought for 33s' });
    assert.deepEqual(thinkingMessages(harness), []);

    realUserSend(harness);
    assert.deepEqual(thinkingMessages(harness), []);

    appendAssistantTurn(harness, {
      turnId: 'fresh-turn',
      label: 'Thought for 44s',
      modelSlug: 'gpt-5.5',
    });

    assert.equal(thinkingMessages(harness).length, 1);
    assert.equal(thinkingMessages(harness)[0].eventId, 'fresh-turn');
  });

  it('emits a minimal thinkingMetric from a new assistant turn after user send', () => {
    const harness = createHarness();

    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'turn-opaque-123',
      label: 'Thought for 22s',
      modelSlug: 'GPT-5.5 Pro',
    });

    const [metric] = thinkingMessages(harness);
    assert.deepEqual(Object.keys(metric).sort(), [
      'eventId',
      'model',
      'source',
      'thinkingMs',
      'type',
    ]);
    assert.deepEqual(metric, {
      type: 'thinkingMetric',
      eventId: 'turn-opaque-123',
      model: 'gpt-5.5-pro',
      thinkingMs: 22_000,
      source: 'provider-reported',
    });
  });

  it('parses multi-unit short labels and dedupes by opaque turn id', () => {
    const harness = createHarness();

    realUserSend(harness);
    const section = appendAssistantTurn(harness, {
      turnId: 'dedupe-turn',
      label: 'Thought for 1h 2m 3s',
      modelSlug: 'o3',
    });
    harness.notifyMutations();

    const duplicate = new TestElement('section', { 'data-turn-id': 'dedupe-turn' });
    const duplicateButton = new TestElement('button');
    duplicateButton.textContent = 'Thought for 9s';
    duplicate.append(duplicateButton);
    harness.document.body.append(duplicate);
    harness.notifyMutations();

    assert.equal(section.getAttribute('data-turn-id'), 'dedupe-turn');
    assert.deepEqual(thinkingMessages(harness), [{
      type: 'thinkingMetric',
      eventId: 'dedupe-turn',
      model: 'o3',
      thinkingMs: 3_723_000,
      source: 'provider-reported',
    }]);
  });

  it('uses the shared exact-label parser for word-unit provider labels', () => {
    const harness = createHarness();

    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'word-unit-label',
      label: 'Reasoned for 1 minute 2 seconds',
      modelSlug: 'o3',
    });

    assert.deepEqual(thinkingMessages(harness), [{
      type: 'thinkingMetric',
      eventId: 'word-unit-label',
      model: 'o3',
      thinkingMs: 62_000,
      source: 'provider-reported',
    }]);
  });

  it('uses only exact button labels and valid 1s..6h durations', () => {
    const harness = createHarness();

    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'prose-only',
      includeButton: false,
      prose: 'The assistant prose says Thought for 22s, but it is not a provider label.',
    });
    assert.deepEqual(thinkingMessages(harness), []);

    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'zero-duration',
      label: 'Thought for 0s',
    });
    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'too-long',
      label: 'Thought for 6h 1s',
    });
    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'not-exact',
      label: 'Thought about it for 22s',
    });
    assert.deepEqual(thinkingMessages(harness), []);

    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'six-hour-boundary',
      label: 'Thought for 6h',
      modelSlug: 'gpt-5.5',
    });

    assert.equal(thinkingMessages(harness).length, 1);
    assert.equal(thinkingMessages(harness)[0].eventId, 'six-hour-boundary');
    assert.equal(thinkingMessages(harness)[0].thinkingMs, 21_600_000);
  });

  it('does not let an untimed response authorize a later response', () => {
    const harness = createHarness();

    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'untimed-response',
      includeButton: false,
    });
    appendAssistantTurn(harness, {
      turnId: 'later-without-send',
      label: 'Thought for 9s',
    });

    assert.deepEqual(thinkingMessages(harness), []);

    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'later-after-send',
      label: 'Thought for 10s',
    });
    assert.equal(thinkingMessages(harness).length, 1);
    assert.equal(thinkingMessages(harness)[0].eventId, 'later-after-send');
  });

  it('queues one timing capture for duplicate DOM events from the same send', () => {
    const harness = createHarness();
    const { input } = appendComposer(harness.document);

    harness.dispatch('keydown', enterEvent(input));
    harness.dispatch('keydown', enterEvent(input));
    harness.runTimers();

    appendAssistantTurn(harness, {
      turnId: 'single-authorized-response',
      label: 'Thought for 7s',
    });
    appendAssistantTurn(harness, {
      turnId: 'should-not-have-a-second-authorization',
      label: 'Thought for 8s',
    });

    assert.deepEqual(thinkingMessages(harness).map((message) => message.eventId), [
      'single-authorized-response',
    ]);
  });

  it('keeps distinct queued sends inside the prompt fallback window', () => {
    const harness = createHarness();
    const { input, send } = appendComposer(harness.document, 'first queued prompt');

    harness.advanceNow(500);
    harness.dispatch('keydown', enterEvent(input));
    harness.runImmediateTimers();
    harness.advanceNow(1);
    input.textContent = 'second queued prompt';
    send.setAttribute('aria-label', 'Queue message');
    harness.dispatch('keydown', enterEvent(input));
    harness.runTimers();

    appendAssistantTurn(harness, {
      turnId: 'queued-response-one',
      label: 'Thought for 7s',
    });
    appendAssistantTurn(harness, {
      turnId: 'queued-response-two',
      label: 'Thought for 8s',
    });

    assert.deepEqual(thinkingMessages(harness).map((message) => message.eventId), [
      'queued-response-one',
      'queued-response-two',
    ]);
  });

  it('rejects synthetic page-script DOM events as timing authorization', () => {
    const harness = createHarness();
    const { input } = appendComposer(harness.document);

    harness.dispatch('keydown', { ...enterEvent(input), isTrusted: false });
    appendAssistantTurn(harness, {
      turnId: 'synthetic-dom-authorized',
      label: 'Thought for 7s',
    });

    assert.deepEqual(thinkingMessages(harness), []);
  });

  it('disconnects after a busy response finalizes without a timing label', () => {
    const harness = createHarness();
    realUserSend(harness);
    const stop = new TestElement('button', { 'aria-label': 'Stop generating' });
    harness.document.body.append(stop);
    harness.notifyMutations();
    appendAssistantTurn(harness, {
      turnId: 'finalized-untimed-response',
      includeButton: false,
    });
    assert.equal(harness.activeObserverCount(), 1);

    stop.remove();
    harness.notifyMutations();

    assert.equal(harness.activeObserverCount(), 0);
    assert.deepEqual(thinkingMessages(harness), []);
  });

  it('disconnects when a pending capture expires without another page mutation', () => {
    const harness = createHarness();

    realUserSend(harness);
    assert.equal(harness.activeObserverCount(), 1);
    harness.advanceNow(31 * 60 * 1000);
    harness.runTimers(31 * 60 * 1000);

    assert.equal(harness.activeObserverCount(), 0);
  });

  it('drops pending capture when navigating to another existing conversation', () => {
    const harness = createHarness();
    harness.navigate('/c/current');

    realUserSend(harness);
    harness.navigate('/c/another');
    appendAssistantTurn(harness, {
      turnId: 'historical-after-navigation',
      label: 'Thought for 12s',
    });
    assert.deepEqual(thinkingMessages(harness), []);

    realUserSend(harness);
    appendAssistantTurn(harness, {
      turnId: 'fresh-after-navigation',
      label: 'Thought for 13s',
    });
    assert.equal(thinkingMessages(harness).length, 1);
    assert.equal(thinkingMessages(harness)[0].eventId, 'fresh-after-navigation');
  });

  it('keeps capture when a new conversation is assigned its first URL', () => {
    const harness = createHarness();

    realUserSend(harness);
    harness.navigate('/c/new-conversation');
    appendAssistantTurn(harness, {
      turnId: 'first-new-conversation-response',
      label: 'Thought for 14s',
    });

    assert.equal(thinkingMessages(harness).length, 1);
    assert.equal(thinkingMessages(harness)[0].eventId, 'first-new-conversation-response');
  });

  it('never captures timing from page-world ChatGPT send events or other providers', () => {
    const chatgpt = createHarness();
    chatgpt.emitWindowEvent('__gptandme_send', {
      detail: {
        provider: 'chatgpt',
        eventId: 'page-script-spoof',
        model: 'gpt-5.5',
      },
    });
    appendAssistantTurn(chatgpt, {
      turnId: 'unauthorized-page-event-turn',
      label: 'Thought for 5s',
      modelSlug: 'gpt-5.5',
    });

    assert.deepEqual(thinkingMessages(chatgpt), []);

    const claude = createHarness({ hostname: 'claude.ai' });
    claude.emitWindowEvent('__gptandme_send', {
      detail: {
        provider: 'claude',
        eventId: 'claude:network-send',
        model: 'claude-sonnet-5',
      },
    });
    appendAssistantTurn(claude, {
      turnId: 'claude-turn',
      label: 'Thought for 5s',
      modelSlug: 'claude-sonnet-5',
    });

    assert.deepEqual(thinkingMessages(claude), []);
  });
});
