import ExceptionMonitorResponse from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";

/*
 * An Exceptions monitor's criteria: each measure is a whole number the
 * worker read for the window (MonitorTelemetryMonitor.monitorException,
 * ExceptionMonitorEvaluation) and is compared with the criteria's number.
 * A measure the worker did not read - a response from before it could -
 * reads 0, which is what it was then: nothing new, nothing back, no rise.
 */
export default class ExceptionMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    const value: number | null = ExceptionMonitorCriteria.getMeasuredValue(
      input.dataToProcess as ExceptionMonitorResponse,
      input.criteriaFilter.checkOn,
    );

    if (value === null) {
      return null;
    }

    return CompareCriteria.compareCriteriaNumbers({
      value,
      threshold: CompareCriteria.convertToNumber(
        input.criteriaFilter.value,
      ) as number,
      criteriaFilter: input.criteriaFilter,
    });
  }

  // The window's value of what the criteria checks, or null for another check.
  public static getMeasuredValue(
    response: ExceptionMonitorResponse,
    checkOn: CheckOn,
  ): number | null {
    switch (checkOn) {
      case CheckOn.ExceptionCount:
        return response.exceptionCount || 0;
      case CheckOn.NewExceptionCount:
        return response.newExceptionCount || 0;
      case CheckOn.RegressedExceptionCount:
        return response.regressedExceptionCount || 0;
      case CheckOn.ExceptionCountIncreasePercent:
        return response.exceptionCountIncreasePercent || 0;
      default:
        return null;
    }
  }
}
