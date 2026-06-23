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
