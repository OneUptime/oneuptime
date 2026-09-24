import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CONTAINER_HOST_METRIC_DESCRIPTIONS,
  ContainerHostMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/ContainerHostMetricDescriptions";

/*
 * The Docker host and Podman host Overview and Containers pages put an (i)
 * beside every number, explaining it in plain words. The App suite runs in
 * plain Node with no renderer, so this pins the wiring at the source level:
 * every tile, chart card, consumer list and metric column is paired with the
 * description written for it, and none is left without one. The rendered
 * behaviour (hover shows the text, values match the words) is covered by
 * Common/Tests/App/Dashboard/ContainerHostMetricTooltips.test.tsx.
 *
 * Comments are stripped and whitespace squashed so Prettier reflows and
 * rationale comments cannot make a test pass or fail.
 */

const PAGES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
);

const RECORD: string = "CONTAINER_HOST_METRIC_DESCRIPTIONS";
const DESCRIPTIONS_IMPORT: string =
  'import { CONTAINER_HOST_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ContainerHostMetricDescriptions";';

const WHITESPACE_PATTERN: RegExp = /\s+/g;
const BLOCK_COMMENT_PATTERN: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_PATTERN: RegExp = /(^|[^:])\/\/[^\n]*/g;
const JSX_EMPTY_EXPRESSION_PATTERN: RegExp = /\{\s*\}/g;
const TILE_PATTERN: RegExp = /<GoldenMetricTile\b[\s\S]*?\/>/g;
const CHART_CALL_PATTERN: RegExp = /renderChartCard\(\{[\s\S]*?\}\)/g;
const TITLE_ATTRIBUTE_PATTERN: RegExp = /title="([^"]+)"/;
const TITLE_PROPERTY_PATTERN: RegExp = /title: "([^"]+)"/;
const RECORD_KEY_PATTERN: RegExp =
  /CONTAINER_HOST_METRIC_DESCRIPTIONS\.([A-Za-z]+)/;
const RECORD_KEY_GLOBAL_PATTERN: RegExp =
  /CONTAINER_HOST_METRIC_DESCRIPTIONS\.([A-Za-z]+)/g;
const COLUMN_START: string = '{ title: "';
const RENDER_LIST_CALL_PATTERN: RegExp =
  /renderList\( "([^"]+)", stats\.\w+, "(cpu|memory)", CONTAINER_HOST_METRIC_DESCRIPTIONS\.(\w+), \)/g;
const RUNTIME_WORD_PATTERN: RegExp = /docker|podman/i;
const COLUMN_TITLE_GLOBAL_PATTERN: RegExp = /\}, title: "([^"]*)",/g;
const DOCKER_TITLE_CASE: RegExp = /Docker/g;
const DOCKER_LOWER_CASE: RegExp = /docker/g;
const DOCKER_UPPER_CASE: RegExp = /DOCKER/g;

function squash(text: string): string {
  return text.replace(WHITESPACE_PATTERN, " ");
}

function stripComments(text: string): string {
  return text
    .replace(BLOCK_COMMENT_PATTERN, " ")
    .replace(LINE_COMMENT_PATTERN, "$1")
    .replace(JSX_EMPTY_EXPRESSION_PATTERN, " ");
}

function readRaw(relativePath: string): string {
  return fs.readFileSync(
    path.join(PAGES_DIR, ...relativePath.split("/")),
    "utf8",
  );
}

function readCode(relativePath: string): string {
  return squash(stripComments(readRaw(relativePath)));
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function keyIn(block: string): string | null {
  const match: RegExpMatchArray | null = block.match(RECORD_KEY_PATTERN);

  return match ? match[1]! : null;
}

// Replaces the runtime's name in every casing, the only way the pages differ.
function asPodman(source: string): string {
  return source
    .replace(DOCKER_TITLE_CASE, "Podman")
    .replace(DOCKER_LOWER_CASE, "podman")
    .replace(DOCKER_UPPER_CASE, "PODMAN");
}

const RUNTIMES: Array<string> = ["Docker", "Podman"];

/*
 * Each title on the overview and the description it must carry. The tiles
 * and the charts share titles but not texts: a tile is one number from the
 * last few minutes, a chart is the whole range.
 */
const TILE_KEYS: Array<[string, ContainerHostMetric]> = [
  ["Containers", "containers"],
  ["Avg CPU", "avgCpu"],
  ["Peak CPU", "peakCpu"],
  ["Avg Memory", "avgMemory"],
  ["Peak Memory", "peakMemory"],
  ["Processes", "processes"],
];

const CHART_KEYS: Array<[string, ContainerHostMetric]> = [
  ["Availability", "availabilityChart"],
  ["Avg CPU", "avgCpuChart"],
  ["Peak CPU", "peakCpuChart"],
  ["Avg Memory", "avgMemoryChart"],
  ["Peak Memory", "peakMemoryChart"],
  ["Network", "networkChart"],
];

const LIST_KEYS: Array<[string, ContainerHostMetric]> = [
  ["Top CPU Consumers", "topCpuConsumers"],
  ["Top Memory Consumers", "topMemoryConsumers"],
];

const COLUMN_KEYS: Array<[string, ContainerHostMetric]> = [
  ["CPU", "containerCpu"],
  ["Memory", "containerMemory"],
  ["Memory %", "containerMemoryPercent"],
  ["Network RX (total)", "containerNetworkRx"],
  ["Network TX (total)", "containerNetworkTx"],
];

// Columns that are facts, not measurements, and so carry no (i).
const PLAIN_COLUMNS: Array<string> = ["Container Name", "Image", ""];

describe.each(RUNTIMES)("%s host overview", (runtime: string) => {
  const file: string = `${runtime}/View/Overview.tsx`;
  const code: string = readCode(file);
  const raw: string = readRaw(file);

  test("imports the shared tile, the (i) and the container host descriptions", () => {
    expect(code).toContain(
      'from "../../../Components/Infrastructure/GoldenMetricTile"',
    );
    expect(code).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
    expect(raw).toContain(DESCRIPTIONS_IMPORT);
  });

  test("no longer carries its own copy of the metric tile", () => {
    /*
     * The local MetricTile was the GoldenMetricTile markup minus the (i);
     * a second copy would drift from it again.
     */
    expect(code).not.toContain("const MetricTile");
    expect(code).not.toContain("<MetricTile");
    expect(code).not.toContain("const colorClasses");
    expect(code).toContain("tileColorClasses[params.iconColor]");
  });

  test("every summary tile carries the description written for it", () => {
    const tiles: Array<string> = code.match(TILE_PATTERN) || [];
    const pairs: Array<[string, string | null]> = tiles.map(
      (tile: string): [string, string | null] => {
        return [tile.match(TITLE_ATTRIBUTE_PATTERN)![1]!, keyIn(tile)];
      },
    );

    expect(pairs).toEqual(TILE_KEYS);

    for (const tile of tiles) {
      expect(tile).toContain(`description={${RECORD}.`);
    }
  });

  test("the Processes tile shows the process total the page already computed", () => {
    const tiles: Array<string> = code.match(TILE_PATTERN) || [];
    const processes: string = tiles.find((tile: string): boolean => {
      return tile.includes('title="Processes"');
    })!;

    expect(processes).toContain("value={formatInt(s.totalPids)}");
    // The pid count includes threads; the tile says so, not just the (i).
    expect(processes).toContain('sublabel="incl. threads"');
    expect(code).toContain('"container.pids.count"');
    expect(code).toContain("totalPids: totalPids");
  });

  test("the tile grid has room for all six tiles", () => {
    expect(code).toContain(
      "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
    );
    expect(code).not.toContain("lg:grid-cols-5");
  });

  test("the memory tile no longer claims every percent is of a container limit", () => {
    /*
     * Containers run without a memory limit by default, and then
     * container.memory.percent is of the host's memory.
     */
    expect(code).not.toContain('sublabel="of container limit"');
    expect(code).toContain('sublabel="of limit or host memory"');
  });

  test("every chart card is called with the description written for it", () => {
    const calls: Array<string> = code.match(CHART_CALL_PATTERN) || [];
    const pairs: Array<[string, string | null]> = calls.map(
      (call: string): [string, string | null] => {
        return [call.match(TITLE_PROPERTY_PATTERN)![1]!, keyIn(call)];
      },
    );

    expect(pairs).toEqual(CHART_KEYS);

    for (const call of calls) {
      expect(call).toContain(`description: ${RECORD}.`);
    }
  });

  test("the chart card draws the (i) in the loading skeleton and in the loaded card", () => {
    const definition: string = between(
      code,
      "const renderChartCard:",
      "const renderCharts:",
    );

    expect(definition).toContain("description?: string | undefined;");
    expect(definition).toContain(
      "<InfoTooltip label={params.title} text={params.description} />",
    );

    const skeleton: string = between(
      definition,
      "if (!chartWindow) {",
      "const xAxis: ChartXAxis",
    );
    const loaded: string = definition.slice(
      definition.indexOf("const xAxis: ChartXAxis"),
    );

    expect(skeleton).toContain("{renderTitle()}");
    expect(loaded).toContain("{renderTitle()}");
    // The title is only ever drawn through renderTitle, so never without its (i).
    expect(countOf(definition, "{params.title} </span>")).toBe(1);
  });

  test("the tiles and lists still use the window their texts describe", () => {
    /*
     * The tile texts say "the last 5 minutes of the selected range (often
     * the whole range on ranges over 12 hours or without recent data)"; the
     * list texts say "up to five" and "latest interval". Change any of these
     * and the words go stale.
     */
    expect(code).toContain("const TILE_WINDOW_MINUTES: number = 5;");
    expect(code).toContain(
      "const tileWindowStart: Date = OneUptimeDate.addRemoveMinutes( endDate, -TILE_WINDOW_MINUTES, );",
    );

    const recentMean: string = between(
      code,
      "const meanInRecentWindow:",
      "const cpuAvgPoints:",
    );

    expect(recentMean).toContain("if (p.x.getTime() < tileWindowStartMs) {");
    // Nothing recent: every slot in the range counts instead.
    expect(recentMean).toContain("if (count === 0) {");

    for (const reducer of [
      'reduceAcrossContainers( cpuResult, "avg", )',
      'reduceAcrossContainers( cpuResult, "max", )',
      'reduceAcrossContainers( memResult, "avg", )',
      'reduceAcrossContainers( memResult, "max", )',
    ]) {
      expect(code).toContain(reducer);
    }

    expect(countOf(code, ".slice(0, 5);")).toBe(2);
    expect(code).toContain("if (prev === undefined || t > prev) {");
  });

  test("the availability subtitle says what it shows without 'per-bucket' jargon", () => {
    expect(code).not.toContain("Per-bucket presence of host heartbeats");
    expect(code).toContain("agent was sending metrics");
  });

  test("both consumer lists pass their description to the card title", () => {
    const calls: Array<[string, string, string]> = [];

    for (const match of code.matchAll(RENDER_LIST_CALL_PATTERN)) {
      calls.push([match[1]!, match[2]!, match[3]!]);
    }

    expect(
      calls.map((call: [string, string, string]): [string, string] => {
        return [call[0], call[2]];
      }),
    ).toEqual(LIST_KEYS);

    const renderList: string = between(
      code,
      "const renderList:",
      'return ( <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">',
    );

    expect(renderList).toContain("description: string,");
    expect(renderList).toContain(
      '<InfoTooltip label={title} text={description} iconClassName="h-4 w-4" />',
    );
  });

  test("the hero's container count carries its (i); the OS chips carry none", () => {
    const chips: string = between(
      code,
      "const specChips: Array<SpecChip> = [];",
      "const statusBadgeClass",
    );

    expect(chips).toContain(`description: ${RECORD}.containers,`);
    expect(countOf(chips, "description:")).toBe(1);

    expect(code).toContain(
      '<InfoTooltip label={chip.label} text={chip.description} iconClassName="h-3 w-3" />',
    );
  });

  test("every (i) on the page reads from the container host record", () => {
    const tooltips: number = countOf(code, "<InfoTooltip");
    const references: Array<string> = Array.from(
      code.matchAll(RECORD_KEY_GLOBAL_PATTERN),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    /*
     * Three (i) elements serve every metric: the chart-card title, the
     * consumer-card title and the hero chip. The shared tile draws its own.
     */
    expect(tooltips).toBe(3);
    expect(new Set(references)).toEqual(
      new Set<string>([
        ...TILE_KEYS.map((pair: [string, ContainerHostMetric]): string => {
          return pair[1];
        }),
        ...CHART_KEYS.map((pair: [string, ContainerHostMetric]): string => {
          return pair[1];
        }),
        ...LIST_KEYS.map((pair: [string, ContainerHostMetric]): string => {
          return pair[1];
        }),
      ]),
    );
  });
});

describe.each(RUNTIMES)("%s host containers table", (runtime: string) => {
  const file: string = `${runtime}/View/Containers.tsx`;
  const code: string = readCode(file);
  const raw: string = readRaw(file);
  const columnsBlock: string = between(
    code,
    "const tableColumns:",
    "const actionButtons:",
  );

  // Each column runs from its `{ title: "` to the next column's.
  function columns(): Array<{ title: string; block: string }> {
    return columnsBlock
      .split(COLUMN_START)
      .slice(1)
      .map((part: string): { title: string; block: string } => {
        return { title: part.slice(0, part.indexOf('"')), block: part };
      });
  }

  test("imports the container host descriptions", () => {
    expect(raw).toContain(DESCRIPTIONS_IMPORT);
  });

  test("every metric column explains itself in a header tooltip", () => {
    const withTooltip: Array<[string, string | null]> = columns()
      .filter((column: { title: string; block: string }): boolean => {
        return column.block.includes("headerTooltip:");
      })
      .map(
        (column: { title: string; block: string }): [string, string | null] => {
          return [column.title, keyIn(column.block)];
        },
      );

    expect(withTooltip).toEqual(COLUMN_KEYS);
  });

  test("columns that are facts, not measurements, carry no tooltip", () => {
    const plain: Array<string> = columns()
      .filter((column: { title: string; block: string }): boolean => {
        return !column.block.includes("headerTooltip:");
      })
      .map((column: { title: string; block: string }): string => {
        return column.title;
      });

    expect(plain).toEqual(PLAIN_COLUMNS);
  });

  test("the table still reads the last 5 minutes before now, as the texts say", () => {
    expect(code).toContain(
      "const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -5);",
    );
    expect(code).toContain(
      "const endDate: Date = OneUptimeDate.getCurrentDate();",
    );
  });
});

describe("Docker and Podman pages stay identical", () => {
  /*
   * One set of descriptions serves both runtimes because the pages compute
   * the same things the same way. If one page drifts - a different window, a
   * different reducer - its tooltips would describe the other page.
   */
  test.each(["Overview.tsx", "Containers.tsx"])(
    "%s differs only in the runtime's name",
    (file: string) => {
      expect(readRaw(`Podman/View/${file}`)).toBe(
        asPodman(readRaw(`Docker/View/${file}`)),
      );
    },
  );

  test("the host lists differ only in the runtime's name", () => {
    expect(readRaw("Podman/Hosts.tsx")).toBe(
      asPodman(readRaw("Docker/Hosts.tsx")),
    );
  });

  test.each(RUNTIMES)(
    "the %s host list shows no metric, so it carries no (i)",
    (runtime: string) => {
      /*
       * Name, Host Identifier, connection Status, Last Seen, Labels and
       * Owners are facts about the host record. The day a metric column
       * (containers, CPU, ...) is added it needs a headerTooltip from the
       * container host record, and this list needs updating.
       */
      const code: string = readCode(`${runtime}/Hosts.tsx`);
      const columns: string = between(code, "columns={[", "onViewPage=");
      const titles: Array<string> = Array.from(
        columns.matchAll(COLUMN_TITLE_GLOBAL_PATTERN),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(titles).toEqual([
        "Name",
        "Host Identifier",
        "Status",
        "Last Seen",
        "Labels",
        "Owners",
      ]);
      expect(columns).not.toContain("headerTooltip");
      expect(code).not.toContain(RECORD);
    },
  );

  test("each page queries its own runtime", () => {
    for (const file of ["Overview.tsx", "Containers.tsx"]) {
      expect(readCode(`Docker/View/${file}`)).toContain(
        '"resource.container.runtime": "docker"',
      );
      expect(readCode(`Podman/View/${file}`)).toContain(
        '"resource.container.runtime": "podman"',
      );
    }
  });
});

describe("the container host description record", () => {
  test("every description is shown by the Docker (and so the Podman) pages", () => {
    const shown: Set<string> = new Set<string>();

    for (const file of [
      "Docker/View/Overview.tsx",
      "Docker/View/Containers.tsx",
    ]) {
      for (const match of readCode(file).matchAll(RECORD_KEY_GLOBAL_PATTERN)) {
        shown.add(match[1]!);
      }
    }

    expect(Array.from(shown).sort()).toEqual(
      Object.keys(CONTAINER_HOST_METRIC_DESCRIPTIONS).sort(),
    );
  });

  test("the words never name a runtime, so they read true on both pages", () => {
    for (const [key, text] of Object.entries(
      CONTAINER_HOST_METRIC_DESCRIPTIONS,
    )) {
      expect({ key, namesRuntime: RUNTIME_WORD_PATTERN.test(text) }).toEqual({
        key,
        namesRuntime: false,
      });
    }
  });

  test("the Containers table texts never mention a selected range - that page has no time picker", () => {
    for (const [, key] of COLUMN_KEYS) {
      const text: string = CONTAINER_HOST_METRIC_DESCRIPTIONS[key];

      expect(text).not.toContain("selected range");
    }

    for (const key of ["containerCpu", "containerMemory"] as const) {
      expect(CONTAINER_HOST_METRIC_DESCRIPTIONS[key]).toContain(
        "within the last 5 minutes",
      );
    }
  });
});
