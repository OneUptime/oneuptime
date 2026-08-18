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
      const isValidCertificate: boolean =
        ServerMonitorCriteria.isValidCertificate(dataToProcess);

      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;

      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (isValidCertificate && isTrue) {
        return "SSL certificate is valid.";
      }

      if (!isValidCertificate && isFalse) {
        return ServerMonitorCriteria.invalidCertificateReason(dataToProcess);
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
      /*
       * The exact complement of IsValidCertificate, by construction.
       *
       * These two used to be computed independently, and both came out
       * false whenever expiresAt was missing or unparseable - so a
       * certificate the probe could not fully read satisfied NEITHER
       * "valid" nor "not valid", every criterion went unmatched, and the
       * monitor silently stayed at its default status. Deriving one from
       * the other makes that state unreachable.
       */
      const isNotValid: boolean =
        !ServerMonitorCriteria.isValidCertificate(dataToProcess);

      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;

      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (isNotValid && isTrue) {
        return ServerMonitorCriteria.invalidCertificateReason(dataToProcess);
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

  /*
   * The single source of truth for "is this certificate trustworthy",
   * shared by IsValidCertificate and IsNotAValidCertificate so the two can
   * never both be false for the same response.
   *
   * The probe now records the strict-TLS verdict explicitly on
   * sslResponse.isValidCertificate. Responses written before that field
   * existed (rows already in MonitorProbe.lastMonitoringLog, and any probe
   * still running an older build) do not carry it, so the pre-existing
   * heuristic is kept as the fallback rather than treating those as
   * invalid and flipping healthy monitors to Down on upgrade.
   */
  private static isValidCertificate(
    dataToProcess: ProbeMonitorResponse,
  ): boolean {
    const sslResponse: SslMonitorResponse | undefined =
      dataToProcess.sslResponse;

    if (!sslResponse || !dataToProcess.isOnline) {
      return false;
    }

    if (sslResponse.isValidCertificate !== undefined) {
      return Boolean(sslResponse.isValidCertificate);
    }

    // Legacy payload: fall back to what could be inferred before.
    return Boolean(
      sslResponse.expiresAt &&
        !sslResponse.isSelfSigned &&
        OneUptimeDate.isAfter(
          sslResponse.expiresAt,
          OneUptimeDate.getCurrentDate(),
        ),
    );
  }

  /*
   * Names WHY the certificate is not trustworthy. The root cause is what
   * reaches the incident and the person paged by it, so "SSL certificate is
   * not valid" on its own is not good enough when the probe knows it was a
   * hostname mismatch.
   */
  private static invalidCertificateReason(
    dataToProcess: ProbeMonitorResponse,
  ): string {
    const sslResponse: SslMonitorResponse | undefined =
      dataToProcess.sslResponse;

    if (!dataToProcess.isOnline) {
      return "SSL certificate could not be checked because the endpoint is not reachable.";
    }

    if (!sslResponse) {
      return "SSL certificate is not valid.";
    }

    if (sslResponse.certificateValidationError) {
      return `SSL certificate is not valid: ${sslResponse.certificateValidationError}`;
    }

    if (sslResponse.isSelfSigned) {
      return "SSL certificate is not valid: the certificate is self signed.";
    }

    if (
      sslResponse.expiresAt &&
      OneUptimeDate.isBefore(
        sslResponse.expiresAt,
        OneUptimeDate.getCurrentDate(),
      )
    ) {
      return "SSL certificate is not valid: the certificate has expired.";
    }

    return "SSL certificate is not valid.";
  }
}
