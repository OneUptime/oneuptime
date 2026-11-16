import { AggregationTemporality } from "../../../Models/AnalyticsModels/Metric";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { JSONObject } from "../../../Types/JSON";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricZeroFill, {
  MetricPointSemantics,
  MetricZeroFillOptions,
} from "../../../Utils/Metrics/MetricZeroFill";
import { describe, expect, test } from "@jest/globals";

/*
 * A FORMULA READS A COUNTING QUERY WITH NO POINT IN A STEP AS 0 (#6761).
 *
 * The failure share `$b / $a * 100` over two Sum queries of a delta
 * counter - everything sent, and what failed - drew no point in a step with
 * no failure, as `b` has none there. With the catalog's word on the metric
 * (`zeroFill`), such a query reads as 0 in a settled step another variable
 * has a point in, and in a group it has no series for. A gauge, an average,
 * a percentile, a formula and a metric the catalog does not know keep their
 * gaps, and a step none of the variables has a point in draws nothing.
 */

const T0: string = "2026-11-01T00:00:00.000Z";
const T1: string = "2026-11-01T00:01:00.000Z";
const T2: string = "2026-11-01T00:02:00.000Z";
const T3: string = "2026-11-01T00:03:00.000Z";

const SENT: string = "notification.send.count";
const MEMORY: string = "system.memory.usage";
const DURATION: string = "http.server.request.duration";
const CUMULATIVE_REQUESTS: string = "http.server.requests";
const CONNECTIONS: string = "db.client.connections.usage";

const CATALOG: Map<string, MetricPointSemantics> = new Map<
  string,
  MetricPointSemantics
>([
  [
    SENT,
    { isMonotonic: true, aggregationTemporality: AggregationTemporality.Delta },
  ],
  [MEMORY, { isMonotonic: null, aggregationTemporality: null }],
  [
    DURATION,
    { isMonotonic: null, aggregationTemporality: AggregationTemporality.Delta },
  ],
  [
    CUMULATIVE_REQUESTS,
    {
      isMonotonic: true,
      aggregationTemporality: AggregationTemporality.Cumulative,
    },
  ],
  [
    CONNECTIONS,
    {
      isMonotonic: false,
      aggregationTemporality: AggregationTemporality.Cumulative,
    },
  ],
]);

// Every step settled: a read of the past.
const ZERO_FILL: MetricZeroFillOptions = { semanticsByMetricName: CATALOG };

const query: (input: {
  variable: string;
  metricName: string;
  aggregation: AggregationType;
  groupByAttributeKeys?: Array<string> | undefined;
}) => MetricQueryConfigData = (input: {
  variable: string;
  metricName: string;
  aggregation: AggregationType;
  groupByAttributeKeys?: Array<string> | undefined;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: input.variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
        aggegationType: input.aggregation,
      },
      ...(input.groupByAttributeKeys
        ? { groupByAttributeKeys: input.groupByAttributeKeys }
        : {}),
    },
  } as MetricQueryConfigData;
};

const formulaConfig: (
  variable: string,
  formula: string,
) => MetricFormulaConfigData = (
  variable: string,
  formula: string,
): MetricFormulaConfigData => {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricFormulaData: { metricFormula: formula },
  };
};

const sent: (variable: string) => MetricQueryConfigData = (
  variable: string,
): MetricQueryConfigData => {
  return query({
    variable,
    metricName: SENT,
    aggregation: AggregationType.Sum,
  });
};

const result: (points: Array<[string, number]>) => AggregatedResult = (
  points: Array<[string, number]>,
): AggregatedResult => {
  return {
    data: points.map((point: [string, number]): AggregatedModel => {
      return { timestamp: new Date(point[0]), value: point[1] };
    }),
  };
};

const grouped: (
  points: Array<[string, number, Record<string, string>]>,
) => AggregatedResult = (
  points: Array<[string, number, Record<string, string>]>,
): AggregatedResult => {
  return {
    data: points.map(
      (point: [string, number, Record<string, string>]): AggregatedModel => {
        return {
          timestamp: new Date(point[0]),
          value: point[1],
          attributes: point[2],
        };
      },
    ),
  };
};

const values: (output: AggregatedResult) => Array<[string, number]> = (
  output: AggregatedResult,
): Array<[string, number]> => {
  return output.data.map((row: AggregatedModel): [string, number] => {
    return [new Date(row.timestamp).toISOString(), row.value];
  });
};

const valuesByGroup: (
  output: AggregatedResult,
  key: string,
) => Array<[string, string, number]> = (
  output: AggregatedResult,
  key: string,
): Array<[string, string, number]> => {
  return output.data.map((row: AggregatedModel): [string, string, number] => {
    const attributes: JSONObject =
      ((row as unknown as JSONObject)["attributes"] as JSONObject) || {};
    return [
      String(attributes[key]),
      new Date(row.timestamp).toISOString(),
      row.value,
    ];
  });
};

// Everything sent, and what failed: no failure in the first and last steps.
const SENT_RESULTS: Array<AggregatedResult> = [
  result([
    [T0, 200],
    [T1, 100],
    [T2, 50],
  ]),
  result([[T1, 2]]),
];

describe("A failure share over two counting queries", () => {
  test("without the catalog's word, a step with no failure draws no point, as before", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: SENT_RESULTS,
    });

    expect(values(output)).toEqual([[T1, 2]]);
  });

  test("with it, a step with requests and no failure draws 0%", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: SENT_RESULTS,
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([
      [T0, 0],
      [T1, 2],
      [T2, 0],
    ]);
    expect(Object.keys(output.data[0]!)).toEqual(["timestamp", "value"]);
  });

  test("a failures query with no point in the whole window reads 0% wherever anything was sent", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [SENT_RESULTS[0]!, { data: [] }],
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([
      [T0, 0],
      [T1, 0],
      [T2, 0],
    ]);
  });

  test("a step neither query has a point in draws nothing: the pipeline was quiet", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [
        result([
          [T0, 200],
          [T2, 50],
        ]),
        result([[T2, 1]]),
      ],
      zeroFill: ZERO_FILL,
    });

    // T1 and T3 have no point of either: no data, never 0%.
    expect(values(output)).toEqual([
      [T0, 0],
      [T2, 2],
    ]);
  });

  test("nothing at all read draws nothing", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [{ data: [] }, { data: [] }],
      zeroFill: ZERO_FILL,
    });

    expect(output.data).toEqual([]);
  });

  test("a step with failures and nothing sent reads 0 sent, and divides by zero: no point", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [result([[T0, 200]]), result([[T1, 3]])],
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([[T0, 0]]);
  });

  test("a share of failures over successes and failures reads 100% when nothing succeeded", () => {
    // a: what succeeded, b: what failed - the share the old join never drew.
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / ($a + $b) * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [
        result([[T0, 98]]),
        result([
          [T0, 2],
          [T1, 5],
        ]),
      ],
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([
      [T0, 2],
      [T1, 100],
    ]);
  });

  test("a sum of two counts is the one that has a point", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "a + b",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [result([[T0, 5]]), result([[T1, 7]])],
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([
      [T0, 5],
      [T1, 7],
    ]);
  });
});

describe("What is not read as 0", () => {
  test("a gauge with no sample is unknown: `desired - ready` never reads a missing sample as 0 ready", () => {
    const gauge: (variable: string) => MetricQueryConfigData = (
      variable: string,
    ): MetricQueryConfigData => {
      return query({
        variable,
        metricName: MEMORY,
        aggregation: AggregationType.Sum,
      });
    };

    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "a - b",
      queryConfigs: [gauge("a"), gauge("b")],
      formulaConfigs: [],
      results: [
        result([
          [T0, 3],
          [T1, 3],
        ]),
        result([[T1, 3]]),
      ],
      zeroFill: ZERO_FILL,
    });

    // A shortfall of 3 at T0 would alert on a sample that never came.
    expect(values(output)).toEqual([[T1, 0]]);
  });

  test.each([
    AggregationType.Avg,
    AggregationType.Min,
    AggregationType.Max,
    AggregationType.P95,
  ])(
    "the %s of a counter has no value with no point",
    (aggregation: AggregationType) => {
      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "$b / $a * 100",
        queryConfigs: [
          query({ variable: "a", metricName: SENT, aggregation }),
          query({ variable: "b", metricName: SENT, aggregation }),
        ],
        formulaConfigs: [],
        results: SENT_RESULTS,
        zeroFill: ZERO_FILL,
      });

      expect(values(output)).toEqual([[T1, 2]]);
    },
  );

  test("a histogram's P95 keeps its gaps, and its Count is 0 where nothing was observed", () => {
    const p95: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "a / 1000",
      queryConfigs: [
        query({
          variable: "a",
          metricName: DURATION,
          aggregation: AggregationType.P95,
        }),
        query({
          variable: "b",
          metricName: DURATION,
          aggregation: AggregationType.Count,
        }),
      ],
      formulaConfigs: [],
      results: [result([[T1, 2500]]), result([[T0, 4]])],
      zeroFill: ZERO_FILL,
    });

    expect(values(p95)).toEqual([[T1, 2.5]]);

    const count: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "b * a",
      queryConfigs: [
        query({
          variable: "a",
          metricName: DURATION,
          aggregation: AggregationType.P95,
        }),
        query({
          variable: "b",
          metricName: DURATION,
          aggregation: AggregationType.Count,
        }),
      ],
      formulaConfigs: [],
      results: [result([[T1, 2500]]), result([[T0, 4]])],
      zeroFill: ZERO_FILL,
    });

    // T1: the P95 is there and nothing was counted - 0; T0: no P95 - no point.
    expect(values(count)).toEqual([[T1, 0]]);
  });

  test("a cumulative counter that sent no running total counted nothing; a cumulative up-down counter is a level", () => {
    const counter: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "a + b",
      queryConfigs: [
        query({
          variable: "a",
          metricName: CUMULATIVE_REQUESTS,
          aggregation: AggregationType.Sum,
        }),
        query({
          variable: "b",
          metricName: CUMULATIVE_REQUESTS,
          aggregation: AggregationType.Sum,
        }),
      ],
      formulaConfigs: [],
      results: [result([[T0, 10]]), { data: [] }],
      zeroFill: ZERO_FILL,
    });

    expect(values(counter)).toEqual([[T0, 10]]);

    const level: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "a + b",
      queryConfigs: [
        query({
          variable: "a",
          metricName: CONNECTIONS,
          aggregation: AggregationType.Sum,
        }),
        query({
          variable: "b",
          metricName: CONNECTIONS,
          aggregation: AggregationType.Sum,
        }),
      ],
      formulaConfigs: [],
      results: [result([[T0, 10]]), { data: [] }],
      zeroFill: ZERO_FILL,
    });

    expect(level.data).toEqual([]);
  });

  test("a metric the catalog does not know is never guessed at", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [
        query({
          variable: "a",
          metricName: "aws.elb.requests",
          aggregation: AggregationType.Sum,
        }),
        query({
          variable: "b",
          metricName: "aws.elb.errors",
          aggregation: AggregationType.Sum,
        }),
      ],
      formulaConfigs: [],
      results: SENT_RESULTS,
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([[T1, 2]]);
  });

  test("a gauge beside a count needs its own sample: the count is 0 where the gauge has one", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "c / g",
      queryConfigs: [
        query({
          variable: "c",
          metricName: SENT,
          aggregation: AggregationType.Sum,
        }),
        query({
          variable: "g",
          metricName: MEMORY,
          aggregation: AggregationType.Avg,
        }),
      ],
      formulaConfigs: [],
      results: [
        result([[T1, 10]]),
        result([
          [T0, 5],
          [T2, 4],
        ]),
      ],
      zeroFill: ZERO_FILL,
    });

    // T1 has no gauge sample: nothing. T0 and T2 counted nothing: 0.
    expect(values(output)).toEqual([
      [T0, 0],
      [T2, 0],
    ]);
  });

  test("a formula variable keeps its gaps: its own output already holds its zeros", () => {
    const formulaConfigs: Array<MetricFormulaConfigData> = [
      formulaConfig("c", "$b / $a * 100"),
    ];

    const share: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b"), sent("d")],
      formulaConfigs: [],
      results: [...SENT_RESULTS, result([[T3, 1]])],
      zeroFill: ZERO_FILL,
    });

    // c + d: d is a count, c a formula that has no point at T3.
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "c + d",
      queryConfigs: [sent("a"), sent("b"), sent("d")],
      formulaConfigs,
      results: [...SENT_RESULTS, result([[T3, 1]]), share],
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([
      [T0, 0],
      [T1, 2],
      [T2, 0],
    ]);

    // 100 - c: the success share of every step the failure share has.
    const success: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "100 - c",
      queryConfigs: [sent("a"), sent("b"), sent("d")],
      formulaConfigs,
      results: [...SENT_RESULTS, result([[T3, 1]]), share],
      zeroFill: ZERO_FILL,
    });

    expect(values(success)).toEqual([
      [T0, 100],
      [T1, 98],
      [T2, 100],
    ]);
  });

  test("a point that is there with no number is not one nothing happened in", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [
        result([
          [T0, 200],
          [T1, 100],
        ]),
        {
          data: [
            {
              timestamp: new Date(T0),
              value: null as unknown as number,
            },
          ],
        },
      ],
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([[T1, 0]]);
  });

  test("a read cut at its row limit or to its top N series is never filled: what it lacks may only have been cut", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [SENT_RESULTS[0]!, { ...SENT_RESULTS[1]!, truncated: true }],
      zeroFill: ZERO_FILL,
    });

    expect(values(output)).toEqual([[T1, 2]]);
  });
});

describe("A step still being counted", () => {
  test("is not read as 0 until it has been over for the ingest queue's normal lag", () => {
    // Read at 00:04:30: 00:02 ended 90 seconds before it, 00:03 only 30.
    const readAt: Date = new Date("2026-11-01T00:04:30.000Z");

    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [
        result([
          [T0, 200],
          [T1, 100],
          [T2, 50],
          [T3, 40],
        ]),
        result([[T1, 2]]),
      ],
      zeroFill: MetricZeroFill.getOptions({
        metricTypes: [
          {
            name: SENT,
            isMonotonic: true,
            aggregationTemporality: AggregationTemporality.Delta,
          },
        ],
        window: { startDate: new Date(T0), endDate: readAt },
        readAt,
      }),
    });

    // 00:03's failures may still be in the queue: no 0% that resolves an alert.
    expect(values(output)).toEqual([
      [T0, 0],
      [T1, 2],
      [T2, 0],
    ]);
  });

  test("still draws what it has: a failure already in is a share", () => {
    const readAt: Date = new Date("2026-11-01T00:03:30.000Z");

    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [sent("a"), sent("b")],
      formulaConfigs: [],
      results: [result([[T3, 40]]), result([[T3, 4]])],
      zeroFill: MetricZeroFill.getOptions({
        metricTypes: [
          {
            name: SENT,
            isMonotonic: true,
            aggregationTemporality: AggregationTemporality.Delta,
          },
        ],
        window: { startDate: new Date(T0), endDate: readAt },
        readAt,
      }),
    });

    expect(values(output)).toEqual([[T3, 10]]);
  });
});

describe("A grouped failure share", () => {
  const byService: (variable: string) => MetricQueryConfigData = (
    variable: string,
  ): MetricQueryConfigData => {
    return query({
      variable,
      metricName: SENT,
      aggregation: AggregationType.Sum,
      groupByAttributeKeys: ["service.name"],
    });
  };

  const SENT_BY_SERVICE: AggregatedResult = grouped([
    [T0, 100, { "service.name": "api" }],
    [T1, 100, { "service.name": "api" }],
    [T0, 50, { "service.name": "web" }],
    [T1, 50, { "service.name": "web" }],
  ]);

  test("without the catalog's word, a service with no failure has no line, as before", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [byService("a"), byService("b")],
      formulaConfigs: [],
      results: [SENT_BY_SERVICE, grouped([[T1, 5, { "service.name": "api" }]])],
    });

    expect(valuesByGroup(output, "service.name")).toEqual([["api", T1, 5]]);
  });

  test("with it, a service with no failure draws 0%, and a step of one with no failure too", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [byService("a"), byService("b")],
      formulaConfigs: [],
      results: [SENT_BY_SERVICE, grouped([[T1, 5, { "service.name": "api" }]])],
      zeroFill: ZERO_FILL,
    });

    expect(valuesByGroup(output, "service.name")).toEqual([
      ["api", T0, 0],
      ["api", T1, 5],
      ["web", T0, 0],
      ["web", T1, 0],
    ]);
  });

  test("a failures query nothing failed in reads 0% for every service", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [byService("a"), byService("b")],
      formulaConfigs: [],
      results: [SENT_BY_SERVICE, grouped([])],
      zeroFill: ZERO_FILL,
    });

    expect(valuesByGroup(output, "service.name")).toEqual([
      ["api", T0, 0],
      ["api", T1, 0],
      ["web", T0, 0],
      ["web", T1, 0],
    ]);
  });

  test("failures of a service nothing was sent for divide by zero: no line", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [byService("a"), byService("b")],
      formulaConfigs: [],
      results: [
        SENT_BY_SERVICE,
        grouped([
          [T1, 5, { "service.name": "api" }],
          [T1, 1, { "service.name": "worker" }],
        ]),
      ],
      zeroFill: ZERO_FILL,
    });

    expect(
      valuesByGroup(output, "service.name").map(
        (row: [string, string, number]): string => {
          return row[0];
        },
      ),
    ).not.toContain("worker");
  });

  test("a gauge grouped alike keeps the groups it has: the count is 0 in them", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "b / g",
      queryConfigs: [
        query({
          variable: "g",
          metricName: MEMORY,
          aggregation: AggregationType.Avg,
          groupByAttributeKeys: ["service.name"],
        }),
        byService("b"),
      ],
      formulaConfigs: [],
      results: [
        grouped([
          [T0, 10, { "service.name": "api" }],
          [T0, 20, { "service.name": "web" }],
        ]),
        grouped([
          [T0, 5, { "service.name": "api" }],
          [T0, 7, { "service.name": "worker" }],
        ]),
      ],
      zeroFill: ZERO_FILL,
    });

    // worker has no gauge: not a group of the formula's.
    expect(valuesByGroup(output, "service.name")).toEqual([
      ["api", T0, 0.5],
      ["web", T0, 0],
    ]);
  });

  test("a count grouped by other attributes is never filled into the groups: no groups in common, as before", () => {
    expect(() => {
      MetricFormulaEvaluator.evaluateFormula({
        formula: "b / g",
        queryConfigs: [
          query({
            variable: "g",
            metricName: MEMORY,
            aggregation: AggregationType.Avg,
            groupByAttributeKeys: ["service.name"],
          }),
          query({
            variable: "b",
            metricName: SENT,
            aggregation: AggregationType.Sum,
            groupByAttributeKeys: ["region"],
          }),
        ],
        formulaConfigs: [],
        results: [
          grouped([
            [T0, 10, { "service.name": "api" }],
            [T0, 20, { "service.name": "web" }],
          ]),
          grouped([
            [T0, 5, { region: "us" }],
            [T0, 7, { region: "eu" }],
          ]),
        ],
        zeroFill: ZERO_FILL,
      });
    }).toThrow(/no series groups in common/i);
  });

  test("two counts grouped by different attributes are not filled into each other's groups", () => {
    expect(() => {
      MetricFormulaEvaluator.evaluateFormula({
        formula: "a + b",
        queryConfigs: [
          byService("a"),
          query({
            variable: "b",
            metricName: SENT,
            aggregation: AggregationType.Sum,
            groupByAttributeKeys: ["region"],
          }),
        ],
        formulaConfigs: [],
        results: [
          SENT_BY_SERVICE,
          grouped([
            [T0, 5, { region: "us" }],
            [T0, 7, { region: "eu" }],
          ]),
        ],
        zeroFill: ZERO_FILL,
      });
    }).toThrow(/no series groups in common/i);
  });

  test("an ungrouped count is read as 0 in each group's steps it has no point in", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "a + b",
      queryConfigs: [byService("a"), sent("b")],
      formulaConfigs: [],
      results: [SENT_BY_SERVICE, result([[T1, 1]])],
      zeroFill: ZERO_FILL,
    });

    expect(valuesByGroup(output, "service.name")).toEqual([
      ["api", T0, 100],
      ["api", T1, 101],
      ["web", T0, 50],
      ["web", T1, 51],
    ]);
  });

  test("a failures query cut to its top N services is not filled for the ones it left out", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [byService("a"), byService("b")],
      formulaConfigs: [],
      results: [
        SENT_BY_SERVICE,
        {
          ...grouped([[T1, 5, { "service.name": "api" }]]),
          totalGroups: 2,
          truncated: true,
        },
      ],
      zeroFill: ZERO_FILL,
    });

    expect(valuesByGroup(output, "service.name")).toEqual([["api", T1, 5]]);
  });

  test("one series per variable - the monitor worker's shape - reads the missing count as 0, unstamped", () => {
    const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: "$b / $a * 100",
      queryConfigs: [byService("a"), byService("b")],
      formulaConfigs: [],
      results: [
        grouped([
          [T0, 100, { "service.name": "web" }],
          [T1, 50, { "service.name": "web" }],
        ]),
        { data: [] },
      ],
      zeroFill: ZERO_FILL,
    });

    expect(output.data).toEqual([
      { timestamp: new Date(T0), value: 0 },
      { timestamp: new Date(T1), value: 0 },
    ]);
  });
});

describe("MetricFormulaEvaluator.getCountingVariablesOfFormula", () => {
  test("names the counting queries a formula reads, in order", () => {
    expect(
      MetricFormulaEvaluator.getCountingVariablesOfFormula({
        formula: "$b / ($a + $g) * 100",
        queryConfigs: [
          sent("a"),
          sent("b"),
          query({
            variable: "g",
            metricName: MEMORY,
            aggregation: AggregationType.Sum,
          }),
        ],
        zeroFill: ZERO_FILL,
      }),
    ).toEqual(["b", "a"]);
  });

  test("names none without the catalog's word, or for a formula that cannot be read", () => {
    expect(
      MetricFormulaEvaluator.getCountingVariablesOfFormula({
        formula: "$b / $a",
        queryConfigs: [sent("a"), sent("b")],
      }),
    ).toEqual([]);
    expect(
      MetricFormulaEvaluator.getCountingVariablesOfFormula({
        formula: "$b / (",
        queryConfigs: [sent("a"), sent("b")],
        zeroFill: ZERO_FILL,
      }),
    ).toEqual([]);
  });
});

describe("Variables named like what every object inherits", () => {
  test.each(["constructor", "toString", "__proto__", "valueOf"])(
    "a counting query named %s is read as 0 only where it has no point",
    (name: string) => {
      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: `${name} + a`,
        queryConfigs: [sent("a"), sent(name)],
        formulaConfigs: [],
        results: [
          result([
            [T0, 1],
            [T1, 2],
          ]),
          result([[T1, 10]]),
        ],
        zeroFill: ZERO_FILL,
      });

      expect(values(output)).toEqual([
        [T0, 1],
        [T1, 12],
      ]);
    },
  );
});
