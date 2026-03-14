import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "r", encoding="utf-8") as f:
    text = f.read()

# Make sure X-Poe-Session is included correctly
if "headers['X-Poe-Session'] = poesessid" not in text:
    text = text.replace("headers['Cookie'] = `POESESSID=${poesessid}`;", "headers['X-Poe-Session'] = poesessid;")

with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "w", encoding="utf-8") as f:
    f.write(text)
print("done")
