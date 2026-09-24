import ChartCard from "../TelemetryResource/ChartCard";
import {
  DATABASE_METRIC_CHART_AGGREGATIONS,
  DatabaseMetricChartSpec,
  DatabaseTimePoint,
  fetchDatabaseMetricChartSeries,
  getDatabaseMetricChartSpec,
} from "../../Pages/Database/Utils/DatabaseServerTelemetryQueries";
import { formatDatabaseMetricValue } from "../../Pages/Database/Utils/DatabaseServerPresentation";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
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
 * the list uses; a curated engine counter is charted as a per-second rate.
 */

export interface ComponentProps {
  metricName: string;
  // The database's entity keys — the same set the Metrics tab lists by.
  keys: Array<string>;
  projectId: ObjectID | string | null | undefined;
  dbSystem?: string | null | undefined;
  onClose: () => void;
}

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const AGGREGATION_LABELS: Partial<Record<AggregationType, string>> = {
  [AggregationType.Avg]: "Average",
  [AggregationType.Max]: "Max",
  [AggregationType.Min]: "Min",
  [AggregationType.Sum]: "Sum",
};

const DatabaseMetricChartModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const spec: DatabaseMetricChartSpec = useMemo(() => {
    return getDatabaseMetricChartSpec(props.metricName, props.dbSystem);
  }, [props.metricName, props.dbSystem]);

  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);
  const [aggregation, setAggregation] = useState<AggregationType>(
    spec.defaultAggregation,
  );
  const [series, setSeries] = useState<Array<DatabaseTimePoint>>([]);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
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
  }, [spec, aggregation, timeRange, props.keys, props.projectId]);

  const formatValue: (value: number) => string = (value: number): string => {
    if (spec.definition) {
      return formatDatabaseMetricValue(
        value,
        spec.definition.unit,
        spec.definition.kind,
      );
    }
    return formatDatabaseMetricValue(value, "", "gauge");
  };

  return (
    <Modal
      title={spec.title}
      description={
        spec.definition
          ? `${spec.definition.description} Charted for this database only.`
          : "Charted for this database only — its endpoints and the pods or containers it runs as."
      }
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div data-testid="database-metric-chart">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {spec.isRate ? (
            <span className="text-xs text-gray-500">
              A cumulative counter, charted as a per-second rate.
            </span>
          ) : (
            <div
              className="inline-flex rounded-md shadow-sm"
              role="group"
              aria-label="Aggregation"
            >
              {DATABASE_METRIC_CHART_AGGREGATIONS.map(
                (option: AggregationType, index: number): ReactElement => {
                  const isSelected: boolean = option === aggregation;
                  const edges: string =
                    index === 0
                      ? "rounded-l-md"
                      : index === DATABASE_METRIC_CHART_AGGREGATIONS.length - 1
                        ? "-ml-px rounded-r-md"
                        : "-ml-px";
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={(): void => {
                        setAggregation(option);
                      }}
                      className={`${edges} border px-3 py-1.5 text-xs font-medium ${
                        isSelected
                          ? "z-10 border-indigo-500 bg-indigo-50 text-indigo-700"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {AGGREGATION_LABELS[option] || option}
                    </button>
                  );
                },
              )}
            </div>
          )}
          <TelemetryTimeRangePicker
            value={timeRange}
            onChange={(value: RangeStartAndEndDateTime): void => {
              setTimeRange(value);
            }}
          />
        </div>
        <ChartCard
          title={props.metricName}
          icon={IconProp.ChartBar}
          iconColor="violet"
          series={
            [{ seriesName: spec.title, data: series }] as Array<SeriesPoint>
          }
          windowStart={chartWindow?.start ?? null}
          windowEnd={chartWindow?.end ?? null}
          syncId={`database-metric-${props.metricName}`}
          yFormatter={formatValue}
          loading={isLoading}
        />
      </div>
    </Modal>
  );
};

export default DatabaseMetricChartModal;
