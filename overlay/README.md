# PoE2 Jewel Capture Overlay (contributor tool)

A small desktop overlay that helps **contributors** record what a socketed PoE2
timeless jewel transforms each notable into, so the data can be submitted to the
community DB. It is **not** needed by people who only *look up* seeds — they use
the website. This tool is intentionally separate and optional.

> **Status: scaffold.** This milestone proves the hard part — drawing highlights
> that stay locked onto the correct in-game passive nodes as you pan and zoom.
> Reading the transformed notable from the tooltip (OCR) is the next milestone;
> for now, advancing through nodes just records "visited".

## How it works

A timeless jewel draws a colored ring around its socket on the passive tree. That
ring is a 3-DOF anchor (centre x/y + radius). Detecting it each frame recovers the
screen→tree transform in closed form:

```
screen = ring_centre + (node_tree − socket_tree) · (ring.r / R_tree)
```

`R_tree ≈ 1765` tree units was calibrated from the in-game ring against two
screenshots at different zooms (Undying Hate green ring and Heroic Tragedy blue
ring agreed to within ~1.6%). Because the ring is re-detected every frame, pan and
zoom are absorbed automatically — no per-zoom calibration. See
`../memory/poe2_overlay_calibration.md` (and `Screenshots/`) for the derivation.

- **Rust** (`src-tauri/`): screen capture (`xcap`), ring detection (`ring.rs`,
  color-mask + iterative circle fit), **socket auto-identification** (`main.rs`:
  Sobel edge map → chamfer distance transform → score the 14 sockets' projected
  connector edges, lowest-cost wins), global cursor position, global hotkeys, and
  a transparent click-through always-on-top window.
- **TypeScript** (`src/`): projects the socket's affected notables to screen
  (`projection.ts`) and draws the highlights/guide (`main.ts`). The per-socket
  node data is extracted from the main repo's `frontend/static/data/poe2/data.json`
  into `src/poe2_sockets.json` (notables, for highlighting) and
  `src/poe2_socket_graphs.json` (nodes + edges, for socket matching) — run
  `pnpm extract`.

### Socket auto-identification

The ring fixes the screen↔tree transform, but not *which* of the 14 sockets it is.
Node icon **art changes** under a timeless jewel, so icons are unreliable; node
**positions and the connector lines** between them do not. So for each socket we
project its local subgraph through the ring transform and score the mean
distance-transform value under the projected edges (chamfer matching) — the socket
whose edges line up with the real tree lines scores lowest. The UI resolves the
socket once (confident frames only; otherwise you cycle manually) and then locks
it, so steady-state frames pay only the cheap ring transform. The approach was
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

1. Launch the overlay. The control panel (top-left) is interactive.
2. Pick the **jewel** (sets the ring color to detect) and the **socket** you used.
3. Open the passive tree in PoE2 with the jewel socketed; zoom so the ring is
   visible.
4. Click **Start capture** — the overlay becomes click-through and draws the ring
   guide plus a highlight on each affected notable. The current target is gold.
5. Hover the highlighted node in-game; press **Ctrl+Shift+J** to record it and
   advance. Press **Ctrl+Shift+O** to toggle click-through (to reach the panel).

## Hotkeys

| Key | Action |
|---|---|
| `Ctrl+Shift+J` | Record current target node, advance to next |
| `Ctrl+Shift+O` | Toggle click-through (capture mode ↔ panel) |

## Next milestones (not in this scaffold)

- OCR the tooltip header on capture, fuzzy-match to the closed vocab
  (37 Kalguur / 51 Abyss notables), to record what each node *became*.
- Parse seed/variant from the jewel's Ctrl+C clipboard text.
- Submit `{jewel_type, seed, node_id, result_notable_id}` rows to the Neon write
  path (consensus needs ≥2 confirmations).

## Caveats / known rough edges

- DPI: highlights are converted physical→CSS via `devicePixelRatio`, assuming the
  overlay covers the **primary** monitor starting at origin. Multi-monitor and
  non-primary game windows need offset handling (not yet done).
- Ring color thresholds are tuned to the two calibration screenshots; other
  graphics settings/filters may need adjustment in `ring.rs`.
