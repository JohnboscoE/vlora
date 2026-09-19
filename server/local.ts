// Local agent server for development: `npm run agent`.
// On Vercel the same handler runs as functions in /api/agent — this file isn't used there.
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { handleAgent, type AgentRoute } from './handler';

// Minimal .env loader (no extra dependency). Real env vars take precedence.
const envPath = new URL('./.env', import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT ?? 8787);
const ROUTES = new Set<AgentRoute>(['info', 'nonce', 'login', 'chat']);

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  return new Request(`http://localhost:${PORT}${req.url ?? '/'}`, { method: req.method, headers, body });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const route = url.pathname.replace(/^\/api\/agent\//, '') as AgentRoute;
  const response = ROUTES.has(route)
    ? await handleAgent(route, await toRequest(req))
    : Response.json({ error: 'not found' }, { status: 404 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`Vlora agent server on http://localhost:${PORT} (the Vite dev server proxies /api/agent here)`);
});
