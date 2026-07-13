const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createPopupScriptHarness,
  mergeUsageData,
  parseUsageCsv,
} = require('./helpers');

describe('popup CSV export', () => {
  it('exports sorted date/provider/model/count rows and fills legacy unknown counts', () => {
    const harness = createPopupScriptHarness({
      byDate: {
        '2026-01-02': 3,
        '2026-01-01': 1,
      },
      byModel: {
        '2026-01-02': {
          'gpt-4o': 2,
        },
      },
    });

    harness.fireDOMContentLoaded();
    harness.click('downloadCsv');

    assert.deepEqual(harness.lastDownload(), {
      href: 'blob:test-0',
      download: 'gptandme-usage.csv',
    });
    assert.equal(harness.lastDownloadText(), [
      'date,provider,model,count',
      '2026-01-01,unknown,unknown,1',
      '2026-01-02,unknown,gpt-4o,2',
      '2026-01-02,unknown,unknown,1',
    ].join('\n'));
    assert.deepEqual(harness.revokedUrls, ['blob:test-0']);
  });

  it('escapes model names with commas, quotes, and newlines', () => {
    const harness = createPopupScriptHarness({
      byDate: {
        '2026-02-03': 3,
      },
      byModel: {
        '2026-02-03': {
          'comma,model': 1,
          'quote "model"': 1,
          'line\nbreak': 1,
        },
      },
    });

    harness.fireDOMContentLoaded();
    harness.click('downloadCsv');

    const csv = harness.lastDownloadText();
    assert.match(csv, /^date,provider,model,count\n/);
    assert.match(csv, /2026-02-03,unknown,"comma,model",1/);
    assert.match(csv, /2026-02-03,unknown,"quote ""model""",1/);
    assert.match(csv, /2026-02-03,unknown,"line\nbreak",1/);
  });
});

describe('CSV parsing helpers', () => {
  it('parses quoted model names and aggregates duplicate rows', () => {
    const parsed = parseUsageCsv([
      'date,model,count',
      '2026-02-03,"quote ""model""",2',
      '2026-02-03,"quote ""model""",1',
      '2026-02-04,gpt-4o,5',
    ].join('\n'));

    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.byDate, {
      '2026-02-03': 3,
      '2026-02-04': 5,
    });
    assert.deepEqual(parsed.byModel, {
      '2026-02-03': { 'quote "model"': 3 },
      '2026-02-04': { 'gpt-4o': 5 },
    });
  });

  it('skips invalid import rows and keeps valid rows', () => {
    const parsed = parseUsageCsv([
      'date,model,count',
      'not-a-date,gpt-4o,2',
      '2026-02-03,gpt-4o,1.5',
      '2026-02-04,o3-mini,4',
    ].join('\n'));

    assert.deepEqual(parsed.byDate, { '2026-02-04': 4 });
    assert.deepEqual(parsed.byModel, { '2026-02-04': { 'o3-mini': 4 } });
    assert.deepEqual(parsed.errors, [
      'Row 2: invalid date',
      'Row 3: invalid count',
    ]);
  });

  it('merges imported usage into existing date and model totals', () => {
    const merged = mergeUsageData(
      {
        byDate: { '2026-02-03': 2 },
        byModel: { '2026-02-03': { 'gpt-4o': 2 } },
      },
      {
        byDate: { '2026-02-03': 3, '2026-02-04': 1 },
        byModel: {
          '2026-02-03': { 'gpt-4o': 1, unknown: 2 },
          '2026-02-04': { 'o3-mini': 1 },
        },
      }
    );

    assert.deepEqual(merged, {
      byDate: { '2026-02-03': 5, '2026-02-04': 1 },
      byModel: {
        '2026-02-03': { 'gpt-4o': 3, unknown: 2 },
        '2026-02-04': { 'o3-mini': 1 },
      },
      byProviderModel: {
        '2026-02-03': { unknown: { 'gpt-4o': 3, unknown: 2 } },
        '2026-02-04': { unknown: { 'o3-mini': 1 } },
      },
      total: 6,
    });
  });
});

describe('popup CSV merge safety', () => {
  it('previews overlap and warns that importing twice duplicates counts', async () => {
    const harness = createPopupScriptHarness({
      byDate: { '2026-02-03': 2 },
      byModel: { '2026-02-03': { 'gpt-4o': 2 } },
    });
    harness.fireDOMContentLoaded();

    await harness.selectFile('importCsvInput', [
      'date,provider,model,count',
      '2026-02-03,chatgpt,gpt-4o,3',
      '2026-02-04,claude,claude-sonnet-4,1',
    ].join('\n'), 'usage.csv');

    assert.equal(harness.confirmationMessages.length, 1);
    assert.match(harness.confirmationMessages[0], /1 existing date\(s\) overlap/);
    assert.match(harness.confirmationMessages[0], /3 prompts will be added/);
    assert.match(harness.confirmationMessages[0], /same CSV again duplicates/);
    assert.equal(harness.runtimeMessages.some((message) => message.type === 'importUsage'), true);
    assert.match(harness.document.getElementById('importStatus').textContent, /Merged 4 prompts/);
    assert.equal(harness.document.getElementById('importStatus').getAttribute('data-state'), 'success');
  });

  it('does not send an import when the user cancels the merge', async () => {
    const harness = createPopupScriptHarness({}, { confirmationResponse: false });
    harness.fireDOMContentLoaded();

    await harness.selectFile(
      'importCsvInput',
      'date,provider,model,count\n2026-02-04,claude,claude-sonnet-4,1',
      'usage.csv'
    );

    assert.equal(harness.runtimeMessages.some((message) => message.type === 'importUsage'), false);
    assert.equal(
      harness.document.getElementById('importStatus').textContent,
      'CSV merge canceled. No data changed.'
    );
  });
});
