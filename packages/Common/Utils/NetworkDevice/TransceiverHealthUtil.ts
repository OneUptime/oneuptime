import {
  NetworkDeviceTransceiver,
  SnmpTransceiverResult,
  TRANSCEIVER_FAULT_DESCRIPTIONS,
  TRANSCEIVER_READING_KINDS,
  TRANSCEIVER_READING_TITLES,
  TransceiverFault,
  TransceiverHealth,
  TransceiverMeasurement,
  TransceiverMeasurements,
  TransceiverMibSource,
  TransceiverReading,
  TransceiverReadingKind,
  TransceiverRxPowerHistory,
  TransceiverThresholds,
} from "../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverUnitUtil, {
  TRANSCEIVER_MIN_POWER_DBM,
} from "./TransceiverUnitUtil";

/*
 * Everything that judges a transceiver, in one place, so the device page,
 * the alert criteria, the alert text and OneUptime AI can never disagree
 * about whether an optic is healthy.
 *
 * Pure: no database, no clock of its own (callers pass `now`).
 */

/*
 * How many polls in a row an optic has to be missing before alerts treat it
 * as gone. One poll is not enough: an agent that answers its sensor table
 * empty once (a process restart on the switch) would otherwise raise a
 * "not detected" alert for every optic and resolve them all a poll later.
 * The device page still says "Not detected" from the first poll.
 */
export const TRANSCEIVER_MISSING_CONFIRMATION_POLLS: number = 2;

/*
 * The received power baseline is the best daily average of the 30 days
 * before today. Long enough to catch an optic or a connector degrading over
 * weeks; short enough that a link re-cabled on purpose stops reading as a
 * drop within a month.
 */
export const TRANSCEIVER_RX_BASELINE_DAYS: number = 30;

/*
 * The drop the recommended alert fires at: 2 dB is about 37% of the light
 * gone, well past day-to-day wobble (a few tenths of a dB) and early enough
 * to act before most links lose their margin.
 */
export const TRANSCEIVER_RX_DROP_ALERT_DB: number = 2;

// A backstop on what one device can store, far above any real switch.
export const MAX_TRANSCEIVERS_PER_DEVICE: number = 1024;

const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

const ISO_DAY_REGEX: RegExp = /^(\d{4})-(\d{2})-(\d{2})$/;

export enum TransceiverReadingLevel {
  Ok = "ok",
  Warning = "warning",
  Alarm = "alarm",
  // The device reports no threshold to judge this reading by.
  NotJudged = "notJudged",
}

export interface TransceiverThresholdCrossing {
  side: "low" | "high";
  severity: "warning" | "alarm";
  threshold: number;
}

export interface TransceiverReadingVerdict {
  kind: TransceiverReadingKind;
  value: number;
  lane?: number | undefined;
  level: TransceiverReadingLevel;
  crossing?: TransceiverThresholdCrossing | undefined;
}

export interface TransceiverRxPowerTrendPoint {
  day: string;
  averageDbm: number;
}

export interface TransceiverRxPowerTrend {
  // Every day with a reading, oldest first, the current day last.
  points: Array<TransceiverRxPowerTrendPoint>;
  // The best daily average of the days before the current one.
  baselineDbm?: number | undefined;
  baselineDay?: string | undefined;
  // The latest reading of the weakest lane.
  currentDbm?: number | undefined;
  // baselineDbm - currentDbm: positive when the light has dropped.
  dropDb?: number | undefined;
}

// What the merge needs to know about the ports this walk saw.
export interface TransceiverInterfaceRef {
  interfaceIndex: number;
  name?: string | undefined;
  alias?: string | undefined;
  isAdministrativelyUp?: boolean | undefined;
}

export interface TransceiverHealthSummary {
  total: number;
  healthy: number;
  warning: number;
  alarm: number;
  notDetected: number;
  notJudged: number;
  portDisabled: number;
}

// Problems first: what someone opening the page needs to see.
const HEALTH_DISPLAY_ORDER: Array<TransceiverHealth> = [
  TransceiverHealth.NotDetected,
  TransceiverHealth.Alarm,
  TransceiverHealth.Warning,
  TransceiverHealth.Healthy,
  TransceiverHealth.NotJudged,
  TransceiverHealth.PortDisabled,
];

export default class TransceiverHealthUtil {
  /*
   * The device's thresholds, made safe to compare against. Agents fill the
   * thresholds they do not support with zeros (HPE Comware) or put a low
   * limit above the matching high one; a set like that says nothing and is
   * dropped rather than read as "alarm at 0".
   */
  public static normalizeThresholds(
    thresholds: TransceiverThresholds | undefined,
  ): TransceiverThresholds | undefined {
    if (!thresholds) {
      return undefined;
    }

    const pick: (value: unknown) => number | undefined = (
      value: unknown,
    ): number | undefined => {
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
    };

    let lowAlarm: number | undefined = pick(thresholds.lowAlarm);
    let lowWarning: number | undefined = pick(thresholds.lowWarning);
    let highWarning: number | undefined = pick(thresholds.highWarning);
    let highAlarm: number | undefined = pick(thresholds.highAlarm);

    const defined: Array<number> = [
      lowAlarm,
      lowWarning,
      highWarning,
      highAlarm,
    ].filter((value: number | undefined): value is number => {
      return value !== undefined;
    });

    if (defined.length === 0) {
      return undefined;
    }

    if (
      defined.length > 1 &&
      defined.every((value: number) => {
        return value === defined[0];
      })
    ) {
      return undefined;
    }

    if (
      lowAlarm !== undefined &&
      highAlarm !== undefined &&
      lowAlarm >= highAlarm
    ) {
      lowAlarm = undefined;
      highAlarm = undefined;
    }

    if (
      lowWarning !== undefined &&
      highWarning !== undefined &&
      lowWarning >= highWarning
    ) {
      lowWarning = undefined;
      highWarning = undefined;
    }

    if (
      lowAlarm === undefined &&
      lowWarning === undefined &&
      highWarning === undefined &&
      highAlarm === undefined
    ) {
      return undefined;
    }

    return {
      ...(lowAlarm !== undefined ? { lowAlarm: lowAlarm } : {}),
      ...(lowWarning !== undefined ? { lowWarning: lowWarning } : {}),
      ...(highWarning !== undefined ? { highWarning: highWarning } : {}),
      ...(highAlarm !== undefined ? { highAlarm: highAlarm } : {}),
    };
  }

  /*
   * One reading against its thresholds. A reading AT a threshold has
   * crossed it - the comparison the devices themselves make (Cisco's
   * thresholds are greaterOrEqual / lessOrEqual).
   */
  public static judgeReading(
    value: number,
    thresholds: TransceiverThresholds | undefined,
  ): {
    level: TransceiverReadingLevel;
    crossing?: TransceiverThresholdCrossing | undefined;
  } {
    const normalized: TransceiverThresholds | undefined =
      TransceiverHealthUtil.normalizeThresholds(thresholds);

    if (!normalized) {
      return { level: TransceiverReadingLevel.NotJudged };
    }

    if (normalized.highAlarm !== undefined && value >= normalized.highAlarm) {
      return {
        level: TransceiverReadingLevel.Alarm,
        crossing: {
          side: "high",
          severity: "alarm",
          threshold: normalized.highAlarm,
        },
      };
    }

    if (normalized.lowAlarm !== undefined && value <= normalized.lowAlarm) {
      return {
        level: TransceiverReadingLevel.Alarm,
        crossing: {
          side: "low",
          severity: "alarm",
          threshold: normalized.lowAlarm,
        },
      };
    }

    if (
      normalized.highWarning !== undefined &&
      value >= normalized.highWarning
    ) {
      return {
        level: TransceiverReadingLevel.Warning,
        crossing: {
          side: "high",
          severity: "warning",
          threshold: normalized.highWarning,
        },
      };
    }

    if (normalized.lowWarning !== undefined && value <= normalized.lowWarning) {
      return {
        level: TransceiverReadingLevel.Warning,
        crossing: {
          side: "low",
          severity: "warning",
          threshold: normalized.lowWarning,
        },
      };
    }

    return { level: TransceiverReadingLevel.Ok };
  }

  // Every reading of an optic, judged, in display order.
  public static getReadingVerdicts(
    measurements: TransceiverMeasurements | undefined,
  ): Array<TransceiverReadingVerdict> {
    const verdicts: Array<TransceiverReadingVerdict> = [];

    for (const kind of TRANSCEIVER_READING_KINDS) {
      const measurement: TransceiverMeasurement | undefined =
        measurements?.[kind];

      for (const reading of measurement?.readings || []) {
        if (typeof reading.value !== "number" || !isFinite(reading.value)) {
          continue;
        }

        verdicts.push({
          kind: kind,
          value: reading.value,
          ...(reading.lane !== undefined ? { lane: reading.lane } : {}),
          ...TransceiverHealthUtil.judgeReading(
            reading.value,
            measurement?.thresholds,
          ),
        });
      }
    }

    return verdicts;
  }

  /*
   * An optic's health. A disabled port is not judged at all: its laser is
   * off by design, so its "TX power low" alarm is the port doing what it was
   * told, not a failing optic.
   */
  public static getHealth(data: {
    isPresent: boolean;
    measurements?: TransceiverMeasurements | undefined;
    faults?: Array<TransceiverFault> | undefined;
    isPortDisabled?: boolean | undefined;
  }): TransceiverHealth {
    if (!data.isPresent) {
      return TransceiverHealth.NotDetected;
    }

    if (data.isPortDisabled) {
      return TransceiverHealth.PortDisabled;
    }

    if (data.faults && data.faults.length > 0) {
      return TransceiverHealth.Alarm;
    }

    const verdicts: Array<TransceiverReadingVerdict> =
      TransceiverHealthUtil.getReadingVerdicts(data.measurements);

    if (
      verdicts.some((verdict: TransceiverReadingVerdict) => {
        return verdict.level === TransceiverReadingLevel.Alarm;
      })
    ) {
      return TransceiverHealth.Alarm;
    }

    if (
      verdicts.some((verdict: TransceiverReadingVerdict) => {
        return verdict.level === TransceiverReadingLevel.Warning;
      })
    ) {
      return TransceiverHealth.Warning;
    }

    if (
      verdicts.some((verdict: TransceiverReadingVerdict) => {
        return verdict.level === TransceiverReadingLevel.Ok;
      })
    ) {
      return TransceiverHealth.Healthy;
    }

    return TransceiverHealth.NotJudged;
  }

  // The lowest or highest reading of one kind, across every lane.
  public static getExtremeReading(
    measurements: TransceiverMeasurements | undefined,
    kind: TransceiverReadingKind,
    which: "lowest" | "highest",
  ): TransceiverReading | undefined {
    let extreme: TransceiverReading | undefined = undefined;

    for (const reading of measurements?.[kind]?.readings || []) {
      if (typeof reading.value !== "number" || !isFinite(reading.value)) {
        continue;
      }

      if (
        !extreme ||
        (which === "lowest"
          ? reading.value < extreme.value
          : reading.value > extreme.value)
      ) {
        extreme = reading;
      }
    }

    return extreme;
  }

  /*
   * The received power of the weakest lane: on a four-lane optic it is the
   * one lane going dark that takes the link down.
   */
  public static getLowestRxPowerDbm(
    measurements: TransceiverMeasurements | undefined,
  ): number | undefined {
    return TransceiverHealthUtil.getExtremeReading(
      measurements,
      TransceiverReadingKind.RxPower,
      "lowest",
    )?.value;
  }

  public static isConfirmedMissing(
    transceiver: NetworkDeviceTransceiver,
  ): boolean {
    return (
      !transceiver.isPresent &&
      (transceiver.missingPolls || 0) >= TRANSCEIVER_MISSING_CONFIRMATION_POLLS
    );
  }

  // --- Received power history ---

  public static getUtcDay(date: Date): string {
    return date.toISOString().substring(0, 10);
  }

  public static addDays(day: string, days: number): string {
    return new Date(
      TransceiverHealthUtil.dayToEpochMs(day) + days * MS_PER_DAY,
    )
      .toISOString()
      .substring(0, 10);
  }

  // Whole days from `from` to `to` (negative when `to` is earlier).
  public static daysBetween(from: string, to: string): number {
    return Math.round(
      (TransceiverHealthUtil.dayToEpochMs(to) -
        TransceiverHealthUtil.dayToEpochMs(from)) /
        MS_PER_DAY,
    );
  }

  /*
   * Folds one reading into the daily averages: a running average for the
   * current day, a new entry when the UTC day has turned (with a null for
   * every day in between that had no reading), and never more than the
   * baseline window plus the current day.
   */
  public static updateRxPowerHistory(
    history: TransceiverRxPowerHistory | undefined,
    valueDbm: number,
    now: Date,
  ): TransceiverRxPowerHistory {
    const today: string = TransceiverHealthUtil.getUtcDay(now);
    const value: number = TransceiverUnitUtil.roundTo(valueDbm, 3);

    if (
      !history ||
      !ISO_DAY_REGEX.test(history.firstDay || "") ||
      !Array.isArray(history.dailyAverageDbm) ||
      history.dailyAverageDbm.length === 0
    ) {
      return { firstDay: today, dailyAverageDbm: [value], lastDaySamples: 1 };
    }

    const days: Array<number | null> = [...history.dailyAverageDbm];
    const lastDay: string = TransceiverHealthUtil.addDays(
      history.firstDay,
      days.length - 1,
    );
    const gap: number = TransceiverHealthUtil.daysBetween(lastDay, today);

    // A clock that went backwards: keep what is stored.
    if (gap < 0) {
      return history;
    }

    let firstDay: string = history.firstDay;
    let lastDaySamples: number = Math.max(0, history.lastDaySamples || 0);

    if (gap === 0) {
      const average: number | null = days[days.length - 1] ?? null;

      days[days.length - 1] =
        average === null || lastDaySamples === 0
          ? value
          : TransceiverUnitUtil.roundTo(
              (average * lastDaySamples + value) / (lastDaySamples + 1),
              3,
            );
      lastDaySamples = average === null ? 1 : lastDaySamples + 1;
    } else {
      // Nothing old enough to matter survives a gap wider than the window.
      if (gap > TRANSCEIVER_RX_BASELINE_DAYS) {
        return {
          firstDay: today,
          dailyAverageDbm: [value],
          lastDaySamples: 1,
        };
      }

      for (let missing: number = 1; missing < gap; missing++) {
        days.push(null);
      }

      days.push(value);
      lastDaySamples = 1;
    }

    const maxEntries: number = TRANSCEIVER_RX_BASELINE_DAYS + 1;

    while (days.length > maxEntries) {
      days.shift();
      firstDay = TransceiverHealthUtil.addDays(firstDay, 1);
    }

    // Leading days with no reading carry no information.
    while (days.length > 1 && days[0] === null) {
      days.shift();
      firstDay = TransceiverHealthUtil.addDays(firstDay, 1);
    }

    return {
      firstDay: firstDay,
      dailyAverageDbm: days,
      lastDaySamples: lastDaySamples,
    };
  }

  /*
   * The received power trend of one optic, and the "falling" rule:
   *
   *   drop = (best daily average of the previous 30 days) - (latest reading)
   *
   * The best day, not the average, so a slow slide is measured from where
   * the link started rather than from a baseline that slides down with it.
   * The current day is left out of the baseline, so a drop that happens
   * today shows in full straight away.
   */
  public static getRxPowerTrend(
    transceiver: Pick<
      NetworkDeviceTransceiver,
      "rxPowerHistory" | "measurements"
    >,
  ): TransceiverRxPowerTrend {
    const history: TransceiverRxPowerHistory | undefined =
      transceiver.rxPowerHistory;
    const currentDbm: number | undefined =
      TransceiverHealthUtil.getLowestRxPowerDbm(transceiver.measurements);

    const trend: TransceiverRxPowerTrend = {
      points: [],
      ...(currentDbm !== undefined ? { currentDbm: currentDbm } : {}),
    };

    if (
      !history ||
      !ISO_DAY_REGEX.test(history.firstDay || "") ||
      !Array.isArray(history.dailyAverageDbm)
    ) {
      return trend;
    }

    const lastIndex: number = history.dailyAverageDbm.length - 1;

    for (let index: number = 0; index <= lastIndex; index++) {
      const average: number | null | undefined =
        history.dailyAverageDbm[index];

      if (typeof average !== "number" || !isFinite(average)) {
        continue;
      }

      const day: string = TransceiverHealthUtil.addDays(
        history.firstDay,
        index,
      );

      trend.points.push({
        day: day,
        averageDbm: TransceiverUnitUtil.roundTo(average, 2),
      });

      if (index === lastIndex) {
        continue;
      }

      if (trend.baselineDbm === undefined || average > trend.baselineDbm) {
        trend.baselineDbm = TransceiverUnitUtil.roundTo(average, 2);
        trend.baselineDay = day;
      }
    }

    if (trend.baselineDbm !== undefined && currentDbm !== undefined) {
      trend.dropDb = TransceiverUnitUtil.roundTo(
        trend.baselineDbm - currentDbm,
        2,
      );
    }

    return trend;
  }

  // --- The stored snapshot ---

  /*
   * This poll's optics folded into what the device had stored:
   *
   *   - an optic in this poll is present, with fresh readings, and its
   *     received power joins the daily averages - which start over when
   *     the serial number shows the optic was swapped;
   *   - an optic missing from this poll, on a port that is still there and
   *     still enabled, is "not detected" and keeps its identity and history
   *     so the page can say what used to be plugged in;
   *   - an optic missing from a disabled port is forgotten: pulling the
   *     optic out of a port that was shut is housekeeping, not a fault;
   *   - a port this poll did not walk at all keeps its entry as it was.
   *
   * Returns undefined - "leave the stored snapshot alone" - when the poll
   * collected no transceivers (an older probe, collection off, a failed or
   * timed-out walk), and when an agent that used to report optics answered
   * with nothing at all and named no MIB (a sensor table that came back
   * empty for one poll is not every optic in the switch being pulled).
   */
  public static mergeSnapshot(data: {
    previous: Array<NetworkDeviceTransceiver> | undefined;
    results: Array<SnmpTransceiverResult> | undefined;
    source: TransceiverMibSource | undefined;
    interfaces: Array<TransceiverInterfaceRef>;
    now: Date;
  }): Array<NetworkDeviceTransceiver> | undefined {
    if (!data.results) {
      return undefined;
    }

    const previous: Array<NetworkDeviceTransceiver> = (
      data.previous || []
    ).filter((entry: NetworkDeviceTransceiver) => {
      return Boolean(entry) && Number.isInteger(entry.interfaceIndex);
    });

    if (
      data.results.length === 0 &&
      !data.source &&
      previous.some((entry: NetworkDeviceTransceiver) => {
        return entry.isPresent;
      })
    ) {
      return undefined;
    }

    const previousByIndex: Map<number, NetworkDeviceTransceiver> = new Map();

    for (const entry of previous) {
      previousByIndex.set(entry.interfaceIndex, entry);
    }

    const interfacesByIndex: Map<number, TransceiverInterfaceRef> = new Map();

    for (const ref of data.interfaces || []) {
      interfacesByIndex.set(ref.interfaceIndex, ref);
    }

    const resultsByIndex: Map<number, SnmpTransceiverResult> = new Map();

    for (const result of data.results) {
      if (
        result &&
        Number.isInteger(result.interfaceIndex) &&
        !resultsByIndex.has(result.interfaceIndex)
      ) {
        resultsByIndex.set(result.interfaceIndex, result);
      }
    }

    const nowIso: string = data.now.toISOString();
    const merged: Array<NetworkDeviceTransceiver> = [];

    for (const result of resultsByIndex.values()) {
      const before: NetworkDeviceTransceiver | undefined = previousByIndex.get(
        result.interfaceIndex,
      );
      const port: TransceiverInterfaceRef | undefined = interfacesByIndex.get(
        result.interfaceIndex,
      );

      const isSameOptic: boolean = Boolean(
        before &&
          !(
            before.serialNumber &&
            result.serialNumber &&
            before.serialNumber !== result.serialNumber
          ),
      );

      const measurements: TransceiverMeasurements = result.measurements || {};
      const rxPowerDbm: number | undefined =
        TransceiverHealthUtil.getLowestRxPowerDbm(measurements);

      let rxPowerHistory: TransceiverRxPowerHistory | undefined = isSameOptic
        ? before?.rxPowerHistory
        : undefined;

      if (rxPowerDbm !== undefined) {
        rxPowerHistory = TransceiverHealthUtil.updateRxPowerHistory(
          rxPowerHistory,
          rxPowerDbm,
          data.now,
        );
      }

      const faults: Array<TransceiverFault> = (result.faults || []).filter(
        (fault: TransceiverFault) => {
          return Object.values(TransceiverFault).includes(fault);
        },
      );

      merged.push(
        TransceiverHealthUtil.withoutUndefined({
          interfaceIndex: result.interfaceIndex,
          interfaceName: port?.name || before?.interfaceName,
          interfaceAlias: port ? port.alias : before?.interfaceAlias,
          isPresent: true,
          vendor: result.vendor,
          partNumber: result.partNumber,
          serialNumber: result.serialNumber,
          revision: result.revision,
          type: result.type,
          wavelengthNm: result.wavelengthNm,
          measurements: measurements,
          faults: faults.length > 0 ? faults : undefined,
          source: result.source,
          health: TransceiverHealthUtil.getHealth({
            isPresent: true,
            measurements: measurements,
            faults: faults,
            isPortDisabled: port?.isAdministrativelyUp === false,
          }),
          firstSeenAt: isSameOptic ? before?.firstSeenAt || nowIso : nowIso,
          lastSeenAt: nowIso,
          rxPowerHistory: rxPowerHistory,
        }),
      );
    }

    for (const before of previous) {
      if (resultsByIndex.has(before.interfaceIndex)) {
        continue;
      }

      const port: TransceiverInterfaceRef | undefined = interfacesByIndex.get(
        before.interfaceIndex,
      );

      // A port this poll did not walk: nothing new is known about it.
      if (!port) {
        merged.push(before);
        continue;
      }

      if (port.isAdministrativelyUp === false) {
        continue;
      }

      merged.push(
        TransceiverHealthUtil.withoutUndefined({
          interfaceIndex: before.interfaceIndex,
          interfaceName: port.name || before.interfaceName,
          interfaceAlias: port.alias,
          isPresent: false,
          vendor: before.vendor,
          partNumber: before.partNumber,
          serialNumber: before.serialNumber,
          revision: before.revision,
          type: before.type,
          wavelengthNm: before.wavelengthNm,
          measurements: {},
          source: before.source,
          health: TransceiverHealth.NotDetected,
          firstSeenAt: before.firstSeenAt,
          lastSeenAt: before.lastSeenAt,
          missingSince: before.isPresent
            ? nowIso
            : before.missingSince || nowIso,
          missingPolls: before.isPresent
            ? 1
            : Math.min(1000000, (before.missingPolls || 0) + 1),
          rxPowerHistory: before.rxPowerHistory,
        }),
      );
    }

    if (merged.length === 0 && previous.length === 0) {
      return undefined;
    }

    return merged
      .sort((a: NetworkDeviceTransceiver, b: NetworkDeviceTransceiver) => {
        return a.interfaceIndex - b.interfaceIndex;
      })
      .slice(0, MAX_TRANSCEIVERS_PER_DEVICE);
  }

  // --- Reading the snapshot ---

  // Problems first, then in port order.
  public static sortForDisplay(
    transceivers: Array<NetworkDeviceTransceiver>,
  ): Array<NetworkDeviceTransceiver> {
    return [...transceivers].sort(
      (a: NetworkDeviceTransceiver, b: NetworkDeviceTransceiver) => {
        const healthOrder: number =
          TransceiverHealthUtil.getHealthRank(a.health) -
          TransceiverHealthUtil.getHealthRank(b.health);

        if (healthOrder !== 0) {
          return healthOrder;
        }

        return a.interfaceIndex - b.interfaceIndex;
      },
    );
  }

  public static getHealthRank(health: TransceiverHealth | undefined): number {
    const rank: number = HEALTH_DISPLAY_ORDER.indexOf(
      health as TransceiverHealth,
    );
    return rank === -1 ? HEALTH_DISPLAY_ORDER.length : rank;
  }

  public static summarize(
    transceivers: Array<NetworkDeviceTransceiver>,
  ): TransceiverHealthSummary {
    const summary: TransceiverHealthSummary = {
      total: transceivers.length,
      healthy: 0,
      warning: 0,
      alarm: 0,
      notDetected: 0,
      notJudged: 0,
      portDisabled: 0,
    };

    for (const transceiver of transceivers) {
      switch (transceiver.health) {
        case TransceiverHealth.Healthy:
          summary.healthy++;
          break;
        case TransceiverHealth.Warning:
          summary.warning++;
          break;
        case TransceiverHealth.Alarm:
          summary.alarm++;
          break;
        case TransceiverHealth.NotDetected:
          summary.notDetected++;
          break;
        case TransceiverHealth.PortDisabled:
          summary.portDisabled++;
          break;
        default:
          summary.notJudged++;
          break;
      }
    }

    return summary;
  }

  // --- Words ---

  public static formatReading(
    kind: TransceiverReadingKind,
    value: number,
  ): string {
    switch (kind) {
      case TransceiverReadingKind.Temperature:
        return `${value.toFixed(1)} °C`;
      case TransceiverReadingKind.Voltage:
        return `${value.toFixed(2)} V`;
      case TransceiverReadingKind.BiasCurrent:
        return `${value.toFixed(2)} mA`;
      case TransceiverReadingKind.TxPower:
      case TransceiverReadingKind.RxPower:
        return value <= TRANSCEIVER_MIN_POWER_DBM
          ? `${value.toFixed(2)} dBm (no light)`
          : `${value.toFixed(2)} dBm`;
      default:
        return `${value}`;
    }
  }

  // "Te1/1/1" or "Te1/1/1 (Uplink to core)".
  public static describePort(transceiver: NetworkDeviceTransceiver): string {
    const name: string =
      transceiver.interfaceName || `interface ${transceiver.interfaceIndex}`;

    return transceiver.interfaceAlias && transceiver.interfaceAlias !== name
      ? `${name} (${transceiver.interfaceAlias})`
      : name;
  }

  // "FS SFP-10GLR-31, serial F1234567" - whatever of it is known.
  public static describeOptic(
    transceiver: NetworkDeviceTransceiver,
  ): string | undefined {
    const product: string = [
      transceiver.vendor,
      transceiver.partNumber || transceiver.type,
    ]
      .filter(Boolean)
      .join(" ");

    const parts: Array<string> = [];

    if (product) {
      parts.push(product);
    }

    if (transceiver.serialNumber) {
      parts.push(`serial ${transceiver.serialNumber}`);
    }

    return parts.length > 0 ? parts.join(", ") : undefined;
  }

  // "RX power -18.90 dBm on lane 2 is below the low alarm threshold of -16.40 dBm"
  public static describeVerdict(verdict: TransceiverReadingVerdict): string {
    const subject: string = `${TRANSCEIVER_READING_TITLES[verdict.kind]} ${TransceiverHealthUtil.formatReading(verdict.kind, verdict.value)}${
      verdict.lane !== undefined ? ` on lane ${verdict.lane}` : ""
    }`;

    if (!verdict.crossing) {
      return subject;
    }

    return `${subject} is ${verdict.crossing.side === "high" ? "above" : "below"} the ${verdict.crossing.side} ${verdict.crossing.severity} threshold of ${TransceiverHealthUtil.formatReading(verdict.kind, verdict.crossing.threshold)}`;
  }

  /*
   * What is wrong with an optic, one plain sentence per problem, worst
   * first. Empty when nothing is.
   */
  public static describeIssues(
    transceiver: NetworkDeviceTransceiver,
  ): Array<string> {
    if (!transceiver.isPresent) {
      return [
        transceiver.missingSince
          ? `Not detected since ${transceiver.missingSince}`
          : "Not detected",
      ];
    }

    if (transceiver.health === TransceiverHealth.PortDisabled) {
      return [];
    }

    const issues: Array<string> = (transceiver.faults || []).map(
      (fault: TransceiverFault) => {
        return TRANSCEIVER_FAULT_DESCRIPTIONS[fault] || fault;
      },
    );

    const crossed: Array<TransceiverReadingVerdict> =
      TransceiverHealthUtil.getReadingVerdicts(transceiver.measurements)
        .filter((verdict: TransceiverReadingVerdict) => {
          return Boolean(verdict.crossing);
        })
        .sort(
          (a: TransceiverReadingVerdict, b: TransceiverReadingVerdict) => {
            return (
              (a.level === TransceiverReadingLevel.Alarm ? 0 : 1) -
              (b.level === TransceiverReadingLevel.Alarm ? 0 : 1)
            );
          },
        );

    for (const verdict of crossed) {
      issues.push(TransceiverHealthUtil.describeVerdict(verdict));
    }

    return issues;
  }

  private static dayToEpochMs(day: string): number {
    const match: RegExpMatchArray | null = day.match(ISO_DAY_REGEX);

    if (!match) {
      return NaN;
    }

    return Date.UTC(
      parseInt(match[1]!, 10),
      parseInt(match[2]!, 10) - 1,
      parseInt(match[3]!, 10),
    );
  }

  // Keeps stored snapshots free of explicit undefined keys.
  private static withoutUndefined(
    transceiver: NetworkDeviceTransceiver,
  ): NetworkDeviceTransceiver {
    const record: Record<string, unknown> = {
      ...(transceiver as unknown as Record<string, unknown>),
    };

    for (const key of Object.keys(record)) {
      if (record[key] === undefined) {
        delete record[key];
      }
    }

    return record as unknown as NetworkDeviceTransceiver;
  }
}
