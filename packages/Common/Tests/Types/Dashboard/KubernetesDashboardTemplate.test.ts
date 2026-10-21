import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import KubernetesClusterCpuTileRepair, {
  BUSIEST_NODE_CPU_TILE_TITLE,
  KUBERNETES_NODE_CPU_USAGE_METRIC,
  LEGACY_CLUSTER_CPU_TILE_TITLE,
} from "../../../Utils/Dashboard/KubernetesClusterCpuTileRepair";
import { describe, expect, test } from "@jest/globals";

/*
 * Editorial invariants for the Kubernetes template specifically. The
 * structural rules every template must satisfy live in
 * DashboardTemplateInvariants; this file pins the aggregation of the
 * Kubernetes Value tiles.
 *
 * Every metric the Kubernetes template reads into a Value tile is a gauge
 * the agent re-emits for every node or pod on every scrape. A Value tile
 * reduces the whole window to one number: the server aggregates each time
 * bucket over every series and scrape in it, and the widget then folds the
 * buckets (ValueWidgetData.aggregateValues). With `Sum` both steps add, so
 * the number grows with the node count, the scrape rate and the window:
 * "Cluster CPU (cores in use)" read ~540 for three nodes on 1.5 cores each
 * over the default hour. Avg, Max and Min have no such multiplier.
 */

function loadKubernetesTemplate(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Kubernetes,
  );

  if (!config) {
    throw new Error("Expected the Kubernetes template to resolve to a config");
  }

  return config;
}

function getArguments(
  component: DashboardBaseComponent,
): Record<string, unknown> {
  return (component.arguments as Record<string, unknown>) || {};
}

function getFilterData(
  component: DashboardBaseComponent,
): Record<string, unknown> {
  const queryConfig: Record<string, unknown> | undefined = getArguments(
    component,
  )["metricQueryConfig"] as Record<string, unknown> | undefined;
  const queryData: Record<string, unknown> | undefined = queryConfig?.[
    "metricQueryData"
  ] as Record<string, unknown> | undefined;

  return (queryData?.["filterData"] as Record<string, unknown>) || {};
}

function getValueTiles(
  config: DashboardViewConfig,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return component.componentType === DashboardComponentType.Value;
    },
  );
}

function describeTile(component: DashboardBaseComponent): string {
  const filterData: Record<string, unknown> = getFilterData(component);

  return `"${String(getArguments(component)["title"])}" ${String(
    filterData["metricName"],
  )}/${String(filterData["aggegationType"])}`;
}

describe("Kubernetes dashboard template", () => {
  describe("busiest node CPU tile", () => {
    function findNodeCpuTiles(): Array<DashboardBaseComponent> {
      return getValueTiles(loadKubernetesTemplate()).filter(
        (component: DashboardBaseComponent): boolean => {
          return (
            getFilterData(component)["metricName"] ===
            KUBERNETES_NODE_CPU_USAGE_METRIC
          );
        },
      );
    }

    test("reads k8s.node.cpu.usage with Max, never Sum", (): void => {
      const busiestNodeTile: DashboardBaseComponent | undefined =
        findNodeCpuTiles().find((component: DashboardBaseComponent) => {
          return (
            getArguments(component)["title"] === BUSIEST_NODE_CPU_TILE_TITLE
          );
        });

      expect(busiestNodeTile).toBeDefined();
      expect(getFilterData(busiestNodeTile!)["aggegationType"]).toBe(
        AggregationType.Max,
      );
    });

    test("no longer ships the summed cluster CPU tile under any title", (): void => {
      const nodeCpuTiles: Array<DashboardBaseComponent> = findNodeCpuTiles();

      expect(nodeCpuTiles.length).toBeGreaterThan(0);

      for (const component of nodeCpuTiles) {
        expect(describeTile(component)).not.toContain(
          `/${AggregationType.Sum}`,
        );
        expect(getArguments(component)["title"]).not.toBe(
          LEGACY_CLUSTER_CPU_TILE_TITLE,
        );
      }
    });

    /*
     * The migration writes BUSIEST_NODE_CPU_TILE_TITLE and Max onto
     * existing dashboards. If the template and the repair drift apart, a
     * repaired dashboard and a freshly created one show different tiles.
     */
    test("is exactly what the repair writes onto existing dashboards", (): void => {
      const busiestNodeTile: DashboardBaseComponent | undefined =
        findNodeCpuTiles().find((component: DashboardBaseComponent) => {
          return (
            getArguments(component)["title"] === BUSIEST_NODE_CPU_TILE_TITLE
          );
        });

      expect(busiestNodeTile).toBeDefined();

      const legacyTile: DashboardBaseComponent = JSON.parse(
        JSON.stringify(busiestNodeTile),
      );
      (legacyTile.arguments as Record<string, unknown>)["title"] =
        LEGACY_CLUSTER_CPU_TILE_TITLE;
      getFilterData(legacyTile)["aggegationType"] = AggregationType.Sum;

      const repaired: ReturnType<typeof KubernetesClusterCpuTileRepair.repair> =
        KubernetesClusterCpuTileRepair.repair({ components: [legacyTile] });

      expect(repaired).not.toBeNull();
      expect(
        (repaired!.config["components"] as Array<unknown>)[0],
      ).toStrictEqual(JSON.parse(JSON.stringify(busiestNodeTile)));
    });

    test("is not matched by the repair, so a new dashboard is never rewritten", (): void => {
      expect(
        KubernetesClusterCpuTileRepair.repair(
          JSON.parse(JSON.stringify(loadKubernetesTemplate())),
        )?.repairedTileCount ?? 0,
      ).toBe(0);
    });
  });

  test("no Value tile sums a per-resource gauge across the window", (): void => {
    const valueTiles: Array<DashboardBaseComponent> = getValueTiles(
      loadKubernetesTemplate(),
    );

    expect(valueTiles.length).toBeGreaterThan(0);

    for (const component of valueTiles) {
      const aggregation: unknown = getFilterData(component)["aggegationType"];

      expect(describeTile(component)).toBe(
        `"${String(getArguments(component)["title"])}" ${String(
          getFilterData(component)["metricName"],
        )}/${
          aggregation === AggregationType.Sum
            ? "<not Sum>"
            : String(aggregation)
        }`,
      );
    }
  });
});
