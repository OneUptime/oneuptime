import React, {
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListViewMode,
} from "../Dashboard/Components/DashboardResourceListBase";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "../Dashboard/Components/DashboardResourceHoneycomb";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList, {
  DashboardResourceType,
} from "../Dashboard/Utils/DashboardResourceList";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import { JSONObject } from "Common/Types/JSON";
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";
import {
  DashboardWidgetListReadStep,
  readDashboardWidgetListInSteps,
} from "Common/Utils/Dashboard/DashboardWidgetSorts";
import useDashboardListWidgetSort, {
  DashboardListWidgetSort,
  DashboardListWidgetSortProps,
} from "../Dashboard/Utils/UseDashboardListWidgetSort";

/*
 * Generic, model-class-driven engine behind the custom-dashboard
 * inventory list widgets (Postgres ModelAPI.getList + list/honeycomb
 * render modes). Product wrappers supply the model class, the query
 * (kind / cluster filters) and the select:
 * DashboardKubernetesResourceListBase wraps it for KubernetesResource;
 * the Proxmox / Ceph / VMware / Storage Array / Docker Swarm widgets wrap
 * it for their own resources.
 *
 * The order comes from the widget kind's sort registry
 * (Common/Utils/Dashboard/DashboardWidgetSorts, issue #5082): the viewer's
 * pick from a header click, else the widget's own sort, else the order the
 * list always had. The server orders the whole list - a status read rank
 * by rank takes one read per rank, worst first - so the rows shown are the
 * first of the whole list, never just the fetched page re-sorted. On a
 * public dashboard the server does all of that itself from the stored
 * widget, and the browser sends only the viewer's pick.
 */
export interface DashboardModelResourceListBaseProps<
  TBaseModel extends BaseModel,
> {
  modelType: { new (): TBaseModel };
  componentId: ObjectID;
  /*
   * Resource-type identifier for the public-dashboard list endpoint
   * (DashboardResourceList.getRequestOptions). Must be registered in
   * PUBLIC_DASHBOARD_RESOURCES on the server for public dashboards.
   */
  publicResourceType: DashboardResourceType;
  // The widget kind: what its columns sort by.
  componentType: DashboardComponentType;
  /*
   * The widget's props: its saved sort (component.arguments.sort), where a
   * viewer's pick is kept (dashboardId), and the settings preview's
   * onWidgetSortChange.
   */
  widgetProps: DashboardListWidgetSortProps;
  title?: string | undefined;
  pluralLabel: string;
  emptyMessage: string;
  emptyIcon: IconProp;
  columns: Array<ResourceListColumn>;
  maxRows: number;
  /*
   * Model-specific filters (kind, cluster Includes, ...), already
   * merged by the wrapper. projectId is layered on by this component;
   * dashboard variable selections are layered on top of both.
   */
  query: Query<TBaseModel>;
  select: Select<TBaseModel>;
  refreshTick?: number | undefined;
  variables?: Array<DashboardVariable> | undefined;
  attributeToColumn?: AttributeToColumnMap | undefined;
  renderRow: (resource: TBaseModel) => ReactElement;
  viewMode?: ResourceListViewMode | undefined;
  renderHoneycombTile?: ((resource: TBaseModel) => HoneycombTile) | undefined;
  honeycombLegend?: Array<HoneycombLegendItem> | undefined;
}

const DashboardModelResourceListBase: <TBaseModel extends BaseModel>(
  props: DashboardModelResourceListBaseProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: DashboardModelResourceListBaseProps<TBaseModel>,
): ReactElement => {
  const [resources, setResources] = useState<Array<TBaseModel>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const widgetSort: DashboardListWidgetSort = useDashboardListWidgetSort(
    props.widgetProps,
    props.componentType,
  );

  /*
   * Stringified dependency keys so a parent re-render with a fresh but
   * deep-equal query/select object does not refetch.
   */
  const queryKey: string = JSON.stringify(props.query || {});
  const selectKey: string = JSON.stringify(props.select || {});
  const variablesKey: string = JSON.stringify(props.variables || []);
  const attributeToColumnKey: string = JSON.stringify(
    props.attributeToColumn || {},
  );
  const viewerSortKey: string = JSON.stringify(widgetSort.viewerPick || null);

  /*
   * Only the newest read may draw: a viewer clicking through a column's
   * sorts starts a read per click, and an older, slower one must not
   * replace the order they ended on.
   */
  const readSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchResources: () => Promise<void> = useCallback(async () => {
    const readSequence: number = ++readSequenceRef.current;
    const isStale: () => boolean = (): boolean => {
      return readSequence !== readSequenceRef.current;
    };

    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!DashboardResourceList.isPublic() && !projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<TBaseModel> = {
        projectId: projectId,
        ...(props.query as Record<string, unknown>),
      } as Query<TBaseModel>;

      /*
       * Layer dashboard variable selections on top so e.g. a
       * `k8s.namespace.name = $ns` variable narrows this list to the
       * selected namespace.
       */
      const queryWithVariables: Query<TBaseModel> =
        DashboardModelQueryInterpolation.applyToQuery(
          query as Record<string, unknown>,
          props.variables,
          props.attributeToColumn || {},
        ) as Query<TBaseModel>;

      const select: Select<TBaseModel> = widgetSort.withSortSelect(
        props.select as JSONObject,
      ) as Select<TBaseModel>;

      const read: (
        step: DashboardWidgetListReadStep,
        limit: number,
      ) => Promise<Array<TBaseModel>> = async (
        step: DashboardWidgetListReadStep,
        limit: number,
      ): Promise<Array<TBaseModel>> => {
        const listResult: ListResult<TBaseModel> =
          await ModelAPI.getList<TBaseModel>({
            modelType: props.modelType,
            requestOptions: DashboardResourceList.getRequestOptions(
              props.publicResourceType,
              {
                componentId: props.componentId,
                variables: props.variables,
                viewerSort: widgetSort.viewerPick,
              },
            ),
            query: step.query as Query<TBaseModel>,
            limit: limit,
            skip: 0,
            select: select,
            sort: step.sort as Sort<TBaseModel>,
          });

        return listResult.data;
      };

      /*
       * A public dashboard's server reads every rank itself: one request.
       * Inside OneUptime, a status read rank by rank is one read per rank.
       */
      const steps: Array<DashboardWidgetListReadStep> =
        DashboardResourceList.isPublic()
          ? [
              {
                query: queryWithVariables as JSONObject,
                sort: widgetSort.modelSort,
              },
            ]
          : widgetSort.getReadSteps(queryWithVariables as JSONObject);

      const rows: Array<TBaseModel> = await readDashboardWidgetListInSteps({
        steps,
        limit: props.maxRows,
        read,
        // A read the viewer's next click replaced reads no further ranks.
        shouldStop: isStale,
      });

      if (isStale()) {
        return;
      }

      setResources(rows);
      setError(null);
    } catch (err: unknown) {
      if (isStale()) {
        return;
      }

      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [
    props.modelType,
    props.componentId,
    props.publicResourceType,
    props.componentType,
    props.maxRows,
    queryKey,
    selectKey,
    widgetSort.sortKey,
    viewerSortKey,
    variablesKey,
    attributeToColumnKey,
  ]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources, props.refreshTick]);

  const viewMode: ResourceListViewMode = props.viewMode || "list";

  const rows: Array<ReactElement> =
    viewMode === "list"
      ? resources.map((r: TBaseModel): ReactElement => {
          return props.renderRow(r);
        })
      : [];

  const honeycombTiles: Array<HoneycombTile> | undefined =
    viewMode === "honeycomb" && props.renderHoneycombTile
      ? resources.map((r: TBaseModel): HoneycombTile => {
          return props.renderHoneycombTile!(r);
        })
      : undefined;

  return (
    <DashboardResourceListBase
      title={props.title}
      pluralLabel={props.pluralLabel}
      columns={props.columns}
      count={resources.length}
      isLoading={isLoading}
      error={error}
      isEmpty={resources.length === 0}
      emptyMessage={props.emptyMessage}
      emptyIcon={props.emptyIcon}
      viewMode={viewMode}
      honeycombTiles={honeycombTiles}
      honeycombLegend={props.honeycombLegend}
      sort={widgetSort.listSort}
    >
      {rows}
    </DashboardResourceListBase>
  );
};

export default DashboardModelResourceListBase;
