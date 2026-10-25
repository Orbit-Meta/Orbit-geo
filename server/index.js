import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import { clock } from './clock.js';
import { Participants } from './participants.js';
import { owntracksRouter, basicAuth } from './owntracks.js';
import { HttpError, loadItinerary, saveItinerary, rebaseStops } from './itinerary.js';
import { computeRoute, routeStats } from './routes.js';
import { LegCache } from './legs.js';
import { Engine } from './engine.js';
import { Alerts } from './alerts.js';
import { Discord } from './discord.js';
import * as muse from './museAdapter.js';
import { createTools } from './tools.js';
import { Recorder } from './recorder.js';
import { Simulator } from './simulator.js';
import { ModeManager } from './modes.js';

// ---------------------------------------------------------------------------
// Wiring: OwnTracks / replay / simulator → Engine → Alerts → Socket.IO + Discord
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const participants = new Participants(config.paths.participants, config.paths.participantsExample);
const legs = new LegCache(computeRoute);
const engine = new Engine({
  participants,
  legs,
  computeRoute,
  stops: loadItinerary(config.paths.itinerary),
  persist: (stops) => saveItinerary(config.paths.itinerary, stops),
});
const discord = new Discord(config.discordWebhook);
const alerts = new Alerts({ discord, muse, emitToast: (t) => io.emit('toast', t) });
const recorder = new Recorder(config.paths.recordings);
const simulator = new Simulator({ engine, participants, computeRoute, onUpdate: (u) => engine.ingest(u) });
const modes = new ModeManager({ engine, recorder, simulator, alerts });

const setItinerary = (stops) => engine.setItinerary(stops, { persist: modes.mode !== 'replay' });
const tools = createTools({ engine, alerts, setItinerary });

function snapshot() {
  return {
    ...engine.view(),
    mode: modes.info(),
    clock: clock.snapshot(),
    routes: routeStats(),
    settings: {
      units: config.units,
      stale_after_s: config.staleAfterS,
      late_min: config.lateThresholdMin,
      very_late_min: config.veryLateThresholdMin,
      geofence_m: config.geofenceRadiusM,
    },
  };
}

let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    io.emit('state', snapshot());
  }, 200);
}

engine.on('stop_event', (ev) => alerts.queue(ev));
engine.on('update', (view) => {
  alerts.evaluate(view);
  scheduleBroadcast();
});
engine.on('itinerary', (itin) => {
  alerts.resetBaselines();
  if (modes.mode === 'live') recorder.recordItinerary(itin.stops);
});
modes.on('change', scheduleBroadcast);
io.on('connection', (socket) => socket.emit('state', snapshot()));

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
app.set('trust proxy', true);
app.use('/owntracks', owntracksRouter({ participants, onUpdate: (u) => modes.ingestLive(u) }));
if (config.dashboardPass) app.use(basicAuth('orbit', config.dashboardPass, 'Orbit dashboard'));
app.use(express.json({ limit: '1mb' }));

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => out !== undefined && res.json(out), next);

app.get('/api/config', route(() => ({ mapsKey: config.mapsKey, mapId: config.mapId, travelMode: config.travelMode, units: config.units })));
app.get('/api/state', route(() => snapshot()));

app.get('/api/itinerary', route(() => engine.itinerary));
app.put('/api/itinerary', route((req) => setItinerary(req.body?.stops)));
app.post(
  '/api/itinerary/rebase',
  route((req) => {
    const step = 5 * 60_000;
    const firstAt = Math.ceil((clock.now() + (Number(req.body?.first_in_min) || 20) * 60_000) / step) * step;
    return setItinerary(rebaseStops(engine.itinerary.stops, firstAt));
  }),
);

app.get('/api/recordings', route(() => recorder.list()));
app.post(
  '/api/mode',
  route(async (req) => {
    await modes.setMode(req.body?.mode, req.body ?? {});
    return modes.info();
  }),
);
app.post(
  '/api/mode/speed',
  route((req) => {
    modes.setSpeed(req.body?.speed);
    return modes.info();
  }),
);
app.post(
  '/api/sim/delay',
  route((req) => {
    if (modes.mode !== 'simulate') throw new HttpError(400, 'not in simulate mode');
    return simulator.delay(req.body?.participant_id, req.body?.minutes ?? 5);
  }),
);

app.get('/api/tools', route(() => tools.schemas()));
app.post('/api/tools/:name', route((req) => tools.call(req.params.name, req.body ?? {})));

if (fs.existsSync(path.join(config.paths.web, 'index.html'))) {
  app.use(express.static(config.paths.web, { index: false }));
  app.get(/^\/(?!api\/|owntracks|socket\.io).*/, (req, res) => res.sendFile(path.join(config.paths.web, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res.type('text').send('Dashboard not built. Run `npm run build` (or `npm run dev` and open http://localhost:5173).'),
  );
}

app.use((req, res) => res.status(404).json({ error: 'not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

server.listen(config.port, () => {
  const warn = (ok, msg) => !ok && console.warn(`  ! ${msg}`);
  console.log(`\nMeta Orbit · Transit Sync  →  http://localhost:${config.port}`);
  console.log(`  OwnTracks endpoint:        POST /owntracks (basic auth)`);
  warn(config.mapsKey, 'GOOGLE_MAPS_API_KEY missing — the map will not load');
  warn(config.mapId, 'GOOGLE_MAP_ID missing — using DEMO_MAP_ID (no custom vector styling)');
  warn(config.serverKey, 'no Routes API key — ETAs use straight-line estimates');
  warn(config.discordWebhook, 'DISCORD_WEBHOOK_URL missing — Discord messages are logged here instead');
  warn(config.owntracksUser && config.owntracksPass, 'OWNTRACKS_USER / OWNTRACKS_PASS missing — /owntracks is disabled');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    recorder.stop();
    process.exit(0);
  });
}
