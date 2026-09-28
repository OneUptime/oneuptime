import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SPAN_STATUS_PRESENTATIONS,
  SpanStatusPresentation,
} from "../../FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";

/*
 * Issue #4118. OpenTelemetry leaves a span's status Unset (0) unless the code
 * marks it Ok (1) or Error (2), so on a healthy service nearly every span is
 * Unset. The Traces views painted Unset grey (#9ca3af) beside a green Ok, and
 * a healthy service read as "mostly unknown".
 *
 * The fix gave every view one source for a status's label, tooltip, color and
 * classes: Utils/SpanStatusPresentation. Before it, the views kept their own
 * status maps and helpers (SPAN_STATUS_COLOR, STATUS_COLORS, getStatusTheme,
 * getStatusColor, getStatusStyle, a "0": "Unset" table), and the grey was
 * copied from one to the next. A view that grows its own map again compiles,
 * renders and passes every presentation test while showing the old grey, so
 * what is pinned here is the wiring: each view imports the module, none keeps
 * a status map or a status color of its own, and the places where the wiring
 * has to be exact (the chart's server bucket keys, the Status facet, the row's
 * status dot, the span panel's message box, the help text) say so.
 *
 * As in TracesEntityNamesWiring, the App suite has no renderer, so sources are
 * read comment-stripped and whitespace-squashed.
 */

const PACKAGES_DIR: string = path.join(__dirname, "..", "..", "..");

const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const PRESENTATION_MODULE: string = path.join(
  DASHBOARD_SRC,
  "Utils",
  "SpanStatusPresentation.ts",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

type SquashFunction = (raw: string) => string;

const squash: SquashFunction = (raw: string): string => {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
};

type ReadSourceFunction = (...relativePath: Array<string>) => string;

// A file under packages/, comment-stripped and whitespace-squashed.
const readSource: ReadSourceFunction = (
  ...relativePath: Array<string>
): string => {
  return squash(
    fs.readFileSync(path.join(PACKAGES_DIR, ...relativePath), "utf8"),
  );
};

type CountFunction = (haystack: string, needle: string) => number;

const count: CountFunction = (haystack: string, needle: string): number => {
  return haystack.split(needle).length - 1;
};

type BlockAtFunction = (source: string, start: number) => string;

// From `start` through the brace that closes the first "{" after it.
const blockAt: BlockAtFunction = (source: string, start: number): string => {
  if (start < 0) {
    return "";
  }
  let depth: number = 0;
  for (
    let index: number = source.indexOf("{", start);
    index >= 0 && index < source.length;
    index++
  ) {
    const char: string = source.charAt(index);
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return source.substring(start, index + 1);
      }
    }
  }
  return "";
};

type CaptureAllFunction = (text: string, pattern: RegExp) => Array<string>;

// The first capture group of every match of a global pattern.
const captureAll: CaptureAllFunction = (
  text: string,
  pattern: RegExp,
): Array<string> => {
  const captured: Array<string> = [];
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    captured.push(match[1] as string);
    match = pattern.exec(text);
  }
  return captured;
};

interface SourceFile {
  name: string;
  filePath: string;
  source: string;
}

interface StatusConsumer extends SourceFile {
  // What the file takes from the presentation module.
  uses: Array<string>;
}

type ReadDashboardFileFunction = (relativePath: Array<string>) => SourceFile;

const readDashboardFile: ReadDashboardFileFunction = (
  relativePath: Array<string>,
): SourceFile => {
  const filePath: string = path.join(DASHBOARD_SRC, ...relativePath);
  return {
    name: path.basename(filePath),
    filePath,
    source: squash(fs.readFileSync(filePath, "utf8")),
  };
};

type ReadConsumerFunction = (
  relativePath: Array<string>,
  uses: Array<string>,
) => StatusConsumer;

const readConsumer: ReadConsumerFunction = (
  relativePath: Array<string>,
  uses: Array<string>,
): StatusConsumer => {
  return { ...readDashboardFile(relativePath), uses };
};

const TRACES_VIEWER: StatusConsumer = readConsumer(
  ["Components", "Traces", "TracesViewer.tsx"],
  [
    "SPAN_STATUS_PRESENTATIONS",
    "getSpanStatusColorMap",
    "getSpanStatusDisplayLabelMap",
    "getSpanStatusPresentation",
  ],
);

const TRACE_ROW: StatusConsumer = readConsumer(
  ["Components", "Traces", "TraceRow.tsx"],
  ["getSpanStatusPresentation"],
);

const SPAN_PANEL: StatusConsumer = readConsumer(
  ["Components", "Traces", "SpanDetailsPanel.tsx"],
  ["getSpanStatusPresentation"],
);

const SPAN_STATUS_ELEMENT: StatusConsumer = readConsumer(
  ["Components", "Span", "SpanStatusElement.tsx"],
  ["getSpanStatusPresentation"],
);

const TRACE_LIST_WIDGET: StatusConsumer = readConsumer(
  ["Components", "Dashboard", "Components", "DashboardTraceListComponent.tsx"],
  ["SPAN_STATUS_PRESENTATIONS", "getSpanStatusPresentation"],
);

const TRACE_CHART_DATA: StatusConsumer = readConsumer(
  ["Components", "Dashboard", "Components", "TraceChartData.ts"],
  ["getSpanStatusPresentation"],
);

const TRACE_TABLE_DATA: StatusConsumer = readConsumer(
  ["Components", "Dashboard", "Components", "TraceTableData.ts"],
  ["getSpanStatusDisplayLabelMap"],
);

const TRACE_FILTER_CONFIG: StatusConsumer = readConsumer(
  ["Components", "FilterQueryBuilder", "TraceFilterConfig.ts"],
  ["getSpanStatusPresentation"],
);

const CONSUMERS: Array<StatusConsumer> = [
  TRACES_VIEWER,
  TRACE_ROW,
  SPAN_PANEL,
  SPAN_STATUS_ELEMENT,
  TRACE_LIST_WIDGET,
  TRACE_CHART_DATA,
  TRACE_TABLE_DATA,
  TRACE_FILTER_CONFIG,
];

// Names and colors its series through TraceChartData's helpers.
const TRACE_CHART_WIDGET: SourceFile = readDashboardFile([
  "Components",
  "Dashboard",
  "Components",
  "DashboardTraceChartComponent.tsx",
]);

// Every file that shows a span status, for the sweeps.
const STATUS_VIEWS: Array<SourceFile> = [...CONSUMERS, TRACE_CHART_WIDGET];

/*
 * The only status-keyed map a view may keep: the name of the server's
 * histogram bucket for each status (TraceAggregationService).
 */
const HISTOGRAM_SERIES_KEY_DECLARATION: string =
  'const HISTOGRAM_SERIES_KEY: Record<SpanStatus, string> = { [SpanStatus.Ok]: "ok", [SpanStatus.Unset]: "unset", [SpanStatus.Error]: "error", };';

// The private maps and helpers the views kept before the shared module.
const RETIRED_STATUS_HELPERS: Array<string> = [
  "SPAN_STATUS_COLOR",
  "STATUS_COLORS",
  "getStatusTheme",
  "StatusTheme",
  "getStatusColor",
  "getStatusLabel",
  "getStatusStyle",
  "StatusStyle",
];

// A status mapped to a color or a name by hand.
const PRIVATE_STATUS_MAP_PATTERNS: Array<RegExp> = [
  // { [SpanStatus.Unset]: "#9ca3af" } or { [SpanStatus.Unset]: { color, label } }
  /\[SpanStatus\.(?:Unset|Ok|Error)\]\s*:/,
  // { "0": "Unset" }, { "0": "#9ca3af" } or { "0": { color, label } }
  /"[012]"\s*:\s*(?:"(?:#|Unset\b|Ok\b|Error\b)|\{)/,
  // { 0: "Unset" } or { 0: "#9ca3af" }
  /[{,]\s*[012]\s*:\s*"(?:#|Unset\b|Ok\b|Error\b)/,
];

const RETIRED_UNSET_GREY: string = "#9ca3af";

// The old grey Unset, and every color the module hands out.
const STATUS_HEXES: Array<string> = [
  RETIRED_UNSET_GREY,
  ...SPAN_STATUS_PRESENTATIONS.map(
    (presentation: SpanStatusPresentation): string => {
      return presentation.color.toLowerCase();
    },
  ),
];

type StripFunction = (source: string) => string;

// Hex colors that are not a status's, so the sweep can ban the rest.
const withoutNonStatusColors: StripFunction = (source: string): string => {
  return (
    source
      // A theme token's fallback, like the service dot's var(--ou-text-subtle, #9ca3af).
      .replace(/var\(--[\w-]+, ?#[0-9a-fA-F]{3,8}\)/g, "var()")
      // The chart widget's palette for splits other than status.
      .replace(
        /export const TRACE_CHART_PALETTE: Array<string> = \[[^\]]*\];/,
        " ",
      )
  );
};

interface PresentationImport {
  names: Array<string>;
  resolvedPath: string;
  // The source after the import statement.
  rest: string;
}

type FindPresentationImportFunction = (
  file: SourceFile,
) => PresentationImport | null;

const findPresentationImport: FindPresentationImportFunction = (
  file: SourceFile,
): PresentationImport | null => {
  const pattern: RegExp =
    /import \{([^}]*)\} from "((?:\.\.?\/)+Utils\/SpanStatusPresentation)";/;
  const match: RegExpExecArray | null = pattern.exec(file.source);
  if (!match) {
    return null;
  }
  return {
    names: (match[1] as string)
      .split(",")
      .map((name: string): string => {
        return name.trim();
      })
      .filter((name: string): boolean => {
        return name.length > 0;
      }),
    resolvedPath: path.resolve(
      path.dirname(file.filePath),
      `${match[2] as string}.ts`,
    ),
    rest: file.source.substring(match.index + match[0].length),
  };
};

describe("every status view takes its presentation from Utils/SpanStatusPresentation", () => {
  test.each(CONSUMERS)(
    "$name imports what it uses from the module",
    (consumer: StatusConsumer) => {
      const presentationImport: PresentationImport | null =
        findPresentationImport(consumer);

      expect(presentationImport).not.toBeNull();
      expect(presentationImport!.resolvedPath).toBe(PRESENTATION_MODULE);
      expect(presentationImport!.names).toEqual(
        expect.arrayContaining(consumer.uses),
      );
      // Used, not just imported.
      for (const name of consumer.uses) {
        expect({ name, used: presentationImport!.rest.includes(name) }).toEqual(
          { name, used: true },
        );
      }
    },
  );

  test("the sweeps below have something to check", () => {
    expect(STATUS_VIEWS).toHaveLength(9);
    // Four distinct colors: the module's three are none of them the old grey.
    expect(new Set<string>(STATUS_HEXES).size).toBe(4);
    // What the sweeps carve out is really there.
    expect(TRACES_VIEWER.source).toContain(HISTOGRAM_SERIES_KEY_DECLARATION);
    expect(TRACE_CHART_DATA.source).toContain(
      "export const TRACE_CHART_PALETTE: Array<string> = [",
    );
  });

  test("REGRESSION: no view keeps a private status map or helper", () => {
    const offenders: Array<string> = [];
    for (const file of STATUS_VIEWS) {
      for (const name of RETIRED_STATUS_HELPERS) {
        if (file.source.includes(name)) {
          offenders.push(`${file.name}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("REGRESSION: no view maps a status to a color or a name by hand", () => {
    const offenders: Array<string> = [];
    for (const file of STATUS_VIEWS) {
      const source: string = file.source
        .split(HISTOGRAM_SERIES_KEY_DECLARATION)
        .join(" ");
      for (const pattern of PRIVATE_STATUS_MAP_PATTERNS) {
        const match: RegExpMatchArray | null = source.match(pattern);
        if (match) {
          offenders.push(`${file.name}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("REGRESSION: no view hard-codes a status color, and the grey Unset is gone", () => {
    const offenders: Array<string> = [];
    for (const file of STATUS_VIEWS) {
      const source: string = withoutNonStatusColors(file.source).toLowerCase();
      for (const color of STATUS_HEXES) {
        if (source.includes(color)) {
          offenders.push(`${file.name}: ${color}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Traces explorer chart, legend and Status facet (TracesViewer)", () => {
  const seriesStart: number = TRACES_VIEWER.source.indexOf(
    "const histogramSeries: Array<HistogramSeriesOption> = useMemo(",
  );
  const seriesEnd: number = TRACES_VIEWER.source.indexOf(
    "}, [chartMetric]);",
    seriesStart,
  );
  const HISTOGRAM_SERIES: string = TRACES_VIEWER.source.substring(
    seriesStart,
    seriesEnd,
  );

  test("the histogram series block is found", () => {
    expect(seriesStart).toBeGreaterThan(-1);
    expect(seriesEnd).toBeGreaterThan(seriesStart);
  });

  test("REGRESSION: one series per status, named, colored and explained by the module", () => {
    expect(HISTOGRAM_SERIES).toContain(
      "return SPAN_STATUS_PRESENTATIONS.map( (presentation: SpanStatusPresentation): HistogramSeriesOption => { return { key: HISTOGRAM_SERIES_KEY[presentation.status], label: presentation.displayLabel, color: presentation.color, description: presentation.description, }; }, );",
    );
    // The old hand-written series: a grey "Unset" beside a green "Ok".
    expect(HISTOGRAM_SERIES).not.toContain('label: "Unset"');
    expect(HISTOGRAM_SERIES).not.toContain('key: "unset"');
  });

  test("series keys stay the server's histogram bucket names", () => {
    expect(TRACES_VIEWER.source).toContain(HISTOGRAM_SERIES_KEY_DECLARATION);
    expect(count(TRACES_VIEWER.source, "HISTOGRAM_SERIES_KEY[")).toBe(1);
  });

  test("REGRESSION: the Status facet takes its labels and dot colors from the module", () => {
    expect(TRACES_VIEWER.source).toContain(
      "const statusLabelMap: Record<string, string> = getSpanStatusDisplayLabelMap(); const statusColorMap: Record<string, string> = getSpanStatusColorMap();",
    );
    expect(TRACES_VIEWER.source).toContain(
      'key: "statusCode", title: "Status", valueDisplayMap: statusLabelMap, valueColorMap: statusColorMap,',
    );
  });

  test("Has Exception is painted with the Error color", () => {
    expect(TRACES_VIEWER.source).toContain(
      'valueDisplayMap: { true: "Has exception" }, valueColorMap: { true: getSpanStatusPresentation(SpanStatus.Error).color, },',
    );
  });

  test("the search help says what unset means; the search term is unchanged", () => {
    expect(TRACES_VIEWER.source).toContain(
      '{ syntax: "status:ok|error|unset", description: "Filter by span status (unset = no error recorded)", example: "status:error", },',
    );
  });
});

describe("the server contract the Traces chart depends on (TraceAggregationService)", () => {
  const AGGREGATION: string = readSource(
    "Common",
    "Server",
    "Services",
    "TraceAggregationService.ts",
  );
  const MAPPER: string = blockAt(
    AGGREGATION,
    AGGREGATION.indexOf("private static mapStatusCodeToSeries("),
  );

  test("1 is bucketed as ok, 2 as error, anything else as unset", () => {
    expect(MAPPER).toBe(
      'private static mapStatusCodeToSeries(code: number): string { if (code === 1) { return "ok"; } if (code === 2) { return "error"; } return "unset"; }',
    );
  });

  test("every histogram row goes through it, a missing status counting as Unset", () => {
    expect(AGGREGATION).toContain(
      'series: TraceAggregationService.mapStatusCodeToSeries( Number(row["statusCode"] || 0), ),',
    );
  });

  test("the chart's series keys are exactly the server's bucket names", () => {
    const serverBuckets: Array<string> = captureAll(
      MAPPER,
      /return "(\w+)";/g,
    ).sort();
    const viewerKeys: Array<string> = captureAll(
      blockAt(
        TRACES_VIEWER.source,
        TRACES_VIEWER.source.indexOf("const HISTOGRAM_SERIES_KEY:"),
      ),
      /\]: "(\w+)"/g,
    ).sort();

    expect(serverBuckets).toEqual(["error", "ok", "unset"]);
    expect(viewerKeys).toEqual(serverBuckets);
  });
});

describe("trace rows (TraceRow)", () => {
  test("REGRESSION: the status dot is announced as an image, with its label and meaning", () => {
    expect(TRACE_ROW.source).toContain(
      '<span role="img" aria-label={`Status: ${status.displayLabel}`} title={`${status.label}: ${status.description}`}',
    );
    // The old dot: a plain span, its aria-label never read, naming "Unset".
    expect(TRACE_ROW.source).not.toContain(
      "aria-label={`Status: ${theme.label}`}",
    );
  });

  test("the dot, its ring and the duration bar take the status's classes", () => {
    expect(TRACE_ROW.source).toContain(
      "rounded-full ${status.dotClassName} opacity-60",
    );
    expect(TRACE_ROW.source).toContain(
      "rounded-full ${status.dotClassName} ring-2 ${status.ringClassName}`}",
    );
    expect(TRACE_ROW.source).toContain(
      "overflow-hidden rounded-full ${status.barTrackClassName}`}",
    );
    expect(TRACE_ROW.source).toContain(
      "rounded-full ${status.barClassName} transition-all",
    );
  });

  test("the text pill is still for errors only", () => {
    // Same lookup as the dot, so the pill, pulse and message agree with it.
    expect(TRACE_ROW.source).toContain(
      "const isError: boolean = status.status === SpanStatus.Error;",
    );
    expect(TRACE_ROW.source).toContain(
      "{isError && ( <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${status.pillClassName}`} > {status.label} </span> )}",
    );
  });
});

describe("the span panel (SpanDetailsPanel)", () => {
  test("the header pill takes its classes, tooltip, dot color and text from the status", () => {
    expect(SPAN_PANEL.source).toContain(
      '<span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.pillClassName}`} title={status.description} data-testid="span-details-status" > <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} aria-hidden="true" /> {status.displayLabel} </span>',
    );
  });

  test("the overview names the status with its display label", () => {
    expect(SPAN_PANEL.source).toContain(
      '{ label: "Status", value: status.displayLabel },',
    );
  });

  test("REGRESSION: the status message box is red only on an Error span", () => {
    const boxStart: number = SPAN_PANEL.source.indexOf(
      "<header className={sectionHeaderClass}>Status Message</header>",
    );
    const boxEnd: number = SPAN_PANEL.source.indexOf(
      "{statusMessage} </div>",
      boxStart,
    );
    const BOX: string = SPAN_PANEL.source.substring(boxStart, boxEnd);

    expect(boxStart).toBeGreaterThan(-1);
    expect(boxEnd).toBeGreaterThan(boxStart);
    expect(SPAN_PANEL.source).toContain(
      "const isError: boolean = status.status === SpanStatus.Error;",
    );
    expect(BOX).toContain('data-testid="span-details-status-message"');
    expect(BOX).toContain(
      'isError ? "border-red-100 bg-red-50 text-red-700" : "border-gray-200 bg-gray-50 text-gray-700"',
    );

    // Every red class sits in the Error branch.
    const errorBranch: number = BOX.indexOf("isError ?");
    const otherBranch: number = BOX.indexOf(" : ", errorBranch);
    expect(count(BOX, "red-")).toBe(3);
    expect(BOX.indexOf("red-")).toBeGreaterThan(errorBranch);
    expect(BOX.lastIndexOf("red-")).toBeLessThan(otherBranch);

    // The old box was red whatever the status.
    expect(SPAN_PANEL.source).not.toContain(
      '<div className="rounded-lg border border-red-100 bg-red-50 p-4 font-mono text-[13px] leading-6 text-red-700">',
    );
  });
});

describe("the status dot in span tables (SpanStatusElement)", () => {
  test("REGRESSION: the dot's tooltip says Unset means no error; only a missing status has no dot", () => {
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "const hasStatus: boolean = spanStatusCode !== null && spanStatusCode !== undefined;",
    );
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "const status: SpanStatusPresentation = getSpanStatusPresentation(spanStatusCode);",
    );
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "{hasStatus ? ( <ColorCircle color={new Color(status.color)} tooltip={`Span Status: ${status.displayLabel}`} /> ) : ( <></> )}",
    );
    expect(count(SPAN_STATUS_ELEMENT.source, "<ColorCircle")).toBe(1);
  });

  test("its color and tooltip come from the module, not BrandColors or literals", () => {
    expect(SPAN_STATUS_ELEMENT.source).not.toContain(
      'from "Common/Types/BrandColors"',
    );
    expect(SPAN_STATUS_ELEMENT.source).not.toMatch(/color=\{(?:Green|Red)\}/);
    expect(SPAN_STATUS_ELEMENT.source).not.toContain('tooltip="Span Status:');
  });
});

describe("the dashboard trace list widget (DashboardTraceListComponent)", () => {
  test("REGRESSION: the honeycomb legend lists every status with its display label and color", () => {
    expect(TRACE_LIST_WIDGET.source).toContain(
      "const HONEYCOMB_LEGEND: Array<HoneycombLegendItem> = SPAN_STATUS_PRESENTATIONS.map( (status: SpanStatusPresentation): HoneycombLegendItem => { return { label: status.displayLabel, color: status.color }; }, );",
    );
  });

  test("tiles and rows resolve the stored status through the module", () => {
    expect(
      count(
        TRACE_LIST_WIDGET.source,
        "const status: SpanStatusPresentation = getSpanStatusPresentation( span.statusCode, );",
      ),
    ).toBe(2);
    expect(TRACE_LIST_WIDGET.source).toContain(
      "status: status.displayLabel, color: status.color,",
    );
    // The old lookup coerced a missing status to Unset by hand.
    expect(TRACE_LIST_WIDGET.source).not.toContain("|| SpanStatus.Unset");
  });

  test("the list pill names the status and explains it, bordered red only for errors", () => {
    expect(TRACE_LIST_WIDGET.source).toContain(
      '${status.pillClassName} ${ status.status === SpanStatus.Error ? "border-red-100" : "border-emerald-100" }`} style={{ fontSize: "10px" }} title={status.description} > {status.label} </span>',
    );
  });
});

describe("the dashboard trace chart and table widgets", () => {
  const colorStart: number = TRACE_CHART_DATA.source.indexOf(
    "export function resolveTraceSeriesColor(",
  );
  const colorEnd: number = TRACE_CHART_DATA.source.indexOf(
    "export function formatTraceSeriesLabel(",
    colorStart,
  );
  const RESOLVE_COLOR: string = TRACE_CHART_DATA.source.substring(
    colorStart,
    colorEnd,
  );

  test("the color resolver is found", () => {
    expect(colorStart).toBeGreaterThan(-1);
    expect(colorEnd).toBeGreaterThan(colorStart);
  });

  test("REGRESSION: a status split keeps each status's color, after a pin and before the palette", () => {
    const pin: number = RESOLVE_COLOR.indexOf("if (pinned) { return pinned; }");
    const statusColor: number = RESOLVE_COLOR.indexOf(
      "if (isStatusSeries(seriesKey, groupBy)) { return getSpanStatusPresentation(seriesKey).color; }",
    );
    const palette: number = RESOLVE_COLOR.indexOf(
      "return palette[index % palette.length]!;",
    );

    expect(pin).toBeGreaterThan(-1);
    expect(statusColor).toBeGreaterThan(pin);
    expect(palette).toBeGreaterThan(statusColor);
  });

  test("a status split is the statusCode attribute with a stored status value", () => {
    expect(TRACE_CHART_DATA.source).toContain(
      'const STATUS_SPLIT_ATTRIBUTE: string = "statusCode";',
    );
    expect(TRACE_CHART_DATA.source).toContain(
      'const STATUS_SERIES_KEYS: ReadonlySet<string> = new Set<string>([ "0", "1", "2", ]);',
    );
    expect(TRACE_CHART_DATA.source).toContain(
      "groupByAttribute?.trim() === STATUS_SPLIT_ATTRIBUTE && STATUS_SERIES_KEYS.has(seriesKey)",
    );
  });

  test("REGRESSION: the chart widget names its series and legend through formatTraceSeriesLabel", () => {
    expect(TRACE_CHART_DATA.source).toContain(
      "export function formatTraceSeriesLabel( seriesKey: string, groupByAttribute: string | undefined, ): string { if (isStatusSeries(seriesKey, groupByAttribute)) { return getSpanStatusPresentation(seriesKey).displayLabel; } return seriesKey; }",
    );
    expect(TRACE_CHART_WIDGET.source).toContain(
      "return formatTraceSeriesLabel(seriesKey, groupByAttribute);",
    );
    // The recharts series name is what the tooltip shows.
    expect(TRACE_CHART_WIDGET.source).toContain(
      "<Line key={key} dataKey={key} name={labelForSeries(key)}",
    );
    expect(TRACE_CHART_WIDGET.source).toContain(
      "<Bar key={key} dataKey={key} name={labelForSeries(key)}",
    );
    expect(TRACE_CHART_WIDGET.source).toContain(
      '<span className="max-w-[180px] truncate text-[10px] text-gray-500"> {labelForSeries(key)} </span>',
    );
    // The old legend printed the raw key: "0", "1", "2".
    expect(TRACE_CHART_WIDGET.source).not.toContain("> {key} </span>");
  });

  test("the table widget names a status split with the module's display labels", () => {
    expect(TRACE_TABLE_DATA.source).toContain(
      "const STATUS_LABELS: Record<string, string> = getSpanStatusDisplayLabelMap();",
    );
    expect(TRACE_TABLE_DATA.source).toContain(
      'if (key === "statusCode") { return STATUS_LABELS[raw] || raw; }',
    );
  });
});

describe("the filter builder (TraceFilterConfig)", () => {
  test("REGRESSION: status pills come from the module; grey is only for a value that is not a status", () => {
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'export function getStatusCodePillClass(value: string): string { if (value !== "0" && value !== "1" && value !== "2") { return "bg-gray-50 text-gray-600 ring-gray-500/10"; } const status: SpanStatusPresentation = getSpanStatusPresentation(value); if (status.status === SpanStatus.Error) { return `${status.pillClassName} ring-red-600/10`; } return `${status.pillClassName} ring-emerald-600/10`; }',
    );
    // The old pill: Unset ("0") grey, Ok a green of its own.
    expect(TRACE_FILTER_CONFIG.source).not.toContain('if (value === "0") {');
    expect(TRACE_FILTER_CONFIG.source).not.toContain(
      "bg-green-50 text-green-700",
    );
  });

  test("filter values and names are unchanged; the descriptions say what each status means", () => {
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'key: "statusCode", label: "Status", description: "OpenTelemetry span status", valueType: "dropdown", valuePlaceholder: "Select status...", valueOptions: [ { value: "0", label: "Unset", description: "No error recorded (OpenTelemetry default)", }, { value: "1", label: "Ok", description: "Explicitly marked successful", }, { value: "2", label: "Error", description: "Span ended in error" }, ], getValuePillClass: getStatusCodePillClass,',
    );
    expect(TRACE_FILTER_CONFIG.source).not.toContain('"No status set"');
    expect(TRACE_FILTER_CONFIG.source).not.toContain(
      '"Span completed successfully"',
    );
  });
});

describe("the histogram legend explains a series on hover (Common TelemetryViewer)", () => {
  test("a histogram series can carry a description", () => {
    expect(
      readSource("Common", "UI", "Components", "TelemetryViewer", "types.ts"),
    ).toContain(
      "export interface HistogramSeriesOption { key: string; label: string; color: string; description?: string | undefined; }",
    );
  });

  test("each legend entry shows it as its title", () => {
    expect(
      readSource(
        "Common",
        "UI",
        "Components",
        "TelemetryViewer",
        "components",
        "TelemetryHistogram.tsx",
      ),
    ).toContain(
      '<div key={option.key} className="flex items-center gap-1.5" title={option.description} >',
    );
  });
});

type ReadSettingsHelpFunction = (fileName: string) => string;

// The markdown a Traces settings page shows above its table.
const readSettingsHelp: ReadSettingsHelpFunction = (
  fileName: string,
): string => {
  const raw: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Pages", "Traces", "Settings", fileName),
    "utf8",
  );
  const opening: string = "const documentationMarkdown: string = `";
  const start: number = raw.indexOf(opening);
  const end: number = raw.indexOf("\n`;", start);
  if (start === -1 || end === -1) {
    return "";
  }
  // It sits in a template literal, so its code spans are escaped.
  return raw.substring(start + opening.length, end).replace(/\\`/g, "`");
};

describe("help on the Traces settings pages", () => {
  const DROP_FILTERS_HELP: string = readSettingsHelp("DropFilters.tsx");
  const PIPELINES_HELP: string = readSettingsHelp("Pipelines.tsx");

  test("both help texts are found", () => {
    expect(DROP_FILTERS_HELP).toContain("### How Trace Drop Filters Work");
    expect(PIPELINES_HELP).toContain("### How Trace Pipelines Work");
  });

  test("REGRESSION: Drop Filters matches successful spans with statusCode != 2, not statusCode = 1", () => {
    const examples: Array<string> = DROP_FILTERS_HELP.split("\n").filter(
      (line: string): boolean => {
        return line.startsWith("- **");
      },
    );

    expect(examples).toContain(
      "- **Sample successful CRUD:** `kind = 'SPAN_KIND_CLIENT' AND statusCode != 2` (action: Sample, 10%)",
    );
    for (const example of examples) {
      expect(example).not.toContain("statusCode = 1");
    }
    // The one mention left is the advice against it.
    expect(count(DROP_FILTERS_HELP, "statusCode = 1")).toBe(1);
    expect(DROP_FILTERS_HELP).toContain(
      'so match "not an error" with `statusCode != 2` rather than `statusCode = 1`.',
    );
    expect(DROP_FILTERS_HELP).toContain(
      "Status codes: `0` Unset, `1` Ok, `2` Error.",
    );
  });

  test("Pipelines shows how to mark successful HTTP spans as Ok", () => {
    const exampleStart: number = PIPELINES_HELP.indexOf(
      "### Example: mark successful HTTP spans as Ok",
    );
    const example: string = PIPELINES_HELP.substring(exampleStart);
    const filterStep: number = example.indexOf(
      "1. Create a pipeline with the filter condition **Status = Unset** (`statusCode = '0'`)",
    );
    const remapStep: number = example.indexOf(
      "2. Add a **Status Remapper** processor with the source key `http.response.status_code`",
    );

    expect(exampleStart).toBeGreaterThan(-1);
    expect(filterStep).toBeGreaterThan(-1);
    // Filtering on Unset first, so a span already marked Error is never remapped.
    expect(remapStep).toBeGreaterThan(filterStep);
    expect(example).toContain("`200` → Ok");
  });

  test("the example names the filter and processor the way the pipeline pages show them", () => {
    // The pipeline filter is edited with the trace filter builder.
    expect(
      readSource(
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "Traces",
        "Settings",
        "PipelineView.tsx",
      ),
    ).toContain("config={TraceFilterConfig}");
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'key: "statusCode", label: "Status",',
    );
    expect(TRACE_FILTER_CONFIG.source).toContain(
      '{ value: "0", label: "Unset",',
    );
    expect(
      readSource(
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "TracePipeline",
        "TraceProcessorForm.tsx",
      ),
    ).toContain(
      'value: TracePipelineProcessorType.StatusRemapper, label: "Status Remapper",',
    );
  });
});

type ReadLocaleRawFunction = (file: string) => string;

const readLocaleRaw: ReadLocaleRawFunction = (file: string): string => {
  return fs.readFileSync(path.join(LOCALES_DIR, file), "utf8");
};

type ReadLocaleFunction = (file: string) => Record<string, unknown>;

const readLocale: ReadLocaleFunction = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(readLocaleRaw(file)) as Record<string, unknown>;
};

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

// The filter option descriptions and the dot's Unset tooltip, as reworded.
const REWORDED_STRINGS: Array<string> = [
  "No error recorded (OpenTelemetry default)",
  "Explicitly marked successful",
  "Span Status: Unset (no error)",
];

// What they replaced.
const RETIRED_STRINGS: Array<string> = [
  "No status set",
  "Span completed successfully",
  "Span Status: Unset",
];

// What SpanStatusElement's tooltip reads, for each status.
const STATUS_TOOLTIPS: Array<string> = SPAN_STATUS_PRESENTATIONS.map(
  (presentation: SpanStatusPresentation): string => {
    return `Span Status: ${presentation.displayLabel}`;
  },
);

const LOCALE_STRINGS: Array<string> = Array.from(
  new Set<string>([...REWORDED_STRINGS, ...STATUS_TOOLTIPS]),
);

describe("the reworded status strings in every Dashboard locale", () => {
  test("the locale files are found", () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(17);
    expect(localeFiles).toContain("en.json");
  });

  test("the views still render exactly these strings", () => {
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'description: "No error recorded (OpenTelemetry default)",',
    );
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'description: "Explicitly marked successful",',
    );
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "tooltip={`Span Status: ${status.displayLabel}`}",
    );
    // The module's display label is what the Unset tooltip key spells.
    expect(STATUS_TOOLTIPS).toContain("Span Status: Unset (no error)");
    expect(STATUS_TOOLTIPS).toHaveLength(3);
  });

  test("English maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");
    for (const text of LOCALE_STRINGS) {
      expect({ text, value: english[text] }).toEqual({ text, value: text });
    }
  });

  test.each(localeFiles)(
    "%s carries every string exactly once, translated",
    (file: string) => {
      const raw: string = readLocaleRaw(file);
      const locale: Record<string, unknown> = readLocale(file);

      for (const text of LOCALE_STRINGS) {
        const value: unknown = locale[text];
        expect({ text, type: typeof value }).toEqual({ text, type: "string" });
        expect((value as string).trim().length).toBeGreaterThan(0);
        expect({
          text,
          occurrences: count(raw, `\n  ${JSON.stringify(text)}: `),
        }).toEqual({ text, occurrences: 1 });
      }

      if (file !== "en.json") {
        for (const text of REWORDED_STRINGS) {
          expect({ text, value: locale[text] }).not.toEqual({
            text,
            value: text,
          });
        }
      }
    },
  );

  test.each(localeFiles)(
    "REGRESSION: %s no longer carries the retired strings",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      for (const text of RETIRED_STRINGS) {
        expect({
          text,
          present: Object.prototype.hasOwnProperty.call(locale, text),
        }).toEqual({ text, present: false });
      }
    },
  );

  test.each(localeFiles)("%s keeps the OpenTelemetry name", (file: string) => {
    expect(
      String(readLocale(file)["No error recorded (OpenTelemetry default)"]),
    ).toContain("OpenTelemetry");
  });
});
