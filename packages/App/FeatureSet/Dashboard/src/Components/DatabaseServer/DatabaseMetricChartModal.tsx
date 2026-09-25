import ChartCard from "../TelemetryResource/ChartCard";
import {
  DatabaseMetricChartSpec,
  DatabaseMetricShape,
  DatabaseTimePoint,
  UNKNOWN_DATABASE_METRIC_SHAPE,
  fetchDatabaseMetricChartSeries,
  fetchDatabaseMetricShape,
  getDatabaseMetricChartSpec,
} from "../../Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  DatabaseChartYAxis,
  formatDatabaseMetricAxisValue,
  formatDatabaseMetricUnitAxisValue,
  getDatabaseChartYAxis,
  getDatabaseMetricAxisUnitLabel,
  getDatabaseMetricUnitAxisLabel,
  isDatabaseMetricUnitWholeNumber,
  isDatabaseMetricWholeNumberUnit,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import {
  buildDatabaseMetricMonitorRoute,
  buildDatabaseMetricMonitorViewData,
  fetchDatabaseMetricCarriesServerId,
  getDatabaseMetricMonitorBlocker,
  getDatabaseMetricMonitorSeed,
} from "../../Pages/Database/Utils/DatabaseMetricMonitorLink";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { findDatabaseServerMetricByName } from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * A database's Metrics tab charts a clicked metric HERE, in place, instead
 * of opening the metric explorer: the explorer scopes by attributes only,
 * and a database is scoped by entity keys (its endpoints' and instances'),
 * so the explorer would chart the metric across the whole project. The
 * chart reads through DatabaseServerTelemetryQueries with the same key set
 * the list uses.
 *
 * The metric is charted by what it is, not by one generic aggregation: a
 * curated engine metric exactly as the Overview reads it, a histogram by
 * percentile (its stored value is the SUM of its observations, never a
 * latency — P95 by default), a cumulative counter as a per-second rate per
 * series, a delta counter by its Sum per bucket. What it is comes from its
 * newest stored point (fetchDatabaseMetricShape); values are formatted in
 * the metric's own unit.
 *
 * "Create monitor" opens Monitor Create pre-seeded with this metric, scoped
 * by the database's id (DatabaseMetricMonitorLink) — or, for a metric that
 * cannot become such a monitor (a cumulative counter, a metric that does
 * not carry the id), stays disabled and says why. When the monitor cannot
 * measure exactly what is charted (a total across series, a worst series
 * read with another aggregation), a line under it says what it measures.
 */

export interface ComponentProps {
  metricName: string;
  // The metric's unit from the metric list (MetricType.unit, UCUM).
  unit?: string | null | undefined;
  // The database's entity keys — the same set the Metrics tab lists by.
  keys: Array<string>;
  projectId: ObjectID | string | null | undefined;
  dbSystem?: string | null | undefined;
  // The database's id: what "Create monitor" scopes the monitor by.
  databaseServerId?: ObjectID | string | null | undefined;
  // The database's name, for the new monitor's description.
  databaseName?: string | null | undefined;
  // The range the metric list was showing; the past hour when not given.
  initialTimeRange?: RangeStartAndEndDateTime | undefined;
  onClose: () => void;
}

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const DATABASE_METRIC_MONITOR_BLOCKER_ID: string =
  "database-metric-monitor-blocker";

export const DATABASE_METRIC_AGGREGATION_LABELS: Partial<
  Record<AggregationType, string>
> = {
  [AggregationType.Avg]: "Average",
  [AggregationType.Max]: "Max",
  [AggregationType.Min]: "Min",
  [AggregationType.Sum]: "Sum",
  [AggregationType.P50]: "p50",
  [AggregationType.P90]: "p90",
  [AggregationType.P95]: "p95",
  [AggregationType.P99]: "p99",
};

const DatabaseMetricChartModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const unit: string = (props.unit || "").trim();

  // A curated metric is charted from the catalog; its shape is not needed.
  const isCurated: boolean = useMemo(() => {
    return (
      findDatabaseServerMetricByName(props.dbSystem, props.metricName) !== null
    );
  }, [props.metricName, props.dbSystem]);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    props.initialTimeRange || DEFAULT_RANGE,
  );
  const [shape, setShape] = useState<DatabaseMetricShape | null>(
    isCurated ? { ...UNKNOWN_DATABASE_METRIC_SHAPE, unit } : null,
  );
  const [pickedAggregation, setPickedAggregation] =
    useState<AggregationType | null>(null);
  const [series, setSeries] = useState<Array<DatabaseTimePoint>>([]);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    if (isCurated) {
      /*
       * On open this is already the state, and a new object with the same
       * content would change `spec` and fetch the series a second time; it
       * only changes when the modal switches to a curated metric.
       */
      setShape((previous: DatabaseMetricShape | null): DatabaseMetricShape => {
        return previous &&
          previous.unit === unit &&
          previous.pointType === null &&
          previous.isMonotonic === null &&
          previous.aggregationTemporality === null
          ? previous
          : { ...UNKNOWN_DATABASE_METRIC_SHAPE, unit };
      });
      return;
    }

    let ignore: boolean = false;
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    setShape(null);
    fetchDatabaseMetricShape({
      projectId: props.projectId,
      keys: props.keys,
      start: range.startValue,
      end: range.endValue,
      metricName: props.metricName,
      unit: unit,
    })
      .then((result: DatabaseMetricShape): void => {
        if (!ignore) {
          setShape(result);
        }
      })
      .catch((): void => {
        if (!ignore) {
          setShape({ ...UNKNOWN_DATABASE_METRIC_SHAPE, unit });
        }
      });

    return (): void => {
      ignore = true;
    };
    // The shape of a metric does not change with the range picked later.
  }, [isCurated, props.metricName, unit, props.keys, props.projectId]);

  const spec: DatabaseMetricChartSpec = useMemo(() => {
    return getDatabaseMetricChartSpec(props.metricName, props.dbSystem, shape);
  }, [props.metricName, props.dbSystem, shape]);

  const aggregation: AggregationType =
    pickedAggregation && spec.aggregations.includes(pickedAggregation)
      ? pickedAggregation
      : spec.defaultAggregation;

  /*
   * Whether the metric carries the database's id, for "Create monitor":
   * undefined while checking, null when it cannot be told. Not asked for a
   * rate (it is refused anyway) or without an id to scope by.
   */
  const monitorScopeId: string = props.databaseServerId
    ? props.databaseServerId.toString()
    : "";
  const [carriesServerId, setCarriesServerId] = useState<
    boolean | null | undefined
  >(undefined);
  const hasShape: boolean = shape !== null;

  useEffect(() => {
    if (!monitorScopeId || !hasShape || spec.isRate) {
      setCarriesServerId(null);
      return;
    }

    let ignore: boolean = false;
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    setCarriesServerId(undefined);
    fetchDatabaseMetricCarriesServerId({
      projectId: props.projectId,
      keys: props.keys,
      start: range.startValue,
      end: range.endValue,
      metricName: props.metricName,
      databaseServerId: monitorScopeId,
    })
      .then((carries: boolean | null): void => {
        if (!ignore) {
          setCarriesServerId(carries);
        }
      })
      .catch((): void => {
        if (!ignore) {
          setCarriesServerId(null);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [
    monitorScopeId,
    hasShape,
    spec.isRate,
    timeRange,
    props.metricName,
    props.keys,
    props.projectId,
  ]);

  const monitorBlocker: string | null = getDatabaseMetricMonitorBlocker({
    spec,
    carriesServerId: carriesServerId === undefined ? null : carriesServerId,
  });

  // What the monitor measures when it is not exactly what is charted.
  const monitorNote: string | null = getDatabaseMetricMonitorSeed({
    spec,
    aggregationType: aggregation,
  }).note;

  // Null while the id check runs, and whenever the metric is refused.
  const monitorRoute: Route | null = useMemo(() => {
    if (
      !monitorScopeId ||
      monitorBlocker ||
      !chartWindow ||
      carriesServerId === undefined
    ) {
      return null;
    }
    return buildDatabaseMetricMonitorRoute(
      buildDatabaseMetricMonitorViewData({
        spec,
        databaseServerId: monitorScopeId,
        aggregationType: aggregation,
        startAndEndDate: new InBetween<Date>(
          chartWindow.start,
          chartWindow.end,
        ),
        rangeToken: timeRange.range,
      }),
      { databaseName: props.databaseName },
    );
  }, [
    monitorScopeId,
    monitorBlocker,
    carriesServerId,
    spec,
    aggregation,
    chartWindow,
    timeRange,
    props.databaseName,
  ]);

  useEffect(() => {
    if (!shape) {
      setIsLoading(true);
      return;
    }

    // A slow wide-range fetch must not overwrite a newer one.
    let ignore: boolean = false;

    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;

    setChartWindow({ start, end });
    setIsLoading(true);

    fetchDatabaseMetricChartSeries({
      projectId: props.projectId,
      keys: props.keys,
      start,
      end,
      spec,
      aggregationType: aggregation,
    })
      .then((points: Array<DatabaseTimePoint>): void => {
        if (!ignore) {
          setSeries(points);
          setIsLoading(false);
        }
      })
      .catch((): void => {
        if (!ignore) {
          setSeries([]);
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [shape, spec, aggregation, timeRange, props.keys, props.projectId]);

  /*
   * The axis (and the tooltip, which shares the formatter) keeps short
   * units — bytes, durations, "%", "/s" — and leaves a unit word to the
   * chart's title: a 64 px axis clipped "20 connections" to "onnections".
   */
  const formatValue: (value: number) => string = (value: number): string => {
    if (spec.definition) {
      return formatDatabaseMetricAxisValue(value, spec.definition.unit);
    }
    return formatDatabaseMetricUnitAxisValue(value, spec.unit, {
      isRate: spec.isRate,
      metricName: spec.metricName,
    });
  };
  // A bare-number rate keeps its "/s" on the axis; anything else says it here.
  const isBareNumberUnit: boolean = !spec.unit || spec.unit === "1";
  const axisUnitLabel: string = spec.definition
    ? spec.definition.kind === "counter"
      ? "per second"
      : getDatabaseMetricAxisUnitLabel(spec.definition.unit)
    : [
        getDatabaseMetricUnitAxisLabel(spec.unit),
        spec.isRate && !isBareNumberUnit ? "per second" : "",
      ]
        .filter((part: string): boolean => {
          return part.length > 0;
        })
        .join(" ");
  const chartTitle: string = axisUnitLabel
    ? `${props.metricName} (${axisUnitLabel})`
    : props.metricName;
  // Whole-number ticks for a count; 0 to 1 for a series that stayed at 0.
  const yAxis: DatabaseChartYAxis = getDatabaseChartYAxis(
    series.map((point: DatabaseTimePoint): number => {
      return point.y;
    }),
    spec.definition
      ? isDatabaseMetricWholeNumberUnit(
          spec.definition.unit,
          spec.definition.kind,
        )
      : isDatabaseMetricUnitWholeNumber(spec.unit, {
          isRate: spec.isRate,
          isDistribution: spec.isDistribution,
        }),
  );

  const description: string = spec.definition
    ? `${spec.definition.description} Charted for this database only.`
    : "Charted for this database only — its endpoints and the pods or containers it runs as.";

  return (
    <Modal
      title={spec.title}
      description={description}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div data-testid="database-metric-chart">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {spec.aggregations.length > 0 ? (
            <div
              className="inline-flex rounded-md shadow-sm"
              role="group"
              aria-label="Aggregation"
            >
              {spec.aggregations.map(
                (option: AggregationType, index: number): ReactElement => {
                  const isSelected: boolean = option === aggregation;
                  const edges: string =
                    index === 0
                      ? "rounded-l-md"
                      : index === spec.aggregations.length - 1
                        ? "-ml-px rounded-r-md"
                        : "-ml-px";
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={(): void => {
                        setPickedAggregation(option);
                      }}
                      className={`${edges} border px-3 py-1.5 text-xs font-medium ${
                        isSelected
                          ? "z-10 border-indigo-500 bg-indigo-50 text-indigo-700"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {DATABASE_METRIC_AGGREGATION_LABELS[option] || option}
                    </button>
                  );
                },
              )}
            </div>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <TelemetryTimeRangePicker
              value={timeRange}
              onChange={(value: RangeStartAndEndDateTime): void => {
                setTimeRange(value);
              }}
            />
            {monitorScopeId && monitorRoute ? (
              <AppLink
                to={monitorRoute}
                className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
              >
                Create monitor
              </AppLink>
            ) : (
              <></>
            )}
            {monitorScopeId && !monitorRoute ? (
              <button
                type="button"
                disabled={true}
                aria-describedby={
                  monitorBlocker
                    ? DATABASE_METRIC_MONITOR_BLOCKER_ID
                    : undefined
                }
                title={
                  monitorBlocker ||
                  "Checking whether this metric carries this database's id…"
                }
                className="inline-flex cursor-not-allowed items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-400"
              >
                Create monitor
              </button>
            ) : (
              <></>
            )}
          </div>
        </div>
        {monitorScopeId && monitorBlocker ? (
          <p
            id={DATABASE_METRIC_MONITOR_BLOCKER_ID}
            className="mb-3 text-xs text-amber-700"
            data-testid="database-metric-monitor-blocker"
          >
            {monitorBlocker}
          </p>
        ) : (
          <></>
        )}
        {monitorScopeId && !monitorBlocker && monitorNote ? (
          <p
            className="mb-3 text-xs text-gray-600"
            data-testid="database-metric-monitor-note"
          >
            {monitorNote}
          </p>
        ) : (
          <></>
        )}
        {spec.note ? (
          <p
            className="mb-3 text-xs text-gray-500"
            data-testid="database-metric-chart-note"
          >
            {spec.note}
          </p>
        ) : (
          <></>
        )}
        <ChartCard
          title={chartTitle}
          icon={IconProp.ChartBar}
          iconColor="violet"
          series={
            [{ seriesName: spec.title, data: series }] as Array<SeriesPoint>
          }
          windowStart={chartWindow?.start ?? null}
          windowEnd={chartWindow?.end ?? null}
          syncId={`database-metric-${props.metricName}`}
          yMax={yAxis.yMax}
          yAllowDecimals={yAxis.allowDecimals}
          yFormatter={formatValue}
          loading={isLoading}
        />
      </div>
    </Modal>
  );
};

export default DatabaseMetricChartModal;
