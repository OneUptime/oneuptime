import ChartCard from "../TelemetryResource/ChartCard";
import AppLink from "../AppLink/AppLink";
import {
  MESSAGE_QUEUE_METRIC_CHART_COUNTER_NOTE,
  MessageQueueMetricChartSpec,
  MessageQueueMetricShape,
  MessageQueueObservedSeries,
  MessageQueueTimePoint,
  UNKNOWN_MESSAGE_QUEUE_METRIC_SHAPE,
  fetchMessageQueueCatalogMetricSeries,
  fetchMessageQueueMetricChartSeries,
  fetchMessageQueueMetricShape,
  fetchMessageQueueObservedSeries,
  findMessageQueueCatalogMetric,
  getMessageQueueMetricChartSpec,
  getMessageQueueMetricReadPlan,
} from "./MessageQueueTelemetryQueries";
import {
  formatMessageQueueMetricAxisValue,
  getMessageQueueBrokerMetricChartTitle,
} from "./MessageQueueOverviewPresentation";
import {
  MessageQueueMetricMonitorLink,
  buildMessageQueueMetricMonitorLink,
  getMessageQueueMetricMonitorHint,
} from "./MessageQueueMetricMonitorLink";
/*
 * Generic and pure, so shared with the Databases product rather than
 * copied: how a value reads on an axis by its unit (UCUM or a unit word),
 * whether a unit counts whole things, and the y-axis that follows. None of
 * it knows a database engine or catalog.
 */
import {
  DatabaseChartYAxis,
  formatDatabaseMetricUnitAxisValue,
  getDatabaseChartYAxis,
  isDatabaseMetricUnitWholeNumber,
  isDatabaseMetricWholeNumberUnit,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import { MessageQueueIdentity } from "Common/Types/MessageQueue/MessageQueueIdentity";
import { MessageQueueMetricDescriptor } from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import {
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * A queue's Metrics tab charts a clicked metric HERE, under the queue's
 * entity key, instead of opening the metric explorer: the explorer scopes by
 * attributes only, and a queue is scoped by its key (its broker metrics name
 * it under a different attribute per broker), so the explorer would chart
 * the metric across every queue in the project.
 *
 * A curated broker metric of the queue's system is charted exactly as the
 * Overview's Broker health reads it (fetchMessageQueueCatalogMetricSeries:
 * its series combined as the catalog says, a counter as a rate), and a gauge
 * gets the same "Create monitor" link, built from the series observed in
 * the chart's window. Any other metric (a messaging client metric, an
 * application's own gauge) is charted by what its newest point says it is —
 * a histogram by percentile, a cumulative counter as a rate, a delta counter
 * by its Sum (getMessageQueueMetricChartSpec, read under the queue's key by
 * fetchMessageQueueMetricChartSeries). That path is this product's own: the
 * Databases product's equivalent consults its engine catalog and engine unit
 * corrections, which have nothing to say about a queue's metrics.
 */

export interface ComponentProps {
  metricName: string;
  // The metric's unit from the metric list (MetricType.unit, UCUM).
  unit?: string | null | undefined;
  // The queue's entity keys — the same set the Metrics tab lists by.
  keys: Array<string>;
  projectId: ObjectID | string | null | undefined;
  // The row's specific system: whose catalog a curated metric is read from.
  messagingSystem?: string | null | undefined;
  // parseMessageQueueIdentifier(row.queueIdentifier), for Create monitor.
  identity: MessageQueueIdentity | null;
  queueName?: string | null | undefined;
  // The range the metric list was showing; the past hour when not given.
  initialTimeRange?: RangeStartAndEndDateTime | undefined;
  onClose: () => void;
}

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

/*
 * What the chart of a curated per-period count shows
 * (getCompleteMessageQueueCountSeries).
 */
export const MESSAGE_QUEUE_METRIC_CHART_COUNT_NOTE: string = translationKey(
  "A count per interval, added up across its series. Only whole intervals are drawn, so the newest one, still filling or still arriving from its source, does not read as a drop.",
);

export const MESSAGE_QUEUE_METRIC_AGGREGATION_LABELS: Partial<
  Record<AggregationType, string>
> = {
  [AggregationType.Avg]: translationKey("Average"),
  [AggregationType.Max]: translationKey("Max"),
  [AggregationType.Min]: translationKey("Min"),
  [AggregationType.Sum]: translationKey("Sum"),
  [AggregationType.P50]: "p50",
  [AggregationType.P90]: "p90",
  [AggregationType.P95]: "p95",
  [AggregationType.P99]: "p99",
};

const MessageQueueMetricChartModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const unit: string = (props.unit || "").trim();

  const descriptor: MessageQueueMetricDescriptor | null = useMemo(() => {
    return findMessageQueueCatalogMetric(
      props.messagingSystem,
      props.metricName,
    );
  }, [props.messagingSystem, props.metricName]);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    props.initialTimeRange || DEFAULT_RANGE,
  );
  // Any other metric's shape, read from its newest point; null while read.
  const [shape, setShape] = useState<MessageQueueMetricShape | null>(null);
  const [pickedAggregation, setPickedAggregation] =
    useState<AggregationType | null>(null);
  const [series, setSeries] = useState<Array<MessageQueueTimePoint>>([]);
  const [observedSeries, setObservedSeries] = useState<
    Array<MessageQueueObservedSeries>
  >([]);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // The shape of a metric outside the catalog; a curated one needs none.
  useEffect(() => {
    if (descriptor) {
      return;
    }

    let ignore: boolean = false;
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    setShape(null);
    fetchMessageQueueMetricShape({
      projectId: props.projectId,
      keys: props.keys,
      start: range.startValue,
      end: range.endValue,
      metricName: props.metricName,
      unit: unit,
    })
      .then((result: MessageQueueMetricShape): void => {
        if (!ignore) {
          setShape(result);
        }
      })
      .catch((): void => {
        if (!ignore) {
          setShape({ ...UNKNOWN_MESSAGE_QUEUE_METRIC_SHAPE, unit: unit });
        }
      });

    return (): void => {
      ignore = true;
    };
    // The shape of a metric does not change with the range picked later.
  }, [descriptor, props.metricName, unit, props.keys, props.projectId]);

  // How a metric outside the catalog is charted; unused for a curated one.
  const spec: MessageQueueMetricChartSpec | null = useMemo(() => {
    if (descriptor || !shape) {
      return null;
    }
    return getMessageQueueMetricChartSpec(props.metricName, shape);
  }, [descriptor, shape, props.metricName]);

  const aggregation: AggregationType | null = spec
    ? pickedAggregation && spec.aggregations.includes(pickedAggregation)
      ? pickedAggregation
      : spec.defaultAggregation
    : null;

  useEffect(() => {
    if (!descriptor && !spec) {
      setIsLoading(true);
      return;
    }

    // A slow wide-range fetch must not overwrite a newer one.
    let ignore: boolean = false;
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;
    const queryWindow: {
      projectId: ObjectID | string | null | undefined;
      keys: Array<string>;
      start: Date;
      end: Date;
    } = { projectId: props.projectId, keys: props.keys, start, end };

    setChartWindow({ start, end });
    setIsLoading(true);

    const load: Promise<
      [Array<MessageQueueTimePoint>, Array<MessageQueueObservedSeries>]
    > = descriptor
      ? Promise.all([
          fetchMessageQueueCatalogMetricSeries({ ...queryWindow, descriptor }),
          descriptor.kind === "gauge"
            ? fetchMessageQueueObservedSeries({ ...queryWindow, descriptor })
            : Promise.resolve([]),
        ])
      : Promise.all([
          fetchMessageQueueMetricChartSeries({
            ...queryWindow,
            spec: spec!,
            aggregationType: aggregation || spec!.defaultAggregation,
          }),
          Promise.resolve([]),
        ]);

    load
      .then(
        ([points, observed]: [
          Array<MessageQueueTimePoint>,
          Array<MessageQueueObservedSeries>,
        ]): void => {
          if (!ignore) {
            setSeries(points);
            setObservedSeries(observed);
            setIsLoading(false);
          }
        },
      )
      .catch((): void => {
        if (!ignore) {
          setSeries([]);
          setObservedSeries([]);
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [descriptor, spec, aggregation, timeRange, props.keys, props.projectId]);

  // A curated gauge's "Create monitor", from the series in the chart's window.
  const monitorLink: MessageQueueMetricMonitorLink | null = useMemo(() => {
    if (!descriptor || descriptor.kind !== "gauge") {
      return null;
    }
    return buildMessageQueueMetricMonitorLink({
      descriptor: descriptor,
      observedSeries: observedSeries,
      identity: props.identity,
      queueName: props.queueName,
    });
  }, [descriptor, observedSeries, props.identity, props.queueName]);

  const title: string = descriptor
    ? getMessageQueueBrokerMetricChartTitle(descriptor)
    : spec
      ? spec.title
      : props.metricName;

  const formatValue: (value: number) => string = (value: number): string => {
    if (descriptor) {
      return formatMessageQueueMetricAxisValue(value, descriptor);
    }
    return formatDatabaseMetricUnitAxisValue(value, spec ? spec.unit : unit, {
      isRate: Boolean(spec?.isRate),
      metricName: props.metricName,
    });
  };

  // Whole-number ticks for a count; 0 to 1 for a series that stayed at 0.
  const yAxis: DatabaseChartYAxis = getDatabaseChartYAxis(
    series.map((point: MessageQueueTimePoint): number => {
      return point.y;
    }),
    descriptor
      ? isDatabaseMetricWholeNumberUnit(descriptor.unit, descriptor.kind)
      : isDatabaseMetricUnitWholeNumber(spec ? spec.unit : unit, {
          isRate: Boolean(spec?.isRate),
          isDistribution: Boolean(spec?.isDistribution),
        }),
  );

  const description: string = descriptor
    ? translator.translateTemplate(
        "{{metricDescription}} Charted for this queue only.",
        { metricDescription: descriptor.description },
      )
    : translator.translateText(
        "Charted for this queue only: the datapoints tagged with its key.",
      ) || "";

  const note: string = descriptor
    ? descriptor.kind === "counter"
      ? MESSAGE_QUEUE_METRIC_CHART_COUNTER_NOTE
      : getMessageQueueMetricReadPlan(descriptor).isPerPeriodCount
        ? MESSAGE_QUEUE_METRIC_CHART_COUNT_NOTE
        : ""
    : spec
      ? spec.note
      : "";

  return (
    <Modal
      title={title}
      description={description}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      {/*
       * The chart zooms the modal's own range: a drag narrows it, a
       * double-click or "Reset zoom" beside the modal's picker puts it back —
       * never the Metrics list's behind it.
       */}
      <TimeRangeZoomScope
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      >
        <div data-testid="message-queue-metric-chart">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {spec && spec.aggregations.length > 0 ? (
              <div
                className="inline-flex rounded-md shadow-sm"
                role="group"
                aria-label={translator.translateText("Aggregation")}
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
                        {translator.translateText(
                          MESSAGE_QUEUE_METRIC_AGGREGATION_LABELS[option],
                        ) || option}
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
              {monitorLink ? (
                <span data-testid="message-queue-metric-chart-create-monitor">
                  <AppLink
                    to={monitorLink.route}
                    className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    {translator.translateText("Create monitor") || ""}
                  </AppLink>
                </span>
              ) : (
                <></>
              )}
            </div>
          </div>
          {monitorLink ? (
            <p
              className="mb-3 text-xs text-gray-600"
              data-testid="message-queue-metric-chart-monitor-hint"
            >
              {`${getMessageQueueMetricMonitorHint(monitorLink)}.`}
              {monitorLink.note ? ` ${monitorLink.note}` : ""}
            </p>
          ) : (
            <></>
          )}
          {note ? (
            <p
              className="mb-3 text-xs text-gray-500"
              data-testid="message-queue-metric-chart-note"
            >
              {translator.translateText(note)}
            </p>
          ) : (
            <></>
          )}
          <ChartCard
            title={title}
            icon={IconProp.ChartBar}
            iconColor="violet"
            series={[{ seriesName: title, data: series }] as Array<SeriesPoint>}
            windowStart={chartWindow?.start ?? null}
            windowEnd={chartWindow?.end ?? null}
            syncId={`message-queue-metric-${props.metricName}`}
            yMax={yAxis.yMax}
            yAllowDecimals={yAxis.allowDecimals}
            yFormatter={formatValue}
            loading={isLoading}
          />
        </div>
      </TimeRangeZoomScope>
    </Modal>
  );
};

export default MessageQueueMetricChartModal;
