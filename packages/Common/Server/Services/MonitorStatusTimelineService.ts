import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import StateChangeLock from "../Utils/StateChangeLock";
import StateChangeFollowOn from "../Utils/StateChangeFollowOn";
import Exception from "../../Types/Exception/Exception";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import {
  DatabaseTriggerType,
  OnCreate,
  OnDelete,
} from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectScopedReferenceValidator from "../Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ProjectReferencesService from "./ProjectReferencesService";
import MonitorService from "./MonitorService";
import NetworkSiteService from "./NetworkSiteService";
import UserService from "./UserService";
import CreatedByUser from "../Utils/Database/CreatedByUser";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorFeedService from "./MonitorFeedService";
import { MonitorFeedEventType } from "../../Models/DatabaseModels/MonitorFeed";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusService from "./MonitorStatusService";
import ServerException from "../../Types/Exception/ServerException";
import {
  MonitorGroupUptimeDaily,
  MonitorGroupUptimeDailyAggregate,
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../Types/StatusPage/UptimeDailyAggregate";
import { MergedDowntimeTotals } from "../../Types/StatusPage/MergedDowntimeTotals";
import {
  MONITOR_UPTIME_HISTORY_DAYS,
  MONITOR_UPTIME_ROLLING_WINDOWS,
  MonitorUptimeRollingWindow,
  MonitorUptimeSummary,
  MonitorUptimeSummaryStatus,
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../Types/Monitor/MonitorUptimeSummary";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import MonitorUptimeSummaryUtil from "../../Utils/Monitor/MonitorUptimeSummaryUtil";
import UptimeDailyAggregateUtil from "../../Utils/StatusPage/UptimeDailyAggregateUtil";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
import MonitoringOff, {
  MONITORING_OFF_SELECT,
} from "../../Utils/Monitor/MonitoringOff";
import Monitor from "../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../Types/JSON";
import StateTimelineRowsKept from "../Utils/Database/StateTimelineRowsKept";
import MonitorStatusEventDelete, {
  StatusEventDeleteDecision,
} from "../../Utils/Monitor/MonitorStatusEventDelete";

/*
 * Thrown by onBeforeCreate when the incoming status is the same as the status of
 * the row immediately before it. Probe ingest call sites (Utils/Monitor/MonitorStatusTimeline
 * and Utils/Monitor/MonitorResource) match on this exact message to treat the
 * duplicate as an idempotent no-op, so the text must not change.
 */
export const MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE: string =
  "Monitor Status cannot be same as previous status.";

/*
 * Thrown by create() (its onBeforeCreate) when the per-monitor mutex cannot be
 * acquired. The timeline write is refused rather than performed unlocked - see
 * lockMonitor below. Probe ingest call sites match on this to log and skip
 * instead of failing the whole ingest run.
 */
export const MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE: string =
  "Could not acquire the monitor status timeline lock for this monitor.";

/*
 * THE STATUS EVENTS THAT ONLY MARK MONITORING TURNED OFF OR BACK ON.
 *
 * A monitor's monitoring turned off or on starts a status event of its own,
 * with the status the monitor holds and isMonitoringOff saying which
 * (recordMonitoringSwitch, issue #6480): uptime, status pages and SLOs then
 * leave out the time between. No status changed, so such a create posts no
 * feed item, stamps no network device and starts no workflow. Its create is
 * kept here from onBeforeCreate (buildOnCreate) on - DatabaseService hands
 * every hook the same CreateBy - and its row's id while the create runs, for
 * onTriggerWorkflow, which is told the id alone.
 */
const monitoringSwitchCreates: WeakSet<CreateBy<MonitorStatusTimeline>> =
  new WeakSet<CreateBy<MonitorStatusTimeline>>();
const monitoringSwitchRowIdByCreate: WeakMap<
  CreateBy<MonitorStatusTimeline>,
  string
> = new WeakMap<CreateBy<MonitorStatusTimeline>, string>();
const monitoringSwitchRowIds: Set<string> = new Set<string>();

// One window for getRollingUptimeTotals. Every window ends at its endDate.
export interface RollingUptimeWindowRequest {
  key: MonitorUptimeWindowKey;
  startDate: Date;
}

/*
 * A row of getRollingUptimeTotals' SQL: one per (window, status), or one
 * with a NULL status for a window nothing overlapped. Numbers are typed
 * loosely because the pg driver hands some numeric types back as strings.
 */
export interface RollingUptimeTotalRow {
  windowKey: string;
  windowSeconds: string | number;
  monitorStatusId: string | null;
  seconds: string | number;
}

/*
 * What getMergedDowntimeSeconds returns for a SET of monitors. Defined with
 * the status page types, because the browser reads it too.
 */
export type { MergedDowntimeTotals };

/*
 * The single row getMergedDowntimeSeconds' SQL returns. Typed loosely
 * because the pg driver hands some numeric types back as strings.
 */
export interface MergedDowntimeRow {
  coveredSeconds: string | number | null;
  downtimeSeconds: string | number | null;
}

/*
 * A row of getMonitorGroupDailyUptimeAggregate's SQL: one group's day
 * bucket, with the day's union of the group's periods ranked at or above
 * each level, from level 1 (every status: the coverage) up - or NULL for a
 * day nothing of the group overlapped. Typed loosely because the pg driver
 * hands some numeric types back as strings.
 */
export interface MonitorGroupDailyUptimeRow {
  groupKey: string | number;
  bucketStart: Date | string;
  bucketEnd: Date | string;
  daySeconds: string | number;
  unions: Array<string | number | null> | null;
}

/*
 * A group's time at one status is a difference of two sums of doubles, so a
 * status it spent no time in can come out a few ulps above zero. Anything
 * under a microsecond is no time at all.
 */
export const MINIMUM_GROUP_STATUS_SECONDS: number = 0.000001;

/*
 * What onBeforeDelete hands onDeleteSuccess for one status event deleted by
 * its id: the event, its monitor, and the event before it that runs on over
 * its time once it is gone (null when there is none: the oldest event).
 */
export interface StatusEventDeleteCarryForward {
  monitorId: ObjectID;
  eventId: ObjectID;
  previousRunsOn: { previousId: ObjectID; endsAt: Date | null } | null;
}

export class Service extends ProjectReferencesService<MonitorStatusTimeline> {
  public constructor() {
    super(MonitorStatusTimeline);

    /*
     * A delete by query - a workflow's Delete Many, a retention purge -
     * leaves each monitor's current status and every status event that
     * covers part of the last 90 days, so a monitor never turns gray on a
     * status page because its history was cleaned up. One event deleted by
     * its id is onBeforeDelete's to judge.
     */
    this.keepRowsOnDeleteByQuery(
      StateTimelineRowsKept.forTable("MonitorStatusTimeline"),
    );
  }

  /**
   * Per-monitor, per-day status durations for the status-page uptime bars.
   *
   * WHY THIS EXISTS
   *
   * The bars used to be painted from raw rows fetched with a single
   * `limit: LIMIT_MAX` (10,000) across EVERY monitor on the page, sorted
   * `startsAt DESC`. Measured on a real status page: 254,550 rows matched the
   * 60-day window and 10,000 came back. The oldest surviving row started four
   * days before the request, so 56 of 60 bars were painted from data that had
   * been silently dropped - and the uptime percentage was computed from the
   * same 3.9%.
   *
   * The cap being GLOBAL across monitors is what makes it vicious. A quiet,
   * healthy monitor's covering row has an OLD `startsAt`, so under
   * `startsAt DESC` it sorts last and is cut first: on the page that reported
   * this, three flapping monitors held 9,995 of the 10,000 slots. The
   * healthier a monitor is, the more likely it is to lose its entire history
   * to a noisy neighbour on the same page.
   *
   * Shipping more rows cannot fix it - 254,550 rows is ~105 MB of this
   * codebase's typed JSON, into a response held in a 500-entry in-memory
   * cache and then filtered per-bar on the client's main thread. So this
   * returns DURATIONS. The result is O(monitors x days x statuses) and cannot
   * be inflated by a flapping monitor.
   *
   * THE SQL, AND THE THREE TRAPS IN IT
   *
   * 1. An open row (`endsAt IS NULL`) is capped at the NEXT row's `startsAt`,
   *    not at `now()`. `COALESCE(endsAt, now())` would overlap the successor
   *    and double-count that span. This mirrors what
   *    UptimeUtil.getMonitorEventsForId already does client-side.
   *
   *    "Next" is `ORDER BY startsAt, endsAt NULLS LAST`. With startsAt alone
   *    an exact tie is left in whatever order the plan produces, and when the
   *    open row comes first its LEAD is the tied row's start - its own start -
   *    so the monitor's CURRENT status is cut to zero length and today reads
   *    as no data. Putting the open row last on a tie is what
   *    getRollingUptimeTotals and UptimeUtil.compareTimelinesChronologically
   *    do, so all three agree on the same rows.
   *
   * 2. Periods are split into days ARITHMETICALLY (`generate_series` over the
   *    days a period touches) and then hash-aggregated, rather than joined
   *    against a bucket grid. Both give the same answer; the join does not
   *    scale. Joining emitted one row per timeline row - 255,486 on the
   *    reporting page - which then had to be sorted for the GroupAggregate
   *    and spilled 26 MB to disk, ~4.7s. Splitting first aggregates 255k rows
   *    into ~450 with no sort: ~1.5s.
   *
   *    A period that lies inside one day yields exactly one segment, which is
   *    the overwhelmingly common case - a flapping monitor's rows last well
   *    under a second. Only a long-running period fans out, one segment per
   *    day it spans.
   *
   * 3. Seconds are summed as `double precision` and NEVER rounded per group.
   *    Rounding each (monitor, day, status) sum to a bigint loses up to half a
   *    second per status, so a fully covered day with two statuses reported
   *    86,399 of 86,400 seconds - a day that is complete looking one second
   *    short. Coverage is compared with a tolerance by the client rather than
   *    for exact equality.
   *
   * 4. Time with the monitor's monitoring turned off (`isMonitoringOff`,
   *    issue #6480) is no status: nothing checked the monitor, so its row
   *    holds only what the last check saw. Such a row is dropped AFTER the
   *    LEAD, never before it - filtered first, the open row before the switch
   *    would run on across the time monitoring was off. It leaves that time
   *    uncovered, so a day it fills reads as no data, and a day it fills in
   *    part is measured over the rest. getMonitorGroupDailyUptimeAggregate,
   *    getMergedDowntimeSeconds and getRollingUptimeTotals drop it the same
   *    way.
   *
   * A trap that is worth recording even though this SQL no longer contains it:
   * PostgreSQL's LEAST/GREATEST IGNORE NULLs, returning the smallest or
   * largest NON-NULL argument. An earlier draft joined rows to buckets, and on
   * an unmatched LEFT JOIN row `LEAST(NULL, bucketEnd) - GREATEST(NULL,
   * bucketStart)` silently became a FULL DAY of coverage - reporting a monitor
   * as up before it existed. It was caught against real data, not in review.
   * Any future rewrite that reintroduces a row-to-bucket join must handle it.
   *
   * Day buckets are local calendar days converted to UTC instants, so a DST
   * day is genuinely 23 or 25 hours - `daySeconds` is never hardcoded to
   * 86400. The window's first and last buckets are clipped to the window, and
   * the end is clamped to `now()` so a future day is never emitted and can
   * never be reported as 100%.
   */
  @CaptureSpan()
  public async getDailyUptimeAggregate(data: {
    monitorIds: Array<ObjectID>;
    startDate: Date;
    endDate: Date;
    timezone?: string | undefined;
  }): Promise<UptimeDailyAggregate> {
    const empty: UptimeDailyAggregate = {
      monitors: [],
      isComplete: true,
      completeFrom: null,
      timezone: data.timezone || "UTC",
    };

    if (data.monitorIds.length === 0) {
      return empty;
    }

    /*
     * The overlap predicate is preserved verbatim from the row fetch this
     * replaces: a row counts if it started on or before the window ends and
     * either ended on or after the window started or is still open. The
     * inclusive `>=` is deliberate - a row ending exactly at startDate still
     * overlaps - and a strict `>` is NOT interchangeable.
     */
    const sql: string = `
      WITH params AS (
        SELECT $2::timestamptz AS win_start,
               LEAST($3::timestamptz, now()) AS eff_end,
               $4::text AS tz
      ),
      mons AS (
        SELECT UNNEST($1::uuid[]) AS monitor_id
      ),
      src AS (
        SELECT t."monitorId" AS monitor_id,
               t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               GREATEST(t."startsAt", p.win_start) AS s,
               LEAST(
                 COALESCE(
                   t."endsAt",
                   LEAD(t."startsAt") OVER (
                     PARTITION BY t."monitorId"
                     ORDER BY t."startsAt", t."endsAt" NULLS LAST
                   ),
                   p.eff_end
                 ),
                 p.eff_end
               ) AS e
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        WHERE t."monitorId" = ANY($1::uuid[])
          AND t."deletedAt" IS NULL
          AND t."startsAt" <= p.eff_end
          AND (t."endsAt" >= p.win_start OR t."endsAt" IS NULL)
      ),
      split AS (
        SELECT src.monitor_id,
               src.status_id,
               (gs AT TIME ZONE p.tz) AS day_start,
               GREATEST(src.s, (gs AT TIME ZONE p.tz)) AS seg_start,
               LEAST(src.e, ((gs + interval '1 day') AT TIME ZONE p.tz))
                 AS seg_end
        FROM src
        CROSS JOIN params p,
        LATERAL generate_series(
          date_trunc('day', src.s AT TIME ZONE p.tz),
          date_trunc('day', (src.e - interval '1 microsecond') AT TIME ZONE p.tz),
          interval '1 day'
        ) AS gs
        WHERE src.e > src.s
          AND NOT src.is_off
      ),
      agg AS (
        SELECT monitor_id,
               day_start,
               status_id,
               SUM(EXTRACT(EPOCH FROM (seg_end - seg_start)))::double precision
                 AS seconds
        FROM split
        WHERE seg_end > seg_start
        GROUP BY monitor_id, day_start, status_id
      ),
      buckets AS (
        SELECT (d AT TIME ZONE p.tz) AS day_start,
               GREATEST((d AT TIME ZONE p.tz), p.win_start) AS bucket_start,
               LEAST(((d + interval '1 day') AT TIME ZONE p.tz), p.eff_end)
                 AS bucket_end
        FROM params p,
             generate_series(
               date_trunc('day', p.win_start AT TIME ZONE p.tz),
               date_trunc('day', p.eff_end AT TIME ZONE p.tz),
               interval '1 day'
             ) AS d
      )
      SELECT m.monitor_id AS "monitorId",
             b.bucket_start AS "bucketStart",
             b.bucket_end AS "bucketEnd",
             EXTRACT(EPOCH FROM (b.bucket_end - b.bucket_start))::bigint
               AS "daySeconds",
             a.status_id AS "monitorStatusId",
             COALESCE(a.seconds, 0)::double precision AS "seconds"
      FROM mons m
      CROSS JOIN buckets b
      LEFT JOIN agg a ON a.monitor_id = m.monitor_id
                     AND a.day_start = b.day_start
      WHERE b.bucket_end > b.bucket_start
      ORDER BY m.monitor_id, b.bucket_start
    `;

    const rows: Array<{
      monitorId: string;
      bucketStart: Date;
      bucketEnd: Date;
      daySeconds: string | number;
      monitorStatusId: string | null;
      seconds: string | number;
    }> = await this.getRepository().manager.query(sql, [
      data.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
      data.startDate,
      data.endDate,
      data.timezone || "UTC",
    ]);

    return Service.toUptimeDailyAggregate(rows, data.timezone || "UTC");
  }

  /*
   * Exported shape-only step, so the bucketing can be tested without a
   * database. One row per (monitor, day, status); a day with no coverage
   * comes back as a single row with a NULL status and zero seconds, which is
   * what makes a no-data day distinguishable from a day spent up.
   */
  public static toUptimeDailyAggregate(
    rows: Array<{
      monitorId: string;
      bucketStart: Date;
      bucketEnd: Date;
      daySeconds: string | number;
      monitorStatusId: string | null;
      seconds: string | number;
    }>,
    /*
     * The zone the SQL cut the day buckets in. It travels with the buckets
     * so a client draws its bars on the same day boundaries - see
     * UptimeDailyAggregate.timezone.
     */
    timezone: string = "UTC",
  ): UptimeDailyAggregate {
    const byMonitor: Map<string, Map<number, UptimeDayBucket>> = new Map();

    for (const row of rows) {
      let buckets: Map<number, UptimeDayBucket> | undefined = byMonitor.get(
        row.monitorId,
      );

      if (!buckets) {
        buckets = new Map<number, UptimeDayBucket>();
        byMonitor.set(row.monitorId, buckets);
      }

      const bucketStart: Date = new Date(row.bucketStart);
      const key: number = bucketStart.getTime();

      let bucket: UptimeDayBucket | undefined = buckets.get(key);

      if (!bucket) {
        bucket = {
          bucketStart: bucketStart,
          bucketEnd: new Date(row.bucketEnd),
          daySeconds: Number(row.daySeconds),
          coveredSeconds: 0,
          statusDurations: [],
        };
        buckets.set(key, bucket);
      }

      const seconds: number = Number(row.seconds);

      /*
       * A NULL status is the LEFT JOIN's "nothing overlapped this day" row.
       * It must not become a status duration, and it contributes no coverage.
       */
      if (!row.monitorStatusId || seconds <= 0) {
        continue;
      }

      bucket.coveredSeconds += seconds;
      bucket.statusDurations.push({
        monitorStatusId: new ObjectID(row.monitorStatusId),
        seconds: seconds,
      });
    }

    const monitors: Array<MonitorUptimeDailyAggregate> = [];

    for (const [monitorId, buckets] of byMonitor) {
      monitors.push({
        monitorId: new ObjectID(monitorId),
        buckets: Array.from(buckets.values()).sort(
          (a: UptimeDayBucket, b: UptimeDayBucket) => {
            return a.bucketStart.getTime() - b.bucketStart.getTime();
          },
        ),
      });
    }

    /*
     * There is no cap in this path, so the window is always fully covered.
     * The fields exist so that a bound added later has to SHOW rather than be
     * absorbed into a green bar - which is the failure this replaces.
     */
    return {
      monitors: monitors,
      isComplete: true,
      completeFrom: null,
      timezone: timezone,
    };
  }

  /**
   * Per-day status durations for MONITOR GROUPS, for the status page's
   * uptime bars: how long each group spent in each status, each day.
   *
   * WHY THIS EXISTS
   *
   * A monitor group's bars used to be painted in the browser from the
   * timeline rows the overview ships. Those rows arrive under one LIMIT_MAX
   * (10,000) across every monitor on the page, newest first, so on a page
   * with a flapping monitor they hold only the last few days of the window.
   * And the browser merged them by comparing each row with the last one it
   * kept, so a finished day of a group added up to sixteen hours on one day
   * and to nine days on another (issue #6697). getDailyUptimeAggregate has
   * no cap, but it sums each monitor on its own, and a group is not the sum
   * of its monitors: two monitors Offline over the same hour are one hour of
   * the group's, not two.
   *
   * WHAT IT COUNTS
   *
   * At every instant a group is in the worst status among its monitors
   * recorded then - the docs' "one monitor going Offline makes the whole
   * group Offline". Worst is the order `rankedMonitorStatusIds` gives, the
   * worst last: the page's downtime statuses above every other, each part in
   * the project's priority order (MonitorGroupUptimeDailyAggregateUtil.
   * getRankedMonitorStatusIds). So the time a day spends in a downtime status
   * is exactly the time at least one monitor was down - what
   * getMergedDowntimeSeconds counts over the window, which the group's
   * uptime percentage is read from - and a day's durations add up to the time
   * at least one monitor was recorded, never more than the day. A status not
   * in the list is left out.
   *
   * The rows, and where each one ends, are exactly getDailyUptimeAggregate's
   * src CTE, and the day grid is its buckets CTE, so a group's bars line up
   * with every monitor's.
   *
   * THE MERGE
   *
   * The worst status covers an instant at level k or above exactly when a
   * period of rank k or above covers it. So for each level k the day's union
   * of the periods ranked k or above, U(k), is the time spent at k or worse,
   * and the time spent at exactly k is U(k) - U(k + 1). U(1) is the day's
   * coverage. Each union is getMergedDowntimeSeconds' running MAX(end): every
   * period adds only what reaches past the latest end before it, in start
   * order. One window pass over each group's day computes every level's
   * union (getMonitorGroupDailyUptimeAggregateSql).
   *
   * Groups are numbered by their place in `monitorGroups`, and the window is
   * partitioned by that integer rather than by the group id's text, which
   * would sort on a collated key.
   *
   * Checked against a reference written apart from it - the rows merged by
   * WorstStatusTimeline and cut into the strip's days - on drawn timelines
   * in seven zones, and against getMergedDowntimeSeconds over the window
   * (MonitorGroupDailyUptimePostgres.test.ts).
   *
   * Seconds are double precision and never rounded, as in the aggregate.
   */
  @CaptureSpan()
  public async getMonitorGroupDailyUptimeAggregate(data: {
    monitorGroups: Array<{
      monitorGroupId: ObjectID;
      monitorIds: Array<ObjectID>;
    }>;
    rankedMonitorStatusIds: Array<ObjectID | string>;
    startDate: Date;
    endDate: Date;
    timezone?: string | undefined;
  }): Promise<MonitorGroupUptimeDailyAggregate> {
    const timezone: string = data.timezone || "UTC";

    if (data.monitorGroups.length === 0) {
      return { monitorGroups: [], timezone: timezone };
    }

    const groupKeys: Array<number> = [];
    const memberMonitorIds: Array<string> = [];

    data.monitorGroups.forEach(
      (
        monitorGroup: { monitorGroupId: ObjectID; monitorIds: Array<ObjectID> },
        index: number,
      ) => {
        for (const monitorId of monitorGroup.monitorIds) {
          groupKeys.push(index + 1);
          memberMonitorIds.push(monitorId.toString());
        }
      },
    );

    const rankedMonitorStatusIds: Array<string> =
      data.rankedMonitorStatusIds.map((id: ObjectID | string): string => {
        return id.toString();
      });

    const sql: string = Service.getMonitorGroupDailyUptimeAggregateSql({
      levelCount: rankedMonitorStatusIds.length,
    });

    const rows: Array<MonitorGroupDailyUptimeRow> =
      await this.getRepository().manager.query(sql, [
        groupKeys,
        memberMonitorIds,
        data.startDate,
        data.endDate,
        timezone,
        rankedMonitorStatusIds,
        data.monitorGroups.length,
      ]);

    return Service.toMonitorGroupUptimeDailyAggregate({
      rows: rows,
      monitorGroupIds: data.monitorGroups.map(
        (monitorGroup: { monitorGroupId: ObjectID }): ObjectID => {
          return monitorGroup.monitorGroupId;
        },
      ),
      rankedMonitorStatusIds: rankedMonitorStatusIds,
      timezone: timezone,
    });
  }

  /*
   * The statement getMonitorGroupDailyUptimeAggregate runs, for a project
   * with `levelCount` ranked statuses. Public so its shape can be pinned
   * without a database.
   *
   * Parameters: $1 int[] and $2 uuid[], each group's number (its place in
   * the request, from 1) beside one of its monitors; $3 and $4 the window;
   * $5 the zone; $6 uuid[] the ranked statuses, the worst last; $7 how many
   * groups there are.
   *
   * Only integers go into its text - one column per level - never an id or
   * a name: those are all parameters.
   *
   * THE DAY GRID. The local midnights of the window's days are worked out
   * once, as the aggregate's buckets CTE works them out, into one array, and
   * each period finds its first and last day in it with width_bucket, a
   * binary search. A period inside one day - nearly every row of a flapping
   * monitor - is one segment, with no per-row zone conversion and no
   * generate_series; only a period that crosses midnight is fanned out, one
   * segment per day. Converting every row's start and end to the zone and
   * calling generate_series for it, as the aggregate does, was most of the
   * statement's time: 1.1M rows of three monitors flapping every 20 seconds
   * took 4.0 s that way and take 1.9 s this way.
   *
   * THE MERGE. One window pass over each group's day, in start order, keeps
   * a running MAX(end) per level - over the periods ranked at or above it,
   * by a FILTER - and each period adds to a level's union what reaches past
   * that level's running end. Counting each period once per level, in a
   * window per level, sorted twice as many rows and took a third longer.
   */
  public static getMonitorGroupDailyUptimeAggregateSql(data: {
    levelCount: number;
  }): string {
    const levelCount: number = Math.max(1, Math.floor(data.levelCount) || 0);

    const reachedColumns: Array<string> = [];
    const unionColumns: Array<string> = [];

    for (let level: number = 1; level <= levelCount; level++) {
      const filter: string =
        level === 1 ? "" : ` FILTER (WHERE status_rank >= ${level})`;

      reachedColumns.push(
        `MAX(seg_end)${filter} OVER earlier AS reached_${level}`,
      );
      unionColumns.push(
        `COALESCE(SUM(GREATEST(EXTRACT(EPOCH FROM (seg_end - GREATEST(seg_start, COALESCE(reached_${level}, seg_start)))), 0))${filter}, 0)`,
      );
    }

    return `
      WITH params AS (
        SELECT $3::timestamptz AS win_start,
               LEAST($4::timestamptz, now()) AS eff_end,
               $5::text AS tz
      ),
      grid AS (
        SELECT array_agg((d AT TIME ZONE p.tz) ORDER BY d) AS starts
        FROM params p,
             generate_series(
               date_trunc('day', p.win_start AT TIME ZONE p.tz),
               date_trunc('day', p.eff_end AT TIME ZONE p.tz) + interval '1 day',
               interval '1 day'
             ) AS d
      ),
      members AS (
        SELECT DISTINCT m.group_key, m.monitor_id
        FROM UNNEST($1::int[], $2::uuid[]) AS m(group_key, monitor_id)
      ),
      ranks AS (
        SELECT r.status_id, r.status_rank::int AS status_rank
        FROM UNNEST($6::uuid[]) WITH ORDINALITY AS r(status_id, status_rank)
      ),
      src AS (
        SELECT t."monitorId" AS monitor_id,
               t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               GREATEST(t."startsAt", p.win_start) AS s,
               LEAST(
                 COALESCE(
                   t."endsAt",
                   LEAD(t."startsAt") OVER (
                     PARTITION BY t."monitorId"
                     ORDER BY t."startsAt", t."endsAt" NULLS LAST
                   ),
                   p.eff_end
                 ),
                 p.eff_end
               ) AS e
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        WHERE t."monitorId" = ANY($2::uuid[])
          AND t."deletedAt" IS NULL
          AND t."startsAt" <= p.eff_end
          AND (t."endsAt" >= p.win_start OR t."endsAt" IS NULL)
      ),
      periods AS (
        SELECT mb.group_key,
               rk.status_rank,
               src.s,
               src.e,
               width_bucket(src.s, g.starts) AS first_day,
               width_bucket(src.e - interval '1 microsecond', g.starts) AS last_day
        FROM src
        JOIN members mb ON mb.monitor_id = src.monitor_id
        JOIN ranks rk ON rk.status_id = src.status_id
        CROSS JOIN grid g
        WHERE src.e > src.s
          AND NOT src.is_off
      ),
      split AS (
        SELECT group_key,
               status_rank,
               first_day AS day_index,
               s AS seg_start,
               e AS seg_end
        FROM periods
        WHERE first_day = last_day
        UNION ALL
        SELECT pr.group_key,
               pr.status_rank,
               di AS day_index,
               GREATEST(pr.s, g.starts[di]) AS seg_start,
               LEAST(pr.e, g.starts[di + 1]) AS seg_end
        FROM periods pr
        CROSS JOIN grid g,
        LATERAL generate_series(pr.first_day, pr.last_day) AS di
        WHERE pr.first_day <> pr.last_day
      ),
      reach AS (
        SELECT group_key,
               day_index,
               status_rank,
               seg_start,
               seg_end,
               ${reachedColumns.join(",\n               ")}
        FROM split
        WHERE seg_end > seg_start
        WINDOW earlier AS (
          PARTITION BY group_key, day_index
          ORDER BY seg_start, seg_end
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        )
      ),
      day_unions AS (
        SELECT group_key,
               day_index,
               ARRAY[
                 ${unionColumns.join(",\n                 ")}
               ]::double precision[] AS unions
        FROM reach
        GROUP BY group_key, day_index
      ),
      days AS (
        SELECT di AS day_index,
               GREATEST(g.starts[di], p.win_start) AS bucket_start,
               LEAST(g.starts[di + 1], p.eff_end) AS bucket_end
        FROM grid g
        CROSS JOIN params p,
        LATERAL generate_series(1, array_length(g.starts, 1) - 1) AS di
      )
      SELECT gk.group_key AS "groupKey",
             d.bucket_start AS "bucketStart",
             d.bucket_end AS "bucketEnd",
             EXTRACT(EPOCH FROM (d.bucket_end - d.bucket_start))::bigint
               AS "daySeconds",
             u.unions AS "unions"
      FROM generate_series(1, $7::int) AS gk(group_key)
      CROSS JOIN days d
      LEFT JOIN day_unions u ON u.group_key = gk.group_key
                            AND u.day_index = d.day_index
      WHERE d.bucket_end > d.bucket_start
      ORDER BY gk.group_key, d.bucket_start
    `;
  }

  /*
   * Shape-only step, public so the arithmetic can be tested without a
   * database. One row per (group, day): the day's unions U(1), U(2), ... -
   * U(level) the union of the group's periods ranked `level` or above - or
   * NULL for a day nothing of the group overlapped.
   *
   * The time at exactly level k is U(k) - U(k + 1), and the coverage is
   * U(1). The unions are separate sums of doubles, so two levels covering
   * the same time can differ in their last bits: a difference below a
   * microsecond is no time at all, and one below zero is clamped away. Every
   * group asked for comes back, in the order asked, with a bucket for every
   * day.
   */
  public static toMonitorGroupUptimeDailyAggregate(data: {
    rows: Array<MonitorGroupDailyUptimeRow>;
    monitorGroupIds: Array<ObjectID>;
    rankedMonitorStatusIds: Array<string>;
    timezone: string;
  }): MonitorGroupUptimeDailyAggregate {
    const bucketsByGroup: Array<Map<number, UptimeDayBucket>> =
      data.monitorGroupIds.map((): Map<number, UptimeDayBucket> => {
        return new Map<number, UptimeDayBucket>();
      });

    for (const row of data.rows) {
      const buckets: Map<number, UptimeDayBucket> | undefined =
        bucketsByGroup[Number(row.groupKey) - 1];

      if (!buckets) {
        continue;
      }

      const bucketStart: Date = new Date(row.bucketStart);
      const bucketEnd: Date = new Date(row.bucketEnd);

      if (
        Number.isNaN(bucketStart.getTime()) ||
        Number.isNaN(bucketEnd.getTime())
      ) {
        continue;
      }

      const unions: Array<number> = Array.isArray(row.unions)
        ? row.unions.map((value: string | number | null): number => {
            const seconds: number = Number(value);
            return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
          })
        : [];

      const unionAt: (level: number) => number = (level: number): number => {
        return unions[level - 1] || 0;
      };

      const bucket: UptimeDayBucket = {
        bucketStart: bucketStart,
        bucketEnd: bucketEnd,
        daySeconds: Number(row.daySeconds) || 0,
        coveredSeconds: unionAt(1),
        statusDurations: [],
      };

      for (
        let level: number = 1;
        level <= data.rankedMonitorStatusIds.length;
        level++
      ) {
        const seconds: number = unionAt(level) - unionAt(level + 1);

        if (!(seconds >= MINIMUM_GROUP_STATUS_SECONDS)) {
          continue;
        }

        bucket.statusDurations.push({
          monitorStatusId: new ObjectID(
            data.rankedMonitorStatusIds[level - 1]!,
          ),
          seconds: seconds,
        });
      }

      buckets.set(bucketStart.getTime(), bucket);
    }

    return {
      monitorGroups: data.monitorGroupIds.map(
        (monitorGroupId: ObjectID, index: number): MonitorGroupUptimeDaily => {
          return {
            monitorGroupId: monitorGroupId,
            buckets: Array.from(bucketsByGroup[index]!.values()).sort(
              (a: UptimeDayBucket, b: UptimeDayBucket): number => {
                return a.bucketStart.getTime() - b.bucketStart.getTime();
              },
            ),
          };
        },
      ),
      timezone: data.timezone,
    };
  }

  /**
   * How long a SET of monitors was down over [startDate, endDate]: the time
   * at least one of them was in a downtime status, and the time at least one
   * of them was recorded at all, so the caller can take a percentage.
   *
   * WHY THIS EXISTS
   *
   * The status page report's page and group downtime, and the uptime of a
   * monitor-group resource in the report and the uptime endpoint, merged the
   * rows of getMonitorStatusTimelineForStatusPage. Those arrive under one
   * LIMIT_MAX (10,000) across every monitor on the page, newest first, and
   * status.chainflip.io matched 255,733 rows in 60 days - so every merged
   * figure covered only the newest few days. getDailyUptimeAggregate has no
   * cap, but it sums each monitor on its own, and per-monitor sums cannot
   * say when at least one monitor was down: two monitors down over the same
   * hour are one hour of downtime for their group, and over different hours
   * two.
   *
   * WHAT IT COUNTS
   *
   * The rows, and where each one ends, are exactly getDailyUptimeAggregate's
   * src CTE: the same inclusive overlap predicate, deleted rows ignored,
   * everything clipped to [startDate, LEAST(endDate, now())], and an open row
   * capped at the next row's start, `ORDER BY startsAt, endsAt NULLS LAST`.
   * For a single monitor the two agree exactly, unless two of its own rows
   * overlap (deleting a row from the middle of a timeline used to leave
   * that, see getRollingUptimeTotals): the aggregate counts the overlap
   * twice, and a union once.
   *
   * Downtime statuses are picked out AFTER that LEAD, never before it.
   * Filtered first, an open Offline row would run on to the next Offline
   * row's start, across the Operational rows in between. So are the rows
   * that mark a monitor's monitoring off, which cover nothing (see
   * getDailyUptimeAggregate): the group is recorded at an instant when one
   * of its monitors was checked then.
   *
   * THE MERGE
   *
   * Every monitor's periods are taken in start order, and each period adds
   * only what it reaches past the latest end of the periods before it (a
   * running MAX(end)). One that starts after that point opens a new island
   * and adds its whole length; one that starts inside it adds the part that
   * sticks out, or nothing. The sum is the length of the union, which is
   * what numbering the islands and adding them up would give, without the
   * second window pass - and it does not depend on how tied periods are
   * ordered. Coverage and downtime are merged in the same pass; downtime's
   * running end is taken over downtime periods only.
   *
   * The union is the intended meaning of a merged figure. The rows used to
   * be merged by UptimeUtil.getNonOverlappingMonitorEvents, a priority
   * heuristic that undercounts: a later-starting, longer-running Operational
   * row of another monitor truncates an earlier Offline row. With A Offline
   * from 00:00 to 10:00 and B Operational from 02:00 to 20:00 it counts two
   * hours down, where A alone was down for ten.
   *
   * Seconds are double precision and never rounded, as in the aggregate.
   *
   * Checked against Postgres with randomised timelines - orphaned open rows,
   * backfill ties, gaps, overlaps, deleted, corrupt and future rows - and a
   * sweep-line union written separately: exact in every one of 3,300
   * windows. It reads the same rows the aggregate reads for those monitors
   * and sorts their periods once instead of splitting them into days; on a
   * 290k-row page with a monitor flapping every 20 s it ran in about two
   * thirds of the aggregate's time.
   */
  @CaptureSpan()
  public async getMergedDowntimeSeconds(data: {
    monitorIds: Array<ObjectID>;
    downtimeMonitorStatusIds: Array<ObjectID | string>;
    startDate: Date;
    endDate: Date;
  }): Promise<MergedDowntimeTotals> {
    if (data.monitorIds.length === 0) {
      return {
        coveredSeconds: 0,
        downtimeSeconds: 0,
      };
    }

    const sql: string = `
      WITH params AS (
        SELECT $2::timestamptz AS win_start,
               LEAST($3::timestamptz, now()) AS eff_end
      ),
      src AS (
        SELECT t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               GREATEST(t."startsAt", p.win_start) AS s,
               LEAST(
                 COALESCE(
                   t."endsAt",
                   LEAD(t."startsAt") OVER (
                     PARTITION BY t."monitorId"
                     ORDER BY t."startsAt", t."endsAt" NULLS LAST
                   ),
                   p.eff_end
                 ),
                 p.eff_end
               ) AS e
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        WHERE t."monitorId" = ANY($1::uuid[])
          AND t."deletedAt" IS NULL
          AND t."startsAt" <= p.eff_end
          AND (t."endsAt" >= p.win_start OR t."endsAt" IS NULL)
      ),
      periods AS (
        SELECT s,
               e,
               status_id = ANY($4::uuid[]) AS is_downtime
        FROM src
        WHERE e > s
          AND NOT is_off
      ),
      reach AS (
        SELECT s,
               e,
               is_downtime,
               MAX(e) OVER earlier AS covered_until,
               MAX(e) FILTER (WHERE is_downtime) OVER earlier AS down_until
        FROM periods
        WINDOW earlier AS (
          ORDER BY s, e
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        )
      )
      SELECT COALESCE(
               SUM(
                 GREATEST(
                   EXTRACT(EPOCH FROM (e - GREATEST(s, COALESCE(covered_until, s)))),
                   0
                 )
               ),
               0
             )::double precision AS "coveredSeconds",
             COALESCE(
               SUM(
                 GREATEST(
                   EXTRACT(EPOCH FROM (e - GREATEST(s, COALESCE(down_until, s)))),
                   0
                 )
               ) FILTER (WHERE is_downtime),
               0
             )::double precision AS "downtimeSeconds"
      FROM reach
    `;

    const rows: Array<MergedDowntimeRow> =
      await this.getRepository().manager.query(sql, [
        data.monitorIds.map((id: ObjectID): string => {
          return id.toString();
        }),
        data.startDate,
        data.endDate,
        data.downtimeMonitorStatusIds.map((id: ObjectID | string): string => {
          return id.toString();
        }),
      ]);

    return Service.toMergedDowntimeTotals(rows);
  }

  /*
   * Shape-only step, public so it can be tested without a database. The SQL
   * always returns one row; a missing row, or a value that is not a
   * positive number, reads as zero.
   */
  public static toMergedDowntimeTotals(
    rows: Array<MergedDowntimeRow>,
  ): MergedDowntimeTotals {
    const coveredSeconds: number = Number(rows[0]?.coveredSeconds);
    const downtimeSeconds: number = Number(rows[0]?.downtimeSeconds);

    return {
      coveredSeconds: coveredSeconds > 0 ? coveredSeconds : 0,
      downtimeSeconds: downtimeSeconds > 0 ? downtimeSeconds : 0,
    };
  }

  /**
   * Per-status seconds and covered seconds for ONE monitor over several
   * windows that all end at `endDate` - the monitor overview's rolling 24h,
   * 7d and 30d figures - read in one statement.
   *
   * WHY IT IS NOT getDailyUptimeAggregate PER WINDOW
   *
   * It used to be: one aggregate call per window, each summed from its own
   * day buckets. That SQL can only hand the (monitorId, startsAt) index an
   * upper bound (`startsAt <= end`). Its lower bound is on `endsAt`, which
   * that index does not hold, so every call - the 24 hour one included -
   * read every row the monitor has ever had. Nothing deletes old timeline
   * rows, and the overview reloads the summary as the monitor changes
   * status, so a monitor that has flapped for two years paid for three extra
   * full-history reads per reload, next to the one the bars already make.
   *
   * WHAT IT COUNTS
   *
   * Per window, the rows and how each is clipped are exactly
   * getDailyUptimeAggregate's src CTE: the same inclusive overlap predicate,
   * deleted rows ignored, the end clamped to now(), and an open row capped at
   * the start of the next row that overlaps THE SAME WINDOW. That last part
   * is why the rows are fanned out per window before the LEAD rather than
   * given one LEAD: an orphaned open row followed by a row that closed before
   * a window started runs on to the first row inside that window, as it
   * would in that window's own aggregate call. Seconds are summed as double
   * precision and never rounded. There is no day split: splitting a period
   * into days and adding the days back up gives the same total, and a
   * rolling window has no day boundaries to report. A row that marks the
   * monitor's monitoring off is dropped after the LEAD, as the aggregate
   * drops it, so a window with monitoring off is measured over the rest.
   *
   * On an exact startsAt tie a closed row sorts before an open one. The
   * aggregate leaves ties in whatever order the plan produces; putting the
   * open row last means the zero-length row that closePrecedingStatusTimeline
   * leaves on a backfill tie cannot cut the open row short.
   *
   * The fan-out is partitioned and grouped by each window's ordinal, not its
   * key. Sorting tens of thousands of rows on a collated text key was most of
   * the statement's time.
   *
   * THE LOWER BOUND
   *
   * The rows are read from the start of the newest live row that began
   * before the widest window (rows tied with it included), plus every open
   * row older than that. The start is one backward step down (monitorId,
   * startsAt), and the read is a range scan on the same index, so its cost
   * follows the window rather than the monitor's age. The older open rows
   * are orphans a racing writer left behind. The newest of them runs on until
   * the next row that overlaps a window, so they cannot be dropped. The
   * planner finds them with a BitmapAnd of the (monitorId, startsAt) and
   * (endsAt) indexes, which reads index pages but none of the old rows.
   *
   * Checked against a synthetic 800k-row table, with a 200k-row monitor,
   * orphans, gaps, ties and deleted rows. Per window and status, this
   * agreed with getDailyUptimeAggregate to within 1e-9 s, in four zones. One
   * statement read about 1.7k buffers, where each of the three aggregate
   * calls it replaces read 10k.
   *
   * That row set is exactly what the aggregate reads while no closed row
   * ends after a later row starts. The write paths keep that: create closes
   * the preceding row at the new row's start, and a backfilled row gets the
   * next row's start as its end, and deleting a row from the middle of a
   * timeline runs the preceding row on to the next row's start
   * (MonitorStatusEventDelete). That delete used to move the next row's
   * start back to the deleted row's start as well, so the two overlapped
   * across the deleted span, and rows it wrote then still do. Where such an
   * overlap straddles the widest window's start, the aggregate counts it
   * twice, reporting more than 100% coverage, and this counts it once, from
   * the newer row.
   */
  @CaptureSpan()
  public async getRollingUptimeTotals(data: {
    monitorId: ObjectID;
    windows: Array<RollingUptimeWindowRequest>;
    endDate: Date;
  }): Promise<Array<MonitorUptimeWindowTotal>> {
    if (data.windows.length === 0) {
      return [];
    }

    const sql: string = `
      WITH params AS (
        SELECT LEAST($2::timestamptz, now()) AS eff_end
      ),
      windows AS (
        SELECT w.window_key, w.win_start, w.window_no
        FROM UNNEST($3::text[], $4::timestamptz[])
             WITH ORDINALITY AS w(window_key, win_start, window_no)
      ),
      widest AS (
        SELECT MIN(win_start) AS win_start FROM windows
      ),
      lower_bound AS (
        SELECT COALESCE(
                 (
                   SELECT MAX(t."startsAt")
                   FROM "MonitorStatusTimeline" t
                   WHERE t."monitorId" = $1::uuid
                     AND t."deletedAt" IS NULL
                     AND t."startsAt" < wd.win_start
                 ),
                 wd.win_start
               ) AS starts_from
        FROM widest wd
      ),
      src_rows AS (
        SELECT t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               t."startsAt" AS starts_at,
               t."endsAt" AS ends_at
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        CROSS JOIN widest wd
        WHERE t."monitorId" = $1::uuid
          AND t."deletedAt" IS NULL
          AND t."startsAt" >= (SELECT starts_from FROM lower_bound)
          AND t."startsAt" <= p.eff_end
          AND (t."endsAt" >= wd.win_start OR t."endsAt" IS NULL)
        UNION ALL
        SELECT t."monitorStatusId" AS status_id,
               t."isMonitoringOff" IS TRUE AS is_off,
               t."startsAt" AS starts_at,
               t."endsAt" AS ends_at
        FROM "MonitorStatusTimeline" t
        CROSS JOIN params p
        WHERE t."monitorId" = $1::uuid
          AND t."deletedAt" IS NULL
          AND t."endsAt" IS NULL
          AND t."startsAt" < (SELECT starts_from FROM lower_bound)
          AND t."startsAt" <= p.eff_end
      ),
      src AS (
        SELECT w.window_no,
               r.status_id,
               r.is_off,
               GREATEST(r.starts_at, w.win_start) AS s,
               LEAST(
                 COALESCE(
                   r.ends_at,
                   LEAD(r.starts_at) OVER (
                     PARTITION BY w.window_no
                     ORDER BY r.starts_at, r.ends_at NULLS LAST
                   ),
                   p.eff_end
                 ),
                 p.eff_end
               ) AS e
        FROM src_rows r
        CROSS JOIN windows w
        CROSS JOIN params p
        WHERE r.ends_at >= w.win_start OR r.ends_at IS NULL
      ),
      agg AS (
        SELECT window_no,
               status_id,
               SUM(EXTRACT(EPOCH FROM (e - s)))::double precision AS seconds
        FROM src
        WHERE e > s
          AND NOT is_off
        GROUP BY window_no, status_id
      )
      SELECT w.window_key AS "windowKey",
             GREATEST(EXTRACT(EPOCH FROM (p.eff_end - w.win_start)), 0)
               ::double precision AS "windowSeconds",
             a.status_id AS "monitorStatusId",
             COALESCE(a.seconds, 0)::double precision AS "seconds"
      FROM windows w
      CROSS JOIN params p
      LEFT JOIN agg a ON a.window_no = w.window_no
      ORDER BY w.window_no, a.status_id
    `;

    const rows: Array<RollingUptimeTotalRow> =
      await this.getRepository().manager.query(sql, [
        data.monitorId.toString(),
        data.endDate,
        data.windows.map((window: RollingUptimeWindowRequest): string => {
          return window.key;
        }),
        data.windows.map((window: RollingUptimeWindowRequest): string => {
          return window.startDate.toISOString();
        }),
      ]);

    return Service.toRollingUptimeTotals({
      rows: rows,
      windows: data.windows,
      endDate: data.endDate,
    });
  }

  /*
   * Shape-only step, public so it can be tested without a database. One
   * row per (window, status); a window nothing overlapped comes back as a
   * single row with a NULL status and zero seconds, so it keeps its length
   * and reads as "No data" rather than disappearing. The totals come back in
   * the order the windows were asked for.
   */
  public static toRollingUptimeTotals(data: {
    rows: Array<RollingUptimeTotalRow>;
    windows: Array<RollingUptimeWindowRequest>;
    endDate: Date;
  }): Array<MonitorUptimeWindowTotal> {
    return data.windows.map(
      (window: RollingUptimeWindowRequest): MonitorUptimeWindowTotal => {
        let windowSeconds: number = 0;
        let coveredSeconds: number = 0;
        const statusDurations: Array<UptimeStatusDuration> = [];

        for (const row of data.rows) {
          if (row.windowKey !== window.key) {
            continue;
          }

          windowSeconds = Number(row.windowSeconds);

          const seconds: number = Number(row.seconds);

          // The LEFT JOIN's "nothing overlapped" row is not a status.
          if (!row.monitorStatusId || !(seconds > 0)) {
            continue;
          }

          coveredSeconds += seconds;
          statusDurations.push({
            monitorStatusId: new ObjectID(row.monitorStatusId),
            seconds: seconds,
          });
        }

        /*
         * A rolling window is one bucket that starts mid-day. Summing it
         * through the same function as the 90d window keeps the ordering of
         * statusDurations and the handling of bad numbers identical.
         */
        return MonitorUptimeSummaryUtil.sumBuckets({
          key: window.key,
          buckets: [
            {
              bucketStart: window.startDate,
              bucketEnd: data.endDate,
              daySeconds: windowSeconds,
              coveredSeconds: coveredSeconds,
              statusDurations: statusDurations,
            },
          ],
          startDate: window.startDate,
          endDate: data.endDate,
        });
      },
    );
  }

  /**
   * The uptime history of ONE monitor for the monitor overview: 90 calendar
   * day bars, rolling 24h / 7d / 30d windows, a 90d window, and the
   * project's statuses so the page can tell downtime from uptime without a
   * MonitorStatus request of its own.
   *
   * It reads as root and does no authorisation. The route in MonitorAPI
   * decides who may see the monitor's history before calling this.
   *
   * TWO READS OF THE TIMELINE
   *
   * The bars are one getDailyUptimeAggregate call. A rolling 24 hours starts
   * in the middle of a day, which the midnight-aligned bars cannot express,
   * so the rolling windows come from getRollingUptimeTotals, which reads the
   * rows once for all three (see there for why that is not one aggregate
   * call per window). The 90d figure is summed from the bars instead, so it
   * always agrees with the strip it sits next to.
   *
   * The time zone only moves where the day boundaries fall. The rolling
   * windows are exact second counts ending at now, whatever the zone.
   */
  @CaptureSpan()
  public async getMonitorUptimeSummary(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    timezone: string;
    now: Date;
  }): Promise<MonitorUptimeSummary> {
    const now: Date = data.now;

    /*
     * Calendar arithmetic in the caller's zone, then local midnight. Taking
     * 89 x 24 hours instead would land on the wrong calendar day across a DST
     * change and hand back 89 or 91 bars.
     */
    const barsStartDate: Date = OneUptimeDate.getStartOfDay(
      OneUptimeDate.addRemoveDays(
        now,
        -(MONITOR_UPTIME_HISTORY_DAYS - 1),
        data.timezone,
      ),
      data.timezone,
    );

    const rollingWindows: Array<RollingUptimeWindowRequest> =
      MONITOR_UPTIME_ROLLING_WINDOWS.map(
        (window: MonitorUptimeRollingWindow): RollingUptimeWindowRequest => {
          return {
            key: window.key,
            startDate: OneUptimeDate.addRemoveSeconds(now, -window.seconds),
          };
        },
      );

    const [barAggregate, rollingTotals, statuses]: [
      UptimeDailyAggregate,
      Array<MonitorUptimeWindowTotal>,
      Array<MonitorStatus>,
    ] = await Promise.all([
      this.getDailyUptimeAggregate({
        monitorIds: [data.monitorId],
        startDate: barsStartDate,
        endDate: now,
        timezone: data.timezone,
      }),
      this.getRollingUptimeTotals({
        monitorId: data.monitorId,
        windows: rollingWindows,
        endDate: now,
      }),
      /*
       * Root, scoped to the project, and limited to columns every one of
       * which is canReadOnRelationQuery. The route has already proved the
       * caller can read this monitor's timeline, and a timeline read
       * exposes exactly these columns through its monitorStatus relation,
       * so nothing is disclosed that the CRUD read would not show.
       */
      MonitorStatusService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          color: true,
          isOperationalState: true,
          isOfflineState: true,
          priority: true,
        },
        sort: {
          priority: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
    ]);

    const barBuckets: Array<UptimeDayBucket> =
      UptimeDailyAggregateUtil.getBucketsForMonitor(
        barAggregate,
        data.monitorId,
      );

    const windows: Array<MonitorUptimeWindowTotal> = [...rollingTotals];

    windows.push(
      MonitorUptimeSummaryUtil.sumBuckets({
        key: MonitorUptimeWindowKey.Last90Days,
        buckets: barBuckets,
        startDate: barsStartDate,
        endDate: now,
      }),
    );

    const summaryStatuses: Array<MonitorUptimeSummaryStatus> = [];

    for (const status of statuses) {
      if (!status.id) {
        continue;
      }

      summaryStatuses.push({
        id: status.id,
        name: status.name || "",
        color: status.color ? status.color.toString() : "",
        isOperationalState: status.isOperationalState === true,
        isOfflineState: status.isOfflineState === true,
        priority:
          typeof status.priority === "number" &&
          Number.isFinite(status.priority)
            ? status.priority
            : null,
      });
    }

    return {
      monitorId: data.monitorId,
      timezone: data.timezone,
      generatedAt: now,
      startDate: barsStartDate,
      endDate: now,
      buckets: barBuckets,
      windows: windows,
      isComplete: barAggregate.isComplete,
      completeFrom: barAggregate.completeFrom,
      statuses: summaryStatuses,
    };
  }

  /*
   * The status change itself, then what follows it once the monitor's lock
   * is given back (onCreateSuccess): the network-site bridge and the feed
   * item. A create that skips the hooks moved no current status and runs
   * neither; one that fails runs neither.
   */
  @CaptureSpan()
  public override async create(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<MonitorStatusTimeline> {
    let createdItem: MonitorStatusTimeline;

    try {
      createdItem = await super.create(createBy);
    } catch (error) {
      Service.forgetMonitoringSwitchRow(createBy);
      throw error;
    }

    Service.forgetMonitoringSwitchRow(createBy);

    if (createBy.props.ignoreHooks) {
      return createdItem;
    }

    /*
     * Only the monitoring switch changed, not the status: no device to
     * stamp, no status change for the feed (monitoringSwitchCreates).
     */
    if (monitoringSwitchCreates.has(createBy)) {
      return createdItem;
    }

    /*
     * Both side effects below run AFTER the mutex is released. Only the
     * predecessor read -> INSERT -> predecessor close (plus the monitor's
     * currentMonitorStatusId write in onCreateSuccess) needs the lock, and all
     * of that has completed by this point.
     *
     * The network-site bridge goes first: it stamps the devices bound to this
     * monitor and recomputes their site rollups (which can open alerts and post
     * their own workspace notifications), and a device stamp must not wait on
     * the feed item's Slack/Teams round trip below. It is deliberately NOT run
     * from onCreateSuccess, which executes under the lock - see bridgeIfCurrent.
     */
    await this.bridgeIfCurrent(createdItem, createBy);

    /*
     * The feed item and its workspace notification can involve third-party
     * HTTP (Slack/Teams) with unbounded latency, and holding the per-monitor
     * lock across them would block every concurrent status write for this
     * monitor until acquireTimeout - turning one slow webhook into refused
     * status transitions.
     */
    await this.createStatusChangeFeedItem(createdItem, createBy);

    return createdItem;
  }

  /*
   * Marks on the monitor's status timeline that its monitoring was turned
   * off, or back on (issue #6480): a status event starts now with the status
   * the monitor holds, and isMonitoringOff saying which. Uptime, status page
   * bars, SLOs and monitor group graphs leave out the time from a status
   * event that marks it off to the next one that does not. Nothing checks
   * the monitor in between, so its status is only what the last check saw.
   *
   * MonitorService calls this once an update has turned the switch, before
   * anything the switch leads to - the incidents turning it off resolves -
   * writes a status change of its own. Nothing is written when the latest
   * status event already says what the switch says, nor for a monitor with
   * no status yet: its first status event takes the switch as it is
   * (buildOnCreate). Returns the status event written, or null.
   */
  @CaptureSpan()
  public async recordMonitoringSwitch(data: {
    monitorId: ObjectID;
    isMonitoringOff: boolean;
    // Who turned the switch, when a person did: named in the root cause.
    switchedByUserId?: ObjectID | null | undefined;
  }): Promise<MonitorStatusTimeline | null> {
    const latest: MonitorStatusTimeline | null = await this.findOneBy({
      query: {
        monitorId: data.monitorId,
      },
      sort: {
        startsAt: SortOrder.Descending,
      },
      select: {
        _id: true,
        projectId: true,
        monitorStatusId: true,
        isMonitoringOff: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!latest || !latest.projectId || !latest.monitorStatusId) {
      return null;
    }

    if ((latest.isMonitoringOff === true) === data.isMonitoringOff) {
      return null;
    }

    const switchedBy: MarkdownText = data.switchedByUserId
      ? await UserService.getUserMarkdownString({
          userId: data.switchedByUserId,
          projectId: latest.projectId,
        })
      : FeedMarkdown.empty();

    const statusEvent: MonitorStatusTimeline = new MonitorStatusTimeline();
    statusEvent.projectId = latest.projectId;
    statusEvent.monitorId = data.monitorId;
    statusEvent.monitorStatusId = latest.monitorStatusId;
    statusEvent.startsAt = OneUptimeDate.getCurrentDate();
    // The status did not change: nobody is told it did.
    statusEvent.isOwnerNotified = true;
    statusEvent.rootCause = Service.getMonitoringSwitchRootCause({
      isMonitoringOff: data.isMonitoringOff,
      switchedBy: switchedBy,
    });

    if (data.switchedByUserId) {
      statusEvent.createdByUserId = data.switchedByUserId;
    }

    try {
      return await this.create({
        data: statusEvent,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      /*
       * Another write marked the switch first, under the monitor's lock:
       * the latest status event says what this one would.
       */
      if (
        error instanceof BadDataException &&
        error.message === MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE
      ) {
        return null;
      }

      throw error;
    }
  }

  /*
   * Once a create is over, however it ended, its workflow trigger has run
   * or will not: the id of the row that marks the switch is forgotten, so a
   * later On Create for it is not held back (monitoringSwitchCreates).
   */
  private static forgetMonitoringSwitchRow(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): void {
    const switchRowId: string | undefined =
      monitoringSwitchRowIdByCreate.get(createBy);

    if (switchRowId) {
      monitoringSwitchRowIds.delete(switchRowId);
    }
  }

  /*
   * Why the status event that marks the switch starts, on the monitor's
   * Status Timeline: Markdown, with the person's name placed as text.
   */
  public static getMonitoringSwitchRootCause(data: {
    isMonitoringOff: boolean;
    switchedBy: MarkdownText;
  }): string {
    if (data.isMonitoringOff) {
      const turnedOff: MarkdownText = data.switchedBy.isEmpty()
        ? mdText`Monitoring is off.`
        : mdText`${data.switchedBy} turned off monitoring.`;

      return mdText`${turnedOff} Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`.toString();
    }

    const turnedOn: MarkdownText = data.switchedBy.isEmpty()
      ? mdText`Monitoring was turned back on.`
      : mdText`${data.switchedBy} turned monitoring back on.`;

    return mdText`${turnedOn} Uptime, status pages and SLOs count the monitor's time again from here.`.toString();
  }

  /*
   * A status event that only marks monitoring turned off or on starts no
   * workflow: no status changed (monitoringSwitchCreates). Every other
   * status event's On Create, and every update and delete, as before.
   */
  @CaptureSpan()
  public override async onTriggerWorkflow(
    id: ObjectID,
    projectId: ObjectID,
    triggerType: DatabaseTriggerType,
    miscData?: JSONObject | undefined,
  ): Promise<void> {
    if (
      triggerType === "on-create" &&
      monitoringSwitchRowIds.has(id.toString())
    ) {
      return;
    }

    return await super.onTriggerWorkflow(id, projectId, triggerType, miscData);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<OnCreate<MonitorStatusTimeline>> {
    await super.onBeforeCreate(createBy);

    /*
     * The monitor under either of its names (the two must agree, whoever
     * writes), kept in the ID column for the rest of the create and the
     * saved row: the lock is the monitor's whichever name the write used.
     */
    const monitorId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createBy.data as unknown as Record<string, unknown>,
      ["monitorId", "monitor"],
      "Monitor",
    );

    if (!monitorId) {
      throw new BadDataException("monitorId is null");
    }

    /*
     * The status, checked before the monitor's lock is taken: a write naming
     * a status that is not the project's is refused without waiting on, or
     * holding up, the monitor's other status changes.
     */
    const monitorStatusId: ObjectID = await this.checkMonitorStatus(createBy);

    const logAttributes: LogAttributes = {
      projectId: createBy.data.projectId?.toString(),
      monitorId: monitorId.toString(),
    } as LogAttributes;

    /*
     * The per-monitor mutex serializes this read-modify-write: the read of
     * the predecessor here through the close of it in onCreateSuccess, so
     * two writers for one monitor can never both resolve the same
     * predecessor. Taken here - once DatabaseService has checked the caller,
     * so a refused write takes no lock - and given back in onCreateSuccess
     * once the predecessor is closed and the monitor's status written, or in
     * onCreateError for a create refused or failed after this hook.
     */
    const mutex: SemaphoreMutex = await this.lockMonitor(
      monitorId,
      logAttributes,
    );

    try {
      const onCreate: OnCreate<MonitorStatusTimeline> =
        await this.buildOnCreate(
          createBy,
          monitorId,
          monitorStatusId,
          logAttributes,
        );

      onCreate.carryForward.mutex = mutex;

      return onCreate;
    } catch (error) {
      /*
       * Refused by this hook, once the lock is taken: no create follows to
       * give it back.
       */
      await StateChangeLock.giveBack(mutex, logAttributes);

      throw error;
    }
  }

  /*
   * The monitor's lock, or a refusal. Fail closed: this used to fall
   * through and INSERT UNLOCKED, which let two concurrent writers resolve
   * the same predecessor row, both pass the same-as-previous check, and both
   * INSERT a status row milliseconds apart. Only the later row is ever closed
   * (the next writer resolves its predecessor with ORDER BY startsAt DESC
   * LIMIT 1), so the earlier row is orphaned with endsAt = NULL permanently
   * and is read back as unbounded downtime. Refusing the write is strictly
   * safer: the monitor keeps its current status and the next probe result
   * for the same monitor re-evaluates the same criteria and recreates the
   * status change.
   */
  private async lockMonitor(
    monitorId: ObjectID,
    logAttributes: LogAttributes,
  ): Promise<SemaphoreMutex> {
    try {
      return await Semaphore.lock({
        key: monitorId.toString(),
        namespace: "MonitorStatusTimeline.create",
      });
    } catch (e) {
      logger.error(e, logAttributes);
      throw new ServerException(MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE);
    }
  }

  /*
   * The status the write names, under either of its names (the two must
   * agree), held to the project.
   */
  private async checkMonitorStatus(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<ObjectID> {
    const monitorStatusId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ["monitorStatusId", "monitorStatus"],
      "Monitor Status",
    );

    if (!monitorStatusId) {
      throw new BadDataException("monitorStatusId is null");
    }

    /*
     * Every writer of this table funnels through here, so this is the one place
     * that can turn issue #3039's failure mode into an answer. A monitorStatusId
     * that does not exist (or belongs to another project) used to travel all the
     * way to Postgres and come back as
     *   insert or update on table "MonitorStatusTimeline" violates foreign key
     *   constraint "FK_574feb4161c5216c2c7ee0faaf8"
     * — an opaque 500 over the API, and a job that fails and retries forever in
     * the probe worker. Reject it here instead, naming the id.
     *
     * The probe/telemetry ingest callers screen the id themselves before they
     * get here (Utils/Monitor/MonitorStatusTimeline and Utils/Monitor/MonitorResource)
     * so a monitor whose stored criteria already point at a deleted status skip
     * the status change rather than failing their whole run. This check is the
     * backstop for everything else, chiefly direct API writes.
     */
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: createBy.props.tenantId || createBy.data.projectId,
      subject: "monitor status timeline",
      references: [
        {
          modelName: "Monitor Status",
          id: monitorStatusId,
          service: MonitorStatusService,
        },
      ],
    });

    return monitorStatusId;
  }

  /*
   * Body of onBeforeCreate, split out to keep the null-narrowing of monitorId in
   * one place: it is passed in already narrowed so it can never reach a query as
   * undefined, which would widen the query to every monitor.
   */
  private async buildOnCreate(
    createBy: CreateBy<MonitorStatusTimeline>,
    monitorId: ObjectID,
    monitorStatusId: ObjectID,
    logAttributes: LogAttributes,
  ): Promise<OnCreate<MonitorStatusTimeline>> {
    if (!createBy.data.startsAt) {
      createBy.data.startsAt = OneUptimeDate.getCurrentDate();
    }

    // Who made the change, under either name of it: see CreatedByUser.
    const changedByUserId: ObjectID | null = CreatedByUser.getId(
      createBy.data,
      createBy.props,
    );

    if (changedByUserId && !createBy.data.rootCause) {
      createBy.data.rootCause =
        mdText`Monitor status created by ${await UserService.getUserMarkdownString(
          {
            userId: changedByUserId,
            projectId: createBy.data.projectId || createBy.props.tenantId!,
          },
        )}`.toString();
    }

    const stateBeforeThis: MonitorStatusTimeline | null = await this.findOneBy({
      query: {
        monitorId: monitorId,
        startsAt: QueryHelper.lessThanEqualTo(createBy.data.startsAt),
      },
      sort: {
        startsAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
      select: {
        monitorStatusId: true,
        startsAt: true,
        endsAt: true,
        isMonitoringOff: true,
      },
    });

    logger.debug("State Before this", logAttributes);
    logger.debug(stateBeforeThis, logAttributes);

    // If this is the first state, then do not notify the owner.
    if (!stateBeforeThis) {
      // since this is the first status, do not notify the owner.
      createBy.data.isOwnerNotified = true;
    }

    const stateAfterThis: MonitorStatusTimeline | null = await this.findOneBy({
      query: {
        monitorId: monitorId,
        startsAt: QueryHelper.greaterThan(createBy.data.startsAt),
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
      select: {
        monitorStatusId: true,
        startsAt: true,
        endsAt: true,
        isMonitoringOff: true,
      },
    });

    // Whether the monitor's monitoring is off for the time this row covers.
    const isMonitoringOff: boolean = await this.isMonitoringOffForNewRow({
      monitorId: monitorId,
      stateBeforeThis: stateBeforeThis,
      stateAfterThis: stateAfterThis,
    });

    createBy.data.isMonitoringOff = isMonitoringOff;

    /*
     * check if this new state and the previous state are same.
     * if yes, then throw bad data exception.
     *
     * The same status is a change of its own when the monitoring switch
     * differs: the row then marks monitoring turned off or back on
     * (recordMonitoringSwitch). Nobody is told of it as a status change
     * (monitoringSwitchCreates).
     */

    if (stateBeforeThis && stateBeforeThis.monitorStatusId && monitorStatusId) {
      const isSameStatus: boolean =
        stateBeforeThis.monitorStatusId.toString() ===
        monitorStatusId.toString();

      if (
        isSameStatus &&
        (stateBeforeThis.isMonitoringOff === true) === isMonitoringOff
      ) {
        /*
         * Logged above debug on purpose. This is the exact point at which an
         * orphaned (endsAt = NULL) row would have been created had the mutex
         * fallen through unlocked, so it is the signal to alert on: a sustained
         * rate here means two writers are racing for the same monitor.
         */
        logger.warn(
          `MonitorStatusTimeline: rejecting duplicate status ${monitorStatusId.toString()} for monitor ${monitorId.toString()}. The preceding status starting at ${stateBeforeThis.startsAt?.toString()} is already this status.`,
          logAttributes,
        );

        throw new BadDataException(
          MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
        );
      }

      // The same status, the switch turned: the row marks only that.
      if (isSameStatus) {
        monitoringSwitchCreates.add(createBy);
        createBy.data.isOwnerNotified = true;
      }
    }

    // compute ends at. It's the start of the next status.
    if (stateAfterThis && stateAfterThis.startsAt) {
      createBy.data.endsAt = stateAfterThis.startsAt;
    }

    /*
     * check if this new state and the previous state are same.
     * if yes, then throw bad data exception.
     */

    if (stateAfterThis && stateAfterThis.monitorStatusId && monitorStatusId) {
      if (
        stateAfterThis.monitorStatusId.toString() ===
          monitorStatusId.toString() &&
        (stateAfterThis.isMonitoringOff === true) === isMonitoringOff
      ) {
        throw new BadDataException(
          "Monitor Status cannot be same as next status.",
        );
      }
    }

    logger.debug("State After this", logAttributes);
    logger.debug(stateAfterThis, logAttributes);

    return {
      createBy,
      carryForward: {
        statusTimelineBeforeThisStatus: stateBeforeThis || null,
        statusTimelineAfterThisStatus: stateAfterThis || null,
      },
    };
  }

  /*
   * Whether the monitor's monitoring is off for the time a new row covers
   * (MonitorStatusTimeline.isMonitoringOff), decided by OneUptime whoever
   * writes the row:
   *
   *   - A row with a row after it is written into the timeline's past, over
   *     time the row before it covered: it takes that row's switch, since
   *     turning the switch starts a row of its own (recordMonitoringSwitch).
   *     Before the monitor's first row, the first row's.
   *   - A row with none after it starts the monitor's current status: it
   *     takes the monitor's switch as it is now. A status change while
   *     monitoring is off - an incident resolved by hand, a manual monitor's
   *     status set - is not checked either.
   */
  private async isMonitoringOffForNewRow(data: {
    monitorId: ObjectID;
    stateBeforeThis: MonitorStatusTimeline | null;
    stateAfterThis: MonitorStatusTimeline | null;
  }): Promise<boolean> {
    if (data.stateAfterThis) {
      return (
        (data.stateBeforeThis || data.stateAfterThis).isMonitoringOff === true
      );
    }

    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: MONITORING_OFF_SELECT,
      props: {
        isRoot: true,
      },
    });

    return MonitoringOff.isOff(monitor);
  }

  /*
   * Closes the status timeline row that precedes the row we just created.
   *
   * The update is conditional instead of a blind updateOneById: it only touches
   * the row if it starts at or before the new row (startsAt <= endsAt) and is
   * either still open or currently closed at or after the new row's startsAt
   * (endsAt >= :endsAt OR endsAt IS NULL). That keeps a concurrent or
   * out-of-order writer from extending a row forward over a gap it does not own,
   * and keeps a backfilled row from being closed at a time earlier than the row
   * that actually follows it.
   *
   * startsAt uses <= and not <: on an exact startsAt tie (a backfill inserted at
   * the same timestamp as the open predecessor) the predecessor must still be
   * closed - at zero duration, which is harmless. With a strict < the tie would
   * leave BOTH rows open forever: the reconciler deliberately never closes
   * startsAt ties (its successor predicate is strictly later), so nothing would
   * ever repair it, and the pair would read back as unbounded downtime.
   *
   * Note this closes only the single immediately-preceding row. If a monitor has
   * more than one open row (the orphans this bug produced), the older ones are
   * deliberately left alone: closing them here at the new row's startsAt would
   * turn a near-zero-duration orphan into months of recorded downtime, which is
   * worse than the current state and not repairable from the read path. Those
   * rows must be closed at the startsAt of the row that actually follows each of
   * them, which is the reconciler job's responsibility, not this write path's.
   */
  private async closePrecedingStatusTimeline(data: {
    precedingStatusTimelineId: ObjectID;
    endsAt: Date;
    logAttributes: LogAttributes;
  }): Promise<void> {
    const updatedCount: number = await this.updateOneBy({
      query: {
        _id: data.precedingStatusTimelineId.toString(),
        startsAt: QueryHelper.lessThanEqualTo(data.endsAt),
        endsAt: QueryHelper.greaterThanEqualToOrNull(data.endsAt),
      },
      data: {
        endsAt: data.endsAt,
      },
      props: {
        isRoot: true,
      },
    });

    if (updatedCount === 0) {
      /*
       * The preceding row moved under us between onBeforeCreate reading it and
       * this update - it was already closed at an earlier time, or it no longer
       * starts before the new row. Leaving it as-is is correct; surface it so the
       * reconciler has a signal to look at this monitor.
       */
      logger.warn(
        `MonitorStatusTimeline: did not close preceding status timeline ${data.precedingStatusTimelineId.toString()} at ${data.endsAt.toString()}; it is no longer open and older than the new status.`,
        data.logAttributes,
      );
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<MonitorStatusTimeline>,
    createdItem: MonitorStatusTimeline,
  ): Promise<MonitorStatusTimeline> {
    const logAttributes: LogAttributes = {
      projectId: createdItem.projectId?.toString(),
      monitorId: createdItem.monitorId?.toString(),
    } as LogAttributes;

    if (!createdItem.monitorId) {
      throw new BadDataException("monitorId is null");
    }

    if (!createdItem.monitorStatusId) {
      throw new BadDataException("monitorStatusId is null");
    }

    /*
     * Everything below runs while the per-monitor mutex acquired in
     * onBeforeCreate is still held, so the read of the predecessor there and
     * the close of it here cannot interleave with another writer for the same
     * monitor. It is given back at the end of this hook.
     */

    // update the last status as ended.

    logger.debug("Status Timeline Before this", logAttributes);
    logger.debug(
      onCreate.carryForward.statusTimelineBeforeThisStatus,
      logAttributes,
    );

    logger.debug("Status Timeline After this", logAttributes);
    logger.debug(
      onCreate.carryForward.statusTimelineAfterThisStatus,
      logAttributes,
    );

    logger.debug("Created Item", logAttributes);
    logger.debug(createdItem, logAttributes);

    /*
     * now there are three cases.
     * 1. This is the first status OR there's no status after this.
     */
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.", logAttributes);
    } else if (!onCreate.carryForward.statusTimelineAfterThisStatus) {
      /*
       * 2. This is the last status.
       * Update the previous status to end at the start of this status.
       */
      await this.closePrecedingStatusTimeline({
        precedingStatusTimelineId:
          onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        endsAt: createdItem.startsAt!,
        logAttributes: logAttributes,
      });
      logger.debug("This is the last status.", logAttributes);
    } else {
      /*
       * 3. This is in the middle.
       * Update the previous status to end at the start of this status.
       */
      await this.closePrecedingStatusTimeline({
        precedingStatusTimelineId:
          onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        endsAt: createdItem.startsAt!,
        logAttributes: logAttributes,
      });

      /*
       * Update the next status to start at the end of this status. endsAt was
       * set to the next row's startsAt in onBeforeCreate, so this is normally a
       * no-op; it is guarded because writing an empty startsAt onto the next row
       * would corrupt it.
       */
      if (createdItem.endsAt) {
        await this.updateOneById({
          id: onCreate.carryForward.statusTimelineAfterThisStatus.id!,
          data: {
            startsAt: createdItem.endsAt,
          },
          props: {
            isRoot: true,
          },
        });
      }
      logger.debug("This status is in the middle.", logAttributes);
    }

    if (!createdItem.endsAt) {
      // if this is the last status, then update the monitor status.

      /*
       * As OneUptime's own write, derived from the timeline: the permission
       * to create the status change is the permission to change the
       * monitor's status (StateChangeFollowOn).
       */
      await MonitorService.updateOneBy({
        query: {
          _id: createdItem.monitorId?.toString(),
        },
        data: {
          currentMonitorStatusId: createdItem.monitorStatusId,
        },
        props: StateChangeFollowOn.getEventWriteProps(onCreate.createBy.props),
      });

      /*
       * The network-site bridge for this new current status is deliberately
       * NOT called from here: this hook runs with the per-monitor mutex held
       * and the bridge can be slow. create() runs it via bridgeIfCurrent
       * right after the mutex is released.
       */
    }

    /*
     * A row that only marks the monitoring switch: its On Create workflows
     * are not started (onTriggerWorkflow), which DatabaseService asks for
     * once this hook returns.
     */
    if (monitoringSwitchCreates.has(onCreate.createBy) && createdItem.id) {
      monitoringSwitchRowIdByCreate.set(
        onCreate.createBy,
        createdItem.id.toString(),
      );
      monitoringSwitchRowIds.add(createdItem.id.toString());
    }

    // The predecessor is closed and the monitor's status written.
    await StateChangeLock.giveBackFor(onCreate, logAttributes);

    return createdItem;
  }

  /*
   * A status change refused or failed once onBeforeCreate took the
   * monitor's lock - by a check DatabaseService.create runs after the hook,
   * at the INSERT, or in onCreateSuccess before it gave the lock back - gives
   * it back here (StateChangeLock). Left held, every later status change for
   * the monitor would be refused until the process ended.
   */
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<MonitorStatusTimeline> | undefined,
  ): Promise<Exception> {
    await StateChangeLock.giveBackFor(onCreate, {
      projectId: onCreate?.createBy.data.projectId?.toString(),
      monitorId: onCreate?.createBy.data.monitorId?.toString(),
    } as LogAttributes);

    return error;
  }

  /*
   * Bridges a NEW CURRENT row (no endsAt) to the network-site rollup engine.
   *
   * Why the timeline service bridges at all: this is the one place every
   * status change passes through. The probe path (MonitorResource ->
   * MonitorStatusTimelineService.create) writes the timeline row with root
   * props - no tenantId - so the MonitorService.updateOneBy in onCreateSuccess
   * never trips MonitorService.onUpdateSuccess's tenantId-gated
   * changeMonitorStatus, and a bridge that lived only inside
   * changeMonitorStatus fired for manual / incident / maintenance status
   * changes but never for a probe result. Devices bound to a monitor therefore
   * only ever moved on those, and a ping monitor going down left its device
   * "Up".
   *
   * Why it is called from create() AFTER the per-monitor mutex is released and
   * not from onCreateSuccess (which runs under the lock): the bridge stamps
   * every bound device and recomputes the site chain of each (which can open
   * alerts and post workspace notifications), and holding the lock across that
   * would serialise every concurrent status write for this monitor behind it -
   * past the semaphore's acquire timeout, refuse it. Only the predecessor
   * read -> INSERT -> predecessor close needs the lock (see onBeforeCreate).
   *
   * Ordering note: two status writes for the same monitor bridge in release
   * order, and a bridge carries the status of ITS row. Probe results for one
   * monitor are already serialised by MonitorResource's outer lock, and a
   * manual change racing a probe result is rare and self-corrects on the next
   * status change, so this is the right side of the trade-off.
   *
   * The row's projectId is the tenant column and is populated by every writer
   * (onBeforeCreate reads it or falls back to props.tenantId), so it is the
   * authoritative source here; the createBy data and tenantId are only
   * defensive fallbacks for a saved entity that somehow came back without it.
   */
  private async bridgeIfCurrent(
    createdItem: MonitorStatusTimeline,
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<void> {
    if (
      createdItem.endsAt ||
      !createdItem.monitorId ||
      !createdItem.monitorStatusId
    ) {
      // A closed row is history, not the current status: nothing to stamp.
      return;
    }

    const projectId: ObjectID | undefined =
      createdItem.projectId ||
      createBy.data.projectId ||
      createBy.props.tenantId;

    await this.bridgeCurrentStatusToNetworkSites({
      projectId: projectId,
      monitorId: createdItem.monitorId,
      monitorStatusId: createdItem.monitorStatusId,
      logAttributes: {
        projectId: projectId?.toString(),
        monitorId: createdItem.monitorId.toString(),
      } as LogAttributes,
    });
  }

  /*
   * Stamps the NetworkDevices that this monitor reports on (a Network Device
   * monitor's step devices, and any device bound through its monitorId) and
   * refreshes their sites' rollups, via NetworkSiteService.
   *
   * Resilient by contract: onMonitorStatusChanged catches internally and never
   * throws, and this wraps it once more, because it is called from create()
   * (via bridgeIfCurrent, after the per-monitor mutex is released) and from
   * onDeleteSuccess - in both cases after the timeline row and the monitor's
   * currentMonitorStatusId have already been written. A rollup failure must
   * never turn an already-persisted status change into an error for the
   * caller (and, on the create path, must never surface as a failed probe
   * ingest).
   */
  private async bridgeCurrentStatusToNetworkSites(data: {
    projectId: ObjectID | undefined;
    monitorId: ObjectID;
    monitorStatusId: ObjectID;
    logAttributes: LogAttributes;
  }): Promise<void> {
    if (!data.projectId) {
      logger.warn(
        `MonitorStatusTimeline: cannot bridge the status change of monitor ${data.monitorId.toString()} to network sites because no projectId was resolved; any network device bound to this monitor keeps its previous stamped status.`,
        data.logAttributes,
      );
      return;
    }

    try {
      await NetworkSiteService.onMonitorStatusChanged({
        projectId: data.projectId,
        monitorIds: [data.monitorId],
        monitorStatusId: data.monitorStatusId,
      });
    } catch (err) {
      logger.error(
        `MonitorStatusTimeline: failed to update network site rollups for monitor ${data.monitorId.toString()}: ${err}`,
        data.logAttributes,
      );
    }
  }

  /*
   * Writes the monitor feed item (and its workspace notification, which can be
   * third-party HTTP to Slack/Teams) for a status change. Called from create()
   * AFTER the per-monitor mutex has been released - see the comment there. Kept
   * out of onCreateSuccess on purpose: everything in onCreateSuccess runs while
   * the mutex is held.
   */
  private async createStatusChangeFeedItem(
    createdItem: MonitorStatusTimeline,
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<void> {
    if (!createdItem.monitorId || !createdItem.monitorStatusId) {
      return;
    }

    const monitorStatus: MonitorStatus | null =
      await MonitorStatusService.findOneBy({
        query: {
          _id: createdItem.monitorStatusId.toString()!,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          isOfflineState: true,
          isOperationalState: true,
          color: true,
          name: true,
        },
      });

    /*
     * The status's name is plain text, placed into the feed item's Markdown
     * (posted to Slack and Teams too): escaped, so it reads as typed.
     */
    const stateName: string = monitorStatus?.name || "";
    let stateEmoji: string = "➡️";

    // if resolved state then change emoji to 🟢.

    if (monitorStatus?.isOperationalState) {
      stateEmoji = "🟢";
    } else if (monitorStatus?.isOfflineState) {
      stateEmoji = "🔴";
    }

    const monitorName: string | null = await MonitorService.getMonitorName({
      monitorId: createdItem.monitorId,
    });

    const projectId: ObjectID = createdItem.projectId!;
    const monitorId: ObjectID = createdItem.monitorId!;

    await MonitorFeedService.createMonitorFeedItem({
      monitorId: createdItem.monitorId!,
      projectId: createdItem.projectId!,
      monitorFeedEventType: MonitorFeedEventType.MonitorStatusChanged,
      displayColor: monitorStatus?.color,
      feedInfoInMarkdown:
        mdText`${stateEmoji} Changed Monitor **[${monitorName}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitorId!)).toString()}) State** to **${stateName}**`.toString(),
      moreInformationInMarkdown: mdText`**Cause:**
    ${FeedMarkdown.asMarkdown(createdItem.rootCause)}`.toString(),
      userId: createdItem.createdByUserId || createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      },
    });
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<MonitorStatusTimeline>,
  ): Promise<OnDelete<MonitorStatusTimeline>> {
    /*
     * A delete that names its events by a query - a workflow's Delete Many
     * or Delete One by query, a retention purge - is a clean-up, not a
     * correction: it moves no event. DatabaseService has already narrowed it
     * to the events that are over (keepRowsOnDeleteByQuery, declared in the
     * constructor): each monitor keeps its current status, and every event
     * that covers part of the last 90 days.
     */
    if (!Service.getOneRowIdNamedBy(deleteBy.query)) {
      return { deleteBy, carryForward: null };
    }

    /*
     * The one event the delete names by its id, and the delete held to it:
     * the event before it closes the gap it leaves, or the delete is refused
     * when no event is left to (MonitorStatusEventDelete).
     */
    const toBeDeleted: {
      row: MonitorStatusTimeline | null;
      deletesMore: boolean;
    } = await this.findOneRowAndHoldDeleteToIt(deleteBy, {
      monitorId: true,
      startsAt: true,
      endsAt: true,
    });

    if (toBeDeleted.deletesMore || !toBeDeleted.row) {
      return { deleteBy, carryForward: null };
    }

    const event: MonitorStatusTimeline = toBeDeleted.row;
    const monitorId: ObjectID | undefined = event.monitorId;

    if (!monitorId) {
      return { deleteBy, carryForward: null };
    }

    const eventCount: PositiveNumber = await this.countBy({
      query: {
        monitorId: monitorId,
      },
      props: {
        isRoot: true,
      },
    });

    const stateBeforeThis: MonitorStatusTimeline | null = await this.findOneBy({
      query: {
        _id: QueryHelper.notEquals(event.id!.toString()),
        monitorId: monitorId,
        startsAt: QueryHelper.lessThanEqualTo(event.startsAt!),
      },
      sort: {
        startsAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        startsAt: true,
        endsAt: true,
      },
    });

    const stateAfterThis: MonitorStatusTimeline | null = await this.findOneBy({
      query: {
        monitorId: monitorId,
        startsAt: QueryHelper.greaterThan(event.startsAt!),
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        startsAt: true,
      },
    });

    const decision: StatusEventDeleteDecision = MonitorStatusEventDelete.decide(
      {
        event: event,
        before:
          stateBeforeThis && stateBeforeThis.id
            ? {
                id: stateBeforeThis.id,
                startsAt: stateBeforeThis.startsAt,
                endsAt: stateBeforeThis.endsAt,
              }
            : null,
        after: stateAfterThis,
        eventCount: eventCount.toNumber(),
        now: OneUptimeDate.getCurrentDate(),
      },
    );

    if (decision.kind === "refuse") {
      throw new BadDataException(decision.message);
    }

    /*
     * The event before it runs on once the event is gone (onDeleteSuccess),
     * never before: a delete refused after this hook, or one that removed
     * nothing, leaves the timeline as it was.
     */
    const carryForward: StatusEventDeleteCarryForward = {
      monitorId: monitorId,
      eventId: event.id!,
      previousRunsOn:
        decision.kind === "previous-runs-on"
          ? { previousId: decision.previousId, endsAt: decision.endsAt }
          : null,
    };

    return { deleteBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<MonitorStatusTimeline>,
    itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<MonitorStatusTimeline>> {
    const carryForward: StatusEventDeleteCarryForward | null =
      onDelete.carryForward || null;

    /*
     * Only for the one event deleted by its id (onBeforeDelete), once it is
     * gone: a delete by query moves no event, and leaves every monitor's
     * current status where it was.
     */
    const eventWasDeleted: boolean = Boolean(
      carryForward &&
        itemIdsBeforeDelete.some((id: ObjectID): boolean => {
          return (
            id.toString().toLowerCase() ===
            carryForward.eventId.toString().toLowerCase()
          );
        }),
    );

    if (carryForward && eventWasDeleted) {
      const monitorId: ObjectID = carryForward.monitorId;

      if (carryForward.previousRunsOn) {
        /*
         * The event before it runs on over its time: to where the next event
         * starts, or on, as the current status again (MonitorStatusEventDelete).
         * Written as null, never left out, when it runs on: a column left out
         * of an update is not written at all.
         */
        await this.updateOneById({
          id: carryForward.previousRunsOn.previousId,
          data: {
            endsAt: carryForward.previousRunsOn.endsAt,
          },
          props: {
            isRoot: true,
          },
        });
      }

      logger.debug(
        `Monitor status event ${carryForward.eventId.toString()} deleted; the event before it ${carryForward.previousRunsOn ? "runs on over its time" : "was none: the history now starts later"}.`,
        {
          monitorId: monitorId.toString(),
        } as LogAttributes,
      );

      // get last status of this monitor.
      const monitorStatusTimeline: MonitorStatusTimeline | null =
        await this.findOneBy({
          query: {
            monitorId: monitorId,
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            monitorStatusId: true,
            // For the network-site bridge below.
            projectId: true,
          },
        });

      if (monitorStatusTimeline && monitorStatusTimeline.monitorStatusId) {
        await MonitorService.updateOneBy({
          query: {
            _id: monitorId.toString(),
          },
          data: {
            currentMonitorStatusId: monitorStatusTimeline.monitorStatusId,
          },
          props: {
            isRoot: true,
          },
        });

        /*
         * The monitor just fell back to the surviving latest status, and the
         * update above is root (no tenantId) - the same gap as on the create
         * path - so the devices bound to this monitor must be re-stamped
         * from here or they keep reporting the deleted row's status.
         */
        await this.bridgeCurrentStatusToNetworkSites({
          projectId: monitorStatusTimeline.projectId,
          monitorId: monitorId,
          monitorStatusId: monitorStatusTimeline.monitorStatusId,
          logAttributes: {
            projectId: monitorStatusTimeline.projectId?.toString(),
            monitorId: monitorId.toString(),
          } as LogAttributes,
        });
      }
    }

    return onDelete;
  }
}

export default new Service();
