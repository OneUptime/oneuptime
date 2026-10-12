import {
  NetworkDeviceTransceiver,
  TransceiverHealth,
  TransceiverMeasurement,
  TransceiverMibSource,
  TransceiverReadingKind,
  TransceiverThresholds,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverHealthUtil, {
  TRANSCEIVER_RX_DROP_ALERT_DB,
  TransceiverHealthSummary,
  TransceiverReadingLevel,
  TransceiverReadingVerdict,
  TransceiverRxPowerTrend,
} from "Common/Utils/NetworkDevice/TransceiverHealthUtil";
import { TRANSCEIVER_MIN_POWER_DBM } from "Common/Utils/NetworkDevice/TransceiverUnitUtil";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Transceivers card on a device's Interfaces page shows, worked out
 * without React so App/Tests can pin every rule: which optics come first,
 * what each status is called, which lane's reading stands for a QSFP, and
 * how a value past a threshold is said in words as well as in colour.
 *
 * Every word here is an English key (translationKey) looked up where it is
 * drawn. The judging itself is TransceiverHealthUtil's - the same judge the
 * alerts and OneUptime AI use - so the page can never call an optic healthy
 * that an alert calls failing.
 */

// The rows the card shows before "Show all".
export const TRANSCEIVER_ROWS_SHOWN: number = 10;

export enum TransceiverTone {
  Critical = "critical",
  Warning = "warning",
  Healthy = "healthy",
  Neutral = "neutral",
}

export interface TransceiverStatusView {
  label: string;
  tone: TransceiverTone;
}

// The columns, in order: the reading that tells most first.
export const TRANSCEIVER_TABLE_READINGS: Array<TransceiverReadingKind> = [
  TransceiverReadingKind.RxPower,
  TransceiverReadingKind.TxPower,
  TransceiverReadingKind.Temperature,
  TransceiverReadingKind.Voltage,
  TransceiverReadingKind.BiasCurrent,
];

export const TRANSCEIVER_READING_COLUMN_TITLES: Record<
  TransceiverReadingKind,
  string
> = {
  [TransceiverReadingKind.RxPower]: translationKey("RX Power"),
  [TransceiverReadingKind.TxPower]: translationKey("TX Power"),
  [TransceiverReadingKind.Temperature]: translationKey("Temperature"),
  [TransceiverReadingKind.Voltage]: translationKey("Voltage"),
  [TransceiverReadingKind.BiasCurrent]: translationKey("Bias Current"),
};

// Columns hidden on a phone: what the other three already imply.
export const TRANSCEIVER_READINGS_HIDDEN_ON_MOBILE: Array<TransceiverReadingKind> =
  [TransceiverReadingKind.Voltage, TransceiverReadingKind.BiasCurrent];

export const TRANSCEIVER_THRESHOLD_LABELS: {
  lowAlarm: string;
  lowWarning: string;
  highWarning: string;
  highAlarm: string;
} = {
  lowAlarm: translationKey("Low alarm"),
  lowWarning: translationKey("Low warning"),
  highWarning: translationKey("High warning"),
  highAlarm: translationKey("High alarm"),
};

export const TRANSCEIVER_SOURCE_LABELS: Record<TransceiverMibSource, string> = {
  [TransceiverMibSource.EntitySensor]: "ENTITY-SENSOR-MIB",
  [TransceiverMibSource.CiscoEntitySensor]: "CISCO-ENTITY-SENSOR-MIB",
  [TransceiverMibSource.AristaEntitySensor]: "ARISTA-ENTITY-SENSOR-MIB",
  [TransceiverMibSource.JuniperDom]: "JUNIPER-DOM-MIB",
  [TransceiverMibSource.MikroTik]: "MIKROTIK-MIB",
  [TransceiverMibSource.H3cTransceiver]: "HH3C-TRANSCEIVER-INFO-MIB",
  [TransceiverMibSource.HpIcfTransceiver]: "HP-ICF-TRANSCEIVER-MIB",
  [TransceiverMibSource.CambiumTransceiver]: "CAMBIUM-NETWORKS-TRANSCEIVER-MIB",
};

export function hasReadings(transceiver: NetworkDeviceTransceiver): boolean {
  return Object.values(transceiver.measurements || {}).some(
    (measurement: TransceiverMeasurement | undefined) => {
      return Boolean(measurement && measurement.readings.length > 0);
    },
  );
}

export function getStatusView(
  transceiver: NetworkDeviceTransceiver,
): TransceiverStatusView {
  switch (transceiver.health) {
    case TransceiverHealth.NotDetected:
      return {
        label: translationKey("Not detected"),
        tone: TransceiverTone.Critical,
      };
    case TransceiverHealth.Alarm:
      return { label: translationKey("Alarm"), tone: TransceiverTone.Critical };
    case TransceiverHealth.Warning:
      return {
        label: translationKey("Warning"),
        tone: TransceiverTone.Warning,
      };
    case TransceiverHealth.Healthy:
      return {
        label: translationKey("Healthy"),
        tone: TransceiverTone.Healthy,
      };
    case TransceiverHealth.PortDisabled:
      return {
        label: translationKey("Port disabled"),
        tone: TransceiverTone.Neutral,
      };
    default:
      /*
       * Present, with nothing to judge it by: an optic without diagnostics
       * (a direct-attach cable, a copper SFP) is simply detected; one with
       * readings but no thresholds from the device says so.
       */
      return hasReadings(transceiver)
        ? {
            label: translationKey("No thresholds"),
            tone: TransceiverTone.Neutral,
          }
        : { label: translationKey("Detected"), tone: TransceiverTone.Neutral };
  }
}

export function getToneForLevel(
  level: TransceiverReadingLevel | undefined,
): TransceiverTone {
  switch (level) {
    case TransceiverReadingLevel.Alarm:
      return TransceiverTone.Critical;
    case TransceiverReadingLevel.Warning:
      return TransceiverTone.Warning;
    case TransceiverReadingLevel.Ok:
      return TransceiverTone.Healthy;
    default:
      return TransceiverTone.Neutral;
  }
}

const LEVEL_RANK: Record<TransceiverReadingLevel, number> = {
  [TransceiverReadingLevel.Alarm]: 0,
  [TransceiverReadingLevel.Warning]: 1,
  [TransceiverReadingLevel.Ok]: 2,
  [TransceiverReadingLevel.NotJudged]: 3,
};

/*
 * The reading that stands for a multi-lane optic in the table: the worst
 * judged lane, and among equals the one nearest to failing - the weakest
 * light, the hottest laser, the highest bias. The details panel lists every
 * lane.
 */
export function pickDisplayVerdict(
  transceiver: NetworkDeviceTransceiver,
  kind: TransceiverReadingKind,
): TransceiverReadingVerdict | undefined {
  const verdicts: Array<TransceiverReadingVerdict> =
    TransceiverHealthUtil.getReadingVerdicts(transceiver.measurements).filter(
      (verdict: TransceiverReadingVerdict) => {
        return verdict.kind === kind;
      },
    );

  if (verdicts.length === 0) {
    return undefined;
  }

  const lowestIsWorst: boolean =
    kind === TransceiverReadingKind.RxPower ||
    kind === TransceiverReadingKind.TxPower;

  return [...verdicts].sort(
    (a: TransceiverReadingVerdict, b: TransceiverReadingVerdict) => {
      const byLevel: number = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];

      if (byLevel !== 0) {
        return byLevel;
      }

      return lowestIsWorst ? a.value - b.value : b.value - a.value;
    },
  )[0];
}

export function getLaneCount(
  transceiver: NetworkDeviceTransceiver,
  kind: TransceiverReadingKind,
): number {
  return transceiver.measurements?.[kind]?.readings.length || 0;
}

/*
 * What a threshold crossing is called beside the value, so the state is in
 * words and not only in colour: "Low alarm", "High warning".
 */
export function getCrossingLabel(
  verdict: TransceiverReadingVerdict | undefined,
): string | undefined {
  if (!verdict?.crossing) {
    return undefined;
  }

  if (verdict.crossing.side === "low") {
    return verdict.crossing.severity === "alarm"
      ? TRANSCEIVER_THRESHOLD_LABELS.lowAlarm
      : TRANSCEIVER_THRESHOLD_LABELS.lowWarning;
  }

  return verdict.crossing.severity === "alarm"
    ? TRANSCEIVER_THRESHOLD_LABELS.highAlarm
    : TRANSCEIVER_THRESHOLD_LABELS.highWarning;
}

// A reading as it is printed: "-4.70 dBm", "34.6 °C".
export function formatReadingValue(
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
    default:
      return `${value.toFixed(2)} dBm`;
  }
}

// A receiver at the -40 dBm floor sees no light at all.
export function isNoLight(
  kind: TransceiverReadingKind,
  value: number,
): boolean {
  return (
    (kind === TransceiverReadingKind.RxPower ||
      kind === TransceiverReadingKind.TxPower) &&
    value <= TRANSCEIVER_MIN_POWER_DBM
  );
}

export interface ThresholdItem {
  label: string;
  value: number;
}

// The device's thresholds for one reading, low to high.
export function getThresholdItems(
  thresholds: TransceiverThresholds | undefined,
): Array<ThresholdItem> {
  const normalized: TransceiverThresholds | undefined =
    TransceiverHealthUtil.normalizeThresholds(thresholds);
  const items: Array<ThresholdItem> = [];

  if (normalized?.lowAlarm !== undefined) {
    items.push({
      label: TRANSCEIVER_THRESHOLD_LABELS.lowAlarm,
      value: normalized.lowAlarm,
    });
  }
  if (normalized?.lowWarning !== undefined) {
    items.push({
      label: TRANSCEIVER_THRESHOLD_LABELS.lowWarning,
      value: normalized.lowWarning,
    });
  }
  if (normalized?.highWarning !== undefined) {
    items.push({
      label: TRANSCEIVER_THRESHOLD_LABELS.highWarning,
      value: normalized.highWarning,
    });
  }
  if (normalized?.highAlarm !== undefined) {
    items.push({
      label: TRANSCEIVER_THRESHOLD_LABELS.highAlarm,
      value: normalized.highAlarm,
    });
  }

  return items;
}

/*
 * Where a value and its thresholds sit on a bar, as percentages of its
 * width: the healthy band between the warnings, the warning bands out to the
 * alarms, the alarm bands beyond. Undefined when the device reports no
 * thresholds for the reading - a bar without them would mean nothing.
 */
export interface ThresholdBarLayout {
  markerPercent: number;
  segments: Array<{
    fromPercent: number;
    toPercent: number;
    tone: TransceiverTone;
  }>;
}

export function getThresholdBarLayout(
  value: number,
  thresholds: TransceiverThresholds | undefined,
): ThresholdBarLayout | undefined {
  const normalized: TransceiverThresholds | undefined =
    TransceiverHealthUtil.normalizeThresholds(thresholds);

  if (!normalized) {
    return undefined;
  }

  const limits: Array<number> = [
    normalized.lowAlarm,
    normalized.lowWarning,
    normalized.highWarning,
    normalized.highAlarm,
  ].filter((limit: number | undefined): limit is number => {
    return limit !== undefined;
  });

  const low: number = Math.min(value, ...limits);
  const high: number = Math.max(value, ...limits);
  const span: number = high - low || 1;
  // A margin either side, so a value at a limit is not drawn on the edge.
  const domainLow: number = low - span * 0.15;
  const domainHigh: number = high + span * 0.15;
  const toPercent: (point: number) => number = (point: number): number => {
    return Math.max(
      0,
      Math.min(100, ((point - domainLow) / (domainHigh - domainLow)) * 100),
    );
  };

  const lowAlarm: number = normalized.lowAlarm ?? domainLow;
  const lowWarning: number = normalized.lowWarning ?? lowAlarm;
  const highAlarm: number = normalized.highAlarm ?? domainHigh;
  const highWarning: number = normalized.highWarning ?? highAlarm;

  const segments: ThresholdBarLayout["segments"] = [
    {
      fromPercent: 0,
      toPercent: toPercent(lowAlarm),
      tone: TransceiverTone.Critical,
    },
    {
      fromPercent: toPercent(lowAlarm),
      toPercent: toPercent(lowWarning),
      tone: TransceiverTone.Warning,
    },
    {
      fromPercent: toPercent(lowWarning),
      toPercent: toPercent(highWarning),
      tone: TransceiverTone.Healthy,
    },
    {
      fromPercent: toPercent(highWarning),
      toPercent: toPercent(highAlarm),
      tone: TransceiverTone.Warning,
    },
    {
      fromPercent: toPercent(highAlarm),
      toPercent: 100,
      tone: TransceiverTone.Critical,
    },
  ].filter((segment: { fromPercent: number; toPercent: number }) => {
    return segment.toPercent - segment.fromPercent > 0.01;
  });

  return { markerPercent: toPercent(value), segments: segments };
}

/*
 * The received power trend under the RX value: the daily averages for the
 * sparkline, and the drop from the best recent day when it is worth saying
 * (from the alert's own 2 dB on, so the page and the alert agree on when a
 * drop is news).
 */
export interface RxTrendView {
  trend: TransceiverRxPowerTrend;
  isDropping: boolean;
}

export function getRxTrendView(
  transceiver: NetworkDeviceTransceiver,
): RxTrendView {
  const trend: TransceiverRxPowerTrend =
    TransceiverHealthUtil.getRxPowerTrend(transceiver);

  return {
    trend: trend,
    /*
     * A receiver gone dark is an alarm of its own ("No light"); the size of
     * the drop says nothing more about it.
     */
    isDropping:
      transceiver.isPresent &&
      trend.dropDb !== undefined &&
      trend.dropDb >= TRANSCEIVER_RX_DROP_ALERT_DB &&
      (trend.currentDbm === undefined ||
        trend.currentDbm > TRANSCEIVER_MIN_POWER_DBM),
  };
}

/*
 * The summary chips in the card's header, problems first, only the ones
 * with a count.
 */
export interface SummaryChip {
  template: { one: string; other: string };
  count: number;
  tone: TransceiverTone;
}

export function getSummaryChips(
  summary: TransceiverHealthSummary,
): Array<SummaryChip> {
  const chips: Array<SummaryChip> = [
    {
      template: {
        one: "{{count}} not detected",
        other: "{{count}} not detected",
      },
      count: summary.notDetected,
      tone: TransceiverTone.Critical,
    },
    {
      template: { one: "{{count}} alarm", other: "{{count}} alarms" },
      count: summary.alarm,
      tone: TransceiverTone.Critical,
    },
    {
      template: { one: "{{count}} warning", other: "{{count}} warnings" },
      count: summary.warning,
      tone: TransceiverTone.Warning,
    },
    {
      template: { one: "{{count}} healthy", other: "{{count}} healthy" },
      count: summary.healthy,
      tone: TransceiverTone.Healthy,
    },
  ];

  return chips.filter((chip: SummaryChip) => {
    return chip.count > 0;
  });
}

// The most recent poll that read any of the device's optics.
export function getLastReadAt(
  transceivers: Array<NetworkDeviceTransceiver>,
): Date | undefined {
  let latest: number | undefined = undefined;

  for (const transceiver of transceivers) {
    const at: number = transceiver.lastSeenAt
      ? new Date(transceiver.lastSeenAt).getTime()
      : NaN;

    if (!isNaN(at) && (latest === undefined || at > latest)) {
      latest = at;
    }
  }

  return latest === undefined ? undefined : new Date(latest);
}

/*
 * A small SVG path for a sparkline of daily averages: one point per day
 * that has one, scaled into the box, the baseline as a horizontal line.
 */
export interface SparklineGeometry {
  points: Array<{ x: number; y: number }>;
  baselineY?: number | undefined;
}

/*
 * The smallest stretch of dB a sparkline spans. Received power wobbles by a
 * few tenths of a dB from day to day; scaled to fill the box, that wobble
 * would draw a perfectly healthy optic as a jagged line. Two dB - the drop
 * the recommended alert fires at - is the least a sparkline shows, so a calm
 * optic draws a calm line and a real drop still fills the box.
 */
export const SPARKLINE_MIN_RANGE_DB: number = TRANSCEIVER_RX_DROP_ALERT_DB;

export function getSparklineGeometry(data: {
  values: Array<number>;
  baseline?: number | undefined;
  width: number;
  height: number;
  padding?: number | undefined;
  minRange?: number | undefined;
}): SparklineGeometry {
  const padding: number = data.padding ?? 2;

  if (data.values.length === 0) {
    return { points: [] };
  }

  const all: Array<number> =
    data.baseline !== undefined ? [...data.values, data.baseline] : data.values;
  let min: number = Math.min(...all);
  let max: number = Math.max(...all);
  const minRange: number = data.minRange ?? SPARKLINE_MIN_RANGE_DB;

  if (max - min < minRange) {
    const middle: number = (max + min) / 2;
    min = middle - minRange / 2;
    max = middle + minRange / 2;
  }

  const range: number = max - min || 1;
  const innerWidth: number = data.width - padding * 2;
  const innerHeight: number = data.height - padding * 2;

  const yOf: (value: number) => number = (value: number): number => {
    // Flat lines sit in the middle rather than on an edge.
    if (max === min) {
      return data.height / 2;
    }
    return padding + innerHeight - ((value - min) / range) * innerHeight;
  };

  const points: Array<{ x: number; y: number }> = data.values.map(
    (value: number, index: number) => {
      return {
        x:
          data.values.length === 1
            ? data.width - padding
            : padding + (index / (data.values.length - 1)) * innerWidth,
        y: yOf(value),
      };
    },
  );

  return {
    points: points,
    ...(data.baseline !== undefined ? { baselineY: yOf(data.baseline) } : {}),
  };
}
