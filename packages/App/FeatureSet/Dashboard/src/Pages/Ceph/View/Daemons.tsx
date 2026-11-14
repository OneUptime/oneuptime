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
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import OneUptimeDate from "Common/Types/Date";
import CephResourceUtils, {
  CephResourceKind,
  getCephShortVersion,
} from "../Utils/CephResourceUtils";
import {
  CEPH_KIND_MDS,
  CEPH_KIND_MGR,
  CEPH_KIND_MON,
  CEPH_KIND_RGW,
  CephAssessment,
  assessCephResource,
  getCephNewestSeenAt,
} from "../Utils/CephHealth";
import { ResourcePartTone } from "../../../Components/ResourcePart/ResourcePartTypes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ClientSort,
  ClientSortColumns,
  compareText,
  resolveClientSort,
  sortClientRows,
} from "../../../Utils/ClientTableSort";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CephMetricDescriptions";

/*
 * Mon / Mgr / Mds / Rgw status table - the honest ControlPlane analog for
 * Ceph (K8s ControlPlane.tsx precedent): a status table, not six metric
 * tabs. Each status is the cluster's rules' (CephHealth): a monitor In
 * quorum, or Out of quorum in red (ceph_mon_quorum_status); a manager,
 * metadata server or gateway reports only its identity (hostname, version),
 * so it is Reporting while Ceph lists it. One the reports since its last
 * have left out reads Stopped reporting, in grey: it was removed, or failed
 * - Ceph raises a check for one that fails, which the Overview lists.
 */

interface CephDaemonRow {
  daemon: string;
  kind: string;
  // Null when the daemon never reported one; the cell shows "—".
  hostname: string | null;
  version: string | null;
  // The status's English words, which the sort and its colour read.
  status: string;
  tone: ResourcePartTone;
  severity: number;
}

type CephDaemonSortKey = "daemon" | "kind" | "status" | "hostname" | "version";

type CephDaemonSort = ClientSort<CephDaemonSortKey>;

const KIND_LABELS: Record<string, string> = {
  Mon: CEPH_KIND_MON,
  Mgr: CEPH_KIND_MGR,
  Mds: CEPH_KIND_MDS,
  Rgw: CEPH_KIND_RGW,
};

const DAEMON_KINDS: Array<CephResourceKind> = ["Mon", "Mgr", "Mds", "Rgw"];

const PAGE_SIZE: number = 25;

/*
 * How bad a daemon's status is: out of quorum (red) above one that stopped
 * reporting or has no word yet (grey) above in quorum or reporting (green).
 * Sorted by its label, "In quorum" would lead and "Out of quorum" would sit
 * between two healthy states.
 */
const statusSeverityOf: (row: CephDaemonRow) => number = (
  row: CephDaemonRow,
): number => {
  return row.severity;
};

const TONE_SEVERITY: Record<ResourcePartTone, number> = {
  positive: 0,
  neutral: 1,
  warning: 2,
  danger: 3,
};

const TONE_CLASS_NAMES: Record<ResourcePartTone, string> = {
  positive: "bg-green-50 text-green-700",
  neutral: "bg-gray-50 text-gray-700",
  warning: "bg-yellow-50 text-yellow-700",
  danger: "bg-red-50 text-red-700",
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
  const translator: Translator = useTranslator();

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

      const now: Date = OneUptimeDate.getCurrentDate();
      const newestSeenAt: Date | null = getCephNewestSeenAt(rows);

      const list: Array<CephDaemonRow> = rows.map(
        (row: CephResourceModel): CephDaemonRow => {
          const kind: string = row.kind || "";
          const assessment: CephAssessment | null = assessCephResource(row, {
            now: now,
            newestSeenAt: newestSeenAt,
          });
          const tone: ResourcePartTone = assessment?.status.tone || "neutral";

          return {
            daemon: row.externalId || "",
            kind: KIND_LABELS[kind] || kind,
            hostname: row.hostname || null,
            // The release, not the build's hash, so versions line up.
            version: row.daemonVersion
              ? getCephShortVersion(row.daemonVersion)
              : null,
            status: assessment?.status.label || "",
            tone: tone,
            severity: TONE_SEVERITY[tone],
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
              {translator.translateText(row.kind) || row.kind}
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
          return (
            <span
              data-tone={row.tone}
              className={`inline-flex whitespace-nowrap px-2 py-0.5 text-xs font-medium rounded ${TONE_CLASS_NAMES[row.tone]}`}
            >
              {translator.translateText(row.status) || row.status}
            </span>
          );
        },
      },
      {
        title: "Host",
        type: FieldType.Text,
        key: "hostname",
      },
      {
        title: "Version",
        type: FieldType.Text,
        key: "version",
      },
    ];
  }, [translator]);

  /*
   * Refresh lives in the ⋯ at the end of the card's header, where every
   * table keeps it (getTableHeaderButtons), not as a loose icon beside
   * the title.
   */
  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
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
      headerLayout="toolbar"
      buttons={getTableHeaderButtons(cardButtons)}
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
