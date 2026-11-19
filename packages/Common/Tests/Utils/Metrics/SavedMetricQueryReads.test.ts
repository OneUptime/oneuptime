import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  MetricQueryRead,
  namedMetric,
  readDashboardMetricQueries,
  readMonitorStepsMetricQueries,
  readSloMetricQuery,
} from "../../../Utils/Metrics/SavedMetricQueryReads";

/*
 * The reader every saved metric query goes through: a Metrics monitor's
 * steps, a dashboard's widgets and an SLO's metric, each query of a metric
 * a caller wants read with where it is and what compares with it. The
 * moves off a deprecated metric read through it (their suites hold its
 * behaviour there); here, what an added metric's removal (#9807) needs of
 * it: any metric by its stored name, and the widget each query is on.
 */

const SWAP: string = "amazonaws.com/aws/rds/swapusage";
const CPU: string = "amazonaws.com/aws/rds/cpuutilization";
const DB: JSONObject = {
  Namespace: "AWS/RDS",
  "Dimensions.DBInstanceIdentifier": "orders",
};

function query(
  metricName: string,
  variable: string,
  extra: JSONObject = {},
): JSONObject {
  return {
    metricAliasData: { metricVariable: variable, title: "", legendUnit: "B" },
    metricQueryData: {
      filterData: {
        metricName,
        attributes: DB,
        aggegationType: "Max",
      },
      groupByAttributeKeys: ["Dimensions.Role"],
    },
    ...extra,
  };
}

function monitorSteps(data: {
  queries: Array<JSONObject>;
  filters: Array<JSONObject>;
}): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: "step-1",
            metricMonitor: {
              metricViewConfig: {
                queryConfigs: data.queries,
                formulaConfigs: [
                  {
                    metricAliasData: { metricVariable: "f" },
                    metricFormulaData: { metricFormula: "$a / 1024" },
                  },
                ],
              },
            },
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: { filters: data.filters },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
}

function component(
  componentType: string,
  args: JSONObject,
  id: string,
): JSONObject {
  return {
    _type: "DashboardComponent",
    componentId: { _type: "ObjectID", value: id },
    componentType,
    arguments: args,
  };
}

describe("a monitor's queries of a metric", () => {
  test("only those of the metric asked for, each with the thresholds and formulas that compare with it", () => {
    const steps: JSONObject = monitorSteps({
      queries: [query(CPU, "a"), query(SWAP.toUpperCase(), "b")],
      filters: [
        {
          checkOn: "Metric Value",
          filterType: "Greater Than",
          value: 80,
          metricMonitorOptions: { metricAlias: "a" },
        },
        {
          checkOn: "Metric Value",
          filterType: "Greater Than",
          value: "1073741824",
          metricMonitorOptions: { metricAlias: "b", thresholdUnit: "B" },
        },
      ],
    });
    const reads: Array<MetricQueryRead<true>> = readMonitorStepsMetricQueries(
      steps,
      namedMetric(SWAP),
    );

    expect(reads).toHaveLength(1);
    expect(reads[0]!.metricName).toBe(SWAP.toUpperCase());
    expect(reads[0]!.metricVariable).toBe("b");
    expect(reads[0]!.attributes).toEqual(DB);
    expect(reads[0]!.splitBy).toEqual(["Dimensions.Role"]);
    expect(reads[0]!.aggregation).toBe("Max");
    expect(
      reads[0]!.thresholds.map((threshold: { holder: JSONObject }) => {
        return threshold.holder["value"];
      }),
    ).toEqual(["1073741824"]);
    expect(reads[0]!.formulas).toHaveLength(1);
    expect(reads[0]!.widget).toBeUndefined();
  });

  test("a monitor that names the metric only in words reads none of it", () => {
    const steps: JSONObject = monitorSteps({
      queries: [
        {
          ...query(CPU, "a"),
          metricAliasData: {
            metricVariable: "a",
            description: `Was ${SWAP} before`,
          },
        },
      ],
      filters: [],
    });

    expect(readMonitorStepsMetricQueries(steps, namedMetric(SWAP))).toEqual([]);
    expect(readMonitorStepsMetricQueries(null, namedMetric(SWAP))).toEqual([]);
    expect(readMonitorStepsMetricQueries("{}", namedMetric(SWAP))).toEqual([]);
  });
});

describe("a dashboard's queries of a metric", () => {
  test("each with the widget it is on: its id and the title its type keeps", () => {
    const viewConfig: JSONObject = {
      _type: "DashboardViewConfig",
      components: [
        component(
          "Chart",
          {
            chartTitle: " Swap of orders ",
            metricQueryConfigs: [query(SWAP, "a"), query(CPU, "b")],
          },
          "chart-1",
        ),
        component(
          "Value",
          { title: "Swap now", metricQueryConfig: query(SWAP, "a") },
          "value-1",
        ),
        component(
          "Gauge",
          { gaugeTitle: "Swap gauge", metricQueryConfig: query(SWAP, "a") },
          "gauge-1",
        ),
        component(
          "Table",
          {
            tableTitle: "Databases",
            attributeFilters: DB,
            columns: [
              { kind: "metric", metricName: SWAP, variable: "a" },
              { kind: "metric", metricName: CPU, variable: "b" },
            ],
          },
          "table-1",
        ),
        // Untitled, and an id written as text.
        {
          componentId: "chart-2",
          componentType: "Chart",
          arguments: { metricQueryConfig: query(SWAP, "a") },
        },
        component("Text", { text: SWAP }, "text-1"),
      ],
    };

    expect(
      readDashboardMetricQueries(viewConfig, namedMetric(SWAP)).map(
        (read: MetricQueryRead<true>) => {
          return read.widget;
        },
      ),
    ).toEqual([
      {
        componentId: "chart-1",
        componentType: "chart",
        title: "Swap of orders",
      },
      { componentId: "value-1", componentType: "value", title: "Swap now" },
      { componentId: "gauge-1", componentType: "gauge", title: "Swap gauge" },
      { componentId: "table-1", componentType: "table", title: "Databases" },
      { componentId: "chart-2", componentType: "chart", title: "" },
    ]);
  });

  test("a table's column reads with the widget's filter", () => {
    const reads: Array<MetricQueryRead<true>> = readDashboardMetricQueries(
      {
        components: [
          component(
            "Table",
            {
              attributeFilters: DB,
              columns: [{ kind: "metric", metricName: SWAP, variable: "a" }],
            },
            "table-1",
          ),
        ],
      },
      namedMetric(SWAP),
    );

    expect(reads).toHaveLength(1);
    expect(reads[0]!.attributes).toEqual(DB);
  });
});

describe("an SLO's metric", () => {
  test("is read when it is the one asked for, its filter as the attributes it names", () => {
    const read: MetricQueryRead<true> | null = readSloMetricQuery(
      {
        metricName: SWAP,
        filter: "@Namespace:AWS/RDS @Dimensions.DBInstanceIdentifier:orders",
      },
      namedMetric(SWAP),
    );

    expect(read?.attributes).toEqual(DB);
    expect(read?.filterWords).toEqual([
      "@Namespace:AWS/RDS @Dimensions.DBInstanceIdentifier:orders",
    ]);
    expect(readSloMetricQuery({ metricName: CPU }, namedMetric(SWAP))).toBe(
      null,
    );
    expect(readSloMetricQuery(null, namedMetric(SWAP))).toBe(null);
  });

  test("a filter that is not only equal terms names no attribute it could be mistaken for", () => {
    expect(
      readSloMetricQuery(
        { metricName: SWAP, filter: "@Dimensions.DBInstanceIdentifier:order*" },
        namedMetric(SWAP),
      )?.attributes,
    ).toEqual({
      filter: { text: "@Dimensions.DBInstanceIdentifier:order*" },
    });
  });
});

describe("a stored name asked for", () => {
  test("matches whatever its case or the spaces around it, and nothing else", () => {
    const isSwap: (name: unknown) => true | null = namedMetric(` ${SWAP} `);

    expect(isSwap(SWAP)).toBe(true);
    expect(isSwap("amazonaws.com/AWS/RDS/SwapUsage")).toBe(true);
    expect(isSwap(`${SWAP}_sum`)).toBe(null);
    expect(isSwap(undefined)).toBe(null);
    expect(isSwap(42)).toBe(null);
  });
});
