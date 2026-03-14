import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "r", encoding="utf-8") as f:
    text = f.read()

# Update signature
text = text.replace(
    "poesessid: string,\n  onProgress: (msg: string) => void",
    "poesessid: string,\n  syncType: 'full' | 'incremental',\n  onProgress: (msg: string) => void"
)

# Update the status and add incremental logic
payload_old = """      const payload = {
        query: {
          status: { option: 'online' },
          name: baseName,
          type: 'Timeless Jewel',
          stats: [{ type: 'and', filters: [{ id: `explicit.pseudo_timeless_jewel_${conqueror}` }] }]
        },
        sort: { price: 'asc' }
      };"""

payload_new = """      const payload: any = {
        query: {
          status: { option: 'any' },
          name: baseName,
          type: 'Timeless Jewel',
          stats: [{ type: 'and', filters: [{ id: `explicit.pseudo_timeless_jewel_${conqueror}` }] }]
        },
        sort: { price: 'asc' }
      };
      
      if (syncType === 'incremental') {
          payload.query.filters = { trade_filters: { filters: { indexed: { option: '1day' } } } };
      }"""
text = text.replace(payload_old, payload_new)

# Add ID to market jewel parsing
id_old = """if (seed > 0) {
              marketJewels.push({ seed, worshipper, price: priceStr, listedAt: item.listing?.indexed || new Date().toISOString() });
            }"""
id_new = """if (seed > 0) {
              marketJewels.push({ id: item.id, seed, worshipper, price: priceStr, listedAt: item.listing?.indexed || new Date().toISOString() });
            }"""
text = text.replace(id_old, id_new)

with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "w", encoding="utf-8") as f:
    f.write(text)
print("done api")
