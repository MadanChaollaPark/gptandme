// popup.js

const shared = typeof GptAndMeShared !== 'undefined'
  ? GptAndMeShared
  : (typeof module !== 'undefined' && module.exports ? require('./shared') : {});

const {
  PROVIDERS,
  buildUsageCsv,
  displayModelName,
  estimateCostDetails,
  getMonthTotal,
  getModelCountsForDate,
  getProviderCountsForDate,
  getProviderTotals,
  getRecentDays,
  getRecentHours,
  getSessionStats,
  getStreak,
  getWeekTotal,
  isSupportedHost,
  parseUsageCsv,
  siteConfigForHost,
  sumCounts,
  todayKey,
} = shared;

const STORAGE_DEFAULTS = {
  byDate: {},
  byModel: {},
  byProviderModel: {},
  byHour: {},
  sessions: {},
  total: 0,
  showPageCounter: true,
  lastCountedAt: null,
  lastCountReason: null,
  lastCountSite: null,
  lastCountModel: null,
  lastCountSessionId: null,
  lastSeenAt: null,
  lastSeenSite: null,
  extensionVersion: null,
  storageSchemaVersion: null,
  lastIncrementKey: null,
  lastIncrementAt: 0,
  recentEvents: {},
};
const SUPPORTED_BACKUP_SCHEMA_VERSION = 2;
const GROK_ORIGIN = 'https://grok.com/*';

function formatCost(cost) {
  return `$${cost.toFixed(cost < 1 ? 3 : 2)}`;
}

function formatCostSummary(details = {}) {
  if (!details.pricedCount) return 'Unpriced';
  return `~${formatCost(Number(details.total || 0))}`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatCostNote(details = {}) {
  const input = details.assumedInputTokens || 0;
  const output = details.assumedOutputTokens || 0;
  if (!details.modelCount) return 'API proxy; real billing needs token usage.';

  const parts = [
    `${pluralize(details.pricedCount || 0, 'send')} priced`,
  ];
  if (details.unpricedCount) {
    parts.push(`${pluralize(details.unpricedCount, 'send')} unpriced`);
  }
  parts.push(`${input} in + ${output} out tokens/send.`);
  return parts.join('. ');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function setOperationStatus(message, state = 'info') {
  const status = document.getElementById('importStatus');
  if (!status) return;
  status.textContent = String(message);
  status.setAttribute('data-state', state);
}

function sendPopupMessage(message, callback) {
  try {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime?.lastError;
      if (runtimeError) {
        callback({ ok: false, error: runtimeError.message || 'Extension request failed.' });
        return;
      }
      callback(response || { ok: false, error: 'The extension did not respond.' });
    });
  } catch (error) {
    callback({ ok: false, error: error?.message || 'Extension request failed.' });
  }
}

function askForConfirmation(message) {
  try {
    return typeof globalThis.confirm === 'function' && globalThis.confirm(message);
  } catch (_) {
    return false;
  }
}

function setButtonBusy(button, busy) {
  if (button) button.disabled = Boolean(busy);
}

function manifestVersion() {
  try {
    return chrome.runtime?.getManifest?.().version || 'Unknown';
  } catch (_) {
    return 'Unknown';
  }
}

function getDisplayVersion(data = {}) {
  return data.extensionVersion || manifestVersion();
}

function formatTime(iso) {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatReason(reason) {
  const labels = {
    'chatgpt-network': 'Network',
    'chatgpt-network-upgrade': 'Network correction',
    'claude-network': 'Network',
    'perplexity-network': 'Network',
    'grok-network': 'Network',
    network: 'Network',
    'content-tick': 'Page event',
    'dom-event': 'Page event',
    'chatgpt-dom-fallback': 'Page fallback',
    'claude-dom-fallback': 'Page fallback',
    'perplexity-dom-fallback': 'Page fallback',
    'grok-dom-fallback': 'Page fallback',
    stored: 'Recorded',
  };
  return labels[reason] || reason || 'None';
}

function getLatestSessionActivity(sessions = {}) {
  let latest = null;
  for (const session of Object.values(sessions || {})) {
    if (!session || typeof session !== 'object') continue;
    const at = session.lastSeenAt || session.startedAt;
    const ms = Date.parse(at);
    if (!at || Number.isNaN(ms)) continue;
    if (!latest || ms > latest.ms) {
      latest = {
        at,
        ms,
        model: session.lastModel || '',
        site: session.site || '',
      };
    }
  }
  if (!latest) return null;
  return { at: latest.at, model: latest.model, site: latest.site };
}

function normalizeLastCounted(storageData = {}, backgroundStatus = null) {
  const sources = [
    backgroundStatus?.status,
    backgroundStatus?.diagnostics,
    backgroundStatus,
    storageData.diagnostics,
    storageData.lastDiagnostics,
    storageData,
  ].filter((source) => source && typeof source === 'object');

  for (const source of sources) {
    const at = source.lastCountedAt || source.countedAt || source.at || source.time || source.timestamp;
    const reason = source.lastCountReason ||
      source.lastCountedReason ||
      source.countReason ||
      source.reason ||
      source.source ||
      '';
    if (at) return { at, reason: String(reason || '') };
  }

  const latestSession = getLatestSessionActivity(storageData.sessions);
  if (!latestSession) return null;
  return { at: latestSession.at, reason: 'stored' };
}

function unavailableSiteInfo() {
  return { supported: null, host: '', site: '', label: 'Unavailable' };
}

function findSupportedSite(url) {
  if (!url) return unavailableSiteInfo();

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return unavailableSiteInfo();
  }

  const host = parsed.hostname;
  const site = siteConfigForHost?.(host)?.name || '';
  const supported = Boolean(site || isSupportedHost(host));
  const fallbackLabel = host || parsed.protocol.replace(':', '');

  return {
    supported,
    host,
    site,
    label: `${fallbackLabel} ${supported ? 'supported' : 'unsupported'}`,
  };
}

function findStoredSite(data = {}) {
  const site = data.lastSeenSite || data.lastCountSite || '';
  if (!site) return unavailableSiteInfo();
  const info = findSupportedSite(site.includes('://') ? site : `https://${site}/`);
  if (!info.host) return unavailableSiteInfo();
  return {
    ...info,
    label: `Last seen ${info.host}`,
  };
}

function resolveStatus(siteInfo, statusData = {}) {
  if (statusData.status || statusData.state) return String(statusData.status || statusData.state);
  if (siteInfo.supported === false) return 'Unsupported here';
  return 'Ready';
}

function renderDiagnostics(data = {}) {
  const lastCounted = normalizeLastCounted(data);
  setText('lastCounted', formatTime(lastCounted?.at));
  setText('lastReason', formatReason(lastCounted?.reason));
  setText('version', getDisplayVersion(data));
}

function requestBackgroundStatus(callback) {
  if (!chrome.runtime?.sendMessage) {
    callback(null);
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
      if (chrome.runtime?.lastError || !response?.ok || !response.status) {
        callback(null);
        return;
      }
      callback(response.status);
    });
  } catch (_) {
    callback(null);
  }
}

function pageCounterToggle() {
  return document.getElementById('pageCounterToggle') || document.getElementById('showPageCounter');
}

function renderGrokAccess(enabled, message = '') {
  const toggle = document.getElementById('grokAccessToggle');
  const status = document.getElementById('grokAccessState');
  if (toggle) {
    toggle.checked = Boolean(enabled);
    toggle.disabled = false;
  }
  if (status) {
    status.textContent = message || (
      enabled
        ? 'Enabled. Reload any Grok tabs opened before access was granted.'
        : 'Off. Turn on to allow counting on grok.com.'
    );
  }
}

function updateGrokAccessControl() {
  const toggle = document.getElementById('grokAccessToggle');
  if (!toggle) return;
  if (!chrome.permissions?.contains) {
    toggle.disabled = true;
    setText('grokAccessState', 'Unavailable in this browser.');
    return;
  }

  chrome.permissions.contains({ origins: [GROK_ORIGIN] }, (enabled) => {
    const error = chrome.runtime?.lastError;
    if (error) {
      toggle.disabled = true;
      setText('grokAccessState', error.message || 'Could not check Grok access.');
      return;
    }
    renderGrokAccess(enabled);
  });
}

function changeGrokAccess(enabled) {
  const toggle = document.getElementById('grokAccessToggle');
  if (!toggle || !chrome.permissions) return;
  toggle.disabled = true;
  setText('grokAccessState', enabled ? 'Requesting access…' : 'Removing access…');

  const method = enabled ? 'request' : 'remove';
  chrome.permissions[method]({ origins: [GROK_ORIGIN] }, (changed) => {
    const error = chrome.runtime?.lastError;
    if (error || (enabled && !changed)) {
      renderGrokAccess(!enabled, error?.message || 'Grok access was not granted.');
      return;
    }

    sendPopupMessage({ type: 'syncGrokAccess' }, (response) => {
      if (!response?.ok) {
        renderGrokAccess(
          enabled,
          response?.error || 'Access changed, but Grok counting could not be configured.'
        );
        return;
      }
      renderGrokAccess(
        response.enabled,
        response.enabled
          ? 'Enabled. Reload any Grok tabs opened before access was granted.'
          : 'Off. Reload any open Grok tabs to remove previously loaded counting scripts.'
      );
      updateActiveTabStatus();
    });
  });
}

function renderSparkline(values, now = new Date()) {
  const container = document.getElementById('sparkline');
  if (!container) return;
  container.replaceChildren();
  const max = Math.max(1, ...values.map((value) => Number(value || 0)));
  const descriptions = [];

  values.forEach((value, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (values.length - 1 - index));
    const dateLabel = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const count = Number(value || 0);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${Math.max(2, Math.round((count / max) * 32))}px`;
    bar.title = `${dateLabel}: ${pluralize(count, 'prompt')}`;
    bar.setAttribute('aria-hidden', 'true');
    container.append(bar);
    descriptions.push(`${dateLabel}, ${pluralize(count, 'prompt')}`);
  });

  container.setAttribute('aria-label', `Last ${values.length} days: ${descriptions.join('; ')}`);
}

function updateModelBreakdown(data, todayDate) {
  const todayModels = getModelCountsForDate(data.byDate, data.byModel, todayDate);
  const modelSection = document.getElementById('modelSection');
  const modelDiv = document.getElementById('modelBreakdown');
  const models = Object.entries(todayModels).sort((a, b) => b[1] - a[1]);

  if (models.length > 0) {
    modelSection.style.display = '';
    modelDiv.replaceChildren();
    for (const [model, count] of models) {
      const row = document.createElement('div');
      row.className = 'row';

      const label = document.createElement('div');
      const displayName = displayModelName(model);
      label.textContent = displayName;
      if (displayName !== model) label.title = `stored as ${model}`;

      const value = document.createElement('div');
      value.className = 'value';
      value.textContent = count;

      row.append(label, value);
      modelDiv.append(row);
    }
  } else {
    modelSection.style.display = 'none';
    modelDiv.replaceChildren();
  }
}

function updateProviderBreakdown(data, todayDate) {
  const container = document.getElementById('providerBreakdown');
  if (!container || !PROVIDERS) return;
  const todayCounts = getProviderCountsForDate(
    data.byDate,
    data.byProviderModel,
    todayDate
  );
  const allTimeCounts = getProviderTotals(data.byDate, data.byProviderModel);
  const providerOrder = ['chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'unknown'];

  container.replaceChildren();
  for (const provider of providerOrder) {
    const today = Number(todayCounts[provider] || 0);
    const total = Number(allTimeCounts[provider] || 0);
    if (provider === 'unknown' && today === 0 && total === 0) continue;

    const row = document.createElement('div');
    row.className = 'service-row';

    const label = document.createElement('div');
    label.textContent = PROVIDERS[provider]?.label || provider;

    const todayValue = document.createElement('div');
    todayValue.textContent = String(today);
    todayValue.setAttribute('aria-label', `${today} today`);

    const totalValue = document.createElement('div');
    totalValue.textContent = String(total);
    totalValue.setAttribute('aria-label', `${total} total`);

    row.append(label, todayValue, totalValue);
    container.append(row);
  }
}

function applySiteStatus(siteInfo) {
  const supported = siteInfo.supported === true;
  const unsupported = siteInfo.supported === false;
  const requiresAccess = siteInfo.requiresAccess === true;
  const statusEl = document.getElementById('statusValue');
  const statusClass = requiresAccess
    ? 'unsupported'
    : supported ? 'supported' : unsupported ? 'unsupported' : 'unknown';

  setText('currentSite', siteInfo.label);
  setText(
    'statusValue',
    requiresAccess
      ? 'Grok access off'
      : supported ? 'Supported site' : unsupported ? 'Unsupported site' : 'Site unknown'
  );
  if (!statusEl) return;
  statusEl.className = `pill ${statusClass}`;
}

function applyActiveSiteStatus(siteInfo) {
  if (siteInfo.host !== 'grok.com' || !chrome.permissions?.contains) {
    applySiteStatus(siteInfo);
    return;
  }

  chrome.permissions.contains({ origins: [GROK_ORIGIN] }, (enabled) => {
    if (chrome.runtime?.lastError) {
      applySiteStatus(siteInfo);
      return;
    }
    applySiteStatus({
      ...siteInfo,
      requiresAccess: !enabled,
      label: enabled ? siteInfo.label : 'grok.com access off',
    });
  });
}

function updateActiveTabStatus() {
  if (!chrome.tabs?.query) {
    chrome.storage?.local?.get?.({ activeTabUrl: null, lastSeenSite: null, lastCountSite: null }, (data) => {
      const direct = data.activeTabUrl ? findSupportedSite(data.activeTabUrl) : unavailableSiteInfo();
      applySiteStatus(direct.supported === null ? findStoredSite(data) : direct);
    });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    const direct = findSupportedSite(tab?.url);
    if (direct.supported !== null) {
      applyActiveSiteStatus(direct);
      return;
    }

    chrome.storage?.local?.get?.({ lastSeenSite: null, lastCountSite: null }, (data) => {
      applySiteStatus(findStoredSite(data));
    });
  });
}

function updateDisplay() {
  chrome.storage.local.get(STORAGE_DEFAULTS, (data) => {
    const todayDate = todayKey();
    const today = data.byDate[todayDate] || 0;
    const todayModels = getModelCountsForDate(data.byDate, data.byModel, todayDate);
    const sessionStats = getSessionStats(data.sessions);
    const recentHours = getRecentHours(data.byHour, 24);
    const costDetails = estimateCostDetails(todayModels);

    setText('today', today);
    setText('week', getWeekTotal(data.byDate));
    setText('month', getMonthTotal(data.byDate));
    setText('last24', recentHours.reduce((sum, count) => sum + Number(count || 0), 0));
    setText('streak', `${getStreak(data.byDate)} days`);
    setText('total', sumCounts(data.byDate));
    setText('cost', formatCostSummary(costDetails));
    setText('costNote', formatCostNote(costDetails));
    setText(
      'sessions',
      `${pluralize(sessionStats.count, 'session')} · avg ${sessionStats.avg} · max ${sessionStats.max}`
    );
    renderDiagnostics(data);

    const toggle = pageCounterToggle();
    if (toggle) toggle.checked = data.showPageCounter !== false;
    renderSparkline(getRecentDays(data.byDate, 7));
    updateProviderBreakdown(data, todayDate);
    updateModelBreakdown(data, todayDate);
    requestBackgroundStatus((status) => {
      if (status) renderDiagnostics(status);
    });
  });
}

function downloadCsv() {
  chrome.storage.local.get({ byDate: {}, byModel: {}, byProviderModel: {} }, (data) => {
    if (chrome.runtime?.lastError) {
      setOperationStatus(chrome.runtime.lastError.message || 'Could not read stored data.', 'error');
      return;
    }
    const blob = new Blob([
      buildUsageCsv(data.byDate, data.byModel, data.byProviderModel),
    ], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gptandme-usage.csv';
    a.click();
    URL.revokeObjectURL(url);
    setOperationStatus('Usage CSV downloaded. It contains dated counts, not a complete backup.', 'success');
  });
}

function downloadJsonBackup(button = null) {
  setButtonBusy(button, true);
  sendPopupMessage({ type: 'exportData' }, (response) => {
    setButtonBusy(button, false);
    if (!response?.ok || !response.export) {
      setOperationStatus(response?.error || 'Could not create a JSON backup.', 'error');
      return;
    }

    try {
      const blob = new Blob([
        `${JSON.stringify(response.export, null, 2)}\n`,
      ], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gptandme-backup-${todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setOperationStatus('Complete JSON backup downloaded.', 'success');
    } catch (error) {
      setOperationStatus(error?.message || 'Could not create a JSON backup.', 'error');
    }
  });
}

function csvImportSummary(parsed = {}, currentByDate = {}) {
  const overlappingDates = Object.entries(parsed.byDate || {})
    .filter(([date, count]) => Number(count || 0) > 0 && Number(currentByDate[date] || 0) > 0);
  return {
    overlappingDateCount: overlappingDates.length,
    importedOnOverlappingDates: overlappingDates.reduce(
      (sum, [, count]) => sum + Number(count || 0),
      0
    ),
  };
}

function importCsvText(text) {
  const parsed = parseUsageCsv(text);
  const importedTotal = sumCounts(parsed.byDate);

  if (importedTotal === 0) {
    setOperationStatus(parsed.errors[0] || 'No valid rows found.', 'error');
    return;
  }

  chrome.storage.local.get({ byDate: {} }, (current) => {
    if (chrome.runtime?.lastError) {
      setOperationStatus(chrome.runtime.lastError.message || 'Could not check existing data.', 'error');
      return;
    }

    const overlap = csvImportSummary(parsed, current.byDate);
    const overlapMessage = overlap.overlappingDateCount
      ? ` ${overlap.overlappingDateCount} existing date(s) overlap; ` +
        `${pluralize(overlap.importedOnOverlappingDates, 'prompt')} will be added on those dates.`
      : ' No imported dates currently overlap.';
    const confirmed = askForConfirmation(
      `Merge ${pluralize(importedTotal, 'prompt')} into existing data?` +
      `${overlapMessage} CSV imports add counts and cannot detect a previously imported file. ` +
      'Importing the same CSV again duplicates its counts.'
    );
    if (!confirmed) {
      setOperationStatus('CSV merge canceled. No data changed.', 'info');
      return;
    }

    setOperationStatus('Merging usage CSV…', 'info');
    sendPopupMessage({ type: 'importUsage', data: parsed }, (response) => {
      if (response?.ok) {
        const warning = parsed.errors.length ? ` ${parsed.errors.length} row(s) skipped.` : '';
        setOperationStatus(`Merged ${pluralize(importedTotal, 'prompt')}.${warning}`, 'success');
        updateDisplay();
      } else {
        setOperationStatus(response?.error || 'CSV merge failed.', 'error');
      }
    });
  });
}

function parseJsonBackup(text) {
  let payload;
  try {
    payload = JSON.parse(String(text));
  } catch (_) {
    throw new Error('Backup is not valid JSON.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Backup must contain a JSON object.');
  }
  if (
    payload.schemaVersion !== undefined &&
    (!Number.isSafeInteger(Number(payload.schemaVersion)) || Number(payload.schemaVersion) < 1)
  ) {
    throw new Error('Backup has an invalid schema version.');
  }
  if (Number(payload.schemaVersion || 0) > SUPPORTED_BACKUP_SCHEMA_VERSION) {
    throw new Error('Backup was created by a newer GPTandME version. Update the extension first.');
  }

  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : payload;
  const recognizableKeys = ['byDate', 'byModel', 'byProviderModel', 'byHour', 'sessions', 'total'];
  if (!recognizableKeys.some((key) => Object.hasOwn(data, key))) {
    throw new Error('This does not look like a GPTandME backup.');
  }
  return { payload, data };
}

function restoreJsonText(text) {
  let backup;
  try {
    backup = parseJsonBackup(text);
  } catch (error) {
    setOperationStatus(error?.message || 'Could not read JSON backup.', 'error');
    return;
  }

  const backupTotal = sumCounts(backup.data.byDate || {});
  const confirmed = askForConfirmation(
    `Restore this backup (${pluralize(backupTotal, 'prompt')})? ` +
    'It replaces current counts, hours, sessions, settings, and diagnostics. This cannot be undone.'
  );
  if (!confirmed) {
    setOperationStatus('JSON restore canceled. No data changed.', 'info');
    return;
  }

  setOperationStatus('Restoring JSON backup…', 'info');
  sendPopupMessage({ type: 'importData', payload: backup.payload }, (response) => {
    if (response?.ok) {
      const restoredTotal = Number(response.import?.total ?? backupTotal);
      setOperationStatus(
        `Restored ${pluralize(restoredTotal, 'prompt')}. Existing local data was replaced.`,
        'success'
      );
      updateDisplay();
    } else {
      setOperationStatus(response?.error || 'JSON restore failed.', 'error');
    }
  });
}

function requestReset(type, button = null) {
  const resetToday = type === 'resetToday';
  const message = resetToday
    ? 'Reset today’s data? This deletes today’s prompt and hourly counts and clears session and recent diagnostic history. Other dated counts remain. This cannot be undone.'
    : 'Reset all usage data? This deletes all prompt counts, hourly counts, sessions, and recent diagnostics stored by GPTandME. This cannot be undone.';

  if (!askForConfirmation(message)) {
    setOperationStatus('Reset canceled. No data changed.', 'info');
    return;
  }

  setButtonBusy(button, true);
  setOperationStatus(resetToday ? 'Resetting today’s data…' : 'Resetting all usage data…', 'info');
  sendPopupMessage({ type }, (response) => {
    setButtonBusy(button, false);
    if (response?.ok) {
      setOperationStatus(
        resetToday
          ? 'Today’s data and session history were reset.'
          : 'All locally stored usage data was reset.',
        'success'
      );
      updateDisplay();
    } else {
      setOperationStatus(response?.error || 'Reset failed.', 'error');
    }
  });
}

function startPopup() {
  updateDisplay();
  updateActiveTabStatus();
  updateGrokAccessControl();

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (
      namespace === 'local' &&
      (
        changes.byDate ||
        changes.total ||
        changes.byModel ||
        changes.byProviderModel ||
        changes.byHour ||
        changes.sessions ||
        changes.showPageCounter ||
        changes.lastCountedAt ||
        changes.lastCountReason ||
        changes.lastSeenSite ||
        changes.lastSeenAt
      )
    ) {
      updateDisplay();
    }
  });

  const toggle = pageCounterToggle();
  if (toggle) {
    toggle.addEventListener('change', (event) => {
      chrome.storage.local.set({ showPageCounter: event.target.checked });
    });
  }

  const grokAccessToggle = document.getElementById('grokAccessToggle');
  if (grokAccessToggle) {
    grokAccessToggle.addEventListener('change', (event) => {
      changeGrokAccess(event.target.checked);
    });
  }

  const resetToday = document.getElementById('resetToday');
  if (resetToday) resetToday.addEventListener('click', () => {
    requestReset('resetToday', resetToday);
  });

  const resetAll = document.getElementById('resetAll');
  if (resetAll) resetAll.addEventListener('click', () => {
    requestReset('resetAll', resetAll);
  });

  const downloadCsvButton = document.getElementById('downloadCsv');
  if (downloadCsvButton) downloadCsvButton.addEventListener('click', downloadCsv);

  const downloadJsonButton = document.getElementById('downloadJson');
  if (downloadJsonButton) downloadJsonButton.addEventListener('click', () => {
    downloadJsonBackup(downloadJsonButton);
  });

  const importCsvButton = document.getElementById('importCsv');
  const importCsvInput = document.getElementById('importCsvInput');
  if (importCsvButton && importCsvInput) {
    importCsvButton.addEventListener('click', () => {
      importCsvInput.click();
    });
  }

  if (importCsvInput) importCsvInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      importCsvText(await file.text());
    } catch (_) {
      setOperationStatus('Could not read CSV.', 'error');
    } finally {
      event.target.value = '';
    }
  });

  const restoreJsonButton = document.getElementById('restoreJson');
  const restoreJsonInput = document.getElementById('restoreJsonInput');
  if (restoreJsonButton && restoreJsonInput) {
    restoreJsonButton.addEventListener('click', () => {
      restoreJsonInput.click();
    });
  }

  if (restoreJsonInput) restoreJsonInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      restoreJsonText(await file.text());
    } catch (_) {
      setOperationStatus('Could not read JSON backup.', 'error');
    } finally {
      event.target.value = '';
    }
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', startPopup);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    findSupportedSite,
    formatReason,
    formatTime,
    getLatestSessionActivity,
    normalizeLastCounted,
    csvImportSummary,
    parseJsonBackup,
    resolveStatus,
  };
}
