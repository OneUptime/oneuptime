import PageComponentProps from "../../PageComponentProps";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import SloHistory from "Common/Models/AnalyticsModels/SloHistory";
import { DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE } from "Common/Utils/Slo/SloHealth";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import { getSloChartAggregationInterval } from "Common/Utils/Slo/SloWidgetFormat";
import { formatDurationCompact } from "Common/Utils/Slo/SloDuration";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import ChartReferenceLineProps from "Common/UI/Components/Charts/Types/ReferenceLineProps";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

const SLI_METRIC_NAME: string = "sli.percent";
const BUDGET_METRIC_NAME: string = "error.budget.remaining.percent";
const BURN_RATE_METRIC_NAME: string = "burn.rate";

/** Keep the charts in step with the worker's evaluation cadence. */
const AUTO_REFRESH_MS: number = 60 * 1000;

const TARGET_LINE_COLOR: string = "#f59e0b";
const AT_RISK_LINE_COLOR: string = "#f59e0b";
const EXHAUSTED_LINE_COLOR: string = "#ef4444";
const BURN_RULE_LINE_COLOR: string = "#ef4444";

/*
 * Series are read through SloHistory's `/aggregate` endpoint rather
 * than `getList`.
 *
 * The evaluation worker writes one row per metric per SLO every 5
 * minutes (288 rows/day/series), so a 90-day window holds ~26k rows per
 * series. `AnalyticsModelAPI.getList` does not paginate: a single page
 * capped at LIMIT_PER_PROJECT (10k) returned only the OLDEST ~35 days
 * while the x-axis stayed pinned to [now - 90d, now], so the line
 * stopped a third of the way across and read as "history stopped being
 * written". Aggregating server-side bounds the response by the WINDOW
 * instead of by the row count.
 *
 * Bucket size comes from the shared getSloChartAggregationInterval, which
 * the dashboard SLO widget already uses and which is unit-tested for
 * arbitrary spans — the range picker below can produce any span, so the
 * page can no longer pin a bucket size per hardcoded range. The
 * aggregation's GROUP BY on the bucketed timestamp also collapses
 * duplicate rows for one bucket, so the rare un-merged double write that
 * a ReplacingMergeTree can expose to readers before a merge cannot render
 * as two points at the same x.
 */
const SloCharts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_MONTH,
  });
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [targetPercentage, setTargetPercentage] = useState<number | null>(null);
  const [atRiskThresholdPercentage, setAtRiskThresholdPercentage] = useState<
    number | null
  >(null);
  const [burnRateRules, setBurnRateRules] = useState<
    Array<ServiceLevelObjectiveBurnRateRule>
  >([]);
  const [sliPoints, setSliPoints] = useState<Array<DataPoint>>([]);
  const [budgetPoints, setBudgetPoints] = useState<Array<DataPoint>>([]);
  const [burnRatePoints, setBurnRatePoints] = useState<Array<DataPoint>>([]);

  type FetchSeriesFunction = (
    metricName: string,
    startDate: Date,
    endDate: Date,
    aggregationInterval: AggregationInterval,
  ) => Promise<Array<DataPoint>>;

  const fetchSeries: FetchSeriesFunction = async (
    metricName: string,
    startDate: Date,
    endDate: Date,
    aggregationInterval: AggregationInterval,
  ): Promise<Array<DataPoint>> => {
    const result: AggregatedResult =
      await AnalyticsModelAPI.aggregate<SloHistory>({
        modelType: SloHistory,
        aggregateBy: {
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            sloId: modelId,
            metricName: metricName,
            bucketStart: new InBetween(startDate, endDate),
          },
          /*
           * SLI %, remaining budget % and burn rate are all
           * instantaneous gauges, so averaging the buckets that fall
           * inside one chart point is the right roll-up.
           */
          aggregationType: AggregationType.Avg,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "bucketStart",
          aggregationInterval: aggregationInterval,
          startTimestamp: startDate,
          endTimestamp: endDate,
          /*
           * Oldest → newest so the line renders left to right; the
           * server defaults this sort to DESCENDING when omitted.
           */
          sort: {
            bucketStart: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        },
      });

    const points: Array<DataPoint> = [];

    /*
     * One row per non-empty bucket, already ordered oldest → newest.
     * `value` can arrive as a string because `SloHistory.value` is a
     * ClickHouse Decimal, so coerce before charting.
     */
    for (const row of result.data) {
      const value: number = Number(row.value);

      if (!row.timestamp || !isFinite(value)) {
        continue;
      }

      points.push({
        x: OneUptimeDate.fromString(row.timestamp),
        y: value,
      });
    }

    return points;
  };

  /*
   * The window MUST be memoised. A relative range ("Past 1 Month") resolves
   * against `now`, so recomputing it inline on every render would hand the
   * load effect two new timestamps each time it set state — an unbounded
   * render/fetch loop. It is recomputed only when the user picks a
   * different range, or when the refresh tick fires and the window should
   * genuinely slide forward.
   */
  const { startDate, endDate } = useMemo((): {
    startDate: Date;
    endDate: Date;
  } => {
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    return {
      startDate: range.startValue as Date,
      endDate: range.endValue as Date,
    };
  }, [timeRange, refreshTick]);

  const startTime: number = startDate.getTime();
  const endTime: number = endDate.getTime();

  /*
   * The worker writes a new bucket every few minutes, so a chart left open
   * during an incident should grow rather than freeze. Bumping the tick
   * slides the window, which re-runs the load effect below.
   */
  useEffect(() => {
    const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
      setRefreshTick((tick: number) => {
        return tick + 1;
      });
    }, AUTO_REFRESH_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  /*
   * Keyed on the SAME inputs the window memo is keyed on, never on the
   * resolved timestamps. A custom range resolves to the exact dates the
   * user picked, so re-applying it — or hitting Refresh on an error —
   * produces identical timestamps and would silently skip the reload,
   * stranding whatever loading or error state is on screen. Keying on the
   * memo's own inputs costs at most one redundant refetch and can never
   * strand the page.
   */
  useEffect(() => {
    let cancelled: boolean = false;

    const load: PromiseVoidFunction = async (): Promise<void> => {
      setError("");

      try {
        const spanInMinutes: number = (endTime - startTime) / (60 * 1000);
        const aggregationInterval: AggregationInterval =
          getSloChartAggregationInterval(spanInMinutes);

        const [slo, rules, sli, budget, burnRate]: [
          ServiceLevelObjective | null,
          ListResult<ServiceLevelObjectiveBurnRateRule>,
          Array<DataPoint>,
          Array<DataPoint>,
          Array<DataPoint>,
        ] = await Promise.all([
          ModelAPI.getItem<ServiceLevelObjective>({
            modelType: ServiceLevelObjective,
            id: modelId,
            select: {
              targetPercentage: true,
              atRiskThresholdPercentage: true,
            },
          }),
          /*
           * Enabled rules only: a disabled rule's threshold is not a line
           * anyone is being measured against.
           */
          ModelAPI.getList<ServiceLevelObjectiveBurnRateRule>({
            modelType: ServiceLevelObjectiveBurnRateRule,
            query: {
              serviceLevelObjectiveId: modelId,
              projectId: ProjectUtil.getCurrentProjectId()!,
              isEnabled: true,
            },
            select: {
              name: true,
              burnRateThreshold: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              burnRateThreshold: SortOrder.Ascending,
            },
          }),
          fetchSeries(SLI_METRIC_NAME, startDate, endDate, aggregationInterval),
          fetchSeries(
            BUDGET_METRIC_NAME,
            startDate,
            endDate,
            aggregationInterval,
          ),
          fetchSeries(
            BURN_RATE_METRIC_NAME,
            startDate,
            endDate,
            aggregationInterval,
          ),
        ]);

        if (cancelled) {
          return;
        }

        const target: number | undefined | null = slo?.targetPercentage;
        setTargetPercentage(
          target === undefined || target === null ? null : target,
        );

        const atRisk: number | undefined | null =
          slo?.atRiskThresholdPercentage;
        setAtRiskThresholdPercentage(
          atRisk === undefined || atRisk === null ? null : atRisk,
        );

        setBurnRateRules(rules.data);
        setSliPoints(sli);
        setBudgetPoints(budget);
        setBurnRatePoints(burnRate);
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    setIsLoading(true);

    load().catch((err: Error) => {
      if (!cancelled) {
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [timeRange, refreshTick]);

  type GetChartFunction = (options: {
    points: Array<DataPoint>;
    seriesName: string;
    yAxisLegend: string;
    yAxisMin: number | "auto";
    yAxisMax: number | "auto";
    formatter: (value: number) => string;
    referenceLines?: Array<ChartReferenceLineProps> | undefined;
    syncId: string;
  }) => ReactElement;

  const getChart: GetChartFunction = (options: {
    points: Array<DataPoint>;
    seriesName: string;
    yAxisLegend: string;
    yAxisMin: number | "auto";
    yAxisMax: number | "auto";
    formatter: (value: number) => string;
    referenceLines?: Array<ChartReferenceLineProps> | undefined;
    syncId: string;
  }): ReactElement => {
    /*
     * The loader replaces the chart only when there is nothing else to
     * show. A background refresh — or a range change while data from the
     * previous range is still on screen — keeps the existing lines up
     * instead of flashing a spinner every minute.
     */
    if (isLoading && options.points.length === 0) {
      return <ComponentLoader />;
    }

    if (options.points.length === 0) {
      /*
       * The negative margin is the established way to fit EmptyState
       * inside a Card without the card growing to the empty state's own
       * generous padding.
       */
      return (
        <div className="-my-16">
          <EmptyState
            id={`slo-chart-empty-${options.seriesName}`}
            icon={IconProp.Graph}
            title="No history in this range"
            description="SLOs are evaluated every few minutes. Widen the time range, or wait for the next evaluation if this SLO was created recently."
          />
        </div>
      );
    }

    const xAxis: ChartXAxis = {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: startDate,
        max: endDate,
        aggregateType: XAxisAggregateType.Average,
      },
    };

    const yAxis: YAxis = {
      legend: options.yAxisLegend,
      options: {
        type: YAxisType.Number,
        min: options.yAxisMin,
        max: options.yAxisMax,
        precision: YAxisPrecision.TwoDecimals,
        formatter: options.formatter,
      },
    };

    const series: Array<SeriesPoint> = [
      {
        seriesName: options.seriesName,
        data: options.points,
      },
    ];

    return (
      <LineChartElement
        data={series}
        xAxis={xAxis}
        yAxis={yAxis}
        curve={ChartCurve.MONOTONE}
        heightInPx={300}
        showLegend={false}
        sync={true}
        syncid={options.syncId}
        referenceLines={options.referenceLines}
      />
    );
  };

  const syncId: string = `slo-charts-${modelId.toString()}`;

  const sliReferenceLines: Array<ChartReferenceLineProps> | undefined =
    targetPercentage !== null
      ? [
          {
            value: targetPercentage,
            label: `Target ${targetPercentage}%`,
            color: TARGET_LINE_COLOR,
            strokeDasharray: "4 4",
          },
        ]
      : undefined;

  /*
   * The two boundaries the SLO's own status is computed against, so a dip
   * on the chart can be read as "that is when it went At Risk" instead of
   * requiring the reader to remember the threshold.
   */
  const budgetReferenceLines: Array<ChartReferenceLineProps> = [
    {
      value: 0,
      label: "Budget exhausted",
      color: EXHAUSTED_LINE_COLOR,
    },
    {
      value: atRiskThresholdPercentage ?? DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
      label: "At risk",
      color: AT_RISK_LINE_COLOR,
      strokeDasharray: "4 4",
    },
  ];

  const burnRateReferenceLines: Array<ChartReferenceLineProps> = burnRateRules
    .filter((rule: ServiceLevelObjectiveBurnRateRule) => {
      return (
        rule.burnRateThreshold !== undefined &&
        rule.burnRateThreshold !== null &&
        isFinite(rule.burnRateThreshold)
      );
    })
    .map((rule: ServiceLevelObjectiveBurnRateRule) => {
      return {
        value: rule.burnRateThreshold!,
        label: `${rule.name || "Rule"} ${rule.burnRateThreshold}×`,
        color: BURN_RULE_LINE_COLOR,
        strokeDasharray: "4 4",
      };
    });

  const burnRateWindowText: string = formatDurationCompact(
    SLO_CURRENT_BURN_RATE_WINDOW_MINUTES * 60,
  );

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />

      {/*
       * The error sits ABOVE the cards rather than replacing them: the
       * range picker lives on the first card, and hiding it on a transient
       * fetch failure would strand the user — with a fixed custom range
       * nothing else would ever retrigger the load.
       */}
      {error && (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setRefreshTick((tick: number) => {
              return tick + 1;
            });
          }}
        />
      )}

      <Card
        title="SLI"
        description="Service Level Indicator over time, with the SLO target as a reference line."
        rightElement={
          <RangeStartAndEndDateView
            dashboardStartAndEndDate={timeRange}
            onChange={(newRange: RangeStartAndEndDateTime) => {
              setTimeRange(newRange);
            }}
          />
        }
      >
        {getChart({
          points: sliPoints,
          seriesName: "SLI %",
          yAxisLegend: "%",
          yAxisMin: "auto",
          yAxisMax: 100,
          formatter: (value: number): string => {
            return `${Math.round(value * 1000) / 1000}%`;
          },
          referenceLines: sliReferenceLines,
          syncId: syncId,
        })}
      </Card>

      <Card
        title="Error Budget Remaining"
        description="Percentage of the error budget that remains, with the at-risk and exhausted boundaries marked. Negative values mean the budget is overspent."
      >
        {getChart({
          points: budgetPoints,
          seriesName: "Budget Remaining %",
          yAxisLegend: "%",
          yAxisMin: "auto",
          yAxisMax: 100,
          formatter: (value: number): string => {
            return `${Math.round(value * 100) / 100}%`;
          },
          referenceLines: budgetReferenceLines,
          syncId: syncId,
        })}
      </Card>

      <Card
        title="Burn Rate"
        description={`Error-budget burn measured over the trailing ${burnRateWindowText}. A burn rate of 1 spends the budget exactly over the compliance window. Dashed lines are the thresholds of this SLO's enabled burn rate rules.`}
      >
        {getChart({
          points: burnRatePoints,
          seriesName: "Burn Rate",
          yAxisLegend: "×",
          yAxisMin: 0,
          yAxisMax: "auto",
          formatter: (value: number): string => {
            return `${Math.round(value * 100) / 100}×`;
          },
          referenceLines: burnRateReferenceLines,
          syncId: syncId,
        })}
      </Card>
    </Fragment>
  );
};

export default SloCharts;
