import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './itinerary.js';

/**
 * Records every live normalized update (and itinerary edits) to
 * recordings/session-<time>.json so it can be replayed through the pipeline.
 *
 * File format:
 *   { version: 1, started_at, itinerary: [stops], entries: [
 *       { received_at, kind: 'update', update } | { received_at, kind: 'itinerary', stops } ] }
 */
export class Recorder {
  constructor(dir) {
    this.dir = dir;
    this.session = null;
    this.flushTimer = null;
  }

  record(update, stops) {
    if (!this.session) this.open(stops);
    this.session.data.entries.push({ received_at: Date.now(), kind: 'update', update });
    this.scheduleFlush();
  }

  recordItinerary(stops) {
    if (!this.session) return;
    this.session.data.entries.push({ received_at: Date.now(), kind: 'itinerary', stops });
    this.scheduleFlush();
  }

  open(stops) {
    const started = new Date();
    const name = `session-${started.toISOString().replace(/[:.]/g, '-')}.json`;
    this.session = {
      name,
      file: path.join(this.dir, name),
      data: { version: 1, started_at: started.toISOString(), itinerary: stops, entries: [] },
    };
    console.log(`[recorder] recording to recordings/${name}`);
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 2000);
  }

  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.session) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.session.file, JSON.stringify(this.session.data));
  }

  stop() {
    this.flush();
    this.session = null;
  }

  info() {
    return this.session ? { name: this.session.name, count: this.session.data.entries.length } : null;
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((name) => {
        const stat = fs.statSync(path.join(this.dir, name));
        return { name, size: stat.size, modified_at: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  }

  load(name) {
    if (!name) throw new HttpError(400, 'no recordings yet — run a live session first');
    const safe = path.basename(String(name));
    if (!/^[\w.-]+\.json$/.test(safe)) throw new HttpError(400, 'invalid recording name');
    if (this.session?.name === safe) this.flush();
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(this.dir, safe), 'utf8'));
    } catch (err) {
      throw new HttpError(err.code === 'ENOENT' ? 404 : 400, `cannot read ${safe}: ${err.message}`);
    }
    if (!Array.isArray(data.entries)) throw new HttpError(400, `${safe} has no entries`);
    return data;
  }
}
