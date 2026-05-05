import React, { FunctionComponent, ReactElement } from "react";
import DashboardKubernetesCronJobListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardKubernetesCronJobListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import { ResourceListColumn } from "./DashboardResourceListBase";
import DashboardKubernetesResourceListBase from "./DashboardKubernetesResourceListBase";
import IconProp from "Common/Types/Icon/IconProp";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardKubernetesCronJobListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "CronJob", widthPct: "40%" },
  { label: "Namespace", widthPct: "25%" },
  { label: "Cluster", widthPct: "35%" },
];

function renderRow(r: KubernetesResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = (r.name as string) || "Unnamed";
  const namespace: string = (r.namespaceKey as string) || "—";
  const clusterName: string = (r.kubernetesCluster?.name as string) || "—";
  const clusterId: string = (r.kubernetesClusterId?.toString() as string) || "";

  let detailLink: ReactElement = <span>{name}</span>;
  if (clusterId && id) {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL] as Route,
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
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {clusterName}
      </td>
    </tr>
  );
}

const DashboardKubernetesCronJobListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardKubernetesCronJobListComponent["arguments"] =
    props.component.arguments;

  return (
    <DashboardKubernetesResourceListBase
      title={args.title}
      pluralLabel="cronjobs"
      emptyMessage="No cron jobs found"
      emptyIcon={IconProp.Clock}
      columns={COLUMNS}
      kind="CronJob"
      maxRows={args.maxRows || 25}
      kubernetesClusterIds={args.kubernetesClusterIds}
      namespaces={args.namespaces}
      refreshTick={props.refreshTick}
      renderRow={renderRow}
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
  DashboardKubernetesCronJobListComponentElement,
  arePropsEqual,
);
