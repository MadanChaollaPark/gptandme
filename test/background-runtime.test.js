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

function loadBackground({ initialStorage = {}, manifestVersion = '9.9.9' } = {}) {
  const storage = clone(initialStorage);
  const badge = {};
  const onInstalled = chromeEvent();
  const onStartup = chromeEvent();
  const onMessage = chromeEvent();
  const onBeforeRequest = chromeEvent();
  const onStorageChanged = chromeEvent();

  const chrome = {
    action: {
      setBadgeBackgroundColor({ color }) {
        badge.backgroundColor = color;
      },
      setBadgeTextColor({ color }) {
        badge.textColor = color;
      },
      setBadgeText({ text }) {
        badge.text = text;
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
    setInterval() {
      return 1;
    },
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

  return { badge, chrome, sandbox, storage };
}

function sendMessage(env, message, sender = {}) {
  const listener = env.chrome.runtime.onMessage.listeners[0];
  return new Promise((resolve) => {
    const keepAlive = listener(message, sender, resolve);
    if (keepAlive !== true) setImmediate(() => resolve(undefined));
  });
}

describe('background counting diagnostics', () => {
  it('preserves count updates while recording non-sensitive diagnostics', async () => {
    const env = loadBackground();

    await env.sandbox.increment(
      'gpt-4o',
      'https://chatgpt.com/c/session-id?model=gpt-4o',
      'session-1',
      'dedupe-1',
      'unit-test'
    );

    const day = shared.todayKey();
    const hour = shared.hourKey();
    assert.equal(env.storage.byDate[day], 1);
    assert.equal(env.storage.byHour[hour], 1);
    assert.equal(env.storage.byModel[day]['gpt-4o'], 1);
    assert.equal(env.storage.sessions['session-1'].prompts, 1);
    assert.equal(
      env.storage.sessions['session-1'].site,
      'https://chatgpt.com/c/session-id?model=gpt-4o'
    );
    assert.equal(env.storage.total, 1);

    assert.match(env.storage.lastCountedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(env.storage.lastCountReason, 'unit-test');
    assert.equal(env.storage.lastCountSite, 'chatgpt.com');
    assert.equal(env.storage.lastCountModel, 'gpt-4o');
    assert.equal(env.storage.lastCountSessionId, 'session-1');
    assert.equal(env.storage.extensionVersion, '9.9.9');
    assert.equal(env.storage.storageSchemaVersion, 1);
    assert.equal(env.badge.text, '1');
  });

  it('does not update counts or diagnostics for deduped increments', async () => {
    const env = loadBackground();

    await env.sandbox.increment('gpt-4o', 'chatgpt.com', 'session-1', 'same', 'first');
    const firstCountedAt = env.storage.lastCountedAt;
    await env.sandbox.increment('gpt-4o', 'chatgpt.com', 'session-1', 'same', 'second');

    const day = shared.todayKey();
    assert.equal(env.storage.byDate[day], 1);
    assert.equal(env.storage.byModel[day]['gpt-4o'], 1);
    assert.equal(env.storage.total, 1);
    assert.equal(env.storage.lastCountReason, 'first');
    assert.equal(env.storage.lastCountedAt, firstCountedAt);
  });
});

describe('background storage support hooks', () => {
  it('returns normalized status data', async () => {
    const env = loadBackground({
      initialStorage: {
        byDate: { '2026-01-01': 2 },
        byModel: null,
        total: 2,
      },
    });

    const response = clone(await sendMessage(env, { type: 'getStatus' }));

    assert.equal(response.ok, true);
    assert.deepEqual(response.status.byDate, { '2026-01-01': 2 });
    assert.deepEqual(response.status.byModel, {});
    assert.deepEqual(response.status.byHour, {});
    assert.deepEqual(response.status.sessions, {});
    assert.equal(response.status.total, 2);
    assert.equal(response.status.storageSchemaVersion, 1);
    assert.equal(response.status.extensionVersion, '9.9.9');
  });

  it('exports and imports storage snapshots from extension UI senders', async () => {
    const day = shared.todayKey();
    const env = loadBackground({
      initialStorage: {
        byDate: { [day]: 2 },
        byModel: { [day]: { unknown: 2 } },
        byHour: {},
        sessions: {},
        total: 2,
        lastCountReason: 'existing',
      },
    });

    const exported = await sendMessage(env, { type: 'exportData' });
    assert.equal(exported.ok, true);
    assert.equal(exported.export.schemaVersion, 1);
    assert.equal(exported.export.storageSchemaVersion, 1);
    assert.equal(exported.export.extensionVersion, '9.9.9');
    assert.equal(exported.export.data.total, 2);
    assert.equal(exported.export.data.lastCountReason, 'existing');

    const unauthorized = await sendMessage(
      env,
      { type: 'importData', payload: { data: { total: 99 } } },
      { tab: { id: 123 } }
    );
    assert.equal(unauthorized.ok, false);
    assert.match(unauthorized.error, /extension UI/);

    const imported = await sendMessage(env, {
      type: 'importData',
      payload: {
        data: {
          byDate: { [day]: 4 },
          byModel: { [day]: { 'gpt-4o': 4 } },
          byHour: {},
          sessions: { restored: { prompts: 4, site: 'chatgpt.com' } },
          total: 4,
          lastCountReason: 'restore-test',
        },
      },
    });

    assert.equal(imported.ok, true);
    assert.equal(imported.import.total, 4);
    assert.equal(env.storage.byDate[day], 4);
    assert.equal(env.storage.byModel[day]['gpt-4o'], 4);
    assert.equal(env.storage.sessions.restored.prompts, 4);
    assert.equal(env.storage.total, 4);
    assert.equal(env.storage.lastCountReason, 'restore-test');
    assert.equal(env.storage.extensionVersion, '9.9.9');
    assert.equal(env.badge.text, '4');
  });
});
