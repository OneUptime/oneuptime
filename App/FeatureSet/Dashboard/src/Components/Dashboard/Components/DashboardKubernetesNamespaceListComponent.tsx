import React, { FunctionComponent, ReactElement } from "react";
import DashboardKubernetesNamespaceListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardKubernetesNamespaceListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import DashboardKubernetesResourceListBase from "./DashboardKubernetesResourceListBase";
import IconProp from "Common/Types/Icon/IconProp";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { AttributeToColumnMap } from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";

const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.namespace.name": "name",
  "resource.k8s.namespace.name": "name",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardKubernetesNamespaceListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Namespace", widthPct: "60%" },
  { label: "Cluster", widthPct: "40%" },
];

function renderNamespaceRow(r: KubernetesResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = (r.name as string) || "Unnamed";
  const clusterName: string = (r.kubernetesCluster?.name as string) || "—";
  const clusterId: string = (r.kubernetesClusterId?.toString() as string) || "";

  let detailLink: ReactElement = <span>{name}</span>;
  if (clusterId && id) {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL] as Route,
      { modelId: new ObjectID(clusterId), subModelId: new ObjectID(id) },
    );
    detailLink = (
      <AppLink
        to={route}
        className="hover:underline text-gray-700 group-hover:text-blue-600"
      >
        {name}
      </AppLink>
    );
  }

  return (
    <tr
      key={id}
      className="hover:bg-gray-50/50 transition-colors duration-100 group"
    >
      <td className="px-3 py-2 text-xs text-gray-700 truncate">{detailLink}</td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {clusterName}
      </td>
    </tr>
  );
}

const NAMESPACE_PHASE_COLORS: Record<
  string,
  { dot: string; legendLabel: string }
> = {
  Active: { dot: "#10b981", legendLabel: "Active" },
  Terminating: { dot: "#f59e0b", legendLabel: "Terminating" },
  Unknown: { dot: "#9ca3af", legendLabel: "Unknown" },
};

const NAMESPACE_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Active", color: NAMESPACE_PHASE_COLORS["Active"]!.dot },
  { label: "Terminating", color: NAMESPACE_PHASE_COLORS["Terminating"]!.dot },
  { label: "Unknown", color: NAMESPACE_PHASE_COLORS["Unknown"]!.dot },
];

function buildNamespaceTile(r: KubernetesResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = (r.name as string) || "Unnamed";
  const clusterName: string = (r.kubernetesCluster?.name as string) || "—";
  const clusterId: string = (r.kubernetesClusterId?.toString() as string) || "";
  const phase: string = (r.phase as string) || "Unknown";
  const phaseStyle: { dot: string; legendLabel: string } =
    NAMESPACE_PHASE_COLORS[phase] || NAMESPACE_PHASE_COLORS["Unknown"]!;

  let route: Route | undefined = undefined;
  if (clusterId && id) {
    route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL] as Route,
      { modelId: new ObjectID(clusterId), subModelId: new ObjectID(id) },
    );
  }

  return {
    id: id || name,
    status: phase,
    color: phaseStyle.dot,
    route: route,
    tooltip: {
      title: name,
      details: [{ label: "Cluster", value: clusterName }],
    },
  };
}

const DashboardKubernetesNamespaceListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardKubernetesNamespaceListComponent["arguments"] =
    props.component.arguments;

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardKubernetesResourceListBase
      title={args.title}
      pluralLabel="namespaces"
      emptyMessage="No namespaces found"
      emptyIcon={IconProp.Folder}
      columns={COLUMNS}
      kind="Namespace"
      maxRows={args.maxRows || 25}
      kubernetesClusterIds={args.kubernetesClusterIds}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderNamespaceRow}
      viewMode={viewMode}
      renderHoneycombTile={buildNamespaceTile}
      honeycombLegend={NAMESPACE_LEGEND}
    />
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
  DashboardKubernetesNamespaceListComponentElement,
  arePropsEqual,
);
