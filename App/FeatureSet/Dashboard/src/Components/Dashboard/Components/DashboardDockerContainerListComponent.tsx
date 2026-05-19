import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardDockerContainerListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardDockerContainerListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
} from "./DashboardResourceListBase";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DockerResource from "Common/Models/DatabaseModels/DockerResource";
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
  component: DashboardDockerContainerListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Container", widthPct: "30%" },
  { label: "Image", widthPct: "30%" },
  { label: "CPU %", widthPct: "10%", alignRight: true },
  { label: "Memory", widthPct: "15%", alignRight: true },
  { label: "Host", widthPct: "15%" },
];

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

const DashboardDockerContainerListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [containers, setContainers] = useState<Array<DockerResource>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const args: DashboardDockerContainerListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const dockerHostIds: Array<string> | undefined = args.dockerHostIds;
  const imageName: string | undefined = args.imageName;

  const dockerHostIdsKey: string = (dockerHostIds || []).join(",");
  const imageNameKey: string = (imageName || "").trim();

  const fetchContainers: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const baseQuery: Record<string, unknown> = {
        projectId: projectId,
        kind: "Container",
      };

      if (dockerHostIds && dockerHostIds.length > 0) {
        baseQuery["dockerHostId"] = new Includes(dockerHostIds);
      }

      if (imageNameKey) {
        baseQuery["imageName"] = new Search(imageNameKey);
      }

      const query: Query<DockerResource> =
        DashboardModelQueryInterpolation.applyToQuery(
          baseQuery,
          props.variables,
          ATTRIBUTE_TO_COLUMN,
        ) as Query<DockerResource>;

      const listResult: ListResult<DockerResource> =
        await ModelAPI.getList<DockerResource>({
          modelType: DockerResource,
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
            dockerHostId: true,
            dockerHost: {
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
  }, [maxRows, dockerHostIdsKey, imageNameKey, props.variables]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers, props.refreshTick]);

  const rows: Array<ReactElement> = containers.map(
    (container: DockerResource) => {
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
      const hostName: string = (container.dockerHost?.name as string) || "—";
      const hostId: string =
        (container.dockerHostId?.toString() as string) || "";

      let detailLink: ReactElement = <span>{name}</span>;
      if (hostId && id) {
        const route: Route = RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL] as Route,
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
  DashboardDockerContainerListComponentElement,
  arePropsEqual,
);
