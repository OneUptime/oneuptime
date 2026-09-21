import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectScopedReferenceValidator from "../Utils/Database/ProjectScopedReferenceValidator";
import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import NetworkSiteService from "./NetworkSiteService";
import UserService from "./UserService";
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
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../Types/StatusPage/UptimeDailyAggregate";
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

/*
 * Thrown by onBeforeCreate when the incoming status is the same as the status of
 * the row immediately before it. Probe ingest call sites (Utils/Monitor/MonitorStatusTimeline
 * and Utils/Monitor/MonitorResource) match on this exact message to treat the
 * duplicate as an idempotent no-op, so the text must not change.
 */
export const MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE: string =
  "Monitor Status cannot be same as previous status.";

/*
 * Thrown by create() when the per-monitor mutex cannot be acquired. The timeline
 * write is refused rather than performed unlocked - see the comment on the lock
 * acquisition below. Probe ingest call sites match on this to log and skip
 * instead of failing the whole ingest run.
 */
export const MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE: string =
  "Could not acquire the monitor status timeline lock for this monitor.";

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

export class Service extends DatabaseService<MonitorStatusTimeline> {
  public constructor() {
    super(MonitorStatusTimeline);
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
               GREATEST(t."startsAt", p.win_start) AS s,
               LEAST(
                 COALESCE(
                   t."endsAt",
                   LEAD(t."startsAt") OVER (
                     PARTITION BY t."monitorId" ORDER BY t."startsAt"
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

    return Service.toUptimeDailyAggregate(rows);
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
   * rolling window has no day boundaries to report.
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
   * next row's start as its end. The exception is deleting a row from the
   * middle of a timeline (onBeforeDelete). That moves the preceding row's
   * end to the next row's old start and the next row's start back to the
   * deleted row's start, so the two overlap across the deleted span. Where
   * that overlap straddles the widest window's start, the aggregate counts
   * it twice, reporting more than 100% coverage, and this counts it once,
   * from the newer row.
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

  @CaptureSpan()
  public override async create(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<MonitorStatusTimeline> {
    /*
     * The per-monitor mutex is owned here, around the whole create, rather than
     * inside onBeforeCreate. DatabaseService.create() invokes onBeforeCreate and
     * then runs validation, permission checks and the INSERT before it ever
     * reaches onCreateSuccess, all OUTSIDE any try/catch this service can hook
     * (onCreateError never fires for a throw raised before the INSERT). So a
     * mutex acquired in onBeforeCreate and released in onCreateSuccess leaks on
     * any throw in between, and a leaked redis-semaphore mutex never expires - it
     * keeps refreshing its own Redis key for the life of the process, which would
     * block every later create for that monitor until acquireTimeout. Holding it
     * in a try/finally here releases it on every path.
     *
     * The critical section that must be serialized per monitor spans reading the
     * predecessor row (onBeforeCreate) through closing it (onCreateSuccess), so
     * the lock is held across the entire super.create(), not just one hook.
     */
    if (createBy.props.ignoreHooks || !createBy.data.monitorId) {
      // No predecessor bookkeeping runs on these paths, so no serialization is needed.
      return await super.create(createBy);
    }

    const logAttributes: LogAttributes = {
      projectId: createBy.data.projectId?.toString(),
      monitorId: createBy.data.monitorId?.toString(),
    } as LogAttributes;

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: createBy.data.monitorId.toString(),
        namespace: "MonitorStatusTimeline.create",
      });
    } catch (e) {
      /*
       * Fail closed. This used to fall through and INSERT UNLOCKED, which let two
       * concurrent writers resolve the same predecessor row, both pass the
       * same-as-previous check, and both INSERT a status row milliseconds apart.
       * Only the later row is ever closed (the next writer resolves its
       * predecessor with ORDER BY startsAt DESC LIMIT 1), so the earlier row is
       * orphaned with endsAt = NULL permanently and is read back as unbounded
       * downtime. Refusing the write is strictly safer: the monitor keeps its
       * current status and the next probe result for the same monitor
       * re-evaluates the same criteria and recreates the status change.
       */
      logger.error(e, logAttributes);
      throw new ServerException(MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE);
    }

    let createdItem: MonitorStatusTimeline;

    try {
      createdItem = await super.create(createBy);
    } finally {
      await this.releaseMutex(mutex, logAttributes);
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
     * status transitions. (The pre-fail-closed code released the lock at this
     * same boundary, before the feed block.)
     */
    await this.createStatusChangeFeedItem(createdItem, createBy);

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<OnCreate<MonitorStatusTimeline>> {
    if (!createBy.data.monitorId) {
      throw new BadDataException("monitorId is null");
    }

    const logAttributes: LogAttributes = {
      projectId: createBy.data.projectId?.toString(),
      monitorId: createBy.data.monitorId?.toString(),
    } as LogAttributes;

    /*
     * The per-monitor mutex that serializes this read-modify-write is acquired
     * and released in create() (see the comment there); it is held for the whole
     * duration of this hook.
     */
    return await this.buildOnCreate(
      createBy,
      createBy.data.monitorId,
      logAttributes,
    );
  }

  /*
   * Body of onBeforeCreate, split out to keep the null-narrowing of monitorId in
   * one place: it is passed in already narrowed so it can never reach a query as
   * undefined, which would widen the query to every monitor.
   */
  private async buildOnCreate(
    createBy: CreateBy<MonitorStatusTimeline>,
    monitorId: ObjectID,
    logAttributes: LogAttributes,
  ): Promise<OnCreate<MonitorStatusTimeline>> {
    if (!createBy.data.startsAt) {
      createBy.data.startsAt = OneUptimeDate.getCurrentDate();
    }

    if (
      (createBy.data.createdByUserId ||
        createBy.data.createdByUser ||
        createBy.props.userId) &&
      !createBy.data.rootCause
    ) {
      let userId: ObjectID | undefined = createBy.data.createdByUserId;

      if (createBy.props.userId) {
        userId = createBy.props.userId;
      }

      if (createBy.data.createdByUser && createBy.data.createdByUser.id) {
        userId = createBy.data.createdByUser.id;
      }

      if (userId) {
        createBy.data.rootCause = `Monitor status created by ${await UserService.getUserMarkdownString(
          {
            userId: userId!,
            projectId: createBy.data.projectId || createBy.props.tenantId!,
          },
        )}`;
      }
    }

    const monitorStatusId: ObjectID | undefined | null =
      createBy.data.monitorStatusId || createBy.data.monitorStatus?.id;

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
      },
    });

    logger.debug("State Before this", logAttributes);
    logger.debug(stateBeforeThis, logAttributes);

    // If this is the first state, then do not notify the owner.
    if (!stateBeforeThis) {
      // since this is the first status, do not notify the owner.
      createBy.data.isOwnerNotified = true;
    }

    /*
     * check if this new state and the previous state are same.
     * if yes, then throw bad data exception.
     */

    if (stateBeforeThis && stateBeforeThis.monitorStatusId && monitorStatusId) {
      if (
        stateBeforeThis.monitorStatusId.toString() ===
        monitorStatusId.toString()
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
      },
    });

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
        stateAfterThis.monitorStatusId.toString() === monitorStatusId.toString()
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
   * Releases the per-monitor mutex. Never throws: a failed release must not mask
   * the error we are already unwinding, and must not fail an otherwise successful
   * create. Semaphore.release stops the refresh interval before it talks to
   * Redis, so even if the Redis call fails the key expires on its own lockTimeout.
   */
  private async releaseMutex(
    mutex: SemaphoreMutex | null | undefined,
    logAttributes: LogAttributes,
  ): Promise<void> {
    if (!mutex) {
      return;
    }

    try {
      await Semaphore.release(mutex);
    } catch (err) {
      logger.error(err, logAttributes);
    }
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
     * Everything below runs while the per-monitor mutex acquired in create() is
     * still held, so the read of the predecessor in onBeforeCreate and the close
     * of it here cannot interleave with another writer for the same monitor.
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

      await MonitorService.updateOneBy({
        query: {
          _id: createdItem.monitorId?.toString(),
        },
        data: {
          currentMonitorStatusId: createdItem.monitorStatusId,
        },
        props: onCreate.createBy.props,
      });

      /*
       * The network-site bridge for this new current status is deliberately
       * NOT called from here: this hook runs with the per-monitor mutex held
       * and the bridge can be slow. create() runs it via bridgeIfCurrent
       * right after the mutex is released.
       */
    }
    return createdItem;
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
   * read -> INSERT -> predecessor close needs the lock (see create()).
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
        stateEmoji +
        ` Changed Monitor **[${monitorName}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitorId!)).toString()}) State** to **` +
        stateName +
        "**",
      moreInformationInMarkdown: `**Cause:**
    ${createdItem.rootCause}`,
      userId: createdItem.createdByUserId || createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId || createBy.props.userId || undefined,
      },
    });
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<MonitorStatusTimeline>,
  ): Promise<OnDelete<MonitorStatusTimeline>> {
    if (deleteBy.query._id) {
      const monitorStatusTimelineToBeDeleted: MonitorStatusTimeline | null =
        await this.findOneById({
          id: new ObjectID(deleteBy.query._id as string),
          select: {
            monitorId: true,
            startsAt: true,
            endsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      const monitorId: ObjectID | undefined =
        monitorStatusTimelineToBeDeleted?.monitorId;

      if (monitorId) {
        const monitorStatusTimeline: PositiveNumber = await this.countBy({
          query: {
            monitorId: monitorId,
          },
          props: {
            isRoot: true,
          },
        });

        if (!monitorStatusTimelineToBeDeleted) {
          throw new BadDataException("Monitor status timeline not found.");
        }

        if (monitorStatusTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only status timeline. Monitor should have at least one status timeline.",
          );
        }

        /*
         * There are three cases.
         * 1. This is the first status.
         * 2. This is the last status.
         * 3. This is in the middle.
         */

        const stateBeforeThis: MonitorStatusTimeline | null =
          await this.findOneBy({
            query: {
              _id: QueryHelper.notEquals(deleteBy.query._id as string),
              monitorId: monitorId,
              startsAt: QueryHelper.lessThanEqualTo(
                monitorStatusTimelineToBeDeleted.startsAt!,
              ),
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
            },
          });

        const stateAfterThis: MonitorStatusTimeline | null =
          await this.findOneBy({
            query: {
              monitorId: monitorId,
              startsAt: QueryHelper.greaterThan(
                monitorStatusTimelineToBeDeleted.startsAt!,
              ),
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
            },
          });

        if (!stateBeforeThis) {
          // This is the first status, no need to update previous status.
          logger.debug("This is the first status.", {
            monitorId: monitorId?.toString(),
          } as LogAttributes);
        } else if (!stateAfterThis) {
          /*
           * This is the last status.
           * Update the previous status to end at the start of this status.
           */
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: monitorStatusTimelineToBeDeleted.endsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This is the last status.", {
            monitorId: monitorId?.toString(),
          } as LogAttributes);
        } else {
          /*
           * This status is in the middle.
           * Update the previous status to end at the start of this status.
           */
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: stateAfterThis.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });

          // Update the next status to start at the end of this status.
          await this.updateOneById({
            id: stateAfterThis.id!,
            data: {
              startsAt: monitorStatusTimelineToBeDeleted.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This status is in the middle.", {
            monitorId: monitorId?.toString(),
          } as LogAttributes);
        }
      }

      return { deleteBy, carryForward: monitorId };
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<MonitorStatusTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<MonitorStatusTimeline>> {
    if (onDelete.carryForward) {
      // this is monitorId.
      const monitorId: ObjectID = onDelete.carryForward as ObjectID;

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
