import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "r", encoding="utf-8") as f:
    text = f.read()

JEWELS_CONST = """const JEWEL_CONQUERORS: Record<number, string[]> = {
  1: ['xibaqua', 'zerphi', 'ahuana', 'doryani'],
  2: ['kaom', 'rakiata', 'kiloava', 'akoya'],
  3: ['deshret', 'balbala', 'asenath', 'nasima'],
  4: ['venarius', 'maxarius', 'dominus', 'avarius'],
  5: ['cadiro', 'victario', 'chitus', 'caspiro'],
  6: ['vorana', 'uhtred', 'medved']
};"""

# Insert constants below imports
if "JEWEL_CONQUERORS" not in text:
    text = re.sub(
        r"const LIMIT_PER_PERIOD = 5;\n",
        f"const LIMIT_PER_PERIOD = 5;\n\n{JEWELS_CONST}\n",
        text
    )

# Fix the for loop
text = re.sub(
    r"for \(const conqueror of CONQUERORS\) \{",
    r"for (const conqueror of JEWEL_CONQUERORS[jewelId] || []) {",
    text
)

# And fix the regex to capture the new "Remembrancing X songworthy deeds by the line of Vorana"
# Typical mod: "Bathed in the blood of 5678 sacrificed in the name of Doryani"
# New mod: "Remembrancing 1234 songworthy deeds by the line of Medved"
# previous regex: /(\d+).*(under|name of|by|to) ([A-Za-z]+)/

old_regex = r"const match = mod.match\(\/\\\(d\+\\\)\.\*\(under\|name of\|by\|to\) \(\[A\-Za\-z\]\+\)\/\);"
new_regex = r"const match = mod.match(/(\\d+).*(under|name of|by|to|line of) ([A-Za-z]+)/);"

text = text.replace("const match = mod.match(/(\\d+).*(under|name of|by|to) ([A-Za-z]+)/);", new_regex)

with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "w", encoding="utf-8") as f:
    f.write(text)
print("trade_api updated.")
