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
import EvaluateOverTime from "./EvaluateOverTime";
import CompareCriteria from "./CompareCriteria";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class IncomingRequestCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
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

    let overTimeValue: Array<number | boolean> | number | boolean | undefined =
      undefined;

    if (
      input.criteriaFilter.evaluateOverTime &&
      input.criteriaFilter.evaluateOverTimeOptions
    ) {
      try {
        overTimeValue = await EvaluateOverTime.getValueOverTime({
          projectId: (input.dataToProcess as IncomingMonitorRequest).projectId,
          monitorId: input.dataToProcess.monitorId!,
          evaluateOverTimeOptions: input.criteriaFilter.evaluateOverTimeOptions,
          metricType: input.criteriaFilter.checkOn,
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

    // timeout.
    if (input.criteriaFilter.checkOn === CheckOn.IsRequestTimeout) {
      const currentIsTimeout: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ||
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

    if (
      input.criteriaFilter.checkOn === CheckOn.RequestBody &&
      !(input.dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt
    ) {
      let responseBody: string | JSONObject | undefined = (
        input.dataToProcess as IncomingMonitorRequest
      ).requestBody;

      if (responseBody && typeof responseBody === Typeof.Object) {
        responseBody = JSON.stringify(responseBody);
      }

      if (!responseBody) {
        return null;
      }

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (
          value &&
          responseBody &&
          (responseBody as string).includes(value as string)
        ) {
          return `Request body contains ${value}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (
          value &&
          responseBody &&
          !(responseBody as string).includes(value as string)
        ) {
          return `Request body does not contain ${value}.`;
        }
        return null;
      }
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.RequestHeader &&
      !(input.dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt
    ) {
      const headerKeys: Array<string> = Object.keys(
        (input.dataToProcess as IncomingMonitorRequest).requestHeaders || {},
      ).map((key: string) => {
        return key.toLowerCase();
      });

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (value && headerKeys && headerKeys.includes(value as string)) {
          return `Request header contains ${value}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (value && headerKeys && !headerKeys.includes(value as string)) {
          return `Request header does not contain ${value}.`;
        }
        return null;
      }
    }

    if (
      input.criteriaFilter.checkOn === CheckOn.RequestHeaderValue &&
      !(input.dataToProcess as IncomingMonitorRequest)
        .onlyCheckForIncomingRequestReceivedAt
    ) {
      const headerValues: Array<string> = Object.values(
        (input.dataToProcess as IncomingMonitorRequest).requestHeaders || {},
      ).map((key: string) => {
        return key.toLowerCase();
      });

      // contains
      if (input.criteriaFilter.filterType === FilterType.Contains) {
        if (value && headerValues && headerValues.includes(value as string)) {
          return `Request header value contains ${value}.`;
        }
        return null;
      }

      if (input.criteriaFilter.filterType === FilterType.NotContains) {
        if (value && headerValues && !headerValues.includes(value as string)) {
          return `Request header value does not contain ${value}.`;
        }
        return null;
      }
    }

    return null;
  }
}
