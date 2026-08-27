import { AggregateColumn, AggregateRow } from "../../Types/Database/AggregateBy";
import AggregateResultUtil from "../../Types/Database/AggregateResultUtil";
import { DeviceHealthStateInput } from "../../../Utils/NetworkDevice/DeviceHealthStateUtil";
import {
  DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES,
  DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
  DEVICE_MISSED_POLL_ALLOWANCE,
} from "../../../Utils/NetworkDevice/DeviceReachabilityUtil";
import OneUptimeDate from "../../../Types/Date";
import { DeviceHealthState } from "../../../Utils/NetworkSite/SiteStatusRollupUtil";

/*
 * Counting device health for a whole estate WITHOUT loading the estate.
 *
 * The obvious way to make a per-site health rollup fast is to write the
 * classification rule a second time, in SQL: `CASE WHEN isReachable = false
 * THEN 'down' WHEN ...`. That is also the way to guarantee the product
 * eventually contradicts itself — a device the site card counts as healthy and
 * the topology map next to it draws red — which is the exact outcome
 * DeviceHealthStateUtil was created to make impossible. A rule with two
 * implementations has two behaviours the moment either one is edited.
 *
 * So the rule does not move. What moves is the DATA REDUCTION.
 *
 * `deviceHealthState` is a pure function of six facts about a row, and five of
 * them are already booleans or three-state flags. Group the table by those
 * facts in SQL and 80,000 rows collapse into at most a few per site — one
 * bucket per distinct combination that actually occurs. Then hand each bucket
 * back to the REAL classifier once and multiply its verdict by the bucket's
 * count.
 *
 * One rule, one implementation, and the wire carries buckets instead of rows.
 *
 * The one fact that is not already discrete is staleness — "nothing has polled
 * this device in a long time" — because the window is per-device, derived from
 * each row's own interval. That predicate is computed in SQL below, from the
 * very constants DeviceReachabilityUtil derives its window from, so there is
 * still only one definition of how long "a long time" is.
 */

/**
 * Column names on `NetworkDevice`, qualified with the alias
 * `DatabaseService.aggregateBy` runs under (which is the model name).
 */
function column(columnName: string): string {
  return `"NetworkDevice"."${columnName}"`;
}

/*
 * The staleness window, in minutes, as SQL — the exact expression
 * `DeviceReachabilityUtil.getStaleWindowInMinutes` computes in TypeScript,
 * built from the same three exported constants so the two cannot drift.
 */
const STALE_WINDOW_IN_MINUTES_SQL: string = `GREATEST(
  (CASE
    WHEN ${column("pollingIntervalInMinutes")} IS NULL
      OR ${column("pollingIntervalInMinutes")} <= 0
    THEN ${DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES}
    ELSE GREATEST(${column("pollingIntervalInMinutes")}, 1)
  END) * ${DEVICE_MISSED_POLL_ALLOWANCE},
  ${DEVICE_MIN_STALE_WINDOW_IN_MINUTES}
)`;

/*
 * Newest of the two contact timestamps — `DeviceReachabilityUtil`'s `newerOf`.
 * Postgres GREATEST ignores NULL arguments and is NULL only when every
 * argument is, which is precisely that function's behaviour.
 */
const LAST_CONTACT_AT_SQL: string = `GREATEST(${column(
  "lastPolledAt",
)}, ${column("lastSeenAt")})`;

/**
 * The name of the bound parameter carrying "now".
 *
 * Passed in rather than using the database's `NOW()` so that a caller
 * classifying several groups — or comparing an aggregate against a row it also
 * fetched — measures every one of them against a single instant. `NOW()` would
 * also be the transaction's start time rather than the caller's, which is a
 * different clock from the one the TypeScript rule reads.
 */
export const DEVICE_HEALTH_NOW_PARAMETER: string = "deviceHealthNow";

/** Aliases the grouped columns come back under. */
export enum DeviceHealthGroupAlias {
  SiteId = "siteId",
  MonitorStatusId = "monitorStatusId",
  MonitoringMethod = "monitoringMethod",
  IsReachable = "isReachable",
  HasBeenPolled = "hasBeenPolled",
  HasBeenSeen = "hasBeenSeen",
  IsStale = "isStale",
  HasDownInterfaces = "hasDownInterfaces",
  DeviceCount = "deviceCount",
  InterfacesDownTotal = "interfacesDownTotal",
}

/*
 * Every fact `deviceHealthState` reads, and nothing else.
 *
 * Reduced to its coarsest form on purpose: `interfacesDown` is grouped as
 * "> 0 or not" rather than by value, and the timestamps as "set or not" plus
 * the staleness verdict, because that is all the rule can distinguish. Grouping
 * by the raw values instead would produce almost one bucket per device and
 * defeat the whole exercise.
 */
const DEVICE_HEALTH_DISCRIMINATOR_COLUMNS: Array<AggregateColumn> = [
  {
    expression: column("currentMonitorStatusId"),
    alias: DeviceHealthGroupAlias.MonitorStatusId,
  },
  /*
   * Grouped raw rather than pre-parsed into "is monitor backed", because
   * `NetworkDeviceMonitoringMethodUtil.parse` owns what an unrecognised or
   * NULL value means and there is no reason for SQL to hold a second opinion.
   * The column only ever holds a handful of distinct values, so the raw form
   * costs nothing in bucket count.
   *
   * `deviceHealthState` ignores this; `DeviceReachabilityUtil` does not, and
   * a fleet tally that dropped it would report every ping-only device as
   * Pending forever.
   */
  {
    expression: column("monitoringMethod"),
    alias: DeviceHealthGroupAlias.MonitoringMethod,
  },
  {
    expression: column("isReachable"),
    alias: DeviceHealthGroupAlias.IsReachable,
  },
  {
    expression: `(${column("lastPolledAt")} IS NOT NULL)`,
    alias: DeviceHealthGroupAlias.HasBeenPolled,
  },
  {
    expression: `(${column("lastSeenAt")} IS NOT NULL)`,
    alias: DeviceHealthGroupAlias.HasBeenSeen,
  },
  {
    expression: `(
      ${LAST_CONTACT_AT_SQL} IS NOT NULL
      AND ${LAST_CONTACT_AT_SQL} < :${DEVICE_HEALTH_NOW_PARAMETER}::timestamptz
        - make_interval(mins => ${STALE_WINDOW_IN_MINUTES_SQL})
    )`,
    alias: DeviceHealthGroupAlias.IsStale,
  },
  {
    expression: `(COALESCE(${column("interfacesDown")}, 0) > 0)`,
    alias: DeviceHealthGroupAlias.HasDownInterfaces,
  },
];

/** How many devices are in a bucket. */
export const DEVICE_COUNT_AGGREGATE: AggregateColumn = {
  expression: "COUNT(*)",
  alias: DeviceHealthGroupAlias.DeviceCount,
};

/**
 * How many INTERFACES are down across a bucket's devices.
 *
 * A real SUM, not a count of devices with dark ports: a switch with three
 * down interfaces contributes three. Carried alongside the bucket counts so a
 * caller that wants both the fleet's health tally and its total dark ports
 * gets them from one statement.
 */
export const INTERFACES_DOWN_AGGREGATE: AggregateColumn = {
  expression: `COALESCE(SUM(${column("interfacesDown")}), 0)`,
  alias: DeviceHealthGroupAlias.InterfacesDownTotal,
};

/** Both aggregates, which is what every health grouping selects. */
export const DEVICE_HEALTH_AGGREGATES: Array<AggregateColumn> = [
  DEVICE_COUNT_AGGREGATE,
  INTERFACES_DOWN_AGGREGATE,
];

/** Health buckets for the whole matched set, with no per-site breakdown. */
export const DEVICE_HEALTH_GROUP_COLUMNS: Array<AggregateColumn> = [
  ...DEVICE_HEALTH_DISCRIMINATOR_COLUMNS,
];

/** Health buckets broken down by the site each device is attached to. */
export const DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE: Array<AggregateColumn> = [
  { expression: column("siteId"), alias: DeviceHealthGroupAlias.SiteId },
  ...DEVICE_HEALTH_DISCRIMINATOR_COLUMNS,
];

/** One bucket, as read back out of an aggregate row. */
export interface DeviceHealthGroup {
  // Null for the ungrouped form, and for devices attached to no site.
  siteId: string | null;
  monitorStatusId: string | null;
  /*
   * Null for rows written before the column existed, which
   * `NetworkDeviceMonitoringMethodUtil.parse` reads as SNMP.
   */
  monitoringMethod: string | null;
  isReachable: boolean | null;
  hasBeenPolled: boolean;
  hasBeenSeen: boolean;
  isStale: boolean;
  hasDownInterfaces: boolean;
  deviceCount: number;
  // Sum of `interfacesDown` over the bucket's devices.
  interfacesDownTotal: number;
}

export function parseDeviceHealthGroup(row: AggregateRow): DeviceHealthGroup {
  return {
    siteId: AggregateResultUtil.toStringOrNull(
      row,
      DeviceHealthGroupAlias.SiteId,
    ),
    monitorStatusId: AggregateResultUtil.toStringOrNull(
      row,
      DeviceHealthGroupAlias.MonitorStatusId,
    ),
    monitoringMethod: AggregateResultUtil.toStringOrNull(
      row,
      DeviceHealthGroupAlias.MonitoringMethod,
    ),
    isReachable: AggregateResultUtil.toNullableBoolean(
      row,
      DeviceHealthGroupAlias.IsReachable,
    ),
    hasBeenPolled: AggregateResultUtil.toBoolean(
      row,
      DeviceHealthGroupAlias.HasBeenPolled,
    ),
    hasBeenSeen: AggregateResultUtil.toBoolean(
      row,
      DeviceHealthGroupAlias.HasBeenSeen,
    ),
    isStale: AggregateResultUtil.toBoolean(row, DeviceHealthGroupAlias.IsStale),
    hasDownInterfaces: AggregateResultUtil.toBoolean(
      row,
      DeviceHealthGroupAlias.HasDownInterfaces,
    ),
    deviceCount: AggregateResultUtil.toNumber(
      row,
      DeviceHealthGroupAlias.DeviceCount,
    ),
    interfacesDownTotal: AggregateResultUtil.toNumber(
      row,
      DeviceHealthGroupAlias.InterfacesDownTotal,
    ),
  };
}

/*
 * How far back a synthetic "stale" timestamp is placed.
 *
 * `deviceHealthInputForGroup` hands the classifier dates rather than the
 * staleness flag itself, because the flag is not part of the classifier's
 * input shape — it is something the classifier derives. So the dates have to
 * be chosen to make it derive the answer SQL already reached: comfortably
 * outside any window `getStaleWindowInMinutes` can return for the default
 * interval (60 minutes) to mean stale, and the caller's own "now" to mean
 * fresh.
 */
const SYNTHETIC_STALE_AGE_IN_MINUTES: number = 365 * 24 * 60;

/**
 * One bucket, expressed as the input the REAL classifier takes.
 *
 * The dates are synthetic and deliberately so: SQL has already decided
 * staleness per device, against each device's own interval, and a bucket has
 * no single interval to re-derive it from. Feeding back the default interval
 * plus a timestamp on the correct side of that window reproduces the verdict
 * exactly — and, importantly, leaves the decision itself with
 * `deviceHealthState` rather than copying it here.
 */
export function deviceHealthInputForGroup(data: {
  group: DeviceHealthGroup;
  // The OFFLINE end of the bucket's stamped MonitorStatus, if it has one.
  monitorStatusIsOffline?: boolean | undefined;
  now: Date;
}): DeviceHealthStateInput {
  const { group, now } = data;

  const contactAt: Date = group.isStale
    ? OneUptimeDate.addRemoveMinutes(now, -SYNTHETIC_STALE_AGE_IN_MINUTES)
    : now;

  return {
    monitorStatusIsOffline: data.monitorStatusIsOffline,
    isReachable: group.isReachable,
    lastPolledAt: group.hasBeenPolled ? contactAt : null,
    lastSeenAt: group.hasBeenSeen ? contactAt : null,
    /*
     * Left unset on purpose. The window has already been applied in SQL
     * against each device's real interval; re-supplying an interval here
     * would ask the classifier to re-derive staleness from a bucket that no
     * longer has one. Unset reads as the column default, which is the window
     * the synthetic dates above are placed relative to.
     */
    pollingIntervalInMinutes: undefined,
    interfacesDown: group.hasDownInterfaces ? 1 : 0,
  };
}

/**
 * One bucket, expressed as the input the site ROLLUP rule takes.
 *
 * `SiteStatusRollupUtil.worstStatus` answers a different question from
 * `deviceHealthState` — which MonitorStatus a site inherits, rather than how
 * healthy one device is — but it reads the same reachability facts, so the
 * same buckets serve it. It is a worst-of, so a bucket's COUNT does not enter
 * into it: one representative per bucket produces the identical winner that
 * every device in the bucket would have.
 *
 * The synthetic timestamps are chosen exactly as in
 * `deviceHealthInputForGroup`, and for the same reason.
 */
export function deviceRollupStateForGroup(data: {
  group: DeviceHealthGroup;
  // Priority of the bucket's stamped MonitorStatus, when it has one.
  monitorStatusPriority?: number | undefined;
  now: Date;
}): DeviceHealthState {
  const { group, now } = data;

  const contactAt: Date = group.isStale
    ? OneUptimeDate.addRemoveMinutes(now, -SYNTHETIC_STALE_AGE_IN_MINUTES)
    : now;

  return {
    currentMonitorStatusId: group.monitorStatusId,
    monitorStatusPriority: data.monitorStatusPriority,
    isReachable: group.isReachable,
    lastPolledAt: group.hasBeenPolled ? contactAt : null,
    lastSeenAt: group.hasBeenSeen ? contactAt : null,
    // See deviceHealthInputForGroup — staleness is already applied.
    pollingIntervalInMinutes: undefined,
  };
}
