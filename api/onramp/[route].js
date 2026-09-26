// Vercel Function: /api/onramp/*. One function serves every route here because a
// deployment can only carry so many; logic lives in server/onramp.ts (bundled to api/_lib).
import { handleOnramp } from '../_lib/onramp-handler.mjs';

const ROUTES = new Set(['info', 'sessions']);

export default {
  fetch(request) {
    const route = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
    return ROUTES.has(route) ? handleOnramp(route, request) : Response.json({ error: 'not found' }, { status: 404 });
  },
};
