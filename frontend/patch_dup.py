import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "r", encoding="utf-8") as f:
    text = f.read()

# remove duplicate CONQUERORS if it exists
match = re.search(r"const CONQUERORS = \[.*?\];", text, flags=re.DOTALL)
if match:
    # find second match
    second_match = re.search(r"const CONQUERORS = \[.*?\];", text[match.end():], flags=re.DOTALL)
    if second_match:
        fixed = text[:match.end() + second_match.start()] + text[match.end() + second_match.end():]
        with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "w", encoding="utf-8") as f:
            f.write(fixed)
        print("Fixed duplicate.")
