// PoE2 jewel-capture overlay — on-demand calibration, always click-through.
//
// The overlay window never intercepts input (it can't lock the screen or steal focus).
// Detection (screen capture + socketed-graphic template match + tree-snap) runs ONLY when you
// calibrate — Ctrl+Shift+K to start, Ctrl+Shift+R to recalibrate — locking a fixed screen pose.
// Highlights are drawn from that pose and persist while you pan/zoom or a tooltip covers the
// jewel; when they drift off the nodes you recalibrate. This is cheap (no per-frame capture)
// and robust (occlusion/zoom can't break a held pose). All control is via global hotkeys:
//   Ctrl+Shift+K = show/hide · Ctrl+Shift+R = recalibrate · Ctrl+Shift+J = record node + advance
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
  /** Socketed-graphic template-match correlation (−1..1); how confidently the pose was found. */
  jewel_match: number;
  /** Matched studded-frame width in px — the stable scale ruler (r is derived from it). */
  gem: number;
  socket_id: number;
  socket_score: number;
  socket_second: number;
}

// Minimum match correlation to trust a frame. Below this the socketed graphic isn't at the
// detected centre (lost lock mid-pan, or nothing matched), so the frame is dropped and the
// last good pose held — this kills the "snaps way off then back" cycle.
const MATCH_FLOOR = 0.3;

// --- DOM ---
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="panel">
    <h1>PoE2 Jewel Overlay <span class="tag">calibrate</span></h1>
    <div id="detect" class="muted">Stopped. Press <b>Ctrl+Shift+K</b> to start.</div>
    <div id="jewel" class="muted">No jewel yet. Copy it in-game (<b>Ctrl+C</b>) — auto-detected.</div>
    <div id="status" class="muted"></div>
    <div id="progress" class="muted"></div>
    <div id="hint" class="muted"><b>Ctrl+Shift+K</b> show/hide · <b>Ctrl+Shift+R</b> recalibrate · <b>Ctrl+Shift+J</b> record &amp; next · <b>Ctrl+Shift+C</b> read jewel</div>
  </div>
  <svg id="layer"></svg>
`;
const detectEl = document.getElementById('detect')!;
const jewelEl = document.getElementById('jewel')!;
const statusEl = document.getElementById('status')!;
const progressEl = document.getElementById('progress')!;
const layer = document.getElementById('layer') as unknown as SVGSVGElement;

// --- state ---
// On-demand calibration model: detection (the expensive screen-capture + template match) runs
// ONLY when the user calibrates (Ctrl+Shift+K to start, Ctrl+Shift+R to recalibrate). It locks
// a fixed screen pose; highlights are drawn from that pose and persist while you pan/zoom or a
// tooltip covers the jewel. When the view has moved enough that highlights drift off the nodes,
// you recalibrate. A cheap cursor-only poll (no capture) keeps the hover indicator live.
let active = false; // overlay shown (between Ctrl+Shift+K on/off)
let hoverTimer: number | undefined;
let rendering = false; // re-entrancy guard for the cursor-poll render
let socketIdx = 0; // index into socketList (current socket being projected)
let manualOverride = false; // true once the user cycles (drives the [manual] label)
// Once a socket is committed (auto-identified on the first calibrate, or manually cycled) it is
// LOCKED: later recalibrations refresh only the pose for THIS socket and never re-identify.
// Socket-ID is unreliable when zoomed far out (tiny frame → noisy scale → central sockets'
// constellations look alike), so re-picking on every recalibrate would jump to a wrong socket.
let socketChosen = false;
// The locked screen pose from the last successful calibration (physical px + effective radius).
let lockedPose: { cx: number; cy: number; r: number } | null = null;
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
  if (active && lockedPose) {
    const s = socket();
    progressEl.textContent =
      `Socket ${socketIdx + 1}/${socketList.length} (${s.id} · ${posLabel(s)})` +
      `${manualOverride ? ' [manual]' : ''} · target ${Math.min(targetIdx + 1, s.notables.length)}/${s.notables.length} · recorded ${visited.size}` +
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

// Render the locked pose's notables (optionally with a cursor hover indicator). Cheap and
// pure: reads only the held pose + the chosen socket, no screen capture.
function renderLocked(cursorPhysical?: { x: number; y: number }): void {
  if (!lockedPose) return;
  const dpr = window.devicePixelRatio || 1;
  const ring = { ...lockedPose, support: 0, frame_w: 0, frame_h: 0 };
  const projected = projectNotables(ring, socket(), data.rTree, dpr);
  const hover = cursorPhysical
    ? nearestNode(projected, cursorPhysical, dpr, (lockedPose.r / dpr) * 0.14)
    : null;
  draw(projected, ringInCss(ring, dpr), hover);
  updateProgress();
}

function selectSocket(idx: number) {
  socketIdx = ((idx % socketList.length) + socketList.length) % socketList.length;
  targetIdx = 0;
  visited.clear();
}

// --- calibration (the ONLY screen-capture path) ---
// One full detection: capture, locate the socketed graphic full-screen, identify the socket,
// and snap the pose to the tree. Locks `lockedPose`. On failure the previous pose is kept so a
// bad calibrate (tooltip over the jewel, too zoomed) never wipes a working overlay.
async function calibrate(): Promise<void> {
  if (!active) return;
  setText(detectEl, 'Calibrating…', 'muted');
  let det: Detection | null = null;
  try {
    det = (await invoke('capture_and_detect', {
      jewel: jewelInfo?.jewel ?? null,
      // Once a socket is locked, snap the pose to THAT socket and skip (unreliable) re-ID.
      // Only the first calibrate (nothing chosen yet) auto-identifies the socket.
      socketHint: socketChosen ? socket().socketId : null,
      identify: true
    })) as Detection | null;
  } catch (e) {
    setText(detectEl, `capture error: ${e}`, 'warn');
    return;
  }
  if (!det || det.jewel_match < MATCH_FLOOR) {
    setText(
      detectEl,
      'Could not find the socket. Centre it, zoom so the gold socket frame is clear, move any tooltip off it, then recalibrate (Ctrl+Shift+R).',
      'warn'
    );
    return; // keep any existing lockedPose
  }
  lockedPose = { cx: det.cx, cy: det.cy, r: det.r };
  // Adopt the auto-identified socket ONLY on the first calibrate (nothing chosen yet); after
  // that the socket is locked and recalibration just refreshes the pose for it.
  if (!socketChosen && det.socket_id >= 0 && indexById.has(det.socket_id)) {
    socketIdx = indexById.get(det.socket_id)!;
    targetIdx = 0;
    socketChosen = true;
  }
  const sock = socketChosen
    ? ` · socket ${socketIdx + 1}/${socketList.length}`
    : ' · socket unsure (cycle with Ctrl+Shift+[ ])';
  setText(detectEl, `Locked: ${det.jewel} · ${(det.jewel_match * 100) | 0}%${sock}`, 'ok');
  setText(
    statusEl,
    'Highlights locked. Pan/zoom or open tooltips freely; press Ctrl+Shift+R to recalibrate when they drift.',
    'muted'
  );
  renderLocked();
}

// Cheap cursor-only poll (NO screen capture) so the hover indicator follows the mouse while
// the locked pose stays put. Re-entrancy-guarded; self-reschedules while active.
async function hoverTick(): Promise<void> {
  if (!active) return;
  if (lockedPose && !rendering) {
    rendering = true;
    try {
      const cur = (await invoke('get_cursor')) as { x: number; y: number };
      renderLocked(cur);
    } catch {
      /* cursor unavailable this tick */
    } finally {
      rendering = false;
    }
  }
  if (active) hoverTimer = window.setTimeout(hoverTick, 120);
}

function start() {
  active = true;
  manualOverride = false;
  socketChosen = false;
  lockedPose = null;
  void calibrate();
  void hoverTick();
}
function stop() {
  active = false;
  if (hoverTimer) window.clearTimeout(hoverTimer);
  lockedPose = null;
  clearLayer();
  setText(detectEl, 'Stopped. Press Ctrl+Shift+K to start.', 'muted');
  setText(statusEl, '');
  updateProgress();
}

// --- hotkeys (global, from Rust) ---
listen('toggle-run', () => (active ? stop() : start()));
listen('recalibrate', () => {
  if (active) void calibrate();
});
listen<number>('socket-cycle', (e) => {
  if (!active) return;
  manualOverride = true;
  socketChosen = true; // lock to the user's pick; recalibrate refines the pose for it
  selectSocket(socketIdx + (e.payload < 0 ? -1 : 1));
  renderLocked();
});
listen('capture-hotkey', () => {
  if (!active) return;
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
  renderLocked();
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

setText(detectEl, 'Stopped. Ctrl+Shift+K to start · Ctrl+Shift+R recalibrate · Ctrl+Shift+S dump frame.', 'muted');
