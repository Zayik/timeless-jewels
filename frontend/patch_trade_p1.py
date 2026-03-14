import re
with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "r", encoding="utf-8") as f:
    text = f.read()

# I need to modify the base request so it doesn't query the base name alone. Instead it batches the query by conqueror! 
imports = """import type { MarketJewel } from './market_cache';
import { data } from './types';

const CONQUERORS = [
    'xibaqua', 'zerphi', 'ahuana', 'doryani',
    'kaom', 'rakiata', 'kiloava', 'akoya',
    'deshret', 'balbala', 'asenath', 'nasima',
    'venarius', 'maxarius', 'dominus', 'avarius',
    'cadiro', 'victario', 'chitus', 'caspiro',
    'vorana', 'uhtred', 'medved'
];"""

text = re.sub(
    r"import type \{ MarketJewel \} from '\./market_cache';\nimport \{ data \} from '\./types';",
    imports,
    text
)

with open("D:/GitHub/timeless-jewels/frontend/src/lib/trade_api.ts", "w", encoding="utf-8") as f:
    f.write(text)
print("done")
