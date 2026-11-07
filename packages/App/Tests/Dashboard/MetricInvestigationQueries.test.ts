import { describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import MetricInvestigationQueryUtil, {
  MetricInvestigationQueries,
  MetricInvestigationQueriesUrlValue,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationQueries";

/*
 * The metrics a metric investigation charts (issue #5954): when two lists
 * chart the same thing, and how they are kept in the URL.
 */

function query(input: {
  metricName: string;
  variable?: string | undefined;
  attributes?: Record<string, unknown> | undefined;
  aggregation?: MetricsAggregationType | undefined;
  groupBy?: Array<string> | undefined;
  id?: string | undefined;
}): MetricQueryConfigData {
  return {
    ...(input.id ? { id: input.id } : {}),
    metricAliasData: {
      metricVariable: input.variable || "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
        attributes: (input.attributes || {}) as never,
        aggegationType: input.aggregation || MetricsAggregationType.Avg,
      },
      ...(input.groupBy ? { groupByAttributeKeys: input.groupBy } : {}),
    },
  };
}

function formula(variable: string, text: string): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricFormulaData: { metricFormula: text },
  };
}

// What a grouped monitor's incident stores: narrowed to its series.
const INCIDENT_QUERIES: MetricInvestigationQueries = {
  queryConfigs: [
    query({
      id: "first-id",
      metricName: "pod_memory_limit_saturation",
      attributes: {
        "resource.k8s.namespace.name": "default",
        "resource.k8s.pod.name": "oneuptime-clickhouse-shard0-0",
        "resource.k8s.node.name": new IsNull(),
      },
      groupBy: ["resource.k8s.namespace.name", "resource.k8s.pod.name"],
    }),
  ],
  formulaConfigs: [],
};

describe("normalize", () => {
  test("no queries are an empty list", () => {
    expect(MetricInvestigationQueryUtil.normalize(null)).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
    expect(MetricInvestigationQueryUtil.normalize(undefined)).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
  });

  test("a missing or malformed list is an empty one", () => {
    expect(
      MetricInvestigationQueryUtil.normalize({
        queryConfigs: INCIDENT_QUERIES.queryConfigs,
      }),
    ).toEqual({
      queryConfigs: INCIDENT_QUERIES.queryConfigs,
      formulaConfigs: [],
    });
    expect(
      MetricInvestigationQueryUtil.normalize({
        queryConfigs: "nope" as never,
        formulaConfigs: [],
      }).queryConfigs,
    ).toEqual([]);
  });

  test("well-formed queries come back as the very same object", () => {
    expect(MetricInvestigationQueryUtil.normalize(INCIDENT_QUERIES)).toBe(
      INCIDENT_QUERIES,
    );
  });
});

describe("isSame", () => {
  test("a copy charts the same thing, ids and run-time helpers aside", () => {
    const copy: MetricInvestigationQueries = {
      queryConfigs: [
        {
          ...query({
            id: "another-id",
            metricName: "pod_memory_limit_saturation",
            attributes: {
              "resource.k8s.namespace.name": "default",
              "resource.k8s.pod.name": "oneuptime-clickhouse-shard0-0",
              // Another instance of the same operator.
              "resource.k8s.node.name": new IsNull(),
            },
            groupBy: ["resource.k8s.namespace.name", "resource.k8s.pod.name"],
          }),
          getSeries: () => {
            return { title: "x" };
          },
          transformValue: (value: number): number => {
            return value * 2;
          },
        },
      ],
      formulaConfigs: [],
    };

    expect(MetricInvestigationQueryUtil.isSame(INCIDENT_QUERIES, copy)).toBe(
      true,
    );
  });

  test.each([
    ["another metric", { metricName: "pod_cpu_saturation" }],
    [
      "another filter value",
      {
        attributes: {
          "resource.k8s.namespace.name": "default",
          "resource.k8s.pod.name": "another-pod",
          "resource.k8s.node.name": new IsNull(),
        },
      },
    ],
    [
      "a filter taken off",
      {
        attributes: {
          "resource.k8s.namespace.name": "default",
          "resource.k8s.node.name": new IsNull(),
        },
      },
    ],
    ["another aggregation", { aggregation: MetricsAggregationType.Max }],
    ["another grouping", { groupBy: ["resource.k8s.pod.name"] }],
  ])(
    "%s is a change",
    (
      _name: string,
      change: {
        metricName?: string;
        attributes?: Record<string, unknown>;
        aggregation?: MetricsAggregationType;
        groupBy?: Array<string>;
      },
    ) => {
      const changed: MetricInvestigationQueries = {
        queryConfigs: [
          query({
            metricName: change.metricName || "pod_memory_limit_saturation",
            attributes: change.attributes || {
              "resource.k8s.namespace.name": "default",
              "resource.k8s.pod.name": "oneuptime-clickhouse-shard0-0",
              "resource.k8s.node.name": new IsNull(),
            },
            aggregation: change.aggregation,
            groupBy: change.groupBy || [
              "resource.k8s.namespace.name",
              "resource.k8s.pod.name",
            ],
          }),
        ],
        formulaConfigs: [],
      };

      expect(
        MetricInvestigationQueryUtil.isSame(INCIDENT_QUERIES, changed),
      ).toBe(false);
    },
  );

  test("a metric added, even one still waiting for its name, is a change", () => {
    const added: MetricInvestigationQueries = {
      queryConfigs: [
        ...INCIDENT_QUERIES.queryConfigs,
        query({ metricName: "", variable: "b" }),
      ],
      formulaConfigs: [],
    };

    expect(MetricInvestigationQueryUtil.isSame(INCIDENT_QUERIES, added)).toBe(
      false,
    );
  });

  test("order matters: it is the order of the charts", () => {
    const first: MetricQueryConfigData = query({
      metricName: "a_metric",
      variable: "a",
    });
    const second: MetricQueryConfigData = query({
      metricName: "b_metric",
      variable: "b",
    });

    expect(
      MetricInvestigationQueryUtil.isSame(
        { queryConfigs: [first, second], formulaConfigs: [] },
        { queryConfigs: [second, first], formulaConfigs: [] },
      ),
    ).toBe(false);
  });

  test("a formula added or changed is a change", () => {
    const withFormula: MetricInvestigationQueries = {
      queryConfigs: INCIDENT_QUERIES.queryConfigs,
      formulaConfigs: [formula("b", "a * 100")],
    };

    expect(
      MetricInvestigationQueryUtil.isSame(INCIDENT_QUERIES, withFormula),
    ).toBe(false);
    expect(
      MetricInvestigationQueryUtil.isSame(withFormula, {
        ...withFormula,
        formulaConfigs: [formula("b", "a * 1000")],
      }),
    ).toBe(false);
  });

  test("the same object, or two missing lists, are the same", () => {
    expect(
      MetricInvestigationQueryUtil.isSame(INCIDENT_QUERIES, INCIDENT_QUERIES),
    ).toBe(true);
    expect(MetricInvestigationQueryUtil.isSame(null, undefined)).toBe(true);
    expect(
      MetricInvestigationQueryUtil.isSame(null, {
        queryConfigs: [],
        formulaConfigs: [],
      }),
    ).toBe(true);
  });
});

describe("hasAnyMetric", () => {
  test("only a query with its metric picked has something to chart", () => {
    expect(MetricInvestigationQueryUtil.hasAnyMetric(INCIDENT_QUERIES)).toBe(
      true,
    );
    expect(
      MetricInvestigationQueryUtil.hasAnyMetric({
        queryConfigs: [query({ metricName: "" })],
        formulaConfigs: [],
      }),
    ).toBe(false);
    expect(MetricInvestigationQueryUtil.hasAnyMetric(null)).toBe(false);
  });
});

describe("the URL", () => {
  test("queries are kept in the metric explorer's own format", () => {
    const value: MetricInvestigationQueriesUrlValue | null =
      MetricInvestigationQueryUtil.toUrlValue(INCIDENT_QUERIES);

    expect(value).not.toBeNull();
    expect(value!.formulas).toBeUndefined();

    const parsed: Array<Record<string, unknown>> = JSON.parse(
      value!.queries,
    ) as Array<Record<string, unknown>>;

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!["metricName"]).toBe("pod_memory_limit_saturation");
    expect(parsed[0]!["variable"]).toBe("a");
    expect(parsed[0]!["groupByAttributeKeys"]).toEqual([
      "resource.k8s.namespace.name",
      "resource.k8s.pod.name",
    ]);
  });

  test("they read back as the same charts, operator filters and formulas included", () => {
    const queries: MetricInvestigationQueries = {
      queryConfigs: [
        query({
          metricName: "http.server.duration",
          variable: "a",
          aggregation: MetricsAggregationType.P99,
          attributes: {
            "service.name": new Includes(["api", "web"]),
            "http.route": new NotEqual("/health"),
            "k8s.node.name": new IsNull(),
            "http.status_code": "500",
          },
          groupBy: ["service.name"],
        }),
        query({ metricName: "http.server.requests", variable: "b" }),
      ],
      formulaConfigs: [formula("c", "a / b")],
    };

    const value: MetricInvestigationQueriesUrlValue | null =
      MetricInvestigationQueryUtil.toUrlValue(queries);

    expect(value?.formulas).toBeDefined();

    const readBack: MetricInvestigationQueries | null =
      MetricInvestigationQueryUtil.fromUrlValue(value!);

    expect(readBack).not.toBeNull();
    expect(MetricInvestigationQueryUtil.isSame(readBack, queries)).toBe(true);
    // Rebuilt queries get ids of their own, for the charts' state.
    expect(readBack!.queryConfigs[0]!.id).toBeTruthy();
    expect(readBack!.queryConfigs[1]!.id).not.toBe(
      readBack!.queryConfigs[0]!.id,
    );
  });

  test("what charts nothing is not kept", () => {
    const value: MetricInvestigationQueriesUrlValue | null =
      MetricInvestigationQueryUtil.toUrlValue({
        queryConfigs: [
          query({ metricName: "a_metric", variable: "a" }),
          query({ metricName: "", variable: "b" }),
        ],
        formulaConfigs: [formula("c", "   ")],
      });

    expect(JSON.parse(value!.queries)).toHaveLength(1);
    expect(value!.formulas).toBeUndefined();
  });

  test("nothing to keep is no URL value", () => {
    expect(
      MetricInvestigationQueryUtil.toUrlValue({
        queryConfigs: [query({ metricName: "" })],
        formulaConfigs: [formula("b", "a * 2")],
      }),
    ).toBeNull();
    expect(
      MetricInvestigationQueryUtil.toUrlValue({
        queryConfigs: [],
        formulaConfigs: [],
      }),
    ).toBeNull();
  });

  test.each([
    ["nothing", null],
    ["an empty string", ""],
    ["not JSON", "{oops"],
    ["not a list", '{"metricName":"a"}'],
    ["an empty list", "[]"],
    ["only queries with no metric", '[{"metricName":""}]'],
    ["garbage entries", '[1, null, "x", []]'],
  ])("%s reads as no queries", (_name: string, raw: string | null) => {
    expect(
      MetricInvestigationQueryUtil.fromUrlValue({ queries: raw }),
    ).toBeNull();
  });

  test("garbage formulas are dropped, the queries kept", () => {
    const readBack: MetricInvestigationQueries | null =
      MetricInvestigationQueryUtil.fromUrlValue({
        queries: '[{"metricName":"a_metric"}]',
        formulas: "not json",
      });

    expect(readBack?.queryConfigs).toHaveLength(1);
    expect(readBack?.formulaConfigs).toEqual([]);
  });

  test("any queries read back as the same charts (seeded)", () => {
    const random: SeededRandom = seededRandom(5954);
    const names: Array<string> = generatedTexts(400, 5954, [
      "a",
      "z",
      "_",
      ".",
      "9",
      "é",
      " ",
      "-",
      "%",
      '"',
      "/",
      "&",
      "=",
      "?",
      "#",
    ]).filter((name: string): boolean => {
      return name.trim() !== "";
    });
    const aggregations: Array<MetricsAggregationType> = Object.values(
      MetricsAggregationType,
    ) as Array<MetricsAggregationType>;

    for (let draw: number = 0; draw < 150; draw++) {
      const queryCount: number = 1 + random(3);
      const queryConfigs: Array<MetricQueryConfigData> = [];

      for (let index: number = 0; index < queryCount; index++) {
        const attributes: Record<string, unknown> = {};
        const attributeCount: number = random(4);

        for (let entry: number = 0; entry < attributeCount; entry++) {
          const key: string = names[random(names.length)]!;
          const kind: number = random(4);

          attributes[key] =
            kind === 0
              ? names[random(names.length)]!
              : kind === 1
                ? new IsNull()
                : kind === 2
                  ? new NotEqual(names[random(names.length)]!)
                  : new Includes([
                      names[random(names.length)]!,
                      names[random(names.length)]!,
                    ]);
        }

        queryConfigs.push(
          query({
            metricName: names[random(names.length)]!,
            variable: String.fromCharCode(97 + index),
            aggregation: aggregations[random(aggregations.length)],
            attributes: attributes,
            ...(random(2) === 0
              ? { groupBy: [names[random(names.length)]!] }
              : {}),
          }),
        );
      }

      const queries: MetricInvestigationQueries = {
        queryConfigs: queryConfigs,
        formulaConfigs:
          random(2) === 0 ? [formula("z", `${"a"} * ${1 + random(9)}`)] : [],
      };

      const readBack: MetricInvestigationQueries | null =
        MetricInvestigationQueryUtil.fromUrlValue(
          MetricInvestigationQueryUtil.toUrlValue(queries)!,
        );

      expect(MetricInvestigationQueryUtil.getKey(readBack)).toBe(
        MetricInvestigationQueryUtil.getKey(queries),
      );
    }
  });
});
