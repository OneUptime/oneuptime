import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105, review finding dash-1: a drag across a Value widget's
 * sparkline crashed the whole dashboard when the zoomed line came back
 * with fewer points.
 *
 * The line remembered the point under the pointer as an index into the
 * points it was drawing. A drag always ends with the pointer resting on the
 * line, the board reloads the widget for the dragged window, and a narrower
 * window has fewer points: "Past 1 Hour" draws 60, ten minutes of it 11. The
 * render that drew the new line read the remembered index past its end and
 * threw, and the error boundary above replaced the whole page - on the
 * Component Settings preview, taking unsaved edits with it. A refresh that
 * lands one point fewer in the middle of a drag did the same through the
 * drag's own ends.
 *
 * The first half drives the view directly and hands it the next line the
 * way a host would; the second goes through the real widgets and the real
 * zoom hooks both dashboard shells and the settings preview use, over a
 * data layer that answers with one point per minute of whatever window it
 * is asked for - so a zoom really does shrink the line.
 */

const MINUTE_MS: number = 60 * 1000;
const BOARD_START_MS: number = Date.UTC(2026, 8, 28, 10, 0, 0);

function at(minute: number): Date {
  return new Date(BOARD_START_MS + minute * MINUTE_MS);
}

const fetchResultsMock: MockFunction = getJestMockFunction();
const fetchTimeSeriesMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTimeSeries: (...args: Array<any>) => {
          return fetchTimeSeriesMock(...args);
        },
      },
    };
  },
);

// The settings form is not under test; the preview above it is.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: () => {
        return react.createElement("div", { "data-testid": "arguments-form" });
      },
    };
  },
);

import ValueWidgetView, {
  SPARKLINE_SELECTION_TEST_ID,
  SPARKLINE_TEST_ID,
  Sparkline,
  SparklinePoint,
  ValueWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import DashboardValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardValueComponent";
import DashboardDataSourceValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceValueComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import DashboardCanvas from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardDataSourceValueComponent, {
  DataSourceValueReduce,
} from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DashboardValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import useDashboardTimeRangeZoom, {
  DashboardTimeRangeZoom,
} from "../../../UI/Utils/UseDashboardTimeRangeZoom";

// What an error boundary above the widget shows once a render has thrown.
const CRASHED_TEST_ID: string = "widget-crashed";

interface CrashBoundaryProps {
  children: React.ReactNode;
}

interface CrashBoundaryState {
  error: Error | null;
}

/*
 * Stands for the application's error boundary, which replaces the whole
 * dashboard page with its fallback: a throw anywhere under it shows here.
 */
class CrashBoundary extends React.Component<
  CrashBoundaryProps,
  CrashBoundaryState
> {
  public constructor(props: CrashBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return { error: error };
  }

  public override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div data-testid={CRASHED_TEST_ID}>
          {`${this.state.error.name}: ${this.state.error.message}`}
        </div>
      );
    }

    return this.props.children;
  }
}

function crashed(): HTMLElement | null {
  return screen.queryByTestId(CRASHED_TEST_ID);
}

/*
 * `count` points a minute apart from `firstMinute`, each worth 100 plus its
 * minute: every point reads differently, and differently from any
 * aggregate the tests hand the view.
 */
function minutePoints(
  firstMinute: number,
  count: number,
): Array<SparklinePoint> {
  const points: Array<SparklinePoint> = [];

  for (
    let minute: number = firstMinute;
    minute < firstMinute + count;
    minute++
  ) {
    points.push({ timestamp: at(minute), value: 100 + minute });
  }

  return points;
}

/*
 * jsdom lays nothing out, so the sparkline would read every pointer as
 * being over its first point. Give it a real box, BOX_LEFT from the left
 * and as wide as it draws, and hand back the pointer x over any point of
 * the line as it is drawn right now.
 *
 * That x is rounded to a whole pixel: jsdom truncates a mouse event's
 * clientX, and an hour of points on a 120px line sits under 2px apart, so
 * a truncated x can land nearer the point before.
 */
const BOX_LEFT: number = 100;
const PADDING: number = 4;

interface LaidOutSparkline {
  svg: SVGSVGElement;
  xOf: (index: number) => number;
}

function sparklineIn(container: HTMLElement | null): SVGSVGElement {
  return (container ? within(container) : screen).getByTestId(
    SPARKLINE_TEST_ID,
  ) as unknown as SVGSVGElement;
}

function pointCountOf(svg: SVGSVGElement): number {
  return (svg.querySelector("polyline")!.getAttribute("points") || "")
    .trim()
    .split(" ").length;
}

function layOut(container: HTMLElement | null = null): LaidOutSparkline {
  const svg: SVGSVGElement = sparklineIn(container);
  const width: number = Number(svg.getAttribute("width"));

  svg.getBoundingClientRect = (): DOMRect => {
    return {
      left: BOX_LEFT,
      top: 0,
      right: BOX_LEFT + width,
      bottom: 20,
      width: width,
      height: 20,
      x: BOX_LEFT,
      y: 0,
      toJSON: (): string => {
        return "";
      },
    } as DOMRect;
  };

  return {
    svg: svg,
    xOf: (index: number): number => {
      const lastIndex: number = pointCountOf(svg) - 1;
      return Math.round(
        BOX_LEFT + PADDING + (index / lastIndex) * (width - PADDING * 2),
      );
    },
  };
}

// The hover marker: the ring the line draws on the point it names.
function hoverMarkerIn(svg: SVGSVGElement): Element | null {
  return svg.querySelector("circle");
}

function hoverOver(sparkline: LaidOutSparkline, index: number): void {
  fireEvent.mouseMove(sparkline.svg, {
    clientX: sparkline.xOf(index),
    buttons: 0,
  });
}

function pressOn(sparkline: LaidOutSparkline, index: number): void {
  fireEvent.mouseDown(sparkline.svg, {
    clientX: sparkline.xOf(index),
    button: 0,
  });
}

function dragOnTo(sparkline: LaidOutSparkline, index: number): void {
  fireEvent.mouseMove(sparkline.svg, {
    clientX: sparkline.xOf(index),
    buttons: 1,
  });
}

function releaseOn(sparkline: LaidOutSparkline, index: number): void {
  fireEvent.mouseUp(sparkline.svg, { clientX: sparkline.xOf(index) });
}

/*
 * A reader's drag: onto the line, press, across, let go - and the pointer
 * stays where it was let go, on the line.
 */
function dragAcross(
  sparkline: LaidOutSparkline,
  fromIndex: number,
  toIndex: number,
): void {
  hoverOver(sparkline, fromIndex);
  pressOn(sparkline, fromIndex);
  dragOnTo(sparkline, toIndex);
  releaseOn(sparkline, toIndex);
}

function windowsOf(mock: MockFunction): Array<[number, number]> {
  return mock.mock.calls.map((call: Array<unknown>): [number, number] => {
    return [(call[0] as Date).getTime(), (call[1] as Date).getTime()];
  });
}

afterEach(() => {
  cleanup();
});

/*
 * What the line tells whoever draws the read-out: the index of the point
 * under the pointer, and null as soon as that index names no point on the
 * line as it is now. The view holds only that index, so these are the
 * moments it must hear about.
 */
describe("the Sparkline's word to its host about the point under the pointer", () => {
  let onHoverIndex: MockFunction;
  let onSelect: MockFunction;

  function line(points: Array<SparklinePoint>): React.ReactElement {
    return (
      <Sparkline
        data={points}
        width={120}
        height={24}
        color="#6366f1"
        fillColor="rgba(99, 102, 241, 0.08)"
        onHoverIndex={onHoverIndex as unknown as (index: number | null) => void}
        onTimeRangeSelect={
          onSelect as unknown as (startTime: Date, endTime: Date) => void
        }
      />
    );
  }

  // Everything the host has been told, in order.
  function told(): Array<number | null> {
    return onHoverIndex.mock.calls.map(
      (call: Array<unknown>): number | null => {
        return call[0] as number | null;
      },
    );
  }

  beforeEach(() => {
    onHoverIndex = getJestMockFunction();
    onSelect = getJestMockFunction();
  });

  test("a move names the point under the pointer by its index in the data", () => {
    render(line(minutePoints(0, 6)));

    hoverOver(layOut(), 4);

    expect(told()).toEqual([4]);
  });

  test("a drag that zooms lets go of the hover before it hands the window up", () => {
    render(line(minutePoints(0, 6)));

    dragAcross(layOut(), 1, 3);

    expect(windowsOf(onSelect)).toEqual([[at(1).getTime(), at(4).getTime()]]);
    expect(told()[told().length - 1]).toBeNull();
    /*
     * Told first, so nothing the zoom renders on its way in can read the
     * point the pointer was over in the window being left.
     */
    const hoverCalls: Array<number> = onHoverIndex.mock.invocationCallOrder;
    expect(hoverCalls[hoverCalls.length - 1]!).toBeLessThan(
      onSelect.mock.invocationCallOrder[0]!,
    );
  });

  test("a press and release on one point zooms nothing, so the hover stands", () => {
    render(line(minutePoints(0, 6)));
    const sparkline: LaidOutSparkline = layOut();

    hoverOver(sparkline, 2);
    pressOn(sparkline, 2);
    releaseOn(sparkline, 2);

    expect(onSelect).not.toHaveBeenCalled();
    // Never told to let go: the read-out still shows the point.
    expect(told()).toEqual([2]);
    expect(hoverMarkerIn(sparkline.svg)).not.toBeNull();
  });

  test("redrawn with as many points the hover stands; with a different number it is let go of, once", () => {
    const rendered: RenderResult = render(line(minutePoints(0, 6)));
    hoverOver(layOut(), 2);

    // A rolling window moved on a minute: six points again.
    rendered.rerender(line(minutePoints(1, 6)));
    expect(told()).toEqual([2]);
    expect(hoverMarkerIn(sparklineIn(null))).not.toBeNull();

    rendered.rerender(line(minutePoints(0, 4)));
    expect(told()).toEqual([2, null]);
    expect(hoverMarkerIn(sparklineIn(null))).toBeNull();

    // Nothing more to say while the count holds.
    rendered.rerender(line(minutePoints(2, 4)));
    expect(told()).toEqual([2, null]);
  });

  test("a line cut to one point draws nothing, and lets go of the hover", () => {
    const rendered: RenderResult = render(line(minutePoints(0, 6)));
    hoverOver(layOut(), 5);

    rendered.rerender(line(minutePoints(0, 1)));

    expect(told()).toEqual([5, null]);
    expect(screen.queryByTestId(SPARKLINE_TEST_ID)).toBeNull();
  });

  test("taken away while hovered, it lets go of the hover", () => {
    const rendered: RenderResult = render(line(minutePoints(0, 6)));
    hoverOver(layOut(), 3);

    rendered.unmount();

    expect(told()).toEqual([3, null]);
  });
});

describe("the sparkline under a line that changes beneath the pointer", () => {
  /*
   * Tall enough that the layout admits the sparkline: it only does once the
   * number is already at its largest size.
   */
  const baseViewProps: ValueWidgetViewProps = {
    widthInPx: 400,
    heightInPx: 320,
    isEditMode: false,
    isLoading: false,
    hasEverLoaded: true,
    error: null,
    value: 42,
    points: minutePoints(0, 60),
    noDataMessage: "No data for the selected time range",
    isConfigured: true,
    setupTitle: "Value",
    setupMessage: "Click to configure",
    title: "Requests",
    rawUnit: "",
    metricName: "",
    hideUnit: false,
    warningThreshold: undefined,
    criticalThreshold: undefined,
    trendDirection: undefined,
  };

  let onSelect: MockFunction;
  let rendered: RenderResult;

  function view(overrides: Partial<ValueWidgetViewProps>): React.ReactElement {
    return (
      <CrashBoundary>
        <ValueWidgetView
          {...baseViewProps}
          onTimeRangeSelect={
            onSelect as unknown as (startTime: Date, endTime: Date) => void
          }
          {...overrides}
        />
      </CrashBoundary>
    );
  }

  function renderView(overrides: Partial<ValueWidgetViewProps> = {}): void {
    rendered = render(view(overrides));
  }

  // What the host hands down next: a zoom or a refresh landed.
  function handDown(overrides: Partial<ValueWidgetViewProps>): void {
    rendered.rerender(view(overrides));
  }

  beforeEach(() => {
    onSelect = getJestMockFunction();
  });

  describe("a zoom that lands fewer points", () => {
    test("the drag lets go of the hover as it zooms, and the zoomed line draws without throwing", () => {
      renderView();
      const sparkline: LaidOutSparkline = layOut();

      hoverOver(sparkline, 20);
      pressOn(sparkline, 20);
      dragOnTo(sparkline, 30);
      // While dragging, the read-out names the point the window ends on.
      expect(screen.getByText("130")).toBeInTheDocument();

      releaseOn(sparkline, 30);

      expect(windowsOf(onSelect)).toEqual([
        [at(20).getTime(), at(31).getTime()],
      ]);
      /*
       * The pointer has not moved, but the point it was naming belongs to
       * the window being left: the aggregate is back and nothing is marked.
       */
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.queryByText("130")).toBeNull();
      expect(hoverMarkerIn(sparkline.svg)).toBeNull();

      // The board hands down the zoomed window: 10:20 to 10:30.
      handDown({ points: minutePoints(20, 11), value: 7 });

      expect(crashed()).toBeNull();
      expect(pointCountOf(sparklineIn(null))).toBe(11);
      expect(hoverMarkerIn(sparklineIn(null))).toBeNull();
      expect(screen.getByText("7")).toBeInTheDocument();
    });

    test("a pointer moved while the zoom loads names a point of the old line, and the new line lets go of it", () => {
      renderView();
      const sparkline: LaidOutSparkline = layOut();
      dragAcross(sparkline, 20, 30);

      // The zoomed window is still loading; the old line is still drawn.
      hoverOver(sparkline, 33);
      expect(screen.getByText("133")).toBeInTheDocument();
      expect(hoverMarkerIn(sparkline.svg)).not.toBeNull();

      handDown({ points: minutePoints(20, 11), value: 7 });

      expect(crashed()).toBeNull();
      expect(pointCountOf(sparklineIn(null))).toBe(11);
      expect(hoverMarkerIn(sparklineIn(null))).toBeNull();
      expect(screen.getByText("7")).toBeInTheDocument();
      expect(screen.queryByText("133")).toBeNull();
    });

    test("the hover it let go of stays gone when a reset brings the longer line back", () => {
      renderView();
      const sparkline: LaidOutSparkline = layOut();
      dragAcross(sparkline, 20, 30);
      hoverOver(sparkline, 33);
      handDown({ points: minutePoints(20, 11), value: 7 });

      /*
       * The pointer never moved. The place it was over is a place on the
       * old line again, but nothing has told the line the pointer is there.
       */
      handDown({ points: minutePoints(0, 60), value: 42 });

      expect(crashed()).toBeNull();
      expect(hoverMarkerIn(sparklineIn(null))).toBeNull();
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.queryByText("133")).toBeNull();
    });

    test("a right-to-left drag, released past the end of the zoomed line, draws it too", () => {
      renderView();
      const sparkline: LaidOutSparkline = layOut();

      dragAcross(sparkline, 50, 30);
      hoverOver(sparkline, 45);

      expect(windowsOf(onSelect)).toEqual([
        [at(30).getTime(), at(51).getTime()],
      ]);

      handDown({ points: minutePoints(30, 21), value: 9 });

      expect(crashed()).toBeNull();
      expect(pointCountOf(sparklineIn(null))).toBe(21);
      expect(hoverMarkerIn(sparklineIn(null))).toBeNull();
      expect(screen.getByText("9")).toBeInTheDocument();
    });

    test("a plain click is no zoom, so the hover stays on the point", () => {
      renderView();
      const sparkline: LaidOutSparkline = layOut();

      hoverOver(sparkline, 12);
      pressOn(sparkline, 12);
      releaseOn(sparkline, 12);

      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByText("112")).toBeInTheDocument();
      expect(hoverMarkerIn(sparkline.svg)).not.toBeNull();
    });
  });

  describe("a refresh that lands under a resting pointer", () => {
    test("with as many points as before, the hover stays and reads the point now at that place", () => {
      renderView({ points: minutePoints(0, 6) });
      const sparkline: LaidOutSparkline = layOut();

      hoverOver(sparkline, 3);
      expect(screen.getByText("103")).toBeInTheDocument();

      // The same six minutes, re-measured: every value moved.
      handDown({
        points: minutePoints(0, 6).map(
          (point: SparklinePoint): SparklinePoint => {
            return { timestamp: point.timestamp, value: point.value + 50 };
          },
        ),
      });

      expect(crashed()).toBeNull();
      expect(hoverMarkerIn(sparklineIn(null))).not.toBeNull();
      // The point under the pointer as it reads now, not as it read before.
      expect(screen.getByText("153")).toBeInTheDocument();
      expect(screen.queryByText("103")).toBeNull();
    });

    test("with a different number of points, the pointer is over another place, so the hover is let go of", () => {
      renderView({ points: minutePoints(0, 6) });
      const sparkline: LaidOutSparkline = layOut();

      hoverOver(sparkline, 2);
      expect(screen.getByText("102")).toBeInTheDocument();

      // A seventh minute came in: every point sits somewhere else now.
      handDown({ points: minutePoints(0, 7) });

      expect(crashed()).toBeNull();
      expect(hoverMarkerIn(sparklineIn(null))).toBeNull();
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.queryByText("102")).toBeNull();
    });

    test("a line that goes away takes the read-out with it, so it cannot come back stale", () => {
      renderView({ points: minutePoints(0, 6) });
      const sparkline: LaidOutSparkline = layOut();
      hoverOver(sparkline, 2);
      expect(screen.getByText("102")).toBeInTheDocument();

      // A zoom into a quiet stretch: nothing to draw, nothing to hover.
      handDown({ points: [], value: null });
      expect(
        screen.getByText("No data for the selected time range"),
      ).toBeInTheDocument();

      // And back out: the same line, with no pointer on it.
      handDown({ points: minutePoints(0, 6), value: 42 });

      expect(crashed()).toBeNull();
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.queryByText("102")).toBeNull();
      expect(hoverMarkerIn(sparklineIn(null))).toBeNull();
    });
  });

  describe("the empty state a zoom into a quiet stretch lands on", () => {
    const NO_DATA: string = "No data for the selected time range";

    // The box that takes the double-click: the message sits directly in it.
    function emptyState(): HTMLElement {
      return screen.getByText(NO_DATA).parentElement as HTMLElement;
    }

    test("while it takes the double-click that resets, the double-click selects none of its words", () => {
      const onReset: MockFunction = getJestMockFunction();
      renderView({
        value: null,
        points: [],
        onTimeRangeReset: onReset as unknown as () => void,
      });

      expect(emptyState()).toHaveClass("select-none");

      fireEvent.doubleClick(screen.getByText(NO_DATA));
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    test("with no zoom to undo, its words stay selectable", () => {
      renderView({ value: null, points: [] });

      expect(emptyState()).not.toHaveClass("select-none");
    });
  });

  describe("a refresh that lands one point fewer in the middle of a drag", () => {
    // Seven five-minute points, 10:00 to 10:30.
    function fiveMinutePoints(
      fromIndex: number,
      toIndex: number,
    ): Array<SparklinePoint> {
      const points: Array<SparklinePoint> = [];

      for (let index: number = fromIndex; index <= toIndex; index++) {
        points.push({ timestamp: at(index * 5), value: 10 + index });
      }

      return points;
    }

    // Where the line draws point `index` of `count`, as the band reads it.
    function bandXOf(svg: SVGSVGElement, index: number, count: number): number {
      const width: number = Number(svg.getAttribute("width"));
      return PADDING + (index / (count - 1)) * (width - PADDING * 2);
    }

    function band(): Element | null {
      return screen.queryByTestId(SPARKLINE_SELECTION_TEST_ID);
    }

    test("a drag onto the newest point keeps its band on the line and zooms what it still covers", () => {
      renderView({ points: fiveMinutePoints(0, 6), value: 42 });
      const sparkline: LaidOutSparkline = layOut();

      pressOn(sparkline, 3);
      dragOnTo(sparkline, 6);
      expect(band()).not.toBeNull();

      /*
       * The rolling window moved on under the drag: the oldest bucket
       * dropped out and the newest has no data yet.
       */
      handDown({ points: fiveMinutePoints(1, 6), value: 42 });

      expect(crashed()).toBeNull();
      const svg: SVGSVGElement = sparklineIn(null);
      expect(pointCountOf(svg)).toBe(6);
      // The band runs from the drag's start to the newest point left.
      expect(Number(band()!.getAttribute("x"))).toBeCloseTo(bandXOf(svg, 3, 6));
      expect(Number(band()!.getAttribute("width"))).toBeCloseTo(
        bandXOf(svg, 5, 6) - bandXOf(svg, 3, 6),
      );

      releaseOn(layOut(), 5);

      // Places 3 to 5 of the line as it is now: 10:20 to the end of 10:30.
      expect(windowsOf(onSelect)).toEqual([
        [at(20).getTime(), at(35).getTime()],
      ]);
      expect(band()).toBeNull();
    });

    test("a press on the newest point, before the pointer moves, survives the refresh", () => {
      renderView({ points: fiveMinutePoints(0, 6), value: 42 });
      const sparkline: LaidOutSparkline = layOut();

      // No move before the press: the hover names nothing, only the drag does.
      pressOn(sparkline, 6);

      handDown({ points: fiveMinutePoints(1, 6), value: 42 });

      expect(crashed()).toBeNull();
      expect(band()).toBeNull();

      const shrunk: LaidOutSparkline = layOut();
      dragOnTo(shrunk, 2);
      expect(band()).not.toBeNull();
      releaseOn(shrunk, 2);

      // From place 2 to the newest place the drag still reaches, 5.
      expect(windowsOf(onSelect)).toEqual([
        [at(15).getTime(), at(35).getTime()],
      ]);
    });

    test("a right-to-left drag that began on the newest point survives it too", () => {
      renderView({ points: fiveMinutePoints(0, 6), value: 42 });
      const sparkline: LaidOutSparkline = layOut();

      pressOn(sparkline, 6);
      dragOnTo(sparkline, 2);

      handDown({ points: fiveMinutePoints(1, 6), value: 42 });

      expect(crashed()).toBeNull();
      const svg: SVGSVGElement = sparklineIn(null);
      expect(Number(band()!.getAttribute("x"))).toBeCloseTo(bandXOf(svg, 2, 6));
      expect(Number(band()!.getAttribute("width"))).toBeCloseTo(
        bandXOf(svg, 5, 6) - bandXOf(svg, 2, 6),
      );

      releaseOn(layOut(), 2);

      expect(windowsOf(onSelect)).toEqual([
        [at(15).getTime(), at(35).getTime()],
      ]);
    });

    test("a drag whose points all dropped out zooms nothing", () => {
      renderView({ points: fiveMinutePoints(0, 6), value: 42 });
      const sparkline: LaidOutSparkline = layOut();

      pressOn(sparkline, 5);
      dragOnTo(sparkline, 6);

      // A refresh that lost the whole end of the line.
      handDown({ points: fiveMinutePoints(0, 3), value: 42 });

      expect(crashed()).toBeNull();
      expect(band()).toBeNull();

      fireEvent.mouseUp(window);

      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});

/*
 * Through the real widgets, on the real zoom hooks. The data layer answers
 * with one point, worth 1, per minute of the window it is asked for: an
 * hour is 60 points, and both widgets sum them, so the big number is the
 * number of points on the line.
 */

const COMPONENT_ID: ObjectID = new ObjectID(
  "5a5a5a5a-1111-4111-8111-5a5a5a5a5a5a",
);

const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(at(0), at(60)),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

interface Point {
  timestamp: Date;
  value: number;
}

function onePerMinute(start: Date, end: Date): Array<Point> {
  const points: Array<Point> = [];

  for (let ms: number = start.getTime(); ms < end.getTime(); ms += MINUTE_MS) {
    points.push({ timestamp: new Date(ms), value: 1 });
  }

  return points;
}

/*
 * Holds every fetch made after it is called until the returned release
 * runs: the zoomed window "still loading".
 */
let heldFetches: Promise<void> | null = null;

function holdFetches(): () => void {
  let release: () => void = (): void => {
    // Replaced below, synchronously, by the promise executor.
  };
  heldFetches = new Promise<void>((resolve: () => void) => {
    release = resolve;
  });
  return (): void => {
    heldFetches = null;
    release();
  };
}

// Drops the newest point of every answer from here on.
let dropNewestPoint: boolean = false;

async function answer(start: Date, end: Date): Promise<Array<Point>> {
  const hold: Promise<void> | null = heldFetches;
  const points: Array<Point> = onePerMinute(start, end);

  if (hold) {
    await hold;
  }

  return dropNewestPoint ? points.slice(0, -1) : points;
}

interface WidgetZoomProps {
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  refreshTick: number;
  onDashboardTimeRangeSelect: (startTime: Date, endTime: Date) => void;
  onDashboardTimeRangeReset: () => void;
  isDashboardTimeRangeZoomed: boolean;
}

function hostProps(zoom: WidgetZoomProps): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "value-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 400,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    metricTypes: [],
    variables: undefined,
    ...zoom,
  };
}

function buildValueComponent(): DashboardValueComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Value,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 3,
    heightInDashboardUnits: 2,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {
      title: "Requests",
      metricQueryConfig: {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "http.requests",
            aggegationType: MetricsAggregationType.Sum,
          },
        },
      },
    },
  } as unknown as DashboardValueComponent;
}

function buildDataSourceValueComponent(): DashboardDataSourceValueComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceValue,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 3,
    heightInDashboardUnits: 2,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {
      title: "Queue depth",
      reduce: DataSourceValueReduce.Sum,
      query: {
        id: "q1",
        dataSourceId: "6b6b6b6b-1111-4111-8111-6b6b6b6b6b6b",
        query: "sum(queue_depth)",
      },
    },
  } as unknown as DashboardDataSourceValueComponent;
}

interface HostUnderTest {
  name: string;
  widget: (zoom: WidgetZoomProps) => React.ReactElement;
  // Every window the widget has asked the data layer for, in order.
  fetchedWindows: () => Array<[number, number]>;
}

const HOSTS: Array<HostUnderTest> = [
  {
    name: "metric Value widget",
    widget: (zoom: WidgetZoomProps): React.ReactElement => {
      return (
        <DashboardValueComponentElement
          {...hostProps(zoom)}
          component={buildValueComponent()}
        />
      );
    },
    fetchedWindows: (): Array<[number, number]> => {
      return fetchResultsMock.mock.calls.map(
        (call: Array<unknown>): [number, number] => {
          const data: MetricViewData = (
            call[0] as { metricViewData: MetricViewData }
          ).metricViewData;
          return [
            data.startAndEndDate!.startValue.getTime(),
            data.startAndEndDate!.endValue.getTime(),
          ];
        },
      );
    },
  },
  {
    name: "Data Source Value widget",
    widget: (zoom: WidgetZoomProps): React.ReactElement => {
      return (
        <DashboardDataSourceValueComponentElement
          {...hostProps(zoom)}
          component={buildDataSourceValueComponent()}
        />
      );
    },
    fetchedWindows: (): Array<[number, number]> => {
      return fetchTimeSeriesMock.mock.calls.map(
        (call: Array<unknown>): [number, number] => {
          const args: { startDate: Date; endDate: Date } = call[0] as {
            startDate: Date;
            endDate: Date;
          };
          return [args.startDate.getTime(), args.endDate.getTime()];
        },
      );
    },
  },
];

interface BoardShellProps {
  host: HostUnderTest;
  refreshTick: number;
}

/*
 * The board's range as both dashboard shells hold it (DashboardView and the
 * public DashboardViewPage): useDashboardTimeRangeZoom, its handlers handed
 * to the widget, the zoomed range handed back down.
 */
function BoardShell(props: BoardShellProps): React.ReactElement {
  const zoom: DashboardTimeRangeZoom = useDashboardTimeRangeZoom(BOARD_RANGE);

  return props.host.widget({
    dashboardStartAndEndDate: zoom.startAndEndDate,
    refreshTick: props.refreshTick,
    onDashboardTimeRangeSelect: zoom.zoomToTimeRange,
    onDashboardTimeRangeReset: zoom.resetZoom,
    isDashboardTimeRangeZoomed: zoom.isZoomed,
  });
}

function board(
  host: HostUnderTest,
  refreshTick: number = 0,
): React.ReactElement {
  return (
    <CrashBoundary>
      <BoardShell host={host} refreshTick={refreshTick} />
    </CrashBoundary>
  );
}

function bigNumber(text: string): HTMLElement | null {
  return screen.queryByText(text);
}

// Waits for the line to be drawn with `count` points, and hands it back.
async function lineOf(count: number): Promise<SVGSVGElement> {
  await waitFor(() => {
    expect(crashed()).toBeNull();
    expect(pointCountOf(sparklineIn(null))).toBe(count);
  });

  return sparklineIn(null);
}

beforeEach(() => {
  heldFetches = null;
  dropNewestPoint = false;
  fetchResultsMock.mockReset();
  fetchTimeSeriesMock.mockReset();
  fetchResultsMock.mockImplementation(async (...args: Array<unknown>) => {
    const data: MetricViewData = (args[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return [
      {
        data: await answer(
          data.startAndEndDate!.startValue,
          data.startAndEndDate!.endValue,
        ),
      },
    ];
  });
  fetchTimeSeriesMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { startDate: Date; endDate: Date } = args[0] as {
      startDate: Date;
      endDate: Date;
    };
    return { data: await answer(request.startDate, request.endDate) };
  });
});

describe.each(HOSTS)(
  "the $name on a board, zoomed from its own sparkline",
  (host: HostUnderTest) => {
    test("a drag, with the pointer left resting on the line, survives the zoomed line landing", async () => {
      render(board(host));
      await lineOf(60);
      expect(bigNumber("60")).not.toBeNull();

      dragAcross(layOut(), 20, 30);

      await waitFor(() => {
        const windows: Array<[number, number]> = host.fetchedWindows();
        expect(windows[windows.length - 1]).toEqual([
          at(20).getTime(),
          at(31).getTime(),
        ]);
      });
      const zoomed: SVGSVGElement = await lineOf(11);

      expect(crashed()).toBeNull();
      expect(hoverMarkerIn(zoomed)).toBeNull();
      // The zoomed window's sum, not a point left over from the hour.
      expect(bigNumber("11")).not.toBeNull();
    });

    test("a pointer moved while the zoomed window loads is let go of when it lands", async () => {
      render(board(host));
      await lineOf(60);
      const sparkline: LaidOutSparkline = layOut();

      const release: () => void = holdFetches();
      dragAcross(sparkline, 20, 30);
      await waitFor(() => {
        expect(host.fetchedWindows().length).toBe(2);
      });

      // Still the hour on screen, dimmed: the reader nudges the pointer.
      hoverOver(sparkline, 33);
      expect(hoverMarkerIn(sparkline.svg)).not.toBeNull();
      expect(bigNumber("1")).not.toBeNull();

      await act(async () => {
        release();
      });
      const zoomed: SVGSVGElement = await lineOf(11);

      expect(crashed()).toBeNull();
      expect(hoverMarkerIn(zoomed)).toBeNull();
      expect(bigNumber("11")).not.toBeNull();
    });

    test("a right-to-left drag survives the zoomed line landing", async () => {
      render(board(host));
      await lineOf(60);

      dragAcross(layOut(), 50, 30);

      const zoomed: SVGSVGElement = await lineOf(21);

      expect(crashed()).toBeNull();
      expect(hoverMarkerIn(zoomed)).toBeNull();
      expect(bigNumber("21")).not.toBeNull();
    });

    test("a zoom inside a zoom, and the reset out of both, never throw", async () => {
      render(board(host));
      await lineOf(60);

      dragAcross(layOut(), 20, 40);
      await lineOf(21);

      dragAcross(layOut(), 5, 15);
      await lineOf(11);
      expect(host.fetchedWindows()[host.fetchedWindows().length - 1]).toEqual([
        at(25).getTime(),
        at(36).getTime(),
      ]);

      // Back to the hour in one step, the pointer still on the line.
      fireEvent.doubleClick(sparklineIn(null));
      const hour: SVGSVGElement = await lineOf(60);

      expect(crashed()).toBeNull();
      expect(hoverMarkerIn(hour)).toBeNull();
      expect(bigNumber("60")).not.toBeNull();
    });

    test("an auto-refresh that lands one point fewer in the middle of a drag keeps the board up", async () => {
      const rendered: RenderResult = render(board(host, 0));
      await lineOf(60);

      // Pressed on the newest point; the pointer has not moved since.
      pressOn(layOut(), 59);

      dropNewestPoint = true;
      rendered.rerender(board(host, 1));
      await lineOf(59);

      expect(crashed()).toBeNull();

      // The drag goes on over the line as it is now.
      const refreshed: LaidOutSparkline = layOut();
      dragOnTo(refreshed, 40);
      releaseOn(refreshed, 40);

      await waitFor(() => {
        const windows: Array<[number, number]> = host.fetchedWindows();
        expect(windows[windows.length - 1]).toEqual([
          at(40).getTime(),
          at(59).getTime(),
        ]);
      });
      await lineOf(18);
      expect(crashed()).toBeNull();
    });
  },
);

/*
 * The Component Settings preview zooms itself (useTimeRangeZoom over its
 * own copy of the board's range), so the same drag there landed on the
 * same stale index - and threw away the edits the dialog was holding.
 */
class FakeResizeObserver {
  private callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(): void {
    this.callback(
      [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  public unobserve(): void {
    // Nothing to stop observing.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

describe("the Value widget in the Component Settings preview", () => {
  beforeAll(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      FakeResizeObserver;
  });

  function editor(): React.ReactElement {
    const viewConfig: DashboardViewConfig = {
      _type: ObjectType.DashboardViewConfig,
      components: [buildValueComponent()],
      heightInDashboardUnits: 12,
    };

    return (
      <CrashBoundary>
        <DashboardCanvas
          dashboardViewConfig={viewConfig}
          onDashboardViewConfigChange={() => {}}
          isEditMode={true}
          currentTotalDashboardWidthInPx={1200}
          onComponentSelected={() => {}}
          onComponentUnselected={() => {}}
          selectedComponentId={COMPONENT_ID}
          metrics={{ metricTypes: [], telemetryAttributes: [] }}
          dashboardStartAndEndDate={BOARD_RANGE}
          refreshTick={0}
          onDashboardTimeRangeSelect={() => {}}
          onDashboardTimeRangeReset={() => {}}
          isDashboardTimeRangeZoomed={false}
        />
      </CrashBoundary>
    );
  }

  function previewLine(): SVGSVGElement {
    return sparklineIn(screen.getByTestId("modal"));
  }

  test("a drag on the preview's sparkline zooms the preview without taking the editor down", async () => {
    render(editor());

    await waitFor(() => {
      expect(pointCountOf(previewLine())).toBe(60);
    });

    dragAcross(layOut(screen.getByTestId("modal")), 20, 30);

    await waitFor(() => {
      expect(crashed()).toBeNull();
      expect(pointCountOf(previewLine())).toBe(11);
    });

    // Still editing: the dialog, and the settings it holds, are there.
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(screen.getByTestId("arguments-form")).toBeInTheDocument();
    expect(hoverMarkerIn(previewLine())).toBeNull();
  });
});
