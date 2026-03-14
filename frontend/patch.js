const fs = require('fs');
let text = fs.readFileSync('src/lib/components/SearchResult.svelte', 'utf-8');

text = text.replace(
    'openTrade(jewel, conqueror, [set], platform, league)', 
    'openTrade(jewel, set.conqueror || conqueror, [set], platform, league)'
);

text = text.replace(
    /<div class="font-bold text-orange-500 text-center">[\s\S]*?<\/div>/,
    `<div class="font-bold text-orange-500 text-center flex flex-col items-center">
      <div>Seed {set.seed} (weight {set.weight})</div>
      {#if set.conqueror || set.price}
        <div class="text-xs text-blue-300 font-normal mt-1">
          {#if set.conqueror}<span>{set.conqueror.charAt(0).toUpperCase() + set.conqueror.slice(1)}</span>{/if}
          {#if set.conqueror && set.price}<span class="mx-1">|</span>{/if}
          {#if set.price}<span>{set.price}</span>{/if}
        </div>
      {/if}
    </div>`
);

fs.writeFileSync('src/lib/components/SearchResult.svelte', text);
console.log('done node');
