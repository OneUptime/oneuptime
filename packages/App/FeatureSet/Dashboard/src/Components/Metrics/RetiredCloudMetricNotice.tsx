import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  CosmosConnectionMode,
  PUBSUB_MESSAGES_PUBLISHED_METRIC,
  RetiredCloudMetric,
  RetiredCloudMetricNotice as Notice,
  getCosmosLatencyReplacement,
  getRetiredCloudMetricNotices,
} from "Common/Utils/Metrics/RetiredCloudMetricMoves";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * WHAT A QUERY OF A DEPRECATED CLOUD METRIC SAYS WHERE IT IS SEEN (#9739's
 * gap, #9980).
 *
 * A monitor, a dashboard's chart or a query being edited that still reads
 * Cosmos DB's ServerSideLatency or Pub/Sub's send_message_operation_count
 * says so, one line a metric, with what replaces it: the connection keeps
 * reading the old metric for it (CloudRetiredMetricReads), and a Cosmos DB
 * query is moved by itself once its account reports a latency
 * (MoveOffRetiredCloudMetrics). Nothing is drawn for a query of any other
 * metric. Each metric's name is drawn as code, read from the left on a page
 * that reads right to left.
 */

export interface ComponentProps {
  // The queries as they are stored (MetricQueryConfigData).
  queryConfigs: ReadonlyArray<unknown>;
  className?: string | undefined;
}

export const RETIRED_CLOUD_METRIC_NOTICES_TEST_ID: string =
  "retired-cloud-metric-notices";
export const RETIRED_CLOUD_METRIC_NOTICE_TEST_ID: string =
  "retired-cloud-metric-notice";

function code(name: string): ReactNode {
  return (
    <code dir="ltr" className="rounded bg-amber-100 px-1 text-xs">
      {name}
    </code>
  );
}

function getSentence(notice: Notice): ReactElement {
  if (notice.metric === RetiredCloudMetric.CosmosServerSideLatency) {
    return (
      <TranslatedSentence
        template="Microsoft is removing {{metric}} from Azure Monitor: read {{direct}} or {{gateway}} instead. OneUptime still reads it for saved monitors and charts, and moves each to the latency its account reports once there is one."
        slots={{
          metric: code(notice.metricName),
          direct: code(
            getCosmosLatencyReplacement(
              notice.metricName,
              CosmosConnectionMode.Direct,
            ) || notice.metricName,
          ),
          gateway: code(
            getCosmosLatencyReplacement(
              notice.metricName,
              CosmosConnectionMode.Gateway,
            ) || notice.metricName,
          ),
        }}
      />
    );
  }

  return (
    <TranslatedSentence
      template="Google deprecates {{metric}}: read {{replacement}} instead, the messages published a minute, which is 60 times the rate a second. OneUptime still reads it for saved monitors and charts while Google publishes it."
      slots={{
        metric: code(notice.metricName),
        replacement: code(PUBSUB_MESSAGES_PUBLISHED_METRIC),
      }}
    />
  );
}

const RetiredCloudMetricNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const notices: Array<Notice> = getRetiredCloudMetricNotices(
    props.queryConfigs,
  );

  if (notices.length === 0) {
    return <></>;
  }

  return (
    <div
      className={`space-y-1 ${props.className || ""}`.trim()}
      role="note"
      data-testid={RETIRED_CLOUD_METRIC_NOTICES_TEST_ID}
    >
      {notices.map((notice: Notice): ReactElement => {
        return (
          <p
            key={notice.metricName}
            className="flex items-start gap-1.5 text-xs text-amber-700"
            data-testid={RETIRED_CLOUD_METRIC_NOTICE_TEST_ID}
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500"
            />
            <span className="min-w-0">{getSentence(notice)}</span>
          </p>
        );
      })}
    </div>
  );
};

export default RetiredCloudMetricNotice;
