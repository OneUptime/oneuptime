import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import LlmMonitorResponse from "../../../../Types/Monitor/LlmMonitor/LlmMonitorResponse";
import MonitorCriteriaDataExtractor from "../MonitorCriteriaDataExtractor";

/*
 * The AI / LLM monitor's criteria: the number of bad answers, their share
 * of all answers, or the number of answers, against the filter's
 * threshold. A payload that is not an AI / LLM check meets nothing.
 */
export default class LlmMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    const response: LlmMonitorResponse | null =
      MonitorCriteriaDataExtractor.getLlmMonitorResponse(input.dataToProcess);

    if (!response) {
      return null;
    }

    const value: number | null = LlmMonitorCriteria.getObservedValue(
      response,
      input.criteriaFilter.checkOn,
    );
    const threshold: number | null = LlmMonitorCriteria.readThreshold(
      input.criteriaFilter.value,
    );

    if (value === null || threshold === null) {
      return null;
    }

    return CompareCriteria.compareCriteriaNumbers({
      value: value,
      threshold: threshold,
      criteriaFilter: input.criteriaFilter,
    });
  }

  // The number a check-on compares, or null for one this monitor has not.
  public static getObservedValue(
    response: LlmMonitorResponse,
    checkOn: CheckOn,
  ): number | null {
    switch (checkOn) {
      case CheckOn.LlmBadAnswerPercent:
        return Number(response.llmBadAnswerPercent) || 0;
      case CheckOn.LlmBadAnswerCount:
        return Number(response.llmBadAnswerCount) || 0;
      case CheckOn.LlmAnswerCount:
        return Number(response.llmAnswerCount) || 0;
      default:
        return null;
    }
  }

  /*
   * The filter's threshold as a number. A share of answers is often a
   * fraction ("2.5" %), so a decimal is read whole - unlike the integer
   * counts of the other telemetry monitors. A threshold that is not a
   * number meets nothing rather than comparing against NaN.
   */
  public static readThreshold(
    value: string | number | undefined | null,
  ): number | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === "string" && value.trim().length === 0) {
      return null;
    }

    const parsed: number = typeof value === "number" ? value : Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }
}
