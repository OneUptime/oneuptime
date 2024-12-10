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

      return CompareCriteria.compareCriteriaNumbers({
        value: currentLogCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
