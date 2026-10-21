import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  TimeRangeZoomProvider,
  TimeRangeZoomScope,
  isTimeRangeZoomFor,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ResetTimeRangeZoomButton, {
  RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
} from "../../../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TelemetryTimeRangePicker, {
  TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX,
} from "../../../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { getTimeRangeButtonLabel } from "../../../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../../../MockType";

/*
 * Issue #4105: a page opts in once (TimeRangeZoomScope) and every time-series
 * chart below it zooms the page, while the page's time picker offers a way
 * back out. This suite covers that plumbing: which handlers a chart ends up
 * with, what the context carries while zoomed and not, and the reset button.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

const pageSelect: (startTime: Date, endTime: Date) => void = (): void => {};
const pageReset: () => void = (): void => {};
const hostSelect: (startTime: Date, endTime: Date) => void = (): void => {};
const hostReset: () => void = (): void => {};

const ZOOMED_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-28T11:10:00.000Z"),
    new Date("2026-09-28T11:25:00.000Z"),
  ),
};

const ZOOMED_PAGE: ChartTimeRangeZoomContextValue = {
  onTimeRangeSelect: pageSelect,
  onTimeRangeReset: pageReset,
  isZoomed: true,
  rangeBeforeZoom: { range: TimeRange.PAST_ONE_HOUR },
  timeRange: ZOOMED_WINDOW,
};

const UNZOOMED_PAGE: ChartTimeRangeZoomContextValue = {
  onTimeRangeSelect: pageSelect,
  onTimeRangeReset: undefined,
  isZoomed: false,
  rangeBeforeZoom: null,
  timeRange: { range: TimeRange.PAST_ONE_HOUR },
};

describe("resolveChartTimeRangeZoom", () => {
  test("a time-series chart with no handlers of its own takes the page's zoom", () => {
    const handlers: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
      isTimeAxis: true,
      pageZoom: ZOOMED_PAGE,
    });

    expect(handlers.onTimeRangeSelect).toBe(pageSelect);
    expect(handlers.onTimeRangeReset).toBe(pageReset);
  });

  test("an unzoomed page offers a drag but no reset", () => {
    const handlers: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
      isTimeAxis: true,
      pageZoom: UNZOOMED_PAGE,
    });

    expect(handlers.onTimeRangeSelect).toBe(pageSelect);
    expect(handlers.onTimeRangeReset).toBeUndefined();
  });

  test("outside a zoomable page a chart gets nothing", () => {
    const handlers: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
      isTimeAxis: true,
      pageZoom: null,
    });

    expect(handlers.onTimeRangeSelect).toBeUndefined();
    expect(handlers.onTimeRangeReset).toBeUndefined();
  });

  test("a chart whose x-axis is not time never takes the page's zoom", () => {
    const handlers: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
      isTimeAxis: false,
      pageZoom: ZOOMED_PAGE,
    });

    expect(handlers.onTimeRangeSelect).toBeUndefined();
    expect(handlers.onTimeRangeReset).toBeUndefined();
  });

  test("the host's own handlers win over the page's", () => {
    const handlers: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
      onTimeRangeSelect: hostSelect,
      onTimeRangeReset: hostReset,
      isTimeAxis: true,
      pageZoom: ZOOMED_PAGE,
    });

    expect(handlers.onTimeRangeSelect).toBe(hostSelect);
    expect(handlers.onTimeRangeReset).toBe(hostReset);
  });

  test("a host that zooms its own way does not borrow the page's reset", () => {
    const handlers: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
      onTimeRangeSelect: hostSelect,
      isTimeAxis: true,
      pageZoom: ZOOMED_PAGE,
    });

    expect(handlers.onTimeRangeSelect).toBe(hostSelect);
    expect(handlers.onTimeRangeReset).toBeUndefined();
  });

  test("a reset-only host does not borrow the page's drag", () => {
    const handlers: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
      onTimeRangeReset: hostReset,
      isTimeAxis: true,
      pageZoom: ZOOMED_PAGE,
    });

    expect(handlers.onTimeRangeSelect).toBeUndefined();
    expect(handlers.onTimeRangeReset).toBe(hostReset);
  });

  test("disableTimeRangeZoom switches every source off", () => {
    expect(
      resolveChartTimeRangeZoom({
        onTimeRangeSelect: hostSelect,
        onTimeRangeReset: hostReset,
        isTimeAxis: true,
        disableTimeRangeZoom: true,
        pageZoom: ZOOMED_PAGE,
      }),
    ).toEqual({ onTimeRangeSelect: undefined, onTimeRangeReset: undefined });

    expect(
      resolveChartTimeRangeZoom({
        isTimeAxis: true,
        disableTimeRangeZoom: true,
        pageZoom: ZOOMED_PAGE,
      }),
    ).toEqual({ onTimeRangeSelect: undefined, onTimeRangeReset: undefined });
  });
});

/*
 * A stand-in for a chart: reads the context the way the chart wrappers do
 * and exposes the gestures as buttons.
 */
let latestContext: ChartTimeRangeZoomContextValue | null = null;

const ContextProbe: FunctionComponent<{ id: string }> = (props: {
  id: string;
}): ReactElement => {
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();
  latestContext = zoom;

  return (
    <div>
      <span data-testid={`${props.id}-has-zoom`}>{String(Boolean(zoom))}</span>
      <span data-testid={`${props.id}-is-zoomed`}>
        {String(Boolean(zoom?.isZoomed))}
      </span>
      <span data-testid={`${props.id}-can-reset`}>
        {String(Boolean(zoom?.onTimeRangeReset))}
      </span>
      <button
        type="button"
        data-testid={`${props.id}-drag`}
        onClick={() => {
          zoom?.onTimeRangeSelect(
            new Date("2026-09-28T11:10:00.000Z"),
            new Date("2026-09-28T11:25:00.000Z"),
          );
        }}
      >
        drag
      </button>
      <button
        type="button"
        data-testid={`${props.id}-double-click`}
        onClick={() => {
          zoom?.onTimeRangeReset?.();
        }}
      >
        double-click
      </button>
    </div>
  );
};

const onPageRangeChange: MockFunction = getJestMockFunction();
let setPageRangeFromOutside:
  | ((range: RangeStartAndEndDateTime) => void)
  | null = null;

const Page: FunctionComponent<{ children?: React.ReactNode }> = (props: {
  children?: React.ReactNode;
}): ReactElement => {
  const [range, setRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });
  setPageRangeFromOutside = setRange;

  return (
    <TimeRangeZoomScope
      timeRange={range}
      onTimeRangeChange={(next: RangeStartAndEndDateTime): void => {
        onPageRangeChange(next);
        setRange(next);
      }}
    >
      <span data-testid="page-range">
        {range.range === TimeRange.CUSTOM
          ? `${range.startAndEndDate?.startValue.toISOString()}/${range.startAndEndDate?.endValue.toISOString()}`
          : range.range}
      </span>
      <TelemetryTimeRangePicker
        value={range}
        onChange={(next: RangeStartAndEndDateTime): void => {
          setRange(next);
        }}
      />
      {props.children}
    </TimeRangeZoomScope>
  );
};

function text(testId: string): string {
  return screen.getByTestId(testId).textContent || "";
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  latestContext = null;
  setPageRangeFromOutside = null;
  onPageRangeChange.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("TimeRangeZoomScope", () => {
  test("every chart in the page sees the same zoom, and a drag in one retimes the page", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
        <ContextProbe id="memory" />
      </Page>,
    );

    expect(text("cpu-has-zoom")).toBe("true");
    expect(text("memory-has-zoom")).toBe("true");
    expect(text("cpu-can-reset")).toBe("false");

    fireEvent.click(screen.getByTestId("cpu-drag"));

    expect(text("page-range")).toBe(
      "2026-09-28T11:10:00.000Z/2026-09-28T11:25:00.000Z",
    );
    // The OTHER chart now offers the way back too.
    expect(text("memory-is-zoomed")).toBe("true");
    expect(text("memory-can-reset")).toBe("true");
  });

  test("a double-click on any chart puts the page back", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
        <ContextProbe id="memory" />
      </Page>,
    );

    fireEvent.click(screen.getByTestId("cpu-drag"));
    fireEvent.click(screen.getByTestId("memory-double-click"));

    expect(text("page-range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(text("cpu-is-zoomed")).toBe("false");
    expect(text("cpu-can-reset")).toBe("false");
  });

  test("the time picker offers Reset zoom only while the page is zoomed", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
      </Page>,
    );

    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("cpu-drag"));

    const reset: HTMLElement = screen.getByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    expect(reset).toHaveAccessibleName("Reset zoom");
    expect(reset).toHaveAttribute(
      "title",
      `Go back to ${TimeRange.PAST_ONE_HOUR}, the time range before the zoom`,
    );

    fireEvent.click(reset);

    expect(text("page-range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("the Reset zoom button is a real, focusable button", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
      </Page>,
    );

    fireEvent.click(screen.getByTestId("cpu-drag"));

    const reset: HTMLElement = screen.getByRole("button", {
      name: "Reset zoom",
    });
    expect(reset.tagName).toBe("BUTTON");
    expect(reset).toHaveAttribute("type", "button");
    reset.focus();
    expect(reset).toHaveFocus();
  });

  test("a range picked outside the charts ends the zoom and hides Reset zoom", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
      </Page>,
    );

    fireEvent.click(screen.getByTestId("cpu-drag"));
    act(() => {
      setPageRangeFromOutside?.({ range: TimeRange.PAST_ONE_DAY });
    });

    expect(text("cpu-is-zoomed")).toBe("false");
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a nested provider with zoom={null} withdraws the page's zoom from its panel", () => {
    render(
      <Page>
        <ContextProbe id="page-chart" />
        <TimeRangeZoomProvider zoom={null}>
          <ContextProbe id="panel-chart" />
        </TimeRangeZoomProvider>
      </Page>,
    );

    expect(text("page-chart-has-zoom")).toBe("true");
    expect(text("panel-chart-has-zoom")).toBe("false");
  });

  test("a nested scope gives its panel its own range, independent of the page", () => {
    const PanelWithOwnRange: FunctionComponent = (): ReactElement => {
      const [range, setRange] = useState<RangeStartAndEndDateTime>({
        range: TimeRange.PAST_ONE_DAY,
      });
      return (
        <TimeRangeZoomScope timeRange={range} onTimeRangeChange={setRange}>
          <span data-testid="panel-range">
            {range.range === TimeRange.CUSTOM ? "custom" : range.range}
          </span>
          <ContextProbe id="panel-chart" />
        </TimeRangeZoomScope>
      );
    };

    render(
      <Page>
        <ContextProbe id="page-chart" />
        <PanelWithOwnRange />
      </Page>,
    );

    fireEvent.click(screen.getByTestId("panel-chart-drag"));

    expect(text("panel-range")).toBe("custom");
    expect(text("page-range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(onPageRangeChange).not.toHaveBeenCalled();
  });

  test("the context value is stable while nothing changes", () => {
    const seen: Array<ChartTimeRangeZoomContextValue | null> = [];
    const Recorder: FunctionComponent = (): ReactElement => {
      seen.push(useChartTimeRangeZoom());
      return <></>;
    };
    const Parent: FunctionComponent = (): ReactElement => {
      const [, setTick] = useState<number>(0);
      const [range, setRange] = useState<RangeStartAndEndDateTime>({
        range: TimeRange.PAST_ONE_HOUR,
      });
      return (
        <TimeRangeZoomScope timeRange={range} onTimeRangeChange={setRange}>
          <button
            type="button"
            data-testid="rerender"
            onClick={() => {
              setTick((tick: number) => {
                return tick + 1;
              });
            }}
          >
            rerender
          </button>
          <Recorder />
        </TimeRangeZoomScope>
      );
    };

    render(<Parent />);
    fireEvent.click(screen.getByTestId("rerender"));
    fireEvent.click(screen.getByTestId("rerender"));

    expect(seen.length).toBe(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });
});

describe("ResetTimeRangeZoomButton", () => {
  test("renders nothing outside a zoomable page", () => {
    const { container } = render(<ResetTimeRangeZoomButton />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing while the page is not zoomed", () => {
    const { container } = render(
      <TimeRangeZoomProvider
        zoom={{
          isZoomed: false,
          rangeBeforeZoom: null,
          zoomToTimeRange: () => {},
          resetZoom: () => {},
        }}
      >
        <ResetTimeRangeZoomButton />
      </TimeRangeZoomProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("names a custom range it would go back to plainly", () => {
    const resetZoom: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={{
          isZoomed: true,
          rangeBeforeZoom: {
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(
              new Date("2026-09-20T00:00:00.000Z"),
              new Date("2026-09-21T00:00:00.000Z"),
            ),
          },
          zoomToTimeRange: () => {},
          resetZoom: resetZoom as unknown as () => void,
        }}
      >
        <ResetTimeRangeZoomButton />
      </TimeRangeZoomProvider>,
    );

    const reset: HTMLElement = screen.getByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    expect(reset).toHaveAttribute(
      "title",
      "Go back to the time range before the zoom",
    );

    fireEvent.click(reset);
    expect(resetZoom).toHaveBeenCalledTimes(1);
  });

  test("the context the page hands down carries what the button reads", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
      </Page>,
    );

    fireEvent.click(screen.getByTestId("cpu-drag"));

    expect(latestContext?.isZoomed).toBe(true);
    expect(latestContext?.rangeBeforeZoom).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
    });
    // And the range the zoom now works over: the page's zoomed window.
    expect(latestContext?.timeRange?.range).toBe(TimeRange.CUSTOM);
    expect(
      latestContext?.timeRange?.startAndEndDate?.startValue.toISOString(),
    ).toBe("2026-09-28T11:10:00.000Z");
  });

  test("with forTimeRange, shows only for a zoom of that range", () => {
    render(
      <TimeRangeZoomProvider
        zoom={{
          isZoomed: true,
          rangeBeforeZoom: { range: TimeRange.PAST_ONE_HOUR },
          timeRange: ZOOMED_WINDOW,
          zoomToTimeRange: () => {},
          resetZoom: () => {},
        }}
      >
        <div data-testid="same-range">
          <ResetTimeRangeZoomButton forTimeRange={ZOOMED_WINDOW} />
        </div>
        <div data-testid="other-range">
          <ResetTimeRangeZoomButton
            forTimeRange={{ range: TimeRange.PAST_ONE_DAY }}
          />
        </div>
      </TimeRangeZoomProvider>,
    );

    expect(screen.getByTestId("same-range")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("other-range")).toBeEmptyDOMElement();
  });

  test("a zoom that does not say its range is taken to be the button's", () => {
    render(
      <TimeRangeZoomProvider
        zoom={{
          isZoomed: true,
          rangeBeforeZoom: { range: TimeRange.PAST_ONE_HOUR },
          zoomToTimeRange: () => {},
          resetZoom: () => {},
        }}
      >
        <ResetTimeRangeZoomButton
          forTimeRange={{ range: TimeRange.PAST_ONE_DAY }}
        />
      </TimeRangeZoomProvider>,
    );

    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });
});

describe("a picker nested in a zoomed page, over a range of its own", () => {
  /*
   * The critic's case: a time-series viewer (its own picker, its own
   * range) rendered inside a page - or an investigation drawer opened from
   * a chart - that is zoomed. Its picker must not offer "Reset zoom", which
   * would reset the page behind it.
   */
  const NestedViewer: FunctionComponent = (): ReactElement => {
    const [range, setRange] = useState<RangeStartAndEndDateTime>({
      range: TimeRange.PAST_ONE_DAY,
    });
    return (
      <div data-testid="nested-viewer">
        <TelemetryTimeRangePicker value={range} onChange={setRange} />
      </div>
    );
  };

  test("only the page's own picker offers the page's reset", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
        <NestedViewer />
      </Page>,
    );

    fireEvent.click(screen.getByTestId("cpu-drag"));

    const resets: Array<HTMLElement> = screen.getAllByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    expect(resets).toHaveLength(1);
    expect(
      screen
        .getByTestId("nested-viewer")
        .querySelector(
          `[data-testid="${RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID}"]`,
        ),
    ).toBeNull();
  });
});

describe("isTimeRangeZoomFor", () => {
  test("no zoom is for no range", () => {
    expect(isTimeRangeZoomFor(null, { range: TimeRange.PAST_ONE_HOUR })).toBe(
      false,
    );
  });

  test("a zoom is for the range it works over, compared by value", () => {
    expect(
      isTimeRangeZoomFor(ZOOMED_PAGE, {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-09-28T11:10:00.000Z"),
          new Date("2026-09-28T11:25:00.000Z"),
        ),
      }),
    ).toBe(true);
    expect(
      isTimeRangeZoomFor(UNZOOMED_PAGE, { range: TimeRange.PAST_ONE_HOUR }),
    ).toBe(true);
  });

  test("a zoom is not for a different range", () => {
    expect(
      isTimeRangeZoomFor(UNZOOMED_PAGE, { range: TimeRange.PAST_ONE_DAY }),
    ).toBe(false);
    expect(
      isTimeRangeZoomFor(ZOOMED_PAGE, { range: TimeRange.PAST_ONE_HOUR }),
    ).toBe(false);
  });

  test("a zoom that does not say its range is for any range", () => {
    expect(
      isTimeRangeZoomFor(
        { ...UNZOOMED_PAGE, timeRange: null },
        { range: TimeRange.PAST_ONE_DAY },
      ),
    ).toBe(true);
  });
});

/*
 * The metric explorer's saved views, on the page plumbing every zoomable
 * page shares: a reader zooms, saves the view (it keeps the zoomed window,
 * pinned), picks another range in the picker, and later loads the view.
 * Loading it is a fresh start on that window. The zoom that produced it
 * ended with the pick; it must not wake up and offer "Reset zoom" back to a
 * range from before it, nor hold every chart's single clicks for a
 * double-click that has nothing to undo.
 */
describe("TimeRangeZoomScope: a view saved while zoomed, loaded after a pick", () => {
  const SAVED_WINDOW: string =
    "2026-09-28T11:10:00.000Z/2026-09-28T11:25:00.000Z";

  // What a saved view stores and hands back: the window, through JSON.
  function saveView(range: RangeStartAndEndDateTime): string {
    return JSON.stringify({
      startTime: range.startAndEndDate?.startValue,
      endTime: range.startAndEndDate?.endValue,
    });
  }

  function loadView(savedView: string): void {
    const stored: { startTime: string; endTime: string } = JSON.parse(
      savedView,
    ) as { startTime: string; endTime: string };

    act(() => {
      setPageRangeFromOutside?.({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date(stored.startTime),
          new Date(stored.endTime),
        ),
      });
    });
  }

  function pickPreset(range: TimeRange): void {
    fireEvent.click(
      screen.getByTestId(
        `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: getTimeRangeButtonLabel({ range: range }),
      }),
    );
  }

  function resetButton(): HTMLElement | null {
    return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
  }

  // Zoom with the probe's drag, save the view, then pick a preset.
  function zoomSaveAndPick(): string {
    fireEvent.click(screen.getByTestId("cpu-drag"));
    expect(text("page-range")).toBe(SAVED_WINDOW);
    expect(resetButton()).not.toBeNull();

    const zoomedTo: RangeStartAndEndDateTime = onPageRangeChange.mock
      .calls[0]![0] as RangeStartAndEndDateTime;
    const savedView: string = saveView(zoomedTo);

    pickPreset(TimeRange.PAST_THREE_HOURS);
    expect(text("page-range")).toBe(TimeRange.PAST_THREE_HOURS);
    expect(resetButton()).toBeNull();

    return savedView;
  }

  test("loading the view offers no Reset zoom, and no chart holds its clicks for a reset", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
        <ContextProbe id="memory" />
      </Page>,
    );
    const savedView: string = zoomSaveAndPick();

    loadView(savedView);

    expect(text("page-range")).toBe(SAVED_WINDOW);
    expect(resetButton()).toBeNull();
    expect(text("cpu-is-zoomed")).toBe("false");
    expect(text("cpu-can-reset")).toBe("false");
    expect(text("memory-can-reset")).toBe("false");
    expect(latestContext?.rangeBeforeZoom).toBeNull();
  });

  test("a double-click on a chart then leaves the loaded view where it is", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
      </Page>,
    );
    const savedView: string = zoomSaveAndPick();
    loadView(savedView);
    onPageRangeChange.mockReset();

    fireEvent.click(screen.getByTestId("cpu-double-click"));

    expect(text("page-range")).toBe(SAVED_WINDOW);
    expect(onPageRangeChange).not.toHaveBeenCalled();
  });

  test("a zoom inside the loaded view resets to the saved window, not to the range before the old zoom", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
        <ContextProbe id="memory" />
      </Page>,
    );
    const savedView: string = zoomSaveAndPick();
    loadView(savedView);

    act(() => {
      latestContext?.onTimeRangeSelect(
        new Date("2026-09-28T11:15:00.000Z"),
        new Date("2026-09-28T11:20:00.000Z"),
      );
    });

    expect(text("page-range")).toBe(
      "2026-09-28T11:15:00.000Z/2026-09-28T11:20:00.000Z",
    );
    const reset: HTMLElement | null = resetButton();
    expect(reset).not.toBeNull();
    // The way back is a custom window now, so it is named plainly.
    expect(reset).toHaveAttribute(
      "title",
      "Go back to the time range before the zoom",
    );

    fireEvent.click(screen.getByTestId("memory-double-click"));

    expect(text("page-range")).toBe(SAVED_WINDOW);
    expect(resetButton()).toBeNull();
  });

  test("Reset zoom beside the picker takes the reader back to the saved window too", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
      </Page>,
    );
    const savedView: string = zoomSaveAndPick();
    loadView(savedView);

    act(() => {
      latestContext?.onTimeRangeSelect(
        new Date("2026-09-28T11:15:00.000Z"),
        new Date("2026-09-28T11:20:00.000Z"),
      );
    });
    fireEvent.click(resetButton()!);

    expect(text("page-range")).toBe(SAVED_WINDOW);
    expect(text("cpu-can-reset")).toBe("false");
  });

  test("while the view is still zoomed, loading it again (the same window) keeps the zoom", () => {
    render(
      <Page>
        <ContextProbe id="cpu" />
      </Page>,
    );
    fireEvent.click(screen.getByTestId("cpu-drag"));
    const savedView: string = saveView(
      onPageRangeChange.mock.calls[0]![0] as RangeStartAndEndDateTime,
    );

    // Re-applying the window the page is already on is not a move.
    loadView(savedView);

    expect(resetButton()).not.toBeNull();
    fireEvent.click(resetButton()!);
    expect(text("page-range")).toBe(TimeRange.PAST_ONE_HOUR);
  });
});
