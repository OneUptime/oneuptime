import { HEALTH_PORT } from "./TestEnv";
import * as assert from "assert";
import * as http from "http";
import { after, before, test } from "node:test";
import { toScrapeTargetGroups } from "../EngineMetrics";
import { CostPrometheus, CostPrometheusSource } from "../EnginePrometheus";
import {
  assessHealth,
  describeCostPrometheus,
  startHealthServer,
} from "../Health";
import { Poller } from "../Poller";
import { Shipper } from "../Shipper";
import {
  CostEngineSource,
  EngineAllocation,
  EngineMetricsSource,
  HealthReport,
  KubernetesCostEngineInfo,
  PollerStatus,
  ScrapeTargetGroup,
  ShipperStatus,
} from "../Types";

/*
 * The health verdict. assessHealth is pure — statuses in, verdict out — so
 * every case here is exact arithmetic rather than a slept-through clock.
 *
 * TestEnv pins WINDOW_SECONDS=60 and LOOKBACK_WINDOWS=2, and the health
 * thresholds are left at their defaults (HEALTH_STALE_WINDOWS=3,
 * HEALTH_MAX_POLL_FAILURES=3), so:
 *
 *   stale     = 3 windows = 3 minutes of no completed window
 *   ship grace= (2 + 3) windows = 5 minutes before "never shipped" counts
 */

const NOW: number = Date.parse("2026-07-24T12:00:00.000Z");
const WINDOW_MS: number = 60 * 1000;
const STALE_MS: number = 3 * WINDOW_MS;
const FIRST_SHIP_GRACE_MS: number = 5 * WINDOW_MS;

function pollerStatus(overrides: Partial<PollerStatus> = {}): PollerStatus {
  return {
    startedAtMs: NOW,
    lastWindowCompletedAtMs: 0,
    windowsCompleted: 0,
    consecutivePollFailures: 0,
    lastPollError: null,
    ...overrides,
  };
}

function shipperStatus(overrides: Partial<ShipperStatus> = {}): ShipperStatus {
  return { lastShipOkAtMs: 0, lastShipError: null, ...overrides };
}

function assess(
  poller: Partial<PollerStatus>,
  shipper: Partial<ShipperStatus> = {},
): HealthReport {
  return assessHealth({
    poller: pollerStatus(poller),
    shipper: shipperStatus(shipper),
    nowMs: NOW,
  });
}

// -- The grace period: silence right after boot is not a fault --------------

test("a just-started agent waiting for its first closed window is ok", (): void => {
  // Nothing polled, nothing shipped, no errors — the normal first seconds.
  const report: HealthReport = assess({ startedAtMs: NOW - 5 * 1000 });

  assert.strictEqual(report.healthy, true);
  assert.strictEqual(report.status, "ok");
  assert.deepStrictEqual(report.reasons, []);
});

test("empty lookback windows on a fresh install do not trip the never-shipped check", (): void => {
  /*
   * The boot-time shape this must tolerate: on a fresh install the
   * LOOKBACK_WINDOWS windows predate the cost engine, so they drain with
   * zero allocations and nothing ships. That is healthy until well past
   * the point a real window should have landed.
   */
  const report: HealthReport = assess(
    {
      startedAtMs: NOW - (FIRST_SHIP_GRACE_MS - 1000),
      lastWindowCompletedAtMs: NOW - 1000,
      windowsCompleted: 2,
    },
    { lastShipOkAtMs: 0 },
  );

  assert.strictEqual(report.healthy, true);
  assert.deepStrictEqual(report.reasons, []);
});

test("one failing tick is not yet a fault", (): void => {
  const report: HealthReport = assess({
    startedAtMs: NOW - 30 * 1000,
    consecutivePollFailures: 1,
    lastPollError: "connect ECONNREFUSED 10.0.0.1:9003",
  });

  assert.strictEqual(report.healthy, true);
  // The error is still reported, it just is not a verdict yet.
  assert.match(report.lastPollError || "", /ECONNREFUSED/);
});

// -- The outage this fix exists for ----------------------------------------

test("an engine that never answers is degraded, not ok", (): void => {
  /*
   * The customer outage: OpenCost could not write /var/configs, its
   * Allocation API never answered, the poller retried its oldest window
   * forever, and — because a failed fetch never reaches the shipper — the
   * shipper stayed spotless and /healthz answered 200 indefinitely.
   */
  const report: HealthReport = assess({
    startedAtMs: NOW - 6 * 60 * 60 * 1000,
    lastWindowCompletedAtMs: 0,
    consecutivePollFailures: 72,
    lastPollError:
      "Cost engine answered HTTP 500 for /allocation/compute: no cost model",
  });

  assert.strictEqual(report.healthy, false);
  assert.strictEqual(report.status, "degraded");
  assert.strictEqual(report.windowsCompleted, 0);

  const reasons: string = report.reasons.join(" | ");
  assert.match(reasons, /72 consecutive ticks/);
  assert.match(reasons, /no cost window has completed/);
  assert.match(reasons, /no cost allocations have ever shipped/);
  /*
   * Nothing completed a window here, so the never-shipped reason must not
   * blame the engine's allocations — the poll never got that far, and the
   * reasons above already name the real fault.
   */
  assert.doesNotMatch(reasons, /the engine answered/);
});

test("a poll erroring on consecutive ticks is degraded before any window is due", (): void => {
  // Fast signal: real errors, so it needs no time grace to be believed.
  const report: HealthReport = assess({
    startedAtMs: NOW - 60 * 1000,
    consecutivePollFailures: 3,
    lastPollError: "connect ECONNREFUSED 10.0.0.1:9003",
  });

  assert.strictEqual(report.healthy, false);
  assert.strictEqual(report.reasons.length, 1);
  assert.match(report.reasons[0]!, /3 consecutive ticks/);
  assert.match(report.reasons[0]!, /ECONNREFUSED/);
});

// -- Stalls that are not throwing ------------------------------------------

test("no window completed within the stale span is degraded even with no error", (): void => {
  const report: HealthReport = assess({
    startedAtMs: NOW - (STALE_MS + 1000),
    lastWindowCompletedAtMs: 0,
    consecutivePollFailures: 0,
    lastPollError: null,
  });

  assert.strictEqual(report.healthy, false);
  assert.strictEqual(report.reasons.length, 1);
  assert.match(report.reasons[0]!, /no cost window has completed/);
});

test("a pipeline that made progress and then went quiet is degraded", (): void => {
  const report: HealthReport = assess(
    {
      startedAtMs: NOW - 24 * 60 * 60 * 1000,
      lastWindowCompletedAtMs: NOW - (STALE_MS + 60 * 1000),
      windowsCompleted: 20,
    },
    { lastShipOkAtMs: NOW - (STALE_MS + 60 * 1000) },
  );

  assert.strictEqual(report.healthy, false);
  assert.strictEqual(report.reasons.length, 1);
  assert.match(report.reasons[0]!, /last cost window completed 4 minutes ago/);
});

test("windows draining but nothing ever shipped is degraded past the grace", (): void => {
  /*
   * The engine answers 200 with an empty allocation set forever, so windows
   * complete happily and only the never-shipped signal catches it.
   */
  const report: HealthReport = assess(
    {
      startedAtMs: NOW - (FIRST_SHIP_GRACE_MS + 1000),
      lastWindowCompletedAtMs: NOW - 1000,
      windowsCompleted: 6,
    },
    { lastShipOkAtMs: 0 },
  );

  assert.strictEqual(report.healthy, false);
  assert.strictEqual(report.reasons.length, 1);
  assert.match(report.reasons[0]!, /no cost allocations have ever shipped/);
  // Windows drained, so the reason points at the engine's empty answers.
  assert.match(report.reasons[0]!, /the engine answered 6 windows/);
});

test("a never-shipped agent names the ship error when there is one", (): void => {
  const report: HealthReport = assess(
    {
      startedAtMs: NOW - (FIRST_SHIP_GRACE_MS + 1000),
      lastWindowCompletedAtMs: NOW - 1000,
      windowsCompleted: 6,
    },
    { lastShipOkAtMs: 0, lastShipError: "OneUptime answered HTTP 401" },
  );

  assert.strictEqual(report.healthy, false);
  assert.match(report.reasons.join(" | "), /HTTP 401/);
});

// -- Healthy steady state ---------------------------------------------------

test("an agent shipping on schedule is ok", (): void => {
  const report: HealthReport = assess(
    {
      startedAtMs: NOW - 24 * 60 * 60 * 1000,
      lastWindowCompletedAtMs: NOW - 30 * 1000,
      windowsCompleted: 24,
    },
    { lastShipOkAtMs: NOW - 30 * 1000 },
  );

  assert.strictEqual(report.healthy, true);
  assert.strictEqual(report.status, "ok");
  assert.deepStrictEqual(report.reasons, []);
  assert.strictEqual(report.windowsCompleted, 24);
  assert.strictEqual(report.uptimeSeconds, 24 * 60 * 60);
});

test("a transient ship failure that has since recovered is ok", (): void => {
  // lastShipError lingers after a recovery; it must not be a verdict by itself.
  const report: HealthReport = assess(
    {
      startedAtMs: NOW - 24 * 60 * 60 * 1000,
      lastWindowCompletedAtMs: NOW - 30 * 1000,
      windowsCompleted: 24,
    },
    {
      lastShipOkAtMs: NOW - 30 * 1000,
      lastShipError: "OneUptime answered HTTP 500",
    },
  );

  assert.strictEqual(report.healthy, true);
  assert.match(report.lastShipError || "", /HTTP 500/);
});

// -- What the kubelet actually sees ----------------------------------------

interface Stubs {
  poller: PollerStatus;
  shipper: ShipperStatus;
}

const stubs: Stubs = {
  poller: pollerStatus(),
  shipper: shipperStatus(),
};

let server: http.Server;

// What the engine stub says about itself; nothing until a test sets it.
const engineStubState: {
  info: KubernetesCostEngineInfo | undefined;
  url: string | undefined;
} = { info: undefined, url: undefined };

// Where the engine's price metrics are; nothing found until a test sets it.
const metricsStubState: { url: string | null; reason: string } = {
  url: null,
  reason: "",
};

// Where the memory peaks are read; nothing found until a test sets it.
const prometheusStubState: {
  prometheus: CostPrometheus | null;
  reason: string;
} = { prometheus: null, reason: "" };

const prometheusStub: CostPrometheusSource = {
  current: (): CostPrometheus | null => {
    return prometheusStubState.prometheus;
  },
  reason: (): string => {
    return prometheusStubState.prometheus ? "" : prometheusStubState.reason;
  },
  refreshIfDue: (): Promise<void> => {
    return Promise.resolve();
  },
};

before(async (): Promise<void> => {
  const pollerStub: Poller = {
    status: (): PollerStatus => {
      return stubs.poller;
    },
  } as unknown as Poller;
  const shipperStub: Shipper = {
    status: (): ShipperStatus => {
      return stubs.shipper;
    },
  } as unknown as Shipper;

  const engineStub: CostEngineSource = {
    fetchAllocations: async (): Promise<Array<EngineAllocation>> => {
      return [];
    },
    describe: (): KubernetesCostEngineInfo | undefined => {
      return engineStubState.info;
    },
    engineUrl: (): string | undefined => {
      return engineStubState.url;
    },
  };

  const metricsStub: EngineMetricsSource = {
    url: (): string | null => {
      return metricsStubState.url;
    },
    reason: (): string => {
      return metricsStubState.reason;
    },
    targetGroups: (): Array<ScrapeTargetGroup> => {
      return toScrapeTargetGroups(metricsStubState.url);
    },
  };

  server = startHealthServer({
    poller: pollerStub,
    shipper: shipperStub,
    engine: engineStub,
    metrics: metricsStub,
    prometheus: prometheusStub,
  });
  await new Promise<void>((resolve: () => void): void => {
    server.once("listening", resolve);
    if (server.listening) {
      resolve();
    }
  });
});

after(async (): Promise<void> => {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
});

async function get(
  path: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise(
    (
      resolve: (value: { statusCode: number; body: string }) => void,
      reject: (reason: Error) => void,
    ): void => {
      const req: http.ClientRequest = http.get(
        { host: "127.0.0.1", port: HEALTH_PORT, path },
        (res: http.IncomingMessage): void => {
          const chunks: Array<Buffer> = [];
          res.on("data", (chunk: Buffer): void => {
            chunks.push(chunk);
          });
          res.on("end", (): void => {
            resolve({
              statusCode: res.statusCode || 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      req.on("error", reject);
    },
  );
}

test("/healthz answers 200 while the agent is within its grace period", async (): Promise<void> => {
  stubs.poller = pollerStatus({ startedAtMs: Date.now() });
  stubs.shipper = shipperStatus();

  const res: { statusCode: number; body: string } = await get("/healthz");

  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body, /"status":"ok"/);
});

test("/healthz answers 503 once the pipeline is demonstrably stalled", async (): Promise<void> => {
  stubs.poller = pollerStatus({
    startedAtMs: Date.now() - 6 * 60 * 60 * 1000,
    consecutivePollFailures: 40,
    lastPollError: "Cost engine answered HTTP 500 for /allocation/compute",
  });
  stubs.shipper = shipperStatus();

  const res: { statusCode: number; body: string } = await get("/healthz");

  assert.strictEqual(res.statusCode, 503);
  assert.match(res.body, /"status":"degraded"/);
  // troubleshoot.sh greps these two keys out of the body — keep them.
  assert.match(res.body, /"lastPollError":"Cost engine answered HTTP 500/);
  assert.match(res.body, /"lastShipError":null/);
});

test("/livez stays 200 while degraded so a dead engine cannot crash-loop the pod", async (): Promise<void> => {
  stubs.poller = pollerStatus({
    startedAtMs: Date.now() - 6 * 60 * 60 * 1000,
    consecutivePollFailures: 40,
    lastPollError: "Cost engine answered HTTP 500 for /allocation/compute",
  });
  stubs.shipper = shipperStatus();

  const live: { statusCode: number; body: string } = await get("/livez");
  const ready: { statusCode: number; body: string } = await get("/healthz");

  assert.strictEqual(live.statusCode, 200);
  assert.match(live.body, /"status":"alive"/);
  assert.strictEqual(ready.statusCode, 503);
});

/*
 * #9633: `kubectl port-forward` to /healthz answers "which engine does the
 * agent read?" - and troubleshoot.sh probes the engine at that address.
 */
test("/healthz names the engine the agent reads, where, and where its prices come from", async (): Promise<void> => {
  stubs.poller = pollerStatus({ startedAtMs: Date.now() });
  stubs.shipper = shipperStatus();
  engineStubState.info = {
    engine: "Kubecost",
    service: "kubecost/kubecost-cost-analyzer",
    bundledEngineUnused: true,
    pricingSource: "list-prices",
    pricingProvider: "AWS",
  };
  engineStubState.url = "http://kubecost-cost-analyzer.kubecost.svc:9090";

  const res: { statusCode: number; body: string } = await get("/healthz");
  const body: Record<string, unknown> = JSON.parse(res.body) as Record<
    string,
    unknown
  >;

  assert.deepStrictEqual(body["costEngine"], engineStubState.info);
  assert.strictEqual(
    body["costEngineUrl"],
    "http://kubecost-cost-analyzer.kubecost.svc:9090",
  );
  // The keys troubleshoot.sh parses are all still there.
  assert.ok("status" in body);
  assert.ok("lastPollError" in body);
  assert.ok("lastShipError" in body);

  engineStubState.info = undefined;
  engineStubState.url = undefined;
});

test("/healthz says nothing of an engine before the agent has one", async (): Promise<void> => {
  stubs.poller = pollerStatus({ startedAtMs: Date.now() });
  stubs.shipper = shipperStatus();

  const res: { statusCode: number; body: string } = await get("/healthz");
  const body: Record<string, unknown> = JSON.parse(res.body) as Record<
    string,
    unknown
  >;

  assert.ok(!("costEngine" in body));
  assert.ok(!("costEngineUrl" in body));
  assert.ok(!("costEngineMetricsUrl" in body));
  assert.ok(!("costEngineMetricsError" in body));
});

/*
 * #9776: the collector's cost-engine job asks /scrape-targets where the
 * engine in use serves its price metrics (Prometheus http_sd), so a Kubecost
 * named by its frontend is not scraped at its web UI.
 */
async function getScrapeTargets(): Promise<{
  statusCode: number;
  contentType: string;
  groups: unknown;
}> {
  return new Promise(
    (
      resolve: (value: {
        statusCode: number;
        contentType: string;
        groups: unknown;
      }) => void,
      reject: (reason: Error) => void,
    ): void => {
      const req: http.ClientRequest = http.get(
        { host: "127.0.0.1", port: HEALTH_PORT, path: "/scrape-targets" },
        (res: http.IncomingMessage): void => {
          const chunks: Array<Buffer> = [];
          res.on("data", (chunk: Buffer): void => {
            chunks.push(chunk);
          });
          res.on("end", (): void => {
            resolve({
              statusCode: res.statusCode || 0,
              contentType: String(res.headers["content-type"] || ""),
              groups: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          });
        },
      );
      req.on("error", reject);
    },
  );
}

test("/scrape-targets tells the collector where the engine's price metrics are, as http_sd JSON", async (): Promise<void> => {
  metricsStubState.url =
    "http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090/model/metrics";

  const res: { statusCode: number; contentType: string; groups: unknown } =
    await getScrapeTargets();

  assert.strictEqual(res.statusCode, 200);
  // Prometheus' http_sd refuses any other content type.
  assert.strictEqual(res.contentType, "application/json");
  assert.deepStrictEqual(res.groups, [
    {
      targets: ["kubecost-cost-analyzer.kubecost.svc.cluster.local:9090"],
      labels: { __scheme__: "http", __metrics_path__: "/model/metrics" },
    },
  ]);

  metricsStubState.url = null;
});

test("/scrape-targets is an empty list until the price metrics are found", async (): Promise<void> => {
  const res: { statusCode: number; contentType: string; groups: unknown } =
    await getScrapeTargets();

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.groups, []);
});

test("/scrape-targets answers while the allocations are degraded: prices do not wait on them", async (): Promise<void> => {
  stubs.poller = pollerStatus({
    startedAtMs: Date.now() - 6 * 60 * 60 * 1000,
    consecutivePollFailures: 40,
    lastPollError: "Cost engine answered HTTP 500 for /model/allocation",
  });
  stubs.shipper = shipperStatus();
  metricsStubState.url = "http://kubecost-finopsagent.kubecost.svc:80/metrics";

  const ready: { statusCode: number; body: string } = await get("/healthz");
  const targets: { statusCode: number; contentType: string; groups: unknown } =
    await getScrapeTargets();

  assert.strictEqual(ready.statusCode, 503);
  assert.strictEqual(targets.statusCode, 200);
  assert.deepStrictEqual(targets.groups, [
    {
      targets: ["kubecost-finopsagent.kubecost.svc:80"],
      labels: { __scheme__: "http", __metrics_path__: "/metrics" },
    },
  ]);

  metricsStubState.url = null;
});

test("/healthz says where the engine's price metrics are scraped", async (): Promise<void> => {
  stubs.poller = pollerStatus({ startedAtMs: Date.now() });
  stubs.shipper = shipperStatus();
  engineStubState.url = "http://kubecost-frontend.kubecost.svc:9090";
  metricsStubState.url = "http://kubecost-finopsagent.kubecost.svc:80/metrics";

  const res: { statusCode: number; body: string } = await get("/healthz");
  const body: Record<string, unknown> = JSON.parse(res.body) as Record<
    string,
    unknown
  >;

  assert.strictEqual(
    body["costEngineMetricsUrl"],
    "http://kubecost-finopsagent.kubecost.svc:80/metrics",
  );
  assert.ok(!("costEngineMetricsError" in body));
  // Near the start, beside the engine, where troubleshoot.sh reads it.
  assert.ok(
    res.body.indexOf('"costEngineMetricsUrl"') < res.body.indexOf('"status"'),
  );

  engineStubState.url = undefined;
  metricsStubState.url = null;
});

test("/healthz says why no price metrics were found", async (): Promise<void> => {
  stubs.poller = pollerStatus({ startedAtMs: Date.now() });
  stubs.shipper = shipperStatus();
  metricsStubState.reason =
    "https://kubecost.example.com/metrics: a web page (text/html), not metrics";

  const res: { statusCode: number; body: string } = await get("/healthz");
  const body: Record<string, unknown> = JSON.parse(res.body) as Record<
    string,
    unknown
  >;

  assert.ok(!("costEngineMetricsUrl" in body));
  assert.strictEqual(
    body["costEngineMetricsError"],
    "https://kubecost.example.com/metrics: a web page (text/html), not metrics",
  );

  metricsStubState.reason = "";
});

/*
 * #9777: /healthz says which Prometheus the memory peaks are read from - the
 * cluster's own engine's, the bundled one, or cost.engine.prometheusUrl - or,
 * plainly, why there is none.
 */
test("/healthz names the Prometheus the memory peaks are read from, and how it was found", async (): Promise<void> => {
  stubs.poller = pollerStatus({ startedAtMs: Date.now() });
  stubs.shipper = shipperStatus();
  prometheusStubState.prometheus = {
    url: "http://kubecost-prometheus-server.kubecost",
    origin: "engine",
    source:
      "PROMETHEUS_SERVER_ENDPOINT of container cost-model, from ConfigMap kubecost/kubecost-cost-analyzer of pod kubecost/kubecost-cost-analyzer-1",
    cadvisorJob: "kubernetes-nodes-cadvisor",
    cluster: null,
    note: "",
  };

  const res: { statusCode: number; body: string } = await get("/healthz");
  const body: Record<string, unknown> = JSON.parse(res.body) as Record<
    string,
    unknown
  >;

  assert.strictEqual(
    body["costPrometheusUrl"],
    "http://kubecost-prometheus-server.kubecost",
  );
  assert.deepStrictEqual(body["costPrometheus"], {
    origin: "engine",
    source:
      "PROMETHEUS_SERVER_ENDPOINT of container cost-model, from ConfigMap kubecost/kubecost-cost-analyzer of pod kubecost/kubecost-cost-analyzer-1",
    cadvisorJob: "kubernetes-nodes-cadvisor",
  });
  assert.ok(!("costPrometheusError" in body));
  // The keys troubleshoot.sh parses are all still there.
  assert.ok("status" in body);
  assert.ok("lastPollError" in body);

  prometheusStubState.prometheus = null;
});

test("/healthz says plainly why no Prometheus was found for the memory peaks", async (): Promise<void> => {
  stubs.poller = pollerStatus({ startedAtMs: Date.now() });
  stubs.shipper = shipperStatus();
  prometheusStubState.reason =
    "the pods of kubecost3/kubecost-frontend set no PROMETHEUS_SERVER_ENDPOINT (Kubecost 3 reads no Prometheus); no Kubecost Prometheus Service in namespace kubecost3";

  const res: { statusCode: number; body: string } = await get("/healthz");
  const body: Record<string, unknown> = JSON.parse(res.body) as Record<
    string,
    unknown
  >;

  assert.ok(!("costPrometheusUrl" in body));
  assert.ok(!("costPrometheus" in body));
  assert.strictEqual(body["costPrometheusError"], prometheusStubState.reason);
  // Peaks are an enrichment: none found never fails readiness.
  assert.strictEqual(res.statusCode, 200);

  prometheusStubState.reason = "";
});

test("/healthz never shows the credentials in a Prometheus's address", (): void => {
  const described: {
    costPrometheusUrl?: string;
    costPrometheus?: unknown;
    costPrometheusError?: string;
  } = describeCostPrometheus({
    current: (): CostPrometheus | null => {
      return {
        url: "https://reader:s3cret@prometheus.example.com/prom",
        origin: "configured",
        source: "cost.engine.prometheusUrl",
        cadvisorJob: "kubelet",
        cluster: { label: "cluster_id", value: "prod-eu" },
        note: "",
      };
    },
    reason: (): string => {
      return "";
    },
    refreshIfDue: (): Promise<void> => {
      return Promise.resolve();
    },
  });

  assert.strictEqual(
    described.costPrometheusUrl,
    "https://prometheus.example.com/prom",
  );
  assert.ok(!JSON.stringify(described).includes("s3cret"));
  assert.deepStrictEqual(described.costPrometheus, {
    origin: "configured",
    source: "cost.engine.prometheusUrl",
    cadvisorJob: "kubelet",
    cluster: { label: "cluster_id", value: "prod-eu" },
  });
  assert.deepStrictEqual(describeCostPrometheus(undefined), {});
});
