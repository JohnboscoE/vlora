// Vercel Function: /api/bills/*. One function serves every route here because a
// deployment can only carry so many; logic lives in server/bills.ts (bundled to api/_lib).
import { handleBills } from '../_lib/bills-handler.mjs';

const ROUTES = new Set(['info', 'products', 'product', 'invoices', 'invoice', 'phone', 'preflight']);

export default {
  fetch(request) {
    const route = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
    return ROUTES.has(route) ? handleBills(route, request) : Response.json({ error: 'not found' }, { status: 404 });
  },
};
