import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
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
import MonitorType from "../../../Types/Monitor/MonitorType";

/*
 * Editorial invariants for the Network template specifically. The
 * structural rules every template must satisfy (grid bounds, overlap,
 * unique ids, aggregation spelling) live in DashboardTemplateInvariants —
 * this file pins the things that make THIS template the Network one:
 * which metrics it queries, which attributes it groups and varies by, and
 * that the map is on it at all.
 */

/*
 * The metric names are the wire contract: they are persisted into the
 * saved dashboard as raw strings and matched against what the probe
 * emitted. Pinned as literals rather than as MonitorMetricType members so
 * that renaming a member's VALUE — which would silently empty every
 * widget on every dashboard already created from this template — fails
 * here instead of shipping.
 *
 * All five are emitted by exactly one code path,
 * Common/Server/Utils/Monitor/NetworkDeviceMetricUtil.saveWalkMetrics, off
 * a network device walk. That is the property the template depends on and
 * the one the tests below defend.
 */
const INTERFACE_IN_METRIC: string =
  "oneuptime.monitor.snmp.interface.in.bits.per.second";
const INTERFACE_OUT_METRIC: string =
  "oneuptime.monitor.snmp.interface.out.bits.per.second";
const INTERFACE_UTILIZATION_METRIC: string =
  "oneuptime.monitor.snmp.interface.utilization.percent";
const INTERFACE_ERRORS_METRIC: string =
  "oneuptime.monitor.snmp.interface.errors.per.second";
const INTERFACE_OPER_STATUS_METRIC: string =
  "oneuptime.monitor.snmp.interface.oper.status";

/*
 * Metrics that every probeable monitor in the project emits, NOT just
 * network devices. A tile on a network dashboard built from one of these
 * silently averages every website check in the project, so the template
 * must not carry any.
 */
const PROJECT_WIDE_METRICS: Array<string> = [
  "oneuptime.monitor.online",
  "oneuptime.monitor.response.time",
  "oneuptime.monitor.ping.packet.loss.percent",
  "oneuptime.monitor.ping.jitter",
];

/*
 * The two bare attribute keys NetworkDeviceMetricUtil stamps onto its
 * rows: `deviceName` on every metric, `interfaceName` on the per-interface
 * ones. They carry no `resource.` prefix, so a template that guessed
 * "resource.deviceName" would compile and group by nothing.
 */
const DEVICE_ATTRIBUTE: string = "deviceName";
const INTERFACE_ATTRIBUTE: string = "interfaceName";

const AVG_AGGREGATION: string = "Avg";
const MAX_AGGREGATION: string = "Max";
const SUM_AGGREGATION: string = "Sum";

const GRID_WIDTH_IN_UNITS: number = 12;

// -- Helpers ---------------------------------------------------------------

type WidgetArguments = Record<string, unknown>;

function getConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Network,
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

function metricQueryDataOf(component: DashboardBaseComponent): WidgetArguments {
  const queryConfig: WidgetArguments =
    (argumentsOf(component)["metricQueryConfig"] as
      | WidgetArguments
      | undefined) || {};

  return (queryConfig["metricQueryData"] as WidgetArguments | undefined) || {};
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
 * That misspelling is what the fetch layer reads, so it is the contract.
 */
function aggregationOf(component: DashboardBaseComponent): unknown {
  return filterDataOf(component)["aggegationType"];
}

function groupByAttributeKeysOf(component: DashboardBaseComponent): unknown {
  return metricQueryDataOf(component)["groupByAttributeKeys"];
}

// -- Tests -----------------------------------------------------------------

describe("Network dashboard template", () => {
  describe("catalog entry", () => {
    it("is registered exactly once", () => {
      const entries: Array<DashboardTemplate> = DashboardTemplates.filter(
        (template: DashboardTemplate): boolean => {
          return template.type === DashboardTemplateType.Network;
        },
      );

      expect(entries).toHaveLength(1);
    });

    it("is filed under Infrastructure with a map icon and a real description", () => {
      const entry: DashboardTemplate = DashboardTemplates.find(
        (template: DashboardTemplate): boolean => {
          return template.type === DashboardTemplateType.Network;
        },
      ) as DashboardTemplate;

      expect(entry.name).toBe("Network Dashboard");
      expect(entry.category).toBe(DashboardTemplateCategory.Infrastructure);
      expect(entry.icon).toBe(IconProp.Map);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    });

    it("is listed by getDashboardTemplatesByCategory for Infrastructure", () => {
      const types: Array<DashboardTemplateType> =
        getDashboardTemplatesByCategory(
          DashboardTemplateCategory.Infrastructure,
        ).map((template: DashboardTemplate): DashboardTemplateType => {
          return template.type;
        });

      expect(types).toContain(DashboardTemplateType.Network);
    });

    it("resolves to a config rather than to null the way Blank does", () => {
      expect(getTemplateConfig(DashboardTemplateType.Network)).not.toBeNull();
    });
  });

  describe("the map", () => {
    /*
     * This is the whole reason the template exists: a network dashboard
     * that does not show WHERE the network is, is just a metrics
     * dashboard with SNMP metric names on it.
     */
    it("puts exactly one Network Map on the dashboard", () => {
      expect(
        componentsOfType(getConfig(), DashboardComponentType.NetworkMap),
      ).toHaveLength(1);
    });

    it("opens the map in map mode with names on, not as a table", () => {
      const args: WidgetArguments = argumentsOf(
        findWidget(getConfig(), "Sites"),
      );

      expect(args["viewMode"]).toBe("map");
      expect(args["showLabels"]).toBe(true);
    });

    it("caps the map's fetch at a positive whole number of sites", () => {
      const maxSites: unknown = argumentsOf(findWidget(getConfig(), "Sites"))[
        "maxSites"
      ];

      expect(typeof maxSites).toBe("number");
      expect(Number.isInteger(maxSites as number)).toBe(true);
      expect(maxSites as number).toBeGreaterThan(0);
    });

    it("does not pre-filter the map to a status, so it opens on the whole estate", () => {
      expect(
        argumentsOf(findWidget(getConfig(), "Sites"))["statusFilter"],
      ).toBeUndefined();
    });

    /*
     * The world is roughly 2:1. The map is the largest thing on the
     * dashboard and it has to be tall as well as wide, or it renders as a
     * letterboxed strip with every marker on top of every other.
     */
    it("gives the map a tile that is big in both axes", () => {
      const map: DashboardBaseComponent = findWidget(getConfig(), "Sites");

      expect(map.widthInDashboardUnits).toBeGreaterThanOrEqual(6);
      expect(map.heightInDashboardUnits).toBeGreaterThanOrEqual(4);
      expect(map.minWidthInDashboardUnits).toBe(4);
      expect(map.minHeightInDashboardUnits).toBe(4);
    });

    it("places the map in the top band, above every section header below it", () => {
      const config: DashboardViewConfig = getConfig();
      const map: DashboardBaseComponent = findWidget(config, "Sites");

      expect(map.topInDashboardUnits).toBe(1);
      expect(map.leftInDashboardUnits).toBe(0);
    });
  });

  describe("metric queries", () => {
    it("queries only SNMP metrics the device walk actually emits", () => {
      const config: DashboardViewConfig = getConfig();

      expect(metricNameOf(findWidget(config, "Interfaces Up (avg)"))).toBe(
        INTERFACE_OPER_STATUS_METRIC,
      );
      expect(
        metricNameOf(findWidget(config, "Avg Interface Utilization")),
      ).toBe(INTERFACE_UTILIZATION_METRIC);
      expect(
        metricNameOf(findWidget(config, "Worst Interface Errors/sec")),
      ).toBe(INTERFACE_ERRORS_METRIC);
      expect(metricNameOf(findWidget(config, "Peak Inbound"))).toBe(
        INTERFACE_IN_METRIC,
      );
      expect(metricNameOf(findWidget(config, "Peak Outbound"))).toBe(
        INTERFACE_OUT_METRIC,
      );
      expect(metricNameOf(findWidget(config, "Inbound by Interface"))).toBe(
        INTERFACE_IN_METRIC,
      );
      expect(metricNameOf(findWidget(config, "Outbound by Interface"))).toBe(
        INTERFACE_OUT_METRIC,
      );
      expect(
        metricNameOf(findWidget(config, "Peak Interface Utilization")),
      ).toBe(INTERFACE_UTILIZATION_METRIC);
      expect(metricNameOf(findWidget(config, "Interface Error Rate"))).toBe(
        INTERFACE_ERRORS_METRIC,
      );
      expect(
        metricNameOf(findWidget(config, "Interface Errors by Interface")),
      ).toBe(INTERFACE_ERRORS_METRIC);
      expect(metricNameOf(findWidget(config, "Utilization by Interface"))).toBe(
        INTERFACE_UTILIZATION_METRIC,
      );
    });

    /*
     * THE invariant of this template. `oneuptime.monitor.online`,
     * `.response.time`, `.ping.packet.loss.percent` and `.ping.jitter` are
     * emitted by MonitorMetricUtil for EVERY probeable monitor in the
     * project, not just network devices — so a tile built on one of them
     * would average every website check in the project while wearing a
     * network label. Device reachability lives on this dashboard as the
     * Network Device monitor list, which is correctly scoped.
     */
    it("carries no metric that monitors outside the network estate also emit", () => {
      const offenders: Array<string> = [];

      for (const component of getConfig().components) {
        const metric: string | undefined = metricNameOf(component);

        if (metric && PROJECT_WIDE_METRICS.includes(metric)) {
          offenders.push(`${titleOf(component)} -> ${metric}`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it("queries an snmp metric namespace on every metric-bearing widget", () => {
      const metrics: Array<string> = [];

      for (const component of getConfig().components) {
        const metric: string | undefined = metricNameOf(component);

        if (metric) {
          metrics.push(metric);
        }
      }

      expect(metrics.length).toBeGreaterThan(0);

      for (const metric of metrics) {
        expect(metric.startsWith("oneuptime.monitor.snmp.")).toBe(true);
      }
    });

    /*
     * The aggregation is not decoration, and Sum is never right here. The
     * interface series are already per-second RATES, and a Value tile
     * reduces across time buckets — so a summed rate doubles when somebody
     * widens the time picker, describing the dashboard rather than the
     * network. Max answers "how bad did it get", Avg answers "what is
     * normal"; both are range-independent.
     */
    it("never aggregates a per-second rate with Sum", () => {
      const summed: Array<string> = [];

      for (const component of getConfig().components) {
        if (
          metricNameOf(component) &&
          aggregationOf(component) === SUM_AGGREGATION
        ) {
          summed.push(titleOf(component));
        }
      }

      expect(summed).toEqual([]);
    });

    it("picks the aggregation that makes each number mean what its title says", () => {
      const config: DashboardViewConfig = getConfig();

      for (const title of [
        "Peak Interface Utilization",
        "Worst Interface Errors/sec",
        "Peak Inbound",
        "Peak Outbound",
      ]) {
        expect(aggregationOf(findWidget(config, title))).toBe(MAX_AGGREGATION);
      }

      for (const title of [
        "Interfaces Up (avg)",
        "Avg Interface Utilization",
        "Interface Error Rate",
        "Inbound by Interface",
        "Outbound by Interface",
        "Interface Errors by Interface",
        "Utilization by Interface",
      ]) {
        expect(aggregationOf(findWidget(config, title))).toBe(AVG_AGGREGATION);
      }
    });

    /*
     * "Is a link saturated" is only answerable per link. A throughput
     * chart that does not split by interface draws one flat line that is
     * the average of a saturated uplink and nine idle access ports.
     */
    it("splits the per-interface charts by interfaceName", () => {
      const config: DashboardViewConfig = getConfig();

      for (const title of [
        "Inbound by Interface",
        "Outbound by Interface",
        "Interface Errors by Interface",
        "Utilization by Interface",
      ]) {
        expect(groupByAttributeKeysOf(findWidget(config, title))).toEqual([
          INTERFACE_ATTRIBUTE,
        ]);
      }
    });

    /*
     * These two metrics are already RATES computed by the probe from the
     * SNMP counter deltas, unlike the Ceph template's cumulative
     * ceph_pool_*_bytes counters. Rate-transforming them would plot the
     * rate of change of a rate — a chart that reads as noise around zero.
     */
    it("does not rate-transform the interface bit-rate charts", () => {
      const config: DashboardViewConfig = getConfig();

      for (const title of ["Inbound by Interface", "Outbound by Interface"]) {
        const queryConfig: WidgetArguments =
          (argumentsOf(findWidget(config, title))["metricQueryConfig"] as
            | WidgetArguments
            | undefined) || {};

        expect(queryConfig["transformAsRate"]).toBeUndefined();
      }
    });

    it("marks every 'more is worse' number so its trend arrow is colored right", () => {
      const config: DashboardViewConfig = getConfig();

      for (const title of [
        "Avg Interface Utilization",
        "Worst Interface Errors/sec",
      ]) {
        expect(argumentsOf(findWidget(config, title))["trendDirection"]).toBe(
          DashboardValueTrendDirection.HigherIsWorse,
        );
      }

      expect(
        argumentsOf(findWidget(config, "Interfaces Up (avg)"))[
          "trendDirection"
        ],
      ).toBe(DashboardValueTrendDirection.HigherIsBetter);

      /*
       * Throughput is deliberately unmarked: more traffic through an uplink
       * is neither good nor bad on its own, and a colored arrow would claim
       * otherwise. The renderer falls back to its neutral heuristic.
       */
      for (const title of ["Peak Inbound", "Peak Outbound"]) {
        expect(
          argumentsOf(findWidget(config, title))["trendDirection"],
        ).toBeUndefined();
      }
    });

    /*
     * A dashboard that prints the same figure under two names is a smaller
     * dashboard pretending to be a bigger one. A number paired with its own
     * trend chart is fine — that is a different AGGREGATION shape, not a
     * repeat — so the check is on (metric, aggregation, widget family).
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

    it("gives every widget on the dashboard a distinct title", () => {
      const titles: Array<string> = getConfig().components.map(titleOf);

      expect(
        titles.every((title: string): boolean => {
          return title.trim().length > 0;
        }),
      ).toBe(true);
      expect(new Set(titles).size).toBe(titles.length);
    });
  });

  describe("gauges", () => {
    /*
     * A healthy Ethernet port errors essentially never, while a link at 60%
     * utilization is simply busy. Putting the error gauge on the same
     * 0-100 scale as the utilization gauge beside it would render every
     * real fault as a flat line on the floor.
     */
    it("scales the error gauge for a metric that is normally zero", () => {
      const config: DashboardViewConfig = getConfig();
      const errors: WidgetArguments = argumentsOf(
        findWidget(config, "Interface Error Rate"),
      );
      const utilization: WidgetArguments = argumentsOf(
        findWidget(config, "Peak Interface Utilization"),
      );

      expect(errors["minValue"]).toBe(0);
      expect(errors["maxValue"]).toBe(10);
      expect(errors["warningThreshold"]).toBe(1);
      expect(errors["criticalThreshold"]).toBe(5);

      expect(utilization["minValue"]).toBe(0);
      expect(utilization["maxValue"]).toBe(100);
      expect(utilization["warningThreshold"]).toBe(70);
      expect(utilization["criticalThreshold"]).toBe(90);

      expect(errors["maxValue"] as number).toBeLessThan(
        utilization["maxValue"] as number,
      );
    });

    it("orders every gauge min <= warning < critical <= max", () => {
      for (const title of [
        "Peak Interface Utilization",
        "Interface Error Rate",
      ]) {
        const args: WidgetArguments = argumentsOf(
          findWidget(getConfig(), title),
        );

        expect(args["minValue"] as number).toBeLessThanOrEqual(
          args["warningThreshold"] as number,
        );
        expect(args["warningThreshold"] as number).toBeLessThan(
          args["criticalThreshold"] as number,
        );
        expect(args["criticalThreshold"] as number).toBeLessThanOrEqual(
          args["maxValue"] as number,
        );
      }
    });
  });

  describe("the monitor list", () => {
    /*
     * An unfiltered monitor list on a network dashboard is the Monitors
     * page with fewer columns. Pinning it to Network Device monitors is
     * what makes it worth the tile.
     */
    it("is pinned to Network Device monitors", () => {
      const args: WidgetArguments = argumentsOf(
        findWidget(getConfig(), "Network Device Monitors"),
      );

      expect(args["monitorTypes"]).toEqual([MonitorType.NetworkDevice]);
    });

    it("renders as a list and caps its rows", () => {
      const args: WidgetArguments = argumentsOf(
        findWidget(getConfig(), "Network Device Monitors"),
      );

      expect(args["viewMode"]).toBe("list");
      expect(args["maxRows"] as number).toBeGreaterThan(0);
    });
  });

  describe("variables", () => {
    it("ships a Device and an Interface picker, both multi-select", () => {
      const variables: Array<DashboardVariable> = getConfig().variables || [];

      expect(
        variables.map((variable: DashboardVariable): string => {
          return variable.name;
        }),
      ).toEqual(["device", "interface"]);

      for (const variable of variables) {
        expect(variable.type).toBe(DashboardVariableType.TelemetryAttribute);
        /*
         * Comparing two uplinks, or two branch routers, is the normal use
         * of this dashboard rather than the exception.
         */
        expect(variable.isMultiSelect).toBe(true);
        expect((variable.label || "").trim().length).toBeGreaterThan(0);
      }
    });

    /*
     * Network device metrics carry BARE attribute keys — see
     * NetworkDeviceMetricUtil.buildDeviceMetricRow. A variable bound to
     * `resource.deviceName` would offer an empty picker.
     */
    it("binds to the bare attribute keys, not the resource-prefixed ones", () => {
      const variables: Array<DashboardVariable> = getConfig().variables || [];

      expect(
        variables.map((variable: DashboardVariable): string | undefined => {
          return variable.attributeKey;
        }),
      ).toEqual([DEVICE_ATTRIBUTE, INTERFACE_ATTRIBUTE]);
    });
  });

  describe("layout", () => {
    it("lays every widget out inside the 12-unit grid", () => {
      for (const component of getConfig().components) {
        expect(component.leftInDashboardUnits).toBeGreaterThanOrEqual(0);
        expect(component.topInDashboardUnits).toBeGreaterThanOrEqual(0);
        expect(
          component.leftInDashboardUnits + component.widthInDashboardUnits,
        ).toBeLessThanOrEqual(GRID_WIDTH_IN_UNITS);
      }
    });

    /*
     * A band of empty rows in the middle of a template reads as a widget
     * that failed to render rather than as whitespace. Every row from the
     * title to the last widget must be occupied by something.
     */
    it("leaves no empty row between the title and the last widget", () => {
      const config: DashboardViewConfig = getConfig();
      const lowestEdge: number = Math.max(
        ...config.components.map(
          (component: DashboardBaseComponent): number => {
            return (
              component.topInDashboardUnits + component.heightInDashboardUnits
            );
          },
        ),
      );

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
      for (let row: number = 0; row < lowestEdge; row++) {
        if (!occupiedRows.has(row)) {
          emptyRows.push(row);
        }
      }

      expect(emptyRows).toEqual([]);
    });

    it("is tall enough to contain everything on it", () => {
      const config: DashboardViewConfig = getConfig();
      const lowestEdge: number = Math.max(
        ...config.components.map(
          (component: DashboardBaseComponent): number => {
            return (
              component.topInDashboardUnits + component.heightInDashboardUnits
            );
          },
        ),
      );

      expect(config.heightInDashboardUnits).toBeGreaterThanOrEqual(lowestEdge);
    });

    it("opens with a bold title row across the full width", () => {
      const title: DashboardBaseComponent = findWidget(
        getConfig(),
        "Network Dashboard",
      );

      expect(title.componentType).toBe(DashboardComponentType.Text);
      expect(title.topInDashboardUnits).toBe(0);
      expect(title.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
      expect(argumentsOf(title)["isBold"]).toBe(true);
    });

    it("labels each band with its own bold section header", () => {
      const config: DashboardViewConfig = getConfig();

      for (const heading of [
        "Interface Throughput",
        "Utilization & Errors",
        "Devices & Monitors",
      ]) {
        const header: DashboardBaseComponent = findWidget(config, heading);

        expect(header.componentType).toBe(DashboardComponentType.Text);
        expect(header.widthInDashboardUnits).toBe(GRID_WIDTH_IN_UNITS);
        expect(argumentsOf(header)["isBold"]).toBe(true);
      }
    });

    it("picks a chart shape that suits each series", () => {
      const config: DashboardViewConfig = getConfig();

      // Filled areas for volume...
      expect(
        argumentsOf(findWidget(config, "Inbound by Interface"))["chartType"],
      ).toBe(DashboardChartType.Area);
      expect(
        argumentsOf(findWidget(config, "Outbound by Interface"))["chartType"],
      ).toBe(DashboardChartType.Area);
      // ...a line for a percentage that should be read against a threshold...
      expect(
        argumentsOf(findWidget(config, "Utilization by Interface"))[
          "chartType"
        ],
      ).toBe(DashboardChartType.Line);
      // ...and bars for a mostly-zero series where each spike is an event.
      expect(
        argumentsOf(findWidget(config, "Interface Errors by Interface"))[
          "chartType"
        ],
      ).toBe(DashboardChartType.Bar);
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
  });
});
