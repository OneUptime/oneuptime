import { describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import {
  DEFAULT_SECURITY_EVENTS_TIME_RANGE,
  SECURITY_EVENTS_END_PARAM,
  SECURITY_EVENTS_RANGE_PARAM,
  SECURITY_EVENTS_START_PARAM,
  SECURITY_EVENTS_TABLE_ID,
  getSecurityEventsTimeRangeLinkParams,
  getSecurityEventsTimeRangeParams,
  getTimeRangeCovering,
  parseLegacyTableTimeFilter,
  parseSecurityEventsTimeRange,
  readSecurityEventsTimeRange,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsTimeRange";

const START: string = "2026-09-17T10:00:00.000Z";
const END: string = "2026-09-17T12:30:00.000Z";

function search(params: Dictionary<string | null>): string {
  const urlParams: URLSearchParams = new URLSearchParams();

  for (const key of Object.keys(params)) {
    const value: string | null | undefined = params[key];
    if (value !== null && value !== undefined) {
      urlParams.set(key, value);
    }
  }

  return `?${urlParams.toString()}`;
}

function legacyLink(filter: Record<string, unknown>): string {
  const params: Dictionary<string> = TableFilterUrlState.getLinkQueryParams(
    SECURITY_EVENTS_TABLE_ID,
    { filter: filter as never },
  );

  return `?${Object.keys(params)
    .map((key: string): string => {
      return `${key}=${params[key]}`;
    })
    .join("&")}`;
}

function customRange(start: string, end: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(start), new Date(end)),
  };
}

function expectCustom(
  actual: RangeStartAndEndDateTime | null,
  start: string,
  end: string,
): void {
  expect(actual).not.toBeNull();
  expect(actual!.range).toBe(TimeRange.CUSTOM);
  expect(actual!.startAndEndDate).toBeInstanceOf(InBetween);
  expect(new Date(actual!.startAndEndDate!.startValue).toISOString()).toBe(
    start,
  );
  expect(new Date(actual!.startAndEndDate!.endValue).toISOString()).toBe(end);
}

describe("Security Events time range defaults", () => {
  test("the page opens on the past day", () => {
    expect(DEFAULT_SECURITY_EVENTS_TIME_RANGE).toEqual({
      range: TimeRange.PAST_ONE_DAY,
    });
  });

  test("uses the param names the other explorers use", () => {
    expect(SECURITY_EVENTS_RANGE_PARAM).toBe("range");
    expect(SECURITY_EVENTS_START_PARAM).toBe("start");
    expect(SECURITY_EVENTS_END_PARAM).toBe("end");
  });

  test("keeps the table's URL namespace, so existing links still reach it", () => {
    expect(SECURITY_EVENTS_TABLE_ID).toBe("security-events-table");
  });
});

describe("parseSecurityEventsTimeRange", () => {
  test.each(
    Object.values(TimeRange).filter((range: TimeRange): boolean => {
      return range !== TimeRange.CUSTOM;
    }),
  )("reads the relative range %s", (range: TimeRange) => {
    expect(parseSecurityEventsTimeRange(search({ range: range }))).toEqual({
      range: range,
    });
  });

  test("a relative range ignores any start / end beside it", () => {
    expect(
      parseSecurityEventsTimeRange(
        search({ range: TimeRange.PAST_ONE_WEEK, start: START, end: END }),
      ),
    ).toEqual({ range: TimeRange.PAST_ONE_WEEK });
  });

  test("reads a custom range with its dates", () => {
    expectCustom(
      parseSecurityEventsTimeRange(
        search({ range: TimeRange.CUSTOM, start: START, end: END }),
      ),
      START,
      END,
    );
  });

  test.each([
    ["no params at all", {}],
    ["an unknown range", { range: "Past 1 Fortnight" }],
    ["a custom range with no dates", { range: TimeRange.CUSTOM }],
    [
      "a custom range missing its end",
      { range: TimeRange.CUSTOM, start: START },
    ],
    [
      "a custom range with an unparseable date",
      { range: TimeRange.CUSTOM, start: "yesterday", end: END },
    ],
    [
      "a custom range that ends before it starts",
      { range: TimeRange.CUSTOM, start: END, end: START },
    ],
    [
      "a custom range with no width",
      { range: TimeRange.CUSTOM, start: START, end: START },
    ],
  ])("is null for %s", (_label: unknown, params: unknown) => {
    expect(
      parseSecurityEventsTimeRange(search(params as Dictionary<string>)),
    ).toBeNull();
  });
});

describe("parseLegacyTableTimeFilter", () => {
  test("honours a link that set time as a table filter", () => {
    expectCustom(
      parseLegacyTableTimeFilter(
        legacyLink({
          time: new InBetween<Date>(new Date(START), new Date(END)),
        }),
      ),
      START,
      END,
    );
  });

  test("honours it beside other table filters", () => {
    expectCustom(
      parseLegacyTableTimeFilter(
        legacyLink({
          time: new InBetween<Date>(new Date(START), new Date(END)),
          attributes: { "oneuptime.security.connection.id": "abc" },
        }),
      ),
      START,
      END,
    );
  });

  test("is null when the table filter has no time in it", () => {
    expect(
      parseLegacyTableTimeFilter(
        legacyLink({ severityName: new Includes(["High"]) }),
      ),
    ).toBeNull();
  });

  test("is null for a time filter that is not a range", () => {
    expect(parseLegacyTableTimeFilter(legacyLink({ time: START }))).toBeNull();
  });

  test("is null for a hand-mangled filter param", () => {
    expect(
      parseLegacyTableTimeFilter(
        `?${TableFilterUrlState.getParamName(SECURITY_EVENTS_TABLE_ID, "filter")}=%7Bnot-json`,
      ),
    ).toBeNull();
  });

  test("is null with no filter param", () => {
    expect(parseLegacyTableTimeFilter("")).toBeNull();
  });
});

describe("readSecurityEventsTimeRange", () => {
  test("falls back to the default with nothing on the URL", () => {
    expect(readSecurityEventsTimeRange("")).toEqual(
      DEFAULT_SECURITY_EVENTS_TIME_RANGE,
    );
  });

  test("falls back to the default for a range it cannot read", () => {
    expect(readSecurityEventsTimeRange(search({ range: "Soon" }))).toEqual(
      DEFAULT_SECURITY_EVENTS_TIME_RANGE,
    );
  });

  test("the page's own params win over a legacy table filter", () => {
    const both: string = `${search({ range: TimeRange.PAST_ONE_HOUR })}&${legacyLink(
      { time: new InBetween<Date>(new Date(START), new Date(END)) },
    ).slice(1)}`;

    expect(readSecurityEventsTimeRange(both)).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
    });
  });

  test("uses a legacy table filter when that is all there is", () => {
    expectCustom(
      readSecurityEventsTimeRange(
        legacyLink({
          time: new InBetween<Date>(new Date(START), new Date(END)),
        }),
      ),
      START,
      END,
    );
  });
});

describe("getSecurityEventsTimeRangeParams", () => {
  test("a relative range writes only its name, clearing start and end", () => {
    expect(
      getSecurityEventsTimeRangeParams({ range: TimeRange.PAST_ONE_WEEK }),
    ).toEqual({ range: TimeRange.PAST_ONE_WEEK, start: null, end: null });
  });

  test("a custom range writes its dates", () => {
    expect(getSecurityEventsTimeRangeParams(customRange(START, END))).toEqual({
      range: TimeRange.CUSTOM,
      start: START,
      end: END,
    });
  });

  test("a custom range with no dates falls back to the default rather than writing a broken link", () => {
    expect(
      getSecurityEventsTimeRangeParams({ range: TimeRange.CUSTOM }),
    ).toEqual({
      range: DEFAULT_SECURITY_EVENTS_TIME_RANGE.range,
      start: null,
      end: null,
    });
  });

  test.each([
    ["a relative range", { range: TimeRange.PAST_TWO_DAYS }],
    ["a custom range", customRange(START, END)],
  ])(
    "%s round-trips through the URL",
    (_label: unknown, timeRange: unknown) => {
      expect(
        readSecurityEventsTimeRange(
          search(
            getSecurityEventsTimeRangeParams(
              timeRange as RangeStartAndEndDateTime,
            ),
          ),
        ),
      ).toEqual(timeRange);
    },
  );
});

describe("getSecurityEventsTimeRangeLinkParams", () => {
  test("encodes a custom window for Route.addQueryParams, which does not", () => {
    expect(
      getSecurityEventsTimeRangeLinkParams(new Date(START), new Date(END)),
    ).toEqual({
      range: "Custom",
      start: encodeURIComponent(START),
      end: encodeURIComponent(END),
    });
  });

  test("a link built from them opens that window", () => {
    const params: Dictionary<string> = getSecurityEventsTimeRangeLinkParams(
      new Date(START),
      new Date(END),
    );
    const link: string = `?${Object.keys(params)
      .map((key: string): string => {
        return `${key}=${params[key]}`;
      })
      .join("&")}`;

    expectCustom(readSecurityEventsTimeRange(link), START, END);
  });
});

describe("getTimeRangeCovering", () => {
  const NOW: Date = new Date("2026-09-18T12:00:00.000Z");
  const MINUTE_MS: number = 60 * 1000;
  const HOUR_MS: number = 60 * MINUTE_MS;
  const DAY_MS: number = 24 * HOUR_MS;

  function ago(ms: number): Date {
    return new Date(NOW.getTime() - ms);
  }

  test.each([
    ["ten minutes", 10 * MINUTE_MS, TimeRange.PAST_ONE_HOUR],
    ["six hours", 6 * HOUR_MS, TimeRange.PAST_ONE_DAY],
    ["three days", 3 * DAY_MS, TimeRange.PAST_ONE_WEEK],
    ["twenty days", 20 * DAY_MS, TimeRange.PAST_ONE_MONTH],
    ["sixty days", 60 * DAY_MS, TimeRange.PAST_THREE_MONTHS],
  ])(
    "an event %s old is covered by %s",
    (_label: unknown, ageMs: unknown, expected: unknown) => {
      expect(getTimeRangeCovering(ago(ageMs as number), NOW)).toEqual({
        range: expected,
      });
    },
  );

  test("an event right at a preset's edge gets the next one up, so it cannot slip out while loading", () => {
    expect(getTimeRangeCovering(ago(58 * MINUTE_MS), NOW)).toEqual({
      range: TimeRange.PAST_ONE_DAY,
    });
    expect(getTimeRangeCovering(ago(DAY_MS - MINUTE_MS), NOW)).toEqual({
      range: TimeRange.PAST_ONE_WEEK,
    });
  });

  test("an event older than every preset gets a custom window from a day before it to now", () => {
    const latest: Date = ago(200 * DAY_MS);

    expectCustom(
      getTimeRangeCovering(latest, NOW),
      new Date(latest.getTime() - DAY_MS).toISOString(),
      NOW.toISOString(),
    );
  });

  test("the range it picks does contain the event", () => {
    for (const ageMs of [
      MINUTE_MS,
      2 * HOUR_MS,
      2 * DAY_MS,
      10 * DAY_MS,
      45 * DAY_MS,
      400 * DAY_MS,
    ]) {
      const latest: Date = ago(ageMs);
      const covering: RangeStartAndEndDateTime = getTimeRangeCovering(
        latest,
        NOW,
      );

      if (covering.range === TimeRange.CUSTOM) {
        expect(
          new Date(covering.startAndEndDate!.startValue).getTime(),
        ).toBeLessThan(latest.getTime());
        continue;
      }

      const spans: Partial<Record<TimeRange, number>> = {
        [TimeRange.PAST_ONE_HOUR]: HOUR_MS,
        [TimeRange.PAST_ONE_DAY]: DAY_MS,
        [TimeRange.PAST_ONE_WEEK]: 7 * DAY_MS,
        [TimeRange.PAST_ONE_MONTH]: 28 * DAY_MS,
        [TimeRange.PAST_THREE_MONTHS]: 89 * DAY_MS,
      };
      expect(ageMs).toBeLessThan(spans[covering.range]!);
    }
  });
});
