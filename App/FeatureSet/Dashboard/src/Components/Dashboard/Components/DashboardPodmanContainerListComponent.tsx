import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardPodmanContainerListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardPodmanContainerListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList from "../Utils/DashboardResourceList";
import PodmanResource from "Common/Models/DatabaseModels/PodmanResource";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";

const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "container.name": "name",
  "container.image.name": "imageName",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardPodmanContainerListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Container", widthPct: "30%" },
  { label: "Image", widthPct: "30%" },
  { label: "CPU %", widthPct: "10%", alignRight: true },
  { label: "Memory", widthPct: "15%", alignRight: true },
  { label: "Host", widthPct: "15%" },
];

const CONTAINER_STATE_COLORS: Record<string, { color: string; label: string }> =
  {
    running: { color: "#10b981", label: "Running" },
    restarting: { color: "#f59e0b", label: "Restarting" },
    paused: { color: "#f59e0b", label: "Paused" },
    exited: { color: "#9ca3af", label: "Exited" },
    dead: { color: "#ef4444", label: "Dead" },
    created: { color: "#3b82f6", label: "Created" },
  };

const CONTAINER_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Running", color: "#10b981" },
  { label: "Restarting/Paused", color: "#f59e0b" },
  { label: "Created", color: "#3b82f6" },
  { label: "Exited", color: "#9ca3af" },
  { label: "Dead", color: "#ef4444" },
];

function getContainerStateInfo(state: string | undefined): {
  color: string;
  label: string;
} {
  const key: string = (state || "").toLowerCase();
  return (
    CONTAINER_STATE_COLORS[key] || {
      color: "#9ca3af",
      label: state || "Unknown",
    }
  );
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value: number = bytes;
  let unitIdx: number = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  const precision: number = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIdx]}`;
}

const DashboardPodmanContainerListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [containers, setContainers] = useState<Array<PodmanResource>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const args: DashboardPodmanContainerListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const podmanHostIds: Array<string> | undefined = args.podmanHostIds;
  const imageName: string | undefined = args.imageName;
  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  const podmanHostIdsKey: string = (podmanHostIds || []).join(",");
  const imageNameKey: string = (imageName || "").trim();

  const fetchContainers: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!DashboardResourceList.isPublic() && !projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const baseQuery: Record<string, unknown> = {
        projectId: projectId,
        kind: "Container",
      };

      if (podmanHostIds && podmanHostIds.length > 0) {
        baseQuery["podmanHostId"] = new Includes(podmanHostIds);
      }

      if (imageNameKey) {
        baseQuery["imageName"] = new Search(imageNameKey);
      }

      const query: Query<PodmanResource> =
        DashboardModelQueryInterpolation.applyToQuery(
          baseQuery,
          props.variables,
          ATTRIBUTE_TO_COLUMN,
        ) as Query<PodmanResource>;

      const listResult: ListResult<PodmanResource> =
        await ModelAPI.getList<PodmanResource>({
          modelType: PodmanResource,
          requestOptions:
            DashboardResourceList.getRequestOptions("podman-container"),
          query: query,
          limit: maxRows,
          skip: 0,
          select: {
            _id: true,
            name: true,
            imageName: true,
            state: true,
            latestCpuPercent: true,
            latestMemoryBytes: true,
            podmanHostId: true,
            podmanHost: {
              name: true,
            },
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setContainers(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [maxRows, podmanHostIdsKey, imageNameKey, props.variables]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers, props.refreshTick]);

  const honeycombTiles: Array<HoneycombTile> = containers.map(
    (container: PodmanResource): HoneycombTile => {
      const id: string = (container._id as string) || "";
      const name: string = (container.name as string) || "Unnamed";
      const image: string = (container.imageName as string) || "—";
      const stateRaw: string | undefined = container.state as
        | string
        | undefined;
      const stateInfo: { color: string; label: string } =
        getContainerStateInfo(stateRaw);
      const hostName: string = (container.podmanHost?.name as string) || "—";
      const hostId: string =
        (container.podmanHostId?.toString() as string) || "";

      let route: Route | undefined = undefined;
      if (hostId && id) {
        route = RouteUtil.populateRouteParams(
          RouteMap[PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL] as Route,
          { modelId: new ObjectID(hostId), subModelId: new ObjectID(id) },
        );
      }

      return {
        id: id || name,
        status: stateInfo.label,
        color: stateInfo.color,
        route: route,
        tooltip: {
          title: name,
          details: [
            { label: "Image", value: image },
            { label: "Host", value: hostName },
          ],
        },
      };
    },
  );

  const rows: Array<ReactElement> = containers.map(
    (container: PodmanResource) => {
      const id: string = (container._id as string) || "";
      const name: string = (container.name as string) || "Unnamed";
      const image: string = (container.imageName as string) || "—";
      const cpu: number | null =
        typeof container.latestCpuPercent === "number"
          ? (container.latestCpuPercent as number)
          : null;
      const mem: number | null =
        typeof container.latestMemoryBytes === "number"
          ? (container.latestMemoryBytes as number)
          : null;
      const hostName: string = (container.podmanHost?.name as string) || "—";
      const hostId: string =
        (container.podmanHostId?.toString() as string) || "";

      let detailLink: ReactElement = <span>{name}</span>;
      if (hostId && id) {
        const route: Route = RouteUtil.populateRouteParams(
          RouteMap[PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL] as Route,
          { modelId: new ObjectID(hostId), subModelId: new ObjectID(id) },
        );
        detailLink = (
          <AppLink
            to={route}
            className="hover:underline text-gray-700 group-hover:text-blue-600"
          >
            {name}
          </AppLink>
        );
      }

      return (
        <tr
          key={id}
          className="hover:bg-gray-50/50 transition-colors duration-100 group"
        >
          <td className="px-3 py-2 text-xs text-gray-700 truncate">
            {detailLink}
          </td>
          <td className="px-3 py-2 text-xs text-gray-500 truncate font-mono">
            {image}
          </td>
          <td className="px-3 py-2 text-xs text-gray-600 tabular-nums text-right">
            {cpu !== null ? `${cpu.toFixed(1)}%` : "—"}
          </td>
          <td className="px-3 py-2 text-xs text-gray-600 tabular-nums text-right">
            {formatBytes(mem)}
          </td>
          <td className="px-3 py-2 text-xs text-gray-500 truncate">
            {hostName}
          </td>
        </tr>
      );
    },
  );

  return (
    <DashboardResourceListBase
      title={args.title}
      pluralLabel="containers"
      columns={COLUMNS}
      count={containers.length}
      isLoading={isLoading}
      error={error}
      isEmpty={containers.length === 0}
      emptyMessage="No containers found"
      emptyIcon={IconProp.Cube}
      viewMode={viewMode}
      honeycombTiles={honeycombTiles}
      honeycombLegend={CONTAINER_LEGEND}
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

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(
  DashboardPodmanContainerListComponentElement,
  arePropsEqual,
);
