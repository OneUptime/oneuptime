import http from "http";
import { AddressInfo } from "net";

/*
 * A local HTTP server playing OneUptime's /kubernetes-ai-agent-ingest API
 * (Appendix W of the design): it records every request and answers from a
 * per-route script, falling back to a healthy default for each route.
 */

export const INGEST_PREFIX: string = "/kubernetes-ai-agent-ingest";

export interface RecordedRequest {
  method: string;
  // The path after INGEST_PREFIX, e.g. "/register" or "/job/j-1/result".
  route: string;
  // The full request path.
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
  rawBody: string;
  receivedAt: number;
}

export interface FakeReply {
  status?: number | undefined;
  // JSON body (serialized as application/json).
  json?: unknown;
  // A raw body with its own content type (HTML pages, plain text, ...).
  raw?: string | undefined;
  contentType?: string | undefined;
  headers?: Record<string, string> | undefined;
  // Answer after this long.
  delayMs?: number | undefined;
  // Never answer (the client times out).
  hang?: boolean | undefined;
  // Drop the connection without answering.
  destroy?: boolean | undefined;
}

export type FakeResponder = (request: RecordedRequest) => FakeReply;

// The route key a request path maps to: job routes collapse their id.
export function routeKey(route: string): string {
  const job: RegExpMatchArray | null = route.match(
    /^\/job\/[^/]+\/(heartbeat|result)$/,
  );
  return job ? `/job/:id/${job[1]}` : route;
}

const DEFAULT_REPLIES: Record<string, FakeReply> = {
  "/register": {
    json: { agentId: "agent-1", agentKey: "key-1", clusterId: "cluster-1" },
  },
  "/heartbeat": { json: { status: "ok" } },
  "/claim-next-job": { json: { job: null } },
  "/job/:id/heartbeat": { json: { status: "ok" } },
  "/job/:id/result": { json: { accepted: true } },
  "/disconnect": { json: { status: "ok" } },
};

export default class FakeOneUptime {
  public readonly requests: Array<RecordedRequest> = [];
  private readonly scripts: Map<string, Array<FakeReply | FakeResponder>> =
    new Map();
  private readonly defaults: Map<string, FakeReply | FakeResponder> = new Map();
  private server: http.Server | null = null;
  private readonly hanging: Set<http.ServerResponse> = new Set();

  public url: string = "";

  public async start(): Promise<void> {
    this.server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse): void => {
        const chunks: Array<Buffer> = [];
        req.on("data", (chunk: Buffer): void => {
          chunks.push(chunk);
        });
        req.on("end", (): void => {
          this.handle(req, res, Buffer.concat(chunks).toString("utf8"));
        });
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });

    const address: AddressInfo = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${address.port}`;
  }

  public async stop(): Promise<void> {
    for (const res of this.hanging) {
      res.destroy();
    }
    this.hanging.clear();

    const server: http.Server | null = this.server;
    this.server = null;

    if (!server) {
      return;
    }

    server.closeAllConnections();
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
    });
  }

  // Answer the next requests to this route with these replies, in order.
  public script(
    route: string,
    ...replies: Array<FakeReply | FakeResponder>
  ): void {
    const queue: Array<FakeReply | FakeResponder> =
      this.scripts.get(route) || [];
    queue.push(...replies);
    this.scripts.set(route, queue);
  }

  // Answer every request to this route with this, once any script is used up.
  public setDefault(route: string, reply: FakeReply | FakeResponder): void {
    this.defaults.set(route, reply);
  }

  public requestsTo(route: string): Array<RecordedRequest> {
    return this.requests.filter((request: RecordedRequest): boolean => {
      return routeKey(request.route) === route;
    });
  }

  public reset(): void {
    this.requests.length = 0;
    this.scripts.clear();
    this.defaults.clear();
  }

  // Resolves once a request to this route has arrived (or times out).
  public async waitFor(
    route: string,
    count: number = 1,
    timeoutMs: number = 5_000,
  ): Promise<Array<RecordedRequest>> {
    const deadline: number = Date.now() + timeoutMs;

    while (this.requestsTo(route).length < count) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${count} request(s) to ${route}; got ${this.requestsTo(route).length}.`,
        );
      }
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 10);
      });
    }

    return this.requestsTo(route);
  }

  private handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rawBody: string,
  ): void {
    const fullPath: string = (req.url || "/").split("?")[0] || "/";
    const route: string = fullPath.startsWith(INGEST_PREFIX)
      ? fullPath.slice(INGEST_PREFIX.length)
      : fullPath;

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const request: RecordedRequest = {
      method: req.method || "",
      route,
      path: fullPath,
      headers: req.headers,
      body,
      rawBody,
      receivedAt: Date.now(),
    };
    this.requests.push(request);

    const key: string = routeKey(route);
    const queue: Array<FakeReply | FakeResponder> | undefined =
      this.scripts.get(key);
    const scripted: FakeReply | FakeResponder | undefined =
      queue && queue.length > 0 ? queue.shift() : undefined;
    const chosen: FakeReply | FakeResponder = scripted ||
      this.defaults.get(key) ||
      DEFAULT_REPLIES[key] || {
        status: 404,
        json: { message: "Not found" },
      };
    const reply: FakeReply =
      typeof chosen === "function" ? chosen(request) : chosen;

    const send: () => void = (): void => {
      if (reply.destroy) {
        req.socket.destroy();
        return;
      }

      if (reply.hang) {
        this.hanging.add(res);
        return;
      }

      const status: number = reply.status ?? 200;

      if (reply.raw !== undefined) {
        res.writeHead(status, {
          "Content-Type": reply.contentType || "text/html; charset=utf-8",
          ...(reply.headers || {}),
        });
        res.end(reply.raw);
        return;
      }

      res.writeHead(status, {
        "Content-Type": reply.contentType || "application/json; charset=utf-8",
        ...(reply.headers || {}),
      });
      res.end(JSON.stringify(reply.json ?? {}));
    };

    if (reply.delayMs) {
      setTimeout(send, reply.delayMs);
    } else {
      send();
    }
  }
}

// A 200 claim answer carrying one kubectl job.
export function jobReply(job: Record<string, unknown>): FakeReply {
  return {
    json: {
      job: {
        jobId: "job-1",
        origin: "AiInvestigation",
        stepId: "step-1",
        stepType: "Kubectl",
        timeoutInMs: 30_000,
        leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        payload: {
          args: ["get", "pods", "-n", "web"],
          displayCommand: "kubectl get pods -n web",
          tier: "Read",
          kubernetesClusterId: "cluster-1",
          clusterIdentifier: "prod-us",
        },
        ...job,
      },
    },
  };
}
