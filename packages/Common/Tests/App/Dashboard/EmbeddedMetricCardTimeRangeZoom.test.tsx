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
 * Issue #4105 on the card behind every embedded metric chart - the
 * Insights, Control Plane, Service Mesh, resource Metrics tabs, monitor
 * and SLO metric tabs, container detail pages:
 *
 *   - a drag on any chart in the card narrows the card's range and a
 *     double-click (or "Reset zoom" beside the card's picker) puts the
 *     previous range back - it used to narrow with no way back;
 *   - the card's extra charts (the rate charts rendered below the
 *     MetricView) zoom with it;
 *   - cards whose range the PAGE controls, inside a page that zooms, share
 *     one zoom: drag on one card, double-click on another.
 *
 * MetricView is stood in for (its own zoom handling has its own suite);
 * the stand-in records the handlers the card hands it, and each stand-in
 * shows the window the card resolved.
 */

type CapturedMetricView = {
  data: { startAndEndDate: { startValue: Date; endValue: Date } };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
};

const mockMetricViews: Array<CapturedMetricView> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedMetricView) => {
        mockMetricViews.push(props);
        return (
          <div data-testid="metric-view">
            {props.data.startAndEndDate.startValue.toISOString()}/
            {props.data.startAndEndDate.endValue.toISOString()}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

// The card's own picker: shows its range, and can pick "Past 1 Day".
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: { range: string }) => void;
    }) => {
      return (
        <button
          type="button"
          data-testid="card-picker"
          onClick={() => {
            props.onChange({ range: "Past 1 Day" });
          }}
        >
          {props.dashboardStartAndEndDate.range}
        </button>
      );
    },
  };
});

import EmbeddedMetricCard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomScope,
  useChartTimeRangeZoom,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:30:00.000Z");

const QUERY_CONFIGS: Array<MetricQueryConfigData> = [
  {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: {
      filterData: {
        metricName: "cpu.usage",
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  } as unknown as MetricQueryConfigData,
];

function latestMetricView(): CapturedMetricView {
  const last: CapturedMetricView | undefined =
    mockMetricViews[mockMetricViews.length - 1];
  if (!last) {
    throw new Error("MetricView has not rendered");
  }
  return last;
}

// An extra chart below the MetricView, reading the zoom the way charts do.
let mockExtraChartZoom: ChartTimeRangeZoomContextValue | null = null;
const ExtraChart: React.FunctionComponent = (): React.ReactElement => {
  mockExtraChartZoom = useChartTimeRangeZoom();
  return <div data-testid="extra-chart" />;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockMetricViews.length = 0;
  mockExtraChartZoom = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("EmbeddedMetricCard keeping its own zoom", () => {
  test("a drag narrows the card and offers a way back", () => {
    render(
      <EmbeddedMetricCard
        title="CPU"
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      />,
    );

    expect(latestMetricView().onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();

    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
    expect(screen.getByTestId("metric-view")).toHaveTextContent(
      `${ZOOM_START.toISOString()}/${ZOOM_END.toISOString()}`,
    );
    expect(latestMetricView().onTimeRangeReset).toBeInstanceOf(Function);
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("a double-click on the chart puts the card's range back", () => {
    render(
      <EmbeddedMetricCard
        title="CPU"
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      />,
    );

    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    act(() => {
      latestMetricView().onTimeRangeReset?.();
    });

    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(screen.getByTestId("metric-view")).toHaveTextContent(
      `2026-09-28T11:00:00.000Z/${NOW.toISOString()}`,
    );
    expect(latestMetricView().onTimeRangeReset).toBeUndefined();
  });

  test("the header's Reset zoom does what a double-click does", () => {
    render(
      <EmbeddedMetricCard
        title="CPU"
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      />,
    );

    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
  });

  test("picking a range in the card's picker ends the zoom", () => {
    render(
      <EmbeddedMetricCard
        title="CPU"
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      />,
    );

    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    fireEvent.click(screen.getByTestId("card-picker"));

    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
    expect(latestMetricView().onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("the extra charts below the MetricView zoom the card too", () => {
    render(
      <EmbeddedMetricCard
        title="Network"
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        renderExtraCharts={() => {
          return <ExtraChart />;
        }}
      />,
    );

    expect(mockExtraChartZoom).not.toBeNull();

    act(() => {
      mockExtraChartZoom?.onTimeRangeSelect(ZOOM_START, ZOOM_END);
    });

    expect(screen.getByTestId("metric-view")).toHaveTextContent(
      `${ZOOM_START.toISOString()}/${ZOOM_END.toISOString()}`,
    );
    // And the MetricView's charts can now reset what the extra chart did.
    expect(latestMetricView().onTimeRangeReset).toBeInstanceOf(Function);
    expect(mockExtraChartZoom?.onTimeRangeReset).toBeInstanceOf(Function);
  });

  test("children-only cards (custom charts, no queries) zoom as well", () => {
    render(
      <EmbeddedMetricCard
        title="Spend"
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      >
        <ExtraChart />
      </EmbeddedMetricCard>,
    );

    act(() => {
      mockExtraChartZoom?.onTimeRangeSelect(ZOOM_START, ZOOM_END);
    });

    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("a frameless (hideCard) card keeps its zoom and reset too", () => {
    render(
      <EmbeddedMetricCard
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        hideCard={true}
      />,
    );

    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });
});

describe("EmbeddedMetricCards whose range the page controls", () => {
  const Page: React.FunctionComponent<{ withScope: boolean }> = (props: {
    withScope: boolean;
  }): React.ReactElement => {
    const [timeRange, setTimeRange] = React.useState<RangeStartAndEndDateTime>({
      range: TimeRange.PAST_ONE_HOUR,
    });
    const cards: React.ReactElement = (
      <>
        <span data-testid="page-range">{timeRange.range}</span>
        <EmbeddedMetricCard
          title="CPU"
          queryConfigs={QUERY_CONFIGS}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        />
        <EmbeddedMetricCard
          title="Memory"
          queryConfigs={QUERY_CONFIGS}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        />
      </>
    );
    return props.withScope ? (
      <TimeRangeZoomScope
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      >
        {cards}
      </TimeRangeZoomScope>
    ) : (
      cards
    );
  };

  function viewsOfLastRender(): [CapturedMetricView, CapturedMetricView] {
    const last: Array<CapturedMetricView> = mockMetricViews.slice(-2);
    return [last[0]!, last[1]!];
  }

  test("inside a page that zooms, a drag on one card and a double-click on another work together", () => {
    render(<Page withScope={true} />);

    act(() => {
      viewsOfLastRender()[0].onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
    const [cpu, memory] = viewsOfLastRender();
    expect(cpu.onTimeRangeReset).toBeInstanceOf(Function);
    expect(memory.onTimeRangeReset).toBeInstanceOf(Function);

    act(() => {
      memory.onTimeRangeReset?.();
    });

    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(viewsOfLastRender()[0].onTimeRangeReset).toBeUndefined();
  });

  test("every card shows Reset zoom while the page is zoomed", () => {
    render(<Page withScope={true} />);

    act(() => {
      viewsOfLastRender()[1].onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(
      screen.getAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toHaveLength(2);
  });

  test("without a page scope a controlled card still zooms the page's range and can reset it", () => {
    render(<Page withScope={false} />);

    act(() => {
      viewsOfLastRender()[0].onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.CUSTOM,
    );

    act(() => {
      viewsOfLastRender()[0].onTimeRangeReset?.();
    });
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
  });

  test("a card whose range the page does NOT control keeps its own zoom, even inside a zooming page", () => {
    const Mixed: React.FunctionComponent = (): React.ReactElement => {
      const [timeRange, setTimeRange] =
        React.useState<RangeStartAndEndDateTime>({
          range: TimeRange.PAST_ONE_HOUR,
        });
      return (
        <TimeRangeZoomScope
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        >
          <span data-testid="page-range">{timeRange.range}</span>
          <EmbeddedMetricCard
            title="Standalone"
            queryConfigs={QUERY_CONFIGS}
            defaultTimeRange={{ range: TimeRange.PAST_ONE_DAY }}
          />
        </TimeRangeZoomScope>
      );
    };

    render(<Mixed />);

    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
  });

  test("a controlled card over a DIFFERENT range than the zooming page keeps its own zoom", () => {
    /*
     * A tab or drawer that owns a range of its own (the incident companion
     * metrics tab, the investigation drawer) rendered inside a page that
     * zooms: its drag must narrow its own range, and the page's reset must
     * not appear on it.
     */
    const PageWithOwnRangeTab: React.FunctionComponent =
      (): React.ReactElement => {
        const [pageRange, setPageRange] =
          React.useState<RangeStartAndEndDateTime>({
            range: TimeRange.PAST_ONE_HOUR,
          });
        const [tabRange, setTabRange] =
          React.useState<RangeStartAndEndDateTime>({
            range: TimeRange.PAST_ONE_DAY,
          });
        return (
          <TimeRangeZoomScope
            timeRange={pageRange}
            onTimeRangeChange={setPageRange}
          >
            <span data-testid="page-range">{pageRange.range}</span>
            <span data-testid="tab-range">{tabRange.range}</span>
            <EmbeddedMetricCard
              title="Tab metrics"
              queryConfigs={QUERY_CONFIGS}
              timeRange={tabRange}
              onTimeRangeChange={setTabRange}
            />
          </TimeRangeZoomScope>
        );
      };

    render(<PageWithOwnRangeTab />);

    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(screen.getByTestId("tab-range")).toHaveTextContent(TimeRange.CUSTOM);

    // Its own reset puts its own range back.
    act(() => {
      latestMetricView().onTimeRangeReset?.();
    });
    expect(screen.getByTestId("tab-range")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
  });

  test("a controlled window card (the page resolves the dates) asks the page to zoom", () => {
    const onTimeRangeChange: MockFunction = getJestMockFunction();
    render(
      <EmbeddedMetricCard
        title="Pinned"
        queryConfigs={QUERY_CONFIGS}
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={
          onTimeRangeChange as unknown as (
            timeRange: RangeStartAndEndDateTime,
          ) => void
        }
        startAndEndDate={
          new InBetween<Date>(new Date("2026-09-28T11:00:00.000Z"), NOW)
        }
      />,
    );

    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(onTimeRangeChange).toHaveBeenCalledTimes(1);
    const asked: RangeStartAndEndDateTime = onTimeRangeChange.mock
      .calls[0]![0] as RangeStartAndEndDateTime;
    expect(asked.range).toBe(TimeRange.CUSTOM);
    expect(asked.startAndEndDate?.startValue.toISOString()).toBe(
      ZOOM_START.toISOString(),
    );
  });
});
