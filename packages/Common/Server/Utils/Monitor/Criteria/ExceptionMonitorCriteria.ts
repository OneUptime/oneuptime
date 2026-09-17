import ExceptionMonitorResponse from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";

export default class ExceptionMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.ExceptionCount) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const currentExceptionCount: number =
        (input.dataToProcess as ExceptionMonitorResponse).exceptionCount || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: currentExceptionCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
