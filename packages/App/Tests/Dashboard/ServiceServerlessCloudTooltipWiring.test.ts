import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SERVICE_METRIC_DESCRIPTIONS,
  SERVICE_PROFILE_METRIC_DESCRIPTIONS,
  SERVICE_RUNTIME_METRIC_DESCRIPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/ServiceMetricDescriptions";
import { SERVERLESS_METRIC_DESCRIPTIONS } from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/ServerlessMetricDescriptions";
import {
  CLOUD_FLEET_METRIC_DESCRIPTIONS,
  CLOUD_INSTANCE_METRIC_DESCRIPTIONS,
  CLOUD_METRIC_DESCRIPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/CloudMetricDescriptions";

/*
 * Every metric on the Service, Serverless and Cloud pages carries a plain-
 * language (i) tooltip. The pages compose tiles and charts that no node
 * harness renders (the Common suite renders them over a fake API), so this
 * pins the wiring at the source: each title is paired with the description
 * written for it, nothing is left without one, and nothing is paired with
 * another metric's words.
 *
 * Comments are stripped and whitespace squashed so reflowing or annotating
 * the source cannot make a test pass or fail.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
const TILE_TITLE: RegExp = /title: (?:"([^"]+)"|([\w.]+)),/g;
const CHART_CARD_TITLE: RegExp = /title=(?:"([^"]+)"|\{([\w.]+)\})/;
const RUNTIME_KEY: RegExp = /key: "([\w-]+)",/g;

// packages/, for the ingest and server code the texts describe.
const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..");

function codeOf(absolutePath: string): string {
  return fs
    .readFileSync(absolutePath, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

function readCode(relativePath: string): string {
  return codeOf(path.join(DASHBOARD_SRC, ...relativePath.split("/")));
}

// A source outside the dashboard, relative to packages/.
function readPackageCode(relativePath: string): string {
  return codeOf(path.join(PACKAGES_ROOT, ...relativePath.split("/")));
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

/*
 * The object literals of a tile array, one string per tile, split at each
 * `title:`. Each chunk runs to the next tile's title, so a description
 * found in a chunk belongs to that tile.
 */
function tileChunks(block: string): Array<{ title: string; body: string }> {
  const matches: Array<RegExpMatchArray> = Array.from(
    block.matchAll(TILE_TITLE),
  );

  return matches.map(
    (
      match: RegExpMatchArray,
      index: number,
    ): { title: string; body: string } => {
      const start: number = match.index as number;
      const next: RegExpMatchArray | undefined = matches[index + 1];
      const end: number = next ? (next.index as number) : block.length;

      return {
        title: (match[1] || match[2]) as string,
        body: block.slice(start, end),
      };
    },
  );
}

// Each `<ChartCard ... />` element in a page, with its title.
function chartCards(code: string): Array<{ title: string; body: string }> {
  return code
    .split("<ChartCard ")
    .slice(1)
    .map((chunk: string): { title: string; body: string } => {
      const body: string = chunk.slice(0, chunk.indexOf("/>"));
      const match: RegExpMatchArray | null = body.match(CHART_CARD_TITLE);

      if (!match) {
        throw new Error(`A ChartCard without a title: ${body.slice(0, 80)}`);
      }

      return { title: (match[1] || match[2]) as string, body };
    });
}

/*
 * Every RECORD.key the source references, so a page cannot point at a key
 * that does not exist (undefined renders no (i) at all, silently).
 */
function referencedKeys(code: string, record: string): Array<string> {
  const pattern: RegExp = new RegExp(`\\b${record}\\.(\\w+)`, "g");

  return Array.from(code.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const PERCENTILE_TITLE: RegExp = /\bp(50|75|90|95|99)\b/i;

// A title naming a percentile is paired with a text that explains it.
function expectPercentileExplained(title: string, text: string): void {
  const match: RegExpMatchArray | null = title.match(PERCENTILE_TITLE);

  if (match) {
    expect({ title, explained: text.includes(`${match[1]}%`) }).toEqual({
      title,
      explained: true,
    });
  }
}

describe("Service overview tooltips", () => {
  const code: string = readCode("Pages/Service/View/Index.tsx");
  const tilesBlock: string = between(
    code,
    "const tiles: Array<ResourceOverviewTile> = [",
    "];",
  );

  const EXPECTED_TILES: Record<string, string> = {
    Requests: "requests",
    "Error rate": "errorRate",
    "Latency (p95)": "latencyP95",
  };

  const EXPECTED_CHARTS: Record<string, string> = {
    Requests: "requestsChart",
    "Latency (p95)": "latencyP95Chart",
    Logs: "logsChart",
    Exceptions: "exceptionsChart",
    "chart.def.title": "chart.def.description",
  };

  test("imports its descriptions from the shared module", () => {
    expect(code).toContain(
      'import { SERVICE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ServiceMetricDescriptions";',
    );
  });

  test("each of the three fixed tiles is paired with its own text", () => {
    const tiles: Array<{ title: string; body: string }> =
      tileChunks(tilesBlock);

    expect(
      tiles.map((tile: { title: string }): string => {
        return tile.title;
      }),
    ).toEqual(Object.keys(EXPECTED_TILES));

    for (const tile of tiles) {
      expect(countOf(tile.body, "description:")).toBe(1);
      expect(tile.body).toContain(
        `description: SERVICE_METRIC_DESCRIPTIONS.${EXPECTED_TILES[tile.title]},`,
      );
      expectPercentileExplained(
        tile.title,
        SERVICE_METRIC_DESCRIPTIONS[
          EXPECTED_TILES[tile.title] as keyof typeof SERVICE_METRIC_DESCRIPTIONS
        ],
      );
    }
  });

  test("the fourth tile takes the runtime chart's text, or explains Technology", () => {
    const runtimeTile: string = between(
      code,
      "tiles.push({ title: firstRuntime.def.title,",
      "});",
    );

    expect(runtimeTile).toContain("description: firstRuntime.def.description,");

    const technologyTile: string = between(
      code,
      'tiles.push({ title: "Technology",',
      "});",
    );

    expect(technologyTile).toContain(
      "description: SERVICE_METRIC_DESCRIPTIONS.technology,",
    );

    // Exactly the two pushes, both explained.
    expect(countOf(code, "tiles.push(")).toBe(2);
  });

  test("every chart card - fixed and runtime - is paired with its own text", () => {
    const cards: Array<{ title: string; body: string }> = chartCards(code);

    expect(
      cards.map((card: { title: string }): string => {
        return card.title;
      }),
    ).toEqual(Object.keys(EXPECTED_CHARTS));

    for (const card of cards) {
      expect(countOf(card.body, "description=")).toBe(1);

      const expected: string = EXPECTED_CHARTS[card.title] as string;
      const reference: string = expected.includes(".")
        ? expected
        : `SERVICE_METRIC_DESCRIPTIONS.${expected}`;

      expect(card.body).toContain(`description={${reference}}`);

      if (!expected.includes(".")) {
        expectPercentileExplained(
          card.title,
          SERVICE_METRIC_DESCRIPTIONS[
            expected as keyof typeof SERVICE_METRIC_DESCRIPTIONS
          ],
        );
      }
    }
  });

  test("uses every Service description and no key that does not exist", () => {
    const keys: Array<string> = referencedKeys(
      code,
      "SERVICE_METRIC_DESCRIPTIONS",
    );

    expect([...new Set(keys)].sort()).toEqual(
      Object.keys(SERVICE_METRIC_DESCRIPTIONS).sort(),
    );
  });
});

describe("Service runtime chart definitions", () => {
  const code: string = readCode(
    "Components/TelemetryResource/serviceGoldenMetrics.ts",
  );

  const EXPECTED: Record<string, string> = {
    "jvm-cpu": "jvmCpu",
    "jvm-heap": "jvmHeap",
    "jvm-threads": "jvmThreads",
    "dotnet-memory": "dotnetWorkingSet",
    "dotnet-gc-heap": "dotnetGcHeap",
    "dotnet-threadpool": "dotnetThreadPool",
    "dotnet-exceptions": "dotnetExceptions",
    "node-eventloop-util": "nodeEventLoopUtilization",
    "node-eventloop-delay": "nodeEventLoopDelay",
    "node-heap": "nodeHeap",
    "python-memory": "pythonMemory",
    "python-gc": "pythonGc",
    "go-goroutines": "goGoroutines",
    "go-memory": "goMemory",
    "go-gc": "goGc",
    "process-cpu": "processCpu",
    "process-memory": "processMemory",
  };

  test("a description is a required field of every definition", () => {
    const shape: string = between(
      code,
      "export interface RuntimeChartDef {",
      "}",
    );

    expect(shape).toContain("description: string;");
    expect(shape).not.toContain("description?:");
  });

  test("every definition is paired with the text written for it", () => {
    const keys: Array<string> = Array.from(code.matchAll(RUNTIME_KEY)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(keys).toEqual(Object.keys(EXPECTED));
    expect(
      countOf(code, "description: SERVICE_RUNTIME_METRIC_DESCRIPTIONS."),
    ).toBe(keys.length);

    for (const key of keys) {
      const definition: string = between(code, `key: "${key}",`, "candidates:");

      expect(definition).toContain(
        `description: SERVICE_RUNTIME_METRIC_DESCRIPTIONS.${EXPECTED[key]},`,
      );

      const title: RegExpMatchArray | null =
        definition.match(/title: "([^"]+)"/);

      expectPercentileExplained(
        (title as RegExpMatchArray)[1] as string,
        SERVICE_RUNTIME_METRIC_DESCRIPTIONS[
          EXPECTED[key] as keyof typeof SERVICE_RUNTIME_METRIC_DESCRIPTIONS
        ],
      );
    }
  });

  test("uses every runtime description and no key that does not exist", () => {
    expect(
      referencedKeys(code, "SERVICE_RUNTIME_METRIC_DESCRIPTIONS").sort(),
    ).toEqual(Object.keys(SERVICE_RUNTIME_METRIC_DESCRIPTIONS).sort());
  });
});

describe("Serverless function overview tooltips", () => {
  const code: string = readCode("Pages/Serverless/View/Overview.tsx");
  const tilesBlock: string = between(
    code,
    "const tiles: Array<ResourceOverviewTile> = [",
    "];",
  );

  const EXPECTED_TILES: Record<string, string> = {
    Invocations: "invocations",
    "Error rate": "errorRate",
    "p95 duration": "p95Duration",
    Instances: "instances",
  };

  const EXPECTED_CHARTS: Record<string, string> = {
    Invocations: "invocationsChart",
    "p95 duration": "p95DurationChart",
  };

  test("imports its descriptions from the shared module", () => {
    expect(code).toContain(
      'import { SERVERLESS_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ServerlessMetricDescriptions";',
    );
  });

  test("every tile is paired with its own text", () => {
    const tiles: Array<{ title: string; body: string }> =
      tileChunks(tilesBlock);

    expect(
      tiles.map((tile: { title: string }): string => {
        return tile.title;
      }),
    ).toEqual(Object.keys(EXPECTED_TILES));

    for (const tile of tiles) {
      expect(countOf(tile.body, "description:")).toBe(1);
      expect(tile.body).toContain(
        `description: SERVERLESS_METRIC_DESCRIPTIONS.${EXPECTED_TILES[tile.title]},`,
      );
      expectPercentileExplained(
        tile.title,
        SERVERLESS_METRIC_DESCRIPTIONS[
          EXPECTED_TILES[
            tile.title
          ] as keyof typeof SERVERLESS_METRIC_DESCRIPTIONS
        ],
      );
    }
  });

  test("every chart card is paired with its own text", () => {
    const cards: Array<{ title: string; body: string }> = chartCards(code);

    expect(
      cards.map((card: { title: string }): string => {
        return card.title;
      }),
    ).toEqual(Object.keys(EXPECTED_CHARTS));

    for (const card of cards) {
      expect(countOf(card.body, "description=")).toBe(1);
      expect(card.body).toContain(
        `description={SERVERLESS_METRIC_DESCRIPTIONS.${EXPECTED_CHARTS[card.title]}}`,
      );
    }
  });

  test("uses every Serverless description and no key that does not exist", () => {
    expect(
      [
        ...new Set(referencedKeys(code, "SERVERLESS_METRIC_DESCRIPTIONS")),
      ].sort(),
    ).toEqual(Object.keys(SERVERLESS_METRIC_DESCRIPTIONS).sort());
  });

  test("the Invocations text matches the scope the page fetches", () => {
    // "matched by its faas.name attribute" - and nothing narrower.
    expect(code).toContain(
      'attributes: { "resource.faas.name": fn.functionIdentifier as string }',
    );
    expect(SERVERLESS_METRIC_DESCRIPTIONS.invocations).toContain("faas.name");
  });
});

describe("Cloud environment overview tooltips", () => {
  const code: string = readCode("Pages/Cloud/View/Overview.tsx");
  const tilesBlock: string = between(
    code,
    "const tiles: Array<ResourceOverviewTile> = [",
    "];",
  );

  const EXPECTED_TILES: Record<string, string> = {
    CPU: "cpu",
    Memory: "memory",
    Instances: "instances",
    Requests: "requests",
    "Error rate": "errorRate",
    "p95 latency": "p95Latency",
  };

  const EXPECTED_CHARTS: Record<string, string> = {
    Requests: "requestsChart",
    Memory: "memoryChart",
  };

  test("imports its descriptions from the shared module", () => {
    expect(code).toContain(
      'import { CLOUD_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CloudMetricDescriptions";',
    );
  });

  test("every tile is paired with its own text", () => {
    const tiles: Array<{ title: string; body: string }> =
      tileChunks(tilesBlock);

    expect(
      tiles.map((tile: { title: string }): string => {
        return tile.title;
      }),
    ).toEqual(Object.keys(EXPECTED_TILES));

    for (const tile of tiles) {
      expect(countOf(tile.body, "description:")).toBe(1);
      expect(tile.body).toContain(
        `description: CLOUD_METRIC_DESCRIPTIONS.${EXPECTED_TILES[tile.title]},`,
      );
      expectPercentileExplained(
        tile.title,
        CLOUD_METRIC_DESCRIPTIONS[
          EXPECTED_TILES[tile.title] as keyof typeof CLOUD_METRIC_DESCRIPTIONS
        ],
      );
    }
  });

  test("every chart card is paired with its own text", () => {
    const cards: Array<{ title: string; body: string }> = chartCards(code);

    expect(
      cards.map((card: { title: string }): string => {
        return card.title;
      }),
    ).toEqual(Object.keys(EXPECTED_CHARTS));

    for (const card of cards) {
      expect(countOf(card.body, "description=")).toBe(1);
      expect(card.body).toContain(
        `description={CLOUD_METRIC_DESCRIPTIONS.${EXPECTED_CHARTS[card.title]}}`,
      );
    }
  });

  test("the Top instances card title carries an (i) and keeps its translation", () => {
    const title: string = between(
      code,
      "export const TopInstancesByCpuTitle: FunctionComponent",
      "const CloudResourceOverview",
    );

    expect(code).toContain(
      'const TOP_INSTANCES_TITLE: string = "Top instances by CPU";',
    );
    expect(title).toContain("translateString(TOP_INSTANCES_TITLE)");
    expect(title).toContain("<InfoTooltip label={title}");
    expect(title).toContain(
      "text={CLOUD_METRIC_DESCRIPTIONS.topInstancesByCpu}",
    );

    expect(code).toContain("title={<TopInstancesByCpuTitle />}");
    expect(code).not.toContain('title="Top instances by CPU"');
  });

  test("uses every overview description and no key that does not exist", () => {
    expect(
      [...new Set(referencedKeys(code, "CLOUD_METRIC_DESCRIPTIONS"))].sort(),
    ).toEqual(Object.keys(CLOUD_METRIC_DESCRIPTIONS).sort());
  });

  test("the live-snapshot texts match the live window the page filters on", () => {
    const scope: string = readCode(
      "Pages/Cloud/Utils/CloudResourceTelemetryScope.ts",
    );
    const minutes: RegExpMatchArray | null = scope.match(
      /CLOUD_INSTANCE_LIVE_WINDOW_MINUTES: number = (\d+);/,
    );

    expect(minutes).not.toBeNull();

    for (const key of [
      "cpu",
      "memory",
      "instances",
      "topInstancesByCpu",
    ] as const) {
      expect(CLOUD_METRIC_DESCRIPTIONS[key]).toContain(
        `${(minutes as RegExpMatchArray)[1]} minutes`,
      );
    }

    expect(CLOUD_FLEET_METRIC_DESCRIPTIONS.liveInstances).toContain(
      `${(minutes as RegExpMatchArray)[1]} minutes`,
    );
    expect(code).toContain("isCloudInstanceLive(i.lastSeenAt, now)");
  });

  test("the Memory chart text names the metric and aggregation the page fetches", () => {
    const fetch: string = between(code, "fetchMetricSeries({", "})");

    expect(fetch).toContain('name: "container.memory.usage"');
    expect(fetch).toContain("aggregationType: AggregationType.Sum");
    expect(CLOUD_METRIC_DESCRIPTIONS.memoryChart).toContain(
      "container.memory.usage",
    );
    expect(CLOUD_METRIC_DESCRIPTIONS.memoryChart).toMatch(/added up/);
  });
});

describe("Cloud fleet summary tooltips", () => {
  const util: string = readCode("Pages/Cloud/Utils/CloudFleetSummary.ts");
  const component: string = readCode("Components/Cloud/CloudFleetSummary.tsx");

  const EXPECTED: Record<string, string> = {
    Environments: "environments",
    Connected: "connected",
    Disconnected: "disconnected",
    "Live instances": "liveInstances",
  };

  test("a description is a required field of every tile", () => {
    const shape: string = between(
      util,
      "export interface CloudFleetSummaryTile {",
      "}",
    );

    expect(shape).toContain("description: string;");
    expect(shape).not.toContain("description?:");
  });

  test("every tile summarizeCloudFleet returns is paired with its own text", () => {
    const tiles: Array<{ title: string; body: string }> = tileChunks(
      between(util, "return [", "];"),
    );

    expect(
      tiles.map((tile: { title: string }): string => {
        return tile.title;
      }),
    ).toEqual(Object.keys(EXPECTED));

    for (const tile of tiles) {
      expect(countOf(tile.body, "description:")).toBe(1);
      expect(tile.body).toContain(
        `description: CLOUD_FLEET_METRIC_DESCRIPTIONS.${EXPECTED[tile.title]},`,
      );
    }
  });

  test("uses every fleet description and no key that does not exist", () => {
    expect(
      [
        ...new Set(referencedKeys(util, "CLOUD_FLEET_METRIC_DESCRIPTIONS")),
      ].sort(),
    ).toEqual(Object.keys(CLOUD_FLEET_METRIC_DESCRIPTIONS).sort());
  });

  test("the strip renders the (i) beside each tile title", () => {
    expect(component).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );

    const tile: string = between(
      component,
      'data-testid="cloud-fleet-summary-tile"',
      "{tile.value}",
    );

    expect(tile).toContain("{tile.title}");
    expect(tile).toContain(
      "<InfoTooltip label={tile.title} text={tile.description} />",
    );
    // The tile is a plain card, not a link or button the (i) would nest in.
    expect(tile).not.toContain("<a ");
    expect(tile).not.toContain("<button");
    expect(tile).not.toContain("<AppLink");
  });

  test("the fleet texts say which rows the counts include", () => {
    const fetch: string = between(
      component,
      "export async function fetchCloudFleetCounts()",
      "const byProvider",
    );

    // Environments: unarchived only.
    expect(fetch).toContain("query: { isArchived: false },");
    expect(CLOUD_FLEET_METRIC_DESCRIPTIONS.environments).toMatch(
      /not counting archived/,
    );

    // Live instances: no archive filter on the parent environment.
    const instances: string = between(
      fetch,
      "modelType: CloudResourceInstance,",
      "}),",
    );

    expect(instances).not.toContain("isArchived");
    expect(CLOUD_FLEET_METRIC_DESCRIPTIONS.liveInstances).toMatch(
      /archived ones included/,
    );
  });
});

describe("Cloud Instances tab tooltips", () => {
  const code: string = readCode("Pages/Cloud/View/Instances.tsx");
  const columnsBlock: string = between(code, "columns={[", "]} />");

  // Column title -> description key, or null for a column with no metric.
  const EXPECTED_COLUMNS: Record<string, string | null> = {
    Instance: null,
    Status: null,
    CPU: "cpu",
    Memory: "memory",
    "Last Seen": null,
  };

  test("imports its descriptions from the shared module", () => {
    expect(code).toContain(
      'import { CLOUD_INSTANCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CloudMetricDescriptions";',
    );
  });

  test("CPU and Memory carry their own text in the header; the other columns carry none", () => {
    const columns: Array<{ title: string; body: string }> =
      tileChunks(columnsBlock);

    expect(
      columns.map((column: { title: string }): string => {
        return column.title;
      }),
    ).toEqual(Object.keys(EXPECTED_COLUMNS));

    for (const column of columns) {
      const key: string | null = EXPECTED_COLUMNS[column.title] as
        | string
        | null;

      expect({
        title: column.title,
        headerTooltips: countOf(column.body, "headerTooltip:"),
      }).toEqual({ title: column.title, headerTooltips: key ? 1 : 0 });

      if (key) {
        expect(column.body).toContain(
          `headerTooltip: CLOUD_INSTANCE_METRIC_DESCRIPTIONS.${key},`,
        );
      }
    }
  });

  test("uses every instance description and no key that does not exist", () => {
    expect(
      [
        ...new Set(referencedKeys(code, "CLOUD_INSTANCE_METRIC_DESCRIPTIONS")),
      ].sort(),
    ).toEqual(Object.keys(CLOUD_INSTANCE_METRIC_DESCRIPTIONS).sort());
  });

  test("'kept until a newer one arrives': ingest only ever writes a reading it has", () => {
    const service: string = readPackageCode(
      "Common/Server/Services/CloudResourceInstanceService.ts",
    );
    const recordInstance: string = between(
      service,
      "public async recordInstance(",
      "public async deleteStaleForResource(",
    );

    expect(recordInstance).toContain(
      "if (data.cpuPercent !== undefined) { fields.latestCpuPercent = data.cpuPercent; }",
    );
    expect(recordInstance).toContain(
      "if (data.memoryBytes !== undefined) { fields.latestMemoryBytes = data.memoryBytes; }",
    );
    // The update and the create each write a reading once, and never clear it.
    expect(countOf(recordInstance, "latestCpuPercent =")).toBe(2);
    expect(countOf(recordInstance, "latestMemoryBytes =")).toBe(2);

    for (const key of ["cpu", "memory"] as const) {
      expect(CLOUD_INSTANCE_METRIC_DESCRIPTIONS[key]).toContain(
        "one snapshot, not an average",
      );
      expect(CLOUD_INSTANCE_METRIC_DESCRIPTIONS[key]).toContain(
        "kept until a newer one arrives",
      );
    }
  });

  test("'can read above 100%': CPU is stored as the receiver sends it, and shown uncapped", () => {
    const ingest: string = readPackageCode(
      "App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts",
    );
    const cpuPercent: string = between(
      ingest,
      'case "cpuPercent": {',
      'case "cpuRatio": {',
    );

    expect(cpuPercent).toContain("value: rawValue,");

    const cpuColumn: string = between(
      columnsBlock,
      'title: "CPU",',
      'title: "Memory",',
    );

    expect(cpuColumn).toContain(
      'formatPercent( typeof item.latestCpuPercent === "number" ? item.latestCpuPercent : null, )',
    );
    expect(cpuColumn).not.toContain("Math.min");
    expect(CLOUD_INSTANCE_METRIC_DESCRIPTIONS.cpu).toContain(
      "so it can read above 100%",
    );
  });

  test("'A dash means no reading has arrived': both cells fall back to the dash formatters", () => {
    const memoryColumn: string = between(
      columnsBlock,
      'title: "Memory",',
      'title: "Last Seen",',
    );

    expect(memoryColumn).toContain(
      'formatBytes( typeof item.latestMemoryBytes === "number" ? item.latestMemoryBytes : null, )',
    );

    const format: string = readCode(
      "Components/TelemetryResource/telemetryFormat.ts",
    );

    for (const formatter of ["formatPercent", "formatBytes"]) {
      expect(between(format, `export const ${formatter}:`, "};")).toContain(
        "=== null || !Number.isFinite",
      );
    }

    expect(CLOUD_INSTANCE_METRIC_DESCRIPTIONS.cpu).toContain(
      "A dash means no CPU reading has arrived.",
    );
    expect(CLOUD_INSTANCE_METRIC_DESCRIPTIONS.memory).toContain(
      "A dash means no memory reading has arrived.",
    );
  });

  test("'the whole task's figure is preferred': a task-level ECS point outranks a container's", () => {
    const ingest: string = readPackageCode(
      "App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts",
    );

    expect(ingest).toContain(
      "const CLOUD_SNAPSHOT_RANK_CONTAINER: number = 0;",
    );
    expect(ingest).toContain("const CLOUD_SNAPSHOT_RANK_TASK: number = 1;");
    expect(ingest).toContain(
      '"ecs.task.memory.utilized", { kind: "memoryMegabytes", rank: CLOUD_SNAPSHOT_RANK_TASK }',
    );
    expect(ingest).toContain(
      '"container.memory.utilized", { kind: "memoryMegabytes", rank: CLOUD_SNAPSHOT_RANK_CONTAINER }',
    );
    expect(ingest).toContain("return incoming.rank > existing.rank;");
    expect(CLOUD_INSTANCE_METRIC_DESCRIPTIONS.memory).toContain(
      "For an ECS task the whole task's figure is preferred over a single container's.",
    );
  });

  test("the tab has no time picker, so neither text claims a range", () => {
    expect(code).not.toContain("TimeRangePicker");

    for (const key of ["cpu", "memory"] as const) {
      expect(CLOUD_INSTANCE_METRIC_DESCRIPTIONS[key]).not.toContain("range");
    }
  });
});

describe("Service Profiles flame graph tooltip", () => {
  const code: string = readCode("Pages/Service/View/Profiles.tsx");
  const text: string = SERVICE_PROFILE_METRIC_DESCRIPTIONS.flamegraph;

  test("imports the text and the (i)", () => {
    expect(code).toContain(
      'import { SERVICE_PROFILE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ServiceMetricDescriptions";',
    );
    expect(code).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
  });

  test("the heading above the flame graph carries an (i) with its own text", () => {
    expect(code).toContain(
      'const FLAMEGRAPH_TITLE: string = "Where the time is going";',
    );

    const heading: string = between(
      code,
      '<div className="flex items-center gap-1">',
      "</div>",
    );

    expect(heading).toContain(
      '<h3 className="text-sm font-semibold text-gray-900"> {FLAMEGRAPH_TITLE} </h3>',
    );
    expect(heading).toContain(
      "<InfoTooltip label={FLAMEGRAPH_TITLE} text={SERVICE_PROFILE_METRIC_DESCRIPTIONS.flamegraph} />",
    );
    // The (i) is a button: never inside another control.
    expect(heading).not.toContain("<button");
    expect(heading).not.toContain("<a ");
    expect(countOf(code, "<InfoTooltip")).toBe(1);
    // The heading is not hand-typed a second time.
    expect(countOf(code, "Where the time is going")).toBe(1);
  });

  test("uses every profile description and no key that does not exist", () => {
    expect(
      [
        ...new Set(referencedKeys(code, "SERVICE_PROFILE_METRIC_DESCRIPTIONS")),
      ].sort(),
    ).toEqual(Object.keys(SERVICE_PROFILE_METRIC_DESCRIPTIONS).sort());
  });

  test("'the time window picked beside it': the flame graph reads the tab's own chips", () => {
    expect(code).toContain('{ label: "15m", minutes: 15 }');
    expect(code).toContain('{ label: "7d", minutes: 60 * 24 * 7 }');
    expect(code).toContain(
      "OneUptimeDate.addRemoveMinutes(now, -rangeMinutes)",
    );
    expect(code).toContain("startTime={startTime} endTime={endTime}");
    expect(text).toContain("in the time window picked beside it");
  });

  test("'CPU time by default', and 'every type added together for Everything'", () => {
    expect(code).toContain('const DEFAULT_PROFILE_TYPE: string = "cpu";');
    expect(text).toContain("CPU time by default");

    // Everything sends no type, and the server then filters on none.
    const selector: string = readCode(
      "Components/Profiles/ProfileTypeSelector.tsx",
    );

    expect(selector).toContain(
      'label: "Everything", description: "All profile types", value: undefined,',
    );

    const util: string = readCode("Utils/ProfileUtil.ts");

    expect(
      between(util, "public static getQueryProfileTypes(", "switch"),
    ).toContain("if (!selection) { return undefined; }");

    const server: string = readPackageCode(
      "Common/Server/Services/ProfileAggregationService.ts",
    );

    expect(server).toContain(
      "if (request.profileTypes && request.profileTypes.length > 0) {",
    );
    expect(server).toContain("toFloat64(sum(value)) AS totalValue");
    expect(text).toContain("every type added together for Everything");
  });

  test("'The functions a bar calls sit below it': children are drawn one row down", () => {
    const view: string = readCode("Components/Profiles/FlamegraphView.tsx");

    expect(view).toContain("top: `${depth * FRAME_HEIGHT}px`");
    expect(view).toContain(
      "renderNode(child, depth + 1, currentOffset, childWidth)",
    );
    expect(text).toContain("The functions a bar calls sit below it.");
  });
});
