import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  HOST_METRIC_DESCRIPTIONS,
  HostMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";

/*
 * Every metric on the Host pages carries a small (i) that explains it: the
 * overview's tiles, charts, Filesystems columns and cached process count;
 * a process's tiles and charts; a Windows service's and a systemd unit's
 * tiles and timeline; and the metric columns of the three lists.
 *
 * The App suite runs in plain Node with no renderer and App/tsconfig.json
 * excludes FeatureSet/Dashboard, so these pin the wiring by reading the
 * sources (the render tests live in Common/Tests/App/Dashboard/Host*).
 * Comments are stripped and whitespace squashed first, so a Prettier reflow
 * or a rationale comment cannot make a test pass or fail.
 */

const HOST_VIEW_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Host",
  "View",
);

const IMPORT_LINE: string =
  'import { HOST_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/HostMetricDescriptions";';
const TOOLTIP_IMPORT: string =
  'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";';
const REFERENCE_PATTERN: RegExp = /HOST_METRIC_DESCRIPTIONS\.([A-Za-z]+)/g;
const TITLE_ATTRIBUTE: RegExp = /title="([^"]+)"/;
const TITLE_PROPERTY: RegExp = /title: "([^"]+)"/;
const DESCRIPTION_ATTRIBUTE: RegExp =
  /description=\{HOST_METRIC_DESCRIPTIONS\.([A-Za-z]+)\}/;
const DESCRIPTION_PROPERTY: RegExp =
  /description: HOST_METRIC_DESCRIPTIONS\.([A-Za-z]+),/;
const HEADER_TOOLTIP_PROPERTY: RegExp =
  /headerTooltip: HOST_METRIC_DESCRIPTIONS\.([A-Za-z]+),/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE_RUN: RegExp = /\s+/g;

function squash(text: string): string {
  return text.replace(WHITESPACE_RUN, " ");
}

function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

function readRaw(file: string): string {
  return fs.readFileSync(path.join(HOST_VIEW_DIR, file), "utf8");
}

function readCode(file: string): string {
  return squash(stripComments(readRaw(file)));
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

  return source.slice(start, end + to.length);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/*
 * Each self-closing JSX element `<Tag ... />`. None of the props these pages
 * pass to a tile contains "/>", so the first one closes the element.
 */
function elements(code: string, tag: string): Array<string> {
  const found: Array<string> = [];
  let from: number = code.indexOf(`<${tag} `);

  while (from >= 0) {
    const end: number = code.indexOf("/>", from);

    expect(end).toBeGreaterThan(from);
    found.push(code.slice(from, end + 2));
    from = code.indexOf(`<${tag} `, end);
  }

  return found;
}

// Each `renderChartCard({ ... })` call, up to its closing `})`.
function chartCardCalls(code: string): Array<string> {
  const found: Array<string> = [];
  let from: number = code.indexOf("renderChartCard({");

  while (from >= 0) {
    const end: number = code.indexOf("})", from);

    expect(end).toBeGreaterThan(from);
    found.push(code.slice(from, end + 2));
    from = code.indexOf("renderChartCard({", end);
  }

  return found;
}

function titleAndKey(
  element: string,
  titlePattern: RegExp,
  keyPattern: RegExp,
): [string, string] {
  const title: RegExpMatchArray | null = element.match(titlePattern);
  const key: RegExpMatchArray | null = element.match(keyPattern);

  return [title ? title[1]! : "(no title)", key ? key[1]! : "(no description)"];
}

/*
 * An (i) is a <button>; a button inside another button or a link is invalid
 * HTML and steals the outer control's click. Walk the source and make sure
 * no InfoTooltip opens while a <button>, <Link> or <a> is still open.
 */
function tooltipsNestedInInteractive(code: string): number {
  const token: RegExp = /<(\/?)(button|Link|a|InfoTooltip)\b([^>]*?)(\/?)>/g;
  let open: number = 0;
  let nested: number = 0;
  let match: RegExpExecArray | null = token.exec(code);

  while (match) {
    const closing: boolean = match[1] === "/";
    const name: string = match[2]!;
    const selfClosing: boolean = match[4] === "/";

    if (name === "InfoTooltip") {
      if (open > 0) {
        nested++;
      }
    } else if (closing) {
      open--;
    } else if (!selfClosing) {
      open++;
    }

    match = token.exec(code);
  }

  return nested;
}

const PAGES: Array<string> = [
  "Overview.tsx",
  "ProcessView.tsx",
  "ServiceView.tsx",
  "SystemdUnitView.tsx",
  "Processes.tsx",
  "Services.tsx",
  "SystemdUnits.tsx",
];

const KEYS_BY_PAGE: Record<string, Array<HostMetric>> = {
  "Overview.tsx": [
    "cpu",
    "memory",
    "filesystem",
    "loadAverage",
    "processes",
    "filesystemUsedTotal",
    "filesystemUtilization",
    "availabilityChart",
    "cpuChart",
    "memoryChart",
    "diskSpaceChart",
    "networkChart",
    "processCountCached",
  ],
  "ProcessView.tsx": [
    "processCpu",
    "processMemoryRss",
    "processVirtualMemory",
    "processThreads",
    "processCpuChart",
    "processMemoryRssChart",
    "processDiskIoChart",
  ],
  "ServiceView.tsx": [
    "serviceCurrentStatus",
    "serviceAvailability",
    "serviceStartupMode",
    "serviceStateChanges",
    "serviceStatusTimeline",
  ],
  "SystemdUnitView.tsx": [
    "unitCurrentState",
    "unitAvailability",
    "unitType",
    "unitStateChanges",
    "unitStateTimeline",
  ],
  "Processes.tsx": ["processListCpu", "processListMemory"],
  "Services.tsx": ["serviceListStartup", "serviceListStatus"],
  "SystemdUnits.tsx": ["unitListType", "unitListState"],
};

describe("every Host description is shown, once, on the page it describes", () => {
  test.each(PAGES)("%s imports the Host descriptions", (page: string) => {
    expect(readRaw(page)).toContain(IMPORT_LINE);
  });

  test.each(PAGES)(
    "%s references exactly its own keys, in page order",
    (page: string) => {
      const code: string = readCode(page);
      const referenced: Array<string> = Array.from(
        code.matchAll(REFERENCE_PATTERN),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(referenced).toEqual(KEYS_BY_PAGE[page]);
    },
  );

  test("the pages between them reference every key of the record", () => {
    const all: Array<string> = Object.values(KEYS_BY_PAGE).flat();

    expect([...all].sort()).toEqual(
      Object.keys(HOST_METRIC_DESCRIPTIONS).sort(),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  test.each(PAGES)(
    "%s never nests an (i) inside a button or a link",
    (page: string) => {
      expect(tooltipsNestedInInteractive(readCode(page))).toBe(0);
    },
  );

  test("the nesting check itself catches a nested (i)", () => {
    expect(
      tooltipsNestedInInteractive(
        '<Link to={r}><span>CPU</span><InfoTooltip label="CPU" text={t} /></Link>',
      ),
    ).toBe(1);
    expect(
      tooltipsNestedInInteractive(
        '<button type="button">CPU</button><InfoTooltip label="CPU" text={t} />',
      ),
    ).toBe(0);
  });
});

describe("Host overview", () => {
  const code: string = readCode("Overview.tsx");

  test("uses the shared GoldenMetricTile, not a local copy", () => {
    expect(code).toContain(
      'import GoldenMetricTile, { tileColorClasses, } from "../../../Components/Infrastructure/GoldenMetricTile";',
    );
    expect(code).not.toContain("const MetricTile");
    expect(code).not.toContain("<MetricTile ");
    expect(code).not.toContain("interface MetricTileProps");
  });

  test("every tile carries the description for its own title", () => {
    const tiles: Array<[string, string]> = elements(
      code,
      "GoldenMetricTile",
    ).map((tile: string): [string, string] => {
      return titleAndKey(tile, TITLE_ATTRIBUTE, DESCRIPTION_ATTRIBUTE);
    });

    expect(tiles).toEqual([
      ["CPU", "cpu"],
      ["Memory", "memory"],
      ["Filesystem", "filesystem"],
      ["Load avg (1m)", "loadAverage"],
      ["Processes", "processes"],
    ]);
  });

  test("every chart card passes the description for its own title", () => {
    const charts: Array<[string, string]> = chartCardCalls(code).map(
      (call: string): [string, string] => {
        return titleAndKey(call, TITLE_PROPERTY, DESCRIPTION_PROPERTY);
      },
    );

    expect(charts).toEqual([
      ["Availability", "availabilityChart"],
      ["CPU", "cpuChart"],
      ["Memory", "memoryChart"],
      ["Disk space", "diskSpaceChart"],
      ["Network", "networkChart"],
    ]);
  });

  test("renderChartCard draws the (i) in the skeleton AND the loaded card", () => {
    const definition: string = between(
      code,
      "const renderChartCard:",
      "const renderCharts:",
    );
    const skeleton: string = between(
      definition,
      "if (!chartWindow) {",
      "animate-pulse",
    );
    const loaded: string = definition.slice(
      definition.indexOf("const xAxis: ChartXAxis"),
    );

    expect(definition).toContain("description?: string;");
    expect(
      countOf(
        skeleton,
        "<InfoTooltip label={params.title} text={params.description} />",
      ),
    ).toBe(1);
    expect(
      countOf(
        loaded,
        "<InfoTooltip label={params.title} text={params.description} />",
      ),
    ).toBe(1);
  });

  test("the loaded chart header keeps the uptime badge after the (i)", () => {
    const definition: string = between(
      code,
      "const xAxis: ChartXAxis",
      "<LineChartElement",
    );

    expect(
      definition.indexOf(
        "<InfoTooltip label={params.title} text={params.description} />",
      ),
    ).toBeLessThan(definition.indexOf("{params.headerExtra ?? null}"));
  });

  test("the Filesystems table explains its two metric columns", () => {
    const head: string = between(code, "<thead", "</thead>");
    const usedTotal: string = between(head, "Used / Total", "</th>");
    const utilization: string = between(head, "Utilization", "</th>");

    expect(usedTotal).toContain('<InfoTooltip label="Used / Total"');
    expect(usedTotal).toContain(
      "text={HOST_METRIC_DESCRIPTIONS.filesystemUsedTotal}",
    );
    expect(utilization).toContain('<InfoTooltip label="Utilization"');
    expect(utilization).toContain(
      "text={HOST_METRIC_DESCRIPTIONS.filesystemUtilization}",
    );
    // Mount, Type and Device are names, not metrics.
    expect(countOf(head, "<InfoTooltip")).toBe(2);
  });

  test("the cached process count carries its caption", () => {
    const field: string = between(
      code,
      'key: "processCount",',
      "fieldType: FieldType.Number,",
    );

    expect(field).toContain('title: "Process Count (cached)"');
    expect(field).toContain(
      "description: HOST_METRIC_DESCRIPTIONS.processCountCached,",
    );
  });

  test("imports the (i) it draws", () => {
    expect(readRaw("Overview.tsx")).toContain(TOOLTIP_IMPORT);
  });
});

describe("Host process view", () => {
  const code: string = readCode("ProcessView.tsx");

  test("uses the shared GoldenMetricTile, not a local copy", () => {
    expect(code).not.toContain("const MetricTile");
    expect(code).not.toContain("<MetricTile ");
    expect(code).toContain("tileColorClasses[params.iconColor]");
  });

  test("every tile carries the description for its own title", () => {
    const tiles: Array<[string, string]> = elements(
      code,
      "GoldenMetricTile",
    ).map((tile: string): [string, string] => {
      return titleAndKey(tile, TITLE_ATTRIBUTE, DESCRIPTION_ATTRIBUTE);
    });

    expect(tiles).toEqual([
      ["CPU", "processCpu"],
      ["Memory (RSS)", "processMemoryRss"],
      ["Virtual Memory", "processVirtualMemory"],
      ["Threads", "processThreads"],
    ]);
  });

  test("every chart card passes the description for its own title", () => {
    const charts: Array<[string, string]> = chartCardCalls(code).map(
      (call: string): [string, string] => {
        return titleAndKey(call, TITLE_PROPERTY, DESCRIPTION_PROPERTY);
      },
    );

    expect(charts).toEqual([
      ["CPU", "processCpuChart"],
      ["Memory (RSS)", "processMemoryRssChart"],
      ["Disk I/O", "processDiskIoChart"],
    ]);
  });

  test("renderChartCard draws the (i) in the skeleton AND the loaded card", () => {
    const definition: string = between(
      code,
      "const renderChartCard:",
      "const renderCharts:",
    );

    expect(definition).toContain("description?: string;");
    expect(
      countOf(
        definition,
        "<InfoTooltip label={params.title} text={params.description} />",
      ),
    ).toBe(2);
    expect(
      definition.indexOf("<InfoTooltip label={params.title}"),
    ).toBeLessThan(definition.indexOf("animate-pulse"));
  });
});

describe.each([
  [
    "ServiceView.tsx",
    [
      ["Current Status", "serviceCurrentStatus"],
      ["Availability", "serviceAvailability"],
      ["Startup Mode", "serviceStartupMode"],
      ["State Changes", "serviceStateChanges"],
    ],
    "Status timeline",
    "serviceStatusTimeline",
  ],
  [
    "SystemdUnitView.tsx",
    [
      ["Current State", "unitCurrentState"],
      ["Availability", "unitAvailability"],
      ["Unit Type", "unitType"],
      ["State Changes", "unitStateChanges"],
    ],
    "State timeline",
    "unitStateTimeline",
  ],
])(
  "%s",
  (
    page: string,
    expectedTiles: Array<Array<string>>,
    timeline: string,
    timelineKey: string,
  ) => {
    const code: string = readCode(page);

    test("StatTile takes a description and draws the (i) beside its title", () => {
      // StatTile is followed by the page's StatusPill / StatePill.
      const tile: string = between(
        code,
        "interface StatTileProps {",
        "Pill: FunctionComponent",
      );

      expect(tile).toContain("description?: string | undefined;");
      expect(tile).toContain(
        "{props.title} </span> <InfoTooltip label={props.title} text={props.description} />",
      );
    });

    test("every tile carries the description for its own title", () => {
      const tiles: Array<[string, string]> = elements(code, "StatTile").map(
        (tile: string): [string, string] => {
          return titleAndKey(tile, TITLE_ATTRIBUTE, DESCRIPTION_ATTRIBUTE);
        },
      );

      expect(tiles).toEqual(expectedTiles);
    });

    test("the timeline heading (the chart has no card title) carries its (i)", () => {
      const heading: string = between(code, `${timeline} </h2>`, "/>");

      expect(heading).toContain(`<InfoTooltip label="${timeline}"`);
      expect(heading).toContain(
        `text={HOST_METRIC_DESCRIPTIONS.${timelineKey}}`,
      );
    });

    test("imports the (i) it draws", () => {
      expect(readRaw(page)).toContain(TOOLTIP_IMPORT);
    });
  },
);

describe.each([
  [
    "Processes.tsx",
    [
      ["CPU", "processListCpu"],
      ["Memory", "processListMemory"],
    ],
  ],
  [
    "Services.tsx",
    [
      ["Startup", "serviceListStartup"],
      ["Status", "serviceListStatus"],
    ],
  ],
  [
    "SystemdUnits.tsx",
    [
      ["Type", "unitListType"],
      ["State", "unitListState"],
    ],
  ],
])("%s list columns", (page: string, expected: Array<Array<string>>) => {
  const code: string = readCode(page);
  const columns: string = between(
    code,
    "const tableColumns:",
    "const actionButtons:",
  );

  test("each metric column carries a header tooltip for its own title", () => {
    const withTooltip: Array<[string, string]> = columns
      .split("{ title: ")
      .slice(1)
      .map((column: string): string => {
        return `title: ${column}`;
      })
      .filter((column: string): boolean => {
        return column.includes("headerTooltip:");
      })
      .map((column: string): [string, string] => {
        return titleAndKey(column, TITLE_PROPERTY, HEADER_TOOLTIP_PROPERTY);
      });

    expect(withTooltip).toEqual(expected);
  });

  test("name columns and the actions column get no tooltip", () => {
    expect(countOf(columns, "headerTooltip:")).toBe(expected.length);
  });

  test("header tooltips go through the shared Table, not a hand-drawn (i)", () => {
    expect(code).not.toContain("<InfoTooltip");
  });
});
