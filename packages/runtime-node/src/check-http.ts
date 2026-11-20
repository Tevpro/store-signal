import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import {
  createCheckHandler,
  type CheckContext,
} from "../../storage-sqlite/src/check-http.ts";
import { nodeSqlPort } from "./storage.ts";

/** The caller must supply authenticated, trusted ingress context and actual dispatcher readiness. */
export function nodeCheckListener(db: DatabaseSync, context: CheckContext) {
  const handle = createCheckHandler(nodeSqlPort(db));
  return (incoming: IncomingMessage, outgoing: ServerResponse): void => {
    void (async () => {
      const headers = new Headers();
      for (const name of [
        "content-type",
        "content-length",
        "idempotency-key",
      ]) {
        const value = incoming.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const body =
        incoming.method === "POST"
          ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>)
          : undefined;
      const request = new Request(`http://localhost${incoming.url ?? "/"}`, {
        method: incoming.method,
        headers,
        ...(body ? { body, duplex: "half" } : {}),
      } as RequestInit & { duplex?: "half" });
      const response = await handle(request, context);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    })().catch(() => {
      if (!outgoing.headersSent) {
        outgoing.writeHead(503, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        outgoing.end(
          JSON.stringify({
            schemaVersion: 1,
            status: "unsupported",
            reason: "unavailable",
          }),
        );
      } else outgoing.destroy();
    });
  };
}
