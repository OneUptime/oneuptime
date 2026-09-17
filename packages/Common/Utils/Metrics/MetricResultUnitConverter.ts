import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import MetricUnitUtil from "../MetricUnitUtil";

/**
 * Convert aggregated metric results from each metric's native unit
 * (reported by OpenTelemetry / stored in MetricType) into the unit the
 * user configured in the query's alias ("legendUnit"). This is what
 * makes downstream consumers — charts, formulas, and threshold
 * comparisons — all speak the same unit as the user picked.
 *
 * Called after results are fetched but before formulas are evaluated.
 * When `legendUnit` is empty or matches the native unit (or the two
 * aren't in the same unit family), the raw value is passed through
 * unchanged, so this is always safe to call.
 */
export default class MetricResultUnitConverter {
  public static convertQueryResultsToDisplayUnit(input: {
    queryConfigs: Array<MetricQueryConfigData>;
    results: Array<AggregatedResult>;
    nativeUnitByMetricName: Map<string, string>;
  }): Array<AggregatedResult> {
    const converted: Array<AggregatedResult> = [];

    for (let index: number = 0; index < input.results.length; index++) {
      const rawResult: AggregatedResult | undefined = input.results[index];
      if (!rawResult) {
        converted.push({ data: [] });
        continue;
      }

      const queryConfig: MetricQueryConfigData | undefined =
        input.queryConfigs[index];

      if (!queryConfig) {
        converted.push(rawResult);
        continue;
      }

      const metricName: string | undefined =
        queryConfig.metricQueryData?.filterData?.metricName?.toString();
      const nativeUnit: string | undefined = metricName
        ? input.nativeUnitByMetricName.get(metricName.toLowerCase())
        : undefined;
      const displayUnit: string | undefined =
        queryConfig.metricAliasData?.legendUnit || undefined;

      if (!nativeUnit || !displayUnit || nativeUnit === displayUnit) {
        converted.push(rawResult);
        continue;
      }

      converted.push(
        MetricResultUnitConverter.convertResult({
          result: rawResult,
          fromUnit: nativeUnit,
          toUnit: displayUnit,
        }),
      );
    }

    return converted;
  }

  public static convertResult(input: {
    result: AggregatedResult;
    fromUnit: string;
    toUnit: string;
  }): AggregatedResult {
    if (input.fromUnit === input.toUnit) {
      return input.result;
    }

    const convertedData: Array<AggregatedModel> = input.result.data.map(
      (row: AggregatedModel) => {
        const convertedValue: number = MetricUnitUtil.convertToMetricUnit({
          value: row.value,
          fromUnit: input.fromUnit,
          metricUnit: input.toUnit,
        });
        return {
          ...row,
          value: convertedValue,
        };
      },
    );

    return { data: convertedData };
  }
}
