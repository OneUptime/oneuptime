import React, { ReactElement, useCallback, useEffect, useState } from "react";
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
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";

/*
 * Generic, model-class-driven engine behind the custom-dashboard
 * inventory list widgets (Postgres ModelAPI.getList + list/honeycomb
 * render modes). Product wrappers supply the model class, the query
 * (kind / cluster filters), the select and the sort:
 * DashboardKubernetesResourceListBase wraps it for KubernetesResource;
 * the Proxmox / Ceph widgets wrap it for ProxmoxResource / CephResource.
 */
export interface DashboardModelResourceListBaseProps<
  TBaseModel extends BaseModel,
> {
  modelType: { new (): TBaseModel };
  /*
   * Resource-type identifier for the public-dashboard list endpoint
   * (DashboardResourceList.getRequestOptions). Must be registered in
   * PUBLIC_DASHBOARD_RESOURCES on the server for public dashboards.
   */
  publicResourceType: DashboardResourceType;
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
  sort: Sort<TBaseModel>;
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

  /*
   * Stringified dependency keys so a parent re-render with a fresh but
   * deep-equal query/select object does not refetch.
   */
  const queryKey: string = JSON.stringify(props.query || {});
  const selectKey: string = JSON.stringify(props.select || {});
  const sortKey: string = JSON.stringify(props.sort || {});
  const variablesKey: string = JSON.stringify(props.variables || []);
  const attributeToColumnKey: string = JSON.stringify(
    props.attributeToColumn || {},
  );

  const fetchResources: () => Promise<void> = useCallback(async () => {
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

      const listResult: ListResult<TBaseModel> =
        await ModelAPI.getList<TBaseModel>({
          modelType: props.modelType,
          requestOptions: DashboardResourceList.getRequestOptions(
            props.publicResourceType,
          ),
          query: queryWithVariables,
          limit: props.maxRows,
          skip: 0,
          select: props.select,
          sort: props.sort,
        });

      setResources(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [
    props.modelType,
    props.publicResourceType,
    props.maxRows,
    queryKey,
    selectKey,
    sortKey,
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
    >
      {rows}
    </DashboardResourceListBase>
  );
};

export default DashboardModelResourceListBase;
