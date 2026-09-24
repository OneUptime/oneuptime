import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS,
  DOCKER_SWARM_METRIC_DESCRIPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/DockerSwarmMetricDescriptions";

/*
 * Every number on the Docker Swarm cluster pages carries a plain-English
 * (i): the overview's count tiles and hero chips, the service and task
 * detail fields, and the CPU / Memory / Replicas / Status headers of the
 * lists. The Insights charts take their subtitle from the same module.
 *
 * The App suite runs in plain Node with no renderer, so the JSX wiring is
 * pinned by reading the sources (the rendered behaviour is covered by
 * Common/Tests/App/Dashboard/DockerSwarmOverviewTooltips.test.tsx).
 * Whitespace is squashed and comments stripped, so a Prettier reflow or a
 * rationale comment cannot make a test pass or fail.
 */

const VIEW_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "DockerSwarm",
  "View",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
const RENDER_COUNT_TILE_CALL: RegExp = /renderCountTile\( "(\w+)",/g;
const DESCRIPTION_REFERENCE: RegExp =
  /DOCKER_SWARM_METRIC_DESCRIPTIONS\.(\w+)/g;
const NODE_OR_SERVICE_KIND: RegExp = /kind: "(Node|Service)"/;

function readCode(file: string): string {
  return fs
    .readFileSync(path.join(VIEW_DIR, file), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
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

  const TILES: Array<[string, string]> = [
    ["Nodes", "nodes"],
    ["Services", "services"],
    ["Tasks", "tasks"],
    ["Stacks", "stacks"],
    ["Networks", "networks"],
    ["Volumes", "volumes"],
  ];

  test("imports the Docker Swarm descriptions and the (i)", () => {
    expect(code).toContain(IMPORT_LINE);
    expect(code).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
  });

  test.each(TILES)(
    "the %s tile passes its own description",
    (title: string, key: string) => {
      const call: string = between(code, `renderCountTile( "${title}",`, ")}");

      expect(call).toContain(`DOCKER_SWARM_METRIC_DESCRIPTIONS.${key},`);
      expect(
        DOCKER_SWARM_METRIC_DESCRIPTIONS[
          key as keyof typeof DOCKER_SWARM_METRIC_DESCRIPTIONS
        ],
      ).toBeTruthy();
    },
  );

  test("every count tile on the page is one of the six above, each with a description", () => {
    const calls: Array<string> = Array.from(
      code.matchAll(RENDER_COUNT_TILE_CALL),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(calls).toEqual(
      TILES.map((tile: [string, string]): string => {
        return tile[0];
      }),
    );

    const strip: string = between(
      code,
      'renderCountTile( "Nodes",',
      '<Card title="Cluster Health"',
    );

    expect(countOf(strip, "DOCKER_SWARM_METRIC_DESCRIPTIONS.")).toBe(
      calls.length,
    );
  });

  test("renderCountTile forwards the description to the tile", () => {
    const helper: string = between(
      code,
      "const renderCountTile:",
      "return ( <div> {renderHero()}",
    );

    expect(helper).toContain("description?: string,");
    expect(helper).toContain("<SwarmCountTile");
    expect(helper).toContain("description={description}");
    expect(helper).toContain("Navigation.navigate(");
  });

  test("the tile's open control is an overlay, so the (i) is never nested in a button", () => {
    const tile: string = between(
      code,
      "export const SwarmCountTile:",
      "interface DegradedItem",
    );
    const overlay: string = between(tile, "<button", "</button>");

    expect(overlay).toContain("absolute inset-0");
    expect(overlay).toContain('className="sr-only"');
    expect(overlay).toContain("View ${props.label}");
    expect(overlay).not.toContain("<InfoTooltip");

    // Exactly one button of its own, closed before the (i) is drawn.
    expect(countOf(tile, "<button")).toBe(1);
    expect(tile.indexOf("</button>")).toBeLessThan(
      tile.indexOf("<InfoTooltip"),
    );
    expect(tile).toContain("relative rounded-lg");
  });

  test("the tile's (i) is named after the label and lifted above the overlay", () => {
    const tooltip: string = between(
      between(code, "export const SwarmCountTile:", "interface DegradedItem"),
      "<InfoTooltip",
      "/>",
    );

    expect(tooltip).toContain("label={props.label}");
    expect(tooltip).toContain("text={props.description}");
    expect(tooltip).toContain('className="relative z-10"');
  });

  test("no <button> element is opened inside another anywhere on the page", () => {
    let depth: number = 0;
    const TAG: RegExp = /<button\b|<\/button>/g;

    for (const match of code.matchAll(TAG)) {
      depth += match[0] === "</button>" ? -1 : 1;
      expect(depth).toBeLessThanOrEqual(1);
    }

    expect(depth).toBe(0);
  });

  const CHIPS: Array<[string, string, string]> = [
    ["node${", "Nodes ready", "nodes"],
    ["manager${", "Managers", "managers"],
    ["service${", "Services", "services"],
    ["task${", "Tasks running", "tasks"],
  ];

  test.each(CHIPS)(
    "the hero chip %s is named %s and explained by .%s",
    (labelFragment: string, name: string, key: string) => {
      const chip: string = between(code, labelFragment, "});");

      expect(chip).toContain(`name: "${name}",`);
      expect(chip).toContain(
        `description: DOCKER_SWARM_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test("version chips stay plain - they are metadata, not metrics", () => {
    for (const label of ["label: `Docker ${", "label: `Agent ${"]) {
      const chip: string = between(code, label, "});");

      expect(chip).not.toContain("description:");
    }
  });

  test("each chip renders its (i) with the static name, never the numbers", () => {
    const render: string = between(
      code,
      "specChips.map((chip: SpecChip",
      "})}",
    );

    expect(render).toContain("<InfoTooltip");
    expect(render).toContain("label={chip.name || chip.label}");
    expect(render).toContain("text={chip.description}");
  });

  test("the page references every overview key and no other", () => {
    expect([...new Set(referencedKeys(code))].sort()).toEqual([
      "managers",
      "networks",
      "nodes",
      "services",
      "stacks",
      "tasks",
      "volumes",
    ]);
  });
});

describe("Docker Swarm detail pages", () => {
  test("ServiceDetail explains Status and Replicas", () => {
    const code: string = readCode("ServiceDetail.tsx");

    expect(code).toContain(IMPORT_LINE);

    const status: string = between(code, 'title: "Status",', "});");
    expect(status).toContain(
      "description: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceStatus,",
    );

    const replicas: string = between(code, 'title: "Replicas",', "});");
    expect(replicas).toContain("value: formatReplicas(row),");
    expect(replicas).toContain(
      "description: DOCKER_SWARM_METRIC_DESCRIPTIONS.replicas,",
    );
  });

  test("TaskDetail explains CPU and Memory", () => {
    const code: string = readCode("TaskDetail.tsx");

    expect(code).toContain(IMPORT_LINE);

    const cpu: string = between(code, 'title: "CPU",', "});");
    expect(cpu).toContain("formatPercent(Number(row.latestCpuPercent))");
    expect(cpu).toContain(
      "description: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskCpu,",
    );

    const memory: string = between(code, 'title: "Memory",', "});");
    expect(memory).toContain(
      "description: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemory,",
    );
  });

  test("every summary field titled CPU or Memory on the task page has a description", () => {
    const code: string = readCode("TaskDetail.tsx");

    for (const title of ['title: "CPU",', 'title: "Memory",']) {
      expect(countOf(code, title)).toBe(1);
    }
    expect(referencedKeys(code).sort()).toEqual(["taskCpu", "taskMemory"]);
  });

  test("Node and Service CPU / Memory fields have no (i) only because ingest never fills them", () => {
    /*
     * NodeDetail and ServiceDetail still carry CPU / Memory summary fields,
     * but they render only when the row has latestCpuPercent /
     * latestMemoryBytes, and the docker_stats mirror writes Task rows only.
     * The day the ingest starts writing Node or Service rows, these fields
     * appear on screen and need their own (i) and wording; this test is the
     * reminder.
     */
    const ingest: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Telemetry",
          "Services",
          "OtelMetricsIngestService.ts",
        ),
        "utf8",
      )
      .replace(WHITESPACE, " ");
    const flush: string = between(
      ingest,
      "private static async flushDockerSwarmTaskMetrics",
      "private static bufferDockerSnapshotMetric",
    );

    expect(flush).toContain('kind: "Task",');
    expect(flush).not.toMatch(NODE_OR_SERVICE_KIND);
    expect(
      countOf(ingest, "DockerSwarmResourceService.bulkUpdateLatestMetrics("),
    ).toBe(1);

    for (const file of ["NodeDetail.tsx", "ServiceDetail.tsx"]) {
      const code: string = readCode(file);

      for (const title of ['title: "CPU",', 'title: "Memory",']) {
        expect(countOf(code, title)).toBe(1);
        expect(between(code, title, "});")).not.toContain("description:");
      }
      expect(code).toContain(
        "if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined)",
      );
    }
  });

  test("status words, names and IDs stay plain on the detail pages", () => {
    const task: string = readCode("TaskDetail.tsx");
    const stateField: string = between(task, 'title: "State",', "});");

    expect(stateField).not.toContain("description:");

    for (const title of ["Task", "Cluster", "Image", "External ID"]) {
      const field: string = between(task, `title: "${title}",`, "}");

      expect(field).not.toContain("description:");
    }
  });
});

describe("Docker Swarm list pages", () => {
  test("Tasks: CPU and Memory headers explain the latest reading and its 15-minute cutoff", () => {
    const code: string = readCode("Tasks.tsx");
    const props: string = between(code, "builtInColumnDescriptions={{", "}}");

    expect(code).toContain(IMPORT_LINE);
    expect(props).toContain(
      "cpu: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskCpuColumn,",
    );
    expect(props).toContain(
      "memory: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemoryColumn,",
    );
    expect(props).not.toContain("status:");
  });

  test("Nodes: CPU and Memory headers say why they read N/A", () => {
    const code: string = readCode("Nodes.tsx");
    const props: string = between(code, "builtInColumnDescriptions={{", "}}");

    expect(code).toContain(IMPORT_LINE);
    // Node status is a state word (ready / down), not a number.
    expect(props).not.toContain("status:");
    expect(props).toContain(
      "cpu: DOCKER_SWARM_METRIC_DESCRIPTIONS.nodeUsageColumns,",
    );
    expect(props).toContain(
      "memory: DOCKER_SWARM_METRIC_DESCRIPTIONS.nodeUsageColumns,",
    );
  });

  test("Services: Status, CPU, Memory and Replicas headers are explained", () => {
    const code: string = readCode("Services.tsx");
    const props: string = between(code, "builtInColumnDescriptions={{", "}}");

    expect(code).toContain(IMPORT_LINE);
    expect(props).toContain(
      "status: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceStatusColumn,",
    );
    expect(props).toContain(
      "cpu: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceUsageColumns,",
    );
    expect(props).toContain(
      "memory: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceUsageColumns,",
    );

    const replicas: string = between(code, 'title: "Replicas",', "},");
    expect(replicas).toContain(
      "description: DOCKER_SWARM_METRIC_DESCRIPTIONS.replicas,",
    );
  });

  test("metadata columns (Mode, Image, Role, Engine Version, Service) carry no tooltip", () => {
    const services: string = readCode("Services.tsx");
    const nodes: string = readCode("Nodes.tsx");
    const tasks: string = readCode("Tasks.tsx");

    for (const [code, title] of [
      [services, "Mode"],
      [services, "Image"],
      [nodes, "Role"],
      [nodes, "Engine Version"],
      [tasks, "Service"],
      [tasks, "Image"],
    ] as Array<[string, string]>) {
      const column: string = between(code, `title: "${title}",`, "},");

      expect(column).not.toContain("description:");
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

    for (const file of [
      "Index.tsx",
      "ServiceDetail.tsx",
      "TaskDetail.tsx",
      "Services.tsx",
      "Tasks.tsx",
      "Nodes.tsx",
      "Stacks.tsx",
      path.join("..", "Clusters.tsx"),
    ]) {
      for (const key of referencedKeys(readCode(file))) {
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
