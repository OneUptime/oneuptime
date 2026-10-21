import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import useTimeRangeZoom, {
  TimeRangeZoom,
} from "../../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRangeZoomUtil from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../../../MockType";

/*
 * Issue #4105. A page owns its time range (component state, the URL, a
 * saved view); useTimeRangeZoom layers drag-to-zoom and double-click-to-reset
 * on top of it without taking that ownership away. These tests drive the
 * hook through a real host component that keeps the range in its own state,
 * the way the resource overview pages do.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

const ROLLING_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const ROLLING_DAY: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
};

// An edge as an ISO string: a range handed back by a URL carries strings.
function isoOf(value: Date | string | undefined): string {
  return value ? new Date(value).toISOString() : "";
}

const RangeReadout: FunctionComponent<{
  range: RangeStartAndEndDateTime;
  zoom: TimeRangeZoom;
}> = (props: {
  range: RangeStartAndEndDateTime;
  zoom: TimeRangeZoom;
}): ReactElement => {
  return (
    <div>
      <span data-testid="range">{props.range.range}</span>
      <span data-testid="start">
        {isoOf(props.range.startAndEndDate?.startValue)}
      </span>
      <span data-testid="end">
        {isoOf(props.range.startAndEndDate?.endValue)}
      </span>
      <span data-testid="is-zoomed">{String(props.zoom.isZoomed)}</span>
      <span data-testid="before-zoom">
        {props.zoom.rangeBeforeZoom ? props.zoom.rangeBeforeZoom.range : "none"}
      </span>
      <span data-testid="before-zoom-start">
        {isoOf(props.zoom.rangeBeforeZoom?.startAndEndDate?.startValue)}
      </span>
      <span data-testid="before-zoom-end">
        {isoOf(props.zoom.rangeBeforeZoom?.startAndEndDate?.endValue)}
      </span>
    </div>
  );
};

let latestZoom: TimeRangeZoom | null = null;
let latestSetRange: ((range: RangeStartAndEndDateTime) => void) | null = null;
// Re-renders the host with its range re-stated in a new, equal object.
let latestRestateRange: (() => void) | null = null;
const onRangeChangeSpy: MockFunction = getJestMockFunction();
const zoomCallbacks: Array<unknown> = [];
const resetCallbacks: Array<unknown> = [];

interface HostProps {
  initial?: RangeStartAndEndDateTime;
  /*
   * Hand the hook a new range object on every render, as a page that
   * derives its range from other state does (the metric explorer builds it
   * from its view data on each render).
   */
  derivesRangeEachRender?: boolean | undefined;
}

const Host: FunctionComponent<HostProps> = (props: HostProps): ReactElement => {
  const [range, setRange] = useState<RangeStartAndEndDateTime>(
    props.initial || ROLLING_HOUR,
  );

  const zoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: props.derivesRangeEachRender ? restated(range) : range,
    onTimeRangeChange: (next: RangeStartAndEndDateTime): void => {
      onRangeChangeSpy(next);
      setRange(next);
    },
  });

  latestZoom = zoom;
  latestSetRange = setRange;
  latestRestateRange = (): void => {
    setRange((current: RangeStartAndEndDateTime): RangeStartAndEndDateTime => {
      return restated(current);
    });
  };
  zoomCallbacks.push(zoom.zoomToTimeRange);
  resetCallbacks.push(zoom.resetZoom);

  return <RangeReadout range={range} zoom={zoom} />;
};

function zoomApi(): TimeRangeZoom {
  if (!latestZoom) {
    throw new Error("host has not rendered");
  }
  return latestZoom;
}

function read(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

function zoomTo(startIso: string, endIso: string): void {
  act(() => {
    zoomApi().zoomToTimeRange(new Date(startIso), new Date(endIso));
  });
}

function custom(startIso: string, endIso: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  };
}

/*
 * A custom range the way a URL or a saved view hands it back after a JSON
 * round trip: the same instants, as ISO strings, in new objects.
 */
function restoredCustom(
  startIso: string,
  endIso: string,
): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: {
      startValue: startIso,
      endValue: endIso,
    } as unknown as InBetween<Date>,
  };
}

// The same range, value for value, in new objects.
function restated(range: RangeStartAndEndDateTime): RangeStartAndEndDateTime {
  if (!range.startAndEndDate) {
    return { range: range.range };
  }

  return {
    range: range.range,
    startAndEndDate: new InBetween<Date>(
      new Date(range.startAndEndDate.startValue),
      new Date(range.startAndEndDate.endValue),
    ),
  };
}

function setPageRange(range: RangeStartAndEndDateTime): void {
  act(() => {
    latestSetRange?.(range);
  });
}

function reset(): void {
  act(() => {
    zoomApi().resetZoom();
  });
}

function restatePageRangeOnce(): void {
  act(() => {
    latestRestateRange?.();
  });
}

// Re-render the page that many times, its range re-stated in new objects.
function restatePageRange(times: number): void {
  for (let index: number = 0; index < times; index++) {
    restatePageRangeOnce();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  latestZoom = null;
  latestSetRange = null;
  latestRestateRange = null;
  onRangeChangeSpy.mockReset();
  zoomCallbacks.length = 0;
  resetCallbacks.length = 0;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("useTimeRangeZoom", () => {
  test("starts unzoomed on the page's own range", () => {
    render(<Host />);

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
    expect(read("before-zoom")).toBe("none");
    expect(onRangeChangeSpy).not.toHaveBeenCalled();
  });

  test("a drag moves the page onto the window dragged out", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");

    expect(read("range")).toBe(TimeRange.CUSTOM);
    expect(read("start")).toBe("2026-09-28T11:10:00.000Z");
    expect(read("end")).toBe("2026-09-28T11:25:00.000Z");
    expect(read("is-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(onRangeChangeSpy).toHaveBeenCalledTimes(1);
  });

  test("a reset puts the page back on the range it had before the zoom", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("start")).toBe("");
    expect(read("is-zoomed")).toBe("false");
    expect(read("before-zoom")).toBe("none");
    expect(onRangeChangeSpy).toHaveBeenLastCalledWith(ROLLING_HOUR);
  });

  test("zooming again keeps the ORIGINAL range, so one reset climbs all the way out", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:00:00.000Z", "2026-09-28T11:30:00.000Z");
    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:15:00.000Z");
    zoomTo("2026-09-28T11:11:00.000Z", "2026-09-28T11:12:00.000Z");

    expect(read("start")).toBe("2026-09-28T11:11:00.000Z");
    expect(read("end")).toBe("2026-09-28T11:12:00.000Z");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
  });

  test("a custom range the page started on is what a reset returns to", () => {
    const start: RangeStartAndEndDateTime = custom(
      "2026-09-20T00:00:00.000Z",
      "2026-09-21T00:00:00.000Z",
    );
    render(<Host initial={start} />);

    zoomTo("2026-09-20T09:00:00.000Z", "2026-09-20T10:00:00.000Z");
    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("start")).toBe("2026-09-20T00:00:00.000Z");
    expect(read("end")).toBe("2026-09-21T00:00:00.000Z");
    expect(read("is-zoomed")).toBe("false");
  });

  test("resetting a page that is not zoomed does nothing at all", () => {
    render(<Host />);

    act(() => {
      zoomApi().resetZoom();
    });

    expect(onRangeChangeSpy).not.toHaveBeenCalled();
    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a second reset after the first does nothing", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      zoomApi().resetZoom();
    });
    act(() => {
      zoomApi().resetZoom();
    });

    expect(onRangeChangeSpy).toHaveBeenCalledTimes(2);
  });

  test("a zero-width selection neither zooms nor spends a refetch", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:10:00.000Z");

    expect(onRangeChangeSpy).not.toHaveBeenCalled();
    expect(read("is-zoomed")).toBe("false");
  });

  test("a zoom out of a rolling range stops at now", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:55:00.000Z", "2026-09-28T12:01:00.000Z");

    expect(read("end")).toBe(NOW.toISOString());
  });

  test("picking a range elsewhere (the time picker) ends the zoom", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      latestSetRange?.(ROLLING_DAY);
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_DAY);
    expect(read("is-zoomed")).toBe("false");

    // And a reset now must not drag the page back to the old hour.
    onRangeChangeSpy.mockReset();
    act(() => {
      zoomApi().resetZoom();
    });
    expect(onRangeChangeSpy).not.toHaveBeenCalled();
    expect(read("range")).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("a new zoom after the picker moved on remembers the NEW starting point", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      latestSetRange?.(ROLLING_DAY);
    });
    zoomTo("2026-09-28T02:00:00.000Z", "2026-09-28T03:00:00.000Z");

    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_DAY);

    act(() => {
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("the page re-stating the zoomed window in a new object keeps the zoom", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    // e.g. a round trip through the URL: equal instants, new objects.
    act(() => {
      latestSetRange?.(
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
      );
    });

    expect(read("is-zoomed")).toBe("true");
    act(() => {
      zoomApi().resetZoom();
    });
    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("picking a custom range by hand is a new starting point, not a zoom", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    act(() => {
      latestSetRange?.(
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:26:00.000Z"),
      );
    });

    expect(read("is-zoomed")).toBe("false");
  });

  test("two gestures before the page re-renders still see each other", () => {
    render(<Host />);

    act(() => {
      zoomApi().zoomToTimeRange(
        new Date("2026-09-28T11:00:00.000Z"),
        new Date("2026-09-28T11:30:00.000Z"),
      );
      zoomApi().zoomToTimeRange(
        new Date("2026-09-28T11:10:00.000Z"),
        new Date("2026-09-28T11:20:00.000Z"),
      );
    });

    expect(read("start")).toBe("2026-09-28T11:10:00.000Z");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    act(() => {
      zoomApi().resetZoom();
      zoomApi().resetZoom();
    });

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    // One zoom, one more zoom, one reset. The second reset had nothing to undo.
    expect(onRangeChangeSpy).toHaveBeenCalledTimes(3);
  });

  test("zoomToTimeRange and resetZoom keep their identity across every render", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");
    zoomTo("2026-09-28T11:12:00.000Z", "2026-09-28T11:20:00.000Z");
    act(() => {
      zoomApi().resetZoom();
    });

    expect(zoomCallbacks.length).toBeGreaterThan(3);
    expect(new Set(zoomCallbacks).size).toBe(1);
    expect(new Set(resetCallbacks).size).toBe(1);
  });

  test("a callback captured before a zoom still acts on the latest range", () => {
    render(<Host />);

    const staleZoom: (startTime: Date, endTime: Date) => void =
      zoomApi().zoomToTimeRange;
    const staleReset: () => void = zoomApi().resetZoom;

    zoomTo("2026-09-28T11:00:00.000Z", "2026-09-28T11:30:00.000Z");
    act(() => {
      staleZoom(
        new Date("2026-09-28T11:05:00.000Z"),
        new Date("2026-09-28T11:10:00.000Z"),
      );
    });

    expect(read("start")).toBe("2026-09-28T11:05:00.000Z");
    // The original hour, not the 30-minute window the stale closure saw.
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    act(() => {
      staleReset();
    });
    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("the zoom it hands the page is exactly the range it reports", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z");

    const handedToPage: RangeStartAndEndDateTime = onRangeChangeSpy.mock
      .calls[0]![0] as RangeStartAndEndDateTime;

    expect(
      TimeRangeZoomUtil.isSameRange(
        handedToPage,
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:25:00.000Z"),
      ),
    ).toBe(true);
  });
});

/*
 * A zoom lasts exactly as long as the page stays on the window it asked for.
 * The page leaving that window (a picker pick, a saved view, the URL) ends
 * the zoom for good: coming back to the very same window later - loading a
 * view saved while zoomed, say - is a new starting point, not the old zoom
 * waking up with a "Reset zoom" that jumps to a range from before it.
 */
describe("useTimeRangeZoom: a zoom the page has moved off is over for good", () => {
  const ZOOM_START: string = "2026-09-28T11:10:00.000Z";
  const ZOOM_END: string = "2026-09-28T11:25:00.000Z";

  // Zoom, save the view, pick another range, then load the saved view.
  function zoomThenLeaveThenComeBack(
    comeBackTo: RangeStartAndEndDateTime,
  ): void {
    zoomTo(ZOOM_START, ZOOM_END);
    expect(read("is-zoomed")).toBe("true");

    setPageRange(ROLLING_DAY);
    expect(read("is-zoomed")).toBe("false");

    setPageRange(comeBackTo);
    expect(read("start")).toBe(ZOOM_START);
    expect(read("end")).toBe(ZOOM_END);
  }

  test("coming back to the exact zoomed window later (a saved view of it) is not a zoom", () => {
    render(<Host />);

    zoomThenLeaveThenComeBack(custom(ZOOM_START, ZOOM_END));

    expect(read("is-zoomed")).toBe("false");
    expect(read("before-zoom")).toBe("none");
    expect(zoomApi().rangeBeforeZoom).toBeNull();
  });

  test("so a double-click there leaves the page on the window it loaded", () => {
    render(<Host />);
    zoomThenLeaveThenComeBack(custom(ZOOM_START, ZOOM_END));
    onRangeChangeSpy.mockReset();

    reset();

    expect(onRangeChangeSpy).not.toHaveBeenCalled();
    expect(read("range")).toBe(TimeRange.CUSTOM);
    expect(read("start")).toBe(ZOOM_START);
    expect(read("end")).toBe(ZOOM_END);
  });

  test("a zoom made in the window the page came back to resets to that window", () => {
    render(<Host />);
    zoomThenLeaveThenComeBack(custom(ZOOM_START, ZOOM_END));

    zoomTo("2026-09-28T11:15:00.000Z", "2026-09-28T11:20:00.000Z");

    expect(read("is-zoomed")).toBe("true");
    // Not "Past 1 Hour", the range from before the abandoned zoom.
    expect(read("before-zoom")).toBe(TimeRange.CUSTOM);
    expect(read("before-zoom-start")).toBe(ZOOM_START);
    expect(read("before-zoom-end")).toBe(ZOOM_END);

    reset();

    expect(read("range")).toBe(TimeRange.CUSTOM);
    expect(read("start")).toBe(ZOOM_START);
    expect(read("end")).toBe(ZOOM_END);
    expect(read("is-zoomed")).toBe("false");
    expect(onRangeChangeSpy).toHaveBeenLastCalledWith(
      custom(ZOOM_START, ZOOM_END),
    );
  });

  test("on a page that builds its range object on every render (the metric explorer), the round trip is the same", () => {
    render(<Host derivesRangeEachRender={true} />);

    zoomThenLeaveThenComeBack(custom(ZOOM_START, ZOOM_END));

    expect(read("is-zoomed")).toBe("false");

    zoomTo("2026-09-28T11:15:00.000Z", "2026-09-28T11:20:00.000Z");
    expect(read("is-zoomed")).toBe("true");
    reset();

    expect(read("start")).toBe(ZOOM_START);
    expect(read("end")).toBe(ZOOM_END);
  });

  test("a window restored with string dates (a JSON round trip) is no different", () => {
    render(<Host />);

    zoomThenLeaveThenComeBack(restoredCustom(ZOOM_START, ZOOM_END));

    expect(read("is-zoomed")).toBe("false");
    expect(read("before-zoom")).toBe("none");
  });

  test("the reader may leave through the range the zoom was made from, too", () => {
    render(<Host />);

    zoomTo(ZOOM_START, ZOOM_END);
    setPageRange(ROLLING_HOUR);
    setPageRange(custom(ZOOM_START, ZOOM_END));

    expect(read("is-zoomed")).toBe("false");

    zoomTo("2026-09-28T11:15:00.000Z", "2026-09-28T11:20:00.000Z");
    reset();

    expect(read("start")).toBe(ZOOM_START);
    expect(read("end")).toBe(ZOOM_END);
  });

  test("after nested zooms, coming back to the inner window does not bring the first baseline back", () => {
    render(<Host />);

    zoomTo("2026-09-28T11:00:00.000Z", "2026-09-28T11:30:00.000Z");
    zoomTo(ZOOM_START, ZOOM_END);
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    setPageRange(ROLLING_DAY);
    setPageRange(custom(ZOOM_START, ZOOM_END));

    expect(read("is-zoomed")).toBe("false");

    zoomTo("2026-09-28T11:12:00.000Z", "2026-09-28T11:13:00.000Z");
    reset();

    expect(read("start")).toBe(ZOOM_START);
    expect(read("end")).toBe(ZOOM_END);
  });

  test("leaving for a moment and coming straight back, one render each, still ends the zoom", () => {
    render(<Host />);

    zoomTo(ZOOM_START, ZOOM_END);
    setPageRange(custom(ZOOM_START, "2026-09-28T11:26:00.000Z"));
    setPageRange(custom(ZOOM_START, ZOOM_END));

    expect(read("is-zoomed")).toBe("false");
    onRangeChangeSpy.mockReset();
    reset();
    expect(onRangeChangeSpy).not.toHaveBeenCalled();
  });

  test("a page that re-states the zoomed window in new objects on every render has not moved", () => {
    render(<Host />);
    zoomTo(ZOOM_START, ZOOM_END);

    restatePageRange(5);

    expect(read("is-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);
    // The re-renders asked for no range of their own.
    expect(onRangeChangeSpy).toHaveBeenCalledTimes(1);

    reset();

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a page that builds a new range object on every render stays zoomed through its re-renders", () => {
    render(<Host derivesRangeEachRender={true} />);
    zoomTo(ZOOM_START, ZOOM_END);

    restatePageRange(5);

    expect(read("is-zoomed")).toBe("true");
    expect(onRangeChangeSpy).toHaveBeenCalledTimes(1);

    reset();

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
  });

  test("a URL round trip that hands the zoomed window back as strings keeps the zoom", () => {
    render(<Host />);
    zoomTo(ZOOM_START, ZOOM_END);

    setPageRange(restoredCustom(ZOOM_START, ZOOM_END));

    expect(read("is-zoomed")).toBe("true");

    reset();

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a rolling range re-stated before a zoom is still the baseline the zoom goes back to", () => {
    render(<Host />);

    restatePageRange(3);
    zoomTo(ZOOM_START, ZOOM_END);

    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    reset();

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("the callbacks keep their identity through a zoom the page moved off", () => {
    render(<Host />);

    zoomTo(ZOOM_START, ZOOM_END);
    setPageRange(ROLLING_DAY);
    setPageRange(custom(ZOOM_START, ZOOM_END));
    zoomTo("2026-09-28T11:15:00.000Z", "2026-09-28T11:20:00.000Z");
    reset();

    expect(new Set(zoomCallbacks).size).toBe(1);
    expect(new Set(resetCallbacks).size).toBe(1);
  });
});

/*
 * A page that applies the range it is handed a render later: its range goes
 * through an effect (a URL, a parent) before it shows. Every render is
 * logged, so a test can tell what the page showed in between.
 */
interface LateHostRender {
  range: string;
  isZoomed: boolean;
}

const lateHostRenders: Array<LateHostRender> = [];

function describeRange(range: RangeStartAndEndDateTime): string {
  if (range.range !== TimeRange.CUSTOM) {
    return range.range;
  }

  return `${isoOf(range.startAndEndDate?.startValue)}/${isoOf(range.startAndEndDate?.endValue)}`;
}

interface LateHostProps {
  appliesRange: boolean;
  /*
   * Hand the hook a new range object on every render, the way a page that
   * derives its range from other state does (MetricView builds its own
   * from its data on each render).
   */
  derivesRangeEachRender?: boolean | undefined;
}

const LateHost: FunctionComponent<LateHostProps> = (
  props: LateHostProps,
): ReactElement => {
  const [range, setRange] = useState<RangeStartAndEndDateTime>(ROLLING_HOUR);
  const [pending, setPending] = useState<RangeStartAndEndDateTime | null>(null);

  useEffect(() => {
    if (pending && props.appliesRange) {
      setRange(pending);
    }
  }, [pending]);

  const zoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: props.derivesRangeEachRender ? restated(range) : range,
    onTimeRangeChange: (next: RangeStartAndEndDateTime): void => {
      onRangeChangeSpy(next);
      setPending(next);
    },
  });

  latestZoom = zoom;
  latestSetRange = setRange;
  lateHostRenders.push({
    range: describeRange(range),
    isZoomed: zoom.isZoomed,
  });

  return <RangeReadout range={range} zoom={zoom} />;
};

describe("useTimeRangeZoom: a page that applies the zoom a render later", () => {
  const ZOOM_START: string = "2026-09-28T11:10:00.000Z";
  const ZOOM_END: string = "2026-09-28T11:25:00.000Z";

  beforeEach(() => {
    lateHostRenders.length = 0;
  });

  test("still ends up zoomed, and offers no reset before it gets there", () => {
    render(<LateHost appliesRange={true} />);
    const rendersBefore: number = lateHostRenders.length;

    zoomTo(ZOOM_START, ZOOM_END);

    expect(read("start")).toBe(ZOOM_START);
    expect(read("is-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    const zoomed: string = describeRange(custom(ZOOM_START, ZOOM_END));
    const rendersAfter: Array<LateHostRender> =
      lateHostRenders.slice(rendersBefore);
    // The page really was late: it rendered on the hour after the drag...
    expect(rendersAfter[0]).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
      isZoomed: false,
    });
    // ...and was zoomed exactly while it showed the zoomed window.
    for (const shown of rendersAfter) {
      expect(shown.isZoomed).toBe(shown.range === zoomed);
    }
    expect(rendersAfter[rendersAfter.length - 1]).toEqual({
      range: zoomed,
      isZoomed: true,
    });
  });

  test("a late page that builds a new range object on every render ends up zoomed too", () => {
    render(<LateHost appliesRange={true} derivesRangeEachRender={true} />);
    const rendersBefore: number = lateHostRenders.length;

    zoomTo(ZOOM_START, ZOOM_END);

    // It rendered on the hour, in a new object, before taking the zoom.
    expect(lateHostRenders[rendersBefore]).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
      isZoomed: false,
    });
    expect(read("start")).toBe(ZOOM_START);
    expect(read("is-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    reset();

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
  });

  test("its reset, also applied a render later, lands on the range from before the zoom", () => {
    render(<LateHost appliesRange={true} />);
    zoomTo(ZOOM_START, ZOOM_END);

    reset();

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");
    expect(onRangeChangeSpy).toHaveBeenLastCalledWith(ROLLING_HOUR);
  });

  test("nested zooms on it keep the first baseline", () => {
    render(<LateHost appliesRange={true} />);

    zoomTo("2026-09-28T11:00:00.000Z", "2026-09-28T11:30:00.000Z");
    zoomTo(ZOOM_START, ZOOM_END);

    expect(read("start")).toBe(ZOOM_START);
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_HOUR);

    reset();

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a page that never applies the zoom never offers a reset; a zoom after a new pick starts from that pick", () => {
    render(<LateHost appliesRange={false} />);

    zoomTo(ZOOM_START, ZOOM_END);

    expect(read("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(read("is-zoomed")).toBe("false");

    setPageRange(ROLLING_DAY);
    zoomTo("2026-09-28T02:00:00.000Z", "2026-09-28T03:00:00.000Z");
    // The page takes this one by other means.
    setPageRange(
      custom("2026-09-28T02:00:00.000Z", "2026-09-28T03:00:00.000Z"),
    );

    expect(read("is-zoomed")).toBe("true");
    expect(read("before-zoom")).toBe(TimeRange.PAST_ONE_DAY);
  });
});
