// Muse Spark adapter: turns already-computed group state into one short,
// friendly chat message. Muse only phrases — every number it sees was computed
// deterministically in schedule.js / engine.js.
import { config } from './config.js';
import { fmtClock, listNames } from './format.js';

export const MUSE_SYSTEM_PROMPT = `You are Orbit, the friendly copilot in a friend group's chat, helping everyone meet up IRL.
Write ONE short message (max 2 sentences, under 200 characters) about the event below.
Use only the names, places and times provided — never invent or recompute times.
Warm and casual, at most one emoji, no hashtags, no @mentions.`;

/** Small, model-friendly view of the state (times pre-formatted). */
export function compactState(state) {
  const now = state.now ?? Date.now();
  const stops = new Map(state.itinerary.map((s) => [s.id, s]));
  const groups = new Map((state.stop_states || []).map((g) => [g.stop_id, g]));
  return {
    event: state.event ?? null,
    itinerary: state.itinerary.map((s) => {
      const g = groups.get(s.id);
      return {
        name: s.name,
        planned: fmtClock(Date.parse(s.planned_arrival)),
        projected: g?.projected_at ? fmtClock(g.projected_at) : null,
        drift_min: g?.drift_min == null ? null : Math.round(g.drift_min),
        status: g?.state ?? 'upcoming',
      };
    }),
    people: state.people
      .filter((p) => p.location)
      .map((p) => ({
        name: p.display_name,
        status: p.status,
        at_stop: stops.get(p.at_stop_id)?.name ?? null,
        next_stop: stops.get(p.target_stop_id)?.name ?? null,
        eta: p.eta ? fmtClock(p.eta.arrive_at) : null,
        minutes_away: p.eta ? Math.max(0, Math.round((p.eta.arrive_at - now) / 60_000)) : null,
        drift_min: p.drift_min == null ? null : Math.round(p.drift_min),
      })),
  };
}

/** Deterministic fallback used when Muse is not configured or fails. */
export function templateMessage(state) {
  const ev = state.event ?? {};
  const now = state.now ?? Date.now();
  const person = state.people.find((p) => p.id === ev.participant_id);
  const stop = state.itinerary.find((s) => s.id === ev.stop_id);
  const name = person?.display_name ?? 'Someone';
  const stopName = stop?.name ?? 'the next stop';
  const located = state.people.filter((p) => p.location && p.id !== ev.participant_id);
  const here = located.filter((p) => p.at_stop_id === ev.stop_id).map((p) => p.display_name);
  const enRoute = located
    .filter((p) => p.target_stop_id === ev.stop_id && p.at_stop_id !== ev.stop_id && p.eta)
    .map((p) => `${p.display_name} ~${Math.max(1, Math.round((p.eta.arrive_at - now) / 60_000))} min out`);
  const eta = person?.eta ? fmtClock(person.eta.arrive_at) : null;
  const drift = ev.drift_min ?? (person?.drift_min == null ? null : Math.round(person.drift_min));

  switch (ev.type) {
    case 'arrived':
      return `📍 ${name} made it to ${stopName}.${enRoute.length ? ` ${listNames(enRoute)}.` : ''}`;
    case 'all_arrived':
      return `🎉 Everyone's at ${stopName}. Enjoy!`;
    case 'late': {
      const tail = here.length ? ` ${listNames(here)} ${here.length > 1 ? 'are' : 'is'} already there. Grab a table!` : '';
      return `⏳ ${name}'s ~${drift} min behind for ${stopName}${eta ? ` (ETA ${eta})` : ''}.${tail}`;
    }
    case 'shift': {
      const sign = ev.delta_min > 0 ? '+' : '−';
      return `🗓️ Heads up: ${stopName} now looks like ~${fmtClock(ev.projected_at)} (${sign}${Math.abs(ev.delta_min)} min).`;
    }
    case 'nudge':
      return drift != null && drift > 0
        ? `👋 Hey ${name}, you're ~${drift} min behind for ${stopName}${eta ? ` (ETA ${eta})` : ''}. No stress, just keep us posted!`
        : `👋 Hey ${name}, the crew's checking in on you for ${stopName}${eta ? ` (ETA ${eta})` : ''}.`;
    default: {
      const c = compactState(state);
      return c.people.map((p) => `${p.name}: ${p.at_stop ? `at ${p.at_stop}` : p.eta ? `ETA ${p.eta}` : p.status}`).join(' · ');
    }
  }
}

/**
 * Sends the itinerary + people state to Muse Spark and returns a short group
 * message. Falls back to `templateMessage` when Muse is not configured.
 */
export async function phraseGroupUpdate(state) {
  const fallback = templateMessage(state);
  if (!config.museKey || !config.museUrl) return fallback;

  try {
    // ---------------------------------------------------------------------
    // TODO(muse): STUB — replace with the real Muse Spark endpoint, auth
    // scheme and request/response shape. Everything else can stay the same.
    // ---------------------------------------------------------------------
    const res = await fetch(config.museUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.museKey}` },
      body: JSON.stringify({
        model: 'muse-spark',
        system: MUSE_SYSTEM_PROMPT,
        input: compactState(state),
        max_output_tokens: 120,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Muse ${res.status}`);
    const json = await res.json();
    const text = json.text ?? json.output_text ?? json.message ?? json.choices?.[0]?.message?.content;
    const clean = typeof text === 'string' ? text.trim().replace(/@(everyone|here)/g, '$1').slice(0, 400) : '';
    return clean || fallback;
  } catch (err) {
    console.warn(`[muse] ${err.message} — using template`);
    return fallback;
  }
}
