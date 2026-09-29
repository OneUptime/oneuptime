import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardTraceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
import { DashboardValueTrendDirection } from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplate,
  DashboardTemplateCategory,
  DashboardTemplates,
  DashboardTemplateType,
  getDashboardTemplatesByCategory,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import IconProp from "../../../Types/Icon/IconProp";
import DashboardTraceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardTraceChartComponent";
import type { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * The canonical names from /docs/rum/web-vitals — the ones the docs tell
 * new instrumentation to emit and the ones RumAlertTemplates.ts already
 * alerts on. A widget can only query one spelling, so anything outside
 * this set renders permanently empty, which is the exact failure the
 * comment at the top of DashboardTemplates.ts warns about.
 */
const CANONICAL_WEB_VITAL_METRICS: Array<string> = [
  "web_vital.lcp",
  "web_vital.inp",
  "web_vital.cls",
  "web_vital.fcp",
  "web_vital.ttfb",
];

const GRID_WIDTH_IN_UNITS: number = 12;

/*
 * The aggregation is persisted into the saved dashboard as a raw string, so
 * the wire contract is the string VALUE, not the enum member. Asserting
 * against `AggregationType.Avg` would compare the source to itself —
 * `Types/Metrics/MetricsAggregationType.ts` is a bare re-export of the same
 * enum the template imports — and renaming `Avg = "Avg"` to `"avg"` would
 * break every stored dashboard with the suite still green. So the literals
 * are pinned here, exactly as the metric names and the misspelled
 * `aggegationType` key already are.
 */
const AVG_AGGREGATION: string = "Avg";
const P95_AGGREGATION: string = "P95";

// -- Helpers ---------------------------------------------------------------

type WidgetArguments = Record<string, unknown>;

function getConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Rum,
  );
  expect(config).not.toBeNull();
  return config as DashboardViewConfig;
}

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

/*
 * Every widget family stores its title under a different argument key
 * (Text uses `text`, Chart uses `chartTitle`, Gauge uses `gaugeTitle`,
 * the trace / log widgets use `title`). Looking widgets up by title is
 * the only stable handle: component ids are freshly generated on every
 * call and array positions move whenever a row is inserted.
 */
const TITLE_ARGUMENT_KEYS: Array<string> = [
  "title",
  "chartTitle",
  "gaugeTitle",
  "tableTitle",
  "text",
];

function titleOf(component: DashboardBaseComponent): string {
  const args: WidgetArguments = argumentsOf(component);

  for (const key of TITLE_ARGUMENT_KEYS) {
    const value: unknown = args[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return "";
}

// Fails loudly (rather than returning undefined) when the widget is gone.
function findWidget(
  config: DashboardViewConfig,
  title: string,
): DashboardBaseComponent {
  const matches: Array<DashboardBaseComponent> = config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return titleOf(component) === title;
    },
  );

  expect(matches).toHaveLength(1);
  return matches[0] as DashboardBaseComponent;
}

function componentsOfType(
  config: DashboardViewConfig,
  componentType: DashboardComponentType,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return component.componentType === componentType;
    },
  );
}

function metricQueryConfigOf(
  component: DashboardBaseComponent,
): WidgetArguments {
  return (
    (argumentsOf(component)["metricQueryConfig"] as
      | WidgetArguments
      | undefined) || {}
  );
}

function metricQueryDataOf(component: DashboardBaseComponent): WidgetArguments {
  return (
    (metricQueryConfigOf(component)["metricQueryData"] as
      | WidgetArguments
      | undefined) || {}
  );
}

function filterDataOf(component: DashboardBaseComponent): WidgetArguments {
  return (
    (metricQueryDataOf(component)["filterData"] as
      | WidgetArguments
      | undefined) || {}
  );
}

function metricNameOf(component: DashboardBaseComponent): string | undefined {
  const value: unknown = filterDataOf(component)["metricName"];
  return typeof value === "string" ? value : undefined;
}

/*
 * The aggregation is stored under the MISSPELLED key `aggegationType`.
 * That misspelling is what the fetch layer reads, so it is the contract:
 * "fixing" the spelling silently drops the aggregation.
 */
function aggregationOf(component: DashboardBaseComponent): unknown {
  return filterDataOf(component)["aggegationType"];
}

function groupByAttributeKeysOf(component: DashboardBaseComponent): unknown {
  return metricQueryDataOf(component)["groupByAttributeKeys"];
}

function metricAliasDataOf(
  component: DashboardBaseComponent,
): WidgetArguments | undefined {
  return metricQueryConfigOf(component)["metricAliasData"] as
    | WidgetArguments
    | undefined;
}

function metricWidgetsOf(
  config: DashboardViewConfig,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return metricNameOf(component) !== undefined;
    },
  );
}

function traceWidgetsOf(
  config: DashboardViewConfig,
): Array<DashboardBaseComponent> {
  return [
    ...componentsOfType(config, DashboardComponentType.TraceChart),
    ...componentsOfType(config, DashboardComponentType.TraceTable),
  ];
}

/*
 * The grid slot IS the reading order: swapping two widgets of the same size
 * leaves every other assertion green while silently re-ordering the
 * dashboard, so top/left/width/height are pinned per widget.
 */
interface GridSlot {
  top: number;
  left: number;
  width: number;
  height: number;
}

function componentIdsOf(config: DashboardViewConfig): Array<string> {
  return config.components.map((component: DashboardBaseComponent): string => {
    return component.componentId.toString();
  });
}

function variableIdsOf(config: DashboardViewConfig): Array<string> {
  return (config.variables || []).map((variable: DashboardVariable): string => {
    return variable.id;
  });
}

function slotOf(component: DashboardBaseComponent): GridSlot {
  return {
    top: component.topInDashboardUnits,
    left: component.leftInDashboardUnits,
    width: component.widthInDashboardUnits,
    height: component.heightInDashboardUnits,
  };
}

/*
 * The trace widgets store a bare `metric` string that the analytics endpoint
 * has to recognise. The widget's own editor is the importable oracle for the
 * accepted set: its Metric dropdown is what a user picks from, so a template
 * metric outside it is a value no one could have chosen and the endpoint has
 * no branch for.
 */
function traceChartMetricsOfferedByEditor(): Array<string> {
  const componentArguments: Array<
    ComponentArgument<DashboardTraceChartComponent>
  > = DashboardTraceChartComponentUtil.getComponentConfigArguments();

  const metricArgument:
    | ComponentArgument<DashboardTraceChartComponent>
    | undefined = componentArguments.find(
    (candidate: ComponentArgument<DashboardTraceChartComponent>): boolean => {
      return candidate.id === "metric";
    },
  );

  expect(metricArgument).toBeDefined();

  const options: Array<DropdownOption> =
    (metricArgument as ComponentArgument<DashboardTraceChartComponent>)
      .dropdownOptions || [];

  expect(options.length).toBeGreaterThan(0);

  return options.map((option: DropdownOption): string => {
    return String(option.value);
  });
}

// -- Fixtures --------------------------------------------------------------

/*
 * Named rather than indexed out of SECTION_HEADERS so that inserting a
 * header cannot silently retarget the tests that reach for it.
 */
const SPAN_SECTION_HEADER: string =
  "Page Loads & Browser Errors (span-based — not narrowed by the filters above)";

const LOG_STREAM_TITLE: string = "Recent Browser Logs";

const EXPECTED_WIDGETS: Record<string, DashboardComponentType> = {
  "Real User Monitoring Dashboard": DashboardComponentType.Text,

  "Avg LCP": DashboardComponentType.Value,
  "Avg INP": DashboardComponentType.Value,
  "Avg CLS": DashboardComponentType.Value,
  "Avg TTFB": DashboardComponentType.Value,

  "Largest Contentful Paint": DashboardComponentType.Gauge,
  "Interaction to Next Paint": DashboardComponentType.Gauge,
  "Cumulative Layout Shift": DashboardComponentType.Gauge,
  "First Contentful Paint": DashboardComponentType.Gauge,

  "Core Web Vital Trends": DashboardComponentType.Text,

  "Largest Contentful Paint Over Time": DashboardComponentType.Chart,
  "Interaction to Next Paint Over Time": DashboardComponentType.Chart,
  "Cumulative Layout Shift Over Time": DashboardComponentType.Chart,
  "First Contentful Paint Over Time": DashboardComponentType.Chart,
  "Time to First Byte Over Time": DashboardComponentType.Chart,
  "Largest Contentful Paint by Route (P95)": DashboardComponentType.Chart,

  [SPAN_SECTION_HEADER]: DashboardComponentType.Text,

  "Page Loads & Requests": DashboardComponentType.TraceChart,
  "Browser Errors Over Time": DashboardComponentType.TraceChart,
  "Page Load & Request Time (P95)": DashboardComponentType.TraceChart,
  "Route Change Duration (Avg)": DashboardComponentType.TraceChart,

  Breakdowns: DashboardComponentType.Text,

  Applications: DashboardComponentType.TraceTable,
  "Top Route Changes": DashboardComponentType.TraceTable,
  "Browsers & Platforms": DashboardComponentType.TraceTable,
  [LOG_STREAM_TITLE]: DashboardComponentType.LogStream,
};

interface ValueTileFixture {
  title: string;
  metricName: string;
  slot: GridSlot;
}

const VALUE_TILES: Array<ValueTileFixture> = [
  {
    title: "Avg LCP",
    metricName: "web_vital.lcp",
    slot: { top: 1, left: 0, width: 3, height: 1 },
  },
  {
    title: "Avg INP",
    metricName: "web_vital.inp",
    slot: { top: 1, left: 3, width: 3, height: 1 },
  },
  {
    title: "Avg CLS",
    metricName: "web_vital.cls",
    slot: { top: 1, left: 6, width: 3, height: 1 },
  },
  {
    title: "Avg TTFB",
    metricName: "web_vital.ttfb",
    slot: { top: 1, left: 9, width: 3, height: 1 },
  },
];

interface GaugeFixture {
  title: string;
  metricName: string;
  minValue: number;
  maxValue: number;
  warningThreshold: number;
  criticalThreshold: number;
  slot: GridSlot;
}

/*
 * Warning / critical are Google's published "needs improvement" / "poor"
 * boundaries for each vital. Drifting off them turns the gauge colour into
 * an opinion nobody can look up.
 */
const GAUGES: Array<GaugeFixture> = [
  {
    title: "Largest Contentful Paint",
    metricName: "web_vital.lcp",
    minValue: 0,
    maxValue: 6000,
    warningThreshold: 2500,
    criticalThreshold: 4000,
    slot: { top: 2, left: 0, width: 3, height: 3 },
  },
  {
    title: "Interaction to Next Paint",
    metricName: "web_vital.inp",
    minValue: 0,
    maxValue: 1000,
    warningThreshold: 200,
    criticalThreshold: 500,
    slot: { top: 2, left: 3, width: 3, height: 3 },
  },
  {
    title: "Cumulative Layout Shift",
    metricName: "web_vital.cls",
    minValue: 0,
    maxValue: 0.5,
    warningThreshold: 0.1,
    criticalThreshold: 0.25,
    slot: { top: 2, left: 6, width: 3, height: 3 },
  },
  {
    title: "First Contentful Paint",
    metricName: "web_vital.fcp",
    minValue: 0,
    maxValue: 5000,
    warningThreshold: 1800,
    criticalThreshold: 3000,
    slot: { top: 2, left: 9, width: 3, height: 3 },
  },
];

interface ChartFixture {
  title: string;
  chartType: DashboardChartType;
  metricName: string;
  aggregationType: string;
  legend: string;
  legendUnit: string | undefined;
  slot: GridSlot;
}

const CHARTS: Array<ChartFixture> = [
  {
    title: "Largest Contentful Paint Over Time",
    chartType: DashboardChartType.Line,
    metricName: "web_vital.lcp",
    aggregationType: AVG_AGGREGATION,
    legend: "LCP",
    legendUnit: "ms",
    slot: { top: 6, left: 0, width: 6, height: 3 },
  },
  {
    title: "Interaction to Next Paint Over Time",
    chartType: DashboardChartType.Line,
    metricName: "web_vital.inp",
    aggregationType: AVG_AGGREGATION,
    legend: "INP",
    legendUnit: "ms",
    slot: { top: 6, left: 6, width: 6, height: 3 },
  },
  {
    // CLS is unitless, so it deliberately ships no legendUnit.
    title: "Cumulative Layout Shift Over Time",
    chartType: DashboardChartType.Line,
    metricName: "web_vital.cls",
    aggregationType: AVG_AGGREGATION,
    legend: "CLS",
    legendUnit: undefined,
    slot: { top: 9, left: 0, width: 6, height: 3 },
  },
  {
    title: "First Contentful Paint Over Time",
    chartType: DashboardChartType.Line,
    metricName: "web_vital.fcp",
    aggregationType: AVG_AGGREGATION,
    legend: "FCP",
    legendUnit: "ms",
    slot: { top: 9, left: 6, width: 6, height: 3 },
  },
  {
    title: "Time to First Byte Over Time",
    chartType: DashboardChartType.Line,
    metricName: "web_vital.ttfb",
    aggregationType: AVG_AGGREGATION,
    legend: "TTFB",
    legendUnit: "ms",
    slot: { top: 12, left: 0, width: 6, height: 3 },
  },
  {
    title: "Largest Contentful Paint by Route (P95)",
    chartType: DashboardChartType.Bar,
    metricName: "web_vital.lcp",
    aggregationType: P95_AGGREGATION,
    legend: "P95 LCP",
    legendUnit: "ms",
    slot: { top: 12, left: 6, width: 6, height: 3 },
  },
];

const P95_CHART_TITLE: string = "Largest Contentful Paint by Route (P95)";

interface TraceWidgetFixture {
  title: string;
  metric?: string;
  groupByAttribute: string;
  slot: GridSlot;
}

const TRACE_CHARTS: Array<TraceWidgetFixture> = [
  {
    title: "Page Loads & Requests",
    metric: "count",
    groupByAttribute: "rumApplicationId",
    slot: { top: 16, left: 0, width: 6, height: 3 },
  },
  {
    title: "Browser Errors Over Time",
    metric: "errorCount",
    groupByAttribute: "rumApplicationId",
    slot: { top: 16, left: 6, width: 6, height: 3 },
  },
  {
    title: "Page Load & Request Time (P95)",
    metric: "p95Duration",
    groupByAttribute: "rumApplicationId",
    slot: { top: 19, left: 0, width: 6, height: 3 },
  },
  {
    title: "Route Change Duration (Avg)",
    metric: "avgDuration",
    groupByAttribute: "app.route",
    slot: { top: 19, left: 6, width: 6, height: 3 },
  },
];

const TRACE_TABLES: Array<TraceWidgetFixture> = [
  {
    title: "Applications",
    groupByAttribute: "rumApplicationId",
    slot: { top: 23, left: 0, width: 6, height: 3 },
  },
  {
    title: "Top Route Changes",
    groupByAttribute: "app.route",
    slot: { top: 23, left: 6, width: 6, height: 3 },
  },
  {
    title: "Browsers & Platforms",
    groupByAttribute: "resource.browser.platform",
    slot: { top: 26, left: 0, width: 6, height: 3 },
  },
];

const LOG_STREAM_SLOT: GridSlot = { top: 26, left: 6, width: 6, height: 3 };

const SECTION_HEADERS: Array<string> = [
  "Real User Monitoring Dashboard",
  "Core Web Vital Trends",
  SPAN_SECTION_HEADER,
  "Breakdowns",
];

// -- Tests -----------------------------------------------------------------

describe("RUM dashboard template", () => {
  describe("catalog registration", () => {
    test("registers exactly one Real User Monitoring entry under Monitoring & APM", () => {
      const entries: Array<DashboardTemplate> = DashboardTemplates.filter(
        (candidate: DashboardTemplate): boolean => {
          return candidate.type === DashboardTemplateType.Rum;
        },
      );

      expect(entries).toHaveLength(1);

      const template: DashboardTemplate = entries[0] as DashboardTemplate;
      expect(template.name).toBe("Real User Monitoring Dashboard");
      expect(template.icon).toBe(IconProp.Globe);
      expect(template.category).toBe(DashboardTemplateCategory.Monitoring);
    });

    test("describes every vital the dashboard actually charts", () => {
      const template: DashboardTemplate | undefined = DashboardTemplates.find(
        (candidate: DashboardTemplate): boolean => {
          return candidate.type === DashboardTemplateType.Rum;
        },
      );

      expect(template).toBeDefined();

      const description: string = (template as DashboardTemplate).description;

      for (const vital of ["LCP", "INP", "CLS", "FCP", "TTFB"]) {
        expect(description).toContain(vital);
      }
    });

    test("is surfaced by the Monitoring category grouping the modal renders", () => {
      const grouped: Array<DashboardTemplate> = getDashboardTemplatesByCategory(
        DashboardTemplateCategory.Monitoring,
      );

      const types: Array<DashboardTemplateType> = grouped.map(
        (template: DashboardTemplate): DashboardTemplateType => {
          return template.type;
        },
      );

      expect(types).toContain(DashboardTemplateType.Rum);
    });

    /*
     * DashboardService validates the string it receives in
     * miscDataProps.dashboardTemplateType against Object.values(
     * DashboardTemplateType) before handing it to getTemplateConfig, so the
     * enum VALUE — not the member name — is the wire contract with the UI.
     */
    test("accepts the raw wire value 'Rum' DashboardService validates against", () => {
      const wireValue: string = "Rum";

      expect(DashboardTemplateType.Rum).toBe(wireValue);
      expect(
        getTemplateConfig(wireValue as DashboardTemplateType),
      ).not.toBeNull();
    });
  });

  describe("widget inventory", () => {
    test("renders exactly the expected widgets, each with its expected type", () => {
      const config: DashboardViewConfig = getConfig();
      const actual: Record<string, DashboardComponentType> = {};

      expect(config.components).toHaveLength(
        Object.keys(EXPECTED_WIDGETS).length,
      );

      for (const component of config.components) {
        const title: string = titleOf(component);
        expect(title).not.toBe("");
        // Titles are the lookup handle, so they have to stay unique.
        expect(actual[title]).toBeUndefined();
        actual[title] = component.componentType;
      }

      expect(actual).toEqual(EXPECTED_WIDGETS);
    });

    test("splits those widgets across the expected widget families", () => {
      const config: DashboardViewConfig = getConfig();

      expect(
        componentsOfType(config, DashboardComponentType.Text),
      ).toHaveLength(4);
      expect(
        componentsOfType(config, DashboardComponentType.Value),
      ).toHaveLength(4);
      expect(
        componentsOfType(config, DashboardComponentType.Gauge),
      ).toHaveLength(4);
      expect(
        componentsOfType(config, DashboardComponentType.Chart),
      ).toHaveLength(6);
      expect(
        componentsOfType(config, DashboardComponentType.TraceChart),
      ).toHaveLength(4);
      expect(
        componentsOfType(config, DashboardComponentType.TraceTable),
      ).toHaveLength(3);
      expect(
        componentsOfType(config, DashboardComponentType.LogStream),
      ).toHaveLength(1);
    });

    // TraceList has no group-by, so it cannot be scoped to RUM traffic.
    test("does not use the unscopable trace list widget", () => {
      expect(
        componentsOfType(getConfig(), DashboardComponentType.TraceList),
      ).toHaveLength(0);
    });
  });

  describe("metric queries", () => {
    test("queries only canonical web_vital.* metric names", () => {
      const config: DashboardViewConfig = getConfig();
      const metricWidgets: Array<DashboardBaseComponent> =
        metricWidgetsOf(config);

      expect(metricWidgets).toHaveLength(14);

      for (const widget of metricWidgets) {
        expect(CANONICAL_WEB_VITAL_METRICS).toContain(metricNameOf(widget));
      }
    });

    test("covers all five Core Web Vitals", () => {
      const queried: Set<string> = new Set(
        metricWidgetsOf(getConfig()).map(
          (component: DashboardBaseComponent): string => {
            return metricNameOf(component) as string;
          },
        ),
      );

      for (const canonical of CANONICAL_WEB_VITAL_METRICS) {
        expect(queried.has(canonical)).toBe(true);
      }
    });

    /*
     * The fetch layer reads `aggegationType`. Correcting the spelling here
     * would leave every widget with no aggregation at all, so the
     * misspelling is pinned in both directions.
     */
    test("stores every aggregation under the misspelled aggegationType key", () => {
      const config: DashboardViewConfig = getConfig();
      const metricWidgets: Array<DashboardBaseComponent> =
        metricWidgetsOf(config);

      expect(metricWidgets).toHaveLength(14);

      for (const widget of metricWidgets) {
        const filterData: WidgetArguments = filterDataOf(widget);

        expect(Object.keys(filterData)).toContain("aggegationType");
        expect(Object.keys(filterData)).not.toContain("aggregationType");
        // The stored value is the raw string the fetch layer compares on.
        expect([AVG_AGGREGATION, P95_AGGREGATION]).toContain(
          aggregationOf(widget),
        );
      }
    });

    test("uses the P95 aggregation on exactly the one per-route chart, and fans out by app.route only there", () => {
      const config: DashboardViewConfig = getConfig();

      const p95Titles: Array<string> = config.components
        .filter((component: DashboardBaseComponent): boolean => {
          return aggregationOf(component) === P95_AGGREGATION;
        })
        .map((component: DashboardBaseComponent): string => {
          return titleOf(component);
        });

      expect(p95Titles).toEqual([P95_CHART_TITLE]);

      const fanOutTitles: Array<string> = config.components
        .filter((component: DashboardBaseComponent): boolean => {
          return groupByAttributeKeysOf(component) !== undefined;
        })
        .map((component: DashboardBaseComponent): string => {
          return titleOf(component);
        });

      expect(fanOutTitles).toEqual([P95_CHART_TITLE]);
      expect(
        groupByAttributeKeysOf(findWidget(config, P95_CHART_TITLE)),
      ).toEqual(["app.route"]);
    });
  });

  describe("headline value tiles", () => {
    for (const tile of VALUE_TILES) {
      test(`"${tile.title}" averages ${tile.metricName} in its own grid slot`, () => {
        const config: DashboardViewConfig = getConfig();
        const widget: DashboardBaseComponent = findWidget(config, tile.title);

        expect(widget.componentType).toBe(DashboardComponentType.Value);
        expect(metricNameOf(widget)).toBe(tile.metricName);
        expect(aggregationOf(widget)).toBe(AVG_AGGREGATION);
        expect(slotOf(widget)).toEqual(tile.slot);
      });
    }

    /*
     * The renderer's trend-arrow heuristic keys off the metric name and
     * does not recognise `web_vital.*`, so every vital would get a
     * "rising is good" green arrow unless the direction is set explicitly.
     */
    test("pins HigherIsWorse on every tile rather than trusting the name heuristic", () => {
      const config: DashboardViewConfig = getConfig();
      const tiles: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Value,
      );

      expect(tiles).toHaveLength(VALUE_TILES.length);

      for (const tile of tiles) {
        expect(argumentsOf(tile)["trendDirection"]).toBe(
          DashboardValueTrendDirection.HigherIsWorse,
        );
      }
    });
  });

  describe("Core Web Vital gauges", () => {
    for (const gauge of GAUGES) {
      test(`"${gauge.title}" sweeps ${gauge.minValue}-${gauge.maxValue} with Google's published boundaries`, () => {
        const config: DashboardViewConfig = getConfig();
        const widget: DashboardBaseComponent = findWidget(config, gauge.title);
        const args: WidgetArguments = argumentsOf(widget);

        expect(widget.componentType).toBe(DashboardComponentType.Gauge);
        expect(metricNameOf(widget)).toBe(gauge.metricName);
        expect(aggregationOf(widget)).toBe(AVG_AGGREGATION);
        expect(args["minValue"]).toBe(gauge.minValue);
        expect(args["maxValue"]).toBe(gauge.maxValue);
        expect(args["warningThreshold"]).toBe(gauge.warningThreshold);
        expect(args["criticalThreshold"]).toBe(gauge.criticalThreshold);
        expect(slotOf(widget)).toEqual(gauge.slot);
      });
    }

    // A gauge whose bands are out of order colours the dial nonsensically.
    test("keeps min < warning < critical <= max on every gauge", () => {
      const config: DashboardViewConfig = getConfig();
      const gauges: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Gauge,
      );

      expect(gauges).toHaveLength(GAUGES.length);

      for (const gauge of gauges) {
        const args: WidgetArguments = argumentsOf(gauge);
        const minValue: number = args["minValue"] as number;
        const maxValue: number = args["maxValue"] as number;
        const warning: number = args["warningThreshold"] as number;
        const critical: number = args["criticalThreshold"] as number;

        expect(minValue).toBeLessThan(warning);
        expect(warning).toBeLessThan(critical);
        expect(critical).toBeLessThanOrEqual(maxValue);
      }
    });
  });

  describe("Core Web Vital trend charts", () => {
    for (const chart of CHARTS) {
      test(`"${chart.title}" is a ${chart.chartType} chart of ${chart.metricName}`, () => {
        const config: DashboardViewConfig = getConfig();
        const widget: DashboardBaseComponent = findWidget(config, chart.title);
        const alias: WidgetArguments | undefined = metricAliasDataOf(widget);

        expect(widget.componentType).toBe(DashboardComponentType.Chart);
        expect(argumentsOf(widget)["chartType"]).toBe(chart.chartType);
        expect(metricNameOf(widget)).toBe(chart.metricName);
        expect(aggregationOf(widget)).toBe(chart.aggregationType);
        expect(alias).toBeDefined();
        expect((alias as WidgetArguments)["legend"]).toBe(chart.legend);
        expect((alias as WidgetArguments)["legendUnit"]).toBe(chart.legendUnit);
        expect(slotOf(widget)).toEqual(chart.slot);
      });
    }

    /*
     * Charts go through buildMetricQueryConfig (which carries
     * metricAliasData); Value tiles and gauges go through
     * buildMetricQueryData, which omits it entirely — so a legend or
     * legendUnit set on those would be inert config that reads as if it
     * were doing something.
     *
     * NOTE ON WHAT THIS GUARDS: the "never" half is enforced structurally by
     * the shared buildMetricQueryData factory, so no edit confined to
     * createRumDashboardConfig can break it — it is a regression guard on
     * that shared factory, not on this template. The legend-uniqueness
     * assertion below is the half a template edit can break: two charts
     * sharing a legend render two indistinguishable series names.
     */
    test("carries metricAliasData on charts only, never on value tiles or gauges", () => {
      const config: DashboardViewConfig = getConfig();
      const charts: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Chart,
      );
      const aliaslessWidgets: Array<DashboardBaseComponent> = [
        ...componentsOfType(config, DashboardComponentType.Value),
        ...componentsOfType(config, DashboardComponentType.Gauge),
      ];

      expect(charts).toHaveLength(CHARTS.length);
      expect(aliaslessWidgets).toHaveLength(VALUE_TILES.length + GAUGES.length);

      const legends: Array<string> = [];

      for (const chart of charts) {
        const alias: WidgetArguments | undefined = metricAliasDataOf(chart);
        expect(alias).toBeDefined();

        const legend: unknown = (alias as WidgetArguments)["legend"];
        expect(typeof legend).toBe("string");
        expect((legend as string).length).toBeGreaterThan(0);
        legends.push(legend as string);
      }

      // Two charts sharing a legend render two series nobody can tell apart.
      expect(new Set(legends).size).toBe(charts.length);

      for (const widget of aliaslessWidgets) {
        expect(metricAliasDataOf(widget)).toBeUndefined();
        expect(Object.keys(metricQueryConfigOf(widget))).not.toContain(
          "metricAliasData",
        );
      }
    });
  });

  describe("span-based trace widgets", () => {
    test("charts each analytics metric against its own group-by dimension", () => {
      const config: DashboardViewConfig = getConfig();

      expect(
        componentsOfType(config, DashboardComponentType.TraceChart),
      ).toHaveLength(TRACE_CHARTS.length);

      for (const traceChart of TRACE_CHARTS) {
        const widget: DashboardBaseComponent = findWidget(
          config,
          traceChart.title,
        );
        const args: WidgetArguments = argumentsOf(widget);

        expect(widget.componentType).toBe(DashboardComponentType.TraceChart);
        expect(args["metric"]).toBe(traceChart.metric);
        expect(args["groupByAttribute"]).toBe(traceChart.groupByAttribute);
        expect(args["topLimit"]).toBe(10);
        expect(slotOf(widget)).toEqual(traceChart.slot);
      }
    });

    /*
     * The `metric` strings above are free-form in the type, so pinning them
     * against a local fixture only proves the template matches itself. The
     * TraceChart widget's own Metric dropdown is the accepted vocabulary a
     * user could otherwise have picked from — a template metric outside it
     * is one the editor cannot even express.
     */
    test("charts only metrics the TraceChart editor itself offers", () => {
      const config: DashboardViewConfig = getConfig();
      const offered: Array<string> = traceChartMetricsOfferedByEditor();
      const traceCharts: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.TraceChart,
      );

      expect(traceCharts).toHaveLength(TRACE_CHARTS.length);
      // The offered set is closed — otherwise `toContain` proves nothing.
      expect(offered).not.toContain("web_vital.lcp");

      for (const widget of traceCharts) {
        expect(offered).toContain(argumentsOf(widget)["metric"]);
      }
    });

    test("breaks traffic down by application, route and platform", () => {
      const config: DashboardViewConfig = getConfig();

      expect(
        componentsOfType(config, DashboardComponentType.TraceTable),
      ).toHaveLength(TRACE_TABLES.length);

      for (const traceTable of TRACE_TABLES) {
        const widget: DashboardBaseComponent = findWidget(
          config,
          traceTable.title,
        );
        const args: WidgetArguments = argumentsOf(widget);

        expect(widget.componentType).toBe(DashboardComponentType.TraceTable);
        expect(args["groupByAttribute"]).toBe(traceTable.groupByAttribute);
        expect(args["topLimit"]).toBe(10);
        expect(slotOf(widget)).toEqual(traceTable.slot);
      }
    });

    /*
     * Trace widgets are scoped by their group-by dimension, not by a
     * filter: `rumApplicationId` compiles to
     * `primaryEntityType = 'RealUserMonitor'` and a plain attribute key to
     * `mapContains(attributes, key)` (TraceAggregationService). A trace
     * widget without one would silently chart every span in the project,
     * backend included.
     */
    test("gives every trace widget a scoping group-by dimension", () => {
      const config: DashboardViewConfig = getConfig();
      const traceWidgets: Array<DashboardBaseComponent> =
        traceWidgetsOf(config);

      expect(traceWidgets).toHaveLength(
        TRACE_CHARTS.length + TRACE_TABLES.length,
      );

      for (const widget of traceWidgets) {
        const groupBy: unknown = argumentsOf(widget)["groupByAttribute"];
        expect(typeof groupBy).toBe("string");
        expect((groupBy as string).length).toBeGreaterThan(0);
      }
    });
  });

  describe("recent logs stream", () => {
    test("sits beside the platform breakdown in the bottom row", () => {
      const config: DashboardViewConfig = getConfig();
      const widget: DashboardBaseComponent = findWidget(
        config,
        LOG_STREAM_TITLE,
      );

      expect(widget.componentType).toBe(DashboardComponentType.LogStream);
      expect(slotOf(widget)).toEqual(LOG_STREAM_SLOT);
    });
  });

  describe("variables", () => {
    test("ships exactly the application and platform pickers, in order", () => {
      const config: DashboardViewConfig = getConfig();
      const variables: Array<DashboardVariable> = config.variables || [];

      expect(variables).toHaveLength(2);
      expect(
        variables.map(
          (variable: DashboardVariable): Record<string, unknown> => {
            return {
              name: variable.name,
              label: variable.label,
              type: variable.type,
              attributeKey: variable.attributeKey,
              isMultiSelect: variable.isMultiSelect,
            };
          },
        ),
      ).toEqual([
        {
          name: "application",
          label: "Application",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "resource.service.name",
          isMultiSelect: true,
        },
        {
          name: "platform",
          label: "Platform",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "resource.browser.platform",
          isMultiSelect: true,
        },
      ]);
    });

    /*
     * `app.route` is recorded on metrics and spans but never on logs, so
     * binding a variable to it would empty "Recent Browser Logs" whenever
     * a route is selected, reading as "this route produced no logs".
     */
    test("never binds a variable to app.route, which logs do not carry", () => {
      const config: DashboardViewConfig = getConfig();
      const variables: Array<DashboardVariable> = config.variables || [];

      expect(variables.length).toBeGreaterThan(0);

      for (const variable of variables) {
        expect(variable.attributeKey).not.toBe("app.route");
      }
    });
  });

  describe("section headers", () => {
    test("lays out the four bold section headers in row order", () => {
      const config: DashboardViewConfig = getConfig();
      const headers: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Text,
      ).sort((a: DashboardBaseComponent, b: DashboardBaseComponent): number => {
        return a.topInDashboardUnits - b.topInDashboardUnits;
      });

      expect(headers).toHaveLength(SECTION_HEADERS.length);
      expect(
        headers.map((header: DashboardBaseComponent): string => {
          return titleOf(header);
        }),
      ).toEqual(SECTION_HEADERS);

      for (const header of headers) {
        expect(argumentsOf(header)["isBold"]).toBe(true);
        expect(header.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
      }
    });

    /*
     * The trace analytics endpoint does not read dashboard variables, so
     * the toolbar pickers narrow the metric widgets and the log stream but
     * not this section. A header that does not say so invites reading the
     * two halves of the dashboard as one filtered view.
     */
    test("warns that the span-based section is not narrowed by the variables", () => {
      const config: DashboardViewConfig = getConfig();

      /*
       * Found STRUCTURALLY — the Text widget sitting immediately above the
       * first trace chart — rather than by its own text, so that dropping
       * the warning, or moving the header away from the section it
       * introduces, fails instead of merely retargeting the lookup.
       */
      const traceCharts: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.TraceChart,
      );

      expect(traceCharts.length).toBeGreaterThan(0);

      const firstTraceChartTop: number = Math.min(
        ...traceCharts.map((chart: DashboardBaseComponent): number => {
          return chart.topInDashboardUnits;
        }),
      );

      const headersAbove: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Text,
      ).filter((header: DashboardBaseComponent): boolean => {
        return header.topInDashboardUnits < firstTraceChartTop;
      });

      expect(headersAbove.length).toBeGreaterThan(0);

      const header: DashboardBaseComponent = headersAbove.reduce(
        (
          lowest: DashboardBaseComponent,
          candidate: DashboardBaseComponent,
        ): DashboardBaseComponent => {
          return candidate.topInDashboardUnits > lowest.topInDashboardUnits
            ? candidate
            : lowest;
        },
      );

      const text: string = argumentsOf(header)["text"] as string;

      expect(text).toContain("span-based");
      expect(text).toContain("not narrowed by the filters above");
      // And it introduces the section rather than floating far above it.
      expect(header.topInDashboardUnits).toBe(firstTraceChartTop - 1);
    });
  });

  describe("layout", () => {
    test("lays widgets out inside the 12-unit grid without overlapping", () => {
      const config: DashboardViewConfig = getConfig();
      const occupied: Set<string> = new Set();

      expect(config.components.length).toBeGreaterThan(0);

      for (const component of config.components) {
        expect(component.leftInDashboardUnits).toBeGreaterThanOrEqual(0);
        expect(component.topInDashboardUnits).toBeGreaterThanOrEqual(0);
        expect(
          component.leftInDashboardUnits + component.widthInDashboardUnits,
        ).toBeLessThanOrEqual(GRID_WIDTH_IN_UNITS);

        for (
          let row: number = component.topInDashboardUnits;
          row <
          component.topInDashboardUnits + component.heightInDashboardUnits;
          row++
        ) {
          for (
            let column: number = component.leftInDashboardUnits;
            column <
            component.leftInDashboardUnits + component.widthInDashboardUnits;
            column++
          ) {
            const cell: string = `${row}:${column}`;
            expect(occupied.has(cell)).toBe(false);
            occupied.add(cell);
          }
        }
      }
    });

    // A blank band mid-dashboard reads as a widget that failed to render.
    test("leaves no empty rows between the title and the last widget", () => {
      const config: DashboardViewConfig = getConfig();
      const occupiedRows: Set<number> = new Set();

      expect(config.components.length).toBeGreaterThan(0);

      for (const component of config.components) {
        for (
          let row: number = component.topInDashboardUnits;
          row <
          component.topInDashboardUnits + component.heightInDashboardUnits;
          row++
        ) {
          occupiedRows.add(row);
        }
      }

      const lastRow: number = Math.max(...Array.from(occupiedRows));

      for (let row: number = 0; row <= lastRow; row++) {
        expect(occupiedRows.has(row)).toBe(true);
      }
    });

    test("is tall enough to hold its bottom row", () => {
      const config: DashboardViewConfig = getConfig();
      const lowestRow: number = Math.max(
        ...config.components.map(
          (component: DashboardBaseComponent): number => {
            return (
              component.topInDashboardUnits + component.heightInDashboardUnits
            );
          },
        ),
      );

      expect(config.heightInDashboardUnits).toBeGreaterThanOrEqual(lowestRow);
    });

    // Below its own minimum a widget renders clipped from the moment it loads.
    test("sizes every widget at or above its declared minimum", () => {
      const config: DashboardViewConfig = getConfig();

      expect(config.components).toHaveLength(
        Object.keys(EXPECTED_WIDGETS).length,
      );

      for (const component of config.components) {
        expect(component.widthInDashboardUnits).toBeGreaterThanOrEqual(
          component.minWidthInDashboardUnits,
        );
        expect(component.heightInDashboardUnits).toBeGreaterThanOrEqual(
          component.minHeightInDashboardUnits,
        );
      }
    });
  });

  /*
   * Each call has to mint fresh ids: reusing them would make two dashboards
   * created from this template collide in any per-component stored state.
   */
  test("mints disjoint component and variable ids on every call", () => {
    const first: DashboardViewConfig = getConfig();
    const second: DashboardViewConfig = getConfig();

    expect(second.components).toHaveLength(first.components.length);
    expect(second.components.length).toBeGreaterThan(0);

    const firstComponentIds: Array<string> = componentIdsOf(first);
    const secondComponentIds: Array<string> = componentIdsOf(second);

    // Unique WITHIN each config, not just across the two.
    expect(new Set(firstComponentIds).size).toBe(firstComponentIds.length);
    expect(new Set(secondComponentIds).size).toBe(secondComponentIds.length);

    const seenComponentIds: Set<string> = new Set(firstComponentIds);

    for (const componentId of secondComponentIds) {
      expect(seenComponentIds.has(componentId)).toBe(false);
    }

    const firstVariableIds: Array<string> = variableIdsOf(first);
    const secondVariableIds: Array<string> = variableIdsOf(second);

    expect(firstVariableIds.length).toBeGreaterThan(0);
    expect(secondVariableIds).toHaveLength(firstVariableIds.length);
    expect(new Set(firstVariableIds).size).toBe(firstVariableIds.length);
    expect(new Set(secondVariableIds).size).toBe(secondVariableIds.length);

    const seenVariableIds: Set<string> = new Set(firstVariableIds);

    for (const variableId of secondVariableIds) {
      expect(seenVariableIds.has(variableId)).toBe(false);
    }
  });
});
