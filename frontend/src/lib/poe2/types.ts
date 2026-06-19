// Types mirroring the Neon PoE2 schema (project Poe2-Timeless-Jewel) and the
// shapes returned by the Worker /api/poe2/* endpoints.

/** A PoE2 timeless jewel type with its seed range and conqueror list. */
export interface Poe2Jewel {
  id: string;
  name: string;
  seed_min: number;
  seed_max: number;
  conquerors: string[];
}

/** A base passive-tree notable that a jewel can transform (tree_notables). */
export interface TreeNotable {
  node_id: string;
  name: string;
}

/** A possible result notable for a given jewel (vocab_notables). */
export interface VocabNotable {
  id: string;
  name: string;
}

/** Reference data backing the contribution form for one jewel. */
export interface Poe2Reference {
  jewel: string;
  treeNotables: TreeNotable[];
  vocabNotables: VocabNotable[];
}

/**
 * One community-consensus transform for a (jewel, seed): a base node becomes a
 * result notable, backed by N distinct-client confirmations. `verified` is true
 * once at least two independent clients agree (catalog_consensus view).
 */
export interface ConsensusRow {
  node_id: string;
  node_name: string;
  result_notable_id: string;
  result_notable_name: string;
  confirmations: number;
  verified: boolean;
  last_seen: string;
}

export interface ConsensusResult {
  jewel: string;
  seed: number;
  results: ConsensusRow[];
}

/** A single observation a contributor submits (one vote). */
export interface ObservationInput {
  jewel_type: string;
  conqueror?: string | null;
  seed: number;
  node_id: string;
  result_notable_id: string;
  source_socket?: number | null;
}
