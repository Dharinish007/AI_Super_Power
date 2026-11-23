/**
 * Context Monitor - Usage History & Downsampling Engine
 *
 * Records periodic context/session usage samples:
 * - Samples usage every 5 minutes.
 * - Rolling 7-day window in chrome.storage.local under 'usage_history:${hostname}'.
 * - Points older than 24 hours are downsampled to 1 sample per hour (hourly average).
 * - Downtime gaps (> 15 minutes between samples) are tagged as breaks (gap: true).
 * - SVG sparkline path generator: draws gaps as broken segments, NEVER drops to zero.
 */

export const HISTORY_KEY_PREFIX = 'usage_history:';
export const SAMPLE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DOWNSAMPLE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
export const GAP_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes = gap break

/**
 * Downsamples an array of usage points:
 * - Discards points older than 7 days.
 * - For points older than 24h, aggregates by hour slot.
 * - Tags gaps (>15 min) with gap: true.
 * @param {Array<{ t: number, pct: number, gap?: boolean }>} points
 * @param {number} [now]
 * @returns {Array<{ t: number, pct: number, gap?: boolean }>}
 */
export function downsampleHistory(points = [], now = Date.now()) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const cutoff7d = now - ROLLING_WINDOW_MS;
  const cutoff24h = now - DOWNSAMPLE_THRESHOLD_MS;

  // Filter out older than 7 days and sort chronologically
  const valid = points
    .filter(p => p && typeof p.t === 'number' && Number.isFinite(p.t) && p.t >= cutoff7d && typeof p.pct === 'number' && Number.isFinite(p.pct))
    .sort((a, b) => a.t - b.t);

  if (valid.length === 0) return [];

  const olderPoints = [];
  const recentPoints = [];

  for (const p of valid) {
    if (p.t < cutoff24h) olderPoints.push(p);
    else recentPoints.push(p);
  }

  // Downsample older points into hourly buckets
  const hourlyBuckets = new Map();
  for (const p of olderPoints) {
    const hourKey = Math.floor(p.t / (3600 * 1000)) * (3600 * 1000);
    let bucket = hourlyBuckets.get(hourKey);
    if (!bucket) {
      bucket = { sum: 0, count: 0, t: hourKey + 1800000 };
      hourlyBuckets.set(hourKey, bucket);
    }
    bucket.sum += p.pct;
    bucket.count++;
  }

  const downsampledOlder = [];
  for (const [, b] of hourlyBuckets.entries()) {
    downsampledOlder.push({
      t: b.t,
      pct: Math.round((b.sum / b.count) * 10) / 10
    });
  }
  downsampledOlder.sort((a, b) => a.t - b.t);

  const merged = [...downsampledOlder, ...recentPoints];

  // Detect and tag gaps (>15m between adjacent points)
  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1];
    const curr = merged[i];
    if (curr.t - prev.t > GAP_THRESHOLD_MS) {
      curr.gap = true; // Mark as starting a new segment after a gap
    }
  }

  return merged;
}

/**
 * Adds a new sample point to existing history, downsamples, and returns new history array.
 * @param {Array<{ t: number, pct: number, gap?: boolean }>} history
 * @param {number} pct
 * @param {number} [now]
 * @returns {Array<{ t: number, pct: number, gap?: boolean }>}
 */
export function addSample(history = [], pct, now = Date.now()) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return history;
  const newPoint = { t: now, pct: Math.round(pct * 10) / 10 };
  const updated = [...history, newPoint];
  return downsampleHistory(updated, now);
}

/**
 * Builds SVG `<path>` data for rendering a sparkline with gaps as breaks.
 * Never drops to zero during gaps.
 * @param {Array<{ t: number, pct: number, gap?: boolean }>} points
 * @param {number} [width=120]
 * @param {number} [height=24]
 * @returns {string} SVG path 'd' string
 */
export function generateSparklinePath(points = [], width = 120, height = 24) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const y = Math.round(height * (1 - points[0].pct / 100));
    return `M 0 ${y} L ${width} ${y}`;
  }

  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const tSpan = Math.max(1, tMax - tMin);

  let d = '';
  let inSegment = false;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = Math.round(((p.t - tMin) / tSpan) * width * 10) / 10;
    const clampedPct = Math.max(0, Math.min(100, p.pct));
    const y = Math.round((height - (clampedPct / 100) * (height - 4) - 2) * 10) / 10;

    if (!inSegment || p.gap) {
      d += ` M ${x} ${y}`;
      inSegment = true;
    } else {
      d += ` L ${x} ${y}`;
    }
  }

  return d.trim();
}
