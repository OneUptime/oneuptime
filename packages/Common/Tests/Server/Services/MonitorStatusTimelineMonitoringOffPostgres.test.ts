import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService, {
  FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME,
  MergedDowntimeRow,
  MonitorGroupDailyUptimeRow,
  RollingUptimeTotalRow,
  Service as MonitorStatusTimelineServiceType,
  UptimeDailyAggregateRow,
} from "../../../Server/Services/MonitorStatusTimelineService";
import { Blue, Green, Red, Yellow } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import {
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import {
  MonitorGroupUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorFirstCheck from "../../../Utils/Monitor/MonitorFirstCheck";
import MonitorGroupUptimeDailyAggregateUtil from "../../../Utils/StatusPage/MonitorGroupUptimeDailyAggregateUtil";
import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import Event from "../../../Utils/Uptime/Event";
import MonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import UptimeUtil, {
  MonitoringOffSpan,
} from "../../../Utils/Uptime/UptimeUtil";
import WorstStatusTimeline from "../../../Utils/Uptime/WorstStatusTimeline";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { getJestSpyOn } from "../../Spy";
import {
  PREVIOUS_DAILY_UPTIME_AGGREGATE_SQL,
  PREVIOUS_MERGED_DOWNTIME_SQL,
  PREVIOUS_ROLLING_UPTIME_TOTALS_SQL,
  previousMonitorGroupDailyUptimeAggregateSql,
} from "./PreviousUptimeStatements";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * TIME WITH MONITORING OFF, AGAINST POSTGRES (issues #6480 and #6987).
 *
 * Turning a monitor's monitoring off or back on starts a status event that
 * says so (MonitorStatusTimeline.isMonitoringOff). Nothing checks the monitor
 * while it is off, so the four statements that measure a monitor's or a
 * monitor group's time leave that time out - a status page's day bars and
 * uptime, a monitor group's days and the Dashboard's rolling uptime:
 *
 *   - getDailyUptimeAggregate (a monitor's days),
 *   - getMonitorGroupDailyUptimeAggregate (a monitor group's days),
 *   - getMergedDowntimeSeconds (a group's uptime),
 *   - getRollingUptimeTotals (a monitor's last 24 hours, 7 and 30 days).
 *
 * Each drops a row that marks monitoring off AFTER the LEAD that ends an
 * open row at the next one's start, never before it: filtered first, the
 * open row before the switch would run on across the time it is off.
 *
 * These run the statements on real rows and check them against a reference
 * written apart from them: the rows turned into events as the browser does
 * (UptimeUtil.getMonitorEventsForId, which skips the time off), merged by
 * WorstStatusTimeline for a group, and cut into the days DayUptimeGraphUtil
 * draws.
 *
 * THE TIME BEFORE A MONITOR'S FIRST CHECK (issue #8960) is left out of the
 * same four statements: every monitor is created in the operational status,
 * which nothing stands behind until something has measured it
 * (Monitor.firstMeasuredAt). The reference cuts each monitor's events of a
 * status a monitor can start in at its first check - all of them while
 * nothing has checked it - and leaves a status something else recorded, and
 * time with monitoring off, as they are; a manual monitor, and one the
 * Monitor table does not hold, count from the start. Drawn timelines with
 * first checks before, inside and after the window are held to it in five
 * zones, and a monitor checked from the start to exactly what the statements
 * read before (PreviousUptimeStatements.ts).
 *
 * Opt in with RUN_POSTGRES_MONITORING_OFF_UPTIME_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_MONITORING_OFF_UPTIME_TESTS=true \
 *   MONITORING_OFF_UPTIME_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITORING_OFF_UPTIME_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/MonitorStatusTimelineMonitoringOffPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * definitions of MonitorStatusTimeline, Monitor and MonitorStatus are copied
 * from public into a uniquely named schema that is dropped afterwards; every
 * row is synthetic. A monitor with no Monitor row reads as checked from the
 * start, so every test written before issue #8960 reads as it did.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITORING_OFF_UPTIME_TESTS"] === "true"
    ? describe
    : describe.skip;

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// A window well in the past, so now() clamps nothing.
const WINDOW_START: Date = new Date("2026-02-20T09:30:00.000Z");
const WINDOW_END: Date = new Date("2026-04-10T15:45:00.000Z");

const PROJECT_ID: string = "64800000-0000-4000-8000-000000000001";

function makeStatus(data: {
  id: string;
  name: string;
  priority: number;
  color: Color;
  isOfflineState?: boolean | undefined;
  isOperationalState?: boolean | undefined;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.color;
  status.isOperationalState =
    data.isOperationalState ?? data.name === "Operational";
  status.isOfflineState = data.isOfflineState === true;
  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus({
  id: "64810000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
  color: Green,
});
const DEGRADED: MonitorStatus = makeStatus({
  id: "64810000-0000-4000-8000-000000000002",
  name: "Degraded",
  priority: 2,
  color: Yellow,
});
const OFFLINE: MonitorStatus = makeStatus({
  id: "64810000-0000-4000-8000-000000000003",
  name: "Offline",
  priority: 3,
  color: Red,
  isOfflineState: true,
});

const STATUSES: Array<MonitorStatus> = [OPERATIONAL, DEGRADED, OFFLINE];

/*
 * A status flagged operational AND offline: not one a monitor starts in
 * (MonitorFirstCheck.isStartingStatus), so it was recorded, even before the
 * first check. Only the tests of issue #8960 use it.
 */
const OPERATIONAL_AND_OFFLINE: MonitorStatus = makeStatus({
  id: "64810000-0000-4000-8000-000000000004",
  name: "Partly operational",
  priority: 4,
  color: Blue,
  isOperationalState: true,
  isOfflineState: true,
});

const EVERY_STATUS: Array<MonitorStatus> = [
  ...STATUSES,
  OPERATIONAL_AND_OFFLINE,
];

const DOWNTIME_STATUS_IDS: Array<string> = [
  DEGRADED.id!.toString(),
  OFFLINE.id!.toString(),
];

const RANKED_STATUS_IDS: Array<string> =
  MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
    monitorStatuses: STATUSES,
    downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
  });

const ZONES: Array<string> = ["UTC", "America/New_York", "Asia/Kolkata"];

/*
 * The zones the time before a monitor's first check is held to the
 * reference in (issue #8960): with them, a clock that changes at midnight
 * and one three quarters of an hour off.
 */
const FIRST_CHECK_ZONES: Array<string> = [
  ...ZONES,
  "America/Santiago",
  "Pacific/Chatham",
];

interface Row {
  monitorId: string;
  statusId: string;
  startsAt: Date;
  endsAt: Date | null;
  isMonitoringOff: boolean;
  deletedAt?: Date | null | undefined;
}

function statusById(statusId: string): MonitorStatus {
  return EVERY_STATUS.find((status: MonitorStatus) => {
    return status.id!.toString() === statusId;
  })!;
}

function monitorId(n: number): string {
  return `64820000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function before(end: Date, days: number): Date {
  return new Date(end.getTime() - days * DAY_MS);
}

// The rows as the browser holds them, for the reference.
function toTimeline(row: Row): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = new ObjectID(row.monitorId);
  timeline.monitorStatusId = new ObjectID(row.statusId);
  timeline.monitorStatus = statusById(row.statusId);
  timeline.startsAt = row.startsAt;
  timeline.isMonitoringOff = row.isMonitoringOff;

  if (row.endsAt) {
    timeline.endsAt = row.endsAt;
  }

  return timeline;
}

/*
 * The rows a statement reads for [startDate, endDate], by the same
 * predicate: not deleted, started by its end, and ended at or after its
 * start or still open.
 */
function rowsRead(
  rows: Array<Row>,
  startDate: Date,
  endDate: Date,
): Array<MonitorStatusTimeline> {
  return rows
    .filter((row: Row) => {
      return (
        !row.deletedAt &&
        row.startsAt.getTime() <= endDate.getTime() &&
        (row.endsAt === null || row.endsAt.getTime() >= startDate.getTime())
      );
    })
    .map(toTimeline);
}

// One monitor's events in the window, the time with monitoring off skipped.
function monitorEvents(data: {
  rows: Array<Row>;
  monitorId: string;
  startDate: Date;
  endDate: Date;
}): Array<MonitorEvent> {
  return UptimeUtil.getMonitorEventsForId(
    new ObjectID(data.monitorId),
    rowsRead(data.rows, data.startDate, data.endDate),
    { startDate: data.startDate, endDate: data.endDate },
  );
}

// The group's events: each member's, merged by the worst status at each instant.
function groupEvents(data: {
  rows: Array<Row>;
  monitorIds: Array<string>;
}): Array<Event> {
  const events: Array<MonitorEvent> = [];

  for (const id of Array.from(new Set(data.monitorIds))) {
    events.push(
      ...monitorEvents({
        rows: data.rows,
        monitorId: id,
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      }),
    );
  }

  return WorstStatusTimeline.merge(events, {
    downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
  });
}

/*
 * A monitor as the Monitor table holds it, for the tests of the time before
 * its first check (issue #8960).
 */
interface MonitorRow {
  monitorId: string;
  monitorType: MonitorType;
  firstMeasuredAt: Date | null;
}

/*
 * When a monitor's time starts to count, in milliseconds, as the statements
 * read it: from the start for a manual monitor and for one the Monitor table
 * does not hold, never while nothing has checked it, from its first check
 * otherwise.
 */
function measuredFromMs(monitors: Array<MonitorRow>, id: string): number {
  const monitor: MonitorRow | undefined = monitors.find(
    (candidate: MonitorRow) => {
      return candidate.monitorId === id;
    },
  );

  if (!monitor || monitor.monitorType === MonitorType.Manual) {
    return -Infinity;
  }

  return monitor.firstMeasuredAt ? monitor.firstMeasuredAt.getTime() : Infinity;
}

/*
 * One monitor's events in the window, the time with monitoring off skipped
 * and, of a status a monitor can start in, the time before its first check
 * cut away: what the monitor's row would have said then is Waiting for data,
 * not a status (MonitorFirstCheck).
 */
function checkedEvents(data: {
  rows: Array<Row>;
  monitorId: string;
  startDate: Date;
  endDate: Date;
  monitors: Array<MonitorRow>;
}): Array<MonitorEvent> {
  const from: number = measuredFromMs(data.monitors, data.monitorId);
  const events: Array<MonitorEvent> = [];

  for (const event of monitorEvents(data)) {
    const start: number = new Date(event.startDate).getTime();
    const end: number = new Date(event.endDate).getTime();

    if (
      !MonitorFirstCheck.isStartingStatus(
        statusById(event.eventStatusId.toString()),
      ) ||
      start >= from
    ) {
      events.push(event);
      continue;
    }

    if (from >= end) {
      continue;
    }

    events.push({ ...event, startDate: new Date(from) });
  }

  return events;
}

// A group's events, each member's checked time merged by the worst status.
function checkedGroupEvents(data: {
  rows: Array<Row>;
  monitorIds: Array<string>;
  monitors: Array<MonitorRow>;
}): Array<Event> {
  const events: Array<MonitorEvent> = [];

  for (const id of Array.from(new Set(data.monitorIds))) {
    events.push(
      ...checkedEvents({
        rows: data.rows,
        monitorId: id,
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        monitors: data.monitors,
      }),
    );
  }

  return WorstStatusTimeline.merge(events, {
    downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
  });
}

interface ReferenceDay {
  bucketStart: number;
  bucketEnd: number;
  coveredSeconds: number;
  seconds: Record<string, number>;
  /*
   * The day's time with monitoring off (issue #7112), when the reference was
   * handed the rows' spans with monitoring off: what the strip counts from
   * timeline rows (DayUptimeGraphUtil.getMonitoringOffSecondsOfDay).
   */
  monitoringOffSeconds?: number | undefined;
}

/*
 * The spans with monitoring off of the rows a statement reads, for the
 * monitors given - one, or a group's - clipped to the window, as the strip
 * reads them from timeline rows (UptimeUtil.getMonitoringOffSpans).
 */
function offSpans(data: {
  rows: Array<Row>;
  monitorIds: Array<string>;
}): Array<MonitoringOffSpan> {
  return UptimeUtil.getMonitoringOffSpans(
    rowsRead(data.rows, WINDOW_START, WINDOW_END).filter(
      (row: MonitorStatusTimeline): boolean => {
        return data.monitorIds.includes(row.monitorId!.toString());
      },
    ),
    { startDate: WINDOW_START, endDate: WINDOW_END },
  );
}

// Events cut into the days the strip draws in the zone, clipped to the window.
function toDays(
  events: Array<Event>,
  zone: string,
  monitoringOffSpans?: Array<MonitoringOffSpan> | undefined,
): Array<ReferenceDay> {
  const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    timezone: zone,
  });

  return days.map((day: UptimeGraphDay): ReferenceDay => {
    const bucketStart: number = Math.max(
      day.startOfDay.getTime(),
      WINDOW_START.getTime(),
    );
    const bucketEnd: number = Math.min(
      day.endOfDay.getTime() + 1,
      WINDOW_END.getTime(),
    );

    const seconds: Record<string, number> = {};
    let coveredMs: number = 0;

    for (const event of events) {
      const from: number = Math.max(
        new Date(event.startDate).getTime(),
        bucketStart,
      );
      const to: number = Math.min(new Date(event.endDate).getTime(), bucketEnd);

      if (to <= from) {
        continue;
      }

      const statusId: string = event.eventStatusId.toString();
      seconds[statusId] = (seconds[statusId] || 0) + (to - from) / 1000;
      coveredMs += to - from;
    }

    return {
      bucketStart,
      bucketEnd,
      coveredSeconds: coveredMs / 1000,
      seconds,
      monitoringOffSeconds: monitoringOffSpans
        ? DayUptimeGraphUtil.getMonitoringOffSecondsOfDay({
            monitoringOffSpans: monitoringOffSpans,
            checkedSpans: events.map((event: Event) => {
              return {
                startDate: new Date(event.startDate),
                endDate: new Date(event.endDate),
              };
            }),
            dayStart: new Date(bucketStart),
            dayEnd: new Date(bucketEnd),
          })
        : undefined,
    };
  });
}

function secondsOf(bucket: UptimeDayBucket): Record<string, number> {
  const seconds: Record<string, number> = {};

  for (const duration of bucket.statusDurations) {
    seconds[duration.monitorStatusId.toString()] = duration.seconds;
  }

  return seconds;
}

function expectBucketsToMatch(
  buckets: Array<UptimeDayBucket>,
  expected: Array<ReferenceDay>,
): void {
  expect(
    buckets.map((bucket: UptimeDayBucket) => {
      return [bucket.bucketStart.getTime(), bucket.bucketEnd.getTime()];
    }),
  ).toEqual(
    expected.map((day: ReferenceDay) => {
      return [day.bucketStart, day.bucketEnd];
    }),
  );

  buckets.forEach((bucket: UptimeDayBucket, index: number) => {
    const day: ReferenceDay = expected[index]!;
    const actual: Record<string, number> = secondsOf(bucket);

    expect(bucket.coveredSeconds).toBeCloseTo(day.coveredSeconds, 4);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(day.seconds).sort());

    for (const statusId of Object.keys(day.seconds)) {
      expect(actual[statusId]).toBeCloseTo(day.seconds[statusId]!, 4);
    }

    const total: number = bucket.statusDurations.reduce(
      (sum: number, duration: UptimeStatusDuration) => {
        return sum + duration.seconds;
      },
      0,
    );

    expect(total).toBeCloseTo(bucket.coveredSeconds, 4);

    /*
     * The day's time with monitoring off, as the strip counts it from the
     * rows (issue #7112): never more than the day, never part of coverage.
     */
    if (day.monitoringOffSeconds !== undefined) {
      expect(bucket.monitoringOffSeconds || 0).toBeCloseTo(
        day.monitoringOffSeconds,
        3,
      );
      expect(
        bucket.coveredSeconds + (bucket.monitoringOffSeconds || 0),
      ).toBeLessThanOrEqual(bucket.daySeconds + 0.001);
    }
  });
}

// Two readings of the same seconds: to within a microsecond.
function expectWithinAMicrosecond(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.000001);
}

/*
 * The same days, with the same statuses, coverage and time with monitoring
 * off, to within a microsecond: what a monitor checked from the start reads
 * now against what it read before issue #8960.
 */
function expectSameBuckets(
  actual: Array<UptimeDayBucket>,
  expected: Array<UptimeDayBucket>,
): void {
  expect(
    actual.map((bucket: UptimeDayBucket) => {
      return `${bucket.bucketStart.toISOString()} ${bucket.bucketEnd.toISOString()} ${bucket.daySeconds}`;
    }),
  ).toEqual(
    expected.map((bucket: UptimeDayBucket) => {
      return `${bucket.bucketStart.toISOString()} ${bucket.bucketEnd.toISOString()} ${bucket.daySeconds}`;
    }),
  );

  expected.forEach((expectedBucket: UptimeDayBucket, index: number) => {
    const actualBucket: UptimeDayBucket = actual[index]!;
    const actualSeconds: Record<string, number> = secondsOf(actualBucket);
    const expectedSeconds: Record<string, number> = secondsOf(expectedBucket);

    expectWithinAMicrosecond(
      actualBucket.coveredSeconds,
      expectedBucket.coveredSeconds,
    );
    expect(Object.keys(actualSeconds).sort()).toEqual(
      Object.keys(expectedSeconds).sort(),
    );

    for (const statusId of Object.keys(expectedSeconds)) {
      expectWithinAMicrosecond(
        actualSeconds[statusId]!,
        expectedSeconds[statusId]!,
      );
    }

    expect(actualBucket.monitoringOffSeconds === undefined).toBe(
      expectedBucket.monitoringOffSeconds === undefined,
    );
    expectWithinAMicrosecond(
      actualBucket.monitoringOffSeconds || 0,
      expectedBucket.monitoringOffSeconds || 0,
    );
  });
}

function bucketAt(
  buckets: Array<UptimeDayBucket>,
  dayStart: Date,
): UptimeDayBucket {
  const bucket: UptimeDayBucket | undefined = buckets.find(
    (candidate: UptimeDayBucket) => {
      return candidate.bucketStart.getTime() === dayStart.getTime();
    },
  );

  expect(bucket).toBeDefined();
  return bucket!;
}

describePostgres(
  "time with a monitor's monitoring off, measured on Postgres",
  () => {
    const schema: string = `monitoring_off_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")
      .slice(0, 16)}`;
    let database: DataSource;

    async function insertRows(rows: Array<Row>): Promise<void> {
      for (const row of rows) {
        await database.query(
          `INSERT INTO "MonitorStatusTimeline"
             ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt", "endsAt", "isMonitoringOff", "deletedAt")
           VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            ObjectID.generate().toString(),
            PROJECT_ID,
            row.monitorId,
            row.statusId,
            row.startsAt,
            row.endsAt,
            row.isMonitoringOff,
            row.deletedAt || null,
          ],
        );
      }
    }

    async function monitorDays(data: {
      monitorIds: Array<string>;
      zone: string;
    }): Promise<UptimeDailyAggregate> {
      return await MonitorStatusTimelineService.getDailyUptimeAggregate({
        monitorIds: data.monitorIds.map((id: string) => {
          return new ObjectID(id);
        }),
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        timezone: data.zone,
      });
    }

    async function groupDays(data: {
      groups: Array<Array<string>>;
      zone: string;
    }): Promise<MonitorGroupUptimeDailyAggregate> {
      return await MonitorStatusTimelineService.getMonitorGroupDailyUptimeAggregate(
        {
          monitorGroups: data.groups.map(
            (monitorIds: Array<string>, index: number) => {
              return {
                monitorGroupId: new ObjectID(
                  `64830000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                ),
                monitorIds: monitorIds.map((id: string) => {
                  return new ObjectID(id);
                }),
              };
            },
          ),
          rankedMonitorStatusIds: RANKED_STATUS_IDS,
          startDate: WINDOW_START,
          endDate: WINDOW_END,
          timezone: data.zone,
        },
      );
    }

    async function mergedDowntime(
      monitorIds: Array<string>,
    ): Promise<MergedDowntimeTotals> {
      return await MonitorStatusTimelineService.getMergedDowntimeSeconds({
        monitorIds: monitorIds.map((id: string) => {
          return new ObjectID(id);
        }),
        downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      });
    }

    const ROLLING_WINDOWS: Array<{
      key: MonitorUptimeWindowKey;
      days: number;
    }> = [
      { key: MonitorUptimeWindowKey.Last24Hours, days: 1 },
      { key: MonitorUptimeWindowKey.Last7Days, days: 7 },
      { key: MonitorUptimeWindowKey.Last30Days, days: 30 },
    ];

    async function rollingTotals(
      id: string,
    ): Promise<Array<MonitorUptimeWindowTotal>> {
      return await MonitorStatusTimelineService.getRollingUptimeTotals({
        monitorId: new ObjectID(id),
        windows: ROLLING_WINDOWS.map(
          (window: { key: MonitorUptimeWindowKey; days: number }) => {
            return {
              key: window.key,
              startDate: before(WINDOW_END, window.days),
            };
          },
        ),
        endDate: WINDOW_END,
      });
    }

    /*
     * The row BackfillMonitorFirstMeasuredAtForUptimeHistory leaves once it
     * has put Monitor.firstMeasuredAt right for history: until it is there,
     * the statements cut nothing (issue #8960).
     */
    async function markTheUpgradeDone(): Promise<void> {
      await database.query(
        `INSERT INTO "DataMigrations" ("_id", "version", "name", "executed", "executedAt")
         VALUES (gen_random_uuid(), 1, $1, true, now())`,
        [FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME],
      );
    }

    // Monitors in the Monitor table, with their type and first check (#8960).
    async function insertMonitors(monitors: Array<MonitorRow>): Promise<void> {
      for (const monitor of monitors) {
        await database.query(
          `INSERT INTO "Monitor"
             ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "firstMeasuredAt")
           VALUES ($1, 1, $2, $3, $3, $4, $5, $6)`,
          [
            monitor.monitorId,
            PROJECT_ID,
            `monitor-${monitor.monitorId.slice(-6)}`,
            monitor.monitorType,
            OPERATIONAL.id!.toString(),
            monitor.firstMeasuredAt,
          ],
        );
      }
    }

    /*
     * The four statements as they were before issue #8960 (and #6887), on
     * the same rows, shaped by the same functions: what a monitor checked
     * from the start must still read.
     */
    async function previousMonitorDays(data: {
      monitorIds: Array<string>;
      zone: string;
    }): Promise<UptimeDailyAggregate> {
      const rows: Array<UptimeDailyAggregateRow> = await database.query(
        PREVIOUS_DAILY_UPTIME_AGGREGATE_SQL,
        [data.monitorIds, WINDOW_START, WINDOW_END, data.zone],
      );

      return MonitorStatusTimelineServiceType.toUptimeDailyAggregate(
        rows,
        data.zone,
      );
    }

    async function previousGroupDays(data: {
      groups: Array<Array<string>>;
      zone: string;
    }): Promise<MonitorGroupUptimeDailyAggregate> {
      const groupKeys: Array<number> = [];
      const memberIds: Array<string> = [];

      data.groups.forEach((monitorIds: Array<string>, index: number) => {
        for (const id of monitorIds) {
          groupKeys.push(index + 1);
          memberIds.push(id);
        }
      });

      const rows: Array<MonitorGroupDailyUptimeRow> = await database.query(
        previousMonitorGroupDailyUptimeAggregateSql({
          levelCount: RANKED_STATUS_IDS.length,
        }),
        [
          groupKeys,
          memberIds,
          WINDOW_START,
          WINDOW_END,
          data.zone,
          RANKED_STATUS_IDS,
          data.groups.length,
        ],
      );

      return MonitorStatusTimelineServiceType.toMonitorGroupUptimeDailyAggregate(
        {
          rows: rows,
          monitorGroupIds: data.groups.map(
            (_: Array<string>, index: number) => {
              return new ObjectID(
                `64830000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
              );
            },
          ),
          rankedMonitorStatusIds: RANKED_STATUS_IDS,
          timezone: data.zone,
        },
      );
    }

    async function previousMergedDowntime(
      monitorIds: Array<string>,
    ): Promise<MergedDowntimeTotals> {
      const rows: Array<MergedDowntimeRow> = await database.query(
        PREVIOUS_MERGED_DOWNTIME_SQL,
        [monitorIds, WINDOW_START, WINDOW_END, DOWNTIME_STATUS_IDS],
      );

      return MonitorStatusTimelineServiceType.toMergedDowntimeTotals(rows);
    }

    async function previousRollingTotals(
      id: string,
    ): Promise<Array<MonitorUptimeWindowTotal>> {
      const windows: Array<{ key: MonitorUptimeWindowKey; startDate: Date }> =
        ROLLING_WINDOWS.map(
          (window: { key: MonitorUptimeWindowKey; days: number }) => {
            return {
              key: window.key,
              startDate: before(WINDOW_END, window.days),
            };
          },
        );

      const rows: Array<RollingUptimeTotalRow> = await database.query(
        PREVIOUS_ROLLING_UPTIME_TOTALS_SQL,
        [
          id,
          WINDOW_END,
          windows.map((window: { key: MonitorUptimeWindowKey }) => {
            return window.key;
          }),
          windows.map((window: { startDate: Date }) => {
            return window.startDate.toISOString();
          }),
        ],
      );

      return MonitorStatusTimelineServiceType.toRollingUptimeTotals({
        rows: rows,
        windows: windows,
        endDate: WINDOW_END,
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MONITORING_OFF_UPTIME_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MONITORING_OFF_UPTIME_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MONITORING_OFF_UPTIME_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: [],
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);

      /*
       * The Monitor and MonitorStatus tables too, which the statements read
       * a monitor's first check and a status's flags from (issue #8960), and
       * DataMigrations, whose row of the upgrade that puts the first check
       * right for history opens the cut (getMeasuredFromCte).
       */
      for (const table of [
        "MonitorStatusTimeline",
        "Monitor",
        "MonitorStatus",
        "DataMigrations",
      ]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      await markTheUpgradeDone();

      for (const status of EVERY_STATUS) {
        await database.query(
          `INSERT INTO "MonitorStatus"
             ("_id", "version", "projectId", "name", "slug", "color", "priority", "isOperationalState", "isOfflineState")
           VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            status.id!.toString(),
            PROJECT_ID,
            status.name,
            status.name!.toLowerCase().replace(/\s+/g, "-"),
            status.color!.toString(),
            status.priority,
            status.isOperationalState === true,
            status.isOfflineState === true,
          ],
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      await database.query(`DELETE FROM "MonitorStatusTimeline"`);
      await database.query(`DELETE FROM "Monitor"`);

      // The service reads through its repository's manager: point it here.
      getJestSpyOn(
        MonitorStatusTimelineService,
        "getRepository",
      ).mockReturnValue({
        manager: {
          query: (sql: string, params: Array<unknown>): Promise<unknown> => {
            return database.query(sql, params);
          },
        },
      } as never);
    });

    test("the migration added the column: NOT NULL, false by default, so every row written before reads as monitored", async () => {
      const columns: Array<{
        data_type: string;
        is_nullable: string;
        column_default: string;
      }> = await database.query(
        `SELECT data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = 'MonitorStatusTimeline'
            AND column_name = 'isMonitoringOff'`,
        [schema],
      );

      expect(columns).toEqual([
        { data_type: "boolean", is_nullable: "NO", column_default: "false" },
      ]);

      // A row written without it - every row before the upgrade - is monitored.
      await database.query(
        `INSERT INTO "MonitorStatusTimeline"
           ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt")
         VALUES ($1, 1, $2, $3, $4, $5)`,
        [
          ObjectID.generate().toString(),
          PROJECT_ID,
          monitorId(1),
          OFFLINE.id!.toString(),
          WINDOW_START,
        ],
      );

      const rows: Array<{ isMonitoringOff: boolean }> = await database.query(
        `SELECT "isMonitoringOff" FROM "MonitorStatusTimeline"`,
      );
      expect(rows).toEqual([{ isMonitoringOff: false }]);
    });

    describe("a monitor turned off while Offline (issue #6480)", () => {
      const switchedOffAt: Date = new Date("2026-04-03T12:00:00.000Z");

      function issueRows(): Array<Row> {
        return [
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: before(WINDOW_START, 3),
            endsAt: new Date("2026-04-01T00:00:00.000Z"),
            isMonitoringOff: false,
          },
          {
            monitorId: monitorId(1),
            statusId: OFFLINE.id!.toString(),
            startsAt: new Date("2026-04-01T00:00:00.000Z"),
            endsAt: switchedOffAt,
            isMonitoringOff: false,
          },
          // The switch: the Offline frozen from here on.
          {
            monitorId: monitorId(1),
            statusId: OFFLINE.id!.toString(),
            startsAt: switchedOffAt,
            endsAt: null,
            isMonitoringOff: true,
          },
        ];
      }

      test("its days after the switch hold nothing, and the day of the switch only the time before it", async () => {
        await insertRows(issueRows());

        const aggregate: UptimeDailyAggregate = await monitorDays({
          monitorIds: [monitorId(1)],
          zone: "UTC",
        });
        const buckets: Array<UptimeDayBucket> = aggregate.monitors[0]!.buckets;

        // The day of the switch: Offline until noon, then nothing.
        expect(
          bucketAt(buckets, new Date("2026-04-03T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 12 * 3600,
          statusDurations: [
            { monitorStatusId: OFFLINE.id, seconds: 12 * 3600 },
          ],
        });

        // Every day after it: no data.
        for (const bucket of buckets) {
          if (
            bucket.bucketStart.getTime() >=
            DAY_MS + switchedOffAt.getTime()
          ) {
            expect(bucket.coveredSeconds).toBe(0);
            expect(bucket.statusDurations).toEqual([]);
          }
        }

        expectBucketsToMatch(
          buckets,
          toDays(
            monitorEvents({
              rows: issueRows(),
              monitorId: monitorId(1),
              startDate: WINDOW_START,
              endDate: WINDOW_END,
            }),
            "UTC",
          ),
        );
      });

      test("its rolling uptime: the last 24 hours and 7 days, all of them after the switch, read no data; the last 30 days are measured up to the switch", async () => {
        await insertRows(issueRows());

        const totals: Array<MonitorUptimeWindowTotal> = await rollingTotals(
          monitorId(1),
        );

        // Switched off on 3 April at noon; the 7 days start on 3 April at 15:45.
        expect(
          totals.map((total: MonitorUptimeWindowTotal) => {
            return [total.key, total.windowSeconds];
          }),
        ).toEqual([
          [MonitorUptimeWindowKey.Last24Hours, 86400],
          [MonitorUptimeWindowKey.Last7Days, 7 * 86400],
          [MonitorUptimeWindowKey.Last30Days, 30 * 86400],
        ]);

        for (const total of totals.slice(0, 2)) {
          expect(total.coveredSeconds).toBe(0);
          expect(total.statusDurations).toEqual([]);
        }

        /*
         * The 30 days start on 11 March at 15:45: Operational to 1 April,
         * Offline for the 60 hours to the switch, then nothing.
         */
        const last30Days: MonitorUptimeWindowTotal = totals[2]!;
        expect(last30Days.coveredSeconds).toBeCloseTo(
          (switchedOffAt.getTime() - before(WINDOW_END, 30).getTime()) / 1000,
          4,
        );
        expect(last30Days.statusDurations).toEqual([
          { monitorStatusId: OPERATIONAL.id, seconds: 20 * 86400 + 29700 },
          { monitorStatusId: OFFLINE.id, seconds: 60 * 3600 },
        ]);
      });

      test("turned back on, it counts again from that moment", async () => {
        const backOnAt: Date = new Date("2026-04-06T06:00:00.000Z");
        const rows: Array<Row> = issueRows();
        rows[2]!.endsAt = backOnAt;
        rows.push({
          monitorId: monitorId(1),
          statusId: OFFLINE.id!.toString(),
          startsAt: backOnAt,
          endsAt: null,
          isMonitoringOff: false,
        });

        await insertRows(rows);

        const buckets: Array<UptimeDayBucket> = (
          await monitorDays({ monitorIds: [monitorId(1)], zone: "UTC" })
        ).monitors[0]!.buckets;

        // Off at 06:00 on the 6th, Offline again from then.
        expect(
          bucketAt(buckets, new Date("2026-04-06T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 18 * 3600,
          statusDurations: [
            { monitorStatusId: OFFLINE.id, seconds: 18 * 3600 },
          ],
        });
        expect(
          bucketAt(buckets, new Date("2026-04-05T00:00:00.000Z"))
            .coveredSeconds,
        ).toBe(0);

        expectBucketsToMatch(
          buckets,
          toDays(
            monitorEvents({
              rows,
              monitorId: monitorId(1),
              startDate: WINDOW_START,
              endDate: WINDOW_END,
            }),
            "UTC",
          ),
        );
      });
    });

    test("an open row before the switch ends at the switch: the row that marks it off is dropped after the LEAD, not before", async () => {
      const switchedOffAt: Date = new Date("2026-03-10T00:00:00.000Z");
      const backOnAt: Date = new Date("2026-03-20T00:00:00.000Z");

      // Every row open: each ends where the next one starts.
      await insertRows([
        {
          monitorId: monitorId(1),
          statusId: OFFLINE.id!.toString(),
          startsAt: before(WINDOW_START, 1),
          endsAt: null,
          isMonitoringOff: false,
        },
        {
          monitorId: monitorId(1),
          statusId: OFFLINE.id!.toString(),
          startsAt: switchedOffAt,
          endsAt: null,
          isMonitoringOff: true,
        },
        {
          monitorId: monitorId(1),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: backOnAt,
          endsAt: null,
          isMonitoringOff: false,
        },
      ]);

      const offlineSeconds: number =
        (switchedOffAt.getTime() - WINDOW_START.getTime()) / 1000;
      const operationalSeconds: number =
        (WINDOW_END.getTime() - backOnAt.getTime()) / 1000;

      // Summed over the days: Offline up to the switch, not to the turn back on.
      const buckets: Array<UptimeDayBucket> = (
        await monitorDays({ monitorIds: [monitorId(1)], zone: "UTC" })
      ).monitors[0]!.buckets;

      let offline: number = 0;
      let covered: number = 0;

      for (const bucket of buckets) {
        covered += bucket.coveredSeconds;
        offline += secondsOf(bucket)[OFFLINE.id!.toString()] || 0;
      }

      expect(offline).toBeCloseTo(offlineSeconds, 3);
      expect(covered).toBeCloseTo(offlineSeconds + operationalSeconds, 3);

      // A group of it alone, and its merged downtime, say the same.
      const merged: MergedDowntimeTotals = await mergedDowntime([monitorId(1)]);
      expect(merged.downtimeSeconds).toBeCloseTo(offlineSeconds, 3);
      expect(merged.coveredSeconds).toBeCloseTo(
        offlineSeconds + operationalSeconds,
        3,
      );

      const group: MonitorGroupUptimeDailyAggregate = await groupDays({
        groups: [[monitorId(1)]],
        zone: "UTC",
      });
      let groupOffline: number = 0;
      for (const bucket of group.monitorGroups[0]!.buckets) {
        groupOffline += secondsOf(bucket)[OFFLINE.id!.toString()] || 0;
      }
      expect(groupOffline).toBeCloseTo(offlineSeconds, 3);
    });

    describe("the issue's monitor group (#6987): a member Offline for a day ten days ago, with monitoring off since yesterday", () => {
      const tenDaysAgo: Date = new Date("2026-03-31T00:00:00.000Z");
      const yesterday: Date = new Date("2026-04-09T00:00:00.000Z");

      function groupRows(data: { checkedIsOff: boolean }): Array<Row> {
        return [
          // A member still checked, Operational throughout (or off, all of it).
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: before(WINDOW_START, 5),
            endsAt: null,
            isMonitoringOff: data.checkedIsOff,
          },
          {
            monitorId: monitorId(2),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: before(WINDOW_START, 5),
            endsAt: tenDaysAgo,
            isMonitoringOff: false,
          },
          {
            monitorId: monitorId(2),
            statusId: OFFLINE.id!.toString(),
            startsAt: tenDaysAgo,
            endsAt: new Date(tenDaysAgo.getTime() + DAY_MS),
            isMonitoringOff: false,
          },
          {
            monitorId: monitorId(2),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: new Date(tenDaysAgo.getTime() + DAY_MS),
            endsAt: yesterday,
            isMonitoringOff: false,
          },
          // Turned off yesterday, its status frozen Offline.
          {
            monitorId: monitorId(2),
            statusId: OFFLINE.id!.toString(),
            startsAt: yesterday,
            endsAt: null,
            isMonitoringOff: true,
          },
        ];
      }

      test("the group's days still hold that Offline day, and nothing of the member after the switch", async () => {
        const rows: Array<Row> = groupRows({ checkedIsOff: false });
        await insertRows(rows);

        const buckets: Array<UptimeDayBucket> = (
          await groupDays({
            groups: [[monitorId(1), monitorId(2)]],
            zone: "UTC",
          })
        ).monitorGroups[0]!.buckets;

        expect(bucketAt(buckets, tenDaysAgo).statusDurations).toEqual([
          { monitorStatusId: OFFLINE.id, seconds: 86400 },
        ]);

        // Since the switch, only the member still checked: Operational.
        expect(bucketAt(buckets, yesterday).statusDurations).toEqual([
          { monitorStatusId: OPERATIONAL.id, seconds: 86400 },
        ]);

        expectBucketsToMatch(
          buckets,
          toDays(
            groupEvents({ rows, monitorIds: [monitorId(1), monitorId(2)] }),
            "UTC",
          ),
        );

        // Its uptime: the one Offline day, over every second of the window.
        const merged: MergedDowntimeTotals = await mergedDowntime([
          monitorId(1),
          monitorId(2),
        ]);
        expect(merged.downtimeSeconds).toBeCloseTo(86400, 3);
        expect(merged.coveredSeconds).toBeCloseTo(
          (WINDOW_END.getTime() - WINDOW_START.getTime()) / 1000,
          3,
        );
      });

      test("every member off: the group's days end where the last of them was turned off", async () => {
        const rows: Array<Row> = groupRows({ checkedIsOff: false });

        // The first member turned off too, a day before the second.
        rows[0]!.endsAt = new Date(yesterday.getTime() - DAY_MS);
        rows.push({
          monitorId: monitorId(1),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: new Date(yesterday.getTime() - DAY_MS),
          endsAt: null,
          isMonitoringOff: true,
        });

        await insertRows(rows);

        for (const zone of ZONES) {
          const buckets: Array<UptimeDayBucket> = (
            await groupDays({
              groups: [[monitorId(1), monitorId(2)]],
              zone: zone,
            })
          ).monitorGroups[0]!.buckets;

          expectBucketsToMatch(
            buckets,
            toDays(
              groupEvents({ rows, monitorIds: [monitorId(1), monitorId(2)] }),
              zone,
            ),
          );
        }

        const utc: Array<UptimeDayBucket> = (
          await groupDays({
            groups: [[monitorId(1), monitorId(2)]],
            zone: "UTC",
          })
        ).monitorGroups[0]!.buckets;

        // The day after the first was turned off: the second member alone.
        expect(
          bucketAt(utc, new Date(yesterday.getTime() - DAY_MS)).statusDurations,
        ).toEqual([{ monitorStatusId: OPERATIONAL.id, seconds: 86400 }]);
        expect(bucketAt(utc, yesterday).coveredSeconds).toBe(0);

        const merged: MergedDowntimeTotals = await mergedDowntime([
          monitorId(1),
          monitorId(2),
        ]);
        expect(merged.coveredSeconds).toBeCloseTo(
          (yesterday.getTime() - WINDOW_START.getTime()) / 1000,
          3,
        );
        expect(merged.downtimeSeconds).toBeCloseTo(86400, 3);
      });
    });

    /*
     * A day monitoring was off says so (issue #7112): the day statements
     * keep a row that marks it apart, in no status, and hand its seconds
     * back as the day's monitoringOffSeconds - a day it fills is a day
     * monitoring was off, not a day with no data.
     */
    describe("a day's time with monitoring off (issue #7112)", () => {
      const switchedOffAt: Date = new Date("2026-04-03T12:00:00.000Z");

      function offFromNoonRows(): Array<Row> {
        return [
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: before(WINDOW_START, 3),
            endsAt: switchedOffAt,
            isMonitoringOff: false,
          },
          {
            monitorId: monitorId(1),
            statusId: OFFLINE.id!.toString(),
            startsAt: switchedOffAt,
            endsAt: null,
            isMonitoringOff: true,
          },
        ];
      }

      test("a monitor's day it was off is all time off; the day it was turned off is half and half", async () => {
        await insertRows(offFromNoonRows());

        const buckets: Array<UptimeDayBucket> = (
          await monitorDays({ monitorIds: [monitorId(1)], zone: "UTC" })
        ).monitors[0]!.buckets;

        expect(
          bucketAt(buckets, new Date("2026-04-03T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 12 * 3600,
          monitoringOffSeconds: 12 * 3600,
        });
        expect(
          bucketAt(buckets, new Date("2026-04-04T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 0,
          statusDurations: [],
          monitoringOffSeconds: 86400,
        });
        // The last day, clipped to the window's end at 15:45.
        expect(
          bucketAt(buckets, new Date("2026-04-10T00:00:00.000Z"))
            .monitoringOffSeconds,
        ).toBeCloseTo(15.75 * 3600, 3);
        // Before it was turned off: no time off at all, and no field.
        expect(
          Object.keys(bucketAt(buckets, new Date("2026-03-01T00:00:00.000Z"))),
        ).not.toContain("monitoringOffSeconds");

        expectBucketsToMatch(
          buckets,
          toDays(
            monitorEvents({
              rows: offFromNoonRows(),
              monitorId: monitorId(1),
              startDate: WINDOW_START,
              endDate: WINDOW_END,
            }),
            "UTC",
            offSpans({ rows: offFromNoonRows(), monitorIds: [monitorId(1)] }),
          ),
        );
      });

      test("turned back on, the day of it is measured over the checked hours and says how long it was off", async () => {
        const backOnAt: Date = new Date("2026-04-06T06:00:00.000Z");
        const rows: Array<Row> = offFromNoonRows();
        rows[1]!.endsAt = backOnAt;
        rows.push({
          monitorId: monitorId(1),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: backOnAt,
          endsAt: null,
          isMonitoringOff: false,
        });

        await insertRows(rows);

        for (const zone of ZONES) {
          const buckets: Array<UptimeDayBucket> = (
            await monitorDays({ monitorIds: [monitorId(1)], zone: zone })
          ).monitors[0]!.buckets;

          expectBucketsToMatch(
            buckets,
            toDays(
              monitorEvents({
                rows,
                monitorId: monitorId(1),
                startDate: WINDOW_START,
                endDate: WINDOW_END,
              }),
              zone,
              offSpans({ rows, monitorIds: [monitorId(1)] }),
            ),
          );
        }

        const utc: Array<UptimeDayBucket> = (
          await monitorDays({ monitorIds: [monitorId(1)], zone: "UTC" })
        ).monitors[0]!.buckets;

        expect(
          bucketAt(utc, new Date("2026-04-06T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 18 * 3600,
          monitoringOffSeconds: 6 * 3600,
        });
        expect(
          Object.keys(bucketAt(utc, new Date("2026-04-07T00:00:00.000Z"))),
        ).not.toContain("monitoringOffSeconds");
      });

      test("a group's day is time off only while none of its monitors was checked", async () => {
        // One member turned off at noon on 3 April; the other checked throughout.
        const rows: Array<Row> = [
          ...offFromNoonRows(),
          {
            monitorId: monitorId(2),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: before(WINDOW_START, 3),
            endsAt: null,
            isMonitoringOff: false,
          },
        ];

        await insertRows(rows);

        const both: Array<UptimeDayBucket> = (
          await groupDays({
            groups: [[monitorId(1), monitorId(2)]],
            zone: "UTC",
          })
        ).monitorGroups[0]!.buckets;

        for (const bucket of both) {
          expect(Object.keys(bucket)).not.toContain("monitoringOffSeconds");
        }

        // The second member turned off as well, on 5 April at 06:00.
        await database.query(`DELETE FROM "MonitorStatusTimeline"`);
        const secondOffAt: Date = new Date("2026-04-05T06:00:00.000Z");
        rows[2]!.endsAt = secondOffAt;
        rows.push({
          monitorId: monitorId(2),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: secondOffAt,
          endsAt: null,
          isMonitoringOff: true,
        });
        await insertRows(rows);

        for (const zone of ZONES) {
          expectBucketsToMatch(
            (
              await groupDays({
                groups: [[monitorId(1), monitorId(2)]],
                zone: zone,
              })
            ).monitorGroups[0]!.buckets,
            toDays(
              groupEvents({ rows, monitorIds: [monitorId(1), monitorId(2)] }),
              zone,
              offSpans({ rows, monitorIds: [monitorId(1), monitorId(2)] }),
            ),
          );
        }

        const utc: Array<UptimeDayBucket> = (
          await groupDays({
            groups: [[monitorId(1), monitorId(2)]],
            zone: "UTC",
          })
        ).monitorGroups[0]!.buckets;

        expect(
          bucketAt(utc, new Date("2026-04-05T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 6 * 3600,
          monitoringOffSeconds: 18 * 3600,
        });
        expect(
          bucketAt(utc, new Date("2026-04-06T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 0,
          statusDurations: [],
          monitoringOffSeconds: 86400,
        });
      });

      test("the uptime statements still leave the time out: it is no status's", async () => {
        await insertRows(offFromNoonRows());

        const merged: MergedDowntimeTotals = await mergedDowntime([
          monitorId(1),
        ]);

        // Operational to the switch, then nothing: no downtime, and no Offline.
        expect(merged.downtimeSeconds).toBe(0);
        expect(merged.coveredSeconds).toBeCloseTo(
          (switchedOffAt.getTime() - WINDOW_START.getTime()) / 1000,
          3,
        );
      });
    });

    describe("against the reference, on drawn timelines with monitoring turned off and back on", () => {
      const random: SeededRandom = seededRandom(6480);

      /*
       * Up to five monitors, each a run of rows with gaps, open rows in the
       * middle (orphans a racing writer left), deleted rows, rows that start
       * before the window and rows that end after it - and runs of rows with
       * monitoring off, a status changed by hand while it was off among them.
       * Rows of one monitor never overlap: a status event starts where the
       * one before it ends, or later.
       */
      function drawRows(monitorIds: Array<string>): Array<Row> {
        const rows: Array<Row> = [];

        for (const id of monitorIds) {
          let cursor: number =
            WINDOW_START.getTime() - random(5 * 24) * HOUR_MS;
          const rowCount: number = 1 + random(40);
          let isOff: boolean = random(4) === 0;

          for (let n: number = 0; n < rowCount; n++) {
            if (random(3) === 0) {
              cursor += random(3 * 24 * 60) * 60 * 1000;
            }

            // A third of the time the switch turns.
            if (random(3) === 0) {
              isOff = !isOff;
            }

            const length: number = (1 + random(4 * 24 * 60 * 60)) * 1000;
            const isOpen: boolean = random(12) === 0 || n === rowCount - 1;

            rows.push({
              monitorId: id,
              statusId: STATUSES[random(STATUSES.length)]!.id!.toString(),
              startsAt: new Date(cursor),
              endsAt: isOpen ? null : new Date(cursor + length),
              isMonitoringOff: isOff,
              deletedAt:
                random(30) === 0 ? new Date("2026-04-20T00:00:00.000Z") : null,
            });

            cursor += length;
          }
        }

        return rows;
      }

      test.each(ZONES)(
        "a monitor's days and a group's days match the reference in %s",
        async (zone: string) => {
          for (let draw: number = 0; draw < 6; draw++) {
            await database.query(`DELETE FROM "MonitorStatusTimeline"`);

            const ids: Array<string> = Array.from(
              { length: 1 + random(5) },
              (_: unknown, index: number) => {
                return monitorId(draw * 10 + index + 1);
              },
            );

            const rows: Array<Row> = drawRows(ids);
            await insertRows(rows);

            const monitors: UptimeDailyAggregate = await monitorDays({
              monitorIds: ids,
              zone: zone,
            });

            for (const id of ids) {
              const monitor: { buckets: Array<UptimeDayBucket> } | undefined =
                monitors.monitors.find((candidate: { monitorId: ObjectID }) => {
                  return candidate.monitorId.toString() === id;
                });

              expectBucketsToMatch(
                monitor!.buckets,
                toDays(
                  monitorEvents({
                    rows,
                    monitorId: id,
                    startDate: WINDOW_START,
                    endDate: WINDOW_END,
                  }),
                  zone,
                  // And each day's time with monitoring off (#7112).
                  offSpans({ rows, monitorIds: [id] }),
                ),
              );
            }

            const groups: MonitorGroupUptimeDailyAggregate = await groupDays({
              groups: [ids, [ids[0]!]],
              zone: zone,
            });

            expectBucketsToMatch(
              groups.monitorGroups[0]!.buckets,
              toDays(
                groupEvents({ rows, monitorIds: ids }),
                zone,
                offSpans({ rows, monitorIds: ids }),
              ),
            );
            expectBucketsToMatch(
              groups.monitorGroups[1]!.buckets,
              toDays(
                groupEvents({ rows, monitorIds: [ids[0]!] }),
                zone,
                offSpans({ rows, monitorIds: [ids[0]!] }),
              ),
            );
          }
        },
      );

      test("a group's merged downtime and coverage match the reference", async () => {
        for (let draw: number = 0; draw < 10; draw++) {
          await database.query(`DELETE FROM "MonitorStatusTimeline"`);

          const ids: Array<string> = Array.from(
            { length: 1 + random(5) },
            (_: unknown, index: number) => {
              return monitorId(100 + draw * 10 + index);
            },
          );

          const rows: Array<Row> = drawRows(ids);
          await insertRows(rows);

          let covered: number = 0;
          let downtime: number = 0;

          for (const event of groupEvents({ rows, monitorIds: ids })) {
            const seconds: number =
              (new Date(event.endDate).getTime() -
                new Date(event.startDate).getTime()) /
              1000;
            covered += seconds;

            if (DOWNTIME_STATUS_IDS.includes(event.eventStatusId.toString())) {
              downtime += seconds;
            }
          }

          const merged: MergedDowntimeTotals = await mergedDowntime(ids);

          expect(merged.coveredSeconds).toBeCloseTo(covered, 3);
          expect(merged.downtimeSeconds).toBeCloseTo(downtime, 3);
        }
      });

      test("a monitor's rolling uptime matches the reference in every window", async () => {
        for (let draw: number = 0; draw < 12; draw++) {
          await database.query(`DELETE FROM "MonitorStatusTimeline"`);

          const id: string = monitorId(200 + draw);
          const rows: Array<Row> = drawRows([id]);
          await insertRows(rows);

          const totals: Array<MonitorUptimeWindowTotal> =
            await rollingTotals(id);

          ROLLING_WINDOWS.forEach(
            (
              window: { key: MonitorUptimeWindowKey; days: number },
              index: number,
            ) => {
              const startDate: Date = before(WINDOW_END, window.days);
              const seconds: Record<string, number> = {};
              let covered: number = 0;

              for (const event of monitorEvents({
                rows,
                monitorId: id,
                startDate: startDate,
                endDate: WINDOW_END,
              })) {
                const length: number =
                  (new Date(event.endDate).getTime() -
                    new Date(event.startDate).getTime()) /
                  1000;
                const statusId: string = event.eventStatusId.toString();
                seconds[statusId] = (seconds[statusId] || 0) + length;
                covered += length;
              }

              const total: MonitorUptimeWindowTotal = totals[index]!;

              expect(total.key).toBe(window.key);
              expect(total.coveredSeconds).toBeCloseTo(covered, 3);
              expect(
                total.statusDurations
                  .map((duration: UptimeStatusDuration) => {
                    return duration.monitorStatusId.toString();
                  })
                  .sort(),
              ).toEqual(Object.keys(seconds).sort());

              for (const duration of total.statusDurations) {
                expect(duration.seconds).toBeCloseTo(
                  seconds[duration.monitorStatusId.toString()]!,
                  3,
                );
              }
            },
          );
        }
      });
    });

    /*
     * THE TIME BEFORE A MONITOR'S FIRST CHECK (issue #8960). A monitor is
     * created in the operational status, and until something measures it
     * its row reads Waiting for data (Not monitored yet on a status page):
     * its bars, its rolling uptime, its group's bars and its group's uptime
     * leave that time out, so it neither shows green nor lifts or lowers a
     * percentage.
     */
    describe("the time before a monitor's first check (issue #8960)", () => {
      const createdAt: Date = new Date("2026-03-01T08:00:00.000Z");

      // A monitor created on 1 March, Operational ever since.
      function createdRows(id: string): Array<Row> {
        return [
          {
            monitorId: id,
            statusId: OPERATIONAL.id!.toString(),
            startsAt: createdAt,
            endsAt: null,
            isMonitoringOff: false,
          },
        ];
      }

      // A monitor checked from long before the window, Offline for a day.
      function checkedRows(id: string): Array<Row> {
        return [
          {
            monitorId: id,
            statusId: OPERATIONAL.id!.toString(),
            startsAt: before(WINDOW_START, 30),
            endsAt: new Date("2026-03-20T00:00:00.000Z"),
            isMonitoringOff: false,
          },
          {
            monitorId: id,
            statusId: OFFLINE.id!.toString(),
            startsAt: new Date("2026-03-20T00:00:00.000Z"),
            endsAt: new Date("2026-03-21T00:00:00.000Z"),
            isMonitoringOff: false,
          },
          {
            monitorId: id,
            statusId: OPERATIONAL.id!.toString(),
            startsAt: new Date("2026-03-21T00:00:00.000Z"),
            endsAt: null,
            isMonitoringOff: false,
          },
        ];
      }

      test("a monitor nothing has checked yet has no data: no day, no rolling window, nothing of its group's days or uptime", async () => {
        await insertRows([
          ...createdRows(monitorId(1)),
          ...checkedRows(monitorId(2)),
        ]);
        await insertMonitors([
          {
            monitorId: monitorId(1),
            monitorType: MonitorType.Website,
            firstMeasuredAt: null,
          },
          {
            monitorId: monitorId(2),
            monitorType: MonitorType.Website,
            firstMeasuredAt: before(WINDOW_START, 30),
          },
        ]);

        for (const zone of ZONES) {
          const aggregate: UptimeDailyAggregate = await monitorDays({
            monitorIds: [monitorId(1), monitorId(2)],
            zone: zone,
          });
          const unchecked: Array<UptimeDayBucket> = aggregate.monitors.find(
            (monitor: { monitorId: ObjectID }) => {
              return monitor.monitorId.toString() === monitorId(1);
            },
          )!.buckets;

          // Every day of the window comes back, and every one is no data.
          expect(unchecked.length).toBeGreaterThan(40);

          for (const bucket of unchecked) {
            expect(bucket.coveredSeconds).toBe(0);
            expect(bucket.statusDurations).toEqual([]);
            expect(Object.keys(bucket)).not.toContain("monitoringOffSeconds");
          }

          // Its group reads exactly what the monitor checked reads alone.
          const groups: MonitorGroupUptimeDailyAggregate = await groupDays({
            groups: [[monitorId(1), monitorId(2)], [monitorId(2)]],
            zone: zone,
          });

          expectSameBuckets(
            groups.monitorGroups[0]!.buckets,
            groups.monitorGroups[1]!.buckets,
          );
        }

        // Its rolling uptime: no data in every window.
        for (const total of await rollingTotals(monitorId(1))) {
          expect(total.coveredSeconds).toBe(0);
          expect(total.statusDurations).toEqual([]);
        }

        // The merged uptime: nothing of it, so its group reads as the other monitor.
        expect(await mergedDowntime([monitorId(1)])).toEqual({
          coveredSeconds: 0,
          downtimeSeconds: 0,
        });

        const alone: MergedDowntimeTotals = await mergedDowntime([
          monitorId(2),
        ]);
        const both: MergedDowntimeTotals = await mergedDowntime([
          monitorId(1),
          monitorId(2),
        ]);
        expectWithinAMicrosecond(both.coveredSeconds, alone.coveredSeconds);
        expectWithinAMicrosecond(both.downtimeSeconds, alone.downtimeSeconds);
        expectWithinAMicrosecond(alone.downtimeSeconds, 86400);
      });

      test("checked at last, its time counts from the first check: the day of it in part, the days before not at all", async () => {
        const firstCheck: Date = new Date("2026-03-10T15:00:00.000Z");

        await insertRows([
          // Created on 1 March, in the status every monitor starts in.
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: createdAt,
            endsAt: new Date("2026-03-12T00:00:00.000Z"),
            isMonitoringOff: false,
          },
          // Offline on the 12th, by its checks.
          {
            monitorId: monitorId(1),
            statusId: OFFLINE.id!.toString(),
            startsAt: new Date("2026-03-12T00:00:00.000Z"),
            endsAt: new Date("2026-03-12T06:00:00.000Z"),
            isMonitoringOff: false,
          },
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: new Date("2026-03-12T06:00:00.000Z"),
            endsAt: null,
            isMonitoringOff: false,
          },
        ]);
        await insertMonitors([
          {
            monitorId: monitorId(1),
            monitorType: MonitorType.Website,
            firstMeasuredAt: firstCheck,
          },
        ]);

        const buckets: Array<UptimeDayBucket> = (
          await monitorDays({ monitorIds: [monitorId(1)], zone: "UTC" })
        ).monitors[0]!.buckets;

        // Created on 1 March: the days before the first check are no data.
        expect(
          bucketAt(buckets, new Date("2026-03-05T00:00:00.000Z")),
        ).toMatchObject({ coveredSeconds: 0, statusDurations: [] });
        // The day of it, from 15:00.
        expect(
          bucketAt(buckets, new Date("2026-03-10T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 9 * 3600,
          statusDurations: [
            { monitorStatusId: OPERATIONAL.id, seconds: 9 * 3600 },
          ],
        });
        // Then as it always read.
        expect(
          bucketAt(buckets, new Date("2026-03-12T00:00:00.000Z")),
        ).toMatchObject({ coveredSeconds: 86400 });

        // Its 30 days start on 11 March at 15:45: after the first check, all of them.
        const last30Days: MonitorUptimeWindowTotal = (
          await rollingTotals(monitorId(1))
        )[2]!;
        expectWithinAMicrosecond(last30Days.coveredSeconds, 30 * 86400);

        // The merged uptime of it alone: from the first check, 6 hours down.
        const merged: MergedDowntimeTotals = await mergedDowntime([
          monitorId(1),
        ]);
        expectWithinAMicrosecond(
          merged.coveredSeconds,
          (WINDOW_END.getTime() - firstCheck.getTime()) / 1000,
        );
        expectWithinAMicrosecond(merged.downtimeSeconds, 6 * 3600);
      });

      test("a status something else recorded before the first check counts, as the monitor's row shows it; back in the status it starts in, it does not", async () => {
        // Created on 1 March; an incident marked it Offline on the 3rd for 6 hours.
        const rows: Array<Row> = [
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: createdAt,
            endsAt: new Date("2026-03-03T06:00:00.000Z"),
            isMonitoringOff: false,
          },
          {
            monitorId: monitorId(1),
            statusId: OFFLINE.id!.toString(),
            startsAt: new Date("2026-03-03T06:00:00.000Z"),
            endsAt: new Date("2026-03-03T12:00:00.000Z"),
            isMonitoringOff: false,
          },
          // A person set a status flagged operational and offline.
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL_AND_OFFLINE.id!.toString(),
            startsAt: new Date("2026-03-03T12:00:00.000Z"),
            endsAt: new Date("2026-03-03T14:00:00.000Z"),
            isMonitoringOff: false,
          },
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: new Date("2026-03-03T14:00:00.000Z"),
            endsAt: null,
            isMonitoringOff: false,
          },
        ];

        await insertRows(rows);
        await insertMonitors([
          {
            monitorId: monitorId(1),
            monitorType: MonitorType.IncomingRequest,
            firstMeasuredAt: null,
          },
        ]);

        const buckets: Array<UptimeDayBucket> = (
          await monitorDays({ monitorIds: [monitorId(1)], zone: "UTC" })
        ).monitors[0]!.buckets;

        expect(
          bucketAt(buckets, new Date("2026-03-03T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 8 * 3600,
          statusDurations: [
            { monitorStatusId: OFFLINE.id, seconds: 6 * 3600 },
            {
              monitorStatusId: OPERATIONAL_AND_OFFLINE.id,
              seconds: 2 * 3600,
            },
          ],
        });

        // Every other day: Operational, the status it started in - no data.
        for (const bucket of buckets) {
          if (
            bucket.bucketStart.getTime() !==
            new Date("2026-03-03T00:00:00.000Z").getTime()
          ) {
            expect(bucket.coveredSeconds).toBe(0);
          }
        }

        // The uptime it reads is that of the recorded time: Offline for 6 of 8 hours.
        const merged: MergedDowntimeTotals = await mergedDowntime([
          monitorId(1),
        ]);
        expectWithinAMicrosecond(merged.coveredSeconds, 8 * 3600);
        expectWithinAMicrosecond(merged.downtimeSeconds, 6 * 3600);

        // Checked from the 4th at noon: Operational counts from then.
        await database.query(
          `UPDATE "Monitor" SET "firstMeasuredAt" = $1 WHERE "_id" = $2`,
          [new Date("2026-03-04T12:00:00.000Z"), monitorId(1)],
        );

        const checked: Array<UptimeDayBucket> = (
          await monitorDays({ monitorIds: [monitorId(1)], zone: "UTC" })
        ).monitors[0]!.buckets;

        expect(
          bucketAt(checked, new Date("2026-03-04T00:00:00.000Z")),
        ).toMatchObject({
          coveredSeconds: 12 * 3600,
          statusDurations: [
            { monitorStatusId: OPERATIONAL.id, seconds: 12 * 3600 },
          ],
        });
        expect(
          bucketAt(checked, new Date("2026-03-03T00:00:00.000Z"))
            .coveredSeconds,
        ).toBe(8 * 3600);
      });

      test("time with monitoring off before the first check is still time with monitoring off (#7112), in a monitor's days and its group's", async () => {
        const switchedOffAt: Date = new Date("2026-03-05T18:00:00.000Z");

        const rows: Array<Row> = [
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: createdAt,
            endsAt: switchedOffAt,
            isMonitoringOff: false,
          },
          {
            monitorId: monitorId(1),
            statusId: OPERATIONAL.id!.toString(),
            startsAt: switchedOffAt,
            endsAt: null,
            isMonitoringOff: true,
          },
        ];

        await insertRows(rows);
        await insertMonitors([
          {
            monitorId: monitorId(1),
            monitorType: MonitorType.Website,
            firstMeasuredAt: null,
          },
        ]);

        for (const zone of ZONES) {
          const monitor: Array<UptimeDayBucket> = (
            await monitorDays({ monitorIds: [monitorId(1)], zone: zone })
          ).monitors[0]!.buckets;
          const group: Array<UptimeDayBucket> = (
            await groupDays({ groups: [[monitorId(1)]], zone: zone })
          ).monitorGroups[0]!.buckets;

          for (const buckets of [monitor, group]) {
            for (const bucket of buckets) {
              expect(bucket.coveredSeconds).toBe(0);
            }

            // Nothing checked, and monitoring off as the rows mark it.
            expectBucketsToMatch(
              buckets,
              toDays([], zone, offSpans({ rows, monitorIds: [monitorId(1)] })),
            );
          }
        }

        const utc: Array<UptimeDayBucket> = (
          await monitorDays({ monitorIds: [monitorId(1)], zone: "UTC" })
        ).monitors[0]!.buckets;

        // The day it was turned off: 6 hours off, and the 18 before it no data.
        expect(
          bucketAt(utc, new Date("2026-03-05T00:00:00.000Z")),
        ).toMatchObject({ coveredSeconds: 0, monitoringOffSeconds: 6 * 3600 });
        expect(
          Object.keys(bucketAt(utc, new Date("2026-03-04T00:00:00.000Z"))),
        ).not.toContain("monitoringOffSeconds");
      });

      test("a manual monitor, and a monitor the Monitor table does not hold, count from the start", async () => {
        await insertRows([
          ...createdRows(monitorId(1)),
          ...createdRows(monitorId(2)),
        ]);
        await insertMonitors([
          // A person sets a manual monitor's status: nothing will ever check it.
          {
            monitorId: monitorId(1),
            monitorType: MonitorType.Manual,
            firstMeasuredAt: null,
          },
        ]);

        const aggregate: UptimeDailyAggregate = await monitorDays({
          monitorIds: [monitorId(1), monitorId(2)],
          zone: "UTC",
        });

        for (const monitor of aggregate.monitors) {
          expect(
            bucketAt(monitor.buckets, new Date("2026-03-02T00:00:00.000Z"))
              .coveredSeconds,
          ).toBe(86400);
        }

        expectSameBuckets(
          aggregate.monitors[0]!.buckets,
          (
            await previousMonitorDays({
              monitorIds: [monitorId(1), monitorId(2)],
              zone: "UTC",
            })
          ).monitors[0]!.buckets,
        );
      });

      test("until the upgrade has put the first check right for history, nothing is cut: every monitor reads as it always did", async () => {
        /*
         * During an upgrade a result stamps its monitor with the upgrade's
         * time before BackfillMonitorFirstMeasuredAtForUptimeHistory gives
         * it its creation: until that row is there, no history may read
         * from the column.
         */
        await insertRows([
          ...createdRows(monitorId(1)),
          ...checkedRows(monitorId(2)),
        ]);
        await insertMonitors([
          {
            monitorId: monitorId(1),
            monitorType: MonitorType.Website,
            firstMeasuredAt: null,
          },
          {
            monitorId: monitorId(2),
            monitorType: MonitorType.Website,
            firstMeasuredAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]);

        await database.query(`DELETE FROM "DataMigrations"`);

        try {
          const ids: Array<string> = [monitorId(1), monitorId(2)];
          const [current, previous] = await Promise.all([
            monitorDays({ monitorIds: ids, zone: "UTC" }),
            previousMonitorDays({ monitorIds: ids, zone: "UTC" }),
          ]);

          current.monitors.forEach(
            (monitor: { buckets: Array<UptimeDayBucket> }, index: number) => {
              expectSameBuckets(
                monitor.buckets,
                previous.monitors[index]!.buckets,
              );
            },
          );

          const [merged, previousMerged] = await Promise.all([
            mergedDowntime(ids),
            previousMergedDowntime(ids),
          ]);
          expectWithinAMicrosecond(
            merged.coveredSeconds,
            previousMerged.coveredSeconds,
          );

          const [groups, previousGroups] = await Promise.all([
            groupDays({ groups: [ids], zone: "UTC" }),
            previousGroupDays({ groups: [ids], zone: "UTC" }),
          ]);
          expectSameBuckets(
            groups.monitorGroups[0]!.buckets,
            previousGroups.monitorGroups[0]!.buckets,
          );

          const [rolling, previousRolling] = await Promise.all([
            rollingTotals(monitorId(1)),
            previousRollingTotals(monitorId(1)),
          ]);
          rolling.forEach((total: MonitorUptimeWindowTotal, index: number) => {
            expectWithinAMicrosecond(
              total.coveredSeconds,
              previousRolling[index]!.coveredSeconds,
            );
          });
        } finally {
          await markTheUpgradeDone();
        }

        // Once it is there, the monitor nothing has checked has no data.
        const after: UptimeDailyAggregate = await monitorDays({
          monitorIds: [monitorId(1)],
          zone: "UTC",
        });

        for (const bucket of after.monitors[0]!.buckets) {
          expect(bucket.coveredSeconds).toBe(0);
        }
      });

      /*
       * Up to five monitors, each a run of rows as drawRows draws them above
       * - gaps, orphaned open rows, deleted rows, runs with monitoring off,
       * a status set by hand while it was off - each a website monitor first
       * checked before the window, inside it or after it, or not yet; a
       * manual monitor; or one the Monitor table does not hold.
       */
      const random: SeededRandom = seededRandom(8960);

      function drawFirstCheckRows(monitorIds: Array<string>): Array<Row> {
        const rows: Array<Row> = [];

        for (const id of monitorIds) {
          let cursor: number =
            WINDOW_START.getTime() - random(5 * 24) * HOUR_MS;
          const rowCount: number = 1 + random(30);
          let isOff: boolean = random(5) === 0;

          for (let n: number = 0; n < rowCount; n++) {
            if (random(3) === 0) {
              cursor += random(3 * 24 * 60) * 60 * 1000;
            }

            if (random(4) === 0) {
              isOff = !isOff;
            }

            const length: number = (1 + random(4 * 24 * 60 * 60)) * 1000;
            const isOpen: boolean = random(12) === 0 || n === rowCount - 1;

            rows.push({
              monitorId: id,
              // Half the time the status it starts in, so there is time to cut.
              statusId:
                random(2) === 0
                  ? OPERATIONAL.id!.toString()
                  : EVERY_STATUS[random(EVERY_STATUS.length)]!.id!.toString(),
              startsAt: new Date(cursor),
              endsAt: isOpen ? null : new Date(cursor + length),
              isMonitoringOff: isOff,
              deletedAt:
                random(30) === 0 ? new Date("2026-04-20T00:00:00.000Z") : null,
            });

            cursor += length;
          }
        }

        return rows;
      }

      function drawMonitors(monitorIds: Array<string>): Array<MonitorRow> {
        const monitors: Array<MonitorRow> = [];

        for (const id of monitorIds) {
          const shape: number = random(6);

          if (shape === 0) {
            continue; // not in the Monitor table
          }

          if (shape === 1) {
            monitors.push({
              monitorId: id,
              monitorType: MonitorType.Manual,
              firstMeasuredAt: random(2) === 0 ? null : WINDOW_START,
            });
            continue;
          }

          const at: number =
            WINDOW_START.getTime() -
            7 * DAY_MS +
            random(
              Math.round(
                (WINDOW_END.getTime() - WINDOW_START.getTime()) / 1000,
              ) +
                14 * 86400,
            ) *
              1000;

          monitors.push({
            monitorId: id,
            monitorType: MonitorType.Website,
            firstMeasuredAt: shape === 2 ? null : new Date(at),
          });
        }

        return monitors;
      }

      /*
       * The ranking the group statement reads, with the status flagged
       * operational and offline among them, as the page ranks its statuses.
       */
      const EVERY_RANKED_STATUS_ID: Array<string> =
        MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
          monitorStatuses: EVERY_STATUS,
          downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
        });

      test.each(FIRST_CHECK_ZONES)(
        "a monitor's days, a group's days, the merged uptime and the rolling windows match the reference in %s",
        async (zone: string) => {
          for (let draw: number = 0; draw < 5; draw++) {
            await database.query(`DELETE FROM "MonitorStatusTimeline"`);
            await database.query(`DELETE FROM "Monitor"`);

            const ids: Array<string> = Array.from(
              { length: 1 + random(5) },
              (_: unknown, index: number) => {
                return monitorId(300 + draw * 10 + index);
              },
            );

            const rows: Array<Row> = drawFirstCheckRows(ids);
            const monitors: Array<MonitorRow> = drawMonitors(ids);
            await insertRows(rows);
            await insertMonitors(monitors);

            const aggregate: UptimeDailyAggregate = await monitorDays({
              monitorIds: ids,
              zone: zone,
            });

            for (const id of ids) {
              expectBucketsToMatch(
                aggregate.monitors.find((monitor: { monitorId: ObjectID }) => {
                  return monitor.monitorId.toString() === id;
                })!.buckets,
                toDays(
                  checkedEvents({
                    rows,
                    monitorId: id,
                    startDate: WINDOW_START,
                    endDate: WINDOW_END,
                    monitors,
                  }),
                  zone,
                  offSpans({ rows, monitorIds: [id] }),
                ),
              );
            }

            const groups: MonitorGroupUptimeDailyAggregate =
              await MonitorStatusTimelineService.getMonitorGroupDailyUptimeAggregate(
                {
                  monitorGroups: [
                    {
                      monitorGroupId: new ObjectID(
                        "64830000-0000-4000-8000-000000000001",
                      ),
                      monitorIds: ids.map((id: string) => {
                        return new ObjectID(id);
                      }),
                    },
                  ],
                  rankedMonitorStatusIds: EVERY_RANKED_STATUS_ID,
                  startDate: WINDOW_START,
                  endDate: WINDOW_END,
                  timezone: zone,
                },
              );

            expectBucketsToMatch(
              groups.monitorGroups[0]!.buckets,
              toDays(
                checkedGroupEvents({ rows, monitorIds: ids, monitors }),
                zone,
                offSpans({ rows, monitorIds: ids }),
              ),
            );

            // The group's uptime is read from the same checked time.
            let covered: number = 0;
            let downtime: number = 0;

            for (const event of checkedGroupEvents({
              rows,
              monitorIds: ids,
              monitors,
            })) {
              const seconds: number =
                (new Date(event.endDate).getTime() -
                  new Date(event.startDate).getTime()) /
                1000;
              covered += seconds;

              if (
                DOWNTIME_STATUS_IDS.includes(event.eventStatusId.toString())
              ) {
                downtime += seconds;
              }
            }

            const merged: MergedDowntimeTotals = await mergedDowntime(ids);
            expect(merged.coveredSeconds).toBeCloseTo(covered, 3);
            expect(merged.downtimeSeconds).toBeCloseTo(downtime, 3);

            // And each monitor's rolling windows.
            for (const id of ids) {
              const totals: Array<MonitorUptimeWindowTotal> =
                await rollingTotals(id);

              ROLLING_WINDOWS.forEach(
                (
                  window: { key: MonitorUptimeWindowKey; days: number },
                  index: number,
                ) => {
                  const seconds: Record<string, number> = {};
                  let windowCovered: number = 0;

                  for (const event of checkedEvents({
                    rows,
                    monitorId: id,
                    startDate: before(WINDOW_END, window.days),
                    endDate: WINDOW_END,
                    monitors,
                  })) {
                    const length: number =
                      (new Date(event.endDate).getTime() -
                        new Date(event.startDate).getTime()) /
                      1000;
                    const statusId: string = event.eventStatusId.toString();
                    seconds[statusId] = (seconds[statusId] || 0) + length;
                    windowCovered += length;
                  }

                  const total: MonitorUptimeWindowTotal = totals[index]!;
                  expect(total.coveredSeconds).toBeCloseTo(windowCovered, 3);

                  for (const duration of total.statusDurations) {
                    expect(duration.seconds).toBeCloseTo(
                      seconds[duration.monitorStatusId.toString()]!,
                      3,
                    );
                  }
                  expect(total.statusDurations.length).toBe(
                    Object.keys(seconds).length,
                  );
                },
              );
            }
          }
        },
      );

      test("a monitor checked from the start reads exactly what all four statements read before", async () => {
        for (let draw: number = 0; draw < 12; draw++) {
          await database.query(`DELETE FROM "MonitorStatusTimeline"`);
          await database.query(`DELETE FROM "Monitor"`);

          const ids: Array<string> = Array.from(
            { length: 1 + random(5) },
            (_: unknown, index: number) => {
              return monitorId(500 + draw * 10 + index);
            },
          );

          const rows: Array<Row> = drawFirstCheckRows(ids);
          await insertRows(rows);

          /*
           * Each first checked no later than its first row starts - what
           * the upgrade stamps a monitor checked before the column existed
           * with is its creation - or a manual monitor.
           */
          await insertMonitors(
            ids.map((id: string): MonitorRow => {
              const firstRow: number = Math.min(
                ...rows
                  .filter((row: Row) => {
                    return row.monitorId === id;
                  })
                  .map((row: Row) => {
                    return row.startsAt.getTime();
                  }),
              );

              return {
                monitorId: id,
                monitorType:
                  random(4) === 0 ? MonitorType.Manual : MonitorType.Website,
                firstMeasuredAt: new Date(firstRow - random(3) * HOUR_MS),
              };
            }),
          );

          const zone: string =
            FIRST_CHECK_ZONES[draw % FIRST_CHECK_ZONES.length]!;

          const [current, previous] = await Promise.all([
            monitorDays({ monitorIds: ids, zone: zone }),
            previousMonitorDays({ monitorIds: ids, zone: zone }),
          ]);

          for (const id of ids) {
            const bucketsOf: (
              aggregate: UptimeDailyAggregate,
            ) => Array<UptimeDayBucket> = (
              aggregate: UptimeDailyAggregate,
            ): Array<UptimeDayBucket> => {
              return aggregate.monitors.find(
                (monitor: { monitorId: ObjectID }) => {
                  return monitor.monitorId.toString() === id;
                },
              )!.buckets;
            };

            expectSameBuckets(bucketsOf(current), bucketsOf(previous));

            const [rolling, previousRolling] = await Promise.all([
              rollingTotals(id),
              previousRollingTotals(id),
            ]);

            rolling.forEach(
              (total: MonitorUptimeWindowTotal, index: number) => {
                const previousTotal: MonitorUptimeWindowTotal =
                  previousRolling[index]!;

                expectWithinAMicrosecond(
                  total.coveredSeconds,
                  previousTotal.coveredSeconds,
                );
                expect(total.statusDurations.length).toBe(
                  previousTotal.statusDurations.length,
                );
                total.statusDurations.forEach(
                  (duration: UptimeStatusDuration, durationIndex: number) => {
                    expect(duration.monitorStatusId.toString()).toBe(
                      previousTotal.statusDurations[
                        durationIndex
                      ]!.monitorStatusId.toString(),
                    );
                    expectWithinAMicrosecond(
                      duration.seconds,
                      previousTotal.statusDurations[durationIndex]!.seconds,
                    );
                  },
                );
              },
            );
          }

          const [groups, previousGroups] = await Promise.all([
            groupDays({ groups: [ids, [ids[0]!]], zone: zone }),
            previousGroupDays({ groups: [ids, [ids[0]!]], zone: zone }),
          ]);

          groups.monitorGroups.forEach(
            (group: { buckets: Array<UptimeDayBucket> }, index: number) => {
              expectSameBuckets(
                group.buckets,
                previousGroups.monitorGroups[index]!.buckets,
              );
            },
          );

          const [merged, previousMerged] = await Promise.all([
            mergedDowntime(ids),
            previousMergedDowntime(ids),
          ]);

          expectWithinAMicrosecond(
            merged.coveredSeconds,
            previousMerged.coveredSeconds,
          );
          expectWithinAMicrosecond(
            merged.downtimeSeconds,
            previousMerged.downtimeSeconds,
          );
        }
      });
    });
  },
);
