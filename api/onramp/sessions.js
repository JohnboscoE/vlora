// Vercel Function: /api/onramp/sessions. Logic lives in server/onramp.ts (bundled to api/_lib).
import { handleOnramp } from '../_lib/onramp-handler.mjs';

export default {
  fetch(request) {
    return handleOnramp('sessions', request);
  },
};
