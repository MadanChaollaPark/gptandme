const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const injectSource = fs.readFileSync(
  path.join(__dirname, '..', 'inject.js'),
  'utf8'
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEnvironment(hostname) {
  const events = [];
  const fetchCalls = [];
  const webSocketCalls = [];
  let opaqueId = 0;
  let now = 1_000_000;

  class HarnessDate extends Date {
    static now() {
      return now;
    }
  }

  function nativeFetch(...args) {
    fetchCalls.push({ args, thisValue: this });
    return Promise.resolve({ call: fetchCalls.length, transport: 'fetch' });
  }

  function TestWebSocket(url = `wss://${hostname}/socket.io/`) {
    this.url = url;
  }
  TestWebSocket.prototype.send = function nativeSend(...args) {
    webSocketCalls.push({ args, thisValue: this });
    return `websocket-call-${webSocketCalls.length}`;
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
    Date: HarnessDate,
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
    advanceTime(milliseconds) {
      now += milliseconds;
    },
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

function socketFrame(eventName, query, params) {
  return `42${JSON.stringify([eventName, query, JSON.stringify(params)])}`;
}

describe('page network intent interception', () => {
  describe('Claude fetch requests', () => {
    it('detects completion and completion2 while preserving stable, private metadata', async () => {
      const environment = createEnvironment('claude.ai');
      const completionBody = JSON.stringify({
        completion_request_id: 'request-alpha-001',
        model: 'claude-sonnet-4',
        prompt: 'sanitized-fixture-alpha',
      });
      const completion2Body = JSON.stringify({
        model_name: 'Claude Opus 4',
        prompt: 'sanitized-fixture-beta',
        turn_message_uuids: { human_message_uuid: 'turn-beta-002' },
      });

      const first = await callFetch(
        environment,
        '/api/organizations/org-fixture/chat_conversations/chat-fixture/completion',
        { body: completionBody, method: 'POST' }
      );
      const second = await callFetch(
        environment,
        'https://claude.ai/api/organizations/org-fixture/chat_conversations/chat-fixture/completion2',
        { body: completion2Body, method: 'post' }
      );

      assert.deepEqual(first, { call: 1, transport: 'fetch' });
      assert.deepEqual(second, { call: 2, transport: 'fetch' });
      assert.equal(environment.fetchCalls.length, 2, 'the original fetch must run for every request');
      assert.strictEqual(environment.fetchCalls[0].thisValue, environment.window);
      assert.deepEqual(sendEvents(environment), [
        {
          eventId: 'claude:request-alpha-001',
          model: 'claude-sonnet-4',
          provider: 'claude',
        },
        {
          eventId: 'claude:turn-beta-002',
          model: 'claude-opus-4',
          provider: 'claude',
        },
      ]);

      const serializedEvents = JSON.stringify(environment.events);
      assert.doesNotMatch(serializedEvents, /sanitized-fixture-alpha/);
      assert.doesNotMatch(serializedEvents, /sanitized-fixture-beta/);
      for (const detail of sendEvents(environment)) {
        assert.deepEqual(Object.keys(detail).sort(), ['eventId', 'model', 'provider']);
      }
    });

    it('gives separate rapid identical sends distinct opaque IDs when no stable request ID exists', async () => {
      const environment = createEnvironment('claude.ai');
      const body = JSON.stringify({
        model: 'claude-sonnet-4',
        prompt: 'sanitized-fallback-fixture',
      });
      const endpoint = '/api/organizations/org-fixture/chat_conversations/chat-fixture/completion';

      await callFetch(environment, endpoint, { body, method: 'POST' });
      await callFetch(environment, endpoint, { body, method: 'POST' });
      environment.advanceTime(1001);
      await callFetch(environment, endpoint, { body, method: 'POST' });

      const details = sendEvents(environment);
      assert.equal(details.length, 3);
      assert.notEqual(details[0].eventId, details[1].eventId);
      assert.notEqual(details[1].eventId, details[2].eventId);
      assert.match(details[0].eventId, /^claude:local-opaque-\d+$/);
      assert.doesNotMatch(details[0].eventId, /sanitized|fallback|fixture/i);
      assert.doesNotMatch(JSON.stringify(details), /sanitized-fallback-fixture/);
      assert.equal(environment.fetchCalls.length, 3);
    });

    it('counts an attachment-only human send with an opaque request ID', async () => {
      const environment = createEnvironment('claude.ai');
      await callFetch(
        environment,
        '/api/organizations/org-fixture/chat_conversations/chat-fixture/completion',
        {
          body: JSON.stringify({
            attachments: [{ id: 'sanitized-file-id' }],
            completion_request_id: 'attachment-request-001',
          }),
          method: 'POST',
        }
      );

      assert.deepEqual(sendEvents(environment), [{
        eventId: 'claude:attachment-request-001',
        model: null,
        provider: 'claude',
      }]);
      assert.doesNotMatch(JSON.stringify(environment.events), /sanitized-file-id/);
    });

    it('ignores retry, status, title, and non-POST traffic without blocking fetch', async () => {
      const environment = createEnvironment('claude.ai');
      const base = '/api/organizations/org-fixture/chat_conversations/chat-fixture';
      const requests = [
        [`${base}/retry`, { body: '{"prompt":"sanitized-retry"}', method: 'POST' }],
        [`${base}/status`, { body: '{"prompt":"sanitized-status"}', method: 'POST' }],
        [`${base}/title`, { body: '{"prompt":"sanitized-title"}', method: 'POST' }],
        [`${base}/completion`, { body: '{"prompt":"sanitized-get"}', method: 'GET' }],
        [`${base}/completion`, { body: '{}', method: 'POST' }],
        [`${base}/completion`, { body: '{"model":"claude-sonnet-4"}', method: 'POST' }],
        [`${base}/completion`, {
          body: '{"completion_request_id":"continuation-without-human-input"}',
          method: 'POST',
        }],
      ];

      for (const [url, init] of requests) {
        await callFetch(environment, url, init);
      }

      assert.equal(environment.fetchCalls.length, requests.length);
      assert.deepEqual(sendEvents(environment), []);
    });
  });

  describe('Perplexity fetch requests', () => {
    it('detects a user-authored SSE ask and emits only opaque metadata', async () => {
      const environment = createEnvironment('www.perplexity.ai');
      const body = JSON.stringify({
        params: JSON.stringify({
          frontend_uuid: 'perplexity-sse-001',
          model: 'sonar-pro',
          query_source: 'user',
        }),
        query_str: 'sanitized-sse-fixture',
      });

      const result = await callFetch(
        environment,
        'https://www.perplexity.ai/rest/sse/perplexity_ask',
        { body, method: 'POST' }
      );

      assert.deepEqual(result, { call: 1, transport: 'fetch' });
      assert.equal(environment.fetchCalls.length, 1);
      assert.deepEqual(sendEvents(environment), [{
        eventId: 'perplexity:perplexity-sse-001',
        model: 'sonar-pro',
        provider: 'perplexity',
      }]);
      assert.doesNotMatch(JSON.stringify(environment.events), /sanitized-sse-fixture/);
    });

    it('filters retry, related-query, background, and input-free SSE requests', async () => {
      const environment = createEnvironment('perplexity.ai');
      const cases = [
        { params: { query_source: 'retry' }, query_str: 'sanitized-retry' },
        { params: { query_source: 'related_query' }, query_str: 'sanitized-related' },
        { params: { is_related_query: true }, query_str: 'sanitized-related-flag' },
        { params: { is_background: true }, query_str: 'sanitized-background' },
        { params: { query_source: 'user' }, query_str: '   ' },
      ];

      for (const fixture of cases) {
        await callFetch(environment, '/rest/sse/perplexity_ask/', {
          body: JSON.stringify({
            ...fixture,
            params: JSON.stringify(fixture.params),
          }),
          method: 'POST',
        });
      }

      assert.equal(environment.fetchCalls.length, cases.length);
      assert.deepEqual(sendEvents(environment), []);
    });
  });

  describe('Grok fetch requests', () => {
    it('detects a new-conversation send and a follow-up response send', async () => {
      const environment = createEnvironment('grok.com');
      const newBody = JSON.stringify({
        message: 'sanitized-grok-fixture-alpha',
        modelName: 'grok-4',
        request_id: 'grok-new-001',
      });
      const responseBody = JSON.stringify({
        message: 'sanitized-grok-fixture-beta',
        modelName: 'grok-4-heavy',
        request_id: 'grok-response-002',
      });

      const first = await callFetch(
        environment,
        'https://grok.com/rest/app-chat/conversations/new',
        { body: newBody, method: 'POST' }
      );
      const second = await callFetch(
        environment,
        '/rest/app-chat/conversations/conversation-fixture/responses',
        { body: responseBody, method: 'post' }
      );

      assert.deepEqual(first, { call: 1, transport: 'fetch' });
      assert.deepEqual(second, { call: 2, transport: 'fetch' });
      assert.equal(environment.fetchCalls.length, 2);
      assert.deepEqual(sendEvents(environment), [
        {
          eventId: 'grok:grok-new-001',
          model: 'grok-4',
          provider: 'grok',
        },
        {
          eventId: 'grok:grok-response-002',
          model: 'grok-4-heavy',
          provider: 'grok',
        },
      ]);
      assert.doesNotMatch(JSON.stringify(environment.events), /sanitized-grok-fixture/);
    });

    it('counts an attachment-only send without leaking content', async () => {
      const environment = createEnvironment('grok.com');
      await callFetch(
        environment,
        '/rest/app-chat/conversations/new',
        {
          body: JSON.stringify({
            message: '',
            fileAttachments: [{ id: 'sanitized-grok-file' }],
            request_id: 'grok-attachment-001',
          }),
          method: 'POST',
        }
      );

      assert.deepEqual(sendEvents(environment), [{
        eventId: 'grok:grok-attachment-001',
        model: null,
        provider: 'grok',
      }]);
      assert.doesNotMatch(JSON.stringify(environment.events), /sanitized-grok-file/);
    });

    it('ignores GET, non-matching paths, and input-free bodies without blocking fetch', async () => {
      const environment = createEnvironment('grok.com');
      const requests = [
        ['/rest/app-chat/conversations/new', { body: '{"message":"sanitized-get"}', method: 'GET' }],
        ['/rest/app-chat/conversations/conv-1/title', { body: '{"message":"sanitized-title"}', method: 'POST' }],
        ['/rest/app-chat/conversations/conv-1/responses/extra', { body: '{"message":"sanitized-nested"}', method: 'POST' }],
        ['/rest/app-chat/conversations', { body: '{"message":"sanitized-root"}', method: 'POST' }],
        ['/rest/app-chat/conversations/new', { body: '{}', method: 'POST' }],
        ['/rest/app-chat/conversations/new', { body: '{"message":"   "}', method: 'POST' }],
      ];

      for (const [url, init] of requests) {
        await callFetch(environment, url, init);
      }

      assert.equal(environment.fetchCalls.length, requests.length);
      assert.deepEqual(sendEvents(environment), []);
    });
  });

  describe('Perplexity WebSocket requests', () => {
    it('detects an ask frame, filters non-user frames, and always calls native send', () => {
      const environment = createEnvironment('perplexity.ai');
      const socket = new environment.window.WebSocket();
      const frames = [
        socketFrame('perplexity_ask', 'sanitized-websocket-fixture', {
          frontend_uuid: 'perplexity-ws-001',
          model: 'sonar',
          query_source: 'user',
        }),
        socketFrame('telemetry', 'sanitized-telemetry', { query_source: 'user' }),
        socketFrame('perplexity_ask', 'sanitized-retry', { query_source: 'retry' }),
        socketFrame('perplexity_ask', 'sanitized-related', { query_source: 'related_query' }),
        socketFrame('perplexity_ask', 'sanitized-background', { is_background: true }),
        socketFrame('perplexity_ask', '   ', { query_source: 'user' }),
        'not-a-json-frame',
        new Uint8Array([1, 2, 3]),
      ];

      const results = frames.map((frame) => socket.send(frame));

      assert.deepEqual(results, frames.map((_, index) => `websocket-call-${index + 1}`));
      assert.equal(environment.webSocketCalls.length, frames.length);
      for (const call of environment.webSocketCalls) {
        assert.strictEqual(call.thisValue, socket);
      }
      assert.deepEqual(sendEvents(environment), [{
        eventId: 'perplexity:perplexity-ws-001',
        model: 'sonar',
        provider: 'perplexity',
      }]);
      assert.doesNotMatch(JSON.stringify(environment.events), /sanitized-websocket-fixture/);
    });

    it('does not inspect user-shaped frames on unrelated sockets', () => {
      const environment = createEnvironment('perplexity.ai');
      const socket = new environment.window.WebSocket('wss://perplexity.ai/notifications');

      socket.send(socketFrame('perplexity_ask', 'sanitized-unrelated-query', {
        frontend_uuid: 'unrelated-socket-001',
        model: 'sonar',
      }));

      assert.equal(environment.webSocketCalls.length, 1);
      assert.deepEqual(sendEvents(environment), []);
    });
  });

  it('wraps fetch and WebSocket at most once when inject.js is loaded repeatedly', async () => {
    const environment = createEnvironment('perplexity.ai');
    const wrappedFetch = environment.window.fetch;
    const wrappedWebSocketSend = environment.window.WebSocket.prototype.send;

    environment.load();

    assert.strictEqual(environment.window.fetch, wrappedFetch);
    assert.strictEqual(environment.window.WebSocket.prototype.send, wrappedWebSocketSend);
    assert.notStrictEqual(wrappedFetch, environment.nativeFetch);
    assert.notStrictEqual(wrappedWebSocketSend, environment.nativeWebSocketSend);

    await callFetch(environment, '/rest/sse/perplexity_ask', {
      body: JSON.stringify({
        params: JSON.stringify({ frontend_uuid: 'idempotent-fetch-001' }),
        query_str: 'sanitized-idempotent-fetch',
      }),
      method: 'POST',
    });
    const socket = new environment.window.WebSocket();
    socket.send(socketFrame('perplexity_ask', 'sanitized-idempotent-socket', {
      frontend_uuid: 'idempotent-socket-001',
    }));

    assert.equal(environment.fetchCalls.length, 1, 'native fetch must not be called through nested wrappers');
    assert.equal(environment.webSocketCalls.length, 1, 'native send must not be called through nested wrappers');
    assert.equal(sendEvents(environment).length, 2, 'each user intent must emit once');
  });
});
