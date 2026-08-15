import {
  applyTimeCursorChange,
  createDefaultTimeCursorState,
  DEFAULT_TELEMETRY_TIME_CURSOR_RANGE,
  EXCEPTIONS_TIME_CURSOR_HINT,
  PROFILES_TIME_CURSOR_HINT,
  SharedTelemetryTimeCursorState,
  SharedTelemetryViewerWindows,
  shouldAdoptTimeRangeOverride,
  toProfilesCapturedWindow,
  toViewerWindows,
} from "../../FeatureSet/Dashboard/src/Utils/SharedTelemetryTimeCursor";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { describe, expect, test } from "@jest/globals";

/*
 * The entity telemetry hub's tabs share one time cursor: isolate a bad
 * five-minute window in Logs, click Traces, and Traces must open on that
 * window instead of resetting to the default hour. These tests pin down the
 * pure propagation rules — what each viewer receives, when a lifted change
 * is a no-op (the feedback-loop guard), and what an untouched cursor means
 * for tabs that are unbounded by default.
 */

const WINDOW_START: Date = new Date("2026-08-14T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-14T10:05:00.000Z");

function customWindow(start: Date, end: Date): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  };
}

describe("createDefaultTimeCursorState", () => {
  test("starts on the viewers' shared default window with no user selection", () => {
    const state: SharedTelemetryTimeCursorState =
      createDefaultTimeCursorState();

    expect(state.range.range).toBe(TimeRange.PAST_ONE_HOUR);
    expect(state.range.range).toBe(DEFAULT_TELEMETRY_TIME_CURSOR_RANGE);
    expect(state.hasUserSelection).toBe(false);
  });

  test("default cursor leaves the profiles tab unbounded (its historical default)", () => {
    expect(toProfilesCapturedWindow(createDefaultTimeCursorState())).toBeNull();
  });
});

describe("applyTimeCursorChange", () => {
  test("records the first selection even when it equals the default window", () => {
    const state: SharedTelemetryTimeCursorState =
      createDefaultTimeCursorState();
    const next: SharedTelemetryTimeCursorState = applyTimeCursorChange(state, {
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(next).not.toBe(state);
    expect(next.hasUserSelection).toBe(true);
    expect(next.range.range).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("adopts a lifted custom window by reference", () => {
    const lifted: RangeStartAndEndDateTime = customWindow(
      WINDOW_START,
      WINDOW_END,
    );
    const next: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      lifted,
    );

    expect(next.range).toBe(lifted);
    expect(next.hasUserSelection).toBe(true);
  });

  test("an echoed lift of the current window returns the SAME state object", () => {
    const selected: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      customWindow(WINDOW_START, WINDOW_END),
    );

    // Equal by value, different object identity — how a viewer re-lifts.
    const echo: RangeStartAndEndDateTime = customWindow(
      new Date(WINDOW_START.getTime()),
      new Date(WINDOW_END.getTime()),
    );

    expect(applyTimeCursorChange(selected, echo)).toBe(selected);
  });

  test("an echoed preset selection is also identity-stable", () => {
    const selected: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      { range: TimeRange.PAST_THIRTY_MINS },
    );

    expect(
      applyTimeCursorChange(selected, { range: TimeRange.PAST_THIRTY_MINS }),
    ).toBe(selected);
  });

  test("a genuinely different window advances the cursor", () => {
    const selected: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      customWindow(WINDOW_START, WINDOW_END),
    );
    const widened: RangeStartAndEndDateTime = customWindow(
      WINDOW_START,
      new Date("2026-08-14T11:00:00.000Z"),
    );
    const next: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      selected,
      widened,
    );

    expect(next).not.toBe(selected);
    expect(next.range).toBe(widened);
  });
});

describe("shouldAdoptTimeRangeOverride", () => {
  const current: RangeStartAndEndDateTime = {
    range: TimeRange.PAST_ONE_HOUR,
  };

  test("no override (uncontrolled viewer) never adopts", () => {
    expect(shouldAdoptTimeRangeOverride(undefined, current)).toBe(false);
    expect(shouldAdoptTimeRangeOverride(null, current)).toBe(false);
  });

  test("an override equal to the current window is a no-op (echo guard)", () => {
    expect(
      shouldAdoptTimeRangeOverride({ range: TimeRange.PAST_ONE_HOUR }, current),
    ).toBe(false);

    const window: RangeStartAndEndDateTime = customWindow(
      WINDOW_START,
      WINDOW_END,
    );
    const equalCopy: RangeStartAndEndDateTime = customWindow(
      new Date(WINDOW_START.getTime()),
      new Date(WINDOW_END.getTime()),
    );
    expect(shouldAdoptTimeRangeOverride(equalCopy, window)).toBe(false);
  });

  test("a different preset, custom bounds, or preset-vs-custom is adopted", () => {
    expect(
      shouldAdoptTimeRangeOverride({ range: TimeRange.PAST_ONE_DAY }, current),
    ).toBe(true);

    const window: RangeStartAndEndDateTime = customWindow(
      WINDOW_START,
      WINDOW_END,
    );
    const shifted: RangeStartAndEndDateTime = customWindow(
      WINDOW_START,
      new Date(WINDOW_END.getTime() + 1),
    );
    expect(shouldAdoptTimeRangeOverride(shifted, window)).toBe(true);
    expect(shouldAdoptTimeRangeOverride(window, current)).toBe(true);
  });

  test("zoom-lift round trip: the originator no-ops, siblings follow", () => {
    /*
     * Logs drag-zooms to a five-minute window and lifts it. The page adopts
     * it into the cursor, then re-renders every mounted viewer with the new
     * override.
     */
    const lifted: RangeStartAndEndDateTime = customWindow(
      WINDOW_START,
      WINDOW_END,
    );
    const pageState: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      lifted,
    );

    // The originator already sits on that window — the echo must not adopt.
    expect(shouldAdoptTimeRangeOverride(pageState.range, lifted)).toBe(false);

    // A sibling still on the default hour must follow.
    expect(
      shouldAdoptTimeRangeOverride(pageState.range, {
        range: TimeRange.PAST_ONE_HOUR,
      }),
    ).toBe(true);

    // And a second identical lift leaves the page state untouched (no loop).
    expect(applyTimeCursorChange(pageState, pageState.range)).toBe(pageState);
  });
});

describe("toProfilesCapturedWindow", () => {
  test("a custom selection resolves to exactly its bounds", () => {
    const state: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      customWindow(WINDOW_START, WINDOW_END),
    );
    const window: InBetween<Date> | null = toProfilesCapturedWindow(state);

    expect(window).not.toBeNull();
    expect(window!.startValue.getTime()).toBe(WINDOW_START.getTime());
    expect(window!.endValue.getTime()).toBe(WINDOW_END.getTime());
  });

  test("a preset selection resolves against now with the preset's span", () => {
    const before: number = Date.now();
    const state: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      { range: TimeRange.PAST_FIVE_MINS },
    );
    const window: InBetween<Date> | null = toProfilesCapturedWindow(state);
    const after: number = Date.now();

    expect(window).not.toBeNull();
    const spanMs: number =
      window!.endValue.getTime() - window!.startValue.getTime();
    // Five minutes, with slack for a DST-adjacent test run.
    expect(Math.abs(spanMs - 5 * 60 * 1000)).toBeLessThan(61 * 1000);
    expect(window!.endValue.getTime()).toBeGreaterThanOrEqual(before);
    expect(window!.endValue.getTime()).toBeLessThanOrEqual(after);
  });

  test("a malformed CUSTOM selection still yields an ordered window, never null", () => {
    // CUSTOM without bounds — e.g. state restored from a bad serialization.
    const state: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      { range: TimeRange.CUSTOM },
    );
    const window: InBetween<Date> | null = toProfilesCapturedWindow(state);

    expect(window).not.toBeNull();
    expect(window!.startValue.getTime()).toBeLessThanOrEqual(
      window!.endValue.getTime(),
    );
  });
});

describe("toViewerWindows", () => {
  test("maps one cursor to every viewer's prop shape", () => {
    const lifted: RangeStartAndEndDateTime = customWindow(
      WINDOW_START,
      WINDOW_END,
    );
    const state: SharedTelemetryTimeCursorState = applyTimeCursorChange(
      createDefaultTimeCursorState(),
      lifted,
    );
    const windows: SharedTelemetryViewerWindows = toViewerWindows(state);

    /*
     * The controlled override is the cursor range BY REFERENCE — identity
     * only moves when the value does, so viewer adopt effects keyed on it
     * cannot churn.
     */
    expect(windows.viewerTimeRange).toBe(state.range);
    expect(windows.profilesCapturedWindow).not.toBeNull();
    expect(windows.profilesCapturedWindow!.startValue.getTime()).toBe(
      WINDOW_START.getTime(),
    );
    expect(windows.profilesCapturedWindow!.endValue.getTime()).toBe(
      WINDOW_END.getTime(),
    );
  });

  test("untouched cursor: viewers get the shared default, profiles stay unbounded", () => {
    const state: SharedTelemetryTimeCursorState =
      createDefaultTimeCursorState();
    const windows: SharedTelemetryViewerWindows = toViewerWindows(state);

    expect(windows.viewerTimeRange.range).toBe(TimeRange.PAST_ONE_HOUR);
    expect(windows.profilesCapturedWindow).toBeNull();
  });
});

describe("uncontrolled-tab hints", () => {
  test("the exceptions and profiles hints are user-facing sentences", () => {
    for (const hint of [
      EXCEPTIONS_TIME_CURSOR_HINT,
      PROFILES_TIME_CURSOR_HINT,
    ]) {
      expect(hint.length).toBeGreaterThan(20);
      expect(hint.endsWith(".")).toBe(true);
    }
    expect(EXCEPTIONS_TIME_CURSOR_HINT).toContain("time range");
  });
});
