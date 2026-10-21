import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import NtpMonitorResponse from "../../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import NtpMonitorUtil from "../../../../Types/Monitor/NtpMonitor/NtpMonitorUtil";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Criteria for NTP monitors, over what the probe found (NtpMonitorResponse).
 *
 * A filter that has nothing to judge returns null - "not met" - rather than
 * guessing. That matters most for the three that describe the server's time:
 * a server that did not answer has no stratum, offset or synchronized state,
 * so "NTP Is Synchronized is False" does not fire on an unreachable server.
 * Reachability is what "NTP Is Online" is for, and the default offline
 * criteria checks both.
 */
export default class NtpMonitorCriteria {
  public static isNtpCheckOn(checkOn: CheckOn | undefined): boolean {
    return (
      checkOn === CheckOn.NtpIsOnline ||
      checkOn === CheckOn.NtpIsSynchronized ||
      checkOn === CheckOn.NtpStratum ||
      checkOn === CheckOn.NtpClockOffset ||
      checkOn === CheckOn.NtpResponseTime ||
      checkOn === CheckOn.NtpRootDispersion
    );
  }

  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    /*
     * The monitor's monitoringInterval cron. Over-time filters use it to
     * work out how many samples a fully covered window should hold.
     */
    monitoringInterval?: string | undefined;
  }): Promise<string | null> {
    const criteriaFilter: CriteriaFilter = input.criteriaFilter;

    if (!NtpMonitorCriteria.isNtpCheckOn(criteriaFilter.checkOn)) {
      return null;
    }

    const probeResponse: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;
    const ntpResponse: NtpMonitorResponse | undefined =
      probeResponse.ntpResponse;

    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: probeResponse.projectId,
        monitorId: input.dataToProcess.monitorId!,
        criteriaFilter: criteriaFilter,
        monitoringInterval: input.monitoringInterval,
      });

    /*
     * The window could not back this over-time filter yet: return what the
     * no-data policy decided, never the one value that came with this check.
     */
    if (overTime.earlyReturn) {
      return overTime.earlyReturn.result;
    }

    const overTimeValue:
      | Array<number | boolean>
      | number
      | boolean
      | undefined = overTime.value;

    const isAnswered: boolean = Boolean(ntpResponse?.isOnline);

    switch (criteriaFilter.checkOn) {
      case CheckOn.NtpIsOnline: {
        const isOnline: boolean | Array<boolean> | undefined =
          (overTimeValue as Array<boolean> | undefined) ??
          ntpResponse?.isOnline ??
          probeResponse.isOnline;

        if (isOnline === undefined || isOnline === null) {
          return null;
        }

        const message: string | null = CompareCriteria.compareCriteriaBoolean({
          value: isOnline,
          criteriaFilter: criteriaFilter,
        });

        if (!message) {
          return null;
        }

        /*
         * Say why it did not answer: a timeout, a refused port and a name
         * that does not resolve are three different fixes.
         */
        const failureCause: string =
          ntpResponse?.failureCause || probeResponse.failureCause || "";

        return NtpMonitorCriteria.withDetail(
          message,
          overTimeValue === undefined && !isAnswered && failureCause
            ? failureCause
            : undefined,
        );
      }

      case CheckOn.NtpIsSynchronized: {
        if (overTimeValue === undefined && !isAnswered) {
          return null;
        }

        const isSynchronized: boolean | Array<boolean> | undefined =
          (overTimeValue as Array<boolean> | undefined) ??
          ntpResponse?.isSynchronized;

        if (isSynchronized === undefined || isSynchronized === null) {
          return null;
        }

        const message: string | null = CompareCriteria.compareCriteriaBoolean({
          value: isSynchronized,
          criteriaFilter: criteriaFilter,
        });

        if (!message) {
          return null;
        }

        return NtpMonitorCriteria.withDetail(
          message,
          overTimeValue === undefined &&
            ntpResponse &&
            !ntpResponse.isSynchronized &&
            ntpResponse.failureCause
            ? ntpResponse.failureCause
            : undefined,
        );
      }

      case CheckOn.NtpStratum: {
        const stratum: number | Array<number> | undefined =
          (overTimeValue as Array<number> | number | undefined) ??
          (isAnswered
            ? NtpMonitorUtil.getEffectiveStratum(ntpResponse?.stratum)
            : undefined);

        return NtpMonitorCriteria.compareNumber({
          value: stratum,
          criteriaFilter: criteriaFilter,
          detail:
            overTimeValue === undefined && ntpResponse
              ? `Stratum ${NtpMonitorUtil.describeStratum(
                  ntpResponse.stratum,
                  ntpResponse.kissCode,
                )}.`
              : undefined,
        });
      }

      case CheckOn.NtpClockOffset: {
        const offset: number | Array<number> | undefined =
          (overTimeValue as Array<number> | number | undefined) ??
          (isAnswered
            ? NtpMonitorUtil.getAbsoluteClockOffsetInMs(ntpResponse)
            : undefined);

        return NtpMonitorCriteria.compareNumber({
          value: offset,
          criteriaFilter: criteriaFilter,
          detail:
            overTimeValue === undefined &&
            ntpResponse?.clockOffsetInMs !== undefined
              ? `The server's clock is ${NtpMonitorUtil.describeClockOffset(
                  ntpResponse.clockOffsetInMs,
                )}.`
              : undefined,
        });
      }

      case CheckOn.NtpRootDispersion: {
        const rootDispersion: number | Array<number> | undefined =
          (overTimeValue as Array<number> | number | undefined) ??
          (isAnswered ? ntpResponse?.rootDispersionInMs : undefined);

        return NtpMonitorCriteria.compareNumber({
          value: rootDispersion,
          criteriaFilter: criteriaFilter,
          detail: undefined,
        });
      }

      case CheckOn.NtpResponseTime: {
        const responseTime: number | Array<number> | undefined =
          (overTimeValue as Array<number> | number | undefined) ??
          (isAnswered
            ? ntpResponse?.responseTimeInMs ?? probeResponse.responseTimeInMs
            : undefined);

        return NtpMonitorCriteria.compareNumber({
          value: responseTime,
          criteriaFilter: criteriaFilter,
          detail: undefined,
        });
      }

      default:
        return null;
    }
  }

  private static compareNumber(data: {
    value: number | Array<number> | undefined;
    criteriaFilter: CriteriaFilter;
    detail: string | undefined;
  }): string | null {
    if (data.value === undefined || data.value === null) {
      return null;
    }

    /*
     * Parsed as a decimal: a LAN time server is judged in fractions of a
     * millisecond, and convertToNumber's parseInt would read "0.5" as 0.
     */
    const threshold: number | null =
      CompareCriteria.convertMetricThresholdToNumber(data.criteriaFilter.value);

    if (threshold === null || threshold === undefined) {
      return null;
    }

    const message: string | null = CompareCriteria.compareCriteriaNumbers({
      value: data.value,
      threshold: threshold,
      criteriaFilter: data.criteriaFilter,
    });

    if (!message) {
      return null;
    }

    return NtpMonitorCriteria.withDetail(message, data.detail);
  }

  private static withDetail(
    message: string,
    detail: string | undefined,
  ): string {
    return detail ? `${message.trim()} ${detail}` : message.trim();
  }
}
