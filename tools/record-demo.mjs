// Records the README demo end-to-end and writes a GIF or MP4.
//
//   npm run record:demo                                → screenshots/demo.mp4 (1280x720, crisp)
//   node tools/record-demo.mjs demo.gif                → self-contained inline GIF
//   DEMO_SIZE=1600x900 node tools/record-demo.mjs out.mp4
//   DEMO_SCALE=1.5 node tools/record-demo.mjs out.mp4  → upscale (softer, only if you must)
//
// Captures lossless PNG frames via CDP screencast (Page.startScreencast) rather
// than Playwright's built-in webm — the webm is VP8 at a low bitrate and bands
// badly on the dark gradients, and screencast/recordVideo both ignore
// deviceScaleFactor so neither can supersample. Frames are timestamped, so the
// scripted pauses and the auto-play pacing are preserved on assembly. Output
// format is chosen by extension (.mp4 → H.264 crf 18, otherwise a two-pass
// palette GIF at 900px). DEMO_SIZE is the CSS viewport / capture size (default
// 1280x720 — the compact two-panel layout that fills the frame); DEMO_SCALE
// optionally lanczos-upscales the mp4 (default 1 = native, crispest). Note:
// GitHub README won't inline a committed mp4 — upload it to an Issue/PR to get a
// user-images.githubusercontent.com player URL. GIF is the only self-contained
// inline option.
//
// Drives a scripted flow (English UI): poke a few dependency links + drum
// digits, search the chest DB for "Arena", apply the first hit, solve, then
// auto-play the solution. Starts its own `serve` on :3000 if none is running.
// Requires ffmpeg on PATH.

import { chromium, selectors } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { get } from 'node:http';

const OUT = resolve(process.argv[2] || 'screenshots/demo.mp4');
const PORT = 3000, BASE = `http://localhost:${PORT}/`;
const [W, H] = (process.env.DEMO_SIZE || '1280x720').split('x').map(Number);
const SCALE = Number(process.env.DEMO_SCALE || 1);   // optional mp4 upscale (1 = native)
const FPS = 30;                                       // constant output frame rate
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ping(url) {
  return new Promise(res => get(url, r => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
}
async function waitServer(tries = 40) {
  for (let i = 0; i < tries; i++) { if (await ping(BASE)) return true; await sleep(500); }
  return false;
}
function requireFfmpeg() {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.error('ffmpeg not found on PATH — install it to encode the video.');
    process.exit(1);
  }
}
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
}

requireFfmpeg();

// Reuse an already-running server, otherwise start our own.
let server = null;
if (!(await ping(BASE))) {
  server = spawn('npx', ['serve', '.', '-p', String(PORT), '-n', '--no-clipboard'],
    { stdio: 'ignore', detached: false });
  if (!(await waitServer())) { console.error('server failed to start on :' + PORT); process.exit(1); }
}

const workdir = await mkdtemp(join(tmpdir(), 'gl-demo-'));
selectors.setTestIdAttribute('data-test-id');   // match the app's convention

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(() => localStorage.setItem('lang', 'en'));

const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
const id = (t) => page.getByTestId(t);

await page.goto(BASE);
await id('stage-config').waitFor({ state: 'visible' });

// Lossless PNG screencast. Frames arrive only on visual change; each carries a
// timestamp, so a static pause becomes the on-screen duration of the frame
// before it — no extra work needed to preserve the pacing.
const client = await ctx.newCDPSession(page);
const frames = [];   // { data: Buffer, ts: seconds }
client.on('Page.screencastFrame', async (f) => {
  frames.push({ data: Buffer.from(f.data, 'base64'), ts: f.metadata.timestamp ?? Date.now() / 1000 });
  try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
});

try {
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await sleep(1000);

  // 1) Poke a couple of dependency links on the matrix.
  await id('dep-1-2').click({ force: true }); await sleep(550);
  await id('dep-3-4').click({ force: true }); await sleep(550);
  await id('dep-2-3').click({ force: true }); await sleep(650);

  // 2) Bump a few drum digits.
  await id('pos-inc-2').click({ force: true }); await sleep(300);
  await id('pos-inc-2').click({ force: true }); await sleep(300);
  await id('pos-inc-4').click({ force: true }); await sleep(300);
  await id('pos-dec-1').click({ force: true }); await sleep(700);

  // 3) Open the chest search and look up "Arena".
  await id('btn-search-db').waitFor({ state: 'visible' });
  for (let i = 0; i < 30 && await id('btn-search-db').isDisabled(); i++) await sleep(300);
  await id('btn-search-db').click({ force: true }); await sleep(600);
  await id('search-input').pressSequentially('Arena', { delay: 130 });
  await id('search-result-0').waitFor({ state: 'visible', timeout: 10000 });
  await sleep(900);

  // 4) Apply the first match — back to config with its lock loaded.
  await id('search-result-0').click({ force: true }); await sleep(1100);

  // 5) Solve.
  await id('btn-start').click({ force: true });
  await id('stage-solve').waitFor({ state: 'visible', timeout: 20000 });
  await sleep(1000);

  // 6) Auto-play the whole solution; wait until the button reverts to "▶ Auto".
  await id('btn-auto').click({ force: true });
  const autoBtn = id('btn-auto');
  for (let i = 0; i < 120; i++) {
    const txt = (await autoBtn.textContent() || '').trim();
    if (i > 2 && /Auto/.test(txt)) break;
    await sleep(500);
  }
  await sleep(1200);
  await client.send('Page.stopScreencast');
} finally {
  await ctx.close();
  await browser.close();
  if (server) server.kill();
}

if (!frames.length) { console.error('no frames were captured'); process.exit(1); }

// Write frames + a concat list whose per-frame durations come from the
// timestamp deltas (clamped so an idle gap can't freeze the video).
const listLines = [];
for (let i = 0; i < frames.length; i++) {
  const name = `f${String(i).padStart(5, '0')}.png`;
  await writeFile(join(workdir, name), frames[i].data);
  const next = i < frames.length - 1 ? frames[i + 1].ts - frames[i].ts : 1.5;
  const dur = Math.min(Math.max(next, 0.02), 3);
  listLines.push(`file '${name}'`, `duration ${dur.toFixed(3)}`);
}
listLines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.png'`);  // concat needs the last file repeated
const list = join(workdir, 'frames.txt');
await writeFile(list, listLines.join('\n') + '\n');

await mkdir(dirname(OUT), { recursive: true });
if (OUT.endsWith('.mp4')) {
  const ow = Math.round(W * SCALE / 2) * 2, oh = Math.round(H * SCALE / 2) * 2;
  const vf = (SCALE !== 1 ? `scale=${ow}:${oh}:flags=lanczos,` : '') + 'format=yuv420p';
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', vf, '-r', String(FPS),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', OUT]);
} else {
  // Two-pass palette GIF, downscaled to 900px for a reasonable size.
  const palette = join(workdir, 'palette.png');
  const vf = 'fps=12,scale=900:-2:flags=lanczos';
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `${vf},palettegen=stats_mode=diff`, palette]);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-i', palette, '-lavfi',
    `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, OUT]);
}

await rm(workdir, { recursive: true, force: true });
console.log(`wrote ${OUT} (${frames.length} frames)`);
