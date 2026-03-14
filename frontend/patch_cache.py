import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/market_cache.ts", "r", encoding="utf-8") as f:
    text = f.read()

replacement = """export interface MarketJewel {
  id?: string;
  seed: number;
  worshipper: string;
  price: string;
  listedAt: string;
}"""

text = re.sub(r"export interface MarketJewel \{[^\}]+\}", replacement, text)

with open("D:/GitHub/timeless-jewels/frontend/src/lib/market_cache.ts", "w", encoding="utf-8") as f:
    f.write(text)
print("done cache")
