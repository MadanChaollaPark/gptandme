const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shared = require('../shared');

function clone(value) {
  if (value === undefined) return undefined;
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

function loadBackground({
  initialStorage = {},
  manifestVersion = '1.5.0',
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
      async contains() {
        return false;
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

function flushMutations(env) {
  return vm.runInContext('incrementQueue', env.sandbox);
}

describe('background thinking metric storage v3', () => {
  it('records provider-reported ChatGPT thinking metrics without storing raw labels or samples', async () => {
    const env = loadBackground();
    const response = clone(await sendMessage(
      env,
      {
        type: 'thinkingMetric',
        eventId: 'thinking-event-1',
        model: 'gpt-5.5',
        thinkingMs: 2500,
        source: 'provider-reported',
        provider: 'claude',
        site: 'claude.ai',
        rawLabel: 'Thought for 2.5 seconds',
        responseText: 'private assistant answer sample',
      },
      { tab: { id: 1, url: 'https://chatgpt.com/c/thread' } }
    ));

    const day = shared.todayKey();
    const aggregate = env.storage.byThinkingProviderModel[day].chatgpt['gpt-5.5'];

    assert.deepEqual(response, { ok: true, counted: true });
    assert.deepEqual(aggregate, { reportedCount: 1, totalMs: 2500 });
    assert.equal(aggregate.totalMs / aggregate.reportedCount, 2500);
    assert.equal(env.storage.byThinkingProviderModel[day].claude, undefined);
    assert.equal(env.storage.byDate, undefined);
    assert.equal(env.storage.storageSchemaVersion, 3);
    assert.equal(env.storage.extensionVersion, '1.5.0');
    assert.deepEqual(Object.keys(env.storage.recentThinkingEvents), ['chatgpt:thinking-event-1']);

    const serialized = JSON.stringify(env.storage);
    assert.doesNotMatch(serialized, /Thought for 2\.5 seconds/);
    assert.doesNotMatch(serialized, /private assistant answer sample/);
  });

  it('rejects forged providers, unsupported sources, missing IDs, and out-of-range durations', async () => {
    const env = loadBackground();
    const chatgptSender = { tab: { id: 2, url: 'https://chatgpt.com/' } };
    const invalidMessages = [
      {
        type: 'thinkingMetric',
        eventId: 'bad-source',
        model: 'gpt-5.5',
        thinkingMs: 1000,
        source: 'stream-cloned',
      },
      {
        type: 'thinkingMetric',
        eventId: 'too-short',
        model: 'gpt-5.5',
        thinkingMs: 999,
        source: 'provider-reported',
      },
      {
        type: 'thinkingMetric',
        eventId: 'too-long',
        model: 'gpt-5.5',
        thinkingMs: (6 * 60 * 60 * 1000) + 1,
        source: 'provider-reported',
      },
      {
        type: 'thinkingMetric',
        eventId: 'fractional-duration',
        model: 'gpt-5.5',
        thinkingMs: 1000.5,
        source: 'provider-reported',
      },
      {
        type: 'thinkingMetric',
        eventId: 'string-duration',
        model: 'gpt-5.5',
        thinkingMs: '1000',
        source: 'provider-reported',
      },
      {
        type: 'thinkingMetric',
        eventId: 'unsafe event id',
        model: 'gpt-5.5',
        thinkingMs: 1000,
        source: 'provider-reported',
      },
      {
        type: 'thinkingMetric',
        model: 'gpt-5.5',
        thinkingMs: 1000,
        source: 'provider-reported',
      },
    ];

    for (const message of invalidMessages) {
      assert.deepEqual(
        clone(await sendMessage(env, message, chatgptSender)),
        { ok: true, counted: false }
      );
    }

    assert.deepEqual(
      clone(await sendMessage(
        env,
        {
          type: 'thinkingMetric',
          eventId: 'forged-chatgpt',
          model: 'gpt-5.5',
          thinkingMs: 1000,
          source: 'provider-reported',
          provider: 'chatgpt',
        },
        { tab: { id: 3, url: 'https://claude.ai/new' } }
      )),
      { ok: true, counted: false }
    );

    assert.equal(env.storage.byThinkingProviderModel, undefined);
    assert.equal(env.storage.recentThinkingEvents, undefined);
  });

  it('dedupes thinking event IDs and bounds the persisted ledger to 500 recent entries', async () => {
    const now = Date.now();
    const recentThinkingEvents = {};
    for (let index = 0; index < 600; index += 1) {
      recentThinkingEvents[`chatgpt:old-${index}`] = now - index;
    }
    const env = loadBackground({ initialStorage: { recentThinkingEvents } });
    const sender = { tab: { id: 4, url: 'https://chatgpt.com/' } };
    const message = {
      type: 'thinkingMetric',
      eventId: 'bounded-event',
      model: 'gpt-5.5',
      thinkingMs: 1000,
      source: 'provider-reported',
    };

    const first = clone(await sendMessage(env, message, sender));
    const duplicate = clone(await sendMessage(env, { ...message, thinkingMs: 6000 }, sender));

    const day = shared.todayKey();
    assert.deepEqual(first, { ok: true, counted: true });
    assert.deepEqual(duplicate, { ok: true, counted: false });
    assert.deepEqual(
      env.storage.byThinkingProviderModel[day].chatgpt['gpt-5.5'],
      { reportedCount: 1, totalMs: 1000 }
    );
    assert.equal(Object.keys(env.storage.recentThinkingEvents).length, 500);
    assert.equal(Object.hasOwn(env.storage.recentThinkingEvents, 'chatgpt:bounded-event'), true);
  });

  it('preserves thinking aggregates through JSON backup/restore and reset mutations', async () => {
    const today = shared.todayKey();
    const priorDay = '2026-07-14';
    const source = loadBackground({
      initialStorage: {
        byThinkingProviderModel: {
          [priorDay]: {
            chatgpt: {
              'gpt-5': { reportedCount: 1, totalMs: 3000 },
            },
          },
          [today]: {
            chatgpt: {
              'gpt-5.5': { reportedCount: 2, totalMs: 9000 },
            },
          },
        },
        recentThinkingEvents: { 'chatgpt:today': Date.now() },
      },
    });

    const exported = clone(await sendMessage(source, { type: 'exportData' }));
    assert.equal(exported.ok, true);
    assert.equal(exported.export.schemaVersion, 3);
    assert.equal(exported.export.storageSchemaVersion, 3);
    assert.deepEqual(
      exported.export.data.byThinkingProviderModel[today].chatgpt['gpt-5.5'],
      { reportedCount: 2, totalMs: 9000 }
    );

    const restored = loadBackground();
    const imported = clone(await sendMessage(restored, {
      type: 'importData',
      payload: exported.export,
    }));
    assert.equal(imported.ok, true);
    assert.equal(imported.import.storageSchemaVersion, 3);
    assert.deepEqual(
      restored.storage.byThinkingProviderModel[today].chatgpt['gpt-5.5'],
      { reportedCount: 2, totalMs: 9000 }
    );

    const resetToday = clone(await sendMessage(restored, { type: 'resetToday' }));
    assert.equal(resetToday.ok, true);
    assert.equal(restored.storage.byThinkingProviderModel[today], undefined);
    assert.deepEqual(
      restored.storage.byThinkingProviderModel[priorDay].chatgpt['gpt-5'],
      { reportedCount: 1, totalMs: 3000 }
    );
    assert.deepEqual(restored.storage.recentThinkingEvents, {});

    const resetAll = clone(await sendMessage(restored, { type: 'resetAll' }));
    assert.equal(resetAll.ok, true);
    assert.deepEqual(restored.storage.byThinkingProviderModel, {});
    assert.deepEqual(restored.storage.recentThinkingEvents, {});
  });

  it('normalizes hostile thinking aggregates without historical backfill from untimed prompts', async () => {
    delete Object.prototype.polluted;
    const today = shared.todayKey();
    const hostileThinking = JSON.parse(`{
      "${today}": {
        "__proto__": { "polluted": { "reportedCount": 1, "totalMs": 1000 } },
        "constructor": { "bad": { "reportedCount": 1, "totalMs": 1000 } },
        "chatgpt.com": {
          "gpt-5.5": { "reportedCount": 2, "totalMs": 8000, "averageMs": 1 },
          "too-short": { "reportedCount": 1, "totalMs": 999 },
          "too-long": { "reportedCount": 1, "totalMs": 21600001 },
          "__proto__": { "reportedCount": 1, "totalMs": 1000 }
        }
      }
    }`);
    const env = loadBackground({
      initialStorage: {
        byDate: { [today]: 3 },
        byModel: { [today]: { 'gpt-5.5': 3 } },
        byProviderModel: { [today]: { chatgpt: { 'gpt-5.5': 3 } } },
        byThinkingProviderModel: hostileThinking,
      },
    });

    const response = clone(await sendMessage(env, { type: 'getStatus' }));
    const thinkingDay = response.status.byThinkingProviderModel[today];

    assert.equal(response.status.storageSchemaVersion, 3);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.hasOwn(thinkingDay, '__proto__'), false);
    assert.equal(Object.hasOwn(thinkingDay, 'constructor'), false);
    assert.deepEqual(
      thinkingDay.chatgpt['gpt-5.5'],
      { reportedCount: 2, totalMs: 8000 }
    );
    assert.equal(thinkingDay.chatgpt['too-short'], undefined);
    assert.equal(thinkingDay.chatgpt['too-long'], undefined);

    const legacy = loadBackground({
      initialStorage: {
        byDate: { [today]: 2 },
        byModel: { [today]: { 'gpt-5': 2 } },
        byProviderModel: { [today]: { chatgpt: { 'gpt-5': 2 } } },
      },
    });
    const legacyStatus = clone(await sendMessage(legacy, { type: 'getStatus' }));
    assert.deepEqual(legacyStatus.status.byThinkingProviderModel, {});
  });
});
