// Pure, deterministic schedule math. No I/O and never the LLM.

const round1 = (v) => Math.round(v * 10) / 10;

/** A stop with a `participants` list is a personal stop (e.g. one person's food run). */
export const appliesTo = (stop, participantId) => !stop.participants?.length || stop.participants.includes(participantId);

function entry(arriveAt, plannedMs, kind) {
  return {
    arrive_at: arriveAt,
    drift_min: arriveAt == null ? null : round1((arriveAt - plannedMs) / 60_000),
    kind,
  };
}

/**
 * Projected arrival at every stop for one person.
 *   next stop:   live ETA (or actual arrival if they are there now)
 *   later stops: previous arrival + stay length + cached stop-to-stop travel time
 *   drift:       projected − planned, in minutes
 *
 * @param {object} args
 * @param {Array}  args.stops        ordered itinerary
 * @param {Set}    args.completed    stop ids the person has finished (arrived and left)
 * @param {object} args.arrivals     stopId → actual arrival ms
 * @param {string|null} args.atStopId stop the person is inside right now
 * @param {object|null} args.eta     { stop_id, computed_at, duration_s }
 * @param {number} args.now          virtual now (ms)
 * @param {(a, b) => number} args.legSeconds  travel time between two stops
 */
export function projectPerson({ stops, completed, arrivals, atStopId, eta, now, legSeconds }) {
  const out = {};
  let prev = null;
  let departAt = null;

  for (const stop of stops) {
    const planned = Date.parse(stop.planned_arrival);
    const stayMs = stop.stay_min * 60_000;

    if (completed.has(stop.id)) {
      out[stop.id] = entry(arrivals[stop.id] ?? null, planned, 'completed');
      continue;
    }

    let arrive = null;
    let kind = 'projected';
    if (prev === null) {
      // First stop they have not finished: their current target.
      if (atStopId === stop.id) {
        arrive = arrivals[stop.id] ?? now;
        kind = 'at_stop';
        departAt = Math.max(arrive + stayMs, now);
      } else if (eta && eta.stop_id === stop.id) {
        arrive = Math.max(eta.computed_at + eta.duration_s * 1000, now);
        departAt = arrive + stayMs;
      }
    } else if (departAt !== null) {
      arrive = departAt + legSeconds(prev, stop) * 1000;
      departAt = arrive + stayMs;
    }

    out[stop.id] = entry(arrive, planned, kind);
    prev = stop;
  }
  return out;
}

export function personStatus({ stops, completed, atStopId, projections, lateMin }) {
  if (!stops.length) return { status: 'idle', target: null };
  const target = stops.find((s) => !completed.has(s.id)) ?? null;
  if (!target) return { status: 'done', target: null };
  if (atStopId === target.id) return { status: 'arrived', target };
  const drift = projections[target.id]?.drift_min;
  return { status: drift != null && drift > lateMin ? 'late' : 'on_time', target };
}

/**
 * Group view of each stop, over the people it applies to: when they are all
 * projected to be there (latest person), drift vs. plan, and
 * completed (all left) / active (someone's current target) / upcoming.
 *
 * @param people [{ id, completed, at_stop_id, target_id, projections }]
 */
export function groupStopView(stops, people) {
  return stops.map((s) => {
    const ps = people.filter((p) => appliesTo(s, p.id));
    const planned = Date.parse(s.planned_arrival);
    const times = ps.map((p) => p.projections[s.id]?.arrive_at).filter((v) => v != null);
    const projected = times.length ? Math.max(...times) : null;
    const completed = ps.length > 0 && ps.every((p) => p.completed.has(s.id));
    const active = !completed && (ps.some((p) => p.target_id === s.id) || (!people.length && s === stops[0]));
    return {
      stop_id: s.id,
      projected_at: projected,
      drift_min: projected == null ? null : round1((projected - planned) / 60_000),
      state: completed ? 'completed' : active ? 'active' : 'upcoming',
      here: ps.filter((p) => p.at_stop_id === s.id).map((p) => p.id),
      arrived_count: ps.filter((p) => p.at_stop_id === s.id || p.completed.has(s.id)).length,
      total: ps.length,
    };
  });
}
