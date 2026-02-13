import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import DnsMonitorResponse from "../../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EvaluateOverTime from "./EvaluateOverTime";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";

export default class DnsMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const dnsResponse: DnsMonitorResponse | undefined =
      dataToProcess.dnsResponse;

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

    // Check if DNS is online
    if (input.criteriaFilter.checkOn === CheckOn.DnsIsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ||
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
        (overTimeValue as Array<number>) ||
        dnsResponse?.responseTimeInMs ||
        (input.dataToProcess as ProbeMonitorResponse).responseTimeInMs;

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
