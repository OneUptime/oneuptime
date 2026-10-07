import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import CephResourceUtils, {
  CephResourceKind,
} from "../Utils/CephResourceUtils";
import {
  ClientSort,
  ClientSortColumns,
  compareText,
  resolveClientSort,
  sortClientRows,
} from "../../../Utils/ClientTableSort";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CephMetricDescriptions";

/*
 * Mon / Mgr / Mds / Rgw status table — the honest ControlPlane analog
 * for Ceph (K8s ControlPlane.tsx precedent): a status table, not six
 * metric tabs. Mons get an in-quorum pill (ceph_mon_quorum_status);
 * mgr/mds/rgw daemons only report identity metadata (hostname, version)
 * plus last-seen freshness, so their status is "Reporting" / "Stale".
 */

interface CephDaemonRow {
  daemon: string;
  kind: string;
  // Null when the daemon never reported one; the cell shows "—".
  hostname: string | null;
  version: string | null;
  status: string;
  isHealthy: boolean;
  isWarning: boolean;
}

type CephDaemonSortKey = "daemon" | "kind" | "status" | "hostname" | "version";

type CephDaemonSort = ClientSort<CephDaemonSortKey>;

const KIND_LABELS: Record<string, string> = {
  Mon: "Monitor",
  Mgr: "Manager",
  Mds: "Metadata Server",
  Rgw: "RADOS Gateway",
};

const DAEMON_KINDS: Array<CephResourceKind> = ["Mon", "Mgr", "Mds", "Rgw"];

const PAGE_SIZE: number = 25;

/*
 * How bad a daemon's status is: out of quorum (red) above stale (yellow)
 * above in quorum or reporting (green). Sorted by its label, "In Quorum"
 * would lead and "Out of Quorum" would sit between two healthy states.
 */
const statusSeverityOf: (row: CephDaemonRow) => number = (
  row: CephDaemonRow,
): number => {
  if (row.isHealthy) {
    return 0;
  }
  return row.isWarning ? 1 : 2;
};

/*
 * Every column sorts. Status opens worst first, the rest A to Z - names,
 * hosts and versions with their numbers in counting order, so rgw.2 comes
 * before rgw.10 and 18.2.4 before 18.2.10. A missing host or version sorts
 * last either way.
 */
const SORT_COLUMNS: ClientSortColumns<CephDaemonRow, CephDaemonSortKey> = {
  daemon: { firstSortOrder: SortOrder.Ascending },
  kind: { firstSortOrder: SortOrder.Ascending },
  status: { firstSortOrder: SortOrder.Descending, value: statusSeverityOf },
  hostname: { firstSortOrder: SortOrder.Ascending },
  version: { firstSortOrder: SortOrder.Ascending },
};

// The list opens grouped by kind, each kind's daemons A to Z.
const DEFAULT_SORT: CephDaemonSort = {
  sortBy: "kind",
  sortOrder: SortOrder.Ascending,
};

// Daemons that tie in the sorted column keep the order the list opens on.
const compareByKindThenName: (a: CephDaemonRow, b: CephDaemonRow) => number = (
  a: CephDaemonRow,
  b: CephDaemonRow,
): number => {
  return compareText(a.kind, b.kind) || compareText(a.daemon, b.daemon);
};

const CephClusterDaemons: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [daemons, setDaemons] = useState<Array<CephDaemonRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [sort, setSort] = useState<CephDaemonSort>(DEFAULT_SORT);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const rows: Array<CephResourceModel> =
        await CephResourceUtils.fetchCephResources({
          cephClusterId: modelId,
          kinds: DAEMON_KINDS,
        });

      const list: Array<CephDaemonRow> = rows.map(
        (row: CephResourceModel): CephDaemonRow => {
          const kind: string = row.kind || "";
          const lastSeenMs: number = row.lastSeenAt
            ? Date.now() - new Date(row.lastSeenAt).getTime()
            : Number.POSITIVE_INFINITY;
          const isFresh: boolean =
            lastSeenMs <= CephResourceUtils.METRIC_STALE_MS;

          let status: string;
          let isHealthy: boolean;
          let isWarning: boolean = false;
          if (kind === "Mon") {
            if (!isFresh) {
              status = "Stale";
              isHealthy = false;
              isWarning = true;
            } else if (row.inQuorum) {
              status = "In Quorum";
              isHealthy = true;
            } else {
              status = "Out of Quorum";
              isHealthy = false;
            }
          } else if (isFresh) {
            status = "Reporting";
            isHealthy = true;
          } else {
            status = "Stale";
            isHealthy = false;
            isWarning = true;
          }

          return {
            daemon: row.externalId || "",
            kind: KIND_LABELS[kind] || kind,
            hostname: row.hostname || null,
            version: row.daemonVersion || null,
            status: status,
            isHealthy: isHealthy,
            isWarning: isWarning,
          };
        },
      );

      setDaemons(list);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  // Sorted before the page is cut out, so a sort runs across every page.
  const sortedDaemons: Array<CephDaemonRow> = useMemo(() => {
    return sortClientRows({
      rows: daemons,
      columns: SORT_COLUMNS,
      sort: sort,
      tieBreak: compareByKindThenName,
    });
  }, [daemons, sort]);

  /*
   * A refresh can shrink the list (a daemon that stops reporting is dropped
   * from the inventory), so clamp instead of trusting currentPage — otherwise
   * the user is stranded on a page past the end, staring at an empty table.
   */
  const totalPages: number = Math.max(1, Math.ceil(daemons.length / pageSize));
  const effectivePage: number = Math.min(currentPage, totalPages);

  const paginatedData: Array<CephDaemonRow> = useMemo(() => {
    const start: number = (effectivePage - 1) * pageSize;
    return sortedDaemons.slice(start, start + pageSize);
  }, [sortedDaemons, effectivePage, pageSize]);

  const tableColumns: Array<Column<CephDaemonRow>> = useMemo(() => {
    return [
      {
        title: "Daemon",
        type: FieldType.Element,
        key: "daemon",
        getElement: (row: CephDaemonRow): ReactElement => {
          return (
            <span className="font-medium text-gray-900">{row.daemon}</span>
          );
        },
      },
      {
        title: "Kind",
        type: FieldType.Element,
        key: "kind",
        getElement: (row: CephDaemonRow): ReactElement => {
          return (
            <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
              {row.kind}
            </span>
          );
        },
      },
      {
        title: "Status",
        type: FieldType.Element,
        key: "status",
        headerTooltip: CEPH_METRIC_DESCRIPTIONS.daemonStatus,
        getElement: (row: CephDaemonRow): ReactElement => {
          const badgeClass: string = row.isHealthy
            ? "bg-green-50 text-green-700"
            : row.isWarning
              ? "bg-yellow-50 text-yellow-700"
              : "bg-red-50 text-red-700";
          return (
            <span
              className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${badgeClass}`}
            >
              {row.status}
            </span>
          );
        },
      },
      {
        title: "Host",
        type: FieldType.Text,
        key: "hostname",
        noValueMessage: "—",
      },
      {
        title: "Version",
        type: FieldType.Text,
        key: "version",
        noValueMessage: "—",
      },
    ];
  }, []);

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        fetchData().catch(() => {});
      },
      icon: IconProp.Refresh,
    },
  ];

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Card
      title="Daemons"
      description="Monitor, manager, metadata-server, and RADOS-gateway daemons in this cluster with quorum and reporting status."
      buttons={cardButtons}
    >
      <Table<CephDaemonRow>
        id="ceph-daemons-table"
        columns={tableColumns}
        data={paginatedData}
        singularLabel="Daemon"
        pluralLabel="Daemons"
        isLoading={false}
        error=""
        currentPageNumber={effectivePage}
        totalItemsCount={daemons.length}
        itemsOnPage={pageSize}
        onNavigateToPage={(page: number, itemsOnPage: number) => {
          setCurrentPage(page);
          if (itemsOnPage > 0) {
            setPageSize(itemsOnPage);
          }
        }}
        sortOrder={sort.sortOrder}
        sortBy={sort.sortBy}
        onSortChanged={(
          newSortBy: keyof CephDaemonRow | null,
          newSortOrder: SortOrder,
        ) => {
          setSort((current: CephDaemonSort): CephDaemonSort => {
            return resolveClientSort({
              columns: SORT_COLUMNS,
              current: current,
              requestedSortBy: newSortBy,
              requestedSortOrder: newSortOrder,
            });
          });
          setCurrentPage(1);
        }}
        noItemsMessage="No daemons found in the inventory yet. Daemons appear here a few minutes after the Ceph agent starts sending metrics."
      />
    </Card>
  );
};

export default CephClusterDaemons;
