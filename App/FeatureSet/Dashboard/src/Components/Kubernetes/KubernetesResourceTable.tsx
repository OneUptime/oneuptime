import React, { FunctionComponent, ReactElement } from "react";
import ResourceTable from "../Infrastructure/ResourceTable";
import { KubernetesResource } from "../../Pages/Kubernetes/Utils/KubernetesResourceUtils";
import Route from "Common/Types/API/Route";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";

/*
 * Thin Kubernetes wrapper around the shared infrastructure
 * ResourceTable (Components/Infrastructure/ResourceTable.tsx). Keeps
 * the original Kubernetes-flavored public API (showNamespace, the
 * kubernetes-agent empty message, the `kubernetes-*-table` DOM id)
 * so existing Kubernetes pages compile and behave unchanged.
 * `KubernetesResource` is structurally identical to the shared
 * `InfrastructureResource` view-model, so resources and callbacks
 * pass through without mapping.
 */

export interface ResourceColumn {
  title: string;
  key: string;
  getValue?: (resource: KubernetesResource) => string;
}

export interface ComponentProps {
  resources: Array<KubernetesResource>;
  title: string;
  description: string;
  columns?: Array<ResourceColumn>;
  showNamespace?: boolean;
  showStatus?: boolean;
  showResourceMetrics?: boolean;
  getViewRoute?: (resource: KubernetesResource) => Route;
  /*
   * Extra row actions rendered after the built-in View button (e.g.
   * "Logs" / "Metrics" explorer pivots). `KubernetesResource` is
   * structurally identical to the shared `InfrastructureResource`, so
   * these pass straight through to the underlying ResourceTable.
   */
  extraActionButtons?: Array<ActionButtonSchema<KubernetesResource>>;
  emptyMessage?: string;
  isLoading?: boolean;
  onRefreshClick?: (() => void) | undefined;
}

const KubernetesResourceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ResourceTable
      resources={props.resources}
      title={props.title}
      description={props.description}
      columns={props.columns}
      showGroupColumn={props.showNamespace}
      groupColumnTitle="Namespace"
      groupFallbackLabel="default"
      showStatus={props.showStatus}
      showResourceMetrics={props.showResourceMetrics}
      getViewRoute={props.getViewRoute}
      extraActionButtons={props.extraActionButtons}
      emptyMessage={
        props.emptyMessage ||
        "No resources found. Resources will appear here once the kubernetes-agent is sending data."
      }
      isLoading={props.isLoading}
      onRefreshClick={props.onRefreshClick}
      tableIdPrefix="kubernetes"
    />
  );
};

export default KubernetesResourceTable;
