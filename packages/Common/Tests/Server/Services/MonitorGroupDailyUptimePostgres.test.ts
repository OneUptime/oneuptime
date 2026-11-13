import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import {
  MonitorGroupUptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import ObjectID from "../../../Types/ObjectID";
import MonitorGroupUptimeDailyAggregateUtil from "../../../Utils/StatusPage/MonitorGroupUptimeDailyAggregateUtil";
import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import Event from "../../../Utils/Uptime/Event";
import MonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import WorstStatusTimeline from "../../../Utils/Uptime/WorstStatusTimeline";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { getJestSpyOn } from "../../Spy";
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
 * A MONITOR GROUP'S DAY, AGAINST POSTGRES.
 *
 * Issue #6697: a status page's day bar for a monitor group added up to
 * sixteen and a half hours on one finished day and to nine days on another,
 * because it was merged in the browser from capped rows by a merge that
 * compared each row with the last one it kept. The group's days are now
 * measured by the database (MonitorStatusTimelineService.
 * getMonitorGroupDailyUptimeAggregate): at every instant the worst status
 * among the group's monitors recorded then, the page's downtime statuses
 * outranking the rest, cut into the days of the visitor's zone.
 *
 * These run that SQL on real rows and check it against a reference written
 * apart from it - the rows turned into events as the browser does
 * (UptimeUtil.getMonitorEventsForId), merged by WorstStatusTimeline, and
 * cut into the days DayUptimeGraphUtil draws - in zones with DST changes,
 * half and three quarter hour offsets and clocks that change at midnight.
 * And against getMergedDowntimeSeconds: a group's days add up to the
 * downtime its uptime percentage is read from.
 *
 * Opt in with RUN_POSTGRES_MONITOR_GROUP_DAILY_UPTIME_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_MONITOR_GROUP_DAILY_UPTIME_TESTS=true \
 *   MONITOR_GROUP_DAILY_UPTIME_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITOR_GROUP_DAILY_UPTIME_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/MonitorGroupDailyUptimePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * MonitorStatusTimeline table's definition is copied from public into a
 * uniquely named schema that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MONITOR_GROUP_DAILY_UPTIME_TESTS"] === "true"
    ? describe
    : describe.skip;

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// a window well in the past, so now() clamps nothing.
const WINDOW_START: Date = new Date("2026-02-20T09:30:00.000Z");
const WINDOW_END: Date = new Date("2026-04-10T15:45:00.000Z");

const PROJECT_ID: string = "70000000-0000-4000-8000-000000000001";

interface StatusDefinition {
  status: MonitorStatus;
  isDowntime: boolean;
}

function makeStatus(data: {
  id: string;
  name: string;
  priority: number;
  color: Color;
  isOperationalState?: boolean | undefined;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.color;
  status.isOperationalState = data.isOperationalState === true;
  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus({
  id: "71000000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
  color: Green,
  isOperationalState: true,
});
const DEGRADED: MonitorStatus = makeStatus({
  id: "71000000-0000-4000-8000-000000000002",
  name: "Degraded",
  priority: 2,
  color: Yellow,
});
const OFFLINE: MonitorStatus = makeStatus({
  id: "71000000-0000-4000-8000-000000000003",
  name: "Offline",
  priority: 3,
  color: Red,
});
// a custom status above Offline that the page does not count as down.
const MAINTENANCE: MonitorStatus = makeStatus({
  id: "71000000-0000-4000-8000-000000000004",
  name: "Maintenance",
  priority: 4,
  color: new Color("#5b8def"),
});

const STATUSES: Array<StatusDefinition> = [
  { status: OPERATIONAL, isDowntime: false },
  { status: DEGRADED, isDowntime: true },
  { status: OFFLINE, isDowntime: true },
  { status: MAINTENANCE, isDowntime: false },
];

const DOWNTIME_STATUS_IDS: Array<string> = STATUSES.filter(
  (definition: StatusDefinition) => {
    return definition.isDowntime;
  },
).map((definition: StatusDefinition) => {
  return definition.status.id!.toString();
});

const RANKED_STATUS_IDS: Array<string> =
  MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
    monitorStatuses: STATUSES.map((definition: StatusDefinition) => {
      return definition.status;
    }),
    downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
  });

const ZONES: Array<string> = [
  "UTC",
  "Asia/Shanghai",
  "America/New_York",
  "Asia/Kolkata",
  "Australia/Lord_Howe",
  "America/Santiago",
  "Pacific/Chatham",
];

interface Row {
  monitorId: string;
  statusId: string;
  startsAt: Date;
  endsAt: Date | null;
  deletedAt?: Date | null | undefined;
}

function statusById(statusId: string): MonitorStatus {
  return STATUSES.find((definition: StatusDefinition) => {
    return definition.status.id!.toString() === statusId;
  })!.status;
}

// the rows as the browser holds them, for the reference.
function toTimeline(row: Row): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = new ObjectID(row.monitorId);
  timeline.monitorStatusId = new ObjectID(row.statusId);
  timeline.monitorStatus = statusById(row.statusId);
  timeline.startsAt = row.startsAt;

  if (row.endsAt) {
    timeline.endsAt = row.endsAt;
  }

  return timeline;
}

/*
 * The rows the SQL reads, by the same predicate: not deleted, started by the
 * window's end, and ended at or after its start or still open.
 */
function rowsTheQueryReads(rows: Array<Row>): Array<Row> {
  return rows.filter((row: Row) => {
    return (
      !row.deletedAt &&
      row.startsAt.getTime() <= WINDOW_END.getTime() &&
      (row.endsAt === null || row.endsAt.getTime() >= WINDOW_START.getTime())
    );
  });
}

interface ReferenceDay {
  bucketStart: number;
  bucketEnd: number;
  coveredSeconds: number;
  seconds: Record<string, number>;
}

/*
 * The reference: each monitor's rows as events, clipped to the window
 * (getMonitorEventsForId), every monitor of the group merged by the worst
 * status (WorstStatusTimeline), and the result cut into the days the strip
 * draws in the zone (DayUptimeGraphUtil.getDays), clipped to the window.
 */
function referenceDays(data: {
  rows: Array<Row>;
  monitorIds: Array<string>;
  zone: string;
}): Array<ReferenceDay> {
  const timelines: Array<MonitorStatusTimeline> = rowsTheQueryReads(
    data.rows,
  ).map(toTimeline);

  const events: Array<MonitorEvent> = [];

  for (const monitorId of Array.from(new Set(data.monitorIds))) {
    events.push(
      ...UptimeUtil.getMonitorEventsForId(new ObjectID(monitorId), timelines, {
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      }),
    );
  }

  const merged: Array<Event> = WorstStatusTimeline.merge(events, {
    downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
  });

  const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    timezone: data.zone,
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

    for (const piece of merged) {
      const from: number = Math.max(piece.startDate.getTime(), bucketStart);
      const to: number = Math.min(piece.endDate.getTime(), bucketEnd);

      if (to <= from) {
        continue;
      }

      const statusId: string = piece.eventStatusId.toString();
      seconds[statusId] = (seconds[statusId] || 0) + (to - from) / 1000;
      coveredMs += to - from;
    }

    return {
      bucketStart,
      bucketEnd,
      coveredSeconds: coveredMs / 1000,
      seconds,
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

    // a day adds up to the time the group was recorded, never more than the day.
    const total: number = bucket.statusDurations.reduce(
      (sum: number, duration: UptimeStatusDuration) => {
        return sum + duration.seconds;
      },
      0,
    );

    expect(total).toBeCloseTo(bucket.coveredSeconds, 4);
    expect(bucket.coveredSeconds).toBeLessThanOrEqual(
      (bucket.bucketEnd.getTime() - bucket.bucketStart.getTime()) / 1000 +
        0.001,
    );
  });
}

describePostgres(
  "MonitorStatusTimelineService.getMonitorGroupDailyUptimeAggregate on Postgres",
  () => {
    const schema: string = `group_daily_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")
      .slice(0, 16)}`;
    let database: DataSource;

    async function insertRows(rows: Array<Row>): Promise<void> {
      for (const row of rows) {
        await database.query(
          `INSERT INTO "MonitorStatusTimeline"
             ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt", "endsAt", "deletedAt")
           VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
          [
            ObjectID.generate().toString(),
            PROJECT_ID,
            row.monitorId,
            row.statusId,
            row.startsAt,
            row.endsAt,
            row.deletedAt || null,
          ],
        );
      }
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
                  `72000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                ),
                monitorIds: monitorIds.map((monitorId: string) => {
                  return new ObjectID(monitorId);
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

    function monitorId(n: number): string {
      return `73000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MONITOR_GROUP_DAILY_UPTIME_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MONITOR_GROUP_DAILY_UPTIME_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MONITOR_GROUP_DAILY_UPTIME_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: [],
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."MonitorStatusTimeline" (LIKE public."MonitorStatusTimeline" INCLUDING ALL)`,
      );

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

      // the service reads through its repository's manager: point it here.
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

    test("eight monitors Offline all day and one Operational make one day of Offline - the 7 November bar in the issue", async () => {
      const dayStart: Date = new Date("2026-03-07T00:00:00.000Z");
      const rows: Array<Row> = [];

      for (let n: number = 1; n <= 8; n++) {
        rows.push({
          monitorId: monitorId(n),
          statusId: OFFLINE.id!.toString(),
          startsAt: new Date(dayStart.getTime() - n * HOUR_MS),
          endsAt: new Date(dayStart.getTime() + DAY_MS + n * HOUR_MS),
        });
      }

      rows.push({
        monitorId: monitorId(9),
        statusId: OPERATIONAL.id!.toString(),
        startsAt: WINDOW_START,
        endsAt: null,
      });

      await insertRows(rows);

      const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays({
        groups: [
          Array.from({ length: 9 }, (_: unknown, i: number) => {
            return monitorId(i + 1);
          }),
        ],
        zone: "UTC",
      });

      const day: UptimeDayBucket = aggregate.monitorGroups[0]!.buckets.find(
        (bucket: UptimeDayBucket) => {
          return bucket.bucketStart.getTime() === dayStart.getTime();
        },
      )!;

      expect(day.daySeconds).toBe(86400);
      expect(day.coveredSeconds).toBeCloseTo(86400, 6);
      expect(day.statusDurations).toEqual([
        { monitorStatusId: OFFLINE.id, seconds: 86400 },
      ]);
    });

    test("in Shanghai the days are Shanghai's: an outage at 15:36 CST is on that date's bar", async () => {
      // 6 November in the issue: 15:36-15:37 CST is 07:36-07:37 UTC.
      await insertRows([
        {
          monitorId: monitorId(1),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: WINDOW_START,
          endsAt: new Date("2026-03-06T07:36:00.000Z"),
        },
        {
          monitorId: monitorId(1),
          statusId: OFFLINE.id!.toString(),
          startsAt: new Date("2026-03-06T07:36:00.000Z"),
          endsAt: new Date("2026-03-06T07:37:00.000Z"),
        },
        {
          monitorId: monitorId(1),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: new Date("2026-03-06T07:37:00.000Z"),
          endsAt: null,
        },
        {
          monitorId: monitorId(2),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: WINDOW_START,
          endsAt: null,
        },
      ]);

      const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays({
        groups: [[monitorId(1), monitorId(2)]],
        zone: "Asia/Shanghai",
      });

      expect(aggregate.timezone).toBe("Asia/Shanghai");

      // 6 March in Shanghai starts at 16:00 UTC on 5 March.
      const shanghaiDay: UptimeDayBucket =
        aggregate.monitorGroups[0]!.buckets.find((bucket: UptimeDayBucket) => {
          return (
            bucket.bucketStart.toISOString() === "2026-03-05T16:00:00.000Z"
          );
        })!;

      expect(shanghaiDay.bucketEnd.toISOString()).toBe(
        "2026-03-06T16:00:00.000Z",
      );
      expect(secondsOf(shanghaiDay)).toEqual({
        [OPERATIONAL.id!.toString()]: 86340,
        [OFFLINE.id!.toString()]: 60,
      });
    });

    test("a day no monitor of the group recorded all of covers only the recorded part", async () => {
      await insertRows([
        {
          monitorId: monitorId(1),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: new Date("2026-03-10T06:00:00.000Z"),
          endsAt: new Date("2026-03-10T10:00:00.000Z"),
        },
        {
          monitorId: monitorId(2),
          statusId: OFFLINE.id!.toString(),
          startsAt: new Date("2026-03-10T09:00:00.000Z"),
          endsAt: new Date("2026-03-10T12:00:00.000Z"),
        },
      ]);

      const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays({
        groups: [[monitorId(1), monitorId(2)]],
        zone: "UTC",
      });

      const day: UptimeDayBucket = aggregate.monitorGroups[0]!.buckets.find(
        (bucket: UptimeDayBucket) => {
          return (
            bucket.bucketStart.toISOString() === "2026-03-10T00:00:00.000Z"
          );
        },
      )!;

      expect(day.coveredSeconds).toBeCloseTo(6 * 3600, 6);
      expect(secondsOf(day)).toEqual({
        [OPERATIONAL.id!.toString()]: 3 * 3600,
        [OFFLINE.id!.toString()]: 3 * 3600,
      });

      // and the days nobody recorded are no-data days, not Operational ones.
      const otherDay: UptimeDayBucket =
        aggregate.monitorGroups[0]!.buckets.find((bucket: UptimeDayBucket) => {
          return (
            bucket.bucketStart.toISOString() === "2026-03-11T00:00:00.000Z"
          );
        })!;

      expect(otherDay.coveredSeconds).toBe(0);
      expect(otherDay.statusDurations).toEqual([]);
    });

    test("the page's downtime statuses outrank a status above them that is not down", async () => {
      await insertRows([
        {
          monitorId: monitorId(1),
          statusId: OFFLINE.id!.toString(),
          startsAt: new Date("2026-03-12T00:00:00.000Z"),
          endsAt: new Date("2026-03-12T10:00:00.000Z"),
        },
        {
          monitorId: monitorId(2),
          statusId: MAINTENANCE.id!.toString(),
          startsAt: new Date("2026-03-12T00:00:00.000Z"),
          endsAt: new Date("2026-03-13T00:00:00.000Z"),
        },
      ]);

      const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays({
        groups: [[monitorId(1), monitorId(2)]],
        zone: "UTC",
      });

      const day: UptimeDayBucket = aggregate.monitorGroups[0]!.buckets.find(
        (bucket: UptimeDayBucket) => {
          return (
            bucket.bucketStart.toISOString() === "2026-03-12T00:00:00.000Z"
          );
        },
      )!;

      expect(secondsOf(day)).toEqual({
        [OFFLINE.id!.toString()]: 10 * 3600,
        [MAINTENANCE.id!.toString()]: 14 * 3600,
      });
    });

    test("an open row runs to the next row's start, deleted rows count for nothing, and a status not ranked is left out", async () => {
      await insertRows([
        // open, but followed by a later row of its monitor: ends at 08:00.
        {
          monitorId: monitorId(1),
          statusId: OFFLINE.id!.toString(),
          startsAt: new Date("2026-03-14T02:00:00.000Z"),
          endsAt: null,
        },
        {
          monitorId: monitorId(1),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: new Date("2026-03-14T08:00:00.000Z"),
          endsAt: new Date("2026-03-14T20:00:00.000Z"),
        },
        // deleted: nothing.
        {
          monitorId: monitorId(2),
          statusId: OFFLINE.id!.toString(),
          startsAt: new Date("2026-03-14T12:00:00.000Z"),
          endsAt: new Date("2026-03-14T23:00:00.000Z"),
          deletedAt: new Date("2026-03-15T00:00:00.000Z"),
        },
        // a status the project no longer has: left out.
        {
          monitorId: monitorId(2),
          statusId: "71000000-0000-4000-8000-0000000000ff",
          startsAt: new Date("2026-03-14T20:00:00.000Z"),
          endsAt: new Date("2026-03-14T22:00:00.000Z"),
        },
      ]);

      const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays({
        groups: [[monitorId(1), monitorId(2)]],
        zone: "UTC",
      });

      const day: UptimeDayBucket = aggregate.monitorGroups[0]!.buckets.find(
        (bucket: UptimeDayBucket) => {
          return (
            bucket.bucketStart.toISOString() === "2026-03-14T00:00:00.000Z"
          );
        },
      )!;

      expect(secondsOf(day)).toEqual({
        [OFFLINE.id!.toString()]: 6 * 3600,
        [OPERATIONAL.id!.toString()]: 12 * 3600,
      });
      expect(day.coveredSeconds).toBeCloseTo(18 * 3600, 6);
    });

    test("every group asked for comes back in order, a group with no monitors with empty days, and groups may share monitors", async () => {
      await insertRows([
        {
          monitorId: monitorId(1),
          statusId: OFFLINE.id!.toString(),
          startsAt: WINDOW_START,
          endsAt: null,
        },
        {
          monitorId: monitorId(2),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: WINDOW_START,
          endsAt: null,
        },
      ]);

      const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays({
        groups: [
          [monitorId(2)],
          [],
          [monitorId(1), monitorId(2), monitorId(1)],
        ],
        zone: "UTC",
      });

      expect(aggregate.monitorGroups).toHaveLength(3);

      const [onlyUp, empty, both] = aggregate.monitorGroups;
      const dayCount: number = DayUptimeGraphUtil.getDays({
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        timezone: "UTC",
      }).length;

      for (const group of aggregate.monitorGroups) {
        expect(group.buckets).toHaveLength(dayCount);
      }

      expect(
        onlyUp!.buckets.every((bucket: UptimeDayBucket) => {
          return (
            bucket.statusDurations.length === 1 &&
            bucket.statusDurations[0]!.monitorStatusId.toString() ===
              OPERATIONAL.id!.toString()
          );
        }),
      ).toBe(true);

      expect(
        empty!.buckets.every((bucket: UptimeDayBucket) => {
          return (
            bucket.coveredSeconds === 0 && bucket.statusDurations.length === 0
          );
        }),
      ).toBe(true);

      // a monitor listed twice is one monitor: Offline all along, counted once.
      for (const bucket of both!.buckets) {
        expect(secondsOf(bucket)).toEqual({
          [OFFLINE.id!.toString()]: bucket.daySeconds,
        });
      }
    });

    describe("against the reference, on drawn timelines in seven zones", () => {
      const random: SeededRandom = seededRandom(6697);

      /*
       * Up to six monitors per group, each a run of rows with gaps, rows that
       * overlap their own monitor's (old deletes left that), open rows in the
       * middle (orphans a racing writer left), deleted rows, rows that start
       * before the window and rows that end after it.
       */
      function drawRows(monitorIds: Array<string>): Array<Row> {
        const rows: Array<Row> = [];

        for (const id of monitorIds) {
          let cursor: number =
            WINDOW_START.getTime() - random(5 * 24) * HOUR_MS;
          const rowCount: number = 1 + random(40);

          for (let n: number = 0; n < rowCount; n++) {
            const shape: number = random(10);

            if (shape < 2) {
              cursor += random(3 * 24 * 60) * 60 * 1000;
            } else if (shape === 2) {
              cursor -= random(6 * 60) * 60 * 1000;
            }

            const length: number = (1 + random(4 * 24 * 60 * 60)) * 1000;
            const definition: StatusDefinition =
              STATUSES[random(STATUSES.length)]!;
            const isOpen: boolean = random(12) === 0 || n === rowCount - 1;

            rows.push({
              monitorId: id,
              statusId: definition.status.id!.toString(),
              startsAt: new Date(cursor),
              endsAt: isOpen ? null : new Date(cursor + length),
              deletedAt:
                random(30) === 0 ? new Date("2026-04-20T00:00:00.000Z") : null,
            });

            cursor += length;
          }
        }

        return rows;
      }

      test.each(ZONES)(
        "matches the reference day by day in %s",
        async (zone: string) => {
          for (let draw: number = 0; draw < 6; draw++) {
            await database.query(`DELETE FROM "MonitorStatusTimeline"`);

            const monitorCount: number = 1 + random(6);
            const ids: Array<string> = Array.from(
              { length: monitorCount },
              (_: unknown, index: number) => {
                return monitorId(draw * 10 + index + 1);
              },
            );

            const rows: Array<Row> = drawRows(ids);
            await insertRows(rows);

            // the whole group, and a group of its first monitor only.
            const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays(
              { groups: [ids, [ids[0]!]], zone: zone },
            );

            expect(aggregate.timezone).toBe(zone);

            expectBucketsToMatch(
              aggregate.monitorGroups[0]!.buckets,
              referenceDays({ rows, monitorIds: ids, zone }),
            );
            expectBucketsToMatch(
              aggregate.monitorGroups[1]!.buckets,
              referenceDays({ rows, monitorIds: [ids[0]!], zone }),
            );
          }
        },
      );

      test("a group's days add up to the merged downtime and coverage its uptime percentage is read from", async () => {
        for (let draw: number = 0; draw < 8; draw++) {
          await database.query(`DELETE FROM "MonitorStatusTimeline"`);

          const ids: Array<string> = Array.from(
            { length: 1 + random(6) },
            (_: unknown, index: number) => {
              return monitorId(100 + draw * 10 + index);
            },
          );

          await insertRows(drawRows(ids));

          const zone: string = ZONES[draw % ZONES.length]!;
          const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays({
            groups: [ids],
            zone: zone,
          });

          const merged: MergedDowntimeTotals =
            await MonitorStatusTimelineService.getMergedDowntimeSeconds({
              monitorIds: ids.map((id: string) => {
                return new ObjectID(id);
              }),
              downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
              startDate: WINDOW_START,
              endDate: WINDOW_END,
            });

          let covered: number = 0;
          let downtime: number = 0;

          for (const bucket of aggregate.monitorGroups[0]!.buckets) {
            covered += bucket.coveredSeconds;

            for (const duration of bucket.statusDurations) {
              if (
                DOWNTIME_STATUS_IDS.includes(
                  duration.monitorStatusId.toString(),
                )
              ) {
                downtime += duration.seconds;
              }
            }
          }

          expect(covered).toBeCloseTo(merged.coveredSeconds, 3);
          expect(downtime).toBeCloseTo(merged.downtimeSeconds, 3);
        }
      });
    });

    test("its day grid is the monitors' day grid, in every zone", async () => {
      await insertRows([
        {
          monitorId: monitorId(1),
          statusId: OPERATIONAL.id!.toString(),
          startsAt: WINDOW_START,
          endsAt: null,
        },
      ]);

      for (const zone of ZONES) {
        const [groups, monitors] = await Promise.all([
          groupDays({ groups: [[monitorId(1)]], zone: zone }),
          MonitorStatusTimelineService.getDailyUptimeAggregate({
            monitorIds: [new ObjectID(monitorId(1))],
            startDate: WINDOW_START,
            endDate: WINDOW_END,
            timezone: zone,
          }),
        ]);

        const gridOf: (buckets: Array<UptimeDayBucket>) => Array<string> = (
          buckets: Array<UptimeDayBucket>,
        ): Array<string> => {
          return buckets.map((bucket: UptimeDayBucket) => {
            return `${bucket.bucketStart.toISOString()} ${bucket.bucketEnd.toISOString()} ${bucket.daySeconds}`;
          });
        };

        expect(gridOf(groups.monitorGroups[0]!.buckets)).toEqual(
          gridOf(monitors.monitors[0]!.buckets),
        );

        // and one monitor's group reads exactly what the monitor reads.
        groups.monitorGroups[0]!.buckets.forEach(
          (bucket: UptimeDayBucket, index: number) => {
            expect(bucket.coveredSeconds).toBeCloseTo(
              monitors.monitors[0]!.buckets[index]!.coveredSeconds,
              6,
            );
          },
        );
      }
    });

    test("measures a flapping page's group in a few seconds", async () => {
      // three monitors changing status every 30 seconds for twelve days.
      const values: Array<string> = [];
      const params: Array<unknown> = [];
      let parameter: number = 1;

      const flush: () => Promise<void> = async (): Promise<void> => {
        if (values.length === 0) {
          return;
        }

        await database.query(
          `INSERT INTO "MonitorStatusTimeline"
             ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt", "endsAt")
           VALUES ${values.join(",")}`,
          params,
        );
        values.length = 0;
        params.length = 0;
        parameter = 1;
      };

      for (let n: number = 1; n <= 3; n++) {
        const start: number = Date.parse("2026-03-20T00:00:00.000Z");

        for (let row: number = 0; row < 12 * 2880; row++) {
          values.push(
            `(gen_random_uuid(), 1, $${parameter}, $${parameter + 1}, $${parameter + 2}, $${parameter + 3}, $${parameter + 4})`,
          );
          params.push(
            PROJECT_ID,
            monitorId(n),
            (row % 2 === 0 ? OPERATIONAL : OFFLINE).id!.toString(),
            new Date(start + row * 30_000 + n * 1000),
            new Date(start + (row + 1) * 30_000 + n * 1000),
          );
          parameter += 5;

          if (values.length === 2000) {
            await flush();
          }
        }
      }

      await flush();
      await database.query(`ANALYZE "MonitorStatusTimeline"`);

      const startedAt: number = Date.now();
      const aggregate: MonitorGroupUptimeDailyAggregate = await groupDays({
        groups: [[monitorId(1), monitorId(2), monitorId(3)]],
        zone: "America/New_York",
      });
      const elapsed: number = Date.now() - startedAt;

      const flappingDay: UptimeDayBucket =
        aggregate.monitorGroups[0]!.buckets.find((bucket: UptimeDayBucket) => {
          return (
            bucket.bucketStart.toISOString() === "2026-03-25T04:00:00.000Z"
          );
        })!;

      // a whole day, at most: never a day per monitor.
      expect(flappingDay.coveredSeconds).toBeCloseTo(86400, 3);
      expect(elapsed).toBeLessThan(15_000);
    });
  },
);
