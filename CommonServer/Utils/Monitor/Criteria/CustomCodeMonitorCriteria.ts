import CompareCriteria from "./CompareCriteria";
import { CheckOn, CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";

export default class CustomCodeMonitoringCriteria {
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    Monitor: CustomCodeMonitorResponse;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    // Server Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const syntheticMonitor: CustomCodeMonitorResponse =
      input.Monitor;

    if (input.criteriaFilter.checkOn === CheckOn.ExecutionTime) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const currentExecutionTime: number =
        syntheticMonitor.executionTimeInMS || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: currentExecutionTime,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.Error) {
      const emptyNotEmptyResult: string | null =
        CompareCriteria.compareEmptyAndNotEmpty({
          value: syntheticMonitor.scriptError,
          criteriaFilter: input.criteriaFilter,
        });

      if (emptyNotEmptyResult) {
        return emptyNotEmptyResult;
      }

      if (
        threshold &&
        typeof syntheticMonitor.scriptError === "string"
      ) {
        const result: string | null = CompareCriteria.compareCriteriaStrings({
          value: syntheticMonitor.scriptError!,
          threshold: threshold.toString(),
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return result;
        }
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.ResultValue) {
      const emptyNotEmptyResult: string | null =
        CompareCriteria.compareEmptyAndNotEmpty({
          value: syntheticMonitor.result,
          criteriaFilter: input.criteriaFilter,
        });

      if (emptyNotEmptyResult) {
        return emptyNotEmptyResult;
      }

      let thresholdAsNumber: number | null = null;

      try {
        if (threshold) {
          thresholdAsNumber = parseFloat(threshold.toString());
        }
      } catch (err) {
        thresholdAsNumber = null;
      }

      if (
        thresholdAsNumber !== null &&
        typeof syntheticMonitor.result === "number"
      ) {
        const result: string | null = CompareCriteria.compareCriteriaNumbers({
          value: syntheticMonitor.result,
          threshold: thresholdAsNumber as number,
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return result;
        }
      }

      if (threshold && typeof syntheticMonitor.result === "string") {
        const result: string | null = CompareCriteria.compareCriteriaStrings({
          value: syntheticMonitor.result,
          threshold: threshold.toString(),
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return result;
        }
      }
    }

    return null;
  }
}
