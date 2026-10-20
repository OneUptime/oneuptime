import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardPodmanImageListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardPodmanImageListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import { HoneycombTile } from "./DashboardResourceHoneycomb";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList from "../Utils/DashboardResourceList";
import PodmanResource from "Common/Models/DatabaseModels/PodmanResource";
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
import Search from "Common/Types/BaseDatabase/Search";
import JSONFunctions from "Common/Types/JSONFunctions";
import ProjectUtil from "Common/UI/Utils/Project";
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";

const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "container.image.name": "name",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardPodmanImageListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Image", widthPct: "55%", sortKey: "name" },
  { label: "Image ID", widthPct: "20%" },
  { label: "Host", widthPct: "25%", sortKey: "host" },
];

const DashboardPodmanImageListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [images, setImages] = useState<Array<PodmanResource>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const widgetSort: DashboardListWidgetSort = useDashboardListWidgetSort(
    props,
    DashboardComponentType.PodmanImageList,
  );

  const args: DashboardPodmanImageListComponent["arguments"] =
    props.component.arguments;
  const maxRows: number = args.maxRows || 25;
  const podmanHostIds: Array<string> | undefined = args.podmanHostIds;
  const nameSearch: string | undefined = args.nameSearch;
  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  const podmanHostIdsKey: string = (podmanHostIds || []).join(",");
  const nameSearchKey: string = (nameSearch || "").trim();

  /*
   * Only the newest read may draw: a viewer clicking through a column's
   * sorts starts a read per click, and an older, slower one must not
   * replace the order they ended on.
   */
  const readSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchImages: () => Promise<void> = useCallback(async () => {
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
      const baseQuery: Record<string, unknown> = {
        projectId: projectId,
        kind: "Image",
      };

      if (podmanHostIds && podmanHostIds.length > 0) {
        baseQuery["podmanHostId"] = new Includes(podmanHostIds);
      }

      if (nameSearchKey) {
        baseQuery["name"] = new Search(nameSearchKey);
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
          requestOptions: DashboardResourceList.getRequestOptions(
            "podman-image",
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
            containerId: true,
            podmanHostId: true,
            podmanHost: {
              name: true,
            },
          } as JSONObject) as Select<PodmanResource>,
          // The viewer's pick, else the widget's own sort, else by name.
          sort: widgetSort.modelSort as Sort<PodmanResource>,
        });

      if (readSequence !== readSequenceRef.current) {
        return;
      }

      setImages(listResult.data);
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
    podmanHostIdsKey,
    nameSearchKey,
    props.variables,
    props.componentId,
    widgetSort.sortKey,
  ]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages, props.refreshTick]);

  const honeycombTiles: Array<HoneycombTile> = images.map(
    (img: PodmanResource): HoneycombTile => {
      const id: string = (img._id as string) || "";
      const name: string = (img.name as string) || "Unnamed";
      const imageId: string = (img.containerId as string) || "—";
      const hostName: string = (img.podmanHost?.name as string) || "—";

      return {
        id: id || name,
        status: "Image",
        color: "#3b82f6",
        tooltip: {
          title: name,
          details: [
            { label: "Image ID", value: imageId },
            { label: "Host", value: hostName },
          ],
        },
      };
    },
  );

  const rows: Array<ReactElement> = images.map((img: PodmanResource) => {
    const id: string = (img._id as string) || "";
    const name: string = (img.name as string) || "Unnamed";
    const imageId: string = (img.containerId as string) || "—";
    const hostName: string = (img.podmanHost?.name as string) || "—";

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

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(
  DashboardPodmanImageListComponentElement,
  arePropsEqual,
);
