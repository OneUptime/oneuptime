import TelemetryHistogramBuckets, {
  DAY_BAR_MINUTES,
} from "../../../../Server/Utils/Telemetry/TelemetryHistogramBuckets";
import ExceptionAggregationService from "../../../../Server/Services/ExceptionAggregationService";
import LogAggregationService from "../../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../../Server/Services/TraceAggregationService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import { describe, expect, test } from "@jest/globals";

/*
 * A TELEMETRY HISTOGRAM'S DAY BARS, FROM THE READER'S MIDNIGHT (issue #7923).
 *
 * The words of the SQL. What it does on a server - one bar per New York
 * day, 25 hours on 1 November, every row in one bar - is
 * App/Tests/Telemetry/TelemetryDayBarsInReaderZoneClickhouse.test.ts.
 */

const DAY_EXPRESSION: string =
  "toTimeZone(toDateTime(toStartOfInterval(minute, INTERVAL 1 DAY, {p0:String}), {p1:String}), 'UTC')";

describe("TelemetryHistogramBuckets.buildBucketStatement", () => {
  test("a bar of a day with the reader's zone starts at its midnight, the zone a bound parameter", () => {
    const statement: Statement = TelemetryHistogramBuckets.buildBucketStatement(
      {
        timestampExpression: "minute",
        bucketSizeInMinutes: DAY_BAR_MINUTES,
        timezone: Timezone.AmericaNew_York,
      },
    );

    expect(statement.query).toBe(DAY_EXPRESSION);
    expect(statement.query_params).toEqual({
      p0: "America/New_York",
      p1: "America/New_York",
    });
  });

  test("without a zone, a bar of a day is 1440 minutes from the epoch, word for word as it was", () => {
    const statement: Statement = TelemetryHistogramBuckets.buildBucketStatement(
      {
        timestampExpression: "minute",
        bucketSizeInMinutes: DAY_BAR_MINUTES,
      },
    );

    expect(statement.query).toBe(
      "toStartOfInterval(minute, INTERVAL {p0:Int32} SECOND)",
    );
    expect(statement.query_params).toEqual({ p0: 86400 });
  });

  test.each([1, 5, 15, 60, 360, 720, 1116, 2880])(
    "a bar of %i minutes is counted from the epoch, zone or not",
    (minutes: number) => {
      const zoned: Statement = TelemetryHistogramBuckets.buildBucketStatement({
        timestampExpression: "time",
        bucketSizeInMinutes: minutes,
        timezone: Timezone.AsiaTokyo,
      });
      const plain: Statement = TelemetryHistogramBuckets.buildBucketStatement({
        timestampExpression: "time",
        bucketSizeInMinutes: minutes,
      });

      expect(zoned.query).toBe(
        "toStartOfInterval(time, INTERVAL {p0:Int32} SECOND)",
      );
      expect(zoned.query_params).toEqual({ p0: minutes * 60 });
      expect(zoned.query).toBe(plain.query);
      expect(zoned.query_params).toEqual(plain.query_params);
    },
  );

  test("a zone is cut in its current name, the one ClickHouse knows", () => {
    expect(
      TelemetryHistogramBuckets.getDayBarTimezone({
        bucketSizeInMinutes: DAY_BAR_MINUTES,
        timezone: "US/Pacific-New" as Timezone,
      }),
    ).toBe("America/Los_Angeles");
    expect(
      TelemetryHistogramBuckets.getDayBarTimezone({
        bucketSizeInMinutes: DAY_BAR_MINUTES,
        timezone: Timezone.AsiaKolkata,
      }),
    ).toBe("Asia/Kolkata");
    expect(
      TelemetryHistogramBuckets.getDayBarTimezone({
        bucketSizeInMinutes: 360,
        timezone: Timezone.AsiaKolkata,
      }),
    ).toBeNull();
    expect(
      TelemetryHistogramBuckets.getDayBarTimezone({
        bucketSizeInMinutes: DAY_BAR_MINUTES,
      }),
    ).toBeNull();
  });
});

describe("TelemetryHistogramBuckets.readTimezone", () => {
  test("no zone is no zone", () => {
    expect(TelemetryHistogramBuckets.readTimezone(undefined)).toBeUndefined();
    expect(TelemetryHistogramBuckets.readTimezone(null)).toBeUndefined();
  });

  test("a zone the Timezone list holds is read as it is", () => {
    expect(TelemetryHistogramBuckets.readTimezone("America/New_York")).toBe(
      "America/New_York",
    );
    expect(TelemetryHistogramBuckets.readTimezone("UTC")).toBe("UTC");
  });

  test.each([
    ["a typo", "Europe/Lodnon"],
    ["text written to be SQL", "UTC'), 'x"],
    ["a number", 42],
    ["an empty string", ""],
  ])(
    "%s is refused with a 400 before any statement is built",
    (_name: string, value: unknown) => {
      expect(() => {
        TelemetryHistogramBuckets.readTimezone(value);
      }).toThrow(BadDataException);
    },
  );
});

// ---- Every statement that draws a histogram's bars takes the zone.

type StatementBuilder = (request: unknown) => Statement;

function builderOf(target: unknown, name: string): StatementBuilder {
  return (request: unknown): Statement => {
    return (target as Record<string, StatementBuilder>)[name]!(request);
  };
}

const BASE: {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
} = {
  projectId: new ObjectID("7d00000000000000000000a1"),
  startTime: new Date("2026-09-20T00:00:00.000Z"),
  endTime: new Date("2026-11-19T00:00:00.000Z"),
};

const STATEMENTS: Array<{
  name: string;
  build: StatementBuilder;
  timestamp: string;
  extra: Record<string, unknown>;
}> = [
  {
    name: "the Logs histogram (over the minute rollup)",
    build: builderOf(LogAggregationService, "buildHistogramStatement"),
    timestamp: "minute",
    extra: {},
  },
  {
    name: "Logs Analytics",
    build: builderOf(
      LogAggregationService,
      "buildAnalyticsTimeseriesStatement",
    ),
    timestamp: "time",
    extra: { chartType: "timeseries", aggregation: "count" },
  },
  {
    name: "the Traces histogram (over the minute rollup)",
    build: builderOf(TraceAggregationService, "buildHistogramStatement"),
    timestamp: "minute",
    extra: {},
  },
  {
    name: "Traces Analytics",
    build: builderOf(
      TraceAggregationService,
      "buildAnalyticsTimeseriesStatement",
    ),
    timestamp: "startTime",
    extra: { chartType: "timeseries", metric: "count" },
  },
  {
    name: "the Exceptions histogram",
    build: builderOf(ExceptionAggregationService, "buildHistogramStatement"),
    timestamp: "time",
    extra: {},
  },
];

describe.each(STATEMENTS)(
  "$name",
  (entry: {
    name: string;
    build: StatementBuilder;
    timestamp: string;
    extra: Record<string, unknown>;
  }) => {
    function build(
      bucketSizeInMinutes: number,
      timezone?: Timezone | undefined,
    ): Statement {
      return entry.build({
        ...BASE,
        ...entry.extra,
        bucketSizeInMinutes: bucketSizeInMinutes,
        timezone: timezone,
      });
    }

    test("a day bar with the reader's zone starts at its midnight", () => {
      const statement: Statement = build(
        DAY_BAR_MINUTES,
        Timezone.AmericaNew_York,
      );
      const flat: string = statement.query.replace(/\s+/g, " ");

      expect(flat).toMatch(
        new RegExp(
          `toTimeZone\\(toDateTime\\(toStartOfInterval\\(${entry.timestamp}, INTERVAL 1 DAY, \\{p(\\d+):String\\}\\), \\{p(\\d+):String\\}\\), 'UTC'\\) AS bucket`,
        ),
      );
      // The zone reaches ClickHouse as a parameter, never as text.
      expect(statement.query).not.toContain("America/New_York");
      expect(Object.values(statement.query_params)).toContain(
        "America/New_York",
      );
      expect(flat).not.toContain("SECOND) AS bucket");
    });

    test("without a zone, a day bar is the epoch's, and so is every shorter bar with one", () => {
      const plain: Statement = build(DAY_BAR_MINUTES);

      expect(plain.query.replace(/\s+/g, " ")).toContain(
        `toStartOfInterval(${entry.timestamp}, INTERVAL {p0:Int32} SECOND) AS bucket`,
      );
      expect(plain.query_params["p0"]).toBe(86400);
      expect(plain.query).not.toContain("toTimeZone");

      const hourly: Statement = build(60, Timezone.AmericaNew_York);
      const hourlyPlain: Statement = build(60);

      expect(hourly.query).toBe(hourlyPlain.query);
      expect(hourly.query_params).toEqual(hourlyPlain.query_params);
    });
  },
);
