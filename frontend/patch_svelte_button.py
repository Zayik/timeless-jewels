import re
with open("D:/GitHub/timeless-jewels/frontend/src/routes/+page.svelte", "r", encoding="utf-8") as f:
    text = f.read()

# I want to remove the syncMarket button from inside the {#if showMarketSettings} and put it just after it.

old_block = """                              <p class="text-xs text-gray-400 mt-2">If you get 403 errors, install an Allow CORS browser extension.</p>
                              <button
                                class="p-1 px-2 bg-orange-600/60 rounded hover:bg-orange-600 disabled:bg-gray-600"
                                on:click={syncMarket} disabled={fetchingMarket}>
                                {fetchingMarket ? 'Syncing...' : 'Sync Market Cache'}
                              </button>
                              {#if marketProgress}
                                <div class="text-xs text-blue-300">{marketProgress}</div>
                              {/if}
                            </div>
                          {/if}"""

new_block = """                              <p class="text-xs text-gray-400 mt-2">If you get CORS errors, run standard local environment or refer to setup proxy.</p>
                            </div>
                          {/if}
                          
                          <div class="flex flex-col space-y-2 mb-2">
                              <button
                                class="p-1 px-2 w-full bg-orange-600/60 rounded hover:bg-orange-600 disabled:bg-gray-600 font-bold"
                                on:click={syncMarket} disabled={fetchingMarket}>
                                {fetchingMarket ? 'Syncing...' : 'Sync Market Cache'}
                              </button>
                              {#if marketProgress}
                                <div class="text-xs text-blue-300 mt-1">{marketProgress}</div>
                              {/if}
                          </div>"""

# Remove the old block using string replace to match carefully
text = text.replace(old_block, new_block)

# Sometimes formatting makes the newlines slightly different, so if string match fails, use regex
if old_block not in text and 'Sync Market Cache' in text:
    text = re.sub(
        r'<p class="text-xs text-gray-400([^>]*)>If you get([^<]*)</p>\s*<button\s*class="([^"]*)"\s*on:click=\{syncMarket\} disabled=\{fetchingMarket\}>\s*\{fetchingMarket \? \'Syncing\.\.\.\' : \'Sync Market Cache\'\}\s*</button>\s*\{#if marketProgress\}\s*<div class="text-xs text-blue-300">\{marketProgress\}</div>\s*\{/if\}\s*</div>\s*\{/if\}',
        r"""<p class="text-xs text-gray-400\1>If you get CORS errors, you must use unproxied dev server or ensure proxy limits are observed.</p>
                            </div>
                          {/if}
                          <div class="flex flex-col space-y-2 mb-2">
                              <button
                                class="p-2 px-3 w-full bg-orange-600/60 rounded hover:bg-orange-600 disabled:bg-gray-600 font-bold"
                                on:click={syncMarket} disabled={fetchingMarket}>
                                {fetchingMarket ? 'Syncing...' : 'Sync Market Cache'}
                              </button>
                              {#if marketProgress}
                                <div class="text-xs text-blue-300 mt-1">{marketProgress}</div>
                              {/if}
                          </div>""",
        text
    )

with open("D:/GitHub/timeless-jewels/frontend/src/routes/+page.svelte", "w", encoding="utf-8") as f:
    f.write(text)
print("page.svelte updated.")
