export const fmtTime = (ms) =>
  ms == null ? '—' : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function fmtDrift(min) {
  if (min == null) return '—';
  const r = Math.round(min);
  if (r === 0) return 'On time';
  return r > 0 ? `+${r} min` : `−${-r} min`;
}

/** green ≤ 5 min late, amber ≤ 15, red beyond. Early counts as on time. */
export function driftTone(min, settings) {
  if (min == null) return 'neutral';
  if (min <= (settings?.late_min ?? 5)) return 'good';
  if (min <= (settings?.very_late_min ?? 15)) return 'warn';
  return 'bad';
}

export function fmtCountdown(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'Now';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtDistance(m, units) {
  if (m == null) return '—';
  if (units === 'metric') return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  const mi = m / 1609.344;
  return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}

export function fmtSpeed(mps, units) {
  if (mps == null) return '—';
  return units === 'metric' ? `${Math.round(mps * 3.6)} km/h` : `${Math.round(mps * 2.23694)} mph`;
}

export function fmtAgo(seconds) {
  if (seconds == null) return 'never';
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
