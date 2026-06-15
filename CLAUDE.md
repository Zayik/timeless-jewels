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

```
timeless-jewels/
├── data/                          # Game data (Go structs + gzip JSON) — source of truth
│   ├── types.go                   # Core types: PassiveSkill, AlternatePassiveSkill, Stat
│   ├── jewels.go                  # Conqueror mappings, seed ranges
│   ├── main.go                    # init(): decompress + load all JSON into memory maps
│   ├── manager.go                 # Lookup functions (GetApplicablePassives, etc.)
│   ├── SkillTree.json.gz          # From grindinggear/skilltree-export
│   └── *.json.gz                  # From go-pob-data (passive skills, stats, alt passives)
│
├── calculator/                    # Go calculation engine (to be ported to TypeScript)
│   ├── main.go                    # Calculate, ReverseSearch, MassReverseSearch
│   └── tree_manager.go            # IsPassiveSkillReplaced, ReplacePassiveSkill, AugmentPassiveSkill
│
├── random/                        # TinyMT32 PRNG (to be ported to TypeScript)
│   └── main.go
│
├── wasm/                          # WebAssembly entry point (to be removed)
│   ├── main.go
│   └── exposition/                # Exposes Go functions to JavaScript via crystalline
│
├── worker/                        # Cloudflare Worker (CORS proxy for PoE trade API)
│   ├── src/index.ts
│   └── wrangler.toml
│
├── frontend/src/
│   ├── routes/
│   │   ├── +page.svelte           # MAIN UI — 1475 lines, god component, needs splitting
│   │   └── +layout.svelte
│   └── lib/
│       ├── calculator/            # (TO CREATE) TypeScript calculator replacing Go/WASM
│       ├── components/
│       │   ├── SkillTree.svelte   # Canvas-based passive tree renderer
│       │   ├── SearchResult.svelte
│       │   └── SearchResults.svelte
│       ├── skill_tree.ts          # Sprite loading, canvas math, node rendering
│       ├── skill_tree_types.ts    # TypeScript types for tree structure
│       ├── worker.ts              # Web Worker management via Comlink
│       ├── sync_worker.ts         # Synchronous worker operations
│       ├── trade.ts               # Trade URL query construction
│       ├── trade_api.ts           # PoE trade API: HTTP + WebSocket, rate limiting
│       ├── market_cache.ts        # localStorage-backed market data cache
│       ├── values.ts              # Constants and configuration
│       └── types/                 # Auto-generated from Go WASM exposition
│           ├── index.js
│           └── index.d.ts
│
├── update_assets.sh               # Fetch new game data from grindinggear + go-pob-data
├── build.ps1                      # Full build (WASM + frontend)
├── dev.ps1                        # Dev server
└── test.ps1                       # Go tests
```

---

## Build & Dev Commands

```powershell
# Development
./dev.ps1                          # Start frontend dev server (http://localhost:5173)

# Build
./build.ps1                        # Build WASM + SvelteKit static site

# Tests
./test.ps1                         # Run Go tests
cd frontend && pnpm run check      # TypeScript + svelte-check
cd frontend && pnpm run lint       # ESLint + Prettier

# Update game data (run when a new PoE patch drops)
./update_assets.sh <tree_version> <game_version>
# Example: ./update_assets.sh 3.25.0 3.25
# Then regenerate types: go generate -tags tools -x ./...
```

---

## Architecture: Current vs Target

| Layer | Current | Target |
|---|---|---|
| Calculation | Go compiled to WebAssembly | TypeScript (TinyMT32 port) |
| UI framework | SvelteKit 4 | SvelteKit + Svelte 5 (Runes) |
| Parallelism | Single WASM worker (cooperative goroutines) | Worker pool per socket (real OS threads) |
| State management | 275 scattered variables in +page.svelte | Svelte 5 `$state` stores |
| Data loading | Go `init()` decompresses gzip JSON | TypeScript `fetch()` + `DecompressionStream` |
| PoE2 data | N/A | Neon (Postgres) via Cloudflare Worker API |
| Hosting (PoE1) | GitHub Pages (keep) | GitHub Pages (unchanged) |
| Hosting (PoE2) | N/A | Vercel + real domain (poe2.timeless-jewels.com) |

PoE1 and PoE2 are **separate apps** — no shared data layer abstraction (YAGNI). They share UI components (SkillTree.svelte, SearchResult.svelte) but have completely different data pipelines.

---

## Testing Strategy

### Functional correctness (PoE1 calculator)
After porting TinyMT32 to TypeScript, verify against known-good seeds:
- GloriousVanity, Xibaqua, seed 4000 → check 3+ notable transforms against community wiki
- Cross-reference with the original Go test files (`jewel_test.go`, `reverse_test.go`)

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
- **No Go or WASM in target state** — the WASM build is being removed entirely.
- **Cloudflare Worker** has a 1MB bundle limit and no Node.js APIs — use `@neondatabase/serverless` (not `pg`) for Neon queries.
- **Rate limit respect** — The PoE trade API has strict rate limits. `trade_api.ts` handles this; do not bypass or simplify the rate limiting logic.
- **Data update workflow** — When GGG patches the game, run `update_assets.sh` to pull new JSON, then regenerate. After WASM removal, the TypeScript data loader replaces `go generate`.

---

## Common Tasks

### Add a new jewel type
1. `data/jewels.go` — add to `TimelessJewelConquerors` and `TimelessJewelSeedRanges`
2. `frontend/src/lib/values.ts` — add display name
3. After WASM removal: `frontend/src/lib/calculator/data.ts` — same additions in TypeScript

### Update for a new PoE patch
```bash
./update_assets.sh <new_tree_version> <new_game_version>
go generate -tags tools -x ./...   # regenerate types (until WASM removal)
```

### Debug a calculation mismatch
- Check `random/main.go` (TinyMT32 constants: `InitialStateConstant0-3`, `TinyMT32Alpha/Bravo`)
- Check `calculator/tree_manager.go` `IsPassiveSkillReplaced` — the spawn weight logic determines replacement probability
- Run `go test -v ./... -run TestJewel` with a specific seed

### Verify UI change
Start dev server, use `claude-in-chrome` browser automation to screenshot the result. Claude cannot visually verify UI changes without the browser automation tools loaded.
