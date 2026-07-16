import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

type BuildQueryConfigFunction = (variable: string) => MetricQueryConfigData;

const buildQueryConfig: BuildQueryConfigFunction = (
  variable: string,
): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: `metric_${variable}`,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  };
};

type BuildGroupedQueryConfigFunction = (
  variable: string,
  groupByAttributeKeys: Array<string>,
) => MetricQueryConfigData;

const buildGroupedQueryConfig: BuildGroupedQueryConfigFunction = (
  variable: string,
  groupByAttributeKeys: Array<string>,
): MetricQueryConfigData => {
  const config: MetricQueryConfigData = buildQueryConfig(variable);
  config.metricQueryData.groupByAttributeKeys = groupByAttributeKeys;
  return config;
};

type BuildResultFunction = (
  points: Array<{ timestamp: string; value: number }>,
) => AggregatedResult;

const buildResult: BuildResultFunction = (
  points: Array<{ timestamp: string; value: number }>,
): AggregatedResult => {
  return {
    data: points.map((point: { timestamp: string; value: number }) => {
      return {
        timestamp: new Date(point.timestamp),
        value: point.value,
      };
    }),
  };
};

type BuildGroupedResultFunction = (
  points: Array<{
    timestamp: string;
    value: number;
    attributes: Record<string, string>;
  }>,
) => AggregatedResult;

const buildGroupedResult: BuildGroupedResultFunction = (
  points: Array<{
    timestamp: string;
    value: number;
    attributes: Record<string, string>;
  }>,
): AggregatedResult => {
  return {
    data: points.map(
      (point: {
        timestamp: string;
        value: number;
        attributes: Record<string, string>;
      }) => {
        return {
          timestamp: new Date(point.timestamp),
          value: point.value,
          attributes: point.attributes,
        };
      },
    ),
  };
};

describe("MetricFormulaEvaluator", () => {
  describe("evaluateFormula", () => {
    test("adds two series point-by-point", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildQueryConfig("a"),
        buildQueryConfig("b"),
      ];
      const results: Array<AggregatedResult> = [
        buildResult([
          { timestamp: "2024-01-01T00:00:00.000Z", value: 10 },
          { timestamp: "2024-01-01T00:01:00.000Z", value: 20 },
        ]),
        buildResult([
          { timestamp: "2024-01-01T00:00:00.000Z", value: 1 },
          { timestamp: "2024-01-01T00:01:00.000Z", value: 2 },
        ]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a + b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      expect(
        output.data.map((p: { value: number }) => {
          return p.value;
        }),
      ).toEqual([11, 22]);
    });

    test("supports $ prefix, numeric literals and precedence", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildQueryConfig("a"),
        buildQueryConfig("b"),
      ];
      const results: Array<AggregatedResult> = [
        buildResult([{ timestamp: "2024-01-01T00:00:00.000Z", value: 3 }]),
        buildResult([{ timestamp: "2024-01-01T00:00:00.000Z", value: 4 }]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "($A + $B) * 2",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      expect(output.data[0]!.value).toBe(14);
    });

    test("handles unary minus and division", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildQueryConfig("a"),
      ];
      const results: Array<AggregatedResult> = [
        buildResult([{ timestamp: "2024-01-01T00:00:00.000Z", value: 100 }]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "-a / 2",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      expect(output.data[0]!.value).toBe(-50);
    });

    test("skips timestamps where any variable is missing", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildQueryConfig("a"),
        buildQueryConfig("b"),
      ];
      const results: Array<AggregatedResult> = [
        buildResult([
          { timestamp: "2024-01-01T00:00:00.000Z", value: 10 },
          { timestamp: "2024-01-01T00:01:00.000Z", value: 20 },
        ]),
        buildResult([
          // "b" missing the first timestamp
          { timestamp: "2024-01-01T00:01:00.000Z", value: 5 },
        ]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a - b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      expect(output.data.length).toBe(1);
      expect(output.data[0]!.value).toBe(15);
    });

    test("drops non-finite results like divide-by-zero", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildQueryConfig("a"),
        buildQueryConfig("b"),
      ];
      const results: Array<AggregatedResult> = [
        buildResult([
          { timestamp: "2024-01-01T00:00:00.000Z", value: 10 },
          { timestamp: "2024-01-01T00:01:00.000Z", value: 10 },
        ]),
        buildResult([
          { timestamp: "2024-01-01T00:00:00.000Z", value: 0 },
          { timestamp: "2024-01-01T00:01:00.000Z", value: 2 },
        ]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a / b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      expect(output.data.length).toBe(1);
      expect(output.data[0]!.value).toBe(5);
    });

    test("references another formula's pre-computed result", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildQueryConfig("a"),
        buildQueryConfig("b"),
      ];

      const formulaC: MetricFormulaConfigData = {
        metricAliasData: {
          metricVariable: "c",
          title: "",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricFormulaData: {
          metricFormula: "a + b",
        },
      };

      const rawResults: Array<AggregatedResult> = [
        buildResult([{ timestamp: "2024-01-01T00:00:00.000Z", value: 4 }]),
        buildResult([{ timestamp: "2024-01-01T00:00:00.000Z", value: 6 }]),
      ];

      const resultC: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: formulaC.metricFormulaData.metricFormula,
        queryConfigs,
        formulaConfigs: [],
        results: rawResults,
      });

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "c * 10",
        queryConfigs,
        formulaConfigs: [formulaC],
        results: [...rawResults, resultC],
      });

      expect(output.data[0]!.value).toBe(100);
    });

    test("returns empty data for an empty formula", () => {
      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "   ",
        queryConfigs: [buildQueryConfig("a")],
        formulaConfigs: [],
        results: [buildResult([])],
      });
      expect(output.data).toEqual([]);
    });

    test("throws for unknown variables", () => {
      expect(() => {
        MetricFormulaEvaluator.evaluateFormula({
          formula: "a + z",
          queryConfigs: [buildQueryConfig("a")],
          formulaConfigs: [],
          results: [
            buildResult([{ timestamp: "2024-01-01T00:00:00.000Z", value: 1 }]),
          ],
        });
      }).toThrow(/unknown variable/i);
    });

    test("throws a structural error for malformed formulas like a**b", () => {
      expect(() => {
        MetricFormulaEvaluator.evaluateFormula({
          formula: "a ** b",
          queryConfigs: [buildQueryConfig("a"), buildQueryConfig("b")],
          formulaConfigs: [],
          results: [
            buildResult([{ timestamp: "2024-01-01T00:00:00.000Z", value: 2 }]),
            buildResult([{ timestamp: "2024-01-01T00:00:00.000Z", value: 3 }]),
          ],
        });
      }).toThrow(/missing an operand/i);
    });
  });

  describe("group-aware evaluation", () => {
    const timestamps: Array<string> = [
      "2024-01-01T00:00:00.000Z",
      "2024-01-01T00:01:00.000Z",
    ];

    test("evaluates grouped formulas once per group and stamps group attributes", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildGroupedQueryConfig("a", ["host.name"]),
        buildGroupedQueryConfig("b", ["host.name"]),
      ];

      const results: Array<AggregatedResult> = [
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 10,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[0]!,
            value: 40,
            attributes: { "host.name": "web-2" },
          },
          {
            timestamp: timestamps[1]!,
            value: 20,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[1]!,
            value: 80,
            attributes: { "host.name": "web-2" },
          },
        ]),
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 2,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[0]!,
            value: 4,
            attributes: { "host.name": "web-2" },
          },
          {
            timestamp: timestamps[1]!,
            value: 2,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[1]!,
            value: 4,
            attributes: { "host.name": "web-2" },
          },
        ]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a / b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      // Groups are ordered by canonical label key: web-1 first, then web-2.
      expect(output.data).toEqual([
        {
          timestamp: new Date(timestamps[0]!),
          value: 5,
          attributes: { "host.name": "web-1" },
        },
        {
          timestamp: new Date(timestamps[1]!),
          value: 10,
          attributes: { "host.name": "web-1" },
        },
        {
          timestamp: new Date(timestamps[0]!),
          value: 10,
          attributes: { "host.name": "web-2" },
        },
        {
          timestamp: new Date(timestamps[1]!),
          value: 20,
          attributes: { "host.name": "web-2" },
        },
      ]);
    });

    test("broadcasts an ungrouped variable across groups", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildGroupedQueryConfig("a", ["host.name"]),
        buildQueryConfig("b"),
      ];

      const results: Array<AggregatedResult> = [
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 10,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[0]!,
            value: 30,
            attributes: { "host.name": "web-2" },
          },
        ]),
        buildResult([{ timestamp: timestamps[0]!, value: 2 }]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a / b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      expect(output.data).toEqual([
        {
          timestamp: new Date(timestamps[0]!),
          value: 5,
          attributes: { "host.name": "web-1" },
        },
        {
          timestamp: new Date(timestamps[0]!),
          value: 15,
          attributes: { "host.name": "web-2" },
        },
      ]);
    });

    test("throws a structural error when grouped variables share no groups", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildGroupedQueryConfig("a", ["host.name"]),
        buildGroupedQueryConfig("b", ["region"]),
      ];

      const results: Array<AggregatedResult> = [
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 1,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[0]!,
            value: 2,
            attributes: { "host.name": "web-2" },
          },
        ]),
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 3,
            attributes: { region: "us-east" },
          },
          {
            timestamp: timestamps[0]!,
            value: 4,
            attributes: { region: "eu-west" },
          },
        ]),
      ];

      expect(() => {
        MetricFormulaEvaluator.evaluateFormula({
          formula: "a + b",
          queryConfigs,
          formulaConfigs: [],
          results,
        });
      }).toThrow(/no series groups in common/i);
    });

    test("joins a grouped variable that collapsed to a single series by group key (no cross-group broadcast)", () => {
      /*
       * Regression: $a and $b are both grouped by host.name, but in the
       * charted window $b only returned rows for web-1 (web-2's
       * denominator metric is missing). $b must NOT be treated as
       * ungrouped-and-broadcast — that would compute a(web-2)/b(web-1)
       * and stamp it as the web-2 series. Per the documented "groups
       * present in ALL grouped variables" semantics, web-2 is dropped.
       */
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildGroupedQueryConfig("a", ["host.name"]),
        buildGroupedQueryConfig("b", ["host.name"]),
      ];

      const results: Array<AggregatedResult> = [
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 10,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[0]!,
            value: 40,
            attributes: { "host.name": "web-2" },
          },
        ]),
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 2,
            attributes: { "host.name": "web-1" },
          },
        ]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a / b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      // Only web-1 (the common group) is emitted — and with web-1 math.
      expect(output.data).toEqual([
        {
          timestamp: new Date(timestamps[0]!),
          value: 5,
          attributes: { "host.name": "web-1" },
        },
      ]);
    });

    test("still broadcasts a config-grouped variable whose result is EMPTY (degrades to gaps, not a structural error)", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildGroupedQueryConfig("a", ["host.name"]),
        buildGroupedQueryConfig("b", ["host.name"]),
      ];

      const results: Array<AggregatedResult> = [
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 10,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[0]!,
            value: 40,
            attributes: { "host.name": "web-2" },
          },
        ]),
        buildGroupedResult([]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a / b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      // Every point misses $b, so every point is skipped silently.
      expect(output.data).toEqual([]);
    });

    test("single-series inputs stay byte-identical to ungrouped behavior", () => {
      /*
       * The metric-monitor worker pre-buckets per series fingerprint and
       * calls the evaluator with one series per variable — even though
       * the query configs still carry groupByAttributeKeys and the rows
       * still carry full attributes. Output must be exactly the legacy
       * shape: unstamped {timestamp, value} rows.
       */
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildGroupedQueryConfig("a", ["host.name"]),
        buildGroupedQueryConfig("b", ["host.name"]),
      ];

      const results: Array<AggregatedResult> = [
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 10,
            attributes: { "host.name": "web-1", "process.pid": "42" },
          },
        ]),
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 4,
            attributes: { "host.name": "web-1", "process.pid": "43" },
          },
        ]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a - b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      expect(output.data).toEqual([
        { timestamp: new Date(timestamps[0]!), value: 6 },
      ]);
      expect(Object.keys(output.data[0]!)).toEqual(["timestamp", "value"]);
    });

    test("skips per-point gaps within a group silently", () => {
      const queryConfigs: Array<MetricQueryConfigData> = [
        buildGroupedQueryConfig("a", ["host.name"]),
        buildGroupedQueryConfig("b", ["host.name"]),
      ];

      const results: Array<AggregatedResult> = [
        buildGroupedResult([
          {
            timestamp: timestamps[0]!,
            value: 10,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[1]!,
            value: 20,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[0]!,
            value: 30,
            attributes: { "host.name": "web-2" },
          },
          {
            timestamp: timestamps[1]!,
            value: 40,
            attributes: { "host.name": "web-2" },
          },
        ]),
        buildGroupedResult([
          // web-1 is missing the first timestamp for "b".
          {
            timestamp: timestamps[1]!,
            value: 2,
            attributes: { "host.name": "web-1" },
          },
          {
            timestamp: timestamps[0]!,
            value: 3,
            attributes: { "host.name": "web-2" },
          },
          {
            timestamp: timestamps[1]!,
            value: 4,
            attributes: { "host.name": "web-2" },
          },
        ]),
      ];

      const output: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
        formula: "a / b",
        queryConfigs,
        formulaConfigs: [],
        results,
      });

      expect(output.data).toEqual([
        {
          timestamp: new Date(timestamps[1]!),
          value: 10,
          attributes: { "host.name": "web-1" },
        },
        {
          timestamp: new Date(timestamps[0]!),
          value: 10,
          attributes: { "host.name": "web-2" },
        },
        {
          timestamp: new Date(timestamps[1]!),
          value: 10,
          attributes: { "host.name": "web-2" },
        },
      ]);
    });
  });

  describe("validateFormula", () => {
    test("returns null for a valid formula", () => {
      expect(
        MetricFormulaEvaluator.validateFormula({
          formula: "(a + b) * 2",
          availableVariables: ["a", "b"],
        }),
      ).toBeNull();
    });

    test("reports missing variable", () => {
      const message: string | null = MetricFormulaEvaluator.validateFormula({
        formula: "a + c",
        availableVariables: ["a", "b"],
      });
      expect(message).toMatch(/unknown variable/i);
    });

    test("reports syntax errors", () => {
      const message: string | null = MetricFormulaEvaluator.validateFormula({
        formula: "(a + b",
        availableVariables: ["a", "b"],
      });
      expect(message).toMatch(/parentheses/i);
    });

    test("rejects empty formulas", () => {
      const message: string | null = MetricFormulaEvaluator.validateFormula({
        formula: "",
        availableVariables: ["a"],
      });
      expect(message).toMatch(/required/i);
    });

    test("rejects doubled binary operators like a**b", () => {
      const message: string | null = MetricFormulaEvaluator.validateFormula({
        formula: "a ** b",
        availableVariables: ["a", "b"],
      });
      expect(message).toMatch(/missing an operand/i);
    });

    test("rejects trailing operators like a+", () => {
      const message: string | null = MetricFormulaEvaluator.validateFormula({
        formula: "a +",
        availableVariables: ["a"],
      });
      expect(message).toMatch(/missing an operand/i);
    });

    test("rejects empty parentheses", () => {
      const message: string | null = MetricFormulaEvaluator.validateFormula({
        formula: "()",
        availableVariables: ["a"],
      });
      expect(message).toMatch(/empty/i);
    });

    test("rejects adjacent values with no operator", () => {
      const message: string | null = MetricFormulaEvaluator.validateFormula({
        formula: "a b",
        availableVariables: ["a", "b"],
      });
      expect(message).toMatch(/single value/i);
    });
  });
});
