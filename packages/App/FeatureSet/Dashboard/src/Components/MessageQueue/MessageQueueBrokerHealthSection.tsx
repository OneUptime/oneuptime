import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import ChartCard from "../TelemetryResource/ChartCard";
import { MESSAGE_QUEUE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/MessageQueueMetricDescriptions";
import {
  MessageQueueBrokerMetricResult,
  MessageQueueTimePoint,
  hasMessageQueueBrokerMetricData,
} from "./MessageQueueTelemetryQueries";
import {
  MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR,
  MessageQueueBrokerMetricsGuidance,
  formatMessageQueueMetricAxisValue,
  formatMessageQueueMetricValue,
  getMessageQueueBrokerMetricCaption,
  getMessageQueueBrokerMetricChartTitle,
  getMessageQueueBrokerMetricsGuidance,
  getMessageQueueBrokerMetricsNoDataDescription,
  getMessageQueueDocsRoute,
} from "./MessageQueueOverviewPresentation";
import { getMessageQueueSystemLabel } from "../../Pages/MessageQueue/Utils/MessageQueuePresentation";
import {
  MessageQueueMetricMonitorLink,
  buildMessageQueueMetricMonitorLink,
  getMessageQueueMetricMonitorHint,
} from "./MessageQueueMetricMonitorLink";
/*
 * Generic and pure, so shared with the Databases product rather than
 * copied: whether a catalog unit word counts whole things, and the y-axis
 * that follows from it. Neither knows a database engine or catalog.
 */
import {
  DatabaseChartYAxis,
  getDatabaseChartYAxis,
  isDatabaseMetricWholeNumberUnit,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { MessageQueueIdentity } from "Common/Types/MessageQueue/MessageQueueIdentity";
import { getMessageQueueMetricId } from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Link from "Common/UI/Components/Link/Link";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";

/*
 * A queue's Broker health: the curated broker metrics of its messaging
 * system (Types/MessageQueue/MessageQueueMetricCatalog, picked by the row's
 * SPECIFIC system — a "jms" row has none until ActiveMQ metrics refine it),
 * read under the queue's entity key. Each metric that has data gets a tile
 * (a gauge's newest value, a counter's average rate) and a chart (a counter
 * as a rate per second, the series combined the way the catalog says), and
 * each GAUGE a "Create monitor" link (MessageQueueMetricMonitorLink): the
 * alert-template query builder over the series the metric was observed with.
 * Counters get no link: a monitor cannot compute a rate.
 *
 * While no curated metric has data, one card says why: nothing in this range
 * (metrics arrived before: discovery stamped brokerMetricsLastSeenAt), or
 * where the system's metrics come from — the catalog's brokerMetrics source —
 * with a link to the system's section of the Queues guide. Only a queue its
 * system's broker metrics can reach (canBrokerMetricsReachMessageQueue: the
 * rule the Documentation tab applies) is offered their setup; for any other
 * (NATS and Event Grid, whose metrics name no queue; a Service Bus or Event
 * Hubs queue without a namespace) the card says where they go instead.
 */

export interface ComponentProps {
  modelId: ObjectID;
  // The row's specific system: which catalog and which guidance.
  messagingSystem: string | null | undefined;
  // parseMessageQueueIdentifier(row.queueIdentifier): what a monitor pins.
  identity: MessageQueueIdentity | null;
  queueName: string | null | undefined;
  // When a curated broker metric was last seen for the queue, if ever.
  brokerMetricsLastSeenAt?: Date | null | undefined;
  results: Array<MessageQueueBrokerMetricResult>;
  isLoading: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
}

export const BROKER_HEALTH_TITLE: string = translationKey("Broker health");

export const BROKER_HEALTH_NO_DATA_TITLE: string =
  "No broker metrics in this range";

export const BROKER_HEALTH_CREATE_MONITOR_LABEL: string =
  translationKey("Create monitor");

/*
 * The queue's Documentation tab, which turns the system's metrics source into
 * a configuration with the reader's ingestion key filled in.
 */
export const BROKER_HEALTH_SETUP_LINK_LABEL: string = translationKey(
  "Set up broker metrics for this queue →",
);

/*
 * Where a system's broker metrics can be read when they never reach this
 * queue: the project's Metrics explorer.
 */
export const BROKER_HEALTH_METRICS_EXPLORER_LINK_LABEL: string = translationKey(
  "Open the Metrics explorer →",
);

export const BROKER_HEALTH_MONITOR_UNAVAILABLE_REASON: string = translationKey(
  "No series of this metric in the selected range carries this queue's attributes, so a monitor would watch nothing. Widen the range and try again.",
);

/*
 * Catalog notes spell component names and settings in backticks; they read
 * as code here rather than as stray punctuation.
 */
export function renderMessageQueueInlineCode(text: string): ReactElement {
  const parts: Array<string> = (text || "").split("`");
  return (
    <Fragment>
      {parts.map((part: string, index: number): ReactElement => {
        return index % 2 === 1 ? (
          <code
            key={`code-${index}`}
            className="rounded bg-gray-100 px-1 font-mono text-xs text-gray-800"
          >
            {part}
          </code>
        ) : (
          <Fragment key={`text-${index}`}>{part}</Fragment>
        );
      })}
    </Fragment>
  );
}

/**
 * The "Create monitor" link of each metric that can have one, by metric id:
 * every gauge with observed series that resolve to the queue. Counters, and
 * gauges without such a series, are absent.
 */
export function getMessageQueueBrokerMonitorLinks(data: {
  results: ReadonlyArray<MessageQueueBrokerMetricResult>;
  identity: MessageQueueIdentity | null;
  queueName: string | null | undefined;
}): Map<string, MessageQueueMetricMonitorLink> {
  const links: Map<string, MessageQueueMetricMonitorLink> = new Map();
  for (const result of data.results) {
    if (result.descriptor.kind !== "gauge" || result.series.length === 0) {
      continue;
    }
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: result.descriptor,
        observedSeries: result.observedSeries,
        identity: data.identity,
        queueName: data.queueName,
      });
    if (link) {
      links.set(getMessageQueueMetricId(result.descriptor), link);
    }
  }
  return links;
}

const SectionHeader: FunctionComponent<{ metricsRoute: Route }> = (props: {
  metricsRoute: Route;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-1">
        <h2 className="text-base font-semibold text-gray-900">
          {translator.translateText(BROKER_HEALTH_TITLE)}
        </h2>
        <InfoTooltip
          label={BROKER_HEALTH_TITLE}
          text={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.brokerHealth}
        />
      </div>
      <AppLink
        to={props.metricsRoute}
        className="text-sm font-medium text-indigo-600 hover:underline"
      >
        {translator.translateText("All metrics →") || ""}
      </AppLink>
    </div>
  );
};

const MessageQueueBrokerHealthSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MESSAGE_QUEUE_VIEW_METRICS] as Route,
    { modelId: props.modelId },
  );
  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION] as Route,
    { modelId: props.modelId },
  );

  const hasData: boolean = hasMessageQueueBrokerMetricData(props.results);

  const monitorLinks: Map<string, MessageQueueMetricMonitorLink> =
    useMemo(() => {
      return getMessageQueueBrokerMonitorLinks({
        results: props.results,
        identity: props.identity,
        queueName: props.queueName,
      });
    }, [props.results, props.identity, props.queueName]);

  /*
   * The loader is for a first load only: a zoom, its reset or an
   * auto-refresh keeps the charts on screen until the new results land, so
   * a drag in progress on one of them is not thrown away.
   */
  if (props.isLoading && !hasData) {
    return (
      <Card
        title={BROKER_HEALTH_TITLE}
        description={getMessageQueueSystemLabel(props.messagingSystem)}
      >
        <div data-testid="message-queue-broker-health-loading">
          <ComponentLoader />
        </div>
      </Card>
    );
  }

  if (!hasData && props.brokerMetricsLastSeenAt && props.results.length > 0) {
    return (
      <Card
        title={BROKER_HEALTH_NO_DATA_TITLE}
        description={getMessageQueueBrokerMetricsNoDataDescription({
          system: props.messagingSystem,
          lastReceivedAt: props.brokerMetricsLastSeenAt,
        })}
      >
        <div
          data-testid="message-queue-broker-health-no-data"
          className="flex flex-wrap items-center gap-4"
        >
          <AppLink
            to={metricsRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText("All metrics →") || ""}
          </AppLink>
          <Link
            to={getMessageQueueDocsRoute(
              MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR,
            )}
            openInNewTab={true}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            {translator.translateText("Broker health stays empty →")}
          </Link>
        </div>
      </Card>
    );
  }

  if (!hasData) {
    const guidance: MessageQueueBrokerMetricsGuidance =
      getMessageQueueBrokerMetricsGuidance(
        props.messagingSystem,
        props.identity,
      );
    return (
      <Card
        title={BROKER_HEALTH_TITLE}
        description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.brokerHealth}
      >
        <div
          data-testid="message-queue-broker-health-guidance"
          data-source-kind={guidance.sourceKind}
          className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-700"
        >
          <p data-testid="message-queue-broker-health-guidance-text">
            {renderMessageQueueInlineCode(guidance.description)}
          </p>
          <p className="mt-2 text-xs text-gray-500">{guidance.sourceLabel}</p>
          <div className="mt-3 flex flex-wrap gap-4">
            <Link
              to={guidance.docsRoute}
              openInNewTab={true}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              {guidance.docsLabel}
            </Link>
            {guidance.reachesQueue ? (
              <AppLink
                to={documentationRoute}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                {translator.translateText(BROKER_HEALTH_SETUP_LINK_LABEL) || ""}
              </AppLink>
            ) : guidance.sourceKind !== "none" ? (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.METRICS] as Route,
                )}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                {translator.translateText(
                  BROKER_HEALTH_METRICS_EXPLORER_LINK_LABEL,
                ) || ""}
              </AppLink>
            ) : (
              <></>
            )}
          </div>
        </div>
      </Card>
    );
  }

  const charted: Array<MessageQueueBrokerMetricResult> = props.results.filter(
    (result: MessageQueueBrokerMetricResult): boolean => {
      return result.series.length > 0;
    },
  );

  return (
    <div data-testid="message-queue-broker-health">
      <SectionHeader metricsRoute={metricsRoute} />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {charted.map((result: MessageQueueBrokerMetricResult): ReactElement => {
          const id: string = getMessageQueueMetricId(result.descriptor);
          return (
            <div
              key={`tile-${id}`}
              data-testid="message-queue-broker-metric-tile"
              data-metric-id={id}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-xs font-medium uppercase tracking-wider text-gray-500">
                  {result.descriptor.title}
                </span>
                <InfoTooltip
                  label={result.descriptor.title}
                  text={result.descriptor.description}
                />
              </div>
              <div
                data-testid="message-queue-broker-metric-value"
                className="mt-2 text-xl font-semibold text-gray-900"
              >
                {formatMessageQueueMetricValue(result.value, result.descriptor)}
              </div>
              <div className="mt-1 truncate text-xs text-gray-500">
                {getMessageQueueBrokerMetricCaption(result.descriptor)}
              </div>
              <div className="mt-1 truncate font-mono text-xs text-gray-400">
                {result.descriptor.metricName}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {charted.map((result: MessageQueueBrokerMetricResult): ReactElement => {
          const id: string = getMessageQueueMetricId(result.descriptor);
          const yAxis: DatabaseChartYAxis = getDatabaseChartYAxis(
            result.series.map((point: MessageQueueTimePoint): number => {
              return point.y;
            }),
            isDatabaseMetricWholeNumberUnit(
              result.descriptor.unit,
              result.descriptor.kind,
            ),
          );
          const link: MessageQueueMetricMonitorLink | undefined =
            monitorLinks.get(id);
          return (
            <div
              key={`chart-${id}`}
              data-testid="message-queue-broker-metric-chart"
              data-metric-id={id}
            >
              <ChartCard
                title={getMessageQueueBrokerMetricChartTitle(result.descriptor)}
                description={result.descriptor.description}
                icon={IconProp.ChartBar}
                iconColor="violet"
                series={
                  [
                    {
                      seriesName: result.descriptor.title,
                      data: result.series,
                    },
                  ] as Array<SeriesPoint>
                }
                windowStart={props.windowStart}
                windowEnd={props.windowEnd}
                syncId={`message-queue-${props.modelId.toString()}`}
                yMax={yAxis.yMax}
                yAllowDecimals={yAxis.allowDecimals}
                yFormatter={(value: number): string => {
                  return formatMessageQueueMetricAxisValue(
                    value,
                    result.descriptor,
                  );
                }}
              />
              {result.descriptor.kind === "gauge" ? (
                <div className="mt-2 px-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                    {/*
                     * Without a link the hint says why, as text: a disabled
                     * button takes no focus and a title shows on hover only,
                     * so keyboard and touch readers would never learn it.
                     */}
                    <span
                      id={`message-queue-create-monitor-hint-${id}`}
                      data-testid="message-queue-create-monitor-hint"
                    >
                      {link
                        ? getMessageQueueMetricMonitorHint(link)
                        : translator.translateText(
                            BROKER_HEALTH_MONITOR_UNAVAILABLE_REASON,
                          )}
                    </span>
                    {link ? (
                      <span
                        data-testid="message-queue-create-monitor"
                        data-metric-id={id}
                      >
                        <AppLink
                          to={link.route}
                          className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          {translator.translateText(
                            BROKER_HEALTH_CREATE_MONITOR_LABEL,
                          ) || ""}
                        </AppLink>
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={true}
                        data-testid="message-queue-create-monitor-unavailable"
                        data-metric-id={id}
                        aria-describedby={`message-queue-create-monitor-hint-${id}`}
                        title={translator.translateText(
                          BROKER_HEALTH_MONITOR_UNAVAILABLE_REASON,
                        )}
                        className="inline-flex cursor-not-allowed items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-400"
                      >
                        {translator.translateText(
                          BROKER_HEALTH_CREATE_MONITOR_LABEL,
                        )}
                      </button>
                    )}
                  </div>
                  {link && link.note ? (
                    <p
                      data-testid="message-queue-create-monitor-note"
                      className="mt-1 text-xs text-gray-500"
                    >
                      {link.note}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              ) : (
                <></>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MessageQueueBrokerHealthSection;
