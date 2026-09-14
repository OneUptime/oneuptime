import { describe, expect, test } from "@jest/globals";
import TimeRange from "Common/Types/Time/TimeRange";
import { EXCEPTION_LOG_WINDOW_MS } from "../../FeatureSet/Dashboard/src/Utils/ExceptionCorrelation";
import { getExceptionSpansDefaultTimeRange } from "../../FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";
import {
  ExceptionLogsViewerScope,
  ExceptionLogsViewerScopeKey,
  getDefaultExceptionLogsViewerScope,
  getExceptionLogsViewerScopes,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionLogsScope";

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");
const OCCURRED_AT: Date = new Date("2026-09-14T11:00:00.000Z");
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";

function keys(scopes: Array<ExceptionLogsViewerScope>): Array<string> {
  return scopes.map((scope: ExceptionLogsViewerScope) => {
    return scope.key;
  });
}

describe("getExceptionLogsViewerScopes", () => {
  test("offers the trace first and the service second, both windowed", () => {
    const scopes: Array<ExceptionLogsViewerScope> =
      getExceptionLogsViewerScopes({
        traceId: TRACE_ID,
        primaryEntityId: SERVICE_ID,
        time: OCCURRED_AT,
        now: NOW,
      });

    expect(keys(scopes)).toEqual([
      ExceptionLogsViewerScopeKey.Trace,
      ExceptionLogsViewerScopeKey.Service,
    ]);

    const [trace, service] = scopes;

    expect(trace).toMatchObject({
      label: "Latest trace",
      traceId: TRACE_ID,
      serviceId: null,
    });
    expect(service).toMatchObject({
      label: "Service",
      traceId: null,
      serviceId: SERVICE_ID,
    });

    for (const scope of scopes) {
      expect(scope.window?.startTime.getTime()).toBe(
        OCCURRED_AT.getTime() - EXCEPTION_LOG_WINDOW_MS,
      );
      expect(scope.window?.endTime.getTime()).toBe(
        OCCURRED_AT.getTime() + EXCEPTION_LOG_WINDOW_MS,
      );
      expect(scope.description).toContain("5 minutes either side");
    }
  });

  test("offers only the service when the occurrence has no trace", () => {
    expect(
      keys(
        getExceptionLogsViewerScopes({
          traceId: "   ",
          primaryEntityId: SERVICE_ID,
          time: OCCURRED_AT,
          now: NOW,
        }),
      ),
    ).toEqual([ExceptionLogsViewerScopeKey.Service]);
  });

  test("offers only the trace when there is no service", () => {
    expect(
      keys(
        getExceptionLogsViewerScopes({
          traceId: TRACE_ID,
          primaryEntityId: undefined,
          time: OCCURRED_AT,
          now: NOW,
        }),
      ),
    ).toEqual([ExceptionLogsViewerScopeKey.Trace]);
  });

  test("offers nothing without a trace or a service", () => {
    expect(
      getExceptionLogsViewerScopes({ traceId: "", time: OCCURRED_AT }),
    ).toEqual([]);
    expect(getExceptionLogsViewerScopes({})).toEqual([]);
  });

  test("leaves the viewer's own range when the occurrence time is unreadable", () => {
    const scopes: Array<ExceptionLogsViewerScope> =
      getExceptionLogsViewerScopes({
        traceId: TRACE_ID,
        primaryEntityId: SERVICE_ID,
        time: "not a time",
        now: NOW,
      });

    for (const scope of scopes) {
      expect(scope.window).toBeNull();
      expect(scope.description).toContain("default time range");
    }
  });
});

describe("getDefaultExceptionLogsViewerScope", () => {
  const scopes: Array<ExceptionLogsViewerScope> = getExceptionLogsViewerScopes({
    traceId: TRACE_ID,
    primaryEntityId: SERVICE_ID,
    time: OCCURRED_AT,
    now: NOW,
  });

  test("uses the first scope unless another one was picked", () => {
    expect(getDefaultExceptionLogsViewerScope(scopes)?.key).toBe(
      ExceptionLogsViewerScopeKey.Trace,
    );
    expect(
      getDefaultExceptionLogsViewerScope(
        scopes,
        ExceptionLogsViewerScopeKey.Service,
      )?.key,
    ).toBe(ExceptionLogsViewerScopeKey.Service);
  });

  test("falls back when the picked scope is not available", () => {
    const traceOnly: Array<ExceptionLogsViewerScope> = scopes.slice(0, 1);

    expect(
      getDefaultExceptionLogsViewerScope(
        traceOnly,
        ExceptionLogsViewerScopeKey.Service,
      )?.key,
    ).toBe(ExceptionLogsViewerScopeKey.Trace);
    expect(getDefaultExceptionLogsViewerScope([])).toBeNull();
  });
});

describe("getExceptionSpansDefaultTimeRange", () => {
  const MINUTE: number = 60 * 1000;
  const HOUR: number = 60 * MINUTE;
  const DAY: number = 24 * HOUR;

  test.each([
    ["minutes ago", 4 * MINUTE, TimeRange.PAST_ONE_DAY],
    ["a few hours ago", 5 * HOUR, TimeRange.PAST_ONE_DAY],
    ["exactly a day ago", DAY, TimeRange.PAST_ONE_DAY],
    ["three days ago", 3 * DAY, TimeRange.PAST_ONE_WEEK],
    ["exactly a week ago", 7 * DAY, TimeRange.PAST_ONE_WEEK],
    ["two weeks ago", 14 * DAY, TimeRange.PAST_ONE_MONTH],
    ["a year ago", 365 * DAY, TimeRange.PAST_ONE_MONTH],
  ])(
    "an exception last seen %s opens on %s",
    (_name: string, ageMs: number, expected: TimeRange) => {
      expect(
        getExceptionSpansDefaultTimeRange(new Date(NOW.getTime() - ageMs), NOW),
      ).toBe(expected);
    },
  );

  test("a missing, unreadable or future last-seen time opens on a day", () => {
    expect(getExceptionSpansDefaultTimeRange(undefined, NOW)).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(getExceptionSpansDefaultTimeRange("garbage", NOW)).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(
      getExceptionSpansDefaultTimeRange(new Date(NOW.getTime() + HOUR), NOW),
    ).toBe(TimeRange.PAST_ONE_DAY);
  });
});
