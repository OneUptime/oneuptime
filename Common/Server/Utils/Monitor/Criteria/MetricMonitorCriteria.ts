import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
} from "../../../../Types/Monitor/CriteriaFilter";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class MetricMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    monitorStep: MonitorStep;
  }): Promise<string | null> {
    // Metric Monitoring Check

    if (
      input.criteriaFilter.metricMonitorOptions &&
      !input.criteriaFilter.metricMonitorOptions.metricAggregationType
    ) {
      input.criteriaFilter.metricMonitorOptions.metricAggregationType =
        EvaluateOverTimeType.AnyValue;
    }

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.MetricValue) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const metricAggregaredResult: Array<AggregatedResult> =
        (input.dataToProcess as MetricMonitorResponse).metricResult || [];

      const metricAlias: string =
        input.criteriaFilter.metricMonitorOptions?.metricAlias || "";

      // Pick based on the alias, or if there's no alias, pick the first one

      let aliasIndex: number =
        input.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs.findIndex(
          (queryConfig: MetricQueryConfigData) => {
            return queryConfig.metricAliasData?.metricVariable === metricAlias;
          },
        ) || -1;

      if (aliasIndex < 0) {
        // then try to find in formula
        let formulaIndex: number =
          input.monitorStep.data?.metricMonitor?.metricViewConfig?.formulaConfigs.findIndex(
            (formulaConfig: MetricFormulaConfigData) => {
              return (
                formulaConfig.metricAliasData?.metricVariable === metricAlias
              );
            },
          ) || -1;

        if (formulaIndex >= 0) {
          // add number of queries to the index
          formulaIndex =
            formulaIndex +
            (input.monitorStep.data?.metricMonitor?.metricViewConfig
              ?.queryConfigs.length || 0);
          aliasIndex = formulaIndex;
        }
      }
      const aggregatedResult: AggregatedResult | undefined =
        metricAggregaredResult &&
        metricAggregaredResult.length >= aliasIndex - 1 &&
        aliasIndex >= 0
          ? metricAggregaredResult[aliasIndex]
          : metricAggregaredResult[0] || undefined;

      if (metricAlias) {
        // find the index of the alias in the dataToProcess.
        const indexOfAlias: number = (
          input.dataToProcess as MetricMonitorResponse
        ).metricViewConfig.queryConfigs.findIndex(
          (queryConfig: MetricQueryConfigData) => {
            return queryConfig.metricAliasData?.metricVariable === metricAlias;
          },
        );

        // now get the aggregated result for that alias
        if (indexOfAlias !== -1) {
          const aggregatedResultForAlias: AggregatedResult | undefined =
            metricAggregaredResult[indexOfAlias];
          if (aggregatedResultForAlias) {
            const numbers: Array<number> = aggregatedResultForAlias.data.map(
              (data: AggregateModel) => {
                return data.value;
              },
            );

            return CompareCriteria.compareCriteriaNumbers({
              value: numbers && numbers.length > 0 ? numbers : 0,
              threshold: threshold as number,
              criteriaFilter: input.criteriaFilter,
            });
          }
        }
      }

      // if there's no alias then this is the default case
      if (aggregatedResult) {
        const numbers: Array<number> = aggregatedResult.data.map(
          (data: AggregateModel) => {
            return data.value;
          },
        );

        return CompareCriteria.compareCriteriaNumbers({
          value: numbers && numbers.length > 0 ? numbers : 0,
          threshold: threshold as number,
          criteriaFilter: input.criteriaFilter,
        });
      }
    }

    return null;
  }
}
