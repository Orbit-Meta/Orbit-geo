import { config } from './config.js';
import { estimateRoute } from './routes.js';

const pt = (p) => ({ lat: p.lat, lng: p.lng });

/** Consecutive pairs for everyone's own sequence when some stops are personal. */
function personalPairs(stops) {
  const ids = new Set(stops.flatMap((s) => s.participants ?? []));
  const sequences = [stops.filter((s) => !s.participants?.length)];
  for (const id of ids) sequences.push(stops.filter((s) => !s.participants?.length || s.participants.includes(id)));
  const pairs = new Map();
  for (const seq of sequences) {
    for (let i = 1; i < seq.length; i++) pairs.set(LegCache.key(seq[i - 1], seq[i]), [seq[i - 1], seq[i]]);
  }
  return [...pairs.values()];
}

/**
 * Cache of stop-to-stop travel times, keyed by coordinates so reordering or
 * renaming stops reuses what we already know. Refreshed every few minutes.
 */
export class LegCache {
  constructor(computeRoute) {
    this.computeRoute = computeRoute;
    this.entries = new Map();
    this.chain = Promise.resolve();
  }

  static key(a, b) {
    return `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
  }

  get(a, b) {
    return this.entries.get(LegCache.key(a, b)) ?? estimateRoute([a, b]).legs[0];
  }

  /** Resolves true when any leg changed. Refreshes are serialized. */
  refresh(stops, { force = false } = {}) {
    const run = () => this.doRefresh(stops, force);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p.catch((err) => {
      console.warn(`[legs] refresh failed: ${err.message}`);
      return false;
    });
  }

  async doRefresh(stops, force) {
    if (stops.length < 2) return false;
    const now = Date.now();
    const personal = stops.some((s) => s.participants?.length);
    const pairs = personal ? personalPairs(stops) : stops.slice(1).map((b, i) => [stops[i], b]);
    const needs = pairs.filter(([a, b]) => {
      const e = this.entries.get(LegCache.key(a, b));
      return force || !e || e.estimated || now - e.fetched_at > config.legRefreshMs;
    });
    if (!needs.length) return false;

    const store = (a, b, leg, estimated) =>
      this.entries.set(LegCache.key(a, b), { duration_s: leg.duration_s, distance_m: leg.distance_m, estimated, fetched_at: now });

    if (personal || config.travelMode === 'TRANSIT') {
      // Per-person sequences (or transit, which has no intermediates): one call per pair.
      for (const [a, b] of needs) {
        const r = await this.computeRoute(pt(a), pt(b));
        store(a, b, r, r.estimated);
      }
    } else {
      const pts = stops.map(pt);
      const r = await this.computeRoute(pts[0], pts[pts.length - 1], pts.slice(1, -1));
      if (r.legs?.length === pairs.length) pairs.forEach(([a, b], i) => store(a, b, r.legs[i], r.estimated));
      else for (const [a, b] of needs) store(a, b, estimateRoute([a, b]).legs[0], true);
    }
    return true;
  }
}
