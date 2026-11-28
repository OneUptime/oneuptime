import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../Types/JSON";

/*
 * The Hosts Dashboard's charts by host, on a dashboard made before they
 * grouped by the key hosts' rows carry.
 *
 * The template's six "by Host" charts - CPU Utilization, Memory Usage,
 * Filesystem Usage, Disk I/O, Network I/O and Process Count - grouped by a
 * bare `host.name`. A resource attribute is stored under its `resource.`
 * key, so no row carries `host.name`, and each chart drew every host as one
 * unnamed line. The template now groups them by `resource.host.name`, the
 * key its Host variable names hosts by. Templates are copied into a
 * dashboard when it is made, so this gives a dashboard made before that the
 * same grouping, and changes nothing else.
 *
 * Only the template's own charts are touched: a Chart with the template's
 * title and metric, still grouped by `host.name` alone. A chart of a
 * person's own grouped by `host.name` - a datapoint attribute their metrics
 * may well carry - is left as it is, and so is one they regrouped.
 *
 * React-free and import-light so plain node tests load it.
 */

export const LEGACY_HOST_GROUP_BY_KEY: string = "host.name";
export const HOST_GROUP_BY_KEY: string = "resource.host.name";

interface ChartSignature {
  title: string;
  metricName: string;
}

export interface HostsDashboardChartGroupingRepairResult {
  config: JSONObject;
  regroupedChartCount: number;
}

function asObject(value: unknown): JSONObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONObject;
  }

  return undefined;
}

// A chart's title, its metric and the object its grouping is kept in.
function readChart(component: unknown):
  | {
      title: string;
      metricName: string;
      metricQueryData: JSONObject;
    }
  | undefined {
  const componentObject: JSONObject | undefined = asObject(component);

  if (componentObject?.["componentType"] !== DashboardComponentType.Chart) {
    return undefined;
  }

  const argumentsObject: JSONObject | undefined = asObject(
    componentObject["arguments"],
  );
  const title: unknown = argumentsObject?.["chartTitle"];
  const metricQueryData: JSONObject | undefined = asObject(
    asObject(argumentsObject?.["metricQueryConfig"])?.["metricQueryData"],
  );
  const metricName: unknown = asObject(metricQueryData?.["filterData"])?.[
    "metricName"
  ];

  if (
    typeof title !== "string" ||
    typeof metricName !== "string" ||
    !metricQueryData
  ) {
    return undefined;
  }

  return { title, metricName, metricQueryData };
}

function isGroupedBy(metricQueryData: JSONObject, key: string): boolean {
  const keys: unknown = metricQueryData["groupByAttributeKeys"];

  return Array.isArray(keys) && keys.length === 1 && keys[0] === key;
}

let templateCharts: Array<ChartSignature> | null = null;

// The template's charts by host, read off the template itself.
function getTemplateCharts(): Array<ChartSignature> {
  if (templateCharts) {
    return templateCharts;
  }

  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Host,
  );

  templateCharts = (config?.components || []).flatMap(
    (component: DashboardBaseComponent): Array<ChartSignature> => {
      const chart: ReturnType<typeof readChart> = readChart(component);

      return chart && isGroupedBy(chart.metricQueryData, HOST_GROUP_BY_KEY)
        ? [{ title: chart.title, metricName: chart.metricName }]
        : [];
    },
  );

  return templateCharts;
}

export default class HostsDashboardChartGroupingRepair {
  // The template's charts by host, by title and metric.
  public static getTemplateCharts(): Array<ChartSignature> {
    return getTemplateCharts().map((chart: ChartSignature) => {
      return { ...chart };
    });
  }

  /*
   * As a Postgres jsonb containment (`@>`) document: a dashboard holding a
   * chart grouped by the legacy key alone. Which of its charts are the
   * template's is decided on each match in repair().
   */
  public static getContainment(): JSONObject {
    return {
      components: [
        {
          componentType: DashboardComponentType.Chart,
          arguments: {
            metricQueryConfig: {
              metricQueryData: {
                groupByAttributeKeys: [LEGACY_HOST_GROUP_BY_KEY],
              },
            },
          },
        },
      ],
    };
  }

  /*
   * A repaired COPY of a stored dashboardViewConfig, or null when none of
   * its charts is the template's still grouped by the legacy key - so a
   * caller writes only when something changed, and a second run is a
   * no-op. The input is never mutated.
   */
  public static repair(
    dashboardViewConfig: unknown,
  ): HostsDashboardChartGroupingRepairResult | null {
    const configObject: JSONObject | undefined = asObject(dashboardViewConfig);
    const components: unknown = configObject?.["components"];

    if (!configObject || !Array.isArray(components)) {
      return null;
    }

    const charts: Array<ChartSignature> = getTemplateCharts();
    const indexes: Array<number> = [];

    components.forEach((component: unknown, index: number): void => {
      const chart: ReturnType<typeof readChart> = readChart(component);

      if (
        chart &&
        isGroupedBy(chart.metricQueryData, LEGACY_HOST_GROUP_BY_KEY) &&
        charts.some((template: ChartSignature): boolean => {
          return (
            template.title === chart.title &&
            template.metricName === chart.metricName
          );
        })
      ) {
        indexes.push(index);
      }
    });

    if (indexes.length === 0) {
      return null;
    }

    // A stored config is plain jsonb, so a JSON round trip is a full copy.
    const config: JSONObject = JSON.parse(JSON.stringify(configObject));
    const copiedComponents: Array<unknown> = config[
      "components"
    ] as Array<unknown>;

    for (const index of indexes) {
      readChart(copiedComponents[index])!.metricQueryData[
        "groupByAttributeKeys"
      ] = [HOST_GROUP_BY_KEY];
    }

    return { config, regroupedChartCount: indexes.length };
  }
}
