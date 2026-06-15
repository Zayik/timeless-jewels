# timeless-jewels — Claude Project Instructions

## What This Project Is

A Path of Exile timeless jewel tool that shows players how a jewel transforms nearby passive tree nodes. PoE1 uses a deterministic algorithm (TinyMT32 PRNG) to calculate transformations from a jewel's seed number. A planned PoE2 version will use a community-recorded database instead.

See `C:\Users\genol\.claude\plans\please-help-me-create-cozy-crab.md` for the full modernization roadmap.

---

## PoE Terminology Glossary

| Term | Meaning |
|---|---|
| **Timeless Jewel** | A Unique jewel placed in special passive tree sockets; transforms nearby passive nodes |
| **Seed** | Integer inscribed on the jewel (e.g. 4000). Deterministically controls all transformations for PoE1 |
| **Notable** | A named passive skill node (e.g. "Revenge of the Hunted"). Distinct from small filler nodes |
| **Small passive** | Generic unnamed node (e.g. "+10 Strength", "5% increased Life") |
| **Keystone** | A major unique passive (e.g. "Acrobatics"). Always replaced by a jewel, never augmented |
| **Conqueror** | Named NPC variant of a jewel — determines which alternate passive pool is used |
| **AlternatePassiveSkill** | The replacement notable a node becomes under jewel influence |
| **AlternatePassiveAddition** | Bonus effects added to nodes (not replacements — stacks on top) |
| **Jewel Socket** | Fixed passive tree location where timeless jewels can be placed; defines radius of effect |
| **Passive Graph ID** | PoE's internal node ID (integer). Different from display index. Used as map key throughout |
| **Scion** | The character class whose starting position is used as reference for Jewel Socket locations |
| **ReverseSearch** | Finding which seeds produce a desired stat on a given node |
| **MassReverseSearch** | ReverseSearch across multiple jewel socket locations simultaneously |

### Jewel Types and Their Conquerors

| Jewel | Conquerors | Seed Range |
|---|---|---|
| Glorious Vanity | Xibaqua, Zerphi, Ahuana, Doryani | 100–8000 |
| Lethal Pride | Kiloava, Akoya, Rakiata, Kaom | 100–8000 |
| Brutal Restraint | Deshret, Asenath, Nasima | 500–8000 |
| Elegant Hubris | Cadiro, Victario, Caspiro, Colo | 2000–160000 (÷20 internally) |
| Militant Faith | Avarius, Dominus, Maxarius, Chitus | 100–8000 |

Conqueror matters for: (1) which alternate passive pool applies, and (2) building trade API filter URLs. For search results, it often doesn't change the outcome much — de-emphasize it in the UI.

---

## File Map

The calculation engine is now pure TypeScript — the Go/WASM backend has been
removed (verified bit-for-bit against the old Go reference before deletion).

```
timeless-jewels/
├── worker/                        # Cloudflare Worker (CORS proxy for PoE trade API)
│   ├── src/index.ts
│   └── wrangler.toml
│
├── frontend/
│   ├── static/data/               # Game data (gzip JSON) — source of truth, fetched at runtime
│   │   ├── SkillTree.json.gz      # From grindinggear/skilltree-export
│   │   └── *.json.gz              # From go-pob-data (passive skills, stats, alt passives)
│   └── src/
│       ├── routes/
│       │   ├── +page.svelte       # MAIN UI — state orchestration + results
│       │   └── +layout.svelte
│       └── lib/
│           ├── calculator/        # TypeScript calculation engine (replaced Go/WASM)
│           │   ├── random.ts      # TinyMT32 PRNG (uint32 math via >>> 0)
│           │   ├── tree_manager.ts # isPassiveSkillReplaced / replace / augment
│           │   ├── index.ts       # Calculate, ReverseSearch, MassReverseSearch
│           │   ├── data.ts        # fetch + DecompressionStream loader, lookup maps
│           │   └── types.ts       # Core types: PassiveSkill, AlternatePassiveSkill, Stat
│           ├── components/
│           │   ├── SkillTree.svelte       # Canvas-based passive tree renderer
│           │   ├── MarketPanel.svelte     # Trade API / live feed / seed list
│           │   ├── SearchConfigPanel.svelte # Jewel/conqueror/stat selection + buttons
│           │   ├── SearchResult.svelte
│           │   └── SearchResults.svelte
│           ├── skill_tree.ts      # Sprite loading, canvas math, node rendering
│           ├── skill_tree_types.ts # TypeScript types for tree structure
│           ├── worker.ts          # Web Worker pool management via Comlink (cap: 8)
│           ├── sync_worker.ts     # Per-worker search entry point
│           ├── trade.ts           # Trade URL query construction
│           ├── trade_api.ts       # PoE trade API: HTTP + WebSocket, rate limiting
│           ├── market_cache.ts    # localStorage-backed market data cache
│           ├── storageManager.ts  # localStorage abstraction
│           ├── values.ts          # Constants and configuration
│           └── types/index.ts     # Re-exports calculator + data for app code
│
├── update_assets.sh               # Fetch new game data into frontend/static/data
├── dev.ps1                        # Dev server
├── test.ps1                       # Frontend type-check + lint
└── setup.ps1                      # One-time environment setup
```

---

## Build & Dev Commands

```powershell
# Development
./dev.ps1                          # Start frontend dev server (http://localhost:5173)

# Build (static site for GitHub Pages)
cd frontend && pnpm run build      # SvelteKit + adapter-static -> frontend/build

# Checks
./test.ps1                         # Frontend type-check + lint
cd frontend && pnpm run check      # TypeScript + svelte-check
cd frontend && pnpm run lint       # Prettier + ESLint

# Update game data (run when a new PoE patch drops)
./update_assets.sh <tree_version> <game_version>
# Example: ./update_assets.sh 3.25.0 3.25
# Writes straight into frontend/static/data/ — no codegen step.
```

---

## Architecture: Current vs Target

| Layer | Current | Target |
|---|---|---|
| Calculation | TypeScript (TinyMT32 port) ✅ | TypeScript (TinyMT32 port) |
| UI framework | SvelteKit + Svelte 5 (Runes) ✅ | SvelteKit + Svelte 5 (Runes) |
| Parallelism | Web Worker pool (cap 8), real OS threads ✅ | Worker pool, real OS threads |
| State management | Svelte 5 `$state` (mostly migrated) | Svelte 5 `$state` stores |
| Data loading | TypeScript `fetch()` + `DecompressionStream` ✅ | TypeScript `fetch()` + `DecompressionStream` |
| PoE2 data | N/A | Neon (Postgres) via Cloudflare Worker API |
| Hosting (PoE1) | GitHub Pages | GitHub Pages (unchanged) |
| Hosting (PoE2) | N/A | Vercel + real domain (poe2.timeless-jewels.com) |

PoE1 and PoE2 are **separate apps** — no shared data layer abstraction (YAGNI). They share UI components (SkillTree.svelte, SearchResult.svelte) but have completely different data pipelines.

---

## Testing Strategy

### Functional correctness (PoE1 calculator)
The TS port was verified bit-for-bit against the original Go engine before the Go
code was removed (digest comparison over ~1M `Calculate` results across all jewels,
conquerors, and seed ranges — 0 mismatches). If the algorithm or game data changes,
re-verify against known-good seeds (e.g. GloriousVanity, Xibaqua, seed 2000) using
community-documented transforms, since the Go oracle no longer exists.

### UI verification
Use the `claude-in-chrome` MCP browser automation tools:
```
1. Start dev server: ./dev.ps1
2. Use mcp__claude-in-chrome__navigate to http://localhost:5173
3. Screenshot with mcp__claude-in-chrome__computer
4. Interact with mcp__claude-in-chrome__find + click
```
Always test at 1280px width (desktop) and 768px (tablet). The skill tree canvas is the trickiest — zoom/pan and node highlighting must work.

### Build verification
```powershell
cd frontend && pnpm run build      # Must succeed with no errors
cd frontend && pnpm run check      # Must have 0 type errors
```

---

## Key Constraints

- **PoE1 must stay on GitHub Pages** — no server required, purely static. All calculation happens client-side in TypeScript Web Workers.
- **No Go or WASM** — the Go backend and WASM build have been removed; everything is TypeScript.
- **Cloudflare Worker** has a 1MB bundle limit and no Node.js APIs — use `@neondatabase/serverless` (not `pg`) for Neon queries.
- **Rate limit respect** — The PoE trade API has strict rate limits. `trade_api.ts` handles this; do not bypass or simplify the rate limiting logic.
- **Data update workflow** — When GGG patches the game, run `update_assets.sh <tree_version> <game_version>`; it writes the gzip JSON straight into `frontend/static/data/`, which `calculator/data.ts` fetches at runtime. No codegen.

---

## Common Tasks

### Add a new jewel type
1. `frontend/src/lib/calculator/data.ts` — add to `TIMELESS_JEWEL_CONQUERORS` and `TIMELESS_JEWEL_SEED_RANGES`
2. `frontend/src/lib/values.ts` — add display name

### Update for a new PoE patch
```bash
./update_assets.sh <new_tree_version> <new_game_version>   # writes into frontend/static/data/
```

### Debug a calculation mismatch
- Check `frontend/src/lib/calculator/random.ts` (TinyMT32 constants: `InitialStateConstant0-3`, `TinyMT32Alpha/Bravo`); all arithmetic forces uint32 via `>>> 0`
- Check `frontend/src/lib/calculator/tree_manager.ts` `isPassiveSkillReplaced` — the spawn weight logic determines replacement probability
- The TS engine was verified bit-for-bit against the old Go reference (~1M Calculate computations, 0 mismatches) before the Go code was removed

### Verify UI change
Start dev server, use `claude-in-chrome` browser automation to screenshot the result. Claude cannot visually verify UI changes without the browser automation tools loaded.
