import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import OneUptimeDate from "../../../../Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import SslMonitorResponse from "../../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EvaluateOverTime from "./EvaluateOverTime";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";

export default class ServerMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const sslResponse: SslMonitorResponse | undefined =
      dataToProcess.sslResponse;

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

    if (input.criteriaFilter.checkOn === CheckOn.IsValidCertificate) {
      const isValidCertificate: boolean = Boolean(
        sslResponse &&
          dataToProcess.isOnline &&
          sslResponse.expiresAt &&
          !sslResponse.isSelfSigned &&
          OneUptimeDate.isAfter(
            sslResponse.expiresAt,
            OneUptimeDate.getCurrentDate(),
          ),
      );

      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;

      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (isValidCertificate && isTrue) {
        return "SSL certificate is valid.";
      }

      if (!isValidCertificate && isFalse) {
        return "SSL certificate is not valid.";
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.IsSelfSignedCertificate) {
      const isSelfSigned: boolean = Boolean(
        sslResponse && sslResponse.isSelfSigned,
      );
      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;

      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (isSelfSigned && isTrue) {
        return "SSL Certificate is self signed.";
      }

      if (!isSelfSigned && isFalse) {
        return "SSL Certificate is not self signed.";
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.IsExpiredCertificate) {
      const isExpired: boolean = Boolean(
        sslResponse &&
          sslResponse.expiresAt &&
          OneUptimeDate.isBefore(
            sslResponse.expiresAt,
            OneUptimeDate.getCurrentDate(),
          ),
      );

      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;

      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (isExpired && isTrue) {
        return "SSL certificate is expired.";
      }

      if (!isExpired && isFalse) {
        return "SSL certificate is not expired.";
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.IsNotAValidCertificate) {
      const isNotValid: boolean =
        !sslResponse ||
        !dataToProcess.isOnline ||
        Boolean(
          sslResponse &&
            sslResponse.expiresAt &&
            (sslResponse.isSelfSigned ||
              OneUptimeDate.isBefore(
                sslResponse.expiresAt,
                OneUptimeDate.getCurrentDate(),
              )),
        );
      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;

      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (isNotValid && isTrue) {
        return "SSL certificate is not valid.";
      }

      if (!isNotValid && isFalse) {
        return "SSL certificate is valid.";
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.ExpiresInHours) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (!threshold) {
        return null;
      }

      const expiresAt: Date | undefined = sslResponse && sslResponse.expiresAt;
      const hours: number | undefined =
        expiresAt &&
        OneUptimeDate.getHoursBetweenTwoDates(
          OneUptimeDate.getCurrentDate(),
          expiresAt,
        );

      if (hours === null || hours === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: hours,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.ExpiresInDays) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (!threshold) {
        return null;
      }

      const expiresAt: Date | undefined = sslResponse && sslResponse.expiresAt;
      const days: number | undefined =
        expiresAt &&
        OneUptimeDate.getDaysBetweenTwoDates(
          OneUptimeDate.getCurrentDate(),
          expiresAt,
        );

      if (days === null || days === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: days,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
