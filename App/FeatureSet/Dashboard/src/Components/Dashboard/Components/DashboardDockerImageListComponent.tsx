import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardDockerImageListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardDockerImageListComponent";
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

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDockerImageListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Image", widthPct: "55%" },
  { label: "Image ID", widthPct: "20%" },
  { label: "Host", widthPct: "25%" },
];

const DashboardDockerImageListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [images, setImages] = useState<Array<DockerResource>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const args: DashboardDockerImageListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const dockerHostIds: Array<string> | undefined = args.dockerHostIds;
  const nameSearch: string | undefined = args.nameSearch;

  const dockerHostIdsKey: string = (dockerHostIds || []).join(",");
  const nameSearchKey: string = (nameSearch || "").trim();

  const fetchImages: () => Promise<void> = useCallback(async () => {
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
        kind: "Image",
      } as Query<DockerResource>;

      if (dockerHostIds && dockerHostIds.length > 0) {
        (query as Record<string, unknown>)["dockerHostId"] = new Includes(
          dockerHostIds,
        );
      }

      if (nameSearchKey) {
        (query as Record<string, unknown>)["name"] = new Search(nameSearchKey);
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
            containerId: true,
            dockerHostId: true,
            dockerHost: {
              name: true,
            },
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setImages(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [maxRows, dockerHostIdsKey, nameSearchKey]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages, props.refreshTick]);

  const rows: Array<ReactElement> = images.map((img: DockerResource) => {
    const id: string = (img._id as string) || "";
    const name: string = (img.name as string) || "Unnamed";
    const imageId: string = (img.containerId as string) || "—";
    const hostName: string = (img.dockerHost?.name as string) || "—";

    return (
      <tr
        key={id}
        className="hover:bg-gray-50/50 transition-colors duration-100 group"
      >
        <td className="px-3 py-2 text-xs text-gray-700 truncate font-mono">
          {name}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 truncate font-mono">
          {imageId}
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 truncate">{hostName}</td>
      </tr>
    );
  });

  return (
    <DashboardResourceListBase
      title={args.title}
      pluralLabel="images"
      columns={COLUMNS}
      count={images.length}
      isLoading={isLoading}
      error={error}
      isEmpty={images.length === 0}
      emptyMessage="No images found"
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

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(
  DashboardDockerImageListComponentElement,
  arePropsEqual,
);
