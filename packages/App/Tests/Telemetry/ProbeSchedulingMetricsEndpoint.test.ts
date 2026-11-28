import {
  ExpressApplication,
  createExpressApp,
} from "Common/Server/Utils/Express";
import ProbeSchedulingFleetMetrics, {
  ProbeSchedulingFleetView,
  aggregateProbeScheduling,
} from "Common/Server/Utils/Probe/ProbeSchedulingFleetMetrics";
import { ProbeSchedulingMetrics } from "Common/Server/Utils/Probe/ProbeSchedulingMetrics";
import ProbeSchedulingLane from "Common/Server/Utils/Probe/ProbeSchedulingLane";
import { KeyedConcurrencyRefusal } from "Common/Server/Utils/KeyedConcurrencyLimiter";
import MetricsAPI from "../../API/Metrics";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";

/*
 * GET /metrics/probe-scheduling (issue #10819): how the App replicas hand
 * work to the probes, all of them together, as KEDA's metrics-api scaler
 * and an operator read it - over a real connection, from the App's own
 * metrics router, mounted where the App mounts it. And the other half of
 * the contract: the chart's app ScaledObject polls this path for the key
 * it reads (valueLocation), and the view has it.
 */

jest.mock("../../Services/Queue/AppQueueService", () => {
  return {
    __esModule: true,
    default: {
      getQueueBacklogSize: jest.fn(),
    },
  };
});

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface RunningServer {
  server: http.Server;
  origin: string;
}

async function listen(app: ExpressApplication): Promise<RunningServer> {
  const server: http.Server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

// A replica's view, as ProbeSchedulingMetrics keeps it, with some traffic.
function busyReplicaView(): ProbeSchedulingFleetView {
  const metrics: ProbeSchedulingMetrics = new ProbeSchedulingMetrics({
    replica: "app-1",
  });
  metrics.observe((lane: ProbeSchedulingLane) => {
    return lane === ProbeSchedulingLane.Work
      ? { running: 10, waiting: 23, maxConcurrentRequests: 10 }
      : { running: 0, waiting: 0, maxConcurrentRequests: 2 };
  });
  metrics.recordSlotWait(ProbeSchedulingLane.Work, 1800);
  metrics.recordRefusal(
    ProbeSchedulingLane.Work,
    KeyedConcurrencyRefusal.WaitedTooLong,
  );
  const now: number = Date.now();
  metrics.recordMonitorsHandedOut({
    handedOutAt: new Date(now),
    monitors: [
      { dueAt: new Date(now - 75_000), intervalInMs: 60_000 },
      { dueAt: new Date(now - 4_000), intervalInMs: 60_000 },
    ],
  });
  metrics.recordMonitorTestsHandedOut({
    handedOutAt: new Date(now),
    askedAt: [new Date(now - 3_000)],
  });
  // Backed up: some of its answers asked their connection to reconnect (#11392).
  for (let asked: number = 0; asked < 12; asked++) {
    metrics.recordReconnectAsked(ProbeSchedulingLane.Work);
  }
  metrics.recordReconnectAsked(ProbeSchedulingLane.MonitorTests);

  return aggregateProbeScheduling([metrics.snapshot()], true);
}

describe("GET /metrics/probe-scheduling", () => {
  let running: RunningServer | null = null;

  beforeEach(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use("/", MetricsAPI);
    running = await listen(app);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (running) {
      running.server.closeAllConnections();
      await new Promise<void>((resolve: () => void) => {
        running!.server.close(() => {
          resolve();
        });
      });
      running = null;
    }
  });

  test("answers the App replicas' view, as JSON, without a key", async () => {
    const view: ProbeSchedulingFleetView = busyReplicaView();
    jest.spyOn(ProbeSchedulingFleetMetrics, "read").mockResolvedValue(view);

    const response: globalThis.Response = await fetch(
      `${running!.origin}/metrics/probe-scheduling`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body: ProbeSchedulingFleetView =
      (await response.json()) as ProbeSchedulingFleetView;

    expect(body).toEqual(view);
    expect(body).toMatchObject({
      replicasReporting: 1,
      queueDepth: 23,
      slots: 10,
      refusalsPerMinute: 1,
      monitorsHandedOutPerMinute: 2,
      dispatchLagMaxSeconds: 75,
      monitorsLateByAnIntervalPerMinute: 1,
      monitorTestsHandedOutPerMinute: 1,
      monitorTestWaitMaxSeconds: 3,
      reconnectsAskedPerMinute: 13,
      monitorTestReconnectsAskedPerMinute: 1,
    });
    expect(body.replicas[0]).toMatchObject({
      queueDepth: 23,
      reconnectsAskedLastMinute: 13,
    });
  });

  test("names no replica: counts and durations only", async () => {
    jest
      .spyOn(ProbeSchedulingFleetMetrics, "read")
      .mockResolvedValue(busyReplicaView());

    const text: string = await (
      await fetch(`${running!.origin}/metrics/probe-scheduling`)
    ).text();

    expect(text).not.toContain("app-1");
  });

  test("an idle replica that has served no probe answers zeros, not an error", async () => {
    const response: globalThis.Response = await fetch(
      `${running!.origin}/metrics/probe-scheduling`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      queueDepth: 0,
      refusalsPerMinute: 0,
      reconnectsAskedPerMinute: 0,
    });
  });
});

describe("the chart's app ScaledObject and the route agree", () => {
  const keda: string = fs.readFileSync(
    path.join(
      REPO_ROOT,
      "HelmChart",
      "Public",
      "oneuptime",
      "templates",
      "keda-scaledobjects.yaml",
    ),
    "utf8",
  );

  test("it polls /metrics/probe-scheduling for queueDepth, a key of the view", () => {
    expect(keda).toContain(
      '"urlPath" "/metrics/probe-scheduling" "valueLocation" "queueDepth"',
    );
    expect(Object.keys(aggregateProbeScheduling([], true))).toContain(
      "queueDepth",
    );
  });

  test("the route is one the App's metrics router registers", () => {
    const source: string = fs.readFileSync(
      path.join(REPO_ROOT, "packages", "App", "API", "Metrics.ts"),
      "utf8",
    );
    expect(source).toContain('"/metrics/probe-scheduling"');
  });
});
