import { driftTone, fmtAgo, fmtCountdown, fmtDistance, fmtSpeed, fmtTime } from '../lib/format.js';
import { staleAfterMs } from '../lib/useOrbit.js';
import { Battery } from './icons.jsx';

function statusLabel(p, stopName, settings) {
  switch (p.status) {
    case 'arrived':
      return { text: `At ${stopName}`, tone: 'info' };
    case 'done':
      return { text: 'Done for the night', tone: 'neutral' };
    case 'late':
      return { text: `${Math.round(p.drift_min)} min late`, tone: driftTone(p.drift_min, settings) };
    case 'idle':
      return { text: 'No plan', tone: 'neutral' };
    default:
      return { text: 'On time', tone: 'good' };
  }
}

function PersonCard({ p, stops, vnow, snap, following, onFollow }) {
  const { settings } = snap;
  const units = settings.units;
  const target = stops.get(p.target_stop_id) ?? stops.get(p.at_stop_id);
  const ageS = p.ts ? Math.max(0, (vnow - p.ts) / 1000) : null;
  const stale = p.ts != null && vnow - p.ts > staleAfterMs(snap);
  const status = statusLabel(p, target?.name ?? 'stop', settings);
  const etaMs = p.eta ? p.eta.arrive_at - vnow : null;
  const big =
    p.status === 'arrived' ? 'Here' : p.status === 'done' ? '✓' : p.location ? fmtCountdown(etaMs) : '—';

  return (
    <button type="button" className={`person-card ${stale ? 'stale' : ''} ${following ? 'following' : ''}`} onClick={() => onFollow(p.id)}>
      <div className="pc-head">
        <span className="pc-avatar" style={{ '--c': p.color }}>
          {p.initial}
        </span>
        <div className="pc-id">
          <div className="pc-name">{p.display_name}</div>
          <div className="pc-target">
            {p.status === 'done' ? 'Finished the plan' : target ? `→ ${target.name}` : 'Waiting for a plan'}
          </div>
        </div>
        <span className={`badge tone-${status.tone}`}>{status.text}</span>
      </div>

      <div className="pc-eta">
        <div className="pc-countdown">{big}</div>
        <div className="pc-eta-sub">
          {p.status === 'arrived' && p.arrivals?.[p.at_stop_id]
            ? `since ${fmtTime(p.arrivals[p.at_stop_id])}`
            : p.eta
              ? `arrives ${fmtTime(p.eta.arrive_at)}${p.eta.estimated ? ' · est.' : ''}`
              : p.location
                ? 'calculating…'
                : 'waiting for location'}
        </div>
      </div>

      <div className="pc-stats">
        <div>
          <span className="stat-label">Distance</span>
          <span className="stat-value">{p.eta ? fmtDistance(p.eta.distance_remaining_m, units) : '—'}</span>
        </div>
        <div>
          <span className="stat-label">Speed</span>
          <span className="stat-value">{fmtSpeed(p.location?.speed_mps, units)}</span>
        </div>
        <div>
          <span className="stat-label">Battery</span>
          <span className={`stat-value ${p.battery_pct != null && p.battery_pct < 20 ? 'tone-bad-text' : ''}`}>
            <Battery pct={p.battery_pct} /> {p.battery_pct == null ? '—' : `${Math.round(p.battery_pct)}%`}
          </span>
        </div>
      </div>

      <div className="pc-foot">
        <span className={`seen-dot ${stale ? 'stale' : ''}`} />
        {stale ? 'Phone offline · ' : ''}last update {fmtAgo(ageS)}
      </div>
    </button>
  );
}

export function People({ snap, vnow, followId, onFollow }) {
  const stops = new Map(snap.itinerary.stops.map((s) => [s.id, s]));
  if (!snap.people.length) {
    return (
      <div className="empty">
        Nobody is sharing yet. Point OwnTracks at <code>/owntracks</code>, or start a simulation from the dev bar.
      </div>
    );
  }
  return (
    <div className="people">
      {snap.people.map((p) => (
        <PersonCard key={p.id} p={p} stops={stops} vnow={vnow} snap={snap} following={followId === p.id} onFollow={onFollow} />
      ))}
    </div>
  );
}
