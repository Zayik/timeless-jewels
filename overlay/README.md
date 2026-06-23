# PoE2 Jewel Capture Overlay (contributor tool)

A small desktop overlay that helps **contributors** record what a socketed PoE2
timeless jewel transforms each notable into, so the data can be submitted to the
community DB. It is **not** needed by people who only *look up* seeds — they use
the website. This tool is intentionally separate and optional.

> **Status: recording.** Highlights stay locked onto the correct in-game passive
> nodes as you pan/zoom, and recording now reads the hovered node's tooltip via
> on-device OCR (Windows.Media.Ocr), fuzzy-matches the result-notable name against
> the jewel's vocabulary, and stores the transform locally (export to clipboard with
> Ctrl+Shift+E). Submitting to the community DB is the remaining milestone.

## How it works

The socketed jewel draws its **radius ring** on the passive tree (green/yellow for
Undying Hate, blue for Heroic Tragedy). That ring is a 3-DOF anchor — its centre is the
socket's projected position and its pixel radius equals `R_tree = 1800` tree units
exactly — so one circle fit recovers the screen→tree transform in closed form:

```
s = ring_radius_px / R_tree                       (px per tree unit)
screen = ring_centre + (node_tree − socket_tree) · s
```

`R_tree = 1800` is the authoritative game constant (PoE2 "Very Large" radius), so the
scale needs no empirical tuning. The ring is detected by colour-masking its hue and
fitting a circle (RANSAC + Kåsa); a final **outer-edge** pass refits to the band's clean
outer boundary (the ticks point inward), pinning centre and radius tightly. The ring's
animation jitter is irrelevant because we detect it only on an explicit calibrate.

**On-demand calibration.** Detection (capture + ring fit + socket-ID + tree-snap, well
under a second) runs ONLY when you calibrate — Ctrl+Shift+K to start, Ctrl+Shift+R to
recalibrate — and locks a fixed screen pose. Highlights are then drawn from that pose
with no per-frame capture, so they persist while you pan/zoom or a tooltip covers the
jewel; when they drift off the nodes you recalibrate. Cheap, and unbreakable by
occlusion or extreme zoom. Each calibration also snaps the pose (centre + scale) to the
socket's real tree lines (edge-chamfer `refine_pose`), so notables overlay the actual
nodes. The socket is identified once then locked; only an explicit cycle changes it.

- **Rust** (`src-tauri/`): screen capture (`xcap`), **ring detection** (`ring.rs`:
  colour mask → RANSAC/Kåsa circle fit → outer-edge refit), **socket
  auto-identification** (`main.rs`: Sobel edge map → chamfer distance transform → score
  the 14 sockets' projected connector edges, lowest-cost wins) and `refine_pose`
  (snap centre+scale to the tree), global cursor position, global hotkeys, and a
  transparent click-through always-on-top window.
- **TypeScript** (`src/`): projects the socket's affected notables to screen
  (`projection.ts`) and draws the highlights/guide (`main.ts`). The per-socket
  node data is extracted from the main repo's `frontend/static/data/poe2/data.json`
  into `src/poe2_sockets.json` (notables, for highlighting) and
  `src/poe2_socket_graphs.json` (nodes + edges, for socket matching) — run
  `pnpm extract`.

### Socket auto-identification

The graphic match fixes the screen↔tree transform, but not *which* of the 14
sockets it is. Node icon **art changes** under a timeless jewel, so icons are
unreliable; node **positions and the connector lines** between them do not. So for
each socket we project its local subgraph through the transform and score the mean
distance-transform value under the projected edges (chamfer matching) — the socket
whose edges line up with the real tree lines scores lowest. The UI resolves the
socket once (confident frames only; otherwise you cycle manually) and then locks
it, so steady-state frames pay only the cheap transform. The approach was
validated offline against `Screenshots/` with `scripts/socket_match_harness.py`.

## Prerequisites

- Rust toolchain (`cargo`) and the Tauri v2 system deps (WebView2 on Windows —
  preinstalled on Win10/11).
- Node + pnpm.
- Run PoE2 in **borderless windowed** (exclusive fullscreen captures as black).

## Run (dev)

```bash
cd overlay
pnpm install
pnpm extract          # regenerate src/poe2_sockets.json from the tree export
pnpm app              # tauri dev: launches vite + the overlay window
```

Build a distributable:

```bash
pnpm app:build        # tauri build -> installer in src-tauri/target/release/bundle
```

## Using it

1. Launch the overlay (it is always click-through; the panel top-left is informational).
2. Open the passive tree in PoE2 with the jewel socketed; zoom/pan so the gold socket
   frame is clearly visible (no tooltip over it).
3. Press **Ctrl+Shift+K** to calibrate. The jewel type and socket are auto-detected and
   a fixed pose is locked; each affected notable is highlighted (current target gold).
4. Pan/zoom or open tooltips freely — the highlights stay put. When they drift off the
   nodes, press **Ctrl+Shift+R** to recalibrate.
5. Read the jewel first: hover it in-game, **Ctrl+C**, then **Ctrl+Shift+C** (or wait for
   the auto-poll). Recordings are keyed by seed, so this is required.
6. Hover the highlighted (gold) target node so its tooltip is visible, then press
   **Ctrl+Shift+J**. The tooltip name is OCR'd and matched to a result notable:
   a confident match records and advances automatically; a borderline match shows the
   candidate + confidence and waits for a second **Ctrl+Shift+J** to accept; a poor read
   asks you to re-hover and retry. Use **Ctrl+Shift+[ / ]** to correct the socket if
   auto-detect picked wrong, then recalibrate.
7. When done, **Ctrl+Shift+E** copies all recorded transforms (submission-ready JSON) to
   the clipboard. Records accumulate across seeds/sockets until you export.

## Hotkeys

| Key | Action |
|---|---|
| `Ctrl+Shift+K` | Show/hide the overlay (calibrates on show) |
| `Ctrl+Shift+R` | Recalibrate the pose (after you pan/zoom) |
| `Ctrl+Shift+J` | OCR + record current target node, advance (2nd press confirms a borderline match) |
| `Ctrl+Shift+C` | Read the jewel (type + seed) from the Ctrl+C clipboard text |
| `Ctrl+Shift+E` | Export recorded transforms to the clipboard (submission-ready JSON) |
| `Ctrl+Shift+[` / `]` | Cycle the active socket (correct a wrong auto-detect) |
| `Ctrl+Shift+S` | Dump a raw screen capture (for detector tuning) |

The result-notable vocabulary OCR is matched against lives in `src/poe2_vocab.json`,
generated from the main repo's PoE2 data by `pnpm extract` (or `pnpm extract:vocab`).

## Next milestones

- Submit the recorded `{jewel_type, seed, node_id, result_notable_id}` rows to the Neon
  write path (Neon Auth JWT + RLS; consensus needs ≥2 confirmations). The exported JSON
  carries `baseSkill` + `baseName`; mapping the base node to the DB's string `node_id`
  happens here.

## Caveats / known rough edges

- DPI: highlights are converted physical→CSS via `devicePixelRatio`, assuming the
  overlay covers the **primary** monitor starting at origin. Multi-monitor and
  non-primary game windows need offset handling (not yet done).
- Ring colour thresholds (`ring.rs` `Jewel::matches`) are tuned to the calibration
  screenshots; other graphics settings/filters may need adjustment. Validate a frame
  offline with `python scripts/socket_match_harness.py <screenshot.png> [socket_id]`.
- Calibrate at a zoom where enough of the ring is on-screen for the circle fit
  (zoomed-out is fine — more arc, bigger radius; extreme zoom-in pushes the ring
  off-screen). `refine_pose` then corrects any residual scale/centre error.
