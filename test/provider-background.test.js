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

function loadBackground({ initialStorage = {}, manifestVersion = '9.9.9' } = {}) {
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
