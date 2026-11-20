import { Service as MonitorStatusTimelineService } from "../../../Server/Services/MonitorStatusTimelineService";
import UptimeDayGrid from "../../../Utils/Uptime/UptimeDayGrid";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, EntityManager } from "typeorm";

/*
 * BRITISH COLUMBIA'S DAYS ON A STATUS PAGE, WHATEVER POSTGRES KNOWS (issues
 * #9999, #10039).
 *
 * A status page's uptime bars, and a monitor's uptime by day, are cut at the
 * visitor's midnight. British Columbia moved to permanent UTC-7 in March
 * 2026 (tzdata 2026b), so from 2026-11-01 a Vancouver visitor's day starts
 * at 07:00 UTC; Los Angeles still falls back, to 08:00 UTC.
 *
 * The days used to be cut by Postgres (`AT TIME ZONE`), with the database
 * server's own zoneinfo, which OneUptime does not control: the Helm chart's
 * `postgres:latest` with IfNotPresent keeps the image a node first pulled
 * (postgres:15.10 carries tzdata 2024b, which started that day at 08:00),
 * and a managed Postgres has whatever its provider ships. The midnights are
 * now worked out with moment's data (UptimeDayGrid) and handed to the
 * statement as instants, so no zone ever reaches Postgres.
 *
 * The first part needs no database. The second runs the day grid and the
 * day buckets the statements cut on against a real Postgres, with its
 * session in zones other than the visitor's, and shows the days are the
 * ones OneUptime worked out. Opt in with RUN_POSTGRES_TIME_ZONE_DATA_TESTS=
 * true against any Postgres: it creates nothing. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * TIME_ZONE_DATA_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * TIME_ZONE_DATA_TEST_DATABASE_HOST / _PORT (default localhost:5400,
 * Scripts/Dev/docker-compose.dev.yml).
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TIME_ZONE_DATA_TESTS"] === "true"
    ? describe
    : describe.skip;

const NOW: Date = new Date("2027-01-01T00:00:00.000Z");

function midnights(data: {
  zone: string;
  from: string;
  to: string;
}): Array<string> {
  return UptimeDayGrid.getDatabaseParameter({
    startDate: new Date(data.from),
    endDate: new Date(data.to),
    timezone: data.zone,
    now: NOW,
  });
}

describe("a status page's days are cut with OneUptime's tz data, not Postgres's", () => {
  test("neither statement that cuts days converts by zone: the midnights are a parameter", () => {
    const statements: Array<string> = [
      MonitorStatusTimelineService.getDailyUptimeAggregateSql(),
      MonitorStatusTimelineService.getMonitorGroupDailyUptimeAggregateSql({
        levelCount: 3,
      }),
    ];

    for (const sql of statements) {
      expect(sql).not.toContain("AT TIME ZONE");
      expect(sql).not.toMatch(/::text AS tz/);
      expect(sql).toMatch(/\$\d::timestamptz\[\] AS starts/);
    }
  });

  test("a Vancouver visitor's days start at 07:00 UTC, every day across 2026-11-01", () => {
    const grid: Array<string> = midnights({
      zone: "America/Vancouver",
      from: "2026-10-30T07:00:00Z",
      to: "2026-11-04T07:00:00Z",
    });

    expect(grid.length).toBeGreaterThanOrEqual(6);

    for (const midnight of grid) {
      expect(midnight.slice(11)).toBe("07:00:00.000Z");
    }

    expect(grid).toContain("2026-11-01T07:00:00.000Z");
    expect(grid).toContain("2026-11-02T07:00:00.000Z");
  });

  test("a Los Angeles visitor's days start at 07:00 UTC until 2026-11-01, and 08:00 UTC after", () => {
    const grid: Array<string> = midnights({
      zone: "America/Los_Angeles",
      from: "2026-10-30T07:00:00Z",
      to: "2026-11-04T08:00:00Z",
    });

    expect(grid).toContain("2026-10-31T07:00:00.000Z");
    expect(grid).toContain("2026-11-01T07:00:00.000Z");
    expect(grid).toContain("2026-11-02T08:00:00.000Z");
    expect(grid).toContain("2026-11-03T08:00:00.000Z");
  });
});

describePostgres(
  "British Columbia's days, on Postgres, whatever its own zoneinfo",
  () => {
    let database: DataSource;

    /*
     * The day buckets every daily uptime statement cuts on - its day grid,
     * clipped to the window (getDayBucketsCte) - for `grid`, with the
     * session's own zone set to `sessionZone`.
     */
    async function dayBuckets(data: {
      grid: Array<string>;
      from: string;
      to: string;
      sessionZone: string;
    }): Promise<Array<{ start: string; end: string }>> {
      return await database.transaction(
        async (
          manager: EntityManager,
        ): Promise<Array<{ start: string; end: string }>> => {
          await manager.query(`SELECT set_config('TimeZone', $1, true)`, [
            data.sessionZone,
          ]);

          const rows: Array<{ bucket_start: Date; bucket_end: Date }> =
            await manager.query(
              `WITH params AS (
               SELECT $1::timestamptz AS win_start,
                      LEAST($2::timestamptz, now()) AS eff_end
             ),
             ${MonitorStatusTimelineService.getDayGridCte({ parameter: "$3" })},
             ${MonitorStatusTimelineService.getDayBucketsCte()}
             SELECT d.bucket_start, d.bucket_end
             FROM days d
             WHERE d.bucket_end > d.bucket_start
             ORDER BY d.bucket_start`,
              [data.from, data.to, data.grid],
            );

          return rows.map(
            (row: {
              bucket_start: Date;
              bucket_end: Date;
            }): { start: string; end: string } => {
              return {
                start: new Date(row.bucket_start).toISOString(),
                end: new Date(row.bucket_end).toISOString(),
              };
            },
          );
        },
      );
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["TIME_ZONE_DATA_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["TIME_ZONE_DATA_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TIME_ZONE_DATA_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: [],
        synchronize: false,
      });

      await database.initialize();
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.destroy();
      }
    });

    test("the grid OneUptime worked out comes back from Postgres instant for instant", async () => {
      const grid: Array<string> = midnights({
        zone: "America/Vancouver",
        from: "2026-10-30T07:00:00Z",
        to: "2026-11-04T07:00:00Z",
      });

      const rows: Array<{ start: Date }> = await database.query(
        `WITH ${MonitorStatusTimelineService.getDayGridCte({ parameter: "$1" })}
         SELECT unnest(g.starts) AS start FROM grid g ORDER BY 1`,
        [grid],
      );

      expect(
        rows.map((row: { start: Date }): string => {
          return new Date(row.start).toISOString();
        }),
      ).toEqual(grid);
    });

    test.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])(
      "a Vancouver visitor's days start at 07:00 UTC across 2026-11-01, with the session in %s",
      async (sessionZone: string) => {
        const from: string = "2026-10-30T07:00:00.000Z";
        const to: string = "2026-11-04T07:00:00.000Z";

        const buckets: Array<{ start: string; end: string }> = await dayBuckets(
          {
            grid: midnights({ zone: "America/Vancouver", from, to }),
            from: from,
            to: to,
            sessionZone: sessionZone,
          },
        );

        expect(buckets).toEqual([
          {
            start: "2026-10-30T07:00:00.000Z",
            end: "2026-10-31T07:00:00.000Z",
          },
          {
            start: "2026-10-31T07:00:00.000Z",
            end: "2026-11-01T07:00:00.000Z",
          },
          {
            start: "2026-11-01T07:00:00.000Z",
            end: "2026-11-02T07:00:00.000Z",
          },
          {
            start: "2026-11-02T07:00:00.000Z",
            end: "2026-11-03T07:00:00.000Z",
          },
          {
            start: "2026-11-03T07:00:00.000Z",
            end: "2026-11-04T07:00:00.000Z",
          },
        ]);
      },
    );

    test("a Los Angeles visitor's 1 November is 25 hours, and the days after start at 08:00 UTC", async () => {
      const from: string = "2026-10-31T07:00:00.000Z";
      const to: string = "2026-11-03T08:00:00.000Z";

      const buckets: Array<{ start: string; end: string }> = await dayBuckets({
        grid: midnights({ zone: "America/Los_Angeles", from, to }),
        from: from,
        to: to,
        sessionZone: "America/Vancouver",
      });

      expect(buckets).toEqual([
        { start: "2026-10-31T07:00:00.000Z", end: "2026-11-01T07:00:00.000Z" },
        { start: "2026-11-01T07:00:00.000Z", end: "2026-11-02T08:00:00.000Z" },
        { start: "2026-11-02T08:00:00.000Z", end: "2026-11-03T08:00:00.000Z" },
      ]);
    });

    test("the window's first and last days are clipped to it, and the day past its end is never emitted", async () => {
      const from: string = "2026-11-01T19:30:00.000Z";
      const to: string = "2026-11-03T02:15:00.000Z";

      const buckets: Array<{ start: string; end: string }> = await dayBuckets({
        grid: midnights({ zone: "America/Vancouver", from, to }),
        from: from,
        to: to,
        sessionZone: "UTC",
      });

      expect(buckets).toEqual([
        { start: "2026-11-01T19:30:00.000Z", end: "2026-11-02T07:00:00.000Z" },
        { start: "2026-11-02T07:00:00.000Z", end: "2026-11-03T02:15:00.000Z" },
      ]);
    });
  },
);
