// Vercel Function: /api/agent/chat. Logic lives in server/handler.ts (bundled to api/_lib).
import { handleAgent } from '../_lib/agent-handler.mjs';

export default {
  fetch(request) {
    return handleAgent('chat', request);
  },
};
