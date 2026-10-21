import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardDockerNetworkListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardDockerNetworkListComponent";
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
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import { JSONObject } from "Common/Types/JSON";
import useDashboardListWidgetSort, {
  DashboardListWidgetSort,
} from "../Utils/UseDashboardListWidgetSort";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDockerNetworkListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Network", widthPct: "40%", sortKey: "name" },
  { label: "Driver / Scope", widthPct: "30%", sortKey: "driver" },
  { label: "Host", widthPct: "30%", sortKey: "host" },
];

const DashboardDockerNetworkListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [networks, setNetworks] = useState<Array<DockerResource>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const widgetSort: DashboardListWidgetSort = useDashboardListWidgetSort(
    props,
    DashboardComponentType.DockerNetworkList,
  );

  const args: DashboardDockerNetworkListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const dockerHostIds: Array<string> | undefined = args.dockerHostIds;
  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  const dockerHostIdsKey: string = (dockerHostIds || []).join(",");

  /*
   * Only the newest read may draw: a viewer clicking through a column's
   * sorts starts a read per click, and an older, slower one must not
   * replace the order they ended on.
   */
  const readSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchNetworks: () => Promise<void> = useCallback(async () => {
    const readSequence: number = ++readSequenceRef.current;
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
          requestOptions: DashboardResourceList.getRequestOptions(
            "docker-network",
            {
              componentId: props.componentId,
              variables: props.variables,
              viewerSort: widgetSort.viewerPick,
            },
          ),
          query: query,
          limit: maxRows,
          skip: 0,
          select: widgetSort.withSortSelect({
            _id: true,
            name: true,
            state: true,
            dockerHostId: true,
            dockerHost: {
              name: true,
            },
          } as JSONObject) as Select<DockerResource>,
          // The viewer's pick, else the widget's own sort, else by name.
          sort: widgetSort.modelSort as Sort<DockerResource>,
        });

      if (readSequence !== readSequenceRef.current) {
        return;
      }

      setNetworks(listResult.data);
      setError(null);
    } catch (err: unknown) {
      if (readSequence !== readSequenceRef.current) {
        return;
      }

      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [
    maxRows,
    dockerHostIdsKey,
    props.componentId,
    props.variables,
    widgetSort.sortKey,
  ]);

  useEffect(() => {
    fetchNetworks();
  }, [fetchNetworks, props.refreshTick]);

  const honeycombTiles: Array<HoneycombTile> = networks.map(
    (n: DockerResource): HoneycombTile => {
      const id: string = (n._id as string) || "";
      const name: string = (n.name as string) || "Unnamed";
      const driverScope: string = (n.state as string) || "—";
      const hostName: string = (n.dockerHost?.name as string) || "—";

      return {
        id: id || name,
        status: "Network",
        color: "#8b5cf6",
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
      viewMode={viewMode}
      honeycombTiles={honeycombTiles}
      sort={widgetSort.listSort}
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
