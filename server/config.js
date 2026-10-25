import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

export const config = {
  port: num(process.env.PORT, 3000),

  mapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
  serverKey: process.env.GOOGLE_SERVER_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
  mapId: process.env.GOOGLE_MAP_ID || '',
  travelMode: (process.env.TRAVEL_MODE || 'DRIVE').toUpperCase(),
  units: process.env.UNITS === 'metric' ? 'metric' : 'imperial',

  discordWebhook: process.env.DISCORD_WEBHOOK_URL || '',
  museKey: process.env.MUSE_API_KEY || '',
  museUrl: process.env.MUSE_API_URL || '',

  owntracksUser: process.env.OWNTRACKS_USER || '',
  owntracksPass: process.env.OWNTRACKS_PASS || '',
  dashboardPass: process.env.DASHBOARD_PASS || '',

  // Geofencing + filtering
  geofenceRadiusM: 75,
  geofenceExitBufferM: num(process.env.GEOFENCE_EXIT_BUFFER_M, 10),
  maxAccuracyM: 100,
  trailLength: 60,

  // Routes API budget: one call per person per 30 s (virtual time), never more
  // often than every 5 s of wall-clock time even when replaying at 10x+.
  etaMinIntervalMs: 30_000,
  etaMinRealIntervalMs: 5_000,
  legRefreshMs: 10 * 60_000,

  // Status + alert thresholds (minutes)
  lateThresholdMin: 5,
  veryLateThresholdMin: 15,
  shiftAlertMin: 5,
  staleAfterS: 120,

  paths: {
    root,
    data: path.join(root, 'data'),
    participants: path.join(root, 'data', 'participants.json'),
    participantsExample: path.join(root, 'data', 'participants.example.json'),
    itinerary: path.join(root, 'data', 'itinerary.json'),
    recordings: path.join(root, 'recordings'),
    web: path.join(root, 'web', 'dist'),
  },
};
