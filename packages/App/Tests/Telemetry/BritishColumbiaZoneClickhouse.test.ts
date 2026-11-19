import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { AggregateUtil } from "Common/Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import { JSONObject } from "Common/Types/JSON";
import Timezone from "Common/Types/Timezone";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * British Columbia's time zone in ClickHouse (issue #9999).
 *
 * ClickHouse builds its own tz database into the server, and OneUptime
 * asks it to start a chart's days, weeks and months at the reader's
 * midnight (AggregateUtil.buildBucketTimestampStatement). British Columbia
 * moved to permanent UTC-7 in March 2026 (tzdata 2026b), so from
 * 2026-11-01 a reader in Vancouver's day starts at 07:00 UTC. ClickHouse
 * 26.7.1 to 26.7.12 carry tzdata 2025a, which fell back to UTC-8 and
 * started that day at 08:00 UTC; docker-compose.base.yml and the Helm chart
 * pin 26.7.38.18 (tzdata 2026e) for it.
 *
 * This asks the server the App Test workflow runs - the same pinned image -
 * what it knows: its tz database release, Vancouver's offset either side of
 * the change, and where a Vancouver reader's day starts. Los Angeles and
 * Tijuana still fall back.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7.38.18
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/BritishColumbiaZoneClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `british_columbia_zone_test_${process.pid}_${Date.now()}`;

// The release that first has British Columbia's permanent UTC-7.
const FIRST_RELEASE_WITH_BRITISH_COLUMBIA: string = "2026b";

const BRITISH_COLUMBIA: Array<Timezone> = [
  Timezone.AmericaVancouver,
  Timezone.CanadaPacific,
];

const STILL_ON_DAYLIGHT_SAVING: Array<Timezone> = [
  Timezone.AmericaLos_Angeles,
  Timezone.AmericaTijuana,
];

const SEVEN_HOURS_WEST: number = -7 * 60 * 60;
const EIGHT_HOURS_WEST: number = -8 * 60 * 60;

/*
 * Whether tz database release `version` ("2026e") is `floor` or later: a
 * year, then letters.
 */
function isReleaseAtLeast(version: string, floor: string): boolean {
  const pattern: RegExp = /^(\d{4})([a-z]+)$/;
  const parsed: RegExpExecArray | null = pattern.exec(version.trim());
  const parsedFloor: RegExpExecArray | null = pattern.exec(floor);

  if (!parsed || !parsedFloor) {
    return false;
  }

  if (parsed[1] !== parsedFloor[1]) {
    return Number(parsed[1]) > Number(parsedFloor[1]);
  }

  if (parsed[2]!.length !== parsedFloor[2]!.length) {
    return parsed[2]!.length > parsedFloor[2]!.length;
  }

  return parsed[2]! >= parsedFloor[2]!;
}

integration("British Columbia's time zone, in ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;

  // The rows a statement reads, as JSON.
  async function rowsOf(
    query: string,
    queryParams: Record<string, unknown> = {},
  ): Promise<Array<JSONObject>> {
    const result: Awaited<ReturnType<ClickhouseClient["query"]>> =
      await client.query({
        query: query,
        query_params: queryParams,
        format: "JSON",
      });

    const json: { data?: Array<JSONObject> } = (await result.json()) as {
      data?: Array<JSONObject>;
    };

    return json.data || [];
  }

  // The UTC offset in seconds the server gives `zone` at `utc`.
  async function offsetAt(zone: string, utc: string): Promise<number> {
    const rows: Array<JSONObject> = await rowsOf(
      "SELECT timeZoneOffset(toTimeZone(toDateTime({utc:String}, 'UTC'), {zone:String})) AS offset",
      { utc: utc, zone: zone },
    );

    return Number(rows[0]!["offset"]);
  }

  // The UTC instant a day bucket for `utc` starts at, for a reader in `zone`.
  async function dayStartFor(zone: Timezone, utc: string): Promise<string> {
    const bucket: Statement = AggregateUtil.buildBucketTimestampStatement(
      AggregationInterval.Day,
      `toDateTime64('${utc}', 3, 'UTC')`,
      zone,
    );

    const statement: Statement = new Statement()
      .append("SELECT toString(")
      .append(bucket)
      .append(") AS dayStart");

    const rows: Array<JSONObject> = await rowsOf(
      statement.query,
      statement.query_params,
    );

    return String(rows[0]!["dayStart"]);
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    // Connecting creates the database.
    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("its tz database is 2026b or later", async () => {
    const rows: Array<JSONObject> = await rowsOf(
      "SELECT version() AS version, value AS tzdata FROM system.build_options WHERE name = 'TZDATA_VERSION'",
    );

    expect(rows).toHaveLength(1);

    const tzdata: string = String(rows[0]!["tzdata"]);

    expect({
      version: rows[0]!["version"],
      tzdata: tzdata,
      hasBritishColumbia: isReleaseAtLeast(
        tzdata,
        FIRST_RELEASE_WITH_BRITISH_COLUMBIA,
      ),
    }).toEqual({
      version: rows[0]!["version"],
      tzdata: tzdata,
      hasBritishColumbia: true,
    });
  });

  test.each(BRITISH_COLUMBIA)(
    "%s is UTC-7 on 2026-12-01 and 2027-01-15, and across the night of 2026-11-01",
    async (zone: Timezone) => {
      for (const utc of [
        "2026-10-15 12:00:00",
        "2026-11-01 08:59:59",
        "2026-11-01 09:00:00",
        "2026-11-01 12:00:00",
        "2026-12-01 12:00:00",
        "2027-01-15 12:00:00",
        "2027-07-01 12:00:00",
      ]) {
        expect({ utc: utc, offset: await offsetAt(zone, utc) }).toEqual({
          utc: utc,
          offset: SEVEN_HOURS_WEST,
        });
      }
    },
  );

  test.each(STILL_ON_DAYLIGHT_SAVING)(
    "%s still falls back to UTC-8 at 09:00 UTC on 2026-11-01",
    async (zone: Timezone) => {
      expect(await offsetAt(zone, "2026-11-01 08:59:59")).toBe(
        SEVEN_HOURS_WEST,
      );
      expect(await offsetAt(zone, "2026-11-01 09:00:00")).toBe(
        EIGHT_HOURS_WEST,
      );
      expect(await offsetAt(zone, "2026-12-01 12:00:00")).toBe(
        EIGHT_HOURS_WEST,
      );
      expect(await offsetAt(zone, "2027-01-15 12:00:00")).toBe(
        EIGHT_HOURS_WEST,
      );
    },
  );

  test.each(BRITISH_COLUMBIA)(
    "a chart's day for a reader in %s starts at 07:00 UTC, every day across 2026-11-01",
    async (zone: Timezone) => {
      for (const [utc, dayStart] of [
        ["2026-10-31 12:00:00", "2026-10-31 07:00:00"],
        ["2026-11-01 12:00:00", "2026-11-01 07:00:00"],
        ["2026-11-02 12:00:00", "2026-11-02 07:00:00"],
        ["2026-12-01 12:00:00", "2026-12-01 07:00:00"],
        // 06:30 UTC is still the evening before on British Columbia's clock.
        ["2026-12-02 06:30:00", "2026-12-01 07:00:00"],
        ["2027-01-15 12:00:00", "2027-01-15 07:00:00"],
      ]) {
        expect({ utc: utc, dayStart: await dayStartFor(zone, utc!) }).toEqual({
          utc: utc,
          dayStart: dayStart,
        });
      }
    },
  );

  test.each(STILL_ON_DAYLIGHT_SAVING)(
    "a chart's day for a reader in %s starts at 07:00 UTC before 2026-11-01 and 08:00 UTC after",
    async (zone: Timezone) => {
      expect(await dayStartFor(zone, "2026-10-31 12:00:00")).toBe(
        "2026-10-31 07:00:00",
      );
      expect(await dayStartFor(zone, "2026-11-02 12:00:00")).toBe(
        "2026-11-02 08:00:00",
      );
      expect(await dayStartFor(zone, "2026-12-01 12:00:00")).toBe(
        "2026-12-01 08:00:00",
      );
    },
  );
});

describe("The British Columbia ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
