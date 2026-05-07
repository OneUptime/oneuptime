import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardHostListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardHostListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
} from "./DashboardResourceListBase";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Host from "Common/Models/DatabaseModels/Host";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardHostListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Host", widthPct: "32%" },
  { label: "Status", widthPct: "18%" },
  { label: "OS", widthPct: "20%" },
  { label: "CPU / Mem", widthPct: "15%" },
  { label: "Last Seen", widthPct: "15%" },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return "—";
  }
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB"];
  let i: number = 0;
  let value: number = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelative(date: Date | undefined | null): string {
  if (!date) {
    return "—";
  }
  const now: Date = OneUptimeDate.getCurrentDate();
  const diffSeconds: number = Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / 1000),
  );
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes: number = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours: number = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays: number = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const DashboardHostListComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [hosts, setHosts] = useState<Array<Host>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const args: DashboardHostListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const statusFilter: string | undefined = args.statusFilter;
  const osTypeFilter: string | undefined = args.osTypeFilter;

  const fetchHosts: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<Host> = {
        projectId: projectId,
      } as Query<Host>;

      if (statusFilter === "connected") {
        (query as Record<string, unknown>)["otelCollectorStatus"] = "connected";
      } else if (statusFilter === "disconnected") {
        (query as Record<string, unknown>)["otelCollectorStatus"] =
          "disconnected";
      }

      if (osTypeFilter && osTypeFilter.trim() !== "") {
        (query as Record<string, unknown>)["osType"] = osTypeFilter;
      }

      const listResult: ListResult<Host> = await ModelAPI.getList<Host>({
        modelType: Host,
        query: query,
        limit: maxRows,
        skip: 0,
        select: {
          _id: true,
          name: true,
          hostIdentifier: true,
          otelCollectorStatus: true,
          osType: true,
          osVersion: true,
          cpuCores: true,
          totalMemoryBytes: true,
          lastSeenAt: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      setHosts(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [maxRows, statusFilter, osTypeFilter]);

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts, props.refreshTick]);

  const rows: Array<ReactElement> = hosts.map((host: Host) => {
    const id: string = (host._id as string) || "";
    const name: string = (host.name as string) || "Unnamed";
    const status: string =
      (host.otelCollectorStatus as string) || "disconnected";
    const isConnected: boolean = status === "connected";
    const osType: string = (host.osType as string) || "—";
    const osVersion: string = (host.osVersion as string) || "";
    const cpuCores: number | undefined = host.cpuCores as number | undefined;
    const totalMemory: number | undefined = host.totalMemoryBytes as
      | number
      | undefined;
    const lastSeenAt: Date | undefined = host.lastSeenAt as Date | undefined;

    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW] as Route,
      { modelId: new ObjectID(id) },
    );

    const cpuMem: string =
      cpuCores || totalMemory
        ? `${cpuCores ? `${cpuCores}c` : "—"} / ${formatBytes(totalMemory || 0)}`
        : "—";

    return (
      <tr
        key={id}
        className="hover:bg-gray-50/50 transition-colors duration-100 group"
      >
        <td className="px-3 py-2 text-xs text-gray-700 truncate">
          <AppLink
            to={route}
            className="hover:underline text-gray-700 group-hover:text-blue-600"
          >
            {name}
          </AppLink>
        </td>
        <td className="px-3 py-2">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium"
            style={{ fontSize: "10px" }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: isConnected ? "#10b981" : "#9ca3af",
              }}
            ></span>
            <span style={{ color: isConnected ? "#047857" : "#6b7280" }}>
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 truncate">
          {osType}
          {osVersion ? ` ${osVersion}` : ""}
        </td>
        <td className="px-3 py-2 text-xs text-gray-600 tabular-nums truncate">
          {cpuMem}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 tabular-nums truncate">
          {formatRelative(lastSeenAt)}
        </td>
      </tr>
    );
  });

  return (
    <DashboardResourceListBase
      title={args.title}
      pluralLabel="hosts"
      columns={COLUMNS}
      count={hosts.length}
      isLoading={isLoading}
      error={error}
      isEmpty={hosts.length === 0}
      emptyMessage="No hosts found"
      emptyIcon={IconProp.Server}
    >
      {rows}
    </DashboardResourceListBase>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardHostListComponentElement, arePropsEqual);
