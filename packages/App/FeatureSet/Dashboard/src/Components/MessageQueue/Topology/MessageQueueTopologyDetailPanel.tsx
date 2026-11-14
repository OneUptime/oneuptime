import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { joinWithArrowsOn } from "Common/Types/DirectionArrow";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../AppLink/AppLink";
import {
  formatMessageQueueCount,
  formatMessageQueueDurationMs,
  getMessageQueueBrokerMetricTitle,
} from "../MessageQueueOverviewPresentation";
import {
  MessageQueueHeadlineValue,
  getMessageQueueHeadlineDescriptors,
} from "./MessageQueueBrokerHeadlines";
import { MessageQueueHeadlineEntry } from "./UseMessageQueueBrokerHeadlines";
import {
  MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS,
  MessageQueueTopologyEdge,
  MessageQueueTopologyModel,
  MessageQueueTopologyNode,
  MessageQueueTopologyQueueNode,
  MessageQueueTopologyServiceNode,
  formatMessageQueueTopologyErrorRate,
  formatMessageQueueTopologyPercent,
  formatMessageQueueTopologyRate,
} from "./MessageQueueTopologyModel";
import {
  formatMessageQueueHeadlineFull,
  getMessageQueueTopologyNodeLabel,
  getMessageQueueTopologyQueueHint,
  getMessageQueueTopologyServiceReach,
  getMessageQueueTopologyStatusLabel,
  getMessageQueueTopologySubtitle,
} from "./MessageQueueTopologyPresentation";

/*
 * The topology's drawer: what one queue, service or line is doing in the
 * range, the services or queues on either side of it (each a step along
 * the map), and the way to its own page. A queue's broker numbers are the
 * ones its Broker health section shows; the drawer says when its broker
 * sends none.
 */

// A line's p95, beside the service or queue at its other end.
const P95_PUBLISH_TEMPLATE: string = translationKey("p95 publish {{duration}}");
const P95_PROCESSING_TEMPLATE: string = translationKey(
  "p95 processing {{duration}}",
);

export type MessageQueueTopologySelection =
  | { kind: "node"; key: string }
  | { kind: "edge"; edge: MessageQueueTopologyEdge };

export interface ComponentProps {
  // The model by queue (never folded by broker): what the lists are read from.
  model: MessageQueueTopologyModel;
  selection: MessageQueueTopologySelection;
  headlines: Map<string, MessageQueueHeadlineEntry>;
  // The node the map follows now, if any.
  focusKey: string | null;
  onSelectNode: (key: string) => void;
  onFocus: (key: string) => void;
  onClose: () => void;
}

interface Figure {
  label: string;
  value: string;
  detail?: string | undefined;
  testId: string;
  tone?: "warning" | "critical" | undefined;
}

function queueRoute(page: PageMap, queueId: string): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(queueId),
  });
}

function serviceRoute(serviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SERVICE_VIEW] as Route,
    {
      modelId: new ObjectID(serviceId),
    },
  );
}

// How a share of failures (0 to 1) reads: red at 5%, amber past 1%.
function toneOfRate(rate: number | null): Figure["tone"] {
  if (rate === null || !Number.isFinite(rate)) {
    return undefined;
  }
  if (rate >= 0.05) {
    return "critical";
  }
  return rate > 0.01 ? "warning" : undefined;
}

function toneOf(attempts: number, errors: number): Figure["tone"] {
  return toneOfRate(attempts > 0 ? errors / attempts : null);
}

function toneOfEdge(edge: MessageQueueTopologyEdge): Figure["tone"] {
  return toneOfRate(
    edge.errorRatePercent === null ? null : edge.errorRatePercent / 100,
  );
}

const FigureGrid: FunctionComponent<{ figures: Array<Figure> }> = (props: {
  figures: Array<Figure>;
}): ReactElement => {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {props.figures.map((figure: Figure): ReactElement => {
        return (
          <div
            key={figure.testId}
            data-testid={figure.testId}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2"
          >
            <dt className="text-xs text-gray-500">{figure.label}</dt>
            <dd
              className={`mt-1 text-lg font-semibold ${figure.tone === "critical" ? "text-red-600" : figure.tone === "warning" ? "text-amber-700" : "text-gray-900"}`}
            >
              {figure.value}
            </dd>
            {figure.detail ? (
              <dd className="text-xs text-gray-500">{figure.detail}</dd>
            ) : (
              <></>
            )}
          </div>
        );
      })}
    </dl>
  );
};

interface ListRow {
  key: string;
  name: string;
  detail: string;
  messages: string;
  errorRate: string;
  tone: Figure["tone"];
}

const LinkedList: FunctionComponent<{
  title: string;
  empty: string;
  rows: Array<ListRow>;
  testId: string;
  onSelect: (key: string) => void;
}> = (props: {
  title: string;
  empty: string;
  rows: Array<ListRow>;
  testId: string;
  onSelect: (key: string) => void;
}): ReactElement => {
  return (
    <section data-testid={props.testId}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {props.title}{" "}
        <span className="font-normal normal-case text-gray-400">
          ({props.rows.length})
        </span>
      </h4>
      {props.rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{props.empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {props.rows.map((row: ListRow): ReactElement => {
            return (
              <li key={row.key}>
                <button
                  type="button"
                  data-testid={`${props.testId}-row`}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  onClick={() => {
                    props.onSelect(row.key);
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {row.name}
                    </span>
                    {row.detail ? (
                      <span className="block truncate text-xs text-gray-500">
                        {row.detail}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs text-gray-700">
                    <span className="block font-semibold">{row.messages}</span>
                    <span
                      className={
                        row.tone === "critical"
                          ? "text-red-600"
                          : row.tone === "warning"
                            ? "text-amber-700"
                            : "text-gray-500"
                      }
                    >
                      {row.errorRate}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

const MessageQueueTopologyDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const windowSeconds: number = props.model.windowSeconds;

  const edgesOf: (key: string) => Array<MessageQueueTopologyEdge> = (
    key: string,
  ): Array<MessageQueueTopologyEdge> => {
    return props.model.edges
      .filter((edge: MessageQueueTopologyEdge): boolean => {
        return edge.queueKey === key || edge.serviceKey === key;
      })
      .sort((a: MessageQueueTopologyEdge, b: MessageQueueTopologyEdge) => {
        return b.messages - a.messages || a.id.localeCompare(b.id);
      });
  };

  const rowFor: (
    edge: MessageQueueTopologyEdge,
    otherKey: string,
    timeLabel: string,
  ) => ListRow = (
    edge: MessageQueueTopologyEdge,
    otherKey: string,
    timeLabel: string,
  ): ListRow => {
    const other: MessageQueueTopologyNode | undefined =
      props.model.nodeByKey.get(otherKey);
    return {
      key: otherKey,
      name: other
        ? getMessageQueueTopologyNodeLabel(other, translator)
        : otherKey,
      detail:
        edge.p95DurationMs === null
          ? other?.kind === "queue"
            ? other.subtitle
            : ""
          : translator.translateTemplate(timeLabel, {
              duration: formatMessageQueueDurationMs(edge.p95DurationMs),
            }),
      messages: translator.translateTemplate("{{count}} messages", {
        count: formatMessageQueueCount(edge.messages),
      }),
      errorRate: translator.translateTemplate("{{rate}} errors", {
        rate: formatMessageQueueTopologyPercent(edge.errorRatePercent),
      }),
      tone: toneOfEdge(edge),
    };
  };

  const focusButton: (key: string) => ReactElement = (
    key: string,
  ): ReactElement => {
    if (props.focusKey === key) {
      return <></>;
    }
    return (
      <button
        type="button"
        data-testid="message-queue-topology-drawer-focus"
        className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
        onClick={() => {
          props.onFocus(key);
        }}
      >
        {translator.translateText("Show its flow")}
      </button>
    );
  };

  const headlineFigures: (
    node: MessageQueueTopologyQueueNode,
  ) => Array<Figure> = (node: MessageQueueTopologyQueueNode): Array<Figure> => {
    const entry: MessageQueueHeadlineEntry | undefined = props.headlines.get(
      node.queue.id,
    );
    const descriptors: ReturnType<typeof getMessageQueueHeadlineDescriptors> =
      getMessageQueueHeadlineDescriptors(node.queue.messagingSystem);
    const figures: Array<Figure> = [];
    const add: (
      kind: "waiting" | "deadLetter",
      value: MessageQueueHeadlineValue | null,
    ) => void = (
      kind: "waiting" | "deadLetter",
      value: MessageQueueHeadlineValue | null,
    ): void => {
      const first: (typeof descriptors.waiting)[number] | undefined =
        descriptors[kind][0];
      if (!first) {
        return;
      }
      figures.push({
        label: getMessageQueueBrokerMetricTitle(
          value ? value.descriptor : first,
          translator,
        ),
        value:
          entry?.status === "loading"
            ? "…"
            : value
              ? formatMessageQueueHeadlineFull(value)
              : "—",
        detail:
          entry?.status === "ready" && !value
            ? translator.translateText("Not reported in this range")
            : !entry
              ? translator.translateText("No broker metrics lately")
              : undefined,
        testId: `message-queue-topology-drawer-${kind}`,
      });
    };
    add("waiting", entry?.status === "ready" ? entry.headline.waiting : null);
    add(
      "deadLetter",
      entry?.status === "ready" ? entry.headline.deadLetter : null,
    );
    return figures;
  };

  const renderQueue: (node: MessageQueueTopologyQueueNode) => ReactElement = (
    node: MessageQueueTopologyQueueNode,
  ): ReactElement => {
    const queue: MessageQueueTopologyQueueNode["queue"] = node.queue;
    const edges: Array<MessageQueueTopologyEdge> = edgesOf(node.key);
    const hint: string | null = getMessageQueueTopologyQueueHint(queue);
    const figures: Array<Figure> = [
      {
        label: translator.translateText("Published") || "Published",
        value: formatMessageQueueCount(queue.published),
        detail: formatMessageQueueTopologyRate(queue.published, windowSeconds),
        testId: "message-queue-topology-drawer-published",
      },
      {
        label: translator.translateText("Consumed") || "Consumed",
        value: formatMessageQueueCount(queue.consumed),
        detail: formatMessageQueueTopologyRate(queue.consumed, windowSeconds),
        testId: "message-queue-topology-drawer-consumed",
      },
      {
        label: translator.translateText("Errors") || "Errors",
        value: formatMessageQueueCount(queue.errors),
        detail: translator.translateTemplate("{{rate}} of its spans", {
          rate: formatMessageQueueTopologyErrorRate(queue.spans, queue.errors),
        }),
        testId: "message-queue-topology-drawer-errors",
        tone: toneOf(queue.spans, queue.errors),
      },
      ...headlineFigures(node),
    ];
    return (
      <div
        className="space-y-5"
        data-testid="message-queue-topology-drawer-queue"
      >
        <p className="flex items-center gap-2 text-sm text-gray-700">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              backgroundColor:
                MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS[node.status],
            }}
            aria-hidden={true}
          />
          {getMessageQueueTopologyStatusLabel(node.status, translator)}
        </p>
        {hint ? (
          <p
            className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            data-testid="message-queue-topology-drawer-hint"
          >
            {translator.translateText(hint)}
          </p>
        ) : (
          <></>
        )}
        <FigureGrid figures={figures} />
        <LinkedList
          title={translator.translateText("Published by") || "Published by"}
          empty={
            translator.translateText(
              "No traced service published to it in this range.",
            ) || ""
          }
          testId="message-queue-topology-drawer-producers"
          rows={edges
            .filter((edge: MessageQueueTopologyEdge): boolean => {
              return edge.direction === "publish";
            })
            .map((edge: MessageQueueTopologyEdge): ListRow => {
              return rowFor(edge, edge.serviceKey, P95_PUBLISH_TEMPLATE);
            })}
          onSelect={props.onSelectNode}
        />
        <LinkedList
          title={translator.translateText("Consumed by") || "Consumed by"}
          empty={
            translator.translateText(
              "No traced service consumed from it in this range.",
            ) || ""
          }
          testId="message-queue-topology-drawer-consumers"
          rows={edges
            .filter((edge: MessageQueueTopologyEdge): boolean => {
              return edge.direction === "consume";
            })
            .map((edge: MessageQueueTopologyEdge): ListRow => {
              return rowFor(edge, edge.serviceKey, P95_PROCESSING_TEMPLATE);
            })}
          onSelect={props.onSelectNode}
        />
        <div className="flex flex-wrap items-center gap-3">
          <AppLink
            to={queueRoute(PageMap.MESSAGE_QUEUE_VIEW, queue.id)}
            dataTestId="message-queue-topology-drawer-open-queue"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <span>{translator.translateText("Open queue")}</span>
          </AppLink>
          <AppLink
            to={queueRoute(PageMap.MESSAGE_QUEUE_VIEW_TRACES, queue.id)}
            dataTestId="message-queue-topology-drawer-traces"
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            <span>{translator.translateText("View traces")}</span>
          </AppLink>
          {focusButton(node.key)}
        </div>
      </div>
    );
  };

  const renderService: (
    node: MessageQueueTopologyServiceNode,
  ) => ReactElement = (node: MessageQueueTopologyServiceNode): ReactElement => {
    const edges: Array<MessageQueueTopologyEdge> = edgesOf(node.key);
    const figures: Array<Figure> = [
      {
        label: translator.translateText("Published") || "Published",
        value: formatMessageQueueCount(node.published.messages),
        detail: formatMessageQueueTopologyRate(
          node.published.messages,
          windowSeconds,
        ),
        testId: "message-queue-topology-drawer-published",
        tone: toneOf(node.published.attempts, node.published.errors),
      },
      {
        label: translator.translateText("Consumed") || "Consumed",
        value: formatMessageQueueCount(node.consumed.messages),
        detail: formatMessageQueueTopologyRate(
          node.consumed.messages,
          windowSeconds,
        ),
        testId: "message-queue-topology-drawer-consumed",
        tone: toneOf(node.consumed.attempts, node.consumed.errors),
      },
    ];
    const reach: string | undefined = getMessageQueueTopologyServiceReach(
      node,
      translator,
    );
    return (
      <div
        className="space-y-5"
        data-testid="message-queue-topology-drawer-service"
      >
        <p className="flex items-center gap-2 text-sm text-gray-700">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              backgroundColor:
                MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS[node.status],
            }}
            aria-hidden={true}
          />
          {getMessageQueueTopologyStatusLabel(node.status, translator)}
          {reach ? <span className="text-gray-500">· {reach}</span> : <></>}
        </p>
        <FigureGrid figures={figures} />
        <LinkedList
          title={translator.translateText("Publishes to") || "Publishes to"}
          empty={
            translator.translateText(
              "It published to no queue in this range.",
            ) || ""
          }
          testId="message-queue-topology-drawer-publishes-to"
          rows={edges
            .filter((edge: MessageQueueTopologyEdge): boolean => {
              return edge.direction === "publish";
            })
            .map((edge: MessageQueueTopologyEdge): ListRow => {
              return rowFor(edge, edge.queueKey, P95_PUBLISH_TEMPLATE);
            })}
          onSelect={props.onSelectNode}
        />
        <LinkedList
          title={translator.translateText("Consumes from") || "Consumes from"}
          empty={
            translator.translateText(
              "It consumed from no queue in this range.",
            ) || ""
          }
          testId="message-queue-topology-drawer-consumes-from"
          rows={edges
            .filter((edge: MessageQueueTopologyEdge): boolean => {
              return edge.direction === "consume";
            })
            .map((edge: MessageQueueTopologyEdge): ListRow => {
              return rowFor(edge, edge.queueKey, P95_PROCESSING_TEMPLATE);
            })}
          onSelect={props.onSelectNode}
        />
        <div className="flex flex-wrap items-center gap-3">
          {node.isNamed ? (
            <AppLink
              to={serviceRoute(node.service.id)}
              dataTestId="message-queue-topology-drawer-open-service"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <span>{translator.translateText("Open service")}</span>
            </AppLink>
          ) : (
            <></>
          )}
          {focusButton(node.key)}
        </div>
      </div>
    );
  };

  const renderEdge: (edge: MessageQueueTopologyEdge) => ReactElement = (
    edge: MessageQueueTopologyEdge,
  ): ReactElement => {
    const queue: MessageQueueTopologyNode | undefined =
      props.model.nodeByKey.get(edge.queueKey);
    const service: MessageQueueTopologyNode | undefined =
      props.model.nodeByKey.get(edge.serviceKey);
    const figures: Array<Figure> = [
      {
        label: translator.translateText("Messages") || "Messages",
        value: formatMessageQueueCount(edge.messages),
        detail: formatMessageQueueTopologyRate(edge.messages, windowSeconds),
        testId: "message-queue-topology-drawer-messages",
      },
      {
        label: translator.translateText("Errors") || "Errors",
        value: formatMessageQueueCount(edge.errors),
        detail: formatMessageQueueTopologyPercent(edge.errorRatePercent),
        testId: "message-queue-topology-drawer-errors",
        tone: toneOfEdge(edge),
      },
    ];
    if (edge.p95DurationMs !== null) {
      figures.push({
        label:
          (edge.direction === "publish"
            ? translator.translateText("p95 publish")
            : translator.translateText("p95 processing")) || "",
        value: formatMessageQueueDurationMs(edge.p95DurationMs),
        testId: "message-queue-topology-drawer-p95",
      });
    }
    return (
      <div
        className="space-y-5"
        data-testid="message-queue-topology-drawer-edge"
      >
        <FigureGrid figures={figures} />
        <div className="flex flex-wrap items-center gap-3">
          {queue?.kind === "queue" ? (
            <AppLink
              to={queueRoute(PageMap.MESSAGE_QUEUE_VIEW, queue.queue.id)}
              dataTestId="message-queue-topology-drawer-open-queue"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <span>{translator.translateText("Open queue")}</span>
            </AppLink>
          ) : (
            <></>
          )}
          {service?.kind === "service" && service.isNamed ? (
            <AppLink
              to={serviceRoute(service.service.id)}
              dataTestId="message-queue-topology-drawer-open-service"
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              <span>{translator.translateText("Open service")}</span>
            </AppLink>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  };

  let title: string = "";
  let description: string = "";
  let body: ReactElement = <></>;

  if (props.selection.kind === "edge") {
    const edge: MessageQueueTopologyEdge = props.selection.edge;
    const from: MessageQueueTopologyNode | undefined =
      props.model.nodeByKey.get(edge.from);
    const to: MessageQueueTopologyNode | undefined = props.model.nodeByKey.get(
      edge.to,
    );
    title = joinWithArrowsOn(
      [
        from ? getMessageQueueTopologyNodeLabel(from, translator) : edge.from,
        to ? getMessageQueueTopologyNodeLabel(to, translator) : edge.to,
      ],
      translator.language,
    );
    description =
      (edge.direction === "publish"
        ? translator.translateText(
            "Messages this service published to this queue in the selected range.",
          )
        : translator.translateText(
            "Messages this service consumed from this queue in the selected range.",
          )) || "";
    body = renderEdge(edge);
  } else {
    const node: MessageQueueTopologyNode | undefined =
      props.model.nodeByKey.get(props.selection.key);
    if (node) {
      title = getMessageQueueTopologyNodeLabel(node, translator);
      description = getMessageQueueTopologySubtitle(node, translator);
      body =
        node.kind === "queue" ? (
          renderQueue(node)
        ) : node.kind === "service" ? (
          renderService(node)
        ) : (
          <></>
        );
    }
  }

  return (
    <SideOver
      title={title}
      description={description}
      size={SideOverSize.Small}
      onClose={props.onClose}
    >
      {body}
    </SideOver>
  );
};

export default MessageQueueTopologyDetailPanel;
