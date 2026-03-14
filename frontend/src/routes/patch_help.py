import re
with open("D:/GitHub/timeless-jewels/frontend/src/routes/+page.svelte", "r", encoding="utf-8") as f:
    text = f.read()

if "let showSessionHelp =" not in text:
    text = text.replace(
        "let poeSessId = '';",
        "let poeSessId = '';\n\tlet showSessionHelp = false;"
    )

    text = text.replace(
        "<span>POESESSID (Optional, required for unproxied sync):</span>",
        "<span>POESESSID (Optional, required for unproxied sync): <button type=\"button\" class=\"ml-1 text-blue-400 hover:text-blue-300 underline font-bold\" on:click={() => showSessionHelp = !showSessionHelp}>(?)</button></span>"
    )

    help_content = """</label>
                              {#if showSessionHelp}
                                <div class="bg-gray-800 border border-gray-600 p-2 mt-1 rounded text-xs text-gray-300">
                                  <p class="font-bold mb-1 text-white">How to get your POESESSID:</p>
                                  <ol class="list-decimal list-inside space-y-1 ml-1">
                                    <li>Go to <a href="https://www.pathofexile.com/trade" target="_blank" class="text-blue-400 hover:underline">pathofexile.com/trade</a> and log in.</li>
                                    <li>Press <strong>F12</strong> to open Developer Tools.</li>
                                    <li>Go to the <strong>Application</strong> tab (Chrome/Edge) or <strong>Storage</strong> tab (Firefox).</li>
                                    <li>Expand <strong>Cookies</strong> on the left and select <em>https://www.pathofexile.com</em>.</li>
                                    <li>Find the row with the Name <strong>POESESSID</strong>.</li>
                                    <li>Double-click its <strong>Value</strong>, copy it, and paste it here.</li>
                                  </ol>
                                  <p class="mt-2 text-orange-400 font-bold">Note: Never share this ID with anyone! It is stored securely in your local browser.</p>
                                </div>
                              {/if}"""

    text = re.sub(
        r"</label>\s*<p class=\"text-xs text-gray-400\">If you get",
        help_content + "\n                              <p class=\"text-xs text-gray-400 mt-2\">If you get",
        text
    )

    with open("D:/GitHub/timeless-jewels/frontend/src/routes/+page.svelte", "w", encoding="utf-8") as f:
        f.write(text)

    print("Updated svelte file.")
else:
    print("Already updated.")
