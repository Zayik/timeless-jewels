// Free a TCP port by killing whatever is LISTENING on it (Windows), then exit 0 — always.
// Run before Vite starts so an orphaned dev server from a previous run (Tauri's
// beforeDevCommand isn't always killed on Shift+F5) doesn't cause "Port already in use".
//
// Usage: node scripts/free_port.mjs [port]   (default 5174, the overlay's devUrl)

import { execSync } from 'node:child_process';

const port = process.argv[2] ?? '5174';
try {
  const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true });
  const pids = new Set();
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/); // proto local foreign state pid
    if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
      pids.add(cols[4]);
    }
  }
  for (const pid of pids) {
    if (pid && pid !== '0') {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
        console.log(`free_port: killed PID ${pid} holding :${port}`);
      } catch {
        /* already gone */
      }
    }
  }
} catch {
  /* netstat unavailable or nothing listening — nothing to do */
}
process.exit(0);
