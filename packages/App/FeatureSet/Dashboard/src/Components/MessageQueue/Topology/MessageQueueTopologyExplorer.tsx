import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { MessageQueueTopologyResponse } from "Common/Types/MessageQueue/MessageQueueTopology";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import DirectionArrow from "Common/UI/Components/DirectionArrow/DirectionArrow";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../AppLink/AppLink";
import {
  formatMessageQueueCount,
  getMessageQueueDocsRoute,
} from "../MessageQueueOverviewPresentation";
import { MessageQueueHeadlineQueue } from "./MessageQueueBrokerHeadlines";
import MessageQueueTopologyDetailPanel, {
  MessageQueueTopologySelection,
} from "./MessageQueueTopologyDetailPanel";
import MessageQueueTopologyMap, {
  MESSAGE_QUEUE_TOPOLOGY_COLUMN_GAP,
  MESSAGE_QUEUE_TOPOLOGY_ROW_GAP,
} from "./MessageQueueTopologyMap";
import {
  MESSAGE_QUEUE_TOPOLOGY_MAX_NODES_FOR_DEFAULT_MAP,
  MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS,
  MessageQueueTopologyBrokerGroup,
  MessageQueueTopologyEdge,
  MessageQueueTopologyEmptyReason,
  MessageQueueTopologyLayout,
  MessageQueueTopologyModel,
  MessageQueueTopologyNode,
  MessageQueueTopologyQueueNode,
  MessageQueueTopologyServiceNode,
  MessageQueueTopologyTableRow,
  MessageQueueTopologyVisibility,
  buildMessageQueueTopologyModel,
  formatMessageQueueTopologyErrorRate,
  formatMessageQueueTopologyRate,
  getMessageQueueTopologyEmptyReason,
  getMessageQueueTopologyQueueKey,
  getMessageQueueTopologyTableRows,
  groupMessageQueueTopologyByBroker,
  layoutMessageQueueTopology,
  resolveMessageQueueTopologyVisibility,
} from "./MessageQueueTopologyModel";
import {
  MessageQueueTopologyEdgeLabel,
  formatMessageQueueHeadlineShort,
  getMessageQueueTopologyNodeLabel,
  getMessageQueueTopologyStatusLabel,
} from "./MessageQueueTopologyPresentation";
import useMessageQueueBrokerHeadlines, {
  MessageQueueHeadlineEntry,
} from "./UseMessageQueueBrokerHeadlines";

/*
 * THE QUEUES TOPOLOGY: how messages flow between the project's services and
 * its queues over the range the page picked. A map left to right the way
 * messages travel, or a table of queues for a project too large to draw at
 * once; search, a broker filter, "Needs attention", one broker folded into
 * one card, and a focus that follows one queue's or service's messages
 * upstream and downstream. A drawer on anything selected says what it did
 * and leads to its own page.
 *
 * The Queues product's Topology page draws the whole project; a queue's own
 * Topology tab draws the same, focused on the queue (anchorQueueId), with
 * the way back to it while the focus is elsewhere.
 */

type TopologyView = "map" | "table";

const ROWS_PER_PAGE: number = 40;
// The most queues without traced messages listed under the map.
const MAX_UNCONNECTED_LISTED: number = 24;

export interface ComponentProps {
  data: MessageQueueTopologyResponse;
  // The range of `data`.
  window: { start: Date; end: Date };
  // A queue's own tab: the queue the map follows unless told otherwise.
  anchorQueueId?: string | undefined;
}

function readView(): TopologyView | null {
  const value: string | null = Navigation.getQueryStringByName("view");
  return value === "map" || value === "table" ? value : null;
}

const MessageQueueTopologyExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const t: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const anchorKey: string | null = props.anchorQueueId
    ? getMessageQueueTopologyQueueKey(props.anchorQueueId)
    : null;

  const [searchText, setSearchTextState] = useState<string>(
    Navigation.getQueryStringByName("search") || "",
  );
  const [brokerGroupKey, setBrokerGroupKeyState] = useState<string | null>(
    Navigation.getQueryStringByName("broker"),
  );
  const [attentionOnly, setAttentionOnly] = useState<boolean>(false);
  const [grouped, setGrouped] = useState<boolean>(false);
  const [focusKey, setFocusKeyState] = useState<string | null>(
    Navigation.getQueryStringByName("focus") || anchorKey,
  );
  const [viewChoice, setViewChoice] = useState<TopologyView | null>(readView);
  const [edgeLabel, setEdgeLabel] =
    useState<MessageQueueTopologyEdgeLabel>("rate");
  const [selection, setSelection] =
    useState<MessageQueueTopologySelection | null>(null);
  const [page, setPage] = useState<number>(0);

  /*
   * The table's columns as wide as a person makes them (Common's
   * Table/ColumnResize), as the service map's list does: a queue's name
   * gives way to 10rem, the services on either side of it to 8rem, a rate
   * or a count never.
   */
  const tableColumns: ResizableColumns = useResizableColumns({
    tableKey: "message-queue-topology-table",
    columns: [
      { id: "queue", cellNumber: 1 },
      { id: "publishedBy", cellNumber: 2 },
      { id: "consumedBy", cellNumber: 3 },
      { id: "in", cellNumber: 4 },
      { id: "out", cellNumber: 5 },
      { id: "errors", cellNumber: 6 },
      { id: "waiting", cellNumber: 7 },
    ],
  });

  /*
   * The URL mirrors the filters, debounced for the search box: a
   * replaceState per keystroke trips Safari's rate limit.
   */
  const searchUrlTimeout: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (searchUrlTimeout.current) {
        clearTimeout(searchUrlTimeout.current);
      }
    };
  }, []);
  const setSearchText: (value: string) => void = (value: string): void => {
    setSearchTextState(value);
    if (searchUrlTimeout.current) {
      clearTimeout(searchUrlTimeout.current);
    }
    searchUrlTimeout.current = setTimeout(() => {
      Navigation.setQueryString({ search: value || null });
    }, 250);
  };
  const setFocusKey: (value: string | null) => void = (
    value: string | null,
  ): void => {
    setFocusKeyState(value);
    Navigation.setQueryString({
      focus: value && value !== anchorKey ? value : null,
    });
  };
  const setBrokerGroupKey: (value: string | null) => void = (
    value: string | null,
  ): void => {
    setBrokerGroupKeyState(value);
    Navigation.setQueryString({ broker: value });
  };
  const changeView: (value: TopologyView) => void = (
    value: TopologyView,
  ): void => {
    setViewChoice(value);
    Navigation.setQueryString({ view: value });
  };

  const windowSeconds: number = Math.max(
    1,
    (props.window.end.getTime() - props.window.start.getTime()) / 1000,
  );

  const baseModel: MessageQueueTopologyModel = useMemo(() => {
    return buildMessageQueueTopologyModel(props.data, {
      windowSeconds: windowSeconds,
    });
  }, [props.data, windowSeconds]);

  // Folding by broker is for the whole map; a focus draws its own path.
  const isGrouped: boolean =
    grouped && !focusKey && baseModel.brokerGroups.length > 0;
  const model: MessageQueueTopologyModel = useMemo(() => {
    return isGrouped ? groupMessageQueueTopologyByBroker(baseModel) : baseModel;
  }, [baseModel, isGrouped]);

  const visibility: MessageQueueTopologyVisibility = useMemo(() => {
    return resolveMessageQueueTopologyVisibility(model, {
      search: searchText,
      brokerGroupKey: brokerGroupKey,
      attentionOnly: attentionOnly,
      focusKey: focusKey,
    });
  }, [model, searchText, brokerGroupKey, attentionOnly, focusKey]);

  useEffect(() => {
    setPage(0);
  }, [searchText, brokerGroupKey, attentionOnly, focusKey]);

  /*
   * The default follows the size of the whole map, never the filters:
   * typing in the search box must not flip the view. A queue's own tab
   * opens on the map of its flow.
   */
  const view: TopologyView =
    viewChoice ||
    (anchorKey ||
    baseModel.nodes.length <= MESSAGE_QUEUE_TOPOLOGY_MAX_NODES_FOR_DEFAULT_MAP
      ? "map"
      : "table");

  const layout: MessageQueueTopologyLayout = useMemo(() => {
    if (view !== "map") {
      return { positions: new Map(), unconnectedKeys: [] };
    }
    return layoutMessageQueueTopology({
      visibleKeys: visibility.visibleKeys,
      edges: model.edges,
      columnGap: MESSAGE_QUEUE_TOPOLOGY_COLUMN_GAP,
      rowGap: MESSAGE_QUEUE_TOPOLOGY_ROW_GAP,
    });
  }, [view, visibility, model]);

  const tableRows: Array<MessageQueueTopologyTableRow> = useMemo(() => {
    return view === "table"
      ? getMessageQueueTopologyTableRows(baseModel, visibility)
      : [];
  }, [view, baseModel, visibility]);
  const pageCount: number = Math.max(
    1,
    Math.ceil(tableRows.length / ROWS_PER_PAGE),
  );
  const currentPage: number = Math.min(page, pageCount - 1);
  const pageRows: Array<MessageQueueTopologyTableRow> = tableRows.slice(
    currentPage * ROWS_PER_PAGE,
    (currentPage + 1) * ROWS_PER_PAGE,
  );

  // The queues whose broker numbers are worth reading: the ones on screen.
  const selectedQueueNode: MessageQueueTopologyQueueNode | null =
    selection?.kind === "node" &&
    baseModel.nodeByKey.get(selection.key)?.kind === "queue"
      ? (baseModel.nodeByKey.get(
          selection.key,
        ) as MessageQueueTopologyQueueNode)
      : null;
  const onScreenQueues: Array<MessageQueueHeadlineQueue> = useMemo(() => {
    const keys: Set<string> = new Set<string>();
    if (view === "map") {
      for (const key of layout.positions.keys()) {
        keys.add(key);
      }
    } else {
      for (const row of pageRows) {
        keys.add(row.node.key);
      }
    }
    if (selectedQueueNode) {
      keys.add(selectedQueueNode.key);
    }
    const queues: Array<MessageQueueHeadlineQueue> = [];
    for (const key of keys) {
      const node: MessageQueueTopologyNode | undefined =
        baseModel.nodeByKey.get(key);
      if (node?.kind === "queue") {
        queues.push({
          id: node.queue.id,
          queueIdentifier: node.queue.queueIdentifier,
          messagingSystem: node.queue.messagingSystem,
          brokerScope: node.queue.brokerScope,
          brokerMetricsLastSeenAt: node.queue.brokerMetricsLastSeenAt,
        });
      }
    }
    return queues;
  }, [view, layout, pageRows, selectedQueueNode, baseModel]);

  const headlines: Map<string, MessageQueueHeadlineEntry> =
    useMessageQueueBrokerHeadlines({
      projectId: ProjectUtil.getCurrentProjectId(),
      queues: onScreenQueues,
      window: props.window,
    });

  const emptyReason: MessageQueueTopologyEmptyReason | null =
    getMessageQueueTopologyEmptyReason(baseModel);

  const isFiltering: boolean =
    Boolean(searchText.trim()) ||
    attentionOnly ||
    Boolean(brokerGroupKey) ||
    Boolean(focusKey && focusKey !== anchorKey);

  const resetFilters: () => void = (): void => {
    setSearchText("");
    setAttentionOnly(false);
    setBrokerGroupKey(null);
    setFocusKey(anchorKey);
  };

  const focusOn: (key: string) => void = (key: string): void => {
    setSelection(null);
    setSearchText("");
    setAttentionOnly(false);
    setFocusKey(key);
    changeView("map");
  };

  const selectNode: (key: string) => void = (key: string): void => {
    const node: MessageQueueTopologyNode | undefined = model.nodeByKey.get(key);
    if (node?.kind === "broker") {
      // A broker opens into its queues.
      setGrouped(false);
      setBrokerGroupKey(node.groupKey);
      setSelection(null);
      return;
    }
    setSelection({ kind: "node", key: key });
  };

  const selectEdge: (id: string) => void = (id: string): void => {
    const edge: MessageQueueTopologyEdge | undefined = model.edges.find(
      (candidate: MessageQueueTopologyEdge): boolean => {
        return candidate.id === id;
      },
    );
    if (edge) {
      setSelection({ kind: "edge", edge: edge });
    }
  };

  const focusedNode: MessageQueueTopologyNode | null =
    (visibility.effectiveFocusKey &&
      baseModel.nodeByKey.get(visibility.effectiveFocusKey)) ||
    null;
  const anchorNode: MessageQueueTopologyNode | null =
    (anchorKey && baseModel.nodeByKey.get(anchorKey)) || null;

  const docsInstrumenting: Route = getMessageQueueDocsRoute(
    "instrumenting-applications",
  );

  const renderGuidance: (
    reason: MessageQueueTopologyEmptyReason,
  ) => ReactElement = (
    reason: MessageQueueTopologyEmptyReason,
  ): ReactElement => {
    const copy: Record<
      MessageQueueTopologyEmptyReason,
      { title: string; text: string }
    > = {
      noQueues: {
        title: t("No queues yet"),
        text: t(
          "Queues appear here on their own once your applications send OpenTelemetry messaging spans, or your broker's metrics reach OneUptime. Then this map shows which services publish to each queue and which consume from it.",
        ),
      },
      noTraffic: {
        title: t("No traced messages in this range"),
        text: translator.translatePlural(
          {
            one: "You have {{count}} queue, but no instrumented service published to it or consumed from it in the selected range. Pick a longer range, or instrument the services on either side of it.",
            other:
              "You have {{count}} queues, but no instrumented service published to or consumed from any of them in the selected range. Pick a longer range, or instrument the services on either side of them.",
          },
          baseModel.queueCount,
        ),
      },
      noFlows: {
        title: t("No publishes or consumes in this range"),
        text: t(
          "Your queues have spans in the selected range, but none of them records a service publishing a message or consuming one: only receives, settlements or other calls to the broker. Make sure your producers record PRODUCER spans and your consumers CONSUMER spans.",
        ),
      },
    };
    return (
      <div
        className="border-b border-gray-200 bg-gradient-to-b from-indigo-50/60 to-white px-6 py-8"
        data-testid={`message-queue-topology-empty-${reason}`}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
            <Icon icon={IconProp.QueueList} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">
              {copy[reason].title}
            </h3>
            <p className="mt-1 text-sm text-gray-600">{copy[reason].text}</p>
            <ul className="mt-3 space-y-2 text-sm text-gray-600">
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" />
                <span>
                  {t(
                    "Instrument the services that publish and consume with OpenTelemetry. The messaging instrumentations for Kafka, RabbitMQ, Amazon SQS and SNS, Azure Service Bus, Google Pub/Sub and others record producer and consumer spans with no code changes.",
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" />
                <span>
                  {t(
                    "Each span names its queue and broker (messaging.destination.name and messaging.system), so OneUptime can tell which queue a service published to or consumed from.",
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" />
                <span>
                  {t(
                    "Send your broker's metrics too, to see backlog, consumer lag and dead letters on each queue.",
                  )}
                </span>
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <Link
                to={docsInstrumenting}
                openInNewTab={true}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                {t("How to instrument applications →")}
              </Link>
              <AppLink
                to={
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MESSAGE_QUEUES_DOCUMENTATION] as Route,
                  ) as Route
                }
                className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              >
                {t("Set up Queues")}
              </AppLink>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const statusDot: (node: MessageQueueTopologyNode) => ReactElement = (
    node: MessageQueueTopologyNode,
  ): ReactElement => {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: MESSAGE_QUEUE_TOPOLOGY_STATUS_COLORS[node.status],
        }}
        aria-hidden={true}
      />
    );
  };

  const serviceNames: (
    services: Array<MessageQueueTopologyServiceNode>,
  ) => ReactElement = (
    services: Array<MessageQueueTopologyServiceNode>,
  ): ReactElement => {
    if (services.length === 0) {
      return <span className="text-gray-400">—</span>;
    }
    const shown: Array<MessageQueueTopologyServiceNode> = services.slice(0, 3);
    return (
      <span className="flex flex-wrap gap-x-2 gap-y-1">
        {shown.map((service: MessageQueueTopologyServiceNode): ReactElement => {
          return (
            <button
              key={service.key}
              type="button"
              className="max-w-[10rem] truncate text-left text-sm text-gray-700 hover:text-indigo-600"
              title={getMessageQueueTopologyNodeLabel(service, translator)}
              onClick={() => {
                selectNode(service.key);
              }}
            >
              {getMessageQueueTopologyNodeLabel(service, translator)}
            </button>
          );
        })}
        {services.length > shown.length ? (
          <span className="text-xs text-gray-500">
            {translator.translateTemplate("+{{count}} more", {
              count: String(services.length - shown.length),
            })}
          </span>
        ) : (
          <></>
        )}
      </span>
    );
  };

  const waitingCell: (node: MessageQueueTopologyQueueNode) => string = (
    node: MessageQueueTopologyQueueNode,
  ): string => {
    const entry: MessageQueueHeadlineEntry | undefined = headlines.get(
      node.queue.id,
    );
    if (entry?.status === "loading") {
      return "…";
    }
    if (entry?.status === "ready" && entry.headline.waiting) {
      return formatMessageQueueHeadlineShort(entry.headline.waiting);
    }
    return "—";
  };

  const renderTable: () => ReactElement = (): ReactElement => {
    return (
      <div className="min-w-0 w-full max-w-full">
        <div
          className="relative min-w-0 w-full max-w-full overflow-x-auto"
          role="region"
          aria-label={t("Queues and the services on either side of them")}
          tabIndex={0}
        >
          {tableColumns.styles}
          <table
            className={`${tableColumns.getTableWidthClassName("w-full")} text-left text-sm`}
            data-testid="message-queue-topology-table"
            {...tableColumns.tableAttributes}
          >
            <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
              <tr>
                <ResizableHeaderCell
                  scope="col"
                  className="px-5 py-3 font-medium"
                  resize={tableColumns.getResize(
                    "queue",
                    t("Queue"),
                    ColumnWidthKind.Name,
                  )}
                >
                  <span>{t("Queue")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="px-4 py-3 font-medium"
                  resize={tableColumns.getResize(
                    "publishedBy",
                    t("Published by"),
                    ColumnWidthKind.Text,
                  )}
                >
                  <span>{t("Published by")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="px-4 py-3 font-medium"
                  resize={tableColumns.getResize(
                    "consumedBy",
                    t("Consumed by"),
                    ColumnWidthKind.Text,
                  )}
                >
                  <span>{t("Consumed by")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="px-4 py-3 font-medium"
                  resize={tableColumns.getResize(
                    "in",
                    t("In"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{t("In")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="px-4 py-3 font-medium"
                  resize={tableColumns.getResize(
                    "out",
                    t("Out"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{t("Out")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="px-4 py-3 font-medium"
                  resize={tableColumns.getResize(
                    "errors",
                    t("Errors"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{t("Errors")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="px-4 py-3 font-medium"
                  resize={tableColumns.getResize(
                    "waiting",
                    t("Waiting"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{t("Waiting")}</span>
                </ResizableHeaderCell>
                <th scope="col" className="px-5 py-3 font-medium">
                  <span className="sr-only">{t("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map(
                (row: MessageQueueTopologyTableRow): ReactElement => {
                  const queue: MessageQueueTopologyQueueNode["queue"] =
                    row.node.queue;
                  return (
                    <tr
                      key={row.node.key}
                      className="hover:bg-gray-50"
                      data-testid="message-queue-topology-table-row"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          {statusDot(row.node)}
                          <span className="min-w-0">
                            <button
                              type="button"
                              className="max-w-xs break-words text-left font-semibold text-gray-900 hover:text-indigo-600"
                              onClick={() => {
                                selectNode(row.node.key);
                              }}
                            >
                              {row.node.label}
                            </button>
                            <span className="mt-0.5 block text-xs text-gray-500">
                              {row.node.subtitle}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {serviceNames(row.producers)}
                      </td>
                      <td className="px-4 py-3">
                        {serviceNames(row.consumers)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {formatMessageQueueTopologyRate(
                          queue.published,
                          windowSeconds,
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {formatMessageQueueTopologyRate(
                          queue.consumed,
                          windowSeconds,
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {formatMessageQueueTopologyErrorRate(
                          queue.spans,
                          queue.errors,
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {waitingCell(row.node)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          className="whitespace-nowrap text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                          data-testid="message-queue-topology-show-on-map"
                          onClick={() => {
                            focusOn(row.node.key);
                          }}
                        >
                          {t("Show its flow")}{" "}
                          <DirectionArrow isDecorative={true} />
                        </button>
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
        {tableRows.length > ROWS_PER_PAGE && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 text-xs text-gray-500"
            data-testid="message-queue-topology-pagination"
          >
            <p>
              {translator.translateTemplate(
                "Showing {{from}}–{{to}} of {{total}}",
                {
                  from: String(currentPage * ROWS_PER_PAGE + 1),
                  to: String(
                    Math.min(
                      (currentPage + 1) * ROWS_PER_PAGE,
                      tableRows.length,
                    ),
                  ),
                  total: String(tableRows.length),
                },
              )}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={currentPage === 0}
                className={`rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-700 ${getHandDrawnButtonStateClassName(
                  {
                    isLocked: currentPage === 0,
                    hoverClassName: "hover:bg-gray-50",
                  },
                )}`}
                onClick={() => {
                  setPage(currentPage - 1);
                }}
              >
                {t("Previous")}
              </button>
              <button
                type="button"
                disabled={currentPage >= pageCount - 1}
                className={`rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-700 ${getHandDrawnButtonStateClassName(
                  {
                    isLocked: currentPage >= pageCount - 1,
                    hoverClassName: "hover:bg-gray-50",
                  },
                )}`}
                onClick={() => {
                  setPage(currentPage + 1);
                }}
              >
                {t("Next")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const unconnected: Array<MessageQueueTopologyNode> = layout.unconnectedKeys
    .map((key: string): MessageQueueTopologyNode | undefined => {
      return model.nodeByKey.get(key);
    })
    .filter(
      (
        node: MessageQueueTopologyNode | undefined,
      ): node is MessageQueueTopologyNode => {
        return Boolean(node);
      },
    )
    .sort(
      (a: MessageQueueTopologyNode, b: MessageQueueTopologyNode): number => {
        return a.label.localeCompare(b.label);
      },
    );

  const renderUnconnected: () => ReactElement = (): ReactElement => {
    if (unconnected.length === 0) {
      return <></>;
    }
    const listed: Array<MessageQueueTopologyNode> = unconnected.slice(
      0,
      MAX_UNCONNECTED_LISTED,
    );
    return (
      <section
        className="border-t border-gray-200 px-5 py-4"
        aria-label={t("Queues without traced messages")}
        data-testid="message-queue-topology-unconnected"
      >
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t("Without traced messages in this range")}{" "}
          <span className="font-normal normal-case text-gray-400">
            ({unconnected.length})
          </span>
        </h4>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listed.map((node: MessageQueueTopologyNode): ReactElement => {
            return (
              <button
                key={node.key}
                type="button"
                data-testid="message-queue-topology-unconnected-item"
                className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${selection?.kind === "node" && selection.key === node.key ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-white"}`}
                onClick={() => {
                  selectNode(node.key);
                }}
              >
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                  style={{ color: node.color, background: `${node.color}1a` }}
                >
                  <Icon icon={IconProp.QueueList} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {getMessageQueueTopologyNodeLabel(node, translator)}
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {getMessageQueueTopologyStatusLabel(
                      node.status,
                      translator,
                    )}
                    {node.subtitle ? ` · ${node.subtitle}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {unconnected.length > listed.length ? (
          <p className="mt-3 text-xs text-gray-500">
            {translator.translateTemplate(
              "And {{count}} more. Search, or pick a broker, to find one.",
              { count: String(unconnected.length - listed.length) },
            )}
          </p>
        ) : (
          <></>
        )}
      </section>
    );
  };

  // The queues listed under the guidance: every queue, with no traced flow.
  const renderUnconnectedAll: () => ReactElement = (): ReactElement => {
    const queues: Array<MessageQueueTopologyNode> = baseModel.nodes
      .filter((node: MessageQueueTopologyNode): boolean => {
        return node.kind === "queue";
      })
      .sort((a: MessageQueueTopologyNode, b: MessageQueueTopologyNode) => {
        return a.label.localeCompare(b.label);
      });
    if (queues.length === 0) {
      return <></>;
    }
    const listed: Array<MessageQueueTopologyNode> = queues.slice(
      0,
      MAX_UNCONNECTED_LISTED,
    );
    return (
      <section
        className="px-5 py-4"
        data-testid="message-queue-topology-queues-without-flows"
      >
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t("Your queues")}{" "}
          <span className="font-normal normal-case text-gray-400">
            ({queues.length})
          </span>
        </h4>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listed.map((node: MessageQueueTopologyNode): ReactElement => {
            return (
              <button
                key={node.key}
                type="button"
                data-testid="message-queue-topology-queue-item"
                className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onClick={() => {
                  setSelection({ kind: "node", key: node.key });
                }}
              >
                {statusDot(node)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {node.label}
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {node.subtitle}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {queues.length > listed.length ? (
          <p className="mt-3 text-xs text-gray-500">
            {translator.translateTemplate("And {{count}} more.", {
              count: String(queues.length - listed.length),
            })}{" "}
            <AppLink
              to={
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MESSAGE_QUEUES] as Route,
                ) as Route
              }
              className="font-medium text-indigo-600 hover:underline"
            >
              {t("All Queues")}
            </AppLink>
          </p>
        ) : (
          <></>
        )}
      </section>
    );
  };

  const summary: Array<{
    label: string;
    value: string;
    detail: string;
    icon: IconProp;
    warn: boolean;
    testId: string;
  }> = [
    {
      label: t("Queues"),
      value: formatMessageQueueCount(baseModel.activeQueueCount),
      detail: translator.translatePlural(
        {
          one: "with traced messages, of {{count}} live queue",
          other: "with traced messages, of {{count}} live queues",
        },
        baseModel.queueCount,
      ),
      icon: IconProp.QueueList,
      warn: false,
      testId: "message-queue-topology-summary-queues",
    },
    {
      label: t("Services"),
      value: formatMessageQueueCount(baseModel.serviceCount),
      detail: t("Publishing or consuming in this range"),
      icon: IconProp.SquareStack,
      warn: false,
      testId: "message-queue-topology-summary-services",
    },
    {
      label: t("Messages published"),
      value: formatMessageQueueCount(baseModel.published),
      detail: translator.translateTemplate("{{count}} consumed", {
        count: formatMessageQueueCount(baseModel.consumed),
      }),
      icon: IconProp.PaperAirplane,
      warn: false,
      testId: "message-queue-topology-summary-messages",
    },
    {
      label: t("Need attention"),
      value: formatMessageQueueCount(baseModel.attentionCount),
      detail: t("Queues and services with errors"),
      icon: IconProp.Alert,
      warn: baseModel.attentionCount > 0,
      testId: "message-queue-topology-summary-attention",
    },
  ];

  const truncation: MessageQueueTopologyResponse["truncation"] =
    props.data.truncation;

  return (
    <div
      className="min-w-0 w-full max-w-full"
      data-testid="message-queue-topology"
    >
      <div className="mb-5 grid min-w-0 w-full max-w-full grid-cols-2 gap-3 xl:grid-cols-4">
        {summary.map((stat: (typeof summary)[number]): ReactElement => {
          return (
            <div
              key={stat.testId}
              data-testid={stat.testId}
              className="min-w-0 rounded-xl border border-gray-200 bg-white px-5 py-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-gray-500">
                  {stat.label}
                </p>
                <Icon
                  icon={stat.icon}
                  className={`h-4 w-4 ${stat.warn ? "text-amber-500" : "text-indigo-400"}`}
                />
              </div>
              <p
                className={`mt-2 text-3xl font-semibold tracking-tight ${stat.warn ? "text-amber-600" : "text-gray-900"}`}
              >
                {stat.value}
              </p>
              <p className="mt-1 truncate text-xs text-gray-500">
                {stat.detail}
              </p>
            </div>
          );
        })}
      </div>

      <div className="min-w-0 w-full max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900">
              {t("Message flow")}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {t(
                "Which services publish to each queue, which consume from it, and how many messages fail on the way. Select anything for details.",
              )}
            </p>
          </div>
          <div
            className="inline-flex max-w-full self-start rounded-lg bg-gray-100 p-1"
            role="group"
            aria-label={t("Topology view")}
          >
            {(["map", "table"] as Array<TopologyView>).map(
              (option: TopologyView): ReactElement => {
                return (
                  <button
                    key={option}
                    type="button"
                    data-testid={`message-queue-topology-view-${option}`}
                    aria-pressed={view === option}
                    className={`flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${view === option ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                    onClick={() => {
                      changeView(option);
                    }}
                  >
                    <Icon
                      icon={
                        option === "map"
                          ? IconProp.FlowDiagram
                          : IconProp.TableCells
                      }
                      className="h-4 w-4"
                    />
                    {option === "map" ? t("Map") : t("Table")}
                  </button>
                );
              },
            )}
          </div>
        </div>

        {emptyReason ? (
          <>
            {renderGuidance(emptyReason)}
            {emptyReason !== "noQueues" ? renderUnconnectedAll() : <></>}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-3 md:flex-row md:flex-wrap md:items-center">
              <div className="min-w-0 w-full md:w-72">
                <Input
                  isSearchOrFilter={true}
                  dataTestId="message-queue-topology-search"
                  ariaLabel={t("Search queues and services")}
                  placeholder={t("Search queues and services")}
                  value={searchText}
                  onChange={(value: string) => {
                    setSearchText(value);
                  }}
                />
              </div>
              {baseModel.brokerGroups.length > 1 ? (
                <select
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                  aria-label={t("Broker")}
                  data-testid="message-queue-topology-broker"
                  value={brokerGroupKey || ""}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                    setBrokerGroupKey(event.target.value || null);
                  }}
                >
                  <option value="">{t("All brokers")}</option>
                  {baseModel.brokerGroups.map(
                    (group: MessageQueueTopologyBrokerGroup): ReactElement => {
                      return (
                        <option key={group.key} value={group.key}>
                          {translator.translateTemplate(
                            "{{broker}} ({{count}})",
                            {
                              broker: group.label,
                              count: String(group.queueCount),
                            },
                          )}
                        </option>
                      );
                    },
                  )}
                </select>
              ) : (
                <></>
              )}
              <button
                type="button"
                data-testid="message-queue-topology-attention"
                aria-pressed={attentionOnly}
                className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${attentionOnly ? "border-amber-300 bg-amber-50 text-amber-800" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                onClick={() => {
                  setAttentionOnly(!attentionOnly);
                }}
              >
                <span
                  className="h-2 w-2 rounded-full bg-amber-500"
                  aria-hidden={true}
                />
                {t("Needs attention")}
                <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600">
                  {baseModel.attentionCount}
                </span>
              </button>
              {view === "map" &&
              !focusKey &&
              baseModel.brokerGroups.length > 1 ? (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    data-testid="message-queue-topology-group"
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    checked={grouped}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setGrouped(event.target.checked);
                      setSelection(null);
                    }}
                  />
                  {t("Group by broker")}
                </label>
              ) : (
                <></>
              )}
              {isFiltering ? (
                <button
                  type="button"
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  data-testid="message-queue-topology-reset"
                  onClick={resetFilters}
                >
                  {t("Reset filters")}
                </button>
              ) : (
                <></>
              )}
              <p
                className="text-xs text-gray-500 md:ml-auto"
                role="status"
                aria-live="polite"
                data-testid="message-queue-topology-result-count"
              >
                {translator.translateTemplate("{{shown}} of {{total}}", {
                  shown: String(visibility.matchedKeys.size),
                  total: String(model.nodes.length),
                })}
                {visibility.contextKeys.size > 0
                  ? ` · ${translator.translateTemplate(
                      "{{count}} shown for context",
                      { count: String(visibility.contextKeys.size) },
                    )}`
                  : ""}
              </p>
            </div>

            {focusedNode ? (
              <div
                className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-5 py-3 text-sm text-indigo-800"
                data-testid="message-queue-topology-focus"
              >
                <span>
                  {translator.translateTemplate(
                    "Where messages through {{name}} come from and go",
                    {
                      name: getMessageQueueTopologyNodeLabel(
                        focusedNode,
                        translator,
                      ),
                    },
                  )}
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-4">
                  {anchorNode && focusedNode.key !== anchorNode.key ? (
                    <button
                      type="button"
                      data-testid="message-queue-topology-back-to-anchor"
                      className="font-medium hover:underline"
                      onClick={() => {
                        setFocusKey(anchorKey);
                      }}
                    >
                      {translator.translateTemplate("Back to {{name}}", {
                        name: anchorNode.label,
                      })}
                    </button>
                  ) : (
                    <></>
                  )}
                  {anchorKey ? (
                    <AppLink
                      to={
                        new Route(
                          `${RouteUtil.populateRouteParams(
                            RouteMap[PageMap.MESSAGE_QUEUES_TOPOLOGY] as Route,
                          ).toString()}?focus=${encodeURIComponent(focusedNode.key)}`,
                        )
                      }
                      dataTestId="message-queue-topology-open-full"
                      className="font-medium hover:underline"
                    >
                      {t("Open the whole topology")}
                    </AppLink>
                  ) : (
                    <button
                      type="button"
                      data-testid="message-queue-topology-clear-focus"
                      className="font-medium hover:underline"
                      onClick={() => {
                        setFocusKey(null);
                      }}
                    >
                      {t("Show everything")}
                    </button>
                  )}
                </span>
              </div>
            ) : (
              <></>
            )}

            {truncation.queues || truncation.flows ? (
              <div
                role="status"
                data-testid="message-queue-topology-truncation"
                className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800"
              >
                {truncation.queues
                  ? t(
                      "This project has more queues than the map reads at once. It shows the 10,000 oldest live queues.",
                    )
                  : t(
                      "This range has more service and queue pairs than the map reads at once. It shows the busiest 50,000.",
                    )}
              </div>
            ) : (
              <></>
            )}

            {view === "table" &&
            !viewChoice &&
            baseModel.nodes.length >
              MESSAGE_QUEUE_TOPOLOGY_MAX_NODES_FOR_DEFAULT_MAP ? (
              <div className="border-b border-gray-200 bg-gray-50 px-5 py-2 text-xs text-gray-500">
                {t(
                  "This project has too many queues and services to draw at once. Search, pick a broker, or use “Show its flow” on a row to see a readable map of part of it.",
                )}
              </div>
            ) : (
              <></>
            )}

            {visibility.matchedKeys.size === 0 ? (
              <div
                className="px-6 py-16 text-center"
                data-testid="message-queue-topology-no-results"
              >
                <h3 className="text-base font-semibold text-gray-900">
                  {t("Nothing matches your filters")}
                </h3>
                <p className="mt-2 text-sm text-gray-500">
                  {t(
                    "Try a different name, another broker, or clear the filters to see everything.",
                  )}
                </p>
                {isFiltering ? (
                  <button
                    type="button"
                    className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                    onClick={resetFilters}
                  >
                    {t("Clear filters")}
                  </button>
                ) : (
                  <></>
                )}
              </div>
            ) : view === "table" ? (
              renderTable()
            ) : (
              <>
                {layout.positions.size === 0 ? (
                  <div
                    className="border-b border-gray-200 px-6 py-10 text-center text-sm text-gray-500"
                    data-testid="message-queue-topology-nothing-connected"
                  >
                    {t(
                      "Nothing in this view publishes or consumes messages. Clear the filters to see the whole map.",
                    )}
                  </div>
                ) : (
                  <MessageQueueTopologyMap
                    model={model}
                    visibility={visibility}
                    layout={layout}
                    selectedKey={
                      selection?.kind === "node" ? selection.key : null
                    }
                    selectedEdgeId={
                      selection?.kind === "edge" ? selection.edge.id : null
                    }
                    headlines={headlines}
                    edgeLabel={edgeLabel}
                    onEdgeLabelChange={setEdgeLabel}
                    onSelectNode={selectNode}
                    onSelectEdge={selectEdge}
                  />
                )}
                {renderUnconnected()}
              </>
            )}
          </>
        )}
      </div>

      {selection ? (
        <MessageQueueTopologyDetailPanel
          model={baseModel}
          selection={selection}
          headlines={headlines}
          focusKey={visibility.effectiveFocusKey}
          onSelectNode={(key: string): void => {
            setSelection({ kind: "node", key: key });
          }}
          onFocus={focusOn}
          onClose={() => {
            setSelection(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default MessageQueueTopologyExplorer;
