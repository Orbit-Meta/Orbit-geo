# Architecture

## File structure

```
.
├── server/                     Node.js + Express + Socket.IO (ES modules)
│   ├── index.js                wiring + HTTP routes + Socket.IO broadcast
│   ├── config.js               .env → config, thresholds, paths
│   ├── clock.js                virtual clock (live = wall time; replay/sim run faster)
│   ├── owntracks.js            POST /owntracks: basic auth, parse, normalize
│   ├── participants.js         phone → display name / color / initial
│   ├── engine.js               THE pipeline: filter → state → geofence → ETA → projections
│   ├── schedule.js             pure schedule math (projections, drift, status)
│   ├── routes.js               Google Routes API client (+ straight-line fallback)
│   ├── legs.js                 cached stop-to-stop travel times
│   ├── itinerary.js            stop validation, persistence, sample stops, rebase
│   ├── alerts.js               arrival / late / shift detection → toasts + Discord
│   ├── museAdapter.js          phraseGroupUpdate(state) → Muse Spark (stubbed) or template
│   ├── discord.js              webhook poster (serialized, deduped, 429-aware)
│   ├── tools.js                update_group_eta, ping_late_attendee, get/update_itinerary
│   ├── recorder.js             records live sessions to recordings/*.json
│   ├── simulator.js            fake participants driving real routes
│   ├── modes.js                live / replay / simulate switching
│   └── test/                   node:test unit tests
├── web/                        React (Vite) single-page dashboard
│   ├── index.html
│   └── src/
│       ├── App.jsx             layout, theme, camera state, /replay route
│       ├── styles.css          tokens (light/dark), glass UI, marker CSS, reduced motion
│       ├── lib/                socket hook, Maps loader, formatting, easing
│       ├── map/MapScene.js     imperative map: camera, avatars, trails, routes, stops
│       ├── map/MapView.jsx     React wrapper (rebuilds on theme change, keeps camera)
│       └── ui/                 Panel, Timeline, People, RollingText, Toasts, DevBar …
├── data/participants.example.json
└── recordings/                 session-*.json (git-ignored)
```

## Data flow

```
 Phone (OwnTracks, HTTP mode)
   │  POST /owntracks  {_type:"location", lat, lon, tst, acc, vel, cog, batt, tid}
   ▼
 owntracks.js ── basic auth ── normalize ──► transit_location_update
   │                                          (participant from X-Limit-U/D, tid)
   ▼
 modes.ingestLive ──► recorder (live only) ──► recordings/session-*.json
   │                                                │
   │        replay: entries fed back on clock ◄─────┘
   │        simulate: simulator emits updates ──┐
   ▼                                            ▼
 engine.ingest(update)   ◄── one pipeline for live, replay and simulate
   1. drop accuracy > 100 m, drop ts ≤ last ts
   2. update position, trail
   3. geofence (75 m): arrive → at_stop; leave → completed, next target
   4. requestEta: Routes API ≤ 1 call / person / 30 s, immediate on
      arrival/departure/itinerary change            (routes.js)
   5. touch() → computeView():
        schedule.projectPerson  next stop = live ETA
                                later stops = prev + stay + cached leg (legs.js)
                                drift = projected − planned
        schedule.personStatus   on_time | late (> 5 min) | arrived | done
        schedule.groupStopView  group ETA per stop, completed/active/upcoming
   ▼
 'update' (view)
   ├─► alerts.evaluate(view)
   │     arrival · fell late · very late · plan shifted > 5 min
   │     (never the same alert twice in a row)
   │       ├─► io.emit('toast')                    → dashboard toast
   │       └─► museAdapter.phraseGroupUpdate(state) → discord.post(text)
   └─► io.emit('state', snapshot)   (≤ 5 per second)
          ▼
 Browser: useOrbit() → React panel + MapScene.update(snapshot)
          MapScene rAF loop: glide avatars over the update interval, trim
          and animate routes, fade trails, drive the camera.
```

All time math is plain JavaScript in `schedule.js` / `engine.js`. Muse only
writes the sentence. It gets the finished numbers and never calculates them.

## Key decisions

- **Virtual clock.** Replay and simulate move `clock.now()` faster than wall
  time, so the same ETA, drift and staleness code runs unchanged at 1×, 4× or 10×.
- **Geofence exit buffer.** Arrival is at ≤ 75 m. Leaving needs > 75 m + 10 m
  (`GEOFENCE_EXIT_BUFFER_M`), so GPS jitter at the edge can't advance someone
  early. Set it to 0 for the strict 75 m rule.
- **Routes budget.** At most one Routes call per person per 30 s of virtual time,
  and never more often than every 5 s of wall time, even at 30× simulation.
- **Map rendering.** Map objects are driven imperatively from one
  `requestAnimationFrame` loop. React only renders the panel.
