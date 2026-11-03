import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS,
  DOCKER_SWARM_METRIC_DESCRIPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/DockerSwarmMetricDescriptions";

/*
 * Every number and state on the Docker Swarm cluster pages carries a
 * plain-English (i): the Overview's health pill and count chips, a node's,
 * a service's and a task's facts and tiles, and the Status, CPU, Memory,
 * Replicas, Role, Availability and Manager Status headers of the lists. The
 * Insights charts take their subtitle from the same module.
 *
 * The App suite runs in plain Node with no renderer, so the JSX wiring is
 * pinned by reading the sources (the rendered behaviour is covered by
 * Common/Tests/App/Dashboard/DockerSwarmOverviewTooltips.test.tsx and
 * DockerSwarmPartPages.test.tsx). Whitespace is squashed and comments
 * stripped, so a Prettier reflow or a rationale comment cannot make a test
 * pass or fail.
 */

const DASHBOARD_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const VIEW_DIR: string = path.join(
  DASHBOARD_DIR,
  "Pages",
  "DockerSwarm",
  "View",
);
const PART_DIR: string = path.join(
  DASHBOARD_DIR,
  "Components",
  "DockerSwarm",
  "Part",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
const DESCRIPTION_REFERENCE: RegExp =
  /DOCKER_SWARM_METRIC_DESCRIPTIONS\.(\w+)/g;

function readFrom(directory: string, file: string): string {
  return fs
    .readFileSync(path.join(directory, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

function readCode(file: string): string {
  return readFrom(VIEW_DIR, file);
}

function readPart(file: string): string {
  return readFrom(PART_DIR, file);
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  if (end < 0) {
    throw new Error(`Expected "${to}" after "${from}".`);
  }

  return source.slice(start, end);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function referencedKeys(source: string): Array<string> {
  return Array.from(source.matchAll(DESCRIPTION_REFERENCE)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const IMPORT_LINE: string =
  'import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/DockerSwarmMetricDescriptions";';

describe("Docker Swarm overview (Index.tsx)", () => {
  const code: string = readCode("Index.tsx");

  test("imports the Docker Swarm descriptions and the (i)", () => {
    expect(code).toContain(IMPORT_LINE);
    expect(code).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
  });

  test("the health pill's (i) is named Swarm health and explained by .clusterHealth", () => {
    const pill: string = between(
      code,
      'data-testid="docker-swarm-hero-health"',
      "</span> )}",
    );
    expect(pill).toContain(
      '<InfoTooltip label="Swarm health" text={DOCKER_SWARM_METRIC_DESCRIPTIONS.clusterHealth} />',
    );
  });

  test("the count chips share one (i), named for what they count, shown only when there are counts", () => {
    expect(code).toContain(
      '{hasCountChips && ( <InfoTooltip label="Swarm inventory counts" text={DOCKER_SWARM_METRIC_DESCRIPTIONS.inventoryCounts} /> )}',
    );
    expect(countOf(code, "<InfoTooltip")).toBe(2);
  });

  test("each count chip opens its list, and the version chips open none", () => {
    for (const [testId, route] of [
      ["docker-swarm-hero-nodes", "routes.nodesRoute"],
      ["docker-swarm-hero-managers", "routes.nodesRoute"],
      ["docker-swarm-hero-services", "routes.servicesRoute"],
      ["docker-swarm-hero-tasks", "routes.tasksRoute"],
    ]) {
      const chip: string = between(
        code,
        `route: ${route}, testId: "${testId}"`,
        "});",
      );
      expect(chip).toContain("label: translator.translatePlural(");
    }
    expect(code).toContain(
      'RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_STACKS] as Route, { modelId: modelId }, ), testId: "docker-swarm-hero-stacks"',
    );
    const versionChip: string = between(
      code,
      "if (cluster.dockerVersion) { specChips.push({",
      "}); }",
    );
    expect(versionChip).not.toContain("route:");
  });

  test("Needs attention is the swarm's rules, read while the agent reports, and its failed read says so", () => {
    expect(code).toContain(
      "getDockerSwarmAttentionItems({ rows: inventory.rows,",
    );
    expect(code).toContain(
      "const clusterHealth: ResourceHealth = getDockerSwarmHealth(attentionItems);",
    );
    expect(code).toContain(
      ') : isConnected && !isInventoryLoading ? ( <NeedsAttentionCard testId="docker-swarm-needs-attention" items={attentionItems} />',
    );
    expect(code).toContain(
      '<NeedsAttentionCard testId="docker-swarm-needs-attention" items={[]} error={inventoryError}',
    );
  });

  test("no <button> element is opened inside another anywhere on the page", () => {
    expect(code).not.toContain("<button");
  });

  test("the page references its two overview keys and no other", () => {
    expect(Array.from(new Set(referencedKeys(code))).sort()).toEqual([
      "clusterHealth",
      "inventoryCounts",
    ]);
  });
});

describe("Docker Swarm part pages (Components/DockerSwarm/Part)", () => {
  test("the hero's status says what it means for each kind", () => {
    const hero: string = readPart("DockerSwarmPartHero.tsx");
    expect(hero).toContain(
      "Node: DOCKER_SWARM_METRIC_DESCRIPTIONS.nodeStatus,",
    );
    expect(hero).toContain(
      "Service: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceStatus,",
    );
    expect(hero).toContain(
      "Task: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskStatus,",
    );
  });

  test("a node's facts explain its role, its standing and its availability", () => {
    const node: string = readPart("DockerSwarmNodeOverview.tsx");
    for (const [label, key] of [
      ["Role", "managers"],
      ["Manager Status", "managerStatus"],
      ["Availability", "availability"],
    ]) {
      expect(between(node, `label: "${label}",`, "});")).toContain(
        `description: DOCKER_SWARM_METRIC_DESCRIPTIONS.${key},`,
      );
    }
    expect(Array.from(new Set(referencedKeys(node))).sort()).toEqual([
      "availability",
      "managerStatus",
      "managers",
    ]);
  });

  test("a service's facts explain its replicas, its update, its failures and Docker's last error", () => {
    const service: string = readPart("DockerSwarmServiceOverview.tsx");
    for (const [label, key] of [
      ["Replicas", "replicas"],
      ["Last Update", "serviceUpdate"],
      ["Failed Tasks (Last Hour)", "recentFailedTasks"],
      ["Last Task Error", "lastTaskError"],
    ]) {
      expect(between(service, `label: "${label}",`, "});")).toContain(
        `description: DOCKER_SWARM_METRIC_DESCRIPTIONS.${key},`,
      );
    }
  });

  test("a task's tiles explain CPU and Memory, and its desired state is explained", () => {
    const task: string = readPart("DockerSwarmTaskOverview.tsx");
    expect(task).toContain(
      "description={DOCKER_SWARM_METRIC_DESCRIPTIONS.taskCpu}",
    );
    expect(task).toContain(
      "description={DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemory}",
    );
    expect(between(task, 'label: "Desired State",', "});")).toContain(
      "description: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskDesiredState,",
    );
  });

  test("a part's tasks table explains Status, CPU and Memory as the Tasks list does", () => {
    const table: string = readPart("DockerSwarmTasksTable.tsx");
    expect(table).toContain(
      "builtInColumnDescriptions={{ status: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskStatus, cpu: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskCpuColumn, memory: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemoryColumn, }}",
    );
  });

  test("names, ids and images stay plain on the part pages", () => {
    for (const file of [
      "DockerSwarmNodeOverview.tsx",
      "DockerSwarmServiceOverview.tsx",
      "DockerSwarmTaskOverview.tsx",
    ]) {
      const code: string = readPart(file);
      for (const label of ["Name", "Hostname", "Image", "Node ID", "Task ID"]) {
        if (!code.includes(`label: "${label}",`)) {
          continue;
        }
        expect(between(code, `label: "${label}",`, "}")).not.toContain(
          "description:",
        );
      }
    }
  });
});

describe("Docker Swarm list pages", () => {
  test("Tasks: Status, CPU and Memory headers explain the rules and the latest reading", () => {
    const code: string = readCode("Tasks.tsx");
    expect(code).toContain(IMPORT_LINE);
    expect(code).toContain(
      "builtInColumnDescriptions={{ status: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskStatus, cpu: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskCpuColumn, memory: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemoryColumn, }}",
    );
    expect(code).toContain(
      "metricThresholds={DOCKER_SWARM_TASK_METRIC_THRESHOLDS}",
    );
  });

  /*
   * A task's name is its service's and its slot ("shop_web.2"): a Service
   * column said it again, and with the Image beside it pushed each task's
   * CPU and memory - what its state is judged by - out of view at 1280.
   */
  test("Tasks: no Service column, and the Image folds under the name when the table is short of room", () => {
    const code: string = readCode("Tasks.tsx");
    expect(code).not.toContain('title: "Service",');
    expect(between(code, 'title: "Image",', "getValue")).toContain(
      'foldInto: "name",',
    );
  });

  test("Nodes: Status, Role, Availability and Manager Status are explained; no usage columns", () => {
    const code: string = readCode("Nodes.tsx");
    expect(code).toContain(
      "builtInColumnDescriptions={{ status: DOCKER_SWARM_METRIC_DESCRIPTIONS.nodeStatus, }}",
    );
    for (const [title, key] of [
      ["Role", "managers"],
      ["Availability", "availability"],
      ["Manager Status", "managerStatus"],
    ]) {
      expect(between(code, `title: "${title}",`, "getValue")).toContain(
        `description: DOCKER_SWARM_METRIC_DESCRIPTIONS.${key},`,
      );
    }
    expect(code).toContain("showResourceMetrics={false}");
    // A role is Docker's, manager or worker; which one leads is its Manager Status.
    expect(between(code, "const ROLE_WORDS", "};")).not.toContain("leader");
  });

  test("Services: Status and Replicas are explained; no usage columns", () => {
    const code: string = readCode("Services.tsx");
    expect(code).toContain(
      "builtInColumnDescriptions={{ status: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceStatusColumn, }}",
    );
    expect(between(code, 'title: "Replicas",', "getValue")).toContain(
      "description: DOCKER_SWARM_METRIC_DESCRIPTIONS.replicas,",
    );
    expect(code).toContain("showResourceMetrics={false}");
  });

  test("each list's status is the swarm's rules, as the Overview's", () => {
    for (const file of ["Nodes.tsx", "Services.tsx", "Tasks.tsx"]) {
      expect(readCode(file)).toContain(
        "Object.assign(resource, withDockerSwarmStatus(resource, row, now));",
      );
    }
  });

  test("metadata columns (Mode, Image, Engine Version, Service) carry no tooltip", () => {
    for (const [file, title] of [
      ["Services.tsx", "Mode"],
      ["Services.tsx", "Image"],
      ["Nodes.tsx", "Engine Version"],
      ["Tasks.tsx", "Image"],
    ]) {
      expect(
        between(readCode(file!), `title: "${title}",`, "getValue"),
      ).not.toContain("description:");
    }
  });
});

describe("Docker Swarm Stacks list", () => {
  const code: string = readCode("Stacks.tsx");

  test("imports the Docker Swarm descriptions", () => {
    expect(code).toContain(IMPORT_LINE);
  });

  test("the Services column explains its count", () => {
    const services: string = between(code, 'title: "Services",', "},");

    expect(services).toContain('key: "serviceCount",');
    expect(services).toContain(
      "description: DOCKER_SWARM_METRIC_DESCRIPTIONS.stackServices,",
    );
  });

  test('the built-in Status column (which reads "N services") says it is not a health check', () => {
    const props: string = between(code, "builtInColumnDescriptions={{", "}}");

    expect(props).toContain(
      "status: DOCKER_SWARM_METRIC_DESCRIPTIONS.stackStatusColumn,",
    );
    // Stacks carry no CPU or memory, and the columns are switched off.
    expect(code).toContain("showResourceMetrics={false}");
    expect(props).not.toContain("cpu:");
    expect(props).not.toContain("memory:");
  });

  test("the page references its two keys and no other", () => {
    expect(referencedKeys(code)).toEqual([
      "stackStatusColumn",
      "stackServices",
    ]);
  });
});

describe("Docker Swarm Clusters list (Pages/DockerSwarm/Clusters.tsx)", () => {
  const code: string = readCode(path.join("..", "Clusters.tsx"));
  const columns: string = between(code, "columns={[", "onViewPage=");

  function column(title: string): string {
    const found: Array<string> = columns
      .split("{ field: {")
      .slice(1)
      .filter((block: string): boolean => {
        return block.includes(`title: "${title}",`);
      });

    expect(found).toHaveLength(1);
    return found[0]!;
  }

  const COUNT_COLUMNS: Array<[string, string, Array<string>]> = [
    ["Nodes", "clusterListNodes", ["nodeCount", "readyNodeCount"]],
    ["Services", "clusterListServices", ["serviceCount"]],
    ["Tasks", "clusterListTasks", ["taskCount", "runningTaskCount"]],
  ];

  test("imports the Docker Swarm descriptions by its own relative path", () => {
    expect(code).toContain(
      'import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/DockerSwarmMetricDescriptions";',
    );
  });

  test.each(COUNT_COLUMNS)(
    "the %s column reads the cached cluster counts and explains them with .%s",
    (title: string, key: string, fields: Array<string>) => {
      const block: string = column(title);

      expect(block).toContain(
        `headerTooltip: DOCKER_SWARM_METRIC_DESCRIPTIONS.${key},`,
      );
      for (const field of fields) {
        expect(block).toContain(`${field}: true,`);
      }
    },
  );

  test("the Nodes column turns red unless every node is ready, as its text says", () => {
    const nodes: string = column("Nodes");

    expect(nodes).toContain("const allReady: boolean = ready >= total;");
    expect(nodes).toContain('allReady ? "text-gray-900" : "text-red-700"');
  });

  test("status, version and ownership columns stay plain", () => {
    for (const title of [
      "Name",
      "Status",
      "Docker Version",
      "Last Seen",
      "Labels",
      "Owners",
    ]) {
      expect({
        title,
        tooltip: column(title).includes("headerTooltip"),
      }).toEqual({ title, tooltip: false });
    }
    expect(countOf(columns, "headerTooltip:")).toBe(COUNT_COLUMNS.length);
    expect(code).not.toContain("<InfoTooltip");
  });

  test("the page references its three keys and no other", () => {
    expect(referencedKeys(code)).toEqual([
      "clusterListNodes",
      "clusterListServices",
      "clusterListTasks",
    ]);
  });
});

describe("the Docker Swarm tooltip record", () => {
  test("every key is shown by one of the Swarm pages", () => {
    const shown: Set<string> = new Set<string>();

    for (const code of [
      readCode("Index.tsx"),
      readCode("Services.tsx"),
      readCode("Tasks.tsx"),
      readCode("Nodes.tsx"),
      readCode("Stacks.tsx"),
      readCode(path.join("..", "Clusters.tsx")),
      readPart("DockerSwarmPartHero.tsx"),
      readPart("DockerSwarmNodeOverview.tsx"),
      readPart("DockerSwarmServiceOverview.tsx"),
      readPart("DockerSwarmTaskOverview.tsx"),
      readPart("DockerSwarmTasksTable.tsx"),
    ]) {
      for (const key of referencedKeys(code)) {
        shown.add(key);
      }
    }

    expect(Array.from(shown).sort()).toEqual(
      Object.keys(DOCKER_SWARM_METRIC_DESCRIPTIONS).sort(),
    );
  });
});

describe("Docker Swarm Insights charts", () => {
  const code: string = readCode("Insights.tsx");
  const CHARTS: Array<[string, string]> = [
    ["Cluster CPU Utilization", "clusterCpu"],
    ["Cluster Memory Utilization", "clusterMemoryPercent"],
    ["Task Memory Usage", "taskMemory"],
    ["Top Tasks by CPU", "topTasksCpu"],
    ["Top Tasks by Memory", "topTasksMemory"],
    ["Task Process Count", "taskProcesses"],
  ];

  test.each(CHARTS)(
    "%s takes its subtitle from .%s",
    (title: string, key: string) => {
      const spec: string = between(code, `title: "${title}",`, "legend:");

      expect(spec).toContain(
        `description: DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS.${key},`,
      );
      expect(
        DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS[
          key as keyof typeof DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS
        ],
      ).toBeTruthy();
    },
  );

  test("every chart spec has a record description and no inline string is left", () => {
    expect(countOf(code, 'variable: "')).toBe(CHARTS.length);
    expect(
      countOf(code, "description: DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS."),
    ).toBe(CHARTS.length);
    expect(code).not.toContain("host-CPU");
    expect(code).not.toMatch(/description: "container\./);
  });

  test("the charts keep the (i) ChartGroup already draws - no second InfoTooltip here", () => {
    expect(code).not.toContain("InfoTooltip");
  });
});
