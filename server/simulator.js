import { EventEmitter } from 'node:events';
import { clock } from './clock.js';
import { buildPath, destinationPoint, pointAlong } from './geo.js';
import { estimateRoute } from './routes.js';
import { HttpError } from './itinerary.js';
import { appliesTo } from './schedule.js';

// Per-person variety: where they start (bearing/distance from stop 1) and how
// early/late they leave vs. plan. The third person leaves late on purpose.
const START_OFFSET_MIN = [-3, 1, 7, -1, 4];
const BEARINGS = [215, 320, 95, 20, 160];
const DISTANCES_M = [3200, 2400, 4300, 2900, 3600];
const TICK_MS = 250;
const BATTERY_DRAIN_PER_HOUR = 8;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Fake participants that drive real Google routes between the stops and
 * emit normalized updates into the same Engine.ingest pipeline as OwnTracks.
 */
export class Simulator extends EventEmitter {
  constructor({ engine, participants, computeRoute, onUpdate }) {
    super();
    this.engine = engine;
    this.participants = participants;
    this.computeRoute = computeRoute;
    this.onUpdate = onUpdate;
    this.agents = [];
    this.timer = null;
  }

  info() {
    return {
      running: Boolean(this.timer),
      agents: this.agents.map((a) => ({ id: a.id, display_name: a.display_name, phase: a.phase })),
    };
  }

  /**
   * @param {object} opts
   * @param {number} opts.speed
   * @param {object} [opts.scenario]  { t0, participants: [{ id, display_name, origin, depart_in_min }] }
   *   Without a scenario the configured participants start a few km from stop 1
   *   and leave so they arrive roughly on plan.
   */
  async start({ speed = 1, scenario = null } = {}) {
    this.stop();
    const all = this.engine.itinerary.stops;
    if (!all.length) throw new HttpError(400, 'add at least one stop before starting the simulation');

    let roster = scenario?.participants ?? this.participants.all().slice(0, 5);
    if (!roster.length) roster = ['Maya', 'Dev', 'Sam'].map((n) => this.participants.adopt(n.toLowerCase(), n));

    this.agents = await Promise.all(
      roster.map(async (who, i) => {
        const stops = all.filter((s) => appliesTo(s, who.id));
        if (!stops.length) return null;
        const pts = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
        const origin = who.origin
          ? { lat: who.origin.lat, lng: who.origin.lng }
          : destinationPoint(pts[0], BEARINGS[i % 5], DISTANCES_M[i % 5]);
        const route = await this.computeRoute(origin, pts[pts.length - 1], pts.slice(0, -1));
        const rawLegs = route.legs?.length === pts.length ? route.legs : estimateRoute([origin, ...pts]).legs;
        const legs = rawLegs.map((leg, j) => {
          const from = j === 0 ? origin : pts[j - 1];
          const path = buildPath(leg.path?.length >= 2 ? leg.path : [from, pts[j]]);
          const mps = leg.duration_s > 0 ? path.total / leg.duration_s : 8;
          return { path, mps: clamp(mps, 1, 30), stopId: stops[j].id, stop: pts[j] };
        });
        const firstLegS = legs[0].path.total / legs[0].mps;
        const departAt =
          scenario && who.depart_in_min != null
            ? scenario.t0 + who.depart_in_min * 60_000
            : Date.parse(stops[0].planned_arrival) - firstLegS * 1000 + START_OFFSET_MIN[i % 5] * 60_000;
        return {
          id: who.id,
          display_name: who.display_name,
          legs,
          leg: 0,
          d: 0,
          phase: 'waiting',
          departAt,
          dwellUntil: 0,
          delayUntil: 0,
          exit: null,
          lastTick: null,
          lastEmit: -Infinity,
          pace: 0.96 + Math.random() * 0.08,
          battery: 62 + Math.round(Math.random() * 33),
          pos: origin,
          heading: 0,
          speed: 0,
        };
      }),
    );
    this.agents = this.agents.filter(Boolean);
    if (!this.agents.length) throw new HttpError(400, 'no participant has any stops to visit');

    const firstDepart = Math.min(...this.agents.map((a) => a.departAt));
    clock.set(scenario ? Math.min(scenario.t0, firstDepart - 20_000) : firstDepart - 45_000, speed);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.emit('change');
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.agents = [];
  }

  stayMs(stopId) {
    return (this.engine.itinerary.stops.find((s) => s.id === stopId)?.stay_min ?? 0) * 60_000;
  }

  /** Adds `minutes` of delay to one person: they wait, linger, or get stuck in traffic. */
  delay(participantId, minutes = 5) {
    const a = this.agents.find((x) => x.id === participantId);
    if (!a) throw new HttpError(404, `no simulated participant "${participantId}"`);
    const ms = clamp(Number(minutes) || 5, 1, 120) * 60_000;
    const now = clock.now();
    if (a.phase === 'waiting') a.departAt = Math.max(a.departAt, now) + ms;
    else if (a.phase === 'dwell') a.dwellUntil += ms;
    else if (a.phase === 'moving') a.delayUntil = Math.max(a.delayUntil, now) + ms;
    this.emit('change');
    return { participant_id: a.id, phase: a.phase, added_min: ms / 60_000 };
  }

  tick() {
    const now = clock.now();
    const emitEvery = Math.max(3000, 1000 * clock.rate);
    for (const a of this.agents) {
      const dt = a.lastTick == null ? 0 : Math.max(0, now - a.lastTick);
      a.lastTick = now;
      this.advance(a, now, dt);
      if (now - a.lastEmit >= emitEvery) {
        a.lastEmit = now;
        this.emitUpdate(a, now, emitEvery);
      }
    }
  }

  advance(a, now, dt) {
    a.speed = 0;
    if (a.phase === 'waiting') {
      if (now < a.departAt) return;
      a.phase = 'moving';
    }
    if (a.phase === 'moving') {
      if (now < a.delayUntil) return;
      const leg = a.legs[a.leg];
      a.speed = leg.mps * a.pace;
      a.d += (a.speed * dt) / 1000;
      const p = pointAlong(leg.path, a.d);
      a.pos = { lat: p.lat, lng: p.lng };
      a.heading = p.bearing;
      if (a.d >= leg.path.total) {
        a.phase = 'dwell';
        a.speed = 0;
        a.pos = { ...leg.stop };
        a.dwellUntil = now + this.stayMs(leg.stopId);
        this.emit('change');
      }
      return;
    }
    if (a.phase === 'dwell') {
      if (now < a.dwellUntil) return;
      if (a.leg + 1 < a.legs.length) {
        a.leg++;
        a.d = 0;
        a.phase = 'moving';
      } else {
        // Walk out of the last stop's geofence so they count as done.
        a.phase = 'leaving';
        a.exit = buildPath([a.pos, destinationPoint(a.pos, a.heading, 250)]);
        a.d = 0;
      }
      this.emit('change');
      return;
    }
    if (a.phase === 'leaving') {
      a.speed = 1.4;
      a.d += (a.speed * dt) / 1000;
      const p = pointAlong(a.exit, a.d);
      a.pos = { lat: p.lat, lng: p.lng };
      if (a.d >= a.exit.total) {
        a.phase = 'done';
        this.emit('change');
      }
    }
  }

  emitUpdate(a, now, intervalMs) {
    let { lat, lng } = a.pos;
    if (a.phase === 'dwell' || a.phase === 'waiting' || a.phase === 'done') {
      ({ lat, lng } = destinationPoint(a.pos, Math.random() * 360, Math.random() * 8));
    }
    a.battery = Math.max(4, a.battery - (BATTERY_DRAIN_PER_HOUR * intervalMs) / 3_600_000);
    this.onUpdate({
      source: 'simulator',
      event_type: 'transit_location_update',
      participant_id: a.id,
      display_name: a.display_name,
      location: {
        lat,
        lng,
        accuracy_m: Math.round(5 + Math.random() * 10),
        speed_mps: Math.round(a.speed * 10) / 10,
        heading_deg: a.speed > 0.5 ? Math.round(a.heading) : null,
      },
      battery_pct: Math.round(a.battery),
      timestamp: new Date(now).toISOString(),
    });
  }
}
