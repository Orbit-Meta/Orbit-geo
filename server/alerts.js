import crypto from 'node:crypto';
import { config } from './config.js';
import { fmtClock } from './format.js';
import { HttpError } from './itinerary.js';

// Ignore lateness/shift transitions right after a reset while first ETAs land.
const WARMUP_MS = 12_000;

/**
 * Turns state changes into toasts (dashboard) and Discord posts (via Muse):
 * arrivals, someone falling late, and the plan shifting by > 5 minutes.
 * The same alert never fires twice in a row.
 */
export class Alerts {
  constructor({ discord, muse, emitToast }) {
    this.discord = discord;
    this.muse = muse;
    this.emitToast = emitToast;
    this.chain = Promise.resolve();
    this.view = null;
    this.reset();
  }

  reset() {
    this.prevStatus = new Map();
    this.veryLate = new Set();
    this.baselines = new Map();
    this.pending = [];
    this.lastKey = null;
    this.warmupUntil = Date.now() + WARMUP_MS;
  }

  resetBaselines() {
    this.baselines.clear();
  }

  queue(stopEvent) {
    if (stopEvent.type === 'arrived') this.pending.push(stopEvent);
  }

  evaluate(view) {
    this.view = view;
    const people = new Map(view.people.map((p) => [p.id, p]));
    const stops = new Map(view.itinerary.stops.map((s) => [s.id, s]));
    const located = view.people.filter((p) => p.location);

    for (const ev of this.pending.splice(0)) {
      const p = people.get(ev.participant_id);
      const s = stops.get(ev.stop_id);
      if (!p || !s) continue;
      this.fire(view, {
        key: `arrived:${p.id}:${s.id}`,
        kind: 'arrival',
        person: p,
        toast: `${p.display_name} arrived at ${s.name}`,
        event: { type: 'arrived', participant_id: p.id, stop_id: s.id },
      });
      const expected = located.filter((x) => !s.participants?.length || s.participants.includes(x.id));
      const everyone = expected.length > 1 && expected.every((x) => x.at_stop_id === s.id || x.completed_stop_ids.includes(s.id));
      if (everyone) {
        this.fire(view, {
          key: `all:${s.id}`,
          kind: 'arrival',
          toast: `Everyone's at ${s.name}`,
          event: { type: 'all_arrived', stop_id: s.id },
        });
      }
    }

    if (Date.now() < this.warmupUntil) return;

    for (const p of located) {
      const prev = this.prevStatus.get(p.id);
      this.prevStatus.set(p.id, p.status);
      if (p.status !== 'late' || p.drift_min == null) {
        this.veryLate.delete(p.id);
        continue;
      }
      const mins = Math.round(p.drift_min);
      const stopId = p.target_stop_id;
      if (prev !== 'late') {
        if (p.drift_min > config.veryLateThresholdMin) this.veryLate.add(p.id);
        this.fire(view, {
          key: `late:${p.id}:${stopId}`,
          kind: 'late',
          person: p,
          toast: `${p.display_name} is running ${mins} min late`,
          event: { type: 'late', participant_id: p.id, stop_id: stopId, drift_min: mins },
        });
      } else if (p.drift_min > config.veryLateThresholdMin && !this.veryLate.has(p.id)) {
        this.veryLate.add(p.id);
        this.fire(view, {
          key: `verylate:${p.id}:${stopId}`,
          kind: 'late',
          person: p,
          toast: `${p.display_name} is now ${mins} min behind`,
          event: { type: 'late', participant_id: p.id, stop_id: stopId, drift_min: mins },
        });
      }
    }

    // Plan shifts are about later stops; lateness to the active stop has its own alert.
    const shifted = [];
    for (const g of view.stop_states) {
      if (g.state !== 'upcoming' || g.projected_at == null) continue;
      const base = this.baselines.get(g.stop_id);
      if (base == null) {
        this.baselines.set(g.stop_id, g.projected_at);
        continue;
      }
      const delta = (g.projected_at - base) / 60_000;
      if (Math.abs(delta) > config.shiftAlertMin) shifted.push({ g, delta });
    }
    if (shifted.length) {
      for (const { g } of shifted) this.baselines.set(g.stop_id, g.projected_at);
      const { g, delta } = shifted[0];
      const s = stops.get(g.stop_id);
      const d = Math.round(delta);
      this.fire(view, {
        key: `shift:${g.stop_id}:${Math.round(g.projected_at / 60_000)}`,
        kind: 'shift',
        toast: `${s.name} now ~${fmtClock(g.projected_at)} (${d > 0 ? '+' : '−'}${Math.abs(d)} min)`,
        event: { type: 'shift', stop_id: g.stop_id, delta_min: d, projected_at: g.projected_at },
      });
    }
  }

  fire(view, alert) {
    if (alert.key === this.lastKey) return null;
    this.lastKey = alert.key;
    this.emitToast({
      id: crypto.randomUUID(),
      kind: alert.kind,
      text: alert.toast,
      color: alert.person?.color ?? null,
      initial: alert.person?.initial ?? null,
    });
    const state = {
      now: view.generated_at,
      event: alert.event,
      itinerary: view.itinerary.stops,
      people: view.people,
      stop_states: view.stop_states,
    };
    let message = null;
    this.chain = this.chain
      .then(() => this.muse.phraseGroupUpdate(state))
      .then((text) => {
        message = text;
        return this.discord.post(text);
      })
      .catch((err) => console.warn(`[alerts] ${err.message}`));
    return this.chain.then(() => message);
  }

  /** Tool: ping_late_attendee */
  async nudge(participantId, view) {
    const p = view.people.find((x) => x.id === participantId);
    if (!p) throw new HttpError(404, `unknown participant "${participantId}"`);
    const key = `nudge:${p.id}:${Math.floor(Date.now() / 60_000)}`;
    if (key === this.lastKey) return { posted: false, reason: 'duplicate nudge — already sent this minute' };
    const message = await this.fire(view, {
      key,
      kind: 'info',
      person: p,
      toast: `Nudged ${p.display_name}`,
      event: { type: 'nudge', participant_id: p.id, stop_id: p.target_stop_id, drift_min: p.drift_min == null ? null : Math.round(p.drift_min) },
    });
    return { posted: true, message };
  }
}
