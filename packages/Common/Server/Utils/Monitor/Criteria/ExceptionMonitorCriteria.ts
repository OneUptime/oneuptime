import ExceptionMonitorResponse from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { isExceptionCountAnomaly } from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataToProcess from "../DataToProcess";
import ExceptionLearnedBaselineUtil, {
  ExceptionAnomalyJudgement,
  ExceptionAnomalyState,
} from "../ExceptionLearnedBaseline";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
} from "../../../../Types/Monitor/CriteriaFilter";

/*
 * An Exceptions monitor's criteria: each measure is a whole number the
 * worker read for the window (MonitorTelemetryMonitor.monitorException,
 * ExceptionMonitorEvaluation) and is compared with the criteria's number.
 * A measure the worker did not read - a response from before it could -
 * reads 0, which is what it was then: nothing new, nothing back, no rise.
 *
 * An anomaly condition has no number: the count is judged against what is
 * normal for the hour of the week (ExceptionLearnedBaseline), which the
 * worker read with the rest. Only the count has one; an anomaly condition
 * written on another measure never matches.
 */
export default class ExceptionMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    if (
      CriteriaFilterUtil.isAnomalyFilterType(input.criteriaFilter.filterType)
    ) {
      return ExceptionMonitorCriteria.getAnomalyMessage(input);
    }

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

  // The window's count against what is normal, for what the check says of it.
  public static judgeAnomaly(input: {
    response: ExceptionMonitorResponse;
    criteriaFilter: CriteriaFilter;
  }): ExceptionAnomalyJudgement {
    const options: CriteriaFilter["metricMonitorOptions"] =
      input.criteriaFilter.metricMonitorOptions;

    return ExceptionLearnedBaselineUtil.judge({
      count: input.response.exceptionCount || 0,
      baseline: ExceptionLearnedBaselineUtil.getBaseline(
        input.response,
        options?.anomalyDetection,
      ),
      filterType: input.criteriaFilter.filterType,
      options: options?.anomalyDetection,
    });
  }

  private static getAnomalyMessage(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (!isExceptionCountAnomaly(input.criteriaFilter)) {
      return null;
    }

    const judgement: ExceptionAnomalyJudgement =
      ExceptionMonitorCriteria.judgeAnomaly({
        response: input.dataToProcess as ExceptionMonitorResponse,
        criteriaFilter: input.criteriaFilter,
      });

    return judgement.state === ExceptionAnomalyState.Anomalous
      ? ExceptionLearnedBaselineUtil.describeBreach(judgement)
      : null;
  }
}
