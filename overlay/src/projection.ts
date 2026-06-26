// Screen<->tree projection for the capture overlay.
//
// A detected jewel ring is a 3-DOF anchor: its centre is the socket's tree
// position projected to the screen, and its pixel radius over R_tree gives the
// zoom. From those three numbers every affected node maps to a screen pixel:
//
//   screen = ring_centre + (node_tree - socket_tree) * (ring.r / R_tree)
//
// (ysign = +1: tree-y and screen-y both increase downward.) Because the ring is
// re-detected each frame, pan/zoom are absorbed automatically. R_tree was
// calibrated from the in-game ring; see memory/poe2_overlay_calibration.md.

export interface Ring {
  cx: number;
  cy: number;
  r: number;
  support: number;
  frame_w: number;
  frame_h: number;
}

export interface TreePoint {
  x: number;
  y: number;
}

export interface Notable extends TreePoint {
  skill: number;
  /** String node id (e.g. "Sprint10") — the community DB's tree_notables.node_id. */
  id: string;
  name: string;
  kind: 'notable' | 'keystone';
  /** True for Druid-Oracle-only nodes (behind "The Unseen Path"). A non-Oracle character can't
   *  allocate them, so the overlay skips them as capture targets unless the player marks
   *  themselves a Druid Oracle. Omitted (falsy) for normal nodes. */
  oracleOnly?: boolean;
}

export interface Socket extends TreePoint {
  socketId: number;
  id: string;
  notables: Notable[];
}

export interface SocketData {
  rTree: number;
  sockets: Socket[];
}

/** A node projected to the webview's CSS pixel space, ready to draw. */
export interface ProjectedNode {
  notable: Notable;
  /** CSS px within the overlay window. */
  sx: number;
  sy: number;
}

/**
 * Project a socket's affected notables to overlay CSS pixels.
 *
 * The ring is in captured (physical) px starting at the primary monitor origin.
 * The fullscreen overlay's CSS space is physical / devicePixelRatio, so we divide
 * by `dpr` after applying the tree->screen transform.
 */
export function projectNotables(
  ring: Ring,
  socket: Socket,
  rTree: number,
  dpr: number
): ProjectedNode[] {
  const s = ring.r / rTree; // physical px per tree unit
  return socket.notables.map((n) => {
    const px = ring.cx + (n.x - socket.x) * s;
    const py = ring.cy + (n.y - socket.y) * s;
    return { notable: n, sx: px / dpr, sy: py / dpr };
  });
}

/**
 * Order a socket's notables into a greedy nearest-neighbor path so consecutive
 * nodes are physically close on screen (no jumping across the ring). Seeded at the
 * node nearest the socket centre, then each step picks the nearest unvisited node.
 * Computed in tree coords — valid for screen too, since screen is a uniform
 * scale+translate of tree space.
 */
export function orderNotablesNearest(socket: Socket): Notable[] {
  const remaining = [...socket.notables];
  if (remaining.length <= 2) return remaining;
  const path: Notable[] = [];
  // Seed: nearest to the socket centre (matches the "start near the jewel" mental model).
  let curX = socket.x;
  let curY = socket.y;
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].x - curX, remaining[i].y - curY);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const n = remaining.splice(best, 1)[0];
    path.push(n);
    curX = n.x;
    curY = n.y;
  }
  return path;
}

/** Ring centre/radius converted to overlay CSS px (for drawing the ring guide). */
export function ringInCss(ring: Ring, dpr: number): { cx: number; cy: number; r: number } {
  return { cx: ring.cx / dpr, cy: ring.cy / dpr, r: ring.r / dpr };
}

/**
 * Nearest projected node to a cursor position, gated by a max distance so that
 * "cursor between nodes" returns null rather than guessing a wrong node.
 *
 * `cursorPhysical` is the global cursor in physical px; `nodes` are in CSS px, so
 * we compare in CSS px. The gate scales with the on-screen node spacing (derived
 * from the ring radius) so it adapts to zoom.
 */
export function nearestNode(
  nodes: ProjectedNode[],
  cursorPhysical: { x: number; y: number },
  dpr: number,
  gateCss: number
): ProjectedNode | null {
  const cx = cursorPhysical.x / dpr;
  const cy = cursorPhysical.y / dpr;
  let best: ProjectedNode | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.sx - cx, n.sy - cy);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best && bestD <= gateCss ? best : null;
}
