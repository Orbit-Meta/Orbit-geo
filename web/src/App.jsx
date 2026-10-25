import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { useOrbit } from './lib/useOrbit.js';
import { MapView } from './map/MapView.jsx';
import { CameraControls } from './ui/CameraControls.jsx';
import { DevBar } from './ui/DevBar.jsx';
import { Panel } from './ui/Panel.jsx';
import { Toasts } from './ui/Toasts.jsx';

function initialTheme() {
  try {
    const saved = localStorage.getItem('orbit.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage blocked */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('orbit.theme', theme);
    } catch {
      /* storage blocked */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

/** /replay?file=session-….json&speed=4 starts a replay on load. */
function useReplayRoute(snap) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !snap || !window.location.pathname.startsWith('/replay')) return;
    started.current = true;
    if (snap.mode.name === 'replay') return;
    const q = new URLSearchParams(window.location.search);
    api('/api/mode', { mode: 'replay', file: q.get('file') || undefined, speed: Number(q.get('speed')) || 1 }).catch((err) =>
      console.warn('replay:', err.message),
    );
  }, [snap]);
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [mapError, setMapError] = useState(null);
  const [camera, setCamera] = useState({ mode: 'intro', followId: null });
  const [theme, toggleTheme] = useTheme();
  const { snap, toasts, connected } = useOrbit();
  const sceneRef = useRef(null);
  useReplayRoute(snap);

  useEffect(() => {
    api('/api/config')
      .then(setConfig)
      .catch((err) => setConfig({ error: err.message }));
    const onAuth = () => setMapError('Google Maps rejected the API key. Check the key, its referrer restrictions, and that the Maps JavaScript API is enabled.');
    window.addEventListener('orbit:maps-auth-failure', onAuth);
    return () => window.removeEventListener('orbit:maps-auth-failure', onAuth);
  }, []);

  const follow = useCallback((id) => sceneRef.current?.setMode('follow', id), []);
  const overview = useCallback(() => sceneRef.current?.setMode('overview'), []);

  return (
    <div className="app">
      {config?.mapsKey ? (
        <MapView config={config} theme={theme} snap={snap} sceneRef={sceneRef} onModeChange={setCamera} onPersonClick={follow} onError={setMapError} />
      ) : (
        <div className="map map-placeholder">
          {config && <div className="setup-note glass">Add GOOGLE_MAPS_API_KEY and GOOGLE_MAP_ID to .env, then restart the server.</div>}
        </div>
      )}
      {mapError && <div className="setup-note glass floating">{mapError}</div>}

      <Panel snap={snap} theme={theme} onToggleTheme={toggleTheme} mapsKey={config?.mapsKey} followId={camera.followId} onFollow={follow} />
      <CameraControls camera={camera} people={snap?.people ?? []} onOverview={overview} onFollow={follow} />
      <Toasts toasts={toasts} />
      <DevBar snap={snap} connected={connected} />
    </div>
  );
}
