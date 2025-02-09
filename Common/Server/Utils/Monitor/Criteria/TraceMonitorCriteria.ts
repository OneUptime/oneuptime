import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import { CheckOn, CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";

export default class TraceMonitorCriteria {
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    // Server Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.SpanCount) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const currentSpanCount: number =
        (input.dataToProcess as TraceMonitorResponse).spanCount || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: currentSpanCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
