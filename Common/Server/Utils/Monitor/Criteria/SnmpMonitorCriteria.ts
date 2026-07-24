import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpTrap from "../../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EvaluateOverTime from "./EvaluateOverTime";
import MetricBaselineService, {
  BaselineSummary,
  MetricBaselineService as MetricBaselineServiceClass,
} from "../../../Services/MetricBaselineService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";

export default class SnmpMonitorCriteria {
  /*
   * Interface scope for the interface CheckOns: when the criteria carries
   * snmpMonitorOptions.interfaceName, only interfaces whose name or alias
   * equals it (case-insensitive) are evaluated. Empty scope = every
   * monitored interface (the historical behavior). Applies to the
   * instantaneous values in the poll response; over-time aggregation
   * remains device-wide.
   */
  private static scopeInterfaces(
    interfaces: Array<SnmpInterface>,
    criteriaFilter: CriteriaFilter,
  ): Array<SnmpInterface> {
    const scope: string = (
      criteriaFilter.snmpMonitorOptions?.interfaceName || ""
    )
      .trim()
      .toLowerCase();

    if (!scope) {
      return interfaces;
    }

    return interfaces.filter((snmpInterface: SnmpInterface) => {
      return (
        snmpInterface.name?.trim().toLowerCase() === scope ||
        snmpInterface.alias?.trim().toLowerCase() === scope
      );
    });
  }

  /*
   * Anomaly path for interface utilization: compares the busiest in-scope
   * interface's current utilization to this monitor's same-hour-of-week
   * baseline of the oneuptime.monitor.snmp.interface.utilization.percent
   * metric. MonitorMetricUtil writes that metric every check with the
   * monitorId as the metric's primaryEntityId, so the MetricBaselineHourly
   * MV already keys a per-monitor baseline — this reuses it via
   * MetricBaselineService exactly like MetricMonitorCriteria does.
   *
   * Note the baseline aggregates every interface sample the monitor
   * emitted (interfaces are attributes, not part of the baseline key)
   * while the observed value is the busiest in-scope interface — the same
   * "worst interface vs device-wide history" trade-off the static
   * threshold path already makes.
   *
   * Missing or unreliable baselines mean the rule is still learning —
   * never alert from a thin baseline. Zero-variance baselines are skipped
   * too: any deviation at all would fire.
   */
  private static async evaluateUtilizationAnomaly(input: {
    projectId: ObjectID;
    monitorId: ObjectID;
    criteriaFilter: CriteriaFilter;
    observedUtilizationPercent: number;
  }): Promise<string | null> {
    const sensitivity: AnomalyDetectionSensitivity =
      (input.criteriaFilter.metricMonitorOptions?.anomalyDetection
        ?.sensitivity as AnomalyDetectionSensitivity | undefined) ||
      AnomalyDetectionSensitivity.Medium;
    const sigmaCount: number =
      MetricBaselineServiceClass.sigmaForSensitivity(sensitivity);

    let baseline: BaselineSummary | null = null;
    try {
      baseline = await MetricBaselineService.getBaseline({
        projectId: input.projectId.toString(),
        metricName: MonitorMetricType.SnmpInterfaceUtilizationPercent,
        primaryEntityId: input.monitorId.toString(),
        hourOfWeek: MetricBaselineServiceClass.computeHourOfWeek(
          OneUptimeDate.getCurrentDate(),
        ),
        windowDays:
          input.criteriaFilter.metricMonitorOptions?.anomalyDetection
            ?.windowDays,
        minSamples:
          input.criteriaFilter.metricMonitorOptions?.anomalyDetection
            ?.minSamples,
      });
    } catch (err) {
      logger.error(
        "Error fetching SNMP interface utilization baseline for anomaly criteria",
      );
      logger.error(err);
      return null;
    }

    if (!baseline || !baseline.isReliable) {
      // Cold start: the baseline is still learning; nothing to compare to.
      return null;
    }

    if (!Number.isFinite(baseline.stddev) || baseline.stddev === 0) {
      // A zero-variance baseline would flag every deviation. Skip.
      return null;
    }

    const expectedHigh: number = baseline.mean + sigmaCount * baseline.stddev;
    const expectedLow: number = baseline.mean - sigmaCount * baseline.stddev;
    const observed: number = input.observedUtilizationPercent;

    const isHighBreach: boolean = observed > expectedHigh;
    const isLowBreach: boolean = observed < expectedLow;

    let breaches: boolean = false;
    if (input.criteriaFilter.filterType === FilterType.AnomalouslyHigh) {
      breaches = isHighBreach;
    } else if (input.criteriaFilter.filterType === FilterType.AnomalouslyLow) {
      breaches = isLowBreach;
    } else if (input.criteriaFilter.filterType === FilterType.Anomalous) {
      breaches = isHighBreach || isLowBreach;
    }

    if (!breaches) {
      return null;
    }

    const observedSigma: number = (observed - baseline.mean) / baseline.stddev;
    const direction: string = observedSigma >= 0 ? "above" : "below";

    return (
      `SNMP interface utilization ${observed.toFixed(2)}% is ` +
      `${Math.abs(observedSigma).toFixed(2)}σ ${direction} the same-hour baseline ` +
      `(mean ${baseline.mean.toFixed(2)}%, σ ${baseline.stddev.toFixed(2)}%, ` +
      `${baseline.sampleCount} samples over ${baseline.windowDays} days, ` +
      `sensitivity ${sensitivity}).`
    );
  }

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

    /*
     * Event/check separation. Trap responses are evaluated ONLY against
     * trap criteria; polled check responses never match trap criteria.
     * This keeps a trap from misfiring "is online" style filters (it has
     * no check data) and keeps every poll from re-firing trap criteria.
     */
    const snmpTrap: SnmpTrap | undefined = dataToProcess.snmpTrapResponse;

    if (input.criteriaFilter.checkOn === CheckOn.SnmpTrapReceived) {
      if (!snmpTrap) {
        return null;
      }

      const expectedOid: string = String(threshold || "").trim();

      if (!expectedOid) {
        return null;
      }

      const trapOid: string = snmpTrap.trapOid;
      let isMatch: boolean = false;

      switch (input.criteriaFilter.filterType) {
        case FilterType.EqualTo:
          isMatch = trapOid === expectedOid;
          break;
        case FilterType.NotEqualTo:
          isMatch = trapOid !== expectedOid;
          break;
        case FilterType.Contains:
          isMatch = trapOid.includes(expectedOid);
          break;
        case FilterType.NotContains:
          isMatch = !trapOid.includes(expectedOid);
          break;
        case FilterType.StartsWith:
          isMatch = trapOid.startsWith(expectedOid);
          break;
        case FilterType.EndsWith:
          isMatch = trapOid.endsWith(expectedOid);
          break;
        default:
          isMatch = false;
      }

      if (isMatch) {
        return `SNMP trap ${trapOid} received from ${snmpTrap.sourceIpAddress}.`;
      }

      return null;
    }

    if (snmpTrap) {
      // Trap events never evaluate check-based criteria.
      return null;
    }

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

    // Check if any monitored interface (in scope) is down
    if (input.criteriaFilter.checkOn === CheckOn.SnmpInterfaceIsDown) {
      const interfaces: Array<SnmpInterface> =
        SnmpMonitorCriteria.scopeInterfaces(
          snmpResponse?.interfaces || [],
          input.criteriaFilter,
        );

      if (interfaces.length === 0) {
        return null;
      }

      /*
       * Administratively disabled interfaces are intentionally down and
       * never count as failures.
       */
      const downInterfaces: Array<SnmpInterface> = interfaces.filter(
        (snmpInterface: SnmpInterface) => {
          return (
            snmpInterface.isAdministrativelyUp &&
            !snmpInterface.isOperationallyUp
          );
        },
      );

      const isTrueFilter: boolean =
        input.criteriaFilter.filterType === FilterType.True;
      const isFalseFilter: boolean =
        input.criteriaFilter.filterType === FilterType.False;

      if (downInterfaces.length > 0 && isTrueFilter) {
        const names: string = downInterfaces
          .slice(0, 5)
          .map((snmpInterface: SnmpInterface) => {
            return snmpInterface.name;
          })
          .join(", ");
        return `${downInterfaces.length} interface(s) down: ${names}${
          downInterfaces.length > 5 ? ", …" : ""
        }.`;
      }

      if (downInterfaces.length === 0 && isFalseFilter) {
        return "All administratively enabled interfaces are up.";
      }

      return null;
    }

    // Check the busiest interface's utilization
    if (
      input.criteriaFilter.checkOn === CheckOn.SnmpInterfaceUtilizationPercent
    ) {
      const utilizations: Array<number> = SnmpMonitorCriteria.scopeInterfaces(
        snmpResponse?.interfaces || [],
        input.criteriaFilter,
      )
        .map((snmpInterface: SnmpInterface) => {
          return snmpInterface.utilizationPercent;
        })
        .filter((value: number | undefined): value is number => {
          return typeof value === "number";
        });

      if (utilizations.length === 0) {
        return null;
      }

      /*
       * Anomaly filters skip the static threshold entirely: the busiest
       * in-scope interface's utilization is compared to this monitor's
       * same-hour-of-week utilization baseline instead.
       */
      if (
        CriteriaFilterUtil.isAnomalyFilterType(input.criteriaFilter.filterType)
      ) {
        return await SnmpMonitorCriteria.evaluateUtilizationAnomaly({
          projectId: dataToProcess.projectId,
          monitorId: input.dataToProcess.monitorId!,
          criteriaFilter: input.criteriaFilter,
          observedUtilizationPercent: Math.max(...utilizations),
        });
      }

      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: Math.max(...utilizations),
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check the worst interface's error rate
    if (input.criteriaFilter.checkOn === CheckOn.SnmpInterfaceErrorsPerSecond) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      const errorRates: Array<number> = SnmpMonitorCriteria.scopeInterfaces(
        snmpResponse?.interfaces || [],
        input.criteriaFilter,
      )
        .map((snmpInterface: SnmpInterface) => {
          return snmpInterface.errorsPerSecond;
        })
        .filter((value: number | undefined): value is number => {
          return typeof value === "number";
        });

      if (errorRates.length === 0) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: Math.max(...errorRates),
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

      /*
       * Numeric comparison — only when the value is genuinely numeric. Guard
       * against empty/whitespace OctetStrings, which Number("") coerces to 0
       * and would spuriously satisfy a "== 0" criterion.
       */
      const isNumeric: boolean =
        typeof oidValue === "number" ||
        (String(oidValue).trim() !== "" && !isNaN(Number(oidValue)));
      if (isNumeric) {
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
