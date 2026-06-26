import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardDockerVolumeListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardDockerVolumeListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import { HoneycombTile } from "./DashboardResourceHoneycomb";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList from "../Utils/DashboardResourceList";
import DockerResource from "Common/Models/DatabaseModels/DockerResource";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDockerVolumeListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Volume", widthPct: "45%" },
  { label: "Driver / Scope", widthPct: "25%" },
  { label: "Host", widthPct: "30%" },
];

const DashboardDockerVolumeListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [volumes, setVolumes] = useState<Array<DockerResource>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const args: DashboardDockerVolumeListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const dockerHostIds: Array<string> | undefined = args.dockerHostIds;
  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  const dockerHostIdsKey: string = (dockerHostIds || []).join(",");

  const fetchVolumes: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);

    const projectId: ReturnType<typeof ProjectUtil.getCurrentProjectId> =
      ProjectUtil.getCurrentProjectId();
    if (!DashboardResourceList.isPublic() && !projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<DockerResource> = {
        projectId: projectId,
        kind: "Volume",
      } as Query<DockerResource>;

      if (dockerHostIds && dockerHostIds.length > 0) {
        (query as Record<string, unknown>)["dockerHostId"] = new Includes(
          dockerHostIds,
        );
      }

      const listResult: ListResult<DockerResource> =
        await ModelAPI.getList<DockerResource>({
          modelType: DockerResource,
          requestOptions:
            DashboardResourceList.getRequestOptions("docker-volume"),
          query: query,
          limit: maxRows,
          skip: 0,
          select: {
            _id: true,
            name: true,
            state: true,
            dockerHostId: true,
            dockerHost: {
              name: true,
            },
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setVolumes(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [maxRows, dockerHostIdsKey]);

  useEffect(() => {
    fetchVolumes();
  }, [fetchVolumes, props.refreshTick]);

  const honeycombTiles: Array<HoneycombTile> = volumes.map(
    (v: DockerResource): HoneycombTile => {
      const id: string = (v._id as string) || "";
      const name: string = (v.name as string) || "Unnamed";
      const driverScope: string = (v.state as string) || "—";
      const hostName: string = (v.dockerHost?.name as string) || "—";

      return {
        id: id || name,
        status: "Volume",
        color: "#06b6d4",
        tooltip: {
          title: name,
          details: [
            { label: "Driver / Scope", value: driverScope },
            { label: "Host", value: hostName },
          ],
        },
      };
    },
  );

  const rows: Array<ReactElement> = volumes.map((v: DockerResource) => {
    const id: string = (v._id as string) || "";
    const name: string = (v.name as string) || "Unnamed";
    const driverScope: string = (v.state as string) || "—";
    const hostName: string = (v.dockerHost?.name as string) || "—";

    return (
      <tr
        key={id}
        className="hover:bg-gray-50/50 transition-colors duration-100 group"
      >
        <td className="px-3 py-2 text-xs text-gray-700 truncate font-mono">
          {name}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 truncate font-mono">
          {driverScope}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 truncate">{hostName}</td>
      </tr>
    );
  });

  return (
    <DashboardResourceListBase
      title={args.title}
      pluralLabel="volumes"
      columns={COLUMNS}
      count={volumes.length}
      isLoading={isLoading}
      error={error}
      isEmpty={volumes.length === 0}
      emptyMessage="No volumes found"
      emptyIcon={IconProp.Database}
      viewMode={viewMode}
      honeycombTiles={honeycombTiles}
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
  DashboardDockerVolumeListComponentElement,
  arePropsEqual,
);
