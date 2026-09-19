// Loads server/.env for local runs. Imported FIRST by server/local.ts so values
// (including VITE_ARC_NETWORK) exist before other modules read them at load time.
// Real environment variables take precedence. On Vercel this file isn't used.
import { existsSync, readFileSync } from 'node:fs';

const envPath = new URL('./.env', import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}
