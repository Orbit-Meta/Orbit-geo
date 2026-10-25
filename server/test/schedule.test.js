import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPerson, personStatus, groupStopView } from '../schedule.js';

const T0 = Date.parse('2026-10-25T19:00:00Z');
const min = (m) => m * 60_000;
const stops = [
  { id: 'a', planned_arrival: new Date(T0 + min(10)).toISOString(), stay_min: 30 },
  { id: 'b', planned_arrival: new Date(T0 + min(50)).toISOString(), stay_min: 60 },
  { id: 'c', planned_arrival: new Date(T0 + min(120)).toISOString(), stay_min: 20 },
];
const legSeconds = () => 5 * 60; // 5 min between every pair

test('projects later stops as ETA + stay + leg time', () => {
  const eta = { stop_id: 'a', computed_at: T0, duration_s: 16 * 60 };
  const p = projectPerson({ stops, completed: new Set(), arrivals: {}, atStopId: null, eta, now: T0, legSeconds });
  assert.equal(p.a.arrive_at, T0 + min(16));
  assert.equal(p.a.drift_min, 6);
  assert.equal(p.b.arrive_at, T0 + min(16 + 30 + 5));
  assert.equal(p.b.drift_min, 1);
  assert.equal(p.c.arrive_at, T0 + min(51 + 60 + 5));
  assert.equal(p.c.drift_min, -4);
});

test('an ETA in the past is clamped to now', () => {
  const eta = { stop_id: 'a', computed_at: T0, duration_s: 60 };
  const p = projectPerson({ stops, completed: new Set(), arrivals: {}, atStopId: null, eta, now: T0 + min(20), legSeconds });
  assert.equal(p.a.arrive_at, T0 + min(20));
});

test('at a stop: departure is max(arrival + stay, now)', () => {
  const arrivals = { a: T0 + min(8) };
  const early = projectPerson({ stops, completed: new Set(), arrivals, atStopId: 'a', eta: null, now: T0 + min(9), legSeconds });
  assert.equal(early.a.kind, 'at_stop');
  assert.equal(early.b.arrive_at, T0 + min(8 + 30 + 5));
  const lingering = projectPerson({ stops, completed: new Set(), arrivals, atStopId: 'a', eta: null, now: T0 + min(60), legSeconds });
  assert.equal(lingering.b.arrive_at, T0 + min(60 + 5));
});

test('completed stops keep their actual arrival', () => {
  const p = projectPerson({
    stops,
    completed: new Set(['a']),
    arrivals: { a: T0 + min(12) },
    atStopId: null,
    eta: { stop_id: 'b', computed_at: T0 + min(45), duration_s: 300 },
    now: T0 + min(45),
    legSeconds,
  });
  assert.equal(p.a.kind, 'completed');
  assert.equal(p.a.drift_min, 2);
  assert.equal(p.b.arrive_at, T0 + min(50));
});

test('status: on_time, late (> 5 min), arrived, done', () => {
  const base = { stops, completed: new Set(), atStopId: null, lateMin: 5 };
  assert.equal(personStatus({ ...base, projections: { a: { drift_min: 5 } } }).status, 'on_time');
  assert.equal(personStatus({ ...base, projections: { a: { drift_min: 5.5 } } }).status, 'late');
  assert.equal(personStatus({ ...base, atStopId: 'a', projections: {} }).status, 'arrived');
  assert.equal(personStatus({ ...base, completed: new Set(['a', 'b', 'c']), projections: {} }).status, 'done');
});

test('group view uses the latest person and marks the active stop', () => {
  const people = [
    { id: 'maya', completed: new Set(['a']), at_stop_id: null, projections: { a: { arrive_at: T0 }, b: { arrive_at: T0 + min(50) } } },
    { id: 'dev', completed: new Set(), at_stop_id: 'a', projections: { a: { arrive_at: T0 + min(11) }, b: { arrive_at: T0 + min(58) } } },
  ];
  const g = groupStopView(stops, people);
  assert.equal(g[0].state, 'active');
  assert.equal(g[0].projected_at, T0 + min(11));
  assert.equal(g[1].drift_min, 8);
  assert.equal(g[1].state, 'upcoming');
  assert.deepEqual(g[0].here, ['dev']);
  assert.equal(g[0].arrived_count, 2);
});
