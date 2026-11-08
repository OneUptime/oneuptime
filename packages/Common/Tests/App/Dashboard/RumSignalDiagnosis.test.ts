import { describe, expect, test } from "@jest/globals";
import {
  RUM_SETUP_CHECK_RECENT_WINDOW_MS,
  RUM_SIGNAL_STAMP_TOLERANCE_MS,
  RUM_WEB_VITALS_LOOKBACK_DAYS,
  RumApplicationArrivalFacts,
  RumSignalDiagnosis,
  RumSignalDiagnosisInput,
  diagnoseRumSignal,
  getRangeShowingArrival,
  getWebVitalsCheckWindow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalDiagnosis";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * WHY A RUM APPLICATION'S EXCEPTIONS OR LOGS ARE EMPTY (issue #5770).
 *
 * One answer feeds the empty Exceptions and Logs charts on the Overview,
 * the empty Logs page and every row of the setup check on the
 * Documentation tab. These pin each answer to the facts that justify it -
 * and, as much, the answers it must never give: "not set up" for an app
 * that sent logs before its arrivals were kept, "receiving" for an app
 * whose last log came yesterday, a longer range that would show nothing.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-11-08T12:00:00.000Z");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };
const PAST_WEEK: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_WEEK };

function window(
  timeRange: RangeStartAndEndDateTime,
  lengthMs: number,
): { timeRange: RangeStartAndEndDateTime; start: Date; end: Date } {
  return { timeRange, start: ago(lengthMs), end: NOW };
}

// An app that reports: telemetry arrived a minute ago.
const ACTIVE_APP: RumApplicationArrivalFacts = {
  anythingArrived: true,
  lastHeardFromAt: ago(MINUTE),
  replayOnly: false,
};

// Nothing has ever arrived.
const SILENT_NEW_APP: RumApplicationArrivalFacts = {
  anythingArrived: false,
  lastHeardFromAt: null,
  replayOnly: false,
};

// Only Session Replay reports: the OpenTelemetry SDK is missing.
const REPLAY_ONLY_APP: RumApplicationArrivalFacts = {
  anythingArrived: true,
  lastHeardFromAt: ago(MINUTE),
  replayOnly: true,
};

// When this application's arrivals were first kept (the upgrade).
const TRACKED_SINCE: Date = ago(10 * DAY);

function diagnose(
  overrides: Partial<RumSignalDiagnosisInput>,
): RumSignalDiagnosis {
  return diagnoseRumSignal({
    inRange: { count: 0 },
    lastArrival: { at: null, failed: false },
    trackedSince: TRACKED_SINCE,
    app: ACTIVE_APP,
    range: window(PAST_HOUR, HOUR),
    now: NOW,
    ...overrides,
  });
}

describe("diagnoseRumSignal: the range on screen", () => {
  test("a count still loading is loading, whatever else is known", () => {
    expect(
      diagnose({
        inRange: { count: undefined },
        lastArrival: { at: ago(3 * HOUR), failed: false },
      }),
    ).toEqual({
      state: "loading",
      lastArrivalAt: null,
      since: null,
      widerRange: null,
    });
  });

  test("a count that failed is unknown, never 'not set up'", () => {
    expect(
      diagnose({ inRange: { count: null }, app: SILENT_NEW_APP }).state,
    ).toBe("unknown");
  });

  test("anything in the range is receiving: the chart draws it", () => {
    const at: Date = ago(5 * MINUTE);

    expect(
      diagnose({
        inRange: { count: 12 },
        lastArrival: { at, failed: false },
      }),
    ).toEqual({
      state: "receiving",
      lastArrivalAt: at,
      since: null,
      widerRange: null,
    });
  });

  test("receiving wins even while the newest arrival is still being read", () => {
    expect(
      diagnose({ inRange: { count: 1 }, lastArrival: null }),
    ).toMatchObject({ state: "receiving", lastArrivalAt: null });
  });

  test("an empty range waits for the newest arrival before it says why", () => {
    expect(diagnose({ lastArrival: null }).state).toBe("loading");
  });

  test("an empty range whose newest-arrival read failed is unknown", () => {
    expect(diagnose({ lastArrival: { at: null, failed: true } }).state).toBe(
      "unknown",
    );
  });
});

describe("diagnoseRumSignal: set up but quiet", () => {
  test("the last arrival is named and a longer range that shows it is offered", () => {
    const at: Date = ago(3 * HOUR);

    expect(diagnose({ lastArrival: { at, failed: false } })).toEqual({
      state: "quiet",
      lastArrivalAt: at,
      since: null,
      widerRange: { range: TimeRange.PAST_ONE_WEEK },
    });
  });

  test("an arrival inside the range offers no longer range: it would show the same nothing", () => {
    const at: Date = ago(20 * MINUTE);

    expect(diagnose({ lastArrival: { at, failed: false } })).toMatchObject({
      state: "quiet",
      lastArrivalAt: at,
      widerRange: null,
    });
  });

  test("an arrival older than the app keeps telemetry offers no range", () => {
    expect(
      diagnose({
        lastArrival: { at: ago(20 * DAY), failed: false },
        retentionInDays: 15,
      }),
    ).toMatchObject({ state: "quiet", widerRange: null });
  });

  test("a quiet signal is quiet even when the app is otherwise silent", () => {
    expect(
      diagnose({
        lastArrival: { at: ago(30 * DAY), failed: false },
        app: { ...ACTIVE_APP, lastHeardFromAt: ago(30 * DAY) },
      }),
    ).toMatchObject({ state: "quiet", lastArrivalAt: ago(30 * DAY) });
  });
});

describe("diagnoseRumSignal: never arrived", () => {
  test("an app that reports other things: not set up, since its arrivals are kept", () => {
    expect(diagnose({})).toEqual({
      state: "not-set-up",
      cause: "signal",
      lastArrivalAt: null,
      since: TRACKED_SINCE,
      widerRange: null,
    });
  });

  test("a record that covers all time (exceptions) says not set up with no date", () => {
    expect(diagnose({ trackedSince: null })).toMatchObject({
      state: "not-set-up",
      cause: "signal",
      since: null,
    });
  });

  test("only Session Replay reports: the SDK, not the signal, is missing", () => {
    expect(diagnose({ app: REPLAY_ONLY_APP })).toMatchObject({
      state: "not-set-up",
      cause: "sdk",
      since: null,
    });
  });

  test("nothing at all has ever arrived: not arriving, not 'not set up'", () => {
    expect(diagnose({ app: SILENT_NEW_APP })).toEqual({
      state: "not-arriving",
      lastArrivalAt: null,
      since: null,
      widerRange: null,
    });
  });

  test("metrics of other names arrive (Web Vitals): the names, not the pipeline", () => {
    expect(diagnose({ otherNamesArrive: true })).toMatchObject({
      state: "not-set-up",
      cause: "names",
    });
  });

  test("an app silent since before its arrivals were kept is quiet since then, never 'not set up'", () => {
    const lastHeardFromAt: Date = ago(40 * DAY);

    expect(diagnose({ app: { ...ACTIVE_APP, lastHeardFromAt } })).toEqual({
      state: "quiet",
      lastArrivalAt: null,
      since: lastHeardFromAt,
      widerRange: null,
    });
  });

  test("an app heard from just before its arrivals were kept is not silent: the stamps lag by a fence window", () => {
    expect(
      diagnose({
        app: {
          ...ACTIVE_APP,
          lastHeardFromAt: new Date(
            TRACKED_SINCE.getTime() - RUM_SIGNAL_STAMP_TOLERANCE_MS + MINUTE,
          ),
        },
      }),
    ).toMatchObject({ state: "not-set-up", cause: "signal" });

    expect(
      diagnose({
        app: {
          ...ACTIVE_APP,
          lastHeardFromAt: new Date(
            TRACKED_SINCE.getTime() - RUM_SIGNAL_STAMP_TOLERANCE_MS - MINUTE,
          ),
        },
      }),
    ).toMatchObject({ state: "quiet", lastArrivalAt: null });
  });

  test("an all-time record ignores silence: no exception ever is not set up", () => {
    expect(
      diagnose({
        trackedSince: null,
        app: { ...ACTIVE_APP, lastHeardFromAt: ago(300 * DAY) },
      }),
    ).toMatchObject({ state: "not-set-up", cause: "signal", since: null });
  });

  test("the replay-only cause comes before silence", () => {
    expect(
      diagnose({
        app: { ...REPLAY_ONLY_APP, lastHeardFromAt: ago(300 * DAY) },
      }),
    ).toMatchObject({ state: "not-set-up", cause: "sdk" });
  });

  test("an unreadable tracked-since date is no date", () => {
    expect(diagnose({ trackedSince: new Date("not a date") })).toMatchObject({
      state: "not-set-up",
      since: null,
    });
  });
});

describe("diagnoseRumSignal: the setup check, which has no range", () => {
  function check(
    overrides: Partial<RumSignalDiagnosisInput>,
  ): RumSignalDiagnosis {
    return diagnoseRumSignal({
      lastArrival: { at: null, failed: false },
      trackedSince: TRACKED_SINCE,
      app: ACTIVE_APP,
      now: NOW,
      ...overrides,
    });
  }

  test("an arrival in the past 24 hours is arriving, with when it came", () => {
    const at: Date = ago(2 * HOUR);

    expect(check({ lastArrival: { at, failed: false } })).toEqual({
      state: "receiving",
      lastArrivalAt: at,
      since: null,
      widerRange: null,
    });
  });

  test("24 hours exactly is still arriving: exceptions come only when something breaks", () => {
    expect(
      check({
        lastArrival: {
          at: ago(RUM_SETUP_CHECK_RECENT_WINDOW_MS),
          failed: false,
        },
      }).state,
    ).toBe("receiving");
    expect(RUM_SETUP_CHECK_RECENT_WINDOW_MS).toBe(DAY);
  });

  test("an older arrival is quiet, with its date and no range to offer", () => {
    const at: Date = ago(2 * DAY);

    expect(check({ lastArrival: { at, failed: false } })).toEqual({
      state: "quiet",
      lastArrivalAt: at,
      since: null,
      widerRange: null,
    });
  });

  test("a read still out is loading; a failed one is unknown", () => {
    expect(check({ lastArrival: null }).state).toBe("loading");
    expect(check({ lastArrival: { at: null, failed: true } }).state).toBe(
      "unknown",
    );
  });

  test("never arrived reads the same as on a chart", () => {
    expect(check({})).toMatchObject({
      state: "not-set-up",
      cause: "signal",
      since: TRACKED_SINCE,
    });
    expect(check({ app: SILENT_NEW_APP }).state).toBe("not-arriving");
    expect(check({ app: REPLAY_ONLY_APP })).toMatchObject({ cause: "sdk" });
  });
});

describe("getRangeShowingArrival", () => {
  function rangeFor(
    ageMs: number,
    range: { timeRange: RangeStartAndEndDateTime; start: Date; end: Date },
    retentionInDays?: number | null,
  ): RangeStartAndEndDateTime | null {
    return getRangeShowingArrival({
      at: ago(ageMs),
      range,
      retentionInDays,
      now: NOW,
    });
  }

  test.each([
    ["3 hours", 3 * HOUR, TimeRange.PAST_ONE_WEEK],
    ["6 days", 6 * DAY, TimeRange.PAST_ONE_WEEK],
    ["10 days", 10 * DAY, TimeRange.PAST_ONE_MONTH],
    ["45 days", 45 * DAY, TimeRange.PAST_THREE_MONTHS],
  ])(
    "an arrival %s old, seen from the past hour, is shown by %s",
    (_label: string, ageMs: number, expected: TimeRange) => {
      expect(rangeFor(ageMs, window(PAST_HOUR, HOUR))).toEqual({
        range: expected,
      });
    },
  );

  test("older than every named range: none", () => {
    expect(rangeFor(120 * DAY, window(PAST_HOUR, HOUR))).toBeNull();
  });

  test("only ranges longer than the one on screen are offered", () => {
    expect(rangeFor(10 * DAY, window(PAST_WEEK, 7 * DAY))).toEqual({
      range: TimeRange.PAST_ONE_MONTH,
    });
  });

  test("inside the range on screen: none", () => {
    expect(rangeFor(3 * DAY, window(PAST_WEEK, 7 * DAY))).toBeNull();
  });

  test("a zoomed custom range shorter than a week offers the past week", () => {
    const custom: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(ago(2 * HOUR), ago(HOUR)),
    };

    expect(
      getRangeShowingArrival({
        at: ago(5 * HOUR),
        range: { timeRange: custom, start: ago(2 * HOUR), end: ago(HOUR) },
        now: NOW,
      }),
    ).toEqual({ range: TimeRange.PAST_ONE_WEEK });
  });

  test("retention: a range is offered only while what it would show is kept", () => {
    expect(rangeFor(10 * DAY, window(PAST_HOUR, HOUR), 7)).toBeNull();
    expect(rangeFor(10 * DAY, window(PAST_HOUR, HOUR), 15)).toEqual({
      range: TimeRange.PAST_ONE_MONTH,
    });
    // No retention of its own: the named ranges alone decide.
    expect(rangeFor(10 * DAY, window(PAST_HOUR, HOUR), null)).toEqual({
      range: TimeRange.PAST_ONE_MONTH,
    });
  });

  test("an unreadable date offers nothing", () => {
    expect(
      getRangeShowingArrival({
        at: new Date("not a date"),
        range: window(PAST_HOUR, HOUR),
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("getWebVitalsCheckWindow", () => {
  const LOOKBACK_START: Date = ago(RUM_WEB_VITALS_LOOKBACK_DAYS * DAY);

  test("the Web Vitals read looks back 30 days", () => {
    expect(RUM_WEB_VITALS_LOOKBACK_DAYS).toBe(30);
  });

  test("metrics in those 30 days: other names arrive", () => {
    expect(
      getWebVitalsCheckWindow({
        metricsLastReceivedAt: ago(3 * DAY),
        trackedSince: TRACKED_SINCE,
        now: NOW,
      }),
    ).toEqual({ otherNamesArrive: true, since: LOOKBACK_START });
  });

  test("metrics only before those 30 days: nothing arrives under any name now", () => {
    expect(
      getWebVitalsCheckWindow({
        metricsLastReceivedAt: ago(40 * DAY),
        trackedSince: ago(90 * DAY),
        now: NOW,
      }),
    ).toEqual({ otherNamesArrive: false, since: LOOKBACK_START });
  });

  test("no metric at all since arrivals were kept vouches back to that date when it is earlier", () => {
    expect(
      getWebVitalsCheckWindow({
        metricsLastReceivedAt: null,
        trackedSince: ago(60 * DAY),
        now: NOW,
      }),
    ).toEqual({ otherNamesArrive: false, since: ago(60 * DAY) });
  });

  test("a recent tracked-since date never narrows the 30 days the read covers", () => {
    expect(
      getWebVitalsCheckWindow({
        metricsLastReceivedAt: null,
        trackedSince: ago(2 * DAY),
        now: NOW,
      }),
    ).toEqual({ otherNamesArrive: false, since: LOOKBACK_START });
    expect(
      getWebVitalsCheckWindow({
        metricsLastReceivedAt: null,
        trackedSince: null,
        now: NOW,
      }).since,
    ).toEqual(LOOKBACK_START);
  });
});
