import {
  AggregateUtil,
  INVALID_TIMEZONE_MESSAGE,
} from "../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Timezone from "../../../../Types/Timezone";
import TimezoneAlias from "../../../../Types/TimezoneAlias";
import { describe, expect, it } from "@jest/globals";

/*
 * DAY, WEEK, MONTH AND YEAR BUCKETS IN THE READER'S ZONE (issue #7277).
 *
 * A day chart draws its days on the reader's calendar, and the server
 * grouped its numbers into UTC days: in New York a UTC midnight is 19:00
 * the evening before, so every bar held mostly the next day's numbers. An
 * aggregate now carries the reader's zone (AggregateBy.timezone) for a day
 * and longer, and AggregateUtil compiles its bucket in that zone.
 *
 * These pin what reaches ClickHouse: the zone-aware expression for the four
 * calendar intervals, with the zone as a bound String parameter and never as
 * text; the old expression, unchanged, without a zone and for an hour and
 * shorter; and the 400 for anything that is not a name in the Timezone
 * list, whatever it holds.
 */

const COLUMN: string = "time";

const CALENDAR_UNITS: Array<{ interval: AggregationInterval; unit: string }> = [
  { interval: AggregationInterval.Day, unit: "DAY" },
  { interval: AggregationInterval.Week, unit: "WEEK" },
  { interval: AggregationInterval.Month, unit: "MONTH" },
  { interval: AggregationInterval.Year, unit: "YEAR" },
];

const NO_ZONE_INTERVALS: Array<AggregationInterval> = [
  AggregationInterval.Minute,
  AggregationInterval.FiveMinutes,
  AggregationInterval.FifteenMinutes,
  AggregationInterval.ThirtyMinutes,
  AggregationInterval.Hour,
];

function zoneExpression(
  unit: string,
  expression: string,
  first: number = 0,
): string {
  return `toTimeZone(toDateTime(toStartOfInterval(${expression}, INTERVAL 1 ${unit}, {p${first}:String}), {p${first + 1}:String}), 'UTC')`;
}

// Values a request can hold in place of a zone name, each refused.
const NOT_ZONE_NAMES: Array<{ name: string; value: unknown }> = [
  { name: "an empty text", value: "" },
  { name: "a lowercased name", value: "america/new_york" },
  { name: "a padded name", value: " Asia/Tokyo" },
  { name: "a name with a trailing space", value: "Europe/Kyiv " },
  { name: "a zone no list has", value: "Mars/Olympus_Mons" },
  { name: "an offset written as text", value: "+05:30" },
  {
    name: "text written to close the argument",
    value: "UTC'), 'UTC') AS time FROM system.one --",
  },
  {
    name: "a second statement",
    value: "America/New_York; DROP TABLE MetricItemV3",
  },
  { name: "a parameter placeholder", value: "{p0:String}" },
  { name: "a number", value: 330 },
  { name: "a boolean", value: true },
  { name: "an object", value: { zone: "UTC" } },
  { name: "an array of names", value: ["UTC"] },
];

describe("AggregateUtil.readTimezone", () => {
  it("reads no zone from undefined or null (null is what the API keeps)", () => {
    expect(AggregateUtil.readTimezone(undefined)).toBeUndefined();
    expect(AggregateUtil.readTimezone(null)).toBeUndefined();
  });

  it("accepts every name in the Timezone list, as the list spells it", () => {
    for (const timezone of Object.values(Timezone)) {
      expect(AggregateUtil.readTimezone(timezone)).toBe(timezone);
    }
  });

  for (const notZone of NOT_ZONE_NAMES) {
    it(`refuses ${notZone.name} with a 400 that does not repeat it`, () => {
      let thrown: unknown = null;

      try {
        AggregateUtil.readTimezone(notZone.value);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as BadDataException).message).toBe(
        INVALID_TIMEZONE_MESSAGE,
      );
      if (typeof notZone.value === "string" && notZone.value.length > 3) {
        expect((thrown as BadDataException).message).not.toContain(
          notZone.value,
        );
      }
    });
  }
});

describe("AggregateUtil.getBucketTimezone", () => {
  it("is the zone for a day, a week, a month and a year", () => {
    for (const { interval } of CALENDAR_UNITS) {
      expect(
        AggregateUtil.getBucketTimezone(interval, Timezone.AmericaNew_York),
      ).toBe(Timezone.AmericaNew_York);
    }
  });

  it("is none for an hour and shorter, and for Total, which no zone moves", () => {
    for (const interval of [...NO_ZONE_INTERVALS, AggregationInterval.Total]) {
      expect(
        AggregateUtil.getBucketTimezone(interval, Timezone.AsiaKolkata),
      ).toBeNull();
    }
  });

  it("is none without a zone", () => {
    expect(
      AggregateUtil.getBucketTimezone(AggregationInterval.Day, undefined),
    ).toBeNull();
  });

  it("names a legacy zone by its current name, which ClickHouse knows", () => {
    // ClickHouse 26.7 no longer knows US/Pacific-New; tzdata dropped it in 2020.
    expect(
      AggregateUtil.getBucketTimezone(
        AggregationInterval.Day,
        Timezone.USPacificNew,
      ),
    ).toBe(Timezone.AmericaLos_Angeles);
    expect(
      AggregateUtil.getBucketTimezone(
        AggregationInterval.Week,
        Timezone.AsiaCalcutta,
      ),
    ).toBe(Timezone.AsiaKolkata);
    expect(
      AggregateUtil.getBucketTimezone(
        AggregationInterval.Month,
        Timezone.USEastern,
      ),
    ).toBe(Timezone.AmericaNew_York);
  });

  it("refuses a name not in the list, even for an interval that ignores the zone", () => {
    expect(() => {
      AggregateUtil.getBucketTimezone(
        AggregationInterval.Minute,
        "Nowhere/At_All",
      );
    }).toThrow(BadDataException);
  });
});

describe("AggregateUtil.buildBucketTimestampStatement", () => {
  for (const { interval, unit } of CALENDAR_UNITS) {
    it(`starts a ${interval} bucket in the reader's zone, the zone bound twice as a String`, () => {
      const statement: Statement = AggregateUtil.buildBucketTimestampStatement(
        interval,
        COLUMN,
        Timezone.AmericaNew_York,
      );

      expect(statement.query).toBe(zoneExpression(unit, COLUMN));
      expect(statement.query_params).toStrictEqual({
        p0: "America/New_York",
        p1: "America/New_York",
      });
      // The name is a parameter, never text in the query.
      expect(statement.query).not.toContain("New_York");
    });
  }

  for (const zone of [
    Timezone.UTC,
    Timezone.AsiaTokyo,
    Timezone.AsiaKolkata,
    Timezone.PacificAuckland,
  ]) {
    it(`binds ${zone} the same way`, () => {
      const statement: Statement = AggregateUtil.buildBucketTimestampStatement(
        AggregationInterval.Day,
        COLUMN,
        zone,
      );

      expect(statement.query).toBe(zoneExpression("DAY", COLUMN));
      expect(statement.query_params).toStrictEqual({ p0: zone, p1: zone });
    });
  }

  it("without a zone, is the UTC expression it always was, with nothing bound", () => {
    for (const interval of [
      ...NO_ZONE_INTERVALS,
      ...CALENDAR_UNITS.map((calendar: { interval: AggregationInterval }) => {
        return calendar.interval;
      }),
    ]) {
      const statement: Statement = AggregateUtil.buildBucketTimestampStatement(
        interval,
        COLUMN,
      );

      expect(statement.query).toBe(
        AggregateUtil.buildBucketTimestampExpression(interval, COLUMN),
      );
      expect(statement.query_params).toStrictEqual({});
    }
  });

  it("keeps an hour and shorter as they are, zone or not", () => {
    for (const interval of NO_ZONE_INTERVALS) {
      const statement: Statement = AggregateUtil.buildBucketTimestampStatement(
        interval,
        COLUMN,
        Timezone.AsiaKolkata,
      );

      expect(statement.query).toBe(
        AggregateUtil.buildBucketTimestampExpression(interval, COLUMN),
      );
      expect(statement.query).not.toContain("toTimeZone");
      expect(statement.query_params).toStrictEqual({});
    }
  });

  it("buckets a builder's own expression (a rollup's minute) the same way", () => {
    const statement: Statement = AggregateUtil.buildBucketTimestampStatement(
      AggregationInterval.Week,
      "toStartOfMinute(startTime)",
      Timezone.EuropeBerlin,
    );

    expect(statement.query).toBe(
      zoneExpression("WEEK", "toStartOfMinute(startTime)"),
    );
  });

  it("numbers its parameters after the ones before it in the statement", () => {
    const statement: Statement = SQL`SELECT ${{
      type: TableColumnType.Text,
      value: "first",
    }} AS label, `;

    statement
      .append(
        AggregateUtil.buildBucketTimestampStatement(
          AggregationInterval.Month,
          COLUMN,
          Timezone.AsiaTokyo,
        ),
      )
      .append(" AS time");

    expect(statement.query).toBe(
      `SELECT {p0:String} AS label, ${zoneExpression("MONTH", COLUMN, 1)} AS time`,
    );
    expect(statement.query_params).toStrictEqual({
      p0: "first",
      p1: "Asia/Tokyo",
      p2: "Asia/Tokyo",
    });
  });

  it("binds a legacy zone by its current name", () => {
    const statement: Statement = AggregateUtil.buildBucketTimestampStatement(
      AggregationInterval.Day,
      COLUMN,
      Timezone.USPacificNew,
    );

    expect(statement.query_params).toStrictEqual({
      p0: "America/Los_Angeles",
      p1: "America/Los_Angeles",
    });
  });

  it("sends every zone in the list as a plain String, never hex encoded", () => {
    /*
     * A text that holds a security scan word is sent as unhex(...) (see
     * Statement). ClickHouse takes that as a zone too, but no zone name
     * should ever need it: a zone in a query must read as a zone.
     */
    for (const timezone of Object.values(Timezone)) {
      const statement: Statement = AggregateUtil.buildBucketTimestampStatement(
        AggregationInterval.Day,
        COLUMN,
        timezone,
      );
      const current: Timezone = TimezoneAlias.getCanonicalTimezone(timezone);

      expect(statement.query).toBe(zoneExpression("DAY", COLUMN));
      expect(statement.query_params).toStrictEqual({
        p0: current,
        p1: current,
      });
    }
  });

  it("refuses a name not in the list before building anything", () => {
    for (const notZone of NOT_ZONE_NAMES) {
      expect(() => {
        AggregateUtil.buildBucketTimestampStatement(
          AggregationInterval.Day,
          COLUMN,
          notZone.value as Timezone,
        );
      }).toThrow(INVALID_TIMEZONE_MESSAGE);
    }
  });
});

describe("AggregateUtil.buildBucketTimestampSelectStatement", () => {
  it("aliases the reader's day to the timestamp column", () => {
    const statement: Statement =
      AggregateUtil.buildBucketTimestampSelectStatement(
        AggregationInterval.Day,
        COLUMN,
        Timezone.AmericaNew_York,
      );

    expect(statement.query).toBe(`${zoneExpression("DAY", COLUMN)} as time`);
    expect(statement.query_params).toStrictEqual({
      p0: "America/New_York",
      p1: "America/New_York",
    });
  });

  it("is buildBucketTimestampSelect without a zone, for every interval", () => {
    for (const interval of Object.values(AggregationInterval)) {
      const statement: Statement =
        AggregateUtil.buildBucketTimestampSelectStatement(interval, COLUMN);

      expect(statement.query).toBe(
        AggregateUtil.buildBucketTimestampSelect(interval, COLUMN),
      );
      expect(statement.query_params).toStrictEqual({});
    }
  });

  it("keeps Total's min() whatever the zone", () => {
    const statement: Statement =
      AggregateUtil.buildBucketTimestampSelectStatement(
        AggregationInterval.Total,
        COLUMN,
        Timezone.AsiaTokyo,
      );

    expect(statement.query).toBe("min(time) as time");
    expect(statement.query_params).toStrictEqual({});
  });

  it("refuses a name not in the list for Total too", () => {
    expect(() => {
      AggregateUtil.buildBucketTimestampSelectStatement(
        AggregationInterval.Total,
        COLUMN,
        "Etc/Nowhere" as Timezone,
      );
    }).toThrow(BadDataException);
  });
});
