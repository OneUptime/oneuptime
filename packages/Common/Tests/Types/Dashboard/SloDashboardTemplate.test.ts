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
  SLO_TEMPLATE_CHART_GROUP_BY_KEYS,
} from "../../../Types/Dashboard/DashboardTemplates";
import IconProp from "../../../Types/Icon/IconProp";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import SloMetricType from "../../../Types/ServiceLevelObjective/SloMetricType";
import DashboardSloComponentUtil from "../../../Utils/Dashboard/Components/DashboardSloComponent";
import DashboardSloListComponentUtil from "../../../Utils/Dashboard/Components/DashboardSloListComponent";
import {
  resolveSloWidgetSource,
  SloWidgetSourceState,
} from "../../../Utils/Dashboard/SloWidgetSource";
import {
  SLO_LIST_ATTRIBUTE_TO_COLUMN,
  SLO_LIST_DEFAULT_MAX_ROWS,
} from "../../../Utils/Slo/SloListWidgetFormat";
import SloMetricTypeUtil, {
  SLO_METRIC_SLO_NAME_ATTRIBUTE,
} from "../../../Utils/Slo/SloMetricType";
import { describe, expect, it } from "@jest/globals";

/*
 * Editorial invariants for the SLO template specifically. The structural rules
 * every template must satisfy (grid bounds, overlap, unique ids, aggregation
 * spelling) live in DashboardTemplateInvariants and the reading rules in
 * DashboardTemplateEditorialInvariants — this file pins what makes THIS the SLO
 * dashboard:
 *
 *   - it opens on the fleet and is useful with zero configuration,
 *   - one toolbar variable scopes every section,
 *   - the per-SLO widgets follow that variable instead of waiting for edit
 *     mode, so the template carries no instruction row and no inert widget,
 *   - and nothing on it is project-wide data presented beside an objective.
 */

/*
 * Persisted strings, pinned as literals rather than enum members: they are
 * written verbatim into every saved dashboard and every metric row, so a
 * renamed VALUE must fail here instead of silently blanking saved widgets.
 */
const SLI_METRIC: string = "Sli";
const ERROR_BUDGET_REMAINING_METRIC: string = "ErrorBudgetRemaining";
const BURN_RATE_METRIC: string = "BurnRate";
const TILE_DISPLAY: string = "Tile";
const CHART_DISPLAY: string = "Chart";

const BUDGET_PERCENT_SERIES: string =
  "oneuptime.slo.error.budget.remaining.percent";
const BUDGET_SECONDS_SERIES: string =
  "oneuptime.slo.error.budget.remaining.seconds";
const BURN_RATE_SERIES: string = "oneuptime.slo.burn.rate";

/*
 * The bare attribute key SloMetricUtil stamps on every `oneuptime.slo.*` row.
 * A `resource.`-prefixed key would compile and offer an empty picker.
 */
const SLO_NAME_ATTRIBUTE: string = "sloName";

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
 * titles are the only stable handle: ids regenerate on every call and array
 * positions move whenever a row is inserted.
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

  expect(`${title}: ${matches.length} widget(s)`).toBe(`${title}: 1 widget(s)`);
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

function queryDataOf(component: DashboardBaseComponent): WidgetArguments {
  const queryConfig: WidgetArguments =
    (argumentsOf(component)["metricQueryConfig"] as
      | WidgetArguments
      | undefined) || {};

  return (queryConfig["metricQueryData"] as WidgetArguments | undefined) || {};
}

function filterDataOf(component: DashboardBaseComponent): WidgetArguments {
  return (
    (queryDataOf(component)["filterData"] as WidgetArguments | undefined) || {}
  );
}

function aliasDataOf(component: DashboardBaseComponent): WidgetArguments {
  const queryConfig: WidgetArguments =
    (argumentsOf(component)["metricQueryConfig"] as
      | WidgetArguments
      | undefined) || {};

  return (queryConfig["metricAliasData"] as WidgetArguments | undefined) || {};
}

function metricNameOf(component: DashboardBaseComponent): string | undefined {
  const value: unknown = filterDataOf(component)["metricName"];
  return typeof value === "string" ? value : undefined;
}

// The MISSPELLED key is what the fetch layer reads, so it is the contract.
function aggregationOf(component: DashboardBaseComponent): unknown {
  return filterDataOf(component)["aggegationType"];
}

function metricWidgets(
  config: DashboardViewConfig,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return metricNameOf(component) !== undefined;
    },
  );
}

function lowestOccupiedEdge(config: DashboardViewConfig): number {
  return Math.max(
    ...config.components.map((component: DashboardBaseComponent): number => {
      return component.topInDashboardUnits + component.heightInDashboardUnits;
    }),
  );
}

function onlyVariable(config: DashboardViewConfig): DashboardVariable {
  const variables: Array<DashboardVariable> = config.variables || [];

  expect(variables).toHaveLength(1);
  return variables[0] as DashboardVariable;
}

// A one-line layout record, so a moved widget reads as a plain diff.
function placementOf(component: DashboardBaseComponent): string {
  return `${component.componentType} "${titleOf(component)}" @ row ${component.topInDashboardUnits}, col ${component.leftInDashboardUnits}, ${component.widthInDashboardUnits}x${component.heightInDashboardUnits}`;
}

// -- Tests -----------------------------------------------------------------

describe("SLO dashboard template", () => {
  describe("catalog entry", () => {
    it("is registered exactly once", () => {
      expect(
        DashboardTemplates.filter((template: DashboardTemplate): boolean => {
          return template.type === DashboardTemplateType.Slo;
        }),
      ).toHaveLength(1);
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
      expect(
        getDashboardTemplatesByCategory(DashboardTemplateCategory.Monitoring),
      ).toContain(entry);
    });

    /*
     * The card is the whole of what the modal tells a reader. It used to end
     * "Pick the SLO on each widget after creating it" — a chore. It must now
     * describe a dashboard that works on creation and is scoped from the
     * toolbar, and must not promise the monitor, incident or alert widgets the
     * template no longer carries.
     */
    it("describes the fleet view and the toolbar, and promises nothing the template does not ship", () => {
      const description: string = (
        DashboardTemplates.find((template: DashboardTemplate): boolean => {
          return template.type === DashboardTemplateType.Slo;
        }) as DashboardTemplate
      ).description;

      expect(description).toContain("Every SLO");
      expect(description).toContain("toolbar");

      for (const stale of [
        "monitor",
        "incident",
        "alert",
        "Pick the SLO on each widget",
      ]) {
        expect(
          `description mentions "${stale}": ${description.toLowerCase().includes(stale.toLowerCase())}`,
        ).toBe(`description mentions "${stale}": false`);
      }
    });

    it("uses the persisted enum value 'Slo'", () => {
      expect(DashboardTemplateType.Slo).toBe("Slo");
    });
  });

  describe("layout", () => {
    /*
     * The whole board as one table. Each row of the table is a placement; a
     * widget that moves, resizes, changes type or is renamed fails here with
     * a readable diff, and the per-section tests below say WHY each placement
     * is what it is.
     */
    it("lays the dashboard out exactly as designed", () => {
      expect(getConfig().components.map(placementOf)).toEqual([
        'Text "SLO Dashboard" @ row 0, col 0, 12x1',
        'SloList "Service Level Objectives" @ row 1, col 0, 12x5',
        'Text "Error Budget & Burn Rate" @ row 6, col 0, 12x1',
        'Value "Lowest Error Budget Remaining" @ row 7, col 0, 4x1',
        'Value "Least Error Budget Time Left" @ row 7, col 4, 4x1',
        'Value "Peak Burn Rate" @ row 7, col 8, 4x1',
        'Chart "Error Budget Remaining by SLO" @ row 8, col 0, 6x4',
        'Chart "Burn Rate by SLO" @ row 8, col 6, 6x4',
        'Text "Selected SLO" @ row 12, col 0, 12x1',
        'Slo "SLI" @ row 13, col 0, 4x3',
        'Slo "Error Budget Remaining" @ row 13, col 4, 4x3',
        'Slo "Burn Rate" @ row 13, col 8, 4x3',
        'Slo "SLI History" @ row 16, col 0, 4x4',
        'Slo "Error Budget History" @ row 16, col 4, 4x4',
        'Slo "Burn Rate History" @ row 16, col 8, 4x4',
      ]);
    });

    it("keeps every widget inside the 12-unit grid", () => {
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
     * Stronger than "no empty row": every row of the board is covered edge to
     * edge. A ragged row — two tiles and a gap — reads as a widget that failed
     * to render, which is exactly what a half-edited template leaves behind.
     */
    it("fills every row of the grid edge to edge, with no holes", () => {
      const config: DashboardViewConfig = getConfig();
      const covered: Set<string> = new Set<string>();

      for (const component of config.components) {
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
            covered.add(`${row}:${column}`);
          }
        }
      }

      const holes: Array<string> = [];

      for (let row: number = 0; row < lowestOccupiedEdge(config); row++) {
        for (let column: number = 0; column < GRID_WIDTH_IN_UNITS; column++) {
          if (!covered.has(`${row}:${column}`)) {
            holes.push(`${row}:${column}`);
          }
        }
      }

      expect(holes).toEqual([]);
    });

    it("is exactly as tall as its content", () => {
      const config: DashboardViewConfig = getConfig();

      expect(config.heightInDashboardUnits).toBeGreaterThanOrEqual(
        lowestOccupiedEdge(config),
      );
      expect(lowestOccupiedEdge(config)).toBe(20);
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

    it("opens with a bold, full-width title row", () => {
      const title: DashboardBaseComponent = findWidget(
        getConfig(),
        "SLO Dashboard",
      );

      expect(title.componentType).toBe(DashboardComponentType.Text);
      expect(title.topInDashboardUnits).toBe(0);
      expect(title.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
      expect(argumentsOf(title)["isBold"]).toBe(true);
    });

    /*
     * Like the Monitor and Kubernetes templates, the board opens on its
     * headline band directly under the title. The SLO List card carries its
     * own title, so a section heading above it would stack three titles on
     * one card.
     */
    it("opens on the fleet list directly under the title, with no heading between them", () => {
      const config: DashboardViewConfig = getConfig();
      const title: DashboardBaseComponent = findWidget(config, "SLO Dashboard");
      const list: DashboardBaseComponent = findWidget(
        config,
        "Service Level Objectives",
      );

      expect(list.topInDashboardUnits).toBe(
        title.topInDashboardUnits + title.heightInDashboardUnits,
      );

      const headingsAboveTheList: Array<string> = componentsOfType(
        config,
        DashboardComponentType.Text,
      )
        .filter((component: DashboardBaseComponent): boolean => {
          return (
            component !== title &&
            component.topInDashboardUnits < list.topInDashboardUnits
          );
        })
        .map(titleOf);

      expect(headingsAboveTheList).toEqual([]);
    });

    /*
     * The reading order of the whole product: the fleet, how its budget is
     * being spent, then the one objective the reader picks. The budget band's
     * heading names burn rate too, because two of its widgets are burn rate.
     */
    it("labels its two sections in reading order, each directly above its band", () => {
      const config: DashboardViewConfig = getConfig();
      const headers: Array<[string, number]> = [
        ["Error Budget & Burn Rate", 6],
        ["Selected SLO", 12],
      ];

      expect(
        componentsOfType(config, DashboardComponentType.Text).map(titleOf),
      ).toEqual([
        "SLO Dashboard",
        ...headers.map((header: [string, number]): string => {
          return header[0];
        }),
      ]);

      for (const [heading, expectedTop] of headers) {
        const header: DashboardBaseComponent = findWidget(config, heading);

        expect(header.componentType).toBe(DashboardComponentType.Text);
        expect(header.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
        expect(header.heightInDashboardUnits).toBe(1);
        expect(argumentsOf(header)["isBold"]).toBe(true);
        expect(`${heading} top=${header.topInDashboardUnits}`).toBe(
          `${heading} top=${expectedTop}`,
        );
        expect(
          config.components.some(
            (component: DashboardBaseComponent): boolean => {
              return component.topInDashboardUnits === expectedTop + 1;
            },
          ),
        ).toBe(true);
      }
    });

    /*
     * The old template needed a non-bold "Edit this dashboard to pick an
     * objective on each SLO widget" row, because six widgets were inert until
     * edit mode. Every Text widget now is a heading: nothing on a freshly
     * created board needs explaining.
     */
    it("carries no instruction row — every Text widget is a bold heading", () => {
      const nonHeadings: Array<string> = componentsOfType(
        getConfig(),
        DashboardComponentType.Text,
      )
        .filter((component: DashboardBaseComponent): boolean => {
          return argumentsOf(component)["isBold"] !== true;
        })
        .map(titleOf);

      expect(nonHeadings).toEqual([]);
    });

    it("puts the fleet above the selected objective", () => {
      const config: DashboardViewConfig = getConfig();
      const selectedHeaderTop: number = findWidget(
        config,
        "Selected SLO",
      ).topInDashboardUnits;

      for (const component of [
        ...componentsOfType(config, DashboardComponentType.SloList),
        ...metricWidgets(config),
      ]) {
        expect(
          component.topInDashboardUnits + component.heightInDashboardUnits,
        ).toBeLessThanOrEqual(selectedHeaderTop);
      }

      for (const component of componentsOfType(
        config,
        DashboardComponentType.Slo,
      )) {
        expect(component.topInDashboardUnits).toBeGreaterThan(
          selectedHeaderTop,
        );
      }
    });

    /*
     * Each Selected SLO column reads "now, and how it got here": the tile's
     * history sits directly beneath it, at the same width.
     */
    it("stacks each tile's history directly beneath it", () => {
      const config: DashboardViewConfig = getConfig();
      const tiles: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      ).filter((component: DashboardBaseComponent): boolean => {
        return argumentsOf(component)["displayType"] === TILE_DISPLAY;
      });

      expect(tiles).toHaveLength(3);

      for (const tile of tiles) {
        const metric: unknown = argumentsOf(tile)["sloMetric"];
        const history: Array<DashboardBaseComponent> = componentsOfType(
          config,
          DashboardComponentType.Slo,
        ).filter((component: DashboardBaseComponent): boolean => {
          return (
            argumentsOf(component)["displayType"] === CHART_DISPLAY &&
            argumentsOf(component)["sloMetric"] === metric
          );
        });

        expect(history).toHaveLength(1);

        const chart: DashboardBaseComponent =
          history[0] as DashboardBaseComponent;

        expect(
          `${titleOf(tile)} -> ${titleOf(chart)}: left ${chart.leftInDashboardUnits}, width ${chart.widthInDashboardUnits}, top ${chart.topInDashboardUnits}`,
        ).toBe(
          `${titleOf(tile)} -> ${titleOf(chart)}: left ${tile.leftInDashboardUnits}, width ${tile.widthInDashboardUnits}, top ${tile.topInDashboardUnits + tile.heightInDashboardUnits}`,
        );
      }
    });

    it("gives every widget a distinct, non-empty title", () => {
      const titles: Array<string> = getConfig().components.map(titleOf);

      for (const title of titles) {
        expect(title.trim().length).toBeGreaterThan(0);
      }

      expect(new Set(titles).size).toBe(titles.length);
    });
  });

  describe("what is not on the template", () => {
    it("uses only the widget kinds that can be scoped to an objective", () => {
      const types: Set<string> = new Set<string>(
        getConfig().components.map(
          (component: DashboardBaseComponent): string => {
            return component.componentType;
          },
        ),
      );

      expect(Array.from(types).sort()).toEqual(
        [
          DashboardComponentType.Chart,
          DashboardComponentType.Slo,
          DashboardComponentType.SloList,
          DashboardComponentType.Text,
          DashboardComponentType.Value,
        ].sort(),
      );
    });

    /*
     * Project-wide lists beside an objective read as that objective's
     * incidents, alerts and monitors. None of them can be narrowed to an SLO,
     * so none of them belongs here.
     */
    it("ships no project-wide incident, alert or monitor list", () => {
      const config: DashboardViewConfig = getConfig();

      for (const listType of [
        DashboardComponentType.IncidentList,
        DashboardComponentType.AlertList,
        DashboardComponentType.MonitorList,
      ]) {
        expect(componentsOfType(config, listType)).toHaveLength(0);
      }
    });

    /*
     * Monitor series carry `monitorName` and incident / alert metrics their
     * own monitor keys — none carries `sloName`, so the SLO variable would
     * leave them showing the whole project under a toolbar naming one SLO.
     */
    it("queries no monitor, incident or alert series", () => {
      const foreignSeries: Array<string> = [
        ...Object.values(MonitorMetricType),
        ...Object.values(IncidentMetricType),
        ...Object.values(AlertMetricType),
      ];

      const offenders: Array<string> = [];

      for (const component of metricWidgets(getConfig())) {
        const metric: string = metricNameOf(component) as string;

        if (foreignSeries.includes(metric)) {
          offenders.push(`${titleOf(component)} -> ${metric}`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe("the Objectives list", () => {
    it("is one full-width SLO List of every active objective", () => {
      const lists: Array<DashboardBaseComponent> = componentsOfType(
        getConfig(),
        DashboardComponentType.SloList,
      );

      expect(lists).toHaveLength(1);

      const list: DashboardBaseComponent = lists[0] as DashboardBaseComponent;

      expect(titleOf(list)).toBe("Service Level Objectives");
      expect(list.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
    });

    /*
     * The fleet view has to show the fleet: a stored status or label filter
     * would hide objectives on a board the reader has not configured yet.
     */
    it("pre-filters nothing and caps its rows at the widget's own default", () => {
      const args: WidgetArguments = argumentsOf(
        findWidget(getConfig(), "Service Level Objectives"),
      );

      expect(args).toEqual({
        title: "Service Level Objectives",
        maxRows: SLO_LIST_DEFAULT_MAX_ROWS,
        viewMode: "list",
      });
    });

    it("declares the same floors the widget's own default does", () => {
      const list: DashboardBaseComponent = findWidget(
        getConfig(),
        "Service Level Objectives",
      );

      expect(list.minWidthInDashboardUnits).toBe(
        DashboardSloListComponentUtil.getDefaultComponent()
          .minWidthInDashboardUnits,
      );
      expect(list.minHeightInDashboardUnits).toBe(
        DashboardSloListComponentUtil.getDefaultComponent()
          .minHeightInDashboardUnits,
      );
    });
  });

  describe("the Error Budget row", () => {
    it("charts and totals exactly the designed series, with the designed aggregations", () => {
      expect(
        metricWidgets(getConfig()).map(
          (component: DashboardBaseComponent): string => {
            return `${component.componentType} "${titleOf(component)}": ${metricNameOf(
              component,
            )} ${String(aggregationOf(component))}`;
          },
        ),
      ).toEqual([
        `Value "Lowest Error Budget Remaining": ${BUDGET_PERCENT_SERIES} Min`,
        `Value "Least Error Budget Time Left": ${BUDGET_SECONDS_SERIES} Min`,
        `Value "Peak Burn Rate": ${BURN_RATE_SERIES} Max`,
        `Chart "Error Budget Remaining by SLO": ${BUDGET_PERCENT_SERIES} Avg`,
        `Chart "Burn Rate by SLO": ${BURN_RATE_SERIES} Max`,
      ]);
    });

    it("names every series through SloMetricType", () => {
      const known: Array<string> = Object.values(SloMetricType);

      for (const component of metricWidgets(getConfig())) {
        expect(known).toContain(metricNameOf(component) as string);
      }
    });

    /*
     * The fleet charts must aggregate each series the way the series is meant
     * to be read — the same table the SLO Metrics page and the MetricType
     * catalog use — so a burn-rate spike is a Max, never averaged away.
     */
    it("aggregates, labels and units each chart from SloMetricTypeUtil", () => {
      const charts: Array<DashboardBaseComponent> = componentsOfType(
        getConfig(),
        DashboardComponentType.Chart,
      );

      expect(charts.length).toBeGreaterThan(0);

      for (const chart of charts) {
        const metric: SloMetricType = metricNameOf(chart) as SloMetricType;
        const label: string = titleOf(chart);

        expect(`${label} aggregation=${String(aggregationOf(chart))}`).toBe(
          `${label} aggregation=${SloMetricTypeUtil.getAggregationType(metric)}`,
        );
        expect(`${label} legend=${String(aliasDataOf(chart)["legend"])}`).toBe(
          `${label} legend=${SloMetricTypeUtil.getLegend(metric)}`,
        );
        expect(
          `${label} legendUnit=${String(aliasDataOf(chart)["legendUnit"])}`,
        ).toBe(
          `${label} legendUnit=${SloMetricTypeUtil.getLegendUnit(metric)}`,
        );
      }
    });

    it("prints percent and multiplier units on the charts", () => {
      const config: DashboardViewConfig = getConfig();

      expect(
        aliasDataOf(findWidget(config, "Error Budget Remaining by SLO"))[
          "legendUnit"
        ],
      ).toBe("%");
      expect(
        aliasDataOf(findWidget(config, "Burn Rate by SLO"))["legendUnit"],
      ).toBe("x");
    });

    /*
     * The tiles read Min / Max, not the series' own Avg, because they must be
     * true in BOTH states of the toolbar: across the fleet an average of
     * several objectives' budgets is nobody's budget, while the lowest budget
     * and the peak burn are the numbers someone acts on.
     */
    it("totals the worst case, and says so in each title", () => {
      const config: DashboardViewConfig = getConfig();

      expect(
        aggregationOf(findWidget(config, "Lowest Error Budget Remaining")),
      ).toBe("Min");
      expect(
        aggregationOf(findWidget(config, "Least Error Budget Time Left")),
      ).toBe("Min");
      expect(aggregationOf(findWidget(config, "Peak Burn Rate"))).toBe("Max");
    });

    it("colours each tile's trend the right way round", () => {
      const config: DashboardViewConfig = getConfig();

      expect(
        argumentsOf(findWidget(config, "Lowest Error Budget Remaining"))[
          "trendDirection"
        ],
      ).toBe(DashboardValueTrendDirection.HigherIsBetter);
      expect(
        argumentsOf(findWidget(config, "Least Error Budget Time Left"))[
          "trendDirection"
        ],
      ).toBe(DashboardValueTrendDirection.HigherIsBetter);
      expect(
        argumentsOf(findWidget(config, "Peak Burn Rate"))["trendDirection"],
      ).toBe(DashboardValueTrendDirection.HigherIsWorse);
    });

    /*
     * One line per OBJECTIVE. By the attribute the toolbar variable binds to,
     * leading so the legend reads by name — and by sloId, because SLO names
     * are not unique: grouped by name alone, two same-named SLOs were drawn as
     * one averaged line under one legend entry (regression). A whole-map
     * `groupBy: { attributes: true }` would split every line by every label.
     */
    it("fans each chart out by sloName then sloId, and nothing else", () => {
      expect([...SLO_TEMPLATE_CHART_GROUP_BY_KEYS]).toEqual([
        SLO_NAME_ATTRIBUTE,
        "sloId",
      ]);

      for (const chart of componentsOfType(
        getConfig(),
        DashboardComponentType.Chart,
      )) {
        expect(queryDataOf(chart)["groupByAttributeKeys"]).toEqual([
          SLO_NAME_ATTRIBUTE,
          "sloId",
        ]);
        expect(queryDataOf(chart)["groupBy"]).toBeUndefined();
        expect(argumentsOf(chart)["chartType"]).toBe(DashboardChartType.Line);
      }
    });

    it("leaves the tiles ungrouped, so each prints ONE number", () => {
      for (const tile of componentsOfType(
        getConfig(),
        DashboardComponentType.Value,
      )) {
        expect(queryDataOf(tile)["groupByAttributeKeys"]).toBeUndefined();
      }
    });

    /*
     * With the toolbar on All the row must describe the fleet; a filter baked
     * into a widget would describe a subset behind a toolbar reading "All".
     */
    it("stores no attribute filter on any metric widget", () => {
      for (const component of metricWidgets(getConfig())) {
        expect(filterDataOf(component)["attributes"]).toBeUndefined();
      }
    });

    /*
     * Objectives run at different targets, so one axis of SLIs reads as a
     * flat line and a dot. The SLI is shown per objective, against its own
     * target, in the Selected SLO section — never fleet-wide.
     */
    it("does not chart the SLI, the target or the status series fleet-wide", () => {
      const queried: Array<string> = metricWidgets(getConfig()).map(
        (component: DashboardBaseComponent): string => {
          return metricNameOf(component) as string;
        },
      );

      for (const series of [
        SloMetricType.SliPercent,
        SloMetricType.TargetPercent,
        SloMetricType.Status,
      ]) {
        expect(queried).not.toContain(series);
      }
    });

    it("puts no percent sign in a metric widget's title — the unit comes from the catalog", () => {
      const offenders: Array<string> = metricWidgets(getConfig())
        .map(titleOf)
        .filter((title: string): boolean => {
          return title.includes("%");
        });

      expect(offenders).toEqual([]);
    });

    it("stores every aggregation under the misspelled key the fetch layer reads", () => {
      for (const component of metricWidgets(getConfig())) {
        expect(typeof aggregationOf(component)).toBe("string");
        expect(
          Object.prototype.hasOwnProperty.call(
            filterDataOf(component),
            "aggregationType",
          ),
        ).toBe(false);
      }
    });
  });

  describe("the Selected SLO widgets", () => {
    /*
     * Title, metric and display asserted TOGETHER per widget: a permutation of
     * titles across metrics — a "Burn Rate" tile reporting the SLI — is the
     * worst way this template can be wrong and the one a reader cannot see.
     */
    it("labels each SLO widget with the number it actually reports", () => {
      const config: DashboardViewConfig = getConfig();
      const expected: Array<[string, string, string]> = [
        ["SLI", SLI_METRIC, TILE_DISPLAY],
        ["Error Budget Remaining", ERROR_BUDGET_REMAINING_METRIC, TILE_DISPLAY],
        ["Burn Rate", BURN_RATE_METRIC, TILE_DISPLAY],
        ["SLI History", SLI_METRIC, CHART_DISPLAY],
        ["Error Budget History", ERROR_BUDGET_REMAINING_METRIC, CHART_DISPLAY],
        ["Burn Rate History", BURN_RATE_METRIC, CHART_DISPLAY],
      ];

      for (const [title, metric, display] of expected) {
        const args: WidgetArguments = argumentsOf(findWidget(config, title));

        expect(
          `${title} -> ${String(args["sloMetric"])}/${String(args["displayType"])}`,
        ).toBe(`${title} -> ${metric}/${display}`);
      }

      expect(componentsOfType(config, DashboardComponentType.Slo)).toHaveLength(
        expected.length,
      );
    });

    it("shows every metric the widget supports, as both a tile and a history", () => {
      const pairs: Set<string> = new Set<string>(
        componentsOfType(getConfig(), DashboardComponentType.Slo).map(
          (component: DashboardBaseComponent): string => {
            const args: WidgetArguments = argumentsOf(component);
            return `${String(args["sloMetric"])}/${String(args["displayType"])}`;
          },
        ),
      );

      for (const metric of Object.values(SloWidgetMetric)) {
        for (const display of Object.values(SloWidgetDisplayType)) {
          expect(
            `${metric}/${display} on the board: ${pairs.has(`${metric}/${display}`)}`,
          ).toBe(`${metric}/${display} on the board: true`);
        }
      }
    });

    /*
     * A template cannot know a project's SLO ids: a baked-in id would point at
     * nothing elsewhere, and on a public dashboard a stored id is the
     * authorization decision.
     */
    it("pins no SLO id on any widget", () => {
      for (const component of componentsOfType(
        getConfig(),
        DashboardComponentType.Slo,
      )) {
        expect(
          argumentsOf(component)["serviceLevelObjectiveId"],
        ).toBeUndefined();
      }
    });

    it("binds every SLO widget to the template's own SLO variable", () => {
      const config: DashboardViewConfig = getConfig();
      const variableId: string = onlyVariable(config).id;

      for (const component of componentsOfType(
        config,
        DashboardComponentType.Slo,
      )) {
        expect(
          `${titleOf(component)} follows ${String(
            argumentsOf(component)["serviceLevelObjectiveVariableId"],
          )}`,
        ).toBe(`${titleOf(component)} follows ${variableId}`);
      }
    });

    /*
     * THE property the rewrite exists for, established through the resolver
     * the renderer and the public policy both use: as created, every SLO
     * widget asks for a TOOLBAR pick (never "Click to select an SLO", which
     * does nothing outside edit mode), and one pick resolves all six at once.
     */
    it("waits for one toolbar pick — and one pick resolves every SLO widget", () => {
      const config: DashboardViewConfig = getConfig();
      const variable: DashboardVariable = onlyVariable(config);
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);

      for (const component of sloWidgets) {
        const args: WidgetArguments = argumentsOf(component);

        expect(
          `${titleOf(component)} as created: ${
            resolveSloWidgetSource({
              serviceLevelObjectiveId: args["serviceLevelObjectiveId"] as
                | string
                | undefined,
              serviceLevelObjectiveVariableId: args[
                "serviceLevelObjectiveVariableId"
              ] as string | undefined,
              variables: config.variables,
            }).state
          }`,
        ).toBe(
          `${titleOf(component)} as created: ${SloWidgetSourceState.NoSelection}`,
        );

        expect(
          resolveSloWidgetSource({
            serviceLevelObjectiveVariableId: args[
              "serviceLevelObjectiveVariableId"
            ] as string | undefined,
            variables: [{ ...variable, selectedValue: "Checkout API" }],
          }),
        ).toEqual({
          state: SloWidgetSourceState.FollowsSelection,
          sloName: "Checkout API",
        });
      }
    });

    it("titles every SLO widget so the placeholders can be told apart", () => {
      for (const component of componentsOfType(
        getConfig(),
        DashboardComponentType.Slo,
      )) {
        expect(
          String(argumentsOf(component)["widgetTitle"] || "").trim().length,
        ).toBeGreaterThan(0);
      }
    });

    it("stores only real SloWidgetMetric and SloWidgetDisplayType values", () => {
      expect(SloWidgetMetric.Sli).toBe(SLI_METRIC);
      expect(SloWidgetMetric.ErrorBudgetRemaining).toBe(
        ERROR_BUDGET_REMAINING_METRIC,
      );
      expect(SloWidgetMetric.BurnRate).toBe(BURN_RATE_METRIC);
      expect(SloWidgetDisplayType.Tile).toBe(TILE_DISPLAY);
      expect(SloWidgetDisplayType.Chart).toBe(CHART_DISPLAY);

      for (const component of componentsOfType(
        getConfig(),
        DashboardComponentType.Slo,
      )) {
        const args: WidgetArguments = argumentsOf(component);

        expect(Object.values(SloWidgetMetric)).toContain(args["sloMetric"]);
        expect(Object.values(SloWidgetDisplayType)).toContain(
          args["displayType"],
        );
      }
    });

    it("declares the same floors the widget's own default does, and gives charts room to be read", () => {
      const floor: DashboardBaseComponent =
        DashboardSloComponentUtil.getDefaultComponent();

      for (const component of componentsOfType(
        getConfig(),
        DashboardComponentType.Slo,
      )) {
        expect(component.minWidthInDashboardUnits).toBe(
          floor.minWidthInDashboardUnits,
        );
        expect(component.minHeightInDashboardUnits).toBe(
          floor.minHeightInDashboardUnits,
        );

        const isChart: boolean =
          argumentsOf(component)["displayType"] === CHART_DISPLAY;

        expect(component.widthInDashboardUnits).toBeGreaterThanOrEqual(4);
        expect(component.heightInDashboardUnits).toBeGreaterThanOrEqual(
          isChart ? 4 : 3,
        );
      }
    });

    // A metric query on an Slo widget would be read by the metric fetch layer.
    it("carries no metric query on any SLO widget", () => {
      for (const component of componentsOfType(
        getConfig(),
        DashboardComponentType.Slo,
      )) {
        expect(argumentsOf(component)["metricQueryConfig"]).toBeUndefined();
      }
    });
  });

  describe("the SLO variable", () => {
    it("is one single-select Telemetry Attribute variable labelled SLO", () => {
      const variable: DashboardVariable = onlyVariable(getConfig());

      expect(variable.name).toBe("slo");
      expect(variable.label).toBe("SLO");
      expect(variable.type).toBe(DashboardVariableType.TelemetryAttribute);
      /*
       * Single-select because the Selected SLO widgets can show ONE objective;
       * a multi-pick would leave six widgets asking for a single pick while
       * the charts above compared.
       */
      expect(variable.isMultiSelect).toBe(false);
    });

    /*
     * SloMetricUtil stamps a BARE key. `resource.sloName` would compile and
     * offer an empty picker; `sloId` would offer UUIDs and match no name.
     */
    it("binds to the bare sloName key the SLO metrics carry", () => {
      const variable: DashboardVariable = onlyVariable(getConfig());

      expect(variable.attributeKey).toBe(SLO_NAME_ATTRIBUTE);
      expect(variable.attributeKey).toBe(SLO_METRIC_SLO_NAME_ATTRIBUTE);
      expect(variable.attributeKey).not.toBe("resource.sloName");
      expect(variable.attributeKey).not.toBe("sloId");
    });

    /*
     * One key, three consumers: the charts group by it, the SLO List maps it
     * to the name column, and the variable binds to it. If any of the three
     * spells it differently, a pick narrows some sections and not others.
     */
    it("is the same key the charts group by and the SLO List maps to its name column", () => {
      const config: DashboardViewConfig = getConfig();
      const key: string = onlyVariable(config).attributeKey as string;

      expect(SLO_LIST_ATTRIBUTE_TO_COLUMN[key]).toBe("name");

      for (const chart of componentsOfType(
        config,
        DashboardComponentType.Chart,
      )) {
        // The variable's key leads; sloId after it keeps same-named SLOs apart.
        expect(
          (queryDataOf(chart)["groupByAttributeKeys"] as Array<string>)[0],
        ).toBe(key);
      }
    });

    // A template cannot know a project's SLO names.
    it("ships no default and no selection", () => {
      const variable: DashboardVariable = onlyVariable(getConfig());

      expect(variable.defaultValue ?? "").toBe("");
      expect(variable.selectedValue ?? "").toBe("");
      expect(variable.selectedValues ?? []).toEqual([]);
    });
  });

  describe("freshness", () => {
    it("generates fresh component and variable ids on every call", () => {
      const first: DashboardViewConfig = getConfig();
      const second: DashboardViewConfig = getConfig();

      const firstIds: Set<string> = new Set<string>(
        first.components.map((component: DashboardBaseComponent): string => {
          return component.componentId.toString();
        }),
      );

      for (const component of second.components) {
        expect(firstIds.has(component.componentId.toString())).toBe(false);
      }

      expect(onlyVariable(second).id).not.toBe(onlyVariable(first).id);
    });

    /*
     * The binding must point at THIS config's variable. A variable id captured
     * once at module load would bind every dashboard created afterwards to a
     * variable it does not have.
     */
    it("binds each call's SLO widgets to that same call's variable", () => {
      for (let call: number = 0; call < 3; call++) {
        const config: DashboardViewConfig = getConfig();
        const variableId: string = onlyVariable(config).id;

        for (const component of componentsOfType(
          config,
          DashboardComponentType.Slo,
        )) {
          expect(
            argumentsOf(component)["serviceLevelObjectiveVariableId"],
          ).toBe(variableId);
        }
      }
    });

    it("returns the same layout on every call", () => {
      expect(getConfig().components.map(placementOf)).toEqual(
        getConfig().components.map(placementOf),
      );
    });
  });
});
