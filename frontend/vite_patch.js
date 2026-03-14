const fs = require("fs");
let code = fs.readFileSync("vite.config.js", "utf-8");

code = code.replace(
  "changeOrigin: true,",
  "changeOrigin: true,\n        configure: (proxy, options) => {\n          proxy.on('proxyReq', (proxyReq, req, res) => {\n            const poeSess = req.headers['x-poe-session'];\n            if (poeSess) {\n              proxyReq.setHeader('Cookie', `POESESSID=${poeSess}`);\n            }\n          });\n        },"
);

fs.writeFileSync("vite.config.js", code);
