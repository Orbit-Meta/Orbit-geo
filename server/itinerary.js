import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const newId = () => crypto.randomUUID().slice(0, 8);

/** Validates and cleans a stops array coming from the UI, a tool call, or disk. */
export function normalizeStops(input) {
  if (!Array.isArray(input)) throw new HttpError(400, 'stops must be an array');
  const seen = new Set();
  return input.map((s, i) => {
    const lat = Number(s?.lat);
    const lng = Number(s?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new HttpError(400, `stop ${i + 1}: lat/lng are required`);
    }
    const planned = Date.parse(s.planned_arrival);
    if (!Number.isFinite(planned)) throw new HttpError(400, `stop ${i + 1}: planned_arrival must be an ISO-8601 time`);
    let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim().slice(0, 64) : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const stay = Number(s.stay_min);
    return {
      id,
      name: String(s.name || `Stop ${i + 1}`).slice(0, 120),
      address: String(s.address || '').slice(0, 240),
      lat,
      lng,
      planned_arrival: new Date(planned).toISOString(),
      stay_min: Number.isFinite(stay) ? Math.max(0, Math.min(24 * 60, Math.round(stay))) : 0,
      ...(s.place_id ? { place_id: String(s.place_id).slice(0, 200) } : {}),
    };
  });
}

/** A sample Austin evening so the dashboard is never empty on first run. */
export function seedStops(now = Date.now()) {
  const step = 5 * 60_000;
  const base = Math.ceil((now + 30 * 60_000) / step) * step;
  const at = (min) => new Date(base + min * 60_000).toISOString();
  return [
    { id: 'tacos', name: "Torchy's Tacos", address: '1822 S Congress Ave, Austin, TX 78704', lat: 30.2455, lng: -97.7508, planned_arrival: at(0), stay_min: 45 },
    { id: 'movie', name: 'Alamo Drafthouse South Lamar', address: '1120 S Lamar Blvd, Austin, TX 78704', lat: 30.2563, lng: -97.763, planned_arrival: at(60), stay_min: 135 },
    { id: 'dessert', name: 'Voodoo Doughnut', address: '212 E 6th St, Austin, TX 78701', lat: 30.2673, lng: -97.7404, planned_arrival: at(210), stay_min: 30 },
  ];
}

export function loadItinerary(file) {
  try {
    return normalizeStops(JSON.parse(fs.readFileSync(file, 'utf8')).stops);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[itinerary] ${file} unreadable (${err.message}); using sample stops`);
    return seedStops();
  }
}

export function saveItinerary(file, stops) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ stops }, null, 2));
}

/** Shifts every planned time so the first stop lands at `firstAtMs`, keeping the gaps. */
export function rebaseStops(stops, firstAtMs) {
  if (!stops.length) return stops;
  const delta = firstAtMs - Date.parse(stops[0].planned_arrival);
  return stops.map((s) => ({ ...s, planned_arrival: new Date(Date.parse(s.planned_arrival) + delta).toISOString() }));
}
