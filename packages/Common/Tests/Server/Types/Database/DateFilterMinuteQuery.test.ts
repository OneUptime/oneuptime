import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import Timezone from "../../../../Types/Timezone";
import {
  buildDateFilterValue,
  DateFilterState,
} from "../../../../UI/Components/Filters/DateFilterValue";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import FilterOperator from "../../../../UI/Components/Filters/Types/FilterOperator";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import buildQueryFromFilterData from "../../../../UI/Components/ModelTable/FilterDataToQuery";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * A DATE AND TIME FILTER, FROM THE LIST TO THE DATABASE (issue #7719).
 *
 * The filter's value goes the whole way a list's filter goes: the list's
 * query (FilterDataToQuery), the request body (JSONFunctions.serialize,
 * then JSON), the server reading it back (JSONFunctions.deserialize, as
 * BaseAPI does) and the predicate it binds for Postgres
 * (QueryUtil.serializeQuery). The predicate is then applied to rows the way
 * Postgres applies it, so these say which rows a person gets: a row at
 * 11:15:42 is "11:15", is between 09:00 and 11:15, and is not after 11:15.
 *
 * And the bounds reach the database as the exact instants the filter
 * built, to the millisecond: an operator's toString() would have written a
 * Date as a day ("2026-11-13").
 */

const FILTERS: Array<Filter<ScheduledMaintenanceStateTimeline>> = [
  { title: "Starts At", type: FieldType.DateTime, field: { startsAt: true } },
  { title: "Created", type: FieldType.Date, field: { createdAt: true } },
] as unknown as Array<Filter<ScheduledMaintenanceStateTimeline>>;

const ISO_INSTANT: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type RowPredicate = (row: Date) => boolean;

interface ServedFilter {
  matches: RowPredicate;
  // The instants the predicate binds, as the database receives them.
  bounds: Array<string>;
}

/*
 * The filter as the database applies it: the list's query, sent and read
 * back the way a request is, made into the column's predicate.
 */
function serve(key: "startsAt" | "createdAt", value: unknown): ServedFilter {
  const query: JSONObject =
    buildQueryFromFilterData<ScheduledMaintenanceStateTimeline>({
      filterData: {
        [key]: value,
      } as FilterData<ScheduledMaintenanceStateTimeline>,
      filters: FILTERS,
    }) as JSONObject;

  // What ModelAPI posts, as the browser sends it.
  const body: JSONObject = JSON.parse(
    JSON.stringify({ query: JSONFunctions.serialize(query) }),
  ) as JSONObject;

  // What BaseAPI reads, and the service hands the database.
  const serverQuery: JSONObject = JSONFunctions.deserialize(
    body["query"] as JSONObject,
  );
  const where: Record<string, unknown> = QueryUtil.serializeQuery(
    ScheduledMaintenanceStateTimeline,
    serverQuery as any,
  ) as unknown as Record<string, unknown>;

  const operator: FindOperator<unknown> = where[key] as FindOperator<unknown>;

  expect(operator).toBeInstanceOf(FindOperator);
  expect(operator.type).toBe("raw");

  const sql: string = operator.getSql!("col");
  const parameters: Record<string, unknown> =
    operator.objectLiteralParameters || {};

  // Only comparisons joined by "and": nothing this reads past.
  expect(sql).not.toMatch(/\bor\b/i);

  const comparisons: Array<{ sign: string; bound: string }> = Array.from(
    sql.matchAll(/col\s*(>=|<=|>|<|=)\s*:(\w+)/g),
  ).map((match: RegExpMatchArray): { sign: string; bound: string } => {
    return { sign: match[1]!, bound: String(parameters[match[2]!]) };
  });

  expect(comparisons.length).toBeGreaterThan(0);

  return {
    bounds: comparisons.map((comparison: { bound: string }): string => {
      return comparison.bound;
    }),
    matches: (row: Date): boolean => {
      return comparisons.every(
        (comparison: { sign: string; bound: string }): boolean => {
          const at: number = row.getTime();
          const bound: number = Date.parse(comparison.bound);

          switch (comparison.sign) {
            case ">=":
              return at >= bound;
            case "<=":
              return at <= bound;
            case ">":
              return at > bound;
            case "<":
              return at < bound;
            default:
              return at === bound;
          }
        },
      );
    },
  };
}

function picked(
  operator: FilterOperator,
  start: string,
  end?: string,
  isDateTime: boolean = true,
): unknown {
  const filterState: DateFilterState = {
    operator,
    start: new Date(start),
    end: end ? new Date(end) : null,
  };

  return buildDateFilterValue(filterState, isDateTime);
}

const ROW_AT_11_15_42: Date = new Date("2026-11-13T11:15:42.000Z");

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
});

describe("a row at 11:15:42, filtered by Starts At", () => {
  test('matches "Is 11:15"', () => {
    expect(
      serve(
        "startsAt",
        picked(FilterOperator.Is, "2026-11-13T11:15:00Z"),
      ).matches(ROW_AT_11_15_42),
    ).toBe(true);
  });

  test('matches "Between 09:00 and 11:15"', () => {
    expect(
      serve(
        "startsAt",
        picked(
          FilterOperator.Between,
          "2026-11-13T09:00:00Z",
          "2026-11-13T11:15:00Z",
        ),
      ).matches(ROW_AT_11_15_42),
    ).toBe(true);
  });

  test('does not match "After 11:15", nor "Before 11:15"', () => {
    expect(
      serve(
        "startsAt",
        picked(FilterOperator.After, "2026-11-13T11:15:00Z"),
      ).matches(ROW_AT_11_15_42),
    ).toBe(false);
    expect(
      serve(
        "startsAt",
        picked(FilterOperator.Before, "2026-11-13T11:15:00Z"),
      ).matches(ROW_AT_11_15_42),
    ).toBe(false);
  });

  test('matches "After 11:14" and "Before 11:16"', () => {
    expect(
      serve(
        "startsAt",
        picked(FilterOperator.After, "2026-11-13T11:14:00Z"),
      ).matches(ROW_AT_11_15_42),
    ).toBe(true);
    expect(
      serve(
        "startsAt",
        picked(FilterOperator.Before, "2026-11-13T11:16:00Z"),
      ).matches(ROW_AT_11_15_42),
    ).toBe(true);
  });

  test("an old saved view's Is, the instant 11:15:00.000, now finds it too", () => {
    expect(
      serve(
        "startsAt",
        new EqualTo<Date>(new Date("2026-11-13T11:15:00.000Z")),
      ).matches(ROW_AT_11_15_42),
    ).toBe(true);
  });

  test("an old saved view's Between, ending at 11:15:00.000, now holds its last minute", () => {
    expect(
      serve(
        "startsAt",
        new InBetween<Date>(
          new Date("2026-11-13T09:00:00.000Z"),
          new Date("2026-11-13T11:15:00.000Z"),
        ),
      ).matches(ROW_AT_11_15_42),
    ).toBe(true);
  });
});

describe("the minute's edges, as the database compares them", () => {
  test.each([
    ["11:14:59.999", false, true, false],
    ["11:15:00.000", true, false, false],
    ["11:15:59.999", true, false, false],
    ["11:16:00.000", false, false, true],
  ])(
    "a row at %s: Is %s, Before %s, After %s",
    (time: string, isIs: boolean, isBefore: boolean, isAfter: boolean) => {
      const row: Date = new Date(`2026-11-13T${time}Z`);
      const minute: string = "2026-11-13T11:15:00Z";

      expect({
        is: serve("startsAt", picked(FilterOperator.Is, minute)).matches(row),
        before: serve(
          "startsAt",
          picked(FilterOperator.Before, minute),
        ).matches(row),
        after: serve("startsAt", picked(FilterOperator.After, minute)).matches(
          row,
        ),
      }).toEqual({ is: isIs, before: isBefore, after: isAfter });
    },
  );
});

describe("the bounds reach the database as exact instants", () => {
  test.each([
    [
      FilterOperator.Is,
      ["2026-11-13T11:15:00.000Z", "2026-11-13T11:15:59.999Z"],
    ],
    [FilterOperator.Before, ["2026-11-13T11:15:00.000Z"]],
    [FilterOperator.After, ["2026-11-13T11:15:59.999Z"]],
    [
      FilterOperator.Between,
      ["2026-11-13T11:15:00.000Z", "2026-11-13T17:30:59.999Z"],
    ],
  ])("%s binds %j", (operator: FilterOperator, bounds: Array<string>) => {
    const served: ServedFilter = serve(
      "startsAt",
      picked(operator, "2026-11-13T11:15:30Z", "2026-11-13T17:30:00Z"),
    );

    expect(
      served.bounds.map((bound: string) => {
        return new Date(bound).toISOString();
      }),
    ).toEqual(bounds);
    for (const bound of served.bounds) {
      // Never collapsed to a day.
      expect(bound).toMatch(ISO_INSTANT);
    }
  });
});

describe("a date filter, from the list to the database", () => {
  test("Is Nov 13 holds every moment of Nov 13 in the reader's zone, and nothing of the days around it", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const day: Date = OneUptimeDate.fromDateTimeLocalString("2026-11-13");
    const served: ServedFilter = serve(
      "createdAt",
      buildDateFilterValue(
        { operator: FilterOperator.Is, start: day, end: null },
        false,
      ),
    );

    // EST is UTC-5: Nov 13 there is 05:00Z to 04:59:59.999Z the next day.
    expect(served.matches(new Date("2026-11-13T05:00:00.000Z"))).toBe(true);
    expect(served.matches(new Date("2026-11-14T04:59:59.999Z"))).toBe(true);
    expect(served.matches(new Date("2026-11-13T04:59:59.999Z"))).toBe(false);
    expect(served.matches(new Date("2026-11-14T05:00:00.000Z"))).toBe(false);
  });

  test("After Nov 13 starts with Nov 14", () => {
    const served: ServedFilter = serve(
      "createdAt",
      picked(FilterOperator.After, "2026-11-13T00:00:00Z", undefined, false),
    );

    expect(served.matches(new Date("2026-11-13T18:00:00.000Z"))).toBe(false);
    expect(served.matches(new Date("2026-11-14T00:00:00.000Z"))).toBe(true);
  });
});
