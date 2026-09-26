// Vercel Function: /api/gasless/*. One function serves every route here because a
// deployment can only carry so many; logic lives in server/gasless.ts (bundled to api/_lib).
import { handleGasless } from '../_lib/gasless-handler.mjs';

const ROUTES = new Set(['info', 'settle', 'check']);

export default {
  fetch(request) {
    const route = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
    return ROUTES.has(route) ? handleGasless(route, request) : Response.json({ error: 'not found' }, { status: 404 });
  },
};
