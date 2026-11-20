import { createCheckHandler } from '../../storage-sqlite/src/check-http.ts';
import { d1SqlPort } from './storage.ts';

interface Env {DB: D1Database}
/** Production entrypoint is intentionally fail-closed until authenticated ingress,
 * durable dispatcher and licensed connectors are configured. Do not flip enabled here. */
export async function handleWorkerCheck(request: Request, env: Env): Promise<Response> {
  return createCheckHandler(d1SqlPort(env.DB))(request, {
    scope:{principal:'install:unconfigured',edge:'edge:unconfigured'},enabled:false,now:Date.now,
  });
}
