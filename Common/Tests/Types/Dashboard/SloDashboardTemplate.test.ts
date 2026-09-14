import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
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
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import { describe, expect, it } from "@jest/globals";

/*
 * Editorial invariants for the SLO template specifically. The structural
 * rules every template must satisfy (grid bounds, overlap, unique ids,
 * aggregation spelling) live in DashboardTemplateInvariants — this file
 * pins the things that make THIS template the SLO one: that it carries the
 * Slo widget at all, which of the SLO's three numbers it shows and how,
 * that it ships those widgets unconfigured, and that the metric widgets
 * beside them cannot disagree with the Monitor variable.
 */

/*
 * The persisted strings. Both enums are written verbatim into the saved
 * dashboard's JSON config, so renaming a member's VALUE silently breaks
 * every dashboard already created from this template. Pinned as literals
 * rather than as enum members so that rename fails here instead of
 * shipping.
 */
const SLI_METRIC: string = "Sli";
const ERROR_BUDGET_REMAINING_METRIC: string = "ErrorBudgetRemaining";
const BURN_RATE_METRIC: string = "BurnRate";

const TILE_DISPLAY: string = "Tile";
const CHART_DISPLAY: string = "Chart";

/*
 * The two metric series this template is allowed to query. Both are emitted
 * by MonitorMetricUtil for every probeable monitor, and both carry the bare
 * `monitorName` attribute the Monitor variable binds to.
 */
const IS_ONLINE_METRIC: string = "oneuptime.monitor.online";
const RESPONSE_TIME_METRIC: string = "oneuptime.monitor.response.time";

/*
 * Every incident and alert metric, taken from the enums so a member added
 * later is covered without editing this list.
 *
 * Neither family survives this template's Monitor variable.
 * IncidentService stamps its metrics with `monitorNames` (plural,
 * comma-joined) rather than `monitorName`, so a pick would empty every
 * incident tile while the uptime tiles beside them stayed populated.
 * AlertService does write the singular key — but a burn-rate alert is
 * declared with no monitor attached at all, so it carries no `monitorName`
 * and a scoped alert tile would hide precisely the alerts an SLO dashboard
 * exists for.
 */
const MONITOR_VARIABLE_HOSTILE_METRICS: Array<string> = [
  ...Object.values(IncidentMetricType),
  ...Object.values(AlertMetricType),
];

/*
 * The bare attribute key MonitorMetricUtil.buildAttributes writes. It
 * carries no `resource.` prefix, so a variable that guessed
 * "resource.monitorName" would compile and offer an empty picker.
 */
const MONITOR_ATTRIBUTE: string = "monitorName";

const AVG_AGGREGATION: string = "Avg";
const MAX_AGGREGATION: string = "Max";

const GRID_WIDTH_IN_UNITS: number = 12;

// -- Helpers ---------------------------------------------------------------

type WidgetArguments = Record<string, unknown>;

function getConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Slo,
  );
  expect(config).not.toBeNull();
  return config as DashboardViewConfig;
}

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

/*
 * Every widget family stores its title under a different argument key, and
 * titles are the only stable handle: ids are freshly generated on every
 * call and array positions move whenever a row is inserted. The Slo widget
 * uses `widgetTitle`, which no other family does.
 */
const TITLE_ARGUMENT_KEYS: Array<string> = [
  "title",
  "chartTitle",
  "gaugeTitle",
  "tableTitle",
  "widgetTitle",
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

function sloWidgets(
  config: DashboardViewConfig,
): Array<DashboardBaseComponent> {
  return componentsOfType(config, DashboardComponentType.Slo);
}

function filterDataOf(component: DashboardBaseComponent): WidgetArguments {
  const queryConfig: WidgetArguments =
    (argumentsOf(component)["metricQueryConfig"] as
      | WidgetArguments
      | undefined) || {};
  const queryData: WidgetArguments =
    (queryConfig["metricQueryData"] as WidgetArguments | undefined) || {};

  return (queryData["filterData"] as WidgetArguments | undefined) || {};
}

function metricNameOf(component: DashboardBaseComponent): string | undefined {
  const value: unknown = filterDataOf(component)["metricName"];
  return typeof value === "string" ? value : undefined;
}

/*
 * The aggregation is stored under the MISSPELLED key `aggegationType`.
 * That misspelling is what the fetch layer reads, so it is the contract.
 */
function aggregationOf(component: DashboardBaseComponent): unknown {
  return filterDataOf(component)["aggegationType"];
}

function lowestOccupiedEdge(config: DashboardViewConfig): number {
  return Math.max(
    ...config.components.map((component: DashboardBaseComponent): number => {
      return component.topInDashboardUnits + component.heightInDashboardUnits;
    }),
  );
}

// -- Tests -----------------------------------------------------------------

describe("SLO dashboard template", () => {
  describe("catalog entry", () => {
    it("is registered exactly once", () => {
      const entries: Array<DashboardTemplate> = DashboardTemplates.filter(
        (template: DashboardTemplate): boolean => {
          return template.type === DashboardTemplateType.Slo;
        },
      );

      expect(entries).toHaveLength(1);
    });

    it("is filed under Monitoring with the percent icon the SLO pages use", () => {
      const entry: DashboardTemplate = DashboardTemplates.find(
        (template: DashboardTemplate): boolean => {
          return template.type === DashboardTemplateType.Slo;
        },
      ) as DashboardTemplate;

      expect(entry.name).toBe("SLO Dashboard");
      expect(entry.category).toBe(DashboardTemplateCategory.Monitoring);
      expect(entry.icon).toBe(IconProp.Percent);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    });

    it("is listed by getDashboardTemplatesByCategory for Monitoring", () => {
      const types: Array<DashboardTemplateType> =
        getDashboardTemplatesByCategory(
          DashboardTemplateCategory.Monitoring,
        ).map((template: DashboardTemplate): DashboardTemplateType => {
          return template.type;
        });

      expect(types).toContain(DashboardTemplateType.Slo);
    });

    it("resolves to a config rather than to null the way Blank does", () => {
      expect(getTemplateConfig(DashboardTemplateType.Slo)).not.toBeNull();
    });

    /*
     * The enum value is persisted on the Dashboard row that records which
     * template it was created from, so it is a wire string, not a label.
     */
    it("uses the persisted enum value 'Slo'", () => {
      expect(DashboardTemplateType.Slo).toBe("Slo");
    });
  });

  describe("the SLO widgets", () => {
    /*
     * This is the whole reason the template exists. The three SLO numbers
     * live in Postgres and in SloHistory, not in the metric store, so no
     * Chart / Value / Gauge widget can ever render them — only the
     * dedicated Slo widget can.
     */
    it("carries the Slo widget, which nothing else on a dashboard can stand in for", () => {
      expect(sloWidgets(getConfig()).length).toBeGreaterThan(0);
    });

    /*
     * Title, metric and display asserted TOGETHER, per widget. Checking
     * only the SET of (metric, display) pairs would pass unchanged if the
     * three titles were permuted across the three metrics — a dashboard
     * whose "Burn Rate" tile reports the SLI, which is the single worst
     * way this template can be wrong and the one a reader cannot see.
     */
    it("labels each SLO widget with the number it actually reports", () => {
      const config: DashboardViewConfig = getConfig();

      const expected: Array<[string, string, string]> = [
        ["SLI", SLI_METRIC, TILE_DISPLAY],
        ["Error Budget Remaining", ERROR_BUDGET_REMAINING_METRIC, TILE_DISPLAY],
        ["Burn Rate", BURN_RATE_METRIC, TILE_DISPLAY],
        ["SLI Over Time", SLI_METRIC, CHART_DISPLAY],
        [
          "Error Budget Remaining Over Time",
          ERROR_BUDGET_REMAINING_METRIC,
          CHART_DISPLAY,
        ],
        ["Burn Rate Over Time", BURN_RATE_METRIC, CHART_DISPLAY],
      ];

      for (const [title, metric, display] of expected) {
        const args: WidgetArguments = argumentsOf(findWidget(config, title));

        expect(`${title} -> ${String(args["sloMetric"])}`).toBe(
          `${title} -> ${metric}`,
        );
        expect(`${title} -> ${String(args["displayType"])}`).toBe(
          `${title} -> ${display}`,
        );
      }

      // Nothing beyond that table is on the dashboard.
      expect(sloWidgets(config)).toHaveLength(expected.length);
    });

    /*
     * The titles themselves are the contract the table above is written
     * against, so assert the set independently: a renamed widget must fail
     * here rather than silently making the table above vacuous.
     */
    it("ships exactly the six SLO widget titles the template documents", () => {
      expect(sloWidgets(getConfig()).map(titleOf).sort()).toEqual(
        [
          "SLI",
          "Error Budget Remaining",
          "Burn Rate",
          "SLI Over Time",
          "Error Budget Remaining Over Time",
          "Burn Rate Over Time",
        ].sort(),
      );
    });

    /*
     * Every member of SloWidgetMetric, not just the three we happen to
     * have written above: a fourth number added to the widget should show
     * up on the template that exists to report SLO numbers, and this fails
     * when it does not.
     */
    it("leaves none of the widget's supported metrics off the dashboard", () => {
      const metrics: Set<string> = new Set<string>(
        sloWidgets(getConfig()).map(
          (component: DashboardBaseComponent): string => {
            return String(argumentsOf(component)["sloMetric"]);
          },
        ),
      );

      for (const metric of Object.values(SloWidgetMetric)) {
        expect(`${metric} on the dashboard: ${metrics.has(metric)}`).toBe(
          `${metric} on the dashboard: true`,
        );
      }
    });

    /*
     * A template cannot know which of a project's SLOs a reader means, and
     * an id baked into a shipped template would point at nothing in every
     * project but the one it was copied from. The widget's own setup state
     * ("Click to select an SLO") is the intended first render.
     */
    it("ships every SLO widget unconfigured, with no SLO id baked in", () => {
      const configured: Array<string> = [];

      for (const component of sloWidgets(getConfig())) {
        if (argumentsOf(component)["serviceLevelObjectiveId"] !== undefined) {
          configured.push(titleOf(component));
        }
      }

      expect(configured).toEqual([]);
    });

    /*
     * Left untitled, the renderer names a widget "<SLO name> · <metric>",
     * which is nicer once an SLO is picked but leaves all six widgets
     * reading "SLO Widget" in a template the reader has just created and
     * cannot yet tell apart.
     */
    it("titles every SLO widget so an unconfigured dashboard still reads", () => {
      const widgets: Array<DashboardBaseComponent> = sloWidgets(getConfig());

      expect(widgets.length).toBeGreaterThan(0);

      for (const component of widgets) {
        const title: unknown = argumentsOf(component)["widgetTitle"];

        expect(typeof title).toBe("string");
        expect(String(title).trim().length).toBeGreaterThan(0);
      }
    });

    it("stores only real SloWidgetMetric and SloWidgetDisplayType values", () => {
      const validMetrics: Array<string> = Object.values(SloWidgetMetric);
      const validDisplays: Array<string> = Object.values(SloWidgetDisplayType);

      for (const component of sloWidgets(getConfig())) {
        const args: WidgetArguments = argumentsOf(component);
        const label: string = titleOf(component);
        const metric: string = String(args["sloMetric"]);
        const display: string = String(args["displayType"]);

        expect(`${label} metric=${metric}`).toBe(
          `${label} metric=${
            validMetrics.includes(metric) ? metric : "<not a SloWidgetMetric>"
          }`,
        );
        expect(`${label} display=${display}`).toBe(
          `${label} display=${
            validDisplays.includes(display)
              ? display
              : "<not a SloWidgetDisplayType>"
          }`,
        );
      }
    });

    /*
     * The enum values are persisted verbatim into the dashboard's JSON
     * config. Renaming one compiles everywhere and silently blanks every
     * saved widget, so both directions are pinned.
     */
    it("pins the persisted metric and display strings", () => {
      expect(SloWidgetMetric.Sli).toBe(SLI_METRIC);
      expect(SloWidgetMetric.ErrorBudgetRemaining).toBe(
        ERROR_BUDGET_REMAINING_METRIC,
      );
      expect(SloWidgetMetric.BurnRate).toBe(BURN_RATE_METRIC);
      expect(SloWidgetDisplayType.Tile).toBe(TILE_DISPLAY);
      expect(SloWidgetDisplayType.Chart).toBe(CHART_DISPLAY);
      expect(DashboardComponentType.Slo).toBe("Slo");
    });

    it("declares the same minimum footprint the widget's own default does", () => {
      for (const component of sloWidgets(getConfig())) {
        expect(component.minWidthInDashboardUnits).toBe(2);
        expect(component.minHeightInDashboardUnits).toBe(2);
      }
    });

    /*
     * A tile renders a big number, a status pill and a subline; a chart
     * renders a time series under a title row. Both need more than the
     * 2x2 floor to be legible, and the charts need the extra width a
     * series needs to be readable at all.
     */
    it("gives the charts a wider tile than the single-number tiles", () => {
      const config: DashboardViewConfig = getConfig();
      const tiles: Array<DashboardBaseComponent> = sloWidgets(config).filter(
        (component: DashboardBaseComponent): boolean => {
          return argumentsOf(component)["displayType"] === TILE_DISPLAY;
        },
      );
      const charts: Array<DashboardBaseComponent> = sloWidgets(config).filter(
        (component: DashboardBaseComponent): boolean => {
          return argumentsOf(component)["displayType"] === CHART_DISPLAY;
        },
      );

      expect(tiles.length).toBeGreaterThan(0);
      expect(charts.length).toBeGreaterThan(0);

      for (const tile of tiles) {
        expect(tile.widthInDashboardUnits).toBeGreaterThanOrEqual(3);
        expect(tile.heightInDashboardUnits).toBeGreaterThanOrEqual(3);
      }

      for (const chart of charts) {
        expect(chart.widthInDashboardUnits).toBeGreaterThanOrEqual(6);
        expect(chart.heightInDashboardUnits).toBeGreaterThanOrEqual(4);
      }
    });

    /*
     * Dashboard variables never reach the Slo widget — it resolves one SLO
     * from its stored id and has nothing to interpolate. A widget that
     * carried a metric query would be read by the metric fetch layer and
     * scoped by the Monitor variable, which is not what it reports on.
     */
    it("carries no metric query on any SLO widget", () => {
      for (const component of sloWidgets(getConfig())) {
        expect(argumentsOf(component)["metricQueryConfig"]).toBeUndefined();
        expect(metricNameOf(component)).toBeUndefined();
      }
    });

    it("reads the objective before the trend: tiles sit above the charts", () => {
      const config: DashboardViewConfig = getConfig();
      const lowestTileEdge: number = Math.max(
        ...sloWidgets(config)
          .filter((component: DashboardBaseComponent): boolean => {
            return argumentsOf(component)["displayType"] === TILE_DISPLAY;
          })
          .map((component: DashboardBaseComponent): number => {
            return (
              component.topInDashboardUnits + component.heightInDashboardUnits
            );
          }),
      );
      const highestChartTop: number = Math.min(
        ...sloWidgets(config)
          .filter((component: DashboardBaseComponent): boolean => {
            return argumentsOf(component)["displayType"] === CHART_DISPLAY;
          })
          .map((component: DashboardBaseComponent): number => {
            return component.topInDashboardUnits;
          }),
      );

      expect(highestChartTop).toBeGreaterThanOrEqual(lowestTileEdge);
    });
  });

  describe("metric queries", () => {
    it("queries only the two monitor series that carry monitorName", () => {
      const config: DashboardViewConfig = getConfig();

      expect(metricNameOf(findWidget(config, "Monitor Uptime (avg)"))).toBe(
        IS_ONLINE_METRIC,
      );
      expect(metricNameOf(findWidget(config, "Avg Response Time"))).toBe(
        RESPONSE_TIME_METRIC,
      );
      expect(metricNameOf(findWidget(config, "Worst Response Time"))).toBe(
        RESPONSE_TIME_METRIC,
      );
      expect(metricNameOf(findWidget(config, "Monitor Uptime Over Time"))).toBe(
        IS_ONLINE_METRIC,
      );
      expect(metricNameOf(findWidget(config, "Response Time Over Time"))).toBe(
        RESPONSE_TIME_METRIC,
      );

      const metrics: Array<string> = [];

      for (const component of config.components) {
        const metric: string | undefined = metricNameOf(component);

        if (metric) {
          metrics.push(metric);
        }
      }

      expect(metrics.length).toBeGreaterThan(0);
      expect(Array.from(new Set(metrics)).sort()).toEqual(
        [IS_ONLINE_METRIC, RESPONSE_TIME_METRIC].sort(),
      );
    });

    /*
     * THE invariant of this template's second half, and it holds for the
     * two families for DIFFERENT reasons.
     *
     * IncidentService stamps its metrics with `monitorNames` (plural,
     * comma-joined) and never the singular key, so picking a monitor in
     * this template's variable empties every incident tile while the
     * uptime tile beside it stays populated — two widgets side by side
     * disagreeing about what is selected.
     *
     * AlertService DOES write the singular `monitorName`, so alert metrics
     * scope correctly for any monitor-attached alert. They are excluded
     * anyway: createBurnRateAlert never sets a monitor, so the burn-rate
     * alerts this dashboard exists for carry no `monitorName` and would be
     * the rows a scoped tile dropped.
     *
     * The incident and alert LISTS read Postgres and are immune to
     * telemetry variables, which is why they are the form those signals
     * take here.
     */
    it("carries no incident or alert metric, which the Monitor variable would empty", () => {
      const offenders: Array<string> = [];

      for (const component of getConfig().components) {
        const metric: string | undefined = metricNameOf(component);

        if (metric && MONITOR_VARIABLE_HOSTILE_METRICS.includes(metric)) {
          offenders.push(`${titleOf(component)} -> ${metric}`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it("picks the aggregation that makes each number mean what its title says", () => {
      const config: DashboardViewConfig = getConfig();

      for (const title of [
        "Monitor Uptime (avg)",
        "Avg Response Time",
        "Monitor Uptime Over Time",
        "Response Time Over Time",
      ]) {
        expect(aggregationOf(findWidget(config, title))).toBe(AVG_AGGREGATION);
      }

      expect(aggregationOf(findWidget(config, "Worst Response Time"))).toBe(
        MAX_AGGREGATION,
      );
    });

    /*
     * IsOnline is emitted as 0/1 with unit "", so Avg is a RATIO in [0, 1]
     * and not a percent. A widget labelled with a "%" would print "0.99%"
     * for a service that was up all window.
     */
    it("labels the uptime widgets as an average rather than as a percentage", () => {
      const config: DashboardViewConfig = getConfig();

      /*
       * Read the titles out of the CONFIG. Looping over a local array of
       * string literals and asserting those literals lack a "%" is a
       * tautology: it tests the test.
       */
      const uptimeWidgetTitles: Array<string> = config.components
        .filter((component: DashboardBaseComponent): boolean => {
          return metricNameOf(component) === IS_ONLINE_METRIC;
        })
        .map(titleOf);

      expect(uptimeWidgetTitles.length).toBeGreaterThan(0);

      for (const title of uptimeWidgetTitles) {
        expect(`${title} contains %: ${title.includes("%")}`).toBe(
          `${title} contains %: false`,
        );
        // "(avg)" or "Over Time" — either way it must not read as a percent.
        expect(title.trim().length).toBeGreaterThan(0);
      }

      // The single-number tile has to say it is an average outright.
      expect(titleOf(findWidget(config, "Monitor Uptime (avg)"))).toContain(
        "(avg)",
      );
    });

    /*
     * Nothing anywhere on the dashboard may promise a percentage, because
     * the only percentage-valued numbers here (SLI, error budget) are
     * rendered by the Slo widget, which formats its own units. A metric
     * widget titled with a "%" would be claiming a unit its series does
     * not carry.
     */
    it("puts no percent sign in any metric widget's title", () => {
      const offenders: Array<string> = [];

      for (const component of getConfig().components) {
        if (metricNameOf(component) && titleOf(component).includes("%")) {
          offenders.push(titleOf(component));
        }
      }

      expect(offenders).toEqual([]);
    });

    it("marks each tile so its trend arrow is colored the right way", () => {
      const config: DashboardViewConfig = getConfig();

      expect(
        argumentsOf(findWidget(config, "Monitor Uptime (avg)"))[
          "trendDirection"
        ],
      ).toBe(DashboardValueTrendDirection.HigherIsBetter);

      for (const title of ["Avg Response Time", "Worst Response Time"]) {
        expect(argumentsOf(findWidget(config, title))["trendDirection"]).toBe(
          DashboardValueTrendDirection.HigherIsWorse,
        );
      }
    });

    it("stores its aggregation under the misspelled key the fetch layer reads", () => {
      const config: DashboardViewConfig = getConfig();
      let metricWidgets: number = 0;

      for (const component of config.components) {
        if (!metricNameOf(component)) {
          continue;
        }

        metricWidgets++;

        expect(typeof aggregationOf(component)).toBe("string");
        expect(
          Object.prototype.hasOwnProperty.call(
            filterDataOf(component),
            "aggregationType",
          ),
        ).toBe(false);
      }

      expect(metricWidgets).toBeGreaterThan(0);
    });

    /*
     * A dashboard that prints the same figure under two names is a smaller
     * dashboard pretending to be a bigger one. A number paired with its
     * own trend chart is fine — that is a different widget family, not a
     * repeat — so the check is on (family, metric, aggregation).
     */
    it("never prints the same metric and aggregation twice in the same widget family", () => {
      const seen: Map<string, string> = new Map<string, string>();
      const duplicates: Array<string> = [];

      for (const component of getConfig().components) {
        const metric: string | undefined = metricNameOf(component);

        if (!metric) {
          continue;
        }

        const key: string = `${component.componentType}|${metric}|${String(
          aggregationOf(component),
        )}`;
        const existing: string | undefined = seen.get(key);

        if (existing) {
          duplicates.push(
            `${key} on "${existing}" and "${titleOf(component)}"`,
          );
        }

        seen.set(key, titleOf(component));
      }

      expect(duplicates).toEqual([]);
    });

    it("gives every widget on the dashboard a distinct, non-empty title", () => {
      const titles: Array<string> = getConfig().components.map(titleOf);

      expect(
        titles.every((title: string): boolean => {
          return title.trim().length > 0;
        }),
      ).toBe(true);
      expect(new Set(titles).size).toBe(titles.length);
    });
  });

  describe("the entity lists", () => {
    /*
     * An error budget is spent by downtime, and downtime is what incidents
     * and alerts record. These three read Postgres rather than the metric
     * store, so unlike a metric tile they stay correct whatever the
     * Monitor variable is set to.
     */
    it("puts exactly one monitor, incident and alert list on the dashboard", () => {
      const config: DashboardViewConfig = getConfig();

      expect(
        componentsOfType(config, DashboardComponentType.MonitorList),
      ).toHaveLength(1);
      expect(
        componentsOfType(config, DashboardComponentType.IncidentList),
      ).toHaveLength(1);
      expect(
        componentsOfType(config, DashboardComponentType.AlertList),
      ).toHaveLength(1);
    });

    it("renders each list as a list and caps its rows at a positive whole number", () => {
      const config: DashboardViewConfig = getConfig();

      for (const title of [
        "All Monitors",
        "Latest Incidents",
        "Latest Alerts",
      ]) {
        const args: WidgetArguments = argumentsOf(findWidget(config, title));

        expect(args["viewMode"]).toBe("list");
        expect(typeof args["maxRows"]).toBe("number");
        expect(Number.isInteger(args["maxRows"] as number)).toBe(true);
        expect(args["maxRows"] as number).toBeGreaterThan(0);
      }
    });

    /*
     * Both lists sort newest first, so an unfiltered list is the record of
     * what the budget was spent on — open and recently resolved alike.
     * Pre-filtering to "unresolved" would hide every incident that has
     * already been closed, which is most of the budget.
     */
    it("does not pre-filter the incident or alert list to a lifecycle state", () => {
      const config: DashboardViewConfig = getConfig();

      for (const title of ["Latest Incidents", "Latest Alerts"]) {
        expect(
          argumentsOf(findWidget(config, title))["stateFilter"],
        ).toBeUndefined();
      }
    });

    /*
     * Which monitors back an objective is a per-project question, so the
     * list opens on all of them; the reader narrows it with the widget's
     * own Labels filter.
     */
    it("does not pin the monitor list to a monitor type or status", () => {
      const args: WidgetArguments = argumentsOf(
        findWidget(getConfig(), "All Monitors"),
      );

      expect(args["monitorTypes"]).toBeUndefined();
      expect(args["statusFilter"]).toBeUndefined();
    });
  });

  describe("variables", () => {
    /*
     * The uptime and response-time widgets query series every probeable
     * monitor in the project emits. Unscoped they describe the project,
     * not the objective — this variable is what scopes them.
     */
    it("ships one multi-select Monitor picker", () => {
      const variables: Array<DashboardVariable> = getConfig().variables || [];

      expect(
        variables.map((variable: DashboardVariable): string => {
          return variable.name;
        }),
      ).toEqual(["monitor"]);

      const variable: DashboardVariable = variables[0] as DashboardVariable;

      expect(variable.type).toBe(DashboardVariableType.TelemetryAttribute);
      // An objective is normally backed by several monitors, not one.
      expect(variable.isMultiSelect).toBe(true);
      expect((variable.label || "").trim().length).toBeGreaterThan(0);
    });

    /*
     * Monitor metrics carry a BARE attribute key — see
     * MonitorMetricUtil.buildAttributes. A variable bound to
     * `resource.monitorName` would compile and offer an empty picker, and
     * one bound to the incident metrics' `monitorNames` would filter the
     * uptime widgets against a key they do not carry.
     */
    it("binds to the bare monitorName key, not a prefixed or plural one", () => {
      const variable: DashboardVariable = (getConfig().variables ||
        [])[0] as DashboardVariable;

      expect(variable.attributeKey).toBe(MONITOR_ATTRIBUTE);
      expect(variable.attributeKey).not.toBe("monitorNames");
      expect(variable.attributeKey).not.toBe("resource.monitorName");
    });

    /*
     * A multi-select resolves from its picks alone and starts with none,
     * so it opens on "All" and a default would never apply — the widgets
     * would look scoped behind a control reading "unfiltered".
     */
    it("leaves the multi-select variable without a default", () => {
      const variable: DashboardVariable = (getConfig().variables ||
        [])[0] as DashboardVariable;

      expect(variable.defaultValue ?? "").toBe("");
    });
  });

  describe("layout", () => {
    it("lays every widget out inside the 12-unit grid", () => {
      for (const component of getConfig().components) {
        expect(component.leftInDashboardUnits).toBeGreaterThanOrEqual(0);
        expect(component.topInDashboardUnits).toBeGreaterThanOrEqual(0);
        expect(component.widthInDashboardUnits).toBeGreaterThan(0);
        expect(component.heightInDashboardUnits).toBeGreaterThan(0);
        expect(
          component.leftInDashboardUnits + component.widthInDashboardUnits,
        ).toBeLessThanOrEqual(GRID_WIDTH_IN_UNITS);
      }
    });

    it("places no two widgets on the same grid cell", () => {
      const occupied: Map<string, string> = new Map<string, string>();
      const collisions: Array<string> = [];

      for (const component of getConfig().components) {
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
            const existing: string | undefined = occupied.get(cell);

            if (existing) {
              collisions.push(
                `cell ${cell} shared by "${existing}" and "${titleOf(component)}"`,
              );
            }

            occupied.set(cell, titleOf(component));
          }
        }
      }

      expect(collisions).toEqual([]);
    });

    /*
     * A band of empty rows in the middle of a template reads as a widget
     * that failed to render rather than as whitespace.
     */
    it("leaves no empty row between the title and the last widget", () => {
      const config: DashboardViewConfig = getConfig();
      const occupiedRows: Set<number> = new Set<number>();

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

      const emptyRows: Array<number> = [];

      for (let row: number = 0; row < lowestOccupiedEdge(config); row++) {
        if (!occupiedRows.has(row)) {
          emptyRows.push(row);
        }
      }

      expect(emptyRows).toEqual([]);
    });

    it("is tall enough to contain everything on it", () => {
      const config: DashboardViewConfig = getConfig();

      expect(config.heightInDashboardUnits).toBeGreaterThanOrEqual(
        lowestOccupiedEdge(config),
      );
    });

    it("renders no widget smaller than the minimum it declares", () => {
      for (const component of getConfig().components) {
        expect(component.widthInDashboardUnits).toBeGreaterThanOrEqual(
          component.minWidthInDashboardUnits,
        );
        expect(component.heightInDashboardUnits).toBeGreaterThanOrEqual(
          component.minHeightInDashboardUnits,
        );
      }
    });

    it("opens with a bold title row across the full width", () => {
      const title: DashboardBaseComponent = findWidget(
        getConfig(),
        "SLO Dashboard",
      );

      expect(title.componentType).toBe(DashboardComponentType.Text);
      expect(title.topInDashboardUnits).toBe(0);
      expect(title.leftInDashboardUnits).toBe(0);
      expect(title.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
      expect(argumentsOf(title)["isBold"]).toBe(true);
    });

    /*
     * Rows are asserted, not just boldness: a header that does not sit
     * immediately above the band it names labels the wrong widgets, and
     * checking only componentType/width/isBold cannot see that.
     */
    it("labels each band with its own bold section header, on the right row", () => {
      const config: DashboardViewConfig = getConfig();

      const headers: Array<[string, number]> = [
        ["Objective Health", 2],
        ["Error Budget Trends", 6],
        ["Monitor Health", 15],
      ];

      for (const [heading, expectedTop] of headers) {
        const header: DashboardBaseComponent = findWidget(config, heading);

        expect(header.componentType).toBe(DashboardComponentType.Text);
        expect(header.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
        expect(header.leftInDashboardUnits).toBe(0);
        expect(header.heightInDashboardUnits).toBe(1);
        expect(argumentsOf(header)["isBold"]).toBe(true);
        expect(`${heading} top=${header.topInDashboardUnits}`).toBe(
          `${heading} top=${expectedTop}`,
        );

        /*
         * Something must actually start on the row directly below the
         * header, or it heads an empty band.
         */
        const bandStarts: Array<DashboardBaseComponent> =
          config.components.filter(
            (component: DashboardBaseComponent): boolean => {
              return component.topInDashboardUnits === expectedTop + 1;
            },
          );

        expect(`${heading} band widgets=${bandStarts.length > 0}`).toBe(
          `${heading} band widgets=true`,
        );
      }

      // Headers are in reading order, top to bottom.
      const tops: Array<number> = headers.map(
        ([heading]: [string, number]): number => {
          return findWidget(config, heading).topInDashboardUnits;
        },
      );

      expect(tops).toEqual(
        tops.slice().sort((a: number, b: number): number => {
          return a - b;
        }),
      );
    });

    /*
     * Every Slo widget on this template is inert until somebody picks an
     * objective, which no other template has to explain. One guidance row
     * says it once, directly under the title, instead of leaving six
     * identical setup placeholders to explain themselves.
     */
    it("carries exactly one non-bold guidance row, directly under the title", () => {
      const config: DashboardViewConfig = getConfig();
      const guidance: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Text,
      ).filter((component: DashboardBaseComponent): boolean => {
        return argumentsOf(component)["isBold"] !== true;
      });

      expect(guidance).toHaveLength(1);

      const row: DashboardBaseComponent = guidance[0] as DashboardBaseComponent;

      expect(row.topInDashboardUnits).toBe(1);
      expect(row.leftInDashboardUnits).toBe(0);
      expect(row.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
      const text: string = titleOf(row);

      expect(text.trim().length).toBeGreaterThan(0);

      /*
       * It must name the SLO widgets it is about, and the EDIT step. The
       * widgets' own placeholder says "Click to select an SLO", but that
       * click only opens the settings panel in edit mode — and a dashboard
       * created from a template opens in view mode, where following the
       * instruction does nothing. A guidance row that repeats "click"
       * without naming edit sends the reader down a dead end.
       */
      expect(`guidance names SLO: ${text.includes("SLO")}`).toBe(
        "guidance names SLO: true",
      );
      expect(
        `guidance names edit: ${text.toLowerCase().includes("edit")}`,
      ).toBe("guidance names edit: true");

      /*
       * The Text widget scales its font to the widget's height, so a long
       * sentence wraps out of a height-1 row and is clipped. Keep it short
       * enough to render on one line at full width.
       */
      expect(`guidance length ${text.length} <= 80`).toBe(
        `guidance length ${Math.min(text.length, 80)} <= 80`,
      );
    });

    /*
     * The objective is the subject of this dashboard; the monitors,
     * incidents and alerts are the explanation. Putting a monitor tile
     * above the SLI would make it a monitor dashboard with an SLO on it.
     */
    it("puts the objective above everything that explains it", () => {
      const config: DashboardViewConfig = getConfig();
      const lowestSloEdge: number = Math.max(
        ...sloWidgets(config).map(
          (component: DashboardBaseComponent): number => {
            return (
              component.topInDashboardUnits + component.heightInDashboardUnits
            );
          },
        ),
      );

      for (const title of [
        "Monitor Uptime (avg)",
        "Avg Response Time",
        "Worst Response Time",
        "Monitor Uptime Over Time",
        "Response Time Over Time",
        "All Monitors",
        "Latest Alerts",
      ]) {
        expect(
          `${title} top=${findWidget(config, title).topInDashboardUnits} >= ${lowestSloEdge}`,
        ).toBe(
          `${title} top=${Math.max(
            findWidget(config, title).topInDashboardUnits,
            lowestSloEdge,
          )} >= ${lowestSloEdge}`,
        );
      }
    });

    /*
     * A burn-rate rule declares an incident when the budget starts going
     * fast, so the spike and the record of what was done about it belong
     * on the same row.
     */
    it("sets the incident list beside the burn rate chart", () => {
      const config: DashboardViewConfig = getConfig();
      const burnRateChart: DashboardBaseComponent = findWidget(
        config,
        "Burn Rate Over Time",
      );
      const incidents: DashboardBaseComponent = findWidget(
        config,
        "Latest Incidents",
      );

      expect(incidents.topInDashboardUnits).toBe(
        burnRateChart.topInDashboardUnits,
      );
      expect(incidents.leftInDashboardUnits).toBe(
        burnRateChart.leftInDashboardUnits +
          burnRateChart.widthInDashboardUnits,
      );
    });

    it("picks a chart shape that suits each monitor series", () => {
      const config: DashboardViewConfig = getConfig();

      // A filled area for a ratio that should read as coverage...
      expect(
        argumentsOf(findWidget(config, "Monitor Uptime Over Time"))[
          "chartType"
        ],
      ).toBe(DashboardChartType.Area);
      // ...and a line for a latency series read against its own history.
      expect(
        argumentsOf(findWidget(config, "Response Time Over Time"))["chartType"],
      ).toBe(DashboardChartType.Line);
    });
  });

  describe("freshness", () => {
    /*
     * Two dashboards created from this template must not share component
     * or variable ids — they are independent saved rows from the moment
     * they are created.
     */
    it("generates fresh component and variable ids on every call", () => {
      const first: DashboardViewConfig = getConfig();
      const second: DashboardViewConfig = getConfig();

      expect(second.components.length).toBe(first.components.length);

      const firstComponentIds: Set<string> = new Set<string>(
        first.components.map((component: DashboardBaseComponent): string => {
          return component.componentId.toString();
        }),
      );
      for (const component of second.components) {
        expect(firstComponentIds.has(component.componentId.toString())).toBe(
          false,
        );
      }

      const firstVariableIds: Set<string> = new Set<string>(
        (first.variables || []).map((variable: DashboardVariable): string => {
          return variable.id;
        }),
      );
      for (const variable of second.variables || []) {
        expect(firstVariableIds.has(variable.id)).toBe(false);
      }
    });

    it("returns the same widget set on every call", () => {
      const first: DashboardViewConfig = getConfig();
      const second: DashboardViewConfig = getConfig();

      expect(second.components.map(titleOf)).toEqual(
        first.components.map(titleOf),
      );
      expect(second.heightInDashboardUnits).toBe(first.heightInDashboardUnits);
    });
  });
});
