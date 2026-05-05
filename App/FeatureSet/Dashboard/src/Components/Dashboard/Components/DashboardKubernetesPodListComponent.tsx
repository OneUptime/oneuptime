import React, { FunctionComponent, ReactElement } from "react";
import DashboardKubernetesPodListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardKubernetesPodListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import { ResourceListColumn } from "./DashboardResourceListBase";
import DashboardKubernetesResourceListBase from "./DashboardKubernetesResourceListBase";
import IconProp from "Common/Types/Icon/IconProp";
import Includes from "Common/Types/BaseDatabase/Includes";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardKubernetesPodListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Pod", widthPct: "40%" },
  { label: "Namespace", widthPct: "20%" },
  { label: "Phase", widthPct: "15%" },
  { label: "Cluster", widthPct: "25%" },
];

const PHASE_COLORS: Record<string, { dot: string; text: string }> = {
  Running: { dot: "#10b981", text: "#047857" },
  Pending: { dot: "#f59e0b", text: "#b45309" },
  Succeeded: { dot: "#3b82f6", text: "#1d4ed8" },
  Failed: { dot: "#ef4444", text: "#b91c1c" },
  Unknown: { dot: "#9ca3af", text: "#6b7280" },
};

function renderPodRow(r: KubernetesResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = (r.name as string) || "Unnamed";
  const namespace: string = (r.namespaceKey as string) || "—";
  const phase: string = (r.phase as string) || "Unknown";
  const phaseStyle: { dot: string; text: string } =
    PHASE_COLORS[phase] || PHASE_COLORS["Unknown"]!;
  const clusterName: string = (r.kubernetesCluster?.name as string) || "—";
  const clusterId: string = (r.kubernetesClusterId?.toString() as string) || "";

  let detailLink: ReactElement = <span>{name}</span>;
  if (clusterId && id) {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL] as Route,
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
      <td className="px-3 py-2 text-xs text-gray-500 truncate">{namespace}</td>
      <td className="px-3 py-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ fontSize: "10px" }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: phaseStyle.dot }}
          ></span>
          <span style={{ color: phaseStyle.text }}>{phase}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {clusterName}
      </td>
    </tr>
  );
}

const DashboardKubernetesPodListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardKubernetesPodListComponent["arguments"] =
    props.component.arguments;
  const podPhases: Array<string> | undefined = args.podPhases;

  const extraQuery: Record<string, unknown> | undefined =
    podPhases && podPhases.length > 0
      ? { phase: new Includes(podPhases) }
      : undefined;

  return (
    <DashboardKubernetesResourceListBase
      title={args.title}
      pluralLabel="pods"
      emptyMessage="No pods found"
      emptyIcon={IconProp.Cube}
      columns={COLUMNS}
      kind="Pod"
      maxRows={args.maxRows || 25}
      kubernetesClusterIds={args.kubernetesClusterIds}
      namespaces={args.namespaces}
      extraQuery={extraQuery}
      refreshTick={props.refreshTick}
      renderRow={renderPodRow}
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

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(
  DashboardKubernetesPodListComponentElement,
  arePropsEqual,
);
