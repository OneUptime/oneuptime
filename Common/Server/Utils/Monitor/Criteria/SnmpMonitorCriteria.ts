import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EvaluateOverTime from "./EvaluateOverTime";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";

export default class SnmpMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const snmpResponse: SnmpMonitorResponse | undefined =
      dataToProcess.snmpResponse;

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

    // Check if SNMP device is online
    if (input.criteriaFilter.checkOn === CheckOn.SnmpIsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ||
        (input.dataToProcess as ProbeMonitorResponse).isOnline;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check SNMP response time
    if (input.criteriaFilter.checkOn === CheckOn.SnmpResponseTime) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      const currentResponseTime: number | Array<number> =
        (overTimeValue as Array<number>) ||
        snmpResponse?.responseTimeInMs ||
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

    // Check if a specific OID exists (returns a value)
    if (input.criteriaFilter.checkOn === CheckOn.SnmpOidExists) {
      const oid: string | undefined =
        input.criteriaFilter.snmpMonitorOptions?.oid;

      if (!oid) {
        return null;
      }

      const oidResponse: SnmpOidResponse | undefined =
        snmpResponse?.oidResponses?.find((response: SnmpOidResponse) => {
          return response.oid === oid;
        });

      const exists: boolean = Boolean(
        oidResponse && oidResponse.value !== null,
      );

      const isTrue: boolean =
        input.criteriaFilter.filterType === FilterType.True;
      const isFalse: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (exists && isTrue) {
        return `SNMP OID ${oid} exists and returned a value.`;
      }

      if (!exists && isFalse) {
        return `SNMP OID ${oid} does not exist or returned no value.`;
      }

      return null;
    }

    // Check the value of a specific OID
    if (input.criteriaFilter.checkOn === CheckOn.SnmpOidValue) {
      const oid: string | undefined =
        input.criteriaFilter.snmpMonitorOptions?.oid;

      if (!oid) {
        return null;
      }

      const oidResponse: SnmpOidResponse | undefined =
        snmpResponse?.oidResponses?.find((response: SnmpOidResponse) => {
          return response.oid === oid;
        });

      if (!oidResponse || oidResponse.value === null) {
        return null;
      }

      const oidValue: string | number = oidResponse.value;

      // Numeric comparison
      if (typeof oidValue === "number" || !isNaN(Number(oidValue))) {
        const numericValue: number =
          typeof oidValue === "number" ? oidValue : Number(oidValue);
        const numericThreshold: number | null =
          CompareCriteria.convertToNumber(threshold);

        if (numericThreshold !== null) {
          const result: string | null = CompareCriteria.compareCriteriaNumbers({
            value: numericValue,
            threshold: numericThreshold,
            criteriaFilter: input.criteriaFilter,
          });

          if (result) {
            return `SNMP OID ${oid} (${oidResponse.name || oid}): ${result}`;
          }
        }
      }

      // String comparison
      const result: string | null = CompareCriteria.compareCriteriaStrings({
        value: String(oidValue),
        threshold: String(threshold),
        criteriaFilter: input.criteriaFilter,
      });

      if (result) {
        return `SNMP OID ${oid} (${oidResponse.name || oid}): ${result}`;
      }
    }

    return null;
  }
}
