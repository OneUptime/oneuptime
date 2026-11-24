import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import SnmpTableCriteria from "./SnmpTableCriteria";
import SnmpTransceiverCriteria from "./SnmpTransceiverCriteria";
import PerEntityCriteriaFanOut from "../PerEntityCriteriaFanOut";
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
import SnmpOidListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import SnmpTrap from "../../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import MonitorStepSeries, {
  MonitorStepSeriesScope,
} from "../../../../Types/Monitor/MonitorStepSeries";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Dictionary from "../../../../Types/Dictionary";
import MetricBaselineService, {
  BaselineBand,
  BaselineSummary,
  MetricBaselineQuery,
  MetricBaselineService as MetricBaselineServiceClass,
} from "../../../Services/MetricBaselineService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";

/*
 * The attribute an interface's rows name it by: the name the walk gave it, as
 * MonitorMetricUtil writes it on every interface series.
 */
export const SNMP_INTERFACE_NAME_ATTRIBUTE: string = "interfaceName";

export default class SnmpMonitorCriteria {
  /*
   * Every CheckOn whose value comes out of the SNMP walk. Reachability
   * (SnmpIsOnline) and traps are the two that do not.
   */
  private static isWalkDependentCheckOn(checkOn: CheckOn): boolean {
    return (
      checkOn === CheckOn.SnmpWalkIsSucceeding ||
      checkOn === CheckOn.SnmpResponseTime ||
      checkOn === CheckOn.SnmpOidExists ||
      checkOn === CheckOn.SnmpOidValue ||
      checkOn === CheckOn.SnmpOidRatePerSecond ||
      checkOn === CheckOn.SnmpInterfaceIsDown ||
      checkOn === CheckOn.SnmpInterfaceUtilizationPercent ||
      checkOn === CheckOn.SnmpInterfaceErrorsPerSecond ||
      checkOn === CheckOn.SnmpTableValue ||
      checkOn === CheckOn.SnmpTableRowCount ||
      checkOn === CheckOn.SnmpTableRowIsUnhealthy ||
      CriteriaFilterUtil.isTransceiverCheckOn(checkOn)
    );
  }

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

    /*
     * Empty has always meant "every interface". "*" means the same
     * thing, and additionally opts the criteria into raising one alert
     * per interface — see PerEntityCriteriaFanOut. Scoping treats them
     * identically; only the fan-out tells them apart, so existing
     * monitors that leave this blank keep their single combined alert.
     */
    if (!scope || PerEntityCriteriaFanOut.isWildcard(scope)) {
      return interfaces;
    }

    const scoped: Array<SnmpInterface> = interfaces.filter(
      (snmpInterface: SnmpInterface) => {
        return (
          snmpInterface.name?.trim().toLowerCase() === scope ||
          snmpInterface.alias?.trim().toLowerCase() === scope
        );
      },
    );

    /*
     * A configured scope that matches nothing (typo, ifName change after
     * a firmware upgrade, module removed) silently disarms this criteria
     * — including "Interface Is Down = False" recovery rules. Surface it
     * in the logs so a dead criteria is diagnosable.
     */
    if (scoped.length === 0 && interfaces.length > 0) {
      logger.warn(
        `SNMP criteria interface scope "${criteriaFilter.snmpMonitorOptions?.interfaceName}" matched none of the ${interfaces.length} interface(s) in the poll response. This criteria will not evaluate until the scope matches an interface name or alias.`,
      );
    }

    return scoped;
  }

  /*
   * WHAT AN INTERFACE'S UTILIZATION IS JUDGED AGAINST (#10985).
   *
   * The anomaly condition compares the busiest in-scope interface's
   * utilization with the same hour of the week on earlier days. That used to
   * be the hourly rollup's cell (MetricBaselineHourly), which keys on the
   * monitor alone: a monitor with two steps - a core switch and an access
   * switch - judged each step against both steps' samples, and every device
   * against all of its ports at once, so a busy uplink was "anomalously high"
   * against a fleet of idle ports on every check.
   *
   * So the baseline is read from the rows the step's own checks wrote
   * (MonitorMetricUtil names the step and the interface on each), the way a
   * step's windows read them (MonitorStepSeries): the step's rows, and the
   * in-scope interfaces' when the criteria names some, one interface for an
   * Interface Name of "*" fanned out per interface. Each minute's data point
   * is the busiest of them, as the check takes the busiest: like is judged
   * against like.
   *
   * Rows written before rows named their step are read only by a monitor with
   * one step, whose rows they all are. A monitor with several leaves them out
   * and learns again from its steps' own rows: until two earlier weeks of the
   * hour are there, the condition does not fire. The rollup, kept 90 days, is
   * the step's own only on a monitor with one step, so only such a monitor
   * falls back on it when its rows are kept too briefly to hold two weeks
   * (a monitor metric retention under 14 days), as it was judged before.
   */
  public static getUtilizationBaselineQuery(data: {
    stepScope: MonitorStepSeriesScope | undefined;
    criteriaFilter: CriteriaFilter;
    // The interfaces in scope on this check (scopeInterfaces).
    interfaces: Array<SnmpInterface>;
  }): MetricBaselineQuery | undefined {
    const attributes: Dictionary<unknown> = data.stepScope
      ? MonitorStepSeries.toQueryAttributes(data.stepScope)
      : {};

    const scope: string = (
      data.criteriaFilter.snmpMonitorOptions?.interfaceName || ""
    ).trim();

    /*
     * Empty and "*" are every interface: the busiest of all of them. A name
     * is the interfaces it matched on this check - by name or alias, in any
     * case - as their rows name them: by the name the walk gave them. One the
     * walk gave no name is written with none, and read as "" (a missing key
     * of the attributes map). There is always one: the check judges none
     * when nothing is in scope, and an empty list would read every row.
     */
    if (
      scope &&
      !PerEntityCriteriaFanOut.isWildcard(scope) &&
      data.interfaces.length > 0
    ) {
      const names: Array<string> = Array.from(
        new Set<string>(
          data.interfaces.map((snmpInterface: SnmpInterface): string => {
            return snmpInterface.name || "";
          }),
        ),
      ).sort();

      attributes[SNMP_INTERFACE_NAME_ATTRIBUTE] =
        names.length === 1 ? names[0]! : new Includes(names);
    }

    // Nothing narrows it, with no step to read: the monitor's cell, as before.
    if (Object.keys(attributes).length === 0) {
      return undefined;
    }

    return {
      aggregationType: AggregationType.Max,
      isNarrowedByAttributes: true,
      interval: AggregationInterval.Minute,
      scope: { attributes: attributes, groupByAttributeKeys: [] },
      readsOnlyItsOwnRows: data.stepScope
        ? !data.stepScope.readsRowsWithoutStep
        : false,
    };
  }

  /*
   * Anomaly path for interface utilization: compares the busiest in-scope
   * interface's current utilization to the same hour of the week of the
   * step's own checks (getUtilizationBaselineQuery), read through
   * MetricBaselineService as MetricMonitorCriteria reads a query's own data
   * points.
   *
   * Missing or unreliable baselines mean the rule is still learning —
   * never alert from a thin baseline. Zero-variance baselines are skipped
   * too, until the samples themselves have left the one value they held.
   */
  private static async evaluateUtilizationAnomaly(input: {
    projectId: ObjectID;
    monitorId: ObjectID;
    criteriaFilter: CriteriaFilter;
    observedUtilizationPercent: number;
    stepScope: MonitorStepSeriesScope | undefined;
    interfaces: Array<SnmpInterface>;
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
        query: SnmpMonitorCriteria.getUtilizationBaselineQuery({
          stepScope: input.stepScope,
          criteriaFilter: input.criteriaFilter,
          interfaces: input.interfaces,
        }),
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

    const band: BaselineBand | null = MetricBaselineServiceClass.getBand({
      baseline,
      sigmaCount,
    });

    if (!band) {
      // A zero-variance baseline would flag every deviation. Skip.
      return null;
    }

    const observed: number = input.observedUtilizationPercent;

    const isHighBreach: boolean = observed > band.expectedHigh;
    const isLowBreach: boolean = observed < band.expectedLow;

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

    const direction: string = observed >= baseline.mean ? "above" : "below";

    // A baseline with no spread has no σ to count: it held one value.
    if (baseline.stddev === 0) {
      return (
        `SNMP interface utilization ${observed.toFixed(2)}% is ${direction} the ` +
        `same-hour baseline, which held at ${baseline.mean.toFixed(2)}% for all ` +
        `${baseline.sampleCount} samples over ${baseline.windowDays} days ` +
        `(sensitivity ${sensitivity}).`
      );
    }

    const observedSigma: number = (observed - baseline.mean) / baseline.stddev;

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
    /*
     * The monitor's monitoringInterval cron. Over-time filters use it to
     * work out how many samples a fully covered window should hold, so a
     * monitor that has only just started is not mistaken for one whose
     * whole window is breaching.
     */
    monitoringInterval?: string | undefined;
    /*
     * The step's rows of the series an over-time window reads
     * (MonitorStepSeries, #10906): never another step's checks.
     */
    stepScope?: MonitorStepSeriesScope | undefined;
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

    /*
     * The trap's contents rather than its OID. Only ever judged on a trap
     * event, exactly like the trap OID above.
     */
    if (input.criteriaFilter.checkOn === CheckOn.SnmpTrapVarbindValue) {
      if (!snmpTrap) {
        return null;
      }

      return SnmpTableCriteria.evaluateTrapVarbind({
        snmpTrap: snmpTrap,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (snmpTrap) {
      // Trap events never evaluate check-based criteria.
      return null;
    }

    /*
     * No walk, no verdict. A device without usable SNMP credentials is only
     * pinged, and the walk pipeline hands its monitors a response with
     * `snmpResponse` undefined - never a synthesized failure. Every criterion
     * that reads the walk is therefore NOT EVALUATED on such a poll (null),
     * rather than breaching: "OID Exists is False" must not raise an
     * incident on a device nobody ever asked an OID of, and "Walk Is
     * Succeeding is False" must mean "attempted and failed". Reachability
     * (SnmpIsOnline) is read from the top-level isOnline further down and
     * is unaffected.
     *
     * This runs before the over-time lookup on purpose: a window of stored
     * walk-time samples says nothing about a poll that walked nothing.
     */
    if (
      SnmpMonitorCriteria.isWalkDependentCheckOn(
        input.criteriaFilter.checkOn,
      ) &&
      !snmpResponse
    ) {
      return null;
    }

    /*
     * SNMP tables are judged on this walk's rows only - never over time,
     * since a row has no history of its own until it has been walked a few
     * times, and a row that disappears has none at all.
     */
    if (input.criteriaFilter.checkOn === CheckOn.SnmpTableValue) {
      return SnmpTableCriteria.evaluateTableValue({
        tables: snmpResponse?.tables,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.SnmpTableRowCount) {
      return SnmpTableCriteria.evaluateTableRowCount({
        tables: snmpResponse?.tables,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.SnmpTableRowIsUnhealthy) {
      return SnmpTableCriteria.evaluateTableRowIsUnhealthy({
        tables: snmpResponse?.tables,
        criteriaFilter: input.criteriaFilter,
      });
    }

    /*
     * Transceivers, like tables, are judged on this poll's state - which
     * already carries their history (missing for how many polls, a month of
     * received power) - never over a window of stored samples.
     */
    if (CriteriaFilterUtil.isTransceiverCheckOn(input.criteriaFilter.checkOn)) {
      return SnmpTransceiverCriteria.evaluate({
        transceivers: snmpResponse?.transceivers,
        criteriaFilter: input.criteriaFilter,
      });
    }

    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: (input.dataToProcess as ProbeMonitorResponse).projectId,
        monitorId: input.dataToProcess.monitorId!,
        criteriaFilter: input.criteriaFilter,
        monitoringInterval: input.monitoringInterval,
        stepScope: input.stepScope,
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

    /*
     * Device reachability: the top-level isOnline is "answered ping OR the
     * walk succeeded", stamped by the walk pipeline - the same verdict the
     * device list's status pill shows. Deliberately not the walk's own
     * isOnline, which the next CheckOn covers.
     */
    if (input.criteriaFilter.checkOn === CheckOn.SnmpIsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ??
        (input.dataToProcess as ProbeMonitorResponse).isOnline;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    /*
     * The walk itself. Gated above: a poll with no walk returns null before
     * reaching here, so `snmpResponse` is present and "False" genuinely
     * means the walk was attempted and failed.
     */
    if (input.criteriaFilter.checkOn === CheckOn.SnmpWalkIsSucceeding) {
      if (!snmpResponse) {
        return null;
      }

      return CompareCriteria.compareCriteriaBoolean({
        value: snmpResponse.isOnline === true,
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
        (overTimeValue as Array<number>) ??
        (snmpResponse?.responseTimeInMs ||
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
      const inScope: Array<SnmpInterface> = SnmpMonitorCriteria.scopeInterfaces(
        snmpResponse?.interfaces || [],
        input.criteriaFilter,
      );

      const utilizations: Array<number> = inScope
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
       * in-scope interface's utilization is compared to the same hour of the
       * week of this step's own checks of those interfaces instead (#10985).
       */
      if (
        CriteriaFilterUtil.isAnomalyFilterType(input.criteriaFilter.filterType)
      ) {
        return await SnmpMonitorCriteria.evaluateUtilizationAnomaly({
          projectId: dataToProcess.projectId,
          monitorId: input.dataToProcess.monitorId!,
          criteriaFilter: input.criteriaFilter,
          observedUtilizationPercent: Math.max(...utilizations),
          stepScope: input.stepScope,
          interfaces: inScope,
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

      /*
       * Compare canonical forms. ".1.3.6.1" and "1.3.6.1" are the same
       * object, operators type both, and net-snmp always answers with the
       * dotless form — so a stored leading dot used to make the criterion
       * silently un-matchable forever. Newly reachable now that the OID
       * picker actually writes a value.
       */
      const normalizedOid: string = SnmpOidListUtil.normalizeOid(oid);

      const oidResponse: SnmpOidResponse | undefined =
        snmpResponse?.oidResponses?.find((response: SnmpOidResponse) => {
          return SnmpOidListUtil.normalizeOid(response.oid) === normalizedOid;
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

    /*
     * How fast a counter OID grew since the previous poll that read it
     * (SnmpOidRateUtil, on ingest). Not evaluated - null - until there is a
     * rate: on a device's first poll, on a poll whose counter went
     * backwards, and for an OID that is not a counter. A rate is a fraction
     * as often as not ("errors above 0.5 a second"), so the threshold keeps
     * its decimals, as a metric threshold does.
     */
    if (input.criteriaFilter.checkOn === CheckOn.SnmpOidRatePerSecond) {
      const oid: string | undefined =
        input.criteriaFilter.snmpMonitorOptions?.oid;
      const numericThreshold: number | null =
        CompareCriteria.convertMetricThresholdToNumber(threshold);

      if (!oid || numericThreshold === null) {
        return null;
      }

      const normalizedOid: string = SnmpOidListUtil.normalizeOid(oid);

      const oidResponse: SnmpOidResponse | undefined =
        snmpResponse?.oidResponses?.find((response: SnmpOidResponse) => {
          return SnmpOidListUtil.normalizeOid(response.oid) === normalizedOid;
        });

      if (
        !oidResponse ||
        typeof oidResponse.ratePerSecond !== "number" ||
        !Number.isFinite(oidResponse.ratePerSecond)
      ) {
        return null;
      }

      const result: string | null = CompareCriteria.compareCriteriaNumbers({
        value: oidResponse.ratePerSecond,
        threshold: numericThreshold,
        criteriaFilter: input.criteriaFilter,
      });

      // The result names the rate itself, as SNMP OID Value's names the value.
      return result
        ? `SNMP OID ${oid} (${oidResponse.name || oid}): ${result}`
        : null;
    }

    // Check the value of a specific OID
    if (input.criteriaFilter.checkOn === CheckOn.SnmpOidValue) {
      const oid: string | undefined =
        input.criteriaFilter.snmpMonitorOptions?.oid;

      if (!oid) {
        return null;
      }

      /*
       * Compare canonical forms. ".1.3.6.1" and "1.3.6.1" are the same
       * object, operators type both, and net-snmp always answers with the
       * dotless form — so a stored leading dot used to make the criterion
       * silently un-matchable forever. Newly reachable now that the OID
       * picker actually writes a value.
       */
      const normalizedOid: string = SnmpOidListUtil.normalizeOid(oid);

      const oidResponse: SnmpOidResponse | undefined =
        snmpResponse?.oidResponses?.find((response: SnmpOidResponse) => {
          return SnmpOidListUtil.normalizeOid(response.oid) === normalizedOid;
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
