import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardDockerHostListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardDockerHostListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
} from "./DashboardResourceListBase";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
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

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDockerHostListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Host", widthPct: "40%" },
  { label: "Status", widthPct: "20%" },
  { label: "Containers", widthPct: "20%" },
  { label: "OS", widthPct: "20%" },
];

const DashboardDockerHostListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [hosts, setHosts] = useState<Array<DockerHost>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const args: DashboardDockerHostListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const statusFilter: string | undefined = args.statusFilter;

  const fetchHosts: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<DockerHost> = {
        projectId: projectId,
      } as Query<DockerHost>;

      if (statusFilter === "connected") {
        (query as Record<string, unknown>)["otelCollectorStatus"] = "connected";
      } else if (statusFilter === "disconnected") {
        (query as Record<string, unknown>)["otelCollectorStatus"] =
          "disconnected";
      }

      const listResult: ListResult<DockerHost> =
        await ModelAPI.getList<DockerHost>({
          modelType: DockerHost,
          query: query,
          limit: maxRows,
          skip: 0,
          select: {
            _id: true,
            name: true,
            otelCollectorStatus: true,
            containersRunning: true,
            containersStopped: true,
            containersPaused: true,
            osType: true,
            osVersion: true,
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
  }, [maxRows, statusFilter]);

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts, props.refreshTick]);

  const rows: Array<ReactElement> = hosts.map((host: DockerHost) => {
    const id: string = (host._id as string) || "";
    const name: string = (host.name as string) || "Unnamed";
    const status: string =
      (host.otelCollectorStatus as string) || "disconnected";
    const isConnected: boolean = status === "connected";
    const running: number = (host.containersRunning as number) || 0;
    const stopped: number = (host.containersStopped as number) || 0;
    const paused: number = (host.containersPaused as number) || 0;
    const osType: string = (host.osType as string) || "—";
    const osVersion: string = (host.osVersion as string) || "";

    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.DOCKER_HOST_VIEW] as Route,
      { modelId: new ObjectID(id) },
    );

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
        <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">
          <span className="text-emerald-600 font-medium">{running}</span>
          <span className="text-gray-300 mx-1">/</span>
          <span>{stopped}</span>
          {paused > 0 ? (
            <>
              <span className="text-gray-300 mx-1">/</span>
              <span className="text-amber-600">{paused}</span>
            </>
          ) : null}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 truncate">
          {osType}
          {osVersion ? ` ${osVersion}` : ""}
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
      emptyMessage="No Docker hosts found"
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

export default React.memo(
  DashboardDockerHostListComponentElement,
  arePropsEqual,
);
