import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  buildDateFilterValue,
  DateFilterState,
  readDateFilterValue,
  toDateFilterQueryValue,
  toFilterDate,
} from "../../../../UI/Components/Filters/DateFilterValue";
import FilterOperator from "../../../../UI/Components/Filters/Types/FilterOperator";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";

/*
 * WHAT A DATE AND TIME FILTER ASKS FOR (issue #7719).
 *
 * The filter's field takes a minute (#7593), so each moment it is given is
 * the whole minute: Is 11:15 holds 11:15:00.000 to 11:15:59.999, Before
 * 11:15 ends before it, After 11:15 starts after it, and Between 09:00 and
 * 17:30 holds the whole of 17:30. Is used to ask for the instant
 * 11:15:00.000 - it matched nothing a person did - and Between left out its
 * last minute. A date filter does the same with whole days, in the
 * reader's zone. These pin the values each operator builds, how a value is
 * read back (after a reload, from a link or an old saved view), and that
 * Is, Before and After split the timeline with no overlap and no gap.
 */

// 11:15:42.123 on Nov 13 2026, in UTC.
const AT_11_15_42: Date = new Date("2026-11-13T11:15:42.123Z");
const MINUTE_START: string = "2026-11-13T11:15:00.000Z";
const MINUTE_END: string = "2026-11-13T11:15:59.999Z";

function state(
  operator: FilterOperator,
  start: Date | null,
  end: Date | null = null,
): DateFilterState {
  return { operator, start, end };
}

function iso(value: unknown): string {
  return toFilterDate(value)!.toISOString();
}

// Whether a row's moment matches a value, the way the database compares it.
function matches(value: unknown, row: Date): boolean {
  const at: number = row.getTime();

  if (value instanceof InBetween) {
    return (
      at >= toFilterDate(value.startValue)!.getTime() &&
      at <= toFilterDate(value.endValue)!.getTime()
    );
  }

  if (value instanceof GreaterThan) {
    return at > toFilterDate(value.value)!.getTime();
  }

  if (value instanceof LessThan) {
    return at < toFilterDate(value.value)!.getTime();
  }

  if (value instanceof EqualTo) {
    return at === toFilterDate(value.value)!.getTime();
  }

  throw new Error("Not a date filter's value");
}

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
});

describe("OneUptimeDate.getEndOfMinute", () => {
  test.each([
    ["a moment inside the minute", "2026-11-13T11:15:42.123Z"],
    ["the minute's first millisecond", "2026-11-13T11:15:00.000Z"],
    ["the minute's last millisecond", "2026-11-13T11:15:59.999Z"],
  ])("%s ends at 11:15:59.999", (_case: string, moment: string) => {
    expect(OneUptimeDate.getEndOfMinute(new Date(moment)).toISOString()).toBe(
      MINUTE_END,
    );
  });

  test("the next minute's first millisecond is past it", () => {
    expect(
      OneUptimeDate.getEndOfMinute(
        new Date("2026-11-13T11:16:00.000Z"),
      ).toISOString(),
    ).toBe("2026-11-13T11:16:59.999Z");
  });

  test("reads an ISO string, as a link or a saved view gives it", () => {
    expect(
      OneUptimeDate.getEndOfMinute("2026-11-13T11:15:42.123Z").toISOString(),
    ).toBe(MINUTE_END);
  });

  test("the hour's and the day's last minute end where they should", () => {
    expect(
      OneUptimeDate.getEndOfMinute(
        new Date("2026-11-13T11:59:30.000Z"),
      ).toISOString(),
    ).toBe("2026-11-13T11:59:59.999Z");
    expect(
      OneUptimeDate.getEndOfMinute(
        new Date("2026-12-31T23:59:01.000Z"),
      ).toISOString(),
    ).toBe("2026-12-31T23:59:59.999Z");
  });

  test.each([Timezone.AsiaKolkata, Timezone.AsiaKathmandu, Timezone.UTC])(
    "is the same instant in %s, whose offset is whole minutes",
    (timezone: Timezone) => {
      OneUptimeDate.setUserTimezone(timezone);

      expect(OneUptimeDate.getEndOfMinute(AT_11_15_42).toISOString()).toBe(
        MINUTE_END,
      );
    },
  );

  test("leaves the moment it was given as it was", () => {
    const given: Date = new Date(AT_11_15_42.getTime());

    OneUptimeDate.getEndOfMinute(given);

    expect(given.toISOString()).toBe("2026-11-13T11:15:42.123Z");
  });

  test("starts the minute where getStartOfMinute does, 59.999 seconds before its end", () => {
    const start: Date = OneUptimeDate.getStartOfMinute(AT_11_15_42);
    const end: Date = OneUptimeDate.getEndOfMinute(AT_11_15_42);

    expect(end.getTime() - start.getTime()).toBe(59999);
  });
});

describe("a date and time filter's values", () => {
  test("Is: the whole minute, not the instant at its first second", () => {
    const value: unknown = buildDateFilterValue(
      state(FilterOperator.Is, AT_11_15_42),
      true,
    );

    expect(value).toBeInstanceOf(InBetween);
    expect(iso((value as InBetween<Date>).startValue)).toBe(MINUTE_START);
    expect(iso((value as InBetween<Date>).endValue)).toBe(MINUTE_END);
  });

  test("Before: before the minute starts", () => {
    const value: unknown = buildDateFilterValue(
      state(FilterOperator.Before, AT_11_15_42),
      true,
    );

    expect(value).toBeInstanceOf(LessThan);
    expect(iso((value as LessThan<Date>).value)).toBe(MINUTE_START);
  });

  test("After: once the minute is over, from 11:16", () => {
    const value: unknown = buildDateFilterValue(
      state(FilterOperator.After, AT_11_15_42),
      true,
    );

    expect(value).toBeInstanceOf(GreaterThan);
    expect(iso((value as GreaterThan<Date>).value)).toBe(MINUTE_END);
  });

  test("Between: from its first minute's start to its last minute's end", () => {
    const value: unknown = buildDateFilterValue(
      state(
        FilterOperator.Between,
        new Date("2026-11-13T09:00:00.000Z"),
        new Date("2026-11-13T17:30:00.000Z"),
      ),
      true,
    );

    expect(value).toBeInstanceOf(InBetween);
    expect(iso((value as InBetween<Date>).startValue)).toBe(
      "2026-11-13T09:00:00.000Z",
    );
    expect(iso((value as InBetween<Date>).endValue)).toBe(
      "2026-11-13T17:30:59.999Z",
    );
  });

  test("Is empty and Is not empty need no moment", () => {
    expect(
      buildDateFilterValue(state(FilterOperator.IsEmpty, null), true),
    ).toBeInstanceOf(IsNull);
    expect(
      buildDateFilterValue(state(FilterOperator.IsNotEmpty, null), true),
    ).toBeInstanceOf(NotNull);
  });

  test.each([
    FilterOperator.Is,
    FilterOperator.Before,
    FilterOperator.After,
    FilterOperator.Between,
  ])(
    "%s with no moment picked yet asks for nothing",
    (operator: FilterOperator) => {
      expect(buildDateFilterValue(state(operator, null), true)).toBeUndefined();
    },
  );

  test("Between with only its start picked asks for nothing yet", () => {
    expect(
      buildDateFilterValue(
        state(FilterOperator.Between, AT_11_15_42, null),
        true,
      ),
    ).toBeUndefined();
  });

  test("the moments it is given are left as they were", () => {
    const start: Date = new Date(AT_11_15_42.getTime());

    buildDateFilterValue(state(FilterOperator.Is, start), true);
    buildDateFilterValue(state(FilterOperator.After, start), true);

    expect(start.toISOString()).toBe("2026-11-13T11:15:42.123Z");
  });
});

describe("a row at 11:15:42", () => {
  const ROW: Date = AT_11_15_42;
  const AT: Date = new Date("2026-11-13T11:15:00.000Z");

  test("is 11:15", () => {
    expect(
      matches(buildDateFilterValue(state(FilterOperator.Is, AT), true), ROW),
    ).toBe(true);
  });

  test("is between 09:00 and 11:15, the end minute included", () => {
    expect(
      matches(
        buildDateFilterValue(
          state(FilterOperator.Between, new Date("2026-11-13T09:00:00Z"), AT),
          true,
        ),
        ROW,
      ),
    ).toBe(true);
  });

  test("is not after 11:15, nor before it", () => {
    expect(
      matches(buildDateFilterValue(state(FilterOperator.After, AT), true), ROW),
    ).toBe(false);
    expect(
      matches(
        buildDateFilterValue(state(FilterOperator.Before, AT), true),
        ROW,
      ),
    ).toBe(false);
  });

  test("was missed by the old values: Is the instant, Between to the minute's first second", () => {
    expect(matches(new EqualTo<Date>(AT), ROW)).toBe(false);
    expect(
      matches(new InBetween<Date>(new Date("2026-11-13T09:00:00Z"), AT), ROW),
    ).toBe(false);
    expect(matches(new GreaterThan<Date>(AT), ROW)).toBe(true);
  });
});

describe("Is, Before and After split the timeline: every moment is in exactly one", () => {
  function operatorsMatching(
    picked: Date,
    row: Date,
    isDateTime: boolean,
  ): Array<FilterOperator> {
    return [
      FilterOperator.Is,
      FilterOperator.Before,
      FilterOperator.After,
    ].filter((operator: FilterOperator): boolean => {
      return matches(
        buildDateFilterValue(state(operator, picked), isDateTime),
        row,
      );
    });
  }

  test("for a minute, from 10:00 to 12:30, every 7.5 seconds", () => {
    const picked: Date = new Date("2026-11-13T11:15:00.000Z");

    for (
      let at: number = new Date("2026-11-13T10:00:00.000Z").getTime();
      at <= new Date("2026-11-13T12:30:00.000Z").getTime();
      at += 7500
    ) {
      expect(operatorsMatching(picked, new Date(at), true)).toHaveLength(1);
    }
  });

  test.each([
    ["2026-11-13T11:14:59.999Z", FilterOperator.Before],
    ["2026-11-13T11:15:00.000Z", FilterOperator.Is],
    ["2026-11-13T11:15:59.999Z", FilterOperator.Is],
    ["2026-11-13T11:16:00.000Z", FilterOperator.After],
  ])(
    "for a minute, at its edge %s: %s",
    (row: string, operator: FilterOperator) => {
      expect(
        operatorsMatching(
          new Date("2026-11-13T11:15:30.000Z"),
          new Date(row),
          true,
        ),
      ).toEqual([operator]);
    },
  );

  test.each([
    ["2026-11-12T23:59:59.999Z", FilterOperator.Before],
    ["2026-11-13T00:00:00.000Z", FilterOperator.Is],
    ["2026-11-13T23:59:59.999Z", FilterOperator.Is],
    ["2026-11-14T00:00:00.000Z", FilterOperator.After],
  ])(
    "for a day, at its edge %s: %s",
    (row: string, operator: FilterOperator) => {
      expect(
        operatorsMatching(
          new Date("2026-11-13T00:00:00.000Z"),
          new Date(row),
          false,
        ),
      ).toEqual([operator]);
    },
  );

  test("for a day, every hour of three days", () => {
    const picked: Date = new Date("2026-11-13T00:00:00.000Z");

    for (let hour: number = -24; hour < 48; hour++) {
      expect(
        operatorsMatching(
          picked,
          new Date(picked.getTime() + hour * 60 * 60 * 1000 + 1234),
          false,
        ),
      ).toHaveLength(1);
    }
  });
});

describe("a date filter's values: whole days in the reader's zone", () => {
  test("Is a day in New York: from its midnight to its last millisecond there", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    // The day as the date field reads it: midnight in the reader's zone.
    const picked: Date = OneUptimeDate.fromDateTimeLocalString("2026-11-13");
    const value: unknown = buildDateFilterValue(
      state(FilterOperator.Is, picked),
      false,
    );

    // EST is UTC-5.
    expect(iso((value as InBetween<Date>).startValue)).toBe(
      "2026-11-13T05:00:00.000Z",
    );
    expect(iso((value as InBetween<Date>).endValue)).toBe(
      "2026-11-14T04:59:59.999Z",
    );
  });

  test("After a day starts the next day; Before it ends with the day before", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const picked: Date = OneUptimeDate.fromDateTimeLocalString("2026-11-13");

    expect(
      iso(
        (
          buildDateFilterValue(
            state(FilterOperator.After, picked),
            false,
          ) as GreaterThan<Date>
        ).value,
      ),
    ).toBe("2026-11-14T04:59:59.999Z");
    expect(
      iso(
        (
          buildDateFilterValue(
            state(FilterOperator.Before, picked),
            false,
          ) as LessThan<Date>
        ).value,
      ),
    ).toBe("2026-11-13T05:00:00.000Z");
  });

  test("Between two days holds the whole of both", () => {
    OneUptimeDate.setUserTimezone(Timezone.EuropeBerlin);

    const value: unknown = buildDateFilterValue(
      state(
        FilterOperator.Between,
        OneUptimeDate.fromDateTimeLocalString("2026-11-13"),
        OneUptimeDate.fromDateTimeLocalString("2026-11-15"),
      ),
      false,
    );

    // CET is UTC+1.
    expect(iso((value as InBetween<Date>).startValue)).toBe(
      "2026-11-12T23:00:00.000Z",
    );
    expect(iso((value as InBetween<Date>).endValue)).toBe(
      "2026-11-15T22:59:59.999Z",
    );
  });

  test("the day is the reader's, the one their zone set in their settings, not the browser's", () => {
    // The process (the browser) is on UTC; the reader is on Tokyo time.
    OneUptimeDate.setUserTimezone(Timezone.AsiaTokyo);

    const value: unknown = buildDateFilterValue(
      state(
        FilterOperator.Is,
        OneUptimeDate.fromDateTimeLocalString("2026-11-13"),
      ),
      false,
    );

    // JST is UTC+9: Nov 13 there is Nov 12 15:00 to Nov 13 14:59:59.999 UTC.
    expect(iso((value as InBetween<Date>).startValue)).toBe(
      "2026-11-12T15:00:00.000Z",
    );
    expect(iso((value as InBetween<Date>).endValue)).toBe(
      "2026-11-13T14:59:59.999Z",
    );
  });
});

describe("a value read back, as after a reload, a link or a saved view", () => {
  test("a one-minute span reads as Is, at that minute", () => {
    expect(
      readDateFilterValue(
        new InBetween<Date>(new Date(MINUTE_START), new Date(MINUTE_END)),
        true,
      ),
    ).toEqual({
      operator: FilterOperator.Is,
      start: new Date(MINUTE_START),
      end: null,
    });
  });

  test("a span of one whole day reads as Between on a date and time filter, not as Is", () => {
    const read: DateFilterState = readDateFilterValue(
      new InBetween<Date>(
        new Date("2026-11-13T00:00:00.000Z"),
        new Date("2026-11-13T23:59:59.999Z"),
      ),
      true,
    );

    expect(read.operator).toBe(FilterOperator.Between);
  });

  test("a span of one day reads as Is on a date filter; one of a minute as Between", () => {
    expect(
      readDateFilterValue(
        new InBetween<Date>(
          new Date("2026-11-13T00:00:00.000Z"),
          new Date("2026-11-13T23:59:59.999Z"),
        ),
        false,
      ).operator,
    ).toBe(FilterOperator.Is);
    expect(
      readDateFilterValue(
        new InBetween<Date>(new Date(MINUTE_START), new Date(MINUTE_END)),
        false,
      ).operator,
    ).toBe(FilterOperator.Between);
  });

  test("a longer span reads as Between, with both its ends", () => {
    expect(
      readDateFilterValue(
        new InBetween<Date>(
          new Date("2026-11-13T09:00:00.000Z"),
          new Date("2026-11-13T17:30:59.999Z"),
        ),
        true,
      ),
    ).toEqual({
      operator: FilterOperator.Between,
      start: new Date("2026-11-13T09:00:00.000Z"),
      end: new Date("2026-11-13T17:30:59.999Z"),
    });
  });

  test("an EqualTo, as Is built before and an old saved view holds, still reads as Is", () => {
    expect(readDateFilterValue(new EqualTo<Date>(AT_11_15_42), true)).toEqual({
      operator: FilterOperator.Is,
      start: AT_11_15_42,
      end: null,
    });
  });

  test("After, Before, Is empty and Is not empty read as themselves", () => {
    expect(
      readDateFilterValue(new GreaterThan<Date>(new Date(MINUTE_END)), true)
        .operator,
    ).toBe(FilterOperator.After);
    expect(
      readDateFilterValue(new LessThan<Date>(new Date(MINUTE_START)), true)
        .operator,
    ).toBe(FilterOperator.Before);
    expect(readDateFilterValue(new IsNull(), true).operator).toBe(
      FilterOperator.IsEmpty,
    );
    expect(readDateFilterValue(new NotNull(), true).operator).toBe(
      FilterOperator.IsNotEmpty,
    );
  });

  test("moments held as ISO strings, as a link gives them back, read the same", () => {
    expect(
      readDateFilterValue(
        new InBetween<string>(MINUTE_START, MINUTE_END),
        true,
      ),
    ).toEqual({
      operator: FilterOperator.Is,
      start: new Date(MINUTE_START),
      end: null,
    });
  });

  test("nothing, or something that is not a date, reads as Is with no moment", () => {
    for (const value of [undefined, null, "", new Search("x")]) {
      expect(readDateFilterValue(value, true)).toEqual({
        operator: FilterOperator.Is,
        start: null,
        end: null,
      });
    }
  });

  test.each([true, false])(
    "every value built reads back as the operator and moment it was built from (date and time: %s)",
    (isDateTime: boolean) => {
      const start: Date = new Date("2026-11-13T11:15:00.000Z");
      const end: Date = new Date("2026-11-15T17:30:00.000Z");

      for (const operator of [
        FilterOperator.Is,
        FilterOperator.Before,
        FilterOperator.After,
        FilterOperator.Between,
        FilterOperator.IsEmpty,
        FilterOperator.IsNotEmpty,
      ]) {
        const built: unknown = buildDateFilterValue(
          state(operator, start, end),
          isDateTime,
        );
        const read: DateFilterState = readDateFilterValue(built, isDateTime);

        expect(read.operator).toBe(operator);

        // And building it again asks for the very same rows.
        const rebuilt: unknown = buildDateFilterValue(read, isDateTime);
        expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(built));
      }
    },
  );
});

describe("a date filter's value as the query sends it", () => {
  test("an old EqualTo on the instant asks for its whole minute", () => {
    const sent: unknown = toDateFilterQueryValue(
      new EqualTo<Date>(new Date(MINUTE_START)),
      true,
    );

    expect(sent).toBeInstanceOf(InBetween);
    expect(iso((sent as InBetween<Date>).startValue)).toBe(MINUTE_START);
    expect(iso((sent as InBetween<Date>).endValue)).toBe(MINUTE_END);
  });

  test("an old EqualTo on a date filter asks for its whole day", () => {
    const sent: unknown = toDateFilterQueryValue(
      new EqualTo<Date>(new Date("2026-11-13T00:00:00.000Z")),
      false,
    );

    expect(iso((sent as InBetween<Date>).startValue)).toBe(
      "2026-11-13T00:00:00.000Z",
    );
    expect(iso((sent as InBetween<Date>).endValue)).toBe(
      "2026-11-13T23:59:59.999Z",
    );
  });

  test("an old Between that ended on its last minute's first second holds that minute", () => {
    const sent: unknown = toDateFilterQueryValue(
      new InBetween<Date>(
        new Date("2026-11-13T09:00:00.000Z"),
        new Date("2026-11-13T17:30:00.000Z"),
      ),
      true,
    );

    expect(iso((sent as InBetween<Date>).endValue)).toBe(
      "2026-11-13T17:30:59.999Z",
    );
  });

  test("an old After on the minute's first second starts after the minute", () => {
    const sent: unknown = toDateFilterQueryValue(
      new GreaterThan<Date>(new Date(MINUTE_START)),
      true,
    );

    expect(iso((sent as GreaterThan<Date>).value)).toBe(MINUTE_END);
  });

  test("moments held as strings, from a link, are read and sent as the span", () => {
    const sent: unknown = toDateFilterQueryValue(
      new EqualTo<string>("2026-11-13T11:15:00.000Z"),
      true,
    );

    expect(iso((sent as InBetween<Date>).endValue)).toBe(MINUTE_END);
  });

  test("a value that already asks for its span is sent as it is", () => {
    for (const value of [
      buildDateFilterValue(state(FilterOperator.Is, AT_11_15_42), true),
      buildDateFilterValue(state(FilterOperator.After, AT_11_15_42), true),
      buildDateFilterValue(state(FilterOperator.Before, AT_11_15_42), true),
      buildDateFilterValue(
        state(
          FilterOperator.Between,
          AT_11_15_42,
          new Date("2026-11-13T17:30:00.000Z"),
        ),
        true,
      ),
      new InBetween<string>(MINUTE_START, MINUTE_END),
    ]) {
      expect(toDateFilterQueryValue(value, true)).toBe(value);
    }
  });

  test("Is empty, Is not empty and values that are not a date filter's are sent as they are", () => {
    for (const value of [
      new IsNull(),
      new NotNull(),
      new Search("x"),
      new Includes(["a"]),
      "text",
      new Date(MINUTE_START),
    ]) {
      expect(toDateFilterQueryValue(value, true)).toBe(value);
    }
  });

  test("a value with no moment it can read is sent as it is", () => {
    const value: EqualTo<string> = new EqualTo<string>("not a date");

    expect(toDateFilterQueryValue(value, true)).toBe(value);
  });
});
