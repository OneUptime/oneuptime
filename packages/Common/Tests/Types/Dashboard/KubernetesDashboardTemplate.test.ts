import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  KUBERNETES_AGENT_UPGRADE_DOCS_URL,
  KUBERNETES_RESTARTS_FALLBACK_HINT,
} from "../../../Types/Dashboard/DashboardTemplateFallbackHints";
import DashboardVariable from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import KubernetesClusterCpuTileRepair, {
  BUSIEST_NODE_CPU_TILE_TITLE,
  KUBERNETES_NODE_CPU_USAGE_METRIC,
  LEGACY_CLUSTER_CPU_TILE_TITLE,
} from "../../../Utils/Dashboard/KubernetesClusterCpuTileRepair";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";
import MetricQueryFallbackUtil, {
  ChartedMetricQueries,
} from "../../../Utils/Metrics/MetricQueryFallback";
import {
  CHART_DERIVED_METRICS,
  K8S_CLUSTER_RECEIVER_METRICS,
} from "../Monitor/Utils/KubernetesAgentEmittedMetrics";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Editorial invariants for the Kubernetes template specifically. The
 * structural rules every template must satisfy live in
 * DashboardTemplateInvariants; this file pins the aggregation of the
 * Kubernetes Value tiles, and what the restarts chart reads (restarts per
 * interval, falling back to the running count for older agents).
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

  /*
   * "Container Restarts Over Time" plotted the running count
   * (k8s.container.restarts, Max): a line that only ever steps up, whose
   * restarts the reader had to find as the steps in it. kubernetes-agent
   * chart 0.7.1 and later send, with every sample, the restarts since the
   * previous sample of the container (k8s.container.restarts.increase), so
   * their Sum per bar is the restarts in it. An older agent does not send
   * them, so the chart falls back to the running count, and says so.
   */
  describe("Container Restarts Over Time", () => {
    const RESTARTS_CHART_TITLE: string = "Container Restarts Over Time";

    function findRestartsChart(
      config: DashboardViewConfig = loadKubernetesTemplate(),
    ): DashboardBaseComponent {
      const charts: Array<DashboardBaseComponent> = config.components.filter(
        (component: DashboardBaseComponent): boolean => {
          return (
            component.componentType === DashboardComponentType.Chart &&
            getArguments(component)["chartTitle"] === RESTARTS_CHART_TITLE
          );
        },
      );

      expect(charts).toHaveLength(1);

      return charts[0]!;
    }

    function mainQuery(component: DashboardBaseComponent): MetricQueryConfigData {
      return getArguments(component)["metricQueryConfig"] as MetricQueryConfigData;
    }

    test("charts the restarts per interval: the Sum of k8s.container.restarts.increase, as bars", (): void => {
      const chart: DashboardBaseComponent = findRestartsChart();
      const query: MetricQueryConfigData = mainQuery(chart);

      expect(getArguments(chart)["chartType"]).toBe(DashboardChartType.Bar);
      expect(query.metricQueryData.filterData).toEqual({
        metricName: "k8s.container.restarts.increase",
        aggegationType: AggregationType.Sum,
      });
      expect(query.metricAliasData?.metricVariable).toBe("a");
      expect(query.metricAliasData?.legend).toBe("Restarts per interval");
      // The whole cluster (or the namespaces picked), never a rate of it.
      expect(query.metricQueryData.groupByAttributeKeys).toBeUndefined();
      expect(
        (query as unknown as Record<string, unknown>)["transformAsRate"],
      ).toBeUndefined();
      // One query: the fallback is the only other thing it reads.
      expect(getArguments(chart)["metricQueryConfigs"]).toBeUndefined();
      expect(getArguments(chart)["metricFormulaConfigs"]).toBeUndefined();
    });

    test("falls back to the running count, today's chart, with a legend that says which it is", (): void => {
      const query: MetricQueryConfigData = mainQuery(findRestartsChart());
      const fallback: MetricQueryConfigData | undefined =
        query.fallback?.queryConfig;

      expect(fallback?.metricQueryData.filterData).toEqual({
        metricName: "k8s.container.restarts",
        aggegationType: AggregationType.Max,
      });
      expect(fallback?.metricAliasData?.metricVariable).toBe("a");
      expect(fallback?.metricAliasData?.legend).toBe(
        "Restart count (older agent: upgrade it for restarts per interval)",
      );
      expect(fallback?.metricAliasData?.legend).not.toBe(
        query.metricAliasData?.legend,
      );
      expect(fallback?.metricQueryData.groupByAttributeKeys).toBeUndefined();
      // Fallbacks do not chain.
      expect(fallback?.fallback).toBeUndefined();
    });

    test("says why while it draws the running count, and links the agent's upgrade", (): void => {
      const query: MetricQueryConfigData = mainQuery(findRestartsChart());

      expect(query.fallback?.hint).toEqual(KUBERNETES_RESTARTS_FALLBACK_HINT);
      expect(query.fallback?.hint).toEqual({
        text: "Older Kubernetes agents send only the running restart count.",
        linkText: "Upgrade the agent",
        linkUrl: "/docs/monitor/kubernetes-agent#upgrading",
      });
      expect(KUBERNETES_AGENT_UPGRADE_DOCS_URL).toBe(
        "/docs/monitor/kubernetes-agent#upgrading",
      );
      // A link the chart draws as it is.
      expect(
        MetricQueryFallbackUtil.getSafeLinkUrl(query.fallback?.hint?.linkUrl),
      ).toBe(KUBERNETES_AGENT_UPGRADE_DOCS_URL);

      // ...to a heading the English page has.
      const page: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Docs/Content/en/monitor/kubernetes-agent.md",
        ),
        "utf8",
      );
      expect(page.split("\n")).toContain("## Upgrading");
    });

    test("reads what the agent sends: the increase from chart 0.7.1, the count from every chart", (): void => {
      const query: MetricQueryConfigData = mainQuery(findRestartsChart());

      expect(CHART_DERIVED_METRICS).toContain(
        String(query.metricQueryData.filterData.metricName),
      );
      expect(K8S_CLUSTER_RECEIVER_METRICS).toContain(
        String(query.fallback?.queryConfig.metricQueryData.filterData.metricName),
      );
    });

    test("stored and read back, it draws the increase while there is one, and the count while there is not", (): void => {
      const stored: MetricQueryConfigData = mainQuery(
        findRestartsChart(
          JSON.parse(
            JSON.stringify(loadKubernetesTemplate()),
          ) as DashboardViewConfig,
        ),
      );
      const point: (value: number) => AggregatedResult = (
        value: number,
      ): AggregatedResult => {
        return {
          data: [{ timestamp: new Date("2026-10-31T09:00:00.000Z"), value }],
        };
      };

      // An upgraded agent: the increase has data, nothing more is asked.
      expect(
        MetricQueryFallbackUtil.getFallbackQueryConfigs([stored], [point(0)]),
      ).toBeNull();

      // An older agent: asked again for the count, which is drawn.
      const again: Array<MetricQueryConfigData> | null =
        MetricQueryFallbackUtil.getFallbackQueryConfigs([stored], [{ data: [] }]);
      expect(again?.[0]?.metricQueryData.filterData.metricName).toBe(
        "k8s.container.restarts",
      );

      const charted: ChartedMetricQueries = MetricQueryFallbackUtil.resolve({
        queryConfigs: [stored],
        results: [{ data: [] }],
        fallbackResults: [point(4)],
      });
      expect(charted.fallbackIndexes).toEqual([0]);
      expect(charted.queryConfigs[0]?.metricAliasData?.legend).toBe(
        "Restart count (older agent: upgrade it for restarts per interval)",
      );
      expect(
        MetricQueryFallbackUtil.getHints([stored], charted.fallbackIndexes),
      ).toEqual([KUBERNETES_RESTARTS_FALLBACK_HINT]);
    });

    test("the cluster and namespace pickers scope the fallback as they scope the restarts", (): void => {
      const config: DashboardViewConfig = loadKubernetesTemplate();
      const variables: Array<DashboardVariable> = (config.variables || []).map(
        (variable: DashboardVariable): DashboardVariable => {
          return variable.isMultiSelect
            ? { ...variable, selectedValues: ["payments", "checkout"] }
            : { ...variable, selectedValue: "prod-eu" };
        },
      );

      expect(
        variables.map((variable: DashboardVariable): string | undefined => {
          return variable.attributeKey;
        }),
      ).toEqual(["resource.k8s.cluster.name", "resource.k8s.namespace.name"]);

      const scoped: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(
          mainQuery(findRestartsChart(config)),
          variables,
        );

      for (const filterData of [
        scoped.metricQueryData.filterData,
        scoped.fallback!.queryConfig.metricQueryData.filterData,
      ]) {
        expect(filterData.attributes).toEqual({
          "resource.k8s.cluster.name": "prod-eu",
          "resource.k8s.namespace.name": new Includes(["payments", "checkout"]),
        });
      }
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
