import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  RenderHookResult,
  act,
  cleanup,
  fireEvent,
  renderHook,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import useChartRangeSelection, {
  CHART_PRESS_STILLNESS_PX,
  ChartRangeSelection,
  ChartRangeSelectionRootProps,
  RANGE_SELECTION_THROTTLED_EVENTS,
  RangeSelectionChartState,
  UseChartRangeSelectionOptions,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/UseChartRangeSelection";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";

/*
 * Issue #4116: right after a drag zooms a page, the page refetches, and the
 * reader double-clicks to undo the zoom at exactly that moment. When the new
 * rows landed during the double-click's second press, recharts re-keyed the
 * node under the press, and Chrome sent that press no click and no dblclick:
 * the chart stayed zoomed, and the press's release - read against the new
 * rows - could even zoom it further, to a window made of old and new
 * buckets.
 *
 * useChartRangeSelection (the line, area and bar charts) now takes the
 * chart's onTimeRangeReset and no longer depends on the dblclick arriving.
 * The second press of a double-click (MouseEvent.detail 2, the browser's own
 * click count) IS the reset: it starts no selection and paints nothing, and
 * its release arms the reset for the next task. The browser's dblclick, when
 * it does arrive, comes before that task, resets, and stands the fallback
 * down - so a double-click resets exactly once either way.
 *
 * These drive the hook's chart-level handlers the way recharts 3 calls them,
 * handler(state, event), with rows shaped like the real charts' (the x-axis
 * label under the index key, the bucket start as epoch ms), and pin:
 *
 *   - what chartEventProps hands the chart root with and without a select
 *     handler and a reset - including a chart that only resets (a vertical
 *     bar chart), which still has to see presses and releases;
 *   - that the reset press never selects, paints or renders, wherever the
 *     pointer goes before its release - on the chart or off it - and leaves
 *     nothing armed for a release it did not begin;
 *   - that a double-click resets exactly once whether or not its dblclick
 *     arrives, with the reset the chart handed in last;
 *   - that everything that is not a main-button second press - a drag, a
 *     click, a right-click, a triple-click's third press - behaves as it
 *     did before, but for one rule: a drag needs the POINTER to move, by
 *     more than CHART_PRESS_STILLNESS_PX. A press whose row changes under a
 *     still pointer - new rows landing mid-press, a hand's drift across a
 *     row's edge - is a plain click, not a two-bucket zoom. A caller that
 *     hands no mouse events still drags by the change of row alone;
 *   - that a release only the page hears is read from the native event the
 *     page-wide listener hands on: a press let go where it went down selects
 *     nothing, a drag let go far off still selects, and the count tells a
 *     later click's release (1), which ends a reset press whose own release
 *     was lost without resetting, from the reset press's own (2).
 */

type Rows = Array<Record<string, unknown>>;
type SelectHandler = (startTime: Date, endTime: Date) => void;
type ResetHandler = () => void;
type Band = [string | null, string | null];

const MINUTE_MS: number = 60 * 1000;
const HALF_MINUTE_MS: number = 30 * 1000;
const FIRST_BUCKET_MS: number = Date.parse("2026-09-28T10:00:00.000Z");

const NO_BAND: Band = [null, null];

function buildRows(
  firstBucketMs: number,
  bucketMs: number,
  count: number,
): Rows {
  return Array.from(
    { length: count },
    (_: unknown, rowIndex: number): Record<string, unknown> => {
      const bucketStartMs: number = firstBucketMs + rowIndex * bucketMs;
      return {
        [CHART_DATA_POINT_X_AXIS_KEY]: new Date(bucketStartMs)
          .toISOString()
          .slice(11, 19),
        [CHART_DATA_POINT_DATE_KEY]: bucketStartMs,
        Requests: 100 + rowIndex,
      };
    },
  );
}

// The rows on screen: ten one-minute buckets from 10:00.
const ROWS: Rows = buildRows(FIRST_BUCKET_MS, MINUTE_MS, 10);

/*
 * What the refetch after a zoom brings in: the same ten minutes in twice as
 * many buckets. A pointer that has not moved from 10:04 - the fifth old
 * bucket - is over the ninth new one.
 */
const REFETCHED_ROWS: Rows = buildRows(FIRST_BUCKET_MS, HALF_MINUTE_MS, 20);

// Where recharts has no bucket under the pointer: an axis, a margin.
const OFF_THE_ROWS: RangeSelectionChartState = {
  activeTooltipIndex: null,
  activeLabel: undefined,
};

// What recharts reports with the pointer over a row.
function at(rowIndex: number, rows: Rows = ROWS): RangeSelectionChartState {
  const label: unknown = rows[rowIndex]?.[CHART_DATA_POINT_X_AXIS_KEY];
  return {
    // recharts 3 reports the tooltip index as a string.
    activeTooltipIndex: String(rowIndex),
    activeLabel: typeof label === "string" ? label : undefined,
  };
}

interface ChartSetup {
  onTimeRangeSelect?: SelectHandler | undefined;
  onTimeRangeReset?: ResetHandler | undefined;
  enabled?: boolean | undefined;
  data?: Rows | undefined;
}

interface ChartHarness {
  result: { current: ChartRangeSelection };
  rerender: (setup: ChartSetup) => void;
  unmount: () => void;
  // How many times the chart has rendered so far.
  renders: () => number;
}

function hookOptions(setup: ChartSetup): UseChartRangeSelectionOptions {
  return {
    data: setup.data ?? ROWS,
    index: CHART_DATA_POINT_X_AXIS_KEY,
    onTimeRangeSelect: setup.onTimeRangeSelect,
    enabled: setup.enabled,
    onTimeRangeReset: setup.onTimeRangeReset,
  };
}

function renderChart(setup: ChartSetup): ChartHarness {
  let renderCount: number = 0;
  const hook: RenderHookResult<
    ChartRangeSelection,
    UseChartRangeSelectionOptions
  > = renderHook(
    (options: UseChartRangeSelectionOptions): ChartRangeSelection => {
      renderCount += 1;
      return useChartRangeSelection(options);
    },
    { initialProps: hookOptions(setup) },
  );

  return {
    result: hook.result,
    rerender: (next: ChartSetup): void => {
      hook.rerender(hookOptions(next));
    },
    unmount: hook.unmount,
    renders: (): number => {
      return renderCount;
    },
  };
}

interface ClickInit {
  // The browser's click count: 2 on a double-click's second press and release.
  detail?: number;
  // The button pressed or let go: 0 main, 1 middle, 2 secondary.
  button?: number;
  // Where the pointer is, if not where clientXOf puts the row reported.
  clientX?: number;
}

// MouseEvent.buttons while each button is held.
const HELD_BUTTONS: Record<number, number> = { 0: 1, 1: 4, 2: 2 };

// How far apart the rows sit on screen, as a drawn chart would place them.
const ROW_WIDTH_PX: number = 20;

// Where the pointer is when recharts reports this row under it.
function clientXOf(state: RangeSelectionChartState): number {
  const index: number = Number(state.activeTooltipIndex);
  return Number.isFinite(index) ? index * ROW_WIDTH_PX : 0;
}

// The part of the React event recharts hands the handlers that they read.
function mouseEvent(
  detail: number,
  button: number,
  buttons: number,
  clientX: number,
): React.MouseEvent<SVGGraphicsElement> {
  return {
    detail: detail,
    button: button,
    buttons: buttons,
    clientX: clientX,
  } as unknown as React.MouseEvent<SVGGraphicsElement>;
}

function press(
  chart: ChartHarness,
  state: RangeSelectionChartState,
  init: ClickInit = {},
): void {
  const onMouseDown: ChartRangeSelectionRootProps["onMouseDown"] =
    chart.result.current.chartEventProps.onMouseDown;
  if (!onMouseDown) {
    throw new Error("The chart root was handed no onMouseDown: no press.");
  }
  const button: number = init.button ?? 0;
  act(() => {
    onMouseDown(
      state,
      mouseEvent(
        init.detail ?? 1,
        button,
        HELD_BUTTONS[button] ?? 1,
        init.clientX ?? clientXOf(state),
      ),
    );
  });
}

function move(
  chart: ChartHarness,
  state: RangeSelectionChartState,
  buttons: number = 1,
  clientX: number = clientXOf(state),
): void {
  const onMouseMove: ChartRangeSelectionRootProps["onMouseMove"] =
    chart.result.current.chartEventProps.onMouseMove;
  if (!onMouseMove) {
    throw new Error("The chart root was handed no onMouseMove: no drag.");
  }
  act(() => {
    onMouseMove(state, mouseEvent(0, 0, buttons, clientX));
  });
}

function release(
  chart: ChartHarness,
  state: RangeSelectionChartState,
  init: ClickInit = {},
): void {
  const onMouseUp: ChartRangeSelectionRootProps["onMouseUp"] =
    chart.result.current.chartEventProps.onMouseUp;
  if (!onMouseUp) {
    throw new Error("The chart root was handed no onMouseUp: no release.");
  }
  act(() => {
    onMouseUp(
      state,
      mouseEvent(
        init.detail ?? 1,
        init.button ?? 0,
        0,
        init.clientX ?? clientXOf(state),
      ),
    );
  });
}

// The browser's dblclick, when it reaches the chart root.
function doubleClick(chart: ChartHarness): void {
  const onDoubleClick: ChartRangeSelectionRootProps["onDoubleClick"] =
    chart.result.current.chartEventProps.onDoubleClick;
  if (!onDoubleClick) {
    throw new Error("The chart root was handed no onDoubleClick.");
  }
  act(() => {
    onDoubleClick();
  });
}

// A whole click: press and release on one row, with the browser's count.
function click(
  chart: ChartHarness,
  state: RangeSelectionChartState,
  detail: number,
): void {
  press(chart, state, { detail: detail });
  release(chart, state, { detail: detail });
}

/*
 * The handlers as a caller that hands them recharts' state alone - no
 * mouse event - calls them: the shape they had before they read the event.
 */
function pressWithoutEvent(
  chart: ChartHarness,
  state: RangeSelectionChartState,
): void {
  const onMouseDown: ChartRangeSelectionRootProps["onMouseDown"] =
    chart.result.current.chartEventProps.onMouseDown;
  if (!onMouseDown) {
    throw new Error("The chart root was handed no onMouseDown: no press.");
  }
  act(() => {
    onMouseDown(state);
  });
}

function moveWithoutEvent(
  chart: ChartHarness,
  state: RangeSelectionChartState,
): void {
  const onMouseMove:
    | ((chartState: RangeSelectionChartState) => void)
    | undefined = chart.result.current.chartEventProps.onMouseMove as
    | ((chartState: RangeSelectionChartState) => void)
    | undefined;
  if (!onMouseMove) {
    throw new Error("The chart root was handed no onMouseMove: no drag.");
  }
  act(() => {
    onMouseMove(state);
  });
}

function releaseWithoutEvent(
  chart: ChartHarness,
  state: RangeSelectionChartState,
): void {
  const onMouseUp: ChartRangeSelectionRootProps["onMouseUp"] =
    chart.result.current.chartEventProps.onMouseUp;
  if (!onMouseUp) {
    throw new Error("The chart root was handed no onMouseUp: no release.");
  }
  act(() => {
    onMouseUp(state);
  });
}

/*
 * What Chrome runs between a release and its click: the microtasks, where
 * React commits. The dblclick comes after them, the next task after that.
 */
async function flushMicrotasks(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

// The next task: what a setTimeout(0) armed during a release waits for.
function nextTask(): void {
  act(() => {
    jest.advanceTimersByTime(0);
  });
}

function allTimers(): void {
  act(() => {
    jest.runAllTimers();
  });
}

function band(chart: ChartHarness): Band {
  return [
    chart.result.current.selectionStartLabel,
    chart.result.current.selectionEndLabel,
  ];
}

function selections(select: MockFunction): Array<[string, string]> {
  return select.mock.calls.map((call: Array<unknown>): [string, string] => {
    return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
  });
}

function keysOf(props: ChartRangeSelectionRootProps): Array<string> {
  return Object.keys(props).sort();
}

// The page-wide mouseup listeners a press adds to hear a release off the chart.
interface PageListenerSpies {
  add: jest.SpiedFunction<typeof window.addEventListener>;
  remove: jest.SpiedFunction<typeof window.removeEventListener>;
}

function spyOnPageListeners(): PageListenerSpies {
  return {
    add: jest.spyOn(window, "addEventListener"),
    remove: jest.spyOn(window, "removeEventListener"),
  };
}

function mouseUpListeners(calls: Array<Array<unknown>>): Array<unknown> {
  return calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === "mouseup";
    })
    .map((call: Array<unknown>): unknown => {
      return call[1];
    });
}

function expectNoMouseUpListenerLeft(spies: PageListenerSpies): void {
  const removed: Array<unknown> = mouseUpListeners(spies.remove.mock.calls);
  for (const added of mouseUpListeners(spies.add.mock.calls)) {
    expect(removed).toContain(added);
  }
}

// The page-wide mouseup listener added last: the press in progress's own.
function lastMouseUpListener(
  spies: PageListenerSpies,
): (event: MouseEvent) => void {
  const listeners: Array<unknown> = mouseUpListeners(spies.add.mock.calls);
  const listener: unknown = listeners[listeners.length - 1];
  if (typeof listener !== "function") {
    throw new Error("No press added a page-wide mouseup listener.");
  }
  return listener as (event: MouseEvent) => void;
}

interface ResetOnlyCase {
  name: string;
  setup: (select: MockFunction, reset: MockFunction) => ChartSetup;
}

/*
 * The two ways a chart ends up offering a double-click but no drag: no
 * select handler at all, or one it cannot use (a vertical bar chart, whose
 * time runs down the y-axis).
 */
const RESET_ONLY_CASES: Array<ResetOnlyCase> = [
  {
    name: "no select handler",
    setup: (_select: MockFunction, reset: MockFunction): ChartSetup => {
      return { onTimeRangeReset: reset };
    },
  },
  {
    name: "selection turned off, as on a vertical bar chart",
    setup: (select: MockFunction, reset: MockFunction): ChartSetup => {
      return {
        onTimeRangeSelect: select,
        enabled: false,
        onTimeRangeReset: reset,
      };
    },
  },
];

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("what the chart root is handed", () => {
  test("a chart that drags and resets takes presses, moves, releases and the dblclick, with the crosshair and unthrottled moves", () => {
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: getJestMockFunction(),
      onTimeRangeReset: getJestMockFunction(),
    });
    const props: ChartRangeSelectionRootProps =
      chart.result.current.chartEventProps;

    expect(keysOf(props)).toEqual([
      "onDoubleClick",
      "onMouseDown",
      "onMouseMove",
      "onMouseUp",
      "style",
      "throttledEvents",
    ]);
    expect(typeof props.onMouseDown).toBe("function");
    expect(typeof props.onMouseMove).toBe("function");
    expect(typeof props.onMouseUp).toBe("function");
    expect(typeof props.onDoubleClick).toBe("function");
    expect(props.style).toEqual({ cursor: "crosshair" });
    expect(props.throttledEvents).toEqual(RANGE_SELECTION_THROTTLED_EVENTS);
    expect(props.throttledEvents).not.toContain("mousemove");
    expect(chart.result.current.canSelect).toBe(true);
  });

  test("a chart that drags with no zoom to undo gets no dblclick handler", () => {
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: getJestMockFunction(),
    });

    expect(keysOf(chart.result.current.chartEventProps)).toEqual([
      "onMouseDown",
      "onMouseMove",
      "onMouseUp",
      "style",
      "throttledEvents",
    ]);
    expect(chart.result.current.canSelect).toBe(true);
  });

  for (const resetOnly of RESET_ONLY_CASES) {
    test(`a chart that only resets (${resetOnly.name}) takes presses, releases and the dblclick - no moves, no crosshair, recharts' own throttling`, () => {
      const chart: ChartHarness = renderChart(
        resetOnly.setup(getJestMockFunction(), getJestMockFunction()),
      );
      const props: ChartRangeSelectionRootProps =
        chart.result.current.chartEventProps;

      expect(keysOf(props)).toEqual([
        "onDoubleClick",
        "onMouseDown",
        "onMouseUp",
      ]);
      expect(typeof props.onMouseDown).toBe("function");
      expect(typeof props.onMouseUp).toBe("function");
      expect(typeof props.onDoubleClick).toBe("function");
      expect(chart.result.current.canSelect).toBe(false);
    });
  }

  test("a chart that neither drags nor resets is handed nothing", () => {
    const plain: ChartHarness = renderChart({});
    const verticalBars: ChartHarness = renderChart({
      onTimeRangeSelect: getJestMockFunction(),
      enabled: false,
    });

    expect(keysOf(plain.result.current.chartEventProps)).toEqual([]);
    expect(keysOf(verticalBars.result.current.chartEventProps)).toEqual([]);
    expect(plain.result.current.canSelect).toBe(false);
    expect(verticalBars.result.current.canSelect).toBe(false);
  });
});

describe("the second press of a double-click is the reset", () => {
  test("dragged across the rows, it selects nothing and paints no band", () => {
    const select: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: getJestMockFunction(),
    });

    press(chart, at(2), { detail: 2 });
    for (const rowIndex of [3, 4, 5, 6]) {
      move(chart, at(rowIndex));
      expect(band(chart)).toEqual(NO_BAND);
    }
    release(chart, at(6), { detail: 2 });
    allTimers();

    expect(select).not.toHaveBeenCalled();
    expect(band(chart)).toEqual(NO_BAND);
  });

  test("its release resets once, on the next task - not during the release", async () => {
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: getJestMockFunction(),
      onTimeRangeReset: reset,
    });

    press(chart, at(2), { detail: 2 });
    move(chart, at(4));
    release(chart, at(4), { detail: 2 });
    expect(reset).not.toHaveBeenCalled();

    // The dblclick has its chance first: it comes before the next task.
    await flushMicrotasks();
    expect(reset).not.toHaveBeenCalled();

    nextTask();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith();

    allTimers();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  test("it renders nothing, wherever the pointer goes, so the node it landed on stays for its click and dblclick", () => {
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: getJestMockFunction(),
      onTimeRangeReset: getJestMockFunction(),
    });
    const rendersBefore: number = chart.renders();

    press(chart, at(3), { detail: 2 });
    move(chart, at(4));
    move(chart, at(7));
    release(chart, at(7), { detail: 2 });

    expect(chart.renders()).toBe(rendersBefore);
  });

  test("whatever it listens for on the page, it stops listening once released", () => {
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: getJestMockFunction(),
      onTimeRangeReset: getJestMockFunction(),
    });
    const pageListeners: PageListenerSpies = spyOnPageListeners();

    press(chart, at(3), { detail: 2 });
    move(chart, at(6));
    release(chart, at(6), { detail: 2 });

    expectNoMouseUpListenerLeft(pageListeners);
  });

  /*
   * The hook's own design: the reset press ends on its release wherever
   * that is, heard by the window as a drag's is. (The browser would send
   * the chart no dblclick there; the reset does not wait for one.)
   */
  test("let go off the chart, it still resets, once: only the window hears that release", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, at(4), 1);
    press(chart, at(4), { detail: 2 });
    move(chart, at(9));
    fireEvent.mouseUp(window);
    expect(reset).not.toHaveBeenCalled();

    nextTask();
    expect(reset).toHaveBeenCalledTimes(1);
    allTimers();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(band(chart)).toEqual(NO_BAND);
  });

  /*
   * While the reset press listened for no release off the chart, one let go
   * there stayed "the reset press", and the next mouseup the chart heard -
   * from a press that began anywhere else on the page - reset the zoom.
   */
  test("let go off the chart, it leaves nothing armed for a later release over the chart that it did not begin", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, at(4), 1);
    press(chart, at(4), { detail: 2 });
    fireEvent.mouseUp(window);
    allTimers();
    const resetsSoFar: number = reset.mock.calls.length;

    /*
     * Later, a press somewhere else on the page - a text selection in the
     * table under the chart, say - is let go over the chart. No press on
     * the chart began it, so it ends no double-click.
     */
    release(chart, at(6), { detail: 1 });
    allTimers();

    expect(reset).toHaveBeenCalledTimes(resetsSoFar);
    expect(select).not.toHaveBeenCalled();
  });

  test("a chart unmounted during it stops listening, and resets nothing when the button comes up", () => {
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: getJestMockFunction(),
      onTimeRangeReset: reset,
    });
    const pageListeners: PageListenerSpies = spyOnPageListeners();

    click(chart, at(4), 1);
    press(chart, at(4), { detail: 2 });
    chart.unmount();
    expectNoMouseUpListenerLeft(pageListeners);

    fireEvent.mouseUp(window);
    allTimers();
    expect(reset).not.toHaveBeenCalled();
  });

  test("a whole double-click whose dblclick never arrives resets once, and selects nothing", async () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, at(4), 1);
    click(chart, at(4), 2);
    await flushMicrotasks();
    // No click and no dblclick: the node under the press was re-keyed.
    nextTask();

    expect(reset).toHaveBeenCalledTimes(1);
    allTimers();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  test("a whole double-click whose dblclick arrives resets exactly once, from the dblclick", async () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, at(4), 1);
    click(chart, at(4), 2);
    // Chrome's order: mouseup, microtasks, click, dblclick, then the next task.
    await flushMicrotasks();
    expect(reset).not.toHaveBeenCalled();
    doubleClick(chart);
    expect(reset).toHaveBeenCalledTimes(1);

    // The fallback the release armed has stood down.
    allTimers();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  test("a dblclick on its own resets at once, and only once", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    doubleClick(chart);
    expect(reset).toHaveBeenCalledTimes(1);

    allTimers();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  test("new rows landing during the second press make no window of old and new buckets, and the double-click still resets once", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, at(4), 1);
    press(chart, at(4), { detail: 2 });
    // The refetch lands under the press and the chart redraws its rows.
    chart.rerender({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
      data: REFETCHED_ROWS,
    });
    /*
     * The pointer has not moved, but recharts now reports a bucket of the
     * new rows - and Chrome sends this press no click and no dblclick.
     */
    release(chart, at(8, REFETCHED_ROWS), { detail: 2 });

    expect(select).not.toHaveBeenCalled();
    expect(band(chart)).toEqual(NO_BAND);

    nextTask();
    expect(reset).toHaveBeenCalledTimes(1);
    allTimers();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  test("a double-click off the rows - on an axis or a margin - resets too", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, OFF_THE_ROWS, 1);
    click(chart, OFF_THE_ROWS, 2);
    nextTask();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  test("it drops a drag whose release was lost, band and page-wide listener included", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    press(chart, at(1));
    move(chart, at(4));
    expect(band(chart)).toEqual(["10:01:00", "10:04:00"]);

    /*
     * That drag's release never reached the page, and this press is the
     * second of a double-click.
     */
    press(chart, at(4), { detail: 2 });
    expect(band(chart)).toEqual(NO_BAND);
    release(chart, at(4), { detail: 2 });
    // The same release reaching the window: no drag is listening any more.
    fireEvent.mouseUp(window);
    nextTask();

    expect(select).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  test("it does not suppress the click that follows it, even after crossing rows", () => {
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: getJestMockFunction(),
      onTimeRangeReset: getJestMockFunction(),
    });

    press(chart, at(2), { detail: 2 });
    move(chart, at(3));
    move(chart, at(6));
    release(chart, at(6), { detail: 2 });
    expect(chart.result.current.isClickSuppressed()).toBe(false);

    nextTask();
    expect(chart.result.current.isClickSuppressed()).toBe(false);
  });
});

describe("presses that are not the reset", () => {
  interface DragTrace {
    bands: Array<Band>;
    selected: Array<[string, string]>;
    suppressedAfterRelease: boolean;
    suppressedAfterNextTask: boolean;
    renders: number;
  }

  function plainDrag(chart: ChartHarness, select: MockFunction): DragTrace {
    const rendersBefore: number = chart.renders();
    const bands: Array<Band> = [];
    press(chart, at(2));
    bands.push(band(chart));
    move(chart, at(3));
    bands.push(band(chart));
    move(chart, at(5));
    bands.push(band(chart));
    release(chart, at(5));
    bands.push(band(chart));
    const suppressedAfterRelease: boolean =
      chart.result.current.isClickSuppressed();
    nextTask();

    return {
      bands: bands,
      selected: selections(select),
      suppressedAfterRelease: suppressedAfterRelease,
      suppressedAfterNextTask: chart.result.current.isClickSuppressed(),
      renders: chart.renders() - rendersBefore,
    };
  }

  test("a plain drag selects exactly as it does on a chart with no reset", () => {
    const selectWithoutReset: MockFunction = getJestMockFunction();
    const selectWithReset: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();

    const withoutReset: DragTrace = plainDrag(
      renderChart({ onTimeRangeSelect: selectWithoutReset }),
      selectWithoutReset,
    );
    const withReset: DragTrace = plainDrag(
      renderChart({
        onTimeRangeSelect: selectWithReset,
        onTimeRangeReset: reset,
      }),
      selectWithReset,
    );

    expect(withReset).toEqual(withoutReset);
    expect(withReset.bands).toEqual([
      NO_BAND,
      ["10:02:00", "10:03:00"],
      ["10:02:00", "10:05:00"],
      NO_BAND,
    ]);
    // From the start of the first bucket to the END of the last.
    expect(withReset.selected).toEqual([
      ["2026-09-28T10:02:00.000Z", "2026-09-28T10:06:00.000Z"],
    ]);
    expect(withReset.suppressedAfterRelease).toBe(true);
    expect(withReset.suppressedAfterNextTask).toBe(false);

    allTimers();
    expect(reset).not.toHaveBeenCalled();
  });

  test("a plain click selects nothing and resets nothing", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, at(4), 1);
    expect(band(chart)).toEqual(NO_BAND);
    expect(chart.result.current.isClickSuppressed()).toBe(false);

    allTimers();
    expect(select).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  for (const otherButton of [
    { name: "right", button: 2 },
    { name: "middle", button: 1 },
  ]) {
    test(`a ${otherButton.name}-button second press is not the reset, and does not drag`, () => {
      const select: MockFunction = getJestMockFunction();
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartHarness = renderChart({
        onTimeRangeSelect: select,
        onTimeRangeReset: reset,
      });

      press(chart, at(4), { detail: 1, button: otherButton.button });
      release(chart, at(4), { detail: 1, button: otherButton.button });
      press(chart, at(4), { detail: 2, button: otherButton.button });
      move(chart, at(7), HELD_BUTTONS[otherButton.button]);
      release(chart, at(7), { detail: 2, button: otherButton.button });
      allTimers();

      expect(reset).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(band(chart)).toEqual(NO_BAND);
    });
  }

  test("with no zoom to undo, a second press drags as it always did", () => {
    const select: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({ onTimeRangeSelect: select });

    click(chart, at(2), 1);
    press(chart, at(2), { detail: 2 });
    move(chart, at(4));
    expect(band(chart)).toEqual(["10:02:00", "10:04:00"]);
    release(chart, at(4), { detail: 2 });

    expect(selections(select)).toEqual([
      ["2026-09-28T10:02:00.000Z", "2026-09-28T10:05:00.000Z"],
    ]);
  });

  test("a press handed no event is never the reset: it drags as it always did", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    act(() => {
      chart.result.current.chartEventProps.onMouseDown?.(at(3));
    });
    move(chart, at(5));
    act(() => {
      chart.result.current.chartEventProps.onMouseUp?.(at(5));
    });
    allTimers();

    expect(selections(select)).toEqual([
      ["2026-09-28T10:03:00.000Z", "2026-09-28T10:06:00.000Z"],
    ]);
    expect(reset).not.toHaveBeenCalled();
  });

  /*
   * The browser sends dblclick at a click count of 2 only, so the fallback
   * stands in for it at 2 only: a triple-click's third press is a press.
   */
  test("a triple-click's third press, on a chart with a zoom to undo, is an ordinary press: it arms no reset of its own", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, at(4), 1);
    click(chart, at(4), 2);
    doubleClick(chart);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    // The third press and its release, which the browser counts 3.
    click(chart, at(4), 3);

    expect(jest.getTimerCount()).toBe(0);
    expect(chart.result.current.isClickSuppressed()).toBe(false);

    allTimers();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  test("a drag from a press the browser counts 3 selects, as any drag does, and resets nothing", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    press(chart, at(2), { detail: 3 });
    move(chart, at(3));
    move(chart, at(5));

    expect(band(chart)).toEqual(["10:02:00", "10:05:00"]);

    release(chart, at(5), { detail: 3 });
    allTimers();

    expect(selections(select)).toEqual([
      ["2026-09-28T10:02:00.000Z", "2026-09-28T10:06:00.000Z"],
    ]);
    expect(reset).not.toHaveBeenCalled();
  });
});

/*
 * A drag needs the pointer itself to move, by more than
 * CHART_PRESS_STILLNESS_PX. The row recharts reports under the pointer can
 * change while the pointer stays put: new rows land mid-press (the refetch
 * after a zoom), or a hand's drift crosses a row's edge. Either way the
 * press is a plain click, which keeps its meaning (a bucket click, a legend
 * toggle) - never a zoom into two buckets the reader did not drag across.
 */
describe("a press becomes a drag only when the pointer moves", () => {
  const CHART_KINDS: Array<{
    name: string;
    setup: (select: MockFunction, reset: MockFunction) => ChartSetup;
  }> = [
    {
      name: "a chart with a zoom to undo",
      setup: (select: MockFunction, reset: MockFunction): ChartSetup => {
        return { onTimeRangeSelect: select, onTimeRangeReset: reset };
      },
    },
    {
      name: "a chart with none",
      setup: (select: MockFunction): ChartSetup => {
        return { onTimeRangeSelect: select };
      },
    },
  ];

  for (const kind of CHART_KINDS) {
    test(`on ${kind.name}, a press at a row's edge whose pointer drifts 2px onto the next row paints no band and renders nothing, and its release there is a plain click`, () => {
      const select: MockFunction = getJestMockFunction();
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartHarness = renderChart(kind.setup(select, reset));
      const pressX: number = clientXOf(at(2));
      const rendersBefore: number = chart.renders();

      press(chart, at(2), { clientX: pressX });
      // The hand is never quite still: recharts reports the next row now.
      move(chart, at(3), 1, pressX + 2);

      expect(band(chart)).toEqual(NO_BAND);

      release(chart, at(3), { clientX: pressX + 2 });

      expect(select).not.toHaveBeenCalled();
      expect(band(chart)).toEqual(NO_BAND);
      expect(chart.result.current.isClickSuppressed()).toBe(false);
      expect(chart.renders()).toBe(rendersBefore);

      allTimers();

      expect(select).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
    });

    test(`on ${kind.name}, new rows landing under a still press put another row under it: no band, and its release selects nothing`, () => {
      const select: MockFunction = getJestMockFunction();
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartHarness = renderChart(kind.setup(select, reset));
      const pressX: number = clientXOf(at(4));

      press(chart, at(4), { clientX: pressX });
      // The refetch lands mid-press, and the chart redraws its rows.
      chart.rerender({ ...kind.setup(select, reset), data: REFETCHED_ROWS });
      /*
       * The pointer has not moved from 10:04, the fifth old row; recharts
       * reports the row now under it, the ninth new one.
       */
      move(chart, at(8, REFETCHED_ROWS), 1, pressX);

      expect(band(chart)).toEqual(NO_BAND);

      release(chart, at(8, REFETCHED_ROWS), { clientX: pressX });

      expect(select).not.toHaveBeenCalled();
      expect(band(chart)).toEqual(NO_BAND);
      expect(chart.result.current.isClickSuppressed()).toBe(false);

      allTimers();

      expect(select).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
    });
  }

  // Pressed at the very edge of its row, so a few pixels reach the next one.
  const DIRECTIONS: Array<{
    name: string;
    pressedRow: number;
    otherRow: number;
    sign: number;
  }> = [
    { name: "rightwards", pressedRow: 2, otherRow: 3, sign: 1 },
    { name: "leftwards", pressedRow: 3, otherRow: 2, sign: -1 },
  ];

  for (const direction of DIRECTIONS) {
    test(`a pointer moved ${direction.name} by CHART_PRESS_STILLNESS_PX onto the next row has not moved; one pixel further, it is a drag across both rows`, () => {
      const select: MockFunction = getJestMockFunction();
      const chart: ChartHarness = renderChart({
        onTimeRangeSelect: select,
        onTimeRangeReset: getJestMockFunction(),
      });
      const pressX: number = clientXOf(at(direction.pressedRow));

      press(chart, at(direction.pressedRow), { clientX: pressX });
      move(
        chart,
        at(direction.otherRow),
        1,
        pressX + direction.sign * CHART_PRESS_STILLNESS_PX,
      );

      expect(band(chart)).toEqual(NO_BAND);

      const draggedX: number =
        pressX + direction.sign * (CHART_PRESS_STILLNESS_PX + 1);
      move(chart, at(direction.otherRow), 1, draggedX);

      expect(band(chart)).toEqual(["10:02:00", "10:03:00"]);

      release(chart, at(direction.otherRow), { clientX: draggedX });

      expect(selections(select)).toEqual([
        ["2026-09-28T10:02:00.000Z", "2026-09-28T10:04:00.000Z"],
      ]);
    });
  }

  test("a real drag - the pointer crossing a row's width at a time - paints its band as it goes and selects exactly", () => {
    const select: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: getJestMockFunction(),
    });

    // Rows sit ROW_WIDTH_PX (20px) apart: each move is a real one.
    press(chart, at(2));
    move(chart, at(3));

    expect(band(chart)).toEqual(["10:02:00", "10:03:00"]);

    move(chart, at(5));

    expect(band(chart)).toEqual(["10:02:00", "10:05:00"]);

    release(chart, at(5));

    expect(selections(select)).toEqual([
      ["2026-09-28T10:02:00.000Z", "2026-09-28T10:06:00.000Z"],
    ]);
    expect(band(chart)).toEqual(NO_BAND);
    expect(chart.result.current.isClickSuppressed()).toBe(true);

    nextTask();

    expect(chart.result.current.isClickSuppressed()).toBe(false);
  });

  test("a flick - let go well away, over another row, before any move came in - selects from the one to the other", () => {
    const select: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: getJestMockFunction(),
    });

    press(chart, at(2));
    release(chart, at(6));

    expect(selections(select)).toEqual([
      ["2026-09-28T10:02:00.000Z", "2026-09-28T10:07:00.000Z"],
    ]);
  });

  test("a caller that hands the handlers no mouse events drags by the change of row alone, as it always did", () => {
    const select: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: getJestMockFunction(),
    });

    pressWithoutEvent(chart, at(2));
    moveWithoutEvent(chart, at(4));

    expect(band(chart)).toEqual(["10:02:00", "10:04:00"]);

    releaseWithoutEvent(chart, at(4));

    expect(selections(select)).toEqual([
      ["2026-09-28T10:02:00.000Z", "2026-09-28T10:05:00.000Z"],
    ]);
    expect(band(chart)).toEqual(NO_BAND);
  });

  test("a caller that hands no mouse events, releasing over another row with no move between, selects from the one to the other", () => {
    const select: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: getJestMockFunction(),
    });

    pressWithoutEvent(chart, at(2));
    releaseWithoutEvent(chart, at(5));

    expect(selections(select)).toEqual([
      ["2026-09-28T10:02:00.000Z", "2026-09-28T10:06:00.000Z"],
    ]);
  });
});

/*
 * A release off the chart never reaches the chart; the page-wide listener
 * the press added hears it, and hands the hook the native event: where
 * the pointer is, and the browser's click count.
 */
describe("a release only the page hears", () => {
  test("a press let go where it went down - dragged straight off the chart, no move between - selects nothing, and the page stops listening", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });
    const pageListeners: PageListenerSpies = spyOnPageListeners();
    const pressX: number = clientXOf(at(4));

    press(chart, at(4), { clientX: pressX });
    fireEvent.mouseUp(window, { clientX: pressX, detail: 1, button: 0 });
    allTimers();

    expect(select).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(band(chart)).toEqual(NO_BAND);
    expect(chart.result.current.isClickSuppressed()).toBe(false);
    expectNoMouseUpListenerLeft(pageListeners);
  });

  test("a real drag let go far off the chart still selects up to the last row it crossed", () => {
    const select: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: getJestMockFunction(),
    });

    press(chart, at(2));
    move(chart, at(3));
    move(chart, at(5));
    fireEvent.mouseUp(window, {
      clientX: clientXOf(at(5)) + 400,
      detail: 1,
      button: 0,
    });

    expect(selections(select)).toEqual([
      ["2026-09-28T10:02:00.000Z", "2026-09-28T10:06:00.000Z"],
    ]);
    expect(band(chart)).toEqual(NO_BAND);
  });

  /*
   * The count is what tells a later click's release (1) - the reset
   * press's own was lost, the window having lost focus mid-press - from
   * the reset press's own (2). A listener that handed the hook no event
   * would reset for both.
   */
  const PAGE_RELEASES: Array<{
    name: string;
    detail: number;
    resets: number;
  }> = [
    {
      name: "a later click's release, counted 1, ends the reset press and resets nothing",
      detail: 1,
      resets: 0,
    },
    {
      name: "the reset press's own release, counted 2, resets once",
      detail: 2,
      resets: 1,
    },
  ];

  for (const pageRelease of PAGE_RELEASES) {
    test(`the listener a reset press adds is handed the native MouseEvent: ${pageRelease.name}`, () => {
      const select: MockFunction = getJestMockFunction();
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartHarness = renderChart({
        onTimeRangeSelect: select,
        onTimeRangeReset: reset,
      });
      const pageListeners: PageListenerSpies = spyOnPageListeners();

      click(chart, at(4), 1);
      press(chart, at(4), { detail: 2 });
      const listener: (event: MouseEvent) => void =
        lastMouseUpListener(pageListeners);

      act(() => {
        listener(
          new MouseEvent("mouseup", {
            detail: pageRelease.detail,
            button: 0,
            clientX: 300,
          }),
        );
      });

      expectNoMouseUpListenerLeft(pageListeners);

      nextTask();

      expect(reset).toHaveBeenCalledTimes(pageRelease.resets);

      allTimers();

      expect(reset).toHaveBeenCalledTimes(pageRelease.resets);
      expect(select).not.toHaveBeenCalled();
      expect(band(chart)).toEqual(NO_BAND);
    });
  }
});

describe("a chart that only resets", () => {
  for (const resetOnly of RESET_ONLY_CASES) {
    describe(resetOnly.name, () => {
      test("a single press starts nothing: no page-wide release listener, no selection", () => {
        const select: MockFunction = getJestMockFunction();
        const reset: MockFunction = getJestMockFunction();
        const chart: ChartHarness = renderChart(resetOnly.setup(select, reset));
        const pageListeners: PageListenerSpies = spyOnPageListeners();
        const rendersBefore: number = chart.renders();

        press(chart, at(2), { detail: 1 });
        expect(mouseUpListeners(pageListeners.add.mock.calls)).toEqual([]);

        release(chart, at(6), { detail: 1 });
        fireEvent.mouseUp(window);
        allTimers();

        expect(select).not.toHaveBeenCalled();
        expect(reset).not.toHaveBeenCalled();
        expect(band(chart)).toEqual(NO_BAND);
        expect(chart.renders()).toBe(rendersBefore);
      });

      test("a double-click whose dblclick never arrives resets once", () => {
        const select: MockFunction = getJestMockFunction();
        const reset: MockFunction = getJestMockFunction();
        const chart: ChartHarness = renderChart(resetOnly.setup(select, reset));

        click(chart, at(5), 1);
        click(chart, at(5), 2);
        expect(reset).not.toHaveBeenCalled();

        nextTask();
        expect(reset).toHaveBeenCalledTimes(1);
        allTimers();
        expect(reset).toHaveBeenCalledTimes(1);
        expect(select).not.toHaveBeenCalled();
      });

      test("a double-click whose dblclick arrives resets exactly once", () => {
        const select: MockFunction = getJestMockFunction();
        const reset: MockFunction = getJestMockFunction();
        const chart: ChartHarness = renderChart(resetOnly.setup(select, reset));

        click(chart, at(5), 1);
        click(chart, at(5), 2);
        doubleClick(chart);
        expect(reset).toHaveBeenCalledTimes(1);

        allTimers();
        expect(reset).toHaveBeenCalledTimes(1);
        expect(select).not.toHaveBeenCalled();
      });
    });
  }
});

describe("the reset is read when it happens", () => {
  test("the fallback runs the reset the chart handed in last, not the one it had at the press", () => {
    const select: MockFunction = getJestMockFunction();
    const resetAtThePress: MockFunction = getJestMockFunction();
    const resetNow: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: resetAtThePress,
    });

    click(chart, at(4), 1);
    click(chart, at(4), 2);
    // The chart re-renders before the next task, with a new reset.
    chart.rerender({ onTimeRangeSelect: select, onTimeRangeReset: resetNow });
    nextTask();

    expect(resetNow).toHaveBeenCalledTimes(1);
    expect(resetAtThePress).not.toHaveBeenCalled();
  });

  test("a dblclick handler taken before a re-render runs the reset handed in last", () => {
    const select: MockFunction = getJestMockFunction();
    const resetBefore: MockFunction = getJestMockFunction();
    const resetNow: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: resetBefore,
    });
    const onDoubleClick: ChartRangeSelectionRootProps["onDoubleClick"] =
      chart.result.current.chartEventProps.onDoubleClick;
    expect(typeof onDoubleClick).toBe("function");

    chart.rerender({ onTimeRangeSelect: select, onTimeRangeReset: resetNow });
    act(() => {
      onDoubleClick?.();
    });

    expect(resetNow).toHaveBeenCalledTimes(1);
    expect(resetBefore).not.toHaveBeenCalled();
  });

  test("a reset withdrawn before the next task - the zoom already undone - runs nothing", () => {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartHarness = renderChart({
      onTimeRangeSelect: select,
      onTimeRangeReset: reset,
    });

    click(chart, at(4), 1);
    click(chart, at(4), 2);
    chart.rerender({ onTimeRangeSelect: select });
    allTimers();

    expect(reset).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(keysOf(chart.result.current.chartEventProps)).not.toContain(
      "onDoubleClick",
    );
  });
});
