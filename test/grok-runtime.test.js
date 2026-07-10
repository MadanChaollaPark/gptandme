const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { SITES, providerForHost } = require('../shared.js');
const { TestElement, createContentScriptHarness } = require('./helpers');

const injectSource = fs.readFileSync(
  path.join(__dirname, '..', 'inject.js'),
  'utf8'
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEnvironment(hostname = 'grok.com') {
  const events = [];
  const fetchCalls = [];
  const webSocketCalls = [];
  let opaqueId = 0;

  function nativeFetch(...args) {
    fetchCalls.push({ args, thisValue: this });
    return Promise.resolve({ call: fetchCalls.length, transport: 'native-fetch' });
  }

  class TestWebSocket {
    constructor(url = 'wss://grok.com/ws/gw/') {
      this.url = url;
    }
  }

  TestWebSocket.prototype.send = function nativeSend(...args) {
    webSocketCalls.push({ args, thisValue: this });
    return `native-websocket-${webSocketCalls.length}`;
  };

  const nativeWebSocketSend = TestWebSocket.prototype.send;

  class TestCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const window = {
    WebSocket: TestWebSocket,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
    fetch: nativeFetch,
  };
  window.window = window;

  const sandbox = {
    CustomEvent: TestCustomEvent,
    Date,
    Math,
    Request,
    String,
    URL,
    URLSearchParams,
    console,
    crypto: {
      randomUUID() {
        opaqueId += 1;
        return `opaque-${opaqueId}`;
      },
    },
    location: {
      hostname,
      origin: `https://${hostname}`,
    },
    window,
  };

  vm.createContext(sandbox);

  function load() {
    vm.runInContext(injectSource, sandbox, { filename: 'inject.js' });
  }

  load();

  return {
    events,
    fetchCalls,
    load,
    nativeFetch,
    nativeWebSocketSend,
    sandbox,
    webSocketCalls,
    window,
  };
}

async function settleInspection() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function callFetch(environment, input, init) {
  const result = await environment.window.fetch(input, init);
  await settleInspection();
  return result;
}

function sendEvents(environment) {
  return environment.events
    .filter((event) => event.type === '__gptandme_send')
    .map((event) => plain(event.detail));
}

function assertPrivateGrokEvent(detail, expectedEventId) {
  assert.deepEqual(Object.keys(detail).sort(), ['eventId', 'model', 'provider']);
  assert.equal(detail.provider, 'grok');
  assert.equal(detail.eventId, expectedEventId);
  assert.match(detail.eventId, /^grok:[a-zA-Z0-9:._-]+$/);
  assert.doesNotMatch(JSON.stringify(detail), /private|secret|marigold|prompt text/i);
}

function directUserTurn(eventId, prompt = 'private direct prompt text') {
  return {
    type: 'conversation.item.create',
    event_id: eventId,
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: prompt }],
      x_grok: { client_message_id: 'client-message-opaque' },
    },
  };
}

function multiplexedUserTurn(eventId, prompt = 'secret multiplex prompt text') {
  return {
    session_id: 'private-conversation-session',
    event: {
      type: 'conversation.item.create',
      event_id: eventId,
      item: {
        type: 'message',
        role: 'user',
        x_grok: { input_chunks: [prompt] },
      },
    },
  };
}

describe('Grok current runtime contract', () => {
  describe('REST intent detection', () => {
    it('counts both official endpoints with and without a trailing slash', async () => {
      const environment = createEnvironment();
      const requests = [
        [
          '/rest/app-chat/conversations/new',
          { message: 'private prompt text one', modelName: 'grok-4', request_id: 'rest-new-1' },
        ],
        [
          '/rest/app-chat/conversations/new/',
          { message: 'private prompt text two', modelName: 'grok-4', request_id: 'rest-new-2' },
        ],
        [
          '/rest/app-chat/conversations/conversation-1/responses',
          { message: 'private prompt text three', modelName: 'grok-4-heavy', request_id: 'rest-response-1' },
        ],
        [
          '/rest/app-chat/conversations/conversation-1/responses/',
          { message: 'private prompt text four', modelName: 'grok-4-heavy', request_id: 'rest-response-2' },
        ],
      ];

      const results = [];
      for (const [url, body] of requests) {
        results.push(await callFetch(environment, url, {
          body: JSON.stringify(body),
          method: 'post',
        }));
      }

      assert.deepEqual(results, requests.map((_, index) => ({
        call: index + 1,
        transport: 'native-fetch',
      })));
      assert.equal(environment.fetchCalls.length, requests.length);
      for (const call of environment.fetchCalls) {
        assert.strictEqual(call.thisValue, environment.window);
      }

      const details = sendEvents(environment);
      assert.equal(details.length, requests.length);
      for (const [index, expectedId] of [
        'grok:rest-new-1',
        'grok:rest-new-2',
        'grok:rest-response-1',
        'grok:rest-response-2',
      ].entries()) {
        assertPrivateGrokEvent(details[index], expectedId);
      }
      assert.doesNotMatch(JSON.stringify(details), /private prompt text/i);
    });

    it('counts attachment-only sends without exposing attachment metadata', async () => {
      const environment = createEnvironment();

      const result = await callFetch(
        environment,
        '/rest/app-chat/conversations/new',
        {
          body: JSON.stringify({
            message: '   ',
            fileAttachments: [{ id: 'secret-grok-attachment-marigold' }],
            request_id: 'rest-attachment-1',
          }),
          method: 'POST',
        }
      );

      assert.deepEqual(result, { call: 1, transport: 'native-fetch' });
      const details = sendEvents(environment);
      assert.equal(details.length, 1);
      assertPrivateGrokEvent(details[0], 'grok:rest-attachment-1');
      assert.doesNotMatch(JSON.stringify(details), /attachment-marigold/i);
    });

    it('rejects regeneration requests while preserving native fetch', async () => {
      const environment = createEnvironment();
      const cases = [
        '/rest/app-chat/conversations/new',
        '/rest/app-chat/conversations/conversation-1/responses',
      ];

      for (const [index, url] of cases.entries()) {
        const result = await callFetch(environment, url, {
          body: JSON.stringify({
            isRegenRequest: true,
            message: `private regenerated prompt text ${index}`,
            request_id: `rest-regen-${index}`,
          }),
          method: 'POST',
        });
        assert.deepEqual(result, { call: index + 1, transport: 'native-fetch' });
      }

      assert.equal(environment.fetchCalls.length, cases.length);
      assert.deepEqual(sendEvents(environment), []);
    });
  });

  describe('gateway WebSocket intent detection', () => {
    it('counts a direct /ws/gw user item and preserves native send', () => {
      const environment = createEnvironment();
      const socket = new environment.window.WebSocket('wss://grok.com/ws/gw/?uid=user-1');
      const frames = [
        JSON.stringify({
          type: 'session.create',
          event_id: 'evt-init-direct',
          session: { model: 'grok-4' },
        }),
        JSON.stringify(directUserTurn('evt-msg-direct-1')),
      ];

      const results = frames.map((frame) => socket.send(frame));

      assert.deepEqual(results, ['native-websocket-1', 'native-websocket-2']);
      assert.equal(environment.webSocketCalls.length, frames.length);
      for (const call of environment.webSocketCalls) {
        assert.strictEqual(call.thisValue, socket);
      }
      const details = sendEvents(environment);
      assert.equal(details.length, 1);
      assertPrivateGrokEvent(details[0], 'grok:evt-msg-direct-1');
      assert.doesNotMatch(JSON.stringify(details), /private direct prompt text/i);
    });

    it('counts a multiplexed /ws/mgw user envelope and preserves native send', () => {
      const environment = createEnvironment();
      const socket = new environment.window.WebSocket('wss://grok.com/ws/mgw/?uid=user-1');
      const frames = [
        JSON.stringify({
          session_id: 'private-conversation-session',
          event: {
            type: 'session.create',
            event_id: 'evt-init-multiplexed',
            session: { model: 'grok-4' },
          },
        }),
        JSON.stringify(multiplexedUserTurn('evt-msg-multiplexed-1')),
      ];

      const results = frames.map((frame) => socket.send(frame));

      assert.deepEqual(results, ['native-websocket-1', 'native-websocket-2']);
      assert.equal(environment.webSocketCalls.length, frames.length);
      for (const call of environment.webSocketCalls) {
        assert.strictEqual(call.thisValue, socket);
      }
      const details = sendEvents(environment);
      assert.equal(details.length, 1);
      assertPrivateGrokEvent(details[0], 'grok:evt-msg-multiplexed-1');
      assert.doesNotMatch(JSON.stringify(details), /secret multiplex|private-conversation/i);
    });

    it('ignores non-user and non-send frames without disrupting the socket', () => {
      const environment = createEnvironment();
      const socket = new environment.window.WebSocket('wss://grok.com/ws/mgw/?uid=user-1');
      const frames = [
        JSON.stringify({ type: 'response.create', event_id: 'evt-response' }),
        JSON.stringify({
          type: 'conversation.item.create',
          event_id: 'evt-assistant',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'assistant output' }],
          },
        }),
        JSON.stringify({ type: 'ping', event_id: 'evt-ping' }),
        JSON.stringify({
          type: 'conversation.history.load',
          event_id: 'evt-history',
          load_id: 'history-load',
        }),
        JSON.stringify({
          type: 'conversation.item.create',
          event_id: 'evt-empty-user',
          item: { type: 'message', role: 'user', content: [] },
        }),
        JSON.stringify({
          session_id: 'session-1',
          event: { type: 'response.create', event_id: 'evt-multiplexed-response' },
        }),
        JSON.stringify({
          session_id: 'session-1',
          event: {
            type: 'conversation.item.create',
            event_id: 'evt-multiplexed-assistant',
            item: {
              type: 'message',
              role: 'assistant',
              x_grok: { input_chunks: ['assistant data'] },
            },
          },
        }),
        'not-json',
        new Uint8Array([1, 2, 3]),
      ];

      const results = frames.map((frame) => socket.send(frame));

      assert.deepEqual(
        results,
        frames.map((_, index) => `native-websocket-${index + 1}`)
      );
      assert.equal(environment.webSocketCalls.length, frames.length);
      assert.deepEqual(sendEvents(environment), []);
    });

    it('does not inspect user-shaped traffic on unrelated Grok sockets', () => {
      const environment = createEnvironment();
      const socket = new environment.window.WebSocket('wss://grok.com/ws/notifications/');
      const frame = JSON.stringify(directUserTurn('evt-unrelated-socket'));

      const result = socket.send(frame);

      assert.equal(result, 'native-websocket-1');
      assert.equal(environment.webSocketCalls.length, 1);
      assert.deepEqual(sendEvents(environment), []);
    });

    it('installs each wrapper once and keeps both native transports callable', async () => {
      const environment = createEnvironment();
      const wrappedFetch = environment.window.fetch;
      const wrappedWebSocketSend = environment.window.WebSocket.prototype.send;

      assert.notStrictEqual(wrappedFetch, environment.nativeFetch);
      assert.notStrictEqual(wrappedWebSocketSend, environment.nativeWebSocketSend);

      environment.load();

      assert.strictEqual(environment.window.fetch, wrappedFetch);
      assert.strictEqual(environment.window.WebSocket.prototype.send, wrappedWebSocketSend);

      const fetchResult = await callFetch(environment, '/not-a-grok-endpoint', {
        body: '{}',
        method: 'POST',
      });
      const socket = new environment.window.WebSocket('wss://grok.com/ws/gw/');
      const socketResult = socket.send('not-json');

      assert.deepEqual(fetchResult, { call: 1, transport: 'native-fetch' });
      assert.equal(socketResult, 'native-websocket-1');
      assert.strictEqual(environment.fetchCalls[0].thisValue, environment.window);
      assert.strictEqual(environment.webSocketCalls[0].thisValue, socket);
    });
  });

  describe('DOM and provider configuration', () => {
    it('declares Grok network fallback and current stable composer contracts', () => {
      const config = SITES['grok.com'];

      assert.ok(config, 'grok.com must have a site configuration');
      assert.equal(config.provider, 'grok');
      assert.equal(providerForHost('grok.com'), 'grok');
      assert.equal(config.countViaPageNetwork, true);
      assert.equal(config.domFallback, true);
      assert.ok(config.hosts.includes('grok.com'));
      assert.ok(
        config.sendButtons.includes('button[data-testid="chat-submit"]'),
        'use Grok\'s stable chat-submit test id before generic submit selectors'
      );
      assert.ok(
        config.sendButtons.includes('button[aria-label="Submit"][type="submit"]'),
        'retain the accessible Submit selector as a fallback'
      );
      assert.ok(
        config.composerInputs.some((selector) => (
          selector.includes('[contenteditable="true"]')
          && selector.includes('[role="textbox"]')
          && selector.includes('[aria-label="Ask Grok anything"]')
        )),
        'target the visible Grok textbox instead of its auxiliary textarea'
      );
    });

    it('counts the current live-like Grok composer despite its auxiliary textarea', () => {
      const harness = createContentScriptHarness({ hostname: 'grok.com' });
      const form = new TestElement('form');
      const queryBar = new TestElement('div', { class: 'query-bar' });
      const editor = new TestElement('div', {
        'aria-label': 'Ask Grok anything',
        contenteditable: 'true',
        role: 'textbox',
      });
      editor.textContent = 'private fixture prompt';
      const auxiliary = new TestElement('textarea', { 'aria-hidden': 'true' });
      const submit = new TestElement('button', {
        'aria-label': 'Submit',
        'data-testid': 'chat-submit',
        type: 'submit',
      });
      queryBar.append(editor, auxiliary, submit);
      form.append(queryBar);
      harness.document.body.append(form);

      harness.dispatch('keydown', {
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: 'Enter',
        metaKey: false,
        shiftKey: false,
        target: editor,
      });

      assert.equal(harness.messages.length, 1);
      const [message] = plain(harness.messages);
      assert.equal(message.provider, 'grok');
      assert.equal(message.site, 'grok.com');
      assert.equal(message.reason, 'grok-dom-fallback');
      assert.doesNotMatch(JSON.stringify(message), /private fixture prompt/);
    });

    it('does not count Grok feedback controls as chat prompts', () => {
      const harness = createContentScriptHarness({ hostname: 'grok.com' });
      const form = new TestElement('form');
      const feedback = new TestElement('textarea', { 'aria-label': 'Feedback note' });
      feedback.textContent = 'private feedback, not a Grok prompt';
      const submit = new TestElement('button', {
        'aria-label': 'Submit feedback',
        type: 'submit',
      });
      const icon = new TestElement('span');
      submit.append(icon);
      form.append(feedback, submit);
      harness.document.body.append(form);

      harness.dispatch('keydown', {
        altKey: false,
        ctrlKey: false,
        isComposing: false,
        key: 'Enter',
        metaKey: false,
        shiftKey: false,
        target: feedback,
      });
      harness.dispatch('click', { target: icon });

      assert.deepEqual(harness.messages, []);
    });
  });
});
