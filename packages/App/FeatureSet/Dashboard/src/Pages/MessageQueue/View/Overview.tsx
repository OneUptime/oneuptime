import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import Service from "Common/Models/DatabaseModels/Service";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import OneUptimeDate from "Common/Types/Date";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { MessageQueueIdentity } from "Common/Types/MessageQueue/MessageQueueIdentity";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewQuickLink,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../Components/TelemetryResource/ChartCard";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import { MESSAGE_QUEUE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/MessageQueueMetricDescriptions";
import MessageQueueUnscopedBanner from "../../../Components/MessageQueue/MessageQueueUnscopedBanner";
import MessageQueueServicesCard from "../../../Components/MessageQueue/MessageQueueServicesCard";
import MessageQueueBrokerHealthSection from "../../../Components/MessageQueue/MessageQueueBrokerHealthSection";
import {
  MessageQueueScopeSource,
  getMessageQueueScopeIdentity,
  getMessageQueueScopeKeys,
  isMessageQueueScoped,
} from "../../../Components/MessageQueue/MessageQueueTelemetryScope";
import {
  EMPTY_MESSAGE_QUEUE_SERVICES,
  EMPTY_MESSAGE_QUEUE_SPAN_METRICS,
  MessageQueueBrokerMetricResult,
  MessageQueueObservedSeriesCache,
  MessageQueueServices,
  MessageQueueSpanMetrics,
  MessageQueueSpanOverview,
  fetchMessageQueueBrokerMetrics,
  fetchMessageQueueSpanOverview,
  getMessageQueueServiceIds,
} from "../../../Components/MessageQueue/MessageQueueTelemetryQueries";
import {
  MESSAGE_QUEUE_LIVENESS_DESCRIPTION,
  MessageQueueLivenessStatus,
  formatMessageQueueCount,
  formatMessageQueueDurationMs,
  formatMessageQueueErrorRate,
  getMessageQueueLivenessLabel,
  getMessageQueueLivenessStatus,
  getMessageQueueLivenessTone,
} from "../../../Components/MessageQueue/MessageQueueOverviewPresentation";
import {
  MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
  getMessageQueueBrokerLabel,
  getMessageQueueDiscoveryLabel,
  getMessageQueueSystemLabel,
  isMessageQueueFound,
  isNamespaceScopedMessagingSystem,
} from "../Utils/MessageQueuePresentation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

/*
 * A queue's Overview:
 *
 *   1. Messages from applications — its publishes (PRODUCER spans, and the
 *      client send spans of services that record no producer span), its
 *      consumed messages (CONSUMER spans, less empty receives and SQS's
 *      receive polls), its failed spans of any kind, and the p95 of the
 *      consumer spans that handled messages (processing time), with a chart
 *      per interval — MessageQueueSpanPopulation says which spans are which.
 *   2. Producers and Consumers — the services on each side of it.
 *   3. Broker health — its messaging system's curated broker metrics, each
 *      gauge with a "Create monitor" link, or a card saying where they come
 *      from while none has arrived.
 *
 * Every query goes through Components/MessageQueue/MessageQueueTelemetryQueries,
 * scoped by the queue's entity key — built from its queueIdentifier (the
 * identity FAMILY ingest keys telemetry on), while the broker catalog is
 * picked by its SPECIFIC messagingSystem. With no key at all the page sends
 * no telemetry query and says so.
 */
const MessageQueueOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [messageQueue, setMessageQueue] = useState<MessageQueue | null>(null);
  const [spanMetrics, setSpanMetrics] = useState<MessageQueueSpanMetrics>(
    EMPTY_MESSAGE_QUEUE_SPAN_METRICS,
  );
  const [producers, setProducers] = useState<MessageQueueServices>(
    EMPTY_MESSAGE_QUEUE_SERVICES,
  );
  const [consumers, setConsumers] = useState<MessageQueueServices>(
    EMPTY_MESSAGE_QUEUE_SERVICES,
  );
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});
  const [brokerMetrics, setBrokerMetrics] = useState<
    Array<MessageQueueBrokerMetricResult>
  >([]);
  const [telemetryLoading, setTelemetryLoading] = useState<boolean>(true);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");
  // Bumped by a refresh; the telemetry reloads when it changes.
  const [telemetryRefreshCount, setTelemetryRefreshCount] = useState<number>(0);
  // Set while the telemetry for the current window is still loading.
  const telemetryInFlightRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  /*
   * The broker metrics' observed series (the Create monitor links' filters),
   * kept across refreshes of one range: see MessageQueueObservedSeriesCache.
   */
  const observedSeriesCacheRef: React.MutableRefObject<MessageQueueObservedSeriesCache> =
    useRef<MessageQueueObservedSeriesCache>(
      new MessageQueueObservedSeriesCache(),
    );

  const fetchModel: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    if (showLoader) {
      setIsLoading(true);
      setError("");
    } else {
      setIsRefreshing(true);
    }
    try {
      const item: MessageQueue | null = await ModelAPI.getItem<MessageQueue>({
        modelType: MessageQueue,
        id: modelId,
        select: {
          name: true,
          description: true,
          projectId: true,
          queueIdentifier: true,
          messagingSystem: true,
          destinationName: true,
          brokerScope: true,
          brokerAddress: true,
          discoverySource: true,
          lastSeenAt: true,
          brokerMetricsLastSeenAt: true,
          labels: { name: true, color: true },
        },
      });

      // A deleted or unknown id comes back as an empty model, not null.
      if (!item || !isMessageQueueFound(item)) {
        if (showLoader) {
          setError(MESSAGE_QUEUE_NOT_FOUND_MESSAGE);
        }
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setMessageQueue(item);
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      /*
       * Keep stale data visible on a background refresh; only the initial
       * load surfaces a page-level error.
       */
      if (showLoader) {
        setError(API.getFriendlyMessage(err));
      }
    }
    setIsLoading(false);
    setIsRefreshing(false);
  };

  useEffect(() => {
    fetchModel(true).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * The telemetry follows what the queue is scoped by, not the model object:
   * fetchModel stores a new row on every refresh, and an effect keyed on it
   * re-ran on every tick, cancelling a load still running for the same
   * window (issue #4105's follow-up on the Database overview). The key is
   * worked out from the project and the identifier; the broker catalog from
   * the system. A refresh reloads it through telemetryRefreshCount instead.
   */
  const telemetryScope: string = messageQueue
    ? JSON.stringify({
        projectId: String(
          messageQueue.projectId || ProjectUtil.getCurrentProjectId() || "",
        ),
        queueIdentifier: messageQueue.queueIdentifier || "",
        messagingSystem: messageQueue.messagingSystem || "",
      })
    : "";

  useEffect(() => {
    const item: MessageQueue | null = messageQueue;
    if (!item) {
      return;
    }

    const projectId: ObjectID | null =
      item.projectId || ProjectUtil.getCurrentProjectId();
    const keys: Array<string> = getMessageQueueScopeKeys({
      projectId: projectId,
      queueIdentifier: item.queueIdentifier,
    });

    /*
     * No key: nothing is this queue's yet, and an unscoped query would chart
     * the whole project. Leave every section empty.
     */
    if (!isMessageQueueScoped(keys)) {
      telemetryInFlightRef.current = false;
      setSpanMetrics(EMPTY_MESSAGE_QUEUE_SPAN_METRICS);
      setProducers(EMPTY_MESSAGE_QUEUE_SERVICES);
      setConsumers(EMPTY_MESSAGE_QUEUE_SERVICES);
      setBrokerMetrics([]);
      setTelemetryLoading(false);
      return;
    }

    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;
    setChartWindow({ start, end });
    setTelemetryLoading(true);

    const catalog: ReadonlyArray<MessageQueueMetricDescriptor> =
      getMessageQueueMetricsForSystem(item.messagingSystem);

    /*
     * A slow wide-range fetch must not overwrite a newer one: a narrower
     * range (a zoom, its reset, the picker) or a Refresh.
     */
    let ignore: boolean = false;
    telemetryInFlightRef.current = true;

    Promise.all([
      fetchMessageQueueSpanOverview({
        projectId,
        keys,
        start,
        end,
        // Which of its spans are publishes and consumes can depend on it.
        messagingSystem: item.messagingSystem,
      }),
      fetchMessageQueueBrokerMetrics({
        projectId,
        keys,
        start,
        end,
        metrics: catalog,
        /*
         * Keyed on the range the reader picked, not on the window a
         * relative range moves every tick: a tick reuses them, a new range
         * or a zoom reads them again.
         */
        observedSeriesCache: {
          cache: observedSeriesCacheRef.current,
          rangeKey: JSON.stringify(timeRange),
        },
      }),
    ])
      .then(
        async ([spans, broker]: [
          MessageQueueSpanOverview,
          Array<MessageQueueBrokerMetricResult>,
        ]): Promise<void> => {
          if (ignore) {
            return;
          }
          telemetryInFlightRef.current = false;
          setSpanMetrics(spans.metrics);
          setProducers(spans.producers);
          setConsumers(spans.consumers);
          setBrokerMetrics(broker);
          setTelemetryLoading(false);

          const ids: Array<string> = getMessageQueueServiceIds(
            spans.producers,
            spans.consumers,
          );
          if (ids.length === 0) {
            return;
          }
          try {
            const result: ListResult<Service> = await ModelAPI.getList<Service>(
              {
                modelType: Service,
                query: {
                  _id: new Includes(
                    ids.map((id: string): ObjectID => {
                      return new ObjectID(id);
                    }),
                  ),
                },
                select: { _id: true, name: true },
                sort: {},
                skip: 0,
                limit: ids.length,
              },
            );
            if (ignore) {
              return;
            }
            const names: Record<string, string> = {};
            for (const service of result.data || []) {
              const id: string = service._id?.toString() || "";
              if (id && service.name) {
                names[id] = service.name;
              }
            }
            setServiceNames(names);
          } catch {
            // Names are decoration; the rows keep their ids.
          }
        },
      )
      .catch(() => {
        if (ignore) {
          return;
        }
        telemetryInFlightRef.current = false;
        setTelemetryLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [telemetryScope, timeRange, telemetryRefreshCount]);

  /*
   * A refresh reloads the row and the telemetry. The auto-refresh tick lets
   * a telemetry load that is still running land instead of replacing it with
   * one for the same window: when the queries outlast the interval, the
   * tiles, the charts and every section below them would otherwise never
   * load.
   */
  const refresh: (options: { isAutoRefresh: boolean }) => void = (options: {
    isAutoRefresh: boolean;
  }): void => {
    fetchModel(false).catch(() => {});

    if (options.isAutoRefresh && telemetryInFlightRef.current) {
      return;
    }

    setTelemetryRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "message-queue-overview-auto-refresh-interval",
    onRefresh: (): void => {
      refresh({ isAutoRefresh: true });
    },
  });

  /*
   * The identity a "Create monitor" link pins, stable while the identifier
   * is: the Broker health section rebuilds its links only when it changes.
   */
  const queueIdentifier: string = messageQueue?.queueIdentifier || "";
  const identity: MessageQueueIdentity | null = useMemo(() => {
    return getMessageQueueScopeIdentity({
      projectId: null,
      queueIdentifier: queueIdentifier,
    });
  }, [queueIdentifier]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!messageQueue) {
    return <ErrorMessage message={MESSAGE_QUEUE_NOT_FOUND_MESSAGE} />;
  }

  const q: MessageQueue = messageQueue;
  const m: MessageQueueSpanMetrics = spanMetrics;
  const scopeSource: MessageQueueScopeSource = {
    projectId: q.projectId || ProjectUtil.getCurrentProjectId(),
    queueIdentifier: q.queueIdentifier,
  };
  const isScoped: boolean = isMessageQueueScoped(
    getMessageQueueScopeKeys(scopeSource),
  );

  const systemLabel: string = getMessageQueueSystemLabel(q.messagingSystem);
  const destination: string =
    (q.destinationName || "").trim() || identity?.destination || "";
  const namespaceScoped: boolean = isNamespaceScopedMessagingSystem(
    q.messagingSystem,
  );
  // The namespace of a Service Bus / Event Hubs queue, else the address.
  const broker: string = getMessageQueueBrokerLabel(q).text;
  const discoveryLabel: string = getMessageQueueDiscoveryLabel(
    q.discoverySource,
  );
  // Seen by any source lately: its spans or a broker metric.
  const liveness: MessageQueueLivenessStatus = getMessageQueueLivenessStatus(
    q.lastSeenAt,
  );
  // Any span at all: a count of 0 then means none of that kind.
  const hasSpans: boolean = m.total > 0;

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const chips: Array<ResourceOverviewChip> = [
    { icon: IconProp.QueueList, label: systemLabel },
    { icon: IconProp.Search, label: discoveryLabel },
  ];
  if (broker) {
    chips.push({
      icon: IconProp.Globe,
      label:
        namespaceScoped && (q.brokerScope || "").trim()
          ? translator.translateTemplate("Namespace: {{broker}}", {
              broker: broker,
            })
          : translator.translateTemplate("Broker: {{broker}}", {
              broker: broker,
            }),
    });
  }

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Published",
      value: hasSpans ? formatMessageQueueCount(m.published) : "—",
      icon: IconProp.PaperAirplane,
      iconColor: "sky",
      loading: telemetryLoading,
      sublabel: "publish spans, selected range",
      to: populate(PageMap.MESSAGE_QUEUE_VIEW_TRACES),
      description: MESSAGE_QUEUE_METRIC_DESCRIPTIONS.published,
    },
    {
      title: "Consumed",
      value: hasSpans ? formatMessageQueueCount(m.consumed) : "—",
      icon: IconProp.InboxArrowDown,
      iconColor: "violet",
      loading: telemetryLoading,
      sublabel: "consumer spans, selected range",
      to: populate(PageMap.MESSAGE_QUEUE_VIEW_TRACES),
      description: MESSAGE_QUEUE_METRIC_DESCRIPTIONS.consumed,
    },
    {
      title: "Errors",
      value: hasSpans ? formatMessageQueueCount(m.errors) : "—",
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: telemetryLoading,
      sublabel: hasSpans
        ? translator.translatePlural(
            {
              one: "{{rate}} of {{count}} span",
              other: "{{rate}} of {{count}} spans",
            },
            m.total,
            {
              rate: formatMessageQueueErrorRate(m.errorRatePercent),
              count: formatMessageQueueCount(m.total),
            },
          )
        : undefined,
      percent: m.errorRatePercent,
      higherIsBetter: false,
      thresholds: { warn: 1, danger: 5 },
      description: MESSAGE_QUEUE_METRIC_DESCRIPTIONS.errors,
    },
    {
      title: "p95 processing time",
      value: formatMessageQueueDurationMs(m.p95ProcessingMs),
      icon: IconProp.Clock,
      iconColor: "emerald",
      loading: telemetryLoading,
      sublabel: "consumer spans, as the consumers measure them",
      description: MESSAGE_QUEUE_METRIC_DESCRIPTIONS.p95Processing,
    },
  ];

  const charts: ReactElement = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Messages"
        description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.messagesChart}
        icon={IconProp.QueueList}
        iconColor="sky"
        series={
          [
            { seriesName: "Published", data: m.publishedSeries },
            { seriesName: "Consumed", data: m.consumedSeries },
            { seriesName: "Errors", data: m.errorSeries },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`message-queue-${modelId.toString()}`}
        showLegend={true}
        yAllowDecimals={false}
        loading={
          telemetryLoading &&
          m.publishedSeries.length === 0 &&
          m.consumedSeries.length === 0
        }
      />
      <ChartCard
        title="p95 processing time"
        description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.p95ProcessingChart}
        icon={IconProp.Clock}
        iconColor="emerald"
        series={
          [
            { seriesName: "p95", data: m.p95ProcessingSeries },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`message-queue-${modelId.toString()}`}
        yLegend="ms"
        yFormatter={(value: number): string => {
          return formatMessageQueueDurationMs(value);
        }}
        loading={telemetryLoading && m.p95ProcessingSeries.length === 0}
      />
    </div>
  );

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Traces",
      description: "Every span that publishes to or consumes from this queue",
      to: populate(PageMap.MESSAGE_QUEUE_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Metrics",
      description: "Every broker and client metric for this queue",
      to: populate(PageMap.MESSAGE_QUEUE_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
    {
      title: "Owners",
      description: "Who is responsible for this queue",
      to: populate(PageMap.MESSAGE_QUEUE_VIEW_OWNERS),
      icon: IconProp.Team,
    },
    {
      title: "Documentation",
      description: "Instrument its clients and connect its broker metrics",
      to: populate(PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION),
      icon: IconProp.Book,
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    {
      label: "Messaging system",
      value: q.messagingSystem
        ? `${systemLabel} (${q.messagingSystem})`
        : undefined,
      mono: false,
    },
    { label: "Destination", value: destination || undefined },
  ];
  // The namespace is part of a Service Bus / Event Hubs queue only.
  if (namespaceScoped) {
    detailRows.push({
      label: "Namespace",
      value: (q.brokerScope || "").trim() || undefined,
    });
  }
  detailRows.push(
    { label: "Broker address", value: (q.brokerAddress || "").trim() },
    { label: "Discovered from", value: discoveryLabel, mono: false },
    {
      label: "Last seen",
      value: q.lastSeenAt
        ? OneUptimeDate.getDateAsLocalFormattedString(q.lastSeenAt)
        : undefined,
      mono: false,
    },
    {
      label: "Broker metrics last received",
      value: q.brokerMetricsLastSeenAt
        ? OneUptimeDate.getDateAsLocalFormattedString(q.brokerMetricsLastSeenAt)
        : undefined,
      mono: false,
    },
    { label: "Queue identifier", value: q.queueIdentifier },
    { label: "Queue ID", value: modelId.toString() },
  );

  return (
    /*
     * One zoom for the whole page (issue #4105): a drag on any chart — the
     * message charts or a broker health chart — narrows `timeRange`, and
     * every tile, card and section below is fetched over that one range; a
     * double-click on any chart, or "Reset zoom" beside the picker, puts the
     * range back. The scope wraps the sections that render after
     * ResourceOverview too, so they zoom and reset with it.
     */
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      {!isScoped ? (
        <div className="mb-6">
          <MessageQueueUnscopedBanner />
        </div>
      ) : (
        <></>
      )}

      <ResourceOverview
        icon={IconProp.QueueList}
        title={(q.name as string) || destination || systemLabel}
        identifier={destination}
        identifierLabel="destination"
        status={
          liveness === MessageQueueLivenessStatus.SeenRecently
            ? "active"
            : "inactive"
        }
        statusLabel={getMessageQueueLivenessLabel(liveness)}
        statusTone={getMessageQueueLivenessTone(liveness)}
        statusDescription={MESSAGE_QUEUE_LIVENESS_DESCRIPTION}
        lastSeenAt={q.lastSeenAt}
        description={q.description as string}
        chips={chips}
        tiles={tiles}
        charts={charts}
        controls={
          <AutoRefreshControl
            autoRefreshInterval={autoRefreshInterval}
            onAutoRefreshIntervalChange={setAutoRefreshInterval}
            onManualRefresh={(): void => {
              refresh({ isAutoRefresh: false });
            }}
            isRefreshing={isRefreshing}
            lastRefreshedAt={lastRefreshedAt}
            timeRangePicker={
              <TelemetryTimeRangePicker
                value={timeRange}
                onChange={(value: RangeStartAndEndDateTime): void => {
                  setTimeRange(value);
                }}
              />
            }
          />
        }
        quickLinks={quickLinks}
        detailRows={detailRows}
        labels={q.labels}
      />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <MessageQueueServicesCard
          side="producers"
          description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.producers}
          services={producers.services}
          totalServices={producers.total}
          serviceNames={serviceNames}
          isLoading={telemetryLoading}
          queueHasSpans={hasSpans}
        />
        <MessageQueueServicesCard
          side="consumers"
          description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.consumers}
          services={consumers.services}
          totalServices={consumers.total}
          serviceNames={serviceNames}
          isLoading={telemetryLoading}
          queueHasSpans={hasSpans}
        />
      </div>

      <div className="mt-6">
        <MessageQueueBrokerHealthSection
          modelId={modelId}
          messagingSystem={q.messagingSystem}
          identity={identity}
          queueName={q.name || destination}
          brokerMetricsLastSeenAt={
            q.brokerMetricsLastSeenAt
              ? new Date(q.brokerMetricsLastSeenAt)
              : null
          }
          results={brokerMetrics}
          isLoading={telemetryLoading && isScoped}
          windowStart={chartWindow?.start ?? null}
          windowEnd={chartWindow?.end ?? null}
        />
      </div>
    </TimeRangeZoomScope>
  );
};

export default MessageQueueOverview;
