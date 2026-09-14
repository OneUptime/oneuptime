import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  BREADCRUMB_CATEGORY_LABELS,
  BREADCRUMB_CATEGORY_ORDER,
  BreadcrumbCategory,
  BreadcrumbEventInput,
  BreadcrumbGroup,
  categorizeBreadcrumb,
  countBreadcrumbCategories,
  describeBreadcrumbWindow,
  formatBreadcrumbClockTime,
  formatBreadcrumbOffset,
  formatBreadcrumbSpan,
  getBreadcrumbAttributes,
  getBreadcrumbDetail,
  getBreadcrumbSummary,
  groupBreadcrumbEvents,
  sortBreadcrumbEvents,
} from "../../FeatureSet/Dashboard/src/Utils/BreadcrumbTimelinePresentation";

const EXCEPTION_TIME: Date = new Date("2026-09-14T11:56:00.000Z");

function event(
  name: string,
  attributes: JSONObject = {},
  offsetMs: number = 0,
): BreadcrumbEventInput {
  const time: Date = new Date(EXCEPTION_TIME.getTime() + offsetMs);
  return { name, attributes, time, timeUnixNano: time.getTime() * 1000000 };
}

describe("categorizeBreadcrumb", () => {
  test.each([
    ["an exception event", event("exception"), BreadcrumbCategory.Exception],
    [
      "an event carrying exception.type",
      event("boom", { "exception.type": "TypeError" }),
      BreadcrumbCategory.Exception,
    ],
    ["an http-named event", event("http.request"), BreadcrumbCategory.HTTP],
    [
      "old HTTP semantic conventions",
      event("call", { "http.method": "GET" }),
      BreadcrumbCategory.HTTP,
    ],
    [
      "new HTTP semantic conventions",
      event("call", { "http.request.method": "GET", "url.full": "https://x" }),
      BreadcrumbCategory.HTTP,
    ],
    ["a query-named event", event("sql.query"), BreadcrumbCategory.DB],
    [
      "db.query.text",
      event("step", { "db.query.text": "SELECT 1" }),
      BreadcrumbCategory.DB,
    ],
    [
      "an upper-case error level",
      event("step", { level: "ERROR" }),
      BreadcrumbCategory.Error,
    ],
    [
      "a fatal log.severity",
      event("step", { "log.severity": "fatal" }),
      BreadcrumbCategory.Error,
    ],
    [
      "a warning-named event",
      event("inventory.version_mismatch warning"),
      BreadcrumbCategory.Warning,
    ],
    [
      "a Warning severity",
      event("step", { severity: "Warning" }),
      BreadcrumbCategory.Warning,
    ],
    [
      "a log event with an error level (the level wins)",
      event("log", { level: "error" }),
      BreadcrumbCategory.Error,
    ],
    ["a console event", event("console"), BreadcrumbCategory.Log],
    [
      "an info-level event",
      event("step", { level: "info" }),
      BreadcrumbCategory.Log,
    ],
    ["anything else", event("cart.loaded"), BreadcrumbCategory.Event],
    ["an unnamed event", event(""), BreadcrumbCategory.Event],
  ])(
    "%s",
    (
      _name: string,
      value: BreadcrumbEventInput,
      expected: BreadcrumbCategory,
    ) => {
      expect(categorizeBreadcrumb(value)).toBe(expected);
    },
  );

  test("labels and orders every category", () => {
    expect([...BREADCRUMB_CATEGORY_ORDER].sort()).toEqual(
      Object.values(BreadcrumbCategory).sort(),
    );
    for (const category of Object.values(BreadcrumbCategory)) {
      expect(BREADCRUMB_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});

describe("getBreadcrumbSummary", () => {
  test("describes a request with its status", () => {
    expect(
      getBreadcrumbSummary(
        event("http.response", {
          "http.method": "PUT",
          "http.url": "https://warehouse/reservations",
          "http.status_code": 409,
        }),
      ),
    ).toBe("PUT https://warehouse/reservations → 409");
  });

  test("reads the newer HTTP attribute names", () => {
    expect(
      getBreadcrumbSummary(
        event("call", {
          "http.request.method": "GET",
          "url.full": "https://api/health",
          "http.response.status_code": "200",
        }),
      ),
    ).toBe("GET https://api/health → 200");
  });

  test("uses the statement, the exception message or the log message", () => {
    expect(
      getBreadcrumbSummary(event("db", { "db.statement": "SELECT 1" })),
    ).toBe("SELECT 1");
    expect(
      getBreadcrumbSummary(event("exception", { "exception.message": "boom" })),
    ).toBe("boom");
    expect(
      getBreadcrumbSummary(event("log", { message: "Reserving stock" })),
    ).toBe("Reserving stock");
    expect(
      getBreadcrumbSummary(event("log", { "log.message": "  trimmed  " })),
    ).toBe("trimmed");
  });

  test("falls back to the event name, then to 'Event'", () => {
    expect(getBreadcrumbSummary(event("cart.loaded", { items: 3 }))).toBe(
      "cart.loaded",
    );
    expect(getBreadcrumbSummary(event(""))).toBe("Event");
  });

  test("truncates very long values", () => {
    const summary: string = getBreadcrumbSummary(
      event("db", { "db.statement": "x".repeat(400) }),
    );

    expect(summary).toHaveLength(161);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("getBreadcrumbDetail", () => {
  test("names the exception type", () => {
    expect(
      getBreadcrumbDetail(event("exception", { "exception.type": "TypeError" })),
    ).toBe("TypeError");
  });

  test("flags failed HTTP statuses only", () => {
    expect(
      getBreadcrumbDetail(event("http", { "http.status_code": 503 })),
    ).toBe("HTTP 503");
    expect(
      getBreadcrumbDetail(event("http", { "http.response.status_code": "404" })),
    ).toBe("HTTP 404");
    expect(
      getBreadcrumbDetail(event("http", { "http.status_code": 200 })),
    ).toBeNull();
    expect(getBreadcrumbDetail(event("log"))).toBeNull();
  });
});

describe("formatBreadcrumbOffset", () => {
  test.each([
    [0, "at exception"],
    [-9, "at exception"],
    [-880, "-880 ms"],
    [40, "+40 ms"],
    [-1234, "-1.2 s"],
    [9999, "+10.0 s"],
    [-12500, "-12 s"],
    [-60000, "-1 m"],
    [-125000, "-2 m 5 s"],
  ])("%d ms from the exception reads %s", (offset: number, expected: string) => {
    expect(
      formatBreadcrumbOffset(
        new Date(EXCEPTION_TIME.getTime() + offset),
        EXCEPTION_TIME,
      ),
    ).toBe(expected);
  });

  test("has nothing to say without an exception time", () => {
    expect(formatBreadcrumbOffset(EXCEPTION_TIME, undefined)).toBeNull();
  });
});

describe("formatBreadcrumbClockTime and formatBreadcrumbSpan", () => {
  test("formats the local clock time with milliseconds", () => {
    expect(formatBreadcrumbClockTime(new Date(2026, 8, 14, 9, 3, 7, 41))).toBe(
      "09:03:07.041",
    );
  });

  test.each([
    [-5, "0 ms"],
    [880, "880 ms"],
    [1500, "1.5 s"],
    [45000, "45 s"],
    [120000, "2 m"],
    [200000, "3 m 20 s"],
  ])("a %d ms window reads %s", (durationMs: number, expected: string) => {
    expect(formatBreadcrumbSpan(durationMs)).toBe(expected);
  });
});

describe("getBreadcrumbAttributes", () => {
  test("drops noisy and empty attributes and stringifies objects", () => {
    expect(
      getBreadcrumbAttributes(
        event("exception", {
          "exception.type": "TypeError",
          "exception.stacktrace": "at x",
          "exception.escaped": true,
          empty: "",
          nothing: null,
          count: 3,
          nested: { a: 1 },
        }),
      ),
    ).toEqual([
      { key: "exception.type", value: "TypeError" },
      { key: "count", value: "3" },
      { key: "nested", value: '{"a":1}' },
    ]);
  });
});

describe("sorting and grouping", () => {
  const events: Array<BreadcrumbEventInput> = [
    event("db", { "db.statement": "SELECT 1" }, -300),
    event("http.request", { "http.method": "GET", "http.url": "/a" }, -900),
    event("db", { "db.statement": "SELECT 1" }, -200),
    event("db", { "db.statement": "SELECT 2" }, -100),
    event("exception", { "exception.type": "E" }, 0),
  ];

  test("sorts by time and keeps only the latest events", () => {
    const sorted: Array<BreadcrumbEventInput> = sortBreadcrumbEvents(events, 3);

    expect(
      sorted.map((value: BreadcrumbEventInput) => {
        return value.time.getTime() - EXCEPTION_TIME.getTime();
      }),
    ).toEqual([-200, -100, 0]);
    expect(sortBreadcrumbEvents(events, 0)).toHaveLength(1);
  });

  test("folds consecutive identical events and keeps their time range", () => {
    const groups: Array<BreadcrumbGroup<BreadcrumbEventInput>> =
      groupBreadcrumbEvents(sortBreadcrumbEvents(events, 50));

    expect(
      groups.map((group: BreadcrumbGroup<BreadcrumbEventInput>) => {
        return `${group.category}:${group.summary}:x${group.count}`;
      }),
    ).toEqual([
      "HTTP:GET /a:x1",
      "DB:SELECT 1:x2",
      "DB:SELECT 2:x1",
      "EXCEPTION:exception:x1",
    ]);
    expect(groups[1]!.firstTime.getTime()).toBe(EXCEPTION_TIME.getTime() - 300);
    expect(groups[1]!.lastTime.getTime()).toBe(EXCEPTION_TIME.getTime() - 200);
    expect(groups[3]!.detail).toBe("E");
  });

  test("counts categories", () => {
    const counts: Map<BreadcrumbCategory, number> =
      countBreadcrumbCategories(events);

    expect(counts.get(BreadcrumbCategory.DB)).toBe(3);
    expect(counts.get(BreadcrumbCategory.HTTP)).toBe(1);
    expect(counts.get(BreadcrumbCategory.Exception)).toBe(1);
    expect(counts.has(BreadcrumbCategory.Log)).toBe(false);
  });
});

describe("describeBreadcrumbWindow", () => {
  test("says how long before the exception the events start", () => {
    expect(
      describeBreadcrumbWindow({
        shownCount: 8,
        totalCount: 8,
        firstTime: new Date(EXCEPTION_TIME.getTime() - 880),
        exceptionTime: EXCEPTION_TIME,
      }),
    ).toBe("8 events in the 880 ms before the exception");
  });

  test("handles a single event, events after the exception and no exception time", () => {
    expect(
      describeBreadcrumbWindow({
        shownCount: 1,
        totalCount: 1,
        firstTime: EXCEPTION_TIME,
        exceptionTime: EXCEPTION_TIME,
      }),
    ).toBe("1 event around the exception");
    expect(
      describeBreadcrumbWindow({
        shownCount: 3,
        totalCount: 3,
        firstTime: EXCEPTION_TIME,
        exceptionTime: undefined,
      }),
    ).toBe("3 events");
  });

  test("mentions truncation to the latest events", () => {
    expect(
      describeBreadcrumbWindow({
        shownCount: 50,
        totalCount: 72,
        firstTime: new Date(EXCEPTION_TIME.getTime() - 12000),
        exceptionTime: EXCEPTION_TIME,
      }),
    ).toBe("50 events in the 12 s before the exception (latest 50 of 72)");
  });

  test("describes an active filter", () => {
    expect(
      describeBreadcrumbWindow({
        shownCount: 8,
        totalCount: 8,
        filteredCount: 2,
        firstTime: undefined,
        exceptionTime: EXCEPTION_TIME,
      }),
    ).toBe("2 of 8 events match the filters");
  });
});
