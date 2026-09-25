import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import { JSONObject } from "../../Types/JSON";
import MetricsAggregationType from "../../Types/Metrics/MetricsAggregationType";

/*
 * Repairs the "Cluster CPU (cores in use)" tile on Kubernetes dashboards
 * created before the template stopped summing a gauge.
 *
 * The tile was a Value widget over k8s.node.cpu.usage with `Sum`. The server
 * sums every node's reading in each time bucket, then the Value widget sums
 * the buckets, so the number scales with the scrape count and the window
 * length: three nodes on 1.5 cores each read ~540 over the default hour
 * instead of 4.5. The template now ships the busiest node's peak (`Max`);
 * templates are COPIED into a dashboard when it is created, so dashboards
 * that already exist keep the old tile until this rewrites them.
 *
 * Only the template's exact signature is touched: a Value widget with the
 * template's title, metric and `Sum`. A tile the user renamed or re-aggregated
 * is theirs and stays as they left it. Everything else on the tile — its
 * position, thresholds, trend direction, any filters the user added — is kept.
 *
 * React-free and import-light so plain node tests load it.
 */

export const KUBERNETES_NODE_CPU_USAGE_METRIC: string = "k8s.node.cpu.usage";

export const LEGACY_CLUSTER_CPU_TILE_TITLE: string =
  "Cluster CPU (cores in use)";

export const BUSIEST_NODE_CPU_TILE_TITLE: string =
  "Busiest Node CPU (cores, peak)";

export interface KubernetesClusterCpuTileRepairResult {
  config: JSONObject;
  repairedTileCount: number;
}

function asObject(value: unknown): JSONObject | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONObject;
  }

  return undefined;
}

// The tile's filterData, where the fetch layer reads metric and aggregation.
function getFilterData(component: JSONObject): JSONObject | undefined {
  const args: JSONObject | undefined = asObject(component["arguments"]);
  const metricQueryConfig: JSONObject | undefined = asObject(
    args?.["metricQueryConfig"],
  );
  const metricQueryData: JSONObject | undefined = asObject(
    metricQueryConfig?.["metricQueryData"],
  );

  return asObject(metricQueryData?.["filterData"]);
}

export default class KubernetesClusterCpuTileRepair {
  /*
   * The legacy tile's signature as a Postgres jsonb containment (`@>`)
   * document. Containment against an array matches an element that holds
   * ALL of these keys, so a dashboard only matches when one component
   * carries the title, metric and aggregation together. The
   * misspelled `aggegationType` is the key the fetch layer reads.
   */
  public static getLegacyTileContainment(): JSONObject {
    return {
      components: [
        {
          componentType: DashboardComponentType.Value,
          arguments: {
            title: LEGACY_CLUSTER_CPU_TILE_TITLE,
            metricQueryConfig: {
              metricQueryData: {
                filterData: {
                  metricName: KUBERNETES_NODE_CPU_USAGE_METRIC,
                  aggegationType: MetricsAggregationType.Sum,
                },
              },
            },
          },
        },
      ],
    };
  }

  // The same signature as getLegacyTileContainment, for one component.
  public static isLegacyTile(component: unknown): boolean {
    const componentObject: JSONObject | undefined = asObject(component);

    if (
      !componentObject ||
      componentObject["componentType"] !== DashboardComponentType.Value
    ) {
      return false;
    }

    const args: JSONObject | undefined = asObject(componentObject["arguments"]);
    const filterData: JSONObject | undefined = getFilterData(componentObject);

    return (
      args?.["title"] === LEGACY_CLUSTER_CPU_TILE_TITLE &&
      filterData?.["metricName"] === KUBERNETES_NODE_CPU_USAGE_METRIC &&
      filterData?.["aggegationType"] === MetricsAggregationType.Sum
    );
  }

  /*
   * Returns a repaired COPY of a stored dashboardViewConfig, or null when it
   * holds no legacy tile — so a caller writes only when something changed,
   * and a second run is a no-op. The input is never mutated.
   */
  public static repair(
    dashboardViewConfig: unknown,
  ): KubernetesClusterCpuTileRepairResult | null {
    const configObject: JSONObject | undefined = asObject(dashboardViewConfig);
    const components: unknown = configObject?.["components"];

    if (!configObject || !Array.isArray(components)) {
      return null;
    }

    if (!components.some(KubernetesClusterCpuTileRepair.isLegacyTile)) {
      return null;
    }

    // A stored config is plain jsonb, so a JSON round trip is a full copy.
    const config: JSONObject = JSON.parse(JSON.stringify(configObject));
    let repairedTileCount: number = 0;

    for (const component of config["components"] as Array<unknown>) {
      if (!KubernetesClusterCpuTileRepair.isLegacyTile(component)) {
        continue;
      }

      const componentObject: JSONObject = component as JSONObject;
      (componentObject["arguments"] as JSONObject)["title"] =
        BUSIEST_NODE_CPU_TILE_TITLE;
      getFilterData(componentObject)!["aggegationType"] =
        MetricsAggregationType.Max;
      repairedTileCount++;
    }

    return { config, repairedTileCount };
  }
}
