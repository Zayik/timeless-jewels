// Resolve an OCR'd tooltip into one of a jewel's known result notables. The result
// vocabulary is a small closed set per jewel, so even noisy OCR resolves to the right
// name by fuzzy similarity — and the matched id (e.g. "kalguur_notable19") is the DB's
// vocab_notables.id used for the eventual submission.

/** One result-notable candidate (from poe2_vocab.json). */
export interface Vocab {
  id: string;
  name: string;
}

/** A line returned by the Rust `ocr_region` command (centre in physical px). */
export interface OcrLine {
  text: string;
  cx: number;
  cy: number;
}

export interface Match {
  id: string;
  name: string;
  /** Best similarity in 0..1. */
  confidence: number;
}

/** Lowercase, drop punctuation, collapse whitespace — so OCR/casing noise doesn't matter. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein edit distance between two strings (iterative, single row). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

/** Similarity in 0..1: 1 = identical, 0 = fully different (normalised edit distance). */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 0;
  return 1 - levenshtein(na, nb) / maxLen;
}

/**
 * Best vocabulary match across all OCR lines.
 *
 * Each line is scored against every vocab entry; the highest similarity wins. When two
 * lines match equally well, the one nearest the hovered node (`targetPhysical`, in
 * physical px to match the line centres) wins — so a name appearing elsewhere on screen
 * loses to the one in the tooltip over the node. Returns null if nothing is above
 * `floor` (default 0.6; the caller applies the accept/confirm tiers).
 */
export function matchNotable(
  lines: OcrLine[],
  vocab: Vocab[],
  targetPhysical: { x: number; y: number },
  floor = 0.6
): Match | null {
  let best: (Match & { dist: number }) | null = null;
  for (const line of lines) {
    const dist = Math.hypot(line.cx - targetPhysical.x, line.cy - targetPhysical.y);
    for (const v of vocab) {
      const confidence = similarity(line.text, v.name);
      if (confidence < floor) continue;
      const better =
        !best ||
        confidence > best.confidence + 1e-6 ||
        (Math.abs(confidence - best.confidence) <= 1e-6 && dist < best.dist);
      if (better) best = { id: v.id, name: v.name, confidence, dist };
    }
  }
  return best ? { id: best.id, name: best.name, confidence: best.confidence } : null;
}
