import http from "http";
import AgentStatus from "./AgentStatus";

/*
 * The health server, on PORT (3877; the Kubernetes AI agent uses 3876, so
 * both can run on one host) at ONEUPTIME_AI_AGENT_HEALTH_HOST (127.0.0.1:
 * an agent on the host's network must not serve /status to the network;
 * see Config.ts). Three routes:
 *
 *   GET /status/live   liveness: 200 while the process is up.
 *   GET /status/ready  readiness: 200 once the agent has started. It never
 *                      waits for registration — a server that is down, too
 *                      old, or a missing API key must not turn the
 *                      container unhealthy (and restart it in a loop); the
 *                      AI agent page and /status say what is wrong instead.
 *   GET /status        what the agent knows about itself, as JSON: whether
 *                      it is registered, its agent id, the resource, the
 *                      last heartbeat, the last error, and whether OneUptime
 *                      lacks the API. `docker exec` into the container (or
 *                      set ONEUPTIME_AI_AGENT_HEALTH_HOST=0.0.0.0 and
 *                      publish the port) and open it when the AI agent page
 *                      says "not connected".
 *
 * Never serves a credential.
 */

function send(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  headOnly: boolean,
): void {
  const text: string = JSON.stringify(body);

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(headOnly ? undefined : text);
}

export function createHealthServer(status: AgentStatus): http.Server {
  return http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const method: string = req.method || "GET";
      const pathname: string = (req.url || "/").split("?")[0] || "/";

      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return;
      }

      const headOnly: boolean = method === "HEAD";

      if (pathname === "/status/live") {
        send(res, 200, { status: "alive" }, headOnly);
        return;
      }

      if (pathname === "/status/ready") {
        send(
          res,
          status.ready ? 200 : 503,
          { status: status.ready ? "ready" : "starting" },
          headOnly,
        );
        return;
      }

      if (pathname === "/status") {
        send(
          res,
          200,
          status.snapshot() as unknown as Record<string, unknown>,
          headOnly,
        );
        return;
      }

      res.writeHead(404);
      res.end();
    },
  );
}

// Listen on port (0 picks a free one, for tests); resolves once listening.
export function startHealthServer(data: {
  status: AgentStatus;
  port: number;
  host?: string | undefined;
}): Promise<http.Server> {
  const server: http.Server = createHealthServer(data.status);

  return new Promise<http.Server>(
    (
      resolve: (server: http.Server) => void,
      reject: (err: Error) => void,
    ): void => {
      server.once("error", reject);
      server.listen(data.port, data.host, (): void => {
        server.off("error", reject);
        resolve(server);
      });
    },
  );
}
