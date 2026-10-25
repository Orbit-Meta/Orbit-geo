import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const SPEEDS = { replay: [1, 4, 10], simulate: [1, 4, 10, 30] };
const STORE_KEY = 'orbit.devbar.hidden';

function readHidden() {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Hideable demo controls. Toggle with the ` key. */
export function DevBar({ snap, connected }) {
  const [hidden, setHidden] = useState(readHidden);
  const [tab, setTab] = useState('live');
  const [recordings, setRecordings] = useState([]);
  const [file, setFile] = useState('');
  const [speed, setSpeed] = useState({ replay: 4, simulate: 10 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mode = snap?.mode;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, hidden ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, [hidden]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '`' && !e.target.closest?.('input, textarea, gmp-place-autocomplete')) setHidden((h) => !h);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (mode?.name) setTab(mode.name);
  }, [mode?.name]);

  const loadRecordings = useCallback(() => {
    api('/api/recordings')
      .then((list) => {
        setRecordings(list);
        setFile((f) => f || list[0]?.name || '');
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (tab === 'replay') loadRecordings();
  }, [tab, loadRecordings]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const start = (name, extra = {}) => run(() => api('/api/mode', { mode: name, ...extra }));
  const changeSpeed = (kind, s) => {
    setSpeed((cur) => ({ ...cur, [kind]: s }));
    if (mode?.name === kind) run(() => api('/api/mode/speed', { speed: s }));
  };

  if (hidden) return null;
  const replay = mode?.replay;
  const sim = mode?.sim;

  return (
    <div className="devbar glass" role="region" aria-label="Demo controls">
      <div className="devbar-row">
        <span className={`conn ${connected ? 'on' : ''}`} title={connected ? 'Connected' : 'Disconnected'} />
        <div className="seg">
          {['live', 'replay', 'simulate'].map((t) => (
            <button key={t} type="button" className={`seg-btn ${tab === t ? 'active' : ''} ${mode?.name === t ? 'current' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'live' && (
          <>
            {mode?.name === 'live' ? (
              <span className="dev-note">
                {mode.recording ? `● REC ${mode.recording.count} updates` : 'Waiting for OwnTracks…'}
              </span>
            ) : (
              <button type="button" className="dev-btn primary" disabled={busy} onClick={() => start('live')}>
                Go live
              </button>
            )}
            <button type="button" className="dev-btn" disabled={busy} onClick={() => run(() => api('/api/itinerary/rebase', { first_in_min: 20 }))} title="Shift every planned time so stop 1 is 20 minutes from now">
              Rebase plan
            </button>
          </>
        )}

        {tab === 'replay' && (
          <>
            <select className="dev-select" value={file} onChange={(e) => setFile(e.target.value)} onFocus={loadRecordings}>
              {!recordings.length && <option value="">No recordings yet</option>}
              {recordings.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name.replace(/^session-|\.json$/g, '')}
                </option>
              ))}
            </select>
            <SpeedChips speeds={SPEEDS.replay} value={speed.replay} onChange={(s) => changeSpeed('replay', s)} />
            <button type="button" className="dev-btn primary" disabled={busy || !file} onClick={() => start('replay', { file, speed: speed.replay })}>
              {mode?.name === 'replay' ? 'Restart' : 'Play'}
            </button>
            {replay && (
              <span className="progress" title={`${replay.index}/${replay.total}`}>
                <span style={{ width: `${(100 * replay.index) / Math.max(1, replay.total)}%` }} />
              </span>
            )}
          </>
        )}

        {tab === 'simulate' && (
          <>
            <SpeedChips speeds={SPEEDS.simulate} value={speed.simulate} onChange={(s) => changeSpeed('simulate', s)} />
            <button type="button" className="dev-btn primary" disabled={busy} onClick={() => start('simulate', { speed: speed.simulate })}>
              {mode?.name === 'simulate' ? 'Restart' : 'Start'}
            </button>
            {sim?.running &&
              sim.agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="dev-btn"
                  disabled={busy || a.phase === 'done'}
                  onClick={() => run(() => api('/api/sim/delay', { participant_id: a.id, minutes: 5 }))}
                  title={`Delay ${a.display_name} by 5 minutes (${a.phase})`}
                >
                  {a.display_name} +5m
                </button>
              ))}
          </>
        )}

        <span className="dev-note subtle">
          Routes API {snap?.routes?.calls ?? 0}
          {snap?.routes && !snap.routes.key_configured ? ' (est.)' : ''}
        </span>
        <button type="button" className="dev-btn ghost" onClick={() => setHidden(true)} title="Hide (press ` to show)">
          Hide
        </button>
      </div>
      {error && <div className="dev-error">{error}</div>}
    </div>
  );
}

function SpeedChips({ speeds, value, onChange }) {
  return (
    <div className="seg small">
      {speeds.map((s) => (
        <button key={s} type="button" className={`seg-btn ${value === s ? 'active' : ''}`} onClick={() => onChange(s)}>
          {s}×
        </button>
      ))}
    </div>
  );
}
