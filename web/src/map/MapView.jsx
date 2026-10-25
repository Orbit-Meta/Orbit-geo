import { useEffect, useRef } from 'react';
import { loadGoogleMaps } from '../lib/maps.js';
import { MapScene } from './MapScene.js';

/**
 * Thin React wrapper around MapScene. The scene is rebuilt when the theme
 * changes (the map's color scheme is fixed at construction) and keeps its
 * camera across the rebuild.
 */
export function MapView({ config, theme, snap, sceneRef, onModeChange, onPersonClick, onError }) {
  const hostRef = useRef(null);
  const snapRef = useRef(snap);
  const restoreRef = useRef(null);
  const cbRef = useRef({ onModeChange, onPersonClick, onError });
  cbRef.current = { onModeChange, onPersonClick, onError };

  useEffect(() => {
    let scene = null;
    let cancelled = false;
    (async () => {
      try {
        await loadGoogleMaps(config.mapsKey);
        if (cancelled) return;
        scene = new MapScene(hostRef.current, {
          mapId: config.mapId,
          theme,
          restore: restoreRef.current,
          onModeChange: (m) => cbRef.current.onModeChange?.(m),
          onPersonClick: (id) => cbRef.current.onPersonClick?.(id),
        });
        await scene.init();
        if (cancelled) {
          scene.destroy();
          return;
        }
        sceneRef.current = scene;
        if (snapRef.current) scene.update(snapRef.current);
      } catch (err) {
        cbRef.current.onError?.(err.message);
      }
    })();
    return () => {
      cancelled = true;
      if (scene?.map) restoreRef.current = scene.getCameraState();
      scene?.destroy();
      sceneRef.current = null;
    };
  }, [config.mapsKey, config.mapId, theme, sceneRef]);

  useEffect(() => {
    snapRef.current = snap;
    if (snap) sceneRef.current?.update(snap);
  }, [snap, sceneRef]);

  return <div ref={hostRef} className="map" />;
}
