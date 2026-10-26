import { KubernetesEventRow } from "./KubernetesEventsModel";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Table from "Common/UI/Components/Table/Table";
import {
  useAreTableColumnsFolded,
  useIsTableCard,
} from "Common/UI/Components/Table/TableCellContext";
import { TableEmptyStateProps } from "Common/UI/Components/Table/TableEmptyState";
import Column from "Common/UI/Components/Table/Types/Column";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * THE EVENTS OF A KUBERNETES VIEW, AS A TABLE - the cluster's Events page
 * and the Events tab of a node, a workload, an autoscaler or a namespace.
 *
 * One row per Event, with what the issue that asked for it (#5179) listed
 * a person needs to act on one: what happened (its reason, and Warning or
 * Normal), what it says, who reported it, what it is about and in which
 * namespace, how many times, and when it last happened.
 *
 *   Event                                       Object                  Count  Last seen
 *   ⚠ OOMKilling                                Node                        2  12 minutes ago
 *   Memory cgroup out of memory: Killed         aks-userpool-... default
 *   process 318623 (MainThread) total-vm:...
 *   Reported by kernel-monitor · aks-userpo...
 *
 * The message is what a reader came for, so the Event column takes the
 * room: the namespace sits beside the object's name, as the Overview draws
 * it, rather than in a column of its own that left the message a narrow
 * strip at a laptop's width and pushed the table past its card at 1024px.
 * A view of one type (the Warnings) does not say "Warning" on every row -
 * its button says it, and the icon tells the two apart; All, which mixes
 * them, does.
 *
 * On a phone the table draws each row as a card of its own, and the card
 * reads as the Overview's Recent Warnings do: the reason and when, the
 * message, the object, its namespace and how many times, then who reported
 * it - not five labelled fields an event each. A view about one object
 * leaves its Object column out, a view about one namespace the namespace.
 */

export interface ComponentProps {
  id: string;
  rows: Array<KubernetesEventRow>;
  // The cluster, for the links to an Event's object.
  clusterId: ObjectID;
  showObject: boolean;
  // The namespace beside each object's name: off where the view is one namespace's.
  showNamespace: boolean;
  /*
   * Whether each row says Warning or Normal in words: where the view mixes
   * the two (All). A view of one type leaves it to its picked button and
   * the row's icon, and keeps the word for screen readers.
   */
  showType?: boolean | undefined;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  /*
   * What the rows are of - the type, the filters, the range. A new one
   * starts the table on its first page; a refresh of the same view keeps
   * the reader's page, held to the rows there are.
   */
  pageResetKey?: string | undefined;
  // What the table says when there are no rows.
  emptyStateProps?: TableEmptyStateProps | undefined;
  noItemsMessage?: string | undefined;
}

const PAGE_SIZE: number = 25;

/*
 * The Event column's room: at least a short message's line - and a reason
 * is never broken mid-word (FailedComputeMetricsReplicas), so the longest
 * one sets the column's floor - and up to a comfortable line of message.
 * The Object column keeps to a name's width, a kind's word above it: from
 * xl up, wide enough for a pod's name. Measured with the issue's Events at
 * 1024 and 1280px beside the side menu, where all four columns fit the
 * card.
 */
const EVENT_COLUMN_MIN_WIDTH_CLASS_NAME: string = "min-w-[12rem]";
const EVENT_COLUMN_MAX_WIDTH_CLASS_NAME: string = "max-w-3xl";
const OBJECT_COLUMN_MIN_WIDTH_CLASS_NAME: string =
  "min-w-[9rem] xl:min-w-[14rem]";
const OBJECT_COLUMN_MAX_WIDTH_CLASS_NAME: string = "max-w-[16rem]";

// The Kinds OneUptime has a page for, and the page.
const OBJECT_PAGES: Record<string, PageMap> = {
  Pod: PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
  Node: PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
  Namespace: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
  Deployment: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
  StatefulSet: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
  DaemonSet: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
  Job: PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL,
  CronJob: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL,
  PersistentVolumeClaim: PageMap.KUBERNETES_CLUSTER_VIEW_PVC_DETAIL,
  PersistentVolume: PageMap.KUBERNETES_CLUSTER_VIEW_PV_DETAIL,
  HorizontalPodAutoscaler: PageMap.KUBERNETES_CLUSTER_VIEW_HPA_DETAIL,
  VerticalPodAutoscaler: PageMap.KUBERNETES_CLUSTER_VIEW_VPA_DETAIL,
};

/*
 * The page of an Event's object, or null for a Kind OneUptime has no page
 * for (a Service, an Ingress, ...). A ReplicaSet opens its Deployment: a
 * ReplicaSet is `<deployment>-<hash>`.
 */
export function getKubernetesObjectRoute(data: {
  clusterId: ObjectID;
  kind: string;
  name: string;
}): Route | null {
  let kind: string = data.kind;
  let name: string = data.name;

  if (kind === "ReplicaSet") {
    const lastDash: number = name.lastIndexOf("-");

    if (lastDash <= 0) {
      return null;
    }

    kind = "Deployment";
    name = name.slice(0, lastDash);
  }

  const page: PageMap | undefined = OBJECT_PAGES[kind];

  if (!page || !name) {
    return null;
  }

  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: data.clusterId,
    subModelId: new ObjectID(name),
  });
}

type SortKey = "lastSeenAt" | "count" | "reason" | "objectName";

function compareRows(
  a: KubernetesEventRow,
  b: KubernetesEventRow,
  key: SortKey,
): number {
  if (key === "lastSeenAt") {
    return (a.lastSeenAt?.getTime() || 0) - (b.lastSeenAt?.getTime() || 0);
  }

  if (key === "count") {
    return a.count - b.count;
  }

  return (a[key] || "").localeCompare(b[key] || "");
}

export const KubernetesEventTypeLabel: FunctionComponent<{
  row: KubernetesEventRow;
}> = (props: { row: KubernetesEventRow }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        props.row.isWarning
          ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"
          : "bg-gray-100 text-gray-600"
      }`}
      data-testid="kubernetes-event-type"
    >
      {translator.translateText(props.row.isWarning ? "Warning" : "Normal")}
    </span>
  );
};

// Who reported an Event, and where: "kernel-monitor · aks-userpool-...".
export function getKubernetesEventSource(data: {
  source: string;
  sourceHost: string;
}): string {
  return [data.source, data.sourceHost]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" · ");
}

/*
 * The namespace an Event is in, as the Overview's lists draw a namespace:
 * a small indigo chip beside the object's name. A namespace is Kubernetes'
 * word, never translated.
 */
export const KubernetesNamespaceChip: FunctionComponent<{
  namespace: string;
  dataTestId: string;
}> = (props: { namespace: string; dataTestId: string }): ReactElement => {
  return (
    <span
      className="inline-flex max-w-full rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600 [overflow-wrap:anywhere]"
      data-testid={props.dataTestId}
    >
      {props.namespace}
    </span>
  );
};

/*
 * What an Event is about: its Kind and its name, linked to its page in
 * OneUptime - the Overview's Recent Warnings and a phone's card of an
 * Event. A long name runs onto the next line rather than ending in "...":
 * a phone has no pointer to show it in full.
 */
export const KubernetesObjectChip: FunctionComponent<{
  kind: string;
  name: string;
  clusterId: ObjectID;
  dataTestId: string;
}> = (props: {
  kind: string;
  name: string;
  clusterId: ObjectID;
  dataTestId: string;
}): ReactElement => {
  const route: Route | null = getKubernetesObjectRoute({
    clusterId: props.clusterId,
    kind: props.kind,
    name: props.name,
  });

  return (
    <span
      className="inline-flex min-w-0 max-w-full items-baseline gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600"
      data-testid={props.dataTestId}
    >
      <span className="flex-shrink-0 text-gray-500">{props.kind}</span>
      {route ? (
        <Link
          to={route}
          className="min-w-0 text-indigo-600 hover:text-indigo-800 hover:underline [overflow-wrap:anywhere]"
        >
          {props.name}
        </Link>
      ) : (
        <span className="min-w-0 [overflow-wrap:anywhere]">{props.name}</span>
      )}
    </span>
  );
};

/*
 * When an Event last happened, "12 minutes ago", and in full under the
 * pointer - with when it first did, for one that repeated.
 */
const LastSeenTime: FunctionComponent<{
  row: KubernetesEventRow;
  className: string;
}> = (props: { row: KubernetesEventRow; className: string }): ReactElement => {
  const translator: Translator = useTranslator();
  const clock: FeedClock = getFeedClock({ language: translator.language });
  const lastSeenAt: Date | null = props.row.lastSeenAt;
  const firstSeenAt: Date | null = props.row.firstSeenAt;

  if (!lastSeenAt) {
    return <span className="text-gray-500">-</span>;
  }

  const lastSeen: string = formatFeedFullTime(lastSeenAt, clock);
  const tooltip: string =
    firstSeenAt && firstSeenAt.getTime() !== lastSeenAt.getTime()
      ? translator.translateTemplate(
          "First seen {{firstSeen}}, last seen {{lastSeen}}",
          {
            firstSeen: formatFeedFullTime(firstSeenAt, clock),
            lastSeen: lastSeen,
          },
        )
      : lastSeen;

  return (
    <Tooltip text={tooltip}>
      <time
        dateTime={lastSeenAt.toISOString()}
        className={props.className}
        data-testid="kubernetes-event-last-seen"
      >
        {formatFeedTimeAgo(lastSeenAt, clock) || lastSeen}
      </time>
    </Tooltip>
  );
};

const EventCell: FunctionComponent<{
  row: KubernetesEventRow;
  clusterId: ObjectID;
  showType: boolean;
  showObject: boolean;
  showNamespace: boolean;
}> = (props: {
  row: KubernetesEventRow;
  clusterId: ObjectID;
  showType: boolean;
  showObject: boolean;
  showNamespace: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  // A phone's card: the columns the table leaves out there are drawn here.
  const isCard: boolean = useIsTableCard();
  const row: KubernetesEventRow = props.row;
  const source: string = getKubernetesEventSource(row);
  const typeText: string =
    translator.translateText(row.isWarning ? "Warning" : "Normal") || "";
  const hasObjectChip: boolean =
    isCard && props.showObject && Boolean(row.objectName);
  const hasNamespaceChip: boolean =
    isCard && props.showNamespace && Boolean(row.namespace);
  /*
   * Below lg the Count and Last seen columns are left out
   * (hideBelowLargeScreen): how many times and when go in the Event's own
   * lines, on a tablet's row as on a phone's card.
   */
  const areColumnsFolded: boolean = useAreTableColumnsFolded();
  const isCountAndTimeFolded: boolean = isCard || areColumnsFolded;
  const hasCount: boolean = isCountAndTimeFolded && row.count > 1;

  /*
   * The icon hangs to the left of the Event's lines, as on the Overview's
   * Recent Warnings: the reason, its message and who reported it read as
   * one block, and a long reason never parts from its icon.
   */
  return (
    <div
      className="flex min-w-0 items-start gap-2"
      data-testid="kubernetes-event"
    >
      <div className="mt-1 flex-shrink-0">
        <Icon
          icon={row.isWarning ? IconProp.Alert : IconProp.InformationCircle}
          className={`h-4 w-4 ${
            row.isWarning ? "text-amber-500" : "text-gray-400"
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="break-words font-medium text-gray-900"
            data-testid="kubernetes-event-reason"
          >
            {row.reason || translator.translateText("No reason given")}
          </span>
          {props.showType ? (
            <KubernetesEventTypeLabel row={row} />
          ) : (
            <span className="sr-only" data-testid="kubernetes-event-type">
              {typeText}
            </span>
          )}
          {isCountAndTimeFolded ? (
            <LastSeenTime
              row={row}
              className="ml-auto flex-shrink-0 whitespace-nowrap text-xs font-normal text-gray-500"
            />
          ) : (
            <></>
          )}
        </div>
        {row.message ? (
          <p
            className="mt-1 text-sm font-normal text-gray-600 [overflow-wrap:anywhere]"
            data-testid="kubernetes-event-message"
          >
            {row.message}
          </p>
        ) : (
          <></>
        )}
        {hasObjectChip || hasNamespaceChip || hasCount ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-normal">
            {hasObjectChip ? (
              <KubernetesObjectChip
                kind={row.objectKind}
                name={row.objectName}
                clusterId={props.clusterId}
                dataTestId="kubernetes-event-object"
              />
            ) : (
              <></>
            )}
            {hasNamespaceChip ? (
              <KubernetesNamespaceChip
                namespace={row.namespace}
                dataTestId="kubernetes-event-namespace"
              />
            ) : (
              <></>
            )}
            {hasCount ? (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-semibold ${
                  row.isWarning
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-600"
                }`}
                data-testid="kubernetes-event-count"
              >
                {translator.translateTemplate("{{count}} times", {
                  count: translator.formatNumber(row.count),
                })}
              </span>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
        {source ? (
          <p
            className="mt-1 text-xs font-normal text-gray-500 [overflow-wrap:anywhere]"
            data-testid="kubernetes-event-source"
          >
            {translator.translateTemplate("Reported by {{source}}", {
              source: source,
            })}
          </p>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

const ObjectCell: FunctionComponent<{
  row: KubernetesEventRow;
  clusterId: ObjectID;
  showNamespace: boolean;
}> = (props: {
  row: KubernetesEventRow;
  clusterId: ObjectID;
  showNamespace: boolean;
}): ReactElement => {
  const row: KubernetesEventRow = props.row;
  const route: Route | null = getKubernetesObjectRoute({
    clusterId: props.clusterId,
    kind: row.objectKind,
    name: row.objectName,
  });

  return (
    <div className="min-w-0" data-testid="kubernetes-event-object">
      <div className="text-xs text-gray-500">{row.objectKind}</div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {route ? (
          <Link
            to={route}
            className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline [overflow-wrap:anywhere]"
          >
            {row.objectName}
          </Link>
        ) : (
          <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">
            {row.objectName}
          </span>
        )}
        {props.showNamespace && row.namespace ? (
          <KubernetesNamespaceChip
            namespace={row.namespace}
            dataTestId="kubernetes-event-namespace"
          />
        ) : (
          <></>
        )}
      </div>
      {row.objectFieldPath ? (
        <div className="text-xs text-gray-500 [overflow-wrap:anywhere]">
          {row.objectFieldPath}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const KubernetesEventsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);
  const showType: boolean = props.showType !== false;

  // Another view starts from the first page.
  useEffect(() => {
    setCurrentPage(1);
  }, [props.pageResetKey]);

  const sortedRows: Array<KubernetesEventRow> = useMemo(() => {
    if (!sortBy) {
      // As they came: newest first.
      return props.rows;
    }

    const sorted: Array<KubernetesEventRow> = [...props.rows].sort(
      (a: KubernetesEventRow, b: KubernetesEventRow): number => {
        return compareRows(a, b, sortBy);
      },
    );

    return sortOrder === SortOrder.Descending ? sorted.reverse() : sorted;
  }, [props.rows, sortBy, sortOrder]);

  /*
   * A refresh can shrink the rows, so the page is held to the rows there
   * are rather than trusted: a reader left past the end sees an empty table.
   */
  const totalPages: number = Math.max(
    1,
    Math.ceil(sortedRows.length / pageSize),
  );
  const effectivePage: number = Math.min(currentPage, totalPages);
  const pageRows: Array<KubernetesEventRow> = sortedRows.slice(
    (effectivePage - 1) * pageSize,
    effectivePage * pageSize,
  );

  const columns: Array<Column<KubernetesEventRow>> = [
    {
      title: "Event",
      type: FieldType.Element,
      key: "reason",
      wrapContent: true,
      wrapMaxWidthClassName: EVENT_COLUMN_MAX_WIDTH_CLASS_NAME,
      contentClassName: EVENT_COLUMN_MIN_WIDTH_CLASS_NAME,
      // A phone's card is the Event: "Event" over every one says nothing.
      hideTitleOnMobile: true,
      getElement: (row: KubernetesEventRow): ReactElement => {
        return (
          <EventCell
            row={row}
            clusterId={props.clusterId}
            showType={showType}
            showObject={props.showObject}
            showNamespace={props.showNamespace}
          />
        );
      },
    },
  ];

  if (props.showObject) {
    columns.push({
      title: "Object",
      type: FieldType.Element,
      key: "objectName",
      wrapContent: true,
      wrapMaxWidthClassName: OBJECT_COLUMN_MAX_WIDTH_CLASS_NAME,
      contentClassName: OBJECT_COLUMN_MIN_WIDTH_CLASS_NAME,
      // A phone's card names the object in the Event's own lines.
      hideOnMobile: true,
      getElement: (row: KubernetesEventRow): ReactElement => {
        return (
          <ObjectCell
            row={row}
            clusterId={props.clusterId}
            showNamespace={props.showNamespace}
          />
        );
      },
    });
  }

  columns.push(
    {
      title: "Count",
      type: FieldType.Element,
      key: "count",
      headerTooltip: translationKey(
        "How many times Kubernetes saw it happen. A repeat updates the event's count rather than adding a new event.",
      ),
      hideOnMobile: true,
      /*
       * In the Event's lines below lg (EventCell), and Last seen with it:
       * beside the cluster's side menu at 768px the card is 478px wide, and
       * the four columns needed 680px.
       */
      hideBelowLargeScreen: true,
      getElement: (row: KubernetesEventRow): ReactElement => {
        return (
          <span
            className="tabular-nums text-gray-700"
            data-testid="kubernetes-event-count"
          >
            {row.count}
          </span>
        );
      },
    },
    {
      title: "Last seen",
      type: FieldType.Element,
      key: "lastSeenAt",
      hideOnMobile: true,
      hideBelowLargeScreen: true,
      getElement: (row: KubernetesEventRow): ReactElement => {
        return (
          <LastSeenTime row={row} className="whitespace-nowrap text-gray-700" />
        );
      },
    },
  );

  return (
    <Table<KubernetesEventRow>
      id={props.id}
      columns={columns}
      data={pageRows}
      singularLabel="Event"
      pluralLabel="Events"
      isLoading={Boolean(props.isLoading)}
      error={props.error || ""}
      currentPageNumber={effectivePage}
      totalItemsCount={sortedRows.length}
      itemsOnPage={pageSize}
      onNavigateToPage={(page: number, itemsOnPage: number) => {
        setCurrentPage(page);
        if (itemsOnPage > 0) {
          setPageSize(itemsOnPage);
        }
      }}
      sortBy={sortBy as keyof KubernetesEventRow | null}
      sortOrder={sortOrder}
      onSortChanged={(
        newSortBy: keyof KubernetesEventRow | null,
        newSortOrder: SortOrder,
      ) => {
        setSortBy(newSortBy as SortKey | null);
        setSortOrder(newSortOrder);
      }}
      emptyStateProps={props.emptyStateProps}
      noItemsMessage={props.noItemsMessage}
    />
  );
};

export default KubernetesEventsTable;
