import { EventEmitter } from 'node:events';
import { clock } from './clock.js';
import { HttpError } from './itinerary.js';

export const SPEEDS = { replay: [1, 4, 10], simulate: [1, 4, 10, 30] };

/**
 * live:     OwnTracks updates flow in and are recorded.
 * replay:   a recording is fed back through Engine.ingest on a virtual clock.
 * simulate: fake participants drive real routes through Engine.ingest.
 */
export class ModeManager extends EventEmitter {
  constructor({ engine, recorder, simulator, alerts }) {
    super();
    this.engine = engine;
    this.recorder = recorder;
    this.simulator = simulator;
    this.alerts = alerts;
    this.mode = 'live';
    this.replay = null;
    this.liveStops = null;
    simulator.on('change', () => this.emit('change'));
  }

  ingestLive(update) {
    if (this.mode !== 'live') return false;
    this.recorder.record(update, this.engine.itinerary.stops);
    this.engine.ingest(update);
    return true;
  }

  info() {
    const r = this.replay;
    return {
      name: this.mode,
      speed: clock.rate,
      speeds: SPEEDS[this.mode] ?? [1],
      recording: this.mode === 'live' ? this.recorder.info() : null,
      replay: r ? { file: r.file, index: r.index, total: r.entries.length, playing: r.playing } : null,
      sim: this.mode === 'simulate' ? this.simulator.info() : null,
    };
  }

  checkSpeed(mode, speed) {
    const s = Number(speed) || 1;
    if (!SPEEDS[mode]?.includes(s)) throw new HttpError(400, `${mode} speed must be one of ${SPEEDS[mode].join(', ')}`);
    return s;
  }

  async setMode(name, opts = {}) {
    if (!['live', 'replay', 'simulate'].includes(name)) throw new HttpError(400, 'mode must be live, replay or simulate');
    const speed = name === 'live' ? 1 : this.checkSpeed(name, opts.speed ?? 1);
    const file = name === 'replay' ? opts.file || this.recorder.list()[0]?.name : null;
    const recording = name === 'replay' ? this.recorder.load(file) : null; // fail before tearing anything down

    this.teardown();
    if (this.liveStops) {
      this.engine.setItinerary(this.liveStops, { persist: false });
      this.liveStops = null;
    }
    this.engine.reset();
    this.mode = name;

    try {
      if (name === 'live') clock.reset();
      else if (name === 'replay') this.startReplay(recording, file, speed);
      else await this.simulator.start({ speed });
    } catch (err) {
      this.mode = 'live';
      clock.reset();
      throw err;
    } finally {
      this.alerts.reset();
      this.emit('change');
    }
  }

  setSpeed(speed) {
    if (this.mode === 'live') throw new HttpError(400, 'speed only applies to replay and simulate');
    clock.setRate(this.checkSpeed(this.mode, speed));
    if (this.replay) {
      clearTimeout(this.replay.timer);
      this.tickReplay();
    }
    this.emit('change');
  }

  teardown() {
    if (this.mode === 'live') this.recorder.stop();
    this.simulator.stop();
    if (this.replay) clearTimeout(this.replay.timer);
    this.replay = null;
  }

  startReplay(rec, file, speed) {
    this.liveStops = this.engine.itinerary.stops;
    if (rec.itinerary?.length) this.engine.setItinerary(rec.itinerary, { persist: false });
    const entries = [...rec.entries].sort((a, b) => a.received_at - b.received_at);
    clock.set((entries[0]?.received_at ?? Date.now()) - 1500, speed);
    this.replay = { file, entries, index: 0, playing: true, timer: null };
    this.tickReplay();
  }

  tickReplay() {
    const r = this.replay;
    if (!r?.playing) return;
    const now = clock.now();
    while (r.index < r.entries.length && r.entries[r.index].received_at <= now) {
      const e = r.entries[r.index++];
      if (e.kind === 'itinerary') this.engine.setItinerary(e.stops, { persist: false });
      else this.engine.ingest(e.update ?? e);
    }
    if (r.index >= r.entries.length) {
      r.playing = false;
      this.emit('change');
      return;
    }
    const wait = (r.entries[r.index].received_at - now) / clock.rate;
    r.timer = setTimeout(() => this.tickReplay(), Math.min(Math.max(wait, 5), 1000));
    this.emit('change');
  }
}
