import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  NetworkDeviceTransceiver,
  TRANSCEIVER_READING_KINDS,
  TRANSCEIVER_READING_TITLES,
  TransceiverHealth,
  TransceiverReading,
  TransceiverReadingKind,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverHealthUtil, {
  TRANSCEIVER_MISSING_CONFIRMATION_POLLS,
  TRANSCEIVER_RX_BASELINE_DAYS,
  TransceiverRxPowerTrend,
} from "../../../../Utils/NetworkDevice/TransceiverHealthUtil";
import PerEntityCriteriaFanOut from "../PerEntityCriteriaFanOut";

/*
 * The transceiver criteria: optics judged port by port from the snapshot
 * the walk pipeline puts on `snmpResponse.transceivers`
 * (NetworkDeviceWalkUtil.applyTransceivers) - present optics with their
 * health and trend, and optics that are no longer detected.
 *
 * Every rule here reads TransceiverHealthUtil, the same judge the device's
 * Interfaces page and OneUptime AI use, so an alert, the page and the AI
 * always agree on what is wrong.
 *
 * A criteria with nothing to judge - the poll did not read transceivers,
 * or no optic is in scope - is not evaluated (null) rather than met or
 * cleared.
 */

// How many optics an alert names before it summarizes the rest.
const MAX_PORTS_IN_ROOT_CAUSE: number = 5;

interface ReadingMatch {
  transceiver: NetworkDeviceTransceiver;
  reading: TransceiverReading;
}

export default class SnmpTransceiverCriteria {
  /*
   * The optics a criteria's interface scope names: every optic for an empty
   * scope or "*" (the fan-out narrows "*" one port at a time), otherwise the
   * ones whose port name or alias equals it - the same matching as the
   * interface CheckOns.
   */
  public static scopeTransceivers(
    transceivers: Array<NetworkDeviceTransceiver>,
    criteriaFilter: CriteriaFilter,
  ): Array<NetworkDeviceTransceiver> {
    const scope: string = (
      criteriaFilter.snmpMonitorOptions?.interfaceName || ""
    )
      .trim()
      .toLowerCase();

    if (!scope || PerEntityCriteriaFanOut.isWildcard(scope)) {
      return transceivers;
    }

    return transceivers.filter((transceiver: NetworkDeviceTransceiver) => {
      return (
        transceiver.interfaceName?.trim().toLowerCase() === scope ||
        transceiver.interfaceAlias?.trim().toLowerCase() === scope
      );
    });
  }

  public static evaluate(data: {
    transceivers: Array<NetworkDeviceTransceiver> | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (!data.transceivers) {
      return null;
    }

    const inScope: Array<NetworkDeviceTransceiver> =
      SnmpTransceiverCriteria.scopeTransceivers(
        data.transceivers,
        data.criteriaFilter,
      );

    if (inScope.length === 0) {
      return null;
    }

    switch (data.criteriaFilter.checkOn) {
      case CheckOn.SnmpTransceiverNotDetected:
        return SnmpTransceiverCriteria.evaluateNotDetected(
          inScope,
          data.criteriaFilter,
        );
      case CheckOn.SnmpTransceiverPastAlarmThreshold:
        return SnmpTransceiverCriteria.evaluatePastThreshold({
          inScope: inScope,
          criteriaFilter: data.criteriaFilter,
          healths: [TransceiverHealth.Alarm],
          severity: "alarm",
        });
      case CheckOn.SnmpTransceiverPastWarningThreshold:
        return SnmpTransceiverCriteria.evaluatePastThreshold({
          inScope: inScope,
          criteriaFilter: data.criteriaFilter,
          healths: [TransceiverHealth.Alarm, TransceiverHealth.Warning],
          severity: "warning",
        });
      case CheckOn.SnmpTransceiverReading:
        return SnmpTransceiverCriteria.evaluateReading(
          inScope,
          data.criteriaFilter,
        );
      case CheckOn.SnmpTransceiverRxPowerDrop:
        return SnmpTransceiverCriteria.evaluateRxPowerDrop(
          inScope,
          data.criteriaFilter,
        );
      default:
        return null;
    }
  }

  private static evaluateNotDetected(
    inScope: Array<NetworkDeviceTransceiver>,
    criteriaFilter: CriteriaFilter,
  ): string | null {
    const missing: Array<NetworkDeviceTransceiver> = inScope.filter(
      (transceiver: NetworkDeviceTransceiver) => {
        return TransceiverHealthUtil.isConfirmedMissing(transceiver);
      },
    );

    if (criteriaFilter.filterType === FilterType.True && missing.length > 0) {
      if (missing.length === 1) {
        return SnmpTransceiverCriteria.describeMissing(missing[0]!);
      }

      return `${missing.length} transceivers are no longer detected while their ports are enabled: ${SnmpTransceiverCriteria.listPorts(missing)}. The device still answers SNMP.`;
    }

    if (
      criteriaFilter.filterType === FilterType.False &&
      missing.length === 0
    ) {
      return inScope.length === 1
        ? `The transceiver in ${TransceiverHealthUtil.describePort(inScope[0]!)} is detected.`
        : `Every transceiver in scope is detected (${inScope.length}).`;
    }

    return null;
  }

  // "Transceiver no longer detected in Te1/1/1 (Uplink): it was FS ..."
  public static describeMissing(transceiver: NetworkDeviceTransceiver): string {
    const optic: string | undefined =
      TransceiverHealthUtil.describeOptic(transceiver);

    return `Transceiver no longer detected in ${TransceiverHealthUtil.describePort(transceiver)}${
      optic ? `: it was ${optic}` : ""
    }. Missing for ${transceiver.missingPolls || TRANSCEIVER_MISSING_CONFIRMATION_POLLS} polls${
      transceiver.missingSince ? ` (since ${transceiver.missingSince})` : ""
    }${transceiver.lastSeenAt ? `, last seen ${transceiver.lastSeenAt}` : ""}. The port is enabled and the device still answers SNMP.`;
  }

  private static evaluatePastThreshold(data: {
    inScope: Array<NetworkDeviceTransceiver>;
    criteriaFilter: CriteriaFilter;
    healths: Array<TransceiverHealth>;
    severity: "warning" | "alarm";
  }): string | null {
    // Only optics that are there and whose port is enabled can be judged.
    const judged: Array<NetworkDeviceTransceiver> = data.inScope.filter(
      (transceiver: NetworkDeviceTransceiver) => {
        return (
          transceiver.isPresent &&
          transceiver.health !== TransceiverHealth.PortDisabled &&
          transceiver.health !== TransceiverHealth.NotJudged
        );
      },
    );

    if (judged.length === 0) {
      return null;
    }

    const past: Array<NetworkDeviceTransceiver> = judged.filter(
      (transceiver: NetworkDeviceTransceiver) => {
        return data.healths.includes(transceiver.health);
      },
    );

    if (data.criteriaFilter.filterType === FilterType.True && past.length > 0) {
      return past
        .slice(0, MAX_PORTS_IN_ROOT_CAUSE)
        .map((transceiver: NetworkDeviceTransceiver) => {
          const crossed: string =
            transceiver.health === TransceiverHealth.Alarm
              ? "an alarm threshold"
              : "a warning threshold";
          return `${TransceiverHealthUtil.describePort(transceiver)} transceiver past ${crossed}: ${TransceiverHealthUtil.describeIssues(
            transceiver,
          ).join("; ")}.`;
        })
        .concat(
          past.length > MAX_PORTS_IN_ROOT_CAUSE
            ? [`And ${past.length - MAX_PORTS_IN_ROOT_CAUSE} more.`]
            : [],
        )
        .join(" ");
    }

    if (
      data.criteriaFilter.filterType === FilterType.False &&
      past.length === 0
    ) {
      return `Every transceiver in scope is within its ${data.severity} thresholds (${judged.length}).`;
    }

    return null;
  }

  private static evaluateReading(
    inScope: Array<NetworkDeviceTransceiver>,
    criteriaFilter: CriteriaFilter,
  ): string | null {
    const kind: TransceiverReadingKind | undefined =
      SnmpTransceiverCriteria.getReadingKind(criteriaFilter);
    const threshold: number | null = SnmpTransceiverCriteria.toNumber(
      criteriaFilter.value,
    );

    if (!kind || threshold === null) {
      return null;
    }

    const readings: Array<ReadingMatch> = [];

    for (const transceiver of inScope) {
      if (
        !transceiver.isPresent ||
        transceiver.health === TransceiverHealth.PortDisabled
      ) {
        continue;
      }

      for (const reading of transceiver.measurements?.[kind]?.readings || []) {
        if (typeof reading.value === "number" && isFinite(reading.value)) {
          readings.push({ transceiver: transceiver, reading: reading });
        }
      }
    }

    if (readings.length === 0) {
      return null;
    }

    const matches: Array<ReadingMatch> = readings.filter(
      (match: ReadingMatch) => {
        return SnmpTransceiverCriteria.compare(
          match.reading.value,
          threshold,
          criteriaFilter.filterType,
        );
      },
    );

    if (matches.length === 0) {
      return null;
    }

    const worst: ReadingMatch = SnmpTransceiverCriteria.pickWorst(
      matches,
      (match: ReadingMatch) => {
        return match.reading.value;
      },
      criteriaFilter.filterType,
    );

    return `${TransceiverHealthUtil.describePort(worst.transceiver)} transceiver ${TRANSCEIVER_READING_TITLES[kind]} is ${TransceiverHealthUtil.formatReading(
      kind,
      worst.reading.value,
    )}${worst.reading.lane !== undefined ? ` on lane ${worst.reading.lane}` : ""}, which is ${SnmpTransceiverCriteria.describeComparison(
      criteriaFilter.filterType,
    )} ${threshold}${matches.length > 1 ? ` (${matches.length} readings in scope match)` : ""}.`;
  }

  private static evaluateRxPowerDrop(
    inScope: Array<NetworkDeviceTransceiver>,
    criteriaFilter: CriteriaFilter,
  ): string | null {
    const threshold: number | null = SnmpTransceiverCriteria.toNumber(
      criteriaFilter.value,
    );

    if (threshold === null) {
      return null;
    }

    const trends: Array<{
      transceiver: NetworkDeviceTransceiver;
      trend: TransceiverRxPowerTrend;
      dropDb: number;
    }> = [];

    for (const transceiver of inScope) {
      if (
        !transceiver.isPresent ||
        transceiver.health === TransceiverHealth.PortDisabled
      ) {
        continue;
      }

      const trend: TransceiverRxPowerTrend =
        TransceiverHealthUtil.getRxPowerTrend(transceiver);

      if (trend.dropDb !== undefined) {
        trends.push({
          transceiver: transceiver,
          trend: trend,
          dropDb: trend.dropDb,
        });
      }
    }

    // No optic has a full day of history yet: nothing to measure against.
    if (trends.length === 0) {
      return null;
    }

    const matches: typeof trends = trends.filter(
      (entry: { dropDb: number }) => {
        return SnmpTransceiverCriteria.compare(
          entry.dropDb,
          threshold,
          criteriaFilter.filterType,
        );
      },
    );

    if (matches.length === 0) {
      return null;
    }

    const worst: (typeof trends)[number] = SnmpTransceiverCriteria.pickWorst(
      matches,
      (entry: { dropDb: number }) => {
        return entry.dropDb;
      },
      criteriaFilter.filterType,
    );

    return `${SnmpTransceiverCriteria.describeRxPowerDrop(
      worst.transceiver,
      worst.trend,
    )}${matches.length > 1 ? ` ${matches.length} transceivers in scope match.` : ""}`;
  }

  // "Te1/1/1 RX power -6.30 dBm is 2.40 dB below its best daily average ..."
  public static describeRxPowerDrop(
    transceiver: NetworkDeviceTransceiver,
    trend: TransceiverRxPowerTrend,
  ): string {
    const port: string = TransceiverHealthUtil.describePort(transceiver);

    if (
      trend.dropDb === undefined ||
      trend.currentDbm === undefined ||
      trend.baselineDbm === undefined
    ) {
      return `${port} RX power has no baseline yet.`;
    }

    const direction: string =
      trend.dropDb >= 0
        ? `${trend.dropDb.toFixed(2)} dB below`
        : `${Math.abs(trend.dropDb).toFixed(2)} dB above`;

    return `${port} RX power ${TransceiverHealthUtil.formatReading(
      TransceiverReadingKind.RxPower,
      trend.currentDbm,
    )} is ${direction} its best daily average of the last ${TRANSCEIVER_RX_BASELINE_DAYS} days (${TransceiverHealthUtil.formatReading(
      TransceiverReadingKind.RxPower,
      trend.baselineDbm,
    )} on ${trend.baselineDay}).`;
  }

  /*
   * What a criteria saw, for the evaluation summary - said whether or not
   * it was met.
   */
  public static describeObservation(data: {
    transceivers: Array<NetworkDeviceTransceiver> | undefined;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (!data.transceivers) {
      return "Transceivers were not read on this poll.";
    }

    const inScope: Array<NetworkDeviceTransceiver> =
      SnmpTransceiverCriteria.scopeTransceivers(
        data.transceivers,
        data.criteriaFilter,
      );

    if (inScope.length === 0) {
      return data.criteriaFilter.snmpMonitorOptions?.interfaceName &&
        !PerEntityCriteriaFanOut.isWildcard(
          data.criteriaFilter.snmpMonitorOptions.interfaceName,
        )
        ? `No transceiver on interface ${data.criteriaFilter.snmpMonitorOptions.interfaceName}.`
        : "The device reports no transceivers.";
    }

    switch (data.criteriaFilter.checkOn) {
      case CheckOn.SnmpTransceiverNotDetected: {
        const missing: number = inScope.filter(
          (transceiver: NetworkDeviceTransceiver) => {
            return TransceiverHealthUtil.isConfirmedMissing(transceiver);
          },
        ).length;
        return `${missing} of ${inScope.length} transceiver(s) in scope not detected.`;
      }
      case CheckOn.SnmpTransceiverPastAlarmThreshold:
      case CheckOn.SnmpTransceiverPastWarningThreshold: {
        const alarms: number = inScope.filter(
          (transceiver: NetworkDeviceTransceiver) => {
            return transceiver.health === TransceiverHealth.Alarm;
          },
        ).length;
        const warnings: number = inScope.filter(
          (transceiver: NetworkDeviceTransceiver) => {
            return transceiver.health === TransceiverHealth.Warning;
          },
        ).length;
        return `${inScope.length} transceiver(s) in scope: ${alarms} past an alarm threshold, ${warnings} past a warning threshold.`;
      }
      case CheckOn.SnmpTransceiverReading: {
        const kind: TransceiverReadingKind | undefined =
          SnmpTransceiverCriteria.getReadingKind(data.criteriaFilter);

        if (!kind) {
          return "No transceiver reading is selected on this criteria.";
        }

        const values: Array<string> = inScope
          .filter((transceiver: NetworkDeviceTransceiver) => {
            return transceiver.isPresent;
          })
          .slice(0, MAX_PORTS_IN_ROOT_CAUSE)
          .map((transceiver: NetworkDeviceTransceiver) => {
            const lowest: TransceiverReading | undefined =
              TransceiverHealthUtil.getExtremeReading(
                transceiver.measurements,
                kind,
                "lowest",
              );
            return `${TransceiverHealthUtil.describePort(transceiver)}: ${
              lowest
                ? TransceiverHealthUtil.formatReading(kind, lowest.value)
                : "no reading"
            }`;
          });

        return `${TRANSCEIVER_READING_TITLES[kind]} in scope - ${values.join(", ") || "no readings"}.`;
      }
      case CheckOn.SnmpTransceiverRxPowerDrop: {
        const drops: Array<string> = inScope
          .filter((transceiver: NetworkDeviceTransceiver) => {
            return transceiver.isPresent;
          })
          .slice(0, MAX_PORTS_IN_ROOT_CAUSE)
          .map((transceiver: NetworkDeviceTransceiver) => {
            const trend: TransceiverRxPowerTrend =
              TransceiverHealthUtil.getRxPowerTrend(transceiver);
            return `${TransceiverHealthUtil.describePort(transceiver)}: ${
              trend.dropDb !== undefined
                ? `${trend.dropDb.toFixed(2)} dB`
                : "no baseline yet"
            }`;
          });

        return `RX power drop against the best day of the last ${TRANSCEIVER_RX_BASELINE_DAYS} - ${drops.join(", ") || "no readings"}.`;
      }
      default:
        return null;
    }
  }

  public static getReadingKind(
    criteriaFilter: CriteriaFilter,
  ): TransceiverReadingKind | undefined {
    const kind: string | undefined =
      criteriaFilter.snmpMonitorOptions?.transceiverReading;

    return TRANSCEIVER_READING_KINDS.find(
      (candidate: TransceiverReadingKind) => {
        return candidate === kind;
      },
    );
  }

  /*
   * Thresholds here are decimals - -14.4 dBm, 3.3 V - so a typed "-14.4"
   * is read as such, never truncated to -14.
   */
  public static toNumber(value: string | number | undefined): number | null {
    if (typeof value === "number") {
      return isFinite(value) ? value : null;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed: number = Number(value.trim());
      return isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  public static compare(
    value: number,
    threshold: number,
    filterType: FilterType | undefined,
  ): boolean {
    switch (filterType) {
      case FilterType.GreaterThan:
        return value > threshold;
      case FilterType.GreaterThanOrEqualTo:
        return value >= threshold;
      case FilterType.LessThan:
        return value < threshold;
      case FilterType.LessThanOrEqualTo:
        return value <= threshold;
      case FilterType.EqualTo:
        return value === threshold;
      case FilterType.NotEqualTo:
        return value !== threshold;
      default:
        return false;
    }
  }

  private static describeComparison(
    filterType: FilterType | undefined,
  ): string {
    switch (filterType) {
      case FilterType.GreaterThan:
        return "greater than";
      case FilterType.GreaterThanOrEqualTo:
        return "greater than or equal to";
      case FilterType.LessThan:
        return "less than";
      case FilterType.LessThanOrEqualTo:
        return "less than or equal to";
      case FilterType.EqualTo:
        return "equal to";
      case FilterType.NotEqualTo:
        return "not equal to";
      default:
        return "compared with";
    }
  }

  // The match furthest past the line: the lowest for "less than", else the highest.
  private static pickWorst<T>(
    matches: Array<T>,
    valueOf: (match: T) => number,
    filterType: FilterType | undefined,
  ): T {
    const lowestIsWorst: boolean =
      filterType === FilterType.LessThan ||
      filterType === FilterType.LessThanOrEqualTo;

    return matches.reduce((worst: T, candidate: T) => {
      return lowestIsWorst
        ? valueOf(candidate) < valueOf(worst)
          ? candidate
          : worst
        : valueOf(candidate) > valueOf(worst)
          ? candidate
          : worst;
    });
  }

  private static listPorts(
    transceivers: Array<NetworkDeviceTransceiver>,
  ): string {
    const names: Array<string> = transceivers
      .slice(0, MAX_PORTS_IN_ROOT_CAUSE)
      .map((transceiver: NetworkDeviceTransceiver) => {
        return TransceiverHealthUtil.describePort(transceiver);
      });

    return transceivers.length > MAX_PORTS_IN_ROOT_CAUSE
      ? `${names.join(", ")} and ${transceivers.length - MAX_PORTS_IN_ROOT_CAUSE} more`
      : names.join(", ");
  }
}
