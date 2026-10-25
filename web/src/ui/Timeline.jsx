import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { driftTone, fmtDrift, fmtTime } from '../lib/format.js';
import { useReducedMotion } from '../lib/motion.js';
import { DriftBadge } from './DriftBadge.jsx';
import { RollingText } from './RollingText.jsx';
import { StopSearch } from './StopSearch.jsx';
import { Check, Close, Grip } from './icons.jsx';

const pad = (n) => String(n).padStart(2, '0');
const toHHMM = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function TimeInput({ value, onCommit }) {
  const [draft, setDraft] = useState(toHHMM(value));
  useEffect(() => setDraft(toHHMM(value)), [value]);
  const commit = () => {
    const [h, m] = draft.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return setDraft(toHHMM(value));
    const d = new Date(value);
    d.setHours(h, m, 0, 0);
    if (d.getTime() !== value) onCommit(d.getTime());
  };
  return (
    <input
      type="time"
      className="inline-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      aria-label="Planned arrival"
    />
  );
}

function StayInput({ value, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n < 0) return setDraft(String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <span className="stay-input">
      <input
        type="number"
        min="0"
        step="5"
        className="inline-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label="Stay length in minutes"
      />
      <span className="unit">min</span>
    </span>
  );
}

/** Smoothly animates rows to their new positions after a reorder (FLIP). */
function useFlip(listRef, keys) {
  const reduced = useReducedMotion();
  const prev = useRef(new Map());
  useLayoutEffect(() => {
    const rows = [...(listRef.current?.children ?? [])];
    const next = new Map(rows.map((el) => [el.dataset.id, el.getBoundingClientRect().top]));
    if (!reduced) {
      for (const el of rows) {
        const before = prev.current.get(el.dataset.id);
        const after = next.get(el.dataset.id);
        if (before == null || Math.abs(before - after) < 1) continue;
        el.animate([{ transform: `translateY(${before - after}px)` }, { transform: 'translateY(0)' }], {
          duration: 420,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    }
    prev.current = next;
  }, [keys, listRef, reduced]);
}

function PersonChips({ stop, people }) {
  const located = people.filter((p) => p.location);
  if (!located.length) return null;
  return (
    <div className="chips">
      {located.map((p) => {
        const done = p.completed_stop_ids.includes(stop.id);
        const here = p.at_stop_id === stop.id;
        const proj = p.projections[stop.id];
        return (
          <span key={p.id} className={`chip ${done || here ? 'chip-done' : ''}`} title={p.display_name}>
            <span className="chip-avatar" style={{ '--c': p.color }}>{p.initial}</span>
            {done ? <Check width={12} height={12} /> : here ? 'Here' : fmtTime(proj?.arrive_at)}
          </span>
        );
      })}
    </div>
  );
}

function newStopTime(list, now) {
  const step = 5 * 60_000;
  const last = list[list.length - 1];
  const base = last ? Date.parse(last.planned_arrival) + (last.stay_min + 20) * 60_000 : now + 30 * 60_000;
  return new Date(Math.ceil(base / step) * step).toISOString();
}

export function Timeline({ snap, vnow, mapsKey }) {
  const { itinerary, stop_states: stopStates, people, settings } = snap;
  const [draft, setDraft] = useState(null);
  const [draftVersion, setDraftVersion] = useState(null);
  const [error, setError] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [armedId, setArmedId] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (draft && itinerary.version !== draftVersion) setDraft(null);
  }, [itinerary.version, draft, draftVersion]);

  const list = draft ?? itinerary.stops;
  const states = new Map(stopStates.map((s) => [s.stop_id, s]));
  useFlip(listRef, list.map((s) => s.id).join('|'));

  const commit = async (next) => {
    setDraft(next);
    setDraftVersion(itinerary.version);
    setError(null);
    try {
      await api('/api/itinerary', { stops: next }, 'PUT');
    } catch (err) {
      setDraft(null);
      setError(err.message);
    }
  };
  const patch = (id, change) => commit(list.map((s) => (s.id === id ? { ...s, ...change } : s)));

  const onDrop = (targetId) => {
    const from = list.findIndex((s) => s.id === dragId);
    const to = list.findIndex((s) => s.id === targetId);
    setDragId(null);
    setOverId(null);
    setArmedId(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  const active = stopStates.find((s) => s.state === 'active');
  const activeStop = active && list.find((s) => s.id === active.stop_id);
  const bias = list[0] ? { lat: list[0].lat, lng: list[0].lng } : null;

  return (
    <div className="timeline-tab">
      {activeStop && (
        <section className={`next-card tone-${driftTone(active.drift_min, settings)}`}>
          <div className="next-label">Next up</div>
          <div className="next-name">{activeStop.name}</div>
          <div className="next-row">
            <div>
              <div className="next-time">
                <RollingText text={fmtTime(active.projected_at)} />
              </div>
              <div className="next-sub">
                Group ETA · planned {fmtTime(Date.parse(activeStop.planned_arrival))}
              </div>
            </div>
            <div className="next-right">
              <DriftBadge drift={active.drift_min} state={active.state} settings={settings} />
              <div className="next-sub">
                {active.arrived_count}/{active.total} there
              </div>
            </div>
          </div>
        </section>
      )}

      <ol className="timeline" ref={listRef}>
        {list.map((stop, i) => {
          const st = states.get(stop.id);
          const state = st?.state ?? 'upcoming';
          const planned = Date.parse(stop.planned_arrival);
          return (
            <li
              key={stop.id}
              data-id={stop.id}
              className={`stop-row state-${state} ${overId === stop.id && dragId !== stop.id ? 'drag-over' : ''} ${dragId === stop.id ? 'dragging' : ''}`}
              draggable={armedId === stop.id}
              onDragStart={(e) => {
                setDragId(stop.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', stop.id);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverId(stop.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(stop.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
                setArmedId(null);
              }}
            >
              <div className="rail">
                <span className="node">{state === 'completed' ? <Check width={13} height={13} /> : i + 1}</span>
              </div>
              <div className="stop-main">
                <div className="stop-top">
                  <div className="stop-name">{stop.name}</div>
                  <DriftBadge drift={st?.drift_min} state={state} settings={settings} />
                </div>
                {stop.address && <div className="stop-addr">{stop.address}</div>}
                <div className="stop-times">
                  <label className="field">
                    <span className="field-label">Planned</span>
                    <TimeInput value={planned} onCommit={(ms) => patch(stop.id, { planned_arrival: new Date(ms).toISOString() })} />
                  </label>
                  <div className="field">
                    <span className="field-label">{state === 'completed' ? 'Arrived' : 'Live'}</span>
                    <span className={`live-time tone-${driftTone(st?.drift_min, settings)}`}>
                      <RollingText text={fmtTime(st?.projected_at)} />
                    </span>
                  </div>
                  <label className="field">
                    <span className="field-label">Stay</span>
                    <StayInput value={stop.stay_min} onCommit={(n) => patch(stop.id, { stay_min: n })} />
                  </label>
                </div>
                <PersonChips stop={stop} people={people} />
              </div>
              <div className="row-actions">
                <span
                  className="drag-handle"
                  title="Drag to reorder"
                  onPointerDown={() => setArmedId(stop.id)}
                  onPointerUp={() => !dragId && setArmedId(null)}
                >
                  <Grip />
                </span>
                <button
                  type="button"
                  className="icon-btn subtle"
                  aria-label={`Remove ${stop.name}`}
                  onClick={() => commit(list.filter((s) => s.id !== stop.id))}
                >
                  <Close />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {!list.length && <div className="empty">No stops yet. Search for a place to start the plan.</div>}

      <StopSearch
        mapsKey={mapsKey}
        bias={bias}
        onPick={(place) => commit([...list, { ...place, planned_arrival: newStopTime(list, vnow), stay_min: 45 }])}
      />
      {error && <div className="hint error">{error}</div>}
      {list.length > 0 && (
        <div className="hint">
          Drift: <span className="tone-good-text">{fmtDrift(0)}</span> ≤ {settings.late_min} min ·{' '}
          <span className="tone-warn-text">late</span> · <span className="tone-bad-text">very late</span> &gt; {settings.very_late_min} min
        </div>
      )}
    </div>
  );
}
