import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardDockerNetworkListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardDockerNetworkListComponent";
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
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDockerNetworkListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Network", widthPct: "40%" },
  { label: "Driver / Scope", widthPct: "30%" },
  { label: "Host", widthPct: "30%" },
];

const DashboardDockerNetworkListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [networks, setNetworks] = useState<Array<DockerResource>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const args: DashboardDockerNetworkListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const dockerHostIds: Array<string> | undefined = args.dockerHostIds;

  const dockerHostIdsKey: string = (dockerHostIds || []).join(",");

  const fetchNetworks: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);

    const projectId: ReturnType<typeof ProjectUtil.getCurrentProjectId> =
      ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<DockerResource> = {
        projectId: projectId,
        kind: "Network",
      } as Query<DockerResource>;

      if (dockerHostIds && dockerHostIds.length > 0) {
        (query as Record<string, unknown>)["dockerHostId"] = new Includes(
          dockerHostIds,
        );
      }

      const listResult: ListResult<DockerResource> =
        await ModelAPI.getList<DockerResource>({
          modelType: DockerResource,
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

      setNetworks(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [maxRows, dockerHostIdsKey]);

  useEffect(() => {
    fetchNetworks();
  }, [fetchNetworks, props.refreshTick]);

  const rows: Array<ReactElement> = networks.map((n: DockerResource) => {
    const id: string = (n._id as string) || "";
    const name: string = (n.name as string) || "Unnamed";
    const driverScope: string = (n.state as string) || "—";
    const hostName: string = (n.dockerHost?.name as string) || "—";

    return (
      <tr
        key={id}
        className="hover:bg-gray-50/50 transition-colors duration-100 group"
      >
        <td className="px-3 py-2 text-xs text-gray-700 truncate">{name}</td>
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
      pluralLabel="networks"
      columns={COLUMNS}
      count={networks.length}
      isLoading={isLoading}
      error={error}
      isEmpty={networks.length === 0}
      emptyMessage="No networks found"
      emptyIcon={IconProp.Globe}
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
  DashboardDockerNetworkListComponentElement,
  arePropsEqual,
);
