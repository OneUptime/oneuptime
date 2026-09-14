import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_EXCEPTION_TREND_WINDOW,
  EXCEPTION_FINGERPRINT_PREVIEW_LENGTH,
  EXCEPTION_TREND_MAX_ROWS,
  EXCEPTION_TREND_WINDOWS,
  ExceptionTrendBucket,
  ExceptionTrendRow,
  ExceptionTrendWindow,
  ExceptionTrendWindowKey,
  ExceptionTriageAction,
  buildExceptionTrendRequest,
  buildExceptionTrendRows,
  describeExceptionStatusChange,
  formatActiveSpan,
  formatOccurrenceCount,
  formatRelativeTime,
  getExceptionTrendWindow,
  getExceptionTriageActions,
  getFingerprintPreview,
  summarizeExceptionTrend,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";
import { JSONObject } from "Common/Types/JSON";

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("formatRelativeTime", () => {
  test.each([
    ["a few seconds ago", 10 * SECOND, "just now"],
    ["exactly now", 0, "just now"],
    ["one minute ago", 60 * SECOND, "1 minute ago"],
    ["45 seconds rounds up to a minute", 45 * SECOND, "1 minute ago"],
    ["several minutes ago", 4 * MINUTE, "4 minutes ago"],
    ["just under the hour threshold", 44 * MINUTE, "44 minutes ago"],
    ["45 minutes reads as an hour", 45 * MINUTE, "1 hour ago"],
    ["several hours ago", 5 * HOUR, "5 hours ago"],
    ["a day ago", 22 * HOUR, "1 day ago"],
    ["several days ago", 6 * DAY, "6 days ago"],
    ["about a month ago", 30 * DAY, "1 month ago"],
    ["several months ago", 150 * DAY, "5 months ago"],
    ["about a year ago", 365 * DAY, "1 year ago"],
    ["several years ago", 3 * 365 * DAY, "3 years ago"],
  ])("%s", (_name: string, offsetMs: number, expected: string) => {
    expect(formatRelativeTime(ago(offsetMs), NOW)).toBe(expected);
  });

  test("describes future times without 'ago'", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 3 * HOUR), NOW)).toBe(
      "in 3 hours",
    );
    expect(formatRelativeTime(new Date(NOW.getTime() + 20 * SECOND), NOW)).toBe(
      "just now",
    );
  });

  test("accepts ISO strings and epoch milliseconds", () => {
    expect(formatRelativeTime(ago(2 * DAY).toISOString(), NOW)).toBe(
      "2 days ago",
    );
    expect(formatRelativeTime(ago(2 * HOUR).getTime(), NOW)).toBe(
      "2 hours ago",
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["an unparseable string", "not a date"],
    ["an invalid Date", new Date("nope")],
  ])("returns null for %s", (_name: string, value: unknown) => {
    expect(formatRelativeTime(value, NOW)).toBeNull();
  });
});

describe("formatActiveSpan", () => {
  test.each([
    ["under a minute", 20 * SECOND, "less than a minute"],
    ["minutes", 12 * MINUTE, "12 minutes"],
    ["one hour", HOUR, "1 hour"],
    ["hours", 7 * HOUR, "7 hours"],
    ["one day", DAY, "1 day"],
    ["days", 6 * DAY + 3 * HOUR, "6 days"],
  ])("formats %s", (_name: string, spanMs: number, expected: string) => {
    expect(formatActiveSpan(ago(spanMs), NOW)).toBe(expected);
  });

  test("returns null when either end is missing or the ends are reversed", () => {
    expect(formatActiveSpan(undefined, NOW)).toBeNull();
    expect(formatActiveSpan(NOW, undefined)).toBeNull();
    expect(formatActiveSpan(NOW, ago(HOUR))).toBeNull();
    expect(formatActiveSpan("garbage", NOW)).toBeNull();
  });
});

describe("formatOccurrenceCount", () => {
  test("groups thousands with the locale separator", () => {
    expect(formatOccurrenceCount(1284)).toBe(
      new Intl.NumberFormat().format(1284),
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a negative number", -4],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "12"],
  ])("treats %s as zero", (_name: string, value: unknown) => {
    expect(formatOccurrenceCount(value)).toBe("0");
  });

  test("drops fractional counts", () => {
    expect(formatOccurrenceCount(7.9)).toBe("7");
  });
});

describe("getFingerprintPreview", () => {
  test("keeps short fingerprints whole", () => {
    expect(getFingerprintPreview("abc123")).toBe("abc123");
    expect(getFingerprintPreview("  abc123  ")).toBe("abc123");
  });

  test("shortens long fingerprints with an ellipsis", () => {
    const fingerprint: string = "f".repeat(64);
    const preview: string = getFingerprintPreview(fingerprint);

    expect(preview).toBe(
      `${"f".repeat(EXCEPTION_FINGERPRINT_PREVIEW_LENGTH)}…`,
    );
  });

  test("returns an empty string for a missing fingerprint", () => {
    expect(getFingerprintPreview(undefined)).toBe("");
  });
});

describe("occurrence trend windows", () => {
  test("offers 24h, 7d and 30d with 24h as the default", () => {
    expect(
      EXCEPTION_TREND_WINDOWS.map((window: ExceptionTrendWindow) => {
        return window.label;
      }),
    ).toEqual(["24h", "7d", "30d"]);
    expect(DEFAULT_EXCEPTION_TREND_WINDOW).toBe(ExceptionTrendWindowKey.Day);
  });

  test.each(EXCEPTION_TREND_WINDOWS.map((window: ExceptionTrendWindow) => {
    return [window.label, window];
  }))(
    "the %s window keeps the bar count readable",
    (_label: string, window: ExceptionTrendWindow) => {
      const bars: number = window.durationMs / (window.bucketSizeInMinutes * MINUTE);

      expect(bars).toBeGreaterThanOrEqual(30);
      expect(bars).toBeLessThanOrEqual(48);
    },
  );

  test("falls back to the first window for an unknown key", () => {
    expect(getExceptionTrendWindow("1y").key).toBe(ExceptionTrendWindowKey.Day);
    expect(getExceptionTrendWindow(ExceptionTrendWindowKey.Month).label).toBe(
      "30d",
    );
  });
});

describe("buildExceptionTrendRequest", () => {
  const serviceId: string = "60000000-0000-4000-8000-000000000001";

  test("scopes the histogram to the fingerprint and the service", () => {
    expect(
      buildExceptionTrendRequest({
        windowKey: ExceptionTrendWindowKey.Week,
        fingerprint: "fp-1",
        primaryEntityId: new ObjectID(serviceId),
        now: NOW,
      }),
    ).toEqual({
      startTime: ago(7 * DAY).toISOString(),
      endTime: NOW.toISOString(),
      bucketSizeInMinutes: 240,
      fingerprints: ["fp-1"],
      serviceIds: [serviceId],
    });
  });

  test("omits serviceIds when the group has no service", () => {
    const request: JSONObject | null = buildExceptionTrendRequest({
      windowKey: ExceptionTrendWindowKey.Day,
      fingerprint: " fp-2 ",
      now: NOW,
    });

    expect(request).not.toBeNull();
    expect(request!["fingerprints"]).toEqual(["fp-2"]);
    expect(request).not.toHaveProperty("serviceIds");
    expect(request!["startTime"]).toBe(ago(DAY).toISOString());
    expect(request!["bucketSizeInMinutes"]).toBe(30);
  });

  test.each([
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])(
    "refuses to build an unscoped request when the fingerprint is %s",
    (_name: string, fingerprint: string | undefined) => {
      expect(
        buildExceptionTrendRequest({
          windowKey: ExceptionTrendWindowKey.Day,
          fingerprint,
          now: NOW,
        }),
      ).toBeNull();
    },
  );
});

describe("summarizeExceptionTrend", () => {
  test("totals each series and picks the tallest stacked bar", () => {
    const buckets: Array<ExceptionTrendBucket> = [
      { time: "2026-09-14 10:00:00", series: "unhandled", count: 4 },
      { time: "2026-09-14 10:00:00", series: "handled", count: 3 },
      { time: "2026-09-14 11:00:00", series: "unhandled", count: 6 },
      { time: "2026-09-14 11:30:00", series: "handled", count: 1 },
    ];

    expect(summarizeExceptionTrend(buckets)).toEqual({
      total: 14,
      unhandled: 10,
      handled: 4,
      peakCount: 7,
      peakTime: "2026-09-14 10:00:00",
    });
  });

  test("ignores zero, negative and malformed counts", () => {
    expect(
      summarizeExceptionTrend([
        { time: "a", series: "unhandled", count: 0 },
        { time: "b", series: "unhandled", count: -3 },
        { time: "c", series: "handled", count: Number.NaN },
        { time: "d", series: "handled", count: "9" as unknown as number },
      ]),
    ).toEqual({
      total: 0,
      unhandled: 0,
      handled: 0,
      peakCount: 0,
      peakTime: null,
    });
  });

  test("treats an unknown series as unhandled so nothing is dropped", () => {
    expect(
      summarizeExceptionTrend([{ time: "a", series: "other", count: 2 }])
        .unhandled,
    ).toBe(2);
  });

  test("handles a missing bucket list", () => {
    expect(summarizeExceptionTrend(undefined).total).toBe(0);
    expect(summarizeExceptionTrend(null).peakTime).toBeNull();
  });
});

describe("buildExceptionTrendRows", () => {
  const request: JSONObject = {
    startTime: "2026-09-14T10:10:00.000Z",
    endTime: "2026-09-14T12:00:00.000Z",
    bucketSizeInMinutes: 30,
  };

  test("fills every bucket in the window, aligned to the epoch", () => {
    const rows: Array<ExceptionTrendRow> = buildExceptionTrendRows([], request);

    expect(
      rows.map((row: ExceptionTrendRow) => {
        return new Date(row.timeMs).toISOString();
      }),
    ).toEqual([
      "2026-09-14T10:00:00.000Z",
      "2026-09-14T10:30:00.000Z",
      "2026-09-14T11:00:00.000Z",
      "2026-09-14T11:30:00.000Z",
      "2026-09-14T12:00:00.000Z",
    ]);
    expect(
      rows.every((row: ExceptionTrendRow) => {
        return row.handled === 0 && row.unhandled === 0;
      }),
    ).toBe(true);
  });

  test("reads ClickHouse bucket times as UTC and places counts per series", () => {
    const rows: Array<ExceptionTrendRow> = buildExceptionTrendRows(
      [
        { time: "2026-09-14 10:30:00", series: "unhandled", count: 5 },
        { time: "2026-09-14 10:30:00", series: "handled", count: 2 },
        { time: "2026-09-14T11:30:00.000Z", series: "unhandled", count: 1 },
      ],
      request,
    );

    const byIso: Map<string, ExceptionTrendRow> = new Map(
      rows.map((row: ExceptionTrendRow): [string, ExceptionTrendRow] => {
        return [new Date(row.timeMs).toISOString(), row];
      }),
    );

    expect(byIso.get("2026-09-14T10:30:00.000Z")).toMatchObject({
      unhandled: 5,
      handled: 2,
    });
    expect(byIso.get("2026-09-14T11:30:00.000Z")).toMatchObject({
      unhandled: 1,
      handled: 0,
    });
  });

  test("snaps a bucket that starts mid-interval into its interval", () => {
    const rows: Array<ExceptionTrendRow> = buildExceptionTrendRows(
      [{ time: "2026-09-14 11:12:34", series: "handled", count: 3 }],
      request,
    );

    expect(
      rows.find((row: ExceptionTrendRow) => {
        return new Date(row.timeMs).toISOString() === "2026-09-14T11:00:00.000Z";
      })?.handled,
    ).toBe(3);
  });

  test("drops buckets outside the window and unparseable times", () => {
    const rows: Array<ExceptionTrendRow> = buildExceptionTrendRows(
      [
        { time: "2026-09-13 10:30:00", series: "unhandled", count: 50 },
        { time: "", series: "unhandled", count: 50 },
        { time: "nonsense", series: "unhandled", count: 50 },
      ],
      request,
    );

    const total: number = rows.reduce((sum: number, row: ExceptionTrendRow) => {
      return sum + row.handled + row.unhandled;
    }, 0);

    expect(total).toBe(0);
  });

  test.each([
    ["no request", null],
    ["a zero bucket size", { ...request, bucketSizeInMinutes: 0 }],
    ["an unparseable start", { ...request, startTime: "later" }],
    [
      "an end before the start",
      { ...request, endTime: "2026-09-14T09:00:00.000Z" },
    ],
  ])("returns no rows for %s", (_name: string, value: JSONObject | null) => {
    expect(buildExceptionTrendRows([], value)).toEqual([]);
  });

  test("caps the number of rows for an absurd bucket size", () => {
    expect(
      buildExceptionTrendRows([], {
        startTime: "2020-01-01T00:00:00.000Z",
        endTime: "2026-01-01T00:00:00.000Z",
        bucketSizeInMinutes: 1,
      }),
    ).toHaveLength(EXCEPTION_TREND_MAX_ROWS);
  });
});

describe("getExceptionTriageActions", () => {
  function summarize(actions: Array<ExceptionTriageAction>): Array<string> {
    return actions.map((action: ExceptionTriageAction) => {
      return `${action.id}:${action.label}:${action.nextState.isResolved}/${action.nextState.isArchived}`;
    });
  }

  test.each([
    [
      "an open exception",
      { isResolved: false, isArchived: false },
      ["resolve:Resolve:true/false", "archive:Archive:false/true"],
    ],
    [
      "a resolved exception",
      { isResolved: true, isArchived: false },
      ["unresolve:Reopen:false/false", "archive:Archive:true/true"],
    ],
    [
      "an archived exception",
      { isResolved: false, isArchived: true },
      ["resolve:Resolve:true/true", "unarchive:Unarchive:false/false"],
    ],
    [
      "a resolved and archived exception",
      { isResolved: true, isArchived: true },
      ["unresolve:Reopen:false/true", "unarchive:Unarchive:true/false"],
    ],
  ])(
    "offers the two opposite actions for %s, each changing one flag",
    (
      _name: string,
      state: { isResolved: boolean; isArchived: boolean },
      expected: Array<string>,
    ) => {
      expect(summarize(getExceptionTriageActions(state))).toEqual(expected);
    },
  );
});

describe("describeExceptionStatusChange", () => {
  test("names when and who", () => {
    expect(
      describeExceptionStatusChange({
        isActive: true,
        at: ago(2 * HOUR),
        byName: "Priya Raman",
        activeVerb: "Resolved",
        inactiveText: "Open",
        now: NOW,
      }),
    ).toBe("Resolved 2 hours ago by Priya Raman");
  });

  test("leaves out an unknown time or person", () => {
    expect(
      describeExceptionStatusChange({
        isActive: true,
        at: undefined,
        byName: "Priya Raman",
        activeVerb: "Archived",
        inactiveText: "Open",
        now: NOW,
      }),
    ).toBe("Archived by Priya Raman");
    expect(
      describeExceptionStatusChange({
        isActive: true,
        at: ago(DAY),
        byName: "   ",
        activeVerb: "Archived",
        inactiveText: "Open",
        now: NOW,
      }),
    ).toBe("Archived 1 day ago");
    expect(
      describeExceptionStatusChange({
        isActive: true,
        at: null,
        byName: undefined,
        activeVerb: "Resolved",
        inactiveText: "Open",
        now: NOW,
      }),
    ).toBe("Resolved");
  });

  test("uses the inactive text when the state is off, ignoring stale history", () => {
    expect(
      describeExceptionStatusChange({
        isActive: false,
        at: ago(DAY),
        byName: "Priya Raman",
        activeVerb: "Resolved",
        inactiveText: "Open and waiting for a fix.",
        now: NOW,
      }),
    ).toBe("Open and waiting for a fix.");
  });
});
