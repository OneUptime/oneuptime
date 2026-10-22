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
 * Normal), what it says, who reported it, what it is about, in which
 * namespace, how many times, and when it last happened.
 *
 *   Event                                   Object        Namespace  Count  Last seen
 *   ⚠ OOMKilling  Warning                   Node          default        2  12 minutes ago
 *   Memory cgroup out of memory: Kil...     aks-userpo...
 *   kernel-monitor · aks-userpool-...
 *
 * On a phone the table draws each row as a card of its own, so nothing
 * scrolls sideways. A view about one object leaves its Object column out,
 * a view about one namespace its Namespace column.
 */

export interface ComponentProps {
  id: string;
  rows: Array<KubernetesEventRow>;
  // The cluster, for the links to an Event's object.
  clusterId: ObjectID;
  showObject: boolean;
  showNamespace: boolean;
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

type SortKey = "lastSeenAt" | "count" | "reason" | "objectName" | "namespace";

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
export function getKubernetesEventSource(row: KubernetesEventRow): string {
  return [row.source, row.sourceHost]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" · ");
}

const EventCell: FunctionComponent<{ row: KubernetesEventRow }> = (props: {
  row: KubernetesEventRow;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const row: KubernetesEventRow = props.row;
  const source: string = getKubernetesEventSource(row);

  return (
    <div className="min-w-0" data-testid="kubernetes-event">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon
          icon={row.isWarning ? IconProp.Alert : IconProp.InformationCircle}
          className={`h-4 w-4 flex-shrink-0 ${
            row.isWarning ? "text-amber-500" : "text-gray-400"
          }`}
        />
        <span
          className="font-medium text-gray-900 [overflow-wrap:anywhere]"
          data-testid="kubernetes-event-reason"
        >
          {row.reason || translator.translateText("No reason given")}
        </span>
        <KubernetesEventTypeLabel row={row} />
      </div>
      {row.message ? (
        <p
          className="mt-1 max-w-3xl text-sm text-gray-600 [overflow-wrap:anywhere]"
          data-testid="kubernetes-event-message"
        >
          {row.message}
        </p>
      ) : (
        <></>
      )}
      {source ? (
        <p
          className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]"
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
  );
};

const ObjectCell: FunctionComponent<{
  row: KubernetesEventRow;
  clusterId: ObjectID;
}> = (props: {
  row: KubernetesEventRow;
  clusterId: ObjectID;
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

const LastSeenCell: FunctionComponent<{ row: KubernetesEventRow }> = (props: {
  row: KubernetesEventRow;
}): ReactElement => {
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
        className="whitespace-nowrap text-gray-700"
        data-testid="kubernetes-event-last-seen"
      >
        {formatFeedTimeAgo(lastSeenAt, clock) || lastSeen}
      </time>
    </Tooltip>
  );
};

const KubernetesEventsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);

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
      getElement: (row: KubernetesEventRow): ReactElement => {
        return <EventCell row={row} />;
      },
    },
  ];

  if (props.showObject) {
    columns.push({
      title: "Object",
      type: FieldType.Element,
      key: "objectName",
      wrapContent: true,
      getElement: (row: KubernetesEventRow): ReactElement => {
        return <ObjectCell row={row} clusterId={props.clusterId} />;
      },
    });
  }

  if (props.showNamespace) {
    columns.push({
      title: "Namespace",
      type: FieldType.Element,
      key: "namespace",
      getElement: (row: KubernetesEventRow): ReactElement => {
        return row.namespace ? (
          <span
            className="text-gray-700 [overflow-wrap:anywhere]"
            data-testid="kubernetes-event-namespace"
          >
            {row.namespace}
          </span>
        ) : (
          <span className="text-gray-500">-</span>
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
      getElement: (row: KubernetesEventRow): ReactElement => {
        return <LastSeenCell row={row} />;
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
