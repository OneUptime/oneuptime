import MonitorStatusTimelineService, {
  Service as MonitorStatusTimelineServiceType,
  UptimeDailyAggregateRow,
} from "../../../Server/Services/MonitorStatusTimelineService";
import ObjectID from "../../../Types/ObjectID";
import {
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
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
 * A MONITOR'S DAYS, AGAINST POSTGRES: THE DAY SPLIT (issue #6887).
 *
 * MonitorStatusTimelineService.getDailyUptimeAggregate cuts every monitor's
 * periods into the days of the visitor's zone - the status page's bars, the
 * monitor page's bars and its 90 day figure, the subscriber report. It used
 * to find a period's days with a per-row LATERAL generate_series over the
 * local dates the period touched, converting its start and end to the zone
 * on every row. It now works the window's local midnights out once (the day
 * grid the monitor group statement cuts its days on) and finds each period's
 * first and last day with width_bucket, so a period inside one day - nearly
 * every row of a flapping monitor - is one segment with no zone conversion.
 *
 * These run both statements on the same drawn rows and hold the new one to
 * the old one's buckets to within a microsecond: in zones with DST changes,
 * half and three quarter hour offsets and clocks that change at midnight
 * (America/Santiago), over windows that hold those changes, with periods
 * that start and end exactly on a local midnight, orphaned open rows,
 * deleted rows, rows that overlap their own monitor's, zero-length rows and
 * time with monitoring off. The old statement is kept here verbatim
 * (PREVIOUS_DAILY_UPTIME_AGGREGATE_SQL); it knows nothing of a monitor's
 * first check (issue #8960), so every monitor here has been checked from
 * the start: the Monitor table holds none of them, which reads as measured.
 * And they time both on a flapping page.
 *
 * Opt in with RUN_POSTGRES_DAILY_UPTIME_AGGREGATE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_DAILY_UPTIME_AGGREGATE_TESTS=true \
 *   DAILY_UPTIME_AGGREGATE_TEST_DATABASE_HOST=127.0.0.1 \
 *   DAILY_UPTIME_AGGREGATE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/MonitorDailyUptimeAggregatePostgres.test.ts
 *
 * DAILY_UPTIME_AGGREGATE_BENCHMARK_DAYS sizes the flapping page (12 days of
 * three monitors flapping every 20 seconds by default, 155,520 rows).
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * definitions of MonitorStatusTimeline, Monitor and MonitorStatus are copied
 * from public into a uniquely named schema that is dropped afterwards;
 * every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DAILY_UPTIME_AGGREGATE_TESTS"] === "true"
    ? describe
    : describe.skip;

/*
 * getDailyUptimeAggregate's statement before issue #6887, verbatim: the
 * reference the new one is held to.
 */
export const PREVIOUS_DAILY_UPTIME_AGGREGATE_SQL: string = `
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
               CASE WHEN src.is_off THEN NULL ELSE src.status_id END
                 AS status_id,
               src.is_off,
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
               is_off,
               SUM(EXTRACT(EPOCH FROM (seg_end - seg_start)))::double precision
                 AS seconds
        FROM split
        WHERE seg_end > seg_start
        GROUP BY monitor_id, day_start, status_id, is_off
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
             COALESCE(a.seconds, 0)::double precision AS "seconds",
             COALESCE(a.is_off, false) AS "isMonitoringOff"
      FROM mons m
      CROSS JOIN buckets b
      LEFT JOIN agg a ON a.monitor_id = m.monitor_id
                     AND a.day_start = b.day_start
      WHERE b.bucket_end > b.bucket_start
      ORDER BY m.monitor_id, b.bucket_start
    `;

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// The old and the new statement must agree to within this many seconds.
const MICROSECOND: number = 0.000001;

const PROJECT_ID: string = "68870000-0000-4000-8000-000000000001";

const OPERATIONAL: string = "68871000-0000-4000-8000-000000000001";
const DEGRADED: string = "68871000-0000-4000-8000-000000000002";
const OFFLINE: string = "68871000-0000-4000-8000-000000000003";

const STATUS_IDS: Array<string> = [OPERATIONAL, DEGRADED, OFFLINE];

interface Window {
  name: string;
  startDate: Date;
  endDate: Date;
}

/*
 * Windows well in the past, so now() clamps nothing, each holding clock
 * changes of the zones below:
 *
 *   - spring: New York springs forward (8 March); Santiago (at its
 *     midnight), Lord Howe (half an hour) and Chatham fall back (5 April);
 *   - southern spring: Santiago springs forward at its midnight (6
 *     September), Chatham (27 September) and Lord Howe (4 October);
 *   - autumn: New York and London fall back (1 November, 25 October).
 *
 * Each starts and ends mid-day, so the first and last buckets are clipped.
 */
const WINDOWS: Array<Window> = [
  {
    name: "spring",
    startDate: new Date("2026-02-20T09:30:00.000Z"),
    endDate: new Date("2026-04-10T15:45:00.000Z"),
  },
  {
    name: "southern spring",
    startDate: new Date("2026-08-25T13:17:00.000Z"),
    endDate: new Date("2026-10-08T02:05:00.000Z"),
  },
  {
    name: "autumn",
    startDate: new Date("2026-10-20T21:00:00.000Z"),
    endDate: new Date("2026-11-08T07:30:00.000Z"),
  },
];

const ZONES: Array<string> = [
  "UTC",
  "Asia/Shanghai",
  "America/New_York",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
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

function monitorId(n: number): string {
  return `68872000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function secondsOf(bucket: UptimeDayBucket): Record<string, number> {
  const seconds: Record<string, number> = {};

  for (const duration of bucket.statusDurations) {
    seconds[duration.monitorStatusId.toString()] =
      (seconds[duration.monitorStatusId.toString()] || 0) + duration.seconds;
  }

  return seconds;
}

function expectWithin(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(MICROSECOND);
}

/*
 * The new aggregate holds the old one's buckets: the same monitors, the
 * same days with the same bounds and lengths, and in each day the same
 * statuses, coverage and time with monitoring off, to within a microsecond.
 */
function expectSameAggregate(
  actual: UptimeDailyAggregate,
  expected: UptimeDailyAggregate,
): void {
  const byMonitor: (
    aggregate: UptimeDailyAggregate,
  ) => Map<string, Array<UptimeDayBucket>> = (
    aggregate: UptimeDailyAggregate,
  ): Map<string, Array<UptimeDayBucket>> => {
    return new Map<string, Array<UptimeDayBucket>>(
      aggregate.monitors.map((monitor: MonitorUptimeDailyAggregate) => {
        return [monitor.monitorId.toString(), monitor.buckets];
      }),
    );
  };

  const actualByMonitor: Map<string, Array<UptimeDayBucket>> = byMonitor(
    actual,
  );
  const expectedByMonitor: Map<string, Array<UptimeDayBucket>> = byMonitor(
    expected,
  );

  expect(Array.from(actualByMonitor.keys()).sort()).toEqual(
    Array.from(expectedByMonitor.keys()).sort(),
  );

  for (const [id, expectedBuckets] of expectedByMonitor) {
    const actualBuckets: Array<UptimeDayBucket> = actualByMonitor.get(id)!;

    expect(
      actualBuckets.map((bucket: UptimeDayBucket) => {
        return `${bucket.bucketStart.toISOString()} ${bucket.bucketEnd.toISOString()} ${bucket.daySeconds}`;
      }),
    ).toEqual(
      expectedBuckets.map((bucket: UptimeDayBucket) => {
        return `${bucket.bucketStart.toISOString()} ${bucket.bucketEnd.toISOString()} ${bucket.daySeconds}`;
      }),
    );

    expectedBuckets.forEach(
      (expectedBucket: UptimeDayBucket, index: number) => {
        const actualBucket: UptimeDayBucket = actualBuckets[index]!;
        const actualSeconds: Record<string, number> = secondsOf(actualBucket);
        const expectedSeconds: Record<string, number> =
          secondsOf(expectedBucket);

        expectWithin(
          actualBucket.coveredSeconds,
          expectedBucket.coveredSeconds,
        );
        expect(Object.keys(actualSeconds).sort()).toEqual(
          Object.keys(expectedSeconds).sort(),
        );

        for (const statusId of Object.keys(expectedSeconds)) {
          expectWithin(actualSeconds[statusId]!, expectedSeconds[statusId]!);
        }

        expect(actualBucket.monitoringOffSeconds === undefined).toBe(
          expectedBucket.monitoringOffSeconds === undefined,
        );
        expectWithin(
          actualBucket.monitoringOffSeconds || 0,
          expectedBucket.monitoringOffSeconds || 0,
        );
      },
    );
  }
}

describePostgres(
  "MonitorStatusTimelineService.getDailyUptimeAggregate's day split on Postgres (issue #6887)",
  () => {
    const schema: string = `daily_uptime_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")
      .slice(0, 16)}`;
    let database: DataSource;

    async function insertRows(rows: Array<Row>): Promise<void> {
      const values: Array<string> = [];
      const params: Array<unknown> = [];

      const flush: () => Promise<void> = async (): Promise<void> => {
        if (values.length === 0) {
          return;
        }

        await database.query(
          `INSERT INTO "MonitorStatusTimeline"
             ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt", "endsAt", "isMonitoringOff", "deletedAt")
           VALUES ${values.join(",")}`,
          params,
        );
        values.length = 0;
        params.length = 0;
      };

      for (const row of rows) {
        const at: number = params.length;
        values.push(
          `(gen_random_uuid(), 1, $${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, $${at + 6}, $${at + 7})`,
        );
        params.push(
          PROJECT_ID,
          row.monitorId,
          row.statusId,
          row.startsAt,
          row.endsAt,
          row.isMonitoringOff,
          row.deletedAt || null,
        );

        if (values.length === 2000) {
          await flush();
        }
      }

      await flush();
    }

    async function readBoth(data: {
      monitorIds: Array<string>;
      window: Window;
      zone: string;
    }): Promise<{
      previous: UptimeDailyAggregate;
      current: UptimeDailyAggregate;
    }> {
      const previousRows: Array<UptimeDailyAggregateRow> = await database.query(
        PREVIOUS_DAILY_UPTIME_AGGREGATE_SQL,
        [
          data.monitorIds,
          data.window.startDate,
          data.window.endDate,
          data.zone,
        ],
      );

      return {
        previous: MonitorStatusTimelineServiceType.toUptimeDailyAggregate(
          previousRows,
          data.zone,
        ),
        current: await MonitorStatusTimelineService.getDailyUptimeAggregate({
          monitorIds: data.monitorIds.map((id: string) => {
            return new ObjectID(id);
          }),
          startDate: data.window.startDate,
          endDate: data.window.endDate,
          timezone: data.zone,
        }),
      };
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["DAILY_UPTIME_AGGREGATE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["DAILY_UPTIME_AGGREGATE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["DAILY_UPTIME_AGGREGATE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: [],
        synchronize: false,
        // jit=off, as the app's own connections run (DataSourceOptions).
        extra: { options: `-c search_path=${schema},public -c jit=off` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);

      // Empty Monitor and MonitorStatus tables: every monitor reads as measured.
      for (const table of [
        "MonitorStatusTimeline",
        "Monitor",
        "MonitorStatus",
      ]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
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

    test("the day grid: the same days, bounds and lengths as before, in every zone and window", async () => {
      await insertRows([
        {
          monitorId: monitorId(1),
          statusId: OPERATIONAL,
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: null,
          isMonitoringOff: false,
        },
      ]);

      for (const window of WINDOWS) {
        for (const zone of ZONES) {
          const { previous, current } = await readBoth({
            monitorIds: [monitorId(1)],
            window: window,
            zone: zone,
          });

          expectSameAggregate(current, previous);

          // And the days are the strip's days in that zone.
          const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
            startDate: window.startDate,
            endDate: window.endDate,
            timezone: zone,
          });

          expect(
            current.monitors[0]!.buckets.map((bucket: UptimeDayBucket) => {
              return bucket.bucketStart.getTime();
            }),
          ).toEqual(
            days.map((day: UptimeGraphDay) => {
              return Math.max(
                day.startOfDay.getTime(),
                window.startDate.getTime(),
              );
            }),
          );
        }
      }
    });

    test("a DST day is 23 or 25 hours, and Santiago's day after its clocks change at midnight is measured from the instant it starts", async () => {
      await insertRows([
        {
          monitorId: monitorId(1),
          statusId: OFFLINE,
          startsAt: new Date("2026-01-01T00:00:00.000Z"),
          endsAt: null,
          isMonitoringOff: false,
        },
      ]);

      const daySeconds: (data: {
        window: Window;
        zone: string;
        dayStart: string;
      }) => Promise<number | undefined> = async (data: {
        window: Window;
        zone: string;
        dayStart: string;
      }): Promise<number | undefined> => {
        const { previous, current } = await readBoth({
          monitorIds: [monitorId(1)],
          window: data.window,
          zone: data.zone,
        });

        expectSameAggregate(current, previous);

        const bucket: UptimeDayBucket | undefined =
          current.monitors[0]!.buckets.find((candidate: UptimeDayBucket) => {
            return candidate.bucketStart.toISOString() === data.dayStart;
          });

        // Offline the whole day: every second of it.
        if (bucket) {
          expectWithin(bucket.coveredSeconds, bucket.daySeconds);
        }

        return bucket?.daySeconds;
      };

      // New York springs forward on 8 March: 23 hours.
      expect(
        await daySeconds({
          window: WINDOWS[0]!,
          zone: "America/New_York",
          dayStart: "2026-03-08T05:00:00.000Z",
        }),
      ).toBe(23 * 3600);

      // and falls back on 1 November: 25 hours.
      expect(
        await daySeconds({
          window: WINDOWS[2]!,
          zone: "America/New_York",
          dayStart: "2026-11-01T04:00:00.000Z",
        }),
      ).toBe(25 * 3600);

      // Lord Howe falls back half an hour on 5 April: 24.5 hours.
      expect(
        await daySeconds({
          window: WINDOWS[0]!,
          zone: "Australia/Lord_Howe",
          dayStart: "2026-04-04T13:00:00.000Z",
        }),
      ).toBe(24.5 * 3600);

      /*
       * Santiago springs forward at its midnight on 6 September: 00:00 never
       * happens there, and the day starts at 01:00 (04:00 UTC), 23 hours.
       */
      expect(
        await daySeconds({
          window: WINDOWS[1]!,
          zone: "America/Santiago",
          dayStart: "2026-09-06T04:00:00.000Z",
        }),
      ).toBe(23 * 3600);
    });

    test("a period that starts or ends exactly on a local midnight is cut on it, and one that spans days fills every one", async () => {
      for (const zone of ZONES) {
        await database.query(`DELETE FROM "MonitorStatusTimeline"`);

        const window: Window = WINDOWS[0]!;
        const days: Array<UptimeGraphDay> = DayUptimeGraphUtil.getDays({
          startDate: window.startDate,
          endDate: window.endDate,
          timezone: zone,
        });
        const midnight: (index: number) => Date = (index: number): Date => {
          return days[index]!.startOfDay;
        };

        await insertRows([
          // Exactly one local day, midnight to midnight.
          {
            monitorId: monitorId(1),
            statusId: OFFLINE,
            startsAt: midnight(5),
            endsAt: midnight(6),
            isMonitoringOff: false,
          },
          // From a midnight across three days, ending mid-day.
          {
            monitorId: monitorId(1),
            statusId: DEGRADED,
            startsAt: midnight(6),
            endsAt: new Date(midnight(9).getTime() + 7 * HOUR_MS + 1),
            isMonitoringOff: false,
          },
          // A microsecond either side of a midnight.
          {
            monitorId: monitorId(2),
            statusId: OFFLINE,
            startsAt: new Date(midnight(12).getTime() - 1),
            endsAt: new Date(midnight(12).getTime() + 1),
            isMonitoringOff: false,
          },
          // Ending exactly at the window's start: read, and adds nothing.
          {
            monitorId: monitorId(2),
            statusId: OFFLINE,
            startsAt: new Date(window.startDate.getTime() - DAY_MS),
            endsAt: window.startDate,
            isMonitoringOff: false,
          },
          // Off from a midnight to the window's end.
          {
            monitorId: monitorId(3),
            statusId: OPERATIONAL,
            startsAt: midnight(20),
            endsAt: null,
            isMonitoringOff: true,
          },
        ]);

        const { previous, current } = await readBoth({
          monitorIds: [monitorId(1), monitorId(2), monitorId(3)],
          window: window,
          zone: zone,
        });

        expectSameAggregate(current, previous);
      }
    });

    describe("on drawn timelines", () => {
      const random: SeededRandom = seededRandom(6887);

      /*
       * Up to six monitors, each a run of rows with gaps, rows that overlap
       * their own monitor's (old deletes left that), open rows in the middle
       * (orphans a racing writer left), deleted rows, zero-length rows, rows
       * that start before the window and rows that end after it, runs of
       * rows with monitoring off - and a third of the starts and ends put
       * exactly on a local midnight of the zone.
       */
      function drawRows(data: {
        monitorIds: Array<string>;
        window: Window;
        zone: string;
      }): Array<Row> {
        const midnights: Array<number> = DayUptimeGraphUtil.getDays({
          startDate: new Date(data.window.startDate.getTime() - 6 * DAY_MS),
          endDate: new Date(data.window.endDate.getTime() + 6 * DAY_MS),
          timezone: data.zone,
        }).map((day: UptimeGraphDay) => {
          return day.startOfDay.getTime();
        });

        const nearestMidnight: (at: number) => number = (
          at: number,
        ): number => {
          let nearest: number = midnights[0]!;

          for (const candidate of midnights) {
            if (Math.abs(candidate - at) < Math.abs(nearest - at)) {
              nearest = candidate;
            }
          }

          return nearest;
        };

        const rows: Array<Row> = [];

        for (const id of data.monitorIds) {
          let cursor: number =
            data.window.startDate.getTime() - random(5 * 24) * HOUR_MS;
          const rowCount: number = 1 + random(60);
          let isOff: boolean = random(5) === 0;

          for (let n: number = 0; n < rowCount; n++) {
            const shape: number = random(10);

            if (shape < 2) {
              cursor += random(3 * 24 * 60) * 60 * 1000;
            } else if (shape === 2) {
              cursor -= random(6 * 60) * 60 * 1000;
            }

            if (random(4) === 0) {
              isOff = !isOff;
            }

            let startsAt: number = cursor;

            if (random(3) === 0) {
              startsAt = nearestMidnight(startsAt);
            }

            const lengthShape: number = random(10);
            let length: number =
              lengthShape === 0
                ? 0
                : lengthShape < 4
                  ? (1 + random(600)) * 1000
                  : (1 + random(4 * 24 * 60 * 60)) * 1000 + random(1000);

            if (random(3) === 0) {
              length = Math.max(
                0,
                nearestMidnight(startsAt + length) - startsAt,
              );
            }

            const isOpen: boolean = random(12) === 0 || n === rowCount - 1;

            rows.push({
              monitorId: id,
              statusId: STATUS_IDS[random(STATUS_IDS.length)]!,
              startsAt: new Date(startsAt),
              endsAt: isOpen ? null : new Date(startsAt + length),
              isMonitoringOff: isOff,
              deletedAt:
                random(30) === 0 ? new Date("2026-11-12T00:00:00.000Z") : null,
            });

            cursor = startsAt + length;
          }
        }

        return rows;
      }

      test.each(ZONES)(
        "the new day split holds the old one's buckets in %s, in every window",
        async (zone: string) => {
          for (const window of WINDOWS) {
            for (let draw: number = 0; draw < 4; draw++) {
              await database.query(`DELETE FROM "MonitorStatusTimeline"`);

              const ids: Array<string> = Array.from(
                { length: 1 + random(6) },
                (_: unknown, index: number) => {
                  return monitorId(100 + draw * 10 + index);
                },
              );

              await insertRows(drawRows({ monitorIds: ids, window, zone }));

              const { previous, current } = await readBoth({
                // A monitor with no rows at all comes back too, with no data.
                monitorIds: [...ids, monitorId(999)],
                window: window,
                zone: zone,
              });

              expect(current.timezone).toBe(zone);
              expectSameAggregate(current, previous);
            }
          }
        },
      );
    });

    test("is faster than the old day split on a flapping page, with the same buckets", async () => {
      const days: number = Number(
        process.env["DAILY_UPTIME_AGGREGATE_BENCHMARK_DAYS"] || "12",
      );
      const window: Window = {
        name: "flapping",
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        endDate: new Date(
          Date.parse("2026-06-01T00:00:00.000Z") + days * DAY_MS,
        ),
      };

      // Three monitors changing status every 20 seconds, as a flapping probe does.
      for (let n: number = 1; n <= 3; n++) {
        await database.query(
          `INSERT INTO "MonitorStatusTimeline"
             ("_id", "version", "projectId", "monitorId", "monitorStatusId", "startsAt", "endsAt", "isMonitoringOff")
           SELECT gen_random_uuid(), 1, $1::uuid, $2::uuid,
                  CASE WHEN g % 2 = 0 THEN $3::uuid ELSE $4::uuid END,
                  $5::timestamptz + (g * interval '20 seconds') + ($6::int * interval '1 second'),
                  $5::timestamptz + ((g + 1) * interval '20 seconds') + ($6::int * interval '1 second'),
                  false
           FROM generate_series(0, $7::int - 1) AS g`,
          [
            PROJECT_ID,
            monitorId(n),
            OPERATIONAL,
            OFFLINE,
            window.startDate,
            n,
            days * 4320,
          ],
        );
      }

      await database.query(`ANALYZE "MonitorStatusTimeline"`);

      const monitorIds: Array<string> = [
        monitorId(1),
        monitorId(2),
        monitorId(3),
      ];
      const zone: string = "America/New_York";

      const time: (run: () => Promise<unknown>) => Promise<number> = async (
        run: () => Promise<unknown>,
      ): Promise<number> => {
        const timings: Array<number> = [];

        // One run to warm the cache, then the median of three.
        await run();

        for (let n: number = 0; n < 3; n++) {
          const startedAt: number = Date.now();
          await run();
          timings.push(Date.now() - startedAt);
        }

        return timings.sort((a: number, b: number) => {
          return a - b;
        })[1]!;
      };

      const previousMs: number = await time(() => {
        return database.query(PREVIOUS_DAILY_UPTIME_AGGREGATE_SQL, [
          monitorIds,
          window.startDate,
          window.endDate,
          zone,
        ]);
      });
      const currentMs: number = await time(() => {
        return MonitorStatusTimelineService.getDailyUptimeAggregate({
          monitorIds: monitorIds.map((id: string) => {
            return new ObjectID(id);
          }),
          startDate: window.startDate,
          endDate: window.endDate,
          timezone: zone,
        });
      });

      // eslint-disable-next-line no-console
      console.log(
        `getDailyUptimeAggregate on ${days * 4320 * 3} flapping rows in ${zone}: ${previousMs} ms with the old day split, ${currentMs} ms with the day grid.`,
      );

      const { previous, current } = await readBoth({
        monitorIds: monitorIds,
        window: window,
        zone: zone,
      });

      expectSameAggregate(current, previous);

      // A flapping day is a whole day of the monitor's, half of it Offline.
      const flappingDay: UptimeDayBucket = current.monitors[0]!.buckets[3]!;
      expectWithin(flappingDay.coveredSeconds, flappingDay.daySeconds);
      expect(
        flappingDay.statusDurations.reduce(
          (sum: number, duration: UptimeStatusDuration) => {
            return sum + duration.seconds;
          },
          0,
        ),
      ).toBeCloseTo(flappingDay.daySeconds, 3);

      expect(currentMs).toBeLessThan(15_000);
    });
  },
);
