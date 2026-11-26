import { handleApi, cookieOf } from "@/server/api";
import { actorFor, startActor } from "@/server/local/registry";
import { SESSION_COOKIE } from "@/server/store";

// Local development: every /api request goes to the same handler the Cloudflare Worker uses, with the
// person's agent kept in this process instead of in a Durable Object.
function handle(request: Request): Promise<Response> {
  return handleApi(request, { actor: actorFor(cookieOf(request, SESSION_COOKIE)), start: startActor });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
