// Vercel Function: /api/gasless/settle. Logic lives in server/gasless.ts (bundled to api/_lib).
import { handleGasless } from '../_lib/gasless-handler.mjs';

export default {
  fetch(request) {
    return handleGasless('settle', request);
  },
};
