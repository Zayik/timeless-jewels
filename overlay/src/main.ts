// PoE2 jewel-capture overlay — auto-detecting, always click-through.
//
// The overlay window never intercepts input (it can't lock the screen or steal
// focus). It captures the screen, auto-detects the jewel (by ring colour) and the
// socket (by constellation match), then highlights each affected notable in place
// over the game and walks you through them. All control is via global hotkeys:
//   Ctrl+Shift+K = start/stop · Ctrl+Shift+J = record current node + advance
// Tooltip OCR (what each node BECAME) is the next milestone; advancing records
// "visited" for now, proving the geometry locks onto the right nodes.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import socketData from './poe2_sockets.json';
import {
  projectNotables,
  ringInCss,
  nearestNode,
  type Socket,
  type SocketData,
  type ProjectedNode
} from './projection';

const data = socketData as SocketData;
// Sorted socket list for manual cycling. Auto-detect picks a starting guess; the
// user corrects with Ctrl+Shift+[ / ] while watching the highlights snap to nodes.
const socketList: Socket[] = [...data.sockets].sort((a, b) => a.y - b.y || a.x - b.x);
const indexById = new Map<number, number>(socketList.map((s, i) => [s.socketId, i]));
const posLabel = (s: Socket): string => {
  const v = s.y < -2500 ? 'top' : s.y > 2500 ? 'bottom' : 'mid';
  const h = s.x < -2500 ? 'left' : s.x > 2500 ? 'right' : 'centre';
  return `${v}-${h}`;
};

interface Detection {
  cx: number;
  cy: number;
  r: number;
  support: number;
  coverage: number;
  resid: number;
  frame_w: number;
  frame_h: number;
  jewel: string;
  /** Gem template-match correlation (−1..1); how confidently the centre/jewel was found. */
  jewel_match: number;
  /** Matched socketed-jewel sprite width in px — the stable scale reference. */
  gem: number;
  socket_id: number;
  socket_score: number;
  socket_second: number;
}

// Minimum gem-match correlation to trust a frame. Below this the socketed gem isn't at
// the detected centre (a false-positive ring, or lost lock mid-pan), so the frame is
// dropped and the last good pose held — this kills the "snaps way off then back" cycle.
const MATCH_FLOOR = 0.3;

// --- DOM ---
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="panel">
    <h1>PoE2 Jewel Overlay <span class="tag">auto</span></h1>
    <div id="detect" class="muted">Stopped. Press <b>Ctrl+Shift+K</b> to start.</div>
    <div id="jewel" class="muted">No jewel yet. Copy it in-game (<b>Ctrl+C</b>) — auto-detected.</div>
    <div id="status" class="muted"></div>
    <div id="progress" class="muted"></div>
    <div id="hint" class="muted"><b>Ctrl+Shift+K</b> start/stop · <b>Ctrl+Shift+J</b> record &amp; next · <b>Ctrl+Shift+C</b> read jewel</div>
  </div>
  <svg id="layer"></svg>
`;
const detectEl = document.getElementById('detect')!;
const jewelEl = document.getElementById('jewel')!;
const statusEl = document.getElementById('status')!;
const progressEl = document.getElementById('progress')!;
const layer = document.getElementById('layer') as unknown as SVGSVGElement;

// --- state ---
let running = false;
let pollTimer: number | undefined;
let socketIdx = 0; // index into socketList (current socket being projected)
let manualOverride = false; // true once the user cycles; stops auto from overriding
let locked = false; // true once auto-detect commits a socket; stops re-identifying
let ringSmooth: { cx: number; cy: number; r: number } | null = null; // last smoothed pose
let centerWin: { cx: number; cy: number }[] = []; // recent centres for a small median
// Gem width (px) ÷ tree-radius ratio. The gem's TREE size is constant, so this is fixed;
// once calibrated (from one settled frame's ring) it converts the measured gem width into
// the projection's equivalent ring radius.
let gemTreeWidth: number | null = null;
// HELD projection scale (equivalent ring radius). Scale only changes when you ZOOM — never
// while panning or standing still — so we hold it and re-adopt only on a large, sustained
// change. This is what kills scale jitter: per-frame scale noise (ring fit OR gem argmax)
// is absorbed by the hold, and a deadband on scale is safe (panning doesn't change scale).
let heldScale = 0;
let scaleBreaches = 0; // consecutive frames the raw scale broke the deadband (zoom confirm)
const SCALE_DEADBAND = 0.06; // ignore raw-scale changes under 6% (noise); larger = a zoom
let stableFrames = 0; // consecutive frames the raw ring has barely moved
let lastIdentifyMs = 0; // throttle the heavy socket-identification pass
let prevStabRing: { cx: number; cy: number; r: number } | null = null;
// Last good ring, held briefly when detection fails (e.g. a tooltip overlaps the ring).
let lastRing: { cx: number; cy: number; r: number; frame_w: number; frame_h: number } | null = null;
let lastRingMs = 0;
const RING_HOLD_MS = 2000;
// On-screen notable highlight radius as a fraction of the ring radius (both scale
// with zoom). Tune to taste — larger = the ring hugs further outside the notable.
const NODE_RADIUS_FRAC = 0.045;
interface JewelInfo {
  jewel: string;
  seed: number;
  conqueror: string;
}
let jewelInfo: JewelInfo | null = null; // parsed from the jewel's Ctrl+C item text
let targetIdx = 0;
const visited = new Set<number>();
const socket = (): Socket => socketList[socketIdx];

function setText(el: Element, msg: string, kind: 'ok' | 'warn' | 'muted' = 'muted') {
  el.textContent = msg;
  el.className = kind === 'muted' ? 'muted' : kind;
}
function updateProgress() {
  if (running) {
    const s = socket();
    progressEl.textContent =
      `Socket ${socketIdx + 1}/${socketList.length} (${s.id} · ${posLabel(s)})` +
      `${manualOverride ? ' [manual]' : locked ? ' [locked]' : ' [auto]'} · target ${Math.min(targetIdx + 1, s.notables.length)}/${s.notables.length} · recorded ${visited.size}` +
      ` · Ctrl+Shift+[ ] to change`;
  } else {
    progressEl.textContent = '';
  }
}

// --- SVG ---
const NS = 'http://www.w3.org/2000/svg';
function clearLayer() {
  while (layer.firstChild) layer.removeChild(layer.firstChild);
}
function circle(cx: number, cy: number, r: number, cls: string) {
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  c.setAttribute('class', cls);
  layer.appendChild(c);
}
function label(x: number, y: number, text: string, cls: string) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', String(x));
  t.setAttribute('y', String(y));
  t.setAttribute('class', cls);
  t.textContent = text;
  layer.appendChild(t);
}

function draw(
  projected: ProjectedNode[],
  ringCss: { cx: number; cy: number; r: number },
  hover: ProjectedNode | null
) {
  clearLayer();
  circle(ringCss.cx, ringCss.cy, ringCss.r, 'ring');
  // Highlight radius scales with the ring (zoom) so it hugs the notable icon at any
  // zoom — the notable's on-screen size is a fixed fraction of the ring radius.
  const nodeR = Math.max(7, ringCss.r * NODE_RADIUS_FRAC);
  const targetR = nodeR * 1.25;
  projected.forEach((p, i) => {
    const done = visited.has(p.notable.skill);
    const isTarget = i === targetIdx;
    const cls = isTarget ? 'node target' : done ? 'node done' : 'node';
    circle(p.sx, p.sy, isTarget ? targetR : nodeR, cls);
  });
  const target = projected[targetIdx];
  if (target)
    label(target.sx + targetR + 6, target.sy - targetR, `→ ${target.notable.name}`, 'targetLabel');
  if (hover) {
    circle(hover.sx, hover.sy, nodeR * 1.15, 'hover');
    label(hover.sx + nodeR + 6, hover.sy + nodeR + 10, hover.notable.name, 'hoverLabel');
  }
}

function resetRingFilters(): void {
  centerWin = [];
  ringSmooth = null;
  heldScale = 0;
  scaleBreaches = 0;
}
// HOLD the scale: keep the held value unless the raw scale breaks the deadband for a couple
// of frames (a real zoom). Standing still / panning -> raw stays within the band -> the held
// value never changes -> zero scale jitter. A single noisy spike can't snap it (persistence).
function holdScale(raw: number): number {
  if (heldScale === 0) {
    heldScale = raw;
    return heldScale;
  }
  if (Math.abs(raw - heldScale) / heldScale > SCALE_DEADBAND) {
    if (++scaleBreaches >= 2) {
      heldScale = raw; // confirmed zoom: adopt the new scale
      scaleBreaches = 0;
    }
  } else {
    scaleBreaches = 0;
  }
  return heldScale;
}
// Median the centre over recent frames. The centre is gem-anchored (a static feature) so
// it's already steady; the median just kills the odd outlier. It must NOT be deadbanded —
// the centre follows panning, and a deadband there would freeze slow pans.
function stabilizeCenter(cx: number, cy: number): { cx: number; cy: number } {
  if (ringSmooth && Math.hypot(cx - ringSmooth.cx, cy - ringSmooth.cy) > 120) {
    centerWin = []; // big jump (socket swap / fast move): re-acquire instantly
  }
  centerWin.push({ cx, cy });
  if (centerWin.length > 3) centerWin.shift();
  const med = (key: 'cx' | 'cy'): number => {
    const v = centerWin.map((p) => p[key]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const c = { cx: med('cx'), cy: med('cy') };
  ringSmooth = { cx: c.cx, cy: c.cy, r: heldScale };
  return c;
}

// Project the current socket's notables off a given ring pose and draw them. Shared
// by the live path and the "held ring" path (tooltip occlusion) so both render
// identically. Only cx/cy/r are read from `ring`.
async function renderProjection(ring: Detection): Promise<void> {
  const dpr = window.devicePixelRatio || 1;
  const projected = projectNotables(ring, socket(), data.rTree, dpr);
  let hover: ProjectedNode | null = null;
  try {
    const cur = (await invoke('get_cursor')) as { x: number; y: number };
    hover = nearestNode(projected, cur, dpr, (ring.r / dpr) * 0.14);
  } catch {
    /* cursor unavailable */
  }
  updateProgress();
  draw(projected, ringInCss(ring, dpr), hover);
}

function selectSocket(idx: number) {
  socketIdx = ((idx % socketList.length) + socketList.length) % socketList.length;
  targetIdx = 0;
  visited.clear();
}

// --- capture loop ---
// One iteration of capture+detect+draw. Self-chains via setTimeout so a new
// capture NEVER starts before the previous finishes — xcap uses DXGI desktop
// duplication on Windows, which crashes on concurrent/overlapping captures
// (the stall-then-crash seen when a tooltip slowed a frame down).
async function tick() {
  if (!running) return;
  try {
    let det: Detection | null = null;
    try {
      // The heavy socket-identification pass (edge map + distance transform) only
      // runs when: not yet locked, not manually overridden, the ring has been
      // settled for a couple of frames (never mid pan/zoom), and a throttle window
      // has elapsed. Otherwise we pay just the cheap ring transform. This keeps the
      // capture loop fast enough that xcap's DXGI duplication doesn't stall.
      const now = performance.now();
      const wantIdentify =
        !locked && !manualOverride && stableFrames >= 2 && now - lastIdentifyMs > 700;
      if (wantIdentify) lastIdentifyMs = now;
      det = (await invoke('capture_and_detect', { identify: wantIdentify })) as Detection | null;
    } catch (e) {
      setText(statusEl, `capture error: ${e}`, 'warn');
      return;
    }
    // Drop frames where the gem isn't confidently at the detected centre: a wrong/false
    // ring would otherwise yank the highlights "way off" for a frame. Treat them like a
    // missed detection and hold the last good pose (steady when standing still).
    const weak = det !== null && det.jewel_match < MATCH_FLOOR;
    if (!det || weak) {
      const now = performance.now();
      if (lastRing && now - lastRingMs < RING_HOLD_MS) {
        // Ring momentarily undetectable (tooltip overlap) or the gem match is weak. Hold
        // the last good pose so highlights persist instead of snapping to a bad centre.
        setText(
          detectEl,
          weak ? `Weak match (${det!.jewel_match.toFixed(2)}) — holding.` : 'Ring hidden (tooltip?) — holding.',
          'warn'
        );
        const held: Detection = {
          cx: lastRing.cx,
          cy: lastRing.cy,
          r: lastRing.r,
          support: 0,
          coverage: 0,
          resid: 0,
          frame_w: lastRing.frame_w,
          frame_h: lastRing.frame_h,
          jewel: '',
          jewel_match: 0,
          gem: 0,
          socket_id: -1,
          socket_score: 0,
          socket_second: 0
        };
        await renderProjection(held);
      } else {
        setText(detectEl, 'No ring detected.', 'warn');
        setText(statusEl, 'Open the tree with the jewel socketed; zoom so the ring is visible.', 'muted');
        resetRingFilters(); // ring lost — don't smooth across the gap
        stableFrames = 0;
        prevStabRing = null;
        clearLayer();
      }
      return;
    }

    // Track raw-ring stability to gate the heavy identify pass: only attempt socket
    // identification once the ring has settled, never while panning/zooming.
    if (prevStabRing) {
      const m = Math.hypot(det.cx - prevStabRing.cx, det.cy - prevStabRing.cy);
      const rd = Math.abs(det.r - prevStabRing.r);
      stableFrames = m < 10 && rd < 8 ? stableFrames + 1 : 0;
    }
    prevStabRing = { cx: det.cx, cy: det.cy, r: det.r };

    // Commit the socket from auto-detect once (resolve-once-then-lock); after that
    // the lock — or the user's manual choice — wins, so we stop re-identifying.
    if (!manualOverride && !locked && det.socket_id >= 0 && indexById.has(det.socket_id)) {
      socketIdx = indexById.get(det.socket_id)!;
      locked = true;
    }
    setText(
      detectEl,
      `${det.jewel} · match ${det.jewel_match.toFixed(2)} · gem ${det.gem | 0}px · cov ${(det.coverage * 100) | 0}%`,
      det.coverage >= 0.7 ? 'ok' : 'warn'
    );

    // Calibrate the gem-width → tree-radius ratio once, from a settled frame (the gem's
    // tree size is constant, so this holds across zoom). Until then, fall back to the ring.
    if (gemTreeWidth === null && det.gem > 0 && det.r > 0 && stableFrames >= 2) {
      gemTreeWidth = (det.gem * data.rTree) / det.r;
    }
    // Raw scale from the measured GEM width (static feature), as an equivalent ring radius
    // (s = rScale / rTree). HELD by holdScale so it only changes on a real zoom.
    const rawScale = gemTreeWidth && det.gem > 0 ? (det.gem * data.rTree) / gemTreeWidth : det.r;
    const r = holdScale(rawScale);
    const c = stabilizeCenter(det.cx, det.cy);
    const sring: Detection = { ...det, cx: c.cx, cy: c.cy, r };
    // Remember the good pose so we can hold it through a brief detection failure.
    lastRing = { cx: c.cx, cy: c.cy, r, frame_w: det.frame_w, frame_h: det.frame_h };
    lastRingMs = performance.now();

    setText(statusEl, 'If highlights are off the nodes, cycle sockets with Ctrl+Shift+[ or ].', 'ok');
    await renderProjection(sring);
  } finally {
    // Schedule the next iteration only after this one fully completes.
    if (running) pollTimer = window.setTimeout(tick, 160);
  }
}

function start() {
  running = true;
  manualOverride = false;
  locked = false;
  gemTreeWidth = null;
  resetRingFilters();
  stableFrames = 0;
  prevStabRing = null;
  lastIdentifyMs = 0;
  lastRing = null;
  setText(detectEl, 'Detecting…', 'muted');
  void tick();
}
function stop() {
  running = false;
  if (pollTimer) window.clearTimeout(pollTimer);
  clearLayer();
  setText(detectEl, 'Stopped. Press Ctrl+Shift+K to start.', 'muted');
  setText(statusEl, '');
  updateProgress();
}

// --- hotkeys (global, from Rust) ---
listen('toggle-run', () => (running ? stop() : start()));
listen<number>('socket-cycle', (e) => {
  if (!running) return;
  manualOverride = true;
  selectSocket(socketIdx + (e.payload < 0 ? -1 : 1));
  updateProgress();
});
listen('capture-hotkey', () => {
  if (!running) return;
  if (!jewelInfo) {
    setText(jewelEl, 'Read the jewel first (Ctrl+Shift+C) — recordings are keyed by seed.', 'warn');
  }
  const s = socket();
  const target = s.notables[targetIdx];
  if (target) visited.add(target.skill);
  let next = targetIdx + 1;
  while (next < s.notables.length && visited.has(s.notables[next].skill)) next++;
  targetIdx = next;
  if (targetIdx >= s.notables.length) {
    setText(statusEl, `All ${s.notables.length} notables recorded. (OCR of values is next.)`, 'ok');
  }
  updateProgress();
});

// Jewel/seed capture from the clipboard. The seed is required for recording (the
// same node transforms differently per seed). The user copies the jewel in-game with
// Ctrl+C (a single natural action); we AUTO-POLL the clipboard so a new/swapped jewel
// is picked up within ~1s with no second hotkey. Ctrl+Shift+C forces an immediate
// read (and gives feedback when the clipboard isn't a jewel).
async function readJewelFromClipboard(verbose: boolean): Promise<void> {
  try {
    const info = (await invoke('read_jewel')) as JewelInfo | null;
    if (!info) {
      if (verbose)
        setText(jewelEl, 'No timeless jewel on clipboard — hover it and press Ctrl+C first.', 'warn');
      return;
    }
    const conq = info.conqueror ? ` · ${info.conqueror}` : '';
    if (jewelInfo && info.jewel === jewelInfo.jewel && info.seed === jewelInfo.seed) {
      if (verbose) setText(jewelEl, `Jewel: ${info.jewel} · seed ${info.seed}${conq} (unchanged)`, 'ok');
      return;
    }
    jewelInfo = info;
    setText(jewelEl, `Jewel: ${info.jewel} · seed ${info.seed}${conq}`, 'ok');
    // New jewel/seed = a fresh recording set (transforms are seed-specific), so reset
    // the per-socket walk: nothing recorded yet for this seed.
    visited.clear();
    targetIdx = 0;
    updateProgress();
  } catch (e) {
    if (verbose) setText(jewelEl, `clipboard error: ${e}`, 'warn');
  }
}
listen('read-jewel', () => void readJewelFromClipboard(true));
// Auto-poll: pick up a copied/swapped jewel without needing the hotkey.
setInterval(() => void readJewelFromClipboard(false), 1200);

// Debug: Ctrl+Shift+S dumps a raw screen capture for mask tuning.
listen<string>('debug-capture', (e) => {
  setText(statusEl, `Saved: ${e.payload}`, e.payload.startsWith('ERROR') ? 'warn' : 'ok');
});

setText(detectEl, 'Stopped. Ctrl+Shift+K start · Ctrl+Shift+S dump frame.', 'muted');
