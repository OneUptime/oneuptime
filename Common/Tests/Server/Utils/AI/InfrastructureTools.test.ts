import {
  evaluateAgentReportedHealth,
  evaluateDockerResourceHealth,
  evaluateKubernetesContainerHealth,
  evaluateKubernetesResourceHealth,
  InfrastructureHealth,
  INFRASTRUCTURE_MAX_LIMIT,
  INFRASTRUCTURE_STALE_AFTER_MINUTES,
  InfrastructureResourceType,
  parseResourceType,
  QueryInfrastructureTool,
} from "../../../../Server/Utils/AI/Toolbox/InfrastructureTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import DockerResourceService from "../../../../Server/Services/DockerResourceService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import KubernetesContainerService from "../../../../Server/Services/KubernetesContainerService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import KubernetesContainer from "../../../../Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "../../../../Models/DatabaseModels/KubernetesResource";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerResource from "../../../../Models/DatabaseModels/DockerResource";
import Host from "../../../../Models/DatabaseModels/Host";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * query_infrastructure is the only tool that reads CURRENT state rather than
 * telemetry history, so these tests lock in the two things an investigation
 * depends on: the unhealthy predicate per resource family (the tool's whole
 * affordance — a false negative here silently hides an OOMKilled pod from the
 * model), and the never-throw / bounded-result posture every read tool shares.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const NOW: Date = new Date("2026-07-28T12:00:00Z");

function minutesAgo(minutes: number): Date {
  return OneUptimeDate.addRemoveMinutes(NOW, -1 * minutes);
}

function buildContainer(data?: {
  reason?: string;
  state?: string;
  isReady?: boolean;
  restartCount?: number;
}): KubernetesContainer {
  const container: KubernetesContainer = new KubernetesContainer();
  container._id = ObjectID.generate().toString();
  container.podNamespaceKey = "payments";
  container.podName = "checkout-7d9f";
  container.name = "api";
  container.image = "registry.local/checkout:1.4.2";
  container.state = data?.state ?? "running";
  if (data?.reason) {
    container.reason = data.reason;
  }
  container.isReady = data?.isReady ?? true;
  container.restartCount = data?.restartCount ?? 0;
  container.memoryLimitBytes = 512 * 1024 * 1024;
  container.latestMemoryBytes = 500 * 1024 * 1024;
  container.latestCpuPercent = 42.44;
  container.lastSeenAt = minutesAgo(1);

  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster.name = "prod-us-east";
  container.kubernetesCluster = cluster;

  return container;
}

/*
 * Every family query is stubbed to empty by default so a test can opt into
 * exactly one source. Without this the tool would hit a real database.
 */
function stubAllFamiliesEmpty(): void {
  for (const service of [
    KubernetesContainerService,
    KubernetesResourceService,
    KubernetesClusterService,
    DockerResourceService,
    DockerHostService,
    HostService,
    CloudResourceService,
    ServerlessFunctionService,
  ]) {
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("unhealthy predicate — Kubernetes containers", () => {
  test("a running, ready container with no restarts is healthy", () => {
    const health: InfrastructureHealth =
      evaluateKubernetesContainerHealth(buildContainer());

    expect(health.isUnhealthy).toBe(false);
    expect(health.signals).toEqual([]);
  });

  test("OOMKilled leads the signals, then restarts and readiness", () => {
    const health: InfrastructureHealth = evaluateKubernetesContainerHealth({
      state: "waiting",
      reason: "OOMKilled",
      isReady: false,
      restartCount: 14,
    });

    expect(health.isUnhealthy).toBe(true);
    expect(health.signals[0]).toBe("reason=OOMKilled");
    expect(health.signals).toContain("14 restarts");
    expect(health.signals).toContain("not ready");
    expect(health.signals).toContain("state=waiting");
  });

  test("restarts alone are a signal even when the container is back up", () => {
    const health: InfrastructureHealth = evaluateKubernetesContainerHealth({
      state: "running",
      isReady: true,
      restartCount: 3,
    });

    expect(health.isUnhealthy).toBe(true);
    expect(health.signals).toEqual(["3 restarts"]);
  });

  test("CrashLoopBackOff is caught by reason even without restarts recorded", () => {
    const health: InfrastructureHealth = evaluateKubernetesContainerHealth({
      state: "waiting",
      reason: "CrashLoopBackOff",
    });

    expect(health.isUnhealthy).toBe(true);
    expect(health.signals).toContain("reason=CrashLoopBackOff");
  });

  test("a Job container that ran to completion is NOT flagged", () => {
    /*
     * Job/CronJob pods sit in terminated/Completed/ready=false forever. Flagging
     * them would bury the real crash loops under noise.
     */
    const health: InfrastructureHealth = evaluateKubernetesContainerHealth({
      state: "terminated",
      reason: "Completed",
      isReady: false,
      restartCount: 0,
    });

    expect(health.isUnhealthy).toBe(false);
  });

  test("unobserved status (null isReady/state) is not a signal", () => {
    const health: InfrastructureHealth = evaluateKubernetesContainerHealth({
      state: undefined,
      reason: undefined,
      isReady: undefined,
      restartCount: undefined,
    });

    expect(health.isUnhealthy).toBe(false);
  });
});

describe("unhealthy predicate — Kubernetes resources (pods and nodes)", () => {
  test("Running and Succeeded phases are healthy", () => {
    expect(
      evaluateKubernetesResourceHealth({ phase: "Running" }).isUnhealthy,
    ).toBe(false);
    expect(
      evaluateKubernetesResourceHealth({ phase: "Succeeded" }).isUnhealthy,
    ).toBe(false);
  });

  test("Pending / Failed / Unknown phases are unhealthy", () => {
    for (const phase of ["Pending", "Failed", "Unknown"]) {
      const health: InfrastructureHealth = evaluateKubernetesResourceHealth({
        phase: phase,
      });
      expect(health.isUnhealthy).toBe(true);
      expect(health.signals).toContain(`phase=${phase}`);
    }
  });

  test("node pressure flags are each their own signal", () => {
    const health: InfrastructureHealth = evaluateKubernetesResourceHealth({
      isReady: false,
      hasMemoryPressure: true,
      hasDiskPressure: true,
      hasPidPressure: true,
    });

    expect(health.isUnhealthy).toBe(true);
    expect(health.signals).toEqual([
      "not ready",
      "memory pressure",
      "disk pressure",
      "pid pressure",
    ]);
  });

  test("a healthy node (no phase, ready, no pressure) is not flagged", () => {
    const health: InfrastructureHealth = evaluateKubernetesResourceHealth({
      isReady: true,
      hasMemoryPressure: false,
      hasDiskPressure: false,
      hasPidPressure: false,
    });

    expect(health.isUnhealthy).toBe(false);
  });

  test("a non-Pod kind with no phase is not flagged for the missing phase", () => {
    expect(
      evaluateKubernetesResourceHealth({ phase: undefined }).isUnhealthy,
    ).toBe(false);
  });
});

describe("unhealthy predicate — Docker resources", () => {
  test("running containers are healthy, everything else is not", () => {
    expect(evaluateDockerResourceHealth({ state: "running" }).isUnhealthy).toBe(
      false,
    );

    for (const state of ["exited", "paused", "restarting", "dead", "created"]) {
      const health: InfrastructureHealth = evaluateDockerResourceHealth({
        state: state,
      });
      expect(health.isUnhealthy).toBe(true);
      expect(health.signals).toEqual([`state=${state}`]);
    }
  });

  test("non-Container kinds (null state) are not flagged", () => {
    expect(evaluateDockerResourceHealth({ state: undefined }).isUnhealthy).toBe(
      false,
    );
  });
});

describe("unhealthy predicate — agent-reported resources", () => {
  test("connected and recently seen is healthy", () => {
    const health: InfrastructureHealth = evaluateAgentReportedHealth(
      { otelCollectorStatus: "connected", lastSeenAt: minutesAgo(2) },
      NOW,
    );

    expect(health.isUnhealthy).toBe(false);
  });

  test("a disconnected collector is a signal", () => {
    const health: InfrastructureHealth = evaluateAgentReportedHealth(
      { otelCollectorStatus: "disconnected", lastSeenAt: minutesAgo(1) },
      NOW,
    );

    expect(health.isUnhealthy).toBe(true);
    expect(health.signals).toContain("otel collector disconnected");
  });

  test("the staleness window has headroom for the ingest maintenance fence", () => {
    /*
     * lastSeenAt is legitimately ~5 minutes behind during healthy continuous
     * telemetry, so anything inside the window must stay healthy.
     */
    expect(INFRASTRUCTURE_STALE_AFTER_MINUTES).toBeGreaterThanOrEqual(15);

    const justInside: InfrastructureHealth = evaluateAgentReportedHealth(
      {
        otelCollectorStatus: "connected",
        lastSeenAt: minutesAgo(INFRASTRUCTURE_STALE_AFTER_MINUTES - 1),
      },
      NOW,
    );
    expect(justInside.isUnhealthy).toBe(false);

    const justOutside: InfrastructureHealth = evaluateAgentReportedHealth(
      {
        otelCollectorStatus: "connected",
        lastSeenAt: minutesAgo(INFRASTRUCTURE_STALE_AFTER_MINUTES + 1),
      },
      NOW,
    );
    expect(justOutside.isUnhealthy).toBe(true);
    expect(justOutside.signals[0]).toContain("no agent check-in");
  });

  test("a resource that never checked in is a signal", () => {
    const health: InfrastructureHealth = evaluateAgentReportedHealth(
      { otelCollectorStatus: "connected", lastSeenAt: undefined },
      NOW,
    );

    expect(health.isUnhealthy).toBe(true);
    expect(health.signals).toContain("never checked in");
  });
});

describe("query_infrastructure — arguments", () => {
  test("resourceType falls back to 'all' for anything unrecognized", () => {
    expect(parseResourceType("kubernetes")).toBe(
      InfrastructureResourceType.Kubernetes,
    );
    expect(parseResourceType("  DOCKER ")).toBe(
      InfrastructureResourceType.Docker,
    );
    expect(parseResourceType("nonsense")).toBe(InfrastructureResourceType.All);
    expect(parseResourceType(undefined)).toBe(InfrastructureResourceType.All);
  });

  test("limit is clamped to the documented maximum", async () => {
    stubAllFamiliesEmpty();
    const findBySpy: jest.SpyInstance = jest.spyOn(HostService, "findBy");

    await QueryInfrastructureTool.execute(
      { resourceType: "host", limit: 100000, unhealthyOnly: false },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(INFRASTRUCTURE_MAX_LIMIT);
    // Queries must run under the requesting user's props, never as root+.
    expect(callArgs["props"]).toBe(ctx.props);
  });

  test("limit below the floor is clamped up, not to zero", async () => {
    stubAllFamiliesEmpty();
    const findBySpy: jest.SpyInstance = jest.spyOn(HostService, "findBy");

    await QueryInfrastructureTool.execute(
      { resourceType: "host", limit: -20, unhealthyOnly: false },
      ctx,
    );

    const callArgs: JSONObject = findBySpy.mock.calls[0]?.[0] as JSONObject;
    expect(callArgs["limit"]).toBe(1);
  });

  test("resourceType scopes which services are queried at all", async () => {
    stubAllFamiliesEmpty();

    await QueryInfrastructureTool.execute({ resourceType: "kubernetes" }, ctx);

    expect(KubernetesContainerService.findBy).toHaveBeenCalled();
    expect(KubernetesResourceService.findBy).toHaveBeenCalled();
    expect(KubernetesClusterService.findBy).toHaveBeenCalled();
    expect(HostService.findBy).not.toHaveBeenCalled();
    expect(DockerResourceService.findBy).not.toHaveBeenCalled();
  });
});

describe("query_infrastructure — results", () => {
  test("an OOMKilled container comes back with a summary the model can read", async () => {
    stubAllFamiliesEmpty();
    jest.spyOn(KubernetesContainerService, "findBy").mockResolvedValue([
      buildContainer({
        state: "waiting",
        reason: "OOMKilled",
        isReady: false,
        restartCount: 14,
      }),
    ] as never);

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      { resourceType: "kubernetes", nameFilter: "checkout" },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(
      "k8s container payments/checkout-7d9f/api — reason=OOMKilled, 14 restarts, not ready",
    );
    expect(result.dataForLlm).toContain("health=unhealthy");
    expect(result.dataForLlm).toContain("cluster=prod-us-east");
    // The header must anchor the model on freshness, not just on the rows.
    expect(result.dataForLlm).toContain("live state, not history");
    expect(result.dataForLlm).toContain("lastSeenAt");
    expect(result.citationLabel).toContain("Infrastructure state");
    expect(result.citationLabel).toContain("unhealthy only");
    expect(result.widget).toBeDefined();
  });

  test("healthy rows are filtered out by default and kept when asked for", async () => {
    stubAllFamiliesEmpty();
    jest
      .spyOn(KubernetesContainerService, "findBy")
      .mockResolvedValue([buildContainer()] as never);

    const filtered: ToolExecutionResult = await QueryInfrastructureTool.execute(
      { resourceType: "kubernetes" },
      ctx,
    );
    expect(filtered.rowCount).toBe(0);
    expect(filtered.widget).toBeUndefined();

    const unfiltered: ToolExecutionResult =
      await QueryInfrastructureTool.execute(
        { resourceType: "kubernetes", unhealthyOnly: false },
        ctx,
      );
    expect(unfiltered.rowCount).toBe(1);
    expect(unfiltered.dataForLlm).toContain("no problem signals");
    expect(unfiltered.dataForLlm).toContain("health=ok");
  });

  test("nothing broken is an honest empty result, not an error", async () => {
    stubAllFamiliesEmpty();

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("(no rows found)");
    expect(result.widget).toBeUndefined();
    expect(result.isTruncated).toBe(false);
  });

  test("the same container returned by both unhealthy probes is not duplicated", async () => {
    stubAllFamiliesEmpty();

    // Both pushdown queries (isReady=false and restartCount>0) match this row.
    const container: KubernetesContainer = buildContainer({
      reason: "CrashLoopBackOff",
      state: "waiting",
      isReady: false,
      restartCount: 9,
    });

    jest
      .spyOn(KubernetesContainerService, "findBy")
      .mockResolvedValue([container] as never);

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      { resourceType: "kubernetes" },
      ctx,
    );

    expect(KubernetesContainerService.findBy).toHaveBeenCalledTimes(2);
    expect(result.rowCount).toBe(1);
  });

  test("results are capped at limit and the model is told it saw a slice", async () => {
    stubAllFamiliesEmpty();

    const containers: Array<KubernetesContainer> = [];
    for (let index: number = 0; index < 8; index++) {
      containers.push(
        buildContainer({ state: "waiting", reason: "ImagePullBackOff" }),
      );
    }

    jest
      .spyOn(KubernetesContainerService, "findBy")
      .mockResolvedValue(containers as never);

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      { resourceType: "kubernetes", limit: 3 },
      ctx,
    );

    expect(result.rowCount).toBe(3);
    expect(result.isTruncated).toBe(true);
    expect(result.dataForLlm).toContain("Showing 3 of 8 matching resources");
  });

  test("unhealthy resources sort ahead of healthy ones", async () => {
    stubAllFamiliesEmpty();

    const healthyNode: KubernetesResource = new KubernetesResource();
    healthyNode._id = ObjectID.generate().toString();
    healthyNode.kind = "Node";
    healthyNode.name = "node-a";
    healthyNode.isReady = true;
    healthyNode.lastSeenAt = minutesAgo(0);

    const pressuredNode: KubernetesResource = new KubernetesResource();
    pressuredNode._id = ObjectID.generate().toString();
    pressuredNode.kind = "Node";
    pressuredNode.name = "node-b";
    pressuredNode.isReady = true;
    pressuredNode.hasMemoryPressure = true;
    pressuredNode.lastSeenAt = minutesAgo(3);

    jest
      .spyOn(KubernetesResourceService, "findBy")
      .mockResolvedValue([healthyNode, pressuredNode] as never);

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      { resourceType: "kubernetes", unhealthyOnly: false },
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm.indexOf("node-b")).toBeLessThan(
      result.dataForLlm.indexOf("node-a"),
    );
  });

  test("archived resources are skipped even when their agent went away", async () => {
    stubAllFamiliesEmpty();

    const archivedHost: Host = new Host();
    archivedHost._id = ObjectID.generate().toString();
    archivedHost.name = "retired-box";
    archivedHost.otelCollectorStatus = "disconnected";
    archivedHost.lastSeenAt = minutesAgo(600);
    archivedHost.isArchived = true;

    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([archivedHost] as never);

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      { resourceType: "host" },
      ctx,
    );

    expect(result.rowCount).toBe(0);
  });

  test("a docker container that exited is reported with its host", async () => {
    stubAllFamiliesEmpty();

    const dockerHost: DockerHost = new DockerHost();
    dockerHost.name = "build-box";

    const resource: DockerResource = new DockerResource();
    resource._id = ObjectID.generate().toString();
    resource.kind = "Container";
    resource.name = "worker-1";
    resource.state = "exited";
    resource.imageName = "registry.local/worker:2.0";
    resource.lastSeenAt = minutesAgo(1);
    resource.dockerHost = dockerHost;

    jest
      .spyOn(DockerResourceService, "findBy")
      .mockResolvedValue([resource] as never);

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      { resourceType: "docker" },
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(
      "docker Container worker-1 — state=exited",
    );
    expect(result.dataForLlm).toContain("dockerHost=build-box");
  });
});

describe("query_infrastructure — resilience", () => {
  test("a failing service does not throw out of the tool", async () => {
    stubAllFamiliesEmpty();
    jest
      .spyOn(KubernetesContainerService, "findBy")
      .mockRejectedValue(new Error("connection terminated unexpectedly"));

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      { resourceType: "kubernetes" },
      ctx,
    );

    expect(result.rowCount).toBe(0);
  });

  test("one family failing still returns the families that worked", async () => {
    stubAllFamiliesEmpty();

    // A user without Kubernetes read access gets a permission error here.
    jest
      .spyOn(KubernetesContainerService, "findBy")
      .mockRejectedValue(new Error("not authorized"));

    const brokenHost: Host = new Host();
    brokenHost._id = ObjectID.generate().toString();
    brokenHost.name = "app-01";
    brokenHost.hostIdentifier = "app-01";
    brokenHost.otelCollectorStatus = "disconnected";
    brokenHost.lastSeenAt = minutesAgo(120);

    jest.spyOn(HostService, "findBy").mockResolvedValue([brokenHost] as never);

    const result: ToolExecutionResult = await QueryInfrastructureTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("host app-01");
    expect(result.dataForLlm).toContain("otel collector disconnected");
  });
});

describe("query_infrastructure — contract", () => {
  test("it is a read tool with permissions derived from the model ACLs", () => {
    expect(QueryInfrastructureTool.name).toBe("query_infrastructure");
    expect(QueryInfrastructureTool.isMutation).toBeFalsy();
    expect(QueryInfrastructureTool.requiredPermissions.length).toBeGreaterThan(
      0,
    );
  });

  test("the description tells the model this is current state, not history", () => {
    expect(QueryInfrastructureTool.description).toContain("CURRENT state");
    expect(QueryInfrastructureTool.description).toContain("lastSeenAt");
    expect(QueryInfrastructureTool.description).toContain("query_metrics");
    expect(QueryInfrastructureTool.description).toContain("search_logs");
  });
});
