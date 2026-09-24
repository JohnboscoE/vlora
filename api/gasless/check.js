// Vercel Function: /api/gasless/check — diagnoses the Circle API key (no secrets in the response).
import { handleGasless } from '../_lib/gasless-handler.mjs';

export default {
  fetch(request) {
    return handleGasless('check', request);
  },
};
