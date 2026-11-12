import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
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
 * Opt in with RUN_POSTGRES_MONITORING_OFF_UPTIME_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_MONITORING_OFF_UPTIME_TESTS=true \
 *   MONITORING_OFF_UPTIME_TEST_DATABASE_HOST=127.0.0.1 \
 *   MONITORING_OFF_UPTIME_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/MonitorStatusTimelineMonitoringOffPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * MonitorStatusTimeline table's definition is copied from public into a
 * uniquely named schema that is dropped afterwards; every row is synthetic.
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
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.color;
  status.isOperationalState = data.name === "Operational";
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
});

const STATUSES: Array<MonitorStatus> = [OPERATIONAL, DEGRADED, OFFLINE];

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

interface Row {
  monitorId: string;
  statusId: string;
  startsAt: Date;
  endsAt: Date | null;
  isMonitoringOff: boolean;
  deletedAt?: Date | null | undefined;
}

function statusById(statusId: string): MonitorStatus {
  return STATUSES.find((status: MonitorStatus) => {
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

interface ReferenceDay {
  bucketStart: number;
  bucketEnd: number;
  coveredSeconds: number;
  seconds: Record<string, number>;
}

// Events cut into the days the strip draws in the zone, clipped to the window.
function toDays(events: Array<Event>, zone: string): Array<ReferenceDay> {
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
                ),
              );
            }

            const groups: MonitorGroupUptimeDailyAggregate = await groupDays({
              groups: [ids, [ids[0]!]],
              zone: zone,
            });

            expectBucketsToMatch(
              groups.monitorGroups[0]!.buckets,
              toDays(groupEvents({ rows, monitorIds: ids }), zone),
            );
            expectBucketsToMatch(
              groups.monitorGroups[1]!.buckets,
              toDays(groupEvents({ rows, monitorIds: [ids[0]!] }), zone),
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
  },
);
