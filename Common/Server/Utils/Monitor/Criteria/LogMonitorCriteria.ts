import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import { CheckOn, CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";

export default class LogMonitorCriteria {
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    // Server Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.LogCount) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const currentLogCount: number =
        (input.dataToProcess as LogMonitorResponse).logCount || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: currentLogCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
