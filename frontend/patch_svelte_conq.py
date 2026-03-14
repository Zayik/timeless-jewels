import re
with open("D:/GitHub/timeless-jewels/frontend/src/routes/+page.svelte", "r", encoding="utf-8") as f:
    text = f.read()

# Update marketSearchAllSockets to pass `prices`
old_args = """      const seeds = cachedJewels.map(j => j.seed);
      const conquerors = cachedJewels.map(j => j.worshipper);

      seedsProcessed = 0;

      const res = await syncWrap.targetedMassSearch(
        {
          jewel: selectedJewel.value,
          seeds,
          conquerors,"""
new_args = """      const seeds = cachedJewels.map(j => j.seed);
      const conquerors = cachedJewels.map(j => j.worshipper);
      const prices = cachedJewels.map(j => j.price);

      seedsProcessed = 0;

      const res = await syncWrap.targetedMassSearch(
        {
          jewel: selectedJewel.value,
          seeds,
          conquerors,
          prices,"""

text = text.replace(old_args, new_args)

with open("D:/GitHub/timeless-jewels/frontend/src/routes/+page.svelte", "w", encoding="utf-8") as f:
    f.write(text)
print("done")
