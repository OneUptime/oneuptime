import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MAX_DESCRIPTION_LENGTH,
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import {
  DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS,
  DOCKER_SWARM_METRIC_DESCRIPTIONS,
  DockerSwarmInsightsChart,
  DockerSwarmMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/DockerSwarmMetricDescriptions";
import { extractDockerSwarmInventoryResource } from "../../../Types/DockerSwarm/DockerSwarmInventoryExtractor";
import {
  METRIC_STALE_MS,
  toInfrastructureResource,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";
import {
  DOCKER_SWARM_READINGS_STALE_MS,
  DOCKER_SWARM_TASK_CPU_WARNING_PERCENT,
  DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT,
  assessDockerSwarmNode,
  assessDockerSwarmService,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmHealth";
import DockerSwarmResourceModel from "../../../Models/DatabaseModels/DockerSwarmResource";
import {
  getStatusBadgeClass,
  InfrastructureResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";

/*
 * The plain-English texts behind every (i) on the Docker Swarm cluster pages
 * (and the line under each Insights chart title).
 *
 * The rules (length, finished sentences, no placeholders) are checked for
 * every module by MetricDescriptionsCatalog.test.ts; this file adds the
 * accuracy anchors - each claim a text makes is checked against the code
 * that produces the number, so the words cannot drift from the fetch:
 *
 *  - counts come from the agent's inventory snapshot (inventory-snapshot.sh
 *    and DockerSwarmInventoryExtractor), not from a time range, and the pages
 *    read only the newest snapshot's rows;
 *  - states and colours are the swarm's rules (DockerSwarmHealth);
 *  - only Task rows are given CPU/memory at ingest, so the Nodes and
 *    Services lists have no usage columns;
 *  - every page hides readings older than 15 minutes, a task's page too;
 *  - the Insights charts read docker_stats' own scale (100% = one core).
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..", "..");

function readRepoFile(...segments: Array<string>): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

function readDashboardFile(...segments: Array<string>): string {
  return readRepoFile(
    "packages",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    ...segments,
  );
}

const AGENT_SNAPSHOT_SCRIPT: string = readRepoFile(
  "agents",
  "DockerSwarmAgent",
  "inventory-snapshot.sh",
);
const AGENT_COLLECTOR_CONFIG: string = readRepoFile(
  "agents",
  "DockerSwarmAgent",
  "otel-collector-config.yaml",
);
const METRICS_INGEST: string = readRepoFile(
  "packages",
  "App",
  "FeatureSet",
  "Telemetry",
  "Services",
  "OtelMetricsIngestService.ts",
);
const INSIGHTS_PAGE: string = readDashboardFile(
  "Pages",
  "DockerSwarm",
  "View",
  "Insights.tsx",
);

const T: Record<DockerSwarmMetric, string> = DOCKER_SWARM_METRIC_DESCRIPTIONS;
const CHART: Record<DockerSwarmInsightsChart, string> =
  DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS;

// The source between two markers, for checking one function at a time.
function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  expect(start).toBeGreaterThan(-1);

  const end: number = source.indexOf(to, start + from.length);

  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

function taskRow(minutesSinceReading: number): DockerSwarmResourceModel {
  const row: DockerSwarmResourceModel = new DockerSwarmResourceModel();
  row.kind = "Task";
  row.externalId = "task/abc";
  row.name = "web.1";
  row.latestCpuPercent = 12.5;
  row.latestMemoryBytes = 64 * 1024 * 1024;
  row.metricsUpdatedAt = new Date(Date.now() - minutesSinceReading * 60_000);

  return row;
}

function serviceRow(
  running: number,
  desired: number,
  attributes: Record<string, string> = {},
): DockerSwarmResourceModel {
  const row: DockerSwarmResourceModel = new DockerSwarmResourceModel();
  row.kind = "Service";
  row.externalId = "service/web";
  row.name = "shop_web";
  row.serviceMode = "replicated";
  row.runningReplicas = running;
  row.desiredReplicas = desired;
  row.attributes = attributes;
  return row;
}

// Title shown on the page -> the description it is paired with.
const TITLED: Array<[string, string]> = [
  ["Swarm health", T.clusterHealth],
  ["Swarm inventory counts", T.inventoryCounts],
  ["Role", T.managers],
  ["Status", T.nodeStatus],
  ["Manager Status", T.managerStatus],
  ["Availability", T.availability],
  ["Status", T.serviceStatus],
  ["Status", T.serviceStatusColumn],
  ["Last Update", T.serviceUpdate],
  ["Failed Tasks (Last Hour)", T.recentFailedTasks],
  ["Last Task Error", T.lastTaskError],
  ["Replicas", T.replicas],
  ["Status", T.taskStatus],
  ["Desired State", T.taskDesiredState],
  ["CPU", T.taskCpu],
  ["Memory", T.taskMemory],
  ["CPU", T.taskCpuColumn],
  ["Memory", T.taskMemoryColumn],
  ["Services", T.stackServices],
  ["Status", T.stackStatusColumn],
  ["Nodes", T.clusterListNodes],
  ["Services", T.clusterListServices],
  ["Tasks", T.clusterListTasks],
  ["Cluster CPU Utilization", CHART.clusterCpu],
  ["Cluster Memory Utilization", CHART.clusterMemoryPercent],
  ["Task Memory Usage", CHART.taskMemory],
  ["Top Tasks by CPU", CHART.topTasksCpu],
  ["Top Tasks by Memory", CHART.topTasksMemory],
  ["Task Process Count", CHART.taskProcesses],
];

const RAW_METRIC_NAME: RegExp = /\bcontainer\.[a-z_.]+/;
const WHITESPACE: RegExp = /\s+/g;
const EVERY_CONTAINER_CLAIM: RegExp = /every container is drawn/i;
const RANKED_BY_MAX: RegExp = /rankBy: "max" as const/;
const TASKS_WANTED_FIRST: RegExp = /^Tasks Swarm wants running/;
const CLAIMS_A_RANGE: RegExp = /selected range|time range|past hour/i;
const NODES_WITHOUT_THE_AGENT: RegExp = /nodes without the agent/;
const LINGERS: RegExp = /25 minutes|until it is pruned|lingers?/i;

describe("Docker Swarm metric descriptions read well", () => {
  test("every tooltip text passes the shared rules and none repeats another", () => {
    expectReadableDescriptionRecord(
      DOCKER_SWARM_METRIC_DESCRIPTIONS,
      "DOCKER_SWARM_METRIC_DESCRIPTIONS",
    );
  });

  test("every Insights chart line passes the shared rules and none repeats another", () => {
    expectReadableDescriptionRecord(
      DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS,
      "DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS",
    );
  });

  test.each(TITLED)(
    "%s is explained by its text",
    (title: string, text: string) => {
      expectTitleExplained(title, text);
      expect(text.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    },
  );

  test("every text is paired with a title on a page", () => {
    const paired: Set<string> = new Set(
      TITLED.map((entry: [string, string]): string => {
        return entry[1];
      }),
    );
    for (const text of [...Object.values(T), ...Object.values(CHART)]) {
      expect(paired.has(text)).toBe(true);
    }
  });

  test("no text leans on a raw metric name - the chart's own (i) already shows that", () => {
    for (const text of [...Object.values(T), ...Object.values(CHART)]) {
      expect(text).not.toMatch(RAW_METRIC_NAME);
    }
  });

  test("the chart lines are not also tooltip texts", () => {
    for (const text of Object.values(CHART)) {
      expect(Object.values(T)).not.toContain(text);
    }
  });
});

describe("states and counts describe the inventory snapshot, not a time range", () => {
  const SNAPSHOT_TEXTS: Array<DockerSwarmMetric> = [
    "managers",
    "inventoryCounts",
    "nodeStatus",
    "managerStatus",
    "availability",
    "serviceStatus",
    "serviceStatusColumn",
    "replicas",
    "stackServices",
    "stackStatusColumn",
    "clusterListNodes",
    "clusterListServices",
    "clusterListTasks",
  ];

  test.each(SNAPSHOT_TEXTS)(
    "%s never claims a selected range",
    (key: DockerSwarmMetric) => {
      expect(T[key]).not.toMatch(CLAIMS_A_RANGE);
    },
  );

  test("the snapshot cadence the texts quote is the agent's default", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'INTERVAL="${DOCKER_INVENTORY_INTERVAL_SECONDS:-300}"',
    );
    expect(T.inventoryCounts).toContain("latest inventory snapshot");
    expect(T.inventoryCounts).toContain("every 5 minutes by default");
    expect(T.inventoryCounts).toContain("Each count opens its list");
  });

  test("a replaced task is gone at the next snapshot: the pages read only the newest one", () => {
    const fetchRows: string = between(
      readDashboardFile(
        "Pages",
        "DockerSwarm",
        "Utils",
        "DockerSwarmResourceUtils.ts",
      ),
      "export async function fetchDockerSwarmInventoryRows(",
      "\n}\n",
    );
    expect(fetchRows).toContain(
      "return keepLatestDockerSwarmSnapshot(result.data);",
    );
    for (const text of Object.values(T)) {
      expect(text).not.toMatch(LINGERS);
    }
  });

  test("the node's state is the managers' (Status.State), and drained or paused is no problem", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain("Status: .Status.State,");
    const down: ReturnType<typeof extractDockerSwarmInventoryResource> =
      extractDockerSwarmInventoryResource({
        kind: "Node",
        logBody: JSON.stringify({
          data: { ID: "n1", Hostname: "a", Status: "down", ManagerStatus: "" },
        }),
        lastSeenAt: new Date(),
      });
    expect(down!.resource.isReady).toBe(false);

    expect(T.nodeStatus).toContain("Ready, Down or Disconnected");
    expect(T.nodeStatus).toContain("Unreachable for a manager");
    expect(T.nodeStatus).toContain("Drained or Paused");
    expect(T.nodeStatus).toContain("not a problem by itself");

    const drained: DockerSwarmResourceModel = new DockerSwarmResourceModel();
    drained.kind = "Node";
    drained.state = "ready";
    drained.attributes = { availability: "drain" };
    expect(assessDockerSwarmNode(drained).severity).toBeNull();
  });

  test("a manager's standing is docker node ls's MANAGER STATUS, an unreachable one included", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'elif . == "unreachable" then "Unreachable"',
    );
    expect(T.managerStatus).toContain("as docker node ls shows it");
    expect(T.managerStatus).toContain("more than half of its managers");
  });

  test("Managers are the nodes with a manager status, and the text does not say they never run tasks", () => {
    const manager: ReturnType<typeof extractDockerSwarmInventoryResource> =
      extractDockerSwarmInventoryResource({
        kind: "Node",
        logBody: JSON.stringify({
          data: {
            ID: "n1",
            Hostname: "a",
            Status: "ready",
            ManagerStatus: "Leader",
          },
        }),
        lastSeenAt: new Date(),
      });

    expect(manager!.resource.role).toBe("manager");
    expect(T.managers).toContain("can run tasks too");
    expect(T.managers).toContain("worker");
  });

  test("a service's status names its colours the way the rules pick them", () => {
    const now: Date = new Date();
    expect(T.serviceStatus).toContain("2 of 3 running");
    expect(T.serviceStatus).toContain("Red when none run");
    expect(assessDockerSwarmService(serviceRow(0, 3), now).status.tone).toBe(
      "danger",
    );
    expect(T.serviceStatus).toContain(
      "amber when some are missing and no rolling update explains it",
    );
    expect(assessDockerSwarmService(serviceRow(2, 3), now).status.tone).toBe(
      "warning",
    );
    expect(
      assessDockerSwarmService(
        serviceRow(2, 3, { updateState: "updating" }),
        now,
      ).status.tone,
    ).toBe("neutral");
    expect(T.serviceStatus).toContain(
      "grey when it is scaled to zero or a job that ran to completion",
    );
    expect(assessDockerSwarmService(serviceRow(0, 0), now).status.tone).toBe(
      "neutral",
    );
  });

  test("Replicas: the agent always sends running/desired, and a global service wants a copy per eligible node", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'Replicas: (((.ServiceStatus.RunningTasks // 0)|tostring) + "/" + ((.ServiceStatus.DesiredTasks',
    );
    expect(T.replicas).toContain("2/3 means one is missing");
    expect(T.replicas).toContain("global service wants one copy on every");
  });

  test("a rolling update's words are Docker's UpdateStatus, and failed tasks count the agent's hour", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'UpdateState: (.UpdateStatus.State // ""),',
    );
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'FAILED_TASK_WINDOW_SECONDS="${DOCKER_INVENTORY_FAILED_TASK_WINDOW_SECONDS:-3600}"',
    );
    expect(T.serviceUpdate).toContain("as Docker reports it");
    expect(T.recentFailedTasks).toContain("in the last hour");
    expect(T.recentFailedTasks).toContain("three or more needs a look");
    expect(T.lastTaskError).toContain("ERROR column");
  });

  test("a task's state: amber past its memory limit's line, where the alert fires", () => {
    expect(T.taskStatus).toContain(
      `more than ${DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT}% of its memory limit`,
    );
    expect(T.taskDesiredState).toContain("as docker service ps shows it");
  });
});

describe("the Stacks list: a service count, not a health check", () => {
  function stackRow(): DockerSwarmResourceModel {
    const parsed: ReturnType<typeof extractDockerSwarmInventoryResource> =
      extractDockerSwarmInventoryResource({
        kind: "Stack",
        logBody: JSON.stringify({ data: { Name: "shop", Services: "3" } }),
        lastSeenAt: new Date(),
      });

    expect(parsed).not.toBeNull();

    const row: DockerSwarmResourceModel = new DockerSwarmResourceModel();
    Object.assign(row, parsed!.resource);

    return row;
  }

  test("the agent counts every service carrying the stack label, whatever its replicas", () => {
    // All services are fetched, with no filter on their state.
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'fetch "/services?status=true" > "${SERVICES_JSON}"',
    );
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      '[.[] | .Spec.Labels["com.docker.stack.namespace"] // empty]',
    );
    expect(AGENT_SNAPSHOT_SCRIPT).toContain("Services: (length|tostring)");

    expect(T.stackServices).toContain("carry this stack's name");
    expect(T.stackServices).toContain("whatever their state");
    expect(T.stackServices).toContain("including ones scaled to 0");
    expect(T.stackServices).toContain("every 5 minutes by default");
  });

  test("the Services column and the Status column show the same number", () => {
    const resource: InfrastructureResource =
      toInfrastructureResource(stackRow());

    expect(resource.additionalAttributes["serviceCount"]).toBe("3");
    expect(resource.status).toBe("3 services");
  });

  test("the Status badge for a stack is grey, never green or red, as a count should be", () => {
    const resource: InfrastructureResource =
      toInfrastructureResource(stackRow());

    expect(getStatusBadgeClass(resource.status)).toBe(
      "bg-gray-50 text-gray-700",
    );
    expect(T.stackStatusColumn).toContain("only repeats its service count");
    expect(T.stackStatusColumn).toContain("it is not a health check");
    expect(T.stackStatusColumn).toContain("Services list");
  });
});

describe("the Clusters list reads the counts cached on the cluster row", () => {
  const LOGS_INGEST: string = readRepoFile(
    "packages",
    "App",
    "FeatureSet",
    "Telemetry",
    "Services",
    "OtelLogsIngestService.ts",
  ).replace(WHITESPACE, " ");
  const CLUSTER_SERVICE: string = readRepoFile(
    "packages",
    "Common",
    "Server",
    "Services",
    "DockerSwarmClusterService.ts",
  ).replace(WHITESPACE, " ");

  // The counts are derived from one inventory batch, right after its upsert.
  const counts: string = between(
    LOGS_INGEST,
    "const sawKind: Set<string> = new Set(",
    "await DockerSwarmClusterService.updateLastSeen(",
  );

  function taskIsRunning(currentState: string): boolean | null {
    const parsed: ReturnType<typeof extractDockerSwarmInventoryResource> =
      extractDockerSwarmInventoryResource({
        kind: "Task",
        logBody: JSON.stringify({
          data: { ID: "t1", Name: "web.1", CurrentState: currentState },
        }),
        lastSeenAt: new Date(),
      });

    return parsed!.resource.isReady;
  }

  test("each count is the snapshot's own rows of that kind", () => {
    expect(counts).toContain('extras.nodeCount = countOf("Node");');
    expect(counts).toContain('return r.kind === "Node" && r.isReady === true;');
    expect(counts).toContain('extras.serviceCount = countOf("Service");');
    expect(counts).toContain('extras.taskCount = countOf("Task");');
    expect(counts).toContain('return r.kind === "Task" && r.isReady === true;');

    for (const text of [
      T.clusterListNodes,
      T.clusterListServices,
      T.clusterListTasks,
    ]) {
      expect(text).toContain("latest inventory snapshot");
      // Rewritten from each snapshot, so nothing lingers until pruning.
      expect(text).not.toContain("25 minutes");
    }
  });

  test("a change in any count is written at once, not held back by the heartbeat throttle", () => {
    for (const field of [
      "nodeCount",
      "readyNodeCount",
      "serviceCount",
      "taskCount",
      "runningTaskCount",
    ]) {
      expect(CLUSTER_SERVICE).toContain(`${field}: extra?.${field} ?? null,`);
    }
  });

  test("Nodes: ready out of total, where ready is the state the managers report", () => {
    const readyNode: ReturnType<typeof extractDockerSwarmInventoryResource> =
      extractDockerSwarmInventoryResource({
        kind: "Node",
        logBody: JSON.stringify({
          data: { ID: "n1", Hostname: "a", Status: "ready", ManagerStatus: "" },
        }),
        lastSeenAt: new Date(),
      });

    expect(readyNode!.resource.isReady).toBe(true);
    expect(T.clusterListNodes).toContain("shown as ready out of total");
    expect(T.clusterListNodes).toContain("the managers see the node as up");
    expect(T.clusterListNodes).toContain(
      "turns red when any node is not ready",
    );
  });

  test("Services: every service in the snapshot, short of replicas or not", () => {
    expect(T.clusterListServices).toContain("whatever their state");
    expect(T.clusterListServices).toContain("including ones scaled to 0");
    // Which ones run short is on the Overview, not on this list.
    expect(T.clusterListServices).toContain("Overview");
  });

  test("Tasks: running out of the tasks Swarm wants running", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'select(.DesiredState == "running")',
    );
    expect(taskIsRunning("running")).toBe(true);
    expect(taskIsRunning("starting")).toBe(false);
    expect(taskIsRunning("failed")).toBe(false);

    expect(T.clusterListTasks).toMatch(TASKS_WANTED_FIRST);
    expect(T.clusterListTasks).toContain("one task is one container");
    expect(T.clusterListTasks).toContain("how many are actually running");
  });
});

describe("CPU and memory texts match what the rows actually carry", () => {
  const flush: string = between(
    METRICS_INGEST,
    "private static async flushDockerSwarmTaskMetrics",
    "private static bufferDockerSnapshotMetric",
  );

  test("ingest mirrors CPU/memory onto Task rows only, so the Nodes and Services lists have no usage columns", () => {
    expect(flush).toContain('kind: "Task"');
    expect(flush).not.toMatch(/kind: "(Node|Service)"/);

    for (const page of ["Nodes.tsx", "Services.tsx"]) {
      expect(readDashboardFile("Pages", "DockerSwarm", "View", page)).toContain(
        "showResourceMetrics={false}",
      );
    }
    expect(
      readDashboardFile("Pages", "DockerSwarm", "View", "Tasks.tsx"),
    ).not.toContain("showResourceMetrics={false}");
  });

  test("every page hides readings older than 15 minutes, a task's own page too, and its texts say so", () => {
    expect(METRIC_STALE_MS).toBe(15 * 60 * 1000);
    expect(DOCKER_SWARM_READINGS_STALE_MS).toBe(METRIC_STALE_MS);

    const fresh: InfrastructureResource = toInfrastructureResource(taskRow(1));
    const stale: InfrastructureResource = toInfrastructureResource(taskRow(16));

    expect(fresh.cpuUtilization).toBe(12.5);
    expect(fresh.memoryUsageBytes).toBe(64 * 1024 * 1024);
    expect(stale.cpuUtilization).toBeNull();
    expect(stale.memoryUsageBytes).toBeNull();

    const taskOverview: string = readDashboardFile(
      "Components",
      "DockerSwarm",
      "Part",
      "DockerSwarmTaskOverview.tsx",
    );
    expect(taskOverview).toContain(
      "getDockerSwarmTaskReadings(row, props.now)",
    );

    expect(T.taskCpuColumn).toContain(
      "Shown only when the reading is under 15 minutes old",
    );
    expect(T.taskMemoryColumn).toContain(
      "Shown only when the reading is under 15 minutes old",
    );
    expect(T.taskCpu).toContain("more than 15 minutes old is not shown");
    expect(T.taskMemory).toContain("more than 15 minutes old is not shown");
  });

  test("the bars turn amber at the alerts' lines, and the texts name both", () => {
    expect(T.taskCpu).toContain(
      `Amber past ${DOCKER_SWARM_TASK_CPU_WARNING_PERCENT}%, where the High Task CPU Usage alert fires`,
    );
    expect(T.taskCpuColumn).toContain(
      `amber past ${DOCKER_SWARM_TASK_CPU_WARNING_PERCENT}%, where the High Task CPU Usage alert fires`,
    );
    expect(T.taskMemory).toContain(
      `Amber past ${DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT}%, where the High Task Memory Usage alert fires`,
    );
    expect(T.taskMemoryColumn).toContain(
      `amber past ${DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT}%, where the High Task Memory Usage alert fires`,
    );
  });

  test("docker_stats reads only the local daemon, so tasks on nodes without the agent have no reading", () => {
    expect(AGENT_COLLECTOR_CONFIG).toContain(
      "endpoint: unix:///var/run/docker.sock",
    );
    expect(AGENT_COLLECTOR_CONFIG).toContain("collection_interval: 30s");
    expect(T.taskCpuColumn).toMatch(NODES_WITHOUT_THE_AGENT);
    expect(T.taskMemoryColumn).toMatch(NODES_WITHOUT_THE_AGENT);
    expect(T.taskCpu).toContain("every 30 seconds");
  });

  test("memory reads against the limit, or the node's memory when the service sets none (docker stats' MEM %)", () => {
    for (const text of [T.taskMemory, T.taskMemoryColumn]) {
      expect(text).toContain("percent of its memory limit");
      expect(text).toContain("node's memory when the service sets none");
    }
    /*
     * docker_stats subtracts only INACTIVE file cache (inactive_file), the
     * way docker stats does - the same metric and the same words as the
     * Docker and Podman host pages. Recently used cache is still counted,
     * so "cache the system can reclaim" would overstate what is left out.
     */
    expect(CHART.taskMemory).toContain(
      "file cache the system has not used recently",
    );
    expect(CHART.taskMemory).not.toContain("reclaim");
  });

  /*
   * docker_stats reports a percent (100 = one core) under the unit "1", and
   * ingest used to multiply every "1" by 100 again on its way to the Task
   * row, so these texts named no scale. The metric loop now reads a
   * docker_stats percent's "1" as "%" (ContainerStatsPercentUnit) before the
   * Task buffer sees it, and cpuValueToPercent takes a "%" as it is: the
   * row holds the percent, and the texts say what 100% is.
   */
  test("task CPU names its scale, now that ingest mirrors docker_stats' percent as it is", () => {
    const metricLoopUnit: string = between(
      METRICS_INGEST,
      "const metricUnit: string =",
      ";\n",
    );
    expect(metricLoopUnit).toContain(
      "ContainerStatsPercentUnit.getStoredUnit(",
    );
    expect(metricLoopUnit).toContain("scopeName: scopeName");

    const taskBuffer: string = between(
      METRICS_INGEST,
      "this.bufferDockerSwarmTaskMetric({",
      "});",
    );
    expect(taskBuffer).toContain("metricUnit,");

    const cpuToPercent: string = between(
      METRICS_INGEST,
      "private static cpuValueToPercent(",
      "\n  }\n",
    );
    expect(cpuToPercent).toContain(
      'if (unit === "%") {\n      return rawValue;',
    );

    for (const text of [T.taskCpu, T.taskCpuColumn]) {
      expect(text).toMatch(/100% is one full CPU core/);
    }
  });
});

describe("Insights chart lines match their queries", () => {
  type Spec = { title: string; aggregation: string; key: string };

  const SPEC_PATTERN: RegExp =
    /title: "([^"]+)",\s*description:\s*DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS\.(\w+),[\s\S]*?aggregation: AggregationType\.(\w+)/g;

  const specs: Array<Spec> = Array.from(
    INSIGHTS_PAGE.matchAll(SPEC_PATTERN),
  ).map((match: RegExpMatchArray): Spec => {
    return { title: match[1]!, key: match[2]!, aggregation: match[3]! };
  });

  test("every chart on the page takes its line from the record, once each", () => {
    expect(
      specs
        .map((spec: Spec) => {
          return spec.key;
        })
        .sort(),
    ).toEqual(Object.keys(CHART).sort());
  });

  test("averaged charts say averaged; max charts say highest and that only the top 10 are drawn by default", () => {
    for (const spec of specs) {
      const text: string = CHART[spec.key as DockerSwarmInsightsChart];

      if (spec.aggregation === "Avg") {
        expect(text).toContain("averaged per interval");
        expect(text).not.toMatch(/highest/i);
      } else {
        expect(spec.aggregation).toBe("Max");
        expect(text).toMatch(/^The highest/);
        expect(text).toContain(
          "By default only the 10 containers that peaked highest are drawn",
        );
      }
    }
  });

  test("no chart line claims every container is drawn - MetricView caps grouped charts at the top 10 by peak", () => {
    /*
     * EmbeddedMetricCard renders MetricView, which opts in to the default
     * server-side Top-N (10 series, ranked by each series' max) and shows a
     * "Showing top k of N" banner with a Show all control.
     */
    const metricsDir: Array<string> = [
      "packages",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "Metrics",
    ];
    const metricUtils: string = readRepoFile(
      ...metricsDir,
      "Utils",
      "Metrics.ts",
    );
    const metricView: string = readRepoFile(...metricsDir, "MetricView.tsx");
    const embedded: string = readRepoFile(
      ...metricsDir,
      "EmbeddedMetricCard.tsx",
    );

    expect(INSIGHTS_PAGE).toContain("<EmbeddedMetricCard");
    expect(embedded).toContain("<MetricView");
    expect(metricView).toContain("defaultTopN: true");
    expect(metricUtils).toContain(
      "export const DEFAULT_TOP_N_SERIES: number = 10;",
    );
    expect(metricUtils).toMatch(RANKED_BY_MAX);

    for (const text of Object.values(CHART)) {
      expect(text).not.toMatch(EVERY_CONTAINER_CLAIM);
    }
  });

  test("CPU charts read docker_stats' own scale, where 100% is one core, and say so", () => {
    expect(INSIGHTS_PAGE).not.toContain("host-CPU");
    expect(CHART.clusterCpu).toMatch(/^100% is one full CPU core/);
    expect(CHART.clusterCpu).toContain("can go above 100%");
    // The same words as the Docker and Podman host pages, which read the same metric.
    expect(CHART.topTasksCpu).toContain("100% is one full CPU core");
  });

  test("the memory percent line does not promise a limit the service may not set", () => {
    expect(CHART.clusterMemoryPercent).toContain("memory limit");
    expect(CHART.clusterMemoryPercent).toContain(
      "node's total memory when the service sets no limit",
    );
  });

  test("the process line counts threads too (the pids controller counts both)", () => {
    expect(CHART.taskProcesses).toMatch(/^Processes and threads/);
  });

  test("chart lines put the containers the agent can see, not the whole swarm", () => {
    expect(CHART.clusterCpu).toContain(
      "on the nodes where the OneUptime agent runs",
    );
  });
});
