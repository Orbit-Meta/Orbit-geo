import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { clock } from './clock.js';
import { distanceM, round5 } from './geo.js';
import { normalizeStops } from './itinerary.js';
import { appliesTo, projectPerson, personStatus, groupStopView } from './schedule.js';

const stopKey = (s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;

/**
 * The single pipeline every location update goes through — live, replay and
 * simulate alike: filter → state → geofence → rate-limited ETA → projections.
 *
 * Events:
 *   'update'     (view)   after any state change (coalesced)
 *   'stop_event' (event)  { type: 'arrived' | 'departed', participant_id, stop_id, at }
 *   'itinerary'  (itin)   after the itinerary changes
 */
export class Engine extends EventEmitter {
  constructor({ participants, legs, computeRoute, stops = [], persist = null }) {
    super();
    this.participants = participants;
    this.legs = legs;
    this.computeRoute = computeRoute;
    this.persist = persist;
    this.itinerary = { version: 1, stops: normalizeStops(stops) };
    this.people = new Map();
    this.generation = 0;
    this.lastView = null;
    this.touchQueued = false;
    this.stats = { accepted: 0, dropped_accuracy: 0, dropped_order: 0 };

    this.refreshLegs();
    this.timers = [
      // Re-project every few seconds so "stuck past ETA" keeps sliding later.
      setInterval(() => this.touch(), 5000),
      setInterval(() => this.refreshLegs(), config.legRefreshMs),
    ];
    for (const t of this.timers) t.unref?.();
  }

  close() {
    for (const t of this.timers) clearInterval(t);
    this.reset();
  }

  refreshLegs(force = false) {
    return this.legs.refresh(this.itinerary.stops, { force }).then((changed) => changed && this.touch());
  }

  /** The stops this person visits: shared stops plus their personal ones. */
  stopsFor(p) {
    return this.itinerary.stops.filter((s) => appliesTo(s, p.id));
  }

  targetOf(p) {
    return this.stopsFor(p).find((s) => !p.completed.has(s.id)) ?? null;
  }

  ensurePerson(u) {
    let p = this.people.get(u.participant_id);
    if (!p) {
      const meta = this.participants.get(u.participant_id) ?? this.participants.adopt(u.participant_id, u.display_name);
      p = {
        id: meta.id,
        display_name: meta.display_name,
        color: meta.color,
        initial: meta.initial,
        location: null,
        battery_pct: null,
        ts: 0,
        trail: [],
        completed: new Set(),
        arrivals: {},
        at_stop_id: null,
        eta: null,
        etaTimer: null,
        etaInFlight: false,
        etaQueued: false,
        lastEtaCall: -Infinity,
        lastEtaReal: 0,
      };
      this.people.set(p.id, p);
    }
    return p;
  }

  /** Feed one normalized `transit_location_update`. */
  ingest(u) {
    if (!u?.participant_id || !u.location) return { ok: false, reason: 'invalid' };
    const p = this.ensurePerson(u);

    const acc = u.location.accuracy_m;
    if (acc != null && acc > config.maxAccuracyM) {
      this.stats.dropped_accuracy++;
      return { ok: false, reason: 'accuracy' };
    }
    const ts = Date.parse(u.timestamp);
    if (!Number.isFinite(ts) || ts <= p.ts) {
      this.stats.dropped_order++;
      return { ok: false, reason: 'out_of_order' };
    }

    const { lat, lng } = u.location;
    p.ts = ts;
    p.location = {
      lat,
      lng,
      accuracy_m: acc ?? null,
      speed_mps: u.location.speed_mps ?? null,
      heading_deg: u.location.heading_deg ?? null,
    };
    if (u.battery_pct != null) p.battery_pct = u.battery_pct;
    p.trail.push([round5(lat), round5(lng)]);
    if (p.trail.length > config.trailLength) p.trail.shift();
    this.stats.accepted++;

    const crossed = this.geofence(p);
    this.requestEta(p, crossed);
    this.touch();
    return { ok: true };
  }

  /** Server-side 75 m geofence. Returns true when the person arrived or left. */
  geofence(p) {
    if (!p.location) return false;
    const stops = this.itinerary.stops;
    let changed = false;

    if (p.at_stop_id) {
      const here = stops.find((s) => s.id === p.at_stop_id);
      if (!here) {
        p.at_stop_id = null;
        changed = true;
      } else if (distanceM(p.location, here) > config.geofenceRadiusM + config.geofenceExitBufferM) {
        p.at_stop_id = null;
        p.completed.add(here.id);
        changed = true;
        this.emit('stop_event', { type: 'departed', participant_id: p.id, stop_id: here.id, at: p.ts });
      }
    }

    if (!p.at_stop_id) {
      const target = this.targetOf(p);
      if (target && distanceM(p.location, target) <= config.geofenceRadiusM) {
        p.at_stop_id = target.id;
        p.arrivals[target.id] = p.ts;
        changed = true;
        this.emit('stop_event', { type: 'arrived', participant_id: p.id, stop_id: target.id, at: p.ts });
      }
    }
    return changed;
  }

  /**
   * At most one Routes call per person per 30 s; `force` (arrival, departure,
   * itinerary change) or a changed target skips the wait.
   */
  requestEta(p, force = false) {
    const target = this.targetOf(p);
    if (!p.location || !target || p.at_stop_id === target.id) {
      p.eta = null;
      clearTimeout(p.etaTimer);
      p.etaTimer = null;
      return;
    }
    const stale = !p.eta || p.eta.stop_id !== target.id || p.eta.dest_key !== stopKey(target);
    const virtualWait = p.lastEtaCall + config.etaMinIntervalMs - clock.now();
    const realWait = p.lastEtaReal + config.etaMinRealIntervalMs - Date.now();

    if (force || stale || (virtualWait <= 0 && realWait <= 0)) {
      clearTimeout(p.etaTimer);
      p.etaTimer = null;
      this.runEta(p, target);
      return;
    }
    if (!p.etaTimer) {
      const gen = this.generation;
      p.etaTimer = setTimeout(
        () => {
          p.etaTimer = null;
          if (gen === this.generation) this.requestEta(p);
        },
        Math.max(virtualWait / clock.rate, realWait, 0),
      );
    }
  }

  async runEta(p, target) {
    if (p.etaInFlight) {
      p.etaQueued = true;
      return;
    }
    p.etaInFlight = true;
    const gen = this.generation;
    const calledAt = clock.now();
    p.lastEtaCall = calledAt;
    p.lastEtaReal = Date.now();
    const origin = { lat: p.location.lat, lng: p.location.lng };
    try {
      const r = await this.computeRoute(origin, { lat: target.lat, lng: target.lng });
      if (gen !== this.generation) return;
      if (this.targetOf(p)?.id === target.id) {
        p.eta = {
          stop_id: target.id,
          dest_key: stopKey(target),
          computed_at: calledAt,
          duration_s: r.duration_s,
          distance_m: r.distance_m,
          origin_crow_m: distanceM(origin, target),
          estimated: r.estimated,
          path: (r.path?.length ? r.path : [origin, target]).map((q) => [round5(q.lat), round5(q.lng)]),
        };
      }
    } catch (err) {
      console.warn(`[eta] ${p.id}: ${err.message}`);
    } finally {
      p.etaInFlight = false;
    }
    if (gen !== this.generation) return;
    this.touch();
    if (p.etaQueued) {
      p.etaQueued = false;
      this.requestEta(p);
    }
  }

  setItinerary(stops, { persist = true } = {}) {
    const next = normalizeStops(stops);
    const prevTargets = new Map([...this.people.values()].map((p) => [p.id, this.targetOf(p)]));
    this.itinerary = { version: this.itinerary.version + 1, stops: next };
    if (persist) this.persist?.(next);

    for (const p of this.people.values()) {
      if (p.at_stop_id && !next.some((s) => s.id === p.at_stop_id)) p.at_stop_id = null;
      this.geofence(p);
      const before = prevTargets.get(p.id);
      const after = this.targetOf(p);
      const targetMoved = before?.id !== after?.id || (after && before && stopKey(before) !== stopKey(after));
      this.requestEta(p, Boolean(targetMoved));
    }
    this.emit('itinerary', this.itinerary);
    this.refreshLegs();
    this.touch();
    return this.itinerary;
  }

  reset() {
    this.generation++;
    for (const p of this.people.values()) clearTimeout(p.etaTimer);
    this.people.clear();
    this.touch();
  }

  touch() {
    if (this.touchQueued) return;
    this.touchQueued = true;
    setImmediate(() => {
      this.touchQueued = false;
      this.lastView = this.computeView();
      this.emit('update', this.lastView);
    });
  }

  view() {
    return this.lastView ?? this.computeView();
  }

  computeView() {
    const now = clock.now();
    const stops = this.itinerary.stops;
    const stopIds = new Set(stops.map((s) => s.id));
    const legSeconds = (a, b) => this.legs.get(a, b).duration_s;
    const people = [];
    const located = [];

    for (const p of this.people.values()) {
      const mine = this.stopsFor(p);
      const projections = projectPerson({
        stops: mine,
        completed: p.completed,
        arrivals: p.arrivals,
        atStopId: p.at_stop_id,
        eta: p.eta,
        now,
        legSeconds,
      });
      const { status, target } = personStatus({
        stops: mine,
        completed: p.completed,
        atStopId: p.at_stop_id,
        projections,
        lateMin: config.lateThresholdMin,
      });

      let eta = null;
      if (p.eta && target && p.eta.stop_id === target.id && p.location) {
        const ratio = p.eta.origin_crow_m > 1 ? Math.min(1, distanceM(p.location, target) / p.eta.origin_crow_m) : 1;
        eta = {
          stop_id: p.eta.stop_id,
          arrive_at: p.eta.computed_at + p.eta.duration_s * 1000,
          duration_s: Math.round(p.eta.duration_s),
          distance_m: Math.round(p.eta.distance_m),
          distance_remaining_m: Math.round(p.eta.distance_m * ratio),
          computed_at: p.eta.computed_at,
          estimated: p.eta.estimated,
          path: p.eta.path,
        };
      }

      people.push({
        id: p.id,
        display_name: p.display_name,
        color: p.color,
        initial: p.initial,
        location: p.location,
        battery_pct: p.battery_pct,
        ts: p.ts || null,
        timestamp: p.ts ? new Date(p.ts).toISOString() : null,
        status,
        target_stop_id: target?.id ?? null,
        at_stop_id: p.at_stop_id,
        completed_stop_ids: [...p.completed].filter((id) => stopIds.has(id)),
        arrivals: p.arrivals,
        drift_min: target ? (projections[target.id]?.drift_min ?? null) : null,
        eta,
        projections,
        trail: p.trail,
      });
      if (p.location) {
        located.push({ id: p.id, completed: p.completed, at_stop_id: p.at_stop_id, target_id: target?.id ?? null, projections });
      }
    }

    return {
      generated_at: now,
      itinerary: this.itinerary,
      people,
      stop_states: groupStopView(stops, located),
      stats: this.stats,
    };
  }
}
