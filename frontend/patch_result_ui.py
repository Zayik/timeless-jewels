import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/components/SearchResult.svelte", "r", encoding="utf-8") as f:
    text = f.read()

# Update openTrade function call to use set.conqueror if it exists
old_trade = """openTrade(jewel, conqueror, [set], platform, league)"""
new_trade = """openTrade(jewel, set.conqueror || conqueror, [set], platform, league)"""
text = text.replace(old_trade, new_trade)

# Add custom Conqueror / Price label to the title if present
old_title = """<div class="font-bold text-orange-500 text-center">
      Seed {set.seed} (weight {set.weight})
    </div>"""

new_title = """<div class="font-bold text-orange-500 text-center flex flex-col items-center">
      <div>Seed {set.seed} (weight {set.weight})</div>
      {#if set.conqueror || set.price}
        <div class="text-xs text-blue-300 font-normal">
          {#if set.conqueror}<span>{set.conqueror}</span>{/if}
          {#if set.conqueror && set.price}<span class="mx-1">•</span>{/if}
          {#if set.price}<span>{set.price}</span>{/if}
        </div>
      {/if}
    </div>"""
text = text.replace(old_title, new_title)

# Also check SearchResults.svelte if we need any updates (probably not, it just loops it).

with open("D:/GitHub/timeless-jewels/frontend/src/lib/components/SearchResult.svelte", "w", encoding="utf-8") as f:
    f.write(text)
print("done")
