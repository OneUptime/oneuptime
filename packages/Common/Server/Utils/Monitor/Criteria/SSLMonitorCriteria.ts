import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import OneUptimeDate from "../../../../Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import CertificateRevocationStatus from "../../../../Types/Monitor/SSLMonitor/CertificateRevocationStatus";
import SslMonitorResponse from "../../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class ServerMonitorCriteria {
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
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const sslResponse: SslMonitorResponse | undefined =
      dataToProcess.sslResponse;

    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: (input.dataToProcess as ProbeMonitorResponse).projectId,
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

    if (input.criteriaFilter.checkOn === CheckOn.IsRevokedCertificate) {
      /*
       * Only the issuer's signed answer counts. A status of Unknown (no
       * answer could be had) or none at all (the check did not run) is not
       * a revocation, as in a browser.
       */
      const isRevoked: boolean =
        ServerMonitorCriteria.isRevokedCertificate(sslResponse);

      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;

      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (isRevoked && isTrue) {
        return ServerMonitorCriteria.revokedCertificateReason(sslResponse!);
      }

      if (!isRevoked && isFalse) {
        return "SSL certificate is not revoked.";
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
   * never both be false for the same response - and by the evaluation's
   * description of what was found (MonitorCriteriaObservationBuilder), so a
   * certificate the criteria call not valid is never described as valid.
   *
   * The probe now records the strict-TLS verdict explicitly on
   * sslResponse.isValidCertificate. Responses written before that field
   * existed (rows already in MonitorProbe.lastMonitoringLog, and any probe
   * still running an older build) do not carry it, so the pre-existing
   * heuristic is kept as the fallback rather than treating those as
   * invalid and flipping healthy monitors to Down on upgrade.
   *
   * A revoked certificate needs nothing here: the probe records it as not
   * valid (isValidCertificate false, CERT_REVOKED), like any other
   * certificate a browser would refuse.
   */
  public static isValidCertificate(
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
  public static invalidCertificateReason(
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

    // The probe names a revocation here too: when, and why.
    if (sslResponse.certificateValidationError) {
      return `SSL certificate is not valid: ${sslResponse.certificateValidationError}`;
    }

    if (ServerMonitorCriteria.isRevokedCertificate(sslResponse)) {
      return `SSL certificate is not valid: the certificate ${ServerMonitorCriteria.describeRevocation(sslResponse)}.`;
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

  /*
   * Whether the issuer's signed answer (an OCSP response or a CRL) says the
   * certificate is revoked. Unknown - no signed answer could be had - and
   * no status at all (the check did not run: the certificate failed
   * validation for another reason, the probe has the check turned off, or
   * the probe is older than the check) are not a revocation, as in a
   * browser.
   */
  public static isRevokedCertificate(
    sslResponse: SslMonitorResponse | undefined | null,
  ): boolean {
    return (
      sslResponse?.revocationStatus === CertificateRevocationStatus.Revoked
    );
  }

  // "SSL certificate has been revoked by its issuer on <when> (reason: <why>)."
  public static revokedCertificateReason(
    sslResponse: SslMonitorResponse,
  ): string {
    return `SSL certificate ${ServerMonitorCriteria.describeRevocation(sslResponse)}.`;
  }

  /*
   * "has been revoked by its issuer on 2026-11-10T08:00:00.000Z (reason: Key
   * Compromise)", leaving out whichever of the two the issuer did not say.
   * The date reaches the server as an ISO string (the probe's response is
   * sent as JSON); one that cannot be read is left out rather than shown
   * as "Invalid Date".
   */
  private static describeRevocation(sslResponse: SslMonitorResponse): string {
    let description: string = "has been revoked by its issuer";

    const revokedAt: string | null = OneUptimeDate.toIsoStringOrNull(
      sslResponse.revokedAt,
    );

    if (revokedAt) {
      /*
       * Written as the probe writes it in the certificate problem
       * ("2026-11-10 08:00:00 UTC"), so the two read alike in one incident.
       */
      description += ` on ${revokedAt.replace("T", " ").slice(0, 19)} UTC`;
    }

    const reason: string =
      typeof sslResponse.revocationReason === "string"
        ? sslResponse.revocationReason.trim()
        : "";

    if (reason) {
      description += ` (reason: ${reason})`;
    }

    return description;
  }
}
