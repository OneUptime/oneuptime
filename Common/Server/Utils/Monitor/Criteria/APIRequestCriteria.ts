import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import EvaluateOverTime from "./EvaluateOverTime";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import Typeof from "../../../../Types/Typeof";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";

export default class APIRequestCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    // Server Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    let overTimeValue: Array<number | boolean> | number | boolean | undefined =
      undefined;

    if (
      input.criteriaFilter.evaluateOverTime &&
      input.criteriaFilter.evaluateOverTimeOptions
    ) {
      try {
        overTimeValue = await EvaluateOverTime.getValueOverTime({
          projectId: (input.dataToProcess as ProbeMonitorResponse).projectId,
          monitorId: input.dataToProcess.monitorId!,
          evaluateOverTimeOptions: input.criteriaFilter.evaluateOverTimeOptions,
          metricType: input.criteriaFilter.checkOn,
          miscData: input.criteriaFilter.serverMonitorOptions as JSONObject,
        });

        if (Array.isArray(overTimeValue) && overTimeValue.length === 0) {
          overTimeValue = undefined;
        }
      } catch (err) {
        logger.error(
          `Error in getting over time value for ${input.criteriaFilter.checkOn}`,
        );
        logger.error(err);
        overTimeValue = undefined;
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.IsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ||
        (input.dataToProcess as ProbeMonitorResponse).isOnline;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.IsRequestTimeout) {
      const currentIsTimeout: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ||
        (input.dataToProcess as ProbeMonitorResponse).isTimeout;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsTimeout,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // check response time filter
    if (input.criteriaFilter.checkOn === CheckOn.ResponseTime) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const value: Array<number> | number =
        (overTimeValue as Array<number>) ||
        (input.dataToProcess as ProbeMonitorResponse).responseTimeInMs!;

      return CompareCriteria.compareCriteriaNumbers({
        value: value,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    //check response code
    if (
      input.criteriaFilter.checkOn === CheckOn.ResponseStatusCode &&
      (input.dataToProcess as ProbeMonitorResponse).responseCode
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const value: Array<number> | number =
        (overTimeValue as Array<number>) ||
        (input.dataToProcess as ProbeMonitorResponse).responseCode!;

      return CompareCriteria.compareCriteriaNumbers({
        value: value,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.ResponseBody) {
      let responseBody: string | JSONObject | undefined = (
        input.dataToProcess as ProbeMonitorResponse
      ).responseBody;

      if (responseBody && typeof responseBody === Typeof.Object) {
        responseBody = JSON.stringify(responseBody);
      }

      if (!responseBody) {
        return null;
      }

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (
          threshold &&
          responseBody &&
          (responseBody as string).includes(threshold as string)
        ) {
          return `Response body contains ${threshold}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (
          threshold &&
          responseBody &&
          !(responseBody as string).includes(threshold as string)
        ) {
          return `Response body does not contain ${threshold}.`;
        }
        return null;
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.ResponseHeader) {
      const headerKeys: Array<string> = Object.keys(
        (input.dataToProcess as ProbeMonitorResponse).responseHeaders || {},
      ).map((key: string) => {
        return key.toLowerCase();
      });

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (
          threshold &&
          headerKeys &&
          headerKeys.includes(threshold as string)
        ) {
          return `Response header contains ${threshold}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (
          threshold &&
          headerKeys &&
          !headerKeys.includes(threshold as string)
        ) {
          return `Response header does not contain ${threshold}.`;
        }
        return null;
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.ResponseHeaderValue) {
      const headerValues: Array<string> = Object.values(
        (input.dataToProcess as ProbeMonitorResponse).responseHeaders || {},
      ).map((key: string) => {
        return key.toLowerCase();
      });

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (
          threshold &&
          headerValues &&
          headerValues.includes(threshold as string)
        ) {
          return `Response header threshold contains ${threshold}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (
          threshold &&
          headerValues &&
          !headerValues.includes(threshold as string)
        ) {
          return `Response header threshold does not contain ${threshold}.`;
        }
        return null;
      }
    }

    return null;
  }
}
