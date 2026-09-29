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
 * A review follow-up made Ok cyan, so every pair of statuses stays apart for
 * colorblind users (a darker green Ok collapsed into Error's red under
 * protanopia), and worded Unset by its status field: recording an exception
 * does not change a span's status, so where a span carries exceptions (the
 * span panel, the exception tables) Unset is named plainly, without
 * "(no error)". Pills take their border and ring from the module too, and the
 * trace chart widget's editor explains a status split's colors.
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

// Traces > Analytics: the split-by labels and a status series' color.
const TRACES_ENTITY_DISPLAY: StatusConsumer = readConsumer(
  ["Components", "Traces", "TracesEntityDisplay.ts"],
  ["getSpanStatusDisplayLabelMap", "getSpanStatusPresentation"],
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
  TRACES_ENTITY_DISPLAY,
];

// Names and colors its series through TraceChartData's helpers.
const TRACE_CHART_WIDGET: SourceFile = readDashboardFile([
  "Components",
  "Dashboard",
  "Components",
  "DashboardTraceChartComponent.tsx",
]);

// Colors its series through TracesEntityDisplay's getTraceAnalyticsStatusColor.
const TRACES_ANALYTICS_VIEW: SourceFile = readDashboardFile([
  "Components",
  "Traces",
  "TracesAnalyticsView.tsx",
]);

// Every file that shows a span status, for the sweeps.
const STATUS_VIEWS: Array<SourceFile> = [
  ...CONSUMERS,
  TRACE_CHART_WIDGET,
  TRACES_ANALYTICS_VIEW,
];

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

// The darker green Ok, which protanopes could not tell from Error's red.
const RETIRED_OK_GREEN: string = "#047857";

// The old grey Unset and green Ok, and every color the module hands out.
const STATUS_HEXES: Array<string> = [
  RETIRED_UNSET_GREY,
  RETIRED_OK_GREEN,
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
      // Traces > Analytics' palette, for splits other than status alone.
      .replace(/const CHART_COLORS: Array<string> = \[[^\]]*\];/, " ")
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
    expect(STATUS_VIEWS).toHaveLength(11);
    /*
     * Five distinct colors: the module's three are none of them the old grey
     * Unset or the old green Ok.
     */
    expect(new Set<string>(STATUS_HEXES).size).toBe(5);
    // What the sweeps carve out is really there.
    expect(TRACES_VIEWER.source).toContain(HISTOGRAM_SERIES_KEY_DECLARATION);
    expect(TRACE_CHART_DATA.source).toContain(
      "export const TRACE_CHART_PALETTE: Array<string> = [",
    );
    expect(TRACES_ANALYTICS_VIEW.source).toContain(
      "const CHART_COLORS: Array<string> = [",
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

  test("REGRESSION: no view hard-codes a status color, and the grey Unset and green Ok are gone", () => {
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
      '{ syntax: "status:ok|error|unset", description: "Filter by span status (unset = no error status set)", example: "status:error", },',
    );
    // It is about the status field: an Unset span can still record exceptions.
    expect(TRACES_VIEWER.source).not.toContain("unset = no error recorded");
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
      '<span role="img" aria-label={`Status: ${statusName}`} title={`${status.label}: ${status.description}`}',
    );
    // The old dot: a plain span, its aria-label never read, naming "Unset".
    expect(TRACE_ROW.source).not.toContain(
      "aria-label={`Status: ${theme.label}`}",
    );
  });

  test("REGRESSION: a span with exceptions is announced by its plain status name", () => {
    // The list query brings hasException along, so the row knows.
    expect(TRACE_ROW.source).toContain(
      "const statusName: string = span.hasException === true ? status.label : status.displayLabel;",
    );
    expect(TRACES_VIEWER.source).toContain(
      "statusCode: true, statusMessage: true, kind: true, hasException: true, } as Select<Span>;",
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
      '<span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.pillClassName}`} title={status.description} data-testid="span-details-status" > <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} aria-hidden="true" /> {statusLabel} </span>',
    );
  });

  test("the overview names the status with the pill's label", () => {
    expect(SPAN_PANEL.source).toContain(
      '{ label: "Status", value: statusLabel },',
    );
  });

  /*
   * Recording an exception does not change a span's status, so an Unset span
   * can list exceptions below a pill that said "Unset (no error)".
   */
  test("REGRESSION: a span with exceptions names its status plainly, without '(no error)'", () => {
    /*
     * The list row's hasException answers before the full span loads (and
     * if that fetch fails); the fetched exception events confirm it.
     */
    expect(SPAN_PANEL.source).toContain(
      "const hasExceptions: boolean = span.hasException === true || exceptionMessages.length > 0; const statusLabel: string = hasExceptions ? status.label : status.displayLabel;",
    );
    // The exceptions are the fetched span's exception events, listed below.
    expect(SPAN_PANEL.source).toContain(
      "const exceptionMessages: Array<string> = useMemo(() => { const events: Array<SpanEvent> | undefined = fullSpan?.events;",
    );
    // The pill and the overview both read statusLabel; nothing bypasses it.
    expect(count(SPAN_PANEL.source, "{statusLabel}")).toBe(1);
    expect(count(SPAN_PANEL.source, "value: statusLabel")).toBe(1);
    expect(count(SPAN_PANEL.source, "status.displayLabel")).toBe(1);
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
  // Tables whose rows are exceptions, each showing its span's status dot.
  const EXCEPTION_INSTANCE_TABLE: SourceFile = readDashboardFile([
    "Components",
    "Exceptions",
    "ExceptionInstanceTable.tsx",
  ]);
  const OCCURRENCE_TABLE: SourceFile = readDashboardFile([
    "Components",
    "Exceptions",
    "OccuranceTable.tsx",
  ]);

  test("REGRESSION: the dot's tooltip says Unset means no error; only a missing status has no dot", () => {
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "spanStatusCode: SpanStatus | null | undefined;",
    );
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "const hasStatus: boolean = spanStatusCode !== null && spanStatusCode !== undefined;",
    );
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "const status: SpanStatusPresentation = getSpanStatusPresentation(spanStatusCode);",
    );
    // The display label, "Unset (no error)", unless the row asks for plainLabel.
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "{hasStatus ? ( <ColorCircle color={new Color(status.color)} tooltip={`Span Status: ${ props.plainLabel ? status.label : status.displayLabel }`} /> ) : ( <></> )}",
    );
    expect(count(SPAN_STATUS_ELEMENT.source, "<ColorCircle")).toBe(1);
  });

  test("plainLabel is an optional prop, read only by the tooltip", () => {
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "plainLabel?: boolean | undefined;",
    );
    expect(count(SPAN_STATUS_ELEMENT.source, "plainLabel")).toBe(2);
  });

  test("its color and tooltip come from the module, not BrandColors or literals", () => {
    expect(SPAN_STATUS_ELEMENT.source).not.toContain(
      'from "Common/Types/BrandColors"',
    );
    expect(SPAN_STATUS_ELEMENT.source).not.toMatch(/color=\{(?:Green|Red)\}/);
    expect(SPAN_STATUS_ELEMENT.source).not.toContain('tooltip="Span Status:');
  });

  /*
   * A row that is itself an exception: "Span Status: Unset (no error)" beside
   * it would contradict the row, since recording an exception does not change
   * the span's status.
   */
  test("REGRESSION: the exception tables name the span's status alone", () => {
    expect(EXCEPTION_INSTANCE_TABLE.source).toContain(
      "if (!exceptionInstance.spanId) { return <Fragment />; } return ( <SpanStatusElement traceId={exceptionInstance.traceId?.toString()} spanStatusCode={exceptionInstance.spanStatusCode || 0} title={exceptionInstance.spanId?.toString()} plainLabel={true} /> );",
    );
    expect(OCCURRENCE_TABLE.source).toContain(
      'titleClassName="font-mono text-[13px] text-gray-900" plainLabel={true} />',
    );
    // One dot per table, and it is the plain one.
    for (const table of [EXCEPTION_INSTANCE_TABLE, OCCURRENCE_TABLE]) {
      expect({
        name: table.name,
        dots: count(table.source, "<SpanStatusElement"),
        plain: count(table.source, "plainLabel={true}"),
      }).toEqual({ name: table.name, dots: 1, plain: 1 });
    }
  });

  test("REGRESSION: an occurrence with no span behind it draws no status dot", () => {
    // A log-derived exception has no span, only a placeholder Unset status.
    expect(OCCURRENCE_TABLE.source).toContain(
      "<SpanStatusElement traceId={exceptionInstance.traceId?.toString()} spanStatusCode={ exceptionInstance.spanId ? exceptionInstance.spanStatusCode : undefined } title={ exceptionInstance.spanName || exceptionInstance.spanId?.toString() }",
    );
    expect(OCCURRENCE_TABLE.source).not.toContain(
      "spanStatusCode={exceptionInstance.spanStatusCode!}",
    );
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
      'className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${status.pillClassName} ${status.pillBorderClassName}`} style={{ fontSize: "10px" }} title={status.description} > {status.label} </span>',
    );
    // The border comes with the status, and the one red border is Error's.
    expect(
      SPAN_STATUS_PRESENTATIONS.filter(
        (presentation: SpanStatusPresentation): boolean => {
          return presentation.pillBorderClassName.includes("red");
        },
      ).map((presentation: SpanStatusPresentation): string => {
        return presentation.label;
      }),
    ).toEqual(["Error"]);
    // The old border was picked by hand: red for Error, emerald for the rest.
    expect(TRACE_LIST_WIDGET.source).not.toContain("SpanStatus.Error");
    expect(TRACE_LIST_WIDGET.source).not.toContain('"border-red-100"');
    expect(TRACE_LIST_WIDGET.source).not.toContain('"border-emerald-100"');
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

describe("the trace chart widget's editor (TraceChartQueryEditor)", () => {
  const TRACE_CHART_EDITOR: SourceFile = readDashboardFile([
    "Components",
    "Dashboard",
    "Canvas",
    "TraceChartQueryEditor.tsx",
  ]);
  const noteStart: number = TRACE_CHART_EDITOR.source.indexOf(
    'data-testid="trace-chart-status-split-colors"',
  );
  const noteEnd: number = TRACE_CHART_EDITOR.source.indexOf("</p>", noteStart);
  const NOTE: string = TRACE_CHART_EDITOR.source.substring(noteStart, noteEnd);

  test("the status-split note is found", () => {
    expect(noteStart).toBeGreaterThan(-1);
    expect(noteEnd).toBeGreaterThan(noteStart);
  });

  test("a status split is the trimmed statusCode split, as the chart reads it", () => {
    expect(TRACE_CHART_EDITOR.source).toContain(
      'const currentGroupBy: string = (args.groupByAttribute || "").trim(); const isStatusSplit: boolean = currentGroupBy === "statusCode";',
    );
    expect(TRACE_CHART_EDITOR.source).toContain(
      '{ label: "Status Code", value: "statusCode" },',
    );
    // The attribute TraceChartData's isStatusSeries compares a trimmed split to.
    expect(TRACE_CHART_DATA.source).toContain(
      'const STATUS_SPLIT_ATTRIBUTE: string = "statusCode";',
    );
  });

  /*
   * resolveTraceSeriesColor gives a status series its status's color before it
   * looks at the lead color, so on a status split the "Default series color"
   * control changed nothing.
   */
  test("REGRESSION: a status split explains its colors instead of offering a lead color it ignores", () => {
    expect(TRACE_CHART_EDITOR.source).toContain(
      '{isStatusSplit ? ( <p className="text-xs text-gray-500" data-testid="trace-chart-status-split-colors" > A split by status keeps each status&apos;s own color: Unset green, Ok cyan, Error red. To change one, pin its stored value below: 0 for Unset, 1 for Ok, 2 for Error. </p> ) : ( <SeriesColorSelector ',
    );
    expect(count(TRACE_CHART_EDITOR.source, "<SeriesColorSelector")).toBe(1);
  });

  test("any other split, or none, keeps the lead color control", () => {
    expect(TRACE_CHART_EDITOR.source).toContain(
      ') : ( <SeriesColorSelector label={ currentGroupBy ? "Default series color" : "Series color" } description={ currentGroupBy ? "Colors the first unpinned series; the rest use the theme palette." : "Pick a color for the series, or leave on Auto to use the theme palette." } value={args.color} onChange={(color: string | undefined): void => { writeArgs({ color }); }} /> )}',
    );
  });

  test("the note names each status's color and stored value as the module has them", () => {
    // In stored-value order, as the note lists them: Unset, Ok, Error.
    const byStoredValue: Array<SpanStatusPresentation> = [
      ...SPAN_STATUS_PRESENTATIONS,
    ].sort((a: SpanStatusPresentation, b: SpanStatusPresentation): number => {
      return a.status - b.status;
    });
    // The plain word for the Tailwind family each status's dot is drawn in.
    const colorWords: Record<string, string> = {
      emerald: "green",
      cyan: "cyan",
      red: "red",
    };
    const colors: string = byStoredValue
      .map((presentation: SpanStatusPresentation): string => {
        const family: string = presentation.dotClassName.replace(
          /^bg-([a-z]+)-\d+$/,
          "$1",
        );
        return `${presentation.label} ${colorWords[family] || family}`;
      })
      .join(", ");
    const storedValues: string = byStoredValue
      .map((presentation: SpanStatusPresentation): string => {
        return `${presentation.status} for ${presentation.label}`;
      })
      .join(", ");

    expect(colors).toBe("Unset green, Ok cyan, Error red");
    expect(storedValues).toBe("0 for Unset, 1 for Ok, 2 for Error");
    expect(NOTE).toContain(`own color: ${colors}.`);
    expect(NOTE).toContain(`below: ${storedValues}.`);
  });

  test("pins on a status split are suggested by stored value, the keys the chart reads", () => {
    expect(TRACE_CHART_EDITOR.source).toContain(
      'const pinValueSuggestions: Record<string, Array<string>> = isStatusSplit ? { ...valueSuggestions, statusCode: ["0", "1", "2"] } : valueSuggestions;',
    );
    expect(TRACE_CHART_EDITOR.source).toContain(
      "<SeriesGroupColorSelector groupByKeys={[currentGroupBy]} valueSuggestions={pinValueSuggestions}",
    );
    // The span filter keeps the attribute values it loaded.
    expect(
      count(TRACE_CHART_EDITOR.source, "valueSuggestions={valueSuggestions}"),
    ).toBe(1);
    // The values TraceChartData treats as a status series.
    expect(TRACE_CHART_DATA.source).toContain(
      'const STATUS_SERIES_KEYS: ReadonlySet<string> = new Set<string>([ "0", "1", "2", ]);',
    );
  });
});

describe("Traces Analytics split by status (TracesEntityDisplay, TracesAnalyticsView)", () => {
  const STATUS_COLOR_FUNCTION: string = blockAt(
    TRACES_ENTITY_DISPLAY.source,
    TRACES_ENTITY_DISPLAY.source.indexOf(
      "export function getTraceAnalyticsStatusColor(",
    ),
  );
  const COLOR_FOR_SERIES: string = blockAt(
    TRACES_ANALYTICS_VIEW.source,
    TRACES_ANALYTICS_VIEW.source.indexOf("const colorForSeries:"),
  );
  // A top-list row takes the status of the one dimension the list ranks by.
  const TOP_LIST_COLORS: string =
    'const statusColor: string | undefined = getTraceAnalyticsStatusColor({ [groupByFields[0] || ""]: item.value, }); const color: string = statusColor || CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0]!; const mutedColor: string = statusColor ? `${statusColor}26` : CHART_COLORS_MUTED[index % CHART_COLORS_MUTED.length] || CHART_COLORS_MUTED[0]!;';

  test("the status color helper and the view's series color are found", () => {
    expect(STATUS_COLOR_FUNCTION.length).toBeGreaterThan(0);
    expect(COLOR_FOR_SERIES.length).toBeGreaterThan(0);
  });

  test("REGRESSION: the split-by labels are the module's display labels, not a status map of its own", () => {
    expect(TRACES_ENTITY_DISPLAY.source).toContain(
      "export const TRACE_ANALYTICS_STATUS_LABEL: Record<string, string> = getSpanStatusDisplayLabelMap();",
    );
    // The old map named the default status a bare "Unset".
    expect(TRACES_ENTITY_DISPLAY.source).not.toContain('"0": "Unset"');
  });

  test("a series takes the module's color only when the split is by status alone", () => {
    expect(TRACES_ENTITY_DISPLAY.source).toContain(
      'const TRACE_ANALYTICS_STATUS_KEY: string = "statusCode";',
    );
    expect(STATUS_COLOR_FUNCTION).toContain(
      "if (keys.length !== 1 || keys[0] !== TRACE_ANALYTICS_STATUS_KEY) { return undefined; }",
    );
    expect(STATUS_COLOR_FUNCTION).toContain(
      "return getSpanStatusPresentation(raw).color; }",
    );
  });

  test("REGRESSION: the view colors a series by its status first, by position only as the fallback", () => {
    expect(TRACES_ANALYTICS_VIEW.source).toMatch(
      /import \{[^}]*\bgetTraceAnalyticsStatusColor\b[^}]*\} from "\.\/TracesEntityDisplay";/,
    );
    expect(COLOR_FOR_SERIES).toBe(
      "const colorForSeries: (seriesKey: string, index: number) => string = ( seriesKey: string, index: number, ): string => { return ( getTraceAnalyticsStatusColor(seriesGroupValues[seriesKey]) || CHART_COLORS[index % CHART_COLORS.length]! ); }",
    );
  });

  test("REGRESSION: the legend, the area and its gradient, each line and each bar take colorForSeries", () => {
    expect(TRACES_ANALYTICS_VIEW.source).toContain(
      "style={{ backgroundColor: colorForSeries(key, index), }}",
    );
    // In source order: the gradient's two stops, the area, the lines, the bars.
    expect(
      captureAll(
        TRACES_ANALYTICS_VIEW.source,
        /\b(?:stroke|fill|stopColor)=\{([^}]*)\}/g,
      ),
    ).toEqual([
      'colorForSeries(seriesKeys[0] || "value", 0)',
      'colorForSeries(seriesKeys[0] || "value", 0)',
      'colorForSeries(seriesKeys[0] || "value", 0)',
      "colorForSeries(key, index)",
      "colorForSeries(key, index)",
    ]);
  });

  test("REGRESSION: a top-list row's dot, bar edge and muted bar take its status's color", () => {
    expect(TRACES_ANALYTICS_VIEW.source).toContain(TOP_LIST_COLORS);
    expect(TRACES_ANALYTICS_VIEW.source).toContain(
      "style={{ backgroundColor: color }}",
    );
    expect(TRACES_ANALYTICS_VIEW.source).toContain(
      "backgroundColor: mutedColor, borderLeft: `3px solid ${color}`,",
    );
  });

  test("REGRESSION: nothing else picks a palette color by position", () => {
    expect(COLOR_FOR_SERIES.length).toBeGreaterThan(0);
    expect(TRACES_ANALYTICS_VIEW.source).toContain(TOP_LIST_COLORS);

    const elsewhere: string = TRACES_ANALYTICS_VIEW.source
      .split(COLOR_FOR_SERIES)
      .join(" ")
      .split(TOP_LIST_COLORS)
      .join(" ");

    expect(count(elsewhere, "CHART_COLORS[")).toBe(0);
    expect(count(elsewhere, "CHART_COLORS_MUTED[")).toBe(0);
  });
});

describe("the filter builder (TraceFilterConfig)", () => {
  test("REGRESSION: status pills come from the module; grey is only for a value that is not a status", () => {
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'export function getStatusCodePillClass(value: string): string { if (value !== "0" && value !== "1" && value !== "2") { return "bg-gray-50 text-gray-600 ring-gray-500/10"; } const status: SpanStatusPresentation = getSpanStatusPresentation(value); return `${status.pillClassName} ${status.pillRingClassName}`; }',
    );
    // The old pill: Unset ("0") grey, Ok a green of its own.
    expect(TRACE_FILTER_CONFIG.source).not.toContain('if (value === "0") {');
    expect(TRACE_FILTER_CONFIG.source).not.toContain(
      "bg-green-50 text-green-700",
    );
    // Then a ring picked by hand: red for Error, emerald for the rest.
    expect(TRACE_FILTER_CONFIG.source).not.toContain("SpanStatus.Error");
    expect(TRACE_FILTER_CONFIG.source).not.toContain("ring-red-600/10");
    expect(TRACE_FILTER_CONFIG.source).not.toContain("ring-emerald-600/10");
  });

  test("filter values and names are unchanged; the descriptions say what each status means", () => {
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'key: "statusCode", label: "Status", description: "OpenTelemetry span status", valueType: "dropdown", valuePlaceholder: "Select status...", valueOptions: [ { value: "0", label: "Unset", description: "No error status set (OpenTelemetry default)", }, { value: "1", label: "Ok", description: "Explicitly marked successful", }, { value: "2", label: "Error", description: "Span ended in error" }, ], getValuePillClass: getStatusCodePillClass,',
    );
    expect(TRACE_FILTER_CONFIG.source).not.toContain('"No status set"');
    expect(TRACE_FILTER_CONFIG.source).not.toContain(
      '"Span completed successfully"',
    );
    // An Unset span can record exceptions: the description is about its status.
    expect(TRACE_FILTER_CONFIG.source).not.toContain(
      '"No error recorded (OpenTelemetry default)"',
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

/*
 * The filter option descriptions and the dot's Unset tooltip, as reworded.
 * Unset is described by its status field ("No error status set"): recording
 * an exception does not change a span's status.
 */
const REWORDED_STRINGS: Array<string> = [
  "No error status set (OpenTelemetry default)",
  "Explicitly marked successful",
  "Span Status: Unset (no error)",
];

// The exception tables' plain Unset tooltip, back beside the reworded one.
const RESTORED_STRINGS: Array<string> = ["Span Status: Unset"];

// What they replaced, including the first rewording of the Unset filter.
const RETIRED_STRINGS: Array<string> = [
  "No status set",
  "No error recorded (OpenTelemetry default)",
  "Span completed successfully",
];

// What SpanStatusElement's tooltip reads, for each status.
const STATUS_TOOLTIPS: Array<string> = SPAN_STATUS_PRESENTATIONS.map(
  (presentation: SpanStatusPresentation): string => {
    return `Span Status: ${presentation.displayLabel}`;
  },
);

// ...and with plainLabel, in the exception tables.
const PLAIN_STATUS_TOOLTIPS: Array<string> = SPAN_STATUS_PRESENTATIONS.map(
  (presentation: SpanStatusPresentation): string => {
    return `Span Status: ${presentation.label}`;
  },
);

// Each needs a translation of its own in every locale.
const TRANSLATED_STRINGS: Array<string> = [
  ...REWORDED_STRINGS,
  ...RESTORED_STRINGS,
];

const LOCALE_STRINGS: Array<string> = Array.from(
  new Set<string>([
    ...TRANSLATED_STRINGS,
    ...STATUS_TOOLTIPS,
    ...PLAIN_STATUS_TOOLTIPS,
  ]),
);

describe("the reworded status strings in every Dashboard locale", () => {
  test("the locale files are found", () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(17);
    expect(localeFiles).toContain("en.json");
  });

  test("the views still render exactly these strings", () => {
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'description: "No error status set (OpenTelemetry default)",',
    );
    expect(TRACE_FILTER_CONFIG.source).toContain(
      'description: "Explicitly marked successful",',
    );
    expect(SPAN_STATUS_ELEMENT.source).toContain(
      "tooltip={`Span Status: ${ props.plainLabel ? status.label : status.displayLabel }`}",
    );
    // The module's display label is what the Unset tooltip key spells...
    expect(STATUS_TOOLTIPS).toContain("Span Status: Unset (no error)");
    expect(STATUS_TOOLTIPS).toHaveLength(3);
    // ...and its plain label what the exception tables' Unset key spells.
    expect(PLAIN_STATUS_TOOLTIPS).toEqual(
      expect.arrayContaining(RESTORED_STRINGS),
    );
    expect(PLAIN_STATUS_TOOLTIPS).toHaveLength(3);
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
        for (const text of TRANSLATED_STRINGS) {
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
      String(readLocale(file)["No error status set (OpenTelemetry default)"]),
    ).toContain("OpenTelemetry");
  });
});
