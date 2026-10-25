import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';

const numOrNull = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Converts an OwnTracks `_type: "location"` message into Orbit's normalized
 * schema. Returns null for anything that is not a usable location.
 */
export function normalizeOwnTracks(msg, { user, device } = {}, participants) {
  if (!msg || msg._type !== 'location') return null;
  const lat = Number(msg.lat);
  const lng = Number(msg.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const who = participants.resolve({ user, device, tid: msg.tid });
  if (!who) return null;

  const tst = Number(msg.tst);
  const vel = numOrNull(msg.vel); // OwnTracks reports km/h
  const cog = numOrNull(msg.cog);

  return {
    source: 'owntracks',
    event_type: 'transit_location_update',
    participant_id: who.id,
    display_name: who.display_name,
    location: {
      lat,
      lng,
      accuracy_m: numOrNull(msg.acc),
      speed_mps: vel !== null && vel >= 0 ? vel / 3.6 : null,
      heading_deg: cog !== null && cog >= 0 && cog <= 360 ? cog : null,
    },
    battery_pct: numOrNull(msg.batt),
    timestamp: new Date(Number.isFinite(tst) && tst > 0 ? tst * 1000 : Date.now()).toISOString(),
  };
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function basicAuth(user, pass, realm) {
  return (req, res, next) => {
    const [scheme, encoded] = (req.get('authorization') || '').split(' ');
    if (scheme?.toLowerCase() === 'basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const i = decoded.indexOf(':');
      if (i >= 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)) return next();
    }
    res.set('WWW-Authenticate', `Basic realm="${realm}"`).status(401).json({ error: 'unauthorized' });
  };
}

export function owntracksRouter({ participants, onUpdate }) {
  const router = express.Router();
  const auth =
    config.owntracksUser && config.owntracksPass
      ? basicAuth(config.owntracksUser, config.owntracksPass, 'OwnTracks')
      : (req, res) => res.status(503).json({ error: 'OWNTRACKS_USER / OWNTRACKS_PASS are not configured' });

  router.post('/', auth, express.json({ limit: '512kb', type: () => true }), (req, res) => {
    const messages = Array.isArray(req.body) ? req.body : [req.body];
    const meta = { user: req.get('x-limit-u'), device: req.get('x-limit-d') };
    for (const msg of messages) {
      const update = normalizeOwnTracks(msg, meta, participants);
      if (update) onUpdate(update);
    }
    // OwnTracks expects a JSON array back; we have nothing to push to the phone.
    res.json([]);
  });

  return router;
}
