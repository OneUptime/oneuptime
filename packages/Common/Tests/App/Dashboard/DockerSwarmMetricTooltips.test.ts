import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
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
 *    and DockerSwarmInventoryExtractor), not from a time range;
 *  - only Task rows are given CPU/memory at ingest, so the Nodes and
 *    Services columns are always N/A;
 *  - the lists hide readings older than METRIC_STALE_MS, the task page not;
 *  - the Insights charts read docker_stats' own scale (100% = one core).
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..", "..");

function readRepoFile(...segments: Array<string>): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
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
const INSIGHTS_PAGE: string = readRepoFile(
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
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

function serviceReadiness(replicas: string): boolean | null {
  const parsed: ReturnType<typeof extractDockerSwarmInventoryResource> =
    extractDockerSwarmInventoryResource({
      kind: "Service",
      logBody: JSON.stringify({
        data: {
          ID: "svc1",
          Name: "web",
          Mode: "replicated",
          Replicas: replicas,
        },
      }),
      lastSeenAt: new Date(),
    });

  expect(parsed).not.toBeNull();

  return parsed!.resource.isReady;
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

// Title shown on the page -> the description it is paired with.
const TITLED: Array<[string, string]> = [
  ["Nodes", T.nodes],
  ["Nodes ready", T.nodes],
  ["Managers", T.managers],
  ["Services", T.services],
  ["Tasks", T.tasks],
  ["Tasks running", T.tasks],
  ["Stacks", T.stacks],
  ["Networks", T.networks],
  ["Volumes", T.volumes],
  ["Status", T.serviceStatus],
  ["Status", T.serviceStatusColumn],
  ["Replicas", T.replicas],
  ["CPU", T.taskCpu],
  ["Memory", T.taskMemory],
  ["CPU", T.taskCpuColumn],
  ["Memory", T.taskMemoryColumn],
  ["CPU", T.nodeUsageColumns],
  ["Memory", T.nodeUsageColumns],
  ["CPU", T.serviceUsageColumns],
  ["Memory", T.serviceUsageColumns],
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
const CUTOFF_ANCHORED_TO_CLUSTER: RegExp =
  /getStaleThresholdDate\(\s*cluster\.lastSeenAt/;
const EVERY_CONTAINER_CLAIM: RegExp = /every container is drawn/i;
const RANKED_BY_MAX: RegExp = /rankBy: "max" as const/;
const TASKS_WANTED_FIRST: RegExp = /^Tasks Swarm wants running/;

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
      expect(text.length).toBeLessThanOrEqual(260);
    },
  );

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

describe("overview counts describe the inventory snapshot, not a time range", () => {
  const INVENTORY_COUNTS: Array<DockerSwarmMetric> = [
    "nodes",
    "managers",
    "services",
    "tasks",
    "stacks",
    "networks",
    "volumes",
    "serviceStatus",
    "serviceStatusColumn",
    "replicas",
    "stackServices",
    "stackStatusColumn",
    "clusterListNodes",
    "clusterListServices",
    "clusterListTasks",
  ];

  test.each(INVENTORY_COUNTS)(
    "%s never claims a selected range",
    (key: DockerSwarmMetric) => {
      expect(T[key]).not.toMatch(/selected range|time range|past hour/i);
    },
  );

  test("the snapshot cadence the texts quote is the agent's default", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'INTERVAL="${DOCKER_INVENTORY_INTERVAL_SECONDS:-300}"',
    );
    expect(T.nodes).toContain("latest inventory snapshot");
    expect(T.nodes).toContain("every 5 minutes by default");
  });

  test("Nodes explains Ready as the node state the managers report", () => {
    const ready: ReturnType<typeof extractDockerSwarmInventoryResource> =
      extractDockerSwarmInventoryResource({
        kind: "Node",
        logBody: JSON.stringify({
          data: { ID: "n1", Hostname: "a", Status: "down", ManagerStatus: "" },
        }),
        lastSeenAt: new Date(),
      });

    expect(ready!.resource.isReady).toBe(false);
    expect(T.nodes).toMatch(/Ready counts/);
    expect(T.nodes).toMatch(/Down cannot run tasks/);
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

  test("Services: converged means running >= desired AND desired > 0, so a scaled-to-zero service is not converged", () => {
    expect(serviceReadiness("3/3")).toBe(true);
    expect(serviceReadiness("4/3")).toBe(true);
    expect(serviceReadiness("2/3")).toBe(false);
    expect(serviceReadiness("0/0")).toBe(false);

    expect(T.services).toMatch(/Converged counts/);
    expect(T.services).toContain("scaled to 0 never counts as converged");
    expect(T.serviceStatus).toContain("scaled to 0");
  });

  test("Service status names its colours the way ServiceDetail picks them", () => {
    const serviceDetail: string = readRepoFile(
      "packages",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "DockerSwarm",
      "View",
      "ServiceDetail.tsx",
    ).replace(WHITESPACE, " ");
    const badge: string = readRepoFile(
      "packages",
      "Common",
      "UI",
      "Components",
      "StatusBadge",
      "StatusBadge.tsx",
    );

    // Not converged (isReady false, which includes 0/0) is the amber badge.
    expect(serviceDetail).toContain(
      "row.isReady === false ? StatusBadgeType.Warning : StatusBadgeType.Success",
    );
    expect(between(badge, "[StatusBadgeType.Warning]:", ",")).toContain(
      "amber",
    );
    expect(between(badge, "[StatusBadgeType.Success]:", ",")).toContain(
      "emerald",
    );

    expect(T.serviceStatus).toContain("2/3");
    expect(T.serviceStatus).toMatch(/Green when every wanted task is running/);
    expect(T.serviceStatus).toMatch(/amber when some are missing/);
    // On the list the badge is plain - no colours are promised there.
    expect(T.serviceStatusColumn).not.toMatch(/green|amber|red/i);
    expect(T.serviceStatusColumn).toContain("same figure as Replicas");
  });

  test("Replicas: the agent always sends running/desired, and a global service wants a copy per eligible node", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'Replicas: (((.ServiceStatus.RunningTasks // 0)|tostring) + "/" + ((.ServiceStatus.DesiredTasks',
    );
    expect(T.replicas).toContain("2/3 means one is missing");
    expect(T.replicas).toContain("global service wants one copy on every");
  });

  test("Tasks: only the tasks Swarm wants running are inventoried", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain(
      'select(.DesiredState == "running")',
    );
    expect(T.tasks).toMatch(/^Tasks Swarm wants running/);
    expect(T.tasks).toMatch(/one task is one container of a service/);
    // The page counts only state "running"; everything else is the rest.
    expect(T.tasks).toContain("running counts those actually running");
    expect(T.tasks).toContain("the rest are starting, stopped or failed");
  });

  test("Tasks: a replaced task lingers until the stale-row cleanup, which the text owns up to", () => {
    /*
     * A row is pruned once it is 15 minutes older than the CLUSTER's
     * lastSeenAt (not wall-clock now), and that lastSeenAt is itself only
     * refreshed through a 5-minute ingest fence; the sweep runs every 5
     * minutes. Worst case 15 + 5 + 5 = about 25 minutes, so "about 20"
     * would understate it.
     */
    const ingestBase: string = readRepoFile(
      "packages",
      "App",
      "FeatureSet",
      "Telemetry",
      "Services",
      "OtelIngestBaseService.ts",
    );
    const service: string = readRepoFile(
      "packages",
      "Common",
      "Server",
      "Services",
      "DockerSwarmResourceService.ts",
    );
    const cleanup: string = readRepoFile(
      "packages",
      "App",
      "FeatureSet",
      "Workers",
      "Jobs",
      "DockerSwarm",
      "CleanupStaleResources.ts",
    );

    expect(service).toContain("return 15;");
    expect(cleanup).toContain("schedule: EVERY_FIVE_MINUTE");
    expect(cleanup).toMatch(CUTOFF_ANCHORED_TO_CLUSTER);
    expect(ingestBase).toContain(
      "MAINTENANCE_FENCE_TTL_SECONDS: number = 5 * 60;",
    );
    expect(T.tasks).toContain("up to about 25 minutes");
    expect(T.tasks).not.toContain("20 minutes");
  });

  test("Stacks are grouped from the stack label on services", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain('"com.docker.stack.namespace"');
    expect(AGENT_SNAPSHOT_SCRIPT).toContain("group_by(.)");
    expect(T.stacks).toContain("stack name Docker puts on each service");
  });

  test("Networks: only swarm-scoped networks are counted", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain('select(.Scope == "swarm")');
    expect(T.networks).toMatch(/single node only.*are not counted/);
  });

  test("Volumes: listed on the poller's own node only, and the overview has no other source", () => {
    expect(AGENT_SNAPSHOT_SCRIPT).toContain('fetch "/volumes"');
    expect(AGENT_SNAPSHOT_SCRIPT).toContain("Node: $node");
    expect(T.volumes).toContain(
      "the node where the OneUptime inventory poller",
    );
    expect(T.volumes).toContain(
      "volumes on nodes without the poller are not counted",
    );
  });

  test("Volumes: the text does not promise a single node - the poller ships in the same compose file as the collector", () => {
    /*
     * The collector config invites running the agent on every node, and
     * docker-compose.yml starts the inventory poller alongside it. /volumes
     * answers on a worker too (only the swarm endpoints are manager-only),
     * so each node that runs the compose file adds its own volumes.
     */
    const compose: string = readRepoFile(
      "agents",
      "DockerSwarmAgent",
      "docker-compose.yml",
    );

    expect(compose).toContain("oneuptime-docker-swarm-agent:");
    expect(compose).toContain("oneuptime-docker-swarm-inventory:");
    expect(AGENT_COLLECTOR_CONFIG).toContain("run the agent on every node");
    expect(T.volumes).not.toMatch(/\bthe one manager\b/);
    expect(T.volumes).toContain("normally one manager");
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

  test("Services: every service in the snapshot, converged or not", () => {
    expect(T.clusterListServices).toContain("whatever their state");
    expect(T.clusterListServices).toContain("including ones scaled to 0");
    // Converged is on the overview, not on this list.
    expect(T.clusterListServices).toContain("overview");
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

  test("ingest mirrors CPU/memory onto Task rows only, so Nodes and Services always read N/A", () => {
    expect(flush).toContain('kind: "Task"');
    expect(flush).not.toMatch(/kind: "(Node|Service)"/);

    for (const text of [T.nodeUsageColumns, T.serviceUsageColumns]) {
      expect(text).toContain("collected per task container");
      expect(text).toContain("show N/A");
      expect(text).toContain("Tasks list");
    }
    expect(T.nodeUsageColumns).toContain("not per node");
    expect(T.serviceUsageColumns).toContain("not per service");
  });

  test("the Tasks list hides readings older than 15 minutes, and its texts say so", () => {
    expect(METRIC_STALE_MS).toBe(15 * 60 * 1000);

    const fresh: InfrastructureResource = toInfrastructureResource(taskRow(1));
    const stale: InfrastructureResource = toInfrastructureResource(taskRow(16));

    expect(fresh.cpuUtilization).toBe(12.5);
    expect(fresh.memoryUsageBytes).toBe(64 * 1024 * 1024);
    expect(stale.cpuUtilization).toBeNull();
    expect(stale.memoryUsageBytes).toBeNull();

    expect(T.taskCpuColumn).toContain("only when that reading is under 15");
    expect(T.taskMemoryColumn).toContain("only when that reading is under 15");
  });

  test("the task page applies no such cutoff, and its texts say that instead", () => {
    const taskDetail: string = readRepoFile(
      "packages",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "DockerSwarm",
      "View",
      "TaskDetail.tsx",
    );

    expect(taskDetail).not.toContain("METRIC_STALE_MS");
    expect(taskDetail).not.toContain("metricsUpdatedAt");
    expect(T.taskCpu).toContain("more than 15 minutes old");
    expect(T.taskMemory).toContain("more than 15 minutes old");
  });

  test("docker_stats reads only the local daemon, so tasks on nodes without the agent have no reading", () => {
    expect(AGENT_COLLECTOR_CONFIG).toContain(
      "endpoint: unix:///var/run/docker.sock",
    );
    expect(AGENT_COLLECTOR_CONFIG).toContain("collection_interval: 30s");
    expect(T.taskCpuColumn).toMatch(/nodes where the agent does not run/);
    expect(T.taskMemoryColumn).toMatch(/nodes without the agent/);
    expect(T.taskCpu).toContain("every 30 seconds");
  });

  test("memory texts say file cache is left out (docker_stats usage.total excludes it)", () => {
    for (const text of [T.taskMemory, T.taskMemoryColumn, CHART.taskMemory]) {
      expect(text).toMatch(/file cache/);
      /*
       * docker_stats subtracts only INACTIVE file cache (inactive_file), the
       * way docker stats does - the same metric and the same words as the
       * Docker and Podman host pages. Recently used cache is still counted,
       * so "cache the system can reclaim" would overstate what is left out.
       */
      expect(text).toContain("file cache the system has not used recently");
      expect(text).not.toContain("reclaim");
    }
  });

  test("task CPU names a scale only once ingest stops scaling the mirrored value by 100 a second time", () => {
    const cpuToPercent: string = between(
      METRICS_INGEST,
      "private static cpuValueToPercent(",
      "\n  }\n",
    );
    const stillMultiplies: boolean = cpuToPercent.includes(
      "return rawValue * 100;",
    );

    for (const text of [T.taskCpu, T.taskCpuColumn]) {
      if (stillMultiplies) {
        /*
         * docker_stats already reports a percent (100 = one core) under
         * unit "1", so the Task rows hold 100x that. Promising "100% is one
         * core" would be false until the ingest is fixed.
         */
        expect(text).not.toMatch(/core/i);
      } else {
        expect(text).toMatch(/100% is one full CPU core/);
      }
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
