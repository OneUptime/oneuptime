import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { getConnectRouteFor } from "../Cloud/Connect/CloudConnectCallout";
import {
  MESSAGE_QUEUE_BROKER_METRICS_CONNECTIONS_SLOT,
  MessageQueueBrokerMetricState,
  MessageQueueBrokerMetricStatus,
  MessageQueueBrokerMetricsFinding,
  MessageQueueBrokerMetricsHealth,
  MessageQueueBrokerMetricsSourceLine,
  MessageQueueBrokerMetricsStatus,
  MessageQueueNamespaceFinding,
  getMessageQueueBrokerMetricStateLabel,
  getMessageQueueBrokerMetricStatusLine,
  getMessageQueueBrokerMetricsHealthLabel,
  getMessageQueueBrokerMetricsLastReceived,
  getMessageQueueBrokerMetricsSourceLine,
  getMessageQueueBrokerMetricsSummary,
  getMessageQueueCollectorOnlyLine,
  getMessageQueueMissingMetricsFinding,
  getMessageQueueNamespaceFindingWords,
  getMessageQueueStoppedMetricsFinding,
} from "./MessageQueueBrokerMetricsStatus";
import { renderMessageQueueInlineCode } from "./MessageQueueInlineCode";
import {
  MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR,
  getMessageQueueBrokerMetricTitle,
  getMessageQueueDocsRoute,
} from "./MessageQueueOverviewPresentation";
import { getMessageQueueSystemLabel } from "../../Pages/MessageQueue/Utils/MessageQueuePresentation";
import Route from "Common/Types/API/Route";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Link from "Common/UI/Components/Link/Link";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  TemplateAround,
  Translator,
  formatList,
  getTemplateAround,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Broker metrics card of a queue's Broker health section: which of its
 * system's curated broker metrics arrive for the queue, when each last did,
 * and for each that does not, why — with the steps that fix it
 * (MessageQueueBrokerMetricsStatus words every line; this only draws them).
 * While none of them has data in the range it is the section's only card,
 * so it says everything the section has to say:
 *
 *   - a line saying how many arrived in the range, and when the newest did,
 *     and what reads them — the cloud connection (its name, a link to
 *     Cloud > Connect), the collector's receiver, or both, and for a queue
 *     a connection alone reads, why the metrics marked Collector only do
 *     not count — or, while none ever has, where the system's metrics come
 *     from (the section's setup guidance), unless a finding says more;
 *   - a finding for what needs doing: the metrics that should arrive and do
 *     not (with the lines the collector's configuration needs), metrics
 *     that stopped, or — for an Azure queue none of whose metrics arrive —
 *     what its namespace sends instead (nothing, totals only, other queues
 *     only), each with links to where it is fixed: Cloud > Connect (to
 *     connect the namespace's subscription, or to the connection that
 *     reads it), the queue's collector configuration, and the guide's
 *     troubleshooting;
 *   - every metric the system supports, folded: its name, its state, and
 *     why — or, for one that arrives, when it last did.
 *
 * Processing time is not here: no broker measures it, and the Overview's
 * p95 tile and chart say what gives it.
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
  /*
   * Where the system's metrics come from and how to set them up (the
   * section's guidance), drawn while none has ever arrived and no finding
   * says why.
   */
  setupGuidance?: ReactElement | undefined;
  /*
   * The names of the cloud connections that read the queue, by id; a
   * connection without one is named by where it is: Cloud > Connect.
   */
  connectionNames?: Readonly<Record<string, string>> | undefined;
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

/*
 * Cloud > Connect, opened on the Azure form: no cloud connection reads the
 * queue's namespace, and a connected subscription would.
 */
export const BROKER_METRICS_CONNECT_AZURE_LINK_LABEL: string = translationKey(
  "Connect an Azure subscription →",
);

/*
 * Cloud > Connect's list of connections: one reads the queue, and its last
 * read says what went wrong.
 */
export const BROKER_METRICS_CLOUD_CONNECT_LINK_LABEL: string = translationKey(
  "Open Cloud > Connect →",
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
      // Nothing to report, collector only, not received, not in this range.
      return StatusBadgeType.Neutral;
  }
}

/**
 * What the source line's link says: the connections' names, or - while
 * none is known (a connection since deleted, names not read) - where the
 * connections are, Cloud > Connect, as the side menu names it.
 */
export function getMessageQueueBrokerMetricsConnectionsLabel(
  connectionIds: ReadonlyArray<string>,
  connectionNames: Readonly<Record<string, string>> | undefined,
  translator: Translator,
): string {
  const names: Array<string> = [];
  for (const id of connectionIds) {
    const name: string = (connectionNames?.[id] || "").trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  if (names.length > 0) {
    return formatList(names, translator);
  }
  return `${translator.translateText("Cloud") || "Cloud"} > ${
    translator.translateText("Connect") || "Connect"
  }`;
}

/*
 * What reads the queue's metrics, under the summary: the cloud connection's
 * name links to Cloud > Connect, where its last read says how it went. A
 * sentence may follow (getMessageQueueCollectorOnlyLine): why the summary
 * counts metrics the connection does not read.
 */
const SourceLine: FunctionComponent<{
  line: MessageQueueBrokerMetricsSourceLine;
  connectionIds: ReadonlyArray<string>;
  connectionNames: Readonly<Record<string, string>> | undefined;
  collectorOnlyLine: string | null;
}> = (props: {
  line: MessageQueueBrokerMetricsSourceLine;
  connectionIds: ReadonlyArray<string>;
  connectionNames: Readonly<Record<string, string>> | undefined;
  collectorOnlyLine: string | null;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const className: string = "mt-1 text-xs text-gray-500";
  const collectorOnly: ReactElement = props.collectorOnlyLine ? (
    <>
      {" "}
      <span data-testid="message-queue-broker-metrics-collector-only">
        {renderMessageQueueInlineCode(props.collectorOnlyLine)}
      </span>
    </>
  ) : (
    <></>
  );

  if (!props.line.namesConnections) {
    return (
      <p
        data-testid="message-queue-broker-metrics-source"
        className={className}
      >
        {renderMessageQueueInlineCode(
          translator.translateTemplate(props.line.template, props.line.values),
        )}
        {collectorOnly}
      </p>
    );
  }

  const around: TemplateAround = getTemplateAround(
    translator,
    props.line.template,
    MESSAGE_QUEUE_BROKER_METRICS_CONNECTIONS_SLOT,
    props.line.values,
  );
  return (
    <p data-testid="message-queue-broker-metrics-source" className={className}>
      {renderMessageQueueInlineCode(around.before)}
      <AppLink
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_CONNECT] as Route,
        )}
        className="font-medium text-indigo-600 hover:underline"
      >
        <span data-testid="message-queue-broker-metrics-source-connections">
          {getMessageQueueBrokerMetricsConnectionsLabel(
            props.connectionIds,
            props.connectionNames,
            translator,
          )}
        </span>
      </AppLink>
      {renderMessageQueueInlineCode(around.after)}
      {collectorOnly}
    </p>
  );
};

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
        data.status.sources,
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
      {/*
       * One step is a sentence, not a list of one: a number says there is
       * an order to follow.
       */}
      {finding.steps.length === 1 ? (
        <p
          data-testid="message-queue-broker-metrics-finding-step"
          className="mt-2 text-sm text-amber-800"
        >
          {renderMessageQueueInlineCode(finding.steps[0]!)}
        </p>
      ) : finding.steps.length > 1 ? (
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
      {/*
       * Where it is fixed first - Cloud > Connect, the queue's collector
       * configuration, or both - then the guide.
       */}
      <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:gap-x-4">
        {finding.cloudConnectionLink === "connect" ? (
          <AppLink
            to={getConnectRouteFor(CloudProvider.Azure)}
            className={LINK_CLASS_NAME}
          >
            <span data-testid="message-queue-broker-metrics-finding-connect">
              {translator.translateText(
                BROKER_METRICS_CONNECT_AZURE_LINK_LABEL,
              ) || ""}
            </span>
          </AppLink>
        ) : finding.cloudConnectionLink === "check" ? (
          <AppLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_CONNECT] as Route,
            )}
            className={LINK_CLASS_NAME}
          >
            <span data-testid="message-queue-broker-metrics-finding-connections">
              {translator.translateText(
                BROKER_METRICS_CLOUD_CONNECT_LINK_LABEL,
              ) || ""}
            </span>
          </AppLink>
        ) : (
          <></>
        )}
        {finding.linksCollectorConfiguration ? (
          <AppLink to={props.documentationRoute} className={LINK_CLASS_NAME}>
            {translator.translateText(
              BROKER_METRICS_CONFIGURATION_LINK_LABEL,
            ) || ""}
          </AppLink>
        ) : (
          <></>
        )}
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
      className="px-3 py-3 sm:px-4"
    >
      {/*
       * The name and its badge share the first line at every width; the
       * line saying why (or when it last arrived) runs under both, the
       * row's whole width, so a phone never squeezes it beside the badge.
       */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {getMessageQueueBrokerMetricTitle(metric.descriptor, translator)}
          </div>
          {/*
           * The stored name reads left to right on a page laid out right to
           * left too, and starts where the row's words start.
           */}
          <div className="break-all font-mono text-xs text-gray-500">
            <span dir="ltr">{metric.descriptor.metricName}</span>
          </div>
        </div>
        <div className="flex-none">
          <StatusBadge
            text={getMessageQueueBrokerMetricStateLabel(
              metric.state,
              translator,
            )}
            type={getStateBadgeType(metric.state)}
          />
        </div>
      </div>
      {arrivedAt ? (
        <p
          data-testid="message-queue-broker-metric-last-arrived"
          className="mt-1 text-xs text-gray-500"
          title={OneUptimeDate.getDateAsLocalFormattedString(arrivedAt)}
        >
          {translator.translateTemplate("Last arrived {{time}}", {
            time: OneUptimeDate.fromNow(arrivedAt, props.now),
          })}
        </p>
      ) : line ? (
        <p
          data-testid="message-queue-broker-metric-status-line"
          className="mt-1 text-xs text-gray-600"
        >
          {renderMessageQueueInlineCode(line)}
        </p>
      ) : (
        <></>
      )}
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
  /*
   * While none ever arrived, what to set up says so (the guidance), or a
   * finding says why not: either says more than "none has arrived yet".
   */
  const showsSetupGuidance: boolean = Boolean(
    status.health === "never" && findings.length === 0 && props.setupGuidance,
  );
  const showsSummary: boolean =
    status.health !== "never" || (findings.length === 0 && !showsSetupGuidance);
  const sourceLine: MessageQueueBrokerMetricsSourceLine | null =
    getMessageQueueBrokerMetricsSourceLine(status, props.messagingSystem);

  return (
    <Card
      title={BROKER_METRICS_CARD_TITLE}
      description={translator.translateTemplate(
        "Which {{system}} metrics arrive for this queue, and why any others do not.",
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
        {showsSummary ? (
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
            {sourceLine && status.sources ? (
              <SourceLine
                line={sourceLine}
                connectionIds={status.sources.connectionIds}
                connectionNames={props.connectionNames}
                collectorOnlyLine={getMessageQueueCollectorOnlyLine(
                  status,
                  props.messagingSystem,
                  translator,
                )}
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {showsSetupGuidance ? props.setupGuidance : <></>}

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
