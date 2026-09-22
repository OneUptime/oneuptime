import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  HistogramBucket,
  HistogramSeriesOption,
} from "Common/UI/Components/TelemetryViewer/types";

/*
 * Pure data helpers behind the Security Events volume chart: which query
 * counts the events, how the counts become stacked bars, and how a drag on
 * those bars becomes a time range. No React and no fetches, so
 * App/Tests/Dashboard/SecurityEventVolume.test.ts can hold all of it without
 * rendering anything.
 */

/*
 * Stacking order, bottom of the bar first, and legend order, left first.
 * Most severe at the bottom: a handful of Critical events under a tower of
 * Informational ones would otherwise ride at the top of the stack and read as
 * a sliver of colour, where on the baseline they line up across bars. Other
 * and Unknown say nothing about severity, so they sit above everything that
 * does.
 */
export const SECURITY_EVENT_VOLUME_SEVERITIES: Array<OcsfSeverity> = [
  OcsfSeverity.Fatal,
  OcsfSeverity.Critical,
  OcsfSeverity.High,
  OcsfSeverity.Medium,
  OcsfSeverity.Low,
  OcsfSeverity.Informational,
  OcsfSeverity.Other,
  OcsfSeverity.Unknown,
];

/*
 * Stacked segments have to be told apart from their neighbours, so unlike the
 * severity pill (which paints Fatal and Critical the same red, and every
 * non-severity grey) each severity here gets its own colour. The warm end
 * keeps the pill's reds and oranges so a colour means the same thing on the
 * chart as in the table under it.
 */
export const SECURITY_EVENT_VOLUME_COLORS: Record<OcsfSeverity, string> = {
  [OcsfSeverity.Fatal]: "#7f1d1d",
  [OcsfSeverity.Critical]: "#dc2626",
  [OcsfSeverity.High]: "#ea580c",
  [OcsfSeverity.Medium]: "#f59e0b",
  [OcsfSeverity.Low]: "#3b82f6",
  [OcsfSeverity.Informational]: "#94a3b8",
  [OcsfSeverity.Other]: "#a78bfa",
  [OcsfSeverity.Unknown]: "#cbd5e1",
};

export function getSecurityEventVolumeSeries(): Array<HistogramSeriesOption> {
  return SECURITY_EVENT_VOLUME_SEVERITIES.map(
    (severity: OcsfSeverity): HistogramSeriesOption => {
      return {
        key: severity,
        label: severity,
        color: SECURITY_EVENT_VOLUME_COLORS[severity],
      };
    },
  );
}

/*
 * The severity a row is counted under. Ingest always writes an OCSF name, but
 * the column defaults to '' and rows predating normalization exist; anything
 * that is not an OCSF name is counted as Unknown rather than dropped, so the
 * chart's total always equals the number of rows the table lists.
 */
export function toSecurityEventVolumeSeverity(
  severityName: unknown,
): OcsfSeverity {
  if (
    typeof severityName === "string" &&
    SECURITY_EVENT_VOLUME_SEVERITIES.includes(severityName as OcsfSeverity)
  ) {
    return severityName as OcsfSeverity;
  }

  return OcsfSeverity.Unknown;
}

/*
 * The aggregate the chart runs: events per time bucket per severity, over
 * exactly the query the table lists rows with (see onQueryChange on the
 * model table). Going through the generic /aggregate route keeps the
 * Security-tier read ACL and any owned-scope narrowing identical to the list.
 *
 * eventUid is counted because it is non-nullable (a '' default), so count()
 * over it is a row count. The bucket size is left to the server, which
 * derives it from the window the same way intervalForWindow does below.
 */
export function buildSecurityEventVolumeAggregateBy(data: {
  query: Query<SecurityEvent>;
  startDate: Date;
  endDate: Date;
}): AggregateBy<SecurityEvent> {
  return {
    query: data.query,
    aggregationType: AggregationType.Count,
    aggregateColumnName: "eventUid",
    aggregationTimestampColumnName: "time",
    startTimestamp: data.startDate,
    endTimestamp: data.endDate,
    groupBy: { severityName: true },
    // Eight severities over at most a few hundred buckets fits many times over.
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: { time: SortOrder.Ascending },
  };
}

export function intervalForWindow(
  startDate: Date,
  endDate: Date,
): AggregationInterval {
  return AggregationIntervalUtil.getAggregationIntervalForWindow({
    startDate: startDate,
    endDate: endDate,
  });
}

/*
 * The intervals whose buckets sit on a fixed epoch-millisecond grid, and so
 * can be laid out client-side and matched to server buckets exactly. Week,
 * Month and Year snap to calendar boundaries server-side; for those the
 * server's buckets are drawn as they come.
 */
const GRID_ALIGNED_INTERVALS: Array<AggregationInterval> = [
  AggregationInterval.Minute,
  AggregationInterval.FiveMinutes,
  AggregationInterval.FifteenMinutes,
  AggregationInterval.ThirtyMinutes,
  AggregationInterval.Hour,
  AggregationInterval.Day,
];

// A backstop on the empty-slot walk; real windows lay out a few hundred.
export const MAX_SECURITY_EVENT_VOLUME_SLOTS: number = 2000;

export interface SecurityEventSeverityCount {
  severity: OcsfSeverity;
  count: number;
  color: string;
}

export interface SecurityEventVolume {
  /*
   * One entry per (bucket, severity) that has events, plus one zero-count
   * entry for every empty bucket in the window - so a quiet hour holds its
   * place on the time axis instead of the bars either side of it closing up.
   * Sorted oldest first.
   */
  buckets: Array<HistogramBucket>;
  interval: AggregationInterval;
  intervalMs: number;
  total: number;
  // Severities with at least one event, in SECURITY_EVENT_VOLUME_SEVERITIES order.
  countsBySeverity: Array<SecurityEventSeverityCount>;
}

function toTimestampMs(raw: unknown): number {
  if (raw instanceof Date) {
    return raw.getTime();
  }

  if (typeof raw === "string" || typeof raw === "number") {
    return new Date(raw).getTime();
  }

  return NaN;
}

function toCount(raw: unknown): number {
  const count: number = Number(raw);

  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function buildSecurityEventVolume(data: {
  rows: Array<AggregatedModel>;
  startDate: Date;
  endDate: Date;
}): SecurityEventVolume {
  const interval: AggregationInterval = intervalForWindow(
    data.startDate,
    data.endDate,
  );
  const intervalMs: number =
    AggregationIntervalUtil.getAggregationIntervalMs(interval);
  const isGridAligned: boolean = GRID_ALIGNED_INTERVALS.includes(interval);

  const snap: (ms: number) => number = (ms: number): number => {
    return isGridAligned
      ? AggregationIntervalUtil.floorDateToIntervalGrid(
          new Date(ms),
          interval,
        ).getTime()
      : ms;
  };

  // bucket start (ms) -> severity -> count
  const countsBySlot: Map<number, Map<OcsfSeverity, number>> = new Map();
  const totalsBySeverity: Map<OcsfSeverity, number> = new Map();
  let total: number = 0;

  for (const row of data.rows) {
    const timestampMs: number = toTimestampMs(row.timestamp);
    const count: number = toCount(row.value);

    if (!Number.isFinite(timestampMs) || count === 0) {
      continue;
    }

    const slot: number = snap(timestampMs);
    const severity: OcsfSeverity = toSecurityEventVolumeSeverity(
      row["severityName"],
    );

    let slotCounts: Map<OcsfSeverity, number> | undefined =
      countsBySlot.get(slot);

    if (!slotCounts) {
      slotCounts = new Map();
      countsBySlot.set(slot, slotCounts);
    }

    // Two unrecognised names both land on Unknown, so this adds, not sets.
    slotCounts.set(severity, (slotCounts.get(severity) || 0) + count);
    totalsBySeverity.set(
      severity,
      (totalsBySeverity.get(severity) || 0) + count,
    );
    total += count;
  }

  const slots: Set<number> = new Set<number>(countsBySlot.keys());

  if (isGridAligned) {
    const firstSlot: number = snap(data.startDate.getTime());
    const endMs: number = data.endDate.getTime();

    for (
      let index: number = 0;
      index < MAX_SECURITY_EVENT_VOLUME_SLOTS;
      index++
    ) {
      const slot: number = firstSlot + index * intervalMs;

      if (slot > endMs) {
        break;
      }

      slots.add(slot);
    }
  }

  const buckets: Array<HistogramBucket> = [];

  for (const slot of Array.from(slots).sort((a: number, b: number) => {
    return a - b;
  })) {
    const time: string = new Date(slot).toISOString();
    const slotCounts: Map<OcsfSeverity, number> | undefined =
      countsBySlot.get(slot);

    if (!slotCounts) {
      buckets.push({
        time: time,
        series: SECURITY_EVENT_VOLUME_SEVERITIES[0]!,
        count: 0,
      });
      continue;
    }

    for (const severity of SECURITY_EVENT_VOLUME_SEVERITIES) {
      const count: number = slotCounts.get(severity) || 0;

      if (count > 0) {
        buckets.push({ time: time, series: severity, count: count });
      }
    }
  }

  const countsBySeverity: Array<SecurityEventSeverityCount> = [];

  for (const severity of SECURITY_EVENT_VOLUME_SEVERITIES) {
    const count: number = totalsBySeverity.get(severity) || 0;

    if (count > 0) {
      countsBySeverity.push({
        severity: severity,
        count: count,
        color: SECURITY_EVENT_VOLUME_COLORS[severity],
      });
    }
  }

  return {
    buckets: buckets,
    interval: interval,
    intervalMs: intervalMs,
    total: total,
    countsBySeverity: countsBySeverity,
  };
}

export function buildSecurityEventVolumeFromResult(data: {
  result: AggregatedResult;
  startDate: Date;
  endDate: Date;
}): SecurityEventVolume {
  return buildSecurityEventVolume({
    rows: data.result?.data || [],
    startDate: data.startDate,
    endDate: data.endDate,
  });
}
