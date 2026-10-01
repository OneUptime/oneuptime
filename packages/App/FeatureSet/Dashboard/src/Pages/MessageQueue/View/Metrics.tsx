import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  MessageQueueIdentity,
  parseMessageQueueIdentifier,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useMemo,
  useState,
} from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import {
  FetchMetricRowValueOverrides,
  MetricRowValueOverride,
  MetricRowValueOverrideMap,
} from "../../../Components/Metrics/Utils/MetricRowScope";
import MessageQueueUnscopedBanner from "../../../Components/MessageQueue/MessageQueueUnscopedBanner";
import MessageQueueMetricChartModal from "../../../Components/MessageQueue/MessageQueueMetricChartModal";
import useMessageQueueTelemetryScope, {
  UseMessageQueueTelemetryScopeResult,
} from "../../../Components/MessageQueue/useMessageQueueTelemetryScope";
import { isMessageQueueScoped } from "../../../Components/MessageQueue/MessageQueueTelemetryScope";
import {
  MessageQueueMetricListValue,
  MessageQueueTimePoint,
  fetchMessageQueueMetricListValues,
} from "../../../Components/MessageQueue/MessageQueueTelemetryQueries";
import {
  MESSAGE_QUEUE_METRIC_LIST_DEFAULT_CAPTION,
  getMessageQueueMetricListCaption,
} from "../../../Components/MessageQueue/MessageQueueOverviewPresentation";
import { MESSAGE_QUEUE_NOT_FOUND_MESSAGE } from "../Utils/MessageQueuePresentation";
/*
 * Generic and pure, so shared with the Databases product's Metrics tab
 * rather than copied: it reads the range out of the URL the way the shared
 * MetricsViewer writes it (`range`, plus `start` / `end` for a custom
 * range; anything unreadable is the viewer's default, the past hour), so a
 * clicked metric's chart opens on the range the list shows. Nothing in it
 * is about databases.
 */
import { getDatabaseMetricsRangeFromSearch } from "../../Database/Utils/DatabaseServerTelemetryQueries";

/** The curated list values as the metric list's row overrides. */
export function toMessageQueueMetricRowValueOverrides(
  values: Map<string, MessageQueueMetricListValue>,
): MetricRowValueOverrideMap {
  const overrides: MetricRowValueOverrideMap = new Map();
  for (const [metricName, listValue] of values) {
    const override: MetricRowValueOverride = {
      points: listValue.points.map(
        (point: MessageQueueTimePoint): { time: string; value: number } => {
          return { time: point.x.toISOString(), value: point.y };
        },
      ),
      value: listValue.value,
      valueSuffix: listValue.isRate ? "/s" : undefined,
      caption: getMessageQueueMetricListCaption(listValue.descriptor),
    };
    overrides.set(metricName, override);
  }
  return overrides;
}

/*
 * The queue's metrics: every datapoint ingest tagged with the queue's entity
 * key — the curated broker metrics of its messaging system (backlog, lag,
 * dead letters, …), the messaging client metrics its applications report
 * (messaging.client.*), and any metric of your own that carries
 * `messaging.system` and `messaging.destination.name` on each datapoint.
 *
 * A curated metric's row reads as its Broker health tile does — combined
 * across its series, a counter as a per-second rate — instead of the list's
 * average of every series. A row click charts the metric in place under the
 * queue's key (MessageQueueMetricChartModal): the metric explorer the viewer
 * opens by default scopes by attributes only, so it would chart the metric
 * across every queue in the project. The chart opens on the range the list
 * is showing.
 */

interface SelectedMetric {
  name: string;
  unit: string;
}

const MessageQueueMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [selectedMetric, setSelectedMetric] = useState<SelectedMetric | null>(
    null,
  );

  // What the list shows: its URL range on load, then whatever is picked.
  const [listRange, setListRange] = useState<RangeStartAndEndDateTime>(
    (): RangeStartAndEndDateTime => {
      return getDatabaseMetricsRangeFromSearch(
        typeof window === "undefined" ? "" : window.location.search,
      );
    },
  );

  const {
    keys,
    entityKeyDisplays,
    isLoading,
    error,
    messageQueue,
  }: UseMessageQueueTelemetryScopeResult =
    useMessageQueueTelemetryScope(modelId);

  const projectId: ObjectID | null =
    messageQueue?.projectId || ProjectUtil.getCurrentProjectId();
  const messagingSystem: string | undefined = messageQueue?.messagingSystem;
  const queueIdentifier: string = messageQueue?.queueIdentifier || "";

  // What a curated gauge's "Create monitor" pins: the family identity.
  const identity: MessageQueueIdentity | null = useMemo(() => {
    return parseMessageQueueIdentifier(queueIdentifier);
  }, [queueIdentifier]);

  /*
   * Stable while the scope is, so the list does not refetch its values on
   * every render.
   */
  const fetchRowValueOverrides: FetchMetricRowValueOverrides = useCallback(
    async (data: {
      metricNames: Array<string>;
      startAndEndDate: InBetween<Date>;
    }): Promise<MetricRowValueOverrideMap> => {
      const values: Map<string, MessageQueueMetricListValue> =
        await fetchMessageQueueMetricListValues({
          projectId: projectId,
          keys: keys,
          start: data.startAndEndDate.startValue,
          end: data.startAndEndDate.endValue,
          messagingSystem: messagingSystem,
          metricNames: data.metricNames,
        });
      return toMessageQueueMetricRowValueOverrides(values);
    },
    [keys, projectId?.toString(), messagingSystem],
  );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!messageQueue) {
    return <ErrorMessage message={MESSAGE_QUEUE_NOT_FOUND_MESSAGE} />;
  }

  /*
   * No key means no scope, and the viewer would fall back to every metric in
   * the project. Show what is actually true instead.
   */
  if (!isMessageQueueScoped(keys)) {
    return <MessageQueueUnscopedBanner signal="metrics" />;
  }

  return (
    <Fragment>
      <MetricsViewer
        entityKeysFilter={keys}
        entityKeyDisplays={entityKeyDisplays}
        fetchRowValueOverrides={fetchRowValueOverrides}
        defaultRowValueCaption={MESSAGE_QUEUE_METRIC_LIST_DEFAULT_CAPTION}
        onTimeRangeChange={(range: RangeStartAndEndDateTime): void => {
          setListRange(range);
        }}
        onMetricClick={(metric: MetricType): void => {
          const name: string = (metric.name || "").trim();
          setSelectedMetric(
            name ? { name: name, unit: (metric.unit || "").trim() } : null,
          );
        }}
      />
      {selectedMetric ? (
        <MessageQueueMetricChartModal
          key={selectedMetric.name}
          metricName={selectedMetric.name}
          unit={selectedMetric.unit}
          keys={keys}
          projectId={projectId}
          messagingSystem={messagingSystem}
          identity={identity}
          queueName={messageQueue.name}
          initialTimeRange={listRange}
          onClose={(): void => {
            setSelectedMetric(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default MessageQueueMetrics;
