import logger from "../../../Utils/Logger";
import DataToProcess from "../DataToProcess";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import Typeof from "../../../../Types/Typeof";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import CompareCriteria from "./CompareCriteria";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class IncomingRequestCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    /*
     * The monitor's monitoringInterval cron. Over-time filters use it to
     * work out how many samples a fully covered window should hold, so a
     * monitor that has only just started is not mistaken for one whose
     * whole window is breaching.
     */
    monitoringInterval?: string | undefined;
  }): Promise<string | null> {
    // Server Monitoring Checks

    logger.debug(
      "Checking IncomingRequestCriteria for Monitor: " +
        input.dataToProcess.monitorId.toString(),
    );

    logger.debug(
      "Data to process: " + JSON.stringify(input.dataToProcess, null, 2),
    );

    logger.debug(
      "Criteria Filter: " + JSON.stringify(input.criteriaFilter, null, 2),
    );

    let value: number | string | undefined = input.criteriaFilter.value;

    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: (input.dataToProcess as IncomingMonitorRequest).projectId,
        monitorId: input.dataToProcess.monitorId!,
        criteriaFilter: input.criteriaFilter,
        monitoringInterval: input.monitoringInterval,
      });

    /*
     * The window could not back this over-time filter (nothing recorded yet,
     * or the monitor has not been running long enough to cover it). Return
     * the decision the no-data policy already made instead of falling
     * through to the value that arrived with this one check - that fallback
     * is what let "all values over the last N minutes" fire off a single
     * bad reading.
     */
    if (overTime.earlyReturn) {
      return overTime.earlyReturn.result;
    }

    const overTimeValue:
      | Array<number | boolean>
      | number
      | boolean
      | undefined = overTime.value;

    if (input.criteriaFilter.checkOn === CheckOn.IsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ??
        (input.dataToProcess as ProbeMonitorResponse).isOnline;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // timeout.
    if (input.criteriaFilter.checkOn === CheckOn.IsRequestTimeout) {
      const currentIsTimeout: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ??
        (input.dataToProcess as ProbeMonitorResponse).isTimeout;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsTimeout,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // All incoming request related checks

    if (input.criteriaFilter.checkOn === CheckOn.IncomingRequest) {
      logger.debug(
        "Checking IncomingRequest for Monitor: " +
          input.dataToProcess.monitorId.toString(),
      );

      const lastCheckTime: Date = (
        input.dataToProcess as IncomingMonitorRequest
      ).incomingRequestReceivedAt;

      logger.debug("Last Check Time: " + lastCheckTime);

      const differenceInMinutes: number = OneUptimeDate.getDifferenceInMinutes(
        lastCheckTime,
        (input.dataToProcess as IncomingMonitorRequest)?.checkedAt ||
          OneUptimeDate.getCurrentDate(),
      );

      logger.debug("Difference in minutes: " + differenceInMinutes);

      if (!value) {
        return null;
      }

      if (typeof value === Typeof.String) {
        try {
          value = parseInt(value as string);
        } catch (err) {
          logger.error(err);
          return null;
        }
      }

      if (typeof value !== Typeof.Number) {
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.RecievedInMinutes) {
        logger.debug(
          "Checking RecievedInMinutes for Monitor: " +
            input.dataToProcess.monitorId.toString(),
        );
        if (value && differenceInMinutes <= (value as number)) {
          logger.debug(
            "RecievedInMinutes for Monitor: " +
              input.dataToProcess.monitorId.toString() +
              " is true",
          );
          return `Incoming request / heartbeat received in ${value} minutes. It was received ${differenceInMinutes} minutes ago.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotRecievedInMinutes) {
        logger.debug(
          "Checking NotRecievedInMinutes for Monitor: " +
            input.dataToProcess.monitorId.toString(),
        );
        if (value && differenceInMinutes > (value as number)) {
          logger.debug(
            "NotRecievedInMinutes for Monitor: " +
              input.dataToProcess.monitorId.toString() +
              " is true",
          );
          return `Incoming request / heartbeat not received in ${value} minutes. It was received ${differenceInMinutes} minutes ago.`;
        }
        return null;
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.RequestBody) {
      let requestBody: string | JSONObject | undefined = (
        input.dataToProcess as IncomingMonitorRequest
      ).requestBody;

      if (requestBody && typeof requestBody === Typeof.Object) {
        requestBody = JSON.stringify(requestBody);
      }

      /*
       * A request that carried no body is an empty body, not an unknown one.
       * Normalising to "" (the same thing IncomingEmailCriteria does for the
       * email fields) is what lets a "Not Contains" filter match a bodiless
       * heartbeat ping - the default online criteria for this monitor type.
       * "Contains" is unaffected: "" contains nothing.
       */
      const body: string = (requestBody as string | undefined) || "";

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (value && body.includes(value as string)) {
          return `Request body contains ${value}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (value && !body.includes(value as string)) {
          return `Request body does not contain ${value}.`;
        }
        return null;
      }
    }

    /*
     * Header names and values are compared case-insensitively, and BOTH
     * sides are lower-cased for it.
     *
     * Only the observed side used to be: a filter typed as "X-Api-Key" (the
     * spelling every HTTP client and every piece of documentation uses) was
     * matched against a list that had already been lower-cased, so Contains
     * could never fire and NotContains fired on every single request. The
     * lower-casing of the observed side is what says the intent was
     * case-insensitive; this is the other half of it.
     */
    const criteriaValueLowerCase: string | null =
      typeof value === Typeof.String ? (value as string).toLowerCase() : null;

    if (input.criteriaFilter.checkOn === CheckOn.RequestHeader) {
      const headerKeys: Array<string> = Object.keys(
        (input.dataToProcess as IncomingMonitorRequest).requestHeaders || {},
      ).map((key: string) => {
        return key.toLowerCase();
      });

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (
          criteriaValueLowerCase &&
          headerKeys.includes(criteriaValueLowerCase)
        ) {
          return `Request header contains ${value}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (
          criteriaValueLowerCase &&
          !headerKeys.includes(criteriaValueLowerCase)
        ) {
          return `Request header does not contain ${value}.`;
        }
        return null;
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.RequestHeaderValue) {
      const headerValues: Array<string> = Object.values(
        (input.dataToProcess as IncomingMonitorRequest).requestHeaders || {},
      ).map((key: string) => {
        return key.toLowerCase();
      });

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (
          criteriaValueLowerCase &&
          headerValues.includes(criteriaValueLowerCase)
        ) {
          return `Request header value contains ${value}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (
          criteriaValueLowerCase &&
          !headerValues.includes(criteriaValueLowerCase)
        ) {
          return `Request header value does not contain ${value}.`;
        }
        return null;
      }
    }

    return null;
  }
}
