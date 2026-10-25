import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './itinerary.js';

/**
 * Demo scenarios (data/scenarios/*.json): fixed people, start points and stops
 * with times relative to "now", played through simulate mode.
 */
export class Scenarios {
  constructor(dir) {
    this.dir = dir;
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const id = f.replace(/\.json$/, '');
        try {
          const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
          return { id, name: s.name ?? id, description: s.description ?? '' };
        } catch {
          return { id, name: id, description: 'unreadable' };
        }
      });
  }

  /** Loads a scenario and materializes its stop times relative to t0. */
  load(id, t0 = Date.now()) {
    const safe = path.basename(String(id ?? ''));
    if (!/^[\w.-]+$/.test(safe)) throw new HttpError(400, 'invalid scenario name');
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(this.dir, `${safe}.json`), 'utf8'));
    } catch (err) {
      throw new HttpError(err.code === 'ENOENT' ? 404 : 400, `cannot read scenario "${safe}": ${err.message}`);
    }
    if (!Array.isArray(raw.participants) || !Array.isArray(raw.stops)) {
      throw new HttpError(400, `scenario "${safe}" needs participants and stops`);
    }
    const stops = raw.stops.map(({ planned_in_min: inMin, ...s }) => ({
      ...s,
      planned_arrival: s.planned_arrival ?? new Date(t0 + (Number(inMin) || 0) * 60_000).toISOString(),
    }));
    return { id: safe, name: raw.name ?? safe, t0, participants: raw.participants, stops };
  }
}
