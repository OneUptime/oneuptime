import MetricResultUnitConverter from "../../../Utils/Metrics/MetricResultUnitConverter";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

const buildQueryConfig = (input: {
  variable: string;
  metricName: string;
  legendUnit?: string;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: input.variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: input.legendUnit ?? "",
    },
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  };
};

const buildResult = (values: Array<number>): AggregatedResult => {
  return {
    data: values.map((v: number, index: number) => {
      return {
        timestamp: new Date(`2026-04-20T00:0${index}:00.000Z`),
        value: v,
      };
    }),
  };
};

describe("MetricResultUnitConverter", () => {
  test("converts bytes series to GB when user picked GB", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        variable: "a",
        metricName: "memory.usage",
        legendUnit: "GB",
      }),
    ];
    const results: Array<AggregatedResult> = [
      // 1 GB, 2 GB, 0.5 GB (expressed in bytes — OpenTelemetry's native)
      buildResult([1_000_000_000, 2_000_000_000, 500_000_000]),
    ];
    const nativeUnits: Map<string, string> = new Map([["memory.usage", "bytes"]]);

    const out: Array<AggregatedResult> =
      MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
        queryConfigs,
        results,
        nativeUnitByMetricName: nativeUnits,
      });

    expect(out[0]!.data.map((d: { value: number }) => d.value)).toEqual([
      1, 2, 0.5,
    ]);
  });

  test("passes values through when legendUnit is empty", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({ variable: "a", metricName: "memory.usage" }),
    ];
    const results: Array<AggregatedResult> = [buildResult([1_000_000_000])];
    const nativeUnits: Map<string, string> = new Map([
      ["memory.usage", "bytes"],
    ]);

    const out: Array<AggregatedResult> =
      MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
        queryConfigs,
        results,
        nativeUnitByMetricName: nativeUnits,
      });

    expect(out[0]!.data[0]!.value).toBe(1_000_000_000);
  });

  test("passes values through when native unit is unknown", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        variable: "a",
        metricName: "custom.metric",
        legendUnit: "GB",
      }),
    ];
    const results: Array<AggregatedResult> = [buildResult([1_000_000_000])];
    // No entry for custom.metric
    const nativeUnits: Map<string, string> = new Map();

    const out: Array<AggregatedResult> =
      MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
        queryConfigs,
        results,
        nativeUnitByMetricName: nativeUnits,
      });

    expect(out[0]!.data[0]!.value).toBe(1_000_000_000);
  });

  test("no-op when native unit already matches legendUnit", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        variable: "a",
        metricName: "latency",
        legendUnit: "ms",
      }),
    ];
    const results: Array<AggregatedResult> = [buildResult([250, 500])];
    const nativeUnits: Map<string, string> = new Map([["latency", "ms"]]);

    const out: Array<AggregatedResult> =
      MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
        queryConfigs,
        results,
        nativeUnitByMetricName: nativeUnits,
      });

    // Returns the same AggregatedResult reference — no allocation needed
    expect(out[0]).toBe(results[0]);
  });

  test("converts ms → sec (time family)", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        variable: "a",
        metricName: "request.time",
        legendUnit: "sec",
      }),
    ];
    const results: Array<AggregatedResult> = [
      buildResult([1000, 2500, 10000]),
    ];
    const nativeUnits: Map<string, string> = new Map([["request.time", "ms"]]);

    const out: Array<AggregatedResult> =
      MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
        queryConfigs,
        results,
        nativeUnitByMetricName: nativeUnits,
      });

    expect(out[0]!.data.map((d: { value: number }) => d.value)).toEqual([
      1, 2.5, 10,
    ]);
  });

  test("passes values through across incompatible unit families", () => {
    // User legendUnit "GB", native "ms" — different families, can't convert
    const queryConfigs: Array<MetricQueryConfigData> = [
      buildQueryConfig({
        variable: "a",
        metricName: "nonsense",
        legendUnit: "GB",
      }),
    ];
    const results: Array<AggregatedResult> = [buildResult([123])];
    const nativeUnits: Map<string, string> = new Map([["nonsense", "ms"]]);

    const out: Array<AggregatedResult> =
      MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
        queryConfigs,
        results,
        nativeUnitByMetricName: nativeUnits,
      });

    expect(out[0]!.data[0]!.value).toBe(123);
  });
});
