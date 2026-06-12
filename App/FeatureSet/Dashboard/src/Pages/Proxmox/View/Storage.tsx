import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

interface ProxmoxStorageRow {
  storageId: string;
  storageName: string;
  nodeName: string;
  diskUsage: string;
  diskSize: string;
  usedPercentValue: number | null;
  usedPercent: string;
}

const CLUSTER_ATTR: string = "resource.proxmox.cluster.name";
const ID_ATTR: string = "id";
const STORAGE_ID_PREFIX: string = "storage/";

const formatBytes: (bytes: number) => string = (bytes: number): string => {
  if (!isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value: number = bytes;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const ProxmoxClusterStorage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [storageVolumes, setStorageVolumes] = useState<
    Array<ProxmoxStorageRow>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const cluster: ProxmoxCluster | null = await ModelAPI.getItem({
        modelType: ProxmoxCluster,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!cluster?.name) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -5);

      const metricNames: Array<string> = [
        "pve_disk_usage_bytes",
        "pve_disk_size_bytes",
      ];

      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buildQuery: (metricName: string) => any = (metricName: string) => {
        return {
          modelType: Metric,
          query: {
            projectId: projectId,
            name: metricName,
            time: new InBetween<Date>(startDate, endDate),
            attributes: {
              [CLUSTER_ATTR]: cluster.name,
            },
          },
          limit: 500,
          skip: 0,
          select: {
            time: true,
            value: true,
            attributes: true,
          },
          sort: {
            time: SortOrder.Descending,
          },
          requestOptions: {},
        };
      };

      const results: Array<ListResult<Metric>> = await Promise.all(
        metricNames.map((n: string) => {
          return AnalyticsModelAPI.getList<Metric>(buildQuery(n));
        }),
      );

      /*
       * For each metric, take the latest value per storage id. pve-exporter
       * keeps storage identity in the `id` datapoint label
       * (`storage/<node>/<storage>`).
       */
      const latestByMetric: Map<string, Map<string, Metric>> = new Map();
      metricNames.forEach((name: string, idx: number) => {
        const perStorage: Map<string, Metric> = new Map();
        const listResult: ListResult<Metric> = results[idx]!;
        for (const metric of listResult.data) {
          const attrs: Record<string, unknown> =
            (metric.attributes as Record<string, unknown>) || {};
          const id: string = (attrs[ID_ATTR] as string) || "";
          if (!id || !id.startsWith(STORAGE_ID_PREFIX)) {
            continue;
          }
          if (!perStorage.has(id)) {
            perStorage.set(id, metric);
          }
        }
        latestByMetric.set(name, perStorage);
      });

      // Collect union of storage ids.
      const storageIds: Set<string> = new Set();
      for (const perStorage of latestByMetric.values()) {
        for (const id of perStorage.keys()) {
          storageIds.add(id);
        }
      }

      const rows: Array<ProxmoxStorageRow> = [];
      for (const storageId of storageIds) {
        const usageMetric: Metric | undefined = latestByMetric
          .get("pve_disk_usage_bytes")
          ?.get(storageId);
        const sizeMetric: Metric | undefined = latestByMetric
          .get("pve_disk_size_bytes")
          ?.get(storageId);

        const usage: number | null =
          usageMetric && usageMetric.value !== undefined
            ? Number(usageMetric.value)
            : null;
        const size: number | null =
          sizeMetric && sizeMetric.value !== undefined
            ? Number(sizeMetric.value)
            : null;

        const usedPercentValue: number | null =
          usage !== null && size !== null && size > 0
            ? (usage / size) * 100
            : null;

        // id format: storage/<node>/<storage>.
        const idParts: Array<string> = storageId
          .substring(STORAGE_ID_PREFIX.length)
          .split("/");
        const nodeName: string = idParts.length > 1 ? idParts[0]! : "—";
        const storageName: string =
          idParts.length > 1
            ? idParts.slice(1).join("/")
            : idParts[0] || storageId;

        rows.push({
          storageId: storageId,
          storageName: storageName,
          nodeName: nodeName,
          diskUsage: usage !== null ? formatBytes(usage) : "—",
          diskSize: size !== null ? formatBytes(size) : "—",
          usedPercentValue: usedPercentValue,
          usedPercent:
            usedPercentValue !== null
              ? `${usedPercentValue.toFixed(2)}%`
              : "—",
        });
      }

      rows.sort((a: ProxmoxStorageRow, b: ProxmoxStorageRow) => {
        return a.storageId.localeCompare(b.storageId);
      });

      setStorageVolumes(rows);
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

  const tableColumns: Array<Column<ProxmoxStorageRow>> = useMemo(() => {
    return [
      {
        title: "Storage",
        type: FieldType.Element,
        key: "storageName",
        getElement: (row: ProxmoxStorageRow): ReactElement => {
          return (
            <div>
              <div className="text-sm font-medium text-gray-900">
                {row.storageName}
              </div>
              <div className="text-xs text-gray-400 font-mono">
                {row.storageId}
              </div>
            </div>
          );
        },
      },
      {
        title: "Node",
        type: FieldType.Text,
        key: "nodeName",
      },
      {
        title: "Used",
        type: FieldType.Text,
        key: "diskUsage",
      },
      {
        title: "Capacity",
        type: FieldType.Text,
        key: "diskSize",
      },
      {
        title: "Used %",
        type: FieldType.Element,
        key: "usedPercent",
        getElement: (row: ProxmoxStorageRow): ReactElement => {
          if (row.usedPercentValue === null) {
            return <span className="text-sm text-gray-500">—</span>;
          }
          const pct: number = Math.min(
            100,
            Math.max(0, row.usedPercentValue),
          );
          const barColor: string =
            pct >= 90
              ? "bg-red-500"
              : pct >= 70
                ? "bg-amber-500"
                : "bg-emerald-500";
          return (
            <div className="flex items-center gap-2">
              <div className="w-20 bg-gray-100 rounded-full h-1.5">
                <div
                  className={`${barColor} h-1.5 rounded-full`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-sm text-gray-700">{row.usedPercent}</span>
            </div>
          );
        },
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
      title="Proxmox Storage"
      description="Storage volumes in this Proxmox cluster (last 5 minutes)."
      buttons={cardButtons}
    >
      <Table<ProxmoxStorageRow>
        id="proxmox-storage-table"
        columns={tableColumns}
        data={storageVolumes}
        singularLabel="Storage Volume"
        pluralLabel="Storage Volumes"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={storageVolumes.length}
        itemsOnPage={storageVolumes.length}
        onNavigateToPage={() => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        noItemsMessage="No storage volumes found in the last 5 minutes. Make sure the Proxmox agent is sending metrics."
      />
    </Card>
  );
};

export default ProxmoxClusterStorage;
