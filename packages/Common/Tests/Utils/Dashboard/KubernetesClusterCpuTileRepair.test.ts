import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { JSONObject } from "../../../Types/JSON";
import KubernetesClusterCpuTileRepair, {
  BUSIEST_NODE_CPU_TILE_TITLE,
  KUBERNETES_NODE_CPU_USAGE_METRIC,
  KubernetesClusterCpuTileRepairResult,
  LEGACY_CLUSTER_CPU_TILE_TITLE,
} from "../../../Utils/Dashboard/KubernetesClusterCpuTileRepair";
import { describe, expect, test } from "@jest/globals";

/*
 * The repair behind the RepairKubernetesDashboardClusterCpuTile migration.
 * Existing Kubernetes dashboards hold a COPY of the template, so their
 * "Cluster CPU (cores in use)" tile still sums k8s.node.cpu.usage over every
 * node, scrape and bucket. What is pinned here: exactly which tiles are
 * rewritten, to what, that nothing else on the dashboard moves, and that
 * the Postgres filter the migration selects rows with agrees with the
 * in-memory matcher.
 *
 * Fixtures are shaped like a stored dashboardViewConfig: plain jsonb, with
 * componentId serialised as { _type: "ObjectID", value } and the
 * misspelled `aggegationType` the fetch layer reads.
 */

function makeValueTile(data: {
  componentId?: string;
  title?: string;
  metricName?: string;
  aggregation?: string;
  extraArguments?: JSONObject;
  extraFilterData?: JSONObject;
}): JSONObject {
  return {
    _type: "DashboardComponent",
    componentType: "Value",
    componentId: {
      _type: "ObjectID",
      value: data.componentId || "0b6a2c3e-0000-4000-8000-000000000001",
    },
    topInDashboardUnits: 11,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    minWidthInDashboardUnits: 1,
    arguments: {
      title: data.title ?? LEGACY_CLUSTER_CPU_TILE_TITLE,
      metricQueryConfig: {
        metricQueryData: {
          filterData: {
            metricName: data.metricName ?? KUBERNETES_NODE_CPU_USAGE_METRIC,
            aggegationType: data.aggregation ?? AggregationType.Sum,
            ...(data.extraFilterData || {}),
          },
        },
      },
      trendDirection: "HigherIsWorse",
      ...(data.extraArguments || {}),
    },
  };
}

function makeConfig(components: Array<unknown>): JSONObject {
  return {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 21,
    variables: [
      {
        id: "cluster",
        name: "Cluster",
        type: "Telemetry Attribute",
        attributeKey: "resource.k8s.cluster.name",
      },
    ],
    components: components as Array<JSONObject>,
  };
}

function componentsOf(config: JSONObject): Array<JSONObject> {
  return config["components"] as Array<JSONObject>;
}

function filterDataOf(component: JSONObject): JSONObject {
  const args: JSONObject = component["arguments"] as JSONObject;
  const metricQueryConfig: JSONObject = args["metricQueryConfig"] as JSONObject;
  const metricQueryData: JSONObject = metricQueryConfig[
    "metricQueryData"
  ] as JSONObject;

  return metricQueryData["filterData"] as JSONObject;
}

/*
 * Postgres `@>` for jsonb, as documented (8.14.3): an object contains
 * another when every key of the right side is present and contains its
 * value; an array contains another when every element of the right side is
 * contained by SOME element of the left; scalars must be equal. Used only to
 * show that the migration's SQL filter and isLegacyTile pick the same rows.
 */
function jsonbContains(left: unknown, right: unknown): boolean {
  if (Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      right.every((rightItem: unknown) => {
        return left.some((leftItem: unknown) => {
          return jsonbContains(leftItem, rightItem);
        });
      })
    );
  }

  if (right && typeof right === "object") {
    if (!left || typeof left !== "object" || Array.isArray(left)) {
      return false;
    }

    return Object.entries(right as JSONObject).every(
      ([key, value]: [string, unknown]) => {
        return (
          Object.prototype.hasOwnProperty.call(left, key) &&
          jsonbContains((left as JSONObject)[key], value)
        );
      },
    );
  }

  return left === right;
}

const TEXT_HEADER: JSONObject = {
  _type: "DashboardComponent",
  componentType: "Text",
  componentId: { _type: "ObjectID", value: "text-header" },
  arguments: { text: "Resource Health", isBold: true },
};

const NETWORK_CHART: JSONObject = {
  _type: "DashboardComponent",
  componentType: "Chart",
  componentId: { _type: "ObjectID", value: "network-chart" },
  arguments: {
    chartTitle: "Network I/O",
    metricQueryConfig: {
      metricQueryData: {
        filterData: {
          metricName: "k8s.pod.network.io",
          aggegationType: AggregationType.Sum,
        },
      },
    },
  },
};

describe("KubernetesClusterCpuTileRepair", () => {
  describe("repair", () => {
    test("rewrites the legacy tile to the busiest node's peak CPU", () => {
      const result: KubernetesClusterCpuTileRepairResult | null =
        KubernetesClusterCpuTileRepair.repair(
          makeConfig([TEXT_HEADER, makeValueTile({}), NETWORK_CHART]),
        );

      expect(result).not.toBeNull();
      expect(result!.repairedTileCount).toBe(1);

      const tile: JSONObject = componentsOf(result!.config)[1]!;
      expect((tile["arguments"] as JSONObject)["title"]).toBe(
        BUSIEST_NODE_CPU_TILE_TITLE,
      );
      expect(filterDataOf(tile)["aggegationType"]).toBe(AggregationType.Max);
      expect(filterDataOf(tile)["metricName"]).toBe(
        KUBERNETES_NODE_CPU_USAGE_METRIC,
      );
    });

    test("changes only the title and the aggregation", () => {
      const original: JSONObject = makeConfig([
        TEXT_HEADER,
        makeValueTile({
          extraArguments: { warningThreshold: 3, criticalThreshold: 6 },
          extraFilterData: { attributes: { "resource.k8s.node.name": "a" } },
        }),
        NETWORK_CHART,
      ]);

      const expected: JSONObject = JSON.parse(JSON.stringify(original));
      const expectedTile: JSONObject = componentsOf(expected)[1]!;
      (expectedTile["arguments"] as JSONObject)["title"] =
        BUSIEST_NODE_CPU_TILE_TITLE;
      filterDataOf(expectedTile)["aggegationType"] = AggregationType.Max;

      expect(KubernetesClusterCpuTileRepair.repair(original)!.config).toEqual(
        expected,
      );
    });

    test("never mutates the config it was given", () => {
      const original: JSONObject = makeConfig([makeValueTile({})]);
      const snapshot: string = JSON.stringify(original);

      KubernetesClusterCpuTileRepair.repair(original);

      expect(JSON.stringify(original)).toBe(snapshot);
    });

    test("repairs every copy of the tile on one dashboard", () => {
      const result: KubernetesClusterCpuTileRepairResult | null =
        KubernetesClusterCpuTileRepair.repair(
          makeConfig([
            makeValueTile({ componentId: "first" }),
            makeValueTile({ componentId: "second" }),
          ]),
        );

      expect(result!.repairedTileCount).toBe(2);
      for (const tile of componentsOf(result!.config)) {
        expect(filterDataOf(tile)["aggegationType"]).toBe(AggregationType.Max);
      }
    });

    test("is a no-op on its own output, so a second run writes nothing", () => {
      const once: KubernetesClusterCpuTileRepairResult | null =
        KubernetesClusterCpuTileRepair.repair(makeConfig([makeValueTile({})]));

      expect(once).not.toBeNull();
      expect(KubernetesClusterCpuTileRepair.repair(once!.config)).toBeNull();
    });

    /*
     * The migration only corrects what the template put there. A user who
     * renamed the tile, re-aggregated it, pointed it at another metric or
     * drew the same query as a chart made that choice themselves.
     */
    test.each([
      ["a renamed tile", makeValueTile({ title: "All Nodes CPU" })],
      [
        "a title that differs only in whitespace",
        makeValueTile({ title: ` ${LEGACY_CLUSTER_CPU_TILE_TITLE}` }),
      ],
      [
        "a tile already re-aggregated to Avg",
        makeValueTile({ aggregation: AggregationType.Avg }),
      ],
      [
        "a tile already re-aggregated to Max",
        makeValueTile({ aggregation: AggregationType.Max }),
      ],
      [
        "a Sum tile over another metric",
        makeValueTile({ metricName: "k8s.pod.cpu.usage" }),
      ],
      [
        "a chart with the same title, metric and Sum",
        { ...makeValueTile({}), componentType: "Chart" },
      ],
      ["a text widget", TEXT_HEADER],
    ])("leaves %s alone", (_label: string, component: JSONObject) => {
      expect(
        KubernetesClusterCpuTileRepair.repair(makeConfig([component])),
      ).toBeNull();
    });

    test.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", "not a config"],
      ["an array", [makeValueTile({})]],
      ["a config without components", { _type: "DashboardViewConfig" }],
      [
        "a config whose components are not an array",
        { components: { 0: makeValueTile({}) } },
      ],
      ["a config with no components", makeConfig([])],
    ])("returns null for %s", (_label: string, config: unknown) => {
      expect(KubernetesClusterCpuTileRepair.repair(config)).toBeNull();
    });

    test("skips malformed components without throwing", () => {
      const result: KubernetesClusterCpuTileRepairResult | null =
        KubernetesClusterCpuTileRepair.repair(
          makeConfig([
            null,
            "text",
            42,
            { componentType: "Value" },
            { componentType: "Value", arguments: null },
            {
              componentType: "Value",
              arguments: { title: LEGACY_CLUSTER_CPU_TILE_TITLE },
            },
            makeValueTile({}),
          ]),
        );

      expect(result!.repairedTileCount).toBe(1);
      expect(componentsOf(result!.config).slice(0, 6)).toEqual([
        null,
        "text",
        42,
        { componentType: "Value" },
        { componentType: "Value", arguments: null },
        {
          componentType: "Value",
          arguments: { title: LEGACY_CLUSTER_CPU_TILE_TITLE },
        },
      ]);
    });
  });

  describe("getLegacyTileContainment", () => {
    /*
     * The migration reads only the dashboards Postgres matches with this
     * document, then repairs them with isLegacyTile. If the two disagree,
     * a dashboard is either never read or read and left unrepaired.
     */
    test.each([
      ["the legacy tile", makeConfig([TEXT_HEADER, makeValueTile({})]), true],
      [
        "the legacy tile with user thresholds and filters",
        makeConfig([
          makeValueTile({
            extraArguments: { warningThreshold: 3 },
            extraFilterData: { attributes: { "resource.k8s.node.name": "a" } },
          }),
        ]),
        true,
      ],
      [
        "a repaired tile",
        makeConfig([
          makeValueTile({
            title: BUSIEST_NODE_CPU_TILE_TITLE,
            aggregation: AggregationType.Max,
          }),
        ]),
        false,
      ],
      [
        "the title on one tile and the Sum on another",
        makeConfig([
          makeValueTile({ aggregation: AggregationType.Avg }),
          makeValueTile({ title: "All Nodes CPU" }),
        ]),
        false,
      ],
      [
        "a chart with the legacy signature",
        makeConfig([{ ...makeValueTile({}), componentType: "Chart" }]),
        false,
      ],
      [
        "an unrelated dashboard",
        makeConfig([TEXT_HEADER, NETWORK_CHART]),
        false,
      ],
    ])(
      "agrees with repair() on %s",
      (_label: string, config: JSONObject, shouldMatch: boolean) => {
        expect(
          jsonbContains(
            config,
            KubernetesClusterCpuTileRepair.getLegacyTileContainment(),
          ),
        ).toBe(shouldMatch);
        expect(KubernetesClusterCpuTileRepair.repair(config) !== null).toBe(
          shouldMatch,
        );
      },
    );
  });
});
