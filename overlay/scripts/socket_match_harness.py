"""Offline go/no-go harness for PoE2 jewel-socket identification.

Mirrors the eventual Rust pipeline (imageproc Canny + distance_transform) using
OpenCV so we can validate, on screenshots that already exist, whether scoring the
14 known socket subgraphs by *edge-chamfer distance* cleanly picks the right socket
BEFORE writing any Rust.

Pipeline per screenshot:
  1. Detect the jewel ring (port of src-tauri/src/ring.rs colour-mask + Kasa/IRLS
     fit) -> (cx, cy, r). This gives the known scale+translation transform.
  2. Canny edge map -> distance transform (each px = distance to nearest edge).
  3. For each of the 14 sockets, project its subgraph (nodes / edges) via
        screen = ring_centre + (node_tree - socket_tree) * (r / R_tree)
     and score mean DT under the projected geometry. Lowest = best fit.
  4. Rank, print, report the gap to runner-up.

Usage: python socket_match_harness.py <screenshot.png> [expected_socket_id]
"""

import sys
import json
import os
import math
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
GRAPHS = os.path.join(HERE, "..", "src", "poe2_socket_graphs.json")


# ---------------------------------------------------------------------------
# Ring detection — port of src-tauri/src/ring.rs
# ---------------------------------------------------------------------------
def ring_mask(rgb, jewel):
    r = rgb[:, :, 0].astype(np.int32)
    g = rgb[:, :, 1].astype(np.int32)
    b = rgb[:, :, 2].astype(np.int32)
    if jewel == "Heroic Tragedy":  # blue
        return (b > 120) & ((b - r) > 50) & ((b - g) > 10) & (g > 40)
    else:  # Undying Hate, green/yellow
        return (g > 110) & ((g - b) > 35) & (np.abs(g - r) < 90)


def kasa(pts):
    """Algebraic circle fit. pts: Nx2 float array. -> (cx, cy, r) or None."""
    if len(pts) < 3:
        return None
    x = pts[:, 0]
    y = pts[:, 1]
    z = x * x + y * y
    A = np.stack([x, y, np.ones_like(x)], axis=1)
    # Solve A @ [2cx,2cy,c] = z  (least squares)
    sol, *_ = np.linalg.lstsq(A, z, rcond=None)
    cx, cy = sol[0] / 2.0, sol[1] / 2.0
    r2 = sol[2] + cx * cx + cy * cy
    if r2 < 0:
        return None
    return cx, cy, math.sqrt(r2)


def detect_ring(rgb, jewel):
    h, w = rgb.shape[:2]
    mask = ring_mask(rgb, jewel)
    ys, xs = np.nonzero(mask)
    if len(xs) < 200:
        return None
    pts = np.stack([xs, ys], axis=1).astype(np.float64)
    orig = pts.copy()
    # Robust RANSAC circle fit (mirrors src-tauri/src/ring.rs): the colour mask also
    # catches blue/green UI (mana orb, panel) far from the ring, which biases a plain
    # least-squares fit. RANSAC locks onto the dominant circle and ignores the blobs.
    n = len(pts)
    max_r = max(w, h)
    band = 7.0
    rng = np.random.default_rng(0x9E3779B9)
    best = (0, 0.0, 0.0, 0.0)
    for _ in range(400):
        idx = rng.choice(n, 3, replace=False)
        fit = kasa(pts[idx])
        if fit is None:
            continue
        ccx, ccy, cr = fit
        if cr < 40 or cr > max_r:
            continue
        cnt = int((np.abs(np.hypot(pts[:, 0] - ccx, pts[:, 1] - ccy) - cr) < band).sum())
        if cnt > best[0]:
            best = (cnt, ccx, ccy, cr)
    if best[0] < 100:
        return None
    _, cx, cy, r = best
    for _ in range(2):  # polish on inliers
        keep = np.abs(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) - r) < band
        if keep.sum() < 100:
            break
        fit = kasa(pts[keep])
        if fit is None:
            break
        cx, cy, r = fit
    if r < 40 or r > max_r or cx < 0 or cy < 0:
        return None
    # Coverage + residual over ALL masked px within a band of the final circle.
    rr = np.hypot(orig[:, 0] - cx, orig[:, 1] - cy)
    on = np.abs(rr - r) < 22.0
    if on.sum() < 100:
        return None
    ang = np.arctan2(orig[on, 1] - cy, orig[on, 0] - cx)
    bins = ((ang + math.pi) / (2 * math.pi) * 12).astype(int)
    bins = np.clip(bins, 0, 11)
    coverage = len(np.unique(bins)) / 12.0
    resid = math.sqrt(((rr[on] - r) ** 2).mean())
    if coverage < 0.6 or resid > 28.0:
        return None
    return dict(cx=cx, cy=cy, r=r, coverage=coverage, resid=resid, support=int(on.sum()))


def best_ring(rgb):
    # Both colours already pass the coverage/resid gates in detect_ring; pick the one
    # with the most inlier support. A small spurious blob can saturate coverage, but
    # only the real ring has tens of thousands of co-circular points.
    best = None
    for jewel in ("Undying Hate", "Heroic Tragedy"):
        c = detect_ring(rgb, jewel)
        if c is None:
            continue
        c["jewel"] = jewel
        if best is None or c["support"] > best["support"]:
            best = c
    return best


# ---------------------------------------------------------------------------
# Edge map + distance transform + chamfer scoring
# ---------------------------------------------------------------------------
def build_dt(gray):
    edges = cv2.Canny(gray, 60, 160)
    # distanceTransform: distance to nearest ZERO px, so invert (edges -> 0).
    inv = np.where(edges > 0, np.uint8(0), np.uint8(255))
    dt = cv2.distanceTransform(inv, cv2.DIST_L2, 3)
    return edges, dt


def sample_dt(dt, x, y):
    h, w = dt.shape
    xi, yi = int(round(x)), int(round(y))
    if xi < 0 or yi < 0 or xi >= w or yi >= h:
        return None
    return float(dt[yi, xi])


def score_nodes(dt, ring, sock, r_tree):
    s = ring["r"] / r_tree
    cx, cy, r = ring["cx"], ring["cy"], ring["r"]
    vals = []
    for (nx, ny) in sock["nodes"]:
        px = cx + (nx - sock["x"]) * s
        py = cy + (ny - sock["y"]) * s
        if math.hypot(px - cx, py - cy) > r:  # only nodes inside the ring
            continue
        v = sample_dt(dt, px, py)
        if v is not None:
            vals.append(v)
    return (sum(vals) / len(vals), len(vals)) if vals else (1e9, 0)


def score_edges(dt, ring, sock, r_tree, step_px=6.0):
    s = ring["r"] / r_tree
    cx, cy, r = ring["cx"], ring["cy"], ring["r"]
    vals = []
    for (x1, y1, x2, y2) in sock["edges"]:
        ax, ay = cx + (x1 - sock["x"]) * s, cy + (y1 - sock["y"]) * s
        bx, by = cx + (x2 - sock["x"]) * s, cy + (y2 - sock["y"]) * s
        seglen = math.hypot(bx - ax, by - ay)
        n = max(2, int(seglen / step_px))
        for i in range(n + 1):
            t = i / n
            px, py = ax + (bx - ax) * t, ay + (by - ay) * t
            if math.hypot(px - cx, py - cy) > r:
                continue
            v = sample_dt(dt, px, py)
            if v is not None:
                vals.append(v)
    return (sum(vals) / len(vals), len(vals)) if vals else (1e9, 0)


# ---------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        print("usage: socket_match_harness.py <screenshot.png> [expected_socket_id]")
        sys.exit(2)
    path = sys.argv[1]
    expected = None
    ring_override = None
    for a in sys.argv[2:]:
        if a.startswith("--ring="):
            parts = a[len("--ring="):].split(",")
            ring_override = dict(
                cx=float(parts[0]), cy=float(parts[1]), r=float(parts[2]),
                jewel=parts[3] if len(parts) > 3 else "?",
                coverage=1.0, resid=0.0, support=0,
            )
        else:
            expected = int(a)

    data = json.load(open(GRAPHS))
    r_tree = data["rTree"]
    sockets = data["sockets"]

    bgr = cv2.imread(path)
    if bgr is None:
        print(f"cannot read {path}")
        sys.exit(1)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    ring = ring_override if ring_override else best_ring(rgb)
    print(f"\n=== {os.path.basename(path)}  ({w}x{h}) ===")
    if ring is None:
        print("  NO RING DETECTED")
        return
    print(
        f"  ring: {ring['jewel']}  c=({ring['cx']:.1f},{ring['cy']:.1f}) r={ring['r']:.1f} "
        f"cov={ring['coverage']*100:.0f}% resid={ring['resid']:.1f} s={ring['r']/r_tree:.4f}"
    )

    _, dt = build_dt(gray)

    rows = []
    for sock in sockets:
        nmean, nN = score_nodes(dt, ring, sock, r_tree)
        emean, eN = score_edges(dt, ring, sock, r_tree)
        rows.append((sock["socketId"], sock["id"], nmean, nN, emean, eN))

    def report(metric_idx, label):
        order = sorted(rows, key=lambda x: x[metric_idx])
        print(f"\n  -- ranked by {label} (lower=better) --")
        for rank, row in enumerate(order[:5]):
            sid, sid_name, nm, nN, em, eN = row
            n = nN if metric_idx == 2 else eN
            star = " <-- EXPECTED" if expected is not None and sid == expected else ""
            print(f"   {rank+1}. {sid:>6} {sid_name:<26} {row[metric_idx]:7.2f}  (n={n}){star}")
        best, second = order[0][metric_idx], order[1][metric_idx]
        gap = (second - best) / best * 100 if best > 0 else 0
        winner = order[0][0]
        ok = (expected is None) or (winner == expected)
        rank_exp = next((i + 1 for i, r in enumerate(order) if r[0] == expected), None)
        tag = "OK" if ok else f"WRONG (expected rank {rank_exp})"
        print(f"   winner={winner}  gap_to_2nd={gap:.1f}%  [{tag}]")
        return ok, gap

    report(2, "NODE chamfer")
    report(4, "EDGE chamfer")


if __name__ == "__main__":
    main()
