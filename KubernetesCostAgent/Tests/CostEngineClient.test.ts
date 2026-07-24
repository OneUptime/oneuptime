import { COST_ENGINE_PORT } from "./TestEnv";
import * as assert from "assert";
import * as http from "http";
import { after, before, beforeEach, test } from "node:test";
import { CostEngineClient } from "../CostEngineClient";
import { EngineAllocation } from "../Types";

/*
 * Local HTTP stub playing the cost engine. Each test configures the
 * responder; the stub records every request path so path auto-detection
 * order is assertable.
 */

type Responder = (path: string, res: http.ServerResponse) => void;

let server: http.Server;
let requestedPaths: Array<string> = [];
let responder: Responder = (_path: string, res: http.ServerResponse): void => {
  res.writeHead(404);
  res.end();
};

before(async (): Promise<void> => {
  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const path: string = (req.url || "").split("?")[0] || "";
      requestedPaths.push(path);
      responder(path, res);
    },
  );
  await new Promise<void>((resolve: () => void): void => {
    server.listen(COST_ENGINE_PORT, "127.0.0.1", resolve);
  });
});

after(async (): Promise<void> => {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
});

beforeEach((): void => {
  requestedPaths = [];
});

const WINDOW: { windowStart: Date; windowEnd: Date } = {
  windowStart: new Date("2026-07-24T10:00:00Z"),
  windowEnd: new Date("2026-07-24T11:00:00Z"),
};

function sendJson(res: http.ServerResponse, body: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const SAMPLE_RESPONSE: unknown = {
  code: 200,
  data: [
    {
      "prod/deployment/api/api-abc/api": {
        name: "prod/deployment/api/api-abc/api",
        properties: { namespace: "prod", controller: "api" },
        totalCost: 1.5,
      },
      __idle__: { name: "__idle__", totalCost: 0.5 },
    },
  ],
};

test("auto-detects the Kubecost path when it answers first", async (): Promise<void> => {
  responder = (_path: string, res: http.ServerResponse): void => {
    sendJson(res, SAMPLE_RESPONSE);
  };

  const client: CostEngineClient = new CostEngineClient();
  const allocations: Array<EngineAllocation> =
    await client.fetchAllocations(WINDOW);

  assert.strictEqual(allocations.length, 2);
  assert.strictEqual(requestedPaths[0], "/model/allocation");
  assert.strictEqual(client.detectedPath(), "/model/allocation");
});

test("falls through 404s to the OpenCost path and caches it", async (): Promise<void> => {
  responder = (path: string, res: http.ServerResponse): void => {
    if (path === "/allocation/compute") {
      sendJson(res, SAMPLE_RESPONSE);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  };

  const client: CostEngineClient = new CostEngineClient();
  const first: Array<EngineAllocation> = await client.fetchAllocations(WINDOW);

  assert.strictEqual(first.length, 2);
  assert.deepStrictEqual(requestedPaths, [
    "/model/allocation",
    "/allocation/compute",
  ]);
  assert.strictEqual(client.detectedPath(), "/allocation/compute");

  // Second fetch goes straight to the detected path — no re-probing.
  requestedPaths = [];
  const second: Array<EngineAllocation> = await client.fetchAllocations(WINDOW);
  assert.strictEqual(second.length, 2);
  assert.deepStrictEqual(requestedPaths, ["/allocation/compute"]);
});

test("sends window, accumulate and includeIdle query params", async (): Promise<void> => {
  let capturedUrl: string = "";
  responder = (_path: string, res: http.ServerResponse): void => {
    sendJson(res, SAMPLE_RESPONSE);
  };

  server.once("request", (req: http.IncomingMessage): void => {
    capturedUrl = req.url || "";
  });

  const client: CostEngineClient = new CostEngineClient();
  await client.fetchAllocations(WINDOW);

  const url: URL = new URL(`http://x${capturedUrl}`);
  assert.strictEqual(
    url.searchParams.get("window"),
    "2026-07-24T10:00:00.000Z,2026-07-24T11:00:00.000Z",
  );
  assert.strictEqual(url.searchParams.get("accumulate"), "true");
  assert.strictEqual(url.searchParams.get("includeIdle"), "true");
});

test("flattens multiple allocation sets and skips null sets", async (): Promise<void> => {
  responder = (_path: string, res: http.ServerResponse): void => {
    sendJson(res, {
      code: 200,
      data: [
        null,
        { a: { name: "a", totalCost: 1 } },
        { b: { name: "b", totalCost: 2 }, c: { name: "c", totalCost: 3 } },
      ],
    });
  };

  const client: CostEngineClient = new CostEngineClient();
  const allocations: Array<EngineAllocation> =
    await client.fetchAllocations(WINDOW);

  assert.deepStrictEqual(
    allocations
      .map((allocation: EngineAllocation): string => {
        return allocation.name || "";
      })
      .sort(),
    ["a", "b", "c"],
  );
});

test("throws when every candidate path 404s", async (): Promise<void> => {
  responder = (_path: string, res: http.ServerResponse): void => {
    res.writeHead(404);
    res.end();
  };

  const client: CostEngineClient = new CostEngineClient();
  await assert.rejects(client.fetchAllocations(WINDOW));
  // All three candidates were probed before giving up.
  assert.deepStrictEqual(requestedPaths, [
    "/model/allocation",
    "/allocation/compute",
    "/allocation",
  ]);
});

test("throws on a non-2xx, non-404 answer without falling through", async (): Promise<void> => {
  responder = (path: string, res: http.ServerResponse): void => {
    if (path === "/model/allocation") {
      res.writeHead(500);
      res.end("boom");
      return;
    }
    sendJson(res, SAMPLE_RESPONSE);
  };

  const client: CostEngineClient = new CostEngineClient();
  /*
   * A 500 from a candidate is remembered as the failure but the client
   * still tries the remaining candidates — the next one answers, so the
   * fetch succeeds via fallback.
   */
  const allocations: Array<EngineAllocation> =
    await client.fetchAllocations(WINDOW);
  assert.strictEqual(allocations.length, 2);
  assert.strictEqual(client.detectedPath(), "/allocation/compute");
});

test("throws when the response has no data array", async (): Promise<void> => {
  responder = (path: string, res: http.ServerResponse): void => {
    if (path === "/model/allocation") {
      sendJson(res, { code: 200, message: "no data here" });
      return;
    }
    res.writeHead(404);
    res.end();
  };

  const client: CostEngineClient = new CostEngineClient();
  await assert.rejects(
    client.fetchAllocations(WINDOW),
    /no data array|404|not found|did not answer/i,
  );
});
