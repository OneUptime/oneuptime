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
  hostname: string;
  version: string;
  status: string;
  isHealthy: boolean;
  isWarning: boolean;
}

const KIND_LABELS: Record<string, string> = {
  Mon: "Monitor",
  Mgr: "Manager",
  Mds: "Metadata Server",
  Rgw: "RADOS Gateway",
};

const DAEMON_KINDS: Array<CephResourceKind> = ["Mon", "Mgr", "Mds", "Rgw"];

const CephClusterDaemons: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [daemons, setDaemons] = useState<Array<CephDaemonRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

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
            hostname: row.hostname || "—",
            version: row.daemonVersion || "—",
            status: status,
            isHealthy: isHealthy,
            isWarning: isWarning,
          };
        },
      );

      list.sort((a: CephDaemonRow, b: CephDaemonRow) => {
        if (a.kind !== b.kind) {
          return a.kind.localeCompare(b.kind);
        }
        return CephResourceUtils.compareDaemonNames(a.daemon, b.daemon);
      });

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
      },
      {
        title: "Version",
        type: FieldType.Text,
        key: "version",
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
        data={daemons}
        singularLabel="Daemon"
        pluralLabel="Daemons"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={daemons.length}
        itemsOnPage={daemons.length}
        onNavigateToPage={() => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        noItemsMessage="No daemons found in the inventory yet. Daemons appear here a few minutes after the Ceph agent starts sending metrics."
      />
    </Card>
  );
};

export default CephClusterDaemons;
