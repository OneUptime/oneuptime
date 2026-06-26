import React, { FunctionComponent, ReactElement } from "react";
import {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";
import DashboardModelResourceListBase from "../../Infrastructure/DashboardModelResourceListBase";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import Select from "Common/Types/BaseDatabase/Select";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { AttributeToColumnMap } from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";

/*
 * Thin Kubernetes wrapper around the shared, model-class-driven
 * DashboardModelResourceListBase
 * (Components/Infrastructure/DashboardModelResourceListBase.tsx).
 * Keeps the original public API (kind / kubernetesClusterIds /
 * namespaces / extraQuery / extraSelect) so the per-kind Kubernetes
 * widget components compile unchanged; all this wrapper does is fold
 * those props into the generic query / select / sort contract.
 */
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
  const query: Query<KubernetesResource> = {
    kind: props.kind,
  } as Query<KubernetesResource>;

  if (props.kubernetesClusterIds && props.kubernetesClusterIds.length > 0) {
    (query as Record<string, unknown>)["kubernetesClusterId"] = new Includes(
      props.kubernetesClusterIds,
    );
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
      (query as Record<string, unknown>)["namespaceKey"] = new Includes(parsed);
    }
  }

  if (props.extraQuery) {
    for (const key of Object.keys(props.extraQuery)) {
      (query as Record<string, unknown>)[key] = props.extraQuery[key];
    }
  }

  const select: Select<KubernetesResource> = {
    ...BASE_SELECT,
    ...((props.extraSelect as Select<KubernetesResource>) || {}),
  };

  return (
    <DashboardModelResourceListBase<KubernetesResource>
      modelType={KubernetesResource}
      publicResourceType="kubernetes-resource"
      title={props.title}
      pluralLabel={props.pluralLabel}
      emptyMessage={props.emptyMessage}
      emptyIcon={props.emptyIcon}
      columns={props.columns}
      maxRows={props.maxRows}
      query={query}
      select={select}
      sort={{
        namespaceKey: SortOrder.Ascending,
        name: SortOrder.Ascending,
      }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={props.attributeToColumn}
      renderRow={props.renderRow}
      viewMode={props.viewMode}
      renderHoneycombTile={props.renderHoneycombTile}
      honeycombLegend={props.honeycombLegend}
    />
  );
};

export default DashboardKubernetesResourceListBase;
