import { useState } from 'react';
import { fmtTime } from '../lib/format.js';
import { useTick, virtualNow } from '../lib/useOrbit.js';
import { People } from './People.jsx';
import { Timeline } from './Timeline.jsx';
import { Moon, OrbitMark, Sun } from './icons.jsx';

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'people', label: 'People' },
];

export function Panel({ snap, theme, onToggleTheme, mapsKey, followId, onFollow }) {
  const [tab, setTab] = useState('timeline');
  useTick(1000);
  const vnow = virtualNow(snap);
  const located = snap?.people.filter((p) => p.location).length ?? 0;

  return (
    <aside className="panel glass" aria-label="Itinerary and people">
      <header className="panel-head">
        <div className="brand">
          <OrbitMark />
          <div>
            <div className="brand-name">Meta Orbit</div>
            <div className="brand-sub">
              <span className="live-dot" /> Live · {fmtTime(vnow)}
            </div>
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>
      </header>

      <div className="tabs" role="tablist" data-active={tab}>
        <span className="tab-indicator" />
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'people' && located > 0 && <span className="tab-count">{located}</span>}
          </button>
        ))}
      </div>

      <div className="panel-body">
        {!snap ? (
          <div className="empty">Connecting…</div>
        ) : tab === 'timeline' ? (
          <Timeline snap={snap} vnow={vnow} mapsKey={mapsKey} />
        ) : (
          <People snap={snap} vnow={vnow} followId={followId} onFollow={onFollow} />
        )}
      </div>
    </aside>
  );
}
