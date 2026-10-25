import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnTracks } from '../owntracks.js';
import { Participants } from '../participants.js';
import { Engine } from '../engine.js';
import { LegCache } from '../legs.js';
import { destinationPoint } from '../geo.js';

const tick = () => new Promise((r) => setImmediate(r));

function makeParticipants() {
  const p = new Participants(null, null);
  p.list = [p.fill({ id: 'maya', display_name: 'Maya', match: ['maya', 'my'] }, 0)];
  return p;
}

test('normalizes an OwnTracks location payload', () => {
  const msg = { _type: 'location', lat: 30.25, lon: -97.75, tst: 1761400000, acc: 12, vel: 36, cog: 90, batt: 80, tid: 'MY' };
  const u = normalizeOwnTracks(msg, { user: 'orbit', device: 'maya' }, makeParticipants());
  assert.deepEqual(u, {
    source: 'owntracks',
    event_type: 'transit_location_update',
    participant_id: 'maya',
    display_name: 'Maya',
    location: { lat: 30.25, lng: -97.75, accuracy_m: 12, speed_mps: 10, heading_deg: 90 },
    battery_pct: 80,
    timestamp: new Date(1761400000 * 1000).toISOString(),
  });
});

test('ignores non-location messages and falls back to tid', () => {
  const people = makeParticipants();
  assert.equal(normalizeOwnTracks({ _type: 'transition', lat: 1, lon: 1 }, {}, people), null);
  const u = normalizeOwnTracks({ _type: 'location', lat: 1, lon: 1, tst: 1, tid: 'MY' }, {}, people);
  assert.equal(u.participant_id, 'maya');
});

function makeEngine(stops) {
  const calls = [];
  const computeRoute = async (origin, dest) => {
    calls.push({ origin, dest });
    return { duration_s: 600, distance_m: 4000, path: [origin, dest], legs: [], estimated: false };
  };
  const legRoute = async () => ({ duration_s: 300, distance_m: 2000, path: [], legs: [{ duration_s: 300, distance_m: 2000, path: [] }], estimated: false });
  const engine = new Engine({ participants: makeParticipants(), legs: new LegCache(legRoute), computeRoute, stops });
  return { engine, calls };
}

const stopA = { id: 'a', name: 'Tacos', lat: 30.25, lng: -97.75, planned_arrival: new Date(Date.now() + 3600e3).toISOString(), stay_min: 30 };
const stopB = { id: 'b', name: 'Movie', lat: 30.26, lng: -97.76, planned_arrival: new Date(Date.now() + 7200e3).toISOString(), stay_min: 90 };

function update(point, ts, acc = 10) {
  return {
    source: 'owntracks',
    event_type: 'transit_location_update',
    participant_id: 'maya',
    display_name: 'Maya',
    location: { lat: point.lat, lng: point.lng, accuracy_m: acc, speed_mps: 5, heading_deg: 0 },
    battery_pct: 90,
    timestamp: new Date(ts).toISOString(),
  };
}

test('drops poor accuracy and out-of-order updates', () => {
  const { engine } = makeEngine([stopA, stopB]);
  const far = destinationPoint(stopA, 180, 2000);
  assert.equal(engine.ingest(update(far, 1000, 150)).reason, 'accuracy');
  assert.equal(engine.ingest(update(far, 2000)).ok, true);
  assert.equal(engine.ingest(update(far, 1500)).reason, 'out_of_order');
  assert.equal(engine.ingest(update(far, 2000)).reason, 'out_of_order');
  engine.close();
});

test('geofence: arrive within 75 m, advance after leaving', async () => {
  const { engine, calls } = makeEngine([stopA, stopB]);
  const events = [];
  engine.on('stop_event', (e) => events.push(e.type + ':' + e.stop_id));

  engine.ingest(update(destinationPoint(stopA, 180, 2000), 1000));
  await tick();
  assert.equal(calls.length, 1, 'first fix triggers an immediate ETA');

  engine.ingest(update(destinationPoint(stopA, 180, 1500), 2000));
  await tick();
  assert.equal(calls.length, 1, 'rate limited to one call per 30 s');

  engine.ingest(update(destinationPoint(stopA, 180, 60), 3000));
  assert.deepEqual(events, ['arrived:a']);
  await tick();
  assert.equal(engine.view().people[0].status, 'arrived');

  engine.ingest(update(destinationPoint(stopA, 0, 80), 4000));
  assert.deepEqual(events, ['arrived:a'], 'inside the exit buffer still counts as here');

  engine.ingest(update(destinationPoint(stopA, 0, 200), 5000));
  assert.deepEqual(events, ['arrived:a', 'departed:a']);
  await tick();
  const p = engine.view().people[0];
  assert.equal(p.target_stop_id, 'b');
  assert.equal(calls.at(-1).dest.lat, stopB.lat, 'departure triggers an immediate ETA to the next stop');
  engine.close();
});
