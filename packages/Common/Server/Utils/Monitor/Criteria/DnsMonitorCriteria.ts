import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import DnsMonitorResponse from "../../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class DnsMonitorCriteria {
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

    const dnsResponse: DnsMonitorResponse | undefined =
      dataToProcess.dnsResponse;

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

    // Check if DNS is online
    if (input.criteriaFilter.checkOn === CheckOn.DnsIsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ??
        (input.dataToProcess as ProbeMonitorResponse).isOnline;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check DNS response time
    if (input.criteriaFilter.checkOn === CheckOn.DnsResponseTime) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      const currentResponseTime: number | Array<number> =
        (overTimeValue as Array<number>) ??
        (dnsResponse?.responseTimeInMs ||
          (input.dataToProcess as ProbeMonitorResponse).responseTimeInMs);

      if (currentResponseTime === null || currentResponseTime === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: currentResponseTime,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check if DNS record exists
    if (input.criteriaFilter.checkOn === CheckOn.DnsRecordExists) {
      const exists: boolean = Boolean(
        dnsResponse?.records && dnsResponse.records.length > 0,
      );

      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;
      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (exists && isTrue) {
        return `DNS records exist for the query.`;
      }

      if (!exists && isFalse) {
        return `No DNS records found for the query.`;
      }

      return null;
    }

    // Check DNSSEC validity
    if (input.criteriaFilter.checkOn === CheckOn.DnssecIsValid) {
      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;
      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (dnsResponse?.isDnssecValid === undefined) {
        return null;
      }

      if (dnsResponse.isDnssecValid && isTrue) {
        return `DNSSEC is valid.`;
      }

      if (!dnsResponse.isDnssecValid && isFalse) {
        return `DNSSEC is not valid.`;
      }

      return null;
    }

    // Check DNS record value
    if (input.criteriaFilter.checkOn === CheckOn.DnsRecordValue) {
      if (!dnsResponse?.records || dnsResponse.records.length === 0) {
        return null;
      }

      // Check if any record value matches the criteria
      for (const record of dnsResponse.records) {
        const recordValue: string = record.value;

        // Try numeric comparison first
        if (
          typeof threshold === "number" ||
          (typeof threshold === "string" && !isNaN(Number(threshold)))
        ) {
          const numericThreshold: number | null =
            CompareCriteria.convertToNumber(threshold);

          if (numericThreshold !== null && !isNaN(Number(recordValue))) {
            const result: string | null =
              CompareCriteria.compareCriteriaNumbers({
                value: Number(recordValue),
                threshold: numericThreshold,
                criteriaFilter: input.criteriaFilter,
              });

            if (result) {
              return `DNS record (${record.type}): ${result}`;
            }
          }
        }

        // String comparison
        const result: string | null = CompareCriteria.compareCriteriaStrings({
          value: recordValue,
          threshold: String(threshold),
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return `DNS record (${record.type}): ${result}`;
        }
      }
    }

    return null;
  }
}
