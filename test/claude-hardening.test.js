const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const {
  TestElement,
  createContentScriptHarness,
} = require('./helpers');

const injectSource = fs.readFileSync(
  path.join(__dirname, '..', 'inject.js'),
  'utf8'
);

const CLAUDE_ENDPOINT = (
  '/api/organizations/org-fixture/' +
  'chat_conversations/conversation-fixture/completion'
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInjectEnvironment() {
  const events = [];
  const fetchCalls = [];
  const xhrCalls = [];
  let opaqueId = 0;

  function nativeFetch(...args) {
    fetchCalls.push({ args, thisValue: this });
    return Promise.resolve({ ok: true });
  }

  function TestWebSocket() {}
  TestWebSocket.prototype.send = function nativeWebSocketSend() {};

  function TestXMLHttpRequest() {}
  TestXMLHttpRequest.prototype.open = function nativeOpen(method, url) {
    this.nativeMethod = method;
    this.nativeUrl = url;
    return 'native-open-result';
  };
  TestXMLHttpRequest.prototype.send = function nativeSend(body) {
    xhrCalls.push({
      body,
      method: this.nativeMethod,
      thisValue: this,
      url: this.nativeUrl,
    });
    return 'native-send-result';
  };

  class TestCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const window = {
    XMLHttpRequest: TestXMLHttpRequest,
    WebSocket: TestWebSocket,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
    fetch: nativeFetch,
  };
  window.window = window;

  const sandbox = {
    ArrayBuffer,
    Blob,
    CustomEvent: TestCustomEvent,
    Date,
    FormData,
    Math,
    Request,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    URLSearchParams,
    XMLHttpRequest: TestXMLHttpRequest,
    console,
    crypto: {
      ...webcrypto,
      randomUUID() {
        opaqueId += 1;
        return `opaque-${opaqueId}`;
      },
    },
    location: {
      hostname: 'claude.ai',
      origin: 'https://claude.ai',
    },
    window,
  };

  vm.createContext(sandbox);
  vm.runInContext(injectSource, sandbox, { filename: 'inject.js' });

  return {
    events,
    fetchCalls,
    window,
    xhrCalls,
  };
}

async function settleInspection() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function callFetch(environment, endpoint, body, method = 'POST') {
  const result = await environment.window.fetch(endpoint, { body, method });
  await settleInspection();
  return result;
}

function sendEvents(environment) {
  return environment.events
    .filter((event) => event.type === '__gptandme_send')
    .map((event) => plain(event.detail));
}

function claudeBody(id, prompt = 'sanitized Claude fixture') {
  return JSON.stringify({
    completion_request_id: id,
    model: 'claude-sonnet-4',
    prompt,
  });
}

function assertClaudeEvents(environment, expectedIds) {
  const details = sendEvents(environment);
  assert.deepEqual(
    details.map((detail) => detail.eventId),
    expectedIds.map((id) => `claude:${id}`)
  );
  for (const detail of details) {
    assert.equal(detail.provider, 'claude');
    assert.equal(detail.model, 'claude-sonnet-4');
  }
  assert.doesNotMatch(JSON.stringify(details), /sanitized Claude fixture/);
}

describe('Claude request-body hardening', () => {
  it('extracts an asynchronous JSON Blob body without changing native fetch', async () => {
    const environment = createInjectEnvironment();
    const body = new Blob(
      [claudeBody('blob-request-1')],
      { type: 'application/json' }
    );

    const result = await callFetch(environment, CLAUDE_ENDPOINT, body);

    assert.deepEqual(result, { ok: true });
    assert.equal(environment.fetchCalls.length, 1);
    assert.strictEqual(environment.fetchCalls[0].args[1].body, body);
    assertClaudeEvents(environment, ['blob-request-1']);
  });

  it('decodes ArrayBuffer and offset typed-array JSON bodies', async () => {
    const environment = createInjectEnvironment();
    const encoder = new TextEncoder();
    const arrayBuffer = encoder.encode(claudeBody('array-buffer-request-1')).buffer;
    const encodedView = encoder.encode(claudeBody('typed-view-request-2'));
    const padded = new Uint8Array(encodedView.length + 8);
    padded.set(encodedView, 4);
    const offsetView = padded.subarray(4, 4 + encodedView.length);

    await callFetch(environment, CLAUDE_ENDPOINT, arrayBuffer);
    await callFetch(environment, CLAUDE_ENDPOINT, offsetView);

    assert.equal(environment.fetchCalls.length, 2);
    assertClaudeEvents(environment, [
      'array-buffer-request-1',
      'typed-view-request-2',
    ]);
  });

  it('reads only the safe scalar fields needed from a FormData body', async () => {
    const environment = createInjectEnvironment();
    const form = new FormData();
    form.append('completion_request_id', 'form-request-1');
    form.append('model', 'claude-sonnet-4');
    form.append('prompt', 'sanitized Claude fixture');

    await callFetch(environment, CLAUDE_ENDPOINT, form);

    assert.equal(environment.fetchCalls.length, 1);
    assert.strictEqual(environment.fetchCalls[0].args[1].body, form);
    assertClaudeEvents(environment, ['form-request-1']);
  });
});

describe('Claude transport and endpoint hardening', () => {
  it('rejects method and destination lookalikes before reading request bodies', async () => {
    const environment = createInjectEnvironment();
    let bodyReads = 0;
    class ProbeBlob extends Blob {
      async text() {
        bodyReads += 1;
        return claudeBody('must-not-be-inspected');
      }
    }
    const body = new ProbeBlob(['private probe body'], { type: 'application/json' });

    await callFetch(
      environment,
      `https://claude.ai.evil.example${CLAUDE_ENDPOINT}`,
      body
    );
    await callFetch(environment, CLAUDE_ENDPOINT, body, 'GET');

    assert.equal(bodyReads, 0);
    assert.equal(environment.fetchCalls.length, 2);
    assert.deepEqual(sendEvents(environment), []);
  });

  it('detects a Claude XMLHttpRequest POST and preserves native XHR behavior', async () => {
    const environment = createInjectEnvironment();
    const xhr = new environment.window.XMLHttpRequest();

    const openResult = xhr.open('POST', CLAUDE_ENDPOINT);
    const sendResult = xhr.send(claudeBody('xhr-request-1'));
    await settleInspection();

    assert.equal(openResult, 'native-open-result');
    assert.equal(sendResult, 'native-send-result');
    assert.equal(environment.xhrCalls.length, 1);
    assert.strictEqual(environment.xhrCalls[0].thisValue, xhr);
    assertClaudeEvents(environment, ['xhr-request-1']);
  });

  it('tolerates versioned path prefixes while rejecting lookalike endpoints', async () => {
    const environment = createInjectEnvironment();
    const accepted = [
      [CLAUDE_ENDPOINT, 'endpoint-baseline-1'],
      [
        '/v2/api/organizations/org-fixture/' +
          'chat_conversations/conversation-fixture/completion2',
        'endpoint-prefixed-2',
      ],
      [
        '/internal/proxy/api/organizations/org-fixture/' +
          'chat_conversations/conversation-fixture/completion',
        'endpoint-prefixed-3',
      ],
    ];
    const rejected = [
      '/v2/api/organizations/org-fixture/' +
        'chat_conversations/conversation-fixture/retry',
      '/v2/api/organizations/org-fixture/' +
        'chat_conversations/conversation-fixture/completion/status',
      '/v2/api/organizations/org-fixture/' +
        'not_chat_conversations/conversation-fixture/completion',
      '/v2/api/organizations/org-fixture/chat_conversations/completion',
    ];

    for (const [endpoint, id] of accepted) {
      await callFetch(environment, endpoint, claudeBody(id));
    }
    for (const [index, endpoint] of rejected.entries()) {
      await callFetch(
        environment,
        endpoint,
        claudeBody(`rejected-lookalike-${index}`)
      );
    }
    await callFetch(
      environment,
      '/v2/api/organizations/org-fixture/' +
        'chat_conversations/conversation-fixture/completion',
      claudeBody('rejected-get'),
      'GET'
    );

    assertClaudeEvents(environment, accepted.map(([, id]) => id));
  });
});

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

function deepClaudeComposer(wrapperCount) {
  const root = new TestElement('form', { 'data-testid': 'composer-root' });
  const input = new TestElement('div', {
    'aria-label': 'Write your prompt to Claude',
    'contenteditable': 'true',
    'data-testid': 'chat-input',
  });
  input.textContent = 'sanitized Claude fixture';

  let editorBranch = input;
  for (let index = 0; index < wrapperCount; index += 1) {
    const wrapper = new TestElement('div', {
      'data-depth': String(index),
    });
    wrapper.append(editorBranch);
    editorBranch = wrapper;
  }

  const send = new TestElement('button', {
    'aria-label': 'Send message',
    'data-testid': 'send-message',
  });
  root.append(editorBranch, send);
  return { input, root };
}

function assertOneClaudeDomTick(harness) {
  assert.equal(harness.messages.length, 1);
  const [message] = plain(harness.messages);
  assert.equal(message.type, 'tick');
  assert.equal(message.provider, 'claude');
  assert.equal(message.reason, 'claude-dom-fallback');
}

describe('Claude composer hardening', () => {
  it('finds the semantic composer root beyond twelve ancestors', () => {
    const harness = createContentScriptHarness({ hostname: 'claude.ai' });
    const { input, root } = deepClaudeComposer(16);
    harness.document.body.append(root);

    harness.dispatch('keydown', enterEvent(input));

    assertOneClaudeDomTick(harness);
  });

  it('does not let an unrelated visible listbox suppress composer Enter', () => {
    const harness = createContentScriptHarness({ hostname: 'claude.ai' });
    const { input, root } = deepClaudeComposer(2);
    const unrelatedListbox = new TestElement('div', {
      'aria-label': 'Unrelated navigation choices',
      role: 'listbox',
    });
    unrelatedListbox.getBoundingClientRect = () => ({
      height: 120,
      width: 240,
    });
    harness.document.body.append(root, unrelatedListbox);

    harness.dispatch('keydown', enterEvent(input));

    assertOneClaudeDomTick(harness);
  });
});
