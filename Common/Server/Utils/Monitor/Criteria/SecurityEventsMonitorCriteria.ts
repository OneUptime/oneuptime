import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import SecurityEventsMonitorResponse from "../../../../Types/Monitor/SecurityEventsMonitor/SecurityEventsMonitorResponse";

export default class SecurityEventsMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.SecurityEventCount) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const currentCount: number =
        (input.dataToProcess as SecurityEventsMonitorResponse)
          .securityEventCount || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: currentCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
