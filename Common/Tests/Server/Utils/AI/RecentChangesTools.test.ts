import {
  AGENT_SILENCE_THRESHOLD_MINUTES,
  RecentChangesTool,
} from "../../../../Server/Utils/AI/Toolbox/RecentChangesTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import DockerResourceService from "../../../../Server/Services/DockerResourceService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerResource from "../../../../Models/DatabaseModels/DockerResource";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import KubernetesResource from "../../../../Models/DatabaseModels/KubernetesResource";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import Permission from "../../../../Types/Permission";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * recent_changes is the "what changed right before this started?" tool, so the
 * infrastructure sources it grew — workloads that (re)started, agents that went
 * silent — have to behave exactly like the telemetry ones: bounded by the
 * window, bounded by limitPerSource, merged into one chronological feed, and
 * individually skippable when a source blows up.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

// Fixed clock so the silence cutoff (now - threshold) is deterministic.
const NOW: Date = new Date("2026-07-20T12:00:00.000Z");
const SILENCE_CUTOFF: Date = new Date("2026-07-20T11:45:00.000Z");

const WINDOW_START: string = "2026-07-20T10:00:00.000Z";
const WINDOW_END: string = "2026-07-20T12:00:00.000Z";

type FindBySpy = ReturnType<typeof jest.spyOn>;

interface Spies {
  exceptions: FindBySpy;
  monitorStatus: FindBySpy;
  maintenance: FindBySpy;
  kubernetesResource: FindBySpy;
  dockerResource: FindBySpy;
  kubernetesCluster: FindBySpy;
  host: FindBySpy;
  dockerHost: FindBySpy;
  cloudResource: FindBySpy;
  serverlessFunction: FindBySpy;
}

// Every source mocked empty by default; each test fills in what it cares about.
function mockAllSources(): Spies {
  return {
    exceptions: jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([] as never),
    monitorStatus: jest
      .spyOn(MonitorStatusTimelineService, "findBy")
      .mockResolvedValue([] as never),
    maintenance: jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([] as never),
    kubernetesResource: jest
      .spyOn(KubernetesResourceService, "findBy")
      .mockResolvedValue([] as never),
    dockerResource: jest
      .spyOn(DockerResourceService, "findBy")
      .mockResolvedValue([] as never),
    kubernetesCluster: jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([] as never),
    host: jest.spyOn(HostService, "findBy").mockResolvedValue([] as never),
    dockerHost: jest
      .spyOn(DockerHostService, "findBy")
      .mockResolvedValue([] as never),
    cloudResource: jest
      .spyOn(CloudResourceService, "findBy")
      .mockResolvedValue([] as never),
    serverlessFunction: jest
      .spyOn(ServerlessFunctionService, "findBy")
      .mockResolvedValue([] as never),
  };
}

function buildPod(data: {
  name: string;
  createdAt: Date;
  namespace?: string;
  deployment?: string;
  phase?: string;
}): KubernetesResource {
  const pod: KubernetesResource = new KubernetesResource();
  pod.kind = "Pod";
  pod.name = data.name;
  pod.namespaceKey = data.namespace ?? "prod";
  pod.phase = data.phase ?? "Running";
  if (data.deployment) {
    pod.controllerDeploymentName = data.deployment;
  }
  pod.resourceCreationTimestamp = data.createdAt;
  return pod;
}

function buildContainer(data: {
  name: string;
  createdAt: Date;
  image?: string;
}): DockerResource {
  const container: DockerResource = new DockerResource();
  container.kind = "Container";
  container.name = data.name;
  container.imageName = data.image ?? "checkout:1.4.2";
  container.state = "running";
  container.resourceCreationTimestamp = data.createdAt;
  return container;
}

/*
 * QueryHelper.inBetween rides in as a TypeORM Raw() find operator; its bound
 * values live on the public objectLiteralParameters getter, in insertion order
 * (start, end).
 */
function readRangeBounds(operator: unknown): Array<Date> {
  const parameters: JSONObject =
    ((operator as { objectLiteralParameters?: JSONObject })
      .objectLiteralParameters as JSONObject) ?? {};
  return Object.values(parameters) as Array<Date>;
}

function queryOf(spy: FindBySpy): JSONObject {
  const callArgs: JSONObject = spy.mock.calls[0]?.[0] as JSONObject;
  return callArgs["query"] as JSONObject;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("recent_changes — infrastructure sources in the merged feed", () => {
  test("workload starts and silent agents merge chronologically with the telemetry sources", async () => {
    const spies: Spies = mockAllSources();

    const exception: TelemetryException = new TelemetryException();
    exception.exceptionType = "TypeError";
    exception.message = "cannot read property id of undefined";
    exception.occuranceCount = 12;
    exception.firstSeenAt = new Date("2026-07-20T10:05:00.000Z");
    spies.exceptions.mockResolvedValue([exception] as never);

    const statusChange: MonitorStatusTimeline = new MonitorStatusTimeline();
    statusChange.createdAt = new Date("2026-07-20T10:30:00.000Z");
    spies.monitorStatus.mockResolvedValue([statusChange] as never);

    spies.kubernetesResource.mockResolvedValue([
      buildPod({
        name: "checkout-7f9c8",
        createdAt: new Date("2026-07-20T11:00:00.000Z"),
        deployment: "checkout",
      }),
    ] as never);

    spies.dockerResource.mockResolvedValue([
      buildContainer({
        name: "payments-worker",
        createdAt: new Date("2026-07-20T10:45:00.000Z"),
      }),
    ] as never);

    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.name = "prod-eks";
    cluster.lastSeenAt = new Date("2026-07-20T11:20:00.000Z");
    spies.kubernetesCluster.mockResolvedValue([cluster] as never);

    const host: Host = new Host();
    host.name = "web-01";
    host.lastSeenAt = new Date("2026-07-20T11:10:00.000Z");
    spies.host.mockResolvedValue([host] as never);

    const dockerHost: DockerHost = new DockerHost();
    dockerHost.name = "build-box";
    dockerHost.lastSeenAt = new Date("2026-07-20T10:50:00.000Z");
    spies.dockerHost.mockResolvedValue([dockerHost] as never);

    const cloudResource: CloudResource = new CloudResource();
    cloudResource.name = "orders-queue";
    cloudResource.lastSeenAt = new Date("2026-07-20T10:40:00.000Z");
    spies.cloudResource.mockResolvedValue([cloudResource] as never);

    const serverlessFunction: ServerlessFunction = new ServerlessFunction();
    serverlessFunction.name = "thumbnailer";
    serverlessFunction.lastSeenAt = new Date("2026-07-20T10:20:00.000Z");
    spies.serverlessFunction.mockResolvedValue([serverlessFunction] as never);

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END },
      ctx,
    );

    // 2 telemetry + 2 workload starts + 5 silent agents.
    expect(result.rowCount).toBe(9);

    expect(result.dataForLlm).toContain(
      "change=kubernetes_workload_started | detail=Pod prod/checkout-7f9c8 created | controller checkout | phase Running",
    );
    expect(result.dataForLlm).toContain(
      "change=docker_workload_started | detail=Container payments-worker created | image checkout:1.4.2 | state running",
    );
    expect(result.dataForLlm).toContain(
      "Kubernetes cluster prod-eks stopped reporting",
    );
    expect(result.dataForLlm).toContain("Host web-01 stopped reporting");
    expect(result.dataForLlm).toContain("Docker host build-box stopped");
    expect(result.dataForLlm).toContain("Cloud resource orders-queue stopped");
    expect(result.dataForLlm).toContain(
      "Serverless function thumbnailer stopped",
    );

    // One feed, most recent first — infrastructure interleaved with telemetry.
    const feedOrder: Array<string> = result.dataForLlm
      .split("\n")
      .map((line: string) => {
        return line.split("change=")[1]?.split(" |")[0] ?? "";
      });
    expect(feedOrder).toEqual([
      "agent_stopped_reporting", // 11:20 prod-eks
      "agent_stopped_reporting", // 11:10 web-01
      "kubernetes_workload_started", // 11:00 checkout-7f9c8
      "agent_stopped_reporting", // 10:50 build-box
      "docker_workload_started", // 10:45 payments-worker
      "agent_stopped_reporting", // 10:40 orders-queue
      "monitor_status_change", // 10:30
      "agent_stopped_reporting", // 10:20 thumbnailer
      "new_exception", // 10:05
    ]);

    expect(result.citationLabel).toContain("9 events");
  });

  test("every infrastructure query runs under the caller's props, never elevated", async () => {
    const spies: Spies = mockAllSources();

    await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END },
      ctx,
    );

    for (const spy of [
      spies.kubernetesResource,
      spies.dockerResource,
      spies.kubernetesCluster,
      spies.host,
      spies.dockerHost,
      spies.cloudResource,
      spies.serverlessFunction,
    ]) {
      const callArgs: JSONObject = spy.mock.calls[0]?.[0] as JSONObject;
      expect(callArgs["props"]).toBe(ctx.props);
    }
  });
});

describe("recent_changes — window filter", () => {
  test("workload starts are bounded by the requested window", async () => {
    const spies: Spies = mockAllSources();

    await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END },
      ctx,
    );

    for (const spy of [spies.kubernetesResource, spies.dockerResource]) {
      const bounds: Array<Date> = readRangeBounds(
        queryOf(spy)["resourceCreationTimestamp"],
      );
      expect(bounds).toHaveLength(2);
      expect(bounds[0]?.toISOString()).toBe(WINDOW_START);
      expect(bounds[1]?.toISOString()).toBe(WINDOW_END);
    }
  });

  test("a window that ends before the silence cutoff keeps its own end bound", async () => {
    const spies: Spies = mockAllSources();

    await RecentChangesTool.execute(
      {
        startTime: "2026-07-19T00:00:00.000Z",
        endTime: "2026-07-19T06:00:00.000Z",
      },
      ctx,
    );

    const bounds: Array<Date> = readRangeBounds(
      queryOf(spies.host)["lastSeenAt"],
    );
    expect(bounds[0]?.toISOString()).toBe("2026-07-19T00:00:00.000Z");
    expect(bounds[1]?.toISOString()).toBe("2026-07-19T06:00:00.000Z");
  });

  test("archived inventory is excluded from the silence sources", async () => {
    const spies: Spies = mockAllSources();

    await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END },
      ctx,
    );

    for (const spy of [
      spies.kubernetesCluster,
      spies.host,
      spies.dockerHost,
      spies.cloudResource,
      spies.serverlessFunction,
    ]) {
      expect(queryOf(spy)["isArchived"]).toBe(false);
    }
  });
});

describe("recent_changes — staleness classification", () => {
  test("the silence window stops at now minus the threshold, so still-reporting agents are not 'silent'", async () => {
    const spies: Spies = mockAllSources();

    await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END },
      ctx,
    );

    for (const spy of [
      spies.kubernetesCluster,
      spies.host,
      spies.dockerHost,
      spies.cloudResource,
      spies.serverlessFunction,
    ]) {
      const bounds: Array<Date> = readRangeBounds(queryOf(spy)["lastSeenAt"]);
      expect(bounds[0]?.toISOString()).toBe(WINDOW_START);
      // Not WINDOW_END (= now): a heartbeat at 11:50 is fresh, not silence.
      expect(bounds[1]?.toISOString()).toBe(SILENCE_CUTOFF.toISOString());
    }
  });

  test("a window entirely newer than the threshold skips the silence sources instead of guessing", async () => {
    const spies: Spies = mockAllSources();

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {
        startTime: "2026-07-20T11:50:00.000Z",
        endTime: "2026-07-20T12:00:00.000Z",
      },
      ctx,
    );

    for (const spy of [
      spies.kubernetesCluster,
      spies.host,
      spies.dockerHost,
      spies.cloudResource,
      spies.serverlessFunction,
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }

    // The workload sources still run for that window.
    expect(spies.kubernetesResource).toHaveBeenCalled();
    expect(spies.dockerResource).toHaveBeenCalled();
    expect(result.rowCount).toBe(0);
  });

  test("the threshold is the platform's own disconnect threshold", () => {
    expect(AGENT_SILENCE_THRESHOLD_MINUTES).toBe(15);
  });
});

describe("recent_changes — limitPerSource", () => {
  test("bounds each new source's query and the silence group as a whole", async () => {
    const spies: Spies = mockAllSources();

    // Every silence model returns its full budget: 5 x 3 = 15 candidates.
    const silentRows: Array<Host> = [1, 2, 3].map((minute: number): Host => {
      const host: Host = new Host();
      host.name = `box-${minute}`;
      host.lastSeenAt = new Date(`2026-07-20T10:0${minute}:00.000Z`);
      return host;
    });

    for (const spy of [
      spies.kubernetesCluster,
      spies.host,
      spies.dockerHost,
      spies.cloudResource,
      spies.serverlessFunction,
    ]) {
      spy.mockResolvedValue(silentRows as never);
    }

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END, limitPerSource: 3 },
      ctx,
    );

    for (const spy of [
      spies.kubernetesResource,
      spies.dockerResource,
      spies.kubernetesCluster,
      spies.host,
      spies.dockerHost,
      spies.cloudResource,
      spies.serverlessFunction,
    ]) {
      const callArgs: JSONObject = spy.mock.calls[0]?.[0] as JSONObject;
      expect(callArgs["limit"]).toBe(3);
    }

    /*
     * The five silence models share one budget — otherwise inventory churn
     * would crowd every other source out of the merged feed.
     */
    expect(result.rowCount).toBe(3);
  });

  test("clamps an out-of-range limitPerSource", async () => {
    const spies: Spies = mockAllSources();

    await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END, limitPerSource: 9999 },
      ctx,
    );

    const callArgs: JSONObject = spies.kubernetesResource.mock
      .calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(30);
  });
});

describe("recent_changes — per-source resilience", () => {
  test("a failing infrastructure source does not break the rest of the feed", async () => {
    const spies: Spies = mockAllSources();

    spies.kubernetesResource.mockRejectedValue(
      new Error("kubernetes_resource query timed out") as never,
    );
    spies.host.mockRejectedValue(new Error("host query timed out") as never);

    spies.dockerResource.mockResolvedValue([
      buildContainer({
        name: "payments-worker",
        createdAt: new Date("2026-07-20T10:45:00.000Z"),
      }),
    ] as never);

    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.name = "prod-eks";
    cluster.lastSeenAt = new Date("2026-07-20T11:20:00.000Z");
    spies.kubernetesCluster.mockResolvedValue([cluster] as never);

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END },
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("payments-worker");
    expect(result.dataForLlm).toContain(
      "Kubernetes cluster prod-eks stopped reporting",
    );
    // The sibling silence models still ran even though Host threw.
    expect(spies.dockerHost).toHaveBeenCalled();
    expect(spies.serverlessFunction).toHaveBeenCalled();
  });

  test("every source failing is honest: zero rows, no throw", async () => {
    const spies: Spies = mockAllSources();

    for (const spy of Object.values(spies)) {
      spy.mockRejectedValue(new Error("database unavailable") as never);
    }

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      { startTime: WINDOW_START, endTime: WINDOW_END },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe("(no rows found)");
  });
});

describe("recent_changes — permissions", () => {
  test("required permissions cover the infrastructure models' read ACLs", () => {
    const permissions: Array<Permission> =
      RecentChangesTool.requiredPermissions;

    // Still gated on the monitor/telemetry side.
    expect(permissions).toContain(Permission.ReadProjectMonitor);

    // And now on the infrastructure inventory the feed reads.
    expect(permissions).toContain(Permission.ReadKubernetesCluster);
    expect(permissions).toContain(Permission.ReadDockerHost);
    expect(permissions).toContain(Permission.ReadHost);
    expect(permissions).toContain(Permission.ReadCloudResource);
    expect(permissions).toContain(Permission.ReadServerlessFunction);

    // Derived from read ACLs only — no write permission leaks into the gate.
    expect(permissions).not.toContain(Permission.EditHost);
    expect(permissions).not.toContain(Permission.DeleteKubernetesCluster);

    // Deduped across the eight models it unions.
    expect(new Set(permissions).size).toBe(permissions.length);
  });
});
