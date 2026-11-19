import { Service as MonitorStatusTimelineService } from "../../../Server/Services/MonitorStatusTimelineService";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * BRITISH COLUMBIA'S DAYS, CUT BY POSTGRES (issue #9999).
 *
 * A status page's uptime bars, and a monitor's uptime by day, are cut at
 * the visitor's midnight by Postgres: MonitorStatusTimelineService's day
 * grid converts with `AT TIME ZONE`, which reads the server's own tz
 * database (the OS's zoneinfo in the postgres image). British Columbia
 * moved to permanent UTC-7 in March 2026 (tzdata 2026b), so from
 * 2026-11-01 a Vancouver visitor's day starts at 07:00 UTC; a Postgres with
 * older zoneinfo falls back to UTC-8 and starts it at 08:00, an hour of
 * every bar on the wrong day. Los Angeles still falls back.
 *
 * This asks the Postgres the Common Test workflow runs (test-setup.sh's,
 * the image docker-compose.base.yml ships) what it knows. Opt in with
 * RUN_POSTGRES_TIME_ZONE_DATA_TESTS=true against any Postgres: it creates
 * nothing. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database
 * from TIME_ZONE_DATA_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * TIME_ZONE_DATA_TEST_DATABASE_HOST / _PORT (default localhost:5400,
 * Scripts/Dev/docker-compose.dev.yml).
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TIME_ZONE_DATA_TESTS"] === "true"
    ? describe
    : describe.skip;

/*
 * Canada/Pacific never reaches Postgres: the shipped images have no
 * tzdata-legacy, so a legacy name is translated to its current one first
 * (StatusPageUptimeTimezone.resolve, MonitorUptimeSummaryUtil).
 */
const BRITISH_COLUMBIA: Array<string> = ["America/Vancouver"];

const STILL_ON_DAYLIGHT_SAVING: Array<string> = [
  "America/Los_Angeles",
  "America/Tijuana",
];

describePostgres("British Columbia's time zone, in Postgres", () => {
  let database: DataSource;

  // `utc` on `zone`'s clock, as Postgres reads it: "2026-12-01 05:00:00".
  async function wallClockAt(zone: string, utc: string): Promise<string> {
    const rows: Array<{ wall: string }> = await database.query(
      `SELECT to_char(($1::timestamptz) AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI:SS') AS wall`,
      [utc, zone],
    );

    return rows[0]!.wall;
  }

  /*
   * The midnights of the day grid MonitorStatusTimelineService cuts a
   * window's days on, for a visitor in `zone`, as UTC instants.
   */
  async function dayGrid(data: {
    zone: string;
    from: string;
    to: string;
  }): Promise<Array<string>> {
    const rows: Array<{ start: Date }> = await database.query(
      `WITH params AS (
         SELECT $1::timestamptz AS win_start,
                $2::timestamptz AS eff_end,
                $3::text AS tz
       ),
       ${MonitorStatusTimelineService.getDayGridCte()}
       SELECT unnest(g.starts) AS start FROM grid g ORDER BY 1`,
      [data.from, data.to, data.zone],
    );

    return rows.map((row: { start: Date }): string => {
      return new Date(row.start).toISOString();
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["TIME_ZONE_DATA_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["TIME_ZONE_DATA_TEST_DATABASE_PORT"] || "5400"),
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

  test.each(BRITISH_COLUMBIA)(
    "%s is UTC-7 on 2026-12-01 and 2027-01-15, and does not fall back on 2026-11-01",
    async (zone: string) => {
      expect(await wallClockAt(zone, "2026-12-01T12:00:00Z")).toBe(
        "2026-12-01 05:00:00",
      );
      expect(await wallClockAt(zone, "2027-01-15T12:00:00Z")).toBe(
        "2027-01-15 05:00:00",
      );
      expect(await wallClockAt(zone, "2026-11-01T08:59:59Z")).toBe(
        "2026-11-01 01:59:59",
      );
      // 02:00, not 01:00 again.
      expect(await wallClockAt(zone, "2026-11-01T09:00:00Z")).toBe(
        "2026-11-01 02:00:00",
      );
    },
  );

  test.each(STILL_ON_DAYLIGHT_SAVING)(
    "%s still falls back to UTC-8 at 09:00 UTC on 2026-11-01",
    async (zone: string) => {
      expect(await wallClockAt(zone, "2026-11-01T08:59:59Z")).toBe(
        "2026-11-01 01:59:59",
      );
      expect(await wallClockAt(zone, "2026-11-01T09:00:00Z")).toBe(
        "2026-11-01 01:00:00",
      );
      expect(await wallClockAt(zone, "2026-12-01T12:00:00Z")).toBe(
        "2026-12-01 04:00:00",
      );
    },
  );

  test("a Vancouver visitor's uptime days start at 07:00 UTC, every day across 2026-11-01", async () => {
    const midnights: Array<string> = await dayGrid({
      zone: "America/Vancouver",
      from: "2026-10-30T07:00:00Z",
      to: "2026-11-04T07:00:00Z",
    });

    expect(midnights.length).toBeGreaterThanOrEqual(6);

    for (const midnight of midnights) {
      expect(midnight.slice(11)).toBe("07:00:00.000Z");
    }

    expect(midnights).toContain("2026-11-01T07:00:00.000Z");
    expect(midnights).toContain("2026-11-02T07:00:00.000Z");
  });

  test("a Los Angeles visitor's days start at 07:00 UTC until 2026-11-01, and 08:00 UTC after", async () => {
    const midnights: Array<string> = await dayGrid({
      zone: "America/Los_Angeles",
      from: "2026-10-30T07:00:00Z",
      to: "2026-11-04T08:00:00Z",
    });

    expect(midnights).toContain("2026-10-31T07:00:00.000Z");
    expect(midnights).toContain("2026-11-01T07:00:00.000Z");
    expect(midnights).toContain("2026-11-02T08:00:00.000Z");
    expect(midnights).toContain("2026-11-03T08:00:00.000Z");
  });
});
