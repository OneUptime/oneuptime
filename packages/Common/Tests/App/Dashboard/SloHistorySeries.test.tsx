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
  render,
  renderHook,
  RenderHookResult,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * useSloHistorySeries and the burn-down card built on it.
 *
 * The hook exists so the three details of reading SloHistory correctly —
 * an Avg aggregate rather than a truncating getList, sorted oldest first
 * (the server defaults to newest first), and Decimal values coerced from
 * strings — live in one place. Each of them is asserted against the REQUEST
 * the hook issues, and the memo contract (no refetch without a reason) is
 * asserted by counting requests.
 */

const aggregateMock: MockFunction = getJestMockFunction();
const lineChartRenderMock: MockFunction = getJestMockFunction();

// Lazy wrappers: jest.mock is hoisted above the mocks' own declarations.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>): unknown => {
        return aggregateMock(...args);
      },
    },
  };
});

/*
 * recharts measures a 0x0 parent in jsdom and draws nothing, so the card is
 * checked by what it hands the chart.
 */
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: LineChartStubProps): React.ReactElement => {
      lineChartRenderMock(props);
      return React.createElement(
        "div",
        { "data-testid": "line-chart" },
        `series:${props.data.length}`,
      );
    },
  };
});

import SloBudgetBurnDownCard, {
  BURN_DOWN_BUDGET_SERIES_NAME,
  BURN_DOWN_IDEAL_SERIES_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBudgetBurnDownCard";
import useSloHistorySeries, {
  UseSloHistorySeriesOptions,
  UseSloHistorySeriesResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloHistorySeries";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import SloHistory from "../../../Models/AnalyticsModels/SloHistory";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Route from "../../../Types/API/Route";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SloHistoryMetricName from "../../../Types/ServiceLevelObjective/SloHistoryMetricName";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import ChartReferenceLineProps from "../../../UI/Components/Charts/Types/ReferenceLineProps";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import { XAxis } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import DataPoint from "../../../UI/Components/Charts/Types/DataPoint";

interface LineChartStubProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  referenceLines?: Array<ChartReferenceLineProps> | undefined;
  showLegend?: boolean | undefined;
  ghostSeriesNames?: Array<string> | undefined;
}

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: {
    query: {
      projectId: ObjectID;
      sloId: ObjectID;
      metricName: string;
      bucketStart: InBetween<Date>;
    };
    aggregationType: AggregationType;
    aggregateColumnName: string;
    aggregationTimestampColumnName: string;
    aggregationInterval: AggregationInterval;
    startTimestamp: Date;
    endTimestamp: Date;
    sort: Record<string, unknown>;
    limit: number;
    skip: number;
  };
}

// A real UUID: ProjectUtil ignores a URL project id that is not one.
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");
const NOW: Date = new Date("2026-09-15T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;
const WINDOW_START: Date = new Date(NOW.getTime() - 30 * DAY_MS);

const THIRTY_DAYS: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(WINDOW_START, NOW),
};

type RequestAtFunction = (index: number) => AggregateRequest;

const requestAt: RequestAtFunction = (index: number): AggregateRequest => {
  return aggregateMock.mock.calls[index]![0] as AggregateRequest;
};

type ResolveRowsFunction = (
  rows: Array<{ timestamp: string; value: number | string }>,
) => void;

const resolveRows: ResolveRowsFunction = (
  rows: Array<{ timestamp: string; value: number | string }>,
): void => {
  aggregateMock.mockResolvedValue({ data: rows });
};

beforeEach(() => {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/slos/${SLO_ID.toString()}`,
  );
  aggregateMock.mockReset();
  lineChartRenderMock.mockReset();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("useSloHistorySeries", () => {
  type RenderSeriesHookFunction = (
    initialProps: UseSloHistorySeriesOptions,
  ) => RenderHookResult<UseSloHistorySeriesResult, UseSloHistorySeriesOptions>;

  const renderSeriesHook: RenderSeriesHookFunction = (
    initialProps: UseSloHistorySeriesOptions,
  ): RenderHookResult<
    UseSloHistorySeriesResult,
    UseSloHistorySeriesOptions
  > => {
    return renderHook(
      (props: UseSloHistorySeriesOptions): UseSloHistorySeriesResult => {
        return useSloHistorySeries(props);
      },
      { initialProps: initialProps },
    );
  };

  test("reads one averaged, oldest-first aggregate of the named series over the window", async () => {
    resolveRows([]);

    const { result } = renderSeriesHook({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.ErrorBudgetRemainingPercent,
      timeRange: THIRTY_DAYS,
      refreshToken: "a",
    });

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    expect(aggregateMock).toHaveBeenCalledTimes(1);

    const request: AggregateRequest = requestAt(0);

    expect(request.modelType).toBe(SloHistory);
    expect(request.aggregateBy.query.projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(request.aggregateBy.query.sloId).toBe(SLO_ID);
    expect(request.aggregateBy.query.metricName).toBe(
      "error.budget.remaining.percent",
    );
    expect(request.aggregateBy.query.bucketStart).toBeInstanceOf(InBetween);
    expect(request.aggregateBy.query.bucketStart.startValue).toBe(WINDOW_START);
    expect(request.aggregateBy.query.bucketStart.endValue).toBe(NOW);
    expect(request.aggregateBy.aggregationType).toBe(AggregationType.Avg);
    expect(request.aggregateBy.aggregateColumnName).toBe("value");
    expect(request.aggregateBy.aggregationTimestampColumnName).toBe(
      "bucketStart",
    );
    // 30 days is charted hourly (SloWidgetFormat.getSloChartAggregationInterval).
    expect(request.aggregateBy.aggregationInterval).toBe(
      AggregationInterval.Hour,
    );
    expect(result.current.aggregationInterval).toBe(AggregationInterval.Hour);
    expect(request.aggregateBy.startTimestamp).toBe(WINDOW_START);
    expect(request.aggregateBy.endTimestamp).toBe(NOW);
    expect(request.aggregateBy.sort).toEqual({
      bucketStart: SortOrder.Ascending,
    });
    expect(request.aggregateBy.limit).toBe(LIMIT_PER_PROJECT);
    expect(request.aggregateBy.skip).toBe(0);
  });

  test("coerces Decimal strings and drops rows that are not real points", async () => {
    resolveRows([
      { timestamp: "2026-09-01T00:00:00.000Z", value: "42.5" },
      { timestamp: "2026-09-01T01:00:00.000Z", value: 40 },
      { timestamp: "2026-09-01T02:00:00.000Z", value: "not a number" },
      { timestamp: "", value: 12 },
    ]);

    const { result } = renderSeriesHook({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.SliPercent,
      timeRange: THIRTY_DAYS,
    });

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    expect(
      result.current.points.map((point: DataPoint) => {
        return [(point.x as Date).toISOString(), point.y];
      }),
    ).toEqual([
      ["2026-09-01T00:00:00.000Z", 42.5],
      ["2026-09-01T01:00:00.000Z", 40],
    ]);
    expect(requestAt(0).aggregateBy.query.metricName).toBe("sli.percent");
  });

  test("does not refetch on a re-render; does on a new refresh token and on retry", async () => {
    resolveRows([]);

    const props: UseSloHistorySeriesOptions = {
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.BurnRate,
      timeRange: THIRTY_DAYS,
      refreshToken: "2026-09-15T11:55:00.000Z",
    };

    const { result, rerender } = renderSeriesHook(props);

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    rerender({ ...props });
    rerender({ ...props });
    expect(aggregateMock).toHaveBeenCalledTimes(1);

    rerender({ ...props, refreshToken: "2026-09-15T12:00:00.000Z" });
    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalledTimes(2);
    });

    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalledTimes(3);
    });
  });

  test("a relative range slides forward on a new refresh token, and only then", async () => {
    resolveRows([]);

    const pastDay: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_DAY };

    const { result, rerender } = renderSeriesHook({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.BurnRate,
      timeRange: pastDay,
      refreshToken: 1,
    });

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    const later: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(later);

    rerender({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.BurnRate,
      timeRange: pastDay,
      refreshToken: 1,
    });
    expect(aggregateMock).toHaveBeenCalledTimes(1);
    expect(result.current.endDate).toBe(NOW);

    rerender({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.BurnRate,
      timeRange: pastDay,
      refreshToken: 2,
    });

    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalledTimes(2);
    });
    expect(requestAt(1).aggregateBy.endTimestamp).toBe(later);
    // A 24-hour span is charted in 30-minute buckets.
    expect(requestAt(1).aggregateBy.aggregationInterval).toBe(
      AggregationInterval.ThirtyMinutes,
    );
  });

  test("a failed read reports the error and has not loaded", async () => {
    aggregateMock.mockRejectedValue(new Error("ClickHouse is unavailable."));

    const { result } = renderSeriesHook({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.SliPercent,
      timeRange: THIRTY_DAYS,
    });

    await waitFor(() => {
      expect(result.current.error).toBe("ClickHouse is unavailable.");
    });

    expect(result.current.hasLoaded).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.points).toEqual([]);
  });

  test("a disabled hook sends nothing", () => {
    const { result } = renderSeriesHook({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.SliPercent,
      timeRange: THIRTY_DAYS,
      isDisabled: true,
    });

    expect(aggregateMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  test("switching series drops the previous series' points", async () => {
    resolveRows([{ timestamp: "2026-09-01T00:00:00.000Z", value: 99.9 }]);

    const { result, rerender } = renderSeriesHook({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.SliPercent,
      timeRange: THIRTY_DAYS,
    });

    await waitFor(() => {
      expect(result.current.points).toHaveLength(1);
    });

    aggregateMock.mockReturnValue(new Promise<never>(() => {}));

    rerender({
      sloId: SLO_ID,
      metricName: SloHistoryMetricName.BurnRate,
      timeRange: THIRTY_DAYS,
    });

    await waitFor(() => {
      expect(result.current.points).toEqual([]);
    });
    expect(result.current.hasLoaded).toBe(false);
  });
});

describe("SloBudgetBurnDownCard", () => {
  // Partial<T> under exactOptionalPropertyTypes forbids the explicit undefined of an unset column.
  type SloOverrides = {
    [K in keyof ServiceLevelObjective]?: ServiceLevelObjective[K] | undefined;
  };

  type BuildSloFunction = (overrides: SloOverrides) => ServiceLevelObjective;

  const buildSlo: BuildSloFunction = (
    overrides: SloOverrides,
  ): ServiceLevelObjective => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.targetPercentage = 99.9;
    slo.windowType = SloWindowType.Rolling;
    slo.windowDays = 30;
    slo.timezone = "UTC";
    slo.atRiskThresholdPercentage = 25;
    slo.lastEvaluatedAt = new Date("2026-09-15T11:58:00.000Z");
    Object.assign(slo, overrides);
    return slo;
  };

  type CardElementFunction = (
    slo: ServiceLevelObjective,
    refreshToken: string,
  ) => React.ReactElement;

  const cardElement: CardElementFunction = (
    slo: ServiceLevelObjective,
    refreshToken: string,
  ): React.ReactElement => {
    return (
      <MemoryRouter>
        <SloBudgetBurnDownCard
          sloId={SLO_ID}
          slo={slo}
          refreshToken={refreshToken}
        />
      </MemoryRouter>
    );
  };

  type LastChartPropsFunction = () => LineChartStubProps;

  const lastChartProps: LastChartPropsFunction = (): LineChartStubProps => {
    const calls: Array<Array<unknown>> = lineChartRenderMock.mock.calls;
    return calls[calls.length - 1]![0] as LineChartStubProps;
  };

  test("a rolling window charts the budget over the last N days with the SLO's own lines", async () => {
    resolveRows([
      { timestamp: "2026-09-14T00:00:00.000Z", value: "80" },
      { timestamp: "2026-09-15T00:00:00.000Z", value: "62.5" },
    ]);

    render(cardElement(buildSlo({}), "t1"));

    expect(await screen.findByTestId("line-chart")).toHaveTextContent(
      "series:1",
    );

    const request: AggregateRequest = requestAt(0);
    expect(request.aggregateBy.query.metricName).toBe(
      SloHistoryMetricName.ErrorBudgetRemainingPercent,
    );
    expect(request.aggregateBy.startTimestamp.toISOString()).toBe(
      WINDOW_START.toISOString(),
    );
    expect(request.aggregateBy.endTimestamp.toISOString()).toBe(
      NOW.toISOString(),
    );

    const props: LineChartStubProps = lastChartProps();

    expect(props.data[0]!.seriesName).toBe(BURN_DOWN_BUDGET_SERIES_NAME);
    expect(props.data[0]!.data).toHaveLength(2);
    expect(props.showLegend).toBe(false);
    expect(props.ghostSeriesNames).toBeUndefined();
    expect((props.xAxis.options.min as Date).toISOString()).toBe(
      WINDOW_START.toISOString(),
    );
    expect((props.xAxis.options.max as Date).toISOString()).toBe(
      NOW.toISOString(),
    );
    // Pinned to the data's real bucket size.
    expect(props.xAxis.options.precision).toBe(XAxisPrecision.EVERY_HOUR);
    expect(
      props.referenceLines!.map((line: ChartReferenceLineProps) => {
        return [line.value, line.label];
      }),
    ).toEqual([
      [0, "Budget exhausted"],
      [25, "At risk (25%)"],
    ]);

    expect(screen.getByRole("link", { name: "Open metrics" })).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.SLO_VIEW_METRICS] as Route,
        { modelId: SLO_ID },
      ).toString(),
    );
  });

  test("a calendar month runs to the reset and adds the even-burn line", async () => {
    resolveRows([{ timestamp: "2026-09-10T00:00:00.000Z", value: "70" }]);

    render(
      cardElement(
        buildSlo({ windowType: SloWindowType.CalendarMonth, timezone: "UTC" }),
        "t1",
      ),
    );

    expect(await screen.findByTestId("line-chart")).toHaveTextContent(
      "series:2",
    );

    // The whole month is fetched, so the bucket size suits a month-long axis.
    const request: AggregateRequest = requestAt(0);
    expect(request.aggregateBy.startTimestamp.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(request.aggregateBy.endTimestamp.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(request.aggregateBy.aggregationInterval).toBe(
      AggregationInterval.Hour,
    );

    const props: LineChartStubProps = lastChartProps();
    const ideal: SeriesPoint = props.data[1]!;

    expect(ideal.seriesName).toBe(BURN_DOWN_IDEAL_SERIES_NAME);
    expect(ideal.data[0]!.y).toBe(100);
    expect((ideal.data[0]!.x as Date).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(ideal.data[ideal.data.length - 1]!.y).toBe(0);
    expect((ideal.data[ideal.data.length - 1]!.x as Date).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    // One point per hourly bucket across 30 days, plus the reset itself.
    expect(ideal.data).toHaveLength(30 * 24 + 1);

    expect(props.ghostSeriesNames).toEqual([BURN_DOWN_IDEAL_SERIES_NAME]);
    expect(props.showLegend).toBe(true);
    expect((props.xAxis.options.max as Date).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  test("no history yet shows an explanation, not an empty chart", async () => {
    resolveRows([]);

    render(cardElement(buildSlo({ lastEvaluatedAt: undefined }), ""));

    expect(await screen.findByTestId("slo-burn-down-empty")).toHaveTextContent(
      "No budget history yet",
    );
    expect(screen.queryByTestId("line-chart")).toBeNull();
    cleanup();

    render(cardElement(buildSlo({}), "t1"));

    expect(await screen.findByTestId("slo-burn-down-empty")).toHaveTextContent(
      "No budget history in this window yet",
    );
  });

  test("a failed first read shows the error", async () => {
    aggregateMock.mockRejectedValue(new Error("History is unavailable."));

    render(cardElement(buildSlo({}), "t1"));

    expect(
      await screen.findByText("History is unavailable."),
    ).toBeInTheDocument();
  });

  test("re-reads history only when the refresh token (the last evaluation) changes", async () => {
    resolveRows([{ timestamp: "2026-09-15T00:00:00.000Z", value: "62.5" }]);

    const slo: ServiceLevelObjective = buildSlo({});

    const { rerender }: RenderResult = render(cardElement(slo, "t1"));

    await screen.findByTestId("line-chart");
    expect(aggregateMock).toHaveBeenCalledTimes(1);

    // The page re-renders on every poll; the same evaluation means no new rows.
    rerender(cardElement(slo, "t1"));
    rerender(cardElement(slo, "t1"));
    expect(aggregateMock).toHaveBeenCalledTimes(1);

    rerender(cardElement(slo, "t2"));
    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalledTimes(2);
    });
  });
});
