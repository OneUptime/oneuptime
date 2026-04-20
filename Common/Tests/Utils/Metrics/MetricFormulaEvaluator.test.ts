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
  });
});
