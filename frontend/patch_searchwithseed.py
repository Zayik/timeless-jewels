import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/skill_tree.ts", "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace("export interface SearchWithSeed {\n  seed: number;", "export interface SearchWithSeed {\n  seed: number;\n  conqueror?: string;\n  price?: string;")

with open("D:/GitHub/timeless-jewels/frontend/src/lib/skill_tree.ts", "w", encoding="utf-8") as f:
    f.write(text)
print("done")
