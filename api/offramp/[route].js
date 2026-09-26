// Vercel Function: /api/offramp/*. One function serves every route here because a
// deployment can only carry so many; logic lives in server/offramp.ts (bundled to api/_lib).
import { handleOfframp } from '../_lib/offramp-handler.mjs';

const ROUTES = new Set(['info', 'institutions', 'rate', 'verify', 'orders', 'order']);

export default {
  fetch(request) {
    const route = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
    return ROUTES.has(route) ? handleOfframp(route, request) : Response.json({ error: 'not found' }, { status: 404 });
  },
};
