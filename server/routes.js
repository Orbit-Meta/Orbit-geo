import { config } from './config.js';
import { decodePolyline, distanceM } from './geo.js';

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.legs.duration',
  'routes.legs.distanceMeters',
  'routes.legs.polyline.encodedPolyline',
].join(',');

// Fallback speeds (m/s) and a detour factor for when the Routes API is unavailable.
const SPEEDS = { DRIVE: 9, TWO_WHEELER: 9, BICYCLE: 4.5, WALK: 1.35, TRANSIT: 6 };
const DETOUR = 1.35;

const stats = { calls: 0, errors: 0, last_error: null };
let warned = false;

export const routeStats = () => ({ ...stats, key_configured: Boolean(config.serverKey), travel_mode: config.travelMode });

const pt = (p) => ({ lat: p.lat, lng: p.lng });
const waypoint = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
const seconds = (d) => (d ? parseFloat(String(d)) || 0 : 0);

/** Straight-line estimate with the same shape as a Routes API result. */
export function estimateRoute(points) {
  const pts = points.map(pt);
  const speed = SPEEDS[config.travelMode] ?? SPEEDS.DRIVE;
  const legs = [];
  for (let i = 1; i < pts.length; i++) {
    const d = distanceM(pts[i - 1], pts[i]) * DETOUR;
    legs.push({ duration_s: d / speed, distance_m: d, path: [pts[i - 1], pts[i]] });
  }
  return {
    duration_s: legs.reduce((a, l) => a + l.duration_s, 0),
    distance_m: legs.reduce((a, l) => a + l.distance_m, 0),
    path: pts,
    legs,
    estimated: true,
  };
}

/**
 * Traffic-aware route from origin to destination via optional intermediates.
 * Never throws: on any failure it falls back to a straight-line estimate.
 */
export async function computeRoute(origin, destination, intermediates = []) {
  const all = [origin, ...intermediates, destination];
  if (!config.serverKey) return estimateRoute(all);

  const mode = config.travelMode;
  const body = {
    origin: waypoint(origin),
    destination: waypoint(destination),
    travelMode: mode,
    polylineQuality: 'HIGH_QUALITY',
  };
  if (intermediates.length) body.intermediates = intermediates.map(waypoint);
  if (mode === 'DRIVE' || mode === 'TWO_WHEELER') body.routingPreference = 'TRAFFIC_AWARE';

  stats.calls++;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.serverKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Routes API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const route = (await res.json()).routes?.[0];
    if (!route) throw new Error('Routes API returned no route');
    return {
      duration_s: seconds(route.duration),
      distance_m: route.distanceMeters ?? 0,
      path: decodePolyline(route.polyline?.encodedPolyline),
      legs: (route.legs || []).map((l) => ({
        duration_s: seconds(l.duration),
        distance_m: l.distanceMeters ?? 0,
        path: decodePolyline(l.polyline?.encodedPolyline),
      })),
      estimated: false,
    };
  } catch (err) {
    stats.errors++;
    stats.last_error = err.message;
    if (!warned) {
      warned = true;
      console.warn(`[routes] ${err.message} — falling back to straight-line estimates`);
    }
    return estimateRoute(all);
  }
}
