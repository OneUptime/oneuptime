import { PROMETHEUS_PORT } from "./PrometheusTestEnv";
import * as assert from "assert";
import * as http from "http";
import { after, before, beforeEach, test } from "node:test";
import { attachMemoryPeaks, peakKey } from "../AllocationMapper";
import { PrometheusClient } from "../PrometheusClient";
import { KubernetesCostAllocationIngestRow } from "../Types";

interface RecordedQuery {
  query: string;
  time: string;
}

let recorded: Array<RecordedQuery> = [];
let responseBody: string = "";
let responseStatus: number = 200;

let server: http.Server;

before(async (): Promise<void> => {
  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const url: URL = new URL(req.url || "/", "http://localhost");
      recorded.push({
        query: url.searchParams.get("query") || "",
        time: url.searchParams.get("time") || "",
      });
      res.writeHead(responseStatus, { "Content-Type": "application/json" });
      res.end(responseBody);
    },
  );

  await new Promise<void>((resolve: () => void): void => {
    server.listen(PROMETHEUS_PORT, resolve);
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
  responseStatus = 200;
  responseBody = JSON.stringify({
    status: "success",
    data: { resultType: "vector", result: [] },
  });
});

const WINDOW_START: Date = new Date("2026-07-24T10:00:00Z");
const WINDOW_END: Date = new Date("2026-07-24T11:00:00Z");

function vector(
  samples: Array<{
    namespace: string;
    pod: string;
    container: string;
    value: string;
  }>,
): string {
  return JSON.stringify({
    status: "success",
    data: {
      resultType: "vector",
      result: samples.map(
        (s: {
          namespace: string;
          pod: string;
          container: string;
          value: string;
        }): unknown => {
          return {
            metric: {
              namespace: s.namespace,
              pod: s.pod,
              container: s.container,
            },
            value: [1785240000, s.value],
          };
        },
      ),
    },
  });
}

test("queries the closed window at its end, not at wall-clock now", async (): Promise<void> => {
  await new PrometheusClient().fetchMemoryPeaks({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });

  assert.strictEqual(recorded.length, 1);
  const sent: RecordedQuery = recorded[0]!;

  // Evaluated AT windowEnd so the range selector covers exactly that window.
  assert.strictEqual(sent.time, String(WINDOW_END.getTime() / 1000));
  // Range selector width is derived from the window, not hardcoded.
  assert.match(sent.query, /\[3600s\]/);
  assert.match(sent.query, /container_memory_working_set_bytes/);
  assert.match(sent.query, /max by \(namespace, pod, container\)/);
});

/*
 * The pod sandbox series carries container="" and the node/system cgroup
 * rollups carry no container label at all; both dwarf real containers and
 * would produce absurd recommendations.
 */
test("excludes the pod sandbox and infra containers", async (): Promise<void> => {
  await new PrometheusClient().fetchMemoryPeaks({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });

  assert.match(recorded[0]!.query, /container!=""/);
  assert.match(recorded[0]!.query, /container!="POD"/);
});

test("maps samples onto the shared (namespace, pod, container) key", async (): Promise<void> => {
  responseBody = vector([
    { namespace: "prod", pod: "api-abc", container: "api", value: "734003200" },
    { namespace: "prod", pod: "api-abc", container: "sidecar", value: "1024" },
  ]);

  const peaks: Map<string, number> =
    await new PrometheusClient().fetchMemoryPeaks({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

  assert.strictEqual(peaks.size, 2);
  assert.strictEqual(
    peaks.get(
      peakKey({ namespace: "prod", podName: "api-abc", containerName: "api" }),
    ),
    734003200,
  );
  assert.strictEqual(
    peaks.get(
      peakKey({
        namespace: "prod",
        podName: "api-abc",
        containerName: "sidecar",
      }),
    ),
    1024,
  );
});

/*
 * Prometheus answers HTTP 200 with status:"error" for a rejected query, so
 * the status code alone is not a success check.
 */
test("treats a 200 with status error as no data", async (): Promise<void> => {
  responseBody = JSON.stringify({
    status: "error",
    errorType: "bad_data",
    error: "invalid parameter",
  });

  const peaks: Map<string, number> =
    await new PrometheusClient().fetchMemoryPeaks({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

  assert.strictEqual(peaks.size, 0);
});

/*
 * Peaks are an enrichment. Every failure mode must degrade to "no peaks"
 * rather than throwing, or a Prometheus outage stalls the poller's
 * checkpoint and stops spend collection entirely.
 */
test("returns no peaks rather than throwing on an HTTP error", async (): Promise<void> => {
  responseStatus = 503;
  responseBody = "unavailable";

  const peaks: Map<string, number> =
    await new PrometheusClient().fetchMemoryPeaks({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

  assert.strictEqual(peaks.size, 0);
});

test("returns no peaks rather than throwing on unparseable json", async (): Promise<void> => {
  responseBody = "not json at all";

  const peaks: Map<string, number> =
    await new PrometheusClient().fetchMemoryPeaks({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

  assert.strictEqual(peaks.size, 0);
});

test("skips samples missing a join label or carrying a bad value", async (): Promise<void> => {
  responseBody = JSON.stringify({
    status: "success",
    data: {
      resultType: "vector",
      result: [
        { metric: { namespace: "prod", pod: "api-abc" }, value: [1, "5"] },
        {
          metric: { namespace: "prod", pod: "api-abc", container: "ok" },
          value: [1, "NaN"],
        },
        {
          metric: { namespace: "prod", pod: "api-abc", container: "good" },
          value: [1, "42"],
        },
      ],
    },
  });

  const peaks: Map<string, number> =
    await new PrometheusClient().fetchMemoryPeaks({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

  assert.strictEqual(peaks.size, 1);
  assert.strictEqual(
    peaks.get(
      peakKey({ namespace: "prod", podName: "api-abc", containerName: "good" }),
    ),
    42,
  );
});

test("attachMemoryPeaks stamps matching rows and leaves the rest alone", (): void => {
  const rows: Array<KubernetesCostAllocationIngestRow> = [
    {
      windowStart: "2026-07-24T10:00:00Z",
      windowEnd: "2026-07-24T11:00:00Z",
      namespace: "prod",
      podName: "api-abc",
      containerName: "api",
    },
    {
      windowStart: "2026-07-24T10:00:00Z",
      windowEnd: "2026-07-24T11:00:00Z",
      namespace: "prod",
      podName: "gone-xyz",
      containerName: "api",
    },
    // Idle sentinel rows have no pod or container and must be skipped.
    {
      windowStart: "2026-07-24T10:00:00Z",
      windowEnd: "2026-07-24T11:00:00Z",
      namespace: "__idle__",
    },
  ];

  attachMemoryPeaks({
    rows,
    peaks: new Map<string, number>([
      [
        peakKey({
          namespace: "prod",
          podName: "api-abc",
          containerName: "api",
        }),
        999,
      ],
    ]),
  });

  assert.strictEqual(rows[0]!.ramBytesUsageMax, 999);
  assert.strictEqual(rows[1]!.ramBytesUsageMax, undefined);
  assert.strictEqual(rows[2]!.ramBytesUsageMax, undefined);
});
