import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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

export const RETIRED_CLOUD_METRIC_BADGE_TEST_ID: string =
  "retired-cloud-metric-badge";
export const RETIRED_CLOUD_METRIC_BADGE_SENTENCES_TEST_ID: string =
  "retired-cloud-metric-badge-sentences";

// What the mark is called to a screen reader, and on a phone before a tap.
export const RETIRED_CLOUD_METRIC_BADGE_LABEL: {
  one: string;
  other: string;
} = {
  one: translationKey("Reads {{count}} deprecated metric"),
  other: translationKey("Reads {{count}} deprecated metrics"),
};

export interface RetiredCloudMetricBadgeProps {
  // What the widget reads that its cloud deprecates (getRetiredCloudMetricNoticesOfWidget).
  notices: ReadonlyArray<Notice>;
  // Where the mark sits: a tile's corner, or a table's controls.
  className?: string | undefined;
}

/*
 * THE SAME, ON A TILE TOO SMALL FOR A LINE A METRIC (#10027): a Value, a
 * Gauge or a Table widget left on a deprecated metric - one its hourly move
 * cannot move (split or filtered by a response code, one that counts
 * points) - is still read for, and says so with an amber mark. Hovered,
 * focused or tapped, the mark says what the chart's lines say: what
 * replaces the metric, and that OneUptime still reads it for saved monitors
 * and charts. Nothing is drawn for a widget that reads none.
 */
export const RetiredCloudMetricBadge: FunctionComponent<
  RetiredCloudMetricBadgeProps
> = (props: RetiredCloudMetricBadgeProps): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.notices.length === 0) {
    return <></>;
  }

  const label: string = translator.translatePlural(
    RETIRED_CLOUD_METRIC_BADGE_LABEL,
    props.notices.length,
  );

  return (
    <span className={`inline-flex ${props.className || ""}`.trim()}>
      <Tooltip
        richContent={
          <div
            className="space-y-2 p-1 text-xs leading-relaxed text-gray-700"
            data-testid={RETIRED_CLOUD_METRIC_BADGE_SENTENCES_TEST_ID}
          >
            {props.notices.map((notice: Notice): ReactElement => {
              return <p key={notice.metricName}>{getSentence(notice)}</p>;
            })}
          </div>
        }
        interactive={false}
        isShownOnPress={true}
      >
        <button
          type="button"
          aria-label={label}
          data-testid={RETIRED_CLOUD_METRIC_BADGE_TEST_ID}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 transition-colors hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
            // Asking why does not open, select or drag the widget under it.
            event.stopPropagation();
          }}
          onPointerDown={(
            event: React.PointerEvent<HTMLButtonElement>,
          ): void => {
            event.stopPropagation();
          }}
        >
          <Icon icon={IconProp.Alert} className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </span>
  );
};

export const RETIRED_CLOUD_METRIC_CORNER_TEST_ID: string =
  "retired-cloud-metric-corner";

export interface RetiredCloudMetricCornerProps {
  notices: ReadonlyArray<Notice>;
  children: ReactElement;
}

/*
 * A Value's or a Gauge's tile with the mark in its top corner, at the
 * reading start of the line - the edit button sits at its end - over the
 * tile as it was, which keeps its title clear of it (hasCornerMark). A
 * tile that reads no deprecated metric is drawn exactly as it was.
 */
export const RetiredCloudMetricCorner: FunctionComponent<
  RetiredCloudMetricCornerProps
> = (props: RetiredCloudMetricCornerProps): ReactElement => {
  if (props.notices.length === 0) {
    return props.children;
  }

  return (
    <div
      className="relative h-full w-full"
      data-testid={RETIRED_CLOUD_METRIC_CORNER_TEST_ID}
    >
      {props.children}
      <RetiredCloudMetricBadge
        notices={props.notices}
        className="absolute left-1 top-1 z-10"
      />
    </div>
  );
};
