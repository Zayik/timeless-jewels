import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/sync_worker.ts", "r", encoding="utf-8") as f:
    text = f.read()

replacement = """        const searchGrouped: { [key: number]: SearchWithSeed[] } = {};
        
        // Fast lookup maps
        const seedToConq = new Map<number, string>();
        const seedToPrice = new Map<number, string>();
        args.seeds.forEach((s, i) => {
            seedToConq.set(s, args.conquerors[i]);
            if (args.prices && args.prices[i]) {
                seedToPrice.set(s, args.prices[i]);
            }
        });

        Object.keys(socketSearchResult).forEach((seedStr) => {
          const seed = parseInt(seedStr);"""

text = re.sub(r"const searchGrouped: \{ \[key: number\]: SearchWithSeed\[\] \} = \{\};\s*Object\.keys\(socketSearchResult\)\.forEach\(\(seedStr\) => \{[ \t]*\n[ \t]*const seed = parseInt\(seedStr\);", replacement, text)

# Then populate the object returned by mapping stats
push_old = """            if (weight >= (args.minTotalWeight || 0)) {
              if (!searchGrouped[weight]) {
                searchGrouped[weight] = [];
              }
              searchGrouped[weight].push({ seed, weight, statCounts, skills });
            }"""
            
push_new = """            if (weight >= (args.minTotalWeight || 0)) {
              if (!searchGrouped[weight]) {
                searchGrouped[weight] = [];
              }
              searchGrouped[weight].push({ 
                  seed, 
                  weight, 
                  statCounts, 
                  skills,
                  conqueror: seedToConq.get(seed),
                  price: seedToPrice.get(seed)
              });
            }"""

text = text.replace(push_old, push_new)

with open("D:/GitHub/timeless-jewels/frontend/src/lib/sync_worker.ts", "w", encoding="utf-8") as f:
    f.write(text)
print("done")
