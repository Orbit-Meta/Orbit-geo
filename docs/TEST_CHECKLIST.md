# End-to-end test checklist

Run through this before recording the demo. It follows one location update all
the way from a phone to a Discord message.

## 0. Setup

- [ ] `npm test` passes.
- [ ] `npm run demo` starts. The startup log shows no `!` warnings you didn't expect.
- [ ] The tunnel is running and `https://<tunnel>/` loads the dashboard.
- [ ] On load, the camera flies in from a continental view to the tilted itinerary.
- [ ] The light/dark toggle switches the panel and the map style.

## 1. Phone posts

- [ ] OwnTracks is in HTTP mode, with the tunnel URL, auth, DeviceID, and **Move** monitoring.
- [ ] Tap **publish**. The server answers `200 []`. The OwnTracks status shows no error.
- [ ] A wrong password returns `401`, and OwnTracks shows an auth error.
- [ ] Dev bar → **Live** shows `● REC 1 updates`. A new file appears in `recordings/`.

## 2. Marker moves

- [ ] The avatar appears in the person's color and initial, with a pulsing ring.
- [ ] Walk or drive. The marker glides between updates without jumping. A fading trail follows it.
- [ ] A route to the next stop is drawn in the person's color, with dots flowing along it.
- [ ] People tab: speed and battery update, and "last update" counts up.
- [ ] Turn off the phone's data for over 2 minutes. The card and the marker turn gray.
- [ ] Click the avatar to enter follow mode. The camera tracks and turns smoothly. **Overview** animates back.

## 3. Arrival triggers

- [ ] Get within 75 m of the active stop. Within one update:
  - [ ] a toast appears: "Maya arrived at Torchy's"
  - [ ] the card shows "At Torchy's" and the route line disappears
  - [ ] the timeline chip shows "Here"
- [ ] Walk out past about 85 m. The target advances to the next stop, and a new route appears right away.
- [ ] Once everyone has left a stop, its pin and timeline node show a check, and the next pin starts bouncing.

## 4. Timeline times shift

- [ ] Each stop shows its planned time, live projected time, and drift badge.
- [ ] Drag a stop to a new position. Rows animate, and ETAs and projections recalculate within about 1 s.
- [ ] Edit a planned time. The drift badge changes color: green ≤ 5 min, amber ≤ 15, red beyond.
- [ ] When a projected time changes, the digits roll and briefly highlight.
- [ ] Add a stop via Places search, then delete it.
- [ ] Simulate → **+5m** on one person. Their ETA slides later and the badge turns amber.
  A toast appears: "Dev is running 6 min late".

## 5. Discord alert appears

- [ ] An arrival posts to Discord, written by Muse or by the template.
- [ ] Falling late posts once. It doesn't repeat while the person stays late.
- [ ] A plan shift of more than 5 minutes posts "Heads up: Movie now looks like ~8:05 PM (+6 min)".
- [ ] `POST /api/tools/ping_late_attendee {"participant_id":"dev"}` posts a nudge.

## 6. Demo safety

- [ ] Dev bar → **Replay** → pick the session → **Play** at 4×. Markers, toasts and Discord posts match the live run.
- [ ] Switch to 10× mid-replay. The playback speeds up and nothing jumps.
- [ ] **Simulate** at 10×. Three friends drive real routes, arrive, dwell and continue.
- [ ] **Go live** restores the live itinerary.
- [ ] Press <kbd>`</kbd> to hide the dev bar before recording.
- [ ] With *Reduce motion* turned on in the OS, the decorative animations stop. Markers still move and the camera cuts instead of flying.
