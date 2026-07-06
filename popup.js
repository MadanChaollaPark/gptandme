// popup.js

const shared = typeof GptAndMeShared !== 'undefined'
  ? GptAndMeShared
  : (typeof module !== 'undefined' && module.exports ? require('./shared') : {});

const {
  buildUsageCsv,
  estimateCost,
  getMonthTotal,
  getModelCountsForDate,
  getRecentDays,
  getRecentHours,
  getSessionStats,
  getStreak,
  getWeekTotal,
  isSupportedHost,
  mergeUsageData,
  parseUsageCsv,
  siteConfigForHost,
  sumCounts,
  todayKey,
} = shared;

const STORAGE_DEFAULTS = {
  byDate: {},
  byModel: {},
  byHour: {},
  sessions: {},
  total: 0,
  showPageCounter: true,
  lastCountedAt: null,
  lastCountReason: null,
  lastCountSite: null,
  lastCountModel: null,
  lastCountSessionId: null,
  extensionVersion: null,
  storageSchemaVersion: null,
  lastIncrementKey: null,
  lastIncrementAt: 0,
};

const CLEARED_DIAGNOSTICS = {
  lastCountedAt: null,
  lastCountReason: null,
  lastCountSite: null,
  lastCountModel: null,
  lastCountSessionId: null,
  lastIncrementKey: null,
  lastIncrementAt: 0,
};

function formatCost(cost) {
  return `$${cost.toFixed(cost < 1 ? 3 : 2)}`;
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
    network: 'Network',
    'content-tick': 'Page event',
    'dom-event': 'Page event',
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
  return { at: latestSession.at, reason: '' };
}

function findSupportedSite(url) {
  if (!url) return { supported: null, host: '', site: '', label: 'Unavailable' };

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return { supported: null, host: '', site: '', label: 'Unavailable' };
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
      label.textContent = model;

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

function applySiteStatus(siteInfo) {
  const supported = siteInfo.supported === true;
  const unsupported = siteInfo.supported === false;
  const statusEl = document.getElementById('statusValue');

  setText('currentSite', siteInfo.label);
  setText('statusValue', supported ? 'Supported' : unsupported ? 'Unsupported' : 'Unknown');
  if (!statusEl) return;
  statusEl.style.color = supported ? '#166534' : '#7c2d12';
  statusEl.style.background = supported ? '#eef7f1' : '#fff7ed';
  statusEl.style.borderColor = supported ? '#cfe9d8' : '#fed7aa';
}

function updateActiveTabStatus() {
  if (!chrome.tabs?.query) {
    chrome.storage?.local?.get?.({ activeTabUrl: null }, (data) => {
      applySiteStatus(data.activeTabUrl ? findSupportedSite(data.activeTabUrl) : {
        supported: null,
        host: '',
        site: '',
        label: 'Unavailable',
      });
    });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    applySiteStatus(findSupportedSite(tab?.url));
  });
}

function updateDisplay() {
  chrome.storage.local.get(STORAGE_DEFAULTS, (data) => {
    const todayDate = todayKey();
    const today = data.byDate[todayDate] || 0;
    const todayModels = getModelCountsForDate(data.byDate, data.byModel, todayDate);
    const sessionStats = getSessionStats(data.sessions);
    const recentHours = getRecentHours(data.byHour, 24);

    setText('today', today);
    setText('week', getWeekTotal(data.byDate));
    setText('month', getMonthTotal(data.byDate));
    setText('last24', recentHours.reduce((sum, count) => sum + Number(count || 0), 0));
    setText('streak', `${getStreak(data.byDate)} days`);
    setText('total', data.total || sumCounts(data.byDate));
    setText('cost', formatCost(estimateCost(todayModels)));
    setText('sessions', `${sessionStats.count} (${sessionStats.avg} avg, ${sessionStats.max} max)`);
    renderDiagnostics(data);

    const toggle = pageCounterToggle();
    if (toggle) toggle.checked = data.showPageCounter !== false;
    renderSparkline(getRecentDays(data.byDate, 7));
    updateModelBreakdown(data, todayDate);
    requestBackgroundStatus((status) => {
      if (status) renderDiagnostics(status);
    });
  });
}

function downloadCsv() {
  chrome.storage.local.get({ byDate: {}, byModel: {} }, (data) => {
    const blob = new Blob([buildUsageCsv(data.byDate, data.byModel)], { type: 'text/csv' });
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

  chrome.storage.local.get(STORAGE_DEFAULTS, (data) => {
    const merged = mergeUsageData(data, parsed);
    const payload = {
      data: {
        ...data,
        ...merged,
        extensionVersion: manifestVersion() || data.extensionVersion,
      },
    };

    chrome.runtime.sendMessage({ type: 'importData', payload }, (response) => {
      if (response?.ok) {
        const warning = parsed.errors.length ? ` ${parsed.errors.length} row(s) skipped.` : '';
        setText('importStatus', `Imported ${importedTotal} prompts.${warning}`);
        updateDisplay();
      } else {
        setText('importStatus', response?.error || 'Import failed.');
      }
    });
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
        changes.byHour ||
        changes.sessions ||
        changes.showPageCounter ||
        changes.lastCountedAt ||
        changes.lastCountReason
      )
    ) {
      updateDisplay();
    }
  });

  // Add reset functionality
  document.getElementById('resetToday').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {}, byModel: {}, byHour: {}, total: 0 }, (data) => {
      const key = todayKey();
      const todayCount = data.byDate[key] || 0;
      const newByDate = { ...data.byDate };
      delete newByDate[key];
      const newByModel = { ...data.byModel };
      delete newByModel[key];
      const newByHour = { ...data.byHour };
      for (const hour of Object.keys(newByHour)) {
        if (hour.startsWith(`${key}-`)) delete newByHour[hour];
      }
      const newTotal = Math.max(0, (data.total || 0) - todayCount);
      chrome.storage.local.set({
        byDate: newByDate,
        byModel: newByModel,
        byHour: newByHour,
        total: newTotal,
      });
    });
  });

  document.getElementById('resetAll').addEventListener('click', () => {
    chrome.storage.local.set({ byDate: {}, byModel: {}, byHour: {}, sessions: {}, total: 0 });
  });

  // CSV export — date,model,count rows for billing/usage tracking
  document.getElementById('downloadCsv').addEventListener('click', () => {
    chrome.storage.local.get({ byDate: {}, byModel: {} }, (data) => {
      const rows = ['date,model,count'];
      const dates = [...new Set([...Object.keys(data.byDate), ...Object.keys(data.byModel)])].sort();
      for (const date of dates) {
        const models = getModelCountsForDate(data.byDate, data.byModel, date);
        if (Object.keys(models).length) {
          for (const [model, count] of Object.entries(models).sort()) {
            rows.push(`${date},${csvEscape(model)},${count}`);
          }
        } else {
          // Older data without model info
          rows.push(`${date},unknown,${data.byDate[date] || 0}`);
        }
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gptandme-usage.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  });
});
