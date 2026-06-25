//! Jewel-ring detection: find the colored circle a timeless jewel draws on the
//! passive tree and recover its centre + radius in image pixels.
//!
//! The ring is a 3-DOF anchor (centre x/y + radius). Combined with the calibrated
//! R_tree constant on the JS side, it fully determines the screen<->tree transform,
//! so projected node positions follow the tree under any pan/zoom. See
//! memory/poe2_overlay_calibration.md for how R_tree was measured.

/// Which jewel's ring to look for — picks the colour mask.
#[derive(Clone, Copy)]
pub enum Jewel {
    /// Undying Hate — green/yellow ring.
    UndyingHate,
    /// Heroic Tragedy — blue ring.
    HeroicTragedy,
}

impl Jewel {
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "Undying Hate" => Some(Jewel::UndyingHate),
            "Heroic Tragedy" => Some(Jewel::HeroicTragedy),
            _ => None,
        }
    }

    /// True if a pixel belongs to this jewel's ring colour. Thresholds mirror the
    /// Python calibration masks that cleanly isolated each ring.
    fn matches(self, r: i32, g: i32, b: i32) -> bool {
        match self {
            // Blue ring: blue dominant and clearly above red, reasonably bright.
            Jewel::HeroicTragedy => b > 120 && (b - r) > 50 && (b - g) > 10 && g > 40,
            // Green/yellow ring: green dominant and bright, blue suppressed.
            Jewel::UndyingHate => g > 110 && (g - b) > 35 && (g as i32 - r as i32).abs() < 90,
        }
    }
}

pub struct Circle {
    pub cx: f64,
    pub cy: f64,
    pub r: f64,
    /// Number of inlier pixels.
    pub support: usize,
    /// Fraction of 36 angular bins (10° each) containing inliers — a real ring
    /// is a near-complete circle (~1.0); scattered green tree lines cover only a
    /// small arc (low). This is the key discriminator against false positives.
    pub coverage: f64,
    /// RMS radial residual of inliers (px). Tight for a real ring.
    pub resid: f64,
}

/// Algebraic (Kåsa) circle fit: solves for centre/radius minimising the algebraic
/// distance over the given points. Cheap, closed-form, good enough as the inner
/// step of an iteratively-reweighted fit.
fn kasa(pts: &[(f64, f64)]) -> Option<(f64, f64, f64)> {
    let n = pts.len() as f64;
    if pts.len() < 3 {
        return None;
    }
    // Normal equations for [2cx, 2cy, c] in A x = b where rows are [x, y, 1], b = x^2+y^2.
    let (mut sx, mut sy, mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut sxz, mut syz, mut sz) = (0.0, 0.0, 0.0);
    for &(x, y) in pts {
        let z = x * x + y * y;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
        sxz += x * z;
        syz += y * z;
        sz += z;
    }
    // 3x3 symmetric system; solve via Cramer's rule.
    let a = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    let bb = [sxz, syz, sz];
    let det = det3(&a);
    if det.abs() < 1e-6 {
        return None;
    }
    let d = solve3(&a, &bb, det);
    let cx = d[0] / 2.0;
    let cy = d[1] / 2.0;
    let r = (d[2] + cx * cx + cy * cy).max(0.0).sqrt();
    Some((cx, cy, r))
}

fn det3(m: &[[f64; 3]; 3]) -> f64 {
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}

fn solve3(a: &[[f64; 3]; 3], b: &[f64; 3], det: f64) -> [f64; 3] {
    let mut out = [0.0; 3];
    for i in 0..3 {
        let mut m = *a;
        for r in 0..3 {
            m[r][i] = b[r];
        }
        out[i] = det3(&m) / det;
    }
    out
}

/// True for the WHITE highlight ring PoE draws around the socket when the jewel is
/// hovered (its tooltip is up). Near-white and bright: the channels are close together
/// and all high. Used only to recognise the "you're hovering the jewel" state, where the
/// colour mask finds nothing because the ring is no longer green/blue.
fn is_white(r: i32, g: i32, b: i32) -> bool {
    r > 180 && g > 180 && b > 180 && (r - g).abs() < 30 && (g - b).abs() < 30 && (r - b).abs() < 30
}

/// Detect the jewel ring in an RGBA image buffer (`width`x`height`, 4 bytes/px).
/// Returns the fitted circle in image-pixel coordinates, or None if too few ring
/// pixels were found / the fit didn't converge to a plausible circle.
pub fn detect(buf: &[u8], width: u32, height: u32, jewel: Jewel) -> Option<Circle> {
    detect_masked(buf, width, height, |r, g, b| jewel.matches(r, g, b))
}

/// Detect the white hover-highlight ring (see `is_white`). Same geometry/robustness as the
/// colour ring; lets the caller tell the user to move the cursor off the jewel.
pub fn detect_white(buf: &[u8], width: u32, height: u32) -> Option<Circle> {
    detect_masked(buf, width, height, is_white)
}

/// Ring detection over an arbitrary pixel mask. `detect`/`detect_white` are thin wrappers
/// that supply the colour or white predicate.
fn detect_masked(buf: &[u8], width: u32, height: u32, mask: impl Fn(i32, i32, i32) -> bool) -> Option<Circle> {
    let w = width as usize;
    let h = height as usize;
    // Subsample by 2 for speed; the fit is over-determined so half the pixels is plenty.
    let mut pts: Vec<(f64, f64)> = Vec::new();
    let step = 2usize;
    let mut y = 0usize;
    while y < h {
        let row = y * w * 4;
        let mut x = 0usize;
        while x < w {
            let i = row + x * 4;
            let r = buf[i] as i32;
            let g = buf[i + 1] as i32;
            let b = buf[i + 2] as i32;
            if mask(r, g, b) {
                pts.push((x as f64, y as f64));
            }
            x += step;
        }
        y += step;
    }
    if pts.len() < 200 {
        return None;
    }
    // Keep the full masked set; coverage/residual are judged against it (not the
    // shrunken inlier remnant, which can collapse to an arc and undercount coverage).
    let orig = pts.clone();

    // Robust circle fit by RANSAC. The colour mask also catches blue/green UI far
    // from the ring (the mana orb, panel text, allocated tree lines), which biases a
    // plain least-squares fit — on a real frame that produced an ~80px-off centre
    // and even mis-identified the socket. RANSAC locks onto the dominant circle (the
    // ring's thousands of co-circular points) and ignores those off-ring blobs.
    // Deterministic xorshift PRNG so detection is stable frame-to-frame.
    let n = pts.len();
    let max_r = w.max(h) as f64;
    const INLIER_BAND: f64 = 7.0; // inlier tolerance (px) around the candidate circle
    // Cap the points used to *score* candidates so the per-frame cost stays bounded
    // in the unoptimised dev build (the masked set can exceed 30k px when zoomed in,
    // and a slow frame stalls xcap's DXGI capture). The final fit still uses all pts.
    let eval: Vec<(f64, f64)> = if n > 5000 {
        pts.iter().step_by(n / 5000).copied().collect()
    } else {
        pts.clone()
    };
    // Constant seed (not derived from the pixel count, which varies frame-to-frame):
    // a fixed sampling sequence makes the fit consistent across frames, reducing jitter.
    let mut rng: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next_u64 = || {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        rng
    };
    let count_inliers = |cx: f64, cy: f64, r: f64| -> usize {
        eval.iter()
            .filter(|&&(x, y)| (((x - cx).powi(2) + (y - cy).powi(2)).sqrt() - r).abs() < INLIER_BAND)
            .count()
    };
    let (mut cx, mut cy, mut r) = (0.0, 0.0, 0.0);
    let mut best_inliers = 0usize;
    for _ in 0..250 {
        let a = pts[(next_u64() as usize) % n];
        let b = pts[(next_u64() as usize) % n];
        let c = pts[(next_u64() as usize) % n];
        let Some((ccx, ccy, cr)) = kasa(&[a, b, c]) else {
            continue;
        };
        if cr < 40.0 || cr > max_r {
            continue;
        }
        let cnt = count_inliers(ccx, ccy, cr);
        if cnt > best_inliers {
            best_inliers = cnt;
            cx = ccx;
            cy = ccy;
            r = cr;
        }
    }
    if best_inliers < 100 {
        return None;
    }
    // Polish: refit (Kåsa) on the inlier set a couple of times for sub-pixel centre.
    for _ in 0..2 {
        let inl: Vec<(f64, f64)> = pts
            .iter()
            .copied()
            .filter(|&(x, y)| (((x - cx).powi(2) + (y - cy).powi(2)).sqrt() - r).abs() < INLIER_BAND)
            .collect();
        if inl.len() < 100 {
            break;
        }
        let (ncx, ncy, nr) = kasa(&inl)?;
        cx = ncx;
        cy = ncy;
        r = nr;
    }

    // Sanity: radius must be a meaningful fraction of the frame, centre on-screen.
    if r < 40.0 || r > max_r || cx < 0.0 || cy < 0.0 {
        return None;
    }

    // OUTER-EDGE refinement. The ring is a thick band of inward-pointing tick marks, so the
    // robust band fit above sits in the noisy middle of it. The band's clean OUTER boundary is a
    // thin circle, so per angular bin we take the outermost masked pixel — but ONLY within a
    // TIGHT window around the fitted radius. A wide window swallows green/gold tree clutter just
    // OUTSIDE the ring (allocated nodes/lines), which yanks the fit off-centre (seen on a real
    // Undying frame: ~20px). The tight window keeps just the ring's outer stroke, pinning the
    // centre + radius far tighter (residual ~2px). A guard rejects the refit if it disagrees
    // with the robust band centre, so a pathological frame falls back to the band fit.
    {
        use std::f64::consts::PI;
        const NB: usize = 180;
        let (bcx, bcy) = (cx, cy); // robust band centre, to guard the refit against
        let mut outer: Vec<Option<(f64, f64, f64)>> = vec![None; NB]; // best (x, y, rad) per bin
        for &(x, y) in &orig {
            let rr = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
            // Tight window around the band radius (slightly outward-biased to the outer stroke).
            if rr < r - 6.0 || rr > r + 14.0 {
                continue;
            }
            let ang = (y - cy).atan2(x - cx);
            let bi = (((ang + PI) / (2.0 * PI)) * NB as f64) as usize % NB;
            if outer[bi].map_or(true, |(_, _, pr)| rr > pr) {
                outer[bi] = Some((x, y, rr));
            }
        }
        let edge: Vec<(f64, f64)> = outer.iter().flatten().map(|&(x, y, _)| (x, y)).collect();
        // Need most bins covered (a near-complete circle); else fall back to the band fit.
        if edge.len() >= NB / 2 {
            if let Some((mut ecx, mut ecy, mut er)) = kasa(&edge) {
                for _ in 0..2 {
                    let inl: Vec<(f64, f64)> = edge
                        .iter()
                        .copied()
                        .filter(|&(x, y)| (((x - ecx).powi(2) + (y - ecy).powi(2)).sqrt() - er).abs() < 4.0)
                        .collect();
                    if inl.len() < NB / 2 {
                        break;
                    }
                    if let Some((nx, ny, nr)) = kasa(&inl) {
                        ecx = nx;
                        ecy = ny;
                        er = nr;
                    } else {
                        break;
                    }
                }
                // Adopt only if the refit agrees with the robust band centre (a big disagreement
                // means clutter contamination → keep the band fit).
                let shift = ((ecx - bcx).powi(2) + (ecy - bcy).powi(2)).sqrt();
                if er > 40.0 && er < max_r && ecx > 0.0 && ecy > 0.0 && shift < 15.0 {
                    cx = ecx;
                    cy = ecy;
                    r = er;
                }
            }
        }
    }

    // Angular coverage + residual over ALL masked pixels that lie on the final
    // circle (within a band), to reject non-ring blobs (gold/green tree lines the
    // colour mask catches but that don't form a full circle). Judged on `orig`,
    // not the shrunken IRLS set. The ring is a band of inward TICK MARKS with gaps
    // between them, so we use coarse 30° bins (12) — a fine grid would land in the
    // gaps and undercount. Band is wide because the tick ring is thick.
    const NBINS: usize = 12;
    const BAND: f64 = 22.0;
    let mut bins = [false; NBINS];
    let mut sum2 = 0.0;
    let mut on_ring = 0usize;
    for &(x, y) in &orig {
        let rr = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
        if (rr - r).abs() > BAND {
            continue;
        }
        let ang = (y - cy).atan2(x - cx); // -pi..pi
        let mut b =
            ((ang + std::f64::consts::PI) / (2.0 * std::f64::consts::PI) * NBINS as f64) as usize;
        if b >= NBINS {
            b = NBINS - 1;
        }
        bins[b] = true;
        sum2 += (rr - r) * (rr - r);
        on_ring += 1;
    }
    if on_ring < 100 {
        return None;
    }
    let coverage = bins.iter().filter(|&&v| v).count() as f64 / NBINS as f64;
    let resid = (sum2 / on_ring as f64).sqrt();

    // A genuine ring spans (nearly) the whole circle: real rings measured ~0.75-0.83
    // coverage, the worst green-line false positive ~0.33. We accept down to 0.5 so a
    // tooltip overlapping part of the ring (which blanks an arc) still detects — that's
    // still well clear of the ~0.33 false-positive ceiling. Residual stays lenient
    // (the tick band is thick); jewel selection by inlier support guards false positives.
    if coverage < 0.5 || resid > 28.0 {
        return None;
    }

    Some(Circle {
        cx,
        cy,
        r,
        support: on_ring,
        coverage,
        resid,
    })
}
