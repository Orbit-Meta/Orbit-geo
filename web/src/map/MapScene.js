/* global google */
import { clamp, easeInOutCubic, lerp, lerpAngle, prefersReducedMotion } from '../lib/motion.js';
import { staleAfterMs, virtualNow } from '../lib/useOrbit.js';

const DEFAULT_CAM = { lat: 39.5, lng: -98.35, zoom: 3.4, tilt: 0, heading: 0 };
const OVERVIEW = { tilt: 50, heading: 0, maxZoom: 16 };
const FOLLOW = { zoom: 17.4, tilt: 64 };
const INTRO = { zoom: 3.2, heading: -40, ms: 4600 };
const PANEL_W = 420;
const TRAIL_BANDS = 6;
const FLOW_SPACING_PX = 40;

const toLatLng = ([lat, lng]) => ({ lat, lng });
const sameSpot = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Fast planar distance in metres (fine at city scale). */
function approxDistM(a, b) {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  const y = b.lat - a.lat;
  return Math.sqrt(x * x + y * y) * 111_320;
}

function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Web-mercator zoom that fits a lat/lng box into w×h pixels. */
function fitZoom(box, w, h) {
  const latRad = (lat) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return Math.max(Math.min(Math.log((1 + s) / (1 - s)) / 2, Math.PI), -Math.PI) / 2;
  };
  const latFrac = (latRad(box.maxLat) - latRad(box.minLat)) / Math.PI;
  const lngFrac = (box.maxLng - box.minLng) / 360;
  const zLat = latFrac > 0 ? Math.log2(h / 256 / latFrac) : 21;
  const zLng = lngFrac > 0 ? Math.log2(w / 256 / lngFrac) : 21;
  return Math.min(zLat, zLng);
}

/**
 * Everything on the map, driven imperatively from one requestAnimationFrame
 * loop so React never re-renders map objects:
 *   camera (intro fly-in, overview, follow, free), avatar glides, trails,
 *   glowing routes with animated flow, numbered stop pins.
 */
export class MapScene {
  constructor(container, { mapId, theme, restore, onModeChange, onPersonClick }) {
    this.container = container;
    this.mapId = mapId;
    this.theme = theme;
    this.onModeChange = onModeChange;
    this.onPersonClick = onPersonClick;
    this.people = new Map();
    this.stops = new Map();
    this.cam = { ...(restore?.cam ?? DEFAULT_CAM) };
    this.mode = restore?.mode ?? 'intro';
    this.followId = restore?.followId ?? null;
    this.followZoom = FOLLOW.zoom;
    this.introState = restore ? 'done' : 'pending';
    this.tween = null;
    this.snap = null;
    this.itinVersion = null;
    this.overviewBox = null;
    this.reduced = prefersReducedMotion();
    this.lastFrame = performance.now();
    this.lastSlow = 0;
    this.lastFlow = 0;
    this.destroyed = false;
  }

  async init() {
    const [{ Map, RenderingType }, { AdvancedMarkerElement }, core] = await Promise.all([
      google.maps.importLibrary('maps'),
      google.maps.importLibrary('marker'),
      google.maps.importLibrary('core'),
    ]);
    this.AdvancedMarkerElement = AdvancedMarkerElement;

    this.el = document.createElement('div');
    this.el.className = 'map-canvas';
    if (this.introState === 'done') this.el.classList.add('visible');
    this.container.appendChild(this.el);

    const scheme = core.ColorScheme ? core.ColorScheme[this.theme === 'dark' ? 'DARK' : 'LIGHT'] : undefined;
    this.map = new Map(this.el, {
      mapId: this.mapId || 'DEMO_MAP_ID',
      renderingType: RenderingType?.VECTOR,
      colorScheme: scheme,
      center: { lat: this.cam.lat, lng: this.cam.lng },
      zoom: this.cam.zoom,
      tilt: this.cam.tilt,
      heading: this.cam.heading,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
      keyboardShortcuts: false,
      isFractionalZoomEnabled: true,
    });

    this.map.addListener('dragstart', () => this.setMode('free'));
    this.map.addListener('zoom_changed', () => {
      // A wheel zoom while following keeps following at the new zoom.
      const z = this.map.getZoom();
      if (this.mode === 'follow' && !this.tween && Math.abs(z - this.cam.zoom) > 0.05) this.followZoom = clamp(z, 14, 20);
    });
    google.maps.event.addListenerOnce(this.map, 'tilesloaded', () => this.onTilesLoaded());
    setTimeout(() => this.onTilesLoaded(), 2500);

    this.activeRing = new google.maps.Circle({
      map: this.map,
      radius: 75,
      strokeWeight: 1.5,
      strokeOpacity: 0.55,
      fillOpacity: 0.08,
      clickable: false,
      visible: false,
      zIndex: 2,
    });

    this.raf = requestAnimationFrame(this.frame);
    if (this.snap) this.update(this.snap);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    for (const v of this.people.values()) this.removePerson(v);
    for (const m of this.stops.values()) m.marker.map = null;
    this.activeRing?.setMap(null);
    this.el?.remove();
  }

  getCameraState() {
    return { cam: this.readCam(), mode: this.mode === 'intro' ? 'overview' : this.mode, followId: this.followId };
  }

  // ------------------------------------------------------------------ data

  update(snap) {
    this.snap = snap;
    if (!this.map) return;
    this.syncStops(snap);
    this.syncPeople(snap);

    if (this.introState === 'pending') {
      this.maybeStartIntro();
    } else if (this.mode === 'overview' && !this.tween && this.introState === 'done') {
      if (snap.itinerary.version !== this.itinVersion || this.someoneOutsideOverview()) this.flyToOverview(1600);
    }
    this.itinVersion = snap.itinerary.version;
  }

  syncStops(snap) {
    const states = new Map(snap.stop_states.map((s) => [s.stop_id, s]));
    const seen = new Set();
    let active = null;

    snap.itinerary.stops.forEach((s, i) => {
      seen.add(s.id);
      let m = this.stops.get(s.id);
      const position = { lat: s.lat, lng: s.lng };
      if (!m) {
        const el = document.createElement('div');
        el.className = 'stop-pin';
        el.innerHTML = `
          <div class="sp-body">
            <span class="sp-num"></span>
            <svg class="sp-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>
          </div>
          <div class="sp-tail"></div>
          <div class="sp-label"></div>`;
        const marker = new this.AdvancedMarkerElement({ map: this.map, position, content: el, title: s.name, zIndex: 500 });
        m = { el, marker, position, num: el.querySelector('.sp-num'), label: el.querySelector('.sp-label') };
        this.stops.set(s.id, m);
      }
      if (!sameSpot(m.position, position)) {
        m.marker.position = position;
        m.position = position;
      }
      m.num.textContent = String(i + 1);
      m.label.textContent = s.name;
      m.marker.title = s.name;
      const state = states.get(s.id)?.state ?? 'upcoming';
      m.el.dataset.state = state;
      m.marker.zIndex = state === 'active' ? 600 : 500;
      if (state === 'active') active = position;
    });

    for (const [id, m] of this.stops) {
      if (!seen.has(id)) {
        m.marker.map = null;
        this.stops.delete(id);
      }
    }

    if (active) {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a84ff';
      this.activeRing.setOptions({ center: active, visible: true, strokeColor: accent, fillColor: accent });
    } else {
      this.activeRing.setVisible(false);
    }
  }

  syncPeople(snap) {
    const seen = new Set();
    const now = performance.now();
    const staleMs = staleAfterMs(snap);
    const vnow = virtualNow(snap);

    for (const p of snap.people) {
      if (!p.location) continue;
      seen.add(p.id);
      const v = this.people.get(p.id) ?? this.createPerson(p);
      v.data = p;
      const target = { lat: p.location.lat, lng: p.location.lng };

      if (p.ts !== v.lastTs) {
        if (!v.pos || approxDistM(v.pos, target) > 5000) {
          v.from = v.to = v.pos = target; // first fix or teleport: no glide
          v.dur = 0;
          v.marker.position = target;
        } else {
          if (v.lastRecv) v.interval = clamp(lerp(v.interval, now - v.lastRecv, 0.5), 800, 15_000);
          v.from = { ...v.pos };
          v.to = target;
          v.start = now;
          v.dur = v.interval;
        }
        const moved = approxDistM(v.from, v.to);
        if (moved > 6) v.moveHeading = bearing(v.from, v.to);
        else if (p.location.heading_deg != null && (p.location.speed_mps ?? 0) > 1) v.moveHeading = p.location.heading_deg;
        v.lastRecv = now;
        v.lastTs = p.ts;
      }

      v.el.classList.toggle('stale', vnow - p.ts > staleMs);
      v.el.classList.toggle('arrived', p.status === 'arrived' || p.status === 'done');
      v.el.classList.toggle('moving', (p.location.speed_mps ?? 0) > 1 && v.moveHeading != null);
      v.el.classList.toggle('following', this.mode === 'follow' && this.followId === p.id);

      const showRoute = p.eta?.path?.length > 1 && p.status !== 'arrived' && p.status !== 'done';
      if (showRoute && v.routeKey !== p.eta.computed_at) {
        v.routePath = p.eta.path.map(toLatLng);
        v.routeKey = p.eta.computed_at;
        v.routeIdx = 0;
      } else if (!showRoute) {
        v.routePath = null;
        v.routeKey = null;
      }
      v.trailPts = p.trail;
    }

    for (const [id, v] of this.people) if (!seen.has(id)) this.removePerson(v);
    if (this.mode === 'follow' && !this.people.has(this.followId)) this.setMode('overview');
  }

  createPerson(p) {
    const el = document.createElement('div');
    el.className = 'avatar-marker';
    el.style.setProperty('--c', p.color);
    el.innerHTML = `<span class="am-pulse"></span><span class="am-heading"></span><span class="am-dot">${escapeHtml(p.initial)}</span>`;
    const position = { lat: p.location.lat, lng: p.location.lng };
    const marker = new this.AdvancedMarkerElement({
      map: this.map,
      position,
      content: el,
      title: p.display_name,
      zIndex: 1000,
      gmpClickable: true,
    });
    marker.addEventListener('gmp-click', () => this.onPersonClick?.(p.id));

    const line = (opts) => new google.maps.Polyline({ map: this.map, clickable: false, path: [], ...opts });
    const route = {
      outer: line({ strokeColor: p.color, strokeOpacity: 0.14, strokeWeight: 16, zIndex: 6 }),
      mid: line({ strokeColor: p.color, strokeOpacity: 0.3, strokeWeight: 9, zIndex: 7 }),
      core: line({ strokeColor: p.color, strokeOpacity: 0.95, strokeWeight: 4.5, zIndex: 8 }),
      flow: line({ strokeOpacity: 0, strokeWeight: 4, zIndex: 9 }),
    };
    const trail = Array.from({ length: TRAIL_BANDS }, (_, i) =>
      line({ strokeColor: p.color, strokeOpacity: 0.06 + (i / (TRAIL_BANDS - 1)) * 0.5, strokeWeight: 4, zIndex: 4 }),
    );

    const v = {
      id: p.id,
      el,
      marker,
      route,
      trail,
      from: null,
      to: null,
      pos: null,
      start: 0,
      dur: 0,
      interval: 4000,
      lastRecv: 0,
      lastTs: null,
      moveHeading: p.location.heading_deg,
      camHeading: null,
      rot: null,
      routePath: null,
      routeKey: null,
      routeIdx: 0,
      routeVisible: false,
      trailPts: [],
    };
    this.people.set(p.id, v);
    return v;
  }

  removePerson(v) {
    v.marker.map = null;
    for (const l of [...Object.values(v.route), ...v.trail]) l.setMap(null);
    this.people.delete(v.id);
  }

  // ---------------------------------------------------------------- camera

  readCam() {
    const c = this.map?.getCenter();
    if (!c) return { ...this.cam };
    return {
      lat: c.lat(),
      lng: c.lng(),
      zoom: this.map.getZoom() ?? this.cam.zoom,
      tilt: this.map.getTilt() ?? this.cam.tilt,
      heading: this.map.getHeading() ?? this.cam.heading,
    };
  }

  moveCamera() {
    const { lat, lng, zoom, tilt, heading } = this.cam;
    this.map.moveCamera({ center: { lat, lng }, zoom, tilt, heading });
  }

  tweenTo(target, ms, { tiltDelay = 0, onDone } = {}) {
    this.tween = {
      from: { ...this.cam },
      target: typeof target === 'function' ? target : () => target,
      start: performance.now(),
      ms: this.reduced ? 1 : ms,
      tiltDelay,
      onDone,
    };
  }

  stepTween(t) {
    const tw = this.tween;
    const raw = clamp((t - tw.start) / tw.ms, 0, 1);
    const e = easeInOutCubic(raw);
    const et = tw.tiltDelay ? easeInOutCubic(clamp((raw - tw.tiltDelay) / (1 - tw.tiltDelay), 0, 1)) : e;
    const to = tw.target();
    const f = tw.from;
    this.cam = {
      lat: lerp(f.lat, to.lat, e),
      lng: lerp(f.lng, to.lng, e),
      zoom: lerp(f.zoom, to.zoom, e),
      tilt: lerp(f.tilt, to.tilt, et),
      heading: lerpAngle(f.heading, to.heading, e),
    };
    if (raw >= 1) {
      this.tween = null;
      tw.onDone?.();
    }
  }

  overviewTarget() {
    const pts = (this.snap?.itinerary.stops ?? []).map((s) => ({ lat: s.lat, lng: s.lng }));
    for (const v of this.people.values()) if (v.to) pts.push(v.to);
    if (!pts.length) return null;

    const box = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
    for (const p of pts) {
      box.minLat = Math.min(box.minLat, p.lat);
      box.maxLat = Math.max(box.maxLat, p.lat);
      box.minLng = Math.min(box.minLng, p.lng);
      box.maxLng = Math.max(box.maxLng, p.lng);
    }
    const w = this.container.clientWidth || 1280;
    const h = this.container.clientHeight || 800;
    const panel = w >= 900 ? PANEL_W : 0;
    const zoom = clamp(fitZoom(box, Math.max(240, w - panel - 160), Math.max(240, h - 220)) - 0.3, 3, OVERVIEW.maxZoom);

    const padLat = Math.max((box.maxLat - box.minLat) * 0.15, 0.002);
    const padLng = Math.max((box.maxLng - box.minLng) * 0.15, 0.002);
    this.overviewBox = { minLat: box.minLat - padLat, maxLat: box.maxLat + padLat, minLng: box.minLng - padLng, maxLng: box.maxLng + padLng };

    // Shift west so the content centres in the area right of the side panel.
    const lngShift = ((panel / 2) * 360) / (256 * 2 ** zoom);
    return {
      lat: (box.minLat + box.maxLat) / 2,
      lng: (box.minLng + box.maxLng) / 2 - lngShift,
      zoom,
      tilt: OVERVIEW.tilt,
      heading: OVERVIEW.heading,
    };
  }

  someoneOutsideOverview() {
    const b = this.overviewBox;
    if (!b) return true;
    for (const v of this.people.values()) {
      const p = v.to;
      if (p && (p.lat < b.minLat || p.lat > b.maxLat || p.lng < b.minLng || p.lng > b.maxLng)) return true;
    }
    return false;
  }

  flyToOverview(ms) {
    const target = this.overviewTarget();
    if (!target) return;
    this.cam = this.readCam();
    this.tweenTo(target, ms);
  }

  followTarget(v) {
    return {
      lat: v.pos.lat,
      lng: v.pos.lng,
      zoom: this.followZoom,
      tilt: FOLLOW.tilt,
      heading: v.camHeading ?? this.cam.heading,
    };
  }

  onTilesLoaded() {
    if (this.tilesLoaded) return;
    this.tilesLoaded = true;
    this.maybeStartIntro();
    // Nothing to fly to yet: reveal the wide view rather than a blank screen.
    setTimeout(() => this.el?.classList.add('visible'), 1200);
  }

  /** Cinematic fly-in: wide continental view → tilted, rotated itinerary view. */
  maybeStartIntro() {
    if (this.introState !== 'pending' || !this.tilesLoaded || !this.snap) return;
    const target = this.overviewTarget();
    if (!target) return;
    this.introState = 'running';
    this.itinVersion = this.snap.itinerary.version;
    this.el.classList.add('visible');
    const finish = () => {
      this.introState = 'done';
      this.mode = 'overview';
      this.emitMode();
    };
    if (this.reduced) {
      this.cam = target;
      this.moveCamera();
      finish();
      return;
    }
    this.cam = { lat: target.lat, lng: target.lng, zoom: INTRO.zoom, tilt: 0, heading: INTRO.heading };
    this.moveCamera();
    this.tweenTo(target, INTRO.ms, { tiltDelay: 0.4, onDone: finish });
  }

  /** Public: 'overview' | 'follow' | 'free'. */
  setMode(mode, personId) {
    if (mode === 'free') {
      if (this.mode === 'free') return;
      this.tween = null;
      if (this.introState !== 'done') {
        this.introState = 'done';
        this.el?.classList.add('visible');
      }
      this.mode = 'free';
      this.followId = null;
      this.emitMode();
      return;
    }
    this.introState = 'done';
    this.el?.classList.add('visible');

    if (mode === 'overview') {
      this.mode = 'overview';
      this.followId = null;
      this.flyToOverview(1700);
    } else if (mode === 'follow') {
      const v = this.people.get(personId);
      if (!v?.pos) return;
      this.mode = 'follow';
      this.followId = personId;
      this.followZoom = FOLLOW.zoom;
      v.camHeading = v.moveHeading ?? this.readCam().heading;
      this.cam = this.readCam();
      this.tweenTo(() => this.followTarget(v), 1800);
    }
    for (const p of this.people.values()) p.el.classList.toggle('following', p.id === this.followId);
    this.emitMode();
  }

  emitMode() {
    this.onModeChange?.({ mode: this.mode, followId: this.followId });
  }

  // ----------------------------------------------------------- animation

  frame = (t) => {
    if (this.destroyed) return;
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;

    for (const v of this.people.values()) this.stepPerson(v, t, dt);
    this.stepCamera(dt, t);

    if (t - this.lastSlow > 160) {
      this.lastSlow = t;
      for (const v of this.people.values()) {
        this.drawTrail(v);
        this.drawRoute(v);
      }
    }
    if (!this.reduced && t - this.lastFlow > 48) {
      this.lastFlow = t;
      this.stepFlow(t);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  stepPerson(v, t, dt) {
    if (!v.to) return;
    // Linear glide across the expected update interval: constant velocity, no jumps.
    const k = v.dur > 0 ? clamp((t - v.start) / v.dur, 0, 1) : 1;
    const pos = { lat: lerp(v.from.lat, v.to.lat, k), lng: lerp(v.from.lng, v.to.lng, k) };
    if (!sameSpot(pos, v.pos)) {
      v.pos = pos;
      v.marker.position = pos;
    }
    if (v.moveHeading != null) {
      v.camHeading = v.camHeading == null ? v.moveHeading : lerpAngle(v.camHeading, v.moveHeading, 1 - Math.exp(-dt / 1.4));
      const rot = Math.round(v.moveHeading - this.cam.heading);
      if (rot !== v.rot) {
        v.rot = rot;
        v.el.style.setProperty('--rot', `${rot}deg`);
      }
    }
  }

  stepCamera(dt, t) {
    if (this.tween) {
      this.stepTween(t);
      this.moveCamera();
      return;
    }
    if (this.mode !== 'follow') return;
    const v = this.people.get(this.followId);
    if (!v?.pos) return;
    const a = 1 - Math.exp(-dt / 0.35);
    this.cam = {
      lat: v.pos.lat, // the glide is already smooth: lock on exactly
      lng: v.pos.lng,
      zoom: lerp(this.cam.zoom, this.followZoom, a),
      tilt: lerp(this.cam.tilt, FOLLOW.tilt, a),
      heading: this.reduced ? this.cam.heading : lerpAngle(this.cam.heading, v.camHeading ?? this.cam.heading, 1 - Math.exp(-dt / 0.9)),
    };
    this.moveCamera();
  }

  drawTrail(v) {
    const pts = (v.trailPts ?? []).map(toLatLng);
    if (v.pos && pts.length) pts[pts.length - 1] = v.pos; // end the trail at the gliding marker
    const n = pts.length;
    v.trail.forEach((line, i) => {
      if (n < 2) return line.setPath([]);
      const a = Math.floor((i * (n - 1)) / TRAIL_BANDS);
      const b = Math.floor(((i + 1) * (n - 1)) / TRAIL_BANDS);
      line.setPath(b > a ? pts.slice(a, b + 1) : []);
    });
  }

  drawRoute(v) {
    const lines = Object.values(v.route);
    if (!v.routePath || !v.pos) {
      if (v.routeVisible) {
        for (const l of lines) l.setPath([]);
        v.routeVisible = false;
      }
      return;
    }
    // Trim the part of the route already driven.
    const path = v.routePath;
    const from = v.routeIdx;
    const to = from === 0 ? path.length : Math.min(path.length, from + 80);
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < to; i++) {
      const d = approxDistM(v.pos, path[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    v.routeIdx = best;
    const trimmed = [v.pos, ...path.slice(best + 1)];
    for (const l of lines) l.setPath(trimmed);
    v.routeVisible = true;
  }

  stepFlow(t) {
    const offset = `${((t / 1000) * 28) % FLOW_SPACING_PX}px`;
    for (const v of this.people.values()) {
      if (!v.routeVisible) continue;
      v.route.flow.set('icons', [
        {
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 2, fillColor: '#ffffff', fillOpacity: 0.9, strokeOpacity: 0 },
          offset,
          repeat: `${FLOW_SPACING_PX}px`,
        },
      ]);
    }
  }
}
