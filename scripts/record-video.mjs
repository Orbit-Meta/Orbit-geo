// Records a time-lapse demo video of a simulate-mode scenario through the
// real dashboard (same map, same pipeline), using Microsoft Edge or Chrome.
//
//   node scripts/record-video.mjs [scenario] [--speed 30] [--url http://localhost:3000]
//                                 [--out videos] [--browser msedge|chrome] [--theme light|dark]
//                                 [--follow seth:chipotle] [--shots dir]
//
// The server must already be running. Output: <out>/<scenario>-<time>.webm
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const scenario = args[0] && !args[0].startsWith('--') ? args[0] : 'ut-austin';
const speed = Number(flag('speed', 30));
const base = flag('url', 'http://localhost:3000').replace(/\/$/, '');
const outDir = path.resolve(flag('out', 'videos'));
const browserChannel = flag('browser', 'msedge');
const theme = flag('theme', 'light');
const follow = flag('follow', 'seth:chipotle'); // "<person>:<stop>" to follow briefly, or "none"
const shotsDir = flag('shots', null);
const size = { width: 1920, height: 1080 };
const MAX_MS = 6 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(p, body) {
  const res = await fetch(base + p, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${p}: ${json.error ?? res.status}`);
  return json;
}

let shot = 0;
async function snap(page, label) {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, `${String(++shot).padStart(2, '0')}-${label}.png`) });
}

fs.mkdirSync(outDir, { recursive: true });
console.log(`Recording "${scenario}" at ${speed}× from ${base}`);

// Start paused-ish (1×) so the fly-in shows everyone at home, then speed up.
await api('/api/mode', { mode: 'simulate', scenario, speed: 1 });

const browser = await chromium.launch({
  channel: browserChannel,
  headless: false,
  args: [`--window-size=${size.width},${size.height + 120}`, '--hide-scrollbars', '--disable-infobars'],
});
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: 1,
  colorScheme: theme,
  recordVideo: { dir: outDir, size },
});
await context.addInitScript((t) => {
  try {
    localStorage.setItem('orbit.devbar.hidden', '1');
    localStorage.setItem('orbit.theme', t);
  } catch {
    /* ignore */
  }
}, theme);

const page = await context.newPage();
try {
  await page.goto(`${base}/?timelapse`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-canvas.visible', { timeout: 30_000 });
  await sleep(5500); // cinematic fly-in
  await snap(page, 'intro');

  await api('/api/mode/speed', { speed });
  const [followId, followStop] = follow === 'none' ? [] : follow.split(':');
  let followed = false;
  const started = Date.now();
  let lastShot = 0;

  while (Date.now() - started < MAX_MS) {
    const s = await api('/api/state');
    const located = s.people.filter((p) => p.location);
    const who = located.find((p) => p.id === followId);

    if (followId && !followed && who && who.at_stop_id === followStop) {
      followed = true;
      await page.click(`.cc-avatar[aria-label="Follow ${who.display_name}"]`);
      await sleep(3500);
      await snap(page, `follow-${followId}`);
      await sleep(3500);
      await page.click('.cc-btn');
    }
    if (Date.now() - lastShot > 12_000) {
      lastShot = Date.now();
      await snap(page, 'progress');
    }
    const finished = located.length > 0 && located.every((p) => p.status === 'done' || (p.status === 'arrived' && p.target_stop_id === s.itinerary.stops.at(-1).id));
    if (finished) break;
    await sleep(500);
  }

  await sleep(4500); // let the last toast and the final zoom settle
  await snap(page, 'everyone-arrived');
  await page.click('.tab:has-text("People")');
  await sleep(4500);
  await snap(page, 'people');
  await page.click('.tab:has-text("Timeline")');
  await sleep(2500);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  await api('/api/mode', { mode: 'live' }).catch(() => {});
  if (video) {
    const raw = await video.path();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const dest = path.join(outDir, `${scenario}-${stamp}.webm`);
    fs.renameSync(raw, dest);
    console.log(`Saved ${dest}`);
  }
}
