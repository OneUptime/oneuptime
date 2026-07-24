import { ONEUPTIME_PORT } from "./TestEnv";
import * as assert from "assert";
import * as http from "http";
import { after, before, beforeEach, test } from "node:test";
import { Shipper } from "../Shipper";
import {
  KubernetesCostAllocationIngestRow,
  KubernetesCostIngestPayload,
} from "../Types";

/*
 * Local HTTP stub playing OneUptime's /kubernetes-cost/ingest endpoint.
 * TestEnv pins SHIP_BATCH_SIZE=2 and EXPORT_MAX_RETRIES=2 so chunking and
 * retry exhaustion are testable with tiny inputs and sub-second backoffs.
 */

interface RecordedRequest {
  path: string;
  token: string;
  payload: KubernetesCostIngestPayload;
}

let server: http.Server;
let recorded: Array<RecordedRequest> = [];
/*
 * Status codes to answer, consumed one per request; when exhausted every
 * request answers 200.
 */
let statusScript: Array<number> = [];

before(async (): Promise<void> => {
  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const chunks: Array<Buffer> = [];
      req.on("data", (chunk: Buffer): void => {
        chunks.push(chunk);
      });
      req.on("end", (): void => {
        recorded.push({
          path: req.url || "",
          token: (req.headers["x-oneuptime-token"] as string) || "",
          payload: JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as KubernetesCostIngestPayload,
        });
        const status: number = statusScript.shift() ?? 200;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(status === 200 ? "{}" : JSON.stringify({ error: "nope" }));
      });
    },
  );
  await new Promise<void>((resolve: () => void): void => {
    server.listen(ONEUPTIME_PORT, "127.0.0.1", resolve);
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
  recorded = [];
  statusScript = [];
});

function makeRows(count: number): Array<KubernetesCostAllocationIngestRow> {
  const rows: Array<KubernetesCostAllocationIngestRow> = [];
  for (let i: number = 0; i < count; i++) {
    rows.push({
      windowStart: "2026-07-24T10:00:00Z",
      windowEnd: "2026-07-24T11:00:00Z",
      namespace: `ns-${i}`,
      totalCost: i,
    });
  }
  return rows;
}

test("ships rows chunked at SHIP_BATCH_SIZE with cluster, currency and token", async (): Promise<void> => {
  const shipper: Shipper = new Shipper();
  await shipper.ship(makeRows(5));

  // 5 rows at batch size 2 → chunks of 2, 2, 1.
  assert.strictEqual(recorded.length, 3);
  assert.deepStrictEqual(
    recorded.map((request: RecordedRequest): number => {
      return request.payload.allocations.length;
    }),
    [2, 2, 1],
  );

  for (const request of recorded) {
    assert.strictEqual(request.path, "/kubernetes-cost/ingest");
    assert.strictEqual(request.token, "test-ingestion-key");
    assert.strictEqual(request.payload.clusterName, "test-cluster");
    assert.strictEqual(request.payload.currency, "USD");
  }

  // Chunks preserve row order end-to-end.
  const shippedNamespaces: Array<string> = recorded.flatMap(
    (request: RecordedRequest): Array<string> => {
      return request.payload.allocations.map(
        (row: KubernetesCostAllocationIngestRow): string => {
          return row.namespace || "";
        },
      );
    },
  );
  assert.deepStrictEqual(shippedNamespaces, [
    "ns-0",
    "ns-1",
    "ns-2",
    "ns-3",
    "ns-4",
  ]);

  assert.strictEqual(shipper.healthy(), true);
  assert.strictEqual(shipper.lastError(), null);
});

test("retries a transient 5xx and succeeds", async (): Promise<void> => {
  statusScript = [500]; // first request fails, retry succeeds
  const shipper: Shipper = new Shipper();
  await shipper.ship(makeRows(1));

  assert.strictEqual(recorded.length, 2);
  assert.strictEqual(shipper.lastError(), null);
});

test("throws after retries are exhausted", async (): Promise<void> => {
  // EXPORT_MAX_RETRIES=2 → 3 attempts total, all fail.
  statusScript = [500, 500, 500];
  const shipper: Shipper = new Shipper();

  await assert.rejects(shipper.ship(makeRows(1)), /HTTP 500/);
  assert.strictEqual(recorded.length, 3);
  assert.match(shipper.lastError() || "", /HTTP 500/);
});

test("does not retry a 401 (invalid ingestion key)", async (): Promise<void> => {
  statusScript = [401];
  const shipper: Shipper = new Shipper();

  await assert.rejects(shipper.ship(makeRows(1)), /ingestion token|401/i);
  assert.strictEqual(recorded.length, 1);
});

test("a failing later chunk aborts the ship so the window is retried whole", async (): Promise<void> => {
  // 6 rows → 3 chunks. Chunk 1 OK; chunk 2 fails through all 3 attempts.
  statusScript = [200, 500, 500, 500];
  const shipper: Shipper = new Shipper();

  await assert.rejects(shipper.ship(makeRows(6)), /HTTP 500/);
  // 1 success + 3 failed attempts; the third chunk is never sent.
  assert.strictEqual(recorded.length, 4);
});
