import fs from 'node:fs';

const PALETTE = ['#FF5A5F', '#5B8CFF', '#22C55E', '#F59E0B', '#A855F7', '#14B8A6', '#EC4899', '#F97316'];

const titleCase = (s) => String(s).replace(/(^|[\s_-])(\w)/g, (_, sep, c) => sep + c.toUpperCase());

/**
 * Display config for each person: name, color and avatar initial.
 * Phones are matched by "user/device", device id, tracker id (tid), then user
 * (in that order — everyone usually shares one basic-auth user).
 */
export class Participants {
  constructor(file, fallbackFile) {
    this.list = [];
    for (const f of [file, fallbackFile]) {
      if (!f || !fs.existsSync(f)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        this.list = (raw.participants || []).map((p, i) => this.fill(p, i));
        break;
      } catch (err) {
        console.warn(`[participants] could not read ${f}: ${err.message}`);
      }
    }
  }

  fill(p, i) {
    const id = String(p.id).toLowerCase();
    const name = p.display_name || titleCase(id);
    return {
      id,
      display_name: name,
      color: p.color || PALETTE[i % PALETTE.length],
      initial: (p.initial || name.slice(0, 1)).toUpperCase().slice(0, 2),
      match: (p.match || []).map((m) => String(m).toLowerCase()),
    };
  }

  resolve({ user, device, tid }) {
    const candidates = [user && device ? `${user}/${device}` : null, device, tid, user]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase().trim());
    for (const c of candidates) {
      const hit = this.list.find((p) => p.id === c || p.match.includes(c));
      if (hit) return hit;
    }
    const raw = device || tid || user;
    if (!raw) return null;
    const id = String(raw).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    return id ? this.adopt(id, titleCase(raw)) : null;
  }

  /** Registers an unknown participant on the fly (e.g. from a recording). */
  adopt(id, displayName) {
    const existing = this.get(id);
    if (existing) return existing;
    const created = this.fill({ id, display_name: displayName }, this.list.length);
    this.list.push(created);
    return created;
  }

  /** Adds or replaces a participant's display config (used by scenarios). */
  upsert(p) {
    const i = this.list.findIndex((x) => x.id === String(p.id).toLowerCase());
    const filled = this.fill(p, i >= 0 ? i : this.list.length);
    if (i >= 0) this.list[i] = filled;
    else this.list.push(filled);
    return filled;
  }

  get(id) {
    return this.list.find((p) => p.id === id) ?? null;
  }

  all() {
    return this.list;
  }
}
