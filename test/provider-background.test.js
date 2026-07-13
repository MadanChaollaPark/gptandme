const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shared = require('../shared');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function chromeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
  };
}

function nestedTotal(day = {}) {
  return Object.values(day || {}).reduce((providerTotal, models) => (
    providerTotal + Object.values(models || {}).reduce(
      (modelTotal, count) => modelTotal + Number(count || 0),
      0
    )
  ), 0);
}

function loadBackground({
  initialStorage = {},
  manifestVersion = '9.9.9',
  grokAccessGranted = true,
} = {}) {
  const storage = clone(initialStorage);
  const onInstalled = chromeEvent();
  const onStartup = chromeEvent();
  const onMessage = chromeEvent();
  const onBeforeRequest = chromeEvent();
  const onStorageChanged = chromeEvent();
  const onAlarm = chromeEvent();

  const chrome = {
    action: {
      setBadgeBackgroundColor() {},
      setBadgeTextColor() {},
      setBadgeText() {},
    },
    alarms: {
      create() {},
      onAlarm,
    },
    permissions: {
      async contains({ origins }) {
        return Boolean(grokAccessGranted && origins?.includes('https://grok.com/*'));
      },
    },
    runtime: {
      getManifest() {
        return { version: manifestVersion };
      },
      onInstalled,
      onMessage,
      onStartup,
    },
    storage: {
      local: {
        get(defaults, callback) {
          callback({ ...clone(defaults), ...clone(storage) });
        },
        set(data, callback) {
          Object.assign(storage, clone(data));
          callback?.();
        },
      },
      onChanged: onStorageChanged,
    },
    webRequest: {
      onBeforeRequest,
    },
  };

  const sandbox = {
    chrome,
    console,
    Date,
    GptAndMeShared: shared,
    importScripts() {},
    TextDecoder,
    Uint8Array,
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'),
    sandbox,
    { filename: 'background.js' }
  );

  return { chrome, sandbox, storage };
}

function sendMessage(env, message, sender = {}) {
  const listener = env.chrome.runtime.onMessage.listeners[0];
  return new Promise((resolve) => {
    const keepAlive = listener(message, sender, resolve);
    if (keepAlive !== true) setImmediate(() => resolve(undefined));
  });
}

describe('background provider/model persistence', () => {
  it('persists content-bridge fixtures for every supported browser provider', async () => {
    const env = loadBackground();
    const fixtures = [
      ['claude.ai', 1, 'claude:network-1', 'sonnet-5-medium', 'claude-network'],
      ['gemini.google.com', 2, 'gemini:dom-1', 'unknown', 'dom-event'],
      ['perplexity.ai', 3, 'perplexity:network-1', 'sonar-pro', 'perplexity-network'],
      ['grok.com', 4, 'grok:network-1', 'grok-4', 'grok-network'],
      ['chatgpt.com', 5, 'chatgpt:dom-1', 'gpt-5.5', 'chatgpt-dom-fallback'],
    ];

    for (const [host, tabId, eventId, model, reason] of fixtures) {
      const response = clone(await sendMessage(env, {
        type: 'tick',
        eventId,
        model,
        reason,
        sessionId: `${host}:page-fixture`,
      }, { tab: { id: tabId, url: `https://${host}/` } }));
      assert.deepEqual(response, { ok: true, counted: true });
    }

    const day = shared.todayKey();
    assert.equal(env.storage.byDate[day], fixtures.length);
    assert.equal(env.storage.byModel[day]['sonnet-5-medium'], 1);
    assert.equal(env.storage.byModel[day].unknown, 1);
    assert.equal(env.storage.byModel[day]['sonar-pro'], 1);
    assert.equal(env.storage.byModel[day]['grok-4'], 1);
    assert.equal(env.storage.byModel[day]['gpt-5.5'], 1);
    assert.equal(env.storage.byProviderModel[day].claude['sonnet-5-medium'], 1);
    assert.equal(env.storage.byProviderModel[day].gemini.unknown, 1);
    assert.equal(env.storage.byProviderModel[day].perplexity['sonar-pro'], 1);
    assert.equal(env.storage.byProviderModel[day].grok['grok-4'], 1);
    assert.equal(env.storage.byProviderModel[day].chatgpt['gpt-5.5'], 1);
  });

  it('attributes and acknowledges Grok ticks from the sender tab with stable dedupe', async () => {
    const env = loadBackground();
    const message = {
      type: 'tick',
      eventId: 'grok:evt-message-1',
      model: 'grok-4',
      provider: 'claude',
      site: 'claude.ai',
      sessionId: 'grok:page-session-1',
      reason: 'grok-network',
    };
    const sender = { tab: { id: 42, url: 'https://grok.com/' } };

    const counted = clone(await sendMessage(env, message, sender));
    const deduped = clone(await sendMessage(env, message, sender));
    const day = shared.todayKey();

    assert.deepEqual(counted, { ok: true, counted: true });
    assert.deepEqual(deduped, { ok: true, counted: false });
    assert.equal(env.storage.byDate[day], 1);
    assert.equal(env.storage.byProviderModel[day].grok['grok-4'], 1);
    assert.equal(env.storage.lastCountSite, 'grok.com');
  });

  it('increments Claude and both Perplexity hosts into canonical joint buckets', async () => {
    const env = loadBackground();

    await env.sandbox.increment(
      'claude-sonnet',
      'claude.ai',
      'session-claude',
      'dedupe-claude',
      'unit-test'
    );
    await env.sandbox.increment(
      'sonar',
      'www.perplexity.ai',
      'session-perplexity-www',
      'dedupe-perplexity-www',
      'unit-test'
    );
    await env.sandbox.increment(
      'sonar',
      'perplexity.ai',
      'session-perplexity-apex',
      'dedupe-perplexity-apex',
      'unit-test'
    );
    await env.sandbox.increment(
      'gpt-5',
      'chatgpt.com',
      'session-chatgpt',
      'dedupe-chatgpt',
      'unit-test'
    );

    const day = shared.todayKey();
    assert.equal(env.storage.byDate[day], 4);
    assert.equal(env.storage.byModel[day].sonar, 2);
    assert.equal(env.storage.byProviderModel[day].claude['claude-sonnet'], 1);
    assert.equal(env.storage.byProviderModel[day].perplexity.sonar, 2);
    assert.equal(env.storage.byProviderModel[day].chatgpt['gpt-5'], 1);
    assert.equal(nestedTotal(env.storage.byProviderModel[day]), 4);
  });

  it('normalizes v1 storage as unknown-provider history without changing totals', async () => {
    const env = loadBackground({
      initialStorage: {
        byDate: { '2026-07-08': 4 },
        byModel: { '2026-07-08': { 'gpt-5': 3 } },
        byHour: {},
        sessions: {},
        total: 4,
        storageSchemaVersion: 1,
      },
    });

    const response = clone(await sendMessage(env, { type: 'getStatus' }));

    assert.equal(response.ok, true);
    assert.equal(response.status.total, 4);
    assert.equal(response.status.byProviderModel['2026-07-08'].unknown['gpt-5'], 3);
    assert.equal(response.status.byProviderModel['2026-07-08'].unknown.unknown, 1);
    assert.equal(nestedTotal(response.status.byProviderModel['2026-07-08']), 4);
  });

  it('preserves joint data through background export and import', async () => {
    const source = loadBackground({
      initialStorage: {
        byDate: { '2026-07-10': 5 },
        byModel: {
          '2026-07-10': {
            sonnet: 2,
            sonar: 3,
          },
        },
        byProviderModel: {
          '2026-07-10': {
            claude: { sonnet: 2 },
            perplexity: { sonar: 3 },
          },
        },
        byHour: {},
        sessions: {},
        total: 5,
      },
    });
    const exported = clone(await sendMessage(source, { type: 'exportData' }));
    assert.equal(exported.ok, true);

    const destination = loadBackground();
    const imported = clone(await sendMessage(destination, {
      type: 'importData',
      payload: exported.export,
    }));

    assert.equal(imported.ok, true);
    assert.equal(destination.storage.byDate['2026-07-10'], 5);
    assert.equal(destination.storage.byProviderModel['2026-07-10'].claude.sonnet, 2);
    assert.equal(destination.storage.byProviderModel['2026-07-10'].perplexity.sonar, 3);
    assert.equal(nestedTotal(destination.storage.byProviderModel['2026-07-10']), 5);
  });

  it('normalizes hostile persisted provider/model keys before exposing status', async () => {
    delete Object.prototype.polluted;
    const hostileJoint = JSON.parse(`{
      "2026-07-10": {
        "__proto__": { "polluted": 100 },
        "constructor": { "bad": 100 },
        "claude.ai": {
          "sonnet": 2,
          "__proto__": 100,
          "negative": -4
        },
        "www.perplexity.ai": { "sonar": 1 }
      }
    }`);
    const env = loadBackground({
      initialStorage: {
        byDate: { '2026-07-10': 3 },
        byModel: { '2026-07-10': { sonnet: 2, sonar: 1 } },
        byProviderModel: hostileJoint,
      },
    });

    const response = clone(await sendMessage(env, { type: 'getStatus' }));
    const day = response.status.byProviderModel['2026-07-10'];

    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.hasOwn(day, '__proto__'), false);
    assert.equal(Object.hasOwn(day, 'constructor'), false);
    assert.equal(Object.hasOwn(day.claude, '__proto__'), false);
    assert.equal(Object.hasOwn(day.claude, 'negative'), false);
    assert.equal(day.claude.sonnet, 2);
    assert.equal(day.perplexity.sonar, 1);
    assert.equal(nestedTotal(day), 3);
  });
});
