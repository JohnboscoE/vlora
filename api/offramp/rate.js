// Vercel Function: /api/offramp/rate. Logic lives in server/offramp.ts (bundled to api/_lib).
import { handleOfframp } from '../_lib/offramp-handler.mjs';

export default {
  fetch(request) {
    return handleOfframp('rate', request);
  },
};
