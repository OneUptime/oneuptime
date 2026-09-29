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
  act,
  cleanup,
  fireEvent,
  renderHook,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import useHistogramRangeSelection, {
  HISTOGRAM_PRESS_STILLNESS_PX,
  HistogramPlaceholderProps,
  HistogramPointerState,
  HistogramRangeSelectionOptions,
  HistogramRangeSelectionState,
} from "../../../../UI/Components/Charts/Utils/useHistogramRangeSelection";
import {
  ChartPointerEvent,
  DOUBLE_CLICK_DISAMBIGUATION_MS,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";

/*
 * Issue #4116. Right after a drag zooms an explorer (Traces, Logs, ...),
 * its histogram refetches, and a reader double-clicks to undo the zoom at
 * exactly that moment. When the new buckets landed during the double-
 * click's SECOND press, recharts re-keyed the bars and the selection band
 * under the press, and Chrome sends no click and no dblclick for a press
 * whose node left the page: the chart stayed zoomed. Worse, the hook read
 * that press's release - whose bar now came from the NEW data, at the same
 * tooltip index - as a drag from an old bar to a new one, and zoomed the
 * explorer to a bogus window. New buckets landing during the FIRST press
 * zoomed in once more before the reset.
 *
 * These tests drive useHistogramRangeSelection the way recharts 3 drives a
 * chart root's handlers: each gets the chart state (the bar under the
 * pointer, `activeLabel`) and the React event (the browser's click count,
 * `detail`, and `clientX`). Pinned here:
 *
 *   - on a zoomed chart the second press of a double-click (detail 2) IS
 *     the zoom-out: it cancels the first click's zoom-in without a render,
 *     starts no selection, and its release - over the chart or, heard by
 *     the page, off it - zooms out in the next task even when no dblclick
 *     follows, and exactly once when one does;
 *   - a press becomes a drag only when the POINTER moves (more than
 *     HISTOGRAM_PRESS_STILLNESS_PX) onto another bar. Another bar coming
 *     under a still pointer is not a drag. It is new data, and the press
 *     zooms nowhere, when it shows at the very spot pressed (the same
 *     tooltip index) or when the pointer never moved at all, not by a
 *     pixel: recharts clamps a stale index onto the last bar of shorter
 *     data, so a press right of where a shorter refetch ends is let go at
 *     another index, as after a drift. When a hand's drift crossed into
 *     the next bar, it is a click on the bar it pressed;
 *   - a second press whose own release never came (the window lost focus
 *     mid-press) is ended by the next release heard, which the browser
 *     counts 1 - a later, unrelated click's: it zooms nothing out, clears
 *     the band the first click painted, and leaves no page-wide listener
 *     behind;
 *   - a click waiting to zoom in is dropped, band and all, the moment the
 *     host stops offering onZoomOut (the zoom ended another way), and so
 *     is the band a double-click's second press kept for the zoom-out; a
 *     drag's band stays;
 *   - a box standing in for the chart (placeholderProps: its loader, its
 *     empty box) takes a double-click's second press as the chart does:
 *     its release, over the chart that replaced the box by then or
 *     anywhere on the page, zooms out in the next task, once, dblclick or
 *     not. A press on it counted 1, a right-button press, or any press on
 *     an unzoomed chart is nothing, and listens for nothing;
 *   - only the main button selects;
 *   - a press let go off the chart, which only the page hears, is read at
 *     the pointer's place: let go where it went down, a click on the bar
 *     it pressed; after crossing bars, a drag to the last one;
 *   - drags, flicks and clicks select what they always did, an unzoomed
 *     chart has no double-click gesture, and a host that hands the
 *     handlers no event keeps the old label-only reading.
 *
 * Before the fix, every case here in which new bars land mid-press, a
 * second press has to zoom out without its dblclick, or a few pixels of
 * the pointer's own movement decide the drag, failed. Before its
 * follow-ups, so did a later click's release after a lost one (it zoomed
 * out), a click still waiting when the zoom ended another way (it zoomed
 * back in), and a right-click (it zoomed into its bar). Before commit
 * b6ec899df4, so did a still press right of where a shorter refetch ends
 * (it zoomed into the bar the refetch left out, 10:25), every case of a
 * box standing in for the chart (there were no placeholderProps to spread
 * on one), and the band a second press kept for a zoom-out that is not
 * coming (it stayed lit). The rest - drags, flicks and clicks, a hand's
 * drift, hosts that hand no event, the unzoomed chart, and double-clicks
 * that keep their dblclick - guard what already worked.
 */

const MINUTE_MS: number = 60 * 1000;

/*
 * Neighbouring one-minute bars, labelled as recharts reports them (the
 * instant each bucket starts), and the clientX each is pressed at.
 */
const BAR_A: string = "2026-09-28T10:00:00.000Z";
const BAR_B: string = "2026-09-28T10:01:00.000Z";
const BAR_C: string = "2026-09-28T10:02:00.000Z";
const X_A: number = 100;
const X_B: number = 140;
const X_C: number = 170;

/*
 * A bar of the chart's NEW data. When the refetched buckets land under a
 * press, recharts hands the handlers whichever bar now sits at the
 * pointer's tooltip index: at A's spot, this one.
 */
const LANDED_BAR: string = "2026-09-28T10:04:05.000Z";

// The instant `index` one-minute bars after `from`.
function minuteBarAfter(from: string, index: number): string {
  return new Date(Date.parse(from) + index * MINUTE_MS).toISOString();
}

/*
 * A chart of thirty bars, 10:00 to 10:29, pressed far right, on 10:25 (the
 * 26th bar, index 25) at X_LATE - and 10:26 just right of it.
 */
const HALF_HOUR_FROM: string = "2026-09-28T10:00:00.000Z";
const LATE_BAR: string = minuteBarAfter(HALF_HOUR_FROM, 25);
const BAR_AFTER_LATE_BAR: string = minuteBarAfter(HALF_HOUR_FROM, 26);
const X_LATE: number = 500;

/*
 * A refetch of only ten bars, 11:00 to 11:09, landing under that press.
 * recharts keeps the index the pointer last hovered, and one past the end
 * of shorter data it clamps onto the LAST bar: the release of a press that
 * never moved reports 11:09 at index 9. Had the pointer moved - or Chrome
 * made up a move at the same spot, as it does when the page under a still
 * pointer changes - recharts would hit-test the new bars instead and report
 * the one under the pointer, 11:08. Either way the index changed as it
 * does when a hand's drift crosses a bar's edge.
 */
const REFETCH_FROM: string = "2026-09-28T11:00:00.000Z";
const REFETCH_LAST_BAR: string = minuteBarAfter(REFETCH_FROM, 9);
const REFETCH_BAR_UNDER_POINTER: string = minuteBarAfter(REFETCH_FROM, 8);

/*
 * Where on the axis recharts reports each bar (`activeTooltipIndex`, a
 * string in recharts 3). It works the index out again only when the
 * pointer moves, so bars landing under a still pointer keep the pressed
 * spot's index: the landed bar sits at A's.
 */
const AXIS_INDEX: Record<string, string> = {
  [BAR_A]: "0",
  [BAR_B]: "1",
  [BAR_C]: "2",
  [LANDED_BAR]: "0",
  [LATE_BAR]: "25",
  [BAR_AFTER_LATE_BAR]: "26",
  [REFETCH_BAR_UNDER_POINTER]: "8",
  [REFETCH_LAST_BAR]: "9",
};

// No selection band on the chart.
const NO_BAND: [null, null] = [null, null];

interface Harness {
  // The hook as the host last rendered it.
  result: { current: HistogramRangeSelectionState };
  rerender: (options: HistogramRangeSelectionOptions) => void;
  unmount: () => void;
  onTimeRangeSelect: MockFunction;
  // Handed to the hook only on a zoomed chart.
  onZoomOut: MockFunction;
  // How many times the host has rendered the hook so far.
  renderCount: () => number;
}

/*
 * A host histogram with one-minute bars. A zoomed one shows a window a
 * drag zoomed into, and so offers a way back out: `onZoomOut`.
 */
function renderSelection(isZoomed: boolean): Harness {
  const onTimeRangeSelect: MockFunction = getJestMockFunction();
  const onZoomOut: MockFunction = getJestMockFunction();
  const renders: { count: number } = { count: 0 };
  const initialProps: HistogramRangeSelectionOptions = {
    onTimeRangeSelect: onTimeRangeSelect,
    onZoomOut: isZoomed ? onZoomOut : undefined,
    bucketIntervalMs: MINUTE_MS,
  };

  const hook: RenderHookResult<
    HistogramRangeSelectionState,
    HistogramRangeSelectionOptions
  > = renderHook(
    (options: HistogramRangeSelectionOptions): HistogramRangeSelectionState => {
      renders.count += 1;
      return useHistogramRangeSelection(options);
    },
    { initialProps: initialProps },
  );

  return {
    result: hook.result,
    rerender: (options: HistogramRangeSelectionOptions): void => {
      hook.rerender(options);
    },
    unmount: hook.unmount,
    onTimeRangeSelect: onTimeRangeSelect,
    onZoomOut: onZoomOut,
    renderCount: (): number => {
      return renders.count;
    },
  };
}

type PointerHandler = (
  state?: HistogramPointerState | null,
  event?: ChartPointerEvent | null,
) => void;

/*
 * Calls a chart-root handler as recharts does: with the bar under the
 * pointer (none when `label` is undefined) and its place on the axis, and
 * the React event. With no `event` at all it gets the bar alone, as from
 * a host that hands none.
 */
function send(
  handler: PointerHandler,
  label: string | undefined,
  event?: ChartPointerEvent | null,
): void {
  act(() => {
    const state: HistogramPointerState =
      label === undefined
        ? { activeLabel: undefined }
        : { activeLabel: label, activeTooltipIndex: AXIS_INDEX[label] };
    if (event === undefined) {
      handler(state);
    } else {
      handler(state, event);
    }
  });
}

function press(
  harness: Harness,
  label: string | undefined,
  event?: ChartPointerEvent | null,
): void {
  send(harness.result.current.onMouseDown, label, event);
}

function move(
  harness: Harness,
  label: string | undefined,
  event?: ChartPointerEvent | null,
): void {
  send(harness.result.current.onMouseMove, label, event);
}

function release(
  harness: Harness,
  label: string | undefined,
  event?: ChartPointerEvent | null,
): void {
  send(harness.result.current.onMouseUp, label, event);
}

// The browser's dblclick, which the host hands to the hook.
function dblclick(harness: Harness): void {
  act(() => {
    harness.result.current.onDoubleClick();
  });
}

type PlaceholderPressEvent = Parameters<
  HistogramPlaceholderProps["onMouseDown"]
>[0];

/*
 * A press on a box standing in for the chart - its loader, its empty box -
 * which the host spreads placeholderProps onto. React hands it the event;
 * the click count and the button are all the hook reads of it.
 */
function pressPlaceholder(harness: Harness, event: ChartPointerEvent): void {
  act(() => {
    harness.result.current.placeholderProps.onMouseDown(
      event as unknown as PlaceholderPressEvent,
    );
  });
}

/*
 * The main button going down or coming up at `clientX`. `clicks` is the
 * browser's click count (MouseEvent.detail): 2 on both halves of a
 * double-click's second click.
 */
function mainButton(clientX: number, clicks: number): ChartPointerEvent {
  return { clientX: clientX, detail: clicks, button: 0 };
}

// The pointer moving to `clientX` with the button held. A move counts no clicks.
function pointerAt(clientX: number): ChartPointerEvent {
  return { clientX: clientX, detail: 0, button: 0 };
}

/*
 * The main button coming up away from the chart, where only the page hears
 * it: the native event carries the click count and where the pointer is
 * (clientX 0, left of every bar, unless said), but no bar.
 */
function releaseOnThePage(clicks: number, clientX: number = 0): void {
  fireEvent.mouseUp(document.body, {
    button: 0,
    detail: clicks,
    clientX: clientX,
  });
}

/*
 * Another button than the main one going down or coming up at `clientX`:
 * 1 is the middle button, 2 the right one.
 */
function otherButton(
  button: number,
  clientX: number,
  clicks: number,
): ChartPointerEvent {
  return { clientX: clientX, detail: clicks, button: button };
}

/*
 * The page-wide mouseup listeners a press adds to hear its release off the
 * chart, and the ones taken away again.
 */
interface PageListenerSpies {
  add: SpyInstance<Window["addEventListener"]>;
  remove: SpyInstance<Window["removeEventListener"]>;
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

// The mouseup listeners the page still has: added and not yet taken away.
function pageListenersLeft(spies: PageListenerSpies): Array<unknown> {
  const removed: Array<unknown> = mouseUpListeners(spies.remove.mock.calls);

  return mouseUpListeners(spies.add.mock.calls).filter(
    (added: unknown): boolean => {
      return !removed.includes(added);
    },
  );
}

// The host re-rendering the chart with its zoom gone: no onZoomOut on offer.
function endZoomAnotherWay(harness: Harness): void {
  harness.rerender({
    onTimeRangeSelect: harness.onTimeRangeSelect,
    onZoomOut: undefined,
    bucketIntervalMs: MINUTE_MS,
  });
}

/*
 * A double-click's first click on bar A, and its second press there: what
 * the browser sends up to the second release.
 */
function clickAThenPressAgain(harness: Harness): void {
  press(harness, BAR_A, mainButton(X_A, 1));
  release(harness, BAR_A, mainButton(X_A, 1));
  press(harness, BAR_A, mainButton(X_A, 2));
}

function letTimePass(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

// The first and last bar the selection band spans.
function band(harness: Harness): [string | null, string | null] {
  return [
    harness.result.current.selectionStart,
    harness.result.current.selectionEnd,
  ];
}

// The window a selection from bar `first` through bar `last` zooms into.
function windowOf(first: string, last: string): [string, string] {
  return [first, new Date(Date.parse(last) + MINUTE_MS).toISOString()];
}

function selections(onTimeRangeSelect: MockFunction): Array<[string, string]> {
  return onTimeRangeSelect.mock.calls.map(
    (call: Array<unknown>): [string, string] => {
      return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
    },
  );
}

interface ChartUnderTest {
  name: string;
  isZoomed: boolean;
}

const CHARTS: Array<ChartUnderTest> = [
  { name: "an unzoomed chart", isZoomed: false },
  { name: "a zoomed chart", isZoomed: true },
];

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a double-click on a zoomed chart", () => {
  test("the second press cancels the first click's zoom-in the moment it lands, renders nothing, and leaves the zoom-out to its release", () => {
    const harness: Harness = renderSelection(true);

    // The first click lights its bar while its zoom-in waits.
    press(harness, BAR_A, mainButton(X_A, 1));
    release(harness, BAR_A, mainButton(X_A, 1));
    expect(band(harness)).toEqual([BAR_A, BAR_A]);
    expect(jest.getTimerCount()).toBe(1);

    /*
     * The second press may land on that band: a render now could take
     * the node away, and the browser's click and dblclick with it.
     */
    const rendersBefore: number = harness.renderCount();
    press(harness, BAR_A, mainButton(X_A, 2));

    expect(jest.getTimerCount()).toBe(0);
    expect(harness.renderCount()).toBe(rendersBefore);
    expect(band(harness)).toEqual([BAR_A, BAR_A]);
    expect(harness.result.current.isDragging).toBe(false);

    // However long the button is held, nothing zooms in, nor out yet.
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(band(harness)).toEqual([BAR_A, BAR_A]);

    release(harness, BAR_A, mainButton(X_A, 2));
    letTimePass(0);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });

  test("new bars landing under the second press: its release zooms nowhere, and the chart zooms out once, in the next task", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    const rendersBefore: number = harness.renderCount();

    // The new bars land; recharts reports the one now under the pointer.
    release(harness, LANDED_BAR, mainButton(X_A, 2));

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    // The release renders nothing either: the band stays for the zoom-out.
    expect(harness.renderCount()).toBe(rendersBefore);
    expect(band(harness)).toEqual([BAR_A, BAR_A]);
    // Not yet: a dblclick the browser still sends comes first.
    expect(harness.onZoomOut).not.toHaveBeenCalled();

    // None came (its node was re-keyed away), and the next task zooms out.
    letTimePass(0);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(band(harness)).toEqual(NO_BAND);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
  });

  test("the second press starts no selection: a move to another bar while it is held paints nothing, and releasing there zooms out", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    move(harness, BAR_C, pointerAt(X_C));

    expect(harness.result.current.isDragging).toBe(false);
    expect(band(harness)).toEqual([BAR_A, BAR_A]);

    release(harness, BAR_C, mainButton(X_C, 2));
    letTimePass(0);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });

  const SECOND_RELEASES: Array<{
    name: string;
    release: (harness: Harness) => void;
  }> = [
    {
      name: "over the bar it pressed",
      release: (harness: Harness): void => {
        release(harness, BAR_A, mainButton(X_A, 2));
      },
    },
    {
      name: "over a bar of new data that landed under it",
      release: (harness: Harness): void => {
        release(harness, LANDED_BAR, mainButton(X_A, 2));
      },
    },
    {
      name: "off the chart, where only the page hears it",
      release: (): void => {
        releaseOnThePage(2);
      },
    },
  ];

  for (const secondRelease of SECOND_RELEASES) {
    test(`one that keeps its dblclick zooms out exactly once, its second press released ${secondRelease.name}`, () => {
      const harness: Harness = renderSelection(true);

      clickAThenPressAgain(harness);
      secondRelease.release(harness);
      // The browser's dblclick, straight after the release's click.
      dblclick(harness);

      expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
      expect(band(harness)).toEqual(NO_BAND);

      // The zoom-out the release left for the next task stood down.
      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    });
  }

  const DBLCLICK_FATES: Array<{ name: string; arrives: boolean }> = [
    { name: "whether its dblclick is lost", arrives: false },
    { name: "or delivered", arrives: true },
  ];

  for (const dblclickFate of DBLCLICK_FATES) {
    test(`new bars landing under the FIRST press: neither click zooms in, and the double-click zooms out once, ${dblclickFate.name}`, () => {
      const harness: Harness = renderSelection(true);

      press(harness, BAR_A, mainButton(X_A, 1));
      release(harness, LANDED_BAR, mainButton(X_A, 1));

      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(band(harness)).toEqual(NO_BAND);

      press(harness, LANDED_BAR, mainButton(X_A, 2));
      release(harness, LANDED_BAR, mainButton(X_A, 2));
      if (dblclickFate.arrives) {
        dblclick(harness);
      }
      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    });
  }

  test("a second press with no bar under it (the new data has fewer bars) is still the zoom-out", () => {
    const harness: Harness = renderSelection(true);

    press(harness, BAR_A, mainButton(X_A, 1));
    release(harness, BAR_A, mainButton(X_A, 1));
    press(harness, undefined, mainButton(X_A, 2));
    release(harness, undefined, mainButton(X_A, 2));
    letTimePass(0);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(band(harness)).toEqual(NO_BAND);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });

  /*
   * The chart never hears a release off it; the page does, through the
   * listener the press added. That is still the end of the zoom-out press:
   * it zooms out, and the band it kept goes with the zoom.
   */
  test("a second press released off the chart, which only the page hears, is still the zoom-out: once, in the next task, and nothing zooms in", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    releaseOnThePage(2);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(harness.onZoomOut).not.toHaveBeenCalled();

    letTimePass(0);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(band(harness)).toEqual(NO_BAND);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });

  /*
   * A second press whose release the chart never heard must leave nothing
   * armed behind: a later release over the chart that no press on it
   * began (a drag from elsewhere on the page, ending over the chart) is
   * not the end of that press, and must not zoom out at some random later
   * moment.
   */
  test("after a second press released off the chart, a release over it that no press on it began sets nothing off, and a later drag selects as ever", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    releaseOnThePage(2);
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
    const zoomOutsBefore: number = harness.onZoomOut.mock.calls.length;

    release(harness, BAR_B, mainButton(X_B, 1));
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(zoomOutsBefore);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();

    press(harness, BAR_B, mainButton(X_B, 1));
    move(harness, BAR_C, pointerAt(X_C));

    expect(harness.result.current.isDragging).toBe(true);
    expect(band(harness)).toEqual([BAR_B, BAR_C]);

    release(harness, BAR_C, mainButton(X_C, 1));
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_B, BAR_C),
    ]);
    expect(harness.onZoomOut).toHaveBeenCalledTimes(zoomOutsBefore);
  });

  /*
   * The window can lose a release altogether (it lost focus mid-press).
   * The next press is a new gesture, and the release the page hears at
   * its end is that press's, not the lost one's.
   */
  test("a second press whose release never comes, then a drag let go on the page: the drag selects, and nothing zooms out", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    press(harness, BAR_B, mainButton(X_B, 1));
    move(harness, BAR_C, pointerAt(X_C));

    expect(harness.result.current.isDragging).toBe(true);
    expect(band(harness)).toEqual([BAR_B, BAR_C]);

    releaseOnThePage(1);
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_B, BAR_C),
    ]);
    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(band(harness)).toEqual(NO_BAND);
    expect(harness.result.current.isDragging).toBe(false);
  });

  test("a second press released over the chart, and heard by the page as well, zooms out once", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    release(harness, BAR_A, mainButton(X_A, 2));
    // The same mouseup, bubbling on up to the page.
    releaseOnThePage(2);
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });

  /*
   * The refetch that started all this re-renders the host in between, with
   * a handler that knows the latest window.
   */
  test("the zoom-out calls the onZoomOut of the host's newest render", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    release(harness, LANDED_BAR, mainButton(X_A, 2));

    const newestZoomOut: MockFunction = getJestMockFunction();
    harness.rerender({
      onTimeRangeSelect: harness.onTimeRangeSelect,
      onZoomOut: newestZoomOut,
      bucketIntervalMs: MINUTE_MS,
    });
    letTimePass(0);

    expect(newestZoomOut).toHaveBeenCalledTimes(1);
    expect(harness.onZoomOut).not.toHaveBeenCalled();
  });

  test("a chart unmounted before its zoom-out runs never zooms out", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    release(harness, LANDED_BAR, mainButton(X_A, 2));
    harness.unmount();

    expect(jest.getTimerCount()).toBe(0);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });
});

describe("a press whose bar changes under a still pointer", () => {
  for (const chart of CHARTS) {
    test(`on ${chart.name}, is not a drag, paints nothing and zooms nowhere`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);

      press(harness, BAR_A, mainButton(X_A, 1));
      // The new bars land: recharts reports the one now under the pointer.
      move(harness, LANDED_BAR, pointerAt(X_A));

      expect(harness.result.current.isDragging).toBe(false);
      expect(band(harness)).toEqual(NO_BAND);

      // A hand on a mouse is never quite still.
      move(harness, LANDED_BAR, pointerAt(X_A + 2));

      expect(harness.result.current.isDragging).toBe(false);
      expect(band(harness)).toEqual(NO_BAND);

      release(harness, LANDED_BAR, mainButton(X_A + 1, 1));

      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(harness.result.current.isDragging).toBe(false);
      expect(band(harness)).toEqual(NO_BAND);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(harness.onZoomOut).not.toHaveBeenCalled();
    });
  }

  /*
   * Pressed at the very edge of its bar, so a few pixels take the pointer
   * onto the next one.
   */
  const DIRECTIONS: Array<{
    name: string;
    pressedBar: string;
    pressedX: number;
    otherBar: string;
    sign: number;
  }> = [
    {
      name: "rightwards",
      pressedBar: BAR_A,
      pressedX: X_A,
      otherBar: BAR_B,
      sign: 1,
    },
    {
      name: "leftwards",
      pressedBar: BAR_B,
      pressedX: X_B,
      otherBar: BAR_A,
      sign: -1,
    },
  ];

  for (const direction of DIRECTIONS) {
    test(`a pointer moved ${direction.name} by HISTOGRAM_PRESS_STILLNESS_PX has not left its bar; one pixel further, onto another bar, is a drag`, () => {
      const harness: Harness = renderSelection(false);

      press(harness, direction.pressedBar, mainButton(direction.pressedX, 1));
      move(
        harness,
        direction.otherBar,
        pointerAt(
          direction.pressedX + direction.sign * HISTOGRAM_PRESS_STILLNESS_PX,
        ),
      );

      expect(harness.result.current.isDragging).toBe(false);
      expect(band(harness)).toEqual(NO_BAND);

      const draggedX: number =
        direction.pressedX +
        direction.sign * (HISTOGRAM_PRESS_STILLNESS_PX + 1);
      move(harness, direction.otherBar, pointerAt(draggedX));

      expect(harness.result.current.isDragging).toBe(true);
      expect(band(harness)).toEqual([BAR_A, BAR_B]);

      release(harness, direction.otherBar, mainButton(draggedX, 1));

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_B),
      ]);
    });

    /*
     * A trackpad click, or a slightly unsteady mouse, lets go a pixel or
     * two over the neighbour of the bar it pressed. It is still a click on
     * the bar pressed - not dropped as if new data had landed under it,
     * which a first cut of the #4116 fix did.
     */
    for (const chart of CHARTS) {
      test(`on ${chart.name}, a click that drifts ${direction.name} across its bar's edge zooms into the bar it pressed`, () => {
        const harness: Harness = renderSelection(chart.isZoomed);
        const driftedX: number =
          direction.pressedX + direction.sign * HISTOGRAM_PRESS_STILLNESS_PX;

        press(harness, direction.pressedBar, mainButton(direction.pressedX, 1));
        move(harness, direction.otherBar, pointerAt(driftedX));
        release(harness, direction.otherBar, mainButton(driftedX, 1));

        expect(harness.result.current.isDragging).toBe(false);

        letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

        expect(selections(harness.onTimeRangeSelect)).toEqual([
          windowOf(direction.pressedBar, direction.pressedBar),
        ]);
        expect(harness.onZoomOut).not.toHaveBeenCalled();
      });
    }
  }
});

/*
 * A still press on a bar right of where a shorter refetch ends (commit
 * b6ec899df4). recharts clamps the stale index onto the new last bar, so
 * the release reports another index as well as another bar - just what a
 * hand's drift across an edge reports - and the hook took it for one: a
 * click on the pressed bar, which zoomed into 10:25, a bar no longer on the
 * chart. What tells the two apart is the pointer: a drift moves it; new
 * bars land under a pointer that never moved at all, not by a pixel. A move
 * Chrome makes up at the very same spot, when the page under a still
 * pointer changes, does not count as one.
 */
describe("a still press on a bar right of where a shorter refetch ends", () => {
  const BETWEEN_PRESS_AND_RELEASE: Array<{
    name: string;
    between: (harness: Harness) => void;
    // What recharts reports under the pointer at the release.
    releasedOver: string;
  }> = [
    {
      name: "with no move between (recharts clamps its stale index onto the new last bar)",
      between: (): void => {
        // Nothing: the new bars land, and the pointer stays where it is.
      },
      releasedOver: REFETCH_LAST_BAR,
    },
    {
      name: "with a move Chrome makes up at the same spot once the new bars are drawn (recharts hit-tests them)",
      between: (harness: Harness): void => {
        move(harness, REFETCH_BAR_UNDER_POINTER, pointerAt(X_LATE));
      },
      releasedOver: REFETCH_BAR_UNDER_POINTER,
    },
    {
      name: "with a move Chrome makes up at the same spot before the new bars land",
      between: (harness: Harness): void => {
        move(harness, LATE_BAR, pointerAt(X_LATE));
      },
      releasedOver: REFETCH_LAST_BAR,
    },
  ];

  for (const chart of CHARTS) {
    for (const path of BETWEEN_PRESS_AND_RELEASE) {
      test(`on ${chart.name}, ${path.name}: zooms nowhere, paints nothing and leaves nothing waiting`, () => {
        const harness: Harness = renderSelection(chart.isZoomed);

        press(harness, LATE_BAR, mainButton(X_LATE, 1));
        path.between(harness);

        expect(harness.result.current.isDragging).toBe(false);
        expect(band(harness)).toEqual(NO_BAND);

        release(harness, path.releasedOver, mainButton(X_LATE, 1));

        expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
        expect(band(harness)).toEqual(NO_BAND);
        expect(harness.result.current.isDragging).toBe(false);
        // No click waits out the double-click window to zoom in later.
        expect(jest.getTimerCount()).toBe(0);

        letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

        expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
        expect(harness.onZoomOut).not.toHaveBeenCalled();
        expect(band(harness)).toEqual(NO_BAND);
      });
    }

    /*
     * The same chart, the same bars, but the pointer really moved: two
     * pixels right, over the next bar. A hand's drift - the index moves
     * with it, as with the clamp - and still a click on the bar pressed.
     */
    test(`on ${chart.name}, a real move of 2px across the pressed bar's edge is still a click on the bar it pressed`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);

      press(harness, LATE_BAR, mainButton(X_LATE, 1));
      move(harness, BAR_AFTER_LATE_BAR, pointerAt(X_LATE + 2));

      expect(harness.result.current.isDragging).toBe(false);
      expect(band(harness)).toEqual(NO_BAND);

      release(harness, BAR_AFTER_LATE_BAR, mainButton(X_LATE + 2, 1));
      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(LATE_BAR, LATE_BAR),
      ]);
      expect(harness.onZoomOut).not.toHaveBeenCalled();
      expect(band(harness)).toEqual(NO_BAND);
    });
  }
});

describe("drags and clicks select what they always did", () => {
  for (const chart of CHARTS) {
    test(`on ${chart.name}, a drag paints its band as it goes and zooms into both end bars whole, at once`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);

      press(harness, BAR_A, mainButton(X_A, 1));
      move(harness, BAR_B, pointerAt(X_B));

      expect(harness.result.current.isDragging).toBe(true);
      expect(band(harness)).toEqual([BAR_A, BAR_B]);

      release(harness, BAR_B, mainButton(X_B, 1));

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_B),
      ]);
      expect(harness.result.current.isDragging).toBe(false);
      expect(band(harness)).toEqual(NO_BAND);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).toHaveBeenCalledTimes(1);
      expect(harness.onZoomOut).not.toHaveBeenCalled();
    });

    test(`on ${chart.name}, the same drag right to left paints its band in time order and zooms into the same window`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);

      press(harness, BAR_B, mainButton(X_B, 1));
      move(harness, BAR_A, pointerAt(X_A));

      expect(harness.result.current.isDragging).toBe(true);
      expect(band(harness)).toEqual([BAR_A, BAR_B]);

      release(harness, BAR_A, mainButton(X_A, 1));

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_B),
      ]);
    });

    test(`on ${chart.name}, a flick released over another bar before any of its moves came in is a drag to that bar`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);

      press(harness, BAR_A, mainButton(X_A, 1));
      release(harness, BAR_C, mainButton(X_C, 1));

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_C),
      ]);
      expect(band(harness)).toEqual(NO_BAND);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).toHaveBeenCalledTimes(1);
      expect(harness.onZoomOut).not.toHaveBeenCalled();
    });
  }

  test("on an unzoomed chart, a still click zooms into its bar at once", () => {
    const harness: Harness = renderSelection(false);

    press(harness, BAR_A, mainButton(X_A, 1));
    release(harness, BAR_A, mainButton(X_A, 1));

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_A, BAR_A),
    ]);
    expect(band(harness)).toEqual(NO_BAND);
  });

  test("on a zoomed chart, a still click zooms into its bar only once the double-click window has passed, the bar lit meanwhile", () => {
    const harness: Harness = renderSelection(true);

    press(harness, BAR_A, mainButton(X_A, 1));
    release(harness, BAR_A, mainButton(X_A, 1));

    expect(band(harness)).toEqual([BAR_A, BAR_A]);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS - 1);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();

    letTimePass(1);

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_A, BAR_A),
    ]);
    expect(band(harness)).toEqual(NO_BAND);
    expect(harness.onZoomOut).not.toHaveBeenCalled();
  });
});

const EVENTLESS_HOSTS: Array<{
  name: string;
  event: null | undefined;
}> = [
  { name: "no event at all", event: undefined },
  { name: "a null event", event: null },
];

for (const host of EVENTLESS_HOSTS) {
  describe(`a host that hands the handlers ${host.name} keeps the label-only reading`, () => {
    test("a press, a move onto another bar and a release there drag as they always did", () => {
      const harness: Harness = renderSelection(false);

      press(harness, BAR_A, host.event);
      move(harness, BAR_B, host.event);

      expect(harness.result.current.isDragging).toBe(true);
      expect(band(harness)).toEqual([BAR_A, BAR_B]);

      release(harness, BAR_B, host.event);

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_B),
      ]);
      expect(band(harness)).toEqual(NO_BAND);
    });

    test("a press and a release over another bar, with no move between, drag from the one to the other", () => {
      const harness: Harness = renderSelection(false);

      press(harness, BAR_A, host.event);
      release(harness, BAR_B, host.event);

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_B),
      ]);
    });

    test("a press and a release over its own bar zoom into that bar", () => {
      const harness: Harness = renderSelection(false);

      press(harness, BAR_A, host.event);
      release(harness, BAR_A, host.event);

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_A),
      ]);
    });

    test("on a zoomed chart, a double-click zooms out through its dblclick alone, and neither click zooms in", () => {
      const harness: Harness = renderSelection(true);

      press(harness, BAR_A, host.event);
      release(harness, BAR_A, host.event);
      press(harness, BAR_A, host.event);
      release(harness, BAR_A, host.event);

      expect(harness.onZoomOut).not.toHaveBeenCalled();

      dblclick(harness);

      expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
      expect(band(harness)).toEqual(NO_BAND);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    });
  });
}

describe("an unzoomed chart, which offers no zoom-out", () => {
  test("a press the browser counts as a double-click's second is an ordinary press: a still click zooms into its bar at once", () => {
    const harness: Harness = renderSelection(false);

    press(harness, BAR_A, mainButton(X_A, 2));
    release(harness, BAR_A, mainButton(X_A, 2));

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_A, BAR_A),
    ]);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).toHaveBeenCalledTimes(1);
  });

  test("a drag from a press the browser counts as a double-click's second selects as any drag does", () => {
    const harness: Harness = renderSelection(false);

    press(harness, BAR_A, mainButton(X_A, 2));
    move(harness, BAR_B, pointerAt(X_B));

    expect(harness.result.current.isDragging).toBe(true);
    expect(band(harness)).toEqual([BAR_A, BAR_B]);

    release(harness, BAR_B, mainButton(X_B, 2));

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_A, BAR_B),
    ]);
  });

  test("a dblclick with no click waiting does nothing", () => {
    const harness: Harness = renderSelection(false);
    const rendersBefore: number = harness.renderCount();

    dblclick(harness);
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(band(harness)).toEqual(NO_BAND);
    expect(harness.renderCount()).toBe(rendersBefore);
  });
});

/*
 * The window can lose the release of a double-click's second press: it
 * lost focus with the button down. The page-wide listener that press added
 * then hears the next release, which belongs to a later, unrelated click -
 * one the browser counts 1. That release ends the second press, and must
 * not zoom the chart out.
 */
describe("a second press whose own release never comes", () => {
  const LATER_RELEASES: Array<{
    name: string;
    release: (harness: Harness) => void;
  }> = [
    {
      name: "a click elsewhere on the page, which only the page hears",
      release: (): void => {
        releaseOnThePage(1, X_C + 400);
      },
    },
    {
      name: "a press made elsewhere on the page and let go over the chart",
      release: (harness: Harness): void => {
        release(harness, BAR_B, mainButton(X_B, 1));
      },
    },
  ];

  for (const laterRelease of LATER_RELEASES) {
    test(`the release of ${laterRelease.name}, counted 1, ends it without zooming out, and the page stops listening`, () => {
      const harness: Harness = renderSelection(true);
      const pageListeners: PageListenerSpies = spyOnPageListeners();

      clickAThenPressAgain(harness);

      // The second press listens on the page for its release.
      expect(pageListenersLeft(pageListeners)).toHaveLength(1);

      laterRelease.release(harness);

      expect(jest.getTimerCount()).toBe(0);
      expect(pageListenersLeft(pageListeners)).toEqual([]);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onZoomOut).not.toHaveBeenCalled();
      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();

      // Later releases on the page, however counted, set nothing off either.
      releaseOnThePage(1);
      releaseOnThePage(2);
      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onZoomOut).not.toHaveBeenCalled();
      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(pageListenersLeft(pageListeners)).toEqual([]);
    });
  }

  test("after that, a double-click zooms out once, as ever", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);
    releaseOnThePage(1, X_C + 400);
    // The reader carries on for a while before double-clicking the chart.
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).not.toHaveBeenCalled();

    clickAThenPressAgain(harness);
    release(harness, BAR_A, mainButton(X_A, 2));
    letTimePass(0);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });

  /*
   * The second press dropped the first click's zoom-in but kept its band,
   * for the zoom-out to clear. When a later click's release ends that
   * press, no zoom-out is coming, so the band goes then. Before commit
   * b6ec899df4 nothing cleared it: bar A stayed lit, as if about to open,
   * however long one waited, until the next click on the chart replaced
   * it. Same cause as the last test of the next describe.
   */
  for (const laterRelease of LATER_RELEASES) {
    test(`the first click's band, kept for a zoom-out that is not coming, goes when the release of ${laterRelease.name} ends the press`, () => {
      const harness: Harness = renderSelection(true);

      clickAThenPressAgain(harness);

      expect(band(harness)).toEqual([BAR_A, BAR_A]);

      laterRelease.release(harness);

      expect(band(harness)).toEqual(NO_BAND);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(band(harness)).toEqual(NO_BAND);
      expect(harness.onZoomOut).not.toHaveBeenCalled();
      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    });
  }
});

/*
 * A click on a zoomed chart waits out the double-click window before it
 * zooms in. If the zoom ends another way meanwhile - Reset zoom, the time
 * picker, an empty state's own double-click - the host stops offering
 * onZoomOut, and that click must not zoom back into the window the reader
 * has just left, nor leave its bar lit.
 */
describe("a zoom that ends another way while a click on the chart waits", () => {
  test("the click waiting to zoom in is dropped, and its band goes at once", () => {
    const harness: Harness = renderSelection(true);

    press(harness, BAR_A, mainButton(X_A, 1));
    release(harness, BAR_A, mainButton(X_A, 1));

    expect(band(harness)).toEqual([BAR_A, BAR_A]);
    expect(jest.getTimerCount()).toBe(1);

    endZoomAnotherWay(harness);

    expect(band(harness)).toEqual(NO_BAND);
    expect(jest.getTimerCount()).toBe(0);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(band(harness)).toEqual(NO_BAND);
  });

  test("a click after that zooms in at once, as on any unzoomed chart", () => {
    const harness: Harness = renderSelection(true);

    press(harness, BAR_A, mainButton(X_A, 1));
    release(harness, BAR_A, mainButton(X_A, 1));
    endZoomAnotherWay(harness);

    press(harness, BAR_B, mainButton(X_B, 1));
    release(harness, BAR_B, mainButton(X_B, 1));

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_B, BAR_B),
    ]);
    expect(band(harness)).toEqual(NO_BAND);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).toHaveBeenCalledTimes(1);
    expect(harness.onZoomOut).not.toHaveBeenCalled();
  });

  const SECOND_PRESS_ENDINGS: Array<{
    name: string;
    end: (harness: Harness) => void;
  }> = [
    {
      name: "let go over the chart, its dblclick following",
      end: (harness: Harness): void => {
        release(harness, BAR_A, mainButton(X_A, 2));
        dblclick(harness);
      },
    },
    {
      name: "let go over the chart, its dblclick lost",
      end: (harness: Harness): void => {
        release(harness, LANDED_BAR, mainButton(X_A, 2));
      },
    },
    {
      name: "let go off the chart",
      end: (): void => {
        releaseOnThePage(2);
      },
    },
  ];

  for (const ending of SECOND_PRESS_ENDINGS) {
    test(`withdrawn during a double-click's second press, then that press ${ending.name}: nothing zooms in, and nothing zooms out`, () => {
      const harness: Harness = renderSelection(true);

      clickAThenPressAgain(harness);
      endZoomAnotherWay(harness);
      ending.end(harness);
      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(harness.onZoomOut).not.toHaveBeenCalled();
    });
  }

  /*
   * The second press already dropped the first click's zoom-in and kept
   * its band for the zoom-out to clear. Before commit b6ec899df4 the hook
   * cleared the band when onZoomOut went only if a click was still
   * waiting, so this one stayed - through the press's release and every
   * timer, until the next click on the chart: bar A lit, as if about to
   * open, on a chart that had left the zoom. Clearing it at once is safe:
   * with the zoom gone, a dblclick lost to that render has nothing to do.
   */
  test("withdrawn during a double-click's second press, the band that press kept for the zoom-out goes at once", () => {
    const harness: Harness = renderSelection(true);

    clickAThenPressAgain(harness);

    expect(band(harness)).toEqual([BAR_A, BAR_A]);

    endZoomAnotherWay(harness);

    expect(band(harness)).toEqual(NO_BAND);
  });

  /*
   * A drag's band is the reader's selection in progress, not one kept for
   * a zoom-out: it stays, and the drag still selects when let go.
   */
  test("withdrawn in the middle of a drag, the drag keeps its band and still selects when let go", () => {
    const harness: Harness = renderSelection(true);

    press(harness, BAR_A, mainButton(X_A, 1));
    move(harness, BAR_B, pointerAt(X_B));

    expect(band(harness)).toEqual([BAR_A, BAR_B]);

    endZoomAnotherWay(harness);

    expect(band(harness)).toEqual([BAR_A, BAR_B]);
    expect(harness.result.current.isDragging).toBe(true);

    move(harness, BAR_C, pointerAt(X_C));
    release(harness, BAR_C, mainButton(X_C, 1));

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_A, BAR_C),
    ]);
    expect(band(harness)).toEqual(NO_BAND);
    expect(harness.onZoomOut).not.toHaveBeenCalled();
  });
});

describe("only the main button selects: a right-click opens a context menu", () => {
  for (const chart of CHARTS) {
    test(`on ${chart.name}, a right-button press on a bar and its release select nothing, zoom nowhere, and listen for nothing on the page`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);
      const pageListeners: PageListenerSpies = spyOnPageListeners();
      const rendersBefore: number = harness.renderCount();

      press(harness, BAR_A, otherButton(2, X_A, 1));

      expect(mouseUpListeners(pageListeners.add.mock.calls)).toEqual([]);

      release(harness, BAR_A, otherButton(2, X_A, 1));

      expect(band(harness)).toEqual(NO_BAND);
      expect(harness.result.current.isDragging).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      expect(harness.renderCount()).toBe(rendersBefore);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(harness.onZoomOut).not.toHaveBeenCalled();
    });

    test(`on ${chart.name}, a right-button double-click on a bar neither zooms in nor zooms out`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);

      press(harness, BAR_A, otherButton(2, X_A, 1));
      release(harness, BAR_A, otherButton(2, X_A, 1));
      press(harness, BAR_A, otherButton(2, X_A, 2));
      release(harness, BAR_A, otherButton(2, X_A, 2));
      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(harness.onZoomOut).not.toHaveBeenCalled();
      expect(band(harness)).toEqual(NO_BAND);
    });

    test(`on ${chart.name}, a middle-button drag across bars paints no band and selects nothing`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);

      press(harness, BAR_A, otherButton(1, X_A, 1));
      move(harness, BAR_B, pointerAt(X_B));
      move(harness, BAR_C, pointerAt(X_C));

      expect(harness.result.current.isDragging).toBe(false);
      expect(band(harness)).toEqual(NO_BAND);

      release(harness, BAR_C, otherButton(1, X_C, 1));
      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(harness.onZoomOut).not.toHaveBeenCalled();
      expect(band(harness)).toEqual(NO_BAND);
    });
  }
});

/*
 * A press let go off the chart - dragged out past its top or bottom edge,
 * say - is heard only by the page. The page's release has no bar, but it
 * does say where the pointer is, and that decides click or drag as over
 * the chart: a press that stayed put is a click on the bar it pressed.
 */
describe("a press let go off the chart, where only the page hears it", () => {
  const STILL_RELEASES: Array<{ name: string; offsetPx: number }> = [
    { name: "straight above or below where it went down", offsetPx: 0 },
    {
      name: `${HISTOGRAM_PRESS_STILLNESS_PX}px right of where it went down`,
      offsetPx: HISTOGRAM_PRESS_STILLNESS_PX,
    },
    {
      name: `${HISTOGRAM_PRESS_STILLNESS_PX}px left of where it went down`,
      offsetPx: -HISTOGRAM_PRESS_STILLNESS_PX,
    },
  ];

  for (const stillRelease of STILL_RELEASES) {
    test(`on an unzoomed chart, one let go ${stillRelease.name} is a click on the bar it pressed, and zooms into it at once`, () => {
      const harness: Harness = renderSelection(false);

      press(harness, BAR_A, mainButton(X_A, 1));
      releaseOnThePage(1, X_A + stillRelease.offsetPx);

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_A),
      ]);
      expect(band(harness)).toEqual(NO_BAND);
      expect(harness.result.current.isDragging).toBe(false);

      // The press is over: the page's next release is nothing to it.
      releaseOnThePage(1, X_A + stillRelease.offsetPx);
      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).toHaveBeenCalledTimes(1);
    });
  }

  test("on a zoomed chart, one let go straight above or below where it went down waits out the double-click window, its bar lit, then zooms into that bar", () => {
    const harness: Harness = renderSelection(true);

    press(harness, BAR_A, mainButton(X_A, 1));
    releaseOnThePage(1, X_A);

    expect(band(harness)).toEqual([BAR_A, BAR_A]);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS);

    expect(selections(harness.onTimeRangeSelect)).toEqual([
      windowOf(BAR_A, BAR_A),
    ]);
    expect(band(harness)).toEqual(NO_BAND);
    expect(harness.onZoomOut).not.toHaveBeenCalled();
  });

  for (const chart of CHARTS) {
    test(`on ${chart.name}, one let go far away after crossing bars is a drag to the last bar it crossed, as before`, () => {
      const harness: Harness = renderSelection(chart.isZoomed);

      press(harness, BAR_A, mainButton(X_A, 1));
      move(harness, BAR_B, pointerAt(X_B));
      move(harness, BAR_C, pointerAt(X_C));

      expect(harness.result.current.isDragging).toBe(true);
      expect(band(harness)).toEqual([BAR_A, BAR_C]);

      releaseOnThePage(1, X_C + 400);

      expect(selections(harness.onTimeRangeSelect)).toEqual([
        windowOf(BAR_A, BAR_C),
      ]);
      expect(band(harness)).toEqual(NO_BAND);
      expect(harness.result.current.isDragging).toBe(false);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onTimeRangeSelect).toHaveBeenCalledTimes(1);
      expect(harness.onZoomOut).not.toHaveBeenCalled();
    });
  }
});

/*
 * A box standing in for the chart - its loader while a window loads, its
 * empty box when the window holds nothing - takes the double-click as the
 * chart does, through placeholderProps (commit b6ec899df4). Right after a
 * zoom the chart replaces its loader at any moment, a double-click in
 * progress included, and then the browser sends no dblclick: the node the
 * second press went down on is gone. So the box's own second press is the
 * zoom-out's press, and its release - over the chart that took the box's
 * place, whose handler hands the hook a bar of the new data, or anywhere
 * on the page - zooms out in the next task, as a second press on the
 * chart's own bars does.
 */
describe("a press on the box standing in for the chart (placeholderProps)", () => {
  const RELEASES_AFTER_THE_SWAP: Array<{
    name: string;
    release: (harness: Harness) => void;
  }> = [
    {
      name: "over the chart that took the box's place",
      release: (harness: Harness): void => {
        release(harness, BAR_B, mainButton(X_B, 2));
      },
    },
    {
      name: "anywhere on the page",
      release: (): void => {
        releaseOnThePage(2, X_B);
      },
    },
  ];

  for (const releaseAfterTheSwap of RELEASES_AFTER_THE_SWAP) {
    test(`on a zoomed chart, the second press of a double-click on the box, let go ${releaseAfterTheSwap.name}, zooms out once, in the next task, with no dblclick`, () => {
      const harness: Harness = renderSelection(true);
      const pageListeners: PageListenerSpies = spyOnPageListeners();

      // The first click: nothing to it, and nothing listened for.
      pressPlaceholder(harness, mainButton(X_B, 1));

      expect(mouseUpListeners(pageListeners.add.mock.calls)).toEqual([]);

      // The second press listens on the page for its release.
      pressPlaceholder(harness, mainButton(X_B, 2));

      expect(pageListenersLeft(pageListeners)).toHaveLength(1);

      // The chart has replaced the box by the release.
      releaseAfterTheSwap.release(harness);

      // Not yet: a dblclick the browser still sends would come first.
      expect(harness.onZoomOut).not.toHaveBeenCalled();
      expect(pageListenersLeft(pageListeners)).toEqual([]);

      letTimePass(0);

      expect(harness.onZoomOut).toHaveBeenCalledTimes(1);

      letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

      expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
      expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
      expect(band(harness)).toEqual(NO_BAND);
    });
  }

  test("on a zoomed chart, the same double-click with its dblclick delivered after all zooms out exactly once", () => {
    const harness: Harness = renderSelection(true);

    pressPlaceholder(harness, mainButton(X_B, 1));
    pressPlaceholder(harness, mainButton(X_B, 2));
    release(harness, BAR_B, mainButton(X_B, 2));
    // The browser's dblclick, straight after the release's click.
    dblclick(harness);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);

    // The zoom-out the release left for the next task stood down.
    letTimePass(0);
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });

  test("on a zoomed chart, a double-click wholly on the box, its dblclick through placeholderProps, zooms out exactly once", () => {
    const harness: Harness = renderSelection(true);

    pressPlaceholder(harness, mainButton(X_B, 1));
    releaseOnThePage(1, X_B);
    pressPlaceholder(harness, mainButton(X_B, 2));
    // The box is no chart: only the page hears its release.
    releaseOnThePage(2, X_B);
    act(() => {
      harness.result.current.placeholderProps.onDoubleClick();
    });

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
  });

  /*
   * A click on a bar was waiting out the double-click window when the
   * chart went and the box came (a refetch that clears the bars first):
   * the box's second press drops it, as the chart's own would have.
   */
  test("on a zoomed chart, a click on a bar still waiting to zoom in when the box took the chart's place: the box's second press drops it, and its release zooms out once", () => {
    const harness: Harness = renderSelection(true);

    press(harness, BAR_A, mainButton(X_A, 1));
    release(harness, BAR_A, mainButton(X_A, 1));

    expect(jest.getTimerCount()).toBe(1);

    pressPlaceholder(harness, mainButton(X_A, 2));

    expect(jest.getTimerCount()).toBe(0);

    releaseOnThePage(2, X_A);
    letTimePass(0);

    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
    expect(band(harness)).toEqual(NO_BAND);

    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(harness.onZoomOut).toHaveBeenCalledTimes(1);
  });

  test("on an unzoomed chart, which offers no zoom-out, the same second press is nothing: it listens for nothing, and its release over the chart selects nothing", () => {
    const harness: Harness = renderSelection(false);
    const pageListeners: PageListenerSpies = spyOnPageListeners();

    pressPlaceholder(harness, mainButton(X_B, 1));
    pressPlaceholder(harness, mainButton(X_B, 2));

    expect(mouseUpListeners(pageListeners.add.mock.calls)).toEqual([]);

    release(harness, BAR_B, mainButton(X_B, 2));
    releaseOnThePage(2, X_B);
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(band(harness)).toEqual(NO_BAND);
    expect(pageListenersLeft(pageListeners)).toEqual([]);
  });

  test("on a zoomed chart, a press on the box counted 1 is nothing: it listens for nothing, and no release after it sets anything off", () => {
    const harness: Harness = renderSelection(true);
    const pageListeners: PageListenerSpies = spyOnPageListeners();

    pressPlaceholder(harness, mainButton(X_B, 1));

    expect(mouseUpListeners(pageListeners.add.mock.calls)).toEqual([]);

    release(harness, BAR_B, mainButton(X_B, 1));
    releaseOnThePage(1, X_B);
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(band(harness)).toEqual(NO_BAND);
    expect(pageListenersLeft(pageListeners)).toEqual([]);
  });

  test("on a zoomed chart, a right-button second press on the box is nothing: it listens for nothing, and its release zooms nothing out", () => {
    const harness: Harness = renderSelection(true);
    const pageListeners: PageListenerSpies = spyOnPageListeners();

    pressPlaceholder(harness, otherButton(2, X_B, 1));
    pressPlaceholder(harness, otherButton(2, X_B, 2));

    expect(mouseUpListeners(pageListeners.add.mock.calls)).toEqual([]);

    release(harness, BAR_B, otherButton(2, X_B, 2));
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(pageListenersLeft(pageListeners)).toEqual([]);
  });

  test("on a zoomed chart whose zoom ends another way during the box's second press, its release zooms nothing out and leaves nothing listening", () => {
    const harness: Harness = renderSelection(true);
    const pageListeners: PageListenerSpies = spyOnPageListeners();

    pressPlaceholder(harness, mainButton(X_B, 1));
    pressPlaceholder(harness, mainButton(X_B, 2));
    endZoomAnotherWay(harness);
    releaseOnThePage(2, X_B);
    letTimePass(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);

    expect(harness.onZoomOut).not.toHaveBeenCalled();
    expect(harness.onTimeRangeSelect).not.toHaveBeenCalled();
    expect(pageListenersLeft(pageListeners)).toEqual([]);
  });
});
