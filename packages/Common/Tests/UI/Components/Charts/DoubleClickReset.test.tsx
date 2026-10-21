import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  RenderHookResult,
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import {
  ChartPointerEvent,
  DoubleClickReset,
  isSecondPressOfDoubleClick,
  useDoubleClickReset,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4116. Right after a drag zooms an explorer (Traces, Logs,
 * Metrics, ...), its charts refetch, and the reader double-clicks to undo
 * the zoom at exactly that moment. When the new data lands during the
 * double-click's SECOND press, recharts re-keys the node under that press
 * (a histogram's bars or selection band, a line's path), and Chrome sends
 * neither a click nor a `dblclick` for a press whose node left the page
 * before its release. A chart that reset only on `dblclick` stayed zoomed,
 * at random: "it only works once the cursor changes to a plus".
 *
 * useDoubleClickReset stops the reset depending on that `dblclick`. It
 * knows the second press by the browser's own click count
 * (MouseEvent.detail is 2 on it, whatever becomes of its node), and that
 * press's release arms the reset for the next task. Chrome sends the
 * release's click and `dblclick` before then, and the `dblclick` resets
 * and stands the fallback down. Every chart shares it:
 * useHistogramRangeSelection (the explorers' histograms) and
 * useChartRangeSelection (the line, area and bar charts).
 *
 * Pinned here, at the hook:
 * - which presses are the second of a double-click, and so the reset;
 * - a double-click resets EXACTLY once, whether its `dblclick` arrives or
 *   not: never zero times (the bug), and never twice (a fallback that did
 *   not stand down would reset again after the page had moved on);
 * - only the release of the reset press arms the fallback, and only once;
 * - a release the browser counts 1 is not the reset press's own (that is
 *   counted 2, like the press) but a later, fresh click's: the press's own
 *   release never came (the window lost focus with the button down, say),
 *   and the page-wide listener a chart adds for it heard the next one. It
 *   ends the reset press and arms nothing, so that unrelated click resets
 *   nothing - then or ever;
 * - the reset is read when it happens: the chart re-renders in between
 *   (the refetch that started all this) and must reset with the handler it
 *   has NOW, while one that stopped offering a reset, or unmounted, resets
 *   nothing.
 */

type ResetHandler = () => void;

// A single click, or the first press of a double-click: the browser counts it 1.
const FIRST_PRESS: ChartPointerEvent = { detail: 1, button: 0, clientX: 240 };

// The second press of a double-click, with the main button: counted 2.
const SECOND_PRESS: ChartPointerEvent = { detail: 2, button: 0, clientX: 240 };

// The release of a first press: counted 1, like its press.
const FIRST_RELEASE: ChartPointerEvent = { detail: 1, button: 0, clientX: 240 };

// The second press's own release: counted 2, like its press.
const SECOND_RELEASE: ChartPointerEvent = {
  detail: 2,
  button: 0,
  clientX: 240,
};

/*
 * The release of a later, fresh click somewhere else on the page, which
 * only a chart's page-wide listener hears: the browser counts it 1.
 */
const LATER_CLICK_RELEASE: ChartPointerEvent = {
  detail: 1,
  button: 0,
  clientX: 520,
};

interface ResetHookProps {
  // The reset the chart offers on this render, if any.
  reset: ResetHandler | undefined;
}

interface ChartUnderTest {
  hook: RenderHookResult<DoubleClickReset, ResetHookProps>;
  // Re-renders the chart, now offering this reset (or none).
  offer: (reset: ResetHandler | undefined) => void;
  // A press on the chart; true when the hook took it as the reset press.
  press: (event?: ChartPointerEvent | null) => boolean;
  /*
   * The release of a press, over the chart or heard by the page; true when
   * it ended the reset press.
   */
  release: (event?: ChartPointerEvent | null) => boolean;
  // The browser's dblclick on the chart.
  doubleClick: () => void;
}

/*
 * The hook the way a chart drives it: every press, every release and the
 * dblclick go through the object it returned on the chart's latest render.
 */
function renderChart(reset: ResetHandler | undefined): ChartUnderTest {
  const hook: RenderHookResult<DoubleClickReset, ResetHookProps> = renderHook(
    (props: ResetHookProps): DoubleClickReset => {
      return useDoubleClickReset(props.reset);
    },
    { initialProps: { reset: reset } },
  );

  return {
    hook: hook,
    offer: (nextReset: ResetHandler | undefined): void => {
      hook.rerender({ reset: nextReset });
    },
    press: (event?: ChartPointerEvent | null): boolean => {
      let isResetPress: boolean = false;
      act(() => {
        isResetPress = hook.result.current.onPress(event);
      });
      return isResetPress;
    },
    release: (event?: ChartPointerEvent | null): boolean => {
      let endedResetPress: boolean = false;
      act(() => {
        endedResetPress = hook.result.current.onRelease(event);
      });
      return endedResetPress;
    },
    doubleClick: (): void => {
      act(() => {
        hook.result.current.onDoubleClick();
      });
    },
  };
}

/*
 * The task after the release's own. Chrome has sent the release's click
 * and dblclick by then, when it sends them at all.
 */
function runNextTask(): void {
  act(() => {
    jest.advanceTimersByTime(0);
  });
}

// Everything still pending, however far off.
function runAllTimers(): void {
  act(() => {
    jest.runAllTimers();
  });
}

/*
 * The microtasks after the release, where React commits: both the native
 * queue and the one the fake timers keep (queueMicrotask, nextTick).
 */
async function runMicrotasks(): Promise<void> {
  jest.runAllTicks();
  for (let turn: number = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("isSecondPressOfDoubleClick", () => {
  const SECOND_PRESSES: Array<[string, ChartPointerEvent]> = [
    ["the second press of a double-click", { detail: 2, button: 0 }],
    [
      "a second press that does not say which button (so the main one)",
      { detail: 2, clientX: 240 },
    ],
  ];

  test.each(SECOND_PRESSES)(
    "counts %s",
    (_name: string, event: ChartPointerEvent) => {
      expect(isSecondPressOfDoubleClick(event)).toBe(true);
    },
  );

  const OTHER_PRESSES: Array<[string, ChartPointerEvent]> = [
    ["a single click", { detail: 1, button: 0 }],
    [
      "a click the browser counted 0 (a keyboard or assistive-technology click)",
      { detail: 0, button: 0 },
    ],
    ["a press that carries no count", { button: 0, clientX: 240 }],
    ["a press whose count is undefined", { detail: undefined, button: 0 }],
    ["an empty event", {}],
    [
      "a right-button double-click (it opens a context menu)",
      { detail: 2, button: 2 },
    ],
    ["a middle-button double-click", { detail: 2, button: 1 }],
    ["a back-button double-click", { detail: 2, button: 3 }],
    ["a right-button triple-click", { detail: 3, button: 2 }],
    /*
     * The browser sends dblclick at a count of 2 only, so the fallback
     * stands in for it at 2 only: a triple-click's third press is a press.
     */
    ["the third press of a triple-click", { detail: 3, button: 0 }],
    ["the fourth press of a rapid multi-click", { detail: 4, button: 0 }],
  ];

  test.each(OTHER_PRESSES)(
    "does not count %s",
    (_name: string, event: ChartPointerEvent) => {
      expect(isSecondPressOfDoubleClick(event)).toBe(false);
    },
  );

  test("does not count a press it is handed no event for", () => {
    expect(isSecondPressOfDoubleClick()).toBe(false);
    expect(isSecondPressOfDoubleClick(undefined)).toBe(false);
    expect(isSecondPressOfDoubleClick(null)).toBe(false);
  });

  test("reads the count and the button off a real MouseEvent", () => {
    // Getters on the event's prototype there, not own properties.
    expect(
      isSecondPressOfDoubleClick(
        new MouseEvent("mousedown", { detail: 2, button: 0 }),
      ),
    ).toBe(true);
    expect(
      isSecondPressOfDoubleClick(
        new MouseEvent("mousedown", { detail: 1, button: 0 }),
      ),
    ).toBe(false);
    expect(
      isSecondPressOfDoubleClick(
        new MouseEvent("mousedown", { detail: 2, button: 2 }),
      ),
    ).toBe(false);
  });
});

describe("useDoubleClickReset", () => {
  describe("on a chart that offers no reset", () => {
    test("a second press is not the reset, its release is nothing, and a dblclick does nothing", () => {
      const chart: ChartUnderTest = renderChart(undefined);

      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(chart.press(SECOND_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);

      // Nothing armed: there is nothing to reset.
      expect(jest.getTimerCount()).toBe(0);

      expect(() => {
        chart.doubleClick();
      }).not.toThrow();
      expect(jest.getTimerCount()).toBe(0);
    });

    test("a reset the chart has stopped offering is never called, by a double-click or its presses", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      // The zoom was undone some other way (the time picker, say).
      chart.offer(undefined);

      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(chart.press(SECOND_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);
      chart.doubleClick();
      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });

    test("a press made while it offered none does not become the reset when one is offered before its release", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(undefined);

      /*
       * The chart already handled this press as whatever it was (the start
       * of a selection, say), so its release cannot turn it into the reset.
       */
      expect(chart.press(SECOND_PRESS)).toBe(false);
      chart.offer(reset);
      expect(chart.release()).toBe(false);
      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });
  });

  describe("a double-click whose dblclick arrives", () => {
    test("resets once, at the dblclick, and the fallback its release armed stands down", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);
      expect(reset).not.toHaveBeenCalled();

      chart.doubleClick();

      expect(reset).toHaveBeenCalledTimes(1);

      // The fallback must not reset a second time.
      runNextTask();
      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    test("the fallback waits for a task, not a microtask, so the dblclick sent straight after the release still finds it armed", async () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      chart.press(FIRST_PRESS);
      chart.release();
      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);

      /*
       * Chrome runs the release's microtasks (React commits there) before
       * it sends the release's click and the dblclick. A fallback run from
       * there would reset before the dblclick, which would then reset
       * again.
       */
      await runMicrotasks();

      expect(reset).not.toHaveBeenCalled();

      chart.doubleClick();
      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    test("resets once from a dblclick with no reset press before it", () => {
      /*
       * Its presses landed where the chart's press handlers do not run
       * (the chart box's padding), or on a chart wired for dblclick only.
       */
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      chart.doubleClick();

      expect(reset).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);

      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    test("presses the chart could not count are never the reset, and the dblclick still resets once", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      // A caller that hands the hook no event: dblclick is all it has.
      expect(chart.press()).toBe(false);
      expect(chart.release()).toBe(false);
      expect(chart.press(null)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      chart.doubleClick();
      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    test("a dblclick resets with the reset of the chart's latest render", () => {
      const firstReset: MockFunction = getJestMockFunction();
      const latestReset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(firstReset);

      chart.offer(latestReset);
      chart.doubleClick();
      runAllTimers();

      expect(latestReset).toHaveBeenCalledTimes(1);
      expect(firstReset).not.toHaveBeenCalled();
    });
  });

  describe("a double-click whose dblclick never arrives (issue #4116)", () => {
    test("resets once, in the task after the second press's release", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);

      // Not during the release: the browser may yet send the dblclick.
      expect(reset).not.toHaveBeenCalled();

      runNextTask();

      expect(reset).toHaveBeenCalledTimes(1);

      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    test("resets with the chart's newest reset when new data re-renders the chart during the second press", () => {
      const resetBeforeRefetch: MockFunction = getJestMockFunction();
      const resetAfterRefetch: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(resetBeforeRefetch);

      chart.press(FIRST_PRESS);
      chart.release();
      expect(chart.press(SECOND_PRESS)).toBe(true);

      /*
       * The refetch lands mid-press. The histogram hands the hook a new
       * zoom-out on every render.
       */
      chart.offer(resetAfterRefetch);

      expect(chart.release()).toBe(true);

      runNextTask();

      expect(resetAfterRefetch).toHaveBeenCalledTimes(1);
      expect(resetBeforeRefetch).not.toHaveBeenCalled();
    });

    test("reads the reset when it resets: a re-render between the release and the fallback hands it the new one", () => {
      const olderReset: MockFunction = getJestMockFunction();
      const newerReset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(olderReset);

      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);

      chart.offer(newerReset);
      runNextTask();

      expect(newerReset).toHaveBeenCalledTimes(1);
      expect(olderReset).not.toHaveBeenCalled();

      runAllTimers();

      expect(newerReset).toHaveBeenCalledTimes(1);
      expect(olderReset).not.toHaveBeenCalled();
    });

    test("resets nothing when the chart stops offering a reset before the fallback runs", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);

      chart.offer(undefined);
      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });

    test("resets nothing once the chart has unmounted", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);

      chart.hook.unmount();
      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });

    test("arms one reset for a release it hears twice (the chart's own and the page's)", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);
      expect(jest.getTimerCount()).toBe(1);

      expect(chart.release()).toBe(false);
      expect(jest.getTimerCount()).toBe(1);

      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    test("is ready again afterwards: a later double-click resets once more", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      // This double-click lost its dblclick: the fallback resets.
      chart.press(FIRST_PRESS);
      chart.release();
      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);
      runNextTask();

      expect(reset).toHaveBeenCalledTimes(1);

      // Zoomed in again, and this double-click keeps its dblclick.
      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release()).toBe(true);
      chart.doubleClick();
      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(2);
    });
  });

  describe("presses that are not the reset arm nothing", () => {
    test("a single click", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });

    test("a right-button or middle-button double-click", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      for (const button of [2, 1]) {
        expect(chart.press({ detail: 1, button: button })).toBe(false);
        expect(chart.release()).toBe(false);
        expect(chart.press({ detail: 2, button: button })).toBe(false);
        expect(chart.release()).toBe(false);
      }
      expect(jest.getTimerCount()).toBe(0);

      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });

    test("a reset press superseded by a new plain press, then a release", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(SECOND_PRESS)).toBe(true);

      /*
       * Its release never reached the hook (the window lost focus
       * mid-press, say), and the next press is a plain click.
       */
      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });

    test("a release with no press on the chart before it", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      // A drag that started off the chart and ended over it.
      expect(chart.release()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });
  });

  /*
   * Any release ends the reset press: the chart's own, or one its
   * page-wide listener hears. Only the browser's count tells the press's
   * own release (2, like the press) from a later click's (1).
   */
  describe("the release that ends the reset press", () => {
    test("its own release, counted 2 like the press, arms the reset for the next task", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release(FIRST_RELEASE)).toBe(false);
      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release(SECOND_RELEASE)).toBe(true);
      expect(jest.getTimerCount()).toBe(1);
      expect(reset).not.toHaveBeenCalled();

      runNextTask();

      expect(reset).toHaveBeenCalledTimes(1);

      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    /*
     * Only a count of 1 says the release is someone else's. A caller that
     * hands no event, or an event with no count of 1, gets the fallback,
     * as every release did before the count was read.
     */
    const RELEASES_THAT_ARM: Array<
      [string, ChartPointerEvent | null | undefined]
    > = [
      ["handed no event (a caller that has none)", undefined],
      ["handed a null event", null],
      ["the browser counts 0", { detail: 0, button: 0, clientX: 240 }],
      ["whose count is undefined", { detail: undefined, button: 0 }],
      ["that carries no count", { button: 0, clientX: 240 }],
    ];

    test.each(RELEASES_THAT_ARM)(
      "a release %s ends it and arms the reset too",
      (_name: string, event: ChartPointerEvent | null | undefined) => {
        const reset: MockFunction = getJestMockFunction();
        const chart: ChartUnderTest = renderChart(reset);

        expect(chart.press(SECOND_PRESS)).toBe(true);
        expect(chart.release(event)).toBe(true);
        expect(jest.getTimerCount()).toBe(1);
        expect(reset).not.toHaveBeenCalled();

        runNextTask();

        expect(reset).toHaveBeenCalledTimes(1);

        // It ended the press: the same release again is nothing.
        expect(chart.release(event)).toBe(false);
        runAllTimers();

        expect(reset).toHaveBeenCalledTimes(1);
      },
    );

    test("a release counted 1 - a later, fresh click's - ends it but arms nothing, and nothing after it resets", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release(FIRST_RELEASE)).toBe(false);
      expect(chart.press(SECOND_PRESS)).toBe(true);

      /*
       * The press's own release never came: the window lost focus with the
       * button down. This one is the next click's, anywhere on the page.
       */
      expect(chart.release(LATER_CLICK_RELEASE)).toBe(true);
      expect(jest.getTimerCount()).toBe(0);

      runAllTimers();

      expect(reset).not.toHaveBeenCalled();

      // The reset press is over: no later release, however counted, ends it.
      expect(chart.release(SECOND_RELEASE)).toBe(false);
      expect(chart.release()).toBe(false);
      expect(chart.release(LATER_CLICK_RELEASE)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      runAllTimers();

      expect(reset).not.toHaveBeenCalled();
    });

    test("reads the release's count off a real MouseEvent, the kind a page-wide listener hands on", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      // Getters on the event's prototype there, not own properties.
      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(
        chart.release(
          new MouseEvent("mouseup", { detail: 1, button: 0, clientX: 520 }),
        ),
      ).toBe(true);
      runAllTimers();

      expect(reset).not.toHaveBeenCalled();

      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(
        chart.release(
          new MouseEvent("mouseup", { detail: 2, button: 0, clientX: 240 }),
        ),
      ).toBe(true);
      runNextTask();

      expect(reset).toHaveBeenCalledTimes(1);
    });

    test("a reset press whose release never came, then a later click's release heard by the page: no reset, ever - and a double-click after that resets once", () => {
      const reset: MockFunction = getJestMockFunction();
      const chart: ChartUnderTest = renderChart(reset);

      chart.press(FIRST_PRESS);
      chart.release(FIRST_RELEASE);
      expect(chart.press(SECOND_PRESS)).toBe(true);

      // What the page hears of a click elsewhere, a while later.
      expect(
        chart.release(
          new MouseEvent("mouseup", { detail: 1, button: 0, clientX: 520 }),
        ),
      ).toBe(true);
      runAllTimers();

      expect(reset).not.toHaveBeenCalled();

      // Ready again: the next double-click resets, once.
      expect(chart.press(FIRST_PRESS)).toBe(false);
      expect(chart.release(FIRST_RELEASE)).toBe(false);
      expect(chart.press(SECOND_PRESS)).toBe(true);
      expect(chart.release(SECOND_RELEASE)).toBe(true);
      runNextTask();

      expect(reset).toHaveBeenCalledTimes(1);

      runAllTimers();

      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  test("hands back the same object, with the same handlers, on every render", () => {
    /*
     * The charts build their own handlers on it (useCallback deps), and the
     * histogram hands the hook a new zoom-out on every render: an object
     * that followed the reset would rebuild every chart handler on every
     * render.
     */
    const reset: MockFunction = getJestMockFunction();
    const chart: ChartUnderTest = renderChart(reset);
    const first: DoubleClickReset = chart.hook.result.current;

    const nextResets: Array<ResetHandler | undefined> = [
      reset,
      getJestMockFunction(),
      undefined,
      reset,
    ];

    for (const nextReset of nextResets) {
      chart.offer(nextReset);

      expect(chart.hook.result.current).toBe(first);
      expect(chart.hook.result.current.onPress).toBe(first.onPress);
      expect(chart.hook.result.current.onRelease).toBe(first.onRelease);
      expect(chart.hook.result.current.onDoubleClick).toBe(first.onDoubleClick);
    }
  });
});

interface ResettablePlotProps {
  reset: ResetHandler | undefined;
  /*
   * The data on show. New data re-keys the bar, the way recharts re-keys a
   * histogram's bars and a line's path.
   */
  dataVersion: number;
}

/*
 * A plot wired the way the charts wire the hook: the press and the release
 * handlers get the React mouse event, and the dblclick handler is the
 * hook's own. A reset press also listens for its release on the page, where
 * a release off the plot is heard (the plot never hears it), and hands the
 * hook the native event; whichever hears the release first ends that.
 */
const ResettablePlot: FunctionComponent<ResettablePlotProps> = (
  props: ResettablePlotProps,
): ReactElement => {
  const doubleClickReset: DoubleClickReset = useDoubleClickReset(props.reset);
  const pageListener: React.MutableRefObject<
    ((event: ChartPointerEvent) => void) | null
  > = React.useRef<((event: ChartPointerEvent) => void) | null>(null);

  const stopListeningOnThePage: () => void = React.useCallback((): void => {
    if (pageListener.current) {
      window.removeEventListener("mouseup", pageListener.current);
      pageListener.current = null;
    }
  }, []);

  React.useEffect(() => {
    return stopListeningOnThePage;
  }, [stopListeningOnThePage]);

  const onRelease: (event: ChartPointerEvent) => void = (
    event: ChartPointerEvent,
  ): void => {
    if (doubleClickReset.onRelease(event)) {
      stopListeningOnThePage();
    }
  };

  return (
    <div
      data-testid="plot"
      onMouseDown={(event: React.MouseEvent<HTMLDivElement>): void => {
        if (!doubleClickReset.onPress(event)) {
          return;
        }
        stopListeningOnThePage();
        pageListener.current = onRelease;
        window.addEventListener("mouseup", onRelease);
      }}
      onMouseUp={(event: React.MouseEvent<HTMLDivElement>): void => {
        onRelease(event);
      }}
      onDoubleClick={doubleClickReset.onDoubleClick}
    >
      <span key={props.dataVersion} data-testid="bar" />
    </div>
  );
};

function bar(): HTMLElement {
  return screen.getByTestId("bar");
}

describe("useDoubleClickReset on the mouse events React and the page deliver", () => {
  test("a double-click that keeps its dblclick resets once, at the dblclick", () => {
    const reset: MockFunction = getJestMockFunction();
    render(<ResettablePlot reset={reset} dataVersion={1} />);

    fireEvent.mouseDown(bar(), { detail: 1 });
    fireEvent.mouseUp(bar(), { detail: 1 });
    fireEvent.click(bar(), { detail: 1 });
    fireEvent.mouseDown(bar(), { detail: 2 });
    fireEvent.mouseUp(bar(), { detail: 2 });
    fireEvent.click(bar(), { detail: 2 });

    expect(reset).not.toHaveBeenCalled();

    fireEvent.dblClick(bar(), { detail: 2 });

    expect(reset).toHaveBeenCalledTimes(1);

    runAllTimers();

    expect(reset).toHaveBeenCalledTimes(1);
  });

  test("new data landing during the second press costs the click and the dblclick, and it still resets once, with the new reset", () => {
    const resetBeforeRefetch: MockFunction = getJestMockFunction();
    const resetAfterRefetch: MockFunction = getJestMockFunction();
    const view: RenderResult = render(
      <ResettablePlot reset={resetBeforeRefetch} dataVersion={1} />,
    );
    const pressedBar: HTMLElement = bar();

    fireEvent.mouseDown(pressedBar, { detail: 1 });
    fireEvent.mouseUp(pressedBar, { detail: 1 });
    fireEvent.click(pressedBar, { detail: 1 });
    fireEvent.mouseDown(pressedBar, { detail: 2 });

    // The refetch lands: new bars, and a new reset with them.
    view.rerender(<ResettablePlot reset={resetAfterRefetch} dataVersion={2} />);

    expect(pressedBar.isConnected).toBe(false);

    /*
     * The release lands on the new bar, and Chrome sends no click and no
     * dblclick: the node the press went down on has left the page.
     */
    fireEvent.mouseUp(bar(), { detail: 2 });

    expect(resetAfterRefetch).not.toHaveBeenCalled();

    runNextTask();

    expect(resetAfterRefetch).toHaveBeenCalledTimes(1);
    expect(resetBeforeRefetch).not.toHaveBeenCalled();

    runAllTimers();

    expect(resetAfterRefetch).toHaveBeenCalledTimes(1);
  });

  test("a right-button double-click resets nothing", () => {
    const reset: MockFunction = getJestMockFunction();
    render(<ResettablePlot reset={reset} dataVersion={1} />);

    // The right button gets a context menu, not a click or a dblclick.
    fireEvent.mouseDown(bar(), { detail: 1, button: 2 });
    fireEvent.mouseUp(bar(), { detail: 1, button: 2 });
    fireEvent.mouseDown(bar(), { detail: 2, button: 2 });
    fireEvent.mouseUp(bar(), { detail: 2, button: 2 });
    runAllTimers();

    expect(reset).not.toHaveBeenCalled();
  });

  test("a second press let go off the plot, which only the page hears, resets once", () => {
    const reset: MockFunction = getJestMockFunction();
    render(<ResettablePlot reset={reset} dataVersion={1} />);

    fireEvent.mouseDown(bar(), { detail: 1 });
    fireEvent.mouseUp(bar(), { detail: 1 });
    fireEvent.click(bar(), { detail: 1 });
    fireEvent.mouseDown(bar(), { detail: 2 });
    // Let go below the plot: no click and no dblclick reach it.
    fireEvent.mouseUp(document.body, { detail: 2 });

    expect(reset).not.toHaveBeenCalled();

    runNextTask();

    expect(reset).toHaveBeenCalledTimes(1);

    runAllTimers();

    expect(reset).toHaveBeenCalledTimes(1);
  });

  test("a second press whose release never comes, then a click elsewhere on the page: its release, which the page hears counted 1, resets nothing - then or later", () => {
    const reset: MockFunction = getJestMockFunction();
    render(<ResettablePlot reset={reset} dataVersion={1} />);

    fireEvent.mouseDown(bar(), { detail: 1 });
    fireEvent.mouseUp(bar(), { detail: 1 });
    fireEvent.click(bar(), { detail: 1 });
    fireEvent.mouseDown(bar(), { detail: 2 });

    /*
     * Its release never comes: the window lost focus with the button down.
     * Later the reader clicks somewhere else on the page. Only the page
     * hears that click's release, and the browser counts it 1.
     */
    fireEvent.mouseDown(document.body, { detail: 1 });
    fireEvent.mouseUp(document.body, { detail: 1 });
    fireEvent.click(document.body, { detail: 1 });
    runAllTimers();

    expect(reset).not.toHaveBeenCalled();

    /*
     * That release ended the second press, so no later release is its end:
     * not one over the plot that no press on it began, even counted 2, nor
     * one on the page.
     */
    fireEvent.mouseUp(bar(), { detail: 2 });
    fireEvent.mouseUp(document.body, { detail: 2 });
    runAllTimers();

    expect(reset).not.toHaveBeenCalled();

    // A double-click made afterwards resets, once.
    fireEvent.mouseDown(bar(), { detail: 1 });
    fireEvent.mouseUp(bar(), { detail: 1 });
    fireEvent.click(bar(), { detail: 1 });
    fireEvent.mouseDown(bar(), { detail: 2 });
    fireEvent.mouseUp(bar(), { detail: 2 });
    fireEvent.click(bar(), { detail: 2 });
    fireEvent.dblClick(bar(), { detail: 2 });
    runAllTimers();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
