// Loads server/.env for local runs. Imported FIRST by server/local.ts so values
// (including VITE_ARC_NETWORK) exist before other modules read them at load time.
// Real environment variables take precedence. On Vercel this file isn't used.
import { existsSync, readFileSync } from 'node:fs';

const envPath = new URL('./.env', import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    const [, key, value] = m ?? [];
    if (key && value != null && process.env[key] === undefined) process.env[key] = value.replace(/^["']|["']$/g, '');
  }
}
