import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
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
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import Select from "Common/Types/BaseDatabase/Select";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";

export interface KubernetesResourceListBaseProps {
  title?: string | undefined;
  pluralLabel: string;
  emptyMessage: string;
  emptyIcon: IconProp;
  columns: Array<ResourceListColumn>;
  kind: string;
  maxRows: number;
  kubernetesClusterIds?: Array<string> | undefined;
  namespaces?: string | undefined;
  extraQuery?: Record<string, unknown> | undefined;
  extraSelect?: Record<string, unknown> | undefined;
  refreshTick?: number | undefined;
  variables?: Array<DashboardVariable> | undefined;
  attributeToColumn?: AttributeToColumnMap | undefined;
  renderRow: (resource: KubernetesResource) => ReactElement;
  viewMode?: ResourceListViewMode | undefined;
  renderHoneycombTile?:
    | ((resource: KubernetesResource) => HoneycombTile)
    | undefined;
  honeycombLegend?: Array<HoneycombLegendItem> | undefined;
}

const BASE_SELECT: Select<KubernetesResource> = {
  _id: true,
  name: true,
  namespaceKey: true,
  kind: true,
  phase: true,
  isReady: true,
  hasMemoryPressure: true,
  hasDiskPressure: true,
  hasPidPressure: true,
  containerCount: true,
  latestCpuPercent: true,
  latestMemoryBytes: true,
  controllerDeploymentName: true,
  controllerCronJobName: true,
  resourceCreationTimestamp: true,
  lastSeenAt: true,
  kubernetesClusterId: true,
  kubernetesCluster: {
    name: true,
  },
};

const DashboardKubernetesResourceListBase: FunctionComponent<
  KubernetesResourceListBaseProps
> = (props: KubernetesResourceListBaseProps): ReactElement => {
  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const clusterIdsKey: string = (props.kubernetesClusterIds || []).join(",");
  const namespacesKey: string = (props.namespaces || "").trim();
  const extraQueryKey: string = JSON.stringify(props.extraQuery || {});
  const extraSelectKey: string = JSON.stringify(props.extraSelect || {});
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
      const query: Query<KubernetesResource> = {
        projectId: projectId,
        kind: props.kind,
      } as Query<KubernetesResource>;

      if (props.kubernetesClusterIds && props.kubernetesClusterIds.length > 0) {
        (query as Record<string, unknown>)["kubernetesClusterId"] =
          new Includes(props.kubernetesClusterIds);
      }

      if (props.namespaces && props.namespaces.trim().length > 0) {
        const parsed: Array<string> = props.namespaces
          .split(",")
          .map((s: string) => {
            return s.trim();
          })
          .filter((s: string) => {
            return s.length > 0;
          });

        if (parsed.length > 0) {
          (query as Record<string, unknown>)["namespaceKey"] = new Includes(
            parsed,
          );
        }
      }

      if (props.extraQuery) {
        for (const key of Object.keys(props.extraQuery)) {
          (query as Record<string, unknown>)[key] = props.extraQuery[key];
        }
      }

      /*
       * Layer dashboard variable selections on top so e.g. a
       * `k8s.namespace.name = $ns` variable narrows this list to the
       * selected namespace.
       */
      const queryWithVariables: Query<KubernetesResource> =
        DashboardModelQueryInterpolation.applyToQuery(
          query as Record<string, unknown>,
          props.variables,
          props.attributeToColumn || {},
        ) as Query<KubernetesResource>;

      const select: Select<KubernetesResource> = {
        ...BASE_SELECT,
        ...((props.extraSelect as Select<KubernetesResource>) || {}),
      };

      const listResult: ListResult<KubernetesResource> =
        await ModelAPI.getList<KubernetesResource>({
          modelType: KubernetesResource,
          requestOptions: DashboardResourceList.getRequestOptions(
            "kubernetes-resource",
          ),
          query: queryWithVariables,
          limit: props.maxRows,
          skip: 0,
          select: select,
          sort: {
            namespaceKey: SortOrder.Ascending,
            name: SortOrder.Ascending,
          },
        });

      setResources(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [
    props.kind,
    props.maxRows,
    clusterIdsKey,
    namespacesKey,
    extraQueryKey,
    extraSelectKey,
    variablesKey,
    attributeToColumnKey,
  ]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources, props.refreshTick]);

  const viewMode: ResourceListViewMode = props.viewMode || "list";

  const rows: Array<ReactElement> =
    viewMode === "list"
      ? resources.map((r: KubernetesResource): ReactElement => {
          return props.renderRow(r);
        })
      : [];

  const honeycombTiles: Array<HoneycombTile> | undefined =
    viewMode === "honeycomb" && props.renderHoneycombTile
      ? resources.map((r: KubernetesResource): HoneycombTile => {
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

export default DashboardKubernetesResourceListBase;
