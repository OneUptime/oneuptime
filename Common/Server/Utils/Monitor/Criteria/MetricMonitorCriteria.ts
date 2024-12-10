import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import { CheckOn, CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";

export default class MetricMonitorCriteria {
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    // Metric Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.MetricValue) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const metricAggregaredResult: Array<AggregatedResult> =
        (input.dataToProcess as MetricMonitorResponse).metricResult || [];

      const metricAlias: string =
        input.criteriaFilter.metricMonitorOptions?.metricAlias || "";

      const aggregatedResult: AggregatedResult | undefined =
        metricAggregaredResult && metricAggregaredResult.length > 0
          ? metricAggregaredResult[0]
          : undefined;

      if (metricAlias) {
        // find the index of the alias in the dataToProcess.
        const indexOfAlias = (
          input.dataToProcess as MetricMonitorResponse
        ).metricViewConfig.queryConfigs.findIndex((queryConfig) => {
          return queryConfig.metricAliasData?.metricVariable === metricAlias;
        });

        // now get the aggregated result for that alias
        if (indexOfAlias !== -1) {
          const aggregatedResultForAlias: AggregatedResult | undefined =
            metricAggregaredResult[indexOfAlias];
          if (aggregatedResultForAlias) {
            const numbers: Array<number> = aggregatedResultForAlias.data.map(
              (data) => {
                return data.value;
              },
            );

            return CompareCriteria.compareCriteriaNumbers({
              value: numbers,
              threshold: threshold as number,
              criteriaFilter: input.criteriaFilter,
            });
          }
        }
      }

      // if there's no alias then this is the default case
      if (aggregatedResult) {
        const numbers: Array<number> = aggregatedResult.data.map((data) => {
          return data.value;
        });

        return CompareCriteria.compareCriteriaNumbers({
          value: numbers,
          threshold: threshold as number,
          criteriaFilter: input.criteriaFilter,
        });
      }
    }

    return null;
  }
}
