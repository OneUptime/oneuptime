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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import TraceTimelineMinimap from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceTimelineMinimap";
import { TraceServiceInfo } from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import {
  FULL_VIEWPORT,
  SpanTree,
  TimeViewport,
  WaterfallSpan,
  buildSpanTree,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceWaterfall";
import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";

/*
 * Issue #4105 asks that a double-click on a zoomed chart goes back. The
 * trace minimap drives the waterfall's time axis: a drag across it zooms,
 * a click on a zoomed track pans, and now a double-click shows the whole
 * trace again - without first panning twice, since the browser delivers
 * both clicks of a double-click before the double-click itself.
 *
 * jsdom lays nothing out, so the track is given a 1000px-wide box: a pointer
 * at clientX N is at fraction N / 1000 of the trace.
 */

const MS: number = 1_000_000;

function span(
  spanId: string,
  parentSpanId: string,
  startMs: number,
  durationMs: number,
): WaterfallSpan {
  return {
    spanId,
    parentSpanId,
    name: spanId,
    serviceId: "svc",
    startTimeUnixNano: startMs * MS,
    endTimeUnixNano: (startMs + durationMs) * MS,
    durationUnixNano: durationMs * MS,
    isError: false,
    kind: SpanKind.Internal,
  };
}

const TREE: SpanTree = buildSpanTree([
  span("root", "", 0, 1000),
  span("child", "root", 100, 300),
]);

const SERVICES: Map<string, TraceServiceInfo> = new Map([
  ["svc", { id: "svc", name: "checkout", color: "#6366f1" }],
]);

const ZOOMED: TimeViewport = { start: 0.2, end: 0.4 };

const onViewportChange: MockFunction = getJestMockFunction();

function renderMinimap(viewport: TimeViewport): ReturnType<typeof render> {
  const rendered: ReturnType<typeof render> = render(
    <TraceTimelineMinimap
      tree={TREE}
      serviceInfoById={SERVICES}
      viewport={viewport}
      onViewportChange={(next: TimeViewport): void => {
        onViewportChange(next);
      }}
    />,
  );

  const track: HTMLElement = screen.getByRole("img");
  track.getBoundingClientRect = (): DOMRect => {
    return {
      left: 0,
      right: 1000,
      top: 0,
      bottom: 44,
      width: 1000,
      height: 44,
      x: 0,
      y: 0,
      toJSON: (): Record<string, unknown> => {
        return {};
      },
    } as DOMRect;
  };

  return rendered;
}

function track(): HTMLElement {
  return screen.getByRole("img");
}

/*
 * jsdom has no PointerEvent constructor, so build a MouseEvent and graft
 * the pointer id on (the UseDashboardGridDnd tests do the same). The
 * minimap reads button, clientX and pointerId.
 */
function pointer(type: string, clientX: number): void {
  const event: MouseEvent = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: clientX,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });

  act(() => {
    track().dispatchEvent(event);
  });
}

function press(clientX: number): void {
  pointer("pointerdown", clientX);
}

function moveTo(clientX: number): void {
  pointer("pointermove", clientX);
}

function release(clientX: number): void {
  pointer("pointerup", clientX);
}

function clickAt(clientX: number): void {
  press(clientX);
  release(clientX);
}

beforeEach(() => {
  jest.useFakeTimers();
  onViewportChange.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a double-click shows the whole trace again", () => {
  test("on a zoomed track it resets the waterfall to the full trace", () => {
    renderMinimap(ZOOMED);

    fireEvent.doubleClick(track());

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledWith(FULL_VIEWPORT);
  });

  test("with the whole trace in view it does nothing", () => {
    renderMinimap(FULL_VIEWPORT);

    fireEvent.doubleClick(track());
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
    });

    expect(onViewportChange).not.toHaveBeenCalled();
  });

  test("the clicks a double-click is made of do not pan the window first", () => {
    renderMinimap(ZOOMED);

    clickAt(700);
    clickAt(700);
    fireEvent.doubleClick(track());
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
    });

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledWith(FULL_VIEWPORT);
  });

  test("the track says so while zoomed, and only then", () => {
    const { rerender } = renderMinimap(FULL_VIEWPORT);

    expect(track().getAttribute("aria-label")).not.toContain("double-click");

    rerender(
      <TraceTimelineMinimap
        tree={TREE}
        serviceInfoById={SERVICES}
        viewport={ZOOMED}
        onViewportChange={(next: TimeViewport): void => {
          onViewportChange(next);
        }}
      />,
    );

    expect(track().getAttribute("aria-label")).toContain(
      "double-click to see the whole trace",
    );
    expect(track().getAttribute("title")).toContain(
      "Double-click to see the whole trace",
    );
  });

  test("the Reset zoom button still does the same from the keyboard", () => {
    renderMinimap(ZOOMED);

    fireEvent.click(screen.getByTestId("trace-reset-zoom"));

    expect(onViewportChange).toHaveBeenCalledWith(FULL_VIEWPORT);
  });
});

describe("a single click on a zoomed track still pans", () => {
  test("once the double-click window has passed, centred on the click", () => {
    renderMinimap(ZOOMED);

    clickAt(700);
    expect(onViewportChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
    });

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    const panned: TimeViewport = onViewportChange.mock
      .calls[0]![0] as TimeViewport;
    expect(panned.start).toBeCloseTo(0.6);
    expect(panned.end).toBeCloseTo(0.8);
  });

  test("a second press before the first click panned replaces it", () => {
    renderMinimap(ZOOMED);

    clickAt(700);
    clickAt(500);
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
    });

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    const panned: TimeViewport = onViewportChange.mock
      .calls[0]![0] as TimeViewport;
    expect(panned.start).toBeCloseTo(0.4);
    expect(panned.end).toBeCloseTo(0.6);
  });

  test("a click with the whole trace in view does nothing", () => {
    renderMinimap(FULL_VIEWPORT);

    clickAt(700);
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
    });

    expect(onViewportChange).not.toHaveBeenCalled();
  });

  test("a click still waiting when the minimap goes away never pans", () => {
    const { unmount } = renderMinimap(ZOOMED);

    clickAt(700);
    unmount();
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
    });

    expect(onViewportChange).not.toHaveBeenCalled();
  });
});

describe("a drag zooms at once", () => {
  test("into the dragged slice of the trace, with no waiting", () => {
    renderMinimap(FULL_VIEWPORT);

    press(100);
    moveTo(300);
    release(300);

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    const zoomed: TimeViewport = onViewportChange.mock
      .calls[0]![0] as TimeViewport;
    expect(zoomed.start).toBeCloseTo(0.1);
    expect(zoomed.end).toBeCloseTo(0.3);
  });

  test("a drag cancels a click still waiting to pan", () => {
    renderMinimap(ZOOMED);

    clickAt(700);
    press(100);
    release(300);
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
    });

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    const zoomed: TimeViewport = onViewportChange.mock
      .calls[0]![0] as TimeViewport;
    expect(zoomed.start).toBeCloseTo(0.1);
    expect(zoomed.end).toBeCloseTo(0.3);
  });
});
