// Vercel Function: /api/agent/*. One function serves every route here because a
// deployment can only carry so many; logic lives in server/agent.ts (bundled to api/_lib).
import { handleAgent } from '../_lib/agent-handler.mjs';

const ROUTES = new Set(['info', 'nonce', 'login', 'chat']);

export default {
  fetch(request) {
    const route = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
    return ROUTES.has(route) ? handleAgent(route, request) : Response.json({ error: 'not found' }, { status: 404 });
  },
};
