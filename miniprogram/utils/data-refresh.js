const DEFAULT_TTL = 30 * 1000;

let dataVersion = 0;

function markChanged() {
  dataVersion += 1;
}

function needsRefresh(target, ttl = DEFAULT_TTL) {
  if (target && target._loadInFlight) return false;
  if (!target || !target._dataLoadedAt) return true;
  if (target._dataVersion !== dataVersion) return true;
  return Date.now() - target._dataLoadedAt >= ttl;
}

function markLoaded(target) {
  if (!target) return;
  target._dataLoadedAt = Date.now();
  target._dataVersion = dataVersion;
}

module.exports = { DEFAULT_TTL, markChanged, needsRefresh, markLoaded };
