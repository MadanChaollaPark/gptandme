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
    });
  }

  updateDisplay();

  // Listen for changes in storage and update the display
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (
      namespace === 'local' &&
      (changes.byDate || changes.total || changes.byModel || changes.byHour || changes.sessions)
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
