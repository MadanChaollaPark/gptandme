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

function loadBackground({
  initialStorage = {},
  manifestVersion = '9.9.9',
  storageGetDelayMs = 0,
} = {}) {
  const storage = clone(initialStorage);
  const badge = {};
  const onInstalled = chromeEvent();
  const onStartup = chromeEvent();
  const onMessage = chromeEvent();
  const onBeforeRequest = chromeEvent();
  const onStorageChanged = chromeEvent();
  const onAlarm = chromeEvent();

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
          const result = { ...clone(defaults), ...clone(storage) };
          if (storageGetDelayMs > 0) {
            setTimeout(() => callback(result), storageGetDelayMs);
          } else {
            callback(result);
          }
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

function flushIncrements(env) {
  return vm.runInContext('incrementQueue', env.sandbox);
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
      'chatgpt.com'
    );
    assert.equal(env.storage.byProviderModel[day].chatgpt['gpt-4o'], 1);
    assert.equal(env.storage.total, 1);

    assert.match(env.storage.lastCountedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(env.storage.lastCountReason, 'unit-test');
    assert.equal(env.storage.lastCountSite, 'chatgpt.com');
    assert.equal(env.storage.lastCountModel, 'gpt-4o');
    assert.equal(env.storage.lastCountSessionId, 'session-1');
    assert.equal(env.storage.extensionVersion, '9.9.9');
    assert.equal(env.storage.storageSchemaVersion, 2);
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
        byDate: {
          '2026-01-01': 2,
          '2026-02-31': 9,
          '2026-99-99': 9,
        },
        byModel: null,
        byHour: {
          '2026-02-31-12': 9,
          '2026-01-01-77': 9,
        },
        total: 2,
      },
    });

    const response = clone(await sendMessage(env, { type: 'getStatus' }));

    assert.equal(response.ok, true);
    assert.deepEqual(response.status.byDate, { '2026-01-01': 2 });
    assert.deepEqual(response.status.byModel, { '2026-01-01': { unknown: 2 } });
    assert.deepEqual(response.status.byProviderModel, {
      '2026-01-01': { unknown: { unknown: 2 } },
    });
    assert.deepEqual(response.status.byHour, {});
    assert.deepEqual(response.status.sessions, {});
    assert.equal(response.status.total, 2);
    assert.equal(response.status.storageSchemaVersion, 2);
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
    assert.equal(exported.export.schemaVersion, 2);
    assert.equal(exported.export.storageSchemaVersion, 2);
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
    assert.equal(env.storage.byProviderModel[day].unknown['gpt-4o'], 4);
    assert.equal(env.storage.sessions.restored.prompts, 4);
    assert.equal(env.storage.total, 4);
    assert.equal(env.storage.lastCountReason, 'restore-test');
    assert.equal(env.storage.extensionVersion, '9.9.9');
    assert.equal(env.badge.text, '4');
  });

  it('bounds persisted page sessions to the 500 most recent records', async () => {
    const sessions = {};
    for (let index = 0; index < 600; index += 1) {
      sessions[`session-${index}`] = {
        prompts: 1,
        site: 'claude.ai',
        lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      };
    }
    const env = loadBackground({ initialStorage: { sessions } });

    const response = clone(await sendMessage(env, { type: 'getStatus' }));

    assert.equal(Object.keys(response.status.sessions).length, 500);
    assert.equal(Object.hasOwn(response.status.sessions, 'session-599'), true);
    assert.equal(Object.hasOwn(response.status.sessions, 'session-0'), false);
  });
});

describe('background provider message validation and event dedupe', () => {
  it('derives Claude attribution from the sender tab and ignores forged message fields', async () => {
    const env = loadBackground();
    await sendMessage(
      env,
      {
        type: 'tick',
        eventId: 'claude:event-1',
        model: 'claude-sonnet',
        provider: 'perplexity',
        site: 'perplexity.ai',
        sessionId: 'claude:page-safe',
        reason: 'claude-network',
      },
      { tab: { id: 7, url: 'https://claude.ai/new' } }
    );
    await flushIncrements(env);

    const day = shared.todayKey();
    assert.equal(env.storage.byProviderModel[day].claude['claude-sonnet'], 1);
    assert.equal(env.storage.byProviderModel[day].perplexity, undefined);
    assert.equal(env.storage.lastCountSite, 'claude.ai');
  });

  it('dedupes a stable provider event across worker restarts but keeps distinct rapid events', async () => {
    const first = loadBackground();
    const sender = { tab: { id: 8, url: 'https://www.perplexity.ai/' } };

    for (const eventId of ['perplexity:event-1', 'perplexity:event-1', 'perplexity:event-2']) {
      await sendMessage(first, {
        type: 'tick',
        eventId,
        model: 'sonar',
        sessionId: 'perplexity:page-safe',
      }, sender);
    }
    await flushIncrements(first);

    const day = shared.todayKey();
    assert.equal(first.storage.byDate[day], 2);
    assert.equal(first.storage.byProviderModel[day].perplexity.sonar, 2);

    const restarted = loadBackground({ initialStorage: first.storage });
    await sendMessage(restarted, {
      type: 'tick',
      eventId: 'perplexity:event-1',
      model: 'sonar',
      sessionId: 'perplexity:page-safe',
    }, sender);
    await flushIncrements(restarted);

    assert.equal(restarted.storage.byDate[day], 2);
    assert.equal(restarted.storage.byProviderModel[day].perplexity.sonar, 2);
  });

  it('rejects tick messages without a supported sender tab', async () => {
    const env = loadBackground();

    await sendMessage(env, { type: 'tick', eventId: 'event-1' });
    await sendMessage(
      env,
      { type: 'tick', eventId: 'event-2' },
      { tab: { id: 4, url: 'https://claude.ai.evil.example/' } }
    );
    await flushIncrements(env);

    assert.equal(env.storage.byDate, undefined);
  });

  it('never stores a query-derived path received as a session ID', async () => {
    const env = loadBackground();
    const rawSession = 'perplexity:/search/private-query-words?secret=true';

    await sendMessage(
      env,
      {
        type: 'tick',
        eventId: 'perplexity:event-private',
        model: 'sonar',
        sessionId: rawSession,
      },
      { tab: { id: 9, url: 'https://perplexity.ai/search/private-query-words' } }
    );
    await flushIncrements(env);

    const serialized = JSON.stringify(env.storage);
    assert.doesNotMatch(serialized, /private-query-words|secret=true|\/search\//);
    assert.match(env.storage.lastCountSessionId, /^legacy-/);
  });

  it('rejects prototype-polluting session IDs', async () => {
    delete Object.prototype.prompts;
    const env = loadBackground();

    await sendMessage(
      env,
      {
        type: 'tick',
        eventId: 'claude:event-safe',
        model: 'sonnet',
        sessionId: '__proto__',
      },
      { tab: { id: 10, url: 'https://claude.ai/new' } }
    );
    await flushIncrements(env);

    assert.equal(Object.prototype.prompts, undefined);
    assert.equal(Object.hasOwn(env.storage.sessions, '__proto__'), false);
    assert.equal(env.storage.sessions['claude:tab-10'].prompts, 1);
  });
});

describe('serialized background reset mutations', () => {
  it('reset today clears every today dimension, sessions, and event dedupe state', async () => {
    const day = shared.todayKey();
    const env = loadBackground({
      initialStorage: {
        byDate: { '2026-01-01': 2, [day]: 3 },
        byModel: { '2026-01-01': { legacy: 2 }, [day]: { sonnet: 3 } },
        byProviderModel: {
          '2026-01-01': { unknown: { legacy: 2 } },
          [day]: { claude: { sonnet: 3 } },
        },
        byHour: { '2026-01-01-08': 2, [`${day}-12`]: 3 },
        sessions: { current: { prompts: 3, site: 'claude.ai' } },
        recentEvents: { 'claude:event-1': Date.now() },
        total: 5,
      },
    });

    const response = clone(await sendMessage(env, { type: 'resetToday' }));

    assert.equal(response.ok, true);
    assert.deepEqual(env.storage.byDate, { '2026-01-01': 2 });
    assert.deepEqual(env.storage.byModel, { '2026-01-01': { legacy: 2 } });
    assert.deepEqual(env.storage.byProviderModel, {
      '2026-01-01': { unknown: { legacy: 2 } },
    });
    assert.deepEqual(env.storage.byHour, { '2026-01-01-08': 2 });
    assert.deepEqual(env.storage.sessions, {});
    assert.deepEqual(env.storage.recentEvents, {});
    assert.equal(env.storage.total, 2);
  });

  it('queues reset after an in-flight increment so deleted counts cannot reappear', async () => {
    const env = loadBackground();
    const sender = { tab: { id: 12, url: 'https://claude.ai/new' } };

    void sendMessage(env, {
      type: 'tick',
      eventId: 'claude:in-flight',
      model: 'sonnet',
      sessionId: 'claude:page-in-flight',
    }, sender);
    const reset = clone(await sendMessage(env, { type: 'resetToday' }));

    assert.equal(reset.ok, true);
    assert.deepEqual(env.storage.byDate, {});
    assert.deepEqual(env.storage.byProviderModel, {});
    assert.deepEqual(env.storage.sessions, {});
    assert.deepEqual(env.storage.recentEvents, {});
    assert.equal(env.storage.total, 0);
  });

  it('merges a CSV usage delta after an in-flight increment without overwriting it', async () => {
    const env = loadBackground();
    const day = shared.todayKey();

    void sendMessage(env, {
      type: 'tick',
      eventId: 'claude:before-import',
      model: 'sonnet',
      sessionId: 'claude:page-before-import',
    }, { tab: { id: 13, url: 'https://claude.ai/new' } });

    const response = clone(await sendMessage(env, {
      type: 'importUsage',
      data: {
        byDate: { [day]: 2 },
        byModel: { [day]: { sonar: 2 } },
        byProviderModel: { [day]: { perplexity: { sonar: 2 } } },
      },
    }));

    assert.equal(response.ok, true);
    assert.equal(env.storage.byDate[day], 3);
    assert.equal(env.storage.byProviderModel[day].claude.sonnet, 1);
    assert.equal(env.storage.byProviderModel[day].perplexity.sonar, 2);
    assert.equal(env.storage.total, 3);
  });

  it('rejects reset requests sent from a web page tab', async () => {
    const env = loadBackground();
    const response = await sendMessage(
      env,
      { type: 'resetAll' },
      { tab: { id: 99, url: 'https://claude.ai/' } }
    );

    assert.equal(response.ok, false);
    assert.match(response.error, /extension UI/);
  });

  it('serializes delayed startup migration before a concurrent tick', async () => {
    const day = shared.todayKey();
    const env = loadBackground({
      storageGetDelayMs: 5,
      initialStorage: {
        byDate: { [day]: 1 },
        byModel: { [day]: { legacy: 1 } },
      },
    });

    const startup = env.chrome.runtime.onStartup.listeners[0]();
    void sendMessage(env, {
      type: 'tick',
      eventId: 'claude:during-startup',
      model: 'sonnet',
      sessionId: 'claude:page-startup',
    }, { tab: { id: 14, url: 'https://claude.ai/new' } });

    await startup;
    await flushIncrements(env);

    assert.equal(env.storage.byDate[day], 2);
    assert.equal(env.storage.byProviderModel[day].unknown.legacy, 1);
    assert.equal(env.storage.byProviderModel[day].claude.sonnet, 1);
  });

  it('persists hourly pruning of expired opaque event IDs', async () => {
    const now = Date.now();
    const env = loadBackground({
      initialStorage: {
        recentEvents: {
          'claude:expired': now - (25 * 60 * 60 * 1000),
          'claude:fresh': now - 1000,
        },
      },
    });

    env.chrome.alarms.onAlarm.listeners[0]({ name: 'gptandme-refresh-badge' });
    await flushIncrements(env);

    assert.deepEqual(env.storage.recentEvents, { 'claude:fresh': now - 1000 });
  });
});
