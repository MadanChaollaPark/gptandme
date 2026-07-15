const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopupScriptHarness } = require('./helpers');
const { parseJsonBackup } = require('../popup');

describe('popup markup safety and accessibility', () => {
  const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');

  it('declares language, live status regions, and a labeled chart', () => {
    assert.match(popup, /<html lang="en">/);
    assert.match(popup, /id="statusValue"[^>]+role="status"[^>]+aria-live="polite"/);
    assert.match(popup, /id="sparkline"[^>]+role="img"[^>]+aria-label=/);
    assert.match(popup, /id="importStatus"[^>]+role="status"[^>]+aria-live="polite"/);
    assert.match(popup, /id="grokAccessState"[^>]+role="status"[^>]+aria-live="polite"/);
  });

  it('states browser-only coverage and makes CSV merge semantics explicit', () => {
    assert.match(popup, /supported browser sites only/);
    assert.match(popup, /Claude Code, Codex CLI\/desktop, and IDE prompts are outside Chrome/);
    assert.match(popup, /Import merges by adding counts; importing the same file twice duplicates them/);
    assert.match(
      popup,
      /Reset today deletes today’s prompt and thinking-time aggregates and clears session and recent diagnostic history/
    );
    assert.match(popup, /Enable optional Grok counting/);
  });
});

describe('optional Grok access control', () => {
  it('requests only grok.com access from a popup user action and syncs registration', async () => {
    const harness = createPopupScriptHarness();
    harness.fireDOMContentLoaded();

    assert.equal(harness.document.getElementById('grokAccessToggle').checked, false);
    await harness.change('grokAccessToggle', true);

    const request = harness.permissionRequests.find((entry) => entry.method === 'request');
    assert.deepEqual(request.details, { origins: ['https://grok.com/*'] });
    assert.equal(harness.runtimeMessages.at(-1).type, 'syncGrokAccess');
    assert.equal(harness.document.getElementById('grokAccessToggle').checked, true);
    assert.match(harness.document.getElementById('grokAccessState').textContent, /Reload any Grok tabs/);
  });

  it('leaves Grok disabled when the optional permission is declined', async () => {
    const harness = createPopupScriptHarness({}, { grokPermissionRequestResult: false });
    harness.fireDOMContentLoaded();

    await harness.change('grokAccessToggle', true);

    assert.equal(harness.document.getElementById('grokAccessToggle').checked, false);
    assert.equal(
      harness.runtimeMessages.some((message) => message.type === 'syncGrokAccess'),
      false
    );
    assert.match(harness.document.getElementById('grokAccessState').textContent, /not granted/);
  });

  it('removes previously granted Grok access and unregisters counting', async () => {
    const harness = createPopupScriptHarness({}, { grokPermissionGranted: true });
    harness.fireDOMContentLoaded();

    await harness.change('grokAccessToggle', false);

    const removal = harness.permissionRequests.find((entry) => entry.method === 'remove');
    assert.deepEqual(removal.details, { origins: ['https://grok.com/*'] });
    assert.equal(harness.document.getElementById('grokAccessToggle').checked, false);
    assert.match(harness.document.getElementById('grokAccessState').textContent, /remove previously loaded/);
  });
});

describe('full JSON backup and restore', () => {
  it('downloads the complete background export as JSON', () => {
    const exportPayload = {
      schemaVersion: 2,
      storageSchemaVersion: 2,
      exportedAt: '2026-02-04T00:00:00.000Z',
      data: {
        byDate: { '2026-02-04': 2 },
        byHour: { '2026-02-04-09': 2 },
        sessions: { session: { prompts: 2 } },
        showPageCounter: false,
      },
    };
    const harness = createPopupScriptHarness({}, { exportPayload });
    harness.fireDOMContentLoaded();

    harness.click('downloadJson');

    assert.equal(harness.runtimeMessages.at(-1).type, 'exportData');
    assert.match(harness.lastDownload().download, /^gptandme-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.deepEqual(JSON.parse(harness.lastDownloadText()), exportPayload);
    assert.equal(harness.document.getElementById('importStatus').textContent, 'Complete JSON backup downloaded.');
  });

  it('requires confirmation before replacing local data from JSON', async () => {
    const harness = createPopupScriptHarness(
      { byDate: { '2026-01-01': 9 }, total: 9 },
      { confirmationResponse: true }
    );
    harness.fireDOMContentLoaded();
    const payload = {
      schemaVersion: 2,
      data: {
        byDate: { '2026-02-04': 4 },
        byHour: { '2026-02-04-09': 4 },
        sessions: {},
        total: 4,
      },
    };

    await harness.selectFile('restoreJsonInput', JSON.stringify(payload), 'backup.json');

    assert.match(
      harness.confirmationMessages[0],
      /replaces current prompt counts, thinking-time aggregates, hours, sessions, settings, and diagnostics/
    );
    const importMessage = harness.runtimeMessages.find((message) => message.type === 'importData');
    assert.equal(JSON.stringify(importMessage.payload), JSON.stringify(payload));
    assert.equal(
      harness.document.getElementById('importStatus').textContent,
      'Restored 4 prompts. Existing local data was replaced.'
    );
  });

  it('rejects malformed and future-version backups before sending them', async () => {
    const malformedHarness = createPopupScriptHarness();
    malformedHarness.fireDOMContentLoaded();
    await malformedHarness.selectFile('restoreJsonInput', '{bad', 'backup.json');
    assert.equal(
      malformedHarness.document.getElementById('importStatus').textContent,
      'Backup is not valid JSON.'
    );
    assert.equal(malformedHarness.runtimeMessages.some((message) => message.type === 'importData'), false);

    assert.throws(
      () => parseJsonBackup(JSON.stringify({ schemaVersion: 99, data: { byDate: {} } })),
      /newer GPTandME version/
    );
  });
});

describe('destructive reset safeguards', () => {
  it('does not reset without confirmation', () => {
    const harness = createPopupScriptHarness({}, { confirmationResponse: false });
    harness.fireDOMContentLoaded();
    harness.click('resetToday');

    assert.match(harness.confirmationMessages[0], /clears session and recent diagnostic history/);
    assert.equal(harness.runtimeMessages.some((message) => message.type === 'resetToday'), false);
    assert.equal(harness.document.getElementById('importStatus').textContent, 'Reset canceled. No data changed.');
  });

  it('shows a reset failure returned by the background', () => {
    const harness = createPopupScriptHarness({}, {
      runtimeResponses: { resetAll: { ok: false, error: 'Storage write failed.' } },
    });
    harness.fireDOMContentLoaded();
    harness.click('resetAll');

    assert.equal(harness.runtimeMessages.at(-1).type, 'resetAll');
    assert.equal(harness.document.getElementById('importStatus').textContent, 'Storage write failed.');
    assert.equal(harness.document.getElementById('importStatus').getAttribute('data-state'), 'error');
  });
});
