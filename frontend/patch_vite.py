import re
with open("D:/GitHub/timeless-jewels/frontend/vite.config.js", "r", encoding="utf-8") as f:
    text = f.read()

new_server = """  server: {
    fs: {
      strict: false
    },
    proxy: {
      '/api/trade': {
        target: 'https://www.pathofexile.com',
        changeOrigin: true,
        secure: true,
        headers: {
          'Origin': 'https://www.pathofexile.com',
          'Referer': 'https://www.pathofexile.com/'
        }
      }
    }
  },"""

text = re.sub(
    r"  server: \{\s*fs: \{\s*strict: false\s*\}\s*\},",
    new_server,
    text
)

with open("D:/GitHub/timeless-jewels/frontend/vite.config.js", "w", encoding="utf-8") as f:
    f.write(text)

print("Updated vite.config.js")
