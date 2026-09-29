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
 * Refresh on an EmbeddedMetricCard while it is zoomed (issue #4105 review).
 *
 * Every zoom leaves the card on a Custom window, and a Custom window
 * re-resolves to the very same instants. So Refresh changed nothing a
 * window-keyed fetch could see: the rate charts inside the card (Ceph,
 * Proxmox, the Kubernetes network chart) and pages that load the card's
 * data themselves (the Kubernetes Costs pages) kept their data, including
 * an error they could have retried. The card now hands its refresh count to
 * everything it renders, and tells the page through onRefresh.
 */

type CapturedMetricView = {
  refreshNonce?: number | undefined;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
};

const mockMetricViews: Array<CapturedMetricView> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedMetricView) => {
        mockMetricViews.push(props);
        return <div data-testid="metric-view" />;
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

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: { dashboardStartAndEndDate: { range: string } }) => {
      return (
        <span data-testid="card-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
      );
    },
  };
});

import EmbeddedMetricCard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard";
import { useEmbeddedMetricCardRefreshNonce } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCardRefresh";
import { useChartTimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
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

// A chart that fetches its own data, the way the rate charts do.
const RateChart: React.FunctionComponent<{ name: string }> = (props: {
  name: string;
}): React.ReactElement => {
  const refreshNonce: number = useEmbeddedMetricCardRefreshNonce();
  const zoom: ReturnType<typeof useChartTimeRangeZoom> =
    useChartTimeRangeZoom();
  return (
    <button
      type="button"
      data-testid={`${props.name}-chart`}
      data-refresh-nonce={refreshNonce}
      onClick={() => {
        zoom?.onTimeRangeSelect(ZOOM_START, ZOOM_END);
      }}
    />
  );
};

function nonceOf(name: string): string | null {
  return screen.getByTestId(`${name}-chart`).getAttribute("data-refresh-nonce");
}

function latestMetricView(): CapturedMetricView {
  const last: CapturedMetricView | undefined =
    mockMetricViews[mockMetricViews.length - 1];
  if (!last) {
    throw new Error("MetricView has not rendered");
  }
  return last;
}

function pressRefresh(index: number = 0): void {
  fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[index]!);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockMetricViews.length = 0;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("EmbeddedMetricCard Refresh reaches everything the card renders", () => {
  test("a zoomed card's Refresh reloads its children and extra charts, not only the MetricView", () => {
    render(
      <EmbeddedMetricCard
        title="Client I/O"
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        renderExtraCharts={() => {
          return <RateChart name="extra" />;
        }}
      >
        <RateChart name="child" />
      </EmbeddedMetricCard>,
    );
    expect(nonceOf("child")).toBe("0");
    expect(nonceOf("extra")).toBe("0");

    // Zoom from the child chart: the card is now on a Custom window.
    fireEvent.click(screen.getByTestId("child-chart"));
    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );

    pressRefresh();
    expect(nonceOf("child")).toBe("1");
    expect(nonceOf("extra")).toBe("1");
    expect(latestMetricView().refreshNonce).toBe(1);

    pressRefresh();
    expect(nonceOf("child")).toBe("2");
    expect(nonceOf("extra")).toBe("2");
  });

  test("a children-only card (no queries) passes the count on too", () => {
    render(
      <EmbeddedMetricCard title="Spend">
        <RateChart name="child" />
      </EmbeddedMetricCard>,
    );

    pressRefresh();
    expect(nonceOf("child")).toBe("1");
    expect(screen.queryByTestId("metric-view")).toBeNull();
  });

  test("a frameless card passes the count on as well", () => {
    render(
      <EmbeddedMetricCard hideCard={true}>
        <RateChart name="child" />
      </EmbeddedMetricCard>,
    );

    pressRefresh();
    expect(nonceOf("child")).toBe("1");
  });

  test("outside any card a chart reads 0", () => {
    render(<RateChart name="loose" />);

    expect(nonceOf("loose")).toBe("0");
  });

  test("a chart reads the card around it, not an outer one", () => {
    render(
      <EmbeddedMetricCard title="Outer">
        <div>
          <RateChart name="outer" />
          <EmbeddedMetricCard title="Inner">
            <RateChart name="inner" />
          </EmbeddedMetricCard>
        </div>
      </EmbeddedMetricCard>,
    );

    // The inner card's Refresh is the second in document order.
    pressRefresh(1);
    expect(nonceOf("inner")).toBe("1");
    expect(nonceOf("outer")).toBe("0");

    pressRefresh(0);
    expect(nonceOf("outer")).toBe("1");
    expect(nonceOf("inner")).toBe("1");
  });
});

describe("EmbeddedMetricCard tells the page about a Refresh", () => {
  test("a card over a page-owned window asks the page to re-resolve, then calls onRefresh", () => {
    const calls: Array<string> = [];
    const onTimeRangeChange: MockFunction = getJestMockFunction();
    onTimeRangeChange.mockImplementation(() => {
      calls.push("onTimeRangeChange");
    });
    const onRefresh: MockFunction = getJestMockFunction();
    onRefresh.mockImplementation(() => {
      calls.push("onRefresh");
    });
    const zoomed: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(ZOOM_START, ZOOM_END),
    };

    render(
      <EmbeddedMetricCard
        title="Spend"
        timeRange={zoomed}
        onTimeRangeChange={
          onTimeRangeChange as unknown as (
            value: RangeStartAndEndDateTime,
          ) => void
        }
        startAndEndDate={zoomed.startAndEndDate}
        onRefresh={onRefresh as unknown as () => void}
      >
        <RateChart name="child" />
      </EmbeddedMetricCard>,
    );

    pressRefresh();

    expect(onTimeRangeChange).toHaveBeenCalledWith(zoomed);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["onTimeRangeChange", "onRefresh"]);
    expect(nonceOf("child")).toBe("1");
  });

  test("a card that resolves its own window calls onRefresh too", () => {
    const onRefresh: MockFunction = getJestMockFunction();

    render(
      <EmbeddedMetricCard
        title="Network"
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onRefresh={onRefresh as unknown as () => void}
      />,
    );

    pressRefresh();
    pressRefresh();

    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  test("nothing calls onRefresh but the Refresh button", () => {
    const onRefresh: MockFunction = getJestMockFunction();

    render(
      <EmbeddedMetricCard
        title="Network"
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onRefresh={onRefresh as unknown as () => void}
      />,
    );
    act(() => {
      latestMetricView().onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
