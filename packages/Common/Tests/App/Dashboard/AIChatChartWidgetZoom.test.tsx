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

/*
 * Issue #4105 on the charts the AI draws: the time-series and bar widgets
 * in the Ask-AI panel (mounted at the app root, over whatever page is open),
 * on the AI Copilot page, and in the evidence rows of an incident's or an
 * alert's AI investigation.
 *
 * Each of those charts is a snapshot of what one tool call returned. None
 * of them follows the time range of the page it floats over, so the zoom is
 * the chart's own:
 *
 *   - a drag narrows that chart's x-axis to the window dragged out (only the
 *     points inside it are drawn - nothing is refetched, there is nothing to
 *     refetch);
 *   - a double-click, or its "Reset zoom", puts the full extent back;
 *   - the page behind is never retimed, even when that page zooms (a
 *     Kubernetes overview under the Ask-AI panel, say);
 *   - a bar chart over categories rather than time does not zoom at all.
 *
 * The chart wrappers are stood in for by components that resolve their zoom
 * exactly the way the real wrappers do (resolveChartTimeRangeZoom over the
 * enclosing page's zoom), so a leak of the page's zoom would show here.
 */

let nextDragWindow: [Date, Date] = [new Date(0), new Date(1)];

const lineChartRenderMock: MockFunction = getJestMockFunction();
const barChartRenderMock: MockFunction = getJestMockFunction();

interface ZoomContextModule {
  useChartTimeRangeZoom: () => ChartTimeRangeZoomContextValue | null;
  resolveChartTimeRangeZoom: (
    input: ResolveChartTimeRangeZoomInput,
  ) => ChartTimeRangeZoomHandlers;
}

interface WrapperStubProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const zoomContext: ZoomContextModule = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as ZoomContextModule;
  return {
    __esModule: true,
    default: (props: WrapperStubProps): React.ReactElement => {
      lineChartRenderMock(props);
      return react.createElement(WrapperStub, {
        ...props,
        kind: "line",
        zoomContext: zoomContext,
      });
    },
  };
});

jest.mock("../../../UI/Components/Charts/Bar/BarChart", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const zoomContext: ZoomContextModule = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as ZoomContextModule;
  return {
    __esModule: true,
    default: (props: WrapperStubProps): React.ReactElement => {
      barChartRenderMock(props);
      return react.createElement(WrapperStub, {
        ...props,
        kind: "bar",
        zoomContext: zoomContext,
      });
    },
  };
});

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import ChartWidget from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/ChartWidget";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import InvestigationEvidenceList from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationEvidenceList";
import {
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { InvestigationEvidenceItem } from "../../../Types/AI/InvestigationEvidence";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import DataPoint from "../../../UI/Components/Charts/Types/DataPoint";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  ResolveChartTimeRangeZoomInput,
  TimeRangeZoomScope,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ResetTimeRangeZoomButton, {
  RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
} from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";

interface WrapperStubRenderProps extends WrapperStubProps {
  kind: string;
  zoomContext: ZoomContextModule;
}

/*
 * A chart wrapper that zooms the way the real ones do: its host's handlers
 * when it has any, else the enclosing page's on a time axis, unless it is
 * disabled. Its two buttons stand for a drag across the plot (over
 * `nextDragWindow`) and a double-click on it.
 */
function WrapperStub(props: WrapperStubRenderProps): React.ReactElement {
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    props.zoomContext.useChartTimeRangeZoom();
  const zoom: ChartTimeRangeZoomHandlers =
    props.zoomContext.resolveChartTimeRangeZoom({
      onTimeRangeSelect: props.onTimeRangeSelect,
      onTimeRangeReset: props.onTimeRangeReset,
      isTimeAxis:
        props.xAxis.options.type === XAxisType.Time ||
        props.xAxis.options.type === XAxisType.Date,
      disableTimeRangeZoom: props.disableTimeRangeZoom,
      pageZoom: pageZoom,
    });

  return (
    <div
      data-testid={`${props.kind}-chart`}
      data-can-zoom={String(Boolean(zoom.onTimeRangeSelect))}
      data-can-reset={String(Boolean(zoom.onTimeRangeReset))}
      data-series-count={props.data.length}
    >
      <button
        type="button"
        data-testid={`${props.kind}-chart-drag`}
        onClick={() => {
          zoom.onTimeRangeSelect?.(nextDragWindow[0], nextDragWindow[1]);
        }}
      />
      <button
        type="button"
        data-testid={`${props.kind}-chart-double-click`}
        onClick={() => {
          zoom.onTimeRangeReset?.();
        }}
      />
    </div>
  );
}

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 8, 28, 10, minute, 0));
}

function iso(minute: number): string {
  return at(minute).toISOString();
}

// Two series, one point a minute from 10:00 to 10:09 (b starts at 10:02).
function timeSeriesWidget(overrides: Partial<AIChatWidget> = {}): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.TimeSeriesChart,
    title: "p95 latency",
    data: {
      series: [
        {
          name: "checkout",
          points: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((minute: number) => {
            return { x: iso(minute), y: 100 + minute };
          }),
        },
        {
          name: "cart",
          points: [2, 3, 4, 5, 6, 7, 8, 9].map((minute: number) => {
            return { x: iso(minute), y: 50 + minute };
          }),
        },
      ],
      xIsTime: true,
      unit: "ms",
    },
    ...overrides,
  };
}

function barWidget(xIsTime: boolean | undefined): AIChatWidget {
  return {
    id: "W2",
    type: AIChatWidgetType.BarChart,
    title: "Log volume by severity",
    data: {
      series: [
        {
          name: "Error",
          points: [0, 1, 2, 3, 4, 5].map((minute: number) => {
            return { x: iso(minute), y: minute };
          }),
        },
      ],
      xIsTime: xIsTime,
    },
  };
}

interface CapturedWrapperProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

function lastProps(mock: MockFunction): CapturedWrapperProps {
  return mock.mock.calls[
    mock.mock.calls.length - 1
  ]![0] as CapturedWrapperProps;
}

function minutesDrawn(props: CapturedWrapperProps): Array<Array<number>> {
  return props.data.map((series: SeriesPoint): Array<number> => {
    return series.data.map((point: DataPoint): number => {
      return point.x.getUTCMinutes();
    });
  });
}

function axisMinutes(props: CapturedWrapperProps): [number, number] {
  return [
    (props.xAxis.options.min as Date).getUTCMinutes(),
    (props.xAxis.options.max as Date).getUTCMinutes(),
  ];
}

function dragOn(kind: string, from: Date, to: Date): void {
  nextDragWindow = [from, to];
  fireEvent.click(screen.getByTestId(`${kind}-chart-drag`));
}

function doubleClickOn(kind: string): void {
  fireEvent.click(screen.getByTestId(`${kind}-chart-double-click`));
}

let pageRangeChange: MockFunction;

/*
 * A page that zooms - the Kubernetes overview under the Ask-AI panel, or an
 * incident page if it ever gains a range - with a chart of its own (the
 * probe) and its own "Reset zoom".
 */
function PageProbe(): React.ReactElement {
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();
  return (
    <button
      type="button"
      data-testid="page-chart-drag"
      onClick={() => {
        pageZoom?.onTimeRangeSelect(at(1), at(3));
      }}
    />
  );
}

function ZoomingPage(props: { children: React.ReactNode }): React.ReactElement {
  const [range, setRange] = React.useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });
  return (
    <TimeRangeZoomScope
      timeRange={range}
      onTimeRangeChange={(next: RangeStartAndEndDateTime) => {
        pageRangeChange(next);
        setRange(next);
      }}
    >
      <div data-testid="page-range">{range.range}</div>
      <div data-testid="page-reset">
        <ResetTimeRangeZoomButton />
      </div>
      <PageProbe />
      {props.children}
    </TimeRangeZoomScope>
  );
}

beforeEach(() => {
  pageRangeChange = getJestMockFunction();
  lineChartRenderMock.mockReset();
  barChartRenderMock.mockReset();
  postMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AI chat time-series chart: its own zoom", () => {
  test("starts on the full extent the tool returned, offering the drag", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);

    const props: CapturedWrapperProps = lastProps(lineChartRenderMock);
    expect(minutesDrawn(props)).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [2, 3, 4, 5, 6, 7, 8, 9],
    ]);
    expect(axisMinutes(props)).toEqual([0, 9]);
    expect(screen.getByTestId("line-chart")).toHaveAttribute(
      "data-can-zoom",
      "true",
    );
    expect(screen.getByTestId("line-chart")).toHaveAttribute(
      "data-can-reset",
      "false",
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      /^Drag to zoom$/,
    );
  });

  test("a drag draws only the points inside the window, on an axis narrowed to it", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);

    // Buckets 10:03 through 10:05, the last one included.
    dragOn("line", at(3), at(6));

    const props: CapturedWrapperProps = lastProps(lineChartRenderMock);
    expect(minutesDrawn(props)).toEqual([
      [3, 4, 5],
      [3, 4, 5],
    ]);
    expect(axisMinutes(props)).toEqual([3, 6]);
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Drag to zoom · double-click to reset",
    );
  });

  test("a double-click puts the full extent back", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);
    dragOn("line", at(3), at(6));

    doubleClickOn("line");

    const props: CapturedWrapperProps = lastProps(lineChartRenderMock);
    expect(minutesDrawn(props)[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(axisMinutes(props)).toEqual([0, 9]);
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("the Reset zoom button puts the full extent back too", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);
    dragOn("line", at(3), at(6));

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([0, 9]);
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("zooming again inside a zoom narrows further, and one reset returns the whole extent", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);

    dragOn("line", at(2), at(8));
    dragOn("line", at(4), at(5));
    expect(minutesDrawn(lastProps(lineChartRenderMock))).toEqual([[4], [4]]);

    doubleClickOn("line");

    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([0, 9]);
  });

  test("a right-to-left drag is the same window", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);

    dragOn("line", at(6), at(3));

    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([3, 6]);
  });

  test("a drag that runs past the last point does not open an empty stretch after it", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);

    // The last bucket's end reaches a minute past the final point.
    dragOn("line", at(7), at(10));

    const props: CapturedWrapperProps = lastProps(lineChartRenderMock);
    expect(minutesDrawn(props)[0]).toEqual([7, 8, 9]);
    expect(axisMinutes(props)).toEqual([7, 9]);
  });

  test("a zoom into a stretch with no points still has its way back", () => {
    const widget: AIChatWidget = timeSeriesWidget({
      data: {
        series: [
          {
            name: "checkout",
            points: [
              { x: iso(0), y: 1 },
              { x: iso(9), y: 2 },
            ],
          },
        ],
        xIsTime: true,
      },
    });
    render(<ChartWidget widget={widget} />);

    dragOn("line", at(3), at(5));

    expect(minutesDrawn(lastProps(lineChartRenderMock))).toEqual([[]]);
    expect(screen.getByTestId("line-chart")).toHaveAttribute(
      "data-can-reset",
      "true",
    );

    doubleClickOn("line");

    expect(minutesDrawn(lastProps(lineChartRenderMock))).toEqual([[0, 9]]);
  });

  test("a zero-width selection is not a zoom", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);

    dragOn("line", at(4), at(4));

    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([0, 9]);
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("hands the chart its own handlers, and the reset only while zoomed", () => {
    render(<ChartWidget widget={timeSeriesWidget()} />);

    expect(lastProps(lineChartRenderMock).onTimeRangeSelect).toBeInstanceOf(
      Function,
    );
    expect(lastProps(lineChartRenderMock).onTimeRangeReset).toBeUndefined();
    expect(lastProps(lineChartRenderMock).disableTimeRangeZoom).toBe(false);

    dragOn("line", at(3), at(6));

    expect(lastProps(lineChartRenderMock).onTimeRangeReset).toBeInstanceOf(
      Function,
    );
  });

  test("never touches the widget's own data, which exports and citations read", () => {
    const widget: AIChatWidget = timeSeriesWidget();
    const before: JSONObject = JSONFunctions.serialize(
      widget.data as unknown as JSONObject,
    );

    render(<ChartWidget widget={widget} />);
    dragOn("line", at(3), at(6));

    expect(
      JSONFunctions.serialize(widget.data as unknown as JSONObject),
    ).toEqual(before);
  });

  test("a widget saved before xIsTime existed is still a time series", () => {
    const widget: AIChatWidget = timeSeriesWidget();
    delete widget.data.xIsTime;
    render(<ChartWidget widget={widget} />);

    dragOn("line", at(3), at(6));

    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([3, 6]);
  });
});

describe("AI chat bar chart", () => {
  test("a time-axis bar chart zooms the same way, still summing counts per bucket", () => {
    render(<ChartWidget widget={barWidget(true)} />);

    dragOn("bar", at(1), at(3));

    const props: CapturedWrapperProps = lastProps(barChartRenderMock);
    expect(minutesDrawn(props)).toEqual([[1, 2]]);
    expect(props.xAxis.options.aggregateType).toBe(XAxisAggregateType.Sum);

    doubleClickOn("bar");

    expect(minutesDrawn(lastProps(barChartRenderMock))).toEqual([
      [0, 1, 2, 3, 4, 5],
    ]);
  });

  test("a bar chart over categories does not zoom, and names no gesture", () => {
    render(<ChartWidget widget={barWidget(false)} />);

    const props: CapturedWrapperProps = lastProps(barChartRenderMock);
    expect(props.disableTimeRangeZoom).toBe(true);
    expect(props.onTimeRangeSelect).toBeUndefined();
    expect(screen.getByTestId("bar-chart")).toHaveAttribute(
      "data-can-zoom",
      "false",
    );
    expect(screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a bar chart over categories takes no zoom from a page that offers one", () => {
    render(
      <ZoomingPage>
        <ChartWidget widget={barWidget(false)} />
      </ZoomingPage>,
    );

    expect(screen.getByTestId("bar-chart")).toHaveAttribute(
      "data-can-zoom",
      "false",
    );
    dragOn("bar", at(1), at(3));

    expect(pageRangeChange).not.toHaveBeenCalled();
    // The page's own hint is not the chart's to show either.
    expect(screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toBeNull();
  });
});

describe("AI chat charts never retime the page behind them", () => {
  test("a drag on a chart in the chat zooms the chart, not the page", () => {
    render(
      <ZoomingPage>
        <WidgetRenderer widgets={[timeSeriesWidget()]} />
      </ZoomingPage>,
    );

    dragOn("line", at(3), at(6));

    expect(pageRangeChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([3, 6]);
  });

  test("a double-click on the chart undoes the chart's zoom, never the page's", () => {
    render(
      <ZoomingPage>
        <WidgetRenderer widgets={[timeSeriesWidget()]} />
      </ZoomingPage>,
    );

    // The page is zoomed by a chart of its own...
    fireEvent.click(screen.getByTestId("page-chart-drag"));
    expect(pageRangeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.CUSTOM,
    );

    // ...and the chat chart's double-click has nothing of the page's to undo.
    expect(screen.getByTestId("line-chart")).toHaveAttribute(
      "data-can-reset",
      "false",
    );
    doubleClickOn("line");

    expect(pageRangeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
  });

  test("the chart's Reset zoom is its own; the page keeps its own", () => {
    render(
      <ZoomingPage>
        <WidgetRenderer widgets={[timeSeriesWidget()]} />
      </ZoomingPage>,
    );

    fireEvent.click(screen.getByTestId("page-chart-drag"));
    dragOn("line", at(3), at(6));

    const resetButtons: Array<HTMLElement> = screen.getAllByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    expect(resetButtons).toHaveLength(2);

    // The chart's button (not the page's) undoes the chart's zoom only.
    const chartReset: HTMLElement = resetButtons.find(
      (button: HTMLElement): boolean => {
        return !screen.getByTestId("page-reset").contains(button);
      },
    )!;
    fireEvent.click(chartReset);

    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([0, 9]);
    expect(pageRangeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
  });

  test("two charts in one message zoom independently", () => {
    render(
      <WidgetRenderer
        widgets={[timeSeriesWidget(), { ...barWidget(true), id: "W3" }]}
      />,
    );

    dragOn("line", at(3), at(6));

    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([3, 6]);
    expect(minutesDrawn(lastProps(barChartRenderMock))).toEqual([
      [0, 1, 2, 3, 4, 5],
    ]);
  });
});

describe("a chart in an AI investigation's evidence rows", () => {
  const chartItem: InvestigationEvidenceItem = {
    citationId: "C1",
    toolName: "query_metrics",
    label: "p95 latency (10 points)",
    rowCount: 10,
    queryArguments: {},
    target: { type: AIChatCitationTargetType.Metrics },
    executedAt: "2026-09-28T10:10:00.000Z",
    canLoadRows: true,
  };

  test("zooms on its own inside an incident page that zooms, and never retimes it", async () => {
    postMock.mockImplementation(() => {
      return Promise.resolve({
        data: {
          citationId: "C1",
          toolName: "query_metrics",
          label: chartItem.label,
          rowCount: 10,
          isTruncated: false,
          executedAt: "2026-09-28T10:10:00.000Z",
          isPinnedToInvestigationTime: true,
          investigatedAt: "2026-09-28T10:10:00.000Z",
          widget: timeSeriesWidget() as unknown as JSONObject,
        },
      });
    });

    render(
      <ZoomingPage>
        <InvestigationEvidenceList
          items={[chartItem]}
          legacyEntries={[]}
          subjectType="incident"
          subjectId="33333333-3333-4333-8333-333333333333"
          runId="11111111-1111-4111-8111-111111111111"
          focusRequest={null}
        />
      </ZoomingPage>,
    );

    fireEvent.click(screen.getByRole("button", { name: /p95 latency/ }));
    await screen.findByTestId("line-chart");

    dragOn("line", at(3), at(6));
    await act(async () => {
      await Promise.resolve();
    });

    expect(axisMinutes(lastProps(lineChartRenderMock))).toEqual([3, 6]);
    expect(pageRangeChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
  });
});
