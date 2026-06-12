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

interface ProxmoxGuestRow {
  guestId: string;
  guestName: string;
  guestType: string;
  nodeName: string;
  isRunning: boolean;
  status: string;
  cpuPercent: string;
  memoryUsage: string;
  memoryPercent: string;
  uptime: string;
}

const CLUSTER_ATTR: string = "resource.proxmox.cluster.name";
const ID_ATTR: string = "id";
const QEMU_ID_PREFIX: string = "qemu/";
const LXC_ID_PREFIX: string = "lxc/";

const formatBytes: (bytes: number) => string = (bytes: number): string => {
  if (!isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB"];
  let value: number = bytes;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const formatUptime: (seconds: number) => string = (
  seconds: number,
): string => {
  if (!isFinite(seconds) || seconds <= 0) {
    return "—";
  }
  const days: number = Math.floor(seconds / 86400);
  const hours: number = Math.floor((seconds % 86400) / 3600);
  const minutes: number = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const ProxmoxClusterGuests: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [guests, setGuests] = useState<Array<ProxmoxGuestRow>>([]);
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
        "pve_up",
        "pve_cpu_usage_ratio",
        "pve_memory_usage_bytes",
        "pve_memory_size_bytes",
        "pve_uptime_seconds",
        "pve_guest_info",
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
       * For each metric, take the latest value per guest id. pve-exporter
       * keeps guest identity in the `id` datapoint label (`qemu/<vmid>` for
       * VMs, `lxc/<vmid>` for containers).
       */
      const latestByMetric: Map<string, Map<string, Metric>> = new Map();
      metricNames.forEach((name: string, idx: number) => {
        const perGuest: Map<string, Metric> = new Map();
        const listResult: ListResult<Metric> = results[idx]!;
        for (const metric of listResult.data) {
          const attrs: Record<string, unknown> =
            (metric.attributes as Record<string, unknown>) || {};
          const id: string = (attrs[ID_ATTR] as string) || "";
          if (
            !id ||
            (!id.startsWith(QEMU_ID_PREFIX) && !id.startsWith(LXC_ID_PREFIX))
          ) {
            continue;
          }
          if (!perGuest.has(id)) {
            perGuest.set(id, metric);
          }
        }
        latestByMetric.set(name, perGuest);
      });

      // Collect union of guest ids.
      const guestIds: Set<string> = new Set();
      for (const perGuest of latestByMetric.values()) {
        for (const id of perGuest.keys()) {
          guestIds.add(id);
        }
      }

      const rows: Array<ProxmoxGuestRow> = [];
      for (const guestId of guestIds) {
        const upMetric: Metric | undefined = latestByMetric
          .get("pve_up")
          ?.get(guestId);
        const cpuMetric: Metric | undefined = latestByMetric
          .get("pve_cpu_usage_ratio")
          ?.get(guestId);
        const memUsageMetric: Metric | undefined = latestByMetric
          .get("pve_memory_usage_bytes")
          ?.get(guestId);
        const memSizeMetric: Metric | undefined = latestByMetric
          .get("pve_memory_size_bytes")
          ?.get(guestId);
        const uptimeMetric: Metric | undefined = latestByMetric
          .get("pve_uptime_seconds")
          ?.get(guestId);
        const infoMetric: Metric | undefined = latestByMetric
          .get("pve_guest_info")
          ?.get(guestId);

        // Name and node come from pve_guest_info datapoint labels.
        const infoAttrs: Record<string, unknown> =
          (infoMetric?.attributes as Record<string, unknown>) || {};
        const guestName: string = (infoAttrs["name"] as string) || guestId;
        const nodeName: string = (infoAttrs["node"] as string) || "—";

        const isRunning: boolean =
          upMetric !== undefined && Number(upMetric.value) >= 1;

        const memUsage: number | null =
          memUsageMetric && memUsageMetric.value !== undefined
            ? Number(memUsageMetric.value)
            : null;
        const memSize: number | null =
          memSizeMetric && memSizeMetric.value !== undefined
            ? Number(memSizeMetric.value)
            : null;

        rows.push({
          guestId: guestId,
          guestName: guestName,
          guestType: guestId.startsWith(QEMU_ID_PREFIX) ? "VM" : "LXC",
          nodeName: nodeName,
          isRunning: isRunning,
          status: isRunning ? "Running" : "Stopped",
          cpuPercent:
            cpuMetric && cpuMetric.value !== undefined
              ? `${(Number(cpuMetric.value) * 100).toFixed(2)}%`
              : "—",
          memoryUsage:
            memUsage !== null
              ? `${formatBytes(memUsage)}${memSize !== null ? ` / ${formatBytes(memSize)}` : ""}`
              : "—",
          memoryPercent:
            memUsage !== null && memSize !== null && memSize > 0
              ? `${((memUsage / memSize) * 100).toFixed(2)}%`
              : "—",
          uptime:
            uptimeMetric && uptimeMetric.value !== undefined
              ? formatUptime(Number(uptimeMetric.value))
              : "—",
        });
      }

      rows.sort((a: ProxmoxGuestRow, b: ProxmoxGuestRow) => {
        return a.guestName.localeCompare(b.guestName);
      });

      setGuests(rows);
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

  const tableColumns: Array<Column<ProxmoxGuestRow>> = useMemo(() => {
    return [
      {
        title: "Guest",
        type: FieldType.Element,
        key: "guestName",
        getElement: (row: ProxmoxGuestRow): ReactElement => {
          return (
            <div>
              <div className="text-sm font-medium text-gray-900">
                {row.guestName}
              </div>
              <div className="text-xs text-gray-400 font-mono">
                {row.guestId}
              </div>
            </div>
          );
        },
      },
      {
        title: "Type",
        type: FieldType.Element,
        key: "guestType",
        getElement: (row: ProxmoxGuestRow): ReactElement => {
          const isVm: boolean = row.guestType === "VM";
          return (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                isVm
                  ? "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200"
                  : "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200"
              }`}
            >
              {row.guestType}
            </span>
          );
        },
      },
      {
        title: "Node",
        type: FieldType.Text,
        key: "nodeName",
      },
      {
        title: "Status",
        type: FieldType.Element,
        key: "status",
        getElement: (row: ProxmoxGuestRow): ReactElement => {
          return (
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  row.isRunning ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <span
                className={`text-sm font-medium ${
                  row.isRunning ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {row.status}
              </span>
            </div>
          );
        },
      },
      {
        title: "CPU",
        type: FieldType.Text,
        key: "cpuPercent",
      },
      {
        title: "Memory",
        type: FieldType.Text,
        key: "memoryUsage",
      },
      {
        title: "Memory %",
        type: FieldType.Text,
        key: "memoryPercent",
      },
      {
        title: "Uptime",
        type: FieldType.Text,
        key: "uptime",
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
      title="Proxmox Guests"
      description="QEMU VMs and LXC containers in this Proxmox cluster (last 5 minutes)."
      buttons={cardButtons}
    >
      <Table<ProxmoxGuestRow>
        id="proxmox-guests-table"
        columns={tableColumns}
        data={guests}
        singularLabel="Guest"
        pluralLabel="Guests"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={guests.length}
        itemsOnPage={guests.length}
        onNavigateToPage={() => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        noItemsMessage="No guests found in the last 5 minutes. Make sure the Proxmox agent is sending metrics."
      />
    </Card>
  );
};

export default ProxmoxClusterGuests;
