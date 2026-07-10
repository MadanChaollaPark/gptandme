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
    'claude-network': 'Network',
    'perplexity-network': 'Network',
    'grok-network': 'Network',
    network: 'Network',
    'content-tick': 'Page event',
    'dom-event': 'Page event',
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

function renderSparkline(values) {
  const container = document.getElementById('sparkline');
  if (!container) return;
  container.replaceChildren();
  const max = Math.max(1, ...values.map((value) => Number(value || 0)));

  for (const value of values) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${Math.max(2, Math.round((Number(value || 0) / max) * 32))}px`;
    bar.title = `${value} prompts`;
    container.append(bar);
  }
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
  const statusEl = document.getElementById('statusValue');
  const statusClass = supported ? 'supported' : unsupported ? 'unsupported' : 'unknown';

  setText('currentSite', siteInfo.label);
  setText('statusValue', supported ? 'Supported' : unsupported ? 'Unsupported' : 'Unknown');
  if (!statusEl) return;
  statusEl.className = `pill ${statusClass}`;
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
      applySiteStatus(direct);
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
    setText('sessions', `${sessionStats.count} (${sessionStats.avg} avg, ${sessionStats.max} max)`);
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
    const blob = new Blob([
      buildUsageCsv(data.byDate, data.byModel, data.byProviderModel),
    ], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gptandme-usage.csv';
    a.click();
    URL.revokeObjectURL(url);
  });
}

function importCsvText(text) {
  const parsed = parseUsageCsv(text);
  const importedTotal = sumCounts(parsed.byDate);

  if (importedTotal === 0) {
    setText('importStatus', parsed.errors[0] || 'No valid rows found.');
    return;
  }

  chrome.runtime.sendMessage({ type: 'importUsage', data: parsed }, (response) => {
    if (response?.ok) {
      const warning = parsed.errors.length ? ` ${parsed.errors.length} row(s) skipped.` : '';
      setText('importStatus', `Imported ${importedTotal} prompts.${warning}`);
      updateDisplay();
    } else {
      setText('importStatus', response?.error || 'Import failed.');
    }
  });
}

function startPopup() {
  updateDisplay();
  updateActiveTabStatus();

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

  const resetToday = document.getElementById('resetToday');
  if (resetToday) resetToday.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'resetToday' }, (response) => {
      if (response?.ok) updateDisplay();
    });
  });

  const resetAll = document.getElementById('resetAll');
  if (resetAll) resetAll.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'resetAll' }, (response) => {
      if (response?.ok) updateDisplay();
    });
  });

  const downloadCsvButton = document.getElementById('downloadCsv');
  if (downloadCsvButton) downloadCsvButton.addEventListener('click', downloadCsv);

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
      setText('importStatus', 'Could not read CSV.');
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
    resolveStatus,
  };
}
