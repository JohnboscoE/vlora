// Local agent server for development: `npm run agent`.
// On Vercel the same handler runs as functions in /api/agent — this file isn't used there.
import './loadEnv'; // must stay first: sets env before chain.ts picks the network
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleAgent, type AgentRoute } from './handler';
import { handleGasless, type GaslessRoute } from './gasless';
import { handleOnramp, type OnrampRoute } from './onramp';
import { handleOfframp, type OfframpRoute } from './offramp';
import { handleBills, type BillsRoute } from './bills';
import { CHAIN_ID, NETWORK_NAME } from './chain';

const PORT = Number(process.env.PORT ?? 8787);
const ROUTES = new Set<AgentRoute>(['info', 'nonce', 'login', 'chat']);
const GASLESS_ROUTES = new Set<GaslessRoute>(['info', 'settle', 'check']);
const ONRAMP_ROUTES = new Set<OnrampRoute>(['info', 'sessions']);
const OFFRAMP_ROUTES = new Set<OfframpRoute>(['info', 'institutions', 'rate', 'verify', 'orders', 'order', 'deposits']);
const BILLS_ROUTES = new Set<BillsRoute>(['info', 'products', 'product', 'invoices', 'invoice', 'phone', 'preflight']);

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length && req.method !== 'GET' ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  return new Request(`http://localhost:${PORT}${req.url ?? '/'}`, { method: req.method, headers, body });
}

createServer((req, res) => void route(req, res)).listen(PORT, () => {
  console.log(`Vlora agent server on http://localhost:${PORT} — ${NETWORK_NAME} (chain ${CHAIN_ID}); the Vite dev server proxies /api/agent and /api/gasless here`);
});

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const agentRoute = url.pathname.match(/^\/api\/agent\/(\w+)$/)?.[1] as AgentRoute | undefined;
  const gaslessRoute = url.pathname.match(/^\/api\/gasless\/(\w+)$/)?.[1] as GaslessRoute | undefined;
  const onrampRoute = url.pathname.match(/^\/api\/onramp\/(\w+)$/)?.[1] as OnrampRoute | undefined;
  const offrampRoute = url.pathname.match(/^\/api\/offramp\/(\w+)$/)?.[1] as OfframpRoute | undefined;
  const billsRoute = url.pathname.match(/^\/api\/bills\/(\w+)$/)?.[1] as BillsRoute | undefined;
  const response =
    agentRoute && ROUTES.has(agentRoute)
      ? await handleAgent(agentRoute, await toRequest(req))
      : gaslessRoute && GASLESS_ROUTES.has(gaslessRoute)
        ? await handleGasless(gaslessRoute, await toRequest(req))
        : onrampRoute && ONRAMP_ROUTES.has(onrampRoute)
          ? await handleOnramp(onrampRoute, await toRequest(req))
          : offrampRoute && OFFRAMP_ROUTES.has(offrampRoute)
            ? await handleOfframp(offrampRoute, await toRequest(req))
            : billsRoute && BILLS_ROUTES.has(billsRoute)
              ? await handleBills(billsRoute, await toRequest(req))
              : Response.json({ error: 'not found' }, { status: 404 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
