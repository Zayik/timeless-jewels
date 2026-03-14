const fs = require('fs');
let code = fs.readFileSync('src/routes/+page.svelte', 'utf8');

const s1 = '{#if massSearchResults && results}';
const end1 = code.indexOf('{/if}', code.indexOf('{#if !circledNode}')) + '{/if}'.length;

const newHTML = `
        {#if massSearchResults && results}
          <div class="mt-4 flex flex-col overflow-auto">
            {#each Object.keys(massSearchResults.resultsBySocket).flatMap(s => Object.keys(massSearchResults.resultsBySocket[s].grouped)).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => parseInt(b) - parseInt(a)) as matchCount}
              <div class="mt-4">
                <h3 class="text-2xl font-bold mb-2 text-white">{matchCount} Matches</h3>
                {#each Object.keys(massSearchResults.resultsBySocket) as socketId}
                  {#if massSearchResults.resultsBySocket[socketId].grouped[matchCount] && massSearchResults.resultsBySocket[socketId].grouped[matchCount].length > 0}
                    <div class="mt-2 border-t pt-2 border-white/20">
                      <h4 class="text-xl font-bold text-orange-400 cursor-pointer mb-2" tabindex="0" role="button" on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); circledNode = parseInt(socketId); skillTreeComponent.centerOnNode(parseInt(socketId)); updateUrl(); } }} on:click={() => { circledNode = parseInt(socketId); skillTreeComponent.centerOnNode(parseInt(socketId)); updateUrl(); }}>
                        Jewel Socket {skillTree.nodes[parseInt(socketId)]?.name || socketId}
                      </h4>
                      <SearchResults searchResults={{ grouped: { [matchCount]: massSearchResults.resultsBySocket[socketId].grouped[matchCount] }, raw: massSearchResults.resultsBySocket[socketId].grouped[matchCount] }} highlight={(seed, passives) => { circledNode = parseInt(socketId); highlight(seed, passives); skillTreeComponent.centerOnNode(parseInt(socketId)); }} groupResults={true} jewel={searchJewel} conqueror={searchConqueror} platform={platform.value} league={league.value} />
                    </div>
                  {/if}
                {/each}
              </div>
            {/each}
          </div>
        {/if}
`;

// Extract everything from massSearchResults block and replace it
let start = code.indexOf('{#if massSearchResults && results}');
if (start > -1) {
  let depth = 1;
  let end = -1;
  let blockRegex = /\{#if|\{:else if|\{:else|\{\/if\}/g;
  blockRegex.lastIndex = start + 4;
  let match;
  while ((match = blockRegex.exec(code)) !== null) {
    if (match[0].startsWith('{#if')) {
      depth++;
    } else if (match[0] === '{/if}') {
      depth--;
      if (depth === 0) {
        end = match.index + '{/if}'.length;
        break;
      }
    }
  }

  if (end > -1) {
    code = code.substring(0, start) + newHTML + code.substring(end);
    fs.writeFileSync('src/routes/+page.svelte', code);
    console.log('Replaced successfully');
  } else {
    console.log('Could not find end of block');
  }
} else {
  console.log('Could not find start');
}
