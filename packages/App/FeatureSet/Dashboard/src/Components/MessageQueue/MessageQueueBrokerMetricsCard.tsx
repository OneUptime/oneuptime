import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import {
  MessageQueueBrokerMetricState,
  MessageQueueBrokerMetricStatus,
  MessageQueueBrokerMetricsFinding,
  MessageQueueBrokerMetricsHealth,
  MessageQueueBrokerMetricsStatus,
  MessageQueueNamespaceFinding,
  getMessageQueueBrokerMetricStateLabel,
  getMessageQueueBrokerMetricStatusLine,
  getMessageQueueBrokerMetricsHealthLabel,
  getMessageQueueBrokerMetricsLastReceived,
  getMessageQueueBrokerMetricsSummary,
  getMessageQueueMissingMetricsFinding,
  getMessageQueueNamespaceFindingWords,
  getMessageQueueStoppedMetricsFinding,
} from "./MessageQueueBrokerMetricsStatus";
import { renderMessageQueueInlineCode } from "./MessageQueueInlineCode";
import {
  MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR,
  MESSAGE_QUEUE_INSTRUMENTING_DOCS_ANCHOR,
  getMessageQueueBrokerMetricTitle,
  getMessageQueueDocsRoute,
} from "./MessageQueueOverviewPresentation";
import { getMessageQueueSystemLabel } from "../../Pages/MessageQueue/Utils/MessageQueuePresentation";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Link from "Common/UI/Components/Link/Link";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Broker metrics card of a queue's Broker health section: which of its
 * system's curated broker metrics arrive for the queue, when each last did,
 * and for each that does not, why — with the steps that fix it
 * (MessageQueueBrokerMetricsStatus words every line; this only draws them).
 *
 *   - a line saying how many arrived in the range, and when the newest did;
 *   - a finding for what needs doing: the metrics that should arrive and do
 *     not (with the lines the collector's configuration needs), metrics
 *     that stopped, or — for an Azure queue none of whose metrics arrive —
 *     what its namespace sends instead (nothing, totals only, other queues
 *     only), each with links to the queue's collector configuration and the
 *     guide's troubleshooting;
 *   - a note that processing time needs consumer traces, when there are
 *     none: no broker measures it;
 *   - every metric the system supports, folded: its name, its state, why,
 *     and when it last arrived.
 */

export interface ComponentProps {
  modelId: ObjectID;
  messagingSystem: string | null | undefined;
  status: MessageQueueBrokerMetricsStatus;
  /*
   * What the queue's namespace sent instead, for a namespace-scoped queue
   * none of whose metrics arrived; null otherwise.
   */
  namespaceFinding: MessageQueueNamespaceFinding | null;
  // Whether the queue has consumer spans that handled messages.
  hasProcessingTime: boolean;
  // The moment relative times are counted from.
  now: Date;
}

export const BROKER_METRICS_CARD_TITLE: string =
  translationKey("Broker metrics");

export const BROKER_METRICS_LIST_TITLE: string =
  translationKey("Supported metrics");

// The queue's Documentation tab: the collector configuration for it.
export const BROKER_METRICS_CONFIGURATION_LINK_LABEL: string = translationKey(
  "Collector configuration for this queue →",
);

export const BROKER_METRICS_TROUBLESHOOTING_LINK_LABEL: string = translationKey(
  "Troubleshooting in the Queues guide →",
);

export const BROKER_METRICS_TRACING_LINK_LABEL: string = translationKey(
  "Trace your consumers →",
);

const LINK_CLASS_NAME: string =
  "text-sm font-medium text-indigo-600 hover:underline";

function getHealthBadgeType(
  health: MessageQueueBrokerMetricsHealth,
): StatusBadgeType {
  switch (health) {
    case "arriving":
      return StatusBadgeType.Success;
    case "incomplete":
      return StatusBadgeType.Warning;
    case "stopped":
      return StatusBadgeType.Danger;
    default:
      return StatusBadgeType.Neutral;
  }
}

function getStateBadgeType(
  state: MessageQueueBrokerMetricState,
): StatusBadgeType {
  switch (state) {
    case "arriving":
      return StatusBadgeType.Success;
    case "notCollected":
    case "stopped":
      return StatusBadgeType.Warning;
    default:
      return StatusBadgeType.Neutral;
  }
}

/**
 * What the card asks the reader to look at, most specific first: what the
 * namespace sends instead (only while nothing of the queue's arrives, and
 * the reason is not just the range), else the metrics that stopped, else
 * the ones that should arrive and do not.
 */
export function getMessageQueueBrokerMetricsFindings(data: {
  status: MessageQueueBrokerMetricsStatus;
  namespaceFinding: MessageQueueNamespaceFinding | null;
  messagingSystem: string | null | undefined;
  now: Date;
  translator: Translator;
}): Array<MessageQueueBrokerMetricsFinding> {
  const findings: Array<MessageQueueBrokerMetricsFinding> = [];
  const nothingArrives: boolean =
    data.status.health === "never" || data.status.health === "stopped";
  if (data.namespaceFinding && nothingArrives) {
    findings.push(
      getMessageQueueNamespaceFindingWords(
        data.namespaceFinding,
        data.messagingSystem,
        data.translator,
      ),
    );
  } else {
    const stopped: MessageQueueBrokerMetricsFinding | null =
      getMessageQueueStoppedMetricsFinding(
        data.status,
        data.messagingSystem,
        data.now,
        data.translator,
      );
    if (stopped) {
      findings.push(stopped);
    }
  }
  const missing: MessageQueueBrokerMetricsFinding | null =
    getMessageQueueMissingMetricsFinding(
      data.status,
      data.messagingSystem,
      data.translator,
    );
  if (missing) {
    findings.push(missing);
  }
  return findings;
}

const FindingCallout: FunctionComponent<{
  finding: MessageQueueBrokerMetricsFinding;
  documentationRoute: Route;
}> = (props: {
  finding: MessageQueueBrokerMetricsFinding;
  documentationRoute: Route;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const finding: MessageQueueBrokerMetricsFinding = props.finding;

  return (
    <div
      data-testid="message-queue-broker-metrics-finding"
      data-kind={finding.kind}
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
    >
      <h3 className="text-sm font-semibold text-amber-900">
        {renderMessageQueueInlineCode(finding.title)}
      </h3>
      <p className="mt-1 text-sm text-amber-800">
        {renderMessageQueueInlineCode(finding.description)}
      </p>
      {finding.steps.length > 0 ? (
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-amber-800">
          {finding.steps.map((step: string, index: number): ReactElement => {
            return (
              <li
                key={`step-${index}`}
                data-testid="message-queue-broker-metrics-finding-step"
              >
                {renderMessageQueueInlineCode(step)}
              </li>
            );
          })}
        </ol>
      ) : (
        <></>
      )}
      {finding.configLines.length > 0 ? (
        /*
         * Lines of YAML, as written: they read left to right on a page laid
         * out right to left too.
         */
        <pre
          dir="ltr"
          data-testid="message-queue-broker-metrics-finding-config"
          className="mt-2 overflow-x-auto rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-gray-800"
        >
          {finding.configLines.join("\n")}
        </pre>
      ) : (
        <></>
      )}
      <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:gap-4">
        <AppLink to={props.documentationRoute} className={LINK_CLASS_NAME}>
          {translator.translateText(BROKER_METRICS_CONFIGURATION_LINK_LABEL) ||
            ""}
        </AppLink>
        <Link
          to={getMessageQueueDocsRoute(
            MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR,
          )}
          openInNewTab={true}
          className={LINK_CLASS_NAME}
        >
          {translator.translateText(BROKER_METRICS_TROUBLESHOOTING_LINK_LABEL)}
        </Link>
      </div>
    </div>
  );
};

const MetricRow: FunctionComponent<{
  metric: MessageQueueBrokerMetricStatus;
  messagingSystem: string | null | undefined;
  now: Date;
}> = (props: {
  metric: MessageQueueBrokerMetricStatus;
  messagingSystem: string | null | undefined;
  now: Date;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const metric: MessageQueueBrokerMetricStatus = props.metric;
  const line: string | null = getMessageQueueBrokerMetricStatusLine(
    metric,
    { messagingSystem: props.messagingSystem, now: props.now },
    translator,
  );
  const arrivedAt: Date | null =
    metric.state === "arriving" ? metric.lastArrivedAt : null;

  return (
    <li
      data-testid="message-queue-broker-metric-status"
      data-metric-id={metric.id}
      data-state={metric.state}
      data-reason={metric.reason || ""}
      className="[container-type:inline-size] px-3 py-3 sm:px-4"
    >
      {/*
       * The badge goes beside the name where the row has the room and under
       * it where it has not, by the row's own width: a record page's card
       * is narrow from md to about 1100px.
       */}
      <div className="flex flex-col gap-2 [@container(min-width:32rem)]:flex-row [@container(min-width:32rem)]:items-start [@container(min-width:32rem)]:gap-4">
        <div className="min-w-0 [@container(min-width:32rem)]:flex-1">
          <div className="text-sm font-medium text-gray-900">
            {getMessageQueueBrokerMetricTitle(metric.descriptor, translator)}
          </div>
          <div dir="ltr" className="break-all font-mono text-xs text-gray-500">
            {metric.descriptor.metricName}
          </div>
          {line ? (
            <p
              data-testid="message-queue-broker-metric-status-line"
              className="mt-1 text-xs text-gray-600"
            >
              {renderMessageQueueInlineCode(line)}
            </p>
          ) : (
            <></>
          )}
        </div>
        <div className="flex flex-col items-start gap-1 [@container(min-width:32rem)]:flex-none [@container(min-width:32rem)]:items-end">
          <StatusBadge
            text={getMessageQueueBrokerMetricStateLabel(
              metric.state,
              translator,
            )}
            type={getStateBadgeType(metric.state)}
          />
          {arrivedAt ? (
            <span
              className="text-xs text-gray-500"
              title={OneUptimeDate.getDateAsLocalFormattedString(arrivedAt)}
            >
              {translator.translateTemplate("Last arrived {{time}}", {
                time: OneUptimeDate.fromNow(arrivedAt, props.now),
              })}
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>
    </li>
  );
};

const MessageQueueBrokerMetricsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const status: MessageQueueBrokerMetricsStatus = props.status;
  const system: string = getMessageQueueSystemLabel(props.messagingSystem);
  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION] as Route,
    { modelId: props.modelId },
  );

  const findings: Array<MessageQueueBrokerMetricsFinding> =
    getMessageQueueBrokerMetricsFindings({
      status: status,
      namespaceFinding: props.namespaceFinding,
      messagingSystem: props.messagingSystem,
      now: props.now,
      translator: translator,
    });
  const lastReceived: string | null = getMessageQueueBrokerMetricsLastReceived(
    status,
    props.now,
    translator,
  );

  return (
    <Card
      title={BROKER_METRICS_CARD_TITLE}
      description={translator.translateTemplate(
        "The {{system}} metrics this page charts: which arrive for this queue, when each last did, and why the others do not.",
        { system: system },
      )}
      rightElement={
        <StatusBadge
          text={getMessageQueueBrokerMetricsHealthLabel(status, translator)}
          type={getHealthBadgeType(status.health)}
        />
      }
    >
      <div
        data-testid="message-queue-broker-metrics-status"
        data-health={status.health}
        className="space-y-4"
      >
        <div>
          <p
            data-testid="message-queue-broker-metrics-summary"
            className="text-sm text-gray-700"
          >
            {getMessageQueueBrokerMetricsSummary(status, translator)}
          </p>
          {lastReceived && status.lastReceivedAt ? (
            <p
              data-testid="message-queue-broker-metrics-last-received"
              className="mt-1 text-xs text-gray-500"
              title={OneUptimeDate.getDateAsLocalFormattedString(
                status.lastReceivedAt,
              )}
            >
              {lastReceived}
            </p>
          ) : (
            <></>
          )}
        </div>

        {findings.map(
          (finding: MessageQueueBrokerMetricsFinding): ReactElement => {
            return (
              <FindingCallout
                key={`finding-${finding.kind}`}
                finding={finding}
                documentationRoute={documentationRoute}
              />
            );
          },
        )}

        {!props.hasProcessingTime ? (
          <div
            data-testid="message-queue-broker-metrics-tracing-note"
            className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
          >
            <p>
              {translator.translateText(
                "Processing time comes from consumer traces only: no broker measures how long a consumer takes with a message. Trace the services that consume from this queue to see it.",
              )}
            </p>
            <div className="mt-2">
              <Link
                to={getMessageQueueDocsRoute(
                  MESSAGE_QUEUE_INSTRUMENTING_DOCS_ANCHOR,
                )}
                openInNewTab={true}
                className={LINK_CLASS_NAME}
              >
                {translator.translateText(BROKER_METRICS_TRACING_LINK_LABEL)}
              </Link>
            </div>
          </div>
        ) : (
          <></>
        )}

        <CollapsibleSection
          title={BROKER_METRICS_LIST_TITLE}
          collapsedDescription={translator.translatePlural(
            {
              one: "The {{count}} {{system}} metric this page charts, with its state and when it last arrived.",
              other:
                "The {{count}} {{system}} metrics this page charts, each with its state and when it last arrived.",
            },
            status.metrics.length,
            { system: system },
          )}
          defaultCollapsed={true}
          variant="bordered"
        >
          <ul
            data-testid="message-queue-broker-metric-statuses"
            className="-mx-3 -my-3 divide-y divide-gray-100 sm:-mx-4"
          >
            {status.metrics.map(
              (metric: MessageQueueBrokerMetricStatus): ReactElement => {
                return (
                  <MetricRow
                    key={metric.id}
                    metric={metric}
                    messagingSystem={props.messagingSystem}
                    now={props.now}
                  />
                );
              },
            )}
          </ul>
        </CollapsibleSection>
      </div>
    </Card>
  );
};

export default MessageQueueBrokerMetricsCard;
