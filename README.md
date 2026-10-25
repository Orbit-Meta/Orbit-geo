# Meta Orbit · Transit Sync & ETA

Part of **Meta Orbit**, an AI social copilot that gets friends from the screen to
meeting up in person. Friends share live location from their phones with OwnTracks.
The dashboard shows everyone moving on a 3D map toward a multi-stop plan
(tacos → movie → dessert). For every stop it shows live arrival times, how far
ahead of or behind plan the group is, and it posts AI-written updates to Discord.

- **Live markers:** avatars glide between GPS fixes, with fading trails and glowing routes.
- **Multi-stop ETAs:** traffic-aware Google Routes ETAs, projected arrival and drift at every stop.
- **Server-side geofencing:** arrival within 75 m; the next stop becomes the target once you leave.
- **AI layer:** Muse Spark phrases group updates (stubbed) and posts them to Discord. Tool-style functions with JSON schemas are included.
- **Demo safety:** every live session is recorded. You can replay it at 1×/4×/10×, or simulate friends driving real routes.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the file structure and data
flow, and [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md) for the end-to-end test.

---

## Quick start

```bash
npm install
cp .env.example .env        # fill in the keys (see below)
npm run demo                # builds the dashboard and serves it on http://localhost:3000
```

For development with hot reload, run `npm run dev` and open http://localhost:5173.
Vite proxies `/api`, `/owntracks` and `/socket.io` to the server on :3000.

No phones handy? Open the dev bar (press <kbd>`</kbd>), choose **Simulate** and
press **Start**.

Requires Node.js 20+.

## 1. Google Cloud setup

1. Create or select a project at <https://console.cloud.google.com> and enable billing.
2. **APIs & Services → Library**, then enable:
   - **Maps JavaScript API**
   - **Routes API**
   - **Places API (New)**. The search box uses the new `PlaceAutocompleteElement`.
3. **APIs & Services → Credentials → Create credentials → API key.**
   - Browser key (`GOOGLE_MAPS_API_KEY`): restrict to *Maps JavaScript API* and
     *Places API (New)*. Add HTTP referrers for `http://localhost:*/*` and your
     tunnel domain, for example `https://*.trycloudflare.com/*` or `https://*.ngrok-free.app/*`.
   - Server key (`GOOGLE_SERVER_API_KEY`, optional): restrict to the *Routes API*.
     Referrer restrictions block server-side calls, so use a separate key or
     leave this empty and give the browser key no application restriction.
4. **Create a vector Map ID:** go to **Google Maps Platform → Map Management →
   Create Map ID**.
   - Map type: **JavaScript**
   - Rendering: **Vector**
   - Tick **Tilt** and **Rotation**
   - Save, then copy the Map ID into `GOOGLE_MAP_ID`.
   - Optional: in **Map Styles**, create a style with light and dark variants
     and attach it to the Map ID. The dashboard's light/dark toggle switches
     between them.

Without a server key, ETAs fall back to straight-line estimates. The dev bar
then shows "Routes API 0 (est.)".

## 2. Configure `.env`

| Variable | Purpose |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Browser key (map, markers, Places search) |
| `GOOGLE_MAP_ID` | Vector Map ID with tilt + rotation |
| `GOOGLE_SERVER_API_KEY` | Optional Routes API key for the server (defaults to the browser key) |
| `TRAVEL_MODE` | `DRIVE` (default), `TWO_WHEELER`, `BICYCLE`, `WALK`, `TRANSIT` |
| `DISCORD_WEBHOOK_URL` | Channel → Edit → Integrations → Webhooks → New → Copy URL |
| `MUSE_API_KEY`, `MUSE_API_URL` | Muse Spark. If empty, the built-in message templates are used |
| `OWNTRACKS_USER`, `OWNTRACKS_PASS` | Basic-auth login that every phone uses |
| `DASHBOARD_PASS` | Optional basic auth (user `orbit`) on the dashboard and API |
| `UNITS` | `imperial` (default) or `metric` |

Participants live in `data/participants.json`. Copy
`data/participants.example.json` to start. Each entry has an `id`,
`display_name`, `color`, `initial` and `match` aliases. A phone is matched by
`user/device`, then device ID, then tracker ID (`tid`), then user. Unknown
phones are added automatically with a generated color.

## 3. Start the tunnel

Phones on cellular data need an HTTPS URL that reaches your laptop. Run
`npm run demo`, then in a second terminal start one of these:

```bash
# Cloudflare Tunnel (no account needed for a quick tunnel)
cloudflared tunnel --url http://localhost:3000

# or ngrok
ngrok http 3000
```

Copy the `https://…` URL it prints. Your OwnTracks endpoint is
`https://<tunnel-host>/owntracks`.

The tunnel makes the whole dashboard public. Set `DASHBOARD_PASS` to put basic
auth on everything except `/owntracks`, which has its own credentials.

## 4. Configure OwnTracks (each phone)

Install **OwnTracks** from the App Store or Google Play.

**iOS:** tap **(i)** at the top left, then **Settings**.

1. **Mode:** `HTTP`
2. **URL:** `https://<tunnel-host>/owntracks`
3. **Authentication:** on
   - **UserID:** the `OWNTRACKS_USER` value
   - **Password:** the `OWNTRACKS_PASS` value
4. **DeviceID:** the person's id from `participants.json`, e.g. `maya`. It is
   sent as `X-Limit-D` and is how the server tells phones apart.
5. **TrackerID:** two letters, e.g. `MY`. Used as a fallback match.
6. On the map screen, tap the monitoring button at the top until it reads
   **Move**. Move mode sends frequent updates while you travel. The default
   *Significant changes* mode is too sparse for a live demo.
7. Optional, for smoother demos: lower **locatorInterval** (~10–15 s) and
   **locatorDisplacement** (~25 m) in Settings.
8. Tap the **publish** (↑) button once to send a test location.

**Android:** open **Preferences → Connection**.

1. **Mode:** `HTTP`
2. **Host:** `https://<tunnel-host>/owntracks`
3. **Identification:**
   - **Username:** the `OWNTRACKS_USER` value
   - **Password:** the `OWNTRACKS_PASS` value
   - **Device ID:** e.g. `maya`
   - **Tracker ID:** e.g. `MY`
4. Choose **Move** monitoring from the map toolbar.

Updates with accuracy worse than 100 m are dropped, and so are out-of-order
timestamps. The server always replies `[]`.

## Using the dashboard

- **Timeline tab:**
  - Search for a place to add a stop.
  - Drag the ⋮⋮ handle to reorder stops.
  - Click a planned time or a stay length to edit it.
  - Click × to delete a stop.
  - Any change recalculates everything immediately.
- **People tab:** one card per person with ETA countdown, distance, speed,
  battery, and "last update". The card turns gray when a phone goes stale
  (over 2 minutes). Click a card to follow that person.
- **Camera:**
  - **Overview** fits everyone and all stops.
  - Click an avatar, in the bottom-right bar or on the map, to **follow** that
    person. The camera turns with their heading.
  - Dragging the map switches to free look.
- **Theme:** the sun/moon button switches between light and dark. The map
  rebuilds in the matching color scheme and keeps its camera position.
- **Dev bar** (<kbd>`</kbd> to show or hide):
  - **Live** shows the recording status. **Rebase plan** shifts every planned
    time so stop 1 is 20 minutes from now.
  - **Replay** plays a recorded session at 1×/4×/10×. You can also open
    `/replay?file=session-….json&speed=4`.
  - **Simulate** starts fake friends driving real Google routes between the
    stops, at 1×/4×/10×/30×. **+5m** delays one person.

Replay and simulate feed the same `engine.ingest` pipeline as live mode, so
geofencing, ETAs, toasts and Discord posts all behave the same way.

## Demo scenarios and recorded videos

Scenarios in `data/scenarios/*.json` describe a fixed set of people, with start
points, departure times and stops. Planned times are given relative to "now". A
stop with `"participants": ["seth"]` is a **personal stop**: only Seth's route,
ETA and drift include it. The included `ut-austin` scenario sends Olu, Seth and
Angel to UT Austin, with Seth stopping at Chipotle on the way.

Run one from the dev bar: **Simulate**, pick the scenario, then **Start**.

Record a 1080p time-lapse video of it. Edge opens and records the real
dashboard, and the video is saved to `videos/`:

```bash
npm run demo                       # in one terminal
npm run record -- ut-austin        # in another: --speed 30 --theme dark --follow seth:chipotle
```

The first time, run `npx playwright-core install ffmpeg`. It downloads the
small video encoder (about 1.3 MB) that Playwright uses.

## AI layer: Muse + tools

`server/museAdapter.js` exports `phraseGroupUpdate(state)`. It sends compact,
pre-computed state to Muse Spark and returns a short group message. The HTTP
call is marked `TODO(muse)`; fill in the real endpoint, auth and response
parsing there. Until then, or if the call fails, a deterministic template writes
the message.

Tool-style functions with JSON schemas are in `server/tools.js`:

```bash
curl localhost:3000/api/tools                                   # schemas
curl -XPOST localhost:3000/api/tools/update_group_eta
curl -XPOST localhost:3000/api/tools/ping_late_attendee -H 'content-type: application/json' -d '{"participant_id":"dev"}'
curl -XPOST localhost:3000/api/tools/get_itinerary
curl -XPOST localhost:3000/api/tools/update_itinerary -H 'content-type: application/json' -d '{"stops":[…]}'
```

Discord gets a post when:

- someone arrives
- everyone is at a stop
- someone falls more than 5 minutes late, or more than 15
- the group's projected time at a stop shifts by more than 5 minutes

The same alert is never posted twice in a row.

## Faking a phone with curl

```bash
curl -u orbit:change-me -H 'X-Limit-U: orbit' -H 'X-Limit-D: maya' \
  -H 'content-type: application/json' \
  -d "{\"_type\":\"location\",\"lat\":30.2455,\"lon\":-97.7508,\"tst\":$(date +%s),\"acc\":10,\"vel\":0,\"batt\":80,\"tid\":\"MY\"}" \
  http://localhost:3000/owntracks
```

## Tests

```bash
npm test
```

The unit tests cover OwnTracks normalization, the accuracy and ordering filters,
the 75 m geofence (arrive, exit buffer, advance), the Routes rate limit, and the
projection, drift and status math.
