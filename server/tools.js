// Tool-style functions with JSON Schemas, ready to be registered as Muse
// connectors. Exposed over HTTP at GET /api/tools and POST /api/tools/:name.
import { HttpError } from './itinerary.js';

const STOP_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Stable id; omit for a new stop' },
    name: { type: 'string' },
    address: { type: 'string' },
    lat: { type: 'number' },
    lng: { type: 'number' },
    planned_arrival: { type: 'string', format: 'date-time', description: 'Planned arrival, ISO-8601' },
    stay_min: { type: 'integer', minimum: 0, description: 'Planned stay length in minutes' },
    participants: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional: participant ids for a personal stop (e.g. one person grabbing food). Omit for everyone.',
    },
  },
  required: ['name', 'lat', 'lng', 'planned_arrival', 'stay_min'],
  additionalProperties: false,
};

function groupEta(view) {
  const stops = new Map(view.itinerary.stops.map((s) => [s.id, s]));
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  return {
    generated_at: iso(view.generated_at),
    people: view.people
      .filter((p) => p.location)
      .map((p) => ({
        participant_id: p.id,
        display_name: p.display_name,
        status: p.status,
        next_stop: stops.get(p.target_stop_id)?.name ?? null,
        eta_at: iso(p.eta?.arrive_at),
        eta_minutes: p.eta ? Math.max(0, Math.round((p.eta.arrive_at - view.generated_at) / 60_000)) : null,
        distance_remaining_m: p.eta?.distance_remaining_m ?? null,
        drift_min: p.drift_min,
        projected: view.itinerary.stops.map((s) => ({
          stop_id: s.id,
          stop_name: s.name,
          planned_arrival: s.planned_arrival,
          projected_arrival: iso(p.projections[s.id]?.arrive_at),
          drift_min: p.projections[s.id]?.drift_min ?? null,
          completed: p.completed_stop_ids.includes(s.id),
        })),
      })),
  };
}

export function createTools({ engine, alerts, setItinerary }) {
  const defs = [
    {
      name: 'update_group_eta',
      description:
        "Returns every participant's live ETA to their next stop, projected arrival and drift (minutes vs. plan) at each stop, and status (on_time, late, arrived, done).",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => groupEta(engine.view()),
    },
    {
      name: 'ping_late_attendee',
      description: 'Posts a friendly nudge to the group Discord for one participant who is running behind.',
      parameters: {
        type: 'object',
        properties: { participant_id: { type: 'string', description: 'Participant id, e.g. "dev"' } },
        required: ['participant_id'],
        additionalProperties: false,
      },
      handler: ({ participant_id }) => {
        if (!participant_id) throw new HttpError(400, 'participant_id is required');
        return alerts.nudge(String(participant_id), engine.view());
      },
    },
    {
      name: 'get_itinerary',
      description: 'Returns the ordered list of stops with planned arrival times and stay lengths.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => engine.itinerary,
    },
    {
      name: 'update_itinerary',
      description: 'Replaces the itinerary with the given ordered stops. ETAs and projections recalculate immediately.',
      parameters: {
        type: 'object',
        properties: { stops: { type: 'array', items: STOP_SCHEMA } },
        required: ['stops'],
        additionalProperties: false,
      },
      handler: ({ stops }) => setItinerary(stops),
    },
  ];

  return {
    schemas: () => defs.map(({ handler, ...schema }) => schema),
    async call(name, args = {}) {
      const def = defs.find((d) => d.name === name);
      if (!def) throw new HttpError(404, `unknown tool "${name}"`);
      return def.handler(args);
    },
  };
}
