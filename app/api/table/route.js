import { env } from "cloudflare:workers";
import { createTableHandler } from "./handler.js";

export const dynamic = "force-dynamic";

// env.DB only exists inside the Worker, so the binding is read per request.
export async function POST(request) {
  return createTableHandler({ db: env.DB })(request);
}
