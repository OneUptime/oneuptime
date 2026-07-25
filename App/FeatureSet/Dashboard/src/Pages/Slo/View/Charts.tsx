import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SloHistory from "Common/Models/AnalyticsModels/SloHistory";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
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
  useState,
} from "react";

const SLI_METRIC_NAME: string = "sli.percent";
const BUDGET_METRIC_NAME: string = "error.budget.remaining.percent";
const BURN_RATE_METRIC_NAME: string = "burn.rate";

/* Rows are 1/min — cap what we hand to the chart for long ranges. */
const MAX_CHART_POINTS: number = 2000;

const EMPTY_MESSAGE: string =
  "No history yet — the SLO is evaluated every few minutes.";

type DownsampleFunction = (points: Array<DataPoint>) => Array<DataPoint>;

const downsample: DownsampleFunction = (
  points: Array<DataPoint>,
): Array<DataPoint> => {
  if (points.length <= MAX_CHART_POINTS) {
    return points;
  }
  const step: number = Math.ceil(points.length / MAX_CHART_POINTS);
  const sampled: Array<DataPoint> = points.filter(
    (_point: DataPoint, index: number) => {
      return index % step === 0;
    },
  );
  /* Always keep the newest point so the chart ends at "now". */
  const lastPoint: DataPoint | undefined = points[points.length - 1];
  if (lastPoint && sampled[sampled.length - 1] !== lastPoint) {
    sampled.push(lastPoint);
  }
  return sampled;
};

const SloCharts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rangeDays, setRangeDays] = useState<number>(30);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [targetPercentage, setTargetPercentage] = useState<number | null>(null);
  const [sliPoints, setSliPoints] = useState<Array<DataPoint>>([]);
  const [budgetPoints, setBudgetPoints] = useState<Array<DataPoint>>([]);
  const [burnRatePoints, setBurnRatePoints] = useState<Array<DataPoint>>([]);

  type FetchSeriesFunction = (
    metricName: string,
    startDate: Date,
    endDate: Date,
  ) => Promise<Array<DataPoint>>;

  const fetchSeries: FetchSeriesFunction = async (
    metricName: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<DataPoint>> => {
    const result: ListResult<SloHistory> =
      await AnalyticsModelAPI.getList<SloHistory>({
        modelType: SloHistory,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          sloId: modelId,
          metricName: metricName,
          bucketStart: new InBetween(startDate, endDate),
        },
        select: {
          bucketStart: true,
          value: true,
        },
        sort: {
          bucketStart: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const points: Array<DataPoint> = [];

    for (const row of result.data) {
      const bucketStart: Date | undefined = row.bucketStart;
      const value: number | undefined | null = row.value;

      if (bucketStart === undefined || value === undefined || value === null) {
        continue;
      }
      points.push({
        x: OneUptimeDate.fromString(bucketStart),
        y: value,
      });
    }

    return downsample(points);
  };

  useEffect(() => {
    let cancelled: boolean = false;

    const load: PromiseVoidFunction = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const endDate: Date = OneUptimeDate.getCurrentDate();
        const startDate: Date = OneUptimeDate.getSomeDaysAgo(rangeDays);

        const [slo, sli, budget, burnRate]: [
          ServiceLevelObjective | null,
          Array<DataPoint>,
          Array<DataPoint>,
          Array<DataPoint>,
        ] = await Promise.all([
          ModelAPI.getItem<ServiceLevelObjective>({
            modelType: ServiceLevelObjective,
            id: modelId,
            select: {
              targetPercentage: true,
            },
          }),
          fetchSeries(SLI_METRIC_NAME, startDate, endDate),
          fetchSeries(BUDGET_METRIC_NAME, startDate, endDate),
          fetchSeries(BURN_RATE_METRIC_NAME, startDate, endDate),
        ]);

        if (cancelled) {
          return;
        }

        const target: number | undefined | null = slo?.targetPercentage;
        setTargetPercentage(
          target === undefined || target === null ? null : target,
        );
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

    load().catch((err: Error) => {
      if (!cancelled) {
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rangeDays]);

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
    if (isLoading) {
      return <div className="h-48 animate-pulse rounded-md bg-gray-50" />;
    }

    if (options.points.length === 0) {
      return (
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          {EMPTY_MESSAGE}
        </div>
      );
    }

    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.getSomeDaysAgo(rangeDays);

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

  const rangeOptions: Array<number> = [7, 30, 90];
  const syncId: string = `slo-charts-${modelId.toString()}`;

  const sliReferenceLines: Array<ChartReferenceLineProps> | undefined =
    targetPercentage !== null
      ? [
          {
            value: targetPercentage,
            label: `Target ${targetPercentage}%`,
            color: "#f59e0b",
            strokeDasharray: "4 4",
          },
        ]
      : undefined;

  return (
    <Fragment>
      <div className="mb-4 flex justify-end">
        <div className="inline-flex rounded-md shadow-sm" role="group">
          {rangeOptions.map((days: number) => {
            return (
              <button
                key={days}
                type="button"
                onClick={() => {
                  setRangeDays(days);
                }}
                className={`border border-gray-200 px-3 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md ${
                  rangeDays === days
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {days}d
              </button>
            );
          })}
        </div>
      </div>

      {error && <ErrorMessage message={error} />}

      {!error && (
        <Fragment>
          <Card
            title="SLI"
            description="Service Level Indicator over time, with the SLO target as a reference line."
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
            description="Percentage of the error budget that remains. Negative values mean the budget is overspent."
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
              syncId: syncId,
            })}
          </Card>

          <Card
            title="Burn Rate"
            description="How fast the error budget is being spent. A burn rate of 1 spends the budget exactly over the window."
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
              syncId: syncId,
            })}
          </Card>
        </Fragment>
      )}
    </Fragment>
  );
};

export default SloCharts;
